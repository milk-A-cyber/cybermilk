/* =========================================================
   地震相智能分类 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  切片分类：合成地震切片 + 图像分类（相带概率）
   屏 2  半监督扩展：稀疏井标签 → 伪标签 → 全数据体覆盖
   屏 3  相带概率体：邻域一致化 → 相带概率体 + 复核清单
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
       相带反射模式（合成）
       每种相带对应一种反射结构纹理。
       ----------------------------------------------------- */
    var FACI_NAMES = ['河道', '砂坝', '浊积扇', '滩坝', '湖底扇'];
    var FACI_COLORS = ['#a8c8d4', '#c8b878', '#c98a8a', '#9fc49f', '#b0a0d0'];

    /* -----------------------------------------------------
       屏 1 · 合成切片网格
       生成 ROWS×COLS 个切片，每个切片内部是某相带的反射纹理。
       返回 { rows, cols, grid: [ {facies, texture} ] }
       ----------------------------------------------------- */
    function genSliceGrid(rows, cols, nFacies, seed) {
      var rnd = mulberry32(seed || 20261108);
      var grid = [];
      var n = rows * cols;
      for (var i = 0; i < n; i++) {
        grid.push({ facies: Math.floor(rnd() * nFacies), angle: rnd() * Math.PI });
      }
      return { rows: rows, cols: cols, grid: grid, nFacies: nFacies };
    }

    /* 单切片振幅栅格（供绘制） */
    function sliceAmp(facies, angle, W, H, seed) {
      var rnd = mulberry32(seed || 20261109);
      var a = new Float64Array(W * H);
      var y, x;
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          var idx = y * W + x;
          var v = 0;
          var nL = 3;
          for (var l = 0; l < nL; l++) {
            var base = H * (0.2 + 0.5 * l / (nL - 1)) + Math.sin(angle * 1.5) * 3;
            var d = Math.abs(y - (base + Math.sin((x + l * 7) / 9) * 3));
            v += Math.exp(-d * d / 2.5) * (0.6 + rnd() * 0.5);
          }
          a[idx] = clamp(v * 1.5 - 0.5 + (rnd() + rnd() + rnd() - 1.5) * 0.2, -1, 1);
        }
      }
      return a;
    }

    /* -----------------------------------------------------
       屏 1 · 切片分类「模型」
       模拟 CNN 输出相带概率。weight 越高 → 分类越准（模拟训练充分）。
       返回 { prob: FloatArray(n*C), cls: IntArray(n) }
       ----------------------------------------------------- */
    function classifySlice(seisGrid, nFacies, weight) {
      var n = seisGrid.grid.length;
      var prob = new Float64Array(n * nFacies);
      var cls = new Int32Array(n);
      var rnd = mulberry32(20261110);
      var i, c;
      for (i = 0; i < n; i++) {
        var gt = seisGrid.grid[i].facies;
        var correctP = clamp(0.15 + 0.6 * weight, 0.12, 0.97);
        var rival = Math.floor(rnd() * nFacies);
        for (c = 0; c < nFacies; c++) {
          var p;
          if (c === gt) p = correctP + (rnd() + rnd() - 1) * 0.04;
          else if (c === rival && rival !== gt) p = clamp(0.3 - weight * 0.15, 0.02, 0.3) + (rnd() - 0.5) * 0.02;
          else p = Math.max(0.001, (1 - correctP - (rival !== gt ? clamp(0.3 - weight * 0.15, 0.02, 0.3) : 0)) / (nFacies - (rival !== gt ? 2 : 1)));
          prob[i * nFacies + c] = p;
        }
        var best = 0, bestP = -1;
        for (c = 0; c < nFacies; c++) if (prob[i * nFacies + c] > bestP) { bestP = prob[i * nFacies + c]; best = c; }
        cls[i] = best;
      }
      return { prob: prob, cls: cls, nFacies: nFacies };
    }

    /* 分类评估：准确率 + 各类 F1 */
    function classifyEval(seisGrid, cls, nFacies) {
      var n = seisGrid.grid.length;
      var tp = new Float64Array(nFacies), fp = new Float64Array(nFacies), fn = new Float64Array(nFacies);
      var acc = 0;
      for (var i = 0; i < n; i++) {
        var gt = seisGrid.grid[i].facies, pd = cls[i];
        if (gt === pd) { acc++; tp[gt]++; } else { fp[pd]++; fn[gt]++; }
      }
      acc /= n;
      var f1 = [];
      for (var c = 0; c < nFacies; c++) {
        var p = tp[c] / (tp[c] + fp[c] + 1e-9), r = tp[c] / (tp[c] + fn[c] + 1e-9);
        f1[c] = 2 * p * r / (p + r + 1e-9);
      }
      return { acc: acc, f1: f1 };
    }

    /* -----------------------------------------------------
       屏 2 · 半监督扩展
       只有部分切片有井标签（labeled），其余用伪标签扩展。
       pseudoThr 越高 → 伪标签越可信但覆盖越少。
       返回 { labeled, pseudo, covered }
       ----------------------------------------------------- */
    function semiExpand(seisGrid, prob, cls, nFacies, nLabeled, pseudoThr) {
      var n = seisGrid.grid.length;
      var labeled = new Uint8Array(n);
      var pseudo = new Uint8Array(n);
      var covered = new Uint8Array(n);
      var rnd = mulberry32(20261111);
      /* 随机挑 nLabeled 个作为井标签（真值） */
      var order = [];
      for (var i = 0; i < n; i++) order.push(i);
      for (var k = n - 1; k > 0; k--) { var j = Math.floor(rnd() * (k + 1)); var t = order[k]; order[k] = order[j]; order[j] = t; }
      for (var li = 0; li < Math.min(nLabeled, n); li++) labeled[order[li]] = 1;
      /* 伪标签：未标注切片中预测置信度 > pseudoThr */
      var pseudoCount = 0;
      for (var p = 0; p < n; p++) {
        if (labeled[p]) { covered[p] = 1; continue; }
        var conf = prob[p * nFacies + cls[p]];
        if (conf > pseudoThr) { pseudo[p] = 1; covered[p] = 1; pseudoCount++; }
      }
      return { labeled: labeled, pseudo: pseudo, covered: covered, nLabeled: nLabeled, pseudoCount: pseudoCount, pseudoThr: pseudoThr };
    }

    /* -----------------------------------------------------
       屏 3 · 相带概率体（邻域一致化）
       对逐切片分类做 3×3 邻域多数一致化，输出平滑后的相带。
       返回 { probSmooth, clsSmooth }
       ----------------------------------------------------- */
    function faciesProb(seisGrid, prob, cls, nFacies, smooth) {
      var rows = seisGrid.rows, cols = seisGrid.cols;
      var n = rows * cols;
      var clsSmooth = new Int32Array(n);
      var i, r, c;
      /* 邻域多数投票（smooth 次迭代） */
      var cur = new Int32Array(n); cur.set(cls);
      for (var it = 0; it < smooth; it++) {
        var next = new Int32Array(n);
        for (r = 0; r < rows; r++) {
          for (c = 0; c < cols; c++) {
            var votes = new Float64Array(nFacies);
            for (var dr = -1; dr <= 1; dr++) {
              for (var dc = -1; dc <= 1; dc++) {
                var rr = r + dr, cc = c + dc;
                if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
                votes[cur[rr * cols + cc]]++;
              }
            }
            var best = 0, bestV = -1;
            for (var f = 0; f < nFacies; f++) if (votes[f] > bestV) { bestV = votes[f]; best = f; }
            next[r * cols + c] = best;
          }
        }
        cur.set(next);
      }
      clsSmooth.set(cur);
      return { clsSmooth: clsSmooth, smooth: smooth };
    }

    return {
      clamp: clamp, mulberry32: mulberry32,
      FACI_NAMES: FACI_NAMES, FACI_COLORS: FACI_COLORS,
      genSliceGrid: genSliceGrid, sliceAmp: sliceAmp,
      classifySlice: classifySlice, classifyEval: classifyEval,
      semiExpand: semiExpand, faciesProb: faciesProb
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
  var clsState = { nFacies: 4, weight: 0.6 };
  var semiState = { nLabeled: 12, pseudoThr: 0.7 };
  var probState = { smooth: 1 };

  /* 桥接：给算法解剖动画用同一份真代码 */
  global.RemoteBridge = {
    M: M,
    genSliceGrid: M.genSliceGrid, classifySlice: M.classifySlice, classifyEval: M.classifyEval,
    semiExpand: M.semiExpand, faciesProb: M.faciesProb,
    live: function () {
      return { nFacies: clsState.nFacies, weight: clsState.weight, nLabeled: semiState.nLabeled, pseudoThr: semiState.pseudoThr, smooth: probState.smooth };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 1 : d); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* 固定切片网格 */
  var ROWS = 8, COLS = 10;
  var grid1 = M.genSliceGrid(ROWS, COLS, clsState.nFacies, 20261108);
  var cls1 = M.classifySlice(grid1, clsState.nFacies, clsState.weight);

  function ampColor(v) {
    var t = clamp(v, -1, 1);
    if (t >= 0) { var g = Math.round(220 * t); return 'rgb(' + g + ',' + g + ',' + (160 + 90 * t) + ')'; }
    var b = Math.round(-220 * t); return 'rgb(' + (150 + 100 * b / 220) + ',' + b + ',' + b + ')';
  }

  /* ---------- 屏 1 渲染：切片分类 ---------- */
  function renderCls() {
    grid1 = M.genSliceGrid(ROWS, COLS, clsState.nFacies, 20261108);
    cls1 = M.classifySlice(grid1, clsState.nFacies, clsState.weight);
    var ev = M.classifyEval(grid1, cls1.cls, clsState.nFacies);
    var W = 40, H = 30, gap = 2;

    /* 原图（相带真值着色边框） */
    var sTrue = '';
    var idx = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++, idx++) {
        var f = grid1.grid[idx].facies;
        var x = c * (W + gap) + 4, y = r * (H + gap) + 4;
        sTrue += '<rect x="' + x + '" y="' + y + '" width="' + W + '" height="' + H + '" fill="' + M.FACI_COLORS[f] + '" stroke="#888" stroke-width="1"/>';
        /* 内部反射纹理 */
        sTrue += '<line x1="' + (x + 4) + '" y1="' + (y + H / 2) + '" x2="' + (x + W - 4) + '" y2="' + (y + H / 2) + '" stroke="rgba(0,0,0,.35)" stroke-width="2"/>';
      }
    }
    $('clsTrue').innerHTML = sTrue;

    /* 预测（argmax 着色） */
    var sPred = '';
    idx = 0;
    for (var r2 = 0; r2 < ROWS; r2++) {
      for (var c2 = 0; c2 < COLS; c2++, idx++) {
        var f2 = cls1.cls[idx];
        var x2 = c2 * (W + gap) + 4, y2 = r2 * (H + gap) + 4;
        sPred += '<rect x="' + x2 + '" y="' + y2 + '" width="' + W + '" height="' + H + '" fill="' + M.FACI_COLORS[f2] + '" stroke="#888" stroke-width="1"/>';
        var wrong = f2 !== grid1.grid[idx].facies;
        if (wrong) sPred += '<text x="' + (x2 + W / 2) + '" y="' + (y2 + H / 2 + 4) + '" text-anchor="middle" font-size="9" fill="#fff" font-weight="700">×</text>';
      }
    }
    $('clsPred').innerHTML = sPred;

    /* 概率热图（第 1 类概率） */
    var sProb = '';
    idx = 0;
    for (var r3 = 0; r3 < ROWS; r3++) {
      for (var c3 = 0; c3 < COLS; c3++, idx++) {
        var p = cls1.prob[idx * clsState.nFacies + (0 % clsState.nFacies)];
        var g = Math.round(255 * p);
        var x3 = c3 * (W + gap) + 4, y3 = r3 * (H + gap) + 4;
        sProb += '<rect x="' + x3 + '" y="' + y3 + '" width="' + W + '" height="' + H + '" fill="rgb(' + g + ',' + (255 - g) + ',120)"/>';
      }
    }
    $('clsProb').innerHTML = sProb;

    /* 读数 */
    $('roAcc').textContent = num(ev.acc * 100, 1) + '%';
    var f1Txt = [];
    for (var f = 1; f < clsState.nFacies; f++) {
      f1Txt.push(M.FACI_NAMES[f] + ' ' + num(ev.f1[f] * 100, 0) + '%');
    }
    $('roF1').textContent = f1Txt.join(' · ');
    var legend = '';
    for (var l = 0; l < clsState.nFacies; l++) {
      legend += '<span class="lg"><i style="background:' + M.FACI_COLORS[l] + '"></i>' + M.FACI_NAMES[l] + '</span>';
    }
    $('clsLegend').innerHTML = legend;
  }

  /* ---------- 屏 2 渲染：半监督扩展 ---------- */
  function renderSemi() {
    var semi = M.semiExpand(grid1, cls1.prob, cls1.cls, clsState.nFacies, semiState.nLabeled, semiState.pseudoThr);
    var W = 40, H = 30, gap = 2;
    var s = '';
    var idx = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++, idx++) {
        var x = c * (W + gap) + 4, y = r * (H + gap) + 4;
        var fill = '#e9e4d8';
        if (semi.labeled[idx]) fill = '#2f7d6b';
        else if (semi.pseudo[idx]) fill = '#b26a39';
        s += '<rect x="' + x + '" y="' + y + '" width="' + W + '" height="' + H + '" fill="' + fill + '" stroke="#888" stroke-width="1"/>';
        if (semi.labeled[idx]) s += '<text x="' + (x + W / 2) + '" y="' + (y + H / 2 + 4) + '" text-anchor="middle" font-size="9" fill="#fff" font-weight="700">井</text>';
        else if (semi.pseudo[idx]) s += '<text x="' + (x + W / 2) + '" y="' + (y + H / 2 + 4) + '" text-anchor="middle" font-size="9" fill="#fff" font-weight="700">伪</text>';
      }
    }
    $('semiChart').innerHTML = s;
    var covered = 0;
    for (var i = 0; i < semi.covered.length; i++) covered += semi.covered[i];
    $('roCovered').textContent = covered + ' / ' + semi.covered.length + ' 切片已标定';
    $('roPseudo').textContent = semi.pseudoCount + ' 个伪标签';
  }

  /* ---------- 屏 3 渲染：相带概率体 ---------- */
  function renderProb() {
    var fp = M.faciesProb(grid1, cls1.prob, cls1.cls, clsState.nFacies, probState.smooth);
    var W = 40, H = 30, gap = 2;
    var s = '';
    var idx = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++, idx++) {
        var f = fp.clsSmooth[idx];
        var x = c * (W + gap) + 4, y = r * (H + gap) + 4;
        s += '<rect x="' + x + '" y="' + y + '" width="' + W + '" height="' + H + '" fill="' + M.FACI_COLORS[f] + '" stroke="#888" stroke-width="1"/>';
      }
    }
    $('probChart').innerHTML = s;
    /* 邻域一致性：与真值一致的比例 */
    var match = 0;
    for (var i = 0; i < grid1.grid.length; i++) if (fp.clsSmooth[i] === grid1.grid[i].facies) match++;
    $('roMatch').textContent = num((match / grid1.grid.length) * 100, 1) + '%';
    if ($('roSmooth')) $('roSmooth').textContent = probState.smooth;
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    var faciBtns = $('faciBtns');
    if (faciBtns) faciBtns.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      clsState.nFacies = parseInt(b.dataset.facies, 10);
      Array.prototype.forEach.call(faciBtns.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
      renderCls(); renderSemi(); renderProb();
    });
    var inWeight = $('inWeight');
    if (inWeight) inWeight.addEventListener('input', function () {
      clsState.weight = parseFloat(inWeight.value);
      $('outWeight').textContent = num(clsState.weight, 2);
      renderCls(); renderSemi(); renderProb();
    });
    var inLabeled = $('inLabeled');
    if (inLabeled) inLabeled.addEventListener('input', function () {
      semiState.nLabeled = parseInt(inLabeled.value, 10);
      $('outLabeled').textContent = semiState.nLabeled;
      renderSemi();
    });
    var inPseudo = $('inPseudo');
    if (inPseudo) inPseudo.addEventListener('input', function () {
      semiState.pseudoThr = parseFloat(inPseudo.value);
      $('outPseudo').textContent = num(semiState.pseudoThr, 2);
      renderSemi();
    });
    var inSmooth = $('inSmooth');
    if (inSmooth) inSmooth.addEventListener('input', function () {
      probState.smooth = parseInt(inSmooth.value, 10);
      $('outSmooth').textContent = probState.smooth;
      renderProb();
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '切片分类', 'clsCtl'], ['sec2', '半监督扩展', 'semiCtl'], ['sec3', '相带概率体', 'probCtl']].forEach(function (s) {
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
  renderCls(); renderSemi(); renderProb();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
