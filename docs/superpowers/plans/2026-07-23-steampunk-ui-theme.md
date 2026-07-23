# 스팀펑크 UI 테마 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기본 디자인(평면 단색 + 맑은 고딕) UI 전체를 황동·종이·가죽 톤의 스팀펑크 테마로 전환한다.

**Architecture:** DOM 쪽은 `index.html` 인라인 CSS 에 `:root` 토큰 + 공용 클래스(`.sp-panel`/`.sp-btn`)를 만들어 기존 id 스타일이 공유하고, Phaser 캔버스 쪽은 신규 `src/client/ui/theme.js` 가 같은 팔레트·폰트를 상수로 export 해 4개 씬이 가져다 쓴다. 동작 로직(JS API)은 건드리지 않는 순수 스타일링 패스다.

**Tech Stack:** CSS(그라디언트·인라인 SVG feTurbulence), Google Fonts CDN(Hahmlet·Gowun Batang), Phaser Graphics.

**Spec:** `docs/superpowers/specs/2026-07-23-steampunk-ui-design.md`

## Global Constraints

- 이미지 에셋 추가 금지 — 질감은 CSS 그라디언트·인라인 SVG data URI·Phaser Graphics 로만.
- 동작 로직·공개 API 불변 — `DialogueBox`·`MinigamePanel`·`ResultOverlay` 의 메서드와 DOM id 유지.
- 색·폰트는 토큰에서만 지정 — `index.html :root` 와 `ui/theme.js` 는 **의도적 중복**이며 양쪽 상단 주석으로 짝임을 명시한다.
- 폰트 CDN 실패에도 게임은 열려야 한다 — BootScene 폰트 대기는 2초 타임아웃 후 폴백(맑은 고딕) 진행.
- 클라이언트에 단위 테스트 하네스가 없다 — 각 태스크의 검증은 dev 서버 실행 + 해당 화면 상태의 육안/스크린샷 확인이고, 최종 태스크에서 `npm run smoke` 회귀를 돈다.
- 주석은 기존 파일들의 한국어 서술 스타일을 따른다.

---

### Task 1: 웹폰트 + CSS 디자인 토큰 + 페이지 배경/헤더

**Files:**
- Modify: `src/client/index.html` (head 의 폰트 링크, `:root`, `body`, `header`, `#game-root`)

**Interfaces:**
- Produces: CSS 변수 `--brass-hi` `--brass` `--brass-lo` `--leather` `--ink` `--paper` `--paper-dim` `--patina` `--wax` `--font-head` `--font-body` `--noise` — Task 2·3 이 사용.

- [ ] **Step 1: 폰트 링크 추가**

`<title>` 바로 아래에:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=Hahmlet:wght@600;700&display=swap"
  rel="stylesheet"
/>
```

- [ ] **Step 2: `:root` 토큰 확장**

기존 `:root` 블록을 통째로 교체:

```css
/* 디자인 토큰 — src/client/ui/theme.js 와 짝이다 (색을 바꾸면 두 곳 함께). */
:root {
  --brass-hi: #e8c15a; /* 황동 하이라이트 — 그라디언트 상단·광택 */
  --brass: #c9a227;
  --brass-lo: #7a5f1a; /* 황동 음영 — 그라디언트 하단·바깥 테두리 */
  --leather: #2c2018;  /* 가죽 브라운 — 패널 배경 */
  --ink: #1a1712;
  --paper: #e8dcc0;
  --paper-dim: #8a7f6a;
  --patina: #5e8b7e;   /* 성공 — 청동 녹청 */
  --wax: #a03325;      /* 실패 — 봉랍 */
  --font-head: 'Hahmlet', 'Malgun Gothic', serif;
  --font-body: 'Gowun Batang', 'Malgun Gothic', serif;
  /* 은은한 종이 입자 — 외부 파일 없는 인라인 SVG 노이즈 */
  --noise: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E");
}
```

- [ ] **Step 3: 페이지 배경·헤더·캔버스 프레임**

`body` 규칙의 `background`/`font-family` 를 교체하고, `header` 규칙을 교체하고, `#game-root` 에 황동 실선을 더한다:

```css
body {
  margin: 0;
  /* 가죽 책상 위 — 노이즈 + 중앙이 살짝 밝은 비네트 */
  background:
    var(--noise),
    radial-gradient(ellipse at 50% 30%, #241b12 0%, #17110b 55%, #0d0a06 100%);
  color: var(--paper);
  font-family: var(--font-body);
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
}
```

```css
header {
  padding: 12px;
  font-family: var(--font-head);
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--brass);
  letter-spacing: 0.35em;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.8);
  opacity: 0.9;
}
```

`#game-root` 기존 규칙에 한 줄 추가:

```css
box-shadow: 0 0 0 1px var(--brass-lo), 0 12px 48px rgba(0, 0, 0, 0.6);
```

- [ ] **Step 4: 확인**

`npm run dev` 후 vite 가 출력한 로컬 URL 접속: 페이지 배경이 가죽 비네트, 헤더가 황동 세리프 레터링, 대화창 본문이 명조(Gowun Batang)로 보인다. 개발자 도구 Network 에서 fonts.googleapis.com 로드 확인.

- [ ] **Step 5: Commit**

```bash
git add src/client/index.html
git commit -m "feat: 스팀펑크 토큰·웹폰트·페이지 배경 — UI 테마 1/5"
```

---

### Task 2: 공용 부품(.sp-panel/.sp-btn) + 대화창

**Files:**
- Modify: `src/client/index.html` (CSS + `#dialogue`/`#result-card`/`#minigame-card`/버튼들에 클래스 부여)

**Interfaces:**
- Consumes: Task 1 의 CSS 변수.
- Produces: `.sp-panel`(황동 프레임 패널)·`.sp-btn`(황동 버튼) 클래스 — Task 3 도 사용.

- [ ] **Step 1: 공용 클래스 추가**

`#dialogue` 규칙 위에 삽입:

```css
/* ── 스팀펑크 공용 부품 ─────────────────────────────── */
/* 황동 프레임 패널: 가죽 바탕 + 바깥 어두운/안쪽 밝은 이중 선 + 모서리 리벳 4개 */
.sp-panel {
  background:
    radial-gradient(circle at 10px 10px, var(--brass-hi) 0 2px, var(--brass-lo) 2.6px, transparent 4.2px),
    radial-gradient(circle at calc(100% - 10px) 10px, var(--brass-hi) 0 2px, var(--brass-lo) 2.6px, transparent 4.2px),
    radial-gradient(circle at 10px calc(100% - 10px), var(--brass-hi) 0 2px, var(--brass-lo) 2.6px, transparent 4.2px),
    radial-gradient(circle at calc(100% - 10px) calc(100% - 10px), var(--brass-hi) 0 2px, var(--brass-lo) 2.6px, transparent 4.2px),
    var(--noise),
    linear-gradient(160deg, #322419 0%, var(--leather) 55%, #241a12 100%);
  border: 2px solid var(--brass-lo);
  border-radius: 6px;
  box-shadow:
    inset 0 0 0 1px rgba(232, 193, 90, 0.55),
    inset 0 0 24px rgba(0, 0, 0, 0.55),
    0 10px 30px rgba(0, 0, 0, 0.6);
}
/* 황동 버튼: 금속 세로 그라디언트, hover 광택, active 눌림 */
.sp-btn {
  border: 1px solid var(--brass-lo);
  background: linear-gradient(180deg, var(--brass-hi) 0%, var(--brass) 45%, var(--brass-lo) 100%);
  color: var(--ink);
  font-family: var(--font-head);
  font-weight: 700;
  font-size: 1rem;
  padding: 8px 14px;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
  text-shadow: 0 1px 0 rgba(232, 193, 90, 0.5);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 2px 4px rgba(0, 0, 0, 0.5);
}
.sp-btn:hover:not(:disabled) { filter: brightness(1.12); }
.sp-btn:active:not(:disabled) { transform: translateY(1px); box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4); }
.sp-btn:disabled { opacity: 0.35; cursor: default; }
```

- [ ] **Step 2: HTML 에 클래스 부여**

```html
<div id="dialogue" class="sp-panel">
...
<button id="dialogue-send" class="sp-btn">대화</button>
<button id="dialogue-code" class="sp-btn">접선 코드 전달</button>
...
<div id="minigame-card" class="sp-panel">
...
<div id="result-card" class="sp-panel">
...
<button id="result-restart" class="sp-btn">다시 잠입한다</button>
```

- [ ] **Step 3: 대화창 규칙 정리**

`#dialogue` 는 위치·간격만 남긴다 (배경·테두리는 `.sp-panel` 몫):

```css
#dialogue {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 16px;
  padding: 14px 18px;
  display: none;
}
#dialogue.visible { display: block; }
/* 화자명 — 황동 명판. 음각 느낌의 그림자를 넣는다. */
#dialogue-speaker {
  display: inline-block;
  font-family: var(--font-head);
  font-weight: 600;
  color: var(--ink);
  background: linear-gradient(180deg, var(--brass-hi), var(--brass) 60%, var(--brass-lo));
  border: 1px solid var(--brass-lo);
  border-radius: 3px;
  padding: 2px 12px;
  margin-bottom: 8px;
  letter-spacing: 0.08em;
  text-shadow: 0 1px 0 rgba(232, 193, 90, 0.5);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.45);
}
```

`#dialogue-input input` 을 교체 (잉크병 느낌 + 포커스 황동 링):

```css
#dialogue-input input {
  flex: 1;
  background: rgba(15, 13, 10, 0.9);
  border: 1px solid var(--brass-lo);
  color: var(--paper);
  padding: 8px 10px;
  border-radius: 3px;
  font-family: var(--font-body);
  font-size: 1rem;
}
#dialogue-input input:focus {
  outline: none;
  border-color: var(--brass);
  box-shadow: 0 0 6px rgba(201, 162, 39, 0.35);
}
#dialogue-input input:disabled { opacity: 0.4; }
```

기존 `#dialogue-input button {…}` 공통 규칙과 `#dialogue-code {…}` 규칙은 삭제한다(`.sp-btn` 이 대체). `#dialogue-input button:disabled` 규칙도 삭제. **대화(E)와 코드 전달(F)의 무게 구분은 유지한다** — 대화 버튼만 청동 녹청으로 덮어쓴다:

```css
/* 자유 대화는 청동(녹청), 코드 전달은 황동 — 오답의 무게가 색으로 갈린다. */
#dialogue-send {
  background: linear-gradient(180deg, #7fae9c 0%, var(--patina) 45%, #3f5f55 100%);
  border-color: #3f5f55;
  color: var(--ink);
}
```

- [ ] **Step 4: 확인**

dev 서버에서 `?nointro` 로 스테이지 진입 → 시작 쪽지(접선 지령)가 가죽 패널 + 모서리 리벳 + 황동 명판으로 뜬다. NPC 근처 [E] 로 입력창을 열어 버튼 두 개(녹청/황동)와 입력 포커스 링 확인.

- [ ] **Step 5: Commit**

```bash
git add src/client/index.html
git commit -m "feat: 황동 프레임·버튼 공용 부품 + 대화창 스팀펑크 — UI 테마 2/5"
```

---

### Task 3: 미니게임 패널 + 결과 화면

**Files:**
- Modify: `src/client/index.html` (CSS 만 — 클래스는 Task 2 에서 부여 완료)

**Interfaces:**
- Consumes: Task 1 토큰, Task 2 의 `.sp-panel`/`.sp-btn`.

- [ ] **Step 1: 미니게임 카드·게이지·판정색**

`#minigame-card` 는 배경·테두리 선언을 지우고 크기·정렬만 남긴다:

```css
#minigame-card {
  padding: 22px 28px;
  min-width: 400px;
  max-width: 90%;
  text-align: center;
}
```

`#minigame-title` 에 머리 폰트를 준다:

```css
#minigame-title {
  font-family: var(--font-head);
  color: var(--brass);
  font-weight: 700;
  letter-spacing: 0.06em;
}
```

타이머를 눈금 있는 계기 띠로 교체:

```css
/* 제한 시간 — 눈금 새긴 황동 게이지. width 를 JS 가 매 프레임 갱신한다. */
#minigame-timer {
  margin-top: 14px;
  height: 8px;
  background: #0f0d0a;
  border: 1px solid var(--brass-lo);
  border-radius: 2px;
  overflow: hidden;
  display: none;
}
#minigame-timer.visible { display: block; }
#minigame-timer-fill {
  height: 100%;
  width: 100%;
  background:
    repeating-linear-gradient(90deg, transparent 0 14px, rgba(26, 23, 18, 0.45) 14px 16px),
    linear-gradient(180deg, var(--brass-hi), var(--brass-lo));
}
```

판정·부품 색을 토큰으로 교체 (기존 값 → 새 값):

```css
#minigame-verdict.ok { color: var(--patina); }
#minigame-verdict.fail { color: var(--wax); }
.mg-btn { /* 기존 규칙에서 border 색만 교체 */ border: 1px solid var(--brass-lo); }
.mg-btn.bad { border-color: var(--wax); color: var(--wax); }
.mg-zone { position: absolute; top: 0; bottom: 0; background: rgba(94, 139, 126, 0.32); }
.mg-track { /* 기존 규칙에서 border 색만 교체 */ border: 1px solid var(--brass-lo); }
.mg-free input { /* 기존 규칙에서 border 색만 교체 */ border: 1px solid var(--brass-lo); }
.mg-free .mg-btn {
  background: linear-gradient(180deg, var(--brass-hi) 0%, var(--brass) 45%, var(--brass-lo) 100%);
  color: var(--ink);
  border-color: var(--brass-lo);
  font-weight: 700;
  font-family: var(--font-head);
}
```

(`.mg-btn:hover`/`.sel` 의 `--brass` 참조는 그대로 두면 된다.)

- [ ] **Step 2: 결과 화면**

`#result-card` 는 `.sp-panel` 이 배경·테두리를 대므로 크기·정렬만 남기고, 제목을 공문서 머리글로:

```css
#result-card {
  padding: 28px 36px;
  text-align: center;
  min-width: 340px;
  max-width: 80%;
}
#result-title {
  font-family: var(--font-head);
  color: var(--brass);
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(201, 162, 39, 0.4);
}
```

`#result-restart` 의 기존 규칙은 삭제하고 여백만 남긴다 (`.sp-btn` 이 대체):

```css
#result-restart { margin-top: 22px; padding: 10px 26px; font-size: 1rem; }
#result-restart:disabled { opacity: 0.35; cursor: default; }
```

- [ ] **Step 3: 확인**

dev 서버에서 감옥 창살 앞 [R](자물쇠)과 순찰에 접근(검문 타이밍)으로 미니게임 패널을 띄워 게이지 눈금·황동 프레임 확인. 판을 끝내(검거되면 빠르다) 결과 화면의 공문서 제목·황동 버튼 확인.

- [ ] **Step 4: Commit**

```bash
git add src/client/index.html
git commit -m "feat: 미니게임·결과 화면 스팀펑크 — UI 테마 3/5"
```

---

### Task 4: `ui/theme.js` 신규 + BootScene 폰트 대기 + Intro/Boot 씬 적용

**Files:**
- Create: `src/client/ui/theme.js`
- Modify: `src/client/scenes/BootScene.js`, `src/client/scenes/IntroScene.js`

**Interfaces:**
- Produces (Task 5 가 소비):
  - `COLORS`: `{ brassHi, brass, brassLo, leather, ink, paper, paperDim, patina, wax }` — `0x…` 숫자 (Phaser fill/stroke 용)
  - `CSS`: `{ brassHi, brass, brassLo, paper, paperDim, patina, wax, faint }` — `'#…'` 문자열 (텍스트 color 용)
  - `FONTS`: `{ head, body }` — fontFamily 문자열 (폴백 스택 포함)
  - `waitForFonts(timeoutMs = 2000): Promise<void>`
  - `drawOrnateFrame(scene, cx, cy, w, h): Phaser.GameObjects.Graphics`

- [ ] **Step 1: `src/client/ui/theme.js` 작성**

```js
/**
 * 캔버스 UI 테마 토큰 — index.html 의 :root CSS 변수와 짝이다 (색을 바꾸면 두 곳 함께).
 *
 * 인라인 CSS 와 모듈 사이에 빌드 파이프라인 없이 단일 출처를 만들 수 없어 의도적으로
 * 중복해 둔다. DOM 오버레이와 Phaser 캔버스가 같은 팔레트·폰트를 쓰기 위한 참조점.
 */
export const COLORS = {
  brassHi: 0xe8c15a,
  brass: 0xc9a227,
  brassLo: 0x7a5f1a,
  leather: 0x2c2018,
  ink: 0x1a1712,
  paper: 0xe8dcc0,
  paperDim: 0x8a7f6a,
  patina: 0x5e8b7e,
  wax: 0xa03325,
};

/** Phaser 텍스트 스타일의 color 는 CSS 문자열을 받는다 — COLORS 와 같은 값. */
export const CSS = {
  brassHi: '#e8c15a',
  brass: '#c9a227',
  brassLo: '#7a5f1a',
  paper: '#e8dcc0',
  paperDim: '#8a7f6a',
  patina: '#5e8b7e',
  wax: '#a03325',
  faint: '#6b6152',
};

export const FONTS = {
  head: "'Hahmlet', 'Malgun Gothic', serif",
  body: "'Gowun Batang', 'Malgun Gothic', serif",
};

/**
 * 웹폰트 로드 대기. Phaser 텍스트는 생성 시점의 폰트로 래스터되므로, 로드 전에
 * 그리면 폴백 고딕으로 굳는다. CDN 이 막힌 환경에서 게임이 잠기지 않도록
 * 타임아웃이 지나면 폴백 폰트인 채로 그냥 진행한다.
 */
export function waitForFonts(timeoutMs = 2000) {
  if (!document.fonts?.load) return Promise.resolve();
  const wanted = Promise.all([
    document.fonts.load('700 32px Hahmlet'),
    document.fonts.load("400 24px 'Gowun Batang'"),
    document.fonts.load("700 24px 'Gowun Batang'"),
  ]);
  const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  return Promise.race([wanted, timeout]).catch(() => {});
}

/**
 * 황동 이중 프레임 패널 — DOM 쪽 .sp-panel 의 캔버스 판.
 * 가죽 바탕 + 바깥 어두운 선 + 안쪽 밝은 선 + 모서리 리벳 4개.
 * 컨테이너에 넣거나 asUi 등록은 호출자 몫이다.
 */
export function drawOrnateFrame(scene, cx, cy, w, h) {
  const g = scene.add.graphics();
  const x = cx - w / 2;
  const y = cy - h / 2;
  g.fillStyle(COLORS.leather, 0.97).fillRect(x, y, w, h);
  g.lineStyle(3, COLORS.brassLo, 1).strokeRect(x, y, w, h);
  g.lineStyle(1, COLORS.brassHi, 0.9).strokeRect(x + 5, y + 5, w - 10, h - 10);
  g.fillStyle(COLORS.brassHi, 1);
  for (const [rx, ry] of [
    [x + 10, y + 10],
    [x + w - 10, y + 10],
    [x + 10, y + h - 10],
    [x + w - 10, y + h - 10],
  ]) {
    g.fillCircle(rx, ry, 3);
  }
  return g;
}
```

- [ ] **Step 2: BootScene — 폰트 대기 후 진행**

`create()` 의 분기부를 교체한다 (`import { waitForFonts, FONTS, CSS } from '../ui/theme.js';` 추가):

```js
// 웹폰트가 준비되기 전에 씬 텍스트를 그리면 폴백 고딕으로 래스터돼 굳는다.
// 2초 안에 안 오면 그대로 진행 — CDN 이 막혀도 게임은 열려야 한다.
waitForFonts(2000).then(() => {
  if (noIntro) this.#legacyBoot(startPromise);
  else this.scene.start('Intro');
});
```

같은 파일의 `fontFamily: 'Malgun Gothic, sans-serif'` 3곳을 `fontFamily: FONTS.body` 로, `#showError` 의 `color: '#c25b4a'` 를 `color: CSS.wax` 로 교체.

- [ ] **Step 3: IntroScene — 상수를 토큰으로**

`import { CSS, FONTS } from '../ui/theme.js';` 추가 후 상단 상수를 토큰 참조로 바꾼다 (이름은 유지 — 본문 수정 최소화):

```js
const BRASS = CSS.brass;
const PAPER = CSS.paper;
const FAINT = CSS.paperDim;
```

파일 전체에서 기계적 치환 2건:
- `fontFamily: 'Malgun Gothic, sans-serif'` → `fontFamily: FONTS.body` (7곳)
- `fontFamily: 'Georgia, "Malgun Gothic", serif'` → `fontFamily: FONTS.head` (2곳 — 타이틀·서브타이틀)

- [ ] **Step 4: 확인**

dev 서버를 인트로 포함(쿼리 없이)으로 열어: 오프닝 자막이 명조로, 'HEART OF STEEL' 타이틀이 Hahmlet 으로 뜬다. `?nointro` 로도 열어 로딩 문구가 명조인지 확인. 개발자 도구에서 네트워크를 오프라인으로 놓고 새로고침 — 2초 뒤 폴백 폰트로 정상 진행하는지 확인.

- [ ] **Step 5: Commit**

```bash
git add src/client/ui/theme.js src/client/scenes/BootScene.js src/client/scenes/IntroScene.js
git commit -m "feat: 캔버스 테마 토큰(theme.js) + 웹폰트 로드 대기 — UI 테마 4/5"
```

---

### Task 5: StageScene·TutorialScene 적용 + 단서 수첩 황동 프레임

**Files:**
- Modify: `src/client/scenes/StageScene.js`, `src/client/scenes/TutorialScene.js`

**Interfaces:**
- Consumes: Task 4 의 `CSS`·`FONTS`·`drawOrnateFrame`.

- [ ] **Step 1: StageScene 기계적 치환**

`import { CSS, FONTS, drawOrnateFrame } from '../ui/theme.js';` 추가 후:
- `fontFamily: 'Malgun Gothic, sans-serif'` → `fontFamily: FONTS.body` (전부 — 단, 다음 단계의 수첩 제목만 head)
- 색 문자열을 토큰으로: `'#8a7f6a'` → `CSS.paperDim`, `'#6b6152'` → `CSS.faint`, `'#c9a227'` → `CSS.brass`, `'#e8dcc0'` → `CSS.paper` (텍스트 스타일 안의 값만 — 타일/월드 색은 건드리지 않는다)

- [ ] **Step 2: 단서 수첩 프레임 교체**

`#buildCluePanel` 의 `bg` 를 rectangle 에서 프레임으로 바꾸고 제목에 머리 폰트를 준다:

```js
#buildCluePanel() {
  const w = 760, h = 560;
  const cx = this.scale.width / 2, cy = this.scale.height / 2;
  const bg = drawOrnateFrame(this, cx, cy, w, h);
  const title = this.add
    .text(cx, cy - h / 2 + 40, '단서 수첩', {
      fontFamily: FONTS.head, fontSize: '30px', color: CSS.brass, fontStyle: 'bold',
    })
    .setOrigin(0.5);
  const rule = this.add.rectangle(cx, cy - h / 2 + 76, w - 72, 2, 0x3a3120);
  this.clueText = this.add.text(cx - w / 2 + 44, cy - h / 2 + 108, '', {
    fontFamily: FONTS.body, fontSize: '24px', color: CSS.paper,
    lineSpacing: 14, wordWrap: { width: w - 88 },
  });
  const hint = this.add
    .text(cx, cy + h / 2 - 32, '[C] 닫기', {
      fontFamily: FONTS.body, fontSize: '20px', color: CSS.paperDim,
    })
    .setOrigin(0.5);
  this.cluePanel = this.add.container(0, 0, [bg, title, rule, this.clueText, hint]).setDepth(1000).setVisible(false);
  this.asUi(this.cluePanel);
}
```

- [ ] **Step 3: TutorialScene 치환**

`import { CSS, FONTS } from '../ui/theme.js';` 추가 후 StageScene 과 같은 치환: `fontFamily: 'Malgun Gothic, sans-serif'` → `FONTS.body` (`LABEL_STYLE` 포함 4곳), `'#8a7f6a'` → `CSS.paperDim`, `'#6b6152'` → `CSS.faint`.

- [ ] **Step 4: 잔여 하드코딩 색 스캔**

```bash
grep -rn "Malgun Gothic" src/client/scenes src/client/ui
grep -rn "#c25b4a\|#6fae8e" src/client
```

기대: 첫 grep 은 `theme.js` 의 폴백 스택만, 둘째 grep 은 0건. 남아 있으면 토큰으로 교체.

- [ ] **Step 5: 확인**

dev 서버 `?nointro`: HUD·조작 안내가 명조로, [C] 단서 수첩이 황동 프레임(리벳 4개)으로 뜬다. 튜토리얼 경로(쿼리 없이 인트로 뒤)도 라벨 폰트 확인.

- [ ] **Step 6: Commit**

```bash
git add src/client/scenes/StageScene.js src/client/scenes/TutorialScene.js
git commit -m "feat: 스테이지·튜토리얼 씬 테마 적용 + 수첩 황동 프레임 — UI 테마 5/5"
```

---

### Task 6: 통합 검증

**Files:** 수정 없음 (문제 발견 시 해당 파일 fix 커밋)

- [ ] **Step 1: 스모크 회귀**

```bash
npm run smoke
```

기대: 기존과 동일하게 통과 (UI 만 변경했으므로 서버 계약 불변).

- [ ] **Step 2: 상태별 화면 확인**

dev 서버로 순회하며 스크린샷: ① 인트로 타이틀 컷 ② 튜토리얼(본부 라벨) ③ 시작 쪽지(접선 지령) ④ 대화창 입력 모드(버튼 2색) ⑤ 단서 수첩 ⑥ 자물쇠 미니게임(게이지) ⑦ 검문 패널 ⑧ 결과 화면. 각 컷에서 폰트(명조/Hahmlet)·황동 프레임·판정색(녹청/봉랍)이 적용됐는지 본다.

- [ ] **Step 3: 발견된 문제 수정 후 커밋**

문제가 있으면 해당 태스크 파일을 고치고:

```bash
git add <해당 파일>
git commit -m "fix: 스팀펑크 테마 마무리 — <내용>"
```
