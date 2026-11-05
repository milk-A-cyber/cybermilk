/* =========================================================
   井下复杂事故前兆预警 · 模型层离线验证
   用法：node _validate.js
   通过则打印各用例结果并以 exit 0 结束；任一失败 exit 1。
   ========================================================= */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

/* 加载 demo.js 的模型层（module.exports 分支） */
var src = fs.readFileSync(path.join(__dirname, 'demo', 'demo.js'), 'utf8');
var sandbox = { module: { exports: {} }, exports: {}, console: console, Math: Math, Float64Array: Float64Array };
sandbox.global = sandbox; sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'demo.js' });
var M = sandbox.module.exports;

var fail = 0;
function check(name, cond, d) { if (cond) console.log('  ✓ ' + name); else { fail++; console.error('  ✗ ' + name + (d !== undefined ? ' → ' + d : '')); } }
function f(v) { return Number(v).toFixed(3); }

console.log('d2 井下复杂事故前兆预警 · 模型层单测');
console.log('------------------------------------------');

/* 1. 通道合成 */
var ch = M.genChannels(60, 20261141);
check('genChannels 通道数=4', ch.data.length === 4, ch.data.length);
check('genChannels 长度=60', ch.data[0].length === 60, ch.data[0].length);
check('genChannels 值有界 [0.5,70]', ch.data.every(function (a) { return a.every(function (v) { return v >= 0.5 && v <= 70; }); }));

/* 2. 异常注入 */
var inj = M.injectAnomaly(ch, 40, 0, 0.7, 20261142);
check('injectAnomaly 返回通道数=4', inj.data.length === 4);
check('injectAnomaly 长度=60', inj.data[0].length === 60);
check('injectAnomaly 前兆段扭矩抬升', inj.data[0][44] > ch.data[0][44] + 1, inj.data[0][44].toFixed(2) + ' vs ' + ch.data[0][44].toFixed(2));
check('injectAnomaly 前兆段流量下降', inj.data[2][44] < ch.data[2][44], inj.data[2][44].toFixed(2) + ' vs ' + ch.data[2][44].toFixed(2));

/* 3. 异常检测 */
var det = M.detectAnomaly(inj, 5, 0.5, ch);
check('detectAnomaly 分数长度=60', det.score.length === 60, det.score.length);
check('detectAnomaly 分数有界[0,1]', det.score.every(function (v) { return v >= 0 && v <= 1; }));
check('detectAnomaly contrib 通道=4', det.contrib.length === 4);
var normalScore = 0, injScore = 0;
for (var t = 0; t < 20; t++) normalScore += det.score[t];
for (t = 38; t < 48; t++) injScore += det.score[t];
check('detectAnomaly 前兆段分数更高', injScore > normalScore, f(injScore) + ' vs ' + f(normalScore));

/* 4. 预警事件 */
var evts = M.alertEvents(det.score, 0.5);
check('alertEvents 命中异常段', evts.length >= 1, evts.length);
if (evts.length) {
  check('alertEvents 起点≈40', evts[0].start >= 36 && evts[0].start <= 42, evts[0].start);
}

/* 5. 不均衡处理 */
var balNone = M.balanceTrain(0.01, 'none', 20261143);
var balUp = M.balanceTrain(0.01, 'upsample', 20261143);
var balSm = M.balanceTrain(0.01, 'smote', 20261143);
check('balanceTrain none 不放大异常', Math.abs(balNone.ratioOut - 0.01) < 1e-9, balNone.ratioOut);
check('balanceTrain upsample 放大异常', balUp.ratioOut > 0.01, balUp.ratioOut);
check('balanceTrain smote 放大异常更多', balSm.ratioOut > balUp.ratioOut, balSm.ratioOut.toFixed(3) + ' vs ' + balUp.ratioOut.toFixed(3));
check('balanceTrain 召回有界[0.4,0.95]', balSm.recall >= 0.4 && balSm.recall <= 0.95, balSm.recall);
check('balanceTrain 误报率有界[0.05,0.35]', balSm.falseRate >= 0.05 && balSm.falseRate <= 0.35, balSm.falseRate);
check('balanceTrain 均衡后召回更高', balSm.recall > balNone.recall, balSm.recall.toFixed(2) + ' vs ' + balNone.recall.toFixed(2));

/* 6. 可解释预警 */
var evt = evts[0];
var expl = M.explainAlert(inj, det.contrib, evt);
check('explainAlert 通道贡献=4', expl.channels.length === 4, expl.channels.length);
check('explainAlert 贡献和为1(±0.01)', Math.abs(expl.channels.reduce(function (a, b) { return a + b.weight; }, 0) - 1) < 0.01);
check('explainAlert 有触发时刻', expl.peakT >= evt.start && expl.peakT <= evt.end, expl.peakT);
check('explainAlert 主因扭矩', expl.channels[0].chan === '扭矩' || expl.channels[0].chan === '立压', expl.channels[0].chan);
check('explainAlert 时长为正', expl.duration >= 1, expl.duration);

console.log('------------------------------------------');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过');
process.exit(0);
