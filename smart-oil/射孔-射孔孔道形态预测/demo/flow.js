/* =========================================================
   射孔孔道形态预测 · 算法解剖（数值模拟 + 代理模型 + 标定）
   ---------------------------------------------------------
   把「孔道形态预测」拆成 6 步，每一步都跑真代码：

     ① 数值模拟  批量生成训练集
     ② 训练代理   kNN 插值
     ③ 快速预测   穿深/孔径/清洁度
     ④ 靶试实测   少量真值
     ⑤ 仿真—实测标定   scale
     ⑥ 标定后预测   贴近实测

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
    var key = [L.charge, L.target, L.typeIdx].join(',');
    if (cache.key === key) return cache;
    var data = M.genSim(20261106, 60);
    var proxy = M.trainProxy(data, 5);
    var truth = M.genTruth(20261106, 4);
    var cal = M.calibrate(proxy, truth);
    var pred = M.predictShape(proxy, cal, L.typeIdx, L.charge, L.target);
    cache = { key: key, data: data, proxy: proxy, truth: truth, cal: cal, pred: pred };
    return cache;
  }

  /* =========================================================
     ① 数值模拟
     ========================================================= */
  function stage1(t) {
    var c = compute(), data = c.data;
    var s = '';
    s += G.panel(0, '① 训练集', data.n + ' 组', C.blue);
    s += G.panel(1, '② 参数', '弹型/药量/靶件', C.clay);
    s += G.panel(2, '③ 真值', '穿深/孔径', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '数值模拟 · 批量生成', { size: 9.5, fill: C.ink2, weight: 700 });
    var tcol = ['#41699b', '#b26a39', '#2f7d6b'];
    for (var i = 0; i < data.rows.length; i++) {
      var r = data.rows[i];
      s += G.circle(x0 + ((r.target - 0.4) / 0.6) * xw, y0 + h - ((r.depth - 30) / 150) * h, 3.2, { fill: tcol[r.type], stroke: 'none', opacity: 0.85 });
    }
    s += G.txt(x0, y0 + h + 20, '蓝=聚能 橙=大孔径 绿=深穿透', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '模拟的坑',
      ['· 单次仿真',
       '  → 耗时长',
       '· 设计阶段',
       '  → 无法快比',
       '',
       '代理模型',
       '快速替代。'], 'clay');
    return { svg: s, stats: [{ k: '训练集', v: data.n + ' 组' }, { k: '真值', v: '穿深/孔径' }], note: '数值模拟批量生成训练集（弹型/药量/靶件强度 → 穿深/孔径/清洁度）。单次仿真耗时长，无法在设计阶段快速比较方案。' };
  }

  /* =========================================================
     ② 训练代理
     ========================================================= */
  function stage2(t) {
    var c = compute(), data = c.data;
    var s = '';
    s += G.panel(0, '① 训练', 'kNN插值', C.blue);
    s += G.panel(1, '② 样本', data.n + ' 组', C.clay);
    s += G.panel(2, '③ 查询', 'O(1) 预测', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '训练代理模型 · kNN 插值', { size: 9.5, fill: C.ink2, weight: 700 });
    /* 网格插值面 */
    for (var gy = 0; gy < 6; gy++) {
      for (var gx = 0; gx < 8; gx++) {
        var tg = 0.4 + (gx / 7) * 0.6, ch = 0.5 + (gy / 5) * 1.2;
        var gp = c.proxy.predict(0, ch, tg);
        var level = Math.max(0, Math.min(1, (gp.depth - 40) / 150));
        s += G.rect(x0 + gx * xw / 8, y0 + gy * h / 6, xw / 8 + 0.5, h / 6 + 0.5, { fill: 'rgba(65,105,155,' + (0.12 + 0.55 * level).toFixed(2) + ')', stroke: 'none' });
      }
    }
    s += G.txt(x0, y0 + h + 20, '颜色=穿深 · 训练后逐点快查', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '代理的坑',
      ['· 样本稀疏',
       '  → 插值偏差',
       '· 过拟合',
       '  → 泛化差',
       '',
       'kNN 加权',
       '平滑插值。'], 'jade');
    return { svg: s, stats: [{ k: '算法', v: 'kNN插值' }, { k: '预测', v: '毫秒级' }], note: '在训练集上训练代理模型（k近邻加权插值），可对任意参数组合快速预测孔道形态，替代逐方案仿真。' };
  }

  /* =========================================================
     ③ 快速预测
     ========================================================= */
  function stage3(t) {
    var c = compute(), pred = c.pred, L = c; 
    var s = '';
    s += G.panel(0, '① 穿深', f(pred.depth, 1) + 'mm', C.blue);
    s += G.panel(1, '② 孔径', f(pred.dia, 1) + 'mm', C.clay);
    s += G.panel(2, '③ 清洁度', f(pred.clean), C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14;
    var rows = [
      ['穿深', f(pred.depth, 1) + ' mm'],
      ['孔径', f(pred.dia, 1) + ' mm'],
      ['清洁度', f(pred.clean)],
      ['药量', f(pred.charge) + ' g'],
      ['靶件强度', f(pred.target)]
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 22;
      s += G.rect(x0, ry, 240, 18, { r: 4, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(x0 + 12, ry + 13, rows[r][0], { size: 8.6, fill: C.ink2 });
      s += G.txt(x0 + 190, ry + 13, rows[r][1], { size: 8.6, fill: C.jadeD, weight: 700 });
    }
    s += G.txt(x0, y0 - 20, '快速预测 · 孔道形态', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '预测的坑',
      ['· 仿真实测',
       '  → 有差距',
       '· 直接套用',
       '  → 会偏',
       '',
       '靶试真值',
       '标定修正。'], 'jade');
    return { svg: s, stats: [{ k: '穿深', v: f(pred.depth, 1) + 'mm' }, { k: '孔径', v: f(pred.dia, 1) + 'mm' }], note: '代理模型对任意参数组合秒级给出穿深/孔径/清洁度预测，供设计阶段快速比较。' };
  }

  /* =========================================================
     ④ 靶试实测
     ========================================================= */
  function stage4(t) {
    var c = compute(), truth = c.truth;
    var s = '';
    s += G.panel(0, '① 靶试', truth.length + ' 点', C.blue);
    s += G.panel(1, '② 成本', '高', C.clay);
    s += G.panel(2, '③ 用途', '标定真值', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '靶试实测 · 少量真值', { size: 9.5, fill: C.ink2, weight: 700 });
    for (var ti = 0; ti < truth.length; ti++) {
      var t = truth[ti];
      var by = y0 + ti * 28;
      s += G.txt(x0, by, M.TYPES[t.type], { size: 8.6, fill: C.ink2 });
      s += G.txt(x0 + 120, by, '穿深 ' + f(t.depth) + 'mm', { size: 8.4, fill: C.ink3 });
    }
    s += G.txt(x0, y0 + h + 8, '靶试成本高，样本少（4 点）', { size: 8.5, fill: CR });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '靶试的坑',
      ['· 真值金标准',
       '  → 样本太少',
       '· 单点贵',
       '  → 不能大量',
       '',
       '少量真值',
       '标定仿真。'], 'clay');
    return { svg: s, stats: [{ k: '靶试', v: truth.length + ' 点' }, { k: '成本', v: '高' }], note: '靶试实测给出少量真值（穿深/孔径），成本高、样本少，只能用于标定而非训练。' };
  }

  /* =========================================================
     ⑤ 仿真—实测标定
     ========================================================= */
  function stage5(t) {
    var c = compute(), cal = c.cal, truth = c.truth;
    var s = '';
    s += G.panel(0, '① 标定系数', '×' + f(cal.scale, 3), C.blue);
    s += G.panel(1, '② 真值点', cal.nTruth + ' 个', C.clay);
    s += G.panel(2, '③ 方向', '仿真偏乐观', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '仿真—实测标定', { size: 9.5, fill: C.ink2, weight: 700 });
    /* 原始预测 vs 实测 比值条形 */
    for (var ti = 0; ti < truth.length; ti++) {
      var t = truth[ti];
      var tp = c.proxy.predict(t.type, t.charge, t.target);
      var by = y0 + ti * 30;
      s += G.txt(x0, by + 8, '#' + (ti + 1), { size: 8.2, fill: C.ink3 });
      s += G.rect(x0 + 30, by, tp.depth * 1.0, 8, { fill: '#b9c6d6', stroke: 'none' });
      s += G.rect(x0 + 30, by + 11, t.depth * 1.0, 8, { fill: C0, stroke: 'none' });
      s += G.txt(x0 + 30 + Math.max(tp.depth, t.depth) + 4, by + 8, f(tp.depth) + '/' + f(t.depth), { size: 7.6, fill: C.ink3 });
    }
    s += G.txt(x0, y0 + h + 16, '灰=原始预测 蓝=实测', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '标定的坑',
      ['· 直接套仿真',
       '  → 偏乐观',
       '· 真值少',
       '  → 系数粗',
       '',
       'scale 修正',
       '贴近实测。'], 'clay');
    return { svg: s, stats: [{ k: '标定系数', v: '×' + f(cal.scale, 3) }, { k: '真值', v: cal.nTruth + ' 点' }], note: '用靶试实测与代理预测对比，拟合线性标定系数，修正仿真到实际的系统偏差。' };
  }

  /* =========================================================
     ⑥ 标定后预测
     ========================================================= */
  function stage6(t) {
    var c = compute(), pred = c.pred;
    var s = '';
    s += G.panel(0, '① 穿深', f(pred.depth, 1) + 'mm', C.blue);
    s += G.panel(1, '② 孔径', f(pred.dia, 1) + 'mm', C.clay);
    s += G.panel(2, '③ 标定', '已修正', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14;
    var rows = [
      ['穿深(标定后)', f(pred.depth, 1) + ' mm'],
      ['孔径(标定后)', f(pred.dia, 1) + ' mm'],
      ['清洁度', f(pred.clean)],
      ['原始穿深', f(pred.rawDepth, 1) + ' mm'],
      ['标定系数', '×' + f(c.cal.scale, 3)]
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 22;
      s += G.rect(x0, ry, 240, 18, { r: 4, fill: C.clayL, stroke: '#e6cdb2' });
      s += G.txt(x0 + 12, ry + 13, rows[r][0], { size: 8.6, fill: C.ink2 });
      s += G.txt(x0 + 190, ry + 13, rows[r][1], { size: 8.6, fill: '#8a4f27', weight: 700 });
    }
    s += G.txt(x0, y0 - 20, '标定后预测 · 贴近实测', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '交付的坑',
      ['· 不标定',
       '  → 方案偏差',
       '· 标定粗',
       '  → 继续采真值',
       '',
       '代理+标定',
       '越算越准。'], 'jade');
    return { svg: s, stats: [{ k: '穿深', v: f(pred.depth, 1) + 'mm' }, { k: '孔径', v: f(pred.dia, 1) + 'mm' }], note: '标定后代理模型给出的孔道形态更贴近靶试实测，可用于设计阶段的方案快速比较。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
