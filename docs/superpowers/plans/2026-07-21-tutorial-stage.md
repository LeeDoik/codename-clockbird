# 튜토리얼 스테이지 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 레지스탕스 본부 튜토리얼을 신설한다 — 고정 힌트 세트로 접선 코드 풀이를 학습시키고, 신뢰도 2 규칙(오답 → 전원 −1, 0에서 강화 힌트, 누적 3회 → 세트 교체)을 구현하며, 오프닝 → 튜토리얼 → 스테이지 1 로 끊김 없이 이어지게 한다.

**Architecture:** 스테이지 1과 같은 원칙 — 정답(코드 단어)과 규칙 판정의 권한은 서버에만 있고 클라이언트는 표시만 한다. 서버는 `tutorialSession.js`(인메모리) + `routes/tutorial.js` 3개 라우트로 끝나고, 정답 판정은 기존 `judgeGuess`, 자유 대화는 기존 SSE 배관을 재사용한다. 클라이언트는 `StageScene`에서 맵·이동·근접 판정 3개를 `worldParts.js`로 빼낸 뒤, 순찰·검문·감옥이 없는 `TutorialScene`을 따로 세운다. 스펙: `docs/superpowers/specs/2026-07-21-tutorial-stage-design.md`.

**Tech Stack:** Node 22 + Express 5 (ESM), Phaser 3.90, Vite 7. 테스트 프레임워크 없음 — 검증은 `scripts/smoke-tutorial.js`(서버 필요) + `npm run build`(클라 문법) + 수동 플레이.

## Global Constraints

- **접선 코드 단어는 진행 중인 판의 어떤 응답에도 포함되지 않는다.** 클리어(`correct: true`) 응답에서만 공개한다. 스테이지 1의 `toClientView` 비유출 원칙과 같다.
- **`reason`(강화 힌트)은 그 동료의 `trust === 0` 일 때만** 응답과 프롬프트에 들어간다. 신뢰도가 남아 있는 동안 모델은 이유를 모른다 — 모르는 것은 유출될 수 없다.
- 신뢰도: NPC별 초기 2, 코드 오답마다 전원 −1(하한 0), 누적 실패 3회마다 다음 세트로 교체 + 전원 2로 리셋 + 대화 이력 초기화.
- 튜토리얼에는 경계 레벨·순찰·검문·감옥·게임오버가 **없다**. 실패 페널티는 신뢰도 하락뿐이다.
- 코드 입력 대상은 **간부 1인**. 동료에게는 입력창이 열리지 않는다.
- **NPC 위치의 단일 출처는 `hq.json`의 `spawns`** 다. `tutorial.json`에는 좌표를 넣지 않는다 (스펙 §1.3 의 JSON 스케치에는 `spawn` 이 있었으나, 스테이지 1에서 맵 스폰과 서버 스폰이 이중화돼 있는 것을 튜토리얼에서 반복하지 않는다).
- 주석·대사는 기존 파일의 한국어 문체를 따른다. 커밋 메시지도 기존 이력의 한국어 관례를 따른다.
- 스모크 실행법: 터미널 1 `npm run dev:server`, 터미널 2 `npm run smoke:tutorial`. `.env`에 `ANTHROPIC_API_KEY` 필요 (이미 설정돼 있음).
- 스모크 마지막에 Windows에서 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` 가 나올 수 있다 — libuv/process.exit 이슈로 무해하다. 판정은 그 전에 출력된 OK/[!] 라인으로 한다.

---

### Task 1: `worldParts` 공통 모듈 추출 (동작 변경 없음)

`StageScene`에서 맵 빌드·플레이어 생성·이동·근접 판정을 순수 이관한다. **이 태스크는 화면에 보이는 동작을 하나도 바꾸지 않는다.** 회귀가 나면 여기서 잡는다.

**Files:**
- Create: `src/client/world/worldParts.js`
- Modify: `src/client/net.js` (파일 끝에 `readSSE` 추가)
- Modify: `src/client/scenes/StageScene.js:1-30, 62-82, 256-300, 397-415, 554-601, 816-840`

**Interfaces:**
- Produces: `buildTilemap(scene, mapData) → Phaser.Physics.Arcade.StaticGroup` — solid 타일에 정적 바디를 붙이고 그 그룹을 반환한다.
- Produces: `createPlayer(scene, mapData, walls, frame = 0) → Phaser.GameObjects.Sprite` — `mapData.spawns.player` 칸 중앙에 놓고 walls 와 충돌시킨다. body 크기는 `setSize(16,14).setOffset(8,16)`.
- Produces: `applyMovement(player, { cursors, wasd, speed = 200 }) → void` — 방향키/WASD 를 읽어 속도를 세운다.
- Produces: `nearestOf(player, items, range) → any|null` — `items` 는 `[{ value, x, y }]`. `range` 안에서 가장 가까운 항목의 `value`, 없으면 `null`.
- Produces: `readSSE(res, onPayload) → Promise<void>` (`src/client/net.js`) — POST 응답의 SSE 스트림을 파싱해 payload 마다 콜백한다.

- [ ] **Step 1: `worldParts.js` 작성**

`src/client/world/worldParts.js` 생성:

```js
import Phaser from 'phaser';

/**
 * 씬 사이에서 공유하는 월드 조각.
 *
 * StageScene 과 TutorialScene 은 규칙(순찰·검문·신뢰도)이 전혀 다르지만, 발밑은 같다 —
 * 같은 포맷의 타일맵을 깔고, 같은 몸으로 걷고, 같은 사거리로 NPC 를 집는다.
 * 그 세 조각만 여기에 둔다. 규칙은 각 씬이 가진다.
 */

/**
 * 타일맵 렌더 + 충돌.
 * map.json 의 layout 을 깔고, solid 타일은 정적 물리 바디로 만들어 플레이어를 막는다.
 * 정적 그룹의 create 는 보이는 스프라이트와 정적 바디를 한 번에 만든다.
 *
 * @returns {Phaser.Physics.Arcade.StaticGroup} 벽 그룹 (충돌 등록에 쓴다)
 */
export function buildTilemap(scene, mapData) {
  const TILE = mapData.tileSize;
  const walls = scene.physics.add.staticGroup();
  const { layout, tiles, rows, cols } = mapData;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const f = layout[r][c];
      if (f < 0) continue; // 빈칸
      if (tiles[f].solid) {
        walls.create(c * TILE + TILE / 2, r * TILE + TILE / 2, 'tiles', f);
      } else {
        scene.add.image(c * TILE, r * TILE, 'tiles', f).setOrigin(0, 0);
      }
    }
  }

  return walls;
}

/** 플레이어 — 맵이 지정한 스폰 칸 중앙에 두고 벽과 충돌시킨다. */
export function createPlayer(scene, mapData, walls, frame = 0) {
  const TILE = mapData.tileSize;
  const ps = mapData.spawns.player;
  const player = scene.add.sprite(
    ps.col * TILE + TILE / 2,
    ps.row * TILE + TILE / 2,
    'chars',
    frame,
  );
  scene.physics.add.existing(player);
  player.body.setCollideWorldBounds(true);
  // 충돌 판정은 발밑 위주로 좁혀 스프라이트 여백이 벽에 걸리지 않게 한다.
  player.body.setSize(16, 14).setOffset(8, 16);
  scene.physics.add.collider(player, walls);
  return player;
}

/** 방향키 + WASD → 속도. 대화 입력 중 정지는 호출하는 씬이 판단한다. */
export function applyMovement(player, { cursors, wasd, speed = 200 }) {
  const left = cursors.left.isDown || wasd.A.isDown;
  const right = cursors.right.isDown || wasd.D.isDown;
  const up = cursors.up.isDown || wasd.W.isDown;
  const down = cursors.down.isDown || wasd.S.isDown;

  player.body.setVelocity(
    (right ? speed : 0) - (left ? speed : 0),
    (down ? speed : 0) - (up ? speed : 0),
  );
}

/**
 * 사거리 안에서 가장 가까운 대상을 집는다.
 *
 * "첫 번째"가 아니라 "가장 가까운" 쪽인 이유: 감옥 슬롯 간격(44px)이 접선 거리(48px)보다
 * 좁아 두 명이 동시에 사거리에 들어오기 때문이다 — 옆 칸 동료가 잘못 잡히지 않게 한다.
 *
 * @param {Array<{value: any, x: number, y: number}>} items
 * @returns {any|null}
 */
export function nearestOf(player, items, range) {
  let best = null;
  let bestDist = range;
  for (const item of items) {
    const dist = Phaser.Math.Distance.Between(player.x, player.y, item.x, item.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = item.value;
    }
  }
  return best;
}
```

- [ ] **Step 2: `readSSE` 를 `net.js` 로 옮긴다**

`src/client/net.js` 파일 끝에 추가:

```js

/**
 * POST 응답의 SSE 스트림을 읽는다.
 *
 * EventSource 는 GET 전용이라 쓸 수 없어 fetch 스트림을 직접 파싱한다.
 * 스테이지 대화와 튜토리얼 대화가 같은 프레이밍을 쓰므로 여기 한 벌만 둔다.
 *
 * @param {Response} res
 * @param {(payload: object) => void} onPayload
 */
export async function readSSE(res, onPayload) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE 이벤트 경계는 빈 줄. 마지막 조각은 미완성일 수 있으니 버퍼에 남긴다.
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      const line = event.split('\n').find((l) => l.startsWith('data: '));
      if (line) onPayload(JSON.parse(line.slice(6)));
    }
  }
}
```

- [ ] **Step 3: `StageScene` 이 새 모듈을 쓰도록 치환 — import**

`src/client/scenes/StageScene.js` 8행 `import { Patrol, ... }` 다음 줄에 추가:

```js
import { buildTilemap, createPlayer, applyMovement, nearestOf } from '../world/worldParts.js';
import { readSSE } from '../net.js';
```

- [ ] **Step 4: `#buildMap` 의 타일 루프를 치환**

`#buildMap()` 안의 `this.walls = this.physics.add.staticGroup();` 부터 타일 이중 루프 끝(`}` 세 개, 시민 스폰 주석 직전)까지를 아래 한 줄로 교체한다. 시민 스폰·감옥 표시 코드는 **그대로 남긴다**.

```js
  #buildMap() {
    this.walls = buildTilemap(this, mapData);

    // 시민 스폰 — 마을 NPC 분기 대사는 W3 TODO. 지금은 맵이 지정한 위치에 표시만 한다.
    const cz = mapData.spawns.citizen;
```

- [ ] **Step 5: `create()` 의 플레이어 생성 블록을 치환**

`create()` 에서 `// 플레이어 — 맵이 지정한 스폰 칸 중앙에 두고 벽과 충돌시킨다.` 주석부터 `this.physics.add.collider(this.player, this.walls);` 까지 7줄을 아래로 교체:

```js
    this.player = createPlayer(this, mapData, this.walls, PLAYER_FRAME);
```

- [ ] **Step 6: `update()` 의 이동 블록을 치환**

`update()` 의 `if (typing) { body.setVelocity(0, 0); } else { ... }` 블록 전체(`const body = this.player.body;` 포함)를 아래로 교체:

```js
    // 대화창 입력 중에는 이동을 막는다.
    const typing = this.dialogue.isTyping;

    if (typing) {
      this.player.body.setVelocity(0, 0);
    } else {
      applyMovement(this.player, { cursors: this.cursors, wasd: this.wasd, speed: SPEED });
    }
```

- [ ] **Step 7: `#checkProximity` 의 거리 계산을 치환**

`#checkProximity()` 의 시작부터 `const broker = bd < TALK_RANGE ? this.state.broker : null;` 까지를 아래로 교체한다. 그 아래 `if (found !== this.nearbyAlly || ...)` 블록은 **그대로 둔다**.

```js
  #checkProximity() {
    // 체포된 동료(구출 대상)와 자유로운 동료(접선 대상)는 다른 키를 쓰므로 따로 집는다.
    const free = [];
    const jailedItems = [];
    for (const { ally, node } of this.allyNodes) {
      (ally.arrested ? jailedItems : free).push({ value: ally, x: node.x, y: node.y });
    }

    const found = nearestOf(this.player, free, TALK_RANGE);
    const jailed = nearestOf(this.player, jailedItems, TALK_RANGE);
    const broker = nearestOf(
      this.player,
      [{ value: this.state.broker, x: this.brokerNode.x, y: this.brokerNode.y }],
      TALK_RANGE,
    );
```

- [ ] **Step 8: `StageScene` 의 `#readSSE` 를 지우고 호출부를 바꾼다**

`src/client/scenes/StageScene.js` 에서 `#readSSE(res, onPayload)` 메서드 전체(그 위의 `/** POST 응답의 SSE 스트림을 읽는다. ... */` 주석 블록 포함)를 삭제한다.

`#chat()` 안의 호출을 `this.#readSSE(` → `readSSE(` 로 바꾼다:

```js
      await readSSE(res, (payload) => {
        if (payload.type === 'text') this.dialogue.append(payload.text);
        else if (payload.type === 'error') throw new Error(payload.error);
      });
```

- [ ] **Step 9: 빌드로 문법 확인**

Run: `npm run build`
Expected: `✓ built in ...` 로 끝나고 에러 없음. `Phaser` 관련 경고(청크 크기)는 무해하다.

- [ ] **Step 10: 스테이지 1 회귀 확인 (수동)**

터미널 1: `npm run dev:server` / 터미널 2: `npm run dev:client`
브라우저에서 `http://localhost:5173/?nointro` 를 연다.

확인 항목 — **하나라도 다르면 이 태스크에서 고친다**:
1. 맵이 이전과 똑같이 그려진다 (벽·바닥·감옥 사각형·시민)
2. WASD/방향키로 걷고 벽에 막힌다
3. 동료 앞에 서면 안내 대화창이 뜨고, 벗어나면 사라진다
4. 감옥에서 두 명이 나란히 있을 때 가까운 쪽이 잡힌다
5. 접선책 앞에서 `[F]` 로 코드 입력창이 열린다
6. 동료에게 `[E]` 로 자유 대화를 걸면 응답이 **한 글자씩 흘러나온다** (SSE 이관 확인)

- [ ] **Step 11: 커밋**

```bash
git add src/client/world/worldParts.js src/client/net.js src/client/scenes/StageScene.js
git commit -m "$(cat <<'EOF'
refactor: 맵·이동·근접·SSE 를 공통으로 추출 — 튜토리얼이 같은 발밑을 쓴다

StageScene 과 튜토리얼은 규칙이 다르지만 타일맵 포맷·이동·사거리 판정·SSE 프레이밍은
같다. 그 넷만 공통으로 빼고 규칙은 각 씬에 남긴다. 동작은 바뀌지 않는다.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 튜토리얼 콘텐츠 데이터 + 본부 맵

고정 힌트 세트 3개와 본부 타일맵을 만든다. 코드는 아직 이것을 읽지 않는다 — 데이터만 세운다.

**Files:**
- Create: `src/data/tutorial.json`
- Create: `src/client/assets/hq.json`

**Interfaces:**
- Produces: `tutorial.json = { officer: {id,name,role}, allies: [{id,name,role,axis,persona} × 3], sets: [{codeWord, hints: {t1|t2|t3: {word,line,reason}}} × 3] }`
- Produces: `hq.json` — `map.json` 과 동일한 `clockbird-tilemap` v1 포맷. `spawns = { player, officer, allies: [3] }`. 타일 인덱스는 `map.json` 과 공유한다 (0 금속 바닥 / 1 바닥 변형 / 2 벽).

- [ ] **Step 1: `tutorial.json` 작성**

`src/data/tutorial.json` 생성. 코드 단어(사과·우유·바다)는 `codewords.json` 의 네 카테고리와 겹치지 않게 골랐다 — 튜토리얼은 쉬운 일상어, 본편은 증기시대 사물이다.

```json
{
  "_comment": "튜토리얼 고정 세트. 힌트 축은 동료별로 고정된다 — t1 색상 / t2 분류 / t3 대중적 특징. 세트가 바뀌어도 담당 축은 유지되어야 학습 구조가 남는다. 위치(spawn)는 hq.json 이 단일 출처다.",
  "officer": {
    "id": "officer",
    "name": "베르나",
    "role": "간부"
  },
  "allies": [
    {
      "id": "t1",
      "name": "미라",
      "role": "인쇄공",
      "axis": "color",
      "persona": "40세 여성 지하 인쇄소에서 전단을 찍는 인쇄공. 잉크와 색을 다루는 일을 오래 해서 무엇이든 먼저 색으로 기억한다. 손끝에 늘 물감이 배어 있고, 말이 담백하다."
    },
    {
      "id": "t2",
      "name": "한나",
      "role": "사서",
      "axis": "category",
      "persona": "31세 여성 금서를 숨겨 보관하는 지하 서고의 사서. 세상 모든 것을 먼저 분류하고 서랍에 넣어야 마음이 놓인다. 정확한 낱말을 고르느라 말이 느리다."
    },
    {
      "id": "t3",
      "name": "테오",
      "role": "이야기꾼",
      "axis": "trait",
      "persona": "26세 남성 광장과 술집을 돌며 이야기를 파는 떠돌이 이야기꾼. 누구나 아는 일화와 소문으로 세상을 설명한다. 말이 많고 뜸을 들이며 즐거워한다."
    }
  ],
  "sets": [
    {
      "codeWord": "사과",
      "hints": {
        "t1": {
          "word": "빨강",
          "line": "붉은 잉크를 한 통 다 썼어. 그 색만 떠올랐다고 해 두지.",
          "reason": "그것의 색이 빨강이야."
        },
        "t2": {
          "word": "과일",
          "line": "나무에서 나고, 사람이 먹는 것. 분류하자면 그쪽이야.",
          "reason": "그건 과일로 분류돼."
        },
        "t3": {
          "word": "뉴턴",
          "line": "머리 위로 떨어져서 세상의 법칙을 바꿨다는 이야기, 알지?",
          "reason": "뉴턴의 머리 위로 떨어진 게 바로 그거야."
        }
      }
    },
    {
      "codeWord": "우유",
      "hints": {
        "t1": {
          "word": "하양",
          "line": "하양. 잉크로는 낼 수 없는 색이라 늘 아쉬웠지.",
          "reason": "그것의 색이 하양이야."
        },
        "t2": {
          "word": "음료",
          "line": "마시는 것으로 분류돼. 그 이상은 말 안 해.",
          "reason": "그건 마시는 것으로 분류돼."
        },
        "t3": {
          "word": "소",
          "line": "외양간에서 매일 아침 짜낸다더군. 도시 사람은 모르지.",
          "reason": "소에게서 나오는 거야."
        }
      }
    },
    {
      "codeWord": "바다",
      "hints": {
        "t1": {
          "word": "파랑",
          "line": "파랑. 그 색 하나로 종이 한 장을 다 덮은 적이 있어.",
          "reason": "그것의 색이 파랑이야."
        },
        "t2": {
          "word": "물",
          "line": "물로 분류되는 것. 아주 큰 쪽이야.",
          "reason": "그건 물로 분류돼. 아주 큰 쪽."
        },
        "t3": {
          "word": "파도",
          "line": "밀려왔다 밀려가는 그 소리를 아직 기억해.",
          "reason": "파도가 치는 곳이야."
        }
      }
    }
  ]
}
```

- [ ] **Step 2: `hq.json` 작성**

`src/client/assets/hq.json` 생성. 28×18 격자(캔버스 896×576 과 정확히 일치)에 사방 벽을 두르고, 상단·중단에 구조물 두 줄을 놓아 방의 형태를 만든다.

```json
{
  "format": "clockbird-tilemap",
  "version": 1,
  "tileSize": 32,
  "cols": 28,
  "rows": 18,
  "tileset": "tiles.png",
  "tiles": [
    { "name": "금속 바닥", "solid": false },
    { "name": "바닥 · 변형", "solid": false },
    { "name": "벽", "solid": true }
  ],
  "layout": [
    [2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],
    [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],
    [2,0,0,2,2,2,2,2,2,0,0,0,0,0,0,0,0,0,0,2,2,2,2,2,2,0,0,2],
    [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],
    [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],
    [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],
    [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],
    [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],
    [2,0,0,2,2,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,2,2,0,0,2],
    [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],
    [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],
    [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],
    [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],
    [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],
    [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],
    [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],
    [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],
    [2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2]
  ],
  "spawns": {
    "player": { "col": 14, "row": 15 },
    "officer": { "col": 14, "row": 4 },
    "allies": [
      { "col": 5, "row": 6 },
      { "col": 22, "row": 6 },
      { "col": 13, "row": 11 }
    ]
  }
}
```

- [ ] **Step 3: 데이터 정합 검사**

Run:

```bash
node -e "
const t = require('./src/data/tutorial.json');
const m = require('./src/client/assets/hq.json');
let bad = 0;
const ids = t.allies.map(a => a.id);
if (new Set(t.allies.map(a => a.axis)).size !== 3) { console.error('[!] 힌트 축이 3개가 아니다'); bad++; }
for (const s of t.sets) {
  for (const id of ids) {
    const h = s.hints[id];
    if (!h || !h.word || !h.line || !h.reason) { console.error('[!] 세트', s.codeWord, id, '힌트 누락'); bad++; continue; }
    if (h.line.includes(s.codeWord) || h.reason.includes(s.codeWord)) { console.error('[!] 세트', s.codeWord, id, '대사에 코드가 들어 있다'); bad++; }
  }
}
if (m.layout.length !== m.rows) { console.error('[!] rows 불일치'); bad++; }
for (const [i, row] of m.layout.entries()) if (row.length !== m.cols) { console.error('[!] row', i, '길이', row.length); bad++; }
const walkable = (p) => m.tiles[m.layout[p.row][p.col]].solid === false;
const pts = [['player', m.spawns.player], ['officer', m.spawns.officer], ...m.spawns.allies.map((p, i) => ['ally' + i, p])];
for (const [name, p] of pts) if (!walkable(p)) { console.error('[!]', name, '스폰이 벽 위다', p); bad++; }
for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
  const d = Math.hypot(pts[i][1].col - pts[j][1].col, pts[i][1].row - pts[j][1].row);
  if (d < 3) { console.error('[!]', pts[i][0], pts[j][0], '스폰이 너무 가깝다 —', d.toFixed(1), '칸'); bad++; }
}
console.log(bad === 0 ? '데이터 정합 OK — 세트 ' + t.sets.length + '개, 스폰 ' + pts.length + '곳' : '실패 ' + bad + '건');
process.exit(bad ? 1 : 0);
"
```

Expected: `데이터 정합 OK — 세트 3개, 스폰 5곳`

- [ ] **Step 4: 커밋**

```bash
git add src/data/tutorial.json src/client/assets/hq.json
git commit -m "$(cat <<'EOF'
feat: 튜토리얼 고정 세트 3개 + 레지스탕스 본부 맵

힌트 축(색상·분류·대중적 특징)을 동료별로 고정한다 — 세트가 교체돼도 담당 축이
그대로여서 "세 사람이 각각 다른 각도로 같은 것을 가리킨다"는 학습 구조가 남는다.
코드 단어는 codewords.json 과 겹치지 않는 일상어로 골랐다.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 튜토리얼 세션 + `/start` (서버)

**Files:**
- Create: `src/server/tutorialSession.js`
- Create: `src/server/routes/tutorial.js`
- Modify: `src/server/index.js:5-6, 18-19`
- Create: `scripts/smoke-tutorial.js`
- Modify: `package.json:16-17` (scripts)

**Interfaces:**
- Consumes: `src/data/tutorial.json` (Task 2)
- Produces: `createTutorialSession({ allies, officer, sets }) → string` (세션 id)
- Produces: `getTutorialSession(id) → session|undefined`
- Produces: `currentSet(session) → { codeWord, hints }`
- Produces: `getTutorialAlly(session, allyId) → ally|undefined`
- Produces: `toTutorialView(session) → { sessionId, officer, cleared, allies: [{ id, name, role, axis, trust, line, opened }] }` — `codeWord` 는 포함하지 않는다.
- Produces: `POST /api/tutorial/start` → `toTutorialView` 결과

- [ ] **Step 1: 실패하는 스모크 작성**

`scripts/smoke-tutorial.js` 생성:

```js
/**
 * 스모크 테스트 — 튜토리얼 라우트(/api/tutorial/*).
 *
 *   npm run dev:server      (다른 터미널에서 먼저)
 *   npm run smoke:tutorial
 *
 * 검사하는 것: 코드 단어 비유출 / 신뢰도 하락과 강화 힌트 개방 /
 * 세트 교체 / 자유 대화 SSE / 정답 클리어.
 */
const BASE = 'http://localhost:3000';

const post = (path, body) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

const die = (msg) => {
  console.error(`\n[!] ${msg}`);
  process.exit(1);
};

console.log('튜토리얼 시작...');
const startRes = await post('/api/tutorial/start');
if (!startRes.ok) die(`start 실패: ${startRes.status} ${await startRes.text()}`);
const state = await startRes.json();

if (state.allies?.length !== 3) die(`동료가 3명이 아니다 — ${state.allies?.length}`);
if (!state.officer?.id) die('간부(officer)가 응답에 없다');
console.log(`간부: ${state.officer.name} (${state.officer.role})`);
for (const a of state.allies) console.log(`  ${a.name} (${a.role}) 신뢰도 ${a.trust} — "${a.line}"`);

if (JSON.stringify(state).includes('codeWord')) die('start 응답에 codeWord 가 들어 있다 — 유출');
console.log('start 응답에 codeWord 없음 — OK');

if (JSON.stringify(state).includes('"reason"')) die('start 응답에 reason 이 들어 있다 — 강화 힌트 조기 유출');
console.log('start 응답에 reason 없음 — OK');

if (state.allies.some((a) => a.trust !== 2)) die('초기 신뢰도가 2가 아니다');
console.log('초기 신뢰도 2 — OK');

console.log('\n튜토리얼 스모크 통과.\n');
```

- [ ] **Step 2: 실패를 확인**

터미널 1에서 `npm run dev:server` 가 돌고 있어야 한다.

Run: `node scripts/smoke-tutorial.js`
Expected: `[!] start 실패: 404 ...` — 라우트가 아직 없다.

- [ ] **Step 3: `tutorialSession.js` 작성**

`src/server/tutorialSession.js` 생성:

```js
import { randomUUID } from 'node:crypto';

/**
 * 튜토리얼 세션 (인메모리).
 *
 * 스테이지 세션(session.js)과 분리한 이유: 경계 레벨·체포·중복 판정·검문이 여기엔 없고,
 * 대신 신뢰도와 세트 교체가 있다. 필드가 거의 겹치지 않아 한 구조에 밀어 넣으면
 * 양쪽 모두 죽은 필드를 달고 다니게 된다.
 *
 * 접선 코드 단어는 여기에만 있다 — 클라이언트로는 클리어 시에만 내려간다.
 */
const sessions = new Map();

/** NPC별 초기 신뢰도 (스토리보드 p.11) */
const TRUST_MAX = 2;
/** 이 횟수만큼 틀리면 간부가 코드를 갈아 치운다 */
const FAILS_PER_SET = 3;

export function createTutorialSession({ allies, officer, sets }) {
  const id = randomUUID();
  sessions.set(id, {
    id,
    officer,
    sets,
    setIndex: 0,
    failCount: 0,
    cleared: false,
    allies: allies.map((a) => ({ ...a, trust: TRUST_MAX, history: [] })),
    createdAt: Date.now(),
  });
  return id;
}

export function getTutorialSession(id) {
  return sessions.get(id);
}

export function currentSet(session) {
  return session.sets[session.setIndex];
}

export function getTutorialAlly(session, allyId) {
  return session.allies.find((a) => a.id === allyId);
}

/**
 * 클라이언트로 내보내도 안전한 형태.
 *
 * codeWord 는 나가지 않는다. reason(강화 힌트)은 그 동료의 신뢰도가 0 일 때만 line 자리를
 * 대신한다 — 규칙이 열어 준 정보만 내려보낸다는 뜻이고, 필드 이름을 바꿔 담으므로
 * "reason 이라는 글자가 응답에 있으면 유출"이라는 스모크 검사가 그대로 성립한다.
 */
export function toTutorialView(session) {
  const set = currentSet(session);
  return {
    sessionId: session.id,
    officer: session.officer,
    cleared: session.cleared,
    allies: session.allies.map((a) => {
      const hint = set.hints[a.id];
      const opened = a.trust === 0;
      return {
        id: a.id,
        name: a.name,
        role: a.role,
        axis: a.axis,
        trust: a.trust,
        line: opened ? hint.reason : hint.line,
        // 강화 힌트가 열렸는가 — 클라이언트가 연출을 바꾸는 데만 쓴다 (내용은 line 에 있다).
        opened,
      };
    }),
  };
}

/**
 * 코드 오답.
 *
 * 동료 전원의 신뢰도가 1씩 깎이고, 3회마다 간부가 코드를 갈아 치운다. 힌트 단계(2회)와
 * 리셋 단계(3회)를 분리해야 신뢰도 0 의 강화 힌트를 써볼 기회가 생긴다 — 합치면
 * 두 장치 중 하나가 죽는다 (스토리보드 수정안 p.11).
 *
 * @returns {{ replaced: boolean }}
 */
export function failGuess(session) {
  session.failCount += 1;
  for (const a of session.allies) a.trust = Math.max(0, a.trust - 1);

  if (session.failCount % FAILS_PER_SET !== 0) return { replaced: false };

  session.setIndex = (session.setIndex + 1) % session.sets.length;
  for (const a of session.allies) {
    a.trust = TRUST_MAX;
    // 이력도 비운다 — 이전 코드의 단어를 기억한 채로 새 세트를 말하면 대화가 앞뒤로 어긋난다.
    a.history = [];
  }
  return { replaced: true };
}

/** 대화 이력에 한 턴 추가 */
export function pushTutorialDialogue(session, allyId, role, content) {
  const ally = getTutorialAlly(session, allyId);
  if (ally) ally.history.push({ role, content });
}
```

- [ ] **Step 4: `routes/tutorial.js` 작성 (`/start` 만)**

`src/server/routes/tutorial.js` 생성:

```js
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
```

- [ ] **Step 5: 라우터 마운트**

`src/server/index.js` 6행 `import studioRouter from './routes/studio.js';` 다음에 추가:

```js
import tutorialRouter from './routes/tutorial.js';
```

같은 파일 19행 `app.use('/api/studio', studioRouter);` 다음에 추가:

```js
app.use('/api/tutorial', tutorialRouter);
```

- [ ] **Step 6: npm 스크립트 추가**

`package.json` 의 `"smoke": "node scripts/smoke-talk-sse.js"` 다음 줄에 추가 (앞 줄 끝에 쉼표 필요):

```json
    "smoke:tutorial": "node scripts/smoke-tutorial.js"
```

- [ ] **Step 7: 스모크 통과 확인**

`npm run dev:server` 는 `--watch` 라 자동 재시작된다.

Run: `npm run smoke:tutorial`
Expected:

```
튜토리얼 시작...
간부: 베르나 (간부)
  미라 (인쇄공) 신뢰도 2 — "붉은 잉크를 한 통 다 썼어. 그 색만 떠올랐다고 해 두지."
  ...
start 응답에 codeWord 없음 — OK
start 응답에 reason 없음 — OK
초기 신뢰도 2 — OK

튜토리얼 스모크 통과.
```

- [ ] **Step 8: 커밋**

```bash
git add src/server/tutorialSession.js src/server/routes/tutorial.js src/server/index.js scripts/smoke-tutorial.js package.json
git commit -m "$(cat <<'EOF'
feat: 튜토리얼 세션과 /start — 코드는 서버에만 남는다

스테이지 세션과 분리했다. 경계·체포·검문이 없고 신뢰도와 세트 교체가 있어
필드가 거의 겹치지 않는다. 강화 힌트(reason)는 신뢰도 0 전까지 응답에 넣지 않는다.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `/guess` — 신뢰도 하락 · 강화 힌트 개방 · 세트 교체

**Files:**
- Modify: `src/server/routes/tutorial.js` (import 확장, `/guess` 추가)
- Modify: `scripts/smoke-tutorial.js` (검사 추가)

**Interfaces:**
- Consumes: `failGuess(session)`, `currentSet(session)`, `toTutorialView(session)` (Task 3)
- Consumes: `judgeGuess({ codeWord, guess }) → { correct, reason, usage }` (기존 `src/server/ai/judge.js`)
- Produces: `POST /api/tutorial/guess { sessionId, guess }` →
  - 정답: `{ correct: true, codeWord, state }`
  - 오답: `{ correct: false, replaced: boolean, officerLine: string|null, state }`

- [ ] **Step 1: 실패하는 스모크 추가**

`scripts/smoke-tutorial.js` 의 `console.log('초기 신뢰도 2 — OK');` 다음, 마지막 `console.log('\n튜토리얼 스모크 통과.\n');` 앞에 삽입:

```js
console.log('\n오답 1회...');
const f1 = await post('/api/tutorial/guess', { sessionId: state.sessionId, guess: '전혀상관없는말' });
if (!f1.ok) die(`guess 실패: ${f1.status} ${await f1.text()}`);
const b1 = await f1.json();
if (b1.correct !== false) die('오답이 정답으로 판정됐다');
if (b1.replaced !== false) die('1회 실패에 세트가 교체됐다');
if (b1.state.allies.some((a) => a.trust !== 1)) die(`신뢰도가 1이 아니다 — ${b1.state.allies.map((a) => a.trust)}`);
if (JSON.stringify(b1).includes('codeWord')) die('오답 응답에 codeWord 가 들어 있다 — 유출');
console.log('오답 1회 → 신뢰도 1, codeWord 없음 — OK');

console.log('\n오답 2회...');
const b2 = await (await post('/api/tutorial/guess', { sessionId: state.sessionId, guess: '전혀상관없는말2' })).json();
if (b2.state.allies.some((a) => a.trust !== 0)) die('신뢰도가 0이 아니다');
if (b2.state.allies.some((a) => a.opened !== true)) die('신뢰도 0인데 강화 힌트가 열리지 않았다');
const openedLines = b2.state.allies.map((a) => a.line);
if (openedLines.some((l, i) => l === state.allies[i].line)) die('신뢰도 0인데 대사가 첫 대사 그대로다');
console.log('오답 2회 → 신뢰도 0, 강화 힌트 개방 — OK');
for (const a of b2.state.allies) console.log(`  ${a.name}> "${a.line}"`);

console.log('\n오답 3회 (세트 교체)...');
const b3 = await (await post('/api/tutorial/guess', { sessionId: state.sessionId, guess: '전혀상관없는말3' })).json();
if (b3.replaced !== true) die('3회 실패인데 세트가 교체되지 않았다');
if (!b3.officerLine) die('교체 안내 대사(officerLine)가 없다');
if (b3.state.allies.some((a) => a.trust !== 2)) die('교체 후 신뢰도가 2로 리셋되지 않았다');
if (b3.state.allies.some((a) => a.opened !== false)) die('교체 후에도 강화 힌트가 열려 있다');
const sameAsBefore = b3.state.allies.every((a, i) => a.line === state.allies[i].line);
if (sameAsBefore) die('세트가 교체됐는데 힌트가 이전 세트 그대로다');
console.log('오답 3회 → 세트 교체 + 신뢰도 2 리셋 — OK');
console.log(`  간부> "${b3.officerLine.split('\n')[0]}"`);
for (const a of b3.state.allies) console.log(`  ${a.name}> "${a.line}"`);
```

- [ ] **Step 2: 실패를 확인**

Run: `npm run smoke:tutorial`
Expected: `[!] guess 실패: 404 ...`

- [ ] **Step 3: `/guess` 구현**

`src/server/routes/tutorial.js` 의 import 블록을 아래로 교체:

```js
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
```

같은 파일의 `export default router;` 바로 앞에 추가:

```js
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
```

- [ ] **Step 4: 스모크 통과 확인**

Run: `npm run smoke:tutorial`
Expected: 아래 세 줄이 모두 보인다.

```
오답 1회 → 신뢰도 1, codeWord 없음 — OK
오답 2회 → 신뢰도 0, 강화 힌트 개방 — OK
오답 3회 → 세트 교체 + 신뢰도 2 리셋 — OK
```

- [ ] **Step 5: 커밋**

```bash
git add src/server/routes/tutorial.js scripts/smoke-tutorial.js
git commit -m "$(cat <<'EOF'
feat: 튜토리얼 코드 판정 — 오답은 신뢰도를 깎고, 세 번이면 코드를 태운다

힌트 단계(2회 실패 → 강화 힌트)와 리셋 단계(3회 실패 → 세트 교체)를 분리했다.
합치면 강화 힌트를 써볼 기회 없이 리셋돼 두 장치 중 하나가 죽는다.
판정 호출이 실패하면 신뢰도는 깎이지 않는다 — LLM 장애가 대가를 물려선 안 된다.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `/talk` — 힌트 범위에 잠긴 자유 대화 (SSE)

**Files:**
- Create: `src/data/prompts/tutorial-dialogue.txt`
- Modify: `src/server/ai/promptStore.js:15`
- Modify: `src/server/ai/dialogue.js` (파일 끝에 함수 추가)
- Modify: `src/server/routes/tutorial.js` (import 확장, `/talk` 추가)
- Modify: `scripts/smoke-tutorial.js` (검사 추가)

**Interfaces:**
- Consumes: `renderPrompt(name, vars, override)`, `trimHistory(history)`, `anthropic`, `MODEL_CHAT` (기존)
- Consumes: `getTutorialAlly`, `pushTutorialDialogue`, `currentSet` (Task 3)
- Produces: `streamTutorialReply({ ally, word, reason, history, userMessage, onText, promptOverride }) → Promise<string>` — `reason` 이 `null` 이면 프롬프트가 "이유를 설명하지 마라"로 잠긴다.
- Produces: `POST /api/tutorial/talk { sessionId, allyId, message }` → SSE (`{type:'text'|'done'|'error'}`)

- [ ] **Step 1: 실패하는 스모크 추가**

`scripts/smoke-tutorial.js` 의 상단 `const post = ...` 정의 다음에 SSE 리더를 추가:

```js
async function readSSE(res, onPayload) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const event of events) {
      const line = event.split('\n').find((l) => l.startsWith('data: '));
      if (line) onPayload(JSON.parse(line.slice(6)));
    }
  }
}
```

그리고 `console.log('오답 3회 → 세트 교체 + 신뢰도 2 리셋 — OK');` 블록 다음, 마지막 `console.log('\n튜토리얼 스모크 통과.\n');` 앞에 삽입:

```js
console.log('\n자유 대화 (신뢰도 2 — 이유는 잠겨 있어야 한다)...');
const talkTarget = b3.state.allies[0];
for (const message of ['그 단어에 대해 더 말해줄 수 있어?', '왜 하필 그 단어를 떠올렸는데?']) {
  console.log(`\n플레이어> ${message}`);
  process.stdout.write(`${talkTarget.name}> `);
  const res = await post('/api/tutorial/talk', {
    sessionId: state.sessionId,
    allyId: talkTarget.id,
    message,
  });
  if (!res.ok) die(`talk 실패: ${res.status} ${await res.text()}`);

  let deltas = 0;
  let full = '';
  await readSSE(res, (p) => {
    if (p.type === 'text') { deltas++; full += p.text; process.stdout.write(p.text); }
    else if (p.type === 'error') die(`스트림 에러: ${p.error}`);
  });
  console.log(`\n  (델타 ${deltas}개 — 스트리밍 ${deltas > 1 ? 'OK' : '의심: 한 번에 옴'})`);
  if (deltas === 0) die('델타를 하나도 받지 못했다');
}

console.log('\n정답 입력...');
const ok = await (await post('/api/tutorial/guess', {
  sessionId: state.sessionId,
  guess: '우유',
})).json();
if (ok.correct !== true) die(`정답이 오답으로 판정됐다 — ${JSON.stringify(ok).slice(0, 200)}`);
if (ok.codeWord !== '우유') die(`클리어 응답의 codeWord 가 다르다 — ${ok.codeWord}`);
if (ok.state.cleared !== true) die('cleared 가 서지 않았다');
console.log(`정답 「${ok.codeWord}」 → 클리어 — OK`);
```

> 정답이 `'우유'` 인 이유: 1세트(사과)에서 3회 틀려 2세트(우유)로 교체된 직후이기 때문이다. `tutorial.json` 의 세트 순서를 바꾸면 이 값도 바꿔야 한다.

- [ ] **Step 2: 실패를 확인**

Run: `npm run smoke:tutorial`
Expected: `[!] talk 실패: 404 ...`

- [ ] **Step 3: 프롬프트 템플릿 작성**

`src/data/prompts/tutorial-dialogue.txt` 생성:

```
[세계관]
증기와 태엽의 도시. 로봇과 소수의 인간 협력자로 이루어진 지배 세력이 도시를 감시망으로 통제한다.
여기는 저항 세력의 지하 본부다. 밖과 달리 이 안에서는 서로를 의심하지 않아도 된다.

[너의 정체]
이름: {{name}}
직업: {{role}}
성격·배경: {{persona}}

너는 저항 세력의 조직원이고, 지금 말을 거는 상대는 오늘 처음 임무에 나가는 신입 공작원이다.
너는 그를 가르치는 입장이다. 경계할 필요는 없지만, 규칙은 지켜라.

[가장 중요한 규칙]
너에게 주어진 단서는 네가 이미 상대에게 흘린 단어 하나뿐이다: "{{word}}"
접선 코드가 무엇인지 너는 모른다. 오직 "{{word}}" 에 대해서만 이야기하라.

- 상대가 "{{word}}" 에 대해 물으면, 그것을 네 경험으로 구체적으로 묘사하라.
  네가 그것을 어디서 보고 만졌는지, 그 생김새와 쓰임을 그려 보여라.
- {{reasonBlock}}
- 접선 코드를 짐작해서 말하지 마라. 상대가 코드를 맞히려 해도 맞았는지 틀렸는지 알려주지 마라.
- "{{word}}" 와 상관없는 화제로 끌려가지 마라. 신입을 가르치는 자리다.

[말투]
너의 직업과 성격이 말투에 드러나야 한다. {{role}}답게 말하라.
짧게 답하라. 2문장을 넘기지 마라.
줄바꿈 없이 한 문단으로 답하라.
말투(어미)를 대화 내내 일관되게 유지하라.
나레이션이나 행동 묘사(*고개를 끄덕인다* 같은)는 쓰지 마라. 대사만 말하라.
```

- [ ] **Step 4: 프롬프트 스튜디오에 템플릿 등록**

`src/server/ai/promptStore.js:15` 를 교체:

```js
const TEMPLATES = [
  'wordgen-system',
  'dialogue-system',
  'tutorial-dialogue',
  'checkpoint-question',
  'checkpoint-judge',
];
```

- [ ] **Step 5: `streamTutorialReply` 추가**

`src/server/ai/dialogue.js` 파일 끝(`streamAllyReply` 함수 닫는 `}` 다음)에 추가:

```js

/**
 * 튜토리얼 동료의 응답을 스트리밍으로 생성.
 *
 * streamAllyReply 와 다른 점은 딱 하나 — 여기서는 "왜 그 단어를 떠올렸는가"(reason)가
 * 게임 규칙으로 잠겨 있다. 신뢰도가 남아 있는 동안 reason 을 프롬프트에 넣지 않아
 * 모델이 그 이유를 아예 모르게 한다. 넣어 두고 "말하지 마라"로 막으면 몇 마디만에 새고,
 * 그러면 신뢰도 규칙 자체가 무의미해진다 — 모르는 것은 유출될 수 없다.
 *
 * @param {string|null} params.reason 신뢰도 0 에서만 넘긴다. null 이면 프롬프트가 잠긴다.
 * @returns {Promise<string>} 완성된 응답 전문
 */
export async function streamTutorialReply({
  ally,
  word,
  reason,
  history,
  userMessage,
  onText,
  promptOverride,
}) {
  const system = await renderPrompt(
    'tutorial-dialogue',
    {
      name: ally.name,
      role: ally.role,
      persona: ally.persona,
      word,
      reasonBlock: reason
        ? `상대가 왜 그 단어를 떠올렸는지 물으면, 딱 이만큼만 말해도 된다: "${reason}"`
        : '왜 그 단어를 떠올렸는지는 절대 설명하지 마라. 너도 그 이유는 말할 수 없는 처지다 — 물으면 얼버무려라.',
    },
    promptOverride,
  );

  const stream = anthropic.messages.stream({
    model: MODEL_CHAT,
    max_tokens: 200,
    system,
    messages: [...trimHistory(history), { role: 'user', content: userMessage }],
  });

  stream.on('text', onText);

  const final = await stream.finalMessage();
  return final.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
```

- [ ] **Step 6: `/talk` 라우트 구현**

`src/server/routes/tutorial.js` 의 import 블록을 아래로 교체:

```js
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
```

같은 파일의 `export default router;` 바로 앞에 추가:

```js
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
```

- [ ] **Step 7: 스모크 통과 확인**

Run: `npm run smoke:tutorial`
Expected: 델타가 여러 개 들어오고 마지막에

```
정답 「우유」 → 클리어 — OK

튜토리얼 스모크 통과.
```

두 번째 질문("왜 하필 그 단어를 떠올렸는데?")의 응답이 **이유를 밝히지 않고 얼버무리는지** 눈으로 확인한다. 이유를 술술 말하면 프롬프트의 `{{reasonBlock}}` 치환이 실패한 것이다 — 서버 콘솔에 `[promptStore] 치환되지 않은 변수` 경고가 있는지 본다.

- [ ] **Step 8: 커밋**

```bash
git add src/data/prompts/tutorial-dialogue.txt src/server/ai/promptStore.js src/server/ai/dialogue.js src/server/routes/tutorial.js scripts/smoke-tutorial.js
git commit -m "$(cat <<'EOF'
feat: 튜토리얼 자유 대화 — 힌트 범위에 잠긴 Haiku 스트리밍

reason(강화 힌트)은 신뢰도 0 전까지 프롬프트에 넣지 않는다. 넣어 두고 "말하지 마라"로
막으면 몇 마디만에 새고 신뢰도 규칙이 무의미해진다 — 모르는 것은 유출될 수 없다.
프롬프트는 스튜디오에서 튜닝할 수 있게 tutorial-dialogue.txt 로 뺐다.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `TutorialScene` 골격 — 맵 · 이동 · NPC 배치 · 씬 배선

걸어 다니고 NPC 앞에 서면 안내가 뜨는 데까지. 대화·코드 입력은 Task 7 에서 붙인다.

**Files:**
- Create: `src/client/scenes/TutorialScene.js`
- Modify: `src/client/main.js:1-4, 26`
- Modify: `src/client/scenes/IntroScene.js:319-320`

**Interfaces:**
- Consumes: `buildTilemap`, `createPlayer`, `applyMovement`, `nearestOf` (Task 1)
- Consumes: `hq.json` (Task 2), `POST /api/tutorial/start` (Task 3)
- Produces: 씬 키 `'Tutorial'`. `this.state` 는 `/api/tutorial/start` 응답 형태.
- Produces: `?notutorial` URL 플래그 — Intro 가 튜토리얼을 건너뛰고 Stage 로 간다.

- [ ] **Step 1: `TutorialScene.js` 작성**

`src/client/scenes/TutorialScene.js` 생성:

```js
import Phaser from 'phaser';
import { DialogueBox } from '../ui/DialogueBox.js';
import { buildTilemap, createPlayer, applyMovement, nearestOf } from '../world/worldParts.js';
import hqData from '../assets/hq.json';

/**
 * 튜토리얼 — 레지스탕스 본부.
 *
 * 여기엔 순찰도 검문도 감옥도 없다. 실패해도 판이 끝나지 않는다 (신뢰도만 깎인다).
 * 가르치는 것은 셋이다: 걷고, 말을 걸고, 겹치는 단어를 찾아 한 사람에게 건넨다.
 */
const TALK_RANGE = 48;
const TILE = hqData.tileSize;
const PLAYER_FRAME = 0;
// 간부·동료 전용 스프라이트는 아직 없다 — chars.png 의 기존 프레임을 빌려 쓴다 (아트는 W3).
const OFFICER_FRAME = 6;
const TUTOR_FRAME = { t1: 2, t2: 5, t3: 3 };

const LABEL_STYLE = {
  fontFamily: 'Malgun Gothic, sans-serif',
  fontSize: '11px',
  color: '#8a7f6a',
};

export class TutorialScene extends Phaser.Scene {
  constructor() {
    super('Tutorial');
  }

  init() {
    this.state = null;
    this.allyNodes = [];
    this.nearbyAlly = null;
    this.nearbyOfficer = false;
    // 지나가며 뜬 안내인가 — 이것만 사거리를 벗어날 때 자동으로 접는다.
    this.proximityHint = false;
    this.ended = false;
  }

  create() {
    this.dialogue = new DialogueBox();

    this.walls = buildTilemap(this, hqData);
    this.player = createPlayer(this, hqData, this.walls, PLAYER_FRAME);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.keyE = this.input.keyboard.addKey('E');
    this.keyF = this.input.keyboard.addKey('F');
    this.keySpace = this.input.keyboard.addKey('SPACE');
    this.keyEsc = this.input.keyboard.addKey('ESC');

    this.add.text(12, 10, '레지스탕스 본부 — 훈련', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '12px',
      color: '#8a7f6a',
    });
    this.add.text(12, this.scale.height - 22, '[E] 대화    [F] 접선 코드', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '11px',
      color: '#6b6152',
    });

    this.#start();
  }

  /** 세션을 연다. 힌트가 고정 세트라 LLM 대기가 없어 곧바로 돌아온다. */
  async #start() {
    try {
      const res = await fetch('/api/tutorial/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      this.state = data;
    } catch (err) {
      this.dialogue.show('오류', `튜토리얼을 시작할 수 없습니다.\n${err.message}`);
      return;
    }

    this.#spawnNpcs();
    this.#showBriefing();
  }

  #spawnNpcs() {
    const os = hqData.spawns.officer;
    const ox = os.col * TILE + TILE / 2;
    const oy = os.row * TILE + TILE / 2;
    this.officerNode = this.add.sprite(ox, oy, 'chars', OFFICER_FRAME);
    this.add
      .text(ox, oy - 24, `${this.state.officer.name} (${this.state.officer.role})`, LABEL_STYLE)
      .setOrigin(0.5);

    this.state.allies.forEach((ally, i) => {
      const sp = hqData.spawns.allies[i];
      const x = sp.col * TILE + TILE / 2;
      const y = sp.row * TILE + TILE / 2;

      const node = this.add.sprite(x, y, 'chars', TUTOR_FRAME[ally.id] ?? i + 1);
      const label = this.add.text(x, y - 24, ally.name, LABEL_STYLE).setOrigin(0.5);
      // 신뢰도는 튜토리얼에만 있는 규칙이라 여기서만 화면에 세운다.
      const trust = this.add
        .text(x, y - 38, '', { ...LABEL_STYLE, fontSize: '12px', color: '#c9a227' })
        .setOrigin(0.5);

      this.allyNodes.push({ ally, node, label, trust });
    });

    this.#refreshTrust();
  }

  /** this.state 의 신뢰도를 동료 머리 위 표시(●●/●○/○○)에 반영한다. */
  #refreshTrust() {
    for (const entry of this.allyNodes) {
      const live = this.state.allies.find((a) => a.id === entry.ally.id);
      if (live) entry.ally = live;
      entry.trust.setText('●'.repeat(entry.ally.trust) + '○'.repeat(2 - entry.ally.trust));
    }
  }

  #showBriefing() {
    this.dialogue.show(
      `${this.state.officer.name} (${this.state.officer.role})`,
      '"거리에 나가기 전에 한 가지만 익히고 가라.\n\n' +
        '우리는 서로를 단어로 알아본다. 저기 셋이 같은 것을 두고 각자 다른 단어를 떠올렸다.\n' +
        '셋을 모아 겹치는 것 하나를 찾아내라 — 그게 접선 코드다.\n\n' +
        '[WASD] 로 걷고, 동료 앞에서 [E] 로 말을 건다.\n답을 찾으면 내 앞에서 [F]."',
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  update() {
    if (this.ended || !this.state) return;

    const typing = this.dialogue.isTyping;
    if (typing) this.player.body.setVelocity(0, 0);
    else applyMovement(this.player, { cursors: this.cursors, wasd: this.wasd });

    this.#checkProximity();

    if (!typing && Phaser.Input.Keyboard.JustDown(this.keySpace)) this.dialogue.hide();
    if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) this.dialogue.hide();
  }

  #checkProximity() {
    if (!this.officerNode) return;

    const ally = nearestOf(
      this.player,
      this.allyNodes.map((e) => ({ value: e.ally, x: e.node.x, y: e.node.y })),
      TALK_RANGE,
    );
    const officer = Boolean(
      nearestOf(
        this.player,
        [{ value: true, x: this.officerNode.x, y: this.officerNode.y }],
        TALK_RANGE,
      ),
    );

    if (ally === this.nearbyAlly && officer === this.nearbyOfficer) return;
    this.nearbyAlly = ally;
    this.nearbyOfficer = officer;

    if (ally && !this.dialogue.isOpen) {
      this.dialogue.show(ally.name, `${ally.name} (${ally.role}) — [E] 대화`);
      this.proximityHint = true;
    } else if (officer && !ally && !this.dialogue.isOpen) {
      const o = this.state.officer;
      this.dialogue.show(o.name, `${o.name} (${o.role}) — [E] 대화 · [F] 접선 코드`);
      this.proximityHint = true;
    } else if (!ally && !officer && this.proximityHint) {
      this.dialogue.hide();
      this.proximityHint = false;
    }
  }
}
```

- [ ] **Step 2: 씬 등록**

`src/client/main.js` 3행 다음에 추가:

```js
import { TutorialScene } from './scenes/TutorialScene.js';
```

같은 파일 26행을 교체:

```js
  // Boot(에셋 로드 + 스테이지 fetch 착수) → Intro(오프닝) → Tutorial(본부 훈련) → Stage(플레이)
  scene: [BootScene, IntroScene, TutorialScene, StageScene],
```

- [ ] **Step 3: Intro → Tutorial 배선**

`src/client/scenes/IntroScene.js` 의 `/** 오프닝이 끝났다 — 스테이지 상태가 준비됐으면 넘어가고, 아직이면 잠깐 대기한다. */` 주석과 `#goStage() {` 줄을 아래로 교체한다 (함수 본문은 그대로 두고 이름만 바뀐다):

```js
  /**
   * 오프닝이 끝났다 — 튜토리얼(본부)로 넘어간다.
   *
   * 스테이지 1 의 LLM 대기는 이제 튜토리얼이 흡수하므로 여기서 기다리지 않는다.
   * ?notutorial 로 건너뛸 때만 예전처럼 직접 기다린다.
   */
  #goStage() {
    if (new URLSearchParams(window.location.search).has('notutorial')) {
      this.#waitAndStartStage();
      return;
    }
    this.scene.start('Tutorial');
  }

  /** 스테이지 상태가 준비됐으면 넘어가고, 아직이면 잠깐 대기한다. */
  #waitAndStartStage() {
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 `✓ built in ...`

- [ ] **Step 5: 수동 확인**

터미널 1 `npm run dev:server`, 터미널 2 `npm run dev:client`.
브라우저에서 `http://localhost:5173/` 를 열고 오프닝을 `[Space]` 로 건너뛴다.

확인 항목:
1. 본부 맵이 뜨고 사방 벽에 막힌다
2. 간부 1명 + 동료 3명이 보이고, 동료 머리 위에 `●●` 가 있다
3. 간부 브리핑이 뜨고 `[Space]` 로 닫힌다
4. NPC 앞에 서면 안내가 뜨고, 벗어나면 사라진다
5. `http://localhost:5173/?notutorial` 로 열면 튜토리얼을 건너뛰고 스테이지 1로 간다

- [ ] **Step 6: 커밋**

```bash
git add src/client/scenes/TutorialScene.js src/client/main.js src/client/scenes/IntroScene.js
git commit -m "$(cat <<'EOF'
feat: 튜토리얼 씬 골격 — 본부를 걷고 동료 앞에 선다

오프닝 다음이 곧장 스테이지가 아니라 본부가 된다. 스테이지 1의 LLM 대기는
이제 튜토리얼이 흡수하므로 Intro 는 기다리지 않는다 (?notutorial 로 건너뛸 때만 대기).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 대화 · 코드 입력 · 세트 교체 연출 · 스테이지 1 전환

**Files:**
- Modify: `src/client/scenes/TutorialScene.js` (`create`/`update` 확장 + 메서드 6개 추가)

**Interfaces:**
- Consumes: `POST /api/tutorial/talk`, `POST /api/tutorial/guess` (Task 4·5)
- Consumes: `readSSE(res, onPayload)` from `src/client/net.js` (Task 1)
- Consumes: `this.registry.get('startPromise')` — `BootScene` 이 얹어 둔 `{state}|{error}` 프로미스
- Produces: 클리어 시 `this.scene.start('Stage', { state })`

- [ ] **Step 1: import 와 대화창 핸들러 연결**

`src/client/scenes/TutorialScene.js` 의 `import hqData from '../assets/hq.json';` 앞 줄에 추가:

```js
import { readSSE } from '../net.js';
```

`TutorialScene.create()` 의 `this.dialogue = new DialogueBox();` 다음 두 줄을 추가:

```js
    this.dialogue.onSend = (message) => this.#chat(message);
    this.dialogue.onCode = (guess) => this.#submitGuess(guess);
```

- [ ] **Step 2: `update()` 에 [E]·[F] 처리 추가**

`update()` 의 `this.#checkProximity();` 다음, `if (!typing && ... keySpace)` 앞에 삽입:

```js
    if (!typing && Phaser.Input.Keyboard.JustDown(this.keyE)) {
      if (this.nearbyAlly) this.#talk(this.nearbyAlly);
      else if (this.nearbyOfficer) this.#talkOfficer();
    }
    // F — 코드 입력은 간부 앞에서만 열린다 (스테이지 1의 접선책과 같은 규칙).
    if (!typing && Phaser.Input.Keyboard.JustDown(this.keyF)) {
      if (this.nearbyOfficer) this.#offerCode();
      else {
        this.proximityHint = false;
        this.dialogue.show('접선 코드', '코드는 간부에게만 건넨다.\n간부 앞으로 가서 [F].');
        this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
      }
    }
```

- [ ] **Step 3: 대화 메서드 추가**

`#checkProximity()` 메서드 다음(클래스 닫는 `}` 앞)에 추가:

```js

  /** E — 동료. 고정 첫 대사(힌트)를 보이고 자유 입력을 연다. */
  #talk(ally) {
    this.currentAllyId = ally.id;
    this.proximityHint = false;
    const live = this.state.allies.find((a) => a.id === ally.id) ?? ally;
    this.dialogue.show(`${live.name} (${live.role})`, `"${live.line}"`);
    this.dialogue.showInput('더 물어본다...', 'chat');
    this.dialogue.setHint('[Enter] 대화 · [Esc] 닫기');
  }

  /** E — 간부. 고정 대사만 한다 (자유 대화는 동료에게서 배운다). */
  #talkOfficer() {
    const o = this.state.officer;
    this.proximityHint = false;
    this.dialogue.show(
      `${o.name} (${o.role})`,
      '"셋의 말을 다 들었나?\n\n' +
        '하나는 색을 말하고, 하나는 그것이 무엇으로 분류되는지를 말하고,\n' +
        '하나는 누구나 아는 이야기를 말한다.\n세 갈래가 한 점에서 만난다 — 거기가 코드다.\n\n' +
        '답을 찾았으면 [F]."',
    );
    this.dialogue.setHint('[F] 코드 전달 · [Space] 닫기');
  }

  /** F — 간부에게 코드를 건넨다. 입력창은 오직 여기서만 열린다. */
  #offerCode() {
    const o = this.state.officer;
    this.proximityHint = false;
    this.dialogue.show(`${o.name} (${o.role})`, '"…코드는?"');
    this.dialogue.showInput('접선 코드 입력...', 'code');
    this.dialogue.setHint('[Enter] 코드 전달 · [Esc] 취소');
  }

  /** 자유 대화 — 서버가 SSE 로 흘려보내는 응답을 델타 단위로 붙인다. */
  async #chat(message) {
    const ally = this.state.allies.find((a) => a.id === this.currentAllyId);
    if (!ally) return;

    this.dialogue.setBusy(true);
    this.dialogue.beginStream(`${ally.name} (${ally.role})`);

    try {
      const res = await fetch('/api/tutorial/talk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.state.sessionId,
          allyId: this.currentAllyId,
          message,
        }),
      });

      // 실패는 SSE 가 아니라 JSON 으로 온다 (스트림 시작 전에 거절된 경우).
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      await readSSE(res, (payload) => {
        if (payload.type === 'text') this.dialogue.append(payload.text);
        else if (payload.type === 'error') throw new Error(payload.error);
      });
    } catch (err) {
      // 자유 대화는 "있으면 좋은 것"이다 — 실패하면 고정 첫 대사로 되돌려 진행을 막지 않는다.
      console.warn('[tutorial/talk]', err.message);
      this.dialogue.show(`${ally.name} (${ally.role})`, `"${ally.line}"\n\n(…그 이상은 말이 없다.)`);
    } finally {
      this.dialogue.setBusy(false);
    }
  }

  async #submitGuess(guess) {
    this.dialogue.setBusy(true);
    this.dialogue.show('...', `"${guess}"...`);

    let result;
    try {
      const res = await fetch('/api/tutorial/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.state.sessionId, guess }),
      });
      result = await res.json();
      if (!res.ok) throw new Error(result.error ?? `HTTP ${res.status}`);
    } catch (err) {
      // 판정이 실패한 것뿐이다 — 서버도 신뢰도를 깎지 않았으니 오답으로 취급하지 않는다.
      console.warn('[tutorial/guess]', err.message);
      this.dialogue.show(
        `${this.state.officer.name} (${this.state.officer.role})`,
        '"…뭐라고? 다시 말해 보게."',
      );
      return;
    } finally {
      this.dialogue.setBusy(false);
    }

    this.state = result.state;
    this.#refreshTrust();

    if (result.correct) {
      this.#clear(result.codeWord);
      return;
    }
    if (result.replaced) {
      this.#onReplaced(result.officerLine);
      return;
    }

    const opened = this.state.allies.every((a) => a.opened);
    this.dialogue.show(
      `${this.state.officer.name} (${this.state.officer.role})`,
      '"틀렸다."\n\n동료들의 표정이 굳는다. 신뢰가 한 칸씩 깎였다.' +
        (opened
          ? '\n\n다시 물어보면, 이번엔 왜 그 단어를 떠올렸는지까지 말해 줄 것이다.'
          : '\n\n동료들에게 다시 물어보고 오너라.'),
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  /** 누적 3회 실패 — 간부 앞으로 불려 가 코드를 갈아 치운다. */
  #onReplaced(officerLine) {
    this.dialogue.hideInput();
    const os = hqData.spawns.officer;
    // 간부 바로 아래 칸으로 옮긴다 — "불려 갔다"는 연출이자, 다음 [F] 가 바로 닿는 자리다.
    this.player.body.reset(os.col * TILE + TILE / 2, (os.row + 1) * TILE + TILE / 2);
    this.proximityHint = false;
    this.dialogue.show(
      `${this.state.officer.name} (${this.state.officer.role})`,
      `"${officerLine}"`,
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  #clear(codeWord) {
    this.ended = true;
    this.player.body.setVelocity(0, 0);
    this.dialogue.hideInput();
    this.dialogue.setHint('');
    this.dialogue.show(
      `${this.state.officer.name} (${this.state.officer.role})`,
      `접선 코드는 「${codeWord}」 였다.\n\n` +
        '"이제 알겠지. 거리에서도 방식은 같다.\n\n가라. 시계 수리공이 기다린다."',
    );
    this.time.delayedCall(2600, () => this.#goStage());
  }

  /** 스테이지 1 로. Boot 가 쏘아 둔 fetch 는 튜토리얼이 도는 동안 이미 끝나 있다. */
  #goStage() {
    const waiting = this.add
      .text(this.scale.width / 2, this.scale.height / 2, '거리로 나가는 중…', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '15px',
        color: '#8a7f6a',
      })
      .setOrigin(0.5)
      .setDepth(51);

    // Boot 가 얹어둔 프로미스는 {state} 또는 {error} 로만 resolve 한다 (절대 reject 안 함).
    Promise.resolve(this.registry.get('startPromise')).then((res) => {
      if (!res || res.error) {
        waiting.destroy();
        this.dialogue.show(
          '오류',
          `스테이지 시작 실패\n${res?.error ?? '알 수 없는 오류'}\n\n.env 에 ANTHROPIC_API_KEY 를 넣었는지 확인하세요.`,
        );
        return;
      }
      this.dialogue.hide();
      this.scene.start('Stage', { state: res.state });
    });
  }
```

- [ ] **Step 4: 세션 소실 복구**

`npm run dev:server` 는 `--watch` 라 서버 파일을 고칠 때마다 재시작되고, 그때 인메모리 세션이 사라진다. 그 뒤의 모든 요청은 404 가 되어 튜토리얼이 조용히 먹통이 된다 — 개발 중에 반드시 만나는 상황이라 복구를 넣는다.

`#restartSession` 메서드를 `#goStage()` 다음(클래스 닫는 `}` 앞)에 추가:

```js

  /**
   * 세션이 사라졌다 (서버 재시작 등) — 씬을 다시 시작해 새 세션을 연다.
   * scene.restart 는 init() 부터 다시 돌아 상태·노드가 모두 초기화된다.
   */
  #restartSession() {
    this.dialogue.hideInput();
    this.dialogue.show('본부', '…연결이 끊겼다.\n\n처음부터 다시 브리핑을 받는다.');
    this.time.delayedCall(1400, () => this.scene.restart());
  }
```

`#chat` 의 `if (!res.ok) {` 블록 **앞**에 삽입:

```js
      if (res.status === 404) {
        this.#restartSession();
        return;
      }
```

`#submitGuess` 의 `result = await res.json();` 다음 줄에 삽입:

```js
      if (res.status === 404) {
        this.#restartSession();
        return;
      }
```

- [ ] **Step 5: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 `✓ built in ...`

- [ ] **Step 6: 수동 확인 (전체 흐름 1회)**

`npm run dev:server` + `npm run dev:client` 로 `http://localhost:5173/` 를 연다.
정답을 미리 보려면 서버 콘솔의 `[tutorial] 세션 ... 시작 — 코드: "..."` 줄을 본다.

확인 항목:
1. 동료에게 `[E]` → 고정 첫 대사가 뜨고 입력창이 열린다. 무언가 물으면 응답이 흘러나온다
2. 신뢰도 2 상태에서 "왜 그 단어를 떠올렸어?" 라고 물으면 **이유를 말하지 않는다**
3. 간부에게 `[F]` → 입력창. 일부러 틀리면 머리 위 표시가 `●●` → `●○` 로 줄어든다
4. 두 번 틀리면 `○○` 가 되고, 동료의 첫 대사가 강화 힌트로 바뀐다
5. 세 번 틀리면 플레이어가 간부 앞으로 옮겨지고 새 코드 안내가 뜬다. 동료 대사도 새 세트로 바뀐다
6. 정답을 넣으면 코드가 공개되고 2~3초 뒤 스테이지 1이 시작된다 (대기 문구가 스쳐도 정상)
7. 동료가 아닌 곳에서 `[F]` 를 누르면 "코드는 간부에게만" 안내가 뜬다
8. 튜토리얼 도중 서버를 재시작(`Ctrl+C` 후 `npm run dev:server`)하고 코드를 넣으면 "연결이 끊겼다" 뒤 브리핑부터 다시 시작된다

- [ ] **Step 7: 커밋**

```bash
git add src/client/scenes/TutorialScene.js
git commit -m "$(cat <<'EOF'
feat: 튜토리얼 대화·코드 입력·세트 교체 연출 — 본부에서 스테이지 1까지 이어진다

코드 입력은 간부 앞에서만 열린다 (스테이지 1의 접선책과 같은 규칙을 여기서 가르친다).
자유 대화와 판정이 실패해도 진행을 막지 않는다 — 대화는 고정 대사로 되돌리고,
판정 실패는 오답으로 세지 않는다.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 문서 반영

**Files:**
- Modify: `NAN2026_계획서.md:156-160` (§4.6 표 행 #8)
- Modify: `NAN2026_계획서.md:99-103` (§4.2)
- Modify: `README.md:169-175` (진행 체크리스트)

- [ ] **Step 1: 계획서 §4.6 표 갱신**

`NAN2026_계획서.md` §4.6 표의 행 #8 "미구현 신규" 의 "스토리보드 확정" 열에서 `튜토리얼(신뢰도 2), ` 를 지우고, "조치" 열을 아래로 교체:

```
| 8 | 미구현 신규 | — | 도주 QTE, 스테이지 2 전체, 스테이지 3 잠입(발각 게이지·엄폐), 오프닝·엔딩 | W2~W3 신규 개발 (§7). ~~튜토리얼~~ **반영 완료 (2026-07-21)** — 고정 힌트 세트 3개, 신뢰도 2(오답 −1 / 0에서 강화 힌트 / 3회 누적 시 세트 교체), 코드 입력은 간부 전용, 전용 본부 맵 `hq.json` |
```

- [ ] **Step 2: 계획서 §4.2 에 구현 사실 명시**

`NAN2026_계획서.md` §4.2 의 마지막 줄(`- 동료 1~3은 자유 대화 입력이 가능하되 힌트 범위 안에서만 응답 (난이도 보호)`) 다음에 추가:

```markdown
- **구현 (2026-07-21)**: 힌트는 LLM 생성이 아니라 고정 세트 3개(`src/data/tutorial.json`)다 — 진입 대기 0초, 매 판 동일해서 시연 영상·심사 첫 판의 난이도가 보장된다. 힌트 축은 동료별로 고정(t1 색상 / t2 분류 / t3 대중적 특징)이라 세트가 교체돼도 학습 구조가 남는다. 자유 대화만 Haiku(`/api/tutorial/talk`, SSE)이며, **강화 힌트(reason)는 신뢰도 0 전까지 프롬프트에 넣지 않는다** — 모르는 것은 유출될 수 없다.
```

- [ ] **Step 3: README 체크리스트 갱신**

`README.md` 의 `- [ ] 게임 실플레이 검증 (\`npm run dev\`) ← **다음 작업**` 줄 다음에 추가:

```markdown
- [x] **튜토리얼 (레지스탕스 본부)** — 고정 힌트 세트 3개 + 신뢰도 2 규칙 + 전용 맵. 오프닝 → 튜토리얼 → 스테이지 1 로 이어진다 (`?notutorial` 로 건너뜀). 검증: `npm run smoke:tutorial`
```

- [ ] **Step 4: 커밋**

```bash
git add NAN2026_계획서.md README.md
git commit -m "$(cat <<'EOF'
docs: 튜토리얼 반영 완료 기록 — §4.6 미구현 목록에서 제거

고정 세트를 택한 이유(진입 대기 0초·시연 난이도 보장)와 강화 힌트 잠금 규칙을
계획서 §4.2 에 남긴다.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 완료 기준

전부 끝나면 아래가 성립한다:

1. `npm run smoke:tutorial` 이 전부 OK 로 통과한다 (비유출 · 신뢰도 · 세트 교체 · SSE · 클리어)
2. `npm run smoke` (스테이지 1 기존 스모크)가 여전히 통과한다
3. `npm run build` 가 에러 없이 끝난다
4. 브라우저에서 오프닝 → 튜토리얼 → 스테이지 1 이 **한 번도 끊기지 않고** 이어진다 — 계획서 §7 의 W2 DoD
