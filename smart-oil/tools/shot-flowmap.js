/* 首页 13 环节全景图截图：node tools/shot-flowmap.js [out.png] */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = process.argv[2] || path.join(ROOT, 'tools', '_tmp', 'flowmap.png');

const inject = `<script>
window.addEventListener('load',function(){
  setTimeout(function(){
    var el=document.querySelector('.flowmap');
    if(!el){document.title='NO_FLOWMAP';return;}
    var hero=document.querySelector('.hero');
    if(hero) hero.style.display='none';
    document.documentElement.style.width='1280px';
    document.querySelectorAll('.wrap').forEach(function(w){w.style.width='1180px';});
    var sc=el.querySelector('.flowmap-scroll');
    if(sc) sc.style.overflow='visible';
    window.scrollTo(0,0);
    setTimeout(function(){
      var box=el.getBoundingClientRect();
      document.title='FM|'+Math.round(box.width)+'x'+Math.round(box.height)+'|iw='+window.innerWidth+'|nodes='+el.querySelectorAll('.fs-item').length;
    },300);
  },900);
});
</script>`;

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace('<script src="assets/data.js', inject + '<script src="assets/data.js');
const tmp = path.join(ROOT, '__shot_fm.html');
fs.writeFileSync(tmp, html);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  '--hide-scrollbars', '--window-size=1280,860',
  '--user-data-dir=' + path.join(ROOT, 'tools', '_tmp', 'chrome-fm'),
  '--virtual-time-budget=5000',
  '--screenshot=' + OUT,
  'file:///' + tmp.replace(/\\/g, '/')
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/* 同时 dump 一次标题，确认节点数 */
const dom = execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  '--virtual-time-budget=5000', '--dump-dom',
  'file:///' + tmp.replace(/\\/g, '/')
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const t = /<title>([^<]*)<\/title>/.exec(dom);
console.log('TITLE=' + (t ? t[1] : '?'));
console.log('SHOT=' + OUT + ' size=' + (fs.existsSync(OUT) ? fs.statSync(OUT).size : 0));
fs.unlinkSync(tmp);
