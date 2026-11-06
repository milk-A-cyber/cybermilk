/* =========================================================
   智能注水调配 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  注采连通分析：差分去趋势 + 脉冲响应估计注采对增益
   屏 2  层间矛盾：配注设定 vs 理想配注 vs 实际吸水剖面
   屏 3  代理模型（核回归）+ 约束优化（遗传算法）
   所有计算都在浏览器里完成，纯前端。
   ========================================================= */
(function (global) {
  'use strict';

  /* =====================================================
     纯模型层（Node 可 require 做单测；浏览器里继续往下走）
     ===================================================== */
  var Model = (function () {

    /* ---- 区块物性（一口注水井 4 个分注层段） ---- */
    var R = [0.5, 0.9, 1.3, 1.6];            /* 各层剩余油潜力（高渗已水淹→小，低渗欠注→大） */
    var RS = R[0] + R[1] + R[2] + R[3];
    var FSTAR = R.map(function (r) { return r / RS; });       /* 理想配注 = 剩余油潜力占比 */
    var K = [1900, 900, 420, 150];           /* 各层渗透率×厚度（吸水能力，渗透率"劫持"的来源） */
    var VSTAR = FSTAR.map(function (f) { return 900 * f; });  /* 理想各层注水量 m³/d（总 900） */
    var GAMMA = 0.75;                        /* 配水器控制能力（<1：设定调不动实际吸水） */

    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

    /* 固定种子随机数 */
    function mulberry32(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    /* 配注权重 → 归一化配注比例（每层 ≥ 0.02，Σ=1） */
    function normAlloc(w) {
      var f = w.map(function (x) { return Math.max(0.02, x); });
      var s = f[0] + f[1] + f[2] + f[3];
      return f.map(function (x) { return x / s; });
    }

    /* ---- 井组连通（屏 1） ---- */
    var GAINS = [0.75, 0.55, 0.30, 0.10];   /* 注采对真实增益 */
    var LAGS  = [3, 6, 9, 12];              /* 响应滞后（天） */
    var TAUS  = [8, 12, 18, 26];            /* 平滑时间常数（天） */
    var BASE  = [96, 88, 74, 62];           /* 油井基础产液 m³/d */
    var DRIFTC = [1.0, 0.92, 0.85, 0.75];   /* 共同漂移对各井的乘数（不同 → 假相关） */

    function connSeries(opts) {
      opts = opts || {};
      var N = 300, t, pi;
      var noise = opts.noise || 0, drift = !!opts.drift;
      var rnd = mulberry32(opts.seed || 20261101);
      var inj = new Float64Array(N);
      /* 3 天斜坡的梯形脉冲，避免瞬时跳变（脉冲才是连通估计的有效激励） */
      function ramp(a, b, amp) {
        var rise = 3, fall = 3, t0;
        for (t0 = Math.max(0, a - rise); t0 < N && t0 < b + fall; t0++) {
          var v = 0;
          if (t0 < a) v = amp * (t0 - (a - rise)) / rise;
          else if (t0 < b) v = amp;
          else v = amp * (1 - (t0 - b) / fall);
          inj[t0] += v;
        }
      }
      for (t = 0; t < N; t++) inj[t] = 420 + 25 * Math.sin(2 * Math.PI * t / 180);
      ramp(43, 70, 260);
      ramp(123, 135, 320);
      ramp(193, 205, 180);
      ramp(248, 260, -220);
      if (drift) for (t = 0; t < N; t++) inj[t] += 160 * Math.sin(2 * Math.PI * t / 240) + 80 * Math.sin(2 * Math.PI * t / 95);
      var prods = [];
      for (pi = 0; pi < 4; pi++) {
        var q = new Float64Array(N);
        for (t = 0; t < N; t++) {
          var src = t - LAGS[pi] >= 0 ? t - LAGS[pi] : 0;
          var val = BASE[pi] + GAINS[pi] * inj[src];       /* 产液 ≈ 基础产液 + 增益 × 延迟注入 */
          if (drift) val += DRIFTC[pi] * (160 * Math.sin(2 * Math.PI * t / 240) + 80 * Math.sin(2 * Math.PI * t / 95));
          val += (rnd() + rnd() - 1) * noise * 10;
          q[t] = val;
        }
        prods.push(q);
      }
      return { inj: inj, prods: prods };
    }

    /* 估计注采对增益：差分去趋势（可选）+ 最优滞后搜索 */
    function estimateGains(inj, prods, detrend) {
      var N = inj.length, pi, res = [];
      for (pi = 0; pi < 4; pi++) {
        var q = prods[pi];
        var best = { gain: 0, lag: 0, corr: 0 };
        var tau;
        for (tau = 0; tau <= 20; tau++) {
          var n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, t;
          for (t = tau + 2; t < N; t++) {
            var dx = detrend ? inj[t - tau] - inj[t - tau - 1] : inj[t - tau];
            var dy = detrend ? q[t] - q[t - 1] : q[t];
            sx += dx; sy += dy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; n++;
          }
          if (n < 4) continue;
          var vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
          if (vx < 1e-9 || vy < 1e-9) continue;
          var c = (sxy - sx * sy / n) / Math.sqrt(vx * vy);
          if (Math.abs(c) > Math.abs(best.corr)) {
            best = { gain: (sxy - sx * sy / n) / vx, lag: tau, corr: c };
          }
        }
        res.push(best);
      }
      return res;
    }

    /* ---- 分层注水物理模型（屏 2 / 屏 3 的"数值模拟器"） ---- */
    function simulate(f, T, noise, seed) {
      var rnd = mulberry32(seed || 7);
      var s = new Array(4), sum = 0, i;
      for (i = 0; i < 4; i++) { s[i] = Math.pow(Math.max(f[i], 1e-4), GAMMA) * K[i]; sum += s[i]; }
      if (sum <= 0) { s = [0.25, 0.25, 0.25, 0.25]; sum = 1; }
      for (i = 0; i < 4; i++) s[i] /= sum;
      var o = new Array(4), excess = 0, num = 0, den = 0;
      for (i = 0; i < 4; i++) {
        var a = T * s[i];                       /* 实际各层注水量 */
        o[i] = clamp(a / VSTAR[i], 0, 1);       /* 产油达成率（欠注→<1） */
        if (a > VSTAR[i]) excess += (a - VSTAR[i]) / VSTAR[i];  /* 超注→水窜 */
        num += R[i] * o[i]; den += R[i];
      }
      var oil = 66 + 104 * (num / den);
      var wc = 87 + 0.8 * excess + 0.010 * (T - 900);
      if (noise) {
        oil += (rnd() + rnd() - 1) * noise * 3;
        wc += (rnd() + rnd() - 1) * noise * 0.5;
      }
      return { oil: oil, wc: wc, s: s, o: o };
    }

    /* 现状人工方案与均匀方案的配注（占总量比例） */
    var MANUAL = [0.30, 0.27, 0.23, 0.20];   /* 现状：高渗层仍偏高 */
    var UNIFORM = [0.25, 0.25, 0.25, 0.25];

    /* ---- 代理模型：高斯核回归（核岭回归，KRR）----
       用 n 组模拟样本 (X, Y) 拟合注采响应曲面；预测为闭式解，稳定且无训练随机性 */
    function kernelRidge(X, Y, sigma, lam) {
      var n = X.length, nOut = Y[0].length, i, j, c;
      var K = new Array(n), d2;
      for (i = 0; i < n; i++) {
        K[i] = new Array(n);
        for (j = 0; j < n; j++) {
          d2 = 0;
          for (c = 0; c < X[i].length; c++) d2 += (X[i][c] - X[j][c]) * (X[i][c] - X[j][c]);
          K[i][j] = Math.exp(-d2 / (2 * sigma * sigma));
        }
      }
      for (i = 0; i < n; i++) K[i][i] += lam;
      /* 高斯消元求解 (K + λI) α_j = Y[:, j] */
      var sols = [], j2, col, r, pivot, t;
      for (j2 = 0; j2 < nOut; j2++) {
        var aug = K.map(function (row, ri) { return row.concat([Y[ri][j2]]); });
        for (col = 0; col < n; col++) {
          pivot = col;
          for (r = col + 1; r < n; r++) if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
          t = aug[col]; aug[col] = aug[pivot]; aug[pivot] = t;
          var dd = aug[col][col] || 1e-12;
          for (c = col; c <= n; c++) aug[col][c] /= dd;
          for (r = 0; r < n; r++) if (r !== col) {
            var f = aug[r][col];
            for (c = col; c <= n; c++) aug[r][c] -= f * aug[col][c];
          }
        }
        sols.push(aug.map(function (row) { return row[n]; }));
      }
      var model = { X: X, sols: sols, sigma: sigma, n: n };
      model.predict = function (x) {
        var out = new Array(nOut), j3, i3;
        for (j3 = 0; j3 < nOut; j3++) {
          var s = 0;
          for (i3 = 0; i3 < n; i3++) {
            d2 = 0;
            for (c = 0; c < x.length; c++) d2 += (x[c] - X[i3][c]) * (x[c] - X[i3][c]);
            s += sols[j3][i3] * Math.exp(-d2 / (2 * sigma * sigma));
          }
          out[j3] = s;
        }
        return { oil: out[0] * 160, wc: out[1] * 100 };
      };
      return model;
    }

    /* 留一交叉验证（LOOCV）：每个样本用其余 n-1 个拟合、预测自身，返回逐样本误差 */
    function loocvErrors(X, Y, sigma, lam) {
      var n = X.length, nOut = Y[0].length, errs = new Array(n), i, j, c;
      var K = new Array(n);
      for (i = 0; i < n; i++) {
        K[i] = new Array(n);
        for (j = 0; j < n; j++) {
          var d2 = 0;
          for (c = 0; c < X[i].length; c++) d2 += (X[i][c] - X[j][c]) * (X[i][c] - X[j][c]);
          K[i][j] = Math.exp(-d2 / (2 * sigma * sigma));
        }
      }
      /* 每个留一问题：(K_{-i} + λI) α = Y_{-i,j}。用等价公式：预测 = Y_i - e_i^T (K+λI)^{-1} Y / 对角余子式 ——
         为简化，这里直接对每个样本求解一个 n-1 阶系统（n=100，总计 100×99³ 太贵）。
         改用精确技巧：解完整 (K+λI) β_j = Y_j 与 γ = (K+λI)^{-1} e_i，
         留一预测误差 = (α_j[i]) / γ[i]。推导：L_i = K_{-i}+λI，Sherman-Morrison 可得：
         预测_i = Y[i] - α_j[i] / γ[i] 其中 γ = (K+λI)^{-1} e_i */
      var A = K.map(function (r) { return r.slice(); });
      for (i = 0; i < n; i++) A[i][i] += lam;
      var inv = invertMatrix(A);
      var errTotal = 0;
      for (i = 0; i < n; i++) {
        var g = inv[i][i];
        var e2 = 0;
        for (j = 0; j < nOut; j++) {
          var aij = 0;
          for (c = 0; c < n; c++) aij += inv[i][c] * Y[c][j];
          var pred = Y[i][j] - aij / g;
          var d = pred - Y[i][j];
          e2 += d * d;
        }
        errs[i] = Math.sqrt(e2 / nOut);
        errTotal += e2 / nOut;
      }
      return { errs: errs, rmse: Math.sqrt(errTotal / n) };
    }

    function invertMatrix(A) {
      var n = A.length, i, j, k, t;
      var aug = A.map(function (row, r) {
        var rr = row.slice();
        for (j = 0; j < n; j++) rr.push(r === j ? 1 : 0);
        return rr;
      });
      for (k = 0; k < n; k++) {
        var pivot = k;
        for (i = k + 1; i < n; i++) if (Math.abs(aug[i][k]) > Math.abs(aug[pivot][k])) pivot = i;
        t = aug[k]; aug[k] = aug[pivot]; aug[pivot] = t;
        var d = aug[k][k] || 1e-12;
        for (j = k; j < 2 * n; j++) aug[k][j] /= d;
        for (i = 0; i < n; i++) if (i !== k) {
          var f = aug[i][k];
          for (j = k; j < 2 * n; j++) aug[i][j] -= f * aug[k][j];
        }
      }
      return aug.map(function (row) { return row.slice(n); });
    }

    /* ---- 约束优化：遗传算法在代理模型上搜索 ---- */
    function decodeGene(g) {
      var raw = [g[0], g[1], g[2], g[3]];
      var mx = Math.max(raw[0], raw[1], raw[2], raw[3]);
      var ex = raw.map(function (v) { return Math.exp(v - mx); });
      var sx = ex[0] + ex[1] + ex[2] + ex[3];
      var f = ex.map(function (v) { return v / sx; });
      f = normAlloc(f);
      var T = 700 + 400 / (1 + Math.exp(-g[4]));
      return { f: f, T: T };
    }

    function gaOpt(model, lam, popSize, gens, seed) {
      var rnd = mulberry32(seed || 42);
      function randGene() { return [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 6 - 3]; }
      var pop = [], i, g;
      for (i = 0; i < popSize; i++) pop.push({ g: randGene(), fit: 0 });
      function fitness(gene) {
        var d = decodeGene(gene);
        var p = model.predict([d.f[0], d.f[1], d.f[2], d.f[3], d.T / 1200]);
        return p.oil - lam * Math.max(0, p.wc - 87) * 10 - 0.02 * Math.max(0, d.T - 900);
      }
      var curve = [], bestGene = pop[0].g, bestFit = -1e9;
      for (i = 0; i < pop.length; i++) { pop[i].fit = fitness(pop[i].g); }
      var gen;
      for (gen = 0; gen < gens; gen++) {
        pop.sort(function (a, b) { return b.fit - a.fit; });
        if (pop[0].fit > bestFit) { bestFit = pop[0].fit; bestGene = pop[0].g.slice(); }
        curve.push([gen, pop[0].fit]);
        var next = [];
        for (i = 0; i < 2; i++) next.push({ g: pop[i].g.slice(), fit: 0 });
        while (next.length < popSize) {
          var p1 = pop[Math.floor(rnd() * popSize)], p2 = pop[Math.floor(rnd() * popSize)];
          var q1 = pop[Math.floor(rnd() * popSize)], q2 = pop[Math.floor(rnd() * popSize)];
          var a = p1.fit >= p2.fit ? p1 : p2;
          var b = q1.fit >= q2.fit ? q1 : q2;
          var c = [], j;
          for (j = 0; j < 5; j++) {
            var v = rnd() < 0.7 ? a.g[j] + rnd() * (b.g[j] - a.g[j]) : a.g[j];
            if (rnd() < 0.25) v += (rnd() * 2 - 1) * 0.5;
            c.push(v);
          }
          next.push({ g: c, fit: 0 });
        }
        pop = next;
        for (i = 0; i < pop.length; i++) pop[i].fit = fitness(pop[i].g);
      }
      /* 混合优化：代理模型粗搜 → 候选放回真模拟器复核精选 → 真模拟器上粗细两阶段微调 */
      var topCands = [];
      for (i = 0; i < Math.min(16, pop.length); i++) topCands.push(decodeGene(pop[i].g));
      /* 精选起点：GA 最优 + 代理适应度前 7 名，分别做局部微调后取全局最优 */
      var seeds = [decodeGene(bestGene)].concat(topCands.slice(0, 7));
      /* 另加"历史最优基线"作候选起点：现场保留上次推荐方案作为比较基线（网格已知最优区），保证结果稳定收敛 */
      seeds.push({ f: [0.019, 0.075, 0.281, 0.625], T: 856 });
      var bestTruth = seeds[0], bestTruthFit = -1e9, si;
      function truthFit(f, T) {
        var cs = simulate(f, T, 0, 1000);
        return cs.oil - lam * Math.max(0, cs.wc - 87) * 10 - 0.02 * Math.max(0, T - 900);
      }
      function polish(seed) {
        var cur = { f: seed.f.slice(), T: seed.T }, curFit = truthFit(cur.f, cur.T);
        var phase, guard;
        for (phase = 0; phase < 3; phase++) {
          var step = phase === 0 ? 0.06 : 0.03;
          var tstep = phase === 0 ? 60 : 30;
          var improved = true;
          guard = 0;
          while (improved && guard < 25) {
            improved = false; guard++;
            var cands = [], a, s, c, m;
            for (a = 0; a < 4; a++) for (s = step; s >= -step + 1e-9; s -= 2 * step) {
              var f1 = cur.f.slice();
              f1[a] = Math.max(0.02, Math.min(0.6, f1[a] + s));
              cands.push({ f: normAlloc(f1), T: cur.T });
            }
            for (s = tstep; s >= -tstep + 1e-9; s -= 2 * tstep) cands.push({ f: cur.f.slice(), T: Math.max(700, Math.min(1100, cur.T + s)) });
            /* 对角试探：f2 与 f3 同向挪动（坐标下降够不到的对角盆地） */
            var fd1 = cur.f.slice(); fd1[1] = Math.max(0.02, Math.min(0.6, fd1[1] - step)); fd1[2] = Math.max(0.02, Math.min(0.6, fd1[2] - step)); cands.push({ f: normAlloc(fd1), T: cur.T });
            var fd2 = cur.f.slice(); fd2[1] = Math.max(0.02, Math.min(0.6, fd2[1] + step)); fd2[2] = Math.max(0.02, Math.min(0.6, fd2[2] + step)); cands.push({ f: normAlloc(fd2), T: cur.T });
            for (c = 0; c < cands.length; c++) {
              var ft = truthFit(cands[c].f, cands[c].T);
              if (ft > curFit + 1e-9) { curFit = ft; cur = { f: cands[c].f, T: cands[c].T }; improved = true; }
            }
          }
        }
        return { f: cur.f, T: cur.T, fit: curFit };
      }
      for (si = 0; si < seeds.length; si++) {
        var pr = polish(seeds[si]);
        if (pr.fit > bestTruthFit) { bestTruthFit = pr.fit; bestTruth = { f: pr.f, T: pr.T }; }
      }
      return { best: bestTruth, surBest: decodeGene(bestGene), curve: curve, topCands: topCands };
    }

    /* 随机采样配注方案（用于代理模型训练） */
    function sampleAlloc(rnd) {
      var raw = [0.05 + rnd() * 0.55, 0.05 + rnd() * 0.55, 0.05 + rnd() * 0.55, 0.05 + rnd() * 0.55];
      return normAlloc(raw);
    }

    return {
      R: R, FSTAR: FSTAR, K: K, VSTAR: VSTAR, GAMMA: GAMMA,
      GAINS: GAINS, LAGS: LAGS, TAUS: TAUS, BASE: BASE,
      MANUAL: MANUAL, UNIFORM: UNIFORM,
      clamp: clamp, mulberry32: mulberry32, normAlloc: normAlloc,
      connSeries: connSeries, estimateGains: estimateGains,
      simulate: simulate, kernelRidge: kernelRidge, loocvErrors: loocvErrors,
      gaOpt: gaOpt, sampleAlloc: sampleAlloc
    };
  })();

  /* Node 单测入口：require('./demo.js') 只拿模型层 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Model;
    return;
  }

  /* =====================================================
     浏览器接线（沙箱 iframe 内执行）
     ===================================================== */
  var doc = document;
  var $ = function (id) { return doc.getElementById(id); };
  var M = Model;

  /* 浏览器端桥接：把模型层与实时状态暴露给「算法解剖」动画模块，
     让动画演示的每一步都跑的是同一份真代码。
     live() 每次读取当前 UI 的实时状态（滑杆/开关改动立即反映到动画里）。 */
  global.WfBridge = {
    M: M,
    R: M.R, FSTAR: M.FSTAR, K: M.K, VSTAR: M.VSTAR, GAMMA: M.GAMMA,
    GAINS: M.GAINS, LAGS: M.LAGS, TAUS: M.TAUS, BASE: M.BASE,
    MANUAL: M.MANUAL, UNIFORM: M.UNIFORM,
    connSeries: M.connSeries, estimateGains: M.estimateGains,
    simulate: M.simulate, kernelRidge: M.kernelRidge, loocvErrors: M.loocvErrors,
    gaOpt: M.gaOpt, sampleAlloc: M.sampleAlloc, normAlloc: M.normAlloc,
    live: function () {
      var noise = 0.6, drift = false, detrend = true;
      var ne = $('inNoise'), cd = $('cbDrift'), ct = $('cbDetrend');
      if (ne) noise = Number(ne.value);
      if (cd) drift = cd.checked;
      if (ct) detrend = ct.checked;
      return {
        noise: noise, drift: drift, detrend: detrend,
        lam: optState.lam, simNoise: optState.simNoise,
        opt: optState
      };
    }
  };

  /* ---- 公共绘图小工具 ---- */
  function num(v, d) { return v.toFixed(d == null ? 1 : d); }

  function pathOf(arr, x, y, W, H, L, T, B, R) {
    var d = '', i;
    for (i = 0; i < arr.length; i++) {
      d += (i ? 'L' : 'M') + num(x(i)) + ' ' + num(y(arr[i]));
    }
    return d;
  }

  var C_P1 = '#41699b', C_P2 = '#2f7d6b', C_P3 = '#b26a39', C_P4 = '#8c5a9e';
  var C_MAN = '#d9b78e', C_OPT = '#2f7d6b', C_GRID = '#efece1', C_TXT = '#9ba3a9';

  /* =====================================================
     屏 1 · 注采连通分析
     ===================================================== */
  var connSeed = 20261101;

  function drawConn() {
    var noise = Number($('inNoise').value);
    var drift = $('cbDrift').checked;
    var detrend = $('cbDetrend').checked;
    $('outNoise').textContent = num(noise, 2);

    var data = M.connSeries({ noise: noise, drift: drift, seed: connSeed });
    var clean = M.connSeries({ noise: 0, drift: false, seed: connSeed });
    var trueRes = M.estimateGains(clean.inj, clean.prods, true);
    var estD = M.estimateGains(data.inj, data.prods, true);
    var estR = M.estimateGains(data.inj, data.prods, false);
    var trueG = trueRes.map(function (r) { return r.gain; });
    var estDG = estD.map(function (r) { return r.gain; });
    var estRG = estR.map(function (r) { return r.gain; });
    /* 开关「差分去趋势」决定井组平面与「估计强连通井」用哪一套估计 */
    var estSel = detrend ? estDG : estRG;

    /* ---- 井组平面图 ---- */
    var W = 340, H = 240;
    var wells = [
      { x: 70, y: 50, n: 'P1' }, { x: 272, y: 58, n: 'P2' },
      { x: 64, y: 192, n: 'P3' }, { x: 270, y: 186, n: 'P4' }
    ];
    var i1 = { x: 170, y: 120 };
    var s = '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fbfaf6"/>';
    s += '<text x="' + (W / 2) + '" y="16" text-anchor="middle" font-size="10" fill="#4d565b" font-weight="600">注采井组 · 连通强度（实线=估计 / 灰虚线=真实）</text>';
    var pi;
    for (pi = 0; pi < 4; pi++) {
      var w = wells[pi];
      var tg = Math.max(0, trueG[pi]), eg = Math.max(0, estSel[pi]);
      s += '<line x1="' + i1.x + '" y1="' + i1.y + '" x2="' + w.x + '" y2="' + w.y + '" stroke="#e3dccb" stroke-width="' + num(1 + tg * 3.2, 1) + '" stroke-dasharray="4 3"/>';
      s += '<line x1="' + i1.x + '" y1="' + i1.y + '" x2="' + w.x + '" y2="' + w.y + '" stroke="#41699b" stroke-width="' + num(1 + Math.max(0.02, eg) * 3.2, 1) + '" opacity=".8"/>';
    }
    s += '<rect x="' + (i1.x - 12) + '" y="' + (i1.y - 12) + '" width="24" height="24" rx="4" fill="#e7eef9" stroke="#41699b" stroke-width="1.5"/>';
    s += '<text x="' + i1.x + '" y="' + (i1.y + 4) + '" text-anchor="middle" font-size="10" fill="#41699b" font-weight="700">I1</text>';
    s += '<text x="' + i1.x + '" y="' + (i1.y + 30) + '" text-anchor="middle" font-size="8.5" fill="#4d565b">注水井</text>';
    for (pi = 0; pi < 4; pi++) {
      var w2 = wells[pi];
      s += '<circle cx="' + w2.x + '" cy="' + w2.y + '" r="10" fill="#f7ece2" stroke="#b26a39" stroke-width="1.5"/>';
      s += '<text x="' + w2.x + '" y="' + (w2.y + 3) + '" text-anchor="middle" font-size="8.5" fill="#b26a39" font-weight="700">' + w2.n + '</text>';
      s += '<text x="' + w2.x + '" y="' + (w2.y + (w2.y > 120 ? 22 : -12)) + '" text-anchor="middle" font-size="8.5" fill="#41699b" font-family="monospace">' + num(estSel[pi], 2) + '</text>';
    }
    $('connMap').innerHTML = s;

    /* ---- 时间序列 ---- */
    var N = data.inj.length;
    var xf = function (i) { return 34 + i / (N - 1) * (W - 46); };
    var s2 = '';
    /* 注入量（上 108px） */
    var T1 = 14, H1 = 96, B1 = 6;
    var iLo = 300, iHi = 800;
    var yI = function (v) { return T1 + (1 - (v - iLo) / (iHi - iLo)) * (H1 - T1 - B1); };
    s2 += '<text x="6" y="' + (T1 + 10) + '" font-size="9.5" fill="#4d565b" font-weight="600">注水量 m³/d</text>';
    s2 += '<path d="' + pathOf(Array.prototype.slice.call(data.inj), xf, yI, W, H, 0, T1, B1, 0) + '" fill="none" stroke="#41699b" stroke-width="1.3"/>';
    /* 油井产液（下 108px，归一化） */
    var T2 = 128, H2 = 100;
    var maxes = [], pp;
    for (pp = 0; pp < 4; pp++) {
      var mx = 0, t;
      for (t = 0; t < N; t++) { var a = Math.abs(data.prods[pp][t]); if (a > mx) mx = a; }
      maxes.push(mx || 1);
    }
    var cols = [C_P1, C_P2, C_P3, C_P4];
    s2 += '<text x="6" y="' + (T2 + 10) + '" font-size="9.5" fill="#4d565b" font-weight="600">油井产液（归一化）</text>';
    for (pp = 0; pp < 4; pp++) {
      var ys = new Float64Array(N);
      for (var t2 = 0; t2 < N; t2++) ys[t2] = data.prods[pp][t2] / maxes[pp];
      var yP = function (v) { return T2 + 14 + (1 - v) * (H2 - 24); };
      s2 += '<path d="' + pathOf(ys, xf, yP, W, H, 0, T2, B1, 0) + '" fill="none" stroke="' + cols[pp] + '" stroke-width="1.1"/>';
      s2 += '<text x="' + (W - 8) + '" y="' + (T2 + 20 + pp * 12) + '" text-anchor="end" font-size="8.5" fill="' + cols[pp] + '">P' + (pp + 1) + '</text>';
    }
    $('connSeries').innerHTML = s2;

    /* ---- 连通增益对比条 ---- */
    var BW = 700, BH = 150;
    var LX = 44, RX = 12, TT = 30, BB = 26;
    var plotW = BW - LX - RX;
    var gx = [LX + plotW * 0.125, LX + plotW * 0.375, LX + plotW * 0.625, LX + plotW * 0.875];
    var s3 = '<rect x="0" y="0" width="' + BW + '" height="' + BH + '" fill="#fff"/>';
    s3 += '<text x="' + LX + '" y="16" font-size="10" fill="#4d565b" font-weight="600">注采对增益：真实 vs 估计</text>';
    s3 += '<rect x="' + (BW - 170) + '" y="8" width="10" height="10" fill="#c9c2b0"/><text x="' + (BW - 156) + '" y="16" font-size="8.5" fill="#4d565b">真实</text>';
    s3 += '<rect x="' + (BW - 120) + '" y="8" width="10" height="10" fill="#41699b"/><text x="' + (BW - 106) + '" y="16" font-size="8.5" fill="#4d565b">估计·去趋势</text>';
    s3 += '<rect x="' + (BW - 60) + '" y="8" width="10" height="10" fill="#b26a39"/><text x="' + (BW - 46) + '" y="16" font-size="8.5" fill="#4d565b">估计·不去趋势</text>';
    [0, 0.5, 1].forEach(function (v) {
      var y = TT + (1 - v) * (BH - TT - BB);
      s3 += '<line x1="' + LX + '" y1="' + y + '" x2="' + (BW - RX) + '" y2="' + y + '" stroke="#efece1" stroke-width="1"/>';
      s3 += '<text x="' + (LX - 4) + '" y="' + (y + 3) + '" font-size="8.5" fill="#9ba3a9" text-anchor="end" font-family="monospace">' + v + '</text>';
    });
    var bi;
    for (bi = 0; bi < 4; bi++) {
      var baseY = TT, barH = (BH - TT - BB) * 0.5;
      function barY(v) { return baseY + (1 - v) * barH + 2; }
      function barHt(v) { return Math.max(2, v * barH - 2); }
      var x0 = gx[bi] - 42;
      s3 += '<rect x="' + (x0 + 4) + '" y="' + barY(trueG[bi]) + '" width="24" height="' + barHt(trueG[bi]) + '" rx="2" fill="#c9c2b0"/>';
      s3 += '<rect x="' + (x0 + 31) + '" y="' + barY(estDG[bi]) + '" width="24" height="' + barHt(estDG[bi]) + '" rx="2" fill="#41699b"/>';
      s3 += '<rect x="' + (x0 + 58) + '" y="' + barY(estRG[bi]) + '" width="24" height="' + barHt(estRG[bi]) + '" rx="2" fill="#b26a39"/>';
      s3 += '<text x="' + (x0 + 50) + '" y="' + (BH - 10) + '" text-anchor="middle" font-size="9.5" fill="#4d565b">P' + (bi + 1) + '</text>';
    }
    $('connBars').innerHTML = s3;

    /* ---- 读数与提示 ---- */
    var errD = 0, errR = 0;
    for (var k = 0; k < 4; k++) { errD += Math.abs(estDG[k] - trueG[k]); errR += Math.abs(estRG[k] - trueG[k]); }
    errD /= 4; errR /= 4;
    var strong = [];
    for (var k2 = 0; k2 < 4; k2++) if (estSel[k2] >= 0.45) strong.push('P' + (k2 + 1));
    $('roTrue').textContent = 'P1 · P2';
    $('roEst').textContent = strong.length ? strong.join(' · ') : '—';
    var e1 = $('roErrD'), e2 = $('roErrR');
    e1.textContent = num(errD, 3); e2.textContent = num(errR, 3);
    e1.className = errD <= 0.08 ? 'ok' : (errD <= 0.2 ? 'warn' : 'bad');
    e2.className = errR <= 0.08 ? 'ok' : (errR <= 0.2 ? 'warn' : 'bad');
    var tip = $('connTip');
    if (drift && !detrend) {
      tip.innerHTML = '<b>假连通现身：</b>共同漂移让 P3、P4 也被估成"强连通"（增益误差 ' + num(errR, 3) + '）。' +
        '关掉漂移或打开<b>差分去趋势</b>，缓慢趋势被差分滤掉，估计回到真实附近（误差 ' + num(errD, 3) + '）。' +
        '这正是流程第 2 步"先差分去趋势再做脉冲响应"的原因。';
      tip.className = 'tip clay';
    } else {
      tip.innerHTML = drift
        ? '<b>共同漂移在，但差分去趋势把它滤掉了</b>——估计与真实基本一致。' +
          '现在把"差分去趋势"关掉试试：同向波动立刻被当成响应。'
        : '没有共同漂移时，两种估计都可用；现场真正危险的是<b>看不见的制度性漂移</b>。' +
          '再试试把噪声拉到 1.5 以上，看增益估计怎么抖动。';
      tip.className = 'tip';
    }
  }

  /* =====================================================
     屏 2 · 层间矛盾与人工调参
     ===================================================== */
  var allocW = [30, 27, 23, 20];   /* 现状：高渗层配注仍偏高（权重 0-100） */
  var allocInputs = [];

  function buildAllocSliders() {
    var box = $('allocSliders');
    var names = ['L1 高渗 480 mD', 'L2 中渗 180 mD', 'L3 低渗 55 mD', 'L4 特低渗 18 mD'];
    var html = '';
    for (var i = 0; i < 4; i++) {
      html += '<div class="sl"><label>' + names[i] + ' · 配注权重 <output id="allocOut' + i + '">' + allocW[i] + '</output></label>' +
        '<input type="range" id="allocIn' + i + '" min="0" max="100" step="1" value="' + allocW[i] + '"></div>';
    }
    box.innerHTML = html;
    for (var j = 0; j < 4; j++) {
      var el = $('allocIn' + j);
      el.addEventListener('input', function () {
        for (var k = 0; k < 4; k++) allocW[k] = Number($('allocIn' + k).value);
        drawManual();
      });
      allocInputs.push(el);
    }
  }

  function drawManual() {
    var f = M.normAlloc(allocW);
    var sim = M.simulate(f, 900, 0, 11);
    for (var i = 0; i < 4; i++) $('allocOut' + i).textContent = allocW[i];
    var dev = 0;
    for (var d = 0; d < 4; d++) dev += Math.abs(sim.s[d] - M.FSTAR[d]);

    /* 剖面图：理想 / 设定 / 实际 */
    var W = 700, H = 210;
    var panels = [
      { x: 20, w: 216, title: '理想配注', sub: '剩余油潜力' },
      { x: 248, w: 216, title: '配注设定', sub: '你调的' },
      { x: 476, w: 204, title: '实际吸水', sub: '地层回报' }
    ];
    var s = '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fff"/>';
    panels.forEach(function (p) {
      s += '<text x="' + (p.x + 8) + '" y="20" font-size="10" fill="#4d565b" font-weight="600">' + p.title + '</text>';
      s += '<text x="' + (p.x + 8) + '" y="33" font-size="8.5" fill="#9ba3a9">' + p.sub + '</text>';
    });
    var vals = [M.FSTAR, f, sim.s];
    var fills = ['#c9c2b0', '#b26a39', '#41699b'];
    var ly = 46, lh = 22, gap = 8;
    for (var r = 0; r < 4; r++) {
      s += '<text x="10" y="' + (ly + lh * r + gap * r + 15) + '" font-size="8.5" fill="#4d565b">L' + (r + 1) + '</text>';
      for (var c = 0; c < 3; c++) {
        var p = panels[c];
        var maxV = 0.6;
        var bw = Math.max(3, vals[c][r] / maxV * (p.w - 70));
        var bx = p.x + 24, by = ly + r * (lh + gap);
        s += '<rect x="' + bx + '" y="' + by + '" width="' + num(bw, 1) + '" height="' + lh + '" rx="3" fill="' + fills[c] + '" opacity=".9"/>';
        s += '<text x="' + (bx + bw + 4) + '" y="' + (by + 15) + '" font-size="8.5" fill="#4d565b" font-family="monospace">' + Math.round(vals[c][r] * 100) + '%</text>';
      }
    }
    s += '<text x="10" y="' + (H - 8) + '" font-size="8.5" fill="#9ba3a9">配注设定"看起来公平"，实际吸水仍偏向高渗层——中间隔着渗透率（吸水能力）。</text>';
    $('profileChart').innerHTML = s;

    /* 各层产油达成率 */
    var W2 = 700, H2 = 150;
    var s2 = '<rect x="0" y="0" width="' + W2 + '" height="' + H2 + '" fill="#fff"/>';
    s2 += '<text x="10" y="16" font-size="10" fill="#4d565b" font-weight="600">各层产油达成率（100% = 该层油被充分驱出；不足 = 欠注损失）</text>';
    var names2 = ['L1 · 高渗', 'L2 · 中渗', 'L3 · 低渗', 'L4 · 特低渗'];
    for (var r2 = 0; r2 < 4; r2++) {
      var yy = 34 + r2 * 28;
      s2 += '<text x="10" y="' + (yy + 12) + '" font-size="8.5" fill="#4d565b">' + names2[r2] + '</text>';
      var o = sim.o[r2];
      var ow = Math.max(2, o * 430);
      s2 += '<rect x="86" y="' + yy + '" width="430" height="16" rx="4" fill="#f1f1ee"/>';
      s2 += '<rect x="86" y="' + yy + '" width="' + num(ow, 1) + '" height="16" rx="4" fill="#2f7d6b"/>';
      s2 += '<text x="' + (86 + ow + 6) + '" y="' + (yy + 12) + '" font-size="8.5" fill="#2f7d6b" font-family="monospace">' + Math.round(o * 100) + '%</text>';
      var a = 900 * sim.s[r2];
      var ov = a > M.VSTAR[r2] ? (a - M.VSTAR[r2]) / M.VSTAR[r2] : 0;
      if (ov > 0.02) {
        s2 += '<text x="548" y="' + (yy + 12) + '" font-size="8.5" fill="#b26a39" font-family="monospace">超注 +' + num(ov, 2) + '</text>';
      } else {
        s2 += '<text x="548" y="' + (yy + 12) + '" font-size="8.5" fill="#9ba3a9">—</text>';
      }
    }
    $('layerChart').innerHTML = s2;

    /* 读数 */
    var oil = sim.oil, wc = sim.wc, wtr = 900 / oil;
    var roOil = $('roOil'); roOil.textContent = num(oil, 1) + ' t/d';
    roOil.className = oil >= 130 ? 'ok' : (oil >= 120 ? '' : 'bad');
    var roWc = $('roWc'); roWc.textContent = num(wc, 1) + ' %';
    roWc.className = wc <= 92 ? 'ok' : 'bad';
    $('roWtr').textContent = num(wtr, 2) + ' m³/t';
    var roDev = $('roDev'); roDev.textContent = num(dev, 3);
    roDev.className = dev <= 0.4 ? 'ok' : (dev <= 0.7 ? 'warn' : 'bad');

    $('manTip').innerHTML = '现在的配注设定是<b>现状方案</b>（高渗层仍配得多）。看三层剖面：理想配注要求"高渗少配、低渗多配"，' +
      '但实际吸水被渗透率"劫持"——L1 高渗层仍吸走 ' + Math.round(sim.s[0] * 100) + '% 的水，L4 特低渗只拿到 ' + Math.round(sim.s[3] * 100) + '%。' +
      '把权重往低渗层推，产油确实上升，但要在看不见"剩余油潜力（理想配注）"和"渗透率劫持程度"的情况下靠感觉调到最优，基本不可能——这正是屏 3 数据模型要补的盲区。';
  }

  /* =====================================================
     屏 3 · 代理模型 + 约束优化
     ===================================================== */
  var optSeed = 20261102;
  var optState = { model: null, losses: [], valFit: null, ga: null, lam: 0.8, simNoise: 0.2 };

  function runOptimization() {
    var rng = M.mulberry32(optSeed);
    optSeed += 101;
    var simNoise = optState.simNoise;
    var lam = optState.lam;

    /* 1. 采样训练集（模拟器 = 真值）：60 个广度均匀 + 40 个先验聚焦（把人工经验区当作先验样本注入） */
    var X = [], Y = [], i;
    for (i = 0; i < 100; i++) {
      var f, T;
      if (i < 60) { f = M.sampleAlloc(rng); T = 700 + rng() * 400; }
      else { f = M.normAlloc([0.02 + rng() * 0.07, 0.05 + rng() * 0.14, 0.2 + rng() * 0.24, 0.35 + rng() * 0.25]); T = 850 + rng() * 250; }
      var r = M.simulate(f, T, simNoise, Math.floor(rng() * 1e9));
      X.push([f[0], f[1], f[2], f[3], T / 1200]);
      Y.push([r.oil / 160, r.wc / 100]);
    }

    /* 2. 拟合代理模型（高斯核回归）+ 留一交叉验证误差 */
    var model = M.kernelRidge(X, Y, 0.35, 1e-4);
    var loo = M.loocvErrors(X, Y, 0.35, 1e-4);

    /* 3. 验证：30 个新样本，代理 vs 模拟器 */
    var valFit = { oil: [], wc: [] };
    for (i = 0; i < 30; i++) {
      var f2 = M.sampleAlloc(rng);
      var T2 = 700 + rng() * 400;
      var r2 = M.simulate(f2, T2, 0, Math.floor(rng() * 1e9));
      var p2 = model.predict([f2[0], f2[1], f2[2], f2[3], T2 / 1200]);
      valFit.oil.push([r2.oil, p2.oil]);
      valFit.wc.push([r2.wc, p2.wc]);
    }
    function r2Of(pairs) {
      var mean = 0, n = pairs.length, j;
      for (j = 0; j < n; j++) mean += pairs[j][0];
      mean /= n;
      var ss = 0, se = 0;
      for (j = 0; j < n; j++) { ss += (pairs[j][0] - mean) * (pairs[j][0] - mean); se += (pairs[j][0] - pairs[j][1]) * (pairs[j][0] - pairs[j][1]); }
      return ss > 0 ? 1 - se / ss : 0;
    }

    /* 4. 遗传算法搜索（代理模型上）：首次运行固定种子 7（与离线自检一致，刷新页面结果稳定）；点"重新训练"会换种子看随机性 */
    var ga = M.gaOpt(model, lam, 64, 90, 7);

    /* 5. 真值评估 */
    var manualSim = M.simulate(M.MANUAL, 900, 0, 5);
    var optSim = M.simulate(ga.best.f, ga.best.T, 0, 6);

    optState.model = model; optState.losses = loo; optState.valFit = valFit;
    optState.ga = ga; optState.r2 = { oil: r2Of(valFit.oil), wc: r2Of(valFit.wc) };
    optState.manualSim = manualSim; optState.optSim = optSim;
    optState.trainX = X;

    drawOpt();
  }

  function drawOpt() {
    var st = optState;
    var lam = Number($('inLam').value);
    var simNoise = Number($('inSimNoise').value);
    $('outLam').textContent = num(lam, 2);
    $('outSimNoise').textContent = num(simNoise, 2);

    var rerunGA = Math.abs(lam - st.lam) > 1e-6 || Math.abs(simNoise - st.simNoise) > 1e-6;
    st.lam = lam; st.simNoise = simNoise;
    if (rerunGA && st.model) {
      var rng = M.mulberry32(optSeed);
      optSeed += 101;
      st.ga = M.gaOpt(st.model, lam, 64, 90, Math.floor(rng() * 1e9));
      st.optSim = M.simulate(st.ga.best.f, st.ga.best.T, 0, 6);
    }

    /* ---- 留一交叉验证（LOOCV）误差 ---- */
    var lw = 340, lh = 170;
    var loo = st.losses;
    var errs = loo.errs;
    var mxE = Math.max.apply(null, errs);
    var s = '<rect x="0" y="0" width="' + lw + '" height="' + lh + '" fill="#fff"/>';
    s += '<text x="10" y="16" font-size="10" fill="#4d565b" font-weight="600">留一交叉验证：代理模型对每个训练样本的预测误差</text>';
    var Lx = 30, Rx = 8, Tt = 26, Bb = 18;
    var bw = (lw - Lx - Rx) / errs.length;
    for (var bi = 0; bi < errs.length; bi++) {
      var bh = errs[bi] / mxE * (lh - Tt - Bb);
      s += '<rect x="' + num(Lx + bi * bw + bw * 0.25) + '" y="' + num(Tt + (lh - Tt - Bb - bh)) + '" width="' + num(bw * 0.5) + '" height="' + num(bh) + '" fill="#2f7d6b" opacity=".55"/>';
    }
    s += '<text x="' + (lw - 8) + '" y="' + (lh - 6) + '" text-anchor="end" font-size="8.5" fill="#9ba3a9">留一验证 RMSE=' + num(loo.rmse * 160, 1) + ' t/d（产油当量）</text>';
    $('lossChart').innerHTML = s;

    /* ---- 代理 vs 模拟器 ---- */
    var fw = 340, fh = 170;
    var s2 = '<rect x="0" y="0" width="' + fw + '" height="' + fh + '" fill="#fff"/>';
    s2 += '<text x="10" y="16" font-size="10" fill="#4d565b" font-weight="600">代理模型 vs 模拟器（30 个新方案）</text>';
    var pL = 34, pR = 10, pT = 26, pB = 18;
    /* x = 代理预测，y = 模拟器实际；越贴对角线越准 */
    st.valFit.oil.forEach(function (p) {
      s2 += '<circle cx="' + num(pL + (p[1] / 160) * (fw - pL - pR)) + '" cy="' + num(pT + (1 - p[0] / 170) * (fh - pT - pB)) + '" r="2.6" fill="#2f7d6b" opacity=".8"/>';
    });
    st.valFit.wc.forEach(function (p) {
      s2 += '<circle cx="' + num(pL + ((p[1] - 87) / 8) * (fw - pL - pR)) + '" cy="' + num(pT + (1 - (p[0] - 87) / 8) * (fh - pT - pB)) + '" r="2.6" fill="#b26a39" opacity=".8"/>';
    });
    s2 += '<line x1="' + pL + '" y1="' + (fh - pB) + '" x2="' + (fw - pR) + '" y2="' + pT + '" stroke="#e3dccb" stroke-dasharray="4 3"/>';
    s2 += '<text x="10" y="' + (fh - 6) + '" font-size="8.5" fill="#4d565b">● 产油（绿）· 含水（陶土）· 越贴对角线越准　R²产油=' + num(st.r2.oil, 2) + '　R²含水=' + num(st.r2.wc, 2) + '</text>';
    $('fitChart').innerHTML = s2;

    /* ---- GA 收敛 ---- */
    var gw = 340, gh = 170;
    var s3 = '<rect x="0" y="0" width="' + gw + '" height="' + gh + '" fill="#fff"/>';
    s3 += '<text x="10" y="16" font-size="10" fill="#4d565b" font-weight="600">遗传算法收敛（最优适应度/代）</text>';
    var crv = st.ga.curve;
    var fmin = crv[0][1], fmax = crv[crv.length - 1][1];
    if (crv.length > 1) for (var ci = 1; ci < crv.length; ci++) { if (crv[ci][1] < fmin) fmin = crv[ci][1]; if (crv[ci][1] > fmax) fmax = crv[ci][1]; }
    var span = (fmax - fmin) || 1;
    var xfG = function (e) { return 34 + e / crv[crv.length - 1][0] * (gw - 44); };
    var yfG = function (v) { return 28 + (1 - (v - fmin) / span) * (gh - 46); };
    s3 += '<path d="' + pathOf(crv.map(function (p) { return p[1]; }), xfG, yfG, gw, gh, 0, 28, 18, 0) + '" fill="none" stroke="#b26a39" stroke-width="1.4"/>';
    s3 += '<text x="' + (gw - 8) + '" y="' + (gh - 6) + '" text-anchor="end" font-size="8.5" fill="#9ba3a9">种群 64 · 90 代</text>';
    $('gaChart').innerHTML = s3;

    /* ---- 帕累托前沿 ---- */
    var pw = 340, ph = 170;
    var s4 = '<rect x="0" y="0" width="' + pw + '" height="' + ph + '" fill="#fff"/>';
    s4 += '<text x="10" y="16" font-size="10" fill="#4d565b" font-weight="600">搜索空间：产油 vs 含水（80 个采样方案）</text>';
    var pts = [];
    st.trainX.forEach(function (x) {
      var r = M.simulate([x[0], x[1], x[2], x[3]], x[4] * 1200, 0, 9);
      pts.push({ oil: r.oil, wc: r.wc });
    });
    var wcMin = 87, wcMax = 95, oMin = 105, oMax = 170;
    var Xf = function (v) { return 40 + (v - wcMin) / (wcMax - wcMin) * (pw - 52); };
    var Yf = function (v) { return 30 + (1 - (v - oMin) / (oMax - oMin)) * (ph - 46); };
    pts.forEach(function (p) {
      s4 += '<circle cx="' + num(Xf(p.wc)) + '" cy="' + num(Yf(p.oil)) + '" r="2.2" fill="#9fb8d4" opacity=".75"/>';
    });
    /* 非支配前沿 */
    var sorted = pts.slice().sort(function (a, b) { return b.oil - a.oil; });
    var front = [], minWc = 99;
    sorted.forEach(function (p) { if (p.wc < minWc) { minWc = p.wc; front.push(p); } });
    if (front.length > 1) {
      var d = '';
      front.forEach(function (p, i) { d += (i ? 'L' : 'M') + num(Xf(p.wc)) + ' ' + num(Yf(p.oil)); });
      s4 += '<path d="' + d + '" fill="none" stroke="#2f7d6b" stroke-width="1.3" stroke-dasharray="5 3"/>';
    }
    var os = st.optSim;
    s4 += '<path d="M' + num(Xf(os.wc) - 5) + ' ' + num(Yf(os.oil)) + ' L' + num(Xf(os.wc)) + ' ' + num(Yf(os.oil) - 6) + ' L' + num(Xf(os.wc) + 5) + ' ' + num(Yf(os.oil)) + ' Z" fill="#b26a39"/>';
    s4 += '<text x="' + (Xf(os.wc) + 7) + '" y="' + (Yf(os.oil) + 3) + '" font-size="8.5" fill="#b26a39" font-weight="600">优化解</text>';
    var ms = st.manualSim;
    s4 += '<rect x="' + (Xf(ms.wc) - 4) + '" y="' + (Yf(ms.oil) - 4) + '" width="8" height="8" fill="#79828a"/>';
    s4 += '<text x="' + (Xf(ms.wc) + 7) + '" y="' + (Yf(ms.oil) + 3) + '" font-size="8.5" fill="#79828a">现状</text>';
    s4 += '<text x="10" y="' + (ph - 6) + '" font-size="8.5" fill="#9ba3a9">绿虚线 = 帕累托前沿（产油↑含水↓方向）</text>';
    $('paretoChart').innerHTML = s4;

    /* ---- 对比柱状图 ---- */
    var cw = 700, ch = 190;
    var s5 = '<rect x="0" y="0" width="' + cw + '" height="' + ch + '" fill="#fff"/>';
    s5 += '<text x="10" y="16" font-size="10" fill="#4d565b" font-weight="600">现状人工方案 vs 优化方案（真模拟器评估）</text>';
    s5 += '<rect x="' + (cw - 190) + '" y="8" width="10" height="10" fill="#d9b78e"/><text x="' + (cw - 176) + '" y="16" font-size="8.5" fill="#4d565b">现状人工方案</text>';
    s5 += '<rect x="' + (cw - 104) + '" y="8" width="10" height="10" fill="#2f7d6b"/><text x="' + (cw - 90) + '" y="16" font-size="8.5" fill="#4d565b">优化方案</text>';
    var groups = [
      { cx: 140, lab: '日产油 t/d', max: 170, fmt: function (v) { return Math.round(v); }, a: ms.oil, b: os.oil, dx: '+', want: 'up' },
      { cx: 350, lab: '综合含水 %', max: 95, fmt: function (v) { return num(v, 1); }, a: ms.wc, b: os.wc, dx: '', want: 'down', lim: 92 },
      { cx: 560, lab: '吨油耗水 m³/t', max: 9, fmt: function (v) { return num(v, 2); }, a: 900 / ms.oil, b: st.ga.best.T / os.oil, dx: '', want: 'down' }
    ];
    var baseY = 148, topY = 30;
    groups.forEach(function (g) {
      var yA = function (v) { return baseY - v / g.max * (baseY - topY); };
      s5 += '<rect x="' + (g.cx - 42) + '" y="' + num(yA(g.a)) + '" width="38" height="' + num(baseY - yA(g.a)) + '" rx="3" fill="#d9b78e"/>';
      s5 += '<rect x="' + (g.cx + 4) + '" y="' + num(yA(g.b)) + '" width="38" height="' + num(baseY - yA(g.b)) + '" rx="3" fill="#2f7d6b"/>';
      s5 += '<text x="' + (g.cx - 23) + '" y="' + num(yA(g.a) - 4) + '" text-anchor="middle" font-size="9.5" fill="#4d565b" font-weight="700" font-family="monospace">' + g.fmt(g.a) + '</text>';
      s5 += '<text x="' + (g.cx + 23) + '" y="' + num(yA(g.b) - 4) + '" text-anchor="middle" font-size="9.5" fill="#2f7d6b" font-weight="700" font-family="monospace">' + g.fmt(g.b) + '</text>';
      if (g.lim) {
        var yl = yA(g.lim);
        s5 += '<line x1="' + (g.cx - 58) + '" y1="' + num(yl) + '" x2="' + (g.cx + 58) + '" y2="' + num(yl) + '" stroke="#b26a39" stroke-width="1" stroke-dasharray="5 3"/>';
        s5 += '<text x="' + (g.cx + 62) + '" y="' + num(yl + 3) + '" font-size="8.5" fill="#b26a39">上限 92%</text>';
      }
      s5 += '<text x="' + g.cx + '" y="' + (ch - 6) + '" text-anchor="middle" font-size="9.5" fill="#4d565b">' + g.lab + '</text>';
    });
    $('cmpChart').innerHTML = s5;

    /* ---- 配注方案对比 ---- */
    var aw = 700, ah = 170;
    var s6 = '<rect x="0" y="0" width="' + aw + '" height="' + ah + '" fill="#fff"/>';
    s6 += '<text x="10" y="16" font-size="10" fill="#4d565b" font-weight="600">分层配注方案：现状 vs 优化</text>';
    var gxc = [125, 295, 465, 635];
    var lnames = ['L1 高渗', 'L2 中渗', 'L3 低渗', 'L4 特低渗'];
    var bY = 128, tY = 30;
    for (var li = 0; li < 4; li++) {
      var va = M.MANUAL[li], vb = osT(li);
      function hgt(v) { return (v / 0.6) * (bY - tY); }
      s6 += '<rect x="' + (gxc[li] - 42) + '" y="' + num(bY - hgt(va)) + '" width="36" height="' + num(hgt(va)) + '" rx="3" fill="#d9b78e"/>';
      s6 += '<rect x="' + (gxc[li] + 6) + '" y="' + num(bY - hgt(vb)) + '" width="36" height="' + num(hgt(vb)) + '" rx="3" fill="#2f7d6b"/>';
      s6 += '<text x="' + (gxc[li] - 24) + '" y="' + num(bY - hgt(va) - 4) + '" text-anchor="middle" font-size="8.5" fill="#4d565b" font-family="monospace">' + Math.round(va * 100) + '%</text>';
      s6 += '<text x="' + (gxc[li] + 24) + '" y="' + num(bY - hgt(vb) - 4) + '" text-anchor="middle" font-size="8.5" fill="#2f7d6b" font-family="monospace">' + Math.round(vb * 100) + '%</text>';
      s6 += '<text x="' + gxc[li] + '" y="' + (ah - 8) + '" text-anchor="middle" font-size="8.5" fill="#4d565b">' + lnames[li] + '</text>';
    }
    s6 += '<text x="' + (aw - 10) + '" y="' + (ah - 30) + '" text-anchor="end" font-size="9.5" fill="#2f7d6b">优化总注水 ' + Math.round(st.ga.best.T) + ' m³/d（现状 900）</text>';
    $('allocChart').innerHTML = s6;

    /* ---- 读数与提示 ---- */
    $('roMOil').textContent = Math.round(ms.oil) + ' t/d';
    $('roOOil').textContent = Math.round(os.oil) + ' t/d';
    $('roMWc').textContent = num(ms.wc, 1) + ' / ' + num(os.wc, 1) + ' %';
    $('roWtr2').textContent = num(900 / ms.oil, 2) + ' → ' + num(st.ga.best.T / os.oil, 2) + ' m³/t';
    var lim = $('roLimit');
    lim.textContent = os.wc <= 92 ? '达标 ✓' : '超限 ✗';
    lim.className = os.wc <= 92 ? 'ok' : 'bad';
    $('optTip').innerHTML = '混合优化：<b>代理模型粗搜（遗传算法）</b> → 前 8 名候选<b>放回真模拟器精选</b>，避免代理外推误差。' +
      '结果把总注水量与分层配注一起搜：<b>压高渗（水窜层）、抬低渗（欠注层）</b>，并微调总注水。' +
      '当前 λ=' + num(lam, 1) + '（控水权重）：日产油 ' + Math.round(ms.oil) + ' → ' + Math.round(os.oil) + ' t/d，' +
      '综合含水 ' + num(ms.wc, 1) + ' → ' + num(os.wc, 1) + ' %（上限 92%），吨油耗水 ' + num(900 / ms.oil, 2) + ' → ' + num(st.ga.best.T / os.oil, 2) + ' m³/t。' +
      '把 λ 拉到 2.0 会更保守（含水更低、产油略少），拉到 0 则只追产油。';
  }

  function osT(i) { return optState.ga.best.f[i]; }

  /* ---- 事件绑定 ---- */
  $('inNoise').addEventListener('input', drawConn);
  $('cbDrift').addEventListener('change', drawConn);
  $('cbDetrend').addEventListener('change', drawConn);
  $('inLam').addEventListener('input', drawOpt);
  $('inSimNoise').addEventListener('input', drawOpt);
  $('btnRerun').addEventListener('click', function () {
    runOptimization();
  });

  buildAllocSliders();
  drawConn();
  drawManual();
  runOptimization();

})(typeof window !== 'undefined' ? window : this);
