/* 控件“影响面”探针
   目的：确认每个控件到底能改动哪几段的图，而不只是它自己所在的那段。
   做法：把 demo 嵌进 iframe，逐个改控件值，比对「每一段」的图指纹（svg + 读数）。
   用法：node tools/ctlinfl.js <case-dir> [width]
*/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CASE_DIR = process.argv[2] || 'waterflood-case';
const W = Number(process.argv[3] || 1180);

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>ctlinfl</title>
<style>html,body{margin:0}iframe{width:${W}px;height:2400px;border:0}</style></head><body>
<iframe id="fr" src="${CASE_DIR}/demo/index.html"></iframe>
<script>
var fr=document.getElementById('fr'), pay=null;
window.addEventListener('message',function(e){ if(e.data&&e.data.__drawer==='init') pay=e.data; });

function hash(str){ var h=0; for(var i=0;i<str.length;i++) h=(h*31+str.charCodeAt(i))|0; return h; }
function secFp(sec){
  var svgs=sec.querySelectorAll('svg'), s='';
  for(var i=0;i<svgs.length;i++) s+=svgs[i].innerHTML;
  var ros=sec.querySelectorAll('.ro b, output, .tr b, .kpi b, .num');
  for(var j=0;j<ros.length;j++) s+='|'+ros[j].textContent;
  return s.length+'_'+hash(s);
}
function secTxt(sec){
  var ros=sec.querySelectorAll('.ro b, output, .tr b, .kpi b, .bstats .v');
  var s='';
  for(var j=0;j<ros.length;j++) s+='|'+ros[j].textContent;
  return s.length+'_'+hash(s);
}
function snap(){
  var doc=fr.contentDocument, o={};
  Array.prototype.forEach.call(doc.querySelectorAll('.sec'),function(sec){ o[sec.id]=secFp(sec); });
  return o;
}
function snapTxt(){
  var doc=fr.contentDocument, o={};
  Array.prototype.forEach.call(doc.querySelectorAll('.sec'),function(sec){ o[sec.id]=secTxt(sec); });
  return o;
}
function ctlEls(){
  var doc=fr.contentDocument, map={};
  Array.prototype.forEach.call(doc.querySelectorAll('[data-ctl-id]'),function(el){ map[el.getAttribute('data-ctl-id')]=el; });
  return map;
}
function setVal(id,val){
  fr.contentWindow.postMessage({__drawer:'control',id:id,value:val},'*');
}
var wait=function(ms){ return new Promise(function(r){setTimeout(r,ms)}); };

window.__run = async function(){
  if(!pay) return {err:'no payload'};
  var doc=fr.contentDocument;
  /* 抽屉里出现过的 id 顺序（按段） */
  var plan=[], seen={}, drawerIds={};
  pay.sections.forEach(function(s){
    var re=/data-ctl-id="([^"]*)"/g,m;
    drawerIds[s.id]=drawerIds[s.id]||[];
    while((m=re.exec(s.html))){ drawerIds[s.id].push(m[1]); if(!seen[m[1]]){ seen[m[1]]=1; plan.push({id:m[1],sec:s.id,title:s.title}); } }
  });
  var map=ctlEls(), out=[];
  /* 「算法解剖」是自动播放动画：先跳到最后一阶段（阈值 τ 只在这一步画出来），
     跑完再点掉播放键定住一帧。定住之后改控件，动画会调 refresh() 就地重绘，
     所以它也能被静态比出来；不先定帧则每帧都在变，比对全是假阳性。 */
  try {
    var nodes = doc.querySelectorAll('#flowMount .af-node');
    if (nodes.length) nodes[nodes.length - 1].click();
  } catch (e) { }
  await wait(2200);
  try {
    var pb = doc.querySelector('#flowMount [data-a="play"]');
    if (pb && pb.textContent.indexOf('\u275a') >= 0) pb.click();
  } catch (e) { }
  await wait(400);
  /* 静止基线：还在动的段本身每帧都在变，必须用文字指纹判定 */
  var b1=snap(), b1T=snapTxt(); await wait(450); var b2=snap(), b2T=snapTxt();
  var unstable={};
  Object.keys(b2).forEach(function(k){ if(b2[k]!==b1[k]) unstable[k]=(b2T[k]!==b1T[k])?'anim':'svg'; });
  for(var i=0;i<plan.length;i++){
    var id=plan[i].id, el=map[id];
    if(!el){ out.push({id:id, where:plan[i].sec, miss:true}); continue; }
    var before=snap(), beforeT=snapTxt(), val, orig;
    if(el.type==='range'){ orig=el.value; val=(Number(el.value)===Number(el.max))?Number(el.min):Number(el.max); }
    else if(el.type==='checkbox'){ orig=el.checked; val=!el.checked; }
    else { val='click'; orig=null; }
    setVal(id,val); await wait(340);
    var after=snap(), afterT=snapTxt();
    var changed=Object.keys(after).filter(function(k){
      if(unstable[k]==='svg') return afterT[k]!==beforeT[k];
      if(unstable[k]==='anim') return false; /* 动画文本一直在变，无法判定 */
      return after[k]!==before[k];
    });
    /* 还原 */
    if(orig!==null && orig!==undefined){
      if(el.type==='range'){ setVal(id,orig); }
      else { setVal(id,orig); }
      await wait(200);
    } else {
      /* 按钮：点回同组里原来高亮的那颗 */
      var grp=el.parentNode, on=grp?grp.querySelector('.on'):null;
      if(on && on!==el){ on.click(); await new Promise(function(r){setTimeout(r,260)}); }
    }
    out.push({id:id, where:plan[i].sec, label:(el.tagName==='BUTTON'?(el.textContent||'').trim().slice(0,12):(el.id||el.type)), changed:changed});
  }
  /* 完整性：能影响某段的控件，是否都出现在那一段的抽屉里 */
  var missing=[];
  pay.sections.forEach(function(s){
    var need={};
    out.forEach(function(r){ if(r.changed && r.changed.indexOf(s.id)>=0) need[r.id]=1; });
    Object.keys(need).forEach(function(id){ if((drawerIds[s.id]||[]).indexOf(id)<0) missing.push(s.id+' 缺 '+id); });
  });
  return {sections: pay.sections.map(function(s){return {id:s.id,title:s.title}}), unstable:Object.keys(unstable).map(function(k){return k+':'+unstable[k]}), rows:out, missing:missing};
};
</script></body></html>`;

const tmp = path.join(ROOT, '__ctlinfl.html');
fs.writeFileSync(tmp, html);
const port = 9800 + Math.floor(Math.random() * 90);
const ud = path.join(ROOT, 'tools', '_tmp', '_infl' + port);
const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  '--remote-debugging-port=' + port, '--user-data-dir=' + ud, '--window-size=' + W + ',1000', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await sleep(1100);
  const ts = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const t = ts.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const p = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result || m); p.delete(m.id); } });
  await new Promise(r => ws.onopen = r);
  const send = (method, params) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable', {}); await send('Page.enable', {});
  await send('Page.navigate', { url: 'file:///' + tmp.replace(/\\/g, '/') });
  await sleep(3200);
  const r = await send('Runtime.evaluate', { expression: 'window.__run()', returnByValue: true, awaitPromise: true });
  const v = r.result ? r.result.value : r.value;
  if (!v || v.err) { console.log('ERR', JSON.stringify(v)); }
  else {
    console.log('== ' + CASE_DIR + ' ==');
    console.log('动画段（用文字指纹判定）: '+(v.unstable.length?v.unstable.join(','):'无'));
    console.log('段: ' + v.sections.map(s => s.id + '(' + s.title + ')').join(' | '));
    console.log('');
    v.rows.forEach(function (row) {
      if (row.miss) { console.log(row.id + '  [NOT FOUND]'); return; }
      console.log((row.id + '                ').slice(0, 18) + ' @' + row.where +
        '  改→ ' + (row.changed && row.changed.length ? row.changed.join(',') : '无变化') +
        '  [' + row.label + ']');
    });
    /* 反查：每段应该出现哪些控件 */
    console.log('');
    v.sections.forEach(function (s) {
      var ids = v.rows.filter(function (r) { return r.changed && r.changed.indexOf(s.id) >= 0; }).map(function (r) { return r.id; });
      console.log('段 ' + s.id + ' 受这些控件影响: ' + (ids.length ? ids.join(', ') : '（无）'));
    });
    console.log('');
    console.log('缺控件: ' + (v.missing.length ? v.missing.join(' ; ') : '无（影响面全覆盖）'));
  }
  ws.close(); ch.kill();
  try { fs.unlinkSync(tmp); } catch (e) { }
})();
