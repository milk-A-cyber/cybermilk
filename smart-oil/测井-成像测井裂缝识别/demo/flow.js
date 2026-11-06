/* =========================================================
   成像测井裂缝识别 · 算法解剖（语义分割 + 细长目标 + 诱导缝鉴别）
   ---------------------------------------------------------
   把「成像图 → 裂缝」拆成 6 步，每一步都跑真代码：

     ① 成像图接入   电成像/声成像
     ② 语义分割     裂缝像元
     ③ 细长目标检测 裂缝形态
     ④ 诱导缝鉴别   天然/诱导
     ⑤ 岩心验证     岩心描述核对
     ⑥ 回流         复核回流更准

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

  /* 成像图网格（放在给定面板内） */
  function grid(svg, img, x0, y0, w, h, over) {
    var W = img.W, H = img.H, cw = w / W, ch = h / H;
    var s = '';
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var v = img.cells[y * W + x];
        var g = Math.round(clamp(v, 0, 1) * 200);
        var fill = 'rgb(' + g + ',' + g + ',' + g + ')';
        if (over && over[y * W + x] === 1) fill = 'rgba(178,106,57,0.85)';
        s += '<rect x="' + (x0 + x * cw).toFixed(1) + '" y="' + (y0 + y * ch).toFixed(1) + '" width="' + (cw + 0.2).toFixed(1) + '" height="' + (ch + 0.2).toFixed(1) + '" fill="' + fill + '"/>';
      }
    }
    return s;
  }

  var W0 = 30, H0 = 20;
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.segTh, L.filMode].join(',');
    if (cache.key === key) return cache;
    var img = M.genImage(20261191, W0, H0);
    var sg = M.fractureSeg(img, L.segTh);
    var ff0 = M.fractureFilter(img, 0);
    var ff1 = M.fractureFilter(img, 1);
    cache = { key: key, L: L, img: img, sg: sg, ff0: ff0, ff1: ff1 };
    return cache;
  }

  /* =========================================================
     ① 成像图接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), img = c.img;
    var s = '';
    s += G.panel(0, '① 电成像图', '单井千万像素', C.blue);
    s += G.panel(1, '② 声成像图', '裂缝形态', C.clay);
    s += G.panel(2, '③ 岩心描述', '验证裂缝', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '成像图 · 裂缝呈正弦', { size: 9.5, fill: C.ink2, weight: 700 });
    s += grid('', img, G.COLS[0].x + 14, y0, 240, h, img.mask);
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '亮色=裂缝像元（合成）', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '成像图的数据',
      ['· 电成像/声成像',
       '· 单井千万像素级',
       '· 裂缝掩膜 500—2000',
       '',
       '人工逐条勾绘，',
       '要数小时。'], 'clay');
    return { svg: s, stats: [{ k: '尺寸', v: img.W + '×' + img.H }, { k: '裂缝', v: img.fracs.length + ' 条' }], note: '读入电成像/声成像图（单井千万像素级），裂缝呈正弦。人工逐条勾绘要数小时。' };
  }

  /* =========================================================
     ② 语义分割
     ========================================================= */
  function stage2(t) {
    var c = compute(), img = c.img, sg = c.sg, L = c.L;
    var s = '';
    s += G.panel(0, '① 成像图', '输入', C.blue);
    s += G.panel(1, '② 语义分割', '裂缝像元', C.jade);
    s += G.panel(2, '③ 掩膜', 'IoU=' + f(sg.iou), C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '语义分割 · IoU=' + f(sg.iou) + ' · Acc=' + f(sg.acc), { size: 9.5, fill: C.ink2, weight: 700 });
    s += grid('', img, G.COLS[0].x + 14, y0, 240, h, sg.seg);
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '阈值 ' + f(L.segTh) + ' · TP ' + sg.tp + ' FP ' + sg.fp + ' FN ' + sg.fn, { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '分割的坑',
      ['· 低角度裂缝',
       '  → 灰度低难分',
       '· 噪声像元误检',
       '',
       '调阈值或约束，',
       '细长目标检测。'], 'jade');
    return { svg: s, stats: [{ k: 'IoU', v: f(sg.iou) }, { k: 'FP', v: sg.fp }], note: '语义分割把裂缝像元从成像图分离。低角度裂缝灰度低难分，噪声像元易误检。' };
  }

  /* =========================================================
     ③ 细长目标检测
     ========================================================= */
  function stage3(t) {
    var c = compute(), img = c.img, sg = c.sg;
    var s = '';
    s += G.panel(0, '① 掩膜', '分割结果', C.blue);
    s += G.panel(1, '② 细长目标', '裂缝形态', C.jade);
    s += G.panel(2, '③ 裂缝条数', '形态参数', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '细长目标检测 · ' + img.fracs.length + ' 条裂缝', { size: 9.5, fill: C.ink2, weight: 700 });
    s += grid('', img, G.COLS[0].x + 14, y0, 240, h, null);
    var dx0 = 150, dx1 = 240;
    img.fracs.forEach(function (fr) {
      var yy = fr.y0 * h / H0;
      var amp = fr.amp * h / H0;
      s += '<path d="M' + (G.COLS[0].x + 14) + ' ' + (y0 + yy) + ' q ' + (dx1 / 2) + ' ' + (-amp) + ' ' + dx1 + ' 0" fill="none" stroke="' + (fr.type === 'nat' ? C0 : C2) + '" stroke-width="1.6"/>';
    });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '蓝=天然 · 绿=诱导（幅值低易混淆）', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '细长目标的坑',
      ['· 裂缝细长',
       '  → 容易断/漏检',
       '· 低角度与诱导',
       '  → 混淆',
       '',
       '用形态约束，',
       '再看诱导缝。'], 'jade');
    return { svg: s, stats: [{ k: '天然缝', v: img.fracs.filter(function (x) { return x.type === 'nat'; }).length }, { k: '诱导缝', v: img.fracs.filter(function (x) { return x.type === 'ind'; }).length }], note: '细长目标检测提取裂缝形态。裂缝细长容易断/漏检，低角度与诱导缝混淆。' };
  }

  /* =========================================================
     ④ 诱导缝鉴别
     ========================================================= */
  function stage4(t) {
    var c = compute(), img = c.img, ff0 = c.ff0, ff1 = c.ff1, L = c.L;
    var ff = L.filMode === 0 ? ff0 : ff1;
    var s = '';
    s += G.panel(0, '① 检测结果', '裂缝形态', C.blue);
    s += G.panel(1, '② 诱导缝鉴别', '幅值阈值', C.jade);
    s += G.panel(2, '③ 分类', '判错 ' + ff.err, C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '诱导缝鉴别 · ' + (L.filMode === 0 ? '宽松(阈1.8)' : '严格(阈2.4)') + ' · 判错 ' + ff.err + ' 条', { size: 9.5, fill: C.ink2, weight: 700 });
    s += grid('', img, G.COLS[0].x + 14, y0, 240, h, null);
    ff.list.forEach(function (it) {
      var fr = img.fracs[it.idx];
      var yy = fr.y0 * h / H0;
      var amp = fr.amp * h / H0;
      var col = it.pred === 'nat' ? C0 : C2;
      if (!it.ok) col = '#b05a51';
      s += '<path d="M' + (G.COLS[0].x + 14) + ' ' + (y0 + yy) + ' q ' + (120) + ' ' + (-amp) + ' ' + (240) + ' 0" fill="none" stroke="' + col + '" stroke-width="' + (it.ok ? 1.6 : 2.6) + '"/>';
    });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '红=判错待复核', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '诱导缝鉴别的坑',
      ['· 诱导缝幅值低',
       '  → 与低角度混淆',
       '· 阈值难选',
       '',
       '严阈值防误报，',
       '宽松防漏检。'], 'clay');
    return { svg: s, stats: [{ k: '判错', v: ff.err + ' 条' }, { k: '阈值', v: f(ff.th) }], note: '诱导缝鉴别区分天然缝与诱导缝。诱导缝幅值低与低角度天然缝混淆，阈值难选。' };
  }

  /* =========================================================
     ⑤ 岩心描述验证
     ========================================================= */
  function stage5(t) {
    var c = compute(), img = c.img, ff0 = c.ff0;
    var s = '';
    s += G.panel(0, '① 检测结果', '模型建议', C.blue);
    s += G.panel(1, '② 岩心描述', '核对', C.clay);
    s += G.panel(2, '③ 复核清单', '判错 ' + ff0.err, C.jade);

    var y0 = 130, h = 110;
    var rows = ff0.list.map(function (it, i) {
      return { name: '裂缝' + (i + 1), pred: it.pred === 'nat' ? '天然' : '诱导', truth: it.true === 'nat' ? '天然' : '诱导', ok: it.ok };
    });
    for (var r = 0; r < rows.length && r < 6; r++) {
      var ry = y0 + r * 18;
      s += G.txt(G.COLS[0].x + 14, ry + 10, rows[r].name + ' · ' + rows[r].pred + (rows[r].ok ? ' ✓' : ' ✗ 应' + rows[r].truth), { size: 8.5, fill: rows[r].ok ? C.jadeD : '#b05a51' });
    }
    s += G.txt(G.COLS[0].x + 14, y0 - 18, '岩心描述验证清单', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '验证的坑',
      ['· 验证不回流',
       '  → 模型不知判错',
       '· 低角度永远混淆',
       '',
       '岩心描述回流，',
       '裂缝识别越用越准。'], 'clay');
    return { svg: s, stats: [{ k: '判错', v: ff0.err + ' 条' }, { k: '待复核', v: ff0.err }], note: '裂缝识别结果给建议，岩心描述验证复核。验证不回流，模型不知道判错在哪，低角度与诱导缝永远混淆。' };
  }

  /* =========================================================
     ⑥ 回流
     ========================================================= */
  function stage6(t) {
    var c = compute(), img = c.img, ff1 = c.ff1;
    var s = '';
    s += G.panel(0, '① 识别建议', '模型输出', C.blue);
    s += G.panel(1, '② 岩心回流', '确认修正', C.clay);
    s += G.panel(2, '③ 越用越准', '回流闭环', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['识别建议', '模型', '复核'],
      ['岩心描述', '人工', '修正'],
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
       '岩心描述回流，',
       '识别持续变准。'], 'jade');
    return { svg: s, stats: [{ k: '判错', v: ff1.err + ' 条' }, { k: '回流', v: '已闭环' }], note: '岩心描述验证结果回流训练集，模型越用越准、低角度与诱导缝判别持续改善。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
