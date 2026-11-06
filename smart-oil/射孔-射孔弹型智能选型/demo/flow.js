/* =========================================================
   射孔弹型智能选型 · 算法解剖（知识图谱 + 规则匹配 + 排序）
   ---------------------------------------------------------
   把「弹型选型」拆成 6 步，每一步都跑真代码：

     ① 知识库  弹型—参数—适用条件
     ② 井况接入  岩性/钢级/壁厚
     ③ 规则匹配  筛掉不适用
     ④ 综合得分  穿深/孔径/命中/反馈
     ⑤ 排序  候选弹型
     ⑥ 推荐选型  首推弹型

   依赖：window.RemoteBridge（demo.js 暴露的真模型）
        window.AFlow（算法解剖引擎）
   ========================================================= */
(function (global) {
  'use strict';

  var B = global.RemoteBridge;
  if (!B || !global.AFlow) return;

  var G = global.AFlow.G, C = global.AFlow.C;
  var M = B.M;

  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }

  var C0 = '#41699b', C1 = '#b26a39', C2 = '#2f7d6b', CR = '#b05a51';

  function footBox(x, w2, y, h, title, lines, tone) {
    var bg = tone === 'jade' ? C.jadeL : tone === 'clay' ? C.clayL : tone === 'blue' ? C.blueL : '#f4f3ef';
    var st = tone === 'jade' ? '#b9d8cb' : tone === 'clay' ? '#e6cdb2' : tone === 'blue' ? '#c5d6ea' : C.line;
    var fg = tone === 'jade' ? C.jadeD : tone === 'clay' ? '#8a4f27' : tone === 'blue' ? '#2b4a72' : C.ink2;
    var s = G.rect(x, y, w2, h, { r: 6, fill: bg, stroke: st });
    if (title) s += G.txt(x + 11, y + 17, title, { size: 9.6, fill: fg, weight: 700 });
    for (var i = 0; i < lines.length; i++) {
      s += G.txt(x + 11, y + (title ? 33 : 17) + i * 13, lines[i], { size: 8.8, fill: fg });
    }
    return s;
  }

  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.rock, L.grade, L.wall].join(',');
    if (cache.key === key) return cache;
    var kb = M.buildKB();
    var well = M.makeWell(L.rock, L.grade, L.wall);
    var rank = M.rankBullets(kb, well);
    cache = { key: key, kb: kb, well: well, rank: rank };
    return cache;
  }

  /* =========================================================
     ① 知识库
     ========================================================= */
  function stage1(t) {
    var c = compute(), kb = c.kb;
    var s = '';
    s += G.panel(0, '① 弹型', kb.bullets.length + ' 种', C.blue);
    s += G.panel(1, '② 参数', '穿深/孔径', C.clay);
    s += G.panel(2, '③ 适用', '岩性/钢级', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14;
    s += G.txt(x0, y0 - 22, '弹型知识库', { size: 9.5, fill: C.ink2, weight: 700 });
    for (var i = 0; i < Math.min(kb.bullets.length, 7); i++) {
      var b = kb.bullets[i];
      var ry = y0 + i * 15;
      s += G.txt(x0, ry, b.id + ' ' + b.name, { size: 8.4, fill: C.ink2 });
      s += G.txt(x0 + 150, ry, '穿' + f(b.depth) + ' 径' + f(b.dia), { size: 8, fill: C.ink3 });
    }

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '手册的坑',
      ['· 人工查手册',
       '  → 慢',
       '· 型号更新',
       '  → 手册滞后',
       '',
       '知识图谱',
       '结构化。'], 'clay');
    return { svg: s, stats: [{ k: '弹型', v: kb.bullets.length + ' 种' }, { k: '组织', v: '知识图谱' }], note: '用知识图谱组织弹型—参数—适用条件关系。选型表靠人工查手册，型号更新后手册滞后，需要结构化组织。' };
  }

  /* =========================================================
     ② 井况接入
     ========================================================= */
  function stage2(t) {
    var c = compute(), well = c.well;
    var s = '';
    s += G.panel(0, '① 岩性', well.rock, C.blue);
    s += G.panel(1, '② 钢级', well.grade, C.clay);
    s += G.panel(2, '③ 壁厚', well.wall + 'mm', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14;
    s += G.txt(x0, y0 - 22, '井况接入', { size: 9.5, fill: C.ink2, weight: 700 });
    var rows = [
      ['岩性', well.rock],
      ['套管钢级', well.grade],
      ['壁厚', well.wall + ' mm']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 30;
      s += G.rect(x0, ry, 240, 24, { r: 5, fill: C.blueL, stroke: '#c5d6ea' });
      s += G.txt(x0 + 12, ry + 17, rows[r][0], { size: 8.8, fill: C.ink2 });
      s += G.txt(x0 + 190, ry + 17, rows[r][1], { size: 8.8, fill: '#2b4a72', weight: 700 });
    }
    s += G.txt(x0, y0 + h + 10, '无需标注，直接输入', { size: 8.4, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '井况的坑',
      ['· 井井不同',
       '  → 需匹配',
       '· 岩性/钢级',
       '  → 决定弹型',
       '',
       '规则匹配',
       '筛不适用。'], 'jade');
    return { svg: s, stats: [{ k: '岩性', v: well.rock }, { k: '钢级', v: well.grade }], note: '读入井况参数（岩性、套管钢级、壁厚），无需标注。不同井况适配不同弹型。' };
  }

  /* =========================================================
     ③ 规则匹配
     ========================================================= */
  function stage3(t) {
    var c = compute(), rank = c.rank;
    var s = '';
    s += G.panel(0, '① 候选', rank.nCand + ' 种', C.blue);
    s += G.panel(1, '② 全库', rank.nAll + ' 种', C.clay);
    s += G.panel(2, '③ 筛掉', (rank.nAll - rank.nCand) + ' 种', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14;
    s += G.txt(x0, y0 - 22, '规则匹配 · 筛不适用', { size: 9.5, fill: C.ink2, weight: 700 });
    for (var ri = 0; ri < Math.min(rank.cands.length, 7); ri++) {
      var b = rank.cands[ri];
      var by = y0 + ri * 15;
      s += G.circle(x0 + 8, by, 3, { fill: C2, stroke: 'none' });
      s += G.txt(x0 + 18, by, b.name, { size: 8.4, fill: C.ink2 });
      s += G.txt(x0 + 180, by, '穿' + f(b.depth) + ' 径' + f(b.dia), { size: 8, fill: C.ink3 });
    }
    s += G.txt(x0, y0 + h + 12, '规则：岩性或钢级命中且壁厚满足', { size: 8, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '匹配的坑',
      ['· 硬规则',
       '  → 筛掉',
       '· 全保留',
       '  → 没法选',
       '',
       '得分排序',
       '选出最优。'], 'jade');
    return { svg: s, stats: [{ k: '候选', v: rank.nCand + ' 种' }, { k: '全库', v: rank.nAll + ' 种' }], note: '用规则匹配筛掉不适用的弹型（岩性/钢级/壁厚约束），缩小候选集。' };
  }

  /* =========================================================
     ④ 综合得分
     ========================================================= */
  function stage4(t) {
    var c = compute(), rank = c.rank;
    var s = '';
    s += G.panel(0, '① 穿深', '32%', C.blue);
    s += G.panel(1, '② 孔径', '18%', C.clay);
    s += G.panel(2, '③ 命中+反馈', '50%', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14;
    s += G.txt(x0, y0 - 22, '综合得分 · 加权', { size: 9.5, fill: C.ink2, weight: 700 });
    var items = [
      ['穿深', 0.32, C0],
      ['孔径', 0.18, C1],
      ['岩性命中', 0.2, C2],
      ['钢级命中', 0.12, '#7a8aa0'],
      ['壁厚命中', 0.08, '#a9b8c6'],
      ['使用反馈', 0.1, CR]
    ];
    for (var i2 = 0; i2 < items.length; i2++) {
      var it = items[i2];
      var ry2 = y0 + i2 * 17;
      s += G.txt(x0, ry2, it[0], { size: 8.4, fill: C.ink2 });
      s += G.rect(x0 + 80, ry2 - 4, it[1] * 200, 8, { fill: it[2], stroke: 'none' });
      s += G.txt(x0 + 290, ry2, f(it[1] * 100, 0) + '%', { size: 8, fill: C.ink3 });
    }
    s += G.txt(x0, y0 + h + 8, '分数=Σ 权重×归一属性', { size: 8.2, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '打分的坑',
      ['· 只看穿深',
       '  → 孔径失衡',
       '· 不带反馈',
       '  → 忽略实况',
       '',
       '多因子',
       '综合评分。'], 'jade');
    return { svg: s, stats: [{ k: '穿深权重', v: '32%' }, { k: '反馈权重', v: '10%' }], note: '候选弹型按穿深、孔径、条件命中与使用反馈加权打分。' };
  }

  /* =========================================================
     ⑤ 排序
     ========================================================= */
  function stage5(t) {
    var c = compute(), rank = c.rank;
    var s = '';
    s += G.panel(0, '① 首名', rank.cands[0] ? rank.cands[0].name : '无', C.blue);
    s += G.panel(1, '② 得分', rank.cands[0] ? f(rank.cands[0].score) : '—', C.clay);
    s += G.panel(2, '③ 候选', rank.nCand + ' 种', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '候选排序', { size: 9.5, fill: C.ink2, weight: 700 });
    for (var ri2 = 0; ri2 < Math.min(rank.cands.length, 7); ri2++) {
      var b2 = rank.cands[ri2];
      var ry3 = y0 + ri2 * 15;
      s += G.txt(x0, ry3, (ri2 + 1) + '. ' + b2.name, { size: 8.4, fill: ri2 === 0 ? C.jadeD : C.ink2, weight: ri2 === 0 ? 700 : 400 });
      s += G.rect(x0 + 150, ry3 - 3, b2.score * 80, 8, { fill: ri2 === 0 ? C2 : '#a9b8c6', stroke: 'none' });
      s += G.txt(x0 + 238, ry3, f(b2.score, 2), { size: 8, fill: C.ink3 });
    }

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '排序的坑',
      ['· 常用弹',
       '  → 未必最优',
       '· 只给一个',
       '  → 无法换',
       '',
       '全候选',
       '排序呈现。'], 'jade');
    return { svg: s, stats: [{ k: '首推', v: rank.cands[0] ? rank.cands[0].name : '无' }, { k: '候选', v: rank.nCand + ' 种' }], note: '按综合得分对候选弹型排序，替代"常用弹"依赖。' };
  }

  /* =========================================================
     ⑥ 推荐选型
     ========================================================= */
  function stage6(t) {
    var c = compute(), rank = c.rank;
    var top = rank.cands[0];
    var s = '';
    s += G.panel(0, '① 推荐', top ? top.name : '无匹配', C.blue);
    s += G.panel(1, '② 得分', top ? f(top.score) : '—', C.clay);
    s += G.panel(2, '③ 参数', top ? '穿' + f(top.depth) + ' 径' + f(top.dia) : '—', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14;
    if (top) {
      var rows = [
        ['弹型', top.name + ' (' + top.id + ')'],
        ['穿深', f(top.depth)],
        ['孔径', f(top.dia)],
        ['岩性命中', top.rockHit ? '是' : '否'],
        ['钢级命中', top.gradeHit ? '是' : '否'],
        ['综合得分', f(top.score)]
      ];
      for (var r = 0; r < rows.length; r++) {
        var ry = y0 + r * 20;
        s += G.rect(x0, ry, 240, 17, { r: 4, fill: C.jadeL, stroke: '#b9d8cb' });
        s += G.txt(x0 + 12, ry + 13, rows[r][0], { size: 8.4, fill: C.ink2 });
        s += G.txt(x0 + 190, ry + 13, rows[r][1], { size: 8.4, fill: C.jadeD, weight: 700 });
      }
      s += G.txt(x0, y0 - 20, '推荐选型 · 首推弹型', { size: 9.5, fill: C.ink2, weight: 700 });
    } else {
      s += G.txt(x0, y0, '无候选弹型适配当前井况', { size: 9, fill: CR });
    }

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '交付的坑',
      ['· 单点推荐',
       '  → 无法权衡',
       '· 评分主观',
       '  → 需现场验证',
       '',
       '排序+全候选',
       '供人决策。'], 'jade');
    return { svg: s, stats: [{ k: '推荐', v: top ? top.name : '无' }, { k: '得分', v: top ? f(top.score) : '—' }], note: '给出首推弹型与完整候选排序，供选型决策，替代人工查手册。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
