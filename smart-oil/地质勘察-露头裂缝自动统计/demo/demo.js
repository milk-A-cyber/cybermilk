/* =========================================================
   露头裂缝自动统计 · 示范页脚本
   ---------------------------------------------------------
   用合成的「露头裂缝照片」演示三条智能化主线：
     实验 1 · 裂缝实例分割：每条裂缝一个掩膜
     实验 2 · 骨架化 + 线密度：中心线、长度、密度
     实验 3 · 产状反算 + 验证：走向玫瑰图 + 实测校准

   文件内部分层：
     1) Model（纯模型层，Node 可 require，供 flow.js 复用）
     2) 浏览器接线（$ 工具 + 三屏渲染 + Bridge 桥接 + 抽屉上报）
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Model = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var M = {};

  /* ---------- 固定种子随机数（mulberry32） ---------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  M.mulberry32 = mulberry32;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* =========================================================
     合成露头裂缝照片
     ---------------------------------------------------------
     W×H 栅格，岩面背景（不同色调）+ 裂缝（细长低对比线段）。
     每条裂缝有真实走向（angle）、长度、像素坐标，作真值。
     ========================================================= */
  function genOutcrop(seed, W, H) {
    W = W || 64; H = H || 48;
    var rng = mulberry32(seed || 20261105);
    var bg = new Uint8Array(W * H);        /* 背景色调 */
    var px = new Uint8Array(W * H);        /* 0=岩面 1=裂缝 */
    var conf = new Float32Array(W * H);

    /* 岩面背景：两三种色调拼块（模拟不同岩性面） */
    var blk = [];
    for (var bi = 0; bi < 4; bi++) blk.push({ x: Math.floor(rng() * W), y: Math.floor(rng() * H), r: 10 + rng() * 18 });
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var nearest = 0, nd = 1e9;
      for (var bb = 0; bb < blk.length; bb++) {
        var d = (blk[bb].x - x) * (blk[bb].x - x) + (blk[bb].y - y) * (blk[bb].y - y);
        if (d < nd) { nd = d; nearest = bb; }
      }
      bg[y * W + x] = nearest;
      px[y * W + x] = 0; conf[y * W + x] = 0.1;
    }

    /* 裂缝：细长低对比线段，多组走向 */
    var cracks = [];
    var GROUPS = [35, 75, 120];   /* 三组优势走向（°） */
    var nCr = 14 + Math.floor(rng() * 8);
    for (var c = 0; c < nCr; c++) {
      var grp = GROUPS[Math.floor(rng() * GROUPS.length)];
      var ang = grp + (rng() - 0.5) * 18;   /* 组内浮动 */
      var len = 8 + rng() * 20;
      var x0 = 3 + rng() * (W - 6), y0 = 3 + rng() * (H - 6);
      var aRad = ang * Math.PI / 180;
      var dx = Math.cos(aRad), dy = Math.sin(aRad);
      var wd = 1 + (rng() < 0.7 ? 0 : 1);    /* 大多细，少数宽 */
      var pts = [];
      for (var t = 0; t <= len; t += 0.5) {
        var x = Math.round(x0 + dx * t), yy = Math.round(y0 + dy * t);
        if (x < 0 || x >= W || yy < 0 || yy >= H) continue;
        for (var w = 0; w <= wd; w++) {
          var xw = x, yw = yy + w - 1;
          if (xw < 0 || xw >= W || yw < 0 || yw >= H) continue;
          px[yw * W + xw] = 1; conf[yw * W + xw] = 0.45 + rng() * 0.3;
        }
        pts.push([x, yy]);
      }
      if (pts.length < 4) continue;
      cracks.push({ id: 'C' + (c + 1), angle: ang, len: len, x0: x0, y0: y0, pts: pts, wd: wd });
    }

    return { W: W, H: H, px: px, conf: conf, bg: bg, cracks: cracks, groups: GROUPS, nCrack: cracks.length };
  }
  M.genOutcrop = genOutcrop;

  /* =========================================================
     裂缝实例分割（模拟 Mask R-CNN）
     ---------------------------------------------------------
     confTh 高则保守（漏检小裂缝多），低则激进（易粘连）。
     返回 { masks:[{crack, conf, hit}], recall, nDet }
     ========================================================= */
  function instanceSeg(scan, confTh, seed) {
    var rng = mulberry32((seed || 91) + Math.round(confTh * 1000));
    var masks = [], tp = 0;
    for (var c = 0; c < scan.cracks.length; c++) {
      var cr = scan.cracks[c];
      /* 短裂缝难检；宽裂缝易检 */
      var conf = clamp(0.85 - (cr.len < 12 ? 0.38 : 0) + (cr.wd > 0 ? 0.1 : 0) - (confTh - 0.5) * 0.6, 0.08, 0.97);
      if (conf >= confTh) { masks.push({ crack: cr, conf: conf, hit: true }); tp++; }
    }
    /* 粘连：confTh 低时相邻裂缝被并成一条（少算条数） */
    var nMerge = Math.max(0, Math.round((0.55 - confTh) * 3));
    for (var m = 0; m < nMerge; m++) {
      if (masks.length >= 2) { masks.splice(Math.floor(rng() * (masks.length - 1)), 1); tp--; }
    }
    var recall = scan.cracks.length ? tp / scan.cracks.length : 1;
    return { masks: masks, recall: recall, tp: tp, total: scan.cracks.length };
  }
  M.instanceSeg = instanceSeg;

  /* =========================================================
     骨架化：裂缝掩膜 → 中心线 → 长度 / 走向
     ---------------------------------------------------------
     返回 [{id, angle, lenPx, skeleton:[pts]}]
     ========================================================= */
  function skeletonize(seg, minLen, seed) {
    var rng = mulberry32((seed || 55) + (minLen || 2) * 7);
    var skels = [];
    for (var m = 0; m < seg.masks.length; m++) {
      var cr = seg.masks[m].crack;
      var s = cr.pts.slice();
      /* 简化：按最小长度过滤短裂缝 */
      if (s.length < (minLen || 2) * 2) continue;
      skels.push({ id: cr.id, angle: cr.angle, lenPx: s.length, skeleton: s, wd: cr.wd });
    }
    return { skeletons: skels, nSkel: skels.length, total: seg.masks.length };
  }
  M.skeletonize = skeletonize;

  /* =========================================================
     产状反算 + 标定
     ---------------------------------------------------------
     把骨架走向换算成真实地质产状，统计走向分布。
     calibErr 模拟标定误差：越大走向偏差越大。
     返回 { attitudes:[{angle, deg}], rose, meanErr }
     ========================================================= */
  function calibAttitude(skel, calibErr, seed) {
    var rng = mulberry32((seed || 23) + Math.round(calibErr * 100));
    var atts = [];
    for (var s = 0; s < skel.skeletons.length; s++) {
      var sk = skel.skeletons[s];
      var deg = (sk.angle + (rng() - 0.5) * calibErr * 20 + 360) % 360;
      atts.push({ id: sk.id, angle: sk.angle, deg: deg, len: sk.lenPx });
    }
    /* 走向玫瑰图：按 10° 分组计数 */
    var rose = [];
    for (var b = 0; b < 18; b++) rose.push({ bin: b * 10, count: 0 });
    for (var a = 0; a < atts.length; a++) {
      var bin = Math.floor(atts[a].deg / 10) % 18;
      rose[bin].count++;
    }
    var meanErr = 0, n = 0;
    for (var aa = 0; aa < atts.length; aa++) {
      meanErr += Math.abs(((atts[aa].deg - atts[aa].angle + 540) % 360) - 180);
      n++;
    }
    meanErr = n ? meanErr / n : 0;
    return { attitudes: atts, rose: rose, meanErr: meanErr, n: atts.length };
  }
  M.calibAttitude = calibAttitude;

  /* =========================================================
     实测验证：算法产状 vs 罗盘实测
     ---------------------------------------------------------
     返回走向误差，模拟部分实测记录作验证集。
     ========================================================= */
  function verifyAttitude(atts, verifyRatio, seed) {
    var rng = mulberry32((seed || 6) + Math.round(verifyRatio * 100));
    var nV = Math.max(1, Math.floor(atts.n * (verifyRatio || 0.3)));
    var errSum = 0;
    for (var v = 0; v < nV && v < atts.attitudes.length; v++) {
      var at = atts.attitudes[v];
      var measured = (at.angle + (rng() - 0.5) * 1.5 + 360) % 360;  /* 实测本身有 ±1.5° */
      var d = ((at.deg - measured + 540) % 360) - 180;
      errSum += Math.abs(d);
    }
    return { nV: Math.min(nV, atts.attitudes.length), meanErr: atts.n ? errSum / Math.min(nV, atts.attitudes.length) : 0 };
  }
  M.verifyAttitude = verifyAttitude;

  return M;
});

/* =========================================================
   浏览器接线（Node require 时走 module.exports 分支返回，不执行）
   ========================================================= */
if (typeof window !== 'undefined' && !window.__g4ModelOnly) {
  (function () {
    'use strict';
    var M = window.Model;
    var doc = document;

    function $(id) { return doc.getElementById(id); }
    function num(v, n) { return Number(v).toFixed(n === undefined ? 2 : n); }
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

    var SCALE = 8;   /* 栅格 64×48 → 512×384 */
    var SCAN = M.genOutcrop(20261105, 64, 48);
    var BG_COLORS = ['#d8c8a8', '#c9c4b0', '#cdbfa0', '#d2c4ae'];

    /* UI 状态 */
    var segState = { confTh: 0.5 };
    var skelState = { minLen: 2 };
    var calibState = { calibErr: 0.3, verifyRatio: 0.3 };

    /* 屏 1 渲染：裂缝实例分割 */
    function renderSeg() {
      var seg = M.instanceSeg(SCAN, segState.confTh, 20261105);
      var s = '';
      /* 岩面背景 */
      for (var y = 0; y < 48; y++) for (var x = 0; x < 64; x++) {
        var i = y * 64 + x;
        s += '<rect x="' + (x * SCALE) + '" y="' + (y * SCALE) + '" width="' + SCALE + '" height="' + SCALE + '" fill="' + BG_COLORS[SCAN.px[i] === 1 ? 0 : SCAN.bg[i] % BG_COLORS.length] + '" opacity="' + (SCAN.px[i] === 1 ? 0.7 : 1) + '"/>';
      }
      /* 已检出的裂缝掩膜（绿色） */
      for (var m = 0; m < seg.masks.length; m++) {
        var cr = seg.masks[m].crack;
        var path = '';
        for (var p = 0; p < cr.pts.length; p++) {
          path += (p ? 'L' : 'M') + (cr.pts[p][0] * SCALE) + ' ' + (cr.pts[p][1] * SCALE);
        }
        s += '<path d="' + path + '" fill="none" stroke="#2f7d6b" stroke-width="' + ((cr.wd + 1) * SCALE * 0.6) + '" stroke-linecap="round" opacity="0.85"/>';
      }
      /* 漏检裂缝（灰虚线） */
      var detSet = new Set(seg.masks.map(function (m) { return m.crack.id; }));
      for (var c = 0; c < SCAN.cracks.length; c++) {
        if (detSet.has(SCAN.cracks[c].id)) continue;
        var cr2 = SCAN.cracks[c];
        var path2 = '';
        for (var q = 0; q < cr2.pts.length; q++) path2 += (q ? 'L' : 'M') + (cr2.pts[q][0] * SCALE) + ' ' + (cr2.pts[q][1] * SCALE);
        s += '<path d="' + path2 + '" fill="none" stroke="#9ba3a9" stroke-width="1.6" stroke-dasharray="4 3" opacity="0.7"/>';
      }
      $('segChart').innerHTML = s;
      $('roSegRecall').textContent = num(seg.recall * 100, 0) + '%';
      $('roSegDet').textContent = seg.tp + ' / ' + seg.total;
      $('outSegConf').textContent = num(segState.confTh, 2);
      $('segTip').textContent = '绿色 = 检出的裂缝掩膜，灰色虚线 = 漏检裂缝。阈值越高越保守（小裂缝漏检多），越低越激进（易粘连少条数）。';
    }

    /* 屏 2 渲染：骨架化 + 线密度 */
    function renderSkel() {
      var seg = M.instanceSeg(SCAN, segState.confTh, 20261105);
      var skel = M.skeletonize(seg, skelState.minLen, 55);
      var s = '';
      /* 岩面背景 */
      for (var y = 0; y < 48; y++) for (var x = 0; x < 64; x++) {
        var i = y * 64 + x;
        s += '<rect x="' + (x * SCALE) + '" y="' + (y * SCALE) + '" width="' + SCALE + '" height="' + SCALE + '" fill="' + BG_COLORS[SCAN.bg[i] % BG_COLORS.length] + '" opacity="0.35"/>';
      }
      /* 骨架中心线 */
      for (var sk = 0; sk < skel.skeletons.length; sk++) {
        var sko = skel.skeletons[sk];
        var path = '';
        for (var p = 0; p < sko.skeleton.length; p++) {
          path += (p ? 'L' : 'M') + (sko.skeleton[p][0] * SCALE) + ' ' + (sko.skeleton[p][1] * SCALE);
        }
        s += '<path d="' + path + '" fill="none" stroke="#41699b" stroke-width="2.2" stroke-linecap="round"/>';
        s += '<text x="' + (sko.skeleton[0][0] * SCALE + 4) + '" y="' + (sko.skeleton[0][1] * SCALE - 4) + '" font-size="9" fill="#2b4a72">' + sko.id + '</text>';
      }
      $('skelChart').innerHTML = s;
      $('roSkelCount').textContent = skel.nSkel + ' 条';
      $('roSkelFiltered').textContent = (seg.masks.length - skel.nSkel) + ' 条过滤';
      $('outMinLen').textContent = skelState.minLen;
      $('skelTip').textContent = '蓝色 = 裂缝骨架中心线。最小长度过滤掉过短裂缝；骨架质量决定长度与走向量得准不准。';
    }

    /* 屏 3 渲染：产状反算 + 验证 */
    function renderCalib() {
      var seg = M.instanceSeg(SCAN, segState.confTh, 20261105);
      var skel = M.skeletonize(seg, skelState.minLen, 55);
      var atts = M.calibAttitude(skel, calibState.calibErr, 23);
      var ver = M.verifyAttitude(atts, calibState.verifyRatio, 6);
      var s = '';
      /* 走向玫瑰图（10° 分组） */
      var cx = 250, cy = 190, R = 130;
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="none" stroke="#e0d9c8"/>';
      /* 分组背景格 */
      for (var g = 0; g < 18; g++) {
        var a0 = (g * 10) * Math.PI / 180 - Math.PI / 2;
        s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + Math.cos(a0) * R) + '" y2="' + (cy + Math.sin(a0) * R) + '" stroke="#eee8db" stroke-width="0.5"/>';
      }
      var maxCount = 1;
      for (var b = 0; b < atts.rose.length; b++) if (atts.rose[b].count > maxCount) maxCount = atts.rose[b].count;
      for (var bb = 0; bb < atts.rose.length; bb++) {
        var cnt = atts.rose[bb].count;
        var aM = (bb * 10 + 5) * Math.PI / 180 - Math.PI / 2;
        var rInner = R * 0.06, rOuter = R * 0.06 + (cnt / maxCount) * (R * 0.8);
        var col = '#b26a39';
        s += '<path d="M' + (cx + Math.cos(aM - 0.09) * rInner) + ' ' + (cy + Math.sin(aM - 0.09) * rInner) +
             'L' + (cx + Math.cos(aM - 0.09) * rOuter) + ' ' + (cy + Math.sin(aM - 0.09) * rOuter) +
             'A' + rOuter + ',' + rOuter + ' 0 0 1 ' + (cx + Math.cos(aM + 0.09) * rOuter) + ' ' + (cy + Math.sin(aM + 0.09) * rOuter) +
             'L' + (cx + Math.cos(aM + 0.09) * rInner) + ' ' + (cy + Math.sin(aM + 0.09) * rInner) +
             'A' + rInner + ',' + rInner + ' 0 0 0 ' + (cx + Math.cos(aM - 0.09) * rInner) + ' ' + (cy + Math.sin(aM - 0.09) * rInner) + 'Z" fill="' + col + '" opacity="0.75"/>';
      }
      /* 角度标注 */
      for (var gd = 0; gd < 4; gd++) {
        var gA = gd * 45 * Math.PI / 180 - Math.PI / 2;
        s += '<text x="' + (cx + Math.cos(gA) * (R + 12)) + '" y="' + (cy + Math.sin(gA) * (R + 12)) + '" font-size="9" fill="#9ba3a9" text-anchor="middle">' + (gd * 45) + '°</text>';
      }
      s += '<text x="' + cx + '" y="' + (cy - R - 20) + '" font-size="11" fill="#242b2e" font-weight="600" text-anchor="middle">走向玫瑰图（每 10° 一组）</text>';
      $('calibChart').innerHTML = s;
      $('roAttN').textContent = atts.n + ' 条';
      $('roMeanErr').textContent = num(atts.meanErr, 1) + '°';
      $('roVerErr').textContent = num(ver.meanErr, 1) + '°';
      $('outCalibErr').textContent = num(calibState.calibErr, 2);
      $('outVerify').textContent = num(calibState.verifyRatio, 2);
      $('calibTip').textContent = '玫瑰图显示裂缝走向分布（35°/75°/120° 三组）。标定误差越大走向偏差越大；实测验证集用于校准误差到 ≤3°。';
    }

    /* 事件绑定 */
    function bind() {
      var inSeg = $('pSegConf');
      if (inSeg) inSeg.addEventListener('input', function () {
        segState.confTh = parseFloat(inSeg.value);
        renderSeg(); renderSkel(); renderCalib();
      });
      var inMin = $('pMinLen');
      if (inMin) inMin.addEventListener('input', function () {
        skelState.minLen = parseInt(inMin.value, 10);
        renderSkel(); renderCalib();
      });
      var inCalib = $('pCalibErr');
      if (inCalib) inCalib.addEventListener('input', function () {
        calibState.calibErr = parseFloat(inCalib.value);
        renderCalib();
      });
      var inVer = $('pVerify');
      if (inVer) inVer.addEventListener('input', function () {
        calibState.verifyRatio = parseFloat(inVer.value);
        renderCalib();
      });
    }

    /* 抽屉上报 */
    function setupDrawer() {
      if (window.parent === window) return;
      var secs = [];
      [['sec1', '实例分割', 'segCtl'], ['sec2', '骨架化', 'skelCtl'], ['sec3', '产状反算', 'calibCtl']].forEach(function (s) {
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
      });
    }

    /* 启动 */
    renderSeg(); renderSkel(); renderCalib(); bind(); setupDrawer();

    /* 桥接对象：暴露模型层给 flow.js */
    window.RemoteBridge = { M: M, live: function () { return { confTh: segState.confTh, minLen: skelState.minLen, calibErr: calibState.calibErr, verifyRatio: calibState.verifyRatio }; } };
  })();
}
