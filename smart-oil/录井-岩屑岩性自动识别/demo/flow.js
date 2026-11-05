/* =========================================================
   岩屑岩性自动识别 · 算法解剖（细粒度分类 + 多标签 + 不均衡处理）
   ---------------------------------------------------------
   把「岩屑图像 → 组分比例」拆成 6 步，每一步都跑真代码：

     ① 岩屑图像接入  图像 + 描述表 + 洗样记录
     ② 细粒度分类    区分难分对（泥岩/页岩）
     ③ 多标签识别    单样品多组分 → 组分比例
     ④ 不均衡处理    少数类加权/重采样
     ⑤ 人工复核      只复核异常样品
     ⑥ 成果回流      复核结果回训练集

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

  var N = 60;
  var C0 = '#41699b', C1 = '#b26a39', C2 = '#2f7d6b';
  var LCOL = ['#a8bfd4', '#9b86a8', '#e0c88a', '#cbbf9a', '#b9ceb4', '#e0a878'];

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
    var key = [L.nData, L.weight, L.imbMode, L.balMode].join(',');
    if (cache.key === key) return cache;
    var data = M.genCuttings(N, 20261161, L.imbMode);
    var cls = M.fineClassify(data, L.weight, 0.05);
    var ml = M.multiLabel(data, L.weight);
    var bal = M.balanceTrain(data, L.balMode, L.weight);
    cache = { key: key, L: L, data: data, cls: cls, ml: ml, bal: bal };
    return cache;
  }

  /* =========================================================
     ① 岩屑图像接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), L = c.L;
    var s = '';
    s += G.panel(0, '① 岩屑图像', '单井300—800张', C.blue);
    s += G.panel(1, '② 描述表', '岩性/含油级别', C.clay);
    s += G.panel(2, '③ 洗样记录', '分组防泄漏', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '岩屑显微图像特征', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 3, ny: 3 });
    c.data.feats.slice(0, 40).forEach(function (f, i) {
      var px = G.COLS[0].x + 14 + f.feat[0] * 240;
      var py = y0 + h - f.feat[1] * h;
      s += G.circle(px, py, 2.6, { fill: LCOL[f.label], op: 0.8 });
    });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '类中心分散但类间有重叠', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '数据形态',
      ['· 单井300—800张',
       '· 每类岩性≥500张',
       '· 描述表作标签',
       '',
       '洗样/混样记录',
       '要分组，避免',
       '数据泄漏。'], 'clay');
    return { svg: s, stats: [{ k: '样品数', v: c.data.n }, { k: '岩性类', v: M.LITHO.length + ' 类' }], note: '读入岩屑显微图像与岩屑描述表。不同井光照/倍率不一致，直接合并训练会学偏，需统一成像条件。' };
  }

  /* =========================================================
     ② 细粒度分类
     ========================================================= */
  function stage2(t) {
    var c = compute(), cls = c.cls, L = c.L;
    var s = '';
    s += G.panel(0, '① 岩屑图像', '局部纹理', C.blue);
    s += G.panel(1, '② 细粒度模型', '区分难分对', C.jade);
    s += G.panel(2, '③ 岩性概率', '泥岩/页岩', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '细粒度分类 · 准确 ' + Math.round(cls.acc * 100) + '%', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 3, ny: 3 });
    c.data.feats.forEach(function (f, i) {
      var px = G.COLS[0].x + 14 + f.feat[0] * 240;
      var py = y0 + h - f.feat[1] * h;
      var isW = cls.pred[i] !== f.label;
      s += G.circle(px, py, isW ? 3.4 : 2.4, { fill: isW ? '#d0a3a3' : LCOL[f.label], op: 0.85 });
      if (isW) s += G.circle(px, py, 4.6, { fill: 'none', stroke: C1, sw: 1.2 });
    });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '红圈 = 分类错误（难分对）', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '细粒度的坑',
      ['· 只做粗粒度分类',
       '  → 泥岩/页岩混淆',
       '· 漏掉关键岩性变化',
       '',
       '要学局部纹理特征，',
       '区分难分对。'], 'jade');
    return { svg: s, stats: [{ k: '准确率', v: Math.round(cls.acc * 100) + '%' }, { k: '粒度', v: L.weight > 0.5 ? '细' : '粗' }], note: '对岩屑图像做细粒度分类，区分泥岩/页岩、粉砂岩/细砂岩等难分对。只做粗粒度分类，难分对混淆，漏掉关键岩性变化。' };
  }

  /* =========================================================
     ③ 多标签识别
     ========================================================= */
  function stage3(t) {
    var c = compute(), ml = c.ml, L = c.L;
    var s = '';
    s += G.panel(0, '① 单样品', '混样多组分', C.blue);
    s += G.panel(1, '② 多标签模型', '多输出占比', C.jade);
    s += G.panel(2, '③ 组分比例', '主+次成分', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '样品组分堆叠（前 8 样）', { size: 9.5, fill: C.ink2, weight: 700 });
    var shown = 8, step = Math.max(1, Math.floor(c.data.n / shown));
    var bw = 240 / shown;
    for (var i = 0; i < shown; i++) {
      var idx = i * step, bx = G.COLS[0].x + 14 + i * bw;
      var acc = 0;
      for (var k = 0; k < M.LITHO.length; k++) {
        var hh = ml.ratio[idx][k] * h;
        s += G.rect(bx + 1, y0 + h - acc - hh, bw - 2, hh, { r: 0, fill: LCOL[k] });
        acc += hh;
      }
    }
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '每根堆叠条 = 一个样品的岩性组分', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '多标签的坑',
      ['· 把样品当单标签',
       '  → 混样只能归一类',
       '· 丢失组分信息',
       '',
       '要输出组分占比，',
       '主成分+次成分。'], 'jade');
    return { svg: s, stats: [{ k: '主成分', v: M.LITHO[ml.main[c.data.n - 1]] }, { k: '组分', v: '堆叠占比' }], note: '单样品多组分，识别出岩性组分比例。把样品当单标签，混样样品只能归一类，丢失组分信息。' };
  }

  /* =========================================================
     ④ 类别不均衡处理
     ========================================================= */
  function stage4(t) {
    var c = compute(), bal = c.bal, L = c.L;
    var s = '';
    s += G.panel(0, '① 不均衡数据', '少数类被淹没', C.clay);
    s += G.panel(1, '② 加权/重采样', '提升少数类', C.jade);
    s += G.panel(2, '③ 少数类召回', '罕见岩性不漏', C.blue);

    var y0 = 130, h = 100;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '各类召回（浅=原始 深=调整）', { size: 9.5, fill: C.ink2, weight: 700 });
    var bw = 240 / bal.K;
    for (var k = 0; k < bal.K; k++) {
      var bx = G.COLS[0].x + 14 + k * bw + 3;
      var h1 = bal.recall[k] * h, h2 = bal.adjRecall[k] * h;
      s += G.rect(bx, y0 + h - h1, bw - 6, h1, { r: 0, fill: '#d9b78e' });
      s += G.rect(bx + (bw - 6) / 2, y0 + h - h2, (bw - 6) / 2, h2, { r: 0, fill: C2 });
      s += G.txt(bx + (bw - 4) / 2, y0 + h + 14, M.LITHO[k].slice(0, 2), { size: 7, fill: LCOL[k], anchor: 'middle', weight: 700 });
    }
    s += G.txt(G.COLS[0].x + 14, y0 + h + 32, '右端少数类召回提升最明显', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '不均衡的坑',
      ['· 不做不均衡处理',
       '  → 模型全猜多数类',
       '· 罕见岩性全漏检',
       '',
       '加权/重采样让少数类',
       '不被淹没。'], 'clay');
    return { svg: s, stats: [{ k: '处理', v: L.balMode === 0 ? 'none' : L.balMode === 1 ? '加权' : '重采样' }, { k: '少数类召回', v: Math.round(bal.adjRecall[bal.K - 1] * 100) + '%' }], note: '少数类岩性加权或重采样，提升召回。不做不均衡处理，模型全猜多数类，罕见岩性全部漏检。' };
  }

  /* =========================================================
     ⑤ 人工复核
     ========================================================= */
  function stage5(t) {
    var c = compute(), bal = c.bal, L = c.L;
    var s = '';
    s += G.panel(0, '① 组分比例', '模型输出', C.blue);
    s += G.panel(1, '② 异常复核', '只看异常样品', C.clay);
    s += G.panel(2, '③ 描述一致', '可追溯', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['组分比例', '模型输出', '复核'],
      ['泥岩60%+粉砂30%', '模型', '自动'],
      ['异常样品', '工程师复核', '人工']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 38;
      s += G.rect(G.COLS[0].x + 14, ry, 240, 30, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(G.COLS[0].x + 26, ry + 20, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(G.COLS[0].x + 130, ry + 20, rows[r][1], { size: 8.8, fill: C.jadeD });
    }
    s += G.txt(G.COLS[0].x + 14, y0 - 20, '人工复核清单', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '复核的坑',
      ['· 只看总体准确率',
       '  → 少数类错误掩盖',
       '· 罕见岩性漏检',
       '',
       '要按少数类召回复核，',
       '不只按总体。'], 'clay');
    return { svg: s, stats: [{ k: '复核范围', v: '仅异常样品' }, { k: '少数类召回', v: Math.round(bal.adjRecall[bal.K - 1] * 100) + '%' }], note: '模型输出组分比例，工程师只对异常样品复核。只看总体准确率，不看少数类召回，罕见岩性错误被掩盖。' };
  }

  /* =========================================================
     ⑥ 成果回流
     ========================================================= */
  function stage6(t) {
    var c = compute(), L = c.L;
    var s = '';
    s += G.panel(0, '① 复核结果', '纠正的标签', C.blue);
    s += G.panel(1, '② 训练集', '增量更新', C.clay);
    s += G.panel(2, '③ 更准', '漏检变少', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['复核结果', '纠正标签', 'ok'],
      ['训练集', '增量更新', 'ok'],
      ['少数类样本', '越标越全', 'ok'],
      ['模型', '越用越准', 'ok']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 30;
      s += G.rect(G.COLS[0].x + 14, ry, 240, 24, { r: 4, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(G.COLS[0].x + 26, ry + 17, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(G.COLS[0].x + 130, ry + 17, rows[r][1], { size: 8.8, fill: C.jadeD });
      s += G.txt(G.COLS[0].x + 220, ry + 17, rows[r][2], { size: 8.8, fill: C.jadeD, weight: 700 });
    }
    s += G.txt(G.COLS[0].x + 14, y0 - 20, '成果回流清单', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '回流的坑',
      ['· 复核结果不回流',
       '  → 模型不知道错',
       '· 永远漏检',
       '',
       '要闭环增量更新。'], 'clay');
    return { svg: s, stats: [{ k: '回流', v: '已闭环' }, { k: '漏检', v: '持续下降' }], note: '复核结果回流训练集，模型越用越准。复核结果不回流，模型不知道错在哪，永远漏检。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
