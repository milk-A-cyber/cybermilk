/* 控件—反馈距离探针（按文档顺序找最近的输出元素）
   ⚠ 已过时：示范页改成「右侧控件抽屉」后，控件被移出正文，本工具会全部报 NA。
      现在请用 tools/ctlcheck.js（通道级）与 tools/ctlhost.js（宿主级 + 截图）。
   运行：node tools/ctlspan.js <case-dir> [width]
   输出：每个控件到「最近的图」与「最近的读数块」的垂直距离，超过一屏（约 700px）即需滚动
*/
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CASE_DIR = process.argv[2] || 'pumping-diag-case';
const W = Number(process.argv[3] || 1180);

const demoDir = path.join(ROOT, CASE_DIR, 'demo');
const htmlSrc = fs.readFileSync(path.join(demoDir, 'index.html'), 'utf8');
const probe = `
<script>
(function () {
  setTimeout(function () {
    var out = [];
    var all = Array.prototype.slice.call(document.querySelectorAll('body *'));
    var figSel = 'svg, canvas';
    var readSel = '.rrow, .tip, .verdict, .cm-note, .fs-note, .tau-read, .bstats, .ro';
    var secs = document.querySelectorAll('.sec');
    out.push('VW=' + window.innerWidth + ' VH=' + window.innerHeight + ' docH=' + document.documentElement.scrollHeight);
    var ctls = Array.prototype.slice.call(document.querySelectorAll('input[type=range], .btns button, .presets .pbtn, .btn'));
    ctls.forEach(function (c) {
      var sec = c.closest('.sec');
      var secId = sec ? sec.id : '-';
      var r = c.getBoundingClientRect();
      var idx = all.indexOf(c);
      var fig = null, read = null;
      for (var i = idx + 1; i < all.length; i++) {
        var el = all[i];
        if (!fig && el.matches(figSel) && el.getBoundingClientRect().height > 20) fig = el;
        if (!read && el.matches(readSel)) read = el;
        if (fig && read) break;
      }
      var label = c.id || (c.dataset && (c.dataset.fault || c.dataset.kind)) || (c.textContent || '').trim().slice(0, 10) || c.type;
      out.push(secId + ' | ' + String(label).slice(0, 16).padEnd(16) +
        ' | 到图 ' + (fig ? Math.round(fig.getBoundingClientRect().top - r.top) : 'NA') +
        ' | 到读数 ' + (read ? Math.round(read.getBoundingClientRect().top - r.top) : 'NA'));
    });
    var d = document.createElement('div'); d.id = '__ctl__'; d.textContent = out.join(String.fromCharCode(10));
    document.body.appendChild(d);
  }, 2700);
})();
</script>
`;
const tmpPath = path.join(demoDir, '__ctl.html');
fs.writeFileSync(tmpPath, htmlSrc.replace('</body>', probe + '</body>'));
const url = 'file:///' + tmpPath.replace(/\\/g, '/');
let out = '';
for (let attempt = 0; attempt < 2 && !out; attempt++) {
  try {
    out = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
      '--window-size=' + W + ',900', '--virtual-time-budget=9000', '--dump-dom', url],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) { out = e.stdout || ''; }
}
const m = /<div id="__ctl__">([\s\S]*?)<\/div>/.exec(out);
console.log('=== ' + CASE_DIR + ' ===');
console.log(m ? m[1] : '(none, dom=' + out.length + ')');
fs.unlinkSync(tmpPath);
