/* 首屏控件验证：不滚动，直接看案例页一打开时右侧抽屉有没有出现、里面是哪一段的控件。
   用来挡「控件出现太晚」这类问题——案例顶部是算法解剖/说明时，若那一段没登记控件，
   抽屉要等滚到下面第一个实验才弹出来。
   运行：node tools/ctltop.js <case-dir> [out.png]
*/
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const ROOT=path.resolve(__dirname,'..');
const ASSET=('file:///'+path.join(ROOT,'assets').replace(/\\/g,'/'));
const CHROME='C://Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CASE=process.argv[2]||'pumping-diag-case';
const OUT=process.argv[3]||path.join(ROOT,'tools','_tmp','top-'+CASE+'.png');
function files(dir){const base=path.join(ROOT,dir,'demo');const out=[];(function walk(rel){const abs=path.join(base,rel);const st=fs.statSync(abs);if(st.isDirectory()){fs.readdirSync(abs).forEach(f=>walk(rel?rel+'/'+f:f));return;}const ext=path.extname(abs).toLowerCase();out.push({name:'demo/'+(rel?rel+'/':'')+path.basename(abs),mime:ext==='.html'?'text/html':ext==='.css'?'text/css':ext==='.js'?'text/javascript':'text/plain',enc:'utf8',data:fs.readFileSync(abs,'utf8')});})('');return out;}
const height=JSON.parse(fs.readFileSync(path.join(ROOT,CASE,'case.json'),'utf8')).tabs.demo.height;
const PACK={dir:CASE,height:height,files:files(CASE)};
const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${ASSET}/core/tokens.css"><link rel="stylesheet" href="${ASSET}/core/layout.css"><link rel="stylesheet" href="${ASSET}/core/ui.css"><style>body{margin:0;background:#fff}.wrap{width:940px;margin:0 auto}</style></head><body><div class="wrap"><div id="host"></div></div>
<script src="${ASSET}/core/case-demo-host.js"></script>
<script>var PK=${JSON.stringify(PACK).replace(/<\/script/gi,'<\\/script')};CaseDemoHost.create(document.getElementById('host'),{files:PK.files,demo:{mode:'page',height:PK.height},meta:{title:PK.dir}},{});
window.__top=function(){var gd=document.getElementById('cd-gd');return {scrollY:window.scrollY,open:!!(gd&&gd.classList.contains('open')),title:gd?gd.querySelector('.cd-gd-title').textContent:'',btns:gd?Array.prototype.map.call(gd.querySelectorAll('button'),function(b){return b.textContent.trim().slice(0,6)}).join('/'):'',ranges:gd?gd.querySelectorAll('input[type=range]').length:0};};</script></body></html>`;
const tmp=path.join(ROOT,'__top.html');fs.writeFileSync(tmp,html);
const port=9920+Math.floor(Math.random()*30),ud=path.join(ROOT,'tools','_tmp','_tp'+port);
const ch=spawn(CHROME,['--headless=new','--disable-gpu','--no-sandbox','--allow-file-access-from-files','--remote-debugging-port='+port,'--user-data-dir='+ud,'--window-size=1240,1000','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{await sleep(1100);const ts=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();const t=ts.find(x=>x.type==='page');const ws=new WebSocket(t.webSocketDebuggerUrl);let id=0;const p=new Map();ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&p.has(m.id)){p.get(m.id)(m.result||m);p.delete(m.id);}});await new Promise(r=>ws.onopen=r);const send=(me,pa)=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method:me,params:pa}));});await send('Runtime.enable',{});await send('Page.enable',{});await send('Page.navigate',{url:'file:///'+tmp.replace(/\\/g,'/')});await sleep(4200);const r=await send('Runtime.evaluate',{expression:'window.__top()',returnByValue:true});console.log(JSON.stringify(r.result.value,null,1));const shot=await send('Page.captureScreenshot',{format:'png'});if(shot&&shot.data)fs.writeFileSync(OUT,Buffer.from(shot.data,'base64'));console.log('SHOT='+OUT);ws.close();ch.kill();try{fs.unlinkSync(tmp);}catch(e){}})();
