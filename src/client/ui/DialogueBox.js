/**
 * DOM 오버레이 대화창.
 *
 * Phaser 캔버스 텍스트가 아니라 DOM 을 쓰는 이유:
 *  - 한글 IME 입력이 정상 동작한다 (자유 대화·접선 코드 입력에 필수)
 *  - LLM 스트리밍 응답을 델타 단위로 붙이기 쉽다
 */
export class DialogueBox {
  constructor() {
    this.root = document.getElementById('dialogue');
    this.speakerEl = document.getElementById('dialogue-speaker');
    this.textEl = document.getElementById('dialogue-text');
    this.inputWrap = document.getElementById('dialogue-input');
    this.field = document.getElementById('dialogue-field');
    this.sendBtn = document.getElementById('dialogue-send');
    this.codeBtn = document.getElementById('dialogue-code');
    this.hintEl = document.getElementById('dialogue-hint');
    this.portraitEl = document.getElementById('dialogue-portrait');
    this.choicesEl = document.getElementById('dialogue-choices');

    /** 자유 대화 전송 */
    this.onSend = null;
    /** 접선 코드 전달 */
    this.onCode = null;
    /** 입력창 Enter 가 무엇을 하는지: 'chat'(대화) | 'code'(코드 전달) */
    this.inputMode = 'chat';

    this.sendBtn.addEventListener('click', () => this.#fire(this.onSend));
    this.codeBtn.addEventListener('click', () => this.#fire(this.onCode));

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

  #fire(handler) {
    const value = this.field.value.trim();
    if (!value || !handler || this.busy) return;
    this.field.value = '';
    handler(value);
  }

  /** 응답 대기 중 입력 잠금 — 중복 전송 방지 */
  setBusy(busy) {
    this.busy = busy;
    this.field.disabled = busy;
    this.sendBtn.disabled = busy;
    this.codeBtn.disabled = busy;
    if (!busy) this.field.focus();
  }

  /** portraitUrl 을 주면 대화창 옆에 초상화를 띄운다 (없으면 이전 초상화를 지운다). */
  show(speaker, text, portraitUrl) {
    this.speakerEl.textContent = speaker;
    this.textEl.textContent = text;
    this.#setPortrait(portraitUrl);
    this.#clearChoices();
    this.root.classList.add('visible');
  }

  /** 스트리밍 시작 — 화자만 세우고 본문을 비운다 */
  beginStream(speaker, portraitUrl) {
    this.speakerEl.textContent = speaker;
    this.textEl.textContent = '';
    this.#setPortrait(portraitUrl);
    this.#clearChoices();
    this.root.classList.add('visible');
  }

  /**
   * 선택지 메뉴 — 접선 코드처럼 갈래가 있는 NPC 대화에서, E 로 곧장 자유대화로
   * 들어가는 대신 먼저 무엇을 할지 버튼으로 고르게 한다.
   * choices: [{ label, onSelect }]
   */
  showChoices(speaker, text, choices, portraitUrl) {
    this.speakerEl.textContent = speaker;
    this.textEl.textContent = text;
    this.#setPortrait(portraitUrl);
    this.hideInput();

    this.choicesEl.innerHTML = '';
    for (const { label, onSelect } of choices) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        this.#clearChoices();
        onSelect();
      });
      this.choicesEl.appendChild(btn);
    }
    this.choicesEl.classList.add('visible');
    this.root.classList.add('visible');
  }

  #clearChoices() {
    this.choicesEl.classList.remove('visible');
    this.choicesEl.innerHTML = '';
  }

  #setPortrait(url) {
    if (!this.portraitEl) return;
    if (url) {
      this.portraitEl.src = url;
      this.portraitEl.style.display = 'block';
    } else {
      this.portraitEl.removeAttribute('src');
      this.portraitEl.style.display = 'none';
    }
  }

  /** 스트리밍 델타 append */
  append(chunk) {
    this.textEl.textContent += chunk;
  }

  showInput(placeholder = '말을 건넨다...', mode = 'chat') {
    this.#clearChoices();
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
    this.field.blur();
  }

  setHint(text) {
    this.hintEl.textContent = text;
  }

  hide() {
    this.root.classList.remove('visible');
    this.hideInput();
    this.#clearChoices();
    // 컷인 초상화는 이제 대화창 밖(게임 화면 위)에 떠 있는 별도 엘리먼트라
    // #dialogue 를 숨긴다고 같이 사라지지 않는다 — 명시적으로 지운다.
    this.#setPortrait(null);
  }

  get isOpen() {
    return this.root.classList.contains('visible');
  }

  get isTyping() {
    return document.activeElement === this.field;
  }
}
