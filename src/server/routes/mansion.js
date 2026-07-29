import express from 'express';
import { readFile } from 'node:fs/promises';
import { streamMansionReply } from '../ai/dialogue.js';
import { judgeStance } from '../ai/stance.js';
import {
  applyStance,
  createMansionSession,
  getMansionNpc,
  getMansionSession,
  pushMansionDialogue,
  toMansionView,
} from '../mansionSession.js';

const router = express.Router();

const loadMansion = async () =>
  JSON.parse(await readFile(new URL('../../data/mansion.json', import.meta.url), 'utf8'));

// stage.js·tutorial.js 와 같은 정책 — 개발 중에는 매번 다시 읽어 데이터 수정이 즉시 반영된다.
const isProd = process.env.NODE_ENV === 'production';
let dataCache = null;
function getData() {
  if (isProd) return (dataCache ??= loadMansion());
  return loadMansion();
}

/**
 * POST /api/mansion/start
 *
 * 저택 잠입 시작. **LLM 호출이 없어 즉시 응답한다** — 스테이지 1처럼 단어를 생성할
 * 필요가 없기 때문이다. 스테이지 1 클리어 직후 로딩 없이 이어진다.
 */
router.post('/start', async (req, res, next) => {
  try {
    const data = await getData();
    const sessionId = createMansionSession({
      escort: data.escort,
      npcs: data.npcs,
      rewards: data.rewards,
    });
    const session = getMansionSession(sessionId);

    // 서버 콘솔에만 정답(누가 동료인가)을 남긴다 — 개발용.
    const allies = session.npcs.filter((n) => n.kind === 'ally').map((n) => n.name);
    console.log(`[mansion] 세션 ${sessionId.slice(0, 8)} 시작 — 동료: ${allies.join(', ')}`);

    res.json(toMansionView(session));
  } catch (err) {
    next(err);
  }
});

/** 자유 입력 길이 상한 — 프롬프트를 통째로 밀어 넣는 시도를 입구에서 자른다. */
const MAX_MESSAGE_LEN = 200;

/**
 * POST /api/mansion/talk  { sessionId, npcId, message }
 *
 * 저택 직원 자유 대화. 응답은 SSE 로 흘리고, **성향 판정은 그와 나란히** 돈다.
 * 판정을 기다렸다가 스트리밍을 시작하면 첫 글자가 그만큼 늦게 뜬다 — 수치는 화면에
 * 안 나오므로 늦게 반영돼도 플레이어는 모른다 (계획서 §5.1).
 *
 * 상태 변화(정보 조각·열쇠·밀고)는 스트림이 끝난 뒤 마지막 이벤트로 한 번에 내려간다.
 */
router.post('/talk', async (req, res) => {
  const { sessionId, npcId, message } = req.body ?? {};
  const session = getMansionSession(sessionId);
  const npc = session && getMansionNpc(session, npcId);

  if (!session || !npc) return res.status(404).json({ error: '세션 또는 인물을 찾을 수 없습니다.' });
  if (session.over || session.cleared) return res.status(409).json({ error: '이미 끝난 세션입니다.' });
  if (npc.halted) return res.status(409).json({ error: '그는 지금 입을 닫았습니다.' });
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: '빈 메시지입니다.' });
  }

  const text = message.trim().slice(0, MAX_MESSAGE_LEN);

  // 대화 응답보다 먼저 쏘아 두고 뒤에서 익힌다. 판정이 죽어도 대화는 계속돼야 하므로
  // 여기서 잡아 neutral 로 떨어뜨린다 — LLM 장애가 판을 끝내는 일은 없어야 한다.
  const stancePromise = judgeStance({ message: text }).catch((err) => {
    console.warn('[mansion/stance]', err.message);
    return { stance: 'neutral', reason: '판정 실패' };
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    const reply = await streamMansionReply({
      npc,
      room: npc.room,
      history: npc.history,
      userMessage: text,
      onText: (delta) => send({ type: 'text', text: delta }),
    });

    // 이력에도 잘라낸 쪽을 남긴다 — 모델이 본 것과 이력이 어긋나면 다음 턴이 오염된다.
    pushMansionDialogue(session, npcId, 'user', text);
    pushMansionDialogue(session, npcId, 'assistant', reply);

    const { stance, reason } = await stancePromise;
    const { event, piece } = applyStance(session, npc, stance);
    console.log(
      `[mansion] ${npc.name} ← ${stance} (${reason})` +
        ` · 호감 ${npc.favor} 의심 ${npc.suspicion}${event ? ` → ${event}` : ''}`,
    );

    // 수치는 싣지 않는다. 벌어진 사건과 화이트리스트 상태만 내려간다.
    send({ type: 'event', event, piece, state: toMansionView(session) });
    send({ type: 'done' });
  } catch (err) {
    console.error('[mansion/talk]', err);
    // 헤더가 이미 나갔으므로 상태 코드를 바꿀 수 없다. 에러도 스트림으로 알린다.
    send({ type: 'error', error: err.message ?? '대화 생성 실패' });
  } finally {
    res.end();
  }
});

/**
 * POST /api/mansion/document  { sessionId }
 * 연구실 문서 열람 → 클리어. 입장만으로는 클리어가 아니다 (수정안 p.20 [확정]).
 */
router.post('/document', (req, res) => {
  const { sessionId } = req.body ?? {};
  const session = getMansionSession(sessionId);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  if (session.over) return res.status(409).json({ error: '이미 끝난 세션입니다.' });
  if (!session.hasKey) return res.status(409).json({ error: '연구실 열쇠가 없습니다.' });

  session.cleared = true;
  console.log(`[mansion] 세션 ${session.id.slice(0, 8)} — 클리어 (문서 열람)`);
  res.json({ state: toMansionView(session) });
});

export default router;
