/**
 * 스모크 테스트 — 튜토리얼 라우트(/api/tutorial/*).
 *
 *   npm run dev:server      (다른 터미널에서 먼저)
 *   npm run smoke:tutorial
 *
 * 검사하는 것: 코드 단어 비유출 / 신뢰도 하락과 강화 힌트 개방 /
 * 세트 교체 / 자유 대화 SSE / 정답 클리어.
 */
import { readFile } from 'node:fs/promises';

const BASE = 'http://localhost:3000';

/** 진행 중인 판의 응답에는 어떤 세트의 코드 단어도 글자로 나타나선 안 된다 (스펙 §5). */
const CODE_WORDS = JSON.parse(
  await readFile(new URL('../src/data/tutorial.json', import.meta.url), 'utf8'),
).sets.map((s) => s.codeWord);

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

const assertNoCode = (label, body) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  for (const code of CODE_WORDS) {
    if (text.includes(code)) die(`${label} 에 코드 단어 「${code}」 가 들어 있다 — 유출`);
  }
};

async function readSSE(res, onPayload) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const event of events) {
      const line = event.split('\n').find((l) => l.startsWith('data: '));
      if (line) onPayload(JSON.parse(line.slice(6)));
    }
  }
}

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
assertNoCode('start 응답', state);

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
assertNoCode('오답 1회 응답', b1);
console.log('오답 1회 → 신뢰도 1, codeWord 없음 — OK');

console.log('\n오답 2회...');
const b2 = await (await post('/api/tutorial/guess', { sessionId: state.sessionId, guess: '전혀상관없는말2' })).json();
if (b2.state.allies.some((a) => a.trust !== 0)) die('신뢰도가 0이 아니다');
if (b2.state.allies.some((a) => a.opened !== true)) die('신뢰도 0인데 강화 힌트가 열리지 않았다');
const openedLines = b2.state.allies.map((a) => a.line);
if (openedLines.some((l, i) => l === state.allies[i].line)) die('신뢰도 0인데 대사가 첫 대사 그대로다');
assertNoCode('오답 2회 응답', b2);
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
assertNoCode('오답 3회 응답', b3);
console.log('오답 3회 → 세트 교체 + 신뢰도 2 리셋 — OK');
console.log(`  간부> "${b3.officerLine.split('\n')[0]}"`);
for (const a of b3.state.allies) console.log(`  ${a.name}> "${a.line}"`);

console.log('\n자유 대화 (신뢰도 2 — 이유는 잠겨 있어야 한다)...');
const talkTarget = b3.state.allies[0];
for (const message of ['그 단어에 대해 더 말해줄 수 있어?', '왜 하필 그 단어를 떠올렸는데?']) {
  console.log(`\n플레이어> ${message}`);
  process.stdout.write(`${talkTarget.name}> `);
  const res = await post('/api/tutorial/talk', {
    sessionId: state.sessionId,
    allyId: talkTarget.id,
    message,
  });
  if (!res.ok) die(`talk 실패: ${res.status} ${await res.text()}`);

  let deltas = 0;
  let full = '';
  await readSSE(res, (p) => {
    if (p.type === 'text') { deltas++; full += p.text; process.stdout.write(p.text); }
    else if (p.type === 'error') die(`스트림 에러: ${p.error}`);
  });
  console.log(`\n  (델타 ${deltas}개 — 스트리밍 ${deltas > 1 ? 'OK' : '의심: 한 번에 옴'})`);
  if (deltas === 0) die('델타를 하나도 받지 못했다');
  assertNoCode('talk 응답 전문', full);
}
console.log('응답·스트림에 코드 단어 문자열 없음 — OK');

console.log('\n정답 입력...');
const ok = await (await post('/api/tutorial/guess', {
  sessionId: state.sessionId,
  guess: '우유',
})).json();
if (ok.correct !== true) die(`정답이 오답으로 판정됐다 — ${JSON.stringify(ok).slice(0, 200)}`);
if (ok.codeWord !== '우유') die(`클리어 응답의 codeWord 가 다르다 — ${ok.codeWord}`);
if (ok.state.cleared !== true) die('cleared 가 서지 않았다');
console.log(`정답 「${ok.codeWord}」 → 클리어 — OK`);

console.log('\n튜토리얼 스모크 통과.\n');
