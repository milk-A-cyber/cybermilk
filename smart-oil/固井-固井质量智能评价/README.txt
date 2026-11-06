固井质量智能评价 · CBL/VDL 波形分段分类
============================================

【这是什么】
石油勘探开发智能化案例集的「固井」环节（环节6）案例 c1。
固井质量决定层间封隔，评价依据是 CBL/VDL 测井：水泥胶结好则套管波弱、
地层波强，传统由解释员按胶结指数分段评级。本案例用「波形分段分类」
输出胶结等级曲线，替代人工分段评级。

【怎么用】
用浏览器直接打开 demo/index.html 即可运行。页面分三块：
  · 算法解剖：顶部 6 步动画，把「CBL/VDL → 胶结等级」拆开逐步演示
  · 屏 1 胶结指数基线：拖滑块调良/差分界，看评级准确率与判错
  · 屏 2 波形分段分类：切单特征/多特征，输出胶结等级曲线
  · 屏 3 验窜验证 + 复核：看判错清单，验窜结果复核
模型层在 demo/demo.js 顶部（纯函数），浏览器里实时算，没有后端。

【文件清单】
  c1-cement-eval-case/
    case.json          案例元数据（专业背景/流程/示范）
    _validate.js       模型层单测：node _validate.js（失败 exit 1）
    README.txt         本文件
    demo/
      index.html       示范页（含三屏 + 算法解剖）
      demo.js          模型层 + 浏览器接线（genCement/cementEval/segClassify）
      flow.js          算法解剖 6 步（依赖 window.RemoteBridge + AFlow）
      aflow.js/.css    算法解剖引擎（通用，未改）
      aiq.js/.css      解释问答/控件脚本（通用，未改）
      demo.css         示范页样式（通用，未改）

【示范内容】
三屏 + 算法解剖，全部真计算：
  · 胶结指数基线：固定阈值分级（优>0.75，良>分界，否则差）
  · 波形分段分类：套管波 + 地层波融合，输出胶结等级曲线
  · 验窜验证：评级结果与后续验窜（挤水泥/试压）对照

【想改成你自己的案例】
1. 换数据：改 demo.js 顶部 genCement（换 seed 或改胶结段生成）。
2. 换模型：改 cementEval / segClassify（换分级规则或特征融合方式）。
3. 换页面：改 index.html 的标题、三屏文案与 DOM id 对应关系。
4. 换流程：改 flow.js 六个 stage 的文案与图，保持 stageN(t)->{svg,stats,note}。
改完跑：node _validate.js 校验模型层，node --check 检查语法。
