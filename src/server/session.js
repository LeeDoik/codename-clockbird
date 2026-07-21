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

/**
 * 구출된 동료의 남은 신뢰도.
 * 심문실에서 막 나온 인물이라 회복시켜 주지 않는다 — 한 번만 더 의심을 사면 무너진다.
 */
const RESCUED_TRUST = 1;

export function createSession({ codeWord, category, allies, associations, duplicateGroups, arrestedIds = [], broker = null }) {
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
      // 플레이어가 감옥에서 빼낸 동료. 재체포 가드로 쓴다 (contactAlly 참조).
      rescued: false,
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
    // 접선책 — 코드를 건넬 유일한 창구. 단어를 내지 않으므로 체포·중복 판정과 무관하다.
    broker,
    // 같은 단어를 낸 동료 묶음 [{ npcIds, reason }]. 체포는 플레이어가 접선으로 중복을
    // 확인했을 때 비로소 발동하므로, 여기 숨겨두고 contactAlly 에서 판정한다.
    duplicateGroups: duplicateGroups ?? [],
    alertLevel: 0,
    cleared: false,
    gameOver: false,
    // 결과 화면이 제목을 고르는 근거. gameOver 가 true 일 때만 의미가 있다.
    gameOverReason: null,
    // 진행 중인 불심검문 { stage, startedAt, question?, choices? }. 없으면 null.
    checkpoint: null,
    // 이 시각까지는 다시 검문당하지 않는다 (통과 직후 재검문 방지).
    checkpointCooldownUntil: 0,
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
 *
 * 단 판이 끝난 뒤에는 codeWord 를 함께 내려보낸다 — 결과 화면의 "접선 코드는 「…」였다"
 * 에 필요하다. 비유출 원칙은 진행 중인 판에만 적용된다 (끝난 판의 정답은 숨길 이유가 없다).
 *
 * 진행 중에는 codeWord 를 null 로 채우지 않고 필드 자체를 뺀다. "값이 비었다" 보다
 * "그런 필드가 없다" 가 검증하기 쉽고, smoke 테스트도 응답 본문에 codeWord 라는
 * 글자가 있는지로 유출을 잡는다.
 */
export function toClientView(session) {
  const ended = session.cleared || session.gameOver;
  return {
    sessionId: session.id,
    alertLevel: session.alertLevel,
    broker: session.broker,
    cleared: session.cleared,
    gameOver: session.gameOver,
    gameOverReason: session.gameOverReason,
    ...(ended && { codeWord: session.codeWord }),
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
      // 구출된 동료의 단어는 "둘 이상이 겹쳐 낸 단어"임이 확정된 강한 단서다.
      // 클라이언트가 수첩에서 구분해 보여줄 수 있게 내보낸다.
      rescued: a.rescued,
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
        // 구출한 동료는 이 판정에서 제외한다. 그는 이미 이 중복 때문에 한 번 붙잡혔던
        // 인물이라 같은 사유로 또 잡아갈 것이 없고, 무엇보다 가드가 없으면 구출 직후
        // 접선하는 순간(또는 같은 그룹의 다른 동료를 접선하는 순간) 도로 감옥으로
        // 끌려가 구출 기능 자체가 무의미해진다.
        if (m && !m.arrested && !m.rescued) {
          m.arrested = true;
          newlyArrested.push(id);
        }
      }
    }
  }

  return { word: ally.word, reason: ally.reason, newlyArrested };
}

/**
 * 감옥의 동료를 구출한다.
 *
 * 대가로 경계 레벨이 오른다 — 창살을 뜯는 소란은 반드시 새어 나간다. 구출이 공짜라면
 * "일단 전원 구출하고 시작"이 항상 최적해가 되어 체포 메커닉 전체가 죽는다.
 * 신뢰도도 회복시키지 않고 RESCUED_TRUST 로 떨어뜨린다. 구출로 얻는 단어는 두 명이
 * 독립적으로 떠올린 확실한 단서라 보상이 크므로, 대가도 두 축(경계·신뢰)으로 받는다.
 *
 * 전원 체포로 접선할 상대가 없는 판에서는 이것이 유일한 활로다.
 *
 * @returns {{ allyId: string, name: string, alertLevel: number, trust: number } | null}
 *          감옥에 없거나 이미 밀고한 동료면 null.
 */
export function rescueAlly(session, allyId) {
  const ally = getAlly(session, allyId);
  if (!ally || !ally.arrested) return null;
  // 밀고한 동료는 빼내도 접선·대화가 막혀 있다. 대가만 치르는 선택지를 애초에 막는다.
  if (ally.informed) return null;

  ally.arrested = false;
  ally.rescued = true;
  // 이미 신뢰를 깎아먹은 동료를 구출로 회복시켜 주지는 않는다.
  ally.trust = Math.min(ally.trust, RESCUED_TRUST);
  session.alertLevel += 1;

  return { allyId: ally.id, name: ally.name, alertLevel: session.alertLevel, trust: ally.trust };
}

/** 마을 NPC 대사 분기와 대화 프롬프트에 쓰이는 현재 체포 인원 */
export function arrestedCount(session) {
  return session.allies.filter((a) => a.arrested).length;
}

/**
 * 검문 중인가.
 *
 * 검문 중에는 접선·구출·코드 입력·대화가 전부 막힌다. 로봇 앞에 세워진 채로 동료와
 * 잡담하거나 자물쇠를 딸 수는 없다 — 게임 규칙이기도 하고, 대화 SSE 스트림이 검문
 * 패널에 끼어드는 사고를 막는 장치이기도 하다.
 */
export function inCheckpoint(session) {
  return session.checkpoint !== null;
}

/**
 * 소란이 새어 나갔다 — 경계 레벨을 올린다.
 *
 * 경계 레벨은 순찰의 속도·시야와 검문 심사의 엄격도를 함께 끌어올리므로, 올릴 권한은
 * 서버만 갖는다. 클라이언트에서 판정이 끝나는 사건(미니게임 실패)도 이 통로로만 대가를
 * 치른다.
 */
export function raiseAlert(session, amount = 1) {
  session.alertLevel += amount;
  return session.alertLevel;
}

/** 밀고해 버린 동료 수. 한 명이라도 있으면 순찰에게 걸리는 즉시 구속이다. */
export function informedCount(session) {
  return session.allies.filter((a) => a.informed).length;
}

/**
 * 더 이상 이길 수 없는 판인가.
 *
 * 접선 코드는 동료 앞에서만 건넬 수 있으므로(클라이언트 currentAllyId), 접선 가능한
 * 동료가 0명이면 정답을 알아도 제출할 방법이 없다. 감옥의 동료는 구출로 되살릴 수
 * 있으니 아직 활로다 — 체포는 세지 않고 밀고만 센다.
 */
export function isUnwinnable(session) {
  return !session.allies.some((a) => !a.informed);
}

/**
 * 판을 끝낸다. 이미 끝난 판은 덮어쓰지 않는다 — 먼저 도달한 결말이 이긴다
 * (검문 적발과 밀고가 같은 프레임에 겹칠 수 있다).
 *
 * @param {'allInformed'|'caught'|'informerCaught'} reason
 */
export function setGameOver(session, reason) {
  if (session.cleared || session.gameOver) return false;
  session.gameOver = true;
  session.gameOverReason = reason;
  return true;
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
