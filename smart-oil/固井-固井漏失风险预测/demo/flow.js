/* =========================================================
   固井漏失风险预测 · 算法解剖（分类模型 + 不均衡 + 归因）
   ---------------------------------------------------------
   把「漏失风险预测」拆成 6 步，每一步都跑真代码：

     ① 井况接入  井况 + 浆柱设计
     ② 类不均衡  漏失占比低
     ③ 漏失概率  分类模型
     ④ 风险等级  低/中/高
     ⑤ 特征归因  关键影响因素
     ⑥ 回流      漏失记录回流

   依赖：window.RemoteBridge（demo.js 暴露的真模型）
        window.AFlow（算法解剖引擎）
   ========================================================= */
(function (global) {
  'use strict';

  var B = global.RemoteBridge;
  if (!B || !global.AFlow) return;

  var G = global.AFlow.G, C = global.AFlow.C;
  var M = B.M;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
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
    var key = [L.well, L.thr].join(',');
    if (cache.key === key) return cache;
    var cases = M.genLeakCase(200, 20261231);
    var lc = M.leakClassify(cases, L.thr, L.well);
    var ex = M.riskExplain(cases, L.well);
    var lossN = 0;
    for (var i = 0; i < cases.n; i++) if (cases.loss[i] === 1) lossN++;
    cache = { key: key, L: L, cases: cases, lc: lc, ex: ex, lossN: lossN };
    return cache;
  }

  /* =========================================================
     ① 井况接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), lc = c.lc;
    var s = '';
    s += G.panel(0, '① 井况', '地层压力', C.blue);
    s += G.panel(1, '② 浆柱设计', '密度浆柱', C.clay);
    s += G.panel(2, '③ 漏失标签', '是否漏失', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '井况接入 · 井' + lc.well, { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(G.COLS[0].x + 14, y0 + 10, 'Pp ' + f(lc.Pp) + ' g/cm³', { size: 8.8, fill: C.ink2 });
    s += G.txt(G.COLS[0].x + 14, y0 + 32, 'Pf ' + f(lc.Pf) + ' g/cm³', { size: 8.8, fill: C.ink2 });
    s += G.txt(G.COLS[0].x + 14, y0 + 54, '井径 ' + f(lc.bore, 0) + ' mm', { size: 8.8, fill: C.ink2 });
    s += G.txt(G.COLS[0].x + 14, y0 + 76, '浆体密度 ' + f(lc.dens) + ' g/cm³', { size: 8.8, fill: C.ink2 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '为什么难',
      ['· 漏失事件占比低',
       '  → 类不均衡',
       '· 压力剖面是解释值',
       '  → 输入误差',
       '',
       '需分类模型',
       '预判风险等级。'], 'clay');
    return { svg: s, stats: [{ k: '井', v: '200 井次' }, { k: '漏失', v: f(c.lossN / c.cases.n * 100, 0) + '%' }], note: '读入井况与地层压力（孔隙压力、破裂压力、井径，单区块 200—1000 井次）与浆柱设计（密度、浆柱结构），漏失记录作为标签。' };
  }

  /* =========================================================
     ② 类不均衡
     ========================================================= */
  function stage2(t) {
    var c = compute();
    var s = '';
    s += G.panel(0, '① 不漏失', '多数', C.blue);
    s += G.panel(1, '② 漏失', '少数', C.clay);
    s += G.panel(2, '③ 不均衡', '漏失' + f(c.lossN / c.cases.n * 100, 0) + '%', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '类不均衡 · 漏失' + f(c.lossN / c.cases.n * 100, 0) + '%', { size: 9.5, fill: C.ink2, weight: 700 });
    var safe = c.cases.n - c.lossN, loss = c.lossN;
    s += G.rect(x0, y0, xw, h, { r: 6, fill: C.blueL, stroke: C.line });
    s += G.txt(x0 + xw / 2, y0 + h / 2 - 8, '不漏失 ' + safe, { size: 11, fill: '#2b4a72', anchor: 'middle' });
    var lossH = Math.max(8, h * (loss / c.cases.n));
    s += G.rect(x0 + xw / 4, y0 + h - lossH, xw / 2, lossH, { r: 4, fill: CR, stroke: 'none' });
    s += G.txt(x0 + xw / 2, y0 + h - lossH - 6, '漏失 ' + loss, { size: 8.5, fill: CR, anchor: 'middle' });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '不均衡的坑',
      ['· 漏失占比低',
       '  → 模型偏向多数类',
       '· 漏失量',
       '  → 也作标签',
       '',
       '阈值权衡',
       '兼顾漏失召回。'], 'clay');
    return { svg: s, stats: [{ k: '漏失率', v: f(c.lossN / c.cases.n * 100, 0) + '%' }, { k: '标签', v: '漏失量' }], note: '漏失事件占比低（类不均衡），分类模型易偏向多数类；漏失记录（是否漏失、漏失量）作标签，需阈值权衡兼顾漏失召回。' };
  }

  /* =========================================================
     ③ 漏失概率
     ========================================================= */
  function stage3(t) {
    var c = compute(), lc = c.lc;
    var s = '';
    s += G.panel(0, '① 裕度', 'Pf-ECD', C.blue);
    s += G.panel(1, '② 概率', 'logistic', C.clay);
    s += G.panel(2, '③ 分类', 'p=' + f(lc.p), C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '漏失概率 · 裕度→概率', { size: 9.5, fill: C.ink2, weight: 700 });
    var ps = [];
    for (var i = 0; i <= 40; i++) {
      var m = -0.5 + i * 0.8 / 40;
      ps.push(1 / (1 + Math.exp(m * 4.5)));
    }
    s += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    var line = '<path d="M';
    for (var j = 0; j < ps.length; j++) {
      line += (x0 + j * xw / ps.length).toFixed(1) + ' ' + (y0 + h - ps[j] * h).toFixed(1);
      if (j < ps.length - 1) line += ' L';
    }
    line += '" fill="none" stroke="' + C0 + '" stroke-width="2"/>';
    s += line;
    s += G.txt(x0, y0 + h + 22, '裕度越小 → 漏失概率越高', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '分类的坑',
      ['· 压力解释值有误差',
       '  → 概率带噪声',
       '· 单看密度',
       '  → 漏判',
       '',
       '输出概率',
       '不只看二值。'], 'jade');
    return { svg: s, stats: [{ k: '概率', v: f(lc.p) }, { k: '裕度', v: f(lc.margin) }], note: '用分类模型基于井况与浆柱设计预测漏失概率：裕度（破裂压力-当量循环密度）越小越易漏失。压力剖面是解释值、存在输入误差，概率本身带噪声。' };
  }

  /* =========================================================
     ④ 风险等级
     ========================================================= */
  function stage4(t) {
    var c = compute(), lc = c.lc;
    var s = '';
    s += G.panel(0, '① 概率', 'p=' + f(lc.p), C.blue);
    s += G.panel(1, '② 阈值', '0.33/0.66', C.clay);
    s += G.panel(2, '③ 风险', lc.risk, C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '风险等级 · 井' + lc.well + ' 风险' + lc.risk, { size: 9.5, fill: C.ink2, weight: 700 });
    var bars = [
      ['低', 0, 0.33, '#7a8fa3'],
      ['中', 0.33, 0.66, '#b26a39'],
      ['高', 0.66, 1, '#b05a51']
    ];
    var pPos = x0 + lc.p * xw;
    for (var b = 0; b < bars.length; b++) {
      var bx = x0 + bars[b][1] * xw, bw = (bars[b][2] - bars[b][1]) * xw;
      s += G.rect(bx, y0 + 8, bw, 36, { r: 4, fill: bars[b][3], stroke: 'none' });
      s += G.txt(bx + bw / 2, y0 + 31, bars[b][0], { size: 9, fill: '#fff', anchor: 'middle' });
    }
    s += G.circle(pPos, y0 + 26, 6, { fill: '#242b2e', stroke: '#fff', sw: 2 });
    s += G.txt(x0, y0 + 66, '当前概率 p=' + f(lc.p) + ' · 判' + lc.risk + '风险', { size: 9, fill: C.ink2 });
    s += G.txt(x0, y0 + 86, '真值：' + (lc.loss === 1 ? '会漏失' : '不漏失'), { size: 9, fill: lc.loss === 1 ? CR : C.jadeD });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '风险等级的坑',
      ['· 阈值定死',
       '  → 漏判',
       '· 不输出等级',
       '  → 无法决策',
       '',
       '输出风险等级',
       '分级处置。'], 'jade');
    return { svg: s, stats: [{ k: '风险', v: lc.risk }, { k: '真值', v: lc.loss === 1 ? '漏失' : '不漏失' }], note: '按概率输出风险等级（低/中/高）：概率低于 0.33 低、0.33—0.66 中、以上高。在施工前预判风险等级，分级处置。' };
  }

  /* =========================================================
     ⑤ 特征归因
     ========================================================= */
  function stage5(t) {
    var c = compute(), ex = c.ex;
    var s = '';
    s += G.panel(0, '① 各特征', '敏感性', C.blue);
    s += G.panel(1, '② 排序', '关键因素', C.clay);
    s += G.panel(2, '③ 归因', '贡献占比', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '特征归因 · 关键影响因素', { size: 9.5, fill: C.ink2, weight: 700 });
    var maxAbs = 0;
    ex.feats.forEach(function (ft) { if (Math.abs(ft.v) > maxAbs) maxAbs = Math.abs(ft.v); });
    for (var i = 0; i < ex.feats.length; i++) {
      var ft = ex.feats[i];
      var by = y0 + i * 26;
      var bw = Math.abs(ft.v) / maxAbs * (xw - 30);
      s += G.txt(x0, by + 10, ft.k, { size: 8, fill: C.ink2 });
      s += G.rect(x0 + 58, by, Math.max(2, bw), 12, { r: 2, fill: ft.v >= 0 ? CR : C2, stroke: 'none' });
      s += G.txt(x0 + xw, by + 11, f(ft.share * 100, 0) + '%', { size: 8, fill: C.ink3, anchor: 'end' });
    }

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '归因的坑',
      ['· 只看概率',
       '  → 不知为何漏',
       '· 不排序',
       '  → 无法改进',
       '',
       '特征归因',
       '定位关键因素。'], 'jade');
    return { svg: s, stats: [{ k: '主因', v: ex.feats[0].k }, { k: '次因', v: ex.feats[1].k }], note: '特征归因输出关键影响因素及贡献占比（浆体密度、排量、破裂压力、密度窗口等），定位漏失主因，指导施工前调整。' };
  }

  /* =========================================================
     ⑥ 回流
     ========================================================= */
  function stage6(t) {
    var c = compute(), lc = c.lc;
    var s = '';
    s += G.panel(0, '① 预测', '风险等级', C.blue);
    s += G.panel(1, '② 漏失记录', '回流', C.clay);
    s += G.panel(2, '③ 越用越准', '闭环', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14;
    var rows = [
      ['风险预判', '模型', '分级'],
      ['漏失记录', '是否漏失/量', '回流'],
      ['结果回流', '已回流', 'ok']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 38;
      s += G.rect(x0, ry, 240, 30, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(x0 + 26, ry + 20, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(x0 + 140, ry + 20, rows[r][1], { size: 8.8, fill: C.jadeD });
    }
    s += G.txt(x0, y0 - 20, '回流闭环', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '回流的坑',
      ['· 不回流',
       '  → 漏失率永远低',
       '· 无法纠正不均衡',
       '',
       '漏失记录回流',
       '风险越用越准。'], 'jade');
    return { svg: s, stats: [{ k: '回流', v: '已闭环' }, { k: '风险', v: lc.risk }], note: '漏失记录（是否漏失、漏失量）回流训练集，缓解类不均衡，风险预测越用越准。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
