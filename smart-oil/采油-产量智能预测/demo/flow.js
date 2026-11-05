/* =========================================================
   产量智能预测 · 算法解剖（特征工程 → MLP → 滚动验证 → ITS 归因）
   ---------------------------------------------------------
   把「720 天产量序列 → 30 天预测 + 增产归因」拆成 6 步：

     ① 序列合成         基线递减 + 措施台阶 + 季节项 + 噪声
     ② 特征工程         14 维特征逐项从时序里装配出来
     ③ 标准化           每列减均值除标准差
     ④ MLP 前向         14 → 7 → 1 逐层点亮，权重连线
     ⑤ 滚动原点验证     只用过去预测未来，10 个原点实测 MAPE
     ⑥ ITS 反事实归因   屏蔽事件特征 → 反事实曲线 → 增量带

   依赖：window.PfBridge（demo.js 暴露的真模型）
        window.AFlow（算法解剖引擎）
   ========================================================= */
(function (global) {
  'use strict';

  var B = global.PfBridge;
  if (!B || !global.AFlow) return;

  var G = global.AFlow.G, C = global.AFlow.C;
  var M = B.MLP, NF = B.NF, FN = B.FEAT_NAMES;

  /* ---------- 工具 ---------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t * t * (3 - 2 * t); }
  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }
  function footBox(x, w, y, h, title, lines, tone) {
    var bg = tone === 'jade' ? C.jadeL : tone === 'clay' ? C.clayL : tone === 'blue' ? C.blueL : '#f4f3ef';
    var st = tone === 'jade' ? '#b9d8cb' : tone === 'clay' ? '#e6cdb2' : tone === 'blue' ? '#c5d6ea' : C.line;
    var fg = tone === 'jade' ? C.jadeD : tone === 'clay' ? '#8a4f27' : tone === 'blue' ? '#2b4a72' : C.ink2;
    var s = G.rect(x, y, w, h, { r: 6, fill: bg, stroke: st });
    if (title) s += G.txt(x + 11, y + 17, title, { size: 9.6, fill: fg, weight: 700 });
    for (var i = 0; i < lines.length; i++) {
      s += G.txt(x + 11, y + (title ? 33 : 17) + i * 13, lines[i], { size: 8.8, fill: fg });
    }
    return s;
  }
  function polyOf(arr, x, y, w, h, lo, hi, color, sw, dash) {
    var pts = [], i;
    for (i = 0; i < arr.length; i++) {
      pts.push([x + i / (arr.length - 1) * w, y + h - (arr[i] - lo) / (hi - lo) * h]);
    }
    return G.poly(pts, { stroke: color, sw: sw || 1.4, dash: dash, join: 'round' });
  }
  function bandOf(lo, hi, x, y, w, h, vlo, vhi, color, op) {
    var up = [], dn = [], i;
    for (i = 0; i < lo.length; i++) up.push([x + i / (lo.length - 1) * w, y + h - (hi[i] - vlo) / (vhi - vlo) * h]);
    for (i = dn.length = 0; i < lo.length; i++) dn.push([x + i / (lo.length - 1) * w, y + h - (lo[i] - vlo) / (vhi - vlo) * h]);
    var d = '';
    for (i = 0; i < up.length; i++) d += (i ? 'L' : 'M') + up[i][0].toFixed(1) + ' ' + up[i][1].toFixed(1) + ' ';
    for (i = dn.length - 1; i >= 0; i--) d += 'L' + dn[i][0].toFixed(1) + ' ' + dn[i][1].toFixed(1) + ' ';
    return G.path(d + 'Z', { fill: color, op: op == null ? 0.2 : op });
  }

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.wellKey, L.days, L.H, L.withEvents].join(',');
    if (cache.key === key) return cache;
    var w = B.genWell(B.WELL_PRESETS[L.wellKey], L.days);
    /* 训练窗：最后一个原点 */
    var t0 = Math.max(360, w.N - L.H - 60);
    var from = t0 - 360;
    var tr = B.buildMatrix(w, from, t0, L.withEvents);
    var sc = B.scalerOf(tr.X);
    var Xs = tr.X.map(function (r) { return B.applyScaler(sc, r); });
    var net = new M(NF, 7, 7);
    var lossHist = net.train(Xs, tr.y, 90, 0.06);
    var wr = B.ridgeFit(Xs, tr.y, 3.0);
    var wf = B.walkForward(w, { H: L.H, trainLen: 360, nOrigins: 10, step: 20, models: ['arps', 'ridge', 'mlp'] });
    var evIdx = 0;
    var attrIts = w.events.length ? B.attribution(w, evIdx, { mode: 'its', preLen: 120, horizon: 60 }) : null;
    var attrNaive = w.events.length ? B.attribution(w, evIdx, { mode: 'naive', preLen: 120, horizon: 60 }) : null;
    cache = {
      key: key, L: L, w: w, t0: t0, from: from, tr: tr, sc: sc, Xs: Xs,
      net: net, lossHist: lossHist, wr: wr, wf: wf,
      attrIts: attrIts, attrNaive: attrNaive
    };
    return cache;
  }

  /* =========================================================
     ① 序列合成
     ========================================================= */
  function stage1(t) {
    var c = compute(), w = c.w, L = c.L;
    var s = '';
    s += G.panel(0, '① 产量曲线', '720 天日度产油（t/d）', C.jade);
    s += G.panel(1, '② 拆成四个成分', '递减 + 措施 + 季节 + 噪声', C.blue);
    s += G.panel(2, '③ 模型真正要学的', '不是一条曲线，是一组成分', C.clay);

    var x0 = 30, y0 = 116, w2 = 250, h = 150;
    var qMax = Math.max.apply(null, w.q) * 1.1;
    s += G.axes(x0, y0, w2, h, { nx: 4, ny: 4 });
    /* 措施事件竖线 */
    for (var e = 0; e < w.events.length; e++) {
      var ex = x0 + w.events[e].t / w.N * w2;
      s += G.line(ex, y0, ex, y0 + h, { stroke: C.clay, dash: '4 3', sw: 1.2 });
      s += G.txt(ex + 3, y0 + 10, w.events[e].type, { size: 8.4, fill: C.clay, weight: 700 });
    }
    var upto = Math.max(2, Math.floor(ease(clamp(t, 0, 1)) * w.N));
    s += polyOf(w.q.slice(0, upto), x0, y0, w2, h, 0, qMax, C.jade, 1.5);
    s += G.txt(x0, y0 - 10, '日产油 q(t)', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + h + 16, '已显示 ' + upto + ' / ' + w.N + ' 天', { size: 9, fill: C.ink3, mono: true });
    s += footBox(30, 250, 300, 148, '现场台账里长什么样',
      ['每口井，每天记一个数：日产油吨数。',
       '一年 365 行，一个区块几百口井——',
       '几十万行数字，人不可能看出规律。',
       '',
       '智能化要做的事：从这条曲线里',
       '把「自然递减」和「措施效果」分开。'], 'jade');

    /* 中：成分分解 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    /* 基线递减 */
    s += polyOf(w.base, mx, my, mw, mh, 0, qMax, C.blue, 1.4);
    /* 措施台阶（叠加在基线上） */
    var jumpPts = [];
    for (var i = 0; i < w.N; i++) jumpPts.push([mx + i / (w.N - 1) * mw, my + mh - (w.base[i] + w.jump[i]) / qMax * mh]);
    s += G.poly(jumpPts, { stroke: C.clay, sw: 1.6, dash: '5 3' });
    /* 合成量（季节+噪声） */
    s += polyOf(w.q, mx, my, mw, mh, 0, qMax, C.ink4, 1);
    s += G.txt(mx, my - 10, '四个成分叠起来才是观测值', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(mx + mw, my + mh - (w.base[0] / qMax) * mh - 5, '蓝=基线递减', { size: 8.2, fill: C.blue, anchor: 'end', weight: 700 });
    s += G.txt(mx + mw, my + mh - ((w.base[0] + w.jump[0]) / qMax) * mh + 12, '橙虚线=加上措施', { size: 8.2, fill: C.clay, anchor: 'end', weight: 700 });
    s += G.txt(mx, my + mh + 16, '灰=再加季节项与噪声后的真实观测', { size: 8.6, fill: C.ink3 });
    s += footBox(320, 250, 300, 148, '四个成分各管一件事',
      ['基线递减：自然产量下降（含水越高越快）',
       '措施台阶：压裂/堵水/换泵带来的增量',
       '季节项：冬季偏低、夏季偏高的年周期',
       '噪声：计量与工况的随机抖动',
       '',
       '指数递减（Arps）只描述第一个成分，',
       '所以遇到措施井必然失真。'], 'blue');

    /* 右：为什么难 */
    s += G.txt(716, 100, '模型要同时应付的三件事', { size: 10, fill: C.ink2, weight: 700 });
    var probs = [
      ['跳变', '措施让产量一天之内跳一级，指数曲线拟合不了', C.clay],
      ['变速', '含水上升让递减率不断变快，参数不是常数', C.blue],
      ['伪周期', '间开井每 45 天停产 4 天，不是真实产量', C.purple]
    ];
    for (i = 0; i < probs.length; i++) {
      var py = 118 + i * 74;
      s += G.rect(716, py, 256, 62, { r: 6, fill: '#fdfdfb', stroke: C.line });
      s += G.txt(728, py + 18, probs[i][0], { size: 10, fill: probs[i][2], weight: 700 });
      s += G.txt(752, py + 18, '·', { size: 10, fill: C.ink4 });
      s += G.txt(728, py + 36, probs[i][1], { size: 8.8, fill: C.ink2 });
      if (i < 2) s += G.txt(728, py + 52, '→ 靠特征工程把信息喂给模型', { size: 8.2, fill: C.ink4 });
    }
    s += footBox(716, 256, 348, 100, '所以要上机器学习',
      ['与其让一个公式硬套所有井，不如把',
       '「滞后值、滚动均值、日历、协变量、',
       '措施事件」都做成特征喂进去——',
       '让模型自己学这些因素怎么影响产量。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '序列长度', v: w.N + ' 天' },
        { k: '井型', v: B.WELL_PRESETS[L.wellKey].name, tone: 'ok' },
        { k: '措施事件', v: w.events.length ? w.events.map(function (x) { return x.type; }).join('/') : '无' },
        { k: '初始产量', v: f(w.q[0], 1) + ' t/d' }
      ],
      note: '<b>为什么要拆成分：</b>如果只把 720 个产量数字丢给模型，它会把「自然递减」和「压裂增产」混在一起学。人工经验（Arps 递减）能描述前者，但描述不了后者——<b>这正是传统方法在措施井上失真的根因</b>。'
    };
  }

  /* =========================================================
     ② 特征工程
     ========================================================= */
  function stage2(t) {
    var c = compute(), w = c.w, L = c.L;
    var s = '';
    var tRow = c.t0 - 1;              /* 用最后一个原点前一天的特征行做演示 */
    var row = B.featRow(w, tRow, L.withEvents);
    var shown = Math.min(NF, Math.floor(ease(clamp(t, 0, 1)) * NF) + 1);

    s += G.panel(0, '① 原始时序', '模型不直接看曲线，只看特征', C.jade);
    s += G.panel(1, '② 特征怎么装配', '14 个数字，逐个从时序里取', C.blue);
    s += G.panel(2, '③ 特征向量', '一行 = 一天，14 列', C.clay);

    /* 左：时序 + 取数位置 */
    var x0 = 30, y0 = 116, ww = 250, h = 150;
    var qMax = Math.max.apply(null, w.q) * 1.1;
    s += G.axes(x0, y0, ww, h, { nx: 4, ny: 4 });
    var upto = Math.max(2, Math.floor(ease(clamp(t, 0, 1)) * w.N));
    s += polyOf(w.q.slice(0, upto), x0, y0, ww, h, 0, qMax, C.ink4, 1.2);
    /* 当前取数位置 */
    var cx = x0 + tRow / w.N * ww;
    s += G.line(cx, y0, cx, y0 + h, { stroke: C.clay, sw: 1.5 });
    s += G.txt(cx + 3, y0 + 12, 't=' + tRow, { size: 8.6, fill: C.clay, weight: 700 });
    /* lag1 / lag7 / lag30 位置 */
    var lags = [[1, C.jade], [7, C.blue], [30, C.purple]];
    for (var li = 0; li < lags.length; li++) {
      var lx = x0 + (tRow - lags[li][0]) / w.N * ww;
      s += G.circle(lx, y0 + h - w.q[tRow - lags[li][0]] / qMax * h, 3.4, { fill: lags[li][1] });
      s += G.txt(lx, y0 + h + 14, 'lag' + lags[li][0], { size: 7.8, mono: true, fill: lags[li][1], anchor: 'middle', weight: 700 });
    }
    s += G.txt(x0, y0 - 10, '产量曲线与取数位置', { size: 9.5, fill: C.ink2, weight: 700 });
    s += footBox(30, 250, 300, 148, '特征工程的思路',
      ['把「今天为什么是这个产量」拆开，',
       '每拆出一个因素，就多一个输入维度。',
       '',
       '滞后值给模型「惯性」：产量有惯性，',
       '今天大多受前几天影响。',
       '滚动统计给模型「趋势」：近 7 天均值、',
       '近 30 天均值、近 7 天波动。'], 'jade');

    /* 中：14 个特征逐个装配 */
    var mx = 320, my = 100, mw = 250;
    s += G.txt(mx, my + 4, '特征名', { size: 9, fill: C.ink3, weight: 700 });
    s += G.txt(mx + 96, my + 4, '取值', { size: 9, fill: C.ink3, weight: 700 });
    s += G.txt(mx + 160, my + 4, '含义', { size: 9, fill: C.ink3, weight: 700 });
    s += G.line(mx, my + 10, mx + mw, my + 10, { stroke: C.line });
    var GROUPS = {
      'lag1': [C.jade, '昨天的产量'], 'lag7': [C.jade, '上周同一天'],
      'lag30': [C.jade, '上月同一天'], 'roll7均': [C.blue, '近 7 天平均'],
      'roll30均': [C.blue, '近 30 天平均'], 'roll7σ': [C.blue, '近 7 天波动'],
      '月sin': [C.purple, '季节位置'], '月cos': [C.purple, '季节位置'],
      '含水': [C.clay, '产液含水率'], '油压': [C.clay, '井口油压'],
      '注水': [C.clay, '日注水量'], '事件热度': [C.amber, '措施影响强度'],
      '间开': [C.amber, '是否停产'], '偏置': [C.gray, '常数 1']
    };
    for (var fi = 0; fi < NF; fi++) {
      var ry = my + 24 + fi * 24;
      var on = fi < shown;
      var col = (GROUPS[FN[fi]] || [C.ink3])[0];
      s += G.rect(mx - 4, ry - 12, mw + 8, 22, { fill: on ? C.jadeL : 'transparent', r: 4 });
      s += G.txt(mx, ry + 4, FN[fi], { size: 9.4, mono: true, fill: on ? col : C.ink4, weight: on ? 700 : 400 });
      s += G.txt(mx + 96, ry + 4, on ? f(row[fi], 3) : '—', { size: 9.4, mono: true, fill: on ? C.ink : C.ink4, weight: 700 });
      s += G.txt(mx + 160, ry + 4, on ? (GROUPS[FN[fi]] || ['', ''])[1] : '', { size: 8.6, fill: C.ink3 });
    }
    s += footBox(320, 250, 452, 0, '', [], 'blue');

    /* 右：特征向量条 */
    s += G.txt(716, 100, '第 ' + tRow + ' 天的特征向量', { size: 10, fill: C.ink2, weight: 700 });
    var bx = 716, by = 116, bh = 150;
    /* 归一化前的条（按列 z 分数示意） */
    var mxAbs = 0;
    for (fi = 0; fi < NF; fi++) mxAbs = Math.max(mxAbs, Math.abs(row[fi] - c.sc.mu[fi]) / (c.sc.sd[fi] || 1));
    for (fi = 0; fi < NF; fi++) {
      var z = (row[fi] - c.sc.mu[fi]) / (c.sc.sd[fi] || 1);
      var bw = 256 / NF - 1.4;
      var bxx = bx + fi * (256 / NF);
      var hh = Math.min(1, Math.abs(z) / Math.max(0.6, mxAbs)) * (bh - 30);
      var on2 = fi < shown;
      var col2 = (GROUPS[FN[fi]] || [C.ink3])[0];
      s += G.rect(bxx, by + bh - hh, bw, hh, { fill: col2, op: on2 ? 0.9 : 0.2 });
      s += G.txt(bxx + bw / 2, by + bh + 11, String(fi + 1), { size: 6.6, fill: C.ink4, anchor: 'middle' });
    }
    s += G.line(bx, by + bh, bx + 256, by + bh, { stroke: C.line });
    s += G.txt(bx, by - 6, '条高 = 该特征相对历史均值的偏离（z 分数）', { size: 8.6, fill: C.ink3 });
    s += G.txt(bx, by + bh + 24, '14 列 × 360 天 = 训练矩阵 5040 × 14', { size: 9, mono: true, fill: C.ink2, weight: 700 });
    s += footBox(716, 256, 300, 148, '为什么要这么多特征',
      ['模型不会「自己看出来」什么重要，',
       '得由工程师把物理机理翻译成列。',
       '',
       '「事件热度」这一列是关键：它把',
       '「压裂后第几天、增产效果还剩多少」',
       '编码成一个数。压裂井上 Arps 之所以最差，',
       '就是因为指数假设描述不了跳变——',
       '给了这一列，模型才有机会学对。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '特征维度', v: NF, tone: 'ok' },
        { k: '训练样本', v: (c.t0 - c.from) + ' 行' },
        { k: '演示时点', v: 't=' + tRow },
        { k: '已装配', v: shown + ' / ' + NF }
      ],
      note: '<b>特征工程是机器学习在石油场景里的核心手艺。</b>深度学习能从图像里自动学特征，但产量是<b>一维时序</b>，没有「自动特征提取」这一说——所有有用的信息必须由工程师按物理机理翻译成列。<b>模型的天花板，往往由特征决定，而不是由算法决定。</b>'
    };
  }

  /* =========================================================
     ③ 标准化
     ========================================================= */
  function stage3(t) {
    var c = compute(), sc = c.sc, tr = c.tr;
    var s = '';
    var shown = Math.min(NF, Math.floor(ease(clamp(t, 0, 1)) * NF) + 1);

    s += G.panel(0, '① 为什么要标准化', '各列量纲差几十倍', C.jade);
    s += G.panel(1, '② 逐列变换', "z = (x − μ) / σ", C.blue);
    s += G.panel(2, '③ 变换之后', '全部变成「相对历史均值几个 σ」', C.clay);

    /* 左：量纲差异 */
    var mx = 320;
    s += G.txt(30, 100, '各特征原始取值范围（训练窗内）', { size: 10, fill: C.ink2, weight: 700 });
    for (var fi = 0; fi < NF; fi++) {
      var lo = Infinity, hi = -Infinity, i;
      for (i = 0; i < tr.X.length; i++) {
        var v = tr.X[i][fi];
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
      var ry = 118 + fi * 22;
      var rng = hi - lo || 1;
      var logScale = Math.log10(rng + 1);
      var maxLog = 3;
      var bw = clamp(logScale / maxLog, 0.04, 1) * 170;
      s += G.txt(30, ry + 9, FN[fi], { size: 8.8, mono: true, fill: C.ink3 });
      s += G.rect(112, ry, 170, 11, { r: 2, fill: '#f1f1ee' });
      s += G.rect(112, ry, bw, 11, { r: 2, fill: C.clay, op: 0.75 });
      s += G.txt(288, ry + 9, f(lo, 2) + '…' + f(hi, 2), { size: 7.8, mono: true, fill: C.ink4, anchor: 'end' });
    }
    s += G.txt(30, 434, '「含水」在 0—1 之间，「注水」在 45—65 之间——', { size: 8.8, fill: C.ink3 });
    s += G.txt(30, 448, '直接送进梯度下降，含水那一列会被彻底忽略。', { size: 8.8, fill: C.clay, weight: 700 });

    /* 中：变换公式与逐列 */
    s += G.rect(320, 96, 348, 52, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(332, 116, "z = (x − μ) / σ", { size: 13, mono: true, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 136, 'μ = 训练窗该列均值　σ = 训练窗该列标准差', { size: 9, fill: '#4a607d' });
    s += G.txt(332, 172, '列', { size: 9, fill: C.ink3, weight: 700 });
    s += G.txt(404, 172, 'μ', { size: 9, fill: C.ink3, weight: 700 });
    s += G.txt(474, 172, 'σ', { size: 9, fill: C.ink3, weight: 700 });
    s += G.txt(544, 172, '一个样本 → z', { size: 9, fill: C.ink3, weight: 700 });
    s += G.line(320, 178, 668, 178, { stroke: C.line });
    var sample = tr.X[tr.X.length - 1];
    for (fi = 0; fi < NF; fi++) {
      var ry2 = 194 + fi * 21;
      var on = fi < shown;
      var z = (sample[fi] - sc.mu[fi]) / (sc.sd[fi] || 1);
      s += G.rect(316, ry2 - 12, 356, 20, { fill: on ? C.jadeL : 'transparent', r: 4 });
      s += G.txt(332, ry2 + 4, FN[fi], { size: 9, mono: true, fill: on ? C.ink2 : C.ink4, weight: on ? 700 : 400 });
      s += G.txt(404, ry2 + 4, on ? f(sc.mu[fi], 2) : '—', { size: 9, mono: true, fill: C.ink3 });
      s += G.txt(474, ry2 + 4, on ? f(sc.sd[fi], 3) : '—', { size: 9, mono: true, fill: C.ink3 });
      s += G.txt(544, ry2 + 4, on ? f(sample[fi], 2) + ' → ' + f(z, 2) : '—',
        { size: 9, mono: true, fill: on ? C.jadeD : C.ink4, weight: 700 });
    }
    s += footBox(320, 348, 440, 8, '', [], 'blue');

    /* 右：变换前后对比 */
    s += G.txt(716, 100, '一个特征列的分布：变换前 vs 后', { size: 10, fill: C.ink2, weight: 700 });
    /* 选一列（roll30均，量纲大） */
    var col = FN.indexOf('roll30均');
    var raw = tr.X.map(function (r) { return r[col]; });
    var zed = c.Xs.map(function (r) { return r[col]; });
    function hist(arr, lo, hi, x, y, w, h, color) {
      var bins = 18, hst = new Array(bins), b;
      for (b = 0; b < bins; b++) hst[b] = 0;
      var mn = Infinity, mx2 = -Infinity, i;
      for (i = 0; i < arr.length; i++) { if (arr[i] < mn) mn = arr[i]; if (arr[i] > mx2) mx2 = arr[i]; }
      for (i = 0; i < arr.length; i++) {
        var bi = Math.floor((arr[i] - mn) / ((mx2 - mn) || 1) * bins);
        if (bi < 0) bi = 0; if (bi >= bins) bi = bins - 1;
        hst[bi]++;
      }
      var hm = Math.max.apply(null, hst) || 1;
      var o = '';
      for (b = 0; b < bins; b++) {
        var bh = hst[b] / hm * (h - 18);
        o += G.rect(x + b * (w / bins), y + h - bh, w / bins - 1.5, bh, { fill: color, op: 0.8, r: 1 });
      }
      return o;
    }
    s += G.txt(716, 122, '变换前（原始单位）', { size: 9, fill: C.ink2, weight: 700 });
    s += hist(raw, 0, 1, 716, 128, 256, 62, C.clay);
    s += G.txt(716, 208, '变换后（z 分数）', { size: 9, fill: C.ink2, weight: 700 });
    s += hist(zed, 0, 1, 716, 214, 256, 62, C.jade);
    s += G.line(716 + 128, 214, 716 + 128, 276, { stroke: C.ink3, dash: '3 2', sw: 1.1 });
    s += G.txt(716 + 131, 226, 'z=0（历史均值）', { size: 8, fill: C.ink3 });
    s += footBox(716, 256, 296, 152, '这一步的三个好处',
      ['① 量纲统一：梯度下降时不会因为某列',
       '数值大就抢走全部注意力；',
       '② 数值有解释：z=+2 就是「比历史均值高 2σ」，',
       '异常点一眼可见；',
       '③ 训练与推理必须用同一组 μ、σ——',
       '所以要专门存下来，不能每次重算。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '特征列数', v: NF },
        { k: 'μ（roll30均）', v: f(sc.mu[FN.indexOf('roll30均')], 2) },
        { k: 'σ（roll30均）', v: f(sc.sd[FN.indexOf('roll30均')], 3) },
        { k: 'z 分数范围', v: '约 −3 … +3', tone: 'ok' }
      ],
      note: '<b>标准化为什么必须做：</b>「含水」在 0—1 之间，「注水」在 45—65 之间。如果不标准化，梯度下降会优先去调数值大的那一列，含水、事件这类真正关键的特征就被忽略了。<b>标准化后所有特征都是「比历史均值高几个标准差」，既数值平衡又可解释。</b>'
    };
  }

  /* =========================================================
     ④ MLP 前向传播
     ========================================================= */
  function stage4(t) {
    var c = compute();
    var s = '';
    var net = c.net;
    var x = c.Xs[c.Xs.length - 1];
    var fw = net.forward(x);
    var shownIn = Math.min(NF, Math.floor(ease(clamp(t * 1.4, 0, 1)) * NF) + 1);
    var shownH = Math.min(net.nH, Math.floor(ease(clamp((t - 0.35) * 2, 0, 1)) * net.nH) + 1);

    s += G.panel(0, '① 输入层 14 个 z 分数', '标准化后的特征行', C.jade);
    s += G.panel(1, '② 隐层 7 个神经元', '加权求和 → tanh 激活', C.blue);
    s += G.panel(2, '③ 输出层：预测产量', 'ŷ = Σ hⱼW₂ⱼ + b₂', C.clay);

    /* 左：输入层 */
    var x0 = 40, y0 = 118, wIn = 30, hIn = 150;
    s += G.txt(30, 100, '输入层 14→', { size: 9.5, fill: C.ink2, weight: 700 });
    var zMax = Math.max.apply(null, x.map(Math.abs)) || 1;
    for (var i = 0; i < NF; i++) {
      var iy = y0 + i * (hIn / NF);
      var z = x[i];
      var on = i < shownIn;
      var bw = 11;
      var hh = Math.min(1, Math.abs(z) / zMax) * (hIn / NF - 2);
      var cxx = x0 + (z >= 0 ? 0 : -bw);
      s += G.rect(cxx, iy + (hIn / NF - hh) / 2, bw, hh, {
        fill: z >= 0 ? C.jade : C.clay, op: on ? 0.9 : 0.18, r: 1.5
      });
      s += G.txt(x0 + 20, iy + (hIn / NF) / 2 + 3, FN[i], { size: 7.4, mono: true, fill: on ? C.ink2 : C.ink4 });
      if (on) s += G.txt(x0 + 62, iy + (hIn / NF) / 2 + 3, f(z, 2), { size: 7.6, mono: true, fill: C.ink3 });
    }
    s += footBox(30, 250, 300, 148, '神经元之间怎么连',
      ['14 个输入 → 7 个隐层 → 1 个输出，',
       '共 14×7 + 7 + 7 + 1 = 113 个参数。',
       '',
       '每个隐神经元拿 14 个输入各自乘一个权重',
       '再相加，过一个 tanh 压到 (−1,1)。',
       '',
       '「每个神经元盯住几个特征」由训练决定。'], 'jade');

    /* 中：隐层 */
    var mx = 330, my = 118, nH = net.nH, hw = 150;
    s += G.txt(322, 100, '隐层 7 个神经元 →', { size: 9.5, fill: C.ink2, weight: 700 });
    var hstep = hIn / nH;
    for (var j = 0; j < nH; j++) {
      var hy = my + j * hstep;
      var hv = fw.h[j];
      var on2 = j < shownH;
      /* 权重连线（只画当前神经元的） */
      if (on2) {
        for (var i2 = 0; i2 < NF; i2++) {
          var wv = net.W1[i2][j];
          var iy2 = y0 + i2 * (hIn / NF) + (hIn / NF) / 2;
          var hy2 = hy + hstep / 2;
          s += G.line(x0 + 11, iy2, mx + 26, hy2, {
            stroke: wv >= 0 ? C.jade : C.clay,
            sw: Math.min(2.4, Math.abs(wv) * 2.2), op: clamp(Math.abs(wv) * 0.8, 0.08, 0.4)
          });
        }
      }
      var hh2 = Math.min(1, Math.abs(hv)) * (hstep - 6);
      s += G.rect(mx + 26, hy + (hstep - hh2) / 2, 26, hh2, {
        fill: hv >= 0 ? C.blue : C.purple, op: on2 ? 0.9 : 0.18, r: 3
      });
      s += G.txt(mx + 58, hy + hstep / 2 + 3, 'h' + (j + 1), { size: 8, mono: true, fill: on2 ? C.ink2 : C.ink4 });
      if (on2) s += G.txt(mx + 80, hy + hstep / 2 + 3, f(hv, 3), { size: 8, mono: true, fill: C.ink3 });
    }
    s += G.txt(322, 300, '绿线=正权重　棕线=负权重', { size: 8.6, fill: C.ink3 });
    s += G.txt(322, 316, '线越粗，权重绝对值越大', { size: 8.6, fill: C.ink3 });
    s += G.rect(322, 330, 250, 118, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(334, 350, '一个隐神经元在算什么', { size: 9.4, fill: '#2b4a72', weight: 700 });
    s += G.txt(334, 368, 'hⱼ = tanh( bⱼ + Σᵢ xᵢ·W₁ᵢⱼ )', { size: 9.4, mono: true, fill: '#2b4a72' });
    s += G.txt(334, 390, '当前 h' + (Math.min(nH, shownH)) + ' = tanh(' +
      f(net.b1[Math.min(nH, shownH) - 1] + (function () {
        var sm = 0, i3;
        for (i3 = 0; i3 < NF; i3++) sm += x[i3] * net.W1[i3][Math.min(nH, shownH) - 1];
        return sm;
      })(), 3) + ')', { size: 8.8, mono: true, fill: '#4a607d' });
    s += G.txt(334, 408, '= tanh(' + f(fw.h[Math.min(nH, shownH) - 1], 3) + ')',
      { size: 9.4, mono: true, fill: '#2b4a72', weight: 700 });
    s += G.txt(334, 430, 'tanh 把结果压到 (−1,1)，避免线性爆炸', { size: 8.4, fill: '#5d7089' });

    /* 右：输出 */
    var rx = 716;
    s += G.txt(716, 100, '输出层', { size: 10, fill: C.ink2, weight: 700 });
    var oy = 200;
    /* 隐层到输出 */
    for (j = 0; j < nH; j++) {
      if (j >= shownH) continue;
      var hy3 = my + j * hstep + hstep / 2;
      var w2v = net.W2[j];
      s += G.line(mx + 52, hy3, rx + 40, oy, {
        stroke: w2v >= 0 ? C.jade : C.clay, sw: Math.min(2.6, Math.abs(w2v) * 3), op: clamp(Math.abs(w2v) * 0.9, 0.1, 0.5)
      });
    }
    s += G.circle(rx + 58, oy, 26, { fill: C.clayL, stroke: C.clay, sw: 1.4 });
    s += G.txt(rx + 58, oy - 2, 'ŷ', { size: 15, mono: true, fill: '#8a4f27', anchor: 'middle', weight: 700 });
    s += G.txt(rx + 58, oy + 14, f(fw.o, 2) + ' t/d', { size: 9, mono: true, fill: '#8a4f27', anchor: 'middle' });
    s += G.txt(rx + 96, oy - 6, '预测产量', { size: 9, fill: C.ink2, weight: 700 });
    s += G.txt(rx + 96, oy + 8, '实际 ' + f(c.w.q[c.t0 - 1], 2) + ' t/d', { size: 9, mono: true, fill: C.ink3 });
    s += G.rect(rx, 256, 256, 90, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(rx + 12, 276, '训练：反向传播', { size: 9.4, fill: C.ink, weight: 700 });
    s += G.txt(rx + 12, 296, '误差 e = ŷ − y', { size: 9, mono: true, fill: C.ink2 });
    s += G.txt(rx + 12, 314, '∂L/∂W₂ⱼ = e·hⱼ', { size: 9, mono: true, fill: C.ink2 });
    s += G.txt(rx + 12, 332, '∂L/∂W₁ = e·W₂ⱼ·(1−hⱼ²)·x', { size: 8.6, mono: true, fill: C.ink2 });
    s += G.txt(rx + 130, 332, '→ W −= lr·grad', { size: 8.6, mono: true, fill: C.clay, weight: 700 });
    s += footBox(rx, 256, 358, 90, '损失曲线',
      ['每次反向传播后损失都掉一截；90 轮后收敛。',
       '右边的曲线就是实时训练出来的。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '网络结构', v: NF + '→7→1', tone: 'ok' },
        { k: '参数量', v: NF * 7 + 7 + 7 + 1 },
        { k: '输出 ŷ', v: f(fw.o, 3) + ' t/d' },
        { k: '训练损失', v: f(c.lossHist[c.lossHist.length - 1], 3) }
      ],
      note: '<b>这一层网络在物理上意味着什么：</b>每个隐神经元是「若干个特征的某种组合」。训练会自己找出哪些组合对产量有解释力——比如「近 7 天均值 × 含水」可能是一个有意义的组合。<b>但这些组合是数据找出来的，不是工程师写出来的</b>，所以必须配合下面的滚动原点验证来确认它不是过拟合。'
    };
  }

  /* =========================================================
     ⑤ 滚动原点验证
     ========================================================= */
  function stage5(t) {
    var c = compute(), wf = c.wf;
    var s = '';
    var origins = wf.origins;
    var oi = Math.min(origins.length - 1, Math.floor(ease(clamp(t, 0, 1)) * origins.length));

    s += G.panel(0, '① 滚动原点协议', '每个原点都「只用过去预测未来」', C.jade);
    s += G.panel(1, '② 三个模型同台竞技', '同一协议、同一数据、同一步长', C.blue);
    s += G.panel(2, '③ 谁真的更准', 'MAPE / 偏差 / 区间覆盖率', C.clay);

    /* 左：协议示意 */
    var x0 = 30, y0 = 116, ww = 250, h = 150;
    var qMax = Math.max.apply(null, c.w.q) * 1.1;
    s += G.axes(x0, y0, ww, h, { nx: 4, ny: 4 });
    /* 训练段 + 预测段（当前原点） */
    var t0 = origins[oi];
    var trTo = x0 + t0 / c.w.N * ww;
    var fcTo = x0 + Math.min(c.w.N, t0 + c.L.H) / c.w.N * ww;
    s += G.rect(x0, y0, trTo - x0, h, { fill: C.jadeL, op: 0.8 });
    s += G.rect(trTo, y0, fcTo - trTo, h, { fill: C.blueL, op: 0.85 });
    s += G.line(trTo, y0, trTo, y0 + h, { stroke: C.clay, sw: 1.6 });
    s += polyOf(c.w.q, x0, y0, ww, h, 0, qMax, C.ink4, 1.1);
    s += G.txt(x0 + 4, y0 + 12, '训练：前 ' + t0 + ' 天', { size: 8.4, fill: C.jadeD, weight: 700 });
    s += G.txt(trTo + 4, y0 + 12, '预测：未来 ' + c.L.H + ' 天', { size: 8.4, fill: '#2b4a72', weight: 700 });
    s += G.txt(x0, y0 - 10, '第 ' + (oi + 1) + ' 个原点 t=' + t0, { size: 9.5, fill: C.ink2, weight: 700 });
    s += footBox(30, 250, 300, 148, '为什么不能「回头看」',
      ['如果用全序列训练再回头预测，',
       '等于考试时偷看了答案。',
       '',
       '滚动原点：训练 → 预测 → 窗口前移 20 天，',
       '共 10 个原点，每个原点都只看它之前的',
       '数据。这样测出来的误差，才是上线',
       '真正会遇到的误差。'], 'jade');

    /* 中：三个模型的预测 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    var run = wf.per.mlp[oi];
    if (run) {
      var actual = run.actual, pv = [];
      for (var i = 0; i < actual.length; i++) pv.push(actual[i]);
      s += polyOf(pv, mx, my, mw, mh, 0, qMax, C.ink4, 1.4);
      var models = [['arps', C.gray, 'Arps'], ['ridge', C.blue, '岭回归'], ['mlp', C.purple, 'MLP']];
      for (var mi = 0; mi < models.length; mi++) {
        var run2 = wf.per[models[mi][0]][oi];
        if (!run2) continue;
        var pp = run2.pred;
        s += polyOf(pp, mx, my, mw, mh, 0, qMax, models[mi][1], 1.7, mi === 0 ? '5 3' : null);
      }
    }
    s += G.txt(mx, my - 10, '第 ' + (oi + 1) + ' 个原点上的三条预测', { size: 9.5, fill: C.ink2, weight: 700 });
    var lx = mx;
    var lbl = [['灰虚线 Arps', C.gray], ['蓝 岭回归', C.blue], ['紫 MLP', C.purple], ['深灰 实际', C.ink3]];
    for (i = 0; i < lbl.length; i++) {
      s += G.txt(lx, my + mh + 16, lbl[i][0], { size: 8.2, fill: lbl[i][1], weight: 700 });
      lx += lbl[i][0].length * 6.2 + 8;
    }
    s += G.rect(320, 300, 250, 148, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(332, 320, '三个模型在比什么', { size: 9.6, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 342, 'A · Arps：指数递减，工程经验公式', { size: 8.8, fill: '#2b4a72' });
    s += G.txt(332, 360, 'B · 岭回归：14 个特征的线性组合', { size: 8.8, fill: '#2b4a72' });
    s += G.txt(332, 378, 'C · MLP：14→7→1 的非线性网络', { size: 8.8, fill: '#2b4a72' });
    s += G.txt(332, 402, '三者的差异全部来自「能不能表达跳变」：', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 420, 'Arps 假设产量平滑递减，', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 434, '措施台上必然失真。', { size: 8.8, fill: '#8a4f27', weight: 700 });

    /* 右：MAPE 对比 */
    s += G.txt(716, 100, '10 个原点 × H 天的实测 MAPE', { size: 10, fill: C.ink2, weight: 700 });
    var names = [['arps', 'Arps', C.gray], ['ridge', '岭回归', C.blue], ['mlp', 'MLP', C.purple]];
    var vals = [];
    for (i = 0; i < names.length; i++) {
      vals.push(wf.stats[names[i][0]] ? wf.stats[names[i][0]].mape : 0);
    }
    var mxv = Math.max.apply(null, vals) || 1;
    for (i = 0; i < names.length; i++) {
      var yy = 122 + i * 52;
      s += G.txt(716, yy + 12, names[i][1], { size: 9.6, fill: names[i][2], weight: 700 });
      s += G.rect(716, yy + 20, 256, 16, { r: 3, fill: '#f1f1ee' });
      s += G.rect(716, yy + 20, Math.max(2, vals[i] / mxv * 256), 16, { r: 3, fill: names[i][2], op: 0.85 });
      s += G.txt(716 + Math.max(2, vals[i] / mxv * 256) + 5, yy + 33, f(vals[i], 2) + '%',
        { size: 9, mono: true, fill: C.ink2, weight: 700 });
    }
    var bestName = wf.best === 'arps' ? 'Arps' : wf.best === 'ridge' ? '岭回归' : 'MLP';
    s += G.rect(716, 286, 256, 60, { r: 6, fill: C.jadeL, stroke: '#b9d8cb' });
    s += G.txt(728, 306, '最优：' + bestName, { size: 10.5, fill: C.jadeD, weight: 700 });
    s += G.txt(728, 326, 'MAPE = 平均绝对百分比误差', { size: 8.8, fill: '#3f6b5d' });
    s += G.txt(728, 340, '在 ' + origins.length + ' 个原点、每个 ' + c.L.H + ' 天上实测', { size: 8.6, fill: '#3f6b5d' });
    /* 预测区间 */
    s += G.rect(716, 358, 256, 90, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(728, 378, '80% 预测区间', { size: 9.4, fill: C.ink, weight: 700 });
    s += G.txt(728, 398, '用最优模型的实测残差分位数', { size: 8.8, fill: C.ink2 });
    s += G.txt(728, 414, '（第 10%/90% 分位），随步长放宽', { size: 8.8, fill: C.ink2 });
    s += G.txt(728, 436, '不是「拍」出来的形状，是数据说了算', { size: 8.8, fill: C.clay, weight: 700 });

    return {
      svg: s,
      stats: [
        { k: '验证原点', v: origins.length + ' 个' },
        { k: '预测步长', v: c.L.H + ' 天' },
        { k: '最优模型', v: bestName, tone: 'ok' },
        { k: '最优 MAPE', v: f(Math.min.apply(null, vals), 2) + '%', tone: 'ok' }
      ],
      note: '<b>滚动原点验证是这个案例的方法论核心。</b>在工业场景里，「模型准确率」几乎都靠数据泄漏刷出来——训练时用了预测时点之后的信息。只有滚动原点协议（每个原点只用它之前的数据训练，再往前推 H 天）测出来的 MAPE，才是上线后真正会遇到的误差。<b>而且它同时证明了「智能化优于经验公式」这件事。</b>'
    };
  }

  /* =========================================================
     ⑥ ITS 反事实归因
     ========================================================= */
  function stage6(t) {
    var c = compute();
    var s = '';
    var ai = c.attrIts, an = c.attrNaive;
    if (!ai) {
      s += G.panel(0, '① 没有措施事件', '本例井型无措施，无法做归因', C.gray);
      s += G.panel(1, '② 换一个井型', '选「压裂见效井」即可看完整归因', C.gray);
      s += G.panel(2, '③ 反事实方法', '中断时间序列 ITS', C.gray);
      return { svg: s, stats: [{ k: '措施事件', v: '无' }], note: '当前井型没有措施事件，换一个井型（如「压裂见效井」）即可看到完整的反事实归因演示。' };
    }

    s += G.panel(0, '① 事件前后', ai.ev.type + ' 发生在 t=' + ai.t0, C.jade);
    s += G.panel(1, '② 反事实：假装没做', '训练只用事件前，预测屏蔽事件特征', C.blue);
    s += G.panel(2, '③ 增量 = 实际 − 反事实', '橙带就是这次措施的增产', C.clay);

    var lo = 0, hi = Math.max.apply(null, ai.actual) * 1.25;
    /* 左：实际曲线 + 事件 */
    var x0 = 30, y0 = 116, ww = 250, h = 150;
    s += G.axes(x0, y0, ww, h, { nx: 4, ny: 4 });
    var tStart = ai.t0 - 120;
    var seg = [];
    for (var i = 0; i < ai.horizon; i++) seg.push(ai.actual[i]);
    var pre = [];
    for (i = tStart; i < ai.t0; i++) pre.push(c.w.q[i]);
    var preAll = [];
    for (i = tStart; i < ai.t0 + ai.horizon; i++) preAll.push(c.w.q[i]);
    s += polyOf(preAll, x0, y0, ww, h, lo, hi, C.ink4, 1.3);
    var evX = x0 + 120 / (120 + ai.horizon) * ww;
    s += G.line(evX, y0, evX, y0 + h, { stroke: C.clay, dash: '4 3', sw: 1.4 });
    s += G.txt(evX + 3, y0 + 12, ai.ev.type, { size: 8.4, fill: C.clay, weight: 700 });
    s += G.txt(x0, y0 - 10, '实际产量：事件前 120 天 + 事件后 ' + ai.horizon + ' 天', { size: 9, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + h + 16, '事件的台阶在 t=' + ai.t0 + ' 处', { size: 8.6, fill: C.ink3 });
    s += footBox(30, 250, 300, 148, '归因要回答的问题',
      ['这次压裂到底增产了多少？',
       '',
       '直觉做法：拿措施后的产量减去措施前——',
       '错。产量本来就在自然递减，',
       '这一减把递减也算成了「措施无效」。',
       '',
       '正确做法：造一条「假如没做压裂」的',
       '假想曲线（反事实），再和实际比。'], 'jade');

    /* 中：反事实构造 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    var cf = ai.cf;
    s += polyOf(cf, mx, my, mw, mh, lo, hi, C.blue, 1.8);
    s += polyOf(seg, mx + 120 / (120 + ai.horizon) * mw, my, mw - 120 / (120 + ai.horizon) * mw, mh, lo, hi, C.jade, 1.8);
    s += G.line(mx + 120 / (120 + ai.horizon) * mw, my, mx + 120 / (120 + ai.horizon) * mw, my + mh,
      { stroke: C.clay, dash: '4 3', sw: 1.3 });
    s += G.txt(mx, my - 10, '蓝=反事实　绿=实际', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(mx, my + mh + 16, '反事实：训练只用事件前 120 天，预测时屏蔽事件特征', { size: 8.4, fill: C.ink3 });
    s += G.rect(320, 300, 250, 148, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(332, 320, '两种口径的差别', { size: 9.6, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 342, 'ITS（正确）', { size: 9.2, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 358, '训练段 = 事件前 120 天', { size: 8.8, mono: true, fill: '#4a607d' });
    s += G.txt(332, 374, '预测时事件特征 = 0', { size: 8.8, mono: true, fill: '#4a607d' });
    s += G.txt(332, 396, 'naive（错误示范）', { size: 9.2, fill: '#8a4f27', weight: 700 });
    s += G.txt(332, 412, '训练段 = 事件前 + 事件后（泄露）', { size: 8.8, mono: true, fill: '#8a4f27' });
    s += G.txt(332, 428, '事件特征全开', { size: 8.8, mono: true, fill: '#8a4f27' });
    s += G.txt(332, 444, '→ 模型把增量学进了预测，增量被吞掉', { size: 8.4, fill: '#8a4f27', weight: 700 });

    /* 右：增量带 + 两种口径对比 */
    var rx = 716;
    s += G.txt(rx, 100, '增量带（实际 − 反事实）', { size: 10, fill: C.ink2, weight: 700 });
    s += G.axes(rx, 112, 256, 96, { nx: 4, ny: 4 });
    /* 增量多边形 */
    var incPts = [], i2;
    for (i2 = 0; i2 < ai.inc.length; i2++) {
      incPts.push([rx + i2 / (ai.inc.length - 1) * 256, 112 + 96 - (ai.inc[i2] / (hi * 0.5)) * 96]);
    }
    var incPath = '';
    for (i2 = 0; i2 < incPts.length; i2++) incPath += (i2 ? 'L' : 'M') + incPts[i2][0].toFixed(1) + ' ' + incPts[i2][1].toFixed(1) + ' ';
    for (i2 = incPts.length - 1; i2 >= 0; i2--) incPath += 'L' + incPts[i2][0].toFixed(1) + ' ' + (112 + 96) + ' ';
    s += G.path(incPath + 'Z', { fill: C.clay, op: 0.35 });
    s += G.poly(incPts, { stroke: C.clay, sw: 1.8 });
    s += G.txt(rx, 226, '平均日增量 ' + f(ai.gain, 2) + ' t/d', { size: 9.4, mono: true, fill: C.clay, weight: 700 });
    s += G.txt(rx, 242, '80% 区间 ' + f(ai.gainLo, 2) + ' … ' + f(ai.gainHi, 2), { size: 8.8, mono: true, fill: C.ink3 });

    /* 两种口径对比 */
    s += G.rect(rx, 256, 256, 90, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(rx + 12, 276, '两种口径算出的增量', { size: 9.4, fill: C.ink, weight: 700 });
    s += G.txt(rx + 12, 298, 'ITS 反事实口径', { size: 9, fill: C.jadeD, weight: 700 });
    s += G.txt(rx + 150, 298, f(ai.gain, 2) + ' t/d', { size: 10, mono: true, fill: C.jadeD, weight: 700 });
    s += G.txt(rx + 12, 318, 'naive 口径（泄露）', { size: 9, fill: C.red, weight: 700 });
    s += G.txt(rx + 150, 318, f(an.gain, 2) + ' t/d', { size: 10, mono: true, fill: C.red, weight: 700 });
    var leak = ai.gain > 0.01 ? (1 - an.gain / ai.gain) * 100 : 0;
    s += G.txt(rx + 12, 338, 'naive 吞掉了 ' + f(clamp(leak, 0, 999), 0) + '% 的增产', { size: 8.8, fill: C.red, weight: 700 });
    s += footBox(rx, 256, 358, 90, '这就是「智能算法赋能」的落点',
      ['同样的数据、同样的模型，只因为训练段',
       '选得对，增产就能算回来——',
       '这是能直接写进汇报里的经济价值。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '措施事件', v: ai.ev.type + ' @t=' + ai.t0, tone: 'ok' },
        { k: 'ITS 增量', v: f(ai.gain, 2) + ' t/d', tone: 'ok' },
        { k: 'naive 增量', v: f(an.gain, 2) + ' t/d', tone: 'bad' },
        { k: '被吞掉比例', v: f(clamp(leak, 0, 999), 0) + '%', tone: 'warn' }
      ],
      note: '<b>这是本案例最有经济价值的部分。</b>措施归因做错一次，管理层就会认为「压裂没用」——那是要花真金白银去验证的结论。<b>反事实口径与 naive 口径只差「训练段怎么选、事件特征屏蔽不屏蔽」，算出来的增量却天差地别。</b>'
    };
  }

  global.PfFlow = {
    stage1: stage1, stage2: stage2, stage3: stage3,
    stage4: stage4, stage5: stage5, stage6: stage6, compute: compute
  };
})(typeof window !== 'undefined' ? window : this);
