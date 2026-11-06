/* =========================================================
   录井报告自动生成 · 算法解剖（信息抽取 + 模板 + 检索增强）
   ---------------------------------------------------------
   把「录井数据 → 报告」拆成 6 步，每一步都跑真代码：

     ① 数据与模板接入  录井数据 + 模板规范
     ② 信息抽取        报告要点
     ③ 模板化生成      规范报告
     ④ 检索增强        历史报告佐证
     ⑤ 复核修正        录井工复核
     ⑥ 回流            复核回流更准

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

  var C0 = '#41699b', C1 = '#b26a39', C2 = '#2f7d6b';
  var LCOL = ['#b26a39', '#c98a2b', '#7a8a9a', '#5a4a3a'];

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

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.extractMode, L.tplMode, L.ragMode].join(',');
    if (cache.key === key) return cache;
    var well = M.genWell(20261181);
    var ext = M.extractInfo(well, L.extractMode);
    var tpl = M.tplGen(ext);
    var rag = M.ragEnhance(well, L.ragMode);
    cache = { key: key, L: L, well: well, ext: ext, tpl: tpl, rag: rag };
    return cache;
  }

  /* =========================================================
     ① 数据与模板接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), well = c.well;
    var s = '';
    s += G.panel(0, '① 录井数据', '钻时/气测/岩屑/荧光', C.blue);
    s += G.panel(1, '② 模板规范', '报告模板', C.clay);
    s += G.panel(2, '③ 历史报告', '100—300 份', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '本井地层与油气显示', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    var n = well.strata.length;
    for (var i = 0; i < n; i++) {
      var st = well.strata[i];
      var wpx = (st.base - st.top) / well.depth * 240;
      var bx = G.COLS[0].x + 14 + st.top / well.depth * 240;
      s += G.rect(bx, y0, Math.max(6, wpx), h, { r: 0, fill: LCOL[st.litho], op: st.gas ? 0.9 : 0.3 });
      if (wpx > 20) s += G.txt(bx + wpx / 2, y0 + h - 8, M.LITHO[st.litho], { size: 8, fill: '#fff', anchor: 'middle', weight: 700 });
    }
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '深色=油气显示层', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '模板与数据',
      ['· 结构化录井数据',
       '· 报告模板规范',
       '· 历史报告参考',
       '',
       '模板口径不统一，',
       '生成报告也返工多。'], 'clay');
    return { svg: s, stats: [{ k: '井深', v: well.depth + ' m' }, { k: '地层', v: well.n + ' 层' }], note: '读入结构化录井数据（钻时/气测/岩屑/荧光）与报告模板规范。模板口径不统一，生成报告也口径不一、返工多。' };
  }

  /* =========================================================
     ② 信息抽取
     ========================================================= */
  function stage2(t) {
    var c = compute(), ext = c.ext, L = c.L;
    var s = '';
    s += G.panel(0, '① 录井数据', '多类成果', C.blue);
    s += G.panel(1, '② 信息抽取', '报告要点', C.jade);
    s += G.panel(2, '③ 要点清单', '不漏显示', C.clay);

    var y0 = 130;
    var rows = ext.items.map(function (it, i) { return [it.k, it.v]; });
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 34;
      s += G.rect(G.COLS[0].x + 14, ry, 240, 28, { r: 5, fill: r % 2 ? '#f7f6f1' : C.blueL, stroke: '#c5d6ea' });
      s += G.txt(G.COLS[0].x + 26, ry + 19, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(G.COLS[0].x + 150, ry + 19, rows[r][1], { size: 8.8, fill: C0 });
    }
    s += G.txt(G.COLS[0].x + 14, y0 - 20, '信息抽取 · 油气显示 ' + ext.gasN + ' 层', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '信息抽取的坑',
      ['· 数据散落多类成果',
       '  → 抽取不全',
       '· 关键显示被漏',
       '',
       '要覆盖全要点，',
       '不漏油气显示。'], 'jade');
    return { svg: s, stats: [{ k: '要点', v: ext.items.length + ' 项' }, { k: '油气显示', v: ext.gasN + ' 层' }], note: '从结构化录井数据抽报告要点（地层、油气显示、气测异常）。数据散落多类成果，抽取不全关键显示会被漏。' };
  }

  /* =========================================================
     ③ 模板化生成
     ========================================================= */
  function stage3(t) {
    var c = compute(), tpl = c.tpl, L = c.L;
    var s = '';
    s += G.panel(0, '① 报告要点', '抽取结果', C.blue);
    s += G.panel(1, '② 模板化生成', '口径统一', C.jade);
    s += G.panel(2, '③ 规范报告', '返工少', C.clay);

    var y0 = 130;
    s += G.txt(G.COLS[0].x + 14, y0 - 20, '报告骨架（模板规范）', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.rect(G.COLS[0].x + 14, y0, 240, 24, { r: 4, fill: C.jadeL, stroke: '#b9d8cb' });
    s += G.txt(G.COLS[0].x + 26, y0 + 17, '井况 / 地层 / 油气显示', { size: 8.8, fill: C.jadeD, weight: 700 });
    for (var i = 0; i < tpl.text.length; i++) {
      var ty = y0 + 34 + i * 26;
      s += G.rect(G.COLS[0].x + 20, ty, 224, 22, { r: 4, fill: '#fbfaf6', stroke: '#e9e4d8' });
      s += G.txt(G.COLS[0].x + 28, ty + 15, tpl.text[i], { size: 7.8, fill: C.ink2 });
    }
    s += G.txt(G.COLS[0].x + 14, y0 + 34 + tpl.text.length * 26 + 10, '模板口径统一', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '模板生成的坑',
      ['· 纯模板填数',
       '  → 报告生硬',
       '· 缺上下文佐证',
       '',
       '按模板规范填，',
       '口径统一返工少。'], 'clay');
    return { svg: s, stats: [{ k: '段落', v: tpl.text.length + ' 段' }, { k: '模板', v: L.tplMode === 0 ? '无' : '已套' }], note: '按报告模板把要点填成规范报告，口径统一。纯模板填数报告生硬，缺上下文与佐证。' };
  }

  /* =========================================================
     ④ 检索增强
     ========================================================= */
  function stage4(t) {
    var c = compute(), rag = c.rag, well = c.well, L = c.L;
    var s = '';
    s += G.panel(0, '① 模板报告', '要点初稿', C.blue);
    s += G.panel(1, '② 检索历史报告', '相关段', C.jade);
    s += G.panel(2, '③ 报告+佐证', '有据可依', C.clay);

    var y0 = 130;
    s += G.txt(G.COLS[0].x + 14, y0 - 20, '历史报告库 · 引用 ' + rag.refs.length + ' 条', { size: 9.5, fill: C.ink2, weight: 700 });
    for (var i = 0; i < well.history.length; i++) {
      var h = well.history[i], hy = y0 + i * 36;
      var col = h.ref === 1 ? C.jadeL : '#f4f3ef';
      var st = h.ref === 1 ? '#b9d8cb' : C.line;
      s += G.rect(G.COLS[0].x + 14, hy, 240, 30, { r: 5, fill: col, stroke: st });
      s += G.txt(G.COLS[0].x + 24, hy + 20, h.name, { size: 8, fill: h.ref === 1 ? C.jadeD : C.ink3, weight: 700 });
      s += G.txt(G.COLS[0].x + 26, hy + 20, h.seg, { size: 7.5, fill: C.ink3, x: G.COLS[0].x + 26 });
      s += G.txt(G.COLS[0].x + 240, hy + 20, h.ref === 1 ? '引用' : '不引', { size: 7.5, fill: h.ref === 1 ? C.jadeD : '#9ba3a9', anchor: 'end', weight: 700 });
    }
    s += G.txt(G.COLS[0].x + 14, y0 + well.history.length * 36 + 12, (L.ragMode === 1 ? '已引用 ' : '未引用 ') + rag.refs.length + ' 条相关历史报告', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '检索增强的坑',
      ['· 不检索历史报告',
       '  → 缺佐证',
       '· 结论难核实',
       '',
       '检索相关段补佐证，',
       '关键结论有据。'], 'jade');
    return { svg: s, stats: [{ k: '引用', v: rag.refs.length + ' 条' }, { k: '方式', v: L.ragMode === 0 ? '无检索' : 'RAG' }], note: '检索历史报告相关段，补佐证与上下文。不检索历史报告，报告缺佐证、结论难核实。' };
  }

  /* =========================================================
     ⑤ 复核修正
     ========================================================= */
  function stage5(t) {
    var c = compute(), ext = c.ext, rag = c.rag;
    var s = '';
    s += G.panel(0, '① 生成报告', '模型建议', C.blue);
    s += G.panel(1, '② 复核修正', '确认改写', C.clay);
    s += G.panel(2, '③ 时效↑', '返工少', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['要点覆盖', ext.items.length + ' 项', '复核'],
      ['油气显示', ext.gasN + ' 层', '核对'],
      ['检索引用', rag.refs.length + ' 条', '佐证']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 38;
      s += G.rect(G.COLS[0].x + 14, ry, 240, 30, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(G.COLS[0].x + 26, ry + 20, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(G.COLS[0].x + 150, ry + 20, rows[r][1], { size: 8.8, fill: C.jadeD });
    }
    s += G.txt(G.COLS[0].x + 14, y0 - 20, '复核修正清单', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '复核修正的坑',
      ['· 复核不回流',
       '  → 模型不知报告错',
       '· 永远返工',
       '',
       '修正结果要回流，',
       '报告越用越准。'], 'clay');
    return { svg: s, stats: [{ k: '要点', v: ext.items.length + ' 项' }, { k: '引用', v: rag.refs.length + ' 条' }], note: '生成报告给建议，录井工复核修正。复核结果不回流，模型不知道报告错在哪，永远返工。' };
  }

  /* =========================================================
     ⑥ 回流
     ========================================================= */
  function stage6(t) {
    var c = compute(), ext = c.ext, rag = c.rag;
    var s = '';
    s += G.panel(0, '① 生成建议', '模型输出', C.blue);
    s += G.panel(1, '② 复核回流', '确认修正', C.clay);
    s += G.panel(2, '③ 越用越准', '回流闭环', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['生成建议', '模型', '复核'],
      ['复核修正', '人工', '改写'],
      ['结果回流', '已回流', 'ok']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 38;
      s += G.rect(G.COLS[0].x + 14, ry, 240, 30, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(G.COLS[0].x + 26, ry + 20, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(G.COLS[0].x + 140, ry + 20, rows[r][1], { size: 8.8, fill: C.jadeD });
    }
    s += G.txt(G.COLS[0].x + 14, y0 - 20, '回流闭环', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '回流的坑',
      ['· 不回流',
       '  → 数据不增，一直返工',
       '· 无法越用越准',
       '',
       '复核+历史报告回流，',
       '生成持续变准。'], 'jade');
    return { svg: s, stats: [{ k: '要点', v: ext.items.length + ' 项' }, { k: '回流', v: '已闭环' }], note: '复核结果回流训练集，模型越用越准、报告返工持续下降。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
