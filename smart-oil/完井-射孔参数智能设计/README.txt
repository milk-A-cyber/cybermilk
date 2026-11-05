射孔参数智能设计 · 代理模型 + 多目标优化
============================================

【这是什么】
石油勘探开发智能化案例集的「完井」环节（环节7）案例 co2。
射孔参数（孔密、相位、穿深）影响产能与出砂风险。本案例用代理
模型预测不同参数组合的产能与出砂风险，多目标优化给出帕累托
方案集。

【怎么用】
用浏览器直接打开 demo/index.html 即可运行。页面分三块：
  · 算法解剖：顶部 6 步动画，把「射孔参数设计」拆开逐步演示
  · 屏 1 储层力学参数：看储层强度、应力与射孔参数空间
  · 屏 2 代理模型响应：调强度与相位，看产能与出砂随穿深变化
  · 屏 3 帕累托前沿：看产能与出砂的帕累托权衡
模型层在 demo/demo.js 顶部（纯函数），浏览器里实时算，没有后端。

【文件清单】
  co2-perforation-opt-case/
    case.json          案例元数据（专业背景/流程/示范）
    _validate.js       模型层单测：node _validate.js（失败 exit 1）
    README.txt         本文件
    demo/
      index.html       示范页（含三屏 + 算法解剖）
      demo.js          模型层 + 浏览器接线（genPerfData/proxyModel/paretoOpt）
      flow.js          算法解剖 6 步（依赖 window.RemoteBridge + AFlow）
      aflow.js/.css    算法解剖引擎（通用，未改）
      aiq.js/.css      解释问答/控件脚本（通用，未改）
      demo.css         示范页样式（通用，未改）

【示范内容】
三屏 + 算法解剖，全部真计算：
  · 储层力学参数：强度/应力/渗透率 + 参数空间
  · 代理模型：产能与出砂随穿深变化
  · 多目标优化：枚举组合找帕累托
  · 帕累托前沿：产能 vs 出砂权衡集

【想改成你自己的案例】
1. 换数据：改 demo.js 顶部 genPerfData（换 seed 或改储层/参数生成）。
2. 换模型：改 proxyModel / paretoOpt（换产能/出砂或优化逻辑）。
3. 换页面：改 index.html 的标题、三屏文案与 DOM id 对应关系。
4. 换流程：改 flow.js 六个 stage 的文案与图，保持 stageN(t)->{svg,stats,note}。
改完跑：node _validate.js 校验模型层，node --check 检查语法。
