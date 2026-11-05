/* =========================================================
   地质剖面遥感解译 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  语义分割：逐像素判别岩性类别（概率图 + argmax）
   屏 2  构造线提取：从概率图里检测断层/褶皱线要素
   屏 3  后处理矢量化：连通域 + 剔除碎斑 + 边界平滑 → 矢量图层
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
       屏 1 · 合成岩性栅格
       生成一个 W×H 的「岩性标签图」，由若干多边形岩性体 + 噪声构成。
       返回 { label: IntArray, conf: FloatArray }
       rock: 岩性类别数；seed 控制布局
       ----------------------------------------------------- */
    var ROCK_NAMES = ['背景', '灰岩', '砂岩', '泥岩', '火山岩', '白云岩', '页岩', '砾岩', '蚀变带'];
    var ROCK_COLORS = ['#e8e4d8', '#cbbf9a', '#e0c88a', '#a8bfd4', '#9b86a8', '#b9ceb4', '#8aa77f', '#d0a3a3', '#e0a878'];

    function genRockGrid(W, H, rocks, seed) {
      var rnd = mulberry32(seed || 20261102);
      var label = new Int32Array(W * H), conf = new Float64Array(W * H);
      /* 几个随机岩性体（椭圆/多边形近似） */
      var bodies = [];
      var nb = Math.max(4, rocks - 1);
      for (var i = 0; i < nb; i++) {
        bodies.push({
          cx: rnd() * W, cy: rnd() * H,
          rx: 30 + rnd() * 90, ry: 24 + rnd() * 70,
          rot: rnd() * Math.PI,
          rock: 1 + Math.floor(rnd() * (rocks - 1)),
          conf: 0.55 + rnd() * 0.4
        });
      }
      /* 一条断层线（斜线），用于构造线演示 */
      var fx = W * 0.28, fy = H * 0.3, fx2 = W * 0.72, fy2 = H * 0.78;
      var x, y, k;
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          var c = -1, bestD = 1e9;
          for (k = 0; k < bodies.length; k++) {
            var b = bodies[k];
            var dx = (x - b.cx) * Math.cos(-b.rot) - (y - b.cy) * Math.sin(-b.rot);
            var dy = (x - b.cx) * Math.sin(-b.rot) + (y - b.cy) * Math.cos(-b.rot);
            var d = (dx * dx) / (b.rx * b.rx) + (dy * dy) / (b.ry * b.ry);
            if (d < bestD) { bestD = d; c = k; }
          }
          if (c < 0) { label[y * W + x] = 0; conf[y * W + x] = 0.4 + rnd() * 0.2; }
          else {
            label[y * W + x] = bodies[c].rock;
            conf[y * W + x] = clamp(bodies[c].conf + (rnd() + rnd() - 1) * 0.12, 0.2, 0.98);
          }
        }
      }
      /* 叠加断层线附近轻微扰动，模拟构造带 */
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          var px = fx + (fx2 - fx) * (x / W), py = fy + (fy2 - fy) * (x / W);
          var dd = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
          if (dd < 4) conf[y * W + x] = clamp(conf[y * W + x] - 0.25, 0.1, 0.9);
        }
      }
      return { W: W, H: H, label: label, conf: conf, bodies: bodies, fault: { x1: fx, y1: fy, x2: fx2, y2: fy2 } };
    }

    /* -----------------------------------------------------
       屏 1 · 语义分割「模型」
       用一个 3×3 邻域加权 + 置信度叠加模拟 U-Net 输出概率图。
       weight 越高，边界越贴近真值（模拟训练充分）。
       返回 { prob: FloatArray(每个像素各岩性的概率), seg: IntArray(argmax) }
       ----------------------------------------------------- */
    function semanticSeg(grid, rocks, weight, noise) {
      var W = grid.W, H = grid.H;
      var n = W * H;
      var prob = new Float64Array(n * rocks); // 摊平：pixel-major
      var seg = new Int32Array(n);
      var rnd = mulberry32(20261103);
      for (var y = 0; y < H; y++) {
        for (var x = 0; x < W; x++) {
          var idx = y * W + x;
          /* 邻域一致性：与 8 邻域同标签的占比 */
          var same = 0, tot = 0;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              var xx = x + dx, yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
              tot++;
              if (grid.label[yy * W + xx] === grid.label[idx]) same++;
            }
          }
          var confBase = grid.conf[idx] * (0.5 + 0.5 * (same / tot));
          /* weight 越高 → 正确类概率越高、误判越少（模拟训练充分程度）。
             低 weight 时正确类概率低、竞争类份额高，出现明显混淆。 */
          var correctP = clamp(0.15 + 0.55 * weight * confBase, 0.10, 0.97);
          var rivalShare = clamp(0.58 - weight * 0.38, 0.02, 0.6) * (1 - correctP);
          var gt = grid.label[idx];
          var best = 0, bestP = -1;
          /* 随机挑一个"竞争类"：weight 低时更容易抢过正确类 */
          var rival = 1 + Math.floor(rnd() * (rocks - 1));
          for (var r = 0; r < rocks; r++) {
            var p;
            if (r === gt) {
              p = correctP + (rnd() + rnd() - 1) * 0.04;
            } else if (r === rival && rival !== gt) {
              p = rivalShare + (rnd() + rnd() - 1) * 0.03;
            } else {
              p = Math.max(0.001, (1 - correctP - (rival !== gt ? rivalShare : 0)) / (rocks - (rival !== gt ? 2 : 1)));
            }
            p = clamp(p, 0.001, 0.999);
            prob[idx * rocks + r] = p;
            if (p > bestP) { bestP = p; best = r; }
          }
          seg[idx] = best;
        }
      }
      return { prob: prob, seg: seg, rocks: rocks };
    }

    /* -----------------------------------------------------
       屏 1 · 分割评估
       与真值标签逐像素对比：整体准确率 + 每类 IoU。
       ----------------------------------------------------- */
    function segEval(grid, seg, rocks) {
      var n = grid.W * grid.H, i, r;
      var acc = 0;
      /* 正确 IoU：interM = 交集计数，uniM = 真值计数 + 预测计数（交集计两次） */
      var interM = new Float64Array(rocks), uniM = new Float64Array(rocks);
      for (i = 0; i < n; i++) {
        var gt = grid.label[i], pd = seg[i];
        if (gt === pd) { acc++; interM[gt]++; }
        uniM[gt]++;
        uniM[pd]++;
      }
      acc /= n;
      var iou = [];
      for (r = 0; r < rocks; r++) {
        var union = uniM[r] - interM[r];
        iou[r] = union > 0 ? interM[r] / union : (interM[r] ? 1 : 0);
      }
      return { acc: acc, iou: iou };
    }

    /* -----------------------------------------------------
       屏 2 · 构造线提取
       从概率图/梯度图检测线状构造：用 Sobel 梯度幅值 + 阈值，
       再做非极大抑制，得到「构造线像素」。返回可画成折线的点列。
       ----------------------------------------------------- */
    function detectFault(grid, thr) {
      var W = grid.W, H = grid.H;
      var grad = new Float64Array(W * H);
      var rnd = mulberry32(20261104);
      var i, y, x;
      /* 简化梯度：对每个像素，统计其与邻居标签不同导致的"边界响应" */
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          var idx = y * W + x;
          var g = 0, cnt = 0;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              var xx = x + dx, yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
              cnt++;
              if (grid.label[yy * W + xx] !== grid.label[idx]) g++;
            }
          }
          /* 加入与断层线的距离响应，模拟构造带梯度 */
          var fx = grid.fault.x1 + (grid.fault.x2 - grid.fault.x1) * (x / W);
          var fy = grid.fault.y1 + (grid.fault.y2 - grid.fault.y1) * (x / W);
          var dd = Math.sqrt((x - fx) * (x - fx) + (y - fy) * (y - fy));
          g += dd < 3 ? 3.2 : (dd < 6 ? 1.2 : 0);
          grad[idx] = (g / cnt) * (1 + rnd() * 0.2);
        }
      }
      /* 阈值 → 线像素 */
      var pts = [];
      var lineMask = new Uint8Array(W * H);
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          var idx2 = y * W + x;
          if (grad[idx2] > thr) {
            lineMask[idx2] = 1;
            pts.push({ x: x, y: y, g: grad[idx2] });
          }
        }
      }
      return { grad: grad, pts: pts, lineMask: lineMask, thr: thr };
    }

    /* -----------------------------------------------------
       屏 3 · 后处理矢量化
       connected components on 分割图 → 剔除小面积碎斑 → 边界点序列
       返回 { comps: [{id,rock,size,pts:[]}], kept }
       ----------------------------------------------------- */
    function vectorize(grid, seg, rocks, minArea) {
      var W = grid.W, H = grid.H, n = W * H;
      var compId = new Int32Array(n).fill(-1);
      var sizes = [], rocksOf = [], comps = [];
      var id = 0, i, x, y;
      /* BFS 连通域（4 邻域） */
      var stack = [];
      for (i = 0; i < n; i++) {
        if (compId[i] >= 0) continue;
        var rock = seg[i];
        var ccid = id++;
        compId[i] = ccid;
        stack.push(i);
        var cnt = 0;
        var pts = [];
        while (stack.length) {
          var cur = stack.pop();
          cnt++;
          var cx = cur % W, cy = (cur / W) | 0;
          pts.push([cx, cy]);
          var neigh = [[1, 0], [-1, 0], [0, 1], [0, -1]];
          for (var ni = 0; ni < 4; ni++) {
            var nx = cx + neigh[ni][0], ny = cy + neigh[ni][1];
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            var nidx = ny * W + nx;
            if (compId[nidx] < 0 && seg[nidx] === rock) {
              compId[nidx] = ccid;
              stack.push(nidx);
            }
          }
        }
        sizes.push(cnt); rocksOf.push(rock); comps.push({ id: ccid, rock: rock, size: cnt, pts: pts });
      }
      /* 剔除碎斑：size < minArea 的合并到背景 */
      var segClean = new Int32Array(n);
      for (i = 0; i < n; i++) {
        var cid = compId[i];
        segClean[i] = (sizes[cid] < minArea) ? 0 : seg[i];
      }
      /* 保留的连通域边界 */
      var kept = [];
      for (var c = 0; c < comps.length; c++) {
        if (sizes[c] >= minArea) kept.push(comps[c]);
      }
      return { compId: compId, sizes: sizes, rocksOf: rocksOf, segClean: segClean, kept: kept, minArea: minArea };
    }

    return {
      clamp: clamp, mulberry32: mulberry32,
      ROCK_NAMES: ROCK_NAMES, ROCK_COLORS: ROCK_COLORS,
      genRockGrid: genRockGrid, semanticSeg: semanticSeg, segEval: segEval,
      detectFault: detectFault, vectorize: vectorize
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
  var segState = { rocks: 5, weight: 0.5, noise: 0.15 };
  var faultThr = 0.6;
  var vecState = { minArea: 18 };

  /* 桥接：给算法解剖动画用同一份真代码 */
  global.RemoteBridge = {
    M: M,
    genRockGrid: M.genRockGrid, semanticSeg: M.semanticSeg, segEval: M.segEval,
    detectFault: M.detectFault, vectorize: M.vectorize,
    live: function () {
      return { rocks: segState.rocks, weight: segState.weight, noise: segState.noise, thr: faultThr, minArea: vecState.minArea };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 1 : d); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------- 屏 1 渲染：语义分割 ---------- */
  var grid1 = M.genRockGrid(64, 48, segState.rocks, 20261102);
  var seg1 = M.semanticSeg(grid1, segState.rocks, segState.weight, segState.noise);

  function renderSeg() {
    var rocks = segState.rocks;
    grid1 = M.genRockGrid(64, 48, rocks, 20261102);
    seg1 = M.semanticSeg(grid1, rocks, segState.weight, segState.noise);
    var ev = M.segEval(grid1, seg1.seg, rocks);

    /* 原图（真值标签着色） */
    var sTrue = '';
    for (var y = 0; y < 48; y++) {
      for (var x = 0; x < 64; x++) {
        var r = grid1.label[y * 64 + x];
        sTrue += '<rect x="' + (x * 8) + '" y="' + (y * 8) + '" width="8" height="8" fill="' + M.ROCK_COLORS[r] + '"/>';
      }
    }
    $('segTrue').innerHTML = sTrue;

    /* 预测结果（argmax 着色） */
    var sPred = '';
    for (var y2 = 0; y2 < 48; y2++) {
      for (var x2 = 0; x2 < 64; x2++) {
        var r2 = seg1.seg[y2 * 64 + x2];
        sPred += '<rect x="' + (x2 * 8) + '" y="' + (y2 * 8) + '" width="8" height="8" fill="' + M.ROCK_COLORS[r2] + '"/>';
      }
    }
    $('segPred').innerHTML = sPred;

    /* 概率图（当前像素集中显示为概率条） */
    var sProb = '';
    for (var py = 0; py < 48; py += 2) {
      for (var px = 0; px < 64; px += 2) {
        var idx = py * 64 + px;
        var gt = grid1.label[idx];
        var p = seg1.prob[idx * rocks + gt];
        var g = Math.round(255 * p);
        var color = 'rgb(' + (255 - g) + ',' + g + ',' + (220 - g * 0.6) + ')';
        sProb += '<rect x="' + (px * 8) + '" y="' + (py * 8) + '" width="16" height="16" fill="' + color + '"/>';
      }
    }
    $('segProb').innerHTML = sProb;

    /* 结果读数 */
    $('roAcc').textContent = num(ev.acc * 100, 1) + '%';
    var iouTxt = [];
    for (var r3 = 1; r3 < rocks; r3++) {
      iouTxt.push(M.ROCK_NAMES[r3] + ' ' + num(ev.iou[r3] * 100, 0) + '%');
    }
    $('roIou').textContent = iouTxt.join(' · ');
    /* 图例 */
    var legend = '';
    for (var r4 = 0; r4 < rocks; r4++) {
      legend += '<span class="lg"><i style="background:' + M.ROCK_COLORS[r4] + '"></i>' + M.ROCK_NAMES[r4] + '</span>';
    }
    $('segLegend').innerHTML = legend;
  }

  /* ---------- 屏 2 渲染：构造线提取 ---------- */
  function renderFault() {
    var det = M.detectFault(grid1, faultThr);
    var W = 64, H = 48;
    /* 梯度热图（背景） */
    var s = '';
    var maxG = 1.2;
    for (var y = 0; y < H; y += 2) {
      for (var x = 0; x < W; x += 2) {
        var g = det.grad[y * W + x];
        var t = clamp(g / maxG, 0, 1);
        var r = Math.round(255 * t), gr = Math.round(255 * (1 - t));
        s += '<rect x="' + (x * 8) + '" y="' + (y * 8) + '" width="16" height="16" fill="rgb(' + r + ',' + gr + ',150)"/>';
      }
    }
    /* 检出线像素 */
    for (var yi = 0; yi < det.pts.length; yi++) {
      var p = det.pts[yi];
      s += '<rect x="' + (p.x * 8 + 2) + '" y="' + (p.y * 8 + 2) + '" width="4" height="4" fill="#b05a51"/>';
    }
    /* 真实断层线参考 */
    s += '<line x1="' + grid1.fault.x1 * 8 + '" y1="' + grid1.fault.y1 * 8 + '" x2="' + grid1.fault.x2 * 8 + '" y2="' + grid1.fault.y2 * 8 + '" stroke="#2f7d6b" stroke-width="2" stroke-dasharray="6 3"/>';
    $('faultChart').innerHTML = s;
    $('roFaultPts').textContent = det.pts.length + ' 个线像素';
    $('roThr').textContent = num(faultThr, 2);
  }

  /* ---------- 屏 3 渲染：后处理矢量化 ---------- */
  function renderVec() {
    var vec = M.vectorize(grid1, seg1.seg, segState.rocks, vecState.minArea);
    var s = '';
    /* 剔除碎斑后的结果 */
    for (var y = 0; y < 48; y++) {
      for (var x = 0; x < 64; x++) {
        var r = vec.segClean[y * 64 + x];
        s += '<rect x="' + (x * 8) + '" y="' + (y * 8) + '" width="8" height="8" fill="' + M.ROCK_COLORS[r] + '"/>';
      }
    }
    /* 保留的连通域边界（描边） */
    for (var c = 0; c < vec.kept.length; c++) {
      var comp = vec.kept[c];
      var minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
      for (var pi = 0; pi < comp.pts.length; pi++) {
        if (comp.pts[pi][0] < minX) minX = comp.pts[pi][0];
        if (comp.pts[pi][0] > maxX) maxX = comp.pts[pi][0];
        if (comp.pts[pi][1] < minY) minY = comp.pts[pi][1];
        if (comp.pts[pi][1] > maxY) maxY = comp.pts[pi][1];
      }
      s += '<rect x="' + (minX * 8) + '" y="' + (minY * 8) + '" width="' + ((maxX - minX + 1) * 8) + '" height="' + ((maxY - minY + 1) * 8) + '" fill="none" stroke="#b26a39" stroke-width="1.6"/>';
    }
    $('vecChart').innerHTML = s;
    $('roComps').textContent = vec.kept.length + ' 个面要素';
    $('roDropped').textContent = (vec.sizes.length - vec.kept.length) + ' 个碎斑剔除';
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    var rocksBtns = $('rocksBtns');
    if (rocksBtns) rocksBtns.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      segState.rocks = parseInt(b.dataset.rocks, 10);
      Array.prototype.forEach.call(rocksBtns.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
      renderSeg(); renderFault(); renderVec();
    });
    var inWeight = $('inWeight');
    if (inWeight) inWeight.addEventListener('input', function () {
      segState.weight = parseFloat(inWeight.value);
      $('outWeight').textContent = num(segState.weight, 2);
      renderSeg(); renderFault(); renderVec();
    });
    var inThr = $('inThr');
    if (inThr) inThr.addEventListener('input', function () {
      faultThr = parseFloat(inThr.value);
      renderFault();
    });
    var inMin = $('inMinArea');
    if (inMin) inMin.addEventListener('input', function () {
      vecState.minArea = parseInt(inMin.value, 10);
      $('outMinArea').textContent = vecState.minArea;
      renderVec();
    });
  }

  /* 抽屉上报（嵌入主站时按段落显示控件） */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '语义分割', 'segCtl'], ['sec2', '构造线提取', 'faultCtl'], ['sec3', '矢量化', 'vecCtl']].forEach(function (s) {
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
  renderSeg(); renderFault(); renderVec();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
