/* 射孔效果智能评估 · 模型层单测
 * 用法：node _validate.js  失败 exit 1
 */
'use strict';
const M = require('./demo/demo.js');
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
const in01 = v => v >= 0 && v <= 1;

/* 生产数据 */
const prod = M.genProd(20261108);
ok(prod.nZone === 6, '6 段');
ok(prod.records.length === 6, '记录 6 条');
ok(prod.q.length === 120, '产量 120 点');
ok(prod.q.every(q => q > 0), '产量正');
ok(prod.w.every(w => in01(w)), '含水有界');
ok(prod.truth.length === 2, '试井真值 2 个');
/* 至少造了一个低效段（段1 或 段4） */
ok(prod.records.some(r => r.trueEff < 0.4), '存在低效段');

/* 反演 */
const inv = M.invertEff(prod, 0.15);
ok(inv.length === 6, '反演 6 段');
ok(inv.every(e => in01(e.eff) && in01(e.lo) && in01(e.hi)), '效率/区间有界');
ok(inv.every(e => e.lo <= e.eff + 1e-6 && e.hi >= e.eff - 1e-6), 'lo≤eff≤hi');
/* 反演逼近真实效率 */
ok(inv.every(e => Math.abs(e.eff - e.trueEff) < 0.4), '反演误差可控');
/* 噪声↑ → 区间↑ */
const invLo = M.invertEff(prod, 0.05);
const invHi = M.invertEff(prod, 0.5);
ok(invHi[0].hi - invHi[0].lo > invLo[0].hi - invLo[0].lo, '噪声大区间宽');

/* 低效识别 */
const ident = M.identifyLowEff(inv, 0.4);
ok(ident.length === 6, '识别 6 段');
ok(ident.every(i => i.low === (i.hi < 0.4)), '低效判定正确');
ok(ident.every(i => i.risk === (i.lo < 0.4 && i.hi >= 0.4)), '待复核判定正确');
/* 存在至少一个低效或复核 */
ok(ident.some(i => i.low || i.risk), '有低效/复核段');

/* 补孔建议 */
const rec = M.recommendPatch(prod.records, inv, 0.4);
ok(Array.isArray(rec.patch), '建议数组');
ok(rec.nPatch + rec.nReview <= rec.patch.length || rec.nPatch === rec.patch.filter(x => x.type === '补孔').length, '补孔计数正确');
/* 补孔建议增益为正 */
rec.patch.forEach(p => ok(p.gain >= 0, '增益非负'));

/* 阈值变化影响 */
const recLo = M.recommendPatch(prod.records, inv, 0.3);
const recHi = M.recommendPatch(prod.records, inv, 0.6);
ok(recHi.nPatch >= recLo.nPatch, '阈值↑补孔↑');

console.log('p4 OK: 段 ' + prod.nZone + '·低效段存在·阈值0.4→补孔 ' + rec.nPatch + ' 段/复核 ' + rec.nReview + ' 段·建议 ' + rec.patch.length + ' 条');
