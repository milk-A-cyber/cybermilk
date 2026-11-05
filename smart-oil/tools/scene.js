/* =========================================================
   场景页截图（把案例清单直接注册进 Cases 后渲染）
   运行：node tools/scene.js <case-dir> <sceneId> <tab> <out.png> [width] [height]
   tab: bg | flow | demo
   ========================================================= */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const ASSET = ('file:///' + path.join(ROOT, 'assets').replace(/\\/g, '/')).replace(/\\/g, '/');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const CASE_DIR = process.argv[2] || 'pumping-diag-case';
const SCENE = process.argv[3] || 'pr1';
const TAB = process.argv[4] || 'flow';
const OUT = process.argv[5] || path.join(__dirname, '_tmp', 'out', 'scene.png');
const W = Number(process.argv[6] || 1240);
const H = Number(process.argv[7] || 3600);

const manifest = fs.readFileSync(path.join(ROOT, CASE_DIR, 'case.json'), 'utf8')
  .replace(/<\//g, '<\\/');

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>scene shot</title>
<link rel="stylesheet" href="${ASSET}/core/tokens.css">
<link rel="stylesheet" href="${ASSET}/core/layout.css">
<link rel="stylesheet" href="${ASSET}/core/ui.css">
</head><body>
<div id="view"></div>
<script src="${ASSET}/data.js"></script>
<script src="${ASSET}/core/registry.js"></script>
<script src="${ASSET}/core/kit.js"></script>
<script>window.__MANIFEST__ = ${manifest};</script>
<script>
(function () {
  var m = window.__MANIFEST__;
  window.Cases.register({
    id: m.id, sceneId: m.sceneId, title: m.title,
    status: 'ready', version: m.version, updated: m.updated, methods: m.methods,
    tabs: m.tabs
  });
})();
</script>
<script src="${ASSET}/core/case-demo-host.js"></script>
<script src="${ASSET}/core/case-upload.js"></script>
<script src="${ASSET}/core/admin.js"></script>
<script src="${ASSET}/core/shell.js"></script>
<script>
setTimeout(function () {
  location.hash = '#/scene/${SCENE}?tab=${TAB}';
  setTimeout(function () { document.title = 'SHOT_READY'; }, 1200);
}, 500);
</script>
</body></html>`;

const tmp = path.join(__dirname, '_tmp', '_scene.html');
fs.writeFileSync(tmp, html);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars',
  '--window-size=' + W + ',' + H,
  '--virtual-time-budget=7000',
  '--screenshot=' + OUT,
  'file:///' + tmp.replace(/\\/g, '/')
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
fs.unlinkSync(tmp);
console.log('SHOT=' + OUT + ' size=' + (fs.existsSync(OUT) ? fs.statSync(OUT).size : 0));
