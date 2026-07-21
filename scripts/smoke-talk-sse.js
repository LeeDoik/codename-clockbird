/**
 * 스모크 테스트 — /api/stage/talk 의 SSE 경로가 HTTP 로 실제 동작하는지.
 *
 *   npm run dev:server      (다른 터미널에서 먼저)
 *   npm run smoke
 *
 * poc:talk 은 dialogue.js 만 검증한다. 라우트·SSE 프레이밍·세션 이력·
 * 코드 단어 비유출은 서버를 통해야만 확인되므로 이 스크립트가 따로 있다.
 */
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

console.log('\nSSE 경로 정상.\n');
