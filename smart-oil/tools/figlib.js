/* =========================================================
   案例流程「每步一图」生成库（Node）
   ---------------------------------------------------------
   为每个案例的 workflow.steps[i] 生成一张示意图（fig 字段），
   以及给 firstbreak-pick 的专业背景四段补上图。
   图形一律用 SVG 字符串，样式与主站令牌一致（浅色）。
   ========================================================= */

const C = {
  ink: '#242b2e', ink2: '#4d565b', ink3: '#79828a', ink4: '#9ba3a9',
  line: '#e9e4d8', line2: '#f0ece1', paper: '#fbfaf6', paper2: '#f4f3ef', card: '#fff',
  jade: '#2f7d6b', jadeL: '#e6f1ec', jadeD: '#22604f',
  clay: '#b26a39', clayL: '#f8ecdf',
  blue: '#41699b', blueL: '#e7eef9',
  purple: '#7e5a8d', purpleL: '#efe9f4',
  amber: '#c98a2b', amberL: '#faf3e2',
  red: '#b05a51', redL: '#f9e9e5',
  gray: '#79828a', grayL: '#f1f1ee'
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function rect(x, y, w, h, o) {
  o = o || {};
  return '<rect x="' + x + '" y="' + y + '" width="' + Math.max(0, w) + '" height="' + Math.max(0, h) +
    '" rx="' + (o.r == null ? 4 : o.r) + '" fill="' + (o.fill || 'none') + '"' +
    (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + (o.sw == null ? 1 : o.sw) + '"' : '') +
    (o.op != null ? ' opacity="' + o.op + '"' : '') +
    (o.dash ? ' stroke-dasharray="' + o.dash + '"' : '') + '/>';
}
function line(x1, y1, x2, y2, o) {
  o = o || {};
  return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
    '" stroke="' + (o.stroke || C.line) + '" stroke-width="' + (o.sw == null ? 1 : o.sw) + '"' +
    (o.op != null ? ' opacity="' + o.op + '"' : '') +
    (o.dash ? ' stroke-dasharray="' + o.dash + '"' : '') +
    (o.cap ? ' stroke-linecap="' + o.cap + '"' : '') + '/>';
}
function txt(x, y, s, o) {
  o = o || {};
  return '<text x="' + x + '" y="' + y + '" text-anchor="' + (o.anchor || 'start') + '" font-size="' +
    (o.size == null ? 10 : o.size) + '" fill="' + (o.fill || C.ink2) + '"' +
    (o.weight ? ' font-weight="' + o.weight + '"' : '') +
    (o.mono ? ' font-family="ui-monospace,Menlo,monospace"' : '') +
    (o.op != null ? ' opacity="' + o.op + '"' : '') + '>' + esc(s) + '</text>';
}
function path(d, o) {
  o = o || {};
  return '<path d="' + d + '" fill="' + (o.fill || 'none') + '"' +
    (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + (o.sw == null ? 1.5 : o.sw) + '"' : '') +
    (o.op != null ? ' opacity="' + o.op + '"' : '') +
    (o.dash ? ' stroke-dasharray="' + o.dash + '"' : '') +
    (o.cap ? ' stroke-linecap="' + o.cap + '"' : '') +
    (o.join ? ' stroke-linejoin="' + o.join + '"' : '') + '/>';
}
function circle(cx, cy, r, o) {
  o = o || {};
  return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + (o.fill || 'none') + '"' +
    (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + (o.sw == null ? 1.2 : o.sw) + '"' : '') +
    (o.op != null ? ' opacity="' + o.op + '"' : '') + '/>';
}
function poly(pts, o) {
  o = o || {};
  let d = '';
  for (let i = 0; i < pts.length; i++) d += (i ? 'L' : 'M') + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1) + ' ';
  return path(d + (o.close ? 'Z' : ''), o);
}
function polyOf(arr, x, y, w, h, lo, hi, color, sw, dash) {
  const pts = [];
  for (let i = 0; i < arr.length; i++) {
    pts.push([x + i / (arr.length - 1) * w, y + h - (arr[i] - lo) / ((hi - lo) || 1) * h]);
  }
  return poly(pts, { stroke: color, sw: sw || 1.4, dash: dash, join: 'round' });
}
function axes(x, y, w, h, o) {
  o = o || {};
  let s = rect(x, y, w, h, { r: 4, fill: o.fill || '#fdfdfb', stroke: o.stroke || C.line2 });
  if (o.nx) for (let i = 1; i < o.nx; i++) s += line(x + w * i / o.nx, y, x + w * i / o.nx, y + h, { stroke: C.line2, op: 0.7 });
  if (o.ny) for (let j = 1; j < o.ny; j++) s += line(x, y + h * j / o.ny, x + w, y + h * j / o.ny, { stroke: C.line2, op: 0.7 });
  return s;
}
/* 固定种子随机 */
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
/* 图题 */
function wrap(inner, cap, w, h) {
  return "<svg viewBox=\"0 0 " + (w || 620) + ' ' + (h || 176) +
    "\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" preserveAspectRatio=\"xMidYMid meet\">" +
    inner + '</svg>' +
    (cap ? '<div class="pfigcap"><b>' + esc(cap[0]) + '</b>　' + esc(cap[1]) + '</div>' : '');
}

/* =========================================================
   通用概念图（跨案例复用）
   ========================================================= */

/* ① 闭环图：数据 → 模型 → 决策 → 现场 → 回流 */
function loopDiagram(o) {
  o = o || {};
  const W = 620, H = 176;
  const nodes = o.nodes || ['数据接入', '特征工程', '模型训练', '分级决策', '现场作业'];
  const cols = ['#e6f1ec', '#e7eef9', '#efe9f4', '#f8ecdf', '#faf3e2'];
  const edge = ['#2f7d6b', '#41699b', '#7e5a8d', '#b26a39', '#c98a2b'];
  let s = '';
  const n = nodes.length;
  const bw = 104, gap = (W - 40 - n * bw) / (n - 1);
  for (let i = 0; i < n; i++) {
    const x = 20 + i * (bw + gap);
    s += rect(x, 46, bw, 52, { r: 8, fill: cols[i % 5], stroke: edge[i % 5], sw: 1.1, op: 0.95 });
    s += txt(x + bw / 2, 70, nodes[i], { size: 11, fill: C.ink, anchor: 'middle', weight: 600 });
    s += txt(x + bw / 2, 86, (o.sub && o.sub[i]) || '', { size: 9, fill: C.ink3, anchor: 'middle' });
    if (i < n - 1) {
      const ax = x + bw + 4, aw = gap - 8;
      s += path('M' + ax + ' ' + (72 - 4) + 'L' + (ax + aw) + ' 72L' + (ax + aw - 4) + ' 68M' + (ax + aw) + ' 72L' + (ax + aw - 4) + ' 76',
        { stroke: C.ink4, sw: 1.2, fill: 'none', cap: 'round' });
    }
  }
  /* 回流箭头 */
  const x1 = 20 + (n - 1) * (bw + gap) + bw / 2;
  const x2 = 20 + bw / 2;
  s += path('M' + x1 + ' 100 L' + x1 + ' 132 L' + x2 + ' 132 L' + x2 + ' 102',
    { stroke: C.jade, sw: 1.4, fill: 'none', dash: '5 3' });
  s += path('M' + x2 + ' 100l-4 6l8 0Z', { fill: C.jade });
  s += txt((x1 + x2) / 2, 146, o.back || '作业结论回写标签库 → 下月增量训练 → 模型更准 → 人工负担更轻',
    { size: 10, fill: C.jadeD, anchor: 'middle', weight: 600 });
  s += txt(20, 24, o.title || '闭环：每一步的产出都是下一步的输入', { size: 10.5, fill: C.ink2, weight: 600 });
  if (o.foot) s += txt(20, 164, o.foot, { size: 9, fill: C.ink4 });
  return wrap(s, o.cap, W, H);
}

/* ② 两种方法并排对比 */
function twoMethodDiagram(o) {
  const W = 620, H = 176;
  let s = '';
  const px = 20, pw = 280, py = 40, ph = 96;
  s += txt(px, 26, o.leftTitle, { size: 10.5, fill: o.leftColor || C.ink2, weight: 600 });
  s += txt(px + pw + 40, 26, o.rightTitle, { size: 10.5, fill: o.rightColor || C.ink2, weight: 600 });
  s += axes(px, py, pw, ph, { nx: 4, ny: 4 });
  s += axes(px + pw + 40, py, pw, ph, { nx: 4, ny: 4 });
  const loL = o.loL != null ? o.loL : o.lo, hiL = o.hiL != null ? o.hiL : o.hi;
  const loR = o.loR != null ? o.loR : o.lo, hiR = o.hiR != null ? o.hiR : o.hi;
  s += polyOf(o.leftData, px, py, pw, ph, loL, hiL, o.leftColor || C.ink3, 1.6, o.leftDash);
  s += polyOf(o.rightData, px + pw + 40, py, pw, ph, loR, hiR, o.rightColor || C.clay, 1.8);
  /* 阈值线 */
  if (o.thr != null) {
    const ty = py + ph - (o.thr - loL) / ((hiL - loL) || 1) * ph;
    s += line(px, ty, px + pw, ty, { stroke: C.red, dash: '4 3', sw: 1.1 });
    s += txt(px + pw + 4, ty - 4, '阈值 ' + o.thr, { size: 8.5, fill: C.red });
  }
  if (o.thrR != null) {
    const ty2 = py + ph - (o.thrR - loR) / ((hiR - loR) || 1) * ph;
    s += line(px + pw + 40, ty2, px + pw + 80 + pw, ty2, { stroke: C.red, dash: '4 3', sw: 1.1 });
    s += txt(px + pw + 44, ty2 - 4, '阈值 ' + o.thrR, { size: 8.5, fill: C.red });
  }
  /* 标记 */
  (o.leftMark || []).forEach(m => {
    const mx = px + m[0] / (o.leftLen - 1) * pw;
    s += line(mx, py, mx, py + ph, { stroke: m[2] || C.clay, sw: 1.3 });
    s += txt(mx + 3, py + 10, m[1], { size: 8.5, fill: m[2] || C.clay, weight: 600 });
  });
  (o.rightMark || []).forEach(m => {
    const mx = px + pw + 40 + m[0] / (o.rightLen - 1) * pw;
    s += line(mx, py, mx, py + ph, { stroke: m[2] || C.jade, sw: 1.3 });
    s += txt(mx + 3, py + 10, m[1], { size: 8.5, fill: m[2] || C.jade, weight: 600 });
  });
  s += txt(px, py + ph + 18, o.leftNote || '', { size: 9, fill: C.ink3 });
  s += txt(px + pw + 40, py + ph + 18, o.rightNote || '', { size: 9, fill: C.ink3 });
  if (o.bottom) {
    s += rect(20, 152, 580, 20, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
    s += txt(30, 166, o.bottom, { size: 9.5, fill: C.jadeD, weight: 600 });
  }
  return wrap(s, o.cap, W, H);
}

/* ③ 两道闸 / 分流 */
function gateDiagram(o) {
  const W = 620, H = 176;
  let s = '';
  const gy = 44, gh = 88;
  /* 闸 1 */
  s += txt(20, 30, o.g1Title, { size: 10.5, fill: C.ink2, weight: 600 });
  s += rect(20, gy, 270, gh, { r: 7, fill: '#fdfdfb', stroke: C.line });
  s += txt(32, gy + 20, o.g1Sub, { size: 9.5, fill: C.ink3 });
  s += rect(32, gy + 30, 246, 14, { r: 3, fill: '#f1f1ee' });
  s += rect(32, gy + 30, 246 * clamp(o.g1Val, 0, 1), 14, { r: 3, fill: o.g1Pass ? C.jade : C.red });
  const t1x = 32 + 246 * clamp(o.g1Thr, 0, 1);
  s += line(t1x, gy + 26, t1x, gy + 48, { stroke: C.ink3, sw: 1.2 });
  s += txt(32, gy + 64, o.g1Pass ? '✓ 通过' : '✕ 拦下', { size: 9.5, fill: o.g1Pass ? C.jadeD : C.red, weight: 700 });
  s += txt(278, gy + 64, '实际 ' + o.g1Text, { size: 9.5, mono: true, fill: C.ink2, anchor: 'end' });
  /* 闸 2 */
  s += txt(330, 30, o.g2Title, { size: 10.5, fill: C.ink2, weight: 600 });
  s += rect(330, gy, 270, gh, { r: 7, fill: '#fdfdfb', stroke: C.line });
  s += txt(342, gy + 20, o.g2Sub, { size: 9.5, fill: C.ink3 });
  s += rect(342, gy + 30, 246, 14, { r: 3, fill: '#f1f1ee' });
  s += rect(342, gy + 30, 246 * clamp(o.g2Val, 0, 1), 14, { r: 3, fill: o.g2Pass ? C.jade : C.red });
  const t2x = 342 + 246 * clamp(o.g2Thr, 0, 1);
  s += line(t2x, gy + 26, t2x, gy + 48, { stroke: C.red, sw: 1.2 });
  s += txt(342, gy + 64, o.g2Pass ? '✓ 通过' : '✕ 拦下', { size: 9.5, fill: o.g2Pass ? C.jadeD : C.red, weight: 700 });
  s += txt(588, gy + 64, '实际 ' + o.g2Text, { size: 9.5, mono: true, fill: C.ink2, anchor: 'end' });
  /* 输出 */
  const ok = o.g1Pass && o.g2Pass;
  s += path('M155 ' + (gy + gh) + 'L155 144', { stroke: C.ink4, sw: 1.2, fill: 'none' });
  s += path('M465 ' + (gy + gh) + 'L465 144', { stroke: C.ink4, sw: 1.2, fill: 'none' });
  s += rect(20, 144, 580, 26, { r: 6, fill: ok ? C.jadeL : C.redL, stroke: ok ? '#b9d8cb' : '#e5c0ba' });
  s += txt(310, 161, ok ? '✓ 两道闸都过 → 直接出结论进台账，人不用看' : '✕ 被拦下 → 推送给人工复核（带上波形与判定建议）',
    { size: 10.5, fill: ok ? C.jadeD : C.red, anchor: 'middle', weight: 700 });
  return wrap(s, o.cap, W, H);
}

/* ④ 数据流：多源 → 特征 → 模型 → 产物 */
function pipelineDiagram(o) {
  const W = 620, H = 176;
  let s = '';
  const stages = o.stages || [];
  const bw = o.bw || 106, gap = (W - 40 - stages.length * bw) / Math.max(1, stages.length - 1);
  for (let i = 0; i < stages.length; i++) {
    const x = 20 + i * (bw + gap);
    s += rect(x, 52, bw, 46, { r: 7, fill: (o.cols && o.cols[i]) || C.jadeL, stroke: (o.edges && o.edges[i]) || C.jade, sw: 1 });
    s += txt(x + bw / 2, 72, stages[i][0], { size: 10.5, fill: C.ink, anchor: 'middle', weight: 600 });
    s += txt(x + bw / 2, 87, stages[i][1] || '', { size: 8.6, fill: C.ink3, anchor: 'middle' });
    if (i < stages.length - 1) {
      const ax = x + bw + 3, aw = gap - 6;
      s += path('M' + ax + ' 70L' + (ax + aw) + ' 70', { stroke: C.ink4, sw: 1.2, fill: 'none' });
      s += path('M' + (ax + aw) + ' 70l-4 -4l0 8Z', { fill: C.ink4 });
    }
  }
  if (o.note) {
    s += txt(20, 122, o.note, { size: 9.6, fill: C.ink2 });
  }
  (o.extra || []).forEach((ln, i) => {
    s += txt(20, 140 + i * 15, ln[0], { size: 9.2, fill: ln[2] || C.ink3, weight: ln[3] ? 600 : 400 });
    s += txt(150, 140 + i * 15, ln[1], { size: 9.2, mono: true, fill: C.ink2 });
  });
  return wrap(s, o.cap, W, H);
}

/* ⑤ 二维散点 + 分级边界 */
function scatter2dDiagram(o) {
  const W = 620, H = 176;
  let s = '';
  const px = 20, py = 40, pw = 200, ph = 120;
  s += txt(px, 28, o.leftTitle, { size: 10.5, fill: C.ink2, weight: 600 });
  s += axes(px, py, pw, ph, { nx: 4, ny: 4 });
  if (o.bands) {
    o.bands.forEach(b => {
      s += path('M' + (px + b[0] * pw) + ' ' + (py + ph) + 'L' + (px + b[1] * pw) + ' ' + (py + ph - b[2] * ph) +
        'L' + (px + b[1] * pw) + ' ' + py + 'Z', { fill: b[3] || C.jadeL, op: 0.55 });
    });
  }
  (o.points || []).forEach(p => {
    s += circle(px + p[0] * pw, py + ph - p[1] * ph, p[3] || 3.6, { fill: p[2], op: p[4] || 0.85 });
  });
  s += txt(px + pw, py + ph + 15, o.xLabel, { size: 8.8, fill: C.ink3, anchor: 'end' });
  s += txt(px - 4, py + 8, o.yLabel, { size: 8.8, fill: C.ink3, anchor: 'end' });
  /* 右侧说明 */
  const rx = 250;
  s += txt(rx, 28, o.rightTitle, { size: 10.5, fill: C.ink2, weight: 600 });
  (o.rows || []).forEach((r, i) => {
    const yy = 50 + i * 26;
    s += rect(rx, yy - 14, 350, 22, { r: 4, fill: r[3] || '#fdfdfb', stroke: r[4] || C.line });
    s += txt(rx + 10, yy, r[0], { size: 9.4, fill: r[2] || C.ink2, weight: r[5] ? 600 : 400 });
    s += txt(rx + 340, yy, r[1], { size: 9.6, mono: true, fill: r[2] || C.ink2, anchor: 'end', weight: 600 });
  });
  if (o.bottom) {
    s += rect(rx, 50 + (o.rows || []).length * 26 + 6, 350, 22, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
    s += txt(rx + 10, 50 + (o.rows || []).length * 26 + 21, o.bottom, { size: 9.5, fill: C.jadeD, weight: 600 });
  }
  return wrap(s, o.cap, W, H);
}

/* ⑥ 时间轴 / 协议示意（滚动原点等） */
function timelineDiagram(o) {
  const W = 620, H = 176;
  let s = '';
  const px = 20, pw = 580, py = 46, ph = 74;
  const N = o.total || 720;
  s += txt(px, 28, o.title, { size: 10.5, fill: C.ink2, weight: 600 });
  (o.bands || []).forEach(b => {
    const x0 = px + b[0] / N * pw, x1 = px + b[1] / N * pw;
    s += rect(x0, py, x1 - x0, ph, { fill: b[3] || C.jadeL, op: b[5] == null ? 0.8 : b[5] });
    s += line(x0, py, x0, py + ph, { stroke: b[4] || C.jade, sw: 1.2 });
    if (b[2]) s += txt(x0 + 5, py + 14, b[2], { size: 8.8, fill: b[4] || C.jadeD, weight: 600 });
  });
  if (o.marks) {
    o.marks.forEach(m => {
      const mx = px + m[0] / N * pw;
      s += line(mx, py - 8, mx, py + ph + 8, { stroke: m[2] || C.clay, sw: 1.3, dash: m[3] || null });
      s += txt(mx + 3, py - 10, m[1], { size: 8.6, fill: m[2] || C.clay, weight: 600 });
    });
  }
  s += line(px, py + ph + 16, px + pw, py + ph + 16, { stroke: C.line, sw: 1 });
  s += txt(px, py + ph + 30, '0 天', { size: 8.6, fill: C.ink4 });
  s += txt(px + pw, py + ph + 30, N + ' 天', { size: 8.6, fill: C.ink4, anchor: 'end' });
  (o.notes || []).forEach((ln, i) => {
    s += txt(px, py + ph + 48 + i * 15, ln[0], { size: 9.4, fill: ln[2] || C.ink2, weight: ln[3] ? 600 : 400 });
    s += txt(200, py + ph + 48 + i * 15, ln[1], { size: 9.4, fill: C.ink2 });
  });
  return wrap(s, o.cap, W, H);
}

module.exports = {
  C, esc, rect, line, txt, path, circle, poly, polyOf, axes, rng, wrap, clamp,
  loopDiagram, twoMethodDiagram, gateDiagram, pipelineDiagram, scatter2dDiagram, timelineDiagram
};
