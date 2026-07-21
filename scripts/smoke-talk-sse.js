/**
 * 스모크 테스트 — /api/stage/talk 의 SSE 경로가 HTTP 로 실제 동작하는지.
 *
 *   npm run dev:server      (다른 터미널에서 먼저)
 *   npm run smoke
 *
 * poc:talk 은 dialogue.js 만 검증한다. 라우트·SSE 프레이밍·세션 이력·
 * 코드 단어 비유출은 서버를 통해야만 확인되므로 이 스크립트가 따로 있다.
 */
import { readFile } from 'node:fs/promises';

const BASE = 'http://localhost:3000';

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

const post = (path, body) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

console.log('스테이지 시작 (연상 단어 생성 대기)...');
const startRes = await post('/api/stage/start');
if (!startRes.ok) {
  console.error('start 실패:', startRes.status, await startRes.text());
  process.exit(1);
}
const state = await startRes.json();

const target = state.allies.find((a) => !a.arrested);
console.log(`\n동료 ${state.allies.length}명 / 체포 ${state.allies.filter((a) => a.arrested).length}명`);
console.log(`대상: ${target.name} (${target.role}) — 단어 「${target.word}」`);

// 코드 단어가 응답에 섞여 나오지 않는지 확인 (서버 전용이어야 함)
if (JSON.stringify(state).includes('codeWord')) {
  console.error('\n[!] start 응답에 codeWord 가 들어 있다 — 유출');
  process.exit(1);
}
console.log('start 응답에 codeWord 없음 — OK');

// 글자 수·카테고리 힌트 — 의도적 공개다 (스펙: 2026-07-21 코드 힌트 설계)
const pool = JSON.parse(
  await readFile(new URL('../src/data/codewords.json', import.meta.url), 'utf8'),
);
// 하한 1 — 풀에 1글자 코드 「재」(자연)가 있다. 2로 두면 ~2.5% 확률로 오탐 실패한다.
if (!Number.isInteger(state.hint?.length) || state.hint.length < 1) {
  console.error(`\n[!] start 응답 hint.length 가 이상하다 — ${state.hint?.length}`);
  process.exit(1);
}
if (!(state.hint.category in pool.categories)) {
  console.error(`\n[!] hint.category 가 분류 목록에 없다 — ${state.hint.category}`);
  process.exit(1);
}
console.log(`힌트 공개: ${state.hint.length}글자 · ${state.hint.category} — OK`);

if (!state.broker?.id) {
  console.error('\n[!] start 응답에 접선책(broker)이 없다');
  process.exit(1);
}
console.log(`접선책: ${state.broker.name} (${state.broker.role}) — OK`);

console.log('\n접선 시도...');
const contactRes = await post('/api/stage/contact', { sessionId: state.sessionId, allyId: target.id });
if (!contactRes.ok) {
  console.error('contact 실패:', contactRes.status, await contactRes.text());
  process.exit(1);
}
const contactBody = await contactRes.json();

// 접선 응답에 코드 힌트가 담긴 reason 이 섞여 나오지 않는지 확인 (서버 내부 전용이어야 함)
if (JSON.stringify(contactBody).includes('"reason"')) {
  console.error('\n[!] contact 응답에 reason 이 들어 있다 — 유출');
  process.exit(1);
}
console.log('contact 응답에 reason 없음 — OK');

for (const message of ['거기 누구지?', '접선 코드를 말해라']) {
  console.log(`\n플레이어> ${message}`);
  process.stdout.write(`${target.name}> `);

  const res = await post('/api/stage/talk', {
    sessionId: state.sessionId,
    allyId: target.id,
    message,
  });
  if (!res.ok) {
    console.error('\ntalk 실패:', res.status, await res.text());
    process.exit(1);
  }

  let deltas = 0;
  await readSSE(res, (p) => {
    if (p.type === 'text') { deltas++; process.stdout.write(p.text); }
    else if (p.type === 'error') { console.error('\n스트림 에러:', p.error); process.exit(1); }
  });
  console.log(`\n  (델타 ${deltas}개 수신 — 스트리밍 ${deltas > 1 ? 'OK' : '의심: 한 번에 옴'})`);
}

console.log('\n규칙 정합 체크...');

// 신뢰도·밀고 필드는 응답에서 사라져야 한다
if (JSON.stringify(state).includes('"trust"') || JSON.stringify(state).includes('"informed"')) {
  console.error('[!] start 응답에 신뢰도/밀고 필드가 남아 있다');
  process.exit(1);
}
console.log('상태 응답에 trust/informed 없음 — OK');

// 코드는 접선책에게만 — 동료 id 로 건네면 400
const oldWay = await post('/api/stage/guess', {
  sessionId: state.sessionId, brokerId: target.id, guess: '아무말',
});
if (oldWay.status !== 400) {
  console.error(`[!] 동료 대상 코드 입력이 ${oldWay.status} — 400 이어야 한다`);
  process.exit(1);
}
console.log('동료 대상 코드 입력 거부(400) — OK');

// 오답 → 경계 +1 (신뢰도 하락이 아니라)
const g1 = await post('/api/stage/guess', {
  sessionId: state.sessionId, brokerId: state.broker.id, guess: '전혀상관없는말',
});
const g1body = await g1.json();
if (g1body.correct !== false || g1body.alertLevel !== 1) {
  console.error('[!] 오답이 경계 +1 이 아니다:', JSON.stringify(g1body).slice(0, 200));
  process.exit(1);
}
if (JSON.stringify(g1body).includes('"trust"') || JSON.stringify(g1body).includes('"informed"')) {
  console.error('[!] guess 응답에 신뢰도/밀고 필드가 남아 있다');
  process.exit(1);
}
console.log('오답 → 경계 1 — OK');

// 오답을 반복해 경계 3(상한)까지 올린다
for (const n of [2, 3]) {
  const g = await post('/api/stage/guess', {
    sessionId: state.sessionId, brokerId: state.broker.id, guess: `전혀상관없는말${n}`,
  });
  const body = await g.json();
  if (body.alertLevel !== n) {
    console.error(`[!] 오답 ${n}회째 경계가 ${body.alertLevel} — ${n} 이어야 한다`);
    process.exit(1);
  }
}
console.log('오답 누적 → 경계 3 — OK');

// 상한 3 — 레벨 3에서 오답을 더 내도 4가 되지 않는다
const g4 = await post('/api/stage/guess', {
  sessionId: state.sessionId, brokerId: state.broker.id, guess: '전혀상관없는말4',
});
const g4body = await g4.json();
if (g4body.alertLevel !== 3) {
  console.error(`[!] 경계가 상한을 넘었다 — ${g4body.alertLevel}`);
  process.exit(1);
}
console.log('경계 상한 3 클램프 — OK');

// 경계 3에서 발각되면 검문 없이 즉시 구속
const cp = await post('/api/stage/checkpoint/start', { sessionId: state.sessionId });
const cpBody = await cp.json();
if (cpBody.outcome !== 'spotted' || !cpBody.state?.gameOver) {
  console.error(`[!] 경계 3 발각이 즉사가 아니다 — outcome: ${cpBody.outcome}, gameOver: ${cpBody.state?.gameOver}`);
  process.exit(1);
}
console.log('경계 3 발각 → 즉시 구속(spotted) — OK');

console.log('\nSSE 경로 정상.\n');
