/* 端到端：真实上传 → 场景页 demo tab → 量 iframe 高度 / 内部滚动 / 交互后可见性
   这是「用户实际看到的样子」。 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const ASSET = ('file:///' + path.join(ROOT, 'assets').replace(/\\/g, '/')).replace(/\\/g, '/');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const CASE_DIR = process.argv[2] || 'pumping-diag-case';
const SCENE = process.argv[3] || 'pr1';
const OUT = process.argv[4] || path.join(__dirname, '_tmp', 'out', 'e2e.png');

/* 收集案例包文件 */
function packFiles() {
  const base = path.join(ROOT, CASE_DIR);
  const out = [];
  (function walk(rel) {
    const abs = path.join(base, rel);
    if (fs.statSync(abs).isDirectory()) {
      fs.readdirSync(abs).forEach(function (f) { walk(rel ? rel + '/' + f : f); });
      return;
    }
    if (path.basename(rel).startsWith('.')) return;
    out.push({ name: rel, data: fs.readFileSync(abs, 'utf8'), mime: /\.css$/.test(rel) ? 'text/css' : (/\.js$/.test(rel) ? 'text/javascript' : (/\.html$/.test(rel) ? 'text/html' : 'text/plain')), enc: 'text' });
  })('');
  return out;
}

const files = packFiles();
const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="${ASSET}/core/tokens.css">
<link rel="stylesheet" href="${ASSET}/core/layout.css">
<link rel="stylesheet" href="${ASSET}/core/ui.css">
<script>window.__ERR__=[];window.addEventListener('error',function(e){window.__ERR__.push(e.message+' @'+(e.filename||'').split('/').pop()+':'+e.lineno);});<\/script>
</head><body><div id="view"></div>
<script src="${ASSET}/data.js"></script>
<script src="${ASSET}/core/registry.js"></script>
<script src="${ASSET}/core/kit.js"></script>
<script src="${ASSET}/core/case-demo-host.js"></script>
<script src="${ASSET}/core/case-upload.js"></script>
<script src="${ASSET}/core/admin.js"></script>
<script src="${ASSET}/core/shell.js"></script>
<script>
var FILES = ${JSON.stringify(files)};
(async function () {
  function say(s) { (window.__LOG__ = window.__LOG__ || []).push(s); }
  /* 高度上报监听 */
  window.__HMSGS__ = 0; window.__LASTH__ = 0;
  window.addEventListener('message', function (e) {
    if (e.data && e.data.__caseDemo) { window.__HMSGS__++; window.__LASTH__ = e.data.h; }
  });
  var dt = new DataTransfer();
  FILES.forEach(function (f) {
    dt.items.add(new File([f.data], f.name.split('/').pop()));
  });
  var openBtn = document.querySelector('[data-import]');
  openBtn.click();
  await new Promise(function (r) { setTimeout(r, 300); });
  var input = document.getElementById('imp-file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
  await new Promise(function (r) { setTimeout(r, 1200); });
  document.getElementById('imp-ok').click();
  await new Promise(function (r) { setTimeout(r, 1500); });

  /* 进 demo tab */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs button'));
  var dt2 = tabs.filter(function (b) { return /示范/.test(b.textContent); })[0];
  if (dt2) dt2.click();
  await new Promise(function (r) { setTimeout(r, 3000); });

  var fr = document.querySelector('#case-demo-root iframe');
  say('FRAME=' + (fr ? 'yes' : 'no'));
  if (fr) {
    var r = fr.getBoundingClientRect();
    say('IFRAME=' + Math.round(r.width) + 'x' + Math.round(r.height) + ' styleH=' + fr.style.height);
    say('IFRAME_TOP_IN_PAGE=' + Math.round(r.top + window.scrollY));
  }
  say('HEIGHT_MSGS=' + window.__HMSGS__ + ' LAST_H=' + window.__LASTH__);
  /* 检查 iframe 的 srcdoc 是否含高度上报脚本 */
  if (fr) {
    var sd = fr.getAttribute('srcdoc') || '';
    say('SRCDOC_LEN=' + sd.length);
    say('SRCDOC_HAS_H=' + (sd.indexOf('__caseDemo') >= 0 ? 'yes' : 'no'));
    say('SRCDOC_HAS_HEAD=' + (sd.indexOf('<head') >= 0 ? 'yes' : 'no'));
    say('SRCDOC_SCRIPT_COUNT=' + (sd.match(/<script/g) || []).length);
    /* dump srcdoc 头部 1200 字符，看内联是否正确 */
    say('SD_HEAD=' + sd.slice(0, 500).replace(/\s+/g, ' '));
    /* 找出 srcdoc 里 demo.js 的内联脚本片段，看是否被破坏 */
    var di = sd.indexOf('cardPoints');
    say('SD_DEMOJS=' + (di >= 0 ? 'present@' + di : 'MISSING'));
    var hi = sd.indexOf('__ASSETS__');
    say('SD_ASSETS=' + (hi >= 0 ? sd.slice(hi, hi + 160).replace(/\s+/g, ' ') : 'MISSING'));
  }
  say('PAGE_SCROLL_H=' + document.documentElement.scrollHeight);
  say('ERRORS=' + (window.__ERR__.length ? window.__ERR__.join(' ;; ') : 'none'));

  /* 截一张 demo tab 的图 */
  if (fr) {
    fr.scrollIntoView({ block: 'start' });
    await new Promise(function (r2) { setTimeout(r2, 600); });
  }
  var d = document.createElement('div'); d.id = 'r0';
  d.textContent = (window.__LOG__ || []).join(' | ');
  document.body.appendChild(d);
})();
</script></body></html>`;

const tmp = path.join(ROOT, '__e2e.html');
fs.writeFileSync(tmp, html);
execFileSync(CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
    '--hide-scrollbars', '--window-size=1240,900', '--virtual-time-budget=12000',
    '--screenshot=' + OUT, 'file:///' + tmp.replace(/\\/g, '/')],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const dom = execFileSync(CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
    '--window-size=1240,900', '--virtual-time-budget=12000', '--dump-dom',
    'file:///' + tmp.replace(/\\/g, '/')],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
fs.unlinkSync(tmp);
const m = /<div id="r0">([\s\S]*?)<\/div>/.exec(dom);
console.log(CASE_DIR + ' → ' + (m ? m[1] : '(none)'));
