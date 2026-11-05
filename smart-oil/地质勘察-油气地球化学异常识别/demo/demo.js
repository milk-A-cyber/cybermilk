/* =========================================================
   油气地球化学异常识别 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  多指标异常检测：马氏距离 → 每采样点异常分数（对比单指标）
   屏 2  空间聚类成靶区：DBSCAN 把邻近高异常点聚成靶区
   屏 3  靶区概率图：地统计插值 + 分层 → 与已知靶区重合度
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

    var METRIC_NAMES = ['吸附烃', '酸解烃', 'ΔC', '热释烃', '碳酸盐', '重烃', '甲烷'];
    var METRIC_COLORS = ['#41699b', '#2f7d6b', '#b26a39', '#7a4e9b', '#9ba3a9', '#b98f5a', '#5a8a9b'];

    /* -----------------------------------------------------
       屏 1 · 合成化探采样点
       单区块 N 个采样点，每个点一组多指标（METRIC_N 项）。
       背景服从多元正态，叠加 K 个「组合异常」区块（多指标一起偏高）。
       seed 控制布局；返回 { pts, W, H }
       pt: { x, y, z (归一化平面坐标), m: FloatArray(指标), target: 是否已知靶区内 }
       ----------------------------------------------------- */
    function genPoints(N, K, noise, seed) {
      var rnd = mulberry32(seed || 20261103);
      var W = 60, H = 48; /* 归一化平面 60×48，画 SVG 时映射 */
      var nMetric = 6;
      var pts = [];
      /* 若干背景点：多指标在基线附近波动 */
      var base = 10;
      var i, j;
      for (i = 0; i < N; i++) {
        var m = new Float64Array(nMetric);
        for (j = 0; j < nMetric; j++) {
          m[j] = base + (rnd() - 0.5) * 2.2 + rnd() * noise * 3;
        }
        /* 约 18% 背景点是「单项偶发高值」的污染点（地表污染假异常）：
           单个指标突然冒高，但其他指标正常——单指标阈值会被它骗。 */
        if (rnd() < 0.18) {
          var pollIdx = Math.floor(rnd() * nMetric);
          m[pollIdx] += 6 + rnd() * 6;
        }
        pts.push({ x: rnd() * W, y: rnd() * H, z: base, m: m, target: 0 });
      }
      /* 叠加 K 个组合异常区。
         「组合异常」= 油气渗漏的三项烃类指标（吸附烃/酸解烃/ΔC，即 m[0..2]）
         协同偏高，而其他指标保持正常。
         多指标马氏距离要求「多项一起偏离」才能判为异常，
         单指标（只看吸附烃）虽然能抓到大部分异常点，却被上面的单项污染点干扰，
         导致 top 判定的靶区里混入假异常——这就是多指标联合的价值。 */
      var anomalyPts = 0;
      for (var a = 0; a < K; a++) {
        var cx = 8 + rnd() * (W - 16), cy = 6 + rnd() * (H - 12);
        var rx = 5 + rnd() * 6, ry = 4 + rnd() * 5;
        var amp = 4 + rnd() * 4; /* 协同升高幅度 */
        var nA = Math.floor(24 + rnd() * 18); /* 每个异常区点数 */
        var idx;
        for (idx = 0; idx < nA; idx++) {
          var px = cx + (rnd() - 0.5) * 2 * rx, py = cy + (rnd() - 0.5) * 2 * ry;
          if (px < 0 || px > W || py < 0 || py > H) continue;
          var m2 = new Float64Array(nMetric);
          for (j = 0; j < nMetric; j++) m2[j] = base + (rnd() - 0.5) * 2.2 + rnd() * noise * 3;
          /* 三项烃类指标协同升高 */
          m2[0] += amp * (0.85 + rnd() * 0.5);
          m2[1] += amp * (0.75 + rnd() * 0.5);
          m2[2] += amp * (0.65 + rnd() * 0.5);
          pts.push({ x: px, y: py, z: base + amp, m: m2, target: 1 });
          anomalyPts++;
        }
      }
      return { pts: pts, W: W, H: H, nMetric: nMetric, anomalyPts: anomalyPts };
    }

    /* -----------------------------------------------------
       多指标异常检测：鲁棒马氏距离 → 异常分数
       对每个点的多指标向量，算它与背景分布的马氏距离（含协方差）。
       返回每点 score（0~1 归一化）+ 用单指标阈值法算的 singleScore。
       ----------------------------------------------------- */
    function detectAnomaly(pts, nMetric, noise) {
      var n = pts.length, i, j;
      /* 鲁棒中心化：用中位数代替均值（不受异常点/污染点拉偏） */
      var med = new Float64Array(nMetric);
      var col = new Float64Array(n);
      for (j = 0; j < nMetric; j++) {
        for (i = 0; i < n; i++) col[i] = pts[i].m[j];
        med[j] = median(col, n);
      }
      /* 鲁棒缩放：MAD（绝对中位差）× 1.4826 ≈ 标准差 */
      var scale = new Float64Array(nMetric);
      for (j = 0; j < nMetric; j++) {
        for (i = 0; i < n; i++) col[i] = Math.abs(pts[i].m[j] - med[j]);
        var mad = median(col, n) * 1.4826;
        scale[j] = mad > 1e-6 ? mad : 1;
      }
      /* 标准化：x' = (x - med) / scale */
      var z = new Float64Array(n * nMetric);
      for (i = 0; i < n; i++) for (j = 0; j < nMetric; j++) z[i * nMetric + j] = (pts[i].m[j] - med[j]) / scale[j];
      /* 联合异常分数 = 「协同度」+ 平均偏离。
         协同度：z 绝对值超过 2.0 的指标个数（异常点多项协同 → 计数高）；
         平均偏离：各指标 |z| 的均值（平滑量级）。
         score = 协同度(主导) × 加权 + 平均偏离。
         单项污染点协同度只有 1，即使单项 z 爆高也压不过协同度高的异常点。 */
      var d2 = new Float64Array(n);
      var zth = 2.0;
      for (i = 0; i < n; i++) {
        var cnt = 0, sum = 0;
        for (j = 0; j < nMetric; j++) {
          var az = Math.abs(z[i * nMetric + j]);
          sum += az;
          if (az > zth) cnt++;
        }
        /* 协同度权重高：cnt>=3 显著高于 cnt=1 */
        d2[i] = cnt * 3 + sum / nMetric;
      }
      /* 归一化到 0~1（分位数映射） */
      var maxD = 0, minD = 1e9;
      for (i = 0; i < n; i++) { if (d2[i] > maxD) maxD = d2[i]; if (d2[i] < minD) minD = d2[i]; }
      var span = maxD - minD || 1;
      var score = new Float64Array(n);
      for (i = 0; i < n; i++) score[i] = clamp((d2[i] - minD) / span, 0, 1);
      /* 单指标阈值法：只看第 0 项（吸附烃），做对比 */
      var s1 = new Float64Array(n);
      var m0min = 1e9, m0max = -1e9;
      for (i = 0; i < n; i++) { if (pts[i].m[0] < m0min) m0min = pts[i].m[0]; if (pts[i].m[0] > m0max) m0max = pts[i].m[0]; }
      var m0span = m0max - m0min || 1;
      for (i = 0; i < n; i++) s1[i] = clamp((pts[i].m[0] - m0min) / m0span, 0, 1);
      return { score: score, s1: s1, d2: d2, mean: med, scale: scale };
    }

    function median(arr, n) {
      var a = arr.slice(0, n).sort(function (x, y) { return x - y; });
      var m = n >> 1;
      return n % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    }

    function invert(m, n) {
      var a = new Float64Array(m), aug = new Float64Array(n * n * 2);
      var i, j, k;
      for (i = 0; i < n * n; i++) aug[i] = m[i];
      for (i = 0; i < n; i++) aug[i * 2 * n + n + i] = 1;
      for (i = 0; i < n; i++) {
        /* 选主元 */
        var pivot = i;
        for (k = i + 1; k < n; k++) if (Math.abs(aug[k * 2 * n + i]) > Math.abs(aug[pivot * 2 * n + i])) pivot = k;
        if (Math.abs(aug[pivot * 2 * n + i]) < 1e-12) continue;
        if (pivot !== i) {
          for (j = 0; j < 2 * n; j++) { var t = aug[i * 2 * n + j]; aug[i * 2 * n + j] = aug[pivot * 2 * n + j]; aug[pivot * 2 * n + j] = t; }
        }
        var div = aug[i * 2 * n + i];
        for (j = 0; j < 2 * n; j++) aug[i * 2 * n + j] /= div;
        for (k = 0; k < n; k++) {
          if (k === i) continue;
          var f = aug[k * 2 * n + i];
          if (Math.abs(f) < 1e-15) continue;
          for (j = 0; j < 2 * n; j++) aug[k * 2 * n + j] -= f * aug[i * 2 * n + j];
        }
      }
      for (i = 0; i < n; i++) for (j = 0; j < n; j++) a[i * n + j] = aug[i * 2 * n + n + j];
      return a;
    }

    /* -----------------------------------------------------
       屏 2 · DBSCAN 空间聚类
       对异常分数高于 th 的点做密度聚类（eps 邻域 + minPts）。
       返回 { labels: IntArray(按点), clusters: [..], noiseIds }
       ----------------------------------------------------- */
    function clusterAnomaly(pts, score, th, eps, minPts) {
      var n = pts.length, i;
      var labels = new Int32Array(n).fill(-1); /* -1 未访问 / -2 噪声 */
      var clusters = [];
      for (i = 0; i < n; i++) labels[i] = -1;
      var visited = new Array(n).fill(0);
      var cid = 0;
      for (i = 0; i < n; i++) {
        if (visited[i]) continue;
        visited[i] = 1;
        if (score[i] < th) continue; /* 非异常点，跳过 */
        var neigh = regionQuery(pts, i, eps);
        if (neigh.length < minPts) { labels[i] = -2; continue; }
        /* 新建簇 */
        labels[i] = cid;
        var seed = neigh.slice();
        while (seed.length) {
          var q = seed.pop();
          if (!visited[q]) {
            visited[q] = 1;
            if (score[q] >= th) {
              var qN = regionQuery(pts, q, eps);
              if (qN.length >= minPts) seed = seed.concat(qN);
            }
          }
          if (labels[q] === -1 || labels[q] === -2) labels[q] = cid;
        }
        cid++;
      }
      /* 整理簇：每个簇的点集合 + 中心 */
      var byC = {};
      for (i = 0; i < n; i++) {
        var c = labels[i];
        if (c >= 0) { (byC[c] = byC[c] || []).push(i); }
      }
      var clustersOut = [];
      var keys = Object.keys(byC).map(Number).sort(function (a, b) { return a - b; });
      for (var k = 0; k < keys.length; k++) {
        var ids = byC[keys[k]];
        var cx = 0, cy = 0;
        for (i = 0; i < ids.length; i++) { cx += pts[ids[i]].x; cy += pts[ids[i]].y; }
        clustersOut.push({ id: keys[k], ids: ids, cx: cx / ids.length, cy: cy / ids.length, size: ids.length });
      }
      return { labels: labels, clusters: clustersOut, nCluster: clustersOut.length, noiseCount: countNoise(labels, n) };
    }

    function countNoise(labels, n) { var c = 0; for (var i = 0; i < n; i++) if (labels[i] === -2) c++; return c; }

    function regionQuery(pts, idx, eps) {
      var out = [];
      for (var i = 0; i < pts.length; i++) {
        var dx = pts[i].x - pts[idx].x, dy = pts[i].y - pts[idx].y;
        if (dx * dx + dy * dy <= eps * eps) out.push(i);
      }
      return out;
    }

    /* -----------------------------------------------------
       屏 3 · 靶区概率图（地统计插值 + 分层）
       用 IDW 把异常分数插值成连续概率场（grid G×G）。
       再按 pTh 分层：高/中/低潜力区。
       返回 { grid: FloatArray(G*G), layer: IntArray, G }
       ----------------------------------------------------- */
    function interpProb(pts, score, G, power, radius) {
      var n = pts.length;
      var grid = new Float64Array(G * G);
      var minX = 0, maxX = 60, minY = 0, maxY = 48;
      var stepX = (maxX - minX) / G, stepY = (maxY - minY) / G;
      var gx, gy, i;
      for (gy = 0; gy < G; gy++) {
        for (gx = 0; gx < G; gx++) {
          var px = minX + (gx + 0.5) * stepX, py = minY + (gy + 0.5) * stepY;
          var wsum = 0, ssum = 0;
          for (i = 0; i < n; i++) {
            var dx = pts[i].x - px, dy = pts[i].y - py;
            var d2 = dx * dx + dy * dy;
            if (d2 < 1e-9) { ssum = score[i] * 1e9; wsum = 1e9; continue; }
            var w = 1 / Math.pow(Math.sqrt(d2), power);
            wsum += w; ssum += w * score[i];
          }
          grid[gy * G + gx] = wsum > 0 ? ssum / wsum : 0;
        }
      }
      /* 归一化到 0~1 */
      var mx = 0, mn = 1;
      for (i = 0; i < G * G; i++) { if (grid[i] > mx) mx = grid[i]; if (grid[i] < mn) mn = grid[i]; }
      var span = mx - mn || 1;
      for (i = 0; i < G * G; i++) grid[i] = clamp((grid[i] - mn) / span, 0, 1);
      return { grid: grid, G: G };
    }

    /* 分层：高(2)/中(1)/低(0) 潜力 */
    function layerProb(grid, G, pHi, pMid) {
      var layer = new Int32Array(G * G);
      for (var i = 0; i < G * G; i++) {
        layer[i] = grid[i] >= pHi ? 2 : (grid[i] >= pMid ? 1 : 0);
      }
      return layer;
    }

    /* 与已知靶区重合度：算法高潜力区（grid >= pTh）与 target 点的重合比例 */
    function targetOverlap(pts, grid, G, pTh) {
      var hit = 0, tot = 0, i;
      var stepX = 60 / G, stepY = 48 / G;
      for (i = 0; i < pts.length; i++) {
        if (!pts[i].target) continue;
        tot++;
        var gx = Math.floor(pts[i].x / stepX), gy = Math.floor(pts[i].y / stepY);
        if (gx < 0) gx = 0; if (gx >= G) gx = G - 1;
        if (gy < 0) gy = 0; if (gy >= G) gy = G - 1;
        if (grid[gy * G + gx] >= pTh) hit++;
      }
      return tot ? hit / tot : 0;
    }

    return {
      clamp: clamp, mulberry32: mulberry32,
      METRIC_NAMES: METRIC_NAMES, METRIC_COLORS: METRIC_COLORS,
      genPoints: genPoints, detectAnomaly: detectAnomaly,
      clusterAnomaly: clusterAnomaly, interpProb: interpProb, layerProb: layerProb,
      targetOverlap: targetOverlap
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
  var detState = { pts: 300, K: 4, noise: 0.35, th: 0.6 };
  var clsState = { eps: 2.2, minPts: 4, th: 0.55 };
  var probState = { pTh: 0.55, power: 2, pHi: 0.75, pMid: 0.45 };

  /* 数据缓存：一次生成，多屏复用 */
  var geo = M.genPoints(detState.pts, detState.K, detState.noise, 20261103);
  var pts = geo.pts;
  var NM = geo.nMetric;
  var det = M.detectAnomaly(pts, NM, detState.noise);

  /* 桥接：给算法解剖动画用同一份真代码 */
  global.RemoteBridge = {
    M: M,
    genPoints: M.genPoints, detectAnomaly: M.detectAnomaly,
    clusterAnomaly: M.clusterAnomaly, interpProb: M.interpProb, layerProb: M.layerProb,
    targetOverlap: M.targetOverlap,
    live: function () {
      return { pts: detState.pts, K: detState.K, noise: detState.noise, th: detState.th, eps: clsState.eps, minPts: clsState.minPts, pTh: probState.pTh, power: probState.power, pHi: probState.pHi, pMid: probState.pMid };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 1 : d); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  var PA = '#b26a39', PB = '#41699b', PC = '#2f7d6b', PNOISE = '#9ba3a9', PBG = '#e8e4d8';
  function hexA(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  /* =====================================================
     屏 1 · 多指标异常检测
     ===================================================== */
  var W1 = 60, H1 = 48, S1 = 8; /* SVG 480×384 */

  function renderDet() {
    var n = pts.length, i;
    /* 单指标 vs 多指标：异常分数排序后的 top 判定 */
    var topN = Math.max(10, Math.floor(n * 0.1));
    /* 单指标：取第 0 项 top */
    var singleIdx = [];
    for (i = 0; i < n; i++) singleIdx.push(i);
    singleIdx.sort(function (a, b) { return det.s1[b] - det.s1[a]; });
    var singleTop = {};
    for (i = 0; i < topN; i++) singleTop[singleIdx[i]] = 1;
    var multiIdx = singleIdx.slice().sort(function (a, b) { return det.score[b] - det.score[a]; });
    var multiTop = {};
    for (i = 0; i < topN; i++) multiTop[multiIdx[i]] = 1;

    var s1 = '', s2 = '';
    for (i = 0; i < n; i++) {
      var px = pts[i].x * S1, py = pts[i].y * S1;
      var colSingle = singleTop[i] ? PA : (det.s1[i] > detState.th ? '#c98a5c' : PNOISE);
      var colMulti = multiTop[i] ? PB : (det.score[i] > detState.th ? '#7fa3c9' : PNOISE);
      s1 += '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="3.4" fill="' + colSingle + '"/>';
      s2 += '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="3.4" fill="' + colMulti + '"/>';
    }
    $('detSingle').innerHTML = s1;
    $('detMulti').innerHTML = s2;

    /* 读数 */
    var singleHit = 0, multiHit = 0, targetCnt = 0;
    for (i = 0; i < n; i++) { if (pts[i].target) { targetCnt++; if (singleTop[i]) singleHit++; if (multiTop[i]) multiHit++; } }
    $('roDetSingle').innerHTML = (singleHit / Math.max(1, targetCnt) * 100).toFixed(0) + '%';
    $('roDetMulti').innerHTML = (multiHit / Math.max(1, targetCnt) * 100).toFixed(0) + '%';
    $('roDetDelta').innerHTML = '+ ' + (Math.max(0, multiHit - singleHit) / Math.max(1, targetCnt) * 100).toFixed(0) + '%';
    /* 假异常：top 里非 target 的点 */
    var singleFA = 0, multiFA = 0;
    for (i = 0; i < n; i++) {
      if (singleTop[i] && !pts[i].target) singleFA++;
      if (multiTop[i] && !pts[i].target) multiFA++;
    }
    $('roDetFA').innerHTML = multiFA + ' / ' + singleFA;
  }

  /* =====================================================
     屏 2 · 空间聚类成靶区
     ===================================================== */
  var S2 = 8;

  function renderCls() {
    var n = pts.length, i;
    var cl = M.clusterAnomaly(pts, det.score, clsState.th, clsState.eps, clsState.minPts);
    var CLUS_COL = [PB, PC, PA, '#7a4e9b', '#b98f5a', '#5a8a9b', '#41699b', '#2f7d6b'];
    var s = '';
    /* 背景点 */
    for (i = 0; i < n; i++) {
      var px = pts[i].x * S2, py = pts[i].y * S2;
      var col;
      if (cl.labels[i] === -2) col = '#d7a27c'; /* 噪声 */
      else if (cl.labels[i] >= 0) col = CLUS_COL[cl.labels[i] % CLUS_COL.length];
      else col = det.score[i] > clsState.th ? '#7fa3c9' : PNOISE;
      s += '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="3.2" fill="' + col + '"/>';
    }
    /* 簇边界椭圆 */
    for (i = 0; i < cl.clusters.length; i++) {
      var c = cl.clusters[i];
      var rx = 0, ry = 0, j;
      for (j = 0; j < c.ids.length; j++) {
        var dx = pts[c.ids[j]].x - c.cx, dy = pts[c.ids[j]].y - c.cy;
        if (Math.abs(dx) > rx) rx = Math.abs(dx);
        if (Math.abs(dy) > ry) ry = Math.abs(dy);
      }
      s += '<ellipse cx="' + (c.cx * S2).toFixed(1) + '" cy="' + (c.cy * S2).toFixed(1) + '" rx="' + (rx * S2 + 6).toFixed(1) + '" ry="' + (ry * S2 + 6).toFixed(1) + '" fill="' + hexA(CLUS_COL[c.id % CLUS_COL.length], 0.14) + '" stroke="' + CLUS_COL[c.id % CLUS_COL.length] + '" stroke-width="1.2" stroke-dasharray="4 3"/>';
    }
    $('clsChart').innerHTML = s;
    $('roClsClusters').innerHTML = cl.nCluster + ' 个';
    $('roClsNoise').innerHTML = cl.noiseCount + ' 点';
    $('roClsSize').innerHTML = (cl.clusters.length ? Math.round(cl.clusters.reduce(function (a, c) { return a + c.size; }, 0) / cl.clusters.length) : 0) + ' 点/靶区';
  }

  /* =====================================================
     屏 3 · 靶区概率图 + 重合度
     ===================================================== */
  var G3 = 30, S3 = 15; /* SVG 450×360 */
  function probColor(p) {
    if (p >= probState.pHi) return PC;
    if (p >= probState.pMid) return '#7fc0a9';
    if (p >= probState.pTh) return '#d7e8de';
    return '#eef1f1';
  }

  function renderProb() {
    var interp = M.interpProb(pts, det.score, G3, probState.power, 12);
    var layer = M.layerProb(interp.grid, G3, probState.pHi, probState.pMid);
    var s = '';
    var gx, gy;
    for (gy = 0; gy < G3; gy++) {
      for (gx = 0; gx < G3; gx++) {
        s += '<rect x="' + (gx * S3) + '" y="' + (gy * S3) + '" width="' + S3 + '" height="' + S3 + '" fill="' + probColor(interp.grid[gy * G3 + gx]) + '"/>';
      }
    }
    /* 叠加已知靶区边界 */
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].target) {
        s += '<circle cx="' + (pts[i].x * S3) + '" cy="' + (pts[i].y * S3) + '" r="3.4" fill="none" stroke="#7a4e9b" stroke-width="1.3"/>';
      }
    }
    $('probChart').innerHTML = s;
    var overlap = M.targetOverlap(pts, interp.grid, G3, probState.pTh);
    $('roOverlap').innerHTML = (overlap * 100).toFixed(0) + '%';
    /* 高/中/低潜力区占比 */
    var hi = 0, mid = 0, lo = 0;
    for (i = 0; i < G3 * G3; i++) { if (layer[i] === 2) hi++; else if (layer[i] === 1) mid++; else lo++; }
    $('roProbHi').innerHTML = (hi / (G3 * G3) * 100).toFixed(0) + '%';
    $('roProbMid').innerHTML = (mid / (G3 * G3) * 100).toFixed(0) + '%';
    $('roProbLo').innerHTML = (lo / (G3 * G3) * 100).toFixed(0) + '%';
  }

  /* 重建数据（改噪声时复用） */
  function regen() {
    geo = M.genPoints(detState.pts, detState.K, detState.noise, 20261103);
    pts = geo.pts;
    NM = geo.nMetric;
    det = M.detectAnomaly(pts, NM, detState.noise);
  }

  /* =====================================================
     bind + 启动
     ===================================================== */
  function bind() {
    /* 屏 1 */
    var sel = $('selMetric');
    if (sel) {
      var opts = '';
      for (var i = 0; i < M.METRIC_NAMES.length; i++) opts += '<option value="' + i + '">' + M.METRIC_NAMES[i] + '</option>';
      sel.innerHTML = opts;
      sel.addEventListener('change', function () { detState.metric = +this.value; renderDet(); });
    }
    var pNoise = $('pNoise');
    if (pNoise) pNoise.addEventListener('input', function () { detState.noise = +this.value; regen(); $('roNoise').textContent = num(this.value, 2); renderDet(); renderCls(); renderProb(); });
    var pTh = $('pTh');
    if (pTh) pTh.addEventListener('input', function () { detState.th = +this.value; $('roTh').textContent = num(this.value, 2); renderDet(); });
    /* 屏 2 */
    var pEps = $('pEps');
    if (pEps) pEps.addEventListener('input', function () { clsState.eps = +this.value; $('roEps').textContent = num(this.value, 1); renderCls(); });
    var pMin = $('pMinPts');
    if (pMin) pMin.addEventListener('input', function () { clsState.minPts = +this.value; $('roMinPts').textContent = this.value; renderCls(); });
    var pTh2 = $('pTh2');
    if (pTh2) pTh2.addEventListener('input', function () { clsState.th = +this.value; $('roTh2').textContent = num(this.value, 2); renderCls(); });
    /* 屏 3 */
    var pPTh = $('pPTh');
    if (pPTh) pPTh.addEventListener('input', function () { probState.pTh = +this.value; $('roPTh').textContent = num(this.value, 2); renderProb(); });
    var pPow = $('pPow');
    if (pPow) pPow.addEventListener('input', function () { probState.power = +this.value; $('roPow').textContent = num(this.value, 1); renderProb(); });
    var pPHi = $('pPHi');
    if (pPHi) pPHi.addEventListener('input', function () { probState.pHi = +this.value; $('roPHi').textContent = num(this.value, 2); renderProb(); });
  }

  /* 启动 */
  renderDet();
  renderCls();
  renderProb();
  bind();

  /* 按段落上报控件到父页（嵌入主站时） */
  function setupDrawer() {
    if (typeof window === 'undefined' || window.parent === window) return; /* 独立模式无需上报 */
    function post(ev, payload) { try { window.parent.postMessage({ t: 'demo', c: 'drawer', ev: ev, payload: payload }, '*'); } catch (e) {} }
    post('init', {
      blocks: [
        { sec: 1, title: '多指标异常检测', controls: [
          { key: 'metric', label: '单指标', type: 'select', value: '0' },
          { key: 'noise', label: '背景噪声', type: 'range', min: 0.1, max: 1, step: 0.05, value: detState.noise },
          { key: 'th', label: '异常阈值', type: 'range', min: 0.3, max: 0.9, step: 0.05, value: detState.th }
        ]},
        { sec: 2, title: '空间聚类成靶区', controls: [
          { key: 'eps', label: '邻域半径 eps', type: 'range', min: 1, max: 4, step: 0.2, value: clsState.eps },
          { key: 'minPts', label: '最小点数', type: 'range', min: 2, max: 8, step: 1, value: clsState.minPts },
          { key: 'th2', label: '异常阈值', type: 'range', min: 0.3, max: 0.9, step: 0.05, value: clsState.th }
        ]},
        { sec: 3, title: '靶区概率图', controls: [
          { key: 'pTh', label: '圈定阈值', type: 'range', min: 0.3, max: 0.9, step: 0.05, value: probState.pTh },
          { key: 'power', label: '插值幂', type: 'range', min: 1, max: 4, step: 0.5, value: probState.power },
          { key: 'pHi', label: '高潜力线', type: 'range', min: 0.6, max: 0.95, step: 0.05, value: probState.pHi }
        ]}
      ]
    });
    window.addEventListener('message', function (e) {
      if (!e.data || e.data.t !== 'demo' || e.data.c !== 'drawer') return;
      var key = e.data.key, val = e.data.value;
      if (key === 'metric') { detState.metric = +val; renderDet(); }
      else if (key === 'noise') { detState.noise = +val; regen(); renderDet(); renderCls(); renderProb(); }
      else if (key === 'th') { detState.th = +val; renderDet(); }
      else if (key === 'eps') { clsState.eps = +val; renderCls(); }
      else if (key === 'minPts') { clsState.minPts = +val; renderCls(); }
      else if (key === 'th2') { clsState.th = +val; renderCls(); }
      else if (key === 'pTh') { probState.pTh = +val; renderProb(); }
      else if (key === 'power') { probState.power = +val; renderProb(); }
      else if (key === 'pHi') { probState.pHi = +val; renderProb(); }
    });
  }
  setupDrawer();

})(typeof window !== 'undefined' ? window : this);
