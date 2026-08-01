/**
 * 스테이지 3 심문 스모크 — 코드네임: 태엽새
 *
 *   npm run dev      (다른 창에서 서버를 띄워 둔 채)
 *   node scripts/smoke-escape.js
 *
 * 확인하는 것:
 *   1. /start 가 신분 카드 3장을 주고, 로봇의 확신도는 새지 않는가
 *   2. 신분을 고르면 탐지 게이지 100에서 심문이 시작되는가
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

console.log(failures ? `\n실패 ${failures}건\n` : '\n전부 통과\n');
process.exit(failures ? 1 : 0);
