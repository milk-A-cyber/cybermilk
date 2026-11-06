/* 「算法解剖」动画逐阶段体检
   动画每一阶段都调 demo.js 暴露的桥接函数（window.XxxBridge.*）。
   少挂一个函数，某一段就会渲染成「绘制失败」，但整页不报错、很难发现。
   这里逐节点点过去，收集每段的报错文本。
   运行：node tools/flowcheck.js <case-dir> [mountId]
*/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CASE_DIR = process.argv[2] || 'pumping-diag-case';
const MOUNT = process.argv[3] || 'flowMount';
const url = 'file:///' + path.join(ROOT, CASE_DIR, 'demo', 'index.html').replace(/\\/g, '/');

const port = 9950 + Math.floor(Math.random() * 40);
const ud = path.join(ROOT, 'tools', '_tmp', '_flow' + port);
const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  '--remote-debugging-port=' + port, '--user-data-dir=' + ud, '--window-size=1240,1000', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await sleep(1000);
  const ts = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const t = ts.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const p = new Map(), errs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && p.has(m.id)) { p.get(m.id)(m.result || m); p.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errs.push((d.exception && d.exception.description ? d.exception.description : d.text).split('\n')[0]);
    }
  });
  await new Promise(r => ws.onopen = r);
  const send = (method, params) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable', {}); await send('Page.enable', {});
  await send('Page.navigate', { url });
  await sleep(3600);

  const expr = `(async function(){
    var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
    var m=document.getElementById(${JSON.stringify(MOUNT)});
    if(!m) return {err:'no mount'};
    var nodes=m.querySelectorAll('.af-node');
    var out={count:nodes.length, stages:[]};
    for(var i=0;i<nodes.length;i++){
      nodes[i].click();
      await sleep(1000);
      var txt=m.innerText||'';
      var bad=/绘制失败|不是函数|is not a function|Cannot read|undefined is not/.test(txt);
      out.stages.push({i:i, name:(nodes[i].textContent||'').replace(/\\s+/g,' ').trim().slice(0,24),
        svg:m.querySelector('svg')?m.querySelector('svg').innerHTML.length:0, bad:bad,
        hit:(txt.match(/绘制失败[^\\n]*|B\\.[A-Za-z]+ is not a function[^\\n]*/)||[''])[0].slice(0,90)});
    }
    return out;
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  const v = r.result ? r.result.value : r.value;
  console.log('== ' + CASE_DIR + ' ==');
  if (!v || v.err) console.log('ERR ' + JSON.stringify(v));
  else {
    console.log('阶段数: ' + v.count);
    v.stages.forEach(s => console.log('  [' + s.i + '] ' + (s.bad ? 'FAIL ' : 'ok   ') + s.name +
      '  svg=' + s.svg + (s.hit ? '  ← ' + s.hit : '')));
    const bad = v.stages.filter(s => s.bad);
    console.log('结论: ' + (bad.length ? bad.length + ' 段失败' : '全部阶段正常'));
  }
  if (errs.length) console.log('页面异常: ' + errs.slice(0, 5).join(' | '));
  ws.close(); ch.kill();
})();
