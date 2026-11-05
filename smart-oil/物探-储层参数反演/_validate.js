/* s4-res-inversion 案例验证脚本
   用法：node _validate.js
   验证模型层函数的行为（纯 Node，不依赖浏览器）。 */
'use strict';

var fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

var M = require('./demo/demo.js');

console.log('[s4-res-inversion] 模型层单测');

/* 1. 井震数据 */
var well = M.genWell(60, 20261112);
check('genWell 返回井序列', well.n === 60 && well.poro.length === 60 && well.attr.length === 3);
check('孔隙度在合理范围', well.poro.every(function (p) { return p >= 0.02 && p <= 0.4; }));

/* 2. 深度回归 */
var reg = M.deepRegress(well, 0.6);
check('deepRegress 返回预测', reg.pred.length === 60);
var re = M.regEval(well, reg.pred);
check('RMSE 非负且合理', re.rmse >= 0 && re.rmse < 0.3, 'rmse=' + re.rmse.toFixed(3));
check('相关系数在 [0,1]', re.corr >= 0 && re.corr <= 1, 'corr=' + re.corr.toFixed(2));
/* 权重越高 RMSE 越低 */
var reLow = M.regEval(well, M.deepRegress(well, 0.2).pred);
var reHigh = M.regEval(well, M.deepRegress(well, 1.2).pred);
check('权重提高 RMSE 下降', reHigh.rmse < reLow.rmse, 'low=' + reLow.rmse.toFixed(3) + ' high=' + reHigh.rmse.toFixed(3));

/* 3. 多属性融合 */
var fuse = M.multiFuse(well, 0.5, 0.3, 0.2);
check('multiFuse 返回预测', fuse.pred.length === 60);
var fe = M.fuseEval(well, fuse.pred);
check('融合 RMSE 非负', fe.rmse >= 0);
/* 极端权重（全振幅）应差于均衡 */
var feExt = M.fuseEval(well, M.multiFuse(well, 1.0, 0.0, 0.0).pred);
check('均衡融合优于单属性极端', fe.rmse <= feExt.rmse + 0.01, '均衡=' + fe.rmse.toFixed(3) + ' 极端=' + feExt.rmse.toFixed(3));

/* 4. 物理约束 */
var pred = M.deepRegress(well, 0.6).pred;
var pc = M.physConstrain(pred, 0.02, 0.35);
check('physConstrain 校正到范围', pc.out.every(function (v) { return v >= 0.02 && v <= 0.35; }));
var outCount = 0;
for (var i = 0; i < pred.length; i++) if (pred[i] < 0.02 || pred[i] > 0.35) outCount++;
check('越界计数一致', pc.outOfRange === outCount, 'pc=' + pc.outOfRange + ' 实际=' + outCount);
/* 约束越紧越界越多 */
var pcLoose = M.physConstrain(pred, 0.0, 0.6);
var pcTight = M.physConstrain(pred, 0.1, 0.2);
check('约束越紧越界越多', pcTight.outOfRange >= pcLoose.outOfRange);

/* 5. 孔隙度场 */
var field = M.genPoroField(56, 40, 20261114);
check('genPoroField 返回场', field.W === 56 && field.H === 40 && field.f.length === 56 * 40);

/* 6. Model 导出完整 */
check('Model 导出完整', typeof M.genWell === 'function' && typeof M.deepRegress === 'function' && typeof M.multiFuse === 'function' && typeof M.physConstrain === 'function');

console.log('');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过（' + 0 + ' 失败）');
process.exit(0);
