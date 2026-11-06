/* 套管居中度智能评估 · 模型层单测
 * 用法：node _validate.js  失败 exit 1
 */
'use strict';
const M = require('./demo/demo.js');
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
const in01 = v => v >= 0 && v <= 1;

const casing = M.genCasingGeo(120, 20261241);

/* genCasingGeo 结构 */
ok(casing && casing.n === 120, 'genCasingGeo n');
ok(casing.Db.length === 120 && casing.incl.length === 120, 'genCasingGeo 长度');
ok(casing.ecc0.length === 120, 'genCasingGeo ecc 长度');
ok(casing.shrinks.length >= 1 && casing.dogs.length >= 1, '缩径/狗腿段存在');
for (let i = 0; i < 120; i++) {
  ok(casing.Db[i] > casing.Dc, '井径>套管 i=' + i);
  ok(casing.incl[i] >= 0, '井斜非负 i=' + i);
  ok(casing.ecc0[i] >= 0, '偏心非负 i=' + i);
}

/* centralizerOpt */
{
  const opt = M.centralizerOpt(casing, 25);
  ok(opt.positions.length > 0, '安放位置非空');
  ok(opt.count === opt.positions.length, 'count 一致');
  ok(opt.spacing === 25, '间距记录');
  for (let i = 1; i < opt.positions.length; i++) {
    ok(opt.positions[i] >= opt.positions[i - 1], '位置有序');
  }
}

/* standoffEval */
{
  const opt = M.centralizerOpt(casing, 25);
  const ev = M.standoffEval(casing, opt.positions);
  ok(ev.so0.length === 120 && ev.so1.length === 120, 'standoff 长度');
  ok(ev.grade0.length === 120 && ev.grade1.length === 120, '评级长度');
  for (let i = 0; i < 120; i++) {
    ok(in01(ev.so0[i]), 'standoff0 有界 i=' + i);
    ok(in01(ev.so1[i]), 'standoff1 有界 i=' + i);
    ok(['差', '良', '优'].indexOf(ev.grade0[i]) >= 0, 'grade0 合法 i=' + i);
    ok(['差', '良', '优'].indexOf(ev.grade1[i]) >= 0, 'grade1 合法 i=' + i);
  }
  ok(ev.avg0 >= 0 && ev.avg0 <= 1, 'avg0 有界');
  ok(ev.avg1 >= 0 && ev.avg1 <= 1, 'avg1 有界');
  /* 扶正器改善居中度：有扶正平均 >= 无扶正 */
  ok(ev.avg1 >= ev.avg0, '有扶正 >= 无扶正 avg1=' + ev.avg1.toFixed(3) + ' avg0=' + ev.avg0.toFixed(3));
}

/* 间距对改善的单调性（粗调间距，居中度应随之变化） */
{
  const o1 = M.centralizerOpt(casing, 15);
  const e1 = M.standoffEval(casing, o1.positions);
  const o3 = M.centralizerOpt(casing, 50);
  const e3 = M.standoffEval(casing, o3.positions);
  ok(e1.avg1 >= e3.avg1 - 1e-6, '更密间距居中度不更低');
}

console.log('c4 OK: 井段 120 · 平均居中度 ' + (function(){const o=M.centralizerOpt(casing,25);const e=M.standoffEval(casing,o.positions);return (e.avg0*100).toFixed(0)+'%→'+(e.avg1*100).toFixed(0)+'%';})() + ' · 扶正器 ' + M.centralizerOpt(casing,25).count + ' 只');
