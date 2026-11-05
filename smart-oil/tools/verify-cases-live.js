/* =========================================================
   内置 41 案例 · 实时验证（CDP 真实时间，不用虚拟时钟）
   -------------------------------------------------------------
   针对验证：示范 iframe 是否真实运行（高度上报 / 宿主高度更新）
   运行：node tools/verify-cases-live.js
   依赖：Node 22（内置 fetch/WebSocket）+ 本机 Chrome
   ========================================================= */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const PORT = 9344;

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
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
    '--hide-scrollbars', '--window-size=1440,1000', `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + path.join(__dirname, '_tmp', 'cdp-live-profile'), 'about:blank'
  ], { stdio: 'ignore' });

  let api = null;
  for (let i = 0; i < 40; i++) {
    try { api = await cdp(PORT); break; } catch (e) { await sleep(300); }
  }
  if (!api) { console.log('无法连接 Chrome CDP'); chrome.kill(); return; }

  const { send, ws } = api;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(2000);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      return 'EXC:' + (r.result.exceptionDetails.text || '') + ' ' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || '');
    }
    return r.result && r.result.result ? r.result.result.value : null;
  };

  /* 基础注册检查 */
  console.log('boot:', await ev(
    'JSON.stringify({list: Cases.list().length, stats: Cases.stats(), probs: Cases.problems(), ' +
    'errs: window.__ERR__ ? window.__ERR__.length : 0})'
  ));

  /* 场景 pr1（模板案例三 tab） */
  await ev("location.hash='#/scene/pr1'"); await sleep(1500);
  console.log('pr1 tabs:', await ev(
    "Array.prototype.slice.call(document.querySelectorAll('.tabs button')).map(b=>b.textContent.trim()).join('|')"
  ));
  await ev("Array.prototype.slice.call(document.querySelectorAll('.tabs button')).filter(b=>/案例流程/.test(b.textContent))[0].click()");
  await sleep(800);
  console.log('pr1 flow:', await ev(
    "document.querySelectorAll('.pstep').length + ' steps / ' + document.querySelectorAll('.pstep .pfig svg').length + ' figs'"
  ));

  /* 示范 tab：真实时间等 iframe 运行 */
  await ev("window.__HMSG__=0; window.addEventListener('message',function(e){if(e.data&&e.data.__caseDemo)window.__HMSG__++;});" +
    "Array.prototype.slice.call(document.querySelectorAll('.tabs button')).filter(b=>/示范/.test(b.textContent))[0].click(); true");
  await sleep(10000);
  console.log('pr1 demo:', await ev(
    "var fr=document.querySelector('#case-demo-root iframe'); JSON.stringify({frame:!!fr, styleH:fr?fr.style.height:null, rectH:fr?Math.round(fr.getBoundingClientRect().height):null, hmsg:window.__HMSG__})"
  ));

  /* 场景 p1（射孔转换案例，两 tab） */
  await ev("location.hash='#/scene/p1'"); await sleep(1500);
  console.log('p1 tabs:', await ev(
    "Array.prototype.slice.call(document.querySelectorAll('.tabs button')).map(b=>b.textContent.trim()).join('|')"
  ));
  await ev("window.__HMSG__=0;" +
    "Array.prototype.slice.call(document.querySelectorAll('.tabs button')).filter(b=>/示范/.test(b.textContent))[0].click(); true");
  await sleep(8000);
  console.log('p1 demo:', await ev(
    "var fr=document.querySelector('#case-demo-root iframe'); JSON.stringify({frame:!!fr, styleH:fr?fr.style.height:null, rectH:fr?Math.round(fr.getBoundingClientRect().height):null, hmsg:window.__HMSG__})"
  ));

  ws.close();
  chrome.kill();
})().catch(e => { console.error(e); process.exit(1); });
