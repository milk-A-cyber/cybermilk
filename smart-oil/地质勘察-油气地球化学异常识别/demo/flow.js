/* =========================================================
   油气地球化学异常识别 · 算法解剖（多指标检测 + 空间聚类）
   ---------------------------------------------------------
   把「采样点 → 靶区概率图」拆成 6 步，每一步都跑真代码：

     ① 采样数据整理    坐标 + 多指标，剔缺测、标准化
     ② 多指标异常检测  鲁棒 z-score 协同度 → 每点异常分数
     ③ 异常分数分布   单指标 vs 多指标联合
     ④ 空间聚类成靶区  DBSCAN 把邻近高异常点聚成靶区
     ⑤ 靶区概率图     IDW 插值成连续概率场 + 分层
     ⑥ 靶区验证与回写  与已知靶区重合度 → 人工复核

   依赖：window.RemoteBridge（demo.js 暴露的真模型）
        window.AFlow（算法解剖引擎）
   ========================================================= */
(function (global) {
  'use strict';

  var B = global.RemoteBridge;
  if (!B || !global.AFlow) return;

  var G = global.AFlow.G, C = global.AFlow.C;
  var M = B.M;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t * t * (3 - 2 * t); }
  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }

  /* 面板底部小结框 */
  function footBox(x, w, y, h, title, lines, tone) {
    var bg = tone === 'jade' ? C.jadeL : tone === 'clay' ? C.clayL : tone === 'blue' ? C.blueL : '#f4f3ef';
    var st = tone === 'jade' ? '#b9d8cb' : tone === 'clay' ? '#e6cdb2' : tone === 'blue' ? '#c5d6ea' : C.line;
    var fg = tone === 'jade' ? C.jadeD : tone === 'clay' ? '#8a4f27' : tone === 'blue' ? '#2b4a72' : C.ink2;
    var s = G.rect(x, y, w, h, { r: 6, fill: bg, stroke: st });
    if (title) s += G.txt(x + 11, y + 17, title, { size: 9.6, fill: fg, weight: 700 });
    for (var i = 0; i < lines.length; i++) {
      s += G.txt(x + 11, y + (title ? 33 : 17) + i * 13, lines[i], { size: 8.8, fill: fg });
    }
    return s;
  }

  /* 采样点散点：把 pts 数组画成圆点 */
  function ptMap(pts, score, W, H, S, x0, y0, opts) {
    opts = opts || {};
    var r = opts.r || 2.4;
    var s = '';
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var px = x0 + p.x * S, py = y0 + p.y * S;
      var col = opts.color ? opts.color(p, i) : (p.target ? '#7a4e9b' : '#9ba3a9');
      s += G.circle(px, py, r, { fill: col, op: opts.op || 1 });
    }
    return s;
  }

  /* 靶区边界：簇外接椭圆（用 path 近似） */
  function clusterEllipse(pts, cluster, S, x0, y0, col) {
    var rx = 0, ry = 0;
    for (var j = 0; j < cluster.ids.length; j++) {
      var p = pts[cluster.ids[j]];
      if (Math.abs(p.x - cluster.cx) > rx) rx = Math.abs(p.x - cluster.cx);
      if (Math.abs(p.y - cluster.cy) > ry) ry = Math.abs(p.y - cluster.cy);
    }
    var cx = x0 + cluster.cx * S, cy = y0 + cluster.cy * S, a = (rx + 2) * S, b = (ry + 2) * S;
    var d = 'M' + (cx - a) + ' ' + cy + 'a' + a + ',' + b + ' 0 1,0 ' + (2 * a) + ',0a' + a + ',' + b + ' 0 1,0 ' + (-2 * a) + ',0';
    return G.path(d, { fill: hexA(col, 0.14), stroke: col, sw: 1.2, dash: '4 3' });
  }

  function hexA(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.pts, L.K, L.noise, L.th, L.eps, L.minPts, L.pTh, L.power, L.pHi, L.pMid].join(',');
    if (cache.key === key) return cache;
    var geo = M.genPoints(L.pts, L.K, L.noise, 20261103);
    var pts = geo.pts;
    var det = M.detectAnomaly(pts, geo.nMetric, L.noise);
    var cl = M.clusterAnomaly(pts, det.score, L.th, L.eps, L.minPts);
    var ip = M.interpProb(pts, det.score, 30, L.power, 12);
    var layer = M.layerProb(ip.grid, 30, L.pHi, L.pMid);
    var ov = M.targetOverlap(pts, ip.grid, 30, L.pTh);
    cache = { key: key, L: L, geo: geo, pts: pts, det: det, cl: cl, ip: ip, layer: layer, ov: ov };
    return cache;
  }

  var W = 60, H = 48, S = 8; /* 采样区 60×48 → SVG 480×384 */

  /* =========================================================
     ① 采样数据整理
     ========================================================= */
  function stage1(t) {
    var c = compute(), pts = c.pts, L = c.L;
    var s = '';
    s += G.panel(0, '① 采样点', '坐标 + 多指标', C.blue);
    s += G.panel(1, '② 清洗', '剔缺测 / 异常值', C.clay);
    s += G.panel(2, '③ 标准化', '去量纲，指标等权', C.jade);

    var x0 = 30, y0 = 130;
    /* 全采样点（背景灰，异常区紫） */
    s += ptMap(pts, null, W, H, S, x0, y0, { color: function (p) { return p.target ? '#b58cc4' : '#c3c8cb'; } });
    s += G.txt(x0, y0 - 12, '化探采样点 · ' + pts.length + ' 点 · ' + L.K + ' 个已知异常区（紫）', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 130, 192, '采样的现实',
      ['· 单区块 300—3000 点',
       '· 每点 5—10 项化验指标',
       '· 坐标决定空间聚类能否成靶区',
       '',
       '缺测、量纲不统一会',
       '让异常检测失真。'], 'blue');

    s += G.txt(x0, y0 + 208, '第一步把「点 × 多指标 + 坐标」整理成干净表——异常检测的输入', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '采样点', v: pts.length }, { k: '指标', v: L.geo ? L.geo.nMetric : 6 + ' 项' }, { k: '异常区', v: L.K + ' 个' }], note: '化探数据是一张「点 × 多指标 + 坐标」的表。缺测、量纲不统一会让异常检测失真，所以先清洗、再标准化。' };
  }

  /* =========================================================
     ② 多指标异常检测
     ========================================================= */
  function stage2(t) {
    var c = compute(), pts = c.pts, det = c.det, L = c.L;
    var s = '';
    s += G.panel(0, '① 鲁棒中心化', '中位数代替均值', C.blue);
    s += G.panel(1, '② 鲁棒缩放', 'MAD 代替标准差', C.jade);
    s += G.panel(2, '③ 协同度', '超标项数 + 平均偏离', C.clay);

    var x0 = 30, y0 = 130;
    /* 异常分数散点：分数高 → 深红 */
    s += ptMap(pts, null, W, H, S, x0, y0, { color: function (p, i) {
      var sc = det.score[i];
      var g = Math.round(150 + 100 * (1 - sc));
      return 'rgb(205,' + g + ',' + Math.round(140 + 60 * (1 - sc)) + ')';
    } });
    s += G.txt(x0, y0 - 12, '多指标异常分数（协同度判据）', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 130, 192, '为什么中位数 + MAD',
      ['· 异常点占 1/3，会拉偏均值',
       '→ 中位数不受污染',
       '· MAD × 1.4826 ≈ 标准差',
       '→ 尺度估计也鲁棒',
       '',
       '协同度：z 超阈值 2.0 的指标数',
       '→ 只抓「多项一起偏离」。'], 'jade');

    s += G.txt(x0, y0 + 208, '单指标会被污染点骗，多指标协同度要求「多项一起偏离」才判异常', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '异常点', v: L.pts }, { k: '判据', v: '协同度' }, { k: '阈值', v: 'z>2.0' }], note: '多指标异常检测用鲁棒统计（中位数 + MAD）估计背景，再用「协同度」判据——只有多项指标一起偏离才算异常，单指标被污染点干扰的问题就解决了。' };
  }

  /* =========================================================
     ③ 异常分数分布：单指标 vs 多指标
     ========================================================= */
  function stage3(t) {
    var c = compute(), pts = c.pts, det = c.det, L = c.L;
    var s = '';
    s += G.panel(0, '① 单指标', '只看吸附烃', C.clay);
    s += G.panel(1, '② 多指标', '协同度联合', C.jade);
    s += G.panel(2, '③ 对比', '漏检 vs 假异常', C.blue);

    var x0 = 30, y0 = 130;
    /* 双散点：左单指标（top 红），右多指标（top 红） */
    var topN = Math.max(10, Math.floor(pts.length * 0.1));
    var si = [], i;
    for (i = 0; i < pts.length; i++) si.push(i);
    var singleTop = new Set(si.slice().sort(function (a, b) { return det.s1[b] - det.s1[a]; }).slice(0, topN));
    var multiTop = new Set(si.slice().sort(function (a, b) { return det.score[b] - det.score[a]; }).slice(0, topN));

    /* 左：单指标 */
    s += ptMap(pts, null, W, H, S, x0, y0, { color: function (p, i) { return singleTop.has(i) ? '#b26a39' : (det.s1[i] > L.th ? '#d7a27c' : '#c3c8cb'); } });
    s += G.txt(x0 + W * S / 2, y0 - 12, '单指标 top' + topN + '（吸附烃）', { size: 9.5, fill: C.ink2, weight: 700, anchor: 'middle' });
    /* 右：多指标 */
    var x1 = 330;
    s += ptMap(pts, null, W, H, S, x1, y0, { color: function (p, i) { return multiTop.has(i) ? '#41699b' : (det.score[i] > L.th ? '#8fb0d0' : '#c3c8cb'); } });
    s += G.txt(x1 + W * S / 2, y0 - 12, '多指标 top' + topN + '（协同度）', { size: 9.5, fill: C.ink2, weight: 700, anchor: 'middle' });

    s += footBox(30, 570, y0 + 196, 44, null,
      ['多指标把「组合异常」抓得更全、假异常更少 · 污染点（单项爆高）被协同度压住'], 'clay');

    s += G.txt(30, y0 + 252, '对比读数见实验 1：多指标命中率更高、假异常为 0', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '单指标', v: '污染易干扰' }, { k: '多指标', v: '协同更准' }, { k: '假异常', v: '多指标更低' }], note: '同样是抓 top 异常，单指标被地表污染的单项高值点带偏，多指标协同度只认「多项一起偏高」，组合异常抓得又全又准。' };
  }

  /* =========================================================
     ④ 空间聚类成靶区
     ========================================================= */
  function stage4(t) {
    var c = compute(), pts = c.pts, cl = c.cl, det = c.det, L = c.L;
    var s = '';
    s += G.panel(0, '① 高异常点', '协同度 > 阈值', C.clay);
    s += G.panel(1, '② DBSCAN', '密度相连成簇', C.blue);
    s += G.panel(2, '③ 靶区', '剔除孤立噪声', C.jade);

    var x0 = 30, y0 = 130;
    var CLUS_COL = ['#41699b', '#2f7d6b', '#b26a39', '#7a4e9b', '#b98f5a', '#5a8a9b'];
    /* 背景 + 异常点着色 + 簇边界 */
    s += ptMap(pts, null, W, H, S, x0, y0, { color: function (p, i) {
      var lb = cl.labels[i];
      if (lb === -2) return '#d7a27c';
      if (lb >= 0) return CLUS_COL[lb % CLUS_COL.length];
      return det.score[i] > L.th ? '#8fb0d0' : '#c3c8cb';
    } });
    for (var ci = 0; ci < cl.clusters.length; ci++) {
      s += clusterEllipse(pts, cl.clusters[ci], S, x0, y0, CLUS_COL[cl.clusters[ci].id % CLUS_COL.length]);
    }
    s += G.txt(x0, y0 - 12, 'DBSCAN 聚类 · ' + cl.nCluster + ' 个靶区 · 噪声 ' + cl.noiseCount + ' 点', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 130, 192, '为什么用空间聚类',
      ['· 异常点可能离散，未必成片',
       '· DBSCAN：密度相连的点聚成簇',
       '· 孤立高异常点被判为噪声剔除',
       '',
       'eps / minPts 是杠杆：',
       '太小靶区过碎，太大连成一片。'], 'blue');

    s += G.txt(x0, y0 + 208, '空间邻近 + 高异常 → 成靶区；孤立假异常 → 剔除', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '靶区', v: cl.nCluster }, { k: '噪声点', v: cl.noiseCount }, { k: 'eps', v: f(L.eps, 1) }], note: '异常检测给出的是离散点，空间聚类把它们聚成可解释的靶区，同时把孤立的假异常剔除——这是从「点」到「区块」的关键一步。' };
  }

  /* =========================================================
     ⑤ 靶区概率图
     ========================================================= */
  function stage5(t) {
    var c = compute(), ip = c.ip, layer = c.layer, L = c.L;
    var s = '';
    s += G.panel(0, '① IDW 插值', '离散点 → 连续场', C.blue);
    s += G.panel(1, '② 概率场', '每格一个概率', C.jade);
    s += G.panel(2, '③ 分层', '高 / 中 / 低潜力', C.clay);

    var x0 = 30, y0 = 130, Gg = 30, Sg = 14;
    function pcol(p) {
      if (p >= L.pHi) return '#2f7d6b';
      if (p >= L.pMid) return '#7fc0a9';
      if (p >= L.pTh) return '#d7e8de';
      return '#eef1f1';
    }
    for (var gy = 0; gy < Gg; gy++) {
      for (var gx = 0; gx < Gg; gx++) {
        s += G.rect(x0 + gx * Sg, y0 + gy * Sg, Sg, Sg, { fill: pcol(ip.grid[gy * Gg + gx]), op: 1 });
      }
    }
    s += G.txt(x0, y0 - 12, '靶区概率图 · 高潜力 ' + f(L.pHi, 2) + ' / 中 ' + f(L.pMid, 2) + ' / 圈定 ' + f(L.pTh, 2), { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 130, 192, '概率图怎么读',
      ['· 离散异常点插值成连续概率场',
       '· 绿色 = 高潜力（优先布井）',
       '· 浅绿 = 中潜力（跟踪）',
       '· 白 = 低潜力（暂不考虑）',
       '',
       '插值幂 power 越大，场越陡；',
       '太大 → 孤立斑块，太小 → 过平滑。'], 'jade');

    s += G.txt(x0, y0 + 208, '从「逐点对比」变成「看概率图」——哪片更可能有油气一目了然', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '高潜力', v: countLayer(layer, 2, Gg) + '%' }, { k: '中潜力', v: countLayer(layer, 1, Gg) + '%' }, { k: '低潜力', v: countLayer(layer, 0, Gg) + '%' }], note: '概率图把离散的异常分数平滑成连续场并按高/中/低分层，解释员从「逐点对比」变成「看概率图」，圈靶更快也更客观。' };
  }

  function countLayer(layer, val, Gg) {
    var cnt = 0;
    for (var i = 0; i < Gg * Gg; i++) if (layer[i] === val) cnt++;
    return Math.round(cnt / (Gg * Gg) * 100);
  }

  /* =========================================================
     ⑥ 靶区验证与回写
     ========================================================= */
  function stage6(t) {
    var c = compute(), pts = c.pts, ip = c.ip, layer = c.layer, L = c.L, ov = c.ov;
    var s = '';
    s += G.panel(0, '① 已知靶区', '专家圈定验证集', C.blue);
    s += G.panel(1, '② 重合度', '概率图覆盖比', C.jade);
    s += G.panel(2, '③ 人工复核', '新圈区域复核', C.clay);

    var x0 = 30, y0 = 130, Gg = 30, Sg = 14;
    function pcol(p) {
      if (p >= L.pHi) return '#2f7d6b';
      if (p >= L.pMid) return '#7fc0a9';
      if (p >= L.pTh) return '#d7e8de';
      return '#eef1f1';
    }
    for (var gy = 0; gy < Gg; gy++) {
      for (var gx = 0; gx < Gg; gx++) {
        s += G.rect(x0 + gx * Sg, y0 + gy * Sg, Sg, Sg, { fill: pcol(ip.grid[gy * Gg + gx]), op: 1 });
      }
    }
    /* 已知靶区点（紫圈） */
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].target) s += G.circle(x0 + pts[i].x * Sg, y0 + pts[i].y * Sg, 3.2, { fill: 'none', stroke: '#7a4e9b', sw: 1.3 });
    }
    s += G.txt(x0, y0 - 12, '靶区验证 · 与已知靶区重合度 ' + f(ov * 100, 0) + '%', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 130, 192, '怎么验收',
      ['· 重合度 = 概率图高潜力区',
       '  覆盖已知靶区的比例',
       '· 必须空间分块交叉验证',
       '  （自相关会让精度虚高）',
       '',
       '高潜力但不在已知靶区 → 复核',
       '验证通过 → 回写为新靶区。'], 'clay');

    s += G.txt(x0, y0 + 208, '重合度 ' + f(ov * 100, 0) + '% · 验证通过的回写为已知靶区，季度重估参数', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '重合度', v: f(ov * 100, 0) + '%' }, { k: '验证', v: '分块交叉' }, { k: '回写', v: '季度' }], note: '最后用已知靶区验证算法可信度，并对算法新圈出的高潜力区做人工复核——验证通过的回写为已知靶区，让靶区库越滚越大、圈靶越来越稳。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
