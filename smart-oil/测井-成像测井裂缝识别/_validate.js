/* =========================================================
   成像测井裂缝识别 · 模型层离线验证
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

console.log('w3 成像测井裂缝识别 · 模型层单测');
console.log('------------------------------------------');

/* 1. 成像图合成 */
var img = M.genImage(20261191, 30, 20);
check('genImage 尺寸=30×20', img.W === 30 && img.H === 20 && img.cells.length === 600 && img.mask.length === 600);
check('genImage 亮度有界[0,1]', (function () { for (var i = 0; i < 600; i++) if (img.cells[i] < 0 || img.cells[i] > 1) return false; return true; })());
check('genImage 裂缝>3', img.fracs.length > 3, img.fracs.length);
check('genImage 掩膜非空', (function () { var c = 0; for (var i = 0; i < 600; i++) c += img.mask[i]; return c > 10; })());
check('genImage 天然缝>0', img.fracs.some(function (f) { return f.type === 'nat'; }));
check('genImage 诱导缝>0', img.fracs.some(function (f) { return f.type === 'ind'; }));
check('genImage 含低角度天然缝', img.fracs.some(function (f) { return f.type === 'nat' && f.amp < 2.2; }));

/* 2. 语义分割 */
var sg = M.fractureSeg(img, 0.55);
check('fractureSeg 掩膜长度=600', sg.seg.length === 600);
check('fractureSeg IoU 有界[0,1]', sg.iou >= 0 && sg.iou <= 1, sg.iou);
check('fractureSeg 检出一部分', sg.tp > 20, sg.tp);
check('fractureSeg 存在误检(FP>0)', sg.fp > 0, sg.fp);
var sgH = M.fractureSeg(img, 0.7);
check('fractureSeg 高阈值 IoU 变化', Math.abs(sg.iou - sgH.iou) > 0.01, sg.iou + ' vs ' + sgH.iou);

/* 3. 诱导缝鉴别 */
var f0 = M.fractureFilter(img, 0), f1 = M.fractureFilter(img, 1);
check('fractureFilter 条数=裂缝数', f0.list.length === img.fracs.length, f0.list.length);
check('fractureFilter 宽松存在判错', f0.err > 0, f0.err);
check('fractureFilter 宽松 err 有界', f0.err >= 0 && f0.err <= img.fracs.length);
check('fractureFilter 宽松/严格不同', f0.err !== f1.err, f0.err + ' vs ' + f1.err);
check('fractureFilter 分类合法', f0.list.every(function (it) { return (it.pred === 'nat' || it.pred === 'ind') && (it.true === 'nat' || it.true === 'ind'); }));

console.log('------------------------------------------');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过');
process.exit(0);
