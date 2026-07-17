import { randomUUID } from 'node:crypto';

/**
 * 인메모리 게임 세션.
 *
 * 접선 코드 단어는 오직 여기에만 존재한다. 클라이언트로 절대 내려보내지 않는다.
 * 정답 판정도 서버에서 수행한다 — 브라우저 개발자도구로 정답을 볼 수 없게 하기 위함.
 *
 * 싱글플레이 + 로컬 실행이므로 인메모리로 충분하다 (서버 재시작 시 세션 소멸).
 */
const sessions = new Map();

const MAX_TRUST = 3;

export function createSession({ codeWord, category, allies, associations, arrestedIds }) {
  const id = randomUUID();

  const allyState = allies.map((ally) => {
    const assoc = associations.find((a) => a.npcId === ally.id);
    return {
      id: ally.id,
      name: ally.name,
      role: ally.role,
      spawn: ally.spawn,
      word: assoc?.word ?? null,
      reason: assoc?.reason ?? null,
      trust: MAX_TRUST,
      arrested: arrestedIds.includes(ally.id),
      informed: false,
      // 이 동료와 나눈 대화 이력 (Claude messages 형식). 클라이언트로 내보내지 않는다.
      history: [],
    };
  });

  sessions.set(id, {
    id,
    codeWord, // ← 서버 전용
    category, // ← 서버 전용
    allies: allyState,
    alertLevel: 0,
    cleared: false,
    gameOver: false,
    createdAt: Date.now(),
  });

  return id;
}

export function getSession(id) {
  return sessions.get(id);
}

/**
 * 클라이언트로 내보내도 안전한 형태로 변환.
 * codeWord / category / reason 은 제외한다 (reason 은 코드 단어를 암시할 수 있음).
 */
export function toClientView(session) {
  return {
    sessionId: session.id,
    alertLevel: session.alertLevel,
    cleared: session.cleared,
    gameOver: session.gameOver,
    allies: session.allies.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      spawn: a.spawn,
      // 체포·밀고된 동료의 단어는 노출하지 않는다.
      word: a.arrested || a.informed ? null : a.word,
      trust: a.trust,
      maxTrust: MAX_TRUST,
      arrested: a.arrested,
      informed: a.informed,
    })),
  };
}

export function getAlly(session, allyId) {
  return session.allies.find((a) => a.id === allyId);
}

/** 마을 NPC 대사 분기와 대화 프롬프트에 쓰이는 현재 체포 인원 */
export function arrestedCount(session) {
  return session.allies.filter((a) => a.arrested).length;
}

/** 대화 이력에 한 턴 추가 */
export function pushDialogue(session, allyId, role, content) {
  const ally = getAlly(session, allyId);
  if (ally) ally.history.push({ role, content });
}

/**
 * 코드 입력 실패 → 해당 동료의 신뢰도 하락. 0이 되면 밀고 → 경계 레벨 상승.
 * @returns {{ informed: boolean, trust: number }}
 */
export function loseTrust(session, allyId) {
  const ally = session.allies.find((a) => a.id === allyId);
  if (!ally || ally.arrested || ally.informed) return { informed: false, trust: 0 };

  ally.trust = Math.max(0, ally.trust - 1);

  if (ally.trust === 0) {
    ally.informed = true;
    session.alertLevel += 1;
    return { informed: true, trust: 0 };
  }
  return { informed: false, trust: ally.trust };
}

export { MAX_TRUST };
