/* =========================================================
   钻具失效预测 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  疲劳累积：振动/扭矩 → 物理损伤
   屏 2  剩余寿命预测：损伤特征 → RUL 混合预测
   屏 3  起钻建议：失效窗口 + 起钻检查回流
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

    var MODES = ['正常', '振动', '冲击'];

    /* -----------------------------------------------------
       合成振动/扭矩时序
       n 采样点，含工况段（mode）。返回 { n, vib:[], tor:[], mode:[] }
       ----------------------------------------------------- */
    function genVibration(n, seed) {
      var rnd = mulberry32(seed || 20261141);
      var vib = new Float64Array(n), tor = new Float64Array(n), mode = new Int8Array(n);
      for (var i = 0; i < n; i++) {
        /* 工况按段切换 */
        var m;
        if (i < n * 0.3) m = 0; else if (i < n * 0.55) m = 1; else if (i < n * 0.75) m = 2; else m = 1;
        mode[i] = m;
        var vibBase = m === 0 ? 0.15 : m === 1 ? 0.4 : 0.8;
        var vibAmp = m === 0 ? 0.08 : m === 1 ? 0.15 : 0.25;
        vib[i] = clamp(vibBase + Math.sin(i * 0.08) * vibAmp * 0.6 + (rnd() - 0.5) * vibAmp * 2, 0, 1.4);
        tor[i] = clamp(8 + Math.sin(i * 0.05) * 1.5 + (rnd() - 0.5) * 1.2, 3, 15);
      }
      return { n: n, vib: vib, tor: tor, mode: mode };
    }

    /* -----------------------------------------------------
       疲劳累积（Miner 线性损伤）
       从振动幅值累加损伤。返回 { damage: Float64Array(0→1), cum, failPoint }
       ----------------------------------------------------- */
    function fatigueAccum(vib, n, scale) {
      var damage = new Float64Array(n);
      var cum = 0;
      var failPoint = -1;
      for (var i = 0; i < n; i++) {
        var amp = vib[i];
        /* 损伤速率 ∝ 幅值^2，越接近失效越快 */
        var rate = (amp * amp) * (0.005 + cum * 0.08) * (scale || 1);
        cum += rate;
        cum = Math.min(cum, 1.1);
        damage[i] = cum;
        if (failPoint < 0 && cum >= 1) failPoint = i;
      }
      return { damage: damage, cum: cum, failPoint: failPoint };
    }

    /* -----------------------------------------------------
       剩余寿命预测（混合建模）
       mode 0 纯时序 1 纯物理 2 混合。返回 { rul: Float64Array, err, method }
       ----------------------------------------------------- */
    function rulPredict(damage, mode, n, scale) {
      var rul = new Float64Array(n);
      var err = 0;
      for (var i = 0; i < n; i++) {
        var d = damage[i];
        /* 真实剩余寿命 = 1 - d */
        var trueRul = Math.max(0, (1 - d)) * (scale || 100);
        var predRul;
        if (mode === 0) {
          /* 纯时序：只看当前损伤增量，无物理约束，漂移 */
          var slope = i > 0 ? Math.max(0, d - damage[Math.max(0, i - 1)]) : 0.002;
          predRul = (1 - d) / (slope + 0.005) * (scale || 100) * 0.7;
        } else if (mode === 1) {
          /* 纯物理：Miner 线性，误差来自忽略工况细节 */
          predRul = trueRul * 0.85 + Math.sin(i * 0.1) * 4;
        } else {
          /* 混合：物理先验 + 时序修正，最准 */
          predRul = trueRul * 0.96 + Math.cos(i * 0.05) * 1.5;
        }
        predRul = Math.max(0, predRul);
        rul[i] = predRul;
        err += Math.abs(predRul - trueRul) / (n * (scale || 100));
      }
      return { rul: rul, err: err, method: mode };
    }

    /* -----------------------------------------------------
       起钻建议
       rul 末端剩余寿命，thr 起钻阈值。返回 { advice, remaining, suggest }
       ----------------------------------------------------- */
    function tripAdvice(rul, thr, scale) {
      var remaining = rul[rul.length - 1];
      var suggest = remaining < thr;
      return { advice: suggest ? '建议起钻' : '可继续钻进', remaining: remaining, thr: thr, suggest: suggest };
    }

    return {
      clamp: clamp, mulberry32: mulberry32, MODES: MODES,
      genVibration: genVibration, fatigueAccum: fatigueAccum,
      rulPredict: rulPredict, tripAdvice: tripAdvice
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
    nData: 120, mode: 2 /* 混合建模 */, tripThr: 15
  };

  var N = 120;
  var vib = M.genVibration(N, 20261141);
  var fat = M.fatigueAccum(vib.vib, N, 1);
  var rul = M.rulPredict(fat.damage, state.mode, N, 100);
  var trip = M.tripAdvice(rul.rul, state.tripThr, 100);

  global.RemoteBridge = {
    M: M,
    genVibration: M.genVibration, fatigueAccum: M.fatigueAccum,
    rulPredict: M.rulPredict, tripAdvice: M.tripAdvice,
    live: function () {
      return { nData: state.nData, mode: state.mode, tripThr: state.tripThr };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 1 : d); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function linePath(arr, x0, y0, xS, yS, color, dash) {
    var s = '<path d="M';
    for (var i = 0; i < arr.length; i++) {
      s += (x0 + i * xS).toFixed(1) + ' ' + (y0 - arr[i] * yS).toFixed(1);
      if (i < arr.length - 1) s += ' L';
    }
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (dash ? 1.8 : 2) + '"' + (dash ? ' stroke-dasharray="5 3"' : '') + '/>';
    return s;
  }

  /* ---------- 屏 1 渲染：疲劳累积 ---------- */
  function renderFatigue() {
    vib = M.genVibration(N, 20261141);
    fat = M.fatigueAccum(vib.vib, N, 1);
    var s = '';
    /* 振动时序 + 工况底 */
    var x0 = 40, y0 = 30, w = 300, h = 80;
    s += '<text x="40" y="22" font-size="9" fill="#4d565b" font-weight="700">振动幅值 + 工况</text>';
    var mColors = ['#c5d6ea', '#e6cdb2', '#f5d9d4'];
    var seg = [[0, N * 0.3], [N * 0.3, N * 0.55], [N * 0.55, N * 0.75], [N * 0.75, N]];
    for (var i = 0; i < seg.length; i++) {
      var m = i === 0 ? 0 : i === 1 || i === 3 ? 1 : 2;
      s += '<rect x="' + (x0 + seg[i][0] * w / N) + '" y="' + y0 + '" width="' + ((seg[i][1] - seg[i][0]) * w / N) + '" height="' + h + '" fill="' + mColors[m] + '" opacity="0.35"/>';
    }
    var vibArr = [];
    for (i = 0; i < N; i++) vibArr.push(vib.vib[i] / 1.4);
    s += linePath(vibArr, x0, y0 + h, w / N, h, '#41699b', false);
    /* 损伤曲线 */
    var y1 = 140;
    s += '<text x="40" y="' + (y1 - 8) + '" font-size="9" fill="#4d565b" font-weight="700">物理损伤（疲劳累积 0→1）</text>';
    s += '<line x1="' + x0 + '" y1="' + (y1 + 80) + '" x2="' + (x0 + w) + '" y2="' + (y1 + 80) + '" stroke="#9ba3a9" stroke-width="1"/>';
    var dmgArr = [];
    for (i = 0; i < N; i++) dmgArr.push(fat.damage[i]);
    s += linePath(dmgArr, x0, y1 + 80, w / N, 80, '#b26a39', false);
    /* 失效线 */
    s += '<line x1="' + x0 + '" y1="' + y1 + '" x2="' + (x0 + w) + '" y2="' + y1 + '" stroke="#b05a51" stroke-width="1.2" stroke-dasharray="4 3"/>';
    s += '<text x="' + (x0 + w + 4) + '" y="' + (y1 + 3) + '" font-size="7.5" fill="#b05a51">失效</text>';
    $('fatChart').innerHTML = s;
    $('roDamage').textContent = num(fat.cum, 2) + (fat.failPoint >= 0 ? '（已失效）' : '');
    $('roMode').textContent = '振动段' + Math.round(N * 0.25) + '·冲击段' + Math.round(N * 0.2);
  }

  /* ---------- 屏 2 渲染：剩余寿命预测 ---------- */
  function renderRUL() {
    vib = M.genVibration(N, 20261141);
    fat = M.fatigueAccum(vib.vib, N, 1);
    rul = M.rulPredict(fat.damage, state.mode, N, 100);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 100;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">剩余寿命 RUL：真实 vs 预测（' + ['纯时序', '纯物理', '混合建模'][state.mode] + '）</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-width="1"/>';
    /* 真实 RUL（绿） */
    var trueArr = [], predArr = [];
    for (var i = 0; i < N; i++) {
      trueArr.push(Math.max(0, (1 - fat.damage[i])) / 1.05);
      predArr.push(rul.rul[i] / 100);
    }
    s += linePath(trueArr, x0, y0 + h, w / N, h, '#2f7d6b', false);
    s += linePath(predArr, x0, y0 + h, w / N, h, '#b26a39', true);
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#2f7d6b">真实</text>';
    s += '<text x="' + (x0 + 50) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#b26a39">预测</text>';
    $('rulChart').innerHTML = s;
    $('roRul').textContent = num(rul.rul[N - 1], 0) + ' m';
    $('roErr').textContent = Math.round(rul.err * 100) + '%';
  }

  /* ---------- 屏 3 渲染：起钻建议 ---------- */
  function renderTrip() {
    vib = M.genVibration(N, 20261141);
    fat = M.fatigueAccum(vib.vib, N, 1);
    rul = M.rulPredict(fat.damage, state.mode, N, 100);
    trip = M.tripAdvice(rul.rul, state.tripThr, 100);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 80;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">剩余寿命（m）+ 起钻阈值</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-width="1"/>';
    var trueArr = [], predArr = [];
    for (var i = 0; i < N; i++) {
      trueArr.push(Math.max(0, (1 - fat.damage[i])) / 1.05);
      predArr.push(rul.rul[i] / 100);
    }
    s += linePath(trueArr, x0, y0 + h, w / N, h, '#2f7d6b', false);
    s += linePath(predArr, x0, y0 + h, w / N, h, '#b26a39', true);
    /* 起钻阈值线 */
    var thrY = y0 + h - (state.tripThr / 100 / 1.05) * h;
    s += '<line x1="' + x0 + '" y1="' + thrY + '" x2="' + (x0 + w) + '" y2="' + thrY + '" stroke="#b05a51" stroke-width="1.4" stroke-dasharray="5 3"/>';
    s += '<text x="' + (x0 + w + 4) + '" y="' + (thrY + 3) + '" font-size="7.5" fill="#b05a51">起钻线 ' + state.tripThr + 'm</text>';
    /* 建议条 */
    var suggest = trip.suggest;
    s += '<rect x="40" y="' + (y0 + h + 16) + '" width="300" height="26" rx="5" fill="' + (suggest ? '#f9efea' : '#e6f1ec') + '" stroke="' + (suggest ? '#b05a51' : '#2f7d6b') + '"/>';
    s += '<text x="52" y="' + (y0 + h + 34) + '" font-size="9" fill="' + (suggest ? '#b05a51' : '#2f7d6b') + '" font-weight="700">' + trip.advice + ' · 剩余寿命 ' + num(trip.remaining, 0) + ' m</text>';
    $('tripChart').innerHTML = s;

    $('roAdvice').textContent = trip.advice;
    $('roAvoid').textContent = trip.suggest ? '避免断钻具' : '可继续钻进';
    /* 检查清单 */
    var rows = [
      ['起钻探伤', trip.suggest ? '裂纹/磨损' : '未见异常', trip.suggest ? 'ok' : 'ok'],
      ['寿命核对', num(trip.remaining, 0) + ' m', 'ok'],
      ['反馈', '已回流', 'ok']
    ];
    var rs = '';
    for (var r = 0; r < rows.length; r++) {
      rs += '<div class="row"><span>' + rows[r][0] + '</span><b>' + rows[r][1] + '</b><em>' + rows[r][2] + '</em></div>';
    }
    var revEl = $('reviewList');
    if (revEl) revEl.innerHTML = rs;
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    var inMode = $('inMode');
    if (inMode) inMode.addEventListener('input', function () {
      state.mode = parseInt(inMode.value, 10);
      $('outMode').textContent = ['纯时序', '纯物理', '混合建模'][state.mode];
      renderRUL(); renderTrip();
    });
    var inThr = $('inThr');
    if (inThr) inThr.addEventListener('input', function () {
      state.tripThr = parseInt(inThr.value, 10);
      $('outThr').textContent = state.tripThr;
      renderTrip();
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '疲劳累积', 'fatCtl'], ['sec2', '剩余寿命预测', 'rulCtl'], ['sec3', '起钻建议', 'tripCtl']].forEach(function (s) {
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
  renderFatigue(); renderRUL(); renderTrip();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
