/* =========================================================
   地质图件要素智能提取 · 离线自检（Node）
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

console.log('地质图件要素智能提取 · 模型层自检');

/* ---- 1. 接口存在 ---- */
['genScanMap', 'detectObjects', 'ocrRead', 'layoutAnalyze', 'traceVectors'].forEach(function (f) {
  check(typeof M[f] === 'function', f + ' 存在');
});

/* ---- 2. 扫描图件（屏 1） ---- */
var scan = M.genScanMap(20261105, 64, 48);
check(scan.W === 64 && scan.H === 48, '扫描图 64×48');
check(scan.px.length === 64 * 48, '像素数组长度正确');
check(scan.faults.length >= 1, '断层线 >=1（实测 ' + scan.faults.length + '）');
check(scan.symbols.length >= 1, '图例符号 >=1（实测 ' + scan.symbols.length + '）');
check(scan.notes.length >= 1, '注记 >=1（实测 ' + scan.notes.length + '）');

/* ---- 3. 目标检测（屏 1） ---- */
var det = M.detectObjects(scan, 0.5, 20261105);
check(det.dets.length >= 1, '检测框 >=1（实测 ' + det.dets.length + '）');
check(det.recall >= 0 && det.recall <= 1, '召回率在 [0,1]（实测 ' + det.recall.toFixed(2) + '）');
check(det.precision >= 0 && det.precision <= 1, '精确率在 [0,1]（实测 ' + det.precision.toFixed(2) + '）');
/* 阈值区分度：高阈值更保守，召回率下降 */
var detHi = M.detectObjects(scan, 0.7, 20261105);
check(detHi.recall <= det.recall, '阈值高召回率不升（' + detHi.recall.toFixed(2) + ' <= ' + det.recall.toFixed(2) + '）');

/* ---- 4. OCR 识别（屏 2） ---- */
var ocr = M.ocrRead(scan, 0.15, 77);
check(ocr.results.length === scan.notes.length, 'OCR 结果数 = 注记数');
check(ocr.acc >= 0 && ocr.acc <= 1, '识别准确率在 [0,1]（实测 ' + ocr.acc.toFixed(2) + '）');
var ocrLo = M.ocrRead(scan, 0.05, 77), ocrHi = M.ocrRead(scan, 0.5, 77);
check(ocrLo.acc >= ocrHi.acc, '错误率越高准确率越低（' + ocrLo.acc.toFixed(2) + ' >= ' + ocrHi.acc.toFixed(2) + '）');

/* ---- 5. 版面分析与矢量追踪（屏 3） ---- */
var lay = M.layoutAnalyze(scan);
check(lay.regions.length >= 2, '版面区块 >=2（实测 ' + lay.regions.length + '）');
var vec = M.traceVectors(scan, 3);
check(vec.vectors.length === scan.faults.length, '矢量条数 = 断层数（实测 ' + vec.vectors.length + '）');
check(vec.nVector >= 1, '矢量要素 >=1');
var vecHi = M.traceVectors(scan, 6);
check(vecHi.linked >= vec.linked, 'gap 越大连接越多（' + vecHi.linked + ' >= ' + vec.linked + '）');

/* ---- 汇总 ---- */
console.log('\n==== 结果：' + pass + ' 通过 / ' + warn + ' 警告 / ' + fail + ' 失败 ====');
process.exit(fail > 0 ? 1 : 0);
