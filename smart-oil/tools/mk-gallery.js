/* 生成「六种工况示功图」图库 SVG
   ---------------------------------------------------------
   曲线点来自 demo.js 的真实物理模型（与可运行示范同一份代码）。
   每张卡片纵轴按本井载荷范围自适应（至少保留 30% 量程，避免把断脱的
   微小波动放大成假形状），右上角标出真实载荷区间——比形状，也交代量级。
   用法：node tools/mk-gallery.js  → tools/_tmp/fig4-new.svg
   ========================================================= */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const D = require(path.join(ROOT, 'pumping-diag-case/demo/demo.js'));

const CASES = [
  { name: '正常', color: '#2f7d6b', p: Object.assign({}, D.PRESET['正常']),
    l1: '图形饱满，传递线陡直', l2: '上下冲程载荷差 = 液柱重量' },
  { name: '供液不足', color: '#c98a2b', p: Object.assign({}, D.PRESET['供液不足'], { pound: true }),
    l1: '顶部被切 + 液击凸包', l2: '泵筒没充满，泵效下降' },
  { name: '气锁', color: '#7e5a8d', p: Object.assign({}, D.PRESET['气锁']),
    l1: '传递线拉成斜线，峰载荷低', l2: '气体压缩/膨胀拖慢传递' },
  { name: '泵漏失', color: '#41699b', p: Object.assign({}, D.PRESET['泵漏失']),
    l1: '载荷持续渐变，图形倾斜', l2: '液体从柱塞间隙漏回' },
  { name: '杆断脱', color: '#b05a51', p: { fill: 0, gas: 0, leak: 0, broken: 1, spm: 6 },
    l1: '载荷塌到低值区', l2: '只提断点以上杆重，须立即作业' },
  { name: '复合疑难', color: '#79828a', p: Object.assign({}, D.PRESET['复合疑难']),
    l1: '形状介于多类之间', l2: '人与模型都没把握 → 人工复核' }
];

const CW = 196, CH = 158, GAPX = 16, GAPY = 18;
const COL = 3, ROW = 2;
const W = COL * CW + (COL - 1) * GAPX + 16;
const H = ROW * CH + (ROW - 1) * GAPY + 16;

function shape(p) {
  const pts = D.cardPoints(Object.assign({ S: 3 }, p), 160);
  const xs = pts.map(a => a[0]), ys = pts.map(a => a[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  /* 纵轴自适应：至少 30% 量程，防止把小波动放大成假形状 */
  const minSpan = 0.30 * D.Ymax;
  if (y1 - y0 < minSpan) {
    const mid = (y0 + y1) / 2;
    y0 = mid - minSpan / 2; y1 = mid + minSpan / 2;
  }
  const padL = 30, padR = 14, padT = 34, padB = 46;
  const bx = padL, by = padT, bw = CW - padL - padR, bh = CH - padT - padB;
  const sx = v => bx + (v - x0) / (x1 - x0) * bw;
  const sy = v => by + bh - (v - y0) / (y1 - y0) * bh;
  let d = '';
  pts.forEach((a, i) => { d += (i ? 'L' : 'M') + sx(a[0]).toFixed(1) + ' ' + sy(a[1]).toFixed(1); });
  return { d, bx, by, bw, bh, range: Math.round(Math.min(...ys)) + '–' + Math.round(Math.max(...ys)) + ' kN' };
}

let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="六种工况的示功图图库" style="width:100%;height:auto">`;
CASES.forEach((c, i) => {
  const cx = 8 + (i % COL) * (CW + GAPX), cy = 8 + Math.floor(i / COL) * (CH + GAPY);
  const g = shape(c.p);
  svg += `<g transform="translate(${cx},${cy})">`;
  svg += `<rect x="0" y="0" width="${CW}" height="${CH}" rx="9" fill="#fdfcf9" stroke="#e9e4d8"/>`;
  svg += `<text x="12" y="20" font-size="10.5" fill="${c.color}" font-weight="700">${c.name}</text>`;
  svg += `<text x="${CW - 12}" y="20" font-size="8" fill="#9aa1a6" text-anchor="end">${g.range}</text>`;
  svg += `<rect x="${g.bx}" y="${g.by}" width="${g.bw}" height="${g.bh}" fill="#fffefb" stroke="#ece7db"/>`;
  /* 底/左轴线，说明这是「载荷—位移」坐标 */
  svg += `<line x1="${g.bx}" y1="${g.by + g.bh}" x2="${g.bx + g.bw}" y2="${g.by + g.bh}" stroke="#e2dccd"/>`;
  svg += `<line x1="${g.bx}" y1="${g.by}" x2="${g.bx}" y2="${g.by + g.bh}" stroke="#e2dccd"/>`;
  svg += `<path d="${g.d}" fill="none" stroke="${c.color}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>`;
  svg += `<text x="12" y="${CH - 24}" font-size="8.5" fill="#4d565b">${c.l1}</text>`;
  svg += `<text x="12" y="${CH - 11}" font-size="8.5" fill="#79828a">${c.l2}</text>`;
  svg += '</g>';
});
svg += `</svg>`;

fs.writeFileSync(path.join(ROOT, 'tools/_tmp/fig4-new.svg'), svg);
fs.writeFileSync(path.join(ROOT, 'tools/_tmp/fig4-new.html'),
  '<!DOCTYPE html><meta charset="utf-8"><body style="margin:0;background:#fff">' +
  '<div style="width:1240px">' + svg.replace('width:100%', 'width:1240px') + '</div>');
console.log('W,H', W, H, 'bytes', svg.length);
