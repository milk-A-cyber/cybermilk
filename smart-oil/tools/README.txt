tools/ · 开发工具（不参与网站运行）
====================================

这些脚本只用于开发期自测与批量生成内容，网站本身不加载它们。
运行前先 `cd` 到项目根目录。

  figlib.js       构图函数库：6 个可复用的 SVG 构图器
                  （loopDiagram / twoMethodDiagram / gateDiagram /
                    pipelineDiagram / scatter2dDiagram / timelineDiagram）
  mkfigs.js       批量生成「案例流程每步一图」，写回各 case.json 的 steps[].fig
  mkbg.js         批量生成「专业背景概念图」，写回各 case.json 的 sections[].html
                  （两个脚本都是幂等的：重跑先删旧图再插新图）

  upload.js       模拟「＋ 添加案例」上传文件夹：走真实的
                  CaseImport.open → 拖文件 → 校验 → 提交 通道
                  用法：node tools/upload.js pumping-diag-case
  upload-zip.js   同上，但走 .zip 解压通道
                  用法：node tools/upload-zip.js pumping-diag-case.zip
  demo.js         直接打开示范页，检查「算法解剖」动画是否挂上、各阶段读数是否对
                  用法：node tools/demo.js pumping-diag-case flowMount
  ctlcheck.js     控件体检（走演示页真实的 postMessage 通道）：
                  核对每个抽屉控件能否唯一命中子页面元素、拖/点后是否有反馈、
                  哪些控件在抽屉里但没挂 data-ctl-id（点了是死的）
                  用法：node tools/ctlcheck.js <case-dir> [width]
  ctlhost.js      控件抽屉的宿主级验证：按主站真实方式挂 CaseDemoHost，
                  打开右侧抽屉、点预设按钮，看滑杆是否联动 + 截图留证
                  用法：node tools/ctlhost.js <case-dir> [out.png] [sectionId]
  flowcheck.js    「算法解剖」动画逐阶段体检：依次点开每个阶段节点，
                  抓「绘制失败 / B.xxx is not a function」这类被吞掉的渲染错误
                  用法：node tools/flowcheck.js <case-dir> [mountId]
  ctlinfl.js      控件「影响面」探针：逐个改控件值，比对每一段的图指纹，
                  列出「这个控件到底能改动哪几段」——抽屉该放哪些控件以此为准
                  （自动播放的「算法解剖」会先跳到末段并暂停定帧再比对；
                   仍在动的段退回文字指纹判定）
                  用法：node tools/ctlinfl.js <case-dir> [width]
  ctltop.js       首屏控件验证：不滚动加载案例页，检查抽屉是否已弹出、标题与控件数对不对
                  用法：node tools/ctltop.js <case-dir> [out.png]
  regress.js      注册案例后检查场景页三个 tab 的渲染（背景图数 / 步骤数 / 步骤图数）
  site.js         主站各页渲染回归（首页 / 案例库 / 指南 / 场景页）
  scene.js        场景页截图
                  用法：node tools/scene.js <case-dir> <sceneId> <tab> <out.png>
  shot-stage.js   示范页「算法解剖」指定阶段截图
                  用法：node tools/shot-stage.js <case-dir> <out.png> <stageIdx> <t>
  demoheight.js   示范 iframe 高度校验：比对 iframe 高度与子页面文档高，
                  用来确认「可运行示范」里没有出现内滚动条
                  用法：node tools/demoheight.js 1180
  run.js          任意页面 dump-dom

无头浏览器：Chrome（--headless=new --allow-file-access-from-files）
临时产物写到 tools/_tmp/，可随时删除。
