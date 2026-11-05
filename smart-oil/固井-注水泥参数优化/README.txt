注水泥参数优化 · 密度窗口约束推荐
============================================

【这是什么】
石油勘探开发智能化案例集的「固井」环节（环节6）案例 c2。
注水泥设计要确定水泥浆密度、流变性、排量与替浆方案，目标是在不漏失的
前提下实现全封固。本案例建立"井况—浆体—顶替效率"映射，在密度窗口
约束内推荐浆柱结构与排量，替代沿用邻井经验的做法。

【怎么用】
用浏览器直接打开 demo/index.html 即可运行。页面分三块：
  · 算法解剖：顶部 6 步动画，把「注水泥设计」拆开逐步演示
  · 屏 1 井况压力窗口：看各井密度窗口，窄窗口易漏失
  · 屏 2 参数优化：密度×排量热力图，找不漏失且顶替效率最高的点
  · 屏 3 结果对比：邻井经验 vs 约束优化推荐
模型层在 demo/demo.js 顶部（纯函数），浏览器里实时算，没有后端。

【文件清单】
  c2-cement-opt-case/
    case.json          案例元数据（专业背景/流程/示范）
    _validate.js       模型层单测：node _validate.js（失败 exit 1）
    README.txt         本文件
    demo/
      index.html       示范页（含三屏 + 算法解剖）
      demo.js          模型层 + 浏览器接线（genCementJob/optimizeSlurry/recommendDesign）
      flow.js          算法解剖 6 步（依赖 window.RemoteBridge + AFlow）
      aflow.js/.css    算法解剖引擎（通用，未改）
      aiq.js/.css      解释问答/控件脚本（通用，未改）
      demo.css         示范页样式（通用，未改）

【示范内容】
三屏 + 算法解剖，全部真计算：
  · 压力窗口：孔隙压力与破裂压力当量密度之间的密度约束
  · 参数优化：密度×排量扫描，筛漏失后取顶替效率最高者
  · 结果对比：邻井经验 vs 约束优化推荐

【想改成你自己的案例】
1. 换数据：改 demo.js 顶部 genCementJob（换 seed 或改压力窗口生成）。
2. 换模型：改 optimizeSlurry / recommendDesign（换扫描或约束逻辑）。
3. 换页面：改 index.html 的标题、三屏文案与 DOM id 对应关系。
4. 换流程：改 flow.js 六个 stage 的文案与图，保持 stageN(t)->{svg,stats,note}。
改完跑：node _validate.js 校验模型层，node --check 检查语法。
