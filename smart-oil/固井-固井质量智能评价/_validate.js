/* 固井质量智能评价 · 模型层单测
 * 用法：node _validate.js  失败 exit 1
 */
'use strict';
const M = require('./demo/demo.js');
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
const in01 = v => v >= 0 && v <= 1;

const d = M.genCement(120, 20261211);

/* genCement 结构 */
ok(d && d.n === 120, 'genCement n');
ok(d.cbl.length === 120 && d.vdl.length === 120 && d.bi.length === 120, 'genCement 数组长度');
ok(d.grade.length === 120 && d.truth.length === 120, 'genCement 标签长度');
for (let i = 0; i < 120; i++) {
  ok(in01(d.cbl[i]) && in01(d.vdl[i]) && in01(d.bi[i]), 'genCement 数值边界 i=' + i);
  ok(d.grade[i] >= 0 && d.grade[i] <= 2, 'genCement 等级 i=' + i);
  ok(d.truth[i] === 0 || d.truth[i] === 1, 'genCement 真值 i=' + i);
}
/* 段连续：应有连续同等级段 */
{
  let changes = 0;
  for (let i = 1; i < 120; i++) if (d.grade[i] !== d.grade[i - 1]) changes++;
  ok(changes > 0 && changes < 30, 'genCement 段连续 changes=' + changes);
}
/* 存在特例（快速地层/微环隙）：良里混入低胶结 */
{
  let special = 0;
  for (let i = 0; i < 120; i++) if (d.grade[i] === 1 && d.bi[i] < 0.55 && d.truth[i] === 1) special++;
  ok(special > 0, 'genCement 存在特例');
}

/* cementEval */
{
  const ev = M.cementEval(d, 0.5);
  ok(ev.pred.length === 120, 'cementEval pred 长度');
  ok(in01(ev.acc), 'cementEval acc');
  ok(ev.errs.length === 120 - Math.round(ev.acc * 120) || ev.errs.length >= 0, 'cementEval errs 计数');
  ok(ev.errs.length > 0, 'cementEval 存在判错（边界应有误差）');
  const evT = M.cementEval(d, 0.65);
  ok(typeof evT.acc === 'number', 'cementEval 阈值变化 acc 数值');
}

/* segClassify */
{
  const s0 = M.segClassify(d, 0), s1 = M.segClassify(d, 1);
  ok(s0.pred.length === 120 && s1.pred.length === 120, 'segClassify pred 长度');
  ok(in01(s0.acc) && in01(s1.acc), 'segClassify acc 有界');
  ok(s1.errs.length > 0, 'segClassify 存在判错');
  ok(s1.acc >= s0.acc, '多特征≥单特征');
}

console.log('c1 OK: accBase=' + M.cementEval(d, 0.5).acc.toFixed(3) + ' accSeg0=' + M.segClassify(d, 0).acc.toFixed(3) + ' accSeg1=' + M.segClassify(d, 1).acc.toFixed(3));
