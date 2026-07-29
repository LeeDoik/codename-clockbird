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

    /** 자유 대화 전송 */
    this.onSend = null;
    /** 접선 코드 전달 */
    this.onCode = null;
    /** 입력창 Enter 가 무엇을 하는지: 'chat'(대화) | 'code'(코드 전달) */
    this.inputMode = 'chat';
    /**
     * 응답을 기다리는 사이 플레이어가 창을 닫았는가.
     *
     * 닫아 놓고 기다렸는데 응답이 도착하면서 창이 도로 열리면, 플레이어 입장에서는
     * 닫은 것이 무시된 것으로 보인다. 그 표식을 여기 남기고 reply() 가 참고한다.
     */
    this.dismissed = false;

    this.sendBtn.addEventListener('click', () => this.#fire(this.onSend));
    this.codeBtn.addEventListener('click', () => this.#fire(this.onCode));
    // Esc 와 같은 일을 한다 — busy 중이면 hide() 가 dismissed 표식을 남긴다.
    this.closeBtn.addEventListener('click', () => this.hide());

    // 그림이 실제로 도착해야 자리를 내준다. 파일이 없으면 no-portrait 로 남아
    // 본문이 패널 전체를 쓴다 — 초상 없이도 대화는 성립해야 한다.
    this.portraitEl.addEventListener('load', () => this.root.classList.remove('no-portrait'));
    this.portraitEl.addEventListener('error', () => this.root.classList.add('no-portrait'));

    this.field.addEventListener('keydown', (e) => {
      // 입력칸이 포커스된 동안에는 stopPropagation 때문에 Phaser 가 키를 못 받는다.
      // 그래서 Esc 닫기는 여기서 직접 처리한다 (입력 중 취소).
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
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
    this.inputMode = 'chat';
    this.dismissed = false;
    this.busy = false;
    this.field.value = '';
    this.field.disabled = false;
    this.sendBtn.disabled = false;
    this.codeBtn.disabled = false;
    this.root.classList.add('no-portrait');
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
   * id 가 없는 화자(시스템 안내·오류)와 파일이 아직 없는 인물은 둘 다 no-portrait 로
   * 떨어진다. 성공한 load 만 자리를 내주므로, 그림이 없는 채로 배포해도 깨지지 않는다.
   */
  #setPortrait(id) {
    if (!id) {
      this.root.classList.add('no-portrait');
      return;
    }
    const src = `/portraits/${id}.png`;
    // src 를 지우지 않고 남겨 둔다 — 시스템 대사를 사이에 끼고 같은 인물이 이어
    // 말할 때 다시 내려받지 않기 위해서다.
    if (this.portraitEl.getAttribute('src') === src) {
      if (this.portraitEl.complete && this.portraitEl.naturalWidth > 0) {
        this.root.classList.remove('no-portrait');
      }
      return;
    }
    this.root.classList.add('no-portrait');
    this.portraitEl.setAttribute('src', src);
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
    this.textEl.textContent = text;
    this.root.classList.add('visible');
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

  /** 스트리밍 시작 — 화자만 세우고 본문을 비운다 */
  beginStream(speaker, opts = {}) {
    this.dismissed = false;
    this.#setPortrait(opts.portrait);
    this.speakerEl.textContent = speaker;
    this.textEl.textContent = '';
    this.root.classList.add('visible');
  }

  /** 스트리밍 델타 append */
  append(chunk) {
    this.textEl.textContent += chunk;
  }

  showInput(placeholder = '말을 건넨다...', mode = 'chat') {
    this.inputMode = mode;
    this.field.placeholder = placeholder;
    // 대화(E)와 접선 코드 제출(F)을 구분한다 — 모드에 맞는 버튼만 보인다.
    this.sendBtn.style.display = mode === 'code' ? 'none' : '';
    this.codeBtn.style.display = mode === 'code' ? '' : 'none';
    this.inputWrap.classList.add('visible');
    this.field.focus();
  }

  hideInput() {
    this.inputWrap.classList.remove('visible');
    // 두 버튼은 입력창 바깥(#dialogue-actions)에 있다 — 같이 접지 않으면
    // 대화 중이 아닐 때도 남아 누를 수 있는 것처럼 보인다. [닫기]만 늘 남는다.
    this.sendBtn.style.display = 'none';
    this.codeBtn.style.display = 'none';
    this.field.blur();
  }

  setHint(text) {
    this.hintEl.textContent = text;
  }

  hide() {
    // 응답을 기다리는 중에 닫았다면, 그 응답이 도착해도 창을 도로 열지 않는다.
    if (this.busy) this.dismissed = true;
    this.root.classList.remove('visible');
    this.hideInput();
  }

  get isOpen() {
    return this.root.classList.contains('visible');
  }

  get isTyping() {
    return document.activeElement === this.field;
  }
}
