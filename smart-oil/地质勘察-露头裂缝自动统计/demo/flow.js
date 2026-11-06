/* =========================================================
   露头裂缝自动统计 · 算法解剖（分割 + 骨架 + 标定）
   ---------------------------------------------------------
   把「露头照片 → 裂缝统计」拆成 6 步，每一步都跑真代码：

     ① 数据采集        多角度照片 + 点云 + 标定板
     ② 裂缝实例分割    每条裂缝一个掩膜
     ③ 骨架化          提炼裂缝中心线、量长度
     ④ 摄影测量标定    像素 → 真实方位与尺度
     ⑤ 产状反算 + 统计  走向玫瑰图 + 线密度
     ⑥ 实测验证        罗盘实测校准走向误差

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
  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }

  function hexA(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

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

  /* 露头岩面底图 */
  var BG_COLORS = ['#d8c8a8', '#c9c4b0', '#cdbfa0', '#d2c4ae'];
  function rockBase(scan, W, H, S, x0, y0) {
    var s = '';
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x;
        s += G.rect(x0 + x * S, y0 + y * S, S, S, { fill: BG_COLORS[scan.bg[i] % BG_COLORS.length], op: 1 });
      }
    }
    return s;
  }

  var W = 48, H = 36, S = 7;   /* 露头区 48×36 → SVG 336×252 */

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.confTh, L.minLen, L.calibErr, L.verifyRatio].join(',');
    if (cache.key === key) return cache;
    var scan = M.genOutcrop(20261105, W, H);
    var seg = M.instanceSeg(scan, L.confTh, 91);
    var skel = M.skeletonize(seg, L.minLen, 55);
    var atts = M.calibAttitude(skel, L.calibErr, 23);
    var ver = M.verifyAttitude(atts, L.verifyRatio, 6);
    cache = { key: key, L: L, scan: scan, seg: seg, skel: skel, atts: atts, ver: ver };
    return cache;
  }

  /* =========================================================
     ① 数据采集
     ========================================================= */
  function stage1(t) {
    var c = compute(), scan = c.scan, L = c.L;
    var s = '';
    s += G.panel(0, '① 多角度照片', '含标定板', C.blue);
    s += G.panel(1, '② 无人机点云', '厘米级 · 无需标注', C.jade);
    s += G.panel(2, '③ 裂缝标注', '掩膜 ≥1000 条', C.clay);

    var x0 = 30, y0 = 132;
    s += rockBase(scan, W, H, S, x0, y0);
    /* 裂缝真值（灰线） */
    for (var c2 = 0; c2 < scan.cracks.length; c2++) {
      var cr = scan.cracks[c2];
      var path = '';
      for (var p = 0; p < cr.pts.length; p++) path += (p ? 'L' : 'M') + (x0 + cr.pts[p][0] * S) + ' ' + (y0 + cr.pts[p][1] * S);
      s += G.path(path, { fill: 'none', stroke: '#9ba3a9', sw: 1.3 });
    }
    s += G.txt(x0, y0 - 12, '露头裂缝照片 · ' + scan.nCrack + ' 条裂缝 · 3 组优势走向', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 132, 192, '采集的现实',
      ['· 200—500 张多角度照片',
       '  含标定板才能标定',
       '· 无人机点云厘米级',
       '  覆盖整个露面',
       '',
       '裂缝掩膜 ≥ 1000 条，',
       '分割模型才有得学。'], 'blue');

    s += G.txt(x0, y0 + 208, '第一步把露头拍全、标定好——照片供分割，点云供几何标定', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '裂缝', v: scan.nCrack + ' 条' }, { k: '走向组', v: '3 组' }, { k: '掩膜', v: '≥1000' }], note: '数据采集覆盖多角度照片（含标定板）与无人机点云——照片喂分割模型，点云提供几何标定基准，裂缝掩膜是训练数据。' };
  }

  /* =========================================================
     ② 裂缝实例分割
     ========================================================= */
  function stage2(t) {
    var c = compute(), scan = c.scan, seg = c.seg, L = c.L;
    var s = '';
    s += G.panel(0, '① 露头照片', '输入', C.blue);
    s += G.panel(1, '② Mask R-CNN', '像素级分割', C.jade);
    s += G.panel(2, '③ 裂缝掩膜', '每条一条 · 可数', C.clay);

    var x0 = 30, y0 = 132;
    s += rockBase(scan, W, H, S, x0, y0);
    /* 漏检（灰虚线） */
    var detSet = new Set(seg.masks.map(function (m) { return m.crack.id; }));
    for (var c3 = 0; c3 < scan.cracks.length; c3++) {
      if (detSet.has(scan.cracks[c3].id)) continue;
      var cr3 = scan.cracks[c3];
      var path3 = '';
      for (var q = 0; q < cr3.pts.length; q++) path3 += (q ? 'L' : 'M') + (x0 + cr3.pts[q][0] * S) + ' ' + (y0 + cr3.pts[q][1] * S);
      s += G.path(path3, { fill: 'none', stroke: '#9ba3a9', sw: 1.4, dash: '4 3' });
    }
    /* 检出掩膜（绿） */
    for (var m = 0; m < seg.masks.length; m++) {
      var cr = seg.masks[m].crack;
      var path = '';
      for (var p = 0; p < cr.pts.length; p++) path += (p ? 'L' : 'M') + (x0 + cr.pts[p][0] * S) + ' ' + (y0 + cr.pts[p][1] * S);
      s += G.path(path, { fill: 'none', stroke: '#2f7d6b', sw: (cr.wd + 1) * S * 0.55, cap: 'round' });
    }
    s += G.txt(x0, y0 - 12, '实例分割 · 检出 ' + seg.tp + '/' + seg.total + ' · 阈值 ' + f(L.confTh, 2), { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 132, 192, '分割的现实',
      ['· 裂缝细长、低对比',
       '  与岩面背景接近',
       '· 短裂缝、小开度难检',
       '  易漏或粘连成一条',
       '',
       '阈值高漏检多，',
       '低则粘连少条数。'], 'clay');

    s += G.txt(x0, y0 + 208, '实例分割把每条裂缝从岩面抠成单独掩膜——条数、形态都可数可量', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '检出', v: seg.tp + '/' + seg.total }, { k: '召回', v: f(seg.recall * 100, 0) + '%' }, { k: '阈值', v: f(L.confTh, 2) }], note: '实例分割（Mask R-CNN）把每条裂缝从岩面背景抠成单独掩膜。难点在裂缝细长低对比——短裂缝易漏、交叉处易粘连。' };
  }

  /* =========================================================
     ③ 骨架化
     ========================================================= */
  function stage3(t) {
    var c = compute(), seg = c.seg, skel = c.skel, L = c.L;
    var s = '';
    s += G.panel(0, '① 裂缝掩膜', '输入', C.blue);
    s += G.panel(1, '② 细化骨架', '提取中心线', C.jade);
    s += G.panel(2, '③ 长度 + 走向', '线密度统计', C.clay);

    var x0 = 30, y0 = 132;
    /* 岩面背景（淡） */
    s += rockBase(c.scan, W, H, S, x0, y0);
    /* 骨架中心线 */
    for (var sk = 0; sk < skel.skeletons.length; sk++) {
      var sko = skel.skeletons[sk];
      var path = '';
      for (var p = 0; p < sko.skeleton.length; p++) path += (p ? 'L' : 'M') + (x0 + sko.skeleton[p][0] * S) + ' ' + (y0 + sko.skeleton[p][1] * S);
      s += G.path(path, { fill: 'none', stroke: '#41699b', sw: 2, cap: 'round' });
      s += G.txt(x0 + sko.skeleton[0][0] * S + 3, y0 + sko.skeleton[0][1] * S - 4, sko.id, { size: 7.5, fill: '#2b4a72', weight: 700 });
    }
    s += G.txt(x0, y0 - 12, '骨架化 · ' + skel.nSkel + ' 条骨架 · 过滤 ' + (seg.masks.length - skel.nSkel) + ' 条', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 132, 192, '骨架的现实',
      ['· 掩膜细化出中心线',
       '  一条裂缝一条线',
       '· 长度 = 中心线像素数',
       '· 走向 = 中心线方向',
       '',
       '分叉 / 交叉处骨架',
       '易错，长度走向量偏。'], 'jade');

    s += G.txt(x0, y0 + 208, '骨架化把裂缝掩膜提炼成中心线——长度、走向、线密度都从这条线算', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '骨架', v: skel.nSkel + ' 条' }, { k: '过滤', v: seg.masks.length - skel.nSkel + ' 条' }, { k: 'minLen', v: L.minLen }], note: '骨架化对掩膜做细化，提炼出裂缝中心线。长度与走向都从中心线量取——分叉、交叉处骨架易错，是线密度统计的主要误差来源。' };
  }

  /* =========================================================
     ④ 摄影测量标定
     ========================================================= */
  function stage4(t) {
    var c = compute(), scan = c.scan, L = c.L;
    var s = '';
    s += G.panel(0, '① 标定板 + 点云', '几何基准', C.blue);
    s += G.panel(1, '② 相机标定', '内外参 + 尺度', C.jade);
    s += G.panel(2, '③ 像素 → 产状', '真实方位 / 尺度', C.clay);

    var x0 = 30, y0 = 132;
    /* 标定示意图：棋盘格 */
    var cbx = x0 + 20, cby = y0 + 40, cbs = 22;
    for (var r = 0; r < 4; r++) {
      for (var c4 = 0; c4 < 4; c4++) {
        var fill = (r + c4) % 2 === 0 ? '#2b2b2b' : '#f4f1e6';
        s += G.rect(cbx + c4 * cbs, cby + r * cbs, cbs, cbs, { fill: fill, r: 0 });
      }
    }
    s += G.txt(cbx + 2 * cbs, cby + 4 * cbs + 14, '标定板（几何基准）', { size: 8, fill: C.ink3, anchor: 'middle' });
    /* 点云示意 */
    var px0 = x0 + 300, py0 = y0 + 100;
    for (var d = 0; d < 30; d++) {
      var ax = px0 + Math.sin(d * 1.7) * 46 + (Math.sin(d * 0.9) * 30);
      var ay = py0 + Math.cos(d * 1.1) * 30 + (Math.sin(d * 2.3) * 20);
      s += G.circle(ax, ay, 1.1, { fill: '#41699b', op: 0.8 });
    }
    s += G.txt(px0, py0 + 46, '无人机点云（厘米级）', { size: 8, fill: C.ink3, anchor: 'middle' });
    s += G.txt(x0, y0 - 12, '摄影测量标定 · 标定误差 ' + f(L.calibErr, 2), { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 132, 192, '标定的现实',
      ['· 像素距离 ≠ 真实产状',
       '· 必须用标定板 + 点云',
       '  完成相机内外参标定',
       '',
       '缺基准时走向 / 开度',
       '整体偏差，统计失真。'], 'blue');

    s += G.txt(x0, y0 + 208, '标定把「像素距离」换算成「真实方位与尺度」——产状反算的几何前提', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '标定板', v: '几何基准' }, { k: '点云', v: '厘米级' }, { k: '标定误差', v: f(L.calibErr, 2) }], note: '摄影测量标定用标定板与点云把像素几何换算成真实方位与尺度。缺基准时像素≠产状，算出的走向与开度会整体偏差——这是裂缝统计最关键的工程环节。' };
  }

  /* =========================================================
     ⑤ 产状反算 + 统计
     ========================================================= */
  function stage5(t) {
    var c = compute(), atts = c.atts, L = c.L;
    var s = '';
    s += G.panel(0, '① 骨架走向', '每条裂缝', C.blue);
    s += G.panel(1, '② 产状换算', '标定 + 方位', C.jade);
    s += G.panel(2, '③ 走向玫瑰图', '分布 + 线密度', C.clay);

    var x0 = 30, y0 = 132, cx = x0 + 168, cy = y0 + 126, R = 108;
    /* 玫瑰图 */
    s += G.circle(cx, cy, R, { fill: '#fbfaf6', stroke: '#e0d9c8', sw: 1 });
    for (var g = 0; g < 18; g++) {
      var a0 = (g * 10) * Math.PI / 180 - Math.PI / 2;
      s += G.line(cx, cy, cx + Math.cos(a0) * R, cy + Math.sin(a0) * R, { stroke: '#eee8db', sw: 0.6 });
    }
    var maxCount = 1;
    for (var b = 0; b < atts.rose.length; b++) if (atts.rose[b].count > maxCount) maxCount = atts.rose[b].count;
    for (var bb = 0; bb < atts.rose.length; bb++) {
      var cnt = atts.rose[bb].count;
      if (cnt === 0) continue;
      var aM = (bb * 10 + 5) * Math.PI / 180 - Math.PI / 2;
      var rIn = R * 0.06, rOut = R * 0.06 + (cnt / maxCount) * (R * 0.8);
      s += G.path('M' + (cx + Math.cos(aM - 0.09) * rIn).toFixed(1) + ' ' + (cy + Math.sin(aM - 0.09) * rIn).toFixed(1) +
        'L' + (cx + Math.cos(aM - 0.09) * rOut).toFixed(1) + ' ' + (cy + Math.sin(aM - 0.09) * rOut).toFixed(1) +
        'A' + rOut.toFixed(1) + ',' + rOut.toFixed(1) + ' 0 0 1 ' + (cx + Math.cos(aM + 0.09) * rOut).toFixed(1) + ' ' + (cy + Math.sin(aM + 0.09) * rOut).toFixed(1) +
        'L' + (cx + Math.cos(aM + 0.09) * rIn).toFixed(1) + ' ' + (cy + Math.sin(aM + 0.09) * rIn).toFixed(1) +
        'A' + rIn.toFixed(1) + ',' + rIn.toFixed(1) + ' 0 0 0 ' + (cx + Math.cos(aM - 0.09) * rIn).toFixed(1) + ' ' + (cy + Math.sin(aM - 0.09) * rIn).toFixed(1) + 'Z',
        { fill: '#b26a39', op: 0.75 });
    }
    for (var gd = 0; gd < 4; gd++) {
      var gA = gd * 45 * Math.PI / 180 - Math.PI / 2;
      s += G.txt(cx + Math.cos(gA) * (R + 14), cy + Math.sin(gA) * (R + 14), (gd * 45) + '°', { size: 8, fill: '#9ba3a9', anchor: 'middle' });
    }
    s += G.txt(cx, cy - R - 14, '走向玫瑰图', { size: 9.5, fill: C.ink2, weight: 700, anchor: 'middle' });
    s += G.txt(x0, y0 - 12, '产状反算 · ' + atts.n + ' 条 · 平均走向误差 ' + f(atts.meanErr, 1) + '°', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 132, 192, '统计的现实',
      ['· 玫瑰图 = 走向分布',
       '  3 组优势走向清晰',
       '· 线密度 = 单位面积条数',
       '',
       '走向分布对投影方向',
       '敏感，需按组统计。'], 'clay');

    s += G.txt(x0, y0 + 208, '产状反算把每条裂缝的走向换算成真实地质产状——玫瑰图直接看分布', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '裂缝', v: atts.n + ' 条' }, { k: '走向误差', v: f(atts.meanErr, 1) + '°' }, { k: '走向组', v: '35/75/120°' }], note: '产状反算把骨架走向换算成真实地质产状，统计走向玫瑰图与线密度。走向分布对投影方向敏感——要按裂缝分组统计，避免不同组误差互相掩盖。' };
  }

  /* =========================================================
     ⑥ 实测验证
     ========================================================= */
  function stage6(t) {
    var c = compute(), atts = c.atts, ver = c.ver, L = c.L;
    var s = '';
    s += G.panel(0, '① 算法产状', '自动统计', C.blue);
    s += G.panel(1, '② 罗盘实测', '100—200 条验证集', C.jade);
    s += G.panel(2, '③ 校准 + 回写', '误差 ≤3°', C.clay);

    var x0 = 30, y0 = 132;
    /* 算法 vs 实测走向对比散点 */
    var nShow = Math.min(atts.attitudes.length, 16);
    var chartW = 250, chartH = 60, bx = x0 + 20, by = y0 + 90;
    /* 轴 */
    s += G.rect(bx, by, chartW, chartH, { r: 4, fill: '#fbfaf6', stroke: '#e0d9c8' });
    s += G.txt(bx + 4, by - 6, '算法产状 vs 罗盘实测走向（每条裂缝）', { size: 8.5, fill: C.ink3, weight: 700 });
    for (var i = 0; i < nShow; i++) {
      var at = atts.attitudes[i];
      var gx = bx + 8 + i * ((chartW - 16) / Math.max(1, nShow - 1));
      var gyAlg = by + chartH - (at.deg % 180) / 180 * (chartH - 12) - 6;
      var gyM = by + chartH - (at.angle % 180) / 180 * (chartH - 12) - 6;
      s += G.line(gx, gyAlg, gx, gyM, { stroke: '#d8c4ae', sw: 1.4 });
      s += G.circle(gx, gyAlg, 2.4, { fill: '#b26a39' });
      s += G.circle(gx, gyM, 2.2, { fill: '#2f7d6b' });
    }
    /* 图例 */
    s += G.circle(bx + 8, by + chartH + 12, 2.5, { fill: '#b26a39' });
    s += G.txt(bx + 14, by + chartH + 16, '算法', { size: 8, fill: '#8a4f27' });
    s += G.circle(bx + 60, by + chartH + 12, 2.5, { fill: '#2f7d6b' });
    s += G.txt(bx + 66, by + chartH + 16, '罗盘实测', { size: 8, fill: '#22604f' });
    s += G.txt(x0, y0 - 12, '实测验证 · 抽检 ' + ver.nV + ' 条 · 走向误差 ' + f(ver.meanErr, 1) + '°', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 132, 192, '验证的现实',
      ['· 罗盘实测 100—200 条',
       '  作验证集校准',
       '· 走向误差目标 ≤3°',
       '  （人工本身 ±1.5°）',
       '',
       '只自动不实测，误差',
       '不被发现，建模用错。'], 'jade');

    s += G.txt(x0, y0 + 208, '罗盘实测校准算法产状——误差 ≤3°，修正样本回写训练集', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '抽检', v: ver.nV + ' 条' }, { k: '走向误差', v: f(ver.meanErr, 1) + '°' }, { k: '目标', v: '≤3°' }], note: '最后用罗盘实测验证算法产状，校准走向误差到 ≤3°，修正样本回写训练集。只自动不实测会掩盖系统性误差——验证集是质量关口。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
