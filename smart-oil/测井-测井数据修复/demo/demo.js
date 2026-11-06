/* =========================================================
   测井数据修复 · 模型层 + 浏览器接线
   ---------------------------------------------------------
   纯前端真计算：合成多曲线测井（含缺失段/异常跳变/邻井参考
   /井径工程记录），做缺失/异常识别、序列插补（掩码自编码）、
   跨曲线生成补全。

   Model（模型层）：genLogMissing / detectAnomaly / impute
   浏览器接线：window.RemoteBridge = { M, genLogMissing,
       detectAnomaly, impute, live, render }
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
  var CURVES = ['GR', 'RT', 'DEN'];

  /* 合成多曲线测井：含缺失段、异常跳变、邻井参考、井径工程记录 */
  function genLogMissing(n, seed) {
    n = n || 120; seed = seed || 20261171;
    var rnd = mulberry32(seed);
    var gr = new Float64Array(n), rt = new Float64Array(n), den = new Float64Array(n);
    var ogr = new Float64Array(n), ort = new Float64Array(n), odn = new Float64Array(n);
    var refGr = new Float64Array(n), refRt = new Float64Array(n), refDen = new Float64Array(n);
    var mask = new Float64Array(n), anomaly = new Float64Array(n), cal = new Float64Array(n);
    var segs = [];

    /* 分段基线（模拟层序） */
    var bases = [
      { bgr: 0.6, brt: 1.6, bden: 2.45 },
      { bgr: 1.3, brt: 2.4, bden: 2.55 },
      { bgr: 2.1, brt: 1.2, bden: 2.6 },
      { bgr: 1.5, brt: 2.9, bden: 2.5 },
      { bgr: 2.6, brt: 2.0, bden: 2.65 },
      { bgr: 0.9, brt: 1.1, bden: 2.4 }
    ];
    var pos = 0, bi = 0;
    while (pos < n) {
      var len = Math.min(8 + Math.floor(rnd() * 10), n - pos);
      var b = bases[bi % bases.length];
      segs.push({ s: pos, e: pos + len, bgr: b.bgr, brt: b.brt, bden: b.bden });
      for (var k = pos; k < pos + len; k++) {
        var vg = clamp(b.bgr + (rnd() - 0.5) * 0.3, 0.2, 3);
        var vr = clamp(b.brt + (rnd() - 0.5) * 0.3, 0.2, 3.2);
        var vd = clamp(b.bden + (rnd() - 0.5) * 0.05, 2.0, 2.9);
        gr[k] = vg; rt[k] = vr; den[k] = vd;
        ogr[k] = vg; ort[k] = vr; odn[k] = vd;
        /* 邻井参考：同基线、不同噪声（无缺失无异常） */
        refGr[k] = clamp(b.bgr + (rnd() - 0.5) * 0.3, 0.2, 3);
        refRt[k] = clamp(b.brt + (rnd() - 0.5) * 0.3, 0.2, 3.2);
        refDen[k] = clamp(b.bden + (rnd() - 0.5) * 0.05, 2.0, 2.9);
        cal[k] = clamp(12 + (rnd() - 0.5) * 1.2, 10, 14);
      }
      pos += len; bi++;
    }

    /* 缺失段：随机 3 段，置 -1 表示缺失（保留真值于 orig） */
    var missCount = 3 + Math.floor(rnd() * 2);
    for (var mi = 0; mi < missCount; mi++) {
      var ms = Math.floor(rnd() * (n - 10));
      var ml = 6 + Math.floor(rnd() * 6);
      if (ms + ml > n) continue;
      for (var mk = ms; mk < ms + ml; mk++) {
        if (mask[mk] === 1) continue;
        mask[mk] = 1; gr[mk] = -1; rt[mk] = -1; den[mk] = -1;
      }
    }

    /* 异常跳变：随机 2 段附近加突跳（只对非缺失点），并对应井径异常 */
    var anCount = 2 + Math.floor(rnd() * 2);
    for (var ai = 0; ai < anCount; ai++) {
      var as = Math.floor(rnd() * (n - 4));
      for (var ak = as; ak < Math.min(as + 4, n); ak++) {
        if (mask[ak] === 1) continue;
        anomaly[ak] = 1;
        gr[ak] = clamp(ogr[ak] + (rnd() > 0.5 ? 0.9 : -0.9), 0.2, 3);
        if (rnd() > 0.4) cal[ak] = clamp(cal[ak] + (rnd() > 0.5 ? 3 : -3), 8, 17);
      }
    }

    return { n: n, gr: gr, rt: rt, den: den, origGr: ogr, origRt: ort, origDen: odn,
             mask: mask, anomaly: anomaly, cal: cal,
             refGr: refGr, refRt: refRt, refDen: refDen, segs: segs, curves: CURVES };
  }

  /* 缺失/异常识别：阈值检测 + 异常置信度 */
  function detectAnomaly(d, mode, thr) {
    mode = mode === undefined ? 1 : mode; thr = thr === undefined ? 1.0 : thr;
    var n = d.n, pred = new Float64Array(n), conf = new Float64Array(n);
    for (var k = 0; k < n; k++) {
      if (d.mask[k] === 1) { pred[k] = 1; conf[k] = 1; continue; }
      /* 局部窗口均值（逐点取，非常量） */
      var sum = 0, cnt = 0;
      for (var w = -2; w <= 2; w++) {
        var j = k + w;
        if (j >= 0 && j < n && d.mask[j] !== 1) { sum += d.gr[j]; cnt++; }
      }
      var base = cnt ? sum / cnt : d.gr[k];
      var jump = Math.abs(d.gr[k] - base);
      var diff = Math.abs(d.gr[k] - d.refGr[k]); /* 跨曲线/邻井差异 */
      var score = mode === 0 ? jump : (jump * 0.6 + diff * 0.6);
      conf[k] = clamp(score / (thr + 0.4), 0, 1);
      if (score > thr) pred[k] = 1;
    }
    /* 与真值（缺失∪异常）比对 */
    var errs = [];
    for (var i = 0; i < n; i++) {
      var truth = d.mask[i] === 1 || d.anomaly[i] === 1;
      var p = pred[i] === 1;
      if (truth !== p) errs.push({ idx: i, pred: p, truth: truth, conf: +conf[i].toFixed(2) });
    }
    var acc = (n - errs.length) / n;
    return { pred: pred, conf: conf, acc: acc, errs: errs };
  }

  /* 序列插补：补全缺失段 */
  function impute(d, mode) {
    mode = mode === undefined ? 1 : mode;
    var n = d.n;
    var gr = Float64Array.from(d.gr), rt = Float64Array.from(d.rt), den = Float64Array.from(d.den);
    /* 先定位每个缺失点 */
    var miss = [];
    for (var i = 0; i < n; i++) if (d.mask[i] === 1) miss.push(i);

    if (mode === 0) {
      /* 邻点插值：前/后最近有效值线性插值 */
      for (var mi = 0; mi < miss.length; mi++) {
        var k = miss[mi], a = k - 1, b = k + 1;
        while (a >= 0 && d.mask[a] === 1) a--;
        while (b < n && d.mask[b] === 1) b++;
        if (a < 0) a = 0; if (b >= n) b = n - 1;
        var t = (b === a) ? 0 : (k - a) / (b - a);
        gr[k] = d.origGr[a] + (d.origGr[b] - d.origGr[a]) * t;
        rt[k] = d.origRt[a] + (d.origRt[b] - d.origRt[a]) * t;
        den[k] = d.origDen[a] + (d.origDen[b] - d.origDen[a]) * t;
      }
    } else {
      /* 跨曲线生成：用邻井参考 + 局部偏移映射 */
      for (var mi2 = 0; mi2 < miss.length; mi2++) {
        var k2 = miss[mi2], a2 = k2 - 1, b2 = k2 + 1;
        while (a2 >= 0 && d.mask[a2] === 1) a2--;
        while (b2 < n && d.mask[b2] === 1) b2++;
        if (a2 < 0) a2 = 0; if (b2 >= n) b2 = n - 1;
        var offG = (d.origGr[a2] - d.refGr[a2] + d.origGr[b2] - d.refGr[b2]) / 2;
        var offR = (d.origRt[a2] - d.refRt[a2] + d.origRt[b2] - d.refRt[b2]) / 2;
        var offD = (d.origDen[a2] - d.refDen[a2] + d.origDen[b2] - d.refDen[b2]) / 2;
        gr[k2] = clamp(d.refGr[k2] + offG, 0.2, 3);
        rt[k2] = clamp(d.refRt[k2] + offR, 0.2, 3.2);
        den[k2] = clamp(d.refDen[k2] + offD, 2.0, 2.9);
      }
    }

    /* 重建误差（对缺失点，与真值比） */
    var sum = 0, cnt = 0;
    for (var j = 0; j < n; j++) {
      if (d.mask[j] === 1) {
        var e = Math.abs(gr[j] - d.origGr[j]) + Math.abs(rt[j] - d.origRt[j]) + Math.abs(den[j] - d.origDen[j]);
        sum += e; cnt++;
      }
    }
    var mae = cnt ? sum / cnt : 0;
    /* 置信度与待复核（误差偏大的缺失点；长缺失段不确定性高） */
    var conf = new Float64Array(n), errs = [];
    var seg = [];
    for (var si = 0; si <= miss.length; si++) {
      if (si === miss.length || (si > 0 && miss[si] !== miss[si - 1] + 1)) {
        if (seg.length) {
          for (var qi = 0; qi < seg.length; qi++) {
            var p = seg[qi];
            var e2 = Math.abs(gr[p] - d.origGr[p]) + Math.abs(rt[p] - d.origRt[p]) + Math.abs(den[p] - d.origDen[p]);
            var c = clamp(1 - e2 / 2.5, 0, 1);
            if (seg.length > 9) c = clamp(c - 0.18, 0, 1); /* 长缺失段中部更不确定 */
            conf[p] = c;
            if (c < 0.78) errs.push({ idx: p, conf: +c.toFixed(2), pred: CURVES[0] + '·' + CURVES[1] + '·' + CURVES[2] });
          }
        }
        seg = [];
      }
      if (si < miss.length) seg.push(miss[si]);
    }
    return { gr: gr, rt: rt, den: den, mae: mae, conf: conf, errs: errs, mode: mode };
  }

  var M = { genLogMissing: genLogMissing, detectAnomaly: detectAnomaly, impute: impute, CURVES: CURVES };

  /* ---------- 浏览器接线 ---------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = M;
    return;
  }

  var state = { xthr: 1.0, imode: 1 };

  function live() { return { xthr: state.xthr, imode: state.imode }; }

  function get(id) { return document.getElementById(id); }
  function html(el, s) { el.innerHTML = s; }
  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }
  function f1(v) { return f(v, 3); }
  function ns(x, y, val) { return '<ns x="' + x + '" y="' + y + '">' + val + '</ns>'; }

  function lineSVG(arr, x0, y0, xw, h, minV, maxV, color, width) {
    var s = '<path d="M';
    for (var i = 0; i < arr.length; i++) {
      var y = y0 + h - (arr[i] - minV) / (maxV - minV) * h;
      s += (x0 + i * xw / arr.length).toFixed(1) + ' ' + y.toFixed(1);
      if (i < arr.length - 1) s += ' L';
    }
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (width || 1.6) + '"/>';
    return s;
  }
  function bandSVG(maskArr, x0, y0, xw, h, color) {
    var s = '';
    for (var i = 0; i < maskArr.length; i++) {
      if (maskArr[i] === 1) {
        s += '<rect x="' + (x0 + i * xw / maskArr.length).toFixed(1) + '" y="' + y0 + '" width="' + (xw / maskArr.length + 0.6).toFixed(1) + '" height="' + h + '" fill="' + color + '"/>';
      }
    }
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
    var c = get('detChart');
    return c ? Math.max(240, c.clientWidth || 360) : 360;
  }

  function renderAll() {
    var W = widthOf(), H = 200, P = 26;
    var x0 = 30, y0 = 30, xw = W - P - 30, h = H - P - 20;
    var d = M.genLogMissing(120, 20261171);
    var det0 = M.detectAnomaly(d, 0, state.xthr);
    var det1 = M.detectAnomaly(d, 1, state.xthr);
    var imp0 = M.impute(d, 0), imp1 = M.impute(d, 1);
    var use = state.imode === 0 ? imp0 : imp1;

    var gmin = 0, gmax = 3, tmin = 0, tmax = 3.2;

    /* 屏1 缺失/异常识别 */
    var c1 = '';
    c1 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c1 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c1 += '<text x="' + (P) + '" y="16" font-size="11" fill="#242b2e" font-weight="600">缺失/异常识别 · 阈值=' + f(state.xthr) + ' · 异常 ' + (det1.pred.reduce(function (a, b) { return a + b; }, 0)) + ' 点</text>';
    c1 += bandSVG(d.mask, x0, y0, xw, h, '#f3e3d8');
    c1 += gridSVG(x0, y0, xw, h, 4, 3, gmin, gmax);
    c1 += drawAxes(x0, y0, xw, h);
    c1 += lineSVG(d.gr, x0, y0, xw, h, gmin, gmax, '#41699b', 1.6);
    /* 异常点 */
    for (var i = 0; i < d.n; i++) {
      if (d.anomaly[i] === 1) {
        c1 += '<circle cx="' + (x0 + i * xw / d.n).toFixed(1) + '" cy="' + (y0 + h - (d.gr[i] - gmin) / (gmax - gmin) * h).toFixed(1) + '" r="3" fill="none" stroke="#b05a51" stroke-width="1.4"/>';
      }
    }
    c1 += '</svg>';
    html(get('detChart'), c1);
    html(get('roDetAcc'), f(det1.acc * 100, 1) + '%');
    html(get('roDetErr'), det1.errs.length + ' 点');

    /* 屏2 序列插补 */
    var c2 = '';
    c2 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c2 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c2 += '<text x="' + (P) + '" y="16" font-size="11" fill="#242b2e" font-weight="600">序列插补 · ' + (state.imode === 0 ? '邻点插值' : '跨曲线生成') + ' · 重建误差=' + f1(use.mae) + '</text>';
    c2 += bandSVG(d.mask, x0, y0, xw, h, '#f3e3d8');
    c2 += gridSVG(x0, y0, xw, h, 4, 3, gmin, gmax);
    c2 += drawAxes(x0, y0, xw, h);
    c2 += lineSVG(d.origGr, x0, y0, xw, h, gmin, gmax, '#d8dbdd', 1); /* 真值 */
    c2 += lineSVG(use.gr, x0, y0, xw, h, gmin, gmax, '#2f7d6b', 2); /* 补全 */
    for (var m2 = 0; m2 < d.n; m2++) {
      if (d.mask[m2] === 1) {
        c2 += '<rect x="' + (x0 + m2 * xw / d.n - 1).toFixed(1) + '" y="' + (y0 + 4) + '" width="3" height="' + (h - 8) + '" fill="#b26a39" opacity="0.55"/>';
      }
    }
    c2 += '</svg>';
    html(get('impChart'), c2);
    html(get('roImpAcc'), f1(use.mae));
    html(get('roImpErr'), use.errs.length + ' 段');

    /* 屏3 邻井参考 + 井径工程验证 */
    var c3 = '';
    c3 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c3 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c3 += '<text x="' + (P) + '" y="16" font-size="11" fill="#242b2e" font-weight="600">跨曲线生成 + 邻井参考 · 异常置信度</text>';
    c3 += bandSVG(d.mask, x0, y0, xw, h, '#f3e3d8');
    c3 += gridSVG(x0, y0, xw, h, 4, 3, gmin, gmax);
    c3 += drawAxes(x0, y0, xw, h);
    c3 += lineSVG(d.refGr, x0, y0, xw, h, gmin, gmax, '#b8c2c9', 1.2); /* 邻井参考 */
    c3 += lineSVG(imp1.gr, x0, y0, xw, h, gmin, gmax, '#2f7d6b', 2); /* 跨曲线补全 */
    c3 += lineSVG(d.cal.map(function (v) { return (v - 8) / 3; }), x0, y0, xw, h, gmin, gmax, '#b05a51', 1.1); /* 井径 */
    for (var m3 = 0; m3 < d.n; m3++) {
      if (d.anomaly[m3] === 1) {
        c3 += '<circle cx="' + (x0 + m3 * xw / d.n).toFixed(1) + '" cy="' + (y0 + h - (d.gr[m3] - gmin) / (gmax - gmin) * h).toFixed(1) + '" r="3" fill="none" stroke="#b05a51" stroke-width="1.4"/>';
      }
    }
    c3 += '</svg>';
    html(get('verChart'), c3);
    html(get('roVerErr'), det1.errs.length + ' 点');

    /* 复核清单 */
    var rev = [];
    det1.errs.slice(0, 6).forEach(function (e) {
      rev.push('<div style="background:#fbfaf6;border:1px solid #ead9c8;border-radius:6px;padding:6px 10px;margin:4px 0;font-size:12px;color:#6b4a35">#' + e.idx + ' · ' + (e.pred ? '误检(异常)' : '漏检(异常)') + ' · 置信度 ' + e.conf + '</div>');
    });
    if (!rev.length) rev.push('<div style="background:#e6f1ec;border-radius:6px;padding:8px 12px;margin:4px 0;font-size:12px;color:#22604f">无异常点，全部符合</div>');
    html(get('reviewList'), rev.join(''));
  }

  function wire() {
    var inX = get('inThr');
    if (inX) inX.addEventListener('input', function () {
      state.xthr = parseFloat(inX.value);
      html(get('outThr'), f(state.xthr, 2));
      renderAll();
    });
    var inM = get('inMode');
    if (inM) inM.addEventListener('input', function () {
      state.imode = parseInt(inM.value, 10);
      html(get('outMode'), state.imode === 0 ? '邻点插值' : '跨曲线生成');
      renderAll();
    });
  }

  function init() {
    wire();
    html(get('outThr'), f(state.xthr, 2));
    html(get('outMode'), state.imode === 0 ? '邻点插值' : '跨曲线生成');
    renderAll();
  }

  global.RemoteBridge = { M: M, genLogMissing: genLogMissing, detectAnomaly: detectAnomaly, impute: impute, live: live, render: renderAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(typeof window !== 'undefined' ? window : global);
