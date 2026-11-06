/* =========================================================
   测井曲线智能分层 · 模型层离线验证
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

console.log('w1 测井曲线智能分层 · 模型层单测');
console.log('------------------------------------------');

/* 1. 测井曲线合成 */
var d = M.genLog(100, 20261191);
check('genLog 长度=100', d.n === 100 && d.gr.length === 100 && d.sp.length === 100 && d.rt.length === 100 && d.den.length === 100);
check('genLog 曲线有界[0,3]', (function () { for (var i = 0; i < 100; i++) if (d.gr[i] < 0 || d.gr[i] > 3 || d.rt[i] < 0 || d.rt[i] > 3) return false; return true; })());
check('genLog 地层>3', d.seg.length > 3, d.seg.length);
check('genLog 层连续', (function () { var prev = 0; for (var i = 0; i < d.seg.length; i++) { if (d.seg[i].s !== prev) return false; prev = d.seg[i].e; } return prev === 100; })());
check('genLog 含薄互层', d.seg.some(function (s) { return s.thick < 5; }));
check('genLog 岩性合法', d.seg.every(function (s) { return s.litho >= 0 && s.litho <= 3; }));

/* 2. 序列分割 */
var cd = M.segDetect(d, 1, 0.6);
check('segDetect 检出边界>0', cd.bd.length > 0, cd.bd.length);
check('segDetect 边界在井段内', cd.bd.every(function (b) { return b.pos >= 5 && b.pos < 95; }));
var cd0 = M.segDetect(d, 0, 0.6);
var cd1 = M.segDetect(d, 1, 0.6);
check('segDetect 多曲线检出≥单曲线', cd1.bd.length >= cd0.bd.length, cd1.bd.length + ' vs ' + cd0.bd.length);
var cdL = M.segDetect(d, 1, 0.3);
var cdH = M.segDetect(d, 1, 1.2);
check('segDetect 灵敏度高边界少', cdH.bd.length <= cdL.bd.length, cdH.bd.length + ' vs ' + cdL.bd.length);

/* 3. 多曲线融合 */
var mf = M.multiFuse(d);
check('multiFuse 融合长度=100', mf.fusion.length === 100);
check('multiFuse 融合有界', (function () { for (var i = 0; i < 100; i++) if (mf.fusion[i] < 0 || mf.fusion[i] > 3) return false; return true; })());
check('multiFuse 薄互层数>0', mf.thinN > 0, mf.thinN);
check('multiFuse 薄互层=计数', mf.thinN === d.seg.filter(function (s) { return s.thick < 5; }).length);

/* 4. 邻井约束 */
var n0 = M.neighborConstrain(d, cd, 0);
var n1 = M.neighborConstrain(d, cd, 1);
check('neighborConstrain 命中≤总边界', n0.hit <= n0.total, n0.hit);
check('neighborConstrain 有约束命中≥无约束', n1.hit >= n0.hit, n1.hit + ' vs ' + n0.hit);
check('neighborConstrain 偏差=未命中数', n1.diffN === n1.total - n1.hit, n1.diffN);
check('neighborConstrain 命中≥1', n1.hit >= 1, n1.hit);

console.log('------------------------------------------');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过');
process.exit(0);
