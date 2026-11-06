/* s2-seismic-facies 案例验证脚本
   用法：node _validate.js
   验证模型层函数的行为（纯 Node，不依赖浏览器）。 */
'use strict';

var fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

var M = require('./demo/demo.js');

console.log('[s2-seismic-facies] 模型层单测');

/* 1. 切片网格 */
var grid = M.genSliceGrid(8, 10, 4, 20261108);
check('genSliceGrid 返回 8×10', grid.rows === 8 && grid.cols === 10 && grid.grid.length === 80);
check('相带类别数正确', grid.nFacies === 4);

/* 2. 切片分类 */
var cls = M.classifySlice(grid, 4, 0.6);
check('classifySlice 返回概率与类别', cls.prob.length === 80 * 4 && cls.cls.length === 80);
/* 权重越高分类越准 */
var evLow = M.classifyEval(grid, M.classifySlice(grid, 4, 0.2).cls, 4);
var evHigh = M.classifyEval(grid, M.classifySlice(grid, 4, 1.2).cls, 4);
check('权重提高整体准确率', evHigh.acc > evLow.acc, 'low=' + evLow.acc.toFixed(2) + ' high=' + evHigh.acc.toFixed(2));

/* 3. F1 计算 */
var ev = M.classifyEval(grid, cls.cls, 4);
check('F1 在 [0,1] 且非空', ev.f1.length === 4 && ev.f1.every(function (x) { return x >= 0 && x <= 1; }));
check('整体准确率在 [0,1]', ev.acc >= 0 && ev.acc <= 1);

/* 4. 半监督扩展 */
var semi = M.semiExpand(grid, cls.prob, cls.cls, 4, 12, 0.7);
var covered = 0;
for (var i = 0; i < semi.covered.length; i++) covered += semi.covered[i];
check('覆盖数 ≥ 井标签数', covered >= semi.nLabeled, 'covered=' + covered);
check('井标签恰好 nLabeled', semi.nLabeled === 12);
/* 阈值越高伪标签越少 */
var semiLow = M.semiExpand(grid, cls.prob, cls.cls, 4, 12, 0.4);
var semiHigh = M.semiExpand(grid, cls.prob, cls.cls, 4, 12, 0.9);
check('伪标签阈值越高覆盖越少', semiHigh.pseudoCount <= semiLow.pseudoCount, 'low=' + semiLow.pseudoCount + ' high=' + semiHigh.pseudoCount);

/* 5. 相带概率体 */
var fp = M.faciesProb(grid, cls.prob, cls.cls, 4, 1);
check('faciesProb 返回平滑类别', fp.clsSmooth.length === 80);
check('平滑后仍是合法相带', fp.clsSmooth.every(function (x) { return x >= 0 && x < 4; }));
/* 平滑次数越多，邻域越一致（盐椒越少） */
function saltPepper(clses, rows, cols) {
  var cnt = 0;
  for (var r = 1; r < rows - 1; r++) {
    for (var c = 1; c < cols - 1; c++) {
      var me = clses[r * cols + c];
      var same = 0;
      for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) if (dr || dc) if (clses[(r + dr) * cols + (c + dc)] === me) same++;
      if (same < 2) cnt++;
    }
  }
  return cnt;
}
var sp0 = saltPepper(M.faciesProb(grid, cls.prob, cls.cls, 4, 0).clsSmooth, 8, 10);
var sp3 = saltPepper(M.faciesProb(grid, cls.prob, cls.cls, 4, 3).clsSmooth, 8, 10);
check('平滑后盐椒噪声减少', sp3 <= sp0, 'sp0=' + sp0 + ' sp3=' + sp3);

/* 6. Model 导出完整 */
check('Model 导出完整', typeof M.genSliceGrid === 'function' && typeof M.classifySlice === 'function' && typeof M.semiExpand === 'function' && typeof M.faciesProb === 'function');

console.log('');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过（' + 0 + ' 失败）');
process.exit(0);
