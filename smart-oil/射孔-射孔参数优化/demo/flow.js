/* =========================================================
   射孔参数优化 · 算法解剖（实验设计 + 代理模型 + 多目标优化）
   ---------------------------------------------------------
   把「射孔参数优化」拆成 6 步，每一步都跑真代码：

     ① 储层接入  强度/应力/渗透率
     ② 参数空间  孔密/相位/穿深
     ③ 实验设计  采样替代全枚举
     ④ 代理模型  产能/出砂
     ⑤ 多目标优化  帕累托
     ⑥ 推荐方案  参数组合

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
    var key = [L.strength, L.samples].join(',');
    if (cache.key === key) return cache;
    var rk = { strength: L.strength, seed: 20261105 };
    var samples = B.doeSample(rk, L.samples);
    var opt = B.optRecommend(rk, samples);
    cache = { key: key, rk: rk, samples: samples, opt: opt };
    return cache;
  }

  /* =========================================================
     ① 储层接入
     ========================================================= */
  function stage1(t) {
    var L = compute().rk;
    var s = '';
    s += G.panel(0, '① 强度', f(L.strength), C.blue);
    s += G.panel(1, '② 应力', '35 MPa', C.clay);
    s += G.panel(2, '③ 渗透率', '250 mD', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '储层接入 · 力学参数', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + 12, '储层强度 ' + f(L.strength), { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 34, '地应力 35 MPa', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 56, '渗透率 250 mD', { size: 8.8, fill: C.ink2 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '为什么难',
      ['· 参数空间大',
       '  → 全枚举贵',
       '· 效果反馈慢',
       '  → 试错周期长',
       '',
       '需实验设计',
       '+ 代理模型。'], 'clay');
    return { svg: s, stats: [{ k: '强度', v: f(L.strength) }, { k: '参数', v: '孔密/相位/穿深' }], note: '读入储层力学参数（应力、强度、渗透率）。射孔参数空间大，不同储层用同一套参数产能损失无法量化。' };
  }

  /* =========================================================
     ② 参数空间
     ========================================================= */
  function stage2(t) {
    var s = '';
    s += G.panel(0, '① 孔密', '8-24', C.blue);
    s += G.panel(1, '② 相位', '0-180°', C.clay);
    s += G.panel(2, '③ 穿深', '0.3-1.2m', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '参数空间', { size: 9.5, fill: C.ink2, weight: 700 });
    var rows = [
      ['孔密', '8 / 12 / 16 / 20 / 24 孔/m'],
      ['相位', '0 / 60 / 90 / 120 / 180 °'],
      ['穿深', '0.3 / 0.5 / 0.8 / 1.0 / 1.2 m']
    ];
    for (var i = 0; i < rows.length; i++) {
      var ry = y0 + i * 32;
      s += G.txt(x0, ry, rows[i][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(x0 + 64, ry, rows[i][1], { size: 8.4, fill: C.ink3 });
    }

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '空间的坑',
      ['· 5×5×5=125',
       '  → 全枚举贵',
       '· 标准设计',
       '  → 产能损失',
       '',
       '实验设计',
       '少点覆盖。'], 'jade');
    return { svg: s, stats: [{ k: '孔密', v: '8-24' }, { k: '组合', v: '125 全枚举' }], note: '射孔参数（孔密、相位、穿深）空间大，现场多沿用标准设计，不同储层用同一套参数产能损失无法量化。' };
  }

  /* =========================================================
     ③ 实验设计
     ========================================================= */
  function stage3(t) {
    var c = compute(), samples = c.samples, opt = c.opt;
    var s = '';
    s += G.panel(0, '① 采样', opt.nSample + ' 点', C.blue);
    s += G.panel(1, '② 全枚举', opt.nAll + ' 点', C.clay);
    s += G.panel(2, '③ 节省', f((1 - opt.nSample / opt.nAll) * 100, 0) + '%', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '实验设计 · 采样覆盖', { size: 9.5, fill: C.ink2, weight: 700 });
    var cw = 220 / 4, ch2 = 90 / 4;
    for (var di = 0; di <= 4; di++) {
      s += G.line(x0 + di * cw, y0, x0 + di * cw, y0 + 90, { stroke: '#e8ecef', sw: 1 });
      s += G.line(x0, y0 + di * ch2, x0 + 220, y0 + di * ch2, { stroke: '#e8ecef', sw: 1 });
    }
    for (var ai = 0; ai < opt.all.length; ai++) {
      var ap = opt.all[ai];
      s += G.circle(x0 + (M.DENSITY.indexOf(ap.density) / 4) * 220, y0 + (M.DEPTHS.indexOf(ap.depth) / 4) * 90, 2, { fill: '#d5dde4', stroke: 'none' });
    }
    for (var si = 0; si < samples.length; si++) {
      var sp = samples[si];
      s += G.circle(x0 + (M.DENSITY.indexOf(sp.density) / 4) * 220, y0 + (M.DEPTHS.indexOf(sp.depth) / 4) * 90, 4.5, { fill: C2, stroke: '#fff', sw: 1.5 });
    }
    s += G.txt(x0, y0 + h + 20, '灰=全枚举 绿=DOE采样', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '采样的坑',
      ['· 随机点',
       '  → 聚团覆盖差',
       '· 全枚举',
       '  → 仿真贵',
       '',
       '拉丁超立方',
       '均匀覆盖。'], 'jade');
    return { svg: s, stats: [{ k: '采样', v: opt.nSample + ' 点' }, { k: '全枚举', v: opt.nAll + ' 点' }], note: '用实验设计（DOE）采样代替全枚举，用少量均匀覆盖参数空间的点逼近全局优化，减少仿真次数。' };
  }

  /* =========================================================
     ④ 代理模型
     ========================================================= */
  function stage4(t) {
    var c = compute(), opt = c.opt;
    var s = '';
    s += G.panel(0, '① 产能', '随穿深↑', C.blue);
    s += G.panel(1, '② 出砂', '随穿深↑', C.clay);
    s += G.panel(2, '③ 相位', '90°最优', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '代理模型 · 产能/出砂', { size: 9.5, fill: C.ink2, weight: 700 });
    var qs = [], rs = [];
    for (var i = 0; i < M.DEPTHS.length; i++) {
      var p = B.proxyModel(c.rk, { density: 12, phase: 90, depth: M.DEPTHS[i] });
      qs.push(p.q / 60);
      rs.push(p.risk);
    }
    s += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    var qline = '<path d="M';
    for (var qj = 0; qj < qs.length; qj++) {
      qline += (x0 + qj * xw / (qs.length - 1)).toFixed(1) + ' ' + (y0 + h - qs[qj] * h).toFixed(1);
      if (qj < qs.length - 1) qline += ' L';
    }
    qline += '" fill="none" stroke="' + C0 + '" stroke-width="2"/>';
    s += qline;
    var rline = '<path d="M';
    for (var rj = 0; rj < rs.length; rj++) {
      rline += (x0 + rj * xw / (rs.length - 1)).toFixed(1) + ' ' + (y0 + h - rs[rj] * h).toFixed(1);
      if (rj < rs.length - 1) rline += ' L';
    }
    rline += '" fill="none" stroke="' + CR + '" stroke-width="1.6" stroke-dasharray="5 3"/>';
    s += rline;
    s += G.txt(x0, y0 + h + 20, '穿深 ↑  蓝=产能 红=出砂', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '代理的坑',
      ['· 产能↑',
       '  → 出砂也↑',
       '· 纯数据',
       '  → 样本不足',
       '',
       '物理模型',
       '作代理。'], 'jade');
    return { svg: s, stats: [{ k: '产能', v: '随穿深↑' }, { k: '出砂', v: '随穿深↑' }], note: '用代理模型评估采样点的产能与出砂风险。产能随穿深与孔密上升，出砂风险也随之上升。' };
  }

  /* =========================================================
     ⑤ 多目标优化
     ========================================================= */
  function stage5(t) {
    var c = compute(), opt = c.opt;
    var s = '';
    s += G.panel(0, '① 采样前沿', opt.front.length + ' 点', C.blue);
    s += G.panel(1, '② 全局前沿', opt.gFront.length + ' 点', C.clay);
    s += G.panel(2, '③ 逼近', '差距小', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '多目标优化 · 帕累托', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    for (var ei = 0; ei < opt.evaled.length; ei++) {
      var ep = opt.evaled[ei];
      s += G.circle(x0 + ep.risk * xw, y0 + h - ep.q / 60 * h, 3, { fill: '#c9d4df', stroke: 'none' });
    }
    var gpath = 'M';
    for (var gfi = 0; gfi < opt.gFront.length; gfi++) {
      var gp = opt.gFront[gfi];
      gpath += (x0 + gp.risk * xw).toFixed(1) + ' ' + (y0 + h - gp.q / 60 * h).toFixed(1);
      if (gfi < opt.gFront.length - 1) gpath += ' L';
    }
    s += '<path d="' + gpath + '" fill="none" stroke="#8aa3c0" stroke-width="1.6" stroke-dasharray="5 3"/>';
    for (var fi = 0; fi < opt.front.length; fi++) {
      var fp = opt.front[fi];
      s += G.circle(x0 + fp.risk * xw, y0 + h - fp.q / 60 * h, 5, { fill: C2, stroke: 'none' });
    }
    s += G.txt(x0, y0 + h + 20, '绿=采样前沿 蓝虚线=全局', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '优化的坑',
      ['· 只求单目标',
       '  → 出砂失控',
       '· 采样太稀',
       '  → 前沿偏差',
       '',
       'DOE 采样',
       '逼近全局。'], 'jade');
    return { svg: s, stats: [{ k: '采样前沿', v: opt.front.length + ' 点' }, { k: '全局前沿', v: opt.gFront.length + ' 点' }], note: '对采样点做多目标优化，找帕累托前沿（产能↑出砂↓）。采样前沿应逼近全局前沿。' };
  }

  /* =========================================================
     ⑥ 推荐方案
     ========================================================= */
  function stage6(t) {
    var c = compute(), opt = c.opt;
    var s = '';
    s += G.panel(0, '① 孔密', opt.rec.density + ' 孔', C.blue);
    s += G.panel(1, '② 相位', opt.rec.phase + '°', C.clay);
    s += G.panel(2, '③ 穿深', f(opt.rec.depth) + 'm', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14;
    var rows = [
      ['孔密', opt.rec.density + ' 孔/m'],
      ['相位', opt.rec.phase + ' °'],
      ['穿深', f(opt.rec.depth) + ' m'],
      ['产能', f(opt.rec.q, 1)],
      ['出砂', f(opt.rec.risk)]
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 24;
      s += G.rect(x0, ry, 240, 20, { r: 4, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(x0 + 12, ry + 14, rows[r][0], { size: 8.6, fill: C.ink2 });
      s += G.txt(x0 + 190, ry + 14, rows[r][1], { size: 8.6, fill: C.jadeD, weight: 700 });
    }
    s += G.txt(x0, y0 - 20, '推荐方案 · DOE采样', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '推荐的坑',
      ['· 只给单点',
       '  → 无法权衡',
       '· 采样偏差',
       '  → 略偏全局',
       '',
       '方案+前沿',
       '越算越准。'], 'jade');
    return { svg: s, stats: [{ k: '孔密', v: opt.rec.density + ' 孔/m' }, { k: '相位', v: opt.rec.phase + '°' }, { k: '产能', v: f(opt.rec.q, 1) }], note: '输出帕累托方案集与推荐参数，产能与出砂在方案间权衡。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
