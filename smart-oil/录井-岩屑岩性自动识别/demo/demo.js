/* =========================================================
   岩屑岩性自动识别 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  细粒度分类：岩屑图像 → 岩性类别概率
   屏 2  多标签识别：单样品多组分 → 组分比例
   屏 3  类别不均衡处理：none / 加权 / 重采样 → 少数类召回
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

    var LITHO = ['泥岩', '页岩', '粉砂岩', '细砂岩', '灰岩', '含油砂岩'];

    /* -----------------------------------------------------
       合成岩屑显微图像特征（每类岩性的特征中心 + 噪声）
       返回 { n, feats:[{label, feat}], counts }
       n 样品数；seed 控制；imbalance 控制少数类比例
       ----------------------------------------------------- */
    function genCuttings(n, seed, imbalance) {
      var rnd = mulberry32(seed || 20261161);
      var feats = [];
      var counts = new Int32Array(LITHO.length);
      for (var i = 0; i < n; i++) {
        /* 多数类 0（泥岩）为主；少数类 5（含油砂岩）最少 */
        var p = rnd();
        var label;
        if (imbalance === 0) {
          label = Math.floor(rnd() * LITHO.length);
        } else {
          var weights = [0.32, 0.22, 0.16, 0.14, 0.10, 0.06];
          var cum = 0, r = rnd();
          label = LITHO.length - 1;
          for (var k = 0; k < weights.length; k++) { cum += weights[k]; if (r < cum) { label = k; break; } }
        }
        counts[label]++;
        var c = label / (LITHO.length - 1);
        /* 特征 2 维，中心 = 类索引，加类内噪声；少数类更接近难分对 */
        feats.push({
          label: label,
          feat: [clamp(c + (rnd() - 0.5) * 0.16, 0, 1), clamp(c * 0.8 + (rnd() - 0.5) * 0.2, 0, 1)]
        });
      }
      return { n: n, feats: feats, counts: counts, labels: LITHO };
    }

    /* -----------------------------------------------------
       细粒度分类
       用 2 维特征 + 邻域一致（模拟细粒度模型）。weight 高 → 更难分对也被分开。
       返回 { pred: IntArray, prob: [n][K], acc }
       ----------------------------------------------------- */
    function fineClassify(data, weight, noise) {
      var n = data.n, K = LITHO.length;
      var pred = new Int32Array(n), prob = [];
      var correct = 0;
      var rnd = mulberry32(20261162);
      for (var i = 0; i < n; i++) {
        var f = data.feats[i].feat;
        var p = [];
        var trueK = data.feats[i].label;
        for (var k = 0; k < K; k++) {
          var center = k / (K - 1);
          /* 距离中心越近概率越高；weight 高则正确类概率高、难分对也被拉正 */
          var d = Math.abs(f[0] - center);
          var d2 = Math.abs(f[1] - center * 0.8);
          var sim = Math.exp(-(d * d + d2 * d2) * 6) * (0.5 + 0.5 * weight);
          p.push(sim + rnd() * 0.05);
        }
        /* 归一化 */
        var s = 0;
        for (var kk = 0; kk < K; kk++) s += p[kk];
        for (kk = 0; kk < K; kk++) p[kk] /= s;
        /* 难分对：泥岩(0)/页岩(1)、粉砂岩(2)/细砂岩(3) 相互混淆；weight 高则分开 */
        var argmax = 0, bestP = -1;
        for (kk = 0; kk < K; kk++) if (p[kk] > bestP) { bestP = p[kk]; argmax = kk; }
        pred[i] = argmax;
        if (argmax === trueK) correct++;
        prob.push(p);
      }
      return { pred: pred, prob: prob, acc: correct / n };
    }

    /* -----------------------------------------------------
       多标签识别
       从特征估计组分比例（混样样品多组分）。
       返回 { ratio: [n][K], main: IntArray }
       ----------------------------------------------------- */
    function multiLabel(data, weight) {
      var n = data.n, K = LITHO.length;
      var ratio = [];
      var main = new Int32Array(n);
      var rnd = mulberry32(20261163);
      for (var i = 0; i < n; i++) {
        var f = data.feats[i].feat;
        var r = [];
        for (var k = 0; k < K; k++) {
          var center = k / (K - 1);
          var d = Math.abs(f[0] - center);
          var sim = Math.exp(-d * d * 8) * (0.5 + 0.5 * weight) + rnd() * 0.03;
          r.push(sim);
        }
        var s = 0;
        for (var kk = 0; kk < K; kk++) s += r[kk];
        for (kk = 0; kk < K; kk++) r[kk] /= s;
        ratio.push(r);
        var best = 0;
        for (kk = 1; kk < K; kk++) if (r[kk] > r[best]) best = kk;
        main[i] = best;
      }
      return { ratio: ratio, main: main };
    }

    /* -----------------------------------------------------
       类别不均衡处理
       mode 0 none 1 加权 2 重采样。返回每类 recall 与整体。
       ----------------------------------------------------- */
    function balanceTrain(data, mode, weight) {
      var n = data.n, K = LITHO.length;
      var cls = fineClassify(data, weight, 0.05);
      var recall = new Float64Array(K);
      var cnt = new Int32Array(K), hit = new Int32Array(K);
      for (var i = 0; i < n; i++) {
        var tl = data.feats[i].label;
        cnt[tl]++;
        if (cls.pred[i] === tl) hit[tl]++;
      }
      for (var k = 0; k < K; k++) recall[k] = cnt[k] ? hit[k] / cnt[k] : 0;
      /* 加权：少数类加权提升召回（模拟 loss 加权） */
      var adjRecall = new Float64Array(K);
      for (k = 0; k < K; k++) {
        var ratio = cnt[k] / n;
        if (mode === 0) adjRecall[k] = recall[k];
        else if (mode === 1) adjRecall[k] = clamp(recall[k] + (0.06 / (ratio + 0.02)) * 0.5, 0, 1);
        else adjRecall[k] = clamp(recall[k] + (0.06 / (ratio + 0.02)) * 0.8, 0, 1);
      }
      var overall = 0, macro = 0;
      for (k = 0; k < K; k++) { overall += cnt[k] / n * adjRecall[k]; macro += adjRecall[k] / K; }
      return { recall: recall, adjRecall: adjRecall, cnt: cnt, overall: overall, macro: macro, K: K };
    }

    return {
      clamp: clamp, mulberry32: mulberry32, LITHO: LITHO,
      genCuttings: genCuttings, fineClassify: fineClassify,
      multiLabel: multiLabel, balanceTrain: balanceTrain
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

  var state = { nData: 60, weight: 0.7, imbMode: 0, balMode: 1 };

  var data = M.genCuttings(state.nData, 20261161, state.imbMode);

  global.RemoteBridge = {
    M: M,
    genCuttings: M.genCuttings, fineClassify: M.fineClassify,
    multiLabel: M.multiLabel, balanceTrain: M.balanceTrain,
    live: function () {
      return { nData: state.nData, weight: state.weight, imbMode: state.imbMode, balMode: state.balMode };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 1 : d); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  var C = ['#a8bfd4', '#9b86a8', '#e0c88a', '#cbbf9a', '#b9ceb4', '#e0a878'];
  function rgb(hex) {
    var h = hex.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mix(c1, c2, t) {
    var a = rgb(c1), b = rgb(c2);
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' + Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')';
  }

  /* ---------- 屏 1 渲染：细粒度分类 ---------- */
  function renderClass() {
    data = M.genCuttings(state.nData, 20261161, state.imbMode);
    var cls = M.fineClassify(data, state.weight, 0.05);
    var s = '';
    var x0 = 40, y0 = 40, w = 320, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">细粒度分类：岩屑图像 → 岩性类别（准确 ' + Math.round(cls.acc * 100) + '%）</text>';
    /* 二维特征散点 */
    data.feats.forEach(function (f, i) {
      var px = x0 + f.feat[0] * w;
      var py = y0 + h - f.feat[1] * h;
      var col = cls.pred[i] === f.label ? C[f.label] : '#d0a3a3';
      var isW = cls.pred[i] !== f.label;
      s += '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="' + (isW ? 4.5 : 3.2) + '" fill="' + col + '"' + (isW ? ' stroke="#b26a39" stroke-width="1.5"' : '') + ' opacity="0.85"/>';
    });
    /* 每类中心标签 */
    M.LITHO.forEach(function (nm, k) {
      var cx = x0 + (k / (M.LITHO.length - 1)) * w;
      s += '<text x="' + cx.toFixed(0) + '" y="' + (y0 + h + 16) + '" text-anchor="middle" font-size="7.5" fill="' + C[k] + '" font-weight="700">' + nm + '</text>';
    });
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#b26a39">红圈=分类错误</text>';
    s += '<text x="' + (x0 + 180) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#4d565b">细粒度特征（纹理）</text>';
    $('classChart').innerHTML = s;
    $('roAcc').textContent = Math.round(cls.acc * 100) + '%';
    $('roGran').textContent = state.weight > 0.5 ? '细粒度(难分对已分开)' : '粗粒度';
  }

  /* ---------- 屏 2 渲染：多标签识别 ---------- */
  function renderMulti() {
    data = M.genCuttings(state.nData, 20261161, state.imbMode);
    var ml = M.multiLabel(data, state.weight);
    var s = '';
    var x0 = 40, y0 = 40, w = 320, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">多标签识别：单样品多组分 → 组分比例</text>';
    /* 选 8 个样品展示组分堆叠条 */
    var shown = 8;
    var step = Math.max(1, Math.floor(data.n / shown));
    var bw = (w - 10) / shown;
    for (var i = 0; i < shown; i++) {
      var idx = i * step;
      var bx = x0 + i * bw + 3;
      var acc = 0;
      for (var k = 0; k < M.LITHO.length; k++) {
        var hh = ml.ratio[idx][k] * h;
        s += '<rect x="' + bx.toFixed(1) + '" y="' + (y0 + h - acc - hh).toFixed(1) + '" width="' + (bw - 4).toFixed(1) + '" height="' + hh.toFixed(1) + '" fill="' + C[k] + '"/>';
        acc += hh;
      }
      s += '<text x="' + (bx + (bw - 4) / 2).toFixed(1) + '" y="' + (y0 + h + 14) + '" text-anchor="middle" font-size="7" fill="#79828a">' + idx + '</text>';
    }
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#4d565b">样品 → 组分堆叠（主成分+次成分）</text>';
    /* 图例 */
    var ly = y0 + h + 30;
    var lx = x0;
    M.LITHO.forEach(function (nm, k) {
      s += '<rect x="' + lx + '" y="' + (ly - 9) + '" width="10" height="10" fill="' + C[k] + '"/>';
      s += '<text x="' + (lx + 14) + '" y="' + ly + '" font-size="7.5" fill="#4d565b">' + nm + '</text>';
      lx += 14 + nm.length * 7 + 10;
    });
    $('multiChart').innerHTML = s;
    $('roMain').textContent = M.LITHO[ml.main[data.n - 1]];
    $('roMix').textContent = data.feats[data.n - 1].label + ' / 多组分';
  }

  /* ---------- 屏 3 渲染：类别不均衡处理 ---------- */
  function renderBal() {
    data = M.genCuttings(state.nData, 20261161, state.imbMode);
    var b = M.balanceTrain(data, state.balMode, state.weight);
    var s = '';
    var x0 = 40, y0 = 40, w = 320, h = 60;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">类别不均衡处理：' + (state.balMode === 0 ? 'none' : state.balMode === 1 ? '加权' : '重采样') + ' · 少数类召回</text>';
    /* 每类召回柱（原始 vs 调整） */
    var bw2 = (w - 20) / b.K;
    for (var k = 0; k < b.K; k++) {
      var bx = x0 + k * bw2 + 4;
      var h1 = b.recall[k] * h, h2 = b.adjRecall[k] * h;
      s += '<rect x="' + bx.toFixed(1) + '" y="' + (y0 + h - h1).toFixed(1) + '" width="' + (bw2 - 8).toFixed(1) + '" height="' + h1.toFixed(1) + '" fill="#d9b78e"/>';
      s += '<rect x="' + (bx + (bw2 - 8) / 2).toFixed(1) + '" y="' + (y0 + h - h2).toFixed(1) + '" width="' + ((bw2 - 8) / 2).toFixed(1) + '" height="' + h2.toFixed(1) + '" fill="#2f7d6b"/>';
      s += '<text x="' + (bx + (bw2 - 4) / 2).toFixed(1) + '" y="' + (y0 + h + 16) + '" text-anchor="middle" font-size="7" fill="' + C[k] + '" font-weight="700">' + M.LITHO[k].slice(0, 2) + '</text>';
      s += '<text x="' + (bx + (bw2 - 4) / 2).toFixed(1) + '" y="' + (y0 + h + 28) + '" text-anchor="middle" font-size="7" fill="#79828a">' + b.cnt[k] + '</text>';
    }
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#b26a39">浅=原始</text>';
    s += '<text x="' + (x0 + 70) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#2f7d6b">深=调整后</text>';
    s += '<text x="' + (x0 + 150) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#4d565b">少数类（右端）召回提升</text>';
    $('balChart').innerHTML = s;
    $('roRec').textContent = Math.round(b.adjRecall[b.K - 1] * 100) + '%';
    $('roMacro').textContent = Math.round(b.macro * 100) + '%';
    /* 复核清单 */
    var rows = [
      ['不均衡处理', state.balMode === 0 ? 'none' : state.balMode === 1 ? '加权' : '重采样', 'ok'],
      ['少数类召回', Math.round(b.recall[b.K - 1] * 100) + '% → ' + Math.round(b.adjRecall[b.K - 1] * 100) + '%', 'ok'],
      ['成果回流', '复核结果已回训练集', 'ok']
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
    var inWeight = $('inWeight');
    if (inWeight) inWeight.addEventListener('input', function () {
      state.weight = parseFloat(inWeight.value);
      $('outWeight').textContent = num(state.weight, 2);
      renderClass(); renderMulti(); renderBal();
    });
    var inBal = $('inBal');
    if (inBal) inBal.addEventListener('input', function () {
      state.balMode = parseInt(inBal.value, 10);
      $('outBal').textContent = state.balMode === 0 ? 'none' : state.balMode === 1 ? '加权' : '重采样';
      renderBal();
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '细粒度分类', 'clsCtl'], ['sec2', '多标签识别', 'mulCtl'], ['sec3', '类别不均衡处理', 'balCtl']].forEach(function (s) {
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
  renderClass(); renderMulti(); renderBal();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
