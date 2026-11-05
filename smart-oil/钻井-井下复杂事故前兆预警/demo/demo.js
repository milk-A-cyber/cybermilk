/* =========================================================
   井下复杂事故前兆预警 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  多变量异常检测：10+ 通道 → 综合异常分数
   屏 2  不均衡处理：异常样本极少 → 重采样/SMOTE 补少数类
   屏 3  可解释预警：报警 + 通道贡献 + 复核回流
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

    var CHANNELS = ['扭矩', '立压', '流量', '转速'];
    var FAULTS = ['卡钻', '井漏', '溢流'];

    /* -----------------------------------------------------
       合成正常多通道时序
       每通道有基线 + 波动 + 漂移。返回 { n, data: [chan][t] }
       ----------------------------------------------------- */
    function genChannels(n, seed) {
      var rnd = mulberry32(seed || 20261141);
      var nc = CHANNELS.length;
      var base = [6, 15, 22, 55];   /* 扭矩/立压/流量/转速 基线 */
      var amp = [0.5, 0.8, 0.7, 2.5];
      var data = [];
      for (var c = 0; c < nc; c++) {
        data[c] = new Float64Array(n);
        for (var t = 0; t < n; t++) {
          data[c][t] = clamp(base[c] + Math.sin(t * 0.05 + c) * amp[c] * 0.4 + (rnd() - 0.5) * amp[c], 0.5, 70);
        }
      }
      return { n: n, data: data };
    }

    /* -----------------------------------------------------
       注入异常前兆
       type 0 卡钻(扭矩↑立压↑流量↓) 1 井漏(流量↑立压↓) 2 溢流(立压↑流量↑)
       在 idx 位置注入一段前兆。返回注入后的通道（拷贝）。
       ----------------------------------------------------- */
    function injectAnomaly(channels, idx, type, strength, seed) {
      var rnd = mulberry32(seed || 20261142);
      var n = channels.n, nc = channels.data.length;
      var out = [];
      for (var c = 0; c < nc; c++) { out[c] = new Float64Array(n); out[c].set(channels.data[c]); }
      var w = 8;
      for (var t = 0; t < w; t++) {
        var p = t / (w - 1);
        var env = Math.sin(p * Math.PI) * strength;
        if (type === 0) { out[0][idx + t] += env * 2.5; out[1][idx + t] += env * 2.2; out[2][idx + t] -= env * 1.8; }
        else if (type === 1) { out[1][idx + t] -= env * 2.4; out[2][idx + t] += env * 2.0; }
        else { out[1][idx + t] += env * 2.2; out[2][idx + t] += env * 1.8; }
        for (c = 0; c < nc; c++) out[c][idx + t] = clamp(out[c][idx + t], 0.5, 70);
      }
      return { n: n, data: out };
    }

    /* -----------------------------------------------------
       多变量异常检测
       滑动窗口内各通道偏离自身基线 → 综合异常分数（0..1）。
       window：窗口大小。返回 { score: [t], contrib: [chan][t] }
       ----------------------------------------------------- */
    function detectAnomaly(channels, window, thr, base) {
      var n = channels.n, nc = channels.data.length;
      var win = window || 5;
      var score = new Float64Array(n);
      var contrib = [];
      for (var c = 0; c < nc; c++) contrib[c] = new Float64Array(n);
      /* 基线统计量：优先用正常通道（base），否则用当前通道（被异常稀释） */
      var src = base || channels;
      var mean = [], sd = [];
      for (c = 0; c < nc; c++) {
        var m = 0;
        for (var t = 0; t < n; t++) m += src.data[c][t];
        m /= n;
        var v = 0;
        for (t = 0; t < n; t++) v += (src.data[c][t] - m) * (src.data[c][t] - m);
        mean.push(m); sd.push(Math.sqrt(v / n) + 1e-6);
      }
      for (t = 0; t < n; t++) {
        var s = 0;
        for (c = 0; c < nc; c++) {
          /* 滑动窗口均值偏离 */
          var wm = 0;
          var cnt = 0;
          for (var k = Math.max(0, t - win); k <= Math.min(n - 1, t + win); k++) { wm += channels.data[c][k]; cnt++; }
          wm /= cnt;
          var z = Math.abs(wm - mean[c]) / sd[c];
          var contribC = clamp((z - 1.5) / 3, 0, 1);
          contrib[c][t] = contribC;
          s += contribC * contribC;
        }
        score[t] = clamp(Math.sqrt(s / nc), 0, 1);
      }
      return { score: score, contrib: contrib, thr: thr || 0.5 };
    }

    /* 预警事件：分数超阈值段 */
    function alertEvents(score, thr) {
      var n = score.length;
      var evts = [];
      var inAlert = false;
      var start = 0;
      for (var t = 0; t < n; t++) {
        if (score[t] >= thr && !inAlert) { inAlert = true; start = t; }
        if (score[t] < thr && inAlert) { inAlert = false; evts.push({ start: start, end: t - 1 }); }
      }
      if (inAlert) evts.push({ start: start, end: n - 1 });
      return evts;
    }

    /* -----------------------------------------------------
       不均衡处理
       少数类（异常）比例极低。method：none/upsample/smote。
       返回合成后的样本比例 + 检测召回改善因子。
       ----------------------------------------------------- */
    function balanceTrain(anomalyRatio, method, seed) {
      var rnd = mulberry32(seed || 20261143);
      var ratio = clamp(anomalyRatio, 0.001, 0.5);
      var outRatio;
      if (method === 'none') outRatio = ratio;
      else if (method === 'upsample') outRatio = clamp(ratio * (1.5 + rnd() * 1.5), 0.05, 0.35);
      else outRatio = clamp(ratio * (2.5 + rnd() * 1.5), 0.1, 0.4);
      /* 召回改善因子：均衡越好召回越高 */
      var recall = clamp(0.4 + outRatio * 1.2, 0.4, 0.95);
      var falseRate = clamp(0.35 - outRatio * 0.6, 0.05, 0.35);
      return { ratioIn: ratio, ratioOut: outRatio, method: method, recall: recall, falseRate: falseRate };
    }

    /* -----------------------------------------------------
       可解释预警
       对一次预警事件，算各通道贡献度 + 触发时刻。返回解释。
       ----------------------------------------------------- */
    function explainAlert(channels, contrib, evt) {
      var nc = channels.data.length;
      var contribSum = new Float64Array(nc);
      var peakT = evt.start, peakV = -1;
      for (var t = evt.start; t <= evt.end; t++) {
        for (var c = 0; c < nc; c++) contribSum[c] += contrib[c][t];
        var s = 0;
        for (c = 0; c < nc; c++) s += contrib[c][t];
        if (s > peakV) { peakV = s; peakT = t; }
      }
      var total = 0;
      for (c = 0; c < nc; c++) total += contribSum[c];
      var per = [];
      for (c = 0; c < nc; c++) per.push({ chan: CHANNELS[c], weight: total > 0 ? contribSum[c] / total : 0 });
      per.sort(function (a, b) { return b.weight - a.weight; });
      return { channels: per, peakT: peakT, duration: evt.end - evt.start + 1 };
    }

    return {
      clamp: clamp, mulberry32: mulberry32, CHANNELS: CHANNELS, FAULTS: FAULTS,
      genChannels: genChannels, injectAnomaly: injectAnomaly,
      detectAnomaly: detectAnomaly, alertEvents: alertEvents,
      balanceTrain: balanceTrain, explainAlert: explainAlert
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
    faultType: 0, strength: 0.7, thr: 0.5, window: 5,
    balMethod: 1 /* 0 none 1 upsample 2 smote */, anomalyRatio: 0.01
  };

  var chan1 = M.genChannels(60, 20261141);
  var noisy1 = M.injectAnomaly(chan1, 40, state.faultType, state.strength, 20261142);
  var det1 = M.detectAnomaly(noisy1, state.window, state.thr);

  global.RemoteBridge = {
    M: M,
    genChannels: M.genChannels, injectAnomaly: M.injectAnomaly,
    detectAnomaly: M.detectAnomaly, alertEvents: M.alertEvents,
    balanceTrain: M.balanceTrain, explainAlert: M.explainAlert,
    live: function () {
      return { faultType: state.faultType, strength: state.strength, thr: state.thr, window: state.window, balMethod: state.balMethod, anomalyRatio: state.anomalyRatio };
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

  /* ---------- 屏 1 渲染：多变量异常检测 ---------- */
  function renderDetect() {
    chan1 = M.genChannels(60, 20261141);
    noisy1 = M.injectAnomaly(chan1, 40, state.faultType, state.strength, 20261142);
    det1 = M.detectAnomaly(noisy1, state.window, state.thr, chan1);
    var evts = M.alertEvents(det1.score, state.thr);
    var n = 60, H = 90, x0 = 30, y0 = 18;
    var xS = 360 / n;

    /* 多通道时序（层叠） */
    var s = '';
    var colors = ['#b26a39', '#41699b', '#2f7d6b', '#6b7a6b'];
    for (var c = 0; c < 4; c++) {
      var ch = noisy1.data[c];
      /* 通道值范围归一化到 0..1 */
      var minV = Infinity, maxV = -Infinity;
      for (var t = 0; t < n; t++) { if (ch[t] < minV) minV = ch[t]; if (ch[t] > maxV) maxV = ch[t]; }
      var span = (maxV - minV) || 1;
      var arr = [];
      for (t = 0; t < n; t++) arr.push((ch[t] - minV) / span);
      var yBase = y0 + c * 24 + 14;
      s += '<text x="4" y="' + (yBase + 3) + '" font-size="7.5" fill="' + colors[c] + '" font-weight="700">' + M.CHANNELS[c] + '</text>';
      s += linePath(arr, x0, yBase, xS, 20, colors[c], false);
    }
    /* 异常前兆区 */
    var injStart = 40, injW = 8;
    s += '<rect x="' + (x0 + injStart * xS) + '" y="' + (y0 - 2) + '" width="' + (injW * xS) + '" height="' + (4 * 24 + 8) + '" fill="#f5d9d4" opacity="0.5" stroke="#b05a51" stroke-width="1"/>';
    s += '<text x="' + (x0 + (injStart + injW / 2) * xS) + '" y="' + (y0 - 4) + '" font-size="8" fill="#b05a51" text-anchor="middle" font-weight="700">' + M.FAULTS[state.faultType] + '前兆</text>';
    $('chanChart').innerHTML = s;

    /* 异常分数曲线 */
    var sy0 = 210, sH = 80;
    var s2 = '<text x="30" y="' + (sy0 - 8) + '" font-size="9" fill="#4d565b" font-weight="700">综合异常分数</text>';
    s2 += '<line x1="30" y1="' + (sy0 + sH) + '" x2="' + (30 + 360) + '" y2="' + (sy0 + sH) + '" stroke="#9ba3a9" stroke-width="1"/>';
    /* 阈值线 */
    s2 += '<line x1="30" y1="' + (sy0 + sH - state.thr * sH) + '" x2="' + (30 + 360) + '" y2="' + (sy0 + sH - state.thr * sH) + '" stroke="#b05a51" stroke-width="1.2" stroke-dasharray="4 3"/>';
    s2 += '<text x="392" y="' + (sy0 + sH - state.thr * sH + 3) + '" font-size="7.5" fill="#b05a51">阈值 ' + num(state.thr, 2) + '</text>';
    var score = det1.score;
    var arrS = [];
    for (t = 0; t < n; t++) arrS.push(score[t]);
    s2 += linePath(arrS, 30, sy0 + sH, xS, sH, '#24333a', false);
    /* 预警事件标记 */
    evts.forEach(function (e) {
      s2 += '<rect x="' + (30 + e.start * xS) + '" y="' + (sy0 + sH - 90) + '" width="' + ((e.end - e.start + 1) * xS) + '" height="90" fill="#2f7d6b" opacity="0.18"/>';
    });
    $('scoreChart').innerHTML = s2;

    $('roEvts').textContent = evts.length + ' 个预警事件';
    $('roFault').textContent = M.FAULTS[state.faultType];
  }

  /* ---------- 屏 2 渲染：不均衡处理 ---------- */
  function renderBalance() {
    var methods = ['none', 'upsample', 'smote'];
    var method = methods[state.balMethod];
    var r = M.balanceTrain(state.anomalyRatio, method, 20261143);
    /* 柱状：正常 vs 异常 比例 */
    var x0 = 40, y0 = 40, bw = 240;
    var s = '';
    /* 处理前 */
    s += '<text x="40" y="26" font-size="9.5" fill="#4d565b" font-weight="700">处理前：正常 ' + (1 - r.ratioIn) + ' · 异常 ' + r.ratioIn + '</text>';
    s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + (bw * (1 - r.ratioIn)) + '" height="26" fill="#7a8a9a"/>';
    s += '<rect x="' + (x0 + bw * (1 - r.ratioIn)) + '" y="' + y0 + '" width="' + (bw * r.ratioIn) + '" height="26" fill="#b05a51"/>';
    /* 处理后 */
    var label = method === 'none' ? '不处理' : method === 'upsample' ? '重采样' : 'SMOTE 合成';
    s += '<text x="40" y="' + (y0 + 52) + '" font-size="9.5" fill="#4d565b" font-weight="700">' + label + '后：正常 ' + (1 - r.ratioOut).toFixed(2) + ' · 异常 ' + r.ratioOut.toFixed(2) + '</text>';
    s += '<rect x="' + x0 + '" y="' + (y0 + 62) + '" width="' + (bw * (1 - r.ratioOut)) + '" height="26" fill="#7a8a9a"/>';
    s += '<rect x="' + (x0 + bw * (1 - r.ratioOut)) + '" y="' + (y0 + 62) + '" width="' + (bw * r.ratioOut) + '" height="26" fill="#2f7d6b"/>';

    /* 召回 vs 误报 */
    var gx = 40, gy = 180;
    s += '<rect x="' + gx + '" y="' + gy + '" width="180" height="26" rx="4" fill="#e6f1ec" stroke="#2f7d6b"/>';
    s += '<text x="' + (gx + 10) + '" y="' + (gy + 18) + '" font-size="8.5" fill="#22604f" font-weight="700">召回 ' + Math.round(r.recall * 100) + '%</text>';
    s += '<rect x="' + (gx + 200) + '" y="' + gy + '" width="180" height="26" rx="4" fill="#f7ece2" stroke="#b26a39"/>';
    s += '<text x="' + (gx + 210) + '" y="' + (gy + 18) + '" font-size="8.5" fill="#8a4f27" font-weight="700">误报率 ' + Math.round(r.falseRate * 100) + '%</text>';
    $('balChart').innerHTML = s;
    $('roBalMethod').textContent = label + '：异常比例 ' + r.ratioIn.toFixed(3) + ' → ' + r.ratioOut.toFixed(3);
    $('roRecall').textContent = '召回 ' + Math.round(r.recall * 100) + '%';
  }

  /* ---------- 屏 3 渲染：可解释预警 ---------- */
  function renderExplain() {
    chan1 = M.genChannels(60, 20261141);
    noisy1 = M.injectAnomaly(chan1, 40, state.faultType, state.strength, 20261142);
    det1 = M.detectAnomaly(noisy1, state.window, state.thr, chan1);
    var evts = M.alertEvents(det1.score, state.thr);
    var s = '';
    if (evts.length === 0) {
      s = '<text x="40" y="40" font-size="10" fill="#9ba3a9">无预警（阈值过高或异常太弱）</text>';
      $('explChart').innerHTML = s;
      $('roExplain').textContent = '无预警';
      return;
    }
    var evt = evts[0];
    var exp = M.explainAlert(noisy1, det1.contrib, evt);
    /* 通道贡献条形 */
    var y = 24;
    var maxW = Math.max.apply(null, exp.channels.map(function (c) { return c.weight; })) || 1;
    for (var i = 0; i < exp.channels.length; i++) {
      var c = exp.channels[i];
      var w = (c.weight / maxW) * 260;
      var col = i < 2 ? '#b05a51' : '#7a8a9a';
      s += '<text x="40" y="' + (y + 12) + '" font-size="9" fill="#4d565b" font-weight="700">' + c.chan + '</text>';
      s += '<rect x="90" y="' + y + '" width="' + w + '" height="18" rx="3" fill="' + col + '"/>';
      s += '<text x="' + (90 + w + 6) + '" y="' + (y + 14) + '" font-size="8.5" fill="#4d565b">' + Math.round(c.weight * 100) + '%</text>';
      y += 30;
    }
    s += '<text x="40" y="' + (y + 16) + '" font-size="9" fill="#24333a" font-weight="700">触发时刻：第 ' + (exp.peakT + 1) + ' 个采样点 · 持续 ' + exp.duration + ' 点</text>';
    s += '<text x="40" y="' + (y + 34) + '" font-size="8.5" fill="#8a4f27">' + M.FAULTS[state.faultType] + '前兆：' + exp.channels[0].chan + '↑ / ' + exp.channels[1].chan + '↑</text>';
    $('explChart').innerHTML = s;
    $('roExplain').textContent = '预警：' + M.FAULTS[state.faultType] + ' · 主因 ' + exp.channels[0].chan + ' ' + Math.round(exp.channels[0].weight * 100) + '%';
    /* 复核清单 */
    var cls = [];
    var rows = [
      ['前兆事件', M.FAULTS[state.faultType], '真前兆'],
      ['时刻', '第 ' + (exp.peakT + 1) + ' 点', 'ok'],
      ['处置', '已反馈', 'ok']
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
    var inFault = $('inFault');
    if (inFault) inFault.addEventListener('input', function () {
      state.faultType = parseInt(inFault.value, 10);
      $('outFault').textContent = M.FAULTS[state.faultType];
      renderDetect(); renderExplain();
    });
    var inStr = $('inStr');
    if (inStr) inStr.addEventListener('input', function () {
      state.strength = parseFloat(inStr.value);
      $('outStr').textContent = num(state.strength, 2);
      renderDetect(); renderExplain();
    });
    var inThr = $('inThr');
    if (inThr) inThr.addEventListener('input', function () {
      state.thr = parseFloat(inThr.value);
      $('outThr').textContent = num(state.thr, 2);
      renderDetect(); renderExplain();
    });
    var inMethod = $('inMethod');
    if (inMethod) inMethod.addEventListener('input', function () {
      state.balMethod = parseInt(inMethod.value, 10);
      var labels = ['不处理', '重采样', 'SMOTE'];
      $('outMethod').textContent = labels[state.balMethod];
      renderBalance();
    });
    var inRatio = $('inRatio');
    if (inRatio) inRatio.addEventListener('input', function () {
      state.anomalyRatio = parseFloat(inRatio.value);
      $('outRatio').textContent = num(state.anomalyRatio, 3);
      renderBalance();
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '异常检测', 'detCtl'], ['sec2', '不均衡处理', 'balCtl'], ['sec3', '可解释预警', 'explCtl']].forEach(function (s) {
      var el = $(s[2]); if (!el) return;
      el.querySelectorAll('input, button').forEach(function (c) {
        if (c.type === 'range') c.setAttribute('value', c.value);
      });
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
  renderDetect(); renderBalance(); renderExplain();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
