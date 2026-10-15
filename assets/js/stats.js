/* stats.js — pure statistical helpers used by the DataFrame engine and charts.
   Mirrors pandas/NumPy semantics (pandas uses sample std with ddof = 1). */
(function (global) {
  'use strict';

  var D = {};

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function clean(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) if (isNum(arr[i])) out.push(arr[i]);
    return out;
  }

  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }

  function mean(a) { return a.length ? sum(a) / a.length : null; }

  function sortedCopy(a) { return a.slice().sort(function (x, y) { return x - y; }); }

  function min(a) { return a.length ? Math.min.apply(null, a) : null; }
  function max(a) { return a.length ? Math.max.apply(null, a) : null; }

  // pandas default "linear" interpolation
  function quantile(sorted, q) {
    var n = sorted.length;
    if (!n) return null;
    if (n === 1) return sorted[0];
    var pos = (n - 1) * q, base = Math.floor(pos), rest = pos - base;
    if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    return sorted[base];
  }

  function median(a) { return quantile(sortedCopy(a), 0.5); }

  function variance(a, ddof) {
    ddof = ddof === undefined ? 1 : ddof;
    var n = a.length;
    if (n - ddof <= 0) return null;
    var m = mean(a), s = 0;
    for (var i = 0; i < n; i++) { var d = a[i] - m; s += d * d; }
    return s / (n - ddof);
  }

  function std(a, ddof) { var v = variance(a, ddof); return v === null ? null : Math.sqrt(v); }

  function skew(a) {
    var n = a.length;
    if (n < 3) return null;
    var m = mean(a), s = std(a, 1);
    if (!s) return 0;
    var acc = 0;
    for (var i = 0; i < n; i++) acc += Math.pow((a[i] - m) / s, 3);
    return (n / ((n - 1) * (n - 2))) * acc;
  }

  function kurt(a) {
    var n = a.length;
    if (n < 4) return null;
    var m = mean(a), s = std(a, 1);
    if (!s) return 0;
    var acc = 0;
    for (var i = 0; i < n; i++) acc += Math.pow((a[i] - m) / s, 4);
    return (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3)) * acc - (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
  }

  function prod(a) { var p = 1; for (var i = 0; i < a.length; i++) p *= a[i]; return a.length ? p : null; }

  function ranks(a) {
    var idx = a.map(function (v, i) { return [v, i]; });
    idx.sort(function (x, y) { return x[0] - y[0]; });
    var r = new Array(a.length), i = 0;
    while (i < idx.length) {
      var j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      var avg = (i + j) / 2 + 1;
      for (var k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  }

  function pearson(x, y) {
    var n = x.length;
    if (n < 2) return null;
    var mx = mean(x), my = mean(y), num = 0, dx = 0, dy = 0;
    for (var i = 0; i < n; i++) {
      var a = x[i] - mx, b = y[i] - my;
      num += a * b; dx += a * a; dy += b * b;
    }
    var den = Math.sqrt(dx * dy);
    return den === 0 ? null : num / den;
  }

  function spearman(x, y) { return pearson(ranks(x), ranks(y)); }

  // paired clean: keep indices where both finite
  function pair(x, y) {
    var a = [], b = [];
    for (var i = 0; i < x.length; i++) {
      if (isNum(x[i]) && isNum(y[i])) { a.push(x[i]); b.push(y[i]); }
    }
    return [a, b];
  }

  function binCount(n) {
    if (n <= 1) return 1;
    var v = Math.ceil(Math.sqrt(n));
    return Math.max(5, Math.min(40, v));
  }

  // histogram with nice edges
  function histogram(a, bins, range) {
    if (!a.length) return { edges: [], counts: [] };
    var lo = range && isNum(range[0]) ? range[0] : min(a);
    var hi = range && isNum(range[1]) ? range[1] : max(a);
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    bins = bins || binCount(a.length);
    var width = (hi - lo) / bins;
    var counts = new Array(bins).fill(0);
    for (var i = 0; i < a.length; i++) {
      var k = Math.floor((a[i] - lo) / width);
      if (k === bins) k = bins - 1;
      if (k < 0) k = 0;
      counts[k]++;
    }
    var edges = [];
    for (var e = 0; e <= bins; e++) edges.push(lo + e * width);
    return { edges: edges, counts: counts };
  }

  // Gaussian KDE (Silverman bandwidth)
  function kde(a, points) {
    var n = a.length;
    if (n < 2) return null;
    var m = mean(a), sd = std(a, 1);
    var sorted = sortedCopy(a);
    var iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
    var h = 0.9 * Math.min(sd, iqr / 1.34) * Math.pow(n, -0.2);
    if (!h || !isFinite(h) || h <= 0) h = sd || 1;
    var lo = min(a) - 2 * h, hi = max(a) + 2 * h;
    points = points || 80;
    var xs = [], ys = [];
    var norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
    for (var p = 0; p < points; p++) {
      var x = lo + (hi - lo) * p / (points - 1), s = 0;
      for (var i = 0; i < n; i++) { var z = (x - a[i]) / h; s += Math.exp(-0.5 * z * z); }
      xs.push(x); ys.push(s * norm);
    }
    return { x: xs, y: ys };
  }

  function boxStats(a) {
    if (!a.length) return null;
    var s = sortedCopy(a);
    var q1 = quantile(s, 0.25), q2 = quantile(s, 0.5), q3 = quantile(s, 0.75);
    var iqr = q3 - q1, lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
    var inliers = [], outliers = [];
    for (var i = 0; i < s.length; i++) (s[i] < lo || s[i] > hi ? outliers : inliers).push(s[i]);
    return {
      min: min(inliers.length ? inliers : s),
      q1: q1, median: q2, q3: q3,
      max: max(inliers.length ? inliers : s),
      iqr: iqr, lower: lo, upper: hi, outliers: outliers, all: s
    };
  }

  function mode(a) {
    var counts = new Map(), best = null, bestC = -1;
    for (var i = 0; i < a.length; i++) {
      var c = (counts.get(a[i]) || 0) + 1; counts.set(a[i], c);
      if (c > bestC) { bestC = c; best = a[i]; }
    }
    return best;
  }

  function summarize(a) {
    var v = clean(a);
    return {
      count: v.length, mean: mean(v), std: std(v, 1), min: min(v), max: max(v),
      median: median(v), sum: v.length ? sum(v) : null, skew: skew(v), kurt: kurt(v)
    };
  }

  D.isNum = isNum;
  D.clean = clean;
  D.sum = sum;
  D.mean = mean;
  D.median = median;
  D.quantile = quantile;
  D.variance = variance;
  D.std = std;
  D.skew = skew;
  D.kurt = kurt;
  D.prod = prod;
  D.min = min;
  D.max = max;
  D.pearson = pearson;
  D.spearman = spearman;
  D.pair = pair;
  D.histogram = histogram;
  D.kde = kde;
  D.boxStats = boxStats;
  D.mode = mode;
  D.summarize = summarize;
  D.sortedCopy = sortedCopy;
  D.binCount = binCount;

  global.Stats = D;
})(window);
