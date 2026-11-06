/* =========================================================
   套管居中度智能评估 · 算法解剖（几何计算 + 组合优化）
   ---------------------------------------------------------
   把「套管居中度评估」拆成 6 步，每一步都跑真代码：

     ① 井段接入  井径 + 井斜
     ② 居中度计算  几何
     ③ 无扶正基线  偏心
     ④ 扶正器安放  组合优化
     ⑤ 居中度改善  对比
     ⑥ CBL 验证  评级回流

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
    var key = L.spacing;
    if (cache.key === key) return cache;
    var casing = M.genCasingGeo(120, 20261241);
    var opt = M.centralizerOpt(casing, L.spacing);
    var ev = M.standoffEval(casing, opt.positions);
    cache = { key: key, L: L, casing: casing, opt: opt, ev: ev };
    return cache;
  }

  /* =========================================================
     ① 井段接入
     ========================================================= */
  function stage1(t) {
    var c = compute(), cs = c.casing;
    var s = '';
    s += G.panel(0, '① 井径', 'mm', C.blue);
    s += G.panel(1, '② 井斜', '°', C.clay);
    s += G.panel(2, '③ 套管', 'Dc ' + f(M.DC, 0) + 'mm', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '井段接入 · 全井 ' + cs.n + ' 段', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + 10, '井径 井径起伏', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 30, '井斜 含狗腿', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 50, '缩径段 ' + cs.shrinks.length + ' 处', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 70, '狗腿段 ' + cs.dogs.length + ' 处', { size: 8.8, fill: C.ink2 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '为什么难',
      ['· 居中度计算',
       '  → 人工逐段查表',
       '· 扶正器安放',
       '  → 靠经验间距',
       '',
       '需几何计算',
       '+ 组合优化。'], 'clay');
    return { svg: s, stats: [{ k: '井段', v: cs.n + ' 段' }, { k: '套管', v: f(M.DC, 0) + ' mm' }], note: '读入全井段井径与井斜，以及套管与扶正器参数。套管居中度直接影响固井质量，偏心过大导致水泥环厚度不均。' };
  }

  /* =========================================================
     ② 居中度计算
     ========================================================= */
  function stage2(t) {
    var c = compute(), cs = c.casing;
    var s = '';
    s += G.panel(0, '① 井径', '环空', C.blue);
    s += G.panel(1, '② 偏心', 'ecc', C.clay);
    s += G.panel(2, '③ 居中度', 'standoff', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '居中度计算 · 几何', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + 12, 'standoff = 1 - 2·ecc/(Db-Dc)', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 34, '偏心由缩径与狗腿', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 54, '共同驱动', { size: 8.8, fill: C.ink2 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '几何的坑',
      ['· 井径变化',
       '  → 环空不均',
       '· 井斜狗腿',
       '  → 偏心更大',
       '',
       '逐段算居中度',
       '才能定位。'], 'jade');
    return { svg: s, stats: [{ k: '算法', v: '几何计算' }, { k: '偏心', v: '缩径+狗腿' }], note: '从井径与井斜计算居中度曲线：standoff = 1 - 2·ecc/(Db-Dc)，偏心由缩径与狗腿共同驱动。' };
  }

  /* =========================================================
     ③ 无扶正基线
     ========================================================= */
  function stage3(t) {
    var c = compute(), ev = c.ev;
    var s = '';
    s += G.panel(0, '① 无扶正', '偏心大', C.blue);
    s += G.panel(1, '② 居中度', '低', C.clay);
    s += G.panel(2, '③ 基线', 'avg ' + f(ev.avg0 * 100, 0) + '%', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '无扶正基线 · 平均 ' + f(ev.avg0 * 100, 0) + '%', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + 12, '缩径/狗腿处偏心大', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 34, '居中度拉低', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 56, '优段 ' + Math.round(ev.good0 * ev.n) + '/' + ev.n, { size: 8.8, fill: C.ink2 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '基线的坑',
      ['· 无扶正',
       '  → 偏心随段变化',
       '· 只看均值',
       '  → 隐藏低段',
       '',
       '先算基线',
       '再谈优化。'], 'clay');
    return { svg: s, stats: [{ k: '平均', v: f(ev.avg0 * 100, 0) + '%' }, { k: '优段', v: Math.round(ev.good0 * ev.n) + '/' + ev.n }], note: '计算无扶正时的居中度基线：缩径与狗腿处偏心大、居中度低，作为优化的对照。' };
  }

  /* =========================================================
     ④ 扶正器安放
     ========================================================= */
  function stage4(t) {
    var c = compute(), opt = c.opt;
    var s = '';
    s += G.panel(0, '① 间距', opt.spacing + 'm', C.blue);
    s += G.panel(1, '② 低段', '加密', C.clay);
    s += G.panel(2, '③ 安放', opt.count + ' 只', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '扶正器安放 · 组合优化', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + 12, '按间距网格安放', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 34, '缩径/狗腿段加密', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 56, '共 ' + opt.count + ' 只扶正器', { size: 8.8, fill: C.ink2 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '安放的坑',
      ['· 均匀间距',
       '  → 低段仍偏',
       '· 间距过大',
       '  → 扶正失效',
       '',
       '低居中度段',
       '优先加密。'], 'jade');
    return { svg: s, stats: [{ k: '间距', v: opt.spacing + ' m' }, { k: '扶正器', v: opt.count + ' 只' }], note: '优化扶正器安放位置与间距：按间距网格安放，缩径与狗腿等低居中度段优先加密。' };
  }

  /* =========================================================
     ⑤ 居中度改善
     ========================================================= */
  function stage5(t) {
    var c = compute(), ev = c.ev;
    var s = '';
    s += G.panel(0, '① 无扶正', f(ev.avg0 * 100, 0) + '%', C.blue);
    s += G.panel(1, '② 有扶正', f(ev.avg1 * 100, 0) + '%', C.clay);
    s += G.panel(2, '③ 改善', '+' + f((ev.avg1 - ev.avg0) * 100, 0) + 'pp', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '居中度改善', { size: 9.5, fill: C.ink2, weight: 700 });
    var bw = xw - 60;
    s += G.txt(x0, y0 + 14, '无扶正', { size: 8.8, fill: C.ink2 });
    s += G.rect(x0 + 60, y0 + 8, bw * ev.avg0, 14, { r: 3, fill: '#8a9aa8', stroke: 'none' });
    s += G.txt(x0 + xw, y0 + 19, f(ev.avg0 * 100, 0) + '%', { size: 8.5, fill: C.ink3, anchor: 'end' });
    s += G.txt(x0, y0 + 44, '有扶正', { size: 8.8, fill: C.ink2 });
    s += G.rect(x0 + 60, y0 + 38, bw * ev.avg1, 14, { r: 3, fill: C2, stroke: 'none' });
    s += G.txt(x0 + xw, y0 + 49, f(ev.avg1 * 100, 0) + '%', { size: 8.5, fill: C.ink3, anchor: 'end' });
    s += G.txt(x0, y0 + 72, '优段 ' + Math.round(ev.good0 * ev.n) + ' → ' + Math.round(ev.good1 * ev.n), { size: 8.8, fill: C.jadeD });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '改善的坑',
      ['· 不对比基线',
       '  → 不知改善',
       '· 只看整体',
       '  → 低段被掩',
       '',
       '逐段对比',
       '定位低段。'], 'jade');
    return { svg: s, stats: [{ k: '改善', v: '+' + f((ev.avg1 - ev.avg0) * 100, 0) + 'pp' }, { k: '优段', v: Math.round(ev.good0 * ev.n) + '→' + Math.round(ev.good1 * ev.n) }], note: '对比安放扶正器前后的居中度曲线：平均居中度提升，缩径与狗腿低段被抬升。' };
  }

  /* =========================================================
     ⑥ CBL 验证
     ========================================================= */
  function stage6(t) {
    var c = compute(), ev = c.ev;
    var s = '';
    s += G.panel(0, '① 居中度', '曲线', C.blue);
    s += G.panel(1, '② CBL', '评级', C.clay);
    s += G.panel(2, '③ 验证', '回流', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    var rows = [
      ['CBL 评级', '优>0.8 良>0.6', '评级'],
      ['验证', '固井质量反馈', '回流'],
      ['优段', Math.round(ev.good0 * ev.n) + '→' + Math.round(ev.good1 * ev.n), '提升']
    ];
    for (var r = 0; r < rows.length; r++) {
      var ry = y0 + r * 38;
      s += G.rect(x0, ry, 240, 30, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
      s += G.txt(x0 + 26, ry + 20, rows[r][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(x0 + 140, ry + 20, rows[r][1], { size: 8.8, fill: C.jadeD });
    }
    s += G.txt(x0, y0 - 20, 'CBL 验证回流', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '验证的坑',
      ['· 不算 CBL',
       '  → 不知固井好坏',
       '· 不回流',
       '  → 无法改进',
       '',
       'CBL 评级',
       '闭环验证。'], 'jade');
    return { svg: s, stats: [{ k: '优段', v: Math.round(ev.good0 * ev.n) + '→' + Math.round(ev.good1 * ev.n) }, { k: '验证', v: 'CBL 评级' }], note: '用固井质量反馈（CBL 评级）验证优化效果：居中度曲线改善后优段占比提升，形成闭环。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
