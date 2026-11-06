/* =========================================================
   案例页截图（真实导入 → 三个 tab → 多处滚动截屏）
   运行：node tools/shot-case.js <case-dir> <sceneId> <out-dir>
   依赖：本机 Chrome + Node 22（内置 WebSocket，直接走 CDP）
   ========================================================= */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CASE_DIR = process.argv[2] || 'pumping-diag-case';
const SCENE = process.argv[3] || 'pr1';
const OUT_DIR = process.argv[4] || path.join(__dirname, '_tmp', 'out', CASE_DIR);
const ASSET = ('file:///' + path.join(ROOT, 'assets').replace(/\\/g, '/')).replace(/\\/g, '/');
const CASE_NAME = JSON.parse(fs.readFileSync(path.join(ROOT, CASE_DIR, 'case.json'), 'utf8')).id;

fs.mkdirSync(OUT_DIR, { recursive: true });

function packFiles() {
  const base = path.join(ROOT, CASE_DIR);
  const out = [];
  (function walk(rel) {
    const abs = path.join(base, rel);
    if (fs.statSync(abs).isDirectory()) {
      fs.readdirSync(abs).forEach(function (f) { if (!f.startsWith('.')) walk(rel ? rel + '/' + f : f); });
      return;
    }
    if (path.basename(rel).startsWith('.')) return;
    const ext = path.extname(rel).slice(1).toLowerCase();
    const mime = ext === 'html' ? 'text/html' : ext === 'js' ? 'text/javascript'
      : ext === 'css' ? 'text/css' : ext === 'json' ? 'application/json' : 'text/plain';
    out.push({ name: CASE_DIR + '/' + rel, mime, data: fs.readFileSync(abs, 'utf8') });
  })('');
  return out;
}

const files = packFiles();

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>case shot</title>
<link rel="stylesheet" href="${ASSET}/core/tokens.css">
<link rel="stylesheet" href="${ASSET}/core/layout.css">
<link rel="stylesheet" href="${ASSET}/core/ui.css">
</head><body>
<div id="view"></div>
<script>window.__FILES__ = ${JSON.stringify(files).replace(/<\//g, '<\\/')};
window.__CASE__ = ${JSON.stringify(CASE_NAME)};</script>
<script src="${ASSET}/data.js"></script>
<script src="${ASSET}/core/registry.js"></script>
<script src="${ASSET}/core/kit.js"></script>
<script src="${ASSET}/core/case-demo-host.js"></script>
<script src="${ASSET}/core/case-upload.js"></script>
<script src="${ASSET}/core/admin.js"></script>
<script src="${ASSET}/core/shell.js"></script>
<script>
window.__ERR__ = [];
window.addEventListener('error', function (e) { window.__ERR__.push(e.message + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno); });
window.__HEIGHT__ = 0;
window.addEventListener('message', function (e) { if (e.data && e.data.__caseDemo) window.__HEIGHT__ = e.data.h; });

window.__import = async function () {
  var dt = new DataTransfer();
  window.__FILES__.forEach(function (f) { dt.items.add(new File([f.data], f.name, { type: f.mime })); });
  window.CaseImport.open({ sceneId: '' });
  await new Promise(function (r) { setTimeout(r, 400); });
  var input = document.getElementById('imp-file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
  await new Promise(function (r) { setTimeout(r, 1500); });
  document.getElementById('imp-ok').click();
  await new Promise(function (r) { setTimeout(r, 1600); });
  return !!window.Cases.get(window.__CASE__);
};

window.__tab = async function (kw) {
  var b = Array.prototype.slice.call(document.querySelectorAll('.tabs button')).filter(function (x) { return x.textContent.indexOf(kw) >= 0; })[0];
  if (!b) return 'no tab ' + kw;
  b.click();
  await new Promise(function (r) { setTimeout(r, 900); });
  return 'ok';
};

/* 滚动到某个选择器的元素，offset 为额外偏移 */
window.__to = function (sel, off) {
  var el = document.querySelector(sel);
  if (!el) return 'no el ' + sel;
  var y = el.getBoundingClientRect().top + window.scrollY + (off || 0);
  window.scrollTo(0, y);
  return 'y=' + Math.round(y);
};

/* 点宿主抽屉里的工况预设（示范页在沙箱里，只能从父页面点） */
window.__preset = function (name) {
  var b = Array.prototype.slice.call(document.querySelectorAll('#cd-gd .pbtn, #cd-gd button'))
    .filter(function (x) { return x.textContent.trim() === name; })[0];
  if (!b) return 'no preset ' + name;
  b.click();
  return 'clicked ' + name;
};

/* 在示范 iframe 上滚动主页面，让 iframe 内某段出现在视口 */
window.__frameScroll = function (fraction) {
  var fr = document.querySelector('#case-demo-root iframe');
  if (!fr) return 'no frame';
  var r = fr.getBoundingClientRect();
  var h = r.height;
  window.scrollTo(0, r.top + window.scrollY + fraction * (h - window.innerHeight * 0.75));
  return 'fh=' + Math.round(h) + ' vh=' + window.innerHeight;
};

window.__info = function () {
  var fr = document.querySelector('#case-demo-root iframe');
  return JSON.stringify({
    h: document.title,
    frame: fr ? Math.round(fr.getBoundingClientRect().width) + 'x' + Math.round(fr.getBoundingClientRect().height) : 'none',
    styleH: fr ? fr.style.height : '',
    reportedH: window.__HEIGHT__,
    docH: document.documentElement.scrollHeight,
    err: window.__ERR__
  });
};
</script>
</body></html>`;

const tmp = path.join(__dirname, '_tmp', 'shot.html');
fs.writeFileSync(tmp, html);
const url = 'file:///' + tmp.replace(/\\/g, '/');

/* ---------------- CDP ---------------- */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function cdp(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = list.find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiting = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  };
  const send = (method, params) => new Promise(res => {
    const i = ++id; waiting.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  return { send, ws };
}

(async function main() {
  const port = 9333;
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
    '--hide-scrollbars', '--window-size=1440,1000', `--remote-debugging-port=${port}`,
    '--user-data-dir=' + path.join(__dirname, '_tmp', 'cdp-profile'), 'about:blank'
  ], { stdio: 'ignore' });

  let api = null;
  for (let i = 0; i < 40; i++) {
    try { api = await cdp(port); break; } catch (e) { await sleep(300); }
  }
  if (!api) { console.log('无法连接 Chrome CDP'); chrome.kill(); return; }

  const { send } = api;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  await sleep(1600);

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT_DIR, name + '.png');
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    console.log('shot →', file);
  };
  const info = async (tag) => console.log(tag, await evalJs('__info()'));

  console.log('import:', await evalJs('__import()'));
  await sleep(800);
  console.log('hash:', await evalJs('location.hash'));

  /* 专业背景 */
  await evalJs("__tab('专业背景')");
  await sleep(600);
  await evalJs("window.scrollTo(0,0)"); await sleep(300);
  const bgTop = await evalJs("document.querySelector('.tabs').getBoundingClientRect().top + window.scrollY");
  await evalJs(`window.scrollTo(0, ${bgTop} - 70)`);
  await sleep(300); await shot('01-background-top');
  await evalJs("window.scrollBy(0, 900)"); await sleep(250); await shot('02-background-2');
  await evalJs("window.scrollBy(0, 900)"); await sleep(250); await shot('03-background-3');
  console.log('fig4:', await evalJs("__to('svg[aria-label=\"六种工况的示功图图库\"]', -60)"));
  await sleep(300); await shot('04-background-fig4');
  await evalJs("window.scrollBy(0, 760)"); await sleep(250); await shot('05-background-5');

  /* 案例流程 */
  await evalJs("window.scrollTo(0,0)"); await sleep(200);
  await evalJs("__tab('案例流程')"); await sleep(700);
  await evalJs("window.scrollTo(0,0)"); await sleep(300);
  const wfTop = await evalJs("document.querySelector('.tabs').getBoundingClientRect().top + window.scrollY");
  await evalJs(`window.scrollTo(0, ${wfTop} - 70)`); await sleep(300); await shot('06-flow-top');
  console.log('y1', await evalJs("Math.round(scrollY)"));
  await evalJs("window.scrollBy(0, 900)"); await sleep(250); await shot('07-flow-2');
  console.log('y2', await evalJs("Math.round(scrollY)"));
  await evalJs("window.scrollBy(0, 900)"); await sleep(250); await shot('08-flow-3');
  await evalJs("window.scrollBy(0, 900)"); await sleep(250); await shot('09-flow-4');

  /* 示范 */
  await evalJs("window.scrollTo(0,0)"); await sleep(200);
  await evalJs("__tab('示范')");
  await sleep(6000);
  await info('after demo tab');
  await evalJs("__to('#case-demo-root', -70)"); await sleep(700); await shot('10-demo-top');
  await evalJs("__frameScroll(0.12)"); await sleep(600); await shot('11-demo-a');
  await evalJs("__frameScroll(0.30)"); await sleep(600); await shot('12-demo-b');
  console.log('preset:', await evalJs("__preset('复合疑难')"));
  await sleep(1200);
  await evalJs("__frameScroll(0.30)"); await sleep(600); await shot('13-demo-composite');
  await evalJs("__frameScroll(0.72)"); await sleep(600); await shot('14-demo-batch');
  await info('end');

  api.ws.close();
  chrome.kill();
})();
