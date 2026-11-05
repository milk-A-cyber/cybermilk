/* 交互可视性探针 v2
   自动枚举页面上所有可交互控件（滑杆 / 按钮），
   对每个控件，找出它所在 section 内的所有图表元素，
   测量「变化区域」相对视口的位置，判断用户是否需要滚动才能看到反馈。 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CASE = process.argv[2] || 'pumping-diag-case';
const demoDir = path.join(ROOT, CASE, 'demo');
const html = fs.readFileSync(path.join(demoDir, 'index.html'), 'utf8');

const probe = `
<script>
window.__ERR__ = [];
window.addEventListener('error', function (e) { window.__ERR__.push(e.message + ' @' + (e.filename||'').split('/').pop() + ':' + e.lineno); });
setTimeout(function () {
  var out = { vh: window.innerHeight, docH: document.documentElement.scrollHeight, items: [], err: window.__ERR__ };

  out.init = {
    errbox: (document.getElementById('errbox') || {}).textContent || null,
    initok: !!document.getElementById('initok'),
    ranges: document.querySelectorAll('input[type=range]').length,
    btns: document.querySelectorAll('.pbtn, .btns button, .presets button').length,
    svgs: document.querySelectorAll('svg').length,
    canvases: document.querySelectorAll('canvas').length
  };

  var secs = document.querySelectorAll('section.sec');
  secs.forEach(function (sec, si) {
    var sid = sec.id || ('sec' + si);
    var charts = sec.querySelectorAll('svg, canvas');
    var ctls = sec.querySelectorAll('input[type=range], .pbtn, .btns button, .presets button');
    if (!ctls.length) return;
    ctls.forEach(function (ctl) {
      ctl.scrollIntoView({ block: 'center' });
      var vh = window.innerHeight;
      var cr = ctl.getBoundingClientRect();
      var affs = [];
      charts.forEach(function (ch) {
        var r = ch.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return;
        var pos;
        if (r.bottom < 0) pos = 'above';
        else if (r.top > vh) pos = 'below';
        else if (r.top < 0 && r.bottom > vh) pos = 'spans';
        else pos = 'inview';
        affs.push({
          id: ch.id || ch.tagName + '.' + (ch.getAttribute('class') || '').slice(0, 14),
          pos: pos,
          top: Math.round(r.top), bot: Math.round(r.bottom),
          dist: pos === 'above' ? Math.round(-r.bottom) : (pos === 'below' ? Math.round(r.top - vh) : 0),
          full: (r.top >= 0 && r.bottom <= vh)
        });
      });
      if (!affs.length) return;
      out.items.push({
        sec: sid,
        ctl: (ctl.id || ctl.textContent.trim().slice(0, 10) || ctl.tagName),
        ctlTop: Math.round(cr.top),
        affs: affs
      });
    });
  });

  var d = document.createElement('div');
  d.id = 'probe';
  d.textContent = JSON.stringify(out);
  document.body.appendChild(d);
}, 1800);
</script>`;

/* 临时页必须放在 demo 目录内，否则 demo.js / aflow.js 的相对路径失效 */
const tmp = path.join(demoDir, '__probe.html');
fs.writeFileSync(tmp, html.replace('</body>', probe + '</body>'));
const dom = execFileSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
    '--window-size=1240,860', '--virtual-time-budget=9000', '--dump-dom',
    'file:///' + tmp.replace(/\\/g, '/')],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
fs.unlinkSync(tmp);

const m = /<div id="probe">([\s\S]*?)<\/div>/.exec(dom);
if (!m) { console.log('探测失败'); process.exit(1); }
const data = JSON.parse(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));

console.log('════════ ' + CASE + ' ════════');
console.log('视口高 ' + data.vh + 'px · 文档高 ' + data.docH + 'px');
console.log('初始化: ' + JSON.stringify(data.init));
if (data.err.length) console.log('JS 错误: ' + data.err.join(' | '));
console.log('');

let issue = 0, total = 0, maxDist = 0;
const rows = [];
data.items.forEach(function (r) {
  const hard = r.affs.filter(function (a) { return a.pos === 'below' || a.pos === 'above'; });
  total++;
  /* 取「离控件最远」的反馈图距离 */
  let worst = 0, worstId = '';
  r.affs.forEach(function (a) {
    if (a.dist > worst) { worst = a.dist; worstId = a.id; }
  });
  if (worst > maxDist) maxDist = worst;
  if (hard.length) issue++;
  rows.push({
    sec: r.sec, ctl: String(r.ctl), hard: hard.length, n: r.affs.length,
    worst: worst, worstId: worstId, hardIds: hard.map(function (a) { return a.id + (a.pos === 'above' ? '↑' : '↓') + a.dist; }).join(',')
  });
});
/* 只打印有问题的（按距离排序） */
rows.filter(function (r) { return r.hard > 0; }).sort(function (a, b) { return b.worst - a.worst; }).forEach(function (r) {
  console.log('  ✗ [' + r.sec + '] ' + r.ctl.padEnd(12) + ' 反馈图 ' + r.n + ' 个，其中 ' + r.hard + ' 个不在视口内：' + r.hardIds);
});
console.log('');
console.log('  控件总数 ' + total + '，其中 ' + issue + ' 个有反馈图落在视口外；最远的一个距控件 ' + maxDist + 'px');
