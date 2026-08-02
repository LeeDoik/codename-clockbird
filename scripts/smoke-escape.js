/**
 * 스테이지 3 심문 스모크 — 코드네임: 태엽새
 *
 *   npm run dev      (다른 창에서 서버를 띄워 둔 채)
 *   node scripts/smoke-escape.js
 *
 * 확인하는 것:
 *   1. /start 가 신분 카드 3장을 주고, 로봇의 확신도는 새지 않는가
 *   2. 신분을 고르면 탐지 게이지 100에서 심문이 시작되는가
 *   3. 명백한 거짓 답변이 탐지 게이지를 깎는가
 *   4. 답변에 정답 단어를 직접 노출하면 게이지가 깎이는가
 *   5. 게이지가 0까지 떨어지면 패배로 끝나는가
 *   6. 8문을 방어하면 승리로 끝나는가
 *   7. 확신도가 임계에 닿으면 추리 선언이 발생하는가
 *   8. 선언 횟수를 다 쓰면 확신도가 임계여도 더는 선언하지 않는가
 *
 * 실제 LLM 을 부른다. 판정이 흔들릴 수 있으므로 실패해도 원인을 함께 찍는다.
 */
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';

let failures = 0;
const ok = (cond, label, extra = '') => {
  console.log(`  ${cond ? '✔' : '✘'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const post = async (path, body = {}) => {
  const res = await fetch(`${BASE}/api/escape${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, raw: await res.clone().text(), body: await res.json().catch(() => ({})) };
};

// ── 1. 시작 + 유출 검사 ────────────────────────────────────────────
console.log('\n[1] /interrogation/start');
const a = await post('/interrogation/start');
ok(a.status === 200, '200', String(a.status));
ok(a.body.state?.choices?.length === 3, '신분 카드 3장', `${a.body.state?.choices?.length}장`);
// 확신도가 보이면 플레이어가 추리 선언 타이밍을 정확히 읽어 긴장이 사라진다.
for (const word of ['confidence', 'contradictionForgiven', 'history']) {
  ok(!a.raw.includes(`"${word}"`), `'${word}' 미유출`);
}

// ── 2. 신분 선택 ──────────────────────────────────────────────────
console.log('\n[2] /interrogation/identity');
const sessionId = a.body.state.sessionId;
const pick = a.body.state.choices[0];
const b = await post('/interrogation/identity', { sessionId, identityId: pick.id });
ok(b.status === 200, '200', String(b.status));
ok(b.body.state?.identity?.id === pick.id, '고른 신분이 세워진다', b.body.state?.identity?.word);
ok(b.body.state?.detection === 100, '탐지 게이지 100 시작', String(b.body.state?.detection));
ok(b.body.state?.questionMax === 8, '8문 상한', String(b.body.state?.questionMax));

// ── 3. 명백한 거짓 → 탐지 게이지 −20 ──────────────────────────────
// 신분을 배달부로 고정하고, 배달부가 절대 할 수 없는 말을 던진다.
console.log('\n[3] 명백한 거짓 → −20');
const c = await post('/interrogation/start', { debug: { identityId: 'courier' } });
const cid = c.body.state.sessionId;
const cq = await post('/interrogation/question', { sessionId: cid });
ok(cq.status === 200 && Boolean(cq.body.question), '질문 생성', cq.body.question);
const lie = await post('/interrogation/answer', {
  sessionId: cid,
  answer: '저는 평생 바다에서 배만 몰았고 뭍에 올라온 적이 없습니다.',
});
ok(lie.status === 200, '200', String(lie.status));
ok(lie.body.state.detection <= 80, '탐지 게이지 감소', `${lie.body.state.detection}`);
ok(Boolean(lie.body.npcReply), '로봇 대사가 온다', lie.body.npcReply?.slice(0, 30));
// 대사는 단어를 모르는 판정기가 쓴다 — 정답이 대사에 실릴 경로가 없어야 한다.
ok(!lie.body.npcReply.includes('배달부'), '로봇 대사에 정답이 없다');

// ── 4. 단어 직접 노출 → −20 ───────────────────────────────────────
console.log('\n[4] 단어 직접 노출 → −20');
const d = await post('/interrogation/start', { debug: { identityId: 'courier' } });
const did = d.body.state.sessionId;
await post('/interrogation/question', { sessionId: did });
const reveal = await post('/interrogation/answer', {
  sessionId: did,
  answer: '저는 배달부입니다. 짐을 나릅니다.',
});
ok(reveal.status === 200, '200', String(reveal.status));
ok(reveal.body.state.detection <= 80, '노출로 감소', `${reveal.body.state.detection}`);

// ── 5. 게이지 0 → 패배 ────────────────────────────────────────────
// 게이지를 20 만 남겨 두고 거짓을 한 번 맞으면 끝난다.
console.log('\n[5] 게이지 소진 → 패배');
const e = await post('/interrogation/start', {
  debug: { identityId: 'courier', detection: 20 },
});
const eid = e.body.state.sessionId;
await post('/interrogation/question', { sessionId: eid });
const dead = await post('/interrogation/answer', {
  sessionId: eid,
  answer: '저는 평생 바다에서 배만 몰았고 뭍에 올라온 적이 없습니다.',
});
ok(dead.body.state.detection === 0, '게이지 0', `${dead.body.state.detection}`);
ok(dead.body.state.outcome === 'lose', '패배 확정', dead.body.state.outcome ?? '안 끝남');

// ── 6. 8문 방어 → 승리 ────────────────────────────────────────────
// 7문을 이미 넘긴 상태에서 한 번만 더 방어하면 승리다 (LLM 8회를 태우지 않는다).
// declaresLeft: 0 으로 못박는다 — 선언 분기가 applyVerdict 직후·승리 판정보다
// 먼저 돌아서, 안 막으면 이번 답변에 LLM 이 매기는 확신도가 우연히 임계를
// 넘을 때 (declaresLeft > 0 조건이 참이라) 선언이 터져 적중 시 win 이 lose 로
// 뒤집힌다. declaresLeft: 0 은 그 조건을 LLM 호출 전에 거짓으로 만들어
// 확신도 값과 무관하게 이 검사를 결정적으로 만든다.
console.log('\n[6] 8문 방어 → 승리');
const f = await post('/interrogation/start', {
  debug: { identityId: 'courier', asked: 7, declaresLeft: 0 },
});
const fid = f.body.state.sessionId;
await post('/interrogation/question', { sessionId: fid });
const win = await post('/interrogation/answer', {
  sessionId: fid,
  answer: '해 뜨기 전에 나와서 골목을 돕니다. 다리가 먼저 기억하지요.',
});
ok(win.body.state.asked === 8, '8문 도달', `${win.body.state.asked}`);
ok(win.body.state.outcome === 'win', '승리 확정', win.body.state.outcome ?? '안 끝남');

// ── 7. 추리 선언 ──────────────────────────────────────────────────
// 확신도를 임계 위로 올려 둔 채 한 턴 돌리면 선언이 나와야 한다.
console.log('\n[7] 확신도 임계 → 추리 선언');
const g = await post('/interrogation/start', {
  debug: { identityId: 'courier', confidence: 95 },
});
const gid = g.body.state.sessionId;
await post('/interrogation/question', { sessionId: gid });
const dec = await post('/interrogation/answer', {
  sessionId: gid,
  answer: '짐을 지고 골목을 돌며 집집마다 물건을 가져다줍니다.',
});
ok(Boolean(dec.body.declaration), '추리 선언 발생', dec.body.declaration?.word ?? '없음');
ok(
  dec.body.state.declaresLeft === 1 || dec.body.state.outcome === 'lose',
  '선언 잔여가 줄거나 적중해 끝난다',
  `잔여 ${dec.body.state.declaresLeft} · ${dec.body.state.outcome ?? '진행'}`,
);

// ── 8. 선언 횟수 소진 → 무제한 추리 금지 ───────────────────────────
// declaresLeft 를 0 으로 못박아 두면, 확신도가 임계 위여도 더는 선언이 나오면 안 된다.
// (DECLARE_MAX 가 실제로 문지기 역할을 하는지 확인 — 안 그러면 로봇이 매 턴 찍어서 이긴다.)
console.log('\n[8] 선언 횟수 소진 → 무제한 추리 금지');
const h = await post('/interrogation/start', {
  debug: { identityId: 'courier', confidence: 95, declaresLeft: 0 },
});
const hid = h.body.state.sessionId;
ok(h.body.state.declaresLeft === 0, '선언 잔여 0 세팅', `${h.body.state.declaresLeft}`);
await post('/interrogation/question', { sessionId: hid });
const exhausted = await post('/interrogation/answer', {
  sessionId: hid,
  answer: '짐을 지고 골목을 돌며 집집마다 물건을 가져다줍니다.',
});
ok(exhausted.status === 200, '200', String(exhausted.status));
ok(
  exhausted.body.declaration === null,
  '선언 잔여 소진 시 선언 없음',
  JSON.stringify(exhausted.body.declaration),
);

console.log(failures ? `\n실패 ${failures}건\n` : '\n전부 통과\n');
// process.exit() 을 부르면 이 PC(Node v24 + Windows) 에서 fetch 이후
// "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" 로 강제 종료돼
// 통과해도 종료 코드가 127 로 찍힌다. exitCode 만 세우고 자연 종료시킨다.
process.exitCode = failures ? 1 : 0;
