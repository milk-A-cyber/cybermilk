/* =========================================================
   井眼轨迹智能控制 · 算法解剖（轨迹建模 + MPC + 闭环安全）
   ---------------------------------------------------------
   把「随钻测点 → 闭环轨迹控制」拆成 6 步，每一步都跑真代码：

     ① 数据接入      随钻测点 + 工具记录
     ② 轨迹拟合      测点 → 连续轨迹
     ③ 系统辨识      命令 → 实际造斜响应
     ④ 模型预测控制  向前看几步 → 最优命令
     ⑤ 闭环安全      每步校验安全边界
     ⑥ 落靶验收      实钻 vs 设计 → 回流

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

  var x0 = 40, w = 300;
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
    var key = [L.nSurvey, L.horizon, L.target, L.doglegLimit, L.adviceMode, L.method].join(',');
    if (cache.key === key) return cache;
    var surv = M.genSurvey(L.nSurvey, 20261131);
    var fit = M.fitTrajectory(surv, L.method);
    var mpc = M.mpcControl(surv, L.target, L.horizon, 20261132);
    var safe = M.safetyCheck(fit, mpc.cmd, { dogleg: L.doglegLimit, friction: 8 });
    var adv0 = M.advToControl(0, mpc, fit);
    var adv1 = M.advToControl(1, mpc, fit);
    cache = { key: key, L: L, surv: surv, fit: fit, mpc: mpc, safe: safe, adv0: adv0, adv1: adv1 };
    return cache;
  }

  /* =========================================================
     ① 数据接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), L = c.L, surv = c.surv;
    var s = '';
    s += G.panel(0, '① 随钻测点', '井深/井斜/方位', C.clay);
    s += G.panel(1, '② 工具记录', '工具面/滑动段', C.blue);
    s += G.panel(2, '③ 靶区设计', '控制目标', C.jade);

    var y0 = 130, h = 120;
    s += G.txt(x0, y0 - 22, '随钻测点：井斜角（°）随井深', { size: 9.5, fill: C.ink2, weight: 700 });
    var incMin = 15, incMax = 55;
    var arr = [];
    for (var i = 0; i < surv.n; i++) arr.push((surv.inc[i] - incMin) / (incMax - incMin));
    s += line(arr, x0, y0 + h, w / surv.n, h, C0, false);
    for (i = 0; i < surv.n; i++) {
      var px = x0 + i * w / surv.n;
      var py = y0 + h - (surv.inc[i] - incMin) / (incMax - incMin) * h;
      s += G.circle(px, py, 2.6, { fill: C0 });
    }
    s += G.txt(x0, y0 + h + 22, '每 ' + Math.round((surv.md[1] - surv.md[0])) + ' m 一测点（井深 ' + Math.round(surv.md[0]) + '—' + Math.round(surv.md[surv.n - 1]) + ' m）', { size: 8.5, fill: C.ink3 });

    s += footBox(420, 170, 130, 180, '测点稀疏的坑',
      ['· 10—30m 才一个测点',
       '· 直接连点当轨迹',
       '  井底位置推算误差大',
       '',
       '井底位置是「推算」',
       '的不是实测，控制',
       '要留不确定余量。'], 'clay');
    return { svg: s, stats: [{ k: '测点', v: surv.n + ' 个' }, { k: '测距', v: Math.round(surv.md[1] - surv.md[0]) + 'm' }, { k: '井深', v: Math.round(surv.md[0]) + '—' + Math.round(surv.md[surv.n - 1]) + 'm' }], note: '读入随钻测量（井深/井斜/方位）+ 工具面与滑动记录。测点稀疏（10—30m 一个），直接连点当轨迹，井底位置推算误差大。' };
  }

  /* =========================================================
     ② 轨迹拟合
     ========================================================= */
  function stage2(t) {
    var c = compute(), L = c.L, fit = c.fit, surv = c.surv;
    var s = '';
    s += G.panel(0, '① 稀疏测点', '10—30m 一个', C.clay);
    s += G.panel(1, '② 最小曲率拟合', '连续轨迹', C.jade);
    s += G.panel(2, '③ 位置推算', '垂深/水平位移', C.blue);

    var y0 = 130, h = 120;
    s += G.txt(x0, y0 - 22, '拟合轨迹：垂深 + 水平位移（最小曲率）', { size: 9.5, fill: C.ink2, weight: 700 });
    /* 轨迹投影 */
    var maxV = Math.max(fit.vs[fit.n - 1], 1);
    var tvArr = [], vsArr = [];
    for (var i = 0; i < fit.n; i++) { tvArr.push(fit.tv[i] / (fit.tv[fit.n - 1] || 1)); vsArr.push(fit.vs[i] / maxV); }
    s += line(tvArr, x0, y0 + h, w / fit.n, h, C1, false);
    s += G.txt(x0, y0 + h + 20, '垂深 ' + Math.round(fit.tv[fit.n - 1]) + ' m', { size: 8.5, fill: C.ink3 });
    s += line(vsArr, x0, y0 + 40, w / fit.n, h * 0.4, C2, true);
    s += G.txt(x0, y0 + 34, '水平位移 ' + Math.round(fit.vs[fit.n - 1]) + ' m', { size: 8.5, fill: C.ink3 });

    s += footBox(420, 170, 130, 180, '拟合的坑',
      ['· 拟合过拟合测点噪声',
       '→ 轨迹抖动',
       '→ 控制命令跟着乱',
       '',
       '轨迹要平滑，但也要',
       '忠实反映井底真实',
       '位置。'], 'clay');
    return { svg: s, stats: [{ k: '垂深', v: Math.round(fit.tv[fit.n - 1]) + 'm' }, { k: '水平位移', v: Math.round(fit.vs[fit.n - 1]) + 'm' }], note: '把稀疏测点拟合成连续轨迹，推算井底位置与全角变化率。拟合过拟合测点噪声，轨迹抖动，控制命令跟着乱。' };
  }

  /* =========================================================
     ③ 系统辨识
     ========================================================= */
  function stage3(t) {
    var c = compute(), L = c.L, fit = c.fit, surv = c.surv;
    var s = '';
    s += G.panel(0, '① 工具/滑动记录', '控制输入', C.blue);
    s += G.panel(1, '② 学响应模型', '命令→造斜', C.jade);
    s += G.panel(2, '③ 校正地层影响', '扰动因素', C.clay);

    var y0 = 130, h = 120;
    s += G.txt(x0, y0 - 22, '辨识响应：工具面命令 → 实际造斜率', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, w, h, { nx: 4, ny: 3 });
    /* 造斜率随命令的响应曲线（理想 + 地层扰动） */
    var resp = [];
    for (var i = 0; i < 24; i++) {
      var cmd = -3 + i * 6 / 23;
      resp.push(clamp(0.8 * cmd + Math.sin(i * 0.5) * 0.4, -1, 1));
    }
    var arr = [];
    for (i = 0; i < 24; i++) arr.push((resp[i] + 1) / 2);
    s += line(arr, x0, y0 + h, w / 24, h, C1, false);
    s += G.txt(x0, y0 + h + 20, '地层/岩性扰动会歪曲命令→造斜关系', { size: 8.5, fill: C.ink3 });

    s += footBox(420, 170, 130, 180, '辨识的坑',
      ['· 地层突然变化（钻遇',
       '  新岩性）→ 旧模型',
       '  失效 → 命令失准',
       '',
       '要持续用实测更新',
       '辨识模型。'], 'clay');
    return { svg: s, stats: [{ k: '辨识', v: '命令→造斜' }, { k: '扰动', v: '地层/岩性' }], note: '从历史工具面/滑动记录与实测轨迹，学出命令到实际造斜的响应模型。地层突然变化钻遇新岩性，旧辨识模型失效，控制命令失准。' };
  }

  /* =========================================================
     ④ 模型预测控制
     ========================================================= */
  function stage4(t) {
    var c = compute(), L = c.L, mpc = c.mpc, surv = c.surv;
    var s = '';
    s += G.panel(0, '① 当前偏差', '实测位置', C.blue);
    s += G.panel(1, '② 向前看几步', '预测轨迹', C.jade);
    s += G.panel(2, '③ 最优命令', '工具面+滑动段', C.clay);

    var y0 = 130, h = 100;
    s += G.txt(x0, y0 - 22, 'MPC：向前看 ' + L.horizon + ' 步 → 最优命令', { size: 9.5, fill: C.ink2, weight: 700 });
    var predMax = Math.max.apply(null, Array.from(mpc.pred).map(function (v) { return Math.abs(v); })) || 1;
    var arr = [];
    for (var i = 0; i < surv.n; i++) arr.push(mpc.pred[i] / (predMax * 1.2));
    s += G.line(x0, y0 + h / 2, x0 + w, y0 + h / 2, { stroke: '#9ba3a9', sw: 1, dash: '4 3' });
    s += line(arr, x0, y0 + h / 2, w / surv.n, h / 2, '#24333a', false);
    s += G.txt(x0, y0 + h / 2 + 22, '预测轨迹偏差逐步收敛到目标', { size: 8.5, fill: C.ink3 });

    s += footBox(420, 170, 130, 180, 'MPC 的坑',
      ['· 只盯当前偏差不看',
       '  前方 → 命令频繁',
       '  跳变 → 轨迹来回摆',
       '',
       '要向前看几步做',
       '全局最优。'], 'jade');
    return { svg: s, stats: [{ k: '预测步', v: L.horizon }, { k: '目标', v: L.target + '°' }], note: '用响应模型向前看几步，预测轨迹走向，给出最优工具面角与滑动段长度。只盯当前偏差、不看前方，命令频繁跳变，轨迹来回摆。' };
  }

  /* =========================================================
     ⑤ 闭环安全
     ========================================================= */
  function stage5(t) {
    var c = compute(), safe = c.safe, L = c.L, fit = c.fit;
    var s = '';
    s += G.panel(0, '① 控制命令', '工具面+滑动段', C.blue);
    s += G.panel(1, '② 安全边界', '狗腿度/摩阻', C.clay);
    s += G.panel(2, '③ 降级/人工', '闭环安全控制', C.jade);

    var y0 = 130, h = 100;
    s += G.txt(x0, y0 - 22, '闭环安全：全角变化率 vs 安全阈值 ' + f(L.doglegLimit, 1), { size: 9.5, fill: C.ink2, weight: 700 });
    var dogMax = Math.max.apply(null, Array.from(fit.dog)) || 1;
    var scale = Math.max(dogMax, L.doglegLimit);
    var arr = [];
    for (var i = 0; i < fit.n; i++) arr.push(fit.dog[i] / scale);
    s += line(arr, x0, y0 + h, w / fit.n, h, C1, false);
    var thrY = y0 + h - (L.doglegLimit / scale) * h;
    s += G.line(x0, thrY, x0 + w, thrY, { stroke: '#b05a51', sw: 1.4, dash: '5 3' });
    s += G.txt(x0 + w + 6, thrY + 3, '阈值 ' + f(L.doglegLimit, 1), { size: 7.5, fill: '#b05a51' });
    s += G.txt(x0, y0 + h + 22, '状态：' + (safe.ok ? '安全边界内' : '越界，需降级/人工复核'), { size: 9, fill: safe.ok ? C.jadeD : '#b05a51', weight: 700 });

    s += footBox(420, 170, 130, 180, '为什么必须闭环',
      ['· 控制命令出错可能',
       '  冲出靶区',
       '· 只做建议不校验',
       '  → 命令越过安全边界',
       '  → 摩阻卡钻风险',
       '',
       '安全要求极高，异常',
       '必须降级/提醒。'], 'clay');
    return { svg: s, stats: [{ k: '全角变化率', v: f(safe.doglegMax, 2) }, { k: '阈值', v: f(L.doglegLimit, 1) }, { k: '状态', v: safe.ok ? '安全' : '越界' }], note: '每步控制前校验安全边界（全角变化率/狗腿度、摩阻上限），超出就降级或提醒人工。只做建议、不校验，命令越过安全边界，摩阻/卡钻风险暴露。' };
  }

  /* =========================================================
     ⑥ 落靶验收
     ========================================================= */
  function stage6(t) {
    var c = compute(), L = c.L, adv0 = c.adv0, adv1 = c.adv1;
    var s = '';
    s += G.panel(0, '① 实钻轨迹', '落靶对比', C.blue);
    s += G.panel(1, '② 轨迹质量', '狗腿度/摩阻', C.clay);
    s += G.panel(2, '③ 反馈辨识', '越用越准', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(x0, y0 - 22, '验收：建议层 vs 闭环控制 落靶率', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.rect(x0, y0, 110, 60, { r: 5, fill: '#d9b78e', op: 1 });
    s += G.txt(x0 + 55, y0 + 34, adv0.fallRate + '%', { size: 11, fill: '#4d565b', anchor: 'middle', weight: 700 });
    s += G.txt(x0 + 55, y0 + 50, '建议层', { size: 8, fill: '#8a6b52', anchor: 'middle' });
    s += G.rect(x0 + 170, y0, 110, 60, { r: 5, fill: '#2f7d6b', op: 1 });
    s += G.txt(x0 + 225, y0 + 34, adv1.fallRate + '%', { size: 11, fill: '#fff', anchor: 'middle', weight: 700 });
    s += G.txt(x0 + 225, y0 + 50, '闭环控制', { size: 8, fill: '#b9d8cb', anchor: 'middle' });
    s += G.txt(x0, y0 + 76, '落靶 ↑ · 纠偏 ↓ · 摩阻 ↓ · 全程安全边界', { size: 9, fill: C.jadeD, weight: 700 });

    s += footBox(420, 170, 130, 176, '验收的坑',
      ['· 只看终点是否落靶',
       '  → 中间轨迹质量被',
       '   掩盖 → 摩阻问题',
       '· 要全程看轨迹平滑',
       '  与安全边界',
       '',
       '落靶 + 质量 + 安全。'], 'clay');
    return { svg: s, stats: [{ k: '落靶率', v: adv1.fallRate + '%' }, { k: '建议层', v: adv0.fallRate + '%' }], note: '实钻轨迹与设计轨迹对比验收落靶，偏差反馈回辨识模型。验收只看终点是否落靶，不看中间轨迹质量，摩阻问题被掩盖。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
