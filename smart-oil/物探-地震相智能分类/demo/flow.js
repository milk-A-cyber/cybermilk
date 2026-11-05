/* =========================================================
   地震相智能分类 · 算法解剖（切片图像分类 + 半监督 + 相带概率体）
   ---------------------------------------------------------
   把「地震切片 → 相带概率体」拆成 6 步，每一步都跑真代码：

     ① 切片切块       地震体 → 固定大小切片 + 相带类别锁定
     ② 稀疏井标签     测井相 → 50—200 个切片标签
     ③ 切片分类       卷积网络 → 相带 + 置信度
     ④ 半监督扩展     高置信伪标签 → 全数据体覆盖
     ⑤ 相带概率体     邻域一致化 → 相带概率体
     ⑥ 复核与预测     低置信复核 → 储层预测 + 回流

   依赖：window.RemoteBridge（demo.js 暴露的真模型）
        window.AFlow（算法解剖引擎）
   ========================================================= */
(function (global) {
  'use strict';

  var B = global.RemoteBridge;
  if (!B || !global.AFlow) return;

  var G = global.AFlow.G, C = global.AFlow.C;
  var M = B.M;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t * t * (3 - 2 * t); }
  function f(v, n) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(n === undefined ? 2 : n); }

  /* 面板底部小结框 */
  function footBox(x, w, y, h, title, lines, tone) {
    var bg = tone === 'jade' ? C.jadeL : tone === 'clay' ? C.clayL : tone === 'blue' ? C.blueL : '#f4f3ef';
    var st = tone === 'jade' ? '#b9d8cb' : tone === 'clay' ? '#e6cdb2' : tone === 'blue' ? '#c5d6ea' : C.line;
    var fg = tone === 'jade' ? C.jadeD : tone === 'clay' ? '#8a4f27' : tone === 'blue' ? '#2b4a72' : C.ink2;
    var s = G.rect(x, y, w, h, { r: 6, fill: bg, stroke: st });
    if (title) s += G.txt(x + 11, y + 17, title, { size: 9.6, fill: fg, weight: 700 });
    for (var i = 0; i < lines.length; i++) {
      s += G.txt(x + 11, y + (title ? 33 : 17) + i * 13, lines[i], { size: 8.8, fill: fg });
    }
    return s;
  }

  var ROWS = 8, COLS = 10, W = 40, H = 30, gap = 2;

  /* 切片网格着色 */
  function gridMap(arr, x0, y0, colorFn) {
    var s = '';
    var idx = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++, idx++) {
        var x = x0 + c * (W + gap), y = y0 + r * (H + gap);
        s += G.rect(x, y, W, H, { r: 3, fill: colorFn(arr[idx]) });
      }
    }
    return s;
  }

  /* ---------- 缓存 ---------- */
  var cache = { key: '' };
  function compute() {
    var L = B.live();
    var key = [L.nFacies, L.weight, L.nLabeled, L.pseudoThr, L.smooth].join(',');
    if (cache.key === key) return cache;
    var grid = M.genSliceGrid(ROWS, COLS, L.nFacies, 20261108);
    var cls = M.classifySlice(grid, L.nFacies, L.weight);
    var ev = M.classifyEval(grid, cls.cls, L.nFacies);
    var semi = M.semiExpand(grid, cls.prob, cls.cls, L.nFacies, L.nLabeled, L.pseudoThr);
    var prob = M.faciesProb(grid, cls.prob, cls.cls, L.nFacies, L.smooth);
    cache = { key: key, L: L, grid: grid, cls: cls, ev: ev, semi: semi, prob: prob };
    return cache;
  }

  /* =========================================================
     ① 切片切块
     ========================================================= */
  function stage1(t) {
    var c = compute(), grid = c.grid, L = c.L;
    var s = '';
    s += G.panel(0, '① 地震体', '切固定大小切片', C.jade);
    s += G.panel(1, '② 切片集', '1 万—10 万片', C.blue);
    s += G.panel(2, '③ 相带类别', '锁定河道/砂坝…', C.clay);

    var x0 = 30, y0 = 130;
    /* 切片真值（相带着色） */
    s += gridMap(new Array(ROWS * COLS).fill(0).map(function (_, i) { return grid.grid[i].facies; }), x0, y0, function (v) { return M.FACI_COLORS[v]; });
    s += G.txt(x0, y0 - 12, '地震切片网格 · ' + L.nFacies + ' 类相带', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(320, 270, 130, 192, '相带类别怎么定',
      ['· 解释员 + 地质师共同锁定',
       '· 河道 / 砂坝 / 浊积扇…',
       '· 按反射结构、连续性、振幅',
       '',
       '类别不锁定 → 模型学到',
       '「某人的相带观」而非沉积环境。'], 'jade');

    s += G.txt(x0, y0 + 208, '同一区块不同人划出的相带数可差一倍 · 类别必须先锁定', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '切片', v: '1 万—10 万片' }, { k: '相带类别', v: L.nFacies + ' 类' }], note: '第一步把地震体切成固定大小切片，并与地质师共同锁定相带类别定义。类别不锁定，不同人建不同标签，分类学到的是某个人手边的相带观。' };
  }

  /* =========================================================
     ② 稀疏井标签
     ========================================================= */
  function stage2(t) {
    var c = compute(), grid = c.grid, L = c.L;
    var s = '';
    s += G.panel(0, '① 测井相', '井点岩性+沉积相', C.clay);
    s += G.panel(1, '② 标定切片', '50—200 个', C.jade);
    s += G.panel(2, '③ 稀疏标签', '锚定相带类别', C.blue);

    var x0 = 30, y0 = 130;
    /* 稀疏标签：随机标 few 个 */
    var lbl = new Array(ROWS * COLS).fill(-1);
    var rnd = M.mulberry32(20261111);
    for (var i = 0; i < Math.min(L.nLabeled, ROWS * COLS); i++) {
      var idx;
      do { idx = Math.floor(rnd() * ROWS * COLS); } while (lbl[idx] >= 0);
      lbl[idx] = grid.grid[idx].facies;
    }
    var sMap = '';
    var p = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var cc = 0; cc < COLS; cc++, p++) {
        var x = x0 + cc * (W + gap), y = y0 + r * (H + gap);
        var fill = lbl[p] >= 0 ? M.FACI_COLORS[lbl[p]] : '#e9e4d8';
        sMap += G.rect(x, y, W, H, { r: 3, fill: fill, stroke: lbl[p] >= 0 ? '#2f7d6b' : 'none', sw: 1.5 });
      }
    }
    s += sMap;
    s += G.txt(x0, y0 - 12, '稀疏井标签 · ' + Math.min(L.nLabeled, ROWS * COLS) + ' 个（其余未标注）', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(320, 270, 130, 192, '为什么只有这么点',
      ['· 井点相带要钻井、测井、解释',
       '· 一个区块只有 50—200 个井标签',
       '· 却要外推到整块数据体',
       '· 必须靠弱监督/半监督扩展',
       '',
       '标签贵 → 直接监督会过拟合，',
       '要用未标注切片把样本补起来。'], 'clay');

    s += G.txt(x0, y0 + 208, '只有 50—200 个井点标签，却要覆盖 1 万—10 万片', { size: 9, fill: '#8a4f27' });
    return { svg: s, stats: [{ k: '井标签', v: Math.min(L.nLabeled, ROWS * COLS) }, { k: '覆盖', v: '稀疏' }, { k: '策略', v: '半监督' }], note: '井点相带标签只有 50—200 个，直接监督训练会过拟合。但标签贵、量少，必须用弱监督 / 半监督把未标注切片的样本补起来。' };
  }

  /* =========================================================
     ③ 切片分类
     ========================================================= */
  function stage3(t) {
    var c = compute(), cls = c.cls, grid = c.grid, ev = c.ev, L = c.L;
    var s = '';
    s += G.panel(0, '① 卷积特征', '提取反射结构', C.blue);
    s += G.panel(1, '② 分类层', '相带 + 置信度', C.jade);
    s += G.panel(2, '③ 全切片', '覆盖全数据体', C.clay);

    var x0 = 30, y0 = 130, w = 540, h = 130;
    s += G.axes(x0, y0, w, h, { nx: 4, ny: 2 });
    /* 模拟 CNN 卷积-池化-全连接 */
    var steps = Math.floor(t * 5);
    var boxW = [120, 96, 72, 100];
    var boxY = [y0 + 28, y0 + 44, y0 + 54, y0 + 40];
    for (var i = 0; i <= steps && i < 4; i++) {
      var lx = x0 + 30 + i * 138;
      s += G.rect(lx, boxY[i], boxW[i], 42, { r: 6, fill: i === 3 ? C.jadeL : C.blueL, stroke: i === 3 ? '#a7c6b8' : '#9fb5cf' });
      s += G.txt(lx + boxW[i] / 2, boxY[i] + 24, i === 0 ? '卷积特征' : i === 1 ? '池化' : i === 2 ? '全连接' : '相带+置信', { size: 8.5, fill: C.ink2, anchor: 'middle' });
    }
    s += G.txt(x0, y0 - 12, '卷积分类网络：切片 → 相带类别 + 置信度', { size: 9.5, fill: C.ink2, weight: 700 });

    /* 右：分类结果缩略 */
    var rx = 30 + 20, ry = y0 + 140;
    var p2 = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var cc = 0; cc < COLS; cc++, p2++) {
        var x = rx + cc * (W + gap), y = ry + r * (H + gap);
        var wrong = cls.cls[p2] !== grid.grid[p2].facies;
        s += G.rect(x, y, W, H, { r: 3, fill: M.FACI_COLORS[cls.cls[p2]], stroke: wrong ? '#b05a51' : 'none', sw: 1.5 });
      }
    }
    s += G.txt(rx, ry - 8, '分类结果（×=错）', { size: 8.5, fill: C.ink3, anchor: 'middle' });
    s += G.txt(rx, ry + 60, '整体准确率 ' + f(ev.acc * 100, 1) + '%', { size: 9.5, fill: C.jadeD, weight: 700 });
    s += G.txt(rx, ry + 76, '常见相带偏高 · 稀有相带偏低', { size: 8.5, fill: C.ink3 });

    return { svg: s, stats: [{ k: '准确率', v: f(ev.acc * 100, 1) + '%' }, { k: '类别', v: L.nFacies + ' 类' }], note: '切片分类为每个切片预测一个相带类别与置信度。类别不均衡下准确率可能被常见相带拉高，但稀有相带全错，要看各类 F1。' };
  }

  /* =========================================================
     ④ 半监督扩展
     ========================================================= */
  function stage4(t) {
    var c = compute(), semi = c.semi, L = c.L;
    var s = '';
    s += G.panel(0, '① 井标签', '稀疏高可信', C.jade);
    s += G.panel(1, '② 高置信伪标签', '扩展样本', C.blue);
    s += G.panel(2, '③ 全数据体', '覆盖 1 万—10 万片', C.clay);

    var x0 = 30, y0 = 130;
    var sMap = '';
    var p = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var cc = 0; cc < COLS; cc++, p++) {
        var x = x0 + cc * (W + gap), y = y0 + r * (H + gap);
        var fill = semi.labeled[p] ? '#2f7d6b' : semi.pseudo[p] ? '#b26a39' : '#e9e4d8';
        sMap += G.rect(x, y, W, H, { r: 3, fill: fill });
      }
    }
    s += sMap;
    s += G.txt(x0, y0 - 12, '半监督扩展 · 井 ' + semi.nLabeled + ' · 伪 ' + semi.pseudoCount, { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(320, 270, 130, 192, '伪标签怎么用',
      ['· 未标注切片里，高置信预测转伪标签',
       '· 低置信保留给人工复核',
       '· 扩充训练样本缓解稀疏',
       '',
       '伪标签错误会自我强化 → 越训越偏',
       '必须置信度过滤 + 低置信留人工。'], 'blue');

    s += G.txt(x0, y0 + 208, '伪标签阈值 ' + f(L.pseudoThr, 2) + ' · 越高越可信但覆盖越少', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '井标签', v: semi.nLabeled }, { k: '伪标签', v: semi.pseudoCount }, { k: '阈值', v: f(L.pseudoThr, 2) }], note: '半监督用伪标签把稀疏井标签扩展成全数据体样本。伪标签带错误会自我强化、越训越偏，必须用置信度过滤并保留低置信给人工复核。' };
  }

  /* =========================================================
     ⑤ 相带概率体
     ========================================================= */
  function stage5(t) {
    var c = compute(), prob = c.prob, L = c.L;
    var s = '';
    s += G.panel(0, '① 逐切片分类', '相带+置信度', C.jade);
    s += G.panel(1, '② 邻域一致化', '相带连续', C.blue);
    s += G.panel(2, '③ 相带概率体', '连续可入库', C.clay);

    var x0 = 30, y0 = 130;
    var sMap = '';
    var p = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var cc = 0; cc < COLS; cc++, p++) {
        var x = x0 + cc * (W + gap), y = y0 + r * (H + gap);
        sMap += G.rect(x, y, W, H, { r: 3, fill: M.FACI_COLORS[prob.clsSmooth[p]] });
      }
    }
    s += sMap;
    s += G.txt(x0, y0 - 12, '相带概率体（邻域一致化 ×' + L.smooth + '）', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(320, 270, 130, 192, '为什么要一致化',
      ['· 逐切片分类有盐椒噪声',
       '· 相邻切片相带本应连续',
       '· 邻域多数投票抹平孤立误判',
       '· 得到连续、可入库的相带体',
       '',
       '不一致化 → 盐椒噪声不可用',
       '过度平滑 → 小相带被抹掉。'], 'jade');

    s += G.txt(x0, y0 + 208, '平滑次数太多会把小相带抹掉 · 太少则全是盐椒噪声', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '平滑', v: '×' + L.smooth }, { k: '输出', v: '相带概率体' }], note: '逐切片分类结果有盐椒噪声，邻域一致化抹平孤立误判得到连续相带概率体。过度平滑会把小相带抹掉，不做则全是噪声不可用。' };
  }

  /* =========================================================
     ⑥ 复核与预测
     ========================================================= */
  function stage6(t) {
    var c = compute(), prob = c.prob, grid = c.grid, L = c.L;
    var s = '';
    s += G.panel(0, '① 低置信相带', '边界区复核', C.blue);
    s += G.panel(1, '② 人工修正', '局部调整', C.clay);
    s += G.panel(2, '③ 储层预测', '井位优选+回流', C.jade);

    var x0 = 30, y0 = 130;
    var sMap = '';
    var p = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var cc = 0; cc < COLS; cc++, p++) {
        var x = x0 + cc * (W + gap), y = y0 + r * (H + gap);
        var wrong = prob.clsSmooth[p] !== grid.grid[p].facies;
        var fill = wrong ? '#b05a51' : M.FACI_COLORS[prob.clsSmooth[p]];
        sMap += G.rect(x, y, W, H, { r: 3, fill: fill });
      }
    }
    s += sMap;
    s += G.txt(x0, y0 - 12, '人工复核 · 红色 = 分类错误需人工修正', { size: 9.5, fill: C.ink2, weight: 700 });

    s += footBox(320, 270, 130, 192, '人在环的价值',
      ['· 人只处理低置信、边界区',
       '· 局部修正后确认相带图',
       '· 相带体进入储层预测与井位优选',
       '· 错误反馈回训练集持续改进',
       '',
       '无人在环 → 分类错误直接进',
       '储层预测 → 井位优选扩散。'], 'clay');

    s += G.txt(x0, y0 + 208, '产出：客观可复现的相带概率体 + 置信度字段 → 储层预测', { size: 9, fill: C.ink3 });
    return { svg: s, stats: [{ k: '复核', v: '低置信区' }, { k: '产出', v: '相带概率体' }], note: '解释员对低置信相带与边界区抽查复核，局部修正后相带体进入储层预测与井位优选。错误反馈回训练集，模型持续改进。' };
  }

  global.RemoteFlow = { stage1: stage1, stage2: stage2, stage3: stage3, stage4: stage4, stage5: stage5, stage6: stage6 };

})(typeof window !== 'undefined' ? window : global);
