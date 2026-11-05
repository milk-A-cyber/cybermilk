/* =========================================================
   射孔参数智能设计 · 算法解剖（代理模型 + 多目标优化）
   ---------------------------------------------------------
   把「射孔参数设计」拆成 6 步，每一步都跑真代码：

     ① 储层接入  强度/应力/渗透率
     ② 参数空间  孔密/相位/穿深
     ③ 代理模型  产能/出砂
     ④ 多目标优化  枚举组合
     ⑤ 帕累托前沿  产能 vs 出砂
     ⑥ 推荐方案  参数集 + 回流

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

  var C0 = '#41699b', C1 = '#b26a39', C2 = '#2f7d6b', CR = '#b05a51';

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

  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.rock, L.phase].join(',');
    if (cache.key === key) return cache;
    var rock = { strength: L.rock };
    var po = M.paretoOpt(rock, L.phase);
    cache = { key: key, L: L, rock: rock, po: po };
    return cache;
  }

  /* =========================================================
     ① 储层接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), L = c.L;
    var s = '';
    s += G.panel(0, '① 强度', f(L.rock), C.blue);
    s += G.panel(1, '② 应力', '30 MPa', C.clay);
    s += G.panel(2, '③ 渗透率', '250 mD', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '储层接入 · 力学参数', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + 12, '储层强度 ' + f(L.rock), { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 34, '地应力 30 MPa', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 56, '渗透率 250 mD', { size: 8.8, fill: C.ink2 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '为什么难',
      ['· 参数组合多',
       '  → 现场按经验',
       '· 定向井相位',
       '  → 靠个人判断',
       '',
       '需代理模型',
       '+ 多目标优化。'], 'clay');
    return { svg: s, stats: [{ k: '强度', v: f(L.rock) }, { k: '参数', v: '孔密/相位/穿深' }], note: '读入储层与岩石力学参数（强度、应力、渗透率）。射孔参数影响产能与出砂风险，需在储层强度、完井方式与产能目标之间取平衡。' };
  }

  /* =========================================================
     ② 参数空间
     ========================================================= */
  function stage2(t) {
    var s = '';
    s += G.panel(0, '① 孔密', '8-24', C.blue);
    s += G.panel(1, '② 相位', '0-180°', C.clay);
    s += G.panel(2, '③ 穿深', '0.3-1.2m', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '参数空间', { size: 9.5, fill: C.ink2, weight: 700 });
    var rows = [
      ['孔密', '8 / 12 / 16 / 20 / 24 孔/m'],
      ['相位', '0 / 60 / 90 / 120 / 180 °'],
      ['穿深', '0.3 / 0.5 / 0.8 / 1.0 / 1.2 m']
    ];
    for (var i = 0; i < rows.length; i++) {
      var ry = y0 + i * 32;
      s += G.txt(x0, ry, rows[i][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(x0 + 64, ry, rows[i][1], { size: 8.4, fill: C.ink3 });
    }

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '空间的坑',
      ['· 组合爆炸',
       '  → 25 种×5',
       '· 现场标准',
       '  → 欠优化',
       '',
       '枚举+代理',
       '找最优。'], 'jade');
    return { svg: s, stats: [{ k: '孔密', v: '8-24' }, { k: '相位', v: '0-180°' }, { k: '穿深', v: '0.3-1.2m' }], note: '射孔参数（孔密、相位、穿深）组合多，现场多按经验取标准方案。定向井与水平井的相位选择更依赖个人判断。' };
  }

  /* =========================================================
     ③ 代理模型
     ========================================================= */
  function stage3(t) {
    var c = compute(), rock = c.rock, L = c.L;
    var s = '';
    s += G.panel(0, '① 产能', '随穿深↑', C.blue);
    s += G.panel(1, '② 出砂', '随穿深↑', C.clay);
    s += G.panel(2, '③ 代理', 'q=' + f(M.proxyModel(rock, { density: 12, phase: L.phase, depth: 0.8 }).q, 1), C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '代理模型 · 响应', { size: 9.5, fill: C.ink2, weight: 700 });
    var qs = [], rs = [];
    for (var i = 0; i < M.DEPTHS.length; i++) {
      var p = M.proxyModel(rock, { density: 12, phase: L.phase, depth: M.DEPTHS[i] });
      qs.push(p.q / 60);
      rs.push(p.risk);
    }
    s += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    var qline = '<path d="M';
    for (var qj = 0; qj < qs.length; qj++) {
      qline += (x0 + qj * xw / (qs.length - 1)).toFixed(1) + ' ' + (y0 + h - qs[qj] * h).toFixed(1);
      if (qj < qs.length - 1) qline += ' L';
    }
    qline += '" fill="none" stroke="' + C0 + '" stroke-width="2"/>';
    s += qline;
    var rline = '<path d="M';
    for (var rj = 0; rj < rs.length; rj++) {
      rline += (x0 + rj * xw / (rs.length - 1)).toFixed(1) + ' ' + (y0 + h - rs[rj] * h).toFixed(1);
      if (rj < rs.length - 1) rline += ' L';
    }
    rline += '" fill="none" stroke="' + CR + '" stroke-width="1.6" stroke-dasharray="5 3"/>';
    s += rline;
    s += G.txt(x0, y0 + h + 20, '穿深 ↑', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '代理的坑',
      ['· 产能↑',
       '  → 出砂也↑',
       '· 纯数据',
       '  → 样本不足',
       '',
       '物理模型',
       '作代理训练集。'], 'jade');
    return { svg: s, stats: [{ k: '产能', v: '随穿深↑' }, { k: '出砂', v: '随穿深↑' }], note: '用代理模型预测不同参数组合的产能与出砂风险。产能随穿深与孔密上升，出砂风险也随之上升。需要射孔产能物理模型作代理训练集。' };
  }

  /* =========================================================
     ④ 多目标优化
     ========================================================= */
  function stage4(t) {
    var c = compute(), po = c.po;
    var s = '';
    s += G.panel(0, '① 枚举', po.all.length + ' 组合', C.blue);
    s += G.panel(1, '② 双目标', 'q↑/risk↓', C.clay);
    s += G.panel(2, '③ 权衡', '帕累托', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '多目标优化 · 枚举', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + 12, '孔密×穿深=' + M.DENSITY.length + '×' + M.DEPTHS.length, { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 34, '每个组合算产能与出砂', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 56, '找非支配方案', { size: 8.8, fill: C.jadeD });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '优化的坑',
      ['· 只求单目标',
       '  → 出砂失控',
       '· 组合太多',
       '  → 穷举慢',
       '',
       '枚举+代理',
       '高效权衡。'], 'jade');
    return { svg: s, stats: [{ k: '组合', v: po.all.length }, { k: '前沿', v: po.front.length + ' 点' }], note: '多目标优化枚举孔密×穿深组合，用代理模型算每个组合的产能与出砂，找帕累托前沿。' };
  }

  /* =========================================================
     ⑤ 帕累托前沿
     ========================================================= */
  function stage5(t) {
    var c = compute(), po = c.po;
    var s = '';
    s += G.panel(0, '① 方案', '散点', C.blue);
    s += G.panel(1, '② 前沿', po.front.length + ' 点', C.clay);
    s += G.panel(2, '③ 推荐', po.rec.density + '孔/' + po.rec.phase + '°', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '帕累托前沿 · 产能 vs 出砂', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    for (var i = 0; i < po.all.length; i++) {
      var ap = po.all[i];
      s += G.circle(x0 + ap.risk * xw, y0 + h - ap.q / 60 * h, 2.5, { fill: '#c9d4df', stroke: 'none' });
    }
    for (var j = 0; j < po.front.length; j++) {
      var fp = po.front[j];
      s += G.circle(x0 + fp.risk * xw, y0 + h - fp.q / 60 * h, 4.5, { fill: C2, stroke: 'none' });
    }
    s += G.circle(x0 + po.rec.risk * xw, y0 + h - po.rec.q / 60 * h, 6, { fill: CR, stroke: '#fff', sw: 2 });
    s += G.txt(x0, y0 + h + 20, '灰=全部组合 绿=前沿 红=推荐', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '前沿的坑',
      ['· 不出砂但低产',
       '  → 无意义',
       '· 高产能但出砂',
       '  → 不可用',
       '',
       '帕累托前沿',
       '保留权衡。'], 'jade');
    return { svg: s, stats: [{ k: '前沿', v: po.front.length + ' 点' }, { k: '推荐', v: po.rec.density + '孔/' + po.rec.phase + '°/' + f(po.rec.depth) + 'm' }], note: '帕累托前沿保留无法同时改善产能与出砂的权衡方案，避免只求单目标导致出砂失控。' };
  }

  /* =========================================================
     ⑥ 推荐方案
     ========================================================= */
  function stage6(t) {
    var c = compute(), po = c.po;
    var s = '';
    s += G.panel(0, '① 参数', '孔密/相位/穿深', C.blue);
    s += G.panel(1, '② 出砂反馈', '约束', C.clay);
    s += G.panel(2, '③ 回流', '作业反馈', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14;
    var rows = [
      ['孔密', po.rec.density + ' 孔/m', '参数'],
      ['相位', po.rec.phase + ' °', '参数'],
      ['穿深', f(po.rec.depth) + ' m', '参数'],
      ['出砂约束', '作业反馈', '约束']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 28;
      s += G.rect(x0, ry, 240, 22, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(x0 + 26, ry + 15, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(x0 + 150, ry + 15, rows[r][1], { size: 8.8, fill: C.jadeD });
    }
    s += G.txt(x0, y0 - 20, '推荐方案 · 出砂回流', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '推荐的坑',
      ['· 不回流',
       '  → 出砂约束失效',
       '· 只给单点',
       '  → 无法权衡',
       '',
       '方案集+回流',
       '越用越准。'], 'jade');
    return { svg: s, stats: [{ k: '孔密', v: po.rec.density + ' 孔/m' }, { k: '相位', v: po.rec.phase + ' °' }], note: '输出帕累托方案集与推荐参数，出砂与作业反馈作为约束回流，参数设计越用越准。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
