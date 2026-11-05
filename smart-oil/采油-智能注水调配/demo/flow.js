/* =========================================================
   智能注水调配 · 算法解剖（连通估计 → 代理模型 → 约束优化）
   ---------------------------------------------------------
   把「井组数据 → 最优配注方案」拆成 6 步，每一步都跑真代码：

     ① 注入信号         梯形脉冲是连通估计的有效激励
     ② 滞后搜索         扫描 0—20 天，找相关系数最高的滞后
     ③ 差分去趋势       剥掉共同漂移，避免「假连通」
     ④ 分层物理         渗透率「劫持」配注，高渗层吸水过多
     ⑤ 代理模型         100 组样本 → 高斯核回归（KRR）
     ⑥ 遗传算法         在代理模型上搜最优，再放回真模拟器复核

   依赖：window.WfBridge（demo.js 暴露的真模型）
        window.AFlow（算法解剖引擎）
   ========================================================= */
(function (global) {
  'use strict';

  var B = global.WfBridge;
  if (!B || !global.AFlow) return;

  var G = global.AFlow.G, C = global.AFlow.C;
  var M = B.M;

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
    var key = [L.noise, L.drift, L.detrend, L.lam, L.simNoise].join(',');
    if (cache.key === key) return cache;
    var cs = M.connSeries({ noise: L.noise, drift: L.drift, seed: 20261101 });
    var est = M.estimateGains(cs.inj, cs.prods, L.detrend);
    var estNo = M.estimateGains(cs.inj, cs.prods, false);
    /* 「假连通」教学场景：固定带上共同漂移，两种口径各算一遍 */
    var csD = M.connSeries({ noise: L.noise, drift: true, seed: 20261101 });
    var estD = M.estimateGains(csD.inj, csD.prods, true);
    var estDno = M.estimateGains(csD.inj, csD.prods, false);
    cache = {
      key: key, L: L, cs: cs, est: est, estNo: estNo,
      csD: csD, estD: estD, estDno: estDno
    };
    return cache;
  }

  /* =========================================================
     ① 注入信号与脉冲激励
     ========================================================= */
  function stage1(t) {
    var c = compute(), cs = c.cs, L = c.L;
    var s = '';
    s += G.panel(0, '① 注水井注入曲线', '日注水量 m³/d', C.jade);
    s += G.panel(1, '② 脉冲是「问句」', '加一次水，看哪口井几天后动', C.blue);
    s += G.panel(2, '③ 四口油井的响应', '每口井有自己的滞后和灵敏度', C.clay);

    var x0 = 30, y0 = 116, ww = 250, h = 150;
    var inj = cs.inj;
    var lo = Math.min.apply(null, Array.prototype.slice.call(inj)) - 20;
    var hi = Math.max.apply(null, Array.prototype.slice.call(inj)) + 20;
    s += G.axes(x0, y0, ww, h, { nx: 4, ny: 4 });
    /* 脉冲区间 */
    var pulses = [[43, 70, 260], [123, 135, 320], [193, 205, 180], [248, 260, -220]];
    for (var p = 0; p < pulses.length; p++) {
      s += G.rect(x0 + pulses[p][0] / 300 * ww, y0, (pulses[p][1] - pulses[p][0]) / 300 * ww, h,
        { fill: pulses[p][2] > 0 ? C.jadeL : C.redL, op: 0.75 });
    }
    var upto = Math.max(2, Math.floor(ease(clamp(t, 0, 1)) * 300));
    s += polyOf(Array.prototype.slice.call(inj, 0, upto), x0, y0, ww, h, lo, hi, C.jade, 1.5);
    s += G.txt(x0, y0 - 10, '日注水量 I(t)', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + h + 16, '4 次脉冲（最后一次是降量）', { size: 9, fill: C.ink3 });
    s += footBox(30, 250, 300, 148, '为什么非要人为打脉冲',
      ['连通性没法直接测——井在地下几千米。',
       '但可以「问」：多注一次水，看哪口油井',
       '几天后产量动了、动了多少。',
       '',
       '动的幅度 = 增益；动的时间差 = 滞后。',
       '',
       '这不是智能化带来的，是注水现场的',
       '常规做法——智能化要做的是把它做快、',
       '做准、并且在全区井组上自动做。'], 'jade');

    /* 中：脉冲响应原理 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    /* 理想脉冲响应（示意） */
    var resp = [0, 0.05, 0.25, 0.62, 0.85, 0.72, 0.45, 0.28, 0.16, 0.09, 0.05, 0.02, 0.01, 0, 0, 0];
    s += G.poly(resp.map(function (v, i) {
      return [mx + i / (resp.length - 1) * mw, my + mh - v * mh];
    }), { stroke: C.clay, sw: 2 });
    s += G.txt(mx, my - 10, '一口井的脉冲响应（示意）', { size: 9.5, fill: C.ink2, weight: 700 });
    /* 滞后标注 */
    var lagX = mx + 4 / (resp.length - 1) * mw;
    s += G.line(lagX, my, lagX, my + mh, { stroke: C.red, dash: '3 2', sw: 1.2 });
    s += G.txt(lagX + 3, my + 12, '峰值 = 滞后 4 天', { size: 8.6, fill: C.red, weight: 700 });
    s += G.txt(mx, my + mh + 16, '脉冲进井 → 压力波传导 → 油井响应', { size: 8.6, fill: C.ink3 });
    s += footBox(320, 250, 300, 148, '增益与滞后各是什么',
      ['增益 g = Δ产液 / Δ注水（无量纲）：',
       '注 100 m³/d，这口井多产多少。',
       '',
       '滞后 τ（天）：压力波从注水井走到',
       '油井要多久——也反映了井间距。',
       '',
       '不同井的 g 差 8 倍，g 和 τ 就把',
       '井组连通关系画出来了。'], 'blue');

    /* 右：四口油井响应 */
    s += G.txt(716, 100, '四口油井的响应强度', { size: 10, fill: C.ink2, weight: 700 });
    var gains = B.GAINS, lags = B.LAGS;
    for (var pi = 0; pi < 4; pi++) {
      var gy = 118 + pi * 62;
      var isP = gains[pi] > 0.4;
      s += G.rect(716, gy, 256, 52, {
        r: 5, fill: isP ? C.jadeL : '#fdfdfb', stroke: isP ? C.jade : C.line, sw: isP ? 1.4 : 1
      });
      s += G.txt(728, gy + 16, 'P' + (pi + 1), { size: 10, fill: isP ? C.jadeD : C.ink2, weight: 700 });
      s += G.txt(752, gy + 16, '增益 ' + f(gains[pi], 2) + '　滞后 ' + lags[pi] + ' 天',
        { size: 8.8, mono: true, fill: C.ink3 });
      /* 响应条 */
      s += G.rect(728, gy + 26, 232, 14, { r: 3, fill: '#f1f1ee' });
      s += G.rect(728, gy + 26, gains[pi] / 0.8 * 232, 14, { r: 3, fill: isP ? C.jade : C.ink4, op: isP ? 0.9 : 0.5 });
      if (isP) s += G.txt(740, gy + 37, '强连通', { size: 8, fill: '#fff', weight: 700 });
    }
    s += footBox(716, 256, 374, 74, '这张图就是连通图',
      ['P1/P2 与注水井强连通；P4 几乎不受影响——',
       '往 P4 方向配注基本是白花钱。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '注水井', v: 'I1（1 口）' },
        { k: '油井', v: 'P1—P4（4 口）' },
        { k: '脉冲次数', v: '4 次', tone: 'ok' },
        { k: '共同漂移', v: L.drift ? '开' : '关', tone: L.drift ? 'warn' : 'ok' }
      ],
      note: '<b>连通性分析是注水智能化的地基。</b>不知道哪口井和注水井连通，配注就只能凭经验平摊。<b>而脉冲响应分析是「主动实验 + 信号处理」的组合</b>——这本身就是一种最朴素的数据驱动方法，智能化要做的是把它扩展到全区井组、自动识别漂移、自动给出增益排序。'
    };
  }

  /* =========================================================
     ② 滞后搜索（互相关）
     ========================================================= */
  function stage2(t) {
    var c = compute(), cs = c.cs, L = c.L;
    var s = '';
    var N = 300;
    var upto = Math.max(3, Math.floor(ease(clamp(t, 0, 1)) * 21));

    s += G.panel(0, '① 对齐后的两条曲线', '注水与产液差一个滞后 τ', C.jade);
    s += G.panel(1, '② 扫描 τ = 0…20', '相关系数最高处就是最佳滞后', C.blue);
    s += G.panel(2, '③ 四口井各自的答案', '增益 + 滞后 + 相关系数', C.clay);

    /* 左：对齐示意（以 P1 为例，τ=3） */
    var x0 = 30, y0 = 116, ww = 250, h = 150;
    var inj = cs.inj, q = cs.prods[0];
    var lo = 0, hi = 900;
    s += G.axes(x0, y0, ww, h, { nx: 4, ny: 4 });
    /* 注入 */
    s += polyOf(Array.prototype.slice.call(inj), x0, y0, ww, h, lo, hi, C.jade, 1.2, '5 3');
    /* 响应（往后挪 τ） */
    var shifted = [];
    for (var i = 0; i < N; i++) shifted.push(q[i]);
    s += polyOf(shifted, x0, y0, ww, h, lo, hi, C.clay, 1.5);
    /* 滞后括号 */
    var lagW = 3 / N * ww;
    s += G.line(x0 + 40, y0 + h - 14, x0 + 40 + lagW, y0 + h - 14, { stroke: C.red, sw: 1.6 });
    s += G.txt(x0 + 40 + lagW / 2, y0 + h - 20, 'τ=3', { size: 8.4, fill: C.red, anchor: 'middle', weight: 700 });
    s += G.txt(x0, y0 - 10, '绿虚线=注入　橙实线=P1 产液', { size: 9.2, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + h + 16, '把产液往前挪 τ 天，两条线就该对上', { size: 8.6, fill: C.ink3 });
    s += footBox(30, 250, 300, 148, '互相关的直觉',
      ['注水井一加水，压力波要几天才传到油井。',
       '所以油井的产液响应一定「落后」注入量。',
       '',
       '把产液曲线往前挪 τ 天，如果它和注入曲线',
       '长得最像（相关系数最高），那个 τ 就是',
       '这两口井之间的真实滞后。',
       '',
       '相关系数还顺便给出了增益。'], 'jade');

    /* 中：τ 扫描 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    /* 逐个 τ 的相关系数 */
    var taus = [], corrs = [];
    for (var tau = 0; tau <= 20; tau++) {
      var n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (var tt = tau + 2; tt < N; tt++) {
        var dx = L.detrend ? inj[tt - tau] - inj[tt - tau - 1] : inj[tt - tau];
        var dy = L.detrend ? q[tt] - q[tt - 1] : q[tt];
        sx += dx; sy += dy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; n++;
      }
      var vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
      var cc = (vx < 1e-9 || vy < 1e-9) ? 0 : (sxy - sx * sy / n) / Math.sqrt(vx * vy);
      taus.push(tau); corrs.push(cc);
    }
    var cLo = Math.min.apply(null, corrs), cHi = Math.max.apply(null, corrs);
    var cpts = [];
    for (i = 0; i < taus.length; i++) {
      cpts.push([mx + i / 20 * mw, my + mh - (corrs[i] - cLo) / ((cHi - cLo) || 1) * (mh - 20)]);
    }
    /* 已扫描部分高亮 */
    var hiPts = cpts.slice(0, upto);
    s += G.poly(cpts, { stroke: C.ink4, sw: 1.1 });
    s += G.poly(hiPts, { stroke: C.clay, sw: 2.2 });
    /* 最优标记 */
    var bestI = corrs.indexOf(Math.max.apply(null, corrs.map(Math.abs)));
    if (bestI < upto) {
      s += G.circle(cpts[bestI][0], cpts[bestI][1], 5, { fill: C.jade, stroke: '#fff', sw: 1.6 });
      s += G.txt(cpts[bestI][0] + 8, cpts[bestI][1] - 5, 'τ=' + bestI, { size: 9, fill: C.jadeD, weight: 700 });
    }
    s += G.txt(mx, my - 10, '相关系数 vs 滞后 τ', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(mx, my + mh + 16, '已扫 τ = 0…' + (upto - 1) + '　真值 τ=3', { size: 8.6, fill: C.ink3, mono: true });
    s += G.rect(320, 300, 250, 148, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(332, 320, '相关系数怎么算', { size: 9.6, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 340, 'r = Σ(x−x̄)(y−ȳ) / √(Σ(x−x̄)²·Σ(y−ȳ)²)', { size: 8.4, mono: true, fill: '#2b4a72' });
    s += G.txt(332, 362, 'x = 注水增量　y = 产液增量', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 382, '|r| 最大处 → 最佳滞后', { size: 9, mono: true, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 404, 'r = Σxy/Σx²（过原点）', { size: 8.6, mono: true, fill: '#4a607d' });
    s += G.txt(332, 420, '→ 直接得到增益（斜率）', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 440, 'r<0 → 负增益（越注越不产）', { size: 8.4, fill: '#5d7089' });

    /* 右：结果表 */
    s += G.txt(716, 100, '四口井的估计结果', { size: 10, fill: C.ink2, weight: 700 });
    s += G.txt(716, 120, '井', { size: 8.6, fill: C.ink3, weight: 700 });
    s += G.txt(760, 120, '增益 est', { size: 8.6, fill: C.ink3, weight: 700 });
    s += G.txt(824, 120, '真值', { size: 8.6, fill: C.ink3, weight: 700 });
    s += G.txt(872, 120, '滞后 est', { size: 8.6, fill: C.ink3, weight: 700 });
    s += G.txt(936, 120, '真值', { size: 8.6, fill: C.ink3, weight: 700 });
    s += G.line(716, 126, 972, 126, { stroke: C.line });
    for (i = 0; i < 4; i++) {
      var ry = 142 + i * 26;
      var e = c.est[i];
      var okG = Math.abs(e.gain - B.GAINS[i]) < 0.12;
      var okL = e.lag === B.LAGS[i];
      s += G.txt(716, ry + 10, 'P' + (i + 1), { size: 9.4, fill: C.ink2, weight: 700 });
      s += G.txt(760, ry + 10, f(e.gain, 3), { size: 9.4, mono: true, fill: okG ? C.jadeD : C.clay, weight: 700 });
      s += G.txt(824, ry + 10, f(B.GAINS[i], 2), { size: 9, mono: true, fill: C.ink4 });
      s += G.txt(872, ry + 10, String(e.lag), { size: 9.4, mono: true, fill: okL ? C.jadeD : C.clay, weight: 700 });
      s += G.txt(936, ry + 10, String(B.LAGS[i]), { size: 9, mono: true, fill: C.ink4 });
      /* 增益条 */
      s += G.rect(716, ry + 15, 240, 6, { r: 2, fill: '#f1f1ee' });
      s += G.rect(716, ry + 15, clamp(Math.abs(e.gain) / 0.9, 0, 1) * 240, 6, { r: 2, fill: C.jade, op: 0.85 });
    }
    s += footBox(716, 256, 256, 192, '这张表怎么用',
      ['① 按增益排序 → 优先往强连通井方向配注；',
       '② 滞后差异 → 判断井间距与地层连通质量；',
       '③ 增益接近 0 的井 → 配注基本无效，',
       '　应该去查窜流或改换驱替方式；',
       '④ 估计与真值偏差大 → 数据质量或模型假设',
       '　有问题，要人工复核。',
       '',
       '这四步都是人在做，只是现在可以自动做、',
       '而且能在全区井组上同时做。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '扫描范围', v: 'τ = 0…20' },
        { k: '已扫描', v: upto + ' 个' },
        { k: 'P1 估计滞后', v: c.est[0].lag + ' 天', tone: c.est[0].lag === B.LAGS[0] ? 'ok' : 'warn' },
        { k: 'P1 相关系数', v: f(c.est[0].corr, 3) }
      ],
      note: '<b>互相关是最朴素也最可靠的信号处理方法。</b>它不需要任何机器学习，就能从含噪曲线里把滞后和增益估出来。<b>智能化在这里的价值是规模化与自动化</b>——一个井组 20 口井，人工逐对算滞后要几天；自动扫一遍是秒级，还能同时处理全区几百个井组。'
    };
  }

  /* =========================================================
     ③ 差分去趋势与假连通
     ========================================================= */
  function stage3(t) {
    var c = compute(), cs = c.cs, L = c.L;
    var s = '';
    var N = 300;
    var inj = cs.inj;

    s += G.panel(0, '① 共同漂移是什么', '注采制度整体调整带来的同步变化', C.jade);
    s += G.panel(1, '② 不去趋势的后果', '同步漂移被误当成连通', C.blue);
    s += G.panel(2, '③ 一阶差分解决', 'dx = x(t) − x(t−1)', C.clay);

    /* 左：漂移叠加 */
    var x0 = 30, y0 = 116, ww = 250, h = 150;
    var lo = 0, hi = 1400;
    s += G.axes(x0, y0, ww, h, { nx: 4, ny: 4 });
    var base = [], drift = [], i;
    for (i = 0; i < N; i++) base.push(420 + 25 * Math.sin(2 * Math.PI * i / 180));
    for (i = 0; i < N; i++) drift.push(160 * Math.sin(2 * Math.PI * i / 240) + 80 * Math.sin(2 * Math.PI * i / 95));
    s += polyOf(base, x0, y0, ww, h, lo, hi, C.ink4, 1.4, '5 3');
    s += polyOf(base.map(function (v, k) { return v + drift[k]; }), x0, y0, ww, h, lo, hi, C.clay, 1.6);
    s += G.txt(x0, y0 - 10, '灰虚线=基础注入　橙=含共同漂移', { size: 9.2, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + h + 16, '本演示固定带上共同漂移', { size: 9, fill: C.clay, weight: 700 });
    s += footBox(30, 250, 300, 148, '共同漂移从哪来',
      ['全区统一调整注采制度、季节性调度、',
       '计量系统整体标定……这些都会让',
       '所有井同涨同落。',
       '',
       '它跟「连通」是两回事：不管哪口井跟',
       '注水井连不连，它们都会一起动。',
       '',
       '所以必须先把它剥掉。'], 'jade');

    /* 中：假连通 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    var estD = c.estD, estN = c.estDno;
    var maxG = Math.max(
      Math.abs(estD[0].gain), Math.abs(estD[1].gain), Math.abs(estD[2].gain), Math.abs(estD[3].gain),
      Math.abs(estN[0].gain), Math.abs(estN[1].gain), Math.abs(estN[2].gain), Math.abs(estN[3].gain)) || 1;
    for (i = 0; i < 4; i++) {
      var yy = my + 12 + i * 34;
      s += G.txt(324, yy + 10, 'P' + (i + 1), { size: 9.4, fill: C.ink2, weight: 700 });
      /* 不去趋势 */
      s += G.rect(360, yy, 84, 12, { r: 2, fill: '#f1f1ee' });
      s += G.rect(360, yy, Math.max(1, Math.abs(estN[i].gain) / maxG * 84), 12, { r: 2, fill: C.red, op: 0.8 });
      s += G.txt(450, yy + 10, f(estN[i].gain, 2), { size: 8, mono: true, fill: C.ink3 });
      /* 去趋势 */
      s += G.rect(498, yy, 84, 12, { r: 2, fill: '#f1f1ee' });
      s += G.rect(498, yy, Math.max(1, Math.abs(estD[i].gain) / maxG * 84), 12, { r: 2, fill: C.jade, op: 0.85 });
      s += G.txt(588, yy + 10, f(estD[i].gain, 2), { size: 8, mono: true, fill: C.ink3 });
      /* 真值 */
      s += G.rect(624, yy, 44, 12, { r: 2, fill: '#f1f1ee' });
      s += G.rect(624, yy, Math.max(1, Math.abs(B.GAINS[i]) / maxG * 44), 12, { r: 2, fill: C.ink3, op: 0.5 });
    }
    s += G.txt(360, my - 8, '不去趋势', { size: 8.6, fill: C.red, weight: 700 });
    s += G.txt(498, my - 8, '去趋势', { size: 8.6, fill: C.jadeD, weight: 700 });
    s += G.txt(624, my - 8, '真值', { size: 8.6, fill: C.ink3, weight: 700 });
    s += G.txt(324, my + mh + 16, '红条明显偏离真值 → 出现「假连通」', { size: 8.6, fill: C.red, weight: 700 });
    s += G.rect(320, 300, 250, 148, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(332, 320, '一阶差分在做什么', { size: 9.6, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 340, 'dx(t) = x(t) − x(t−1)', { size: 9.6, mono: true, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 362, '共同漂移在差分里被消掉了——', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 378, '因为「一起涨」差分后就是 0。', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 400, '而脉冲是「突然变」，差分后是尖峰，', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 416, '信号被保留了下来。', { size: 8.8, fill: '#4a607d', weight: 700 });
    s += G.txt(332, 440, '差分 = 一个非常朴素的去趋势方法', { size: 8.6, fill: '#5d7089' });

    /* 右：结论 */
    var rx = 716;
    s += G.rect(rx, 116, 256, 116, { r: 8, fill: C.jadeL, stroke: '#b9d8cb' });
    s += G.txt(rx + 12, 136, '去趋势后：估计 vs 真值', { size: 9.6, fill: C.jadeD, weight: 700 });
    for (i = 0; i < 4; i++) {
      var ry2 = 158 + i * 18;
      var err = Math.abs(estD[i].gain - B.GAINS[i]);
      s += G.txt(rx + 12, ry2, 'P' + (i + 1), { size: 9, mono: true, fill: C.ink2 });
      s += G.txt(rx + 48, ry2, f(estD[i].gain, 3), { size: 9, mono: true, fill: C.jadeD, weight: 700 });
      s += G.txt(rx + 118, ry2, '真值 ' + f(B.GAINS[i], 2), { size: 8.6, mono: true, fill: C.ink3 });
      s += G.txt(rx + 244, ry2, '误差 ' + f(err, 3), { size: 8.4, mono: true, fill: err < 0.1 ? C.jadeD : C.clay, anchor: 'end' });
    }
    s += G.rect(rx, 244, 256, 92, { r: 6, fill: C.clayL, stroke: '#e6cdb2' });
    s += G.txt(rx + 12, 264, '不去趋势时错得有多离谱', { size: 9.6, fill: '#8a4f27', weight: 700 });
    s += G.txt(rx + 12, 284, 'P4（真值增益 0.10，最弱连通）', { size: 8.8, fill: '#8a4f27' });
    s += G.txt(rx + 12, 302, '被估成 ' + f(estN[3].gain, 2) + '，滞后估成 ' + estN[3].lag + ' 天',
      { size: 8.8, fill: '#8a4f27', weight: 700 });
    s += G.txt(rx + 12, 322, '——一口几乎不连通的井被判成强连通。', { size: 8.6, fill: '#8a4f27' });
    s += footBox(rx, 256, 348, 100, '工程意义',
      ['去趋势是流程里「必须做」的动作，不是可选优化。',
       '省掉它，整张连通图都会错——而且错得很隐蔽：',
       '看起来相关性很高，其实测的是共同制度。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '场景', v: '含共同漂移', tone: 'warn' },
        { k: '不去趋势 P4', v: f(c.estDno[3].gain, 3), tone: 'bad' },
        { k: '去趋势 P4', v: f(c.estD[3].gain, 3), tone: 'ok' },
        { k: 'P4 真实增益', v: f(B.GAINS[3], 2) }
      ],
      note: '<b>「假连通」是这类算法最典型的坑。</b>相关不等于连通——两口井可能因为共同的制度性调整而同步波动，相关系数很高，但物理上毫无关联。差分去趋势是最简单的解法，但它<b>必须被当成流程里的固定动作</b>，不能指望模型自己会处理。'
    };
  }

  /* =========================================================
     ④ 分层物理：渗透率劫持
     ========================================================= */
  function stage4(t) {
    var c = compute();
    var s = '';
    var R = B.R, K = B.K, VSTAR = B.VSTAR, FSTAR = B.FSTAR;

    s += G.panel(0, '① 四层的两种「应该」', '剩余油潜力 vs 吸水能力', C.jade);
    s += G.panel(1, '② 工程师能调什么', '配水器设定（占总注水比例）', C.blue);
    s += G.panel(2, '③ 实际吸水被劫持', '渗透率把水全吸到高渗层', C.clay);

    /* 左：两列属性 */
    var x0 = 30, y0 = 118, ww = 250;
    s += G.txt(x0, y0 - 8, '层段', { size: 9, fill: C.ink3, weight: 700 });
    s += G.txt(x0 + 52, y0 - 8, '剩余油', { size: 9, fill: C.ink3, weight: 700 });
    s += G.txt(x0 + 108, y0 - 8, '渗透率', { size: 9, fill: C.ink3, weight: 700 });
    s += G.txt(x0 + 170, y0 - 8, '理想配注', { size: 9, fill: C.ink3, weight: 700 });
    s += G.txt(x0 + 236, y0 - 8, '实际吸', { size: 9, fill: C.ink3, weight: 700 });
    s += G.line(x0, y0 - 2, x0 + ww, y0 - 2, { stroke: C.line });
    var manual = B.MANUAL;
    var simM = M.simulate(manual, 900, 0, 5);
    for (var i = 0; i < 4; i++) {
      var ry = y0 + 16 + i * 34;
      s += G.txt(x0, ry + 8, 'L' + (i + 1), { size: 10, fill: C.ink2, weight: 700, mono: true });
      /* 剩余油潜力条 */
      s += G.rect(x0 + 52, ry, 46, 12, { r: 2, fill: '#f1f1ee' });
      s += G.rect(x0 + 52, ry, R[i] / 1.6 * 46, 12, { r: 2, fill: C.jade, op: 0.8 });
      s += G.txt(x0 + 104, ry + 10, f(R[i], 1), { size: 8.6, mono: true, fill: C.ink3 });
      /* 渗透率条（对数） */
      s += G.rect(x0 + 108, ry, 52, 12, { r: 2, fill: '#f1f1ee' });
      s += G.rect(x0 + 108, ry, Math.log10(K[i] / 100) / Math.log10(20) * 52, 12, { r: 2, fill: C.clay, op: 0.8 });
      s += G.txt(x0 + 166, ry + 10, String(K[i]), { size: 8.6, mono: true, fill: C.ink3 });
      /* 理想配注 */
      s += G.txt(x0 + 170, ry + 10, f(FSTAR[i] * 100, 0) + '%', { size: 8.6, mono: true, fill: C.jadeD });
      /* 实际吸水 */
      s += G.txt(x0 + 236, ry + 10, f(simM.s[i] * 100, 0) + '%', { size: 8.6, mono: true, fill: C.clay, weight: 700 });
    }
    s += G.txt(x0, y0 + 16 + 4 * 34 + 4, 'L1 高渗已水淹（潜力小、吸水强）', { size: 8.6, fill: C.ink3 });
    s += G.txt(x0, y0 + 16 + 4 * 34 + 18, 'L4 低渗欠注（潜力大、吸水弱）', { size: 8.6, fill: C.ink3 });
    s += footBox(30, 250, 300, 148, '两个「应该」打架',
      ['从剩余油看：油还在 L3/L4，该多注。',
       '从吸水能力看：L1 渗透率高，一注就进。',
       '',
       '工程师能设配水器（L1 压到 30%、L4 抬到 20%），',
       '但水往哪走，还要看渗透率和井段条件。',
       '',
       '这就是「调不动」的本质。'], 'jade');

    /* 中：吸水模型 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    var groups = [
      { name: '理想配注', f: FSTAR, col: C.jade },
      { name: '均匀配注', f: B.UNIFORM, col: C.ink4 },
      { name: '现状人工', f: manual, col: C.clay }
    ];
    var bw = mw / 4;
    for (i = 0; i < 4; i++) {
      var gx = mx + i * bw;
      for (var gi = 0; gi < groups.length; gi++) {
        var sim = M.simulate(groups[gi].f, 900, 0, 5);
        var vh = sim.s[i] * mh;
        s += G.rect(gx + 2, my + mh - vh, bw - 6, vh, { fill: groups[gi].col, op: 0.85, r: 1 });
        if (gi === 0) {
          /* 理想线 */
          s += G.line(gx, my + mh - FSTAR[i] * mh, gx + bw - 4, my + mh - FSTAR[i] * mh,
            { stroke: C.jade, sw: 1.6, dash: '3 2' });
        }
      }
      s += G.txt(gx + bw / 2 - 2, my + mh + 14, 'L' + (i + 1), { size: 9, fill: C.ink2, anchor: 'middle', weight: 700 });
    }
    s += G.txt(mx, my - 10, '设定配注 vs 实际吸水', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(mx + mw - 4, my + mh + 14, '虚线=理想', { size: 8.4, fill: C.jadeD, anchor: 'end' });
    s += G.rect(320, 300, 250, 148, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(332, 320, '吸水模型', { size: 9.6, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 340, 'sᵢ ∝ fᵢ^γ · Kᵢ', { size: 10.5, mono: true, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 360, 'fᵢ = 配水器设定比例', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 376, 'Kᵢ = 渗透率×厚度（吸水能力）', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 392, 'γ = ' + B.GAMMA + '（配水器控制能力，<1）', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 414, 'γ<1 意味着：设定压得住高渗层，', { size: 8.8, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 430, '但压不住吸水的「自然偏好」。', { size: 8.8, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 448, '再归一化就是实际吸水比例 sᵢ', { size: 8.4, fill: '#5d7089' });

    /* 右：后果 */
    var rx = 716;
    s += G.rect(rx, 116, 256, 118, { r: 8, fill: C.clayL, stroke: '#e6cdb2' });
    s += G.txt(rx + 12, 138, '现状人工方案的后果', { size: 9.8, fill: '#8a4f27', weight: 700 });
    s += G.txt(rx + 12, 162, '日产油', { size: 9, fill: '#8a4f27' });
    s += G.txt(rx + 100, 162, f(simM.oil, 1) + ' t/d', { size: 11, mono: true, fill: '#8a4f27', weight: 700 });
    s += G.txt(rx + 12, 184, '综合含水', { size: 9, fill: '#8a4f27' });
    s += G.txt(rx + 100, 184, f(simM.wc, 1) + '%', { size: 11, mono: true, fill: '#8a4a27', weight: 700 });
    s += G.txt(rx + 12, 206, 'L1 超注 → 水窜', { size: 9, fill: '#8a4f27' });
    s += G.txt(rx + 12, 222, 'L4 欠注 → 潜力挖不动', { size: 9, fill: '#8a4f27' });
    s += G.rect(rx, 246, 256, 100, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(rx + 12, 266, '达成率 oᵢ = 实际注水 / 理想注水', { size: 9, mono: true, fill: C.ink2 });
    for (i = 0; i < 4; i++) {
      var oy = 282 + i * 16;
      s += G.txt(rx + 12, oy, 'L' + (i + 1), { size: 8.6, mono: true, fill: C.ink3 });
      s += G.rect(rx + 42, oy - 8, 130, 9, { r: 2, fill: '#f1f1ee' });
      s += G.rect(rx + 42, oy - 8, clamp(simM.o[i], 0, 1) * 130, 9, { r: 2, fill: simM.o[i] >= 0.95 ? C.jade : C.clay, op: 0.85 });
      s += G.txt(rx + 180, oy, f(simM.o[i] * 100, 0) + '%', { size: 8.4, mono: true, fill: C.ink2 });
    }
    s += footBox(rx, 256, 358, 90, '所以优化必须同时动两件事',
      ['① 各层配注比例（4 个自由度）',
       '② 总注水量（1 个自由度）',
       '只调比例不调总量，水还是不够。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '分层', v: '4 个层段' },
        { k: '配水器能力 γ', v: f(B.GAMMA, 2) },
        { k: '总注水量', v: '900 m³/d' },
        { k: '现状日产油', v: f(simM.oil, 1) + ' t/d', tone: 'warn' }
      ],
      note: '<b>这是注水场景最有意思的地方：设定与结果之间隔着一层物理。</b>工程师能拧的是配水器，但水往哪跑由渗透率决定。<b>因此优化的对象不是「单层注水量」，而是「设定比例 + 总注水量」这 5 个自由度</b>，目标函数还要同时考虑产油和含水——这正是智能优化能派上用场的地方。'
    };
  }

  /* =========================================================
     ⑤ 代理模型（高斯核回归）
     ========================================================= */
  function stage5(t) {
    var c = compute(), L = c.L;
    var s = '';
    var opt = L.opt;
    var model = opt.model, ga = opt.ga;

    if (!model) {
      s += G.panel(0, '① 采样', '正在生成训练样本…', C.gray);
      s += G.panel(1, '② 拟合代理模型', '高斯核回归', C.gray);
      s += G.panel(2, '③ 校验', '留一交叉验证', C.gray);
      return { svg: s, stats: [], note: '代理模型正在训练中……' };
    }

    s += G.panel(0, '① 采样 100 组方案', '每组 = 4 层配注 + 总注水量', C.jade);
    s += G.panel(1, '② 高斯核回归（KRR）', '把模拟器包成一个可解析的函数', C.blue);
    s += G.panel(2, '③ 代理精度校验', '留一交叉验证 + 独立验证集', C.clay);

    /* 左：样本空间 */
    var x0 = 30, y0 = 116, ww = 250, h = 150;
    s += G.axes(x0, y0, ww, h, { nx: 4, ny: 4 });
    var X = opt.trainX;
    /* 投影到 (f3, T) 平面 */
    for (var i = 0; i < X.length; i++) {
      var px = x0 + X[i][2] / 0.7 * ww;
      var py = y0 + h - (X[i][4] * 1200 - 700) / 400 * h;
      s += G.circle(px, py, 2.6, { fill: C.jade, op: 0.65 });
    }
    s += G.txt(x0, y0 - 10, '训练样本在「L3 配注 × 总注水」平面上的分布', { size: 8.8, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + h + 16, '100 组随机方案 + 模拟器评估', { size: 9, fill: C.ink3 });
    s += footBox(30, 250, 300, 148, '为什么要代理模型',
      ['物理模拟器（数值模拟）算一次要几秒到',
       '几分钟。遗传算法要评估成千上万个候选解——',
       '直接用模拟器根本跑不完。',
       '',
       '所以：先用模拟器跑 100 组，训练一个',
       '「便宜版模拟器」（代理模型），',
       '让优化算法在便宜版上随便搜，',
       '最后把最优解放回真模拟器复核。'], 'jade');

    /* 中：核回归原理 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    /* 高斯核函数曲线 */
    var kx = [];
    for (i = 0; i <= 40; i++) {
      var d2 = (i / 40) * 3;
      kx.push([mx + i / 40 * mw, my + mh - Math.exp(-d2 * d2 / (2 * 0.35 * 0.35)) * (mh - 26)]);
    }
    s += G.poly(kx, { stroke: C.blue, sw: 2.2 });
    s += G.txt(mx, my - 10, '高斯核函数 k(x,x′) = exp(−‖x−x′‖²/2σ²)', { size: 8.4, mono: true, fill: C.ink2, weight: 700 });
    s += G.txt(mx, my + mh + 16, '距离越近权重越接近 1，远了趋近 0', { size: 8.6, fill: C.ink3 });
    s += G.rect(320, 300, 250, 148, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(332, 320, 'KRR 的闭式解', { size: 9.6, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 340, 'α = (K + λI)⁻¹ Y', { size: 11, mono: true, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 362, 'ŷ(x) = Σᵢ αᵢ · k(x, xᵢ)', { size: 10, mono: true, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 384, 'K 是 100×100 的核矩阵：', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 400, 'Kᵢⱼ = k(xᵢ, xⱼ)', { size: 9, mono: true, fill: '#4a607d' });
    s += G.txt(332, 420, 'λ 是正则项，防止过拟合', { size: 8.8, fill: '#4a607d' });
    s += G.txt(332, 440, '闭式解 = 每次预测只要一次矩阵乘法，', { size: 8.4, fill: '#5d7089' });
    s += G.txt(332, 452, '毫秒级 → 优化算法可以随便调用', { size: 8.4, fill: '#5d7089' });

    /* 右：精度校验 */
    var rx = 716;
    s += G.rect(rx, 116, 256, 100, { r: 8, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(rx + 12, 136, '留一交叉验证（LOOCV）', { size: 9.8, fill: C.ink, weight: 700 });
    s += G.txt(rx + 12, 158, '每个样本都用「其余 99 个」训练，', { size: 8.8, fill: C.ink2 });
    s += G.txt(rx + 12, 174, '再预测自己——这是最诚实的精度估计', { size: 8.8, fill: C.ink2 });
    s += G.txt(rx + 12, 198, 'RMSE（归一化）', { size: 9, fill: C.ink3 });
    s += G.txt(rx + 244, 198, f(opt.losses.rmse, 4), { size: 11, mono: true, fill: C.jadeD, anchor: 'end', weight: 700 });
    /* 独立验证集 R² */
    s += G.rect(rx, 228, 256, 96, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(rx + 12, 248, '独立验证集（30 组新样本）', { size: 9.4, fill: C.ink, weight: 700 });
    s += G.txt(rx + 12, 270, 'R² 产油', { size: 9, fill: C.ink3 });
    s += G.txt(rx + 244, 270, f(opt.r2.oil, 3), { size: 10, mono: true, fill: C.jadeD, anchor: 'end', weight: 700 });
    s += G.txt(rx + 12, 290, 'R² 含水', { size: 9, fill: C.ink3 });
    s += G.txt(rx + 244, 290, f(opt.r2.wc, 3), { size: 10, mono: true, fill: C.jadeD, anchor: 'end', weight: 700 });
    s += G.txt(rx + 12, 312, 'R² 接近 1 说明代理模型能替代模拟器', { size: 8.4, fill: C.ink4 });
    /* 代理 vs 真值散点 */
    s += G.rect(rx, 336, 256, 112, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(rx + 12, 356, '代理预测 vs 模拟器真值（产油）', { size: 9, fill: C.ink, weight: 700 });
    var pairs = opt.valFit.oil;
    var mxT = 0, mnT = Infinity, mxP = 0, mnP = Infinity;
    for (i = 0; i < pairs.length; i++) {
      mxT = Math.max(mxT, pairs[i][0]); mnT = Math.min(mnT, pairs[i][0]);
      mxP = Math.max(mxP, pairs[i][1]); mnP = Math.min(mnP, pairs[i][1]);
    }
    var gx0 = rx + 40, gy0 = 366, gw = 196, gh = 68;
    s += G.line(gx0, gy0 + gh, gx0 + gw, gy0 + gh, { stroke: C.line });
    s += G.line(gx0, gy0, gx0, gy0 + gh, { stroke: C.line });
    for (i = 0; i < pairs.length; i++) {
      var pxp = gx0 + (pairs[i][1] - mnP) / ((mxP - mnP) || 1) * gw;
      var pyp = gy0 + gh - (pairs[i][0] - mnT) / ((mxT - mnT) || 1) * gh;
      s += G.circle(pxp, pyp, 2.6, { fill: C.blue, op: 0.7 });
    }
    /* 对角线 */
    s += G.line(gx0, gy0 + gh, gx0 + gw, gy0, { stroke: C.ink4, dash: '3 2', sw: 1.1 });
    s += G.txt(gx0 + gw, gy0 + gh + 11, '代理预测 →', { size: 7.6, fill: C.ink4, anchor: 'end' });
    s += G.txt(gx0 - 4, gy0 + 4, '真值 ↑', { size: 7.6, fill: C.ink4, anchor: 'end' });
    s += G.txt(gx0 + gw + 4, gy0 + 4, '点越贴对角线越准', { size: 7.6, fill: C.ink4 });

    return {
      svg: s,
      stats: [
        { k: '训练样本', v: X.length + ' 组', tone: 'ok' },
        { k: 'LOOCV RMSE', v: f(opt.losses.rmse, 4), tone: 'ok' },
        { k: '验证 R² 产油', v: f(opt.r2.oil, 3) },
        { k: '核参数 σ', v: '0.35' }
      ],
      note: '<b>代理模型（surrogate model）是智能优化能落地的关键一步。</b>没有它，遗传算法在真实模拟器上跑不动（一次评估几秒 × 上万次 = 几小时）。有了它，评估变成毫秒级。<b>但代理模型只在训练样本覆盖的区域内可信</b>——所以流程最后一定要「放回真模拟器复核」这一步，不能省。'
    };
  }

  /* =========================================================
     ⑥ 遗传算法与最终方案
     ========================================================= */
  function stage6(t) {
    var c = compute(), L = c.L;
    var s = '';
    var opt = L.opt;
    var ga = opt.ga;
    if (!ga) {
      s += G.panel(0, '① 初始化种群', '64 个随机配注方案', C.gray);
      s += G.panel(1, '② 逐代进化', '选择 → 交叉 → 变异', C.gray);
      s += G.panel(2, '③ 最优方案', '放回真模拟器复核', C.gray);
      return { svg: s, stats: [], note: '优化正在运行中……' };
    }

    s += G.panel(0, '① 个体 = 一个配注方案', '4 层比例 + 1 个总注水量', C.jade);
    s += G.panel(1, '② 遗传算法逐代进化', '选择 → 交叉 → 变异', C.blue);
    s += G.panel(2, '③ 最优方案 vs 现状', '放回真模拟器复核', C.clay);

    /* 左：基因编码 */
    var x0 = 30, y0 = 118, ww = 250;
    var best = ga.best;
    s += G.txt(x0, y0 - 8, '基因', { size: 9, fill: C.ink3, weight: 700 });
    s += G.txt(x0 + 66, y0 - 8, '含义', { size: 9, fill: C.ink3, weight: 700 });
    s += G.txt(x0 + 196, y0 - 8, '最优解', { size: 9, fill: C.ink3, weight: 700 });
    s += G.line(x0, y0 - 2, x0 + ww, y0 - 2, { stroke: C.line });
    var geneMean = ['g0 → softmax → f1', 'g1 → softmax → f2', 'g2 → softmax → f3', 'g3 → softmax → f4', 'g4 → sigmoid → T'];
    for (var i = 0; i < 5; i++) {
      var ry = y0 + 16 + i * 30;
      s += G.txt(x0, ry + 8, 'g' + i, { size: 9.6, mono: true, fill: C.ink2, weight: 700 });
      s += G.txt(x0 + 66, ry + 8, geneMean[i], { size: 8.6, fill: C.ink3 });
      var val = i < 4 ? f(best.f[i] * 100, 1) + '%' : f(best.T, 0) + ' m³/d';
      s += G.txt(x0 + 244, ry + 8, val, { size: 9.4, mono: true, fill: C.jadeD, anchor: 'end', weight: 700 });
    }
    s += G.txt(x0, y0 + 16 + 5 * 30 + 4, 'softmax 保证 4 个比例非负且和为 1', { size: 8.6, fill: C.ink3 });
    s += G.txt(x0, y0 + 16 + 5 * 30 + 18, 'sigmoid 把总注水限制在 700—1100 m³/d', { size: 8.6, fill: C.ink3 });
    s += footBox(30, 250, 306, 142, '为什么要这样编码',
      ['直接优化「4 个比例 + 1 个总量」会违反约束：',
       '比例可能为负、可能加不起来、总量可能离谱。',
       '',
       '用 softmax / sigmoid 把约束「编码进基因」，',
       '每个个体天生就是合法解——',
       '这叫「约束内嵌」，比事后惩罚项更稳。'], 'jade');

    /* 中：进化曲线 */
    var mx = 320, my = 116, mw = 250, mh = 150;
    s += G.axes(mx, my, mw, mh, { nx: 4, ny: 4 });
    var curve = ga.curve;
    var f0 = curve[0][1], fN = curve[curve.length - 1][1];
    var cpts = [], i2;
    for (i2 = 0; i2 < curve.length; i2++) {
      cpts.push([mx + i2 / (curve.length - 1) * mw, my + mh - (curve[i2][1] - f0) / ((fN - f0) || 1) * (mh - 20)]);
    }
    var uptoG = Math.max(2, Math.floor(ease(clamp(t, 0, 1)) * curve.length));
    s += G.poly(cpts, { stroke: C.ink4, sw: 1.1 });
    s += G.poly(cpts.slice(0, uptoG), { stroke: C.clay, sw: 2.2 });
    s += G.circle(cpts[Math.min(uptoG - 1, cpts.length - 1)][0], cpts[Math.min(uptoG - 1, cpts.length - 1)][1], 4.5,
      { fill: C.clay, stroke: '#fff', sw: 1.5 });
    s += G.txt(mx, my - 10, '每代最优适应度', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(mx, my + mh + 16, '第 ' + uptoG + ' / ' + curve.length + ' 代　已提升 ' +
      f((curve[Math.min(uptoG - 1, curve.length - 1)][1] - f0) * 100 / 100, 2), { size: 8.6, fill: C.ink3, mono: true });
    s += G.rect(320, 300, 250, 148, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(332, 320, '一代 = 三步', { size: 9.6, fill: '#2b4a72', weight: 700 });
    s += G.txt(332, 340, '① 选择：锦标赛，两两比适应度', { size: 8.8, fill: '#2b4a72' });
    s += G.txt(332, 360, '② 交叉：算术交叉，70% 概率', { size: 8.8, fill: '#2b4a72' });
    s += G.txt(332, 380, '③ 变异：25% 概率加随机扰动', { size: 8.8, fill: '#2b4a72' });
    s += G.txt(332, 402, '适应度 = 产油 − λ·含水越限惩罚', { size: 8.8, mono: true, fill: '#4a607d' });
    s += G.txt(332, 420, '　　　　　　− 0.02·超总量惩罚', { size: 8.8, mono: true, fill: '#4a607d' });
    s += G.txt(332, 442, 'λ 越大越保守（宁少产也要控含水）', { size: 8.6, fill: '#5d7089' });

    /* 右：最终对比 */
    var rx = 716;
    var manualSim = opt.manualSim, optSim = opt.optSim;
    s += G.rect(rx, 116, 256, 150, { r: 8, fill: C.jadeL, stroke: '#b9d8cb' });
    s += G.txt(rx + 12, 138, '优化方案 vs 现状人工方案', { size: 9.8, fill: C.jadeD, weight: 700 });
    var rows = [
      ['日产油 t/d', manualSim.oil, optSim.oil, 1],
      ['综合含水 %', manualSim.wc, optSim.wc, 1],
      ['吨油耗水', 900 / manualSim.oil, 900 / optSim.oil, 2]
    ];
    for (i = 0; i < rows.length; i++) {
      var ry2 = 162 + i * 32;
      s += G.txt(rx + 12, ry2, rows[i][0], { size: 9, fill: '#3f6b5d' });
      s += G.txt(rx + 108, ry2, f(rows[i][1], rows[i][3]), { size: 9.4, mono: true, fill: C.ink3, anchor: 'end' });
      s += G.txt(rx + 124, ry2, '→', { size: 9, fill: '#3f6b5d' });
      s += G.txt(rx + 244, ry2, f(rows[i][2], rows[i][3]), { size: 10.5, mono: true, fill: C.jadeD, anchor: 'end', weight: 700 });
    }
    s += G.txt(rx + 12, 254, '产油 ' + f((optSim.oil / manualSim.oil - 1) * 100, 1) + '%　含水 ' +
      f(optSim.wc - manualSim.wc, 1) + ' 个百分点', { size: 9, fill: '#3f6b5d', weight: 700 });
    /* 分层配注对比 */
    s += G.rect(rx, 278, 256, 96, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(rx + 12, 298, '各层配注比例', { size: 9.4, fill: C.ink, weight: 700 });
    for (i = 0; i < 4; i++) {
      var oy = 316 + i * 15;
      s += G.txt(rx + 12, oy, 'L' + (i + 1), { size: 8.4, mono: true, fill: C.ink3 });
      /* 现状 */
      s += G.rect(rx + 38, oy - 8, 90, 8, { r: 2, fill: '#f1f1ee' });
      s += G.rect(rx + 38, oy - 8, manualSim.s[i] * 90, 8, { r: 2, fill: C.ink4, op: 0.5 });
      /* 优化 */
      s += G.rect(rx + 136, oy - 8, 90, 8, { r: 2, fill: '#f1f1ee' });
      s += G.rect(rx + 136, oy - 8, optSim.s[i] * 90, 8, { r: 2, fill: C.jade, op: 0.9 });
    }
    s += G.txt(rx + 38, 370, '灰=现状', { size: 8, fill: C.ink4 });
    s += G.txt(rx + 136, 370, '绿=优化', { size: 8, fill: C.jadeD });
    s += footBox(rx, 256, 386, 62, '闭环',
      ['把优化方案下到现场 → 观察吸水剖面变化 → 更新代理模型 → 再优化。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '进化代数', v: ga.curve.length + ' 代' },
        { k: '最优总注水', v: f(best.T, 0) + ' m³/d', tone: 'ok' },
        { k: '日产油', v: f(optSim.oil, 1) + ' t/d', tone: 'ok' },
        { k: '综合含水', v: f(optSim.wc, 1) + '%' }
      ],
      note: '<b>这一步把前面的活儿串起来了：</b>连通分析告诉算法「水该往哪个方向走」，分层物理告诉它「设定和结果之间隔着渗透率」，代理模型让「快速搜索」成为可能，遗传算法在约束内找到最优配注。<b>整个过程没有一步是人工试出来的——但每一步的物理依据都还在，这就是智能化对石油专业场景的赋能方式。</b>'
    };
  }

  global.WfFlow = {
    stage1: stage1, stage2: stage2, stage3: stage3,
    stage4: stage4, stage5: stage5, stage6: stage6, compute: compute
  };
})(typeof window !== 'undefined' ? window : this);
