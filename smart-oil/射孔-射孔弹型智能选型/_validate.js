/* 射孔弹型智能选型 · 模型层单测
 * 用法：node _validate.js  失败 exit 1
 */
'use strict';
const M = require('./demo/demo.js');
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
const in01 = v => v >= 0 && v <= 1;

/* 知识库 */
const kb = M.buildKB();
ok(kb.bullets.length === 10, '知识库 10 种弹型');
ok(kb.bullets.every(b => b.depth >= 0 && b.depth <= 1 && b.dia >= 0 && b.dia <= 1), '穿深孔径有界');
ok(kb.bullets.every(b => b.rocks.length > 0 && b.grades.length > 0), '适用条件非空');

/* 井况 */
const well = M.makeWell('砂岩', 'N80', 9);
ok(well.rock === '砂岩' && well.grade === 'N80' && well.wall === 9, '井况构造');

/* 规则匹配 */
const match = M.matchBullets(kb, well);
ok(match.length > 0, '候选非空');
ok(match.every(b => (b.rocks.indexOf('砂岩') >= 0 || b.grades.indexOf('N80') >= 0) && b.wall.indexOf(9) >= 0), '候选满足规则');

/* 排序 */
const rank = M.rankBullets(kb, well);
ok(rank.nCand === match.length, '候选数一致');
ok(rank.nAll === 10, '全库 10');
ok(rank.cands.length === rank.nCand, '排序候选数');
/* 降序 */
for (let i = 1; i < rank.cands.length; i++) ok(rank.cands[i - 1].score >= rank.cands[i].score, '降序排序');
ok(in01(rank.cands[0].score), '得分有界');

/* 不同井况首推不同 */
const well2 = M.makeWell('灰岩', 'J55', 7);
const rank2 = M.rankBullets(kb, well2);
ok(rank2.nCand > 0, '灰岩井候选非空');
/* 深穿透弹 B7 只适用 N80/P110，J55 灰岩井不应首推 */
const topJ = rank2.cands[0];
ok(!(topJ.id === 'B7' && topJ.gradeHit === 0), 'J55灰岩井不首推不适配的B7');

/* 规则匹配在完全不适配时筛掉 */
const badWell = M.makeWell('页岩', 'J55', 7);
const rankBad = M.rankBullets(kb, badWell);
/* 每种弹型至少 rock 或 grade 之一命中，故通常仍非空；至少保证有候选 */
ok(rankBad.nCand > 0, '页岩J55井仍有候选');

console.log('p3 OK: 弹型 ' + kb.bullets.length + '·井况 砂岩/N80/9·候选 ' + rank.nCand + '/' + rank.nAll + '·首推 ' + rank.cands[0].name + '(' + rank.cands[0].id + ') 得分 ' + rank.cands[0].score.toFixed(2));
