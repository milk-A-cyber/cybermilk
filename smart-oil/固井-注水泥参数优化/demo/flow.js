/* =========================================================
   注水泥参数优化 · 算法解剖（井况-浆体-顶替效率 + 约束优化）
   ---------------------------------------------------------
   把「注水泥设计」拆成 6 步，每一步都跑真代码：

     ① 井况接入  井径/温度/压力窗口
     ② 压力窗口  Pp-Pf 密度窗口
     ③ 顶替效率  密度-排量-顶替映射
     ④ 约束优化  窗口内扫描
     ⑤ 结果对比  经验 vs 推荐
     ⑥ 回流      施工结果回流

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
    var key = [L.well, L.margin].join(',');
    if (cache.key === key) return cache;
    var jobs = M.genCementJob(24, 20261221);
    var r = M.recommendDesign(jobs, L.margin, L.well);
    cache = { key: key, L: L, jobs: jobs, r: r };
    return cache;
  }

  /* =========================================================
     ① 井况接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), r = c.r;
    var s = '';
    s += G.panel(0, '① 井况', '井径温度', C.blue);
    s += G.panel(1, '② 压力窗口', 'Pp-Pf', C.clay);
    s += G.panel(2, '③ 施工记录', '密度排量返高', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, '井况接入 · 井' + r.well, { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(G.COLS[0].x + 14, y0 + 10, '井径 ' + f(r.bore, 0) + ' mm', { size: 8.8, fill: C.ink2 });
    s += G.txt(G.COLS[0].x + 14, y0 + 32, '温度 ' + f(r.temp, 0) + ' ℃', { size: 8.8, fill: C.ink2 });
    s += G.txt(G.COLS[0].x + 14, y0 + 54, 'Pp ' + f(r.Pp) + ' g/cm³', { size: 8.8, fill: C.ink2 });
    s += G.txt(G.COLS[0].x + 14, y0 + 76, 'Pf ' + f(r.Pf) + ' g/cm³', { size: 8.8, fill: C.ink2 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '为什么难',
      ['· 施工样本有限',
       '  → 好结果难学',
       '· 标签噪声大',
       '  → 多因素影响',
       '',
       '用代理模型',
       '映射井况-浆体。'], 'clay');
    return { svg: s, stats: [{ k: '井径', v: f(r.bore, 0) + 'mm' }, { k: '窗口', v: r.narrow ? '窄' : '宽' }], note: '读入井况（井径、温度、压力窗口）与施工记录（密度、排量、返高）。注水泥设计多沿用邻井经验，遇窄密度窗口易漏失或留窜槽。' };
  }

  /* =========================================================
     ② 压力窗口
     ========================================================= */
  function stage2(t) {
    var c = compute(), r = c.r;
    var s = '';
    s += G.panel(0, '① 孔隙压力', 'Pp', C.blue);
    s += G.panel(1, '② 破裂压力', 'Pf', C.clay);
    s += G.panel(2, '③ 密度窗口', '约束', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '压力窗口 · 窗口=' + f(r.win) + ' · ' + (r.narrow ? '窄' : '宽'), { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    var dMin = 0.9, dMax = 1.5;
    var ppY = y0 + h - (r.Pp - dMin) / (dMax - dMin) * h;
    var pfY = y0 + h - (r.Pf - dMin) / (dMax - dMin) * h;
    s += G.rect(x0, ppY, xw, pfY - ppY, { r: 0, fill: '#e6f1ec', stroke: 'none' });
    s += G.txt(x0, ppY + (pfY - ppY) / 2 - 3, '密度窗口', { size: 8.5, fill: C.jadeD });
    s += G.txt(x0, ppY - 6, 'Pp ' + f(r.Pp), { size: 8, fill: C.ink3 });
    s += G.txt(x0, pfY - 6, 'Pf ' + f(r.Pf), { size: 8, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '窗口的坑',
      ['· 窄窗口',
       '  → Pp 与 Pf 接近',
       '· 经验密度',
       '  → 易超破裂压力',
       '',
       '密度必须落在',
       '窗口约束内。'], 'jade');
    return { svg: s, stats: [{ k: 'Pp', v: f(r.Pp) }, { k: 'Pf', v: f(r.Pf) }], note: '建立密度窗口约束：孔隙压力与破裂压力当量密度之间。窄窗口（Pp 与 Pf 接近）时经验密度易超出破裂压力导致漏失。' };
  }

  /* =========================================================
     ③ 顶替效率
     ========================================================= */
  function stage3(t) {
    var c = compute(), r = c.r;
    var s = '';
    s += G.panel(0, '① 浆体密度', '浆柱', C.blue);
    s += G.panel(1, '② 排量', '替浆', C.clay);
    s += G.panel(2, '③ 顶替效率', '映射', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '顶替效率映射 · 密度×排量→全封固', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    var effVals = [];
    for (var i = 0; i < 40; i++) {
      var dens = r.Pp + (r.Pf - r.Pp) * i / 39;
      effVals.push(M && M.recommendDesign ? effAt(dens, 1.4, r) : 0.5);
    }
    s += G.txt(x0, y0 + h + 22, '密度接近最优→顶替效率高', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '顶替的坑',
      ['· 密度过低',
       '  → 留窜槽',
       '· 排量过大',
       '  → 压漏地层',
       '',
       '找不漏失的',
       '最高效率点。'], 'clay');
    return { svg: s, stats: [{ k: '排量', v: '0.6—2.2' }, { k: '映射', v: '代理模型' }], note: '建立"井况—浆体—顶替效率"映射：密度过低留窜槽、排量过高压漏地层，需在约束内找不漏失的最高效率点。' };
  }
  function effAt(dens, rate, r) {
    var Pp = r.Pp, Pf = r.Pf;
    var dOpt = Pp + 0.12;
    var dPen = clamp(1 - Math.abs(dens - dOpt) / 0.25, 0, 1);
    var rPen = clamp(rate / 1.8, 0, 1) * 0.85 + 0.15;
    var wPen = clamp(1 - Math.abs(Pf - Pp - 0.28) / 0.25, 0.6, 1);
    return clamp(dPen * rPen * wPen, 0, 1);
  }

  /* =========================================================
     ④ 约束优化
     ========================================================= */
  function stage4(t) {
    var c = compute(), r = c.r;
    var s = '';
    s += G.panel(0, '① 扫描', '密度×排量', C.blue);
    s += G.panel(1, '② 约束', '不漏失', C.clay);
    s += G.panel(2, '③ 最优', '密度' + f(r.optDens), C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '约束优化 · 推荐密度=' + f(r.optDens) + ' 排量=' + f(r.optRate), { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + 10, '推荐浆柱密度 ' + f(r.optDens) + ' g/cm³', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 34, '推荐排量 ' + f(r.optRate) + ' m³/min', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 58, '顶替效率 ' + f(r.optEff, 3), { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 82, '是否漏失 ' + (r.opt.loss ? '是' : '否'), { size: 8.8, fill: C.ink2 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '约束优化的坑',
      ['· 窗口外',
       '  → 必漏失',
       '· 只求效率',
       '  → 忽略约束',
       '',
       '先筛不漏失',
       '再取最高效。'], 'jade');
    return { svg: s, stats: [{ k: '密度', v: f(r.optDens) }, { k: '排量', v: f(r.optRate) }], note: '在密度窗口约束内扫描浆柱密度与排量，先筛掉会漏失的候选，再取顶替效率最高者，输出浆柱结构与排量推荐。' };
  }

  /* =========================================================
     ⑤ 结果对比
     ========================================================= */
  function stage5(t) {
    var c = compute(), r = c.r;
    var s = '';
    s += G.panel(0, '① 经验', '邻井', C.clay);
    s += G.panel(1, '② 推荐', '约束优化', C.jade);
    s += G.panel(2, '③ 对比', 'CBL/漏失', C.blue);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14;
    var rows = [
      ['方案', '密度', '排量', '漏失', 'CBL'],
      ['邻井经验', f(r.exp.dens), f(r.exp.rate), r.exp.loss ? '是' : '否', r.exp.cbl === 0 ? '好' : r.exp.cbl === 1 ? '中' : '差'],
      ['约束优化', f(r.opt.dens), f(r.opt.rate), r.opt.loss ? '是' : '否', r.opt.cbl === 0 ? '好' : r.opt.cbl === 1 ? '中' : '差']
    ];
    for (var rr = 0; rr < rows.length; rr++) {
      var ry = y0 + rr * 26;
      var bg = rr === 0 ? '#f4f3ef' : rr === 1 ? C.clayL : C.jadeL;
      s += G.rect(x0, ry, 240, 22, { r: 4, fill: bg, stroke: C.line });
      s += G.txt(x0 + 8, ry + 16, rows[rr][0], { size: 8, fill: C.ink2, weight: rr === 0 ? 700 : 600 });
      s += G.txt(x0 + 70, ry + 16, rows[rr][1], { size: 8, fill: C.ink2 });
      s += G.txt(x0 + 122, ry + 16, rows[rr][2], { size: 8, fill: C.ink2 });
      s += G.txt(x0 + 170, ry + 16, rows[rr][3], { size: 8, fill: C.ink2 });
      s += G.txt(x0 + 210, ry + 16, rows[rr][4], { size: 8, fill: C.ink2 });
    }

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '对比的意义',
      ['· 经验密度',
       '  → 常漏失',
       '· 推荐密度',
       '  → 全封固',
       '',
       '约束优化',
       '显式好于经验。'], 'jade');
    return { svg: s, stats: [{ k: '经验漏失', v: r.exp.loss ? '是' : '否' }, { k: '推荐漏失', v: r.opt.loss ? '是' : '否' }], note: '把约束优化推荐与邻井经验方案对比：经验密度常超破裂压力导致漏失，约束优化推荐在窗口内实现全封固。' };
  }

  /* =========================================================
     ⑥ 回流
     ========================================================= */
  function stage6(t) {
    var c = compute(), r = c.r;
    var s = '';
    s += G.panel(0, '① 施工', 'CBL 评价', C.blue);
    s += G.panel(1, '② 漏失记录', '回流', C.clay);
    s += G.panel(2, '③ 越用越准', '闭环', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14;
    var rows = [
      ['设计推荐', '推荐', '施工'],
      ['施工结果', 'CBL 评价', '漏失'],
      ['结果回流', '已回流', 'ok']
    ];
    for (var rr = 0; rr < rows.length; rr++) {
      var ry = y0 + rr * 38;
      s += G.rect(x0, ry, 240, 30, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(x0 + 26, ry + 20, rows[rr][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(x0 + 140, ry + 20, rows[rr][1], { size: 8.8, fill: C.jadeD });
    }
    s += G.txt(x0, y0 - 20, '回流闭环', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '回流的坑',
      ['· 不回流',
       '  → 样本永远有限',
       '· 标签噪声不消',
       '',
       '施工结果回流',
       '设计持续变准。'], 'jade');
    return { svg: s, stats: [{ k: '回流', v: '已闭环' }, { k: '推荐', v: '全封固' }], note: '施工结果（CBL 评价与漏失情况）回流训练集，弥补样本有限、标签噪声大的问题，设计越用越准。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
