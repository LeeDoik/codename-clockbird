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
  jailPlayer,
  freePlayer,
} from '../session.js';

const router = express.Router();

const load = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));

const loadData = () =>
  Promise.all([load('../../data/codewords.json'), load('../../data/personas.json')]).then(
    ([pool, personas]) => ({ pool, allies: personas.allies }),
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
    const { pool, allies } = await getData();
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

/** 발각 즉사 경계 레벨 — 이 수위부터는 검문 없이 즉시 구속이다 (스토리보드 레벨 3). */
const INSTANT_ARREST_ALERT = 3;

/**
 * POST /api/stage/checkpoint/start  { sessionId }
 * 순찰 로봇에게 발각됐다.
 *
 * 경계가 극에 달한 거리(레벨 3)에서는 검문이 열리지 않는다 — 로봇은 이미 수배 인상착의를
 * 받아 든 상태라 물어볼 것이 없다. "명령 수행형" 세계관에도 맞는다.
 */
router.post('/checkpoint/start', (req, res) => {
  const session = checkpointSession(req, res);
  if (!session) return;

  if (session.alertLevel >= INSTANT_ARREST_ALERT) {
    setGameOver(session, 'spotted');
    return res.json({ outcome: 'spotted', state: toClientView(session) });
  }
  // 창살 안에 있는 사람을 다시 검문할 수는 없다. 클라이언트도 갇힌 동안 순찰을 세우지만,
  // 늦게 도착한 요청 하나로 감옥 안에서 검문이 열리는 일이 없게 서버도 막는다.
  if (session.jailed) return res.status(409).json({ error: '감옥에 갇혀 있습니다.' });
  if (session.checkpointCooldownUntil > Date.now()) {
    return res.status(409).json({ error: '방금 검문을 통과했습니다.' });
  }

  // 앞단은 지연 0 인 타이밍 게임이다. LLM 은 이걸 놓쳤을 때만 부른다.
  session.checkpoint = { stage: 'qte', startedAt: Date.now() };
  res.json({ outcome: 'qte', state: toClientView(session) });
});

/**
 * POST /api/stage/checkpoint/qte  { sessionId, result: 'pass'|'fail' }
 *
 * 자석 수류탄 투척 결과 보고 — **검문은 여기서 끝난다**.
 *   - 명중(pass): 로봇이 굳고 빠져나간다. 경계는 오르지 않고 쿨다운만 걸린다.
 *   - 빗나감(fail): 붙잡혀 임시 감옥에 갇힌다 — **게임오버가 아니다** (/jail/escape 로 이어진다).
 *
 * ⚠ 2026-08-05 에 그 사이에 있던 **LLM 심문 단계를 걷어냈다** (기획 판단). 실패하면
 * 로봇이 질문을 던지고 /checkpoint/answer 가 답을 심사한 뒤, 거기서도 걸려야 비로소
 * 수류탄을 쓰는 3단 구조였다. 그때는 적발이 경계 +1 로 끝났지만 — 발각은 반복되는
 * 사건이라 한 번 걸렸다고 판이 끝나면 반복 플레이가 성립하지 않는다는 이유였다.
 *
 * ⚠ 같은 날 늦게, **빗나감이 게임오버이던 것을 감옥행으로 바꿨다** (기획 확정). 그
 * 사이에는 소모품이 완충이었다 — 조우마다 수류탄이 한 개씩 나가고 다 쓰면 다음 발각이
 * 즉사(스토리보드 p16 "게임오버 = 자석 수류탄 소진"). 지금은 수류탄이 없어도 죽지 않고
 * 감옥에 갇힐 뿐이라, 수류탄은 **감옥에 안 가는 수단**이지 목숨이 아니다.
 * 판을 끝내는 것은 경계 3 에서의 발각(/checkpoint/start 의 spotted)뿐이다.
 *
 * 라우트 이름은 qte 그대로 둔다 — 클라이언트·세션·쿨다운이 같은 이름을 물고 있고,
 * 바꿔 봐야 "검문 중 한 판"이라는 뜻은 같다.
 */
router.post('/checkpoint/qte', (req, res) => {
  const session = checkpointSession(req, res);
  if (!session) return;
  if (session.checkpoint?.stage !== 'qte') {
    return res.status(409).json({ error: '진행 중인 검문이 없습니다.' });
  }

  const passed = req.body?.result === 'pass';
  session.checkpoint = null;
  session.checkpointCooldownUntil = Date.now() + CHECKPOINT_COOLDOWN_MS;
  if (!passed) jailPlayer(session);

  console.log(`[checkpoint] 세션 ${session.id.slice(0, 8)} — 수류탄 ${passed ? '명중' : '빗나감 → 수감'}`);
  res.json({ outcome: passed ? 'pass' : 'jailed', state: toClientView(session) });
});

/**
 * POST /api/stage/jail/escape  { sessionId }
 * 감옥 탈출 — 창살 잠금장치를 풀었다.
 *
 * **성공만 보고한다.** 탈출 퍼즐은 실패해도 대가가 없고(경계도 오르지 않는다) 몇 번이든
 * 다시 딸 수 있어서, 실패는 서버가 알 필요가 없는 사건이다. 알릴 것이 없는 왕복을 만들면
 * 그 왕복이 실패했을 때 창살이 도로 잠기는 사고만 생긴다.
 *
 * 나오는 순간 재검문 쿨다운을 다시 건다 — 갇혀 있는 동안 처음 걸어 둔 쿨다운은 이미
 * 지났고, 창살 앞에 로봇이 서 있으면 나오자마자 도로 잡혀 감옥이 무한 반복된다.
 * (클라이언트도 같은 길이로 순찰 유예를 준다 — CHECKPOINT_COOLDOWN_MS 는 같은 값이다.)
 */
router.post('/jail/escape', (req, res) => {
  const session = checkpointSession(req, res);
  if (!session) return;
  if (!freePlayer(session)) return res.status(409).json({ error: '갇혀 있지 않습니다.' });

  session.checkpointCooldownUntil = Date.now() + CHECKPOINT_COOLDOWN_MS;
  console.log(`[jail] 세션 ${session.id.slice(0, 8)} — 창살 잠금장치 해제, 거리 복귀`);
  res.json({ state: toClientView(session) });
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
 * POST /api/stage/guess  { sessionId, targetId, guess }  (brokerId 도 하위호환 수용)
 * 접선 코드 입력. 정답 판정은 서버에서만 이뤄진다.
 *
 * 코드는 접선책 또는 체포되지 않은 동료 누구에게나 건넬 수 있다 (스펙 §4.2).
 * 클라이언트는 대상 앞에서만 입력창을 열지만, API 직접 호출로 임의의 상대를
 * 지정하지 못하게 서버도 대상을 화이트리스트로 검증해 우회를 막는다.
 */
router.post('/guess', async (req, res, next) => {
  try {
    const { sessionId, targetId, brokerId, guess } = req.body ?? {};
    const session = getSession(sessionId);

    if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
    if (session.cleared || session.gameOver) {
      return res.status(409).json({ error: '이미 종료된 세션입니다.' });
    }
    if (inCheckpoint(session)) return res.status(409).json({ error: '검문 중입니다.' });
    // 코드는 붙잡히지 않은 동료 누구에게나 건넬 수 있고, **맞히면 그 동료가 접선책이 된다**
    // (2026-08-04. 예전에는 별개 인물인 접선책이 창구였다).
    // 임의 문자열로 우회하지 못하게 대상 검증은 유지한다 (/alarm 화이트리스트와 같은 원칙).
    const target = targetId ?? brokerId;
    const validTarget = session.allies.some((a) => a.id === target && !a.arrested);
    if (!validTarget) {
      return res.status(400).json({ error: '코드를 건넬 수 있는 상대가 아닙니다.' });
    }

    const verdict = await judgeGuess({ codeWord: session.codeWord, guess });

    if (verdict.correct) {
      session.cleared = true;
      // 맞힌 상대가 곧 접선책이다 — 저택까지 데려가는 사람이라 클라이언트가 이 id 로
      // 연출과 스테이지 2 인계를 잇는다.
      session.contactId = target;
      return res.json({
        correct: true,
        codeWord: session.codeWord, // 클리어 후에는 공개해도 안전
        contactId: target,
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
