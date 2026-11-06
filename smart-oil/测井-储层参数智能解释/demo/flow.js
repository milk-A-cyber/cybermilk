/* =========================================================
   储层参数智能解释 · 算法解剖（深度回归 + 迁移 + 物理约束）
   ---------------------------------------------------------
   把「测井 → 储层参数」拆成 6 步，每一步都跑真代码：

     ① 测井与岩心接入  曲线 + 岩心样点
     ② 深度回归        反演参数
     ③ 迁移学习        邻区先验
     ④ 物理约束        低阻更准
     ⑤ 试油验证        试油复核
     ⑥ 回流            复核回流更准

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

  var C0 = '#41699b', C1 = '#b26a39', C2 = '#2f7d6b';

  function footBox(x, w2, y, h, title, lines, tone) {
    var bg = tone === 'jade' ? C.jadeL : tone === 'clay' ? C.clayL : tone === 'blue' ? C.blueL : '#f4f3ef';
    var st = tone === 'jade' ? '#b9d8cb' : tone === 'clay' ? '#e6cdb2' : tone === 'blue' ? '#c5d6ea' : C.line;
    var fg = tone === 'jade' ? C.jadeD : tone === 'clay' ? '#8a4f27' : tone === 'blue' ? '#2b4a72' : C.ink2;
    var s = G.rect(x, y, w2, h, { r: 6, fill: bg, stroke: st });
    if (title) s += G.txt(x + 11, y + 17, title, { size: 9.6, fill: fg, weight: 700 });
    for (var i = 0; i < lines.length; i++) {
      s += G.txt(x + 11, y + (title ? 33 : 17) + i * 13, lines[i], { size: 8.8, fill: fg });
    }
    return s;
  }

  function line(arr, x0, y0, xS, yS, color, dash) {
    var s = '<path d="M';
    for (var i = 0; i < arr.length; i++) {
      s += (x0 + i * xS).toFixed(1) + ' ' + (y0 - arr[i] * yS).toFixed(1);
      if (i < arr.length - 1) s += ' L';
    }
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (dash ? 1.6 : 2) + '"' + (dash ? ' stroke-dasharray="5 3"' : '') + '/>';
    return s;
  }

  var N = 120;
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.regMode, L.transMode, L.phyMode].join(',');
    if (cache.key === key) return cache;
    var d = M.genCore(N, 20261191);
    var reg = M.deepReg(d, L.regMode);
    var tr = M.transferLearn(d, L.transMode);
    var pc = M.physicsConstrain(d, L.phyMode);
    cache = { key: key, L: L, d: d, reg: reg, tr: tr, pc: pc };
    return cache;
  }

  /* =========================================================
     ① 测井与岩心接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), d = c.d;
    var s = '';
    s += G.panel(0, '① 测井曲线', '常规+特殊', C.blue);
    s += G.panel(1, '② 岩心分析', '50—200 样点', C.clay);
    s += G.panel(2, '③ 试油验证', '验证解释', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '测井与岩心样点', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    d.lowRes.forEach(function (lr) {
      s += G.rect(G.COLS[0].x + 14 + lr.s * 240 / N, y0, (lr.e - lr.s) * 240 / N, h, { r: 0, fill: '#f9efea', stroke: '#d8a48c', sw: 0.8 });
    });
    d.coreIdx.forEach(function (ci) {
      var cx = G.COLS[0].x + 14 + ci * 240 / N, cy = y0 + h - d.porC[ci] / 0.4 * h;
      s += G.circle(cx, cy, 3, { fill: C1 });
    });
    s += line(d.den.map(function (v) { return (v - 2.0) / 0.9; }), G.COLS[0].x + 14, y0 + h, 240 / N, h, C0, false);
    s += G.txt(G.COLS[0].x + 20, y0 - 2, 'DEN', { size: 7.5, fill: C0 });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '浅色=低阻段 · ●=岩心样点', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '数据形态',
      ['· 常规+特殊测井',
       '· 岩心 50—200 样点',
       '· 试油验证',
       '',
       '不岩心校正，',
       '解释参数误差大。'], 'clay');
    return { svg: s, stats: [{ k: '测井', v: '常规+特殊' }, { k: '岩心', v: d.coreIdx.length + ' 样点' }], note: '读入测井曲线（常规+特殊）与岩心分析样点。不结合岩心校正，解释参数误差大。' };
  }

  /* =========================================================
     ② 深度回归
     ========================================================= */
  function stage2(t) {
    var c = compute(), d = c.d, reg = c.reg, L = c.L;
    var s = '';
    s += G.panel(0, '① 测井曲线', '常规+特殊', C.blue);
    s += G.panel(1, '② 深度回归', '反演参数', C.jade);
    s += G.panel(2, '③ 参数剖面', 'R²=' + f(reg.r2), C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '深度回归 · R²=' + f(reg.r2), { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    d.coreIdx.forEach(function (ci) {
      var cx = G.COLS[0].x + 14 + ci * 240 / N, cy = y0 + h - d.porC[ci] / 0.4 * h;
      s += G.circle(cx, cy, 3, { fill: C1 });
    });
    s += line(reg.por.map(function (v) { return v / 0.4; }), G.COLS[0].x + 14, y0 + h, 240 / N, h, C0, false);
    s += G.txt(G.COLS[0].x + 20, y0 - 2, '●岩心', { size: 7.5, fill: C1 });
    s += G.txt(G.COLS[0].x + 90, y0 - 2, '解释', { size: 7.5, fill: C0 });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '岩心样点有限，回归易过拟合', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '深度回归的坑',
      ['· 岩心样点少',
       '  → 过拟合',
       '· 跨区不成立',
       '',
       '要控制过拟合，',
       '用迁移+约束。'], 'jade');
    return { svg: s, stats: [{ k: 'R²', v: f(reg.r2) }, { k: '误差', v: f(reg.err, 3) }], note: '用测井曲线反演孔隙度/渗透率/含油饱和度。岩心样点少，回归过拟合、跨区不成立。' };
  }

  /* =========================================================
     ③ 迁移学习
     ========================================================= */
  function stage3(t) {
    var c = compute(), tr = c.tr, d = c.d, L = c.L;
    var s = '';
    s += G.panel(0, '① 邻区模型', '预训练', C.blue);
    s += G.panel(1, '② 迁移学习', '微调', C.jade);
    s += G.panel(2, '③ 跨区成立', '岩心少也行', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '迁移学习 · ' + tr.note + ' · R²=' + f(tr.r2), { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    var few = d.coreIdx.filter(function (_, i) { return i % 2 === 0; });
    few.forEach(function (ci) {
      var cx = G.COLS[0].x + 14 + ci * 240 / N, cy = y0 + h - d.porC[ci] / 0.4 * h;
      s += G.circle(cx, cy, 3, { fill: C1 });
    });
    var pre = [];
    for (var i = 0; i < N; i++) pre.push(clamp((2.9 - d.den[i]) * 0.52 + 0.04, 0.05, 0.32) / 0.4);
    s += line(pre, G.COLS[0].x + 14, y0 + h, 240 / N, h, '#9ba3a9', true);
    s += G.txt(G.COLS[0].x + 20, y0 - 2, '邻区先验', { size: 7.5, fill: '#9ba3a9' });
    s += G.txt(G.COLS[0].x + 110, y0 - 2, '●少量岩心', { size: 7.5, fill: C1 });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, (L.transMode === 1 ? '已迁移' : '未迁移') + ' · 邻区先验补样本', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '迁移学习的坑',
      ['· 不迁移',
       '  → 过拟合跨区失效',
       '· 岩心少没法练',
       '',
       '邻区先验+微调，',
       '跨区也成立。'], 'jade');
    return { svg: s, stats: [{ k: 'R²', v: f(tr.r2) }, { k: '方式', v: L.transMode === 0 ? '无迁移' : '已迁移' }], note: '用邻区模型迁移，岩心有限也能训练。不迁移，岩心少模型过拟合、跨区失效。' };
  }

  /* =========================================================
     ④ 物理约束
     ========================================================= */
  function stage4(t) {
    var c = compute(), d = c.d, pc = c.pc, L = c.L;
    var s = '';
    s += G.panel(0, '① 解释结果', '回归输出', C.blue);
    s += G.panel(1, '② 物理约束', '规律损失', C.jade);
    s += G.panel(2, '③ 低阻更准', '误差=' + f(pc.lowErr, 3), C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '物理约束 · 低阻误差 ' + f(pc.lowErr, 3), { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    d.lowRes.forEach(function (lr) {
      s += G.rect(G.COLS[0].x + 14 + lr.s * 240 / N, y0, (lr.e - lr.s) * 240 / N, h, { r: 0, fill: '#f9efea', stroke: '#d8a48c', sw: 0.8 });
    });
    var por = [];
    for (var i = 0; i < N; i++) por.push(d.porC[i] / 0.4);
    s += line(por, G.COLS[0].x + 14, y0 + h, 240 / N, h, C1, true);
    s += G.txt(G.COLS[0].x + 20, y0 - 2, '岩心实测', { size: 7.5, fill: C1 });
    s += G.txt(G.COLS[0].x + 110, y0 - 2, '浅色=低阻段', { size: 7.5, fill: C.ink3 });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, (L.phyMode === 1 ? '约束后低阻校正' : '未约束低阻误差大'), { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '物理约束的坑',
      ['· 不约束',
       '  → 违反岩石物理',
       '· 低阻油层误差大',
       '',
       '物理约束损失，',
       '低阻更准。'], 'jade');
    return { svg: s, stats: [{ k: '低阻误差', v: f(pc.lowErr, 3) }, { k: '试油一致', v: pc.agree + '/5' }], note: '用物理约束损失保证解释符合岩石物理规律。不做物理约束，解释可能违反岩石物理规律、低阻误差大。' };
  }

  /* =========================================================
     ⑤ 试油验证
     ========================================================= */
  function stage5(t) {
    var c = compute(), pc = c.pc, reg = c.reg;
    var s = '';
    s += G.panel(0, '① 解释结果', '模型建议', C.blue);
    s += G.panel(1, '② 试油验证', '核对参数', C.clay);
    s += G.panel(2, '③ 可靠↑', '低阻误差↓', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['决定系数 R²', f(reg.r2), '复核'],
      ['低阻段误差', f(pc.lowErr, 3), '核对'],
      ['试油一致', pc.agree + '/5 层', '佐证']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 38;
      s += G.rect(G.COLS[0].x + 14, ry, 240, 30, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(G.COLS[0].x + 26, ry + 20, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(G.COLS[0].x + 150, ry + 20, rows[r][1], { size: 8.8, fill: C.jadeD });
    }
    s += G.txt(G.COLS[0].x + 14, y0 - 20, '试油验证清单', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '试油验证的坑',
      ['· 验证不回流',
       '  → 模型不知解释错',
       '· 低阻永远误差大',
       '',
       '验证结果要回流，',
       '解释越用越准。'], 'clay');
    return { svg: s, stats: [{ k: 'R²', v: f(reg.r2) }, { k: '试油一致', v: pc.agree + '/5' }], note: '解释结果给建议，试油验证复核。验证结果不回流，模型不知道解释错在哪，低阻永远误差大。' };
  }

  /* =========================================================
     ⑥ 回流
     ========================================================= */
  function stage6(t) {
    var c = compute(), pc = c.pc;
    var s = '';
    s += G.panel(0, '① 解释建议', '模型输出', C.blue);
    s += G.panel(1, '② 验证回流', '确认修正', C.clay);
    s += G.panel(2, '③ 越用越准', '回流闭环', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['解释建议', '模型', '复核'],
      ['试油验证', '人工', '修正'],
      ['结果回流', '已回流', 'ok']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 38;
      s += G.rect(G.COLS[0].x + 14, ry, 240, 30, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(G.COLS[0].x + 26, ry + 20, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(G.COLS[0].x + 140, ry + 20, rows[r][1], { size: 8.8, fill: C.jadeD });
    }
    s += G.txt(G.COLS[0].x + 14, y0 - 20, '回流闭环', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '回流的坑',
      ['· 不回流',
       '  → 数据不增，一直误差',
       '· 无法越用越准',
       '',
       '试油+岩心回流，',
       '解释持续变准。'], 'jade');
    return { svg: s, stats: [{ k: '低阻误差', v: f(pc.lowErr, 3) }, { k: '回流', v: '已闭环' }], note: '试油验证结果回流训练集，模型越用越准、低阻油层误差持续下降。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
