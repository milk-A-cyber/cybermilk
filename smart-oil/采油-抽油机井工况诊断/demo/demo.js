/* =========================================================
   抽油机井工况诊断 · 可运行示范（整页模式，沙箱 iframe 内运行）
   ---------------------------------------------------------
   屏 1  示功图物理模拟：抽油机动画 + 井下泵 + 实时示功图
   屏 2  分类器前向演示：32×32 栅格化 → 8 卷积核 → 32 维特征
         → 原型匹配 + softmax + 分布外（OOD）距离阈值
   屏 3  区块级批量判读：24 口井一轮，置信度分流

   纯前端、无依赖。核心算法部分不碰 DOM，可在 Node 中单独测试
   （文件末尾有 module.exports 守卫）。
   ========================================================= */
(function () {
  'use strict';

  /* =========================================================
     一、核心算法（对应案例流程 STEP 3）
     ========================================================= */

  /* ---------- 物理常数（教学简化模型） ---------- */
  var Wr = 38;          // 杆柱在液中重量 kN
  var WfMax = 46;       // 满液体载荷 kN
  var Ymax = 96;        // 示功图纵轴量程 kN
  var WrBroken = 15.5;  // 断脱后光杆只提断点以上杆重 kN

  var CLASSES = ['正常', '供液不足', '气锁', '泵漏失', '杆断脱'];
  var CLASS_COLOR = {
    '正常': '#2f7d6b', '供液不足': '#c98a2b', '气锁': '#7e5a8d',
    '泵漏失': '#41699b', '杆断脱': '#b05a51', '疑难': '#79828a'
  };
  /* 8 个卷积通道的配色（与工况色区分开） */
  var CH_COLOR = ['#2f7d6b', '#41699b', '#7e5a8d', '#b26a39', '#b05a51', '#c98a2b', '#5b7f9e', '#8a7f4d'];

  /* 工况预设（与案例流程、专业背景中的工况图库一致） */
  var PRESET = {
    '正常':     { fill: 1.00, gas: 0.00, leak: 0.00, spm: 6 },
    '供液不足': { fill: 0.32, gas: 0.25, leak: 0.10, spm: 6 },
    '气锁':     { fill: 0.85, gas: 0.90, leak: 0.20, spm: 6 },
    '泵漏失':   { fill: 0.90, gas: 0.10, leak: 0.85, spm: 6 },
    '杆断脱':   { fill: 0.00, gas: 0.00, leak: 0.00, broken: 1, spm: 6 },
    '复合疑难': { fill: 0.50, gas: 0.80, leak: 0.55, spm: 6 }
  };

  var T = 0.025;          // softmax 温度
  var TAU = 0.10;         // 分布外距离阈值
  var CONF_REVIEW = 0.75; // 置信度复核阈值

  function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

  /* ---------- 示功图物理模型 ----------
     p = { fill 充满系数, gas 含气, leak 漏失, broken 断脱, spm 冲次, S 冲程 }
     返回 N 个 [位移 x (m), 载荷 y (kN)]，θ 从 0（下死点）扫到 2π */
  function cardPoints(p, N) {
    N = N || 180;
    var S = p.S || 3;
    var w = 2 * Math.PI * (p.spm || 6) / 60;
    var fill = p.fill, gas = p.gas || 0, leak = p.leak || 0, broken = p.broken || 0;
    var pound = !!p.pound;
    /* 载荷传递窗口：含气拉长传递线，漏失把传递摊到整个冲程 */
    var t0 = 0.05 + 0.02 * gas;
    var t1 = 0.16 + 0.62 * gas + (Math.PI - 0.16) * leak;
    var peak = 1 - 0.34 * gas - 0.22 * leak;
    var pts = [];
    for (var k = 0; k < N; k++) {
      var th = 2 * Math.PI * k / N;
      var x = S / 2 * (1 - Math.cos(th));
      var inertia = (Wr / 9.8) * (S / 2) * w * w * Math.cos(th); // 杆柱惯性
      var y;
      if (broken) {
        y = WrBroken + (WrBroken / 9.8) * (S / 2) * w * w * Math.cos(th) + 0.8 * Math.cos(2 * th);
      } else {
        var Wf = WfMax * fill * peak;
        var tr = th < Math.PI
          ? smooth((th - t0) / Math.max(1e-6, t1 - t0))
          : 1 - smooth((th - Math.PI - t0) / Math.max(1e-6, t1 - t0));
        var poundLoad = 0;
        if (pound && th > 1.72 * Math.PI) { // 液击：柱塞下冲程末段撞上液面
          poundLoad = 7 * Math.exp(-Math.pow((th - 1.88 * Math.PI) / 0.16, 2));
        }
        y = Wr + Wf * tr + inertia + poundLoad;
      }
      pts.push([x, y]);
    }
    return pts;
  }

  /* ---------- 栅格化：曲线 → 32×32 灰度图 ----------
     frac ∈ (0,1] 表示只走完全部 steps 的前 frac 份，
     给「算法解剖动画」用来逐步显示像素被点亮的过程；
     frac 省略时与原来完全一致。 */
  function rasterize(pts, S, G, frac) {
    G = G || 32;
    var img = new Float64Array(G * G);
    var steps = 4000;
    var lim = frac == null ? steps : Math.max(1, Math.round(steps * Math.min(1, Math.max(0, frac))));
    for (var i = 0; i < lim; i++) {
      var fi = i / (steps - 1) * (pts.length - 1);
      var i0 = Math.floor(fi), fr = fi - i0;
      var a = pts[i0], b = pts[Math.min(pts.length - 1, i0 + 1)];
      var x = a[0] + (b[0] - a[0]) * fr;
      var y = a[1] + (b[1] - a[1]) * fr;
      var col = x / S * (G - 1);
      var row = (1 - y / Ymax) * (G - 1);
      var c0 = Math.floor(col), r0 = Math.floor(row);
      for (var dr = 0; dr <= 1; dr++) {
        for (var dc = 0; dc <= 1; dc++) {
          var rr = r0 + dr, cc = c0 + dc;
          if (rr < 0 || cc < 0 || rr >= G || cc >= G) continue;
          img[rr * G + cc] += (1 - Math.abs(row - rr)) * (1 - Math.abs(col - cc));
        }
      }
    }
    for (var j = 0; j < img.length; j++) img[j] = Math.min(1, img[j]);
    return img;
  }

  /* 栅格化过程中「某个采样点落到哪一格」——动画用来高亮当前笔尖 */
  function rasterStep(pts, S, G, step, steps) {
    G = G || 32; steps = steps || 4000;
    var fi = step / (steps - 1) * (pts.length - 1);
    var i0 = Math.floor(fi), fr = fi - i0;
    var a = pts[i0], b = pts[Math.min(pts.length - 1, i0 + 1)];
    var x = a[0] + (b[0] - a[0]) * fr;
    var y = a[1] + (b[1] - a[1]) * fr;
    return { x: x, y: y, col: x / S * (G - 1), row: (1 - y / Ymax) * (G - 1) };
  }

  /* ---------- 第一层卷积核（5×5，对应真实 CNN 第一层学到的检测子） ---------- */
  function makeKernels() {
    function pad3(k3) {
      var k = [];
      for (var r = 0; r < 5; r++) {
        var row = [];
        for (var c = 0; c < 5; c++) row.push(k3[r - 1] ? (k3[r - 1][c - 1] || 0) : 0);
        k.push(row);
      }
      return k;
    }
    var Gx = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];   // 水平梯度 → 响应竖直笔画
    var Gy = [[1, 2, 1], [0, 0, 0], [-1, -2, -1]];   // 竖直梯度 → 响应水平笔画
    function combine(f) {
      var k = [];
      for (var r = 0; r < 3; r++) {
        var row = [];
        for (var c = 0; c < 3; c++) row.push(f(Gx[r][c], Gy[r][c]));
        k.push(row);
      }
      return pad3(k);
    }
    return [
      combine(function (x, y) { return x; }),                    // 1 竖边（水平梯度 Gx）
      combine(function (x, y) { return y; }),                    // 2 横边（竖直梯度 Gy）
      combine(function (x, y) { return (x + y) / 1.414; }),      // 3 斜边 ↘
      combine(function (x, y) { return (x - y) / 1.414; }),      // 4 斜边 ↗
      [[-1, -2, 1, 0, 0], [-2, -4, 2, 0, 0], [-1, -2, 1, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],     // 5 右竖带
      [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [1, 2, 1, 0, 0], [-2, -4, -2, 0, 0], [-1, -2, -1, 0, 0]],     // 6 上横带
      [[-1, -2, -1, 0, 0], [-2, -4, -2, 0, 0], [1, 2, 1, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],     // 7 下横带
      [[0, 0, 1, -2, -1], [0, 0, 2, -4, -2], [0, 0, 1, -2, -1], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]]      // 8 左竖带
    ];
  }
  var KERNELS = makeKernels();
  /* 每个核"在检测什么"——配合下方固定的权重小格，解释为什么它不随输入变化 */
  var KERNEL_NAME = ['竖边', '横边', '斜 ↘', '斜 ↗', '右竖带', '上横带', '下横带', '左竖带'];

  /* 热力色图：深靛 → 青 → 琥珀 → 米白。
     比灰度更能区分"暗但有值"的中间响应，避免稀疏响应看起来全黑。 */
  function heat(v) {
    var S = [[0, 16, 22, 32], [0.18, 32, 56, 92], [0.42, 44, 122, 128], [0.7, 198, 143, 56], [1, 250, 234, 200]];
    for (var i = 1; i < S.length; i++) {
      if (v <= S[i][0] || i === S.length - 1) {
        var a = S[i - 1], b = S[i];
        var t = (v - a[0]) / (b[0] - a[0]);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        return [Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t), Math.round(a[3] + (b[3] - a[3]) * t)];
      }
    }
    return [16, 22, 32];
  }

  /* 卷积 + ReLU（same padding） */
  function convFeatures(img, G, K) {
    var C = K.length, maps = [], c, r, col, dr, dc, rr, cc, s;
    for (c = 0; c < C; c++) maps.push(new Float64Array(G * G));
    var R = 2;
    for (r = 0; r < G; r++) {
      for (col = 0; col < G; col++) {
        for (c = 0; c < C; c++) {
          s = 0;
          for (dr = -R; dr <= R; dr++) {
            rr = r + dr; if (rr < 0 || rr >= G) continue;
            for (dc = -R; dc <= R; dc++) {
              cc = col + dc; if (cc < 0 || cc >= G) continue;
              s += img[rr * G + cc] * K[c][dr + R][dc + R];
            }
          }
          maps[c][r * G + col] = s > 0 ? s : 0;
        }
      }
    }
    return maps;
  }

  /* ---------- 卷积（ReLU 之前）----------
     给「算法解剖动画」用：动画要展示负响应被截断的过程，
     所以这里把 ReLU 之前的原始点积单独算一份，两者数值完全一致。 */
  function convRaw(img, G, K) {
    var C = K.length, maps = [], c, r, col, dr, dc, rr, cc, s;
    for (c = 0; c < C; c++) maps.push(new Float64Array(G * G));
    var R = 2;
    for (r = 0; r < G; r++) {
      for (col = 0; col < G; col++) {
        for (c = 0; c < C; c++) {
          s = 0;
          for (dr = -R; dr <= R; dr++) {
            rr = r + dr; if (rr < 0 || rr >= G) continue;
            for (dc = -R; dc <= R; dc++) {
              cc = col + dc; if (cc < 0 || cc >= G) continue;
              s += img[rr * G + cc] * K[c][dr + R][dc + R];
            }
          }
          maps[c][r * G + col] = s;
        }
      }
    }
    return maps;
  }

  /* 单个输出位置的一次点积明细：图像块值、核权重、逐项乘积、合计 */
  function convCell(img, G, K, c, r, col) {
    var R = 2, vals = [], kvals = [], prods = [], sum = 0;
    for (var dr = -R; dr <= R; dr++) {
      for (var dc = -R; dc <= R; dc++) {
        var rr = r + dr, cc = col + dc;
        var v = (rr < 0 || rr >= G || cc < 0 || cc >= G) ? 0 : img[rr * G + cc];
        var k = K[c][dr + R][dc + R];
        vals.push(v); kvals.push(k); prods.push(v * k);
        sum += v * k;
      }
    }
    return { vals: vals, kvals: kvals, prods: prods, sum: sum };
  }

  /* 2×2 最大池化 → 四象限均值 → 32 维特征 → L2 归一化 */
  function featureVector(maps, G) {
    var C = maps.length, half = G / 2, f = [], c, r, col, qi, i;
    for (c = 0; c < C; c++) {
      var q = [0, 0, 0, 0], cnt = [0, 0, 0, 0];
      for (r = 0; r < G; r++) {
        for (col = 0; col < G; col++) {
          qi = (r < half ? 0 : 2) + (col < half ? 0 : 1);
          q[qi] += maps[c][r * G + col]; cnt[qi]++;
        }
      }
      for (i = 0; i < 4; i++) f.push(q[i] / cnt[i]);
    }
    var n = 0;
    for (i = 0; i < f.length; i++) n += f[i] * f[i];
    n = Math.sqrt(n) || 1;
    for (i = 0; i < f.length; i++) f[i] /= n;
    return f;
  }

  function extract(p) {
    var pts = cardPoints(p, 180);
    var img = rasterize(pts, p.S || 3, 32);
    var maps = convFeatures(img, 32, KERNELS);
    return { pts: pts, img: img, maps: maps, f: featureVector(maps, 32) };
  }

  /* ---------- 原型库（模拟"离线用带标注数据训练"） ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var PROTO_AMP = 0.55; // 原型覆盖的类内变化幅度
  function jitterAmp(cls, seed, amp) {
    var rnd = mulberry32(seed);
    var base = PRESET[cls];
    var p = { fill: base.fill, gas: base.gas, leak: base.leak, spm: base.spm, broken: base.broken, pound: base.pound };
    if (cls !== '杆断脱') {
      var jf = (cls === '供液不足' ? 0.13 : 0.24) * amp;
      var jg = (cls === '供液不足' ? 0.20 : 0.30) * amp;
      var jl = (cls === '供液不足' ? 0.12 : 0.30) * amp;
      p.fill = Math.min(1, Math.max(0.08, base.fill + (rnd() - 0.5) * 2 * jf));
      p.gas = Math.min(1, Math.max(0, base.gas + (rnd() - 0.5) * 2 * jg));
      p.leak = Math.min(1, Math.max(0, base.leak + (rnd() - 0.5) * 2 * jl));
      p.pound = p.fill < 0.5;
    }
    p.spm = 3 + Math.floor(rnd() * 9);
    p.S = 2.6 + rnd() * 0.8;
    return p;
  }
  var PROTOS = null;
  /* 各通道的"常态能量占比"基线：在全部原型上平均得到。
     CH2（横向边）在闭合曲线上天然占优，比绝对值没有意义；
     拿当前图与基线比，才能看出"这张图的哪类特征异常活跃"。 */
  var EN_BASE = null;
  function chanEnergy(maps) {
    var e = [], c, i, s2;
    for (c = 0; c < maps.length; c++) { s2 = 0; for (i = 0; i < maps[c].length; i++) s2 += maps[c][i]; e.push(s2); }
    return e;
  }
  function buildPrototypes() {
    var P = {}, acc = null, nSample = 0;
    CLASSES.forEach(function (cls) {
      P[cls] = [];
      for (var s = 1; s <= 6; s++) {
        var pp = jitterAmp(cls, s * 613 + cls.length * 17, PROTO_AMP);
        var ex = extract(pp);
        P[cls].push(ex.f);
        var e = chanEnergy(ex.maps), tot = 0, i;
        for (i = 0; i < e.length; i++) tot += e[i];
        if (tot > 0) {
          if (!acc) { acc = []; for (i = 0; i < e.length; i++) acc.push(0); }
          for (i = 0; i < e.length; i++) acc[i] += e[i] / tot;
          nSample++;
        }
      }
    });
    if (acc) { for (var i2 = 0; i2 < acc.length; i2++) acc[i2] /= nSample; EN_BASE = acc; }
    PROTOS = P;
    return P;
  }

  /* ---------- 判定：最近原型 + softmax + OOD 门 ---------- */
  function diag(f, tau) {
    var dist = PROTOS ? CLASSES.map(function (c) {
      var bd = Infinity;
      PROTOS[c].forEach(function (pf) {
        var d = 0;
        for (var i = 0; i < f.length; i++) d += (f[i] - pf[i]) * (f[i] - pf[i]);
        if (d < bd) bd = d;
      });
      return bd;
    }) : CLASSES.map(function () { return 1; });
    var i1 = 0;
    for (var i = 0; i < dist.length; i++) if (dist[i] < dist[i1]) i1 = i;
    var mx = -dist[0] / T, ex = [], i;
    for (i = 0; i < dist.length; i++) if (-dist[i] / T > mx) mx = -dist[i] / T;
    for (i = 0; i < dist.length; i++) ex.push(Math.exp(-dist[i] / T - mx));
    var sum = 0;
    for (i = 0; i < ex.length; i++) sum += ex[i];
    var conf = Math.max.apply(null, ex) / sum;
    return {
      dist: dist, cls: CLASSES[i1], d1: dist[i1], conf: conf,
      probs: ex.map(function (e) { return e / sum; }),
      ood: dist[i1] > (tau === undefined ? TAU : tau),
      lowConf: dist[i1] <= (tau === undefined ? TAU : tau) && conf < CONF_REVIEW
    };
  }

  /* 分流判定。tau 可覆盖全局默认值（屏 3 的阈值滑杆用） */
  function verdictOf(r, tau) {
    tau = (tau === undefined ? TAU : tau);
    if (r.d1 > tau) return { act: 'ood', label: '分布外 · 转人工' };
    if (r.conf < CONF_REVIEW) return { act: 'low', label: '低置信 · 转人工' };
    return { act: 'ok', label: '采纳', cls: r.cls };
  }

  /* =========================================================
     特征空间 2D 投影（PCA · 幂迭代 + 收缩）
     32 维人眼看不见，把它投到方差最大的两个方向上，
     「训练覆盖到哪些形状」就变成了平面上的一簇簇点。
     ========================================================= */
  var PCA = null;
  function buildPCA() {
    var dim = 32, i, d2, all = [];
    CLASSES.forEach(function (c) {
      PROTOS[c].forEach(function (f) { all.push(f); });
    });
    var mu = new Float64Array(dim);
    for (i = 0; i < all.length; i++) for (d2 = 0; d2 < dim; d2++) mu[d2] += all[i][d2] / all.length;
    var X = [];
    for (i = 0; i < all.length; i++) {
      var v = new Float64Array(dim);
      for (d2 = 0; d2 < dim; d2++) v[d2] = all[i][d2] - mu[d2];
      X.push(v);
    }
    function dotv(a, b) { var s = 0; for (var q = 0; q < dim; q++) s += a[q] * b[q]; return s; }
    /* 幂迭代求主方向；exclude 里已求得的方向会被正交剔除 */
    function topPC(exclude) {
      var v = new Float64Array(dim), q, it, a;
      for (q = 0; q < dim; q++) v[q] = Math.sin(0.9 + q * 2.399);
      for (it = 0; it < 90; it++) {
        var nv = new Float64Array(dim);
        for (a = 0; a < X.length; a++) {
          var w = dotv(X[a], v);
          for (q = 0; q < dim; q++) nv[q] += w * X[a][q];
        }
        if (exclude) for (a = 0; a < exclude.length; a++) {
          var p = dotv(nv, exclude[a]);
          for (q = 0; q < dim; q++) nv[q] -= p * exclude[a][q];
        }
        var n = Math.sqrt(dotv(nv, nv)) || 1;
        for (q = 0; q < dim; q++) v[q] = nv[q] / n;
      }
      var lam = 0;
      for (a = 0; a < X.length; a++) { var w2 = dotv(X[a], v); lam += w2 * w2; }
      return { v: v, lam: lam / (X.length - 1) };
    }
    var p1 = topPC(null);
    var p2 = topPC([p1.v]);
    var tot = 0;
    for (i = 0; i < X.length; i++) tot += dotv(X[i], X[i]);
    tot /= (X.length - 1);
    /* 投影保距比：原型两两的投影距离 / 真实 32 维距离（用于把 τ 换算成图上半径） */
    var num = 0, den = 0;
    for (i = 0; i < X.length; i++) {
      for (var j = i + 1; j < X.length; j++) {
        var df = 0, c1 = dotv(X[i], p1.v) - dotv(X[j], p1.v), c2 = dotv(X[i], p2.v) - dotv(X[j], p2.v);
        for (d2 = 0; d2 < dim; d2++) { var dd = X[i][d2] - X[j][d2]; df += dd * dd; }
        num += Math.sqrt(c1 * c1 + c2 * c2); den += Math.sqrt(df);
      }
    }
    PCA = {
      mu: mu, e1: p1.v, e2: p2.v, lam1: p1.lam, lam2: p2.lam, tot: tot,
      ratio: den > 0 ? num / den : 1,
      keep: tot > 0 ? (p1.lam + p2.lam) / tot : 0
    };
    return PCA;
  }

  function project2d(f) {
    var a = 0, b = 0, i;
    for (i = 0; i < f.length; i++) {
      var d = f[i] - PCA.mu[i];
      a += d * PCA.e1[i]; b += d * PCA.e2[i];
    }
    return [a, b];
  }

  /* 凸包（Andrew monotone chain）——画每类的"训练覆盖区域" */
  function hullOf(pts) {
    if (pts.length < 3) return pts.slice();
    var p = pts.slice().sort(function (m, n) { return m[0] - n[0] || m[1] - n[1]; });
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], hi = [], k;
    for (k = 0; k < p.length; k++) {
      while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p[k]) <= 0) lo.pop();
      lo.push(p[k]);
    }
    for (k = p.length - 1; k >= 0; k--) {
      while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p[k]) <= 0) hi.pop();
      hi.push(p[k]);
    }
    lo.pop(); hi.pop();
    return lo.concat(hi);
  }

  /* =========================================================
     二、以下为浏览器端 UI
     ========================================================= */
  function el(id) { return document.getElementById(id); }
  function fmt(v, n) { return Number(v).toFixed(n === undefined ? 2 : n); }

  /* ---------- 全局状态 ---------- */
  var state = {
    p: { fill: 1, gas: 0, leak: 0, spm: 6, S: 3 },  // 当前工况参数
    preset: '正常',
    theta: 0, playing: true, lastT: 0,
    wells: [], selWell: -1, seed: 20261023,
    tau: TAU,          // 当前分布外距离阈值（屏 3 滑杆可调）
    tauCurve: null     // τ 扫描曲线缓存
  };

  /* =========================================================
     屏 1 · 抽油机动画 + 井下泵 + 示功图
     ========================================================= */
  var UNIT_STATIC =
    /* 地面 */
    '<line x1="16" y1="180" x2="404" y2="180" stroke="#d8d2c4" stroke-width="1.5"/>' +
    '<rect x="16" y="180" width="388" height="112" fill="#f7f5ef"/>' +
    '<text x="392" y="288" text-anchor="end" font-size="9.5" fill="#9ba3a9" font-family="monospace">地层</text>' +
    /* 电动机 */
    '<rect x="30" y="136" width="62" height="40" rx="6" fill="#f1f1ee" stroke="#b9c0c5"/>' +
    '<text x="61" y="160" text-anchor="middle" font-size="10" fill="#4d565b">电动机</text>' +
    '<g id="uFan"><circle cx="44" cy="168" r="7" fill="none" stroke="#79828a"/><line x1="44" y1="168" x2="44" y2="161" stroke="#79828a" stroke-width="1.4"/></g>' +
    /* 减速箱 */
    '<rect x="102" y="128" width="68" height="52" rx="6" fill="#f1f1ee" stroke="#b9c0c5"/>' +
    '<text x="136" y="158" text-anchor="middle" font-size="10" fill="#4d565b">减速箱</text>' +
    '<line x1="170" y1="154" x2="216" y2="154" stroke="#79828a" stroke-width="3" stroke-linecap="round"/>' +
    /* 曲柄 */
    '<circle id="uCrankGuide" cx="216" cy="154" r="30" fill="none" stroke="#e9e4d8" stroke-dasharray="3 3"/>' +
    '<line id="uCrankArm" x1="216" y1="154" x2="246" y2="154" stroke="#b26a39" stroke-width="3" stroke-linecap="round"/>' +
    '<circle id="uPin" cx="246" cy="154" r="4.5" fill="#b26a39"/>' +
    '<text x="216" y="200" text-anchor="middle" font-size="9.5" fill="#9ba3a9">曲柄</text>' +
    /* 游梁（支点 + 横梁 + 尾轴承 + 驴头） */
    '<circle cx="280" cy="80" r="6" fill="#2f7d6b"/>' +
    '<text x="280" y="66" text-anchor="middle" font-size="9.5" fill="#2f7d6b">支点</text>' +
    '<g id="uBeam">' +
    '<rect x="160" y="74" width="240" height="12" rx="5" fill="#e6f1ec" stroke="#2f7d6b" stroke-opacity=".45"/>' +
    '<circle id="uTail" cx="160" cy="80" r="5" fill="#2f7d6b"/>' +
    '<path d="M400 62 a20 20 0 0 1 0 36 a14 14 0 0 0 0 -36 Z" fill="#f8ecdf" stroke="#b26a39" stroke-opacity=".5"/>' +
    '</g>' +
    '<text x="400" y="46" text-anchor="middle" font-size="9.5" fill="#b26a39">驴头</text>' +
    /* 连杆 */
    '<line id="uPitman" x1="246" y1="154" x2="160" y2="80" stroke="#4d565b" stroke-width="2.4" stroke-linecap="round"/>' +
    '<text x="128" y="106" text-anchor="middle" font-size="9.5" fill="#9ba3a9">连杆</text>' +
    /* 死点线 */
    '<line x1="342" y1="56.1" x2="418" y2="56.1" stroke="#c9c2b0" stroke-dasharray="3 3"/>' +
    '<line x1="342" y1="103.9" x2="418" y2="103.9" stroke="#c9c2b0" stroke-dasharray="3 3"/>' +
    '<text x="340" y="52" text-anchor="end" font-size="8.5" fill="#9ba3a9" font-family="monospace">上死点</text>' +
    '<text x="340" y="112" text-anchor="end" font-size="8.5" fill="#9ba3a9" font-family="monospace">下死点</text>' +
    /* 光杆 + 井口 */
    '<line id="uRod" x1="400" y1="100" x2="400" y2="258" stroke="#4d565b" stroke-width="2.6"/>' +
    '<rect x="386" y="168" width="28" height="16" rx="3" fill="#f1f1ee" stroke="#b9c0c5"/>' +
    '<text x="400" y="179" text-anchor="middle" font-size="8.5" fill="#4d565b">盘根盒</text>' +
    '<text x="404" y="150" font-size="9.5" fill="#4d565b">光杆</text>' +
    /* 传感器徽标 */
    '<rect x="286" y="116" width="60" height="18" rx="9" fill="#e6f1ec" stroke="#2f7d6b" stroke-opacity=".4"/>' +
    '<text x="316" y="129" text-anchor="middle" font-size="9.5" fill="#2f7d6b">载荷传感器</text>' +
    '<line x1="346" y1="125" x2="396" y2="138" stroke="#2f7d6b" stroke-width="1" stroke-dasharray="2 2"/>' +
    '<rect x="196" y="30" width="72" height="18" rx="9" fill="#e7eef9" stroke="#41699b" stroke-opacity=".4"/>' +
    '<text x="232" y="43" text-anchor="middle" font-size="9.5" fill="#41699b">位移传感器</text>' +
    '<line x1="262" y1="48" x2="276" y2="70" stroke="#41699b" stroke-width="1" stroke-dasharray="2 2"/>' +
    /* 断脱标记（默认隐藏） */
    '<g id="uBreak" style="display:none">' +
    '<line x1="390" y1="140" x2="410" y2="160" stroke="#b05a51" stroke-width="2.4"/>' +
    '<line x1="410" y1="140" x2="390" y2="160" stroke="#b05a51" stroke-width="2.4"/>' +
    '<text x="400" y="134" text-anchor="middle" font-size="9.5" font-weight="700" fill="#b05a51">杆柱断脱</text>' +
    '</g>' +
    /* 井筒与杆柱 */
    '<line x1="388" y1="180" x2="388" y2="292" stroke="#b9c0c5"/>' +
    '<line x1="412" y1="180" x2="412" y2="292" stroke="#b9c0c5"/>' +
    '<line id="uRodStr" x1="400" y1="196" x2="400" y2="262" stroke="#4d565b" stroke-width="2.2"/>' +
    '<text x="400" y="276" text-anchor="middle" font-size="9.5" fill="#9ba3a9">抽油杆柱 ↓ 接井下泵</text>';

  var PUMP_STATIC =
    '<rect x="70" y="6" width="280" height="184" fill="#f7f5ef"/>' +
    '<line x1="70" y1="6" x2="70" y2="190" stroke="#b9c0c5" stroke-width="2"/>' +
    '<line x1="350" y1="6" x2="350" y2="190" stroke="#b9c0c5" stroke-width="2"/>' +
    '<text x="78" y="20" font-size="9.5" fill="#9ba3a9">井壁（套管）</text>' +
    /* 油管 */
    '<line x1="160" y1="6" x2="160" y2="190" stroke="#b9c0c5" stroke-width="3"/>' +
    '<line x1="260" y1="6" x2="260" y2="190" stroke="#b9c0c5" stroke-width="3"/>' +
    '<text x="154" y="98" text-anchor="end" font-size="9.5" fill="#9ba3a9">油管</text>' +
    /* 泵筒与流体 */
    '<rect x="176" y="64" width="68" height="106" rx="3" fill="#fff" stroke="#41699b" stroke-width="1.4"/>' +
    '<rect id="pGas" x="178" y="66" width="64" height="40" fill="#f7e8c8"/>' +
    '<rect id="pLiquid" x="178" y="106" width="64" height="64" fill="#cfe0f2"/>' +
    '<line id="pLevel" x1="172" y1="106" x2="248" y2="106" stroke="#c98a2b" stroke-width="1.2" stroke-dasharray="4 3"/>' +
    '<text id="pLevelT" x="264" y="109" font-size="9.5" fill="#c98a2b" font-family="monospace">充满系数 100%</text>' +
    '<text id="pGasT" x="210" y="86" text-anchor="middle" font-size="9.5" fill="#a87f24">气体</text>' +
    /* 阀件与柱塞 */
    '<rect id="pPlunger" x="182" y="150" width="56" height="9" rx="2" fill="#d8d2c4" stroke="#9ba3a9"/>' +
    '<rect id="pTravel" x="212" y="141" width="16" height="6" rx="1" fill="#79828a"/>' +
    '<rect x="212" y="162" width="16" height="8" rx="1" fill="#79828a"/>' +
    '<text id="pPlungerT" x="300" y="155" font-size="9.5" fill="#4d565b">柱塞</text>' +
    '<text x="300" y="170" font-size="9.5" fill="#4d565b">固定阀</text>' +
    '<line x1="292" y1="167" x2="230" y2="167" stroke="#9ba3a9" stroke-width=".8"/>' +
    /* 进出流 */
    '<line id="pOut" x1="210" y1="120" x2="210" y2="34" stroke="#41699b" stroke-width="1.6"/>' +
    '<path id="pOutHead" d="M210 26 l-4 8 M210 26 l4 8" stroke="#41699b" stroke-width="1.6" fill="none"/>' +
    '<text x="222" y="22" font-size="9.5" fill="#41699b">排油（进集油管线）</text>' +
    '<path d="M104 152 h56 m-6-4 6 4-6 4" stroke="#41699b" stroke-width="1.6" fill="none"/>' +
    '<text x="104" y="142" font-size="9.5" fill="#41699b">进油</text>' +
    '<text x="210" y="188" text-anchor="middle" font-size="8.5" fill="#9ba3a9">泵筒 / 柱塞 / 阀门为示意放大，实际泵挂深度约 1000 m</text>';

  function buildUnit() {
    el('unitSvg').innerHTML = UNIT_STATIC;
    el('pumpSvg').innerHTML = PUMP_STATIC;
  }

  /* ---------- 示功图 ---------- */
  var CARD = { L: 64, R: 414, T: 16, B: 296 };
  var cardPaths = null; // { up: 'M...', down: 'M...' }

  function cardX(x) { return CARD.L + x / state.p.S * (CARD.R - CARD.L); }
  function cardY(y) { return CARD.B - y / Ymax * (CARD.B - CARD.T); }

  function drawCardFrame() {
    var s = '';
    /* 网格与坐标 */
    var i, v, y, x;
    for (v = 0; v <= 80; v += 20) {
      y = cardY(v);
      s += '<line x1="' + CARD.L + '" y1="' + y + '" x2="' + CARD.R + '" y2="' + y + '" stroke="#efece1"/>' +
        '<text x="' + (CARD.L - 7) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="9.5" font-family="monospace" fill="#9ba3a9">' + v + '</text>';
    }
    for (i = 0; i <= 4; i++) {
      x = CARD.L + i / 4 * (CARD.R - CARD.L);
      s += '<line x1="' + x + '" y1="' + CARD.T + '" x2="' + x + '" y2="' + CARD.B + '" stroke="#f4f1e9"/>' +
        '<text x="' + x + '" y="' + (CARD.B + 14) + '" text-anchor="middle" font-size="9.5" font-family="monospace" fill="#9ba3a9">' + fmt(i / 4 * state.p.S, 1) + '</text>';
    }
    s += '<text x="' + ((CARD.L + CARD.R) / 2) + '" y="' + (CARD.B + 30) + '" text-anchor="middle" font-size="10" fill="#79828a">光杆位移 / m</text>';
    s += '<text transform="rotate(-90 16 156)" x="16" y="156" text-anchor="middle" font-size="10" fill="#79828a">光杆载荷 / kN</text>';
    /* 理论载荷线 */
    var yWr = cardY(Wr), yWf = cardY(Wr + WfMax * state.p.fill);
    s += '<line x1="' + CARD.L + '" y1="' + yWr + '" x2="' + CARD.R + '" y2="' + yWr + '" stroke="#b9c0c5" stroke-dasharray="5 4"/>' +
      '<text x="' + (CARD.L + 4) + '" y="' + (yWr + 12) + '" font-size="9.5" fill="#9ba3a9">杆重 Wr=' + Wr + ' kN</text>' +
      '<line x1="' + CARD.L + '" y1="' + yWf + '" x2="' + CARD.R + '" y2="' + yWf + '" stroke="#2f7d6b" stroke-dasharray="2 3" opacity=".55"/>' +
      '<text x="' + (CARD.L + 4) + '" y="' + (yWf - 5) + '" font-size="9.5" fill="#2f7d6b">满载 Wr+Wf=' + fmt(Wr + WfMax * state.p.fill, 0) + ' kN</text>';
    /* 图例 */
    s += '<line x1="286" y1="12" x2="306" y2="12" stroke="#2f7d6b" stroke-width="2.4"/><text x="310" y="15" font-size="9.5" fill="#4d565b">上冲程</text>' +
      '<line x1="352" y1="12" x2="372" y2="12" stroke="#b26a39" stroke-width="2.4"/><text x="376" y="15" font-size="9.5" fill="#4d565b">下冲程</text>';
    /* 动态层 */
    s += '<g id="cardDyn"></g>';
    el('cardSvg').innerHTML = s;
  }

  function drawCardDynamic() {
    var pts = cardPoints(state.p, 180);
    var up = '', down = '', k;
    for (k = 0; k < pts.length; k++) {
      var X = cardX(pts[k][0]), Y = cardY(Math.max(0, Math.min(Ymax, pts[k][1])));
      var seg = (k ? 'L' : 'M') + X.toFixed(1) + ' ' + Y.toFixed(1);
      if (k < 90) up += seg; else down += seg;
    }
    var s = '<path d="' + up + '" fill="none" stroke="#2f7d6b" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<path d="M' + cardX(pts[90][0]).toFixed(1) + ' ' + cardY(pts[90][1]).toFixed(1) + ' ' + down + '" fill="none" stroke="#b26a39" stroke-width="1.8" stroke-linejoin="round"/>';
    var g = el('cardDyn');
    if (g) g.innerHTML = s;
    cardPaths = pts;
  }

  /* ---------- 帧动画 ---------- */
  function frame(ts) {
    if (!state.lastT) state.lastT = ts;
    var dt = Math.min(0.1, (ts - state.lastT) / 1000);
    state.lastT = ts;
    if (state.playing) {
      var w = 2 * Math.PI * state.p.spm / 60;
      state.theta = (state.theta + w * dt) % (2 * Math.PI);
    }
    renderMotion();
    requestAnimationFrame(frame);
  }

  function renderMotion() {
    var th = state.theta, p = state.p, S = p.S;
    var x = S / 2 * (1 - Math.cos(th));
    var pts = cardPaths || cardPoints(p, 180);
    var idx = Math.round(th / (2 * Math.PI) * 179);
    var load = pts[idx][1];

    /* 抽油机 */
    var a = (1 - 2 * x / S) * 11.5;                 // 游梁角（度，正=低头）
    var rad = a * Math.PI / 180;
    var beam = el('uBeam');
    if (beam) beam.setAttribute('transform', 'rotate(' + a.toFixed(2) + ' 280 80)');
    var tipY = 80 + 120 * Math.sin(rad);
    var tailX = 280 - 120 * Math.cos(rad), tailY = 80 - 120 * Math.sin(rad);
    var pinX = 216 + 30 * Math.cos(th), pinY = 154 + 30 * Math.sin(th);
    var pit = el('uPitman');
    if (pit) { pit.setAttribute('x2', pinX.toFixed(1)); pit.setAttribute('y2', pinY.toFixed(1)); pit.setAttribute('x1', tailX.toFixed(1)); pit.setAttribute('y1', tailY.toFixed(1)); }
    var pin = el('uPin');
    if (pin) { pin.setAttribute('cx', pinX.toFixed(1)); pin.setAttribute('cy', pinY.toFixed(1)); }
    var arm = el('uCrankArm');
    if (arm) { arm.setAttribute('x2', pinX.toFixed(1)); arm.setAttribute('y2', pinY.toFixed(1)); }
    var fan = el('uFan');
    if (fan) fan.setAttribute('transform', 'rotate(' + (th * 57.3 * 6).toFixed(0) + ' 44 168)');
    var rod = el('uRod');
    if (rod) rod.setAttribute('y1', (tipY + 8).toFixed(1));

    /* 井下泵 */
    var plungerY = 68 + (1 - x / S) * 100;
    var yL = 170 - p.fill * 106;
    var pl = el('pPlunger');
    if (pl) pl.setAttribute('y', plungerY.toFixed(1));
    var tv = el('pTravel');
    if (tv) tv.setAttribute('y', (plungerY - 9).toFixed(1));
    var lq = el('pLiquid');
    if (lq) { lq.setAttribute('y', yL.toFixed(1)); lq.setAttribute('height', Math.max(0, 170 - yL).toFixed(1)); }
    var gs = el('pGas');
    if (gs) { gs.setAttribute('height', Math.max(0, yL - 66).toFixed(1)); gs.style.display = (yL - 66 > 2) ? '' : 'none'; }
    var lv = el('pLevel');
    if (lv) lv.setAttribute('y1', yL.toFixed(1)), lv.setAttribute('y2', yL.toFixed(1));
    var lt = el('pLevelT');
    if (lt) lt.textContent = '充满系数 ' + Math.round(p.fill * 100) + '%';
    var gt = el('pGasT');
    if (gt) { gt.style.display = (yL - 66 > 14) ? '' : 'none'; gt.setAttribute('y', (66 + (yL - 66) / 2 + 3).toFixed(1)); }
    var pt = el('pPlungerT');
    if (pt) pt.setAttribute('y', (plungerY + 7).toFixed(1));
    var po = el('pOut');
    if (po) { po.setAttribute('y1', (plungerY - 14).toFixed(1)); po.style.display = p.broken ? 'none' : ''; }
    var poh = el('pOutHead');
    if (poh) poh.style.display = p.broken ? 'none' : '';

    /* 读数 */
    el('roSpm').textContent = p.spm;
    el('roS').textContent = fmt(S, 1) + ' m';
    el('roPhase').textContent = th < Math.PI ? '上冲程' : '下冲程';
    el('roPhase').style.color = th < Math.PI ? 'var(--jade-d)' : 'var(--clay)';
    el('roLoad').textContent = fmt(load, 1) + ' kN';

    /* 示功图游标 */
    var g = el('cardDyn');
    if (g && cardPaths) {
      var cx = cardX(x), cy = cardY(Math.max(0, Math.min(Ymax, load)));
      var mark = '<line x1="' + cx + '" y1="' + CARD.T + '" x2="' + cx + '" y2="' + CARD.B + '" stroke="#c9c2b0" stroke-dasharray="2 3"/>' +
        '<line x1="' + CARD.L + '" y1="' + cy + '" x2="' + CARD.R + '" y2="' + cy + '" stroke="#c9c2b0" stroke-dasharray="2 3"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="#b26a39" stroke="#fff" stroke-width="1.2"/>' +
        '<text x="' + (cx + 7) + '" y="' + (cy - 6) + '" font-size="9.5" font-family="monospace" fill="#b26a39">' + fmt(x, 2) + ' m / ' + fmt(load, 1) + ' kN</text>';
      var exist = el('cardMark');
      if (exist) exist.innerHTML = mark;
      else {
        var mk = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        mk.setAttribute('id', 'cardMark');
        g.parentNode.appendChild(mk);
        mk.innerHTML = mark;
      }
    }
  }

  /* =========================================================
     屏 2 · 分类器前向演示
     ========================================================= */
  function renderNN() {
    var ex = extract(state.p);
    var r = diag(ex.f, state.tau);
    var v = verdictOf(r, state.tau);
    state.lastNN = { ex: ex, r: r, v: v };

    /* ① 输入灰度图 */
    var cv = el('nnIn'), ctx = cv.getContext('2d');
    var id = ctx.createImageData(32, 32), px = id.data;
    for (var i = 0; i < 1024; i++) {
      var g = Math.round((1 - ex.img[i]) * 255);
      px[i * 4] = g; px[i * 4 + 1] = g; px[i * 4 + 2] = g; px[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);

    /* ② 特征图 + 卷积核
       布局（每格自上而下）：32×32 响应图（随输入变）→ 响应能量条（随输入变）
       → 5×5 卷积核权重（训练后固定不变）→ 通道名 */
    var grid = el('featGrid');
    if (!grid.childElementCount) {
      var h = '';
      for (var c = 0; c < 8; c++) {
        h += '<div class="feat">' +
          '<canvas class="fmap" width="32" height="32"></canvas>' +
          '<div class="resp"><i id="resp' + c + '"></i></div>' +
          '<div class="kwrap" id="kwrap' + c + '"><div class="kmat" id="kmat' + c + '"></div></div>' +
          '<div class="fn" id="fn' + c + '">CH' + (c + 1) + ' · ' + KERNEL_NAME[c] + '</div>' +
          '</div>';
      }
      grid.innerHTML = h;
      /* 卷积核权重小格：这是模型的参数，训练完就锁死，所以永远长一样 */
      for (var c2 = 0; c2 < 8; c2++) {
        var km = el('kmat' + c2), kk = KERNELS[c2], mx = 0, hh = '';
        for (var a = 0; a < 25; a++) mx = Math.max(mx, Math.abs(kk[Math.floor(a / 5)][a % 5]));
        for (var b = 0; b < 25; b++) {
          var w = kk[Math.floor(b / 5)][b % 5];
          var op = Math.max(0.12, Math.abs(w) / mx);
          hh += '<i style="background:' + (w >= 0 ? 'rgba(47,125,107,' : 'rgba(178,106,57,') + op.toFixed(2) + ')"></i>';
        }
        km.innerHTML = hh;
      }
    }
    /* 注意：maps 是 32×32 = 1024，canvas 也必须是 32×32。
       早先写成 16×16 只画了前 256 个（最上面 8 行），
       而示功图曲线几乎不经过顶部，导致所有工况的特征图看起来全黑不变。 */
    var maps = ex.maps;

    /* 各通道能量占比 vs 基线 → 响应条 + 主力通道高亮（这是随输入变化的部分） */
    var en = chanEnergy(maps), enTot = 0;
    for (var c0 = 0; c0 < 8; c0++) enTot += en[c0];
    if (enTot <= 0) enTot = 1;
    var rel = [], share = [];
    for (var c1 = 0; c1 < 8; c1++) {
      share[c1] = en[c1] / enTot;
      rel[c1] = EN_BASE ? share[c1] / (EN_BASE[c1] || 1e-6) : 0;
    }
    var rank = rel.map(function (v, i) { return [v, i]; }).sort(function (a, b) { return b[0] - a[0]; });

    for (var c3 = 0; c3 < 8; c3++) {
      var cnv = grid.children[c3].querySelector('canvas');
      var cx2 = cnv.getContext('2d');
      var m = maps[c3];
      /* 用 98 分位而非最大值做归一化：最大像素常年贴在饱和上限 4.0，
         会把中间响应压成接近纯黑；p98 + gamma 0.62 能把暗部纹理拉回来。 */
      var nz = [], mi;
      for (mi = 0; mi < 1024; mi++) if (m[mi] > 1e-4) nz.push(m[mi]);
      var norm = 1;
      if (nz.length) { nz.sort(function (a2, b2) { return a2 - b2; }); norm = nz[Math.floor(nz.length * 0.98)] || nz[nz.length - 1]; }
      var id2 = cx2.createImageData(32, 32), p2 = id2.data;
      for (var q2 = 0; q2 < 1024; q2++) {
        var rr = Math.floor(q2 / 32), cc = q2 % 32;
        var col;
        if (nz.length === 0) {
          /* 真的零响应：画斜纹,别让它看起来像"图没刷新" */
          col = ((rr + cc) % 8 < 2) ? [40, 48, 60] : [22, 27, 36];
        } else {
          var vv = m[q2] / norm; vv = vv < 0 ? 0 : vv > 1 ? 1 : vv;
          col = heat(Math.pow(vv, 0.62));
          /* 叠一层象限分割线（下一步就是按这四块取均值）；压得很暗，不与真实响应抢视觉 */
          if (rr === 16 || cc === 16) col = [Math.round(col[0] * 0.5 + 17), Math.round(col[1] * 0.5 + 20), Math.round(col[2] * 0.5 + 26)];
        }
        p2[q2 * 4] = col[0]; p2[q2 * 4 + 1] = col[1]; p2[q2 * 4 + 2] = col[2]; p2[q2 * 4 + 3] = 255;
      }
      cx2.putImageData(id2, 0, 0);

      /* 响应条 + 主力高亮：让"固定的核"这一格里有东西随输入跳动。
         条长 = 该通道能量占比相对常态的倍数（基线 1.0× 落在中点），>1 说明这类特征异常活跃。 */
      var rb = el('resp' + c3);
      if (rb) {
        rb.style.width = Math.min(100, rel[c3] / 2 * 100).toFixed(1) + '%';
        if (rb.parentNode) rb.parentNode.title = '能量占比 ' + (share[c3] * 100).toFixed(1) + '%，是常态的 ' + rel[c3].toFixed(2) + '×';
      }
      var kw = el('kwrap' + c3);
      if (kw) {
        kw.className = 'kwrap' + (rank[0][1] === c3 ? ' hot1' : (rank[1][1] === c3 ? ' hot2' : '')) +
          (rel[c3] < 0.5 ? ' dim' : '');
      }
      var fnEl = el('fn' + c3);
      if (fnEl) fnEl.textContent = nz.length ? ('CH' + (c3 + 1) + ' · ' + KERNEL_NAME[c3]) : ('CH' + (c3 + 1) + ' · 无响应');
    }
    /* 32 维特征条（按 8 个通道分组着色） */
    var strip = el('fstrip');
    if (!strip.childElementCount) {
      var sh = '';
      for (var s3 = 0; s3 < 32; s3++) sh += '<i style="background:' + CH_COLOR[Math.floor(s3 / 4)] + '"></i>';
      strip.innerHTML = sh;
    }
    var fmax = 0.0001;
    for (var s4 = 0; s4 < 32; s4++) fmax = Math.max(fmax, ex.f[s4]);
    for (var s5 = 0; s5 < 32; s5++) strip.children[s5].style.height = (ex.f[s5] / fmax * 100).toFixed(1) + '%';

    /* ③ 类别概率条形图 */
    var cs = '';
    var barX = 74, barW = 190, rowH = 25;
    cs += '<line x1="' + (barX + 0.75 * barW) + '" y1="10" x2="' + (barX + 0.75 * barW) + '" y2="138" stroke="#b05a51" stroke-dasharray="4 3" stroke-width="1"/>' +
      '<text x="' + (barX + 0.75 * barW + 4) + '" y="14" font-size="8.5" fill="#b05a51" font-family="monospace">阈值 0.75</text>';
    for (var c4 = 0; c4 < 5; c4++) {
      var yy = 16 + c4 * rowH;
      var prob = r.probs[c4];
      var top = CLASSES[c4] === r.cls;
      cs += '<text x="66" y="' + (yy + 13) + '" text-anchor="end" font-size="10.5" fill="' + CLASS_COLOR[CLASSES[c4]] + '"' + (top ? ' font-weight="700"' : '') + '>' + CLASSES[c4] + '</text>' +
        '<rect x="' + barX + '" y="' + (yy + 3) + '" width="' + Math.max(1, prob * barW).toFixed(1) + '" height="14" rx="3" fill="' + CLASS_COLOR[CLASSES[c4]] + '" opacity="' + (top ? 0.95 : 0.5) + '"/>' +
        '<text x="' + (barX + Math.max(1, prob * barW) + 5) + '" y="' + (yy + 14) + '" font-size="9.5" font-family="monospace" fill="#4d565b">' + prob.toFixed(2) + '</text>';
    }
    el('confSvg').innerHTML = cs;

    /* ④ 分布外距离 */
    var os = '', dw = Math.min(1, r.d1 / 0.3) * 240, tx = 16 + state.tau / 0.3 * 240;
    os += '<text x="16" y="14" font-size="9.5" fill="#79828a">到最近原型（' + r.cls + '）的距离</text>' +
      '<rect x="16" y="22" width="240" height="14" rx="3" fill="#f1f1ee"/>' +
      '<rect x="16" y="22" width="' + dw.toFixed(1) + '" height="14" rx="3" fill="' + (r.ood ? '#b05a51' : '#2f7d6b') + '"/>' +
      '<line x1="' + tx.toFixed(1) + '" y1="18" x2="' + tx.toFixed(1) + '" y2="40" stroke="#b05a51" stroke-dasharray="3 2"/>' +
      '<text x="' + (tx + 4).toFixed(1) + '" y="14" font-size="8.5" fill="#b05a51" font-family="monospace">τ=' + state.tau.toFixed(2) + '</text>' +
      '<text x="' + (16 + dw + 6) + '" y="34" font-size="10" font-family="monospace" fill="#4d565b">' + r.d1.toFixed(3) + '</text>';
    el('oodSvg').innerHTML = os;

    /* 判定卡 */
    var box = el('verdictBox');
    box.className = 'verdict ' + (v.act === 'ok' ? 'ok' : v.act === 'low' ? 'warn' : 'bad');
    el('verdictV').textContent = v.act === 'ok' ? '采纳 · ' + r.cls : v.label;
    var tauTxt = state.tau.toFixed(2);
    el('verdictP').textContent = v.act === 'ok'
      ? '置信度 ' + r.conf.toFixed(2) + ' ≥ 0.75，且形状落在训练覆盖范围内（距离 ' + r.d1.toFixed(3) + ' ≤ ' + tauTxt + '），直接出结论。'
      : v.act === 'low'
        ? '形状虽在覆盖范围内，但类别概率分散（置信度 ' + r.conf.toFixed(2) + ' < 0.75），可能是轻度复合故障——按流程转人工复核。'
        : '形状落到了训练覆盖之外的区域（距离 ' + r.d1.toFixed(3) + ' > ' + tauTxt + '）。纯分类器在这种情况下仍会给出一个"自信"的错答案，工程上用距离阈值拦下——转人工。';

    /* 屏 1 读数同步 */
    el('roPred').textContent = r.cls;
    el('roPred').style.color = CLASS_COLOR[r.cls];
    el('roConf').textContent = r.conf.toFixed(2);
    el('roConf').className = v.act === 'ok' ? 'ok' : 'warn';
    el('roDist').textContent = r.d1.toFixed(3);
    el('roDist').className = r.ood ? 'bad' : 'ok';
    el('roAct').textContent = v.act === 'ok' ? '直接出结论' : '转人工复核';
    el('roAct').className = v.act === 'ok' ? 'ok' : 'warn';

    renderFSpace();
  }

  /* =========================================================
     特征空间地图：32 维 → PC1/PC2 散点
     把"训练数据覆盖到哪些形状"画成平面上的簇，
     当前这张示功图投上去后，落在簇内还是落在空洞里，一眼可见。
     ========================================================= */
  function renderFSpace() {
    var svg = el('fspaceSvg');
    if (!svg || !PCA || !state.lastNN) return;
    var W = 700, H = 300, PL = 52, PR = 16, PT = 18, PB = 34;
    var i, c, s = '';

    /* 各类原型的投影点 */
    var groups = {};
    CLASSES.forEach(function (cls) {
      groups[cls] = PROTOS[cls].map(function (f) { return project2d(f); });
    });
    var r = state.lastNN.r, f = state.lastNN.ex.f;
    var cur = project2d(f);

    /* 32 维最近的那个原型（与 diag 的判定一致） */
    var bi = 0, bd = Infinity;
    PROTOS[r.cls].forEach(function (pf, idx) {
      var d = 0;
      for (var k = 0; k < pf.length; k++) { var dd = pf[k] - f[k]; d += dd * dd; }
      if (d < bd) { bd = d; bi = idx; }
    });
    var near = groups[r.cls][bi];

    /* 统一 scale（保持纵横比，圆才是正圆、距离才不失真） */
    var minX = cur[0], maxX = cur[0], minY = cur[1], maxY = cur[1];
    CLASSES.forEach(function (cls) {
      groups[cls].forEach(function (q) {
        minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]);
        minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]);
      });
    });
    var padX = (maxX - minX) * 0.12 || 0.05, padY = (maxY - minY) * 0.12 || 0.05;
    minX -= padX; maxX += padX; minY -= padY; maxY += padY;
    var sc = Math.min((W - PL - PR) / (maxX - minX), (H - PT - PB) / (maxY - minY));
    var ox = PL + (W - PL - PR) / 2 - (minX + maxX) / 2 * sc;
    var oy = PT + (H - PT - PB) / 2 + (minY + maxY) / 2 * sc;
    function px(a) { return ox + a * sc; }
    function py(b) { return oy - b * sc; }

    /* 网格 */
    s += '<rect x="' + PL + '" y="' + PT + '" width="' + (W - PL - PR) + '" height="' + (H - PT - PB) + '" fill="#fdfdfb" stroke="#e9e4d8"/>';
    for (i = 1; i < 5; i++) {
      var gy = PT + (H - PT - PB) * i / 5, gx = PL + (W - PL - PR) * i / 5;
      s += '<line x1="' + PL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + gy.toFixed(1) + '" stroke="#f0ece1"/>';
      s += '<line x1="' + gx.toFixed(1) + '" y1="' + PT + '" x2="' + gx.toFixed(1) + '" y2="' + (H - PB) + '" stroke="#f0ece1"/>';
    }
    /* 过零点的十字轴 */
    s += '<line x1="' + px(0).toFixed(1) + '" y1="' + PT + '" x2="' + px(0).toFixed(1) + '" y2="' + (H - PB) + '" stroke="#d8d2c4" stroke-dasharray="3 3"/>';
    s += '<line x1="' + PL + '" y1="' + py(0).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + py(0).toFixed(1) + '" stroke="#d8d2c4" stroke-dasharray="3 3"/>';
    s += '<text x="' + (W - PR - 2) + '" y="' + (H - PB + 14) + '" text-anchor="end" font-size="9.5" fill="#9ba3a9" font-family="monospace">PC1 · 保留 ' + (PCA.lam1 / PCA.tot * 100).toFixed(0) + '%</text>';
    s += '<text x="' + (PL - 6) + '" y="' + (PT + 10) + '" text-anchor="end" font-size="9.5" fill="#9ba3a9" font-family="monospace">PC2 · ' + (PCA.lam2 / PCA.tot * 100).toFixed(0) + '%</text>';

    /* 每类：凸包（覆盖区域）+ 原型点 + 类标签 */
    CLASSES.forEach(function (cls) {
      var col = CLASS_COLOR[cls], pts = groups[cls];
      var hp = hullOf(pts), dpath = '';
      hp.forEach(function (q, k) { dpath += (k ? 'L' : 'M') + px(q[0]).toFixed(1) + ' ' + py(q[1]).toFixed(1) + ' '; });
      s += '<path d="' + dpath + 'Z" fill="' + col + '" fill-opacity=".07" stroke="' + col + '" stroke-opacity=".45" stroke-width="1.2" stroke-dasharray="5 3"/>';
      pts.forEach(function (q) {
        s += '<circle cx="' + px(q[0]).toFixed(1) + '" cy="' + py(q[1]).toFixed(1) + '" r="3.1" fill="#fff" stroke="' + col + '" stroke-width="1.4"/>';
      });
      /* 类标签放在簇的重心 */
      var cx = 0, cy = 0;
      pts.forEach(function (q) { cx += q[0] / pts.length; cy += q[1] / pts.length; });
      s += '<text x="' + px(cx).toFixed(1) + '" y="' + (py(cy) - 9).toFixed(1) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="' + col + '">' + cls + '</text>';
    });

    /* τ 等距圈：半径按投影保距比换算 */
    var rad = state.tau * PCA.ratio * sc;
    s += '<circle cx="' + px(near[0]).toFixed(1) + '" cy="' + py(near[1]).toFixed(1) + '" r="' + rad.toFixed(1) + '" fill="none" stroke="#b05a51" stroke-opacity=".55" stroke-width="1.1" stroke-dasharray="4 3"/>';
    /* 当前点 → 最近原型 */
    s += '<line x1="' + px(cur[0]).toFixed(1) + '" y1="' + py(cur[1]).toFixed(1) + '" x2="' + px(near[0]).toFixed(1) + '" y2="' + py(near[1]).toFixed(1) + '" stroke="' + (r.ood ? '#b05a51' : '#2f7d6b') + '" stroke-width="1.3" stroke-dasharray="3 2"/>';
    /* 当前点（大实心 + 十字准线） */
    var ccx = px(cur[0]), ccy = py(cur[1]);
    s += '<line x1="' + PL + '" y1="' + ccy.toFixed(1) + '" x2="' + ccx.toFixed(1) + '" y2="' + ccy.toFixed(1) + '" stroke="' + (r.ood ? '#b05a51' : '#2f7d6b') + '" stroke-opacity=".3"/>';
    s += '<line x1="' + ccx.toFixed(1) + '" y1="' + ccy.toFixed(1) + '" x2="' + ccx.toFixed(1) + '" y2="' + (H - PB) + '" stroke="' + (r.ood ? '#b05a51' : '#2f7d6b') + '" stroke-opacity=".3"/>';
    s += '<circle cx="' + ccx.toFixed(1) + '" cy="' + ccy.toFixed(1) + '" r="6.5" fill="' + (r.ood ? '#b05a51' : '#2f7d6b') + '" stroke="#fff" stroke-width="2"/>';
    s += '<text x="' + (ccx + 10).toFixed(1) + '" y="' + (ccy - 6).toFixed(1) + '" font-size="10" font-weight="700" fill="' + (r.ood ? '#b05a51' : '#2f7d6b') + '">当前井 d=' + r.d1.toFixed(3) + '</text>';
    /* τ 圈说明 */
    s += '<text x="' + px(near[0]).toFixed(1) + '" y="' + (py(near[1]) - rad - 4).toFixed(1) + '" text-anchor="middle" font-size="8.5" fill="#b05a51" font-family="monospace">τ=' + state.tau.toFixed(2) + ' 覆盖半径</text>';

    svg.innerHTML = s;

    /* 侧栏图例 + 解读 */
    var lg = el('fsLegend');
    if (lg) {
      var h = '<div class="lg-t">图例</div>';
      CLASSES.forEach(function (cls) {
        h += '<div class="lg-i"><i style="border-color:' + CLASS_COLOR[cls] + '"></i>' + cls + '<span>×6 原型</span></div>';
      });
      h += '<div class="lg-i"><i class="dot" style="background:' + (r.ood ? '#b05a51' : '#2f7d6b') + '"></i>当前这张图</div>';
      h += '<div class="lg-i"><i class="ring"></i>距离阈值 τ 圈</div>';
      lg.innerHTML = h;
    }
    var note = el('fsNote');
    if (note) {
      note.innerHTML = r.ood
        ? '<b style="color:#b05a51">它掉进了所有簇之外的空洞。</b>五类原型（虚线包络）都没覆盖到这个形状——' +
          '这正是「softmax 会给出自信错答案」的场景：概率条上它可能仍有 0.8+，但距离已经越界，必须转人工。'
        : '<b style="color:#22604f">它落在「' + r.cls + '」的覆盖范围内。</b>与最近原型距离 ' + r.d1.toFixed(3) +
          ' ≤ τ=' + state.tau.toFixed(2) + '，说明训练数据里见过这种形状，判读结果可信。' +
          '<br><span style="color:#9ba3a9">投影只保留 PC1+PC2 共 ' + (PCA.keep * 100).toFixed(0) + '% 的方差（保距比 ' + PCA.ratio.toFixed(2) + '），真实距离始终按 32 维计算。</span>';
    }
  }

  /* =========================================================
     屏 3 · 批量判读
     ========================================================= */
  function buildBatch() {
    var plan = [['正常', 11], ['供液不足', 3], ['气锁', 2], ['泵漏失', 3], ['杆断脱', 2]];
    var wells = [], seed = state.seed, rnd = mulberry32(seed);
    plan.forEach(function (x) {
      for (var i = 0; i < x[1]; i++) {
        wells.push({ truth: x[0], p: jitterAmp(x[0], ++seed * 131, 0.55), composite: false });
      }
    });
    [{ fill: 0.70, gas: 0.80, leak: 0.80, spm: 6 },
     { fill: 0.55, gas: 0.90, leak: 0.90, spm: 7 },
     { fill: 0.65, gas: 0.60, leak: 0.60, spm: 5 }].forEach(function (p) {
      wells.push({ truth: '复合', p: { fill: p.fill, gas: p.gas, leak: p.leak, spm: p.spm, S: 2.9 }, composite: true });
    });
    for (var i = wells.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = wells[i]; wells[i] = wells[j]; wells[j] = t;
    }
    wells.forEach(function (w, idx) {
      w.idx = idx;
      w.ex = extract(w.p);
      w.r = diag(w.ex.f, state.tau);
      w.v = verdictOf(w.r, state.tau);
    });
    state.wells = wells;
    buildTauCurve();
    renderBatch();
  }

  /* =========================================================
     τ 扫描曲线：τ 越小越保守（更多井转人工、更少错判被放行）；
     τ 越大越省人力（更多井直接出结论，但复合故障会被"自信地"判错并放行）。
     dist / conf 与 τ 无关，所以扫一遍只需重算分流，非常快。
     ========================================================= */
  function buildTauCurve() {
    var xs = [], rev = [], bad = [], k, i;
    for (k = 2; k <= 30; k++) {
      var t = k / 100, okC = 0, wrong = 0;
      for (i = 0; i < state.wells.length; i++) {
        var w = state.wells[i];
        if (verdictOf(w.r, t).act === 'ok') {
          okC++;
          if (w.composite || w.r.cls !== w.truth) wrong++;
        }
      }
      xs.push(t);
      rev.push((state.wells.length - okC) / state.wells.length);
      bad.push(wrong / state.wells.length);
    }
    state.tauCurve = { xs: xs, rev: rev, bad: bad };
  }

  function renderTau() {
    var cur = state.tauCurve;
    var svg = el('tauChart');
    if (!svg || !cur) { return; }
    var W = 460, H = 190, PL = 40, PR = 12, PT = 16, PB = 26;
    var x0 = cur.xs[0], x1 = cur.xs[cur.xs.length - 1];
    var i, s = '';
    function px(t) { return PL + (t - x0) / (x1 - x0) * (W - PL - PR); }
    function py(v) { return H - PB - v * (H - PT - PB); }

    s += '<rect x="' + PL + '" y="' + PT + '" width="' + (W - PL - PR) + '" height="' + (H - PT - PB) + '" fill="#fdfdfb" stroke="#e9e4d8"/>';
    /* 纵轴刻度 0/25/50/75/100% */
    for (i = 0; i <= 4; i++) {
      var vv = i / 4, yy = py(vv);
      s += '<line x1="' + PL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + yy.toFixed(1) + '" stroke="#f0ece1"/>';
      s += '<text x="' + (PL - 5) + '" y="' + (yy + 3).toFixed(1) + '" text-anchor="end" font-size="8.5" fill="#9ba3a9" font-family="monospace">' + (vv * 100) + '%</text>';
    }
    /* 横轴刻度 */
    [0.05, 0.10, 0.15, 0.20, 0.25, 0.30].forEach(function (t) {
      s += '<text x="' + px(t).toFixed(1) + '" y="' + (H - PB + 14) + '" text-anchor="middle" font-size="8.5" fill="#9ba3a9" font-family="monospace">' + t.toFixed(2) + '</text>';
    });
    s += '<text x="' + (W - PR) + '" y="' + (H - 2) + '" text-anchor="end" font-size="8.5" fill="#9ba3a9" font-family="monospace">距离阈值 τ →</text>';

    /* 两条曲线 */
    function path(arr) {
      var d = '';
      arr.forEach(function (v, k) { d += (k ? 'L' : 'M') + px(cur.xs[k]).toFixed(1) + ' ' + py(v).toFixed(1) + ' '; });
      return d;
    }
    s += '<path d="' + path(cur.rev) + '" fill="none" stroke="#b26a39" stroke-width="2"/>';
    s += '<path d="' + path(cur.bad) + '" fill="none" stroke="#b05a51" stroke-width="2"/>';
    /* 面积填充（复核率） */
    var da = path(cur.rev) + 'L' + px(x1).toFixed(1) + ' ' + py(0).toFixed(1) + ' L' + px(x0).toFixed(1) + ' ' + py(0).toFixed(1) + 'Z';
    s += '<path d="' + da + '" fill="#b26a39" fill-opacity=".08"/>';

    /* 当前 τ */
    var idx = Math.round((state.tau - x0) / (x1 - x0) * (cur.xs.length - 1));
    idx = Math.max(0, Math.min(cur.xs.length - 1, idx));
    var cxp = px(cur.xs[idx]);
    s += '<line x1="' + cxp.toFixed(1) + '" y1="' + PT + '" x2="' + cxp.toFixed(1) + '" y2="' + (H - PB) + '" stroke="#2f7d6b" stroke-width="1.2" stroke-dasharray="4 3"/>';
    s += '<circle cx="' + cxp.toFixed(1) + '" cy="' + py(cur.rev[idx]).toFixed(1) + '" r="4" fill="#b26a39" stroke="#fff" stroke-width="1.6"/>';
    s += '<circle cx="' + cxp.toFixed(1) + '" cy="' + py(cur.bad[idx]).toFixed(1) + '" r="4" fill="#b05a51" stroke="#fff" stroke-width="1.6"/>';
    s += '<text x="' + (cxp + 6).toFixed(1) + '" y="' + (py(cur.rev[idx]) - 4).toFixed(1) + '" font-size="9.5" font-family="monospace" fill="#b26a39">复核 ' + (cur.rev[idx] * 100).toFixed(0) + '%</text>';
    s += '<text x="' + (cxp + 6).toFixed(1) + '" y="' + (py(cur.bad[idx]) + 12).toFixed(1) + '" font-size="9.5" font-family="monospace" fill="#b05a51">误采纳 ' + (cur.bad[idx] * 100).toFixed(0) + '%</text>';

    /* 图例 */
    s += '<g transform="translate(' + (PL + 8) + ',' + (PT + 10) + ')">' +
      '<line x1="0" y1="0" x2="16" y2="0" stroke="#b26a39" stroke-width="2"/><text x="21" y="3" font-size="9.5" fill="#4d565b">人工复核率</text>' +
      '<line x1="0" y1="14" x2="16" y2="14" stroke="#b05a51" stroke-width="2"/><text x="21" y="17" font-size="9.5" fill="#4d565b">误采纳率（采纳但判错）</text></g>';
    svg.innerHTML = s;

    /* 数值读数 */
    var okN = 0, wrongN = 0;
    state.wells.forEach(function (w) {
      if (w.v.act === 'ok') { okN++; if (w.composite || w.r.cls !== w.truth) wrongN++; }
    });
    var acc = okN ? (okN - wrongN) / okN : 1;
    el('trRev').textContent = Math.round((state.wells.length - okN) / state.wells.length * 100) + '%';
    el('trBad').textContent = (wrongN / state.wells.length * 100).toFixed(1) + '%';
    el('trAcc').textContent = (acc * 100).toFixed(1) + '%';
    el('trN').textContent = okN + ' / ' + state.wells.length;
    var note = el('tauNote');
    if (note) {
      note.innerHTML = wrongN === 0
        ? '<b style="color:#22604f">当前 τ 下零误采纳。</b>被直接采纳的 ' + okN + ' 口井全部判对，' +
          '代价是 ' + (state.wells.length - okN) + ' 口井要人工看一条曲线要权衡的就是这个：' +
          'τ 调小 → 更多井转人工、更保险；τ 调大 → 更省人力、但会放过错判。'
        : '<b style="color:#b05a51">有 ' + wrongN + ' 口井被误采纳。</b>τ 调得太大了——' +
          '这些复合故障的形状虽然离原型很远，却被当成"见过"直接放行。' +
          '把 τ 往小拖，直到误采纳率归零、而复核率又还在可接受范围内，就是工程上选阈值的位置。';
    }
  }

  /* =========================================================
     混淆矩阵：真实工况 × 模型判定（随本轮 / 随 τ 实时重算）
     ========================================================= */
  var CM_ROWS = ['正常', '供液不足', '气锁', '泵漏失', '杆断脱', '复合疑难'];
  var CM_COLS = ['正常', '供液不足', '气锁', '泵漏失', '杆断脱', '转人工'];

  function renderCM() {
    var svg = el('cmSvg');
    if (!svg) { return; }
    var L = 74, T = 46, CW = 58, CH = 32, NR = CM_ROWS.length, NC = CM_COLS.length;
    /* 统计每格里的井号 */
    var cells = [], r, c;
    for (r = 0; r < NR; r++) { cells.push([]); for (c = 0; c < NC; c++) cells[r].push([]); }
    state.wells.forEach(function (w, i) {
      cells[CM_ROWS.indexOf(w.composite ? '复合疑难' : w.truth)][CM_COLS.indexOf(w.v.act === 'ok' ? w.r.cls : '转人工')].push(i);
    });
    var s = '';
    /* 左上角轴说明 */
    s += '<text x="6" y="15" font-size="9.5" fill="#9ba3a9">真实工况 ↓</text>' +
      '<text x="6" y="28" font-size="9.5" fill="#9ba3a9">模型判定 →</text>' +
      '<text x="6" y="41" font-size="8.5" fill="#9ba3a9">对角线＝判对</text>';
    /* 列头 */
    for (c = 0; c < NC; c++) {
      var cc = c < 5 ? CLASS_COLOR[CM_COLS[c]] : '#79828a';
      s += '<text x="' + (L + c * CW + (CW - 2) / 2).toFixed(1) + '" y="' + (T - 9) + '" text-anchor="middle" font-size="9.5" font-weight="600" fill="' + cc + '">' + CM_COLS[c] + '</text>';
    }
    /* 行头 */
    for (r = 0; r < NR; r++) {
      var rc = r < 5 ? CLASS_COLOR[CM_ROWS[r]] : '#79828a';
      s += '<text x="' + (L - 8) + '" y="' + (T + r * CH + CH / 2 + 3.5).toFixed(1) + '" text-anchor="end" font-size="9.5" font-weight="600" fill="' + rc + '">' + CM_ROWS[r] + '</text>';
    }
    /* 单元格 */
    var wrongN = 0, revN = 0;
    for (r = 0; r < NR; r++) {
      for (c = 0; c < NC; c++) {
        var list = cells[r][c], n = list.length;
        var x = L + c * CW, y = T + r * CH;
        var fill = '#faf9f4', tc = '#d8d2c4', stroke = '#f0ece1';
        if (n > 0) {
          if (c < 5) {
            if (r === c) { fill = '#e6f1ec'; tc = '#22604f'; stroke = 'rgba(47,125,107,.35)'; }
            else { fill = '#f9e9e5'; tc = '#b05a51'; stroke = 'rgba(176,90,81,.35)'; wrongN += n; }
          } else { fill = '#f1f1ee'; tc = '#4d565b'; stroke = '#dcdad2'; revN += n; }
        }
        var tag = r === c ? '判对' : (c < 5 ? '判错却放行' : '转人工复核');
        var wells = list.map(function (i) { return '#' + String(i + 1).padStart(2, '0'); }).join(' ');
        s += '<rect class="cmc" data-w="' + (n ? list[0] : -1) + '" x="' + x + '" y="' + y + '" width="' + (CW - 2) + '" height="' + (CH - 2) + '" rx="4" fill="' + fill + '" stroke="' + stroke + '">' +
          '<title>真实「' + CM_ROWS[r] + '」× 判定「' + CM_COLS[c] + '」· ' + n + ' 口井 ' + (n ? '(' + wells + ') ' : '') + '—— ' + tag + '</title></rect>';
        s += '<text x="' + (x + (CW - 2) / 2).toFixed(1) + '" y="' + (y + CH / 2 + 4).toFixed(1) + '" text-anchor="middle" font-size="11.5" font-weight="700" font-family="monospace" fill="' + (n ? tc : '#d8d2c4') + '" pointer-events="none">' + (n || '·') + '</text>';
      }
    }
    /* 行合计（右侧） */
    for (r = 0; r < NR; r++) {
      var rt = 0;
      for (c = 0; c < NC; c++) rt += cells[r][c].length;
      s += '<rect x="428" y="' + (T + r * CH) + '" width="40" height="' + (CH - 2) + '" rx="4" fill="#f4f3ef" stroke="#e9e4d8"/>' +
        '<text x="448" y="' + (T + r * CH + CH / 2 + 3.5).toFixed(1) + '" text-anchor="middle" font-size="10.5" font-family="monospace" fill="#4d565b" pointer-events="none">' + rt + '</text>';
    }
    s += '<text x="448" y="' + (T - 4) + '" text-anchor="middle" font-size="8.5" fill="#9ba3a9">合计</text>';
    /* 列合计（下方） */
    for (c = 0; c < NC; c++) {
      var ct = 0;
      for (r = 0; r < NR; r++) ct += cells[r][c].length;
      s += '<rect x="' + (L + c * CW) + '" y="242" width="' + (CW - 2) + '" height="16" rx="4" fill="#f4f3ef" stroke="#e9e4d8"/>' +
        '<text x="' + (L + c * CW + (CW - 2) / 2).toFixed(1) + '" y="253" text-anchor="middle" font-size="10" font-family="monospace" fill="#4d565b" pointer-events="none">' + ct + '</text>';
    }
    s += '<text x="' + (L - 8) + '" y="253" text-anchor="end" font-size="8.5" fill="#9ba3a9">合计</text>' +
      '<rect x="428" y="242" width="40" height="16" rx="4" fill="#eef0ec" stroke="#c9c2b0"/>' +
      '<text x="448" y="253" text-anchor="middle" font-size="10" font-family="monospace" font-weight="700" fill="#4d565b" pointer-events="none">' + state.wells.length + '</text>';
    svg.innerHTML = s;
    Array.prototype.forEach.call(svg.querySelectorAll('.cmc'), function (rc) {
      var i = Number(rc.getAttribute('data-w'));
      if (i >= 0) { rc.addEventListener('click', function () { selectWell(i); }); }
    });
    /* 解读 */
    var note = el('cmNote');
    if (note) {
      var okN = state.wells.length - revN;
      note.innerHTML = wrongN === 0
        ? '<b style="color:#22604f">对角线全绿：直接采纳的 ' + okN + ' 口井全部判对。</b>另有 ' + revN + ' 口复合疑难工况被距离阈值拦下转人工（最下一行最右列）——只要把 τ 拖大，它们就会"自信地"掉进左侧某一列，变成误采纳。'
        : '<b style="color:#b05a51">有 ' + wrongN + ' 口井被判错却直接放行。</b>它们落在对角线之外：模型把没见过的形状硬判成了某个见过的工况。把 τ 往小拖，这些井会被推去人工复核——这就是阈值要守住的底线。';
    }
  }

  function renderBatch() {
    var grid = el('bgrid');
    var h = '';
    state.wells.forEach(function (w, i) {
      w.v = verdictOf(w.r, state.tau);   /* τ 可能已被滑杆改动，重算分流 */
      var col = w.v.act === 'ok' ? CLASS_COLOR[w.r.cls] : (w.v.act === 'ood' ? '#79828a' : '#b26a39');
      h += '<div class="well' + (state.selWell === i ? ' sel' : '') + '" data-w="' + i + '">' +
        '<canvas width="64" height="64"></canvas>' +
        '<div class="wn">#' + String(i + 1).padStart(2, '0') + '</div>' +
        '<div class="wv" style="color:' + col + '">' + (w.v.act === 'ok' ? w.r.cls : '转人工') + '</div>' +
        '<div class="wc">' + (w.v.act === 'ok' ? 'conf ' + w.r.conf.toFixed(2) : (w.v.act === 'ood' ? 'd=' + w.r.d1.toFixed(2) : 'conf ' + w.r.conf.toFixed(2))) + '</div>' +
        '</div>';
    });
    grid.innerHTML = h;
    /* 画每口井的示功图缩略 */
    Array.prototype.forEach.call(grid.children, function (cell, i) {
      drawWellThumb(cell.querySelector('canvas'), state.wells[i]);
      cell.addEventListener('click', function () { selectWell(i); });
    });
    /* 汇总 */
    var cnt = { '正常': 0, '供液不足': 0, '气锁': 0, '泵漏失': 0, '杆断脱': 0, '疑难': 0 };
    var ok = 0, rev = 0;
    state.wells.forEach(function (w) {
      if (w.v.act === 'ok') { cnt[w.r.cls]++; ok++; } else { cnt['疑难']++; rev++; }
    });
    el('bsOk').textContent = ok;
    el('bsRev').textContent = rev;
    el('bsPct').textContent = Math.round(rev / state.wells.length * 100) + '%';
    var cs = '', rows = ['正常', '供液不足', '气锁', '泵漏失', '杆断脱', '疑难'], yy = 12;
    rows.forEach(function (k) {
      cs += '<text x="56" y="' + (yy + 11) + '" text-anchor="end" font-size="10" fill="' + CLASS_COLOR[k] + '">' + k + '</text>' +
        '<rect x="62" y="' + yy + '" width="' + Math.max(1, cnt[k] / 24 * 190).toFixed(1) + '" height="14" rx="3" fill="' + CLASS_COLOR[k] + '" opacity=".85"/>' +
        '<text x="' + (66 + Math.max(1, cnt[k] / 24 * 190)) + '" y="' + (yy + 11) + '" font-size="9.5" font-family="monospace" fill="#4d565b">' + cnt[k] + '</text>';
      yy += 26;
    });
    el('batchChart').innerHTML = cs;
    renderTau();
    renderCM();
  }

  function drawWellThumb(canvas, w) {
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 64, 64);
    var pts = w.ex.pts, S = w.p.S, L = 6, R = 58, T = 8, B = 56;
    ctx.beginPath();
    for (var k = 0; k < pts.length; k++) {
      var X = L + pts[k][0] / S * (R - L);
      var Y = B - Math.max(0, Math.min(Ymax, pts[k][1])) / Ymax * (B - T);
      if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
    }
    ctx.closePath();
    ctx.strokeStyle = w.v.act === 'ok' ? CLASS_COLOR[w.r.cls] : (w.v.act === 'ood' ? '#9ba3a9' : '#b26a39');
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  function selectWell(i) {
    state.selWell = i;
    var w = state.wells[i];
    state.p = { fill: w.p.fill, gas: w.p.gas, leak: w.p.leak, spm: w.p.spm, S: w.p.S, broken: w.p.broken };
    state.preset = w.composite ? '复合疑难' : w.truth;
    syncControls();
    drawCardFrame();
    drawCardDynamic();
    renderNN();
    renderBatch();
    el('sec1').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTip(state.preset);
  }

  /* =========================================================
     控件：预设 / 滑杆
     ========================================================= */
  var SLIDERS = [
    { key: 'fill', label: '充满系数', min: 0.1, max: 1, step: 0.01, fmt: function (v) { return Math.round(v * 100) + '%'; } },
    { key: 'gas', label: '含气指数', min: 0, max: 1, step: 0.01, fmt: function (v) { return v.toFixed(2); } },
    { key: 'leak', label: '漏失指数', min: 0, max: 1, step: 0.01, fmt: function (v) { return v.toFixed(2); } },
    { key: 'spm', label: '冲次 SPM', min: 3, max: 12, step: 1, fmt: function (v) { return String(v); } }
  ];
  var TIPS = {
    '正常': '图形饱满、传递线陡直：<b>上冲程</b>载荷 ≈ 杆重 + 液重，<b>下冲程</b>回到杆重。把「含气指数」拖到 0.8 以上，看传递线怎么被拉成斜线。',
    '供液不足': '顶部被切掉、下冲程末段出现<b>液击凸包</b>：泵筒没充满，柱塞下冲程末段撞上液面。真实井上这意味着泵效下降，需要调参或检泵。',
    '气锁': '载荷传递线被拉成斜线、峰载荷明显偏低：气体在泵筒内被压缩/膨胀，载荷传递慢半拍，原油排不出去。',
    '泵漏失': '载荷在整个冲程里持续渐变、图形倾斜变大：液体从柱塞间隙漏回泵筒，上下行程都"吃不饱"。',
    '杆断脱': '载荷塌到低值区：杆柱断开，光杆只提着断点以上的杆。这类井必须立即作业，是模型最该优先报出的异常。',
    '复合疑难': '形状介于几类之间，落进了训练覆盖不到的"空洞"——距离阈值会把它拦下转人工。这正是流程里「低置信度人工复核」一步存在的理由。'
  };

  function setTip(name) {
    el('simTip').innerHTML = '<b>' + name + '</b> · ' + (TIPS[name] || '拖动滑杆改变工况参数，观察示功图形状与分类器判定的联动。');
  }

  function buildControls() {
    /* 预设按钮 */
    var pb = el('presets');
    Object.keys(PRESET).forEach(function (name) {
      var b = document.createElement('button');
      b.className = 'pbtn' + (name === state.preset ? ' on' : '');
      b.innerHTML = '<span class="dot" style="background:' + CLASS_COLOR[name] + '"></span>' + name;
      b.addEventListener('click', function () { applyPreset(name); });
      pb.appendChild(b);
    });
    /* 滑杆 */
    var sl = el('sliders');
    SLIDERS.forEach(function (sd) {
      var d = document.createElement('div');
      d.className = 'sl';
      d.id = 'sl-' + sd.key;
      d.innerHTML = '<label>' + sd.label + '<output id="out-' + sd.key + '"></output></label>' +
        '<input type="range" id="in-' + sd.key + '" min="' + sd.min + '" max="' + sd.max + '" step="' + sd.step + '">';
      sl.appendChild(d);
      var inp = el('in-' + sd.key);
      inp.addEventListener('input', function () {
        var v = Number(inp.value);
        if (sd.key !== 'spm' && state.p.broken) state.p.broken = 0; // 拖动参数滑杆即退出断脱
        state.p[sd.key] = v;
        if (sd.key === 'fill') state.p.pound = v < 0.5;
        state.preset = '';
        syncControls();
        refreshAll();
        setTip('');
      });
    });
    el('cardSvg').addEventListener('click', function () { state.playing = !state.playing; });
    el('btnReroll').addEventListener('click', function () {
      state.seed = (state.seed * 9301 + 49297) % 233280;
      state.selWell = -1;
      buildBatch();
    });
    /* 分布外距离阈值滑杆：拖动即全区块重判 */
    var tauIn = el('inTau');
    if (tauIn) {
      tauIn.value = state.tau;
      el('outTau').textContent = state.tau.toFixed(2);
      tauIn.addEventListener('input', function () {
        state.tau = Number(tauIn.value);
        el('outTau').textContent = state.tau.toFixed(2);
        renderBatch();
        renderNN();
        refreshAnim();
      });
    }
  }

  function applyPreset(name) {
    var src = PRESET[name];
    state.p = {
      fill: src.fill, gas: src.gas, leak: src.leak, spm: src.spm, S: 3,
      broken: src.broken, pound: name === '供液不足' ? true : (src.fill < 0.5)
    };
    state.preset = name;
    syncControls();
    refreshAll();
    setTip(name);
  }

  function syncControls() {
    Array.prototype.forEach.call(el('presets').children, function (b) {
      var name = b.textContent.replace(/^\s+|\s+$/g, '');
      b.classList.toggle('on', name === state.preset);
    });
    SLIDERS.forEach(function (sd) {
      el('out-' + sd.key).textContent = sd.fmt(state.p[sd.key]);
      el('in-' + sd.key).value = state.p[sd.key];
      el('sl-' + sd.key).classList.toggle('off', !!state.p.broken);
    });
    el('uBreak').style.display = state.p.broken ? '' : 'none';
    el('uRod').setAttribute('stroke', state.p.broken ? '#b05a51' : '#4d565b');
  }

  /* 算法解剖动画每帧都从 state 现算，播放时自然跟着走；
     但暂停后它只在 refresh() 时才重绘，所以要显式喊一声，否则画面停在旧帧。 */
  function refreshAnim() {
    if (typeof window !== 'undefined' && window.PumpFlowApi && window.PumpFlowApi.refresh) {
      window.PumpFlowApi.refresh();
    }
  }

  function refreshAll() {
    drawCardFrame();
    drawCardDynamic();
    renderMotion();
    renderNN();
    refreshAnim();
  }

  /* =========================================================
     初始化
     ========================================================= */
  function init() {
    buildPrototypes();
    buildPCA();
    buildUnit();
    buildControls();
    drawCardFrame();
    drawCardDynamic();
    renderMotion();
    renderNN();
    buildBatch();
    setTip('正常');
    requestAnimationFrame(frame);
  }

  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('unitSvg')) {
    init();
  }

  /* Node 测试导出（浏览器里 module 未定义，自动跳过） */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      CLASSES: CLASSES, PRESET: PRESET, T: T, TAU: TAU, CONF_REVIEW: CONF_REVIEW,
      cardPoints: cardPoints, rasterize: rasterize, convFeatures: convFeatures,
      featureVector: featureVector, extract: extract, buildPrototypes: buildPrototypes,
      diag: diag, verdictOf: verdictOf, jitterAmp: jitterAmp, mulberry32: mulberry32,
      buildPCA: buildPCA, project2d: project2d, hullOf: hullOf,
      Ymax: Ymax, Wr: Wr, WfMax: WfMax, KERNELS: KERNELS
    };
  }

  /* 浏览器端桥接：把内部算法与实时状态暴露给「算法解剖」动画模块。
     这样动画演示的每一步都跑的是同一份真代码，而不是另画一遍示意图。 */
  if (typeof window !== 'undefined') {
    window.PumpBridge = {
      CLASSES: CLASSES, CLASS_COLOR: CLASS_COLOR, CH_COLOR: CH_COLOR,
      KERNELS: KERNELS, KERNEL_NAME: KERNEL_NAME,
      T: T, TAU: TAU, CONF_REVIEW: CONF_REVIEW, Ymax: Ymax,
      state: state,
      cardPoints: cardPoints, rasterize: rasterize, rasterStep: rasterStep,
      convFeatures: convFeatures, convRaw: convRaw, convCell: convCell,
      featureVector: featureVector, extract: extract,
      diag: diag, verdictOf: verdictOf,
      protos: function () { return PROTOS; },
      chanEnergy: chanEnergy
    };
  }
})();
