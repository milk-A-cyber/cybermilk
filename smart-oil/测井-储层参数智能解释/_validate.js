/* =========================================================
   储层参数智能解释 · 模型层离线验证
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

console.log('w2 储层参数智能解释 · 模型层单测');
console.log('------------------------------------------');

/* 1. 测井+岩心合成 */
var d = M.genCore(120, 20261191);
check('genCore 长度=120', d.n === 120 && d.rt.length === 120 && d.den.length === 120 && d.porC.length === 120);
check('genCore 孔隙度有界', (function () { for (var i = 0; i < 120; i++) if (d.porC[i] < 0.02 || d.porC[i] > 0.35) return false; return true; })());
check('genCore 低阻段>0', d.lowRes.length > 0, d.lowRes.length);
check('genCore 岩心样点>20', d.coreIdx.length >= 20, d.coreIdx.length);
check('genCore 岩心样点不越界', d.coreIdx.every(function (i) { return i >= 0 && i < 120; }));
check('genCore 低阻段在井内', d.lowRes.every(function (l) { return l.s >= 0 && l.e < 120 && l.e >= l.s; }));

/* 2. 深度回归 */
var r0 = M.deepReg(d, 0), r1 = M.deepReg(d, 1);
check('deepReg 长度=120', r0.por.length === 120 && r1.por.length === 120);
check('deepReg 孔隙度有界', (function () { for (var i = 0; i < 120; i++) if (r1.por[i] < 0.02 || r1.por[i] > 0.35) return false; return true; })());
check('deepReg R² 有界[0,1]', r1.r2 >= 0 && r1.r2 <= 1, r1.r2);
check('deepReg 深度≥线性', r1.r2 >= r0.r2, r1.r2 + ' vs ' + r0.r2);

/* 3. 迁移学习 */
var t0 = M.transferLearn(d, 0), t1 = M.transferLearn(d, 1);
check('transferLearn R² 有界', t1.r2 >= 0 && t1.r2 <= 0.95, t1.r2);
check('transferLearn 迁移≥未迁移', t1.r2 >= t0.r2, t1.r2 + ' vs ' + t0.r2);
check('transferLearn note 区分', t0.note.indexOf('未迁移') >= 0 && t1.note.indexOf('已迁移') >= 0);

/* 4. 物理约束 */
var p0 = M.physicsConstrain(d, 0), p1 = M.physicsConstrain(d, 1);
check('physicsConstrain 低阻误差有界', p1.lowErr > 0 && p1.lowErr < 1, p1.lowErr);
check('physicsConstrain 约束误差↓', p1.lowErr < p0.lowErr, p1.lowErr + ' vs ' + p0.lowErr);
check('physicsConstrain 约束一致↑', p1.agree >= p0.agree, p1.agree + ' vs ' + p0.agree);

console.log('------------------------------------------');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过');
process.exit(0);
