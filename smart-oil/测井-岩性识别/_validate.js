/* =========================================================
   岩性识别 · 模型层离线验证
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

console.log('w4 岩性识别 · 模型层单测');
console.log('------------------------------------------');

/* 1. 测井+定名合成 */
var d = M.genLitho(100, 20261161);
check('genLitho 长度=100', d.n === 100 && d.gr.length === 100 && d.rt.length === 100 && d.den.length === 100 && d.u.length === 100);
check('genLitho 岩性合法', (function () { for (var i = 0; i < 100; i++) if (d.litho[i] < 0 || d.litho[i] >= M.LITHO.length) return false; return true; })());
check('genLitho 段>3', d.segs.length > 3, d.segs.length);
check('genLitho 段连续', (function () { var prev = 0; for (var i = 0; i < d.segs.length; i++) { if (d.segs[i].s !== prev) return false; prev = d.segs[i].e; } return prev === 100; })());
check('genLitho 岩性种类≥3', (function () { var st = {}; for (var i = 0; i < 100; i++) st[d.litho[i]] = 1; return Object.keys(st).length >= 3; })());
check('genLitho 曲线有界', (function () { for (var i = 0; i < 100; i++) if (d.gr[i] < 0 || d.gr[i] > 3 || d.rt[i] < 0 || d.rt[i] > 3.2) return false; return true; })());

/* 2. 交会图基线 */
var cp = M.crossPlot(d, 1.6, 2.0);
check('crossPlot 预测长度=100', cp.pred.length === 100);
check('crossPlot 预测合法', (function () { for (var i = 0; i < 100; i++) if (cp.pred[i] < 0 || cp.pred[i] >= M.LITHO.length) return false; return true; })());
check('crossPlot acc 有界[0,1]', cp.acc >= 0 && cp.acc <= 1, cp.acc);
check('crossPlot 存在判错', cp.errs.length > 0, cp.errs.length);
var cp2 = M.crossPlot(d, 2.4, 2.0);
check('crossPlot 边界不同结果不同', Math.abs(cp.acc - cp2.acc) > 0.01, cp.acc + ' vs ' + cp2.acc);

/* 3. 序列分类 */
var cl0 = M.lithoClassify(d, 0), cl1 = M.lithoClassify(d, 1);
check('lithoClassify 预测长度=100', cl0.pred.length === 100 && cl1.pred.length === 100);
check('lithoClassify acc 有界', cl1.acc >= 0 && cl1.acc <= 1, cl1.acc);
check('lithoClassify 多曲线≥单曲线', cl1.acc >= cl0.acc, cl1.acc + ' vs ' + cl0.acc);
check('lithoClassify 多曲线≥交会图', cl1.acc >= cp.acc, cl1.acc + ' vs ' + cp.acc);
check('lithoClassify 存在判错', cl1.errs.length > 0, cl1.errs.length);
check('lithoClassify errs 合法', cl1.errs.every(function (e) { return e.idx >= 0 && e.idx < 100 && e.pred >= 0 && e.pred < M.LITHO.length; }));

console.log('------------------------------------------');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过');
process.exit(0);
