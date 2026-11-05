/* =========================================================
   AI 三问 · 交互（只服务 01「为什么」卡的曲线对照）
   ---------------------------------------------------------
   同一段数据、同一条劣化曲线，切换「传统做法 / AI 做法」：
   传统只在越过阈值那一刻报警；AI 在曲线还落在正常区间时就
   从「偏离自身基线」的趋势里看出苗头。图上同时给出两处标记、
   提前量与三个指标数字。
   无依赖，data-* 配置，多实例安全。
   ========================================================= */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  function mk(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
    return e;
  }
  function txt(s, x, y, o) {
    var t = mk('text', {
      x: x, y: y,
      'font-size': (o && o.size) || 9.5,
      fill: (o && o.fill) || '#79828a',
      'text-anchor': (o && o.anchor) || 'start',
      'font-family': 'ui-monospace, "SF Mono", Consolas, monospace',
      'font-weight': (o && o.weight) || 400
    });
    t.textContent = s;
    return t;
  }

  /* 曲线：t∈[0,100] → 归一化高度 v∈[0,1]（1=顶部） */
  function valAt(t, shape, onset) {
    var a;
    if (t <= onset) a = 0.295 + 0.095 * (t / Math.max(1, onset));
    else a = 0.39 + 0.55 * Math.pow((t - onset) / (100 - onset), 1.55);
    return shape === 'fall' ? 1 - a : a;
  }

  var W = 420, H = 150, L = 30, R = 10, T = 12, B = 32;
  function xOf(t) { return L + t / 100 * (W - L - R); }
  function yOf(v) { return (H - B) - v * ((H - B) - T); }

  /* 条形对比：同一批井/同一批任务，旧做法与新做法的指标代差 */
  function drawBar(box, mode, cfg) {
    var wrap = box.querySelector('.aiq-fig');
    if (!wrap) return;
    var rows = cfg.rows;
    var W2 = 372, H2 = 150, TOP = 14, RH = 40, LAB = 92, BARX = 92, BARW = 186;
    var svg = mk('svg', { viewBox: '0 0 ' + W2 + ' ' + H2, role: 'img' });
    svg.setAttribute('aria-label', '旧做法与新做法的指标对比');

    var i, r, oldOn = mode === 'old';
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      var y = TOP + i * RH;
      svg.appendChild(txt(r[0], 2, y + 11, { size: 10, fill: '#4d565b' }));
      if (r[4]) svg.appendChild(txt(r[4], 2, y + 24, { size: 8.5, fill: '#9ba3a9' }));

      /* 行首两枚色条：旧 / 新 */
      svg.appendChild(mk('rect', { x: 0, y: y + 5, width: 2, height: 9, fill: '#8a9099', opacity: oldOn ? 0.9 : 0.25 }));
      svg.appendChild(mk('rect', { x: 0, y: y + 20, width: 2, height: 9, fill: '#2f7d6b', opacity: oldOn ? 0.25 : 0.9 }));

      /* 纯文本行（无数字可画条） */
      if (!r[5]) {
        svg.appendChild(txt(r[1], BARX, y + 12, { size: 10, fill: oldOn ? '#4d565b' : '#b3b8bd', weight: oldOn ? 600 : 400 }));
        svg.appendChild(txt(r[2], BARX, y + 27, { size: 10, fill: oldOn ? '#b3b8bd' : '#2f7d6b', weight: oldOn ? 400 : 600 }));
        continue;
      }

      /* 每行按自身量级归一：不同指标量纲不同，跨行比较没有意义 */
      var rmax = Math.max(r[1], r[2]) || 1;
      var wOld = Math.max(2, r[1] / rmax * BARW), wNew = Math.max(2, r[2] / rmax * BARW);
      var unit = r[3] === '%' ? '%' : (r[3] ? ' ' + r[3] : '');

      svg.appendChild(mk('rect', { x: BARX, y: y + 4, width: wOld, height: 9, rx: 2, fill: '#8a9099', opacity: oldOn ? 0.85 : 0.22 }));
      svg.appendChild(txt(fmt(r[1]) + unit, BARX + BARW + 8, y + 12,
        { size: 10, fill: oldOn ? '#4d565b' : '#b3b8bd', weight: oldOn ? 700 : 400 }));

      svg.appendChild(mk('rect', { x: BARX, y: y + 19, width: wNew, height: 9, rx: 2, fill: '#2f7d6b', opacity: oldOn ? 0.22 : 0.88 }));
      svg.appendChild(txt(fmt(r[2]) + unit, BARX + BARW + 8, y + 27,
        { size: 10, fill: oldOn ? '#b3b8bd' : '#2f7d6b', weight: oldOn ? 400 : 700 }));
    }

    /* 图例 */
    svg.appendChild(mk('rect', { x: BARX, y: H2 - 9, width: 8, height: 3, fill: '#8a9099', opacity: 0.85 }));
    svg.appendChild(txt('旧做法', BARX + 12, H2 - 4, { size: 8.5, fill: '#79828a' }));
    svg.appendChild(mk('rect', { x: BARX + 52, y: H2 - 9, width: 8, height: 3, fill: '#2f7d6b', opacity: 0.88 }));
    svg.appendChild(txt('新做法', BARX + 64, H2 - 4, { size: 8.5, fill: '#79828a' }));

    wrap.innerHTML = '';
    wrap.appendChild(svg);
  }
  function fmt(v) {
    var n = Number(v);
    if (!isFinite(n)) return String(v);
    return Math.abs(n) >= 100 ? n.toFixed(0) : (Math.abs(n) >= 10 ? n.toFixed(n % 1 ? 1 : 0) : n.toFixed(n % 1 ? 1 : 0));
  }

  function draw(box, mode, cfg) {
    if (cfg.kind === 'bar') { drawBar(box, mode, cfg); return; }
    var wrap = box.querySelector('.aiq-fig');
    if (!wrap) return;
    var svg = mk('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    svg.setAttribute('aria-label', '传统做法与 AI 做法的检出时机对比');

    /* 网格 */
    for (var g = 1; g <= 3; g++) {
      svg.appendChild(mk('line', {
        x1: L, y1: yOf(0.24 * g), x2: W - R, y2: yOf(0.24 * g),
        stroke: '#f1ede2', 'stroke-width': 1
      }));
    }

    /* 正常区间带 */
    var lo = cfg.bandLo, hi = cfg.bandHi;
    svg.appendChild(mk('rect', {
      x: L, y: yOf(hi), width: W - L - R, height: Math.max(2, yOf(lo) - yOf(hi)),
      fill: '#2f7d6b', opacity: 0.07
    }));
    svg.appendChild(txt('正常区间', W - R - 3, yOf(hi) + 9, { anchor: 'end', size: 8.5, fill: '#9ba3a9' }));

    /* 报警阈值 */
    svg.appendChild(mk('line', {
      x1: L, y1: yOf(cfg.thr), x2: W - R, y2: yOf(cfg.thr),
      stroke: '#b26a39', 'stroke-width': 1.1, 'stroke-dasharray': '4 3', opacity: 0.6
    }));
    svg.appendChild(txt('阈值 θ', W - R - 3, yOf(cfg.thr) - 4, { anchor: 'end', size: 8.5, fill: '#b26a39' }));

    /* 曲线 */
    var d = '', i, v;
    for (i = 0; i <= 100; i++) {
      v = valAt(i, cfg.shape, cfg.onset);
      d += (i ? 'L' : 'M') + xOf(i).toFixed(1) + ' ' + yOf(v).toFixed(1);
    }
    svg.appendChild(mk('path', {
      d: d, fill: 'none', stroke: '#4d565b', 'stroke-width': 1.7,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }));

    /* 劣化起点 */
    svg.appendChild(mk('line', {
      x1: xOf(cfg.onset), y1: yOf(cfg.thr) - 2, x2: xOf(cfg.onset), y2: yOf(0.06),
      stroke: '#cfc9bb', 'stroke-width': 1, 'stroke-dasharray': '2 3'
    }));

    /* 从判定点起，曲线高亮 */
    var from = mode === 'new' ? cfg.newAt : cfg.oldAt;
    var dd = '';
    for (i = Math.round(from); i <= 100; i++) {
      v = valAt(i, cfg.shape, cfg.onset);
      dd += (dd ? 'L' : 'M') + xOf(i).toFixed(1) + ' ' + yOf(v).toFixed(1);
    }
    svg.appendChild(mk('path', {
      d: dd, fill: 'none',
      stroke: mode === 'new' ? '#2f7d6b' : '#b26a39',
      'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }));

    /* 底部时间轴上的「提前量」量尺 */
    var yB = H - 15;
    if (mode === 'new' && cfg.newAt < cfg.oldAt) {
      svg.appendChild(mk('line', {
        x1: xOf(cfg.newAt), y1: yB, x2: xOf(cfg.oldAt), y2: yB,
        stroke: '#2f7d6b', 'stroke-width': 2.4, opacity: 0.3, 'stroke-linecap': 'round'
      }));
      [cfg.newAt, cfg.oldAt].forEach(function (t) {
        svg.appendChild(mk('line', {
          x1: xOf(t), y1: yB - 3.5, x2: xOf(t), y2: yB + 3.5,
          stroke: '#2f7d6b', 'stroke-width': 1.2
        }));
      });
      svg.appendChild(txt('提前 ' + cfg.days + ' 天', (xOf(cfg.newAt) + xOf(cfg.oldAt)) / 2, yB - 5,
        { anchor: 'middle', size: 9, fill: '#2f7d6b', weight: 600 }));
    } else {
      svg.appendChild(mk('line', {
        x1: xOf(cfg.oldAt), y1: yB, x2: W - R, y2: yB,
        stroke: '#b26a39', 'stroke-width': 2.4, opacity: 0.28, 'stroke-linecap': 'round'
      }));
      svg.appendChild(txt('这段没有任何预警', W - R - 3, yB - 5,
        { anchor: 'end', size: 9, fill: '#b26a39', weight: 600 }));
    }

    /* 判定点 */
    var tx = mode === 'new' ? cfg.newAt : cfg.oldAt;
    var px = xOf(tx), py = yOf(valAt(tx, cfg.shape, cfg.onset));
    var col = mode === 'new' ? '#2f7d6b' : '#b26a39';
    svg.appendChild(mk('circle', { cx: px, cy: py, r: 6.5, fill: col, opacity: 0.15 }));
    svg.appendChild(mk('circle', { cx: px, cy: py, r: 3.2, fill: col, stroke: '#fff', 'stroke-width': 1.3 }));

    /* 标签固定在左上角，用细引线指到判定点：两种模式切换时位置不跳，便于对比 */
    var label = mode === 'new' ? '这里就预警' : '越限才发现';
    var tw = label.length * 9 + 11, th = 15;
    var tX = L + 3, tY = T + 1;
    svg.appendChild(mk('line', {
      x1: tX + tw / 2, y1: tY + th, x2: px, y2: py - 5,
      stroke: col, 'stroke-width': 0.8, 'stroke-dasharray': '2 3', opacity: 0.45
    }));
    svg.appendChild(mk('rect', {
      x: tX, y: tY, width: tw, height: th, rx: 3.5,
      fill: '#fffdf7', stroke: col, 'stroke-width': 0.8, 'stroke-opacity': 0.4
    }));
    svg.appendChild(txt(label, tX + 6, tY + 11, { size: 9, fill: col, weight: 600 }));

    /* 轴与单位 */
    svg.appendChild(txt('时间 →', L, H - 3, { size: 8.5, fill: '#9ba3a9' }));
    svg.appendChild(txt(cfg.unit, W - R, T + 2, { anchor: 'end', size: 8.5, fill: '#9ba3a9' }));

    wrap.innerHTML = '';
    wrap.appendChild(svg);
  }

  function init(box) {
    var cfg = {
      shape: box.getAttribute('data-shape') || 'rise',
      unit: box.getAttribute('data-unit') || '',
      onset: parseFloat(box.getAttribute('data-onset')) || 55,
      thr: parseFloat(box.getAttribute('data-thr')) || 0.72,
      oldAt: parseFloat(box.getAttribute('data-old-at')) || 88,
      newAt: parseFloat(box.getAttribute('data-new-at')) || 60,
      days: box.getAttribute('data-days') || '',
      kind: box.getAttribute('data-kind') || 'trend',
      rows: (box.getAttribute('data-rows') || '').split(';').filter(function (x) { return x.trim(); }).map(function (x) {
        var p = x.split('|');
        var num = isFinite(parseFloat(p[1])) && isFinite(parseFloat(p[2]));
        return [p[0] || '', num ? parseFloat(p[1]) : (p[1] || ''), num ? parseFloat(p[2]) : (p[2] || ''), p[3] || '', p[4] || '', num];
      }),
      bandLo: parseFloat(box.getAttribute('data-band-lo')) || 0.26,
      bandHi: parseFloat(box.getAttribute('data-band-hi')) || 0.46
    };
    var btns = box.querySelectorAll('.aiq-switch button');
    var nums = box.querySelectorAll('.aiq-nums b[data-old]');
    var notes = box.querySelectorAll('.aiq-note [data-v]');

    function set(mode) {
      box.setAttribute('data-mode', mode);
      [].forEach.call(btns, function (b) { b.classList.toggle('on', b.getAttribute('data-v') === mode); });
      [].forEach.call(nums, function (n) {
        var v = n.getAttribute('data-' + (mode === 'old' ? 'old' : 'new'));
        if (v != null && v !== '') n.textContent = v;
      });
      [].forEach.call(notes, function (n) { n.hidden = n.getAttribute('data-v') !== mode; });
      draw(box, mode, cfg);
    }

    if (!btns.length) { set('new'); return; }
    [].forEach.call(btns, function (b) {
      b.addEventListener('click', function () { set(b.getAttribute('data-v')); });
    });
    set('old');
  }

  function boot() {
    [].forEach.call(document.querySelectorAll('[data-aiq]'), init);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
