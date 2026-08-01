/**
 * escapeSession.js 결정론적 정적 검사 — 코드네임: 태엽새
 *
 *   node scripts/check-escape-session.js
 *
 * check-spawn-safety.js 와 같은 방식: 서버·네트워크·LLM 을 전혀 쓰지 않는다.
 * escapeSession.js 는 순수 모듈(node:crypto 만 import)이라 여기서 결정론적으로
 * 검사할 수 있다. 모순 판정(설계서 §6 "모순 첫 회 사면 후 2회차 −50")은 실제로는
 * LLM 이 내리는 판정이지만, 그 판정을 받은 **뒤의** 감점 산술·사면·확신도 단조 증가는
 * 순수 함수라 스모크(smoke-escape.js, LLM 이 흔들릴 수 있다)가 아니라 여기서 못박는다.
 */
import { readFile } from 'node:fs/promises';
import {
  createEscapeSession,
  getEscapeSession,
  chooseIdentity,
  toEscapeView,
  pushEscapeTurn,
  applyVerdict,
  DETECTION_START,
  PENALTY_LIE,
  PENALTY_REVEAL,
  PENALTY_CONTRADICTION,
} from '../src/server/escapeSession.js';

let failures = 0;
const ok = (cond, label, extra = '') => {
  console.log(`  ${cond ? '✔' : '✘'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const identities = JSON.parse(
  await readFile(new URL('../src/data/escape.json', import.meta.url), 'utf8'),
).identities;
const mk = (pool = identities) => getEscapeSession(createEscapeSession({ identities: pool }));

// ── 1. 카드 3장, 중복 없음, 풀보다 많이 요구하지 않는다 ────────────
console.log('\n[1] createEscapeSession — 카드 뽑기');
{
  const s = mk();
  ok(s.choices.length === 3, '카드 3장', `${s.choices.length}장`);
  ok(new Set(s.choices.map((c) => c.id)).size === 3, '중복 없음');

  const s2 = mk(identities.slice(0, 2)); // 풀이 2개뿐인 경우
  ok(s2.choices.length === 2, '풀보다 많이 요구하지 않는다 (풀 2개 → 카드 2장)', `${s2.choices.length}장`);
}

// ── 2. chooseIdentity — 제시된 카드만 수락, 목록 밖은 거절 ─────────
console.log('\n[2] chooseIdentity');
{
  const s = mk();
  const outsideId = identities.find((i) => !s.choices.some((c) => c.id === i.id))?.id;
  ok(chooseIdentity(s, outsideId) === false, '목록 밖 id 거절', outsideId);
  ok(s.identity === null, '거절 후에도 identity 는 null');

  const pick = s.choices[1];
  ok(chooseIdentity(s, pick.id) === true, '제시된 카드 중 하나는 수락', pick.id);
  ok(s.identity?.id === pick.id, 'identity 가 고른 카드로 세워진다');
}

// ── 3. toEscapeView — 화이트리스트 (confidence/contradictionForgiven/history 미유출) ──
console.log('\n[3] toEscapeView — 화이트리스트');
{
  const s = mk();
  chooseIdentity(s, s.choices[0].id);
  pushEscapeTurn(s, '오늘 몇 시에 왔나?', '아침 일찍요.');
  applyVerdict(s, { lie: false, reveal: false, contradiction: true, confidence: 55 });
  const raw = JSON.stringify(toEscapeView(s));
  for (const word of ['confidence', 'contradictionForgiven', 'history']) {
    ok(!raw.includes(`"${word}"`), `'${word}' 미유출`);
  }
}

// ── 4. applyVerdict — 거짓/노출 감점 ────────────────────────────────
console.log('\n[4] applyVerdict — 거짓 −20 / 노출 −20 / 둘 다 −40');
{
  const s1 = mk();
  applyVerdict(s1, { lie: true, reveal: false, contradiction: false, confidence: 0 });
  ok(s1.detection === DETECTION_START - PENALTY_LIE, `거짓만 −${PENALTY_LIE}`, String(s1.detection));

  const s2 = mk();
  applyVerdict(s2, { lie: false, reveal: true, contradiction: false, confidence: 0 });
  ok(s2.detection === DETECTION_START - PENALTY_REVEAL, `노출만 −${PENALTY_REVEAL}`, String(s2.detection));

  const s3 = mk();
  applyVerdict(s3, { lie: true, reveal: true, contradiction: false, confidence: 0 });
  ok(
    s3.detection === DETECTION_START - PENALTY_LIE - PENALTY_REVEAL,
    `둘 다 −${PENALTY_LIE + PENALTY_REVEAL}`,
    String(s3.detection),
  );
}

// ── 5. 모순 첫 회 사면, 2회차부터 감점 (설계서 §6) ─────────────────
console.log('\n[5] applyVerdict — 모순 첫 회 사면 후 2회차부터 −50 (설계서 §6)');
{
  const s = mk();
  const r1 = applyVerdict(s, { lie: false, reveal: false, contradiction: true, confidence: 0 });
  ok(s.detection === DETECTION_START, '1회차 감점 0', String(s.detection));
  ok(r1.events.includes('contradiction-forgiven'), "1회차 이벤트 'contradiction-forgiven'", r1.events.join(','));
  ok(s.contradictionForgiven === true, '사면 플래그가 세워진다');

  const before = s.detection;
  const r2 = applyVerdict(s, { lie: false, reveal: false, contradiction: true, confidence: 0 });
  ok(s.detection === before - PENALTY_CONTRADICTION, `2회차 −${PENALTY_CONTRADICTION}`, String(s.detection));
  ok(r2.events.includes('contradiction'), "2회차 이벤트 'contradiction'", r2.events.join(','));
}

// ── 6. 게이지 0 하한 + 패배 판정 ───────────────────────────────────
console.log('\n[6] applyVerdict — 게이지 0 하한 + 패배 판정');
{
  const s = mk();
  s.detection = 10; // 하한 근처로 미리 낮춰 두고 확인
  const r = applyVerdict(s, { lie: true, reveal: false, contradiction: false, confidence: 0 }); // -20
  ok(s.detection === 0, '0 밑으로 안 내려간다 (10 − 20 → 0)', String(s.detection));
  ok(s.outcome === 'lose', "outcome === 'lose'");
  ok(r.events.includes('detected'), "이벤트 'detected'", r.events.join(','));

  applyVerdict(s, { lie: false, reveal: true, contradiction: false, confidence: 0 });
  ok(s.detection === 0, '패배 이후에도 0 유지', String(s.detection));
}

// ── 7. 확신도 단조 증가 + 0~100 클램프 ─────────────────────────────
console.log('\n[7] applyVerdict — 확신도 단조 증가 + 0~100 클램프');
{
  const s = mk();
  applyVerdict(s, { lie: false, reveal: false, contradiction: false, confidence: 80 });
  ok(s.confidence === 80, '80 반영', String(s.confidence));
  applyVerdict(s, { lie: false, reveal: false, contradiction: false, confidence: 30 });
  ok(s.confidence === 80, '더 낮은 값은 무시된다 (단조 증가)', String(s.confidence));

  const s2 = mk();
  applyVerdict(s2, { lie: false, reveal: false, contradiction: false, confidence: -50 });
  ok(s2.confidence === 0, '음수는 0으로 잠긴다', String(s2.confidence));
  applyVerdict(s2, { lie: false, reveal: false, contradiction: false, confidence: 120 });
  ok(s2.confidence === 100, '100 초과는 100으로 잠긴다', String(s2.confidence));
}

// ── 8. pushEscapeTurn — asked 증가 + 이력 적재 ─────────────────────
console.log('\n[8] pushEscapeTurn');
{
  const s = mk();
  ok(s.asked === 0 && s.history.length === 0, '초기값 0');
  pushEscapeTurn(s, '질문1', '답변1');
  ok(s.asked === 1, 'asked 증가', String(s.asked));
  ok(s.history.length === 1, '이력 1건 적재', String(s.history.length));
  ok(s.history[0].question === '질문1' && s.history[0].answer === '답변1', '이력 내용 일치');
  pushEscapeTurn(s, '질문2', '답변2');
  ok(s.asked === 2 && s.history.length === 2, '두 번째 턴 누적', `asked=${s.asked}, history=${s.history.length}`);
}

console.log(failures ? `\n실패 ${failures}건\n` : '\n전부 통과\n');
process.exit(failures ? 1 : 0);
