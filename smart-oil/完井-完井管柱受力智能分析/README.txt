完井管柱受力智能分析 · 代理模型 + 可靠性评估
=================================================

【这是什么】
石油勘探开发智能化案例集的「完井」环节（环节7）案例 co3。
生产管柱在温度、压力变化下产生轴向力，设计不当导致屈曲、接头
泄漏甚至断脱。本案例用代理模型快速预测多工况下的载荷与安全
系数，识别高风险工况组合，可靠性评估失效概率。

【怎么用】
用浏览器直接打开 demo/index.html 即可运行。页面分三块：
  · 算法解剖：顶部 6 步动画，把「管柱受力分析」拆开逐步演示
  · 屏 1 管柱结构与材料：看钢级随下深分布与轴向力来源
  · 屏 2 载荷安全系数云图：调钢级与工况，看 ΔT×ΔP 网格安全系数
  · 屏 3 可靠性与敏感性：看安全系数分布与失效概率
模型层在 demo/demo.js 顶部（纯函数），浏览器里实时算，没有后端。

【文件清单】
  co3-tubing-force-case/
    case.json          案例元数据（专业背景/流程/示范）
    _validate.js       模型层单测：node _validate.js（失败 exit 1）
    README.txt         本文件
    demo/
      index.html       示范页（含三屏 + 算法解剖）
      demo.js          模型层 + 浏览器接线（genTubing/loadAgent/reliabilityEval）
      flow.js          算法解剖 6 步（依赖 window.RemoteBridge + AFlow）
      aflow.js/.css    算法解剖引擎（通用，未改）
      aiq.js/.css      解释问答/控件脚本（通用，未改）
      demo.css         示范页样式（通用，未改）

【示范内容】
三屏 + 算法解剖，全部真计算：
  · 管柱结构：钢级随下深分布
  · 载荷来源：自重/温度/压力/鼓胀
  · 代理模型：安全系数云图
  · 高风险识别：最险工况组合
  · 可靠性评估：失效概率 + 敏感性

【想改成你自己的案例】
1. 换数据：改 demo.js 顶部 genTubing（换 seed 或改管柱/工况生成）。
2. 换模型：改 loadAgent / reliabilityEval（换受力或可靠性逻辑）。
3. 换页面：改 index.html 的标题、三屏文案与 DOM id 对应关系。
4. 换流程：改 flow.js 六个 stage 的文案与图，保持 stageN(t)->{svg,stats,note}。
改完跑：node _validate.js 校验模型层，node --check 检查语法。
