/* =========================================================
   抽油机井工况诊断 · 算法解剖（CNN 前向全流程动画）
   ---------------------------------------------------------
   把「一张示功图 → 工况判定」拆成 7 步，每一步都跑真代码：

     ① 采集与归一化     载荷/位移同步采样 → min-max 归一
     ② 栅格化           闭合曲线 → 32×32 灰度图（像素逐个点亮）
     ③ 卷积             5×5 核滑窗扫过全图，逐位置算点积
     ④ ReLU             负响应被截断为 0
     ⑤ 池化 + 象限均值  32×32 → 32 维特征
     ⑥ 原型匹配 + softmax  与 5 类原型算距离 → 类别概率
     ⑦ 双闸判定          置信度 ≥0.75 且距离 ≤τ 才采纳

   依赖：window.PumpBridge（demo.js 暴露的真算法）
        window.AFlow（算法解剖引擎）

   性能约定：32×32 的像素图用「按颜色分桶的 path」绘制（每桶一个
   path 元素），静态部分缓存成字符串，逐步显现的部分用 clipPath
   裁剪 —— 这样每帧只需重写几万字符，而不是几万个 DOM 节点。
   ========================================================= */
(function (global) {
  'use strict';

  var B = global.PumpBridge;
  if (!B || !global.AFlow) return;

  var G = global.AFlow.G, C = global.AFlow.C;
  var CLASSES = B.CLASSES, CC = B.CLASS_COLOR, CHC = B.CH_COLOR;
  var SZ = 32;                       /* 图像边长 */
  var KERNELS = B.KERNELS, KNAME = B.KERNEL_NAME;

  /* 三栏面板内的分区（面板头 30—80，正文 88—452） */
  var P0 = { x: 18, w: 272 }, P1 = { x: 312, w: 372 }, P2 = { x: 706, w: 276 };

  /* ---------- 通用工具 ---------- */
  function heat(v) {
    var S = [[0, 16, 22, 32], [0.18, 32, 56, 92], [0.42, 44, 122, 128], [0.7, 198, 143, 56], [1, 250, 234, 200]];
    for (var i = 1; i < S.length; i++) {
      if (v <= S[i][0] || i === S.length - 1) {
        var a = S[i - 1], b = S[i];
        var t = (v - a[0]) / (b[0] - a[0]);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        return [Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t), Math.round(a[3] + (b[3] - a[3]) * t)];
      }
    }
    return [16, 22, 32];
  }
  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t * t * (3 - 2 * t); }
  function l2(v) { var s = 0; for (var i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s); }
  function countNZ(a, thr) {
    var n = 0; for (var i = 0; i < a.length; i++) if (a[i] > (thr == null ? 0.02 : thr)) n++; return n;
  }

  /* 像素图 → 按颜色分桶的 path（每色一个 path 元素，DOM 节点极少） */
  function gridPaths(data, ox, oy, s, mode, norm, skip) {
    var buckets = {}, order = [];
    var m = norm || 1;
    for (var r = 0; r < SZ; r++) {
      for (var c = 0; c < SZ; c++) {
        var v = data[r * SZ + c];
        if (skip != null && v <= skip) continue;
        var col;
        if (mode === 'ink') {
          var g = Math.round(255 * (1 - Math.min(1, v)));
          col = 'rgb(' + g + ',' + g + ',' + g + ')';
        } else if (mode === 'raw') {
          if (v >= 0) col = rgb(heat(Math.pow(clamp(v / m, 0, 1), 0.6)));
          else {
            var a = clamp(-v / m, 0, 1);
            col = 'rgb(' + Math.round(150 + 55 * a) + ',' + Math.round(92 + 38 * a) + ',' + Math.round(122 + 26 * a) + ')';
          }
        } else {
          col = rgb(heat(Math.pow(clamp(v / m, 0, 1), 0.6)));
        }
        if (!buckets[col]) { buckets[col] = []; order.push(col); }
        buckets[col].push('M' + (ox + c * s).toFixed(1) + ' ' + (oy + r * s).toFixed(1) +
          'h' + s.toFixed(1) + 'v' + s.toFixed(1) + 'z');
      }
    }
    var out = '';
    for (var i = 0; i < order.length; i++) {
      out += '<path d="' + buckets[order[i]].join('') + '" fill="' + order[i] + '"/>';
    }
    return out;
  }

  /* 当前工况的完整前向（带缓存） */
  var cache = { key: '' };
  function compute() {
    var p = B.state.p;
    var key = [p.fill, p.gas, p.leak, p.spm, p.S, p.broken ? 1 : 0, p.pound ? 1 : 0, B.state.tau].join(',');
    if (cache.key === key) return cache;
    var pts = B.cardPoints(p, 180);
    var img = B.rasterize(pts, p.S || 3, SZ);
    var raw = B.convRaw(img, SZ, KERNELS);
    var maps = B.convFeatures(img, SZ, KERNELS);
    var f = B.featureVector(maps, SZ);
    var r = B.diag(f, B.state.tau);
    cache = { key: key, pts: pts, img: img, raw: raw, maps: maps, f: f, r: r, p: p };
    return cache;
  }

  /* 曲线 → 面板坐标系点列 */
  function curvePts(c, px, py, pw, ph) {
    var pts = [], S = c.p.S || 3;
    for (var i = 0; i < c.pts.length; i++) {
      pts.push([px + c.pts[i][0] / S * pw, py + ph - c.pts[i][1] / B.Ymax * ph]);
    }
    return pts;
  }

  /* 静态片段缓存（同一工况下不变的部分只算一次） */
  function staticPart(c, name, fn) {
    if (!c._st) c._st = {};
    if (c._st[name] === undefined) c._st[name] = fn();
    return c._st[name];
  }

  /* 面板底部的小结框（统一三栏的收尾样式） */
  function footBox(x, w, y, h, title, lines, tone) {
    var bg = tone === 'jade' ? C.jadeL : tone === 'clay' ? C.clayL : tone === 'blue' ? C.blueL : '#f4f3ef';
    var st = tone === 'jade' ? '#b9d8cb' : tone === 'clay' ? '#e6cdb2' : tone === 'blue' ? '#c5d6ea' : C.line;
    var fg = tone === 'jade' ? C.jadeD : tone === 'clay' ? '#8a4f27' : tone === 'blue' ? '#2b4a72' : C.ink2;
    var s = G.rect(x, y, w, h, { r: 6, fill: bg, stroke: st });
    if (title) s += G.txt(x + 11, y + 17, title, { size: 9.6, fill: fg, weight: 700 });
    for (var i = 0; i < lines.length; i++) {
      s += G.txt(x + 11, y + (title ? 33 : 17) + i * 13, lines[i], { size: 8.8, fill: fg });
    }
    return s;
  }

  /* =========================================================
     ① 采集与归一化
     ========================================================= */
  function stage1(t) {
    var c = compute(), p = c.p;
    var s = '';
    s += G.panel(0, '① 现场采集', '一次冲程 = 载荷—位移闭合曲线', C.jade);
    s += G.panel(1, '② 归一化', '不同井、不同量程 → 同一规格', C.blue);
    s += G.panel(2, '③ 送进网络', '32×32 灰度图，形状信息全在里面', C.clay);

    var px = 40, py = 128, pw = 220, ph = 196;
    s += G.axes(px, py, pw, ph, { nx: 4, ny: 4 });
    s += G.poly(curvePts(c, px, py, pw, ph), { stroke: C.jade, sw: 2, join: 'round' });
    s += G.txt(px, py - 10, '原始量纲：位移 0 → ' + (p.S || 3).toFixed(1) + ' m，载荷 0 → ' + B.Ymax + ' kN', { size: 9, fill: C.ink3 });
    var idx = Math.floor(t * (c.pts.length - 1));
    var sp = c.pts[idx];
    s += G.circle(px + sp[0] / (p.S || 3) * pw, py + ph - sp[1] / B.Ymax * ph, 4.5, { fill: C.clay, stroke: '#fff', sw: 1.6 });
    s += G.txt(px, py + ph + 16, '采样 ' + (idx + 1) + ' / ' + c.pts.length + ' 点', { size: 9, fill: C.clay, mono: true, weight: 700 });
    s += footBox(P0.x + 12, P0.w - 24, 348, 100, '为什么要采样这一圈',
      ['载荷传感器 + 位移传感器同步记录一个冲程。',
       '上下冲程的载荷差，就是井在「出油」还是「没东西可举」。',
       '形状 = 泵况的唯一线索。'], 'jade');

    var nx = 340, ny = 128, nw = 220, nh = 196;
    s += G.axes(nx, ny, nw, nh, { nx: 4, ny: 4 });
    s += G.poly(curvePts(c, nx, ny, nw, nh), { stroke: C.blue, sw: 2, join: 'round' });
    s += G.txt(nx, ny - 10, 'x′=(x−xmin)/(xmax−xmin)，y′ 同理', { size: 9, fill: C.ink3, mono: true });
    s += G.txt(nx, ny + nh + 16, '全部落到 [0,1]，井与井之间才可比', { size: 9, fill: C.ink3 });
    s += G.arrow(298, 226, C.blue, '归一', '');
    s += footBox(P1.x + 12, P1.w - 24, 348, 100, '不归一化会怎样',
      ['A 井载荷 0—90 kN，B 井 0—140 kN。',
       '不归一 → 网络学到的是「量程」和「井号」，不是形状；',
       '换一口井、换一个传感器，模型立刻失效。'], 'blue');

    s += G.txt(726, 100, '32 × 32 灰度图', { size: 10, fill: C.ink2, weight: 700 });
    s += G.rect(726, 112, 160, 160, { r: 3, fill: '#fff', stroke: C.line });
    s += staticPart(c, 'img32', function () { return gridPaths(c.img, 726, 112, 5.0, 'ink', 1, 0.001); });
    s += G.txt(726, 290, '黑 = 曲线扫过的格子', { size: 9, fill: C.ink3 });
    s += footBox(P2.x + 12, P2.w - 24, 310, 138, '这一张图就是网络的全部输入',
      ['后面的卷积核只看这张 32×32 位图，',
       '不再看载荷数值、不看井号、不看时间。',
       '',
       '所以「形状」被保留下来，',
       '而「量纲」被彻底抹掉——这正是',
       '跨井泛化能成立的前提。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '采样点/冲程', v: c.pts.length },
        { k: '网格', v: '32×32' },
        { k: '非零像素', v: countNZ(c.img) + ' / 1024', tone: 'ok' },
        { k: '当前工况', v: B.state.preset || '自定义' }
      ],
      note: '<b>为什么先归一化：</b>不同井的载荷传感器量程、泵径、冲程都不同。若不归一化，网络学到的是「井号」而不是「形状」——换一口井就失效。归一化把一切拉到同一个 [0,1] 区间，模型才只关心曲线的形状。'
    };
  }

  /* =========================================================
     ② 栅格化（像素逐个点亮）
     ========================================================= */
  function stage2(t) {
    var c = compute(), p = c.p;
    var frac = ease(clamp(t * 1.1, 0, 1));
    var step = Math.min(3999, Math.floor(frac * 4000));
    var img = B.rasterize(c.pts, p.S || 3, SZ, frac);
    var s = '';
    s += G.panel(0, '① 曲线', '在「位移—载荷」平面上闭合', C.jade);
    s += G.panel(1, '② 描到格子里', '沿曲线取 4000 点，落到哪格就点亮哪格', C.blue);
    s += G.panel(2, '③ 栅格化结果', '曲线 → 32×32 位图', C.clay);

    var px = 42, py = 132, pw = 210, ph = 190;
    s += G.axes(px, py, pw, ph, { nx: 4, ny: 4 });
    s += G.poly(curvePts(c, px, py, pw, ph), { stroke: C.jade, sw: 1.6, join: 'round', op: 0.9 });
    var st = B.rasterStep(c.pts, p.S || 3, SZ, step, 4000);
    s += G.circle(px + st.x / (p.S || 3) * pw, py + ph - st.y / B.Ymax * ph, 5, { fill: C.clay, stroke: '#fff', sw: 1.8 });
    s += G.txt(px, py - 10, '笔尖沿曲线行进', { size: 9.5, fill: C.clay, weight: 700 });
    s += G.txt(px, py + ph + 16, '步 ' + step + ' / 4000', { size: 9, fill: C.ink3, mono: true });
    s += footBox(P0.x + 12, P0.w - 24, 348, 100, '采样的本质',
      ['把连续曲线离散成 4000 个点，',
       '每个点问一次：「你在哪一格里？」',
       '点在格边界上时，亮度按距离分给邻近格——',
       '所以笔画不是 1 像素宽，而是有粗细和灰度的。'], 'jade');

    var gx = 344, gy = 118, gs = 6.4;
    s += G.rect(gx, gy, SZ * gs, SZ * gs, { r: 3, fill: '#fff', stroke: C.line });
    s += gridPaths(img, gx, gy, gs, 'ink', 1, 0.001);
    var cc = Math.round(st.col), rr = Math.round(st.row);
    if (cc >= 0 && cc < SZ && rr >= 0 && rr < SZ) {
      s += G.rect(gx + cc * gs - 1.5, gy + rr * gs - 1.5, gs + 3, gs + 3, { fill: 'none', stroke: C.clay, sw: 1.6 });
    }
    s += G.txt(gx, gy - 10, '32 × 32 网格', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(gx, gy + SZ * gs + 16, '已点亮 ' + countNZ(img) + ' 格（' + (frac * 100).toFixed(0) + '%）', { size: 9, fill: C.ink3, mono: true });
    s += G.arrow(296, 224, C.blue, '写入格子', '');
    s += footBox(P1.x + 12, P1.w - 24, 348, 100, '分辨率是个权衡',
      ['32×32 太小 → 笔画粘连，气锁和漏失分不开；',
       '太大 → 噪声被放大，且下一层卷积计算量暴涨。',
       '现场常用 64—128，示范取 32 以便逐像素看清。'], 'blue');

    s += G.txt(726, 100, '最终位图', { size: 10, fill: C.ink2, weight: 700 });
    s += G.rect(726, 112, 160, 160, { r: 3, fill: '#fff', stroke: C.line });
    s += staticPart(c, 'img32', function () { return gridPaths(c.img, 726, 112, 5.0, 'ink', 1, 0.001); });
    s += G.txt(726, 290, '非零 ' + countNZ(c.img) + ' 格', { size: 9, fill: C.ink3, mono: true });
    s += footBox(P2.x + 12, P2.w - 24, 310, 138, '位图里的信息',
      ['笔画的位置 → 泵的工作行程到哪；',
       '笔画的粗细 → 载荷有多大；',
       '笔画是否闭合 → 泵有没有有效工作；',
       '上下两段是否对称 → 有没有漏失或气体。',
       '',
       '这些后面都会被卷积核「量」出来。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '栅格化进度', v: (frac * 100).toFixed(0) + '%' },
        { k: '已点亮', v: countNZ(img) + ' 格', tone: 'ok' },
        { k: '总格数', v: '1024' },
        { k: '分辨率', v: '32×32' }
      ],
      note: '<b>这一步在干什么：</b>把连续曲线变成 <b>32×32 的灰度位图</b>。做法很朴素——沿曲线走 4000 步，每步在曲线上取一点，看它落进哪个格子，就给那格加一点亮度（相邻格按距离打折，所以线是有粗细的）。这一步决定了后面所有卷积核能「看到」什么。'
    };
  }

  /* =========================================================
     ③ 卷积（5×5 核滑窗逐位置点积）
     ========================================================= */
  function stage3(t) {
    var c = compute();
    var s = '';
    var CH = 0;                       /* 展示 CH1 竖边检测子 */
    var total = SZ * SZ;
    var pos = Math.min(total - 1, Math.floor(ease(clamp(t, 0, 1)) * total));
    var pr = Math.floor(pos / SZ), pc = pos % SZ;

    s += G.panel(0, '① 输入图', '32×32 灰度，卷积的输入', C.jade);
    s += G.panel(1, '② 5×5 卷积核滑窗', '每停一格做一次 25 项点积', C.blue);
    s += G.panel(2, '③ 响应图', '一个核 → 一张 32×32 响应图', C.clay);

    /* 左：输入图 */
    var gx = 42, gy = 106, gs = 6.7;
    s += G.txt(gx, gy - 8, '输入 32×32', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.rect(gx, gy, SZ * gs, SZ * gs, { r: 3, fill: '#fff', stroke: C.line });
    s += staticPart(c, 'inGrid', function () { return gridPaths(c.img, gx, gy, gs, 'ink', 1, 0.001); });
    s += G.txt(gx, gy + SZ * gs + 15, '深色 = 笔画（载荷高的地方）', { size: 8.8, fill: C.ink3 });
    s += footBox(P0.x + 12, P0.w - 24, 348, 100, '卷积要回答的问题',
      ['「这一小片区域，像不像一条竖笔画？」',
       '不像 → 响应为 0 或负；像 → 响应为正且越大越像。',
       '8 个核同时问，就得到 8 张不同角度的响应图。'], 'jade');

    /* 中：滑窗 + 核 */
    var mx = 324, my = 104, ms = 4.3;
    s += G.txt(mx, my - 8, '核 CH1 · ' + KNAME[CH] + '（训练后固定）', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.rect(mx, my, SZ * ms, SZ * ms, { r: 3, fill: '#fff', stroke: C.line });
    s += staticPart(c, 'slideGrid', function () { return gridPaths(c.img, mx, my, ms, 'ink', 1, 0.001); });
    s += G.rect(mx + (pc - 2) * ms, my + (pr - 2) * ms, 5 * ms, 5 * ms, { fill: 'none', stroke: C.clay, sw: 1.9 });
    s += G.txt(mx, my + SZ * ms + 13, '滑窗（橙框）当前覆盖 5×5', { size: 8.6, fill: C.clay });

    /* 核权重 5×5 */
    var kx = mx + 152, ky = my, kk = KERNELS[CH], kmx = 0, ai;
    for (ai = 0; ai < 25; ai++) kmx = Math.max(kmx, Math.abs(kk[Math.floor(ai / 5)][ai % 5]));
    s += G.txt(kx, ky - 8, '核权重（锁死）', { size: 9.5, fill: C.ink2, weight: 700 });
    for (var kr = 0; kr < 5; kr++) {
      for (var kc = 0; kc < 5; kc++) {
        var w = kk[kr][kc];
        var op = Math.max(0.1, Math.abs(w) / kmx);
        s += G.rect(kx + kc * 11, ky + kr * 11, 10.4, 10.4, {
          fill: w >= 0 ? 'rgba(47,125,107,' + op.toFixed(2) + ')' : 'rgba(178,106,57,' + op.toFixed(2) + ')'
        });
      }
    }
    s += G.txt(kx, ky + 68, '绿=正权 棕=负权', { size: 8.4, fill: C.ink4 });
    s += G.txt(kx, ky + 82, '检测竖笔画', { size: 8.4, fill: C.ink4 });
    s += G.txt(kx, ky + 100, '权重来自训练，', { size: 8.4, fill: C.ink4 });
    s += G.txt(kx, ky + 113, '换工况也不变', { size: 8.4, fill: C.ink4 });

    /* 点积明细 */
    var det = B.convCell(c.img, SZ, KERNELS, CH, pr, pc);
    var dx = 324, dy = 258, dw = 348, dh = 190;
    s += G.rect(dx, dy, dw, dh, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(dx + 10, dy + 17, '当前位置 (' + pr + ',' + pc + ') 的点积明细', { size: 9.8, fill: C.ink, weight: 700 });
    var cell = 11, bx0 = dx + 10, by0 = dy + 28;
    var inner = ease(clamp((t * total - pos) * 3.2, 0, 1));
    var hot = Math.min(24, Math.floor(inner * 25));
    for (var ir = 0; ir < 5; ir++) {
      for (var ic = 0; ic < 5; ic++) {
        var iv = ir * 5 + ic;
        var vv = det.vals[iv];
        s += G.rect(bx0 + ic * cell, by0 + ir * cell, cell - 1, cell - 1, {
          fill: vv > 0.02 ? 'rgba(65,105,155,' + (0.2 + vv * 0.75).toFixed(2) + ')' : '#f2f1ec',
          stroke: iv === hot ? C.clay : 'none', sw: iv === hot ? 1.5 : 0
        });
      }
    }
    s += G.txt(bx0, by0 + 5 * cell + 12, '图像块 5×5', { size: 8.2, fill: C.ink3 });
    var px0 = bx0 + 68;
    s += G.txt(px0, by0 - 3, 'Σ 图像块 × 核', { size: 8.2, fill: C.ink3 });
    var rows = [], q;
    for (q = 0; q < 25; q++) {
      rows.push({ n: q + 1, v: det.vals[q], k: det.kvals[q], p: det.prods[q] });
    }
    var startR = Math.max(0, hot - 5);
    for (var rw = startR; rw < Math.min(25, startR + 7); rw++) {
      var row = rows[rw];
      var yy = by0 + 9 + (rw - startR) * 10.5;
      s += G.txt(px0, yy, row.n + '. ' + G.f(row.v, 2) + '×' + G.f(row.k, 1) + ' = ' + G.f(row.p, 3),
        { size: 8.2, mono: true, fill: row.p >= 0 ? C.ink2 : C.clay, weight: rw === hot ? 700 : 400 });
    }
    s += G.txt(px0 + 116, by0 + 22, 'Σ = ' + G.f(det.sum, 3), { size: 10.5, mono: true, fill: C.ink, weight: 700 });
    s += G.txt(px0 + 116, by0 + 40, 'ReLU = ' + G.f(det.sum > 0 ? det.sum : 0, 3),
      { size: 9.6, mono: true, fill: det.sum > 0 ? C.jadeD : C.red, weight: 700 });
    s += G.txt(px0 + 116, by0 + 57, '写入响应图', { size: 8.4, fill: C.ink4 });

    /* 右：响应图（静态缓存 + clip 逐步显现） */
    var rx = 722, ry = 106, rs = 5.4;
    s += G.txt(rx, ry - 8, 'CH1 响应图（ReLU 前）', { size: 9.5, fill: C.ink2, weight: 700 });
    var resp = staticPart(c, 'respMap', function () {
      var vals = [], i;
      for (i = 0; i < c.raw[CH].length; i++) if (c.raw[CH][i] > 1e-4) vals.push(c.raw[CH][i]);
      vals.sort(function (a, b) { return a - b; });
      var nrm = vals.length ? (vals[Math.floor(vals.length * 0.98)] || vals[vals.length - 1]) : 1;
      return gridPaths(c.raw[CH], rx, ry, rs, 'heat', nrm, 0.02);
    });
    var clipId = 'cpConv';
    s += '<clipPath id="' + clipId + '"><rect x="' + rx + '" y="' + ry + '" width="' + (SZ * rs) + '" height="' + ((pr + 1) * rs) + '"/></clipPath>';
    /* 顺序要紧：先铺深色底 → 再画被裁剪的响应图 → 最后描边框 */
    s += G.rect(rx, ry, SZ * rs, SZ * rs, { r: 3, fill: '#10161f' });
    s += '<g clip-path="url(#' + clipId + ')">' + resp + '</g>';
    s += G.rect(rx, ry, SZ * rs, SZ * rs, { r: 3, fill: 'none', stroke: C.line });
    s += G.rect(rx + pc * rs, ry + pr * rs, rs, rs, { fill: 'none', stroke: C.clay, sw: 1.5 });
    s += G.txt(rx, ry + SZ * rs + 15, '已扫 ' + (pos + 1) + ' / ' + total + ' 位置', { size: 9, fill: C.ink3, mono: true });
    s += footBox(P2.x + 12, P2.w - 24, 310, 138, '怎么读这张图',
      ['深靛 = 该处没响应；青 = 中等；琥珀 = 强。',
       '',
       '亮的地方 = 「这里有一条竖笔画」。',
       '供液不足的图，上冲程那一侧会明显更亮——',
       '因为液体没填满，只有半程有载荷。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '核', v: 'CH1 ' + KNAME[CH] },
        { k: '每次点积', v: '25 项乘法' },
        { k: '扫描位置', v: '(' + pr + ',' + pc + ')' },
        { k: '当前响应', v: G.f(det.sum > 0 ? det.sum : 0, 3), tone: det.sum > 0 ? 'ok' : 'warn' }
      ],
      note: '<b>卷积在做什么：</b>核（一个小 5×5 的「检测子」）在图上逐格滑动，每停一格，就把覆盖的 <b>25 个像素</b>与 <b>25 个权重</b>逐项相乘再相加，得到一个数——这就是「这一点有多像竖笔画」。全部 1024 个位置各算一次，就得到一张 32×32 的<b>响应图</b>。核权重是<b>训练后锁死</b>的：换工况时变的是响应，不是核。'
    };
  }

  /* =========================================================
     ④ ReLU 截断
     ========================================================= */
  function stage4(t) {
    var c = compute();
    var s = '';
    var CH = 0;
    var cut = t >= 0.5;

    s += G.panel(0, '① 卷积输出（ReLU 之前）', '有正有负：负 = 与核方向相反', C.jade);
    s += G.panel(1, '② ReLU 规则', 'max(0, x)：负的一律压成 0', C.blue);
    s += G.panel(2, '③ ReLU 之后', '只剩「有多强」，没有「方向相反」', C.clay);

    var gx = 42, gy = 106, gs = 6.7;
    s += G.txt(gx, gy - 8, 'CH1 原始点积（含负值）', { size: 9.5, fill: C.ink2, weight: 700 });
    var neg = 0, pos = 0, mx = 0, i;
    for (i = 0; i < c.raw[CH].length; i++) {
      var v = c.raw[CH][i];
      if (v < 0) neg++; else if (v > 0) pos++;
      if (Math.abs(v) > mx) mx = Math.abs(v);
    }
    s += G.rect(gx, gy, SZ * gs, SZ * gs, { r: 3, fill: '#fbfaf6', stroke: C.line });
    s += staticPart(c, 'rawGrid', function () { return gridPaths(c.raw[CH], gx, gy, gs, 'raw', mx, 0.01); });
    s += G.txt(gx, gy + SZ * gs + 15, '暖色=正响应　紫红=负响应', { size: 8.8, fill: C.ink3 });
    s += footBox(P0.x + 12, P0.w - 24, 348, 100, '负响应是什么意思',
      ['这一小片区域的笔画方向和核相反，',
       '也就是「不像竖笔画，倒像是横笔画」。',
       '这个信息本身有用，但下一层要的是「强度」。'], 'jade');

    /* 直方图 */
    var hx = 324, hw = 348;
    s += G.rect(hx, 96, hw, 166, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(hx + 10, 114, '点积值分布', { size: 10, fill: C.ink, weight: 700 });
    var bins = 21, hist = new Array(bins), bi;
    for (bi = 0; bi < bins; bi++) hist[bi] = 0;
    for (var k = 0; k < c.raw[CH].length; k++) {
      var vv = c.raw[CH][k];
      var bj = Math.floor((vv / mx + 1) / 2 * bins);
      if (bj < 0) bj = 0; if (bj >= bins) bj = bins - 1;
      hist[bj]++;
    }
    var hmax = Math.max.apply(null, hist) || 1;
    var bw = (hw - 24) / bins, zeroIdx = Math.floor(bins / 2);
    for (var b = 0; b < bins; b++) {
      var bh = hist[b] / hmax * 82;
      var bx2 = hx + 12 + b * bw;
      var isNeg = b < zeroIdx;
      var colr = isNeg ? (cut ? 'rgba(178,106,57,.16)' : 'rgba(122,88,141,.8)') : 'rgba(47,125,107,.72)';
      s += G.rect(bx2, 236 - bh, bw - 1.5, bh, { fill: colr, r: 1 });
    }
    s += G.line(hx + 12 + zeroIdx * bw, 96, hx + 12 + zeroIdx * bw, 240, { stroke: C.red, dash: '3 2', sw: 1.2 });
    s += G.txt(hx + 12 + zeroIdx * bw + 4, 108, 'x = 0', { size: 8.5, fill: C.red, mono: true });
    s += G.txt(hx + 12, 252, '负响应区', { size: 8.5, fill: cut ? C.ink4 : C.purple, weight: cut ? 400 : 700 });
    s += G.txt(hx + hw - 44, 252, '正响应区', { size: 8.5, fill: C.jadeD });

    s += G.rect(324, 274, 348, 74, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(336, 294, 'ReLU(x) = max(0, x)', { size: 12.5, mono: true, fill: '#2b4a72', weight: 700 });
    s += G.txt(336, 314, cut ? '负响应被逐个压到 0 —— 紫色的柱子塌进横轴。' : '先看原始分布：紫色是负响应区（会被压掉），绿色是正响应区（保留）。',
      { size: 9.4, fill: '#4a607d' });
    s += G.txt(336, 336, cut ? '「没有这一笔」和「有这一笔但方向相反」，从此不再区分。' : '没有这一步，后面无论叠多少层都还是线性模型。',
      { size: 9.4, fill: '#4a607d' });
    s += footBox(P1.x + 12, P1.w - 24, 360, 88, '为什么这一步不能省',
      ['没有 ReLU，多层卷积叠起来仍等价于一层线性变换——',
       '模型再深也学不出「非线性形状」。'], 'blue');

    /* 右：截断后 */
    var rx = 722, ry = 106, rs = 5.4;
    s += G.txt(rx, ry - 8, 'ReLU 后（送入下一步）', { size: 9.5, fill: C.ink2, weight: 700 });
    var nz = countNZ(c.maps[CH], 0.01);
    s += G.rect(rx, ry, SZ * rs, SZ * rs, { r: 3, fill: '#10161f', stroke: C.line });
    s += staticPart(c, 'reluGrid', function () { return gridPaths(c.maps[CH], rx, ry, rs, 'heat', mx, 0.01); });
    s += G.txt(rx, ry + SZ * rs + 15, '保留 ' + nz + ' 格，抹掉 ' + neg + ' 格', { size: 9, fill: C.ink3, mono: true });
    s += footBox(P2.x + 12, P2.w - 24, 310, 138, '这一步之后',
      ['响应图从「有正有负」变成纯强度图。',
       '',
       '「这一笔画有多强」被完整保留下来，',
       '而「方向相反」被丢掉——因为下游要的是',
       '强度，不是方向。',
       '',
       '8 个通道各自得到一张这样的强度图。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '正响应格', v: pos, tone: 'ok' },
        { k: '负响应格', v: neg, tone: 'warn' },
        { k: 'ReLU 后保留', v: nz, tone: 'ok' },
        { k: '最大响应', v: G.f(mx, 2) }
      ],
      note: '<b>为什么要 ReLU：</b>卷积输出有正有负——负值意味着「这里的笔画方向和核相反」。但我们只关心「<b>这一笔画有多强</b>」，不需要知道方向。ReLU 把所有负值压成 0，响应图于是变成一张纯粹的<b>强度图</b>。这一层不做非线性，后面无论叠多少层都还是一个线性模型，表达能力会卡死。'
    };
  }

  /* =========================================================
     ⑤ 四象限均值 → 32 维特征
     ========================================================= */
  function stage5(t) {
    var c = compute();
    var s = '';
    var CH = 0;
    var qIdx = Math.min(3, Math.floor(t * 4));
    var qn = ['左上', '右上', '左下', '右下'][qIdx];

    s += G.panel(0, '① 响应图 32×32', '每个通道一张强度图', C.jade);
    s += G.panel(1, '② 四象限取均值', '每张图切 4 块，各求一个均值', C.blue);
    s += G.panel(2, '③ 32 维特征向量', '8 通道 × 4 象限 = 32 个数', C.clay);

    var gx = 42, gy = 106, gs = 6.7;
    s += G.txt(gx, gy - 8, 'CH1 响应图（虚线十字 = 四象限）', { size: 9.5, fill: C.ink2, weight: 700 });
    var mx = 0, i;
    for (i = 0; i < c.maps[CH].length; i++) mx = Math.max(mx, c.maps[CH][i]);
    s += G.rect(gx, gy, SZ * gs, SZ * gs, { r: 3, fill: '#10161f', stroke: C.line });
    s += staticPart(c, 'mapGrid', function () { return gridPaths(c.maps[CH], gx, gy, gs, 'heat', mx, 0.01); });
    var h2 = SZ * gs / 2;
    s += G.line(gx + h2, gy, gx + h2, gy + SZ * gs, { stroke: '#fff', op: 0.42, dash: '3 3' });
    s += G.line(gx, gy + h2, gx + SZ * gs, gy + h2, { stroke: '#fff', op: 0.42, dash: '3 3' });
    var qx = gx + (qIdx % 2) * h2, qy = gy + Math.floor(qIdx / 2) * h2;
    s += G.rect(qx, qy, h2, h2, { fill: 'none', stroke: C.clay, sw: 2.1 });
    s += G.txt(gx, gy + SZ * gs + 15, '正在处理 ' + qn + ' 象限（橙框）', { size: 8.8, fill: C.clay, weight: 700 });
    s += footBox(P0.x + 12, P0.w - 24, 348, 100, '为什么要切象限',
      ['1024 个像素两两比对，既慢又容易记住噪声。',
       '切成 4 块取均值，把「像素在哪」换成',
       '「哪个区域强」——位置细节被压缩，',
       '工况差异被保留。'], 'jade');

    /* 象限均值计算 */
    var mx2 = 324;
    s += G.rect(mx2, 96, 348, 88, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(mx2 + 10, 113, '象限均值怎么算（以 ' + qn + ' 为例）', { size: 9.8, fill: C.ink, weight: 700 });
    var qsum = 0, qc = 0, r3, c4, qi;
    for (r3 = 0; r3 < SZ; r3++) {
      for (c4 = 0; c4 < SZ; c4++) {
        qi = (r3 < 16 ? 0 : 2) + (c4 < 16 ? 0 : 1);
        if (qi !== qIdx) continue;
        qsum += c.maps[CH][r3 * SZ + c4]; qc++;
      }
    }
    var qs = qc ? qsum / qc : 0;
    s += G.txt(mx2 + 10, 132, '该象限共 ' + qc + ' 格，求和 = ' + G.f(qsum, 2), { size: 9.2, mono: true, fill: C.ink2 });
    s += G.txt(mx2 + 10, 149, '均值 = ' + G.f(qsum, 2) + ' ÷ ' + qc + ' = ' + G.f(qs, 4), { size: 9.8, mono: true, fill: C.jadeD, weight: 700 });
    s += G.txt(mx2 + 10, 168, '一个象限 → 一个数，这就是「特征」', { size: 8.8, fill: C.ink3 });

    /* 32 维条形 */
    var f = c.f;
    s += G.rect(mx2, 194, 348, 152, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(mx2 + 10, 211, '8 个通道各切 4 象限 → 32 维', { size: 9.8, fill: C.ink, weight: 700 });
    var fx0 = mx2 + 12, cellW = 8.0, base = 322;
    for (var ch = 0; ch < 8; ch++) {
      for (var qq = 0; qq < 4; qq++) {
        var fv = f[ch * 4 + qq];
        var hgt = Math.min(1, fv / 0.3) * 88;
        s += G.rect(fx0 + (ch * 4 + qq) * cellW, base - hgt, cellW - 1.2, hgt, {
          fill: CHC[ch], op: ch === CH ? 1 : 0.42
        });
      }
    }
    s += G.line(fx0, base, fx0 + 32 * cellW, base, { stroke: C.line, sw: 1 });
    s += G.txt(fx0, base + 12, 'CH1', { size: 8, fill: CHC[0], mono: true });
    s += G.txt(fx0 + 15 * cellW, base + 12, 'CH4', { size: 8, fill: CHC[3], mono: true, anchor: 'middle' });
    s += G.txt(fx0 + 28 * cellW, base + 12, 'CH8', { size: 8, fill: CHC[7], mono: true, anchor: 'end' });
    s += G.txt(mx2 + 12, 340, 'L2 归一化：‖f‖ = ' + G.f(l2(f), 3) + ' → 1', { size: 9, mono: true, fill: C.ink3 });
    s += footBox(P1.x + 12, P1.w - 24, 358, 90, '归一化的作用',
      ['把 32 个数缩到单位长度，之后算距离时，',
       '幅值大小不再干扰「像不像」的判断。'], 'blue');

    /* 右：向量细节 */
    s += G.txt(726, 100, '特征向量 f（32 维）', { size: 10, fill: C.ink2, weight: 700 });
    var fmax = 0;
    for (var fi = 0; fi < 32; fi++) fmax = Math.max(fmax, f[fi]);
    var bx0 = 726, by0 = 112, bw2 = 5.0, bh2 = 118;
    for (var fj = 0; fj < 32; fj++) {
      var hh = Math.max(1.2, f[fj] / fmax * bh2);
      s += G.rect(bx0 + fj * bw2, by0 + bh2 - hh, bw2 - 1, hh, {
        fill: CHC[Math.floor(fj / 4)], op: fj < 4 ? 1 : 0.55
      });
    }
    s += G.line(bx0, by0 + bh2, bx0 + 32 * bw2, by0 + bh2, { stroke: C.line, sw: 1 });
    s += G.txt(bx0, by0 + bh2 + 15, 'CH1 的 4 个象限均值（高亮）', { size: 8.6, fill: C.ink3 });
    for (var fn = 0; fn < 4; fn++) {
      s += G.txt(bx0 + fn * 62, by0 + bh2 + 29, 'q' + (fn + 1) + ' = ' + G.f(f[fn], 4), { size: 8.6, mono: true, fill: C.ink2 });
    }
    s += footBox(P2.x + 12, P2.w - 24, 310, 138, '现在这张图 = 32 个数',
      ['人眼看不出这 32 个数代表什么，',
       '但机器可以用它们做分类。',
       '',
       '供液不足的图，四个象限的值会往一边偏；',
       '杆断脱的图，四个值整体都小；',
       '正常井则比较均衡。',
       '',
       '下一步：与各工况原型比距离。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '响应图', v: '8 × 32×32' },
        { k: '汇聚方式', v: '四象限均值' },
        { k: '特征维度', v: '32 维', tone: 'ok' },
        { k: 'L2 范数', v: G.f(l2(f), 3) }
      ],
      note: '<b>为什么要压成 32 个数：</b>32×32 的图有 1024 个像素，直接拿去比对既慢又容易过拟合。做法是把每张响应图切成 <b>4 个象限各求一个均值</b>——8 通道 × 4 象限 = <b>32 维特征</b>。这一步把「像素在哪」换成「哪个区域强」的粗粒度描述，供液不足、杆断脱这些差异被保留了下来。最后 L2 归一化，让算距离时不被幅值干扰。'
    };
  }

  /* =========================================================
     ⑥ 原型匹配 + softmax
     ========================================================= */
  function stage6(t) {
    var c = compute();
    var s = '';
    var P = B.protos(), r = c.r, f = c.f;

    s += G.panel(0, '① 特征向量', '32 维，当前这张示功图的画像', C.jade);
    s += G.panel(1, '② 与 5 类原型算距离', '每类 6 个原型，取最近的那个', C.blue);
    s += G.panel(2, '③ softmax → 类别概率', '距离转成「像不像」的概率', C.clay);

    var fmax = 0, i;
    for (i = 0; i < 32; i++) fmax = Math.max(fmax, f[i]);
    s += G.txt(40, 100, 'f = [ 当前 32 维 ]', { size: 10, fill: C.ink2, weight: 700 });
    var fx = 40, fy = 110, cw = 6.4, chh = 92;
    for (var j = 0; j < 32; j++) {
      var hh = Math.max(1.5, f[j] / fmax * chh);
      s += G.rect(fx + j * cw, fy + chh - hh, cw - 1.4, hh, { fill: CHC[Math.floor(j / 4)], op: 0.9 });
    }
    s += G.txt(40, 222, '原型库 = 每类 6 个「我见过的形状」', { size: 9.4, fill: C.ink2, weight: 700 });
    var protoMini = staticPart(c, 'protoMini', function () {
      var o = '';
      for (var ci = 0; ci < CLASSES.length; ci++) {
        var cx0 = 40 + (ci % 3) * 80, cy0 = 236 + Math.floor(ci / 3) * 58;
        var pf = P[CLASSES[ci]][0], pfmax = 0, k;
        for (k = 0; k < 32; k++) pfmax = Math.max(pfmax, pf[k]);
        o += G.rect(cx0, cy0, 66, 18, { r: 3, fill: '#fdfdfb', stroke: C.line });
        for (var k2 = 0; k2 < 32; k2++) {
          var hh2 = Math.max(0.8, pf[k2] / pfmax * 14);
          o += G.rect(cx0 + 3 + k2 * 1.9, cy0 + 15 - hh2, 1.5, hh2, { fill: CC[CLASSES[ci]], op: 0.55 });
        }
        o += G.txt(cx0, cy0 + 28, CLASSES[ci], { size: 8.4, fill: CC[CLASSES[ci]], weight: 700 });
      }
      return o;
    });
    s += protoMini;
    s += footBox(P0.x + 12, P0.w - 24, 356, 92, '原型从哪来',
      ['用带标注的历史示功图离线训练得到：',
       '每类取 6 个典型样本，存在库里当「参照物」。',
       '推理时只是拿来比距离，不做反向传播。'], 'jade');

    s += G.txt(324, 100, '距离 = ‖f − 原型‖²（越小越像）', { size: 10, fill: C.ink2, weight: 700 });
    var shown = Math.min(5, Math.floor(t * 5.6) + 1);
    var maxd = Math.max.apply(null, r.dist) || 1;
    var minD = Math.min.apply(null, r.dist);
    for (var ci2 = 0; ci2 < 5; ci2++) {
      var yy = 118 + ci2 * 30;
      var on = ci2 < shown;
      var best = r.dist[ci2] === minD;
      s += G.txt(324, yy + 12, CLASSES[ci2], { size: 10.5, fill: on ? CC[CLASSES[ci2]] : C.ink4, weight: on ? 700 : 400 });
      s += G.rect(392, yy + 2, 176, 14, { r: 3, fill: '#f1f1ee' });
      if (on) {
        s += G.rect(392, yy + 2, Math.max(1.5, r.dist[ci2] / maxd * 176), 14, {
          r: 3, fill: CC[CLASSES[ci2]], op: best ? 0.95 : 0.45
        });
        s += G.txt(574, yy + 13, G.f(r.dist[ci2], 4), { size: 9.5, mono: true, fill: C.ink2 });
      }
      if (best && on) s += G.txt(418, yy + 12, '← 最近', { size: 9, fill: C.jadeD, weight: 700 });
    }
    s += G.rect(324, 276, 348, 86, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    s += G.txt(336, 296, 'p(类) = exp(−d/T) / Σ exp(−d/T)', { size: 11, mono: true, fill: '#2b4a72', weight: 700 });
    s += G.txt(336, 314, 'T = ' + B.T + '（温度）：把距离差放大成概率差', { size: 9.3, fill: '#4a607d' });
    s += G.txt(336, 331, 'd 越小 → 指数越大 → 概率越高', { size: 9.3, fill: '#4a607d' });
    s += G.txt(336, 348, 'T 小 = 更尖锐自信；T 大 = 更平更保守', { size: 8.6, fill: '#5d7089' });
    s += footBox(P1.x + 12, P1.w - 24, 372, 76, '温度 T 的作用',
      ['距离是连续值，概率要归一化到和为 1。', 'T 决定了「差多少才算差得多」。'], 'blue');

    s += G.txt(726, 100, '类别概率', { size: 10, fill: C.ink2, weight: 700 });
    var pw2 = 196;
    var grow = clamp((t - 0.4) * 2.4, 0, 1);
    for (var ci3 = 0; ci3 < 5; ci3++) {
      var yy2 = 118 + ci3 * 30;
      var top = CLASSES[ci3] === r.cls;
      var p = r.probs[ci3] * grow;
      s += G.txt(726, yy2 + 12, CLASSES[ci3], { size: 10.5, fill: top ? CC[CLASSES[ci3]] : C.ink4, weight: top ? 700 : 400 });
      s += G.rect(792, yy2 + 2, pw2, 14, { r: 3, fill: '#f1f1ee' });
      s += G.rect(792, yy2 + 2, Math.max(1, p * pw2), 14, { r: 3, fill: CC[CLASSES[ci3]], op: top ? 0.95 : 0.45 });
      if (grow > 0.98) s += G.txt(794 + p * pw2, yy2 + 13, G.f(r.probs[ci3], 3), { size: 9, mono: true, fill: C.ink2 });
    }
    s += G.rect(726, 276, 256, 46, { r: 6, fill: grow > 0.98 ? C.jadeL : '#f4f3ef', stroke: grow > 0.98 ? '#b9d8cb' : C.line });
    s += G.txt(738, 294, '最高概率类别', { size: 9, fill: C.ink3 });
    s += G.txt(738, 312, grow > 0.98 ? r.cls : '计算中…', { size: 14, fill: grow > 0.98 ? CC[r.cls] : C.ink4, weight: 700 });
    s += footBox(P2.x + 12, P2.w - 24, 336, 112, '概率 ≠ 可靠',
      ['softmax 只告诉你「像哪一类」，',
       '不告诉你「这形状我见没见过」。',
       '',
       '复合故障的形状落在所有原型之外，',
       'softmax 照样可能给出 0.8+ 的高置信度——',
       '所以下一阶段还要加第二道闸。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '原型数', v: '5 类 × 6' },
        { k: '最近原型', v: r.cls, tone: 'ok' },
        { k: '最小距离', v: G.f(r.d1, 4) },
        { k: '置信度', v: G.f(r.conf, 3), tone: r.conf >= B.CONF_REVIEW ? 'ok' : 'warn' }
      ],
      note: '<b>原型匹配在做什么：</b>训练阶段用带标注的历史示功图，为每种工况存下几个「典型长相」（这里每类 6 个）。推理时拿当前这 32 维去和 30 个原型逐一算欧氏距离，取最近的那个。距离经过 softmax（温度 T=' + B.T + '）变成概率：<b>距离差得越大，概率差得越明显</b>。'
    };
  }

  /* =========================================================
     ⑦ 双闸判定
     ========================================================= */
  function stage7(t) {
    var c = compute();
    var s = '';
    var r = c.r, v = B.verdictOf(r, B.state.tau);
    var tau = B.state.tau;

    s += G.panel(0, '① 模型输出', '类别 + 概率 + 到原型的距离', C.jade);
    s += G.panel(1, '② 两道闸', '置信度 ≥ 0.75 且 距离 ≤ τ', C.blue);
    s += G.panel(2, '③ 判定结果', '采纳 or 转人工复核', C.clay);

    s += G.rect(30, 92, 248, 98, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(42, 111, '预测类别', { size: 9.4, fill: C.ink3 });
    s += G.txt(42, 139, r.cls, { size: 21, fill: CC[r.cls], weight: 700 });
    s += G.txt(42, 160, '置信度 ' + G.f(r.conf, 3) + '　距离 ' + G.f(r.d1, 4), { size: 9.6, mono: true, fill: C.ink2 });
    s += G.txt(42, 178, 'T=' + B.T + '，置信阈值 ' + B.CONF_REVIEW + '，τ=' + G.f(tau, 2), { size: 8.4, fill: C.ink4 });

    s += G.txt(30, 212, '到最近原型的距离 d₁', { size: 9.4, fill: C.ink2, weight: 700 });
    s += G.rect(30, 220, 248, 16, { r: 4, fill: '#f1f1ee' });
    s += G.rect(30, 220, Math.min(248, r.d1 / 0.3 * 248), 16, { r: 4, fill: r.ood ? C.red : C.jade });
    var tx = 30 + tau / 0.3 * 248;
    s += G.line(tx, 216, tx, 240, { stroke: C.red, dash: '3 2', sw: 1.4 });
    s += G.txt(tx + 4, 212, 'τ=' + G.f(tau, 2), { size: 8.4, fill: C.red, mono: true });
    s += G.txt(30, 254, G.f(r.d1, 4) + (r.ood ? '  >  τ（出界）' : '  ≤  τ（在界内）'), { size: 9.6, mono: true, fill: r.ood ? C.red : C.jadeD, weight: 700 });

    s += G.txt(30, 284, '各类概率', { size: 9.4, fill: C.ink2, weight: 700 });
    for (var ci = 0; ci < 5; ci++) {
      var yy = 296 + ci * 21;
      var top = CLASSES[ci] === r.cls;
      s += G.txt(30, yy + 12, CLASSES[ci], { size: 9.4, fill: top ? CC[CLASSES[ci]] : C.ink4, weight: top ? 700 : 400 });
      s += G.rect(100, yy + 3, 148, 13, { r: 3, fill: '#f1f1ee' });
      s += G.rect(100, yy + 3, Math.max(1, r.probs[ci] * 148), 13, { r: 3, fill: CC[CLASSES[ci]], op: top ? 0.95 : 0.45 });
      s += G.txt(252, yy + 13, G.f(r.probs[ci], 2), { size: 8.6, mono: true, fill: C.ink3, anchor: 'end' });
    }
    s += footBox(P0.x + 12, P0.w - 24, 408, 40, '',
      ['模型给出的三个数：类别、概率、到原型的距离。'], 'jade');

    var g1 = r.conf >= B.CONF_REVIEW, g2 = !r.ood;
    s += G.txt(324, 100, '工程上不只用一个阈值', { size: 10, fill: C.ink2, weight: 700 });
    s += G.rect(324, 110, 348, 84, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(336, 129, '闸 1 · 置信度', { size: 9.8, fill: C.ink, weight: 700 });
    s += G.txt(336, 146, '置信度 ' + G.f(r.conf, 3) + '  vs  阈值 ' + B.CONF_REVIEW, { size: 9.2, mono: true, fill: C.ink2 });
    s += G.rect(336, 154, 300, 13, { r: 3, fill: '#f1f1ee' });
    s += G.rect(336, 154, Math.min(300, r.conf * 300), 13, { r: 3, fill: g1 ? C.jade : C.red });
    s += G.line(336 + B.CONF_REVIEW * 300, 150, 336 + B.CONF_REVIEW * 300, 170, { stroke: C.ink3, sw: 1.3 });
    s += G.txt(336, 184, g1 ? '✓ 通过：模型「有把握」' : '✕ 未过：概率分散，可能是轻度复合故障', { size: 9.3, fill: g1 ? C.jadeD : C.red, weight: 700 });

    s += G.rect(324, 202, 348, 84, { r: 6, fill: '#fdfdfb', stroke: C.line });
    s += G.txt(336, 221, '闸 2 · 分布外距离（OOD）', { size: 9.8, fill: C.ink, weight: 700 });
    s += G.txt(336, 238, '距离 ' + G.f(r.d1, 4) + '  vs  阈值 τ=' + G.f(tau, 2), { size: 9.2, mono: true, fill: C.ink2 });
    s += G.rect(336, 246, 300, 13, { r: 3, fill: '#f1f1ee' });
    s += G.rect(336, 246, Math.min(300, r.d1 / 0.3 * 300), 13, { r: 3, fill: g2 ? C.jade : C.red });
    s += G.line(336 + tau / 0.3 * 300, 242, 336 + tau / 0.3 * 300, 262, { stroke: C.red, sw: 1.3 });
    s += G.txt(336, 276, g2 ? '✓ 通过：形状在训练覆盖范围内' : '✕ 未过：掉进「没见过的形状」区域', { size: 9.3, fill: g2 ? C.jadeD : C.red, weight: 700 });

    s += G.rect(324, 294, 348, 66, { r: 6, fill: C.clayL, stroke: '#e6cdb2' });
    s += G.txt(336, 312, '为什么两道闸都要', { size: 9.4, fill: '#8a4f27', weight: 700 });
    s += G.txt(336, 329, 'softmax 在没见过的形状上依然会给「高置信」的错答案——', { size: 8.7, fill: '#8a4f27' });
    s += G.txt(336, 344, '只有置信度这一道闸，会把复合故障「自信地」判错。', { size: 8.7, fill: '#8a4f27' });
    s += footBox(P1.x + 12, P1.w - 24, 372, 76, 'τ 是可调的工程旋钮',
      ['τ 越小越保守（更多转人工）；τ 越大越省人力（代价是漏判）。'], 'blue');

    var okAct = v.act === 'ok';
    s += G.rect(720, 92, 248, 148, {
      r: 8, fill: okAct ? C.jadeL : (v.act === 'low' ? C.amberL : C.redL),
      stroke: okAct ? '#b9d8cb' : (v.act === 'low' ? '#e6d4ac' : '#e5c0ba'), sw: 1.4
    });
    s += G.txt(844, 118, okAct ? '✓ 直接采纳' : '⚠ 转人工复核',
      { size: 15, fill: okAct ? C.jadeD : (v.act === 'low' ? '#a87f24' : C.red), weight: 700, anchor: 'middle' });
    s += G.txt(844, 145, okAct ? r.cls : (v.act === 'low' ? '低置信 · 概率分散' : '分布外 · 形状没见过'),
      { size: 12, fill: C.ink2, anchor: 'middle' });
    s += G.txt(844, 171, okAct ? '模型直接出结论，进台账' : '推送波形 + 判定建议给人复核', { size: 9.4, fill: C.ink3, anchor: 'middle' });
    s += G.txt(844, 191, '复核占比（本轮 24 口井 ≈ 12%）', { size: 8.8, fill: C.ink4, anchor: 'middle' });
    s += footBox(P2.x + 12, P2.w - 24, 256, 100, '这就是「智能化 + 人工兜底」',
      ['模型负责 88% 的批量初筛，人只复核那 12% 没把握的。',
       '在 1200 口井的规模上，人力才够用。'], 'jade');
    s += footBox(P2.x + 12, P2.w - 24, 368, 80, '闭环的最后一步',
      ['人工复核的结论回写标签库 → 下个月增量训练 → 模型更准 → 复核更少。'], 'clay');

    return {
      svg: s,
      stats: [
        { k: '判定类别', v: r.cls, tone: 'ok' },
        { k: '置信度', v: G.f(r.conf, 3), tone: g1 ? 'ok' : 'warn' },
        { k: '到原型距离', v: G.f(r.d1, 4), tone: g2 ? 'ok' : 'bad' },
        { k: '最终动作', v: okAct ? '直接采纳' : '转人工', tone: okAct ? 'ok' : 'warn' }
      ],
      note: okAct
        ? '<b>两道闸都过了：</b>模型对这一类既有把握（置信度 ' + G.f(r.conf, 3) + ' ≥ 0.75），形状又落在训练覆盖范围内（距离 ' + G.f(r.d1, 4) + ' ≤ ' + G.f(tau, 2) + '），于是直接出结论进台账。人只去看剩下那十几张没把握的图。'
        : '<b>被拦下了：</b>' + (v.act === 'low'
          ? '形状在覆盖范围内，但类别概率分散（置信度 ' + G.f(r.conf, 3) + ' < 0.75）——很可能是轻度复合故障，模型拿不准，转人工。'
          : '形状掉进了「训练时从没见过的区域」（距离 ' + G.f(r.d1, 4) + ' > ' + G.f(tau, 2) + '）。注意此时 softmax 仍可能给出 0.8+ 的高置信度——<b>这正是只用一个阈值会「自信地判错」的地方</b>。')
    };
  }

  global.PumpFlow = {
    stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4,
    stage5: stage5, stage6: stage6, stage7: stage7, compute: compute
  };
})(typeof window !== 'undefined' ? window : this);
