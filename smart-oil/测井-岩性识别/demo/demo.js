/* =========================================================
   岩性识别 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  交会图基线：GR×RT 固定边界
   屏 2  多曲线融合：序列分类
   屏 3  薄片鉴定验证 + 复核
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

    var LITHO = ['砂岩', '泥岩', '灰岩', '页岩', '白云岩'];
    var CENT = {
      '砂岩': { gr: 0.8, rt: 1.2, den: 2.35, u: 2 },
      '泥岩': { gr: 2.2, rt: 0.8, den: 2.2, u: 4 },
      '灰岩': { gr: 1.2, rt: 2.4, den: 2.65, u: 2 },
      '页岩': { gr: 2.0, rt: 2.0, den: 2.55, u: 5 },
      '白云岩': { gr: 1.0, rt: 2.8, den: 2.8, u: 1.5 }
    };

    /* -----------------------------------------------------
       合成测井 + 岩性定名（岩心/岩屑定名 100—300 层点）
       返回 { n, depth, gr, rt, den, u, sp, litho(每点), segs }
       ----------------------------------------------------- */
    function genLitho(n, seed) {
      n = n || 100;
      var rnd = mulberry32(seed || 20261161);
      var gr = new Float64Array(n), rt = new Float64Array(n), den = new Float64Array(n), u = new Float64Array(n), sp = new Float64Array(n), litho = new Float64Array(n);
      /* 随机分段岩性，每段 8—16 点 */
      var seq = [], li = 0;
      while (li < n) {
        var len = 8 + Math.floor(rnd() * 9);
        len = Math.min(len, n - li);
        var l = LITHO[Math.floor(rnd() * LITHO.length)];
        seq.push({ s: li, e: li + len, litho: l });
        li += len;
      }
      seq.forEach(function (sg) {
        var c = CENT[sg.litho];
        var nrt = sg.litho === '白云岩' ? 0.8 : 0.5; /* 白云岩与灰岩难分 */
        for (var k = sg.s; k < sg.e; k++) {
          gr[k] = clamp(c.gr + (rnd() - 0.5) * 0.34, 0.2, 3);
          rt[k] = clamp(c.rt + (rnd() - 0.5) * nrt, 0.2, 3.2);
          den[k] = clamp(c.den + (rnd() - 0.5) * (sg.litho === '白云岩' ? 0.08 : 0.06), 2.0, 2.9);
          u[k] = clamp(c.u + (rnd() - 0.5) * 0.8, 0.5, 6);
          sp[k] = clamp(1.4 - (gr[k] - 0.8) * 0.3 + (rnd() - 0.5) * 0.1, 0.5, 1.6);
          litho[k] = LITHO.indexOf(sg.litho);
        }
      });
      return { n: n, depth: new Float64Array(n), gr: gr, rt: rt, den: den, u: u, sp: sp, litho: litho, segs: seq };
    }

    /* -----------------------------------------------------
       交会图基线：GR×RT 固定边界分类
       返回 { pred, acc, errs }
       ----------------------------------------------------- */
    function crossPlot(d, xb, yb) {
      xb = xb == null ? 1.6 : xb; yb = yb == null ? 2.0 : yb;
      var pred = new Float64Array(d.n), errs = [];
      for (var i = 0; i < d.n; i++) {
        var gr = d.gr[i], rt = d.rt[i];
        var p;
        if (rt > yb && gr < xb) p = 2; /* 灰岩（含白云岩） */
        else if (rt > yb) p = 3;        /* 页岩 */
        else if (gr >= xb) p = 1;       /* 泥岩 */
        else p = 0;                     /* 砂岩 */
        pred[i] = p;
        if (p !== d.litho[i]) errs.push({ idx: i, pred: p, true: d.litho[i] });
      }
      var acc = 1 - errs.length / d.n;
      return { pred: pred, acc: acc, errs: errs };
    }

    /* -----------------------------------------------------
       多曲线融合序列分类
       mode 0 单曲线(GR)，1 多曲线(GR/RT/DEN/U)
       返回 { pred, acc, errs }
       ----------------------------------------------------- */
    function lithoClassify(d, mode) {
      var pred = new Float64Array(d.n), errs = [];
      for (var i = 0; i < d.n; i++) {
        var best = 0, bd2 = Infinity;
        for (var li = 0; li < LITHO.length; li++) {
          var c = CENT[LITHO[li]];
          var dist;
          if (mode === 0) dist = Math.abs(d.gr[i] - c.gr) * 2 + Math.abs(d.sp[i] - (1.4 - (c.gr - 0.8) * 0.3)) * 1.5;
          else dist = Math.abs(d.gr[i] - c.gr) * 0.8 + Math.abs(d.rt[i] - c.rt) * 0.8 + Math.abs(d.den[i] - c.den) * 0.5 + Math.abs(d.u[i] - c.u) * 0.35;
          if (dist < bd2) { bd2 = dist; best = li; }
        }
        pred[i] = best;
        if (best !== d.litho[i]) errs.push({ idx: i, pred: best, true: d.litho[i] });
      }
      var acc = 1 - errs.length / d.n;
      return { pred: pred, acc: acc, errs: errs };
    }

    return {
      clamp: clamp, mulberry32: mulberry32, LITHO: LITHO, CENT: CENT,
      genLitho: genLitho, crossPlot: crossPlot, lithoClassify: lithoClassify
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

  var state = { xb: 1.6, classMode: 1 };
  var d = M.genLitho(100, 20261161);

  global.RemoteBridge = {
    M: M,
    genLitho: M.genLitho, crossPlot: M.crossPlot, lithoClassify: M.lithoClassify,
    live: function () { return { xb: state.xb, classMode: state.classMode }; }
  };

  var COL = ['#b26a39', '#41699b', '#2f7d6b', '#b05a51', '#7a5aa8'];

  /* ---------- 屏 1 渲染：交会图基线 ---------- */
  function renderCross() {
    d = M.genLitho(100, 20261161);
    var cp = M.crossPlot(d, state.xb, 2.0);
    var s = '';
    var x0 = 30, y0 = 30, w = 300, h = 150;
    s += '<text x="30" y="18" font-size="9" fill="#4d565b" font-weight="700">GR×RT 交会图 · 固定边界 x=' + num(state.xb) + ' · 准确率 ' + num(cp.acc) + '</text>';
    s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + w + '" height="' + h + '" fill="#fbfaf6" stroke="#e9e4d8"/>';
    /* 边界线 */
    var gx = x0 + state.xb / 3 * w, gy = y0 + h - 2.0 / 3.2 * h;
    s += '<line x1="' + gx + '" y1="' + y0 + '" x2="' + gx + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-dasharray="4 3"/>';
    s += '<line x1="' + x0 + '" y1="' + gy + '" x2="' + (x0 + w) + '" y2="' + gy + '" stroke="#9ba3a9" stroke-dasharray="4 3"/>';
    /* 点 */
    for (var i = 0; i < d.n; i++) {
      var px = x0 + d.gr[i] / 3 * w, py = y0 + h - d.rt[i] / 3.2 * h;
      var ok = cp.pred[i] === d.litho[i];
      s += '<circle cx="' + px + '" cy="' + py + '" r="2.6" fill="' + COL[d.litho[i]] + '"' + (ok ? '' : ' stroke="#b05a51" stroke-width="1.4"') + '/>';
    }
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#9ba3a9">GR →</text>';
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 + h + 14) + '" font-size="7.5" fill="#9ba3a9">RT ↑ · 红圈=固定边界判错</text>';
    $('crossChart').innerHTML = s;
    $('roAcc').textContent = num(cp.acc);
    $('roErr').textContent = cp.errs.length + ' 点';
  }

  /* ---------- 屏 2 渲染：多曲线融合序列分类 ---------- */
  function renderClass() {
    d = M.genLitho(100, 20261161);
    var cl = M.lithoClassify(d, state.classMode);
    var s = '';
    var x0 = 30, y0 = 30, w = 300, h = 150;
    s += '<text x="30" y="18" font-size="9" fill="#4d565b" font-weight="700">序列分类：' + (state.classMode === 0 ? '单曲线 GR' : '多曲线融合') + ' · 准确率 ' + num(cl.acc) + '</text>';
    /* 井段岩性条带 */
    for (var i = 0; i < d.n; i++) {
      var bx = x0 + i * w / 100, bw = w / 100 + 0.4;
      var ok = cl.pred[i] === d.litho[i];
      s += '<rect x="' + bx + '" y="' + y0 + '" width="' + bw + '" height="' + h + '" fill="' + COL[d.litho[i]] + '"' + (ok ? '' : ' stroke="#b05a51" stroke-width="1.1"') + '/>';
    }
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#9ba3a9">颜色=岩性 · 红边=判错</text>';
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 + h + 14) + '" font-size="7.5" fill="#9ba3a9">多曲线(GR/RT/DEN/U)比单曲线更准</text>';
    $('classChart').innerHTML = s;
    $('roClassAcc').textContent = num(cl.acc);
    $('roClass').textContent = state.classMode === 0 ? '单曲线' : '多曲线';
  }

  /* ---------- 屏 3 渲染：薄片鉴定验证 + 复核 ---------- */
  function renderRev() {
    d = M.genLitho(100, 20261161);
    var cl = M.lithoClassify(d, 1); /* 复核默认多曲线 */
    var s = '';
    var x0 = 30, y0 = 30, w = 300, h = 150;
    s += '<text x="30" y="18" font-size="9" fill="#4d565b" font-weight="700">薄片鉴定验证 · 判错 ' + cl.errs.length + ' 点待复核</text>';
    /* 井段岩性条带 */
    for (var i = 0; i < d.n; i++) {
      var bx = x0 + i * w / 100, bw = w / 100 + 0.4;
      var ok = cl.pred[i] === d.litho[i];
      s += '<rect x="' + bx + '" y="' + y0 + '" width="' + bw + '" height="' + h + '" fill="' + COL[d.litho[i]] + '"' + (ok ? '' : ' stroke="#b05a51" stroke-width="1.1"') + '/>';
    }
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 + h + 14) + '" font-size="7.5" fill="#b05a51">红边=薄片鉴定不符</text>';
    $('revChart').innerHTML = s;
    $('roRevErr').textContent = cl.errs.length + ' 点';
    /* 复核清单：按段聚合 */
    var bySeg = {};
    cl.errs.forEach(function (e) {
      var key = e.idx + '';
      var gr = d.gr[e.idx], rt = d.rt[e.idx];
      var tn = M.LITHO[e.true], pn = M.LITHO[e.pred];
      if (!bySeg[key]) bySeg[key] = { idx: e.idx, tn: tn, pn: pn, gr: gr, rt: rt };
    });
    var rows = Object.keys(bySeg).slice(0, 6).map(function (k) { return bySeg[k]; });
    var rs = '';
    rows.forEach(function (r) {
      rs += '<div class="row"><span>#' + r.idx + '（GR ' + num(r.gr) + '）</span><b>' + r.pn + '</b><em>✗ 应为' + r.tn + '</em></div>';
    });
    if (!rows.length) rs = '<div class="row"><span>无判错，全部符合</span><b>—</b><em>✓</em></div>';
    var revEl = $('reviewList');
    if (revEl) revEl.innerHTML = rs;
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    var inX = $('inX');
    if (inX) inX.addEventListener('input', function () {
      state.xb = parseFloat(inX.value);
      $('outX').textContent = num(state.xb);
      renderCross();
    });
    var inClass = $('inClass');
    if (inClass) inClass.addEventListener('input', function () {
      state.classMode = parseInt(inClass.value, 10);
      $('outClass').textContent = state.classMode === 0 ? '单曲线' : '多曲线';
      renderClass();
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '交会图基线', 'crossCtl'], ['sec2', '序列分类', 'classCtl'], ['sec3', '薄片验证', 'revCtl']].forEach(function (s2) {
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
  renderCross(); renderClass(); renderRev();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
