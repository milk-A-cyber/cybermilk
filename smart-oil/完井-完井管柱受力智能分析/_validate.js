/* 完井管柱受力智能分析 · 模型层单测
 * 用法：node _validate.js  失败 exit 1
 */
'use strict';
const M = require('./demo/demo.js');
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
const in01 = v => v >= 0 && v <= 1;

const tube = M.genTubing(60, 20261103);

/* genTubing 结构 */
ok(tube && tube.n === 60, 'genTubing n');
ok(tube.depth.length === 60 && tube.grade.length === 60 && tube.sf.length === 60, 'genTubing 长度');
ok(tube.dT.length === 60 && tube.dP.length === 60 && tube.total.length === 60, 'genTubing 工况长度');
for (let i = 0; i < 60; i++) {
  ok(tube.grade[i] >= 0 && tube.grade[i] <= 2, '钢级合法 i=' + i);
  ok(tube.depth[i] >= 500 && tube.depth[i] <= 3100, '下深范围 i=' + i);
  ok(tube.sf[i] > 0, '安全系数正 i=' + i);
}

/* axialStress */
{
  const a = M.axialStress(3000, 70, 30, 2);
  ok(a.sw > 0 && a.st > 0 && a.sp > 0 && a.sb > 0, '四类应力为正');
  ok(a.total === a.sw + a.st + a.sp + a.sb, '总应力=四类之和');
  ok(a.yield === M.YIELD[2], 'P110 屈服强度');
  /* 下深↑ → 自重↑ → 总应力↑ */
  const aShallow = M.axialStress(1000, 70, 30, 2);
  ok(a.total > aShallow.total, '下深→总应力↑');
  /* 温度↑ → 温度应力↑ */
  const aHot = M.axialStress(3000, 120, 30, 2);
  ok(aHot.st > a.st, '温度→温度应力↑');
}

/* loadAgent */
{
  const la = M.loadAgent(2, { nT: 6, nP: 6 });
  ok(la.dTs.length === 7 && la.dPs.length === 7, '网格维度');
  ok(la.sf.length === 7 && la.sf[0].length === 7, '网格矩阵');
  ok(la.min && la.min.sf > 0, '最小SF存在');
  /* SF 与 屈服/总应力 一致 */
  ok(Math.abs(la.min.sf - M.YIELD[2] / M.axialStress(3000, la.min.dT, la.min.dP, 2).total) < 0.001, 'SF 计算一致');
  /* 温度↑ → SF↓（同压力） */
  const sCool = M.axialStress(3000, 0, 30, 2), sHot = M.axialStress(3000, 120, 30, 2);
  ok(sHot.yield / sHot.total < sCool.yield / sCool.total, '温度→SF↓');
}

/* reliabilityEval */
{
  const rel = M.reliabilityEval(2, 3000, 70, 30, 600);
  ok(rel.trials === 600 && rel.sfs.length === 600, '蒙特卡洛样本');
  ok(rel.fails >= 0 && rel.fails <= 600, '失效计数');
  ok(rel.pFail >= 0 && rel.pFail <= 1, '失效概率有界');
  ok(rel.avg > 0, '平均SF');
  ok(rel.sens.length === 3, '三参数敏感性');
  /* 敏感性已排序 */
  ok(Math.abs(rel.sens[0].v) >= Math.abs(rel.sens[1].v) && Math.abs(rel.sens[1].v) >= Math.abs(rel.sens[2].v), '敏感性降序');
}

console.log('co3 OK: 段 ' + tube.n + ' · 最险SF ' + M.loadAgent(0,{nT:6,nP:6}).min.sf.toFixed(2) + ' · P_fail ' + (M.reliabilityEval(0,3000,85,30,600).pFail*100).toFixed(1) + '% · 最敏感 ' + M.reliabilityEval(0,3000,85,30,600).sens[0].k);
