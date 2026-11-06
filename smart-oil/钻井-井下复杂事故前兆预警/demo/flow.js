/* =========================================================
   井下复杂事故前兆预警 · 算法解剖（多变量异常 + 不均衡 + 可解释）
   ---------------------------------------------------------
   把「多通道 → 事故前兆预警」拆成 6 步，每一步都跑真代码：

     ① 数据接入      多通道 + 工况标注
     ② 异常标注      事故点 → 异常前兆段（极少）
     ③ 异常检测      多通道 → 综合异常分数
     ④ 不均衡处理    重采样 / SMOTE 补少数类
     ⑤ 可解释预警    报警 + 通道贡献 + 触发时刻
     ⑥ 复核与回流    真前兆/误报 → 模型改进

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

  var N = 60, x0 = 30, xS = 360 / N;
  var CH_COLORS = ['#b26a39', '#41699b', '#2f7d6b', '#6b7a6b'];

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

  function chanLine(chan, y0, H, color) {
    var s = '';
    var minV = Infinity, maxV = -Infinity;
    for (var t = 0; t < N; t++) { if (chan[t] < minV) minV = chan[t]; if (chan[t] > maxV) maxV = chan[t]; }
    var span = (maxV - minV) || 1;
    s += '<path d="M';
    for (t = 0; t < N; t++) {
      var v = (chan[t] - minV) / span;
      s += (x0 + t * xS).toFixed(1) + ' ' + (y0 + H - v * H).toFixed(1);
      if (t < N - 1) s += ' L';
    }
    s += '" fill="none" stroke="' + color + '" stroke-width="1.8"/>';
    return s;
  }

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.faultType, L.strength, L.thr, L.window, L.balMethod, L.anomalyRatio].join(',');
    if (cache.key === key) return cache;
    var chan = M.genChannels(N, 20261141);
    var noisy = M.injectAnomaly(chan, 40, L.faultType, L.strength, 20261142);
    var det = M.detectAnomaly(noisy, L.window, L.thr, chan);
    var evts = M.alertEvents(det.score, L.thr);
    var bal = M.balanceTrain(L.anomalyRatio, ['none', 'upsample', 'smote'][L.balMethod], 20261143);
    var expl = evts.length ? M.explainAlert(noisy, det.contrib, evts[0]) : null;
    cache = { key: key, L: L, chan: chan, noisy: noisy, det: det, evts: evts, bal: bal, expl: expl };
    return cache;
  }

  /* =========================================================
     ① 数据接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), L = c.L;
    var s = '';
    s += G.panel(0, '① 多通道', '扭矩/立压/流量/转速', C.clay);
    s += G.panel(1, '② 工况标注', '正常钻进/起下钻', C.blue);
    s += G.panel(2, '③ 排除假异常', '工况切换', C.jade);

    var y0 = 130;
    s += G.txt(x0, y0 - 20, '10+ 随钻通道时序（扭矩/立压/流量/转速）', { size: 9.5, fill: C.ink2, weight: 700 });
    for (var c2 = 0; c2 < 4; c2++) {
      s += chanLine(c.noisy.data[c2], y0 + c2 * 44, 40, CH_COLORS[c2]);
      s += G.txt(4, y0 + c2 * 44 + 40, M.CHANNELS[c2], { size: 7.5, fill: CH_COLORS[c2], weight: 700 });
    }

    s += footBox(420, 170, 120, 180, '为什么要工况标注',
      ['· 正常钻进/起下钻参数',
       '  本身变化大',
       '· 不排除工况切换 →',
       '  正常变化当异常',
       '',
       '误报爆表，现场',
       '疲于应付。'], 'blue');
    return { svg: s, stats: [{ k: '通道', v: '10+' }, { k: '工况', v: '正常钻进/起下钻' }, { k: '目标', v: '排假异常' }], note: '读入随钻多通道时序，按工况标注正常钻进/起下钻。不排除工况切换，会把正常起下钻的参数变化当异常，误报爆表。' };
  }

  /* =========================================================
     ② 异常标注
     ========================================================= */
  function stage2(t) {
    var c = compute(), L = c.L;
    var s = '';
    s += G.panel(0, '① 事故发生点', '卡钻/井漏/溢流', C.clay);
    s += G.panel(1, '② 前兆段标注', '极少样本', C.blue);
    s += G.panel(2, '③ 类不均衡', '异常≈1%', C.jade);

    var y0 = 130;
    s += G.txt(x0, y0 - 20, M.FAULTS[L.faultType] + '前兆（注入强度 ' + f(L.strength, 2) + '）', { size: 9.5, fill: C.ink2, weight: 700 });
    var injStart = 40, injW = 8;
    s += G.rect(x0 + injStart * xS, y0 - 4, injW * xS, 4 * 44 + 8, { fill: '#f5d9d4', op: 0.5, stroke: '#b05a51' });
    for (var c2 = 0; c2 < 4; c2++) {
      s += chanLine(c.noisy.data[c2], y0 + c2 * 44, 40, CH_COLORS[c2]);
      s += G.txt(4, y0 + c2 * 44 + 40, M.CHANNELS[c2], { size: 7.5, fill: CH_COLORS[c2], weight: 700 });
    }
    s += G.txt(x0 + (injStart + injW / 2) * xS, y0 - 4, M.FAULTS[L.faultType] + '前兆', { size: 8, fill: '#b05a51', anchor: 'middle', weight: 700 });

    s += footBox(420, 170, 120, 180, '标注难点',
      ['· 事故本身少',
       '· 异常前兆样本极少',
       '· 类不均衡 ≈ 1%',
       '',
       '边界模糊的正常段',
       '别标成异常，否则',
       '模型更分不清。'], 'clay');
    return { svg: s, stats: [{ k: '事故类型', v: M.FAULTS[L.faultType] }, { k: '前兆强度', v: f(L.strength, 2) }, { k: '异常占比', v: '≈1%' }], note: '把卡钻/井漏/溢流发生点前的异常前兆段标注出来。异常样本太少又不想漏，把边界模糊的正常段也标成异常，模型更分不清。' };
  }

  /* =========================================================
     ③ 多变量异常检测
     ========================================================= */
  function stage3(t) {
    var c = compute(), det = c.det, evts = c.evts, L = c.L;
    var s = '';
    s += G.panel(0, '① 多通道', '10+ 通道', C.blue);
    s += G.panel(1, '② 重建误差', '多变量联合', C.jade);
    s += G.panel(2, '③ 异常分数', '组合前兆', C.clay);

    var y0 = 130;
    s += G.txt(x0, y0 - 20, '综合异常分数（窗口 ' + L.window + ' · 阈值 ' + f(L.thr, 2) + '）', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, 360, 160, { nx: 4, ny: 3 });
    var arrS = [];
    for (var t = 0; t < N; t++) arrS.push(det.score[t]);
    s += '<path d="M';
    for (t = 0; t < N; t++) {
      s += (x0 + t * xS).toFixed(1) + ' ' + (y0 + 160 - det.score[t] * 150).toFixed(1);
      if (t < N - 1) s += ' L';
    }
    s += '" fill="none" stroke="#24333a" stroke-width="2"/>';
    s += G.line(x0, y0 + 160 - L.thr * 150, x0 + 360, y0 + 160 - L.thr * 150, { stroke: '#b05a51', sw: 1.2, dash: '4 3' });
    s += G.txt(x0 + 362, y0 + 160 - L.thr * 150 + 3, '阈值 ' + f(L.thr, 2), { size: 7.5, fill: '#b05a51' });
    evts.forEach(function (e) {
      s += G.rect(x0 + e.start * xS, y0 + 160 - 170, (e.end - e.start + 1) * xS, 170, { fill: '#2f7d6b', op: 0.18 });
    });

    s += footBox(420, 170, 130, 176, '为什么多变量',
      ['· 前兆是多通道组合变化',
       '· 单通道阈值抓不住',
       '· 重建误差联合建模',
       '',
       evts.length + ' 个预警事件',
       '漏一个真前兆代价巨大。'], 'jade');
    return { svg: s, stats: [{ k: '预警事件', v: evts.length + ' 个' }, { k: '阈值', v: f(L.thr, 2) }, { k: '窗口', v: L.window }], note: '用多变量异常检测从多通道算综合异常分数。只看单通道或只看均值，抓不住多个通道同时小幅偏离的组合前兆。' };
  }

  /* =========================================================
     ④ 不均衡处理
     ========================================================= */
  function stage4(t) {
    var c = compute(), bal = c.bal, L = c.L;
    var s = '';
    s += G.panel(0, '① 类不均衡', '正常≈99%', C.clay);
    s += G.panel(1, '② 重采样/SMOTE', '补少数类', C.jade);
    s += G.panel(2, '③ 均衡后训练', '不偏向多数', C.blue);

    var x0 = 40, y0 = 130, bw = 260;
    s += G.txt(x0, y0 - 20, '处理前：正常 ' + (1 - bal.ratioIn) + ' · 异常 ' + bal.ratioIn, { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.rect(x0, y0, bw * (1 - bal.ratioIn), 24, { fill: '#7a8a9a', op: 1 });
    s += G.rect(x0 + bw * (1 - bal.ratioIn), y0, bw * bal.ratioIn, 24, { fill: '#b05a51', op: 1 });
    var label = bal.method === 'none' ? '不处理' : bal.method === 'upsample' ? '重采样' : 'SMOTE 合成';
    s += G.txt(x0, y0 + 40, label + '后：正常 ' + (1 - bal.ratioOut).toFixed(2) + ' · 异常 ' + bal.ratioOut.toFixed(2), { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.rect(x0, y0 + 52, bw * (1 - bal.ratioOut), 24, { fill: '#7a8a9a', op: 1 });
    s += G.rect(x0 + bw * (1 - bal.ratioOut), y0 + 52, bw * bal.ratioOut, 24, { fill: '#2f7d6b', op: 1 });

    s += footBox(420, 150, 130, 170, '效果',
      ['· 召回 ' + Math.round(bal.recall * 100) + '%',
       '· 误报率 ' + Math.round(bal.falseRate * 100) + '%',
       '',
       'SMOTE 合成太假会',
       '学到「合成异常」而非',
       '真前兆 → 真事故照漏。'], 'clay');
    return { svg: s, stats: [{ k: '方法', v: label }, { k: '异常比例', v: bal.ratioIn.toFixed(3) + '→' + bal.ratioOut.toFixed(3) }, { k: '召回', v: Math.round(bal.recall * 100) + '%' }], note: '异常样本极少，用重采样或 SMOTE 合成异常补少数类。SMOTE 合成异常太假，学到的是合成异常而非真前兆，真事故照漏。' };
  }

  /* =========================================================
     ⑤ 可解释预警
     ========================================================= */
  function stage5(t) {
    var c = compute(), expl = c.expl, L = c.L;
    var s = '';
    s += G.panel(0, '① 异常分数', '超阈值触发', C.clay);
    s += G.panel(1, '② 通道贡献', '立压↑ 流量↓', C.blue);
    s += G.panel(2, '③ 可解释', '人敢处置', C.jade);

    var x0 = 30, y0 = 130;
    if (!expl) {
      s += G.txt(x0, y0, '当前参数无预警事件，请调低阈值或加大异常强度。', { size: 9.5, fill: '#8a4f27' });
      return { svg: s, stats: [{ k: '预警', v: '无' }], note: '当前无预警。请调低阈值或加大异常强度触发一次预警。' };
    }
    var maxW = Math.max.apply(null, expl.channels.map(function (cc) { return cc.weight; })) || 1;
    for (var i = 0; i < expl.channels.length; i++) {
      var cc = expl.channels[i];
      var w = (cc.weight / maxW) * 260;
      var col = i < 2 ? '#b05a51' : '#7a8a9a';
      s += G.txt(x0, y0 + i * 34 + 14, cc.chan, { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.rect(x0 + 56, y0 + i * 34, w, 18, { r: 3, fill: col, op: 1 });
      s += G.txt(x0 + 56 + w + 6, y0 + i * 34 + 14, Math.round(cc.weight * 100) + '%', { size: 8, fill: C.ink3 });
    }
    s += G.txt(x0, y0 + 4 * 34 + 8, '触发时刻：第 ' + (expl.peakT + 1) + ' 个采样点 · 持续 ' + expl.duration + ' 点', { size: 9, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + 4 * 34 + 26, M.FAULTS[L.faultType] + '前兆：' + expl.channels[0].chan + '↑ / ' + expl.channels[1].chan + '↑', { size: 8.5, fill: '#8a4f27' });

    s += footBox(420, 170, 130, 176, '可解释的价值',
      ['· 黑盒报警不敢信',
       '· 通道+时刻说清为什么',
       '· 现场敢响应、能定位',
       '',
       '可解释若只是事后贴',
       '标签，会误导处置。'], 'jade');
    return { svg: s, stats: [{ k: '主因', v: expl.channels[0].chan + ' ' + Math.round(expl.channels[0].weight * 100) + '%' }, { k: '触发时刻', v: '第 ' + (expl.peakT + 1) + ' 点' }], note: '给预警附解释：哪几个通道贡献大、哪一段时序触发。可解释是事后贴标签、没反映真实判断依据时，会误导现场处置。' };
  }

  /* =========================================================
     ⑥ 复核与回流
     ========================================================= */
  function stage6(t) {
    var c = compute(), evts = c.evts, bal = c.bal, L = c.L;
    var s = '';
    s += G.panel(0, '① 预警事件', '超阈值', C.blue);
    s += G.panel(1, '② 复核真伪', '真前兆/误报', C.clay);
    s += G.panel(2, '③ 反馈回流', '误报率下降', C.jade);

    var x0 = 30, y0 = 130;
    var rows = [];
    if (evts.length) rows.push(['前兆预警', M.FAULTS[L.faultType], '真前兆']);
    rows.push(['误报复查', '阈值波动段', '待核']);
    rows.push(['处置反馈', '已响应', 'ok']);
    rows.push(['召回提升', Math.round(bal.recall * 100) + '%', 'ok']);
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 36;
      s += G.rect(x0, ry, 360, 28, { r: 4, fill: rows[r][2] === 'ok' ? C.jadeL : rows[r][2] === '待核' ? C.clayL : C.blueL, stroke: rows[r][2] === 'ok' ? '#b9d8cb' : rows[r][2] === '待核' ? '#e6cdb2' : '#c5d6ea' });
      s += G.txt(x0 + 12, ry + 19, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(x0 + 110, ry + 19, rows[r][1], { size: 8.8, fill: rows[r][2] === 'ok' ? C.jadeD : '#8a4f27' });
      s += G.txt(x0 + 320, ry + 19, rows[r][2], { size: 8.8, fill: rows[r][2] === 'ok' ? C.jadeD : '#8a4f27', weight: 700 });
    }
    s += G.txt(x0, y0 - 20, '预警复核与回流清单', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(420, 170, 130, 176, '闭环的意义',
      ['· 复核结果反馈模型',
       '· 误报率持续下降',
       '· 预警越来越可信',
       '',
       '复核不回流 → 模型',
       '不知道误报 → 误报率',
       '永远降不下来。'], 'clay');
    return { svg: s, stats: [{ k: '预警事件', v: evts.length + ' 个' }, { k: '误报率', v: Math.round(bal.falseRate * 100) + '%' }], note: '处理员对每次预警复核，结果反馈回模型。复核不回流，模型不知道误报，误报率永远降不下来。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
