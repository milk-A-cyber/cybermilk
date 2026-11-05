/* =========================================================
   井眼轨迹智能控制 · 模型层离线验证
   用法：node _validate.js
   通过则打印各用例结果并以 exit 0 结束；任一失败 exit 1。
   ========================================================= */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, 'demo', 'demo.js'), 'utf8');
var sandbox = { module: { exports: {} }, exports: {}, console: console, Math: Math, Float64Array: Float64Array };
sandbox.global = sandbox; sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'demo.js' });
var M = sandbox.module.exports;

var fail = 0;
function check(name, cond, d) { if (cond) console.log('  ✓ ' + name); else { fail++; console.error('  ✗ ' + name + (d !== undefined ? ' → ' + d : '')); } }
function f(v) { return Number(v).toFixed(3); }

console.log('d3 井眼轨迹智能控制 · 模型层单测');
console.log('------------------------------------------');

/* 1. 轨迹合成 */
var surv = M.genSurvey(12, 20261131);
check('genSurvey 测点数=12', surv.n === 12, surv.n);
check('genSurvey md 递增', surv.md[1] > surv.md[0] && surv.md[11] > surv.md[10]);
check('genSurvey inc 有界[0.5,89]', surv.inc.every(function (v) { return v >= 0.5 && v <= 89; }));
check('genSurvey 每测距≈25m', Math.round(surv.md[1] - surv.md[0]) === 25, surv.md[1] - surv.md[0]);

/* 2. 轨迹拟合 */
var fit = M.fitTrajectory(surv, 0);
check('fitTrajectory 长度=12', fit.n === 12, fit.n);
check('fitTrajectory 垂深递增', fit.tv[11] > fit.tv[10] && fit.tv[10] > 0);
check('fitTrajectory 水平位移>0', fit.vs[11] > 0, fit.vs[11]);
check('fitTrajectory 全角变化率有界[0,20]', fit.dog.every(function (v) { return v >= 0 && v < 20; }));

/* 3. 模型预测控制 */
var mpc = M.mpcControl(surv, 50, 4, 20261132);
check('mpcControl 命令长度=12', mpc.cmd.length === 12, mpc.cmd.length);
check('mpcControl 命令有界[-3,3]', mpc.cmd.every(function (v) { return v >= -3 && v <= 3; }));
check('mpcControl 预测偏差长度=12', mpc.pred.length === 12, mpc.pred.length);
var lastDev = Math.abs(mpc.pred[11]);
check('mpcControl 预测偏差收敛(末步|偏差|<初步)', lastDev < Math.abs(mpc.pred[0]), f(lastDev) + ' vs ' + f(Math.abs(mpc.pred[0])));

/* 4. 安全校验 */
var safe = M.safetyCheck(fit, mpc.cmd, { dogleg: 4, friction: 8 });
check('safetyCheck 返回 ok 布尔', typeof safe.ok === 'boolean', safe.ok);
check('safetyCheck doglegMax>0', safe.doglegMax > 0, safe.doglegMax);
check('safetyCheck friction>0', safe.friction > 0, safe.friction);
check('safetyCheck hits 是数组', Array.isArray(safe.hits), typeof safe.hits);
/* 严格阈值必越界 */
var safeTight = M.safetyCheck(fit, mpc.cmd, { dogleg: 0.001, friction: 0.001 });
check('safetyCheck 严格阈值越界', safeTight.ok === false, safeTight.ok);

/* 5. 建议 vs 闭环 */
var adv0 = M.advToControl(0, mpc, fit);
var adv1 = M.advToControl(1, mpc, fit);
check('advToControl 闭环落靶率更高', adv1.fallRate > adv0.fallRate, adv1.fallRate + ' vs ' + adv0.fallRate);
check('advToControl 闭环摩擦节省更高', adv1.frictionSave > adv0.frictionSave, adv1.frictionSave + ' vs ' + adv0.frictionSave);
check('advToControl 平滑度[0,1]', adv1.smooth >= 0 && adv1.smooth <= 1, adv1.smooth);
check('advToControl mode 正确', adv0.mode === 0 && adv1.mode === 1);

console.log('------------------------------------------');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过');
process.exit(0);
