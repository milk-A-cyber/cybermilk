/* =========================================================
   气测异常智能解释 · 模型层离线验证
   用法：node _validate.js
   通过则打印各用例结果并以 exit 0 结束；任一失败 exit 1。
   ========================================================= */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, 'demo', 'demo.js'), 'utf8');
var sandbox = { module: { exports: {} }, exports: {}, console: console, Math: Math, Float64Array: Float64Array, Int32Array: Int32Array };
sandbox.global = sandbox; sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'demo.js' });
var M = sandbox.module.exports;

var fail = 0;
function check(name, cond, d) { if (cond) console.log('  ✓ ' + name); else { fail++; console.error('  ✗ ' + name + (d !== undefined ? ' → ' + d : '')); } }
function f(v) { return Number(v).toFixed(3); }

console.log('m2 气测异常智能解释 · 模型层单测');
console.log('------------------------------------------');

/* 1. 气测曲线合成 */
var g = M.genGas(100, 20261171);
check('genGas 长度=100', g.n === 100 && g.gas.length === 100, g.n);
check('genGas 气测有界[0,1.2]', (function () { for (var i = 0; i < 100; i++) if (g.gas[i] < 0 || g.gas[i] > 1.2) return false; return true; })());
check('genGas 密度合理', (function () { for (var i = 0; i < 100; i++) if (g.dens[i] < 1.1 || g.dens[i] > 1.2) return false; return true; })());
check('genGas 异常段=3', g.seg.length === 3, g.seg.length);
check('genGas 异常段含流体', g.seg.every(function (s) { return s.fluid >= 1 && s.fluid <= 3; }));

/* 2. 基线校正 */
var bc0 = M.baselineCorr(g, 0);
var bc1 = M.baselineCorr(g, 1);
check('baselineCorr 未校正=原始', (function () { for (var i = 0; i < 100; i++) if (bc0.corr[i] !== g.gas[i]) return false; return true; })());
check('baselineCorr 校正后有界', (function () { for (var i = 0; i < 100; i++) if (bc1.corr[i] < 0 || bc1.corr[i] > 1.2) return false; return true; })());
/* 校正后异常段峰值应高于背景（背景排除三段异常：20-38/50-64/74-86） */
var peakBg = 0, peakSeg = 0;
function inSeg(i) { return (i >= 20 && i < 38) || (i >= 50 && i < 64) || (i >= 74 && i < 86); }
for (var i2 = 0; i2 < 100; i2++) { if (!inSeg(i2)) peakBg = Math.max(peakBg, bc1.corr[i2]); }
for (i2 = 22; i2 < 36; i2++) peakSeg = Math.max(peakSeg, bc1.corr[i2]);
check('baselineCorr 异常段峰值>背景', peakSeg > peakBg, f(peakSeg) + ' vs ' + f(peakBg));

/* 3. 异常段识别 */
var det = M.anomalyDetect(bc1.corr, 0.35);
check('anomalyDetect mask 长度=100', det.mask.length === 100, det.mask.length);
check('anomalyDetect 检出异常段>0', det.seg.length > 0, det.seg.length);
check('anomalyDetect 段内全在异常', (function () { for (var i = 0; i < det.seg.length; i++) { for (var k = det.seg[i].s; k < det.seg[i].e; k++) if (!det.mask[k]) return false; } return true; })());
/* 阈值越高越保守 */
var detL = M.anomalyDetect(bc1.corr, 0.2);
var detH = M.anomalyDetect(bc1.corr, 0.6);
check('anomalyDetect 阈值高段少', detH.seg.length <= detL.seg.length, detH.seg.length + ' vs ' + detL.seg.length);

/* 4. 流体性质判别 */
var fc = M.fluidClassify(g, bc1, det, 1);
check('fluidClassify seg 长度>0', fc.seg.length > 0, fc.seg.length);
check('fluidClassify 判对>0', fc.seg.filter(function (x) { return x.pred === x.fluid; }).length > 0, fc.seg.filter(function (x) { return x.pred === x.fluid; }).length);
check('fluidClassify 有真值', fc.seg.every(function (x) { return x.fluid >= 1 && x.fluid <= 3; }));
/* 只看峰值 vs 峰值+组分比 */
var fc0 = M.fluidClassify(g, bc1, det, 0);
var accF0 = fc0.seg.filter(function (x) { return x.pred === x.fluid; }).length / fc0.seg.length;
var accF1 = fc.seg.filter(function (x) { return x.pred === x.fluid; }).length / fc.seg.length;
check('fluidClassify 峰值+组分比≥只看峰值', accF1 >= accF0, f(accF1) + ' vs ' + f(accF0));

/* 5. 弱标签学习 */
var wl0 = M.weakLearn(g, bc1, det, 0, 0.35);
var wl1 = M.weakLearn(g, bc1, det, 1, 0.35);
check('weakLearn details 长度一致', wl0.details.length === wl0.n, wl0.n);
check('weakLearn 校正后≥校正前', wl1.adj >= wl1.acc, f(wl1.adj) + ' vs ' + f(wl1.acc));
check('weakLearn 弱标签校正=真值准确', wl1.adj >= wl0.adj, f(wl1.adj) + ' vs ' + f(wl0.adj));

console.log('------------------------------------------');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过');
process.exit(0);
