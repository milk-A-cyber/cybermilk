/* =========================================================
   射孔参数智能设计 · 模型层 + 浏览器接线
   ---------------------------------------------------------
   纯前端真计算：用代理模型预测不同参数组合的产能与出砂风险，
   多目标优化给出帕累托方案集。

   Model（模型层）：genPerfData / proxyModel / paretoOpt
   浏览器接线：window.RemoteBridge = { M, genPerfData, proxyModel,
       paretoOpt, live, render }
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------- 工具 ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---------- 模型层 ---------- */
  var DENSITY = [8, 12, 16, 20, 24];   /* 孔密 孔/m */
  var PHASES = [0, 60, 90, 120, 180];  /* 相位 ° */
  var DEPTHS = [0.3, 0.5, 0.8, 1.0, 1.2]; /* 穿深 m */

  /* 相位因子：90° 最佳 */
  function phaseFactor(phase) {
    return 1 - Math.min(180, Math.abs(phase - 90)) / 180 * 0.18;
  }

  /* 合成 n 口井：储层力学参数 + 实际射孔参数 + 测试产量（标签） */
  function genPerfData(n, seed) {
    n = n || 120; seed = seed || 20261102;
    var rnd = mulberry32(seed);
    var strength = new Float64Array(n); /* 储层强度 0-1 */
    var stress = new Float64Array(n);   /* 地应力 */
    var perm = new Float64Array(n);     /* 渗透率 */
    var density = new Float64Array(n);
    var phase = new Float64Array(n);
    var depth = new Float64Array(n);
    var qTest = new Float64Array(n);    /* 测试产量 */
    for (var i = 0; i < n; i++) {
      strength[i] = 0.35 + rnd() * 0.65;
      stress[i] = 20 + rnd() * 30;
      perm[i] = 50 + rnd() * 450;
      density[i] = DENSITY[Math.floor(rnd() * DENSITY.length)];
      phase[i] = PHASES[Math.floor(rnd() * PHASES.length)];
      depth[i] = DEPTHS[Math.floor(rnd() * DEPTHS.length)];
      var cfg = { density: density[i], phase: phase[i], depth: depth[i] };
      var p = proxyModel({ strength: strength[i] }, cfg);
      qTest[i] = p.q * (0.85 + rnd() * 0.3); /* 测试带噪声 */
    }
    return { n: n, strength: strength, stress: stress, perm: perm, density: density, phase: phase, depth: depth, qTest: qTest, seed: seed };
  }

  /* 代理模型：预测产能与出砂风险 */
  function proxyModel(rock, cfg) {
    var strength = rock.strength;
    var q = 42 * (1 - Math.exp(-0.09 * cfg.density)) * (1 + 0.32 * cfg.depth) * phaseFactor(cfg.phase);
    var risk = (1 - strength) * Math.pow(cfg.density / 24, 0.85) * Math.pow(cfg.depth / 1.2, 0.7) * (0.7 + 0.3 * (1 - phaseFactor(cfg.phase)));
    return { q: q, risk: clamp(risk, 0, 1) };
  }

  /* 帕累托优化：枚举密度×穿深组合，找产能↑且出砂↓的帕累托前沿 */
  function paretoOpt(rock, phase) {
    phase = phase === undefined ? 90 : phase;
    var pts = [];
    for (var di = 0; di < DENSITY.length; di++) {
      for (var dj = 0; dj < DEPTHS.length; dj++) {
        var cfg = { density: DENSITY[di], phase: phase, depth: DEPTHS[dj] };
        var p = proxyModel(rock, cfg);
        pts.push({ density: DENSITY[di], phase: phase, depth: DEPTHS[dj], q: p.q, risk: p.risk });
      }
    }
    /* 帕累托：无其他点 q 更高且 risk 更低 */
    var front = [];
    pts.forEach(function (a) {
      var dominated = false;
      for (var b = 0; b < pts.length; b++) {
        var o = pts[b];
        if (o !== a && o.q > a.q + 0.1 && o.risk < a.risk - 0.005) { dominated = true; break; }
      }
      if (!dominated) front.push(a);
    });
    front.sort(function (a, b) { return a.risk - b.risk; });
    /* 推荐：前沿中产能最高 */
    var rec = front[0];
    front.forEach(function (f2) { if (f2.q > rec.q) rec = f2; });
    return { front: front, rec: rec, all: pts };
  }

  var M = { genPerfData: genPerfData, proxyModel: proxyModel, paretoOpt: paretoOpt, DENSITY: DENSITY, PHASES: PHASES, DEPTHS: DEPTHS };

  /* ---------- 浏览器接线 ---------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = M;
    return;
  }

  var wells = M.genPerfData(120, 20261102);
  var state = { rock: 0.55, phase: 90 };
  function live() { return { rock: state.rock, phase: state.phase }; }

  function get(id) { return document.getElementById(id); }
  function html(el, s) { el.innerHTML = s; }
  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }

  function gridSVG(x0, y0, xw, h, nx, ny, minV, maxV) {
    var s = '';
    for (var xi = 0; xi <= nx; xi++) {
      var gx = x0 + xi * xw / nx;
      s += '<line x1="' + gx + '" y1="' + y0 + '" x2="' + gx + '" y2="' + (y0 + h) + '" stroke="#eef0f1" stroke-width="1"/>';
    }
    for (var yi = 0; yi <= ny; yi++) {
      var gy = y0 + yi * h / ny;
      var val = maxV - (maxV - minV) * yi / ny;
      s += '<line x1="' + x0 + '" y1="' + gy + '" x2="' + (x0 + xw) + '" y2="' + gy + '" stroke="#eef0f1" stroke-width="1"/>';
      s += '<text x="' + (x0 - 3) + '" y="' + (gy + 3) + '" text-anchor="end" font-size="7.5" fill="#9aa2a8">' + val.toFixed(1) + '</text>';
    }
    return s;
  }
  function drawAxes(x0, y0, xw, h) {
    var s = '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x0 + '" y2="' + (y0 + h) + '" stroke="#6b7680" stroke-width="1.2"/>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + xw) + '" y2="' + (y0 + h) + '" stroke="#6b7680" stroke-width="1.2"/>';
    return s;
  }
  function widthOf() {
    var c = get('rockChart');
    return c ? Math.max(240, c.clientWidth || 360) : 360;
  }

  function renderAll() {
    var W = widthOf(), H = 200, P = 26;
    var x0 = 30, y0 = 30, xw = W - P - 30, h = H - P - 20;
    var rock = { strength: state.rock };
    var po = M.paretoOpt(rock, state.phase);

    /* 屏1 储层力学参数 + 参数空间 */
    var c1 = '';
    c1 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c1 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c1 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">储层力学参数</text>';
    var bars = [
      ['强度', state.rock, 0, 1],
      ['应力', 30, 20, 50],
      ['渗透率', 250, 50, 500]
    ];
    for (var bi = 0; bi < bars.length; bi++) {
      var by = y0 + bi * 34;
      c1 += '<text x="' + x0 + '" y="' + (by + 10) + '" font-size="9" fill="#242b2e">' + bars[bi][0] + '</text>';
      var bw = (bars[bi][1] - bars[bi][2]) / (bars[bi][3] - bars[bi][2]) * (xw - 40);
      c1 += '<rect x="' + (x0 + 62) + '" y="' + (by + 2) + '" width="' + bw.toFixed(1) + '" height="13" fill="#41699b" opacity="0.85" rx="2"/>';
      c1 += '<text x="' + (x0 + xw) + '" y="' + (by + 13) + '" font-size="9" fill="#242b2e" text-anchor="end">' + f(bars[bi][1]) + '</text>';
    }
    /* 参数空间 */
    c1 += '<text x="' + x0 + '" y="' + (y0 + 118) + '" font-size="9.5" fill="#242b2e" font-weight="600">射孔参数空间</text>';
    var params = [
      ['孔密', M.DENSITY.join('/')],
      ['相位', M.PHASES.join('/')],
      ['穿深', M.DEPTHS.join('/')]
    ];
    for (var pi2 = 0; pi2 < params.length; pi2++) {
      c1 += '<text x="' + x0 + '" y="' + (y0 + 136 + pi2 * 20) + '" font-size="8.5" fill="#79828a">' + params[pi2][0] + '</text>';
      c1 += '<text x="' + (x0 + 62) + '" y="' + (y0 + 136 + pi2 * 20) + '" font-size="8.5" fill="#242b2e">' + params[pi2][1] + '</text>';
    }
    c1 += '</svg>';
    html(get('rockChart'), c1);
    html(get('roStr'), f(state.rock));
    html(get('roPhase'), state.phase + '°');

    /* 屏2 代理模型响应 */
    var c2 = '';
    c2 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c2 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c2 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">代理模型 · 产能随穿深（孔密12）</text>';
    c2 += gridSVG(x0, y0, xw, h, 4, 3, 0, 60);
    c2 += drawAxes(x0, y0, xw, h);
    var qArr = [], rArr = [];
    for (var i = 0; i < M.DEPTHS.length; i++) {
      var pm = M.proxyModel(rock, { density: 12, phase: state.phase, depth: M.DEPTHS[i] });
      qArr.push(pm.q);
      rArr.push(pm.risk * 60);
    }
    c2 += '<path d="M';
    for (var qj = 0; qj < qArr.length; qj++) {
      c2 += (x0 + qj * xw / (qArr.length - 1)).toFixed(1) + ' ' + (y0 + h - qArr[qj] / 60 * h).toFixed(1);
      if (qj < qArr.length - 1) c2 += ' L';
    }
    c2 += '" fill="none" stroke="#41699b" stroke-width="2"/>';
    c2 += '<path d="M';
    for (var rj = 0; rj < rArr.length; rj++) {
      c2 += (x0 + rj * xw / (rArr.length - 1)).toFixed(1) + ' ' + (y0 + h - rArr[rj] / 60 * h).toFixed(1);
      if (rj < rArr.length - 1) c2 += ' L';
    }
    c2 += '" fill="none" stroke="#b05a51" stroke-width="1.6" stroke-dasharray="5 3"/>';
    c2 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 10) + '" font-size="8" fill="#41699b" text-anchor="end">产能</text>';
    c2 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 24) + '" font-size="8" fill="#b05a51" text-anchor="end">出砂风险</text>';
    c2 += '</svg>';
    html(get('respChart'), c2);
    var pmr = M.proxyModel(rock, { density: 12, phase: state.phase, depth: 0.8 });
    html(get('roQTop'), f(pmr.q, 1));
    html(get('roRiskTop'), f(pmr.risk));

    /* 屏3 帕累托前沿 */
    var c3 = '';
    c3 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c3 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c3 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">帕累托前沿 · 产能 vs 出砂</text>';
    c3 += gridSVG(x0, y0, xw, h, 4, 3, 0, 1);
    c3 += drawAxes(x0, y0, xw, h);
    c3 += '<text x="' + (x0 - 6) + '" y="' + (y0 - 8) + '" font-size="8" fill="#9aa2a8">出砂→</text>';
    c3 += '<text x="' + (x0 + xw + 4) + '" y="' + (y0 + h + 4) + '" font-size="8" fill="#9aa2a8">产能→</text>';
    for (var ai = 0; ai < po.all.length; ai++) {
      var ap = po.all[ai];
      var ax = x0 + ap.risk * xw, ay = y0 + h - ap.q / 60 * h;
      c3 += '<circle cx="' + ax.toFixed(1) + '" cy="' + ay.toFixed(1) + '" r="2.5" fill="#c9d4df"/>';
    }
    for (var fi = 0; fi < po.front.length; fi++) {
      var fp = po.front[fi];
      var fx = x0 + fp.risk * xw, fy = y0 + h - fp.q / 60 * h;
      c3 += '<circle cx="' + fx.toFixed(1) + '" cy="' + fy.toFixed(1) + '" r="4.5" fill="#2f7d6b"/>';
    }
    var rx = x0 + po.rec.risk * xw, ry = y0 + h - po.rec.q / 60 * h;
    c3 += '<circle cx="' + rx.toFixed(1) + '" cy="' + ry.toFixed(1) + '" r="6" fill="#b05a51" stroke="#fff" stroke-width="2"/>';
    c3 += '</svg>';
    html(get('paretoChart'), c3);
    html(get('roOptQ'), f(po.rec.q, 1));
    html(get('roOptRisk'), f(po.rec.risk));
    html(get('roOptCfg'), po.rec.density + '孔/m·' + po.rec.phase + '°·' + f(po.rec.depth) + 'm');
    html(get('roFrontN'), po.front.length + ' 点');
  }

  function wire() {
    var inR = get('inRock');
    if (inR) inR.addEventListener('input', function () {
      state.rock = parseFloat(inR.value);
      html(get('outRock'), f(state.rock));
      renderAll();
    });
    var inP = get('inPhase');
    if (inP) inP.addEventListener('input', function () {
      state.phase = parseInt(inP.value, 10);
      html(get('outPhase'), state.phase + '°');
      renderAll();
    });
  }

  function init() {
    wire();
    html(get('outRock'), f(state.rock));
    html(get('outPhase'), state.phase + '°');
    renderAll();
  }

  global.RemoteBridge = { M: M, genPerfData: genPerfData, proxyModel: proxyModel, paretoOpt: paretoOpt, live: live, render: renderAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(typeof window !== 'undefined' ? window : global);
