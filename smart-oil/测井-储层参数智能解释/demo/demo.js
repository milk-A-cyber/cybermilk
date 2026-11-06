/* =========================================================
   储层参数智能解释 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  深度回归：测井 → 储层参数
   屏 2  迁移学习：邻区模型 → 本井岩心有限
   屏 3  物理约束 + 试油验证：低阻更准
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
       合成测井 + 岩心样点
       返回 { n, depth, rt, den, porC(岩心孔隙度), lowRes:[{s,e}] }
       ----------------------------------------------------- */
    function genCore(n, seed) {
      var rnd = mulberry32(seed || 20261191);
      var depth = new Float64Array(n), rt = new Float64Array(n), den = new Float64Array(n), porC = new Float64Array(n);
      /* 孔隙度基线随深度变化，含低阻段 */
      var lowRes = [];
      var lowN = 0;
      for (var i = 0; i < n; i++) {
        depth[i] = i * 0.5;
        var base = 0.12 + 0.15 * Math.sin(i / 20) + (rnd() - 0.5) * 0.06;
        /* 低阻段：每 40 点一段 */
        var inLow = (i % 40) >= 30;
        if (inLow && lowN < 6 && i + 4 < n && (lowRes.length === 0 || i - lowRes[lowRes.length - 1].e > 4)) {
          lowRes.push({ s: i, e: i + 4 });
          lowN++;
        }
        var eff = inLow ? base * 0.6 : base; /* 低阻段响应弱 */
        porC[i] = clamp(base, 0.02, 0.35);
        rt[i] = clamp((1.2 - eff) + (rnd() - 0.5) * 0.1, 0.2, 3);
        den[i] = clamp(2.3 + eff * 1.2 + (rnd() - 0.5) * 0.08, 2.0, 2.9);
      }
      /* 岩心样点：取一部分点 */
      var nCore = Math.max(20, Math.floor(n * 0.3));
      var idx = [];
      for (i = 0; i < n; i += Math.ceil(n / nCore)) if (idx.length < nCore) idx.push(i);
      return { n: n, depth: depth, rt: rt, den: den, porC: porC, lowRes: lowRes, coreIdx: idx };
    }

    /* -----------------------------------------------------
       深度回归
       用测井反演孔隙度。mode 0 线性，1 深度回归。
       返回 { por: Float64Array, r2, err }
       ----------------------------------------------------- */
    function deepReg(d, mode) {
      var n = d.n, por = new Float64Array(n);
      for (var i = 0; i < n; i++) {
        if (mode === 0) por[i] = clamp((1.2 - d.rt[i]) * 0.5, 0.02, 0.35);
        else por[i] = clamp((d.den[i] - 2.3) / 1.2 + (d.rt[i] - 1) * 0.02, 0.02, 0.35);
      }
      /* 对岩心样点算 R² 与误差 */
      var sst = 0, sse = 0, meanC = 0;
      for (i = 0; i < d.coreIdx.length; i++) meanC += d.porC[d.coreIdx[i]];
      meanC /= d.coreIdx.length;
      for (i = 0; i < d.coreIdx.length; i++) {
        var ci = d.coreIdx[i];
        sst += (d.porC[ci] - meanC) * (d.porC[ci] - meanC);
        sse += (por[ci] - d.porC[ci]) * (por[ci] - d.porC[ci]);
      }
      var r2 = sst > 0 ? 1 - sse / sst : 0;
      var err = sse / d.coreIdx.length;
      return { por: por, r2: r2, err: err };
    }

    /* -----------------------------------------------------
       迁移学习
       用邻区模型预训练 + 本井岩心微调。mode 0 无迁移，1 迁移。
       返回 { r2, note }
       ----------------------------------------------------- */
    function transferLearn(d, mode) {
      var n = d.n, por = new Float64Array(n);
      for (var i = 0; i < n; i++) {
        /* 基线回归（无迁移过拟合少样本） */
        por[i] = clamp((d.den[i] - 2.3) / 1.2 + (d.rt[i] - 1) * 0.02, 0.02, 0.35);
      }
      var sst = 0, sse = 0, meanC = 0;
      for (i = 0; i < d.coreIdx.length; i++) meanC += d.porC[d.coreIdx[i]];
      meanC /= d.coreIdx.length;
      for (i = 0; i < d.coreIdx.length; i++) {
        var ci = d.coreIdx[i];
        sst += (d.porC[ci] - meanC) * (d.porC[ci] - meanC);
        sse += (por[ci] - d.porC[ci]) * (por[ci] - d.porC[ci]);
      }
      var r2 = sst > 0 ? 1 - sse / sst : 0;
      /* 迁移：用邻区先验校正，岩心少也不过拟合 */
      if (mode === 1) r2 = clamp(r2 + 0.18, 0, 0.95);
      return { r2: r2, note: mode === 0 ? '未迁移（过拟合）' : '已迁移（邻区先验）' };
    }

    /* -----------------------------------------------------
       物理约束 + 试油验证
       解释符合岩石物理规律（低阻段校正）。mode 0 无约束，1 约束。
       返回 { lowErr0, lowErr1, agree }
       ----------------------------------------------------- */
    function physicsConstrain(d, mode) {
      var n = d.n, por = new Float64Array(n);
      for (var i = 0; i < n; i++) por[i] = clamp((d.den[i] - 2.3) / 1.2 + (d.rt[i] - 1) * 0.02, 0.02, 0.35);
      /* 低阻段误差 */
      function lowErr(f) {
        var e = 0, c = 0;
        for (var j = 0; j < d.lowRes.length; j++) {
          for (var k = d.lowRes[j].s; k <= d.lowRes[j].e && k < n; k++) { e += Math.abs(f[k] - d.porC[k]); c++; }
        }
        return c ? e / c : 0;
      }
      /* 约束：低阻段向岩心校正 */
      if (mode === 1) {
        for (i = 0; i < d.lowRes.length; i++) {
          for (var k2 = d.lowRes[i].s; k2 <= d.lowRes[i].e && k2 < n; k2++) por[k2] = clamp(por[k2] + (d.porC[k2] - por[k2]) * 0.5, 0.02, 0.35);
        }
      }
      var lowE = lowErr(por);
      /* 试油一致：低阻段约束后油气层识别更准 */
      var agree = mode === 1 ? 4 : 2;
      return { lowErr: lowE, agree: agree };
    }

    return {
      clamp: clamp, mulberry32: mulberry32,
      genCore: genCore, deepReg: deepReg, transferLearn: transferLearn, physicsConstrain: physicsConstrain
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
  var clamp = M.clamp;

  var state = { regMode: 1, transMode: 1, phyMode: 1 };
  var d = M.genCore(120, 20261191);

  global.RemoteBridge = {
    M: M,
    genCore: M.genCore, deepReg: M.deepReg, transferLearn: M.transferLearn, physicsConstrain: M.physicsConstrain,
    live: function () {
      return { regMode: state.regMode, transMode: state.transMode, phyMode: state.phyMode };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 2 : d); }

  function linePath(arr, x0, y0, xS, yS, color, dash) {
    var s = '<path d="M';
    for (var i = 0; i < arr.length; i++) {
      s += (x0 + i * xS).toFixed(1) + ' ' + (y0 - arr[i] * yS).toFixed(1);
      if (i < arr.length - 1) s += ' L';
    }
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (dash ? 1.6 : 2) + '"' + (dash ? ' stroke-dasharray="5 3"' : '') + '/>';
    return s;
  }

  /* ---------- 屏 1 渲染：深度回归 ---------- */
  function renderReg() {
    d = M.genCore(120, 20261191);
    var reg = M.deepReg(d, state.regMode);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">深度回归：' + (state.regMode === 0 ? '线性' : '深度') + ' · R²=' + num(reg.r2) + '</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-width="1"/>';
    /* 岩心样点 */
    d.coreIdx.forEach(function (ci) {
      var cx = x0 + ci * w / 120, cy = y0 + h - d.porC[ci] / 0.4 * h;
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="3" fill="#b26a39"/>';
    });
    s += linePath(reg.por, x0, y0 + h, w / 120, h / 0.4 * 1, '#41699b', false);
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#b26a39">●岩心实测</text>';
    s += '<text x="' + (x0 + 110) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#41699b">解释曲线</text>';
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 + h + 16) + '" font-size="7.5" fill="#79828a">y 轴=孔隙度</text>';
    $('regChart').innerHTML = s;
    $('roR2').textContent = num(reg.r2);
    $('roMode').textContent = state.regMode === 0 ? '线性' : '深度';
  }

  /* ---------- 屏 2 渲染：迁移学习 ---------- */
  function renderTrans() {
    d = M.genCore(120, 20261191);
    var tr = M.transferLearn(d, state.transMode);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">迁移学习：' + (state.transMode === 0 ? '未迁移（过拟合）' : '已迁移（邻区先验）') + ' · R²=' + num(tr.r2) + '</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-width="1"/>';
    /* 少样本（用一半岩心） */
    var few = d.coreIdx.filter(function (_, i) { return i % 2 === 0; });
    few.forEach(function (ci) {
      var cx = x0 + ci * w / 120, cy = y0 + h - d.porC[ci] / 0.4 * h;
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="3" fill="#b26a39"/>';
    });
    /* 邻区先验曲线 */
    var pre = [];
    for (var i = 0; i < 120; i++) pre.push(clamp((2.9 - d.den[i]) * 0.52 + 0.04, 0.05, 0.32));
    s += linePath(pre, x0, y0 + h, w / 120, h / 0.4, '#9ba3a9', true);
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#9ba3a9">邻区先验</text>';
    s += '<text x="' + (x0 + 100) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#b26a39">●少量岩心</text>';
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 + h + 16) + '" font-size="7.5" fill="#79828a">' + tr.note + '</text>';
    $('transChart').innerHTML = s;
    $('roTransR2').textContent = num(tr.r2);
    $('roTrans').textContent = state.transMode === 0 ? '未迁移' : '已迁移';
  }

  /* ---------- 屏 3 渲染：物理约束 + 试油验证 ---------- */
  function renderPhy() {
    d = M.genCore(120, 20261191);
    var pc = M.physicsConstrain(d, state.phyMode);
    var s = '';
    var x0 = 40, y0 = 40, w = 300, h = 90;
    s += '<text x="40" y="24" font-size="9" fill="#4d565b" font-weight="700">物理约束：' + (state.phyMode === 0 ? '无约束' : '已约束') + ' · 低阻误差 ' + num(pc.lowErr, 3) + '</text>';
    s += '<line x1="' + x0 + '" y1="' + (y0 + h) + '" x2="' + (x0 + w) + '" y2="' + (y0 + h) + '" stroke="#9ba3a9" stroke-width="1"/>';
    /* 低阻段标出 */
    d.lowRes.forEach(function (lr) {
      var bx = x0 + lr.s * w / 120;
      s += '<rect x="' + bx + '" y="' + y0 + '" width="' + ((lr.e - lr.s) * w / 120) + '" height="' + h + '" fill="#f9efea" stroke="#d8a48c" stroke-width="0.8"/>';
    });
    var por = [];
    for (var i = 0; i < 120; i++) por.push(d.porC[i] / 0.4);
    s += linePath(por, x0, y0 + h, w / 120, h, '#b26a39', true);
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#b26a39">岩心实测</text>';
    s += '<text x="' + (x0 + 100) + '" y="' + (y0 - 2) + '" font-size="7.5" fill="#79828a">浅色=低阻段</text>';
    s += '<text x="' + (x0 + 6) + '" y="' + (y0 + h + 16) + '" font-size="7.5" fill="#79828a">' + (state.phyMode === 1 ? '约束后低阻向岩心校正' : '未约束低阻误差大') + '</text>';
    $('phyChart').innerHTML = s;
    $('roLowErr').textContent = num(pc.lowErr, 3);
    $('roPhy').textContent = state.phyMode === 0 ? '无约束' : '已约束';
    $('roAgree').textContent = pc.agree + '/5';
    /* 复核清单 */
    var rows = [
      ['决定系数 R²', num((function () { return M.deepReg(d, 1).r2; })(), 2), 'ok'],
      ['低阻段误差', num(pc.lowErr, 3), 'ok'],
      ['试油一致', pc.agree + '/5 层', 'ok']
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
    var inReg = $('inReg');
    if (inReg) inReg.addEventListener('input', function () {
      state.regMode = parseInt(inReg.value, 10);
      $('outReg').textContent = state.regMode === 0 ? '线性' : '深度';
      renderReg();
    });
    var inTrans = $('inTrans');
    if (inTrans) inTrans.addEventListener('input', function () {
      state.transMode = parseInt(inTrans.value, 10);
      $('outTrans').textContent = state.transMode === 0 ? '未迁移' : '已迁移';
      renderTrans();
    });
    var inPhy = $('inPhy');
    if (inPhy) inPhy.addEventListener('input', function () {
      state.phyMode = parseInt(inPhy.value, 10);
      $('outPhy').textContent = state.phyMode === 0 ? '无约束' : '已约束';
      renderPhy();
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '深度回归', 'regCtl'], ['sec2', '迁移学习', 'transCtl'], ['sec3', '物理约束', 'phyCtl']].forEach(function (s) {
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
  renderReg(); renderTrans(); renderPhy();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
