/* 宿主级控件验证：按主站真实方式挂 CaseDemoHost，点右侧抽屉里的预设按钮，
   检查 (1) 抽屉重绘后滑杆值是否跟上；(2) 高亮态是否正确；(3) 截图留证。
   运行：node tools/ctlhost.js <case-dir> [out.png]
*/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const ASSET = ('file:///' + path.join(ROOT, 'assets').replace(/\\/g, '/')).replace(/\\/g, '/');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CASE_DIR = process.argv[2] || 'esp-fault-case';
const OUT = process.argv[3] || path.join(__dirname, '_tmp', 'ctl-' + CASE_DIR + '.png');
const SEC_ID = process.argv[4] || '';
const W = 1240, H = 1000;

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
const height = JSON.parse(fs.readFileSync(path.join(ROOT, CASE_DIR, 'case.json'), 'utf8')).tabs.demo.height;
const PACK = { dir: CASE_DIR, height: height, files: listDemoFiles(CASE_DIR) };

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>host ctl</title>
<link rel="stylesheet" href="${ASSET}/core/tokens.css">
<link rel="stylesheet" href="${ASSET}/core/layout.css">
<link rel="stylesheet" href="${ASSET}/core/ui.css">
<style>body{margin:0;background:#fff}.wrap{width:${W - 300}px;margin:0 auto}</style>
</head><body><div class="wrap"><div id="host"></div></div>
<script src="${ASSET}/core/case-demo-host.js"></script>
<script>
var PK = ${JSON.stringify(PACK).replace(/<\/script/gi, '<\\/script').replace(/<\/style/gi, '<\\/style')};
CaseDemoHost.create(document.getElementById('host'), { files: PK.files, demo: { mode: 'page', height: PK.height }, meta: { title: PK.dir } }, {});

window.__step = async function () {
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  await sleep(2600);
  var entry = CaseDemoHost._gdEntries[0];
  var fr = entry.frame;
  var secId = ${JSON.stringify(SEC_ID)};
  var sec = secId ? (entry.sections.filter(function (s) { return s.id === secId; })[0] || entry.sections[0]) : (entry.sections[0]);
  var top = fr.getBoundingClientRect().top + window.scrollY + sec.top + 60;
  window.scrollTo(0, Math.max(0, top));
  await sleep(900);
  var gd = document.getElementById('cd-gd');
  var out = { sec: sec.title, open: gd && gd.classList.contains('open'), before: [], after: [], active: '' };

  function snap() {
    return Array.prototype.map.call(gd.querySelectorAll('input[type=range]'), function (r) {
      return (r.id || r.getAttribute('data-ctl-id')) + '=' + r.value;
    }).join(', ');
  }
  out.before.push(snap());
  var btns = gd.querySelectorAll('button');
  out.btnLabels = Array.prototype.map.call(btns, function (b) { return b.textContent.trim().slice(0, 8); }).join('/');
  if (btns.length > 1) { btns[1].click(); await sleep(900); }
  out.after.push(snap());
  out.active = Array.prototype.map.call(gd.querySelectorAll('button.on, button.active'), function (b) { return b.textContent.trim().slice(0, 8); }).join('/');
  out.title = gd.querySelector('.cd-gd-title').textContent;
  return out;
};
</script></body></html>`;

const tmp = path.join(ROOT, '__ctlhost.html');
fs.writeFileSync(tmp, html);
const port = 9800 + Math.floor(Math.random() * 50);
const ud = path.join(ROOT, 'tools', '_tmp', '_h' + port);
const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  '--remote-debugging-port=' + port, '--user-data-dir=' + ud, '--window-size=' + W + ',' + H, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await sleep(1000);
  const ts = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const t = ts.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const p = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); } });
  await new Promise(r => ws.onopen = r);
  const send = (m, q) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: q })); });
  await send('Runtime.enable', {}); await send('Page.enable', {});
  await send('Page.navigate', { url: 'file:///' + tmp.replace(/\\/g, '/') });
  await sleep(4000);
  const r = await send('Runtime.evaluate', { expression: 'window.__step()', returnByValue: true, awaitPromise: true });
  console.log('=== ' + CASE_DIR + ' ===');
  console.log(JSON.stringify(r.result.value, null, 1));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  if (shot && shot.data) fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('SHOT=' + OUT);
  ws.close(); ch.kill();
  try { fs.unlinkSync(tmp); } catch (e) { }
})();
