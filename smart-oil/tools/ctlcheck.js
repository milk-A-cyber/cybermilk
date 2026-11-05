/* 控件抽屉体检（走主站真实通道）
   把 demo 页嵌进 iframe（同一个 demo 页，只是有 parent），
   收集它 postMessage 出来的 sections，然后：
   1) 检查每个抽屉控件的 data-ctl-id 能否唯一解析到子页面的元素（重复 = 点到别人身上）；
   2) 用父页面同款 postMessage 模拟拖动/点击，比对子页面指纹，验证有没有反馈；
   3) 找出子页面里「在抽屉里但没挂 id」的控件（抽屉里能点，实际是死的）。
   运行：node tools/ctlcheck.js <case-dir> [width]
*/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CASE_DIR = process.argv[2] || 'pumping-diag-case';
const W = Number(process.argv[3] || 1180);
const demoRel = CASE_DIR + '/demo/index.html';

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>ctlcheck</title>
<style>html,body{margin:0}iframe{width:${W}px;height:2000px;border:0}</style>
</head><body>
<iframe id="fr" src="${demoRel}"></iframe>
<script>
var fr = document.getElementById('fr');
var payloads = [];
window.addEventListener('message', function(e){
  var d = e.data;
  if (d && d.__drawer === 'init') payloads.push(d);
});
function fp(){
  var doc = fr.contentDocument; if (!doc) return 'NODOC';
  var t = doc.body.innerText || '';
  var h = 0; for (var i=0;i<t.length;i++){ h = (h*31 + t.charCodeAt(i))|0; }
  var svgs = doc.querySelectorAll('svg'); var sl = 0, hs = 0;
  for (var j=0;j<svgs.length;j++) {
    var html = svgs[j].innerHTML; sl += html.length;
    for (var q=0;q<html.length;q+=3) hs = (hs*31 + html.charCodeAt(q))|0;
  }
  sl += '_' + hs;
  var cv = 0, cs = doc.querySelectorAll('canvas');
  for (var k=0;k<cs.length;k++) cv += cs[k].width * cs[k].height;
  return t.length+'_'+h+'_'+sl+'_'+cv;
}
function secOf(el){ var s = el.closest('.sec'); return s ? s.id : '-'; }
function label(el){ return (el.tagName==='BUTTON') ? (el.textContent||'').trim().slice(0,10) : (el.type||''); }

window.__run = async function(){
  var doc = fr.contentDocument;
  if (!doc) return {err:'no contentDocument'};
  if (!payloads.length) return {err:'no drawer payload'};
  var pay = payloads[payloads.length-1];
  var R = {sections:[], dupIds:[], deadIds:[], noId:[], results:[], childCtl:{}};

  /* 子页面里所有交互元素 */
  var ctlEls = [];
  Array.prototype.forEach.call(doc.querySelectorAll('input, button, select'), function(el){
    if (el.closest('#flowMount')) return;
    var id = el.getAttribute('data-ctl-id') || '';
    if (id) (R.childCtl[id] = R.childCtl[id] || []).push(secOf(el) + '/' + label(el));
    else R.noId.push(secOf(el) + '/' + (el.id||'-') + '/' + label(el) + '/inDrawer?');
    ctlEls.push({el: el, id: id});
  });
  Object.keys(R.childCtl).forEach(function(k){
    if (R.childCtl[k].length > 1) R.dupIds.push(k + ' → ' + R.childCtl[k].join(' , '));
  });

  /* 抽屉 html 里的 id 列表 */
  pay.sections.forEach(function(s){
    var ids = [];
    var re = /data-ctl-id="([^"]*)"/g, m;
    while ((m = re.exec(s.html))) ids.push(m[1]);
    R.sections.push({id:s.id, title:s.title, top:Math.round(s.top), h:Math.round(s.height),
      ids:ids, ctl:(s.html.match(/<(input|button|select)\\b/g)||[]).length});
  });

  /* 真实通道：逐 id 发消息，看子页面有没有反应 */
  var seen = {}, jobs = [];
  pay.sections.forEach(function(s){
    var ids = [];
    var re = /data-ctl-id="([^"]*)"/g, m;
    while ((m = re.exec(s.html))) ids.push(m[1]);
    ids.forEach(function(id){
      if (seen[id + '@' + s.id]) return; seen[id + '@' + s.id] = 1;
      jobs.push({sec: s.id, id: id});
    });
  });
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  for (var ji = 0; ji < jobs.length; ji++) {
    var job = jobs[ji], id = job.id;
    var el = doc.querySelector('[data-ctl-id="' + CSS.escape(id) + '"]');
    var dup = el ? doc.querySelectorAll('[data-ctl-id="' + CSS.escape(id) + '"]').length : 0;
    var before = fp();
    var val;
    if (!el) val = 'click';
    else if (el.type === 'range') val = (+el.value === +el.max) ? +el.min : +el.max;
    else if (el.type === 'checkbox') val = !el.checked;
    else val = 'click';
    try { fr.contentWindow.postMessage({__drawer:'control', id:id, value:val}, '*'); } catch(e){}
    await wait(340);
    var after = fp();
    var tag = el ? (secOf(el) + '/' + label(el)) : 'NOTFOUND';
    R.results.push(job.sec + ' | ' + id + ' | ' + tag + ' | 命中=' + dup +
      ' | ' + (before !== after ? 'OK' : 'NOCHANGE'));
    try {
      if (el && el.type === 'range') { fr.contentWindow.postMessage({__drawer:'control', id:id, value:val === +el.max ? +el.min : +el.max}, '*'); }
      else if (el && el.type === 'checkbox') { fr.contentWindow.postMessage({__drawer:'control', id:id, value:!val}, '*'); }
    } catch(e){}
    await wait(80);
  }
  return R;
};
</script></body></html>`;

const tmp = path.join(ROOT, '__ctlcheck.html');
fs.writeFileSync(tmp, html);
const port = 9500 + Math.floor(Math.random() * 60);
const userData = path.join(ROOT, 'tools', '_tmp', '_cdp' + port);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  '--remote-debugging-port=' + port, '--user-data-dir=' + userData,
  '--window-size=' + W + ',900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function () {
  await sleep(1000);
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const target = targets.find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  await new Promise(res => { ws.onopen = res; });
  const send = (method, params) => new Promise(res => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  await send('Page.enable', {});
  await send('Runtime.enable', {});
  await send('Page.navigate', { url: 'file:///' + tmp.replace(/\\/g, '/') });
  await sleep(4500);
  const r = await send('Runtime.evaluate', { expression: 'window.__run().then(function(v){return JSON.stringify(v)})', returnByValue: true, awaitPromise: true });
  let out;
  try { out = JSON.parse(r.result.value); } catch (e) { out = { err: 'eval fail' }; }
  console.log('=== ' + CASE_DIR + ' ===');
  if (out.err) console.log('ERR ' + out.err);
  else {
    out.sections.forEach(s => console.log('SEC ' + s.id + ' [' + s.title + '] ctl=' + s.ctl));
    console.log('--- 通道测试 ---');
    out.results.forEach(t => console.log(t));
    if (out.dupIds.length) { console.log('--- id 冲突 ---'); out.dupIds.forEach(t => console.log(t)); }
    if (out.noId.length) { console.log('--- 未挂 id ---'); out.noId.forEach(t => console.log(t)); }
  }
  ws.close(); chrome.kill();
  try { fs.unlinkSync(tmp); } catch (e) { }
})();
