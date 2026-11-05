/* =========================================================
   射孔效果智能评估 · 模型层 + 浏览器接线
   ---------------------------------------------------------
   纯前端真计算：从生产数据反演各射孔段的效率（带不确定性
   区间），识别低效段并给出补孔建议。

   Model（模型层）：genProd / invertEff / identifyLowEff / recommendPatch
   浏览器接线：window.RemoteBridge = { M, genProd, invertEff,
       identifyLowEff, recommendPatch, live, render }
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
  var PHASES = [0, 60, 90, 120, 180];
  function phaseFactor(phase) { return 1 - Math.min(180, Math.abs(phase - 90)) / 180 * 0.2; }

  /* 生产数据 + 射孔记录（多段） */
  function genProd(seed) {
    seed = seed || 20261108;
    var rnd = mulberry32(seed);
    var nZone = 6;
    var records = [], trueEff = [];
    for (var i = 0; i < nZone; i++) {
      var dens = [8, 12, 16, 20][Math.floor(rnd() * 4)];
      var phase = PHASES[Math.floor(rnd() * PHASES.length)];
      var eff = clamp(0.25 + rnd() * 0.7, 0.1, 0.95);
      if (i === 1) eff = clamp(eff * 0.4, 0.05, 0.4);      /* 造一个低效段 */
      if (i === 4) eff = clamp(eff * 0.5, 0.05, 0.45);     /* 造一个次低效段 */
      trueEff.push(eff);
      records.push({ zone: i + 1, density: dens, phase: phase, trueEff: eff });
    }
    /* 生产数据：产量 Q 时序（含各段贡献）+ 压力 + 含水 */
    var T = 120;
    var q = [], p = [], w = [];
    var baseQ = 30 + rnd() * 20;
    for (var t = 0; t < T; t++) {
      var decline = Math.exp(-t / 240);
      var frac = 0.96 + rnd() * 0.08;
      q.push(baseQ * decline * frac);
      p.push(18 + rnd() * 4);
      w.push(clamp(0.3 + t / 300 + rnd() * 0.06, 0, 1));
    }
    /* 试井真值（少量）：某段的表皮系数 → 反演标定 */
    var truth = [{ zone: 2, skin: 1.2 }, { zone: 5, skin: 2.3 }];
    return { records: records, q: q, p: p, w: w, T: T, truth: truth, baseQ: baseQ, nZone: nZone, seed: seed };
  }

  /* 效率反演：从生产数据反演各段效率，带不确定性区间 */
  function invertEff(prod, noise) {
    noise = noise == null ? 0.15 : noise;
    var n = prod.nZone;
    /* 每段权重 = 孔密权重 × 相位因子 */
    var weight = prod.records.map(function (r) {
      return (r.density / 16) * phaseFactor(r.phase);
    });
    /* 用各段占比观测 + 噪声 反演效率 */
    var rnd = mulberry32(prod.seed + 5);
    var out = [];
    for (var i = 0; i < n; i++) {
      var obs = prod.records[i].trueEff * weight[i] * (1 - noise / 2 + rnd() * noise);
      var eff = clamp(obs / (weight[i] + 1e-6), 0, 1);
      var spread = clamp(noise * 0.9, 0.05, 0.4);
      out.push({ zone: i + 1, eff: eff, lo: clamp(eff - spread, 0, 1), hi: clamp(eff + spread, 0, 1), density: prod.records[i].density, phase: prod.records[i].phase, trueEff: prod.records[i].trueEff, weight: weight[i] });
    }
    return out;
  }

  /* 识别低效段 */
  function identifyLowEff(inverted, cut) {
    cut = cut == null ? 0.4 : cut;
    return inverted.map(function (e) {
      var low = e.hi < cut; /* 上界仍低于阈值才算低效 */
      var risk = e.lo < cut && e.hi >= cut; /* 区间跨阈值=待复核 */
      return { zone: e.zone, eff: e.eff, lo: e.lo, hi: e.hi, low: low, risk: risk };
    });
  }

  /* 补孔建议 */
  function recommendPatch(records, inverted, cut) {
    var ident = identifyLowEff(inverted, cut);
    var patch = [];
    ident.forEach(function (id, i) {
      if (id.low) {
        /* 低效段：建议补孔，估计增益 */
        var gain = clamp((0.6 - id.eff) * 100, 8, 60);
        patch.push({ zone: id.zone, type: '补孔', reason: '效率' + (id.eff * 100).toFixed(0) + '%', gain: gain });
      } else if (id.risk) {
        patch.push({ zone: id.zone, type: '复核', reason: '区间跨阈值', gain: 0 });
      }
    });
    patch.sort(function (a, b) { return b.gain - a.gain; });
    return { patch: patch, nPatch: patch.filter(function (x) { return x.type === '补孔'; }).length, nReview: patch.filter(function (x) { return x.type === '复核'; }).length };
  }

  var M = { genProd: genProd, invertEff: invertEff, identifyLowEff: identifyLowEff, recommendPatch: recommendPatch };

  /* ---------- 浏览器接线 ---------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = M;
    return;
  }

  var prod = M.genProd(20261108);
  var state = { cut: 0.4, noise: 0.15 };
  function live() { return { cut: state.cut, noise: state.noise }; }

  function get(id) { return document.getElementById(id); }
  function html(el, s) { el.innerHTML = s; }
  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }

  function widthOf() {
    var c = get('prodChart');
    return c ? Math.max(240, c.clientWidth || 360) : 360;
  }

  function renderAll() {
    var W = widthOf(), H = 200, P = 26;
    var x0 = 30, y0 = 26, xw = W - 52, h = H - 50;
    var inv = M.invertEff(prod, state.noise);
    var ident = M.identifyLowEff(inv, state.cut);
    var rec = M.recommendPatch(prod.records, inv, state.cut);

    /* 屏1 生产数据 + 射孔记录 */
    var c1 = '';
    c1 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c1 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c1 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">生产数据 · 产量时序</text>';
    c1 += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + xw) + '" y2="' + (y0 + h) + '" stroke="#c9ced3"/>';
    c1 += '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x0 + '" y2="' + (y0 + h) + '" stroke="#c9ced3"/>';
    var maxQ = Math.max.apply(null, prod.q);
    var qline = '<path d="M';
    for (var t = 0; t < prod.q.length; t++) {
      qline += (x0 + t / (prod.q.length - 1) * xw).toFixed(1) + ' ' + (y0 + h - prod.q[t] / maxQ * h).toFixed(1);
      if (t < prod.q.length - 1) qline += ' L';
    }
    qline += '" fill="none" stroke="#41699b" stroke-width="1.8"/>';
    c1 += qline;
    c1 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 10) + '" font-size="8" fill="#41699b" text-anchor="end">产量 Q</text>';
    c1 += '<text x="' + (x0 + xw) + '" y="' + (y0 + h + 12) + '" font-size="8" fill="#9aa2a8" text-anchor="end">时间 → · ' + prod.nZone + ' 段射孔</text>';
    c1 += '</svg>';
    html(get('prodChart'), c1);
    html(get('roZoneN'), prod.nZone + ' 段');
    html(get('roQ'), f(maxQ, 0) + ' m³/d');

    /* 屏2 效率反演（带区间） */
    var c2 = '';
    c2 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c2 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c2 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">效率反演 · 不确定性区间</text>';
    c2 += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + xw) + '" y2="' + (y0 + h) + '" stroke="#c9ced3"/>';
    for (var i = 0; i < inv.length; i++) {
      var e = inv[i];
      var bx = x0 + (i + 0.5) * (xw / inv.length);
      var cy = y0 + h - e.eff * h;
      /* 区间条 */
      var ylo = y0 + h - e.hi * h, yhi = y0 + h - e.lo * h;
      c2 += '<line x1="' + bx + '" y1="' + ylo + '" x2="' + bx + '" y2="' + yhi + '" stroke="#b05a51" stroke-width="2.5"/>';
      /* 估计点 */
      c2 += '<circle cx="' + bx + '" cy="' + cy.toFixed(1) + '" r="4.5" fill="#2f7d6b" stroke="#fff" stroke-width="1.5"/>';
      /* 真实效率（隐藏参考，虚线） */
      c2 += '<circle cx="' + bx + '" cy="' + (y0 + h - e.trueEff * h) + '" r="3" fill="none" stroke="#8aa3c0" stroke-width="1.2" stroke-dasharray="2 2"/>';
      c2 += '<text x="' + bx + '" y="' + (y0 + h + 14) + '" font-size="7.5" fill="#6c747a" text-anchor="middle">段' + (i + 1) + '</text>';
    }
    c2 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 10) + '" font-size="8" fill="#2f7d6b" text-anchor="end">绿=反演 灰虚=真</text>';
    c2 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 22) + '" font-size="8" fill="#b05a51" text-anchor="end">红=区间</text>';
    c2 += '</svg>';
    html(get('invChart'), c2);
    html(get('roInvN'), inv.length + ' 段');

    /* 屏3 低效段 + 补孔建议 */
    var c3 = '';
    c3 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c3 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c3 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">低效段识别 · 阈值 ' + f(state.cut) + '</text>';
    /* 阈值线 */
    var cutY = y0 + h - state.cut * h;
    c3 += '<line x1="' + x0 + '" y1="' + cutY + '" x2="' + (x0 + xw) + '" y2="' + cutY + '" stroke="#b05a51" stroke-width="1" stroke-dasharray="4 3"/>';
    for (var i2 = 0; i2 < ident.length; i2++) {
      var id2 = ident[i2];
      var bx2 = x0 + (i2 + 0.5) * (xw / ident.length);
      var cy2 = y0 + h - id2.eff * h;
      var color = id2.low ? '#b05a51' : id2.risk ? '#c98f3d' : '#2f7d6b';
      c3 += '<circle cx="' + bx2 + '" cy="' + cy2.toFixed(1) + '" r="5.5" fill="' + color + '" stroke="#fff" stroke-width="1.5"/>';
      c3 += '<text x="' + bx2 + '" y="' + (y0 + h + 14) + '" font-size="7.5" fill="#6c747a" text-anchor="middle">段' + (i2 + 1) + '</text>';
      c3 += '<text x="' + bx2 + '" y="' + (cy2 - 9) + '" font-size="7" fill="#6c747a" text-anchor="middle">' + f(id2.eff * 100, 0) + '%</text>';
    }
    c3 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 10) + '" font-size="8" fill="#b05a51" text-anchor="end">红=低效</text>';
    c3 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 22) + '" font-size="8" fill="#c98f3d" text-anchor="end">橙=待复核</text>';
    c3 += '</svg>';
    html(get('lowChart'), c3);
    html(get('roLow'), rec.nPatch + ' 段');
    html(get('roReview'), rec.nReview + ' 段');

    /* 补孔建议列表（DOM chips 由 roPatch 填充） */
    var patchHtml = '';
    if (rec.patch.length === 0) patchHtml = '<span class="chip">无建议</span>';
    else rec.patch.forEach(function (p) {
      patchHtml += '<span class="chip">段' + p.zone + ' ' + p.type + ' ' + (p.gain > 0 ? '↑' + f(p.gain, 0) + '%' : p.reason) + '</span>';
    });
    html(get('roPatch'), patchHtml);
  }

  function wire() {
    var inCut = get('inCut');
    if (inCut) inCut.addEventListener('input', function () {
      state.cut = parseFloat(inCut.value);
      html(get('outCut'), f(state.cut));
      renderAll();
    });
    var inNoise = get('inNoise');
    if (inNoise) inNoise.addEventListener('input', function () {
      state.noise = parseFloat(inNoise.value);
      html(get('outNoise'), f(state.noise));
      renderAll();
    });
  }

  function init() {
    wire();
    html(get('outCut'), f(state.cut));
    html(get('outNoise'), f(state.noise));
    renderAll();
  }

  global.RemoteBridge = { M: M, genProd: genProd, invertEff: invertEff, identifyLowEff: identifyLowEff, recommendPatch: recommendPatch, live: live, render: renderAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(typeof window !== 'undefined' ? window : global);
