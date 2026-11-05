/* =========================================================
   钻具失效预测 · 算法解剖（疲劳累积 + 混合建模 + 起钻建议）
   ---------------------------------------------------------
   把「振动/扭矩 → 断钻具预警」拆成 6 步，每一步都跑真代码：

     ① 数据接入      振动/扭矩 + 工况
     ② 疲劳累积      Miner 线性损伤
     ③ 损伤特征      统计/谱特征
     ④ 剩余寿命      物理+时序混合预测
     ⑤ 起钻建议      失效窗口前提醒
     ⑥ 起钻验证      探伤 → 核对 → 回流

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

  var N = 120, x0 = 40, w = 300;
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
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (dash ? 1.8 : 2) + '"' + (dash ? ' stroke-dasharray="5 3"' : '') + '/>';
    return s;
  }

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.nData, L.mode, L.tripThr].join(',');
    if (cache.key === key) return cache;
    var vib = M.genVibration(N, 20261141);
    var fat = M.fatigueAccum(vib.vib, N, 1);
    var rul = M.rulPredict(fat.damage, L.mode, N, 100);
    var trip = M.tripAdvice(rul.rul, L.tripThr, 100);
    cache = { key: key, L: L, vib: vib, fat: fat, rul: rul, trip: trip };
    return cache;
  }

  /* =========================================================
     ① 数据接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), vib = c.vib, L = c.L;
    var s = '';
    s += G.panel(0, '① 振动/扭矩', '高频采样', C.clay);
    s += G.panel(1, '② 工况标注', '正常/振动/冲击', C.blue);
    s += G.panel(2, '③ 区分损伤', '工况差异', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(x0, y0 - 22, '振动幅值 + 工况段（正常/振动/冲击）', { size: 9.5, fill: C.ink2, weight: 700 });
    var mColors = ['#c5d6ea', '#e6cdb2', '#f5d9d4'];
    var seg = [[0, N * 0.3], [N * 0.3, N * 0.55], [N * 0.55, N * 0.75], [N * 0.75, N]];
    for (var i = 0; i < seg.length; i++) {
      var m = i === 0 ? 0 : i === 1 || i === 3 ? 1 : 2;
      s += G.rect(x0 + seg[i][0] * w / N, y0, (seg[i][1] - seg[i][0]) * w / N, h, { fill: mColors[m], op: 0.35 });
    }
    var arr = [];
    for (i = 0; i < N; i++) arr.push(vib.vib[i] / 1.4);
    s += line(arr, x0, y0 + h, w / N, h, C0, false);
    s += G.txt(x0, y0 + h + 22, '振动/扭矩高频但噪声大，直接当特征学到噪声非损伤', { size: 8.5, fill: C.ink3 });

    s += footBox(420, 170, 130, 180, '为什么看工况',
      ['· 振动工况损伤大',
       '· 冲击工况损伤更大',
       '· 正常工况几乎无损伤',
       '',
       '不分工况 → 区分不了',
       '损伤差异 → 寿命估算',
       '粗糙。'], 'clay');
    return { svg: s, stats: [{ k: '采样点', v: N }, { k: '工况', v: '正常/振动/冲击' }], note: '读入钻具振动与扭矩高频时序 + 工况记录。振动/扭矩高频但噪声大，直接当特征，模型学到的是噪声不是损伤。' };
  }

  /* =========================================================
     ② 疲劳累积
     ========================================================= */
  function stage2(t) {
    var c = compute(), fat = c.fat, vib = c.vib;
    var s = '';
    s += G.panel(0, '① 载荷循环', '振动幅值/次数', C.blue);
    s += G.panel(1, '② Miner 损伤', '线性累加', C.jade);
    s += G.panel(2, '③ 物理损伤', '0→1', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(x0, y0 - 22, '疲劳累积：损伤 0→1，越接近失效越快', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, w, h, { nx: 4, ny: 3 });
    var arr = [];
    for (var i = 0; i < N; i++) arr.push(fat.damage[i] > 1 ? 1 : fat.damage[i]);
    s += line(arr, x0, y0 + h, w / N, h, C1, false);
    s += G.line(x0, y0, x0 + w, y0, { stroke: '#b05a51', sw: 1.2, dash: '4 3' });
    s += G.txt(x0 + w + 6, y0 + 3, '失效', { size: 7.5, fill: '#b05a51' });
    s += G.txt(x0, y0 + h + 22, '只数超标次数忽略幅值 → 低估高幅循环加速损伤', { size: 8.5, fill: C.ink3 });

    s += footBox(420, 170, 130, 180, '为什么用物理',
      ['· 疲劳累积是物理过程',
       '· 损伤速率 ∝ 幅值²',
       '· 越接近失效越快',
       '',
       '纯数据模型会忽略',
       '载荷循环次数与',
       '幅值。'], 'clay');
    return { svg: s, stats: [{ k: '累计损伤', v: f(fat.cum, 2) }, { k: '失效点', v: fat.failPoint >= 0 ? '第 ' + fat.failPoint + ' 点' : '未达' }], note: '用疲劳累积模型（Miner 线性损伤）把载荷循环累加为物理损伤。只数振动超标次数，忽略载荷幅值，低估高幅循环的加速损伤。' };
  }

  /* =========================================================
     ③ 损伤特征
     ========================================================= */
  function stage3(t) {
    var c = compute(), vib = c.vib;
    var s = '';
    s += G.panel(0, '① 振动/扭矩', '高频时序', C.blue);
    s += G.panel(1, '② 统计/谱特征', 'RMS/峰值/能量', C.jade);
    s += G.panel(2, '③ 损伤特征', '供 RUL', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(x0, y0 - 22, '损伤特征：RMS/峰值（滑窗统计）', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, w, h, { nx: 4, ny: 3 });
    /* RMS 曲线 */
    var rms = [];
    for (var i = 0; i < N; i++) {
      var a = 0, cnt = 0;
      for (var k = Math.max(0, i - 6); k <= Math.min(N - 1, i + 6); k++) { a += vib.vib[k] * vib.vib[k]; cnt++; }
      rms.push(Math.sqrt(a / cnt) / 1.2);
    }
    s += line(rms, x0, y0 + h, w / N, h, C2, false);
    s += G.txt(x0, y0 + h + 22, '滑窗 RMS 反映工况损伤强度', { size: 8.5, fill: C.ink3 });

    s += footBox(420, 170, 130, 180, '特征的坑',
      ['· 特征太多又相关',
       '  → 模型过拟合',
       '  → RUL 不稳定',
       '',
       '要挑物理上有意义',
       '的特征。'], 'clay');
    return { svg: s, stats: [{ k: '特征', v: 'RMS/峰值/能量' }, { k: '滑窗', v: '13 点' }], note: '从振动/扭矩算统计与谱特征（RMS、峰值、能量），作为时序模型的输入。特征太多又相关，模型过拟合，剩余寿命预测不稳定。' };
  }

  /* =========================================================
     ④ 剩余寿命预测
     ========================================================= */
  function stage4(t) {
    var c = compute(), rul = c.rul, fat = c.fat, L = c.L;
    var s = '';
    s += G.panel(0, '① 物理损伤', '疲劳先验', C.blue);
    s += G.panel(1, '② 时序特征', '振动/扭矩', C.jade);
    s += G.panel(2, '③ 混合模型', '物理+时序', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(x0, y0 - 22, '剩余寿命 RUL：真实 vs 预测（' + ['纯时序', '纯物理', '混合建模'][L.mode] + '）', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, w, h, { nx: 4, ny: 3 });
    var trueArr = [], predArr = [];
    for (var i = 0; i < N; i++) {
      trueArr.push(Math.max(0, (1 - fat.damage[i])) / 1.05);
      predArr.push(rul.rul[i] / 100);
    }
    s += line(trueArr, x0, y0 + h, w / N, h, C2, false);
    s += line(predArr, x0, y0 + h, w / N, h, C1, true);
    s += G.txt(x0 + 6, y0 - 2, '真实', { size: 7.5, fill: C2 });
    s += G.txt(x0 + 50, y0 - 2, '预测', { size: 7.5, fill: C1 });
    s += G.txt(x0, y0 + h + 22, '混合建模误差 ' + Math.round(rul.err * 100) + '% · 纯时序会漂移', { size: 8.5, fill: C.ink3 });

    s += footBox(420, 170, 130, 180, '为什么要混合',
      ['· 失效样本稀少',
       '· 纯时序预测漂移',
       '· 物理先验兜底',
       '',
       '混合 = 物理疲劳',
       '+ 时序特征，',
       '最准。'], 'jade');
    return { svg: s, stats: [{ k: '末端 RUL', v: Math.round(rul.rul[N - 1]) + 'm' }, { k: '误差', v: Math.round(rul.err * 100) + '%' }], note: '用物理疲劳 + 时序混合建模，从损伤特征预测剩余寿命。只靠纯时序、不结合物理，失效样本少时预测漂移、置信度差。' };
  }

  /* =========================================================
     ⑤ 起钻建议
     ========================================================= */
  function stage5(t) {
    var c = compute(), trip = c.trip, rul = c.rul, L = c.L;
    var s = '';
    s += G.panel(0, '① 剩余寿命', '实时更新', C.blue);
    s += G.panel(1, '② 失效窗口', '断钻前提醒', C.clay);
    s += G.panel(2, '③ 起钻建议', '替代超标报警', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(x0, y0 - 22, '起钻建议：剩余寿命 vs 起钻阈值 ' + L.tripThr + 'm', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, w, h, { nx: 4, ny: 3 });
    var predArr = [];
    for (var i = 0; i < N; i++) predArr.push(rul.rul[i] / 100);
    s += line(predArr, x0, y0 + h, w / N, h, C1, false);
    var thrY = y0 + h - (L.tripThr / 100 / 1.05) * h;
    s += G.line(x0, thrY, x0 + w, thrY, { stroke: '#b05a51', sw: 1.4, dash: '5 3' });
    s += G.txt(x0 + w + 6, thrY + 3, '起钻线 ' + L.tripThr + 'm', { size: 7.5, fill: '#b05a51' });
    s += G.txt(x0, y0 + h + 22, '建议：' + trip.advice + ' · 剩余寿命 ' + Math.round(trip.remaining) + ' m', { size: 9, fill: trip.suggest ? '#b05a51' : C.jadeD, weight: 700 });

    s += footBox(420, 170, 130, 180, '建议的权衡',
      ['· 太保守过早起钻',
       '  → 损失钻进时间',
       '· 太激进 → 断钻具',
       '',
       '要在失效窗口前',
       '平衡。'], 'clay');
    return { svg: s, stats: [{ k: '剩余寿命', v: Math.round(trip.remaining) + 'm' }, { k: '建议', v: trip.advice }], note: '在失效窗口前给起钻建议，替代振动超标才报警。预测太保守过早起钻损失钻进时间，太激进又可能断钻具。' };
  }

  /* =========================================================
     ⑥ 起钻验证
     ========================================================= */
  function stage6(t) {
    var c = compute(), trip = c.trip, L = c.L;
    var s = '';
    s += G.panel(0, '① 起钻探伤', '磨损/裂纹', C.blue);
    s += G.panel(1, '② 核对接近失效', '寿命标签', C.clay);
    s += G.panel(2, '③ 反馈回流', '越用越准', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['起钻探伤', trip.suggest ? '裂纹/磨损' : '未见异常', 'ok'],
      ['寿命核对', Math.round(trip.remaining) + ' m', 'ok'],
      ['避免损失', trip.suggest ? '已避免断钻' : '可继续', 'ok'],
      ['反馈回流', '已录入', 'ok']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 34;
      s += G.rect(x0, ry, 360, 26, { r: 4, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(x0 + 12, ry + 18, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(x0 + 110, ry + 18, rows[r][1], { size: 8.8, fill: C.jadeD });
      s += G.txt(x0 + 320, ry + 18, rows[r][2], { size: 8.8, fill: C.jadeD, weight: 700 });
    }
    s += G.txt(x0, y0 - 20, '起钻检查与回流清单', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(420, 170, 130, 176, '回流的坑',
      ['· 验证不回流 → 模型',
       '  不知道预测偏保守',
       '  还是激进',
       '· 误差永远不收敛',
       '',
       '要闭环校验。'], 'clay');
    return { svg: s, stats: [{ k: '建议', v: trip.advice }, { k: '回流', v: '已录入' }], note: '按建议起钻后探伤，核对是否接近失效，结果回流模型。验证不回流，模型不知道预测偏保守还是激进，误差永远不收敛。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
