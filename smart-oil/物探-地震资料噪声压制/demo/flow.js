/* =========================================================
   地震资料噪声压制 · 算法解剖（去噪网络 + 自监督 + 保真约束）
   ---------------------------------------------------------
   把「含噪 → 干净」拆成 6 步，每一步都跑真代码：

     ① 数据接入      含噪炮集 + 噪声分档标注
     ② 合成对构建    正演模型 → 含噪+干净真值
     ③ 去噪网络      含噪 → 干净（一次前向）
     ④ 自监督域适配  绕开干净真值，收敛合成-实际差异
     ⑤ 保真约束      只压噪声不伤信号
     ⑥ 复核与成像    残留验收 → 成像 + 回流

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

  var cell = 6, W = 56, H = 40;

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

  function sectionSVG(grid, x, y, highlight) {
    var s = '';
    var maxV = 1.3;
    for (var yy = 0; yy < grid.H; yy++) {
      for (var xx = 0; xx < grid.W; xx++) {
        var v = grid.data[yy][xx];
        var a = clamp(Math.abs(v) / maxV, 0, 1);
        var col;
        if (v >= 0) col = 'rgb(' + Math.round(210 - a * 140) + ',' + Math.round(238 - a * 80) + ',' + Math.round(200 - a * 60) + ')';
        else col = 'rgb(' + Math.round(210 - a * 120) + ',' + Math.round(214 - a * 110) + ',' + Math.round(200 - a * 60) + ')';
        s += G.rect(x + xx * cell, y + yy * cell, cell, cell, { fill: col, op: 1 });
      }
    }
    if (highlight === 'noise') {
      for (var yy2 = 0; yy2 < grid.H; yy2++) for (var xx2 = 0; xx2 < grid.W; xx2++) {
        if (Math.abs(grid.data[yy2][xx2]) > 1.1) s += G.rect(x + xx2 * cell, y + yy2 * cell, cell, cell, { fill: 'none', stroke: '#b05a51', sw: 1 });
      }
    }
    return s;
  }

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.noiseType, L.level, L.denoiseStr, L.selfDomain, L.fidelityThr, L.residualThr].join(',');
    if (cache.key === key) return cache;
    var clean = M.genSection(W, H, 20261121);
    var noisy = M.addNoise(clean, L.noiseType, L.level, 20261122);
    var den = M.denoise(noisy, L.denoiseStr, L.noiseType);
    var evDen = M.preserveEval(clean, noisy, den);
    var plain = M.denoise(noisy, 0.5, L.noiseType);
    var self = M.selfSup(noisy, L.noiseType, L.selfDomain);
    var evPlain = M.preserveEval(clean, noisy, plain);
    var evSelf = M.preserveEval(clean, noisy, self);
    cache = { key: key, L: L, clean: clean, noisy: noisy, den: den, evDen: evDen, plain: plain, self: self, evPlain: evPlain, evSelf: evSelf };
    return cache;
  }

  /* =========================================================
     ① 数据接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), L = c.L;
    var s = '';
    s += G.panel(0, '① 含噪炮集', '1 万—10 万道', C.clay);
    s += G.panel(1, '② 噪声分档', '面波/多次波/干扰', C.blue);
    s += G.panel(2, '③ 标注噪声区', '每类 ≥ 500 道', C.jade);

    var x0 = 24, y0 = 40;
    s += G.txt(x0, y0 - 12, '含噪剖面（红框 = 噪声区）· 当前类型：' + M.NOISE_TYPES[L.noiseType], { size: 9.5, fill: C.ink2, weight: 700 });
    s += sectionSVG(c.noisy, x0, y0, 'noise');
    s += G.txt(x0, y0 + H * cell + 12, '类型 ' + M.NOISE_TYPES[L.noiseType] + ' · 强度 ' + f(L.level, 1), { size: 8.8, fill: C.ink3 });

    s += footBox(420, 150, 40, 220, '为什么分档',
      ['· 面波沿横向大尺度',
       '· 多次波是重复回响',
       '· 干扰是随机尖峰+块',
       '',
       '不分档 → 不同噪声',
       '混着学 → 一种没压',
       '掉另一种误伤信号。'], 'clay');
    return { svg: s, stats: [{ k: '类型', v: M.NOISE_TYPES[L.noiseType] }, { k: '强度', v: f(L.level, 1) }, { k: '标注', v: '每类≥500' }], note: '把含噪炮集读进来，处理员按噪声类型标注噪声区。噪声类型不分档，网络把不同噪声混在一起学，一种没压掉另一种又误伤。' };
  }

  /* =========================================================
     ② 合成对构建
     ========================================================= */
  function stage2(t) {
    var c = compute(), L = c.L;
    var s = '';
    s += G.panel(0, '① 干净信号', '正演模型', C.jade);
    s += G.panel(1, '② 叠加噪声', '各类噪声', C.clay);
    s += G.panel(2, '③ 含噪+干净对', '可无限扩增', C.blue);

    var x0 = 24, y0 = 40;
    s += G.txt(x0, y0 - 12, '干净信号（合成真值）', { size: 9.5, fill: C.ink2, weight: 700 });
    s += sectionSVG(c.clean, x0, y0);
    s += G.txt(x0, y0 + H * cell + 12, '正演模型生成干净剖面，作为训练真值', { size: 8.8, fill: C.ink3 });

    s += footBox(420, 150, 40, 220, '合成对的意义',
      ['· 干净真值在真实数据',
       '  上不可得',
       '· 正演生成含噪+干净对',
       '· 可无限扩增',
       '',
       '代价：合成与真实噪声',
       '形态差异大，需域适配。'], 'jade');
    return { svg: s, stats: [{ k: '真值', v: '合成干净' }, { k: '扩增', v: '无限' }, { k: '代价', v: '域差异' }], note: '用正演模型生成合成含噪+干净对，弥补真实干净真值不可得。合成噪声与真实形态差异大，只在合成学好、真实上掉精度，后续需域适配。' };
  }

  /* =========================================================
     ③ 去噪网络
     ========================================================= */
  function stage3(t) {
    var c = compute(), L = c.L;
    var s = '';
    s += G.panel(0, '① 含噪输入', '多类噪声', C.clay);
    s += G.panel(1, '② 去噪网络', '一次前向', C.jade);
    s += G.panel(2, '③ 干净剖面', '多类压制', C.blue);

    var x0 = 24, y0 = 40;
    s += G.txt(x0, y0 - 12, '含噪 → 去噪网络 → 干净（强度 ' + f(L.denoiseStr, 2) + '）', { size: 9.5, fill: C.ink2, weight: 700 });
    s += sectionSVG(c.noisy, x0, y0);
    s += G.txt(x0, y0 + H * cell + 12, '含噪', { size: 8.5, fill: C.clayD, weight: 700, anchor: 'middle', cx: x0 + W * cell / 2 });

    /* 网络方块 */
    var nx = 200, ny = 60;
    s += G.rect(nx, ny, 90, 40, { r: 8, fill: C.jadeL, stroke: '#a7c6b8' });
    s += G.txt(nx + 45, ny + 25, '去噪网络', { size: 9, fill: C.jadeD, anchor: 'middle', weight: 700 });
    s += G.line(nx - 10, ny + 20, nx - 2, ny + 20, { stroke: '#9ba3a9', sw: 1 });
    s += G.line(nx - 10, ny + 40, nx - 2, ny + 40, { stroke: '#9ba3a9', sw: 1 });

    var x1 = 320, y1 = 40;
    s += G.txt(x1, y1 - 12, '去噪后', { size: 9.5, fill: C.ink2, weight: 700 });
    s += sectionSVG(c.den, x1, y1);
    s += G.line(nx + 94, ny + 30, x1 - 8, ny + 30, { stroke: '#2f7d6b', sw: 1.4 });

    s += footBox(120, 430, 16, 108, '去噪效果',
      ['信噪比提升 ' + f(c.evDen.snrGain, 1) + ' dB',
       '保真度 ' + Math.round(c.evDen.fidelity * 100) + '%',
       '· 强度越高越干净',
       '· 超过 0.7 会伤有效波'], 'jade');

    return { svg: s, stats: [{ k: '信噪比提升', v: f(c.evDen.snrGain, 1) + ' dB' }, { k: '保真度', v: Math.round(c.evDen.fidelity * 100) + '%' }], note: '去噪网络学习「含噪 → 干净」映射，一次前向压制多类噪声。网络学的是「抹掉所有变化」而非「只抹噪声」，强度过高会把有效反射也抹掉。' };
  }

  /* =========================================================
     ④ 自监督与域适配
     ========================================================= */
  function stage4(t) {
    var c = compute(), L = c.L;
    var s = '';
    s += G.panel(0, '① 裸平滑', '基线', C.clay);
    s += G.panel(1, '② 自监督', '掩码/邻道', C.jade);
    s += G.panel(2, '③ 域适配', '标注噪声区', C.blue);

    var x0 = 24, y0 = 40;
    s += G.txt(x0, y0 - 12, '自监督前（裸平滑）', { size: 9.5, fill: C.ink2, weight: 700 });
    s += sectionSVG(c.plain, x0, y0);
    s += G.txt(x0, y0 + H * cell + 12, '信噪比 ' + f(c.evPlain.snrGain, 1) + ' dB / 保真 ' + Math.round(c.evPlain.fidelity * 100) + '%', { size: 8.5, fill: C.clayD, weight: 700 });

    var x1 = 320, y1 = 40;
    s += G.txt(x1, y1 - 12, '自监督 + 域适配', { size: 9.5, fill: C.ink2, weight: 700 });
    s += sectionSVG(c.self, x1, y1);
    s += G.txt(x1, y1 + H * cell + 12, '信噪比 ' + f(c.evSelf.snrGain, 1) + ' dB / 保真 ' + Math.round(c.evSelf.fidelity * 100) + '%', { size: 8.5, fill: C.jadeD, weight: 700 });

    return { svg: s, stats: [{ k: '自监督前', v: f(c.evPlain.snrGain, 1) + ' dB' }, { k: '自监督后', v: f(c.evSelf.snrGain, 1) + ' dB' }], note: '干净真值不可得时用自监督（掩码重建、邻道互预测）在真实含噪数据上微调，再用标注噪声区做域适配。自监督信号设计不对，会学到「复制输入」而非「去噪」，效果等于没做。' };
  }

  /* =========================================================
     ⑤ 保真约束
     ========================================================= */
  function stage5(t) {
    var c = compute(), L = c.L;
    var s = '';
    s += G.panel(0, '① 残差学习', '学噪声', C.blue);
    s += G.panel(1, '② 保真约束', '按信噪比分区', C.jade);
    s += G.panel(2, '③ 只压噪声', '不伤信号', C.clay);

    var x0 = 24, y0 = 40;
    s += G.txt(x0, y0 - 12, '残差（去噪后 - 干净）：应只剩噪声', { size: 9.5, fill: C.ink2, weight: 700 });
    var resid = { W: c.clean.W, H: c.clean.H, data: (function () { var d = []; for (var y = 0; y < c.clean.H; y++) { d[y] = new Float64Array(c.clean.W); for (var x = 0; x < c.clean.W; x++) d[y][x] = c.self.data[y][x] - c.clean.data[y][x]; } return d; })() };
    s += sectionSVG(resid, x0, y0);

    s += footBox(360, 230, 40, 200, '保真约束逻辑',
      ['· 残差大但非信号 = 残留噪声',
       '· 残差大且在信号区 = 伤波',
       '· 保真约束惩罚伤波项',
       '',
       '保真阈值 ' + f(L.fidelityThr, 2),
       '约束太强留噪声、太弱伤信号。'], 'jade');

    return { svg: s, stats: [{ k: '保真度', v: Math.round(c.evSelf.fidelity * 100) + '%' }, { k: '信噪比', v: f(c.evSelf.snrGain, 1) + ' dB' }], note: '用残差学习 + 保真约束保证只压噪声不伤信号。保真约束太强会留噪声，太弱又伤信号，要按信噪比分区调。' };
  }

  /* =========================================================
     ⑥ 复核与成像
     ========================================================= */
  function stage6(t) {
    var c = compute(), L = c.L;
    var s = '';
    s += G.panel(0, '① 残留验收', '分区复核', C.blue);
    s += G.panel(1, '② 人工修正', '局部调整', C.clay);
    s += G.panel(2, '③ 成像+回流', '干净剖面', C.jade);

    var x0 = 24, y0 = 40;
    s += G.txt(x0, y0 - 12, '干净剖面（供成像）· 残留噪声复核', { size: 9.5, fill: C.ink2, weight: 700 });
    s += sectionSVG(c.self, x0, y0);

    /* 复核清单 */
    var x2 = 360;
    var rows = [
      ['段 1', '残留 0.3', 'ok'],
      ['段 2', '残留 0.7', '复查'],
      ['段 3', '残留 0.5', 'ok'],
      ['信号区', '无损伤', 'ok']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = 40 + r * 34;
      s += G.rect(x2, ry, 240, 28, { r: 4, fill: rows[r][2] === 'ok' ? C.jadeL : C.clayL, stroke: rows[r][2] === 'ok' ? '#b9d8cb' : '#e6cdb2' });
      s += G.txt(x2 + 12, ry + 19, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(x2 + 90, ry + 19, rows[r][1], { size: 8.8, fill: rows[r][2] === 'ok' ? C.jadeD : '#8a4f27' });
      s += G.txt(x2 + 200, ry + 19, rows[r][2], { size: 8.8, fill: rows[r][2] === 'ok' ? C.jadeD : '#8a4f27', weight: 700 });
    }
    s += G.txt(x2, 186, '产出：干净剖面 + 残留清单 → 成像', { size: 9, fill: C.ink2, weight: 700 });
    s += G.txt(x2, 202, '无人在环 → 去噪错误直接进成像 → 扩散', { size: 8.5, fill: '#8a4f27' });

    return { svg: s, stats: [{ k: '信噪比', v: f(c.evSelf.snrGain, 1) + ' dB' }, { k: '产出', v: '干净剖面' }], note: '处理员对残留噪声区复核，修正后干净剖面进入叠加/偏移成像。错误反馈回训练集，模型持续改进；无人在环会让去噪错误在成像结果里扩散。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
