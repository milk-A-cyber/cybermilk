套管居中度智能评估 · 几何计算 + 组合优化
============================================

【这是什么】
石油勘探开发智能化案例集的「固井」环节（环节6）案例 c4。
套管居中度直接影响固井质量，偏心过大导致水泥环厚度不均。本案例
从井径与井斜计算居中度曲线，优化扶正器安放位置与间距，用 CBL
评级验证。

【怎么用】
用浏览器直接打开 demo/index.html 即可运行。页面分三块：
  · 算法解剖：顶部 6 步动画，把「套管居中度评估」拆开逐步演示
  · 屏 1 井径与井斜剖面：看全井段井径起伏与井斜狗腿
  · 屏 2 居中度曲线：对比无扶正与有扶正的居中度
  · 屏 3 扶正器安放优化：调间距，看安放位置与居中度改善
模型层在 demo/demo.js 顶部（纯函数），浏览器里实时算，没有后端。

【文件清单】
  c4-centralizer-case/
    case.json          案例元数据（专业背景/流程/示范）
    _validate.js       模型层单测：node _validate.js（失败 exit 1）
    README.txt         本文件
    demo/
      index.html       示范页（含三屏 + 算法解剖）
      demo.js          模型层 + 浏览器接线（genCasingGeo/centralizerOpt/standoffEval）
      flow.js          算法解剖 6 步（依赖 window.RemoteBridge + AFlow）
      aflow.js/.css    算法解剖引擎（通用，未改）
      aiq.js/.css      解释问答/控件脚本（通用，未改）
      demo.css         示范页样式（通用，未改）

【示范内容】
三屏 + 算法解剖，全部真计算：
  · 井径与井斜：全井段剖面，缩径与狗腿驱动偏心
  · 居中度：standoff = 1 - 2·ecc/(Db-Dc)
  · 扶正器安放：组合优化位置与间距，低段优先加密
  · CBL 评级：固井质量反馈闭环验证

【想改成你自己的案例】
1. 换数据：改 demo.js 顶部 genCasingGeo（换 seed 或改井径/井斜生成）。
2. 换优化：改 centralizerOpt / standoffEval（换安放或评级逻辑）。
3. 换页面：改 index.html 的标题、三屏文案与 DOM id 对应关系。
4. 换流程：改 flow.js 六个 stage 的文案与图，保持 stageN(t)->{svg,stats,note}。
改完跑：node _validate.js 校验模型层，node --check 检查语法。
