/* =========================================================
   测井曲线智能分层 · 算法解剖（序列分割 + 多曲线 + 邻井约束）
   ---------------------------------------------------------
   把「测井曲线 → 层位」拆成 6 步，每一步都跑真代码：

     ① 曲线接入        GR/SP/RT/DEN
     ② 变点检测        地层边界
     ③ 多曲线融合      薄互层界线
     ④ 邻井约束        层位一致
     ⑤ 分层复核        解释员复核
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
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (dash ? 1.6 : 2) + '"' + (dash ? ' stroke-dasharray="5 3"' : '') + '/>';
    return s;
  }

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.nData, L.segMode, L.sens, L.nbMode].join(',');
    if (cache.key === key) return cache;
    var d = M.genLog(100, 20261191);
    var cd = M.segDetect(d, L.segMode, L.sens);
    var mf = M.multiFuse(d);
    var nb = M.neighborConstrain(d, cd, L.nbMode);
    cache = { key: key, L: L, d: d, cd: cd, mf: mf, nb: nb };
    return cache;
  }

  /* =========================================================
     ① 曲线接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), d = c.d;
    var s = '';
    s += G.panel(0, '① GR/SP/RT/DEN', '测井曲线', C.blue);
    s += G.panel(1, '② 人工分层表', '30—50 井', C.clay);
    s += G.panel(2, '③ 邻井分层', '约束一致', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '测井曲线（GR/SP/RT/DEN）', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    d.seg.forEach(function (seg) {
      s += G.rect(G.COLS[0].x + 14 + seg.s * 240 / 100, y0, (seg.e - seg.s) * 240 / 100, h, { r: 0, fill: LCOL[seg.litho], op: 0.16 });
    });
    s += line(d.gr, G.COLS[0].x + 14, y0 + h, 240 / 100, h, C0, false);
    s += line(d.sp, G.COLS[0].x + 14, y0 + h, 240 / 100, h, C1, true);
    s += G.txt(G.COLS[0].x + 20, y0 - 2, 'GR', { size: 7.5, fill: C0 });
    s += G.txt(G.COLS[0].x + 56, y0 - 2, 'SP', { size: 7.5, fill: C1 });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '0.125 m 采样 · 5000—20000 点', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '曲线与分层',
      ['· GR/SP/RT/DEN 曲线',
       '· 人工分层表',
       '· 邻井分层约束',
       '',
       '只看单条曲线，',
       '薄互层被忽略。'], 'clay');
    return { svg: s, stats: [{ k: '曲线', v: 'GR/SP/RT/DEN' }, { k: '地层', v: d.seg.length + ' 层' }], note: '读入 GR/SP/RT/DEN 曲线与人工分层表。不结合多条曲线直接看单条，薄互层被忽略。' };
  }

  /* =========================================================
     ② 变点检测
     ========================================================= */
  function stage2(t) {
    var c = compute(), d = c.d, cd = c.cd, nb = c.nb;
    var s = '';
    s += G.panel(0, '① 测井曲线', '连续序列', C.blue);
    s += G.panel(1, '② 变点检测', '地层边界', C.jade);
    s += G.panel(2, '③ 层位', '自动分段', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '变点检测 · 命中 ' + nb.hit + '/' + nb.total, { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    d.seg.forEach(function (seg) {
      s += G.rect(G.COLS[0].x + 14 + seg.s * 240 / 100, y0, (seg.e - seg.s) * 240 / 100, h, { r: 0, fill: LCOL[seg.litho], op: 0.16 });
    });
    for (var i = 1; i < d.seg.length; i++) {
      var bx = G.COLS[0].x + 14 + d.seg[i].s * 240 / 100;
      s += G.line(bx, y0, bx, y0 + h, { stroke: C.ink, sw: 1.4, dash: '4 3' });
    }
    cd.bd.forEach(function (b) {
      var px = G.COLS[0].x + 14 + b.pos * 240 / 100;
      s += G.line(px, y0, px, y0 + h, { stroke: '#b05a51', sw: 1.6 });
    });
    s += line(d.gr, G.COLS[0].x + 14, y0 + h, 240 / 100, h, C0, false);
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '黑虚线=审定层位 · 红实线=检测', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '变点检测的坑',
      ['· 灵敏度太高',
       '  → 小波动当分层',
       '· 虚分层多、划碎',
       '',
       '滑窗均值差检测，',
       '阈值要稳。'], 'clay');
    return { svg: s, stats: [{ k: '命中', v: nb.hit + '/' + nb.total }, { k: '检测边界', v: cd.bd.length + ' 处' }], note: '在测井曲线上检测地层边界，替代手动分段。把曲线小波动当分层，虚分层多、层划碎。' };
  }

  /* =========================================================
     ③ 多曲线融合
     ========================================================= */
  function stage3(t) {
    var c = compute(), d = c.d, mf = c.mf;
    var s = '';
    s += G.panel(0, '① 单条曲线', '界线模糊', C.blue);
    s += G.panel(1, '② 多曲线融合', '联合判断', C.jade);
    s += G.panel(2, '③ 界线清楚', '差 0.5—1m↓', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '多曲线融合 · 薄互层 ' + mf.thinN + ' 层', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    d.seg.forEach(function (seg) {
      var wpx = (seg.e - seg.s) * 240 / 100;
      var bx = G.COLS[0].x + 14 + seg.s * 240 / 100;
      s += G.rect(bx, y0, wpx, h, { r: 0, fill: LCOL[seg.litho], op: seg.thick < 5 ? 0.55 : 0.16 });
      if (wpx > 20) s += G.txt(bx + wpx / 2, y0 + h / 2, M.LITHO[seg.litho], { size: 8, fill: '#fff', anchor: 'middle', weight: 700 });
    });
    s += line(d.gr, G.COLS[0].x + 14, y0 + h, 240 / 100, h, '#9ba3a9', true);
    s += line(mf.fusion, G.COLS[0].x + 14, y0 + h, 240 / 100, h, C2, false);
    s += G.txt(G.COLS[0].x + 20, y0 - 2, 'GR', { size: 7.5, fill: '#9ba3a9' });
    s += G.txt(G.COLS[0].x + 90, y0 - 2, '融合', { size: 7.5, fill: C2 });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '深色=薄互层(<5m) · 融合曲线界线清楚', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '多曲线融合的坑',
      ['· 只用单条曲线',
       '  → 薄互层界线模糊',
       '· 差 0.5—1m',
       '',
       'GR/SP/RT/DEN 联合，',
       '界线收窄。'], 'jade');
    return { svg: s, stats: [{ k: '薄互层', v: mf.thinN + ' 层' }, { k: '融合', v: 'GR+SP+RT+DEN' }], note: 'GR/SP/RT/DEN 多条曲线联合判断薄互层界线。只用单条曲线，薄互层界线模糊、差 0.5—1m。' };
  }

  /* =========================================================
     ④ 邻井约束
     ========================================================= */
  function stage4(t) {
    var c = compute(), d = c.d, nb = c.nb, L = c.L;
    var s = '';
    s += G.panel(0, '① 本井分层', '变点+融合', C.blue);
    s += G.panel(1, '② 邻井分层表', '约束', C.jade);
    s += G.panel(2, '③ 层位一致', '经验差异↓', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '邻井约束 · 命中 ' + nb.hit + '/' + nb.total + ' · 偏差 ' + nb.diffN, { size: 9.5, fill: C.ink2, weight: 700 });
    /* 本井层位（上排）与邻井层位（下排） */
    d.seg.forEach(function (seg) {
      var wpx = (seg.e - seg.s) * 240 / 100;
      var bx = G.COLS[0].x + 14 + seg.s * 240 / 100;
      s += G.rect(bx, y0, wpx, h / 2 - 6, { r: 0, fill: LCOL[seg.litho], op: 0.5 });
      s += G.rect(bx, y0 + h / 2, wpx, h / 2 - 6, { r: 0, fill: LCOL[seg.litho], op: 0.85 });
    });
    s += G.txt(G.COLS[0].x + 20, y0 + 14, '本井', { size: 7.5, fill: '#fff', weight: 700 });
    s += G.txt(G.COLS[0].x + 20, y0 + h / 2 + 14, '邻井', { size: 7.5, fill: '#fff', weight: 700 });
    for (var i = 1; i < d.seg.length; i++) {
      var bx2 = G.COLS[0].x + 14 + d.seg[i].s * 240 / 100;
      s += G.line(bx2, y0, bx2, y0 + h, { stroke: '#b05a51', sw: 1, dash: '3 3' });
    }
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, (L.nbMode === 1 ? '有约束' : '无约束') + ' · 上=本井 下=邻井', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '邻井约束的坑',
      ['· 不邻井约束',
       '  → 本井层位对不上',
       '· 人工经验差异',
       '',
       '邻井分层表约束，',
       '层位保持一致。'], 'jade');
    return { svg: s, stats: [{ k: '命中', v: nb.hit + '/' + nb.total }, { k: '偏差', v: nb.diffN + ' 处' }], note: '邻井分层表约束本井层位一致。不做邻井约束，本井层位与邻井对不上、不一致。' };
  }

  /* =========================================================
     ⑤ 分层复核
     ========================================================= */
  function stage5(t) {
    var c = compute(), nb = c.nb, mf = c.mf;
    var s = '';
    s += G.panel(0, '① 层位建议', '模型建议', C.blue);
    s += G.panel(1, '② 分层复核', '边界确认', C.clay);
    s += G.panel(2, '③ 一致性↑', '差 0.5—1m↓', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['层位命中', nb.hit + '/' + nb.total, '复核'],
      ['薄互层', mf.thinN + ' 层', '核对'],
      ['边界偏差', nb.diffN + ' 处', '剔掉']
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
       '  → 模型不知层位错',
       '· 永远差 0.5—1m',
       '',
       '复核结果要回流，',
       '层位越用越准。'], 'clay');
    return { svg: s, stats: [{ k: '命中', v: nb.hit + '/' + nb.total }, { k: '偏差', v: nb.diffN + ' 处' }], note: '地层边界给建议，测井解释员复核。复核结果不回流，模型不知道分层错在哪，永远差 0.5—1m。' };
  }

  /* =========================================================
     ⑥ 回流
     ========================================================= */
  function stage6(t) {
    var c = compute(), nb = c.nb;
    var s = '';
    s += G.panel(0, '① 层位建议', '模型输出', C.blue);
    s += G.panel(1, '② 复核回流', '确认修正', C.clay);
    s += G.panel(2, '③ 越用越准', '回流闭环', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['层位建议', '模型', '复核'],
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
       '  → 数据不增，一直差',
       '· 无法越用越准',
       '',
       '复核+邻井回流，',
       '分层持续变准。'], 'jade');
    return { svg: s, stats: [{ k: '命中', v: nb.hit + '/' + nb.total }, { k: '回流', v: '已闭环' }], note: '复核结果回流训练集，模型越用越准、层位偏差持续下降。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
