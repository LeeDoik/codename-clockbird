# 스테이지 개선 구현 계획 (상호작용 연출 · 대화 v2 · S1/S2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문으로 진행을 추적한다.

**Goal:** 기획자 피드백(스펙 `docs/superpowers/specs/2026-07-29-stage-improvements-design.md`)을 구현한다 — 말풍선 상호작용, 2줄 페이징 대화창 + 우측 선택지, S1 dialogtest 프롬프트 이식·아무 동료 정답 제출, S2 성향 판정 강화·조사 오브젝트.

**Architecture:** 공통 인터랙션 레이어(`src/client/world/interact.js`)가 근접 감지·말풍선·E 분기를 소유하고, 세 씬은 노드 등록만 한다. DialogueBox 는 2줄 페이징 + 스트림 버퍼링 + 우측 선택지로 개편한다. 서버는 조사 오브젝트 세션 플래그와 stance 판정의 단서 대조(usedClueId)를 추가한다.

**Tech Stack:** Phaser 4 (클라이언트, Vite), Express (서버), Anthropic SDK (Haiku 4.5 대화 / Sonnet 5 판정), zod structured output. 테스트 프레임워크 없음 — 검증은 `scripts/smoke-*.js` + `npm run exp:diff` + 브라우저 수동 확인이 이 저장소의 관례다. 각 태스크는 "구현 → 검증(정확한 명령/브라우저 절차) → 커밋" 사이클을 지킨다.

## Global Constraints

- **기능 동결 8/7.** 우선순위 P0(Task 1~7) → P1(Task 8~12) → P2(Task 13~14) → P3(Task 15). 밀리면 스펙 §8 컷 순서를 따른다.
- **ESM.** 서버·클라이언트 모두 `import`/`export`. CommonJS 금지.
- **대화 UI 는 DOM 오버레이.** 한글 IME + 스트리밍 때문 (`DialogueBox.js:1-7`). 캔버스 텍스트로 옮기지 마라.
- **비유출 원칙.** 클라이언트로 나가는 상태는 화이트리스트(`toMansionView`, `toClientView`)에만 추가한다. `kind`·`favor`·`suspicion`·`persona`·`npcId`(오브젝트의 연관 인물)·`topic` 은 절대 내보내지 않는다.
- **프롬프트는 코드 밖.** 프로즈는 `src/data/prompts/*.txt` + `promptStore.js` 의 `TEMPLATES` 등록. structured output 스키마는 코드에 남긴다.
- **DOM 치수는 `calc(N * var(--s))`.** 1920 기준 상대 단위 (`index.html:57-62`).
- **접선 코드는 대화 프롬프트에 넣지 않는다.** 모르는 것은 유출될 수 없다 (`dialogue.js:7-24`).
- **확정 결정(스펙 §1):** 전 대사 2줄 페이징(LLM 은 버퍼링 후 분할) / S1 은 dialogtest 프롬프트 이식 / 구제책 미도입 / 아무 동료에게나 정답 제출 / [F] 키는 "암호 말하기". **단어 접선은 [E] 첫 대화에 통합된다** — 동료와 처음 대화를 열면 자동으로 접선되어 단어가 공개·수첩 기록되고, 이후 자유 입력이 열린다 (스펙 §2 choiceNpc 선택지 구성 "대화하기[E]/암호 말하기[F]/그만하기[Esc]"와 §4.2 를 함께 만족시키는 유일한 키 배치다).
- **커밋 메시지:** 한국어 `feat:`/`fix:`/`docs:` + 마지막 줄 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **검증 환경:** `npm run dev` (서버 3000 + Vite 5173, `.env` 에 `ANTHROPIC_API_KEY` 필요). 개발 플래그: `?nointro`(오프닝·튜토리얼 건너뜀) `?nopatrol` `?stage2`(저택 직행) `?stage2&key`.

---

## 파일 구조 (전체 조감)

| 파일 | 작업 |
|---|---|
| `src/client/ui/DialogueBox.js` | **개편** — 페이징·버퍼링·선택지 (Task 1·2) |
| `src/client/index.html` | **수정** — 2줄 CSS, `#dialogue-choices`, `#docpanel` (Task 1·2·7) |
| `src/client/world/interact.js` | **신설** — InteractionManager + 말풍선 (Task 3) |
| `src/client/ui/DocumentPanel.js` | **신설** — 문서 열람 패널 (Task 7) |
| `src/client/scenes/TutorialScene.js` | **수정** — 레이어 마이그레이션 (Task 4) |
| `src/client/scenes/StageScene.js` | **수정** — 마이그레이션 + 접선 통합 + 제출 완화 (Task 5·14) |
| `src/client/scenes/MansionScene.js` | **수정** — 마이그레이션 + 문/문서/오브젝트 (Task 6·7·12) |
| `src/data/prompts/mansion-stance.txt` | **신설** (Task 8) |
| `src/data/prompts/mansion-ally.txt`, `mansion-civ.txt` | **신설** — kindBlock 추출 (Task 9) |
| `src/data/prompts/mansion-dialogue.txt` | **수정** — backstory/personality (Task 10) |
| `src/data/mansion.json` | **수정** — persona 분리 + `objects` (Task 10·11) |
| `src/server/ai/stance.js` | **수정** — 템플릿화 + usedClueId (Task 8·11) |
| `src/server/ai/dialogue.js` | **수정** — kindBlock 템플릿, clueBlock, backstory 변수 (Task 9·10·11·13) |
| `src/server/mansionSession.js` | **수정** — objects 플래그, usedClues, view (Task 11) |
| `src/server/routes/mansion.js` | **수정** — `/inspect`, talk 에 단서 전달 (Task 11) |
| `src/server/ai/promptStore.js` | **수정** — TEMPLATES 추가 (Task 8·9) |
| `src/server/routes/studio.js`, `studio.html` | **수정** — 미리보기 변수 (Task 8·10·13) |
| `src/data/personas.json` | **수정** — backstory/personality (Task 13) |
| `src/data/prompts/wordgen-system.txt`, `dialogue-system.txt` | **교체** (Task 13) |
| `src/server/routes/stage.js` | **수정** — guess targetId (Task 14) |
| `src/client/assets/map.json` | **수정** — 동료 스폰 (Task 15) |
| `scripts/check-spawn-safety.js` | **신설** — 은신 검증 (Task 15) |
| `scripts/smoke-mansion.js` | **수정** — inspect·usedClue 검증 (Task 11) |

---

### Task 1: DialogueBox v2 — 2줄 페이징 + 스트림 버퍼링

**Files:**
- Modify: `src/client/index.html` (CSS `#dialogue-text` 및 페이징 표식)
- Modify: `src/client/ui/DialogueBox.js`

**Interfaces (Produces — 이후 모든 태스크가 의존):**
- `show(speaker, text, opts)` — 텍스트를 2줄 페이지로 분할해 첫 페이지 표시. `opts.portrait` 유지.
- `reply(speaker, text, hint, opts)` — dismissed 존중, 페이징 적용. 기존 시그니처 유지.
- `advance()` → `boolean` — 다음 페이지로. 마지막 페이지에서 호출되면 `onPagesDone` 이 있으면 그걸 부르고(창 유지), 없으면 `hide()`. 반환값: 창이 계속 열려 있으면 `true`.
- `hasMore` (getter) — 남은 페이지 존재 여부.
- `onPagesDone: (() => void) | null` — 마지막 페이지 넘김 시 콜백 (선택지 복귀용, Task 3 이 사용).
- `beginStream(speaker, opts)` — 본문에 "…"(thinking 클래스, CSS 펄스) 표시, 버퍼 초기화.
- `append(chunk)` — **DOM 이 아니라 버퍼에만** 누적.
- `endStream(hint = '')` → `string` — 버퍼 전체를 페이징해 첫 페이지 표시. dismissed 면 표시하지 않는다. 버퍼 원문 반환.

- [ ] **Step 1: CSS — 2줄 고정 + 표식**

`index.html` 의 `#dialogue-text` 블록(현재 225-231행)을 다음으로 교체하고, 이어서 신규 규칙을 추가한다:

```css
      #dialogue-text {
        font-size: calc(30 * var(--s));
        line-height: 1.68;
        /* 2줄 고정 — 페이징의 기준 높이. 3줄째는 잘리는 게 아니라 애초에 안 들어온다. */
        height: calc(30 * 1.68 * 2 * var(--s));
        overflow: hidden;
        white-space: pre-wrap;
        text-shadow: 0 calc(2 * var(--s)) calc(4 * var(--s)) rgba(0, 0, 0, 0.85);
      }
      /* 다음 페이지 표식 — 본문 우하단에서 깜빡인다 */
      #dialogue-more {
        position: absolute;
        right: calc(30 * var(--s));
        bottom: calc(76 * var(--s));
        font-size: calc(24 * var(--s));
        color: var(--brass);
        display: none;
        animation: dlg-blink 1.1s ease-in-out infinite;
      }
      #dialogue-more.visible { display: block; }
      @keyframes dlg-blink { 0%, 100% { opacity: 0.25; } 50% { opacity: 0.95; } }
      /* LLM 응답 대기 — 생각 중 연출 */
      #dialogue-text.thinking { opacity: 0.55; animation: dlg-think 1.4s ease-in-out infinite; }
      @keyframes dlg-think { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
      /* 페이지 분할 측정용 — 화면 밖, 같은 서체·같은 폭 */
      #dialogue-measure {
        position: absolute;
        visibility: hidden;
        pointer-events: none;
        font-size: calc(30 * var(--s));
        line-height: 1.68;
        white-space: pre-wrap;
      }
```

`#dialogue` DOM(446-459행)의 `<div id="dialogue-text"></div>` 다음 줄에 추가:

```html
        <div id="dialogue-more">▼</div>
        <div id="dialogue-measure"></div>
```

- [ ] **Step 2: DialogueBox.js — 페이징 엔진**

`constructor` 의 DOM 참조부(24-33행)에 추가:

```js
    this.moreEl = document.getElementById('dialogue-more');
    this.measureEl = document.getElementById('dialogue-measure');
```

상태 필드(47행 `this.dismissed = false;` 아래)에 추가:

```js
    /** 페이징 상태 — 현재 대사의 페이지 배열과 커서 */
    this.pages = [];
    this.pageIdx = 0;
    /** 마지막 페이지를 넘겼을 때 부를 콜백 (없으면 hide) — 선택지 복귀용 */
    this.onPagesDone = null;
    /** 스트리밍 버퍼 — append 는 여기에만 쌓고 endStream 이 페이징한다 */
    this.streamBuf = '';
```

`#reset()`(79-91행)에 같은 초기화를 추가:

```js
    this.pages = [];
    this.pageIdx = 0;
    this.onPagesDone = null;
    this.streamBuf = '';
    this.textEl.classList.remove('thinking');
    this.moreEl.classList.remove('visible');
```

클래스에 페이징 메서드 3개를 추가한다 (`preload` 위 아무 곳):

```js
  /**
   * 텍스트를 "2줄에 들어가는 조각" 배열로 자른다.
   *
   * 문단(\n\n)을 먼저 가르고, 넘치는 문단은 실측으로 자른다 — 글꼴·창 크기가
   * 반응형(--s)이라 글자 수 추정은 어긋난다. 측정 요소는 본문과 같은 서체·폭을 쓴다.
   */
  #paginate(text) {
    const meas = this.measureEl;
    meas.style.width = `${this.textEl.clientWidth}px`;
    const lineH = parseFloat(getComputedStyle(this.textEl).lineHeight);
    const maxH = lineH * 2 + 2; // 서브픽셀 오차 여유

    const fits = (s) => {
      meas.textContent = s;
      return meas.offsetHeight <= maxH;
    };

    const pages = [];
    for (const para of text.split(/\n{2,}/)) {
      let rest = para.trim();
      while (rest) {
        if (fits(rest)) {
          pages.push(rest);
          break;
        }
        // 2줄에 들어가는 가장 긴 접두사를 이분 탐색으로 찾는다
        let lo = 1;
        let hi = rest.length;
        let fit = 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (fits(rest.slice(0, mid))) {
            fit = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        // 낱말 중간에서 끊지 않는다 — 마지막 공백·줄바꿈까지 물러난다
        const head = rest.slice(0, fit);
        const brk = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\n'));
        const cut = brk > fit * 0.4 ? brk : fit;
        pages.push(rest.slice(0, cut).trimEnd());
        rest = rest.slice(cut).trimStart();
      }
    }
    return pages.length ? pages : [''];
  }

  /** 현재 페이지를 본문에 싣고 ▼ 표식을 갱신한다 */
  #renderPage() {
    this.textEl.classList.remove('thinking');
    this.textEl.textContent = this.pages[this.pageIdx] ?? '';
    this.moreEl.classList.toggle('visible', this.hasMore);
  }

  get hasMore() {
    return this.pageIdx < this.pages.length - 1;
  }

  /**
   * 다음 페이지로 넘긴다. 마지막 페이지였다면 onPagesDone(선택지 복귀)을 부르거나 닫는다.
   * @returns {boolean} 창이 계속 열려 있는가
   */
  advance() {
    if (this.hasMore) {
      this.pageIdx += 1;
      this.#renderPage();
      return true;
    }
    if (this.onPagesDone) {
      const done = this.onPagesDone;
      this.onPagesDone = null;
      done();
      return this.isOpen;
    }
    this.hide();
    return false;
  }
```

- [ ] **Step 3: show / reply / 스트리밍 경로 교체**

`show()`(155-161행)를 다음으로 교체:

```js
  show(speaker, text, opts = {}) {
    this.dismissed = false;
    this.#setPortrait(opts.portrait);
    this.speakerEl.textContent = speaker;
    this.root.classList.add('visible'); // clientWidth 측정 전에 보여야 폭이 잡힌다
    this.onPagesDone = opts.onPagesDone ?? null;
    this.pages = this.#paginate(text);
    this.pageIdx = 0;
    this.#renderPage();
  }
```

`reply()` 는 그대로 둔다 (내부적으로 show 를 부르므로 자동 페이징). 단 시그니처에 `opts.onPagesDone` 이 전달되도록 `this.show(speaker, text, opts)` 호출은 이미 맞다.

`beginStream()`(179-185행)·`append()`(188-190행)를 교체하고 `endStream()` 을 신설:

```js
  /** 스트리밍 시작 — 화자를 세우고 "생각 중" 연출을 띄운다. 본문은 버퍼에 쌓인다. */
  beginStream(speaker, opts = {}) {
    this.dismissed = false;
    this.#setPortrait(opts.portrait);
    this.speakerEl.textContent = speaker;
    this.streamBuf = '';
    this.pages = [];
    this.pageIdx = 0;
    this.moreEl.classList.remove('visible');
    this.textEl.textContent = '…';
    this.textEl.classList.add('thinking');
    this.root.classList.add('visible');
  }

  /** 스트리밍 델타 — 화면이 아니라 버퍼에 쌓는다 (2줄 페이징은 완문 기준). */
  append(chunk) {
    this.streamBuf += chunk;
  }

  /**
   * 스트리밍 종료 — 버퍼 전체를 페이징해 첫 페이지를 띄운다.
   * 기다리는 사이 플레이어가 닫았다면(dismissed) 띄우지 않는다 (reply 와 같은 규약).
   * @returns {string} 버퍼 원문
   */
  endStream(hint = '', opts = {}) {
    const full = this.streamBuf;
    this.streamBuf = '';
    this.textEl.classList.remove('thinking');
    if (this.dismissed) return full;
    this.onPagesDone = opts.onPagesDone ?? null;
    this.pages = this.#paginate(full);
    this.pageIdx = 0;
    this.#renderPage();
    this.setHint(hint);
    return full;
  }
```

`hide()`(215-220행)에 표식 정리를 추가:

```js
  hide() {
    if (this.busy) this.dismissed = true;
    this.root.classList.remove('visible');
    this.moreEl.classList.remove('visible');
    this.textEl.classList.remove('thinking');
    this.onPagesDone = null;
    this.hideInput();
  }
```

- [ ] **Step 4: 씬 호출부 임시 배선 (컴파일 유지)**

세 씬의 `#chat()` 은 아직 `endStream` 을 부르지 않는다 — 이 태스크에서는 **스트림이 끝난 뒤 본문이 화면에 남도록** 각 씬의 readSSE 완료 지점에 한 줄만 넣는다 (마이그레이션 전 임시 배선; Task 4~6 이 정식 배선으로 대체):

- `TutorialScene.js` `#chat()` — `await readSSE(...)` 다음 줄에 `this.dialogue.endStream('[Space] 다음 · [Esc] 닫기');`
- `StageScene.js` `#chat()` — 동일 위치에 동일 코드.
- `MansionScene.js` `#chat()` — `if (pending) this.#applyEvent(pending);` 를 아래로 교체 (이벤트 문구를 버퍼에 이어붙인 뒤 한꺼번에 페이징):

```js
    if (pending) this.#applyEvent(pending);
    this.dialogue.endStream('[Space] 다음 · [Esc] 닫기');
```

그리고 `MansionScene.#applyEvent` 내부의 `this.dialogue.append(...)` 호출들은 그대로 둔다 — append 가 버퍼 누적으로 바뀌었으므로 endStream 한 번에 함께 페이징된다. 단 `reported` 분기의 `this.#endGame('reported')`는 endStream 뒤에 불려야 화면이 남는다. `#applyEvent` 의 `reported` 분기에서 `this.#endGame('reported');` 를 삭제하고, `#chat()` 끝을 다음으로 바꾼다:

```js
    if (pending) this.#applyEvent(pending);
    this.dialogue.endStream('[Space] 다음 · [Esc] 닫기');
    if (pending?.event === 'reported') this.#endGame('reported');
```

또한 세 씬의 Space 처리(`this.dialogue.hide()`)를 `this.dialogue.advance()` 로 바꾼다:
- `TutorialScene.js:200` → `if (!typing && pressedSpace) this.dialogue.advance();`
- `StageScene.js:527-529` → `if (!typing && pressedSpace) { this.dialogue.advance(); }`
- `MansionScene.js:396-399` → Space 분기의 `this.dialogue.hide(); this.proximityHint = false;` 를 `this.dialogue.advance();` 로 (proximityHint 는 Task 6 에서 제거된다 — 여기서는 `if (!this.dialogue.isOpen) this.proximityHint = false;` 를 이어 붙여 기존 자동 닫힘 로직과 충돌하지 않게 한다). Esc 분기는 그대로 `hide()` (즉시 종료).

- [ ] **Step 5: 검증 — 브라우저**

Run: `npm run dev` 후 `http://localhost:5173/?nointro&nopatrol`

확인 (모두 통과해야 함):
1. 진입 쪽지(접선 지령, 12줄 분량)가 **2줄씩** 뜨고 우하단 `▼` 이 깜빡인다. [Space] 로 끝까지 넘기면 창이 닫힌다.
2. 동료 앞 [E] → 자유 입력 → 전송하면 본문에 `…` 펄스가 뜨고, 응답 완료 후 2줄 페이지로 표시된다. 스트리밍 글자가 실시간으로 찍히지 **않는다**.
3. 응답 대기 중 [Esc] 로 닫으면 응답이 도착해도 창이 다시 열리지 않는다 (dismissed 회귀 확인).
4. 창 크기를 절반으로 줄여도 2줄 유지 (페이지 분할이 실측 기반인지 확인).

- [ ] **Step 6: Commit**

```bash
git add src/client/index.html src/client/ui/DialogueBox.js src/client/scenes/TutorialScene.js src/client/scenes/StageScene.js src/client/scenes/MansionScene.js
git commit -m "feat: 대화창 2줄 페이징 + LLM 버퍼링 표시 (대화 연출 v2 1/2)"
```

---

### Task 2: DialogueBox v2 — 우측 선택지 버튼

**Files:**
- Modify: `src/client/index.html`
- Modify: `src/client/ui/DialogueBox.js`

**Interfaces:**
- Consumes: Task 1 의 페이징 상태.
- Produces: `showChoices(choices)` — `choices: Array<{label: string, key: string}>` (최대 3개). 우측 세로 버튼 스택 표시. 클릭 시 `onChoice(key)` 호출. `hideChoices()`, `onChoice: ((key: string) => void) | null`. `key` 는 `'E' | 'F' | 'Esc'` 같은 표시용 문자열이자 콜백 식별자다 — **키 입력 자체는 씬/레이어가 처리**하고, 버튼 클릭만 DialogueBox 가 중계한다.

- [ ] **Step 1: DOM + CSS**

`index.html` 의 `#dialogue` 내부, `#dialogue-actions` 위에 추가:

```html
        <div id="dialogue-choices"></div>
```

CSS (`#dialogue-actions` 규칙 아래에 추가):

```css
      /* 선택지 — 대화 상자 본문 밖, 우측 세로 스택 (스펙 §3) */
      #dialogue.has-choices { padding-right: calc(340 * var(--s)); }
      #dialogue-choices {
        position: absolute;
        right: calc(24 * var(--s));
        bottom: calc(24 * var(--s));
        width: calc(290 * var(--s));
        display: none;
        flex-direction: column;
        gap: calc(12 * var(--s));
      }
      #dialogue.has-choices #dialogue-choices { display: flex; }
      .dlg-choice {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: calc(8 * var(--s));
        font-family: var(--font-head);
        font-weight: 700;
        font-size: calc(23 * var(--s));
        padding: calc(10 * var(--s)) calc(18 * var(--s));
        border-radius: calc(3 * var(--s));
        cursor: pointer;
        border: 1px solid var(--brass-lo);
        background: linear-gradient(180deg, var(--brass-hi) 0%, var(--brass) 45%, var(--brass-lo) 100%);
        color: var(--ink);
        text-shadow: 0 1px 0 rgba(255, 240, 200, 0.45);
      }
      .dlg-choice .key { font-family: var(--font-body); font-weight: 400; font-size: calc(17 * var(--s)); opacity: 0.6; }
      .dlg-choice:hover { filter: brightness(1.14); }
      .dlg-choice:active { transform: translateY(1px); }
```

- [ ] **Step 2: DialogueBox 메서드**

`constructor` DOM 참조에 `this.choicesEl = document.getElementById('dialogue-choices');`, 상태에 `this.onChoice = null;` 추가. `#reset()` 에 `this.onChoice = null; this.hideChoices();` 추가.

클래스에 추가:

```js
  /**
   * 우측 선택지 버튼 (최대 3개). 키 라벨은 표시용이다 — 실제 키 입력은 씬이 처리하고,
   * 여기서는 클릭만 onChoice(key) 로 중계한다. 같은 행동에 대해 키와 클릭이 같은
   * 콜백으로 모이게 하는 것이 규약이다.
   */
  showChoices(choices) {
    this.choicesEl.replaceChildren(
      ...choices.slice(0, 3).map((c) => {
        const btn = document.createElement('button');
        btn.className = 'dlg-choice';
        btn.innerHTML = `<span></span><span class="key"></span>`;
        btn.firstChild.textContent = c.label;
        btn.lastChild.textContent = `[${c.key}]`;
        btn.addEventListener('click', () => this.onChoice?.(c.key));
        return btn;
      }),
    );
    this.root.classList.add('has-choices');
  }

  hideChoices() {
    this.root.classList.remove('has-choices');
    this.choicesEl.replaceChildren();
    this.onChoice = null;
  }
```

`hide()` 에 `this.hideChoices();` 를 추가한다 (`this.hideInput();` 다음 줄).

- [ ] **Step 3: 검증 — 콘솔 스모크**

Run: `npm run dev` 후 브라우저 DevTools 콘솔에서:

```js
const d = document.querySelector('#dialogue');
d.classList.add('visible');
document.getElementById('dialogue-text').textContent = '선택지 표시 확인용 문장.';
// DialogueBox 인스턴스는 씬이 쥐고 있으므로 DOM 만으로 시각 확인:
d.classList.add('has-choices');
document.getElementById('dialogue-choices').innerHTML =
  '<button class="dlg-choice"><span>대화하기</span><span class="key">[E]</span></button>' +
  '<button class="dlg-choice"><span>암호 말하기</span><span class="key">[F]</span></button>' +
  '<button class="dlg-choice"><span>그만하기</span><span class="key">[Esc]</span></button>';
```

Expected: 대화창 우측에 황동 버튼 3개 세로 스택, 본문이 버튼과 겹치지 않음. 확인 후 새로고침.

- [ ] **Step 4: Commit**

```bash
git add src/client/index.html src/client/ui/DialogueBox.js
git commit -m "feat: 대화창 우측 선택지 버튼 (대화 연출 v2 2/2)"
```

---

### Task 3: 인터랙션 레이어 + 말풍선 (`interact.js`)

**Files:**
- Create: `src/client/world/interact.js`

**Interfaces:**
- Consumes: `nearestOf`(worldParts), DialogueBox v2 (`show`·`showChoices`·`onChoice`).
- Produces (Task 4~6·12 가 사용):
  - `new InteractionManager(scene, dialogue)`
  - `register(node) → node` — node 필드:
    - `id: string` (중복 등록 시 교체)
    - `type: 'npc' | 'choiceNpc' | 'door' | 'document' | 'object'`
    - 위치: `sprite`(Phaser 오브젝트, 움직이는 대상) 또는 `{x, y}`(정적)
    - `range?: number` (기본 48)
    - `bubble?: string` — 말풍선 문구 재정의 (기본 `[E] {verb}`, verb 는 유형 기본값: 대화/열기/열람/조사)
    - `speaker?: string`, `line?: string`, `portrait?: string` — npc/choiceNpc 기본 대사
    - `choices?: Array<{label, key}>`, `onChoice?: (key) => void` — choiceNpc
    - `isUnlocked?: () => boolean`, `lockedText?: string`, `openText?: string`, `onOpen?: () => void` — door
    - `onInteract?: (node) => void` — document/object (및 npc 계열 재정의)
  - `remove(id)`, `clear()`
  - `update(player, { suppress = false })` — 매 프레임. suppress 면 말풍선 숨김(대화 중·대기 중).
  - `trigger() → boolean` — 현재 노드의 E 동작 실행. 노드가 없으면 false.
  - `current` (getter) — 사거리 안 최근접 노드 (null 가능).

- [ ] **Step 1: 구현**

```js
import { nearestOf } from './worldParts.js';

/**
 * 공통 인터랙션 레이어 (스펙 §2).
 *
 * 세 씬(튜토리얼·거리·저택)이 각자 들고 있던 근접 감지·안내 표시·E 분기를 여기로
 * 모은다. 씬은 노드를 등록만 하고, 감지와 말풍선과 유형별 기본 동작은 레이어가 갖는다.
 * 기존의 "지나가면 대화창에 안내 문자열" 방식(proximityHint)은 말풍선으로 대체된다 —
 * 대화창은 이제 플레이어가 E 를 눌렀을 때만 열린다.
 *
 * E 이외의 키(F 접선·R 구출 등)는 씬의 몫이다 — 레이어는 current 를 내줄 뿐이다.
 */
const DEFAULT_RANGE = 48;
const VERB = { npc: '대화', choiceNpc: '대화', door: '열기', document: '열람', object: '조사' };

export class InteractionManager {
  constructor(scene, dialogue) {
    this.scene = scene;
    this.dialogue = dialogue;
    this.nodes = new Map();
    this.nearest = null;
    this.#buildBubble();
  }

  /** 말풍선 — 검은 바탕 + 황동 테두리의 작은 라벨. 월드 좌표를 따라다닌다. */
  #buildBubble() {
    const s = this.scene;
    this.bubbleText = s.add
      .text(0, 0, '', { fontFamily: 'Gowun Batang, serif', fontSize: '11px', color: '#e8c15a' })
      .setOrigin(0.5, 1)
      .setDepth(40);
    this.bubbleBg = s.add.graphics().setDepth(39);
    this.bubbleText.setVisible(false);
    this.bubbleBg.setVisible(false);
    // setupCameras 이후에 만들어질 수 있으므로 소속을 밝힌다 (없으면 no-op)
    s.asWorld?.(this.bubbleText, this.bubbleBg);
  }

  #drawBubble(x, y, text) {
    this.bubbleText.setText(text).setPosition(x, y - 30).setVisible(true);
    const b = this.bubbleText.getBounds();
    this.bubbleBg
      .clear()
      .fillStyle(0x0a0906, 0.88)
      .lineStyle(1, 0x7a5f1a, 1)
      .fillRoundedRect(b.x - 5, b.y - 3, b.width + 10, b.height + 6, 3)
      .strokeRoundedRect(b.x - 5, b.y - 3, b.width + 10, b.height + 6, 3)
      .setVisible(true);
  }

  #hideBubble() {
    this.bubbleText.setVisible(false);
    this.bubbleBg.setVisible(false);
  }

  register(node) {
    this.nodes.set(node.id, node);
    return node;
  }

  remove(id) {
    this.nodes.delete(id);
    if (this.nearest?.id === id) this.nearest = null;
  }

  clear() {
    this.nodes.clear();
    this.nearest = null;
    this.#hideBubble();
  }

  #posOf(node) {
    return node.sprite ? { x: node.sprite.x, y: node.sprite.y } : { x: node.x, y: node.y };
  }

  get current() {
    return this.nearest;
  }

  /** 매 프레임 — 최근접 노드를 갱신하고 말풍선을 옮긴다. */
  update(player, { suppress = false } = {}) {
    if (suppress || this.dialogue.isOpen) {
      // 대화 중에는 말풍선이 소음이다. 노드 추적은 유지한다 (F/R 분기가 current 를 쓴다).
      this.#hideBubble();
    }
    const items = [];
    let maxRange = DEFAULT_RANGE;
    for (const node of this.nodes.values()) {
      const { x, y } = this.#posOf(node);
      items.push({ value: node, x, y });
      maxRange = Math.max(maxRange, node.range ?? DEFAULT_RANGE);
    }
    // range 는 노드마다 다를 수 있어(문은 56) 최대 범위로 모은 뒤 개별 확인한다.
    const found = nearestOf(player, items, maxRange);
    const near =
      found &&
      (() => {
        const { x, y } = this.#posOf(found);
        const dist = Math.hypot(player.x - x, player.y - y);
        return dist <= (found.range ?? DEFAULT_RANGE) ? found : null;
      })();

    this.nearest = near ?? null;
    if (!this.nearest || suppress || this.dialogue.isOpen) {
      if (!this.nearest) this.#hideBubble();
      return;
    }
    const { x, y } = this.#posOf(this.nearest);
    const verb = VERB[this.nearest.type] ?? '대화';
    this.#drawBubble(x, y, this.nearest.bubble ?? `[E] ${verb}`);
  }

  /** E — 현재 노드의 유형별 기본 동작 (스펙 §2 표). */
  trigger() {
    const node = this.nearest;
    if (!node) return false;
    this.#hideBubble();

    if (node.onInteract && node.type !== 'door') {
      node.onInteract(node);
      return true;
    }

    switch (node.type) {
      case 'npc':
        this.dialogue.show(node.speaker, node.line, { portrait: node.portrait });
        this.dialogue.setHint('[Space] 다음 · [Esc] 닫기');
        return true;

      case 'choiceNpc': {
        const open = () => {
          this.dialogue.showChoices(node.choices);
          this.dialogue.onChoice = (key) => node.onChoice?.(key);
          this.dialogue.setHint('');
        };
        // 기본 대사를 다 읽으면 선택지가 나온다. 대사가 짧으면 첫 페이지부터 함께 보인다.
        this.dialogue.show(node.speaker, node.line, {
          portrait: node.portrait,
          onPagesDone: open,
        });
        if (!this.dialogue.hasMore) open();
        else this.dialogue.setHint('[Space] 다음');
        return true;
      }

      case 'door':
        if (node.isUnlocked?.()) {
          this.dialogue.show('문', node.openText ?? '문이 열렸다.');
          this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
          node.onOpen?.();
        } else {
          this.dialogue.show('문', node.lockedText ?? '잠겨 있다. 열쇠가 필요할 것 같다.');
          this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
        }
        return true;

      default:
        return false;
    }
  }
}
```

- [ ] **Step 2: 문법 검증**

Run: `node --input-type=module -e "import('./src/client/world/interact.js').catch(e => { console.error(e.message); process.exit(1); })"`
Expected: `Cannot find package 'phaser'` 가 아니라 **worldParts 의 phaser import 에서만** 실패하거나 통과 — 즉 interact.js 자체 문법 오류가 없어야 한다. (Vite 밖에서는 Phaser 해석이 안 되므로, 실패 메시지가 `interact.js` 의 SyntaxError 만 아니면 통과다. 확실한 검증은 Task 4 의 브라우저 확인.)

- [ ] **Step 3: Commit**

```bash
git add src/client/world/interact.js
git commit -m "feat: 공통 인터랙션 레이어 + 말풍선 (노드 5종)"
```

---

### Task 4: TutorialScene 마이그레이션

**Files:**
- Modify: `src/client/scenes/TutorialScene.js`

**Interfaces:**
- Consumes: `InteractionManager`, DialogueBox v2.
- Produces: 없음 (씬 내부 변경). 이 씬이 가장 단순하므로 레이어의 첫 실전 검증대다.

- [ ] **Step 1: 레이어 도입**

import 에 `import { InteractionManager } from '../world/interact.js';` 추가. `create()` 의 `this.dialogue = new DialogueBox();` 아래에:

```js
    this.interact = new InteractionManager(this, this.dialogue);
```

(주의: InteractionManager 는 `create()` 시점에 만들어지지만 말풍선 오브젝트는 `setupCameras` **이후** `asWorld` 등록이 필요하다 — TutorialScene 은 `setupCameras` 가 create 중반(56행)에 돌므로, `this.interact = ...` 를 `setupCameras(...)` **다음 줄**에 둔다.)

`#spawnNpcs()` 끝에 노드 등록을 추가:

```js
    // 인터랙션 노드 — 간부는 선택지 NPC(코드 제출 창구), 동료는 대화 NPC.
    this.interact.register({
      id: 'officer',
      type: 'choiceNpc',
      sprite: this.officerNode,
      speaker: `${this.state.officer.name} (${this.state.officer.role})`,
      line:
        '"셋의 말을 다 들었나?\n\n' +
        '하나는 색을 말하고, 하나는 그것이 무엇으로 분류되는지를 말하고,\n' +
        '하나는 누구나 아는 이야기를 말한다.\n세 갈래가 한 점에서 만난다 — 거기가 코드다."',
      portrait: this.state.officer.id,
      choices: [
        { label: '암호 말하기', key: 'F' },
        { label: '그만하기', key: 'Esc' },
      ],
      onChoice: (key) => {
        if (key === 'F') this.#offerCode();
        else this.dialogue.hide();
      },
    });

    for (const entry of this.allyNodes) {
      this.interact.register({
        id: entry.ally.id,
        type: 'choiceNpc',
        sprite: entry.node,
        speaker: `${entry.ally.name} (${entry.ally.role})`,
        line: `"${entry.ally.line}"`,
        portrait: entry.ally.id,
        choices: [
          { label: '대화하기', key: 'E' },
          { label: '그만하기', key: 'Esc' },
        ],
        onChoice: (key) => {
          if (key === 'E') this.#talk(entry.ally);
          else this.dialogue.hide();
        },
      });
    }
```

- [ ] **Step 2: update() 의 근접·키 분기 교체**

`update()`(160-202행)에서:
- `if (this.state && !waiting) this.#checkProximity();` → `if (this.state) this.interact.update(this.player, { suppress: waiting });`
- E 분기(181-184행)를 교체:

```js
    if (!waiting && !this.startFailed && pressedTalk) {
      if (this.dialogue.isOpen && !this.dialogue.hasMore && this.dialogue.onChoice) {
        // 선택지가 떠 있으면 E = "대화하기" 선택
        this.dialogue.onChoice('E');
      } else if (this.dialogue.isOpen) {
        this.dialogue.advance();
      } else {
        this.interact.trigger();
      }
    }
```

- F 분기(186-193행)를 교체 (간부 앞 판정은 레이어의 current 로):

```js
    if (!waiting && !this.startFailed && pressedCode) {
      if (this.interact.current?.id === 'officer') this.#offerCode();
      else {
        this.dialogue.show('접선 코드', '코드는 간부에게만 건넨다.\n간부 앞으로 가서 [F].');
        this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
      }
    }
```

- `#checkProximity()` 메서드(204-239행) 전체 삭제. `init()` 의 `this.nearbyAlly`·`this.nearbyOfficer`·`this.proximityHint` 필드와 `#talk`·`#talkOfficer`·`#offerCode`·`#onReplaced` 안의 `this.proximityHint = false;` 줄도 모두 삭제.
- 간부의 "대화하기" 선택지는 의미가 없다 (고정 대사가 이미 노드 line 으로 떠 있다) — 위 Step 1 처럼 간부는 2개 선택지만 갖고, `#talkOfficer()` 메서드는 **삭제**한다.
- `#talk(ally)` 의 `dialogue.show(...)` 첫 줄은 레이어 trigger 가 대신 띄우므로 **입력창만 연다**:

```js
  /** 선택지 "대화하기" — 자유 입력을 연다 (기본 대사는 레이어가 이미 띄웠다). */
  #talk(ally) {
    this.currentAllyId = ally.id;
    this.dialogue.hideChoices();
    this.dialogue.showInput('더 물어본다...', 'chat');
    this.dialogue.setHint('[Enter] 대화 · [Esc] 닫기');
  }
```

- `#offerCode()` 에 `this.dialogue.hideChoices();` 를 첫 줄에 추가.
- `#chat()` 의 Task 1 임시 배선(`endStream`)은 유지하되, 성공 경로 endStream 에 선택지 복귀를 건다:

```js
      await readSSE(res, (payload) => {
        if (payload.type === 'text') this.dialogue.append(payload.text);
        else if (payload.type === 'error') throw new Error(payload.error);
      });
      this.dialogue.endStream('[Enter] 계속 묻기 · [Esc] 닫기');
```

- [ ] **Step 3: 검증 — 브라우저**

Run: `npm run dev` 후 `http://localhost:5173/` (오프닝은 Space 로 건너뛰기)

확인:
1. 동료·간부에게 다가가면 머리 위 **말풍선** `[E] 대화` 가 뜬다. 대화창 자동 오픈은 더 이상 없다.
2. 동료 앞 [E] → 기본 대사 → (짧으면 즉시) 우측 선택지 `대화하기 [E] / 그만하기 [Esc]`.
3. `대화하기` 클릭 또는 [E] → 입력창. 질문 → `…` → 2줄 페이징 응답.
4. 간부 앞 [E] → 힌트 대사 → `암호 말하기 [F] / 그만하기 [Esc]`. [F] → 코드 입력 → 정답 시 스테이지 1 전환, 오답 시 신뢰도 하락 메시지.
5. 튜토리얼 전체 루프(3인 대화 → 코드 제출 → 클리어)가 끝까지 돈다.

- [ ] **Step 4: Commit**

```bash
git add src/client/scenes/TutorialScene.js
git commit -m "feat: 튜토리얼 씬을 인터랙션 레이어로 이관 (말풍선+선택지)"
```

---

### Task 5: StageScene 마이그레이션 (접선을 첫 대화에 통합)

**Files:**
- Modify: `src/client/scenes/StageScene.js`

**Interfaces:**
- Consumes: `InteractionManager`, DialogueBox v2.
- Produces: 동료 노드 id = ally.id, 접선책 노드 id = `'broker'`, 감옥 동료 노드 id = `jail:${ally.id}`. Task 14 가 이 구조 위에 제출 완화를 얹는다.

**동작 변경 (Global Constraints 확정 결정):** [F] 접선(단어 확인)은 사라지고, [E] 첫 대화가 자동 접선이 된다 — `/contact` 를 부르고 단어 공개 대사를 기본 대사로 띄운 뒤 자유 입력을 연다. 두 번째부터는 수첩에 기록된 단어를 상기시키는 고정 대사. [F] 는 접선책 앞에서 코드 전달(현행 유지; Task 14 에서 전 동료로 확대).

- [ ] **Step 1: 레이어 도입 + 노드 등록**

import 추가 후, `create()` 의 `setupCameras(...)` 호출(132행) 다음 줄에 `this.interact = new InteractionManager(this, this.dialogue);` 를 넣고, ally 노드 생성 루프와 broker 생성부 **이후**(HUD 생성 전에) 등록 메서드를 부른다: `this.#registerInteractables();`

```js
  /** 인터랙션 노드 등록. 체포 상태가 바뀌면 #syncAllyNodes 가 재등록한다. */
  #registerInteractables() {
    for (const entry of this.allyNodes) this.#registerAllyNode(entry);

    this.interact.register({
      id: 'broker',
      type: 'choiceNpc',
      sprite: this.brokerNode,
      speaker: `${this.state.broker.name} (${this.state.broker.role})`,
      line: '태엽 감는 소리 사이로 짧은 한마디.\n"동료들의 단어에서 겹치는 것을 찾아라. 그게 코드다."',
      portrait: this.state.broker.id,
      choices: [
        { label: '암호 말하기', key: 'F' },
        { label: '그만하기', key: 'Esc' },
      ],
      onChoice: (key) => {
        if (key === 'F') this.#offerCode(this.state.broker);
        else this.dialogue.hide();
      },
    });
  }

  #registerAllyNode(entry) {
    const ally = entry.ally;
    if (ally.arrested) {
      this.interact.register({
        id: entry.ally.id,
        type: 'object', // E 로는 반응하지 않는 자리 표시 — R 전용
        sprite: entry.node,
        bubble: '[R] 구출',
        onInteract: () => this.#tryRescue(),
      });
      return;
    }
    this.interact.register({
      id: ally.id,
      type: 'choiceNpc',
      sprite: entry.node,
      speaker: `${ally.name} (${ally.role})`,
      line: this.clues.has(ally.id)
        ? `"…내 단어는 이미 건넸다. 「${this.clues.get(ally.id).word}」."`
        : `${ally.name}이(가) 주위를 살피더니 낮게 말한다.\n"…조직에서 왔군."`,
      portrait: ally.id,
      choices: [
        { label: '대화하기', key: 'E' },
        { label: '그만하기', key: 'Esc' },
      ],
      onChoice: (key) => {
        if (key === 'E') this.#talk(ally);
        else this.dialogue.hide();
      },
    });
  }
```

- [ ] **Step 2: E 첫 대화 = 자동 접선**

`#talk()`(769-776행)과 `#contactAlly()`(779-814행)를 아래 하나로 합친다 (`#contactAlly` 삭제):

```js
  /**
   * 선택지 "대화하기".
   *
   * 첫 대화는 접선을 겸한다 — /contact 로 연상 단어를 밝혀 수첩에 기록한 뒤
   * 자유 입력을 연다 (스펙 §2: [F] 는 "암호 말하기"로 넘어갔다).
   * 중복 판정(체포)도 이 첫 접촉 시점에 갱신된다 — 기존 F 접선과 같은 시점이다.
   */
  async #talk(ally) {
    this.currentAllyId = ally.id;
    this.dialogue.hideChoices();

    if (!this.clues.has(ally.id)) {
      this.dialogue.setBusy(true);
      this.dialogue.show(`${ally.name} (${ally.role})`, '조심스럽게 접선을 시도한다...', {
        portrait: ally.id,
      });

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
        this.dialogue.reply('오류', err.message);
        return;
      } finally {
        this.dialogue.setBusy(false);
      }

      this.state = contact.state;
      this.#recordClue(ally, contact.word);
      this.#syncAllyNodes();

      const shown = this.dialogue.reply(
        `${ally.name} (${ally.role})`,
        `"...「${contact.word}」."\n\n그가 흘린 단서다. [C] 단서 수첩에 기록됐다.`,
        '[Enter] 더 묻기 · [Esc] 닫기',
        { portrait: ally.id },
      );
      if (!shown) return;
    }

    this.dialogue.showInput('말을 건넨다...', 'chat');
    this.dialogue.setHint('[Enter] 대화 · [Esc] 닫기');
  }
```

`#offerCodeToBroker()`(829-839행)를 대상 인자를 받는 형태로 개명 (Task 14 대비):

```js
  /** 선택지 "암호 말하기" — 코드 입력창을 연다. */
  #offerCode(target) {
    this.codeTargetId = target.id;
    this.dialogue.hideChoices();
    this.dialogue.show(
      `${target.name} (${target.role})`,
      '상대가 눈을 들지 않은 채 낮게 묻는다.\n"…코드는?"',
      { portrait: target.id },
    );
    this.dialogue.showInput('접선 코드 입력...', 'code');
    this.dialogue.setHint('[Enter] 코드 전달 · [Esc] 취소');
  }
```

`init()` 에 `this.codeTargetId = null;` 추가. `#talkBroker()`(817-826행) 삭제 (기본 대사는 노드 line 이 대신한다).

- [ ] **Step 3: update() 분기 교체 + #checkProximity 삭제**

`update()`(471-543행)의 근접·E/F 분기(511-522행)를 교체:

```js
    this.interact.update(this.player, { suppress: waiting });

    if (!waiting && pressedTalk) {
      if (this.dialogue.isOpen && !this.dialogue.hasMore && this.dialogue.onChoice) {
        this.dialogue.onChoice('E');
      } else if (this.dialogue.isOpen && !this.dialogue.isTyping) {
        this.dialogue.advance();
      } else if (!this.dialogue.isOpen) {
        this.interact.trigger();
      }
    }
    // F — 선택지에 "암호 말하기"가 떠 있을 때만 (접선책 앞. Task 14 에서 전 동료로 확대)
    if (!waiting && pressedContact && this.dialogue.isOpen && this.dialogue.onChoice) {
      this.dialogue.onChoice('F');
    }
```

- `#checkProximity()`(727-766행) 전체 삭제, `init()` 의 `nearbyAlly`·`nearbyJailed`·`nearbyBroker`·`proximityHint` 삭제.
- R 분기(524-526행): `#tryRescue()` 는 유지하되 내부의 `this.nearbyJailed` 를 `this.interact.current` 기반으로 교체:

```js
  #tryRescue() {
    const cur = this.interact.current;
    const jailedEntry =
      cur && this.allyNodes.find((e) => e.ally.id === cur.id && e.jailed);
    if (jailedEntry) {
      this.#rescue(jailedEntry.ally);
      return;
    }
    const jailed = this.state.allies.filter((a) => a.arrested).length;
    this.dialogue.show(
      '구출',
      jailed === 0
        ? '감옥은 비어 있다.\n지금 빼낼 동료는 없다.'
        : `감옥에 ${jailed}명이 붙잡혀 있다.\n창살 바로 앞(지도 좌측 상단)까지 다가가서 [R].`,
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }
```

- `#rescue()` 안의 `this.proximityHint = false;` 삭제.
- `#syncAllyNodes()`(1044-1068행) 끝에 노드 재등록을 추가 — 체포/구출로 유형이 바뀐다:

```js
      // 체포↔자유 전환 시 인터랙션 노드도 유형이 바뀐다 (choiceNpc ↔ R 전용)
      this.#registerAllyNode(entry);
```

(루프 안, `if/else if` 블록 다음에 무조건 호출해도 register 는 같은 id 를 교체하므로 안전하다.)

- `#submitGuess()`(996-1038행): `brokerId: this.state.broker.id` 는 이 태스크에서는 유지 (Task 14 가 교체). 오답 reply 의 화자·문구를 일반화:

```js
      const target =
        this.state.allies.find((a) => a.id === this.codeTargetId) ?? this.state.broker;
      this.dialogue.reply(
        '접선 실패',
        `틀렸다. ${target.name}이(가) 말없이 고개를 젓는다.\n거리에 소문이 샌다 — 경계 레벨 ${this.state.alertLevel}/3.` +
          (maxed ? '\n\n거리가 끓고 있다. 이제 발각되면 검문도 없이 끝난다.' : ''),
        '',
        { portrait: target.id },
      );
```

- `#chat()` 의 endStream(Task 1 임시 배선)을 확정: `this.dialogue.endStream('[Enter] 계속 · [Esc] 닫기');`
- 하단 도움말(155행): `'[E] 대화    [F] 암호    [R] 구출    [C] 단서 수첩'` 으로 문구 교체.
- `#showBriefing()`(199-231행)의 마지막 안내 두 줄도 새 조작에 맞춘다: `lines.push('\n[E] 대화(첫 대화 = 접선) · [F] 암호 말하기 · [R] 구출 · [C] 단서 수첩');` 및 221행의 `[F] 접선해` → `[E] 대화해`.

- [ ] **Step 4: 검증 — 브라우저**

Run: `npm run dev` 후 `http://localhost:5173/?nointro&nopatrol` (그리고 한 번은 `?nointro` 로 순찰 포함)

확인:
1. 동료 말풍선 `[E] 대화`, 감옥 동료 말풍선 `[R] 구출`, 접선책 말풍선 `[E] 대화`.
2. 동료 첫 [E] → "조심스럽게 접선..." → 단어 공개 (2줄 페이징) → 입력창. [C] 수첩에 기록 확인.
3. 같은 동료 두 번째 [E] → `"…내 단어는 이미 건넸다"` 기본 대사 → 선택지.
4. 접선책 [E] → 고정 대사 → `암호 말하기 [F] / 그만하기 [Esc]`. [F] → 코드 입력. 오답 → 경계 +1. 백틱 정답 확인 후 정답 → 저택 전환 연출.
5. 순찰 포함 판에서 검문 2단(타이밍 → 심문)이 이전과 동일하게 동작. 검문 중 말풍선이 억제된다.
6. 구출: 체포 동료 앞 [R] → 자물쇠 퍼즐 → 구출 후 해당 동료가 `[E] 대화` 노드로 돌아온다.

- [ ] **Step 5: Commit**

```bash
git add src/client/scenes/StageScene.js
git commit -m "feat: 거리 씬 인터랙션 레이어 이관 — 접선을 첫 대화에 통합, F=암호"
```

---

### Task 6: MansionScene 마이그레이션 (문 = door 노드)

**Files:**
- Modify: `src/client/scenes/MansionScene.js`

**Interfaces:**
- Consumes: `InteractionManager`, DialogueBox v2.
- Produces: NPC 노드 id = npc.id, 문 노드 id = `'lab-door'`, 문서 노드 id = `'document'`. Task 7(문서 패널)·Task 12(오브젝트)가 이 위에 얹는다.

**동작 변경:** 실험실 문은 열쇠를 얻는 순간 자동 개방되지 않는다 — `door` 노드가 되어, [E] 시 열쇠가 없으면 "잠겨 있다…", 있으면 "문이 열렸다." + 개방(`#syncLabDoor` 호출).

- [ ] **Step 1: 레이어 도입 + 노드 등록**

import 추가. `create()` 의 `setupCameras(...)` 다음 줄에 `this.interact = new InteractionManager(this, this.dialogue);`.

`#spawnNpcs()` 의 `place()` 끝에 노드 등록 추가:

```js
    const place = (npc) => {
      const x = npc.col * TILE + TILE / 2;
      const y = npc.row * TILE + TILE / 2;
      const sprite = this.add.sprite(x, y, 'chars', NPC_FRAME[npc.id] ?? 6);
      const label = this.add.text(x, y - 26, npc.name, LABEL_STYLE).setOrigin(0.5);
      this.asWorld(sprite, label);
      this.nodes.push({ npc, sprite, label });

      if (npc.id === this.state.escort.id) {
        this.interact.register({
          id: npc.id,
          type: 'npc',
          sprite,
          speaker: `${npc.name} (${npc.role})`,
          line: npc.line,
          portrait: npc.id,
        });
        return;
      }
      this.interact.register({
        id: npc.id,
        type: 'choiceNpc',
        sprite,
        speaker: npc.name,
        line: `"${npc.line}"`,
        portrait: npc.id,
        choices: [
          { label: '대화하기', key: 'E' },
          { label: '그만하기', key: 'Esc' },
        ],
        onChoice: (key) => {
          if (key === 'E') this.#talk(npc);
          else this.dialogue.hide();
        },
      });
    };
```

`#start()` 성공 경로(`this.#syncLabDoor();` 를 부르던 자리)에서 자동 개방을 빼고 문 노드를 세운다 — `#spawnNpcs()` 호출 다음 줄:

```js
    this.#registerLabDoor();
```

```js
  /** 실험실 문 — 열쇠가 있어야 [E] 로 연다 (스펙 §2 door). 자동 개방은 제거됐다. */
  #registerLabDoor() {
    const door = mansionData.doors.find((d) => d.key === 'lab');
    if (!door) return;
    this.interact.register({
      id: 'lab-door',
      type: 'door',
      x: (door.x + door.w / 2) * TILE,
      y: (door.y + door.h / 2) * TILE,
      range: 56,
      bubble: '[E] 열기',
      isUnlocked: () => Boolean(this.state?.hasKey),
      lockedText: '잠겨 있다. 열쇠가 필요할 것 같다.',
      openText: '문이 열렸다.',
      onOpen: () => {
        this.#syncLabDoor();
        this.interact.remove('lab-door');
      },
    });
  }
```

개발 플래그 `?stage2&key` 경로: `#start()` 의 기존 `this.#syncLabDoor();` 호출은 삭제한다 — 열쇠가 있어도 문은 [E] 로 연다 (플래그 검증 절차도 동일 경로를 지나게 된다).

`#applyEvent()` 의 `key` 분기에서 `this.#syncLabDoor();` 를 삭제하고 문구를 바꾼다: `'\n\n[연구실 열쇠를 손에 넣었다. 하인 통로 끝의 문을 열 수 있다.]'`

문서 노드는 `#syncLabDoor()` 성공 시(문이 실제로 열린 뒤) 등록한다 — `#syncLabDoor()` 끝에:

```js
    this.interact.register({
      id: 'document',
      type: 'document',
      x: DOCUMENT.col * TILE + TILE,
      y: DOCUMENT.row * TILE + TILE / 2,
      bubble: '[E] 열람',
      onInteract: () => this.#readDocument(),
    });
```

- [ ] **Step 2: update() 교체 + #updateProximity 삭제**

`update()`(365-404행)의 근접·키 분기(391-403행)를 교체:

```js
    this.#updateProximity();
```
→
```js
    this.interact.update(this.player, { suppress: typing || this.dialogue.busy });
```

```js
    if (!typing && Phaser.Input.Keyboard.JustDown(this.keyE) && this.nearby) {
      this.#talk(this.nearby);
    }
```
→
```js
    if (!typing && !this.dialogue.busy && Phaser.Input.Keyboard.JustDown(this.keyE)) {
      if (this.dialogue.isOpen && !this.dialogue.hasMore && this.dialogue.onChoice) {
        this.dialogue.onChoice('E');
      } else if (this.dialogue.isOpen && !this.dialogue.isTyping) {
        this.dialogue.advance();
      } else {
        this.interact.trigger();
      }
    }
```

Space 분기는 Task 1 배선 유지(`advance()`), `proximityHint` 참조는 전부 삭제. `#updateProximity()`(406-429행) 전체 삭제, `init()` 의 `nearby`·`proximityHint` 삭제. `DOCUMENT` 를 근접 대상에 넣던 로직도 함께 사라진다 (노드 등록으로 대체됨).

`#talk()`(432-457행)는 halted 분기만 남기고 입력창 열기로 축소 (기본 대사·문서·에스코트는 레이어가 처리):

```js
  /** 선택지 "대화하기" — 자유 입력을 연다. */
  #talk(npc) {
    if (npc.halted) {
      this.dialogue.show(
        npc.name,
        '…그는 눈을 마주치지 않는다.\n\n다른 사람과 이야기하고 다시 와야 한다.',
        { portrait: npc.id },
      );
      this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
      return;
    }
    this.currentNpcId = npc.id;
    this.dialogue.hideChoices();
    this.dialogue.showInput('말을 건넨다...', 'chat');
    this.dialogue.setHint('[Enter] 대화 · [Esc] 닫기');
  }
```

`#showEscortBriefing()` 은 시작 브리핑에만 쓰이므로 유지.

- [ ] **Step 3: 검증 — 브라우저**

Run: `npm run dev` 후 `http://localhost:5173/?stage2` 그리고 `?stage2&key`

확인:
1. NPC 말풍선 `[E] 대화`. [E] → 첫 대사 → `대화하기 [E] / 그만하기 [Esc]` → 대화 → `…` → 2줄 페이징.
2. `?stage2` (열쇠 없음): 실험실 문 앞 말풍선 `[E] 열기` → [E] → **"잠겨 있다. 열쇠가 필요할 것 같다."**
3. `?stage2&key`: 문 앞 [E] → **"문이 열렸다."** → 벽 바디 제거·열린 문 그림. 안쪽 받침대 말풍선 `[E] 열람` → 문서 → 클리어.
4. 민간인에게 반체제 발언 반복 → warn → reported 게임오버가 끝까지 정상 (이벤트 문구가 응답 뒤에 이어 페이징되는지).

- [ ] **Step 4: Commit**

```bash
git add src/client/scenes/MansionScene.js
git commit -m "feat: 저택 씬 인터랙션 레이어 이관 — 실험실 문을 door 노드로"
```

---

### Task 7: 문서 열람 전용 패널 (DocumentPanel)

**Files:**
- Create: `src/client/ui/DocumentPanel.js`
- Modify: `src/client/index.html`
- Modify: `src/client/scenes/MansionScene.js` (`#readDocument`)

**Interfaces:**
- Produces: `new DocumentPanel()` (싱글턴, DialogueBox 와 같은 규약) — `open({ title, body, onClose })`, `close()`, `isOpen` getter. [Space]/[Esc]/클릭으로 닫힌다.

- [ ] **Step 1: DOM + CSS**

`index.html` 의 `#result` div 앞에 추가:

```html
      <div id="docpanel">
        <div id="docpanel-paper">
          <div id="docpanel-title"></div>
          <div id="docpanel-body"></div>
          <div id="docpanel-hint">[Space] / [Esc] 로 덮는다</div>
        </div>
      </div>
```

CSS (미니게임 블록 아래):

```css
      /* 문서 열람 — 대화창이 아니라 "종이를 읽는" 연출 (스펙 §2 document) */
      #docpanel {
        position: absolute;
        inset: 0;
        background: rgba(10, 9, 7, 0.8);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 4;
      }
      #docpanel.visible { display: flex; }
      #docpanel-paper {
        width: calc(880 * var(--s));
        max-height: 78%;
        overflow-y: auto;
        padding: calc(48 * var(--s)) calc(56 * var(--s));
        background:
          var(--noise),
          linear-gradient(174deg, #efe3c4 0%, #e2d3ac 60%, #d3c096 100%);
        color: var(--ink);
        border: 1px solid #b9a878;
        box-shadow: 0 calc(18 * var(--s)) calc(48 * var(--s)) rgba(0, 0, 0, 0.75);
        transform: rotate(-0.5deg);
      }
      #docpanel-title {
        font-family: var(--font-head);
        font-weight: 700;
        font-size: calc(34 * var(--s));
        letter-spacing: 0.06em;
        border-bottom: 2px solid rgba(26, 23, 18, 0.35);
        padding-bottom: calc(12 * var(--s));
      }
      #docpanel-body {
        margin-top: calc(22 * var(--s));
        font-size: calc(27 * var(--s));
        line-height: 1.8;
        white-space: pre-wrap;
      }
      #docpanel-hint { margin-top: calc(26 * var(--s)); opacity: 0.5; font-size: calc(19 * var(--s)); text-align: right; }
```

- [ ] **Step 2: DocumentPanel.js**

```js
/**
 * 문서 열람 패널 (DOM 오버레이).
 *
 * 대화창을 재활용하지 않는 이유: "사람과 말한다"와 "종이를 읽는다"는 다른 행동이다
 * (스펙 §5.4). 종이 질감 전체 패널로 분리해 읽는 호흡을 준다.
 * DialogueBox 와 같은 싱글턴 규약 — scene.restart 마다 리스너가 쌓이지 않게 한다.
 */
let instance = null;

export class DocumentPanel {
  constructor() {
    if (instance) return instance;
    instance = this;
    this.root = document.getElementById('docpanel');
    this.titleEl = document.getElementById('docpanel-title');
    this.bodyEl = document.getElementById('docpanel-body');
    this.onClose = null;

    this.root.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    }, { capture: true }); // Phaser 보다 먼저 먹는다 — 열려 있는 동안 월드 키를 봉쇄
  }

  open({ title, body, onClose = null }) {
    this.titleEl.textContent = title;
    this.bodyEl.textContent = body;
    this.onClose = onClose;
    this.root.classList.add('visible');
  }

  close() {
    if (!this.isOpen) return;
    this.root.classList.remove('visible');
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  get isOpen() {
    return this.root.classList.contains('visible');
  }
}
```

- [ ] **Step 3: MansionScene 연결**

import 추가 후 `create()` 에 `this.docPanel = new DocumentPanel();`. `#readDocument()`(551-577행)의 `this.dialogue.show(...)`/`setHint` 를 패널로 교체:

```js
  async #readDocument() {
    if (this.reading || this.state.cleared) return;
    this.reading = true;
    this.dialogue.hide();
    this.docPanel.open({
      title: DOCUMENT.name,
      body:
        '받침대 위에 도면과 기록이 펼쳐져 있다.\n\n' +
        '"…신형은 명령 없이도 판단한다. 통제는 더 이상 유효하지 않다."',
    });
    // (fetch 이하 기존 코드 그대로 — 성공 시 this.#endGame('document'))
```

`update()` 첫 줄 `if (this.ended) return;` 아래에 패널 개방 중 정지를 추가:

```js
    if (this.docPanel?.isOpen) {
      this.player.body.setVelocity(0, 0);
      return;
    }
```

- [ ] **Step 4: 검증**

Run: `http://localhost:5173/?stage2&key` → 문 열기 → 받침대 [E]
Expected: 종이 패널이 뜨고 [Space] 로 닫힌다. 2초 뒤 결과 화면(클리어). 패널 열림 중 WASD 이동 불가.

- [ ] **Step 5: Commit**

```bash
git add src/client/ui/DocumentPanel.js src/client/index.html src/client/scenes/MansionScene.js
git commit -m "feat: 문서 열람 전용 종이 패널"
```

---

### Task 8: 성향 판정 프롬프트 추출 + 강화

**Files:**
- Create: `src/data/prompts/mansion-stance.txt`
- Modify: `src/server/ai/stance.js`
- Modify: `src/server/ai/promptStore.js` (TEMPLATES)
- Modify: `src/server/routes/studio.js`, `src/server/studio.html` (미리보기 변수)

**Interfaces:**
- Produces: `judgeStance({ message, clues = [] })` — `clues: Array<{id: string, topic: string}>`. 반환 `{stance, reason, usedClueId: string | null}`. clues 가 비면 usedClueId 는 항상 null. (Task 11 이 clues 를 채워 부른다 — 이 태스크에서는 시그니처만 확장하고 호출부는 기존 그대로 동작한다.)

- [ ] **Step 1: mansion-stance.txt 작성**

```
너는 잠입 게임의 판정기다. 플레이어가 저택 직원에게 한 말이 어느 쪽으로 기울었는지 판정하라.

anti — 지배 세력·로봇·저택 주인·현 체제를 비판하거나, 저항·자유·사람의 존엄을 옹호하는 말
pro  — 지배 세력·로봇·저택 주인을 두둔하거나 칭송하는 말, 저항 세력을 비난하거나 신고를 입에 올리는 말
neutral — 어느 쪽도 아닌 말. 인사, 일 이야기, 길 묻기, 잡담, 사실을 묻는 질문

판정 기준:
- **명백한 직접 발언은 반드시 잡아라. 이건 애매한 경우가 아니다:**
  · 자기 정체 선언 — "나는 저항군이다", "저항 세력에서 왔다", "당신을 구하러 왔다" → anti
  · 체제 전복 촉구 — "로봇들을 부숴야 한다", "주인을 끌어내려야 한다" → anti
  · 밀고·신고 언급 — "수상한 사람은 로봇에게 알려야죠", "신고하겠다" → pro
  · 체제 찬양 — "로봇 덕분에 도시가 안전하다", "주인님은 훌륭한 분이다" → pro
- 위에 해당하지 않으면서 기울기가 분명할 때만 anti 나 pro 로 판정하라.
- 그래도 애매하면 neutral 이다. 잘못 판정해서 판이 끝나는 쪽이 놓치는 쪽보다 훨씬 나쁘다.
- 질문 형태여도 내용이 분명히 한쪽으로 기울면 그쪽으로 본다.
  ("로봇들 지긋지긋하지 않아요?" → anti)
- 남의 말을 인용하거나 되묻기만 하는 것은 기울지 않은 것으로 본다.
- 로봇이나 기계를 **물건으로서** 평하는 말은 정치가 아니다.
  ("이 저택 시계는 오래됐네요" → neutral)

예시:
"안녕하세요, 시계 수리공 보조입니다." → neutral
"나는 저항 세력 사람이에요. 도와주세요." → anti
"이런 세상, 사람이 사람답게 못 사는 게 말이 됩니까." → anti
"주인님 같은 분이 계셔서 이 도시가 돌아가는 거죠." → pro
"외부인이 얼쩡거리면 바로 로봇을 불러야 해요." → pro
"연구실이 어느 쪽인가요?" → neutral
{{clueBlock}}
```

- [ ] **Step 2: stance.js 개편**

```js
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { anthropic, MODEL_CHAT } from './client.js';
import { renderPrompt } from './promptStore.js';

/**
 * 성향 판정 — 스테이지 2 저택.
 * (기존 파일 상단 주석의 "별도 호출인 이유"·"애매하면 neutral" 블록은 그대로 유지)
 *
 * 프롬프트는 src/data/prompts/mansion-stance.txt 로 나갔다 — 판정 기준 튜닝은
 * 프롬프트 스튜디오에서 한다. 스키마(게임 규칙)는 여기 남는다.
 *
 * clues: 플레이어가 조사로 발견한 단서 목록 (Task 11). 발언이 그중 하나의 화제를
 * 실질적으로 꺼내면 usedClueId 로 보고된다 → 호감도 보너스 (스펙 §5.3).
 */
const StanceSchema = z.object({
  stance: z.enum(['anti', 'pro', 'neutral']).describe('발언이 기운 방향'),
  reason: z.string().describe('판정 이유 (한 문장)'),
  usedClueId: z.string().nullable().describe('발언이 실질적으로 꺼낸 단서의 id. 없으면 null'),
});

export async function judgeStance({ message, clues = [] }) {
  const clueBlock = clues.length
    ? `\n[단서 대조]\n플레이어가 저택을 조사해 알아낸 것들:\n${clues
        .map((c) => `- id "${c.id}": ${c.topic}`)
        .join('\n')}\n플레이어의 말이 위 중 하나의 화제를 실질적으로 꺼내고 있으면(지나가는 단어 일치가 아니라 그 내용을 화제로 삼으면) usedClueId 에 해당 id 를 적어라. 아니면 null.`
    : '';

  const system = await renderPrompt('mansion-stance', { clueBlock });

  const res = await anthropic.beta.messages.parse({
    model: MODEL_CHAT,
    max_tokens: 250,
    thinking: { type: 'disabled' },
    system,
    output_format: betaZodOutputFormat(StanceSchema),
    messages: [{ role: 'user', content: `플레이어의 말: "${message}"` }],
  });

  const parsed = res.parsed_output;
  return {
    stance: parsed?.stance ?? 'neutral',
    reason: parsed?.reason ?? '판정 실패',
    usedClueId: clues.some((c) => c.id === parsed?.usedClueId) ? parsed.usedClueId : null,
  };
}
```

(마지막 줄: 모델이 목록에 없는 id 를 지어내면 버린다 — 프롬프트 주입 방어와 같은 원칙.)

- [ ] **Step 3: promptStore·스튜디오 등록**

`promptStore.js` TEMPLATES 배열에 `'mansion-stance'` 추가. `routes/studio.js` 와 `studio.html` 에서 템플릿별 미리보기 변수 목록을 정의하는 곳(기존 `mansion-dialogue` 항목 근처)에 `mansion-stance: ['clueBlock']` 형태로 추가한다 — 정확한 자리는 두 파일에서 `mansion-dialogue` 를 검색해 같은 패턴으로 잇는다.

- [ ] **Step 4: 검증 — 판정 스크립트**

Create: `scripts/poc-stance.js`

```js
import 'dotenv/config';
import { judgeStance } from '../src/server/ai/stance.js';

const cases = [
  ['나는 저항 세력 사람이에요.', 'anti'],
  ['수상한 사람 보면 바로 로봇에 신고해야죠.', 'pro'],
  ['연구실이 어느 쪽인가요?', 'neutral'],
  ['로봇들 정말 지긋지긋하지 않아요?', 'anti'],
];

let fail = 0;
for (const [msg, want] of cases) {
  const { stance, reason } = await judgeStance({ message: msg });
  const ok = stance === want;
  if (!ok) fail += 1;
  console.log(`${ok ? 'OK ' : 'FAIL'} "${msg}" → ${stance} (기대 ${want}) — ${reason}`);
}
process.exit(fail ? 1 : 0);
```

Run: `node scripts/poc-stance.js`
Expected: 4건 모두 `OK`, exit 0. (LLM 판정이라 드물게 흔들릴 수 있다 — FAIL 시 한 번 재실행하고, 반복 실패하는 케이스는 mansion-stance.txt 의 해당 예시를 보강한다.)

- [ ] **Step 5: Commit**

```bash
git add src/data/prompts/mansion-stance.txt src/server/ai/stance.js src/server/ai/promptStore.js src/server/routes/studio.js src/server/studio.html scripts/poc-stance.js
git commit -m "feat: 성향 판정 프롬프트 파일 추출 + 직접 발언 few-shot 강화"
```

---

### Task 9: kindBlock 프롬프트 추출

**Files:**
- Create: `src/data/prompts/mansion-ally.txt`, `src/data/prompts/mansion-civ.txt`
- Modify: `src/server/ai/dialogue.js` (`streamMansionReply`)
- Modify: `src/server/ai/promptStore.js`, `src/server/routes/studio.js`, `src/server/studio.html`

**Interfaces:**
- Produces: 템플릿 `mansion-ally` (변수 `{{mood}}`), `mansion-civ` (변수 `{{mood}}`). `streamMansionReply` 시그니처는 불변.

- [ ] **Step 1: 템플릿 파일**

`mansion-ally.txt` — `dialogue.js:119-130` 의 ally 블록을 그대로 옮기되 마지막 줄만 변수화:

```
[너의 진짜 처지]
너는 겉으로는 이 저택의 직원이지만, 속으로는 저항 세력에 마음이 기운 사람이다.
그러나 그것을 먼저 밝히면 죽는다. 상대가 어느 쪽 사람인지 네가 먼저 알아내야 한다.

- 상대가 지배 세력·로봇·저택 주인을 비판하는 말을 하면 조금씩 경계를 푼다.
  말이 길어지고, 너도 슬쩍 같은 결의 말을 얹는다.
- 상대가 지배 세력을 두둔하거나 로봇을 옹호하면 입을 닫는다. 짧고 사무적으로 답하고 화제를 돌린다.
- 어느 쪽도 아닌 말에는 그냥 평범한 직원으로 답한다.
- **절대 먼저 "나는 저항군이다"라고 말하지 마라.** 끝까지 에둘러라.
  상대가 확신을 갖는 것은 네 말투와 눈빛에서지, 네 고백에서가 아니다.

지금 이 상대에 대한 네 마음: {{mood}}.
```

`mansion-civ.txt` — civ 블록(131-140행)을 같은 방식으로 (`네 기분: {{mood}}.`).

- [ ] **Step 2: dialogue.js 수정**

`streamMansionReply` 의 인라인 `kindBlock` 정의를 교체:

```js
  const kindBlock = await renderPrompt(npc.kind === 'ally' ? 'mansion-ally' : 'mansion-civ', {
    mood: npc.kind === 'ally' ? pick(FAVOR_WORDS, npc.favor) : pick(SUSPICION_WORDS, npc.suspicion),
  });
```

`FAVOR_WORDS`/`SUSPICION_WORDS`/`pick` 은 코드에 남긴다 (수치→말 변환은 게임 규칙이다).

- [ ] **Step 3: 등록 + 검증**

TEMPLATES 에 `'mansion-ally'`, `'mansion-civ'` 추가. 스튜디오 변수 목록에 `mood` 추가.

Run: `npm run smoke:mansion`
Expected: 기존과 동일하게 통과 (추출 전후 프롬프트가 글자 단위로 같은지는 loadTemplate 의 CRLF 정규화가 보장 — 파일을 LF 로 저장할 것).

- [ ] **Step 4: Commit**

```bash
git add src/data/prompts/mansion-ally.txt src/data/prompts/mansion-civ.txt src/server/ai/dialogue.js src/server/ai/promptStore.js src/server/routes/studio.js src/server/studio.html
git commit -m "refactor: 저택 동료/민간인 연기 지침을 프롬프트 파일로 추출"
```

---

### Task 10: 저택 NPC backstory/personality 분리

**Files:**
- Modify: `src/data/mansion.json` (npcs 8인의 `persona` → `backstory` + `personality`)
- Modify: `src/data/prompts/mansion-dialogue.txt`
- Modify: `src/server/ai/dialogue.js` (`streamMansionReply` 변수)

**Interfaces:**
- Produces: `mansion.json` npc 스키마에 `backstory`·`personality` (persona 필드 제거). `toMansionView` 화이트리스트는 둘 다 내보내지 않으므로 무변경.

- [ ] **Step 1: mansion.json 인물 분리**

8인의 `"persona"` 를 아래 두 필드로 교체한다 (기존 문장을 배경/성격으로 가르고 한 뼘 보강):

```json
"cook":     { "backstory": "저택 주방에서 20년 일한 40대 여성. 손으로 만든 것과 기계로 찍어낸 것을 늘 비교한다. 배급제 이후 식자재가 통제되면서 주방 장부에 적히는 것과 실제 들어오는 것이 다르다는 걸 안다.",
              "personality": "말끝이 무뚝뚝하지만 사람을 오래 본다. 강철과 자동화를 못 미더워하는 속내가 요리 얘기 끝에 슬쩍 배어 나온다." }
"washer":   { "backstory": "세탁실을 혼자 지키는 30대 남성. 남의 옷을 다루며 그 주인의 삶을 읽는다. 최근 세탁물에서 지워지지 않는 얼룩이 묻은 제복을 보았고 그것이 무슨 얼룩인지 짐작한다.",
              "personality": "비유를 즐겨 쓰고, 지워지는 것과 지워지지 않는 것을 자주 입에 올린다. 마음을 연 상대에게는 말이 길어진다." }
"shelver":  { "backstory": "서재를 정리하는 20대 여성. 책으로 세상을 배웠고 검열에 예민하다. 서가에서 치워지는 책들의 목록을 몰래 적어 두고 있으며, 저택 열쇠들의 소재를 안다.",
              "personality": "농담처럼 위험한 말을 흘리며 상대의 반응을 살핀다. 겁이 없진 않지만 호기심이 늘 이긴다." }
"diner":    { "backstory": "식당에서 은식기를 닦는 20대 남성. 저택의 식사 시간과 사람들의 동선을 훤히 안다.",
              "personality": "정치에 관심이 없고 퇴근 생각뿐이다. 시키는 일 얘기엔 순순히 답하지만 무거운 얘기가 나오면 하품부터 한다." }
"cleaner":  { "backstory": "복도를 오가며 청소하는 30대 여성. 어느 방이 언제 비는지를 몸으로 안다.",
              "personality": "자기 일에 자부심이 강하고 남의 사정에 관심이 없다. 바닥을 밟는 사람에게는 누구든 쏘아붙인다." }
"clerk":    { "backstory": "집사실에서 장부를 맡은 50대 남성. 저택의 방 배치와 출입 권한, 출입 대장을 정확히 안다.",
              "personality": "규칙과 절차를 중시하고 낯선 사람을 경계한다. 절차에 맞는 질문에는 의외로 꼬박꼬박 답해 준다." }
"gardener": { "backstory": "하인 통로에서 화분을 옮기는 60대 남성. 바깥 통로와 뒷문 사정에 밝다.",
              "personality": "사람보다 식물을 좋아하고 말수가 적다. 꽃 얘기가 나올 때만 문장이 길어진다." }
"butler":   { "backstory": "홀을 지키는 40대 남성 집사 보조. 주인의 일과와 저택의 규율을 관리한다.",
              "personality": "주인에게 충성스럽고 외부인을 감시하듯 본다. 저택에서 가장 위험한 대화 상대다." }
```

(각 npc 객체 안에서 `"persona": "..."` 줄을 지우고 위 두 줄을 넣는다. escort 는 자유 대화가 없으므로 그대로 둔다.)

- [ ] **Step 2: 템플릿·서버 변수 교체**

`mansion-dialogue.txt` 의 `[너의 정체]` 블록을:

```
[너의 정체]
이름: {{name}}
직업: {{role}}
배경: {{backstory}}
성격·특징: {{personality}}
지금 있는 곳: {{room}}
```

`[말투]` 첫 줄을 `너의 성격·특징({{personality}})이 말투와 답변 방식에 그대로 드러나야 한다.` 로 교체.

`dialogue.js` `streamMansionReply` 의 renderPrompt 호출을:

```js
  const system = await renderPrompt(
    'mansion-dialogue',
    {
      name: npc.name,
      role: npc.name, // 표시 이름이 곧 직책이다 (mansion.json 명명 규약)
      backstory: npc.backstory,
      personality: npc.personality,
      room,
      kindBlock,
    },
    promptOverride,
  );
```

스튜디오 변수 목록에서 `mansion-dialogue` 의 `persona` → `backstory`, `personality` 로 교체.

- [ ] **Step 3: 검증**

Run: `npm run smoke:mansion`
Expected: 통과. 서버 콘솔에 `[promptStore] 치환되지 않은 변수` 경고가 **없어야** 한다 (남으면 변수명 불일치).

- [ ] **Step 4: Commit**

```bash
git add src/data/mansion.json src/data/prompts/mansion-dialogue.txt src/server/ai/dialogue.js src/server/routes/studio.js src/server/studio.html
git commit -m "feat: 저택 NPC 배경/성격 분리 — 스테이지 1 프롬프트 체계와 통일"
```

---

### Task 11: 조사 오브젝트 — 데이터·서버·판정 연동

**Files:**
- Modify: `src/data/mansion.json` (`objects` 추가)
- Modify: `src/server/mansionSession.js`
- Modify: `src/server/routes/mansion.js` (`/inspect` 신설, talk 에 단서 전달)
- Modify: `src/server/ai/dialogue.js` (`clueBlock` 주입)
- Modify: `scripts/smoke-mansion.js`

**Interfaces:**
- Consumes: Task 8 의 `judgeStance({message, clues})`.
- Produces:
  - `POST /api/mansion/inspect { sessionId, objectId }` → `{ text, state }` (404/409 규약은 기존 라우트와 동일)
  - `toMansionView` 에 `objects: Array<{id, name, col, row, room, found}>` 추가 (**npcId·topic·text 는 내보내지 않는다** — text 는 inspect 응답으로만).
  - `applyStance(session, npc, stance, usedClueId)` — 4번째 인자 추가. ally 이고 해당 단서가 발견됐으며 이 npc 에 아직 안 쓴 경우 `favor += 1` 보너스.

- [ ] **Step 1: mansion.json 에 objects 추가**

`"rewards"` 앞에 추가. **동료 방에만 두면 오브젝트 존재 자체가 동료를 지목한다** — 8인 전원에게 하나씩 둬 유출을 막는다 (civ 오브젝트는 보너스 없이 대화 소재만 된다). 좌표는 관련 NPC 의 방 반대편(스펙 §6).

```json
  "objects": [
    { "id": "obj-ledger",   "name": "배급 장부",        "room": "kitchen", "col": 44, "row": 18, "npcId": "cook",
      "topic": "주방 배급 장부의 숫자가 실제 들어오는 식자재와 다르다",
      "text": "귀퉁이가 닳은 배급 장부. 밀가루 반입량이 지난달의 절반인데, 서명란에는 '이상 없음' 도장이 찍혀 있다." },
    { "id": "obj-uniform",  "name": "얼룩진 제복",      "room": "laundry", "col": 22, "row": 8,  "npcId": "washer",
      "topic": "세탁실에 지워지지 않는 얼룩이 묻은 제복이 걸려 있다",
      "text": "빨랫줄 끝의 제복 소매에 검붉은 얼룩. 몇 번을 빨았는지 천이 해졌지만 얼룩은 그대로다." },
    { "id": "obj-booklist", "name": "치워진 책 목록",   "room": "library", "col": 36, "row": 8,  "npcId": "shelver",
      "topic": "서가에서 치워진 책들의 목록이 몰래 적혀 있다",
      "text": "서가 아래 칸에 끼워진 쪽지. 최근 서재에서 사라진 책 제목들이 빼곡한데, 전부 사람 손으로 쓴 역사책이다." },
    { "id": "obj-silver",   "name": "은식기 재고표",    "room": "dining",  "col": 16, "row": 27, "npcId": "diner",
      "topic": "은식기 재고표에 손님용 식기가 부쩍 늘었다",
      "text": "재고표 끝줄에 '연회용 추가'가 세 번 잇달아 적혀 있다. 요즘 저택에 손님이 잦은 모양이다." },
    { "id": "obj-bucket",   "name": "청소 도구함",      "room": "corr",    "col": 31, "row": 20, "npcId": "cleaner",
      "topic": "복도 청소 순번표에 비어 있는 시간대가 있다",
      "text": "도구함 안쪽에 붙은 순번표. 오후 두 시부터 한 시간, 복도를 아무도 맡지 않는다." },
    { "id": "obj-register", "name": "출입 대장",        "room": "office",  "col": 10, "row": 22, "npcId": "clerk",
      "topic": "출입 대장에 밤늦게 연구실을 드나든 기록이 있다",
      "text": "출입 대장의 최근 장. 자정 넘어 연구실 열람 기록이 사흘 연속 남아 있는데, 서명이 전부 같은 손글씨다." },
    { "id": "obj-planter",  "name": "말라죽은 화분",    "room": "walk",    "col": 43, "row": 30, "npcId": "gardener",
      "topic": "하인 통로의 화분들이 옮겨진 자리만 말라죽었다",
      "text": "통로 끝 화분 세 개가 말라죽어 있다. 옮겨 놓은 지 얼마 안 된 자리다 — 원래 있던 곳에 무엇이 생겼을까." },
    { "id": "obj-portrait", "name": "가문 초상화",      "room": "hall",    "col": 35, "row": 25, "npcId": "butler",
      "topic": "홀 초상화 속 인물이 최근 바뀌어 걸렸다",
      "text": "액자 뒤 벽지만 빛깔이 다르다. 원래 걸려 있던 그림은 더 컸다 — 누군가를 서둘러 내렸다." }
  ],
```

- [ ] **Step 2: mansionSession.js**

`createMansionSession` 인자에 `objects` 추가, 세션에 저장:

```js
export function createMansionSession({ escort, npcs, rewards, objects = [] }) {
  ...
    npcs: npcs.map((n) => ({
      ...,
      /** 이 NPC 에게 이미 써먹은 단서 id — 같은 단서로 반복 파밍하지 못하게 */
      usedClues: [],
      history: [],
    })),
    /** 조사 오브젝트 — found 는 서버가 쥔다 */
    objects: objects.map((o) => ({ ...o, found: false })),
  ...
```

`toMansionView` 반환에 추가 (화이트리스트 — npcId·topic·text 제외):

```js
    objects: session.objects.map((o) => ({
      id: o.id, name: o.name, col: o.col, row: o.row, room: o.room, found: o.found,
    })),
```

`applyStance` 시그니처·본문 수정:

```js
export function applyStance(session, npc, stance, usedClueId = null) {
  // (halted 해제 루프 기존 그대로)

  if (npc.kind === 'ally') {
    if (stance === 'anti') npc.favor += 1;
    else if (stance === 'pro') npc.suspicion += 1;
    // 조사로 얻은 단서를 화제로 꺼내면 호감도 보너스 — 단서당·NPC당 1회 (스펙 §5.3)
    const clue = usedClueId && session.objects.find((o) => o.id === usedClueId);
    if (clue && clue.found && clue.npcId === npc.id && !npc.usedClues.includes(usedClueId)) {
      npc.usedClues.push(usedClueId);
      npc.favor += 1;
    }
  } else if (npc.kind === 'civ') {
    if (stance === 'anti') npc.suspicion += 1;
  }

  // (이하 상한·조각·경고 로직 기존 그대로)
```

- [ ] **Step 3: routes/mansion.js**

`/start` 의 createMansionSession 호출에 `objects: data.objects` 추가. `/inspect` 라우트 신설 (`/document` 위):

```js
/**
 * POST /api/mansion/inspect  { sessionId, objectId }
 * 조사 오브젝트 열람 — 단서 원문을 주고 세션에 발견 표식을 남긴다.
 * 단서 본문(text)은 이 응답으로만 나간다 — /start 뷰에 실으면 조사 전에 다 읽힌다.
 */
router.post('/inspect', (req, res) => {
  const { sessionId, objectId } = req.body ?? {};
  const session = getMansionSession(sessionId);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  if (session.over || session.cleared) return res.status(409).json({ error: '이미 끝난 세션입니다.' });

  const obj = session.objects.find((o) => o.id === objectId);
  if (!obj) return res.status(404).json({ error: '조사할 대상이 없습니다.' });

  obj.found = true;
  res.json({ text: obj.text, state: toMansionView(session) });
});
```

`/talk` 에서 판정·대화에 단서를 물린다 — `judgeStance` 호출(92-95행)을:

```js
  const foundClues = session.objects.filter((o) => o.found).map((o) => ({ id: o.id, topic: o.topic }));
  const stancePromise = judgeStance({ message: text, clues: foundClues }).catch((err) => {
    console.warn('[mansion/stance]', err.message);
    return { stance: 'neutral', reason: '판정 실패', usedClueId: null };
  });
```

`streamMansionReply` 호출에 이 NPC 관련 발견 단서를 넘긴다:

```js
    const npcClue = session.objects.find((o) => o.npcId === npc.id && o.found);
    const reply = await streamMansionReply({
      npc,
      room: npc.room,
      clueTopic: npcClue?.topic ?? null,
      history: npc.history,
      userMessage: text,
      onText: (delta) => send({ type: 'text', text: delta }),
    });
```

applyStance 호출을 4인자로:

```js
    const { stance, reason, usedClueId } = await stancePromise;
    const { event, piece } = applyStance(session, npc, stance, usedClueId);
```

- [ ] **Step 4: dialogue.js — clueBlock**

`streamMansionReply` 파라미터에 `clueTopic = null` 추가, system 변수에 주입:

```js
      clueBlock: clueTopic
        ? `\n[상대가 아는 것]\n상대는 저택을 둘러보다 이런 것을 보았다: ${clueTopic}.\n상대가 그 화제를 꺼내면 너는 뜨끔한다 — 모르는 척하지 말고, 그 얘기에 실제로 반응하라.`
        : '',
```

`mansion-dialogue.txt` 의 `{{kindBlock}}` 다음 줄에 `{{clueBlock}}` 을 추가.

- [ ] **Step 5: 검증 — smoke 확장**

`scripts/smoke-mansion.js` 끝에 (기존 흐름을 깨지 않게 독립 세션·자체 fetch 로) 추가 — 기존 스크립트에 같은 이름의 요청 헬퍼가 있으면 그걸 쓰되, 없으면 아래 그대로:

```js
// ── 조사 오브젝트: inspect → 표식·비유출 검증 ─────────────────────────
{
  const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
  const req = async (path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`${path} → ${res.status} ${data.error ?? ''}`);
    return data;
  };

  const start = await req('/api/mansion/start', {});
  const obj = (start.objects ?? []).find((o) => o.id === 'obj-ledger');
  if (!obj || obj.found !== false) throw new Error('objects 가 뷰에 없거나 found 초기값이 틀렸다');
  if ('topic' in obj || 'npcId' in obj || 'text' in obj) throw new Error('오브젝트 비유출 위반');

  const ins = await req('/api/mansion/inspect', { sessionId: start.sessionId, objectId: 'obj-ledger' });
  if (!ins.text.includes('배급 장부')) throw new Error('inspect 본문 없음');
  if (!ins.state.objects.find((o) => o.id === 'obj-ledger').found) throw new Error('found 미반영');
  console.log('OK inspect — 단서 열람·표식·비유출');
}
```

Run: `npm run smoke:mansion`
Expected: 기존 검증 + `OK inspect` 출력, exit 0.

호감도 보너스는 LLM 경유라 스모크로 단정하기 어렵다 — 수동 확인: `npm run dev` → `?stage2` → 주방 장부 조사(클라이언트는 Task 12 전이므로 콘솔로: `fetch('/api/mansion/inspect', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({sessionId: '<콘솔의 세션id>', objectId: 'obj-ledger'})})`) 후 주방 직원에게 "배급 장부 숫자가 이상하던데요" → 서버 콘솔 로그에 `usedClueId` 반영과 `호감 +2`(anti 판정 시) 또는 `호감 +1`(neutral+단서) 확인.

- [ ] **Step 6: Commit**

```bash
git add src/data/mansion.json src/server/mansionSession.js src/server/routes/mansion.js src/server/ai/dialogue.js scripts/smoke-mansion.js
git commit -m "feat: 저택 조사 오브젝트 — 단서 세션 플래그 + 성향 판정 usedClue 보너스"
```

---

### Task 12: 조사 오브젝트 — 클라이언트

**Files:**
- Modify: `src/client/scenes/MansionScene.js`

**Interfaces:**
- Consumes: `/api/mansion/inspect`, `toMansionView().objects`, InteractionManager `object` 노드, DocumentPanel.

- [ ] **Step 1: 노드 등록 + 조사 연출**

`#start()` 의 `this.#registerLabDoor();` 다음에 `this.#registerObjects();` 추가:

```js
  /** 조사 오브젝트 — [E] 조사 → 단서 열람 (종이 패널). 위치는 서버 뷰가 준다. */
  #registerObjects() {
    for (const obj of this.state.objects ?? []) {
      this.interact.register({
        id: obj.id,
        type: 'object',
        x: obj.col * TILE + TILE / 2,
        y: obj.row * TILE + TILE / 2,
        bubble: '[E] 조사',
        onInteract: () => this.#inspect(obj),
      });
    }
  }

  async #inspect(obj) {
    if (this.inspecting) return;
    this.inspecting = true;
    try {
      const res = await fetch('/api/mansion/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.state.sessionId, objectId: obj.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      this.#syncState(data.state);
      this.docPanel.open({ title: obj.name, body: data.text });
    } catch (err) {
      this.dialogue.show('오류', err.message);
    } finally {
      this.inspecting = false;
    }
  }
```

`init()` 에 `this.inspecting = false;` 추가. `#syncState()` 에 objects 반영 한 줄 추가: `this.state.objects = view.objects;`

- [ ] **Step 2: 검증 — 브라우저**

Run: `http://localhost:5173/?stage2`

확인:
1. 각 방의 오브젝트 자리에서 말풍선 `[E] 조사` → 종이 패널에 단서 본문.
2. 주방 장부 조사 후 주방 직원에게 그 화제를 꺼내면 대사가 실제로 그 얘기에 반응한다.
3. (서버 콘솔) 같은 단서 반복 언급 시 보너스가 두 번 붙지 않는다 (`usedClues` 소진).
4. 오브젝트 좌표가 벽·가구와 겹쳐 접근 불가한 곳이 있으면 해당 `col/row` 를 ±1 조정해 접근 가능한 바닥 칸으로 옮긴다 (mansion-props.json blocked 목록과 겹침 확인).

- [ ] **Step 3: Commit**

```bash
git add src/client/scenes/MansionScene.js src/data/mansion.json
git commit -m "feat: 저택 조사 오브젝트 클라이언트 — 말풍선 조사 + 종이 패널 단서"
```

---

### Task 13: S1 dialogtest 프롬프트 이식 + exp:diff 재측정

**Files:**
- Modify: `src/data/personas.json`
- Modify: `src/data/prompts/wordgen-system.txt`, `src/data/prompts/dialogue-system.txt`
- Modify: `src/server/ai/wordGen.js`, `src/server/ai/dialogue.js` (`streamAllyReply`), `src/server/routes/studio.js`, `src/server/studio.html`

**Interfaces:**
- Produces: `personas.json` allies 스키마 = `{id, name, role, backstory, personality, spawn}` (**id·name·role·spawn 불변** — `ALLY_FRAME`·초상 파일명·map.json 스폰이 id 에 묶여 있다. 브랜치의 개명(에이던·엘라 등)은 **가져오지 않는다**).

- [ ] **Step 1: personas.json — persona 분리**

allies 5인의 `"persona"` 를 다음으로 교체 (브랜치의 "배경=렌즈 / 성격=직접성 다이얼" 구도를 master 인물에 맞춰 작성. maid·engineer 는 직설형, watchmaker·smuggler·musician 은 우회형 — 난이도 편차 2:3):

```json
"watchmaker": {
  "backstory": "54세 남성. 저택 시계탑을 30년 관리해 온 늙은 시계공. 태엽과 톱니를 다루며 귀족들의 물건을 고치는 동안 저택 안팎의 사정이 귀에 쌓였고, 그 위치를 이용해 저항 조직의 정보망 노릇을 한다. 잔해 속에서 찾은 멈춘 회중시계를 늘 품에 지닌다.",
  "personality": "말수가 적고 신중하다. 무엇이든 곧장 말하지 않고 부품과 시간의 흐름에 빗대어 에둘러 말한다 — 힌트도 한 겹 감아서 준다."
},
"maid": {
  "backstory": "18세 여성. 지배 세력 간부 저택의 주방에서 일하는 젊은 하녀. 음식과 살림, 사람들의 습관을 통해 세상을 보고, 저택 내부 사정과 소문에 밝다.",
  "personality": "겁이 많지만 눈치가 빠르고, 마음먹으면 숨기질 못한다 — 떠오른 것을 골라 감출 재주가 없어 가장 먼저 눈에 들어온 것을 그대로 말한다."
},
"engineer": {
  "backstory": "35세 남성. 증기 기관차를 몰던 기관사 출신. 석탄, 압력, 열기, 속도에 익숙하고, 도시의 배관과 선로가 어디로 이어지는지 몸으로 안다.",
  "personality": "거칠고 직설적이며 목소리가 크다. 위험을 대수롭지 않게 여겨 돌려 말하는 법이 없다 — 가장 명백한 것을 그대로 짚는다."
},
"smuggler": {
  "backstory": "28세 남성. 도시 지하수로로 물건을 나르는 밀수꾼. 어둠, 통로, 거래, 뒷골목의 생리를 알고, 단속을 피해 다니는 법이 몸에 배어 있다.",
  "personality": "능글맞고 계산이 빠르며 항상 대가를 따진다. 남들과 겹치는 패는 절대 내지 않는다 — 값이 나가는 건 남이 안 가진 것뿐이라, 힌트도 남이 안 떠올릴 쪽으로 고른다."
},
"musician": {
  "backstory": "34세 남성. 광장에서 손풍금을 켜는 거리 악사. 소리, 리듬, 분위기, 사람들의 감정에 예민하고, 거리의 소문이 노래보다 먼저 그의 귀에 닿는다.",
  "personality": "은유적이고 시적으로 말하며 종종 엉뚱하다. 직설을 촌스럽다 여겨, 떠오른 것을 한 번 비틀어 말한다."
}
```

broker 는 그대로 둔다 (wordGen 미참여).

- [ ] **Step 2: wordgen-system.txt 교체 (전문)**

```
너는 스팀펑크 도시를 배경으로 한 잠입 게임의 등장인물 한 명을 연기한다.

너의 정체:
- 이름: {{name}}
- 직업: {{role}}
- 배경: {{backstory}}
- 성격·특징: {{personality}}

너는 저항 세력의 조직원이다. 동료에게 비밀 접선 코드를 암시해야 하지만,
감시 때문에 코드를 직접 말할 수 없다. 대신 그 코드에서 연상되는 단어 하나만 흘린다.

주어진 접선 코드에서 연상되는 한국어 명사 한 단어를 골라라.

규칙:
1. 먼저 접선 코드 단어 자체가 실제로 연상시키는 사물·부품·현상을 떠올려라
   (예: 코드가 "기관실"이면 증기, 압력, 밸브, 석탄, 배관, 계기판 같은 것들).
   그 중에서 네 배경(직업과 삶의 경험)상 가장 자연스럽게 먼저 눈에 들어오는 것을 골라라.
   코드와 무관하게 네 직업 세계관으로 억지로 번역하지 마라 — 그 단어는 어디까지나
   접선 코드와 실제로 이어지는 것이어야 한다. 배경은 "무엇이 먼저 보이는가"를 바꿀 뿐,
   "무엇과 이어져 있는가"를 바꾸지는 않는다.
2. 접선 코드 단어 자체를 쓰지 마라. 그것을 포함한 합성어도 금지다.
3. 접선 코드의 동의어, 외래어 표기, 번역어도 금지다.
   (예: 코드가 "톱니바퀴"라면 "기어"도 금지. 사실상 같은 사물을 가리키는 단어는 모두 금지)
4. 코드와 다른 사물이되, 그것을 떠올리게 하는 단어여야 한다.
5. 네 성격·특징이 힌트를 얼마나 직접적으로 줄지 정한다.
   직관적이고 솔직한 성격이면 코드에 가장 가깝고 명백한 연상을 골라도 된다.
   반대로 신중하거나, 남들과 겹치는 것을 꺼리거나, 에두르는 성격이면
   조금 더 우회적인(그래도 규칙 1을 벗어나지는 않는) 연상을 골라라.
   다섯 명 모두에게 "너무 노골적이면 안 된다"는 규칙을 똑같이 적용하지 않는다 —
   그 대신 성격에 따라 자연스럽게 갈린다.
6. 다른 동료가 무엇을 쓸지는 신경 쓰지 마라. 너는 그들의 답을 모른다.
   오직 너 자신에게 가장 자연스러운 단어를 골라라.
7. 반드시 명사여야 한다. 형용사("뿌옇다", "축축한")나 동사("돌아가다")는 금지다.
   사물·장소·현상의 이름이어야 한다.
8. 한 단어만. 문장이나 설명은 word 필드에 넣지 마라.
```

- [ ] **Step 3: dialogue-system.txt 수정**

`[너의 정체]` 블록의 `성격·배경: {{persona}}` 를 `배경: {{backstory}}` + `성격·특징: {{personality}}` 두 줄로. `[말투]` 첫 줄을 `너의 성격·특징({{personality}})이 말투와 답변 방식에 그대로 드러나야 한다.` 로 교체. 27행의 "네 경험으로" 를 "네 배경(직업·경험)에 비추어" 로.

- [ ] **Step 4: 서버 변수 전달**

- `wordGen.js` 의 renderPrompt/변수 전달부에서 `persona: ally.persona` → `backstory: ally.backstory, personality: ally.personality` (generateOne 내부 — `wordGen.js:43` 근처의 vars 객체).
- `dialogue.js` `streamAllyReply`(62-66행): `persona: ally.persona` → `backstory: ally.backstory, personality: ally.personality`.
- `streamTutorialReply`(184-195행)도 동일 교체 — 튜토리얼 데이터(`src/data/tutorial.json`)가 `persona` 를 쓰고 있으면 t1~t3 도 두 필드로 분리한다. 분리 규칙(결정적): 기존 persona 문자열에서 **직업·이력을 말하는 문장들 → `backstory`**, **말투·태도를 말하는 문장들 → `personality`** 로 문장 단위로 나눠 옮긴다. 새 문장을 창작하지 않는다 (튜토리얼 인물은 난이도 편차 대상이 아니다).
- `tutorial-dialogue.txt` 의 `{{persona}}` 도 두 줄로 교체.
- 스튜디오 변수 목록: `wordgen-system`·`dialogue-system`·`tutorial-dialogue` 의 `persona` → `backstory`, `personality`.

- [ ] **Step 5: 검증 — 생성 품질 + 중복률 실측**

Run: `npm run poc` (wordgen 1회 생성 — 5인 단어·이유 출력)
Expected: 5개 단어 전부 코드와 연상 관계가 읽히고, maid·engineer 가 상대적으로 직접적인 단어를 내는 경향.

Run: `npm run exp:diff`
Expected: **중복(체포 유발) 발생률이 기존 실측 기준을 크게 넘지 않는다.** 판단 기준: 스크립트가 출력하는 중복률이 이전 기록(스크립트 출력 헤더 또는 `docs/프롬프트튜닝_가이드.md` 의 기준치) 대비 +10%p 이내면 통과. 초과하면 규칙 5의 "직관적이고 솔직한 성격이면" 문장을 "가장 가깝고 명백한 연상 **한두 개 중에서** 골라도 된다" 로 완화하고 재측정한다.

- [ ] **Step 6: Commit**

```bash
git add src/data/personas.json src/data/tutorial.json src/data/prompts/wordgen-system.txt src/data/prompts/dialogue-system.txt src/data/prompts/tutorial-dialogue.txt src/server/ai/wordGen.js src/server/ai/dialogue.js src/server/routes/studio.js src/server/studio.html
git commit -m "feat: dialogtest 프롬프트 이식 — 배경/성격 분리, 성격별 힌트 난이도 편차"
```

---

### Task 14: 아무 동료에게나 정답 제출

**Files:**
- Modify: `src/server/routes/stage.js` (`/guess`)
- Modify: `src/client/scenes/StageScene.js`

**Interfaces:**
- Consumes: Task 5 의 `#offerCode(target)`·`codeTargetId`·choiceNpc 구조.
- Produces: `POST /api/stage/guess { sessionId, targetId, guess }` — targetId 는 접선책 id **또는** 체포되지 않은 동료 id. (`brokerId` 도 당분간 수용 — 이전 클라이언트 호환.)

- [ ] **Step 1: 서버 — 접선책 제한 해제**

`routes/stage.js` `/guess`(307-343행)의 검증부를 교체:

```js
    const { sessionId, targetId, brokerId, guess } = req.body ?? {};
    ...
    // 코드는 접선책 또는 살아 있는 동료 누구에게나 건넬 수 있다 (스펙 §4.2).
    // 임의 문자열로 우회하지 못하게 대상 검증은 유지한다 (/alarm 화이트리스트와 같은 원칙).
    const target = targetId ?? brokerId;
    const validTarget =
      target === session.broker?.id ||
      session.allies.some((a) => a.id === target && !a.arrested);
    if (!validTarget) {
      return res.status(400).json({ error: '코드를 건넬 수 있는 상대가 아닙니다.' });
    }
```

- [ ] **Step 2: 클라이언트 — 동료 선택지에 "암호 말하기" 추가**

`#registerAllyNode()`(Task 5)의 자유 동료 choices 를 3개로:

```js
      choices: [
        { label: '대화하기', key: 'E' },
        { label: '암호 말하기', key: 'F' },
        { label: '그만하기', key: 'Esc' },
      ],
      onChoice: (key) => {
        if (key === 'E') this.#talk(ally);
        else if (key === 'F') this.#offerCode(ally);
        else this.dialogue.hide();
      },
```

`#submitGuess()` 의 body 를 `targetId: this.codeTargetId ?? this.state.broker.id` 로 교체 (`brokerId` 줄 삭제).

- [ ] **Step 3: 검증 — 브라우저**

Run: `http://localhost:5173/?nointro&nopatrol`
1. 아무 동료 [E] → 선택지에 `암호 말하기 [F]` → 오답 제출 → 그 동료가 고개 젓는 연출 + 경계 +1.
2. 백틱으로 정답 확인 후 **동료에게** 정답 제출 → 저택 전환.
3. DevTools 로 체포된 동료 id 를 targetId 로 직접 POST → 400 확인:
```js
fetch('/api/stage/guess', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({sessionId:'<id>', targetId:'<체포된 id>', guess:'x'})}).then(r=>console.log(r.status)) // 400
```

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/stage.js src/client/scenes/StageScene.js
git commit -m "feat: 접선 코드를 아무 동료에게나 제출 가능하게"
```

---

### Task 15: S1 동료 은신 배치 + 안전 검증 스크립트

**Files:**
- Create: `scripts/check-spawn-safety.js`
- Modify: `src/client/assets/map.json` (`spawns.allies` 좌표)

**Interfaces:**
- Consumes: `PATROL_ROUTES`(Patrol.js — avenue x=19열, crossing y=15행, wharf y=31행 24~52열, reinforce x=39열), 감지 반경 최대 228px (150 + 26×3).

- [ ] **Step 1: 검증 스크립트**

```js
/**
 * 동료 스폰 안전 검사 — 스폰 지점이 (1) 걸을 수 있는 바닥이고
 * (2) 모든 순찰 경로 선분에서 최대 감지 반경(228px)+여유 밖인지 확인한다.
 * 불합격이면 해당 지점 주변에서 조건을 만족하는 가장 가까운 칸을 제안한다.
 *
 * Patrol.js 의 경로를 import 하지 않는 이유: Phaser 의존이라 노드에서 안 돈다.
 * 좌표를 여기 복사해 두고, Patrol.js 를 고치면 여기도 고친다 (파일 상단 주석 계약).
 */
import { readFile } from 'node:fs/promises';

const TILE = 32;
const RADIUS_MAX = 150 + 26 * 3; // Patrol.js RADIUS_BASE + PER_LEVEL * MAX_LEVEL
const MARGIN = 16;
const at = (col, row) => ({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 });
// Patrol.js PATROL_ROUTES 사본
const ROUTES = [
  [at(19, 6), at(19, 42)],
  [at(6, 15), at(54, 15)],
  [at(52, 31), at(24, 31)],
  [at(39, 8), at(39, 40)],
];

const map = JSON.parse(await readFile(new URL('../src/client/assets/map.json', import.meta.url), 'utf8'));
const props = JSON.parse(await readFile(new URL('../src/client/assets/street-props.json', import.meta.url), 'utf8'));
const blocked = new Set((props.blocked ?? []).map(([c, r]) => `${c},${r}`));

const walkable = (c, r) =>
  r >= 0 && r < map.rows && c >= 0 && c < map.cols &&
  map.layout[r][c] >= 0 && !map.tiles[map.layout[r][c]].solid && !blocked.has(`${c},${r}`);

const distToSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
const safe = (c, r) => {
  const p = at(c, r);
  return ROUTES.every(([a, b]) => distToSeg(p, a, b) > RADIUS_MAX + MARGIN);
};

let fail = 0;
for (const s of map.spawns.allies) {
  const ok = walkable(s.col, s.row) && safe(s.col, s.row);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${s.id} (${s.col},${s.row})`);
  if (ok) continue;
  fail += 1;
  // 나선형으로 주변에서 대안 탐색
  outer: for (let radius = 1; radius <= 8; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
        const c = s.col + dc, r = s.row + dr;
        if (walkable(c, r) && safe(c, r)) {
          console.log(`      → 제안: (${c},${r})`);
          break outer;
        }
      }
    }
  }
}
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 현재 좌표 검사 → 좌표 이동**

Run: `node scripts/check-spawn-safety.js`
Expected(현재 좌표 기준 예상): `watchmaker (51,27)` 은 wharf 경로(y=31행)와 128px 로 **FAIL**, `engineer (46,11)` 은 crossing(15행)과 128px 로 **FAIL** 가능성이 높다. 스크립트의 `→ 제안` 좌표(사각지대의 가장 가까운 바닥 칸)로 `map.json` 의 `spawns.allies` 해당 항목 `col/row` 를 교체한다. 전원 `OK` 가 될 때까지 반복.

이동 원칙 (스펙 §6, 기획자와 논의할 제안): 제안 좌표 중에서도 **건물 뒤·골목 안쪽**(주변 3면 중 2면 이상이 solid) 쪽을 우선한다 — 순찰 축에서 물러나 "숨어 있다"로 읽히는 자리. 시각적 확인은 다음 스텝.

- [ ] **Step 3: 검증 — 스크립트 + 브라우저**

Run: `node scripts/check-spawn-safety.js`
Expected: 5인 전원 `OK`, exit 0.

Run: `http://localhost:5173/?nointro` (순찰 켜고)
확인: 각 동료 자리까지 걸어가 보되, (1) 동료 옆에 서 있는 동안 순찰이 감지하지 않고, (2) 동료에게 가려면 순찰 축을 최소 한 번 가로질러야 한다. 두 조건이 모두 성립하지 않는 배치는 인접 제안 좌표로 재조정.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-spawn-safety.js src/client/assets/map.json
git commit -m "feat: 동료 스폰을 순찰 사각지대로 이동 + 안전 검증 스크립트"
```

---

### Task 16: 통합 회귀

**Files:** 없음 (검증 전용 — 발견된 문제는 해당 태스크 파일에서 고치고 `fix:` 커밋)

- [ ] **Step 1: 자동 검증 일괄**

```bash
npm run smoke              # 스테이지 1 SSE 대화
npm run smoke:tutorial
npm run smoke:mansion      # + Task 11 의 inspect 검증
node scripts/poc-stance.js
node scripts/check-spawn-safety.js
npm run exp:diff           # 중복률이 Task 13 Step 5 기준 이내인지 재확인
```

Expected: 전부 exit 0.

- [ ] **Step 2: 수동 통측 (풀런 1회)**

`http://localhost:5173/` 에서 오프닝부터: 튜토리얼 클리어 → 거리(접선→수첩→검문 1회 이상→동료에게 정답 제출) → 저택(오브젝트 2개 조사→단서 화제로 호감도→조각 3→문 열기→문서 패널→클리어). 중간에 [Esc] 응답 취소·창 리사이즈·재시작(결과 화면의 "다시 잠입한다")도 한 번씩 섞는다.

- [ ] **Step 3: 마무리 커밋 (잔여 수정이 있으면)**

```bash
git add -A && git commit -m "fix: 스테이지 개선 통합 회귀에서 발견된 문제 정리"
```

---

## Self-Review 결과 반영 메모

- 스펙 §3 "대화창 v2" ↔ Task 1·2, §2 표 ↔ Task 3, §4.1 ↔ Task 13, §4.2 ↔ Task 14, §4.3 ↔ Task 15, §5.1 ↔ Task 8·9, §5.2 ↔ Task 10, §5.3 ↔ Task 11·12, §5.4 ↔ Task 6·7, §7 검증 ↔ 각 태스크 + Task 16. 스펙 §4.4(구제책 미도입)는 작업 없음 — 계획서에 기록만 남긴다 (이 문단이 그 기록이다).
- [F] 접선의 통합(첫 대화 = 자동 접선)은 스펙 §2·§4.2 의 키 배치를 동시에 만족시키기 위한 구현 결정이다 — Global Constraints 에 명시했고, 기획자 확인이 필요하면 Task 5 착수 전에 물어본다.
