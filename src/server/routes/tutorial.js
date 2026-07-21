import express from 'express';
import { readFile } from 'node:fs/promises';
import {
  createTutorialSession,
  getTutorialSession,
  toTutorialView,
  currentSet,
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

export default router;
