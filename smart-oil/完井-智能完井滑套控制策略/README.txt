智能完井滑套控制策略 · 强化学习
==================================

【这是什么】
石油勘探开发智能化案例集的「完井」环节（环节7）案例 co4。
智能完井把井筒分成多段，每段配可遥控开关的滑套。本案例用强化
学习在储层模拟器上学习滑套控制策略，最大化累计产量并抑制含水
上升。

【怎么用】
用浏览器直接打开 demo/index.html 即可运行。页面分三块：
  · 算法解剖：顶部 6 步动画，把「滑套控制」拆开逐步演示
  · 屏 1 储层分段：看多段储层的渗透率与含水分布
  · 屏 2 Q-learning 训练：调含水惩罚权重，看奖励收敛
  · 屏 3 策略评估：看 RL vs 全开的产油与含水
模型层在 demo/demo.js 顶部（纯函数），浏览器里实时算，没有后端。

【文件清单】
  co4-smart-slide-case/
    case.json          案例元数据（专业背景/流程/示范）
    _validate.js       模型层单测：node _validate.js（失败 exit 1）
    README.txt         本文件
    demo/
      index.html       示范页（含三屏 + 算法解剖）
      demo.js          模型层 + 浏览器接线（genReservoir/rlTrain/slideEval）
      flow.js          算法解剖 6 步（依赖 window.RemoteBridge + AFlow）
      aflow.js/.css    算法解剖引擎（通用，未改）
      aiq.js/.css      解释问答/控件脚本（通用，未改）
      demo.css         示范页样式（通用，未改）

【示范内容】
三屏 + 算法解剖，全部真计算：
  · 储层分段：渗透率 × 含水
  · 滑套动作：开/关
  · 储层模拟器：机理模型
  · Q-learning：奖励收敛
  · 策略学习：抑制含水
  · 策略评估：RL vs 全开

【想改成你自己的案例】
1. 换数据：改 demo.js 顶部 genReservoir（换 seed 或改储层生成）。
2. 换模型：改 rlTrain / slideEval（换学习算法或评估逻辑）。
3. 换页面：改 index.html 的标题、三屏文案与 DOM id 对应关系。
4. 换流程：改 flow.js 六个 stage 的文案与图，保持 stageN(t)->{svg,stats,note}。
改完跑：node _validate.js 校验模型层，node --check 检查语法。
