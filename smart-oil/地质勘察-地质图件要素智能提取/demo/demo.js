/* =========================================================
   地质图件要素智能提取 · 示范页脚本
   ---------------------------------------------------------
   用合成的「扫描地质图件」演示三条智能化主线：
     实验 1 · 目标检测：定位图例符号 / 断层线 / 钻孔柱状图
     实验 2 · OCR 识别：把图面注记从像素读成文本
     实验 3 · 版面分析 + 矢量追踪：理清区块、线条成矢量

   文件内部分层：
     1) Model（纯模型层，Node 可 require，供 flow.js 复用）
     2) 浏览器接线（$ 工具 + 三屏渲染 + Bridge 桥接 + 抽屉上报）
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Model = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var METRIC = {};
  var M = { METRIC: METRIC };

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
     合成扫描地质图件
     ---------------------------------------------------------
     W×H 栅格，背景米黄色（纸感）+ 三类对象：
       - 断层线  ：细长曲线像素（低对比，扫描常见噪声）
       - 图例符号：小方块 / 三角 / 圆（岩性符号，带年代风格）
       - 注记文本：一组「字符槽」，OCR 要读的内容
     返回栅格 + 对象清单（真值，供检测对比）。
     ========================================================= */
  var ROCK_SYM = [
    { name: '砂岩', fill: '#e0c88a', mark: '↗' },
    { name: '灰岩', fill: '#cbbf9a', mark: '△' },
    { name: '泥岩', fill: '#b8c4b5', mark: '○' },
    { name: '页岩', fill: '#c9c4b0', mark: '□' },
    { name: '花岗岩', fill: '#d8b6a2', mark: '◇' }
  ];
  M.ROCK_SYM = ROCK_SYM;

  var FAULT_COLORS = ['#8a4f27', '#7a6a4b', '#6b5a3a'];
  var META_NAMES = ['J2', 'K1', 'T3', 'P2', 'O1', 'C1', 'D3', 'S2'];

  function genScanMap(seed, W, H) {
    W = W || 64; H = H || 48;
    var rng = mulberry32(seed || 20261105);
    var px = new Uint8Array(W * H);           /* 0=纸面 1=断层线 2=符号 3=注记 */
    var conf = new Float32Array(W * H);       /* 像素置信度（符号浓淡 / 线强度） */

    /* 背景纸面微噪 */
    for (var i = 0; i < W * H; i++) { px[i] = 0; conf[i] = 0.1; }

    var faults = [];
    var nFault = 3 + Math.floor(rng() * 2);
    for (var f = 0; f < nFault; f++) {
      var col = FAULT_COLORS[f % FAULT_COLORS.length];
      var y0 = 6 + rng() * (H - 16), x0 = 4 + rng() * (W - 16);
      var amp = 1 + rng() * 3, len = 14 + rng() * 20;
      var pts = [];
      for (var t = 0; t <= len; t += 0.5) {
        var x = Math.round(x0 + t);
        var y = Math.round(y0 + amp * Math.sin(t * 0.7 + f));
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        px[y * W + x] = 1; conf[y * W + x] = 0.55 + rng() * 0.3;
        pts.push([x, y]);
      }
      faults.push({ id: 'F' + (f + 1), color: col, pts: pts, name: '断层' + (f + 1) });
    }

    /* 图例符号：小目标，分散放 */
    var symbols = [];
    var nSym = 12 + Math.floor(rng() * 8);
    for (var s = 0; s < nSym; s++) {
      var rock = ROCK_SYM[Math.floor(rng() * ROCK_SYM.length)];
      var sw = 5 + Math.floor(rng() * 2);   /* 符号尺寸小（检测难点） */
      var sx = Math.floor(3 + rng() * (W - sw - 8));
      var sy = Math.floor(3 + rng() * (H - sw - 8));
      /* 画符号方块 */
      for (var dy = 0; dy < sw; dy++) for (var dx = 0; dx < sw; dx++) {
        var xi = sx + dx, yi = sy + dy;
        if (xi < W && yi < H) { px[yi * W + xi] = 2; conf[yi * W + xi] = 0.5 + rng() * 0.4; }
      }
      symbols.push({ id: 'S' + (s + 1), rock: rock.name, x: sx, y: sy, w: sw, h: sw, fill: rock.fill });
    }

    /* 注记文本：字符槽（OCR 读取对象） */
    var notes = [];
    var nNote = 6 + Math.floor(rng() * 4);
    for (var n = 0; n < nNote; n++) {
      var nm = META_NAMES[Math.floor(rng() * META_NAMES.length)];
      var cx = Math.floor(6 + rng() * (W - 14));
      var cy = Math.floor(5 + rng() * (H - 8));
      var cw = 2 + nm.length;   /* 字符槽宽度 */
      for (var di = 0; di < cw; di++) {
        var xj = cx + di, yj = cy;
        if (xj < W && yj < H) { px[yj * W + xj] = 3; conf[yj * W + xj] = 0.6; }
      }
      notes.push({ id: 'N' + (n + 1), text: nm, x: cx, y: cy, w: cw, h: 1 });
    }

    return { W: W, H: H, px: px, conf: conf, faults: faults, symbols: symbols, notes: notes };
  }
  M.genScanMap = genScanMap;

  /* =========================================================
     目标检测（模拟 Faster R-CNN / YOLO）
     ---------------------------------------------------------
     用「真值对象 + 检测置信度 + 可能的漏检/误检」合成检测结果：
       confTh 越高越保守（漏检多、误检少），越低越激进。
     返回 { dets:[{x,y,w,h,cls,conf,hit}], recall, precision }
     ========================================================= */
  function detectObjects(scan, confTh, seed) {
    var rng = mulberry32((seed || 42) + Math.round(confTh * 1000));
    var dets = [];
    var tp = 0, fp = 0;

    function emit(x, y, w, h, cls, conf, hit) {
      dets.push({ x: x, y: y, w: w, h: h, cls: cls, conf: conf, hit: hit });
    }

    /* 断层线检测：沿线生成若干检测框 */
    var shouldTotal = 0;
    for (var f = 0; f < scan.faults.length; f++) {
      var fl = scan.faults[f];
      /* 把断层线聚成 1—2 个检测框 */
      var nB = 1 + (fl.pts.length > 30 ? 1 : 0);
      shouldTotal += nB;
      for (var b = 0; b < nB; b++) {
        var seg = fl.pts.slice(Math.floor(b * fl.pts.length / nB), Math.floor((b + 1) * fl.pts.length / nB));
        var minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
        for (var q = 0; q < seg.length; q++) {
          if (seg[q][0] < minX) minX = seg[q][0];
          if (seg[q][0] > maxX) maxX = seg[q][0];
          if (seg[q][1] < minY) minY = seg[q][1];
          if (seg[q][1] > maxY) maxY = seg[q][1];
        }
        var cF = clamp(0.62 + rng() * 0.3 - (confTh - 0.5) * 0.6, 0.2, 0.98);
        if (cF >= confTh) { emit(minX, minY, maxX - minX + 1, maxY - minY + 1, '断层', cF, true); tp++; }
      }
    }

    /* 图例符号检测：小目标，confTh 高时易漏 */
    shouldTotal += scan.symbols.length;
    for (var s = 0; s < scan.symbols.length; s++) {
      var sy = scan.symbols[s];
      var cS = clamp(0.5 + rng() * 0.4 - (confTh - 0.5) * 0.9, 0.1, 0.97);
      if (cS >= confTh) { emit(sy.x, sy.y, sy.w, sy.h, '符号', cS, true); tp++; }
    }

    /* 钻孔柱状图：少量，通常能检到 */
    var nDrill = 2 + Math.floor(rng() * 2);
    shouldTotal += nDrill;
    for (var d = 0; d < nDrill; d++) {
      var dx = Math.floor(5 + rng() * (scan.W - 10));
      var dy = Math.floor(4 + rng() * (scan.H - 10));
      var cD = clamp(0.7 + rng() * 0.2 - (confTh - 0.5) * 0.3, 0.2, 0.98);
      if (cD >= confTh) { emit(dx, dy, 2, 6, '柱状', cD, true); tp++; }
    }

    /* 误检：confTh 低时多出假框 */
    var nFP = Math.max(0, Math.round((0.55 - confTh) * 14));
    for (var e = 0; e < nFP; e++) {
      var ex = Math.floor(3 + rng() * (scan.W - 8));
      var ey = Math.floor(3 + rng() * (scan.H - 8));
      var cE = confTh + rng() * 0.12;
      emit(ex, ey, 3, 3, '符号', cE, false); fp++;
    }

    var recall = shouldTotal ? tp / shouldTotal : 1;
    var precision = (tp + fp) ? tp / (tp + fp) : 1;
    return { dets: dets, recall: recall, precision: precision, tp: tp, fp: fp, total: shouldTotal };
  }
  M.detectObjects = detectObjects;

  /* =========================================================
     OCR 识别注记
     ---------------------------------------------------------
     每个注记真实文本已知，模拟 OCR 按字符错误率 err 出错。
     返回 [{gt, pred, ok, conf}] + 整体准确率。
     ========================================================= */
  var OCR_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789J2K1T3P2O1C1D3S2';
  function ocrRead(scan, err, seed) {
    var rng = mulberry32((seed || 77) + Math.round(err * 100));
    var out = [], correct = 0;
    for (var n = 0; n < scan.notes.length; n++) {
      var gt = scan.notes[n].text;
      var pred = '';
      for (var c = 0; c < gt.length; c++) {
        if (rng() < err) {
          var pick = OCR_ALPHABET[Math.floor(rng() * OCR_ALPHABET.length)];
          pred += pick !== gt[c] ? pick : (pick === 'A' ? 'B' : 'A');
        } else pred += gt[c];
      }
      var ok = pred === gt;
      if (ok) correct++;
      var conf = clamp(1 - err - rng() * 0.2, 0.3, 0.99);
      out.push({ gt: gt, pred: pred, ok: ok, conf: conf });
    }
    return { results: out, acc: scan.notes.length ? correct / scan.notes.length : 1, correct: correct, total: scan.notes.length };
  }
  M.ocrRead = ocrRead;

  /* =========================================================
     版面分析 + 矢量追踪
     ---------------------------------------------------------
     版面分析：把扫描图分成 图区 / 图例区 / 注记区 三个区块。
     矢量追踪：沿断层线像素重建折线矢量，gap 越大越能跨断裂连接。
     返回 { regions, vectors, nVector, linkedGap }
     ========================================================= */
  function layoutAnalyze(scan) {
    /* 简化：按像素类型分布划分区块（图区=断层区，图例区=符号区，注记区=注记区） */
    var regs = [];
    regs.push({ id: 'M', name: '图区', x: 2, y: 2, w: scan.W - 4, h: scan.H - 4, fill: '#eef1ee' });
    var symMinX = 1e9, symMaxX = -1, symMinY = 1e9, symMaxY = -1;
    for (var s = 0; s < scan.symbols.length; s++) {
      var sy = scan.symbols[s];
      if (sy.x < symMinX) symMinX = sy.x;
      if (sy.x + sy.w > symMaxX) symMaxX = sy.x + sy.w;
      if (sy.y < symMinY) symMinY = sy.y;
      if (sy.y + sy.h > symMaxY) symMaxY = sy.y + sy.h;
    }
    if (symMaxX > symMinX) regs.push({ id: 'L', name: '图例区', x: symMinX - 1, y: symMinY - 1, w: symMaxX - symMinX + 2, h: symMaxY - symMinY + 2, fill: '#f7ece2' });
    var noteMinX = 1e9, noteMaxX = -1, noteMinY = 1e9, noteMaxY = -1;
    for (var n = 0; n < scan.notes.length; n++) {
      var nt = scan.notes[n];
      if (nt.x < noteMinX) noteMinX = nt.x;
      if (nt.x + nt.w > noteMaxX) noteMaxX = nt.x + nt.w;
      if (nt.y < noteMinY) noteMinY = nt.y;
      if (nt.y + nt.h > noteMaxY) noteMaxY = nt.y + nt.h;
    }
    if (noteMaxX > noteMinX) regs.push({ id: 'N', name: '注记区', x: noteMinX - 1, y: noteMinY - 1, w: noteMaxX - noteMinX + 2, h: noteMaxY - noteMinY + 2, fill: '#e7eef9' });
    return { regions: regs };
  }
  M.layoutAnalyze = layoutAnalyze;

  function traceVectors(scan, linkGap) {
    var vectors = [];
    var linked = 0;
    for (var f = 0; f < scan.faults.length; f++) {
      var fl = scan.faults[f];
      var pts = fl.pts.slice();
      /* 模拟断裂：按 gap 连接相邻点，gap 越大越能跨断裂 */
      var merged = [];
      for (var i = 0; i < pts.length; i++) {
        merged.push(pts[i]);
        if (i < pts.length - 1) {
          var d = Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
          if (d > 1 && d <= linkGap) { linked++; }
        }
      }
      vectors.push({ id: fl.id, color: fl.color, pts: merged, name: fl.name, complete: true });
    }
    return { vectors: vectors, nVector: vectors.length, linked: linked };
  }
  M.traceVectors = traceVectors;

  return M;
});

/* =========================================================
   浏览器接线（Node require 时走 module.exports 分支返回，不执行）
   ========================================================= */
if (typeof window !== 'undefined' && !window.__g3ModelOnly) {
  (function () {
    'use strict';
    var M = window.Model;
    var doc = document;

    function $(id) { return doc.getElementById(id); }
    function num(v, n) { return Number(v).toFixed(n === undefined ? 2 : n); }
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

    var SCALE = 8;   /* 栅格 64×48 → 512×384 */
    var SCAN = M.genScanMap(20261105, 64, 48);

    /* UI 状态 */
    var detState = { confTh: 0.5 };
    var ocrState = { err: 0.15 };
    var vecState = { linkGap: 3 };

    /* 屏 1 渲染：目标检测 */
    function renderDet() {
      var det = M.detectObjects(SCAN, detState.confTh, 20261105);
      var s = '';
      /* 断层线像素 */
      for (var y = 0; y < 48; y++) for (var x = 0; x < 64; x++) {
        var i = y * 64 + x;
        if (SCAN.px[i] === 1) s += '<rect x="' + (x * SCALE) + '" y="' + (y * SCALE) + '" width="' + SCALE + '" height="' + SCALE + '" fill="#a97b55" opacity="0.8"/>';
      }
      /* 检测框：命中（实线绿），误检（虚线红） */
      for (var d = 0; d < det.dets.length; d++) {
        var b = det.dets[d];
        var col = b.hit ? '#2f7d6b' : '#c0444a';
        var dash = b.hit ? '' : ' stroke-dasharray="4 3"';
        s += '<rect x="' + (b.x * SCALE) + '" y="' + (b.y * SCALE) + '" width="' + (b.w * SCALE) + '" height="' + (b.h * SCALE) + '" fill="none" stroke="' + col + '" stroke-width="1.8"' + dash + '/>';
        s += '<text x="' + ((b.x + b.w + 1) * SCALE) + '" y="' + (b.y * SCALE - 4) + '" font-size="10" fill="' + col + '">' + b.cls + ' ' + num(b.conf, 2) + '</text>';
      }
      $('detChart').innerHTML = s;
      $('roRecall').textContent = num(det.recall * 100, 0) + '%';
      $('roPrecision').textContent = num(det.precision * 100, 0) + '%';
      $('roDetTP').textContent = det.tp + ' / ' + det.total;
      $('roDetFP').textContent = det.fp;
      $('outConfTh').textContent = num(detState.confTh, 2);
      $('detTip').textContent = '绿色实线 = 正确检出的对象框，红色虚线 = 误检框。阈值越高越保守（漏检多、误检少），越低越激进（漏检少、误检多）。';
    }

    /* 屏 2 渲染：OCR 识别 */
    function renderOcr() {
      var ocr = M.ocrRead(SCAN, ocrState.err, 20261105);
      var s = '';
      /* 注记区域块 */
      for (var n = 0; n < ocr.results.length; n++) {
        var r = ocr.results[n];
        var note = SCAN.notes[n];
        var col = r.ok ? '#2f7d6b' : '#c0444a';
        s += '<rect x="' + (note.x * SCALE - 3) + '" y="' + (note.y * SCALE - 6) + '" width="' + (note.w * SCALE + 6) + '" height="' + (SCALE + 12) + '" rx="3" fill="' + (r.ok ? '#e6f1ec' : '#f9efea') + '" stroke="' + col + '"/>';
        s += '<text x="' + (note.x * SCALE + 2) + '" y="' + (note.y * SCALE + 10) + '" font-size="12" fill="' + col + '">' + r.pred + (r.ok ? ' ✓' : ' ✗') + '</text>';
      }
      $('ocrChart').innerHTML = s;
      $('roOcrAcc').textContent = num(ocr.acc * 100, 0) + '%';
      $('roOcrRight').textContent = ocr.correct + ' / ' + ocr.total;
      $('outErr').textContent = num(ocrState.err, 2);
      $('ocrTip').textContent = '绿色 = 识别正确，红色 = 识别错误。错误率越高，注记文本污染属性表的概率越大，需要人工校对。';
    }

    /* 屏 3 渲染：版面分析 + 矢量追踪 */
    function renderVec() {
      var lay = M.layoutAnalyze(SCAN);
      var vec = M.traceVectors(SCAN, vecState.linkGap);
      var s = '';
      /* 版面区块 */
      for (var r = 0; r < lay.regions.length; r++) {
        var rg = lay.regions[r];
        s += '<rect x="' + (rg.x * SCALE) + '" y="' + (rg.y * SCALE) + '" width="' + (rg.w * SCALE) + '" height="' + (rg.h * SCALE) + '" rx="6" fill="' + rg.fill + '" opacity="0.55"/>';
        s += '<text x="' + (rg.x * SCALE + 4) + '" y="' + (rg.y * SCALE - 4) + '" font-size="11" fill="#79828a" font-weight="600">' + rg.name + '</text>';
      }
      /* 断层矢量追踪结果 */
      for (var v = 0; v < vec.vectors.length; v++) {
        var vt = vec.vectors[v];
        var path = '';
        for (var p = 0; p < vt.pts.length; p++) {
          path += (p ? 'L' : 'M') + (vt.pts[p][0] * SCALE) + ' ' + (vt.pts[p][1] * SCALE);
        }
        s += '<path d="' + path + '" fill="none" stroke="' + vt.color + '" stroke-width="2.4" stroke-linecap="round"/>';
        s += '<text x="' + (vt.pts[0][0] * SCALE + 4) + '" y="' + (vt.pts[0][1] * SCALE - 4) + '" font-size="10" fill="' + vt.color + '" font-weight="600">' + vt.name + '</text>';
      }
      $('vecChart').innerHTML = s;
      $('roVectors').textContent = vec.nVector + ' 条';
      $('roLinked').textContent = vec.linked;
      $('outLinkGap').textContent = vecState.linkGap;
      $('vecTip').textContent = '色块 = 版面分析识别的区块（图区/图例区/注记区），曲线 = 矢量追踪得到的断层线。gap 越大，越能跨断裂连接断开线条。';
    }

    /* 事件绑定 */
    function bind() {
      var inConf = $('pConfTh');
      if (inConf) inConf.addEventListener('input', function () {
        detState.confTh = parseFloat(inConf.value);
        renderDet();
      });
      var inErr = $('pErr');
      if (inErr) inErr.addEventListener('input', function () {
        ocrState.err = parseFloat(inErr.value);
        renderOcr();
      });
      var inGap = $('pLinkGap');
      if (inGap) inGap.addEventListener('input', function () {
        vecState.linkGap = parseInt(inGap.value, 10);
        renderVec();
      });
    }

    /* 抽屉上报 */
    function setupDrawer() {
      if (window.parent === window) return;
      var secs = [];
      [['sec1', '目标检测', 'detCtl'], ['sec2', 'OCR 识别', 'ocrCtl'], ['sec3', '版面分析+追踪', 'vecCtl']].forEach(function (s) {
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
    renderDet(); renderOcr(); renderVec(); bind(); setupDrawer();

    /* 桥接对象：暴露模型层给 flow.js */
    window.RemoteBridge = { M: M, live: function () { return { confTh: detState.confTh, err: ocrState.err, linkGap: vecState.linkGap }; } };
  })();
}
