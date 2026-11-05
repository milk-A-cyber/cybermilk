/* =========================================================
   钻速预测与参数优化 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  钻速时序预测：随钻参数 → 钻速（时序回归）
   屏 2  贝叶斯优化：参数空间（钻压×转速）找最优，兼顾风险
   屏 3  保守 vs 最优参数：钻速对比 + 风险可控
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

    var PARAM_NAMES = ['钻压', '转速', '扭矩', '排量'];

    /* -----------------------------------------------------
       合成钻时序列
       若干地层分段（每段可钻性不同），随钻参数 + 钻速随时间变化。
       返回 { n, depth, wob(钻压), rpm(转速), tor(扭矩), dis(排量), rop(真值钻速) }
       ----------------------------------------------------- */
    function genDrill(n, seed) {
      var rnd = mulberry32(seed || 20261131);
      var depth = [], wob = [], rpm = [], tor = [], dis = [], rop = [];
      var segs = [];
      var ns = 3 + Math.floor(rnd() * 3);
      for (var i = 0; i < ns; i++) {
        segs.push({ s: Math.floor(rnd() * n), dur: 0.2 + rnd() * 0.4, r: 0.4 + rnd() * 0.8 });
      }
      var lastRop = 8;
      for (var t = 0; t < n; t++) {
        depth.push(t);
        var drift = 0;
        for (var s = 0; s < segs.length; s++) {
          var d = Math.abs(t - segs[s].s) / (segs[s].dur * n);
          if (d < 1) drift += Math.sin(d * Math.PI) * segs[s].r;
        }
        var base = 10 + drift * 5 + Math.sin(t * 0.05) * 1.2;
        wob.push(clamp(8 + (rnd() - 0.4) * 3 + Math.sin(t * 0.02) * 1.5, 5, 14));
        rpm.push(clamp(50 + (rnd() - 0.4) * 12 + Math.cos(t * 0.03) * 6, 35, 75));
        tor.push(clamp(2 + (rnd() - 0.5) * 0.8 + Math.abs(Math.sin(t * 0.04)) * 0.6, 1, 4));
        dis.push(clamp(20 + (rnd() - 0.5) * 3, 15, 26));
        var ropNow = clamp(base + (wob[t] - 10) * 0.4 + (rpm[t] - 55) * 0.12 + (rnd() - 0.5) * 1.5, 4, 20);
        /* 平滑过渡 */
        ropNow = lastRop * 0.3 + ropNow * 0.7;
        lastRop = ropNow;
        rop.push(ropNow);
      }
      return { n: n, depth: depth, wob: wob, rpm: rpm, tor: tor, dis: dis, rop: rop };
    }

    /* -----------------------------------------------------
       钻速时序预测（模拟时序回归）
       weight ∈ [0,1]：越接近 1 预测越贴近真值。
       ----------------------------------------------------- */
    function ropPredict(seq, weight) {
      var n = seq.n;
      var pred = new Float64Array(n);
      var rnd = mulberry32(20261132);
      for (var t = 0; t < n; t++) {
        var trueRop = seq.rop[t];
        var noise = (1 - weight) * 1.6 * (rnd() + rnd() - 1);
        pred[t] = clamp(trueRop + noise, 2, 22);
      }
      return { pred: pred };
    }

    function ropEval(seq, pred) {
      var n = seq.n;
      var se = 0;
      for (var i = 0; i < n; i++) se += (seq.rop[i] - pred[i]) * (seq.rop[i] - pred[i]);
      var rmse = Math.sqrt(se / n);
      var mp = 0, mq = 0;
      for (var j = 0; j < n; j++) { mp += seq.rop[j]; mq += pred[j]; }
      mp /= n; mq /= n;
      var cov = 0, vp = 0, vq = 0;
      for (var k = 0; k < n; k++) { cov += (seq.rop[k] - mp) * (pred[k] - mq); vp += (seq.rop[k] - mp) * (seq.rop[k] - mp); vq += (pred[k] - mq) * (pred[k] - mq); }
      var corr = cov / (Math.sqrt(vp) * Math.sqrt(vq) + 1e-9);
      return { rmse: rmse, corr: corr };
    }

    /* -----------------------------------------------------
       钻速代理模型：rop = 函数(钻压, 转速)
       中间有最优区，边缘有高风险区（钻头磨损）。
       ----------------------------------------------------- */
    function ropModel(wob, rpm) {
      var wobN = clamp((wob - 5) / 9, 0, 1);   /* 0..1 */
      var rpmN = clamp((rpm - 35) / 40, 0, 1); /* 0..1 */
      var peak = 18 * Math.exp(-((wobN - 0.55) * (wobN - 0.55)) / 0.08 - ((rpmN - 0.6) * (rpmN - 0.6)) / 0.1);
      var base = 6 + wobN * 4 + rpmN * 3;
      var risk = 0;
      /* 高风险区：钻压过大或转速过高 */
      if (wobN > 0.85) risk += 3 + (wobN - 0.85) * 12;
      if (rpmN > 0.85) risk += 2 + (rpmN - 0.85) * 8;
      var rop = clamp(base + peak - risk * 0.6, 0, 22);
      return { rop: rop, risk: risk };
    }

    /* -----------------------------------------------------
       贝叶斯优化（模拟）
       nIter 轮采样，找最优（钻压,转速）。返回最优与轨迹。
       ----------------------------------------------------- */
    function bayesOptimize(nIter, seed) {
      var rnd = mulberry32(seed || 20261133);
      var best = null;
      var trace = [];
      var wob = 9, rpm = 55;
      for (var i = 0; i < nIter; i++) {
        /* 探索：围绕当前最优点加扰动 */
        wob = clamp(wob + (rnd() - 0.5) * 2.4, 5, 14);
        rpm = clamp(rpm + (rnd() - 0.5) * 18, 35, 75);
        var r = ropModel(wob, rpm);
        if (!best || (r.rop - r.risk * 0.4) > best.score) {
          best = { wob: wob, rpm: rpm, rop: r.rop, risk: r.risk, score: r.rop - r.risk * 0.4 };
        }
        trace.push({ i: i, wob: wob, rpm: rpm, rop: r.rop, risk: r.risk });
      }
      return { best: best, trace: trace };
    }

    /* 保守参数 */
    function conservativeParams() {
      return { wob: 8.2, rpm: 48, label: '保守' };
    }

    return {
      clamp: clamp, mulberry32: mulberry32, PARAM_NAMES: PARAM_NAMES,
      genDrill: genDrill, ropPredict: ropPredict, ropEval: ropEval,
      ropModel: ropModel, bayesOptimize: bayesOptimize, conservativeParams: conservativeParams
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
    weight: 0.7, nIter: 24, nWell: 40,
    selPar: 0 /* 0 钻压 1 转速 2 扭矩 3 排量 */, segA: 0, segB: 1
  };

  var seq1 = M.genDrill(60, 20261131);
  var pred1 = M.ropPredict(seq1, state.weight);

  global.RemoteBridge = {
    M: M,
    genDrill: M.genDrill, ropPredict: M.ropPredict, ropEval: M.ropEval,
    ropModel: M.ropModel, bayesOptimize: M.bayesOptimize, conservativeParams: M.conservativeParams,
    live: function () {
      return { weight: state.weight, nIter: state.nIter, nWell: state.nWell, selPar: state.selPar, segA: state.segA, segB: state.segB };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 1 : d); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* 折线图辅助 */
  function linePath(arr, x0, y0, xScale, yScale, yMax, color, dash) {
    var s = '<path d="M';
    for (var i = 0; i < arr.length; i++) {
      s += (x0 + i * xScale).toFixed(1) + ' ' + (y0 - arr[i] * yScale).toFixed(1);
      if (i < arr.length - 1) s += ' L';
    }
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (dash ? 1.8 : 2) + '"' + (dash ? ' stroke-dasharray="5 3"' : '') + '/>';
    return s;
  }

  /* ---------- 屏 1 渲染：钻速时序预测 ---------- */
  function renderPred() {
    seq1 = M.genDrill(60, 20261131);
    pred1 = M.ropPredict(seq1, state.weight);
    var ev = M.ropEval(seq1, pred1);
    var n = seq1.n;
    var H = 240, W = 360, x0 = 50, y0 = 18;
    var xS = W / n, yS = 210 / 22;
    var s = '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x0 + '" y2="' + (y0 + H) + '" stroke="#9ba3a9" stroke-width="1"/>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + H) + '" x2="' + (x0 + W) + '" y2="' + (y0 + H) + '" stroke="#9ba3a9" stroke-width="1"/>';
    s += '<text x="' + (x0 + 10) + '" y="' + (y0 + 12) + '" font-size="9" fill="#79828a">钻速 m/h</text>';
    s += '<text x="' + (x0 + W - 40) + '" y="' + (y0 + H + 16) + '" font-size="9" fill="#79828a">时间（采样点）</text>';
    s += linePath(seq1.rop, x0, y0 + H, xS, yS, 22, '#2f7d6b', false);
    s += linePath(pred1.pred, x0, y0 + H, xS, yS, 22, '#b26a39', true);
    s += '<text x="' + (x0 + W + 10) + '" y="' + (y0 + 20) + '" font-size="9" fill="#2f7d6b" font-weight="700">真实钻速</text>';
    s += '<text x="' + (x0 + W + 10) + '" y="' + (y0 + 36) + '" font-size="9" fill="#b26a39" font-weight="700">预测钻速</text>';
    $('ropChart').innerHTML = s;
    $('roRmse').textContent = 'RMSE ' + num(ev.rmse, 2) + ' m/h';
    $('roCorr').textContent = '相关系数 ' + num(ev.corr, 2);
    /* 参数曲线（切换显示） */
    var par = [seq1.wob, seq1.rpm, seq1.tor, seq1.dis];
    var parName = M.PARAM_NAMES[state.selPar];
    var parMin = [5, 35, 1, 15], parMax = [14, 75, 4, 26];
    var pH = 120, pW = 300, px0 = 50, py0 = 300;
    var pS = 100 / (parMax[state.selPar] - parMin[state.selPar]);
    var ps = '<line x1="' + px0 + '" y1="' + py0 + '" x2="' + (px0 + pW) + '" y2="' + py0 + '" stroke="#9ba3a9" stroke-width="1"/>';
    ps += '<text x="' + px0 + '" y="' + (py0 + 14) + '" font-size="9" fill="#79828a">' + parName + ' 随时间</text>';
    ps += linePath(par[state.selPar], px0, py0, pW / n, pS, 1, '#41699b', false);
    $('parChart').innerHTML = ps;
  }

  /* ---------- 屏 2 渲染：贝叶斯优化 ---------- */
  function renderOpt() {
    /* 参数空间热力图 */
    var W = 44, H = 34, cell = 6;
    var wobMin = 5, wobMax = 14, rpmMin = 35, rpmMax = 75;
    var s = '';
    var maxRop = 0;
    var grid = [];
    for (var r = 0; r < H; r++) { grid[r] = []; for (var c = 0; c < W; c++) {
      var wob = wobMin + (c / (W - 1)) * (wobMax - wobMin);
      var rpm = rpmMin + (r / (H - 1)) * (rpmMax - rpmMin);
      var m = M.ropModel(wob, rpm);
      grid[r][c] = m.rop;
      if (m.rop > maxRop) maxRop = m.rop;
    }}
    for (r = 0; r < H; r++) for (c = 0; c < W; c++) {
      var v = grid[r][c] / (maxRop || 1);
      var g = Math.round(90 + 150 * v);
      var risk = M.ropModel(wobMin + (c / (W - 1)) * 9, rpmMin + (r / (H - 1)) * 40).risk;
      var col;
      if (risk > 4) col = 'rgb(180,96,86)';
      else col = 'rgb(' + Math.round(230 - v * 130) + ',' + g + ',' + Math.round(230 - v * 120) + ')';
      s += '<rect x="' + (c * cell) + '" y="' + (r * cell) + '" width="' + cell + '" height="' + cell + '" fill="' + col + '"/>';
    }
    /* 贝叶斯优化轨迹 */
    var opt = M.bayesOptimize(state.nIter, 20261133);
    for (var i = 0; i < opt.trace.length; i++) {
      var t = opt.trace[i];
      var cx = ((t.wob - wobMin) / 9) * (W * cell);
      var cy = ((t.rpm - rpmMin) / 40) * (H * cell);
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="2" fill="none" stroke="#24333a" stroke-width="1"/>';
    }
    var b = opt.best;
    var bxc = ((b.wob - wobMin) / 9) * (W * cell);
    var byc = ((b.rpm - rpmMin) / 40) * (H * cell);
    s += '<circle cx="' + bxc + '" cy="' + byc + '" r="4" fill="#24333a" stroke="#fff" stroke-width="1.5"/>';
    s += '<text x="' + bxc + '" y="' + (byc - 6) + '" font-size="8" fill="#24333a" text-anchor="middle" font-weight="700">最优</text>';
    $('optChart').innerHTML = s;
    $('roBest').textContent = '最优：钻压 ' + num(b.wob, 1) + ' · 转速 ' + num(b.rpm, 0) + ' → 钻速 ' + num(b.rop, 1) + ' m/h';
    $('roRisk').textContent = '风险 ' + num(b.risk, 1) + '（' + (b.risk < 2 ? '低' : b.risk < 5 ? '中' : '高') + '）';
    $('roIter').textContent = '迭代 ' + opt.trace.length + ' 轮';
  }

  /* ---------- 屏 3 渲染：保守 vs 最优 ---------- */
  function renderCompare() {
    var opt = M.bayesOptimize(40, 20261133);
    var b = opt.best;
    var cons = M.conservativeParams();
    var ropCons = M.ropModel(cons.wob, cons.rpm);
    var ropOpt = M.ropModel(b.wob, b.rpm);
    var lift = ropOpt.rop / (ropCons.rop || 1) - 1;

    var s = '';
    /* 参数条对比 */
    var rows = [
      ['钻压 kN', cons.wob, b.wob, 5, 14],
      ['转速 rpm', cons.rpm, b.rpm, 35, 75]
    ];
    var y = 20;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      s += '<text x="30" y="' + (y + 14) + '" font-size="9" fill="#4d565b" font-weight="700">' + r[0] + '</text>';
      var x0 = 130, w = 220;
      var span = r[4] - r[3];
      var c0 = x0 + ((r[1] - r[3]) / span) * w;
      var c1 = x0 + ((r[2] - r[3]) / span) * w;
      s += '<line x1="' + x0 + '" y1="' + (y + 10) + '" x2="' + (x0 + w) + '" y2="' + (y + 10) + '" stroke="#e9e4d8" stroke-width="6"/>';
      s += '<circle cx="' + c0 + '" cy="' + (y + 10) + '" r="6" fill="#41699b"/><text x="' + (c0) + '" y="' + (y - 2) + '" font-size="8" fill="#41699b" text-anchor="middle">保守</text>';
      s += '<circle cx="' + c1 + '" cy="' + (y + 10) + '" r="6" fill="#2f7d6b"/><text x="' + (c1) + '" y="' + (y + 28) + '" font-size="8" fill="#2f7d6b" text-anchor="middle">最优</text>';
      y += 60;
    }
    /* 钻速对比柱 */
    var x0 = 40, y0 = 160, cw = 120, ch = 150;
    var maxRop = Math.max(ropCons.rop, ropOpt.rop, 1);
    var hCons = ropCons.rop / maxRop * ch;
    var hOpt = ropOpt.rop / maxRop * ch;
    s += '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x0 + '" y2="' + (y0 + ch) + '" stroke="#9ba3a9" stroke-width="1"/>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + ch) + '" x2="' + (x0 + 340) + '" y2="' + (y0 + ch) + '" stroke="#9ba3a9" stroke-width="1"/>';
    s += '<rect x="' + (x0 + 20) + '" y="' + (y0 + ch - hCons) + '" width="100" height="' + hCons + '" fill="#41699b"/>';
    s += '<text x="' + (x0 + 70) + '" y="' + (y0 + ch - hCons - 6) + '" font-size="10" fill="#41699b" text-anchor="middle" font-weight="700">' + num(ropCons.rop, 1) + '</text>';
    s += '<text x="' + (x0 + 70) + '" y="' + (y0 + ch + 16) + '" font-size="9" fill="#41699b" text-anchor="middle">保守参数</text>';
    s += '<rect x="' + (x0 + 190) + '" y="' + (y0 + ch - hOpt) + '" width="100" height="' + hOpt + '" fill="#2f7d6b"/>';
    s += '<text x="' + (x0 + 240) + '" y="' + (y0 + ch - hOpt - 6) + '" font-size="10" fill="#2f7d6b" text-anchor="middle" font-weight="700">' + num(ropOpt.rop, 1) + '</text>';
    s += '<text x="' + (x0 + 240) + '" y="' + (y0 + ch + 16) + '" font-size="9" fill="#2f7d6b" text-anchor="middle">最优参数</text>';
    s += '<text x="' + (x0 + 300) + '" y="' + (y0 + 40) + '" font-size="12" fill="#b26a39" font-weight="700">+' + Math.round(lift * 100) + '%</text>';
    $('cmpChart').innerHTML = s;
    $('roLift').textContent = '钻速提升 ' + Math.round(lift * 100) + '%';
    $('roRiskCmp').textContent = '风险：保守 ' + num(ropCons.risk, 1) + ' vs 最优 ' + num(ropOpt.risk, 1) + '（' + (ropOpt.risk <= ropCons.risk + 1 ? '风险可控' : '风险上升') + '）';
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    var inWeight = $('inWeight');
    if (inWeight) inWeight.addEventListener('input', function () {
      state.weight = parseFloat(inWeight.value);
      $('outWeight').textContent = num(state.weight, 2);
      renderPred();
    });
    var inIter = $('inIter');
    if (inIter) inIter.addEventListener('input', function () {
      state.nIter = parseInt(inIter.value, 10);
      $('outIter').textContent = String(state.nIter);
      renderOpt();
    });
    var inPar = $('inPar');
    if (inPar) inPar.addEventListener('input', function () {
      state.selPar = parseInt(inPar.value, 10);
      $('outPar').textContent = M.PARAM_NAMES[state.selPar];
      renderPred();
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '钻速预测', 'predCtl'], ['sec2', '参数优化', 'optCtl'], ['sec3', '参数对比', 'cmpCtl']].forEach(function (s) {
      var el = $(s[2]); if (!el) return;
      el.querySelectorAll('input, button').forEach(function (c) {
        if (c.type === 'range') c.setAttribute('value', c.value);
      });
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
  renderPred(); renderOpt(); renderCompare();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
