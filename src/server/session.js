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

export function createSession({ codeWord, category, allies, associations, duplicateGroups, arrestedIds = [] }) {
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
      // 접선(대화) 여부 — 연상 단어는 접선한 뒤에만 밝혀진다.
      contacted: false,
      // 같은 단어를 낸 동료는 스테이지 시작 시점에 이미 정체가 드러나 붙잡혀 있다 (저스트원 규칙).
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
    // 같은 단어를 낸 동료 묶음 [{ npcIds, reason }]. 체포는 플레이어가 접선으로 중복을
    // 확인했을 때 비로소 발동하므로, 여기 숨겨두고 contactAlly 에서 판정한다.
    duplicateGroups: duplicateGroups ?? [],
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
      // 단어는 접선(대화)한 뒤에만 내려간다 — 접선하기 전엔 알 수 없다.
      // 체포·밀고된 동료의 단어도 감춘다.
      word: a.contacted && !a.arrested && !a.informed ? a.word : null,
      contacted: a.contacted,
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

/**
 * 플레이어가 동료에게 접선한다.
 *  - 접선한 동료의 연상 단어를 밝힌다 (contacted = true).
 *  - 같은 단어를 낸 중복 그룹에서 2명 이상이 접선되면(= 플레이어가 중복을 확인함)
 *    그 순간 해당 그룹의 접선된 구성원 전원을 체포한다.
 *
 * @returns {{ word: string, reason: string, newlyArrested: string[] } | null}
 *          접선할 수 없는 동료(없음·체포·밀고)면 null.
 */
export function contactAlly(session, allyId) {
  const ally = getAlly(session, allyId);
  if (!ally || ally.arrested || ally.informed) return null;

  ally.contacted = true;

  const newlyArrested = [];
  for (const group of session.duplicateGroups) {
    if (!group.npcIds.includes(allyId)) continue;
    const contacted = group.npcIds.filter((id) => getAlly(session, id)?.contacted);
    // 접선된 구성원이 2명 이상 → 중복이 확인됨 → 전원 체포.
    if (contacted.length >= 2) {
      for (const id of contacted) {
        const m = getAlly(session, id);
        if (m && !m.arrested) {
          m.arrested = true;
          newlyArrested.push(id);
        }
      }
    }
  }

  return { word: ally.word, reason: ally.reason, newlyArrested };
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
