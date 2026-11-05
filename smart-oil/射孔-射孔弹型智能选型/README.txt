射孔弹型智能选型 · 知识图谱 + 规则匹配 + 排序
=============================================

【这是什么】
石油勘探开发智能化案例集的「射孔」环节（环节8）案例 p3。
不同射孔弹在穿深、孔径与对套管损伤上各有取舍。本案例用知识
图谱组织弹型—参数—适用条件关系，按井况做规则匹配筛掉不适用
的弹型，再按综合得分排序候选，替代人工查手册选型。

【怎么用】
用浏览器直接打开 demo/index.html 即可运行。页面分三块：
  · 算法解剖：顶部 6 步动画，把「弹型选型」拆开逐步演示
  · 屏 1 射孔弹知识库（知识图谱）
  · 屏 2 井况规则匹配
  · 屏 3 候选排序推荐
模型层在 demo/demo.js 顶部（纯函数），浏览器里实时算，没有后端。

【文件清单】
  p3-shape-select-case/
    case.json          案例元数据（专业背景/流程/示范）
    _validate.js       模型层单测：node _validate.js（失败 exit 1）
    README.txt         本文件
    demo/
      index.html       示范页（含三屏 + 算法解剖）
      demo.js          模型层 + 浏览器接线（buildKB/makeWell/matchBullets/rankBullets/kgNodes）
      flow.js          算法解剖 6 步（依赖 window.RemoteBridge + AFlow）
      aflow.js/.css    算法解剖引擎（通用，未改）
      aiq.js/.css      解释问答/控件脚本（通用，未改）
      demo.css         示范页样式（通用，未改）

【示范内容】
三屏 + 算法解剖，全部真计算：
  · 弹型知识库：弹型—参数—适用条件
  · 井况接入：岩性/钢级/壁厚
  · 规则匹配：筛掉不适用
  · 综合得分：穿深/孔径/命中/反馈
  · 排序：候选弹型
  · 推荐选型：首推弹型

【想改成你自己的案例】
1. 换数据：改 demo.js 顶部 buildKB（换弹型库或加型号）。
2. 换模型：改 matchBullets / rankBullets（换匹配规则或打分权重）。
3. 换页面：改 index.html 的标题、三屏文案与 DOM id 对应关系。
4. 换流程：改 flow.js 六个 stage 的文案与图，保持 stageN(t)->{svg,stats,note}。
改完跑：node _validate.js 校验模型层，node --check 检查语法。
