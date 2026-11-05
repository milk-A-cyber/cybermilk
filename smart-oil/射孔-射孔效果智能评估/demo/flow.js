/* =========================================================
   射孔效果智能评估 · 算法解剖（生产数据反演 + 不确定性 + 补孔）
   ---------------------------------------------------------
   把「效果评估」拆成 6 步，每一步都跑真代码：

     ① 生产数据  产量时序
     ② 射孔记录  层段/孔密/相位
     ③ 反演  各段效率
     ④ 不确定性  区间
     ⑤ 低效识别  阈值
     ⑥ 补孔建议  增益

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

  var C0 = '#41699b', C1 = '#b26a39', C2 = '#2f7d6b', CR = '#b05a51', CO = '#c98f3d';

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
    var key = [L.cut, L.noise].join(',');
    if (cache.key === key) return cache;
    var prod = M.genProd(20261108);
    var inv = M.invertEff(prod, L.noise);
    var ident = M.identifyLowEff(inv, L.cut);
    var rec = M.recommendPatch(prod.records, inv, L.cut);
    cache = { key: key, prod: prod, inv: inv, ident: ident, rec: rec };
    return cache;
  }

  /* =========================================================
     ① 生产数据
     ========================================================= */
  function stage1(t) {
    var c = compute(), prod = c.prod;
    var s = '';
    s += G.panel(0, '① 产量', f(Math.max.apply(null, prod.q), 0), C.blue);
    s += G.panel(1, '② 压力', '18-22MPa', C.clay);
    s += G.panel(2, '③ 含水', f(prod.w[prod.w.length - 1]), C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '生产数据 · 时序', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    var maxQ = Math.max.apply(null, prod.q);
    var qline = '<path d="M';
    for (var t = 0; t < prod.q.length; t++) {
      qline += (x0 + t / (prod.q.length - 1) * xw).toFixed(1) + ' ' + (y0 + h - prod.q[t] / maxQ * h).toFixed(1);
      if (t < prod.q.length - 1) qline += ' L';
    }
    qline += '" fill="none" stroke="' + C0 + '" stroke-width="1.8"/>';
    s += qline;
    s += G.txt(x0, y0 + h + 20, '产量随时间递减', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '数据的坑',
      ['· 试井资料有限',
       '  → 只有产量',
       '· 多段混合',
       '  → 难分解',
       '',
       '反演',
       '分效率。'], 'clay');
    return { svg: s, stats: [{ k: '产量', v: f(maxQ, 0) + ' m³/d' }, { k: '数据', v: prod.T + ' 点' }], note: '读入单井生产数据（产量/压力/含水）。试井资料有限，多数井只有生产数据，无法直接测各段效果。' };
  }

  /* =========================================================
     ② 射孔记录
     ========================================================= */
  function stage2(t) {
    var c = compute(), prod = c.prod;
    var s = '';
    s += G.panel(0, '① 层段', prod.nZone + ' 段', C.blue);
    s += G.panel(1, '② 孔密', '8-20', C.clay);
    s += G.panel(2, '③ 相位', '0-180°', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '射孔记录 · 作为输入', { size: 9.5, fill: C.ink2, weight: 700 });
    for (var i = 0; i < prod.records.length; i++) {
      var r = prod.records[i];
      var ry = y0 + i * 18;
      s += G.txt(x0, ry, '段' + (i + 1), { size: 8.4, fill: C.ink2, weight: 700 });
      s += G.txt(x0 + 50, ry, '孔' + r.density + ' 相' + r.phase + '°', { size: 8.2, fill: C.ink3 });
      var we = (r.density / 16) * phaseW(r.phase);
      s += G.rect(x0 + 150, ry - 3, we * 90, 7, { fill: C0, stroke: 'none' });
    }
    s += G.txt(x0, y0 + h + 6, '权重=孔密×相位因子', { size: 8.2, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '输入的坑',
      ['· 记录齐全',
       '  → 但无效果',
       '· 效果靠试井',
       '  → 试井有限',
       '',
       '生产数据',
       '补上效果。'], 'jade');
    return { svg: s, stats: [{ k: '层段', v: prod.nZone + ' 段' }, { k: '输入', v: '孔密/相位' }], note: '射孔记录（层段、孔密、相位）作为输入。它给出每段的"权重"，但实际效果只能从生产数据反演。' };
  }
  function phaseW(phase) { return 1 - Math.min(180, Math.abs(phase - 90)) / 180 * 0.2; }

  /* =========================================================
     ③ 反演
     ========================================================= */
  function stage3(t) {
    var c = compute(), inv = c.inv;
    var s = '';
    s += G.panel(0, '① 反演', inv.length + ' 段', C.blue);
    s += G.panel(1, '② 方法', '权重分解', C.clay);
    s += G.panel(2, '③ 输出', '效率', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '效率反演', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    for (var i = 0; i < inv.length; i++) {
      var e = inv[i];
      var bx = x0 + (i + 0.5) * (xw / inv.length);
      var cy = y0 + h - e.eff * h;
      s += G.circle(bx, cy, 4.5, { fill: C2, stroke: '#fff', sw: 1.5 });
      s += G.txt(bx, y0 + h + 12, '段' + (i + 1), { size: 7.5, fill: C.ink3 });
    }
    s += G.txt(x0, y0 + h + 26, '各段效率反演结果', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '反演的坑',
      ['· 生产混合',
       '  → 多解',
       '· 只看点',
       '  → 过度自信',
       '',
       '带区间',
       '量化不确定。'], 'clay');
    return { svg: s, stats: [{ k: '反演', v: inv.length + ' 段' }, { k: '方法', v: '权重分解' }], note: '从生产数据反演各段效率：按孔密×相位的权重分解产量，估计每段贡献。' };
  }

  /* =========================================================
     ④ 不确定性
     ========================================================= */
  function stage4(t) {
    var c = compute(), inv = c.inv;
    var s = '';
    s += G.panel(0, '① 噪声', '数据扰动', C.blue);
    s += G.panel(1, '② 区间', 'lo-hi', C.clay);
    s += G.panel(2, '③ 判读', '跨阈=复核', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '不确定性区间', { size: 9.5, fill: C.ink2, weight: 700 });
    for (var i = 0; i < inv.length; i++) {
      var e = inv[i];
      var bx = x0 + (i + 0.5) * (xw / inv.length);
      var ylo = y0 + h - e.hi * h, yhi = y0 + h - e.lo * h;
      s += G.line(bx, ylo, bx, yhi, { stroke: CR, sw: 2.5 });
      s += G.circle(bx, y0 + h - e.eff * h, 4, { fill: C2, stroke: '#fff', sw: 1.5 });
      s += G.txt(bx, y0 + h + 12, '段' + (i + 1), { size: 7.5, fill: C.ink3 });
    }
    s += G.txt(x0, y0 + h + 26, '噪声越大区间越宽', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '区间的坑',
      ['· 只看均值',
       '  → 误判',
       '· 区间太宽',
       '  → 无法决策',
       '',
       '区间跨阈',
       '标待复核。'], 'clay');
    return { svg: s, stats: [{ k: '区间', v: 'lo-hi' }, { k: '用途', v: '避免误判' }], note: '反演带不确定性区间（受数据噪声影响），避免把多解问题当成确定结论。' };
  }

  /* =========================================================
     ⑤ 低效识别
     ========================================================= */
  function stage5(t) {
    var c = compute(), ident = c.ident, L = B.live();
    var nLow = ident.filter(function (i) { return i.low; }).length;
    var nRisk = ident.filter(function (i) { return i.risk; }).length;
    var s = '';
    s += G.panel(0, '① 低效', nLow + ' 段', C.blue);
    s += G.panel(1, '② 待复核', nRisk + ' 段', C.clay);
    s += G.panel(2, '③ 阈值', f(L.cut), C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '低效段识别', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    var cutY = y0 + h - L.cut * h;
    s += G.line(x0, cutY, x0 + xw, cutY, { stroke: CR, sw: 1, dash: '4 3' });
    for (var i = 0; i < ident.length; i++) {
      var id = ident[i];
      var bx = x0 + (i + 0.5) * (xw / ident.length);
      var col = id.low ? CR : id.risk ? CO : C2;
      s += G.circle(bx, y0 + h - id.eff * h, 5, { fill: col, stroke: '#fff', sw: 1.5 });
      s += G.txt(bx, y0 + h + 12, '段' + (i + 1), { size: 7.5, fill: C.ink3 });
    }
    s += G.txt(x0, y0 + h + 26, '红=低效 橙=待复核 绿=正常', { size: 8, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '判别的坑',
      ['· 阈值一刀切',
       '  → 误判',
       '· 凭经验',
       '  → 无依据',
       '',
       '区间+阈值',
       '定量识别。'], 'clay');
    return { svg: s, stats: [{ k: '低效', v: nLow + ' 段' }, { k: '待复核', v: nRisk + ' 段' }], note: '用效率阈值定量识别低效段：区间上界低于阈值判低效，区间跨阈值标待复核，避免误判。' };
  }

  /* =========================================================
     ⑥ 补孔建议
     ========================================================= */
  function stage6(t) {
    var c = compute(), rec = c.rec;
    var s = '';
    s += G.panel(0, '① 补孔', rec.nPatch + ' 段', C.blue);
    s += G.panel(1, '② 复核', rec.nReview + ' 段', C.clay);
    s += G.panel(2, '③ 增益', rec.patch.length ? '↑' + f(rec.patch[0].gain, 0) + '%' : '—', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14;
    s += G.txt(x0, y0 - 22, '补孔建议', { size: 9.5, fill: C.ink2, weight: 700 });
    if (rec.patch.length === 0) {
      s += G.txt(x0, y0, '无补孔建议', { size: 9, fill: C2 });
    } else {
      for (var i = 0; i < rec.patch.length; i++) {
        var p = rec.patch[i];
        var ry = y0 + i * 26;
        s += G.rect(x0, ry, 240, 21, { r: 4, fill: p.type === '补孔' ? C.jadeL : C.clayL, stroke: p.type === '补孔' ? '#b9d8cb' : '#e6cdb2' });
        s += G.txt(x0 + 12, ry + 15, '段' + p.zone + ' ' + p.type, { size: 8.6, fill: C.ink2, weight: 700 });
        s += G.txt(x0 + 130, ry + 15, p.gain > 0 ? '↑' + f(p.gain, 0) + '%' : p.reason, { size: 8.4, fill: p.type === '补孔' ? C.jadeD : '#8a4f27' });
      }
    }

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '补孔的坑',
      ['· 数学最优',
       '  → 地质不合',
       '· 低效=补孔',
       '  → 需复核',
       '',
       '结合地质',
       '综合建议。'], 'jade');
    return { svg: s, stats: [{ k: '补孔', v: rec.nPatch + ' 段' }, { k: '复核', v: rec.nReview + ' 段' }], note: '对低效段给出补孔建议及增益估计，待复核段提示先验地质认识，避免"数学最优、地质不合理"。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
