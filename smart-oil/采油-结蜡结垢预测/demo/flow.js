/* =========================================================
   结蜡结垢预测 · 算法解剖（滑窗特征 → 趋势检测 → 外推 → 分级）
   ---------------------------------------------------------
   把「产液时序 → 清防作业安排」拆成 6 步，每一步都跑真代码：

     ① 产液 + 温度信号   结蜡与结垢在数据上留下不同痕迹
     ② 滑动窗口特征     逐窗算递减斜率 / 压力爬升 / 温度偏离
     ③ 两种检测器       只看绝对值 vs 看趋势，慢蜡井的对照
     ④ 线性回归拟合     用最近 W 天拟合递减直线
     ⑤ 外推求剩余窗口   直线延伸到跌破「需清蜡阈值」那天
     ⑥ 蜡×垢二维分级     30 口井排作业顺序，替代固定周期

   依赖：window.WaxBridge（demo.js 暴露的真模型）
        window.AFlow（算法解剖引擎）
   ========================================================= */
(function (global) {
  'use strict';

  var B = global.WaxBridge;
  if (!B || !global.AFlow) return;

  var G = global.AFlow.G, C = global.AFlow.C;
  var L_DAYS = B.L, THRESH = B.THRESH;

  var KIND_CN = { normal: '平稳井', 'wax-fast': '快蜡井', 'wax-slow': '慢蜡井', scale: '垢堵井' };
  var KIND_COL = { normal: C.jade, 'wax-fast': C.clay, 'wax-slow': C.amber, scale: C.purple };
  var DEC_CN = { mild: '轻度结蜡', moderate: '中度结蜡', severe: '重度结蜡' };

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

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.kind, L.noise, L.win1, L.decKind, L.day, L.win2, L.thr].join(',');
    if (cache.key === key) return cache;
    var g = B.genWell(L.kind, L.noise);
    var W = L.win1;
    var absS = [], treS = [], riskSeg = [], slopeArr = [], pressArr = [], tempArr = [];
    for (var i = 0; i < L_DAYS; i++) {
      absS.push(Math.abs(g.base[i] - 100) / 8);
      var sl = B.slopeWin(g.base, W, i);
      treS.push(Math.max(0, -sl) / 0.09);
      riskSeg.push(g.base[i] < 92);
      slopeArr.push(clamp(-sl / 0.3, 0, 1));
      pressArr.push(clamp((g.press[i] - 1.8) / 0.8, 0, 1));
      tempArr.push(clamp((52 - g.temp[i]) / 6, 0, 1));
    }
    function rate(arr, seg) {
      var c = 0, t = 0;
      for (var j = 0; j < L_DAYS; j++) if (seg[j]) { t++; if (arr[j] > 1) c++; }
      return t ? c / t * 100 : null;
    }
    function fp(arr, seg) {
      var c = 0, t = 0;
      for (var j = 0; j < L_DAYS; j++) if (!seg[j]) { t++; if (arr[j] > 1) c++; }
      return t ? c / t * 100 : 0;
    }
    /* 屏 2：清防时机 */
    var dg = B.genDecay(L.decKind);
    var T = L.day, W2 = L.win2;
    var realWin = dg.breakAt - T;
    var sub = dg.data.slice(Math.max(0, T - W2), T + 1);
    var lr = B.linReg(sub), cur = dg.data[T];
    var estWin = lr.k < 0 ? Math.max(0, (cur - THRESH) / -lr.k) : null;
    /* 教学场景：固定用「慢蜡井」做两种检测器的对照
       （慢蜡井的产液一直没跌破风险线，正是「只看绝对值会漏掉」的典型） */
    var gs = B.genWell('wax-slow', L.noise);
    var absS2 = [], treS2 = [], riskSeg2 = [];
    for (i = 0; i < L_DAYS; i++) {
      absS2.push(Math.abs(gs.base[i] - 100) / 8);
      treS2.push(Math.max(0, -B.slopeWin(gs.base, W, i)) / 0.09);
      riskSeg2.push(gs.base[i] < 92);
    }
    var hitZ2 = rate(treS2, riskSeg2), hitA2 = rate(absS2, riskSeg2);
    var fpZ2 = fp(treS2, riskSeg2), fpA2 = fp(absS2, riskSeg2);
    /* 首次报警日与提前量——评价这类检测器真正该看的指标 */
    function firstAlarm(arr) { for (var i2 = 0; i2 < arr.length; i2++) if (arr[i2] > 1) return i2; return -1; }
    var riskStart2 = -1;
    for (i = 0; i < L_DAYS; i++) if (riskSeg2[i]) { riskStart2 = i; break; }
    var firstA2 = firstAlarm(absS2), firstT2 = firstAlarm(treS2);
    var lead2 = (firstA2 >= 0 && firstT2 >= 0) ? firstA2 - firstT2 : null;

    /* 屏 3：分级 */
    var thr = L.thr;
    var highThr = 0.78 - 0.55 * thr, midThr = 0.50 - 0.40 * thr;
    var fleet = B.fleet();
    var classified = fleet.map(function (w) {
      var r = w.x + w.y;
      return { w: w, r: r, lv: r > highThr ? '高' : (r > midThr ? '中' : '低'), real: clamp(w.x * 0.9 + w.y * 0.9 + 0.05, 0, 1) };
    });
    var high = classified.filter(function (c) { return c.lv === '高'; });
    var mid = classified.filter(function (c) { return c.lv === '中'; });
    var need = high.concat(mid);
    var hit = need.length ? need.filter(function (c) { return c.real > 0.35; }).length / need.length * 100 : 100;
    var ops = high.length + 0.6 * mid.length;
    var save = (B.WELLS - ops) / B.WELLS * 100;
    cache = {
      key: key, L: L, g: g, absS: absS, treS: treS, riskSeg: riskSeg,
      slopeArr: slopeArr, pressArr: pressArr, tempArr: tempArr,
      hitZ: rate(treS, riskSeg), hitA: rate(absS, riskSeg),
      fpZ: fp(treS, riskSeg), fpA: fp(absS, riskSeg),
      gs: gs, absS2: absS2, treS2: treS2, riskSeg2: riskSeg2,
      hitZ2: hitZ2, hitA2: hitA2, fpZ2: fpZ2, fpA2: fpA2,
      riskStart2: riskStart2, firstA2: firstA2, firstT2: firstT2, lead2: lead2,
      dg: dg, lr: lr, cur: cur, realWin: realWin, estWin: estWin, T: T, W2: W2,
      classified: classified, high: high, mid: mid, hit: hit, ops: ops, save: save,
      highThr: highThr, midThr: midThr
    };
    return cache;
  }

  /* =========================================================
     ① 产液 + 温度信号
     ========================================================= */
  function stage1(t) {
    var c = compute(), g = c.g, L = c.L;
    var s = '';
    s += G.panel(0, '① 产液 + 井口温度', '两个最便宜的日常参数', C.jade);
    s += G.panel(1, '② 结蜡留下什么痕迹', '油管被蜡堵小 → 有效管径变小', C.blue);
    s += G.panel(2, '③ 结垢留下什么痕迹', '近井地带污染 → 流动阻力变大', C.clay);

    var x0 = 30, y0 = 116, ww = 250, h = 150;
    var lo = 70, hi = 106;
    s += G.axes(x0, y0, ww, h, { nx: 4, ny: 4 });
    /* 风险线 */
    s += G.line(x0, y0 + h - (92 - lo) / (hi - lo) * h, x0 + ww, y0 + h - (92 - lo) / (hi - lo) * h,
      { stroke: C.clay, dash: '4 3', sw: 1.3 });
    s += G.txt(x0 + ww - 2, y0 + h - (92 - lo) / (hi - lo) * h - 5, '风险线 92 t/d',
      { size: 8.4, fill: C.clay, anchor: 'end' });
    var upto = Math.max(2, Math.floor(ease(clamp(t, 0, 1)) * L_DAYS));
    s += polyOf(g.base.slice(0, upto), x0, y0, ww, h, lo, hi, C.blue, 1.6);
    s += G.txt(x0, y0 - 10, '日产油 q(t)　t/d', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + h + 16, g.state + '　已显示 ' + upto + ' / ' + L_DAYS + ' 天', { size: 9, fill: C.ink3 });
    s += footBox(30, 250, 300, 148, '为什么盯产液和温度',
      ['这两个参数每口井都有、每天都有，',
       '不用加装任何仪表。',
       '',
       '结蜡：油管内径被蜡占掉 → 有效流通面积变小',
       '→ 同样压差下产液下降。',
       '',
       '温度是放大器：管外温度低于析蜡点时，',
       '蜡才析出。所以冬天或注冷水时结蜡更凶。'], 'jade');

    /* 中：结蜡机理 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    /* 油管截面示意：内径变小 */
    s += G.rect(mx + 20, my + 30, 76, 90, { r: 6, fill: '#f4f1e8', stroke: C.ink4, sw: 1.4 });
    s += G.rect(mx + 34, my + 44, 48, 62, { r: 4, fill: '#fff', stroke: C.ink3, sw: 1 });
    s += G.rect(mx + 44, my + 54, 28, 42, { r: 3, fill: '#d9b78e', stroke: C.clay, sw: 1.2 });
    s += G.txt(mx + 58, my + 78, '蜡', { size: 10, fill: '#8a4f27', anchor: 'middle', weight: 700 });
    s += G.txt(mx + 58, my + 100, '有效内径↓', { size: 8.4, fill: C.clay, anchor: 'middle' });
    /* 温度曲线 */
    s += polyOf(g.temp, mx + 110, my, mw - 130, mh, 48, 54, C.clay, 1.5);
    s += G.line(mx + 110, my + mh - (52 - 48) / 6 * mh, mx + mw - 20, my + mh - (52 - 48) / 6 * mh,
      { stroke: C.amber, dash: '4 3', sw: 1.2 });
    s += G.txt(mx + 112, my + mh - (52 - 48) / 6 * mh - 4, '析蜡点 52℃', { size: 8.4, fill: C.amber });
    s += G.txt(mx + 110, my - 10, '油管内径与井口温度', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(mx, my + mh + 16, '温度越低、蜡越多 → 有效内径越小 → 产液越低', { size: 8.6, fill: C.ink3 });
    s += footBox(320, 250, 300, 148, '两个信号要一起看',
      ['产液下降可能是结蜡（内径变小），',
       '也可能是结垢（近井地带污染）。',
       '',
       '区分办法：结垢时井口压力会明显爬升——',
       '因为要更大的压差才能把同样的液量挤出来。',
       '',
       '所以模型要的不是「产液降没降」，',
       '而是「降的同时压力在不在涨」。'], 'blue');

    /* 右：结垢 */
    s += G.txt(716, 100, '结垢：压力爬升比产液下降更早', { size: 10, fill: C.ink2, weight: 700 });
    s += G.axes(716, 112, 256, 110, { nx: 4, ny: 4 });
    /* 压力曲线 */
    var pLo = 1.6, pHi = 2.2;
    s += polyOf(g.press, 716, 112, 256, 110, pLo, pHi, C.purple, 1.8);
    s += G.txt(716, 232, '井口压力（MPa）', { size: 8.6, fill: C.purple, weight: 700 });
    s += G.txt(716, 248, '初始 1.8 MPa', { size: 8.4, fill: C.ink3, mono: true });
    s += G.txt(970, 248, '当前 ' + f(g.press[L_DAYS - 1], 3) + ' MPa', { size: 8.4, fill: C.purple, anchor: 'end', mono: true, weight: 700 });
    s += footBox(716, 256, 264, 184, '四种井的信号指纹',
      ['平稳井：产液平、温度稳、压力平。',
       '　→ 延长清蜡周期，别白白清。',
       '快蜡井：产液陡降、温度明显走低。',
       '　→ 两种检测器都报，尽快排热洗。',
       '慢蜡井：产液缓降，仍在风险线上方。',
       '　→ 只看绝对值会漏；看趋势能抓住。',
       '垢堵井：产液略降，但压力明显爬升。',
       '　→ 要靠「递减 + 压力」两个信号才认得出。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '井型', v: g.state, tone: 'ok' },
        { k: '当前产液', v: f(g.base[L_DAYS - 1], 1) + ' t/d' },
        { k: '井口温度', v: f(g.temp[L_DAYS - 1], 1) + ' ℃' },
        { k: '井口压力', v: f(g.press[L_DAYS - 1], 3) + ' MPa' }
      ],
      note: '<b>石油场景的智能化常常从「已有的便宜数据」开始。</b>产液、温度、压力这三样不需要新增投资，但它们在时序上的<b>形状</b>就写着井的健康状况。智能化的第一课不是上什么模型，而是<b>知道该看哪几个信号、怎么组合着看</b>。'
    };
  }

  /* =========================================================
     ② 滑动窗口特征
     ========================================================= */
  function stage2(t) {
    var c = compute(), g = c.g, L = c.L;
    var s = '';
    var W = L.win1;
    var tEnd = Math.max(W, Math.floor(ease(clamp(t, 0, 1)) * L_DAYS));

    s += G.panel(0, '① 窗口沿时序滑动', '每次只看最近 W 天的产液', C.jade);
    s += G.panel(1, '② 窗口内算三个特征', '递减斜率 / 压力爬升 / 温度偏离', C.blue);
    s += G.panel(2, '③ 三条特征曲线', '把时序变成可比较的信号', C.clay);

    /* 左：滑动窗口 */
    var x0 = 30, y0 = 116, ww = 250, h = 150, lo = 70, hi = 106;
    s += G.axes(x0, y0, ww, h, { nx: 4, ny: 4 });
    s += polyOf(g.base.slice(0, tEnd), x0, y0, ww, h, lo, hi, C.ink4, 1.2);
    var wStart = Math.max(0, tEnd - W);
    var wx0 = x0 + wStart / (L_DAYS - 1) * ww, wwid = W / (L_DAYS - 1) * ww;
    s += G.rect(wx0, y0, wwid, h, { fill: C.jade, op: 0.16 });
    s += G.rect(wx0, y0, wwid, h, { fill: 'none', stroke: C.jade, sw: 1.5 });
    s += G.txt(wx0 + 2, y0 - 4, '窗口 ' + W + ' 天', { size: 8.6, fill: C.jadeD, weight: 700 });
    for (var i = wStart; i < tEnd; i++) {
      s += G.circle(x0 + i / (L_DAYS - 1) * ww, y0 + h - (g.base[i] - lo) / (hi - lo) * h, 2,
        { fill: C.jade, op: 0.9 });
    }
    s += G.txt(x0, y0 - 10, '产液 q(t) 与当前窗口', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + h + 16, '窗口右端 t = ' + tEnd + ' / ' + L_DAYS, { size: 9, fill: C.jadeD, mono: true, weight: 700 });
    s += footBox(30, 250, 300, 148, '为什么要开窗口',
      ['单点值没有意义：今天产量低，可能是',
       '计量波动、也可能是一次降产。',
       '',
       '窗口 = 让算法看「一段时间」的趋势，',
       '而不是「一个瞬间」。',
       '',
       '窗口长度是权衡：太短被噪声带跑，',
       '太长反应太慢（井已经掉下去了才发现）。'], 'jade');

    /* 中：三个特征 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    /* 窗口内的点 + 拟合线 */
    var wpts = [], i2;
    for (i2 = wStart; i2 < tEnd; i2++) {
      wpts.push([mx + (i2 - wStart) / (W - 1) * mw, my + mh - (g.base[i2] - lo) / (hi - lo) * mh]);
    }
    s += G.poly(wpts, { stroke: C.ink4, sw: 1.1 });
    /* 线性回归（真算法） */
    var sub = g.base.slice(wStart, tEnd);
    var lr = B.linReg(sub);
    var y0f = my + mh - (lr.b - lo) / (hi - lo) * mh;
    var y1f = my + mh - (lr.k * (W - 1) + lr.b - lo) / (hi - lo) * mh;
    s += G.line(mx, y0f, mx + mw, y1f, { stroke: C.clay, sw: 2.1 });
    s += G.txt(mx + mw, y0f - 5, '斜率 k', { size: 8.4, fill: C.clay, anchor: 'end', weight: 700 });
    s += G.txt(mx, my - 10, '窗口内拟合出的递减直线', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(mx, my + mh + 16, 'k = ' + f(lr.k, 4) + ' t/d 每天', { size: 9, mono: true, fill: C.clay, weight: 700 });

    /* 三个特征读数 */
    var sl = c.slopeArr[tEnd - 1], pr = c.pressArr[tEnd - 1], tp = c.tempArr[tEnd - 1];
    s += G.rect(320, 300, 250, 148, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(332, 320, '当前窗口（t=' + (tEnd - 1) + '）的三个特征', { size: 9.6, fill: C.ink, weight: 700 });
    var rows = [
      ['递减斜率', f(sl, 3), C.blue, '产液在不在往下掉'],
      ['压力爬升', f(pr, 3), C.purple, '近井地带在不在变堵'],
      ['温度偏离', f(tp, 3), C.clay, '离析蜡点有多近']
    ];
    for (i2 = 0; i2 < 3; i2++) {
      var ry = 342 + i2 * 34;
      s += G.txt(332, ry, rows[i2][0], { size: 9.4, fill: rows[i2][2], weight: 700 });
      s += G.txt(410, ry, rows[i2][1], { size: 10, mono: true, fill: C.ink, weight: 700 });
      /* 小条 */
      s += G.rect(460, ry - 8, 60, 8, { r: 2, fill: '#f1f1ee' });
      s += G.rect(460, ry - 8, rows[i2][1] * 60, 8, { r: 2, fill: rows[i2][2], op: 0.85 });
      s += G.txt(332, ry + 12, rows[i2][3], { size: 8.2, fill: C.ink4 });
    }

    /* 右：三条特征曲线 */
    var rx = 716, ry2 = 116, rw = 256, rh = 150;
    s += G.axes(rx, ry2, rw, rh, { nx: 4, ny: 4 });
    s += polyOf(c.slopeArr.slice(0, tEnd), rx, ry2, rw, rh, 0, 1, C.blue, 1.6);
    s += polyOf(c.pressArr.slice(0, tEnd), rx, ry2, rw, rh, 0, 1, C.purple, 1.3);
    s += polyOf(c.tempArr.slice(0, tEnd), rx, ry2, rw, rh, 0, 1, C.clay, 1.3);
    s += G.txt(rx, ry2 - 10, '三条特征曲线（归一化到 0—1）', { size: 9.2, fill: C.ink2, weight: 700 });
    s += G.txt(rx, ry2 + rh + 16, '蓝=递减斜率　紫=压力爬升　棕=温度偏离', { size: 8.2, fill: C.ink3 });
    s += footBox(rx, 256, 300, 148, '特征怎么归一化',
      ['递减斜率 ÷ 0.3（一天掉 0.3 t/d 算满格）',
       '压力爬升 ÷ 0.8（涨 0.8 MPa 算满格）',
       '温度偏离 ÷ 6（离析蜡点 6℃ 算满格）',
       '',
       '归一化后三条曲线才能画在同一张图上比，',
       '也让后面的阈值判定有一个统一的刻度。',
       '',
       '这三个除数是现场经验值——',
       '它们本身就是「石油知识」的编码。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '窗口长度', v: W + ' 天' },
        { k: '窗口位置', v: tEnd + ' / ' + L_DAYS },
        { k: '递减斜率', v: f(sl, 3), tone: sl > 0.4 ? 'warn' : 'ok' },
        { k: '压力爬升', v: f(pr, 3) }
      ],
      note: '<b>特征工程的本质，是把「石油知识」翻译成可计算的数。</b>递减斜率、压力爬升、温度偏离这三个量，除数 0.3 / 0.8 / 6 不是数学推导出来的，而是<b>现场经验值</b>——正是这些经验被固化进代码，才让算法能替代人做判断。'
    };
  }

  /* =========================================================
     ③ 两种检测器
     ========================================================= */
  function stage3(t) {
    var c = compute(), L = c.L;
    var s = '';
    var shown = Math.max(2, Math.floor(ease(clamp(t, 0, 1)) * L_DAYS));

    s += G.panel(0, '① 检测器 A：只看绝对值', '|q − 100| / 8 > 1 就报警', C.jade);
    s += G.panel(1, '② 检测器 B：看趋势', 'max(0, −k) / 0.09 > 1 就报警', C.blue);
    s += G.panel(2, '③ 慢蜡井的对照', '本段固定用「慢蜡井」做对照', C.clay);

    /* 两个检测器的分数曲线 */
    function scorePanel(ci, title, sub, score, color, label) {
      var o = G.panel(ci, title, sub, color);
      var x0 = 30 + ci * 292, y0 = 116, w = 250, h = 120;
      o += G.axes(x0, y0, w, h, { nx: 4, ny: 4 });
      for (var i = 0; i < L_DAYS; i++) {
        if (!c.riskSeg2[i]) continue;
        o += G.rect(x0 + i / (L_DAYS - 1) * w, y0, w / (L_DAYS - 1) + 0.5, h, { fill: C.redL, op: 0.5 });
      }
      o += polyOf(score.slice(0, shown), x0, y0, w, h, 0, 1.8, color, 1.5);
      o += G.line(x0, y0 + h - 1 / 1.8 * h, x0 + w, y0 + h - 1 / 1.8 * h, { stroke: C.red, dash: '4 3', sw: 1.2 });
      o += G.txt(x0 + w - 2, y0 + h - 1 / 1.8 * h - 4, '阈值 = 1', { size: 8.4, fill: C.red, anchor: 'end' });
      o += G.txt(x0, y0 - 10, label, { size: 9.5, fill: C.ink2, weight: 700 });
      o += G.txt(x0, y0 + h + 16, '红底纹 = 风险段（产液已跌破 92）', { size: 8.4, fill: C.ink3 });
      return o;
    }
    s += scorePanel(0, '① 检测器 A：只看绝对值', '|q − 100| / 8 > 1 就报警', c.absS2, C.jade, '分数 = |产液 − 100| / 8');
    s += scorePanel(1, '② 检测器 B：看趋势', 'max(0, −k) / 0.09 > 1 就报警', c.treS2, C.blue, '分数 = max(0, −窗口斜率) / 0.09');

    /* 首次报警标记：绝对值（橙）与趋势（蓝） */
    var ax0 = 30, aw = 250;
    function mark(x0, w, day, color, text) {
      if (day < 0 || day > shown) return '';
      var mx2 = x0 + day / (L_DAYS - 1) * w;
      return G.line(mx2, 100, mx2, 240, { stroke: color, sw: 1.6 }) +
        G.txt(mx2 + 3, 108, text, { size: 8.4, fill: color, weight: 700 });
    }
    s += mark(ax0, aw, c.firstA2, C.clay, '首报 d' + c.firstA2);
    s += mark(320, aw, c.firstT2, C.blue, '首报 d' + c.firstT2);

    /* 左下：绝对值检测 */
    s += G.rect(30, 268, 250, 88, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(42, 288, '只看绝对值：产液要跌破 92 才报', { size: 9.4, fill: C.ink, weight: 700 });
    s += G.txt(42, 308, '慢蜡井的产液长期在 92—100 之间，', { size: 9, fill: C.ink2 });
    s += G.txt(42, 324, '直到第 ' + c.riskStart2 + ' 天才跌破风险线', { size: 9, fill: C.red, weight: 700 });
    s += G.txt(42, 344, '首次报警：第 ' + c.firstA2 + ' 天', { size: 9.4, mono: true, fill: C.ink3 });

    /* 中下：趋势检测 */
    s += G.rect(320, 268, 250, 88, { r: 6, fill: C.jadeL, stroke: '#b9d8cb' });
    s += G.txt(332, 288, '看趋势：还没跌破，但已经在往下掉', { size: 9.4, fill: C.jadeD, weight: 700 });
    s += G.txt(332, 308, '窗口斜率先越过阈值——它认出的是', { size: 9, fill: '#3f6b5d' });
    s += G.txt(332, 324, '「正在变坏」这个过程', { size: 9, fill: '#3f6b5d' });
    s += G.txt(332, 344, '首次报警：第 ' + c.firstT2 + ' 天（早 ' + c.lead2 + ' 天）',
      { size: 9.4, mono: true, fill: C.jadeD, weight: 700 });

    /* 右：结论 */
    s += G.txt(716, 100, '该看的指标是「提前量」', { size: 10, fill: C.ink2, weight: 700 });
    var rows = [
      ['产液跌破风险线', '第 ' + c.riskStart2 + ' 天', C.ink3],
      ['绝对值检测首次报警', '第 ' + c.firstA2 + ' 天', C.clay],
      ['趋势检测首次报警', '第 ' + c.firstT2 + ' 天', C.blue],
      ['提前量', c.lead2 + ' 天', C.jadeD]
    ];
    for (var k = 0; k < rows.length; k++) {
      var yy = 122 + k * 26;
      s += G.rect(716, yy - 15, 256, 22, { r: 4, fill: k === 3 ? C.jadeL : '#fdfdfb', stroke: k === 3 ? '#b9d8cb' : C.line });
      s += G.txt(728, yy, rows[k][0], { size: 9.2, fill: k === 3 ? C.jadeD : C.ink2, weight: k === 3 ? 700 : 400 });
      s += G.txt(960, yy, rows[k][1], { size: 9.6, mono: true, fill: rows[k][2], anchor: 'end', weight: 700 });
    }
    s += G.rect(716, 234, 256, 104, { r: 6, fill: C.clayL, stroke: '#e6cdb2' });
    s += G.txt(728, 254, '但代价也要说清楚', { size: 9.6, fill: '#8a4f27', weight: 700 });
    s += G.txt(728, 274, '趋势检测在风险段之前报了 ' + (c.fpZ2).toFixed(0) + '% 的「误报」', { size: 8.8, fill: '#8a4f27' });
    s += G.txt(728, 290, '绝对值检测只报 ' + (c.fpA2).toFixed(0) + '%', { size: 8.8, fill: '#8a4f27' });
    s += G.txt(728, 310, '这些「误报」多半是提前量，不是噪声——', { size: 8.8, fill: '#8a4f27', weight: 700 });
    s += G.txt(728, 326, '但也意味着现场要处理更多报警。', { size: 8.8, fill: '#8a4f27' });
    s += G.txt(728, 334, '', { size: 8 });
    s += footBox(716, 256, 350, 98, '所以流程后面还有两步',
      ['① 分级：把报警按蜡/垢两个维度分级，',
       '   只把高风险的推给作业队；',
       '② 复核：低置信的交人确认，避免误清。',
       '单靠一个阈值报警，报警量会压垮现场。'], 'jade');

    return {
      svg: s,
      stats: [
        { k: '场景', v: '慢蜡井' },
        { k: '绝对值首报', v: '第 ' + c.firstA2 + ' 天', tone: 'warn' },
        { k: '趋势首报', v: '第 ' + c.firstT2 + ' 天', tone: 'ok' },
        { k: '提前量', v: c.lead2 + ' 天', tone: 'ok' }
      ],
      note: '<b>慢蜡井是这套方法最能说明问题的例子。</b>它的产液一直没跌破风险线，按老规矩根本不会进清蜡名单——但它的油管已经在堵了。<b>趋势检测提前 ' + c.lead2 + ' 天报警</b>，这就是「看过程」比「看结果」值钱的地方。代价是报警量变大，所以流程后面必须跟分级与复核。'
    };
  }

  /* =========================================================
     ④ 线性回归拟合
     ========================================================= */
  function stage4(t) {
    var c = compute(), dg = c.dg, L = c.L;
    var s = '';
    var T = c.T, W = c.W2;
    var from = Math.max(0, T - W);

    s += G.panel(0, '① 递减曲线', '产液一天天下滑（模拟 90 天）', C.jade);
    s += G.panel(1, '② 取最近 W 天拟合', '最小二乘：让点到直线距离平方和最小', C.blue);
    s += G.panel(2, '③ 拟合出的递减直线', '斜率 = 每天掉多少', C.clay);

    var lo = 70, hi = 106;
    var x0 = 30, y0 = 116, ww = 250, h = 150;
    s += G.axes(x0, y0, ww, h, { nx: 4, ny: 4 });
    s += G.line(x0, y0 + h - (THRESH - lo) / (hi - lo) * h, x0 + ww, y0 + h - (THRESH - lo) / (hi - lo) * h,
      { stroke: C.clay, dash: '4 3', sw: 1.4 });
    s += G.txt(x0 + ww - 2, y0 + h - (THRESH - lo) / (hi - lo) * h - 5, '需清蜡阈值 ' + THRESH,
      { size: 8.4, fill: C.clay, anchor: 'end' });
    var upto = Math.max(2, Math.floor(ease(clamp(t, 0, 1)) * 90));
    s += polyOf(dg.data.slice(0, upto), x0, y0, ww, h, lo, hi, C.blue, 1.5);
    s += G.txt(x0, y0 - 10, '日产油 q(t) · t/d', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + h + 16, DEC_CN[L.decKind] + '　已显示 ' + upto + ' / 90 天', { size: 9, fill: C.ink3 });
    s += footBox(30, 250, 300, 148, '结蜡是渐进的',
      ['不像停机那样突然——油管一点点被堵，',
       '产液一点点掉下来。',
       '',
       '「什么时候会掉到必须清蜡的程度」？',
       '没人知道答案，但可以按现在的速度算。',
       '',
       '这就是「剩余清防窗口」——',
       '现场排作业、订清蜡车、安排药剂',
       '全靠这个数字提前量。'], 'jade');

    /* 中：拟合窗口 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    s += G.line(mx, my + mh - (THRESH - lo) / (hi - lo) * mh, mx + mw, my + mh - (THRESH - lo) / (hi - lo) * mh,
      { stroke: C.clay, dash: '4 3', sw: 1.2 });
    s += polyOf(dg.data, mx, my, mw, mh, lo, hi, C.ink4, 1, '4 3');
    var fx0 = mx + from / 90 * mw, fw = W / 90 * mw;
    s += G.rect(fx0, my, fw, mh, { fill: C.blue, op: 0.14 });
    s += G.rect(fx0, my, fw, mh, { fill: 'none', stroke: C.blue, sw: 1.4 });
    for (var i = 0; i < 90; i++) {
      if (i < from) continue;
      s += G.circle(mx + i / 90 * mw, my + mh - (dg.data[i] - lo) / (hi - lo) * mh, 2.6, { fill: C.blue, op: 0.85 });
    }
    s += G.circle(mx + T / 90 * mw, my + mh - (c.cur - lo) / (hi - lo) * mh, 4.5, { fill: C.clay, stroke: '#fff', sw: 1.6 });
    s += G.txt(mx, my - 10, '拟合窗口 = 最近 ' + W + ' 天（t=' + from + '—' + T + '）', { size: 9.2, fill: C.ink2, weight: 700 });
    s += G.txt(mx, my + mh + 16, '只有这段参与拟合，虚线部分不用', { size: 8.6, fill: C.ink3 });

    s += G.rect(320, 300, 250, 148, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(332, 320, '最小二乘在解什么', { size: 9.6, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 340, 'k = (nΣxy − ΣxΣy) / (nΣx² − (Σx)²)', { size: 9, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 358, 'b = (Σy − kΣx) / n', { size: 9, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 380, 'x 取窗口内相对序号 0…' + (W - 1), { size: 8.6, fill: '#4a607d' });
    s += G.txt(332, 398, 'n = ' + W + ' 个点参与计算', { size: 8.8, fill: '#4a607d', weight: 700 });
    s += G.txt(332, 420, '窗口太短 → 噪声大', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 436, '窗口太长 → 被早期平台期拖慢', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 452, '现场通常取折中，并定期重估', { size: 8.4, fill: '#5d7089' });

    /* 右：拟合直线 */
    var rx = 716, ry2 = 116, rw = 256, rh = 150;
    s += G.axes(rx, ry2, rw, rh, { nx: 4, ny: 4 });
    s += G.line(rx, ry2 + rh - (THRESH - lo) / (hi - lo) * rh, rx + rw, ry2 + rh - (THRESH - lo) / (hi - lo) * rh,
      { stroke: C.clay, dash: '4 3', sw: 1.3 });
    s += polyOf(dg.data, rx, ry2, rw, rh, lo, hi, C.ink4, 1.2);
    var fitPts = [], j;
    for (j = 0; j < W; j++) {
      var yv = c.lr.b + c.lr.k * j;
      fitPts.push([rx + (from + j) / 90 * rw, ry2 + rh - (yv - lo) / (hi - lo) * rh]);
    }
    s += G.poly(fitPts, { stroke: C.jade, sw: 2.2 });
    s += G.txt(rx, ry2 - 10, '拟合直线 q = k·x + b', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(rx, ry2 + rh + 16, '斜率 k = ' + f(c.lr.k, 4) + ' t/d 每天', { size: 9, mono: true, fill: C.jadeD, weight: 700 });
    s += G.rect(rx, 300, 256, 148, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(rx + 12, 320, '拟合结果', { size: 9.6, fill: C.ink, weight: 700 });
    var rr = [
      ['斜率 k', f(c.lr.k, 4), '每天下降多少'],
      ['截距 b', f(c.lr.b, 3), 'x=0 时的拟合值'],
      ['参与点数 n', String(W), '窗口内的天数']
    ];
    for (j = 0; j < 3; j++) {
      var ry3 = 344 + j * 32;
      s += G.txt(rx + 12, ry3, rr[j][0], { size: 9.2, fill: C.ink2 });
      s += G.txt(rx + 114, ry3, rr[j][1], { size: 10, mono: true, fill: C.jadeD, weight: 700 });
      s += G.txt(rx + 12, ry3 + 12, rr[j][2], { size: 8.2, fill: C.ink4 });
    }

    return {
      svg: s,
      stats: [
        { k: '拟合窗口', v: W + ' 天' },
        { k: '递减斜率 k', v: f(c.lr.k, 4), tone: 'warn' },
        { k: '当前产液', v: f(c.cur, 1) + ' t/d' },
        { k: '清蜡阈值', v: THRESH + ' t/d' }
      ],
      note: '<b>最小二乘在做什么：</b>在最近 W 天的散点里找一条<b>让所有点到它的竖直距离平方和最小</b>的直线。直线的斜率 k 就是「每天掉多少」。注意只用最近这一段（蓝框）——因为结蜡速率本身会变，早期的数据不能代表现在。'
    };
  }

  /* =========================================================
     ⑤ 外推求剩余窗口
     ========================================================= */
  function stage5(t) {
    var c = compute(), dg = c.dg, L = c.L;
    var s = '';
    var T = c.T, W = c.W2;
    var lo = 70, hi = 106;
    var lr = c.lr;
    var curFit = lr.k * (W - 1) + lr.b;
    var delta = (curFit - THRESH) / (-lr.k);

    s += G.panel(0, '① 把直线延伸到未来', '沿当前结蜡速度继续走', C.jade);
    s += G.panel(1, '② 找跌破阈值的那一天', '直线 ∩ 清蜡阈值 = 该清蜡日', C.blue);
    s += G.panel(2, '③ 剩余窗口 = 还剩几天', '今天到该清蜡日的天数', C.clay);

    var x0 = 30, y0 = 116, ww = 250, h = 150;
    s += G.axes(x0, y0, ww, h, { nx: 4, ny: 4 });
    s += G.line(x0, y0 + h - (THRESH - lo) / (hi - lo) * h, x0 + ww, y0 + h - (THRESH - lo) / (hi - lo) * h,
      { stroke: C.clay, dash: '4 3', sw: 1.4 });
    s += G.txt(x0 + ww - 2, y0 + h - (THRESH - lo) / (hi - lo) * h - 5, '阈值 ' + THRESH,
      { size: 8.4, fill: C.clay, anchor: 'end' });
    s += polyOf(dg.data.slice(0, T + 1), x0, y0, ww, h, lo, hi, C.blue, 1.3);
    var extPts = [], j;
    for (j = 0; j <= 30; j++) {
      var xv = T + j, yv = curFit + lr.k * j;
      extPts.push([x0 + clamp(xv, 0, 90) / 90 * ww, y0 + h - (yv - lo) / (hi - lo) * h]);
    }
    s += G.poly(extPts, { stroke: C.jade, sw: 2.2, dash: '5 3' });
    s += G.txt(x0, y0 - 10, '外推段（虚线）', { size: 9.5, fill: C.jadeD, weight: 700 });
    s += G.txt(x0, y0 + h + 16, '今天（t=' + T + '）之后按当前速度继续走', { size: 8.6, fill: C.ink3 });
    s += footBox(30, 250, 300, 148, '外推的两个前提',
      ['① 结蜡速度在未来保持不变；',
       '② 中间没有做清防（清完就重新开始算）。',
       '',
       '前提不成立就会估错——所以现场做法是',
       '定期重估，而不是一次算完躺平。',
       '把窗口当「参考」，不当「承诺」。'], 'jade');

    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    s += G.line(mx, my + mh - (THRESH - lo) / (hi - lo) * mh, mx + mw, my + mh - (THRESH - lo) / (hi - lo) * mh,
      { stroke: C.clay, dash: '4 3', sw: 1.3 });
    s += polyOf(dg.data.slice(0, T + 1), mx, my, mw, mh, lo, hi, C.blue, 1.2);
    var ePts = [];
    for (j = 0; j <= 30; j++) {
      var xv2 = T + j, yv2 = curFit + lr.k * j;
      ePts.push([mx + clamp(xv2, 0, 90) / 90 * mw, my + mh - (yv2 - lo) / (hi - lo) * mh]);
    }
    s += G.poly(ePts, { stroke: C.jade, sw: 2, dash: '5 3' });
    var crossDay = T + delta;
    if (crossDay <= 90) {
      var cxp = mx + crossDay / 90 * mw, cyp = my + mh - (THRESH - lo) / (hi - lo) * mh;
      s += G.circle(cxp, cyp, 5, { fill: C.clay, stroke: '#fff', sw: 1.6 });
      s += G.txt(cxp + 8, cyp - 6, '该清蜡 t=' + Math.round(crossDay), { size: 9, fill: C.clay, weight: 700 });
    }
    /* 真实跌破标记 */
    var rbx = Math.min(dg.breakAt, 89);
    s += G.line(mx + rbx / 90 * mw, my, mx + rbx / 90 * mw, my + mh, { stroke: C.ink3, dash: '3 3', sw: 1.1 });
    s += G.txt(mx + rbx / 90 * mw + 4, my + 12, '真实跌破', { size: 8.2, fill: C.ink3 });
    s += G.txt(mx, my - 10, '直线与阈值线求交', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(mx, my + mh + 16, 'Δ = (拟合值 − 阈值) / (−斜率)', { size: 8.6, mono: true, fill: C.ink3 });
    s += G.rect(320, 300, 250, 148, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(332, 320, '一步算完', { size: 9.6, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 340, '拟合值 q̂ = k·(W−1) + b', { size: 9, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 358, 'Δ = (q̂ − 阈值) / (−k)', { size: 9, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 380, 'q̂ = ' + f(curFit, 2) + ' t/d', { size: 9.2, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 398, 'Δ = (' + f(curFit, 2) + ' − ' + THRESH + ') / ' + f(-lr.k, 4),
      { size: 9.2, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 418, '= ' + f(delta, 2) + ' 天', { size: 10.5, mono: true, fill: C.jadeD, weight: 700 });
    s += G.txt(332, 440, '若 k ≥ 0（没在结蜡）→ 无法外推', { size: 8.4, fill: '#5d7089' });

    var rx = 716;
    s += G.rect(rx, 116, 256, 120, { r: 8, fill: C.jadeL, stroke: '#b9d8cb', sw: 1.3 });
    s += G.txt(rx + 128, 148, '剩余清防窗口', { size: 11, fill: C.jadeD, anchor: 'middle', weight: 700 });
    s += G.txt(rx + 128, 190, c.estWin == null ? '—' : c.estWin.toFixed(1) + ' 天',
      { size: 30, fill: C.jadeD, anchor: 'middle', weight: 700 });
    s += G.txt(rx + 128, 214, '按当前结蜡速度', { size: 9, fill: '#3f6b5d', anchor: 'middle' });
    s += G.rect(rx, 248, 256, 84, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(rx + 12, 268, '模型估计 vs 真实答案', { size: 9.6, fill: C.ink, weight: 700 });
    s += G.txt(rx + 12, 290, '模型估计窗口', { size: 9, fill: C.ink3 });
    s += G.txt(rx + 128, 290, c.estWin == null ? '—' : c.estWin.toFixed(1) + ' 天',
      { size: 10.5, mono: true, fill: C.jadeD, weight: 700 });
    s += G.txt(rx + 12, 310, '真实窗口（模拟已知）', { size: 9, fill: C.ink3 });
    s += G.txt(rx + 128, 310, c.realWin.toFixed(1) + ' 天', { size: 10.5, mono: true, fill: C.ink2, weight: 700 });
    var err = c.estWin == null ? null : Math.abs(c.estWin - c.realWin);
    s += G.txt(rx + 12, 328, '误差 ' + (err == null ? '—' : err.toFixed(1) + ' 天'),
      { size: 8.8, mono: true, fill: err != null && err < 4 ? C.jadeD : C.clay, weight: 700 });
    s += footBox(rx, 256, 344, 104, '窗口拿来干什么',
      ['不是预测「一定哪天该清」，而是排作业顺序：',
       '窗口短的井优先排热洗/加药，',
       '窗口长的井排在后面——',
       '把有限的清蜡车和药剂用在最该用的井上。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '模型估计窗口', v: c.estWin == null ? '—' : c.estWin.toFixed(1) + ' 天', tone: 'ok' },
        { k: '真实窗口', v: c.realWin.toFixed(1) + ' 天' },
        { k: '估计误差', v: err == null ? '—' : err.toFixed(1) + ' 天' },
        { k: '结蜡斜率', v: f(lr.k, 4) }
      ],
      note: '<b>剩余清防窗口是整个案例最终要落到生产上的数。</b>它把「这口井有多急」变成一个可以排序、可以排班、可以和清蜡车数量挂钩的数字。<b>这正是智能算法对现场最直接的赋能：把主观的「看着还行」变成可比较的「还剩 6 天」。</b>'
    };
  }

  /* =========================================================
     ⑥ 蜡×垢二维分级
     ========================================================= */
  function stage6(t) {
    var c = compute(), L = c.L;
    var s = '';
    var cls = c.classified;

    s += G.panel(0, '① 每口井两个风险分', '蜡风险（产液递减）× 垢风险（压力爬升）', C.jade);
    s += G.panel(1, '② 二维风险空间', '健康井聚在左下，故障井散在右上', C.blue);
    s += G.panel(2, '③ 分级 + 作业排序', '高风险提前清，低风险延后', C.clay);

    /* 左：两个风险分 */
    var x0 = 30, y0 = 116, ww = 250, h = 150;
    s += G.axes(x0, y0, ww, h, { nx: 4, ny: 4 });
    for (var i = 0; i < cls.length; i++) {
      var wl = cls[i].w;
      var px = x0 + wl.x * ww, py = y0 + h - wl.y * h;
      var col = wl.x > wl.y ? C.clay : C.purple;
      s += G.circle(px, py, 4.2, { fill: col, op: 0.78 });
    }
    s += G.txt(x0, y0 - 10, '30 口井的两个风险分', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0 + ww, y0 + h + 16, '蜡风险 →', { size: 8.6, fill: C.clay, anchor: 'end', weight: 700 });
    s += G.txt(x0 - 6, y0 + 6, '垢风险 ↑', { size: 8.6, fill: C.purple, anchor: 'end', weight: 700 });
    s += footBox(30, 250, 300, 148, '为什么要两个维度',
      ['只用一个「综合风险分」会丢信息：',
       '结蜡和结垢的处置方法完全不同。',
       '',
       '蜡风险高 → 热洗 / 加药清蜡；',
       '垢风险高 → 除垢 / 防垢；',
       '两个都高 → 先除垢后热洗。',
       '',
       '所以空间上要分开看，排序时再合并。'], 'jade');

    /* 中：风险空间与分级边界 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    /* 边界线 x+y=t */
    var b1 = c.highThr, b2 = c.midThr;
    function diagLine(t, col, w) {
      var x1 = Math.max(0, t - 1), x2 = Math.min(1, t);
      if (x2 <= x1) return '';
      return G.line(mx + x1 * mw, my + mh - (t - x1) * mh, mx + x2 * mw, my + mh - (t - x2) * mh,
        { stroke: col, dash: '5 3', sw: w });
    }
    s += diagLine(b1, C.clay, 1.6);
    s += diagLine(b2, C.amber, 1.4);
    /* 低风险区 */
    s += G.path('M' + mx + ' ' + (my + mh) + 'L' + mx + ' ' + (my + mh - b2 * mh) +
      'L' + (mx + b2 * mw) + ' ' + (my + mh) + 'Z', { fill: C.jadeL, op: 0.7 });
    s += G.txt(mx + 8, my + mh - 8, '低风险区', { size: 8.6, fill: C.jadeD, weight: 700 });
    s += G.txt(mx + mw - 66, my + mh - 8, '中', { size: 9, fill: C.amber, weight: 700 });
    s += G.txt(mx + mw - 8, my + 14, '高', { size: 9.6, fill: C.clay, anchor: 'end', weight: 700 });
    for (i = 0; i < cls.length; i++) {
      var w2 = cls[i].w;
      s += G.circle(mx + w2.x * mw, my + mh - w2.y * mh, 3.4, {
        fill: cls[i].lv === '高' ? C.clay : (cls[i].lv === '中' ? C.amber : C.ink4),
        op: cls[i].lv === '低' ? 0.45 : 0.85
      });
    }
    s += G.txt(mx, my - 10, '分级边界随灵敏度滑动', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(mx, my + mh + 16, '灵敏度 τ = ' + f(L.thr, 2), { size: 9, mono: true, fill: C.clay, weight: 700 });
    s += G.rect(320, 300, 250, 148, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(332, 320, '分级规则', { size: 9.6, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 340, '风险 r = 蜡风险 + 垢风险', { size: 9, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 360, '高：r > ' + f(b1, 3), { size: 9, mono: true, fill: '#8a4f27' });
    s += G.txt(332, 376, '中：r > ' + f(b2, 3), { size: 9, mono: true, fill: '#a87f24' });
    s += G.txt(332, 392, '低：其余', { size: 9, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 414, 'τ 越小 → 边界越靠左 → 越激进', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 430, '命中更多，但白清也多', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 448, 'τ 越大 → 越保守，只清最有把握的', { size: 8.8, fill: '#4a607d', weight: 700 });

    /* 右：分级结果 + 排序 */
    var rx = 716;
    s += G.rect(rx, 116, 256, 92, { r: 8, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(rx + 12, 136, '本轮分级结果', { size: 9.6, fill: C.ink, weight: 700 });
    var lvN = [['高', c.high.length, C.clay], ['中', c.mid.length, C.amber], ['低', B.WELLS - c.high.length - c.mid.length, C.ink4]];
    for (i = 0; i < 3; i++) {
      var bx = rx + 12 + i * 78;
      s += G.rect(bx, 146, 70, 20, { r: 4, fill: lvN[i][2], op: 0.18 });
      s += G.rect(bx, 146, 70 * clamp(lvN[i][1] / Math.max(1, B.WELLS / 2), 0, 1), 20, { r: 4, fill: lvN[i][2], op: 0.85 });
      s += G.txt(bx + 35, 160, String(lvN[i][1]), { size: 10, mono: true, fill: lvN[i][2], anchor: 'middle', weight: 700 });
      s += G.txt(bx + 35, 182, lvN[i][0] + '风险', { size: 8.4, fill: C.ink3, anchor: 'middle' });
    }
    s += G.txt(rx + 12, 200, '风险命中率 ' + c.hit.toFixed(0) + '%　作业次数较固定周期 −' + c.save.toFixed(0) + '%',
      { size: 8.8, mono: true, fill: C.jadeD, weight: 700 });

    /* 作业排序 */
    var sorted = cls.slice().sort(function (a, b) { return b.r - a.r; });
    var top = sorted.slice(0, 8);
    var maxR = Math.max(0.1, sorted[0].r);
    s += G.rect(rx, 220, 256, 132, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(rx + 12, 240, '清防作业排序（前 8 口）', { size: 9.4, fill: C.ink, weight: 700 });
    for (i = 0; i < top.length; i++) {
      var oy = 254 + i * 12;
      var cc = top[i];
      var col2 = cc.lv === '高' ? C.clay : (cc.lv === '中' ? C.amber : C.ink4);
      s += G.txt(rx + 12, oy + 8, cc.w.id, { size: 7.8, mono: true, fill: C.ink3 });
      s += G.rect(rx + 38, oy, 90, 9, { r: 2, fill: '#f1f1ee' });
      s += G.rect(rx + 38, oy, cc.r / maxR * 90, 9, { r: 2, fill: col2, op: 0.9 });
      var act = cc.w.x > cc.w.y ? '热洗清蜡' : '除垢防垢';
      if (cc.w.x > 0.4 && cc.w.y > 0.4) act = '先除垢后热洗';
      s += G.txt(rx + 244, oy + 8, act, { size: 7.6, fill: C.ink3, anchor: 'end' });
    }
    s += footBox(rx, 256, 364, 84, '和固定周期的对比',
      ['固定周期：每口每月都清 → 30 次/月，很多是白清。',
       '按风险：高风险提前、低风险延后 → ' + c.ops.toFixed(1) + ' 次/月。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '井数', v: B.WELLS },
        { k: '高风险', v: c.high.length + ' 口', tone: 'warn' },
        { k: '中风险', v: c.mid.length + ' 口' },
        { k: '作业次数下降', v: '−' + c.save.toFixed(0) + '%', tone: 'ok' }
      ],
      note: '<b>这一屏是整个案例的落点：把「按风险」变成「按顺序」。</b>30 口井都可能有蜡，但清蜡车一个月只有 30 个车次。<b>智能化的价值不是「都报一遍」，而是告诉你先动哪一口、动哪一口能省多少。</b>同时因为分了两个维度，还能顺带给出处置方法（热洗还是除垢）。'
    };
  }

  global.WaxFlow = {
    stage1: stage1, stage2: stage2, stage3: stage3,
    stage4: stage4, stage5: stage5, stage6: stage6, compute: compute
  };
})(typeof window !== 'undefined' ? window : this);
