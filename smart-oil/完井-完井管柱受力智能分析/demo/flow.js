/* =========================================================
   完井管柱受力智能分析 · 算法解剖（代理模型 + 可靠性评估）
   ---------------------------------------------------------
   把「管柱受力分析」拆成 6 步，每一步都跑真代码：

     ① 结构接入  钢级/壁厚/下深
     ② 载荷来源  自重/温度/压力/鼓胀
     ③ 机理模型  批量仿真生成
     ④ 代理模型  载荷/安全系数
     ⑤ 高风险识别  工况组合
     ⑥ 可靠性评估  敏感性/失效概率

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
    var key = [L.grade, L.dT, L.dP].join(',');
    if (cache.key === key) return cache;
    var la = M.loadAgent(L.grade, { nT: 6, nP: 6 });
    var rel = M.reliabilityEval(L.grade, 3000, L.dT, L.dP, 600);
    cache = { key: key, L: L, la: la, rel: rel };
    return cache;
  }

  /* =========================================================
     ① 结构接入
     ========================================================= */
  function stage1(t) {
    var L = compute().L;
    var s = '';
    s += G.panel(0, '① 钢级', M.GRADES[L.grade], C.blue);
    s += G.panel(1, '② 壁厚', '7.0-9.5mm', C.clay);
    s += G.panel(2, '③ 下深', '500-3100m', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '结构接入 · 管柱', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + 12, '钢级 ' + M.GRADES[L.grade] + '(' + M.YIELD[L.grade] + 'MPa)', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 34, '壁厚 7.0-9.5mm', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 56, '下深 500-3100m', { size: 8.8, fill: C.ink2 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '为什么难',
      ['· 受力来源多',
       '  → 自重/温度/压力',
       '· 工况组合多',
       '  → 逐工况算慢',
       '',
       '需机理模型',
       '+ 代理模型。'], 'clay');
    return { svg: s, stats: [{ k: '钢级', v: M.GRADES[L.grade] }, { k: '下深', v: '500-3100m' }], note: '读入管柱结构与材料（钢级、壁厚、下深）。生产管柱在温度、压力变化下产生轴向力与变形。' };
  }

  /* =========================================================
     ② 载荷来源
     ========================================================= */
  function stage2(t) {
    var s = '';
    s += G.panel(0, '① 自重', '随下深', C.blue);
    s += G.panel(1, '② 温度', 'ΔT', C.clay);
    s += G.panel(2, '③ 压力', 'ΔP', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '载荷来源 · 四类轴向力', { size: 9.5, fill: C.ink2, weight: 700 });
    var rows = [
      ['自重', 'ρ·g·下深'],
      ['温度', 'E·α·ΔT'],
      ['压力', 'ΔP×系数'],
      ['鼓胀', 'ΔP×系数']
    ];
    for (var i = 0; i < rows.length; i++) {
      var ry = y0 + i * 26;
      s += G.txt(x0, ry, rows[i][0], { size: 8.8, fill: C.ink2, weight: 700 });
      s += G.txt(x0 + 64, ry, rows[i][1], { size: 8.4, fill: C.ink3 });
    }

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '载荷的坑',
      ['· 四类叠加',
       '  → 易漏算',
       '· 温度主导',
       '  → ΔT 关键',
       '',
       '机理模型',
       '逐项算清。'], 'jade');
    return { svg: s, stats: [{ k: '载荷', v: '自重/温度/压力' }, { k: '核心', v: 'ΔT' }], note: '管柱轴向力来源：自重、温度效应、活塞效应与鼓胀效应。温度与压力变化主导受力。' };
  }

  /* =========================================================
     ③ 机理模型
     ========================================================= */
  function stage3(t) {
    var c = compute(), L = c.L;
    var s = '';
    s += G.panel(0, '① 批量', '仿真生成', C.blue);
    s += G.panel(1, '② 载荷', '轴向应力', C.clay);
    s += G.panel(2, '③ 标签', '安全系数', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '机理模型 · 批量仿真', { size: 9.5, fill: C.ink2, weight: 700 });
    var a = M.axialStress(3000, L.dT, L.dP, L.grade);
    var rows = [
      ['自重', f(a.sw, 1) + ' MPa'],
      ['温度', f(a.st, 1) + ' MPa'],
      ['压力', f(a.sp, 1) + ' MPa'],
      ['鼓胀', f(a.sb, 1) + ' MPa']
    ];
    for (var i = 0; i < rows.length; i++) {
      var ry = y0 + i * 26;
      s += G.rect(x0, ry, 240, 20, { r: 4, fill: C.blueL, stroke: C.line });
      s += G.txt(x0 + 10, ry + 14, rows[i][0], { size: 8.6, fill: C.ink2 });
      s += G.txt(x0 + 200, ry + 14, rows[i][1], { size: 8.6, fill: C.blueD, weight: 700 });
    }

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '机理的坑',
      ['· 逐工况慢',
       '  → 组合多',
       '· 参数不确定',
       '  → 有波动',
       '',
       '批量生成',
       '作代理训练集。'], 'jade');
    return { svg: s, stats: [{ k: 'σ自重', v: f(a.sw, 1) }, { k: 'σ温度', v: f(a.st, 1) }], note: '可用机理模型批量生成训练集，真实失效样本仅用于校验。机理模型逐工况计算慢，工况组合多。' };
  }

  /* =========================================================
     ④ 代理模型
     ========================================================= */
  function stage4(t) {
    var c = compute(), la = c.la;
    var s = '';
    s += G.panel(0, '① 快算', '批量', C.blue);
    s += G.panel(1, '② 载荷', '安全系数', C.clay);
    s += G.panel(2, '③ 网格', la.sf.length + '×' + la.sf[0].length, C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '代理模型 · 安全系数云图', { size: 9.5, fill: C.ink2, weight: 700 });
    var nT = la.grid.nT, nP = la.grid.nP;
    var cw = 220 / nT, ch2 = 90 / nP;
    for (var ti = 0; ti < la.sf.length; ti++) {
      for (var pi = 0; pi < la.sf[ti].length; pi++) {
        var sf = la.sf[ti][pi];
        var col = sf < 1 ? '#d8a48c' : sf < 1.3 ? '#e6c08a' : '#a8d0c2';
        s += G.rect(x0 + ti * cw, y0 + pi * ch2, cw - 1, ch2 - 1, { r: 2, fill: col, stroke: 'none' });
      }
    }
    s += G.txt(x0, y0 + h + 20, '红=失效 黄=临界 绿=安全', { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '代理的坑',
      ['· 云图直观',
       '  → 高风险可见',
       '· 失效区',
       '  → SF<1',
       '',
       '快速识别',
       '高风险组合。'], 'jade');
    return { svg: s, stats: [{ k: '网格', v: la.sf.length + '×' + la.sf[0].length }, { k: '最小SF', v: f(la.min.sf) }], note: '用代理模型快速预测多工况下的载荷与安全系数。安全系数 SF=屈服强度/最大应力，SF<1 失效。' };
  }

  /* =========================================================
     ⑤ 高风险识别
     ========================================================= */
  function stage5(t) {
    var c = compute(), la = c.la;
    var s = '';
    s += G.panel(0, '① 最险', 'ΔT=' + f(la.min.dT, 0) + '°C', C.blue);
    s += G.panel(1, '② 最险', 'ΔP=' + f(la.min.dP, 0) + 'MPa', C.clay);
    s += G.panel(2, '③ SF', f(la.min.sf), C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '高风险工况 · 识别', { size: 9.5, fill: C.ink2, weight: 700 });
    s += G.txt(x0, y0 + 12, '最小安全系数 ' + f(la.min.sf), { size: 9, fill: CR, weight: 700 });
    s += G.txt(x0, y0 + 34, 'ΔT=' + f(la.min.dT, 0) + '°C · ΔP=' + f(la.min.dP, 0) + 'MPa', { size: 8.8, fill: C.ink2 });
    s += G.txt(x0, y0 + 56, 'SF<1 即失效组合', { size: 8.8, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '识别的坑',
      ['· 只查单工况',
       '  → 漏高风险',
       '· 工况组合多',
       '  → 逐算慢',
       '',
       '代理模型',
       '全网扫描。'], 'jade');
    return { svg: s, stats: [{ k: '最险ΔT', v: f(la.min.dT, 0) + '°C' }, { k: '最险ΔP', v: f(la.min.dP, 0) + 'MPa' }, { k: '最小SF', v: f(la.min.sf) }], note: '识别高风险工况组合：在 ΔT×ΔP 网格上找安全系数最低、易失效的组合。' };
  }

  /* =========================================================
     ⑥ 可靠性评估
     ========================================================= */
  function stage6(t) {
    var c = compute(), rel = c.rel;
    var s = '';
    s += G.panel(0, '① 扰动', '蒙特卡洛', C.blue);
    s += G.panel(1, '② 分布', 'SF直方', C.clay);
    s += G.panel(2, '③ P_fail', f(rel.pFail * 100, 1) + '%', C.jade);

    var y0 = 130, h = 110;
    var x0 = G.COLS[0].x + 14, xw = 240;
    s += G.txt(x0, y0 - 22, '可靠性评估 · 失效概率', { size: 9.5, fill: C.ink2, weight: 700 });
    var bins = 10, bmin = Math.floor(rel.min), bmax = Math.ceil(rel.max), span = (bmax - bmin) || 1;
    var counts = new Array(bins).fill(0);
    for (var bi = 0; bi < rel.trials; bi++) {
      var bIdx = Math.min(bins - 1, Math.max(0, Math.floor((rel.sfs[bi] - bmin) / span * bins)));
      counts[bIdx]++;
    }
    var maxC = 1;
    for (var m = 0; m < bins; m++) if (counts[m] > maxC) maxC = counts[m];
    for (var bj = 0; bj < bins; bj++) {
      var bh = counts[bj] / maxC * 80;
      var bcol = (bmin + bj * span / bins) < 1 ? '#d8a48c' : '#a8d0c2';
      s += G.rect(x0 + bj * 220 / bins, y0 + h - bh, 220 / bins - 2, bh, { r: 1, fill: bcol, stroke: 'none' });
    }
    s += G.txt(x0, y0 + h + 20, 'P_fail=' + f(rel.pFail * 100, 1) + '% · 平均SF=' + f(rel.avg), { size: 8.5, fill: C.ink3 });

    s += footBox(G.COLS[2].x + 14, 250, y0, 170, '评估的坑',
      ['· 参数不确定',
       '  → SF有波动',
       '· 最敏感',
       '  → ' + rel.sens[0].k,
       '',
       '敏感性+可靠',
       '失效概率。'], 'jade');
    return { svg: s, stats: [{ k: 'P_fail', v: f(rel.pFail * 100, 1) + '%' }, { k: '平均SF', v: f(rel.avg) }, { k: '最敏感', v: rel.sens[0].k }], note: '可靠性评估：蒙特卡洛扰动参数，统计安全系数分布与失效概率；敏感性分析找出最影响安全的参数。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
