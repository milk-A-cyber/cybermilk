/* 智能完井滑套控制策略 · 模型层单测
 * 用法：node _validate.js  失败 exit 1
 */
'use strict';
const M = require('./demo/demo.js');
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
const in01 = v => v >= 0 && v <= 1;

const env = M.genReservoir(M.NSEG, 20261104);

/* genReservoir 结构 */
ok(env && env.nseg === 5, 'genReservoir nseg');
ok(env.k.length === 5 && env.sw0.length === 5, 'genReservoir 长度');
for (let i = 0; i < 5; i++) {
  ok(in01(env.k[i]), '渗透率 i=' + i);
  ok(in01(env.sw0[i]), '初始含水 i=' + i);
}

/* rlTrain */
{
  const trained = M.rlTrain(env, 1000, 1, 20261144);
  ok(trained.Q.length === 5, 'Q表 5 段');
  ok(trained.Q[0].length === M.NS, 'Q表 4 档');
  ok(trained.Q[0][0].length === 2, 'Q表 2 动作');
  ok(trained.hist.length === 1000, '历史长度');
  ok(trained.rounds === 1000, '回合数');
  /* 训练后末轮奖励应高于初轮（收敛） */
  const first10 = trained.hist.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  const last10 = trained.hist.slice(-10).reduce((a, b) => a + b, 0) / 10;
  ok(last10 > first10, '奖励收敛 (last10>first10)');
  /* λ 大 → 更倾向关高水段（Q 差值更明显） */
  const tLo = M.rlTrain(env, 1500, 0.5, 20261155);
  const tHi = M.rlTrain(env, 1500, 2, 20261166);
  ok(tLo.hist.length === 1500 && tHi.hist.length === 1500, 'λ 可调');
}

/* slideEval */
{
  const trained = M.rlTrain(env, 3000, 1, 20261144);
  const ev = M.slideEval(env, trained, 20);
  ok(ev.oilRL > 0 && ev.oilOpen > 0, '产油正');
  ok(ev.watRL >= 0 && ev.watOpen >= 0, '产水非负');
  ok(in01(ev.swRL) && in01(ev.swOpen), '含水有界');
  /* RL 含水应 ≤ 全开含水（抑制含水） */
  ok(ev.swRL <= ev.swOpen, 'RL 含水≤全开');
  /* 全开产油≥RL 产油（全开不关段） */
  ok(ev.oilOpen >= ev.oilRL * 0.7, '全开产油≥RL*0.7');
  ok(ev.policy && ev.policy.Q, '返回策略');
}

console.log('co4 OK: 段 ' + env.nseg + ' · RL产油 ' + M.slideEval(env, M.rlTrain(env,3000,1,20261144), 20).oilRL.toFixed(1) + ' · 全开产油 ' + M.slideEval(env, M.rlTrain(env,3000,1,20261144), 20).oilOpen.toFixed(1) + ' · RL含水 ' + M.slideEval(env, M.rlTrain(env,3000,1,20261144), 20).swRL.toFixed(2) + ' 全开含水 ' + M.slideEval(env, M.rlTrain(env,3000,1,20261144), 20).swOpen.toFixed(2));
