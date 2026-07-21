import { randomUUID } from 'node:crypto';

/**
 * 튜토리얼 세션 (인메모리).
 *
 * 스테이지 세션(session.js)과 분리한 이유: 경계 레벨·체포·중복 판정·검문이 여기엔 없고,
 * 대신 신뢰도와 세트 교체가 있다. 필드가 거의 겹치지 않아 한 구조에 밀어 넣으면
 * 양쪽 모두 죽은 필드를 달고 다니게 된다.
 *
 * 접선 코드 단어는 여기에만 있다 — 클라이언트로는 클리어 시에만 내려간다.
 */
const sessions = new Map();

/** NPC별 초기 신뢰도 (스토리보드 p.11) */
const TRUST_MAX = 2;
/** 이 횟수만큼 틀리면 간부가 코드를 갈아 치운다 */
const FAILS_PER_SET = 3;

export function createTutorialSession({ allies, officer, sets }) {
  const id = randomUUID();
  sessions.set(id, {
    id,
    officer,
    sets,
    setIndex: 0,
    failCount: 0,
    cleared: false,
    allies: allies.map((a) => ({ ...a, trust: TRUST_MAX, history: [] })),
    createdAt: Date.now(),
  });
  return id;
}

export function getTutorialSession(id) {
  return sessions.get(id);
}

export function currentSet(session) {
  return session.sets[session.setIndex];
}

export function getTutorialAlly(session, allyId) {
  return session.allies.find((a) => a.id === allyId);
}

/**
 * 클라이언트로 내보내도 안전한 형태.
 *
 * codeWord 는 나가지 않는다. reason(강화 힌트)은 그 동료의 신뢰도가 0 일 때만 line 자리를
 * 대신한다 — 규칙이 열어 준 정보만 내려보낸다는 뜻이고, 필드 이름을 바꿔 담으므로
 * "reason 이라는 글자가 응답에 있으면 유출"이라는 스모크 검사가 그대로 성립한다.
 */
export function toTutorialView(session) {
  const set = currentSet(session);
  return {
    sessionId: session.id,
    officer: session.officer,
    cleared: session.cleared,
    allies: session.allies.map((a) => {
      const hint = set.hints[a.id];
      const opened = a.trust === 0;
      return {
        id: a.id,
        name: a.name,
        role: a.role,
        axis: a.axis,
        trust: a.trust,
        line: opened ? hint.reason : hint.line,
        // 강화 힌트가 열렸는가 — 클라이언트가 연출을 바꾸는 데만 쓴다 (내용은 line 에 있다).
        opened,
      };
    }),
  };
}

/**
 * 코드 오답.
 *
 * 동료 전원의 신뢰도가 1씩 깎이고, 3회마다 간부가 코드를 갈아 치운다. 힌트 단계(2회)와
 * 리셋 단계(3회)를 분리해야 신뢰도 0 의 강화 힌트를 써볼 기회가 생긴다 — 합치면
 * 두 장치 중 하나가 죽는다 (스토리보드 수정안 p.11).
 *
 * @returns {{ replaced: boolean }}
 */
export function failGuess(session) {
  session.failCount += 1;
  for (const a of session.allies) a.trust = Math.max(0, a.trust - 1);

  if (session.failCount % FAILS_PER_SET !== 0) return { replaced: false };

  session.setIndex = (session.setIndex + 1) % session.sets.length;
  for (const a of session.allies) {
    a.trust = TRUST_MAX;
    // 이력도 비운다 — 이전 코드의 단어를 기억한 채로 새 세트를 말하면 대화가 앞뒤로 어긋난다.
    a.history = [];
  }
  return { replaced: true };
}

/** 대화 이력에 한 턴 추가 */
export function pushTutorialDialogue(session, allyId, role, content) {
  const ally = getTutorialAlly(session, allyId);
  if (ally) ally.history.push({ role, content });
}
