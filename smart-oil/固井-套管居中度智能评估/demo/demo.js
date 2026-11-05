/* =========================================================
   套管居中度智能评估 · 模型层 + 浏览器接线
   ---------------------------------------------------------
   纯前端真计算：从井径与井斜计算居中度曲线，优化扶正器安放
   位置与间距，用 CBL 评级验证。

   Model（模型层）：genCasingGeo / centralizerOpt / standoffEval
   浏览器接线：window.RemoteBridge = { M, genCasingGeo,
       centralizerOpt, standoffEval, live, render }
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
  var GRADES = ['差', '良', '优'];
  var DC = 177.8; /* 套管外径 mm */

  /* 合成全井段井径 + 井斜（含缩径/狗腿段） */
  function genCasingGeo(n, seed) {
    n = n || 120; seed = seed || 20261241;
    var rnd = mulberry32(seed);
    var Db = new Float64Array(n);   /* 井径 mm */
    var incl = new Float64Array(n); /* 井斜 ° */
    var ecc0 = new Float64Array(n); /* 无扶正偏心 mm */
    var base = 235, Dc = DC;
    /* 缩径段：3 处 */
    var shrinks = [];
    for (var s = 0; s < 3; s++) {
      var sc = Math.floor(10 + rnd() * (n - 30));
      shrinks.push(sc);
    }
    /* 狗腿段：2 处 */
    var dogs = [];
    for (var d = 0; d < 2; d++) {
      var dc = Math.floor(8 + rnd() * (n - 20));
      dogs.push(dc);
    }
    for (var i = 0; i < n; i++) {
      var v = base + (rnd() - 0.5) * 6;
      for (var si = 0; si < shrinks.length; si++) {
        var w = Math.max(0, 1 - Math.abs(i - shrinks[si]) / 14);
        v -= w * (14 + rnd() * 8); /* 缩径 */
      }
      Db[i] = v;
      var inc = 4 + rnd() * 4;
      for (var di = 0; di < dogs.length; di++) {
        var wd = Math.max(0, 1 - Math.abs(i - dogs[di]) / 16);
        inc += wd * (14 + rnd() * 12); /* 狗腿 */
      }
      incl[i] = inc;
      /* 无扶正偏心：缩径 + 狗腿 */
      var fShrink = clamp((base - Db[i]) / 30, 0, 1);
      var fDog = clamp((incl[i] - 6) / 26, 0, 1);
      var half = (Db[i] - Dc) / 2;
      ecc0[i] = (0.55 * fShrink + 0.45 * fDog) * Math.max(4, half) * 0.92;
      ecc0[i] = clamp(ecc0[i], 0, Math.max(3, half * 0.92));
    }
    return { n: n, Db: Db, incl: incl, ecc0: ecc0, seed: seed, Dc: Dc, shrinks: shrinks, dogs: dogs };
  }

  /* 扶正器安放：按间距网格安放，缩径/狗腿集中段优先 */
  function centralizerOpt(casing, spacing) {
    spacing = spacing || 25;
    var n = casing.n;
    var pos = [];
    /* 先按间距网格选候选 */
    var candidates = [];
    for (var p = 0; p < n; p += spacing) candidates.push(p);
    /* 在缩径/狗腿集中段补点（每 1/2 间距），优先低居中度 */
    var dens = new Float64Array(n);
    for (var k = 0; k < n; k++) {
      var fShrink = clamp((235 - casing.Db[k]) / 30, 0, 1);
      var fDog = clamp((casing.incl[k] - 6) / 26, 0, 1);
      dens[k] = 0.55 * fShrink + 0.45 * fDog;
    }
    for (var c = 0; c < candidates.length; c++) {
      var ci = candidates[c];
      /* 若该点附近居中度低，加密（半间距再放一个） */
      var nearby = false;
      for (var j = Math.max(0, ci - Math.floor(spacing / 2)); j <= Math.min(n - 1, ci + Math.floor(spacing / 2)); j++) {
        if (dens[j] > 0.45) nearby = true;
      }
      if (nearby) {
        var mid = Math.floor(ci + spacing / 2);
        if (mid < n && !pos.indexOf) {}
      }
    }
    pos = candidates.slice();
    /* 在低居中度段再补 1/2 间距点 */
    for (var q = 0; q < candidates.length; q++) {
      var m = Math.floor(candidates[q] + spacing / 2);
      if (m < n) {
        var need = false;
        for (var r = Math.max(0, m - 5); r <= Math.min(n - 1, m + 5); r++) if (dens[r] > 0.35) need = true;
        if (need) pos.push(m);
      }
    }
    pos.sort(function (a, b) { return a - b; });
    return { positions: pos, count: pos.length, spacing: spacing };
  }

  /* 居中度评估：计算 standoff 曲线 + CBL 评级 */
  function standoffEval(casing, positions) {
    var n = casing.n;
    var so0 = new Float64Array(n);
    var so1 = new Float64Array(n);
    var ecc1 = new Float64Array(n);
    var half = new Float64Array(n);
    for (var i = 0; i < n; i++) half[i] = Math.max(2, (casing.Db[i] - casing.Dc) / 2);
    for (var k = 0; k < n; k++) {
      so0[k] = 1 - casing.ecc0[k] / half[k];
      so0[k] = clamp(so0[k], 0, 1);
    }
    /* 有扶正：扶正器处偏心↓，之间按到最近扶正器距离劣化 */
    var span = Math.max(4, (positions.length > 1 ? positions[1] - positions[0] : 20));
    for (var j = 0; j < n; j++) {
      var dmin = n;
      for (var p = 0; p < positions.length; p++) {
        var dd = Math.abs(j - positions[p]);
        if (dd < dmin) dmin = dd;
      }
      var frac = clamp(dmin / (span / 2), 0, 1);
      ecc1[j] = casing.ecc0[j] * (0.15 + 0.85 * frac);
      so1[j] = 1 - ecc1[j] / half[j];
      so1[j] = clamp(so1[j], 0, 1);
    }
    var grade0 = new Array(n), grade1 = new Array(n);
    var g = function (so) { return so > 0.8 ? 2 : so > 0.6 ? 1 : 0; };
    var avg0 = 0, avg1 = 0, g0 = 0, g1 = 0;
    for (var m = 0; m < n; m++) {
      grade0[m] = GRADES[g(so0[m])];
      grade1[m] = GRADES[g(so1[m])];
      avg0 += so0[m]; avg1 += so1[m];
      if (g(so0[m]) === 2) g0++;
      if (g(so1[m]) === 2) g1++;
    }
    avg0 /= n; avg1 /= n;
    return {
      so0: so0, so1: so1, ecc1: ecc1, grade0: grade0, grade1: grade1,
      avg0: avg0, avg1: avg1, good0: g0 / n, good1: g1 / n, n: n
    };
  }

  var M = { genCasingGeo: genCasingGeo, centralizerOpt: centralizerOpt, standoffEval: standoffEval, GRADES: GRADES, DC: DC };

  /* ---------- 浏览器接线 ---------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = M;
    return;
  }

  var casing = M.genCasingGeo(120, 20261241);
  var state = { spacing: 25 };

  function live() { return { spacing: state.spacing }; }

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
    var c = get('geoChart');
    return c ? Math.max(240, c.clientWidth || 360) : 360;
  }

  function renderAll() {
    var W = widthOf(), H = 200, P = 26;
    var x0 = 30, y0 = 30, xw = W - P - 30, h = H - P - 20;
    var opt = M.centralizerOpt(casing, state.spacing);
    var ev = M.standoffEval(casing, opt.positions);

    /* 屏1 井径与井斜剖面 */
    var c1 = '';
    c1 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c1 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c1 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">井径与井斜剖面</text>';
    c1 += gridSVG(x0, y0, xw, h, 4, 3, 200, 245);
    c1 += drawAxes(x0, y0, xw, h);
    c1 += lineSVG(casing.Db, x0, y0, xw, h, 200, 245, '#41699b', 1.6);
    /* 井斜右侧轴线 */
    var ax2 = x0 + xw + 8;
    c1 += '<line x1="' + ax2 + '" y1="' + y0 + '" x2="' + ax2 + '" y2="' + (y0 + h) + '" stroke="#b26a39" stroke-width="1.2"/>';
    var pArr = [];
    for (var di = 0; di < casing.n; di++) pArr.push(casing.incl[di]);
    /* 井斜映射到同一 y 高度（0-35°） */
    for (var dj = 0; dj < casing.n; dj++) {
      var yi = y0 + h - (casing.incl[dj] - 0) / 35 * h;
      var xi = x0 + dj * xw / casing.n;
      c1 += '<line x1="' + xi.toFixed(1) + '" y1="' + (yi - 1).toFixed(1) + '" x2="' + xi.toFixed(1) + '" y2="' + (yi + 1).toFixed(1) + '" stroke="#b26a39" stroke-width="1.2" opacity="0.7"/>';
    }
    c1 += '<text x="' + (x0 + xw + 2) + '" y="' + (y0 + 10) + '" font-size="7.5" fill="#b26a39">井斜°</text>';
    c1 += '<text x="' + (x0 + xw / 2) + '" y="' + (y0 + h + 14) + '" text-anchor="middle" font-size="8" fill="#9aa2a8">井段 →</text>';
    c1 += '</svg>';
    html(get('geoChart'), c1);
    html(get('roGeoLen'), casing.n + ' 段');
    var maxDog = 0;
    for (var di2 = 0; di2 < casing.n; di2++) if (casing.incl[di2] > maxDog) maxDog = casing.incl[di2];
    html(get('roGeoDog'), f(maxDog, 0) + '°');

    /* 屏2 居中度曲线 */
    var c2 = '';
    c2 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c2 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c2 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">居中度曲线 · 无扶正 vs 有扶正</text>';
    c2 += gridSVG(x0, y0, xw, h, 4, 3, 0.3, 1);
    c2 += drawAxes(x0, y0, xw, h);
    c2 += lineSVG(ev.so0, x0, y0, xw, h, 0.3, 1, '#8a9aa8', 1.4);
    c2 += lineSVG(ev.so1, x0, y0, xw, h, 0.3, 1, '#2f7d6b', 2.2);
    c2 += '<line x1="' + x0 + '" y1="' + (y0 + h - (0.8 - 0.3) / 0.7 * h) + '" x2="' + (x0 + xw) + '" y2="' + (y0 + h - (0.8 - 0.3) / 0.7 * h) + '" stroke="#b26a39" stroke-width="1" stroke-dasharray="4 3"/>';
    c2 += '<text x="' + (x0 + xw) + '" y="' + (y0 + h - (0.8 - 0.3) / 0.7 * h - 3) + '" font-size="7.5" fill="#b26a39" text-anchor="end">优 0.8</text>';
    c2 += '</svg>';
    html(get('soChart'), c2);
    html(get('roSoAvg0'), f(ev.avg0 * 100, 0) + '%');
    html(get('roSoAvg1'), f(ev.avg1 * 100, 0) + '%');

    /* 屏3 扶正器安放优化 */
    var c3 = '';
    c3 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c3 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c3 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">扶正器安放 · 位置与间距 ' + state.spacing + 'm</text>';
    c3 += gridSVG(x0, y0, xw, h, 4, 3, 0.3, 1);
    c3 += drawAxes(x0, y0, xw, h);
    c3 += lineSVG(ev.so1, x0, y0, xw, h, 0.3, 1, '#2f7d6b', 1.8);
    for (var pi = 0; pi < opt.positions.length; pi++) {
      var px = x0 + opt.positions[pi] * xw / casing.n;
      c3 += '<line x1="' + px.toFixed(1) + '" y1="' + y0 + '" x2="' + px.toFixed(1) + '" y2="' + (y0 + h) + '" stroke="#b05a51" stroke-width="1.4"/>';
    }
    c3 += '<text x="' + (x0 + xw) + '" y="' + (y0 + h + 14) + '" text-anchor="end" font-size="8" fill="#9aa2a8">红竖线=扶正器</text>';
    c3 += '</svg>';
    html(get('optChart'), c3);
    html(get('roOptN'), opt.count + ' 只');
    html(get('roOptImpr'), '+' + f((ev.avg1 - ev.avg0) * 100, 0) + ' 百分点');
    /* reviewList：CBL 评级验证 */
    var good0 = Math.round(ev.good0 * casing.n), good1 = Math.round(ev.good1 * casing.n);
    html(get('reviewList'),
      '<div class="rvrow"><span>无扶正 · 优段</span><b>' + good0 + '/' + casing.n + '</b></div>' +
      '<div class="rvrow"><span>有扶正 · 优段</span><b>' + good1 + '/' + casing.n + '</b></div>' +
      '<div class="rvrow"><span>平均居中度</span><b>' + f(ev.avg0 * 100, 0) + '% → ' + f(ev.avg1 * 100, 0) + '%</b></div>');
  }

  function wire() {
    var inS = get('inSpacing');
    if (inS) inS.addEventListener('input', function () {
      state.spacing = parseInt(inS.value, 10);
      html(get('outSpacing'), state.spacing + ' m');
      renderAll();
    });
  }

  function init() {
    wire();
    html(get('outSpacing'), state.spacing + ' m');
    renderAll();
  }

  global.RemoteBridge = { M: M, genCasingGeo: genCasingGeo, centralizerOpt: centralizerOpt, standoffEval: standoffEval, live: live, render: renderAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(typeof window !== 'undefined' ? window : global);
