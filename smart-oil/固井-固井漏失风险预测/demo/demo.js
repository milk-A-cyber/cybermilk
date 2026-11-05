/* =========================================================
   固井漏失风险预测 · 模型层 + 浏览器接线
   ---------------------------------------------------------
   纯前端真计算：合成井况与浆柱设计 + 漏失标签（类不均衡），
   用分类模型基于井况与浆柱设计预测漏失概率，输出风险等级与
   关键影响因素。

   Model（模型层）：genLeakCase / leakClassify / riskExplain
   浏览器接线：window.RemoteBridge = { M, genLeakCase,
       leakClassify, riskExplain, live, render }
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
  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  /* ---------- 模型层 ---------- */
  var RISK = ['低', '中', '高'];

  /* 合成井况 + 浆柱设计 + 漏失标签（类不均衡） */
  function genLeakCase(n, seed) {
    n = n || 200; seed = seed || 20261231;
    var rnd = mulberry32(seed);
    var Pp = new Float64Array(n);   /* 孔隙压力当量密度 */
    var Pf = new Float64Array(n);   /* 破裂压力当量密度 */
    var win = new Float64Array(n);  /* 窗口 */
    var bore = new Float64Array(n); /* 井径 mm */
    var dens = new Float64Array(n); /* 浆体密度 */
    var rate = new Float64Array(n); /* 排量 */
    var ecd = new Float64Array(n);  /* 当量循环密度 */
    var margin = new Float64Array(n); /* Pf - ECD 裕度 */
    var loss = new Float64Array(n); /* 漏失标签 0/1 */
    var amt = new Float64Array(n);  /* 漏失量 */

    for (var i = 0; i < n; i++) {
      Pp[i] = 1.0 + rnd() * 0.15;
      var narrow = rnd() < 0.35;
      Pf[i] = Pp[i] + (narrow ? 0.08 + rnd() * 0.06 : 0.2 + rnd() * 0.14);
      win[i] = Pf[i] - Pp[i];
      bore[i] = 200 + rnd() * 45;
      dens[i] = Pp[i] + 0.05 + rnd() * 0.13; /* 浆柱设计密度（多数安全，少数贴近窗口） */
      rate[i] = 1.0 + rnd() * 1.0;
      ecd[i] = dens[i] + 0.06 * (215.9 / bore[i]) * rate[i] * rate[i] * 0.18;
      /* 压力剖面是解释值，存在输入误差 */
      var err = (rnd() - 0.5) * 0.10; /* ±0.05 g/cm³ 量级 */
      margin[i] = Pf[i] - ecd[i] + err;
      loss[i] = margin[i] < 0 ? 1 : 0; /* 漏失占比低（类不均衡） */
      amt[i] = loss[i] ? 5 + rnd() * 40 : 0;
    }
    return { n: n, Pp: Pp, Pf: Pf, win: win, bore: bore, dens: dens, rate: rate, ecd: ecd, margin: margin, loss: loss, amt: amt, seed: seed };
  }

  /* 漏失概率：基于裕度 margin（越小越易漏失）的 logistic 分类 */
  function probOf(margin) {
    return sigmoid(-margin * 4.5);
  }
  function riskOf(p) {
    return p < 0.33 ? 0 : p < 0.66 ? 1 : 2;
  }

  /* 分类模型：预测漏失概率 + 风险等级 + 是否漏失 */
  function leakClassify(cases, thr, wellIdx) {
    thr = thr === undefined ? 0.5 : thr;
    var i = wellIdx === undefined ? 0 : wellIdx;
    var p = probOf(cases.margin[i]);
    return {
      well: i, p: p, risk: RISK[riskOf(p)], pred: p > thr ? 1 : 0, loss: cases.loss[i],
      margin: cases.margin[i], ecd: cases.ecd[i], dens: cases.dens[i], rate: cases.rate[i],
      bore: cases.bore[i], Pf: cases.Pf[i], Pp: cases.Pp[i], amt: cases.amt[i]
    };
  }

  /* 特征归因：各特征对漏失概率的贡献排序 */
  function riskExplain(cases, wellIdx) {
    var i = wellIdx === undefined ? 0 : wellIdx;
    var c = cases;
    var m = c.margin[i], p = probOf(m);
    var slope = p * (1 - p) * 4.5; /* dp/dmargin */
    /* 各特征对 margin 的敏感性（偏导） */
    var feats = [
      { k: '浆体密度', v: -1 * slope, unit: 'g/cm³', dir: '增密度→漏失概率↑' },
      { k: '排量', v: -0.06 * (215.9 / c.bore[i]) * 2 * c.rate[i] * 0.18 * slope, unit: 'm³/min', dir: '增排量→漏失概率↑' },
      { k: '破裂压力', v: 1 * slope, unit: 'g/cm³', dir: '降破裂压力→漏失概率↑' },
      { k: '密度窗口', v: 1 * slope, unit: 'g/cm³', dir: '窗口窄→漏失概率↑' }
    ];
    feats.sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); });
    var total = 0;
    for (var j = 0; j < feats.length; j++) total += Math.abs(feats[j].v);
    for (var k = 0; k < feats.length; k++) feats[k].share = total > 0 ? Math.abs(feats[k].v) / total : 0;
    return { well: i, feats: feats, p: p, margin: m, loss: c.loss[i] };
  }

  var M = { genLeakCase: genLeakCase, leakClassify: leakClassify, riskExplain: riskExplain, RISK: RISK };

  /* ---------- 浏览器接线 ---------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = M;
    return;
  }

  var cases = M.genLeakCase(200, 20261231);
  var state = { well: 0, thr: 0.5 };

  function live() { return { well: state.well, thr: state.thr }; }

  function get(id) { return document.getElementById(id); }
  function html(el, s) { el.innerHTML = s; }
  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }

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
    var c = get('imbChart');
    return c ? Math.max(240, c.clientWidth || 360) : 360;
  }

  function renderAll() {
    var W = widthOf(), H = 200, P = 26;
    var x0 = 30, y0 = 30, xw = W - P - 30, h = H - P - 20;
    var lc = M.leakClassify(cases, state.thr, state.well);
    var ex = M.riskExplain(cases, state.well);

    /* 屏1 类不均衡分布 */
    var c1 = '';
    c1 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c1 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c1 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">类不均衡 · 漏失占比低</text>';
    c1 += gridSVG(x0, y0, xw, h, 4, 3, -0.3, 0.4);
    c1 += drawAxes(x0, y0, xw, h);
    for (var i = 0; i < cases.n; i++) {
      var xi = x0 + i * xw / cases.n;
      var yi = y0 + h - (cases.margin[i] + 0.3) / 0.7 * h;
      var col = cases.loss[i] === 1 ? '#b05a51' : '#7a8fa3';
      c1 += '<rect x="' + (xi - 1).toFixed(1) + '" y="' + yi.toFixed(1) + '" width="2" height="2.5" fill="' + col + '" opacity="0.75"/>';
    }
    c1 += '</svg>';
    var lossN = 0;
    for (var li = 0; li < cases.n; li++) if (cases.loss[li] === 1) lossN++;
    html(get('imbChart'), c1);
    html(get('roImbLoss'), f(lossN / cases.n * 100, 0) + '%');
    html(get('roImbN'), lossN + '/' + cases.n);

    /* 屏2 漏失概率分类 */
    var c2 = '';
    c2 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c2 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c2 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">漏失概率 · 井' + lc.well + ' p=' + f(lc.p) + ' · 风险' + lc.risk + '</text>';
    var pArr = [];
    for (var pi = 0; pi < cases.n; pi++) pArr.push(M.probOf ? M.leakClassify(cases, 0.5, pi).p : 0);
    c2 += gridSVG(x0, y0, xw, h, 4, 3, 0, 1);
    c2 += drawAxes(x0, y0, xw, h);
    c2 += lineSVG(pArr, x0, y0, xw, h, 0, 1, '#41699b', 1.4);
    c2 += '<line x1="' + x0 + '" y1="' + (y0 + h - state.thr * h) + '" x2="' + (x0 + xw) + '" y2="' + (y0 + h - state.thr * h) + '" stroke="#b05a51" stroke-width="1.4" stroke-dasharray="5 3"/>';
    var wxi = x0 + lc.well * xw / cases.n;
    c2 += '<circle cx="' + wxi.toFixed(1) + '" cy="' + (y0 + h - lc.p * h).toFixed(1) + '" r="5" fill="' + (lc.loss === 1 ? '#b05a51' : '#2f7d6b') + '"/>';
    c2 += '</svg>';
    html(get('probChart'), c2);
    html(get('roProbP'), f(lc.p));
    html(get('roProbRisk'), lc.risk);
    html(get('roProbPred'), lc.pred === 1 ? '会漏失' : '不漏失');
    html(get('roProbTrue'), lc.loss === 1 ? '真漏失' : '真不漏失');

    /* 屏3 特征归因 */
    var c3 = '';
    c3 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c3 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c3 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">特征归因 · 关键影响因素</text>';
    var maxAbs = 0;
    ex.feats.forEach(function (ft) { if (Math.abs(ft.v) > maxAbs) maxAbs = Math.abs(ft.v); });
    for (var ri = 0; ri < ex.feats.length; ri++) {
      var ft = ex.feats[ri];
      var by = y0 + ri * 34 + 10;
      var bw = Math.abs(ft.v) / maxAbs * (xw - 30);
      var bx = x0 + (ft.v < 0 ? xw - 30 - bw : 0);
      c3 += '<text x="' + x0 + '" y="' + (by + 10) + '" font-size="9.5" fill="#242b2e">' + ft.k + '</text>';
      c3 += '<rect x="' + (x0 + 70) + '" y="' + by + '" width="' + (ft.v >= 0 ? bw : 0).toFixed(1) + '" height="14" fill="#b05a51" opacity="0.8"/>';
      c3 += '<rect x="' + (x0 + 70 - (ft.v < 0 ? bw : 0)).toFixed(1) + '" y="' + by + '" width="' + (ft.v < 0 ? bw : 0).toFixed(1) + '" height="14" fill="#2f7d6b" opacity="0.8"/>';
      c3 += '<text x="' + (x0 + xw) + '" y="' + (by + 11) + '" font-size="8" fill="#79828a" text-anchor="end">' + f(ft.share * 100, 0) + '%</text>';
    }
    c3 += '</svg>';
    html(get('attrChart'), c3);
    var top = ex.feats[0] ? ex.feats[0].k + '（' + f(ex.feats[0].share * 100, 0) + '%）' : '—';
    html(get('roTop'), top);
    var top2 = ex.feats[1] ? ex.feats[1].k : '—';
    html(get('roTop2'), top2);
  }

  function wire() {
    var inW = get('inWell');
    if (inW) inW.addEventListener('input', function () {
      state.well = parseInt(inW.value, 10);
      html(get('outWell'), '井 ' + state.well);
      renderAll();
    });
    var inT = get('inThr');
    if (inT) inT.addEventListener('input', function () {
      state.thr = parseFloat(inT.value);
      html(get('outThr'), f(state.thr));
      renderAll();
    });
  }

  function init() {
    wire();
    html(get('outWell'), '井 ' + state.well);
    html(get('outThr'), f(state.thr));
    renderAll();
  }

  global.RemoteBridge = { M: M, genLeakCase: genLeakCase, leakClassify: leakClassify, riskExplain: riskExplain, live: live, render: renderAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(typeof window !== 'undefined' ? window : global);
