import { playSfx } from '../audio/SoundManager.js';

/**
 * DOM 오버레이 대화창.
 *
 * Phaser 캔버스 텍스트가 아니라 DOM 을 쓰는 이유:
 *  - 한글 IME 입력이 정상 동작한다 (자유 대화·접선 코드 입력에 필수)
 *  - LLM 스트리밍 응답을 델타 단위로 붙이기 쉽다
 */
let instance = null;

export class DialogueBox {
  /** 이미 받아 둔 초상 id — 같은 그림을 두 번 내려받지 않는다. */
  #preloaded = new Set();

  constructor() {
    // 싱글턴 — scene.restart 로 create() 가 다시 돌 때마다 새 인스턴스를 만들면
    // 같은 DOM 노드에 keydown/click 리스너가 겹겹이 쌓여, 재시작 후에는 Enter 한 번에
    // 전송이 여러 번 걸린다. 두 번째부터는 상태만 초기화하고 기존 객체를 돌려준다.
    if (instance) {
      instance.#reset();
      return instance;
    }
    instance = this;

    this.root = document.getElementById('dialogue');
    this.portraitEl = document.getElementById('dialogue-portrait');
    this.speakerEl = document.getElementById('dialogue-speaker');
    this.textEl = document.getElementById('dialogue-text');
    this.inputWrap = document.getElementById('dialogue-input');
    this.field = document.getElementById('dialogue-field');
    this.sendBtn = document.getElementById('dialogue-send');
    this.codeBtn = document.getElementById('dialogue-code');
    this.closeBtn = document.getElementById('dialogue-close');
    this.hintEl = document.getElementById('dialogue-hint');
    this.moreEl = document.getElementById('dialogue-more');
    this.measureEl = document.getElementById('dialogue-measure');
    this.choicesEl = document.getElementById('dialogue-choices');

    /** 자유 대화 전송 */
    this.onSend = null;
    /** 접선 코드 전달 */
    this.onCode = null;
    /**
     * 대화 모드에서 "접선(암호) 창으로 넘어가겠다"는 요청 (StageScene 동료 대화 전용).
     * 세운 씬에서만 대화 모드에 코드 버튼이 보이고, 빈 입력칸의 [F] 도 이리로 온다.
     */
    this.onCodeRequest = null;
    /** 입력창 Enter 가 무엇을 하는지: 'chat'(대화) | 'code'(코드 전달) */
    this.inputMode = 'chat';
    /**
     * 응답을 기다리는 사이 플레이어가 창을 닫았는가.
     *
     * 닫아 놓고 기다렸는데 응답이 도착하면서 창이 도로 열리면, 플레이어 입장에서는
     * 닫은 것이 무시된 것으로 보인다. 그 표식을 여기 남기고 reply() 가 참고한다.
     */
    this.dismissed = false;

    /** 페이징 상태 — 현재 대사의 페이지 배열과 커서 */
    this.pages = [];
    this.pageIdx = 0;
    /** 마지막 페이지를 넘겼을 때 부를 콜백 (없으면 hide) — 선택지 복귀용 */
    this.onPagesDone = null;
    /** 스트리밍 버퍼 — append 는 여기에만 쌓고 endStream 이 페이징한다 */
    this.streamBuf = '';
    /** 선택지 콜백 */
    this.onChoice = null;

    this.sendBtn.addEventListener('click', () => this.#fire(this.onSend));
    // 코드 버튼은 두 몫이다 — 코드 입력 모드에서는 쓴 것을 제출하고, 대화 모드에서는
    // (onCodeRequest 를 세운 곳에서만 보인다) 접선 창으로 넘어간다.
    this.codeBtn.addEventListener('click', () => {
      if (this.inputMode === 'chat' && this.onCodeRequest) this.onCodeRequest();
      else this.#fire(this.onCode);
    });
    // Esc 와 같은 일을 한다 — busy 중이면 hide() 가 dismissed 표식을 남긴다.
    this.closeBtn.addEventListener('click', () => this.hide());

    // 그림은 도착해야 나타난다(portrait-ready). 자리는 그 전에 이미 잡혀 있다 — 아래
    // #setPortrait 참고. 파일이 없으면 no-portrait 로 떨어져 패널이 왼쪽으로 넓어진다
    // (좁게 나눠 둔 페이지가 넓은 칸에 들어가는 방향이라 잘릴 일이 없다).
    this.portraitEl.addEventListener('load', () => this.root.classList.add('portrait-ready'));
    this.portraitEl.addEventListener('error', () => {
      this.root.classList.remove('portrait-ready');
      this.root.classList.add('no-portrait');
    });

    this.field.addEventListener('keydown', (e) => {
      // 입력칸이 포커스된 동안에는 stopPropagation 때문에 Phaser 가 키를 못 받는다.
      // 그래서 Esc 닫기는 여기서 직접 처리한다 (입력 중 취소).
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        return;
      }
      // 대화 모드의 **빈** 입력칸에서 [F] — 접선(암호) 창으로 전환한다 (onCodeRequest
      // 를 세운 씬에서만). 쓰던 글이 있으면 글자로 둔다. 한글 IME 로 같은 물리 키(ㄹ)를
      // 칠 때는 key 가 'Process' 로 오므로 여기 안 걸린다 — "로봇은…" 같은 첫 글자를
      // 삼키지 않는다.
      if (
        (e.key === 'f' || e.key === 'F') &&
        !e.isComposing &&
        !this.field.value &&
        this.inputMode === 'chat' &&
        this.onCodeRequest
      ) {
        e.preventDefault();
        e.stopPropagation();
        this.onCodeRequest();
        return;
      }
      // IME 조합 중 Enter 는 무시해야 한글 입력이 중간에 끊기지 않는다.
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        // 코드 모드면 Enter 가 접선 코드 전달, 아니면 자유 대화.
        this.#fire(this.inputMode === 'code' ? this.onCode : this.onSend);
      }
      e.stopPropagation(); // Phaser 키 입력(이동)과 충돌 방지
    });
  }

  /** 재시작 시 이전 판의 잔재(열린 창·잠긴 입력·묵은 핸들러)를 털어낸다. */
  #reset() {
    this.onSend = null;
    this.onCode = null;
    this.onCodeRequest = null;
    this.inputMode = 'chat';
    this.dismissed = false;
    this.busy = false;
    this.field.value = '';
    this.field.disabled = false;
    this.sendBtn.disabled = false;
    this.codeBtn.disabled = false;
    this.root.classList.add('no-portrait');
    this.root.classList.remove('portrait-ready');
    this.pages = [];
    this.pageIdx = 0;
    this.onPagesDone = null;
    this.streamBuf = '';
    this.textEl.classList.remove('thinking');
    this.moreEl.classList.remove('visible');
    this.onChoice = null;
    this.hideChoices();
    this.hide();
  }

  #fire(handler) {
    const value = this.field.value.trim();
    if (!value || !handler || this.busy) return;
    this.field.value = '';
    handler(value);
  }

  /**
   * 화자 초상 교체. id 는 페르소나 id(watchmaker·fixer·t1 …)이고
   * `public/portraits/<id>.png` 를 가리킨다.
   *
   * 자리(패널 폭)는 그림이 도착하기 전에, id 가 있다는 것만 보고 잡는다. load 를
   * 기다렸다가 좁히면 이미 넓은 폭 기준으로 잘라 둔 페이지가 좁은 칸에서 3줄이 되고,
   * 본문은 2줄 고정 높이라 마지막 줄이 소리 없이 잘린다. 파일이 없는 인물은 error 가
   * 도로 넓혀 준다 — 좁게 나눈 글이 넓어지는 방향은 안전하다.
   */
  #setPortrait(id) {
    if (!id) {
      this.root.classList.add('no-portrait');
      this.root.classList.remove('portrait-ready');
      return;
    }
    const src = `/portraits/${id}.png`;
    // src 를 지우지 않고 남겨 둔다 — 시스템 대사를 사이에 끼고 같은 인물이 이어
    // 말할 때 다시 내려받지 않기 위해서다.
    if (this.portraitEl.getAttribute('src') === src) {
      const failed = this.portraitEl.complete && this.portraitEl.naturalWidth === 0;
      this.root.classList.toggle('no-portrait', failed);
      this.root.classList.toggle('portrait-ready', !failed && this.portraitEl.complete);
      return;
    }
    this.root.classList.remove('no-portrait');
    this.root.classList.remove('portrait-ready');
    this.portraitEl.setAttribute('src', src);
  }

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
    // 응답 대기("…") 중의 [Space]는 페이지 넘김이 아니다 — 여기서 hide 로 흐르면
    // busy 규약이 dismissed 를 세워 도착할 응답이 통째로 버려진다. Esc(명시적 취소)만 남긴다.
    if (this.busy) return true;
    if (this.hasMore) {
      playSfx('textNext');
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

  /**
   * 곧 쓸 초상을 미리 받아 둔다. 첫 대사에서 그림이 늦게 붙어 판이 한 번
   * 덜컹이는 것을 막는다 — 실제 일러스트는 장당 1MB 에 가깝다.
   */
  preload(ids) {
    for (const id of ids) {
      if (!id || this.#preloaded.has(id)) continue;
      this.#preloaded.add(id);
      new Image().src = `/portraits/${id}.png`;
    }
  }

  /** 응답 대기 중 입력 잠금 — 중복 전송 방지 */
  setBusy(busy) {
    this.busy = busy;
    this.field.disabled = busy;
    this.sendBtn.disabled = busy;
    this.codeBtn.disabled = busy;
    if (!busy) this.field.focus();
  }

  /**
   * 플레이어의 행동으로 여는 창 — 언제나 뜬다.
   *
   * 초상은 화자 문자열에서 역으로 알아내지 않고 `opts.portrait` 로 받는다.
   * 표시 이름은 `이름 (역할)` 처럼 조합되는 데다 튜토리얼과 스테이지의 이름이
   * 겹칠 수 있어서, 문자열을 되짚는 방식은 조용히 어긋난다.
   *
   * @param {{portrait?: string}} [opts] portrait = 페르소나 id
   */
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

  /**
   * 요청의 결과로 여는 창 — 기다리는 사이 플레이어가 닫았다면 뜨지 않는다.
   *
   * show() 와 갈라놓는 이유: 이건 플레이어가 무언가를 누른 순간이 아니라 응답이
   * 도착한 순간에 불린다. 그 사이에 [Esc] 로 창을 접었다면 그 의사를 존중해야 한다.
   *
   * @returns {boolean} 실제로 띄웠는가
   */
  reply(speaker, text, hint = '', opts = {}) {
    if (this.dismissed) return false;
    this.show(speaker, text, opts);
    this.setHint(hint);
    return true;
  }

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
    playSfx('textNext');
    this.onPagesDone = opts.onPagesDone ?? null;
    this.pages = this.#paginate(full);
    this.pageIdx = 0;
    this.#renderPage();
    this.setHint(hint);
    return full;
  }

  showInput(placeholder = '말을 건넨다...', mode = 'chat') {
    // 모드가 갈리면 쓰다 만 글은 버린다 — 대화하다 접선 창으로 넘어갔는데 입력칸에
    // 대화 문장이 남아 있으면 그게 코드로 나가는 사고가 된다.
    if (mode !== this.inputMode) this.field.value = '';
    this.inputMode = mode;
    this.field.placeholder = placeholder;
    // 대화(E)와 접선 코드 제출(F)을 구분한다 — 모드에 맞는 버튼만 보인다.
    // 대화 모드라도 접선으로 넘어갈 길(onCodeRequest)이 있으면 코드 버튼을 세운다.
    this.sendBtn.style.display = mode === 'code' ? 'none' : '';
    this.codeBtn.style.display = mode === 'code' || this.onCodeRequest ? '' : 'none';
    this.inputWrap.classList.add('visible');
    this.field.focus();
  }

  hideInput() {
    this.inputWrap.classList.remove('visible');
    // 두 버튼은 입력창 바깥(패널 위 버튼 줄)에 있다 — 같이 접지 않으면 대화 중이
    // 아닐 때도 남아 누를 수 있는 것처럼 보인다. [닫기]는 그 줄에 그대로 남는다.
    this.sendBtn.style.display = 'none';
    this.codeBtn.style.display = 'none';
    // 접선 전환 훅은 입력창의 수명과 같다 — 남겨 두면 다른 씬의 대화 입력칸에서
    // [F] 가 죽은 씬의 접선 창을 연다 (DialogueBox 는 씬을 넘나드는 싱글턴이다).
    this.onCodeRequest = null;
    this.field.blur();
  }

  /**
   * 선택지 버튼 (최대 3개) — 패널 위 버튼 줄의 맨 앞에 선다. 키 라벨은 표시용이다.
   * 실제 키 입력은 씬이 처리하고 여기서는 클릭만 onChoice(key) 로 중계한다.
   * 같은 행동에 대해 키와 클릭이 같은 콜백으로 모이게 하는 것이 규약이다.
   */
  showChoices(choices) {
    // [그만하기]처럼 Esc 를 맡은 선택지가 있으면 [닫기]는 접는다 — 한 줄에 나란히
    // 서면 같은 키로 같은 일을 하는 버튼이 둘이 되어 어느 쪽이 진짜인지 헷갈린다.
    this.closeBtn.style.display = choices.some((c) => c.key === 'Esc') ? 'none' : '';
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
    this.closeBtn.style.display = ''; // 선택지가 가져갔던 [닫기] 자리를 돌려준다
    this.onChoice = null;
  }

  setHint(text) {
    this.hintEl.textContent = text;
  }

  hide() {
    // 응답을 기다리는 중에 닫았다면, 그 응답이 도착해도 창을 도로 열지 않는다.
    if (this.busy) this.dismissed = true;
    this.root.classList.remove('visible');
    this.moreEl.classList.remove('visible');
    this.textEl.classList.remove('thinking');
    this.onPagesDone = null;
    this.hideInput();
    this.hideChoices();
  }

  get isOpen() {
    return this.root.classList.contains('visible');
  }

  get isTyping() {
    return document.activeElement === this.field;
  }
}
