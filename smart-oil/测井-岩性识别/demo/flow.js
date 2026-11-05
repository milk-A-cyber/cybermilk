/* =========================================================
   岩性识别 · 算法解剖（交会图基线 + 多曲线融合 + 序列分类）
   ---------------------------------------------------------
   把「测井 → 岩性」拆成 6 步，每一步都跑真代码：

     ① 测井与定名接入  常规+伽马能谱
     ② 交会图基线     GR×RT 固定边界
     ③ 多曲线融合     GR/RT/DEN/U
     ④ 序列分类       岩性序列
     ⑤ 薄片鉴定验证   定名核对
     ⑥ 回流           复核回流更准

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
  var COL = ['#b26a39', '#41699b', '#2f7d6b', '#b05a51', '#7a5aa8'];

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

  var N = 100;
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.xb, L.classMode].join(',');
    if (cache.key === key) return cache;
    var d = M.genLitho(N, 20261161);
    var cp = M.crossPlot(d, L.xb, 2.0);
    var cl0 = M.lithoClassify(d, 0);
    var cl1 = M.lithoClassify(d, 1);
    cache = { key: key, L: L, d: d, cp: cp, cl0: cl0, cl1: cl1 };
    return cache;
  }

  /* =========================================================
     ① 测井与定名接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), d = c.d;
    var s = '';
    s += G.panel(0, '① 常规测井', 'GR/SP/RT/DEN', C.blue);
    s += G.panel(1, '② 伽马能谱', 'U/Th/K', C.clay);
    s += G.panel(2, '③ 定名', '岩心/岩屑', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '测井曲线 · 岩性定名', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    s += line(d.gr, G.COLS[0].x + 14, y0 + h, 240 / N, h / 3, C0, false);
    s += line(d.u.map(function (v) { return v / 6; }), G.COLS[0].x + 14, y0 + h, 240 / N, h, C1, true);
    s += G.txt(G.COLS[0].x + 20, y0 - 2, 'GR', { size: 7.5, fill: C0 });
    s += G.txt(G.COLS[0].x + 90, y0 - 2, 'U(能谱)', { size: 7.5, fill: C1 });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '蓝=GR · 橙=伽马能谱U', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '测井+定名的数据',
      ['· 常规测井',
       '· 伽马能谱',
       '· 定名 100—300 层点',
       '',
       '交会图多解性强，',
       '复杂岩性难分。'], 'clay');
    return { svg: s, stats: [{ k: '层点', v: N }, { k: '岩性', v: M.LITHO.length + ' 类' }], note: '读入常规测井+伽马能谱，岩心/岩屑定名 100—300 层点。交会图多解性强，复杂岩性固定边界误差大。' };
  }

  /* =========================================================
     ② 交会图基线
     ========================================================= */
  function stage2(t) {
    var c = compute(), d = c.d, cp = c.cp, L = c.L;
    var s = '';
    s += G.panel(0, '① GR×RT', '交会图', C.blue);
    s += G.panel(1, '② 固定边界', '阈值切分', C.jade);
    s += G.panel(2, '③ 分类', 'Acc=' + f(cp.acc), C.clay);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '交会图基线 · Acc=' + f(cp.acc) + ' · 判错 ' + cp.errs.length, { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.rect(x0, y0, xw, h, { r: 0, fill: '#fbfaf6', stroke: '#e9e4d8' });
    var gx = x0 + L.xb / 3 * xw, gy = y0 + h - 2.0 / 3.2 * h;
    s += G.line(gx, y0, gx, y0 + h, { stroke: '#9ba3a9', dash: [4, 3] });
    s += G.line(x0, gy, x0 + xw, gy, { stroke: '#9ba3a9', dash: [4, 3] });
    for (var i = 0; i < d.n; i++) {
      var px = x0 + d.gr[i] / 3 * xw, py = y0 + h - d.rt[i] / 3.2 * h;
      var ok = cp.pred[i] === d.litho[i];
      s += G.circle(px, py, 2.6, { fill: COL[d.litho[i]] });
      if (!ok) s += G.circle(px, py, 3.4, { fill: 'none', stroke: '#b05a51', sw: 1.3 });
    }
    s += G.txt(x0, y0 + h + 22, '红圈=固定边界判错', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '交会图的坑',
      ['· 多解性强',
       '  → 灰岩/白云岩重叠',
       '· 固定边界',
       '  → 复杂岩性误差大',
       '',
       '多曲线融合',
       '比固定边界更准。'], 'jade');
    return { svg: s, stats: [{ k: 'Acc', v: f(cp.acc) }, { k: '判错', v: cp.errs.length }], note: 'GR×RT 交会图固定边界分类。多解性强，灰岩/白云岩重叠，复杂岩性固定边界误差大。' };
  }

  /* =========================================================
     ③ 多曲线融合
     ========================================================= */
  function stage3(t) {
    var c = compute(), d = c.d, cl0 = c.cl0, cl1 = c.cl1;
    var s = '';
    s += G.panel(0, '① 单曲线', 'GR', C.blue);
    s += G.panel(1, '② 多曲线融合', 'GR/RT/DEN/U', C.jade);
    s += G.panel(2, '③ 准确率', f(cl0.acc) + '→' + f(cl1.acc), C.clay);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '多曲线融合 · 单曲线 Acc=' + f(cl0.acc) + ' → 融合 ' + f(cl1.acc), { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.rect(x0, y0, xw, h, { r: 0, fill: '#fbfaf6', stroke: '#e9e4d8' });
    for (var i = 0; i < d.n; i++) {
      var bx = x0 + i * xw / N, bw = xw / N + 0.4;
      s += G.rect(bx, y0, bw, h, { r: 0, fill: COL[d.litho[i]] });
    }
    s += G.txt(x0, y0 + h + 22, '岩性条带 · 真值', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '融合的收益',
      ['· 单曲线信息有限',
       '  → 岩性难分',
       '· 多曲线融合',
       '  → GR/RT/DEN/U',
       '',
       '准确率更高，',
       '复杂岩性更稳。'], 'jade');
    return { svg: s, stats: [{ k: '单曲线', v: f(cl0.acc) }, { k: '多曲线', v: f(cl1.acc) }], note: '多曲线融合用 GR/RT/DEN/U 联合判岩性。单曲线信息有限，多曲线融合更准、复杂岩性更稳。' };
  }

  /* =========================================================
     ④ 序列分类
     ========================================================= */
  function stage4(t) {
    var c = compute(), d = c.d, L = c.L;
    var cl = L.classMode === 0 ? c.cl0 : c.cl1;
    var s = '';
    s += G.panel(0, '① 测井序列', '多曲线', C.blue);
    s += G.panel(1, '② 序列分类', '每点判岩性', C.jade);
    s += G.panel(2, '③ 结果', 'Acc=' + f(cl.acc), C.clay);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '序列分类 · ' + (L.classMode === 0 ? '单曲线' : '多曲线') + ' · Acc=' + f(cl.acc), { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.rect(x0, y0, xw, h, { r: 0, fill: '#fbfaf6', stroke: '#e9e4d8' });
    for (var i = 0; i < d.n; i++) {
      var bx = x0 + i * xw / N, bw = xw / N + 0.4;
      var ok = cl.pred[i] === d.litho[i];
      s += G.rect(bx, y0, bw, h, { r: 0, fill: COL[d.litho[i]] });
      if (!ok) s += G.rect(bx, y0, bw, h, { r: 0, fill: 'none', stroke: '#b05a51', sw: 1.1 });
    }
    s += G.txt(x0, y0 + h + 22, '红边=判错待薄片鉴定', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '序列分类的坑',
      ['· 复杂岩性',
       '  → 边界难定',
       '· 多解性',
       '  → 判错',
       '',
       '薄片鉴定验证，',
       '复核修正。'], 'jade');
    return { svg: s, stats: [{ k: 'Acc', v: f(cl.acc) }, { k: '判错', v: cl.errs.length }], note: '序列分类逐点判岩性。复杂岩性边界难定、多解性导致判错，需薄片鉴定验证复核。' };
  }

  /* =========================================================
     ⑤ 薄片鉴定验证
     ========================================================= */
  function stage5(t) {
    var c = compute(), cl1 = c.cl1;
    var s = '';
    s += G.panel(0, '① 识别结果', '模型建议', C.blue);
    s += G.panel(1, '② 薄片鉴定', '定名核对', C.clay);
    s += G.panel(2, '③ 复核清单', '判错 ' + cl1.errs.length, C.jade);

    var y0 = 130, h = 110;
    var bySeg = {}, shown = 0;
    cl1.errs.forEach(function (e) {
      var key = e.idx + '';
      if (!bySeg[key] && shown < 6) { bySeg[key] = e; shown++; }
    });
    var i = 0;
    Object.keys(bySeg).forEach(function (k) {
      var e = bySeg[k];
      var ry = y0 + i * 18;
      s += G.txt(G.COLS[0].x + 14, ry + 10, '#' + e.idx + ' · ' + M.LITHO[e.pred] + ' ✗ 应' + M.LITHO[e.true], { size: 8.5, fill: '#b05a51' });
      i++;
    });
    if (!shown) s += G.txt(G.COLS[0].x + 14, y0 + 10, '无判错，全部符合', { size: 8.5, fill: C.jadeD });
    s += G.txt(G.COLS[0].x + 14, y0 - 18, '薄片鉴定验证清单', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '验证的坑',
      ['· 验证不回流',
       '  → 模型不知判错',
       '· 复杂岩性永远误差',
       '',
       '薄片定名回流，',
       '识别越用越准。'], 'clay');
    return { svg: s, stats: [{ k: '判错', v: cl1.errs.length + ' 点' }, { k: '待复核', v: Math.min(shown, 6) }], note: '岩性识别结果给建议，薄片鉴定验证复核。验证不回流，模型不知道判错在哪，复杂岩性永远误差。' };
  }

  /* =========================================================
     ⑥ 回流
     ========================================================= */
  function stage6(t) {
    var c = compute(), cl1 = c.cl1;
    var s = '';
    s += G.panel(0, '① 识别建议', '模型输出', C.blue);
    s += G.panel(1, '② 薄片回流', '确认修正', C.clay);
    s += G.panel(2, '③ 越用越准', '回流闭环', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['识别建议', '模型', '复核'],
      ['薄片鉴定', '人工', '修正'],
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
       '  → 数据不增，一直判错',
       '· 无法越用越准',
       '',
       '薄片定名回流，',
       '识别持续变准。'], 'jade');
    return { svg: s, stats: [{ k: '判错', v: cl1.errs.length + ' 点' }, { k: '回流', v: '已闭环' }], note: '薄片鉴定定名结果回流训练集，模型越用越准、复杂岩性识别持续改善。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
