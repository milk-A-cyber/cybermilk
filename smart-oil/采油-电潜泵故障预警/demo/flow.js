/* =========================================================
   电潜泵故障预警 · 算法解剖（时序异常检测 + RUL 外推）
   ---------------------------------------------------------
   把「电流卡片 → 故障预警」拆成 6 步，每一步都跑真代码：

     ① 电流卡片         分钟级采样，基线 + 故障形态 + 噪声
     ② 滑动窗口特征     窗口逐格右移，逐窗算 均值/斜率/标准差
     ③ 两种检测器       绝对值检测 vs 趋势检测，同一份数据两种判法
     ④ 退化最小二乘     用最近 W 天拟合出退化直线
     ⑤ 外推求 RUL       把直线延伸到跌破阈值的那一天
     ⑥ 分级决策         二维特征空间 → 四级预警 → 提前量

   依赖：window.EspBridge（demo.js 暴露的真模型）
        window.AFlow（算法解剖引擎）
   ========================================================= */
(function (global) {
  'use strict';

  var B = global.EspBridge;
  if (!B || !global.AFlow) return;

  var G = global.AFlow.G, C = global.AFlow.C;
  var M = B.M;

  var FAULT_CN = { normal: '正常', gas: '气锁', scaling: '结垢', overheat: '电机过热', shutdown: '停泵' };
  var FAULT_COLOR = { normal: '#2f7d6b', gas: '#7e5a8d', scaling: '#b26a39', overheat: '#c98a2b', shutdown: '#b05a51' };
  var LEVEL_NAME = ['正常', '关注', '预警', '紧急'];

  /* ---------- 工具 ---------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t * t * (3 - 2 * t); }
  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }

  /* 面板底部小结框 */
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

  /* 一条时序折线 */
  function polyOf(arr, x, y, w, h, lo, hi, color, sw, dash) {
    var pts = [], i;
    for (i = 0; i < arr.length; i++) {
      pts.push([x + i / (arr.length - 1) * w, y + h - (arr[i] - lo) / (hi - lo) * h]);
    }
    return G.poly(pts, { stroke: color, sw: sw || 1.4, dash: dash, join: 'round' });
  }

  /* ---------- 缓存当前工况的数据 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.fault, L.noise, L.kind, L.day, L.win, L.thr].join(',');
    if (cache.key === key) return cache;
    var cur = M.genCurrent(L.fault, L.noise, 20261102);
    var dz = M.detectAnomaly(cur.i, cur.segs, 'z', cur.base, 3.0, 10, 40);
    var da = M.detectAnomaly(cur.i, cur.segs, 'abs', cur.base, 3.0, 10, 40);
    var fs = M.featStats(cur.i, 40);
    var dg = M.genDegrade(L.kind, 20261103);
    var fit = M.fitTrend(dg.values, L.day - L.win + 1, L.day);
    var rul = M.predictRUL(dg.values, L.day, L.win, dg.threshold);
    var tru = M.trueRul(dg.values, L.day, dg.threshold);
    var fleet = M.genFleet(20261104);
    var ev = M.fleetEval(fleet, L.thr);
    /* 分级人数统计（由混淆矩阵推出） */
    var lvCnt = [0, 0, 0, 0];
    for (var fi = 0; fi < fleet.length; fi++) {
      lvCnt[M.classify(fleet[fi].slope, fleet[fi].vol, L.thr)]++;
    }
    var leads = [];
    for (var fj = 0; fj < fleet.length; fj++) {
      if (fleet[fj].state === 'fault') leads.push(fleet[fj].failDay);
    }
    cache = {
      key: key, L: L, cur: cur, dz: dz, da: da, fs: fs,
      dg: dg, fit: fit, rul: rul, tru: tru, fleet: fleet, ev: ev,
      lvCnt: lvCnt, leads: leads
    };
    return cache;
  }

  /* =========================================================
     ① 电流卡片
     ========================================================= */
  function stage1(t) {
    var c = compute(), cur = c.cur, L = c.L;
    var s = '';
    s += G.panel(0, '① 原始信号', '每分钟一个电流值，12 小时 = 720 点', C.jade);
    s += G.panel(1, '② 拆成三部分', '基线 + 故障形态 + 噪声', C.blue);
    s += G.panel(2, '③ 这张卡片的形状', '不同故障长什么样', C.clay);

    /* 左：电流曲线 */
    var x0 = 30, y0 = 116, w = 250, h = 150;
    var lo = 0, hi = 125;
    s += G.axes(x0, y0, w, h, { nx: 4, ny: 4 });
    /* 故障段底纹 */
    for (var si = 0; si < cur.segs.length; si++) {
      var a = cur.segs[si][0], b = cur.segs[si][1];
      s += G.rect(x0 + a / 720 * w, y0, (b - a) / 720 * w, h, { fill: C.redL, op: 0.55 });
    }
    var upto = Math.max(2, Math.floor(t * 720));
    var partial = Array.prototype.slice.call(cur.i, 0, upto);
    s += polyOf(partial, x0, y0, w, h, lo, hi, FAULT_COLOR[L.fault], 1.5);
    s += G.txt(x0, y0 - 10, '电流 I(t) · 单位 A', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + h + 16, '基线 ' + cur.base + ' A　已显示 ' + upto + ' / 720 点', { size: 9, fill: C.ink3, mono: true });
    s += footBox(30, 250, 300, 148, '一张卡片里有什么',
      ['每分钟一个点：井下电机 + 泵柱塞 + 油',
       '一起工作要多大电流。这是现场最便宜、',
       '最连续的一类数据——SCADA 直接就有。',
       '',
       '720 个点 × 每天 = 一天 1440 个点，',
       '一年 50 万个点。人工不可能盯。'], 'jade');

    /* 中：分解 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    /* 正常基线 */
    s += G.line(mx, my + mh - (cur.base - lo) / (hi - lo) * mh, mx + mw, my + mh - (cur.base - lo) / (hi - lo) * mh,
      { stroke: C.ink4, dash: '5 3', sw: 1.3 });
    s += G.txt(mx + mw - 4, my + mh - (cur.base - lo) / (hi - lo) * mh - 5, '正常基线 ' + cur.base + ' A',
      { size: 8.6, fill: C.ink3, anchor: 'end' });
    s += polyOf(partial, mx, my, mw, mh, lo, hi, FAULT_COLOR[L.fault], 1.5);
    s += G.txt(mx, my - 10, '实线 = 实际　虚线 = 正常时该在哪', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(mx, my + mh + 16, '偏离基线的形状，就是故障的指纹', { size: 9, fill: C.ink3 });
    s += footBox(320, 250, 300, 148, '三种成分分开看',
      ['基线：正常工作的电流水平（约 92 A）。',
       '故障形态：气锁→周期性下探；结垢→缓慢爬升；',
       '过热→升高且波动加剧；停泵→骤降。',
       '噪声：测量抖动，正常时也有 ±1 A。',
       '',
       '算法要做的，是把「形状」从噪声里捞出来。'], 'blue');

    /* 右：故障形态对照 */
    s += G.txt(716, 100, '五种故障的典型形状（示意）', { size: 10, fill: C.ink2, weight: 700 });
    var keys = ['normal', 'gas', 'scaling', 'overheat', 'shutdown'];
    for (var k = 0; k < keys.length; k++) {
      var kk = keys[k];
      var gy = 118 + k * 62;
      var sample = M.genCurrent(kk, L.noise, 20261102);
      var isCur = kk === L.fault;
      s += G.rect(716, gy, 256, 52, {
        r: 5, fill: isCur ? C.jadeL : '#fdfdfb', stroke: isCur ? C.jade : C.line, sw: isCur ? 1.4 : 1
      });
      s += G.txt(724, gy + 14, FAULT_CN[kk], { size: 9.6, fill: FAULT_COLOR[kk], weight: 700 });
      if (isCur) s += G.txt(964, gy + 14, '当前', { size: 8.6, fill: C.jadeD, weight: 700, anchor: 'end' });
      var sm = Array.prototype.slice.call(sample.i, 0, 300);
      s += polyOf(sm, 724, gy + 18, 240, 28, 0, 125, FAULT_COLOR[kk], 1.2);
    }
    s += G.txt(716, 432, '每种故障在电流上留下不同的痕迹——', { size: 9, fill: C.ink3 });
    s += G.txt(716, 446, '算法要认的，就是这些痕迹。', { size: 9, fill: C.clay, weight: 700 });

    return {
      svg: s,
      stats: [
        { k: '采样点数', v: cur.t },
        { k: '基线电流', v: cur.base + ' A' },
        { k: '当前故障', v: FAULT_CN[L.fault], tone: 'ok' },
        { k: '噪声水平', v: f(L.noise, 2) }
      ],
      note: '<b>为什么从电流入手：</b>电潜泵（ESP）淹在井下一千多米，出了问题人下不去看，只能靠地面传回的电参数判断。电流卡片是<b>免费、连续、覆盖全部井</b>的数据——这是智能化最该先吃下的东西。'
    };
  }

  /* =========================================================
     ② 滑动窗口特征
     ========================================================= */
  function stage2(t) {
    var c = compute(), cur = c.cur, fs = c.fs, L = c.L;
    var s = '';
    var WIN = 40;
    var tEnd = Math.max(WIN + 1, Math.floor(ease(clamp(t, 0, 1)) * 700));

    s += G.panel(0, '① 窗口在时序上滑动', '每次只看最近 40 个点', C.jade);
    s += G.panel(1, '② 窗口内算三个统计量', '均值 / 斜率 / 标准差', C.blue);
    s += G.panel(2, '③ 三个特征序列', '把时序变成可比较的曲线', C.clay);

    /* 左：滑动窗口 */
    var x0 = 30, y0 = 116, w = 250, h = 150, lo = 0, hi = 125;
    s += G.axes(x0, y0, w, h, { nx: 4, ny: 4 });
    var upto = tEnd;
    s += polyOf(Array.prototype.slice.call(cur.i, 0, upto), x0, y0, w, h, lo, hi, C.ink4, 1.1);
    /* 窗口位置 */
    var wStart = Math.max(0, tEnd - WIN);
    var wx0 = x0 + wStart / 720 * w, ww = WIN / 720 * w;
    s += G.rect(wx0, y0, ww, h, { fill: C.jade, op: 0.16 });
    s += G.rect(wx0, y0, ww, h, { fill: 'none', stroke: C.jade, sw: 1.5 });
    s += G.txt(wx0 + 2, y0 - 4, '窗口 40 点', { size: 8.6, fill: C.jadeD, weight: 700 });
    /* 窗口内散点 */
    for (var i = wStart; i < tEnd; i += 2) {
      var px = x0 + i / 720 * w, py = y0 + h - (cur.i[i] - lo) / (hi - lo) * h;
      s += G.circle(px, py, 2, { fill: C.jade, op: 0.9 });
    }
    s += G.txt(x0, y0 - 10, '电流 I(t) · 窗口随时间右移', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + h + 16, '窗口位置 t = ' + tEnd + ' / 720', { size: 9, fill: C.jadeD, mono: true, weight: 700 });
    s += footBox(30, 250, 300, 148, '为什么要开窗口',
      ['单点值没有意义：某一分钟电流高，可能是',
       '工况波动；连续 40 分钟都在涨，才是趋势。',
       '',
       '窗口 = 让算法「看一段时间」而不是',
       '「看一个瞬间」。窗口长度 40 是权衡：',
       '太短被噪声带跑，太长反应太慢。'], 'jade');

    /* 中：三个统计量 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    /* 窗口内的点 + 拟合线 */
    var win = [];
    for (i = wStart; i < tEnd; i++) win.push(cur.i[i]);
    var wpts = [], i2;
    for (i2 = 0; i2 < win.length; i2++) {
      wpts.push([mx + i2 / (WIN - 1) * mw, my + mh - (win[i2] - lo) / (hi - lo) * mh]);
    }
    s += G.poly(wpts, { stroke: C.ink4, sw: 1.1 });
    /* 最小二乘线（用真算法） */
    var ft = M.fitTrend(cur.i, wStart, tEnd - 1);
    var lineY0 = my + mh - (ft.intercept - lo) / (hi - lo) * mh;
    var lineY1 = my + mh - (ft.slope * (WIN - 1) + ft.intercept - lo) / (hi - lo) * mh;
    s += G.line(mx, lineY0, mx + mw, lineY1, { stroke: C.clay, sw: 2 });
    var mean = 0;
    for (i2 = 0; i2 < win.length; i2++) mean += win[i2];
    mean /= win.length;
    s += G.line(mx, my + mh - (mean - lo) / (hi - lo) * mh, mx + mw, my + mh - (mean - lo) / (hi - lo) * mh,
      { stroke: C.blue, sw: 1.4, dash: '4 3' });
    s += G.txt(mx, my - 10, '窗口内：均值 / 斜率 / 标准差', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(mx + mw, lineY0 - 4, '斜率线', { size: 8.4, fill: C.clay, anchor: 'end', weight: 700 });
    s += G.txt(mx + mw, my + mh - (mean - lo) / (hi - lo) * mh - 4, '均值线', { size: 8.4, fill: C.blue, anchor: 'end', weight: 700 });

    /* 读数 */
    var sd = 0;
    for (i2 = 0; i2 < win.length; i2++) sd += (win[i2] - mean) * (win[i2] - mean);
    sd = Math.sqrt(sd / win.length);
    s += G.rect(320, 300, 250, 148, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(332, 320, '当前窗口（t=' + (tEnd - 1) + '）的三个数', { size: 9.6, fill: C.ink, weight: 700 });
    var rows = [
      ['均值 μ', f(mean, 2) + ' A', '窗口内电流平均水平'],
      ['斜率 k', f(ft.slope, 4) + ' A/点', '正在涨(+)还是跌(−)'],
      ['标准差 σ', f(sd, 2) + ' A', '抖得厉害不厉害']
    ];
    for (i2 = 0; i2 < 3; i2++) {
      var ry = 342 + i2 * 34;
      s += G.txt(332, ry, rows[i2][0], { size: 9.4, fill: C.ink2 });
      s += G.txt(424, ry, rows[i2][1], { size: 10, mono: true, fill: C.jadeD, weight: 700 });
      s += G.txt(332, ry + 12, rows[i2][2], { size: 8.2, fill: C.ink4 });
    }

    /* 右：三个特征序列 */
    var rx = 716, ry = 116, rw = 256, rh = 150;
    s += G.axes(rx, ry, rw, rh, { nx: 4, ny: 4 });
    /* 斜率序列 */
    var slopeArr = [];
    for (i = WIN; i < 720; i++) slopeArr.push(fs.slope[i]);
    var slo = Math.min.apply(null, slopeArr), shi = Math.max.apply(null, slopeArr);
    var pad = (shi - slo) * 0.15 || 0.01;
    var spts = [], j;
    for (j = 0; j < slopeArr.length; j++) {
      spts.push([rx + j / (slopeArr.length - 1) * rw, ry + rh - (slopeArr[j] - slo + pad) / (shi - slo + 2 * pad) * rh]);
    }
    s += G.poly(spts, { stroke: C.clay, sw: 1.3 });
    s += G.txt(rx, ry - 10, '窗口斜率序列 k(t)', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(rx, ry + rh + 16, '结垢时这条线会持续为正——这就是「在涨」的证据', { size: 8.4, fill: C.ink3 });
    s += G.rect(716, 300, 256, 148, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(728, 320, '三个特征各自回答一个问题', { size: 9.6, fill: C.ink, weight: 700 });
    var qs = [
      ['μ 均值', '现在整体负载多高', C.blue],
      ['k 斜率', '正在往上走吗', C.clay],
      ['σ 标准差', '抖得反常吗', C.purple]
    ];
    for (j = 0; j < 3; j++) {
      var qy = 344 + j * 30;
      s += G.txt(728, qy, qs[j][0], { size: 9.4, mono: true, fill: qs[j][2], weight: 700 });
      s += G.txt(800, qy, qs[j][1], { size: 9.2, fill: C.ink2 });
    }
    s += G.txt(728, 436, '后面两种检测器，就是拿 k 去跟阈值比。', { size: 8.6, fill: C.clay, weight: 700 });

    return {
      svg: s,
      stats: [
        { k: '窗口长度', v: WIN + ' 点' },
        { k: '窗口位置', v: tEnd + ' / 720' },
        { k: '窗口均值', v: f(mean, 2) + ' A' },
        { k: '窗口斜率', v: f(ft.slope, 4), tone: ft.slope > 0 ? 'warn' : 'ok' }
      ],
      note: '<b>滑动窗口在做什么：</b>把「一串数」变成「一串特征」。每往右一格，就算一次窗口内的 <b>均值（现在多高）、斜率（在不在涨）、标准差（抖不抖）</b>。这三条曲线就是算法的输入——后面所有判断都基于它们，而不是原始电流。'
    };
  }

  /* =========================================================
     ③ 两种检测器
     ========================================================= */
  function stage3(t) {
    var c = compute(), cur = c.cur, L = c.L;
    var s = '';
    var shown = Math.max(2, Math.floor(ease(clamp(t, 0, 1)) * 700));

    s += G.panel(0, '① 检测器 A：只看绝对值', '|I − 基线| / 10 > 1 就报警', C.jade);
    s += G.panel(1, '② 检测器 B：看趋势', '窗口斜率 / 0.025 > 1 就报警', C.blue);
    s += G.panel(2, '③ 同一个故障，两种结论', '慢退化为什么容易漏掉', C.clay);

    function scorePanel(ci, title, sub, score, flags, color, label, threshTxt) {
      var o = G.panel(ci, title, sub, color);
      var x0 = 30 + ci * 292, y0 = 116, w = 250, h = 120;
      o += G.axes(x0, y0, w, h, { nx: 4, ny: 4 });
      for (var si = 0; si < cur.segs.length; si++) {
        var a = cur.segs[si][0], b = cur.segs[si][1];
        o += G.rect(x0 + a / 720 * w, y0, (b - a) / 720 * w, h, { fill: C.redL, op: 0.5 });
      }
      var sc = Array.prototype.slice.call(score, 0, shown);
      o += polyOf(sc, x0, y0, w, h, 0, 2.2, color, 1.4);
      o += G.line(x0, y0 + h - 1 / 2.2 * h, x0 + w, y0 + h - 1 / 2.2 * h, { stroke: C.red, dash: '4 3', sw: 1.2 });
      o += G.txt(x0 + w - 2, y0 + h - 1 / 2.2 * h - 4, '阈值 = 1', { size: 8.4, fill: C.red, anchor: 'end' });
      o += G.txt(x0, y0 - 10, label, { size: 9.5, fill: C.ink2, weight: 700 });
      o += G.txt(x0, y0 + h + 16, threshTxt, { size: 8.6, fill: C.ink3, mono: true });
      return o;
    }

    var oA = scorePanel(0, '① 检测器 A：只看绝对值', '|I − 基线| / 10 > 1 就报警',
      c.da.score, c.da.flags, C.ink3, '分数 = |I − 92| / 10', '判据：偏离基线 10 A 才报警');
    var oB = scorePanel(1, '② 检测器 B：看趋势', '窗口斜率 / 0.025 > 1 就报警',
      c.dz.score, c.dz.flags, C.clay, '分数 = 窗口斜率 / 0.025', '判据：40 点内涨 1 A 就报警');
    s += oA + oB;

    /* 左下：绝对值检测的盲区 */
    var mid = Math.round((260 + 720) / 2);
    s += G.rect(30, 268, 250, 88, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(42, 288, '结垢爬升段（t=260 起）', { size: 9.6, fill: C.ink, weight: 700 });
    s += G.txt(42, 308, '前半段电流还在 92±8 A 内', { size: 9, fill: C.ink2 });
    s += G.txt(42, 324, '→ 绝对值检测判「正常」，漏检', { size: 9, fill: C.red, weight: 700 });
    s += G.txt(42, 344, '命中率 ' + (c.da.hit * 100).toFixed(0) + '%', { size: 9.4, mono: true, fill: C.ink3 });

    /* 中下：趋势检测抓住 */
    s += G.rect(320, 268, 250, 88, { r: 6, fill: C.jadeL, stroke: '#b9d8cb' });
    s += G.txt(332, 288, '同一个爬升段，趋势检测看得见', { size: 9.6, fill: C.jadeD, weight: 700 });
    s += G.txt(332, 308, '电流虽然还没超出 ±10 A，', { size: 9, fill: '#3f6b5d' });
    s += G.txt(332, 324, '但它「正在往上走」——斜率已经超过阈值', { size: 9, fill: '#3f6b5d' });
    s += G.txt(332, 344, '命中率 ' + (c.dz.hit * 100).toFixed(0) + '%', { size: 9.4, mono: true, fill: C.jadeD, weight: 700 });
    /* 右：结论对比 */
    s += G.txt(716, 100, '本轮对比', { size: 10, fill: C.ink2, weight: 700 });
    var cmp = [
      ['趋势检测', c.dz.hit, c.dz.fp, C.jade],
      ['绝对值检测', c.da.hit, c.da.fp, C.gray]
    ];
    for (var k = 0; k < 2; k++) {
      var yy = 120 + k * 74;
      s += G.rect(716, yy, 256, 62, { r: 6, fill: '#fdfdfb', stroke: C.line });
      s += G.txt(728, yy + 18, cmp[k][0], { size: 9.6, fill: cmp[k][3], weight: 700 });
      s += G.txt(728, yy + 38, '故障段命中率', { size: 8.4, fill: C.ink4 });
      s += G.txt(728, yy + 54, (cmp[k][1] * 100).toFixed(0) + '%', { size: 12, mono: true, fill: cmp[k][3], weight: 700 });
      s += G.txt(830, yy + 38, '标签外报警率', { size: 8.4, fill: C.ink4 });
      s += G.txt(830, yy + 54, (cmp[k][2] * 100).toFixed(0) + '%', { size: 12, mono: true, fill: C.ink2, weight: 700 });
    }
    s += G.rect(716, 272, 256, 100, { r: 6, fill: C.clayL, stroke: '#e6cdb2' });
    s += G.txt(728, 292, '别急着叫它「误报」', { size: 9.6, fill: '#8a4f27', weight: 700 });
    s += G.txt(728, 310, '结垢其实从 t=120 就开始爬了，只是台账', { size: 8.8, fill: '#8a4f27' });
    s += G.txt(728, 325, '把「故障段」标在 t=260。趋势检测在 t=146', { size: 8.8, fill: '#8a4f27' });
    s += G.txt(728, 340, '就报了——它认出的是真退化，只是比台账早。', { size: 8.8, fill: '#8a4f27' });
    s += G.txt(728, 362, '这类「误报」其实是提前量。', { size: 9, fill: '#8a4f27', weight: 700 });
    s += footBox(716, 256, 384, 64, '所以真正要看的指标是「提前量」',
      ['而不是单看命中率。标签滞后于物理过程时，'], 'jade');

    return {
      svg: s,
      stats: [
        { k: '趋势命中率', v: (c.dz.hit * 100).toFixed(0) + '%', tone: 'ok' },
        { k: '绝对值命中率', v: (c.da.hit * 100).toFixed(0) + '%', tone: 'warn' },
        { k: '趋势标签外报警', v: (c.dz.fp * 100).toFixed(1) + '%' },
        { k: '绝对值标签外报警', v: (c.da.fp * 100).toFixed(1) + '%' }
      ],
      note: '<b>两种检测器的差别，就是智能化的价值所在。</b>绝对值检测回答「现在偏离正常值多少」；趋势检测回答「正在朝坏的方向走吗」。结垢前 160 分钟电流几乎正常，只有斜率能提前抓住。<b>趋势检测多出来的那部分「标签外报警」多数是提前量，不是真误报</b>——这正是评价智能算法时不能只看命中率的原因。'
    };
  }

  /* =========================================================
     ④ 退化最小二乘拟合
     ========================================================= */
  function stage4(t) {
    var c = compute(), dg = c.dg, L = c.L;
    var s = '';
    var win = L.win, day = L.day;
    var from = day - win + 1;

    s += G.panel(0, '① 退化曲线', '产液量一天天下滑（模拟 90 天）', C.jade);
    s += G.panel(1, '② 取最近 W 天做拟合', '最小二乘：让点到直线距离平方和最小', C.blue);
    s += G.panel(2, '③ 拟合出的退化直线', '斜率 = 每天掉多少', C.clay);

    /* 左：退化曲线 */
    var x0 = 30, y0 = 116, w = 250, h = 150;
    var lo = 10, hi = 50;
    s += G.axes(x0, y0, w, h, { nx: 4, ny: 4 });
    /* 阈值线 */
    s += G.line(x0, y0 + h - (dg.threshold - lo) / (hi - lo) * h, x0 + w, y0 + h - (dg.threshold - lo) / (hi - lo) * h,
      { stroke: C.red, dash: '4 3', sw: 1.4 });
    s += G.txt(x0 + w - 2, y0 + h - (dg.threshold - lo) / (hi - lo) * h - 5, '报警阈值 ' + dg.threshold + ' t/d',
      { size: 8.4, fill: C.red, anchor: 'end' });
    var upTo = Math.max(2, Math.floor(ease(clamp(t, 0, 1)) * 90));
    var vals = Array.prototype.slice.call(dg.values, 0, upTo);
    s += polyOf(vals, x0, y0, w, h, lo, hi, C.ink3, 1.5);
    s += G.txt(x0, y0 - 10, '产液 q(t) · t/d', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + h + 16, dg.label + '　已显示 ' + upTo + ' / 90 天', { size: 9, fill: C.ink3 });
    s += footBox(30, 250, 300, 148, '退化型故障的特点',
      ['结垢、磨损、电池衰减——不是突然坏，',
       '而是产液量一天天下降。',
       '',
       '「什么时候会坏到不能接受」？',
       '没人知道，但可以按现在的下降速度',
       '算出来。这就是剩余寿命 RUL。'], 'jade');

    /* 中：拟合窗口 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    s += G.line(mx, my + mh - (dg.threshold - lo) / (hi - lo) * mh, mx + mw, my + mh - (dg.threshold - lo) / (hi - lo) * mh,
      { stroke: C.red, dash: '4 3', sw: 1.2 });
    /* 全曲线（淡） */
    s += polyOf(Array.prototype.slice.call(dg.values), mx, my, mw, mh, lo, hi, C.ink4, 1, '4 3');
    /* 拟合窗口高亮 */
    var fx0 = mx + from / 90 * mw, fw = win / 90 * mw;
    s += G.rect(fx0, my, fw, mh, { fill: C.blue, op: 0.14 });
    s += G.rect(fx0, my, fw, mh, { fill: 'none', stroke: C.blue, sw: 1.4 });
    /* 窗口内的点 */
    for (var i = 0; i < 90; i++) {
      if (i < from) continue;
      var px = mx + i / 90 * mw, py = my + mh - (dg.values[i] - lo) / (hi - lo) * mh;
      s += G.circle(px, py, 2.6, { fill: C.blue, op: 0.85 });
    }
    /* 当前点 */
    s += G.circle(mx + day / 90 * mw, my + mh - (dg.values[day] - lo) / (hi - lo) * mh, 4.5,
      { fill: C.clay, stroke: '#fff', sw: 1.6 });
    s += G.txt(mx, my - 10, '拟合窗口 = 最近 ' + win + ' 天（t=' + from + '—' + day + '）', { size: 9.2, fill: C.ink2, weight: 700 });
    s += G.txt(mx, my + mh + 16, '只有这段参与拟合，虚线部分不用', { size: 8.6, fill: C.ink3 });

    /* 最小二乘原理 */
    s += G.rect(320, 300, 250, 148, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(332, 320, '最小二乘在解什么', { size: 9.6, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 340, 'k = (nΣxy − ΣxΣy) / (nΣx² − (Σx)²)', { size: 9, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 358, 'b = (Σy − kΣx) / n', { size: 9, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 380, 'x 取窗口内的相对序号 0…' + (win - 1), { size: 8.6, fill: '#4a607d' });
    s += G.txt(332, 396, 'k = 斜率（A 或 t/d 每天）　b = 截距', { size: 8.6, fill: '#4a607d' });
    s += G.txt(332, 418, 'n = ' + win + ' 个点参与计算', { size: 8.6, fill: '#4a607d', weight: 700 });
    s += G.txt(332, 436, '窗口越短越贴合近期，但噪声大；', { size: 8.4, fill: '#5d7089' });

    /* 右：拟合直线 */
    var rx = 716, ry = 116, rw = 256, rh = 150;
    s += G.axes(rx, ry, rw, rh, { nx: 4, ny: 4 });
    s += G.line(rx, ry + rh - (dg.threshold - lo) / (hi - lo) * rh, rx + rw, ry + rh - (dg.threshold - lo) / (hi - lo) * rh,
      { stroke: C.red, dash: '4 3', sw: 1.3 });
    s += polyOf(Array.prototype.slice.call(dg.values), rx, ry, rw, rh, lo, hi, C.ink4, 1.2);
    /* 拟合直线（相对窗内序号） */
    var fitPts = [], j;
    for (j = 0; j < win; j++) {
      var yv = c.fit.intercept + c.fit.slope * j;
      fitPts.push([rx + (from + j) / 90 * rw, ry + rh - (yv - lo) / (hi - lo) * rh]);
    }
    s += G.poly(fitPts, { stroke: C.clay, sw: 2.2 });
    s += G.txt(rx, ry - 10, '拟合直线 q = k·x + b', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(rx, ry + rh + 16, '斜率 k = ' + f(c.fit.slope, 3) + ' t/d 每天', { size: 9, mono: true, fill: C.clay, weight: 700 });
    s += G.rect(716, 300, 256, 148, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(728, 320, '拟合结果', { size: 9.6, fill: C.ink, weight: 700 });
    var rr = [
      ['斜率 k', f(c.fit.slope, 4), '每天下降多少'],
      ['截距 b', f(c.fit.intercept, 3), 'x=0 时的拟合值'],
      ['参与点数 n', String(c.fit.n), '窗口内的天数']
    ];
    for (j = 0; j < 3; j++) {
      var ry2 = 344 + j * 32;
      s += G.txt(728, ry2, rr[j][0], { size: 9.2, fill: C.ink2 });
      s += G.txt(830, ry2, rr[j][1], { size: 10, mono: true, fill: C.jadeD, weight: 700 });
      s += G.txt(728, ry2 + 12, rr[j][2], { size: 8.2, fill: C.ink4 });
    }

    return {
      svg: s,
      stats: [
        { k: '拟合窗口', v: win + ' 天' },
        { k: '退化斜率 k', v: f(c.fit.slope, 4), tone: 'warn' },
        { k: '当前产液', v: f(dg.values[day], 1) + ' t/d' },
        { k: '报警阈值', v: dg.threshold + ' t/d' }
      ],
      note: '<b>最小二乘在做什么：</b>在最近 W 天的散点里找一条<b>让所有点到它的竖直距离平方和最小</b>的直线。直线的斜率 k 就是「每天掉多少」。注意只用最近这一段（蓝框），更早的历史不参与——因为退化速率可能已经变了。'
    };
  }

  /* =========================================================
     ⑤ 外推求 RUL
     ========================================================= */
  function stage5(t) {
    var c = compute(), dg = c.dg, L = c.L;
    var s = '';
    var win = L.win, day = L.day;
    var from = day - win + 1;

    s += G.panel(0, '① 把直线延伸到未来', '沿当前退化速度继续走', C.jade);
    s += G.panel(1, '② 找跌破阈值的那一天', '直线 ∩ 报警阈值 = 失效日', C.blue);
    s += G.panel(2, '③ RUL = 还剩几天', '今天到失效日的天数', C.clay);

    var lo = 10, hi = 50;
    var x0 = 30, y0 = 116, w = 250, h = 150;
    var fit = c.fit;
    /* 拟合直线在 x=win-1 处的值 */
    var curFit = fit.slope * (win - 1) + fit.intercept;
    /* 交点：curFit + slope * Δ = threshold */
    var delta = (curFit - dg.threshold) / (-fit.slope);

    /* 左：延伸 */
    s += G.axes(x0, y0, w, h, { nx: 4, ny: 4 });
    s += G.line(x0, y0 + h - (dg.threshold - lo) / (hi - lo) * h, x0 + w, y0 + h - (dg.threshold - lo) / (hi - lo) * h,
      { stroke: C.red, dash: '4 3', sw: 1.4 });
    s += G.txt(x0 + w - 2, y0 + h - (dg.threshold - lo) / (hi - lo) * h - 5, '阈值 ' + dg.threshold,
      { size: 8.4, fill: C.red, anchor: 'end' });
    /* 历史 */
    s += polyOf(Array.prototype.slice.call(dg.values, 0, day + 1), x0, y0, w, h, lo, hi, C.ink3, 1.3);
    /* 未来延伸（虚线） */
    var extPts = [], j;
    for (j = 0; j <= 30; j++) {
      var xv = day + j;
      var yv = curFit + fit.slope * j;
      extPts.push([x0 + clamp(xv, 0, 90) / 90 * w, y0 + h - (yv - lo) / (hi - lo) * h]);
    }
    s += G.poly(extPts, { stroke: C.clay, sw: 2.2, dash: '5 3' });
    s += G.txt(x0, y0 - 10, '外推段（虚线）', { size: 9.5, fill: C.clay, weight: 700 });
    s += G.txt(x0, y0 + h + 16, '今天（t=' + day + '）之后，按当前速度继续走', { size: 8.6, fill: C.ink3 });
    s += footBox(30, 250, 300, 148, '外推的两个前提',
      ['① 退化速率在未来保持不变；',
       '② 中间没有干预（清垢、换泵、调整制度）。',
       '',
       '前提不成立就会估错——所以现场做法是',
       '定期重估，而不是一次算完躺平。',
       '把 RUL 当「参考」，不当「承诺」。'], 'jade');

    /* 中：求交点 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    s += G.line(mx, my + mh - (dg.threshold - lo) / (hi - lo) * mh, mx + mw, my + mh - (dg.threshold - lo) / (hi - lo) * mh,
      { stroke: C.red, dash: '4 3', sw: 1.3 });
    s += polyOf(Array.prototype.slice.call(dg.values, 0, day + 1), mx, my, mw, mh, lo, hi, C.ink3, 1.2);
    var ePts = [];
    for (j = 0; j <= 30; j++) {
      var xv2 = day + j, yv2 = curFit + fit.slope * j;
      ePts.push([mx + clamp(xv2, 0, 90) / 90 * mw, my + mh - (yv2 - lo) / (hi - lo) * mh]);
    }
    s += G.poly(ePts, { stroke: C.clay, sw: 2, dash: '5 3' });
    /* 交点 */
    var crossDay = day + delta;
    if (crossDay <= 90) {
      var cxp = mx + crossDay / 90 * mw, cyp = my + mh - (dg.threshold - lo) / (hi - lo) * mh;
      s += G.circle(cxp, cyp, 5, { fill: C.red, stroke: '#fff', sw: 1.6 });
      s += G.txt(cxp + 8, cyp - 6, '失效日 t=' + Math.round(crossDay), { size: 9, fill: C.red, weight: 700 });
    }
    s += G.txt(mx, my - 10, '直线与阈值线求交', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(mx, my + mh + 16, 'Δ = (拟合值 − 阈值) / (−斜率)', { size: 8.6, mono: true, fill: C.ink3 });
    s += G.rect(320, 300, 250, 148, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(332, 320, '一步算完', { size: 9.6, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 340, '拟合值 q̂ = k·(W−1) + b', { size: 9, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 358, 'Δ = (q̂ − 阈值) / (−k)', { size: 9, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 380, 'q̂ = ' + f(curFit, 2) + ' t/d', { size: 9.2, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 398, 'Δ = (' + f(curFit, 2) + ' − ' + dg.threshold + ') / ' + f(-fit.slope, 4),
      { size: 9.2, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 418, '= ' + f(delta, 2) + ' 天', { size: 10.5, mono: true, fill: C.clay, weight: 700 });
    s += G.txt(332, 436, '若 k ≥ 0（没在退化）→ 无法外推', { size: 8.4, fill: '#5d7089' });

    /* 右：RUL 结果 */
    var rx = 716;
    s += G.rect(rx, 116, 256, 120, { r: 8, fill: C.jadeL, stroke: '#b9d8cb', sw: 1.3 });
    s += G.txt(rx + 128, 148, '剩余寿命 RUL', { size: 11, fill: C.jadeD, anchor: 'middle', weight: 700 });
    s += G.txt(rx + 128, 190, (c.rul == null ? '—' : c.rul + ' 天'), { size: 30, fill: C.jadeD, anchor: 'middle', weight: 700 });
    s += G.txt(rx + 128, 214, '按当前退化速度', { size: 9, fill: '#3f6b5d', anchor: 'middle' });
    s += G.rect(rx, 248, 256, 84, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(rx + 12, 268, '模型估计 vs 真实答案', { size: 9.6, fill: C.ink, weight: 700 });
    s += G.txt(rx + 12, 290, '模型估计 RUL', { size: 9, fill: C.ink3 });
    s += G.txt(rx + 128, 290, (c.rul == null ? '—' : c.rul + ' 天'), { size: 10.5, mono: true, fill: C.jadeD, weight: 700 });
    s += G.txt(rx + 12, 310, '真实 RUL（模拟已知）', { size: 9, fill: C.ink3 });
    s += G.txt(rx + 128, 310, c.tru + ' 天', { size: 10.5, mono: true, fill: C.ink2, weight: 700 });
    s += G.txt(rx + 12, 328, '误差 ' + (c.rul == null ? '—' : Math.abs(c.rul - c.tru) + ' 天'),
      { size: 8.8, mono: true, fill: Math.abs((c.rul || 0) - c.tru) <= 5 ? C.jadeD : C.clay, weight: 700 });
    s += footBox(rx, 256, 344, 104, 'RUL 拿来干什么',
      ['不是预测「一定哪天坏」，而是排作业顺序：',
       'RUL 短的井优先清修/换泵，RUL 长的排在后面。',
       '把有限的作业队投到最该修的井上。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '模型 RUL', v: c.rul == null ? '—' : c.rul + ' 天', tone: 'ok' },
        { k: '真实 RUL', v: c.tru + ' 天' },
        { k: '估计误差', v: c.rul == null ? '—' : Math.abs(c.rul - c.tru) + ' 天' },
        { k: '退化斜率', v: f(fit.slope, 4) }
      ],
      note: '<b>RUL 是怎么算出来的：</b>把拟合直线沿当前斜率继续延伸，找到它<b>跌破报警阈值</b>的那一天——从今天到那一天的天数，就是剩余寿命。注意它是一个<b>按当前退化速度的推算</b>，不是预言；现场会定期重估，也会在清垢后重新算。'
    };
  }

  /* =========================================================
     ⑥ 分级决策
     ========================================================= */
  function stage6(t) {
    var c = compute(), L = c.L;
    var s = '';
    var fleet = c.fleet, ev = c.ev;

    s += G.panel(0, '① 每口井算两个特征', '电流趋势斜率 × 波动性', C.jade);
    s += G.panel(1, '② 二维特征空间', '健康井聚在左下角，故障井散在右上', C.blue);
    s += G.panel(2, '③ 四级预警 + 提前量', '按风险分级，只让紧急井停机', C.clay);

    /* 左：两个特征 */
    var x0 = 30, y0 = 116, w = 250, h = 150;
    s += G.axes(x0, y0, w, h, { nx: 4, ny: 4 });
    var wells = fleet;
    var slopes = wells.map(function (w2) { return w2.slope; });
    var vols = wells.map(function (w2) { return w2.vol; });
    var sLo = Math.min.apply(null, slopes), sHi = Math.max.apply(null, slopes);
    var vLo = Math.min.apply(null, vols), vHi = Math.max.apply(null, vols);
    s += G.txt(x0, y0 - 10, '每口井 → 两个数', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0 + w, y0 + h + 16, '电流趋势斜率 →', { size: 8.6, fill: C.ink3, anchor: 'end' });
    s += G.txt(x0 - 6, y0 + 6, '波动性 ↑', { size: 8.6, fill: C.ink3, anchor: 'end' });
    for (var i = 0; i < wells.length; i++) {
      var wl = wells[i];
      var px = x0 + (wl.slope - sLo) / (sHi - sLo || 1) * w;
      var py = y0 + h - (wl.vol - vLo) / (vHi - vLo || 1) * h;
      var col = wl.state === 'normal' ? C.jade : (wl.state === 'care' ? C.amber : C.red);
      var r = 4 + (i % 3);
      s += G.circle(px, py, r, { fill: col, op: wl.state === 'normal' ? 0.5 : 0.85 });
      if (wl.state !== 'normal') s += G.txt(px + r + 2, py + 3, wl.id, { size: 7.6, mono: true, fill: C.ink3 });
    }
    s += footBox(30, 250, 300, 148, '两个特征怎么来的',
      ['斜率：最近一个月电流的拟合斜率（A/月）。',
       '波动性：电流的标准差（A）——气锁、缺相',
       '会让泵忽快忽慢，波动明显变大。',
       '',
       '两个数合起来，比「电流是不是 92 A」',
       '这种单点判据更能刻画泵的健康度。'], 'jade');

    /* 中：二维空间与分级边界 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    /* 分级线 */
    var thr = L.thr;
    var b1 = mx + (0.35 - 0.15 * thr) / 0.9 * mw;
    var b2 = my + mh - (0.55 - 0.35 * thr) / 0.9 * mh;
    s += G.rect(mx, my, Math.max(0, b1 - mx), Math.max(0, b2 - my), { fill: C.jadeL, op: 0.55 });
    s += G.line(b1, my, b1, my + mh, { stroke: C.jade, dash: '4 3', sw: 1.3 });
    s += G.line(mx, b2, mx + mw, b2, { stroke: C.jade, dash: '4 3', sw: 1.3 });
    s += G.txt(mx + 6, my + 16, '正常', { size: 9, fill: C.jadeD, weight: 700 });
    s += G.txt(b1 + 5, my + mh - 6, '关注', { size: 9, fill: C.amber, weight: 700 });
    s += G.txt(mx + mw - 26, b2 - 5, '预警', { size: 9, fill: C.clay, weight: 700 });
    s += G.txt(mx + mw - 20, my + 14, '紧急', { size: 9, fill: C.red, weight: 700, anchor: 'end' });
    for (i = 0; i < wells.length; i++) {
      var w3 = wells[i];
      var px3 = mx + (w3.slope - sLo) / (sHi - sLo || 1) * mw;
      var py3 = my + mh - (w3.vol - vLo) / (vHi - vLo || 1) * mh;
      var lv = M.classify(w3.slope, w3.vol, thr);
      var col3 = lv >= 3 ? C.red : lv === 2 ? C.clay : lv === 1 ? C.amber : C.jade;
      s += G.circle(px3, py3, 3.4 + lv, { fill: col3, op: 0.8 });
    }
    s += G.txt(mx, my - 10, '分级边界随灵敏度滑动', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(mx, my + mh + 16, '当前灵敏度 τ = ' + f(thr, 2), { size: 9, mono: true, fill: C.clay, weight: 700 });
    s += G.rect(320, 300, 250, 148, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(332, 320, '分级规则', { size: 9.6, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 340, 'score = 斜率/1.0 + 波动/2.5', { size: 9, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 360, 'score 与 4·τ 比较 → 0/1/2/3 级', { size: 9, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 384, '级别 0 正常　1 关注　2 预警　3 紧急', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 404, 'τ 越小 → 边界越靠左 → 越激进', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 420, '检出更多，但误报也更多', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 438, 'τ 越大 → 越保守，只报最有把握的', { size: 8.8, fill: '#4a607d', weight: 700 });

    /* 右：结果与提前量 */
    var rx = 716;
    s += G.rect(rx, 116, 256, 118, { r: 8, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(rx + 128, 136, '本轮 ' + fleet.length + ' 口井的分级结果', { size: 9.4, fill: C.ink, anchor: 'middle', weight: 700 });
    var lvArr = c.lvCnt;
    var lvNames = ['正常', '关注', '预警', '紧急'];
    var lvCols = [C.jade, C.amber, C.clay, C.red];
    var bw = 256 / 4;
    for (i = 0; i < 4; i++) {
      var cnt = lvArr[i] || 0;
      var bx = rx + i * bw;
      s += G.rect(bx + 4, 150, bw - 8, 22, { r: 4, fill: lvCols[i], op: 0.18 });
      s += G.rect(bx + 4, 150, (bw - 8) * clamp(cnt / Math.max(1, fleet.length / 2), 0, 1), 22,
        { r: 4, fill: lvCols[i], op: 0.8 });
      s += G.txt(bx + bw / 2, 166, String(cnt), { size: 10.5, mono: true, fill: lvCols[i], anchor: 'middle', weight: 700 });
      s += G.txt(bx + bw / 2, 188, lvNames[i], { size: 8.6, fill: C.ink3, anchor: 'middle' });
    }
    s += G.txt(rx + 12, 210, '检出率 ' + (ev.detectRate * 100).toFixed(0) + '%　误报率 ' + (ev.falseAlarmRate * 100).toFixed(0) + '%',
      { size: 9, mono: true, fill: C.ink2 });
    s += G.txt(rx + 12, 226, '平均提前量 ' + f(ev.avgLead, 1) + ' 天', { size: 9, mono: true, fill: C.jadeD, weight: 700 });

    /* 提前量分布 */
    s += G.rect(rx, 246, 256, 96, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(rx + 12, 266, '提前量分布（发现故障时已提前的天数）', { size: 9, fill: C.ink, weight: 700 });
    var leads = c.leads;
    var bmax = Math.max.apply(null, leads.concat([1]));
    for (i = 0; i < leads.length; i++) {
      var lx = rx + 14 + i * ((256 - 28) / Math.max(1, leads.length));
      var lh = leads[i] / bmax * 52;
      s += G.rect(lx, 326 - lh, (256 - 28) / Math.max(1, leads.length) - 3, lh, { fill: C.jade, op: 0.75, r: 1 });
      if (i % 3 === 0) s += G.txt(lx + 3, 338, String(leads[i]), { size: 7.6, mono: true, fill: C.ink3 });
    }
    s += footBox(rx, 256, 354, 94, '分级的意义',
      ['不是所有预警都要停机。紧急井立刻排检泵；',
       '预警井加密监测；关注井下次再看。',
       '用最少的人工跑腿，换最大的提前量。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '井数', v: fleet.length },
        { k: '检出率', v: (ev.detectRate * 100).toFixed(0) + '%', tone: 'ok' },
        { k: '误报率', v: (ev.falseAlarmRate * 100).toFixed(0) + '%' },
        { k: '平均提前量', v: f(ev.avgLead, 1) + ' 天', tone: 'ok' }
      ],
      note: '<b>为什么要分级：</b>24 口井同时报警，作业队只有 2 个人。智能化的价值不是「全都报」，而是<b>把井按紧急程度排序</b>——先修 RUL 最短的、最可能马上坏的。这样同样的人力，提前量却大得多。'
    };
  }

  global.EspFlow = {
    stage1: stage1, stage2: stage2, stage3: stage3,
    stage4: stage4, stage5: stage5, stage6: stage6, compute: compute
  };
})(typeof window !== 'undefined' ? window : this);
