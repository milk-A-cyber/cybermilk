/* =========================================================
   荧光图像智能判读 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  成像标准化：荧光图像（不同灯源）→ 亮度一致
   屏 2  颜色特征 + 分类：标准化 → 颜色特征 → 含油级别
   屏 3  抽查复核：判级给建议，人工抽查
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

    var LEVEL = ['无', '微', '弱', '中', '强'];
    var LCOL = ['#d8d2c4', '#a9c6a3', '#d8b64a', '#e0a030', '#c98a2b'];

    /* -----------------------------------------------------
       合成荧光图像特征
       每张图合成 { bright(平均亮度), hue(主色相), sat(饱和), area(发光面积), level(真值) }
       level 越高 → 亮度/饱和/面积越大
       light 0/1 = 两种灯源（亮度/色偏不同）
       ----------------------------------------------------- */
    function genFluor(n, seed, light) {
      var rnd = mulberry32(seed || 20261181);
      var imgs = [];
      for (var i = 0; i < n; i++) {
        /* 真值含油级别：偏向中低，强/微少（不均衡） */
        var r = rnd();
        var level = r < 0.3 ? 0 : r < 0.55 ? 1 : r < 0.78 ? 2 : r < 0.93 ? 3 : 4;
        var base = 0.15 + level * 0.17;
        var bright = clamp(base + (rnd() - 0.5) * 0.17, 0.05, 0.95);
        var hue = 0.12 + level * 0.02 + (rnd() - 0.5) * 0.02;   /* 黄→橙 */
        var sat = clamp(0.2 + level * 0.15 + (rnd() - 0.5) * 0.24, 0.05, 0.95);
        var area = clamp(0.1 + level * 0.17 + (rnd() - 0.5) * 0.22, 0.02, 0.95);
        /* 灯源差异：light 0 暗/低饱和，light 1 亮/高饱和 */
        var lamp = light === 0 ? { b: 0.7, s: 0.75 } : { b: 1.0, s: 1.05 };
        imgs.push({
          bright: clamp(bright * lamp.b, 0.02, 1),
          hue: hue,
          sat: clamp(sat * lamp.s, 0.02, 1),
          area: area,
          light: light, level: level
        });
      }
      return { n: n, imgs: imgs };
    }

    /* -----------------------------------------------------
       成像标准化
       用灯源参数校正亮度/色偏。mode 0 不校正，1 校正。
       返回 { imgs: [{bright,hue,sat,area,level}] }
       ----------------------------------------------------- */
    function stdImaging(d, mode) {
      var out = [];
      for (var i = 0; i < d.imgs.length; i++) {
        var im = d.imgs[i];
        if (mode === 0) { out.push({ bright: im.bright, hue: im.hue, sat: im.sat, area: im.area, level: im.level, light: im.light }); }
        else {
          var b = im.light === 0 ? im.bright / 0.7 : im.bright / 1.0;
          var s = im.light === 0 ? im.sat / 0.75 : im.sat / 1.05;
          out.push({ bright: clamp(b, 0, 1), hue: im.hue, sat: clamp(s, 0, 1), area: im.area, level: im.level, light: im.light });
        }
      }
      return { n: d.n, imgs: out };
    }

    /* -----------------------------------------------------
       颜色特征工程
       mode 0 单特征（只亮度），1 多特征（亮度+饱和+面积）。
       返回 { feats: [[...]], }
       ----------------------------------------------------- */
    function colorFeat(s, mode) {
      var feats = [];
      for (var i = 0; i < s.imgs.length; i++) {
        var im = s.imgs[i];
        if (mode === 0) feats.push([im.bright]);
        else feats.push([im.bright, im.sat, im.area]);
      }
      return { feats: feats };
    }

    /* -----------------------------------------------------
       含油级别分类
       阈值判级。返回 { pred: [], acc, cm(混淆矩阵) }
       ----------------------------------------------------- */
    function fluorClassify(s, thr) {
      var pred = [], acc = 0, n = s.imgs.length;
      for (var i = 0; i < n; i++) {
        var im = s.imgs[i];
        var score = im.bright * 0.5 + im.sat * 0.3 + im.area * 0.2;
        var p = score < thr[0] ? 0 : score < thr[1] ? 1 : score < thr[2] ? 2 : score < thr[3] ? 3 : 4;
        pred.push(p);
        if (p === im.level) acc++;
      }
      return { pred: pred, acc: n ? acc / n : 0, n: n };
    }

    return {
      clamp: clamp, mulberry32: mulberry32, LEVEL: LEVEL, LCOL: LCOL,
      genFluor: genFluor, stdImaging: stdImaging, colorFeat: colorFeat, fluorClassify: fluorClassify
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

  var state = { nImg: 240, stdMode: 1, featMode: 1, thr: [0.2, 0.38, 0.56, 0.74] };

  var d = M.genFluor(state.nImg, 20261181, 0);

  global.RemoteBridge = {
    M: M,
    genFluor: M.genFluor, stdImaging: M.stdImaging, colorFeat: M.colorFeat, fluorClassify: M.fluorClassify,
    live: function () {
      return { nImg: state.nImg, stdMode: state.stdMode, featMode: state.featMode, thr: state.thr };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 2 : d); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------- 屏 1 渲染：成像标准化 ---------- */
  function renderStd() {
    d = M.genFluor(state.nImg, 20261181, 0);
    var s = M.stdImaging(d, state.stdMode);
    var std = M.stdImaging(M.genFluor(state.nImg, 20261181, 1), state.stdMode);
    var s2 = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s2 += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">成像标准化：' + (state.stdMode === 0 ? '灯源未校正（亮度差大）' : '已校正（亮度一致）') + '</text>';
    /* 两灯源亮度分布对比 */
    s2 += '<text x="40" y="42" font-size="8.5" fill="#79828a">灯源A（暗）</text>';
    var nBin = 10, bw2 = w / nBin;
    var bins0 = new Array(nBin).fill(0), bins1 = new Array(nBin).fill(0);
    var sLight0 = M.stdImaging(M.genFluor(120, 20261181, 0), state.stdMode);
    var sLight1 = M.stdImaging(M.genFluor(120, 20261181, 1), state.stdMode);
    for (var i = 0; i < sLight0.imgs.length; i++) {
      var b0 = Math.min(nBin - 1, Math.floor(sLight0.imgs[i].bright * nBin));
      bins0[b0]++;
      var b1 = Math.min(nBin - 1, Math.floor(sLight1.imgs[i].bright * nBin));
      bins1[b1]++;
    }
    var maxC = 1;
    for (i = 0; i < nBin; i++) maxC = Math.max(maxC, bins0[i], bins1[i]);
    var yC = 100, hC = 70;
    for (i = 0; i < nBin; i++) {
      var h0 = bins0[i] / maxC * hC;
      var h1 = bins1[i] / maxC * hC;
      s2 += '<rect x="' + (x0 + i * bw2) + '" y="' + (yC - h0) + '" width="' + (bw2 / 2 - 1) + '" height="' + h0 + '" fill="#41699b"/>';
      s2 += '<rect x="' + (x0 + i * bw2 + bw2 / 2) + '" y="' + (yC - h1) + '" width="' + (bw2 / 2 - 1) + '" height="' + h1 + '" fill="#b26a39"/>';
    }
    s2 += '<text x="' + (x0 + 6) + '" y="' + (yC + 14) + '" font-size="7.5" fill="#41699b">灯源A</text>';
    s2 += '<text x="' + (x0 + 66) + '" y="' + (yC + 14) + '" font-size="7.5" fill="#b26a39">灯源B</text>';
    s2 += '<text x="' + (x0 + 6) + '" y="' + (yC + hC + 24) + '" font-size="7.5" fill="#79828a">亮度分布（标准化后两灯源应重合）</text>';
    $('stdChart').innerHTML = s2;
    $('roStd').textContent = state.stdMode === 0 ? '未校正' : '已校正';
    $('roDiff').textContent = state.stdMode === 0 ? '灯源差大' : '灯源一致';
  }

  /* ---------- 屏 2 渲染：颜色特征 + 分类 ---------- */
  function renderFeat() {
    d = M.genFluor(state.nImg, 20261181, 0);
    var s = M.stdImaging(d, state.stdMode);
    var cf = M.colorFeat(s, state.featMode);
    var cls = M.fluorClassify(s, state.thr);
    var s2 = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s2 += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">颜色特征 + 分类：含油级别 ' + Math.round(cls.acc * 100) + '% 判对</text>';
    /* 每张图按 level 与 pred 在二维散点（亮度 × 面积） */
    var px = x0 + 10, py = y0 + 12, pw = 150, ph = 76;
    s2 += '<line x1="' + px + '" y1="' + (py + ph) + '" x2="' + (px + pw) + '" y2="' + (py + ph) + '" stroke="#9ba3a9" stroke-width="1"/>';
    s2 += '<line x1="' + px + '" y1="' + py + '" x2="' + px + '" y2="' + (py + ph) + '" stroke="#9ba3a9" stroke-width="1"/>';
    s2 += '<text x="' + (px - 4) + '" y="' + (py + 8) + '" font-size="7" fill="#79828a">面积</text>';
    s2 += '<text x="' + (px + pw / 2) + '" y="' + (py + ph + 16) + '" text-anchor="middle" font-size="7.5" fill="#79828a">亮度</text>';
    for (var i = 0; i < s.imgs.length; i++) {
      var im = s.imgs[i];
      var sx = px + im.bright * pw;
      var sy = py + ph - im.area * ph;
      var col = cls.pred[i] === im.level ? M.LCOL[im.level] : '#d0a3a3';
      s2 += '<circle cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="2" fill="' + col + '" stroke="' + (cls.pred[i] === im.level ? 'none' : '#b05a51') + '" stroke-width="0.6"/>';
    }
    s2 += '<text x="' + (px + pw + 8) + '" y="' + (py + 12) + '" font-size="7.5" fill="#4d565b">点色=级别</text>';
    s2 += '<text x="' + (px + pw + 8) + '" y="' + (py + 24) + '" font-size="7.5" fill="#b05a51">红圈=判错</text>';
    /* 右侧：级别柱（真值 vs 判级） */
    var rx = x0 + 172, rw = 120, rh = 76, ry = py;
    var bins = new Array(5).fill(0), binsP = new Array(5).fill(0);
    for (i = 0; i < s.imgs.length; i++) { bins[s.imgs[i].level]++; binsP[cls.pred[i]]++; }
    var maxB = 1;
    for (i = 0; i < 5; i++) maxB = Math.max(maxB, bins[i]);
    for (i = 0; i < 5; i++) {
      var hh = bins[i] / maxB * rh;
      s2 += '<rect x="' + (rx + i * (rw / 5)) + '" y="' + (ry + rh - hh) + '" width="' + (rw / 5 - 3) + '" height="' + hh + '" fill="' + M.LCOL[i] + '"/>';
    }
    s2 += '<text x="' + (rx + rw / 2) + '" y="' + (ry + rh + 16) + '" text-anchor="middle" font-size="7.5" fill="#79828a">级别分布（真值）</text>';
    $('featChart').innerHTML = s2;
    $('roAcc').textContent = Math.round(cls.acc * 100) + '%';
    $('roFeat').textContent = state.featMode === 0 ? '单特征' : '多特征';
  }

  /* ---------- 屏 3 渲染：抽查复核 ---------- */
  function renderRev() {
    d = M.genFluor(state.nImg, 20261181, 0);
    var s = M.stdImaging(d, state.stdMode);
    var cls = M.fluorClassify(s, state.thr);
    var s2 = '';
    var x0 = 40, y0 = 40, w = 300, h = 80;
    /* 复核清单：挑判错/低置信样本 */
    s2 += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">抽查复核：判级给建议 · 复核 ' + (cls.n - (function () { var c = 0; for (var i = 0; i < cls.pred.length; i++) if (cls.pred[i] !== s.imgs[i].level) c++; return c; })()) + '/' + cls.n + ' 已判对</text>';
    var items = [];
    for (var i = 0; i < s.imgs.length; i++) {
      if (cls.pred[i] !== s.imgs[i].level) {
        items.push({ idx: i, level: s.imgs[i].level, pred: cls.pred[i], bright: s.imgs[i].bright });
      }
    }
    /* 前面几张判错的 */
    var shown = items.slice(0, 5);
    var x = x0, y = y0 + 12;
    for (var k = 0; k < shown.length; k++) {
      var it = shown[k];
      var rowY = y + k * 34;
      s2 += '<rect x="' + x + '" y="' + rowY + '" width="' + w + '" height="28" rx="5" fill="#f9efea" stroke="#e0c3a8"/>';
      s2 += '<text x="' + (x + 8) + '" y="' + (rowY + 18) + '" font-size="8" fill="#4d565b">样' + it.idx + '</text>';
      s2 += '<text x="' + (x + 44) + '" y="' + (rowY + 18) + '" font-size="8" fill="#8a4f27">真' + M.LEVEL[it.level] + '</text>';
      s2 += '<text x="' + (x + 90) + '" y="' + (rowY + 18) + '" font-size="8" fill="#b05a51">判' + M.LEVEL[it.pred] + '</text>';
      s2 += '<text x="' + (x + 140) + '" y="' + (rowY + 18) + '" font-size="8" fill="#2f7d6b">待复核</text>';
      var barW = 90;
      s2 += '<rect x="' + (x + w - barW - 10) + '" y="' + (rowY + 10) + '" width="' + barW + '" height="9" rx="4" fill="#f0ece2"/>';
      s2 += '<rect x="' + (x + w - barW - 10) + '" y="' + (rowY + 10) + '" width="' + (barW * it.bright) + '" height="9" rx="4" fill="#c98a2b"/>';
    }
    $('revChart').innerHTML = s2;
    $('roRev').textContent = '待复核 ' + items.length + ' 张';
    $('roOk').textContent = Math.round(cls.acc * 100) + '%';
    /* 复核清单 */
    var rows = [
      ['成像标准化', state.stdMode === 0 ? '未校正' : '已校正', 'ok'],
      ['含油级别', Math.round(cls.acc * 100) + '%', 'ok'],
      ['抽查复核', items.length + ' 张待复核', 'ok']
    ];
    var rs = '';
    for (var r = 0; r < rows.length; r++) {
      rs += '<div class="row"><span>' + rows[r][0] + '</span><b>' + rows[r][1] + '</b><em>' + rows[r][2] + '</em></div>';
    }
    var revEl = $('reviewList');
    if (revEl) revEl.innerHTML = rs;
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    var inStd = $('inStd');
    if (inStd) inStd.addEventListener('input', function () {
      state.stdMode = parseInt(inStd.value, 10);
      $('outStd').textContent = state.stdMode === 0 ? '未校正' : '已校正';
      renderStd(); renderFeat(); renderRev();
    });
    var inFeat = $('inFeat');
    if (inFeat) inFeat.addEventListener('input', function () {
      state.featMode = parseInt(inFeat.value, 10);
      $('outFeat').textContent = state.featMode === 0 ? '单特征' : '多特征';
      renderFeat(); renderRev();
    });
    var inThr = $('inThr');
    if (inThr) inThr.addEventListener('input', function () {
      var v = parseFloat(inThr.value);
      var dlt = 0.04;
      state.thr = [v - 3 * dlt, v - dlt, v + dlt, v + 3 * dlt];
      $('outThr').textContent = num(v, 2);
      renderFeat(); renderRev();
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '成像标准化', 'stdCtl'], ['sec2', '颜色特征+分类', 'featCtl'], ['sec3', '抽查复核', 'revCtl']].forEach(function (s) {
      var el = $(s[2]); if (!el) return;
      secs.push({ id: s[0], title: s[1], html: el.outerHTML, top: el.offsetTop, height: el.offsetHeight });
    });
    try { parent.postMessage({ __drawer: 'init', sections: secs }, '*'); } catch (e) {}
    window.addEventListener('message', function (e) {
      if (e.source !== window.parent) return;
      var d = e.data;
      if (!d || d.__drawer !== 'control') return;
      var el = doc.querySelector('[data-ctl-id="' + d.id + '"]');
      if (!el) return;
      if (el.type === 'range') { el.value = d.value; el.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (el.tagName === 'BUTTON') { el.click(); }
    });
  }

  /* ---------- 启动 ---------- */
  bind();
  renderStd(); renderFeat(); renderRev();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
