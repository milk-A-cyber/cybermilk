/* 窄屏验证：node tools/shot-narrow.js [out.png] [width] [height] */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = process.argv[2] || path.join(ROOT, 'tools', '_tmp', 'narrow.png');
const VW = Number(process.argv[3] || 420);
const VH = Number(process.argv[4] || 700);

const inject = `<script>
window.addEventListener('load',function(){setTimeout(function(){
  var hero=document.querySelector('.hero'); if(hero) hero.style.display='none';
  var el=document.querySelector('.flowmap'); if(!el) return;
  window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 10);
  setTimeout(function(){
    var sv=el.querySelector('svg'), sc=el.querySelector('.flowmap-scroll');
    document.title='NARROW|vw='+window.innerWidth+'|svg='+Math.round(sv.getBoundingClientRect().width)+
      '|sc='+Math.round(sc.getBoundingClientRect().width)+'|sw='+sc.scrollWidth+
      '|docOverflow='+(document.documentElement.scrollWidth>window.innerWidth);
  },400);
},900)});
</script>`;

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace('<script src="assets/data.js', inject + '<script src="assets/data.js');
const tmp = path.join(ROOT, '__shot_narrow.html');
fs.writeFileSync(tmp, html);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  '--hide-scrollbars', '--window-size=' + VW + ',' + VH,
  '--virtual-time-budget=5000', '--screenshot=' + OUT,
  'file:///' + tmp.replace(/\\/g, '/')
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const dom = execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  '--window-size=' + VW + ',' + VH, '--virtual-time-budget=5000', '--dump-dom',
  'file:///' + tmp.replace(/\\/g, '/')
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const t = /<title>([^<]*)<\/title>/.exec(dom);
console.log(t ? t[1] : '?');
console.log('SHOT=' + OUT);
fs.unlinkSync(tmp);
