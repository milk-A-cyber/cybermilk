/* =========================================================
   电潜泵故障预警 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  电流卡片异常检测：滑窗趋势检测 vs 只看绝对值
   屏 2  退化趋势与剩余寿命：线性外推越过阈值估计 RUL
   屏 3  分层预警：二维特征 + 四级分级 + 混淆矩阵 + 提前量
   所有计算都在浏览器里完成，纯前端。
   ========================================================= */
(function (global) {
  'use strict';

  /* =====================================================
     纯模型层（Node 可 require 做单测；浏览器里继续往下走）
     ===================================================== */
  var Model = (function () {

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

    /* -----------------------------------------------------
       屏 1 · 电流卡片生成（分钟级 12 小时 = 720 点）
       返回 { t, i, base, segs:[{a,b,label}] }
       fault: normal / gas(气锁) / scaling(结垢) / overheat(电机过热) / shutdown(停泵)
       ----------------------------------------------------- */
    var FAULT_META = {
      normal:   { label: '正常', segs: [] },
      gas:      { label: '气锁', segs: [[432, 720, '气锁段']] },
      scaling:  { label: '结垢', segs: [[260, 720, '结垢爬升段']] },
      overheat: { label: '电机过热', segs: [[396, 720, '过热段']] },
      shutdown: { label: '停泵', segs: [[504, 720, '停泵段']] }
    };

    function genCurrent(fault, noise, seed) {
      noise = noise == null ? 0.8 : noise;
      var N = 720, base = 92, t;
      var rnd = mulberry32(seed || 20261102);
      var i = new Float64Array(N);
      for (t = 0; t < N; t++) {
        var v = base;
        if (fault === 'gas') {
          /* 后 40% 气锁：周期性下探（泵吸入气体，电流锯齿） */
          if (t >= 432) { v = base - 6 - 10 * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / 18)); }
        } else if (fault === 'scaling') {
          /* 全程结垢：电流缓慢爬升 90→110 + 波动增大 */
          var prog = clamp((t - 120) / 600, 0, 1);
          v = 90 + 20 * prog + (rnd() + rnd() - 1) * 1.6 * prog;
        } else if (fault === 'overheat') {
          /* 后 45% 电机过热：电流上升 + 尖峰波动 */
          if (t >= 396) {
            var p2 = (t - 396) / 324;
            v = base + 14 * p2 + (rnd() + rnd() - 1) * 2.4;
            if (rnd() < 0.03) v += 8; /* 偶发尖峰 */
          }
        } else if (fault === 'shutdown') {
          /* 后 30% 停泵：电流骤降接近 0 */
          if (t >= 504) { v = 3 + (rnd() + rnd() - 1) * 1.5; }
        }
        v += (rnd() + rnd() - 1) * noise * 1.5;
        i[t] = v;
      }
      return { t: N, i: i, base: base, segs: FAULT_META[fault].segs, label: FAULT_META[fault].label };
    }

    /* 滑窗 Z-score：每个点相对"最近 win 点"偏离多少倍标准差（供特征/参考） */
    function slideZscore(series, win) {
      var n = series.length, z = new Float64Array(n), t;
      for (t = win; t < n; t++) {
        var m = 0, v2 = 0, k;
        for (k = t - win + 1; k <= t; k++) m += series[k];
        m /= win;
        for (k = t - win + 1; k <= t; k++) v2 += (series[k] - m) * (series[k] - m);
        var sd = Math.sqrt(v2 / win);
        z[t] = sd < 1e-9 ? 0 : (series[t] - m) / sd;
      }
      return z;
    }

    /* 检测：method 'z'（滑窗趋势斜率检测——"在不在涨"）或 'abs'（只看绝对值）。
       趋势检测对"缓慢爬升"敏感（点级阈值对慢漂移不敏感，这正是要演示的）。
       返回 { flags, score, hit, fp, segLen, normLen }，score 为归一化分数（>1 触发）。
       'z'  : score = 窗口斜率 / 0.025（40 点内 +1A 判定为在涨）
       'abs': score = |i - base| / 8 */
    function detectAnomaly(series, segs, method, base, thrZ, thrAbs, win) {
      win = win || 40;
      var n = series.length, t, flags = new Uint8Array(n), score = new Float64Array(n);
      var thrSlope = 0.025, thrA = thrAbs == null ? 10 : thrAbs;
      for (t = win; t < n; t++) {
        var alert = false, sc = 0;
        if (method === 'z') {
          var f = fitTrend(series, t - win + 1, t);
          sc = f.slope / thrSlope;
          alert = sc > 1;
        } else {
          sc = Math.abs(series[t] - base) / thrA;
          alert = sc > 1;
        }
        score[t] = sc;
        flags[t] = alert ? 1 : 0;
      }
      var hitNum = 0, fpNum = 0, segLen = 0, normLen = 0;
      var isSeg = new Uint8Array(n);
      for (var s = 0; s < segs.length; s++) {
        for (t = segs[s][0]; t < Math.min(segs[s][1], n); t++) isSeg[t] = 1;
      }
      for (t = 0; t < n; t++) {
        if (isSeg[t]) { segLen++; if (flags[t]) hitNum++; }
        else { normLen++; if (flags[t]) fpNum++; }
      }
      return {
        flags: flags, score: score, hit: segLen ? hitNum / segLen : 0,
        fp: normLen ? fpNum / normLen : 0, segLen: segLen, normLen: normLen
      };
    }

    /* 滑窗特征（屏 1 底部）：均值 / 斜率 / 波动（标准差） */
    function featStats(series, win) {
      var n = series.length, t, mean = new Float64Array(n), slope = new Float64Array(n), sd = new Float64Array(n);
      for (t = win; t < n; t++) {
        var m = 0, v2 = 0, k;
        for (k = t - win + 1; k <= t; k++) m += series[k];
        m /= win;
        for (k = t - win + 1; k <= t; k++) v2 += (series[k] - m) * (series[k] - m);
        mean[t] = m; sd[t] = Math.sqrt(v2 / win);
        /* 斜率：首尾差 / win（简化线性） */
        slope[t] = (series[t] - series[t - win + 1]) / win;
      }
      return { mean: mean, slope: slope, sd: sd, win: win };
    }

    /* -----------------------------------------------------
       屏 2 · 退化曲线与剩余寿命
       values = 产液 t/d（90 天，下降型）；threshold = 报警阈值
       真实 RUL = 从当前 day 到跌破阈值的天数（模拟"作弊"已知）
       ----------------------------------------------------- */
    var DEGRADE = {
      mild:     { label: '轻度结垢', rate: 0.22 },
      moderate: { label: '中度结垢', rate: 0.30 },
      severe:   { label: '重度结垢', rate: 0.55 }
    };
    var THRESHOLD = 22, START_LIQ = 45;

    function genDegrade(kind, seed) {
      var rate = DEGRADE[kind].rate, days = 90, t;
      var rnd = mulberry32(seed || 20261103);
      var values = new Float64Array(days);
      for (t = 0; t < days; t++) {
        values[t] = START_LIQ - rate * t + (rnd() + rnd() - 1) * 1.2;
      }
      return {
        values: values, days: days, threshold: THRESHOLD,
        rate: rate, label: DEGRADE[kind].label, kind: kind,
        daysArray: (function () { var a = []; for (t = 0; t < days; t++) a.push(t); return a; })()
      };
    }

    /* 真实剩余寿命（已知答案） */
    function trueRul(values, day, threshold) {
      if (values[day] <= threshold) return 0;
      var t;
      for (t = day; t < values.length; t++) if (values[t] <= threshold) return t - day;
      return values.length - day;
    }

    /* 线性最小二乘拟合 series[from..to] → {slope, intercept} */
    function fitTrend(series, from, to) {
      var n = to - from + 1, i, sx = 0, sy = 0, sxy = 0, sxx = 0;
      for (i = 0; i < n; i++) {
        var x = i, y = series[from + i];
        sx += x; sy += y; sxy += x * y; sxx += x * x;
      }
      var denom = n * sxx - sx * sx;
      var slope = denom ? (n * sxy - sx * sy) / denom : 0;
      var intercept = denom ? (sy - slope * sx) / n : (n ? sy / n : 0);
      return { slope: slope, intercept: intercept, n: n };
    }

    /* 用最近 win 天拟合，外推估计到达 threshold 的天数（RUL） */
    function predictRUL(values, day, win, threshold) {
      if (day < win) return null;
      var fit = fitTrend(values, day - win + 1, day);
      if (fit.slope >= -1e-9) return null; /* 不在下降 → 无法外推 */
      var curFit = fit.slope * (win - 1) + fit.intercept; /* 当前拟合值 */
      return Math.max(0, Math.round((curFit - threshold) / (-fit.slope)));
    }

    /* -----------------------------------------------------
       屏 3 · 分层预警
       wells: {id, slope(电流趋势 A/月), vol(波动性 A), state, failDay}
       state: normal / care / fault
       分级 score = slope/1.0 + vol/2.5
       ----------------------------------------------------- */
    function genFleet(seed) {
      var rnd = mulberry32(seed || 20261104), wells = [], i;
      var defs = [
        { state: 'normal', n: 13, s0: 0.0, sv: 0.08, v0: 0.85, vv: 0.30 },
        { state: 'care',   n: 4,  s0: 0.35, sv: 0.12, v0: 1.40, vv: 0.30 },
        { state: 'fault',  n: 7,  s0: 1.00, sv: 0.25, v0: 2.30, vv: 0.60 }
      ];
      var id = 0;
      for (i = 0; i < defs.length; i++) {
        var d = defs[i];
        for (var j = 0; j < d.n; j++) {
          var slope = d.s0 + (rnd() + rnd() - 1) * d.sv;
          var vol = Math.max(0.2, d.v0 + (rnd() + rnd() - 1) * d.vv);
          wells.push({
            id: 'W' + (++id),
            slope: slope, vol: vol, state: d.state,
            failDay: d.state === 'fault' ? 6 + Math.floor(rnd() * 34) : 999
          });
        }
      }
      return wells;
    }

    /* score = slope/1.0 + vol/2.5；四级边界随灵敏度 thr 缩放（thr 越大越保守） */
    function classify(slope, vol, thr) {
      var s = thr / 0.5;
      var k1 = 0.5 * s, k2 = 1.0 * s, k3 = 1.5 * s;
      var score = slope / 1.0 + vol / 2.5;
      if (score <= k1) return 0;       /* 正常 */
      if (score <= k2) return 1;       /* 关注 */
      if (score <= k3) return 2;       /* 预警 */
      return 3;                        /* 紧急 */
    }

    function fleetEval(fleet, thr) {
      var i, w, lev;
      var cm = [[0, 0, 0, 0], [0, 0, 0, 0]]; /* 行: 0正常+关注, 1故障; 列: 模型四级 */
      var det = 0, faultN = 0, fpUrg = 0, normN = 0, leadSum = 0, leadN = 0;
      var urg = 0, rev = 0;
      for (i = 0; i < fleet.length; i++) {
        w = fleet[i]; lev = classify(w.slope, w.vol, thr);
        var row = w.state === 'fault' ? 1 : 0;
        cm[row][lev]++;
        if (w.state === 'fault') {
          faultN++;
          if (lev >= 2) { det++; leadSum += w.failDay; leadN++; }
        } else {
          normN++;
          if (lev === 3) fpUrg++;
        }
        if (lev === 3) urg++;
        if (lev === 2) rev++;
      }
      return {
        cm: cm,
        detectRate: faultN ? det / faultN : 0,
        falseAlarmRate: normN ? fpUrg / normN : 0,
        avgLead: leadN ? leadSum / leadN : 0,
        urgentCount: urg, reviewCount: rev,
        faultN: faultN, normN: normN
      };
    }

    return {
      mulberry32: mulberry32, clamp: clamp,
      genCurrent: genCurrent, slideZscore: slideZscore, detectAnomaly: detectAnomaly, featStats: featStats,
      genDegrade: genDegrade, trueRul: trueRul, fitTrend: fitTrend, predictRUL: predictRUL,
      genFleet: genFleet, classify: classify, fleetEval: fleetEval,
      THRESHOLD: THRESHOLD, START_LIQ: START_LIQ
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

  /* 浏览器端桥接：把模型层暴露给「算法解剖」动画模块，
     让动画演示的每一步都跑的是同一份真代码。
     live() 每次读取当前 UI 的实时状态（滑杆/按钮改动会立即反映到动画里）。 */
  global.EspBridge = {
    M: M,
    genCurrent: M.genCurrent, slideZscore: M.slideZscore, detectAnomaly: M.detectAnomaly,
    featStats: M.featStats, genDegrade: M.genDegrade, trueRul: M.trueRul,
    fitTrend: M.fitTrend, predictRUL: M.predictRUL,
    genFleet: M.genFleet, classify: M.classify, fleetEval: M.fleetEval,
    THRESHOLD: M.THRESHOLD, START_LIQ: M.START_LIQ,
    live: function () {
      return {
        fault: (typeof anState !== 'undefined' && anState) ? anState.fault : 'scaling',
        noise: (typeof anState !== 'undefined' && anState) ? anState.noise : 0.8,
        kind: (typeof degState !== 'undefined' && degState) ? degState.kind : 'moderate',
        day: (typeof degState !== 'undefined' && degState) ? degState.day : 60,
        win: (typeof degState !== 'undefined' && degState) ? degState.win : 20,
        thr: (typeof thr !== 'undefined') ? thr : 0.5
      };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 1 : d); }

  function pathOf(arr, x, y, L, T, H) {
    var d = '', i;
    for (i = 0; i < arr.length; i++) {
      d += (i ? 'L' : 'M') + num(x(i)) + ' ' + num(y(arr[i]));
    }
    return d;
  }

  /* 画背景网格 */
  function grid(s, W, H, L, T, R, B, n, max) {
    var i;
    s += '<line x1="' + L + '" y1="' + B + '" x2="' + (W - R) + '" y2="' + B + '" stroke="#efece1" stroke-width="1"/>';
    for (i = 0; i <= n; i++) {
      var y = B - (i / n) * (B - T);
      s += '<line x1="' + L + '" y1="' + num(y) + '" x2="' + (W - R) + '" y2="' + num(y) + '" stroke="#f4f1e8" stroke-width="1"/>';
      s += '<text x="' + (L - 5) + '" y="' + (y + 3) + '" text-anchor="end" font-size="8.5" fill="#9ba3a9" font-family="monospace">' + Math.round(max * i / n) + '</text>';
    }
  }

  /* =====================================================
     屏 1 · 电流卡片 + 异常检测
     ===================================================== */
  var anState = { fault: 'scaling', noise: 0.8 };

  function drawAnomaly() {
    var W = 700, H = 180, L = 40, T = 20, R = 14, B = 164;
    var cur = M.genCurrent(anState.fault, anState.noise, 20261102);
    var i = cur.i, n = cur.t;
    var x = function (t) { return L + (t / (n - 1)) * (W - L - R); };
    var imin = 0, imax = 120;
    for (var t = 0; t < n; t++) { if (i[t] < imin) imin = i[t]; if (i[t] > imax) imax = i[t]; }
    imin = Math.min(imin, 0); imax = Math.max(imax, 110);
    var y = function (v) { return T + (imax - v) / (imax - imin) * (B - T); };

    /* 故障段底纹 */
    var s = '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fff"/>';
    for (var g = 0; g < cur.segs.length; g++) {
      var a = x(cur.segs[g][0]), b = x(cur.segs[g][1]);
      s += '<rect x="' + num(a) + '" y="' + T + '" width="' + (b - a) + '" height="' + (B - T) + '" fill="#f9ece6" stroke="none"/>';
      s += '<text x="' + num((a + b) / 2) + '" y="' + (T + 12) + '" text-anchor="middle" font-size="9.5" fill="#b3492f" font-weight="600">' + cur.segs[g][2] + '</text>';
    }
    grid(s, W, H, L, T, R, B, 4, imax - imin);
    s += '<path d="' + pathOf(i, x, y, L, T, H) + '" fill="none" stroke="#41699b" stroke-width="1.4"/>';
    /* 基线 */
    s += '<line x1="' + L + '" y1="' + num(y(92)) + '" x2="' + (W - R) + '" y2="' + num(y(92)) + '" stroke="#9ba3a9" stroke-width="1" stroke-dasharray="4 3"/>';
    s += '<text x="' + (W - R) + '" y="' + (y(92) - 4) + '" text-anchor="end" font-size="8.5" fill="#9ba3a9">基线 92A</text>';
    s += '<text x="' + L + '" y="' + (H - 4) + '" font-size="9.5" fill="#4d565b" font-weight="600">电流 (A) · 分钟级 12 小时</text>';
    $('curChart').innerHTML = s;

    /* 两种检测器分数（归一化：>1 即触发报警） */
    var H2 = 150, T2 = 20, B2 = 132;
    var detZ = M.detectAnomaly(i, cur.segs, 'z', cur.base, 3.0, 8, 40);
    var detA = M.detectAnomaly(i, cur.segs, 'abs', cur.base, 3.0, 10, 40);
    var s2 = '<rect x="0" y="0" width="' + W + '" height="' + H2 + '" fill="#fff"/>';
    grid(s2, W, H2, L, T2, R, B2, 2, 6);
    /* 报警阈值线 分数=1 */
    s2 += '<line x1="' + L + '" y1="' + num(yz(1)) + '" x2="' + (W - R) + '" y2="' + num(yz(1)) + '" stroke="#9ba3a9" stroke-width="1" stroke-dasharray="4 3"/>';
    s2 += '<text x="' + (W - R) + '" y="' + (yz(1) - 4) + '" text-anchor="end" font-size="8.5" fill="#79828a">报警线 1.0</text>';
    /* 故障段底纹 */
    for (g = 0; g < cur.segs.length; g++) {
      var a2 = x(cur.segs[g][0]), b2 = x(cur.segs[g][1]);
      s2 += '<rect x="' + num(a2) + '" y="' + T2 + '" width="' + (b2 - a2) + '" height="' + (B2 - T2) + '" fill="#f9ece6" stroke="none"/>';
    }
    var pathZ = pathOf(detZ.score, x, yz, L, T2, H2);
    s2 += '<path d="' + pathZ + '" fill="none" stroke="#2f7d6b" stroke-width="1.5"/>';
    var pathA = pathOf(detA.score, x, yz, L, T2, H2);
    s2 += '<path d="' + pathA + '" fill="none" stroke="#b26a39" stroke-width="1.4"/>';
    s2 += '<rect x="' + L + '" y="' + (B2 + 4) + '" width="10" height="10" rx="2" fill="#2f7d6b"/><text x="' + (L + 14) + '" y="' + (B2 + 13) + '" font-size="8.5" fill="#4d565b">滑窗趋势检测（命中 ' + Math.round(detZ.hit * 100) + '%）</text>';
    s2 += '<rect x="' + (L + 248) + '" y="' + (B2 + 4) + '" width="10" height="10" rx="2" fill="#b26a39"/><text x="' + (L + 262) + '" y="' + (B2 + 13) + '" font-size="8.5" fill="#4d565b">只看绝对值 |I−基线|（命中 ' + Math.round(detA.hit * 100) + '%）</text>';
    $('zChart').innerHTML = s2;

    /* 滑窗特征 */
    var H3 = 120, T3 = 18, B3 = 104;
    var fs = M.featStats(i, 40);
    var s3 = '<rect x="0" y="0" width="' + W + '" height="' + H3 + '" fill="#fff"/>';
    grid(s3, W, H3, L, T3, R, B3, 2, 2);
    /* 均值 - 用 i 本身做基线对照 */
    s3 += '<path d="' + pathOf(fs.slope, x, yz2, L, T3, H3) + '" fill="none" stroke="#2f7d6b" stroke-width="1.4"/>';
    s3 += '<path d="' + pathOf(fs.sd, x, yz2, L, T3, H3) + '" fill="none" stroke="#b26a39" stroke-width="1.3"/>';
    s3 += '<rect x="' + L + '" y="' + (B3 + 4) + '" width="10" height="10" rx="2" fill="#2f7d6b"/><text x="' + (L + 14) + '" y="' + (B3 + 13) + '" font-size="8.5" fill="#4d565b">滑窗趋势斜率（×10 A/点）</text>';
    s3 += '<rect x="' + (L + 260) + '" y="' + (B3 + 4) + '" width="10" height="10" rx="2" fill="#b26a39"/><text x="' + (L + 274) + '" y="' + (B3 + 13) + '" font-size="8.5" fill="#4d565b">滑窗波动性（标准差 A）</text>';
    $('featChart').innerHTML = s3;

    function yz(v) { return T2 + (6 - Math.min(v, 6)) / 6 * (B2 - T2); }
    function yz2(v) { return T3 + (2 - Math.min(Math.max(v, -2), 2) + 2) / 4 * (B3 - T3); }

    /* 读数 */
    $('roFault').textContent = cur.label;
    $('roHitZ').textContent = Math.round(detZ.hit * 100) + ' %';
    $('roHitA').textContent = Math.round(detA.hit * 100) + ' %';
    $('roFpZ').textContent = Math.round(detZ.fp * 100) + ' %';
    $('roFpA').textContent = Math.round(detA.fp * 100) + ' %';
    var zi = $('roHitZ'); zi.className = detZ.hit > 0.6 ? 'ok' : (detZ.hit > 0.3 ? 'warn' : 'bad');
    var ai = $('roHitA'); ai.className = detA.hit > 0.6 ? 'ok' : (detA.hit > 0.3 ? 'warn' : 'bad');
    $('anTip').innerHTML = (anState.fault === 'scaling'
      ? '这就是<b>结垢</b>的陷阱：电流从 90 缓慢爬到 110，全程仍贴着\"正常区间\"（基线 ±10A），<b>只看绝对值</b>把前半段当正常、命中只有 ' + Math.round(detA.hit * 100) + '%；而<b>滑窗趋势检测</b>比较的是\"最近 40 点是不是在涨\"，爬升一开始就被抓住，命中 ' + Math.round(detZ.hit * 100) + '%。'
      : (anState.fault === 'normal'
        ? '这是<b>正常</b>工况：两条检测线都压得很低，误报率 ' + Math.round(detZ.fp * 100) + '% / ' + Math.round(detA.fp * 100) + '%。把噪声拖大，看谁先被噪声带出误报。'
        : (anState.fault === 'gas'
          ? '<b>气锁</b>是锯齿状下探：' + (detA.hit > detZ.hit ? '绝对值检测靠下探抓得更早（命中 ' + Math.round(detA.hit * 100) + '%），滑窗趋势检测把下探当成\"短时波动\"命中稍低（' + Math.round(detZ.hit * 100) + '%）——所以不同类型要分开设特征。' : '滑窗趋势检测（命中 ' + Math.round(detZ.hit * 100) + '%）与绝对值（' + Math.round(detA.hit * 100) + '%）都能抓到锯齿下探，但要看谁误报更少。')
          : (anState.fault === 'overheat'
            ? '<b>电机过热</b>是电流上升 + 波动加剧：波动性特征（橙线）和趋势斜率（绿线）同时抬升，滑窗趋势检测命中 ' + Math.round(detZ.hit * 100) + '%，比只看绝对值更早。'
            : '<b>停泵</b>是电流骤降：两种检测器都能立刻抓到（命中 ' + Math.round(detZ.hit * 100) + '% / ' + Math.round(detA.hit * 100) + '%）——这是\"已发生\"的故障，预警的意义在于停泵前的缓慢退化，而不是停泵本身。'))));
  }

  /* =====================================================
     屏 2 · 退化趋势 + 剩余寿命
     ===================================================== */
  var degState = { kind: 'moderate', day: 60, win: 20 };

  function drawDegrade() {
    var W = 700, H = 260, L = 44, T = 22, R = 16, B = 224;
    var dg = M.genDegrade(degState.kind, 20261103);
    var v = dg.values, day = degState.day, win = degState.win, th = dg.threshold;
    var trueR = M.trueRul(v, day, th);
    var pred = M.predictRUL(v, day, win, th);
    var maxV = 50, minV = 10;
    var x = function (t) { return L + (t / (dg.days - 1)) * (W - L - R); };
    var y = function (val) { return T + (maxV - val) / (maxV - minV) * (B - T); };

    var s = '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fff"/>';
    grid(s, W, H, L, T, R, B, 4, 50);
    /* 阈值线 */
    s += '<line x1="' + L + '" y1="' + num(y(th)) + '" x2="' + (W - R) + '" y2="' + num(y(th)) + '" stroke="#b3492f" stroke-width="1.4" stroke-dasharray="6 4"/>';
    s += '<text x="' + (W - R) + '" y="' + (y(th) - 4) + '" text-anchor="end" font-size="8.5" fill="#b3492f" font-weight="600">报警阈值 产液 ' + th + ' t/d</text>';
    /* 当前时刻垂线 */
    s += '<line x1="' + num(x(day)) + '" y1="' + T + '" x2="' + num(x(day)) + '" y2="' + B + '" stroke="#41699b" stroke-width="1.2" stroke-dasharray="3 3"/>';
    s += '<text x="' + num(x(day)) + '" y="' + (T + 12) + '" text-anchor="middle" font-size="8.5" fill="#41699b" font-weight="600">现在 第 ' + day + ' 天</text>';

    /* 历史段（到 day）实线，之后淡灰虚线 */
    var hist = new Float64Array(day + 1), tail = new Float64Array(dg.days - day), t, tt = 0;
    for (t = 0; t <= day; t++) hist[t] = v[t];
    for (t = day; t < dg.days; t++) { tail[tt++] = v[t]; }
    s += '<path d="' + pathOf(hist, x, y, L, T, H) + '" fill="none" stroke="#41699b" stroke-width="1.8"/>';
    s += '<path d="' + pathOf(tail, (function (o) { return function (i) { return x(o + i); }; })(day), y, L, T, H) + '" fill="none" stroke="#9fb8d4" stroke-width="1.4" stroke-dasharray="4 3"/>';

    /* 拟合线（最近 win 天）+ 外推 */
    var fit = M.fitTrend(v, day - win + 1, day);
    var fy = function (i) { return fit.slope * i + fit.intercept; };
    var xStart = day - win + 1, xEnd = day + (pred == null ? 0 : pred) + 4;
    var fitD = '';
    for (t = xStart; t <= xEnd; t++) fitD += (t === xStart ? 'M' : 'L') + num(x(t)) + ' ' + num(y(fy(t - (day - win + 1))));
    s += '<path d="' + fitD + '" fill="none" stroke="#b26a39" stroke-width="1.8" stroke-dasharray="5 3"/>';
    s += '<rect x="' + num(x(day - win + 1)) + '" y="' + (T + 2) + '" width="' + (x(day) - x(day - win + 1)) + '" height="' + (B - T - 4) + '" fill="none" stroke="#b26a39" stroke-width="1" stroke-dasharray="2 2"/>';

    /* RUL 标注：阈值交点 */
    var crossDay = null;
    if (pred != null) crossDay = day + pred;
    if (crossDay != null) {
      var cx = x(Math.min(crossDay, dg.days - 1));
      var cy = y(th);
      s += '<circle cx="' + num(cx) + '" cy="' + num(cy) + '" r="4.5" fill="#b3492f" stroke="#fff" stroke-width="1.5"/>';
      s += '<text x="' + num(cx) + '" y="' + (cy - 10) + '" text-anchor="middle" font-size="8.5" fill="#b3492f" font-weight="600">预测到达报警</text>';
      /* 箭头 */
      s += '<path d="M' + num(x(day)) + ' ' + num(y(v[day]) - 14) + ' L' + num(cx) + ' ' + num(cy + 16) + '" stroke="#2f7d6b" stroke-width="1.4" fill="none"/>';
    }
    s += '<text x="' + L + '" y="' + (H - 4) + '" font-size="9.5" fill="#4d565b" font-weight="600">产液量 (t/d) · 90 天退化曲线（实线=已见数据，淡虚线=真实走向，橙虚线=模型拟合外推）</text>';
    $('degradeChart').innerHTML = s;

    /* 读数 */
    var rr = $('roTrueRul'); rr.textContent = trueR + ' 天';
    var rp = $('roRul');
    rp.textContent = pred == null ? '不下降' : pred + ' 天';
    rp.className = pred == null ? 'warn' : (Math.abs(pred - trueR) <= 10 ? 'ok' : 'warn');
    var re = $('roRulErr');
    var err = pred == null ? null : pred - trueR;
    re.textContent = err == null ? '—' : (err > 0 ? '+' : '') + err + ' 天';
    re.className = (err == null || Math.abs(err) <= 10) ? 'ok' : 'warn';
    $('roCur').textContent = num(v[day], 1) + ' t/d';
    $('degTip').innerHTML = '<b>' + dg.label + '</b>：产液每天约降 ' + num(dg.rate, 2) + ' t/d，当前第 ' + day + ' 天产液 ' + num(v[day], 1) + ' t/d，跌破 ' + th + ' 还需 <b>真实 ' + trueR + ' 天</b>。' +
      '模型用最近 ' + win + ' 天拟合外推，估计 <b>RUL = ' + (pred == null ? '（当前不下降，无法外推）' : pred + ' 天') + '</b>，误差 ' + (err == null ? '—' : (err > 0 ? '+' : '') + err) + ' 天。' +
      '窗口太短易被噪声带偏，太长被早期平台期拖慢——现场会定期重估并配置信区间。';
  }

  /* =====================================================
     屏 3 · 分层预警
     ===================================================== */
  var fleet = M.genFleet(20261104);
  var thr = 0.5;

  function drawFleet() {
    var W = 340, H = 280, L = 36, T = 20, R = 12, B = 250;
    var slMax = 1.6, volMax = 3.6;
    var x = function (sl) { return L + (sl / slMax) * (W - L - R); };
    var y = function (vl) { return T + (volMax - vl) / volMax * (B - T); };
    var s = '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fff"/>';
    grid(s, W, H, L, T, R, B, 4, 3.6);
    s += '<text x="' + (W / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="9.5" fill="#4d565b" font-weight="600">电流趋势斜率 (A/月) →</text>';
    s += '<text x="14" y="' + (H / 2) + '" font-size="9.5" fill="#4d565b" font-weight="600" transform="rotate(-90 14 ' + (H / 2) + ')">波动性 σ (A)</text>';
    /* 分级边界：score=slope/1.0+vol/2.5 = k → vol=2.5*(k-slope) */
    var sc = thr / 0.5;
    var k1 = 0.5 * sc, k2 = 1.0 * sc, k3 = 1.5 * sc;
    var bound = [k1, k2, k3], cols = ['#c9e4d8', '#f7e3c8', '#f5c9b8'];
    for (var bi = 0; bi < 3; bi++) {
      var bpts = [];
      for (var sl = 0; sl <= slMax; sl += 0.05) {
        var vl = 2.5 * (bound[bi] - sl);
        if (vl < 0) vl = 0; if (vl > volMax) vl = volMax;
        bpts.push([x(sl), y(vl)]);
      }
      var bd = '';
      for (var q = 0; q < bpts.length; q++) bd += (q ? 'L' : 'M') + num(bpts[q][0]) + ' ' + num(bpts[q][1]);
      s += '<path d="' + bd + '" fill="none" stroke="' + cols[bi] + '" stroke-width="1.4" stroke-dasharray="4 3"/>';
    }
    /* 井点 */
    for (var i = 0; i < fleet.length; i++) {
      var w = fleet[i], lev = M.classify(w.slope, w.vol, thr);
      var fill = w.state === 'fault' ? '#b3492f' : (w.state === 'care' ? '#e0a24e' : '#2f7d6b');
      var cx = x(w.slope), cy = y(w.vol);
      s += '<circle cx="' + num(cx) + '" cy="' + num(cy) + '" r="' + (w.state === 'fault' ? 5.5 : 4.2) + '" fill="' + fill + '" opacity="0.82" stroke="#fff" stroke-width="1.2"/>';
      /* 分级外圈：预警2/紧急3 */
      if (lev >= 2) {
        s += '<circle cx="' + num(cx) + '" cy="' + num(cy) + '" r="' + (w.state === 'fault' ? 8.5 : 7) + '" fill="none" stroke="#b3492f" stroke-width="1.1" opacity="0.7"/>';
      }
    }
    s += '<rect x="' + L + '" y="' + (B + 4) + '" width="9" height="9" rx="2" fill="#2f7d6b"/><text x="' + (L + 12) + '" y="' + (B + 12) + '" font-size="8.5" fill="#4d565b">正常</text>';
    s += '<rect x="' + (L + 58) + '" y="' + (B + 4) + '" width="9" height="9" rx="2" fill="#e0a24e"/><text x="' + (L + 70) + '" y="' + (B + 12) + '" font-size="8.5" fill="#4d565b">关注</text>';
    s += '<rect x="' + (L + 118) + '" y="' + (B + 4) + '" width="9" height="9" rx="2" fill="#b3492f"/><text x="' + (L + 130) + '" y="' + (B + 12) + '" font-size="8.5" fill="#4d565b">故障</text>';
    s += '<text x="' + (W - R) + '" y="' + (B + 12) + '" text-anchor="end" font-size="8.5" fill="#79828a">外圈 = 模型判为预警/紧急</text>';
    $('fleetChart').innerHTML = s;

    /* 混淆矩阵：真实(正常/故障) × 模型(四级) */
    var ev = M.fleetEval(fleet, thr);
    var CW = 340, CH = 280, cl = 40, ct = 34, cw = (CW - cl - 10) / 4, chh = (CH - ct - 14) / 2;
    var s2 = '<rect x="0" y="0" width="' + CW + '" height="' + CH + '" fill="#fff"/>';
    s2 += '<text x="' + (cl + (CW - cl) / 2) + '" y="' + (ct - 8) + '" text-anchor="middle" font-size="10" fill="#242b2e" font-weight="600">混淆矩阵：真实 × 模型分级</text>';
    var levs = ['正常', '关注', '预警', '紧急'];
    var maxc = 1;
    for (var r = 0; r < 2; r++) for (var c = 0; c < 4; c++) if (ev.cm[r][c] > maxc) maxc = ev.cm[r][c];
    for (r = 0; r < 2; r++) {
      for (c = 0; c < 4; c++) {
        var vv = ev.cm[r][c];
        var al = 0.15 + 0.85 * (vv / maxc);
        var fill = r === 0 ? 'rgba(47,125,107,' + al.toFixed(2) + ')' : 'rgba(179,73,47,' + al.toFixed(2) + ')';
        s2 += '<rect x="' + (cl + c * cw) + '" y="' + (ct + r * chh) + '" width="' + (cw - 3) + '" height="' + (chh - 3) + '" fill="' + fill + '" rx="3"/>';
        s2 += '<text x="' + (cl + c * cw + cw / 2) + '" y="' + (ct + r * chh + chh / 2 + 4) + '" text-anchor="middle" font-size="13" fill="#fff" font-weight="700">' + vv + '</text>';
      }
    }
    s2 += '<text x="' + (cl - 6) + '" y="' + (ct + chh / 2 + 4) + '" text-anchor="end" font-size="9.5" fill="#2f7d6b" font-weight="600">正常/关注</text>';
    s2 += '<text x="' + (cl - 6) + '" y="' + (ct + chh * 1.5 + 4) + '" text-anchor="end" font-size="9.5" fill="#b3492f" font-weight="600">故障</text>';
    for (c = 0; c < 4; c++) {
      s2 += '<text x="' + (cl + c * cw + cw / 2) + '" y="' + (CH - 4) + '" text-anchor="middle" font-size="8.5" fill="#4d565b">' + levs[c] + '</text>';
    }
    $('cmChart').innerHTML = s2;

    /* 提前量分布 */
    var LW = 700, LH = 150, ll = 40, lt = 20, lr = 16, lb = 128;
    var s3 = '<rect x="0" y="0" width="' + LW + '" height="' + LH + '" fill="#fff"/>';
    grid(s3, LW, LH, ll, lt, lr, lb, 4, 40);
    s3 += '<text x="' + ll + '" y="' + (lt + 12) + '" font-size="9.5" fill="#4d565b" font-weight="600">故障井：模型预警日到真实故障日的提前量（天）</text>';
    var fw = fleet.filter(function (w) { return w.state === 'fault'; });
    var bw = (LW - ll - lr) / fw.length;
    for (i = 0; i < fw.length; i++) {
      var wd = fw[i];
      var lev = M.classify(wd.slope, wd.vol, thr);
      var lx = ll + i * bw + bw / 2;
      var hgt = (wd.failDay / 40) * (lb - lt);
      var col = lev >= 2 ? '#b3492f' : '#e0a24e';
      s3 += '<rect x="' + num(lx - bw * 0.3) + '" y="' + num(lb - hgt) + '" width="' + num(bw * 0.6) + '" height="' + num(hgt) + '" fill="' + col + '" rx="2"/>';
      s3 += '<text x="' + num(lx) + '" y="' + num(lb - hgt - 4) + '" text-anchor="middle" font-size="8.5" fill="#4d565b" font-family="monospace">' + wd.failDay + '</text>';
      s3 += '<text x="' + num(lx) + '" y="' + (lb + 12) + '" text-anchor="middle" font-size="8.5" fill="#79828a">' + wd.id + '</text>';
    }
    s3 += '<text x="' + ll + '" y="' + (LH - 4) + '" font-size="8.5" fill="#79828a">柱高 = 距故障还剩多少天（提前量）；红色 = 模型已判为预警/紧急（抓住了），黄色 = 未被抓住</text>';
    $('leadChart').innerHTML = s3;

    /* 读数 */
    var rd = $('roDet'); rd.textContent = Math.round(ev.detectRate * 100) + ' %';
    rd.className = ev.detectRate > 0.8 ? 'ok' : (ev.detectRate > 0.6 ? 'warn' : 'bad');
    var rf = $('roFp'); rf.textContent = Math.round(ev.falseAlarmRate * 100) + ' %';
    rf.className = ev.falseAlarmRate < 0.1 ? 'ok' : (ev.falseAlarmRate < 0.25 ? 'warn' : 'bad');
    var rl = $('roLead'); rl.textContent = Math.round(ev.avgLead) + ' 天';
    var ru = $('roUrg'); ru.textContent = ev.urgentCount + ' 口';
    var rrv = $('roReview'); rrv.textContent = ev.reviewCount + ' 口';
    $('clsTip').innerHTML = '灵敏度 ' + num(thr, 2) + '（边界 k1/k2/k3 = ' + num(k1, 2) + '/' + num(k2, 2) + '/' + num(k3, 2) + '）：故障检出率 <b>' + Math.round(ev.detectRate * 100) + '%</b>，紧急误报率 <b>' + Math.round(ev.falseAlarmRate * 100) + '%</b>，平均提前 <b>' + Math.round(ev.avgLead) + ' 天</b>。' +
      '往左拖灵敏度更激进（检出高但误报也高），往右更保守（误报低但慢退化可能漏）。<b>紧急才检泵、预警只加测</b>——紧急 ' + ev.urgentCount + ' 口、需人工复核的预警 ' + ev.reviewCount + ' 口。';
  }

  /* ---- 事件绑定 ---- */
  var fb = $('faultBtns');
  fb.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var fs = fb.querySelectorAll('button');
    for (var i = 0; i < fs.length; i++) fs[i].className = '';
    b.className = 'on';
    anState.fault = b.getAttribute('data-fault');
    drawAnomaly();
  });
  $('inNoise').addEventListener('input', function () { anState.noise = Number(this.value); $('outNoise').textContent = num(anState.noise, 2); drawAnomaly(); });

  var db = $('degBtns');
  db.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var bs = db.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) bs[i].className = '';
    b.className = 'on';
    degState.kind = b.getAttribute('data-kind');
    drawDegrade();
  });
  $('inDay').addEventListener('input', function () { degState.day = Number(this.value); $('outDay').textContent = degState.day; drawDegrade(); });
  $('inWin').addEventListener('input', function () { degState.win = Number(this.value); $('outWin').textContent = degState.win; drawDegrade(); });

  $('inThr').addEventListener('input', function () { thr = Number(this.value); $('outThr').textContent = num(thr, 2); drawFleet(); });

  drawAnomaly();
  drawDegrade();
  drawFleet();

})(typeof window !== 'undefined' ? window : this);
