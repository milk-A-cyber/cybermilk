/* =========================================================
   钻速预测与参数优化 · 算法解剖（时序回归 + 贝叶斯优化）
   ---------------------------------------------------------
   把「随钻参数 → 最优钻速」拆成 6 步，每一步都跑真代码：

     ① 数据接入      钻时序列 + 井段划分
     ② 时序特征      随钻参数 → 滑动窗口特征
     ③ 钻速预测      参数序列 → 钻速（时序回归）
     ④ 贝叶斯优化    参数空间找最优（兼顾风险）
     ⑤ 保守 vs 最优  钻速对比 + 风险可控
     ⑥ 部署与回流    方案 + 在线更新

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

  var N = 60, H = 200, x0 = 36, y0 = 150, W = 360, xS = W / N, yS = 180 / 22;

  function linePath(arr, x0, y0, color, dash) {
    var s = '<path d="M';
    for (var i = 0; i < N; i++) {
      s += (x0 + i * xS).toFixed(1) + ' ' + (y0 + H - arr[i] * yS).toFixed(1);
      if (i < N - 1) s += ' L';
    }
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (dash ? 1.8 : 2) + '"' + (dash ? ' stroke-dasharray="5 3"' : '') + '/>';
    return s;
  }

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

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.weight, L.nIter, L.selPar].join(',');
    if (cache.key === key) return cache;
    var seq = M.genDrill(N, 20261131);
    var pred = M.ropPredict(seq, L.weight);
    var ev = M.ropEval(seq, pred);
    var opt = M.bayesOptimize(40, 20261133);
    var cons = M.conservativeParams();
    var ropCons = M.ropModel(cons.wob, cons.rpm);
    var ropOpt = M.ropModel(opt.best.wob, opt.best.rpm);
    cache = { key: key, L: L, seq: seq, pred: pred, ev: ev, opt: opt, cons: cons, ropCons: ropCons, ropOpt: ropOpt };
    return cache;
  }

  /* =========================================================
     ① 数据接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), seq = c.seq, L = c.L;
    var s = '';
    s += G.panel(0, '① 钻时序列', '1—10s 采样', C.clay);
    s += G.panel(1, '② 井段划分', '地层/工况', C.blue);
    s += G.panel(2, '③ 参数+钻速', '对应记录', C.jade);

    var x0 = 30, y0 = 130;
    s += G.axes(x0, y0, 360, 180, { nx: 4, ny: 3 });
    s += linePath(seq.rop, x0, y0, '#2f7d6b', false);
    s += G.txt(x0, y0 - 12, '钻速时序（含地层分段趋势）', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(420, 170, 130, 176, '数据特点',
      ['· 1—10s 采样',
       '· 单井 10 万—100 万条',
       '· 钻压/转速/扭矩/排量',
       '',
       '缺省/毛刺要清洗，',
       '否则把毛刺当趋势学。'], 'clay');

    s += G.txt(x0, y0 + 190, '按地层/钻头工况分段，参数与钻速一一对应', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '采样', v: '1—10s' }, { k: '井段', v: '分段优化' }, { k: '规模', v: '10万—100万' }], note: '读入钻时序列，按地层与钻头工况划分井段。钻时序列有缺失与毛刺，不清洗会把毛刺当趋势学进去，预测跟着抖。' };
  }

  /* =========================================================
     ② 时序特征
     ========================================================= */
  function stage2(t) {
    var c = compute(), seq = c.seq, L = c.L;
    var s = '';
    s += G.panel(0, '① 随钻参数', '钻压/转速', C.blue);
    s += G.panel(1, '② 滑动窗口', '均值/方差/趋势', C.jade);
    s += G.panel(2, '③ 时序特征', '喂模型', C.clay);

    var x0 = 30, y0 = 130;
    /* 三条参数曲线 */
    var pars = [
      { name: '钻压', arr: seq.wob, c: '#41699b' },
      { name: '转速', arr: seq.rpm, c: '#8a4f27' },
      { name: '扭矩', arr: seq.tor, c: '#6b7a6b' }
    ];
    for (var a = 0; a < 3; a++) {
      var ay = y0 + a * 52;
      s += G.axes(x0, ay, 300, 42, { nx: 3, ny: 1 });
      s += linePath(pars[a].arr, x0, ay, pars[a].c, true);
      s += G.txt(x0 + 310, ay + 20, pars[a].name, { size: 8.5, fill: pars[a].c, weight: 700 });
    }
    s += G.txt(x0, y0 - 12, '随钻参数（钻压/转速/扭矩）', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(400, 190, 130, 176, '为什么滑动窗口',
      ['· 钻速靠过去一段驱动',
       '· 均值看水平、方差看抖动',
       '· 趋势看钻头磨损',
       '',
       '只看当前时刻会滞后，',
       '丢掉「钻头正在磨损」',
       '的趋势信息。'], 'blue');

    s += G.txt(x0, y0 + 170, '构造滑动窗口均值/方差/趋势特征 → 抓钻速时变规律', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '参数', v: '钻压/转速/扭矩' }, { k: '特征', v: '滑动窗口' }, { k: '目标', v: '抓时变' }], note: '从随钻参数构造时序特征（滑动窗口均值/方差/趋势、上一时刻钻速）。只看当前时刻丢掉钻头磨损的趋势信息，预测会滞后。' };
  }

  /* =========================================================
     ③ 钻速预测
     ========================================================= */
  function stage3(t) {
    var c = compute(), seq = c.seq, pred = c.pred, ev = c.ev, L = c.L;
    var s = '';
    s += G.panel(0, '① 输入层', '参数序列', C.blue);
    s += G.panel(1, '② 时序层', 'LSTM/Transformer', C.jade);
    s += G.panel(2, '③ 输出', '钻速', C.clay);

    var x0 = 30, y0 = 130;
    /* 网络结构 */
    var layers = [
      { x: x0, y: y0 + 20, w: 120, h: 120, c: C.blueL, label: '参数序列' },
      { x: x0 + 140, y: y0 + 40, w: 90, h: 80, c: C.jadeL, label: 'LSTM' },
      { x: x0 + 250, y: y0 + 40, w: 90, h: 80, c: C.jadeL, label: 'Dense' },
      { x: x0 + 360, y: y0 + 55, w: 90, h: 50, c: C.clayL, label: '钻速' }
    ];
    for (var i = 0; i < layers.length; i++) {
      var lx = layers[i].x, ly = layers[i].y;
      s += G.rect(lx, ly, layers[i].w, layers[i].h, { r: 8, fill: layers[i].c, stroke: i === 0 ? '#9fb5cf' : i === 3 ? '#d8a48c' : '#a7c6b8' });
      s += G.txt(lx + layers[i].w / 2, ly + layers[i].h / 2, layers[i].label, { size: 8.5, fill: C.ink2, anchor: 'middle' });
      if (i > 0) s += G.line(lx - 12, ly + layers[i].h / 2, lx - 4, ly + layers[i].h / 2, { stroke: '#9ba3a9', sw: 1 });
    }

    /* 右：拟合 */
    var rx = x0 + 470, ry = y0;
    s += G.axes(rx, ry, 130, 150, { nx: 2, ny: 2 });
    s += '<path d="M' + (rx + 10) + ' ' + (ry + 30) + ' C' + (rx + 40) + ' ' + (ry + 60) + ' ' + (rx + 60) + ' ' + (ry + 80) + ' ' + (rx + 110) + ' ' + (ry + 120) + '" fill="none" stroke="#2f7d6b" stroke-width="2"/>';
    s += '<path d="M' + (rx + 10) + ' ' + (ry + 36) + ' C' + (rx + 40) + ' ' + (ry + 64) + ' ' + (rx + 60) + ' ' + (ry + 76) + ' ' + (rx + 110) + ' ' + (ry + 122) + '" fill="none" stroke="#b26a39" stroke-width="1.6" stroke-dasharray="4 3"/>';
    s += G.txt(rx + 10, ry - 8, 'RMSE ' + f(ev.rmse, 2) + ' m/h', { size: 8.5, fill: C.ink3 });

    return { svg: s, stats: [{ k: 'RMSE', v: f(ev.rmse, 2) + ' m/h' }, { k: '相关系数', v: f(ev.corr, 2) }], note: '用时序回归（LSTM/Transformer）从随钻参数序列预测钻速，替代经验拍脑袋，为优化提供「钻速=函数(参数)」。只拟合训练井段，换地层/换钻头后分布漂移，预测会失准。' };
  }

  /* =========================================================
     ④ 贝叶斯优化
     ========================================================= */
  function stage4(t) {
    var c = compute(), opt = c.opt, L = c.L;
    var s = '';
    s += G.panel(0, '① 代理模型', '钻速=函数(参数)', C.jade);
    s += G.panel(1, '② 贝叶斯采样', '参数空间', C.blue);
    s += G.panel(2, '③ 最优参数', '钻速↑ 风险控', C.clay);

    var x0 = 30, y0 = 130;
    /* 参数空间热力图 + 优化轨迹 */
    var Wc = 44, Hc = 34, cell = 6;
    var wobMin = 5, wobMax = 14, rpmMin = 35, rpmMax = 75;
    for (var r = 0; r < Hc; r++) {
      for (var c2 = 0; c2 < Wc; c2++) {
        var wob = wobMin + (c2 / (Wc - 1)) * 9;
        var rpm = rpmMin + (r / (Hc - 1)) * 40;
        var m = M.ropModel(wob, rpm);
        var risk = m.risk;
        var col;
        if (risk > 4) col = 'rgb(180,96,86)';
        else col = 'rgb(' + Math.round(230 - m.rop / 22 * 130) + ',' + Math.round(90 + m.rop / 22 * 150) + ',' + Math.round(230 - m.rop / 22 * 120) + ')';
        s += G.rect(x0 + c2 * cell, y0 + r * cell, cell, cell, { fill: col, op: 1 });
      }
    }
    for (var i = 0; i < opt.trace.length; i++) {
      var t = opt.trace[i];
      var cx = x0 + ((t.wob - wobMin) / 9) * (Wc * cell);
      var cy = y0 + ((t.rpm - rpmMin) / 40) * (Hc * cell);
      s += G.circle(cx, cy, 2, { fill: 'none', stroke: '#24333a', sw: 1 });
    }
    var b = opt.best;
    var bx = x0 + ((b.wob - wobMin) / 9) * (Wc * cell);
    var by = y0 + ((b.rpm - rpmMin) / 40) * (Hc * cell);
    s += G.circle(bx, by, 4, { fill: '#24333a', stroke: '#fff', sw: 1.5 });
    s += G.txt(bx, by - 6, '最优', { size: 8, fill: '#24333a', anchor: 'middle', weight: 700 });
    s += G.txt(x0, y0 - 12, '参数空间热力图 + 贝叶斯优化轨迹', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + Hc * cell + 12, '红区 = 高风险（伤钻头）· 黑点 = 优化轨迹', { size: 8.5, fill: C.ink3 });

    return { svg: s, stats: [{ k: '最优钻压', v: f(b.wob, 1) }, { k: '最优转速', v: f(b.rpm, 0) }, { k: '钻速', v: f(b.rop, 1) + ' m/h' }], note: '用贝叶斯优化/代理模型在参数空间找最优钻压与转速，兼顾效率与风险。只优化钻速不考虑风险，会把参数推到伤钻头的高风险区。' };
  }

  /* =========================================================
     ⑤ 保守 vs 最优
     ========================================================= */
  function stage5(t) {
    var c = compute(), ropCons = c.ropCons, ropOpt = c.ropOpt, cons = c.cons, L = c.L;
    var s = '';
    s += G.panel(0, '① 保守参数', '宁慢勿坏', C.blue);
    s += G.panel(1, '② 最优参数', '预测最优', C.jade);
    s += G.panel(2, '③ 提升+风险', '可控', C.clay);

    var x0 = 40, y0 = 60, cw = 120, ch = 150;
    var maxRop = Math.max(ropCons.rop, ropOpt.rop, 1);
    var hCons = ropCons.rop / maxRop * ch;
    var hOpt = ropOpt.rop / maxRop * ch;
    s += G.axes(x0, y0, 340, ch + 20, { nx: 0, ny: 3 });
    s += G.rect(x0 + 20, y0 + ch - hCons, 100, hCons, { fill: '#41699b' });
    s += G.txt(x0 + 70, y0 + ch - hCons - 6, f(ropCons.rop, 1), { size: 10, fill: '#41699b', anchor: 'middle', weight: 700 });
    s += G.txt(x0 + 70, y0 + ch + 16, '保守参数', { size: 9, fill: '#41699b', anchor: 'middle' });
    s += G.rect(x0 + 190, y0 + ch - hOpt, 100, hOpt, { fill: '#2f7d6b' });
    s += G.txt(x0 + 240, y0 + ch - hOpt - 6, f(ropOpt.rop, 1), { size: 10, fill: '#2f7d6b', anchor: 'middle', weight: 700 });
    s += G.txt(x0 + 240, y0 + ch + 16, '最优参数', { size: 9, fill: '#2f7d6b', anchor: 'middle' });
    s += G.txt(x0 + 300, y0 + 20, '+' + Math.round((ropOpt.rop / ropCons.rop - 1) * 100) + '%', { size: 13, fill: C.clayD, weight: 700 });

    s += footBox(430, 160, 60, 150, '风险对比',
      ['· 保守钻压 ' + f(cons.wob, 1) + '、转速 ' + f(cons.rpm, 0),
       '· 最优钻压 ' + f(optBestWob(), 1) + '、转速 ' + f(optBestRpm(), 0),
       '',
       '提升钻速不能以废',
       '钻头为代价，要看',
       '风险段是否可控。'], 'clay');

    return { svg: s, stats: [{ k: '保守钻速', v: f(ropCons.rop, 1) + ' m/h' }, { k: '最优钻速', v: f(ropOpt.rop, 1) + ' m/h' }, { k: '提升', v: '+' + Math.round((ropOpt.rop / ropCons.rop - 1) * 100) + '%' }], note: '对比保守参数与最优参数的钻速与风险。提升只看钻速平均、不盯风险段，某个高风险井段提速可能引发卡钻。' };
  }

  /* =========================================================
     ⑥ 部署与回流
     ========================================================= */
  function stage6(t) {
    var c = compute(), ev = c.ev, opt = c.opt, b = opt.best, L = c.L;
    var s = '';
    s += G.panel(0, '① 最优参数方案', '按井段给', C.blue);
    s += G.panel(1, '② 人工确认', '工程师审核', C.clay);
    s += G.panel(2, '③ 在线更新', '随钻回流', C.jade);

    var x0 = 30, y0 = 130;
    /* 方案清单 */
    var rows = [
      ['一开井段', '钻压 ' + f(b.wob, 1) + ' / 转速 ' + f(b.rpm, 0), 'ok'],
      ['二开井段', '待在线更新', '复查'],
      ['三开井段', '按地层重估', '复查'],
      ['风险井段', '降速保安全', 'ok']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 30;
      s += G.rect(x0, ry, 360, 24, { r: 4, fill: rows[r][2] === 'ok' ? C.jadeL : C.clayL, stroke: rows[r][2] === 'ok' ? '#b9d8cb' : '#e6cdb2' });
      s += G.txt(x0 + 12, ry + 16, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(x0 + 110, ry + 16, rows[r][1], { size: 8.8, fill: rows[r][2] === 'ok' ? C.jadeD : '#8a4f27' });
      s += G.txt(x0 + 320, ry + 16, rows[r][2], { size: 8.8, fill: rows[r][2] === 'ok' ? C.jadeD : '#8a4f27', weight: 700 });
    }
    s += G.txt(x0, y0 - 12, '按井段的钻井参数方案清单', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(420, 170, 130, 176, '在线更新的价值',
      ['· 随钻数据回流模型',
       '· 强化学习随钻更新策略',
       '· 新井段更快适应',
       '· 地层变参数跟着变',
       '',
       '预测 RMSE ' + f(ev.rmse, 2),
       '无在线更新 → 地层一变',
       '最优参数立刻过期。'], 'jade');

    s += G.txt(x0, y0 + 140, '产出：按井段最优参数 + 风险标注 → 钻井方案 + 随钻回流', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '预测 RMSE', v: f(ev.rmse, 2) + ' m/h' }, { k: '产出', v: '最优参数方案' }], note: '工程师按最优参数制定钻井方案；随钻数据反馈回模型，强化学习随钻更新策略。方案上线后没有在线更新，地层一变最优参数立刻过期。' };
  }

  function optBestWob() { return compute().opt.best.wob; }
  function optBestRpm() { return compute().opt.best.rpm; }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
