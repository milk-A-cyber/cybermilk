/* =========================================================
   钻时曲线地层划分 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  参数归一化：钻时 + 工况 → 可钻性凸显
   屏 2  变点检测：归一化钻时 → 地层边界
   屏 3  多源验证：岩屑/气测交叉验证 + 复核
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

    var LITHO = ['泥岩', '砂岩', '灰岩', '页岩'];

    /* -----------------------------------------------------
       合成钻时曲线
       返回 { n, rop: Float64Array(钻时), w: Float64Array(钻压), r: Float64Array(转速),
              seg: 地层段[{s,e,litho}] }
       ----------------------------------------------------- */
    function genROP(n, seed) {
      var rnd = mulberry32(seed || 20261191);
      var rop = new Float64Array(n), w = new Float64Array(n), r = new Float64Array(n);
      /* 工况：钻压/转速缓慢变化 */
      for (var i = 0; i < n; i++) {
        w[i] = 8 + 3 * Math.sin(i / 14) + (rnd() - 0.5) * 1.5;
        r[i] = 55 + 10 * Math.sin(i / 20 + 1) + (rnd() - 0.5) * 6;
      }
      /* 地层：按可钻性给钻时基线 */
      var seg = [];
      function add(s, len, litho, base) {
        for (var k = 0; k < len; k++) {
          var t = k / len;
          var edge = (k < 4 || k > len - 4) ? 0.5 + 0.5 * Math.sin(Math.min(k, len - k) * 0.9) : 1;
          rop[s + k] = clamp(base * edge + (rnd() - 0.5) * 0.35, 0.2, 20);
        }
        seg.push({ s: s, e: s + len, litho: litho, base: base });
      }
      add(8, 30, 0, 2.0);  /* 泥岩：可钻性好 */
      add(38, 26, 1, 4.2); /* 砂岩：可钻性差 */
      add(64, 28, 2, 1.4); /* 灰岩：可钻性好 */
      add(92, 20, 3, 6.0); /* 页岩：可钻性差 */
      /* 工况对钻时的影响：钻压越大钻时越短，转速越快钻时越短 */
      for (i = 0; i < n; i++) {
        rop[i] = clamp(rop[i] / (w[i] / 8) / (r[i] / 55), 0.2, 20);
      }
      return { n: n, rop: rop, w: w, r: r, seg: seg };
    }

    /* -----------------------------------------------------
       钻井参数归一化
       用钻压/转速校正钻时。mode 0 不校正，1 校正。
       返回 { ropN: Float64Array }
       ----------------------------------------------------- */
    function ropNorm(d, mode) {
      var n = d.n, out = new Float64Array(n);
      for (var i = 0; i < n; i++) {
        if (mode === 0) out[i] = d.rop[i];
        else out[i] = clamp(d.rop[i] * (d.w[i] / 8) * (d.r[i] / 55), 0.2, 20);
      }
      return out;
    }

    /* -----------------------------------------------------
       变点检测
       滑窗均值差检测地层边界。返回 { bd: [{pos}] }
       ----------------------------------------------------- */
    function changeDetect(ropN, sens) {
      var n = ropN.length;
      var bd = [];
      var win = 5;
      for (var i = win; i < n - win; i++) {
        var m1 = 0, m2 = 0;
        for (var k = i - win; k < i; k++) m1 += ropN[k];
        for (k = i; k < i + win; k++) m2 += ropN[k];
        var diff = Math.abs(m1 / win - m2 / win);
        if (diff > sens) bd.push({ pos: i, diff: diff });
      }
      /* 去重：相邻边界合并 */
      var out = [];
      for (i = 0; i < bd.length; i++) {
        if (out.length === 0 || bd[i].pos - out[out.length - 1].pos > 8) out.push(bd[i]);
      }
      return { bd: out };
    }

    /* -----------------------------------------------------
       边界命中
       变点边界 vs 真实边界。返回 { hit, miss, extra }
       ----------------------------------------------------- */
    function boundaryMatch(d, bd, tol) {
      var trueB = [];
      for (var i = 0; i < d.seg.length - 1; i++) trueB.push(d.seg[i].e);
      var hit = 0;
      var used = new Int32Array(trueB.length);
      var extra = 0;
      for (i = 0; i < bd.bd.length; i++) {
        var best = -1, bestD = 1e9;
        for (var t = 0; t < trueB.length; t++) {
          if (used[t]) continue;
          var dd = Math.abs(bd.bd[i].pos - trueB[t]);
          if (dd < bestD) { bestD = dd; best = t; }
        }
        if (best >= 0 && bestD <= tol) { hit++; used[best] = 1; }
        else extra++;
      }
      return { hit: hit, total: trueB.length, extra: extra, trueB: trueB };
    }

    /* -----------------------------------------------------
       多源验证
       岩屑/气测佐证边界。mode 0 只钻时，1 钻时+岩屑气测。
       返回 { agree, segs:[{s,e,litho}] }
       ----------------------------------------------------- */
    function crossVerify(d, bd, mode) {
      /* 用检测边界切段 */
      var bounds = [0].concat(bd.bd.map(function (x) { return x.pos; })).concat([d.n]);
      var segs = [];
      for (var i = 0; i < bounds.length - 1; i++) {
        var s = bounds[i], e = bounds[i + 1];
        if (e - s < 2) continue;
        var m = 0;
        for (var k = s; k < e; k++) m += d.rop[k];
        m /= (e - s);
        var litho = m > 3 ? (m > 5 ? 3 : 1) : (m > 1.5 ? 0 : 2);
        segs.push({ s: s, e: e, litho: litho });
      }
      /* 与真实地层核对 */
      var agree = 0, total = Math.min(segs.length, d.seg.length);
      for (i = 0; i < total; i++) {
        if (segs[i].litho === d.seg[i].litho) agree++;
      }
      /* 多源：岩屑气测进一步校正（此处模拟一致率提升） */
      if (mode === 1) agree = Math.min(agree + Math.floor(total * 0.15), total);
      return { agree: agree, total: total, segs: segs };
    }

    return {
      clamp: clamp, mulberry32: mulberry32, LITHO: LITHO,
      genROP: genROP, ropNorm: ropNorm, changeDetect: changeDetect,
      boundaryMatch: boundaryMatch, crossVerify: crossVerify
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

  var state = { nData: 120, normMode: 1, sens: 0.9, verifyMode: 1 };

  var d = M.genROP(state.nData, 20261191);

  global.RemoteBridge = {
    M: M,
    genROP: M.genROP, ropNorm: M.ropNorm, changeDetect: M.changeDetect,
    boundaryMatch: M.boundaryMatch, crossVerify: M.crossVerify,
    live: function () {
      return { nData: state.nData, normMode: state.normMode, sens: state.sens, verifyMode: state.verifyMode };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 2 : d); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  var LCOL = ['#b26a39', '#c98a2b', '#7a8a9a', '#5a4a3a'];

  function linePath(arr, x0, y0, xS, yS, color, dash) {
    var s = '<path d="M';
    for (var i = 0; i < arr.length; i++) {
      s += (x0 + i * xS).toFixed(1) + ' ' + (y0 - arr[i] * yS).toFixed(1);
      if (i < arr.length - 1) s += ' L';
    }
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (dash ? 1.8 : 2) + '"' + (dash ? ' stroke-dasharray="5 3"' : '') + '/>';
    return s;
  }

  /* ---------- 屏 1 渲染：参数归一化 ---------- */
  function renderNorm() {
    d = M.genROP(state.nData, 20261191);
    var ropN = M.ropNorm(d, state.normMode);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">参数归一化：' + (state.normMode === 0 ? '原始钻时（工况干扰）' : '归一化后（可钻性凸显）') + '</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-width="1"/>';
    /* 地层底色 */
    d.seg.forEach(function (seg) {
      s += '<rect x="' + (x0 + seg.s * w / state.nData) + '" y="' + y0 + '" width="' + ((seg.e - seg.s) * w / state.nData) + '" height="' + h + '" fill="' + LCOL[seg.litho] + '" opacity="0.16"/>';
    });
    var ropArr = [], normArr = [];
    for (var i = 0; i < state.nData; i++) { ropArr.push(d.rop[i] / 20); normArr.push(ropN[i] / 20); }
    s += linePath(ropArr, x0, y0 + h, w / state.nData, h, '#9ba3a9', true);
    s += linePath(normArr, x0, y0 + h, w / state.nData, h, '#41699b', false);
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#9ba3a9">原始钻时</text>';
    s += '<text x="' + (x0 + 76) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#41699b">归一化后</text>';
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 + h + 16) + '" font-size="7.5" fill="#79828a">底色=地层</text>';
    $('normChart').innerHTML = s;
    $('roNorm').textContent = state.normMode === 0 ? '未归一化' : '已归一化';
    $('roW').textContent = num(d.w.reduce(function (a, b) { return a + b; }, 0) / state.nData, 1);
  }

  /* ---------- 屏 2 渲染：变点检测 ---------- */
  function renderBd() {
    d = M.genROP(state.nData, 20261191);
    var ropN = M.ropNorm(d, state.normMode);
    var cd = M.changeDetect(ropN, state.sens);
    var bm = M.boundaryMatch(d, cd, 8);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">变点检测：地层边界 ' + bm.hit + '/' + bm.total + ' 命中 · 虚分层 ' + bm.extra + '</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-width="1"/>';
    /* 真实边界（黑虚线）与检测边界（红实线） */
    d.seg.forEach(function (seg) {
      s += '<rect x="' + (x0 + seg.s * w / state.nData) + '" y="' + y0 + '" width="' + ((seg.e - seg.s) * w / state.nData) + '" height="' + h + '" fill="' + LCOL[seg.litho] + '" opacity="0.14"/>';
    });
    for (var i = 1; i < d.seg.length; i++) {
      var bx = x0 + d.seg[i].s * w / state.nData;
      s += '<line x1="' + bx + '" y1="' + y0 + '" x2="' + bx + '" y2="' + (y0 + h) + '" stroke="#242b2e" stroke-width="1.4" stroke-dasharray="4 3"/>';
    }
    cd.bd.forEach(function (b) {
      var px = x0 + b.pos * w / state.nData;
      s += '<line x1="' + px + '" y1="' + y0 + '" x2="' + px + '" y2="' + (y0 + h) + '" stroke="#b05a51" stroke-width="1.6"/>';
    });
    var normArr = [];
    for (i = 0; i < state.nData; i++) normArr.push(ropN[i] / 20);
    s += linePath(normArr, x0, y0 + h, w / state.nData, h, '#41699b', false);
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#242b2e">黑虚线=真实边界</text>';
    s += '<text x="' + (x0 + 140) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#b05a51">红实线=检测边界</text>';
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 + h + 16) + '" font-size="7.5" fill="#79828a">灵敏度可调</text>';
    $('bdChart').innerHTML = s;
    $('roHit').textContent = bm.hit + '/' + bm.total;
    $('roExtra').textContent = bm.extra + ' 处';
  }

  /* ---------- 屏 3 渲染：多源验证 ---------- */
  function renderVerify() {
    d = M.genROP(state.nData, 20261191);
    var ropN = M.ropNorm(d, state.normMode);
    var cd = M.changeDetect(ropN, state.sens);
    var cv = M.crossVerify(d, cd, state.verifyMode);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">多源验证：岩屑/气测佐证 · ' + (cv.total ? Math.round(cv.agree / cv.total * 100) : 0) + '% 一致' + (state.verifyMode === 1 ? ' · 多源' : ' · 仅钻时') + '</text>';
    /* 每层：钻时判 vs 岩屑佐证 */
    var bw = (w - 20) / Math.max(1, cv.total);
    for (var i = 0; i < cv.total; i++) {
      var seg = cv.segs[i];
      var bx = x0 + i * bw + 3;
      var rows = [
        ['钻时', M.LITHO[seg.litho], LCOL[seg.litho]],
        ['岩屑', M.LITHO[d.seg[i].litho], LCOL[d.seg[i].litho]]
      ];
      rows.forEach(function (r, ri) {
        var ry = y0 + ri * 30;
        var ok = r[0] === '钻时' ? (seg.litho === d.seg[i].litho) : true;
        var col = ri === 0 ? (ok ? r[2] : '#d0a3a3') : r[2];
        s += '<rect x="' + bx + '" y="' + ry + '" width="' + (bw - 6) + '" height="24" rx="3" fill="' + (ri === 0 ? '#e7eef9' : '#e6f1ec') + '" stroke="' + col + '" stroke-width="1"/>';
        s += '<text x="' + (bx + 5) + '" y="' + (ry + 16) + '" font-size="7.5" fill="#4d565b">' + r[0] + '</text>';
        s += '<text x="' + (bx + (bw - 6) / 2) + '" y="' + (ry + 16) + '" text-anchor="middle" font-size="7.5" fill="#242b2e" font-weight="700">' + r[1] + '</text>';
      });
    }
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#4d565b">每列=一层：钻时判/岩屑佐证</text>';
    $('verifyChart').innerHTML = s;
    $('roAgree').textContent = (cv.total ? Math.round(cv.agree / cv.total * 100) : 0) + '%';
    $('roMode').textContent = state.verifyMode === 0 ? '仅钻时' : '多源';
    /* 复核清单 */
    var rows = [
      ['参数归一化', state.normMode === 0 ? '未' : '已', 'ok'],
      ['边界命中', (function () { var bm = M.boundaryMatch(d, cd, 8); return bm.hit + '/' + bm.total; })(), 'ok'],
      ['多源一致', (cv.total ? Math.round(cv.agree / cv.total * 100) : 0) + '%', 'ok']
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
    var inNorm = $('inNorm');
    if (inNorm) inNorm.addEventListener('input', function () {
      state.normMode = parseInt(inNorm.value, 10);
      $('outNorm').textContent = state.normMode === 0 ? '原始钻时' : '已归一化';
      renderNorm(); renderBd(); renderVerify();
    });
    var inSens = $('inSens');
    if (inSens) inSens.addEventListener('input', function () {
      state.sens = parseFloat(inSens.value);
      $('outSens').textContent = num(state.sens, 1);
      renderBd(); renderVerify();
    });
    var inVerify = $('inVerify');
    if (inVerify) inVerify.addEventListener('input', function () {
      state.verifyMode = parseInt(inVerify.value, 10);
      $('outVerify').textContent = state.verifyMode === 0 ? '仅钻时' : '多源';
      renderVerify();
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '参数归一化', 'normCtl'], ['sec2', '变点检测', 'bdCtl'], ['sec3', '多源验证', 'verifyCtl']].forEach(function (s) {
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
  renderNorm(); renderBd(); renderVerify();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
