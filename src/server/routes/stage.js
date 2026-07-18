import express from 'express';
import { readFile } from 'node:fs/promises';
import { generateAssociations } from '../ai/wordGen.js';
import { judgeDuplicates, judgeGuess } from '../ai/judge.js';
import { streamAllyReply } from '../ai/dialogue.js';
import {
  createSession,
  getSession,
  toClientView,
  loseTrust,
  getAlly,
  contactAlly,
  rescueAlly,
  arrestedCount,
  pushDialogue,
} from '../session.js';

const router = express.Router();

const load = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));

// 정적 데이터는 프로세스 시작 후 1회만 읽는다.
const dataPromise = Promise.all([
  load('../../data/codewords.json'),
  load('../../data/personas.json'),
]).then(([pool, personas]) => ({ pool, allies: personas.allies }));

function pickRandomCodeWord(pool) {
  const all = Object.entries(pool.categories).flatMap(([category, words]) =>
    words.map((word) => ({ category, word })),
  );
  return all[Math.floor(Math.random() * all.length)];
}

/**
 * POST /api/stage/start
 * 스테이지 시작: 코드 단어 선정 → 연상 단어 생성 → 중복(체포) 판정 → 세션 생성.
 * 응답에는 코드 단어가 포함되지 않는다.
 */
router.post('/start', async (req, res, next) => {
  try {
    const { pool, allies } = await dataPromise;
    const picked = pickRandomCodeWord(pool);

    const gen = await generateAssociations({ codeWord: picked.word, allies });
    const dup = await judgeDuplicates({ associations: gen.associations });

    const sessionId = createSession({
      codeWord: picked.word,
      category: picked.category,
      allies,
      associations: gen.associations,
      duplicateGroups: dup.groups,
      arrestedIds: dup.arrestedIds,
    });

    // 서버 콘솔에만 정답을 남긴다 (개발용). 같은 단어를 낸 동료는 시작 시점에 이미 붙잡혀 있다.
    console.log(
      `[stage] 세션 ${sessionId.slice(0, 8)} 시작 — 코드: "${picked.word}", 체포: ${
        dup.arrestedIds.length
      }명 / 남음 ${allies.length - dup.arrestedIds.length}명`,
    );

    res.json(toClientView(getSession(sessionId)));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/stage/contact  { sessionId, allyId }
 * 동료 접선 — 연상 단어를 밝히고, 같은 단어가 확인되면 그 순간 체포를 갱신한다.
 */
router.post('/contact', (req, res) => {
  const { sessionId, allyId } = req.body ?? {};
  const session = getSession(sessionId);

  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  if (session.cleared || session.gameOver) {
    return res.status(409).json({ error: '이미 종료된 세션입니다.' });
  }

  const result = contactAlly(session, allyId);
  if (!result) return res.status(409).json({ error: '접선할 수 없는 동료입니다.' });

  res.json({ ...result, state: toClientView(session) });
});

/**
 * POST /api/stage/rescue  { sessionId, allyId }
 * 감옥의 동료 구출 — 경계 레벨이 오르는 대가로 다시 접선·대화할 수 있게 된다.
 *
 * 연상 단어는 여기서 주지 않는다. 구출은 접선 자격을 되돌려 줄 뿐이고,
 * 단서는 /contact 를 거쳐야 얻는다 (구출 = 접선이 아니다).
 */
router.post('/rescue', (req, res) => {
  const { sessionId, allyId } = req.body ?? {};
  const session = getSession(sessionId);

  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  if (session.cleared || session.gameOver) {
    return res.status(409).json({ error: '이미 종료된 세션입니다.' });
  }

  const result = rescueAlly(session, allyId);
  if (!result) return res.status(409).json({ error: '구출할 수 없는 동료입니다.' });

  console.log(
    `[stage] 세션 ${session.id.slice(0, 8)} — ${result.name} 구출, 경계 레벨 ${result.alertLevel}`,
  );

  res.json({ ...result, state: toClientView(session) });
});

/**
 * POST /api/stage/guess  { sessionId, allyId, guess }
 * 접선 코드 입력. 정답 판정은 서버에서만 이뤄진다.
 */
router.post('/guess', async (req, res, next) => {
  try {
    const { sessionId, allyId, guess } = req.body ?? {};
    const session = getSession(sessionId);

    if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
    if (session.cleared || session.gameOver) {
      return res.status(409).json({ error: '이미 종료된 세션입니다.' });
    }

    const verdict = await judgeGuess({ codeWord: session.codeWord, guess });

    if (verdict.correct) {
      session.cleared = true;
      return res.json({
        correct: true,
        codeWord: session.codeWord, // 클리어 후에는 공개해도 안전
        state: toClientView(session),
      });
    }

    const { informed, trust } = loseTrust(session, allyId);
    res.json({
      correct: false,
      informed,
      trust,
      state: toClientView(session),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/stage/talk  { sessionId, allyId, message }
 * 동료 NPC 자유 대화. 응답을 SSE 로 스트리밍한다.
 *
 * 이 엔드포인트는 접선 코드를 프롬프트에 넣지 않는다 (dialogue.js 주석 참조).
 */
router.post('/talk', async (req, res) => {
  const { sessionId, allyId, message } = req.body ?? {};
  const session = getSession(sessionId);
  const ally = session && getAlly(session, allyId);

  if (!session || !ally) return res.status(404).json({ error: '세션 또는 동료를 찾을 수 없습니다.' });
  if (ally.arrested || ally.informed) {
    return res.status(409).json({ error: '대화할 수 없는 동료입니다.' });
  }
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: '빈 메시지입니다.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    const reply = await streamAllyReply({
      ally,
      word: ally.word,
      alertLevel: session.alertLevel,
      arrestedCount: arrestedCount(session),
      history: ally.history,
      userMessage: message,
      onText: (text) => send({ type: 'text', text }),
    });

    // 성공한 턴만 이력에 남긴다 (중간에 끊긴 응답을 이력에 넣으면 다음 턴이 오염된다).
    pushDialogue(session, allyId, 'user', message);
    pushDialogue(session, allyId, 'assistant', reply);

    send({ type: 'done' });
  } catch (err) {
    console.error('[talk]', err);
    // 헤더가 이미 나갔으므로 상태 코드를 바꿀 수 없다. 에러도 스트림으로 알린다.
    send({ type: 'error', error: err.message ?? '대화 생성 실패' });
  } finally {
    res.end();
  }
});

/**
 * GET /api/stage/:sessionId/answer — 개발용 정답 확인.
 *
 * 접선 코드는 원래 클라이언트로 내려가지 않는다(정답 비유출 원칙). 이 라우트는
 * 플레이테스트 편의를 위한 것으로, 환경변수 REVEAL_ANSWER=1 일 때만 동작한다.
 * 제출 빌드에서는 .env 에서 이 값을 빼면(또는 0) 완전히 비활성화된다.
 */
router.get('/:sessionId/answer', (req, res) => {
  if (process.env.REVEAL_ANSWER !== '1') {
    return res.status(403).json({ error: '정답 확인이 비활성화되어 있습니다. (.env 에 REVEAL_ANSWER=1 설정 후 재시작)' });
  }
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  res.json({
    codeWord: session.codeWord,
    category: session.category,
    // 동료별 연상 단어 + 떠올린 이유(wordGen 의 reason). 이 라우트 자체가 개발 전용이라
    // 코드 단서가 섞인 reason 을 내려도 괜찮다 — toClientView 의 비유출 원칙과는 별개다.
    allies: session.allies.map((a) => ({
      id: a.id,
      name: a.name,
      word: a.word,
      reason: a.reason,
    })),
  });
});

/** GET /api/stage/:sessionId — 현재 상태 조회 */
router.get('/:sessionId', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  res.json(toClientView(session));
});

export default router;
