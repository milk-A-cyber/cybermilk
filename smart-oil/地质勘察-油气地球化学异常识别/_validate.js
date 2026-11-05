/* =========================================================
   油气地球化学异常识别 · 离线自检（Node）
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

console.log('油气地球化学异常识别 · 模型层自检');

/* ---- 1. 接口存在 ---- */
['genPoints', 'detectAnomaly', 'clusterAnomaly', 'interpProb', 'layerProb', 'targetOverlap'].forEach(function (f) {
  check(typeof M[f] === 'function', f + ' 存在');
});

/* ---- 2. 采样点（屏 1） ---- */
var geo = M.genPoints(300, 4, 0.35, 20261103);
var pts = geo.pts;
check(geo.W && geo.H, '采样区尺寸存在');
check(pts.length >= 300, '采样点 >=300（背景 300 + 异常区，实测 ' + pts.length + '）');
check(geo.nMetric === 6, '多指标 6 项（实测 ' + geo.nMetric + '）');
var nAnom = 0, i;
for (i = 0; i < pts.length; i++) if (pts[i].target) nAnom++;
console.log('      [info] 异常点 ' + nAnom + ' / ' + pts.length);

/* ---- 3. 多指标异常检测（屏 1） ---- */
var det = M.detectAnomaly(pts, geo.nMetric, 0.35);
check(det.score.length === pts.length, '异常分数数组长度 = 采样点');
check(det.s1.length === pts.length, '单指标分数数组长度 = 采样点');
/* 多指标命中率应高于单指标（组合异常被协同度抓住） */
function hitRate(score, th) {
  var h = 0;
  for (var i = 0; i < pts.length; i++) if (score[i] > th && pts[i].target) h++;
  return h;
}
var th = det.score.reduce(function (a, b) { return a + b; }) / det.score.length;
var multiHit = hitRate(det.score, th), singleHit = hitRate(det.s1, th);
console.log('      [info] 多指标命中 ' + multiHit + ' · 单指标命中 ' + singleHit + '（阈值=均值）');
check(multiHit >= singleHit, '多指标命中 >= 单指标（协同度有效）');

/* ---- 4. 空间聚类（屏 2） ---- */
var cl = M.clusterAnomaly(pts, det.score, 0.6, 2.2, 4);
check(typeof cl.nCluster === 'number', '靶区数存在（实测 ' + cl.nCluster + '）');
check(cl.labels.length === pts.length, '标签数组长度 = 采样点');
check(cl.clusters.length === cl.nCluster, '簇列表与靶区数一致');

/* ---- 5. 概率图与重叠（屏 3） ---- */
var ip = M.interpProb(pts, det.score, 30, 2, 12);
check(ip.grid.length === 30 * 30, '插值栅格 30×30');
var layer = M.layerProb(ip.grid, 30, 0.75, 0.45);
check(layer.length === 30 * 30, '分层栅格 30×30');
var ov = M.targetOverlap(pts, ip.grid, 30, 0.55);
check(ov >= 0 && ov <= 1, '靶区重合度在 [0,1]（实测 ' + ov.toFixed(2) + '）');
check(ov > 0.3, '重合度 >0.3（算法圈到已知靶区）');

/* ---- 6. 参数区分度 ---- */
var det2 = M.detectAnomaly(pts, geo.nMetric, 0.6);
check(det2.score.length === pts.length, '噪声变化后分数长度仍 = 采样点');
var ipH = M.interpProb(pts, det.score, 30, 4, 12);
var ovH = M.targetOverlap(pts, ipH.grid, 30, 0.55);
console.log('      [info] power=2 重合 ' + ov.toFixed(2) + ' · power=4 重合 ' + ovH.toFixed(2));

/* ---- 汇总 ---- */
console.log('\n==== 结果：' + pass + ' 通过 / ' + warn + ' 警告 / ' + fail + ' 失败 ====');
process.exit(fail > 0 ? 1 : 0);
