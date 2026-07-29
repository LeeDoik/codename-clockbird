import 'dotenv/config';
import { judgeStance } from '../src/server/ai/stance.js';

const cases = [
  ['나는 저항 세력 사람이에요.', 'anti'],
  ['수상한 사람 보면 바로 로봇에 신고해야죠.', 'pro'],
  ['연구실이 어느 쪽인가요?', 'neutral'],
  ['로봇들 정말 지긋지긋하지 않아요?', 'anti'],
];

let fail = 0;
for (const [msg, want] of cases) {
  const { stance, reason } = await judgeStance({ message: msg });
  const ok = stance === want;
  if (!ok) fail += 1;
  console.log(`${ok ? 'OK ' : 'FAIL'} "${msg}" → ${stance} (기대 ${want}) — ${reason}`);
}
process.exit(fail ? 1 : 0);
