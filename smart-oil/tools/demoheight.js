/* 示范 iframe 高度校验（真实时间，不用虚拟时间，虚拟时间会跳过 iframe 加载）
   逐个把案例包挂进 CaseDemoHost（与主站同一条通道），比对 iframe 高度与子页面文档高：
   iframeH 应比 childDocH 大 2 像素左右、clientHeight 不小于 childDocH，否则说明里面出现了内滚动条。
   运行：node tools/demoheight.js <viewportWidth>   （默认 1180，主站内容列宽）
*/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const ASSET = ('file:///' + path.join(ROOT, 'assets').replace(/\\/g, '/')).replace(/\\/g, '/');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const W = Number(process.argv[2] || 1180);
const CASES = ['pumping-diag-case', 'esp-fault-case', 'prod-forecast-case', 'waterflood-case', 'wax-scale-case', 'firstbreak-pick-case'];

function listDemoFiles(dir) {
  const base = path.join(ROOT, dir, 'demo');
  const out = [];
  (function walk(rel) {
    const abs = path.join(base, rel);
    const st = fs.statSync(abs);
    if (st.isDirectory()) { fs.readdirSync(abs).forEach(f => walk(rel ? rel + '/' + f : f)); return; }
    const ext = path.extname(abs).toLowerCase();
    const mime = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.js' ? 'text/javascript' : 'text/plain';
    out.push({ name: 'demo/' + rel, mime: mime, enc: 'utf8', data: fs.readFileSync(abs, 'utf8') });
  })('');
  return out;
}

const PACKS = CASES.map(function (c) {
  return {
    dir: c,
    height: JSON.parse(fs.readFileSync(path.join(ROOT, c, 'case.json'), 'utf8')).tabs.demo.height,
    files: listDemoFiles(c)
  };
});

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>host scroll check</title>
<link rel="stylesheet" href="${ASSET}/core/tokens.css">
<link rel="stylesheet" href="${ASSET}/core/layout.css">
<link rel="stylesheet" href="${ASSET}/core/ui.css">
</head><body><div id="host"></div>
<script src="${ASSET}/core/case-demo-host.js"></script>
<script>
var PACKS = ${JSON.stringify(PACKS).replace(/<\/script/gi, '<\\/script').replace(/<\/style/gi, '<\\/style')};
var results = [];
var idx = 0;
function run() {
  if (idx >= PACKS.length) { done(); return; }
  var pk = PACKS[idx];
  var host = document.getElementById('host');
  host.innerHTML = '';
  var lastH = 0;
  var onMsg = function (e) { if (e.data && e.data.__caseDemo) lastH = e.data.h; };
  window.addEventListener('message', onMsg);
  CaseDemoHost.create(host, { files: pk.files, demo: { mode: 'page', height: pk.height }, meta: { title: pk.dir } }, {});
  setTimeout(function () {
    window.removeEventListener('message', onMsg);
    var fr = host.querySelector('iframe');
    var h = Math.round(fr.getBoundingClientRect().height);
    results.push(pk.dir + '|iframeH=' + h + '|childDocH=' + lastH + '|innerViewportH=' + fr.clientHeight + '|scroll=' + (fr.clientHeight < lastH ? 'YES' : 'no'));
    idx++; run();
  }, 2200);
}
function done() {
  var d = document.createElement('div'); d.id = 'r0'; d.textContent = results.join(' ;; ');
  document.body.appendChild(d);
}
run();
</script></body></html>`;

const tmp = path.join(ROOT, '__hcheck.html');
fs.writeFileSync(tmp, html);

const port = 9411 + Math.floor(Math.random() * 30);
const userData = path.join(ROOT, 'tools', '_tmp', '_cdp' + port);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  '--remote-debugging-port=' + port, '--user-data-dir=' + userData,
  '--window-size=' + W + ',900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function () {
  await sleep(1200);
  const url = 'file:///' + tmp.replace(/\\/g, '/');
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  let target = targets.find(t => t.type === 'page');
  if (!target) { console.log('no page target'); chrome.kill(); return; }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let msgId = 0;
  const send = (method, params) => { ws.send(JSON.stringify({ id: ++msgId, method, params })); };
  await new Promise(res => { ws.onopen = res; });
  send('Page.enable', {});
  send('Runtime.enable', {});
  const ctxs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.executionContextCreated') {
      const c = m.params.context;
      ctxs.push({ id: c.id, name: c.name, origin: c.origin, aux: c.auxData && c.auxData.frameId });
    }
  });
  send('Page.navigate', { url: url });
  await sleep(300);
  await sleep(2200 * CASES.length + 3000);

  /* 在子 iframe 的上下文里直接量它的文档高，别信上报值 */
  const childCtx = ctxs.reverse().find(c => c.origin === 'null' || c.name === '');
  const ask = (expr, contextId) => new Promise(res => {
    const id = ++msgId;
    const onMsg = ev => {
      const m = JSON.parse(ev.data);
      if (m.id === id) { ws.removeEventListener('message', onMsg); res(m.result && m.result.result ? m.result.result.value : null); }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, contextId: contextId } }));
  });
  const hostOut = await ask('(document.getElementById("r0")||{}).textContent || "NO_RESULT"');
  console.log('width=' + W);
  console.log((hostOut || '').split(' ;; ').join('\n'));

  /* 截图留证 */
  const shot = await new Promise(res => {
    const id = ++msgId;
    const onMsg = ev => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', onMsg); res(m.result && m.result.data); } };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: id, method: 'Page.captureScreenshot', params: { format: 'png' } }));
  });
  if (shot) fs.writeFileSync(path.join(__dirname, '_tmp', 'hostcheck.png'), Buffer.from(shot, 'base64'));
  console.log('SHOT=' + (shot ? 'ok' : 'none'));

  /* 逐个 iframe：用 CDP 的 frame 树取每个子 frame 的上下文 */
  const tree = await new Promise(res => {
    const id = ++msgId;
    const onMsg = ev => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', onMsg); res(m.result); } };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: id, method: 'Page.getFrameTree' }));
  });
  function walkFrames(n, list) {
    list.push(n.frame);
    (n.childFrames || []).forEach(c => walkFrames(c, list));
  }
  const frames = [];
  walkFrames(tree.frameTree, frames);
  console.log('FRAMES=' + frames.length);
  console.log('CTXS=' + ctxs.map(c => c.aux + '|' + c.origin).join(','));
  ws.close();
  chrome.kill();
  /* 临时 profile 留在 tools/_tmp 下，沙箱里不允许批量删 */
  fs.unlinkSync(tmp);
})();
