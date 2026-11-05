/* =========================================================
   成像测井裂缝识别 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  裂缝语义分割：成像图 → 裂缝掩膜
   屏 2  细长目标检测 + 诱导缝鉴别
   屏 3  岩心描述验证 + 复核
   所有计算都在浏览器里完成，纯前端。
   ========================================================= */
(function (global) {
  'use strict';

  /* =====================================================
     纯模型层（Node 可 require 做单测；浏览器里继续往下走）
     ===================================================== */
  var Model = (function () {

    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function mulberry32(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    /* -----------------------------------------------------
       合成成像图 + 裂缝（电成像裂缝呈正弦，天然缝幅值大、
       诱导缝幅值小易混淆）
       返回 { W, H, cells(亮度 0-1), mask(裂缝=1), fracs }
       ----------------------------------------------------- */
    function genImage(seed, W, H) {
      W = W || 30; H = H || 20;
      var rnd = mulberry32(seed || 20261191);
      var cells = new Float64Array(W * H), mask = new Float64Array(W * H);
      /* 背景噪声 */
      for (var i = 0; i < W * H; i++) cells[i] = 0.2 + rnd() * 0.4;
      /* 裂缝：y = y0 + amp*sin(2π*(x-x0)/W * k + ph) */
      var fracs = [
        { x0: 0, y0: 6, amp: 3.6, k: 2, ph: 0.3, wdt: 1.6, type: 'nat' },
        { x0: 0, y0: 14, amp: 3.0, k: 1, ph: 1.1, wdt: 1.3, type: 'nat' },
        { x0: 0, y0: 10, amp: 2.0, k: 1, ph: 2.4, wdt: 1.0, type: 'nat' }, /* 低角度，临界 */
        { x0: 0, y0: 17, amp: 0.9, k: 2, ph: 0.8, wdt: 0.9, type: 'ind' },
        { x0: 0, y0: 3, amp: 2.1, k: 1, ph: 1.9, wdt: 1.0, type: 'ind' },
        { x0: 0, y0: 8, amp: 1.9, k: 3, ph: 0.1, wdt: 0.9, type: 'ind' } /* 较高，混淆 */
      ];
      for (var f = 0; f < fracs.length; f++) {
        var fr = fracs[f];
        for (var x = 0; x < W; x++) {
          var y = fr.y0 + fr.amp * Math.sin(2 * Math.PI * x / W * fr.k + fr.ph);
          for (var dy = -fr.wdt; dy <= fr.wdt; dy++) {
            var yy = Math.round(y + dy);
            if (yy < 0 || yy >= H) continue;
            var idx = yy * W + x;
            cells[idx] = 0.78 + rnd() * 0.17;
            mask[idx] = 1;
          }
        }
      }
      return { W: W, H: H, cells: cells, mask: mask, fracs: fracs };
    }

    /* -----------------------------------------------------
       裂缝语义分割：阈值划分裂缝像元
       thresh 低=更敏感（误检多），高=更保守（漏检多）
       返回 { seg, iou, tp, fp, fn, acc }
       ----------------------------------------------------- */
    function fractureSeg(img, thresh) {
      var W = img.W, H = img.H, n = W * H;
      var seg = new Float64Array(n);
      var tp = 0, fp = 0, fn = 0;
      for (var i = 0; i < n; i++) {
        seg[i] = img.cells[i] >= thresh ? 1 : 0;
        if (seg[i] === 1 && img.mask[i] === 1) tp++;
        else if (seg[i] === 1 && img.mask[i] === 0) fp++;
        else if (seg[i] === 0 && img.mask[i] === 1) fn++;
      }
      var iou = (tp + fp + fn) > 0 ? tp / (tp + fp + fn) : 0;
      var acc = n > 0 ? (tp + (n - tp - fp - fn)) / n : 0;
      return { seg: seg, iou: iou, tp: tp, fp: fp, fn: fn, acc: acc };
    }

    /* -----------------------------------------------------
       诱导缝鉴别：天然缝幅值大、诱导缝幅值小
       mode 0 松(阈值1.8)，1 严(阈值2.4)
       返回 { list:[{idx,pred,true,conf}], err }
       ----------------------------------------------------- */
    function fractureFilter(img, mode) {
      var th = mode === 0 ? 1.8 : 2.4;
      var list = [], err = 0;
      for (var i = 0; i < img.fracs.length; i++) {
        var fr = img.fracs[i];
        var pred = fr.amp >= th ? 'nat' : 'ind';
        var ok = pred === fr.type;
        if (!ok) err++;
        list.push({ idx: i, pred: pred, true: fr.type, ok: ok, amp: fr.amp, conf: ok ? 0.9 : 0.55 });
      }
      return { list: list, err: err, mode: mode, th: th };
    }

    return {
      clamp: clamp, mulberry32: mulberry32,
      genImage: genImage, fractureSeg: fractureSeg, fractureFilter: fractureFilter
    };
  })();

  /* Node 单测入口 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Model;
    return;
  }

  /* =====================================================
     浏览器接线（沙箱 iframe 内执行）
     ===================================================== */
  var doc = document;
  var $ = function (id) { return doc.getElementById(id); };
  var M = Model;
  var clamp = M.clamp;
  var num = function (v, d) { return v.toFixed(d == null ? 2 : d); };

  var state = { segTh: 0.55, filMode: 0, revMode: 0 };
  var img = M.genImage(20261191, 30, 20);

  global.RemoteBridge = {
    M: M,
    genImage: M.genImage, fractureSeg: M.fractureSeg, fractureFilter: M.fractureFilter,
    live: function () { return { segTh: state.segTh, filMode: state.filMode, revMode: state.revMode }; }
  };

  /* 成像图网格渲染：原图亮度 + 掩膜/分割叠加 */
  function renderGrid(svg, img, over) {
    var W = img.W, H = img.H, cw = 300 / W, ch = 150 / H;
    var s = '';
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var v = img.cells[y * W + x];
        var g = Math.round(clamp(v, 0, 1) * 200);
        var fill = 'rgb(' + g + ',' + g + ',' + g + ')';
        if (over && over[y * W + x] === 1) fill = 'rgba(178,106,57,0.85)';
        s += '<rect x="' + (x * cw).toFixed(1) + '" y="' + (y * ch).toFixed(1) + '" width="' + (cw + 0.2).toFixed(1) + '" height="' + (ch + 0.2).toFixed(1) + '" fill="' + fill + '"/>';
      }
    }
    return s;
  }

  /* ---------- 屏 1 渲染：裂缝语义分割 ---------- */
  function renderSeg() {
    img = M.genImage(20261191, 30, 20);
    var sg = M.fractureSeg(img, state.segTh);
    var s = '';
    var x0 = 30, y0 = 34, w = 300, h = 150;
    s += '<text x="30" y="20" font-size="9" fill="#4d565b" font-weight="700">裂缝语义分割 · IoU=' + num(sg.iou) + ' · Acc=' + num(sg.acc) + '</text>';
    s += renderGrid('', img, sg.seg);
    s = s.replace('<rect x="0.0" y="0.0"', '<rect x="' + x0 + '" y="' + y0 + '"');
    /* 简化：用 translate 包裹 */
    s = '<g transform="translate(' + x0 + ',' + y0 + ')">' + s + '</g>';
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 + h + 18) + '" font-size="7.5" fill="#79828a">橙色=判为裂缝 · 阈值 ' + num(state.segTh) + '</text>';
    $('segChart').innerHTML = s;
    $('roIoU').textContent = num(sg.iou);
    $('roAcc').textContent = num(sg.acc);
    $('roSeg').textContent = 'TP ' + sg.tp + ' / FP ' + sg.fp + ' / FN ' + sg.fn;
  }

  /* ---------- 屏 2 渲染：细长目标检测 + 诱导缝鉴别 ---------- */
  function renderFil() {
    img = M.genImage(20261191, 30, 20);
    var ff = M.fractureFilter(img, state.filMode);
    var s = '';
    var x0 = 30, y0 = 34, w = 300, h = 150;
    s += '<text x="30" y="20" font-size="9" fill="#4d565b" font-weight="700">诱导缝鉴别 · ' + (state.filMode === 0 ? '宽松(阈1.8)' : '严格(阈2.4)') + ' · 判错 ' + ff.err + ' 条</text>';
    s += renderGrid('', img, null);
    /* 标出每条裂缝为天然(蓝)/诱导(绿) */
    ff.list.forEach(function (it) {
      var fr = img.fracs[it.idx];
      var col = it.pred === 'nat' ? '#41699b' : '#2f7d6b';
      var yy = fr.y0 * 150 / 20;
      var dx = fr.amp * 150 / 20;
      s += '<path d="M' + (x0) + ' ' + (y0 + yy) + ' q ' + (150) + ' ' + (-dx) + ' ' + (300) + ' 0" fill="none" stroke="' + col + '" stroke-width="1.8"/>';
    });
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 4) + '" font-size="7.5" fill="#41699b">蓝=天然</text>';
    s += '<text x="' + (x0 + 90) + '" y="' + (y0 - 4) + '" font-size="7.5" fill="#2f7d6b">绿=诱导</text>';
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 + h + 18) + '" font-size="7.5" fill="#79828a">判错（紫红描边）待复核</text>';
    $('filChart').innerHTML = s;
    $('roFilErr').textContent = ff.err + ' 条';
    $('roFil').textContent = state.filMode === 0 ? '宽松' : '严格';
  }

  /* ---------- 屏 3 渲染：岩心描述验证 + 复核 ---------- */
  function renderRev() {
    img = M.genImage(20261191, 30, 20);
    var ff = M.fractureFilter(img, 0); /* 复核默认宽松 */
    var s = '';
    var x0 = 30, y0 = 34, w = 300, h = 150;
    s += '<text x="30" y="20" font-size="9" fill="#4d565b" font-weight="700">岩心描述验证 · 判错 ' + ff.err + ' 条待复核</text>';
    s += renderGrid('', img, null);
    ff.list.forEach(function (it) {
      var fr = img.fracs[it.idx];
      var yy = fr.y0 * 150 / 20;
      var dx = fr.amp * 150 / 20;
      var col = it.ok ? (it.pred === 'nat' ? '#41699b' : '#2f7d6b') : '#b05a51';
      s += '<path d="M' + (x0) + ' ' + (y0 + yy) + ' q ' + (150) + ' ' + (-dx) + ' ' + (300) + ' 0" fill="none" stroke="' + col + '" stroke-width="' + (it.ok ? 1.8 : 2.6) + '"/>';
    });
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 + h + 18) + '" font-size="7.5" fill="#b05a51">红=判错（岩心描述不符）</text>';
    $('revChart').innerHTML = s;
    $('roRevErr').textContent = ff.err + ' 条';
    /* 复核清单 */
    var rows = ff.list.map(function (it) {
      return { name: '裂缝' + (it.idx + 1) + '（幅值' + num(it.amp, 1) + '）', pred: it.pred === 'nat' ? '天然' : '诱导', truth: it.true === 'nat' ? '天然' : '诱导', ok: it.ok };
    });
    var rs = '';
    rows.forEach(function (r) {
      rs += '<div class="row"><span>' + r.name + '</span><b>' + r.pred + '</b><em>' + (r.ok ? '✓' : '✗ 应为' + r.truth) + '</em></div>';
    });
    var revEl = $('reviewList');
    if (revEl) revEl.innerHTML = rs;
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    var inSeg = $('inSeg');
    if (inSeg) inSeg.addEventListener('input', function () {
      state.segTh = parseFloat(inSeg.value);
      $('outSeg').textContent = num(state.segTh);
      renderSeg();
    });
    var inFil = $('inFil');
    if (inFil) inFil.addEventListener('input', function () {
      state.filMode = parseInt(inFil.value, 10);
      $('outFil').textContent = state.filMode === 0 ? '宽松' : '严格';
      renderFil();
    });
    var inRev = $('inRev');
    if (inRev) inRev.addEventListener('input', function () {
      state.revMode = parseInt(inRev.value, 10);
      $('outRev').textContent = state.revMode === 0 ? '未确认' : '已确认';
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '裂缝语义分割', 'segCtl'], ['sec2', '诱导缝鉴别', 'filCtl'], ['sec3', '岩心验证', 'revCtl']].forEach(function (s2) {
      var el = $(s2[2]); if (!el) return;
      secs.push({ id: s2[0], title: s2[1], html: el.outerHTML, top: el.offsetTop, height: el.offsetHeight });
    });
    try { parent.postMessage({ __drawer: 'init', sections: secs }, '*'); } catch (e) {}
    window.addEventListener('message', function (e) {
      if (e.source !== window.parent) return;
      var dd = e.data;
      if (!dd || dd.__drawer !== 'control') return;
      var el = doc.querySelector('[data-ctl-id="' + dd.id + '"]');
      if (!el) return;
      if (el.type === 'range') { el.value = dd.value; el.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (el.tagName === 'BUTTON') { el.click(); }
    });
  }

  /* ---------- 启动 ---------- */
  bind();
  renderSeg(); renderFil(); renderRev();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
