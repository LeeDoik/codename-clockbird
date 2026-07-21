import express from 'express';
import { readFile } from 'node:fs/promises';
import { judgeGuess } from '../ai/judge.js';
import { streamTutorialReply } from '../ai/dialogue.js';
import {
  createTutorialSession,
  getTutorialSession,
  toTutorialView,
  currentSet,
  getTutorialAlly,
  failGuess,
  pushTutorialDialogue,
} from '../tutorialSession.js';

const router = express.Router();

const loadTutorial = async () =>
  JSON.parse(await readFile(new URL('../../data/tutorial.json', import.meta.url), 'utf8'));

// stage.js 와 같은 정책 — 개발 중에는 매번 다시 읽어 tutorial.json 수정이 즉시 반영된다.
const isProd = process.env.NODE_ENV === 'production';
let dataCache = null;
function getData() {
  if (isProd) return (dataCache ??= loadTutorial());
  return loadTutorial();
}

/**
 * POST /api/tutorial/start
 * 튜토리얼 시작. 힌트가 고정 세트라 LLM 호출이 없고 즉시 응답한다.
 */
router.post('/start', async (req, res, next) => {
  try {
    const data = await getData();
    const sessionId = createTutorialSession({
      allies: data.allies,
      officer: data.officer,
      sets: data.sets,
    });
    const session = getTutorialSession(sessionId);

    // 서버 콘솔에만 정답을 남긴다 (개발용).
    console.log(
      `[tutorial] 세션 ${sessionId.slice(0, 8)} 시작 — 코드: "${currentSet(session).codeWord}"`,
    );

    res.json(toTutorialView(session));
  } catch (err) {
    next(err);
  }
});

/** 세트를 갈아 치울 때 간부가 하는 말. 이전 힌트가 무효임을 분명히 알린다. */
const OFFICER_REPLACE_LINE =
  '세 번이나 틀렸군. 이 코드는 태웠다.\n\n' +
  '지금부터는 새 코드다 — 방금까지 들은 단어는 전부 잊어라.\n동료들에게 다시 물어보고 오너라.';

/**
 * POST /api/tutorial/guess  { sessionId, guess }
 * 접선 코드 입력. 판정은 스테이지 1과 같은 judgeGuess 를 쓴다 (동의어 인정).
 *
 * 판정 호출이 실패하면 예외가 그대로 올라가 신뢰도가 깎이지 않는다 — LLM 장애가
 * 플레이어의 신뢰도를 먹는 일은 없어야 한다. 클라이언트는 500 을 "다시 말해봐"로 받는다.
 */
router.post('/guess', async (req, res, next) => {
  try {
    const { sessionId, guess } = req.body ?? {};
    const session = getTutorialSession(sessionId);

    if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
    if (session.cleared) return res.status(409).json({ error: '이미 종료된 세션입니다.' });
    if (typeof guess !== 'string' || !guess.trim()) {
      return res.status(400).json({ error: '빈 입력입니다.' });
    }

    const set = currentSet(session);
    const verdict = await judgeGuess({ codeWord: set.codeWord, guess });

    if (verdict.correct) {
      session.cleared = true;
      console.log(`[tutorial] 세션 ${session.id.slice(0, 8)} — 클리어 ("${guess}")`);
      return res.json({
        correct: true,
        codeWord: set.codeWord, // 클리어 후에는 공개해도 안전
        state: toTutorialView(session),
      });
    }

    const { replaced } = failGuess(session);
    console.log(
      `[tutorial] 세션 ${session.id.slice(0, 8)} — 오답 "${guess}" (${session.failCount}회)${
        replaced ? ` → 코드 교체: "${currentSet(session).codeWord}"` : ''
      }`,
    );

    res.json({
      correct: false,
      replaced,
      officerLine: replaced ? OFFICER_REPLACE_LINE : null,
      state: toTutorialView(session),
    });
  } catch (err) {
    next(err);
  }
});

/** 자유 입력 길이 상한 — 프롬프트를 통째로 밀어 넣는 시도를 입구에서 자른다. */
const MAX_MESSAGE_LEN = 200;

/**
 * POST /api/tutorial/talk  { sessionId, allyId, message }
 * 튜토리얼 동료 자유 대화. 응답을 SSE 로 스트리밍한다.
 *
 * 이 엔드포인트도 접선 코드를 프롬프트에 넣지 않는다. 여기에 더해 reason(강화 힌트)까지
 * 신뢰도 0 전에는 넣지 않는다 (dialogue.js streamTutorialReply 주석 참조).
 */
router.post('/talk', async (req, res) => {
  const { sessionId, allyId, message } = req.body ?? {};
  const session = getTutorialSession(sessionId);
  const ally = session && getTutorialAlly(session, allyId);

  if (!session || !ally) {
    return res.status(404).json({ error: '세션 또는 동료를 찾을 수 없습니다.' });
  }
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: '빈 메시지입니다.' });
  }

  const hint = currentSet(session).hints[ally.id];
  const text = message.trim().slice(0, MAX_MESSAGE_LEN);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    const reply = await streamTutorialReply({
      ally,
      word: hint.word,
      // 신뢰도가 남아 있으면 이유를 넘기지 않는다 — 모델이 모르는 상태를 유지한다.
      reason: ally.trust === 0 ? hint.reason : null,
      history: ally.history,
      userMessage: text,
      onText: (delta) => send({ type: 'text', text: delta }),
    });

    // 이력에도 잘라낸 쪽을 남긴다 — 모델이 본 것과 이력이 어긋나면 다음 턴이 오염된다.
    pushTutorialDialogue(session, allyId, 'user', text);
    pushTutorialDialogue(session, allyId, 'assistant', reply);

    send({ type: 'done' });
  } catch (err) {
    console.error('[tutorial/talk]', err);
    // 헤더가 이미 나갔으므로 상태 코드를 바꿀 수 없다. 에러도 스트림으로 알린다.
    send({ type: 'error', error: err.message ?? '대화 생성 실패' });
  } finally {
    res.end();
  }
});

export default router;
