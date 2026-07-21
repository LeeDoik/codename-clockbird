/**
 * 스모크 테스트 — 튜토리얼 라우트(/api/tutorial/*).
 *
 *   npm run dev:server      (다른 터미널에서 먼저)
 *   npm run smoke:tutorial
 *
 * 검사하는 것: 코드 단어 비유출 / 신뢰도 하락과 강화 힌트 개방 /
 * 세트 교체 / 자유 대화 SSE / 정답 클리어.
 */
const BASE = 'http://localhost:3000';

const post = (path, body) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

const die = (msg) => {
  console.error(`\n[!] ${msg}`);
  process.exit(1);
};

console.log('튜토리얼 시작...');
const startRes = await post('/api/tutorial/start');
if (!startRes.ok) die(`start 실패: ${startRes.status} ${await startRes.text()}`);
const state = await startRes.json();

if (state.allies?.length !== 3) die(`동료가 3명이 아니다 — ${state.allies?.length}`);
if (!state.officer?.id) die('간부(officer)가 응답에 없다');
console.log(`간부: ${state.officer.name} (${state.officer.role})`);
for (const a of state.allies) console.log(`  ${a.name} (${a.role}) 신뢰도 ${a.trust} — "${a.line}"`);

if (JSON.stringify(state).includes('codeWord')) die('start 응답에 codeWord 가 들어 있다 — 유출');
console.log('start 응답에 codeWord 없음 — OK');

if (JSON.stringify(state).includes('"reason"')) die('start 응답에 reason 이 들어 있다 — 강화 힌트 조기 유출');
console.log('start 응답에 reason 없음 — OK');

if (state.allies.some((a) => a.trust !== 2)) die('초기 신뢰도가 2가 아니다');
console.log('초기 신뢰도 2 — OK');

console.log('\n튜토리얼 스모크 통과.\n');
