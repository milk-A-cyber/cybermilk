/* d1-rop-optimize 案例验证脚本
   用法：node _validate.js
   验证模型层函数的行为（纯 Node，不依赖浏览器）。 */
'use strict';

var fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

var M = require('./demo/demo.js');

console.log('[d1-rop-optimize] 模型层单测');

/* 1. 钻时序列 */
var seq = M.genDrill(60, 20261131);
check('genDrill 返回井序列', seq.n === 60 && seq.rop.length === 60 && seq.wob.length === 60 && seq.rpm.length === 60);
check('钻速在合理范围', seq.rop.every(function (r) { return r >= 2 && r <= 22; }), 'min=' + Math.min.apply(null, seq.rop).toFixed(1) + ' max=' + Math.max.apply(null, seq.rop).toFixed(1));
check('随钻参数在范围', seq.wob.every(function (w) { return w >= 4 && w <= 15; }) && seq.rpm.every(function (r) { return r >= 30 && r <= 80; }));

/* 2. 钻速预测 */
var pred = M.ropPredict(seq, 0.7);
check('ropPredict 返回预测', pred.pred.length === 60);
var ev = M.ropEval(seq, pred.pred);
check('RMSE 非负且合理', ev.rmse >= 0 && ev.rmse < 3, 'rmse=' + ev.rmse.toFixed(2));
check('相关系数在 [0,1]', ev.corr >= 0 && ev.corr <= 1, 'corr=' + ev.corr.toFixed(2));
var evLow = M.ropEval(seq, M.ropPredict(seq, 0.2).pred);
var evHigh = M.ropEval(seq, M.ropPredict(seq, 1.1).pred);
check('权重提高 RMSE 下降', evHigh.rmse < evLow.rmse, 'low=' + evLow.rmse.toFixed(2) + ' high=' + evHigh.rmse.toFixed(2));

/* 3. 钻速代理模型 */
var m1 = M.ropModel(8, 50);
var mPeak = M.ropModel(10, 60);
check('代理模型返回 rop/risk', typeof m1.rop === 'number' && typeof m1.risk === 'number');
check('中部钻速高于边缘', mPeak.rop > m1.rop, 'edge=' + m1.rop.toFixed(1) + ' peak=' + mPeak.rop.toFixed(1));
var riskHigh = M.ropModel(13.5, 50).risk;
var riskLow = M.ropModel(8, 45).risk;
check('钻压过大风险升高', riskHigh > riskLow, 'low=' + riskLow.toFixed(1) + ' high=' + riskHigh.toFixed(1));

/* 4. 贝叶斯优化 */
var opt = M.bayesOptimize(24, 20261133);
check('bayesOptimize 返回 best+trace', !!opt.best && Array.isArray(opt.trace) && opt.trace.length === 24);
check('最优在合理参数范围', opt.best.wob >= 5 && opt.best.wob <= 14 && opt.best.rpm >= 35 && opt.best.rpm <= 75, 'wob=' + opt.best.wob.toFixed(1) + ' rpm=' + opt.best.rpm.toFixed(0));
check('最优钻速合理', opt.best.rop > 8 && opt.best.rop <= 22, 'rop=' + opt.best.rop.toFixed(1));
/* 迭代越多轨迹越长 */
check('迭代数控制轨迹长度', M.bayesOptimize(40, 20261133).trace.length === 40);

/* 5. 保守 vs 最优 */
var cons = M.conservativeParams();
var ropCons = M.ropModel(cons.wob, cons.rpm);
var ropOpt = M.ropModel(opt.best.wob, opt.best.rpm);
check('保守参数返回', cons.wob === 8.2 && cons.rpm === 48);
check('最优钻速高于保守', ropOpt.rop > ropCons.rop, 'cons=' + ropCons.rop.toFixed(1) + ' opt=' + ropOpt.rop.toFixed(1));

/* 6. Model 导出完整 */
check('Model 导出完整', typeof M.genDrill === 'function' && typeof M.ropPredict === 'function' && typeof M.ropEval === 'function' && typeof M.ropModel === 'function' && typeof M.bayesOptimize === 'function');

console.log('');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过（' + 0 + ' 失败）');
process.exit(0);
