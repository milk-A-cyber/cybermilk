/* =========================================================
   智能完井滑套控制策略 · 模型层 + 浏览器接线
   ---------------------------------------------------------
   纯前端真计算：用强化学习在储层模拟器上学习滑套控制策略，
   最大化累计产量并抑制含水上升。

   Model（模型层）：genReservoir / rlTrain / slideEval
   浏览器接线：window.RemoteBridge = { M, genReservoir, rlTrain,
       slideEval, live, render }
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------- 工具 ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---------- 模型层 ---------- */
  var NSEG = 5;          /* 分段数 */
  var NS = 4;            /* 含水档位数 */
  var OIL = 40;          /* 产油系数 */
  var WAT = 30;          /* 产水系数 */

  /* 合成储层：分段渗透率 + 初始含水 */
  function genReservoir(nseg, seed) {
    nseg = nseg || NSEG; seed = seed || 20261104;
    var rnd = mulberry32(seed);
    var k = new Float64Array(nseg);   /* 渗透率 0-1 */
    var sw0 = new Float64Array(nseg); /* 初始含水 0-1 */
    for (var i = 0; i < nseg; i++) {
      k[i] = 0.3 + rnd() * 0.7;
      sw0[i] = 0.15 + rnd() * 0.45;
    }
    return { nseg: nseg, k: k, sw0: sw0, seed: seed };
  }

  /* 段 i 状态档位 */
  function swBand(sw) { return Math.min(NS - 1, Math.floor(sw * NS)); }

  /* Q-learning 训练：逐段独立 Q 表，ε-greedy 更新 */
  function rlTrain(env, rounds, lambda, seed) {
    rounds = rounds || 3000; lambda = lambda || 1;
    seed = seed || 20261144;
    var rnd = mulberry32(seed);
    var n = env.nseg;
    /* Q[段][档][0开/1关] */
    var Q = [];
    for (var i = 0; i < n; i++) {
      var row = [];
      for (var s = 0; s < NS; s++) row.push([0, 0]);
      Q.push(row);
    }
    var hist = [];       /* 每轮累计奖励 */
    var eps0 = 0.9, epsMin = 0.05;
    var lr = 0.2, gamma = 0.9;
    var sw = new Float64Array(n);
    var step = 1;
    for (var r = 0; r < rounds; r++) {
      for (var i2 = 0; i2 < n; i2++) sw[i2] = env.sw0[i2];
      var eps = Math.max(epsMin, eps0 * (1 - r / rounds));
      var total = 0;
      for (var t = 0; t < 20; t++) {
        for (var seg = 0; seg < n; seg++) {
          var sBand = swBand(sw[seg]);
          var a;
          if (rnd() < eps) a = Math.floor(rnd() * 2);
          else a = Q[seg][sBand][0] >= Q[seg][sBand][1] ? 0 : 1;
          var rw = a === 0 ? (OIL * env.k[seg] - lambda * WAT * sw[seg]) : -0.1;
          var sNext = swBand(clamp(sw[seg] + (a === 0 ? 0.03 : -0.01), 0, 1));
          Q[seg][sBand][a] += lr * (rw + gamma * Math.max(Q[seg][sNext][0], Q[seg][sNext][1]) - Q[seg][sBand][a]);
          sw[seg] = clamp(sw[seg] + (a === 0 ? 0.03 : -0.01), 0, 1);
          total += rw;
        }
      }
      hist.push(total);
      step++;
    }
    return { Q: Q, hist: hist, lambda: lambda, rounds: rounds };
  }

  /* 策略评估：从初始 Sw 跑 T 步，RL 策略 vs 全开 */
  function slideEval(env, policy, steps) {
    steps = steps || 20;
    var n = env.nseg;
    var swRL = new Float64Array(n);
    var swOpen = new Float64Array(n);
    for (var i = 0; i < n; i++) { swRL[i] = env.sw0[i]; swOpen[i] = env.sw0[i]; }
    var oilRL = 0, watRL = 0, oilOpen = 0, watOpen = 0;
    for (var t = 0; t < steps; t++) {
      for (var seg = 0; seg < n; seg++) {
        /* RL 策略 */
        var sBand = swBand(swRL[seg]);
        var aRL = policy.Q[seg][sBand][0] >= policy.Q[seg][sBand][1] ? 0 : 1;
        if (aRL === 0) { oilRL += OIL * env.k[seg]; watRL += WAT * swRL[seg]; swRL[seg] = clamp(swRL[seg] + 0.03, 0, 1); }
        else swRL[seg] = clamp(swRL[seg] - 0.01, 0, 1);
        /* 全开策略 */
        oilOpen += OIL * env.k[seg]; watOpen += WAT * swOpen[seg];
        swOpen[seg] = clamp(swOpen[seg] + 0.03, 0, 1);
      }
    }
    var swRLFinal = 0, swOpenFinal = 0;
    for (var j = 0; j < n; j++) { swRLFinal += swRL[j]; swOpenFinal += swOpen[j]; }
    swRLFinal /= n; swOpenFinal /= n;
    return {
      steps: steps,
      oilRL: oilRL, watRL: watRL,
      oilOpen: oilOpen, watOpen: watOpen,
      swRL: swRLFinal, swOpen: swOpenFinal,
      policy: policy
    };
  }

  var M = { genReservoir: genReservoir, rlTrain: rlTrain, slideEval: slideEval, NSEG: NSEG, NS: NS };

  /* ---------- 浏览器接线 ---------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = M;
    return;
  }

  var env = M.genReservoir(NSEG, 20261104);
  var state = { lambda: 1.0, swBias: 0 };
  var trained = M.rlTrain(env, 3000, state.lambda, 20261144);
  var evalRes = M.slideEval(env, trained, 20);

  function live() { return { lambda: state.lambda, swBias: state.swBias }; }

  function get(id) { return document.getElementById(id); }
  function html(el, s) { el.innerHTML = s; }
  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }

  function widthOf() {
    var c = get('resChart');
    return c ? Math.max(240, c.clientWidth || 360) : 360;
  }

  function renderAll() {
    var W = widthOf(), H = 200, P = 26;
    var x0 = 30, y0 = 30, xw = W - P - 30, h = H - P - 20;
    /* 用 state.lambda 重训练 */
    trained = M.rlTrain(env, 3000, state.lambda, 20261144);
    evalRes = M.slideEval(env, trained, 20);

    /* 屏1 储层分段 */
    var c1 = '';
    c1 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c1 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c1 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">储层分段 · 渗透率 × 含水</text>';
    var segW = (xw - 30) / env.nseg;
    for (var i = 0; i < env.nseg; i++) {
      var sx = x0 + i * segW;
      var kH = env.k[i] * (h - 30);
      c1 += '<rect x="' + sx.toFixed(1) + '" y="' + (y0 + h - kH) + '" width="' + (segW - 4).toFixed(1) + '" height="' + kH.toFixed(1) + '" fill="#41699b" opacity="0.7"/>';
      c1 += '<rect x="' + sx.toFixed(1) + '" y="' + (y0 + h - kH) + '" width="' + (segW - 4).toFixed(1) + '" height="' + (kH * (0.2 + env.sw0[i])).toFixed(1) + '" fill="#b05a51" opacity="0.5"/>';
      c1 += '<text x="' + (sx + segW / 2) + '" y="' + (y0 + h + 12) + '" font-size="8" fill="#6b7680" text-anchor="middle">段' + (i + 1) + '</text>';
    }
    c1 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 10) + '" font-size="8" fill="#41699b" text-anchor="end">高=渗透率</text>';
    c1 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 24) + '" font-size="8" fill="#b05a51" text-anchor="end">红=含水</text>';
    c1 += '</svg>';
    html(get('resChart'), c1);
    html(get('roSeg'), env.nseg + ' 段');

    /* 屏2 RL 训练收敛 */
    var c2 = '';
    c2 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c2 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c2 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">Q-learning · 奖励随回合收敛</text>';
    var N = trained.hist.length;
    var win = 200;
    var sm = [];
    for (var i2 = 0; i2 < N; i2++) {
      var s0 = 0, cnt = 0;
      for (var w = Math.max(0, i2 - win); w <= i2; w++) { s0 += trained.hist[w]; cnt++; }
      sm.push(s0 / cnt);
    }
    var hMin = Math.min.apply(null, trained.hist), hMax = Math.max.apply(null, trained.hist);
    var smMin = Math.min.apply(null, sm), smMax = Math.max.apply(null, sm);
    var lo = Math.min(hMin, smMin), hi = Math.max(hMax, smMax);
    var span = (hi - lo) || 1;
    for (var gi = 0; gi <= 4; gi++) {
      var gy = y0 + gi * h / 4;
      c2 += '<line x1="' + x0 + '" y1="' + gy + '" x2="' + (x0 + xw) + '" y2="' + gy + '" stroke="#eef0f1" stroke-width="1"/>';
    }
    var rpath = 'M';
    for (var ri = 0; ri < N; ri++) {
      rpath += (x0 + ri * xw / (N - 1)).toFixed(1) + ' ' + (y0 + h - (trained.hist[ri] - lo) / span * h).toFixed(1);
      if (ri < N - 1) rpath += ' L';
    }
    c2 += '<path d="' + rpath + '" fill="none" stroke="#c9d4df" stroke-width="1" opacity="0.6"/>';
    var spath = 'M';
    for (var si = 0; si < N; si++) {
      spath += (x0 + si * xw / (N - 1)).toFixed(1) + ' ' + (y0 + h - (sm[si] - lo) / span * h).toFixed(1);
      if (si < N - 1) spath += ' L';
    }
    c2 += '<path d="' + spath + '" fill="none" stroke="#2f7d6b" stroke-width="2"/>';
    c2 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 10) + '" font-size="8" fill="#2f7d6b" text-anchor="end">平滑奖励</text>';
    c2 += '</svg>';
    html(get('rlChart'), c2);
    html(get('roRounds'), trained.rounds + ' 回合');
    html(get('roFinalQ'), f(trained.hist[trained.hist.length - 1]));

    /* 屏3 策略评估：RL vs 全开 */
    var c3 = '';
    c3 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c3 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c3 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">策略评估 · RL vs 全开</text>';
    /* 累计产油条形 */
    var bars = [
      ['RL 产油', evalRes.oilRL, '#2f7d6b'],
      ['全开产油', evalRes.oilOpen, '#9aa2a8'],
      ['RL 产水', evalRes.watRL, '#7fb3a0'],
      ['全开产水', evalRes.watOpen, '#b05a51']
    ];
    var maxV = Math.max(evalRes.oilOpen, evalRes.watOpen) * 1.1;
    for (var b = 0; b < bars.length; b++) {
      var by = y0 + b * 34;
      var bw = bars[b][1] / maxV * (xw - 60);
      c3 += '<text x="' + x0 + '" y="' + (by + 12) + '" font-size="8.5" fill="#242b2e">' + bars[b][0] + '</text>';
      c3 += '<rect x="' + (x0 + 78) + '" y="' + (by + 3) + '" width="' + bw.toFixed(1) + '" height="13" fill="' + bars[b][2] + '" opacity="0.85" rx="2"/>';
      c3 += '<text x="' + (x0 + 82 + bw) + '" y="' + (by + 14) + '" font-size="8" fill="#6b7680">' + f(bars[b][1], 1) + '</text>';
    }
    /* 含水上升对比 */
    c3 += '<text x="' + x0 + '" y="' + (y0 + 152) + '" font-size="8.5" fill="#242b2e">含水上升  RL=' + f(evalRes.swRL) + ' 全开=' + f(evalRes.swOpen) + '</text>';
    c3 += '</svg>';
    html(get('evalChart'), c3);
    html(get('roOilRL'), f(evalRes.oilRL, 1));
    html(get('roOilOpen'), f(evalRes.oilOpen, 1));
    html(get('roWaterRL'), f(evalRes.swRL));
    html(get('roWaterOpen'), f(evalRes.swOpen));
  }

  function wire() {
    var inL = get('inLambda');
    if (inL) inL.addEventListener('input', function () {
      state.lambda = parseFloat(inL.value);
      html(get('outLambda'), f(state.lambda));
      renderAll();
    });
  }

  function init() {
    wire();
    html(get('outLambda'), f(state.lambda));
    renderAll();
  }

  global.RemoteBridge = { M: M, genReservoir: genReservoir, rlTrain: rlTrain, slideEval: slideEval, live: live, render: renderAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(typeof window !== 'undefined' ? window : global);
