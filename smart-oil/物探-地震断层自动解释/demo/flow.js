/* =========================================================
   地震断层自动解释 · 算法解剖（断层概率体 + 断面骨架化）
   ---------------------------------------------------------
   把「地震体 → 断层骨架」拆成 6 步，每一步都跑真代码：

     ① 数据接入       振幅体 + 相干/曲率属性 + 对齐标签
     ② 断层标签       历史解释断层转分割标签
     ③ 断层概率体     3D U-Net 逐像素预测断层概率
     ④ 类别不均衡     Dice / 焦点损失压住背景
     ⑤ 断面骨架化     阈值 + 细化 → 断面中心线
     ⑥ 断层组合       连通域 + 剔碎段 + 走向分组

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

  /* 振幅剖面着色 */
  function ampColor(v) {
    var t = clamp(v, -1, 1);
    if (t >= 0) { var g = Math.round(220 * t); return 'rgb(' + g + ',' + g + ',' + (160 + 90 * t) + ')'; }
    var b = Math.round(-220 * t); return 'rgb(' + (150 + 100 * b / 220) + ',' + b + ',' + b + ')';
  }

  /* 小格着色图 */
  function cellMap(arr, W, H, cell, colorFn, x0, y0) {
    var s = '';
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var idx = y * W + x;
        s += G.rect(x0 + x * cell, y0 + y * cell, cell, cell, { fill: colorFn(arr[idx]), op: 1 });
      }
    }
    return s;
  }

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.nFault, L.weight, L.noise, L.thr, L.minLen].join(',');
    if (cache.key === key) return cache;
    var seis = M.genSeismic(64, 48, L.nFault, 20261105);
    var prob = M.faultProb(seis, L.weight, L.noise);
    var skel = M.skeletonFault(seis, prob.prob, L.thr, L.minLen);
    var grp = M.faultGroup(seis, skel.pts, L.minLen);
    cache = { key: key, L: L, seis: seis, prob: prob, skel: skel, grp: grp };
    return cache;
  }

  /* =========================================================
     ① 数据接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), seis = c.seis, L = c.L;
    var s = '';
    s += G.panel(0, '① 振幅体', '断层处同相轴错断', C.jade);
    s += G.panel(1, '② 相干属性', '断层响应更强', C.blue);
    s += G.panel(2, '③ 对齐标签', '统一网格', C.clay);

    var cell = 4, x0 = 30, y0 = 130;
    /* 振幅剖面 */
    s += cellMap(seis.amp, 64, 48, cell, ampColor, x0, y0);
    /* 断层参考线 */
    for (var f = 0; f < seis.faults.length; f++) {
      var fl = seis.faults[f];
      s += G.line(x0 + fl.x1 * cell, y0 + fl.y1 * cell, x0 + fl.x2 * cell, y0 + fl.y2 * cell, { stroke: '#f2c94c', sw: 1.6, dash: '6 3' });
    }
    s += G.txt(x0, y0 - 12, '三维地震振幅剖面（' + L.nFault + ' 条断层）', { size: 9.5, fill: C.ink2, weight: 700 });

    /* 相干属性示意：断层处更亮 */
    var x1 = 330, y1 = 130;
    for (var y = 0; y < 48; y++) {
      for (var x = 0; x < 64; x++) {
        var idx = y * 64 + x;
        var isF = seis.faultLabel[idx];
        var v = isF ? 1 : 0.15 + Math.random() * 0.2;
        s += G.rect(x1 + x * cell, y1 + y * cell, cell, cell, { fill: 'rgb(' + Math.round(120 + 130 * v) + ',' + Math.round(90 + 100 * v) + ',' + Math.round(80 + 60 * v) + ')', op: 1 });
      }
    }
    s += G.txt(x1, y1 - 12, '相干属性（断层处高响应）', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(30, 570, 130, 128, '为什么加属性通道',
      ['· 振幅剖面里断层是「同相轴错断」',
       '· 相干/曲率属性放大断层不连续',
       '· 多通道输入增强断层判别',
       '· 与历史断层标签统一网格对齐'], 'jade');

    s += G.txt(x0, y0 + 208, '属性计算相位畸变会让模型学到「假象」而非断层', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '工区', v: '200 km²' }, { k: '断层条数', v: L.nFault + ' 条' }, { k: '通道', v: '振幅+属性' }], note: '第一步先把地下断层"看清楚"：振幅剖面里断层是错断的同相轴，相干/曲率属性把它放大，为分割做准备。' };
  }

  /* =========================================================
     ② 断层标签
     ========================================================= */
  function stage2(t) {
    var c = compute(), seis = c.seis, L = c.L;
    var s = '';
    s += G.panel(0, '① 历史断层', '量大但带分歧', C.clay);
    s += G.panel(1, '② 标签清洗', '合并分歧·剔噪声', C.jade);
    s += G.panel(2, '③ 断层标签', '体素级真值', C.blue);

    var cell = 4, x0 = 30, y0 = 130;
    /* 断层真值标签 */
    s += cellMap(seis.faultLabel, 64, 48, cell, function (v) { return v ? '#2f7d6b' : '#f4f3ef'; }, x0, y0);
    s += G.txt(x0, y0 - 12, '断层分割标签（断层像素' + ' <1%）', { size: 9.5, fill: C.ink2, weight: 700 });

    /* 历史标签带分歧（边界抖动） */
    var rnd = M.mulberry32(20261107);
    var x1 = 330, y1 = 130;
    for (var y = 0; y < 48; y++) {
      for (var x = 0; x < 64; x++) {
        var idx = y * 64 + x;
        var v = seis.faultLabel[idx];
        if (v && rnd() < 0.25) v = 0;
        s += G.rect(x1 + x * cell, y1 + y * cell, cell, cell, { fill: v ? '#b26a39' : '#f4f3ef', op: 1 });
      }
    }
    s += G.txt(x1, y1 - 12, '历史标签（带解释员分歧）', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(30, 570, 130, 128, '标签策略',
      ['· 历史解释断层体素化即标签',
       '· 量大但含解释员分歧（噪声）',
       '· 清洗：合并分歧、剔非断层噪声',
       '· 少量精修标签拉精度上限'], 'clay');

    s += G.txt(x0, y0 + 208, '断层标签稀缺：历史断层量大但脏，必须清洗后再训练', { size: 9, fill: '#8a4f27' });
    return { svg: s, stats: [{ k: '标签来源', v: '历史断层' }, { k: '标签量', v: '5—10 工区' }, { k: '策略', v: '清洗+精修' }], note: '历史解释断层直接体素化成标签弥补稀缺，但带解释员分歧；清洗合并分歧、剔除非断层噪声，再用少量精修标签校准。' };
  }

  /* =========================================================
     ③ 断层概率体
     ========================================================= */
  function stage3(t) {
    var c = compute(), seis = c.seis, prob = c.prob, L = c.L;
    var s = '';
    s += G.panel(0, '① 编码器', '下采样提特征', C.blue);
    s += G.panel(1, '② 解码器', '上采样回分辨率', C.jade);
    s += G.panel(2, '③ 断层概率', '每像素一个概率', C.clay);

    var x0 = 30, y0 = 130, w = 540, h = 130;
    s += G.axes(x0, y0, w, h, { nx: 4, ny: 2 });
    /* 3D U-Net 收缩-扩张 */
    var steps = Math.floor(t * 5);
    var levelW = [110, 86, 62, 42, 62, 86, 110];
    var levelY = [y0 + 18, y0 + 42, y0 + 58, y0 + 66, y0 + 58, y0 + 42, y0 + 18];
    for (var i = 0; i <= steps && i < 7; i++) {
      var filled = (i === steps);
      var lx = x0 + 30 + i * 74;
      s += G.rect(lx, levelY[i], levelW[i], 40, { r: 6, fill: filled ? (i < 3 ? C.blueL : C.jadeL) : '#f4f3ef', stroke: i < 3 ? '#9fb5cf' : '#a7c6b8' });
      s += G.txt(lx + levelW[i] / 2, levelY[i] + 24, i < 3 ? '↓ 下采样' : '↑ 上采样', { size: 8, fill: C.ink3, anchor: 'middle' });
    }
    s += G.txt(x0, y0 - 12, '3D U-Net：地震体 → 断层概率体（每像素一个断层概率）', { size: 9.5, fill: C.ink2, weight: 700 });

    /* 右：概率体缩略 */
    var cell = 3, rx = 30 + 40, ry = y0 + 140;
    for (var y = 0; y < 48; y += 1) {
      for (var x = 0; x < 64; x += 1) {
        var idx = y * 64 + x;
        var p = prob.prob[idx];
        var g = Math.round(255 * p);
        s += G.rect(rx + x, ry + y, 1, 1, { fill: 'rgb(' + g + ',' + g + ',130)', op: 1 });
      }
    }
    s += G.txt(rx, ry - 8, '断层概率体', { size: 8.5, fill: C.ink3, anchor: 'middle' });
    s += G.txt(rx, ry + 56, '断层处概率高 · 背景干净', { size: 8.5, fill: C.ink3 });

    return { svg: s, stats: [{ k: '模型', v: '3D U-Net' }, { k: '输出', v: '断层概率体' }, { k: '损失', v: 'Dice/焦点' }], note: '3D U-Net 在整块地震体上逐像素预测断层概率。断层像素占比<1%，必须用焦点 / Dice 损失压住背景，否则模型全判非断层。' };
  }

  /* =========================================================
     ④ 类别不均衡
     ========================================================= */
  function stage4(t) {
    var c = compute(), seis = c.seis, L = c.L;
    var s = '';
    s += G.panel(0, '① 断层像素', '占比 <1%', C.jade);
    s += G.panel(1, '② 普通损失', '偏向背景', C.clay);
    s += G.panel(2, '③ 焦点/Dice', '抓住稀疏断层', C.blue);

    var x0 = 30, y0 = 130;
    /* 断层 vs 背景占比 */
    var gt = 0, n = 64 * 48;
    for (var i = 0; i < n; i++) gt += seis.faultLabel[i];
    var ratio = gt / n;
    s += G.txt(x0, y0 - 12, '断层像素占比 ' + f(ratio * 100, 1) + '%（类别极不均衡）', { size: 9.5, fill: C.ink2, weight: 700 });
    /* 占比条 */
    s += G.rect(x0, y0, 540, 34, { r: 6, fill: '#f4f3ef' });
    s += G.rect(x0, y0, 540 * ratio, 34, { r: 6, fill: '#2f7d6b' });
    s += G.txt(x0 + 12, y0 + 23, '断层 ' + f(ratio * 100, 1) + '%', { size: 9, fill: '#fff', weight: 700 });
    s += G.txt(x0 + 540 * ratio + 12, y0 + 23, '背景 ' + f((1 - ratio) * 100, 1) + '%', { size: 9, fill: C.ink2 });

    s += footBox(x0, 570, 200, 176, '为什么普通损失会翻车',
      ['· 全判成背景也能拿到 99%+ 准确率',
       '· 但小断层一条都抓不到',
       '· 焦点损失：压低易分类样本权重',
       '· Dice 损失：直接优化区域重叠',
       '',
       '目标：Dice ≥ 0.6 · 检出率 ≥ 0.9',
       '小断层一条都不能漏'], 'clay');

    s += G.txt(x0, y0 + 208, '类别不均衡是断层分割头号陷阱：普通交叉熵全判背景却"准确率很高"', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '断层占比', v: f(ratio * 100, 1) + '%' }, { k: '损失', v: '焦点/Dice' }, { k: '目标', v: '检出率≥0.9' }], note: '断层像素占比<1%是最容易翻车的点：普通交叉熵把所有像素判成背景也能拿到高准确率，但小断层一条都抓不到，必须用焦点 / Dice 损失。' };
  }

  /* =========================================================
     ⑤ 断面骨架化
     ========================================================= */
  function stage5(t) {
    var c = compute(), seis = c.seis, prob = c.prob, skel = c.skel, L = c.L;
    var s = '';
    s += G.panel(0, '① 断层概率', '断层处概率高', C.jade);
    s += G.panel(1, '② 阈值切割', '>thr 判为断层', C.blue);
    s += G.panel(2, '③ 断面骨架', '细长中心线', C.clay);

    var x0 = 30, y0 = 130, cell = 4;
    var W = 64, H = 48;
    /* 断层概率底图 */
    s += cellMap(prob.prob, 64, 48, cell, function (v) { var g = Math.round(255 * v); return 'rgb(' + g + ',' + g + ',130)'; }, x0, y0);
    /* 骨架像素 */
    for (var pi = 0; pi < skel.pts.length; pi++) {
      var p = skel.pts[pi];
      s += G.rect(x0 + p.x * cell + 1, y0 + p.y * cell + 1, cell - 2, cell - 2, { fill: '#b05a51', op: 1 });
    }
    /* 真实断层线 */
    for (var fi = 0; fi < seis.faults.length; fi++) {
      var fl = seis.faults[fi];
      s += G.line(x0 + fl.x1 * cell, y0 + fl.y1 * cell, x0 + fl.x2 * cell, y0 + fl.y2 * cell, { stroke: '#2f7d6b', sw: 2, dash: '6 3' });
    }
    s += G.txt(x0, y0 - 12, '断面骨架化 · 阈值 ' + f(L.thr, 2) + ' · ' + skel.pts.length + ' 个骨架像素', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(320, 270, 130, 192, '断层为什么难提',
      ['· 断层细长、低对比',
       '→ 直接阈值会断断续续',
       '· 需要细化提取中心线',
       '· 形态学连接补断点',
       '· 走向约束顺延断层',
       '',
       '细长低对比目标最易漏判，',
       '骨架化是把"一片概率"提纯成"一条线"。'], 'clay');

    s += G.txt(x0, y0 + 208, '红色 = 骨架中心线 · 绿色虚线 = 真实断层参考', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '骨架像素', v: skel.pts.length }, { k: '阈值', v: f(L.thr, 2) }], note: '断层是细长的低对比目标：从概率体阈值得到一片断层带，再用细化提取中心线成断面骨架。阈值太低噪声多、太高断断续续，需要走向约束与形态学连接。' };
  }

  /* =========================================================
     ⑥ 断层组合
     ========================================================= */
  function stage6(t) {
    var c = compute(), grp = c.grp, seis = c.seis, L = c.L;
    var s = '';
    s += G.panel(0, '① 连通域', '断层像素连成段', C.blue);
    s += G.panel(1, '② 剔碎段', '长度不足剔除', C.clay);
    s += G.panel(2, '③ 断层组合', '按走向分组', C.jade);

    var x0 = 30, y0 = 130, cell = 4;
    /* 断层概率底图 */
    s += cellMap(seis.faultLabel, 64, 48, cell, function (v) { return v ? '#2f7d6b' : '#f4f3ef'; }, x0, y0);
    /* 分组后的断层段 */
    for (var gi = 0; gi < grp.groups.length; gi++) {
      var g = grp.groups[gi];
      s += G.line(x0 + g.x * cell + 2, y0 + g.y0 * cell + 2, x0 + g.x * cell + 2, y0 + g.y1 * cell + 2, { stroke: '#b26a39', sw: 3 });
    }
    s += G.txt(x0, y0 - 12, '断层组合 · 保留 ' + grp.groups.length + ' 段 · 剔除 ' + (grp.totalGroups - grp.groups.length) + ' 段碎段', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(320, 270, 130, 192, '为什么后处理',
      ['· 骨架像素是一堆点，不成"断层"',
       '· 连通域：沿走向连成一段段断层',
       '· 剔碎段：长度不足的噪声删掉',
       '· 走向分组：形成可追踪的断层组合',
       '',
       '过度连接 → 相邻独立小断层并成一条',
       '碎段不剔 → 组合全是噪声短线。'], 'jade');

    s += G.txt(x0, y0 + 208, '产出：断层骨架 + 走向 + 置信度字段 → 直接用于构造建模', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '断层段', v: grp.groups.length }, { k: '剔碎段', v: grp.totalGroups - grp.groups.length }], note: '骨架像素要变成可入库的断层组合，必须做连通域、剔碎段、按走向分组三步后处理。过度连接并掉独立小断层，碎段不剔除又全是噪声短线。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
