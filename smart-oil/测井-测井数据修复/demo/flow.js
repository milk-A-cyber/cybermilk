/* =========================================================
   测井数据修复 · 算法解剖（缺失识别 + 掩码自编码 + 跨曲线生成）
   ---------------------------------------------------------
   把「修复测井 → 可解释」拆成 6 步，每一步都跑真代码：

     ① 多曲线接入    缺失段 + 异常跳变
     ② 缺失/异常识别 阈值检测 + 异常置信度
     ③ 掩码重建      邻点插值补全
     ④ 跨曲线生成    邻井参考补全
     ⑤ 井径工程验证  井况核对
     ⑥ 回流          修复结果回流

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
    var key = [L.xthr, L.imode].join(',');
    if (cache.key === key) return cache;
    var d = M.genLogMissing(N, 20261171);
    var det0 = M.detectAnomaly(d, 0, L.xthr);
    var det1 = M.detectAnomaly(d, 1, L.xthr);
    var imp0 = M.impute(d, 0);
    var imp1 = M.impute(d, 1);
    cache = { key: key, L: L, d: d, det0: det0, det1: det1, imp0: imp0, imp1: imp1 };
    return cache;
  }

  /* =========================================================
     ① 多曲线接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), d = c.d;
    var s = '';
    s += G.panel(0, '① 多曲线', 'GR/RT/DEN', C.blue);
    s += G.panel(1, '② 缺失+异常', '标记', C.clay);
    s += G.panel(2, '③ 邻井+工程', '参考', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '测井曲线 · 缺失与异常', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    s += line(d.gr, G.COLS[0].x + 14, y0 + h, 240 / N, h / 3, C0, false);
    s += line(d.refGr, G.COLS[0].x + 14, y0 + h, 240 / N, h / 3, C1, true);
    s += G.txt(G.COLS[0].x + 20, y0 - 2, 'GR', { size: 7.5, fill: C0 });
    s += G.txt(G.COLS[0].x + 90, y0 - 2, '邻井参考', { size: 7.5, fill: C1 });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '蓝=GR · 橙=邻井参考 · 缺失段挖空', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '要修复的数据',
      ['· 多曲线测井全井段',
       '· 人工标记异常段',
       '· 邻井同期曲线参考',
       '',
       '缺失段补值无依据，',
       '物理一致性难保证。'], 'clay');
    return { svg: s, stats: [{ k: '层点', v: N }, { k: '缺失', v: d.mask.reduce(function (a, b) { return a + b; }, 0) + ' 点' }], note: '读入多曲线测井（含缺失段与异常跳变）、邻井同期曲线与井径工程记录。缺失段人工补值无依据，异常段肉眼识别易漏，物理一致性难保证。' };
  }

  /* =========================================================
     ② 缺失/异常识别
     ========================================================= */
  function stage2(t) {
    var c = compute(), d = c.d, det1 = c.det1, L = c.L;
    var s = '';
    s += G.panel(0, '① 缺失+异常', '标记', C.blue);
    s += G.panel(1, '② 阈值检测', '异常置信度', C.jade);
    s += G.panel(2, '③ 检测', 'Acc=' + f(det1.acc), C.clay);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '缺失/异常识别 · Acc=' + f(det1.acc) + ' · 判错 ' + det1.errs.length, { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    s += line(d.gr, x0, y0 + h, xw / N, h / 3, C0, false);
    for (var i = 0; i < d.n; i++) {
      if (d.mask[i] === 1) s += G.rect(x0 + i * xw / N, y0, xw / N + 0.6, h, { r: 0, fill: '#f3e3d8' });
      if (d.anomaly[i] === 1) s += G.circle(x0 + i * xw / N, y0 + h - d.gr[i] / 3 * h, 3, { fill: 'none', stroke: '#b05a51', sw: 1.4 });
    }
    s += G.txt(x0, y0 + h + 22, '红圈=异常跳变 · 橙底=缺失段', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '识别的坑',
      ['· 肉眼识别易漏',
       '  → 异常跳变',
       '· 阈值过高',
       '  → 漏检',
       '',
       '异常置信度',
       '给修复打分。'], 'jade');
    return { svg: s, stats: [{ k: 'Acc', v: f(det1.acc) }, { k: '判错', v: det1.errs.length }], note: '阈值检测缺失/异常段并给异常置信度。肉眼识别异常易漏，阈值过高会漏检。' };
  }

  /* =========================================================
     ③ 掩码重建（邻点插值）
     ========================================================= */
  function stage3(t) {
    var c = compute(), d = c.d, imp0 = c.imp0;
    var s = '';
    s += G.panel(0, '① 掩码', '缺失段', C.blue);
    s += G.panel(1, '② 掩码重建', '邻点插值', C.jade);
    s += G.panel(2, '③ 重建误差', f(imp0.mae, 3), C.clay);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '掩码重建（邻点插值）· 误差=' + f(imp0.mae, 3), { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    s += line(d.origGr, x0, y0 + h, xw / N, h / 3, '#d8dbdd', false);
    s += line(imp0.gr, x0, y0 + h, xw / N, h / 3, C2, false);
    for (var i = 0; i < d.n; i++) {
      if (d.mask[i] === 1) s += G.rect(x0 + i * xw / N - 1, y0 + 4, 3, h - 8, { r: 0, fill: '#b26a39', opacity: 0.5 });
    }
    s += G.txt(x0, y0 + h + 22, '绿=补全 · 灰=真值 · 橙=缺失段', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '邻点插值的坑',
      ['· 缺失段长',
       '  → 插值不准',
       '· 忽略物理一致性',
       '',
       '跨曲线生成',
       '补得更准。'], 'jade');
    return { svg: s, stats: [{ k: '误差', v: f(imp0.mae, 3) }, { k: '待复核', v: imp0.errs.length }], note: '掩码自编码邻点插值补全缺失段。缺失段长时插值不准，且忽略曲线间物理一致性。' };
  }

  /* =========================================================
     ④ 跨曲线生成（邻井参考）
     ========================================================= */
  function stage4(t) {
    var c = compute(), d = c.d, imp0 = c.imp0, imp1 = c.imp1;
    var s = '';
    s += G.panel(0, '① 邻井参考', '跨曲线', C.blue);
    s += G.panel(1, '② 跨曲线生成', '映射补全', C.jade);
    s += G.panel(2, '③ 误差对比', f(imp0.mae, 3) + '→' + f(imp1.mae, 3), C.clay);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '跨曲线生成 · 邻点 ' + f(imp0.mae, 3) + ' → 跨曲线 ' + f(imp1.mae, 3), { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    s += line(d.refGr, x0, y0 + h, xw / N, h / 3, '#b8c2c9', true);
    s += line(imp1.gr, x0, y0 + h, xw / N, h / 3, C2, false);
    for (var i = 0; i < d.n; i++) {
      if (d.mask[i] === 1) s += G.rect(x0 + i * xw / N - 1, y0 + 4, 3, h - 8, { r: 0, fill: '#b26a39', opacity: 0.5 });
    }
    s += G.txt(x0, y0 + h + 22, '绿=跨曲线补全 · 灰点线=邻井参考', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '跨曲线生成的坑',
      ['· 邻井非同井',
       '  → 有差异',
       '· 井径异常',
       '  → 干扰',
       '',
       '井径工程记录，',
       '辅助判断原因。'], 'jade');
    return { svg: s, stats: [{ k: '邻点误差', v: f(imp0.mae, 3) }, { k: '跨曲线误差', v: f(imp1.mae, 3) }], note: '跨曲线生成用邻井参考映射补全缺失段。邻井非同井有差异，井径异常会干扰，需井径工程记录辅助。' };
  }

  /* =========================================================
     ⑤ 井径工程验证
     ========================================================= */
  function stage5(t) {
    var c = compute(), d = c.d, imp1 = c.imp1;
    var s = '';
    s += G.panel(0, '① 补全结果', '跨曲线', C.blue);
    s += G.panel(1, '② 井径工程', '井况核对', C.clay);
    s += G.panel(2, '③ 复核清单', '判错 ' + imp1.errs.length, C.jade);

    var y0 = 130, h = 110;
    var shown = 0;
    imp1.errs.forEach(function (e) {
      if (shown < 6) {
        var ry = y0 + shown * 18;
        s += G.txt(G.COLS[0].x + 14, ry + 10, '#' + e.idx + ' · 置信 ' + e.conf + ' 待复核', { size: 8.5, fill: '#b05a51' });
        shown++;
      }
    });
    if (!shown) s += G.txt(G.COLS[0].x + 14, y0 + 10, '无待复核，补全可信', { size: 8.5, fill: C.jadeD });
    s += G.txt(G.COLS[0].x + 14, y0 - 18, '井径工程验证清单', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '验证的坑',
      ['· 修复不回流',
       '  → 不知补错',
       '· 无真值',
       '  → 靠下游判断',
       '',
       '修复结果回流，',
       '越补越准。'], 'clay');
    return { svg: s, stats: [{ k: '待复核', v: Math.min(shown, 6) + ' 段' }, { k: '跨曲线误差', v: f(imp1.mae, 3) }], note: '井径工程记录核对补全段井况。修复不回流，不知道补错在哪；无真值时评价只能靠下游解释效果间接判断。' };
  }

  /* =========================================================
     ⑥ 回流
     ========================================================= */
  function stage6(t) {
    var c = compute(), imp1 = c.imp1;
    var s = '';
    s += G.panel(0, '① 修复建议', '模型输出', C.blue);
    s += G.panel(1, '② 井况回流', '确认修正', C.clay);
    s += G.panel(2, '③ 越修越准', '回流闭环', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['修复建议', '模型', '复核'],
      ['井况确认', '人工', '修正'],
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
       '  → 数据不增，一直补错',
       '· 无法越修越准',
       '',
       '修复结果回流，',
       '补全持续变准。'], 'jade');
    return { svg: s, stats: [{ k: '待复核', v: imp1.errs.length + ' 段' }, { k: '回流', v: '已闭环' }], note: '井径工程确认结果回流训练集，修复模型越修越准、补全持续改善。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
