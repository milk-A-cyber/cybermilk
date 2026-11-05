/* =========================================================
   钻井液性能智能调控 · 算法解剖（软测量 + 加量推荐 + 过调抑制）
   ---------------------------------------------------------
   把「高频循环参数 → 加量调控」拆成 6 步，每一步都跑真代码：

     ① 多源数据接入  性能测量 + 高频参数 + 加量
     ② 多源融合软测量  稀疏 → 连续性能趋势
     ③ 加量推荐      偏差 → 该加多少
     ④ 过调抑制      按偏差校准，少振荡
     ⑤ 性能验收      性能 vs 目标窗口
     ⑥ 加量回流      实际加量 + 性能反馈

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

  var N = 100, x0 = 40, w = 300;
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
    var key = [L.nData, L.senseMode, L.recMode].join(',');
    if (cache.key === key) return cache;
    var circ = M.genCirc(N, 20261151);
    var soft = M.softSense(circ, L.senseMode, N, 20261152);
    var devs = new Float64Array(N);
    for (var i = 0; i < N; i++) devs[i] = 1.55 - soft.sense[i];
    var cExp = M.oscillationCtrl(devs, 0, N);
    var cRec = M.oscillationCtrl(devs, 1, N);
    cache = { key: key, L: L, circ: circ, soft: soft, devs: devs, cExp: cExp, cRec: cRec };
    return cache;
  }

  /* =========================================================
     ① 多源数据接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), circ = c.circ, L = c.L;
    var s = '';
    s += G.panel(0, '① 性能测量', '稀疏·每班1—2次', C.clay);
    s += G.panel(1, '② 高频循环参数', '流量/温度/压力', C.blue);
    s += G.panel(2, '③ 加量记录', '动作标签', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(x0, y0 - 22, '高频循环参数：流量（l/s）+ 温度（℃）', { size: 9.5, fill: C.ink2, weight: 700 });
    var flowArr = [], tempArr = [];
    for (var i = 0; i < N; i++) { flowArr.push((circ.flow[i] - 20) / 16); tempArr.push((circ.temp[i] - 42) / 28); }
    s += line(flowArr, x0, y0 + h, w / N, h, C0, false);
    s += line(tempArr, x0, y0 + h, w / N, h * 0.8, C2, true);
    s += G.txt(x0 + 6, y0 - 2, '流量', { size: 7.5, fill: C0 });
    s += G.txt(x0 + 46, y0 - 2, '温度', { size: 7.5, fill: C2 });
    s += G.txt(x0, y0 + h + 22, '高频参数与稀疏性能不同步，直接合并会错位', { size: 8.5, fill: C.ink3 });

    s += footBox(420, 170, 130, 180, '多源数据',
      ['· 性能测量每班1—2次',
       '· 高频循环参数持续',
       '· 加量记录是动作标签',
       '',
       '高频参数 + 稀疏测量',
       '要融合，不能直接',
       '拼。'], 'clay');
    return { svg: s, stats: [{ k: '性能测量', v: '每班1—2次' }, { k: '高频参数', v: '流量/温度/压力' }], note: '读入钻井液性能测量（稀疏）+ 循环/返出高频参数 + 加量记录。高频参数与稀疏性能时间不同步，直接合并会错位，软测量失真。' };
  }

  /* =========================================================
     ② 多源融合软测量
     ========================================================= */
  function stage2(t) {
    var c = compute(), soft = c.soft, L = c.L;
    var s = '';
    s += G.panel(0, '① 高频参数', '流量/温度/压力', C.blue);
    s += G.panel(1, '② 稀疏测量', '每班1—2次', C.clay);
    s += G.panel(2, '③ 多源融合', '连续性能趋势', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(x0, y0 - 22, '性能软测量：' + (L.senseMode === 0 ? '纯稀疏' : '多源融合') + ' · 误差 ' + Math.round(soft.err * 100) + '%', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, w, h, { nx: 4, ny: 3 });
    var trueArr = [], senseArr = [];
    for (var i = 0; i < N; i++) { trueArr.push((soft.trueV[i] - 1.0) / 1.2); senseArr.push((soft.sense[i] - 1.0) / 1.2); }
    s += line(trueArr, x0, y0 + h, w / N, h, C2, true);
    s += line(senseArr, x0, y0 + h, w / N, h, C0, false);
    soft.meas.forEach(function (m) {
      s += G.circle(x0 + m.i * w / N, y0 + h - (m.v - 1.0) / 1.2 * h, 3, { fill: C1 });
    });
    s += G.txt(x0 + 6, y0 - 2, '真实', { size: 7.5, fill: C2 });
    s += G.txt(x0 + 46, y0 - 2, '软测', { size: 7.5, fill: C0 });
    s += G.txt(x0 + 90, y0 - 2, '实测', { size: 7.5, fill: C1 });
    s += G.txt(x0, y0 + h + 22, '多源融合用高频参数连续估算 + 稀疏测量校正', { size: 8.5, fill: C.ink3 });

    s += footBox(420, 170, 130, 180, '为什么要融合',
      ['· 纯稀疏测量跟不上',
       '  井下变化（滞后）',
       '· 高频参数连续',
       '· 融合 = 高频估 +',
       '  稀疏校正',
       '',
       '软测连续趋势。'], 'jade');
    return { svg: s, stats: [{ k: '软测误差', v: Math.round(soft.err * 100) + '%' }, { k: '实测点', v: soft.meas.length + ' 个' }], note: '用高频循环参数 + 稀疏性能测量，软测出性能的连续变化趋势。只靠性能测量本身、不融合高频参数，软测跟不上井下变化。' };
  }

  /* =========================================================
     ③ 加量推荐
     ========================================================= */
  function stage3(t) {
    var c = compute(), devs = c.devs, cRec = c.cRec, L = c.L;
    var s = '';
    s += G.panel(0, '① 性能偏差', '实测-目标', C.blue);
    s += G.panel(1, '② 动作标签', '加量记录', C.jade);
    s += G.panel(2, '③ 推荐加量', '替代经验', C.clay);

    var y0 = 130, h = 110;
    s += G.txt(x0, y0 - 22, '推荐加量（按偏差校准）', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, w, h, { nx: 4, ny: 3 });
    var doseMax = Math.max.apply(null, Array.from(cRec.recDose)) || 1;
    var doseArr = [], devArr = [];
    var devMax = Math.max.apply(null, Array.from(devs).map(function (v) { return Math.abs(v); })) || 1;
    for (var i = 0; i < N; i++) { doseArr.push(cRec.recDose[i] / (doseMax * 1.1)); devArr.push(devs[i] / (devMax * 1.2)); }
    s += line(doseArr, x0, y0 + h, w / N, h, C1, false);
    s += line(devArr, x0, y0 + h, w / N, h, '#7a8a9a', true);
    s += G.txt(x0 + 6, y0 - 2, '加量', { size: 7.5, fill: C1 });
    s += G.txt(x0 + 46, y0 - 2, '偏差', { size: 7.5, fill: '#7a8a9a' });
    s += G.txt(x0, y0 + h + 22, '加量 ∝ 偏差幅度，替代凭经验', { size: 8.5, fill: C.ink3 });

    s += footBox(420, 170, 130, 180, '推荐的坑',
      ['· 把经验加量当最优',
       '  标签 → 学到过调',
       '  行为 → 推荐也过调',
       '',
       '要用性能反馈校准',
       '动作。'], 'clay');
    return { svg: s, stats: [{ k: '末端加量', v: f(cRec.recDose[N - 1], 2) }, { k: '方法', v: L.recMode === 0 ? '经验' : '推荐' }], note: '用加量记录做动作标签，反推处理剂该加多少。把经验加量当最优标签，学到的是过调行为，推荐也过调。' };
  }

  /* =========================================================
     ④ 过调抑制
     ========================================================= */
  function stage4(t) {
    var c = compute(), cExp = c.cExp, cRec = c.cRec, L = c.L;
    var s = '';
    s += G.panel(0, '① 经验加量', '过调再回调', C.clay);
    s += G.panel(1, '② 按偏差校准', '小偏差少加', C.jade);
    s += G.panel(2, '③ 加量更稳', '少振荡省料', C.blue);

    var y0 = 130, h = 110;
    s += G.txt(x0, y0 - 22, '加量后性能偏差：经验 vs 推荐', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, w, h, { nx: 4, ny: 3 });
    s += G.line(x0, y0 + h / 2, x0 + w, y0 + h / 2, { stroke: '#9ba3a9', sw: 0.8, dash: '4 3' });
    var expArr = [], recArr = [];
    for (var i = 0; i < N; i++) { expArr.push(cExp.expPerf[i] / 0.8); recArr.push(cRec.recPerf[i] / 0.8); }
    s += line(expArr, x0, y0 + h / 2, w / N, h / 2, C1, false);
    s += line(recArr, x0, y0 + h / 2, w / N, h / 2, C2, false);
    s += G.txt(x0 + 6, y0 - 2, '经验', { size: 7.5, fill: C1 });
    s += G.txt(x0 + 46, y0 - 2, '推荐', { size: 7.5, fill: C2 });
    s += G.txt(x0, y0 + h + 22, '推荐波动 ' + f(cRec.recWave, 2) + ' · 经验 ' + f(cExp.expWave, 2), { size: 8.5, fill: C.ink3 });

    s += footBox(420, 170, 130, 180, '过调的坑',
      ['· 只按当前偏差猛加',
       '  → 性能来回摆',
       '· 处理剂浪费',
       '',
       '按偏差幅度校准，',
       '小偏差少加。'], 'jade');
    return { svg: s, stats: [{ k: '推荐波动', v: f(cRec.recWave, 2) }, { k: '经验波动', v: f(cExp.expWave, 2) }], note: '推荐加量按偏差幅度校准，偏差小就少加，避免过调再回调振荡。只按当前偏差猛加，不看趋势，性能来回摆，处理剂浪费。' };
  }

  /* =========================================================
     ⑤ 性能验收
     ========================================================= */
  function stage5(t) {
    var c = compute(), cRec = c.cRec, L = c.L;
    var s = '';
    s += G.panel(0, '① 实际性能', '每班测量', C.blue);
    s += G.panel(1, '② 目标窗口', '稳定范围', C.clay);
    s += G.panel(2, '③ 波动幅度', '携岩/井壁', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(x0, y0 - 22, '性能验收：达标率 推荐 ' + Math.round(cRec.recOk * 100) + '%', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.rect(x0, y0, 110, 60, { r: 5, fill: '#d9b78e', op: 1 });
    s += G.txt(x0 + 55, y0 + 34, Math.round(c.cExp.expOk * 100) + '%', { size: 11, fill: '#4d565b', anchor: 'middle', weight: 700 });
    s += G.txt(x0 + 55, y0 + 50, '经验加量', { size: 8, fill: '#8a6b52', anchor: 'middle' });
    s += G.rect(x0 + 170, y0, 110, 60, { r: 5, fill: '#2f7d6b', op: 1 });
    s += G.txt(x0 + 225, y0 + 34, Math.round(cRec.recOk * 100) + '%', { size: 11, fill: '#fff', anchor: 'middle', weight: 700 });
    s += G.txt(x0 + 225, y0 + 50, '推荐+抑过调', { size: 8, fill: '#b9d8cb', anchor: 'middle' });
    s += G.txt(x0, y0 + 76, '达标 ↑ · 波动 ↓ · 携岩好 · 井壁稳', { size: 9, fill: C.jadeD, weight: 700 });

    s += footBox(420, 170, 130, 176, '验收的坑',
      ['· 只看单次是否达标',
       '  → 过调问题被掩盖',
       '· 要看波动幅度',
       '',
       '达标率 × 波动。'], 'clay');
    return { svg: s, stats: [{ k: '推荐达标', v: Math.round(cRec.recOk * 100) + '%' }, { k: '经验达标', v: Math.round(c.cExp.expOk * 100) + '%' }], note: '按班测实际性能，对比目标窗口，看是否稳定。只看单次测量是否达标，不看波动幅度，过调问题被掩盖。' };
  }

  /* =========================================================
     ⑥ 加量回流
     ========================================================= */
  function stage6(t) {
    var c = compute(), L = c.L;
    var s = '';
    s += G.panel(0, '① 实际加量', '执行结果', C.blue);
    s += G.panel(1, '② 性能反馈', '是否过调', C.clay);
    s += G.panel(2, '③ 推荐更准', '振荡下降', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['加量回流', L.recMode === 0 ? '经验·可能过调' : '推荐·按偏差校准', 'ok'],
      ['性能反馈', '已录入', 'ok'],
      ['波动改善', f(c.cExp.expWave - c.cRec.recWave, 2), 'ok'],
      ['推荐迭代', '已更新', 'ok']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 34;
      s += G.rect(x0, ry, 360, 26, { r: 4, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(x0 + 12, ry + 18, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(x0 + 110, ry + 18, rows[r][1], { size: 8.8, fill: C.jadeD });
      s += G.txt(x0 + 320, ry + 18, rows[r][2], { size: 8.8, fill: C.jadeD, weight: 700 });
    }
    s += G.txt(x0, y0 - 20, '加量回流清单', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(420, 170, 130, 176, '回流的坑',
      ['· 实际加量不回流',
       '  → 推荐不知道过调',
       '  → 振荡不收敛',
       '',
       '要闭环校验。'], 'clay');
    return { svg: s, stats: [{ k: '回流', v: '已录入' }, { k: '波动改善', v: f(c.cExp.expWave - c.cRec.recWave, 2) }], note: '实际加量与性能反馈回流，推荐模型越用越准。实际加量结果不回流，推荐不知道过调了，振荡永远不收敛。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
