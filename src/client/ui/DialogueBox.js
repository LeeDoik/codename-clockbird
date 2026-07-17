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

    /** 자유 대화 전송 */
    this.onSend = null;
    /** 접선 코드 전달 */
    this.onCode = null;

    this.sendBtn.addEventListener('click', () => this.#fire(this.onSend));
    this.codeBtn.addEventListener('click', () => this.#fire(this.onCode));

    this.field.addEventListener('keydown', (e) => {
      // IME 조합 중 Enter 는 무시해야 한글 입력이 중간에 끊기지 않는다.
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        this.#fire(this.onSend);
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

  show(speaker, text) {
    this.speakerEl.textContent = speaker;
    this.textEl.textContent = text;
    this.root.classList.add('visible');
  }

  /** 스트리밍 시작 — 화자만 세우고 본문을 비운다 */
  beginStream(speaker) {
    this.speakerEl.textContent = speaker;
    this.textEl.textContent = '';
    this.root.classList.add('visible');
  }

  /** 스트리밍 델타 append */
  append(chunk) {
    this.textEl.textContent += chunk;
  }

  showInput(placeholder = '말을 건넨다...') {
    this.field.placeholder = placeholder;
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
  }

  get isOpen() {
    return this.root.classList.contains('visible');
  }

  get isTyping() {
    return document.activeElement === this.field;
  }
}
