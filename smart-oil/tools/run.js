/* =========================================================
   无头验证脚手架 · 主站 + 案例上传 + 示范渲染
   运行：node tools/run.js
   用法：Chrome --headless --dump-dom --virtual-time-budget=N
   ========================================================= */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(ROOT, '_tmp', 'out');
fs.mkdirSync(OUT, { recursive: true });

function chrome(args) {
  return execFileSync(CHROME, args, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

/* 跑一个页面，把最终 DOM 打到 stdout */
function dump(relUrl, budgetMs) {
  const url = 'file:///' + path.join(ROOT, relUrl).replace(/\\/g, '/');
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--allow-file-access-from-files',
    '--virtual-time-budget=' + (budgetMs || 4000),
    '--run-all-compositor-stages-before-draw',
    '--dump-dom', url
  ];
  return chrome(args);
}

module.exports = { dump, chrome, ROOT, OUT, CHROME };

if (require.main === module) {
  const target = process.argv[2] || 'index.html';
  const budget = Number(process.argv[3] || 4000);
  const html = dump(target, budget);
  fs.writeFileSync(path.join(OUT, 'dump.html'), html);
  console.log('LEN=' + html.length);
}
