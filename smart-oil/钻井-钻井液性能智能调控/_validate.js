/* =========================================================
   钻井液性能智能调控 · 模型层离线验证
   用法：node _validate.js
   通过则打印各用例结果并以 exit 0 结束；任一失败 exit 1。
   ========================================================= */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, 'demo', 'demo.js'), 'utf8');
var sandbox = { module: { exports: {} }, exports: {}, console: console, Math: Math, Float64Array: Float64Array, Int8Array: Int8Array };
sandbox.global = sandbox; sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'demo.js' });
var M = sandbox.module.exports;

var fail = 0;
function check(name, cond, d) { if (cond) console.log('  ✓ ' + name); else { fail++; console.error('  ✗ ' + name + (d !== undefined ? ' → ' + d : '')); } }
function f(v) { return Number(v).toFixed(3); }

console.log('d5 钻井液性能智能调控 · 模型层单测');
console.log('------------------------------------------');

/* 1. 高频循环参数合成 */
var circ = M.genCirc(100, 20261151);
check('genCirc 长度=100', circ.n === 100, circ.n);
check('genCirc flow 有界[20,36]', circ.flow.every(function (v) { return v >= 20 && v <= 36; }));
check('genCirc temp 有界[42,70]', circ.temp.every(function (v) { return v >= 42 && v <= 70; }));
check('genCirc pres 有界[9,16]', circ.pres.every(function (v) { return v >= 9 && v <= 16; }));
check('genCirc 温度有上升趋势', circ.temp[95] > circ.temp[5], f(circ.temp[95]) + ' vs ' + f(circ.temp[5]));

/* 2. 多源融合软测量 */
var sparse = M.softSense(circ, 0, 100, 20261152);
var fused = M.softSense(circ, 1, 100, 20261152);
check('softSense 长度=100', fused.sense.length === 100, fused.sense.length);
check('softSense 有界[1.0,2.2]', fused.sense.every(function (v) { return v >= 1.0 && v <= 2.2; }));
check('softSense 稀疏模式无实测点', sparse.meas.length === 0, sparse.meas.length);
check('softSense 融合模式有实测点', fused.meas.length > 0, fused.meas.length);
check('softSense 多源融合误差更小', fused.err < sparse.err, f(fused.err) + ' vs ' + f(sparse.err));

/* 3. 加量推荐 */
var devs = new Float64Array(100);
for (var i = 0; i < 100; i++) devs[i] = 0.4 - Math.sin(i * 0.08) * 0.2;
var dExp = M.doseRecommend(devs, 0, 100);
var dRec = M.doseRecommend(devs, 1, 100);
check('doseRecommend 长度=100', dRec.length === 100, dRec.length);
check('doseRecommend 加量非负', dRec.every(function (v) { return v >= 0; }));
check('doseRecommend 推荐比经验更省(末端)', dRec[99] < dExp[99], f(dRec[99]) + ' vs ' + f(dExp[99]));
check('doseRecommend 加量随偏差增减', dRec[60] > dRec[50] || dRec[60] < dRec[50], f(dRec[60]) + ' vs ' + f(dRec[50]));

/* 4. 过调抑制 */
var c = M.oscillationCtrl(devs, 0, 100);
var c2 = M.oscillationCtrl(devs, 1, 100);
check('oscillationCtrl 返回完整', c.expDose && c.recDose && c.expPerf && c.recPerf, '');
check('oscillationCtrl 推荐波动更小', c2.recWave < c.expWave, f(c2.recWave) + ' vs ' + f(c.expWave));
check('oscillationCtrl 推荐达标率更高', c2.recOk > c.expOk, f(c2.recOk) + ' vs ' + f(c.expOk));

console.log('------------------------------------------');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过');
process.exit(0);
