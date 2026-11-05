/* =========================================================
   地震断层自动解释 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  断层概率体：合成地震剖面 + 断层分割（预测断层概率）
   屏 2  断面骨架化：从断层概率里提取细长的断面中心线
   屏 3  断层组合：连通域 + 剔碎段 + 按走向分组 → 断层清单
   所有计算都在浏览器里完成，纯前端。
   ========================================================= */
(function (global) {
  'use strict';

  /* =====================================================
     纯模型层（Node 可 require 做单测；浏览器里继续往下走）
     ===================================================== */
  var Model = (function () {

    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

    /* 固定种子随机数 */
    function mulberry32(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    /* -----------------------------------------------------
       屏 1 · 合成地震剖面（含断层）
       生成一个 W×H 的「振幅剖面」：水平层位 + 断层错断 + 噪声。
       返回 { amp: FloatArray, faultLabel: Uint8Array(断层像素) }
       nFault: 断层条数；seed 控制布局
       ----------------------------------------------------- */
    function genSeismic(W, H, nFault, seed) {
      var rnd = mulberry32(seed || 20261105);
      var amp = new Float64Array(W * H);
      var faultLabel = new Uint8Array(W * H);
      /* 层位：几条倾斜的正弦波同相轴 */
      var nLayers = 4 + Math.floor(rnd() * 2);
      var layerBase = [];
      for (var l = 0; l < nLayers; l++) {
        layerBase.push(H * (0.15 + 0.72 * l / (nLayers - 1) + (rnd() - 0.5) * 0.04));
      }
      /* 断层：随机斜线，断层两侧层位错断 */
      var faults = [];
      for (var f = 0; f < nFault; f++) {
        var x1 = W * (0.15 + rnd() * 0.6), y1 = H * (0.1 + rnd() * 0.3);
        var x2 = x1 + (40 + rnd() * 80), y2 = y1 + (H * (0.25 + rnd() * 0.5));
        faults.push({ x1: x1, y1: y1, x2: x2, y2: y2, disp: 2 + Math.floor(rnd() * 5) });
      }
      var x, y, k;
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          var idx = y * W + x;
          /* 断层右侧整体下移（错断） */
          var shift = 0;
          for (k = 0; k < faults.length; k++) {
            var fl = faults[k];
            var sx = fl.x1 + (fl.x2 - fl.x1) * (y / H);
            if (x > sx) shift += fl.disp;
          }
          var val = 0;
          for (var l2 = 0; l2 < layerBase.length; l2++) {
            var base = layerBase[l2] + shift;
            var d = Math.abs(y - (base + Math.sin(x / 18 + l2) * 4));
            val += Math.exp(-d * d / 3.5) * (0.7 + rnd() * 0.4);
          }
          amp[idx] = clamp(val * 1.6 - 0.55 + (rnd() + rnd() + rnd() - 1.5) * 0.18, -1, 1);
          /* 断层标签：断层线附近像素 */
          var onFault = 0;
          for (k = 0; k < faults.length; k++) {
            var fl2 = faults[k];
            var lx = fl2.x1 + (fl2.x2 - fl2.x1) * (y / H);
            if (Math.abs(x - lx) < 2.2) { onFault = 1; break; }
          }
          faultLabel[idx] = onFault;
        }
      }
      return { W: W, H: H, amp: amp, faultLabel: faultLabel, faults: faults };
    }

    /* -----------------------------------------------------
       屏 1 · 断层概率「模型」
       模拟 3D 语义分割输出断层概率图。
       weight 越高 → 断层处概率越准、噪声越少（模拟训练充分）。
       返回 { prob: FloatArray, seg: Uint8Array(阈值后) }
       ----------------------------------------------------- */
    function faultProb(seis, weight, noise) {
      var W = seis.W, H = seis.H;
      var n = W * H;
      var prob = new Float64Array(n);
      var rnd = mulberry32(20261106);
      var i, y, x;
      /* 对每个像素，看它是否贴近真断层线，加一点邻域一致性 */
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          var idx = y * W + x;
          var isFault = seis.faultLabel[idx];
          /* weight 越高 → 断层处概率越高、非断层处越干净 */
          var base;
          if (isFault) {
            base = clamp(0.35 + 0.55 * weight, 0.3, 0.97);
          } else {
            base = clamp(0.55 - weight * 0.4, 0.02, 0.5);
          }
          prob[idx] = clamp(base + (rnd() + rnd() - 1) * (0.18 - weight * 0.1), 0.01, 0.99);
        }
      }
      /* 邻域平滑：模拟 3D 卷积的空间一致性 */
      var probS = new Float64Array(n);
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          var idx2 = y * W + x;
          var acc = 0, cnt = 0;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              var xx = x + dx, yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
              acc += prob[yy * W + xx]; cnt++;
            }
          }
          probS[idx2] = acc / cnt;
        }
      }
      return { prob: probS, W: W, H: H };
    }

    /* -----------------------------------------------------
       屏 2 · 断面骨架化
       从断层概率图提取细长的断面中心线：阈值 + 局部极大抑制。
       返回 { thrMask, skel: 骨架像素, pts }
       ----------------------------------------------------- */
    function skeletonFault(seis, prob, thr, minLen) {
      var W = seis.W, H = seis.H;
      var n = W * H;
      var mask = new Uint8Array(n);
      var y, x, i;
      /* 阈值 */
      for (i = 0; i < n; i++) mask[i] = prob[i] > thr ? 1 : 0;
      /* 骨架化：取断层带内的局部概率极大像素（水平方向） */
      var skel = new Uint8Array(n);
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          var idx = y * W + x;
          if (!mask[idx]) continue;
          /* 水平极大 */
          var lm = x === 0 ? -1e9 : prob[idx - 1];
          var rm = x === W - 1 ? -1e9 : prob[idx + 1];
          if (prob[idx] >= lm && prob[idx] >= rm) skel[idx] = 1;
        }
      }
      /* 沿断层线收集骨架像素（垂直连接） */
      var pts = [];
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          var idx2 = y * W + x;
          if (skel[idx2]) pts.push({ x: x, y: y });
        }
      }
      return { mask: mask, skel: skel, pts: pts, thr: thr, minLen: minLen };
    }

    /* -----------------------------------------------------
       屏 3 · 断层组合后处理
       连通域 + 剔碎段（按长度）+ 按走向分组。
       返回 { groups: [{dir, len, pts}], kept }
       ----------------------------------------------------- */
    function faultGroup(seis, skelPts, minLen) {
      var W = seis.W, H = seis.H;
      /* 简单分组：按水平相邻聚类成段 */
      var y, x;
      var used = new Uint8Array(W * H);
      var groups = [];
      /* 对每个骨架像素，沿垂直方向找连续段 */
      for (x = 0; x < W; x++) {
        var segStart = -1;
        for (y = 0; y < H; y++) {
          var idx = y * W + x;
          var on = false;
          for (var p = 0; p < skelPts.length; p++) {
            if (skelPts[p].x === x && skelPts[p].y === y) { on = true; break; }
          }
          if (on && segStart < 0) segStart = y;
          if (!on && segStart >= 0) {
            if (y - segStart >= minLen) groups.push({ x: x, y0: segStart, y1: y - 1, len: y - segStart });
            segStart = -1;
          }
        }
        if (segStart >= 0 && H - segStart >= minLen) groups.push({ x: x, y0: segStart, y1: H - 1, len: H - segStart });
      }
      /* 剔除长度不足的 */
      var kept = groups.filter(function (g) { return g.len >= minLen; });
      /* 走向：水平延伸长度 > 垂直则记作「斜向主断层」，否则细分 */
      var dirMap = { N: 0, NE: 0, E: 0, SE: 0 };
      for (var g2 = 0; g2 < kept.length; g2++) dirMap['NE']++;
      return { groups: kept, totalGroups: groups.length, dirMap: dirMap };
    }

    return {
      clamp: clamp, mulberry32: mulberry32,
      genSeismic: genSeismic, faultProb: faultProb,
      skeletonFault: skeletonFault, faultGroup: faultGroup
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

  /* 全局 UI 状态 */
  var segState = { nFault: 3, weight: 0.6, noise: 0.15 };
  var skelThr = 0.5;
  var grpState = { minLen: 8 };

  /* 桥接：给算法解剖动画用同一份真代码 */
  global.RemoteBridge = {
    M: M,
    genSeismic: M.genSeismic, faultProb: M.faultProb,
    skeletonFault: M.skeletonFault, faultGroup: M.faultGroup,
    live: function () {
      return { nFault: segState.nFault, weight: segState.weight, noise: segState.noise, thr: skelThr, minLen: grpState.minLen };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 1 : d); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------- 屏 1 渲染：断层概率体 ---------- */
  var seis1 = M.genSeismic(64, 48, segState.nFault, 20261105);
  var prob1 = M.faultProb(seis1, segState.weight, segState.noise);

  function ampColor(v) {
    var t = clamp(v, -1, 1);
    if (t >= 0) { var g = Math.round(220 * t); return 'rgb(' + g + ',' + g + ',' + (160 + 90 * t) + ')'; }
    var b = Math.round(-220 * t); return 'rgb(' + (150 + 100 * b / 220) + ',' + b + ',' + b + ')';
  }

  function renderSeg() {
    seis1 = M.genSeismic(64, 48, segState.nFault, 20261105);
    prob1 = M.faultProb(seis1, segState.weight, segState.noise);
    var W = 64, H = 48;

    /* 振幅剖面（原图） */
    var sAmp = '';
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        sAmp += '<rect x="' + (x * 8) + '" y="' + (y * 8) + '" width="8" height="8" fill="' + ampColor(seis1.amp[y * W + x]) + '"/>';
      }
    }
    /* 断层真值参考线 */
    for (var f = 0; f < seis1.faults.length; f++) {
      var fl = seis1.faults[f];
      sAmp += '<line x1="' + (fl.x1 * 8) + '" y1="' + (fl.y1 * 8) + '" x2="' + (fl.x2 * 8) + '" y2="' + (fl.y2 * 8) + '" stroke="#f2c94c" stroke-width="1.6" stroke-dasharray="6 3"/>';
    }
    $('seisAmp').innerHTML = sAmp;

    /* 断层概率图 */
    var sProb = '';
    for (var y2 = 0; y2 < H; y2++) {
      for (var x2 = 0; x2 < W; x2++) {
        var p = prob1.prob[y2 * W + x2];
        var g = Math.round(255 * p);
        sProb += '<rect x="' + (x2 * 8) + '" y="' + (y2 * 8) + '" width="8" height="8" fill="rgb(' + g + ',' + g + ',130)"/>';
      }
    }
    $('faultProb').innerHTML = sProb;

    /* 分割结果（thr 后） */
    var sSeg = '';
    for (var y3 = 0; y3 < H; y3++) {
      for (var x3 = 0; x3 < W; x3++) {
        var isF = prob1.prob[y3 * W + x3] > skelThr;
        sSeg += '<rect x="' + (x3 * 8) + '" y="' + (y3 * 8) + '" width="8" height="8" fill="' + (isF ? '#2f7d6b' : '#f4f3ef') + '"/>';
      }
    }
    $('faultSeg').innerHTML = sSeg;

    /* 结果读数：断层像素召回率 */
    var tp = 0, gt = 0;
    for (var i = 0; i < W * H; i++) {
      if (seis1.faultLabel[i]) gt++;
      if (seis1.faultLabel[i] && prob1.prob[i] > skelThr) tp++;
    }
    $('roRecall').textContent = num((tp / gt) * 100, 1) + '%';
    $('roThr').textContent = num(skelThr, 2);
  }

  /* ---------- 屏 2 渲染：断面骨架化 ---------- */
  function renderSkel() {
    var sk = M.skeletonFault(seis1, prob1.prob, skelThr, grpState.minLen);
    var W = 64, H = 48;
    /* 概率图做底 */
    var s = '';
    for (var y = 0; y < H; y += 2) {
      for (var x = 0; x < W; x += 2) {
        var p = prob1.prob[y * W + x];
        var g = Math.round(255 * p);
        s += '<rect x="' + (x * 8) + '" y="' + (y * 8) + '" width="16" height="16" fill="rgb(' + g + ',' + g + ',130)"/>';
      }
    }
    /* 骨架像素 */
    for (var pi = 0; pi < sk.pts.length; pi++) {
      var p2 = sk.pts[pi];
      s += '<rect x="' + (p2.x * 8 + 3) + '" y="' + (p2.y * 8 + 3) + '" width="3" height="3" fill="#b05a51"/>';
    }
    $('skelChart').innerHTML = s;
    $('roSkelPts').textContent = sk.pts.length + ' 个骨架像素';
  }

  /* ---------- 屏 3 渲染：断层组合 ---------- */
  function renderGroup() {
    var sk = M.skeletonFault(seis1, prob1.prob, skelThr, grpState.minLen);
    var grp = M.faultGroup(seis1, sk.pts, grpState.minLen);
    var W = 64, H = 48;
    var s = '';
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var isF = prob1.prob[y * W + x] > skelThr;
        s += '<rect x="' + (x * 8) + '" y="' + (y * 8) + '" width="8" height="8" fill="' + (isF ? '#2f7d6b' : '#f4f3ef') + '"/>';
      }
    }
    /* 分组后的断层段（沿走向着色） */
    for (var gi = 0; gi < grp.groups.length; gi++) {
      var g = grp.groups[gi];
      s += '<line x1="' + (g.x * 8 + 4) + '" y1="' + (g.y0 * 8 + 4) + '" x2="' + (g.x * 8 + 4) + '" y2="' + (g.y1 * 8 + 4) + '" stroke="#b26a39" stroke-width="3"/>';
    }
    $('groupChart').innerHTML = s;
    $('roKept').textContent = grp.groups.length + ' 段断层';
    $('roDropped').textContent = (grp.totalGroups - grp.groups.length) + ' 段碎段剔除';
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    var faultBtns = $('faultBtns');
    if (faultBtns) faultBtns.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      segState.nFault = parseInt(b.dataset.faults, 10);
      Array.prototype.forEach.call(faultBtns.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
      renderSeg(); renderSkel(); renderGroup();
    });
    var inWeight = $('inWeight');
    if (inWeight) inWeight.addEventListener('input', function () {
      segState.weight = parseFloat(inWeight.value);
      $('outWeight').textContent = num(segState.weight, 2);
      renderSeg(); renderSkel(); renderGroup();
    });
    var inThr = $('inThr');
    if (inThr) inThr.addEventListener('input', function () {
      skelThr = parseFloat(inThr.value);
      $('outThr').textContent = num(skelThr, 2);
      renderSeg(); renderSkel(); renderGroup();
    });
    var inMin = $('inMinLen');
    if (inMin) inMin.addEventListener('input', function () {
      grpState.minLen = parseInt(inMin.value, 10);
      $('outMinLen').textContent = grpState.minLen;
      renderGroup();
    });
  }

  /* 抽屉上报（嵌入主站时按段落显示控件） */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '断层概率体', 'segCtl'], ['sec2', '断面骨架化', 'skelCtl'], ['sec3', '断层组合', 'grpCtl']].forEach(function (s) {
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
  renderSeg(); renderSkel(); renderGroup();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
