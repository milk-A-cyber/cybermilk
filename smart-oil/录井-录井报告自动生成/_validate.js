/* =========================================================
   录井报告自动生成 · 模型层离线验证
   用法：node _validate.js
   通过则打印各用例结果并以 exit 0 结束；任一失败 exit 1。
   ========================================================= */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, 'demo', 'demo.js'), 'utf8');
var sandbox = { module: { exports: {} }, exports: {}, console: console, Math: Math, Array: Array, String: String, Number: Number };
sandbox.global = sandbox; sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'demo.js' });
var M = sandbox.module.exports;

var fail = 0;
function check(name, cond, d) { if (cond) console.log('  ✓ ' + name); else { fail++; console.error('  ✗ ' + name + (d !== undefined ? ' → ' + d : '')); } }

console.log('m5 录井报告自动生成 · 模型层单测');
console.log('------------------------------------------');

/* 1. 录井数据合成 */
var well = M.genWell(20261181);
check('genWell 井深>0', well.depth > 0 && well.depth < 400, well.depth);
check('genWell 地层 4—6 层', well.n >= 4 && well.n <= 6, well.n);
check('genWell 层连续', (function () { var prev = 0; for (var i = 0; i < well.n; i++) { if (well.strata[i].top !== prev) return false; prev = well.strata[i].base; } return prev === well.depth; })());
check('genWell 岩性合法', well.strata.every(function (s) { return s.litho >= 0 && s.litho <= 3; }));
check('genWell 历史报告=3', well.history.length === 3, well.history.length);

/* 2. 信息抽取 */
var e0 = M.extractInfo(well, 0);
var e1 = M.extractInfo(well, 1);
check('extractInfo 要点≥4', e1.items.length >= 4, e1.items.length);
check('extractInfo 完整不漏显示', e1.gasN >= e0.gasN, e1.gasN + ' vs ' + e0.gasN);
check('extractInfo 有油气显示', e1.gasN >= 1, e1.gasN);
check('extractInfo 地层数=well', e1.layerN === well.n, e1.layerN);

/* 3. 模板化生成 */
var tpl = M.tplGen(e1);
check('tplGen 段落≥3', tpl.text.length >= 3, tpl.text.length);
check('tplGen 含井况', tpl.text.some(function (t) { return t.indexOf('井况') >= 0; }));
check('tplGen 含油气显示', tpl.text.some(function (t) { return t.indexOf('油气显示') >= 0; }));

/* 4. 检索增强生成 */
var r0 = M.ragEnhance(well, 0);
var r1 = M.ragEnhance(well, 1);
check('ragEnhance 不检索=0', r0.refs.length === 0, r0.refs.length);
check('ragEnhance 检索引用>0', r1.refs.length > 0, r1.refs.length);
check('ragEnhance 引用来自历史库', r1.refs.every(function (r) { return well.history.some(function (h) { return h.name === r.name; }); }));
check('ragEnhance 引用全为佐证段', r1.refs.every(function (r) { return r.ref === 1; }));

console.log('------------------------------------------');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过');
process.exit(0);
