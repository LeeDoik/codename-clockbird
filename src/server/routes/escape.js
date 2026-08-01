import express from 'express';
import { readFile } from 'node:fs/promises';
import { generateRobotQuestion, judgeAsRobot, judgeAsSystem } from '../ai/interrogation.js';
import {
  applyVerdict,
  chooseIdentity,
  createEscapeSession,
  getEscapeSession,
  pushEscapeTurn,
  toEscapeView,
  QUESTION_MAX,
} from '../escapeSession.js';

const router = express.Router();

const loadEscape = async () =>
  JSON.parse(await readFile(new URL('../../data/escape.json', import.meta.url), 'utf8'));

// mansion.js 와 같은 정책 — 개발 중에는 매번 다시 읽어 데이터 수정이 즉시 반영된다.
const isProd = process.env.NODE_ENV === 'production';
let dataCache = null;
function getData() {
  if (isProd) return (dataCache ??= loadEscape());
  return loadEscape();
}

/** 자유 입력 길이 상한 — 프롬프트를 통째로 밀어 넣는 시도를 입구에서 자른다. */
const MAX_ANSWER_LEN = 120;

/**
 * POST /api/escape/interrogation/start
 * 심문 개시. **LLM 호출이 없어 즉시 응답한다** — 신분 단어는 고정 풀에서 뽑기 때문이다.
 */
router.post('/interrogation/start', async (req, res, next) => {
  try {
    const data = await getData();
    const sessionId = createEscapeSession({ identities: data.identities });
    const session = getEscapeSession(sessionId);

    // 개발용 — 스모크가 8문을 태우지 않고 특정 상태를 세울 수 있게 한다.
    // 프로덕션에서는 통째로 무시한다 (mansion 의 debug:'key' 와 같은 정책).
    const debug = req.body?.debug;
    if (!isProd && debug && typeof debug === 'object') {
      if (debug.identityId) chooseIdentity(session, debug.identityId);
      if (Number.isFinite(debug.detection)) session.detection = debug.detection;
      if (Number.isFinite(debug.asked)) session.asked = debug.asked;
      if (Number.isFinite(debug.confidence)) session.confidence = debug.confidence;
      if (debug.forgiven === true) session.contradictionForgiven = true;
      console.log(`[escape] 세션 ${sessionId.slice(0, 8)} — 개발 플래그 적용`);
    }

    console.log(
      `[escape] 세션 ${sessionId.slice(0, 8)} 시작 — 카드: ` +
        session.choices.map((c) => c.word).join(', '),
    );
    res.json({ state: toEscapeView(session), child: (await getData()).child });
  } catch (err) {
    next(err);
  }
});

/** POST /api/escape/interrogation/identity  { sessionId, identityId } */
router.post('/interrogation/identity', (req, res) => {
  const { sessionId, identityId } = req.body ?? {};
  const session = getEscapeSession(sessionId);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  if (session.outcome) return res.status(409).json({ error: '이미 끝난 심문입니다.' });
  if (session.identity) return res.status(409).json({ error: '이미 신분을 골랐습니다.' });
  if (!chooseIdentity(session, identityId)) {
    return res.status(400).json({ error: '제시된 카드가 아닙니다.' });
  }

  console.log(`[escape] 세션 ${session.id.slice(0, 8)} — 신분: ${session.identity.word}`);
  res.json({ state: toEscapeView(session) });
});

/** POST /api/escape/interrogation/question  { sessionId } */
router.post('/interrogation/question', async (req, res, next) => {
  try {
    const { sessionId } = req.body ?? {};
    const session = getEscapeSession(sessionId);
    if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
    if (!session.identity) return res.status(409).json({ error: '신분을 먼저 고르세요.' });
    if (session.outcome) return res.status(409).json({ error: '이미 끝난 심문입니다.' });
    if (session.asked >= QUESTION_MAX) return res.status(409).json({ error: '질문이 끝났습니다.' });

    const { question } = await generateRobotQuestion({
      history: session.history,
      asked: session.asked,
      questionMax: QUESTION_MAX,
    });
    // 답변 심사에 같은 질문을 써야 하므로 여기 보관한다.
    session.pendingQuestion = question;
    res.json({ question, state: toEscapeView(session) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/escape/interrogation/answer  { sessionId, answer }
 *
 * 두 판정을 **병렬로** 돌린다. 지연은 합이 아니라 둘 중 최댓값이다
 * (mansion/talk 이 성향 판정을 대화 스트림과 나란히 돌리는 것과 같은 패턴).
 */
router.post('/interrogation/answer', async (req, res, next) => {
  try {
    const { sessionId, answer } = req.body ?? {};
    const session = getEscapeSession(sessionId);
    if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
    if (!session.identity) return res.status(409).json({ error: '신분을 먼저 고르세요.' });
    if (session.outcome) return res.status(409).json({ error: '이미 끝난 심문입니다.' });
    if (!session.pendingQuestion) return res.status(409).json({ error: '질문이 없습니다.' });
    if (typeof answer !== 'string' || !answer.trim()) {
      return res.status(400).json({ error: '빈 답변입니다.' });
    }

    const text = answer.trim().slice(0, MAX_ANSWER_LEN);
    const question = session.pendingQuestion;

    const [sys, bot] = await Promise.all([
      judgeAsSystem({ identityWord: session.identity.word, question, answer: text }),
      // identityWord 를 넘기지 않는다 — 넘길 자리 자체가 없다 (ai/interrogation.js 주석).
      judgeAsRobot({ history: session.history, question, answer: text }),
    ]);

    pushEscapeTurn(session, question, text);
    session.pendingQuestion = null;

    const { events } = applyVerdict(session, {
      lie: sys.lie,
      reveal: sys.reveal,
      contradiction: bot.contradiction,
      confidence: bot.confidence,
    });

    // 8문을 다 방어했으면 승리. 게이지가 먼저 0이 됐으면 applyVerdict 가 이미 lose 를 세웠다.
    if (!session.outcome && session.asked >= QUESTION_MAX) {
      session.outcome = 'win';
      events.push('survived');
    }

    console.log(
      `[escape] ${session.asked}/${QUESTION_MAX} — 거짓 ${sys.lie} 노출 ${sys.reveal}` +
        ` 모순 ${bot.contradiction} 확신 ${session.confidence} · 탐지 ${session.detection}` +
        (events.length ? ` → ${events.join(',')}` : ''),
    );

    res.json({ npcReply: bot.reply, events, state: toEscapeView(session) });
  } catch (err) {
    next(err);
  }
});

export default router;
