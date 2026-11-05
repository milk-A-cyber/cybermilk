/* =========================================================
   射孔参数优化 · 模型层 + 浏览器接线
   ---------------------------------------------------------
   纯前端真计算：用实验设计（DOE）采样代替全枚举，
   代理模型评估产能与出砂，多目标优化给出帕累托推荐。

   Model（模型层）：genRes / doeSample / proxyModel / optRecommend
   浏览器接线：window.RemoteBridge = { M, genRes, doeSample,
       proxyModel, optRecommend, live, render }
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

  function phaseFactor(phase) {
    return 1 - Math.min(180, Math.abs(phase - 90)) / 180 * 0.18;
  }

  /* 合成储层力学参数（单井） */
  function genRes(seed) {
    seed = seed || 20261105;
    var rnd = mulberry32(seed);
    return {
      strength: 0.3 + rnd() * 0.7,  /* 储层强度 0-1 */
      stress: 20 + rnd() * 30,      /* 地应力 MPa */
      perm: 50 + rnd() * 450,       /* 渗透率 mD */
      seed: seed
    };
  }

  /* 全组合枚举 */
  function allCombos() {
    var pts = [];
    for (var di = 0; di < DENSITY.length; di++)
      for (var pi = 0; pi < PHASES.length; pi++)
        for (var dj = 0; dj < DEPTHS.length; dj++)
          pts.push({ density: DENSITY[di], phase: PHASES[pi], depth: DEPTHS[dj] });
    return pts;
  }

  /* 实验设计采样：拉丁超立方，k 点均匀覆盖参数空间 */
  function doeSample(rock, k) {
    k = k || 15;
    var rnd = mulberry32((rock.seed || 20261105) + 7);
    var pts = [];
    var used = {};
    var guard = 0;
    while (pts.length < k && guard < k * 30) {
      guard++;
      /* 拉丁超立方：把每个维度分 k 桶，每桶取一点 */
      var di = Math.min(DENSITY.length - 1, Math.floor((rnd() * k) / k * DENSITY.length));
      var pi = Math.min(PHASES.length - 1, Math.floor((rnd() * k) / k * PHASES.length));
      var dj = Math.min(DEPTHS.length - 1, Math.floor((rnd() * k) / k * DEPTHS.length));
      di = Math.floor(rnd() * DENSITY.length);
      pi = Math.floor(rnd() * PHASES.length);
      dj = Math.floor(rnd() * DEPTHS.length);
      var key = di + ',' + pi + ',' + dj;
      if (used[key]) continue;
      used[key] = true;
      pts.push({ density: DENSITY[di], phase: PHASES[pi], depth: DEPTHS[dj] });
    }
    /* 保证覆盖：补进一些均匀网格点 */
    if (pts.length < k) {
      for (var di2 = 0; di2 < DENSITY.length && pts.length < k; di2++)
        for (var dj2 = 0; dj2 < DEPTHS.length && pts.length < k; dj2++) {
          var key2 = di2 + ',2,' + dj2;
          if (!used[key2]) { used[key2] = true; pts.push({ density: DENSITY[di2], phase: 90, depth: DEPTHS[dj2] }); }
        }
    }
    return pts.slice(0, k);
  }

  /* 代理模型：产能与出砂风险 */
  function proxyModel(rock, cfg) {
    var q = 40 * (1 - Math.exp(-0.08 * cfg.density)) * (1 + 0.3 * cfg.depth) * phaseFactor(cfg.phase);
    var risk = (1 - rock.strength) * Math.pow(cfg.density / 24, 0.85) * Math.pow(cfg.depth / 1.2, 0.7) * (0.7 + 0.3 * (1 - phaseFactor(cfg.phase)));
    return { q: q, risk: clamp(risk, 0, 1) };
  }

  /* 多目标优化：对采样点评估，找帕累托 + 推荐；对比全局 */
  function optRecommend(rock, samples) {
    var all = allCombos();
    var evaled = samples.map(function (s) { var p = proxyModel(rock, s); return { density: s.density, phase: s.phase, depth: s.depth, q: p.q, risk: p.risk }; });
    var gEvaled = all.map(function (s) { var p = proxyModel(rock, s); return { density: s.density, phase: s.phase, depth: s.depth, q: p.q, risk: p.risk }; });
    function pareto(pts) {
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
      return front;
    }
    var front = pareto(evaled);
    var gFront = pareto(gEvaled);
    var rec = front[0];
    front.forEach(function (f2) { if (f2.q > rec.q) rec = f2; });
    return { front: front, gFront: gFront, rec: rec, evaled: evaled, all: all, nSample: samples.length, nAll: all.length };
  }

  var M = { genRes: genRes, doeSample: doeSample, proxyModel: proxyModel, optRecommend: optRecommend, allCombos: allCombos, DENSITY: DENSITY, PHASES: PHASES, DEPTHS: DEPTHS };

  /* ---------- 浏览器接线 ---------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = M;
    return;
  }

  var rock = M.genRes(20261105);
  var state = { strength: rock.strength, samples: 15 };
  function live() { return { strength: state.strength, samples: state.samples }; }

  function get(id) { return document.getElementById(id); }
  function html(el, s) { el.innerHTML = s; }
  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }

  function widthOf() {
    var c = get('resChart');
    return c ? Math.max(240, c.clientWidth || 360) : 360;
  }

  function renderAll() {
    var W = widthOf(), H = 200, P = 26;
    var x0 = 30, y0 = 30, xw = W - P - 30, h = H - P - 20;
    var rk = { strength: state.strength, seed: 20261105 };
    var samples = M.doeSample(rk, state.samples);
    var opt = M.optRecommend(rk, samples);

    /* 屏1 储层力学参数 + 参数空间 */
    var c1 = '';
    c1 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c1 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c1 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">储层力学参数</text>';
    var bars = [
      ['强度', state.strength, 0, 1],
      ['应力', 35, 20, 50],
      ['渗透率', 250, 50, 500]
    ];
    for (var bi = 0; bi < bars.length; bi++) {
      var by = y0 + bi * 34;
      c1 += '<text x="' + x0 + '" y="' + (by + 10) + '" font-size="9" fill="#242b2e">' + bars[bi][0] + '</text>';
      var bw = (bars[bi][1] - bars[bi][2]) / (bars[bi][3] - bars[bi][2]) * (xw - 40);
      c1 += '<rect x="' + (x0 + 62) + '" y="' + (by + 2) + '" width="' + bw.toFixed(1) + '" height="13" fill="#41699b" opacity="0.85" rx="2"/>';
      c1 += '<text x="' + (x0 + xw) + '" y="' + (by + 13) + '" font-size="9" fill="#242b2e" text-anchor="end">' + f(bars[bi][1]) + '</text>';
    }
    c1 += '<text x="' + x0 + '" y="' + (y0 + 118) + '" font-size="9.5" fill="#242b2e" font-weight="600">参数空间</text>';
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
    html(get('resChart'), c1);
    html(get('roStr'), f(state.strength));
    html(get('roStress'), f(rock.stress, 0) + 'MPa');
    html(get('roPerm'), f(rock.perm, 0) + 'mD');

    /* 屏2 实验设计采样 */
    var c2 = '';
    c2 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c2 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c2 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">实验设计采样 · ' + opt.nSample + ' 点 vs 全组合 ' + opt.nAll + ' 点</text>';
    /* 全组合网格 */
    for (var gi = 0; gi <= 4; gi++) {
      c2 += '<line x1="' + (x0 + gi * xw / 4) + '" y1="' + y0 + '" x2="' + (x0 + gi * xw / 4) + '" y2="' + (y0 + h) + '" stroke="#f0f2f3" stroke-width="1"/>';
      c2 += '<line x1="' + x0 + '" y1="' + (y0 + gi * h / 4) + '" x2="' + (x0 + xw) + '" y2="' + (y0 + gi * h / 4) + '" stroke="#f0f2f3" stroke-width="1"/>';
    }
    /* 全组合散点（淡） */
    for (var ai = 0; ai < opt.all.length; ai++) {
      var ap = opt.all[ai];
      var ax = x0 + (DENSITY.indexOf(ap.density) / 4) * xw;
      var ay = y0 + (DEPTHS.indexOf(ap.depth) / 4) * h;
      c2 += '<circle cx="' + ax.toFixed(1) + '" cy="' + ay.toFixed(1) + '" r="2" fill="#d5dde4"/>';
    }
    /* DOE 采样点（实） */
    for (var si = 0; si < samples.length; si++) {
      var sp = samples[si];
      var sx = x0 + (DENSITY.indexOf(sp.density) / 4) * xw;
      var sy = y0 + (DEPTHS.indexOf(sp.depth) / 4) * h;
      c2 += '<circle cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="4.5" fill="#2f7d6b" stroke="#fff" stroke-width="1.5"/>';
    }
    c2 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 10) + '" font-size="8" fill="#2f7d6b" text-anchor="end">绿=采样点</text>';
    c2 += '<text x="' + (x0 + xw) + '" y="' + (y0 + h + 12) + '" font-size="8" fill="#9aa2a8" text-anchor="end">X=孔密 Y=穿深</text>';
    c2 += '</svg>';
    html(get('doeChart'), c2);
    html(get('roSamples'), opt.nSample + ' 点');
    html(get('roAll'), opt.nAll + ' 点');

    /* 屏3 多目标优化推荐 */
    var c3 = '';
    c3 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c3 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c3 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">多目标优化 · 产能 vs 出砂</text>';
    for (var gi2 = 0; gi2 <= 4; gi2++) {
      c3 += '<line x1="' + (x0 + gi2 * xw / 4) + '" y1="' + y0 + '" x2="' + (x0 + gi2 * xw / 4) + '" y2="' + (y0 + h) + '" stroke="#eef0f1" stroke-width="1"/>';
      c3 += '<line x1="' + x0 + '" y1="' + (y0 + gi2 * h / 4) + '" x2="' + (x0 + xw) + '" y2="' + (y0 + gi2 * h / 4) + '" stroke="#eef0f1" stroke-width="1"/>';
    }
    /* 采样评估点 */
    for (var ei = 0; ei < opt.evaled.length; ei++) {
      var ep = opt.evaled[ei];
      c3 += '<circle cx="' + (x0 + ep.risk * xw) + '" cy="' + (y0 + h - ep.q / 60 * h) + '" r="3" fill="#c9d4df"/>';
    }
    /* 全局前沿（连线） */
    var gpath = 'M';
    for (var gfi = 0; gfi < opt.gFront.length; gfi++) {
      var gp = opt.gFront[gfi];
      gpath += (x0 + gp.risk * xw).toFixed(1) + ' ' + (y0 + h - gp.q / 60 * h).toFixed(1);
      if (gfi < opt.gFront.length - 1) gpath += ' L';
    }
    c3 += '<path d="' + gpath + '" fill="none" stroke="#8aa3c0" stroke-width="1.6" stroke-dasharray="5 3"/>';
    /* 采样前沿 */
    for (var fi = 0; fi < opt.front.length; fi++) {
      var fp = opt.front[fi];
      c3 += '<circle cx="' + (x0 + fp.risk * xw) + '" cy="' + (y0 + h - fp.q / 60 * h) + '" r="5" fill="#2f7d6b"/>';
    }
    var rx = x0 + opt.rec.risk * xw, ry = y0 + h - opt.rec.q / 60 * h;
    c3 += '<circle cx="' + rx.toFixed(1) + '" cy="' + ry.toFixed(1) + '" r="6.5" fill="#b05a51" stroke="#fff" stroke-width="2"/>';
    c3 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 10) + '" font-size="8" fill="#2f7d6b" text-anchor="end">绿=采样前沿</text>';
    c3 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 24) + '" font-size="8" fill="#8aa3c0" text-anchor="end">蓝虚线=全局前沿</text>';
    c3 += '</svg>';
    html(get('optChart'), c3);
    html(get('roOptQ'), f(opt.rec.q, 1));
    html(get('roOptRisk'), f(opt.rec.risk));
    html(get('roOptCfg'), opt.rec.density + '孔·' + opt.rec.phase + '°·' + f(opt.rec.depth) + 'm');
    html(get('roGap'), f(Math.abs(opt.rec.q - opt.gFront[opt.gFront.length - 1].q) / opt.gFront[opt.gFront.length - 1].q * 100, 1) + '%');
  }

  function wire() {
    var inS = get('inStrength');
    if (inS) inS.addEventListener('input', function () {
      state.strength = parseFloat(inS.value);
      html(get('outStrength'), f(state.strength));
      renderAll();
    });
    var inSm = get('inSamples');
    if (inSm) inSm.addEventListener('input', function () {
      state.samples = parseInt(inSm.value, 10);
      html(get('outSamples'), state.samples + ' 点');
      renderAll();
    });
  }

  function init() {
    wire();
    html(get('outStrength'), f(state.strength));
    html(get('outSamples'), state.samples + ' 点');
    renderAll();
  }

  global.RemoteBridge = { M: M, genRes: genRes, doeSample: doeSample, proxyModel: proxyModel, optRecommend: optRecommend, live: live, render: renderAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(typeof window !== 'undefined' ? window : global);
