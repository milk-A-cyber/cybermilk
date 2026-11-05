/* =========================================================
   钻时曲线地层划分 · 模型层离线验证
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
function f(v) { return Number(v).toFixed(3); }

console.log('m4 钻时曲线地层划分 · 模型层单测');
console.log('------------------------------------------');

/* 1. 钻时曲线合成 */
var d = M.genROP(120, 20261191);
check('genROP 长度=120', d.n === 120 && d.rop.length === 120, d.n);
check('genROP 钻时有界[0.2,20]', (function () { for (var i = 0; i < 120; i++) if (d.rop[i] < 0.2 || d.rop[i] > 20) return false; return true; })());
check('genROP 工况合理', (function () { for (var i = 0; i < 120; i++) if (d.w[i] < 4 || d.w[i] > 14 || d.r[i] < 40 || d.r[i] > 75) return false; return true; })());
check('genROP 地层段=4', d.seg.length === 4, d.seg.length);
check('genROP 地层段含岩性', d.seg.every(function (s) { return s.litho >= 0 && s.litho <= 3; }));

/* 2. 参数归一化 */
var n0 = M.ropNorm(d, 0);
var n1 = M.ropNorm(d, 1);
check('ropNorm 未校正=原始', (function () { for (var i = 0; i < 120; i++) if (n0[i] !== d.rop[i]) return false; return true; })());
check('ropNorm 校正后有界', (function () { for (var i = 0; i < 120; i++) if (n1[i] < 0.2 || n1[i] > 20) return false; return true; })());
/* 归一化去工况干扰：段内方差应更小（段内更平） */
function segVar(arr, s, e) { var m = 0; for (var i = s; i < e; i++) m += arr[i]; m /= (e - s); var v = 0; for (i = s; i < e; i++) v += (arr[i] - m) * (arr[i] - m); return v / (e - s); }
var rawVar = segVar(d.rop, 8, 38) + segVar(d.rop, 38, 64);
var normVar = segVar(n1, 8, 38) + segVar(n1, 38, 64);
check('ropNorm 归一化去工况段内更平', normVar < rawVar, f(normVar) + ' vs ' + f(rawVar));

/* 3. 变点检测 */
var cd = M.changeDetect(n1, 0.9);
check('changeDetect 检出边界>0', cd.bd.length > 0, cd.bd.length);
check('changeDetect 边界在井段内', cd.bd.every(function (b) { return b.pos >= 5 && b.pos < 115; }));
/* 灵敏度越高边界越少 */
var cdL = M.changeDetect(n1, 0.5);
var cdH = M.changeDetect(n1, 1.6);
check('changeDetect 灵敏度高边界少', cdH.bd.length <= cdL.bd.length, cdH.bd.length + ' vs ' + cdL.bd.length);

/* 4. 边界命中 */
var bm = M.boundaryMatch(d, cd, 8);
check('boundaryMatch 命中≥1', bm.hit >= 1, bm.hit);
check('boundaryMatch 总边界=3', bm.total === 3, bm.total);
check('boundaryMatch 不超总边界', bm.hit <= bm.total, bm.hit + ' vs ' + bm.total);

/* 5. 多源验证 */
var cv0 = M.crossVerify(d, cd, 0);
var cv1 = M.crossVerify(d, cd, 1);
check('crossVerify 一致率≥0', cv0.agree >= 0 && cv0.agree <= cv0.total, cv0.agree);
check('crossVerify 多源一致率更高', cv1.agree >= cv0.agree, cv1.agree + ' vs ' + cv0.agree);
check('crossVerify 分层合法', cv0.segs.every(function (x) { return x.litho >= 0 && x.litho <= 3; }));

console.log('------------------------------------------');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过');
process.exit(0);
