/* 射孔参数优化 · 模型层单测
 * 用法：node _validate.js  失败 exit 1
 */
'use strict';
const M = require('./demo/demo.js');
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
const in01 = v => v >= 0 && v <= 1;

const rock = M.genRes(20261105);
ok(rock.strength >= 0 && rock.strength <= 1, '储层强度有界');
ok(rock.stress >= 20 && rock.stress <= 50, '地应力范围');
ok(rock.perm >= 50 && rock.perm <= 500, '渗透率范围');

/* 全组合 */
const all = M.allCombos();
ok(all.length === 125, '全组合 125 点');

/* 实验设计采样 */
const s15 = M.doeSample(rock, 15);
ok(s15.length === 15, '采样 15 点');
const s6 = M.doeSample(rock, 6);
ok(s6.length === 6, '采样 6 点');
/* 采样点覆盖参数空间，不重复 */
const keys = s15.map(s => s.density + ',' + s.phase + ',' + s.depth);
ok(new Set(keys).size === s15.length, '采样点不重复');
ok(s15.every(s => M.DENSITY.indexOf(s.density) >= 0 && M.PHASES.indexOf(s.phase) >= 0 && M.DEPTHS.indexOf(s.depth) >= 0), '采样点合法');

/* 代理模型 */
const p1 = M.proxyModel(rock, { density: 12, phase: 90, depth: 0.8 });
ok(p1.q > 0, '产能正');
ok(in01(p1.risk), '出砂有界');
/* 穿深↑ → 产能↑ */
const pd = M.proxyModel(rock, { density: 12, phase: 90, depth: 1.2 });
ok(pd.q > p1.q, '穿深↑产能↑');
/* 相位 90 最优 */
const p90 = M.proxyModel(rock, { density: 12, phase: 90, depth: 0.8 });
const p0 = M.proxyModel(rock, { density: 12, phase: 0, depth: 0.8 });
ok(p90.q > p0.q, '相位90产能最优');
/* 弱储层出砂↑ */
const weak = M.genRes(20261199); weak.strength = 0.2;
const pweak = M.proxyModel(weak, { density: 12, phase: 90, depth: 1.0 });
const pstrong = M.proxyModel(rock, { density: 12, phase: 90, depth: 1.0 });
ok(pweak.risk > pstrong.risk, '弱储层出砂高');

/* 多目标优化 */
const opt = M.optRecommend(rock, s15);
ok(opt.front.length >= 1, '采样前沿非空');
ok(opt.gFront.length >= 1, '全局前沿非空');
ok(opt.nSample === 15 && opt.nAll === 125, '点数量');
ok(opt.rec.density >= 8 && opt.rec.density <= 24, '推荐孔密合法');
ok(opt.rec.q > 0, '推荐产能正');
/* 采样前沿逼近全局前沿：推荐产能应接近全局最高产能 */
const gTop = opt.gFront[opt.gFront.length - 1];
ok(opt.rec.q >= gTop.q * 0.6, '推荐产能≥全局60%');

console.log('p1 OK: 采样 ' + opt.nSample + '·全枚举 ' + opt.nAll + '·推荐 ' + opt.rec.density + '孔/' + opt.rec.phase + '°/' + M.DEPTHS[M.DEPTHS.indexOf(opt.rec.depth)] + 'm·产能 ' + opt.rec.q.toFixed(1) + '·出砂 ' + opt.rec.risk.toFixed(2) + '·全局产能 ' + gTop.q.toFixed(1));
