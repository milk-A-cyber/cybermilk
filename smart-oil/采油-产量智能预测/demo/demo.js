/* =========================================================
   产量智能预测 · 可运行示范（整页模式，沙箱 iframe 内运行）
   ---------------------------------------------------------
   三屏：
     屏 1 · 单井模拟器 —— 合成日度产量曲线，分解「基线递减 /
            措施增量 / 季节项 / 噪声」四个成分（对应 STEP 1—2）
     屏 2 · 预测引擎   —— Arps 递减 / 岭回归 / MLP 三个模型在
            滚动原点（walk-forward）协议下同台预测 + 80% 区间
            （对应 STEP 3—4）
     屏 3 · 归因与批量 —— 6 口井批量验证汇总；中断时间序列
            反事实归因；「是否告诉模型有措施」开关对比
            （对应 STEP 5—6）
   所有计算（序列生成、拟合、训练、归因）都在浏览器里实时完成，
   没有后端。文件末尾有 module.exports 守卫，供 Node 自测。
   ========================================================= */
(function () {
  "use strict";

  /* =====================================================
     0. 小工具
     ===================================================== */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
  function std(a) { var m = mean(a), s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / Math.max(1, a.length - 1)); }
  function quantile(sorted, p) {
    if (!sorted.length) return 0;
    var i = clamp(p * (sorted.length - 1), 0, sorted.length - 1), lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }
  function pct(a, p) { var b = a.slice().sort(function (x, y) { return x - y; }); return quantile(b, p); }
  function fmt(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    var s = Number(v).toFixed(d === undefined ? 1 : d);
    return /^-0\.0*$/.test(s) ? s.slice(1) : s;   /* 避免出现 "-0.0" */
  }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* =====================================================
     1. 单井日度序列生成器（教学版物理统计混合模型）
        q(t) = 基线递减(t) × (1+季节) + 措施增量(t) + 噪声
        基线递减受含水上升加速；措施增量按指数衰减；
        间开井周期性停产。
     ===================================================== */
  var WELL_PRESETS = {
    stable: {
      key: "stable", name: "稳产老井", seed: 101,
      q0: 18.0, d: 0.0016, seasA: 0.05, sigma: 0.5,
      wc0: 0.25, wc1: 0.42, wcTau: 900, wcBoost: 1.6,
      events: [], shutEvery: 0
    },
    frac: {
      key: "frac", name: "压裂见效井", seed: 202,
      q0: 9.0, d: 0.0026, seasA: 0.06, sigma: 0.45,
      wc0: 0.35, wc1: 0.55, wcTau: 700, wcBoost: 1.8,
      events: [{ t: 300, type: "压裂", amp: 0.55, tau: 400 }], shutEvery: 0
    },
    water: {
      key: "water", name: "含水上升井", seed: 303,
      q0: 15.0, d: 0.0018, seasA: 0.05, sigma: 0.5,
      wc0: 0.20, wc1: 0.88, wcTau: 520, wcBoost: 3.2,
      events: [], shutEvery: 0
    },
    shutin: {
      key: "shutin", name: "间开井", seed: 404,
      q0: 12.0, d: 0.0012, seasA: 0.05, sigma: 0.6,
      wc0: 0.30, wc1: 0.45, wcTau: 900, wcBoost: 1.4,
      events: [{ t: 420, type: "换泵", amp: 0.22, tau: 500 }],
      shutEvery: 45, shutLen: 4
    },
    waterplug: {
      key: "waterplug", name: "堵水见效井", seed: 505,
      q0: 14.0, d: 0.0022, seasA: 0.06, sigma: 0.5,
      wc0: 0.55, wc1: 0.72, wcTau: 800, wcBoost: 2.0,
      events: [{ t: 330, type: "堵水", amp: 0.38, tau: 600 }], shutEvery: 0
    },
    young: {
      key: "young", name: "新井（冷启动）", seed: 606,
      q0: 22.0, d: 0.0032, seasA: 0.05, sigma: 0.7,
      wc0: 0.05, wc1: 0.18, wcTau: 900, wcBoost: 1.2,
      events: [], shutEvery: 0
    }
  };

  function genWell(cfg, days) {
    days = days || 720;
    var rnd = mulberry32(cfg.seed);
    var N = days, t;
    var q = new Array(N), base = new Array(N), jump = new Array(N), seas = new Array(N),
        noise = new Array(N), wc = new Array(N), op = new Array(N), inj = new Array(N),
        shut = new Array(N);
    /* 含水率：S 型上升（用指数逼近） */
    for (t = 0; t < N; t++) {
      wc[t] = clamp(cfg.wc0 + (cfg.wc1 - cfg.wc0) * (1 - Math.exp(-t / cfg.wcTau)), 0.01, 0.97);
    }
    /* 基线递减：含水越高递减越快 */
    for (t = 0; t < N; t++) {
      var dEff = cfg.d * (1 + cfg.wcBoost * (wc[t] - cfg.wc0));
      base[t] = cfg.q0 * Math.exp(-dEff * t);
    }
    /* 措施增量：每个事件一条指数衰减的台阶 */
    for (t = 0; t < N; t++) {
      var j = 0;
      cfg.events.forEach(function (ev) {
        if (t >= ev.t) j += ev.amp * cfg.q0 * Math.exp(-(t - ev.t) / ev.tau);
      });
      jump[t] = j;
    }
    /* 季节项：年度周期，冬季偏低 */
    for (t = 0; t < N; t++) seas[t] = cfg.seasA * Math.sin(2 * Math.PI * ((t % 365) / 365) - 1.1);
    /* 噪声 + 间开停产 */
    var shutUntil = -1;
    for (t = 0; t < N; t++) {
      noise[t] = (rnd() + rnd() + rnd() - 1.5) / 1.5 * cfg.sigma;
      shut[t] = 0;
      if (cfg.shutEvery && t > 30 && t % cfg.shutEvery === 0) shutUntil = t + cfg.shutLen;
      if (t < shutUntil) shut[t] = 1;
    }
    for (t = 0; t < N; t++) {
      var raw = base[t] + jump[t];
      var v = raw * (1 + seas[t]) + noise[t] * Math.max(0.6, raw * 0.06);
      q[t] = shut[t] ? 0 : Math.max(0.1, v);
    }
    /* 协变量：油压（与产量弱相关）、注水量（平稳波动） */
    for (t = 0; t < N; t++) {
      op[t] = clamp(2.0 + 0.5 * (q[t] / cfg.q0) + (rnd() - 0.5) * 0.18, 0.4, 7);
      inj[t] = 55 + 10 * Math.sin(t / 110) + (rnd() - 0.5) * 7;
    }
    return {
      q: q, base: base, jump: jump, seas: seas, noise: noise, wc: wc, op: op, inj: inj,
      shut: shut, events: cfg.events.map(function (e) { return { t: e.t, type: e.type }; }),
      cfg: cfg, N: N
    };
  }

  /* =====================================================
     2. 三个模型
     ===================================================== */
  /* --- 模型 A：Arps 指数递减。对窗口内 log q 做线性拟合 --- */
  function arpsFit(q, from, to) {
    var xs = [], ys = [];
    for (var i = from; i < to; i++) {
      if (q[i] > 0.3) { xs.push(i - from); ys.push(Math.log(q[i])); }
    }
    var n = xs.length;
    if (n < 8) return { a: q[Math.max(0, from)], d: 0.0008 };
    var sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var k = 0; k < n; k++) { sx += xs[k]; sy += ys[k]; sxx += xs[k] * xs[k]; sxy += xs[k] * ys[k]; }
    var den = n * sxx - sx * sx;
    var slope = den === 0 ? 0 : (n * sxy - sx * sy) / den;
    var icept = (sy - slope * sx) / n;
    return { a: Math.exp(icept), d: -slope };
  }
  function arpsPredict(fit, from, to) {
    var out = [];
    for (var i = from; i < to; i++) out.push(fit.a * Math.exp(-fit.d * (i - from)));
    return out;
  }

  /* --- 线性代数：高斯消元解 Ax=b --- */
  function solve(A, b) {
    var n = b.length, M = [], i, j, k;
    for (i = 0; i < n; i++) { M.push(A[i].slice()); M[i].push(b[i]); }
    for (k = 0; k < n; k++) {
      var p = k;
      for (i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
      if (p !== k) { var tmp = M[p]; M[p] = M[k]; M[k] = tmp; }
      if (Math.abs(M[k][k]) < 1e-12) M[k][k] = 1e-12;
      for (i = k + 1; i < n; i++) {
        var f = M[i][k] / M[k][k];
        for (j = k; j <= n; j++) M[i][j] -= f * M[k][j];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }

  /* --- 模型 B：岭回归（闭式解），特征见 buildFeatures --- */
  function ridgeFit(X, y, lam) {
    var n = X.length, m = X[0].length, i, j, k2;
    var A = [], b = [];
    for (j = 0; j < m; j++) { A.push(new Array(m).fill(0)); b.push(0); }
    for (i = 0; i < n; i++) {
      var xi = X[i], yi = y[i];
      for (j = 0; j < m; j++) {
        b[j] += xi[j] * yi;
        for (k2 = j; k2 < m; k2++) A[j][k2] += xi[j] * xi[k2];
      }
    }
    for (j = 0; j < m; j++) { for (k2 = 0; k2 < j; k2++) A[j][k2] = A[k2][j]; if (j < m - 1) A[j][j] += lam; }
    return solve(A, b);
  }

  /* --- 模型 C：微型 MLP（1 隐层 tanh，全批量梯度下降） --- */
  function MLP(nIn, nHidden, seed) {
    var rnd = mulberry32(seed || 7);
    this.nIn = nIn; this.nH = nHidden;
    this.W1 = []; this.b1 = []; this.W2 = []; this.b2 = 0;
    var i, j;
    for (i = 0; i < nIn; i++) { this.W1.push([]); for (j = 0; j < nHidden; j++) this.W1[i].push((rnd() - 0.5) * 1.2); }
    for (j = 0; j < nHidden; j++) this.b1.push((rnd() - 0.5) * 0.4);
    for (j = 0; j < nHidden; j++) this.W2.push((rnd() - 0.5) * 0.8);
  }
  MLP.prototype.forward = function (x) {
    var h = [], j, i, s;
    for (j = 0; j < this.nH; j++) {
      s = this.b1[j];
      for (i = 0; i < this.nIn; i++) s += x[i] * this.W1[i][j];
      h.push(Math.tanh(s));
    }
    var o = this.b2;
    for (j = 0; j < this.nH; j++) o += h[j] * this.W2[j];
    return { h: h, o: o };
  };
  MLP.prototype.predict = function (x) { return this.forward(x).o; };
  MLP.prototype.train = function (X, y, epochs, lr) {
    var n = X.length, ep, i, j, hist = [];
    for (ep = 0; ep < epochs; ep++) {
      var loss = 0;
      var gW1 = [], gb1 = [], gW2 = [], gb2 = 0;
      for (i = 0; i < this.nIn; i++) { gW1.push(new Array(this.nH).fill(0)); }
      for (j = 0; j < this.nH; j++) gb1.push(0); gW2 = new Array(this.nH).fill(0);
      for (i = 0; i < n; i++) {
        var f = this.forward(X[i]);
        var err = f.o - y[i];
        loss += err * err;
        gb2 += err;
        for (j = 0; j < this.nH; j++) {
          gW2[j] += err * f.h[j];
          var dh = err * this.W2[j] * (1 - f.h[j] * f.h[j]);
          gb1[j] += dh;
          for (var k2 = 0; k2 < this.nIn; k2++) gW1[k2][j] += dh * X[i][k2];
        }
      }
      for (j = 0; j < this.nH; j++) {
        this.W2[j] -= lr * gW2[j] / n;
        this.b1[j] -= lr * gb1[j] / n;
        for (i = 0; i < this.nIn; i++) this.W1[i][j] -= lr * gW1[i][j] / n;
      }
      this.b2 -= lr * gb2 / n;
      hist.push(loss / n);
    }
    this.lossHist = hist;
    return hist;
  };

  /* =====================================================
     3. 特征工程（模型 B/C 共用）
        lag / 滚动统计 / 日历 / 协变量 / 事件编码 / 间开标记
     ===================================================== */
  var FEAT_NAMES = ["lag1", "lag7", "lag30", "roll7均", "roll30均", "roll7σ",
    "月sin", "月cos", "含水", "油压", "注水", "事件热度", "间开", "偏置"];
  var NF = FEAT_NAMES.length;

  function evHeat(events, t) {
    /* 事件热度：越靠近事件越高，指数衰减，无事件为 0 */
    var h = 0;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (t >= e.t) h += Math.exp(-(t - e.t) / 90);
    }
    return h;
  }

  function featRow(w, t, withEvents) {
    var q = w.q, i;
    function lag(k) { return q[t - k] !== undefined ? q[t - k] : q[0]; }
    function rollMean(k) {
      var s = 0, c = 0;
      for (i = t - k; i < t; i++) { if (i >= 0 && q[i] > 0) { s += q[i]; c++; } }
      return c ? s / c : q[0];
    }
    function rollStd(k) {
      var s = 0, s2 = 0, c = 0;
      for (i = t - k; i < t; i++) { if (i >= 0 && q[i] > 0) { s += q[i]; s2 += q[i] * q[i]; c++; } }
      if (c < 2) return 0;
      var m = s / c;
      return Math.sqrt(Math.max(0, s2 / c - m * m));
    }
    var ph = 2 * Math.PI * ((t % 365) / 365);
    return [
      lag(1), lag(7), lag(30),
      rollMean(7), rollMean(30), rollStd(7),
      Math.sin(ph), Math.cos(ph),
      w.wc[t], w.op[t], w.inj[t] / 100,
      withEvents ? evHeat(w.events, t) : 0,
      w.shut[t], 1
    ];
  }

  function buildMatrix(w, from, to, withEvents) {
    var X = [], y = [], t;
    for (t = from; t < to; t++) { X.push(featRow(w, t, withEvents)); y.push(w.q[t]); }
    return { X: X, y: y };
  }

  function scalerOf(X) {
    var m = X[0].length, mu = [], sd = [];
    for (var j = 0; j < m; j++) {
      var col = [];
      for (var i = 0; i < X.length; i++) col.push(X[i][j]);
      var s = std(col);
      if (!s) { mu.push(0); sd.push(1); }   /* 常数列（如偏置）原样保留，不清零 */
      else { mu.push(mean(col)); sd.push(s); }
    }
    return { mu: mu, sd: sd };
  }
  function applyScaler(sc, row) {
    var r = [];
    for (var j = 0; j < row.length; j++) r.push((row[j] - sc.mu[j]) / sc.sd[j]);
    return r;
  }

  /* =====================================================
     4. 滚动原点预测（walk-forward）+ 80% 预测区间
     ===================================================== */
  function walkForward(w, opts) {
    opts = opts || {};
    var H = opts.H || 30;
    var trainLen = opts.trainLen || 360;
    var nOrigins = opts.nOrigins || 6;
    var step = opts.step || 30;
    var mlpEpochs = opts.mlpEpochs || 90;
    var withEvents = opts.withEvents !== false;
    var models = opts.models || ["arps", "ridge", "mlp"];

    var origins = [];
    var start = trainLen;
    while (origins.length < nOrigins && start + H <= w.N) {
      origins.push(start);
      start += step;
    }

    var res = { H: H, origins: origins, per: {} };
    models.forEach(function (m) { res.per[m] = []; });

    origins.forEach(function (t0, oi) {
      var from = t0 - trainLen;
      var pred = { arps: null, ridge: null, mlp: null };

      if (models.indexOf("arps") >= 0) {
        /* Arps 只拟合近 120 天：对递减动态变化（如含水加速）更自适应，
           但措施跳变仍会破坏指数假设——这正是要演示的差异 */
        var fitFrom = Math.max(from, t0 - 120);
        var fit = arpsFit(w.q, fitFrom, t0);
        pred.arps = arpsPredict(fit, t0, t0 + H);
        res.per.arps.push({ t0: t0, pred: pred.arps, actual: w.q.slice(t0, t0 + H) });
      }
      if (models.indexOf("ridge") >= 0 || models.indexOf("mlp") >= 0) {
        var tr = buildMatrix(w, from, t0, withEvents);
        var sc = scalerOf(tr.X);
        var Xs = tr.X.map(function (r) { return applyScaler(sc, r); });
        if (models.indexOf("ridge") >= 0) {
          var wr = ridgeFit(Xs, tr.y, 3.0);
          var pr = [];
          for (var h = 0; h < H; h++) {
            var row = applyScaler(sc, featRow(w, t0 + h, withEvents));
            var s = 0;
            for (var j = 0; j < NF; j++) s += wr[j] * row[j];
            pr.push(Math.max(0.1, s));
          }
          res.per.ridge.push({ t0: t0, pred: pr, actual: w.q.slice(t0, t0 + H) });
        }
        if (models.indexOf("mlp") >= 0) {
          var net = new MLP(NF, 7, 7 + oi * 13);
          var lrHist = net.train(Xs, tr.y, mlpEpochs, 0.06);
          var pm = [];
          for (var h2 = 0; h2 < H; h2++) {
            var row2 = applyScaler(sc, featRow(w, t0 + h2, withEvents));
            pm.push(Math.max(0.1, net.predict(row2)));
          }
          res.per.mlp.push({ t0: t0, pred: pm, actual: w.q.slice(t0, t0 + H), loss: lrHist });
        }
      }
    });

    /* 汇总：MAPE / 偏差 / 残差分位数区间 */
    res.stats = {};
    models.forEach(function (m) {
      var runs = res.per[m];
      if (!runs.length) return;
      var ape = [], errs = [];
      runs.forEach(function (r) {
        for (var h = 0; h < r.pred.length; h++) {
          var a = r.actual[h];
          if (a > 0.3) { ape.push(Math.abs(r.pred[h] - a) / a); errs.push(r.pred[h] - a); }
        }
      });
      res.stats[m] = {
        mape: mean(ape) * 100,
        bias: mean(errs),
        apeAll: ape,
        resid: errs
      };
    });
    /* 区间：用最优模型（MAPE 最低）的残差分位数，随步长 sqrt 放宽 */
    var best = null, bestM = 1e9;
    models.forEach(function (m) {
      if (res.stats[m] && res.stats[m].mape < bestM) { bestM = res.stats[m].mape; best = m; }
    });
    res.best = best;
    /* 区间：按预测步长 h 实测残差 10%/90% 分位数（5 点平滑），
       不假设增长形状——越远越宽是数据说了算，不是拍出来的。
       残差口径统一为 actual − pred，与绘制/覆盖率检查同向 */
    var loByH = [], hiByH = [];
    for (var hb = 0; hb < H; hb++) {
      var rsb = [];
      res.per[best].forEach(function (r) { if (hb < r.pred.length) rsb.push(r.actual[hb] - r.pred[hb]); });
      rsb.sort(function (a, b) { return a - b; });
      loByH.push(rsb.length ? quantile(rsb, 0.10) : 0);
      hiByH.push(rsb.length ? quantile(rsb, 0.90) : 0);
    }
    function smooth3(arr) {
      var out = [];
      for (var i2 = 0; i2 < arr.length; i2++) {
        var s2 = 0, c2 = 0;
        for (var k2 = -1; k2 <= 1; k2++) { var jj = i2 + k2; if (jj >= 0 && jj < arr.length) { s2 += arr[jj]; c2++; } }
        out.push(s2 / c2);
      }
      return out;
    }
    loByH = smooth3(loByH); hiByH = smooth3(hiByH);
    res.bandAt = function (h) {
      var i3 = clamp(Math.round(h), 0, H - 1);
      return { lo: loByH[i3], hi: hiByH[i3] };
    };
    res.band = { lo: loByH[0], hi: hiByH[0] };
    return res;
  }

  /* 单原点的一次预测（屏 2 主图用：最后一个原点展开未来 H 天） */
  function forecastHorizon(w, t0, H, model, withEvents) {
    var from = Math.max(0, t0 - 360);
    if (model === "arps") {
      var fit = arpsFit(w.q, from, t0);
      return arpsPredict(fit, t0, t0 + H);
    }
    var tr = buildMatrix(w, from, t0, withEvents);
    var sc = scalerOf(tr.X);
    var Xs = tr.X.map(function (r) { return applyScaler(sc, r); });
    var out = [];
    if (model === "ridge") {
      var wr = ridgeFit(Xs, tr.y, 3.0);
      for (var h = 0; h < H; h++) {
        var row = applyScaler(sc, featRow(w, t0 + h, withEvents));
        var s = 0;
        for (var j = 0; j < NF; j++) s += wr[j] * row[j];
        out.push(Math.max(0.1, s));
      }
    } else {
      var net = new MLP(NF, 7, 7);
      net.train(Xs, tr.y, 90, 0.06);
      for (var h2 = 0; h2 < H; h2++) {
        var row2 = applyScaler(sc, featRow(w, t0 + h2, withEvents));
        out.push(Math.max(0.1, net.predict(row2)));
      }
    }
    return out;
  }

  /* =====================================================
     5. 措施归因（中断时间序列 ITS）—— 两种口径对比
     mode = 'its'（正确）：只用事件前 preLen 天训练，预测事件后
             horizon 天时屏蔽事件特征 → 反事实；增量 = 实际 − 反事实
     mode = 'naive'（错误示范）：训练段包含事件后数据、事件特征全开，
             模型把措施增量学进预测 → 增量被吞掉 ≈ 0
     ===================================================== */
  function attribution(w, evIdx, opts) {
    opts = opts || {};
    var mode = opts.mode || "its";
    var preLen = opts.preLen || 120;
    var horizon = opts.horizon || 60;
    var ev = w.events[evIdx];
    if (!ev) return null;
    var t0 = ev.t;
    var tEnd = Math.min(w.N, t0 + horizon);
    horizon = tEnd - t0;
    var from = Math.max(0, t0 - preLen);
    /* its：训练窗停在事件前；naive：训练窗覆盖事件后（泄露） */
    var trainTo = mode === "its" ? t0 : tEnd;
    var withEv = mode === "its" ? false : true;
    var tr = buildMatrix(w, from, trainTo, withEv);
    var sc = scalerOf(tr.X);
    var Xs = tr.X.map(function (r) { return applyScaler(sc, r); });
    var wr = ridgeFit(Xs, tr.y, 3.0);
    var cf = [];
    for (var h = 0; h < horizon; h++) {
      var row = applyScaler(sc, featRow(w, t0 + h, withEv));
      var s = 0;
      for (var j = 0; j < NF; j++) s += wr[j] * row[j];
      cf.push(Math.max(0.1, s));
    }
    var actual = w.q.slice(t0, tEnd);
    var inc = [], resid = [];
    for (var i = 0; i < horizon; i++) {
      inc.push(actual[i] - cf[i]);
      resid.push(cf[i] - actual[i]);
    }
    var sd = std(resid) || 0.5;
    var m = mean(inc);
    /* 增量区间：平均日增量的 80% 区间 ≈ m ± 1.28·sd/√H */
    var half = 1.28 * sd / Math.sqrt(Math.max(1, horizon));
    return {
      ev: ev, t0: t0, horizon: horizon, mode: mode,
      cf: cf, actual: actual, inc: inc,
      gain: m, gainLo: m - half, gainHi: m + half,
      bandLo: function (h) { return cf[h] - sd * 0.8 * Math.sqrt(1 + h / 14); },
      bandHi: function (h) { return cf[h] + sd * 0.8 * Math.sqrt(1 + h / 14); },
      sd: sd
    };
  }

  /* =====================================================
     6. SVG 绘图助手
     ===================================================== */
  function svgOpen(w2, h2, label) {
    return '<svg viewBox="0 0 ' + w2 + " " + h2 + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + esc(label) + '" style="width:100%;height:auto;display:block">';
  }
  function pathOf(pts, close) {
    var d = "";
    for (var i = 0; i < pts.length; i++) d += (i ? "L" : "M") + pts[i][0].toFixed(1) + " " + pts[i][1].toFixed(1);
    return close ? d + "Z" : d;
  }
  function bandPath(upper, lower) {
    /* upper/lower: [[x,y]...] 同长，合成闭合带 */
    var d = pathOf(upper);
    for (var i = lower.length - 1; i >= 0; i--) d += "L" + lower[i][0].toFixed(1) + " " + lower[i][1].toFixed(1);
    return d + "Z";
  }

  /* 主图坐标系：给定天数范围与产量上界 */
  function makeScale(W, H, L, R, T, B, nDays, qMax) {
    var x = function (t) { return L + (t / nDays) * (W - L - R); };
    var y = function (v) { return T + (1 - clamp(v / qMax, 0, 1)) * (H - T - B); };
    return { x: x, y: y };
  }

  /* =====================================================
     7. 状态
     ===================================================== */
  var state = {
    wellKey: "frac",
    days: 720,
    H: 30,
    withEvents: true,
    selWellIdx: 0,
    busy: false,
    cache: {}
  };
  var BATCH_KEYS = ["frac", "water", "waterplug", "stable", "shutin", "young"];

  function curWell() { return genWell(WELL_PRESETS[state.wellKey], state.days); }

  /* =====================================================
     8. 渲染 · 屏 1
     ===================================================== */
  function renderSim() {
    var w = curWell();
    var qMax = 0;
    for (var i = 0; i < w.N; i++) qMax = Math.max(qMax, w.base[i] + w.jump[i]);
    qMax *= 1.18;

    /* --- 主曲线：日度产量 --- */
    var W = 660, H = 240, L = 40, R = 14, T = 16, B = 26;
    var sc = makeScale(W, H, L, R, T, B, w.N, qMax);
    var s = svgOpen(W, H, "单井日度产量曲线");
    /* 网格 + 月份刻度 */
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      var yy = sc.y(qMax * f);
      s += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '" stroke="#efece1"/>';
      s += '<text x="' + (L - 6) + '" y="' + (yy + 3) + '" font-size="9.5" fill="#9ba3a9" text-anchor="end" font-family="monospace">' + fmt(qMax * f, 0) + "</text>";
    });
    for (var m2 = 0; m2 <= 24; m2 += 3) {
      var xx = sc.x(m2 * 30);
      s += '<text x="' + xx + '" y="' + (H - 8) + '" font-size="9.5" fill="#9ba3a9" text-anchor="middle" font-family="monospace">' + m2 + "月</text>";
      s += '<line x1="' + xx + '" y1="' + T + '" x2="' + xx + '" y2="' + (H - B) + '" stroke="#f4f1e8"/>';
    }
    /* 措施事件标注 */
    w.events.forEach(function (ev) {
      var ex = sc.x(ev.t);
      s += '<line x1="' + ex + '" y1="' + T + '" x2="' + ex + '" y2="' + (H - B) + '" stroke="#b26a39" stroke-width="1.3" stroke-dasharray="5 3"/>';
      s += '<text x="' + (ex + 4) + '" y="' + (T + 11) + '" font-size="9.5" fill="#b26a39" font-family="monospace">▼ ' + ev.type + '</text>';
    });
    /* 产量曲线 */
    var pts = [];
    for (var t = 0; t < w.N; t++) pts.push([sc.x(t), sc.y(w.q[t])]);
    s += '<path d="' + pathOf(pts) + '" fill="none" stroke="#242b2e" stroke-width="1.1" stroke-linejoin="round"/>';
    s += '<text x="' + (W - R) + '" y="' + (T + 11) + '" font-size="9.5" fill="#9ba3a9" text-anchor="end" font-family="monospace">日产油 t/d · 720 天</text>';
    s += "</svg>";
    el("simChart").innerHTML = s;

    /* --- 成分分解：堆叠面积 --- */
    var W2 = 660, H2 = 200;
    var sc2 = makeScale(W2, H2, L, R, T, B, w.N, qMax);
    var s2 = svgOpen(W2, H2, "产量曲线成分分解");
    [0, 0.5, 1].forEach(function (f) {
      var yy = sc2.y(qMax * f);
      s2 += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W2 - R) + '" y2="' + yy + '" stroke="#efece1"/>';
      s2 += '<text x="' + (L - 6) + '" y="' + (yy + 3) + '" font-size="9.5" fill="#9ba3a9" text-anchor="end" font-family="monospace">' + fmt(qMax * f, 0) + "</text>";
    });
    /* 基线（玉色面积） */
    var pb = [];
    for (var t2 = 0; t2 < w.N; t2++) pb.push([sc2.x(t2), sc2.y(w.base[t2])]);
    var pbClose = pb.slice(); pbClose.push([sc2.x(w.N - 1), sc2.y(0)]); pbClose.push([sc2.x(0), sc2.y(0)]);
    s2 += '<path d="' + pathOf(pbClose, true) + '" fill="#e6f1ec" stroke="#2f7d6b" stroke-width="1.2"/>';
    /* 措施增量（陶土色面积，叠在基线上） */
    var pj = [];
    for (var t3 = 0; t3 < w.N; t3++) pj.push([sc2.x(t3), sc2.y(w.base[t3] + w.jump[t3])]);
    var pjDown = [];
    for (var t4 = w.N - 1; t4 >= 0; t4--) pjDown.push([sc2.x(t4), sc2.y(w.base[t4])]);
    s2 += '<path d="' + pathOf(pj) + "L" + pathOf(pjDown).slice(1) + 'Z" fill="#f8ecdf" stroke="#b26a39" stroke-width="1.1" stroke-dasharray="4 2"/>';
    /* 合成曲线（黑线） */
    var pq = [];
    for (var t5 = 0; t5 < w.N; t5++) pq.push([sc2.x(t5), sc2.y(w.q[t5])]);
    s2 += '<path d="' + pathOf(pq) + '" fill="none" stroke="#242b2e" stroke-width="1" opacity=".85"/>';
    /* 事件线 */
    w.events.forEach(function (ev2) {
      var ex2 = sc2.x(ev2.t);
      s2 += '<line x1="' + ex2 + '" y1="' + T + '" x2="' + ex2 + '" y2="' + (H2 - B) + '" stroke="#b26a39" stroke-width="1.2" stroke-dasharray="5 3"/>';
    });
    /* 图例 */
    s2 += '<rect x="' + (L + 8) + '" y="' + (T + 4) + '" width="196" height="52" rx="5" fill="#ffffff" stroke="#e9e4d8" opacity=".92"/>';
    s2 += '<rect x="' + (L + 16) + '" y="' + (T + 12) + '" width="18" height="8" fill="#e6f1ec" stroke="#2f7d6b" stroke-width="1"/>';
    s2 += '<text x="' + (L + 40) + '" y="' + (T + 19) + '" font-size="9.5" fill="#4d565b">基线递减（含水越高降越快）</text>';
    s2 += '<rect x="' + (L + 16) + '" y="' + (T + 26) + '" width="18" height="8" fill="#f8ecdf" stroke="#b26a39" stroke-width="1"/>';
    s2 += '<text x="' + (L + 40) + '" y="' + (T + 33) + '" font-size="9.5" fill="#4d565b">措施增量（压裂/堵水/换泵台阶）</text>';
    s2 += '<line x1="' + (L + 16) + '" y1="' + (T + 43) + '" x2="' + (L + 34) + '" y2="' + (T + 43) + '" stroke="#242b2e" stroke-width="1.4"/>';
    s2 += '<text x="' + (L + 40) + '" y="' + (T + 46) + '" font-size="9.5" fill="#4d565b">合成日产量（叠加季节项与噪声后）</text>';
    s2 += "</svg>";
    el("decompChart").innerHTML = s2;

    /* 读数 */
    var evTxt = w.events.length ? w.events.map(function (e) { return e.type + "@" + e.t + "d"; }).join("，") : "无";
    var last30 = mean(w.q.slice(w.N - 30));
    el("roD0").textContent = fmt(w.cfg.q0, 1);
    el("roD1").textContent = (w.cfg.d * 1000).toFixed(2) + " ‰/d";
    el("roEv").textContent = evTxt;
    el("roWc").textContent = fmt(w.wc[w.N - 1] * 100, 0) + "%";
    el("ro30").textContent = fmt(last30, 2) + " t/d";
    el("roNoise").textContent = "±" + fmt(w.cfg.sigma, 1);
  }

  /* =====================================================
     9. 渲染 · 屏 2（三个模型 walk-forward 对比）
     ===================================================== */
  var MODEL_META = {
    arps: { name: "A · Arps 递减", color: "#79828a", dash: "" },
    ridge: { name: "B · 岭回归+特征", color: "#41699b", dash: "" },
    mlp: { name: "C · 微型 MLP", color: "#7e5a8d", dash: "6 3" }
  };

  function renderForecast() {
    var w = curWell();
    var t0 = w.N - state.H;            /* 最后一个滚动原点：用全部历史预测未来 H 天 */
    var H = state.H;
    var qMax = 0;
    for (var i = 0; i < w.N; i++) qMax = Math.max(qMax, w.q[i]);
    qMax *= 1.2;

    /* walk-forward 全量（得 MAPE 与残差区间） */
    var wf = walkForward(w, { H: H, trainLen: 360, nOrigins: 10, step: 20, mlpEpochs: 70, withEvents: state.withEvents });
    state.cache.wf = wf;

    /* 主图：历史尾段 240 天 + 实际（到 t0）+ 三模型预测 H 天 + 区间 */
    var W = 660, Hh = 250, L = 40, R = 14, T = 16, B = 26;
    var viewDays = 240 + H;
    var tFrom = w.N - viewDays;
    var sc = makeScale(W, Hh, L, R, T, B, viewDays, qMax);
    var x = function (t) { return sc.x(t - tFrom); };
    var y = sc.y;
    var s = svgOpen(W, Hh, "滚动预测与预测区间");
    [0, 0.5, 1].forEach(function (f) {
      var yy = y(qMax * f);
      s += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '" stroke="#efece1"/>';
      s += '<text x="' + (L - 6) + '" y="' + (yy + 3) + '" font-size="9.5" fill="#9ba3a9" text-anchor="end" font-family="monospace">' + fmt(qMax * f, 0) + "</text>";
    });
    /* 「今天」分界线 */
    s += '<line x1="' + x(t0) + '" y1="' + T + '" x2="' + x(t0) + '" y2="' + (Hh - B) + '" stroke="#c9c2b0" stroke-width="1.2"/>';
    s += '<text x="' + (x(t0) + 4) + '" y="' + (T + 11) + '" font-size="9.5" fill="#79828a" font-family="monospace">今天 · 滚动原点</text>';
    /* 事件线（预测窗附近） */
    w.events.forEach(function (ev) {
      if (ev.t >= tFrom) {
        s += '<line x1="' + x(ev.t) + '" y1="' + T + '" x2="' + x(ev.t) + '" y2="' + (Hh - B) + '" stroke="#b26a39" stroke-width="1" stroke-dasharray="4 3" opacity=".7"/>';
      }
    });
    /* 历史 */
    var ph = [];
    for (var t = tFrom; t <= t0; t++) ph.push([x(t), y(w.q[t])]);
    s += '<path d="' + pathOf(ph) + '" fill="none" stroke="#242b2e" stroke-width="1.2"/>';
    /* 未来实际（演示数据里可见，标为"实际"供对照） */
    var pa = [];
    for (var t2 = t0; t2 <= w.N - 1; t2++) pa.push([x(t2), y(w.q[t2])]);
    s += '<path d="' + pathOf(pa) + '" fill="none" stroke="#2f7d6b" stroke-width="2.2"/>';

    /* 三模型预测（从最后一个原点前推 H 天） */
    ["arps", "ridge", "mlp"].forEach(function (m) {
      var meta = MODEL_META[m];
      var pred = forecastHorizon(w, t0, H, m, state.withEvents);
      state.cache["pred_" + m] = pred;
      var pp = [];
      for (var h = 0; h < H; h++) pp.push([x(t0 + h), y(pred[h])]);
      s += '<path d="' + pathOf(pp) + '" fill="none" stroke="' + meta.color + '" stroke-width="1.8"' +
        (meta.dash ? ' stroke-dasharray="' + meta.dash + '"' : "") + "/>";
    });
    /* 末端标签防重叠：按 y 排序后强制最小间距 11px，整体不越界 */
    var labels = [
      { y: y(w.q[w.N - 1]) + 13, text: "实际（事后可见）", color: "#2f7d6b" }
    ];
    ["arps", "ridge", "mlp"].forEach(function (m) {
      var pred = state.cache["pred_" + m];
      labels.push({ y: y(pred[H - 1]) - 6, text: MODEL_META[m].name, color: MODEL_META[m].color });
    });
    labels.sort(function (a, b) { return a.y - b.y; });
    for (var li = 1; li < labels.length; li++) {
      if (labels[li].y - labels[li - 1].y < 11) labels[li].y = labels[li - 1].y + 11;
    }
    var over = labels[labels.length - 1].y - (Hh - 12);
    if (over > 0) labels.forEach(function (l) { l.y -= over; });
    labels.forEach(function (l) {
      s += '<text x="' + (x(t0 + H - 1)) + '" y="' + l.y + '" font-size="9.5" fill="' + l.color + '" text-anchor="end" font-family="monospace">' + l.text + "</text>";
    });
    /* 区间（最优模型，按步长实测分位数 → 越远越宽） */
    var best = wf.best;
    var up = [], dn = [];
    for (var h2 = 0; h2 < H; h2++) {
      var bd = wf.bandAt(h2);
      up.push([x(t0 + h2), y(state.cache["pred_" + best][h2] + bd.hi)]);
      dn.push([x(t0 + h2), y(state.cache["pred_" + best][h2] + bd.lo)]);
    }
    s += '<path d="' + bandPath(up, dn) + '" fill="#41699b" opacity=".13"/>';
    s += '<text x="' + (W - R) + '" y="' + (Hh - 8) + '" font-size="9.5" fill="#9ba3a9" text-anchor="end" font-family="monospace">日产油 t/d · 未来 ' + H + ' 天（蓝色带 = 80% 区间）</text>';
    s += "</svg>";
    el("fcChart").innerHTML = s;

    /* MAPE 对比条形图 */
    var W3 = 300, H3 = 130;
    var s3 = svgOpen(W3, H3, "三个模型 MAPE 对比");
    var order = ["arps", "ridge", "mlp"];
    var maxM = 0;
    order.forEach(function (m) { if (wf.stats[m]) maxM = Math.max(maxM, wf.stats[m].mape); });
    maxM = Math.max(maxM, 1);
    order.forEach(function (m, i) {
      var st = wf.stats[m];
      if (!st) return;
      var bw = (st.mape / maxM) * 136;
      var yy = 18 + i * 34;
      s3 += '<text x="0" y="' + (yy + 4) + '" font-size="10" fill="#4d565b">' + MODEL_META[m].name + "</text>";
      s3 += '<rect x="118" y="' + (yy - 7) + '" width="' + Math.max(2, bw) + '" height="15" rx="3" fill="' + MODEL_META[m].color + '" opacity=".85"/>';
      s3 += '<text x="' + (124 + Math.max(2, bw)) + '" y="' + (yy + 4) + '" font-size="10.5" font-weight="700" fill="' + MODEL_META[m].color + '" font-family="monospace">' + fmt(st.mape, 2) + "%</text>";
    });
    s3 += '<text x="0" y="' + (H3 - 6) + '" font-size="9.5" fill="#9ba3a9">滚动原点验证 MAPE（10 个原点 × ' + H + ' 天，越低越好）</text>';
    s3 += "</svg>";
    el("mapeChart").innerHTML = s3;

    /* MLP 训练损失曲线 */
    var lastRun = wf.per.mlp[wf.per.mlp.length - 1];
    var W4 = 300, H4 = 130;
    var s4 = svgOpen(W4, H4, "MLP 训练损失曲线");
    if (lastRun && lastRun.loss) {
      var lh = lastRun.loss;
      var lMax = Math.max.apply(null, lh);
      var lp = [];
      for (var li = 0; li < lh.length; li++) {
        lp.push([li / (lh.length - 1) * (W4 - 46) + 40, 16 + (1 - lh[li] / lMax) * (H4 - 40)]);
      }
      s4 += '<line x1="40" y1="' + (H4 - 24) + '" x2="' + (W4 - 6) + '" y2="' + (H4 - 24) + '" stroke="#efece1"/>';
      s4 += '<path d="' + pathOf(lp) + '" fill="none" stroke="#7e5a8d" stroke-width="1.6"/>';
      s4 += '<text x="40" y="12" font-size="9.5" fill="#7e5a8d" font-family="monospace">MSE ' + fmt(lh[0], 2) + " → " + fmt(lh[lh.length - 1], 3) + "</text>";
      s4 += '<text x="' + (W4 - 6) + '" y="' + (H4 - 6) + '" font-size="9.5" fill="#9ba3a9" text-anchor="end">epoch →（全批量梯度下降）</text>';
    }
    s4 += "</svg>";
    el("lossChart").innerHTML = s4;

    /* 指标卡 */
    var stA = wf.stats.arps, stB = wf.stats.ridge, stC = wf.stats.mlp;
    el("mA").textContent = fmt(stA.mape, 2) + "%";
    el("mB").textContent = fmt(stB.mape, 2) + "%";
    el("mC").textContent = fmt(stC.mape, 2) + "%";
    el("mBest").textContent = MODEL_META[wf.best].name.replace(" · ", "·");
    el("mBias").textContent = fmt(wf.stats[wf.best].bias, 2) + " t/d";
    el("mBand").textContent = "±" + fmt(Math.max(Math.abs(wf.band.lo), Math.abs(wf.band.hi)), 2) + " t/d";
    setTip("fcTip");
  }

  /* =====================================================
     10. 渲染 · 屏 3（批量验证 + 归因）
     ===================================================== */
  function renderBatch() {
    var rows = [];
    var sumMape = { arps: [], ridge: [], mlp: [] };
    var covers = { arps: 0, ridge: 0, mlp: 0 }, totals = { arps: 0, ridge: 0, mlp: 0 };
    BATCH_KEYS.forEach(function (k) {
      var w = genWell(WELL_PRESETS[k], state.days);
      var wf = walkForward(w, { H: 30, trainLen: 300, nOrigins: 6, step: 30, mlpEpochs: 50, withEvents: state.withEvents });
      var row = { key: k, name: WELL_PRESETS[k].name, wf: wf, q: w.q.slice(w.N - 60) };
      ["arps", "ridge", "mlp"].forEach(function (m) {
        sumMape[m].push(wf.stats[m].mape);
        wf.per[m].forEach(function (r) {
          for (var h = 0; h < r.pred.length; h++) {
            totals[m]++;
            var bd2 = wf.bandAt(h);
            var loB = r.pred[h] + bd2.lo, hiB = r.pred[h] + bd2.hi;
            if (r.actual[h] >= loB && r.actual[h] <= hiB) covers[m]++;
          }
        });
      });
      rows.push(row);
    });
    state.cache.batch = rows;

    /* 每口井一行：迷你曲线 + 三个 MAPE */
    var W = 660;
    var rowH = 44;
    var H = rows.length * rowH + 30;
    var s = svgOpen(W, H, "批量井预测误差汇总");
    rows.forEach(function (r, i) {
      var yy = 14 + i * rowH;
      s += '<text x="0" y="' + (yy + 10) + '" font-size="10" fill="#4d565b">' + r.name + "</text>";
      /* 迷你产量曲线（尾段 60 天） */
      var mx = 78, mw = 130, mh = 26;
      var qm = Math.max.apply(null, r.q) * 1.15 || 1;
      var mp = [];
      for (var t = 0; t < r.q.length; t++) mp.push([mx + t / (r.q.length - 1) * mw, yy + mh - (r.q[t] / qm) * mh]);
      s += '<path d="' + pathOf(mp) + '" fill="none" stroke="#242b2e" stroke-width="1"/>';
      s += '<text x="0" y="' + (yy + 24) + '" font-size="8.5" fill="#9ba3a9" font-family="monospace">尾段 60d</text>';
      /* 三个 MAPE 小条 */
      ["arps", "ridge", "mlp"].forEach(function (m, j) {
        var bx = 230 + j * 145;
        var v = r.wf.stats[m].mape;
        var bw = clamp(v / 20, 0.02, 1) * 92;
        s += '<text x="' + bx + '" y="' + (yy + 10) + '" font-size="9.5" fill="' + MODEL_META[m].color + '">' + MODEL_META[m].name.split(" · ")[1] + "</text>";
        s += '<rect x="' + bx + '" y="' + (yy + 14) + '" width="' + bw + '" height="9" rx="2" fill="' + MODEL_META[m].color + '" opacity=".8"/>';
        s += '<text x="' + (bx + 96) + '" y="' + (yy + 22) + '" font-size="9.5" fill="' + MODEL_META[m].color + '" font-family="monospace">' + fmt(v, 1) + "%</text>";
      });
    });
    s += '<text x="0" y="' + (H - 8) + '" font-size="9.5" fill="#9ba3a9">MAPE（%）：A Arps / B 岭回归 / C MLP · 滚动原点 6×30 天 · 事件编码' + (state.withEvents ? "开" : "关") + "</text>";
    s += "</svg>";
    el("batchChart").innerHTML = s;

    /* 汇总卡 */
    var avg = { arps: mean(sumMape.arps), ridge: mean(sumMape.ridge), mlp: mean(sumMape.mlp) };
    var bestAvg = null, bv = 1e9;
    ["arps", "ridge", "mlp"].forEach(function (m) { if (avg[m] < bv) { bv = avg[m]; bestAvg = m; } });
    var cov = covers[bestAvg] / totals[bestAvg];
    el("bAvg").textContent = fmt(avg[bestAvg], 2) + "%";
    el("bAvgName").textContent = MODEL_META[bestAvg].name;
    el("bCov").textContent = fmt(cov * 100, 0) + "%";
    el("bArps").textContent = fmt(avg.arps, 1) + "%";
    el("bRidge").textContent = fmt(avg.ridge, 1) + "%";
    el("bMlp").textContent = fmt(avg.mlp, 1) + "%";

    renderAttr();
  }

  /* --- 措施归因面板 --- */
  function renderAttr() {
    var w = curWell();
    var evIdx = w.events.length ? 0 : -1;
    if (evIdx < 0) {
      /* 没有事件的井：注入一个示例事件用于演示 */
      w = genWell(Object.assign({}, WELL_PRESETS[state.wellKey], {
        events: [{ t: 360, type: "压裂", amp: 0.5, tau: 500 }]
      }), state.days);
      evIdx = 0;
    }
    /* 两种口径：its = 反事实（只用事件前数据训练，屏蔽事件特征）；
       naive = 错误示范（训练段包含事件后数据，事件特征全开 → 增量被吞） */
    var its = attribution(w, evIdx, { mode: "its", preLen: 120, horizon: 60 });
    var naive = attribution(w, evIdx, { mode: "naive", preLen: 120, horizon: 60 });
    state.cache.attr = { its: its, naive: naive, w: w, evIdx: evIdx };

    var t0 = its.t0, H = its.horizon;
    var tFrom = Math.max(0, t0 - 90);
    var viewDays = (w.N - 1 - tFrom);
    var qMax = 0;
    for (var i = tFrom; i < w.N; i++) qMax = Math.max(qMax, w.q[i]);
    qMax *= 1.15;
    var W = 660, Hh = 230, L = 40, R = 14, T = 16, B = 26;
    var sc = makeScale(W, Hh, L, R, T, B, viewDays, qMax);
    var x = function (t) { return sc.x(t - tFrom); };
    var y = sc.y;
    var s = svgOpen(W, Hh, "措施归因：实际与反事实对比");
    [0, 0.5, 1].forEach(function (f) {
      var yy = y(qMax * f);
      s += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '" stroke="#efece1"/>';
      s += '<text x="' + (L - 6) + '" y="' + (yy + 3) + '" font-size="9.5" fill="#9ba3a9" text-anchor="end" font-family="monospace">' + fmt(qMax * f, 0) + "</text>";
    });
    /* 事件线 */
    s += '<line x1="' + x(t0) + '" y1="' + T + '" x2="' + x(t0) + '" y2="' + (Hh - B) + '" stroke="#b26a39" stroke-width="1.4"/>';
    s += '<text x="' + (x(t0) + 4) + '" y="' + (T + 11) + '" font-size="9.5" fill="#b26a39" font-family="monospace">▼ ' + its.ev.type + '（' + t0 + ' d）</text>';
    /* 历史 */
    var ph = [];
    for (var t = tFrom; t <= t0; t++) ph.push([x(t), y(w.q[t])]);
    s += '<path d="' + pathOf(ph) + '" fill="none" stroke="#242b2e" stroke-width="1.2"/>';
    /* 反事实预测 + 区间（its：屏蔽事件特征） */
    var up = [], dn = [], cf = [];
    for (var h = 0; h < H; h++) {
      cf.push([x(t0 + h), y(its.cf[h])]);
      up.push([x(t0 + h), y(its.bandHi(h))]);
      dn.push([x(t0 + h), y(its.bandLo(h))]);
    }
    s += '<path d="' + bandPath(up, dn) + '" fill="#41699b" opacity=".14"/>';
    s += '<path d="' + pathOf(cf) + '" fill="none" stroke="#41699b" stroke-width="1.8" stroke-dasharray="6 3"/>';
    s += '<text x="' + (x(t0 + H - 1)) + '" y="' + (y(its.cf[H - 1]) - 7) + '" font-size="9.5" fill="#41699b" text-anchor="end" font-family="monospace">反事实（假设没这次措施）</text>';
    /* naive 口径：训练见过事件 → 预测贴着实际走（增量被吞） */
    var nv = [];
    for (var h2 = 0; h2 < H; h2++) nv.push([x(t0 + h2), y(naive.cf[h2])]);
    s += '<path d="' + pathOf(nv) + '" fill="none" stroke="#7e5a8d" stroke-width="1.5" stroke-dasharray="2 3"/>';
    s += '<text x="' + (x(t0 + 2)) + '" y="' + (y(naive.cf[2]) - 6) + '" font-size="9.5" fill="#7e5a8d" font-family="monospace">naive 口径（训练含事件后）</text>';
    /* 实际 */
    var pa = [];
    for (var t2 = t0; t2 < t0 + H; t2++) pa.push([x(t2), y(w.q[t2])]);
    s += '<path d="' + pathOf(pa) + '" fill="none" stroke="#2f7d6b" stroke-width="2.2"/>';
    s += '<text x="' + (x(t0 + H - 1)) + '" y="' + (y(w.q[t0 + H - 1]) + 14) + '" font-size="9.5" fill="#2f7d6b" text-anchor="end" font-family="monospace">实际产量</text>';
    /* 增量阴影：实际与反事实之间 */
    var incUp = [], incDn = [];
    for (var h3 = 0; h3 < H; h3++) {
      var a = w.q[t0 + h3], c = its.cf[h3];
      incUp.push([x(t0 + h3), y(Math.max(a, c))]);
      incDn.push([x(t0 + h3), y(Math.min(a, c))]);
    }
    s += '<path d="' + bandPath(incUp, incDn) + '" fill="#b26a39" opacity=".22"/>';
    s += '<text x="' + (x(t0) + 8) + '" y="' + (Hh - 8) + '" font-size="9.5" fill="#b26a39" font-family="monospace">橙色带 = 归因增量（实际 − 反事实）</text>';
    s += '<text x="' + (W - R) + '" y="' + (Hh - 8) + '" font-size="9.5" fill="#9ba3a9" text-anchor="end" font-family="monospace">措施前后 150 天窗口</text>';
    s += "</svg>";
    el("attrChart").innerHTML = s;

    /* 归因读数：两种口径对比 */
    el("atGain").textContent = "+" + fmt(its.gain, 2) + " t/d";
    el("atRange").textContent = "[" + fmt(its.gainLo, 1) + ", " + fmt(its.gainHi, 1) + "]";
    el("atGain2").textContent = "+" + fmt(naive.gain, 2) + " t/d";
    el("atRange2").textContent = "[" + fmt(naive.gainLo, 1) + ", " + fmt(naive.gainHi, 1) + "]";
    var leakPct = its.gain > 0.05 ? (1 - naive.gain / its.gain) * 100 : 0;
    el("atLeak").textContent = fmt(leakPct, 0) + "%";
    setTip("atTip");
  }

  /* =====================================================
     11. 控件与初始化
     ===================================================== */
  function el(id) { return document.getElementById(id); }
  function setTip(id) {
    var node = el(id);
    if (!node) return;
    if (id === "fcTip") {
      var wf = state.cache.wf;
      node.innerHTML = "当前设置：预测步长 <b>" + state.H + "</b> 天，事件编码<b>" + (state.withEvents ? "开" : "关") +
        "</b>。三个模型跑的是同一套滚动原点协议（训练 360 天 → 预测 " + state.H + " 天 → 前移 20 天，共 10 个原点）。" +
        "最优模型 <b>" + MODEL_META[wf.best].name + "</b>（MAPE " + fmt(wf.stats[wf.best].mape, 2) + "%）。" +
        "把<b>事件编码关掉</b>再看一次：措施跳变没有被任何特征告知模型，机器学习模型只能把它当" +
        "「噪声」平滑——这正是归因里要防的坑。";
    } else if (id === "atTip") {
      var a = state.cache.attr;
      node.innerHTML = "中断时间序列（ITS）归因：用<b>措施前 120 天</b>训练，预测措施后 60 天的<b>反事实</b>产量（假设没这次措施），" +
        "实际减反事实即增量，估为 <b>+" + fmt(a.its.gain, 2) + " t/d</b>（80% 区间 [" + fmt(a.its.gainLo, 1) + ", " + fmt(a.its.gainHi, 1) + "]）。" +
        "对照<b>naive 口径</b>（训练段包含事件后数据、事件特征全开）：模型把措施增量学进预测，增量只剩 <b>+" + fmt(a.naive.gain, 2) + " t/d</b>，" +
        "<b>" + fmt((1 - a.naive.gain / Math.max(0.05, a.its.gain)) * 100, 0) + "% 的增产被吞掉</b>——归因必须用反事实口径，不能让模型提前看见答案。";
    }
  }

  /* 井况变了，实验 2/3 用的就是同一口井的序列：顺带把预报与批量也重算。
     重算是「滚动原点 + 反传」级别的开销，拖动时用防抖，松手再算。 */
  var __fcTimer = null;
  function syncDownstream() {
    if (__fcTimer) clearTimeout(__fcTimer);
    __fcTimer = setTimeout(function () {
      __fcTimer = null;
      renderForecast(); renderBatch();
    }, 180);
  }

  function bindControls() {
    var syncFns = [];
    /* 井预设 */
    var box = el("wellPresets");
    Object.keys(WELL_PRESETS).forEach(function (k) {
      var b = document.createElement("button");
      b.className = "pbtn" + (k === state.wellKey ? " on" : "");
      b.textContent = WELL_PRESETS[k].name;
      b.addEventListener("click", function () {
        state.wellKey = k;
        Array.prototype.forEach.call(box.children, function (c) { c.classList.remove("on"); });
        b.classList.add("on");
        syncFns.forEach(function (f) { f(); });   /* 滑杆读数跟随新井参数 */
        renderSim(); renderForecast(); renderBatch();
      });
      box.appendChild(b);
    });

    /* 屏 1 参数滑杆 */
    [["q0", "初始产量", 4, 30, 0.5], ["d", "递减率", 0.4, 6, 0.1],
     ["seasA", "季节幅度", 0, 0.15, 0.01], ["sigma", "噪声", 0.1, 2, 0.1]].forEach(function (sp) {
      var key = sp[0];
      var row = document.createElement("div");
      row.className = "sl";
      row.innerHTML = '<label>' + sp[1] + '<output id="out-' + key + '"></output></label>' +
        '<input type="range" id="in-' + key + '" min="' + sp[2] + '" max="' + sp[3] + '" step="' + sp[4] + '">';
      el("simSliders").appendChild(row);
      var input = row.querySelector("input");
      var out = row.querySelector("output");
      function sync() {
        var p = WELL_PRESETS[state.wellKey];
        input.value = key === "d" ? (p.d * 1000) : p[key];
        out.textContent = key === "d" ? (p.d * 1000).toFixed(2) + "‰" : fmt(p[key], 2);
      }
      input.addEventListener("input", function () {
        var v = Number(input.value);
        WELL_PRESETS[state.wellKey][key] = key === "d" ? v / 1000 : v;
        out.textContent = key === "d" ? v.toFixed(2) + "‰" : fmt(v, 2);
        renderSim(); syncDownstream();
      });
      sync();
      syncFns.push(sync);
    });
    /* 含水滑杆 */
    (function () {
      var row = document.createElement("div");
      row.className = "sl";
      row.innerHTML = '<label>期末含水<output id="out-wc1"></output></label>' +
        '<input type="range" id="in-wc1" min="10" max="95" step="1">';
      el("simSliders").appendChild(row);
      var input = row.querySelector("input");
      var out = row.querySelector("output");
      function sync() {
        var p = WELL_PRESETS[state.wellKey];
        input.value = Math.round(p.wc1 * 100);
        out.textContent = Math.round(p.wc1 * 100) + "%";
      }
      input.addEventListener("input", function () {
        WELL_PRESETS[state.wellKey].wc1 = Number(input.value) / 100;
        out.textContent = input.value + "%";
        renderSim(); syncDownstream();
      });
      sync();
      syncFns.push(sync);
    })();

    /* 屏 2：预测步长 + 事件编码开关 */
    var inH = el("inH");
    inH.addEventListener("input", function () {
      state.H = Number(inH.value);
      el("outH").textContent = state.H + " 天";
      renderForecast();
    });
    var cbEv = el("cbEv");
    cbEv.addEventListener("change", function () {
      state.withEvents = cbEv.checked;
      renderForecast(); renderBatch();
    });

    /* 屏 3：归因面板随井预设联动（renderBatch → renderAttr 已含两种口径） */
  }

  function init() {
    el("outH").textContent = state.H + " 天";
    bindControls();
    renderSim();
    renderForecast();
    renderBatch();
  }

  /* 浏览器端桥接：把模型层与实时状态暴露给「算法解剖」动画模块，
     让动画演示的每一步都跑的是同一份真代码。 */
  var win = (typeof window !== "undefined") ? window : null;
  if (win) win.PfBridge = {
    WELL_PRESETS: WELL_PRESETS, genWell: genWell, FEAT_NAMES: FEAT_NAMES, NF: NF,
    arpsFit: arpsFit, arpsPredict: arpsPredict,
    ridgeFit: ridgeFit, solve: solve, MLP: MLP,
    featRow: featRow, buildMatrix: buildMatrix, scalerOf: scalerOf, applyScaler: applyScaler,
    walkForward: walkForward, forecastHorizon: forecastHorizon, attribution: attribution,
    evHeat: evHeat, mulberry32: mulberry32, mean: mean, std: std, quantile: quantile,
    MODEL_META: MODEL_META,
    live: function () {
      return {
        wellKey: state.wellKey, days: state.days, H: state.H,
        withEvents: state.withEvents
      };
    }
  };

  if (typeof document !== "undefined" && document.getElementById && document.getElementById("simChart")) {
    init();
  }

  /* Node 自测导出（浏览器里 module 未定义，自动跳过） */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      WELL_PRESETS: WELL_PRESETS, genWell: genWell,
      arpsFit: arpsFit, arpsPredict: arpsPredict,
      ridgeFit: ridgeFit, solve: solve, MLP: MLP,
      featRow: featRow, buildMatrix: buildMatrix, scalerOf: scalerOf, applyScaler: applyScaler,
      walkForward: walkForward, forecastHorizon: forecastHorizon, attribution: attribution,
      evHeat: evHeat, FEAT_NAMES: FEAT_NAMES, NF: NF,
      mulberry32: mulberry32, mean: mean, std: std, quantile: quantile,
      MODEL_META: MODEL_META
    };
  }
})();
