# 대화창 화자 초상 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대화창에 말하는 인물의 초상 일러스트를 붙인다. 아트 할 일 ① (스토리보드 p9 / `개선로드맵.md`).

**핵심 제약 — 그림이 아직 없다.** 일러스트는 기획자가 보유 중이고 레포에 파일이 없다. 따라서 이 계획은
**그림 0장 상태에서 전부 머지 가능**해야 하고, 나중에 `public/portraits/` 에 파일만 떨구면 코드 수정 없이 붙어야 한다.
`IntroScene` 의 브릿지 초상(`/intro/handler.png`, `IntroScene.js:228` — `textures.exists()` 로 검사 후 없으면 텍스트만 중앙 정렬)과
`public/intro/README.md` 의 에셋 계약이 이미 이 패턴을 쓰고 있다. 그대로 따른다.

**Architecture:** 대화창은 이미 DOM 오버레이(`#dialogue`)다. 초상도 DOM `<img>` 로 붙여 CSS 레이아웃에 얹는다.
Phaser 캔버스·`theme.js` 는 건드리지 않는다. 진짜 작업은 **화자 식별 경로를 만드는 것**이다 (아래 §화자 식별 문제).

**Tech Stack:** HTML/CSS(그리드 2컬럼), 바닐라 JS. 신규 의존성 없음.

---

## 화자 식별 문제 (이 계획의 설계 중심)

`DialogueBox.show(speaker, text)` 의 `speaker` 는 **표시용 완성 문자열**이다:

```js
this.dialogue.show(`${ally.name} (${ally.role})`, '...');  // StageScene.js:599
this.dialogue.show('접선 지령', lines.join('\n'));          // StageScene.js:216
this.dialogue.reply('오류', err.message);                   // StageScene.js:621
```

초상 파일을 고르려면 **persona id** (`watchmaker`, `maid`, `t1`, `officer` …) 가 필요한데 그 정보가 대화창까지 오지 않는다.
게다가 호출부 44곳 중 상당수는 `'접선 지령'` `'오류'` `'디버그'` `'...'` `'본부'` 처럼 **초상이 있으면 안 되는 시스템 화자**다.

**결정: 선택적 4번째 인자로 id 를 넘긴다.** 이름 문자열 역파싱은 하지 않는다 —
`'미라'`(t1)와 스테이지 동료 이름이 언젠가 겹치면 조용히 틀린 얼굴이 뜨고, 화자 표기 포맷을 바꾸는 순간 깨진다.

```js
show(speaker, text, opts = {})            // opts.portrait = persona id
reply(speaker, text, hint = '', opts = {}) // hint 가 이미 3번째라 4번째
beginStream(speaker, opts = {})
```

`opts.portrait` 를 안 넘기면 초상 없음 = **현재와 픽셀 동일한 레이아웃**. 시스템 화자 호출부는 한 줄도 안 고쳐도 된다.
id → 프레임 매핑은 `StageScene.js:29` 의 `ALLY_FRAME` 이 이미 같은 형태로 있다 (스프라이트용). 초상은 파일명이 곧 id라 매핑 테이블 자체가 불필요하다.

## Global Constraints

- **그림 0장에서 회귀가 없어야 한다** — 초상 파일이 하나도 없는 상태의 대화창은 현재와 동일하게 보여야 한다. 이게 Task 5 의 1차 합격 기준.
- 파일 없음은 오류가 아니다 — `<img>` `onerror` 로 조용히 초상 열을 접는다. 콘솔 에러·빈 액자·깨진 이미지 아이콘 금지.
- `DialogueBox` 의 기존 메서드 시그니처는 **하위 호환** — 인자를 늘리기만 하고 순서를 바꾸지 않는다.
- 대화창 규약 유지 ([[improvement-roadmap]]): `show()` = 플레이어가 누른 순간 / `reply()` = 응답이 도착한 순간(닫아뒀으면 안 뜸). 초상 배선이 이 구분을 흐리면 안 된다.
- 캔버스 UI(`theme.js`, `drawOrnateFrame`, HUD, 단서 수첩)는 이번 스코프 밖.
- 팔레트·폰트는 기존 토큰(`index.html :root`)에서만. 신규 색 리터럴 금지.
- 주석은 기존 파일들의 한국어 서술 스타일을 따른다.

## 레이아웃 방향 (레퍼런스 반영)

사용자가 준 레퍼런스(삼국지 계열 대화 바)의 구조를 그대로 가져간다:

```
   ┌───────┐
   │       │  ← 초상이 대화창 위로 솟는다 (overflow visible)
   │  초상  │  ┌──────────────────────────────────┐
   │       │  │ [ 에이다 (시계공) ]  ← 황동 명판    │
   └───────┴──┤ 본문 텍스트…                      │
              │ [입력창] [대화] [접선 코드 전달]     │
              └──────────────────────────────────┘
```

- 초상은 **좌측 고정**, 대화 패널 상단선 위로 솟아오른다 — 레퍼런스의 인상이 여기서 나온다.
- 명판·본문·입력·힌트는 지금 구조 그대로 우측 열에 들어간다. **DOM id 는 전부 유지**한다 (`DialogueBox.js` 가 `getElementById` 로 잡고 있다).
- 초상 없을 때 `.no-portrait` → 1컬럼 = 현재 레이아웃.

---

### Task 1: 에셋 계약 — `public/portraits/README.md`

기획자에게 그대로 넘길 스펙 문서. **코드보다 먼저 확정해야** 파일이 도착했을 때 재작업이 없다.

**Files:**
- Create: `public/portraits/README.md`
- Modify: `design/assets.csv` (초상 10행 추가)

**Interfaces:**
- Produces: 파일명 계약 `public/portraits/<persona id>.png` — Task 3 이 이 경로를 만든다.

- [ ] **Step 1: id 목록 확정**

`src/data/personas.json` + `src/data/tutorial.json` 이 단일 출처다. 총 **10장**:

| 파일 | 인물 | 출처 |
|---|---|---|
| `watchmaker.png` | 에이다 · 시계공 (54M) | personas.allies |
| `maid.png` | 리나 · 주방 하녀 (18F) | personas.allies |
| `engineer.png` | 보리스 · 기관사 (35M) | personas.allies |
| `smuggler.png` | 카이 · 밀수꾼 (28M) | personas.allies |
| `musician.png` | 노아 · 거리 악사 (34M) | personas.allies |
| `fixer.png` | 요른 · 시계 수리공 (접선책) | personas.broker |
| `t1.png` | 미라 · 인쇄공 (40F) | tutorial.allies |
| `t2.png` | 한나 · 사서 (31F) | tutorial.allies |
| `t3.png` | 테오 · 이야기꾼 (26M) | tutorial.allies |
| `officer.png` | 베르나 · 간부 | tutorial.officer |

우선순위: 튜토리얼 4장(`t1`~`t3`, `officer`)이 **플레이어가 가장 먼저 보는 얼굴**이다. 그림이 순차 도착한다면 이 4장부터.

- [ ] **Step 2: 규격 작성**

- 형식 PNG, **배경 투명**(황동 프레임·가죽 패널 위에 얹힌다)
- 권장 비율 **4:5 세로 흉상**, 권장 해상도 **640×800 이상**
  (표시 높이는 CSS 220px 안팎 — 고DPI 화면에서 뭉개지지 않게 2배 이상 여유)
- **비율은 강제하지 않는다** — CSS 가 `object-fit: contain` + 높이 기준 스케일이라 3:4, 1:1 도 그대로 들어간다.
  기획자 보유 원본이 어떤 비율이든 일단 붙여보고 조정한다.
- 세이프 에어리어: **얼굴이 상단 55% 안에** 들어와야 한다. 하단은 대화 패널에 가려질 수 있다.
- 시선은 화면 안쪽(우측)을 향하는 편이 대사와 붙어 읽힌다. 강제는 아님.

- [ ] **Step 3: 스타일 라인 — STYLE FORMULA 를 그대로 쓰면 안 된다**

`design/style-formula.txt` 는 **32×32 탑다운 도트 스프라이트**용이다("chunky pixel art, 32x32 grid feel, consistent top-down perspective").
대화창 초상은 **정면 흉상 일러스트**라 렌더링·퍼스펙티브 항목이 정면 충돌한다.
**팔레트와 무드만 상속**하고 나머지는 새로 정의한다:

```
PORTRAIT STYLE LINE (대화창 초상 전용 — STYLE FORMULA 의 팔레트·무드만 상속)
Painted bust portrait, three-quarter view, chest-up framing, transparent background;
dark tarnished brass-brown and worn leather palette with warm cream highlights
(#c9a227 brass / #e8dcc0 cream / #2c2018 leather / #4a7a6b muted teal / #c25b4a rust);
dim gaslit Victorian-steampunk mood, single warm key light from upper left, deep shadow side;
readable silhouette against dark panel, no background elements, no text.
```

역할별 색 배분은 STYLE FORMULA 를 따른다 — 동료는 teal/rust/leather 로 서로 구분, 간부·접선책은 별도 톤.

- [ ] **Step 4: 폴백 동작 명시**

`public/intro/README.md` 와 같은 톤으로: "파일이 없어도 게임은 돌아간다 — 초상 자리가 접히고 대화창이 지금 모습 그대로 나온다.
아래 이름대로 파일만 떨구면 코드 수정 없이 붙는다."

**Verification:**
- [ ] 문서만 읽고 기획자가 파일명·비율·배경을 결정할 수 있는가 (id 10개가 전부 표에 있는가)
- [ ] `design/assets.csv` 에 10행이 추가되고 `type` 이 기존 `sprite`/`tile` 과 구분되는 값(`portrait`)인가

---

### Task 2: DOM 구조 + CSS

**Files:**
- Modify: `src/client/index.html` (`#dialogue` 스타일 블록 + body 마크업)

**Interfaces:**
- Produces: `#dialogue-portrait`(img), `#dialogue-body`(우측 열 래퍼), `.no-portrait` 클래스 — Task 3 이 조작한다.

- [ ] **Step 1: 마크업 — 기존 id 를 감싸기만 한다**

```html
<div id="dialogue" class="sp-panel no-portrait">
  <img id="dialogue-portrait" alt="" />
  <div id="dialogue-body">
    <div id="dialogue-speaker"></div>
    <div id="dialogue-text"></div>
    <div id="dialogue-input"> … 기존 그대로 … </div>
    <div id="dialogue-hint">[Enter] 대화 · [Esc] 닫기</div>
  </div>
</div>
```

기존 자식 5개는 이름·순서 그대로 `#dialogue-body` 안으로 들어간다. `DialogueBox.js` 의 `getElementById` 는 전부 그대로 산다.
초기 클래스가 `no-portrait` 인 것이 중요하다 — **그림이 없는 지금이 기본 상태**다.

- [ ] **Step 2: 2컬럼 그리드**

```css
#dialogue {
  /* 초상이 패널 위로 솟는다 — 레퍼런스의 인상이 여기서 나온다. */
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 18px;
  align-items: end;
  overflow: visible;
}
#dialogue.no-portrait { grid-template-columns: 1fr; }
#dialogue.no-portrait #dialogue-portrait { display: none; }
```

`.sp-panel` 의 `border-radius`/`box-shadow` 는 `overflow: visible` 과 공존한다 — 잘리는 건 자식뿐인데 자식을 안 자르므로 문제없다.

- [ ] **Step 3: 초상 프레임**

```css
#dialogue-portrait {
  height: 220px;
  width: auto;              /* 비율 무관 — 기획자 원본이 4:5 든 1:1 이든 받는다 */
  max-width: 200px;
  object-fit: contain;
  object-position: bottom;
  /* 패널 상단선 위로 솟는다. 패널 padding(14px) 을 상쇄하고 더 밀어 올린다. */
  margin: -84px 0 -14px 0;
  align-self: end;
  /* 어두운 배경에서 실루엣이 뜨도록 — 황동 하이라이트 방향(좌상단 키라이트)과 맞춘다. */
  filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.65));
}
```

- [ ] **Step 4: 명판 정렬 확인**

`#dialogue-speaker` 는 `display: inline-block` 이라 우측 열 좌상단에 그대로 붙는다. 초상이 붙어도 규칙이 안 바뀐다.
레퍼런스처럼 명판이 초상 오른쪽 어깨선에 걸리는지 눈으로 확인하고, 어긋나면 `margin` 이 아니라 `align-items` 로 잡는다.

**Verification:**
- [ ] `.no-portrait` 상태에서 대화창이 **현재와 동일**한가 (커밋 전후 스크린샷 대조)
- [ ] `no-portrait` 를 손으로 떼고 더미 이미지를 넣었을 때 2컬럼이 되고 초상이 패널 위로 솟는가
- [ ] 초상이 있을 때도 입력창 `flex: 1` 이 살아 있고 버튼 2개가 안 눌리는가
- [ ] 긴 본문(진입 쪽지, `StageScene.js:187` `#showBriefing` 의 8줄짜리)에서 패널이 세로로 늘 때 초상이 같이 안 늘어나는가

---

### Task 3: `DialogueBox` API — 초상 세팅과 폴백

**Files:**
- Modify: `src/client/ui/DialogueBox.js`

**Interfaces:**
- Consumes: `#dialogue-portrait`, `.no-portrait` (Task 2)
- Produces: `show/reply/beginStream` 의 `opts.portrait` — Task 4 가 사용

- [ ] **Step 1: 엘리먼트 참조 + `#setPortrait` 추가**

```js
/**
 * 화자 초상 교체. id 는 persona id (watchmaker, t1, officer …) = 파일명.
 *
 * 그림은 아직 전부 도착하지 않았다 — 없는 파일은 오류가 아니라 "초상 없는 화자"다.
 * onerror 에서 열을 접어, 있는 얼굴만 조용히 붙는다 (IntroScene 의 handler.png 와 같은 규약).
 */
#setPortrait(id) {
  if (!id) { this.root.classList.add('no-portrait'); return; }
  const src = `/portraits/${id}.png`;
  // 같은 화자로 연속 호출될 때(스트리밍 중 reply 등) 깜빡이지 않게 한다.
  if (this.portraitEl.dataset.id === id) return;
  this.portraitEl.dataset.id = id;
  this.portraitEl.onerror = () => {
    this.root.classList.add('no-portrait');
    this.portraitEl.dataset.id = '';   // 다음 시도에서 다시 붙을 여지를 남긴다
  };
  this.portraitEl.onload = () => this.root.classList.remove('no-portrait');
  this.portraitEl.src = src;
}
```

`onerror` 는 `src` 대입 **전에** 걸어야 캐시된 404 도 잡힌다.

- [ ] **Step 2: 시그니처 확장 — 하위 호환**

```js
show(speaker, text, opts = {}) {
  this.dismissed = false;
  this.#setPortrait(opts.portrait);
  …기존 그대로…
}
reply(speaker, text, hint = '', opts = {}) {
  if (this.dismissed) return false;
  this.show(speaker, text, opts);
  this.setHint(hint);
  return true;
}
beginStream(speaker, opts = {}) {
  this.#setPortrait(opts.portrait);
  …기존 그대로…
}
```

`reply` 는 이미 `show` 를 부르므로 opts 만 흘려보내면 된다.

- [ ] **Step 3: `#reset()` 에 초상 초기화 추가**

싱글턴이라 `scene.restart` 후에도 살아남는다 (`DialogueBox.js:15` 주석). 재시작 시 이전 판 얼굴이 남으면 안 된다:

```js
this.portraitEl.dataset.id = '';
this.root.classList.add('no-portrait');
```

- [ ] **Step 4: 프리캐시**

첫 대화에서 초상이 한 박자 늦게 뜨면 깜빡임으로 보인다. 생성자 끝에서 백그라운드로 받아 둔다:

```js
// 첫 표시 깜빡임 방지 — 실패(404)는 무시한다. 여기서 미리 받아두면
// #setPortrait 는 캐시에서 즉시 그린다.
for (const id of PORTRAIT_IDS) { const im = new Image(); im.src = `/portraits/${id}.png`; }
```

`PORTRAIT_IDS` 는 모듈 상수 배열 10개. **id 목록이 여기에도 박히는 중복**이므로,
`personas.json`/`tutorial.json` 이 단일 출처임을 주석으로 명시한다 (`:root` ↔ `theme.js` 중복과 같은 성격).

**Verification:**
- [ ] `/portraits/` 가 빈 폴더인 상태에서 대화창을 열었을 때 콘솔 에러 0, 레이아웃 현재와 동일
  (404 는 네트워크 탭에만 남는다 — 이건 정상)
- [ ] 더미 PNG 한 장(`t1.png`)만 넣고 튜토리얼 진행 → 미라만 초상, 나머지는 접힘
- [ ] 초상 있는 화자 → 없는 화자로 넘어갈 때 이전 얼굴이 안 남는가
- [ ] 재시작(`R` 또는 결과 화면) 후 초상이 초기화되는가

---

### Task 4: 호출부 배선

**Files:**
- Modify: `src/client/scenes/StageScene.js`
- Modify: `src/client/scenes/TutorialScene.js`

**배선 규칙:** 화자가 **실존 인물**인 호출에만 `{ portrait: <id> }` 를 붙인다.
`'접선 지령'` `'오류'` `'디버그'` `'...'` `'본부'` `'접선 코드'` 는 **의도적으로 붙이지 않는다** — 이건 나레이션이지 인물이 아니다.

- [ ] **Step 1: StageScene — 동료**

`ally.id` 를 그대로 넘긴다. 대상 앵커 (`grep -n "dialogue\.\(show\|reply\|beginStream\)" src/client/scenes/StageScene.js` 로 전수 확인):
`:599` 대화 시작 · `:609` 접선 시도 · `:632` 접선 결과 reply · `:716` · `:726` 구출 · `:783` beginStream(자유 대화 스트리밍) · `:750` 구출 결과 reply

- [ ] **Step 2: StageScene — 접선책**

`this.state.broker.id` (= `fixer`). 앵커: `:643` `:654` `:837` `:848`.
`:815` 의 `show('...', …)` 는 **코드를 건네는 순간의 침묵**이라 화자가 없다 — 붙이지 않는다.

- [ ] **Step 3: TutorialScene — 동료 3인 + 간부**

앵커: `:216` `:233` `:267` `:298` (동료 → `ally.id`), `:220` `:242` `:256` `:325` (간부 → `this.state.officer.id` = `officer`).
`:418` `'본부'` 는 붙이지 않는다.

- [ ] **Step 4: 누락 스윕**

배선 후 `grep -n "dialogue\.\(show\|reply\|beginStream\)"` 를 다시 돌려 **모든 호출부를 "붙임/의도적 미붙임" 둘 중 하나로 분류**한다.
[[improvement-roadmap]] 의 교훈: 잔여 스캔 grep 은 넓게 — 좁은 패턴이 BootScene 잔존 리터럴을 놓쳤던 전례가 있다.

**Verification:**
- [ ] 더미 PNG 10장(구분되는 색 사각형이면 충분)을 넣고 튜토리얼→스테이지 완주
- [ ] 각 인물 대화에서 **맞는 얼굴**이 뜨는가 (특히 자유 대화 스트리밍 `beginStream` → `append` 사이 유지)
- [ ] 시스템 화자 대화에서 이전 인물 얼굴이 안 남는가
- [ ] `[Esc]` 로 닫았다가 다시 열 때 초상이 따라오는가

---

### Task 5: 검증 + 문서

**Files:**
- Modify: `docs/개선로드맵.md` (아트 할 일 ① 진행 상태)

- [ ] **Step 1: 무초상 회귀 확인 (1차 합격 기준)**

더미 PNG 를 **전부 지우고** dev 서버 실행 → 대화창이 이 작업 전과 동일한지 스크린샷 대조.
이게 깨지면 나머지가 다 맞아도 머지하지 않는다. 그림 도착 시점이 불명이라 **무초상이 당분간의 기본 상태**다.

- [ ] **Step 2: 유초상 스크린샷**

더미 PNG 로 튜토리얼 대화·스테이지 접선·구출·결과 4컷. 헤드리스 CDP 사용 시 주의 ([[improvement-roadmap]]):
`keyboard.press()` 는 Phaser `JustDown` 을 간헐적으로 놓친다 — `down()`→120ms→`up()`.
화면 캡처는 `SetProcessDPIAware` 필수 ([[pc-environment]], 3200×2000@150%).

- [ ] **Step 3: 회귀**

`npm run smoke`, `npm run smoke:tutorial`. 서버 계약을 안 건드렸으므로 통과해야 정상 — 실패하면 배선이 흐름을 깬 것이다.

- [ ] **Step 4: 기획자 전달**

`public/portraits/README.md` 링크와 우선순위(튜토리얼 4장 먼저)를 전달. 원본 비율·배경 투명 여부를 회신받아
필요하면 Task 2 의 `height: 220px` / `max-width: 200px` 를 조정한다.

---

## 스코프 밖 (v2 후보)

- **표정 차분** — 감정별 여러 장(`watchmaker_angry.png` 등). v1 은 1인 1장. 지금 구조에 `opts.portrait` 값만 늘리면 되므로 확장 비용이 낮다.
- **등장 연출** — 페이드인·슬라이드업. CSS transition 한 줄이지만 무초상 회귀 검증을 먼저 통과시키고 붙인다.
- **캔버스 UI 초상** — 단서 수첩에 얼굴을 넣는 건 별건. Phaser 텍스처 로드가 필요해 성격이 다르다.
- 스프라이트(④⑤⑥), 레벨 디자인(③) — 아트 할 일의 다른 항목.
