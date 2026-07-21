import express from 'express';
import { readFile } from 'node:fs/promises';
import { generateAssociations } from '../ai/wordGen.js';
import { judgeDuplicates, judgeGuess } from '../ai/judge.js';
import { streamAllyReply } from '../ai/dialogue.js';
import {
  createSession,
  getSession,
  toClientView,
  getAlly,
  contactAlly,
  rescueAlly,
  arrestedCount,
  pushDialogue,
  setGameOver,
  raiseAlert,
  inCheckpoint,
} from '../session.js';
import { generateInterrogation, judgeCheckpointAnswer } from '../ai/checkpoint.js';

const router = express.Router();

const load = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));

const loadData = () =>
  Promise.all([load('../../data/codewords.json'), load('../../data/personas.json')]).then(
    ([pool, personas]) => ({ pool, allies: personas.allies, broker: personas.broker }),
  );

// 프로덕션에서는 1회 읽고 캐시, 개발 모드에서는 매 스테이지 시작마다 다시 읽는다
// — 프롬프트 스튜디오에서 페르소나를 저장하면 서버 재시작 없이 다음 판부터 반영된다.
const isProd = process.env.NODE_ENV === 'production';
let dataCache = null;
function getData() {
  if (isProd) return (dataCache ??= loadData());
  return loadData();
}

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
    const { pool, allies, broker } = await getData();
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
      broker,
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

  if (inCheckpoint(session)) return res.status(409).json({ error: '검문 중입니다.' });

  const result = contactAlly(session, allyId);
  if (!result) return res.status(409).json({ error: '접선할 수 없는 동료입니다.' });

  // result.reason 은 코드 단어를 암시할 수 있는 서버 전용 필드라 응답에서 뺀다
  // (toClientView 의 비유출 원칙과 동일 — session.js contactAlly 참고).
  res.json({ word: result.word, newlyArrested: result.newlyArrested, state: toClientView(session) });
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

  if (inCheckpoint(session)) return res.status(409).json({ error: '검문 중입니다.' });

  const result = rescueAlly(session, allyId);
  if (!result) return res.status(409).json({ error: '구출할 수 없는 동료입니다.' });

  console.log(
    `[stage] 세션 ${session.id.slice(0, 8)} — ${result.name} 구출, 경계 레벨 ${result.alertLevel}`,
  );

  res.json({ ...result, state: toClientView(session) });
});

/**
 * 검문 통과 직후 재검문 금지 시간. 클라이언트의 순찰 유예(4초)에 대한 이중 안전망이다
 * — 통과하자마자 같은 자리에서 다시 잡히면 빠져나갈 방법이 없다.
 */
const CHECKPOINT_COOLDOWN_MS = 10_000;
/** 열어 둔 채 잊힌 검문은 파기한다 (탭을 놔두고 자리를 뜬 경우). */
const CHECKPOINT_STALE_MS = 120_000;
/** 자유 입력 답변 길이 상한 — 프롬프트를 통째로 밀어 넣는 시도를 입구에서 자른다. */
const MAX_ANSWER_LEN = 120;

/** 검문 라우트 공통 전처리: 세션 조회 + 종료 여부 확인. */
function checkpointSession(req, res) {
  const session = getSession(req.body?.sessionId);
  if (!session) {
    res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
    return null;
  }
  if (session.cleared || session.gameOver) {
    res.status(409).json({ error: '이미 종료된 세션입니다.' });
    return null;
  }
  return session;
}

/**
 * POST /api/stage/checkpoint/start  { sessionId }
 * 순찰 로봇에게 발각됐다.
 */
router.post('/checkpoint/start', (req, res) => {
  const session = checkpointSession(req, res);
  if (!session) return;

  if (session.checkpointCooldownUntil > Date.now()) {
    return res.status(409).json({ error: '방금 검문을 통과했습니다.' });
  }

  // 앞단은 지연 0 인 타이밍 게임이다. LLM 은 이걸 놓쳤을 때만 부른다.
  session.checkpoint = { stage: 'qte', startedAt: Date.now() };
  res.json({ outcome: 'qte', state: toClientView(session) });
});

/**
 * POST /api/stage/checkpoint/qte  { sessionId, result: 'pass'|'fail' }
 * 타이밍 게임 결과 보고. 통과면 대가 없이 끝나고, 실패면 LLM 심문이 열린다.
 */
router.post('/checkpoint/qte', async (req, res, next) => {
  try {
    const session = checkpointSession(req, res);
    if (!session) return;
    if (session.checkpoint?.stage !== 'qte') {
      return res.status(409).json({ error: '진행 중인 검문이 없습니다.' });
    }

    if (req.body?.result === 'pass') {
      session.checkpoint = null;
      session.checkpointCooldownUntil = Date.now() + CHECKPOINT_COOLDOWN_MS;
      return res.json({ outcome: 'pass', state: toClientView(session) });
    }

    const interrogation = await generateInterrogation({
      alertLevel: session.alertLevel,
      arrestedCount: arrestedCount(session),
    });
    session.checkpoint = {
      stage: 'question',
      startedAt: Date.now(),
      question: interrogation.question,
      choices: interrogation.choices,
    };

    res.json({
      outcome: 'question',
      question: interrogation.question,
      choices: interrogation.choices,
      state: toClientView(session),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/stage/checkpoint/answer  { sessionId, answer, source }
 * 심문 답변 심사. 적발되어도 게임오버가 아니라 경계 +1 후 풀려난다 — 발각은 반복되는
 * 사건이라, 한 번 걸렸다고 판이 끝나면 반복 플레이 자체가 성립하지 않는다.
 */
router.post('/checkpoint/answer', async (req, res, next) => {
  try {
    const session = checkpointSession(req, res);
    if (!session) return;

    const cp = session.checkpoint;
    if (cp?.stage !== 'question') return res.status(409).json({ error: '진행 중인 심문이 없습니다.' });
    if (Date.now() - cp.startedAt > CHECKPOINT_STALE_MS) {
      session.checkpoint = null;
      return res.status(409).json({ error: '검문이 만료되었습니다.' });
    }

    const raw = typeof req.body?.answer === 'string' ? req.body.answer.trim() : '';
    if (!raw) return res.status(400).json({ error: '빈 답변입니다.' });
    const answer = raw.slice(0, MAX_ANSWER_LEN);
    // 선택지에서 골랐다고 주장하지만 실제 선택지에 없으면 자유 입력으로 강등한다
    // — 심사 프롬프트가 "제시된 선택지"라는 이유로 관대해지는 걸 막는다.
    const source = req.body?.source === 'choice' && cp.choices.includes(answer) ? 'choice' : 'free';

    const verdict = await judgeCheckpointAnswer({
      question: cp.question,
      answer,
      answerSource: source,
      alertLevel: session.alertLevel,
      arrestedCount: arrestedCount(session),
    });

    session.checkpoint = null;
    session.checkpointCooldownUntil = Date.now() + CHECKPOINT_COOLDOWN_MS;

    if (verdict.verdict === 'caught') raiseAlert(session);

    console.log(
      `[checkpoint] 세션 ${session.id.slice(0, 8)} — ${source} "${answer}" → ${verdict.verdict} (${verdict.reason})`,
    );

    res.json({
      outcome: verdict.verdict,
      npcReply: verdict.npcReply,
      state: toClientView(session),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/stage/alarm  { sessionId, reason }
 * 소란 발생 — 경계 레벨만 올린다.
 *
 * 미니게임처럼 판정이 클라이언트에서 끝나는 사건이 대가를 치르는 통로다. 판정은
 * 브라우저가 내리지만 그 대가(경계 레벨)의 소유권은 서버가 갖는다. reason 을
 * 화이트리스트로 묶어 임의의 사유로 경계를 올리지 못하게 한다.
 */
const ALARM_REASONS = new Set(['lockpick']);

router.post('/alarm', (req, res) => {
  const { sessionId, reason } = req.body ?? {};
  const session = getSession(sessionId);

  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  if (session.cleared || session.gameOver) {
    return res.status(409).json({ error: '이미 종료된 세션입니다.' });
  }
  if (!ALARM_REASONS.has(reason)) return res.status(400).json({ error: '알 수 없는 사유입니다.' });

  const alertLevel = raiseAlert(session);
  res.json({ alertLevel, state: toClientView(session) });
});

/**
 * POST /api/stage/guess  { sessionId, brokerId, guess }
 * 접선 코드 입력. 정답 판정은 서버에서만 이뤄진다.
 *
 * 코드는 접선책에게만 건넬 수 있다 (스토리보드 확정). 클라이언트도 접선책 앞에서만
 * 입력창을 열지만, API 직접 호출로 우회하지 못하게 서버에서도 막는다 — /alarm 의
 * 화이트리스트와 같은 원칙이다.
 */
router.post('/guess', async (req, res, next) => {
  try {
    const { sessionId, brokerId, guess } = req.body ?? {};
    const session = getSession(sessionId);

    if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
    if (session.cleared || session.gameOver) {
      return res.status(409).json({ error: '이미 종료된 세션입니다.' });
    }
    if (inCheckpoint(session)) return res.status(409).json({ error: '검문 중입니다.' });
    if (brokerId !== session.broker?.id) {
      return res.status(400).json({ error: '접선책에게만 코드를 건넬 수 있습니다.' });
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

    // 오답 — 틀린 코드를 내밀었다는 소문이 새어 나간다. 신뢰도 대신 경계가 오른다.
    const alertLevel = raiseAlert(session);

    res.json({
      correct: false,
      alertLevel,
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
  if (ally.arrested) {
    return res.status(409).json({ error: '대화할 수 없는 동료입니다.' });
  }
  if (inCheckpoint(session)) return res.status(409).json({ error: '검문 중입니다.' });
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
