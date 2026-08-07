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
 *   - `lieCount` — 몇 번째 거짓인지. 수치가 보이면 "한 번은 더 봐준다"는 계산이 서서
 *     오히려 대담해진다
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
/** 선택 단어를 직접 노출 — 거짓도, 지나친 진실도 위험해야 한다 */
export const PENALTY_REVEAL = 20;
/**
 * 거짓 진술 허용 횟수 — 첫 번째는 경고만, 두 번째부터 그 자리에서 패배다
 * (2026-08-07 기획: "봐주는 건 한 번뿐"이 명확한 규칙이어야 한다는 피드백 —
 * 예전의 탐지 게이지 감점만으로는 몇 번까지 봐주는지 눈에 안 읽혔다).
 */
export const LIE_MAX = 2;
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
    /** 지금까지의 거짓 진술 횟수 — LIE_MAX 에 닿으면 패배 (첫 회는 경고만) */
    lieCount: 0,
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
 * 거짓·모순은 이제 게이지가 아니라 **횟수/즉시 패배**로 정해진다(2026-08-07 기획):
 *   - 거짓은 첫 번째까지 경고, 두 번째부터 그 자리에서 패배.
 *   - 모순은 한 번이라도 나오면 그 자리에서 패배 — 사면 없음.
 * 탐지 게이지는 이제 노출(reveal)만의 몫이다(연출용 — 여러 번 노출하면 위험해진다).
 *
 * @param {{lie: boolean, reveal: boolean, contradiction: boolean, confidence: number}} verdict
 * @returns {{events: string[]}} 클라이언트가 연출할 사건 목록
 */
export function applyVerdict(session, { lie, reveal, contradiction, confidence }) {
  const events = [];

  if (lie) {
    session.lieCount += 1;
    if (session.lieCount >= LIE_MAX) {
      session.outcome = 'lose';
      events.push('lie-fatal');
    } else {
      events.push('lie-warned');
    }
  }
  if (reveal) {
    session.detection -= PENALTY_REVEAL;
    events.push('reveal');
  }
  if (contradiction) {
    session.outcome = 'lose';
    events.push('contradiction-fatal');
  }

  // 확신도는 최댓값을 유지한다. 턴마다 출렁이게 두면 선언 타이밍이 운에 좌우된다.
  if (Number.isFinite(confidence)) {
    session.confidence = Math.max(session.confidence, Math.min(100, Math.max(0, confidence)));
  }

  session.detection = Math.max(0, session.detection);
  if (!session.outcome && session.detection === 0) {
    session.outcome = 'lose';
    events.push('detected');
  }

  return { events };
}
