/* =========================================================
   地震资料噪声压制 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  去噪网络：含噪剖面 → 去噪后干净剖面（切噪声强度/类型）
   屏 2  自监督训练：自监督前 vs 后去噪对比 + 域适配
   屏 3  保真约束与残留验收：信噪比提升 × 保真度 + 残留复核
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

    var NOISE_TYPES = ['面波', '多次波', '工业干扰'];

    /* -----------------------------------------------------
       合成地震剖面
       几层倾斜反射 + 背景。返回 { W, H, data: [row][col] 干净信号 }
       ----------------------------------------------------- */
    function genSection(W, H, seed) {
      var rnd = mulberry32(seed || 20261121);
      var data = [];
      var y, x, i;
      for (y = 0; y < H; y++) {
        data[y] = new Float64Array(W);
        for (x = 0; x < W; x++) data[y][x] = 0;
      }
      /* 若干层反射（倾斜、有振幅） */
      var nL = 4 + Math.floor(rnd() * 3);
      for (i = 0; i < nL; i++) {
        var amp = 0.5 + rnd() * 0.6;
        var slope = (rnd() - 0.5) * 0.06;
        var baseY = 0.2 + rnd() * 0.6;
        var thick = 1 + rnd() * 2;
        for (y = 0; y < H; y++) {
          for (x = 0; x < W; x++) {
            var tgt = (baseY + slope * (x / W)) * H;
            var d = Math.abs(y - tgt);
            if (d < thick) data[y][x] += amp * (1 - d / thick);
          }
        }
      }
      return { W: W, H: H, data: data };
    }

    /* 加噪声：type 面波(大尺度条纹)/多次波(重复回响)/工业干扰(随机尖峰+块状) */
    function addNoise(section, type, level, seed) {
      var rnd = mulberry32(seed || 20261122);
      var W = section.W, H = section.H;
      var noisy = [];
      var y, x, i;
      for (y = 0; y < H; y++) { noisy[y] = new Float64Array(W); for (x = 0; x < W; x++) noisy[y][x] = section.data[y][x]; }
      var scale = 0.2 + level * 0.8;
      if (type === 0) { /* 面波：大尺度条纹 */
        for (y = 0; y < H; y++) {
          var ph = y * 0.12;
          for (x = 0; x < W; x++) noisy[y][x] += scale * 0.6 * Math.sin(x * 0.05 + ph);
        }
      } else if (type === 1) { /* 多次波：重复回响 */
        for (y = 0; y < H; y++) {
          for (x = 0; x < W; x++) {
            for (i = 1; i <= 3; i++) {
              var yb = y - i * 8;
              if (yb >= 0) noisy[y][x] += scale * 0.3 / i * section.data[yb][x];
            }
          }
        }
      } else { /* 工业干扰：随机尖峰 + 块状 */
        for (i = 0; i < 14 * scale; i++) {
          var xx = Math.floor(rnd() * W), yy = Math.floor(rnd() * H);
          noisy[yy][xx] += (rnd() - 0.3) * 0.9;
        }
        var nb = Math.floor(3 * scale);
        for (i = 0; i < nb; i++) {
          var bx = Math.floor(rnd() * (W - 6)), by = Math.floor(rnd() * (H - 6));
          for (y = by; y < by + 6; y++) for (x = bx; x < bx + 6; x++) noisy[y][x] += (rnd() - 0.4) * 0.5;
        }
      }
      /* 背景随机 */
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) noisy[y][x] += (rnd() - 0.5) * 0.2 * scale;
      return { W: W, H: H, data: noisy };
    }

    /* -----------------------------------------------------
       去噪网络（模拟）
       strength ∈ [0,1]：越强越干净，但超过阈值伤有效波。
       返回去噪剖面。
       ----------------------------------------------------- */
    function denoise(noisy, strength, type) {
      var W = noisy.W, H = noisy.H;
      var out = [];
      var y, x, i;
      /* 方向平滑：面波沿 x，其它沿 y */
      var alongX = (type === 0);
      var win = 1 + Math.floor(2 + strength * 4);
      for (y = 0; y < H; y++) {
        out[y] = new Float64Array(W);
        for (x = 0; x < W; x++) {
          var sum = 0, cnt = 0;
          for (i = -win; i <= win; i++) {
            var cx = alongX ? x + i : x;
            var cy = alongX ? y : y + i;
            if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
            sum += noisy.data[cy][cx]; cnt++;
          }
          out[y][x] = sum / cnt;
        }
      }
      /* 过强会抹平细节（伤有效波） */
      if (strength > 0.7) {
        for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
          out[y][x] = out[y][x] * (1 - (strength - 0.7) * 0.6);
        }
      }
      return { W: W, H: H, data: out };
    }

    /* -----------------------------------------------------
       自监督去噪（模拟）
       比裸平滑好：先掩码自监督校正。返回去噪剖面。
       ----------------------------------------------------- */
    function selfSup(noisy, type, domain) {
      var W = noisy.W, H = noisy.H;
      /* 自监督先做一版干净的平滑，再用域适配校正合成-实际差异 */
      var base = denoise(noisy, 0.55 + domain * 0.3, type);
      var out = [];
      var y, x;
      for (y = 0; y < H; y++) {
        out[y] = new Float64Array(W);
        for (x = 0; x < W; x++) {
          out[y][x] = base.data[y][x];
        }
      }
      /* 域适配校正：domain 高 → 在噪声方向再多压一档，且不伤信号 */
      if (domain > 0.6) {
        var alongX = (type === 0);
        var extra = 1;
        for (y = 0; y < H; y++) {
          for (x = 0; x < W; x++) {
            var sum = 0, cnt = 0;
            for (var i = -extra; i <= extra; i++) {
              var cx = alongX ? x + i : x;
              var cy = alongX ? y : y + i;
              if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
              sum += out[y][x] + (out[cy][cx] - out[y][x]) * 0.3;
              cnt++;
            }
            out[y][x] = clamp(out[y][x] + (sum / cnt - out[y][x]) * (domain - 0.6) * 1.2, -1.2, 1.5);
          }
        }
      }
      return { W: W, H: H, data: out };
    }

    /* -----------------------------------------------------
       去噪评估：信噪比提升 + 保真度
       snrGain：含噪 vs 去噪相对干净的信噪比提升
       fidelity：有效波损伤程度（1 = 完全保留）
       ----------------------------------------------------- */
    function preserveEval(clean, noisy, denoised) {
      var W = clean.W, H = clean.H;
      var eNoisy = 0, eDen = 0, eSig = 0;
      var y, x;
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
        var c = clean.data[y][x];
        eSig += c * c;
        eNoisy += (noisy.data[y][x] - c) * (noisy.data[y][x] - c);
        eDen += (denoised.data[y][x] - c) * (denoised.data[y][x] - c);
      }
      var snrNoisy = 10 * Math.log10((eSig + 1e-9) / (eNoisy + 1e-9));
      var snrDen = 10 * Math.log10((eSig + 1e-9) / (eDen + 1e-9));
      /* 保真度：去噪误差越接近噪声误差越说明保留有效波；用能量比衡量 */
      var fidelity = clamp(1 - Math.sqrt(eDen / (eNoisy + 1e-9)), 0, 1);
      return { snrGain: snrDen - snrNoisy, snrDen: snrDen, snrNoisy: snrNoisy, fidelity: fidelity };
    }

    return {
      clamp: clamp, mulberry32: mulberry32, NOISE_TYPES: NOISE_TYPES,
      genSection: genSection, addNoise: addNoise,
      denoise: denoise, selfSup: selfSup, preserveEval: preserveEval
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

  var secW = 60, secH = 40, cell = 6;

  var state = {
    noiseType: 0, level: 0.5, denoiseStr: 0.6,
    selfDomain: 0.6, segA: 0, segB: 1,
    fidelityThr: 0.6, residualThr: 0.7
  };

  /* 基础干净剖面 */
  var clean = M.genSection(secW, secH, 20261121);
  var noisy = M.addNoise(clean, state.noiseType, state.level, 20261122);
  var den = M.denoise(noisy, state.denoiseStr, state.noiseType);

  global.RemoteBridge = {
    M: M,
    genSection: M.genSection, addNoise: M.addNoise,
    denoise: M.denoise, selfSup: M.selfSup, preserveEval: M.preserveEval,
    live: function () {
      return { noiseType: state.noiseType, level: state.level, denoiseStr: state.denoiseStr, selfDomain: state.selfDomain, segA: state.segA, segB: state.segB, fidelityThr: state.fidelityThr, residualThr: state.residualThr };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 1 : d); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* 剖面渲染成 SVG rect 网格 */
  function profileToSVG(grid, x, y, w, h, highlight, thr) {
    var s = '';
    var maxV = 1.3;
    for (var yy = 0; yy < grid.H; yy++) {
      for (var xx = 0; xx < grid.W; xx++) {
        var v = grid.data[yy][xx];
        var a = clamp(Math.abs(v) / maxV, 0, 1);
        var col;
        if (v >= 0) col = 'rgb(' + Math.round(210 - a * 140) + ',' + Math.round(238 - a * 80) + ',' + Math.round(200 - a * 60) + ')';
        else col = 'rgb(' + Math.round(210 - a * 120) + ',' + Math.round(214 - a * 110) + ',' + Math.round(200 - a * 60) + ')';
        s += '<rect x="' + (x + xx * cell) + '" y="' + (y + yy * cell) + '" width="' + cell + '" height="' + cell + '" fill="' + col + '"/>';
      }
    }
    if (highlight === 'noise') {
      /* 标噪声区：对比含噪与干净差异大的位置 */
      var ref = highlight === 'noise' ? null : null;
      for (var yy2 = 0; yy2 < grid.H; yy2++) for (var xx2 = 0; xx2 < grid.W; xx2++) {
        if (Math.abs(grid.data[yy2][xx2]) > (thr || 1.1)) {
          s += '<rect x="' + (x + xx2 * cell) + '" y="' + (y + yy2 * cell) + '" width="' + cell + '" height="' + cell + '" fill="none" stroke="#b05a51" stroke-width="1"/>';
        }
      }
    }
    return s;
  }

  /* 噪音 diff 场 */
  function diffGrid(a, b) {
    var W = a.W, H = a.H;
    var d = [];
    for (var y = 0; y < H; y++) { d[y] = new Float64Array(W); for (var x = 0; x < W; x++) d[y][x] = a.data[y][x] - b.data[y][x]; }
    return { W: W, H: H, data: d };
  }

  /* ---------- 屏 1 渲染：去噪网络 ---------- */
  function renderDenoise() {
    noisy = M.addNoise(clean, state.noiseType, state.level, 20261122);
    den = M.denoise(noisy, state.denoiseStr, state.noiseType);
    var ev = M.preserveEval(clean, noisy, den);
    var W = secW * cell, H = secH * cell;
    $('noisyChart').innerHTML = profileToSVG(noisy, 0, 0, W, H, 'noise', 1.25);
    $('denoisedChart').innerHTML = profileToSVG(den, 0, 0, W, H);
    $('denoiseDiff').innerHTML = profileToSVG(diffGrid(clean, den), 0, 0, W, H);
    $('roSnrGain').textContent = '信噪比提升 ' + num(ev.snrGain, 1) + ' dB';
    $('roFidelity').textContent = '保真度 ' + Math.round(ev.fidelity * 100) + '%';
    $('roNoiseType').textContent = M.NOISE_TYPES[state.noiseType];
  }

  /* ---------- 屏 2 渲染：自监督 ---------- */
  function renderSelfSup() {
    noisy = M.addNoise(clean, state.noiseType, state.level, 20261122);
    var plain = M.denoise(noisy, 0.5, state.noiseType);          /* 裸平滑 */
    var self = M.selfSup(noisy, state.noiseType, state.selfDomain); /* 自监督 + 域适配 */
    var evPlain = M.preserveEval(clean, noisy, plain);
    var evSelf = M.preserveEval(clean, noisy, self);
    var W = secW * cell, H = secH * cell;
    $('plainChart').innerHTML = profileToSVG(plain, 0, 0, W, H);
    $('selfChart').innerHTML = profileToSVG(self, 0, 0, W, H);
    $('selfDiff').innerHTML = profileToSVG(diffGrid(clean, self), 0, 0, W, H);
    $('roPlainSnr').textContent = '裸平滑 ' + num(evPlain.snrGain, 1) + ' dB / 保真 ' + Math.round(evPlain.fidelity * 100) + '%';
    $('roSelfSnr').textContent = '自监督+域适配 ' + num(evSelf.snrGain, 1) + ' dB / 保真 ' + Math.round(evSelf.fidelity * 100) + '%';
  }

  /* ---------- 屏 3 渲染：保真约束与残留验收 ---------- */
  function renderVerify() {
    noisy = M.addNoise(clean, state.noiseType, state.level, 20261122);
    var self = M.selfSup(noisy, state.noiseType, state.selfDomain);
    var ev = M.preserveEval(clean, noisy, self);
    var W = secW * cell, H = secH * cell;
    $('beforeChart').innerHTML = profileToSVG(noisy, 0, 0, W, H);
    $('afterChart').innerHTML = profileToSVG(self, 0, 0, W, H, 'noise', 1.15);
    /* 残留噪声与损伤分区：分段比较（resid 是 secW×secH 网格） */
    var resid = diffGrid(self, clean);
    var segRes = [];
    for (var s = 0; s < 3; s++) {
      var x0 = Math.floor(s * secW / 3), x1 = Math.floor((s + 1) * secW / 3);
      var err = 0, cnt = 0;
      for (var y = 0; y < secH; y++) for (var x = x0; x < x1; x++) { err += Math.abs(resid.data[y][x]); cnt++; }
      segRes.push(err / cnt);
    }
    /* 分类：干净 / 残留噪声 / 信号损伤 */
    var cls = [];
    var cleanG = clean.data, afterG = self.data;
    for (var y2 = 0; y2 < secH; y2++) for (var x2 = 0; x2 < secW; x2++) {
      var r = Math.abs(resid.data[y2][x2]);
      var isSig = Math.abs(cleanG[y2][x2]) > 0.3;
      if (r < state.residualThr) cls.push('ok');
      else if (isSig) cls.push('damage');
      else cls.push('residual');
    }
    var nOk = 0, nRes = 0, nDam = 0;
    cls.forEach(function (c) { if (c === 'ok') nOk++; else if (c === 'residual') nRes++; else nDam++; });
    var pOk = (nOk / cls.length * 100).toFixed(0);
    var pRes = (nRes / cls.length * 100).toFixed(0);
    var pDam = (nDam / cls.length * 100).toFixed(0);
    $('roSeg0').textContent = '段1 残留 ' + segRes[0].toFixed(2);
    $('roSeg1').textContent = '段2 残留 ' + segRes[1].toFixed(2);
    $('roSeg2').textContent = '段3 残留 ' + segRes[2].toFixed(2);
    $('roVerdict').textContent = '信噪比 +' + num(ev.snrGain, 1) + ' dB · 保真 ' + Math.round(ev.fidelity * 100) + '% · 分区 ' + pOk + '% 干净 / ' + pRes + '% 残留 / ' + pDam + '% 损伤';
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    var ins = [
      ['inType', 'outType', 'noiseType', function (v) { return Math.round(v); }],
      ['inLevel', 'outLevel', 'level', null],
      ['inStr', 'outStr', 'denoiseStr', null],
      ['inDomain', 'outDomain', 'selfDomain', null],
      ['inFid', 'outFid', 'fidelityThr', null],
      ['inRes', 'outRes', 'residualThr', null]
    ];
    ins.forEach(function (t) {
      var el = $(t[0]);
      if (!el) return;
      el.addEventListener('input', function () {
        var v = parseFloat(el.value);
        state[t[2]] = t[3] ? t[3](v) : v;
        var out = $(t[1]);
        if (out) out.textContent = t[3] ? String(state[t[2]]) : num(v, 2);
        if (t[2] === 'noiseType' || t[2] === 'level' || t[2] === 'denoiseStr') renderDenoise();
        if (t[2] === 'selfDomain' || t[2] === 'noiseType' || t[2] === 'level') renderSelfSup();
        if (t[2] === 'noiseType' || t[2] === 'level' || t[2] === 'selfDomain' || t[2] === 'residualThr') renderVerify();
      });
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '去噪网络', 'denCtl'], ['sec2', '自监督训练', 'selfCtl'], ['sec3', '保真与验收', 'verCtl']].forEach(function (s) {
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
  renderDenoise(); renderSelfSup(); renderVerify();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
