/* =========================================================
   荧光图像智能判读 · 模型层离线验证
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

console.log('m3 荧光图像智能判读 · 模型层单测');
console.log('------------------------------------------');

/* 1. 荧光图像合成 */
var d = M.genFluor(240, 20261181, 0);
check('genFluor 长度=240', d.n === 240 && d.imgs.length === 240, d.n);
check('genFluor 特征有界[0,1]', d.imgs.every(function (x) { return x.bright >= 0 && x.bright <= 1 && x.sat >= 0 && x.sat <= 1 && x.area >= 0 && x.area <= 1; }));
check('genFluor 级别合法', d.imgs.every(function (x) { return x.level >= 0 && x.level <= 4; }));
/* 灯源差异：灯源0偏暗 */
var d0 = M.genFluor(240, 20261181, 0);
var d1 = M.genFluor(240, 20261181, 1);
var m0 = d0.imgs.reduce(function (a, b) { return a + b.bright; }, 0) / d0.n;
var m1 = d1.imgs.reduce(function (a, b) { return a + b.bright; }, 0) / d1.n;
check('genFluor 灯源0更暗', m0 < m1, f(m0) + ' vs ' + f(m1));

/* 2. 成像标准化 */
var s0 = M.stdImaging(d, 0);
var s1 = M.stdImaging(d, 1);
check('stdImaging 未校正=原始', s0.imgs.every(function (x, i) { return Math.abs(x.bright - d.imgs[i].bright) < 1e-9; }));
check('stdImaging 校正后有界', s1.imgs.every(function (x) { return x.bright >= 0 && x.bright <= 1; }));
/* 标准化后两灯源亮度均值接近 */
var n0 = M.stdImaging(M.genFluor(120, 20261181, 0), 1);
var n1 = M.stdImaging(M.genFluor(120, 20261181, 1), 1);
var nm0 = n0.imgs.reduce(function (a, b) { return a + b.bright; }, 0) / n0.n;
var nm1 = n1.imgs.reduce(function (a, b) { return a + b.bright; }, 0) / n1.n;
check('stdImaging 标准化后灯源亮度接近', Math.abs(nm0 - nm1) < 0.05, f(nm0) + ' vs ' + f(nm1));

/* 3. 颜色特征工程 */
var cf0 = M.colorFeat(s1, 0);
var cf1 = M.colorFeat(s1, 1);
check('colorFeat 单特征维度=1', cf0.feats.every(function (x) { return x.length === 1; }));
check('colorFeat 多特征维度=3', cf1.feats.every(function (x) { return x.length === 3; }));
check('colorFeat 特征有界', cf1.feats.every(function (x) { return x.every(function (v) { return v >= 0 && v <= 1; }); }));

/* 4. 含油级别分类 */
var cls = M.fluorClassify(s1, [0.2, 0.38, 0.56, 0.74]);
check('fluorClassify pred 长度=240', cls.pred.length === 240, cls.pred.length);
check('fluorClassify 级别合法', cls.pred.every(function (x) { return x >= 0 && x <= 4; }));
check('fluorClassify 准确率>0.5', cls.acc > 0.5, f(cls.acc));
/* 阈值松 → 全判低级别 */
var clsLoose = M.fluorClassify(s1, [0.05, 0.1, 0.2, 0.4]);
check('fluorClassify 阈值松级别低', clsLoose.acc < cls.acc, f(clsLoose.acc) + ' vs ' + f(cls.acc));

console.log('------------------------------------------');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过');
process.exit(0);
