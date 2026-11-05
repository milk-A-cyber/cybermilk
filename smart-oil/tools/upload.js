/* =========================================================
   案例包上传端到端测试（无头）
   -------------------------------------------------------------
   模拟用户在「＋ 添加案例」弹窗里拖入整个案例包文件夹，
   校验 → 添加 → 跳到场景页 → 检查三个 tab 与示范 iframe。
   运行：node tools/upload.js
   ========================================================= */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
require('fs').mkdirSync(path.join(__dirname, '_tmp'), { recursive: true });
const ASSET = ('file:///' + path.join(ROOT, 'assets').replace(/\\/g, '/')).replace(/\\/g, '/');
const CASE_DIR = process.argv[2] || 'pumping-diag-case';
/* 案例 id 以清单为准（不一定等于文件夹名） */
const CASE_NAME = JSON.parse(fs.readFileSync(path.join(ROOT, CASE_DIR, 'case.json'), 'utf8')).id;

/* 把案例包里的文件读出来，生成一个 data URL 列表，
   注入测试页，模拟拖拽上传。 */
function packFiles() {
  const dir = path.join(ROOT, CASE_DIR);
  const out = [];
  (function walk(d, prefix) {
    for (const name of fs.readdirSync(d)) {
      if (name.startsWith('.')) continue;
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, prefix + name + '/');
      else {
        const ext = path.extname(name).slice(1).toLowerCase();
        const mime = ext === 'html' ? 'text/html' : ext === 'js' ? 'text/javascript'
          : ext === 'css' ? 'text/css' : ext === 'json' ? 'application/json'
            : ext === 'svg' ? 'image/svg+xml' : 'text/plain';
        const data = fs.readFileSync(full, 'utf8');
        out.push({ name: prefix + name, mime, data });
      }
    }
  })(dir, CASE_DIR + '/');
  return out;
}

/* 生成测试页：加载主站全部脚本 → 注入文件 → 触发上传流程 */
const harness = `
<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>upload test</title></head><body>
<div id="log">PENDING</div>
<div id="view"></div>
<script>
window.__FILES__ = __FILES_JSON__;
window.__CASE__ = __CASE_NAME__;
</script>
<script src="${ASSET}/data.js"></script>
<script src="${ASSET}/core/registry.js"></script>
<script src="${ASSET}/core/kit.js"></script>
<script src="${ASSET}/core/case-demo-host.js"></script>
<script src="${ASSET}/core/case-upload.js"></script>
<script src="${ASSET}/core/admin.js"></script>
<script src="${ASSET}/core/shell.js"></script>
<script>
window.__ERR__ = [];
window.addEventListener('error', function (e) { window.__ERR__.push(e.message + ' @ ' + (e.filename||'').split('/').pop() + ':' + e.lineno); });
(async function () {
  window.__HMSGS__ = 0; window.__LASTH__ = 0;
  window.addEventListener('message', function (e) {
    if (e.data && e.data.__caseDemo) { window.__HMSGS__++; window.__LASTH__ = e.data.h; }
  });
  var log = document.getElementById('log');
  function say(s) { log.textContent += '\\n' + s; }
  try {
    /* 构造 File 列表，模拟文件夹拖入 */
    var dt = new DataTransfer();
    for (var i = 0; i < window.__FILES__.length; i++) {
      var f = window.__FILES__[i];
      dt.items.add(new File([f.data], f.name, { type: f.mime }));
    }
    /* 走真实的 CaseImport.open() 通道（导航上的「＋ 添加案例」就是它） */
    if (!window.CaseImport || typeof window.CaseImport.open !== 'function') {
      throw new Error('找不到 CaseImport.open');
    }
    window.CaseImport.open({ sceneId: '' });
    await new Promise(function (r) { setTimeout(r, 400); });
    var input = document.getElementById('imp-file');
    if (!input) throw new Error('找不到 #imp-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    await new Promise(function (r) { setTimeout(r, 1500); });
    say('MODAL_IDS=' + Array.prototype.slice.call(document.querySelectorAll('[id]')).map(function (n) { return n.id; }).filter(function (x) { return /imp/.test(x); }).join(','));
    var tipEl = document.getElementById('imp-tip');
    say('TIP=' + (tipEl ? tipEl.textContent.trim() : '(none)'));
    var listEl = document.getElementById('imp-list');
    say('LIST=' + (listEl ? listEl.textContent.trim().slice(0, 200) : '(none)'));
    say('FILE_COUNT=' + (window.__FILES__ ? window.__FILES__.length : -1));
    say('INPUT_FILES=' + (input.files ? input.files.length : -1));

    var res = document.querySelectorAll('#imp-res .imp-item');
    var errs = 0, warns = 0, oks = 0, msgs = [];
    res.forEach(function (n) {
      var lv = n.getAttribute('data-lv');
      var msg = (n.querySelector('.imp-m') || {}).textContent || '';
      if (lv === 'error') { errs++; msgs.push('E: ' + msg); }
      else if (lv === 'warn') { warns++; msgs.push('W: ' + msg); }
      else oks++;
    });
    var cnt = document.getElementById('imp-count');
    say('VALIDATION=' + (cnt ? cnt.textContent.trim() : '(none)') + ' | ok=' + oks + ' warn=' + warns + ' err=' + errs);
    if (msgs.length) say('ISSUES:' + String.fromCharCode(10) + msgs.join(String.fromCharCode(10)));
    say('META=' + JSON.stringify({
      id: (document.getElementById('imp-id') || {}).value,
      scene: (document.getElementById('imp-scene') || {}).value,
      title: (document.getElementById('imp-title-in') || {}).value
    }));

    /* 点「校验并添加」 */
    var okBtn = document.getElementById('imp-ok');
    if (!okBtn) throw new Error('找不到 #imp-ok');
    var sceneId = (document.getElementById('imp-scene') || {}).value || 'pr1';
    okBtn.click();
    await new Promise(function (r) { setTimeout(r, 1400); });

    say('CASE_REGISTERED=' + (window.Cases && window.Cases.get(window.__CASE__) ? 'yes' : 'no'));
    say('CASES_COUNT=' + (window.Cases ? window.Cases.list().length : -1));
    say('STORED=' + (localStorage.getItem('atlas.casepack.v2') ? 'yes' : 'no'));
    say('HASH=' + location.hash);

    /* 强制重渲染场景页（commit 已把 hash 设成同一个值，不会再触发 hashchange） */
    location.hash = '#/cases';
    await new Promise(function (r) { setTimeout(r, 200); });
    location.hash = '#/scene/' + sceneId;
    await new Promise(function (r) { setTimeout(r, 900); });
    /* 案例流程 tab：步骤数 / 每步配图数（配图在 case.json 的 steps[].fig） */
    var wfTab = Array.prototype.slice.call(document.querySelectorAll('.tabs button')).filter(function (b) {
      return /案例流程/.test(b.textContent);
    })[0];
    if (wfTab) {
      wfTab.click();
      await new Promise(function (r) { setTimeout(r, 500); });
      say('WF_STEPS=' + document.querySelectorAll('.pstep').length +
        ' WF_FIGS=' + document.querySelectorAll('.pstep .pfig svg').length +
        ' WF_FIGBOX=' + document.querySelectorAll('.pstep .pfig').length);
    } else {
      say('WF_STEPS=(no tab)');
    }
    /* 进入 demo tab，检查 iframe 高度与内部滚动 */
    window.__HMSGS__ = 0; window.__LASTH__ = 0;
    var demoTab = Array.prototype.slice.call(document.querySelectorAll('.tabs button')).filter(function (b) {
      return /示范/.test(b.textContent);
    })[0];
    if (demoTab) {
      demoTab.click();
      await new Promise(function (r) { setTimeout(r, 6000); });
      var allFrames = document.querySelectorAll('iframe');
      var fr = null, frameInfo = [];
      allFrames.forEach(function (f) {
        frameInfo.push(f.className + '@' + Math.round(f.getBoundingClientRect().width) + 'x' + Math.round(f.getBoundingClientRect().height));
      });
      say('ALL_FRAMES=' + frameInfo.join(','));
      say('HAS_ROOT=' + !!document.getElementById('case-demo-root'));
      var rootEl = document.getElementById('case-demo-root');
      if (rootEl) say('ROOT_HTML_LEN=' + rootEl.innerHTML.length);
      fr = document.querySelector('#case-demo-root iframe');
      say('IFRAME_H=' + (fr ? Math.round(fr.getBoundingClientRect().height) : 'none'));
      say('IFRAME_STYLE_H=' + (fr ? fr.style.height : 'none'));
      say('HOST_SCROLL_H=' + document.documentElement.scrollHeight);
      /* iframe 内部文档高度：sandbox 无 allow-same-origin 读不到，
         改为统计 iframe 收到的 postMessage 高度上报 */
      say('IFRAME_TOP=' + (fr ? Math.round(fr.getBoundingClientRect().top) : 'none'));
      /* iframe 内部是否自带滚动条：用 srcdoc 探针测内部 scrollHeight */
      var frw = fr.getBoundingClientRect().width;
      say('IFRAME_W=' + Math.round(frw));
      /* 主站页面滚动到 iframe 位置，看 iframe 顶部对齐时内部显示的是哪一段 */
      fr.scrollIntoView({ block: 'start' });
      await new Promise(function (r) { setTimeout(r, 300); });
      say('AFTER_SCROLL_IFRAME_TOP=' + Math.round(fr.getBoundingClientRect().top));
      /* 统计高度上报消息 */
      say('HEIGHT_MSGS=' + (window.__HMSGS__ || 0) + ' LAST_H=' + (window.__LASTH__ || 'none'));
      /* iframe 内部文档高度：用第二个 iframe 加载同一份 srcdoc（末尾追加探针） */
      if (fr) {
        var sd = fr.getAttribute('srcdoc') || '';
        say('SD_LEN=' + sd.length + ' SD_HAS_ASSETS=' + (sd.indexOf('__ASSETS__') >= 0 ? 'yes' : 'no'));
        /* 统计 srcdoc 里的关键标记，判断脚本是否被内联进去 */
        say('SD_HAS_CARD=' + (sd.indexOf('cardSvg') >= 0 ? 'yes' : 'no'));
        say('SD_HAS_CNN=' + (sd.indexOf('nnIn') >= 0 ? 'yes' : 'no'));
        say('SD_HAS_SCRIPT_CLOSE=' + (sd.split('</scr' + 'ipt>').length - 1));
      }
    }
    var tabs = document.querySelectorAll('.tabs button');
    var names = [];
    tabs.forEach(function (b) { names.push(b.textContent.replace(/\\s+/g, ' ').trim()); });
    try {
      var fr3 = document.querySelector('#case-demo-root iframe');
      if (fr3) fr3.scrollIntoView({ block: 'start' });
    } catch (e) {}
    say('TABS=' + names.join('|'));
    say('TAB_COUNT=' + tabs.length);
    var v = document.getElementById('view');
    say('VIEW_LEN=' + (v ? v.innerHTML.length : -1));
    say('VIEW_HEAD=' + (v ? v.innerHTML.replace(/\\s+/g, ' ').slice(0, 300) : ''));
    say('ERRORS=' + (window.__ERR__ || []).join(' ;; '));
    say('ATLAS=' + (typeof window.ATLAS) + ' DATA=' + (typeof window.A));

    /* 打开示范 tab */
    var demoBtn = null;
    tabs.forEach(function (b) { if (b.textContent.indexOf('示范') >= 0) demoBtn = b; });
    if (demoBtn) {
      demoBtn.click();
      await new Promise(function (r) { setTimeout(r, 3000); });
      var allFrames = document.querySelectorAll('iframe');
      var fr = null, frameInfo = [];
      allFrames.forEach(function (f) {
        frameInfo.push(f.className + '@' + Math.round(f.getBoundingClientRect().width) + 'x' + Math.round(f.getBoundingClientRect().height));
      });
      say('ALL_FRAMES=' + frameInfo.join(','));
      say('HAS_ROOT=' + !!document.getElementById('case-demo-root'));
      var rootEl = document.getElementById('case-demo-root');
      if (rootEl) say('ROOT_HTML_LEN=' + rootEl.innerHTML.length);
      fr = document.querySelector('#case-demo-root iframe');
      say('IFRAME=' + (fr ? 'yes' : 'no'));
      if (fr) {
        var d = null;
        for (var tries = 0; tries < 20; tries++) {
          try { d = fr.contentDocument; } catch (e) { d = null; }
          if (d && d.body && d.body.innerHTML.length > 500) break;
          await new Promise(function (r) { setTimeout(r, 400); });
        }
        if (!d) { say('DEMO_READ_ERR=cannot access contentDocument'); }
        else {
          var svgs = d.querySelectorAll('svg').length;
          var canv = d.querySelectorAll('canvas').length;
          say('DEMO_SVG=' + svgs + ' DEMO_CANVAS=' + canv);
          say('DEMO_BODY_LEN=' + (d.body ? d.body.innerHTML.length : 0));
          say('DEMO_ERRBOX=' + (d.getElementById('errbox') ? d.getElementById('errbox').textContent.slice(0,300) : 'none'));
          /* 关键：算法解剖动画是否挂上了 */
          var af = d.getElementById('flowMount');
          say('FLOW_MOUNT=' + (af ? 'yes' : 'no'));
          if (af) {
            say('FLOW_NODES=' + af.querySelectorAll('.af-node').length);
            say('FLOW_SVG_LEN=' + (af.querySelector('svg') ? af.querySelector('svg').innerHTML.length : 0));
            say('FLOW_STATS=' + af.querySelectorAll('.af-stat').length);
            say('FLOW_NOTE_LEN=' + (af.querySelector('.af-note') ? af.querySelector('.af-note').textContent.length : 0));
          }
          say('DEMO_TITLE=' + (d.title || ''));
        }
      }
    }
    say('DONE');
  } catch (e) {
    say('FATAL=' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]);
    say('DONE');
  }
})();
</script>
</body></html>`;

const files = packFiles();
/* 注意：包里的 index.html 含 </script>，直接内联会提前截断脚本标签，
   所以把 JSON 里的 </ 统一转义成 <\/ （JSON 字符串内合法）。 */
const filesJson = JSON.stringify(files).replace(/<\//g, '<\\/');
const html = harness
  .replace('__FILES_JSON__', filesJson)
  .replace('__CASE_NAME__', JSON.stringify(CASE_NAME));

fs.writeFileSync(path.join(__dirname, '_tmp', 'upload.html'), html);

const { execFileSync } = require('child_process');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = 'file:///' + path.join(__dirname, '_tmp', 'upload.html').replace(/\\/g, '/');
const out = execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--allow-file-access-from-files',
  '--virtual-time-budget=12000',
  '--dump-dom', url
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const m = /<div id="log">([\s\S]*?)<\/div>/.exec(out);
console.log('=== ' + CASE_DIR + ' 上传端到端 ===');
console.log(m ? m[1] : '(no log found, dom len=' + out.length + ')');
