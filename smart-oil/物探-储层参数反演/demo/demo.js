/* =========================================================
   储层参数反演 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  深度回归：井点孔隙度真值 + 网络预测（连续值回归）
   屏 2  多属性融合：振幅/频率/阻抗加权 → 孔隙度
   屏 3  物理约束：范围约束前后孔隙度场对比 + 异常检查
   所有计算都在浏览器里完成，纯前端。
   ========================================================= */
(function (global) {
  'use strict';

  /* =====================================================
     纯模型层（Node 可 require 做单测；浏览器里继续往下走）
     ===================================================== */
  var Model = (function () {

    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

    /* 固定种子随机数 */
    function mulberry32(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    /* -----------------------------------------------------
       屏 1 · 合成井震数据
       生成一条井的深度序列：孔隙度真值 + 多属性（与孔隙度相关）。
       返回 { n, depth, poro(真值), attr: [ [振幅], [频率], [阻抗] ] }
       ----------------------------------------------------- */
    var ATTR_NAMES = ['振幅', '频率', '阻抗'];
    function genWell(n, seed) {
      var rnd = mulberry32(seed || 20261112);
      var depth = [], poro = [], aAmp = [], aFreq = [], aImp = [];
      /* 孔隙度：几段砂体（高孔隙）+ 背景泥岩（低孔隙） */
      var bodies = [];
      var nb = 3 + Math.floor(rnd() * 2);
      for (var i = 0; i < nb; i++) {
        bodies.push({ c: rnd() * n, r: 4 + rnd() * 8, p: 0.18 + rnd() * 0.15 });
      }
      for (var d = 0; d < n; d++) {
        depth.push(d);
        var p = 0.04 + rnd() * 0.03; /* 背景泥岩孔隙 */
        for (var b = 0; b < bodies.length; b++) {
          var g = Math.exp(-((d - bodies[b].c) * (d - bodies[b].c)) / (2 * bodies[b].r * bodies[b].r));
          p += bodies[b].p * g;
        }
        p = clamp(p, 0.02, 0.4);
        poro.push(p);
        /* 属性与孔隙度相关 + 噪声 */
        aAmp.push(clamp(0.15 + p * 1.1 + (rnd() - 0.5) * 0.08, 0, 0.6));
        aFreq.push(clamp(0.9 - p * 1.3 + (rnd() - 0.5) * 0.1, 0.2, 1.0));
        aImp.push(clamp(8.5 - p * 9 + (rnd() - 0.5) * 0.8, 4, 9));
      }
      return { n: n, depth: depth, poro: poro, attr: [aAmp, aFreq, aImp] };
    }

    /* -----------------------------------------------------
       屏 1 · 深度回归「模型」
       模拟深度网络从多属性回归孔隙度。
       weight 越高 → 预测越贴近真值（模拟训练充分）。
       返回 { pred: FloatArray }
       ----------------------------------------------------- */
    function deepRegress(well, weight) {
      var n = well.n;
      var pred = new Float64Array(n);
      var rnd = mulberry32(20261113);
      for (var d = 0; d < n; d++) {
        var p = well.poro[d];
        var noise = (1 - weight) * 0.06 * (rnd() + rnd() - 1);
        pred[d] = clamp(p + noise + (0.5 - weight) * 0.02, 0.0, 0.45);
      }
      return { pred: pred };
    }

    /* 回归评估：RMSE + 相关系数 */
    function regEval(well, pred) {
      var n = well.n;
      var se = 0;
      for (var i = 0; i < n; i++) se += (well.poro[i] - pred[i]) * (well.poro[i] - pred[i]);
      var rmse = Math.sqrt(se / n);
      /* 相关系数 */
      var mp = 0, mq = 0;
      for (var j = 0; j < n; j++) { mp += well.poro[j]; mq += pred[j]; }
      mp /= n; mq /= n;
      var cov = 0, vp = 0, vq = 0;
      for (var k = 0; k < n; k++) { cov += (well.poro[k] - mp) * (pred[k] - mq); vp += (well.poro[k] - mp) * (well.poro[k] - mp); vq += (pred[k] - mq) * (pred[k] - mq); }
      var corr = cov / (Math.sqrt(vp) * Math.sqrt(vq) + 1e-9);
      return { rmse: rmse, corr: corr };
    }

    /* -----------------------------------------------------
       屏 2 · 多属性融合
       用振幅/频率/阻抗加权估计孔隙度。权重越均衡，单属性失效时越稳健。
       ----------------------------------------------------- */
    function multiFuse(well, wAmp, wFreq, wImp) {
      var n = well.n;
      var pred = new Float64Array(n);
      var total = wAmp + wFreq + wImp + 1e-9;
      for (var d = 0; d < n; d++) {
        var a = well.attr[0][d], fr = well.attr[1][d], im = well.attr[2][d];
        var estA = (a - 0.15) / 1.1;
        var estF = (0.9 - fr) / 1.3;
        var estI = (8.5 - im) / 9;
        pred[d] = clamp((estA * wAmp + estF * wFreq + estI * wImp) / total, 0, 0.45);
      }
      return { pred: pred };
    }

    /* 多属性融合评估：用单属性偏差模拟噪声属性 */
    function fuseEval(well, pred) {
      var n = well.n;
      var se = 0;
      for (var i = 0; i < n; i++) se += (well.poro[i] - pred[i]) * (well.poro[i] - pred[i]);
      return { rmse: Math.sqrt(se / n) };
    }

    /* -----------------------------------------------------
       屏 3 · 物理约束
       对预测做孔隙度范围约束（lo..hi），并统计越界像素。
       ----------------------------------------------------- */
    function physConstrain(pred, lo, hi) {
      var n = pred.length;
      var out = new Float64Array(n);
      var outOfRange = 0;
      for (var i = 0; i < n; i++) {
        var v = pred[i];
        if (v < lo) { v = lo; outOfRange++; }
        if (v > hi) { v = hi; outOfRange++; }
        out[i] = v;
      }
      return { out: out, outOfRange: outOfRange, lo: lo, hi: hi };
    }

    /* 屏 3 用：合成二维孔隙度场（含异常） */
    function genPoroField(W, H, seed) {
      var rnd = mulberry32(seed || 20261114);
      var f = new Float64Array(W * H);
      var y, x;
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          var body = Math.exp(-((x - W * 0.5) * (x - W * 0.5)) / 600 - ((y - H * 0.5) * (y - H * 0.5)) / 400) * 0.18;
          var base = 0.06 + body;
          f[y * W + x] = clamp(base + (rnd() - 0.5) * 0.04, 0.0, 0.5);
        }
      }
      return { W: W, H: H, f: f };
    }

    return {
      clamp: clamp, mulberry32: mulberry32,
      ATTR_NAMES: ATTR_NAMES,
      genWell: genWell, deepRegress: deepRegress, regEval: regEval,
      multiFuse: multiFuse, fuseEval: fuseEval,
      physConstrain: physConstrain, genPoroField: genPoroField
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

  /* 全局 UI 状态 */
  var regState = { weight: 0.6, nWell: 40 };
  var fuseState = { wAmp: 0.5, wFreq: 0.3, wImp: 0.2 };
  var physState = { lo: 0.02, hi: 0.35 };

  /* 桥接：给算法解剖动画用同一份真代码 */
  global.RemoteBridge = {
    M: M,
    genWell: M.genWell, deepRegress: M.deepRegress, regEval: M.regEval,
    multiFuse: M.multiFuse, fuseEval: M.fuseEval,
    physConstrain: M.physConstrain, genPoroField: M.genPoroField,
    live: function () {
      return { weight: regState.weight, nWell: regState.nWell, wAmp: fuseState.wAmp, wFreq: fuseState.wFreq, wImp: fuseState.wImp, lo: physState.lo, hi: physState.hi };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 1 : d); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* 固定井 */
  var well1 = M.genWell(60, 20261112);
  var reg1 = M.deepRegress(well1, regState.weight);

  /* ---------- 屏 1 渲染：深度回归 ---------- */
  function renderReg() {
    well1 = M.genWell(60, 20261112);
    reg1 = M.deepRegress(well1, regState.weight);
    var ev = M.regEval(well1, reg1.pred);
    var n = well1.n;
    var H = 240, W = 360, x0 = 60, y0 = 20, xScale = W / n, yScale = 220 / 0.45;

    /* 坐标轴 */
    var s = '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x0 + '" y2="' + (y0 + H) + '" stroke="#9ba3a9" stroke-width="1"/>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + H) + '" x2="' + (x0 + W) + '" y2="' + (y0 + H) + '" stroke="#9ba3a9" stroke-width="1"/>';
    s += '<text x="' + (x0 - 40) + '" y="' + (y0 + 10) + '" font-size="9" fill="#79828a">孔隙度</text>';
    s += '<text x="' + (x0 + W - 60) + '" y="' + (y0 + H + 16) + '" font-size="9" fill="#79828a">井深（采样点）</text>';

    /* 真值（绿线） */
    var gPath = 'M';
    for (var i = 0; i < n; i++) gPath += (x0 + i * xScale).toFixed(1) + ' ' + (y0 + H - well1.poro[i] * yScale).toFixed(1) + (i === 0 ? '' : ' L');
    s += '<path d="' + gPath + '" fill="none" stroke="#2f7d6b" stroke-width="2"/>';
    s += '<text x="' + (x0 + W + 10) + '" y="' + (y0 + 20) + '" font-size="9" fill="#2f7d6b" font-weight="700">井孔隙度真值</text>';

    /* 预测（红线） */
    var pPath = 'M';
    for (var j = 0; j < n; j++) pPath += (x0 + j * xScale).toFixed(1) + ' ' + (y0 + H - reg1.pred[j] * yScale).toFixed(1) + (j === 0 ? '' : ' L');
    s += '<path d="' + pPath + '" fill="none" stroke="#b26a39" stroke-width="1.8" stroke-dasharray="5 3"/>';
    s += '<text x="' + (x0 + W + 10) + '" y="' + (y0 + 36) + '" font-size="9" fill="#b26a39" font-weight="700">网络预测</text>';
    $('regChart').innerHTML = s;

    $('roRmse').textContent = 'RMSE ' + num(ev.rmse, 3);
    $('roCorr').textContent = '相关系数 ' + num(ev.corr, 2);
  }

  /* ---------- 屏 2 渲染：多属性融合 ---------- */
  function renderFuse() {
    var fuse = M.multiFuse(well1, fuseState.wAmp, fuseState.wFreq, fuseState.wImp);
    var ev = M.fuseEval(well1, fuse.pred);
    var n = well1.n;
    var H = 240, W = 360, x0 = 60, y0 = 20, xScale = W / n, yScale = 220 / 0.45;
    var s = '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x0 + '" y2="' + (y0 + H) + '" stroke="#9ba3a9" stroke-width="1"/>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + H) + '" x2="' + (x0 + W) + '" y2="' + (y0 + H) + '" stroke="#9ba3a9" stroke-width="1"/>';
    var gPath = 'M';
    for (var i = 0; i < n; i++) gPath += (x0 + i * xScale).toFixed(1) + ' ' + (y0 + H - well1.poro[i] * yScale).toFixed(1) + (i === 0 ? '' : ' L');
    s += '<path d="' + gPath + '" fill="none" stroke="#2f7d6b" stroke-width="2"/>';
    var pPath = 'M';
    for (var j = 0; j < n; j++) pPath += (x0 + j * xScale).toFixed(1) + ' ' + (y0 + H - fuse.pred[j] * yScale).toFixed(1) + (j === 0 ? '' : ' L');
    s += '<path d="' + pPath + '" fill="none" stroke="#41699b" stroke-width="1.8" stroke-dasharray="5 3"/>';
    $('fuseChart').innerHTML = s;
    $('roFuseRmse').textContent = 'RMSE ' + num(ev.rmse, 3);
  }

  /* ---------- 屏 3 渲染：物理约束 ---------- */
  var field = M.genPoroField(56, 40, 20261114);
  function renderPhys() {
    /* 原始场（可能超出范围） */
    var sRaw = '';
    for (var y = 0; y < field.H; y++) {
      for (var x = 0; x < field.W; x++) {
        var v = field.f[y * field.W + x];
        var g = Math.round(80 + 175 * clamp(v / 0.45, 0, 1));
        sRaw += '<rect x="' + (x * 6) + '" y="' + (y * 6) + '" width="6" height="6" fill="rgb(' + g + ',' + (230 - g * 0.7) + ',120)"/>';
      }
    }
    /* 越界标记 */
    for (var y2 = 0; y2 < field.H; y2++) {
      for (var x2 = 0; x2 < field.W; x2++) {
        var v2 = field.f[y2 * field.W + x2];
        if (v2 > physState.hi) sRaw += '<rect x="' + (x2 * 6) + '" y="' + (y2 * 6) + '" width="6" height="6" fill="none" stroke="#b05a51" stroke-width="1.2"/>';
        if (v2 < physState.lo) sRaw += '<rect x="' + (x2 * 6) + '" y="' + (y2 * 6) + '" width="6" height="6" fill="none" stroke="#b05a51" stroke-width="1.2"/>';
      }
    }
    $('physRaw').innerHTML = sRaw;

    /* 约束后 */
    var pc = M.physConstrain(field.f, physState.lo, physState.hi);
    var sC = '';
    for (var y3 = 0; y3 < field.H; y3++) {
      for (var x3 = 0; x3 < field.W; x3++) {
        var v3 = pc.out[y3 * field.W + x3];
        var g3 = Math.round(80 + 175 * clamp(v3 / 0.45, 0, 1));
        sC += '<rect x="' + (x3 * 6) + '" y="' + (y3 * 6) + '" width="6" height="6" fill="rgb(' + g3 + ',' + (230 - g3 * 0.7) + ',120)"/>';
      }
    }
    $('physCon').innerHTML = sC;
    $('roOutRange').textContent = pc.outOfRange + ' 个越界像素被校正';
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    var inWeight = $('inWeight');
    if (inWeight) inWeight.addEventListener('input', function () {
      regState.weight = parseFloat(inWeight.value);
      $('outWeight').textContent = num(regState.weight, 2);
      renderReg();
    });
    var inAmp = $('inAmp');
    if (inAmp) inAmp.addEventListener('input', function () {
      fuseState.wAmp = parseFloat(inAmp.value);
      $('outAmp').textContent = num(fuseState.wAmp, 2);
      renderFuse();
    });
    var inFreq = $('inFreq');
    if (inFreq) inFreq.addEventListener('input', function () {
      fuseState.wFreq = parseFloat(inFreq.value);
      $('outFreq').textContent = num(fuseState.wFreq, 2);
      renderFuse();
    });
    var inImp = $('inImp');
    if (inImp) inImp.addEventListener('input', function () {
      fuseState.wImp = parseFloat(inImp.value);
      $('outImp').textContent = num(fuseState.wImp, 2);
      renderFuse();
    });
    var inHi = $('inHi');
    if (inHi) inHi.addEventListener('input', function () {
      physState.hi = parseFloat(inHi.value);
      $('outHi').textContent = num(physState.hi, 2);
      renderPhys();
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '深度回归', 'regCtl'], ['sec2', '多属性融合', 'fuseCtl'], ['sec3', '物理约束', 'physCtl']].forEach(function (s) {
      var el = $(s[2]); if (!el) return;
      el.querySelectorAll('input, button').forEach(function (c) {
        if (c.type === 'range') c.setAttribute('value', c.value);
      });
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
  renderReg(); renderFuse(); renderPhys();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
