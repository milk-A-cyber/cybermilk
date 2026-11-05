/* s1-fault-interp 案例验证脚本
   用法：node _validate.js
   验证模型层函数的行为（纯 Node，不依赖浏览器）。 */
'use strict';

var fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

var M = require('./demo/demo.js');

console.log('[s1-fault-interp] 模型层单测');

/* 1. 合成地震剖面 */
var seis = M.genSeismic(64, 48, 3, 20261105);
check('genSeismic 返回 W/H/amp/faultLabel', seis.W === 64 && seis.H === 48 && seis.amp.length === 64 * 48 && seis.faultLabel.length === 64 * 48);
check('断层条数为 3', seis.faults.length === 3);
var gtCount = 0;
for (var i = 0; i < 64 * 48; i++) gtCount += seis.faultLabel[i];
check('断层像素占比 < 10%（类别稀疏）', gtCount / (64 * 48) < 0.1, '占比=' + (gtCount / (64 * 48)).toFixed(3));

/* 2. 断层概率体 */
var prob = M.faultProb(seis, 0.6, 0.15);
check('faultProb 返回概率数组', prob.prob.length === 64 * 48);
/* 断层像素概率应显著高于背景 */
var pFault = 0, pBg = 0, nF = 0, nB = 0;
for (var j = 0; j < 64 * 48; j++) {
  if (seis.faultLabel[j]) { pFault += prob.prob[j]; nF++; }
  else { pBg += prob.prob[j]; nB++; }
}
check('断层处概率高于背景', (pFault / nF) > (pBg / nB), '断层=' + (pFault / nF).toFixed(2) + ' 背景=' + (pBg / nB).toFixed(2));

/* 3. 权重越高断层越清晰 */
var probLow = M.faultProb(seis, 0.2, 0.15);
var probHigh = M.faultProb(seis, 1.2, 0.15);
var gapLow = 0, gapHigh = 0;
for (var k = 0; k < 64 * 48; k++) {
  if (seis.faultLabel[k]) { gapLow += probLow.prob[k] - 0; gapHigh += probHigh.prob[k]; }
}
check('权重提高断层响应增强', (gapHigh / nF) > (gapLow / nF));

/* 4. 骨架化 */
var skel = M.skeletonFault(seis, prob.prob, 0.5, 8);
check('skeletonFault 返回 mask/skel/pts', skel.pts.length > 0 && skel.skel.length === 64 * 48);
/* 骨架像素少于阈值像素（细化） */
var maskCount = 0, skelCount = 0;
for (var m = 0; m < 64 * 48; m++) { maskCount += skel.mask[m]; skelCount += skel.skel[m]; }
check('骨架比掩膜更细', skelCount <= maskCount);

/* 5. 断层组合 */
var grp = M.faultGroup(seis, skel.pts, 8);
check('faultGroup 返回断层段', grp.groups.length >= 0 && typeof grp.totalGroups === 'number');
/* 最小延伸长度越大，保留段越少 */
var grpSmall = M.faultGroup(seis, skel.pts, 2);
var grpBig = M.faultGroup(seis, skel.pts, 30);
check('minLen 越大保留越少', grpBig.groups.length <= grpSmall.groups.length);

/* 6. RemoteBridge.live 状态 */
check('Model 导出完整', typeof M.genSeismic === 'function' && typeof M.faultProb === 'function' && typeof M.skeletonFault === 'function' && typeof M.faultGroup === 'function');

console.log('');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过（' + 0 + ' 失败）');
process.exit(0);
