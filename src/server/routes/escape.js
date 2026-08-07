import express from 'express';
import { readFile } from 'node:fs/promises';
import { declareGuess, generateRobotQuestion, judgeAsRobot, judgeAsSystem } from '../ai/interrogation.js';
import { judgeGuess } from '../ai/judge.js';
import {
  applyVerdict,
  chooseIdentity,
  createEscapeSession,
  getEscapeSession,
  pushEscapeTurn,
  toEscapeView,
  DECLARE_THRESHOLD,
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
      // chooseIdentity 는 무작위로 뽑힌 session.choices(3장) 안에서만 찾는다 —
      // 디버그가 요청한 id 가 그 3장에 없으면 조용히 실패해 identity 가 null 로
      // 남는다. 디버그는 표본과 무관하게 "이 신분으로 강제 세팅"이 목적이므로
      // 전체 신분 풀(data.identities)에서 직접 찾는다.
      // 주의: 이 경로는 identity 가 session.choices 안에 없을 수 있게 만든다 —
      // "고른 카드는 항상 카드 3장 중 하나" 라는 전제가 개발 플래그에서는 깨진다.
      if (debug.identityId) {
        const forced = data.identities.find((i) => i.id === debug.identityId);
        if (forced) session.identity = forced;
      }
      if (Number.isFinite(debug.detection)) session.detection = debug.detection;
      if (Number.isFinite(debug.asked)) session.asked = debug.asked;
      if (Number.isFinite(debug.confidence)) session.confidence = debug.confidence;
      if (Number.isFinite(debug.declaresLeft)) session.declaresLeft = debug.declaresLeft;
      if (Number.isFinite(debug.lieCount)) session.lieCount = debug.lieCount;
      console.log(`[escape] 세션 ${sessionId.slice(0, 8)} — 개발 플래그 적용`);
    }

    console.log(
      `[escape] 세션 ${sessionId.slice(0, 8)} 시작 — 카드: ` +
        session.choices.map((c) => c.word).join(', '),
    );
    // backstory/personality 는 client 가 안 쓴다(judgeAsRobot 재료일 뿐) — 응답에 실을
    // 이유가 없다. 도입 대사(EscapeScene#showChildIntro)는 이제 고정 대본이라 서버가
    // 아무것도 안 내려도 된다.
    res.json({ state: toEscapeView(session) });
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
    // generateRobotQuestion 의 API 호출 실패는 캔 질문으로 흡수되지만(fail-open),
    // 그 앞의 renderPrompt(프롬프트 파일 읽기)는 try 밖이라 실패하면 그대로
    // reject 한다. 거절된 프로미스를 캐시에 남겨 두면 이 세션의 /question 은
    // 매번 같은 실패를 재현할 뿐 복구할 길이 없어지므로(세션이 인메모리라 다른
    // 리셋 수단도 없다), .catch() 로 캐시를 비워 다음 호출이 다시 시도하게 한다.
    const data = await getData();
    session.pendingQuestionPromise ??= generateRobotQuestion({
      history: session.history,
      asked: session.asked,
      questionMax: QUESTION_MAX,
      persona: data.child,
    })
      .then(({ question }) => {
        // 답변 심사에 같은 질문을 써야 하므로 여기 보관한다.
        session.pendingQuestion = question;
        return question;
      })
      .catch((err) => {
        console.warn('[escape] 질문 생성 실패 —', err.message);
        session.pendingQuestionPromise = null;
        throw err;
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

    const data = await getData();
    const [sys, bot] = await Promise.all([
      judgeAsSystem({ identityWord: session.identity.word, question, answer: text }),
      // identityWord 를 넘기지 않는다 — 넘길 자리 자체가 없다 (ai/interrogation.js 주석).
      judgeAsRobot({ history: session.history, question, answer: text, persona: data.child }),
    ]);

    pushEscapeTurn(session, question, text);
    session.pendingQuestion = null;
    // 프로미스 캐시도 같이 비운다 — 안 비우면 다음 /question 호출이 ??= 에 걸려
    // 이번 턴 질문을 계속 돌려받는다.
    session.pendingQuestionPromise = null;

    const { events } = applyVerdict(session, {
      lie: sys.lie,
      contradiction: bot.contradiction,
      vague: bot.vague,
      confidence: bot.confidence,
    });

    // 확신도가 임계에 닿고 선언이 남아 있으면 정식 추리를 선언한다.
    // 적중 판정은 접선 코드와 같은 판정기를 쓴다 — 동의어를 인정하지 않으면
    // "택배원" 같은 답이 빗나가서 규칙이 운에 좌우된다.
    let declaration = null;
    if (!session.outcome && session.confidence >= DECLARE_THRESHOLD && session.declaresLeft > 0) {
      const guess = await declareGuess({ history: session.history });
      if (!guess.fallback && guess.word) {
        // judgeGuess(ai/judge.js) 는 표기 일치·빈 입력 빠른 경로만 네트워크를 안 탄다 —
        // 나머지 경로는 fail-open 이 아니라 그대로 던진다. 여기서 던지게 두면
        // declaresLeft(단 2회)가 화면에 선언을 보여주지도 못한 채 소모되므로,
        // 판정 실패는 선언을 없던 일로 하고 턴을 그대로 진행한다. 소모(-1)는
        // 판정이 실제로 끝난 뒤로 미룬다.
        let correct;
        try {
          ({ correct } = await judgeGuess({
            codeWord: session.identity.word,
            guess: guess.word,
          }));
        } catch (err) {
          console.warn('[escape] 선언 적중 판정 실패 — 이번 선언을 없던 일로 처리', err.message);
        }
        if (correct !== undefined) {
          session.declaresLeft -= 1;
          declaration = { word: guess.word, hit: correct };
          if (correct) {
            session.outcome = 'lose';
            events.push('exposed');
          } else {
            events.push('declare-missed');
            // 빗나간 선언은 확신을 깎는다. 안 깎으면 남은 매 턴마다 선언이 터진다.
            session.confidence = 0;
          }
          console.log(
            `[escape] 추리 선언 "${guess.word}" → ${correct ? '적중' : '빗나감'}` +
              ` (잔여 ${session.declaresLeft})`,
          );
        }
      }
    }

    // 8문을 다 방어했으면 승리. 게이지가 먼저 0이 됐으면 applyVerdict 가 이미 lose 를 세웠다.
    if (!session.outcome && session.asked >= QUESTION_MAX) {
      session.outcome = 'win';
      events.push('survived');
    }

    console.log(
      `[escape] ${session.asked}/${QUESTION_MAX} — 거짓 ${sys.lie} 모순 ${bot.contradiction}` +
        ` 모호 ${bot.vague} 확신 ${session.confidence} · 탐지 ${session.detection}` +
        (events.length ? ` → ${events.join(',')}` : ''),
    );

    res.json({ events, declaration, state: toEscapeView(session) });
  } catch (err) {
    next(err);
  }
});

export default router;
