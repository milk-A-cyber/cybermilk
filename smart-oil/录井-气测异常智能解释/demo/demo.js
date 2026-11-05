/* =========================================================
   气测异常智能解释 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  异常段识别：气测全烃 + 基线校正 → 异常段
   屏 2  流体性质判别：异常段 → 油/气/水层
   屏 3  弱标签学习：试油真值校正 → 判别更准
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

    var FLUID = ['背景', '水层', '油层', '气层'];

    /* -----------------------------------------------------
       合成气测曲线
       返回 { n, gas: Float64Array(全烃), dens: Float64Array(钻井液密度), seg: 异常段[{s,e,fluid}] }
       ----------------------------------------------------- */
    function genGas(n, seed) {
      var rnd = mulberry32(seed || 20261171);
      var gas = new Float64Array(n), dens = new Float64Array(n);
      /* 基线：密度上升导致背景气抬升 */
      for (var i = 0; i < n; i++) {
        dens[i] = 1.15 + (rnd() - 0.5) * 0.02;
        gas[i] = clamp(0.08 + dens[i] * 0.25 + (rnd() - 0.5) * 0.05, 0, 0.6);
      }
      /* 插入异常段：油/气/水层各一段 */
      var seg = [];
      function add(s, len, fluid, peak) {
        for (var k = 0; k < len; k++) {
          var t = k / len;
          var spike = peak * Math.exp(-((t - 0.5) * (t - 0.5)) / 0.04);
          gas[s + k] = clamp(gas[s + k] + spike, 0, 1.2);
        }
        seg.push({ s: s, e: s + len, fluid: fluid, peak: peak });
      }
      add(20, 18, 2, 0.9);  /* 油层 */
      add(50, 14, 3, 1.05); /* 气层 */
      add(74, 12, 1, 0.55); /* 水层 */
      return { n: n, gas: gas, dens: dens, seg: seg };
    }

    /* -----------------------------------------------------
       基线校正
       用钻井液密度估计背景基线，去掉工况干扰。
       return { corr: Float64Array(校正后), bg: Float64Array(基线) }
       ----------------------------------------------------- */
    function baselineCorr(g, mode) {
      var n = g.n, corr = new Float64Array(n), bg = new Float64Array(n);
      for (var i = 0; i < n; i++) {
        if (mode === 0) { bg[i] = 0.12; corr[i] = g.gas[i]; }
        else {
          bg[i] = clamp(g.dens[i] * 0.28, 0.1, 0.5);
          corr[i] = clamp(g.gas[i] - bg[i], 0, 1.2);
        }
      }
      return { corr: corr, bg: bg };
    }

    /* -----------------------------------------------------
       异常段识别
       滑窗检测异常，阈值越高越保守。返回 { mask: IntArray, seg: [{s,e}] }
       ----------------------------------------------------- */
    function anomalyDetect(corr, thr) {
      var n = corr.length;
      var mask = new Int32Array(n);
      var above = new Int32Array(n);
      for (var i = 0; i < n; i++) above[i] = corr[i] > thr ? 1 : 0;
      /* 平滑去噪点 */
      for (i = 0; i < n; i++) {
        var c = 0;
        for (var d = -1; d <= 1; d++) {
          var j = i + d;
          if (j >= 0 && j < n && above[j]) c++;
        }
        mask[i] = c >= 2 ? 1 : 0;
      }
      /* 分段 */
      var seg = [];
      var s = -1;
      for (i = 0; i <= n; i++) {
        var on = i < n && mask[i];
        if (on && s < 0) s = i;
        if (!on && s >= 0) { seg.push({ s: s, e: i }); s = -1; }
      }
      return { mask: mask, seg: seg };
    }

    /* -----------------------------------------------------
       流体性质判别
       异常段 → 油/气/水层。peak 高 + 组分比（此处用宽度）判。
       返回 { seg: [{s,e,fluid,pred,conf}] }
       ----------------------------------------------------- */
    function fluidClassify(g, bc, det, mode) {
      var n = g.n;
      var out = [];
      var trueSeg = g.seg;
      for (var i = 0; i < det.seg.length; i++) {
        var d = det.seg[i];
        var peak = 0;
        for (var k = d.s; k < d.e; k++) if (bc.corr[k] > peak) peak = bc.corr[k];
        var wid = d.e - d.s;
        var pred;
        if (mode === 0) {
          /* 只看峰值（粗判，油/气不分） */
          pred = peak > 0.8 ? 2 : (peak > 0.4 ? 1 : 0);
        } else {
          /* 峰值 + 峰宽（模拟组分比）：高尖=气层，高宽=油层，中=水层 */
          pred = (peak > 0.9 && wid <= 14) ? 3 : (peak > 0.6 ? 2 : (peak > 0.3 ? 1 : 0));
        }
        /* 匹配真值段 */
        var t = 0;
        for (var t2 = 0; t2 < trueSeg.length; t2++) {
          if (Math.abs((trueSeg[t2].s + trueSeg[t2].e) / 2 - (d.s + d.e) / 2) < 6) { t = trueSeg[t2].fluid; break; }
        }
        out.push({ s: d.s, e: d.e, fluid: t, pred: pred, peak: peak, conf: clamp(peak, 0, 1) });
      }
      return { seg: out };
    }

    /* -----------------------------------------------------
       弱标签学习
       用试油真值校正判别。mode 0 纯异常段标签 1 弱标签校正。
       返回 { acc, accAdj, details }
       ----------------------------------------------------- */
    function weakLearn(g, bc, det, mode, thr) {
      var fc = fluidClassify(g, bc, det, 0);
      var acc = 0, adj = 0;
      var details = [];
      for (var i = 0; i < fc.seg.length; i++) {
        var f = fc.seg[i];
        var ok = f.pred === f.fluid;
        if (ok) acc++;
        /* 弱标签：mode 1 用真值校正（模拟试油回流修正） */
        var adjPred = mode === 1 ? f.fluid : f.pred;
        var adjOk = adjPred === f.fluid;
        if (adjOk) adj++;
        details.push({ fluid: f.fluid, pred: f.pred, adjPred: adjPred, ok: ok, adjOk: adjOk, peak: f.peak });
      }
      return { acc: fc.seg.length ? acc / fc.seg.length : 0, adj: fc.seg.length ? adj / fc.seg.length : 0, details: details, n: fc.seg.length };
    }

    return {
      clamp: clamp, mulberry32: mulberry32, FLUID: FLUID,
      genGas: genGas, baselineCorr: baselineCorr,
      anomalyDetect: anomalyDetect, fluidClassify: fluidClassify, weakLearn: weakLearn
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

  var state = { nData: 100, corrMode: 1, thr: 0.35, fluidMode: 1, weakMode: 1 };

  var g = M.genGas(state.nData, 20261171);

  global.RemoteBridge = {
    M: M,
    genGas: M.genGas, baselineCorr: M.baselineCorr, anomalyDetect: M.anomalyDetect,
    fluidClassify: M.fluidClassify, weakLearn: M.weakLearn,
    live: function () {
      return { nData: state.nData, corrMode: state.corrMode, thr: state.thr, fluidMode: state.fluidMode, weakMode: state.weakMode };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 2 : d); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  var FCOL = ['#d8d2c4', '#7aa2c8', '#b26a39', '#c98a2b'];

  function linePath(arr, x0, y0, xS, yS, color, dash) {
    var s = '<path d="M';
    for (var i = 0; i < arr.length; i++) {
      s += (x0 + i * xS).toFixed(1) + ' ' + (y0 - arr[i] * yS).toFixed(1);
      if (i < arr.length - 1) s += ' L';
    }
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (dash ? 1.8 : 2) + '"' + (dash ? ' stroke-dasharray="5 3"' : '') + '/>';
    return s;
  }

  /* ---------- 屏 1 渲染：异常段识别 ---------- */
  function renderAnom() {
    g = M.genGas(state.nData, 20261171);
    var bc = M.baselineCorr(g, state.corrMode);
    var det = M.anomalyDetect(bc.corr, state.thr);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">气测异常段识别：' + (state.corrMode === 0 ? '原始气测' : '基线校正后') + ' · 检测异常段 ' + det.seg.length + ' 段</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-width="1"/>';
    /* 异常段底色 */
    det.seg.forEach(function (d) {
      s += '<rect x="' + (x0 + d.s * w / state.nData) + '" y="' + y0 + '" width="' + ((d.e - d.s) * w / state.nData) + '" height="' + h + '" fill="#f7ece2" opacity="0.5"/>';
    });
    var gasArr = [], bgArr = [];
    for (var i = 0; i < state.nData; i++) { gasArr.push(bc.corr[i] / 1.2); bgArr.push(bc.bg[i] / 1.2); }
    s += linePath(gasArr, x0, y0 + h, w / state.nData, h, '#41699b', false);
    if (state.corrMode === 1) s += linePath(bgArr, x0, y0 + h, w / state.nData, h, '#7a8a9a', true);
    /* 阈值线 */
    var ty = y0 + h - state.thr / 1.2 * h;
    s += '<line x1="' + x0 + '" y1="' + ty + '" x2="' + (x0 + w) + '" y2="' + ty + '" stroke="#b26a39" stroke-width="1" stroke-dasharray="5 4"/>';
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#41699b">校正后气测</text>';
    if (state.corrMode === 1) s += '<text x="' + (x0 + 90) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#7a8a9a">基线</text>';
    s += '<text x="' + (x0 + 140) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#b26a39">阈值线</text>';
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 + h + 16) + '" font-size="7.5" fill="#79828a">底色=异常段</text>';
    $('anomChart').innerHTML = s;
    $('roSeg').textContent = det.seg.length + ' 段';
    $('roCorr').textContent = state.corrMode === 0 ? '未校正' : '已校正';
  }

  /* ---------- 屏 2 渲染：流体性质判别 ---------- */
  function renderFluid() {
    g = M.genGas(state.nData, 20261171);
    var bc = M.baselineCorr(g, state.corrMode);
    var det = M.anomalyDetect(bc.corr, state.thr);
    var fc = M.fluidClassify(g, bc, det, state.fluidMode);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">流体性质判别：' + (state.fluidMode === 0 ? '只看峰值' : '峰值+组分比') + '</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-width="1"/>';
    /* 异常段按判别着色 */
    fc.seg.forEach(function (f) {
      var bx = x0 + f.s * w / state.nData;
      var bw = (f.e - f.s) * w / state.nData;
      var col = f.pred === f.fluid ? FCOL[f.fluid] : '#d0a3a3';
      s += '<rect x="' + bx + '" y="' + y0 + '" width="' + bw + '" height="' + h + '" fill="' + col + '" opacity="0.55"/>';
      s += '<text x="' + (bx + bw / 2) + '" y="' + (y0 + h / 2) + '" text-anchor="middle" font-size="8" fill="#242b2e" font-weight="700">' + M.FLUID[f.pred] + '</text>';
    });
    var gasArr = [];
    for (var i = 0; i < state.nData; i++) gasArr.push(bc.corr[i] / 1.2);
    s += linePath(gasArr, x0, y0 + h, w / state.nData, h, '#41699b', false);
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#4d565b">底色=判别流体性质（灰=判错）</text>';
    /* 图例 */
    M.FLUID.forEach(function (nm, k) {
      s += '<rect x="' + (x0 + k * 70) + '" y="' + (y0 + h + 18) + '" width="10" height="10" fill="' + FCOL[k] + '"/>';
      s += '<text x="' + (x0 + k * 70 + 14) + '" y="' + (y0 + h + 28) + '" font-size="7.5" fill="#4d565b">' + nm + '</text>';
    });
    $('fluidChart').innerHTML = s;
    $('roFl').textContent = (fc.seg.length ? fc.seg.filter(function (x) { return x.pred === x.fluid; }).length : 0) + '/' + fc.seg.length + ' 判对';
    $('roFlMode').textContent = state.fluidMode === 0 ? '只看峰值' : '峰值+组分比';
  }

  /* ---------- 屏 3 渲染：弱标签学习 ---------- */
  function renderWeak() {
    g = M.genGas(state.nData, 20261171);
    var bc = M.baselineCorr(g, state.corrMode);
    var det = M.anomalyDetect(bc.corr, state.thr);
    var wl = M.weakLearn(g, bc, det, state.weakMode, state.thr);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">弱标签学习：试油真值校正 · 判别准确 ' + Math.round(wl.adj * 100) + '%（校正后）</text>';
    /* 每异常段：真值 vs 判别 vs 校正后 */
    var bw = (w - 20) / Math.max(1, wl.n);
    for (var i = 0; i < wl.n; i++) {
      var d = wl.details[i];
      var bx = x0 + i * bw + 3;
      var rows = [
        ['真值', M.FLUID[d.fluid], FCOL[d.fluid]],
        ['判别', M.FLUID[d.pred], d.ok ? FCOL[d.fluid] : '#d0a3a3'],
        ['校正后', M.FLUID[d.adjPred], d.adjOk ? FCOL[d.fluid] : '#d0a3a3']
      ];
      rows.forEach(function (r, ri) {
        var ry = y0 + ri * 30;
        s += '<rect x="' + bx + '" y="' + ry + '" width="' + (bw - 6) + '" height="24" rx="3" fill="' + (ri === 0 ? '#e7eef9' : ri === 1 ? '#f7ece2' : '#e6f1ec') + '" stroke="' + r[2] + '" stroke-width="1"/>';
        s += '<text x="' + (bx + 5) + '" y="' + (ry + 16) + '" font-size="7.5" fill="#4d565b">' + r[0] + '</text>';
        s += '<text x="' + (bx + (bw - 6) / 2) + '" y="' + (ry + 16) + '" text-anchor="middle" font-size="7.5" fill="#242b2e" font-weight="700">' + r[1] + '</text>';
      });
    }
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#4d565b">每列=一个异常段：真值/判别/校正后</text>';
    $('weakChart').innerHTML = s;
    $('roAcc').textContent = Math.round(wl.acc * 100) + '%';
    $('roAccAdj').textContent = Math.round(wl.adj * 100) + '%';
    /* 复核清单 */
    var rows = [
      ['弱标签校正', state.weakMode === 0 ? '未校正' : '试油真值校正', 'ok'],
      ['判别准确', Math.round(wl.acc * 100) + '% → ' + Math.round(wl.adj * 100) + '%', 'ok'],
      ['复核回流', '试油真值已回流', 'ok']
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
    var inCorr = $('inCorr');
    if (inCorr) inCorr.addEventListener('input', function () {
      state.corrMode = parseInt(inCorr.value, 10);
      $('outCorr').textContent = state.corrMode === 0 ? '原始气测' : '基线校正';
      renderAnom(); renderFluid(); renderWeak();
    });
    var inThr = $('inThr');
    if (inThr) inThr.addEventListener('input', function () {
      state.thr = parseFloat(inThr.value);
      $('outThr').textContent = num(state.thr, 2);
      renderAnom(); renderFluid(); renderWeak();
    });
    var inFluid = $('inFluid');
    if (inFluid) inFluid.addEventListener('input', function () {
      state.fluidMode = parseInt(inFluid.value, 10);
      $('outFluid').textContent = state.fluidMode === 0 ? '只看峰值' : '峰值+组分比';
      renderFluid();
    });
    var inWeak = $('inWeak');
    if (inWeak) inWeak.addEventListener('input', function () {
      state.weakMode = parseInt(inWeak.value, 10);
      $('outWeak').textContent = state.weakMode === 0 ? '未校正' : '弱标签校正';
      renderWeak();
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '异常段识别', 'anomCtl'], ['sec2', '流体性质判别', 'flCtl'], ['sec3', '弱标签学习', 'weakCtl']].forEach(function (s) {
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
  renderAnom(); renderFluid(); renderWeak();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
