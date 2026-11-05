/* =========================================================
   露头裂缝自动统计 · 离线自检（Node）
   运行：node _validate.js
   输出：N 通过 / M 警告 / K 失败
   ========================================================= */
var path = require('path');
var M = require(path.join(__dirname, 'demo', 'demo.js'));

var pass = 0, warn = 0, fail = 0;
function ok(msg) { pass++; console.log('  [PASS] ' + msg); }
function ww(msg) { warn++; console.log('  [WARN] ' + msg); }
function bad(msg) { fail++; console.log('  [FAIL] ' + msg); }
function check(cond, msg, isWarn) { (cond ? ok : (isWarn ? ww : bad))('' + msg); }

console.log('露头裂缝自动统计 · 模型层自检');

/* ---- 1. 接口存在 ---- */
['genOutcrop', 'instanceSeg', 'skeletonize', 'calibAttitude', 'verifyAttitude'].forEach(function (f) {
  check(typeof M[f] === 'function', f + ' 存在');
});

/* ---- 2. 露头照片（屏 1） ---- */
var scan = M.genOutcrop(20261105, 64, 48);
check(scan.W === 64 && scan.H === 48, '露头栅格 64×48');
check(scan.px.length === 64 * 48, '像素数组长度正确');
check(scan.cracks.length >= 1, '裂缝 >=1（实测 ' + scan.cracks.length + '）');
check(scan.groups.length === 3, '3 组优势走向');

/* ---- 3. 实例分割（屏 1） ---- */
var seg = M.instanceSeg(scan, 0.5, 91);
check(seg.masks.length >= 1, '掩膜 >=1（实测 ' + seg.masks.length + '）');
check(seg.recall >= 0 && seg.recall <= 1, '召回率在 [0,1]（实测 ' + seg.recall.toFixed(2) + '）');
var segHi = M.instanceSeg(scan, 0.8, 91);
check(segHi.recall <= seg.recall, '阈值高召回率不升（' + segHi.recall.toFixed(2) + ' <= ' + seg.recall.toFixed(2) + '）');

/* ---- 4. 骨架化（屏 2） ---- */
var skel = M.skeletonize(seg, 2, 55);
check(skel.skeletons.length >= 1, '骨架 >=1（实测 ' + skel.skeletons.length + '）');
check(skel.total === seg.masks.length, '骨架总数 = 掩膜数');
var skelL = M.skeletonize(seg, 4, 55);
check(skelL.nSkel <= skel.nSkel, '最小长度越大骨架越少（' + skelL.nSkel + ' <= ' + skel.nSkel + '）');

/* ---- 5. 产状反算（屏 3） ---- */
var atts = M.calibAttitude(skel, 0.3, 23);
check(atts.attitudes.length >= 1, '产状记录 >=1');
check(atts.rose.length === 18, '走向玫瑰图 18 组');
check(atts.meanErr >= 0, '平均走向误差 >=0（实测 ' + atts.meanErr.toFixed(1) + '）');
var attsLo = M.calibAttitude(skel, 0.05, 23);
check(attsLo.meanErr <= atts.meanErr, '标定误差小则走向误差小（' + attsLo.meanErr.toFixed(1) + ' <= ' + atts.meanErr.toFixed(1) + '）');

/* ---- 6. 实测验证 ---- */
var ver = M.verifyAttitude(atts, 0.3, 6);
check(ver.nV >= 1, '验证条数 >=1（实测 ' + ver.nV + '）');
check(ver.meanErr >= 0, '验证误差 >=0（实测 ' + ver.meanErr.toFixed(1) + '）');

/* ---- 汇总 ---- */
console.log('\n==== 结果：' + pass + ' 通过 / ' + warn + ' 警告 / ' + fail + ' 失败 ====');
process.exit(fail > 0 ? 1 : 0);
