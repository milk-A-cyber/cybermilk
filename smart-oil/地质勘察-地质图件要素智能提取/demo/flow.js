/* =========================================================
   地质图件要素智能提取 · 算法解剖（检测 + OCR + 追踪）
   ---------------------------------------------------------
   把「扫描图件 → 矢量图层」拆成 6 步，每一步都跑真代码：

     ① 扫描接入        统一分辨率、分块切图
     ② 目标检测        定位图例符号 / 断层线 / 钻孔柱状图
     ③ OCR 识别        把注记从像素读成文本
     ④ 版面分析        理清图区 / 图例区 / 注记区
     ⑤ 矢量追踪        沿断层线像素重建折线矢量
     ⑥ 图例映射 + 抽检  符号 → 岩性语义，人工把关

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

  /* 扫描图栅格底图（断层线 / 符号 / 注记像素） */
  function scanBase(scan, W, H, S, x0, y0) {
    var s = '';
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x;
        var col;
        if (scan.px[i] === 1) col = '#c9a98a';
        else if (scan.px[i] === 2) col = '#d9c39a';
        else if (scan.px[i] === 3) col = '#b9c9dd';
        else col = '#f1eee4';
        s += G.rect(x0 + x * S, y0 + y * S, S, S, { fill: col, r: 0, op: 1 });
      }
    }
    return s;
  }

  var W = 48, H = 36, S = 7;   /* 扫描区 48×36 → SVG 336×252 */

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.confTh, L.err, L.linkGap].join(',');
    if (cache.key === key) return cache;
    var scan = M.genScanMap(20261105, W, H);
    var det = M.detectObjects(scan, L.confTh, 20261105);
    var ocr = M.ocrRead(scan, L.err, 77);
    var lay = M.layoutAnalyze(scan);
    var vec = M.traceVectors(scan, L.linkGap);
    cache = { key: key, L: L, scan: scan, det: det, ocr: ocr, lay: lay, vec: vec };
    return cache;
  }

  /* =========================================================
     ① 扫描接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), scan = c.scan, L = c.L;
    var s = '';
    s += G.panel(0, '① 扫描接入', '统一分辨率', C.blue);
    s += G.panel(1, '② 分块切图', '并行检测', C.clay);
    s += G.panel(2, '③ 标注准备', '图例符号每类 ≥200', C.jade);

    var x0 = 30, y0 = 132;
    s += scanBase(scan, W, H, S, x0, y0);
    s += G.txt(x0, y0 - 12, '扫描地质图件 · ' + (W * S) + '×' + (H * S) + ' px · 300 dpi 归一', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 132, 192, '为什么先接入',
      ['· 分辨率不足 300 dpi',
       '  细线符号检测不到',
       '· 单幅 5000×7000 太大',
       '  必须分块才能并行',
       '',
       '图例符号每类 ≥ 200 个',
       '实例，检测模型才有得学。'], 'blue');

    s += G.txt(x0, y0 + 208, '第一步把扫描件整理成统一、可分块的输入——检测和 OCR 的地基', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '图件', v: '1.2 万幅' }, { k: '分辨率', v: '300 dpi' }, { k: '图例实例', v: '≥200/类' }], note: '扫描件先统一分辨率、分块切图，再备好图例标注——目标检测与 OCR 都是成熟技术，前提是把输入整理成它们吃得动的形态。' };
  }

  /* =========================================================
     ② 目标检测
     ========================================================= */
  function stage2(t) {
    var c = compute(), scan = c.scan, det = c.det, L = c.L;
    var s = '';
    s += G.panel(0, '① 扫描图块', '输入', C.blue);
    s += G.panel(1, '② 检测模型', 'Faster R-CNN / YOLO', C.jade);
    s += G.panel(2, '③ 检测框', '位置 + 类别 + 置信度', C.clay);

    var x0 = 30, y0 = 132;
    s += scanBase(scan, W, H, S, x0, y0);
    for (var d = 0; d < det.dets.length; d++) {
      var b = det.dets[d];
      var col = b.hit ? '#2f7d6b' : '#c0444a';
      s += G.rect(x0 + b.x * S, y0 + b.y * S, Math.max(1, b.w * S), Math.max(1, b.h * S), {
        fill: 'none', stroke: col, sw: 1.4, dash: b.hit ? '' : '4 3', r: 1
      });
      s += G.txt(x0 + (b.x + b.w) * S, y0 + b.y * S - 3, b.cls, { size: 7.6, fill: col, weight: 700 });
    }
    s += G.txt(x0, y0 - 12, '目标检测 · 检出 ' + det.tp + '/' + det.total + ' · 误检 ' + det.fp + ' · 阈值 ' + f(L.confTh, 2), { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 132, 192, '检测的现实',
      ['· 断层线 → 折线框',
       '· 图例符号 → 小方块框',
       '· 钻孔柱状图 → 长条框',
       '',
       '符号小且密集是难点：',
       '阈值高漏检多，低则误检多。'], 'clay');

    s += G.txt(x0, y0 + 208, '目标检测把「图上有什么、在哪」答出来——符号、断层、柱状图都带框带类别', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '检出', v: det.tp + '/' + det.total }, { k: '误检', v: det.fp }, { k: '阈值', v: f(L.confTh, 2) }], note: '目标检测用成熟模型（Faster R-CNN / YOLO）定位图例符号、断层线、钻孔柱状图。难点在符号小且密集、图例体系不同——要分年代训练。' };
  }

  /* =========================================================
     ③ OCR 识别
     ========================================================= */
  function stage3(t) {
    var c = compute(), scan = c.scan, ocr = c.ocr, L = c.L;
    var s = '';
    s += G.panel(0, '① 注记像素', '地名 / 代号 / 说明', C.blue);
    s += G.panel(1, '② CRNN / OCR', '像素 → 字符序列', C.jade);
    s += G.panel(2, '③ 注记文本', '可搜索 · 可入库', C.clay);

    var x0 = 30, y0 = 132;
    s += scanBase(scan, W, H, S, x0, y0);
    for (var n = 0; n < ocr.results.length; n++) {
      var r = ocr.results[n];
      var note = scan.notes[n];
      var col = r.ok ? '#2f7d6b' : '#c0444a';
      s += G.rect(x0 + note.x * S - 2, y0 + note.y * S - 3, note.w * S + 4, S + 6, { r: 2, fill: hexA(col, 0.12), stroke: col, sw: 1 });
      s += G.txt(x0 + note.x * S + 2, y0 + note.y * S + S * 0.7, r.pred + (r.ok ? '✓' : '✗'), { size: 7.6, fill: col, weight: 600 });
    }
    s += G.txt(x0, y0 - 12, 'OCR 识别 · 准确率 ' + f(ocr.acc * 100, 0) + '% · 错误率 ' + f(L.err, 2), { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 132, 192, 'OCR 的现实',
      ['· 注记 = 地名 + 地层代号',
       '  + 符号说明',
       '· CRNN / Transformer OCR',
       '  像素 → 字符序列',
       '',
       '手写 / 模糊件易错：',
       '错字会污染属性表。'], 'jade');

    s += G.txt(x0, y0 + 208, 'OCR 把图面注记从像素读成文本——地名、代号、说明都变成可检索字段', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '准确率', v: f(ocr.acc * 100, 0) + '%' }, { k: '正确', v: ocr.correct + '/' + ocr.total }, { k: '错误率', v: f(L.err, 2) }], note: 'OCR 用成熟模型把注记像素读成文本。难点在手写与模糊件易错——错误文本会污染属性表，需要人工校对或置信度过滤。' };
  }

  /* =========================================================
     ④ 版面分析
     ========================================================= */
  function stage4(t) {
    var c = compute(), scan = c.scan, lay = c.lay, L = c.L;
    var s = '';
    s += G.panel(0, '① 扫描图', '整体布局', C.blue);
    s += G.panel(1, '② 区块划分', '图区 / 图例 / 注记', C.jade);
    s += G.panel(2, '③ 结构化', '每区各司其职', C.clay);

    var x0 = 30, y0 = 132;
    s += scanBase(scan, W, H, S, x0, y0);
    for (var r = 0; r < lay.regions.length; r++) {
      var rg = lay.regions[r];
      var col = rg.id === 'M' ? '#7c9a8f' : rg.id === 'L' ? '#b26a39' : '#41699b';
      s += G.rect(x0 + rg.x * S, y0 + rg.y * S, Math.max(1, rg.w * S), Math.max(1, rg.h * S), {
        fill: hexA(col, 0.12), stroke: col, sw: 1.2, dash: '5 3', r: 4
      });
      s += G.txt(x0 + rg.x * S + 3, y0 + rg.y * S - 3, rg.name, { size: 8, fill: col, weight: 700 });
    }
    s += G.txt(x0, y0 - 12, '版面分析 · 识别 ' + lay.regions.length + ' 个区块', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 132, 192, '版面分析的用处',
      ['· 图区：断层线 / 岩性',
       '· 图例区：符号对照',
       '· 注记区：文本说明',
       '',
       '分清了区块，后续检测、',
       '追踪、映射才有的放矢。'], 'blue');

    s += G.txt(x0, y0 + 208, '版面分析把一张图拆成「图区 / 图例区 / 注记区」——不同区用不同策略处理', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '区块', v: lay.regions.length }, { k: '图区', v: '断层+岩性' }, { k: '图例区', v: '符号对照' }], note: '版面分析理清图区、图例区、注记区的布局——图区做检测与追踪、图例区做符号对照、注记区做 OCR，各区块各司其职。' };
  }

  /* =========================================================
     ⑤ 矢量追踪
     ========================================================= */
  function stage5(t) {
    var c = compute(), scan = c.scan, vec = c.vec, L = c.L;
    var s = '';
    s += G.panel(0, '① 断层像素', '低对比细线', C.blue);
    s += G.panel(1, '② 沿像素追踪', '重建拓扑', C.jade);
    s += G.panel(2, '③ 折线矢量', '跨断裂连接', C.clay);

    var x0 = 30, y0 = 132;
    s += scanBase(scan, W, H, S, x0, y0);
    for (var v = 0; v < vec.vectors.length; v++) {
      var vt = vec.vectors[v];
      var path = '';
      for (var p = 0; p < vt.pts.length; p++) {
        path += (p ? 'L' : 'M') + (x0 + vt.pts[p][0] * S) + ' ' + (y0 + vt.pts[p][1] * S);
      }
      s += G.path(path, { fill: 'none', stroke: vt.color, sw: 2, cap: 'round' });
      s += G.txt(x0 + vt.pts[0][0] * S + 3, y0 + vt.pts[0][1] * S - 4, vt.name, { size: 8, fill: vt.color, weight: 700 });
    }
    s += G.txt(x0, y0 - 12, '矢量追踪 · ' + vec.nVector + ' 条矢量 · 连接 ' + vec.linked + ' 处 · gap ' + L.linkGap, { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 132, 192, '追踪的现实',
      ['· 断层是细长低对比线',
       '  最易受扫描噪声干扰',
       '· 线条断裂要跨缺口连接',
       '  gap 越大越能连',
       '',
       '拓扑重建难：',
       '断点连错就出错矢量。'], 'clay');

    s += G.txt(x0, y0 + 208, '矢量追踪把断层线像素重建为带拓扑的折线——gap 越大越能跨断裂', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '矢量', v: vec.nVector + ' 条' }, { k: '连接处', v: vec.linked }, { k: 'gap', v: L.linkGap }], note: '矢量追踪沿断层线像素重建折线、补断裂。难点在线条断裂后的拓扑重建——断点连错会产生错误矢量，是矢量化质量的最大隐患。' };
  }

  /* =========================================================
     ⑥ 图例映射 + 抽检
     ========================================================= */
  function stage6(t) {
    var c = compute(), scan = c.scan, det = c.det, L = c.L;
    var s = '';
    s += G.panel(0, '① 检测符号', '图例类别', C.blue);
    s += G.panel(1, '② 图例对照表', '各年代体系', C.jade);
    s += G.panel(2, '③ 岩性语义', '映射 + 抽检', C.clay);

    var x0 = 30, y0 = 132;
    /* 符号网格 + 映射结果 */
    var gridX = 0, gridY = 0, cell = 26;
    for (var si = 0; si < M.ROCK_SYM.length; si++) {
      var rock = M.ROCK_SYM[si];
      var gx = x0 + gridX * cell, gy = y0 + gridY * cell;
      s += G.rect(gx, gy, cell - 4, cell - 4, { r: 4, fill: rock.fill, stroke: '#8a6b52', sw: 1 });
      s += G.txt(gx + (cell - 4) / 2, gy + 16, rock.name, { size: 8.5, fill: '#4d565b', anchor: 'middle', weight: 600 });
      gridX++;
      if (gridX > 4) { gridX = 0; gridY++; }
    }
    s += G.txt(x0, y0 - 12, '图例映射 · 符号 → 岩性/构造语义 · 抽检 ' + Math.round(L.confTh * 100) + '%', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(330, 260, 132, 192, '映射的坑',
      ['· 同一岩性在不同年代',
       '  可能是不同符号',
       '· 检测对了，映射错',
       '  就叫「张冠李戴」',
       '',
       '没有图例对照表，',
       '成果库会被污染。'], 'jade');

    s += G.txt(x0, y0 + 208, '图例对照表把「哪个年代的符号」翻成「是什么岩性」——映射后抽检把关', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '岩性类', v: M.ROCK_SYM.length }, { k: '映射', v: '对照表' }, { k: '抽检', v: '≤10%' }], note: '最后用图例对照表把检测符号映射成岩性/构造语义，并抽检把关。图例体系跨年代不一致，没有对照表会张冠李戴——抽检修正回写训练集，图例表越用越全。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
