/* =========================================================
   储层参数反演 · 算法解剖（深度回归 + 多属性融合 + 物理约束）
   ---------------------------------------------------------
   把「地震属性 → 孔隙度」拆成 6 步，每一步都跑真代码：

     ① 属性与对齐     地震体 → 多属性 + 井震对齐
     ② 井点标签       测井参数 → 回归标签
     ③ 深度回归       多属性 → 孔隙度（非线性映射）
     ④ 多属性融合     振幅/频率/阻抗加权
     ⑤ 物理约束       范围 + 一致性 → 惩罚不可信
     ⑥ 复核与部署     井点吻合 → 储层建模 + 回流

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

  var N = 60, H = 200, x0 = 40, y0 = 150, W = 360, xS = W / N, yS = 180 / 0.45;

  function linePath(well, arr, x0, y0, color, dash) {
    var s = '<path d="M';
    for (var i = 0; i < N; i++) {
      s += (x0 + i * xS).toFixed(1) + ' ' + (y0 + H - arr[i] * yS).toFixed(1);
      if (i < N - 1) s += ' L';
    }
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (dash ? 1.8 : 2) + '"' + (dash ? ' stroke-dasharray="5 3"' : '') + '/>';
    return s;
  }

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.weight, L.nWell, L.wAmp, L.wFreq, L.wImp, L.lo, L.hi].join(',');
    if (cache.key === key) return cache;
    var well = M.genWell(N, 20261112);
    var reg = M.deepRegress(well, L.weight);
    var re = M.regEval(well, reg.pred);
    var fuse = M.multiFuse(well, L.wAmp, L.wFreq, L.wImp);
    var fe = M.fuseEval(well, fuse.pred);
    var field = M.genPoroField(56, 40, 20261114);
    var phys = M.physConstrain(field.f, L.lo, L.hi);
    cache = { key: key, L: L, well: well, reg: reg, re: re, fuse: fuse, fe: fe, field: field, phys: phys };
    return cache;
  }

  /* =========================================================
     ① 属性与对齐
     ========================================================= */
  function stage1(t) {
    var c = compute(), well = c.well, L = c.L;
    var s = '';
    s += G.panel(0, '① 地震体', '多属性提取', C.jade);
    s += G.panel(1, '② 井点参数', '沿井轨迹投影', C.blue);
    s += G.panel(2, '③ 对齐网格', '统一采样', C.clay);

    var x0 = 30, y0 = 130;
    /* 三条属性曲线 */
    var attrs = [
      { name: '振幅', arr: well.attr[0], c: '#41699b' },
      { name: '频率', arr: well.attr[1], c: '#8a4f27' },
      { name: '阻抗', arr: well.attr[2], c: '#6b7a6b' }
    ];
    for (var a = 0; a < 3; a++) {
      var ay = y0 + a * 52;
      s += G.axes(x0, ay, 300, 42, { nx: 3, ny: 1 });
      s += linePath(well, attrs[a].arr, x0, ay, attrs[a].c, true);
      s += G.txt(x0 + 310, ay + 20, attrs[a].name, { size: 8.5, fill: attrs[a].c, weight: 700 });
    }
    s += G.txt(x0, y0 - 12, '地震多属性（振幅/频率/阻抗）+ 井震对齐', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(400, 190, 130, 176, '为什么对齐难',
      ['· 测井是厘米级分辨率',
       '· 地震是十米级分辨率',
       '· 直接对齐会错位',
       '· 需在特征层对齐',
       '',
       '对齐错位 → 模型学到',
       '「错位的假映射」。'], 'clay');

    s += G.txt(x0, y0 + 170, '井震尺度不匹配：测井厘米级 vs 地震十米级 · 必须特征层对齐', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '属性', v: '振幅/频率/阻抗' }, { k: '井', v: L.nWell + ' 口' }, { k: '对齐', v: '特征层' }], note: '第一步把地震体提成多属性，并把井点参数沿井轨迹投影对齐。井震尺度不匹配直接对齐会错位，必须在特征层对齐，否则模型学到错位的假映射。' };
  }

  /* =========================================================
     ② 井点标签
     ========================================================= */
  function stage2(t) {
    var c = compute(), well = c.well, L = c.L;
    var s = '';
    s += G.panel(0, '① 测井解释', '孔隙度/饱和度', C.clay);
    s += G.panel(1, '② 回归标签', '连续值真值', C.jade);
    s += G.panel(2, '③ 验证井', '独立评测', C.blue);

    var x0 = 30, y0 = 130;
    s += G.axes(x0, y0, 360, 180, { nx: 4, ny: 3 });
    s += linePath(well, well.poro, x0, y0, '#2f7d6b', false);
    s += G.txt(x0, y0 - 12, '井孔隙度真值（回归标签）', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(420, 170, 130, 176, '标签从哪来',
      ['· 井点测井解释孔隙度',
       '· 整理成连续回归标签',
       '· 留出独立验证井',
       '',
       '只有 20—50 口井，',
       '标签稀缺且带解释误差。'], 'clay');

    s += G.txt(x0, y0 + 190, '井标签带解释误差，直接把误差学进映射会偏离井点真值', { size: 9, fill: '#8a4f27' });
    return { svg: s, stats: [{ k: '井数', v: L.nWell + ' 口' }, { k: '标签', v: '孔隙度连续值' }, { k: '验证', v: '独立井' }], note: '井点测井解释孔隙度整理成连续回归标签，留独立验证井。井标签带解释误差，直接把误差学进映射会让井点预测偏离真值。' };
  }

  /* =========================================================
     ③ 深度回归
     ========================================================= */
  function stage3(t) {
    var c = compute(), well = c.well, reg = c.reg, re = c.re, L = c.L;
    var s = '';
    s += G.panel(0, '① 输入层', '多属性向量', C.blue);
    s += G.panel(1, '② 隐层', '非线性映射', C.jade);
    s += G.panel(2, '③ 输出', '孔隙度', C.clay);

    var x0 = 30, y0 = 130;
    /* 网络结构 */
    var layers = [
      { x: x0, y: y0 + 20, w: 120, h: 120, c: C.blueL, label: '多属性输入' },
      { x: x0 + 140, y: y0 + 40, w: 90, h: 80, c: C.jadeL, label: '隐层 1' },
      { x: x0 + 250, y: y0 + 40, w: 90, h: 80, c: C.jadeL, label: '隐层 2' },
      { x: x0 + 360, y: y0 + 55, w: 90, h: 50, c: C.clayL, label: '孔隙度' }
    ];
    for (var i = 0; i < layers.length; i++) {
      var lx = layers[i].x, ly = layers[i].y;
      s += G.rect(lx, ly, layers[i].w, layers[i].h, { r: 8, fill: layers[i].c, stroke: i === 0 ? '#9fb5cf' : i === 3 ? '#d8a48c' : '#a7c6b8' });
      s += G.txt(lx + layers[i].w / 2, ly + layers[i].h / 2, layers[i].label, { size: 8.5, fill: C.ink2, anchor: 'middle' });
      if (i > 0) s += G.line(lx - 12, ly + layers[i].h / 2, lx - 4, ly + layers[i].h / 2, { stroke: '#9ba3a9', sw: 1 });
    }

    /* 右：拟合曲线 */
    var rx = x0 + 470, ry = y0;
    s += G.axes(rx, ry, 130, 150, { nx: 2, ny: 2 });
    s += '<path d="M' + (rx + 10) + ' ' + (ry + 30) + ' C' + (rx + 40) + ' ' + (ry + 60) + ' ' + (rx + 60) + ' ' + (ry + 80) + ' ' + (rx + 110) + ' ' + (ry + 120) + '" fill="none" stroke="#2f7d6b" stroke-width="2"/>';
    s += '<path d="M' + (rx + 10) + ' ' + (ry + 36) + ' C' + (rx + 40) + ' ' + (ry + 64) + ' ' + (rx + 60) + ' ' + (ry + 76) + ' ' + (rx + 110) + ' ' + (ry + 122) + '" fill="none" stroke="#b26a39" stroke-width="1.6" stroke-dasharray="4 3"/>';
    s += G.txt(rx + 10, ry - 8, '拟合：RMSE ' + f(re.rmse, 3), { size: 8.5, fill: C.ink3 });

    return { svg: s, stats: [{ k: 'RMSE', v: f(re.rmse, 3) }, { k: '相关系数', v: f(re.corr, 2) }], note: '深度回归建立多属性到孔隙度的非线性映射，替代迭代反演。井样本只有 20—50 口，网络太深会过拟合——井点拟合好但井间乱跳。' };
  }

  /* =========================================================
     ④ 多属性融合
     ========================================================= */
  function stage4(t) {
    var c = compute(), well = c.well, fuse = c.fuse, fe = c.fe, L = c.L;
    var s = '';
    s += G.panel(0, '① 单属性估计', '各有偏差', C.blue);
    s += G.panel(1, '② 自适应加权', '学权重', C.jade);
    s += G.panel(2, '③ 融合预测', '更稳健', C.clay);

    var x0 = 30, y0 = 130;
    /* 三条属性单独估计 vs 融合 */
    var ests = [
      { name: '振幅', arr: well.attr[0].map(function (a) { return clamp((a - 0.15) / 1.1, 0, 0.45); }), c: '#41699b' },
      { name: '频率', arr: well.attr[1].map(function (fr) { return clamp((0.9 - fr) / 1.3, 0, 0.45); }), c: '#8a4f27' },
      { name: '阻抗', arr: well.attr[2].map(function (im) { return clamp((8.5 - im) / 9, 0, 0.45); }), c: '#6b7a6b' }
    ];
    for (var a = 0; a < 3; a++) {
      var ay = y0 + a * 52;
      s += G.axes(x0, ay, 300, 42, { nx: 3, ny: 1 });
      s += linePath(well, ests[a].arr, x0, ay, ests[a].c, true);
      s += G.txt(x0 + 310, ay + 20, ests[a].name + ' 单独估计', { size: 8.5, fill: ests[a].c, weight: 700 });
    }

    s += footBox(400, 190, 130, 176, '为什么融合',
      ['· 单属性各有噪声与偏差',
       '· 振幅对薄层、频率对岩性',
       '· 加权融合取长补短',
       '· 权重由网络自适应学习',
       '',
       '权重 ' + f(L.wAmp, 2) + ':' + f(L.wFreq, 2) + ':' + f(L.wImp, 2),
       'RMSE ' + f(fe.rmse, 3) + ' 比单属性更稳。'], 'jade');

    s += G.txt(x0, y0 + 170, '融合后 RMSE ' + f(fe.rmse, 3) + ' · 单属性失效时仍能靠其它属性兜底', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '权重', v: f(L.wAmp, 2) + ':' + f(L.wFreq, 2) + ':' + f(L.wImp, 2) }, { k: 'RMSE', v: f(fe.rmse, 3) }], note: '单属性各有噪声与偏差，多属性加权融合取长补短，权重由网络自适应学习。简单拼接而不学权重，噪声属性反而拉低精度。' };
  }

  /* =========================================================
     ⑤ 物理约束
     ========================================================= */
  function stage5(t) {
    var c = compute(), phys = c.phys, L = c.L;
    var s = '';
    s += G.panel(0, '① 原始输出', '可能越界', C.clay);
    s += G.panel(1, '② 物理约束', '范围+一致性', C.blue);
    s += G.panel(2, '③ 可信场', '符合物理', C.jade);

    var x0 = 30, y0 = 130, cell = 6;
    var W = 56, H = 40;
    /* 原始场（含越界红框） */
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var v = c.field.f[y * W + x];
        var g = Math.round(80 + 175 * clamp(v / 0.45, 0, 1));
        s += G.rect(x0 + x * cell, y0 + y * cell, cell, cell, { fill: 'rgb(' + g + ',' + Math.round(230 - g * 0.7) + ',120)', op: 1 });
        if (v > L.hi || v < L.lo) s += G.rect(x0 + x * cell, y0 + y * cell, cell, cell, { fill: 'none', stroke: '#b05a51', sw: 1.2 });
      }
    }
    s += G.txt(x0, y0 - 12, '原始孔隙度场（红框 = 越界）', { size: 9.5, fill: C.ink2, weight: 700 });

    /* 约束后 */
    var x1 = 320, y1 = 130;
    for (var y2 = 0; y2 < H; y2++) {
      for (var x2 = 0; x2 < W; x2++) {
        var v2 = phys.out[y2 * W + x2];
        var g2 = Math.round(80 + 175 * clamp(v2 / 0.45, 0, 1));
        s += G.rect(x1 + x2 * cell, y1 + y2 * cell, cell, cell, { fill: 'rgb(' + g2 + ',' + Math.round(230 - g2 * 0.7) + ',120)', op: 1 });
      }
    }
    s += G.txt(x1, y1 - 12, '物理约束后（' + phys.outOfRange + ' 个越界校正）', { size: 9.5, fill: C.ink2, weight: 700 });

    s += G.txt(x0, y0 + 200, '约束范围 ' + f(L.lo, 2) + '—' + f(L.hi, 2) + ' · 越界像素 ' + phys.outOfRange, { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '越界', v: phys.outOfRange }, { k: '约束', v: f(L.lo, 2) + '—' + f(L.hi, 2) }], note: '纯回归可能输出「看似合理但违反地质」的参数（孔隙度为负、超范围）。物理约束把范围与岩性一致性加进损失，惩罚越界，得到可信孔隙度场。' };
  }

  /* =========================================================
     ⑥ 复核与部署
     ========================================================= */
  function stage6(t) {
    var c = compute(), re = c.re, L = c.L;
    var s = '';
    s += G.panel(0, '① 井点吻合', 'RMSE 检查', C.blue);
    s += G.panel(1, '② 异常复查', '物理不可信区', C.clay);
    s += G.panel(2, '③ 储层建模', '井位部署+回流', C.jade);

    var x0 = 30, y0 = 130;
    /* 井点吻合表 */
    var rows = [
      ['井 A', '吻合 0.012', 'ok'],
      ['井 B', '吻合 0.009', 'ok'],
      ['井 C', '异常 0.031', '复查'],
      ['井 D', '吻合 0.011', 'ok'],
      ['井 E', '异常 0.028', '复查']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 26;
      s += G.rect(x0, ry, 360, 22, { r: 4, fill: rows[r][2] === 'ok' ? C.jadeL : C.clayL, stroke: rows[r][2] === 'ok' ? '#b9d8cb' : '#e6cdb2' });
      s += G.txt(x0 + 12, ry + 15, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(x0 + 90, ry + 15, rows[r][1], { size: 8.8, fill: rows[r][2] === 'ok' ? C.jadeD : '#8a4f27' });
      s += G.txt(x0 + 320, ry + 15, rows[r][2], { size: 8.8, fill: rows[r][2] === 'ok' ? C.jadeD : '#8a4f27', weight: 700 });
    }
    s += G.txt(x0, y0 - 12, '井点吻合与异常复查清单', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(420, 170, 130, 176, '人在环的价值',
      ['· 人只处理异常井与异常区',
       '· 局部修正后确认孔隙度场',
       '· 进入储层建模与井位部署',
       '· 错误反馈回训练集',
       '',
       '整体 RMSE ' + f(re.rmse, 3),
       '无人在环 → 不可信场扩散。'], 'clay');

    s += G.txt(x0, y0 + 150, '产出：物理可信的孔隙度场 + 井点吻合 + 置信度 → 储层建模', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: 'RMSE', v: f(re.rmse, 3) }, { k: '产出', v: '孔隙度场' }], note: '地质师对井点吻合与异常区复查，局部修正后孔隙度场进入储层建模与井位部署。错误反馈回训练集，模型持续改进。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
