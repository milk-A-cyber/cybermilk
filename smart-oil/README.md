# 石油勘探开发的智能化可能性地图

按石油作业链条（地质勘察 → 物探 → 钻井 → 测井 → 录井 → 固井 → 完井 → 射孔 → 采油）逐环节展示可被深度学习改造的候选场景，标注 AI 介入点、数据条件与难度等级；每个案例配有专业背景、落地流程与**可运行的交互示范**。

纯静态站点（无后端、无数据库），部署到 GitHub Pages 后直接访问首页即可浏览全部 **41 个案例**。

## 运行

- 本地直接打开 `index.html`，或起一个静态服务器：
  ```sh
  python -m http.server 8000
  ```
- 线上：GitHub Pages 托管本仓库根目录。

## 结构

```
index.html              入口（脚本按顺序加载）
assets/
  data.js               场景元数据（13 环节 61 场景）
  cases/*.case.js       案例插件（41 个内置案例，tools/build-cases.js 生成）
  core/                 注册表 / 渲染壳 / 示范宿主 / 案例上传
tools/                  开发期工具（生成、验证、截图，不参与网站运行）
<环节>-<场景>/*          41 个案例源目录（case.json + demo/）
```

## 添加 / 修改案例

1. 改案例源目录里的 `case.json` 与 `demo/`；
2. 重跑 `node tools/build-cases.js` 重新生成内置插件；
3. 用 `node tools/verify-cases-live.js` 做无头验证。
