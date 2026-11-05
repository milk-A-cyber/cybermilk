/* =========================================================
   内置 41 案例验证（无头 Chrome，file:// 直开）
   -------------------------------------------------------------
   检查：注册数 / 注册问题 / 校验错误 / 案例库行数 /
         射孔转换案例 p1 三态页 / pumping-diag 三 tab 与示范 iframe
   运行：node tools/verify-cases.js
   ========================================================= */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const inject = `<script>
window.__ERR__=[];
window.addEventListener('error',function(e){window.__ERR__.push(e.message+' @'+(e.filename||'').split('/').pop()+':'+e.lineno);});
function probe(tag, extra){
  var d=document.createElement('div');d.className='__probe';d.setAttribute('data-t',tag);
  d.textContent=tag+'|'+(extra||'');document.body.appendChild(d);
}
setTimeout(function(){
  var L = window.Cases ? Cases.list().length : -1;
  var P = window.Cases ? Cases.problems().join(' ;; ') : '(no Cases)';
  var S = window.Cases ? JSON.stringify(Cases.stats()) : '';
  var V = window.Cases ? (function(){
    var m=Cases.validateAll(), e=0, w=0;
    for(var k in m){ m[k].forEach(function(x){ if(x.level==='error')e++; if(x.level==='warn')w++; }); }
    return 'err='+e+' warn='+w;
  })() : '';
  probe('boot','list='+L+' stats='+S+' valid='+V+' probs='+P+' errs='+window.__ERR__.length);
  location.hash='#/cases';
  setTimeout(function(){
    var rows=document.querySelectorAll('#view table tbody tr').length;
    var picks=document.querySelectorAll('#view .case-pick').length;
    probe('cases','rows='+rows+' picks='+picks+' errs='+window.__ERR__.length);
    location.hash='#/scene/p1';
    setTimeout(function(){
      var btns=document.querySelectorAll('.tabs button');
      var names=[];btns.forEach(function(b){names.push(b.textContent.replace(/\\s+/g,' ').trim());});
      probe('scene-p1','tabs='+names.join('|')+' errs='+window.__ERR__.length);
      var demoBtn=null;btns.forEach(function(b){if(/示范/.test(b.textContent))demoBtn=b;});
      window.__HMSG__=0;
      window.addEventListener('message',function(e){if(e.data&&e.data.__caseDemo)window.__HMSG__++;});
      if(!demoBtn){probe('demo-p1','NO_DEMO_TAB');}
      else{demoBtn.click();setTimeout(function(){
        var fr=document.querySelector('#case-demo-root iframe');
        probe('demo-p1','iframe='+(fr?'yes':'no')+' h='+(fr?Math.round(fr.getBoundingClientRect().height):'-')+
          ' hmsg='+window.__HMSG__+' sd='+(fr?((fr.getAttribute('srcdoc')||'').length):-1)+' errs='+window.__ERR__.length);
        location.hash='#/scene/pr1';
        setTimeout(function(){
          var bt2=document.querySelectorAll('.tabs button');
          var n2=[];bt2.forEach(function(b){n2.push(b.textContent.replace(/\\s+/g,' ').trim());});
          var st=document.querySelectorAll('.pstep').length;
          var figs=document.querySelectorAll('.pstep .pfig svg').length;
          probe('scene-pr1','tabs='+n2.join('|')+' steps='+st+' stepfigs='+figs+' errs='+window.__ERR__.length);
          var demo2=null;bt2.forEach(function(b){if(/示范/.test(b.textContent))demo2=b;});
          if(demo2){demo2.click();setTimeout(function(){
            var fr2=document.querySelector('#case-demo-root iframe');
            probe('demo-pr1','iframe='+(fr2?'yes':'no')+' hmsg='+window.__HMSG__+
              ' sd='+(fr2?(fr2.getAttribute('srcdoc')||'').length:-1)+' errs='+window.__ERR__.length);
            var done=document.createElement('div');done.id='__r__';
            done.textContent='FINAL_ERR='+(window.__ERR__.length?window.__ERR__.join(' ;; '):'none');
            document.body.appendChild(done);
          },6000);}
          else{probe('demo-pr1','NO_DEMO_TAB');}
        },2500);
      },5000);}
    },2000);
  },1500);
},2000);
</script>`;

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace('<script src="assets/data.js', inject + '<script src="assets/data.js');
const tmp = path.join(ROOT, '__probe_cases.html');
fs.writeFileSync(tmp, html);

const out = execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  '--virtual-time-budget=30000', '--dump-dom',
  'file:///' + tmp.replace(/\\/g, '/')
], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });

const probes = (out.match(/class="__probe"[^>]*data-t="[^"]*"[^>]*>([^<]*)</g) || [])
  .map(s => s.replace(/<[^>]+>/g, ''));
probes.forEach(p => console.log('  ' + p));
const r = /<div id="__r__">([^<]*)<\/div>/.exec(out);
console.log('  ' + (r ? r[1] : '(result missing)'));
fs.unlinkSync(tmp);
