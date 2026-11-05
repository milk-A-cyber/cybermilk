射孔效果智能评估 · 生产数据反演 + 不确定性量化 + 补孔建议
=========================================================

【这是什么】
石油勘探开发智能化案例集的「射孔」环节（环节8）案例 p4。
射孔效果（完善度、表皮系数）只能通过试井或生产数据间接反演。
本案例从生产数据反演各射孔段的效率（带不确定性区间），识别
低效段并给出补孔建议。

【怎么用】
用浏览器直接打开 demo/index.html 即可运行。页面分三块：
  · 算法解剖：顶部 6 步动画，把「效果评估」拆开逐步演示
  · 屏 1 生产数据 + 射孔记录
  · 屏 2 效率反演（不确定性区间）
  · 屏 3 低效段识别 + 补孔建议
模型层在 demo/demo.js 顶部（纯函数），浏览器里实时算，没有后端。

【文件清单】
  p4-perforation-eval-case/
    case.json          案例元数据（专业背景/流程/示范）
    _validate.js       模型层单测：node _validate.js（失败 exit 1）
    README.txt         本文件
    demo/
      index.html       示范页（含三屏 + 算法解剖）
      demo.js          模型层 + 浏览器接线（genProd/invertEff/identifyLowEff/recommendPatch）
      flow.js          算法解剖 6 步（依赖 window.RemoteBridge + AFlow）
      aflow.js/.css    算法解剖引擎（通用，未改）
      aiq.js/.css      解释问答/控件脚本（通用，未改）
      demo.css         示范页样式（通用，未改）

【示范内容】
三屏 + 算法解剖，全部真计算：
  · 生产数据：产量时序
  · 射孔记录：层段/孔密/相位
  · 反演：各段效率
  · 不确定性：区间
  · 低效识别：阈值
  · 补孔建议：增益估计

【想改成你自己的案例】
1. 换数据：改 demo.js 顶部 genProd（换 seed 或改生产数据生成）。
2. 换模型：改 invertEff / identifyLowEff / recommendPatch（换反演或判别逻辑）。
3. 换页面：改 index.html 的标题、三屏文案与 DOM id 对应关系。
4. 换流程：改 flow.js 六个 stage 的文案与图，保持 stageN(t)->{svg,stats,note}。
改完跑：node _validate.js 校验模型层，node --check 检查语法。
