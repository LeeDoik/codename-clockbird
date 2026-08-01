import { randomUUID } from 'node:crypto';

/**
 * 스테이지 3 심문 세션 (인메모리).
 *
 * 저택 세션(mansionSession.js)과 겹치는 필드가 없다 — 여기엔 호감도도 의심도도 없고,
 * 대신 **탐지 게이지**와 **로봇의 확신도**가 있다.
 *
 * 이 파일이 쥐고 클라이언트로 내보내지 않는 것:
 *   - `confidence` — 로봇이 얼마나 좁혔는가. 보이면 플레이어가 추리 선언 타이밍을
 *     정확히 읽어, 그 직전에만 말을 아끼는 최적해가 생긴다
 *   - `contradictionForgiven` — 첫 모순 사면을 이미 썼는가
 *   - `history` — 심문 이력 원문 (프롬프트 재료)
 *
 * `DECLARE_THRESHOLD` 와 `declaresLeft` 는 이 파일에서는 아직 쓰이지 않는다 — 확신도가
 * 임계에 닿았을 때 로봇이 정식 추리를 선언하는 로직은 이후 태스크(HTTP 라우트)가 담당한다.
 */
const sessions = new Map();

/** 이 문항 수를 방어하면 승리 */
export const QUESTION_MAX = 8;
/** 탐지 게이지는 100 에서 시작해 내려가고 0 에서 터진다 (탈출의 발각 게이지와 방향이 반대다) */
export const DETECTION_START = 100;
/** 선택 단어와 어긋난 거짓 진술 */
export const PENALTY_LIE = 20;
/** 선택 단어를 직접 노출 — 거짓도, 지나친 진실도 위험해야 한다 */
export const PENALTY_REVEAL = 20;
/** 이전 답변과 명시적으로 상충. 첫 회는 사면된다 */
export const PENALTY_CONTRADICTION = 50;
/** 로봇이 정식 추리를 선언하는 확신도 */
export const DECLARE_THRESHOLD = 70;
/** 추리 선언 횟수 상한 */
export const DECLARE_MAX = 2;

/** 배열에서 서로 다른 n 개를 뽑는다 */
function sample(list, n) {
  const pool = [...list];
  const out = [];
  while (out.length < n && pool.length) {
    out.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
  }
  return out;
}

export function createEscapeSession({ identities }) {
  const id = randomUUID();
  sessions.set(id, {
    id,
    /** 플레이어에게 보여 줄 신분 카드 3장 */
    choices: sample(identities, 3),
    /** 플레이어가 고른 신분. 고르기 전에는 null */
    identity: null,
    detection: DETECTION_START,
    /** 지금까지 던진 질문 수 */
    asked: 0,
    /** [{ question, answer }] — 로봇 판정의 재료 */
    history: [],
    /** 첫 모순 사면을 이미 썼는가 */
    contradictionForgiven: false,
    /** 로봇의 확신도. 매 턴 갱신하되 **최댓값을 유지**한다 (단조 증가) */
    confidence: 0,
    declaresLeft: DECLARE_MAX,
    /** 'win' | 'lose' | null(진행 중) */
    outcome: null,
    createdAt: Date.now(),
  });
  return id;
}

export const getEscapeSession = (id) => sessions.get(id);

/** 신분 카드를 고른다. 목록에 없는 id 는 거절한다 — 클라이언트가 임의 단어를 못 세운다. */
export function chooseIdentity(session, identityId) {
  const found = session.choices.find((c) => c.id === identityId);
  if (!found) return false;
  session.identity = found;
  return true;
}

/**
 * 클라이언트로 내보내도 안전한 형태 — 화이트리스트다.
 * npc 객체에 나중에 어떤 필드가 붙어도 자동으로 새지 않는다 (mansionSession.toMansionView 와 같은 원칙).
 */
export function toEscapeView(session) {
  return {
    sessionId: session.id,
    choices: session.choices.map((c) => ({ id: c.id, word: c.word })),
    identity: session.identity ? { id: session.identity.id, word: session.identity.word } : null,
    detection: session.detection,
    asked: session.asked,
    questionMax: QUESTION_MAX,
    declaresLeft: session.declaresLeft,
    outcome: session.outcome,
  };
}

/** 심문 이력에 한 턴 추가 */
export function pushEscapeTurn(session, question, answer) {
  session.history.push({ question, answer });
  session.asked += 1;
}

/**
 * 두 판정 결과를 게이지에 반영한다.
 *
 * @param {{lie: boolean, reveal: boolean, contradiction: boolean, confidence: number}} verdict
 * @returns {{events: string[]}} 클라이언트가 연출할 사건 목록
 */
export function applyVerdict(session, { lie, reveal, contradiction, confidence }) {
  const events = [];

  if (lie) {
    session.detection -= PENALTY_LIE;
    events.push('lie');
  }
  if (reveal) {
    session.detection -= PENALTY_REVEAL;
    events.push('reveal');
  }
  if (contradiction) {
    if (session.contradictionForgiven) {
      session.detection -= PENALTY_CONTRADICTION;
      events.push('contradiction');
    } else {
      // 첫 모순은 로봇이 지적하고 해명 기회를 준다 — LLM 오탐 1회를 규칙이 흡수하면서
      // 동시에 긴장 연출이 된다 (계획서 §4.5).
      session.contradictionForgiven = true;
      events.push('contradiction-forgiven');
    }
  }

  // 확신도는 최댓값을 유지한다. 턴마다 출렁이게 두면 선언 타이밍이 운에 좌우된다.
  if (Number.isFinite(confidence)) {
    session.confidence = Math.max(session.confidence, Math.min(100, Math.max(0, confidence)));
  }

  session.detection = Math.max(0, session.detection);
  if (session.detection === 0) {
    session.outcome = 'lose';
    events.push('detected');
  }

  return { events };
}
