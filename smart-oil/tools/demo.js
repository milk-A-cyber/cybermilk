/* =========================================================
   示范页直测（无头）
   -------------------------------------------------------------
   直接打开 demo/index.html（与沙箱 iframe 同一份代码），
   检查：脚本无错、关键 DOM 就位、算法解剖动画真的在跑
   （阶段节点、SVG 内容、读数、进度条随时间变化）。
   运行：node tools/demo.js <case-dir>
   ========================================================= */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const CASE_DIR = process.argv[2] || 'pumping-diag-case';
const FLOW_ID = process.argv[3] || 'flowMount';

/* 在 demo 目录里生成一个自检页：先跑原页面脚本，再跑检查脚本 */
const demoDir = path.join(ROOT, CASE_DIR, 'demo');
const htmlSrc = fs.readFileSync(path.join(demoDir, 'index.html'), 'utf8');
/* 把 </script> 结尾换成带自检的版本 */
const probe = `
<script src="__AFLOW__"></script>
<script src="__FLOW__"></script>
<script>
(function () {
  var out = [];
  function say(s) { out.push(s); }
  var errs = [];
  window.addEventListener('error', function (e) { errs.push(e.message + ' @ ' + (e.filename||'').split('/').pop() + ':' + e.lineno); });

  function snap(label) {
    var m = document.getElementById('${FLOW_ID}');
    if (!m) { say(label + ':NO_MOUNT'); return; }
    var svg = m.querySelector('svg');
    var st = m.querySelectorAll('.af-stat');
    var vals = [];
    st.forEach(function (n) { vals.push(n.textContent.replace(/\\s+/g, ' ').trim()); });
    say(label + ':nodes=' + m.querySelectorAll('.af-node').length +
        ' svg=' + (svg ? svg.innerHTML.length : 0) +
        ' stats=' + st.length +
        ' prog=' + (m.querySelector('.af-prog i') ? m.querySelector('.af-prog i').style.width : '-') +
        ' on=' + (m.querySelector('.af-node.on') ? m.querySelector('.af-node.on').textContent.replace(/\\s+/g,' ').trim() : '-'));
    say(label + ':stats=' + vals.join(' | '));
    say(label + ':note=' + (m.querySelector('.af-note') ? m.querySelector('.af-note').textContent.replace(/\\s+/g,' ').trim().slice(0, 110) : ''));
  }

  setTimeout(function () {
    snap('T0');
    /* 跳到最后一个阶段看判定步 */
    var nodes = document.querySelectorAll('#${FLOW_ID} .af-node');
    if (nodes.length) { nodes[nodes.length - 1].click(); }
    setTimeout(function () {
      snap('T1_LAST');
      /* 再跳到卷积阶段 */
      if (nodes.length > 2) { nodes[2].click(); }
      setTimeout(function () {
        snap('T2_CONV');
        say('ERRORS=' + errs.join(' ;; '));
        say('DONE');
        var d = document.createElement('div');
        d.id = '__probe_out__';
        d.textContent = out.join(String.fromCharCode(10));
        document.body.appendChild(d);
      }, 900);
    }, 900);
  }, 1600);
})();
</script>
`;

/* 找出示范页里 aflow.js / flow.js 的引入点 */
let patched = htmlSrc;
const hasAflow = /<script src="aflow\.js"><\/script>/.test(patched);
const hasFlow = /<script src="flow\.js"><\/script>/.test(patched);
patched = patched.replace('</body>', probe.replace('__AFLOW__', hasAflow ? '' : 'aflow.js')
  .replace('__FLOW__', hasFlow ? '' : 'flow.js') + '</body>');

const probeFile = path.join(demoDir, '__probe.html');
fs.writeFileSync(probeFile, patched);

const url = 'file:///' + probeFile.replace(/\\/g, '/');
const out = execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--allow-file-access-from-files',
  '--virtual-time-budget=9000',
  '--dump-dom', url
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const m = /<div id="__probe_out__">([\s\S]*?)<\/div>/.exec(out);
console.log('=== ' + CASE_DIR + ' 示范页直测 ===');
console.log(m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '(no probe output; dom len=' + out.length + ')');
fs.unlinkSync(probeFile);
