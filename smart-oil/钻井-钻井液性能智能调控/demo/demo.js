/* =========================================================
   钻井液性能智能调控 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  多源融合软测量：高频循环参数 → 连续性能趋势
   屏 2  加量推荐：偏差 → 该加多少
   屏 3  过调抑制：经验 vs 推荐加量 + 性能验收
   所有计算都在浏览器里完成，纯前端。
   ========================================================= */
(function (global) {
  'use strict';

  /* =====================================================
     纯模型层（Node 可 require 做单测；浏览器里继续往下走）
     ===================================================== */
  var Model = (function () {

    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

    function mulberry32(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    /* -----------------------------------------------------
       合成高频循环参数（流量/温度/压力）
       返回 { n, flow:[], temp:[], pres:[] }
       ----------------------------------------------------- */
    function genCirc(n, seed) {
      var rnd = mulberry32(seed || 20261151);
      var flow = new Float64Array(n), temp = new Float64Array(n), pres = new Float64Array(n);
      for (var i = 0; i < n; i++) {
        flow[i] = clamp(28 + Math.sin(i * 0.05) * 3 + (rnd() - 0.5) * 2, 20, 36);
        temp[i] = clamp(46 + i * 0.04 + Math.sin(i * 0.08) * 2 + (rnd() - 0.5) * 1.5, 42, 70);
        pres[i] = clamp(12 + Math.sin(i * 0.07) * 1.2 + (rnd() - 0.5) * 1, 9, 16);
      }
      return { n: n, flow: flow, temp: temp, pres: pres };
    }

    /* -----------------------------------------------------
       多源融合软测量
       高频循环参数 + 稀疏性能测量（每 10 点一个）→ 连续性能趋势。
       mode 0 纯性能测量(稀疏) 1 多源融合。
       返回 { sense: Float64Array, meas:[{i,v}], err }
       ----------------------------------------------------- */
    function softSense(circ, mode, n, seed) {
      var rnd = mulberry32(seed || 20261152);
      var sense = new Float64Array(n);
      var meas = [];
      /* 稀疏实测（真实性能） */
      var trueV = [];
      for (var i = 0; i < n; i++) {
        /* 真实性能与温度/压力相关，缓慢变化 */
        trueV.push(clamp(1.2 + circ.temp[i] * 0.01 + Math.sin(i * 0.06) * 0.05 + (rnd() - 0.5) * 0.02, 1.0, 2.2));
      }
      for (i = 0; i < n; i++) {
        if (mode === 0) {
          /* 纯稀疏：只在测量点有值，其余保持上次 */
          if (i % 10 === 0) sense[i] = trueV[i];
          else sense[i] = i > 0 ? sense[i - 1] : trueV[i];
        } else {
          /* 多源融合：用高频参数连续估算，测量点校正 */
          var est = 1.2 + circ.temp[i] * 0.01 + Math.sin(i * 0.06) * 0.05;
          if (i % 10 === 0) { sense[i] = trueV[i]; meas.push({ i: i, v: trueV[i] }); }
          else sense[i] = est + (rnd() - 0.5) * 0.01;
        }
      }
      /* 误差（相对真实） */
      var err = 0;
      for (i = 0; i < n; i++) err += Math.abs(sense[i] - trueV[i]) / n;
      return { sense: sense, meas: meas, err: err, trueV: trueV };
    }

    /* -----------------------------------------------------
       加量推荐
       性能偏差 dev → 该加多少处理剂。
       mode 0 经验(过调) 1 推荐(按偏差校准)。
       返回 { dose: Float64Array }
       ----------------------------------------------------- */
    function doseRecommend(devs, mode, n) {
      var dose = new Float64Array(n);
      for (var i = 0; i < n; i++) {
        var dev = devs[i];
        if (mode === 0) {
          /* 经验：猛加，容易过调 */
          dose[i] = Math.abs(dev) * 3.2;
        } else {
          /* 推荐：按偏差幅度校准，小偏差少加 */
          dose[i] = Math.abs(dev) * 1.6 + (dev > 0 ? 0.1 : 0.05);
        }
      }
      return dose;
    }

    /* -----------------------------------------------------
       过调抑制
       对比经验 vs 推荐加量下的性能波动。
       返回 { expDose, recDose, expWave, recWave, expOk, recOk }
       ----------------------------------------------------- */
    function oscillationCtrl(devs, mode, n) {
      var expDose = doseRecommend(devs, 0, n);
      var recDose = doseRecommend(devs, 1, n);
      /* 加量后的性能偏差：
         经验 = 猛加 → 抑制不足 + 累积振荡（偏离 0，来回摆）
         推荐 = 按偏差校准 → 抑制到位（更接近 0） */
      var expPerf = new Float64Array(n), recPerf = new Float64Array(n);
      var expWave = 0, recWave = 0, expOk = 0, recOk = 0;
      for (var i = 0; i < n; i++) {
        expPerf[i] = clamp(devs[i] * 0.9 - (i > 0 ? expPerf[i - 1] : 0) * 0.15, -0.8, 0.8);
        recPerf[i] = clamp(devs[i] * 0.3 - (i > 0 ? recPerf[i - 1] : 0) * 0.03, -0.5, 0.5);
        expWave += Math.abs(expPerf[i]) / n;
        recWave += Math.abs(recPerf[i]) / n;
        if (Math.abs(expPerf[i]) < 0.25) expOk++;
        if (Math.abs(recPerf[i]) < 0.25) recOk++;
      }
      return {
        expDose: expDose, recDose: recDose, expPerf: expPerf, recPerf: recPerf,
        expWave: expWave, recWave: recWave, expOk: expOk / n, recOk: recOk / n
      };
    }

    return {
      clamp: clamp, mulberry32: mulberry32,
      genCirc: genCirc, softSense: softSense,
      doseRecommend: doseRecommend, oscillationCtrl: oscillationCtrl
    };
  })();

  /* Node 单测入口 */
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

  var state = {
    nData: 100, senseMode: 1 /* 0 稀疏 1 融合 */, recMode: 1 /* 0 经验 1 推荐 */
  };

  var N = 100;
  var circ = M.genCirc(N, 20261151);
  var soft = M.softSense(circ, state.senseMode, N, 20261152);
  /* 偏差 = 目标 - 软测 */
  var devs = new Float64Array(N);
  for (var i = 0; i < N; i++) devs[i] = 1.55 - soft.sense[i];
  var ctrl = M.oscillationCtrl(devs, state.recMode, N);

  global.RemoteBridge = {
    M: M,
    genCirc: M.genCirc, softSense: M.softSense,
    doseRecommend: M.doseRecommend, oscillationCtrl: M.oscillationCtrl,
    live: function () {
      return { nData: state.nData, senseMode: state.senseMode, recMode: state.recMode };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 1 : d); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function linePath(arr, x0, y0, xS, yS, color, dash) {
    var s = '<path d="M';
    for (var i = 0; i < arr.length; i++) {
      s += (x0 + i * xS).toFixed(1) + ' ' + (y0 - arr[i] * yS).toFixed(1);
      if (i < arr.length - 1) s += ' L';
    }
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (dash ? 1.8 : 2) + '"' + (dash ? ' stroke-dasharray="5 3"' : '') + '/>';
    return s;
  }

  /* ---------- 屏 1 渲染：多源融合软测量 ---------- */
  function renderSense() {
    circ = M.genCirc(N, 20261151);
    soft = M.softSense(circ, state.senseMode, N, 20261152);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">性能软测量：' + (state.senseMode === 0 ? '纯稀疏测量' : '多源融合（高频参数）') + '</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-width="1"/>';
    /* 真实性能（绿虚） */
    var trueArr = [];
    for (var i = 0; i < N; i++) trueArr.push((soft.trueV[i] - 1.0) / 1.2);
    s += linePath(trueArr, x0, y0 + h, w / N, h, '#2f7d6b', true);
    /* 软测（蓝） */
    var senseArr = [];
    for (i = 0; i < N; i++) senseArr.push((soft.sense[i] - 1.0) / 1.2);
    s += linePath(senseArr, x0, y0 + h, w / N, h, '#41699b', false);
    /* 稀疏测量点 */
    soft.meas.forEach(function (m) {
      var px = x0 + m.i * w / N;
      var py = y0 + h - (m.v - 1.0) / 1.2 * h;
      s += '<circle cx="' + px + '" cy="' + py + '" r="3" fill="#b26a39"/>';
    });
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#2f7d6b">真实</text>';
    s += '<text x="' + (x0 + 46) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#41699b">软测</text>';
    s += '<text x="' + (x0 + 90) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#b26a39">实测点</text>';
    $('senseChart').innerHTML = s;
    $('roErr').textContent = Math.round(soft.err * 100) + '%';
    $('roSrc').textContent = state.senseMode === 0 ? '仅每班测量' : '高频参数融合';
  }

  /* ---------- 屏 2 渲染：加量推荐 ---------- */
  function renderDose() {
    circ = M.genCirc(N, 20261151);
    soft = M.softSense(circ, state.senseMode, N, 20261152);
    for (var i = 0; i < N; i++) devs[i] = 1.55 - soft.sense[i];
    var dose = M.doseRecommend(devs, state.recMode, N);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">处理剂加量推荐（' + (state.recMode === 0 ? '经验·易过调' : '按偏差校准') + '）</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-width="1"/>';
    var doseMax = Math.max.apply(null, Array.from(dose)) || 1;
    var doseArr = [];
    for (i = 0; i < N; i++) doseArr.push(dose[i] / (doseMax * 1.1));
    s += linePath(doseArr, x0, y0 + h, w / N, h, '#b26a39', false);
    /* 偏差底 */
    var devArr = [];
    var devMax = Math.max.apply(null, Array.from(devs).map(function (v) { return Math.abs(v); })) || 1;
    for (i = 0; i < N; i++) devArr.push(devs[i] / (devMax * 1.2));
    s += linePath(devArr, x0, y0 + h, w / N, h, '#7a8a9a', true);
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#b26a39">加量</text>';
    s += '<text x="' + (x0 + 46) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#7a8a9a">偏差</text>';
    $('doseChart').innerHTML = s;
    $('roDose').textContent = num(dose[N - 1], 2) + ' kg/m³';
    $('roDev').textContent = num(devs[N - 1], 2);
  }

  /* ---------- 屏 3 渲染：过调抑制 ---------- */
  function renderOsc() {
    circ = M.genCirc(N, 20261151);
    soft = M.softSense(circ, state.senseMode, N, 20261152);
    for (var i = 0; i < N; i++) devs[i] = 1.55 - soft.sense[i];
    var cExp = M.oscillationCtrl(devs, 0, N);
    var cRec = M.oscillationCtrl(devs, 1, N);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">加量后性能偏差：经验 vs 推荐（过调抑制）</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-width="1"/>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h / 2) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h / 2) + '" stroke="#9ba3a9" stroke-width="0.8" stroke-dasharray="4 3"/>';
    var expArr = [], recArr = [];
    for (var i = 0; i < N; i++) { expArr.push(cExp.expPerf[i] / 0.8); recArr.push(cRec.recPerf[i] / 0.8); }
    s += linePath(expArr, x0, y0 + h / 2, w / N, h / 2, '#b26a39', false);
    s += linePath(recArr, x0, y0 + h / 2, w / N, h / 2, '#2f7d6b', false);
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#b26a39">经验</text>';
    s += '<text x="' + (x0 + 46) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#2f7d6b">推荐</text>';
    /* 达标率双柱 */
    var y2 = 160;
    s += '<text x="40" y="' + (y2 - 8) + '" font-size="9" fill="#4d565b" font-weight="700">性能达标率</text>';
    s += '<rect x="40" y="' + y2 + '" width="110" height="44" fill="#d9b78e"/>';
    s += '<text x="95" y="' + (y2 + 27) + '" text-anchor="middle" font-size="10" fill="#4d565b" font-weight="700">' + Math.round(cExp.expOk * 100) + '%</text>';
    s += '<text x="95" y="' + (y2 + 40) + '" text-anchor="middle" font-size="7.5" fill="#8a6b52">经验加量</text>';
    s += '<rect x="200" y="' + y2 + '" width="110" height="44" fill="#2f7d6b"/>';
    s += '<text x="255" y="' + (y2 + 27) + '" text-anchor="middle" font-size="10" fill="#fff" font-weight="700">' + Math.round(cRec.recOk * 100) + '%</text>';
    s += '<text x="255" y="' + (y2 + 40) + '" text-anchor="middle" font-size="7.5" fill="#b9d8cb">推荐+抑过调</text>';
    $('oscChart').innerHTML = s;
    $('roWave').textContent = '波动 ' + num(cRec.recWave, 2) + '（经验 ' + num(cExp.expWave, 2) + '）';
    $('roOk').textContent = Math.round(cRec.recOk * 100) + '%';
    /* 回流清单 */
    var rows = [
      ['加量回流', state.recMode === 0 ? '经验·可能过调' : '推荐·按偏差校准', 'ok'],
      ['性能反馈', '已录入', 'ok'],
      ['波动改善', num(cExp.expWave - cRec.recWave, 2), 'ok']
    ];
    var rs = '';
    for (var r = 0; r < rows.length; r++) {
      rs += '<div class="row"><span>' + rows[r][0] + '</span><b>' + rows[r][1] + '</b><em>' + rows[r][2] + '</em></div>';
    }
    var revEl = $('reviewList');
    if (revEl) revEl.innerHTML = rs;
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    var inSense = $('inSense');
    if (inSense) inSense.addEventListener('input', function () {
      state.senseMode = parseInt(inSense.value, 10);
      $('outSense').textContent = state.senseMode === 0 ? '纯稀疏测量' : '多源融合';
      renderSense(); renderDose(); renderOsc();
    });
    var inRec = $('inRec');
    if (inRec) inRec.addEventListener('input', function () {
      state.recMode = parseInt(inRec.value, 10);
      $('outRec').textContent = state.recMode === 0 ? '经验加量' : '推荐+抑过调';
      renderDose(); renderOsc();
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '多源融合软测量', 'senseCtl'], ['sec2', '加量推荐', 'doseCtl'], ['sec3', '过调抑制', 'oscCtl']].forEach(function (s) {
      var el = $(s[2]); if (!el) return;
      secs.push({ id: s[0], title: s[1], html: el.outerHTML, top: el.offsetTop, height: el.offsetHeight });
    });
    try { parent.postMessage({ __drawer: 'init', sections: secs }, '*'); } catch (e) {}
    window.addEventListener('message', function (e) {
      if (e.source !== window.parent) return;
      var d = e.data;
      if (!d || d.__drawer !== 'control') return;
      var el = doc.querySelector('[data-ctl-id="' + d.id + '"]');
      if (!el) return;
      if (el.type === 'range') { el.value = d.value; el.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (el.tagName === 'BUTTON') { el.click(); }
    });
  }

  /* ---------- 启动 ---------- */
  bind();
  renderSense(); renderDose(); renderOsc();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
