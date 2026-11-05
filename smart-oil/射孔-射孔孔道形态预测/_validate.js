/* 射孔孔道形态预测 · 模型层单测
 * 用法：node _validate.js  失败 exit 1
 */
'use strict';
const M = require('./demo/demo.js');
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
const in01 = v => v >= 0 && v <= 1;

/* 数值模拟 */
const data = M.genSim(20261106, 60);
ok(data.n === 60, '训练集 60 组');
ok(data.rows.length === 60, '训练集行数');
ok(data.rows.every(r => r.depth > 0 && r.dia > 0), '穿深孔径正');
ok(data.rows.every(r => in01(r.clean)), '清洁度有界');

/* 药量↑ → 穿深↑ */
const s1 = M.simShape(0, 0.8, 0.7, 0);
const s2 = M.simShape(0, 1.4, 0.7, 0);
ok(s2.depth > s1.depth, '药量↑穿深↑');
/* 靶件强度↑ → 穿深↓ */
const w = M.simShape(0, 1.1, 0.5, 0);
const hd = M.simShape(0, 1.1, 1.0, 0);
ok(w.depth > hd.depth, '靶件强度↑穿深↓');
/* 弹型：深穿透穿深最大 */
ok(M.simShape(2, 1.1, 0.7, 0).depth > M.simShape(1, 1.1, 0.7, 0).depth, '深穿透弹穿深大');

/* 训练代理模型 */
const proxy = M.trainProxy(data, 5);
ok(proxy.k === 5 && proxy.data === data, '代理结构');
/* 训练点上预测应接近真值 */
const r0 = data.rows[0];
const p0 = proxy.predict(r0.type, r0.charge, r0.target);
ok(Math.abs(p0.depth - r0.depth) < 25, '训练点预测近真值');
/* 随机点预测有界 */
const pr = proxy.predict(0, 1.0, 0.7);
ok(pr.depth > 20 && pr.depth < 220, '随机点穿深合理');
ok(pr.dia > 4 && pr.dia < 20, '随机点孔径合理');
ok(in01(pr.clean), '随机点清洁度有界');

/* 靶试实测 + 标定 */
const truth = M.genTruth(20261106, 4);
ok(truth.length === 4, '靶试 4 点');
const cal = M.calibrate(proxy, truth);
ok(cal.scale >= 0.6 && cal.scale <= 1.1, '标定系数范围');
ok(cal.nTruth === 4, '标定真值数');

/* 标定后预测 */
const pred = M.predictShape(proxy, cal, 0, 1.1, 0.7);
ok(pred.depth > 0 && pred.dia > 0, '标定后预测正');
ok(in01(pred.clean), '标定后清洁度有界');
/* 仿真偏乐观 → scale<1 使穿深下降 */
ok(pred.depth <= pred.rawDepth * 1.001, '标定后穿深≤原始');

console.log('p2 OK: 训练集 ' + data.n + '·靶试 ' + truth.length + ' 点·标定系数 ' + cal.scale.toFixed(3) + '·预测穿深 ' + pred.depth.toFixed(1) + 'mm·孔径 ' + pred.dia.toFixed(1) + 'mm');
