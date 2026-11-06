/* =========================================================
   岩屑岩性自动识别 · 模型层离线验证
   用法：node _validate.js
   通过则打印各用例结果并以 exit 0 结束；任一失败 exit 1。
   ========================================================= */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, 'demo', 'demo.js'), 'utf8');
var sandbox = { module: { exports: {} }, exports: {}, console: console, Math: Math, Float64Array: Float64Array, Int8Array: Int8Array, Int32Array: Int32Array };
sandbox.global = sandbox; sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'demo.js' });
var M = sandbox.module.exports;

var fail = 0;
function check(name, cond, d) { if (cond) console.log('  ✓ ' + name); else { fail++; console.error('  ✗ ' + name + (d !== undefined ? ' → ' + d : '')); } }
function f(v) { return Number(v).toFixed(3); }

console.log('m1 岩屑岩性自动识别 · 模型层单测');
console.log('------------------------------------------');

/* 1. 岩屑图像合成 */
var data = M.genCuttings(60, 20261161, 0);
check('genCuttings 长度=60', data.n === 60, data.n);
check('genCuttings 特征有界[0,1]', data.feats.every(function (x) { return x.feat[0] >= 0 && x.feat[0] <= 1 && x.feat[1] >= 0 && x.feat[1] <= 1; }));
check('genCuttings 标签合法', data.feats.every(function (x) { return x.label >= 0 && x.label < 6; }));
check('genCuttings 计数和=60', data.counts.reduce(function (a, b) { return a + b; }, 0) === 60, data.counts.reduce(function (a, b) { return a + b; }, 0));
/* 不均衡模式少数类样本最少 */
var imb = M.genCuttings(60, 20261161, 1);
var minCnt = Math.min.apply(null, Array.from(imb.counts));
check('genCuttings 不均衡模式含少数类', minCnt < 60 / 6, minCnt);

/* 2. 细粒度分类 */
var cls = M.fineClassify(data, 0.7, 0.05);
check('fineClassify pred 长度=60', cls.pred.length === 60, cls.pred.length);
check('fineClassify prob 长度=60', cls.prob.length === 60, cls.prob.length);
check('fineClassify 概率归一化', (function () { for (var i = 0; i < 60; i++) { var s = cls.prob[i].reduce(function (a, b) { return a + b; }, 0); if (Math.abs(s - 1) > 0.05) return false; } return true; })());
check('fineClassify 准确率>0.5', cls.acc > 0.5, f(cls.acc));
/* 高粒度比低粒度准 */
var clsL = M.fineClassify(data, 0.2, 0.05);
var clsH = M.fineClassify(data, 1.0, 0.05);
check('fineClassify 高粒度更准', clsH.acc > clsL.acc, f(clsH.acc) + ' vs ' + f(clsL.acc));

/* 3. 多标签识别 */
var ml = M.multiLabel(data, 0.7);
check('multiLabel ratio 长度=60', ml.ratio.length === 60, ml.ratio.length);
check('multiLabel 组分归一化', (function () { for (var i = 0; i < 60; i++) { var s = ml.ratio[i].reduce(function (a, b) { return a + b; }, 0); if (Math.abs(s - 1) > 0.05) return false; } return true; })());
check('multiLabel main 合法', ml.main.every(function (v) { return v >= 0 && v < 6; }));

/* 4. 类别不均衡处理 */
var b = M.balanceTrain(data, 1, 0.7);
check('balanceTrain recall 长度=6', b.recall.length === 6, b.recall.length);
check('balanceTrain 权重提升少数类', b.adjRecall[5] >= b.recall[5], f(b.adjRecall[5]) + ' vs ' + f(b.recall[5]));
var b0 = M.balanceTrain(data, 0, 0.7);
check('balanceTrain 加权比 none 宏平均高', b.macro > b0.macro, f(b.macro) + ' vs ' + f(b0.macro));
var b2 = M.balanceTrain(data, 2, 0.7);
check('balanceTrain 重采样宏平均最高', b2.macro >= b.macro, f(b2.macro) + ' vs ' + f(b.macro));

console.log('------------------------------------------');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过');
process.exit(0);
