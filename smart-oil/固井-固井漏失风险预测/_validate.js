/* 固井漏失风险预测 · 模型层单测
 * 用法：node _validate.js  失败 exit 1
 */
'use strict';
const M = require('./demo/demo.js');
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
const in01 = v => v >= 0 && v <= 1;

const cases = M.genLeakCase(200, 20261231);

/* genLeakCase 结构 */
ok(cases && cases.n === 200, 'genLeakCase n');
ok(cases.Pp.length === 200 && cases.Pf.length === 200, 'genLeakCase 压力长度');
ok(cases.win.length === 200 && cases.bore.length === 200, 'genLeakCase 井况长度');
ok(cases.dens.length === 200 && cases.rate.length === 200, 'genLeakCase 浆柱长度');
ok(cases.margin.length === 200 && cases.loss.length === 200 && cases.amt.length === 200, 'genLeakCase 结果长度');
for (let i = 0; i < 200; i++) {
  ok(cases.Pf[i] > cases.Pp[i], '破裂>孔隙 i=' + i);
  ok(cases.loss[i] === 0 || cases.loss[i] === 1, '漏失二值 i=' + i);
  ok(cases.amt[i] >= 0, '漏失量非负 i=' + i);
}
/* 类不均衡：漏失占比低但存在 */
{
  let loss = 0;
  for (let i = 0; i < 200; i++) if (cases.loss[i] === 1) loss++;
  ok(loss > 0, '存在漏失井');
  ok(loss / 200 < 0.5, '漏失占比低（类不均衡）');
}

/* leakClassify */
{
  const lc = M.leakClassify(cases, 0.5, 0);
  ok(in01(lc.p), 'leakClassify p 有界');
  ok(lc.risk === '低' || lc.risk === '中' || lc.risk === '高', 'leakClassify 风险等级');
  ok(lc.pred === 0 || lc.pred === 1, 'leakClassify 预测');
  ok(lc.loss === 0 || lc.loss === 1, 'leakClassify 真值');
  ok(typeof lc.margin === 'number' && typeof lc.dens === 'number', 'leakClassify 字段');
  const lcT = M.leakClassify(cases, 0.3, 0);
  ok(lcT.pred === 0 || lcT.pred === 1, '阈值变化预测');
}

/* riskExplain */
{
  const ex = M.riskExplain(cases, 0);
  ok(ex.feats.length >= 3, 'riskExplain 特征数');
  let sum = 0;
  ex.feats.forEach(function (ft) { ok(in01(ft.share), 'share 有界'); sum += ft.share; });
  ok(Math.abs(sum - 1) < 0.01, 'share 归一化 sum=' + sum);
  ok(ex.feats[0].share >= ex.feats[1].share, '归因排序（降序）');
  ok(ex.feats[0].k.length > 0, '主因有名字');
}

console.log('c3 OK: 井 200 · 漏失率=' + (function(){let l=0;for(let i=0;i<200;i++)if(cases.loss[i]===1)l++;return (l/200).toFixed(3);})() + ' · 主因=' + M.riskExplain(cases,0).feats[0].k);
