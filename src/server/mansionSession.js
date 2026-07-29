import { randomUUID } from 'node:crypto';

/**
 * 스테이지 2 저택 세션 (인메모리).
 *
 * 스테이지 1(session.js)·튜토리얼(tutorialSession.js)과 분리한다. 여기엔 경계 레벨도
 * 신뢰도도 접선 코드도 없고, 대신 **NPC별 호감도·의심도**가 있다. 겹치는 필드가 거의 없다.
 *
 * 이 파일이 쥐고 클라이언트로 내보내지 않는 것:
 *   - `kind` (동료냐 민간인이냐) — 알아내는 것이 이 스테이지의 퍼즐이다
 *   - `favor` / `suspicion` — 수치 비노출, 대화 뉘앙스로만 유추한다 (계획서 §4.4)
 *   - `backstory` / `personality` / `rewards` — 프롬프트 재료와 아직 안 준 보상
 *   - `objects` 의 `npcId`·`topic`·`text` — 단서와 인물을 잇는 연결과 그 본문
 *     (text 는 /inspect 로 열람했을 때만 나간다)
 *   - `usedClues` — 단서 보너스를 이미 써서 소진했는지 기록한 목록
 */
const sessions = new Map();

/** 동료 호감도가 여기 닿으면 정보 조각을 준다 */
export const FAVOR_MAX = 3;
/** 의심도 상한 — 민간인이면 밀고(게임오버), 동료면 대화 중단 */
export const SUSPICION_MAX = 3;
/** 정보 조각을 이만큼 모으면 연구실 열쇠가 나온다 */
export const PIECES_FOR_KEY = 3;

export function createMansionSession({ escort, npcs, rewards, objects = [] }) {
  const id = randomUUID();
  sessions.set(id, {
    id,
    escort,
    rewards,
    npcs: npcs.map((n) => ({
      ...n,
      favor: 0,
      suspicion: 0,
      /** 의심도 상한에 닿은 동료 — 다른 NPC 와 한 번 이상 대화해야 풀린다 */
      halted: false,
      /** 정보 조각을 이미 줬는가 */
      gave: false,
      /** 이 NPC 에게 이미 써먹은 단서 id — 같은 단서로 반복 파밍하지 못하게 */
      usedClues: [],
      history: [],
    })),
    /** 조사 오브젝트 — found 는 서버가 쥔다 */
    objects: objects.map((o) => ({ ...o, found: false })),
    pieces: [],
    hasKey: false,
    cleared: false,
    /** 게임오버 사유. null 이면 진행 중 */
    over: null,
    createdAt: Date.now(),
  });
  return id;
}

export const getMansionSession = (id) => sessions.get(id);
export const getMansionNpc = (session, npcId) => session.npcs.find((n) => n.id === npcId);

/**
 * 클라이언트로 내보내도 안전한 형태 — 화이트리스트다.
 *
 * 스테이지 1의 `/contact` reason 유출(5ef7f75)과 같은 실수를 막으려고, 필드를 빼는 것이
 * 아니라 **넣을 것만 적는다.** npc 객체에 나중에 어떤 필드가 붙어도 자동으로 새지 않는다.
 */
export function toMansionView(session) {
  return {
    sessionId: session.id,
    escort: {
      id: session.escort.id,
      name: session.escort.name,
      role: session.escort.role,
      col: session.escort.col,
      row: session.escort.row,
      room: session.escort.room,
      line: session.escort.line,
    },
    npcs: session.npcs.map((n) => ({
      id: n.id,
      name: n.name,
      col: n.col,
      row: n.row,
      room: n.room,
      patrol: n.patrol ?? null,
      line: n.line,
      // 아래 둘은 이미 벌어진 사건이라 숨길 이유가 없다 (숨기면 화면을 못 그린다).
      halted: n.halted,
      gave: n.gave,
    })),
    objects: session.objects.map((o) => ({
      id: o.id, name: o.name, col: o.col, row: o.row, room: o.room, found: o.found,
    })),
    pieces: session.pieces,
    hasKey: session.hasKey,
    cleared: session.cleared,
    over: session.over,
  };
}

/**
 * 성향 판정 결과를 상태에 반영한다.
 *
 * @param {'anti'|'pro'|'neutral'} stance
 * @param {string|null} usedClueId 이번 발언이 실질적으로 꺼낸 단서 id (judgeStance 가 판정)
 * @returns {{event: string|null, piece: string|null}} 클라이언트가 연출할 사건
 */
export function applyStance(session, npc, stance, usedClueId = null) {
  // 다른 NPC 와 대화했으니 굳어 있던 동료들이 풀린다 (수정안 p.22 [확정]).
  for (const other of session.npcs) {
    if (other.id !== npc.id && other.halted) {
      other.halted = false;
      other.favor = 0; // 호감도는 0부터 다시 쌓는다
      // 의심도도 내려야 한다. 3 에 둔 채로 풀면 다음 한마디에 아래 상한 검사가
      // 바로 다시 걸려 영영 말을 못 붙인다 — 동료 3명이 전부 필수라 그대로 소프트락이다.
      // 0 으로 지우지 않는 것은, 한 번 의심한 사람이 통째로 잊지는 않기 때문.
      other.suspicion = 1;
    }
  }

  if (npc.kind === 'ally') {
    if (stance === 'anti') npc.favor += 1;
    else if (stance === 'pro') npc.suspicion += 1;
    // 조사로 얻은 단서를 화제로 꺼내면 호감도 보너스 — 단서당·NPC당 1회 (스펙 §5.3)
    const clue = usedClueId && session.objects.find((o) => o.id === usedClueId);
    if (clue && clue.found && clue.npcId === npc.id && !npc.usedClues.includes(usedClueId)) {
      npc.usedClues.push(usedClueId);
      npc.favor += 1;
    }
  } else if (npc.kind === 'civ') {
    // 민간인에게 반브루주아 발언은 그대로 위험이다. 친브루주아·중립은 무해하다.
    if (stance === 'anti') npc.suspicion += 1;
  }

  if (npc.suspicion >= SUSPICION_MAX) {
    if (npc.kind === 'civ') {
      session.over = 'reported';
      return { event: 'reported', piece: null };
    }
    npc.halted = true;
    return { event: 'halted', piece: null };
  }

  if (npc.kind === 'ally' && !npc.gave && npc.favor >= FAVOR_MAX) {
    npc.gave = true;
    const piece = session.rewards[npc.id] ?? '';
    session.pieces.push(piece);
    if (session.pieces.length >= PIECES_FOR_KEY) {
      session.hasKey = true;
      return { event: 'key', piece };
    }
    return { event: 'piece', piece };
  }

  // 의심도가 처음 올라간 순간은 경고로 알린다 — 상한까지 조용히 가면 게임오버가 가혹하다.
  if (npc.suspicion === SUSPICION_MAX - 1) return { event: 'warn', piece: null };

  return { event: null, piece: null };
}

/** 대화 이력에 한 턴 추가 */
export function pushMansionDialogue(session, npcId, role, content) {
  const npc = getMansionNpc(session, npcId);
  if (npc) npc.history.push({ role, content });
}
