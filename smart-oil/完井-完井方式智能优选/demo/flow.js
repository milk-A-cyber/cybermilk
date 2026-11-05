/* =========================================================
   完井方式智能优选 · 算法解剖（知识图谱 + 案例推理 + 多目标排序）
   ---------------------------------------------------------
   把「完井方式优选」拆成 6 步，每一步都跑真代码：

     ① 储层接入  储层特征
     ② 完井方式  4 类属性
     ③ 知识图谱  储层→方式→表现
     ④ 相似案例  kNN 推理
     ⑤ 多目标排序  产能/防砂/成本
     ⑥ 方案推荐  候选 + 帕累托

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
    var key = [L.well, L.weight].join(',');
    if (cache.key === key) return cache;
    var wells = M.genWells(120, 20261101);
    var query = { i: L.well, litho: wells.litho[L.well], sandIdx: wells.sandIdx[L.well], waterNear: wells.waterNear[L.well] };
    var sims = M.similarCases(query, wells, 5);
    var plans = M.rankPlans(query, wells, L.weight);
    var wayCnt = [0, 0, 0, 0];
    sims.forEach(function (s) { wayCnt[s.way]++; });
    var bestWay = 0;
    for (var i = 1; i < 4; i++) if (wayCnt[i] > wayCnt[bestWay]) bestWay = i;
    cache = { key: key, L: L, wells: wells, query: query, sims: sims, plans: plans, bestWay: bestWay };
    return cache;
  }

  /* =========================================================
     ① 储层接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), q = c.query;
    var s = '';
    s += G.panel(0, '① 岩性', M.LITHOS[q.litho], C.blue);
    s += G.panel(1, '② 出砂指数', f(q.sandIdx), C.clay);
    s += G.panel(2, '③ 近水层', q.waterNear ? '近' : '远', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '储层接入 · 井' + c.L.well, { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + 12, '岩性 ' + M.LITHOS[q.litho], { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 34, '出砂指数 ' + f(q.sandIdx), { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 56, (q.waterNear ? '近水层' : '远离水层'), { size: 8.8, fill: C.ink2 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '为什么难',
      ['· 方案选择',
       '  → 强依赖经验',
       '· 邻井案例',
       '  → 新区块没有',
       '',
       '需知识图谱',
       '+ 相似案例。'], 'clay');
    return { svg: s, stats: [{ k: '岩性', v: M.LITHOS[q.litho] }, { k: '出砂', v: f(q.sandIdx) }], note: '读入储层与流体特征（岩性、出砂指数、水层位置）。完井方式决定井与储层的连通方式，选择依据储层类型、出砂倾向与出水风险。' };
  }

  /* =========================================================
     ② 完井方式
     ========================================================= */
  function stage2(t) {
    var s = '';
    s += G.panel(0, '① 裸眼', '高产能', C.blue);
    s += G.panel(1, '② 射孔', '均衡', C.clay);
    s += G.panel(2, '③ 筛管/砾石', '防砂', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '完井方式 · 4 类属性', { size: 9.5, fill: C.ink2, weight: 700 });
    var rows = [
      ['裸眼', '产能1.0 防砂0.10 成本0.30'],
      ['射孔', '产能0.85 防砂0.50 成本0.50'],
      ['筛管', '产能0.80 防砂0.85 成本0.62'],
      ['砾石充填', '产能0.70 防砂1.00 成本0.90']
    ];
    for (var i = 0; i < rows.length; i++) {
      var ry = y0 + i * 26;
      s += G.txt(x0, ry, rows[i][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(x0 + 90, ry, rows[i][1], { size: 8.2, fill: C.ink3 });
    }

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '方式的坑',
      ['· 产能高',
       '  → 不防砂',
       '· 防砂强',
       '  → 成本高',
       '',
       '多目标权衡',
       '无统一定义。'], 'jade');
    return { svg: s, stats: [{ k: '方式', v: '4 类' }, { k: '权衡', v: '产能/防砂/成本' }], note: '完井方式（裸眼、射孔、筛管、砾石充填）各有产能、防砂、成本属性。多目标权衡（产能、防砂、成本）下"最优"没有统一定义。' };
  }

  /* =========================================================
     ③ 知识图谱
     ========================================================= */
  function stage3(t) {
    var c = compute(), q = c.query;
    var s = '';
    s += G.panel(0, '① 储层特征', '节点', C.blue);
    s += G.panel(1, '② 完井方式', '关系', C.clay);
    s += G.panel(2, '③ 生产表现', '反馈', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '知识图谱 · 三元组', { size: 9.5, fill: C.ink2, weight: 700 });
    var triples = [
      ['出砂高', '→', '需防砂'],
      ['碳酸盐', '→', '可裸眼'],
      ['近水层', '→', '需封隔'],
      ['泥质', '→', '易出砂']
    ];
    for (var i = 0; i < triples.length; i++) {
      var ry = y0 + i * 26;
      s += G.rect(x0, ry, 64, 20, { r: 4, fill: C.blueL, stroke: '#c5d6ea' });
      s += G.txt(x0 + 32, ry + 14, triples[i][0], { size: 8, fill: C.blueD, anchor: 'middle' });
      s += G.txt(x0 + 78, ry + 14, triples[i][1], { size: 9, fill: C.ink3 });
      s += G.rect(x0 + 92, ry, 84, 20, { r: 4, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(x0 + 134, ry + 14, triples[i][2], { size: 8, fill: C.jadeD, anchor: 'middle' });
    }

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '图谱的坑',
      ['· 无关系',
       '  → 无法推荐',
       '· 无生产表现',
       '  → 无法验证',
       '',
       '储层→方式→表现',
       '组织关系。'], 'jade');
    return { svg: s, stats: [{ k: '图谱', v: '三元组' }, { k: '关系', v: '储层→方式→表现' }], note: '用知识图谱组织"储层特征—完井方式—生产表现"的关系，作为推理与推荐的知识底座。' };
  }

  /* =========================================================
     ④ 相似案例
     ========================================================= */
  function stage4(t) {
    var c = compute(), sims = c.sims;
    var s = '';
    s += G.panel(0, '① kNN', '距离', C.blue);
    s += G.panel(1, '② 前 k', sims.length + ' 井', C.clay);
    s += G.panel(2, '③ 众数', M.WAYS[c.bestWay], C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '相似案例 · kNN', { size: 9.5, fill: C.ink2, weight: 700 });
    for (var i = 0; i < sims.length; i++) {
      var sc = sims[i];
      var ry = y0 + i * 22;
      s += G.txt(x0, ry, '井' + sc.i + ' ' + M.LITHOS[sc.litho] + '·砂' + f(sc.sandIdx), { size: 8, fill: C.ink2 });
      s += G.rect(x0 + 130, ry - 8, 46, 15, { r: 3, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(x0 + 153, ry + 3, M.WAYS[sc.way], { size: 7.5, fill: C.jadeD, anchor: 'middle' });
      s += G.txt(x0 + 190, ry + 3, 'd' + f(sc.d, 1), { size: 7.5, fill: C.ink3 });
    }

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '推理的坑',
      ['· 无邻井',
       '  → 无法推理',
       '· 距离度量',
       '  → 要选对',
       '',
       'kNN 相似井',
       '取方式众数。'], 'jade');
    return { svg: s, stats: [{ k: '相似', v: sims.length + ' 井' }, { k: '众数', v: M.WAYS[c.bestWay] }], note: '案例推理按储层特征 kNN 找最相似历史井，取其完井方式与生产表现，作为候选方案的证据。' };
  }

  /* =========================================================
     ⑤ 多目标排序
     ========================================================= */
  function stage5(t) {
    var c = compute(), plans = c.plans;
    var s = '';
    s += G.panel(0, '① 产能', '↑', C.blue);
    s += G.panel(1, '② 防砂', '↑', C.clay);
    s += G.panel(2, '③ 成本', '↓', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '多目标排序', { size: 9.5, fill: C.ink2, weight: 700 });
    for (var i = 0; i < plans.length; i++) {
      var pl = plans[i];
      var ry = y0 + i * 26;
      s += G.txt(x0, ry, (i + 1) + '. ' + pl.k + (pl.pareto ? ' ★' : ''), { size: 8.8, fill: pl.pareto ? C.jadeD : C.ink2, weight: pl.pareto ? 700 : 400 });
      s += G.txt(x0 + 140, ry, '产能' + f(pl.q, 0) + ' 砂' + f(pl.sandRisk) + ' 本' + f(pl.cost), { size: 7.8, fill: C.ink3 });
    }

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '排序的坑',
      ['· 只看单目标',
       '  → 偏颇',
       '· 权重一刀切',
       '  → 不合现场',
       '',
       '多目标排序',
       '给候选集。'], 'clay');
    return { svg: s, stats: [{ k: '首选', v: plans[0].k }, { k: '帕累托', v: plans.filter(function (p) { return p.pareto; }).map(function (p) { return p.k; }).join('/') }], note: '对候选完井方式做多目标排序（产能↑、防砂↑、成本↓），输出候选集与帕累托方案。' };
  }

  /* =========================================================
     ⑥ 方案推荐
     ========================================================= */
  function stage6(t) {
    var c = compute(), plans = c.plans;
    var s = '';
    s += G.panel(0, '① 候选', '排序', C.blue);
    s += G.panel(1, '② 帕累托', '方案集', C.clay);
    s += G.panel(2, '③ 生产表现', '回流', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14;
    var rows = [
      ['首选', plans[0].k, '推荐'],
      ['帕累托', plans.filter(function (p) { return p.pareto; }).map(function (p) { return p.k; }).join(' / '), '方案集'],
      ['生产表现', '回流更新', '闭环']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 38;
      s += G.rect(x0, ry, 240, 30, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(x0 + 26, ry + 20, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(x0 + 140, ry + 20, rows[r][1], { size: 8.8, fill: C.jadeD });
    }
    s += G.txt(x0, y0 - 20, '方案推荐 · 回流', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '推荐的坑',
      ['· 不回流',
       '  → 图谱不更新',
       '· 只给单方案',
       '  → 无法权衡',
       '',
       '候选+帕累托',
       '生产表现回流。'], 'jade');
    return { svg: s, stats: [{ k: '首选', v: plans[0].k }, { k: '回流', v: '生产表现' }], note: '输出候选方案与相似案例，生产表现回流更新图谱，方案越用越准。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
