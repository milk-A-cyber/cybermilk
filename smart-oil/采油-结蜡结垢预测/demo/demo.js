/* 结蜡结垢预测 demo —— 纯前端，无后端 */
(function(){
'use strict';

var NS='http://www.w3.org/2000/svg';
function $(id){return document.getElementById(id);}
function draw(el,w,h,html){el.setAttribute('viewBox','0 0 '+w+' '+h);el.innerHTML=html;}
function fmt(x,d){return (isFinite(x)?x.toFixed(d==null?1:d):'—');}
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}

/* ---------- 固定种子随机数 ----------
   数据用确定性随机：同一个 (井型, 噪声) 永远得到同一条曲线。
   这样「算法解剖」动画逐帧重绘时数字不会跳，
   拖动拟合窗口这类操作也不会让底图忽然换一条线。 */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^(a>>>15),1|a);t=t+Math.imul(t^(t>>>7),61|t)^t;return ((t^(t>>>14))>>>0)/4294967296;};}
function seedOf(str){var h=2166136261;for(var i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function rndOf(seed){var r=mulberry32(seed);return function(){return r();};}

/* ---------- 线性回归 ---------- */
function linReg(ys){
  var n=ys.length; if(n<2) return {k:0,b:ys[0]||0};
  var sx=0,sy=0,sxx=0,sxy=0;
  for(var i=0;i<n;i++){var x=i,y=ys[i];sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}
  var den=n*sxx-sx*sx;
  var k=den!==0?(n*sxy-sx*sy)/den:0;
  var b=(sy-k*sx)/n;
  return {k:k,b:b};
}
function slopeWin(arr,W,end){
  var s=Math.max(0,end-W+1),n=end-s+1; if(n<2) return 0;
  var sub=arr.slice(s,end+1);
  return linReg(sub).k;
}

/* =========================================================
   屏 1 · 结蜡风险识别
========================================================= */
var L=120, WIN1=40, NOISE=0.8;
function genWell(kind,nz){
  var base=[],temp=[],press=[],state='';
  var rnd=rndOf(seedOf('waxwell|'+kind+'|'+nz));
  for(var i=0;i<L;i++){
    var v=100,t=52,p=1.8;
    if(kind==='wax-fast'){ if(i>45){var d=i-45;v=100-(0.14*d+0.0015*d*d);t=52-0.09*d;} }
    else if(kind==='wax-slow'){ v=100-0.10*i; if(i>30)t=52-0.02*(i-30); }
    else if(kind==='scale'){ v=100-0.09*i+Math.sin(i/8)*0.3; if(i>20)p=1.8+0.008*(i-20); t=51; }
    else { v=100+Math.sin(i/6)*0.2; p=1.8+Math.sin(i/9)*0.02; }
    base.push(v+(rnd()*2-1)*nz*1.1);
    temp.push(t+(rnd()*2-1)*0.3);
    press.push(p);
  }
  var names={normal:'平稳井',wax_fast:'快蜡井',wax_slow:'慢蜡井',scale:'垢堵井'};
  return {base:base,temp:temp,press:press,state:names[kind]||kind};
}

function buildSec1(){
  var kind=$('wellBtns').querySelector('.on').dataset.well;
  var W=parseInt($('inWin1').value,10), nz=parseFloat($('inNoise').value);
  var g=genWell(kind,nz), base=g.base;
  var absS=[],treS=[],riskSeg=[];
  for(var i=0;i<L;i++){
    absS.push(Math.abs(base[i]-100)/8);
    var s=slopeWin(base,W,i);
    treS.push(Math.max(0,-s)/0.09);
    riskSeg.push(base[i]<92);
  }
  // 命中 / 误报
  function rate(arr,seg){var c=0,t=0;for(var i=0;i<L;i++)if(seg[i]){t++;if(arr[i]>1)c++;}return t?c/t*100:null;}
  function fp(arr,seg){var c=0,t=0;for(var i=0;i<L;i++)if(!seg[i]){t++;if(arr[i]>1)c++;}return t?c/t*100:0;}
  var hitZ=rate(treS,riskSeg),hitA=rate(absS,riskSeg),fpZ=fp(treS,riskSeg),fpA=fp(absS,riskSeg);
  var tNow=g.temp[L-1];

  // 产液 + 温度图
  var pw=700,ph=190;
  var mx=function(i){return 42+i*(pw-84)/(L-1);}
  var my=function(v){return 172-(v-70)/(106-70)*140;}
  var ty=function(t){return 172-(t-40)/(60-40)*140;}
  var html='<rect x="34" y="22" width="'+(pw-70)+'" height="160" fill="#fff" stroke="#e9e4d8"/>';
  for(var gv=75;gv<=105;gv+=10){html+='<line x1="42" y1="'+my(gv)+'" x2="'+ (pw-26)+'" y2="'+my(gv)+'" stroke="#f4f1e8"/>';}
  for(var i=0;i<L;i++)if(riskSeg[i]){html+='<rect x="'+mx(i)+'" y="24" width="'+(mx(1)-mx(0)+0.5)+'" height="156" fill="#f9e4d9"/>';}
  var prod='',tempP='';
  for(var i=0;i<L;i++){
    prod+= (i?'L':'M')+' '+mx(i).toFixed(1)+' '+my(base[i]).toFixed(1);
    tempP+=(i?'L':'M')+' '+mx(i).toFixed(1)+' '+ty(g.temp[i]).toFixed(1);
  }
  html+='<path d="'+prod+'" fill="none" stroke="#41699b" stroke-width="2.2"/>';
  html+='<path d="'+tempP+'" fill="none" stroke="#b26a39" stroke-width="1.4" opacity="0.75"/>';
  html+='<line x1="42" y1="'+my(92)+'" x2="'+(pw-26)+'" y2="'+my(92)+'" stroke="#b26a39" stroke-dasharray="4 3"/>';
  html+='<text x="'+(pw-18)+'" y="'+(my(92)-4)+'" text-anchor="end" font-size="8.5" fill="#b26a39">风险线 92</text>';
  html+='<text x="40" y="'+(my(70)-6)+'" text-anchor="end" font-size="8.5" fill="#79828a">产液(t/d)</text>';
  html+='<text x="'+(pw-18)+'" y="20" text-anchor="end" font-size="8.5" fill="#b26a39">温度(℃)</text>';
  html+='<text x="30" y="188" font-size="8.5" fill="#9ba3a9">0 天</text><text x="'+(pw-30)+'" y="188" text-anchor="end" font-size="8.5" fill="#9ba3a9">'+L+' 天</text>';
  draw($('prodChart'),pw,ph,html);

  // 两种检测器分数
  html='<rect x="34" y="16" width="'+(pw-70)+'" height="120" fill="#fff" stroke="#e9e4d8"/>';
  html+='<line x1="42" y1="'+yline(1)+'" x2="'+(pw-26)+'" y2="'+yline(1)+'" stroke="#b26a39" stroke-dasharray="4 3"/>';
  html+='<text x="'+(pw-18)+'" y="'+(yline(1)-4)+'" text-anchor="end" font-size="8.5" fill="#b26a39">报警 1.0</text>';
  function yline(v){return 128-(v/1.6)*104;}
  var pa='',pt='';
  for(var i=0;i<L;i++){
    pa+=(i?'L':'M')+' '+mx(i).toFixed(1)+' '+yline(absS[i]).toFixed(1);
    pt+=(i?'L':'M')+' '+mx(i).toFixed(1)+' '+yline(treS[i]).toFixed(1);
  }
  html+='<path d="'+pa+'" fill="none" stroke="#2f7d6b" stroke-width="1.8"/>';
  html+='<path d="'+pt+'" fill="none" stroke="#41699b" stroke-width="2"/>';
  html+='<rect x="34" y="8" width="12" height="12" rx="2" fill="#2f7d6b"/><text x="50" y="18" font-size="8.5" fill="#4d565b">只看绝对值</text>';
  html+='<rect x="150" y="8" width="12" height="12" rx="2" fill="#41699b"/><text x="166" y="18" font-size="8.5" fill="#4d565b">滑窗趋势检测</text>';
  draw($('zChart'),pw,150,html);

  // 滑窗特征
  var slArr=[],prArr=[],tpArr=[];
  for(var i=0;i<L;i++){
    slArr.push(clamp(-slopeWin(base,W,i)/0.3,0,1));
    prArr.push(clamp((g.press[i]-1.8)/0.8,0,1));
    tpArr.push(clamp((52-g.temp[i])/6,0,1));
  }
  function fy(v){return 110-v*88;}
  html='<rect x="34" y="8" width="'+(pw-70)+'" height="104" fill="#fff" stroke="#e9e4d8"/>';
  var psl='',ppr='',ptp='';
  for(var i=0;i<L;i++){
    psl+=(i?'L':'M')+' '+mx(i).toFixed(1)+' '+fy(slArr[i]).toFixed(1);
    ppr+=(i?'L':'M')+' '+mx(i).toFixed(1)+' '+fy(prArr[i]).toFixed(1);
    ptp+=(i?'L':'M')+' '+mx(i).toFixed(1)+' '+fy(tpArr[i]).toFixed(1);
  }
  html+='<path d="'+psl+'" fill="none" stroke="#41699b" stroke-width="1.8"/>';
  html+='<path d="'+ppr+'" fill="none" stroke="#2f7d6b" stroke-width="1.4" opacity="0.8"/>';
  html+='<path d="'+ptp+'" fill="none" stroke="#b26a39" stroke-width="1.4" opacity="0.8"/>';
  html+='<text x="34" y="14" font-size="8.5" fill="#41699b">递减斜率</text>';
  html+='<text x="120" y="14" font-size="8.5" fill="#2f7d6b">压力爬升</text>';
  html+='<text x="206" y="14" font-size="8.5" fill="#b26a39">温度偏离</text>';
  draw($('featChart'),pw,120,html);

  // 读数
  $('roState').textContent=g.state;
  $('roHitZ').textContent=hitZ==null?'—':fmt(hitZ,0)+'%';
  $('roHitA').textContent=hitA==null?'—':fmt(hitA,0)+'%';
  $('roFpZ').textContent=fmt(fpZ,0)+'%';
  $('roTemp').textContent=(tNow<52?'−':'+')+fmt(Math.abs(tNow-52),1)+'℃';

  var tip;
  if(kind==='normal') tip='平稳井：产液不降、温度稳定，两种检测器都安静（误报率低）。这口井可以延长清蜡周期，别按固定 30 天白白清。';
  else if(kind==='wax-fast') tip='快蜡井：递减陡、温度明显走低。两种检测器都报警——但趋势检测在更早的风险段就命中，提前量更大，应尽快排热洗。';
  else if(kind==='wax-slow') tip='慢蜡井：递减缓慢仍落在正常区间（风险线上方）。看绝对值的检测器命中率低、会漏掉前半段；滑窗趋势检测因为“正在偏离自身基线”能更早抓住——这就是只看趋势的价值。';
  else tip='垢堵井：产液递减较轻，但井口压力明显爬升。趋势检测看产液递减 + 压力爬升两个信号才能抓住结垢；只看产液会把它和结蜡混淆。';
  $('anTip').textContent=tip;
}

/* =========================================================
   屏 2 · 清防时机预测
========================================================= */
var DLEN=90, THRESH=75;
function genDecay(kind){
  var rate={mild:0.30,moderate:0.45,severe:0.70}[kind];
  var breakAt=(100-THRESH)/rate; // 真实跌破阈值天数
  var base=[],data=[];
  var rnd=rndOf(seedOf('waxdecay|'+kind));
  for(var i=0;i<DLEN;i++){var v=100-rate*i;base.push(v);data.push(v+(rnd()*2-1)*1.6);}
  return {rate:rate,breakAt:breakAt,base:base,data:data};
}
function buildSec2(){
  var kind=$('kindBtns').querySelector('.on').dataset.kind;
  var T=parseInt($('inDay').value,10),W=parseInt($('inWin2').value,10);
  var g=genDecay(kind),data=g.data;
  var realWin=g.breakAt-T;
  // 用 [T-W,T] 拟合
  var sub=data.slice(Math.max(0,T-W),T+1);
  var lr=linReg(sub), cur=data[T];
  var estWin=lr.k<0?Math.max(0,(cur-THRESH)/-lr.k):null;
  var err=estWin!=null?Math.abs(estWin-realWin):null;

  var pw=700,ph=260;
  var mx=function(i){return 48+i*(pw-100)/(DLEN-1);}
  var my=function(v){return 235-(v-70)/(106-70)*196;}
  var maxX=Math.max(DLEN-1,T+(estWin!=null?estWin:0)+10);
  var html='<rect x="40" y="18" width="'+(pw-70)+'" height="208" fill="#fff" stroke="#e9e4d8"/>';
  for(var gv=75;gv<=105;gv+=5){html+='<line x1="48" y1="'+my(gv)+'" x2="'+(pw-30)+'" y2="'+my(gv)+'" stroke="#f4f1e8"/>';}
  html+='<line x1="48" y1="'+my(THRESH)+'" x2="'+(pw-30)+'" y2="'+my(THRESH)+'" stroke="#b26a39" stroke-dasharray="5 3" stroke-width="1.4"/>';
  html+='<text x="'+(pw-30)+'" y="'+(my(THRESH)-4)+'" text-anchor="end" font-size="8.5" fill="#b26a39" font-weight="600">需清蜡阈值 75</text>';
  // 数据曲线（到 T）
  var p='';
  for(var i=0;i<=T;i++){p+=(i?'L':'M')+' '+mx(i).toFixed(1)+' '+my(data[i]).toFixed(1);}
  html+='<path d="'+p+'" fill="none" stroke="#41699b" stroke-width="2"/>';
  // 拟合窗口高亮
  var ws=Math.max(0,T-W);
  html+='<rect x="'+mx(ws)+'" y="20" width="'+(mx(T)-mx(ws)+3)+'" height="204" fill="#e7eef9" opacity="0.55"/>';
  // 拟合线（拟合窗口内）
  if(lr.k<0){
    html+='<line x1="'+mx(ws)+'" y1="'+my(lr.k*0+lr.b)+'" x2="'+mx(T)+'" y2="'+my(lr.k*T+lr.b)+'" stroke="#2f7d6b" stroke-width="2"/>';
    // 外推虚线到阈值
    var xT=(THRESH-lr.b)/lr.k;
    var x2=clamp(xT, T, (pw-30));
    html+='<line x1="'+mx(T)+'" y1="'+my(cur)+'" x2="'+mx(x2)+'" y2="'+my(THRESH)+'" stroke="#2f7d6b" stroke-dasharray="6 4" stroke-width="1.8"/>';
    // 标记跌破点
    html+='<circle cx="'+mx(x2)+'" cy="'+my(THRESH)+'" r="5" fill="#b26a39" stroke="#fff" stroke-width="1.5"/>';
  }
  // 当前点
  html+='<circle cx="'+mx(T)+'" cy="'+my(cur)+'" r="5" fill="#41699b" stroke="#fff" stroke-width="1.5"/>';
  // 真实跌破标记
  var rbx=Math.min(g.breakAt,DLEN-1);
  html+='<line x1="'+mx(rbx)+'" y1="18" x2="'+mx(rbx)+'" y2="226" stroke="#b26a39" stroke-dasharray="3 3" opacity="0.6"/>';
  html+='<text x="'+(mx(rbx)+4)+'" y="16" font-size="8.5" fill="#b26a39">真实跌破</text>';
  html+='<text x="48" y="12" font-size="9.5" fill="#4d565b" font-weight="600">产液递减 · 外推到阈值线</text>';
  html+='<text x="30" y="244" text-anchor="end" font-size="8.5" fill="#9ba3a9">0</text><text x="'+(pw-30)+'" y="244" text-anchor="end" font-size="8.5" fill="#9ba3a9">90 天</text>';
  draw($('decayChart'),pw,ph,html);

  $('roTrue').textContent=fmt(realWin,1)+' 天';
  $('roEst').textContent=estWin!=null?fmt(estWin,1)+' 天':'—';
  $('roErr').textContent=err!=null?fmt(err,1)+' 天':'—';
  $('roCur').textContent=fmt(cur,1)+' t/d';

  var tip;
  if(kind==='mild') tip='轻度结蜡：递减缓、剩余窗口长。窗口太长会把早期平台期算进去、低估斜率；建议用较短窗口，别因“还有很久”就推迟到临期再安排。';
  else if(kind==='moderate') tip='中度结蜡：递减斜率居中。拟合窗口 20 天左右估计与真实最接近；窗口过短噪声大、过长被早期平台拖慢——现场通常取折中并定期重估。';
  else tip='重度结蜡：递减陡、窗口很短。尽早排热洗；拟合窗口稍长时可能把“已经跌破阈值后的数据”算进来，导致估计失真，要注意剔除阈值以下的点。';
  $('degTip').textContent=tip;
}

/* =========================================================
   屏 3 · 分级调度
========================================================= */
var THR=0.5, WELLS=30;
var fleet=[];
function genFleet(){
  fleet=[];
  var rnd=rndOf(seedOf('waxfleet'));
  for(var i=0;i<WELLS;i++){
    // x=蜡风险, y=垢风险，多数健康
    var x,y;
    if(rnd()<0.6){x=rnd()*0.2;y=rnd()*0.2;}
    else if(rnd()<0.7){x=0.25+rnd()*0.75;y=rnd()*0.5;}
    else {y=0.25+rnd()*0.75;x=rnd()*0.5;}
    fleet.push({id:'W'+(i+1),x:x,y:y});
  }
}
function fleetRisk(w){return w.x+w.y;}
function buildSec3(){
  var thr=parseFloat($('inThr').value);
  var highThr=0.78-0.55*thr, midThr=0.50-0.40*thr;
  var classified=fleet.map(function(w){
    var r=fleetRisk(w);
    var lv=r>highThr?'高':(r>midThr?'中':'低');
    var realRisk=clamp(w.x*0.9+w.y*0.9+0.05,0,1);
    return {w:w,r:r,lv:lv,real:realRisk};
  });
  var high=classified.filter(function(c){return c.lv==='高';});
  var mid=classified.filter(function(c){return c.lv==='中';});
  var need=high.concat(mid);
  var hit=need.length?need.filter(function(c){return c.real>0.35;}).length/need.length*100:100;
  var ops=high.length+0.6*mid.length;
  var save=(WELLS-ops)/WELLS*100;

  // fleetChart 散点 + 边界
  var pw=340,ph=290;
  var px=function(x){return 46+x*(pw-78)/(1);}
  var py=function(y){return ph-34-y*(ph-70)/(1);}
  var html='<rect x="34" y="18" width="'+(pw-70)+'" height="'+(ph-72)+'" fill="#fff" stroke="#e9e4d8"/>';
  for(var g=0;g<=1;g+=0.25){
    html+='<line x1="'+px(g)+'" y1="20" x2="'+px(g)+'" y2="'+(ph-52)+'" stroke="#f4f1e8"/>';
    html+='<line x1="44" y1="'+py(g)+'" x2="'+(pw-34)+'" y2="'+py(g)+'" stroke="#f4f1e8"/>';
  }
  // 分级边界线 y = thr - x
  function bx(t,axis){
    if(axis==='x')return t; return t; // 边界线 x+y=t → y=t-x
  }
  [['#e8b16a',highThr,'高'],['#f0d19a',midThr,'中']].forEach(function(b){
    var t=b[1];
    var x1=Math.max(0,t-1),x2=Math.min(1,t);
    if(x2>x1) html+='<line x1="'+px(x1)+'" y1="'+py(t-x1)+'" x2="'+px(x2)+'" y2="'+py(t-x2)+'" stroke="'+b[0]+'" stroke-dasharray="5 3" stroke-width="1.5"/>';
  });
  classified.forEach(function(c){
    var col=c.lv==='高'?'#c96f4a':(c.lv==='中'?'#d9a24c':'#9fb8d4');
    html+='<circle cx="'+px(c.w.x)+'" cy="'+py(c.w.y)+'" r="4.5" fill="'+col+'" opacity="0.9"><title>'+c.w.id+' 蜡'+fmt(c.w.x,2)+' 垢'+fmt(c.w.y,2)+' 风险'+fmt(c.r,2)+'</title></circle>';
  });
  html+='<text x="44" y="14" font-size="8.5" fill="#4d565b">蜡风险 → (产液递减)</text>';
  html+='<text x="'+(pw-10)+'" y="14" text-anchor="end" font-size="8.5" fill="#4d565b">← 垢风险(压力爬升)</text>';
  html+='<text x="46" y="'+(ph-20)+'" font-size="8.5" fill="#c96f4a" font-weight="600">高</text>';
  html+='<text x="86" y="'+(ph-20)+'" font-size="8.5" fill="#d9a24c">中</text>';
  html+='<text x="126" y="'+(ph-20)+'" font-size="8.5" fill="#9fb8d4">低</text>';
  draw($('fleetChart'),pw,ph,html);

  // orderChart 作业排序（前8高）
  var sorted=classified.slice().sort(function(a,b){return b.r-a.r;});
  var top=sorted.slice(0,8);
  var maxR=Math.max(0.1,sorted[0].r);
  var ow=340,oh=290;
  html='<text x="20" y="22" font-size="10" fill="#1f2a30" font-weight="600">清防作业排序（风险从高到低）</text>';
  top.forEach(function(c,idx){
    var y=34+idx*28;
    var col=c.lv==='高'?'#c96f4a':(c.lv==='中'?'#d9a24c':'#9fb8d4');
    var bw=(c.r/maxR)*(ow-120);
    html+='<text x="22" y="'+(y+12)+'" font-size="8.5" fill="#4d565b">'+c.w.id+'</text>';
    html+='<rect x="54" y="'+y+'" width="'+bw+'" height="16" rx="3" fill="'+col+'" opacity="0.9"/>';
    var act=c.w.x>c.w.y?'热洗 / 加药清蜡':'除垢 / 防垢';
    if(c.w.x>0.4&&c.w.y>0.4) act='先除垢后热洗';
    html+='<text x="'+(ow-26)+'" y="'+(y+12)+'" text-anchor="end" font-size="8.5" fill="#79828a">'+act+'</text>';
  });
  html+='<text x="20" y="'+(oh-8)+'" font-size="8.5" fill="#9ba3a9">仅前 8 口展示 · 高风险优先安排</text>';
  draw($('orderChart'),ow,oh,html);

  // coastChart 固定周期 vs 按风险
  var cw=700,ch=150;
  function by(v){return ch-36-(v/30)*(ch-70);}
  html='<rect x="40" y="14" width="'+(cw-70)+'" height="'+(ch-52)+'" fill="#fff" stroke="#e9e4d8"/>';
  for(var gv=0;gv<=30;gv+=10){html+='<line x1="60" y1="'+by(gv)+'" x2="'+(cw-30)+'" y2="'+by(gv)+'" stroke="#f4f1e8"/><text x="54" y="'+(by(gv)+3)+'" text-anchor="end" font-size="8.5" fill="#9ba3a9">'+gv+'</text>';}
  html+='<rect x="120" y="'+by(30)+'" width="52" height="'+(ch-36-by(30))+'" fill="#d9b78e"/>';
  html+='<text x="146" y="'+(by(30)-4)+'" text-anchor="middle" font-size="9.5" fill="#4d565b" font-weight="700" font-family="monospace">30</text>';
  html+='<text x="146" y="'+(ch-30)+'" text-anchor="middle" font-size="9.5" fill="#4d565b">固定周期(次/月)</text>';
  html+='<rect x="300" y="'+by(ops)+'" width="52" height="'+(ch-36-by(ops))+'" fill="#2f7d6b"/>';
  html+='<text x="326" y="'+(by(ops)-4)+'" text-anchor="middle" font-size="9.5" fill="#2f7d6b" font-weight="700" font-family="monospace">'+fmt(ops,1)+'</text>';
  html+='<text x="326" y="'+(ch-30)+'" text-anchor="middle" font-size="9.5" fill="#4d565b">按风险(次/月)</text>';
  html+='<text x="146" y="'+(by(30)-26)+'" text-anchor="middle" font-size="8.5" fill="#2f7d6b" font-weight="600">每口每月全清</text>';
  html+='<text x="326" y="'+(by(ops)-26)+'" text-anchor="middle" font-size="8.5" fill="#2f7d6b" font-weight="600">高风险提前·低风险延后</text>';
  html+='<text x="'+(cw/2)+'" y="'+(ch-8)+'" text-anchor="middle" font-size="8.5" fill="#9ba3a9">风险命中率 '+fmt(hit,0)+'% · 作业次数较固定周期下降 '+fmt(save,0)+'%</text>';
  draw($('coastChart'),cw,ch,html);

  $('roHigh').textContent=high.length+' 口';
  $('roMid').textContent=mid.length+' 口';
  $('roHit').textContent=fmt(hit,0)+'%';
  $('roOps').textContent=fmt(ops,1)+' 次/月';
  $('roSave').textContent='−'+fmt(save,0)+'%';

  $('clsTip').textContent='灵敏度 '+thr.toFixed(2)+'：高风险 '+high.length+' 口、中风险 '+mid.length+' 口。向右更保守——作业更少但可能漏掉慢蜡井；向左更激进——命中更高但白清增多。现场可按成本与减产损失取平衡。';
}

/* =========================================================
   浏览器端桥接：把模型层与实时状态暴露给「算法解剖」动画模块，
   让动画演示的每一步都跑的是同一份真代码。
========================================================= */
window.WaxBridge = {
  L: L, WIN1: WIN1, DLEN: DLEN, THRESH: THRESH, WELLS: WELLS,
  linReg: linReg, slopeWin: slopeWin, genWell: genWell, genDecay: genDecay,
  mulberry32: mulberry32, seedOf: seedOf,
  fleet: function () { return fleet; },
  live: function () {
    var kind = $('wellBtns').querySelector('.on').dataset.well;
    var decKind = $('kindBtns').querySelector('.on').dataset.kind;
    return {
      kind: kind, decKind: decKind,
      noise: parseFloat($('inNoise').value),
      win1: parseInt($('inWin1').value, 10),
      day: parseInt($('inDay').value, 10),
      win2: parseInt($('inWin2').value, 10),
      thr: parseFloat($('inThr').value)
    };
  }
};

/* =========================================================
   初始化
========================================================= */
function bind(){
  $('wellBtns').addEventListener('click',function(e){
    var b=e.target.closest('button'); if(!b)return;
    this.querySelectorAll('button').forEach(function(x){x.classList.remove('on');});
    b.classList.add('on'); buildSec1();
  });
  $('inNoise').addEventListener('input',function(){$('outNoise').textContent=parseFloat(this.value).toFixed(2);buildSec1();});
  $('inWin1').addEventListener('input',function(){$('outWin1').textContent=this.value;buildSec1();});

  $('kindBtns').addEventListener('click',function(e){
    var b=e.target.closest('button'); if(!b)return;
    this.querySelectorAll('button').forEach(function(x){x.classList.remove('on');});
    b.classList.add('on'); buildSec2();
  });
  $('inDay').addEventListener('input',function(){$('outDay').textContent=this.value;buildSec2();});
  $('inWin2').addEventListener('input',function(){$('outWin2').textContent=this.value;buildSec2();});

  $('inThr').addEventListener('input',function(){$('outThr').textContent=parseFloat(this.value).toFixed(2);buildSec3();});
}
if (typeof window !== 'undefined' && window.addEventListener && typeof document !== 'undefined') {
  window.addEventListener('error',function(e){var b=document.createElement('div');b.id='errbox';b.textContent='ONERROR: '+e.message+' @ '+(e.filename||'')+':'+(e.lineno||'')+':'+(e.colno||'');b.style.cssText='background:#fde;color:#a33;padding:8px;font-family:monospace;white-space:pre;';document.body.appendChild(b);});
  try{
    genFleet();
    bind();
    buildSec1();buildSec2();buildSec3();
    var okb=document.createElement('div');okb.id='initok';okb.textContent='INIT OK';okb.style.display='none';document.body.appendChild(okb);
  }catch(err){
    var b=document.createElement('div');b.id='errbox';b.textContent='ERR: '+err.message+' || '+err.stack;b.style.cssText='background:#fde;color:#a33;padding:8px;font-family:monospace;white-space:pre;';document.body.appendChild(b);
  }
}

/* Node 测试入口：require('./demo.js') 拿到模型层（不跑 DOM 部分） */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' && window.WaxBridge) ? window.WaxBridge : null;
}
})();
