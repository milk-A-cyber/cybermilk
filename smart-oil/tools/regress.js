/* 场景页回归：注册案例后检查「专业背景 / 案例流程 / 可运行示范」三 tab 的渲染 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
require('fs').mkdirSync(path.join(__dirname, '_tmp'), { recursive: true });
const ASSET = ('file:///' + path.join(ROOT, 'assets').replace(/\\/g, '/')).replace(/\\/g, '/');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const CASES = [
  ['firstbreak-pick-case', 's3'],
  ['pumping-diag-case', 'pr1'],
  ['esp-fault-case', 'pr4'],
  ['prod-forecast-case', 'pr2'],
  ['waterflood-case', 'pr3'],
  ['wax-scale-case', 'pr5']
];

for (const [dir, scene] of CASES) {
  const manifest = fs.readFileSync(path.join(ROOT, dir, 'case.json'), 'utf8').replace(/<\//g, '<\\/');
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="${ASSET}/core/tokens.css">
<link rel="stylesheet" href="${ASSET}/core/layout.css">
<link rel="stylesheet" href="${ASSET}/core/ui.css"></head><body>
<div id="view"></div>
<script>window.__ERR__=[];window.addEventListener('error',function(e){window.__ERR__.push(e.message);});</script>
<script src="${ASSET}/data.js"></script>
<script src="${ASSET}/core/registry.js"></script>
<script src="${ASSET}/core/kit.js"></script>
<script>window.__MANIFEST__=${manifest};</script>
<script>
(function(){var m=window.__MANIFEST__;window.Cases.register({id:m.id,sceneId:m.sceneId,title:m.title,status:'ready',version:m.version,updated:m.updated,methods:m.methods,tabs:m.tabs});})();
</script>
<script src="${ASSET}/core/case-demo-host.js"></script>
<script src="${ASSET}/core/case-upload.js"></script>
<script src="${ASSET}/core/admin.js"></script>
<script src="${ASSET}/core/shell.js"></script>
<script>
setTimeout(function(){
  location.hash='#/scene/${scene}';
  setTimeout(function(){
    var o=[];
    o.push('tabs='+document.querySelectorAll('.tabs button').length);
    var bg=document.querySelector('[data-panel=bg]');
    o.push('bgSvg='+bg.querySelectorAll('svg').length);
    var fl=document.querySelector('[data-panel=flow]');
    o.push('steps='+fl.querySelectorAll('.pstep').length);
    o.push('stepFigs='+fl.querySelectorAll('.pstep .pfig svg').length);
    o.push('metricsSvg='+fl.querySelectorAll('.sec4-body svg').length);
    o.push('fails='+fl.querySelectorAll('.fail').length);
    o.push('err='+(window.__ERR__.length?window.__ERR__.join(';'):'none'));
    var d=document.createElement('div');d.id='__r__';d.textContent=o.join(' | ');document.body.appendChild(d);
  },1200);
},600);
</script></body></html>`;
  const tmp = path.join(__dirname, '_tmp', '_scene_' + dir + '.html');
  fs.writeFileSync(tmp, html);
  const out = execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
    '--virtual-time-budget=6000', '--dump-dom',
    'file:///' + tmp.replace(/\\/g, '/')
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const r = /<div id="__r__">([^<]*)<\/div>/.exec(out);
  console.log(dir.padEnd(20) + (r ? r[1] : '(missing)'));
  fs.unlinkSync(tmp);
}
