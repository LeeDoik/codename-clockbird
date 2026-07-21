# 스테이지 1 규칙 정합 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스테이지 1을 스토리보드 확정 규칙으로 정합 — 신뢰도·밀고 제거(실패 = 경계 +1), 경계 상한 3·레벨 3 발각 즉사, 접선책 NPC 신설 + 코드 입력 단일화.

**Architecture:** 상태·규칙의 권한은 전부 서버(`session.js`)에 있고 클라(Phaser)는 `toClientView` 결과를 표시만 한다. 서버 규칙을 먼저 바꾸고(스모크로 검증), 클라 UI를 뒤따라 맞춘다. 스펙: `docs/superpowers/specs/2026-07-21-stage1-rule-alignment-design.md`.

**Tech Stack:** Node 22 + Express 5 (ESM), Phaser 3.90, Vite 7. 테스트 프레임워크 없음 — 검증은 `scripts/smoke-talk-sse.js`(서버 필요) + `npm run build`(클라 문법) + 수동 플레이.

## Global Constraints

- 코드 단어·연상 이유(reason)는 절대 클라이언트로 내보내지 않는다 (`toClientView` 비유출 원칙).
- 경계 레벨: 초기 0, 상한 3. 상승 요인은 코드 오답 +1 / 구출 +1 / 자물쇠 실패 +1 / 검문 적발 +1.
- 레벨 2 = 증원(하부 홀 순찰 추가), 레벨 3 = 강화 + 발각 즉사(검문 없이 게임오버).
- 접선책은 연상 단어를 제출하지 않으며 체포·중복 판정 대상이 아니다.
- 주석·대사는 기존 파일의 한국어 문체를 따른다. 커밋 메시지도 기존 이력의 한국어 관례를 따른다.
- 스모크 실행법: 터미널 1 `npm run dev:server`, 터미널 2 `npm run smoke`. `.env`에 ANTHROPIC_API_KEY 필요 (이미 설정돼 있음).
- 스모크 마지막에 Windows에서 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` 가 나올 수 있다 — libuv/process.exit 이슈로 무해하다. 판정은 그 전에 출력된 OK/[!] 라인으로 한다.

---

### Task 1: 접선책 데이터·세션 노출 (서버)

**Files:**
- Modify: `src/data/personas.json`
- Modify: `src/client/assets/map.json:42`
- Modify: `src/server/session.js:21,46-64,84-111`
- Modify: `src/server/routes/stage.js:28-31,54-82`
- Test: `scripts/smoke-talk-sse.js`

**Interfaces:**
- Produces: `personas.broker = { id: 'fixer', name: '요른', role: '시계 수리공', spawn: {x,y} }` — 이후 모든 태스크가 이 id/구조에 의존.
- Produces: `createSession({ ..., broker })`가 `session.broker`에 저장, `toClientView()`가 `broker: { id, name, role, spawn }`을 응답에 포함.
- Produces: `map.json`의 `spawns.broker = { col: 15, row: 5 }` (걷기 가능 칸 — 중앙 상단 방, 동료 maid(13,3)와 2칸 이상 거리).

- [ ] **Step 1: 스모크에 실패하는 체크 추가**

`scripts/smoke-talk-sse.js`의 `console.log('start 응답에 codeWord 없음 — OK');` 바로 다음에 삽입:

```js
if (!state.broker?.id) {
  console.error('\n[!] start 응답에 접선책(broker)이 없다');
  process.exit(1);
}
console.log(`접선책: ${state.broker.name} (${state.broker.role}) — OK`);
```

- [ ] **Step 2: 실패 확인**

Run: 터미널 1에서 `npm run dev:server`, 터미널 2에서 `npm run smoke`
Expected: `[!] start 응답에 접선책(broker)이 없다` 출력 후 종료.

- [ ] **Step 3: personas.json에 broker 추가**

`src/data/personas.json`의 `allies` 배열 닫힘(`]`) 뒤, 최상위에 추가 (`_comment`도 갱신):

```json
{
  "_comment": "동료 NPC 5인 + 접선책 1인. persona 는 연상 단어 생성과 자유 대화 양쪽의 시스템 프롬프트에 주입된다. 직업이 서로 겹치지 않아야 연상 방향이 갈라진다. broker(접선책)는 단어를 제출하지 않으므로 wordGen 에 들어가지 않는다.",
  "allies": [ ...기존 5인 그대로... ],
  "broker": {
    "id": "fixer",
    "name": "요른",
    "role": "시계 수리공",
    "spawn": { "x": 496, "y": 176 }
  }
}
```

(spawn 픽셀값은 map.json의 col 15·row 5 중앙 = 15×32+16, 5×32+16. 클라는 map.json을 우선 쓰고 이 값은 폴백.)

- [ ] **Step 4: map.json에 broker 스폰 추가**

`src/client/assets/map.json`의 `"citizen": { "col": 10, "row": 11 }` 뒤에:

```json
    "citizen": { "col": 10, "row": 11 },
    "broker": { "col": 15, "row": 5 }
```

- [ ] **Step 5: session.js — createSession이 broker를 받아 저장, toClientView가 내보냄**

`src/server/session.js:21` 시그니처에 `broker` 추가:

```js
export function createSession({ codeWord, category, allies, associations, duplicateGroups, arrestedIds = [], broker = null }) {
```

`sessions.set(id, {...})` 객체의 `allies: allyState,` 다음 줄에:

```js
    // 접선책 — 코드를 건넬 유일한 창구. 단어를 내지 않으므로 체포·중복 판정과 무관하다.
    broker,
```

`toClientView()`의 `alertLevel: session.alertLevel,` 다음 줄에 (word/reason이 없는 정적 정보라 그대로 내려도 안전):

```js
    broker: session.broker,
```

- [ ] **Step 6: stage.js — loadData와 /start에 broker 연결**

`src/server/routes/stage.js:28-31`:

```js
const loadData = () =>
  Promise.all([load('../../data/codewords.json'), load('../../data/personas.json')]).then(
    ([pool, personas]) => ({ pool, allies: personas.allies, broker: personas.broker }),
  );
```

`/start` 핸들러(`:54-82`): `const { pool, allies } = await getData();` → `const { pool, allies, broker } = await getData();`, `createSession({...})` 인자에 `broker,` 추가.

- [ ] **Step 7: 스모크 통과 확인**

Run: `npm run smoke` (dev:server 켠 채)
Expected: `접선책: 요른 (시계 수리공) — OK` 포함, 이후 기존 체크 전부 통과.

- [ ] **Step 8: Commit**

```bash
git add src/data/personas.json src/client/assets/map.json src/server/session.js src/server/routes/stage.js scripts/smoke-talk-sse.js
git commit -m "feat: 접선책(시계 수리공 요른) 신설 — 코드를 건넬 유일한 창구의 데이터·세션 노출"
```

---

### Task 2: 신뢰도·밀고 제거 + /guess 개편 (서버)

**Files:**
- Modify: `src/server/session.js` (13-19, 33, 40, 100-108, 128, 155-181, 211-225, 246-262, 264)
- Modify: `src/server/routes/stage.js` (6-21 import, 299-340 /guess, 354 /talk)
- Test: `scripts/smoke-talk-sse.js`

**Interfaces:**
- Consumes: Task 1의 `session.broker.id` (= `'fixer'`).
- Produces: `POST /api/stage/guess` 요청 바디 `{ sessionId, brokerId, guess }`. `brokerId !== session.broker.id`면 400. 오답 응답 `{ correct: false, alertLevel: number, state }` — `informed`/`trust` 필드 소멸. 정답 응답은 기존 그대로 `{ correct: true, codeWord, state }`.
- Produces: `rescueAlly()` 반환 `{ allyId, name, alertLevel }` (trust 없음). `toClientView().allies[]`에서 `trust`/`maxTrust`/`informed` 소멸.

- [ ] **Step 1: 스모크에 실패하는 체크 추가**

`scripts/smoke-talk-sse.js` 끝부분, `console.log('\nSSE 경로 정상.\n');` 바로 앞에 삽입:

```js
console.log('\n규칙 정합 체크...');

// 신뢰도·밀고 필드는 응답에서 사라져야 한다
if (JSON.stringify(state).includes('"trust"') || JSON.stringify(state).includes('"informed"')) {
  console.error('[!] start 응답에 신뢰도/밀고 필드가 남아 있다');
  process.exit(1);
}
console.log('상태 응답에 trust/informed 없음 — OK');

// 코드는 접선책에게만 — 동료 id 로 건네면 400
const oldWay = await post('/api/stage/guess', {
  sessionId: state.sessionId, brokerId: target.id, guess: '아무말',
});
if (oldWay.status !== 400) {
  console.error(`[!] 동료 대상 코드 입력이 ${oldWay.status} — 400 이어야 한다`);
  process.exit(1);
}
console.log('동료 대상 코드 입력 거부(400) — OK');

// 오답 → 경계 +1 (신뢰도 하락이 아니라)
const g1 = await post('/api/stage/guess', {
  sessionId: state.sessionId, brokerId: state.broker.id, guess: '전혀상관없는말',
});
const g1body = await g1.json();
if (g1body.correct !== false || g1body.alertLevel !== 1) {
  console.error('[!] 오답이 경계 +1 이 아니다:', JSON.stringify(g1body).slice(0, 200));
  process.exit(1);
}
if (JSON.stringify(g1body).includes('"trust"') || JSON.stringify(g1body).includes('"informed"')) {
  console.error('[!] guess 응답에 신뢰도/밀고 필드가 남아 있다');
  process.exit(1);
}
console.log('오답 → 경계 1 — OK');
```

- [ ] **Step 2: 실패 확인**

Run: `npm run smoke`
Expected: `[!] start 응답에 신뢰도/밀고 필드가 남아 있다` 로 실패 (구버전 서버는 trust를 내려보낸다).

- [ ] **Step 3: session.js에서 신뢰도·밀고를 걷어낸다**

각 위치를 다음과 같이 수정:

1. `:13-19`의 `MAX_TRUST`·`RESCUED_TRUST` 상수 선언(주석 포함) 삭제. 파일 끝 `:264` `export { MAX_TRUST };` 삭제.
2. `createSession` ally 상태(`:33,40`)에서 `trust: MAX_TRUST,` 와 `informed: false,` 줄 삭제.
3. `toClientView` allies 매핑: `word` 조건과 신뢰도 필드 정리 —

```js
      // 단어는 접선(대화)한 뒤에만 내려간다 — 접선하기 전엔 알 수 없다. 체포된 동료의 단어도 감춘다.
      word: a.contacted && !a.arrested ? a.word : null,
      contacted: a.contacted,
      arrested: a.arrested,
```

(`trust`/`maxTrust`/`informed` 세 줄 삭제, `rescued`는 유지.)

4. `contactAlly` 가드(`:128`): `if (!ally || ally.arrested) return null;` 로, jsdoc의 "(없음·체포·밀고)" → "(없음·체포)".
5. `rescueAlly`(`:155-181`): informed 가드와 trust 강등 삭제, 반환에서 trust 제거 —

```js
/**
 * 감옥의 동료를 구출한다.
 *
 * 대가로 경계 레벨이 오른다 — 창살을 뜯는 소란은 반드시 새어 나간다. 구출이 공짜라면
 * "일단 전원 구출하고 시작"이 항상 최적해가 되어 체포 메커닉 전체가 죽는다.
 *
 * 전원 체포로 접선할 상대가 없는 판에서는 이것이 유일한 활로다.
 *
 * @returns {{ allyId: string, name: string, alertLevel: number } | null} 감옥에 없으면 null.
 */
export function rescueAlly(session, allyId) {
  const ally = getAlly(session, allyId);
  if (!ally || !ally.arrested) return null;

  ally.arrested = false;
  ally.rescued = true;
  session.alertLevel += 1;

  return { allyId: ally.id, name: ally.name, alertLevel: session.alertLevel };
}
```

6. `informedCount`(`:211-214`)·`isUnwinnable`(`:216-225`)·`loseTrust`(`:246-262`) 함수를 주석째 삭제.
7. `setGameOver` jsdoc(`:231`): `@param {'caught'|'spotted'} reason` 로. (spotted는 Task 3에서 실제 사용.)

- [ ] **Step 4: stage.js — import 정리, /guess 개편, /talk 가드 축소**

1. import 블록(`:6-21`)에서 `loseTrust,`·`isUnwinnable,`·`informedCount,` 제거.
2. `/guess`(`:299-340`) 전체 교체:

```js
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
```

3. `/talk` 가드(`:354`): `if (ally.arrested || ally.informed)` → `if (ally.arrested)`, 에러 메시지는 그대로.
4. `/checkpoint/start`(`:170-173`)의 밀고자 분기를 삭제 — import이 사라진 `informedCount`를 그대로 두면 검문 요청 시 ReferenceError 로 터진다. jsdoc의 "밀고자가 한 명이라도 있으면…" 문단도 함께 지운다 (레벨 3 즉사 분기는 Task 3에서 새로 넣는다):

```js
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
```

5. `/checkpoint/answer` jsdoc(`:227`)의 괄호 문장 "(밀고자가 있는 판이라면 애초에 /checkpoint/start 에서 즉시 구속으로 끝난다.)" 삭제.

- [ ] **Step 5: 서버 기동 확인 후 스모크 통과 확인**

Run: dev:server 재기동(--watch가 자동 반영, 콘솔에 에러 없는지 확인) 후 `npm run smoke`
Expected: `상태 응답에 trust/informed 없음 — OK`, `동료 대상 코드 입력 거부(400) — OK`, `오답 → 경계 1 — OK` 전부 출력.

- [ ] **Step 6: 남은 참조 확인**

Run: `grep -rn "loseTrust\|isUnwinnable\|informedCount\|MAX_TRUST\|RESCUED_TRUST" src/server/`
Expected: 결과 없음. (클라이언트의 `trust`/`informed` 참조는 Task 5에서 제거 — 여기서는 서버만.)

- [ ] **Step 7: Commit**

```bash
git add src/server/session.js src/server/routes/stage.js scripts/smoke-talk-sse.js
git commit -m "feat: 신뢰도·밀고 제거 — 코드 오답은 경계 +1, 코드는 접선책에게만"
```

---

### Task 3: 레벨 3 발각 즉사 (서버)

**Files:**
- Modify: `src/server/routes/stage.js:159-181` (/checkpoint/start)
- Test: `scripts/smoke-talk-sse.js`

**Interfaces:**
- Consumes: Task 2의 `/guess` 오답 = 경계 +1 (스모크가 경계를 3까지 올리는 수단).
- Produces: `POST /api/stage/checkpoint/start` — `session.alertLevel >= 3`이면 `{ outcome: 'spotted', state }` 응답 + `setGameOver(session, 'spotted')`. 클라(Task 5)는 `outcome === 'spotted'`에 의존.

- [ ] **Step 1: 스모크에 실패하는 체크 추가**

Task 2에서 넣은 `console.log('오답 → 경계 1 — OK');` 다음에 삽입:

```js
// 오답을 반복해 경계 3(상한)까지 올린다
for (const n of [2, 3]) {
  const g = await post('/api/stage/guess', {
    sessionId: state.sessionId, brokerId: state.broker.id, guess: `전혀상관없는말${n}`,
  });
  const body = await g.json();
  if (body.alertLevel !== n) {
    console.error(`[!] 오답 ${n}회째 경계가 ${body.alertLevel} — ${n} 이어야 한다`);
    process.exit(1);
  }
}
console.log('오답 누적 → 경계 3 — OK');

// 경계 3에서 발각되면 검문 없이 즉시 구속
const cp = await post('/api/stage/checkpoint/start', { sessionId: state.sessionId });
const cpBody = await cp.json();
if (cpBody.outcome !== 'spotted' || !cpBody.state?.gameOver) {
  console.error(`[!] 경계 3 발각이 즉사가 아니다 — outcome: ${cpBody.outcome}, gameOver: ${cpBody.state?.gameOver}`);
  process.exit(1);
}
console.log('경계 3 발각 → 즉시 구속(spotted) — OK');
```

- [ ] **Step 2: 실패 확인**

Run: `npm run smoke`
Expected: `[!] 경계 3 발각이 즉사가 아니다 — outcome: qte, ...` 로 실패.

- [ ] **Step 3: /checkpoint/start에 즉사 분기**

`src/server/routes/stage.js`의 `/checkpoint/start`(Task 2에서 밀고자 분기를 걷어낸 상태)를 교체:

```js
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
  if (session.checkpointCooldownUntil > Date.now()) {
    return res.status(409).json({ error: '방금 검문을 통과했습니다.' });
  }

  // 앞단은 지연 0 인 타이밍 게임이다. LLM 은 이걸 놓쳤을 때만 부른다.
  session.checkpoint = { stage: 'qte', startedAt: Date.now() };
  res.json({ outcome: 'qte', state: toClientView(session) });
});
```

- [ ] **Step 4: 스모크 통과 확인**

Run: `npm run smoke`
Expected: `오답 누적 → 경계 3 — OK`, `경계 3 발각 → 즉시 구속(spotted) — OK` 포함 전부 통과.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/stage.js scripts/smoke-talk-sse.js
git commit -m "feat: 경계 3 발각 즉사 — 극에 달한 거리에서는 검문 없이 끝난다"
```

---

### Task 4: 접선책 배치와 입력 흐름 재편 (클라)

**Files:**
- Modify: `src/client/scenes/StageScene.js` (26-28 상수, 79-101 노드, 163-179 브리핑, 122 도움말, 398-406 키, 535-576 근접, 586-619 접선, 798-852 코드 제출)

**Interfaces:**
- Consumes: `state.broker = { id, name, role, spawn }` (Task 1), `POST /api/stage/guess { sessionId, brokerId, guess }` → 오답 `{ correct: false, alertLevel, state }` (Task 2), `mapData.spawns.broker` (Task 1).
- Produces: F키 분기 — 접선책 앞이면 코드 입력창, 동료 앞이면 단어 확인만. 이후 태스크가 의존하는 신규 인터페이스 없음.

- [ ] **Step 1: 접선책 노드 생성**

`src/client/scenes/StageScene.js:28` `CITIZEN_FRAME` 아래에:

```js
// 접선책은 시민과 같은 프레임을 쓴다 — 전용 스프라이트는 에셋 확장 때 교체한다.
const BROKER_FRAME = 6;
```

`create()`의 동료 배치 `forEach` 블록(`:81-101`) 바로 다음에:

```js
    // 접선책 — 코드를 건넬 유일한 창구. 단어를 내지 않으므로 체포·중복 판정과 무관하다.
    const bz = mapData.spawns.broker;
    const bpos = bz
      ? { x: bz.col * TILE + TILE / 2, y: bz.row * TILE + TILE / 2 }
      : this.state.broker.spawn;
    this.brokerNode = this.add.sprite(bpos.x, bpos.y, 'chars', BROKER_FRAME);
    this.add
      .text(bpos.x, bpos.y - 24, this.state.broker.name, {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '11px',
        color: '#8a7f6a',
      })
      .setOrigin(0.5);
```

`init()`(`:37-39` 부근)에 `this.nearbyBroker = null;` 추가.

- [ ] **Step 2: 근접 판정에 접선책 추가**

`#checkProximity()`(`:535-576`)에서 for 루프 다음, `if (found !== this.nearbyAlly ...)` 앞에:

```js
    const bd = Phaser.Math.Distance.Between(
      this.player.x, this.player.y, this.brokerNode.x, this.brokerNode.y,
    );
    const broker = bd < TALK_RANGE ? this.state.broker : null;
```

조건과 힌트 블록을 다음으로 교체 (우선순위: 동료 > 접선책 > 감옥):

```js
    if (found !== this.nearbyAlly || jailed !== this.nearbyJailed || broker !== this.nearbyBroker) {
      this.nearbyAlly = found;
      this.nearbyJailed = jailed;
      this.nearbyBroker = broker;
      const target = found ?? broker ?? jailed;
      if (target && !this.dialogue.isOpen) {
        this.dialogue.show(
          target.name,
          found
            ? `${found.name} — [E] 대화 · [F] 접선(단어 확인)`
            : broker
              ? `${broker.name} (${broker.role}) — [E] 대화 · [F] 코드 전달`
              : `${jailed.name} — 창살 너머에 있다. [R] 구출 (경계 레벨 +1)`,
        );
        this.proximityHint = true;
      } else if (!target && this.proximityHint) {
        this.dialogue.hide();
        this.proximityHint = false;
      }
    }
```

(기존 주석 두 개 — "감옥 슬롯 간격…", "지나가며 뜬 안내만…" — 은 그대로 둔다.)

- [ ] **Step 3: E/F 키 분기**

`update()`의 키 처리(`:400-406`)를 교체:

```js
    if (!typing && Phaser.Input.Keyboard.JustDown(this.keyE)) {
      if (this.nearbyAlly) this.#talk(this.nearbyAlly);
      else if (this.nearbyBroker) this.#talkBroker();
    }
    // F — 동료 앞이면 접선(단어 확인), 접선책 앞이면 코드 전달
    if (!typing && Phaser.Input.Keyboard.JustDown(this.keyF)) {
      if (this.nearbyAlly) this.#contactAlly(this.nearbyAlly);
      else if (this.nearbyBroker) this.#offerCodeToBroker();
    }
```

- [ ] **Step 4: #offerCode를 둘로 쪼갠다 — 접선(단어만)과 코드 전달**

기존 `#offerCode`(`:586-619`)를 삭제하고 다음 두 메서드로 교체:

```js
  /** F — 접선: NPC 가 흘린 연상 단어(단서)를 밝혀 단서 수첩에 기록한다. 코드 입력은 접선책 전용. */
  async #contactAlly(ally) {
    if (this.contacting) return;
    this.contacting = true;
    this.dialogue.show(`${ally.name} (${ally.role})`, '조심스럽게 접선을 시도한다...');

    let contact;
    try {
      const res = await fetch('/api/stage/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.state.sessionId, allyId: ally.id }),
      });
      contact = await res.json();
      if (!res.ok) throw new Error(contact.error ?? `HTTP ${res.status}`);
    } catch (err) {
      this.dialogue.show('오류', err.message);
      return;
    } finally {
      this.contacting = false;
    }

    this.state = contact.state;
    this.#recordClue(ally, contact.word);
    this.#syncAllyNodes();

    this.dialogue.show(
      `${ally.name} (${ally.role})`,
      `"...「${contact.word}」."\n\n그가 흘린 단서다. [C] 단서 수첩에 기록됐다.\n코드를 확신하게 되면 시계 수리공에게 가라.`,
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  /** E — 접선책 고정 대사. 자유 대화(LLM)는 붙이지 않는다 — 그는 말을 아끼는 인물이다. */
  #talkBroker() {
    const b = this.state.broker;
    this.proximityHint = false;
    this.dialogue.show(
      `${b.name} (${b.role})`,
      '태엽 감는 소리 사이로 짧은 한마디.\n"동료들의 단어에서 겹치는 것을 찾아라. 그게 코드다."',
    );
    this.dialogue.setHint('[F] 코드 전달 · [Space] 닫기');
  }

  /** F — 접선책에게 코드를 건넨다. 입력창은 오직 여기서만 열린다. */
  #offerCodeToBroker() {
    const b = this.state.broker;
    this.proximityHint = false;
    this.dialogue.show(
      `${b.name} (${b.role})`,
      '수리공이 시계에서 눈을 떼지 않은 채 낮게 묻는다.\n"…코드는?"',
    );
    this.dialogue.showInput('접선 코드 입력...', 'code');
    this.dialogue.setHint('[Enter] 코드 전달 · [Esc] 취소');
  }
```

- [ ] **Step 5: #submitGuess를 접선책 대상으로 개편**

`#submitGuess`(`:798-852`)에서:

1. fetch 바디: `allyId: this.currentAllyId,` → `brokerId: this.state.broker.id,`
2. 오답 처리(기존 `if (result.informed) {...} else {...}` 블록과 마지막 `if (this.state.gameOver) ...` 줄)를 다음으로 교체:

```js
      this.#syncAllyNodes();

      this.dialogue.show(
        '접선 실패',
        `틀렸다. 수리공이 말없이 고개를 젓는다.\n거리에 소문이 샌다 — 경계 레벨 ${this.state.alertLevel}.`,
      );
```

(입력창은 열린 채 둔다 — 기존 실패 흐름과 같게 재시도를 허용한다. `/guess`는 더 이상 게임오버를 만들지 않으므로 gameOver 분기도 필요 없다.)

- [ ] **Step 6: 브리핑·도움말 문구 정리**

1. `:122` 하단 도움말: `'[E] 대화    [F] 접선 코드    [R] 구출    [C] 단서 수첩'` → `'[E] 대화    [F] 접선    [R] 구출    [C] 단서 수첩'`
2. `#showBriefing`(`:169`): `'품 안에 접선책이 남긴 쪽지가 잡힌다.\n'` → `'품 안에 조직이 남긴 쪽지가 잡힌다.\n'`
3. `#showBriefing` 전원 체포 분기(`:175`): `밖에 남은 접선책이 없다 — 감옥에서 직접 빼내는 수밖에 없다.` → `단서를 쥔 동료가 밖에 없다 — 감옥에서 직접 빼내는 수밖에 없다.` (접선책이 실제 NPC가 됐으므로 "접선책이 없다"는 서술은 이제 틀린 말이다.)

- [ ] **Step 7: 빌드로 문법 확인**

Run: `npm run build`
Expected: 에러 없이 완료.

- [ ] **Step 8: 수동 확인**

dev 서버(`npm run dev`) + 브라우저(localhost:5173):
- 중앙 상단 방에 "요른" 표시, 다가가면 `[E] 대화 · [F] 코드 전달` 힌트.
- 동료에게 F → 단어만 얻고 코드 입력창이 뜨지 않는다.
- 요른에게 F → 코드 입력창. 오답 입력 → "경계 레벨 1" 대사, HUD 경계 1.
- 요른에게 E → 고정 대사.

- [ ] **Step 9: Commit**

```bash
git add src/client/scenes/StageScene.js
git commit -m "feat: 코드 입력을 접선책 전용으로 — 동료 접선은 단어 확인만 남는다"
```

---

### Task 5: 신뢰도 UI 제거 + 경계 3단계 반영 (클라)

**Files:**
- Modify: `src/client/scenes/StageScene.js` (89-90, 137-138, 153-156, 283-304, 337, 470-473, 502-510, 541-542, 641, 706-715, 858-885)
- Modify: `src/client/ui/ResultOverlay.js:14-20`
- Modify: `src/client/entities/Patrol.js:19-20,30-43`
- Modify: `src/client/minigames/timingLock.js:21-22`

**Interfaces:**
- Consumes: `/checkpoint/start`의 `outcome: 'spotted'` (Task 3), allies 응답에 trust/informed 없음 (Task 2).
- Produces: `ResultOverlay OUTCOMES.spotted`. `REINFORCE_AT = 2`, `MAX_LEVEL = 3` (Patrol·timingLock).

- [ ] **Step 1: StageScene에서 신뢰도·밀고 흔적 제거**

1. `:89-90`: `else if (ally.informed) node.setTint(0xb87a3a).setAlpha(0.4);` 줄 삭제 (`if (ally.arrested) ...`만 남긴다).
2. `#checkProximity` `:541-542`: `if (ally.informed) continue; // 밀고자는 접선도 구출도 대상이 아니다` 줄 삭제.
3. `#updateHud`(`:283-304`): active 계산과 신뢰도 줄 제거 —

```js
  #updateHud() {
    // 상태가 바뀔 때마다 반드시 지나가는 길목이라, 증원 판정도 여기서 함께 본다.
    this.#maybeReinforce();

    const active = this.state.allies.filter((a) => !a.arrested);
    const lines = [
      `경계 레벨 ${this.state.alertLevel} / 3   |   접선 가능 ${active.length}/${this.state.allies.length}`,
    ];
```

(디버그 블록과 `this.hud.setText(lines.join('\n'));`는 그대로.)

4. `#tryRescue` `:641`: `filter((a) => a.arrested && !a.informed)` → `filter((a) => a.arrested)`.
5. `#rescue` 성공 대사(`:706-715`): trust 게이지 줄 제거 —

```js
    const freed = this.state.allies.find((a) => a.id === ally.id);
    this.dialogue.show(
      `${ally.name} (${ally.role})`,
      `${freed.name}이(가) 창살 밖으로 빠져나와 제자리로 돌아갔다.\n\n` +
        `소란이 새어 나갔다 — 경계 레벨 ${result.alertLevel}.\n\n` +
        `[F] 로 다시 접선할 수 있다. 그가 떠올린 단어는\n둘이 겹쳐 낸 만큼 확실한 단서다.`,
    );
```

6. `#syncAllyNodes`(`:881-884`): `} else if (updated.informed) { ... }` 분기 삭제. 메서드 상단 jsdoc의 "밀고된 동료는 흐리게" 문구도 삭제.
7. `#rescue` 상단 jsdoc(`:653`): "대가(경계 레벨·신뢰도) 계산은" → "대가(경계 레벨) 계산은".

- [ ] **Step 2: 검문 시작/적발 흐름을 spotted·3단계로**

`#startCheckpoint`(`:470-473`)의 informerCaught 분기 교체:

```js
      // 경계가 극에 달한 거리 — 로봇은 묻지 않는다.
      if (started.outcome === 'spotted') {
        this.#endGame('spotted');
        return;
      }
```

적발 대사(`:502-510`) 교체:

```js
      if (outcome === 'caught') {
        this.dialogue.show(
          '검문 적발',
          '진술이 받아들여지지 않았다. 기록이 남았다.\n\n' +
            `경계 레벨이 올라갔다. (${this.state.alertLevel}/3)\n` +
            '경계가 극에 달하면 다음 발각은 검문도 없이 끝난다.',
        );
        this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
      }
```

`#endGame` jsdoc(`:337`): `@param {'cleared'|'caught'|'informerCaught'|'allInformed'} outcome` → `@param {'cleared'|'caught'|'spotted'} outcome`.

- [ ] **Step 3: ResultOverlay 결말 교체**

`src/client/ui/ResultOverlay.js:14-20`:

```js
/** outcome → [제목, 첫 줄] */
const OUTCOMES = {
  cleared: ['잠입 성공', '접선에 성공했다. 동료들이 흩어지기 시작한다.'],
  caught: ['검문 적발', '순찰 로봇의 심문을 통과하지 못했다.'],
  spotted: ['현장 검거', '경계가 극에 달한 거리였다. 로봇은 묻지 않고 팔을 뻗었다.'],
};
```

- [ ] **Step 4: 경계 상한 3·증원 레벨 2**

1. `src/client/entities/Patrol.js:19-20`:

```js
/** 경계 레벨이 아무리 올라도 이 이상 빨라지지 않는다 (min(alert, MAX_LEVEL)). 레벨 3 은 발각 즉사 단계다. */
const MAX_LEVEL = 3;
```

2. `Patrol.js:30-43` — lowerHall 주석과 `REINFORCE_AT` 갱신:

```js
/**
 * 순찰 경로.
 *  - corridor: 중앙 복도(행 7~10)를 도는 상주 1기. 경계 0 에서도 항상 있다.
 *  - lowerHall: 하부 홀(행 12~16) 증원. 경계 2(증원 단계) 이상에서만 배치된다 —
 *    코드 오답·구출·자물쇠 소동이 쌓여야 순찰이 깨어나는 구조라, 조용히 푸는
 *    판에서는 검증된 기존 동선이 그대로 보존된다.
 */
export const PATROL_ROUTES = {
  corridor: [at(3, 8), at(24, 8), at(24, 10), at(3, 10)],
  lowerHall: [at(3, 13), at(24, 13), at(24, 16), at(3, 16)],
};

/** 하부 홀 증원이 붙는 경계 레벨 (스토리보드: 레벨 2 = 증원) */
export const REINFORCE_AT = 2;
```

3. `src/client/minigames/timingLock.js:21-22`:

```js
/** 경계 레벨 상한 — Patrol 과 같은 값을 쓴다 */
const MAX_LEVEL = 3;
```

4. `StageScene.js:137-138` `#spawnPatrols` jsdoc: "하부 홀 증원은 경계 1 이상에서만 붙는다. 조용히 푸는 판에서는 검증된 기존 동선이 그대로 남고, 구출(+1)·밀고(+1)가 순찰을 깨운다." → "하부 홀 증원은 경계 2(증원 단계)부터 붙는다. 코드 오답·구출·자물쇠 소동이 쌓이면 순찰이 깨어난다."
5. `StageScene.js:153` `#maybeReinforce` 주석: "경계가 처음 오르는 순간 하부 홀에 증원이 붙는다." → "경계가 증원 단계(2)에 이르는 순간 하부 홀에 증원이 붙는다."

- [ ] **Step 5: 남은 참조 확인 + 빌드**

Run: `grep -rn "informed\|trust\|maxTrust" src/client/`
Expected: 결과 없음 (혹시 남으면 해당 위치도 정리).
Run: `npm run build`
Expected: 에러 없이 완료.

- [ ] **Step 6: 수동 확인**

dev 서버 + 브라우저:
- HUD가 `경계 레벨 0 / 3 | 접선 가능 N/5` 형태, 신뢰도 게이지 없음.
- 요른에게 오답 2회 → 경계 2가 되는 순간 하부 홀에 순찰 2기째 등장.
- 오답 3회(경계 3) 후 순찰에게 발각 → 검문 패널 없이 즉시 "현장 검거" 결과 화면.
- 감옥 동료 구출 → 대사에 신뢰도 문구 없음, 경계 +1 표시.

- [ ] **Step 7: 전체 스모크 재실행**

Run: `npm run smoke`
Expected: 전 체크 통과 (Task 1~3에서 넣은 체크 포함).

- [ ] **Step 8: Commit**

```bash
git add src/client/scenes/StageScene.js src/client/ui/ResultOverlay.js src/client/entities/Patrol.js src/client/minigames/timingLock.js
git commit -m "feat: 경계 3단계 — 레벨 2 증원, 레벨 3 발각 즉사, 신뢰도 UI 퇴장"
```

---

### Task 6: 문서 동기화

**Files:**
- Modify: `NAN2026_계획서.md` (§4.6 표 147-160, §4.4 부근 레벨 서술이 있으면 함께)
- Modify: `스토리보드_수정안_0721.md` (§3 216-223, §4 227-236)

**Interfaces:**
- Consumes: Task 1~5의 구현 결과 (문서는 코드를 따라간다).
- Produces: 없음 (문서 정리).

- [ ] **Step 1: 계획서 §4.6 표 갱신**

`NAN2026_계획서.md`의 §4.6 표에서:
- 행 #2 (접선 코드 입력): 조치 열을 `~~입력 진입점을 접선책 1인으로 제한~~ **반영 완료 (2026-07-21)** — 접선책 NPC(요른, 시계 수리공) 신설, /guess 는 brokerId 필수`로.
- 행 #3 (경계 레벨 상한): 조치 열을 `~~상한 3으로 조정~~ **반영 완료 (2026-07-21)** — 초기 0 · 상한 3, 레벨 2 증원(REINFORCE_AT), 레벨 3 발각 즉사(INSTANT_ARREST_ALERT)`로.
- 행 #4 (신뢰도·밀고): 조치 열을 `**결정·반영 완료 (2026-07-21)** — 스테이지 1 신뢰도·밀고 제거, 코드 오답 = 경계 +1. isUnwinnable 은 밀고 소멸로 함께 제거(전원 체포여도 구출 활로가 있어 unwinnable 상태가 없다). 신뢰도는 튜토리얼(신뢰도 2)에만 남는다`로.
- 행 #6 (구출 보상): 조치 열 끝의 "구출 시 경계 +1은 스토리보드에 명시 추가 검토" → "구출 시 경계 +1 유지 확정 (2026-07-21) — 스토리보드 p.16에 명시 필요".

- [ ] **Step 2: 수정안 §3·§4 갱신**

`스토리보드_수정안_0721.md`:
- §3 항목 3 (신뢰도 관계 정리): 끝에 `→ **결정 (2026-07-21): 스테이지 1 신뢰도 제거.** 코드 오답 = 경계 +1 로 전환, 구현 반영 완료. p.16 위험 요소에는 "코드 오답 → 경계 +1" 로 기재.` 추가.
- §3 항목 4 (경비 레벨 초기값): 끝에 `→ **결정 (2026-07-21): 초기 0 · 상한 3 확정.** 상승 요인: 코드 오답·구출·자물쇠 실패·검문 적발 (각 +1).` 추가.
- §4 항목 6 (구출 시 경계 +1): 끝에 `→ **결정 (2026-07-21): 유지.** 스토리보드 p.16에 "구출 성공 시에도 소동으로 경계 레벨 +1" 명시 추가.` 추가.
- §4 항목 5 (접선 코드 입력 진입점): 끝에 `→ 반영 완료 (2026-07-21).` 추가.
- §4 항목 7 (동료 인원 구성): 끝에 `→ 구현 반영 (2026-07-21): 동료 5(단어 제출) + 접선책 요른(fixer, 단어 미제출) 확정.` 추가.

- [ ] **Step 3: Commit**

```bash
git add NAN2026_계획서.md 스토리보드_수정안_0721.md
git commit -m "docs: 규칙 정합 결정·반영 기록 — 신뢰도 제거, 경계 3단계, 접선책 확정"
```
