/* =========================================================
   示范页截图（跳到指定算法解剖阶段 + 指定进度）
   运行：node tools/shot-stage.js <case-dir> <out.png> <stageIdx> [t] [flowId]
   ========================================================= */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const CASE_DIR = process.argv[2] || 'pumping-diag-case';
const OUTFILE = process.argv[3] || path.join(ROOT, '_tmp', 'out', 'stage.png');
const STAGE = Number(process.argv[4] || 0);
const T = Number(process.argv[5] || 0.5);
const FLOW_ID = process.argv[6] || 'flowMount';
const API = process.argv[7] || 'PumpFlowApi';

const demoDir = path.join(ROOT, CASE_DIR, 'demo');
const htmlSrc = fs.readFileSync(path.join(demoDir, 'index.html'), 'utf8');

const inject = `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var api = window.${API};
    if (!api) { document.title = 'NO_API'; return; }
    api.seek(${STAGE}, ${T});
    api.pause();
    setTimeout(function () { document.title = 'SHOT_READY'; }, 200);
  }, 700);
});
</script>
`;

const patched = htmlSrc.replace('</body>', inject + '</body>');
const probeFile = path.join(demoDir, '__shot.html');
fs.writeFileSync(probeFile, patched);

fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
const url = 'file:///' + probeFile.replace(/\\/g, '/');
execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--allow-file-access-from-files', '--hide-scrollbars',
  '--window-size=1240,1500',
  '--virtual-time-budget=4000',
  '--screenshot=' + OUTFILE, url
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
fs.unlinkSync(probeFile);
console.log('SHOT=' + OUTFILE + ' size=' + (fs.existsSync(OUTFILE) ? fs.statSync(OUTFILE).size : 0));
