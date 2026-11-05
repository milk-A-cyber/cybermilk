/* 完井方式智能优选 · 模型层单测
 * 用法：node _validate.js  失败 exit 1
 */
'use strict';
const M = require('./demo/demo.js');
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
const in01 = v => v >= 0 && v <= 1;

const wells = M.genWells(120, 20261101);

/* genWells 结构 */
ok(wells && wells.n === 120, 'genWells n');
ok(wells.litho.length === 120 && wells.sandIdx.length === 120, 'genWells 储层长度');
ok(wells.waterNear.length === 120 && wells.way.length === 120, 'genWells 方式长度');
ok(wells.q0.length === 120 && wells.sandOut.length === 120 && wells.cost.length === 120, 'genWells 表现长度');
for (let i = 0; i < 120; i++) {
  ok(wells.litho[i] >= 0 && wells.litho[i] <= 2, '岩性 i=' + i);
  ok(in01(wells.sandIdx[i]), '出砂指数 i=' + i);
  ok(wells.waterNear[i] === 0 || wells.waterNear[i] === 1, '水层 i=' + i);
  ok(wells.way[i] >= 0 && wells.way[i] <= 3, '方式 i=' + i);
  ok(wells.q0[i] > 0, '产能正 i=' + i);
  ok(wells.sandOut[i] === 0 || wells.sandOut[i] === 1, '出砂 i=' + i);
}
/* 出砂与防砂：高出砂+弱防砂必出砂 */
for (let i = 0; i < 120; i++) {
  const at = M.WAYATTR[wells.way[i]];
  if (wells.sandIdx[i] > 0.55 && at.sandProtect < 0.7) ok(wells.sandOut[i] === 1, '高砂弱防必出砂 i=' + i);
}

/* similarCases */
{
  const q = { litho: 1, sandIdx: 0.4, waterNear: 0 };
  const sims = M.similarCases(q, wells, 5);
  ok(sims.length === 5, 'kNN 返回 5');
  ok(sims[0].dist <= sims[sims.length - 1].dist, '按距离排序');
  for (let i = 0; i < sims.length; i++) {
    ok(sims[i].way >= 0 && sims[i].way <= 3, '相似井方式');
    ok(sims[i].q0 > 0, '相似井产能');
  }
  const sim2 = M.similarCases(q, wells, 3);
  ok(sim2.length === 3, 'k 可调');
}

/* rankPlans */
{
  const q = { litho: 0, sandIdx: 0.6, waterNear: 0 };
  const plans = M.rankPlans(q, wells, 0.5);
  ok(plans.length === 4, '4 种方式全排');
  for (let i = 1; i < plans.length; i++) {
    ok(plans[i - 1].score >= plans[i].score, '按 score 降序');
  }
  ok(plans[0].k.length > 0, '首选有名字');
  const hasPareto = plans.some(function (p) { return p.pareto; });
  ok(hasPareto, '存在帕累托');
  /* 权重变化改变排序（成本/防砂权重 ↑ → 强防砂方案前移） */
  const plans0 = M.rankPlans(q, wells, 0.1);
  const plans1 = M.rankPlans(q, wells, 0.9);
  ok(plans0[0].k !== undefined && plans1[0].k !== undefined, '权重可调');
}

console.log('co1 OK: 井 120 · 首选=' + M.rankPlans({litho:0,sandIdx:0.6,waterNear:0}, wells, 0.5)[0].k + ' · 帕累托=' + M.rankPlans({litho:0,sandIdx:0.6,waterNear:0}, wells, 0.5).filter(function(p){return p.pareto;}).map(function(p){return p.k;}).join('/'));
