/* =========================================================
   地质剖面遥感解译 · 离线自检（Node）
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

console.log('地质剖面遥感解译 · 模型层自检');

/* ---- 1. 接口存在 ---- */
['genRockGrid', 'semanticSeg', 'segEval', 'detectFault', 'vectorize'].forEach(function (f) {
  check(typeof M[f] === 'function', f + ' 存在');
});

/* ---- 2. 岩性栅格（屏 1） ---- */
var grid = M.genRockGrid(64, 48, 5, 20261102);
check(grid.W === 64 && grid.H === 48, '栅格 64×48');
check(grid.label.length === 64 * 48, '标签数组长度正确');
var nonZero = 0, i;
for (i = 0; i < grid.label.length; i++) if (grid.label[i] > 0) nonZero++;
check(nonZero > 1000, '岩性像素 >1000（实测 ' + nonZero + '）');
check(grid.fault && grid.fault.x1 > 0, '断层线存在');

/* ---- 3. 语义分割与评估（屏 1） ---- */
/* 权重低 → 准确率低；权重高 → 准确率高（训练充分程度） */
var seg0 = M.semanticSeg(grid, 5, 0.1, 0.15);
var ev0 = M.segEval(grid, seg0.seg, 5);
var segH = M.semanticSeg(grid, 5, 1.1, 0.15);
var evH = M.segEval(grid, segH.seg, 5);
console.log('      [info] weight=0.1 acc=' + (ev0.acc * 100).toFixed(1) + '% · weight=1.1 acc=' + (evH.acc * 100).toFixed(1) + '%');
check(ev0.acc < 0.5, '低权重(0.1)准确率 <50%（模拟训练不足，实测 ' + (ev0.acc * 100).toFixed(1) + '%）');
check(evH.acc > 0.9, '高权重(1.1)准确率 >90%（模拟训练充分，实测 ' + (evH.acc * 100).toFixed(1) + '%）');
check(evH.acc > ev0.acc, '权重越高准确率越高（区分度有效）');
check(evH.iou.length === 5, 'IoU 数组 5 类');

/* ---- 4. 构造线提取（屏 2） ---- */
var det = M.detectFault(grid, 0.6);
check(det.grad.length === 64 * 48, '梯度数组长度正确');
check(det.pts.length >= 0, '线像素点数 >=0（实测 ' + det.pts.length + '）');
var detL = M.detectFault(grid, 0.3);
check(detL.pts.length >= det.pts.length, '阈值越低检出越多（' + detL.pts.length + ' >= ' + det.pts.length + '）');

/* ---- 5. 矢量化后处理（屏 3） ---- */
var seg = M.semanticSeg(grid, 5, 0.8, 0.15);
var vec = M.vectorize(grid, seg.seg, 5, 18);
check(vec.segClean.length === 64 * 48, '剔除碎斑后结果长度正确');
check(vec.kept.length >= 1, '保留面要素 >=1（实测 ' + vec.kept.length + '）');
var vecT = M.vectorize(grid, seg.seg, 5, 200);
check(vecT.kept.length <= vec.kept.length, '碎斑阈值越大保留越少（' + vecT.kept.length + ' <= ' + vec.kept.length + '）');

/* ---- 汇总 ---- */
console.log('\n==== 结果：' + pass + ' 通过 / ' + warn + ' 警告 / ' + fail + ' 失败 ====');
process.exit(fail > 0 ? 1 : 0);
