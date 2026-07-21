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

console.log('\n오답 1회...');
const f1 = await post('/api/tutorial/guess', { sessionId: state.sessionId, guess: '전혀상관없는말' });
if (!f1.ok) die(`guess 실패: ${f1.status} ${await f1.text()}`);
const b1 = await f1.json();
if (b1.correct !== false) die('오답이 정답으로 판정됐다');
if (b1.replaced !== false) die('1회 실패에 세트가 교체됐다');
if (b1.state.allies.some((a) => a.trust !== 1)) die(`신뢰도가 1이 아니다 — ${b1.state.allies.map((a) => a.trust)}`);
if (JSON.stringify(b1).includes('codeWord')) die('오답 응답에 codeWord 가 들어 있다 — 유출');
console.log('오답 1회 → 신뢰도 1, codeWord 없음 — OK');

console.log('\n오답 2회...');
const b2 = await (await post('/api/tutorial/guess', { sessionId: state.sessionId, guess: '전혀상관없는말2' })).json();
if (b2.state.allies.some((a) => a.trust !== 0)) die('신뢰도가 0이 아니다');
if (b2.state.allies.some((a) => a.opened !== true)) die('신뢰도 0인데 강화 힌트가 열리지 않았다');
const openedLines = b2.state.allies.map((a) => a.line);
if (openedLines.some((l, i) => l === state.allies[i].line)) die('신뢰도 0인데 대사가 첫 대사 그대로다');
console.log('오답 2회 → 신뢰도 0, 강화 힌트 개방 — OK');
for (const a of b2.state.allies) console.log(`  ${a.name}> "${a.line}"`);

console.log('\n오답 3회 (세트 교체)...');
const b3 = await (await post('/api/tutorial/guess', { sessionId: state.sessionId, guess: '전혀상관없는말3' })).json();
if (b3.replaced !== true) die('3회 실패인데 세트가 교체되지 않았다');
if (!b3.officerLine) die('교체 안내 대사(officerLine)가 없다');
if (b3.state.allies.some((a) => a.trust !== 2)) die('교체 후 신뢰도가 2로 리셋되지 않았다');
if (b3.state.allies.some((a) => a.opened !== false)) die('교체 후에도 강화 힌트가 열려 있다');
const sameAsBefore = b3.state.allies.every((a, i) => a.line === state.allies[i].line);
if (sameAsBefore) die('세트가 교체됐는데 힌트가 이전 세트 그대로다');
console.log('오답 3회 → 세트 교체 + 신뢰도 2 리셋 — OK');
console.log(`  간부> "${b3.officerLine.split('\n')[0]}"`);
for (const a of b3.state.allies) console.log(`  ${a.name}> "${a.line}"`);

console.log('\n튜토리얼 스모크 통과.\n');
