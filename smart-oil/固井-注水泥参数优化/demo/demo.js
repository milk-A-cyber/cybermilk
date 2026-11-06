/* =========================================================
   注水泥参数优化 · 模型层 + 浏览器接线
   ---------------------------------------------------------
   纯前端真计算：合成井况（井径/温度/孔隙-破裂压力窗口）与
   施工记录，建立"井况—浆体—顶替效率"映射，在密度窗口约束内
   扫描推荐浆柱密度与排量，对比邻井经验方案。

   Model（模型层）：genCementJob / optimizeSlurry / recommendDesign
   浏览器接线：window.RemoteBridge = { M, genCementJob,
       optimizeSlurry, recommendDesign, live, render }
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
  var DEN0 = 1.05;            /* 孔隙压力当量密度基准 g/cm³ */

  /* 合成井况 + 施工记录 + 施工结果 */
  function genCementJob(n, seed) {
    n = n || 24; seed = seed || 20261221;
    var rnd = mulberry32(seed);
    var Pp = new Float64Array(n);    /* 孔隙压力当量密度 */
    var Pf = new Float64Array(n);    /* 破裂压力当量密度 */
    var win = new Float64Array(n);   /* 窗口宽度 Pf-Pp */
    var narrow = new Float64Array(n);/* 1=窄窗口 */
    var bore = new Float64Array(n);  /* 井径 mm */
    var temp = new Float64Array(n);  /* 温度 ℃ */
    var expDens = new Float64Array(n); /* 邻井经验浆体密度 */
    var expRate = new Float64Array(n); /* 邻井经验排量 m³/min */
    var expLoss = new Float64Array(n); /* 经验是否漏失 */
    var expCbl = new Float64Array(n);  /* 经验 CBL 等级 0好/1中/2差 */

    for (var i = 0; i < n; i++) {
      Pp[i] = DEN0 + (rnd() - 0.5) * 0.18;
      narrow[i] = rnd() < 0.5 ? 1 : 0;
      if (narrow[i]) { Pf[i] = Pp[i] + 0.09 + rnd() * 0.05; }
      else { Pf[i] = Pp[i] + 0.24 + rnd() * 0.10; }
      win[i] = Pf[i] - Pp[i];
      bore[i] = 215.9 + (rnd() - 0.5) * 30;
      temp[i] = 60 + rnd() * 50;
      expDens[i] = Pp[i] + 0.18;         /* 经验密度常取较高 */
      expRate[i] = 1.2 + rnd() * 0.6;    /* 经验排量 */
      var ecd = ecdAt(expDens[i], expRate[i], bore[i], temp[i]);
      expLoss[i] = ecd > Pf[i] - 0.01 ? 1 : 0;
      var eff = effAt(expDens[i], expRate[i], Pp[i], Pf[i], bore[i], temp[i]);
      expCbl[i] = eff > 0.7 ? 0 : eff > 0.45 ? 1 : 2;
    }
    return { n: n, Pp: Pp, Pf: Pf, win: win, narrow: narrow, bore: bore, temp: temp, expDens: expDens, expRate: expRate, expLoss: expLoss, expCbl: expCbl };
  }

  /* 当量循环密度 ECD：浆体密度 + 环空压耗项（随排量/井径/温度） */
  function ecdAt(dens, rate, bore, temp) {
    var k = 0.06 * (215.9 / bore) * (1 + (temp - 60) / 200);
    return dens + k * rate * rate * 0.18;
  }
  /* 顶替效率：密度贴近最优(Pp+~0.12)且排量适中时最高 */
  function effAt(dens, rate, Pp, Pf, bore, temp) {
    var dOpt = Pp + 0.12;
    var dPen = clamp(1 - Math.abs(dens - dOpt) / 0.25, 0, 1);
    var rPen = clamp(rate / 1.8, 0, 1) * 0.85 + 0.15;
    var wPen = clamp(1 - Math.abs(Pf - Pp - 0.28) / 0.25, 0.6, 1);
    return clamp(dPen * rPen * wPen, 0, 1);
  }

  /* 密度窗口约束内扫描：找不漏失且顶替效率最高的浆柱密度+排量 */
  function optimizeSlurry(job, margin, wellIdx) {
    margin = margin === undefined ? 0.04 : margin;
    var i = wellIdx === undefined ? 0 : wellIdx;
    var Pp = job.Pp[i], Pf = job.Pf[i], bore = job.bore[i], temp = job.temp[i];
    var densMin = Pp + 0.03, densMax = Pf - 0.03;   /* 密度窗口约束 */
    var best = null;
    for (var d = densMin; d <= densMax; d += 0.01) {
      for (var r = 0.6; r <= 2.2; r += 0.1) {
        var ecd = ecdAt(d, r, bore, temp);
        if (ecd > Pf - margin) continue;             /* 会漏失，跳过 */
        var eff = effAt(d, r, Pp, Pf, bore, temp);
        if (!best || eff > best.eff) best = { dens: d, rate: r, eff: eff, loss: 0, ecd: ecd };
      }
    }
    if (!best) best = { dens: Pp + 0.03, rate: 0.6, eff: 0.2, loss: 1, ecd: ecdAt(Pp + 0.03, 0.6, bore, temp) };
    best.densMin = densMin; best.densMax = densMax; best.win = Pf - Pp; best.margin = margin;
    return best;
  }

  /* 推荐设计 + 邻井经验对照 */
  function recommendDesign(job, margin, wellIdx) {
    var i = wellIdx === undefined ? 0 : wellIdx;
    var opt = optimizeSlurry(job, margin, i);
    var expEff = effAt(job.expDens[i], job.expRate[i], job.Pp[i], job.Pf[i], job.bore[i], job.temp[i]);
    return {
      well: i,
      Pp: job.Pp[i], Pf: job.Pf[i], win: job.Pf[i] - job.Pp[i], narrow: job.narrow[i],
      bore: job.bore[i], temp: job.temp[i],
      exp: { dens: job.expDens[i], rate: job.expRate[i], eff: expEff, loss: job.expLoss[i], cbl: job.expCbl[i] },
      opt: { dens: opt.dens, rate: opt.rate, eff: opt.eff, loss: opt.loss, cbl: opt.eff > 0.7 ? 0 : opt.eff > 0.45 ? 1 : 2 },
      optDens: opt.dens, optRate: opt.rate, optEff: opt.eff,
      densMin: opt.densMin, densMax: opt.densMax, margin: opt.margin
    };
  }

  var M = { genCementJob: genCementJob, optimizeSlurry: optimizeSlurry, recommendDesign: recommendDesign };

  /* ---------- 浏览器接线 ---------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = M;
    return;
  }

  var jobs = M.genCementJob(24, 20261221);
  var state = { well: 0, margin: 0.04 };

  function live() { return { well: state.well, margin: state.margin }; }

  function get(id) { return document.getElementById(id); }
  function html(el, s) { el.innerHTML = s; }
  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }
  function f1(v) { return f(v, 3); }

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
      s += '<text x="' + (x0 - 3) + '" y="' + (gy + 3) + '" text-anchor="end" font-size="7.5" fill="#9aa2a8">' + val.toFixed(2) + '</text>';
    }
    return s;
  }
  function drawAxes(x0, y0, xw, h) {
    var s = '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x0 + '" y2="' + (y0 + h) + '" stroke="#6b7680" stroke-width="1.2"/>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + xw) + '" y2="' + (y0 + h) + '" stroke="#6b7680" stroke-width="1.2"/>';
    return s;
  }
  function widthOf() {
    var c = get('winChart');
    return c ? Math.max(240, c.clientWidth || 360) : 360;
  }

  function renderAll() {
    var W = widthOf(), H = 200, P = 26;
    var x0 = 30, y0 = 30, xw = W - P - 30, h = H - P - 20;
    var r = M.recommendDesign(jobs, state.margin, state.well);

    /* 屏1 井况压力窗口 */
    var c1 = '';
    c1 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c1 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c1 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">井况压力窗口 · 井' + r.well + ' · ' + (r.narrow ? '窄窗口' : '宽窗口') + ' · 窗口=' + f(r.win) + ' g/cm³</text>';
    c1 += gridSVG(x0, y0, xw, h, 4, 3, 0.9, 1.5);
    c1 += drawAxes(x0, y0, xw, h);
    var j = jobs;
    for (var i = 0; i < j.n; i++) {
      var xi = x0 + i * xw / j.n;
      c1 += '<rect x="' + (xi - 1).toFixed(1) + '" y="' + (y0 + h - (j.Pf[i] - 0.9) / 0.6 * h).toFixed(1) + '" width="2.6" height="' + ((j.Pf[i] - j.Pp[i]) / 0.6 * h).toFixed(1) + '" fill="' + (i === r.well ? '#2f7d6b' : '#cfd6da') + '" opacity="' + (i === r.well ? 0.85 : 0.4) + '"/>';
    }
    c1 += '</svg>';
    html(get('winChart'), c1);
    html(get('roWinGap'), f(r.win) + ' g/cm³');
    html(get('roWinType'), r.narrow ? '窄' : '宽');

    /* 屏2 参数优化热力图 */
    var c2 = '';
    c2 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c2 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c2 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">参数优化 · 密度×排量 · 推荐密度=' + f(r.optDens) + ' 排量=' + f(r.optRate) + ' · 顶替效率=' + f(r.optEff * 100, 0) + '%</text>';
    var dMin = r.Pp - 0.02, dMax = r.Pf + 0.04;
    for (var gx = 0; gx <= 40; gx++) {
      for (var gy = 0; gy <= 24; gy++) {
        var d = dMin + (dMax - dMin) * gx / 40;
        var rr = 0.6 + 1.6 * gy / 24;
        var ecd = ecdAt(d, rr, r.bore, r.temp);
        var eff = effAt(d, rr, r.Pp, r.Pf, r.bore, r.temp);
        var fill;
        if (ecd > r.Pf - state.margin) fill = '#e8c6b8';
        else if (eff > 0.75) fill = '#bcd9cd';
        else if (eff > 0.5) fill = '#e6f1ec';
        else fill = '#f5f0e6';
        c2 += '<rect x="' + (x0 + gx * xw / 40).toFixed(1) + '" y="' + (y0 + gy * h / 24).toFixed(1) + '" width="' + (xw / 40 + 0.5).toFixed(1) + '" height="' + (h / 24 + 0.5).toFixed(1) + '" fill="' + fill + '" stroke="none"/>';
      }
    }
    var optX = x0 + (r.optDens - dMin) / (dMax - dMin) * xw;
    var optY = y0 + h - (r.optRate - 0.6) / 1.6 * h;
    c2 += '<circle cx="' + optX.toFixed(1) + '" cy="' + optY.toFixed(1) + '" r="5" fill="none" stroke="#2f7d6b" stroke-width="2.2"/>';
    c2 += drawAxes(x0, y0, xw, h);
    c2 += '<text x="' + x0 + '" y="' + (y0 + h + 12) + '" font-size="8" fill="#9aa2a8">0.9</text>';
    c2 += '<text x="' + (x0 + xw - 20) + '" y="' + (y0 + h + 12) + '" font-size="8" fill="#9aa2a8">1.5</text>';
    c2 += '<text x="' + (x0 - 14) + '" y="' + (y0 + 8) + '" font-size="8" fill="#9aa2a8">高排量</text>';
    c2 += '</svg>';
    html(get('optChart'), c2);
    html(get('roOptDens'), f(r.optDens) + ' g/cm³');
    html(get('roOptEff'), f(r.optEff * 100, 0) + '%');

    /* 屏3 结果对比：经验 vs 推荐 */
    var c3 = '';
    c3 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c3 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c3 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">设计对比 · 经验 vs 推荐</text>';
    var cols = [ ['邻井经验', r.exp.dens, r.exp.rate, r.exp.loss, r.exp.cbl, '#b26a39'], ['约束优化推荐', r.opt.dens, r.opt.rate, r.opt.loss, r.opt.cbl, '#2f7d6b'] ];
    for (var ci = 0; ci < 2; ci++) {
      var cx = x0 + ci * (xw / 2 + 10);
      var cw = xw / 2;
      c3 += '<rect x="' + cx + '" y="' + y0 + '" width="' + cw + '" height="' + h + '" rx="8" fill="#fbfaf6" stroke="' + cols[ci][5] + '"/>';
      c3 += '<text x="' + (cx + 14) + '" y="' + (y0 + 26) + '" font-size="11" fill="' + cols[ci][5] + '" font-weight="700">' + cols[ci][0] + '</text>';
      c3 += '<text x="' + (cx + 14) + '" y="' + (y0 + 50) + '" font-size="9.5" fill="#3a4348">密度 ' + f(cols[ci][1]) + ' g/cm³</text>';
      c3 += '<text x="' + (cx + 14) + '" y="' + (y0 + 68) + '" font-size="9.5" fill="#3a4348">排量 ' + f(cols[ci][2]) + ' m³/min</text>';
      c3 += '<text x="' + (cx + 14) + '" y="' + (y0 + 86) + '" font-size="9.5" fill="#3a4348">漏失 ' + (cols[ci][3] ? '是' : '否') + '</text>';
      c3 += '<text x="' + (cx + 14) + '" y="' + (y0 + 104) + '" font-size="9.5" fill="#3a4348">CBL ' + (cols[ci][4] === 0 ? '好' : cols[ci][4] === 1 ? '中' : '差') + '</text>';
    }
    c3 += '</svg>';
    html(get('cmpChart'), c3);
    html(get('roCmpExp'), '漏失' + (r.exp.loss ? '是' : '否') + ' · CBL' + (r.exp.cbl === 0 ? '好' : r.exp.cbl === 1 ? '中' : '差'));
    html(get('roCmpOpt'), '漏失' + (r.opt.loss ? '是' : '否') + ' · CBL' + (r.opt.cbl === 0 ? '好' : r.opt.cbl === 1 ? '中' : '差'));
  }

  function wire() {
    var inW = get('inWell');
    if (inW) inW.addEventListener('input', function () {
      state.well = parseInt(inW.value, 10);
      html(get('outWell'), '井 ' + state.well);
      renderAll();
    });
    var inM = get('inMargin');
    if (inM) inM.addEventListener('input', function () {
      state.margin = parseFloat(inM.value);
      html(get('outMargin'), f(state.margin) + ' g/cm³');
      renderAll();
    });
  }

  function init() {
    wire();
    html(get('outWell'), '井 ' + state.well);
    html(get('outMargin'), f(state.margin) + ' g/cm³');
    renderAll();
  }

  global.RemoteBridge = { M: M, genCementJob: genCementJob, optimizeSlurry: optimizeSlurry, recommendDesign: recommendDesign, live: live, render: renderAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(typeof window !== 'undefined' ? window : global);
