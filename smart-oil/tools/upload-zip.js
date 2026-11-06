/* =========================================================
   案例包 .zip 上传端到端测试（无头）
   走真实通道：CaseImport.open → 选 zip → 解压 → 校验 → 提交
   运行：node tools/upload-zip.js <case-dir>.zip
   ========================================================= */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ASSET = ('file:///' + path.join(ROOT, 'assets').replace(/\\/g, '/')).replace(/\\/g, '/');

const ZIP = process.argv[2] || 'pumping-diag-case.zip';
const zipB64 = fs.readFileSync(path.join(ROOT, ZIP)).toString('base64');

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"></head><body>
<div id="log">PENDING</div><div id="view"></div>
<script>window.__ZIPB64__=${JSON.stringify(zipB64)};</script>
<script src="${ASSET}/data.js"></script>
<script src="${ASSET}/core/registry.js"></script>
<script src="${ASSET}/core/kit.js"></script>
<script src="${ASSET}/core/case-demo-host.js"></script>
<script src="${ASSET}/core/case-upload.js"></script>
<script src="${ASSET}/core/admin.js"></script>
<script src="${ASSET}/core/shell.js"></script>
<script>
(async function () {
  var log = document.getElementById('log');
  function say(s) { log.textContent += '\\n' + s; }
  try {
    /* 解 base64 → Blob → File，走真实的 zip 通道 */
    var bin = atob(window.__ZIPB64__);
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    var file = new File([buf], ${JSON.stringify(ZIP)}, { type: 'application/zip' });

    window.CaseImport.open({ sceneId: '' });
    await new Promise(function (r) { setTimeout(r, 400); });
    var zipIn = document.getElementById('imp-zip');
    if (!zipIn) throw new Error('找不到 #imp-zip');
    var dt = new DataTransfer();
    dt.items.add(file);
    zipIn.files = dt.files;
    zipIn.dispatchEvent(new Event('change'));
    await new Promise(function (r) { setTimeout(r, 1800); });

    var cnt = document.getElementById('imp-count');
    say('VALIDATION=' + (cnt ? cnt.textContent.trim() : '(none)'));
    var items = document.querySelectorAll('#imp-res .imp-item');
    var errs = 0;
    items.forEach(function (n) { if (n.getAttribute('data-lv') === 'error') errs++; });
    say('ERR_ITEMS=' + errs + ' TOTAL=' + items.length);
    say('CASE_ID=' + (document.getElementById('imp-id') || {}).value);
    say('SCENE=' + (document.getElementById('imp-scene') || {}).value);

    document.getElementById('imp-ok').click();
    await new Promise(function (r) { setTimeout(r, 1500); });
    var id = (document.getElementById('imp-id') || {}).value;
    say('REGISTERED=' + (window.Cases.get(id) ? 'yes' : 'no'));
    say('STORED=' + (localStorage.getItem('atlas.casepack.v2') ? 'yes' : 'no'));
    say('DONE');
  } catch (e) {
    say('FATAL=' + e.message);
    say('DONE');
  }
})();
</script></body></html>`;

const tmp = path.join(__dirname, '_tmp', '_zip.html');
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, html);
const out = execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  '--virtual-time-budget=14000', '--dump-dom',
  'file:///' + tmp.replace(/\\/g, '/')
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const m = /<div id="log">([\s\S]*?)<\/div>/.exec(out);
console.log('=== ' + ZIP + ' ===');
console.log(m ? m[1] : '(no log)');
fs.unlinkSync(tmp);
