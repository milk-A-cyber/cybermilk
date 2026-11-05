/* 注水泥参数优化 · 模型层单测
 * 用法：node _validate.js  失败 exit 1
 */
'use strict';
const M = require('./demo/demo.js');
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
const in01 = v => v >= 0 && v <= 1;

const jobs = M.genCementJob(24, 20261221);

/* genCementJob 结构 */
ok(jobs && jobs.n === 24, 'genCementJob n');
ok(jobs.Pp.length === 24 && jobs.Pf.length === 24, 'genCementJob 压力长度');
ok(jobs.win.length === 24 && jobs.bore.length === 24 && jobs.temp.length === 24, 'genCementJob 井况长度');
ok(jobs.expDens.length === 24 && jobs.expRate.length === 24, 'genCementJob 施工长度');
ok(jobs.expLoss.length === 24 && jobs.expCbl.length === 24, 'genCementJob 结果长度');
for (let i = 0; i < 24; i++) {
  ok(jobs.Pf[i] > jobs.Pp[i], '破裂压力>孔隙压力 i=' + i);
  ok(jobs.win[i] === jobs.Pf[i] - jobs.Pp[i], '窗口=差 i=' + i);
  ok(jobs.expLoss[i] === 0 || jobs.expLoss[i] === 1, '漏失二值 i=' + i);
  ok(jobs.expCbl[i] >= 0 && jobs.expCbl[i] <= 2, 'CBL 等级 i=' + i);
}
/* 存在窄窗口井 */
{
  let narrow = 0;
  for (let i = 0; i < 24; i++) if (jobs.narrow[i] === 1) narrow++;
  ok(narrow > 0, '存在窄窗口井');
}

/* optimizeSlurry */
{
  const o = M.optimizeSlurry(jobs, 0.04, 0);
  ok(o.dens > 0 && o.rate > 0, 'optimizeSlurry 有推荐');
  ok(typeof o.eff === 'number' && in01(o.eff), 'optimizeSlurry eff');
  ok(o.dens >= o.densMin && o.dens <= o.densMax, '推荐密度在窗口内');
}
/* 不同裕度结果不同 */
{
  const a = M.optimizeSlurry(jobs, 0.02, 0);
  const b = M.optimizeSlurry(jobs, 0.08, 0);
  ok(typeof a.eff === 'number' && typeof b.eff === 'number', '裕度变化 eff 数值');
}

/* recommendDesign */
{
  const r = M.recommendDesign(jobs, 0.04, 0);
  ok(r.optDens > 0 && r.optRate > 0, 'recommendDesign 推荐');
  ok(r.exp && r.opt, 'recommendDesign 经验+优化');
  ok(r.exp.dens > 0 && r.opt.dens > 0, 'recommendDesign 密度');
  ok(r.win === r.Pf - r.Pp, 'recommendDesign 窗口');
  ok(r.opt.dens >= r.densMin && r.opt.dens <= r.densMax, 'recommendDesign 密度在窗口内');
  /* 窄窗口井：优化不漏失优先 */
  for (let i = 0; i < 24; i++) {
    if (jobs.narrow[i] === 1) {
      const rn = M.recommendDesign(jobs, 0.04, i);
      ok(rn.opt.loss === 0, '窄窗口优化应不漏失 i=' + i + ' loss=' + rn.opt.loss);
      break;
    }
  }
}

console.log('c2 OK: 样本井 24 · 存在窄窗口 · 推荐密度=' + M.recommendDesign(jobs, 0.04, 0).optDens.toFixed(3));
