/* =========================================================
   钻具失效预测 · 模型层离线验证
   用法：node _validate.js
   通过则打印各用例结果并以 exit 0 结束；任一失败 exit 1。
   ========================================================= */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, 'demo', 'demo.js'), 'utf8');
var sandbox = { module: { exports: {} }, exports: {}, console: console, Math: Math, Float64Array: Float64Array, Int8Array: Int8Array };
sandbox.global = sandbox; sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'demo.js' });
var M = sandbox.module.exports;

var fail = 0;
function check(name, cond, d) { if (cond) console.log('  ✓ ' + name); else { fail++; console.error('  ✗ ' + name + (d !== undefined ? ' → ' + d : '')); } }
function f(v) { return Number(v).toFixed(3); }

console.log('d4 钻具失效预测 · 模型层单测');
console.log('------------------------------------------');

/* 1. 振动/扭矩合成 */
var vib = M.genVibration(120, 20261141);
check('genVibration 长度=120', vib.n === 120, vib.n);
check('genVibration vib 有界[0,1.4]', vib.vib.every(function (v) { return v >= 0 && v <= 1.4; }));
check('genVibration tor 有界[3,15]', vib.tor.every(function (v) { return v >= 3 && v <= 15; }));
check('genVibration 含冲击工况', vib.mode.indexOf(2) >= 0, '');
/* 工况段振动差异 */
var m0 = 0, m2 = 0;
for (var i = 0; i < 120; i++) { if (vib.mode[i] === 0) m0 += vib.vib[i]; if (vib.mode[i] === 2) m2 += vib.vib[i]; }
check('genVibration 冲击工况振动更大', m2 > m0 * 1.5, f(m2) + ' vs ' + f(m0));

/* 2. 疲劳累积 */
var fat = M.fatigueAccum(vib.vib, 120, 1);
check('fatigueAccum 损伤长度=120', fat.damage.length === 120, fat.damage.length);
check('fatigueAccum 损伤非降', (function () { for (var i = 1; i < 120; i++) if (fat.damage[i] < fat.damage[i - 1]) return false; return true; })());
check('fatigueAccum 累计损伤>0', fat.cum > 0, fat.cum);
check('fatigueAccum 累计损伤有界[0,1.1]', fat.cum >= 0 && fat.cum <= 1.1, fat.cum);
check('fatigueAccum 损伤加速(尾部速率更大)', (fat.damage[110] - fat.damage[100]) > (fat.damage[20] - fat.damage[10]), f(fat.damage[110] - fat.damage[100]) + ' vs ' + f(fat.damage[20] - fat.damage[10]));

/* 3. 剩余寿命 */
var rul = M.rulPredict(fat.damage, 2, 120, 100);
check('rulPredict RUL 长度=120', rul.rul.length === 120, rul.rul.length);
check('rulPredict RUL 非负', rul.rul.every(function (v) { return v >= 0; }));
check('rulPredict RUL 递减(末端<前端)', rul.rul[119] < rul.rul[10], f(rul.rul[119]) + ' vs ' + f(rul.rul[10]));
var rul0 = M.rulPredict(fat.damage, 0, 120, 100);
var rul1 = M.rulPredict(fat.damage, 1, 120, 100);
var rul2 = M.rulPredict(fat.damage, 2, 120, 100);
check('rulPredict 混合误差最小', rul2.err < rul0.err && rul2.err < rul1.err, f(rul2.err) + ' vs ' + f(rul0.err) + ' vs ' + f(rul1.err));

/* 4. 起钻建议 */
var tripA = M.tripAdvice(rul.rul, 15, 100);
check('tripAdvice 返回建议', typeof tripA.advice === 'string');
check('tripAdvice remaining>0', tripA.remaining > 0, tripA.remaining);
check('tripAdvice suggest 布尔', typeof tripA.suggest === 'boolean');
/* 阈值极高必建议起钻 */
var tripHi = M.tripAdvice(rul.rul, 80, 100);
check('tripAdvice 高阈值建议起钻', tripHi.suggest === true, tripHi.suggest);

console.log('------------------------------------------');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过');
process.exit(0);
