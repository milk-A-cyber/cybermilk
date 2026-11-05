/* =========================================================
   测井数据修复 · 模型层离线验证
   用法：node _validate.js
   通过则打印各用例结果并以 exit 0 结束；任一失败 exit 1。
   ========================================================= */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, 'demo', 'demo.js'), 'utf8');
var sandbox = { module: { exports: {} }, exports: {}, console: console, Math: Math, Float64Array: Float64Array, Int32Array: Int32Array, Array: Array };
sandbox.global = sandbox; sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'demo.js' });
var M = sandbox.module.exports;

var fail = 0;
function check(name, cond, d) { if (cond) console.log('  ✓ ' + name); else { fail++; console.error('  ✗ ' + name + (d !== undefined ? ' → ' + d : '')); } }

console.log('w5 测井数据修复 · 模型层单测');
console.log('------------------------------------------');

/* 1. 测井合成 */
var d = M.genLogMissing(120, 20261171);
check('genLogMissing 长度=120', d.n === 120 && d.gr.length === 120 && d.rt.length === 120 && d.den.length === 120);
check('genLogMissing 缺失段存在', (function () { var s = 0; for (var i = 0; i < 120; i++) s += d.mask[i]; return s > 0; })(), 'mask=' + d.mask.reduce(function (a, b) { return a + b; }, 0));
check('genLogMissing 异常存在', (function () { var s = 0; for (var i = 0; i < 120; i++) s += d.anomaly[i]; return s > 0; })(), 'anom=' + d.anomaly.reduce(function (a, b) { return a + b; }, 0));
check('genLogMissing 邻井参考存在', (function () { for (var i = 0; i < 120; i++) if (d.refGr[i] < 0.2 || d.refGr[i] > 3) return false; return true; })());
check('genLogMissing 缺失置-1', (function () { for (var i = 0; i < 120; i++) if (d.mask[i] === 1 && !(d.gr[i] === -1 && d.rt[i] === -1 && d.den[i] === -1)) return false; return true; })());
check('genLogMissing 正常点有界', (function () { for (var i = 0; i < 120; i++) if (d.mask[i] !== 1 && (d.gr[i] < 0.2 || d.gr[i] > 3 || d.rt[i] < 0.2 || d.rt[i] > 3.2)) return false; return true; })());

/* 2. 缺失/异常识别 */
var det0 = M.detectAnomaly(d, 0, 1.0);
var det1 = M.detectAnomaly(d, 1, 1.0);
check('detectAnomaly 预测长度=120', det0.pred.length === 120 && det1.pred.length === 120);
check('detectAnomaly 检测到异常', (function () { for (var i = 0; i < 120; i++) if (det1.pred[i] === 1) return true; return false; })());
check('detectAnomaly acc 有界[0,1]', det1.acc >= 0 && det1.acc <= 1, det1.acc);
check('detectAnomaly 存在判错', det1.errs.length > 0, det1.errs.length);
check('detectAnomaly 跨曲线≥单曲线', det1.acc >= det0.acc, det1.acc + ' vs ' + det0.acc);
var det2 = M.detectAnomaly(d, 1, 1.6);
check('detectAnomaly 阈值不同结果不同', Math.abs(det1.acc - det2.acc) > 0.01, det1.acc + ' vs ' + det2.acc);

/* 3. 序列插补 */
var imp0 = M.impute(d, 0), imp1 = M.impute(d, 1);
check('impute 补全长度=120', imp0.gr.length === 120 && imp1.gr.length === 120);
check('impute 补全有界', (function () { for (var i = 0; i < 120; i++) if (d.mask[i] === 1 && (imp1.gr[i] < 0.2 || imp1.gr[i] > 3 || imp1.rt[i] < 0.2 || imp1.rt[i] > 3.2)) return false; return true; })());
check('impute 重建误差有界', imp0.mae >= 0 && imp1.mae >= 0, imp0.mae + ' / ' + imp1.mae);
check('impute 跨曲线≤邻点', imp1.mae <= imp0.mae, imp1.mae + ' vs ' + imp0.mae);
check('impute 存在待复核', imp1.errs.length > 0, imp1.errs.length);

console.log('------------------------------------------');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过');
process.exit(0);
