射孔孔道形态预测 · 数值模拟 + 代理模型 + 仿真—实测标定
=======================================================

【这是什么】
石油勘探开发智能化案例集的「射孔」环节（环节8）案例 p2。
射孔孔道的穿透深度与清洁度决定有效流动面积。本案例用数值模拟
批量生成训练集，训练代理模型快速预测孔道形态，再用靶试实测
做仿真—实测标定，替代逐方案仿真。

【怎么用】
用浏览器直接打开 demo/index.html 即可运行。页面分三块：
  · 算法解剖：顶部 6 步动画，把「孔道形态预测」拆开逐步演示
  · 屏 1 数值模拟生成训练集
  · 屏 2 代理模型快速预测
  · 屏 3 仿真—实测标定
模型层在 demo/demo.js 顶部（纯函数），浏览器里实时算，没有后端。

【文件清单】
  p2-perforation-shape-case/
    case.json          案例元数据（专业背景/流程/示范）
    _validate.js       模型层单测：node _validate.js（失败 exit 1）
    README.txt         本文件
    demo/
      index.html       示范页（含三屏 + 算法解剖）
      demo.js          模型层 + 浏览器接线（genSim/trainProxy/genTruth/calibrate/predictShape）
      flow.js          算法解剖 6 步（依赖 window.RemoteBridge + AFlow）
      aflow.js/.css    算法解剖引擎（通用，未改）
      aiq.js/.css      解释问答/控件脚本（通用，未改）
      demo.css         示范页样式（通用，未改）

【示范内容】
三屏 + 算法解剖，全部真计算：
  · 数值模拟：批量生成训练集
  · 代理模型：kNN 插值
  · 快速预测：穿深/孔径/清洁度
  · 靶试实测：少量真值
  · 仿真—实测标定：scale 修正
  · 标定后预测：贴近实测

【想改成你自己的案例】
1. 换数据：改 demo.js 顶部 genSim / genTruth（换 seed 或改模拟逻辑）。
2. 换模型：改 trainProxy / calibrate / predictShape（换插值或标定算法）。
3. 换页面：改 index.html 的标题、三屏文案与 DOM id 对应关系。
4. 换流程：改 flow.js 六个 stage 的文案与图，保持 stageN(t)->{svg,stats,note}。
改完跑：node _validate.js 校验模型层，node --check 检查语法。
