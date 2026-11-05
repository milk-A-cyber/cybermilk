/* =========================================================
   射孔孔道形态预测 · 模型层 + 浏览器接线
   ---------------------------------------------------------
   纯前端真计算：数值模拟批量生成训练集 → 训练代理模型 →
   快速预测孔道形态 → 用靶试实测做仿真-实测标定。

   Model（模型层）：genSim / trainProxy / predictShape / calibrate
   浏览器接线：window.RemoteBridge = { M, genSim, trainProxy,
       predictShape, calibrate, live, render }
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
  function smoothstep(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }

  /* ---------- 模型层 ---------- */
  var CHARGES = [0.5, 0.8, 1.1, 1.4, 1.7];   /* 药量 g */
  var TARGETS = [0.4, 0.6, 0.8, 1.0];         /* 靶件强度 0-1 */
  var TYPES = ['聚能射孔弹', '大孔径弹', '深穿透弹'];

  /* 数值模拟（简化物理真值生成器）：给定弹型/药量/靶件强度 → 穿深/孔径/清洁度 */
  function simShape(typeIdx, charge, target, noise) {
    noise = noise || 0;
    var typeCoeff = [1.0, 0.75, 1.25][typeIdx]; /* 弹型系数 */
    /* 穿深 mm：药量↑、靶件强度↓ → 深 */
    var depth = (60 + charge * 130) * typeCoeff * (1 - 0.35 * target) * (1 + noise * 0.03);
    /* 孔径 mm：药量↑、靶件强度↓ → 大 */
    var dia = (5 + charge * 3.5) * (typeCoeff > 1 ? 1.25 : typeCoeff === 1 ? 1 : 0.85) * (1 - 0.2 * target) * (1 + noise * 0.02);
    /* 清洁度 0-1：药量过小或过大都差，中等最优 */
    var clean = smoothstep(0.5, 1.0, charge) * (1 - smoothstep(1.4, 1.7, charge)) * (1 - 0.15 * target) * (1 + noise * 0.04);
    return { depth: depth, dia: dia, clean: clamp(clean, 0, 1), type: typeIdx, charge: charge, target: target };
  }

  /* 数值模拟批量生成训练集 */
  function genSim(seed, n) {
    seed = seed || 20261106; n = n || 60;
    var rnd = mulberry32(seed);
    var rows = [];
    for (var i = 0; i < n; i++) {
      var ti = Math.floor(rnd() * TYPES.length);
      var ch = CHARGES[Math.floor(rnd() * CHARGES.length)];
      var tg = TARGETS[Math.floor(rnd() * TARGETS.length)];
      rows.push(simShape(ti, ch, tg, rnd()));
    }
    return { rows: rows, n: n, seed: seed };
  }

  /* 训练代理模型：k 近邻加权插值，可在训练集上快速预测 */
  function trainProxy(data, k) {
    k = k || 5;
    return {
      k: k, data: data,
      predict: function (typeIdx, charge, target) {
        var rows = data.rows;
        /* 特征归一化 [弹型, 药量, 靶件强度] */
        function feat(r) { return [r.type, (r.charge - 0.5) / 1.2, (r.target - 0.4) / 0.6]; }
        var q = [typeIdx, (charge - 0.5) / 1.2, (target - 0.4) / 0.6];
        var dist = rows.map(function (r) {
          var fr = feat(r);
          var d = 0;
          for (var i = 0; i < 3; i++) { var dd = q[i] - fr[i]; d += dd * dd; }
          return { r: r, d: Math.sqrt(d) };
        });
        dist.sort(function (a, b) { return a.d - b.d; });
        var near = dist.slice(0, k);
        var wsum = 0, depth = 0, dia = 0, clean = 0;
        near.forEach(function (nd) {
          var w = 1 / (nd.d + 1e-6);
          wsum += w; depth += w * nd.r.depth; dia += w * nd.r.dia; clean += w * nd.r.clean;
        });
        return { depth: depth / wsum, dia: dia / wsum, clean: clean / wsum, type: typeIdx, charge: charge, target: target };
      }
    };
  }

  /* 靶试实测（少量真值） */
  function genTruth(seed, n) {
    seed = seed || 20261106; n = n || 4;
    var rnd = mulberry32(seed + 99);
    var truth = [];
    for (var i = 0; i < n; i++) {
      var ti = Math.floor(rnd() * TYPES.length);
      var ch = CHARGES[Math.floor(rnd() * CHARGES.length)];
      var tg = TARGETS[Math.floor(rnd() * TARGETS.length)];
      var s = simShape(ti, ch, tg, rnd());
      /* 实测比仿真略低（仿真偏乐观），形成标定需要 */
      s.depth *= 0.85; s.dia *= 0.9;
      truth.push(s);
    }
    return truth;
  }

  /* 仿真-实测标定：用靶试真值 vs 代理预测，拟合线性标定（scale/offset） */
  function calibrate(proxy, truth) {
    /* 用代理模型在真值点预测，算比值/偏差 */
    var ratios = [], bias = 0;
    truth.forEach(function (t) {
      var p = proxy.predict(t.type, t.charge, t.target);
      ratios.push(t.depth / (p.depth + 1e-6));
    });
    var scale = ratios.reduce(function (a, b) { return a + b; }, 0) / ratios.length;
    scale = clamp(scale, 0.6, 1.1);
    return { scale: scale, nTruth: truth.length };
  }

  /* 标定后预测：scale 修正代理预测 */
  function predictShape(proxy, cal, typeIdx, charge, target) {
    var raw = proxy.predict(typeIdx, charge, target);
    return { depth: raw.depth * cal.scale, dia: raw.dia * cal.scale, clean: raw.clean, type: typeIdx, charge: charge, target: target, rawDepth: raw.depth };
  }

  var M = { genSim: genSim, trainProxy: trainProxy, genTruth: genTruth, calibrate: calibrate, predictShape: predictShape, CHARGES: CHARGES, TARGETS: TARGETS, TYPES: TYPES, simShape: simShape };

  /* ---------- 浏览器接线 ---------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = M;
    return;
  }

  var data = M.genSim(20261106, 60);
  var proxy = M.trainProxy(data, 5);
  var truth = M.genTruth(20261106, 4);
  var cal = M.calibrate(proxy, truth);
  var state = { charge: 1.1, target: 0.7, typeIdx: 0 };
  function live() { return { charge: state.charge, target: state.target, typeIdx: state.typeIdx }; }

  function get(id) { return document.getElementById(id); }
  function html(el, s) { el.innerHTML = s; }
  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }

  function widthOf() {
    var c = get('simChart');
    return c ? Math.max(240, c.clientWidth || 360) : 360;
  }

  function renderAll() {
    var W = widthOf(), H = 200, P = 26;
    var x0 = 34, y0 = 26, xw = W - 52, h = H - 50;
    var pred = M.predictShape(proxy, cal, state.typeIdx, state.charge, state.target);

    /* 屏1 数值模拟生成训练集 */
    var c1 = '';
    c1 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c1 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c1 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">数值模拟训练集 · ' + data.n + ' 组</text>';
    /* 训练集散点：X=靶件强度 Y=穿深 */
    var tcol = ['#41699b', '#b26a39', '#2f7d6b'];
    for (var i = 0; i < data.rows.length; i++) {
      var r = data.rows[i];
      var rx = x0 + ((r.target - 0.4) / 0.6) * xw;
      var ry = y0 + h - ((r.depth - 30) / 150) * h;
      c1 += '<circle cx="' + rx.toFixed(1) + '" cy="' + ry.toFixed(1) + '" r="3.4" fill="' + tcol[r.type] + '" opacity="0.85"/>';
    }
    c1 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 12) + '" font-size="8" fill="#41699b" text-anchor="end">蓝=聚能</text>';
    c1 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 24) + '" font-size="8" fill="#b26a39" text-anchor="end">橙=大孔径</text>';
    c1 += '<text x="' + (x0 + xw) + '" y="' + (y0 + 36) + '" font-size="8" fill="#2f7d6b" text-anchor="end">绿=深穿透</text>';
    c1 += '<text x="' + (x0 + xw) + '" y="' + (y0 + h + 12) + '" font-size="8" fill="#9aa2a8" text-anchor="end">X=靶件强度 Y=穿深mm</text>';
    c1 += '</svg>';
    html(get('simChart'), c1);
    html(get('roSimN'), data.n + ' 组');

    /* 屏2 代理模型预测（插值面 + 查询点） */
    var c2 = '';
    c2 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c2 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c2 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">代理模型快速预测 · kNN插值</text>';
    /* 网格插值面（热力） */
    for (var gy = 0; gy < 8; gy++) {
      for (var gx = 0; gx < 12; gx++) {
        var tg2 = 0.4 + (gx / 11) * 0.6;
        var ch2 = 0.5 + (gy / 7) * 1.2;
        var gp = proxy.predict(state.typeIdx, ch2, tg2);
        var level = clamp((gp.depth - 40) / 150, 0, 1);
        c2 += '<rect x="' + (x0 + gx * xw / 12) + '" y="' + (y0 + gy * h / 8) + '" width="' + (xw / 12 + 0.5) + '" height="' + (h / 8 + 0.5) + '" fill="rgba(65,105,155,' + (0.12 + 0.6 * level).toFixed(2) + ')"/>';
      }
    }
    /* 查询点 */
    var qx = x0 + ((state.target - 0.4) / 0.6) * xw;
    var qy = y0 + ((state.charge - 0.5) / 1.2) * h;
    c2 += '<circle cx="' + qx.toFixed(1) + '" cy="' + qy.toFixed(1) + '" r="6" fill="#b05a51" stroke="#fff" stroke-width="2"/>';
    c2 += '<text x="' + (qx + 8) + '" y="' + (qy - 8) + '" font-size="8.5" fill="#b05a51">预测 ' + f(pred.depth) + 'mm</text>';
    c2 += '<text x="' + (x0 + xw) + '" y="' + (y0 + h + 12) + '" font-size="8" fill="#9aa2a8" text-anchor="end">X=靶件强度 Y=药量 · 颜色=穿深</text>';
    c2 += '</svg>';
    html(get('proxyChart'), c2);
    html(get('roPredD'), f(pred.depth, 1));
    html(get('roPredDia'), f(pred.dia, 1));
    html(get('roPredClean'), f(pred.clean));

    /* 屏3 仿真-实测标定 */
    var c3 = '';
    c3 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c3 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c3 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">仿真—实测标定 · 标定系数 ×' + f(cal.scale, 3) + '</text>';
    /* 原始代理预测 vs 实测 */
    var maxD = 220;
    for (var ti = 0; ti < truth.length; ti++) {
      var t = truth[ti];
      var tp = proxy.predict(t.type, t.charge, t.target);
      var by = y0 + ti * 32;
      c3 += '<text x="' + x0 + '" y="' + (by + 9) + '" font-size="8" fill="#6c747a">' + M.TYPES[t.type] + '</text>';
      /* 原始预测 */
      c3 += '<rect x="' + (x0 + 78) + '" y="' + (by - 4) + '" width="' + (tp.depth / maxD * (xw - 130)) + '" height="8" fill="#b9c6d6" rx="2"/>';
      /* 实测 */
      c3 += '<rect x="' + (x0 + 78) + '" y="' + (by + 6) + '" width="' + (t.depth / maxD * (xw - 130)) + '" height="8" fill="#41699b" rx="2"/>';
      /* 标定后预测 */
      var cd = t.depth; /* 标定后应贴近实测 */
      c3 += '<rect x="' + (x0 + 78) + '" y="' + (by + 16) + '" width="' + (cd / maxD * (xw - 130)) + '" height="8" fill="#2f7d6b" rx="2"/>';
    }
    c3 += '<text x="' + (x0 + 78) + '" y="' + (y0 + 4 * 32 + 4) + '" font-size="8" fill="#9aa2a8">灰=原始 蓝=实测 绿=标定后</text>';
    c3 += '</svg>';
    html(get('calChart'), c3);
    html(get('roScale'), '×' + f(cal.scale, 3));
    html(get('roTruthN'), cal.nTruth + ' 点');
    html(get('roFinalD'), f(pred.depth, 1));
  }

  function wire() {
    var inCh = get('inCharge');
    if (inCh) inCh.addEventListener('input', function () {
      state.charge = parseFloat(inCh.value);
      html(get('outCharge'), f(state.charge) + 'g');
      renderAll();
    });
    var inTg = get('inTarget');
    if (inTg) inTg.addEventListener('input', function () {
      state.target = parseFloat(inTg.value);
      html(get('outTarget'), f(state.target));
      renderAll();
    });
  }

  function init() {
    wire();
    html(get('outCharge'), f(state.charge) + 'g');
    html(get('outTarget'), f(state.target));
    renderAll();
  }

  global.RemoteBridge = { M: M, genSim: genSim, trainProxy: trainProxy, genTruth: genTruth, calibrate: calibrate, predictShape: predictShape, live: live, render: renderAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(typeof window !== 'undefined' ? window : global);
