/* =========================================================
   钻时曲线地层划分 · 算法解剖（参数归一化 + 变点检测 + 多源）
   ---------------------------------------------------------
   把「钻时曲线 → 地层边界」拆成 6 步，每一步都跑真代码：

     ① 钻时数据接入  钻时 + 工况参数
     ② 参数归一化    去工况干扰
     ③ 变点检测      地层边界
     ④ 多源验证      岩屑气测佐证
     ⑤ 分层复核      录井工复核
     ⑥ 回流          复核回流更准

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

  var N = 120;
  var C0 = '#41699b', C1 = '#b26a39', C2 = '#2f7d6b';
  var LCOL = ['#b26a39', '#c98a2b', '#7a8a9a', '#5a4a3a'];

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
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (dash ? 1.8 : 2) + '"' + (dash ? ' stroke-dasharray="5 3"' : '') + '/>';
    return s;
  }

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.nData, L.normMode, L.sens, L.verifyMode].join(',');
    if (cache.key === key) return cache;
    var d = M.genROP(N, 20261191);
    var ropN = M.ropNorm(d, L.normMode);
    var cd = M.changeDetect(ropN, L.sens);
    var bm = M.boundaryMatch(d, cd, 8);
    var cv = M.crossVerify(d, cd, L.verifyMode);
    cache = { key: key, L: L, d: d, ropN: ropN, cd: cd, bm: bm, cv: cv };
    return cache;
  }

  /* =========================================================
     ① 钻时数据接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), d = c.d;
    var s = '';
    s += G.panel(0, '① 钻时曲线', '0.5—1 m 一点', C.blue);
    s += G.panel(1, '② 钻井参数', '钻压/转速/排量', C.clay);
    s += G.panel(2, '③ 岩屑气测', '交叉验证', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '原始钻时曲线（受工况影响）', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    var ropArr = [], wArr = [];
    for (var i = 0; i < N; i++) { ropArr.push(d.rop[i] / 20); wArr.push((d.w[i] - 6) / 8); }
    s += line(ropArr, G.COLS[0].x + 14, y0 + h, 240 / N, h, C0, false);
    s += line(wArr, G.COLS[0].x + 14, y0 + h, 240 / N, h, C2, true);
    s += G.txt(G.COLS[0].x + 20, y0 - 2, '钻时', { size: 7.5, fill: C0 });
    s += G.txt(G.COLS[0].x + 56, y0 - 2, '钻压', { size: 7.5, fill: C2 });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '钻压/转速/排量都影响钻时', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '数据形态',
      ['· 钻时曲线',
       '· 钻压/转速/排量',
       '· 岩屑气测佐证',
       '',
       '不结合工况看钻时，',
       '钻压变化被当地层',
       '变化。'], 'clay');
    return { svg: s, stats: [{ k: '点数', v: d.n }, { k: '地层', v: d.seg.length + ' 段' }], note: '读入钻时曲线与钻井参数（钻压/转速/排量）。不结合钻井参数直接看钻时，钻压变化被当成地层变化。' };
  }

  /* =========================================================
     ② 参数归一化
     ========================================================= */
  function stage2(t) {
    var c = compute(), d = c.d, ropN = c.ropN, L = c.L;
    var s = '';
    s += G.panel(0, '① 原始钻时', '工况干扰', C.blue);
    s += G.panel(1, '② 参数归一化', '去干扰', C.jade);
    s += G.panel(2, '③ 可钻性凸显', '边界清楚', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '归一化前后钻时对比', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    d.seg.forEach(function (seg) {
      s += G.rect(G.COLS[0].x + 14 + seg.s * 240 / N, y0, (seg.e - seg.s) * 240 / N, h, { r: 0, fill: LCOL[seg.litho], op: 0.13 });
    });
    var raw = [], norm = [];
    for (var i = 0; i < N; i++) { raw.push(d.rop[i] / 20); norm.push(ropN[i] / 20); }
    s += line(raw, G.COLS[0].x + 14, y0 + h, 240 / N, h, '#9ba3a9', true);
    s += line(norm, G.COLS[0].x + 14, y0 + h, 240 / N, h, C0, false);
    s += G.txt(G.COLS[0].x + 20, y0 - 2, '原始', { size: 7.5, fill: '#9ba3a9' });
    s += G.txt(G.COLS[0].x + 64, y0 - 2, '归一化', { size: 7.5, fill: C0 });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '归一化后地层边界清楚', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '参数归一化的坑',
      ['· 不归一化',
       '  → 钻压大→钻时短',
       '· 误当变软',
       '',
       '用钻压/转速/排量',
       '校正钻时。'], 'jade');
    return { svg: s, stats: [{ k: '归一化', v: L.normMode === 0 ? '未' : '已' }, { k: '钻压均值', v: f(d.w.reduce(function (a, b) { return a + b; }, 0) / d.n, 1) }], note: '用钻压/转速/排量校正钻时，去掉工况干扰。不做归一化，钻压加大导致钻时变短被当成地层变软。' };
  }

  /* =========================================================
     ③ 变点检测
     ========================================================= */
  function stage3(t) {
    var c = compute(), d = c.d, ropN = c.ropN, cd = c.cd, bm = c.bm, L = c.L;
    var s = '';
    s += G.panel(0, '① 归一化钻时', '连续序列', C.blue);
    s += G.panel(1, '② 变点检测', '地层边界', C.jade);
    s += G.panel(2, '③ 边界命中', '命中 ' + bm.hit + '/' + bm.total, C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '变点检测 · 命中 ' + bm.hit + '/' + bm.total + ' · 虚分层 ' + bm.extra, { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    d.seg.forEach(function (seg) {
      s += G.rect(G.COLS[0].x + 14 + seg.s * 240 / N, y0, (seg.e - seg.s) * 240 / N, h, { r: 0, fill: LCOL[seg.litho], op: 0.13 });
    });
    for (var i = 1; i < d.seg.length; i++) {
      var bx = G.COLS[0].x + 14 + d.seg[i].s * 240 / N;
      s += G.line(bx, y0, bx, y0 + h, { stroke: C.ink, sw: 1.4, dash: '4 3' });
    }
    cd.bd.forEach(function (b) {
      var px = G.COLS[0].x + 14 + b.pos * 240 / N;
      s += G.line(px, y0, px, y0 + h, { stroke: '#b05a51', sw: 1.6 });
    });
    var norm = [];
    for (i = 0; i < N; i++) norm.push(ropN[i] / 20);
    s += line(norm, G.COLS[0].x + 14, y0 + h, 240 / N, h, C0, false);
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '黑虚线=真实边界 · 红实线=检测', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '变点检测的坑',
      ['· 灵敏度太高',
       '  → 小波动当分层',
       '· 虚分层多、划碎',
       '',
       '滑窗均值差检测，',
       '阈值要稳。'], 'clay');
    return { svg: s, stats: [{ k: '命中', v: bm.hit + '/' + bm.total }, { k: '灵敏度', v: f(L.sens, 1) }], note: '在归一化钻时曲线上检测地层边界，替代手动分段。把钻时小波动当成分层，虚分层多、地层划碎。' };
  }

  /* =========================================================
     ④ 多源验证
     ========================================================= */
  function stage4(t) {
    var c = compute(), d = c.d, cv = c.cv, L = c.L;
    var s = '';
    s += G.panel(0, '① 地层边界', '变点检测', C.blue);
    s += G.panel(1, '② 岩屑岩性', '交叉验证', C.jade);
    s += G.panel(2, '③ 气测曲线', '多源佐证', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '多源验证 · ' + (cv.total ? Math.round(cv.agree / cv.total * 100) : 0) + '% 一致' + (L.verifyMode === 1 ? ' · 多源' : ' · 仅钻时'), { size: 9.5, fill: C.ink2, weight: 700 });
    var bw = (240 - 20) / Math.max(1, cv.total);
    for (var i = 0; i < cv.total; i++) {
      var seg = cv.segs[i], bx = G.COLS[0].x + 14 + i * bw + 3;
      var rows = [
        ['钻时', M.LITHO[seg.litho], seg.litho === d.seg[i].litho ? LCOL[seg.litho] : '#d0a3a3'],
        ['岩屑', M.LITHO[d.seg[i].litho], LCOL[d.seg[i].litho]]
      ];
      rows.forEach(function (r, ri) {
        var ry = y0 + ri * 30;
        s += G.rect(bx, ry, bw - 6, 24, { r: 3, fill: ri === 0 ? C.blueL : C.jadeL, stroke: r[2], sw: 1 });
        s += G.txt(bx + 5, ry + 16, r[0], { size: 7.5, fill: C.ink3 });
        s += G.txt(bx + (bw - 6) / 2, ry + 16, r[1], { size: 7.5, fill: C.ink, anchor: 'middle', weight: 700 });
      });
    }
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '每列=一层：钻时判/岩屑佐证', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '多源验证的坑',
      ['· 不迟到校正',
       '  → 深度错位',
       '· 验证错层',
       '',
       '岩屑+气测佐证，',
       '迟到校正对齐。'], 'jade');
    return { svg: s, stats: [{ k: '一致', v: (cv.total ? Math.round(cv.agree / cv.total * 100) : 0) + '%' }, { k: '来源', v: L.verifyMode === 0 ? '钻时' : '钻时+岩屑' }], note: '用岩屑岩性与气测曲线验证分层，迟到时间校正对齐。不做迟到校正，岩屑深度与钻时深度错位，验证错层。' };
  }

  /* =========================================================
     ⑤ 分层复核
     ========================================================= */
  function stage5(t) {
    var c = compute(), bm = c.bm, cv = c.cv;
    var s = '';
    s += G.panel(0, '① 地层边界', '模型建议', C.blue);
    s += G.panel(1, '② 分层复核', '边界确认', C.clay);
    s += G.panel(2, '③ 一致性↑', '不错层', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['地层边界', bm.hit + '/' + bm.total + ' 命中', '复核'],
      ['多源一致', (cv.total ? Math.round(cv.agree / cv.total * 100) : 0) + '%', '佐证'],
      ['虚分层', bm.extra + ' 处', '剔掉']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 38;
      s += G.rect(G.COLS[0].x + 14, ry, 240, 30, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(G.COLS[0].x + 26, ry + 20, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(G.COLS[0].x + 150, ry + 20, rows[r][1], { size: 8.8, fill: C.jadeD });
    }
    s += G.txt(G.COLS[0].x + 14, y0 - 20, '分层复核清单', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '分层复核的坑',
      ['· 复核不回流',
       '  → 模型不知分层错',
       '· 永远错层',
       '',
       '复核结果要回流，',
       '分层越用越准。'], 'clay');
    return { svg: s, stats: [{ k: '命中', v: bm.hit + '/' + bm.total }, { k: '虚分层', v: bm.extra + ' 处' }], note: '地层边界给建议，录井工复核。复核结果不回流，模型不知道分层错在哪，永远错层。' };
  }

  /* =========================================================
     ⑥ 回流
     ========================================================= */
  function stage6(t) {
    var c = compute(), bm = c.bm;
    var s = '';
    s += G.panel(0, '① 边界建议', '模型输出', C.blue);
    s += G.panel(1, '② 复核回流', '确认修正', C.clay);
    s += G.panel(2, '③ 越用越准', '回流闭环', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['边界建议', '模型', '复核'],
      ['复核确认', '人工', '修正'],
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
       '  → 数据不增，一直错层',
       '· 无法越用越准',
       '',
       '复核+岩屑回流，',
       '分层持续变准。'], 'jade');
    return { svg: s, stats: [{ k: '命中', v: bm.hit + '/' + bm.total }, { k: '回流', v: '已闭环' }], note: '复核结果回流训练集，模型越用越准、错层持续下降。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
