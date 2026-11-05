/* =========================================================
   测井曲线智能分层 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  序列分割：测井曲线 → 地层边界
   屏 2  多曲线融合：GR/SP/RT/DEN → 薄互层界线
   屏 3  邻井约束：本井分层 + 邻井 → 一致 + 复核
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

    var LITHO = ['砂岩', '泥岩', '灰岩', '页岩'];

    /* -----------------------------------------------------
       合成测井曲线（GR/SP/RT/DEN）+ 审定分层
       返回 { n, gr, sp, rt, den, seg:[{s,e,litho,thick}] }
       ----------------------------------------------------- */
    function genLog(n, seed) {
      var rnd = mulberry32(seed || 20261191);
      var gr = new Float64Array(n), sp = new Float64Array(n), rt = new Float64Array(n), den = new Float64Array(n);
      var seg = [];
      var d = 0;
      /* 地层：含薄互层（thick 小的层），铺满 100 点 */
      var seq = [[0, 12, 1], [1, 18, 2], [2, 4, 1], [1, 16, 2], [3, 14, 0], [0, 20, 1], [1, 16, 2]]; /* litho, thick, base */
      for (var i = 0; i < seq.length; i++) {
        var litho = seq[i][0], thick = seq[i][1], base = seq[i][2];
        var s = d, e = d + thick;
        for (var k = s; k < e; k++) {
          var t = k / n;
          gr[k] = clamp(base + (rnd() - 0.5) * 0.4, 0, 3);
          sp[k] = clamp(base + (rnd() - 0.5) * 0.4, 0, 3);
          rt[k] = clamp(base + 0.6 + (rnd() - 0.5) * 0.4, 0, 3);
          den[k] = clamp(base * 0.6 + (rnd() - 0.5) * 0.3, 0, 2);
        }
        seg.push({ s: s, e: e, litho: litho, thick: thick });
        d = e;
      }
      return { n: n, gr: gr, sp: sp, rt: rt, den: den, seg: seg };
    }

    /* -----------------------------------------------------
       序列分割（变点检测）
       在曲线上检测地层边界。mode 0 单曲线(GR)，1 多曲线融合。
       返回 { bd:[{pos,diff}] }
       ----------------------------------------------------- */
    function segDetect(d, mode, sens) {
      var n = d.n, win = 5;
      function b(k) { return mode === 0 ? d.gr[k] : (d.gr[k] + d.sp[k] + d.rt[k] + d.den[k]) / 4; }
      var bd = [];
      for (var i = win; i < n - win; i++) {
        var m1 = 0, m2 = 0;
        for (var k = i - win; k < i; k++) m1 += b(k);
        for (k = i; k < i + win; k++) m2 += b(k);
        var diff = Math.abs(m1 / win - m2 / win);
        if (diff > sens) bd.push({ pos: i, diff: diff });
      }
      var out = [];
      for (i = 0; i < bd.length; i++) {
        if (out.length === 0 || bd[i].pos - out[out.length - 1].pos > 8) out.push(bd[i]);
      }
      return { bd: out };
    }

    /* -----------------------------------------------------
       多曲线融合
       用多条曲线联合，薄互层界线更清楚。返回 { fusion: Float64Array, thinN }
       ----------------------------------------------------- */
    function multiFuse(d) {
      var n = d.n, out = new Float64Array(n);
      for (var i = 0; i < n; i++) out[i] = (d.gr[i] + d.sp[i] + d.rt[i] + d.den[i]) / 4;
      var thinN = d.seg.filter(function (s) { return s.thick < 5; }).length;
      return { fusion: out, thinN: thinN };
    }

    /* -----------------------------------------------------
       邻井约束
       邻井分层表约束本井层位一致。mode 0 无约束，1 约束。
       返回 { ok, diffN }
       ----------------------------------------------------- */
    function neighborConstrain(d, bd, mode) {
      var trueB = [];
      for (var i = 0; i < d.seg.length - 1; i++) trueB.push(d.seg[i].e);
      var hit = 0;
      var used = new Int32Array(trueB.length);
      for (i = 0; i < bd.bd.length; i++) {
        var best = -1, bestD = 1e9;
        for (var t = 0; t < trueB.length; t++) {
          if (used[t]) continue;
          var dd = Math.abs(bd.bd[i].pos - trueB[t]);
          if (dd < bestD) { bestD = dd; best = t; }
        }
        if (best >= 0 && bestD <= (mode === 1 ? 4 : 8)) { hit++; used[best] = 1; }
      }
      return { hit: hit, total: trueB.length, diffN: trueB.length - hit };
    }

    return {
      clamp: clamp, mulberry32: mulberry32, LITHO: LITHO,
      genLog: genLog, segDetect: segDetect, multiFuse: multiFuse, neighborConstrain: neighborConstrain
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

  var state = { nData: 100, segMode: 1, sens: 0.6, nbMode: 1, fuseOn: 1 };
  var d = M.genLog(state.nData, 20261191);

  global.RemoteBridge = {
    M: M,
    genLog: M.genLog, segDetect: M.segDetect, multiFuse: M.multiFuse, neighborConstrain: M.neighborConstrain,
    live: function () {
      return { nData: state.nData, segMode: state.segMode, sens: state.sens, nbMode: state.nbMode, fuseOn: state.fuseOn };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 2 : d); }

  var LCOL = ['#b26a39', '#c98a2b', '#7a8a9a', '#5a4a3a'];

  function linePath(arr, x0, y0, xS, yS, color, dash) {
    var s = '<path d="M';
    for (var i = 0; i < arr.length; i++) {
      s += (x0 + i * xS).toFixed(1) + ' ' + (y0 - arr[i] * yS).toFixed(1);
      if (i < arr.length - 1) s += ' L';
    }
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (dash ? 1.6 : 2) + '"' + (dash ? ' stroke-dasharray="5 3"' : '') + '/>';
    return s;
  }

  /* ---------- 屏 1 渲染：序列分割 ---------- */
  function renderSeg() {
    d = M.genLog(state.nData, 20261191);
    var cd = M.segDetect(d, state.segMode, state.sens);
    var nb = M.neighborConstrain(d, cd, state.nbMode);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">序列分割：' + (state.segMode === 0 ? '单曲线(GR)' : '多曲线融合') + ' · 命中 ' + nb.hit + '/' + nb.total + '</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-width="1"/>';
    d.seg.forEach(function (seg) {
      s += '<rect x="' + (x0 + seg.s * w / state.nData) + '" y="' + y0 + '" width="' + ((seg.e - seg.s) * w / state.nData) + '" height="' + h + '" fill="' + LCOL[seg.litho] + '" opacity="0.16"/>';
    });
    for (var i = 1; i < d.seg.length; i++) {
      var bx = x0 + d.seg[i].s * w / state.nData;
      s += '<line x1="' + bx + '" y1="' + y0 + '" x2="' + bx + '" y2="' + (y0 + h) + '" stroke="#242b2e" stroke-width="1.4" stroke-dasharray="4 3"/>';
    }
    cd.bd.forEach(function (b) {
      var px = x0 + b.pos * w / state.nData;
      s += '<line x1="' + px + '" y1="' + y0 + '" x2="' + px + '" y2="' + (y0 + h) + '" stroke="#b05a51" stroke-width="1.6"/>';
    });
    s += linePath(d.gr, x0, y0 + h, w / state.nData, h, '#41699b', false);
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#242b2e">黑虚线=审定层位</text>';
    s += '<text x="' + (x0 + 140) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#b05a51">红实线=检测层位</text>';
    $('segChart').innerHTML = s;
    $('roHit').textContent = nb.hit + '/' + nb.total;
    $('roMode').textContent = state.segMode === 0 ? '单曲线' : '多曲线';
  }

  /* ---------- 屏 2 渲染：多曲线融合 ---------- */
  function renderFuse() {
    d = M.genLog(state.nData, 20261191);
    var mf = M.multiFuse(d);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">多曲线融合：薄互层 ' + mf.thinN + ' 层 · 界线更清楚</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-width="1"/>';
    d.seg.forEach(function (seg) {
      var wpx = (seg.e - seg.s) * w / state.nData;
      var bx = x0 + seg.s * w / state.nData;
      s += '<rect x="' + bx + '" y="' + y0 + '" width="' + wpx + '" height="' + h + '" fill="' + LCOL[seg.litho] + '" opacity="' + (seg.thick < 5 ? 0.55 : 0.16) + '"/>';
      if (wpx > 18) s += '<text x="' + (bx + wpx / 2) + '" y="' + (y0 + h / 2) + '" text-anchor="middle" font-size="7" fill="#fff" font-weight="700">' + M.LITHO[seg.litho] + '</text>';
    });
    /* 单曲线 GR（虚线）与融合曲线（实线） */
    s += linePath(d.gr, x0, y0 + h, w / state.nData, h, '#9ba3a9', true);
    s += linePath(state.fuseOn === 1 ? mf.fusion : d.gr, x0, y0 + h, w / state.nData, h, '#2f7d6b', false);
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#9ba3a9">GR 单曲线</text>';
    s += '<text x="' + (x0 + 90) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#2f7d6b">' + (state.fuseOn === 1 ? '融合曲线' : '未融合') + '</text>';
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 + h + 16) + '" font-size="7.5" fill="#79828a">深色=薄互层（<5m）</text>';
    $('fuseChart').innerHTML = s;
    $('roThin').textContent = mf.thinN + ' 层';
    $('roFuse').textContent = state.fuseOn === 0 ? '单曲线' : '已融合';
  }

  /* ---------- 屏 3 渲染：邻井约束 + 复核 ---------- */
  function renderNb() {
    d = M.genLog(state.nData, 20261191);
    var cd = M.segDetect(d, state.segMode, state.sens);
    var nb = M.neighborConstrain(d, cd, state.nbMode);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">邻井约束：' + (state.nbMode === 0 ? '无约束' : '有约束') + ' · 命中 ' + nb.hit + '/' + nb.total + ' · 偏差 ' + nb.diffN + '</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-width="1"/>';
    /* 本井层位（上排）与邻井层位（下排） */
    d.seg.forEach(function (seg) {
      var wpx = (seg.e - seg.s) * w / state.nData;
      var bx = x0 + seg.s * w / state.nData;
      s += '<rect x="' + bx + '" y="' + y0 + '" width="' + wpx + '" height="' + (h / 2 - 6) + '" fill="' + LCOL[seg.litho] + '" opacity="0.5"/>';
      s += '<rect x="' + bx + '" y="' + (y0 + h / 2) + '" width="' + wpx + '" height="' + (h / 2 - 6) + '" fill="' + LCOL[seg.litho] + '" opacity="0.85"/>';
    });
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 + 14) + '" font-size="7.5" fill="#fff" font-weight="700">本井</text>';
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 + h / 2 + 14) + '" font-size="7.5" fill="#fff" font-weight="700">邻井</text>';
    /* 偏差标记 */
    for (var i = 1; i < d.seg.length; i++) {
      var bx2 = x0 + d.seg[i].s * w / state.nData;
      s += '<line x1="' + bx2 + '" y1="' + y0 + '" x2="' + bx2 + '" y2="' + (y0 + h) + '" stroke="#b05a51" stroke-width="1" stroke-dasharray="3 3"/>';
    }
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 + h + 16) + '" font-size="7.5" fill="#79828a">上=本井分层 · 下=邻井分层</text>';
    $('nbChart').innerHTML = s;
    $('roNbHit').textContent = nb.hit + '/' + nb.total;
    $('roNbMode').textContent = state.nbMode === 0 ? '无约束' : '有约束';
    /* 复核清单 */
    var rows = [
      ['层位命中', nb.hit + '/' + nb.total, 'ok'],
      ['薄互层', (function () { return M.multiFuse(d).thinN + ' 层'; })(), 'ok'],
      ['边界偏差', nb.diffN + ' 处', 'ok']
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
    var inSeg = $('inSeg');
    if (inSeg) inSeg.addEventListener('input', function () {
      state.segMode = parseInt(inSeg.value, 10);
      $('outSeg').textContent = state.segMode === 0 ? '单曲线' : '多曲线';
      renderSeg(); renderFuse(); renderNb();
    });
    var inSens = $('inSens');
    if (inSens) inSens.addEventListener('input', function () {
      state.sens = parseFloat(inSens.value);
      $('outSens').textContent = num(state.sens, 2);
      renderSeg(); renderNb();
    });
    var inFuse = $('inFuse');
    if (inFuse) inFuse.addEventListener('input', function () {
      state.fuseOn = parseInt(inFuse.value, 10);
      $('outFuse').textContent = state.fuseOn === 0 ? '单曲线' : '已融合';
      renderFuse();
    });
    var inNb = $('inNb');
    if (inNb) inNb.addEventListener('input', function () {
      state.nbMode = parseInt(inNb.value, 10);
      $('outNb').textContent = state.nbMode === 0 ? '无约束' : '有约束';
      renderNb();
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '序列分割', 'segCtl'], ['sec2', '多曲线融合', 'fuseCtl'], ['sec3', '邻井约束', 'nbCtl']].forEach(function (s) {
      var el = $(s[2]); if (!el) return;
      secs.push({ id: s[0], title: s[1], html: el.outerHTML, top: el.offsetTop, height: el.offsetHeight });
    });
    try { parent.postMessage({ __drawer: 'init', sections: secs }, '*'); } catch (e) {}
    window.addEventListener('message', function (e) {
      if (e.source !== window.parent) return;
      var dd = e.data;
      if (!dd || dd.__drawer !== 'control') return;
      var el = doc.querySelector('[data-ctl-id="' + dd.id + '"]');
      if (!el) return;
      if (el.type === 'range') { el.value = dd.value; el.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (el.tagName === 'BUTTON') { el.click(); }
    });
  }

  /* ---------- 启动 ---------- */
  bind();
  renderSeg(); renderFuse(); renderNb();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
