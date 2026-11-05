/* =========================================================
   地质剖面遥感解译 · 算法解剖（逐像素语义分割 + 构造线提取）
   ---------------------------------------------------------
   把「影像 → 矢量图层」拆成 6 步，每一步都跑真代码：

     ① 岩性栅格       合成影像：岩性体 + 噪声 + 断层带
     ② 弱标签/强标签   历史图件弱标签 vs 精修掩膜强标签
     ③ 语义分割       编码器-解码器逐像素预测类别
     ④ 类别概率       概率图 + argmax → 岩性分布
     ⑤ 构造线提取     梯度 + 阈值 → 线状构造要素
     ⑥ 矢量化后处理   连通域 + 剔碎斑 + 边界平滑 → 矢量图层

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

  /* 小格着色图：把 label 数组画成色块（cell 像素边长） */
  function rockMap(label, W, H, cell, colors, x0, y0, w, h) {
    var s = '';
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var r = label[y * W + x];
        s += G.rect(x0 + x * cell, y0 + y * cell, cell, cell, { fill: colors[r], op: 1 });
      }
    }
    return s;
  }

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.rocks, L.weight, L.noise, L.thr, L.minArea].join(',');
    if (cache.key === key) return cache;
    var grid = M.genRockGrid(64, 48, L.rocks, 20261102);
    var seg = M.semanticSeg(grid, L.rocks, L.weight, L.noise);
    var ev = M.segEval(grid, seg.seg, L.rocks);
    var det = M.detectFault(grid, L.thr);
    var vec = M.vectorize(grid, seg.seg, L.rocks, L.minArea);
    cache = { key: key, L: L, grid: grid, seg: seg, ev: ev, det: det, vec: vec };
    return cache;
  }

  /* =========================================================
     ① 岩性栅格
     ========================================================= */
  function stage1(t) {
    var c = compute(), grid = c.grid, L = c.L;
    var s = '';
    s += G.panel(0, '① 合成影像', '岩性体 + 噪声 + 断层带', C.jade);
    s += G.panel(1, '② 真值标签', '模拟人工精修掩膜', C.blue);
    s += G.panel(2, '③ 这条影像', '岩性+构造都在像素里', C.clay);

    var cell = 4, x0 = 30, y0 = 130;
    /* 真值栅格（区域显示） */
    s += rockMap(grid.label, 64, 48, cell, M.ROCK_COLORS, x0, y0, 256, 192);
    /* 断层参考线 */
    s += G.line(x0 + grid.fault.x1 * cell, y0 + grid.fault.y1 * cell, x0 + grid.fault.x2 * cell, y0 + grid.fault.y2 * cell, { stroke: '#2f7d6b', sw: 2, dash: '6 3' });
    s += G.txt(x0, y0 - 12, '岩性标签图 · ' + L.rocks + ' 类', { size: 9.5, fill: C.ink2, weight: 700 });

    /* 右侧说明 */
    var names = '';
    for (var r = 1; r < Math.min(L.rocks, 9); r++) {
      names += '<rect fill="' + M.ROCK_COLORS[r] + '"/>';
    }
    s += footBox(320, 270, 130, 192, '这张影像里有什么',
      ['· ' + L.rocks + ' 类岩性体随机分布（椭圆近似）',
       '· 一条斜向断层带贯穿（构造线）',
       '· 每像素带一个置信度 conf',
       '',
       '地质标签稀缺，全靠历史图件',
       '转弱标签 + 少量精修掩膜。'], 'jade');

    s += G.txt(30, y0 + 208, '人工解译：一幅 1:5 万图幅要 1—2 周 · 换成人机协同：整幅压到小时级', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '岩性类别', v: L.rocks + ' 类' }, { k: '断层带', v: '1 条' }, { k: '栅格', v: '64×48' }], note: '第一步先把地下"看清楚"——影像里既有岩性分布，也有构造线索，全部藏在像素里。' };
  }

  /* =========================================================
     ② 弱标签 vs 强标签
     ========================================================= */
  function stage2(t) {
    var c = compute(), grid = c.grid, L = c.L;
    var s = '';
    s += G.panel(0, '① 历史图件（弱标签）', '量大但粗糙', C.clay);
    s += G.panel(1, '② 精修掩膜（强标签）', '少量但精准', C.jade);
    s += G.panel(2, '③ 混合训练', '取长补短', C.blue);

    var cell = 4, x0 = 30, y0 = 130;
    /* 弱标签：粗糙（用 conf 抖动 + 边界模糊模拟） */
    var weak = new Int32Array(64 * 48);
    var wrnd = M.mulberry32(20261105);
    for (var y = 0; y < 48; y++) {
      for (var x = 0; x < 64; x++) {
        var idx = y * 64 + x;
        weak[idx] = grid.label[idx];
        /* 边界处弱标签容易错（模拟历史图件粗糙） */
        if (grid.conf[idx] < 0.55 && wrnd() < 0.25) weak[idx] = 0;
      }
    }
    s += rockMap(weak, 64, 48, cell, M.ROCK_COLORS, x0, y0, 256, 192);
    s += G.txt(x0, y0 - 12, '历史图件弱标签（粗糙）', { size: 9.5, fill: C.ink2, weight: 700 });

    /* 强标签：真值 */
    var x1 = 330, y1 = 130;
    s += rockMap(grid.label, 64, 48, cell, M.ROCK_COLORS, x1, y1, 256, 192);
    s += G.txt(x1, y1 - 12, '精修掩膜强标签（精准）', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(30, 570, 130, 128, '为什么弱标签能用',
      ['· 历史地质图已矢量化，投影即标签',
       '· 量大（覆盖全图幅）但边界粗糙',
       '· 强标签少量（≥20 幅）拉精度上限',
       '· 弱强混合，缓解「标签稀缺」'], 'clay');

    s += G.txt(30, y0 + 208, '直接只用弱标签：模型学会「粗糙边界」；必须搭配强标签校准', { size: 9, fill: '#8a4f27' });
    return { svg: s, stats: [{ k: '弱标签', v: '全图幅' }, { k: '强标签', v: '≥20 幅' }, { k: '策略', v: '混合' }], note: '历史图件转弱标签解决"量"，精修掩膜解决"准"，两者搭配才能训练出像样的分割模型。' };
  }

  /* =========================================================
     ③ 语义分割
     ========================================================= */
  function stage3(t) {
    var c = compute(), seg = c.seg, grid = c.grid, L = c.L;
    var s = '';
    s += G.panel(0, '① 编码器', '下采样提特征', C.blue);
    s += G.panel(1, '② 解码器', '上采样回原分辨率', C.jade);
    s += G.panel(2, '③ 逐像素分类', '每像素取 argmax', C.clay);

    var x0 = 30, y0 = 130, w = 540, h = 130;
    s += G.axes(x0, y0, w, h, { nx: 4, ny: 2 });
    /* 模拟 U-Net 收缩-扩张结构：两条对向路径 */
    var steps = Math.floor(t * 5);
    var cx = x0 + 40, cy = y0 + 80;
    var levelW = [110, 86, 62, 42, 62, 86, 110];
    var levelY = [y0 + 18, y0 + 42, y0 + 58, y0 + 66, y0 + 58, y0 + 42, y0 + 18];
    for (var i = 0; i <= steps && i < 7; i++) {
      var filled = (i === steps);
      var lx = x0 + 30 + i * 74;
      s += G.rect(lx, levelY[i], levelW[i], 40, { r: 6, fill: filled ? (i < 3 ? C.blueL : C.jadeL) : '#f4f3ef', stroke: i < 3 ? '#9fb5cf' : '#a7c6b8' });
      s += G.txt(lx + levelW[i] / 2, levelY[i] + 24, i < 3 ? '↓ 下采样' : '↑ 上采样', { size: 8, fill: C.ink3, anchor: 'middle' });
    }
    s += G.txt(x0, y0 - 12, 'U-Net 编码器-解码器：收缩提取语义，扩张还原细节', { size: 9.5, fill: C.ink2, weight: 700 });

    /* 右：结果缩略 */
    var cell = 3, rx = 30 + 200, ry = y0 + 140;
    /* 原图 */
    s += rockMap(grid.label, 64, 48, 1, M.ROCK_COLORS, rx, ry, 64, 48);
    s += G.txt(rx, ry - 8, '真值', { size: 8.5, fill: C.ink3, anchor: 'middle' });
    s += G.txt(rx + 90, ry - 8, '预测', { size: 8.5, fill: C.ink3, anchor: 'middle' });
    s += rockMap(seg.seg, 64, 48, 1, M.ROCK_COLORS, rx + 90, ry, 64, 48);

    var ev = c.ev;
    s += G.txt(rx, ry + 60, '整体准确率 ' + f(ev.acc * 100, 1) + '%', { size: 9.5, fill: C.jadeD, weight: 700 });
    s += G.txt(rx, ry + 76, '背景/常见岩性偏高 · 稀有岩性偏低', { size: 8.5, fill: C.ink3 });

    return { svg: s, stats: [{ k: '整体准确率', v: f(ev.acc * 100, 1) + '%' }, { k: '类别数', v: L.rocks + ' 类' }], note: '语义分割为每个像素预测一个岩性类别。类别不均衡下，模型天然偏向背景与常见岩性，需要焦点损失来压住稀有类。' };
  }

  /* =========================================================
     ④ 类别概率
     ========================================================= */
  function stage4(t) {
    var c = compute(), seg = c.seg, grid = c.grid, L = c.L;
    var s = '';
    s += G.panel(0, '① 概率图', '每像素一组概率', C.jade);
    s += G.panel(1, '② argmax', '取最大概率类别', C.blue);
    s += G.panel(2, '③ 置信度', '概率越高越可信', C.clay);

    var x0 = 30, y0 = 130;
    /* 概率热图：选中第 2 类（砂岩）的概率 */
    var target = 2;
    var cell = 4;
    var sHeat = '';
    for (var y = 0; y < 48; y++) {
      for (var x = 0; x < 64; x++) {
        var idx = y * 64 + x;
        var p = seg.prob[idx * L.rocks + (target % L.rocks)];
        var g = Math.round(255 * p);
        sHeat += G.rect(x0 + x * cell, y0 + y * cell, cell, cell, { fill: 'rgb(' + g + ',' + Math.round(255 - g) + ',' + 130 + ')', op: 1 });
      }
    }
    s += sHeat;
    s += G.txt(x0, y0 - 12, '第 ' + (target % L.rocks) + ' 类（' + M.ROCK_NAMES[target % L.rocks] + '）的概率图', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(320, 270, 130, 192, '概率图怎么读',
      ['· 每个像素有一组概率（和为 1）',
       '· 高亮 = 模型很确定是这类',
       '· 边界处概率低（拿不准）',
       '· argmax 取最大者作最终类别',
       '',
       '边界像素是构造线提取的线索：',
       '岩性切换处概率快速跳变。'], 'jade');

    s += G.txt(x0, y0 + 208, '概率图同时是「置信度图」：低置信像素交给解释员复核', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '概率维度', v: L.rocks + ' 类' }, { k: '输出', v: '概率图' }], note: '分割的原始输出是一组概率而非单一标签。概率越高越可信，边界处概率模糊——这既是风险点，也是构造线提取的起点。' };
  }

  /* =========================================================
     ⑤ 构造线提取
     ========================================================= */
  function stage5(t) {
    var c = compute(), det = c.det, grid = c.grid, L = c.L;
    var s = '';
    s += G.panel(0, '① 梯度响应', '边界/断层处梯度高', C.blue);
    s += G.panel(1, '② 阈值切割', '>thr 判为构造像素', C.clay);
    s += G.panel(2, '③ 线要素', '连接成断层/褶皱', C.jade);

    var x0 = 30, y0 = 130, cell = 4;
    var W = 64, H = 48;
    /* 梯度热图 */
    var maxG = 1.2;
    var sHeat = '';
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var g = det.grad[y * W + x];
        var t = clamp(g / maxG, 0, 1);
        var r = Math.round(255 * t), gr = Math.round(255 * (1 - t));
        sHeat += G.rect(x0 + x * cell, y0 + y * cell, cell, cell, { fill: 'rgb(' + r + ',' + gr + ',150)', op: 1 });
      }
    }
    s += sHeat;
    /* 检出线像素 */
    for (var pi = 0; pi < det.pts.length; pi++) {
      var p = det.pts[pi];
      s += G.rect(x0 + p.x * cell, y0 + p.y * cell, cell, cell, { fill: '#b05a51', op: 1 });
    }
    /* 真实断层线 */
    s += G.line(x0 + grid.fault.x1 * cell, y0 + grid.fault.y1 * cell, x0 + grid.fault.x2 * cell, y0 + grid.fault.y2 * cell, { stroke: '#2f7d6b', sw: 2, dash: '6 3' });
    s += G.txt(x0, y0 - 12, '构造线提取 · 梯度阈值 ' + f(L.thr, 2), { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(320, 270, 130, 192, '为什么用梯度',
      ['· 断层/岩性界线处概率跳变',
       '→ 梯度幅值高',
       '· 阈值太高：构造线断断续续',
       '· 阈值太低：噪声全被当构造',
       '',
       '细长低对比的构造线最易漏判，',
       '需要走向约束 + 形态学连接。'], 'clay');

    s += G.txt(x0, y0 + 208, '检出 ' + det.pts.length + ' 个线像素 · 与真实断层线对比（绿虚线）', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '检出线像素', v: det.pts.length }, { k: '阈值', v: f(L.thr, 2) }], note: '构造线是细长的低对比目标：从概率图算梯度，再阈值切割得到线像素。阈值是检出率与噪声的杠杆，直接拖动画里的滑杆就能体会。' };
  }

  /* =========================================================
     ⑥ 矢量化后处理
     ========================================================= */
  function stage6(t) {
    var c = compute(), vec = c.vec, seg = c.seg, grid = c.grid, L = c.L;
    var s = '';
    s += G.panel(0, '① 连通域', '同一类别连成一片', C.blue);
    s += G.panel(1, '② 剔碎斑', '小面积合并回背景', C.clay);
    s += G.panel(2, '③ 矢量图层', '可直接入库 GIS', C.jade);

    var x0 = 30, y0 = 130, cell = 4;
    /* 剔除碎斑后的结果 */
    s += rockMap(vec.segClean, 64, 48, cell, M.ROCK_COLORS, x0, y0, 256, 192);
    /* 面要素外接框 */
    for (var ci = 0; ci < vec.kept.length; ci++) {
      var comp = vec.kept[ci];
      var minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
      for (var pi = 0; pi < comp.pts.length; pi++) {
        if (comp.pts[pi][0] < minX) minX = comp.pts[pi][0];
        if (comp.pts[pi][0] > maxX) maxX = comp.pts[pi][0];
        if (comp.pts[pi][1] < minY) minY = comp.pts[pi][1];
        if (comp.pts[pi][1] > maxY) maxY = comp.pts[pi][1];
      }
      s += G.rect(x0 + minX * cell, y0 + minY * cell, (maxX - minX + 1) * cell, (maxY - minY + 1) * cell, { fill: 'none', stroke: '#b26a39', sw: 1.6 });
    }
    s += G.txt(x0, y0 - 12, '矢量化后处理 · 保留 ' + vec.kept.length + ' 个面要素', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(320, 270, 130, 192, '为什么要后处理',
      ['· 分割结果是一堆像素，不成"要素"',
       '· 连通域：同类像素聚成一个个面',
       '· 剔碎斑：小面积噪声合并回背景',
       '· 边缘平滑：才能变成可入库的矢量',
       '',
       '碎斑不剔除 → 矢量图全是噪声多边形',
       '过度平滑 → 薄层岩性被合并掉。'], 'clay');

    s += G.txt(x0, y0 + 208, '产出：岩性面要素 + 构造线要素 + 置信度字段 → 直接入库 GIS', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '面要素', v: vec.kept.length }, { k: '剔碎斑', v: (vec.sizes.length - vec.kept.length) }], note: '像素级的分类结果要变成"能入库的矢量图层"，必须做连通域、剔碎斑、边界平滑三步后处理——这一步的质量决定成果能不能直接用。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
