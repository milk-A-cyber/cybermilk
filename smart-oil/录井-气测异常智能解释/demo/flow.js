/* =========================================================
   气测异常智能解释 · 算法解剖（序列识别 + 流体判别 + 弱标签）
   ---------------------------------------------------------
   把「气测曲线 → 异常段/流体性质」拆成 6 步，每一步都跑真代码：

     ① 气测数据接入  全烃组分 + 工况参数
     ② 基线校正      去钻井液/工况干扰
     ③ 异常段识别    序列分类标出异常段
     ④ 流体判别      峰值+组分比 → 油/气/水层
     ⑤ 弱标签学习    试油真值校正
     ⑥ 解释复核      解释员复核 + 回流

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

  var N = 100;
  var C0 = '#41699b', C1 = '#b26a39', C2 = '#2f7d6b';
  var FCOL = ['#d8d2c4', '#7aa2c8', '#b26a39', '#c98a2b'];

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
    var key = [L.nData, L.corrMode, L.thr, L.fluidMode, L.weakMode].join(',');
    if (cache.key === key) return cache;
    var g = M.genGas(N, 20261171);
    var bc = M.baselineCorr(g, L.corrMode);
    var det = M.anomalyDetect(bc.corr, L.thr);
    var fc = M.fluidClassify(g, bc, det, L.fluidMode);
    var wl = M.weakLearn(g, bc, det, L.weakMode, L.thr);
    cache = { key: key, L: L, g: g, bc: bc, det: det, fc: fc, wl: wl };
    return cache;
  }

  /* =========================================================
     ① 气测数据接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), g = c.g;
    var s = '';
    s += G.panel(0, '① 气测全烃', '1—5 m 一点', C.blue);
    s += G.panel(1, '② 工况参数', '密度/排量/钻时', C.clay);
    s += G.panel(2, '③ 异常段标签', '200—500 段', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '原始气测曲线（受钻井液密度影响）', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    var gasArr = [], densArr = [];
    for (var i = 0; i < N; i++) { gasArr.push(g.gas[i] / 1.2); densArr.push((g.dens[i] - 1.1) / 0.2); }
    s += line(gasArr, G.COLS[0].x + 14, y0 + h, 240 / N, h, C0, false);
    s += line(densArr, G.COLS[0].x + 14, y0 + h, 240 / N, h, C2, true);
    s += G.txt(G.COLS[0].x + 20, y0 - 2, '气测', { size: 7.5, fill: C0 });
    s += G.txt(G.COLS[0].x + 56, y0 - 2, '密度', { size: 7.5, fill: C2 });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '密度上升 → 背景气抬升', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '数据形态',
      ['· 气测全烃/组分',
       '· 工况参数作校正',
       '· 异常段200—500段',
       '',
       '不结合工况直接看',
       '气测，接单根气会',
       '被当异常。'], 'clay');
    return { svg: s, stats: [{ k: '点数', v: g.n }, { k: '异常段', v: g.seg.length + ' 段' }], note: '读入气测全烃与组分、钻井液与工况参数。不结合工况参数直接看气测，接单根气等干扰被当成异常。' };
  }

  /* =========================================================
     ② 基线校正
     ========================================================= */
  function stage2(t) {
    var c = compute(), g = c.g, bc = c.bc, L = c.L;
    var s = '';
    s += G.panel(0, '① 原始气测', '基线漂移', C.blue);
    s += G.panel(1, '② 基线校正', '去干扰', C.jade);
    s += G.panel(2, '③ 异常凸显', '薄层不被掩盖', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '校正后气测 vs 基线', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    var gasArr = [], bgArr = [];
    for (var i = 0; i < N; i++) { gasArr.push(bc.corr[i] / 1.2); bgArr.push(bc.bg[i] / 1.2); }
    s += line(gasArr, G.COLS[0].x + 14, y0 + h, 240 / N, h, C0, false);
    if (L.corrMode === 1) s += line(bgArr, G.COLS[0].x + 14, y0 + h, 240 / N, h, '#7a8a9a', true);
    s += G.txt(G.COLS[0].x + 20, y0 - 2, '校正后', { size: 7.5, fill: C0 });
    s += G.txt(G.COLS[0].x + 74, y0 - 2, '基线', { size: 7.5, fill: '#7a8a9a' });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '基线校正把工况干扰拉平', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '基线校正的坑',
      ['· 不做校正',
       '  → 密度变化被当异常',
       '· 虚报警多',
       '',
       '用工况参数估计基线，',
       '去掉干扰。'], 'jade');
    return { svg: s, stats: [{ k: '校正', v: L.corrMode === 0 ? '未' : '已' }, { k: '干扰', v: L.corrMode === 1 ? '已抑制' : '残留' }], note: '用钻井液密度、脱气效率、工况参数校正气测基线，去掉干扰。不做基线校正，钻井液密度变化被当成异常，虚报警多。' };
  }

  /* =========================================================
     ③ 异常段识别
     ========================================================= */
  function stage3(t) {
    var c = compute(), bc = c.bc, det = c.det, L = c.L;
    var s = '';
    s += G.panel(0, '① 校正后气测', '连续序列', C.blue);
    s += G.panel(1, '② 序列分类', '异常段标出', C.jade);
    s += G.panel(2, '③ 异常段', '薄层不漏', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '异常段识别 · ' + det.seg.length + ' 段', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    det.seg.forEach(function (d) {
      s += G.rect(G.COLS[0].x + 14 + d.s * 240 / N, y0, (d.e - d.s) * 240 / N, h, { r: 0, fill: '#f7ece2', op: 0.55 });
    });
    var gasArr = [];
    for (var i = 0; i < N; i++) gasArr.push(bc.corr[i] / 1.2);
    s += line(gasArr, G.COLS[0].x + 14, y0 + h, 240 / N, h, C0, false);
    var ty = y0 + h - L.thr / 1.2 * h;
    s += G.line(G.COLS[0].x + 14, ty, G.COLS[0].x + 254, ty, { stroke: C1, sw: 1, dash: '5 4' });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '底色=异常段 · 橙色线=阈值', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '异常段的坑',
      ['· 把整段连续当异常',
       '  → 薄层局部峰值漏',
       '· 漏掉关键显示',
       '',
       '要按局部峰值识别，',
       '别用整段平均。'], 'clay');
    return { svg: s, stats: [{ k: '异常段', v: det.seg.length + ' 段' }, { k: '阈值', v: f(L.thr) }], note: '用序列分类在气测曲线上标出异常段，替代人工分段。把整段连续气测当异常，薄油气层的局部峰值被漏掉。' };
  }

  /* =========================================================
     ④ 流体性质判别
     ========================================================= */
  function stage4(t) {
    var c = compute(), fc = c.fc, bc = c.bc, L = c.L;
    var s = '';
    s += G.panel(0, '① 峰值形态', '总烃曲线', C.blue);
    s += G.panel(1, '② 组分比', '甲烷/重烃', C.jade);
    s += G.panel(2, '③ 油/气/水层', '性质建议', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '流体判别（' + (L.fluidMode === 0 ? '只看峰值' : '峰值+组分比') + '）', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    fc.seg.forEach(function (f) {
      var bx = G.COLS[0].x + 14 + f.s * 240 / N;
      var bw = (f.e - f.s) * 240 / N;
      var col = f.pred === f.fluid ? FCOL[f.fluid] : '#d0a3a3';
      s += G.rect(bx, y0, bw, h, { r: 0, fill: col, op: 0.55 });
      s += G.txt(bx + bw / 2, y0 + h / 2, M.FLUID[f.pred], { size: 8, fill: C.ink, anchor: 'middle', weight: 700 });
    });
    var gasArr = [];
    for (var i = 0; i < N; i++) gasArr.push(bc.corr[i] / 1.2);
    s += line(gasArr, G.COLS[0].x + 14, y0 + h, 240 / N, h, C0, false);
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '底色=判别性质（灰=判错）', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '流体判别的坑',
      ['· 只看峰值不看组分比',
       '  → 凝析气层误判油层',
       '· 流体性质搞错',
       '',
       '峰值+组分比联合判，',
       '别只靠一个量。'], 'jade');
    return { svg: s, stats: [{ k: '判对', v: fc.seg.filter(function (x) { return x.pred === x.fluid; }).length + '/' + fc.seg.length }, { k: '方式', v: L.fluidMode === 0 ? '峰值' : '峰值+组分比' }], note: '据峰值形态与组分比判油/气/水层。只看峰值高低不看组分比，凝析气层被误判成油层。' };
  }

  /* =========================================================
     ⑤ 弱标签学习
     ========================================================= */
  function stage5(t) {
    var c = compute(), wl = c.wl, L = c.L;
    var s = '';
    s += G.panel(0, '① 异常段标签', '样本少', C.blue);
    s += G.panel(1, '② 试油真值', '层段产能', C.clay);
    s += G.panel(2, '③ 弱标签校正', '样本少也学', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '弱标签学习 · 校正后准确 ' + Math.round(wl.adj * 100) + '%', { size: 9.5, fill: C.ink2, weight: 700 });
    var bw = (240 - 20) / Math.max(1, wl.n);
    for (var i = 0; i < wl.n; i++) {
      var d = wl.details[i], bx = G.COLS[0].x + 14 + i * bw + 3;
      var rows = [
        ['真值', M.FLUID[d.fluid], FCOL[d.fluid]],
        ['判别', M.FLUID[d.pred], d.ok ? FCOL[d.fluid] : '#d0a3a3'],
        ['校正后', M.FLUID[d.adjPred], d.adjOk ? FCOL[d.fluid] : '#d0a3a3']
      ];
      rows.forEach(function (r, ri) {
        var ry = y0 + ri * 30;
        s += G.rect(bx, ry, bw - 6, 24, { r: 3, fill: ri === 0 ? C.blueL : ri === 1 ? C.clayL : C.jadeL, stroke: r[2], sw: 1 });
        s += G.txt(bx + 5, ry + 16, r[0], { size: 7.5, fill: C.ink3 });
        s += G.txt(bx + (bw - 6) / 2, ry + 16, r[1], { size: 7.5, fill: C.ink, anchor: 'middle', weight: 700 });
      });
    }
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '每列=异常段：真值/判别/校正后', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '弱标签的坑',
      ['· 只靠异常段标签',
       '  → 样本少时判别漂移',
       '· 流体性质搞错',
       '',
       '用试油真值做弱标签，',
       '样本少也学。'], 'clay');
    return { svg: s, stats: [{ k: '校正前', v: Math.round(wl.acc * 100) + '%' }, { k: '校正后', v: Math.round(wl.adj * 100) + '%' }], note: '异常段样本少，用试油真值做弱标签校正。只靠异常段标签、不用试油真值校正，样本少时判别漂移。' };
  }

  /* =========================================================
     ⑥ 解释复核
     ========================================================= */
  function stage6(t) {
    var c = compute(), wl = c.wl, L = c.L;
    var s = '';
    s += G.panel(0, '① 异常段+性质', '模型建议', C.blue);
    s += G.panel(1, '② 解释员复核', '判别确认', C.clay);
    s += G.panel(2, '③ 一致性↑', '不漏薄层', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['异常段+性质', '模型建议', '复核'],
      ['判别确认', '解释员', '人工'],
      ['试油真值', '已回流', 'ok']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 38;
      s += G.rect(G.COLS[0].x + 14, ry, 240, 30, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(G.COLS[0].x + 26, ry + 20, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(G.COLS[0].x + 140, ry + 20, rows[r][1], { size: 8.8, fill: C.jadeD });
    }
    s += G.txt(G.COLS[0].x + 14, y0 - 20, '解释复核清单', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '复核的坑',
      ['· 复核不回流',
       '  → 模型不知判别错',
       '· 永远漏层',
       '',
       '复核+试油结果要回流，',
       '判别越用越准。'], 'clay');
    return { svg: s, stats: [{ k: '校正后准确', v: Math.round(wl.adj * 100) + '%' }, { k: '回流', v: '已闭环' }], note: '异常段与流体性质给建议，解释员只做复核。复核结果不回流，模型不知道判别错在哪，永远漏层。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
