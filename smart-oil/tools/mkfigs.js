/* =========================================================
   为每个案例的 workflow.steps[i] 生成示意图，写回 case.json
   运行：node tools/mkfigs.js
   ========================================================= */
const fs = require('fs');
const path = require('path');
const F = require('./figlib.js');
const { C, rect, line, txt, path: pth, circle, poly, polyOf, axes, rng, wrap, clamp } = F;

const ROOT = path.resolve(__dirname, '..');

/* =========================================================
   firstbreak-pick · 初至波自动拾取
   ========================================================= */
function firstbreakSteps() {
  const r = rng(20261102);
  const N = 120;
  const tr = [];
  for (let i = 0; i < N; i++) {
    let v = (r() - 0.5) * 0.16;
    if (i > 52) v += Math.exp(-(i - 52) / 5) * (0.9 + r() * 0.15);
    tr.push(v);
  }
  const sta = [], lta = [], ratio = [];
  for (let i = 0; i < N; i++) {
    const w1 = Math.max(0, i - 4), w2 = Math.max(0, i - 28);
    let s1 = 0, c1 = 0, s2 = 0, c2 = 0;
    for (let k = w1; k <= i; k++) { s1 += tr[k]; c1++; }
    for (let k = w2; k <= i; k++) { s2 += tr[k]; c2++; }
    sta.push(s1 / c1); lta.push(s2 / c2);
    ratio.push((s1 / c1) / ((s2 / c2) || 1e-6));
  }
  const first = 53;

  return [
    F.timelineDiagram({
      title: '① 数据解编：把一条测线变成几十道地震道',
      total: N,
      bands: [
        [0, 52, '背景噪声段', C.grayL, C.gray, 0.9],
        [52, N, '初至到达段', C.jadeL, C.jade, 0.85]
      ],
      marks: [[first, '真实初至 d' + first, C.clay, '4 3']],
      notes: [
        ['采样间隔', '2 ms　→　500 Hz', C.ink2],
        ['每道样点', '2000 点（4 s 道）', C.ink2]
      ],
      cap: ['图 1', '解编后每道是一条独立的时间序列，初至就是这条曲线上的第一个强跳变']
    }),
    F.twoMethodDiagram({
      leftTitle: 'STA：短时窗（5 点）能量', rightTitle: 'LTA：长时窗（25 点）能量',
      leftData: sta, rightData: lta, leftLen: N, rightLen: N,
      lo: -0.05, hi: 1.05, leftColor: C.jade, rightColor: C.blue,
      leftNote: '跟着初至一起跳', rightNote: '代表背景噪声水平',
      bottom: '比值 R = STA / LTA：初至到来时 STA 猛涨而 LTA 还来不及涨 → R 冲高',
      cap: ['图 2', 'STA/LTA 是经典的「局部 vs 全局」对比：局部能量冲破全局噪声底']
    }),
    F.twoMethodDiagram({
      leftTitle: '只有本道', rightTitle: '叠加相邻 3 道',
      leftData: ratio, rightData: ratio.map((v, i) => {
        let s = 0, c = 0;
        for (let k = Math.max(0, i - 1); k <= Math.min(N - 1, i + 1); k++) { s += ratio[k]; c++; }
        return s / c;
      }), leftLen: N, rightLen: N,
      lo: 0, hi: 8, leftColor: C.ink3, rightColor: C.purple,
      thr: 4, leftMark: [[first, '假拾取', C.clay]], rightMark: [[first, '正确拾取', C.jade]],
      leftNote: '噪声尖峰也会触发', rightNote: '真初至在相邻道上是连贯的',
      bottom: '空间一致性约束：真初至在相邻道上「连成一条线」，随机噪声不会',
      cap: ['图 3', '为什么必须加空间约束——单看一道，噪声尖峰和真初至长得一样']
    }),
    F.pipelineDiagram({
      title: '',
      stages: [
        ['拾取结果', '每道一个初至时间'],
        ['与人工对比', '误差 ≤ ±2 采样点'],
        ['低置信复核', '跳变 / 缺失的道'],
        ['验收入库', '交给处理解释'],
        ['反哺', '阈值与窗长调优']
      ],
      cols: [C.jadeL, C.blueL, C.purpleL, C.clayL, C.amberL],
      edges: [C.jade, C.blue, C.purple, C.clay, C.amber],
      note: '模型不可能全对——最后一步「低置信转人工」是这个流程能落地的关键。',
      extra: [
        ['人工逐道拾取', '120 道 × 3 分钟 ≈ 6 小时', C.ink3, true],
        ['自动拾取 + 人工复核', '秒级 + 复核 3—5 道', C.jadeD, true]
      ],
      cap: ['图 4', '从拾取到验收的闭环：人工只在模型没把握的地方出现']
    })
  ];
}

/* =========================================================
   pumping-diag · 抽油机井工况诊断
   ========================================================= */
function pumpingSteps() {
  const r = rng(20261103);
  const N = 180;
  const raw = [], norm = [];
  for (let i = 0; i < N; i++) {
    const th = 2 * Math.PI * i / N;
    const y = 38 + 30 * Math.abs(Math.cos(th)) + (r() - 0.5) * 1.2;
    raw.push([i / (N - 1) * 3, y]);
  }
  const lo = 30, hi = 80;
  for (const p of raw) norm.push([p[0], (p[1] - lo) / (hi - lo)]);

  /* 归一化前后对比 */
  let s = '';
  s += txt(20, 26, '① 归一化前：各井量纲不同', { size: 10.5, fill: C.ink2, weight: 600 });
  s += axes(20, 36, 260, 100, { nx: 4, ny: 4 });
  s += polyOf([0, 0.42, 0.78, 1, 0.78, 0.42, 0].map((v, i) => v * 60), 20, 36, 260, 100, 0, 90, C.clay, 1.7);
  s += polyOf([0, 0.42, 0.78, 1, 0.78, 0.42, 0].map((v, i) => v * 60 + 20), 20, 36, 260, 100, 0, 90, C.blue, 1.5, '5 3');
  s += txt(30, 152, 'A 井 0—90 kN　B 井 20—140 kN　形状相同、量纲不同', { size: 9, fill: C.ink3 });
  s += txt(320, 26, '② 归一化后：全部落到 [0,1]', { size: 10.5, fill: C.ink2, weight: 600 });
  s += axes(320, 36, 260, 100, { nx: 4, ny: 4 });
  s += polyOf([0, 0.42, 0.78, 1, 0.78, 0.42, 0].map(v => v), 320, 36, 260, 100, 0, 1, C.jade, 1.8);
  s += polyOf([0, 0.42, 0.78, 1, 0.78, 0.42, 0].map(v => v + 0.04), 320, 36, 260, 100, 0, 1, C.blue, 1.4, '4 3');
  s += txt(330, 152, '两条曲线重合了——模型看到的是同一个「形状」', { size: 9, fill: C.jadeD, weight: 600 });
  s += rect(20, 162, 560, 12, { r: 4, fill: C.jadeL });
  s += txt(30, 171, '不归一化 → 网络学到的是井号和量程，不是形状；换一口井就失效。', { size: 9, fill: C.jadeD, weight: 600 });
  s = wrap(s, ['图 1', '归一化前后：不同井的同一形状被拉到同一尺度'], 620, 176);

  /* 标签回流闭环 */
  const s2 = F.loopDiagram({
    title: '标签不是一次性的：作业结论不断纠正人的误标',
    nodes: ['人工判读', '台账标签', '模型训练', '现场判读', '检泵结论'],
    sub: ['专家看图', '初版标签', '持续更新', '模型辅助', '权威答案'],
    back: '检泵结论（杆断 / 泵漏 / 供液不足）回溯纠正误标 → 标签更准 → 模型更准',
    foot: '疑难井标「待定」，不进训练集——宁可少数据，不要脏数据',
    cap: ['图 1', '标签回流闭环：每一口井的检泵结论都在提升下一个月的模型']
  });

  /* 按井划分 */
  const s3 = F.timelineDiagram({
    title: '训练/验证必须按「井」划分，不能按「样本」随机划分',
    total: 720,
    bands: [
      [0, 360, '训练集：井 A—M（360 口井的全部示功图）', C.jadeL, C.jade, 0.85],
      [360, 480, '验证集：井 N—Z', C.blueL, C.blue, 0.85],
      [480, 720, '测试集：完全没见过的 40 口井', C.clayL, C.clay, 0.85]
    ],
    notes: [
      ['错误做法', '把同一口井的图随机分到训练和验证 → 指标虚高 5—10 个点', C.red, true],
      ['原因', '同一口井的示功图形状高度相似，模型等于「见过这口井」', C.ink3, false]
    ],
    cap: ['图 2', '按井划分是这类「同源数据」任务最容易踩的坑']
  });

  /* 双闸 */
  const s4 = F.gateDiagram({
    g1Title: '闸 1 · 置信度（模型「有把握」吗）',
    g1Sub: 'softmax 输出的最高类别概率',
    g1Val: 0.89, g1Thr: 0.75, g1Pass: true, g1Text: '0.89',
    g2Title: '闸 2 · 分布外距离（形状「我见过」吗）',
    g2Sub: '32 维特征到最近原型的距离',
    g2Val: 0.02, g2Thr: 0.33, g2Pass: true, g2Text: '0.002',
    cap: ['图 3', '两道闸缺一不可：softmax 在没见过的形状上依然会给高置信度']
  });

  /* 闭环 */
  const s5 = F.loopDiagram({
    title: '作业回流让模型每月都在变好',
    nodes: ['模型判读', '台账入库', '现场作业', '检泵结论', '增量训练'],
    sub: ['秒级批量', '人工复核', '清蜡/换泵', '权威答案', '每月一次'],
    back: '检泵结论回写标签库 → 每月增量训练 → 准确率上升 → 复核比例下降 → 闭环',
    foot: '没有回流机制，模型半年后准确率会掉 10 个点以上——这是石油项目最常见的失败原因',
    cap: ['图 4', '闭环的最后一步，也是最容易被省略的一步']
  });

  return [s, s2, s3, s4, s5];
}

/* =========================================================
   esp-fault · 电潜泵故障预警
   ========================================================= */
function espSteps() {
  const r = rng(20261104);
  const N = 720;
  /* 教学示意图用较小的噪声：演示页默认 0.8 时 40 点斜率会被噪声主导，
     画出来是一团毛刺，看不出「趋势」这两个字。示意图要讲清概念，故取 0.35。 */
  const cur = [];
  for (let i = 0; i < N; i++) {
    let v = 92 + (r() - 0.5) * 0.7;
    if (i > 120) v += (i - 120) / 600 * 20 + (r() - 0.5) * 1.0;
    cur.push(v);
  }
  /* 清洗 */
  let s = '';
  s += txt(20, 26, '① 原始电流卡片（720 分钟 = 12 小时）', { size: 10.5, fill: C.ink2, weight: 600 });
  s += axes(20, 36, 300, 100, { nx: 4, ny: 4 });
  s += polyOf(cur, 20, 36, 300, 100, 80, 118, C.blue, 1.3);
  s += rect(20, 36, 300 * 120 / N, 100, { fill: C.redL, op: 0.55 });
  s += txt(26, 50, '停机检修段', { size: 8.6, fill: C.red, weight: 600 });
  s += txt(20, 152, '剔除：停机、检修、计量异常、传感器故障', { size: 9, fill: C.ink3 });
  s += txt(340, 26, '② 清洗后的连续曲线', { size: 10.5, fill: C.ink2, weight: 600 });
  s += axes(340, 36, 240, 100, { nx: 4, ny: 4 });
  s += polyOf(cur.filter((_, i) => i > 120), 340, 36, 240, 100, 80, 118, C.jade, 1.6);
  s += line(340, 36 + 100 - (92 - 80) / 38 * 100, 580, 36 + 100 - (92 - 80) / 38 * 100, { stroke: C.ink3, dash: '4 3', sw: 1.1 });
  s += txt(350, 152, '剩下的才是「泵在干活」的信号', { size: 9, fill: C.jadeD, weight: 600 });
  s = wrap(s, ['图 1', '数据接入与工况清洗：先把不能用的时段剔除干净'], 620, 176);

  /* 滑窗特征 */
  const s2 = F.twoMethodDiagram({
    leftTitle: '窗口内均值 μ（现在多高）', rightTitle: '窗口内斜率 k（在不在涨）',
    leftData: cur.map((v, i) => {
      let s2 = 0, c = 0;
      for (let k = Math.max(0, i - 39); k <= i; k++) { s2 += cur[k]; c++; }
      return s2 / c;
    }),
    rightData: cur.map((v, i) => lsFit(cur, Math.max(0, i - 119), i)),
    leftLen: N, rightLen: N,
    loL: 88, hiL: 112, loR: 0, hiR: 0.045,
    leftColor: C.blue, rightColor: C.clay,
    leftNote: '负载水平（A）', rightNote: '趋势方向（A/分钟，120 点窗拟合）',
    bottom: '滑窗 = 让算法看「一段时间」而不是「一个瞬间」；窗口 40 点是噪声与反应速度的折中',
    cap: ['图 1', '滑窗特征：同一份电流，两个统计量回答两个不同问题']
  });

  /* 两种检测器（与 demo.js 的 detectAnomaly 口径一致：趋势用最小二乘斜率） */
  const absS = cur.map(v => Math.abs(v - 92) / 10);
  const treS = cur.map((v, i) => {
    if (i < 39) return 0;
    const f = lsFit(cur, i - 39, i);
    return Math.max(0, f) / 0.025;
  });
  const s3 = F.twoMethodDiagram({
    leftTitle: '只看绝对值 |I − 92| / 10', rightTitle: '看趋势 窗口斜率 / 0.025',
    leftData: absS, rightData: treS, leftLen: N, rightLen: N,
    lo: 0, hi: 1.6, leftColor: C.gray, rightColor: C.clay,
    thr: 1, leftMark: [[260, '险段起点', C.ink3]], rightMark: [[146, '提前 114 分钟', C.jade]],
    leftNote: '要偏离 10 A 才报', rightNote: '40 点内涨 1 A 就报',
    bottom: '结垢段前半程电流仍在 92±8 A 内 → 绝对值检测判「正常」，趋势检测已经报警',
    cap: ['图 2', '慢退化为什么只能靠趋势抓：绝对值阈值对「正在漂移」不敏感']
  });

  /* RUL 外推 */
  const s4 = F.timelineDiagram({
    title: '退化拟合与外推：用最近 20 天推出「还有多少天」',
    total: 90,
    bands: [
      [0, 40, '平台期', C.grayL, C.gray, 0.9],
      [40, 60, '拟合窗口（最近 20 天）', C.blueL, C.blue, 0.85],
      [60, 90, '外推段（虚线）', C.clayL, C.clay, 0.35]
    ],
    marks: [[77, '真实跌破阈值 d77', C.red, '3 3']],
    notes: [
      ['拟合直线', 'q = k·x + b，k = −0.30 t/d 每天', C.ink2, true],
      ['外推交点', '直线 ∩ 阈值线 = 该检泵日 → 剩余 17 天', C.jadeD, true]
    ],
    cap: ['图 3', '剩余寿命 RUL 不是预言，是「按当前退化速度」的推算']
  });

  /* 分级 */
  const s5 = F.scatter2dDiagram({
    leftTitle: '二维特征空间（24 口井）',
    xLabel: '电流趋势斜率 →', yLabel: '波动性 ↑',
    bands: [[0, 0.35, 0.55, C.jadeL], [0, 1, 0.18, C.jadeL]],
    points: [
      [0.08, 0.1, C.jade, 3.2, 0.5], [0.12, 0.14, C.jade, 3.2, 0.5], [0.05, 0.2, C.jade, 3.2, 0.5],
      [0.2, 0.12, C.jade, 3.2, 0.5], [0.15, 0.22, C.jade, 3.2, 0.5], [0.1, 0.3, C.jade, 3.2, 0.5],
      [0.42, 0.35, C.amber, 3.8], [0.55, 0.28, C.amber, 3.8], [0.38, 0.45, C.amber, 3.8],
      [0.5, 0.4, C.amber, 3.8], [0.62, 0.32, C.amber, 3.8],
      [0.8, 0.7, C.red, 4.4], [0.92, 0.85, C.red, 4.4], [0.72, 0.6, C.red, 4.4],
      [0.88, 0.5, C.red, 4.4], [0.95, 0.75, C.red, 4.4], [0.78, 0.92, C.red, 4.4], [0.85, 0.65, C.red, 4.4]
    ],
    rightTitle: '四级分级（灵敏度 τ = 0.5）',
    rows: [
      ['0 正常', '13 口', C.ink3, '#fdfdfb'],
      ['1 关注', '4 口', C.amber, '#fdfdfb'],
      ['2 预警', '0 口', C.clay, '#fdfdfb'],
      ['3 紧急', '7 口', C.red, C.redL, true]
    ],
    bottom: '检出率 100%　误报率 0%　平均提前量 23.7 天',
    cap: ['图 4', '分级不是「都报一遍」，而是把有限的作业队先派给最该修的井']
  });

  /* 闭环 */
  const s6 = F.loopDiagram({
    title: '效果回流：每一次检泵都在给模型打分',
    nodes: ['电流卡片', '特征与模型', '分级预警', '排检泵', '检泵结论'],
    sub: ['分钟级', '自动刷新', '四级', '按序作业', '真值'],
    back: '检泵结论核对预警 → 误报/漏报回灌 → 阈值与窗口重估 → 下一轮更准',
    foot: '没有这一步，模型会一直用一年前的经验报警，而井况早就变了',
    cap: ['图 5', 'PHM 的核心思想：把每一次现场作业都变成一次标注']
  });

  return [s, s2, s3, s4, s5, s6];
}

/* =========================================================
   prod-forecast · 产量智能预测
   ========================================================= */
function prodSteps() {
  const r = rng(20261105);
  const N = 720;
  const q = [];
  for (let i = 0; i < N; i++) {
    let v = 9 * Math.exp(-0.0026 * i);
    if (i >= 300) v += 0.55 * 9 * Math.exp(-(i - 300) / 400);
    v *= 1 + 0.06 * Math.sin(2 * Math.PI * (i % 365) / 365 - 1.1);
    v += (r() - 0.5) * 0.8;
    q.push(Math.max(0.1, v));
  }
  /* 质控 */
  const s = F.timelineDiagram({
    title: '数据聚合与质控：720 天里哪几天不能用',
    total: N,
    bands: [
      [0, 300, '正常生产段', C.jadeL, C.jade, 0.85],
      [300, N, '压裂后（含措施台阶）', C.clayL, C.clay, 0.85]
    ],
    marks: [[300, '压裂 t=300', C.clay]],
    notes: [
      ['必须剔除', '计量检定异常、停产检修、流程切换（这几天的产量不代表产能）', C.red, true],
      ['必须保留', '措施事件当天的产量——它正是模型要学的关键信息', C.ink3, false]
    ],
    cap: ['图 1', '质控的关键不是「删得越多越好」，而是分清「坏数据」和「特殊工况」']
  });

  /* 特征工程 */
  const featNames = ['lag1', 'lag7', 'lag30', 'roll7均', 'roll30均', 'roll7σ', '月sin', '月cos', '含水', '油压', '注水', '事件热度', '间开', '偏置'];
  let s2 = '';
  s2 += txt(20, 26, '14 个特征分成四组：惯性 / 趋势 / 周期 / 协变量与事件', { size: 10.5, fill: C.ink2, weight: 600 });
  const groups = [
    ['惯性（滞后值）', 0, 3, C.jadeL, C.jade],
    ['趋势（滚动统计）', 3, 6, C.blueL, C.blue],
    ['周期（日历）', 6, 8, C.purpleL, C.purple],
    ['协变量与事件', 8, 14, C.clayL, C.clay]
  ];
  groups.forEach((g, gi) => {
    const bx = 20 + gi * 148;
    s2 += rect(bx, 40, 138, 84, { r: 6, fill: g[3], stroke: g[4], sw: 1 });
    s2 += txt(bx + 9, 56, g[0], { size: 9.6, fill: g[4], weight: 700 });
    for (let k = g[1]; k < g[2]; k++) {
      const iy = 70 + (k - g[1]) * 15;
      s2 += txt(bx + 9, iy, featNames[k], { size: 9, mono: true, fill: C.ink2 });
      s2 += rect(bx + 74, iy - 8, 54, 8, { r: 2, fill: '#fff' });
      s2 += rect(bx + 74, iy - 8, 20 + (k * 7 % 34), 8, { r: 2, fill: g[4], op: 0.75 });
    }
  });
  s2 += rect(20, 136, 580, 34, { r: 6, fill: C.jadeL, stroke: '#b9d8cb' });
  s2 += txt(32, 152, '「事件热度」这一列是关键：把「压裂后第几天、增产效果还剩多少」编码成一个数。', { size: 9.8, fill: C.jadeD, weight: 600 });
  s2 += txt(32, 166, '压裂井上 Arps 指数递减之所以最差，就是因为指数假设描述不了跳变——给了这一列，模型才有机会学对。', { size: 9.2, fill: C.jadeD });
  s2 = wrap(s2, ['图 2', '特征工程 = 把石油机理翻译成机器能用的列'], 620, 176);

  /* 滚动原点 */
  const s3 = F.timelineDiagram({
    title: '滚动原点验证：每个原点都「只用过去预测未来」',
    total: 720,
    bands: [
      [0, 360, '原点 1 训练段', C.jadeL, C.jade, 0.8],
      [360, 390, '预测 30 天', C.blueL, C.blue, 0.9],
      [360, 380, '原点 2 训练段', C.jadeL, C.jade, 0.5],
      [380, 410, '预测 30 天', C.blueL, C.blue, 0.55]
    ],
    marks: [[360, '原点 1', C.clay], [540, '原点 10', C.clay]],
    notes: [
      ['协议', '训练 360 天 → 预测 30 天 → 窗口前移 20 天，共 10 个原点', C.ink2, true],
      ['为什么', '如果用全序列训练再回头预测，等于考试时偷看答案', C.red, true]
    ],
    cap: ['图 3', '滚动原点协议：工业场景里唯一诚实的准确率测法']
  });

  /* 三模型对比 */
  const s4 = F.twoMethodDiagram({
    leftTitle: 'A · Arps 指数递减（经验公式）', rightTitle: 'C · 微型 MLP（14→7→1）',
    leftData: q.slice(360, 660).map((v, i) => {
      const t = 360 + i;
      return 9 * Math.exp(-0.0026 * t) + (t >= 300 ? 4.95 * Math.exp(-(t - 300) / 400) : 0);
    }),
    rightData: q.slice(360, 660),
    leftLen: 300, rightLen: 300, lo: 0, hi: 11,
    leftColor: C.gray, rightColor: C.purple, leftDash: '5 3',
    leftNote: 'MAPE 29.0%（措施台阶拟合不住）', rightNote: 'MAPE 7.2%（岭回归 2.5% 最优）',
    bottom: '三种模型跑的是同一套协议、同一份数据、同一预测步长——差别只在「能不能表达跳变」',
    cap: ['图 4', '同台竞技：数据泄漏刷不出来的差距，才是真差距']
  });

  /* 区间预测 */
  const s5 = (() => {
    let o = '';
    o += txt(20, 26, '预测区间：越远越宽，但不是「拍」出来的形状', { size: 10.5, fill: C.ink2, weight: 600 });
    o += axes(20, 36, 300, 100, { nx: 4, ny: 4 });
    const truth = q.slice(360, 420);
    const pred = truth.map((v, i) => v * (1 - 0.004 * i));
    const up = [], dn = [];
    for (let i = 0; i < truth.length; i++) {
      const w = 0.4 + i * 0.16;
      up.push([20 + i / (truth.length - 1) * 300, 36 + 100 - (pred[i] + w - 0) / 12 * 100]);
      dn.push([20 + i / (truth.length - 1) * 300, 36 + 100 - (pred[i] - w) / 12 * 100]);
    }
    let d = '';
    up.forEach((p, i) => d += (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' ');
    for (let i = dn.length - 1; i >= 0; i--) d += 'L' + dn[i][0].toFixed(1) + ' ' + dn[i][1].toFixed(1) + ' ';
    o += pth(d + 'Z', { fill: C.blue, op: 0.22 });
    o += polyOf(truth, 20, 36, 300, 100, 0, 12, C.ink3, 1.7);
    o += polyOf(pred, 20, 36, 300, 100, 0, 12, C.blue, 1.6);
    o += txt(30, 150, '黑=实际　蓝=预测　蓝带=80% 区间', { size: 9, fill: C.ink3 });
    o += txt(340, 26, '区间怎么来的', { size: 10.5, fill: C.ink2, weight: 600 });
    o += rect(340, 36, 260, 46, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    o += txt(352, 54, '用最优模型的实测残差分位数', { size: 9.6, fill: '#2b4a72', weight: 600 });
    o += txt(352, 70, '第 10% / 90% 分位，随步长放宽', { size: 9.2, fill: '#4a607d' });
    o += rect(340, 90, 260, 46, { r: 6, fill: '#fdfdfb', stroke: C.line });
    o += txt(352, 108, '不用「假设误差按 sqrt(h) 增长」', { size: 9.4, fill: C.ink2 });
    o += txt(352, 124, '而是从数据里量出来', { size: 9.2, fill: C.ink3 });
    o += rect(20, 158, 580, 16, { r: 4, fill: C.jadeL });
    o += txt(30, 170, '区间覆盖率是另一个必须报的指标——区间不覆盖实际值，等于没给区间。', { size: 9.4, fill: C.jadeD, weight: 600 });
    return wrap(o, ['图 5', '预测 + 区间：决策需要的不只是一个数，还有「这个数可能错多少」'], 620, 176);
  })();

  /* 归因 */
  const s6 = (() => {
    let o = '';
    o += txt(20, 26, '措施归因：ITS 口径 vs naive 口径，增产差了一个数量级', { size: 10.5, fill: C.ink2, weight: 600 });
    o += axes(20, 40, 280, 96, { nx: 4, ny: 4 });
    const ev = 300;
    for (let i = 0; i < 120; i++) {
      const t = ev + i;
      const cf = 9 * Math.exp(-0.0026 * t);
      const act = cf + 4.95 * Math.exp(-(t - ev) / 400);
      o += line(20 + i / 119 * 280, 40 + 96 - (cf - 0) / 10 * 96, 20 + i / 119 * 280, 40 + 96 - (act - 0) / 10 * 96, { stroke: C.clay, op: 0.3, sw: 3 });
    }
    o += polyOf(Array.from({ length: 120 }, (_, i) => 9 * Math.exp(-0.0026 * (ev + i))), 20, 40, 280, 96, 0, 10, C.blue, 1.7);
    o += polyOf(Array.from({ length: 120 }, (_, i) => 9 * Math.exp(-0.0026 * (ev + i)) + 4.95 * Math.exp(-(ev + i - ev) / 400)), 20, 40, 280, 96, 0, 10, C.jade, 1.7);
    o += txt(30, 150, '蓝=反事实（假如没压裂）　绿=实际　橙带=增量', { size: 9, fill: C.ink3 });
    o += rect(320, 40, 280, 50, { r: 6, fill: C.jadeL, stroke: '#b9d8cb' });
    o += txt(332, 58, 'ITS 口径（正确）', { size: 9.8, fill: C.jadeD, weight: 700 });
    o += txt(332, 74, '训练段 = 事件前 120 天；预测时事件特征 = 0', { size: 9, fill: '#3f6b5d' });
    o += txt(332, 84, '平均日增量 +2.62 t/d', { size: 9.4, mono: true, fill: C.jadeD, weight: 700 });
    o += rect(320, 98, 280, 50, { r: 6, fill: C.redL, stroke: '#e5c0ba' });
    o += txt(332, 116, 'naive 口径（错误示范）', { size: 9.8, fill: C.red, weight: 700 });
    o += txt(332, 132, '训练段 = 事件前 + 事件后（泄露）；事件特征全开', { size: 9, fill: '#8a4f27' });
    o += txt(332, 142, '平均日增量 +0.02 t/d → 增产被整个吞掉', { size: 9.4, mono: true, fill: C.red, weight: 700 });
    o += rect(20, 158, 580, 16, { r: 4, fill: C.clayL });
    o += txt(30, 170, '只差「训练段怎么选、事件特征屏蔽不屏蔽」这一处，增产却算不出来——这是能直接写进汇报里的经济价值。', { size: 9.4, fill: '#8a4f27', weight: 600 });
    return wrap(o, ['图 6', '反事实归因：把「措施有没有用」这个要花真金白银验证的问题，算出来'], 620, 176);
  })();

  /* 闭环 */
  const s7 = F.loopDiagram({
    title: '低置信复核与回流',
    nodes: ['滚动预测', '区间输出', '低置信筛选', '人工复核', '结论回写'],
    sub: ['只用过去', '含不确定度', '自动分流', '带上证据', '改进标签'],
    back: '复核结论回写 → 特征与标签更新 → 下一轮更准 → 复核比例继续下降',
    foot: '没有「低置信转人工」这一步，模型一旦错了就直接影响生产决策',
    cap: ['图 7', '和所有工业 AI 一样：最后一环一定是人']
  });

  /* 步骤 3（模型训练与滚动验证）配两张图：协议 + 三模型对比 */
  return [[s], [s2], [s3, s4], [s5], [s6], [s7]];
}

/* =========================================================
   waterflood · 智能注水调配
   ========================================================= */
function waterfloodSteps() {
  const r = rng(20261106);
  const N = 300;
  const inj = [];
  for (let i = 0; i < N; i++) inj.push(420 + 25 * Math.sin(2 * Math.PI * i / 180) + (r() - 0.5) * 20);
  [[43, 70, 260], [123, 135, 320], [193, 205, 180]].forEach(p => {
    for (let t = p[0] - 3; t < p[1] + 3; t++) {
      let v = 0;
      if (t < p[0]) v = p[2] * (t - (p[0] - 3)) / 3;
      else if (t < p[1]) v = p[2];
      else v = p[2] * (1 - (t - p[1]) / 3);
      inj[t] += v;
    }
  });
  const lags = [3, 6, 9, 12], gains = [0.75, 0.55, 0.30, 0.10];
  const prods = lags.map((lg, pi) => {
    const q = [];
    for (let i = 0; i < N; i++) {
      const src = i - lg >= 0 ? i - lg : 0;
      q.push([96 - pi * 10] + gains[pi] * inj[src] + (r() - 0.5) * 6);
    }
    return q;
  });

  /* 动态对齐 */
  const s = (() => {
    let o = '';
    o += txt(20, 26, '① 注水井注入量与油井产液量必须按同一时间基准对齐', { size: 10.5, fill: C.ink2, weight: 600 });
    o += axes(20, 38, 280, 88, { nx: 4, ny: 4 });
    o += polyOf(inj, 20, 38, 280, 88, 200, 900, C.jade, 1.5);
    o += txt(28, 140, '注入 I(t)　绿=注水井', { size: 9, fill: C.jadeD, weight: 600 });
    o += axes(320, 38, 280, 88, { nx: 4, ny: 4 });
    o += polyOf(prods[0], 320, 38, 280, 88, 200, 900, C.blue, 1.5);
    o += txt(328, 140, '产液 q(t)　蓝=P1（滞后 3 天）', { size: 9, fill: C.blue, weight: 600 });
    o += rect(20, 150, 580, 24, { r: 5, fill: C.clayL, stroke: '#e6cdb2' });
    o += txt(32, 166, '时间没对齐 → 互相关全是噪声。对齐是连通分析的前提，也是数据接入环节最常见的坑。', { size: 9.6, fill: '#8a4f27', weight: 600 });
    return wrap(o, ['图 1', '动态对齐：井组数据来自不同系统，时间基准必须先统一'], 620, 176);
  })();

  /* 连通分析 */
  const s2 = (() => {
    let o = '';
    o += txt(20, 26, '② 互相关扫描：相关系数最高的滞后就是井间连通时滞', { size: 10.5, fill: C.ink2, weight: 600 });
    o += axes(20, 38, 260, 92, { nx: 4, ny: 4 });
    const corrs = [];
    for (let tau = 0; tau <= 20; tau++) {
      const best = gains.map((g, pi) => {
        const q = prods[pi];
        let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
        for (let t = tau + 2; t < N; t++) {
          const dx = inj[t - tau] - inj[t - tau - 1];
          const dy = q[t] - q[t - 1];
          sx += dx; sy += dy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; n++;
        }
        const vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
        return (vx < 1e-9 || vy < 1e-9) ? 0 : (sxy - sx * sy / n) / Math.sqrt(vx * vy);
      });
      corrs.push(best[0]);
    }
    o += polyOf(corrs, 20, 38, 260, 92, 0, 1, C.clay, 1.9);
    o += line(20 + 3 / 20 * 260, 38, 20 + 3 / 20 * 260, 130, { stroke: C.jade, sw: 1.4 });
    o += txt(20 + 3 / 20 * 260 + 4, 50, '峰值 τ=3', { size: 9, fill: C.jadeD, weight: 700 });
    o += txt(30, 144, 'P1 的相关系数 vs 滞后 τ（真值 3 天）', { size: 9, fill: C.ink3 });
    /* 连通图 */
    o += txt(310, 26, '扫描 4 口井的结果 → 连通图', { size: 10.5, fill: C.ink2, weight: 600 });
    const gx = 350, gy = 48;
    o += circle(gx, gy + 44, 13, { fill: C.jadeL, stroke: C.jade, sw: 1.4 });
    o += txt(gx, gy + 48, 'I1', { size: 9, mono: true, fill: C.jadeD, anchor: 'middle', weight: 700 });
    const ps = [[gx - 70, gy + 4], [gx - 40, gy + 92], [gx + 44, gy + 100], [gx + 76, gy + 10]];
    ps.forEach((p, i) => {
      o += line(gx, gy + 44, p[0], p[1], { stroke: C.ink4, sw: 0.8 + gains[i] * 4, op: 0.5 });
      o += circle(p[0], p[1], 11, { fill: '#fdfdfb', stroke: gains[i] > 0.4 ? C.jade : C.gray, sw: 1.3 });
      o += txt(p[0], p[1] + 4, 'P' + (i + 1), { size: 8.5, mono: true, fill: C.ink2, anchor: 'middle', weight: 600 });
      o += txt(p[0], p[1] + 24, 'g=' + gains[i].toFixed(2), { size: 7.8, mono: true, fill: C.ink3, anchor: 'middle' });
    });
    o += rect(20, 154, 580, 20, { r: 5, fill: C.jadeL });
    o += txt(32, 168, '线越粗 = 连通越强；τ = 滞后天数 = 井间距与连通质量的旁证。', { size: 9.6, fill: C.jadeD, weight: 600 });
    return wrap(o, ['图 2', '从脉冲响应到连通图：这是注水智能化的地基'], 620, 176);
  })();

  /* 代理模型 */
  const s3 = (() => {
    let o = '';
    o += txt(20, 26, '③ 代理模型：用 100 组样本换来「毫秒级评估」', { size: 10.5, fill: C.ink2, weight: 600 });
    o += axes(20, 40, 200, 104, { nx: 4, ny: 4 });
    for (let i = 0; i < 100; i++) {
      const fx = 0.05 + r() * 0.55, fy = 0.05 + r() * 0.55;
      o += circle(20 + fx / 0.7 * 200, 40 + 104 - fy / 0.7 * 104, 2.6, { fill: C.jade, op: 0.6 });
    }
    o += txt(28, 158, '100 组随机配注方案（横=层配注，纵=总注水）', { size: 8.8, fill: C.ink3 });
    o += rect(240, 40, 160, 50, { r: 6, fill: C.blueL, stroke: '#c5d6ea' });
    o += txt(252, 58, '核岭回归 KRR', { size: 9.6, fill: '#2b4a72', weight: 700 });
    o += txt(252, 74, 'α = (K + λI)⁻¹ Y', { size: 9.4, mono: true, fill: '#2b4a72' });
    o += txt(252, 85, 'ŷ(x) = Σᵢ αᵢ·k(x, xᵢ)', { size: 9, mono: true, fill: '#4a607d' });
    o += rect(420, 40, 180, 50, { r: 6, fill: '#fdfdfb', stroke: C.line });
    o += txt(432, 58, '为什么必须做这一步', { size: 9.4, fill: C.ink, weight: 700 });
    o += txt(432, 74, '真模拟器一次几秒', { size: 9, fill: C.ink2 });
    o += txt(432, 86, 'GA 要评估上万次 → 跑不动', { size: 9, fill: C.red });
    o += rect(240, 100, 360, 44, { r: 6, fill: C.jadeL, stroke: '#b9d8cb' });
    o += txt(252, 118, '留一交叉验证（LOOCV）RMSE = 0.0041', { size: 9.4, mono: true, fill: C.jadeD, weight: 700 });
    o += txt(252, 134, '独立验证集 R²：产油 0.996　含水 0.994 → 代理模型能替代模拟器', { size: 9, fill: '#3f6b5d' });
    o += rect(20, 154, 580, 20, { r: 5, fill: C.clayL });
    o += txt(32, 168, '但代理只在训练样本覆盖的区域内可信 → 最后必须放回真模拟器复核。', { size: 9.6, fill: '#8a4f27', weight: 600 });
    return wrap(o, ['图 3', '代理模型：让「快速搜索」成为可能，同时用交叉验证守住可信度'], 620, 176);
  })();

  /* 约束优化 */
  const s4 = (() => {
    let o = '';
    o += txt(20, 26, '④ 遗传算法：每代 = 选择 → 交叉 → 变异', { size: 10.5, fill: C.ink2, weight: 600 });
    o += axes(20, 38, 200, 100, { nx: 4, ny: 4 });
    const gens = 90;
    const curve = [];
    for (let i = 0; i < gens; i++) curve.push(1 - Math.exp(-i / 22) + (r() - 0.5) * 0.02);
    o += polyOf(curve, 20, 38, 200, 100, 0.9, 1.05, C.clay, 1.9);
    o += txt(28, 152, '每代最优适应度（90 代收敛）', { size: 9, fill: C.ink3 });
    o += rect(240, 38, 160, 100, { r: 6, fill: '#fdfdfb', stroke: C.line });
    o += txt(252, 56, '适应度函数', { size: 9.6, fill: C.ink, weight: 700 });
    o += txt(252, 74, '油 − λ·max(0, 含水−87)×10', { size: 8.8, mono: true, fill: C.ink2 });
    o += txt(252, 88, '　　− 0.02·max(0, T−900)', { size: 8.8, mono: true, fill: C.ink2 });
    o += txt(252, 110, '约束内嵌', { size: 9.4, fill: C.jadeD, weight: 700 });
    o += txt(252, 124, 'softmax → 4 层比例非负且和为 1', { size: 8.6, fill: C.ink2 });
    o += txt(252, 136, 'sigmoid → 总注水限 700—1100', { size: 8.6, fill: C.ink2 });
    o += rect(420, 38, 180, 100, { r: 6, fill: C.jadeL, stroke: '#b9d8cb' });
    o += txt(432, 56, '编码的讲究', { size: 9.6, fill: C.jadeD, weight: 700 });
    o += txt(432, 74, '直接优化「4 比例 + 1 总量」', { size: 8.8, fill: '#3f6b5d' });
    o += txt(432, 88, '会违反约束：可能为负、', { size: 8.8, fill: '#3f6b5d' });
    o += txt(432, 102, '加不起来、总量离谱。', { size: 8.8, fill: '#3f6b5d' });
    o += txt(432, 122, '把约束编码进基因，', { size: 8.8, fill: C.jadeD, weight: 600 });
    o += txt(432, 134, '每个个体天生合法。', { size: 8.8, fill: C.jadeD, weight: 600 });
    o += rect(20, 154, 580, 20, { r: 5, fill: C.jadeL });
    o += txt(32, 168, '拖 λ 越大越保守（含水优先），解会沿帕累托前沿移动——稳油与控水此消彼长。', { size: 9.6, fill: C.jadeD, weight: 600 });
    return wrap(o, ['图 4', '约束优化：把「经验试调」变成「有目标的搜索」'], 620, 176);
  })();

  /* 方案对比 */
  const s5 = (() => {
    let o = '';
    o += txt(20, 26, '⑤ 优化方案 vs 现状人工方案（放回真模拟器复核）', { size: 10.5, fill: C.ink2, weight: 600 });
    const rows = [
      ['日产油 t/d', 114.7, 152.4, '+32.9%'],
      ['综合含水 %', 90.5, 87.2, '−3.3 个百分点'],
      ['吨油耗水 m³/t', 7.85, 5.91, '−24.7%']
    ];
    const mx = 170;
    rows.forEach((rr, i) => {
      const yy = 48 + i * 38;
      o += txt(20, yy + 12, rr[0], { size: 9.6, fill: C.ink2 });
      o += rect(140, yy, rr[1] / mx * 200, 14, { r: 2, fill: C.gray, op: 0.55 });
      o += txt(348, yy + 12, rr[1].toFixed(1), { size: 9, mono: true, fill: C.ink3 });
      o += rect(380, yy, rr[2] / mx * 200, 14, { r: 2, fill: C.jade, op: 0.9 });
      o += txt(588, yy + 12, rr[2].toFixed(1), { size: 9, mono: true, fill: C.jadeD, anchor: 'end', weight: 600 });
      o += txt(20, yy + 28, rr[3], { size: 8.8, fill: C.jadeD, weight: 600 });
    });
    o += rect(140, 40, 200, 10, { r: 2, fill: C.gray, op: 0.55 });
    o += txt(140, 32, '灰=现状人工方案', { size: 8.6, fill: C.ink3 });
    o += rect(380, 40, 200, 10, { r: 2, fill: C.jade, op: 0.9 });
    o += txt(380, 32, '绿=优化方案', { size: 8.6, fill: C.jadeD });
    o += rect(20, 168, 580, 0.1, { fill: C.line });
    o += txt(20, 172, '含水约束 92%：人工方案已经越线（水窜），优化方案压回线内。', { size: 9.4, fill: '#8a4f27', weight: 600 });
    return wrap(o, ['图 5', '优化不是「多采一点油」，而是「多采油的同时把含水压住」'], 620, 176);
  })();

  /* 闭环 */
  const s6 = F.loopDiagram({
    title: '效果回流：吸水剖面变化是最宝贵的反馈',
    nodes: ['下发方案', '现场执行', '吸水剖面', '对比预测', '更新模型'],
    sub: ['配注指令', '按方案做', '测分层', '看是否一致', '重新训练'],
    back: '实测剖面 vs 代理模型预测 → 修正渗透率参数 → 代理模型更准 → 下轮方案更优',
    foot: '这是「代理模型 + 优化」能持续变好的唯一原因：不回流，代理模型半年就失真',
    cap: ['图 6', '闭环的最后一步，也是最容易被省略的一步']
  });

  return [s, s2, s3, s4, s5, s6];
}

/* =========================================================
   wax-scale · 结蜡结垢预测
   ========================================================= */
function waxSteps() {
  const r = rng(20261107);
  const N = 120;
  const q = [], temp = [], press = [];
  for (let i = 0; i < N; i++) {
    const d = i > 45 ? i - 45 : 0;
    q.push(100 - (i > 45 ? (0.14 * d + 0.0015 * d * d) : 0) + (r() - 0.5) * 1.7);
    temp.push(52 - 0.09 * d + (r() - 0.5) * 0.6);
    press.push(1.8 + (i > 20 ? 0.008 * (i - 20) : 0));
  }
  /* 机理 */
  const s = (() => {
    let o = '';
    o += txt(20, 26, '① 结蜡与结垢在数据上留下两种不同的指纹', { size: 10.5, fill: C.ink2, weight: 600 });
    o += axes(20, 40, 280, 100, { nx: 4, ny: 4 });
    o += polyOf(q, 20, 40, 280, 100, 88, 102, C.blue, 1.8);
    o += line(20, 40 + 100 - (92 - 88) / 14 * 100, 300, 40 + 100 - (92 - 88) / 14 * 100, { stroke: C.clay, dash: '4 3', sw: 1.2 });
    o += txt(28, 154, '产液 q(t)：蜡堵 → 有效内径变小 → 产量缓降', { size: 9, fill: C.ink3 });
    o += axes(320, 40, 280, 100, { nx: 4, ny: 4 });
    o += polyOf(press, 320, 40, 280, 100, 1.78, 2.02, C.purple, 1.8);
    o += txt(328, 154, '井口压力：垢堵 → 流动阻力变大 → 压力爬升', { size: 9, fill: C.ink3 });
    o += rect(20, 162, 580, 14, { r: 4, fill: C.jadeL });
    o += txt(30, 172, '产液降 = 蜡还是垢？两个信号一起看才分得清——这就是特征工程的物理依据。', { size: 9.4, fill: C.jadeD, weight: 600 });
    return wrap(o, ['图 1', '物理背景的可视化：为什么只看产液不够'], 620, 176);
  })();

  /* 特征工程 */
  const s2 = (() => {
    let o = '';
    o += txt(20, 26, '② 三个滑窗特征：把「井况」翻译成三个可比较的数', { size: 10.5, fill: C.ink2, weight: 600 });
    const feats = [
      ['递减斜率', q.map((_, i) => clamp(-slopeOf(q, 40, i) / 0.3, 0, 1)), C.blue, '÷ 0.3 t/d 每天'],
      ['压力爬升', press.map(v => clamp((v - 1.8) / 0.8, 0, 1)), C.purple, '÷ 0.8 MPa'],
      ['温度偏离', temp.map(v => clamp((52 - v) / 6, 0, 1)), C.clay, '÷ 6 ℃']
    ];
    feats.forEach((ft, i) => {
      const bx = 20 + i * 196;
      o += axes(bx, 40, 178, 88, { nx: 4, ny: 4 });
      o += polyOf(ft[1], bx, 40, 178, 88, 0, 1, ft[2], 1.7);
      o += txt(bx, 142, ft[0], { size: 9.8, fill: ft[2], weight: 700 });
      o += txt(bx + 60, 142, '归一化 ' + ft[3], { size: 8.8, mono: true, fill: C.ink3 });
    });
    o += rect(20, 152, 580, 22, { r: 5, fill: C.clayL, stroke: '#e6cdb2' });
    o += txt(32, 167, '三个除数（0.3 / 0.8 / 6）是现场经验值——正是这些经验被固化进代码，模型才能替代人做判断。', { size: 9.4, fill: '#8a4f27', weight: 600 });
    return wrap(o, ['图 2', '特征工程 = 把石油经验编码成归一化的数值'], 620, 176);
  })();

  /* 风险识别 */
  const s3 = F.twoMethodDiagram({
    leftTitle: '只看绝对值 |q − 100| / 8', rightTitle: '看趋势 max(0, −k) / 0.09',
    leftData: q.map(v => Math.abs(v - 100) / 8),
    rightData: q.map((_, i) => Math.max(0, -slopeOf(q, 40, i)) / 0.09),
    leftLen: N, rightLen: N, lo: 0, hi: 2.2,
    leftColor: C.gray, rightColor: C.blue, thr: 1,
    leftMark: [[77, '首报 d77', C.clay]], rightMark: [[12, '首报 d12', C.jade]],
    leftNote: '产液跌破 92 才报', rightNote: '斜率超阈值就报',
    bottom: '慢蜡井：绝对值检测第 77 天才报，趋势检测第 12 天就报 —— 提前 65 天',
    cap: ['图 3', '两种检测器并排：慢蜡井是「只看绝对值会漏掉」的典型']
  });

  /* 清防时机 */
  const s4 = F.timelineDiagram({
    title: '④ 外推到「需清蜡阈值」→ 剩余清防窗口',
    total: 90,
    bands: [
      [0, 40, '平台期', C.grayL, C.gray, 0.9],
      [40, 60, '拟合窗口（最近 20 天）', C.blueL, C.blue, 0.85],
      [60, 90, '外推段（虚线）', C.clayL, C.clay, 0.35]
    ],
    marks: [[77, '真实跌破阈值 d77', C.red, '3 3'], [77, '模型估计 d77', C.jade, null]],
    notes: [
      ['模型估计窗口', '17.3 天　　真实窗口 17.0 天　误差 0.3 天', C.jadeD, true],
      ['前提', '结蜡速度保持不变，且期间不做清防——所以要定期重估', C.ink3, false]
    ],
    cap: ['图 4', '剩余窗口把「这口井有多急」变成可排序、可排班的一个数']
  });

  /* 分级 */
  const s5 = F.scatter2dDiagram({
    leftTitle: '蜡风险 × 垢风险（30 口井）',
    xLabel: '蜡风险 →（产液递减）', yLabel: '垢风险 ↑（压力爬升）',
    bands: [[0, 0.5, 0.28, C.jadeL]],
    points: (() => {
      const pts = [];
      for (let i = 0; i < 30; i++) {
        const rr = rng(777 + i);
        if (rr() < 0.6) pts.push([rr() * 0.2, rr() * 0.2, C.ink4, 3.2, 0.5]);
        else if (rr() < 0.7) pts.push([0.25 + rr() * 0.75, rr() * 0.5, C.clay, 3.8]);
        else pts.push([rr() * 0.5, 0.25 + rr() * 0.75, C.purple, 3.8]);
      }
      return pts;
    })(),
    rightTitle: '分级结果与处置方式',
    rows: [
      ['高风险 · 提前清', '11 口', C.clay, C.clayL, true],
      ['中风险 · 加密监测', '3 口', C.amber, '#fdfdfb'],
      ['低风险 · 延后', '16 口', C.ink3, '#fdfdfb'],
      ['清防车次', '13.8 次/月 vs 30 次/月', C.jadeD, C.jadeL, true]
    ],
    bottom: '固定周期每口每月都清 → 很多是白清；按风险排序把车次用在最该用的井上',
    cap: ['图 5', '分级的落点：不是「都报一遍」，而是「先动哪一口」']
  });

  /* 闭环 */
  const s6 = F.loopDiagram({
    title: '效果回流：清完蜡后的产量回升就是最好的标注',
    nodes: ['趋势报警', '分级排产', '清防作业', '产量回升', '模型更新'],
    sub: ['自动检测', '按风险排序', '热洗/除垢', '真实效果', '重估窗口'],
    back: '清防后产量回升幅度 → 校准斜率与阈值 → 剩余窗口估得更准 → 下次排产更合理',
    foot: '没有回流，模型会用一年前的结蜡速度估所有井',
    cap: ['图 6', '把每一次清防作业都变成一次模型校准']
  });

  return [s, s2, s3, s4, s5, s6];
}

/* 最小二乘斜率（与 demo.js 的 fitTrend 同口径） */
function lsFit(arr, from, to) {
  const n = to - from + 1;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { const x = i, y = arr[from + i]; sx += x; sy += y; sxy += x * y; sxx += x * x; }
  const den = n * sxx - sx * sx;
  return den ? (n * sxy - sx * sy) / den : 0;
}

/* slopeOf：与 demo.js 的 slopeWin 口径一致 */
function slopeOf(arr, W, end) {
  const s = Math.max(0, end - W + 1), n = end - s + 1;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { const x = i, y = arr[s + i]; sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const den = n * sxx - sx * sx;
  return den !== 0 ? (n * sxy - sx * sy) / den : 0;
}

/* =========================================================
   写回 case.json
   ========================================================= */
const FIGS = {
  'firstbreak-pick': firstbreakSteps,
  'pumping-diag': pumpingSteps,
  'esp-fault': espSteps,
  'prod-forecast': prodSteps,
  'waterflood': waterfloodSteps,
  'wax-scale': waxSteps
};

let total = 0;
for (const [dir, fn] of Object.entries(FIGS)) {
  const file = path.join(ROOT, dir + '-case', 'case.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const figs = fn();
  const steps = j.tabs.workflow.steps;
  if (figs.length !== steps.length) {
    console.log('!! ' + dir + ' 图数(' + figs.length + ') ≠ 步骤数(' + steps.length + ')');
  }
  steps.forEach((st, i) => {
    if (!figs[i]) return;
    st.fig = Array.isArray(figs[i]) ? figs[i] : [figs[i]];
  });
  fs.writeFileSync(file, JSON.stringify(j, null, 2), 'utf8');
  total += figs.length;
  console.log(dir + ': ' + figs.length + ' 张步骤图 → ' + path.basename(file));
}
console.log('合计 ' + total + ' 张');
