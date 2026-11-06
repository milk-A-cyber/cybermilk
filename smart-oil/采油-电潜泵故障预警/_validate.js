/* =========================================================
   电潜泵故障预警 · 离线自检（Node）
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
function inRange(v, lo, hi, msg) { check(v >= lo && v <= hi, msg + ' = ' + v.toFixed ? '' + msg + ' = ' + v.toFixed(3) : '' + msg, false); }

console.log('电潜泵故障预警 · 模型层自检');

/* ---- 1. 接口存在 ---- */
check(typeof M.genCurrent === 'function', 'genCurrent 存在');
check(typeof M.slideZscore === 'function', 'slideZscore 存在');
check(typeof M.detectAnomaly === 'function', 'detectAnomaly 存在');
check(typeof M.genDegrade === 'function', 'genDegrade 存在');
check(typeof M.trueRul === 'function', 'trueRul 存在');
check(typeof M.fitTrend === 'function', 'fitTrend 存在');
check(typeof M.predictRUL === 'function', 'predictRUL 存在');
check(typeof M.genFleet === 'function', 'genFleet 存在');
check(typeof M.classify === 'function', 'classify 存在');
check(typeof M.fleetEval === 'function', 'fleetEval 存在');

/* ---- 2. 电流卡片（屏 1） ---- */
var cur = M.genCurrent('scaling', 0.8, 20261102);
check(cur.i.length === 720, '电流 720 点 (scaling)');
check(cur.segs.length === 1 && cur.segs[0][0] === 260, 'scaling 故障段标注 [260,720]');
check(cur.base === 92, '基线 92A');

/* normal 误报低 */
var nrm = M.genCurrent('normal', 0.8, 20261102);
var dn = M.detectAnomaly(nrm.i, nrm.segs, 'z', nrm.base, 3.0, 10, 40);
check(dn.fp < 0.05, '正常工况 趋势检测误报率 <5%（实测 ' + (dn.fp * 100).toFixed(1) + '%）');

/* scaling：趋势检测命中 > 绝对值命中（演示只看绝对值漏检） */
var cur2 = M.genCurrent('scaling', 0.8, 20261102);
var dz = M.detectAnomaly(cur2.i, cur2.segs, 'z', cur2.base, 3.0, 10, 40);
var da = M.detectAnomaly(cur2.i, cur2.segs, 'abs', cur2.base, 3.0, 10, 40);
check(dz.hit > 0.6, '结垢 趋势检测命中 >60%（实测 ' + (dz.hit * 100).toFixed(1) + '%）');
check(da.hit < dz.hit, '结垢 绝对值命中 < 趋势检测命中（abs=' + (da.hit * 100).toFixed(1) + '% < trend=' + (dz.hit * 100).toFixed(1) + '%，体现"缓慢爬升漏检"）');
check(da.hit < 0.6, '结垢 绝对值命中 <60%（前半段在 ±8A 内被漏掉，实测 ' + (da.hit * 100).toFixed(1) + '%）');

/* 停泵：由"只看绝对值"抓（已发生故障，预警意义在停泵前） */
var stp = M.genCurrent('shutdown', 0.8, 20261102);
var dsta = M.detectAnomaly(stp.i, stp.segs, 'abs', stp.base, 3.0, 10, 40);
check(dsta.hit > 0.5, '停泵 绝对值命中 >50%（实测 ' + (dsta.hit * 100).toFixed(1) + '%）');

/* 滑窗特征 */
var fs = M.featStats(cur2.i, 40);
check(fs.mean.length === 720 && fs.slope.length === 720 && fs.sd.length === 720, '滑窗特征三序列长度正确');

/* ---- 3. 退化与剩余寿命（屏 2） ---- */
['mild', 'moderate', 'severe'].forEach(function (k) {
  var dg = M.genDegrade(k, 20261103);
  check(dg.values.length === 90, k + ' 退化曲线 90 天');
  check(dg.threshold === 22, k + ' 阈值 22');
  check(dg.values[0] > dg.values[88], k + ' 单调下降（退化）');
});
var dm = M.genDegrade('moderate', 20261103);
var tru = M.trueRul(dm.values, 60, 22);
var pre = M.predictRUL(dm.values, 60, 20, 22);
console.log('      [info] moderate day60 真实RUL=' + tru + ' 模型估计RUL=' + pre);
check(pre != null, 'moderate day60 可外推估计 RUL');
check(pre != null && Math.abs(pre - tru) <= 12, 'moderate day60 RUL 误差 <=12 天（实测 ' + (pre == null ? 'null' : Math.abs(pre - tru)) + '）');
var fit = M.fitTrend(dm.values, 41, 60);
check(fit.slope < -0.25, 'moderate 拟合斜率显著为负（约 -0.30，实测 ' + fit.slope.toFixed(3) + '）');

/* ---- 4. 分层预警（屏 3） ---- */
var fleet = M.genFleet(20261104);
check(fleet.length === 24, '井群 24 口');
var fCnt = fleet.filter(function (w) { return w.state === 'fault'; }).length;
check(fCnt > 0, '含故障井 ' + fCnt + ' 口');

/* 分级单调：分数越高级别越高 */
var c0 = M.classify(0.0, 0.8, 0.5);   /* 正常 score=0.32 */
var c1 = M.classify(0.3, 1.2, 0.5);   /* 关注 score=0.78 */
var c2 = M.classify(0.7, 1.7, 0.5);   /* 预警 score=1.38 */
var c3 = M.classify(1.1, 2.8, 0.5);   /* 紧急 score=2.22 */
check(c0 === 0 && c1 === 1 && c2 === 2 && c3 === 3, '四级分级边界正确（0/1/2/3 = ' + c0 + '/' + c1 + '/' + c2 + '/' + c3 + '）');

/* 灵敏度单调：thr 越小越激进（级别越高） */
var aggr = M.classify(1.0, 2.4, 0.2);
var cons = M.classify(1.0, 2.4, 0.8);
check(aggr >= cons, '灵敏度：激进(thr=0.2)级别 ' + aggr + ' >= 保守(thr=0.8)级别 ' + cons);

/* 默认灵敏度评估 */
var ev = M.fleetEval(fleet, 0.5);
console.log('      [info] thr=0.5 检出率=' + (ev.detectRate * 100).toFixed(1) + '% 误报率=' + (ev.falseAlarmRate * 100).toFixed(1) + '% 平均提前=' + ev.avgLead.toFixed(1) + '天 紧急=' + ev.urgentCount + ' 复核=' + ev.reviewCount);
check(ev.detectRate > 0.8, '检出率 >80%（实测 ' + (ev.detectRate * 100).toFixed(1) + '%）');
check(ev.falseAlarmRate < 0.1, '紧急误报率 <10%（实测 ' + (ev.falseAlarmRate * 100).toFixed(1) + '%）');
check(ev.avgLead >= 15, '平均提前量 >=15 天（与案例 metrics 目标一致，实测 ' + ev.avgLead.toFixed(1) + '）');
check(ev.cm.length === 2 && ev.cm[0].length === 4 && ev.cm[1].length === 4, '混淆矩阵 2×4 结构');

/* ---- 汇总 ---- */
console.log('\n==== 结果：' + pass + ' 通过 / ' + warn + ' 警告 / ' + fail + ' 失败 ====');
process.exit(fail > 0 ? 1 : 0);

