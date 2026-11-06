/* 主站回归检查：首页 / 案例库 / 指南 / 场景页 / 流程页（含步骤图） */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const inject = `<script>
window.__ERR__=[];
window.addEventListener('error',function(e){window.__ERR__.push(e.message+' @'+(e.filename||'').split('/').pop()+':'+e.lineno);});
function probe(tag){
  var v=document.getElementById('view');
  var d=document.createElement('div');d.className='__probe';d.setAttribute('data-t',tag);
  d.textContent=tag+'|viewlen='+(v?v.innerHTML.length:-1)+'|title='+document.title;
  document.body.appendChild(d);
}
setTimeout(function(){
  probe('home');
  location.hash='#/cases';
  setTimeout(function(){ probe('cases');
    location.hash='#/guide';
    setTimeout(function(){ probe('guide');
      location.hash='#/scene/pr1';
      setTimeout(function(){ probe('scene');
        location.hash='#/scene/pr4?tab=flow';
        setTimeout(function(){
          probe('flow');
          var f=document.querySelectorAll('.pstep .pfig svg').length;
          var st=document.querySelectorAll('.pstep').length;
          var e=document.createElement('div');e.id='__r__';
          e.textContent='steps='+st+' stepfigs='+f+' errors='+(window.__ERR__.length?window.__ERR__.join(' ;; '):'none');
          document.body.appendChild(e);
        },900);
      },900);
    },900);
  },900);
},1200);
</script>`;

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace('<script src="assets/data.js', inject + '<script src="assets/data.js');
const tmp = path.join(ROOT, '__probe_site.html');
fs.writeFileSync(tmp, html);

const out = execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  '--virtual-time-budget=10000', '--dump-dom',
  'file:///' + tmp.replace(/\\/g, '/')
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const probes = (out.match(/class="__probe"[^>]*data-t="[^"]*"[^>]*>([^<]*)</g) || [])
  .map(s => s.replace(/<[^>]+>/g, ''));
probes.forEach(p => console.log('  ' + p));
const r = /<div id="__r__">([^<]*)<\/div>/.exec(out);
console.log('  ' + (r ? r[1] : '(result missing)'));
fs.unlinkSync(tmp);
