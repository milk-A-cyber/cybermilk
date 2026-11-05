/* 射孔参数智能设计 · 模型层单测
 * 用法：node _validate.js  失败 exit 1
 */
'use strict';
const M = require('./demo/demo.js');
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
const in01 = v => v >= 0 && v <= 1;

const wells = M.genPerfData(120, 20261102);

/* genPerfData 结构 */
ok(wells && wells.n === 120, 'genPerfData n');
ok(wells.strength.length === 120 && wells.stress.length === 120 && wells.perm.length === 120, 'genPerfData 储层长度');
ok(wells.density.length === 120 && wells.phase.length === 120 && wells.depth.length === 120, 'genPerfData 参数长度');
ok(wells.qTest.length === 120, 'genPerfData 产量长度');
for (let i = 0; i < 120; i++) {
  ok(in01(wells.strength[i]), '强度 i=' + i);
  ok(M.DENSITY.indexOf(wells.density[i]) >= 0, '孔密合法 i=' + i);
  ok(M.PHASES.indexOf(wells.phase[i]) >= 0, '相位合法 i=' + i);
  ok(M.DEPTHS.indexOf(wells.depth[i]) >= 0, '穿深合法 i=' + i);
  ok(wells.qTest[i] > 0, '产量正 i=' + i);
}

/* proxyModel */
{
  const p = M.proxyModel({ strength: 0.6 }, { density: 12, phase: 90, depth: 0.8 });
  ok(p.q > 0, '产能正');
  ok(in01(p.risk), '出砂有界');
  /* 穿深 ↑ → 产能 ↑ 且 出砂 ↑ */
  const pLow = M.proxyModel({ strength: 0.6 }, { density: 12, phase: 90, depth: 0.3 });
  const pHi = M.proxyModel({ strength: 0.6 }, { density: 12, phase: 90, depth: 1.2 });
  ok(pHi.q > pLow.q, '穿深→产能↑');
  ok(pHi.risk > pLow.risk, '穿深→出砂↑');
  /* 强度 ↑ → 出砂 ↓ */
  const pWeak = M.proxyModel({ strength: 0.3 }, { density: 16, phase: 90, depth: 1.0 });
  const pStrong = M.proxyModel({ strength: 0.9 }, { density: 16, phase: 90, depth: 1.0 });
  ok(pStrong.risk < pWeak.risk, '强度→出砂↓');
  /* 90° 相位产能最高 */
  const p90 = M.proxyModel({ strength: 0.6 }, { density: 12, phase: 90, depth: 0.8 });
  const p0 = M.proxyModel({ strength: 0.6 }, { density: 12, phase: 0, depth: 0.8 });
  ok(p90.q > p0.q, '90° 产能最高');
}

/* paretoOpt */
{
  const rock = { strength: 0.55 };
  const po = M.paretoOpt(rock, 90);
  ok(po.all.length === M.DENSITY.length * M.DEPTHS.length, '枚举全组合');
  ok(po.front.length >= 1, '前沿非空');
  ok(po.rec && po.rec.q > 0, '推荐存在');
  ok(po.front.length <= po.all.length, '前沿<=全部');
  /* 前沿无支配：任意前沿点不被其他点同时更优 */
  for (let i = 0; i < po.front.length; i++) {
    const a = po.front[i];
    for (let j = 0; j < po.all.length; j++) {
      const o = po.all[j];
      ok(!(o !== a && o.q > a.q + 0.1 && o.risk < a.risk - 0.005), '前沿非支配');
    }
  }
  /* 推荐在前沿内 */
  ok(po.front.indexOf(po.rec) >= 0, '推荐在前沿');
}

console.log('co2 OK: 组合 ' + M.DENSITY.length * M.DEPTHS.length + ' · 前沿 ' + M.paretoOpt({strength:0.55},90).front.length + ' 点 · 推荐 ' + M.paretoOpt({strength:0.55},90).rec.density + '孔/' + M.paretoOpt({strength:0.55},90).rec.phase + '°/' + M.paretoOpt({strength:0.55},90).rec.depth + 'm');
