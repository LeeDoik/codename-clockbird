import { randomUUID } from 'node:crypto';

/**
 * 스테이지 2 저택 세션 (인메모리).
 *
 * 스테이지 1(session.js)·튜토리얼(tutorialSession.js)과 분리한다. 여기엔 경계 레벨도
 * 신뢰도도 접선 코드도 없다.
 *
 * ── 판정 방식: 숫자 누적이 아니라 매 턴 통째로 다시 판단 ──
 * 예전엔 발언마다 anti/pro/neutral 을 매겨 호감도·의심도를 누적하다 문턱(3)에서
 * 기계적으로 신고/정보 공개가 터졌다. 지금은 매 턴, 이 NPC 라면 지금까지의 대화
 * 전체를 보고 "지금 확신이 서서 행동할지, 아직 지켜볼지"를 판정한다(ai/disposition.js).
 * 그래서 숫자 상태가 없다 — `halted`(동료가 경계해 입을 닫음)·`gave`(정보를 이미 줬음)
 * 뿐이고, 둘 다 판정이 act 로 나온 순간 한 번만 바뀌는 플래그다.
 *
 * 이 파일이 쥐고 클라이언트로 내보내지 않는 것:
 *   - `kind` (동료냐 민간인이냐) — 알아내는 것이 이 스테이지의 퍼즐이다
 *   - `backstory` / `personality` / `rewards` — 프롬프트 재료와 아직 안 준 보상
 *   - `objects` 의 `npcId`·`topic`·`text` — 단서와 인물을 잇는 연결과 그 본문
 *     (text 는 /inspect 로 열람했을 때만 나간다)
 */
const sessions = new Map();

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
      /** 동료가 플레이어를 경계해 입을 닫음 — 다른 NPC 와 한 번 이상 대화해야 풀린다 */
      halted: false,
      /** 정보 조각을 이미 줬는가 (동료가 신뢰하기로 판정한 순간 한 번만 true 로) */
      gave: false,
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
 * 판정 하나(act/wait + trust/distrust)를 세션 상태로 바꾸는 순수 규칙 — 세션(다른
 * NPC·보상)과 분리해 뽑아냈다. 프롬프트 스튜디오의 무상태 미리보기가 실제 게임과
 * 똑같은 규칙을 쓰게 하려는 것 — 여기와 applyDisposition 이 갈라지면 스튜디오에서
 * 본 신고 타이밍과 실제 게임의 신고 타이밍이 어긋난다.
 *
 * @param {'ally'|'civ'} kind
 * @param {'act'|'wait'} decision
 * @param {'trust'|'distrust'|null} direction decision 이 'act' 일 때만 의미 있다
 * @param {boolean} gave 이 동료가 이미 정보를 줬는가 (act+trust 가 두 번 터지지 않게)
 * @returns {{event: 'reported'|'halted'|'reveal'|null}}
 */
export function scoreDisposition(kind, decision, direction, gave) {
  if (decision !== 'act') return { event: null };

  if (kind === 'civ') {
    return { event: direction === 'distrust' ? 'reported' : null };
  }
  // ally
  if (direction === 'distrust') return { event: 'halted' };
  if (direction === 'trust' && !gave) return { event: 'reveal' };
  return { event: null };
}

/**
 * 판정 결과를 상태에 반영한다.
 *
 * @param {'act'|'wait'} decision
 * @param {'trust'|'distrust'|null} direction
 * @returns {{event: string|null, piece: string|null}} 클라이언트가 연출할 사건
 */
export function applyDisposition(session, npc, decision, direction) {
  // 다른 NPC 와 대화했으니 굳어 있던 동료들이 풀린다 (수정안 p.22 [확정]).
  for (const other of session.npcs) {
    if (other.id !== npc.id && other.halted) other.halted = false;
  }

  const scored = scoreDisposition(npc.kind, decision, direction, npc.gave);

  if (scored.event === 'reported') {
    session.over = 'reported';
    return { event: 'reported', piece: null };
  }
  if (scored.event === 'halted') {
    npc.halted = true;
    return { event: 'halted', piece: null };
  }
  if (scored.event === 'reveal') {
    npc.gave = true;
    const piece = session.rewards[npc.id] ?? '';
    session.pieces.push(piece);
    if (session.pieces.length >= PIECES_FOR_KEY) {
      session.hasKey = true;
      return { event: 'key', piece };
    }
    return { event: 'piece', piece };
  }

  return { event: null, piece: null };
}

/** 대화 이력에 한 턴 추가 */
export function pushMansionDialogue(session, npcId, role, content) {
  const npc = getMansionNpc(session, npcId);
  if (npc) npc.history.push({ role, content });
}
