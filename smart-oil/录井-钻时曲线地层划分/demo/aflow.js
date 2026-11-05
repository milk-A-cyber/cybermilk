/* =========================================================
   AFlow · 算法解剖引擎（纯前端，零依赖）
   ---------------------------------------------------------
   用途：把「模型算法从输入走到输出」拆成若干可播放的阶段。
   每个阶段跑的是真实的一段中间计算（不是抽象节点示意），
   引擎负责：阶段轨道 / 播放控制 / 进度 / 实时读数 / 说明文字。

   两种阶段写法
   ------------
   A) SVG 阶段 —— 适合示意图型中间量
      { name, tag, dur,
        draw: function (t, g, ctx) {
          return { svg: '...', stats: [{k,v,tone}], note: '...' };
        } }

   B) DOM 阶段 —— 适合逐像素 / 逐节点的真实计算动画
      { name, tag, dur,
        init: function (host) {          // 只跑一次，构建 DOM
          return {
            update: function (t, ctx) {  // 每帧调用，负责重绘
              return { stats: [...], note: '...' };
            }
          };
        } }

   用法：
     AFlow.create({
       mount: document.getElementById('flowMount'),
       state: {},
       stages: [ ... ]
     });
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------------- 配色（浅色主题，与主站令牌一致） ---------------- */
  var C = {
    ink: '#242b2e', ink2: '#4d565b', ink3: '#79828a', ink4: '#9ba3a9',
    line: '#e9e4d8', line2: '#f0ece1', paper: '#fbfaf6', card: '#ffffff',
    jade: '#2f7d6b', jadeL: '#e6f1ec', jadeD: '#22604f',
    clay: '#b26a39', clayL: '#f8ecdf',
    blue: '#41699b', blueL: '#e7eef9',
    purple: '#7e5a8d', purpleL: '#efe9f4',
    amber: '#c98a2b', amberL: '#faf3e2',
    red: '#b05a51', redL: '#f9e9e5',
    gray: '#79828a', grayL: '#f1f1ee'
  };

  /* 三栏坐标系：输入 → 算法内部 → 输出。画布 1000×520 */
  var COLS = [
    { x: 18, w: 272 },
    { x: 312, w: 372 },
    { x: 706, w: 276 }
  ];
  var TOP = 30, PANEL_H = 440, RAIL_Y = 484;

  /* ---------------- 绘图 helper ---------------- */
  var G = {
    C: C, COLS: COLS, TOP: TOP, PANEL_H: PANEL_H,

    esc: function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
    f: function (v, n) {
      n = (n === undefined) ? 2 : n;
      if (v === null || v === undefined || !isFinite(v)) return '—';
      return Number(v).toFixed(n);
    },
    rect: function (x, y, w, h, o) {
      o = o || {};
      return '<rect x="' + x + '" y="' + y + '" width="' + Math.max(0, w) + '" height="' + Math.max(0, h) +
        '" rx="' + (o.r == null ? 4 : o.r) + '" fill="' + (o.fill || 'none') + '"' +
        (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + (o.sw == null ? 1 : o.sw) + '"' : '') +
        (o.op != null ? ' opacity="' + o.op + '"' : '') +
        (o.dash ? ' stroke-dasharray="' + o.dash + '"' : '') + '/>';
    },
    line: function (x1, y1, x2, y2, o) {
      o = o || {};
      return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
        '" stroke="' + (o.stroke || C.line) + '" stroke-width="' + (o.sw == null ? 1 : o.sw) + '"' +
        (o.op != null ? ' opacity="' + o.op + '"' : '') +
        (o.dash ? ' stroke-dasharray="' + o.dash + '"' : '') +
        (o.cap ? ' stroke-linecap="' + o.cap + '"' : '') + '/>';
    },
    path: function (d, o) {
      o = o || {};
      return '<path d="' + d + '" fill="' + (o.fill || 'none') + '"' +
        (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + (o.sw == null ? 1.5 : o.sw) + '"' : '') +
        (o.op != null ? ' opacity="' + o.op + '"' : '') +
        (o.dash ? ' stroke-dasharray="' + o.dash + '"' : '') +
        (o.cap ? ' stroke-linecap="' + o.cap + '"' : '') +
        (o.join ? ' stroke-linejoin="' + o.join + '"' : '') + '/>';
    },
    txt: function (x, y, s, o) {
      o = o || {};
      var size = o.size == null ? 11 : o.size;
      var fill = o.fill || C.ink2;
      var anchor = o.anchor || 'start';
      var weight = o.weight ? ' font-weight="' + o.weight + '"' : '';
      var fam = o.mono ? ' font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"' : '';
      var extra = (o.op != null ? ' opacity="' + o.op + '"' : '') +
        (o.ls ? ' letter-spacing="' + o.ls + '"' : '');
      return '<text x="' + x + '" y="' + y + '" text-anchor="' + anchor + '" font-size="' + size +
        '" fill="' + fill + '"' + weight + fam + extra + '>' + G.esc(s) + '</text>';
    },
    circle: function (cx, cy, r, o) {
      o = o || {};
      return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + (o.fill || 'none') + '"' +
        (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + (o.sw == null ? 1.2 : o.sw) + '"' : '') +
        (o.op != null ? ' opacity="' + o.op + '"' : '') + '/>';
    },
    poly: function (pts, o) {
      o = o || {};
      var d = '';
      for (var i = 0; i < pts.length; i++) d += (i ? 'L' : 'M') + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1) + ' ';
      return G.path(d + (o.close ? 'Z' : ''), o);
    },
    /* 标准三栏面板：全站统一的「输入 / 算法内部 / 输出」视觉语法 */
    panel: function (ci, title, sub, color, dim) {
      var c = COLS[ci];
      var o = G.rect(c.x, TOP, c.w, PANEL_H, {
        r: 8, fill: '#ffffff', stroke: dim ? '#efece1' : C.line, sw: 1
      });
      o += G.rect(c.x, TOP, c.w, 3, { r: 1.5, fill: color || C.line, op: dim ? 0.32 : 1 });
      o += G.txt(c.x + 13, TOP + 25, title, { size: 12.5, fill: dim ? C.ink3 : C.ink, weight: 700 });
      if (sub) o += G.txt(c.x + 13, TOP + 41, sub, { size: 10, fill: C.ink4 });
      o += G.line(c.x, TOP + 50, c.x + c.w, TOP + 50, { stroke: C.line2 });
      return o;
    },
    /* 栏间箭头：标出「数据流向下一层」 */
    arrow: function (x, y, color, label, sub) {
      var o = G.path('M' + x + ' ' + (y - 5) + 'L' + (x + 11) + ' ' + y + 'L' + x + ' ' + (y + 5) +
        'L' + (x + 3) + ' ' + y + 'Z', { fill: color || C.line });
      if (label) o += G.txt(x - 2, y - 11, label, { size: 9.5, fill: color || C.ink3, anchor: 'middle', weight: 700 });
      if (sub) o += G.txt(x - 2, y + 18, sub, { size: 8.5, fill: C.ink4, anchor: 'middle' });
      return o;
    },
    /* 数据形态缎带：把「输入张量 → 中间张量 → 输出张量」的形状串成一条 */
    shapes: function (list, active) {
      if (!list || !list.length) return '';
      var o = '', x = 18, w = 964;
      var n = list.length, pad = 7;
      var cw = (w - pad * (n - 1)) / n;
      for (var i = 0; i < n; i++) {
        var on = (i === active);
        o += G.rect(x, RAIL_Y, cw, 24, {
          r: 5, fill: on ? C.jadeL : '#ffffff', stroke: on ? C.jade : C.line, sw: on ? 1.3 : 1
        });
        o += G.txt(x + cw / 2, RAIL_Y + 16, list[i], {
          size: 9.5, anchor: 'middle', mono: true,
          fill: on ? C.jadeD : C.ink3, weight: on ? 700 : 400
        });
        if (i < n - 1) o += G.txt(x + cw + pad / 2, RAIL_Y + 16, '→', { size: 10, fill: C.ink4, anchor: 'middle' });
        x += cw + pad;
      }
      return o;
    },
    axes: function (x, y, w, h, o) {
      o = o || {};
      var s = G.rect(x, y, w, h, { r: 4, fill: o.fill || '#fdfdfb', stroke: o.stroke || C.line2 });
      if (o.nx) for (var i = 1; i < o.nx; i++) {
        s += G.line(x + w * i / o.nx, y, x + w * i / o.nx, y + h, { stroke: C.line2, op: 0.7 });
      }
      if (o.ny) for (var j = 1; j < o.ny; j++) {
        s += G.line(x, y + h * j / o.ny, x + w, y + h * j / o.ny, { stroke: C.line2, op: 0.7 });
      }
      return s;
    }
  };

  /* ---------------- 引擎 ---------------- */
  function create(opts) {
    var mount = opts.mount;
    if (!mount) return null;
    var stages = (opts.stages || []).filter(function (s) { return s && (typeof s.draw === 'function' || typeof s.init === 'function'); });
    if (!stages.length) return null;

    var state = opts.state || {};
    var idx = 0, t = 0, playing = opts.autoplay !== false, speed = 1;
    var raf = null, lastTs = 0, dirty = true;
    var domStage = null, domHandle = null;

    mount.innerHTML =
      '<div class="af">' +
      '  <div class="af-top">' +
      '    <div class="af-head">' +
      '      <span class="af-ttl">' + G.esc(opts.title || '算法解剖') + '</span>' +
      '      <span class="af-sub">' + G.esc(opts.subtitle || '自动播放：输入怎么一步步变成输出') + '</span>' +
      '    </div>' +
      '    <div class="af-ctrls">' +
      '      <button type="button" class="af-b" data-a="prev" title="上一步">‹</button>' +
      '      <button type="button" class="af-b af-play" data-a="play" title="播放/暂停">❚❚</button>' +
      '      <button type="button" class="af-b" data-a="next" title="下一步">›</button>' +
      '      <button type="button" class="af-b" data-a="reset" title="重播">↺</button>' +
      '      <select class="af-sp" data-a="speed" title="速度">' +
      '        <option value="0.5">0.5×</option><option value="1" selected>1×</option>' +
      '        <option value="1.5">1.5×</option><option value="2">2×</option>' +
      '      </select>' +
      '    </div>' +
      '  </div>' +
      '  <div class="af-rail"></div>' +
      '  <div class="af-prog"><i></i></div>' +
      '  <div class="af-stage"></div>' +
      '  <div class="af-meta">' +
      '    <div class="af-note"></div>' +
      '    <div class="af-stats"></div>' +
      '  </div>' +
      '  <div class="af-count"></div>' +
      '</div>';

    var $ = function (sel) { return mount.querySelector(sel); };
    var stageEl = $('.af-stage');
    var railEl = $('.af-rail');
    var progEl = $('.af-prog i');
    var noteEl = $('.af-note');
    var statsEl = $('.af-stats');
    var countEl = $('.af-count');
    var playBtn = $('[data-a="play"]');

    /* ---- 阶段轨道 ---- */
    var nodeEls = stages.map(function (s, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'af-node';
      b.innerHTML = '<span class="af-n">' + (i + 1) + '</span>' +
        '<span class="af-nm">' + G.esc(s.name) + '</span>' +
        (s.tag ? '<span class="af-tg">' + G.esc(s.tag) + '</span>' : '');
      b.addEventListener('click', function () { goto(i); });
      railEl.appendChild(b);
      return b;
    });

    function goto(i) {
      var ni = Math.max(0, Math.min(stages.length - 1, i));
      if (ni !== idx) { disposeDom(); }
      idx = ni; t = 0; dirty = true;
      render(true);
    }

    /* 精确跳到某阶段的某个进度（0—1）。测试与「定位某一帧」用。 */
    function seek(i, tt) {
      goto(i);
      t = Math.max(0, Math.min(1, tt == null ? 0 : tt));
      dirty = true;
      render(true);
    }

    function disposeDom() {
      if (domHandle && typeof domHandle.destroy === 'function') {
        try { domHandle.destroy(); } catch (e) { }
      }
      domHandle = null; domStage = null;
    }

    function totalDur() {
      var s = 0;
      for (var i = 0; i < stages.length; i++) s += (stages[i].dur || 2200);
      return s;
    }

    function elapsed() {
      var s = 0;
      for (var i = 0; i < idx; i++) s += (stages[i].dur || 2200);
      return s + t * (stages[idx].dur || 2200);
    }

    function render(force) {
      if (!dirty && !force) return;
      dirty = false;
      var st = stages[idx];
      var res = {};

      try {
        if (typeof st.init === 'function') {
          /* DOM 阶段：init 只在进入该阶段时跑一次 */
          if (domStage !== idx) {
            disposeDom();
            stageEl.innerHTML = '';
            var host = document.createElement('div');
            host.className = 'af-dom';
            stageEl.appendChild(host);
            domHandle = st.init(host) || {};
            domStage = idx;
          }
          res = domHandle.update ? (domHandle.update(t, { index: idx, stage: st, state: state, api: api }) || {}) : {};
        } else {
          res = st.draw(t, G, { index: idx, stage: st, state: state, api: api }) || {};
          stageEl.innerHTML = '<svg viewBox="0 0 1000 520" preserveAspectRatio="xMidYMid meet" role="img">' +
            (res.svg || '') + '</svg>';
        }
      } catch (err) {
        disposeDom();
        stageEl.innerHTML = '<svg viewBox="0 0 1000 520" preserveAspectRatio="xMidYMid meet">' +
          G.panel(1, '这一段出了点问题', String(err && err.message || err), C.red) +
          G.txt(500, 260, '（算法计算中断，其余阶段不受影响）', { size: 11, fill: C.ink3, anchor: 'middle' }) +
          '</svg>';
        res = {
          stats: [],
          note: '<b style="color:' + C.red + '">绘制失败：</b>' + G.esc(String(err && err.message || err))
        };
      }

      /* 统计格 */
      var stats = res.stats || [];
      var h = '';
      for (var i = 0; i < stats.length; i++) {
        var s0 = stats[i];
        h += '<div class="af-stat' + (s0.tone ? ' t-' + s0.tone : '') + '">' +
          '<span class="k">' + G.esc(s0.k) + '</span><b class="v">' + G.esc(s0.v) + '</b></div>';
      }
      statsEl.innerHTML = h;

      noteEl.innerHTML = res.note || '';

      for (var j = 0; j < nodeEls.length; j++) {
        nodeEls[j].className = 'af-node' + (j === idx ? ' on' : (j < idx ? ' done' : ''));
      }
      countEl.textContent = '第 ' + (idx + 1) + ' / ' + stages.length + ' 步 · ' + (st.name || '');

      progEl.style.width = (elapsed() / totalDur() * 100).toFixed(2) + '%';

      playBtn.textContent = playing ? '❚❚' : '▶';
      playBtn.title = playing ? '暂停' : '播放';
    }

    /* ---- 播放循环 ---- */
    function tick(ts) {
      raf = requestAnimationFrame(tick);
      if (!lastTs) lastTs = ts;
      var dt = Math.min(120, ts - lastTs);
      lastTs = ts;
      if (playing) {
        var dur = stages[idx].dur || 2200;
        t += (dt * speed) / dur;
        if (t >= 1) {
          if (idx < stages.length - 1) { disposeDom(); idx++; t = 0; }
          else if (opts.loop !== false) { disposeDom(); idx = 0; t = 0; }
          else { t = 1; playing = false; }
        }
        dirty = true;
      }
      if (dirty) render();
    }

    /* ---- 控制 ---- */
    mount.querySelectorAll('.af-b, .af-sp').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var a = btn.getAttribute('data-a');
        if (a === 'play') { playing = !playing; lastTs = 0; dirty = true; render(); }
        else if (a === 'reset') { disposeDom(); idx = 0; t = 0; playing = true; lastTs = 0; dirty = true; render(); }
        else if (a === 'prev') { if (t > 0.12) { t = 0; } else { goto(idx - 1); } dirty = true; render(); }
        else if (a === 'next') { goto(idx + 1); }
        else if (a === 'speed') { speed = parseFloat(btn.value) || 1; }
      });
    });
    var sp = mount.querySelector('[data-a="speed"]');
    if (sp) sp.addEventListener('change', function () { speed = parseFloat(this.value) || 1; });

    /* ---- 对外 API ---- */
    var api = {
      goto: goto,
      seek: seek,
      restart: function () { disposeDom(); idx = 0; t = 0; playing = true; lastTs = 0; dirty = true; render(); },
      play: function () { playing = true; dirty = true; render(); },
      pause: function () { playing = false; dirty = true; render(); },
      refresh: function () { dirty = true; render(); },
      get index() { return idx; },
      setData: function (k, v) { state[k] = v; dirty = true; },
      getData: function (k) { return state[k]; },
      destroy: function () {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
        disposeDom();
        mount.innerHTML = '';
      }
    };
    if (opts.onReady) opts.onReady(api);

    render(true);
    raf = requestAnimationFrame(tick);
    return api;
  }

  global.AFlow = { create: create, C: C, G: G, COLS: COLS };
})(typeof window !== 'undefined' ? window : this);
