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
    res.json({ state: toEscapeView(session), child: data.child });
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

    // 멱등성 — 값이 아니라 "진행 중인 호출" 을 캐시한다. `??=` 는 await 전에
    // 동기적으로 대입되므로, 2.5초짜리 LLM 왕복이 끝나기 전에 겹쳐 들어온 두 번째
    // 요청(동시 호출)도 새로 생성하지 않고 같은 프로미스를 받는다. 값만 캐시하면
    // 순차 재호출은 막아도 두 요청이 동시에 "아직 비어 있다" 를 보고 각자 새로
    // 생성해 버려, 나중에 끝난 쪽이 덮어써 화면의 질문과 채점되는 질문이 다시
    // 어긋난다.
    // generateRobotQuestion 은 fail-open 이라 절대 reject 하지 않는다 — 그래서
    // 이 캐시가 거절된 프로미스로 눌러앉아 세션을 영영 막는 일은 없다. 이 전제가
    // 깨지면(예: 나중에 throw 하도록 바뀌면) 이 캐시도 같이 손봐야 한다.
    session.pendingQuestionPromise ??= generateRobotQuestion({
      history: session.history,
      asked: session.asked,
      questionMax: QUESTION_MAX,
    }).then(({ question }) => {
      // 답변 심사에 같은 질문을 써야 하므로 여기 보관한다.
      session.pendingQuestion = question;
      return question;
    });

    const question = await session.pendingQuestionPromise;
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
    // 프로미스 캐시도 같이 비운다 — 안 비우면 다음 /question 호출이 ??= 에 걸려
    // 이번 턴 질문을 계속 돌려받는다.
    session.pendingQuestionPromise = null;

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
