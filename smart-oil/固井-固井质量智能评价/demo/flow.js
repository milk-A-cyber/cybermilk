/* =========================================================
   固井质量智能评价 · 算法解剖（胶结指数基线 + 波形分段分类）
   ---------------------------------------------------------
   把「CBL/VDL → 胶结等级」拆成 6 步，每一步都跑真代码：

     ① CBL/VDL 接入  波形 + 胶结指数
     ② 胶结指数基线  固定阈值分级
     ③ 波形特征提取  套管波 + 地层波
     ④ 分段分类      胶结等级曲线
     ⑤ 验窜验证      挤水泥/试压对照
     ⑥ 回流          评级结果回流

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

  function line(arr, x0, y0, xS, yS, color, dash) {
    var s = '<path d="M';
    for (var i = 0; i < arr.length; i++) {
      s += (x0 + i * xS).toFixed(1) + ' ' + (y0 - arr[i] * yS).toFixed(1);
      if (i < arr.length - 1) s += ' L';
    }
    s += '" fill="none" stroke="' + color + '" stroke-width="' + (dash ? 1.6 : 2) + '"' + (dash ? ' stroke-dasharray="5 3"' : '') + '/>';
    return s;
  }

  var N = 120;
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.xthr, L.imode].join(',');
    if (cache.key === key) return cache;
    var d = M.genCement(N, 20261211);
    var ev = M.cementEval(d, L.xthr);
    var s0 = M.segClassify(d, 0);
    var s1 = M.segClassify(d, 1);
    cache = { key: key, L: L, d: d, ev: ev, s0: s0, s1: s1 };
    return cache;
  }

  /* =========================================================
     ① CBL/VDL 接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), d = c.d;
    var s = '';
    s += G.panel(0, '① CBL', '套管波幅度', C.blue);
    s += G.panel(1, '② VDL', '地层波强度', C.clay);
    s += G.panel(2, '③ 胶结指数', 'BI 0-1', C.jade);

    var y0 = 130, h = 110;
    s += G.txt(G.COLS[0].x + 14, y0 - 22, 'CBL/VDL 测井 · 全井段约 0.5 m 一点', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(G.COLS[0].x + 14, y0, 240, h, { nx: 4, ny: 3 });
    s += line(d.cbl, G.COLS[0].x + 14, y0 + h, 240 / N, h, C1, false);
    s += line(d.vdl, G.COLS[0].x + 14, y0 + h, 240 / N, h, C0, false);
    s += G.txt(G.COLS[0].x + 20, y0 - 2, '套管波', { size: 7.5, fill: C1 });
    s += G.txt(G.COLS[0].x + 100, y0 - 2, '地层波', { size: 7.5, fill: C0 });
    s += G.txt(G.COLS[0].x + 14, y0 + h + 22, '胶结好→套管波弱、地层波强', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '要评价的数据',
      ['· CBL/VDL 全井段',
       '· 人工评级段 100—300 段',
       '· 施工/验窜记录',
       '',
       '单井数十幅图，',
       '人工分段评级需 1—2h。'], 'clay');
    return { svg: s, stats: [{ k: '层点', v: N }, { k: '等级', v: M.GRADES.length + ' 级' }], note: '读入 CBL/VDL 测井（全井段约 0.5 m 一点）与人工评级段、施工记录、后续验窜结果。单井图数十幅，人工分段评级需 1—2 小时。' };
  }

  /* =========================================================
     ② 胶结指数基线
     ========================================================= */
  function stage2(t) {
    var c = compute(), d = c.d, ev = c.ev, L = c.L;
    var s = '';
    s += G.panel(0, '① 胶结指数', 'BI', C.blue);
    s += G.panel(1, '② 固定阈值', '分级', C.jade);
    s += G.panel(2, '③ 基线', 'Acc=' + f(ev.acc), C.clay);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '胶结指数基线 · Acc=' + f(ev.acc) + ' · 判错 ' + ev.errs.length, { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    s += line(d.bi, x0, y0 + h, xw / N, h, C0, false);
    for (var i = 0; i < d.n; i++) {
      if (ev.pred[i] !== d.grade[i]) s += G.circle(x0 + i * xw / N, y0 + h - d.bi[i] * h, 2.8, { fill: 'none', stroke: '#b05a51', sw: 1.3 });
    }
    s += G.txt(x0, y0 + h + 22, '红圈=固定阈值判错', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '固定阈值的坑',
      ['· 评级标准有主观带',
       '  → 边界难定',
       '· 快速地层/微环隙',
       '  → 易误判',
       '',
       '波形分段分类',
       '更稳更准。'], 'jade');
    return { svg: s, stats: [{ k: 'Acc', v: f(ev.acc) }, { k: '判错', v: ev.errs.length }], note: '胶结指数固定阈值分级。评级标准存在主观带，快速地层、微环隙等特殊情况易误判，且评级结果直接关系挤水泥决策。' };
  }

  /* =========================================================
     ③ 波形特征提取
     ========================================================= */
  function stage3(t) {
    var c = compute(), d = c.d;
    var s = '';
    s += G.panel(0, '① 套管波', '幅度', C.blue);
    s += G.panel(1, '② 地层波', '强度', C.clay);
    s += G.panel(2, '③ 波形特征', '融合', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '波形特征提取 · 套管波 + 地层波', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    s += line(d.cbl, x0, y0 + h, xw / N, h, C1, false);
    s += line(d.vdl, x0, y0 + h, xw / N, h, C0, false);
    s += G.txt(x0, y0 + h + 22, '胶结好→套管波弱、地层波强', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '特征提取的坑',
      ['· 单看套管波',
       '  → 信息有限',
       '· 特殊井况',
       '  → 干扰',
       '',
       '双波融合，',
       '更稳。'], 'jade');
    return { svg: s, stats: [{ k: '套管波', v: '幅度' }, { k: '地层波', v: '强度' }], note: '提取套管波幅度与地层波强度波形特征。单看套管波信息有限，双波融合更稳。' };
  }

  /* =========================================================
     ④ 分段分类
     ========================================================= */
  function stage4(t) {
    var c = compute(), d = c.d, L = c.L;
    var s = L.imode === 0 ? c.s0 : c.s1;
    var s2 = '';
    s2 += G.panel(0, '① 波形', '特征', C.blue);
    s2 += G.panel(1, '② 分段分类', '胶结等级', C.jade);
    s2 += G.panel(2, '③ 结果', 'Acc=' + f(s.acc), C.clay);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s2 += G.txt(x0, y0 - 22, '分段分类 · ' + (L.imode === 0 ? '单特征' : '多特征融合') + ' · Acc=' + f(s.acc), { size: 9.5, fill: C.ink2, weight: 700 });
    s2 += G.axes(x0, y0, xw, h, { nx: 4, ny: 3 });
    s2 += line(d.vdl, x0, y0 + h, xw / N, h, C0, false);
    for (var i = 0; i < d.n; i++) {
      if (s.pred[i] !== d.grade[i]) s2 += G.rect(x0 + i * xw / N, y0, xw / N + 0.4, h, { r: 0, fill: 'none', stroke: '#b05a51', sw: 1.1 });
    }
    s2 += G.txt(x0, y0 + h + 22, '红边=判错待验窜复核', { size: 8.5, fill: C.ink3 });

    s2 += footBox(G.COLS[2].x + 14, 250, y0, 170, '分段分类的坑',
      ['· 评级标准主观',
       '  → 边界难定',
       '· 特殊井况误判',
       '',
       '验窜验证，',
       '复核修正。'], 'jade');
    return { svg: s2, stats: [{ k: 'Acc', v: f(s.acc) }, { k: '判错', v: s.errs.length }], note: '波形分段分类输出胶结等级曲线。评级标准主观、特殊井况易误判，需验窜验证复核。' };
  }

  /* =========================================================
     ⑤ 验窜验证
     ========================================================= */
  function stage5(t) {
    var c = compute(), d = c.d, s1 = c.s1;
    var s = '';
    s += G.panel(0, '① 评级结果', '胶结等级', C.blue);
    s += G.panel(1, '② 验窜对照', '挤水泥/试压', C.clay);
    s += G.panel(2, '③ 复核清单', '判错 ' + s1.errs.length, C.jade);

    var y0 = 130, h = 110;
    var shown = 0;
    s1.errs.forEach(function (e) {
      if (shown < 6) {
        var ry = y0 + shown * 18;
        s += G.txt(G.COLS[0].x + 14, ry + 10, '#' + e.idx + ' · 判' + e.pred + ' 应' + e.truth, { size: 8.5, fill: '#b05a51' });
        shown++;
      }
    });
    if (!shown) s += G.txt(G.COLS[0].x + 14, y0 + 10, '无判错，评级可信', { size: 8.5, fill: C.jadeD });
    s += G.txt(G.COLS[0].x + 14, y0 - 18, '验窜验证清单', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '验证的坑',
      ['· 验窜不回流',
       '  → 模型不知判错',
       '· 特殊井况永远误差',
       '',
       '验窜结果回流，',
       '评级越用越准。'], 'clay');
    return { svg: s, stats: [{ k: '判错', v: s1.errs.length + ' 点' }, { k: '待复核', v: Math.min(shown, 6) }], note: '评级结果与后续验窜结果（挤水泥/试压）对照。验窜不回流，模型不知道判错在哪，特殊井况永远误差。' };
  }

  /* =========================================================
     ⑥ 回流
     ========================================================= */
  function stage6(t) {
    var c = compute(), s1 = c.s1;
    var s = '';
    s += G.panel(0, '① 评级建议', '模型输出', C.blue);
    s += G.panel(1, '② 验窜回流', '确认修正', C.clay);
    s += G.panel(2, '③ 越评越准', '回流闭环', C.jade);

    var y0 = 130, h = 110;
    var rows = [
      ['评级建议', '模型', '复核'],
      ['验窜确认', '人工', '修正'],
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
       '  → 数据不增，一直判错',
       '· 无法越评越准',
       '',
       '验窜结果回流，',
       '评级持续变准。'], 'jade');
    return { svg: s, stats: [{ k: '判错', v: s1.errs.length + ' 点' }, { k: '回流', v: '已闭环' }], note: '验窜结果回流训练集，评级模型越用越准、特殊井况识别持续改善。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
