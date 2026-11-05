/* =========================================================
   荧光图像智能判读 · 算法解剖（成像标准化 + 颜色特征 + 分类）
   ---------------------------------------------------------
   把「荧光图像 → 含油级别」拆成 6 步，每一步都跑真代码：

     ① 荧光图像接入  固定灯源曝光
     ② 成像标准化    灯源校正，亮度一致
     ③ 颜色特征      颜色/面积量化级别
     ④ 图像分类      自动判含油级别
     ⑤ 抽查复核      判级给建议
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

  var N = 240;
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

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.nImg, L.stdMode, L.featMode, L.thr.join(',')].join(',');
    if (cache.key === key) return cache;
    var d = M.genFluor(N, 20261181, 0);
    var s = M.stdImaging(d, L.stdMode);
    var cf = M.colorFeat(s, L.featMode);
    var cls = M.fluorClassify(s, L.thr);
    cache = { key: key, L: L, d: d, s: s, cf: cf, cls: cls };
    return cache;
  }

  /* =========================================================
     ① 荧光图像接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), d = c.d;
    var s = '';
    s += G.panel(0, '① 紫外荧光图像', '单井200—600张', C.blue);
    s += G.panel(1, '② 灯源曝光', '固定参数', C.clay);
    s += G.panel(2, '③ 含油级别标签', '无/微/弱/中/强', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '荧光图像（亮度按灯源显示）', { size: 9.5, fill: C.ink2, weight: 700 });
    var nBin = 10, x0 = G.COLS[0].x + 14, w2 = 240, hC = 90;
    var bins = new Array(nBin).fill(0);
    for (var i = 0; i < d.imgs.length; i++) {
      var b = Math.min(nBin - 1, Math.floor(d.imgs[i].bright * nBin));
      bins[b]++;
    }
    var maxC = 1;
    for (i = 0; i < nBin; i++) maxC = Math.max(maxC, bins[i]);
    for (i = 0; i < nBin; i++) {
      var hh = bins[i] / maxC * hC;
      s += G.rect(x0 + i * (w2 / nBin), y0 + hC - hh, w2 / nBin - 2, hh, { r: 2, fill: C0 });
    }
    s += G.line(x0, y0 + hC, x0 + w2, y0 + hC, { stroke: C.line, sw: 1 });
    s += G.txt(x0 + 6, y0 + hC + 18, '单井200—600张 · 亮度直方图', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, y0, 170, '数据形态',
      ['· 紫外荧光图像',
       '· 固定灯源曝光',
       '· 含油级别标签',
       '',
       '不固定灯源曝光，',
       '亮度差异大，特征',
       '不可比。'], 'clay');
    return { svg: s, stats: [{ k: '图像', v: d.n + ' 张' }, { k: '级别', v: '5 级' }], note: '读入紫外荧光图像，固定灯源与曝光。不固定灯源与曝光，不同图像亮度差异大，特征不可比。' };
  }

  /* =========================================================
     ② 成像标准化
     ========================================================= */
  function stage2(t) {
    var c = compute(), L = c.L;
    var s = '';
    s += G.panel(0, '① 原始图像', '亮度差异大', C.blue);
    s += G.panel(1, '② 成像标准化', '灯源校正', C.jade);
    s += G.panel(2, '③ 亮度一致', '特征可比', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '标准化后两灯源亮度分布', { size: 9.5, fill: C.ink2, weight: 700 });
    var nBin = 10, x0 = G.COLS[0].x + 14, w2 = 240, hC = 90;
    var sl0 = M.stdImaging(M.genFluor(120, 20261181, 0), L.stdMode);
    var sl1 = M.stdImaging(M.genFluor(120, 20261181, 1), L.stdMode);
    var b0 = new Array(nBin).fill(0), b1 = new Array(nBin).fill(0);
    for (var i = 0; i < sl0.imgs.length; i++) { b0[Math.min(nBin - 1, Math.floor(sl0.imgs[i].bright * nBin))]++; }
    for (i = 0; i < sl1.imgs.length; i++) { b1[Math.min(nBin - 1, Math.floor(sl1.imgs[i].bright * nBin))]++; }
    var maxC = 1;
    for (i = 0; i < nBin; i++) maxC = Math.max(maxC, b0[i], b1[i]);
    for (i = 0; i < nBin; i++) {
      var h0 = b0[i] / maxC * hC, h1 = b1[i] / maxC * hC;
      s += G.rect(x0 + i * (w2 / nBin), y0 + hC - h0, w2 / nBin / 2 - 1, h0, { r: 2, fill: C0 });
      s += G.rect(x0 + i * (w2 / nBin) + w2 / nBin / 2, y0 + hC - h1, w2 / nBin / 2 - 1, h1, { r: 2, fill: C1 });
    }
    s += G.line(x0, y0 + hC, x0 + w2, y0 + hC, { stroke: C.line, sw: 1 });
    s += G.txt(x0 + 6, y0 + hC + 18, (L.stdMode === 0 ? '两灯源差异大' : '两灯源重合=亮度一致'), { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, y0, 170, '成像标准化的坑',
      ['· 不做标准化',
       '  → 灯源差异被当含油差异',
       '· 误判',
       '',
       '用灯源记录校正',
       '亮度色偏。'], 'jade');
    return { svg: s, stats: [{ k: '标准化', v: L.stdMode === 0 ? '未' : '已' }, { k: '灯源', v: L.stdMode === 1 ? '一致' : '有差' }], note: '用灯源记录校正亮度与色偏，让不同灯源结论一致。不做标准化，灯源差异被当成含油级别差异，误判。' };
  }

  /* =========================================================
     ③ 颜色特征工程
     ========================================================= */
  function stage3(t) {
    var c = compute(), s = c.s, L = c.L;
    var s2 = '';
    s2 += G.panel(0, '① 标准化图像', '亮度一致', C.blue);
    s2 += G.panel(1, '② 颜色特征', '颜色/面积', C.jade);
    s2 += G.panel(2, '③ 级别量化', '可分类', C.clay);

    var y0 = 130, h = 110;
    s2 += G.txt(G.COLS[0].x + 14, y0 - 22, '颜色特征维度（' + (L.featMode === 0 ? '单特征' : '多特征') + '）', { size: 9.5, fill: C.ink2, weight: 700 });
    var x0 = G.COLS[0].x + 14, w2 = 240;
    var dims = L.featMode === 0 ? [['亮度', C0]] : [['亮度', C0], ['饱和', C1], ['面积', C2]];
    var dimW = (w2 - 10) / dims.length;
    for (var k = 0; k < dims.length; k++) {
      var dx = x0 + k * (dimW + 5);
      s2 += G.rect(dx, y0, dimW, h, { r: 6, fill: C.blueL, stroke: dims[k][1], sw: 1.2 });
      s2 += G.txt(dx + 6, y0 + 18, dims[k][0], { size: 9, fill: C.ink2, weight: 700 });
      var sum = 0;
      for (var i = 0; i < s.imgs.length; i++) sum += k === 0 ? s.imgs[i].bright : k === 1 ? s.imgs[i].sat : s.imgs[i].area;
      var avg = sum / s.imgs.length;
      var barH = 50;
      s2 += G.rect(dx + 8, y0 + h - 24, dimW - 16, barH * avg, { r: 3, fill: dims[k][1] });
      s2 += G.txt(dx + 6, y0 + h - 32, '均值 ' + f(avg), { size: 8, fill: C.ink3 });
    }
    s2 += G.txt(G.COLS[0].x + 14, y0 + h + 22, '多特征联合 → 边界模糊也分得开', { size: 8.5, fill: C.ink3 });

    s2 += footBox(G.COLS[2].x + 14, y0, 170, '颜色特征的坑',
      ['· 只取单一特征',
       '  → 微弱/中强边界分不开',
       '· 误判边界样本',
       '',
       '亮度+饱和+面积',
       '联合量化级别。'], 'clay');
    return { svg: s2, stats: [{ k: '特征', v: L.featMode === 0 ? '单' : '多' }, { k: '维度', v: L.featMode === 0 ? '1' : '3' }], note: '提取荧光颜色/面积特征，量化含油级别。只取单一颜色特征，微/弱、中/强边界模糊时分不开。' };
  }

  /* =========================================================
     ④ 图像分类
     ========================================================= */
  function stage4(t) {
    var c = compute(), s = c.s, cls = c.cls;
    var s2 = '';
    s2 += G.panel(0, '① 颜色特征', '颜色+面积', C.blue);
    s2 += G.panel(1, '② 图像分类', '自动判级', C.jade);
    s2 += G.panel(2, '③ 含油级别', '无/微/弱/中/强', C.clay);

    var y0 = 130, h = 110;
    s2 += G.txt(G.COLS[0].x + 14, y0 - 22, '含油级别分类 · 准确 ' + Math.round(cls.acc * 100) + '%', { size: 9.5, fill: C.ink2, weight: 700 });
    var cm = new Array(5);
    for (var a = 0; a < 5; a++) { cm[a] = new Array(5).fill(0); }
    for (var i = 0; i < s.imgs.length; i++) { cm[s.imgs[i].level][cls.pred[i]]++; }
    var cell = 30, mx = G.COLS[0].x + 14, my = y0;
    for (var r = 0; r < 5; r++) {
      for (var c2 = 0; c2 < 5; c2++) {
        var v = cm[r][c2];
        var alpha = v === 0 ? 0.08 : 0.2 + 0.8 * (v / Math.max(1, cm[r][r]));
        s2 += G.rect(mx + c2 * cell, my + r * cell, cell - 2, cell - 2, { r: 3, fill: r === c2 ? C2 : '#f0a24c', op: alpha });
        if (v > 0) s2 += G.txt(mx + c2 * cell + cell / 2, my + r * cell + cell / 2 + 4, String(v), { size: 8, fill: r === c2 ? '#fff' : C.ink, anchor: 'middle', weight: 700 });
      }
    }
    s2 += G.txt(mx - 4, my - 6, '真值', { size: 7.5, fill: C.ink3 });
    s2 += G.txt(mx, my + 5 * cell + 14, '预测 →', { size: 7.5, fill: C.ink3 });
    s2 += G.txt(mx + 5 * cell + 8, my + 4, '对角=判对', { size: 8, fill: C.jadeD, weight: 700 });
    s2 += G.txt(mx + 5 * cell + 8, my + 18, '非对角=误判', { size: 8, fill: '#8a4f27' });

    s2 += footBox(G.COLS[2].x + 14, y0, 170, '图像分类的坑',
      ['· 样本不均衡',
       '  → 全猜多数类',
       '· 稀有级别全漏',
       '',
       '特征充分 + 均衡处理',
       '稀有级别不漏。'], 'jade');
    return { svg: s2, stats: [{ k: '准确', v: Math.round(cls.acc * 100) + '%' }, { k: '样本', v: s.imgs.length + ' 张' }], note: '据颜色/面积特征自动判含油级别。样本不均衡时全猜多数类，稀有级别全漏。' };
  }

  /* =========================================================
     ⑤ 抽查复核
     ========================================================= */
  function stage5(t) {
    var c = compute(), s = c.s, cls = c.cls;
    var s2 = '';
    s2 += G.panel(0, '① 含油级别', '模型建议', C.blue);
    s2 += G.panel(1, '② 抽查复核', '分级确认', C.clay);
    s2 += G.panel(2, '③ 一致性↑', '不漏显示', C.jade);

    var y0 = 130, h = 110;
    s2 += G.txt(G.COLS[0].x + 14, y0 - 22, '抽查复核清单（判错/低置信样本）', { size: 9.5, fill: C.ink2, weight: 700 });
    var items = [];
    for (var i = 0; i < s.imgs.length; i++) {
      if (cls.pred[i] !== s.imgs[i].level) items.push({ idx: i, level: s.imgs[i].level, pred: cls.pred[i], bright: s.imgs[i].bright });
    }
    var shown = items.slice(0, 4);
    var x0 = G.COLS[0].x + 14, w2 = 240;
    for (var k = 0; k < shown.length; k++) {
      var it = shown[k], rowY = y0 + k * 26;
      s2 += G.rect(x0, rowY, w2, 22, { r: 4, fill: C.clayL, stroke: '#e6cdb2' });
      s2 += G.txt(x0 + 6, rowY + 15, '样' + it.idx, { size: 8, fill: C.ink2 });
      s2 += G.txt(x0 + 40, rowY + 15, '真' + M.LEVEL[it.level], { size: 8, fill: '#8a4f27', weight: 700 });
      s2 += G.txt(x0 + 82, rowY + 15, '判' + M.LEVEL[it.pred], { size: 8, fill: '#b05a51', weight: 700 });
      s2 += G.txt(x0 + 124, rowY + 15, '待复核', { size: 8, fill: C.jadeD });
    }
    s2 += G.txt(x0, y0 + h + 22, '共 ' + items.length + ' 张待复核', { size: 8.5, fill: C.ink3 });

    s2 += footBox(G.COLS[2].x + 14, y0, 170, '抽查复核的坑',
      ['· 复核不回流',
       '  → 模型不知判错在哪',
       '· 永远误判',
       '',
       '复核结果要回流，',
       '判级越用越准。'], 'clay');
    return { svg: s2, stats: [{ k: '待复核', v: items.length + ' 张' }, { k: '判对', v: Math.round(cls.acc * 100) + '%' }], note: '模型判级给建议，录井工只抽查复核。复核结果不回流，模型不知道判错在哪，永远误判。' };
  }

  /* =========================================================
     ⑥ 回流
     ========================================================= */
  function stage6(t) {
    var c = compute(), cls = c.cls;
    var s = '';
    s += G.panel(0, '① 判级建议', '模型输出', C.blue);
    s += G.panel(1, '② 复核回流', '确认修正', C.clay);
    s += G.panel(2, '③ 越用越准', '回流闭环', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['判级建议', '模型', '复核'],
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

    s += footBox(G.COLS[2].x + 14, y0, 170, '回流的坑',
      ['· 不回流',
       '  → 数据不增，一直误判',
       '· 无法越用越准',
       '',
       '复核+岩心描述回流，',
       '模型持续变准。'], 'jade');
    return { svg: s, stats: [{ k: '判对', v: Math.round(cls.acc * 100) + '%' }, { k: '回流', v: '已闭环' }], note: '复核结果回流训练集，模型越用越准、漏显示持续下降。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
