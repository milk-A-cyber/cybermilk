/* 主站真实 iframe 里的滚动行为探针
   —— 走 CaseDemoHost.create 的 page 模式（与主站完全一致），
      在 iframe 内部测量：文档高、iframe 视口高、控件与反馈图的相对位置。 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const ASSET = ('file:///' + path.join(ROOT, 'assets').replace(/\\/g, '/')).replace(/\\/g, '/');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const CASE_DIR = process.argv[2] || 'pumping-diag-case';

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>iframe scroll probe</title>
<link rel="stylesheet" href="${ASSET}/core/tokens.css">
<script>window.__ERR__=[];window.addEventListener('error',function(e){window.__ERR__.push(e.message);});<\/script>
</head><body>
<div id="host"></div>
<script src="${ASSET}/core/case-demo-host.js"></script>
<script>
setTimeout(function () {
  var out = { err: window.__ERR__, mode: null, h: null };
  var pkg = {
    files: [],
    demo: { mode: 'page', height: ${JSON.parse(fs.readFileSync(path.join(ROOT, CASE_DIR, 'case.json'), 'utf8')).tabs.demo.height} },
    meta: { title: 'probe' }
  };
  /* 读取案例包的 demo 文件，模拟上传后的产物 */
  var FS = ${JSON.stringify(listDemoFiles(CASE_DIR))};
  pkg.files = FS.map(function (f) { return { name: f.name, mime: f.mime, enc: 'utf8', data: f.data }; });

  window.__HMSG__ = 0;
  window.addEventListener('message', function (e) {
    if (e.data && e.data.__caseDemo) { window.__HMSG__++; window.__LASTH__ = e.data.h; }
  });
  var h = window.CaseDemoHost.create(document.getElementById('host'), pkg, {});
  out.mode = h.mode;
  setTimeout(function () {
    var fr = document.querySelector('iframe');
    out.iframeH = fr ? Math.round(fr.getBoundingClientRect().height) : null;
    out.iframeTop = fr ? Math.round(fr.getBoundingClientRect().top) : null;
    /* 主站视口只能看到 iframe 的一小部分 */
    out.hostPageScrollH = document.documentElement.scrollHeight;
    out.hostPageClientH = document.documentElement.clientHeight;
    /* iframe 内部文档高（通过 srcdoc 里的高度上报通道无法直读，改用 postMessage 计数） */
    out.heightMsgs = window.__HMSG__ || 0;
    out.lastReportedDocH = window.__LASTH__ || null;
    var d = document.createElement('div'); d.id = 'r0';
    d.textContent = JSON.stringify(out);
    document.body.appendChild(d);
  }, 5000);
}, 400);
</script>
</body></html>`;

/* 把案例 demo 目录读成 files 列表（base64 编码 data） */
function listDemoFiles(dir) {
  const base = path.join(ROOT, dir, 'demo');
  const out = [];
  (function walk(rel) {
    const abs = path.join(base, rel);
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      fs.readdirSync(abs).forEach(function (f) { walk(rel ? rel + '/' + f : f); });
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    const mime = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.js' ? 'text/javascript' : 'text/plain';
    out.push({ name: 'demo/' + rel, mime: mime, data: fs.readFileSync(abs).toString('base64') });
  })('');
  return out;
}

const tmp = path.join(ROOT, '__iprobe.html');
fs.writeFileSync(tmp, html);
const dom = execFileSync(CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
    '--window-size=1240,860', '--virtual-time-budget=9000', '--dump-dom',
    'file:///' + tmp.replace(/\\/g, '/')],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
fs.unlinkSync(tmp);
const m = /<div id="r0">([\s\S]*?)<\/div>/.exec(dom);
console.log(CASE_DIR + ': ' + (m ? m[1] : '(none)'));
