/* =========================================================
   完井方式智能优选 · 模型层 + 浏览器接线
   ---------------------------------------------------------
   纯前端真计算：用知识图谱组织"储层特征—完井方式—生产表现"的
   关系，基于相似案例推理推荐候选方案并做多目标排序。

   Model（模型层）：genWells / similarCases / rankPlans
   浏览器接线：window.RemoteBridge = { M, genWells, similarCases,
       rankPlans, live, render }
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
  var WAYS = ['裸眼', '射孔', '筛管', '砾石充填'];
  var LITHOS = ['砂岩', '碳酸盐', '泥质'];
  /* 完井方式属性：capK 产能系数 / sandProtect 防砂 / cost 成本 */
  var WAYATTR = [
    { k: '裸眼', capK: 1.0, sandProtect: 0.10, cost: 0.30, note: '产能高·不防砂' },
    { k: '射孔', capK: 0.85, sandProtect: 0.50, cost: 0.50, note: '均衡' },
    { k: '筛管', capK: 0.80, sandProtect: 0.85, cost: 0.62, note: '防砂好' },
    { k: '砾石充填', capK: 0.70, sandProtect: 1.00, cost: 0.90, note: '强防砂' }
  ];

  /* 理论最优方式（按储层特征） */
  function idealWay(litho, sandIdx, waterNear) {
    if (sandIdx > 0.6) return 3;      /* 砾石充填 */
    if (sandIdx > 0.35) return 2;     /* 筛管 */
    if (litho === 1) return 0;        /* 碳酸盐稳定 → 裸眼 */
    if (litho === 2) return 2;        /* 泥质易出砂 → 筛管 */
    return 1;                          /* 常规 → 射孔 */
  }

  /* 合成历史井库：储层特征 + 完井方式 + 生产表现 */
  function genWells(n, seed) {
    n = n || 120; seed = seed || 20261101;
    var rnd = mulberry32(seed);
    var litho = new Int8Array(n);
    var sandIdx = new Float64Array(n);
    var waterNear = new Int8Array(n);
    var way = new Int8Array(n);
    var q0 = new Float64Array(n);   /* 初期产能 */
    var sandOut = new Int8Array(n); /* 出砂情况 */
    var cost = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      litho[i] = Math.floor(rnd() * 3);
      sandIdx[i] = clamp(rnd() * 0.9, 0, 1);
      waterNear[i] = rnd() < 0.3 ? 1 : 0;
      var ideal = idealWay(litho[i], sandIdx[i], waterNear[i]);
      /* 真实选择：理论最优 + 噪声（经验/邻井影响） */
      var r = rnd();
      way[i] = (r < 0.7) ? ideal : Math.floor(rnd() * 4);
      var at = WAYATTR[way[i]];
      var match = 1 - Math.abs(ideal - way[i]) * 0.18; /* 越接近最优产能越高 */
      q0[i] = (28 + rnd() * 24) * at.capK * match;
      sandOut[i] = (sandIdx[i] > 0.55 && at.sandProtect < 0.7) ? 1 : 0;
      cost[i] = at.cost;
    }
    return { n: n, litho: litho, sandIdx: sandIdx, waterNear: waterNear, way: way, q0: q0, sandOut: sandOut, cost: cost, seed: seed };
  }

  /* 相似案例推理：按储层特征 kNN 找最相似历史井 */
  function similarCases(query, wells, k) {
    k = k || 5;
    var dists = [];
    for (var i = 0; i < wells.n; i++) {
      var d = Math.abs(wells.litho[i] - query.litho) * 1.0
            + Math.abs(wells.sandIdx[i] - query.sandIdx) * 1.6
            + Math.abs(wells.waterNear[i] - query.waterNear) * 1.2;
      dists.push({ i: i, d: d });
    }
    dists.sort(function (a, b) { return a.d - b.d; });
    var list = [];
    for (var j = 0; j < Math.min(k, dists.length); j++) {
      var wi = dists[j].i;
      list.push({
        i: wi,
        litho: wells.litho[wi], sandIdx: wells.sandIdx[wi], waterNear: wells.waterNear[wi],
        way: wells.way[wi], q0: wells.q0[wi], sandOut: wells.sandOut[wi], cost: wells.cost[wi], dist: dists[j].d
      });
    }
    return list;
  }

  /* 多目标排序：产能↑ / 防砂↑ / 成本↓，输出候选排序与各维度 */
  function rankPlans(query, wells, weight) {
    weight = weight === undefined ? 0.5 : weight; /* 成本/防砂权重 */
    var plans = [];
    for (var w = 0; w < 4; w++) {
      var at = WAYATTR[w];
      var match = 1 - Math.abs(idealWay(query.litho, query.sandIdx, query.waterNear) - w) * 0.18;
      var q = (30) * at.capK * match;                    /* 产能 */
      var sandRisk = clamp(query.sandIdx - at.sandProtect + 0.2, 0, 1); /* 出砂风险 */
      var c = at.cost;                                    /* 成本 */
      var score = (1 - weight) * (q / 40) - weight * sandRisk - (1 - weight) * c * 0.3;
      plans.push({ way: w, k: at.k, q: q, sandRisk: sandRisk, cost: c, match: match, score: score });
    }
    plans.sort(function (a, b) { return b.score - a.score; });
    /* 帕累托：无其他方案在产能与防砂上同时更优 */
    plans.forEach(function (p) {
      p.pareto = true;
      plans.forEach(function (o) {
        if (o !== p && o.q > p.q + 0.5 && o.sandRisk < p.sandRisk - 0.02) p.pareto = false;
      });
    });
    return plans;
  }

  var M = { genWells: genWells, similarCases: similarCases, rankPlans: rankPlans, WAYS: WAYS, LITHOS: LITHOS, WAYATTR: WAYATTR };

  /* ---------- 浏览器接线 ---------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = M;
    return;
  }

  var wells = M.genWells(120, 20261101);
  /* 当前井 = 一条新井（未选完井方式），用第 0 号井的储层特征 */
  var state = { well: 0, weight: 0.5 };
  var queryCache = null;
  function queryOf() {
    if (!queryCache || queryCache.i !== state.well) {
      queryCache = {
        i: state.well,
        litho: wells.litho[state.well], sandIdx: wells.sandIdx[state.well], waterNear: wells.waterNear[state.well]
      };
    }
    return queryCache;
  }

  function live() { return { well: state.well, weight: state.weight }; }

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
  function lineSVG(arr, x0, y0, xw, h, minV, maxV, color, width, dash) {
    var s = '<path d="M';
    for (var i = 0; i < arr.length; i++) {
      var y = y0 + h - (arr[i] - minV) / (maxV - minV) * h;
      s += (x0 + i * xw / arr.length).toFixed(1) + ' ' + y.toFixed(1);
      if (i < arr.length - 1) s += ' L';
    }
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (width || 1.8) + '"' + (dash ? ' stroke-dasharray="5 3"' : '') + '/>';
    return s;
  }
  function drawAxes(x0, y0, xw, h) {
    var s = '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x0 + '" y2="' + (y0 + h) + '" stroke="#6b7680" stroke-width="1.2"/>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + xw) + '" y2="' + (y0 + h) + '" stroke="#6b7680" stroke-width="1.2"/>';
    return s;
  }
  function widthOf() {
    var c = get('lithoChart');
    return c ? Math.max(240, c.clientWidth || 360) : 360;
  }

  function renderAll() {
    var W = widthOf(), H = 200, P = 26;
    var x0 = 30, y0 = 30, xw = W - P - 30, h = H - P - 20;
    var q = queryOf();
    var sims = M.similarCases(q, wells, 5);
    var plans = M.rankPlans(q, wells, state.weight);

    /* 屏1 储层特征 + 完井方式分布 */
    var c1 = '';
    c1 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c1 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c1 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">储层特征 · 井' + state.well + '</text>';
    var bars = [
      ['岩性', LITHOS[q.litho], 0, 2, q.litho],
      ['出砂指数', f(q.sandIdx), 0, 1, q.sandIdx],
      ['近水层', q.waterNear ? '近' : '远', 0, 1, q.waterNear]
    ];
    for (var bi = 0; bi < bars.length; bi++) {
      var by = y0 + bi * 34;
      c1 += '<text x="' + x0 + '" y="' + (by + 10) + '" font-size="9" fill="#242b2e">' + bars[bi][0] + '</text>';
      var bw = bars[bi][4] / bars[bi][3] * (xw - 40);
      c1 += '<rect x="' + (x0 + 55) + '" y="' + (by + 2) + '" width="' + bw.toFixed(1) + '" height="13" fill="#41699b" opacity="0.85" rx="2"/>';
      c1 += '<text x="' + (x0 + xw) + '" y="' + (by + 13) + '" font-size="9" fill="#242b2e" text-anchor="end">' + bars[bi][1] + '</text>';
    }
    /* 完井方式分布 */
    var counts = [0, 0, 0, 0];
    for (var ci = 0; ci < wells.n; ci++) counts[wells.way[ci]]++;
    c1 += '<text x="' + x0 + '" y="' + (y0 + 122) + '" font-size="9.5" fill="#242b2e" font-weight="600">历史完井方式分布</text>';
    var bw2 = (xw - 30) / 4;
    for (var wi = 0; wi < 4; wi++) {
      var bx = x0 + wi * bw2;
      c1 += '<text x="' + (bx + bw2 / 2) + '" y="' + (y0 + 138) + '" text-anchor="middle" font-size="8" fill="#79828a">' + WAYS[wi] + '</text>';
      c1 += '<rect x="' + (bx + 4) + '" y="' + (y0 + 142) + '" width="' + (bw2 - 8) + '" height="' + (counts[wi] / wells.n * 44).toFixed(0) + '" fill="#b26a39" opacity="0.8" rx="2"/>';
    }
    c1 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 190) + '" text-anchor="end" font-size="8" fill="#9aa2a8">' + wells.n + ' 口历史井</text>';
    c1 += '</svg>';
    html(get('lithoChart'), c1);
    html(get('roLitho'), LITHOS[q.litho]);
    html(get('roSand'), f(q.sandIdx));
    html(get('roWater'), q.waterNear ? '近水层' : '远离水层');

    /* 屏2 知识图谱 + 相似案例 */
    var c2 = '';
    c2 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c2 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c2 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">相似案例 · kNN 前 5 · 候选方案</text>';
    c2 += '<text x="' + x0 + '" y="' + (y0 + 14) + '" font-size="9" fill="#79828a">储层特征 → 完井方式 → 生产表现</text>';
    for (var si = 0; si < sims.length; si++) {
      var sc = sims[si];
      var sy = y0 + 28 + si * 33;
      c2 += '<rect x="' + x0 + '" y="' + sy + '" width="' + (xw) + '" height="28" rx="4" fill="#f4f7fb" stroke="#c5d6ea"/>';
      c2 += '<text x="' + (x0 + 8) + '" y="' + (sy + 18) + '" font-size="8" fill="#242b2e">井' + sc.i + '</text>';
      c2 += '<text x="' + (x0 + 52) + '" y="' + (sy + 18) + '" font-size="8" fill="#79828a">' + LITHOS[sc.litho] + '·砂' + f(sc.sandIdx) + '</text>';
      c2 += '<rect x="' + (x0 + 150) + '" y="' + (sy + 6) + '" width="54" height="16" rx="3" fill="#e6f1ec" stroke="#b9d8cb"/>';
      c2 += '<text x="' + (x0 + 177) + '" y="' + (sy + 18) + '" font-size="7.5" fill="#22604f" text-anchor="middle">' + WAYS[sc.way] + '</text>';
      c2 += '<text x="' + (x0 + 216) + '" y="' + (sy + 18) + '" font-size="8" fill="#41699b">产能' + f(sc.q0, 0) + (sc.sandOut ? '·出砂' : '') + '</text>';
    }
    c2 += '</svg>';
    html(get('kgChart'), c2);
    /* 相似井的方式众数作为候选 */
    var wayCnt = [0, 0, 0, 0];
    sims.forEach(function (s) { wayCnt[s.way]++; });
    var bestWay = 0;
    for (var bi2 = 1; bi2 < 4; bi2++) if (wayCnt[bi2] > wayCnt[bestWay]) bestWay = bi2;
    html(get('roSimTop'), WAYS[bestWay]);
    html(get('roSimCount'), sims.length + ' 井');

    /* 屏3 多目标排序 */
    var c3 = '';
    c3 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c3 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c3 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">多目标排序 · 产能/防砂/成本</text>';
    for (var pi = 0; pi < plans.length; pi++) {
      var pl = plans[pi];
      var py = y0 + pi * 30;
      c3 += '<text x="' + x0 + '" y="' + (py + 12) + '" font-size="9" fill="' + (pl.pareto ? '#22604f' : '#79828a') + '" font-weight="' + (pl.pareto ? '700' : '400') + '">' + (pi + 1) + '. ' + pl.k + (pl.pareto ? ' ★' : '') + '</text>';
      c3 += '<rect x="' + (x0 + 82) + '" y="' + (py + 3) + '" width="' + (pl.q / 40 * (xw - 130) * 0.6).toFixed(0) + '" height="10" fill="#41699b" opacity="0.8"/>';
      c3 += '<rect x="' + (x0 + 82 + (xw - 130) * 0.62) + '" y="' + (py + 3) + '" width="' + ((1 - pl.sandRisk) * (xw - 130) * 0.32).toFixed(0) + '" height="10" fill="#2f7d6b" opacity="0.8"/>';
      c3 += '<text x="' + (x0 + xw) + '" y="' + (py + 12) + '" font-size="8" fill="#79828a" text-anchor="end">' + f(pl.q, 0) + '/' + f(pl.sandRisk) + '/' + f(pl.cost) + '</text>';
    }
    c3 += '<text x="' + x0 + '" y="' + (y0 + 130) + '" font-size="8" fill="#9aa2a8">蓝=产能 · 绿=防砂 · 成本见右侧 · ★=帕累托</text>';
    c3 += '</svg>';
    html(get('rankChart'), c3);
    html(get('roTopPlan'), plans[0].k);
    var para = plans.filter(function (p) { return p.pareto; }).map(function (p) { return p.k; }).join(' / ');
    html(get('roPareto'), para);
  }

  function wire() {
    var inW = get('inWell');
    if (inW) inW.addEventListener('input', function () {
      state.well = parseInt(inW.value, 10);
      html(get('outWell'), '井 ' + state.well);
      renderAll();
    });
    var inWe = get('inWeight');
    if (inWe) inWe.addEventListener('input', function () {
      state.weight = parseFloat(inWe.value);
      html(get('outWeight'), f(state.weight));
      renderAll();
    });
  }

  function init() {
    wire();
    html(get('outWell'), '井 ' + state.well);
    html(get('outWeight'), f(state.weight));
    renderAll();
  }

  global.RemoteBridge = { M: M, genWells: genWells, similarCases: similarCases, rankPlans: rankPlans, live: live, render: renderAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(typeof window !== 'undefined' ? window : global);
