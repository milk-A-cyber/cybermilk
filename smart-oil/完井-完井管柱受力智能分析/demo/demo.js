/* =========================================================
   完井管柱受力智能分析 · 模型层 + 浏览器接线
   ---------------------------------------------------------
   纯前端真计算：用代理模型快速预测多工况下的载荷与安全系数，
   识别高风险工况组合，敏感性分析 + 可靠性评估。

   Model（模型层）：genTubing / loadAgent / reliabilityEval
   浏览器接线：window.RemoteBridge = { M, genTubing, loadAgent,
       reliabilityEval, live, render }
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
  var GRADES = ['N80', 'L80', 'P110'];   /* 钢级 */
  var YIELD = [552, 655, 758];            /* 屈服强度 MPa */
  var E = 207000, ALPHA = 1.2e-5, W_STRESS = 0.08; /* MPa/m 自重 */

  /* 轴向应力（简化机理模型）：自重 + 温度 + 压力 + 鼓胀 */
  function axialStress(depth, dT, dP, grade) {
    var sw = W_STRESS * depth;                    /* 自重应力 */
    var st = E * ALPHA * dT * 1.21;               /* 温度应力 MPa */
    var sp = dP * 1.0;                            /* 压力应力 */
    var sb = dP * 0.5;                            /* 鼓胀应力 */
    return { sw: sw, st: st, sp: sp, sb: sb, total: sw + st + sp + sb, yield: YIELD[grade] };
  }

  /* 合成 n 段管柱：钢级随下深 + 工况 */
  function genTubing(n, seed) {
    n = n || 60; seed = seed || 20261103;
    var rnd = mulberry32(seed);
    var depth = new Float64Array(n);
    var grade = new Int8Array(n);     /* 0/1/2 */
    var sf = new Float64Array(n);
    var dT = new Float64Array(n), dP = new Float64Array(n);
    var total = new Float64Array(n), yieldA = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      depth[i] = 500 + i * (2600 / n); /* 500-3100m */
      grade[i] = Math.floor(rnd() * 3);
      dT[i] = 20 + rnd() * 100;
      dP[i] = 5 + rnd() * 50;
      var a = axialStress(depth[i], dT[i], dP[i], grade[i]);
      total[i] = a.total; yieldA[i] = a.yield;
      sf[i] = a.yield / a.total;
    }
    return { n: n, depth: depth, grade: grade, sf: sf, dT: dT, dP: dP, total: total, yieldA: yieldA, seed: seed };
  }

  /* 代理模型：对工况网格批量算安全系数，找高风险组合 */
  function loadAgent(grade, grid) {
    grid = grid || { nT: 8, nP: 8 };
    var nT = grid.nT, nP = grid.nP;
    var dTs = [], dPs = [];
    for (var i = 0; i <= nT; i++) dTs.push(i * 120 / nT);
    for (var j = 0; j <= nP; j++) dPs.push(j * 60 / nP);
    var sf = [];
    var min = { sf: 1e9, dT: 0, dP: 0 };
    var worst = 3000; /* 最深段 */
    for (var ti = 0; ti < dTs.length; ti++) {
      var row = [];
      for (var pi = 0; pi < dPs.length; pi++) {
        var a = axialStress(worst, dTs[ti], dPs[pi], grade);
        var s = a.yield / a.total;
        row.push(s);
        if (s < min.sf) { min.sf = s; min.dT = dTs[ti]; min.dP = dPs[pi]; }
      }
      sf.push(row);
    }
    return { dTs: dTs, dPs: dPs, sf: sf, min: min, grid: { nT: nT, nP: nP } };
  }

  /* 可靠性评估：蒙特卡洛敏感性 + 失效概率 */
  function reliabilityEval(grade, depth, baseDT, baseDP, trials) {
    trials = trials || 600;
    var rnd = mulberry32(20261133);
    var sfs = new Float64Array(trials);
    var fails = 0;
    for (var i = 0; i < trials; i++) {
      var dT = baseDT + (rnd() - 0.5) * 60;   /* 温度扰动 */
      var dP = baseDP + (rnd() - 0.5) * 30;   /* 压力扰动 */
      var g = grade + ((rnd() - 0.5) * 0.5);   /* 强度扰动 */
      g = Math.round(clamp(g, 0, 2));
      var a = axialStress(depth, Math.max(0, dT), Math.max(0, dP), g);
      var s = a.yield / a.total;
      sfs[i] = s;
      if (s < 1) fails++;
    }
    var avg = 0, min = 1e9, max = 0;
    for (var j = 0; j < trials; j++) {
      avg += sfs[j];
      if (sfs[j] < min) min = sfs[j];
      if (sfs[j] > max) max = sfs[j];
    }
    avg /= trials;
    /* 敏感性：各参数对 SF 的影响（偏导近似） */
    var sens = [];
    var base = axialStress(depth, baseDT, baseDP, grade);
    var sBase = base.yield / base.total;
    /* 温度敏感性 */
    var aT = axialStress(depth, baseDT + 10, baseDP, grade);
    sens.push({ k: '温度', v: sBase - aT.yield / aT.total, unit: '/10°C', dir: '温度↑→SF↓' });
    /* 压力敏感性 */
    var aP = axialStress(depth, baseDT, baseDP + 10, grade);
    sens.push({ k: '压力', v: sBase - aP.yield / aP.total, unit: '/10MPa', dir: '压力↑→SF↓' });
    /* 下深敏感性 */
    var aD = axialStress(depth + 500, baseDT, baseDP, grade);
    sens.push({ k: '下深', v: sBase - aD.yield / aD.total, unit: '/500m', dir: '下深↑→SF↓' });
    sens.sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); });
    return { sfs: sfs, fails: fails, trials: trials, pFail: fails / trials, avg: avg, min: min, max: max, sens: sens, base: sBase };
  }

  var M = { genTubing: genTubing, axialStress: axialStress, loadAgent: loadAgent, reliabilityEval: reliabilityEval, GRADES: GRADES, YIELD: YIELD };

  /* ---------- 浏览器接线 ---------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = M;
    return;
  }

  var tubing = M.genTubing(60, 20261103);
  var state = { grade: 0, dT: 85, dP: 30 };
  function live() { return { grade: state.grade, dT: state.dT, dP: state.dP }; }

  function get(id) { return document.getElementById(id); }
  function html(el, s) { el.innerHTML = s; }
  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }

  function widthOf() {
    var c = get('tubeChart');
    return c ? Math.max(240, c.clientWidth || 360) : 360;
  }

  function renderAll() {
    var W = widthOf(), H = 200, P = 26;
    var x0 = 30, y0 = 30, xw = W - P - 30, h = H - P - 20;
    var la = M.loadAgent(state.grade, { nT: 6, nP: 6 });
    var rel = M.reliabilityEval(state.grade, 3000, state.dT, state.dP, 600);

    /* 屏1 管柱结构与材料 */
    var c1 = '';
    c1 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c1 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c1 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">管柱结构 · 钢级随下深</text>';
    for (var i = 0; i < tubing.n; i++) {
      var tx = x0 + tubing.grade[i] * 0.5 * (xw - 40) / 1 + 6;
      var ty = y0 + i * (h - 10) / tubing.n;
      var col = ['#8aa3c0', '#b26a39', '#2f7d6b'][tubing.grade[i]];
      c1 += '<rect x="' + x0 + '" y="' + ty.toFixed(1) + '" width="' + (xw - 30) + '" height="' + Math.max(2, (h - 10) / tubing.n) + '" fill="' + col + '" opacity="0.55"/>';
    }
    c1 += '<line x1="' + (x0 + (xw - 30) * 0.5) + '" y1="' + y0 + '" x2="' + (x0 + (xw - 30) * 0.5) + '" y2="' + (y0 + h) + '" stroke="#6b7680" stroke-width="1" stroke-dasharray="4 3"/>';
    c1 += '<text x="' + (x0 + (xw - 30) * 0.5) + '" y="' + (y0 + 10) + '" font-size="8" fill="#6b7680" text-anchor="middle">P110</text>';
    c1 += '<text x="' + (x0 + (xw - 30) * 0.5) + '" y="' + (y0 + h + 12) + '" font-size="8" fill="#6b7680" text-anchor="middle">N80</text>';
    c1 += '<text x="' + (x0 + xw - 10) + '" y="' + (y0 + h + 12) + '" font-size="8" fill="#9aa2a8" text-anchor="end">钢级·下深 500-3100m</text>';
    c1 += '</svg>';
    html(get('tubeChart'), c1);
    html(get('roGrade'), M.GRADES[state.grade] + '(' + M.YIELD[state.grade] + 'MPa)');
    html(get('roYield'), f(la.min.sf));

    /* 屏2 载荷云图 */
    var c2 = '';
    c2 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c2 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c2 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">安全系数云图 · ΔT × ΔP</text>';
    var nT = la.grid.nT, nP = la.grid.nP;
    var cw = (xw - 20) / nT, ch2 = (h - 20) / nP;
    for (var ti = 0; ti < la.sf.length; ti++) {
      for (var pi2 = 0; pi2 < la.sf[ti].length; pi2++) {
        var s = la.sf[ti][pi2];
        var col = s < 1 ? '#b05a51' : s < 1.3 ? '#e0a858' : '#7fb3a0';
        var cx = x0 + ti * cw, cy = y0 + pi2 * ch2;
        c2 += '<rect x="' + cx.toFixed(1) + '" y="' + cy.toFixed(1) + '" width="' + (cw - 1).toFixed(1) + '" height="' + (ch2 - 1).toFixed(1) + '" fill="' + col + '" opacity="0.8"/>';
      }
    }
    c2 += '<text x="' + (x0 + xw / 2) + '" y="' + (y0 + h + 12) + '" text-anchor="middle" font-size="8" fill="#9aa2a8">ΔT(°C) → · 左为 ΔP(MPa)</text>';
    c2 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 10) + '" text-anchor="end" font-size="8" fill="#9aa2a8">红=失效 黄=临界 绿=安全</text>';
    c2 += '</svg>';
    html(get('loadChart'), c2);
    html(get('roMinDT'), f(la.min.dT, 0) + '°C');
    html(get('roMinDP'), f(la.min.dP, 0) + 'MPa');

    /* 屏3 可靠性与敏感性 */
    var c3 = '';
    c3 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c3 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c3 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">失效概率 P=' + f(rel.pFail * 100, 1) + '%</text>';
    var bins = 10;
    var bmin = Math.floor(rel.min), bmax = Math.ceil(rel.max);
    var span = (bmax - bmin) || 1;
    var counts = new Array(bins).fill(0);
    for (var bi = 0; bi < rel.trials; bi++) {
      var bIdx = Math.min(bins - 1, Math.floor((rel.sfs[bi] - bmin) / span * bins));
      if (bIdx < 0) bIdx = 0;
      counts[bIdx]++;
    }
    var maxC = 1;
    for (var m = 0; m < bins; m++) if (counts[m] > maxC) maxC = counts[m];
    for (var bj = 0; bj < bins; bj++) {
      var bx = x0 + bj * (xw - 30) / bins;
      var bh = counts[bj] / maxC * (h - 40);
      var bcol = (bmin + bj * span / bins) < 1 ? '#b05a51' : '#7fb3a0';
      c3 += '<rect x="' + (bx + 1) + '" y="' + (y0 + h - bh) + '" width="' + ((xw - 30) / bins - 2) + '" height="' + bh + '" fill="' + bcol + '" opacity="0.75"/>';
    }
    c3 += '<line x1="' + x0 + '" y1="' + (y0 + h - (1 - bmin) / span * h) + '" x2="' + (x0 + xw - 30) + '" y2="' + (y0 + h - (1 - bmin) / span * h) + '" stroke="#b05a51" stroke-width="1.4" stroke-dasharray="4 3"/>';
    c3 += '<text x="' + (x0 + xw - 30) + '" y="' + (y0 + h - (1 - bmin) / span * h - 3) + '" font-size="8" fill="#b05a51" text-anchor="end">SF=1</text>';
    c3 += '</svg>';
    html(get('riskChart'), c3);
    html(get('roFail'), f(rel.pFail * 100, 1) + '%');
    html(get('roAvg'), f(rel.avg));
    html(get('roTopSens'), rel.sens[0].k + '(' + f(Math.abs(rel.sens[0].v), 3) + ')');
    html(get('roP50'), f((rel.min + rel.max) / 2));
  }

  function wire() {
    var inG = get('inGrade');
    if (inG) inG.addEventListener('input', function () {
      state.grade = parseInt(inG.value, 10);
      html(get('outGrade'), M.GRADES[state.grade]);
      renderAll();
    });
    var inT = get('inDT');
    if (inT) inT.addEventListener('input', function () {
      state.dT = parseInt(inT.value, 10);
      html(get('outDT'), state.dT + '°C');
      renderAll();
    });
    var inP = get('inDP');
    if (inP) inP.addEventListener('input', function () {
      state.dP = parseInt(inP.value, 10);
      html(get('outDP'), state.dP + 'MPa');
      renderAll();
    });
  }

  function init() {
    wire();
    html(get('outGrade'), M.GRADES[state.grade]);
    html(get('outDT'), state.dT + '°C');
    html(get('outDP'), state.dP + 'MPa');
    renderAll();
  }

  global.RemoteBridge = { M: M, genTubing: genTubing, loadAgent: loadAgent, reliabilityEval: reliabilityEval, live: live, render: renderAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(typeof window !== 'undefined' ? window : global);
