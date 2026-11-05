/* =========================================================
   智能完井滑套控制策略 · 算法解剖（强化学习）
   ---------------------------------------------------------
   把「滑套控制」拆成 6 步，每一步都跑真代码：

     ① 储层分段  渗透率/含水
     ② 滑套动作  开/关
     ③ 储层模拟器  机理模型
     ④ 强化学习  Q-learning
     ⑤ 策略学习  抑制含水
     ⑥ 策略评估  RL vs 全开

   依赖：window.RemoteBridge（demo.js 暴露的真模型）
        window.AFlow（算法解剖引擎）
   ========================================================= */
(function (global) {
  'use strict';

  var B = global.RemoteBridge;
  if (!B || !global.AFlow) return;

  var G = global.AFlow.G, C = global.AFlow.C;
  var M = B.M;

  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }

  var C0 = '#41699b', C1 = '#b26a39', C2 = '#2f7d6b', CR = '#b05a51';

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

  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = String(L.lambda);
    if (cache.key === key) return cache;
    var env = B.M.genReservoir(M.NSEG, 20261104);
    var trained = B.rlTrain(env, 3000, L.lambda, 20261144);
    var ev = B.slideEval(env, trained, 20);
    cache = { key: key, env: env, trained: trained, ev: ev };
    return cache;
  }

  /* =========================================================
     ① 储层分段
     ========================================================= */
  function stage1(t) {
    var c = compute(), env = c.env;
    var s = '';
    s += G.panel(0, '① 分段', env.nseg + ' 段', C.blue);
    s += G.panel(1, '② 渗透率', '0-1', C.clay);
    s += G.panel(2, '③ 含水', 'Sw', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '储层分段 · 渗透率 × 含水', { size: 9.5, fill: C.ink2, weight: 700 });
    var segW = 220 / env.nseg;
    for (var i = 0; i < env.nseg; i++) {
      var kH = env.k[i] * 80;
      s += G.rect(x0 + i * segW, y0 + h - kH, segW - 4, kH, { r: 2, fill: C.blueD, opacity: 0.7, stroke: 'none' });
      s += G.txt(x0 + i * segW + segW / 2, y0 + h + 16, '段' + (i + 1), { size: 8, fill: C.ink3, anchor: 'middle' });
    }

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '为什么难',
      ['· 分段含水不同',
       '  → 统一开阀低效',
       '· 真实验证贵',
       '  → 周期长',
       '',
       '需储层模拟器',
       '+ 强化学习。'], 'clay');
    return { svg: s, stats: [{ k: '分段', v: env.nseg + ' 段' }, { k: '储层', v: '渗透率×含水' }], note: '智能完井把井筒分成多段，每段配滑套。多段储层渗透率与含水饱和度不同，统一开阀低效。' };
  }

  /* =========================================================
     ② 滑套动作
     ========================================================= */
  function stage2(t) {
    var s = '';
    s += G.panel(0, '① 开', '产液', C.blue);
    s += G.panel(1, '② 关', '抑水', C.clay);
    s += G.panel(2, '③ 遥控', '井下', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '滑套动作 · 开/关', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + 12, '智能滑套可遥控开关', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 34, '开 → 该段产液贡献', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 56, '关 → 抑制高含水段', { size: 8.8, fill: C.jadeD });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '动作的坑',
      ['· 段多动作组合',
       '  → 2^5=32',
       '· 含水动态',
       '  → 需实时决策',
       '',
       'RL 学策略。'], 'jade');
    return { svg: s, stats: [{ k: '动作', v: '开/关' }, { k: '组合', v: '2^5=32' }], note: '智能滑套通过井下控制实现各段产液调节，动作即各段滑套的开/关。' };
  }

  /* =========================================================
     ③ 储层模拟器
     ========================================================= */
  function stage3(t) {
    var s = '';
    s += G.panel(0, '① 机理', '储层', C.blue);
    s += G.panel(1, '② 状态', '含水', C.clay);
    s += G.panel(2, '③ 转移', '开/关', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '储层模拟器 · 机理模型', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + 12, '状态 = 各段含水饱和度', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 34, '开段 → 含水上升', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 56, '关段 → 含水缓降', { size: 8.8, fill: C.jadeD });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '模拟器的坑',
      ['· 需要可靠环境',
       '  → 策略学习',
       '· 真实验证贵',
       '  → 周期长',
       '',
       '模拟器先行。'], 'jade');
    return { svg: s, stats: [{ k: '状态', v: '含水' }, { k: '环境', v: '储层模拟器' }], note: '用可靠的储层模拟器（机理模型）作为策略学习环境，策略在真实井上验证成本高周期长。' };
  }

  /* =========================================================
     ④ 强化学习
     ========================================================= */
  function stage4(t) {
    var c = compute(), trained = c.trained;
    var s = '';
    s += G.panel(0, '① Q表', '段×档×动作', C.blue);
    s += G.panel(1, '② ε-greedy', '探索', C.clay);
    s += G.panel(2, '③ 回合', trained.rounds, C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, 'Q-learning · 奖励收敛', { size: 9.5, fill: C.ink2, weight: 700 });
    var N = trained.hist.length, win = 200;
    var sm = [];
    for (var i2 = 0; i2 < N; i2++) {
      var s0 = 0, cnt = 0;
      for (var w = Math.max(0, i2 - win); w <= i2; w++) { s0 += trained.hist[w]; cnt++; }
      sm.push(s0 / cnt);
    }
    var lo = Math.min(Math.min.apply(null, trained.hist), Math.min.apply(null, sm));
    var hi = Math.max(Math.max.apply(null, trained.hist), Math.max.apply(null, sm));
    var span = (hi - lo) || 1;
    var spath = 'M';
    for (var si = 0; si < N; si++) {
      spath += (x0 + si * xw / (N - 1)).toFixed(1) + ' ' + (y0 + h - (sm[si] - lo) / span * h).toFixed(1);
      if (si < N - 1) spath += ' L';
    }
    s += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    s += '<path d="' + spath + '" fill="none" stroke="' + C2 + '" stroke-width="2"/>';
    s += G.txt(x0, y0 + h + 20, '平滑奖励随回合上升', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, 'RL 的坑',
      ['· 状态连续',
       '  → 离散化',
       '· 探索-利用',
       '  → ε-greedy',
       '',
       'Q 表逐段',
       '学习最优。'], 'jade');
    return { svg: s, stats: [{ k: '回合', v: trained.rounds }, { k: 'Q表', v: M.NSEG + '×' + M.NS + '×2' }], note: '用 Q-learning 学习滑套控制策略：状态=各段含水档，动作=开/关，奖励=产油收益-含水惩罚。' };
  }

  /* =========================================================
     ⑤ 策略学习
     ========================================================= */
  function stage5(t) {
    var c = compute(), trained = c.trained;
    var s = '';
    s += G.panel(0, '① 含水高', '关', C.blue);
    s += G.panel(1, '② 渗透高', '开', C.clay);
    s += G.panel(2, '③ 权衡', 'λ', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '策略学习 · 每段开/关', { size: 9.5, fill: C.ink2, weight: 700 });
    var rows = [
      ['高渗透低含水', '→ 开'],
      ['低渗透高含水', '→ 关'],
      ['含水惩罚 λ', '权衡']
    ];
    for (var i = 0; i < rows.length; i++) {
      var ry = y0 + i * 30;
      s += G.rect(x0, ry, 240, 24, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(x0 + 12, ry + 17, rows[i][0], { size: 8.6, fill: C.ink2 });
      s += G.txt(x0 + 200, ry + 17, rows[i][1], { size: 8.6, fill: C.jadeD, weight: 700 });
    }

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '策略的坑',
      ['· 只开高渗段',
       '  → 含水高',
       '· 只关高水段',
       '  → 减产',
       '',
       'Q 值权衡',
       '抑制含水。'], 'jade');
    return { svg: s, stats: [{ k: '策略', v: 'Q贪心' }, { k: '目标', v: '产油↑含水↓' }], note: '策略学习结果：含水高渗透低的段关闭，渗透高含水低的段开启，最大化累计产量并抑制含水上升。' };
  }

  /* =========================================================
     ⑥ 策略评估
     ========================================================= */
  function stage6(t) {
    var c = compute(), ev = c.ev;
    var s = '';
    s += G.panel(0, '① RL产油', f(ev.oilRL, 1), C.blue);
    s += G.panel(1, '② 全开产油', f(ev.oilOpen, 1), C.clay);
    s += G.panel(2, '③ 含水', 'RL↓', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '策略评估 · RL vs 全开', { size: 9.5, fill: C.ink2, weight: 700 });
    var maxV = Math.max(ev.oilOpen, ev.watOpen) * 1.15;
    var bars = [
      ['RL 产油', ev.oilRL, C2],
      ['全开产油', ev.oilOpen, '#9aa2a8'],
      ['RL 产水', ev.watRL, '#7fb3a0'],
      ['全开产水', ev.watOpen, CR]
    ];
    for (var b = 0; b < bars.length; b++) {
      var bw = bars[b][1] / maxV * 190;
      s += G.txt(x0, y0 + b * 26 + 6, bars[b][0], { size: 8.4, fill: C.ink2 });
      s += G.rect(x0 + 64, y0 + b * 26, bw, 14, { r: 2, fill: bars[b][2], opacity: 0.85, stroke: 'none' });
      s += G.txt(x0 + 68 + bw, y0 + b * 26 + 12, f(bars[b][1], 1), { size: 7.8, fill: C.ink3 });
    }
    s += G.txt(x0, y0 + 122, '含水上升 RL=' + f(ev.swRL) + ' 全开=' + f(ev.swOpen), { size: 8.5, fill: C.jadeD, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '评估的坑',
      ['· 全开产油高',
       '  → 含水失控',
       '· RL 减产一点',
       '  → 含水大降',
       '',
       '累计产量',
       '+ 抑制含水。'], 'jade');
    return { svg: s, stats: [{ k: 'RL产油', v: f(ev.oilRL, 1) }, { k: '全开产油', v: f(ev.oilOpen, 1) }, { k: '含水', v: 'RL↓' }], note: '策略评估：RL 策略牺牲少量产油换取含水大幅下降，最大化累计产量并抑制含水上升。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
