/* =========================================================
   专业背景「理论概念可视化」生成器
   在每个案例的 background.sections[i].html 第一段之后插入一张概念图
   运行：node tools/mkbg.js
   ========================================================= */
const fs = require('fs');
const path = require('path');
const F = require('./figlib.js');
const { C, rect, line, txt, path: pth, circle, poly, polyOf, axes, rng, wrap, clamp } = F;

const ROOT = path.resolve(__dirname, '..');

/* 插入到第一段 </p> 之后。
   用哨兵注释包住生成的图，重跑时先删旧哨兵再插新，
   保证脚本可重复执行而不会插出重复图（用字符串查找，不用正则，避免转义坑）。 */
function stripFig(html) {
  var out = html;
  /* 兼容早期版本用的 <!--FIG:BG:n--> 标记 */
  out = out.split('<!--FIG:BG:').join('<!--FIGBGL_');
  out = out.split('<!--/FIG:BG:').join('<!--/FIGBGL_');
  for (var i = 0; i < 24; i++) {
    var s = out.indexOf('<!--FIGBG', i === 0 ? 0 : 0);
    if (s < 0) break;
    /* 找到本段的开始与结束哨兵 */
    var headEnd = out.indexOf('-->', s);
    if (headEnd < 0) break;
    var tag = out.slice(s, headEnd);
    var endMark = '<!--/FIGBG' + tag.slice('<!--FIGBG'.length) + '-->';
    var e = out.indexOf(endMark, headEnd);
    if (e < 0) break;
    out = out.slice(0, s) + out.slice(e + endMark.length);
  }
  return out;
}
function insertFig(html, fig, idx) {
  html = stripFig(html);
  var mark = '<!--FIGBG' + idx + '-->' + fig + '<!--/FIGBG' + idx + '-->';
  var i = html.indexOf('</p>');
  if (i < 0) return html + mark;
  return html.slice(0, i + 4) + mark + html.slice(i + 4);
}

/* =========================================================
   firstbreak-pick · 初至波自动拾取
   ========================================================= */
function firstbreakBg() {
  const r = rng(20261110);
  const N = 120;
  const tr = [];
  for (let i = 0; i < N; i++) {
    let v = (r() - 0.5) * 0.16;
    if (i > 52) v += Math.exp(-(i - 52) / 5) * (0.9 + r() * 0.15);
    tr.push(v);
  }

  /* ① 地震学基本概念：炮 → 道 → 初至 */
  const s1 = (() => {
    let o = '';
    o += txt(20, 26, '地震采集的基本单位：一次激发（炮）返回一整条「道」', { size: 10.5, fill: C.ink2, weight: 600 });
    const gx = 30, gy = 44, gw = 300, gh = 96;
    o += rect(gx, gy, gw, gh, { r: 4, fill: '#fdfdfb', stroke: C.line2 });
    const amps = [];
    for (let i = 0; i < N; i++) {
      const t = i / N;
      let a = (r() - 0.5) * 3;
      if (i > 52) a += Math.exp(-(i - 52) / 4) * 34;
      amps.push([gx + t * gw, gy + gh / 2 + a]);
    }
    let d = '';
    amps.forEach((p, i) => d += (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' ');
    o += pth(d, { stroke: C.blue, sw: 1.4, fill: 'none' });
    o += txt(gx + 4, gy + 14, '道（trace）', { size: 8.8, fill: C.ink3 });
    /* 初至标记 */
    const fx = gx + 52 / N * gw;
    o += line(fx, gy, fx, gy + gh, { stroke: C.clay, sw: 1.4 });
    o += txt(fx + 3, gy + gh - 5, '初至', { size: 9, fill: C.clay, weight: 700 });
    o += txt(gx + gw - 4, gy + gh - 5, '时间 →', { size: 8.8, fill: C.ink4, anchor: 'end' });
    /* 测线 */
    o += txt(370, 26, '一条测线 = 几百炮 × 几百道', { size: 10.5, fill: C.ink2, weight: 600 });
    for (let sh = 0; sh < 7; sh++) {
      for (let tr2 = 0; tr2 < 26; tr2++) {
        const x = 372 + tr2 * 9, y = 46 + sh * 15;
        /* 每一道画一小段波形，第 4 道出现初至（同相轴） */
        let d = 'M' + x + ' ' + y;
        for (let k = 0; k <= 6; k++) {
          const v = (k === 5 && sh === 3) ? -5.5 : (r() - 0.5) * 2.2;
          d += 'L' + (x + k) + ' ' + (y + v).toFixed(1);
        }
        o += pth(d, { stroke: sh === 3 ? C.clay : C.blue, sw: sh === 3 ? 1.2 : 0.8, fill: 'none', op: sh === 3 ? 0.95 : 0.55 });
      }
    }
    o += rect(372, 42, 234, 108, { r: 4, fill: 'none', stroke: C.line2, dash: '3 3' });
    o += txt(374, 40, '第 4 道上初至最先到达 → 同相轴连成一条线', { size: 8.4, fill: C.clay, weight: 700 });
    o += txt(372, 164, '≈ 5 万道 → 熟练处理员也要做一两周', { size: 9.2, fill: C.red, weight: 600 });
    o += rect(20, 168, 580, 8, { r: 3, fill: C.clayL });
    return wrap(o, ['概念图 1', '地震采集的基本单位：道、采样、初至'], 620, 176);
  })();

  /* ② STA/LTA 原理 */
  const sta = [], lta = [], ratio = [];
  for (let i = 0; i < N; i++) {
    const w1 = Math.max(0, i - 4), w2 = Math.max(0, i - 28);
    let s1 = 0, c1 = 0, s2 = 0, c2 = 0;
    for (let k = w1; k <= i; k++) { s1 += tr[k]; c1++; }
    for (let k = w2; k <= i; k++) { s2 += tr[k]; c2++; }
    sta.push(s1 / c1); lta.push(s2 / c2);
    ratio.push((s1 / c1) / ((s2 / c2) || 1e-6));
  }
  const s2 = F.twoMethodDiagram({
    leftTitle: 'STA 短时窗（5 点）能量', rightTitle: 'LTA 长时窗（25 点）能量',
    leftData: sta, rightData: lta, leftLen: N, rightLen: N,
    lo: -0.05, hi: 1.05, leftColor: C.jade, rightColor: C.blue,
    leftNote: '跟着初至一起跳', rightNote: '代表背景噪声水平',
    bottom: '比值 R = STA / LTA：初至到来时 STA 骤增、LTA 还没跟上 → R 冲高；R 越过阈值的位置就是初至',
    cap: ['概念图 2', 'STA/LTA：局部窗与全局窗的比值，把「信号来了」这件事变成一个可设阈值的数']
  });

  /* ③ 需要准备什么 */
  const s3 = (() => {
    let o = '';
    o += txt(20, 26, '三件东西：数据、标注、参数', { size: 10.5, fill: C.ink2, weight: 600 });
    const cards = [
      ['数据', '解编后的单炮道集', 'SGY / SEGD，保留采样率与道头信息', C.jadeL, C.jade],
      ['标注', '不需要训练集', '但抽 5%—10% 的道做人工复核，统计误差分布', C.blueL, C.blue],
      ['参数', 'STA/LTA 窗长与阈值', 'STA 5—15 点，LTA 50—200 点，阈值 2—5', C.clayL, C.clay]
    ];
    cards.forEach((cd, i) => {
      const bx = 20 + i * 196;
      o += rect(bx, 38, 180, 84, { r: 7, fill: cd[3], stroke: cd[4], sw: 1 });
      o += txt(bx + 12, 56, cd[0], { size: 11, fill: cd[4], weight: 700 });
      o += txt(bx + 12, 74, cd[1], { size: 9.4, fill: C.ink2, weight: 600 });
      o += txt(bx + 12, 92, cd[2], { size: 8.8, fill: C.ink3 });
    });
    o += rect(20, 132, 580, 38, { r: 6, fill: '#fdfdfb', stroke: C.line });
    o += txt(32, 150, '为什么这个场景「不需要标注」很关键：', { size: 9.8, fill: C.ink, weight: 700 });
    o += txt(32, 164, '地震资料数量巨大、标注贵，STA/LTA 这类无监督/弱监督方法能立刻上手——', { size: 9.2, fill: C.ink2 });
    o += txt(32, 175, '而深度学习逐点分类（PhaseNet 类）需要高质量标注，通常放在第二阶段。', { size: 9.2, fill: C.ink2 });
    return wrap(o, ['概念图 3', '落地门槛：这份清单决定了项目是「两周能跑通」还是「半年做不完」'], 620, 176);
  })();

  /* ④ 难点 */
  const s4 = (() => {
    let o = '';
    o += txt(20, 26, '低信噪比下的两种典型失败', { size: 10.5, fill: C.ink2, weight: 600 });
    /* 假拾取 */
    o += rect(20, 38, 280, 100, { r: 7, fill: C.redL, stroke: '#e5c0ba' });
    o += txt(32, 56, '① 假拾取（噪声尖峰提前触发）', { size: 10, fill: C.red, weight: 700 });
    o += axes(32, 66, 256, 52, { nx: 4, ny: 2 });
    const fake = [];
    for (let i = 0; i < N; i++) {
      let v = (r() - 0.5) * 0.4;
      if (i === 38) v += 2.2;
      if (i > 52) v += Math.exp(-(i - 52) / 4) * 1.6;
      fake.push([32 + i / N * 256, 118 - v * 16]);
    }
    let d = '';
    fake.forEach((p, i) => d += (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' ');
    o += pth(d, { stroke: C.blue, sw: 1.2, fill: 'none' });
    const fx = 32 + 38 / N * 256;
    o += line(fx, 66, fx, 118, { stroke: C.red, sw: 1.4 });
    o += txt(fx + 3, 76, '误拾', { size: 8.4, fill: C.red, weight: 700 });
    o += txt(32, 132, '改进：极性/相关性约束——相邻道初至应平滑渐变，离群道用邻道中位数回退', { size: 8.6, fill: '#8a4f27' });
    /* 漏拾取 */
    o += rect(320, 38, 280, 100, { r: 7, fill: C.amberL, stroke: '#e6d4ac' });
    o += txt(332, 56, '② 漏拾取（信号太弱，比值峰被淹没）', { size: 10, fill: '#a87f24', weight: 700 });
    o += axes(332, 66, 256, 52, { nx: 4, ny: 2 });
    const weak = [];
    for (let i = 0; i < N; i++) {
      let v = (r() - 0.5) * 0.8;
      if (i > 52) v += Math.exp(-(i - 52) / 4) * 0.28;
      weak.push([332 + i / N * 256, 118 - v * 16]);
    }
    d = '';
    weak.forEach((p, i) => d += (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' ');
    o += pth(d, { stroke: C.blue, sw: 1.2, fill: 'none' });
    o += line(332 + 52 / N * 256, 66, 332 + 52 / N * 256, 118, { stroke: C.amber, sw: 1.4 });
    o += txt(332 + 52 / N * 256 + 3, 76, '真初至', { size: 8.4, fill: '#a87f24', weight: 700 });
    o += txt(332, 132, '改进：多窗组合 + AIC 准则精修；或用小样本标注训练逐点分类网络', { size: 8.6, fill: '#8a4f27' });
    o += rect(20, 146, 580, 24, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
    o += txt(32, 162, '本场景的智能化不是「非黑即白」：低置信度的道交人工复核，高置信度的道才自动采纳。', { size: 9.6, fill: C.jadeD, weight: 600 });
    return wrap(o, ['概念图 4', '难点定位在低信噪比道——改进路线按成本从低到高排'], 620, 176);
  })();

  return [s1, s2, s3, s4];
}

/* =========================================================
   esp-fault · 电潜泵故障预警
   ========================================================= */
function espBg() {
  /* ① 三个落点的闭环 */
  const s2 = F.loopDiagram({
    title: '智能化把「坏了才修」升级成一条数据闭环',
    nodes: ['电流卡片', '异常检测', 'RUL 外推', '四级分级', '检泵安排'],
    sub: ['免费且连续', '不依赖标签', '还有多少天', '按紧急程度', '提前排产'],
    back: '每次检泵结论回写标签库 → 模型季度更新 → 误报率下降 → 现场更愿意相信预警',
    foot: '三个落点对应三种不同的监督信号：异常检测用无监督，RUL 用少量故障标签，分级用先验知识',
    cap: ['概念图 2', '三个落点环环相扣——少一个，闭环就断在那一环']
  });

  /* ② 数据的不均衡 */
  const s3 = (() => {
    let o = '';
    o += txt(20, 26, '数据的不均衡是这个场景最关键的现实', { size: 10.5, fill: C.ink2, weight: 600 });
    o += axes(20, 38, 260, 96, { nx: 4, ny: 4 });
    const bars = [['正常段', 96, C.jade, 0], ['气锁', 6, C.purple, 1], ['结垢', 4, C.clay, 2], ['过热', 3, C.amber, 3], ['短路', 1.5, C.red, 4]];
    bars.forEach(b => {
      const y = 48 + b[3] * 17;
      o += txt(28, y + 9, b[0], { size: 8.8, fill: C.ink2 });
      o += rect(80, y, b[1] / 96 * 190, 12, { r: 2, fill: b[2], op: 0.85 });
      o += txt(276, y + 9, b[0] === '正常段' ? '约 100 万点/井/年' : '全区数百起', { size: 8.2, fill: C.ink4, anchor: 'end' });
    });
    o += txt(20, 150, '正常段海量、故障段稀少且类型悬殊', { size: 9, fill: C.ink3 });
    o += rect(300, 38, 300, 96, { r: 7, fill: '#fdfdfb', stroke: C.line });
    o += txt(312, 56, '所以要分层用不同的方法', { size: 10, fill: C.ink, weight: 700 });
    o += txt(312, 76, '异常检测', { size: 9.4, fill: C.jadeD, weight: 700 });
    o += txt(388, 76, '无监督：不需要故障标签', { size: 9.2, fill: C.ink2 });
    o += txt(312, 94, 'RUL 外推', { size: 9.4, fill: C.clay, weight: 700 });
    o += txt(388, 94, '用少量故障标签 + 物理机理', { size: 9.2, fill: C.ink2 });
    o += txt(312, 112, '四级分级', { size: 9.4, fill: C.blue, weight: 700 });
    o += txt(388, 112, '掺入工程师的先验知识', { size: 9.2, fill: C.ink2 });
    o += rect(20, 156, 580, 18, { r: 5, fill: C.clayL });
    o += txt(32, 169, '「样本不均衡」不是模型的敌人，是选算法时必须先想清楚的前提。', { size: 9.4, fill: '#8a4f27', weight: 600 });
    return wrap(o, ['概念图 3', '正常段海量、故障段稀少——这决定了每一步该用哪种监督方式'], 620, 176);
  })();

  /* ③ 难度与改进路线 */
  const s4 = (() => {
    let o = '';
    o += txt(20, 26, '三个最容易翻车的点，以及成本从低到高的改进路线', { size: 10.5, fill: C.ink2, weight: 600 });
    const rows = [
      ['① 样本不均衡', '正常 100 万点 : 故障 数百起', '无监督异常检测兜底', C.jadeL, C.jadeD],
      ['② 故障形态差异大', '气锁锯齿 / 结垢爬升 / 过热波动', '分类型建模 + 少量真实故障校准', C.blueL, '#2b4a72'],
      ['③ 误报漏报权衡', '阈值松→漏报停产；紧→天天误报', '四级分层预警 + 人工复核压误报', C.clayL, '#8a4f27']
    ];
    rows.forEach((rw, i) => {
      const y = 38 + i * 40;
      o += rect(20, y, 580, 34, { r: 5, fill: rw[3], stroke: rw[4], sw: 0.9, op: 0.9 });
      o += txt(32, y + 15, rw[0], { size: 9.8, fill: rw[4], weight: 700 });
      o += txt(32, y + 29, rw[1], { size: 8.6, fill: C.ink2 });
      o += txt(330, y + 22, '→', { size: 11, fill: C.ink4 });
      o += txt(350, y + 22, rw[2], { size: 9.4, fill: rw[4], weight: 600 });
    });
    o += rect(20, 160, 580, 14, { r: 4, fill: C.jadeL });
    o += txt(32, 171, '还有一个容易被忽略的现实：时间标签粒度粗（检泵记录只有「哪天」），故障起始时刻本身就不精确。', { size: 9.2, fill: C.jadeD, weight: 600 });
    return wrap(o, ['概念图 4', '难点排序 + 改进路线：先做不需要标签的，再做需要标签的'], 620, 176);
  })();

  return [null, s2, s3, s4];
}

/* =========================================================
   prod-forecast · 产量智能预测
   ========================================================= */
function prodBg() {
  const r = rng(20261111);
  const N = 720;
  const q = [], wc = [];
  for (let i = 0; i < N; i++) {
    let v = 9 * Math.exp(-0.0026 * i);
    if (i >= 300) v += 0.55 * 9 * Math.exp(-(i - 300) / 400);
    v *= 1 + 0.06 * Math.sin(2 * Math.PI * (i % 365) / 365 - 1.1);
    q.push(Math.max(0.1, v + (r() - 0.5) * 0.8));
    wc.push(clamp(0.35 + (0.55 - 0.35) * (1 - Math.exp(-i / 700)), 0.01, 0.97));
  }

  /* ② 含水与递减的关系 */
  const s2 = (() => {
    let o = '';
    o += txt(20, 26, '为什么「含水上升」会让产量递减变快——这是产量建模的物理核心', { size: 10.5, fill: C.ink2, weight: 600 });
    o += axes(20, 38, 260, 96, { nx: 4, ny: 4 });
    o += polyOf(q, 20, 38, 260, 96, 0, 12, C.blue, 1.7);
    o += txt(30, 148, '产液 q(t)：含水越高，递减越快', { size: 9, fill: C.ink3 });
    o += axes(320, 38, 260, 96, { nx: 4, ny: 4 });
    o += polyOf(wc, 320, 38, 260, 96, 0, 1, C.clay, 1.8);
    o += txt(330, 148, '含水 wc(t)：S 型上升', { size: 9, fill: C.ink3 });
    o += rect(20, 154, 580, 20, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
    o += txt(32, 168, '产液下降 = 油在减少 + 水在挤占。含水数据是解释递减加速的关键协变量——它必须进特征。', { size: 9.4, fill: C.jadeD, weight: 600 });
    return wrap(o, ['概念图 2', '含水率是产量递减加速的物理原因，也是特征工程里最重要的一列'], 620, 176);
  })();

  /* ③ AI 三条路线 */
  const s3 = F.pipelineDiagram({
    title: '',
    stages: [
      ['A · 经验公式', 'Arps 指数递减'],
      ['B · 统计回归', '岭回归 + 特征'],
      ['C · 深度学习', 'MLP / LSTM'],
      ['验证方式', '滚动原点协议'],
      ['归因手段', 'ITS 反事实']
    ],
    cols: [C.grayL, C.blueL, C.purpleL, C.jadeL, C.clayL],
    edges: [C.gray, C.blue, C.purple, C.jade, C.clay],
    note: 'AI 不是「换个更玄的模型」，而是把原来靠经验公式硬扛的三件事——跳变、变速、伪周期——交给数据。',
    extra: [
      ['A 的短板', '指数假设描述不了措施台阶', C.ink3, false],
      ['B 的长处', '可解释、能给出置信区间', C.ink3, false],
      ['C 的长处', '能拟合非线性交互', C.ink3, false]
    ],
    cap: ['概念图 3', '三条技术路线 + 两个方法论支柱（滚动验证与反事实归因）']
  });

  /* ④ 难度 */
  const s4 = (() => {
    let o = '';
    o += txt(20, 26, '产量预测最容易翻车的三件事', { size: 10.5, fill: C.ink2, weight: 600 });
    const rows = [
      ['数据泄漏', '用全序列训练再回头预测，指标虚高', '滚动原点：每个原点只用它之前的数据', C.redL, C.red],
      ['措施井失真', 'Arps 指数假设拟合不了产量跳变', '事件编码 + 特征化措施强度', C.clayL, '#8a4f27'],
      ['归因吞增量', '训练段含事件后数据 → 增产算不出来', 'ITS：训练只用事件前，预测屏蔽事件特征', C.blueL, '#2b4a72']
    ];
    rows.forEach((rw, i) => {
      const y = 38 + i * 40;
      o += rect(20, y, 580, 34, { r: 5, fill: rw[3], stroke: rw[4], sw: 0.9 });
      o += txt(32, y + 15, rw[0], { size: 9.8, fill: rw[4], weight: 700 });
      o += txt(32, y + 29, rw[1], { size: 8.6, fill: C.ink2 });
      o += txt(330, y + 22, '→', { size: 11, fill: C.ink4 });
      o += txt(350, y + 22, rw[2], { size: 9.2, fill: rw[4], weight: 600 });
    });
    o += rect(20, 160, 580, 14, { r: 4, fill: C.jadeL });
    o += txt(32, 171, '前两件决定「模型准不准」，第三件决定「结论对不对」——后者往往更值钱。', { size: 9.2, fill: C.jadeD, weight: 600 });
    return wrap(o, ['概念图 4', '产量场景的三道坎：泄漏、跳变、归因'], 620, 176);
  })();

  return [null, s2, s3, s4];
}

/* =========================================================
   waterflood · 智能注水调配
   ========================================================= */
function waterfloodBg() {
  const r = rng(20261112);
  const N = 300;
  const inj = [];
  for (let i = 0; i < N; i++) inj.push(420 + 25 * Math.sin(2 * Math.PI * i / 180) + (r() - 0.5) * 16);
  [[43, 70, 260], [123, 135, 320], [193, 205, 180]].forEach(p => {
    for (let t = p[0] - 3; t < p[1] + 3; t++) {
      let v = 0;
      if (t < p[0]) v = p[2] * (t - (p[0] - 3)) / 3;
      else if (t < p[1]) v = p[2];
      else v = p[2] * (1 - (t - p[1]) / 3);
      inj[t] += v;
    }
  });
  const prods = [3, 6, 9, 12].map((lg, pi) => {
    const q = [], gains = [0.75, 0.55, 0.30, 0.10];
    for (let i = 0; i < N; i++) {
      const src = i - lg >= 0 ? i - lg : 0;
      q.push(96 - pi * 10 + gains[pi] * inj[src] + (r() - 0.5) * 6);
    }
    return q;
  });

  /* ② 注水的基本概念 */
  const s2 = (() => {
    let o = '';
    o += txt(20, 26, '注水的逻辑：把水注到油层，把油驱向生产井', { size: 10.5, fill: C.ink2, weight: 600 });
    /* 地层剖面 */
    o += rect(20, 38, 290, 108, { r: 5, fill: '#f7f5ef', stroke: C.line2 });
    o += rect(20, 38, 290, 26, { r: 5, fill: '#e9e4d8' });
    o += txt(30, 56, '地表', { size: 8.6, fill: C.ink3 });
    for (let L2 = 0; L2 < 3; L2++) {
      o += rect(20, 64 + L2 * 27, 290, 27, { fill: ['#e6dcc8', '#efe9f4', '#e7eef9'][L2], op: 0.75 });
      o += txt(28, 82 + L2 * 27, '油层 ' + (L2 + 1) + '　渗透率 ' + [1900, 900, 420][L2], { size: 8.4, fill: C.ink3 });
    }
    /* 注水井与生产井 */
    o += line(95, 38, 95, 146, { stroke: C.jade, sw: 3 });
    o += txt(100, 52, '注水井 I1', { size: 8.6, fill: C.jadeD, weight: 700 });
    o += line(215, 38, 215, 146, { stroke: C.blue, sw: 3 });
    o += txt(220, 52, '生产井 P1', { size: 8.6, fill: C.blue, weight: 700 });
    /* 水驱油箭头 */
    for (let k = 0; k < 5; k++) {
      const y = 78 + k * 14;
      o += pth('M100 ' + y + 'L205 ' + y, { stroke: C.jade, sw: 1.2, op: 0.5, dash: '4 3' });
    }
    o += txt(105, 160, '水把油推向生产井', { size: 9, fill: C.jadeD, weight: 600 });
    /* 右侧概念 */
    o += txt(330, 26, '两个关键概念', { size: 10.5, fill: C.ink2, weight: 600 });
    o += rect(330, 38, 270, 48, { r: 6, fill: C.jadeL, stroke: '#b9d8cb' });
    o += txt(342, 56, '连通性', { size: 9.8, fill: C.jadeD, weight: 700 });
    o += txt(342, 72, '注下去的水有多少能到油井那边', { size: 9, fill: '#3f6b5d' });
    o += rect(330, 94, 270, 48, { r: 6, fill: C.clayL, stroke: '#e6cdb2' });
    o += txt(342, 112, '配注（吸水剖面）', { size: 9.8, fill: '#8a4f27', weight: 700 });
    o += txt(342, 128, '水在各层段之间怎么分配', { size: 9, fill: '#8a4f27' });
    o += rect(20, 164, 580, 12, { r: 4, fill: C.clayL });
    o += txt(32, 173, '智能化要回答的就是这两个问题：往哪个方向注、每个方向注多少。', { size: 9.2, fill: '#8a4f27', weight: 600 });
    return wrap(o, ['概念图 2', '注水的物理图景：连通性决定方向，配注决定分配'], 620, 176);
  })();

  /* ③ 数据 */
  const s3 = (() => {
    let o = '';
    o += txt(20, 26, '一个井组需要凑齐的四类数据', { size: 10.5, fill: C.ink2, weight: 600 });
    o += axes(20, 38, 240, 92, { nx: 4, ny: 4 });
    o += polyOf(inj, 20, 38, 240, 92, 200, 900, C.jade, 1.4);
    o += txt(28, 142, '① 注入动态：日注水量、配注指令', { size: 9, fill: C.jadeD, weight: 600 });
    o += axes(290, 38, 130, 92, { nx: 3, ny: 4 });
    o += polyOf(prods[0], 290, 38, 130, 92, 200, 900, C.blue, 1.4);
    o += txt(298, 142, '② 产出动态：日产液', { size: 9, fill: C.blue, weight: 600 });
    o += axes(440, 38, 160, 92, { nx: 3, ny: 4 });
    o += polyOf(prods[3], 440, 38, 160, 92, 200, 900, C.gray, 1.4);
    o += txt(448, 142, '③ 各井响应（含滞后）', { size: 9, fill: C.ink3, weight: 600 });
    const rows = [
      ['④ 静态资料', '各层渗透率、剩余油潜力、井距'],
      ['最关键的一步', '时间对齐：不同系统的时间基准必须先统一'],
      ['最容易缺的', '分层吸水剖面——没有它，配注只是盲调']
    ];
    rows.forEach((rw, i) => {
      o += txt(20, 152 + i * 12, rw[0], { size: 8.8, fill: C.ink3, weight: 600 });
      o += txt(110, 152 + i * 12, rw[1], { size: 8.8, fill: i === 1 ? C.red : C.ink3 });
    });
    return wrap(o, ['概念图 3', '数据侧的关键不是「有多少」，而是「对不对齐、分不分层」'], 620, 176);
  })();

  /* ④ 难度 */
  const s4 = (() => {
    let o = '';
    o += txt(20, 26, '四个容易翻车的点', { size: 10.5, fill: C.ink2, weight: 600 });
    const rows = [
      ['假连通', '相关 ≠ 连通：共同制度性调整会造成同步波动', '差分去趋势 + 滞后一致性'],
      ['层间矛盾', '配水器设定压得住高渗层，但压不住吸水偏好', '用吸水剖面闭环校准代理模型'],
      ['代理外推', '代理模型只在训练样本覆盖的区域可信', '最后必须放回真模拟器复核'],
      ['效果不闭环', '下发完不复核，代理模型半年就失真', '吸水剖面实测回灌']
    ];
    rows.forEach((rw, i) => {
      const y = 38 + i * 30;
      o += rect(20, y, 580, 26, { r: 5, fill: i % 2 ? '#fdfdfb' : '#f8f7f3', stroke: C.line });
      o += txt(32, y + 16, rw[0], { size: 9.4, fill: C.clay, weight: 700 });
      o += txt(112, y + 16, rw[1], { size: 8.8, fill: C.ink2 });
      o += txt(420, y + 16, '→ ' + rw[2], { size: 8.8, fill: C.jadeD, weight: 600 });
    });
    o += rect(20, 160, 580, 14, { r: 4, fill: C.jadeL });
    o += txt(32, 171, '四个坑按顺序踩：第一个会让图错，第二个会让方案错，第三、第四个会让方案慢慢失效。', { size: 9.2, fill: C.jadeD, weight: 600 });
    return wrap(o, ['概念图 4', '注水智能化的四个坑——从「算错」到「慢慢失效」'], 620, 176);
  })();

  return [null, s2, s3, s4];
}

/* =========================================================
   wax-scale · 结蜡结垢预测
   ========================================================= */
function waxBg() {
  const r = rng(20261113);
  const N = 120;
  const q = [], temp = [], press = [];
  for (let i = 0; i < N; i++) {
    const d = i > 45 ? i - 45 : 0;
    q.push(100 - (i > 45 ? (0.14 * d + 0.0015 * d * d) : 0) + (r() - 0.5) * 1.6);
    temp.push(52 - 0.09 * d + (r() - 0.5) * 0.6);
    press.push(1.8 + (i > 20 ? 0.008 * (i - 20) : 0));
  }

  /* ② 结蜡与结垢的区别 */
  const s2 = (() => {
    let o = '';
    o += txt(20, 26, '结蜡 vs 结垢：两种完全不同的堵法', { size: 10.5, fill: C.ink2, weight: 600 });
    /* 结蜡：油管内径变小 */
    o += rect(20, 38, 280, 108, { r: 7, fill: C.clayL, stroke: '#e6cdb2' });
    o += txt(32, 56, '结蜡（有机沉积）', { size: 10, fill: '#8a4f27', weight: 700 });
    o += rect(46, 70, 90, 58, { r: 5, fill: '#f4f1e8', stroke: C.ink4, sw: 1.3 });
    o += rect(60, 80, 62, 38, { r: 4, fill: '#fff', stroke: C.ink3, sw: 1 });
    o += rect(70, 88, 42, 24, { r: 3, fill: '#d9b78e', stroke: C.clay, sw: 1.1 });
    o += txt(91, 104, '蜡', { size: 9, fill: '#8a4f27', anchor: 'middle', weight: 700 });
    o += txt(146, 88, '有效内径 ↓', { size: 9, fill: '#8a4f27', weight: 700 });
    o += txt(146, 104, '产液缓降', { size: 9, fill: C.ink2 });
    o += txt(146, 120, '井口压力：基本不升', { size: 8.6, fill: C.ink3 });
    o += txt(32, 138, '成因：原油中的蜡在管壁析出（温度低于析蜡点时更凶）', { size: 8.6, fill: '#8a4f27' });
    /* 结垢：近井地带污染 */
    o += rect(320, 38, 280, 108, { r: 7, fill: C.purpleL, stroke: '#d5c6de' });
    o += txt(332, 56, '结垢（无机沉积）', { size: 10, fill: '#5d4270', weight: 700 });
    o += rect(346, 70, 90, 58, { r: 5, fill: '#f4f1e8', stroke: C.ink4, sw: 1.3 });
    o += rect(360, 80, 62, 38, { r: 4, fill: '#fff', stroke: C.ink3, sw: 1 });
    o += rect(360, 80, 16, 38, { r: 3, fill: '#c9b0d6', stroke: C.purple, sw: 1.1 });
    o += txt(368, 104, '垢', { size: 9, fill: '#5d4270', anchor: 'middle', weight: 700 });
    o += txt(446, 88, '流动阻力 ↑', { size: 9, fill: '#5d4270', weight: 700 });
    o += txt(446, 104, '产液缓降', { size: 9, fill: C.ink2 });
    o += txt(446, 120, '井口压力：明显爬升', { size: 8.6, fill: C.ink3 });
    o += txt(332, 138, '成因：近井地带被地层水/垢质污染，流通截面变小', { size: 8.6, fill: '#5d4270' });
    o += rect(20, 150, 580, 22, { r: 5, fill: C.jadeL, stroke: '#b9d8cb' });
    o += txt(32, 165, '产液都在降，但处置方法完全相反：结蜡要热洗/加药，结垢要除垢/防垢。分不清就会越处理越糟。', { size: 9.4, fill: C.jadeD, weight: 600 });
    return wrap(o, ['概念图 2', '结蜡和结垢：症状像，病因不同，处置方法相反'], 620, 176);
  })();

  /* ③ 数据 */
  const s3 = (() => {
    let o = '';
    o += txt(20, 26, '做这件事需要的四类数据，以及它们的量级差异', { size: 10.5, fill: C.ink2, weight: 600 });
    o += axes(20, 38, 260, 92, { nx: 4, ny: 4 });
    o += polyOf(q, 20, 38, 260, 92, 88, 102, C.blue, 1.7);
    o += polyOf(temp.map(v => (52 - v) * 6 + 88), 20, 38, 260, 92, 88, 102, C.clay, 1.3);
    o += polyOf(press.map(v => 88 + (v - 1.78) * 18), 20, 38, 260, 92, 88, 102, C.purple, 1.3);
    o += txt(28, 148, '产液（蓝）· 井口温度（棕）· 井口压力（紫）', { size: 9, fill: C.ink3 });
    const rows = [
      ['常规数据', '产液/温度/压力：每口井每天都有，成本为零'],
      ['关键补充', '分层吸水剖面：测井/示踪，要专门安排'],
      ['最稀缺的', '结蜡历史记录：哪口井哪次清了蜡、效果如何'],
      ['清洗要点', '计量异常日、检修停产日必须剔除']
    ];
    rows.forEach((rw, i) => {
      o += txt(310, 52 + i * 26, rw[0], { size: 9.4, fill: C.ink3, weight: 700 });
      o += txt(392, 52 + i * 26, rw[1], { size: 8.8, fill: C.ink2 });
    });
    o += rect(20, 156, 580, 18, { r: 5, fill: C.clayL });
    o += txt(32, 169, '结蜡历史记录是模型的「答案」——没有它，只能做异常检测，做不了清防时机预测。', { size: 9.4, fill: '#8a4f27', weight: 600 });
    return wrap(o, ['概念图 3', '三路日常信号 + 一份稀缺的历史记录'], 620, 176);
  })();

  /* ④ 难度 */
  const s4 = (() => {
    let o = '';
    o += txt(20, 26, '四个容易翻车的点', { size: 10.5, fill: C.ink2, weight: 600 });
    const rows = [
      ['只看绝对值', '产液跌破风险线才报 → 慢蜡井前半段全漏', '看趋势：递减斜率超阈值就报'],
      ['分不清蜡与垢', '只看产液，两者症状一样', '产液 + 压力爬升两个信号一起看'],
      ['窗口选错', '太短被噪声带跑，太长被早期平台拖慢', '用折中窗口并定期重估'],
      ['忽略温度', '把「递减」一律当结蜡', '温度偏离作为第三个特征'],
      ['固定周期', '每口每月都清 → 大量白清', '按剩余窗口排序，只清该清的']
    ];
    rows.forEach((rw, i) => {
      const y = 36 + i * 26;
      o += rect(20, y, 580, 22, { r: 4, fill: i % 2 ? '#fdfdfb' : '#f8f7f3', stroke: C.line });
      o += txt(32, y + 15, rw[0], { size: 9.2, fill: C.clay, weight: 700 });
      o += txt(112, y + 15, rw[1], { size: 8.6, fill: C.ink2 });
      o += txt(390, y + 15, '→ ' + rw[2], { size: 8.6, fill: C.jadeD, weight: 600 });
    });
    o += rect(20, 166, 580, 12, { r: 4, fill: C.jadeL });
    o += txt(32, 175, '这五条串起来，就是「固定周期清蜡」升级为「按风险、按时机、按顺序」清防的全过程。', { size: 9.2, fill: C.jadeD, weight: 600 });
    return wrap(o, ['概念图 4', '从固定周期到按风险：五个具体的改进点'], 620, 176);
  })();

  return [null, s2, s3, s4];
}

/* =========================================================
   pumping-diag · 抽油机井工况诊断（专业背景补图）
   ========================================================= */
function pumpingBg() {
  const r = rng(20261114);
  const N = 180;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const th = 2 * Math.PI * i / N;
    const y = 38 + 30 * Math.abs(Math.cos(th)) + (r() - 0.5) * 1.2;
    pts.push([i / (N - 1) * 3, y]);
  }
  /* ② 示功图是怎么形成的：抽油机运动 → 闭合曲线 */
  const s2 = (() => {
    let o = '';
    o += txt(20, 26, '一台游梁式抽油机怎么画出一张示功图', { size: 10.5, fill: C.ink2, weight: 600 });
    /* 简化的四杆机构 */
    const bx = 30, by = 40;
    o += line(bx + 10, by + 96, bx + 210, by + 96, { stroke: C.ink4, sw: 1.6 });
    o += txt(bx + 6, by + 110, '地面', { size: 8.4, fill: C.ink4 });
    o += circle(bx + 110, by + 20, 5, { fill: C.jade });
    o += txt(bx + 110, by + 8, '支点', { size: 8.4, fill: C.jadeD, anchor: 'middle', weight: 700 });
    o += rect(bx + 30, by + 14, 160, 10, { rx: 5, fill: C.jadeL, stroke: C.jade, sw: 1.1 });
    o += txt(bx + 110, by + 36, '游梁', { size: 8.4, fill: C.jadeD, anchor: 'middle' });
    o += circle(bx + 190, by + 19, 9, { fill: C.clayL, stroke: C.clay, sw: 1.2 });
    o += txt(bx + 190, by + 6, '驴头', { size: 8.4, fill: C.clay, anchor: 'middle', weight: 700 });
    o += line(bx + 205, by + 19, bx + 205, by + 96, { stroke: C.ink3, sw: 2.4 });
    o += txt(bx + 210, by + 60, '光杆', { size: 8.4, fill: C.ink2 });
    o += rect(bx + 198, by + 60, 14, 16, { rx: 2, fill: C.clayL, stroke: C.clay, sw: 1 });
    o += txt(bx + 216, by + 72, '载荷传感器', { size: 8, fill: C.clay, weight: 700 });
    o += rect(bx + 198, by + 30, 14, 16, { rx: 2, fill: C.blueL, stroke: C.blue, sw: 1 });
    o += txt(bx + 216, by + 42, '位移传感器', { size: 8, fill: C.blue, weight: 700 });
    /* 右侧示功图 */
    o += axes(280, 40, 200, 100, { nx: 4, ny: 4 });
    const cp = pts.map(p => [280 + p[0] / 3 * 200, 140 - (p[1] - 30) / 60 * 100]);
    let d = '';
    cp.forEach((p, i) => d += (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' ');
    o += pth(d, { stroke: C.clay, sw: 2, fill: 'none', join: 'round' });
    o += txt(280, 32, '示功图：载荷—位移闭合曲线', { size: 9, fill: C.ink3 });
    o += txt(280, 156, '横轴=光杆位移 0—3 m　纵轴=光杆载荷', { size: 8.6, fill: C.ink4 });
    /* 底部说明 */
    o += rect(500, 40, 100, 100, { r: 6, fill: '#fdfdfb', stroke: C.line });
    o += txt(510, 58, '为什么闭合', { size: 9.4, fill: C.ink, weight: 700 });
    o += txt(510, 76, '上冲程：', { size: 8.6, fill: C.ink2, weight: 700 });
    o += txt(510, 89, '井下泵吸液', { size: 8.6, fill: C.ink3 });
    o += txt(510, 103, '下冲程：', { size: 8.6, fill: C.ink2, weight: 700 });
    o += txt(510, 116, '泵把液体举到', { size: 8.6, fill: C.ink3 });
    o += txt(510, 128, '地面（最重）', { size: 8.6, fill: C.ink3 });
    o += rect(20, 162, 580, 14, { r: 4, fill: C.jadeL });
    o += txt(32, 172, '曲线的形状由「井下泵里有没有液体」决定——所以示功图能反映泵况。', { size: 9.2, fill: C.jadeD, weight: 600 });
    return wrap(o, ['概念图 2', '从四杆机构到闭合曲线：示功图是怎么来的'], 620, 176);
  })();

  /* ③ AI 为什么适合这个任务 */
  const s3 = F.pipelineDiagram({
    title: '',
    stages: [
      ['示功图', '载荷—位移曲线'],
      ['栅格化', '32×32 灰度图'],
      ['卷积', '8 个边缘检测子'],
      ['特征', '32 维向量'],
      ['分类', '工况 + 置信度']
    ],
    cols: [C.clayL, C.blueL, C.purpleL, C.jadeL, C.clayL],
    edges: [C.clay, C.blue, C.purple, C.jade, C.clay],
    note: '把曲线当图像处理，恰好绕开了「怎么用公式描述一条闭合曲线」这个难题——卷积核自动学形状特征。',
    extra: [
      ['传统做法', '专家定规则：看拐点、看上下冲程对称性', C.ink3, false],
      ['AI 的优势', '规则会随工况失效；卷积核从数据里学', C.ink3, false]
    ],
    cap: ['概念图 3', '为什么用图像分类：把「读曲线」变成「读图」']
  });

  return [null, s2, s3, null, null];
}

/* =========================================================
   写回
   ========================================================= */
const BG = {
  'firstbreak-pick': firstbreakBg,
  'pumping-diag': pumpingBg,
  'esp-fault': espBg,
  'prod-forecast': prodBg,
  'waterflood': waterfloodBg,
  'wax-scale': waxBg
};

let n = 0;
for (const [dir, fn] of Object.entries(BG)) {
  const file = path.join(ROOT, dir + '-case', 'case.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const figs = fn();
  j.tabs.background.sections.forEach((sec, i) => {
    /* 先清掉本段旧图（即使这次不生成新图，也要清） */
    sec.html = stripFig(sec.html);
    if (!figs[i]) return;
    sec.html = insertFig(sec.html, figs[i], i);
    n++;
  });
  fs.writeFileSync(file, JSON.stringify(j, null, 2), 'utf8');
  console.log(dir + ': ' + figs.filter(Boolean).length + ' 张背景概念图');
}
console.log('合计 ' + n + ' 张');
