固井漏失风险预测 · 分类模型 + 特征归因
============================================

【这是什么】
石油勘探开发智能化案例集的「固井」环节（环节6）案例 c3。
固井漏失是最常见的固井事故，一旦发生轻则返高不够、重则整井重注，
需要在施工前预判风险等级。本案例用分类模型基于井况与浆柱设计预测
漏失概率，输出风险等级与关键影响因素。

【怎么用】
用浏览器直接打开 demo/index.html 即可运行。页面分三块：
  · 算法解剖：顶部 6 步动画，把「漏失风险预测」拆开逐步演示
  · 屏 1 类不均衡分布：看漏失事件占比，类不均衡
  · 屏 2 漏失概率分类：切井与阈值，看漏失概率与风险等级
  · 屏 3 特征归因：看关键影响因素及贡献占比
模型层在 demo/demo.js 顶部（纯函数），浏览器里实时算，没有后端。

【文件清单】
  c3-leak-risk-case/
    case.json          案例元数据（专业背景/流程/示范）
    _validate.js       模型层单测：node _validate.js（失败 exit 1）
    README.txt         本文件
    demo/
      index.html       示范页（含三屏 + 算法解剖）
      demo.js          模型层 + 浏览器接线（genLeakCase/leakClassify/riskExplain）
      flow.js          算法解剖 6 步（依赖 window.RemoteBridge + AFlow）
      aflow.js/.css    算法解剖引擎（通用，未改）
      aiq.js/.css      解释问答/控件脚本（通用，未改）
      demo.css         示范页样式（通用，未改）

【示范内容】
三屏 + 算法解剖，全部真计算：
  · 类不均衡：漏失事件占比低，模型易偏向多数类
  · 漏失概率：裕度（破裂压力-当量循环密度）越小越易漏失，logistic 概率
  · 风险等级：按概率输出低/中/高
  · 特征归因：关键影响因素及贡献占比

【想改成你自己的案例】
1. 换数据：改 demo.js 顶部 genLeakCase（换 seed 或改漏失生成）。
2. 换模型：改 leakClassify / riskExplain（换概率或归因逻辑）。
3. 换页面：改 index.html 的标题、三屏文案与 DOM id 对应关系。
4. 换流程：改 flow.js 六个 stage 的文案与图，保持 stageN(t)->{svg,stats,note}。
改完跑：node _validate.js 校验模型层，node --check 检查语法。
