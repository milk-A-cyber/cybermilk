/* =========================================================
   固井质量智能评价 · 模型层 + 浏览器接线
   ---------------------------------------------------------
   纯前端真计算：合成 CBL/VDL 测井（波形 + 胶结指数 + 人工评级段
   + 验窜真值），做胶结指数基线、波形分段分类、验窜验证复核。

   Model（模型层）：genCement / cementEval / segClassify
   浏览器接线：window.RemoteBridge = { M, genCement,
       cementEval, segClassify, live, render }
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
  var GRADES = ['优', '良', '差'];          /* 胶结等级 */

  /* 合成 CBL/VDL 测井：波形 + 胶结指数 + 人工评级段 + 验窜真值 */
  function genCement(n, seed) {
    n = n || 120; seed = seed || 20261211;
    var rnd = mulberry32(seed);
    var cbl = new Float64Array(n);   /* 套管波幅度（归一化） */
    var vdl = new Float64Array(n);   /* 地层波强度 */
    var bi = new Float64Array(n);    /* 胶结指数 0-1 */
    var grade = new Float64Array(n); /* 人工评级 0优/1良/2差 */
    var truth = new Float64Array(n); /* 验窜真值 0/1 */
    var segs = [];

    var gs = [
      { bi0: 0.9, noise: 0.05 }, /* 优 */
      { bi0: 0.65, noise: 0.07 }, /* 良 */
      { bi0: 0.35, noise: 0.10 }  /* 差 */
    ];
    var pos = 0, gi = 0;
    while (pos < n) {
      var len = Math.min(8 + Math.floor(rnd() * 10), n - pos);
      var g = gs[gi % 3];
      segs.push({ s: pos, e: pos + len, g: gi % 3 });
      for (var k = pos; k < pos + len; k++) {
        bi[k] = clamp(g.bi0 + (rnd() - 0.5) * 2 * g.noise, 0.05, 1);
        grade[k] = gi % 3;
        cbl[k] = clamp(1 - bi[k] + (rnd() - 0.5) * 0.28, 0, 1); /* 胶结好→套管波弱（噪声较大） */
        vdl[k] = clamp(bi[k] + (rnd() - 0.5) * 0.12, 0.05, 1);   /* 地层波≈胶结强度（噪声较小） */
        truth[k] = bi[k] > 0.5 ? 0 : 1; /* 验窜：胶结差→窜 */
      }
      pos += len; gi++;
    }

    /* 快速地层/微环隙特例：良里混入少量低胶结、易误判 */
    var sp = 3 + Math.floor(rnd() * 3);
    for (var si = 0; si < sp; si++) {
      var ss = Math.floor(rnd() * (n - 4));
      for (var sk = ss; sk < Math.min(ss + 3, n); sk++) {
        if (grade[sk] === 1) { bi[sk] = clamp(bi[sk] - 0.25, 0.1, 0.9); truth[sk] = 1; }
      }
    }

    return { n: n, cbl: cbl, vdl: vdl, bi: bi, grade: grade, truth: truth, segs: segs, grades: GRADES };
  }

  /* 胶结指数基线：固定阈值分级（优>0.75，良>0.5，否则差） */
  function cementEval(d, thr) {
    thr = thr === undefined ? 0.5 : thr; /* 良/差分界 */
    var n = d.n, pred = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      if (d.bi[i] > 0.75) pred[i] = 0;
      else if (d.bi[i] > thr) pred[i] = 1;
      else pred[i] = 2;
    }
    var errs = [];
    for (var j = 0; j < n; j++) {
      if (pred[j] !== d.grade[j]) errs.push({ idx: j, pred: GRADES[pred[j]], truth: GRADES[d.grade[j]] });
    }
    return { pred: pred, acc: (n - errs.length) / n, errs: errs };
  }

  /* 分段分类：波形特征融合判胶结等级 */
  function segClassify(d, mode) {
    mode = mode === undefined ? 1 : mode;
    var n = d.n, pred = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var score;
      if (mode === 0) score = 1 - d.cbl[i];             /* 单特征：套管波弱→胶结好 */
      else score = 0.55 * (1 - d.cbl[i]) + 0.45 * d.vdl[i]; /* 多特征：套管波+地层波 */
      if (score > 0.7) pred[i] = 0;
      else if (score > 0.45) pred[i] = 1;
      else pred[i] = 2;
    }
    var errs = [];
    for (var j = 0; j < n; j++) {
      if (pred[j] !== d.grade[j]) errs.push({ idx: j, pred: GRADES[pred[j]], truth: GRADES[d.grade[j]] });
    }
    return { pred: pred, acc: (n - errs.length) / n, errs: errs };
  }

  var M = { genCement: genCement, cementEval: cementEval, segClassify: segClassify, GRADES: GRADES };

  /* ---------- 浏览器接线 ---------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = M;
    return;
  }

  var state = { xthr: 0.5, imode: 1 };

  function live() { return { xthr: state.xthr, imode: state.imode }; }

  function get(id) { return document.getElementById(id); }
  function html(el, s) { el.innerHTML = s; }
  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }
  function f1(v) { return f(v, 3); }

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
  function bandSVG(maskArr, x0, y0, xw, h, colors) {
    var s = '';
    for (var i = 0; i < maskArr.length; i++) {
      s += '<rect x="' + (x0 + i * xw / maskArr.length).toFixed(1) + '" y="' + y0 + '" width="' + (xw / maskArr.length + 0.6).toFixed(1) + '" height="' + h + '" fill="' + colors[maskArr[i]] + '" opacity="0.4"/>';
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
    var c = get('biChart');
    return c ? Math.max(240, c.clientWidth || 360) : 360;
  }
  var GCOL = ['#2f7d6b', '#c98a2b', '#b05a51'];

  function renderAll() {
    var W = widthOf(), H = 200, P = 26;
    var x0 = 30, y0 = 30, xw = W - P - 30, h = H - P - 20;
    var d = M.genCement(120, 20261211);
    var ev = M.cementEval(d, state.xthr);
    var s0 = M.segClassify(d, 0), s1 = M.segClassify(d, 1);
    var use = state.imode === 0 ? s0 : s1;

    /* 屏1 胶结指数基线 */
    var c1 = '';
    c1 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c1 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c1 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">胶结指数基线 · 良/差分界=' + f(state.xthr) + ' · Acc=' + f(ev.acc * 100, 1) + '%</text>';
    c1 += bandSVG(d.grade, x0, y0, xw, h, GCOL);
    c1 += gridSVG(x0, y0, xw, h, 4, 3, 0, 1);
    c1 += drawAxes(x0, y0, xw, h);
    c1 += lineSVG(d.bi, x0, y0, xw, h, 0, 1, '#41699b', 1.8);
    for (var i = 0; i < d.n; i++) {
      if (ev.pred[i] !== d.grade[i]) {
        c1 += '<circle cx="' + (x0 + i * xw / d.n).toFixed(1) + '" cy="' + (y0 + h - d.bi[i] * h).toFixed(1) + '" r="2.8" fill="none" stroke="#b05a51" stroke-width="1.4"/>';
      }
    }
    c1 += '</svg>';
    html(get('biChart'), c1);
    html(get('roBiAcc'), f(ev.acc * 100, 1) + '%');
    html(get('roBiErr'), ev.errs.length + ' 点');

    /* 屏2 波形分段分类 */
    var c2 = '';
    c2 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c2 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c2 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">波形分段分类 · ' + (state.imode === 0 ? '单特征' : '多特征融合') + ' · Acc=' + f(use.acc * 100, 1) + '%</text>';
    c2 += bandSVG(d.grade, x0, y0, xw, h, GCOL);
    c2 += gridSVG(x0, y0, xw, h, 4, 3, 0, 1);
    c2 += drawAxes(x0, y0, xw, h);
    c2 += lineSVG(d.cbl, x0, y0, xw, h, 0, 1, '#b26a39', 1.4);
    c2 += lineSVG(d.vdl, x0, y0, xw, h, 0, 1, '#41699b', 1.4);
    for (var m2 = 0; m2 < d.n; m2++) {
      if (use.pred[m2] !== d.grade[m2]) {
        c2 += '<rect x="' + (x0 + m2 * xw / d.n).toFixed(1) + '" y="' + y0 + '" width="' + (xw / d.n + 0.4).toFixed(1) + '" height="' + h + '" fill="none" stroke="#b05a51" stroke-width="1.1"/>';
      }
    }
    c2 += '</svg>';
    html(get('segChart'), c2);
    html(get('roSegAcc'), f(use.acc * 100, 1) + '%');
    html(get('roSeg'), state.imode === 0 ? '单特征' : '多特征');

    /* 屏3 验窜验证 + 复核 */
    var c3 = '';
    c3 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c3 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c3 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">验窜验证 · 分类 vs 验窜真值</text>';
    c3 += bandSVG(d.grade, x0, y0, xw, h, GCOL);
    c3 += gridSVG(x0, y0, xw, h, 4, 3, 0, 1);
    c3 += drawAxes(x0, y0, xw, h);
    c3 += lineSVG(d.vdl, x0, y0, xw, h, 0, 1, '#41699b', 1.4);
    for (var m3 = 0; m3 < d.n; m3++) {
      if (d.truth[m3] === 1) {
        c3 += '<rect x="' + (x0 + m3 * xw / d.n - 1).toFixed(1) + '" y="' + (y0 + 2) + '" width="3" height="' + (h - 4) + '" fill="#b05a51" opacity="0.5"/>';
      }
    }
    c3 += '</svg>';
    html(get('revChart'), c3);
    html(get('roRevErr'), s1.errs.length + ' 点');

    var rev = [];
    s1.errs.slice(0, 6).forEach(function (e) {
      rev.push('<div style="background:#fbfaf6;border:1px solid #ead9c8;border-radius:6px;padding:6px 10px;margin:4px 0;font-size:12px;color:#6b4a35">#' + e.idx + ' · 判' + e.pred + ' 应' + e.truth + '（待验窜复核）</div>');
    });
    if (!rev.length) rev.push('<div style="background:#e6f1ec;border-radius:6px;padding:8px 12px;margin:4px 0;font-size:12px;color:#22604f">无判错，全部符合</div>');
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
      html(get('outMode'), state.imode === 0 ? '单特征' : '多特征融合');
      renderAll();
    });
  }

  function init() {
    wire();
    html(get('outThr'), f(state.xthr, 2));
    html(get('outMode'), state.imode === 0 ? '单特征' : '多特征融合');
    renderAll();
  }

  global.RemoteBridge = { M: M, genCement: genCement, cementEval: cementEval, segClassify: segClassify, live: live, render: renderAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(typeof window !== 'undefined' ? window : global);
