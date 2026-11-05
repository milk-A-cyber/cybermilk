/* =========================================================
   射孔弹型智能选型 · 模型层 + 浏览器接线
   ---------------------------------------------------------
   纯前端真计算：用知识图谱组织弹型—参数—适用条件关系，
   按井况做规则匹配筛掉不适用的，再按综合得分排序候选弹型。

   Model（模型层）：buildKB / matchBullets / rankBullets
   浏览器接线：window.RemoteBridge = { M, buildKB, matchBullets,
       rankBullets, live, render }
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------- 工具 ---------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---------- 模型层 ---------- */
  var ROCKS = ['砂岩', '灰岩', '页岩'];
  var GRADES = ['J55', 'N80', 'P110'];
  var WALLS = [7, 9, 11];

  /* 射孔弹知识库（型号—参数—适用条件） */
  function buildKB() {
    return {
      bullets: [
        { id: 'B7', name: '深穿透弹', depth: 0.9, dia: 0.45, rocks: ['砂岩', '页岩'], grades: ['N80', 'P110'], wall: [9, 11], fb: 0.86 },
        { id: 'P4', name: '大孔径弹', depth: 0.55, dia: 0.92, rocks: ['灰岩', '砂岩'], grades: ['J55', 'N80'], wall: [7, 9], fb: 0.82 },
        { id: 'S2', name: '聚能射孔弹', depth: 0.7, dia: 0.6, rocks: ['砂岩', '灰岩', '页岩'], grades: ['J55', 'N80', 'P110'], wall: [7, 9, 11], fb: 0.78 },
        { id: 'K8', name: '复合射孔弹', depth: 0.62, dia: 0.7, rocks: ['灰岩'], grades: ['N80', 'P110'], wall: [9, 11], fb: 0.75 },
        { id: 'H3', name: '高孔密弹', depth: 0.5, dia: 0.8, rocks: ['砂岩', '灰岩'], grades: ['J55', 'N80'], wall: [7, 9], fb: 0.7 },
        { id: 'Z1', name: '定向聚能弹', depth: 0.8, dia: 0.5, rocks: ['页岩'], grades: ['N80', 'P110'], wall: [9, 11], fb: 0.72 },
        { id: 'Q6', name: '大药量弹', depth: 0.95, dia: 0.4, rocks: ['砂岩', '页岩'], grades: ['P110'], wall: [11], fb: 0.68 },
        { id: 'F5', name: '抗压射孔弹', depth: 0.58, dia: 0.55, rocks: ['砂岩', '灰岩'], grades: ['J55', 'N80', 'P110'], wall: [9, 11], fb: 0.66 },
        { id: 'T9', name: '射孔取心弹', depth: 0.4, dia: 0.35, rocks: ['灰岩', '页岩'], grades: ['N80'], wall: [7, 9], fb: 0.6 },
        { id: 'N2', name: '常规射孔弹', depth: 0.5, dia: 0.55, rocks: ['砂岩', '灰岩', '页岩'], grades: ['J55', 'N80', 'P110'], wall: [7, 9, 11], fb: 0.55 }
      ]
    };
  }

  /* 井况参数 */
  function makeWell(rock, grade, wall) {
    return { rock: rock, grade: grade, wall: wall };
  }

  /* 规则匹配：筛掉不适用的弹型 */
  function matchBullets(kb, well) {
    return kb.bullets.filter(function (b) {
      /* 完全不适配则筛掉：岩性、钢级、壁厚全不匹配 */
      var rockOK = b.rocks.indexOf(well.rock) >= 0;
      var gradeOK = b.grades.indexOf(well.grade) >= 0;
      var wallOK = b.wall.indexOf(well.wall) >= 0;
      /* 至少岩性或钢级匹配才候选；壁厚单独判 */
      return (rockOK || gradeOK) && wallOK;
    });
  }

  /* 综合得分排序 */
  function rankBullets(kb, well) {
    var cands = matchBullets(kb, well);
    var scored = cands.map(function (b) {
      var rockScore = b.rocks.indexOf(well.rock) >= 0 ? 1 : 0;
      var gradeScore = b.grades.indexOf(well.grade) >= 0 ? 1 : 0;
      var wallScore = b.wall.indexOf(well.wall) >= 0 ? 1 : 0;
      var score = 0.32 * b.depth + 0.18 * b.dia + 0.2 * rockScore + 0.12 * gradeScore + 0.08 * wallScore + 0.1 * b.fb;
      return { id: b.id, name: b.name, depth: b.depth, dia: b.dia, fb: b.fb, rockHit: rockScore, gradeHit: gradeScore, wallHit: wallScore, score: clamp(score, 0, 1) };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return { cands: scored, nCand: scored.length, nAll: kb.bullets.length };
  }

  /* 知识图谱节点（供屏1 渲染） */
  function kgNodes(kb) {
    var nodes = [];
    kb.bullets.forEach(function (b, i) {
      var angle = (i / kb.bullets.length) * Math.PI * 2 - Math.PI / 2;
      nodes.push({ x: Math.cos(angle), y: Math.sin(angle), id: b.id, name: b.name, depth: b.depth, dia: b.dia, fb: b.fb });
    });
    return nodes;
  }

  var M = { buildKB: buildKB, makeWell: makeWell, matchBullets: matchBullets, rankBullets: rankBullets, kgNodes: kgNodes, ROCKS: ROCKS, GRADES: GRADES, WALLS: WALLS };

  /* ---------- 浏览器接线 ---------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = M;
    return;
  }

  var kb = M.buildKB();
  var state = { rock: '砂岩', grade: 'N80', wall: 9 };
  function live() { return { rock: state.rock, grade: state.grade, wall: state.wall }; }

  function get(id) { return document.getElementById(id); }
  function html(el, s) { el.innerHTML = s; }
  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }

  function widthOf() {
    var c = get('kgChart');
    return c ? Math.max(240, c.clientWidth || 360) : 360;
  }

  function renderAll() {
    var W = widthOf(), H = 200, P = 26;
    var x0 = 30, y0 = 26, xw = W - 52, h = H - 50;
    var well = M.makeWell(state.rock, state.grade, state.wall);
    var rank = M.rankBullets(kb, well);

    /* 屏1 射孔弹知识库（知识图谱） */
    var nodes = M.kgNodes(kb);
    var c1 = '';
    c1 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c1 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c1 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">射孔弹知识库 · ' + kb.bullets.length + ' 种弹型</text>';
    var cx = x0 + xw / 2, cy = y0 + h / 2, R = Math.min(xw, h) / 2 - 20;
    /* 中心节点 */
    c1 += '<circle cx="' + cx + '" cy="' + cy + '" r="16" fill="#41699b"/>';
    c1 += '<text x="' + cx + '" y="' + (cy + 3) + '" font-size="8" fill="#fff" text-anchor="middle" font-weight="600">弹型库</text>';
    /* 关系连线 + 节点 */
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var nx = cx + n.x * R, ny = cy + n.y * R;
      c1 += '<line x1="' + cx + '" y1="' + cy + '" x2="' + nx.toFixed(1) + '" y2="' + ny.toFixed(1) + '" stroke="#d9dee4" stroke-width="1"/>';
      c1 += '<circle cx="' + nx.toFixed(1) + '" cy="' + ny.toFixed(1) + '" r="' + (6 + n.depth * 7) + '" fill="#2f7d6b" opacity="0.75"/>';
      c1 += '<text x="' + nx.toFixed(1) + '" y="' + (ny - 10).toFixed(1) + '" font-size="7.5" fill="#4a5257" text-anchor="middle">' + n.id + '</text>';
    }
    c1 += '<text x="' + (x0 + xw) + '" y="' + (y0 + h + 12) + '" font-size="8" fill="#9aa2a8" text-anchor="end">节点大小=穿深 · 弹型—参数关系</text>';
    c1 += '</svg>';
    html(get('kgChart'), c1);
    html(get('roKgN'), kb.bullets.length + ' 种');

    /* 屏2 井况条件 + 规则匹配 */
    var c2 = '';
    c2 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c2 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c2 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">井况规则匹配 · 候选 ' + rank.nCand + ' / ' + rank.nAll + '</text>';
    /* 条件 */
    var conds = [
      ['岩性', state.rock],
      ['套管钢级', state.grade],
      ['壁厚', state.wall + ' mm']
    ];
    for (var ci = 0; ci < conds.length; ci++) {
      var cyy = y0 + ci * 26;
      c2 += '<rect x="' + x0 + '" y="' + cyy + '" width="130" height="20" rx="4" fill="#eef2f6" stroke="#d4dde6"/>';
      c2 += '<text x="' + (x0 + 8) + '" y="' + (cyy + 14) + '" font-size="8.6" fill="#6c747a">' + conds[ci][0] + '</text>';
      c2 += '<text x="' + (x0 + 122) + '" y="' + (cyy + 14) + '" font-size="8.6" fill="#242b2e" text-anchor="end" font-weight="600">' + conds[ci][1] + '</text>';
    }
    /* 命中矩阵：弹型 × 条件 */
    var rowY0 = y0 + 96;
    c2 += '<text x="' + x0 + '" y="' + (rowY0 - 6) + '" font-size="8" fill="#6c747a">候选弹型 · 条件命中（岩性/钢级/壁厚）</text>';
    for (var ri = 0; ri < Math.min(rank.cands.length, 6); ri++) {
      var b = rank.cands[ri];
      var by = rowY0 + ri * 16;
      c2 += '<text x="' + x0 + '" y="' + (by + 9) + '" font-size="8" fill="#242b2e">' + b.name + '</text>';
      var hits = [b.rockHit, b.gradeHit, b.wallHit];
      for (var hi = 0; hi < 3; hi++) {
        c2 += '<circle cx="' + (x0 + 118 + hi * 34) + '" cy="' + by + '" r="5" fill="' + (hits[hi] ? '#2f7d6b' : '#d9d4c8') + '"/>';
      }
      c2 += '<text x="' + (x0 + 118 + 3 * 34 + 4) + '" y="' + (by + 4) + '" font-size="7.5" fill="#9aa2a8">' + f(b.score, 2) + '</text>';
    }
    c2 += '</svg>';
    html(get('matchChart'), c2);
    html(get('roWell'), state.rock + '·' + state.grade + '·' + state.wall + 'mm');
    html(get('roCand'), rank.nCand + '/' + rank.nAll);

    /* 屏3 候选排序推荐 */
    var c3 = '';
    c3 += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    c3 += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    c3 += '<text x="' + P + '" y="16" font-size="11" fill="#242b2e" font-weight="600">候选排序 · 综合得分</text>';
    var rows = rank.cands.slice(0, 7);
    for (var ri2 = 0; ri2 < rows.length; ri2++) {
      var b2 = rows[ri2];
      var ry = y0 + ri2 * 24;
      var isTop = ri2 === 0;
      c3 += '<rect x="' + x0 + '" y="' + ry + '" width="' + xw + '" height="19" rx="4" fill="' + (isTop ? '#eef6f1' : '#f6f6f3') + '" stroke="' + (isTop ? '#b9d8cb' : '#e6e2d8') + '"/>';
      c3 += '<text x="' + (x0 + 8) + '" y="' + (ry + 13) + '" font-size="8.4" fill="' + (isTop ? '#1f5c4a' : '#242b2e') + '" font-weight="' + (isTop ? 700 : 400) + '">' + (ri2 + 1) + '. ' + b2.name + '</text>';
      c3 += '<text x="' + (x0 + xw - 52) + '" y="' + (ry + 13) + '" font-size="8.4" fill="#9aa2a8">穿' + f(b2.depth) + ' 径' + f(b2.dia) + '</text>';
      var sw = b2.score * (xw - 100);
      c3 += '<rect x="' + (x0 + xw - 46) + '" y="' + (ry + 5) + '" width="' + (b2.score * 40) + '" height="9" rx="2" fill="' + (isTop ? '#2f7d6b' : '#a9b8c6') + '"/>';
      c3 += '<text x="' + (x0 + xw - 8) + '" y="' + (ry + 13) + '" font-size="8" fill="#242b2e" text-anchor="end" font-weight="600">' + f(b2.score, 2) + '</text>';
    }
    c3 += '</svg>';
    html(get('rankChart'), c3);
    if (rank.cands.length > 0) {
      html(get('roTop'), rank.cands[0].name + ' (' + rank.cands[0].id + ')');
      html(get('roTopScore'), f(rank.cands[0].score));
    } else {
      html(get('roTop'), '无匹配');
      html(get('roTopScore'), '—');
    }
  }

  function wire() {
    function bind(sel, key) {
      var el = get(sel);
      if (el) el.addEventListener('change', function () {
        state[key] = el.value;
        var out = get('out' + key[0].toUpperCase() + key.slice(1));
        if (out) html(out, el.value + (key === 'wall' ? 'mm' : ''));
        renderAll();
      });
    }
    bind('inRock', 'rock');
    bind('inGrade', 'grade');
    bind('inWall', 'wall');
  }

  function init() {
    wire();
    renderAll();
  }

  global.RemoteBridge = { M: M, buildKB: buildKB, makeWell: makeWell, matchBullets: matchBullets, rankBullets: rankBullets, live: live, render: renderAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(typeof window !== 'undefined' ? window : global);
