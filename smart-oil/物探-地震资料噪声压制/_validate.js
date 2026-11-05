/* s5-seis-denoise 案例验证脚本
   用法：node _validate.js
   验证模型层函数的行为（纯 Node，不依赖浏览器）。 */
'use strict';

var fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

var M = require('./demo/demo.js');

console.log('[s5-seis-denoise] 模型层单测');

/* 1. 合成剖面 */
var clean = M.genSection(60, 40, 20261121);
check('genSection 返回剖面', clean.W === 60 && clean.H === 40 && clean.data.length === 40 && clean.data[0].length === 60);

/* 2. 加噪声 */
var noisy = M.addNoise(clean, 0, 0.5, 20261122);
check('addNoise 返回含噪剖面', noisy.data.length === 40 && noisy.data[0].length === 60);
check('含噪与干净不同', (function () { var d = 0; for (var y = 0; y < 40; y++) for (var x = 0; x < 60; x++) d += Math.abs(noisy.data[y][x] - clean.data[y][x]); return d > 1; })());

/* 3. 去噪网络 */
var den = M.denoise(noisy, 0.6, 0);
check('denoise 返回去噪剖面', den.data.length === 40);
var ev = M.preserveEval(clean, noisy, den);
check('preserveEval 返回 snrGain/fidelity', typeof ev.snrGain === 'number' && ev.fidelity >= 0 && ev.fidelity <= 1, 'snr=' + ev.snrGain.toFixed(2) + ' fid=' + ev.fidelity.toFixed(2));
check('去噪后信噪比提升为正', ev.snrGain > 0, 'gain=' + ev.snrGain.toFixed(2));
/* 强度过高伤信号 → 保真度下降 */
var denMild = M.denoise(noisy, 0.4, 0);
var denStrong = M.denoise(noisy, 1.0, 0);
var evMild = M.preserveEval(clean, noisy, denMild);
var evStrong = M.preserveEval(clean, noisy, denStrong);
check('过强去噪保真度下降', evStrong.fidelity < evMild.fidelity, 'mild=' + evMild.fidelity.toFixed(2) + ' strong=' + evStrong.fidelity.toFixed(2));

/* 4. 自监督 */
var self = M.selfSup(noisy, 0, 0.6);
check('selfSup 返回去噪剖面', self.data.length === 40);
var evSelf = M.preserveEval(clean, noisy, self);
check('自监督信噪比提升为正', evSelf.snrGain > 0);
/* 域适配高 → 更干净 */
var selfLow = M.preserveEval(clean, noisy, M.selfSup(noisy, 0, 0.2));
var selfHigh = M.preserveEval(clean, noisy, M.selfSup(noisy, 0, 0.9));
check('域适配提高信噪比', selfHigh.snrGain >= selfLow.snrGain - 0.5, 'low=' + selfLow.snrGain.toFixed(2) + ' high=' + selfHigh.snrGain.toFixed(2));

/* 5. 噪声类型齐全 */
check('噪声类型三种', M.NOISE_TYPES.length === 3 && M.NOISE_TYPES[0] === '面波');
var noisy2 = M.addNoise(clean, 1, 0.5, 20261122);
var noisy3 = M.addNoise(clean, 2, 0.5, 20261122);
check('多次波/工业干扰可生成', noisy2.data.length === 40 && noisy3.data.length === 40);

/* 6. 保真度上限：完全保留为 1 */
var evPerfect = M.preserveEval(clean, clean, clean);
check('完全保留保真度为 1', Math.abs(evPerfect.fidelity - 1) < 1e-6, 'fid=' + evPerfect.fidelity);

/* 7. Model 导出完整 */
check('Model 导出完整', typeof M.genSection === 'function' && typeof M.addNoise === 'function' && typeof M.denoise === 'function' && typeof M.selfSup === 'function' && typeof M.preserveEval === 'function');

console.log('');
if (fail > 0) { console.error('失败 ' + fail + ' 项'); process.exit(1); }
console.log('全部通过（' + 0 + ' 失败）');
process.exit(0);
