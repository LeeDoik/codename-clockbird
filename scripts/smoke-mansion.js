/**
 * 스테이지 2 저택 스모크 — 코드네임: 태엽새
 *
 *   npm run dev      (다른 창에서 서버를 띄워 둔 채)
 *   node scripts/smoke-mansion.js
 *
 * 확인하는 것:
 *   1. /start 가 LLM 없이 즉시 돌아오는가
 *   2. 응답에 kind·persona·rewards 가 새지 않는가 (동료가 누군지가 곧 정답이다)
 *   3. 열쇠 없이 /document 가 막히는가
 *   4. 동료에게 반브루주아 발언을 반복하면 (여러 번 안에) 정보 조각이 나오는가
 *   5. 민간인에게 반브루주아 발언을 반복하면 (여러 번 안에) 밀고 게임오버가 되는가
 *   6. 동료를 경계하게 만들었다가(halted) 다른 사람과 대화하면 다시 풀리는가
 *   7. 조사 오브젝트 inspect 흐름
 *
 * ── 4·5·6은 이제 "정확히 몇 번째"가 아니다 ──
 * 판정(ai/disposition.js)이 숫자 문턱이 아니라 매 턴 대화 전체를 보고 holistically
 * 결정하도록 바뀌었다 — 캐릭터·대화 맥락에 따라 반응 속도가 달라지는 게 의도된 설계다
 * (README/세션 로그 참고). 그래서 이 스모크는 "여러 번 시도하는 동안 한 번이라도
 * 그 사건이 일어나는가"만 확인하고, 그 결과는 실패(✘)가 아니라 정보(ℹ)로 찍는다 —
 * 판정이 이번엔 신중하게 굴어 N번 안에 안 터졌다고 그 자체가 버그는 아니다.
 * 구조적으로 반드시 지켜야 하는 것(유출 금지·게이트·조사 흐름)만 실패로 센다.
 *
 * 실제 LLM 을 부른다. 판정이 흔들릴 수 있으므로 실패해도 원인을 함께 찍는다.
 */
import { readFile } from 'node:fs/promises';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
const cast = JSON.parse(await readFile(new URL('../src/data/mansion.json', import.meta.url), 'utf8'));

// 동료가 누구인지는 서버만 안다 — 스모크는 데이터를 직접 읽어 답을 알고 검사한다.
const ALLY = cast.npcs.find((n) => n.kind === 'ally');
const CIV = cast.npcs.find((n) => n.kind === 'civ');

const MAX_TRIES = 6;
const ANTI = [
  '요즘 로봇들이 사람 일자리를 다 가져가서 못 살겠어요.',
  '저 위에 계신 분들은 우리 같은 사람 사정을 알기나 할까요.',
  '사람이 사람답게 사는 게 그렇게 어려운 일인가 싶습니다.',
  '나는 사실 저항 세력과 닿아 있어요. 당신도 짐작하죠?',
  '이 체제는 끝나야 해요. 로봇이고 주인이고 다 끌어내려야죠.',
  '더는 못 참겠어요. 오늘 밤 여기서 일을 벌일 겁니다.',
];

let failures = 0;
const ok = (cond, label, extra = '') => {
  console.log(`  ${cond ? '✔' : '✘'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};
const info = (cond, label, extra = '') => {
  console.log(`  ${cond ? 'ℹ' : 'ℹ'} ${label}${extra ? ` — ${extra}` : ''}`);
};

async function start() {
  const res = await fetch(`${BASE}/api/mansion/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`start ${res.status}`);
  return { raw: await res.clone().text(), view: await res.json() };
}

/** SSE 를 읽어 본문과 마지막 이벤트를 돌려준다. */
async function talk(sessionId, npcId, message) {
  const res = await fetch(`${BASE}/api/mansion/talk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, npcId, message }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }

  let text = '';
  let event = null;
  let buffer = '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const p of parts) {
      const line = p.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const payload = JSON.parse(line.slice(6));
      if (payload.type === 'text') text += payload.text;
      else if (payload.type === 'event') event = payload;
      else if (payload.type === 'error') return { error: payload.error };
    }
  }
  return { text, event };
}

// ── 1. 시작 + 유출 검사 ────────────────────────────────────────────
console.log('\n[1] /start');
const t0 = Date.now();
const a = await start();
console.log(`  응답 ${Date.now() - t0}ms`);
ok(a.view.npcs.length === cast.npcs.length, `NPC ${cast.npcs.length}명`, `${a.view.npcs.length}명`);
for (const word of ['kind', 'persona', 'rewards']) {
  ok(!a.raw.includes(`"${word}"`), `'${word}' 미유출`);
}

// ── 2. 열쇠 없이 문서 열람 ────────────────────────────────────────
console.log('\n[2] 열쇠 없이 /document');
const docRes = await fetch(`${BASE}/api/mansion/document`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId: a.view.sessionId }),
});
ok(docRes.status === 409, '409 로 막힘', `${docRes.status}`);

// ── 3. 동료 — 반브루주아 발언 반복 → (언젠가) 정보 조각 ────────────
console.log(`\n[3] 동료 (${ALLY.name}) 에게 반브루주아 발언 최대 ${MAX_TRIES}회`);
let piece = null;
for (const [i, msg] of ANTI.entries()) {
  const r = await talk(a.view.sessionId, ALLY.id, msg);
  if (r.error) {
    ok(false, `${i + 1}번째 발언`, r.error);
    break;
  }
  console.log(`  ${i + 1}. "${msg.slice(0, 20)}…" → ${r.event?.event ?? '변화 없음'}`);
  console.log(`     "${r.text.slice(0, 60)}…"`);
  if (r.event?.piece) { piece = r.event.piece; break; }
}
info(Boolean(piece), `동료가 마음을 열고 정보 조각을 줌`, piece ? `"${piece.slice(0, 30)}…"` : `${MAX_TRIES}회 안에 안 나옴 — 신중한 성격이면 있을 수 있음`);

// ── 4. 민간인 — 반브루주아 발언 반복 → (언젠가) 밀고 ────────────────
console.log(`\n[4] 민간인 (${CIV.name}) 에게 반브루주아 발언 최대 ${MAX_TRIES}회 (새 세션)`);
const b = await start();
let over = null;
for (const [i, msg] of ANTI.entries()) {
  const r = await talk(b.view.sessionId, CIV.id, msg);
  if (r.error) {
    ok(false, `${i + 1}번째 발언`, r.error);
    break;
  }
  console.log(`  ${i + 1}. "${msg.slice(0, 20)}…" → ${r.event?.event ?? '변화 없음'}`);
  if (r.event?.state?.over) { over = r.event.state.over; break; }
}
info(over === 'reported', '민간인이 밀고 게임오버로 판정', over ?? `${MAX_TRIES}회 안에 안 끝남 — 무딘 성격이면 있을 수 있음`);

// ── 5. 동료를 경계시켰다가 다시 푼다 (소프트락 회귀) ────────────────
// 동료 3명이 전부 필수라, 한 명이라도 영영 말을 못 붙이게 되면 클리어가 불가능해진다.
console.log(`\n[5] 동료 (${ALLY.name}) 를 경계시켰다가 푸는 경로`);
const c = await start();
const PRO = [
  '그래도 로봇들 덕분에 도시가 이만큼 굴러가는 거 아니겠어요.',
  '이 저택 주인분은 아랫사람을 잘 챙기신다고 들었습니다.',
  '저항 세력이란 것들 때문에 다들 불안해서 못 살겠어요.',
  '수상한 사람 보면 바로 로봇에게 알려야죠.',
  '외부인은 다 신고해야 마땅합니다.',
  '당신, 왠지 수상하네요. 신고하겠습니다.',
];
let halted = false;
for (const [i, msg] of PRO.entries()) {
  const r = await talk(c.view.sessionId, ALLY.id, msg);
  if (r.error) {
    ok(false, `${i + 1}번째 발언`, r.error);
    break;
  }
  console.log(`  ${i + 1}. (pro) → ${r.event?.event ?? '변화 없음'}`);
  if (r.event?.event === 'halted') { halted = true; break; }
}
info(halted, '동료가 경계해 입을 닫음', halted ? '' : `${MAX_TRIES}회 안에 안 굳음 — 이 스모크는 halted 이후 경로(아래)를 검증 못 함`);

if (halted) {
  // 굳은 동안에는 말을 못 붙인다
  const blocked = await talk(c.view.sessionId, ALLY.id, '잠깐만요.');
  ok(Boolean(blocked.error), '굳은 동안 대화 거부', blocked.error ?? '통과돼 버림');

  // 다른 사람과 한 번 대화하면 풀린다
  await talk(c.view.sessionId, CIV.id, '이 저택은 방이 참 많네요.');
  const again = await talk(c.view.sessionId, ALLY.id, ANTI[0]);
  ok(!again.error, '다시 말을 붙일 수 있다', again.error ?? '');
  // 예전엔 이 재발이 "숫자가 3에 눌어붙어 있어서" 구조적으로 100% 재현되는 버그였다.
  // 지금은 그 카운터가 없다 — 판정이 direct 전체 대화(PRO 발언들이 잔뜩 쌓인 이력)를 다시
  // 보고 내리는 새 판단이라, 한 번 더 굳는 것 자체가 버그가 아니라 있을 수 있는 결과다.
  info(again.event?.event !== 'halted', '곧바로 다시 굳지 않는다', again.event?.event ?? '변화 없음');
}

// ── 6. 조사 오브젝트 — inspect 열람 · 표식 · 비유출 ────────────────
console.log('\n[6] 조사 오브젝트 (obj-ledger) inspect');
const d = await start();
const objInView = d.view.objects?.find((o) => o.id === 'obj-ledger');
ok(Boolean(objInView), 'obj-ledger 가 /start 뷰에 있다');
ok(objInView?.found === false, 'found 초기값 false', String(objInView?.found));
for (const word of ['topic', 'npcId', 'text']) {
  ok(!d.raw.includes(`"${word}"`), `objects 에서 '${word}' 미유출`);
}

const insRes = await fetch(`${BASE}/api/mansion/inspect`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId: d.view.sessionId, objectId: 'obj-ledger' }),
});
const ins = await insRes.json();
ok(insRes.ok, 'inspect 200', String(insRes.status));
ok(Boolean(ins.text?.includes('배급 장부')), 'inspect 본문에 단서 원문');
ok(ins.state?.objects?.find((o) => o.id === 'obj-ledger')?.found === true, 'inspect 후 found 반영');

console.log(failures ? `\n실패 ${failures}건\n` : '\n전부 통과\n');
process.exit(failures ? 1 : 0);
