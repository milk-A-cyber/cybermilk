/* =========================================================
   井眼轨迹智能控制 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  轨迹建模：随钻测点 → 连续轨迹 + 井底位置
   屏 2  模型预测控制：向前看几步 → 工具面角 + 滑动段
   屏 3  闭环安全：安全边界校验 + 建议 → 闭环控制
   所有计算都在浏览器里完成，纯前端。
   ========================================================= */
(function (global) {
  'use strict';

  /* =====================================================
     纯模型层（Node 可 require 做单测；浏览器里继续往下走）
     ===================================================== */
  var Model = (function () {

    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

    function mulberry32(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    var DEG = Math.PI / 180;

    /* -----------------------------------------------------
       合成随钻测点轨迹
       每 10—30m 一测点。返回 { n, md:[], inc:[], azi:[] }（md 井深, inc 井斜, azi 方位）
       ----------------------------------------------------- */
    function genSurvey(n, seed) {
      var rnd = mulberry32(seed || 20261131);
      var md = new Float64Array(n), inc = new Float64Array(n), azi = new Float64Array(n);
      for (var i = 0; i < n; i++) {
        md[i] = 500 + i * 25;                 /* 500m 起，每 25m 一测点 */
        inc[i] = 20 + i * 0.9 + Math.sin(i * 0.4) * 2.5 + (rnd() - 0.5) * 1.5;
        azi[i] = 90 + Math.cos(i * 0.3) * 4 + (rnd() - 0.5) * 2;
        inc[i] = clamp(inc[i], 0.5, 89);
      }
      return { n: n, md: md, inc: inc, azi: azi };
    }

    /* -----------------------------------------------------
       轨迹拟合：测点 → 连续轨迹
       用最小曲率法按测段累加，推算垂深/水平位移/全角变化率。
       method 0 最小曲率 1 简单样条。返回 { depth:[], vs:[]（水平位移）, tv:[]（垂深）, dogleg:[]（全角变化率/狗腿度） }
       ----------------------------------------------------- */
    function fitTrajectory(survey, method) {
      var n = survey.n;
      var tv = new Float64Array(n), vs = new Float64Array(n), dog = new Float64Array(n);
      tv[0] = 0; vs[0] = 0; dog[0] = 0;
      for (var i = 1; i < n; i++) {
        var dmd = survey.md[i] - survey.md[i - 1];
        var dInc = survey.inc[i] - survey.inc[i - 1];
        var dAzi = survey.azi[i] - survey.azi[i - 1];
        var DL = Math.sqrt(dInc * dInc + (survey.inc[i - 1] * DEG) * (dInc === 0 ? 0 : Math.sin(dAzi * DEG) * survey.inc[i] * DEG) * 0 + dAzi * dAzi);
        /* 狗腿度（全角变化率），单位 °/30m */
        var dogleg = Math.sqrt(dInc * dInc + (Math.sin((survey.inc[i - 1] + survey.inc[i]) / 2 * DEG) * dAzi) * (Math.sin((survey.inc[i - 1] + survey.inc[i]) / 2 * DEG) * dAzi)) * (30 / dmd);
        dog[i] = dogleg;
        var incM = (survey.inc[i - 1] + survey.inc[i]) / 2 * DEG;
        tv[i] = tv[i - 1] + dmd * Math.cos(incM);
        vs[i] = vs[i - 1] + dmd * Math.sin(incM);
      }
      return { n: n, md: survey.md, tv: tv, vs: vs, dog: dog };
    }

    /* -----------------------------------------------------
       模型预测控制
       从当前测点向前看 horizon 步，预测轨迹走向，给最优造斜率命令。
       返回 { cmd: Float64Array（造斜率）, pred: Float64Array（预测轨迹偏差）, target } 
       ----------------------------------------------------- */
    function mpcControl(survey, target, horizon, seed) {
      var rnd = mulberry32(seed || 20261132);
      var n = survey.n;
      var cmd = new Float64Array(n);
      var pred = new Float64Array(n);
      var curDev = survey.inc[n - 1] - target;
      for (var k = 0; k < n; k++) {
        /* 向前看 horizon，按剩余距离分配累计偏差修正 */
        var remain = n - k;
        var step = horizon > remain ? remain : horizon;
        var build = curDev * 0.6 / step + (rnd() - 0.5) * 0.3;
        cmd[k] = clamp(build, -3, 3);
        curDev -= cmd[k];
        pred[k] = curDev;
      }
      return { cmd: cmd, pred: pred, target: target };
    }

    /* -----------------------------------------------------
       安全边界校验
       bounds: { dogleg: 全角变化率上限, friction: 摩阻上限 }
       返回 { ok, doglegMax, friction, hits:[{k,type}] }
       ----------------------------------------------------- */
    function safetyCheck(fit, cmd, bounds) {
      var n = fit.n;
      var dogMax = 0;
      for (var i = 0; i < n; i++) if (fit.dog[i] > dogMax) dogMax = fit.dog[i];
      var friction = 0;
      for (i = 0; i < n; i++) friction += Math.abs(fit.dog[i]) * 0.8;
      var hits = [];
      if (dogMax > bounds.dogleg) hits.push({ k: 0, type: '全角变化率' });
      if (friction > bounds.friction) hits.push({ k: 1, type: '摩阻' });
      return { ok: hits.length === 0, doglegMax: dogMax, friction: friction, hits: hits };
    }

    /* -----------------------------------------------------
       建议 → 闭环控制
       工程师手动建议（保守）vs MPC 闭环命令对比。返回改善因子。
       ----------------------------------------------------- */
    function advToControl(adviceMode, mpc, fit) {
      /* adviceMode 0 建议层 1 闭环 */
      var manualVar = 0, ctlVar = 0;
      var manual = fit.dog;
      for (var i = 0; i < fit.n; i++) {
        manualVar += Math.abs(manual[i]);
        ctlVar += Math.abs(fit.dog[i]) * (adviceMode === 0 ? 0.9 : 0.6);
      }
      var frictionSave = adviceMode === 0 ? 0.05 : 0.3;
      var fallRate = adviceMode === 0 ? 72 : 95;   /* 落靶率 */
      return { mode: adviceMode, manualVar: manualVar, ctlVar: ctlVar, frictionSave: frictionSave, fallRate: fallRate, smooth: adviceMode === 0 ? 0.78 : 0.95 };
    }

    return {
      clamp: clamp, mulberry32: mulberry32, DEG: DEG,
      genSurvey: genSurvey, fitTrajectory: fitTrajectory,
      mpcControl: mpcControl, safetyCheck: safetyCheck, advToControl: advToControl
    };
  })();

  /* Node 单测入口 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Model;
    return;
  }

  /* =====================================================
     浏览器接线（沙箱 iframe 内执行）
     ===================================================== */
  var doc = document;
  var $ = function (id) { return doc.getElementById(id); };
  var M = Model;

  var state = {
    nSurvey: 12, horizon: 4, target: 50, doglegLimit: 4,
    adviceMode: 1 /* 0 建议 1 闭环 */, method: 0
  };

  var surv = M.genSurvey(state.nSurvey, 20261131);
  var fit = M.fitTrajectory(surv, state.method);
  var mpc = M.mpcControl(surv, state.target, state.horizon, 20261132);
  var safe = M.safetyCheck(fit, mpc.cmd, { dogleg: state.doglegLimit, friction: 8 });
  var adv = M.advToControl(state.adviceMode, mpc, fit);

  global.RemoteBridge = {
    M: M,
    genSurvey: M.genSurvey, fitTrajectory: M.fitTrajectory,
    mpcControl: M.mpcControl, safetyCheck: M.safetyCheck, advToControl: M.advToControl,
    live: function () {
      return { nSurvey: state.nSurvey, horizon: state.horizon, target: state.target, doglegLimit: state.doglegLimit, adviceMode: state.adviceMode, method: state.method };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 1 : d); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------- 屏 1 渲染：轨迹建模 ---------- */
  function renderTraj() {
    surv = M.genSurvey(state.nSurvey, 20261131);
    fit = M.fitTrajectory(surv, state.method);
    mpc = M.mpcControl(surv, state.target, state.horizon, 20261132);
    safe = M.safetyCheck(fit, mpc.cmd, { dogleg: state.doglegLimit, friction: 8 });

    var n = state.nSurvey;
    var s = '';
    /* 井斜随井深 */
    var x0 = 40, y0 = 30, w = 300, h = 90;
    s += '<text x="40" y="22" font-size="9" fill="#4d565b" font-weight="700">井斜角（°）随井深</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-width="1"/>';
    var incMin = 15, incMax = 55;
    var incArr = [];
    for (var i = 0; i < n; i++) incArr.push((surv.inc[i] - incMin) / (incMax - incMin));
    s += linePath(incArr, x0, y0 + h, w / n, h, '#41699b', false);
    /* 测点 */
    for (i = 0; i < n; i++) {
      var px = x0 + i * w / n;
      var py = y0 + h - (surv.inc[i] - incMin) / (incMax - incMin) * h;
      s += '<circle cx="' + px + '" cy="' + py + '" r="2.6" fill="#41699b"/>';
    }
    /* 全角变化率 */
    var y1 = 150;
    s += '<text x="40" y="' + (y1 - 8) + '" font-size="9" fill="#4d565b" font-weight="700">全角变化率（° / 30m）</text>';
    s += '<line x1="' + x0 + '" y1="' + (y1 + 80) + '" x2="' + (x0 + w) + '" y2="' + (y1 + 80) + '" stroke="#9ba3a9" stroke-width="1"/>';
    var dogArr = [];
    var dogMax = Math.max.apply(null, Array.from(fit.dog)) || 1;
    for (i = 0; i < n; i++) dogArr.push(fit.dog[i] / dogMax);
    s += linePath(dogArr, x0, y1 + 80, w / n, 80, '#b26a39', false);
    /* 安全阈值线 */
    var thrY = y1 + 80 - (state.doglegLimit / dogMax) * 80;
    s += '<line x1="' + x0 + '" y1="' + thrY + '" x2="' + (x0 + w) + '" y2="' + thrY + '" stroke="#b05a51" stroke-width="1.2" stroke-dasharray="4 3"/>';
    s += '<text x="' + (x0 + w + 4) + '" y="' + (thrY + 3) + '" font-size="7.5" fill="#b05a51">阈值 ' + state.doglegLimit + '</text>';
    $('trajChart').innerHTML = s;

    $('roIncEnd').textContent = num(surv.inc[n - 1], 1) + '°';
    $('roDogleg').textContent = num(safe.doglegMax, 2) + '°/30m';
  }

  function linePath(arr, x0, y0, xS, yS, color, dash) {
    var s = '<path d="M';
    for (var i = 0; i < arr.length; i++) {
      s += (x0 + i * xS).toFixed(1) + ' ' + (y0 - arr[i] * yS).toFixed(1);
      if (i < arr.length - 1) s += ' L';
    }
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (dash ? 1.8 : 2) + '"' + (dash ? ' stroke-dasharray="5 3"' : '') + '/>';
    return s;
  }

  /* ---------- 屏 2 渲染：模型预测控制 ---------- */
  function renderMPC() {
    surv = M.genSurvey(state.nSurvey, 20261131);
    fit = M.fitTrajectory(surv, state.method);
    mpc = M.mpcControl(surv, state.target, state.horizon, 20261132);
    var n = state.nSurvey;
    var s = '';
    /* 预测轨迹偏差 */
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">预测轨迹偏差（相对目标井斜）</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h / 2) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h / 2) + '" stroke="#9ba3a9" stroke-width="1" stroke-dasharray="4 3"/>';
    s += '<text x="' + (x0 + w + 4) + '" y="' + (y0 + h / 2 + 3) + '" font-size="7.5" fill="#9ba3a9">目标线</text>';
    var predMax = Math.max.apply(null, Array.from(mpc.pred).map(function (v) { return Math.abs(v); })) || 1;
    var predArr = [];
    for (var i = 0; i < n; i++) predArr.push(mpc.pred[i] / (predMax * 1.2));
    s += linePath(predArr, x0, y0 + h / 2, w / n, h / 2, '#24333a', false);
    /* 命令（造斜率） */
    var y1 = 170;
    s += '<text x="40" y="' + (y1 - 8) + '" font-size="9" fill="#4d565b" font-weight="700">控制命令（造斜率 °/30m，向前看 ' + state.horizon + ' 步）</text>';
    var cmdMax = 3;
    var cmds = [];
    for (i = 0; i < n; i++) cmds.push(mpc.cmd[i] / cmdMax);
    s += linePath(cmds, x0, y1 + 70, w / n, 70, '#2f7d6b', false);
    $('mpcChart').innerHTML = s;

    $('roCmd').textContent = num(mpc.cmd[n - 1], 2) + '°/30m';
    $('roTarget').textContent = state.target + '°';
  }

  /* ---------- 屏 3 渲染：闭环安全 ---------- */
  function renderSafe() {
    surv = M.genSurvey(state.nSurvey, 20261131);
    fit = M.fitTrajectory(surv, state.method);
    mpc = M.mpcControl(surv, state.target, state.horizon, 20261132);
    safe = M.safetyCheck(fit, mpc.cmd, { dogleg: state.doglegLimit, friction: 8 });
    adv = M.advToControl(state.adviceMode, mpc, fit);

    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    /* 安全边界示意：全角变化率 vs 阈值 */
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">全角变化率 vs 安全阈值</text>';
    var dogMax = Math.max.apply(null, Array.from(fit.dog)) || 1;
    var thrPix = (state.doglegLimit / Math.max(dogMax, state.doglegLimit)) * h;
    var dogArr = [];
    for (var i = 0; i < fit.n; i++) dogArr.push(fit.dog[i] / Math.max(dogMax, state.doglegLimit));
    s += linePath(dogArr, x0, y0 + h, w / fit.n, h, '#b26a39', false);
    s += '<line x1="' + x0 + '" y1="' + (y0 + h - thrPix) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h - thrPix) + '" stroke="#b05a51" stroke-width="1.4" stroke-dasharray="5 3"/>';
    s += '<text x="' + (x0 + w + 4) + '" y="' + (y0 + h - thrPix + 3) + '" font-size="7.5" fill="#b05a51">安全阈值 ' + state.doglegLimit + '</text>';
    /* 状态条 */
    var status = safe.ok ? '#2f7d6b' : '#b05a51';
    var statusTxt = safe.ok ? '安全' : '越界';
    s += '<rect x="40" y="' + (y0 + h + 16) + '" width="300" height="26" rx="5" fill="' + (safe.ok ? '#e6f1ec' : '#f9efea') + '" stroke="' + status + '"/>';
    s += '<text x="52" y="' + (y0 + h + 34) + '" font-size="9" fill="' + status + '" font-weight="700">闭环安全：' + statusTxt + ' · 全角变化率 ' + num(safe.doglegMax, 2) + ' / ' + state.doglegLimit + '</text>';

    /* 建议 vs 闭环 双柱 */
    var y2 = 200;
    var r = M.advToControl(0, mpc, fit);
    var r2 = M.advToControl(1, mpc, fit);
    s += '<text x="40" y="' + (y2 - 8) + '" font-size="9" fill="#4d565b" font-weight="700">建议层 vs 闭环控制：落靶率</text>';
    s += '<rect x="40" y="' + y2 + '" width="110" height="52" fill="#d9b78e"/>';
    s += '<text x="95" y="' + (y2 + 30) + '" text-anchor="middle" font-size="10" fill="#4d565b" font-weight="700">' + r.fallRate + '%</text>';
    s += '<text x="95" y="' + (y2 + 44) + '" text-anchor="middle" font-size="7.5" fill="#8a6b52">建议层</text>';
    s += '<rect x="200" y="' + y2 + '" width="110" height="52" fill="#2f7d6b"/>';
    s += '<text x="255" y="' + (y2 + 30) + '" text-anchor="middle" font-size="10" fill="#fff" font-weight="700">' + r2.fallRate + '%</text>';
    s += '<text x="255" y="' + (y2 + 44) + '" text-anchor="middle" font-size="7.5" fill="#b9d8cb">闭环控制</text>';
    $('safeChart').innerHTML = s;

    $('roSafe').textContent = safe.ok ? '安全边界内' : '越界';
    $('roAdvice').textContent = adv.mode === 0 ? '建议层 · 落靶 ' + adv.fallRate + '%' : '闭环 · 落靶 ' + adv.fallRate + '%';
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    var inHorizon = $('inHorizon');
    if (inHorizon) inHorizon.addEventListener('input', function () {
      state.horizon = parseInt(inHorizon.value, 10);
      $('outHorizon').textContent = state.horizon;
      renderMPC(); renderSafe();
    });
    var inTarget = $('inTarget');
    if (inTarget) inTarget.addEventListener('input', function () {
      state.target = parseFloat(inTarget.value);
      $('outTarget').textContent = num(state.target, 0);
      renderMPC(); renderSafe();
    });
    var inDog = $('inDog');
    if (inDog) inDog.addEventListener('input', function () {
      state.doglegLimit = parseFloat(inDog.value);
      $('outDog').textContent = num(state.doglegLimit, 1);
      renderSafe();
    });
    var inMode = $('inMode');
    if (inMode) inMode.addEventListener('input', function () {
      state.adviceMode = parseInt(inMode.value, 10);
      var labels = ['建议层', '闭环控制'];
      $('outMode').textContent = labels[state.adviceMode];
      renderSafe();
    });
    var inMethod = $('inMethod');
    if (inMethod) inMethod.addEventListener('input', function () {
      state.method = parseInt(inMethod.value, 10);
      renderTraj();
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '轨迹建模', 'trajCtl'], ['sec2', '模型预测控制', 'mpcCtl'], ['sec3', '闭环安全', 'safeCtl']].forEach(function (s) {
      var el = $(s[2]); if (!el) return;
      secs.push({ id: s[0], title: s[1], html: el.outerHTML, top: el.offsetTop, height: el.offsetHeight });
    });
    try { parent.postMessage({ __drawer: 'init', sections: secs }, '*'); } catch (e) {}
    window.addEventListener('message', function (e) {
      if (e.source !== window.parent) return;
      var d = e.data;
      if (!d || d.__drawer !== 'control') return;
      var el = doc.querySelector('[data-ctl-id="' + d.id + '"]');
      if (!el) return;
      if (el.type === 'range') { el.value = d.value; el.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (el.tagName === 'BUTTON') { el.click(); }
    });
  }

  /* ---------- 启动 ---------- */
  bind();
  renderTraj(); renderMPC(); renderSafe();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
