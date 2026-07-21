import express from 'express';
import { readFile } from 'node:fs/promises';
import { judgeGuess } from '../ai/judge.js';
import {
  createTutorialSession,
  getTutorialSession,
  toTutorialView,
  currentSet,
  failGuess,
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

export default router;
