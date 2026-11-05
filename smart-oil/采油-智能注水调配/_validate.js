/* =========================================================
   智能注水调配案例包 · 离线自检脚本（Node.js）
   用法：node _validate.js
   覆盖：
   1) case.json JSON 合法性与结构（对照站点 case-upload 校验规则）
   2) demo 文件存在性与引用完整性
   3) 模型层单测：连通估计 / 分层注水模拟 / 代理模型拟合 / 优化增益
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
let fails = 0, warns = 0, okCount = 0;
function ok(m) { okCount++; console.log('  ✓ ' + m); }
function warn(m) { warns++; console.log('  ⚠ ' + m); }
function fail(m) { fails++; console.log('  ✗ ' + m); }

/* ---------- 1. case.json ---------- */
console.log('\n[1] case.json 结构与校验规则');
let raw, pkg;
try {
  raw = fs.readFileSync(path.join(ROOT, 'case.json'), 'utf8');
  pkg = JSON.parse(raw);
  ok('JSON 可解析（' + raw.length + ' bytes）');
} catch (e) { fail('JSON 解析失败：' + e.message); process.exit(1); }

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
if (!pkg.id) fail('缺 id');
else if (!ID_RE.test(pkg.id)) fail('id 格式不合法：' + pkg.id);
else ok('id 合法（kebab-case）：' + pkg.id);

const dataJs = fs.readFileSync(path.join(ROOT, '..', 'assets', 'data.js'), 'utf8');
if (!pkg.sceneId) fail('缺 sceneId');
else if (!new RegExp("id: '" + pkg.sceneId + "'").test(dataJs)) fail('sceneId 不存在于 data.js：' + pkg.sceneId);
else ok('sceneId 存在于 data.js：' + pkg.sceneId + '（采油 · 智能注水调配）');

if (pkg.methods && pkg.methods.length) ok('技术标签：' + pkg.methods.join(' / '));
if (!pkg.title) fail('缺 title');
else if (pkg.title.length > 40) warn('title 偏长（' + pkg.title.length + ' 字）');
else ok('title：' + pkg.title);

const t = pkg.tabs || {};
const b = t.background || {};
const secs = b.sections || [];
if (!b.lede) warn('background 缺 lede');
if (!secs.length) fail('background.sections 为空');
else {
  let bad = secs.filter(s => !s || !s.title || (!s.html && !s.body));
  if (bad.length) fail('有段落缺 title/html');
  else ok('background.sections：' + secs.length + ' 段（建议四段式）');
  if (secs.length < 4) warn('只有 ' + secs.length + ' 段');
}
if (b.judge && b.judge.length !== 4) warn('judge 有 ' + b.judge.length + ' 项（建议 4 项）');
else if (b.judge) ok('judge：4 项');
// 每段 html 里的 svg 是否闭合
secs.forEach((s, i) => {
  const h = s.html || '';
  const open = (h.match(/<svg/g) || []).length, close = (h.match(/<\/svg>/g) || []).length;
  if (open !== close) fail('sections[' + i + '] svg 不配对：' + open + '/' + close);
});
const svgTotal = secs.reduce((a, s) => a + ((s.html || '').match(/<svg/g) || []).length, 0);
ok('专业背景内联可视化图：' + svgTotal + ' 幅 SVG');

const w = t.workflow || {};
const steps = w.steps || [];
if (!steps.length) fail('workflow.steps 为空');
else {
  const badStep = steps.filter(s => !s || !s.name);
  if (badStep.length) fail('有步骤缺 name');
  else ok('workflow.steps：' + steps.length + ' 步');
  const withDo = steps.filter(s => s.do).length;
  const withEff = steps.filter(s => s.effect).length;
  const withTrap = steps.filter(s => s.trap).length;
  ok('每步要点（do/effect/trap）：' + withDo + '/' + withEff + '/' + withTrap);
}
if (w.metrics && w.metrics.html) {
  const mo = (w.metrics.html.match(/<svg/g) || []).length, mc = (w.metrics.html.match(/<\/svg>/g) || []).length;
  if (mo !== mc) fail('metrics svg 不配对');
  else ok('metrics 内联可视化图：' + mo + ' 幅 SVG');
}
if (w.fails && w.fails.length) ok('失败模式：' + w.fails.length + ' 条');

/* ---------- 2. demo 文件 ---------- */
console.log('\n[2] demo 文件与引用');
const demoDir = path.join(ROOT, 'demo');
const files = [];
function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else files.push({ name: path.relative(ROOT, p).replace(/\\/g, '/'), size: st.size });
  }
}
walk(ROOT);
files.forEach(f => console.log('    · ' + f.name + '  (' + f.size + ' B)'));
const htmlFile = files.find(f => f.name === 'demo/index.html');
const jsFile = files.find(f => f.name === 'demo/demo.js');
const cssFile = files.find(f => f.name === 'demo/demo.css');
if (!htmlFile) fail('缺 demo/index.html');
if (!jsFile) fail('缺 demo/demo.js');
if (!cssFile) fail('缺 demo/demo.css');
if (htmlFile && jsFile && cssFile) ok('整页模式三件套齐全');
const total = files.reduce((a, f) => a + f.size, 0) + raw.length;
if (total > 6 * 1024 * 1024) fail('包太大：' + (total / 1024 / 1024).toFixed(1) + ' MB');
else ok('包体积：' + (total / 1024).toFixed(1) + ' KB（< 6 MB）');

if (htmlFile) {
  const html = fs.readFileSync(path.join(ROOT, 'demo', 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"'#]+)["']/g)].map(m => m[1]);
  /* 引用可能带 ?v= 版本号，比较前先剥掉查询串 */
  const missing = refs.filter(r => {
    if (/^(data:|https?:|#|\/\/)/i.test(r)) return false;
    const clean = r.split('?')[0].split('#')[0];
    return !files.some(f => f.name === 'demo/' + clean || f.name.endsWith('/' + clean));
  });
  if (missing.length) fail('index.html 引用的文件不在包里：' + missing.join('、'));
  else ok('index.html 引用完整（demo.css / demo.js 可解析）');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const js = fs.readFileSync(path.join(ROOT, 'demo', 'demo.js'), 'utf8');
  const used = [...js.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
  const missingIds = used.filter(id => !ids.includes(id));
  if (missingIds.length) fail('demo.js 引用了页面不存在的元素：' + [...new Set(missingIds)].join('、'));
  else ok('demo.js 引用的 ' + new Set(used).size + ' 个页面元素全部存在');
}
if (cssFile) {
  const css = fs.readFileSync(path.join(ROOT, 'demo', 'demo.css'), 'utf8');
  const o = (css.match(/{/g) || []).length, c = (css.match(/}/g) || []).length;
  if (o !== c) fail('demo.css 大括号不配对：' + o + '/' + c);
  else ok('demo.css 大括号配对');
}
if (jsFile) {
  try { new Function(fs.readFileSync(path.join(ROOT, 'demo', 'demo.js'), 'utf8')); ok('demo.js 语法通过'); }
  catch (e) { fail('demo.js 语法错误：' + e.message); }
}

/* ---------- 3. 模型层单测 ---------- */
console.log('\n[3] 模型层单测（demo.js 导出的纯函数）');
const M = require(path.join(ROOT, 'demo', 'demo.js'));
if (!M || !M.simulate) { fail('demo.js 未导出模型层'); process.exit(1); }

// 3.1 分层注水模拟
const ms = M.simulate(M.MANUAL, 900, 0, 5);
if (ms.oil > 100 && ms.oil < 135 && ms.wc > 88 && ms.wc < 93) ok('现状方案模拟：产油 ' + ms.oil.toFixed(1) + ' t/d，含水 ' + ms.wc.toFixed(1) + ' %');
else fail('现状方案模拟数值异常：' + JSON.stringify({ oil: ms.oil, wc: ms.wc }));
if (ms.s[0] > ms.s[3] && ms.s[0] > 0.5) ok('层间矛盾成立：高渗层实际吸水 ' + (ms.s[0] * 100).toFixed(0) + '% > 低渗层 ' + (ms.s[3] * 100).toFixed(0) + '%');
else fail('层间矛盾不成立');
// 3.2 优化方向：按理想配注方向分配应显著提升
const testF = M.normAlloc([2, 10, 33, 55]);
const ts = M.simulate(testF, 1000, 0, 6);
if (ts.oil > ms.oil + 20) ok('重分配后产油提升：' + ms.oil.toFixed(1) + ' → ' + ts.oil.toFixed(1) + ' t/d');
else fail('重分配未带来产油提升');
// 3.3 连通估计
const c0 = M.connSeries({ noise: 0, drift: false, seed: 1 });
const e0 = M.estimateGains(c0.inj, c0.prods, true);
const c1 = M.connSeries({ noise: 0, drift: true, seed: 1 });
const eRaw = M.estimateGains(c1.inj, c1.prods, false);
const eDet = M.estimateGains(c1.inj, c1.prods, true);
const g0 = e0.map(r => r.gain), gD = eDet.map(r => r.gain), gR = eRaw.map(r => r.gain);
const errD = g0.reduce((a, v, i) => a + Math.abs(gD[i] - v), 0) / 4;
const errR = g0.reduce((a, v, i) => a + Math.abs(gR[i] - v), 0) / 4;
console.log('    真实增益      : ' + g0.map(v => v.toFixed(2)).join('  '));
console.log('    去趋势估计    : ' + gD.map(v => v.toFixed(2)).join('  '));
console.log('    不去趋势估计  : ' + gR.map(v => v.toFixed(2)).join('  '));
if (errD < 0.12 && errR > 0.25 && gR[3] > 0.3) ok('假连通演示成立：不去趋势误差 ' + errR.toFixed(3) + ' >> 去趋势误差 ' + errD.toFixed(3) + '，P4 被高估到 ' + gR[3].toFixed(2));
else warn('假连通对比不够明显（errD=' + errD.toFixed(3) + ' errR=' + errR.toFixed(3) + '）');
// 3.4 代理模型（高斯核回归）拟合质量：留一交叉验证 RMSE 应显著低于随机猜测（与 demo 一致：60 均匀 + 40 先验聚焦 / σ=0.35 / λ=1e-4）
const rng = M.mulberry32(999);
const X = [], Y = [];
for (let i = 0; i < 100; i++) {
  let f, T;
  if (i < 60) { f = M.sampleAlloc(rng); T = 700 + rng() * 400; }
  else { f = M.normAlloc([0.02 + rng() * 0.07, 0.05 + rng() * 0.14, 0.2 + rng() * 0.24, 0.35 + rng() * 0.25]); T = 850 + rng() * 250; }
  const r = M.simulate(f, T, 0, i + 1);
  X.push([f[0], f[1], f[2], f[3], T / 1200]);
  Y.push([r.oil / 160, r.wc / 100]);
}
const loo = M.loocvErrors(X, Y, 0.35, 1e-4);
console.log('    留一交叉验证 RMSE（产油当量）: ' + (loo.rmse * 160).toFixed(2) + ' t/d');
if (loo.rmse * 160 < 8) ok('代理模型拟合质量合格（留一 RMSE ' + (loo.rmse * 160).toFixed(2) + ' t/d）');
else fail('代理模型拟合误差过大（留一 RMSE ' + (loo.rmse * 160).toFixed(2) + ' t/d）');

// 3.4b 独立验证：30 个新样本上代理预测与模拟器的 RMSE（与 demo 屏 3 一致）
const model = M.kernelRidge(X, Y, 0.35, 1e-4);
{
  const rr2 = M.mulberry32(777);
  let seO = 0, seW = 0, n = 30;
  for (let i = 0; i < n; i++) {
    const f = M.sampleAlloc(rr2), T = 700 + rr2() * 400;
    const r = M.simulate(f, T, 0, i + 1);
    const p = model.predict([f[0], f[1], f[2], f[3], T / 1200]);
    seO += (p.oil - r.oil) ** 2; seW += (p.wc - r.wc) ** 2;
  }
  const rmO = Math.sqrt(seO / n), rmW = Math.sqrt(seW / n);
  console.log('    新样本 RMSE: 产油 ' + rmO.toFixed(2) + ' t/d, 含水 ' + rmW.toFixed(2) + ' %');
  if (rmO < 6 && rmW < 3) ok('代理模型对新方案泛化良好（产油 RMSE ' + rmO.toFixed(2) + '，含水 RMSE ' + rmW.toFixed(2) + '）');
  else warn('代理模型泛化偏弱（产油 RMSE ' + rmO.toFixed(2) + '，含水 RMSE ' + rmW.toFixed(2) + '）');
}

// 3.5 参考：真模拟器网格搜索的理论最优（用于校准 case.json 指标，与 demo 同一适应度）
const fitF = (oil, wc, T) => oil - 0.8 * Math.max(0, wc - 87) * 10 - 0.02 * Math.max(0, T - 900);
let refBest = { fit: -1e9, oil: 0, wc: 0, T: 0, f: null };
for (let f1 = 0.02; f1 <= 0.12 + 1e-9; f1 += 0.02)
  for (let f2 = 0.05; f2 <= 0.2 + 1e-9; f2 += 0.05)
    for (let f3 = 0.25; f3 <= 0.45 + 1e-9; f3 += 0.05)
      for (let f4 = 0.35; f4 <= 0.6 + 1e-9; f4 += 0.05)
        for (let T = 800; T <= 1050 + 1e-9; T += 50) {
          const ff = M.normAlloc([f1, f2, f3, f4]);
          const r = M.simulate(ff, T, 0, 3);
          const fit = fitF(r.oil, r.wc, T);
          if (fit > refBest.fit) refBest = { fit, oil: r.oil, wc: r.wc, T, f: ff };
        }
console.log('    网格搜索理论上限: oil ' + refBest.oil.toFixed(1) + ' t/d, wc ' + refBest.wc.toFixed(1) + ' %, T ' + refBest.T + ', f [' + refBest.f.map(v => v.toFixed(2)).join(', ') + ']');

// 3.6 GA（含真模拟器精选+微调）优于现状且接近理论上限
const ga = M.gaOpt(model, 0.8, 64, 90, 7);
const gaSim = M.simulate(ga.best.f, ga.best.T, 0, 8);
console.log('    优化配注 f = [' + ga.best.f.map(v => v.toFixed(3)).join(', ') + ']  T = ' + Math.round(ga.best.T) + ' m³/d');
if (gaSim.oil > ms.oil) ok('遗传算法方案（真模拟器评估）优于现状：' + ms.oil.toFixed(1) + ' → ' + gaSim.oil.toFixed(1) + ' t/d，含水 ' + gaSim.wc.toFixed(1) + ' %，总注水 ' + Math.round(ga.best.T) + ' m³/d');
else fail('GA 未找到更优方案');
if (gaSim.oil > refBest.oil - 5) ok('优化方案接近网格搜索理论上限（差 ' + (refBest.oil - gaSim.oil).toFixed(1) + ' t/d）');
else warn('优化方案与理论上限差距较大（' + (refBest.oil - gaSim.oil).toFixed(1) + ' t/d）');

/* ---------- 汇总 ---------- */
console.log('\n==================================');
console.log('通过 ' + okCount + ' · 警告 ' + warns + ' · 失败 ' + fails);
if (fails) { console.log('结论：存在问题，请修复后再上传'); process.exit(1); }
console.log('结论：可上传（' + (warns ? '有 ' + warns + ' 条建议' : '无警告') + '）');
