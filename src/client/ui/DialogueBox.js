/**
 * DOM 오버레이 대화창.
 *
 * Phaser 캔버스 텍스트가 아니라 DOM 을 쓰는 이유:
 *  - 한글 IME 입력이 정상 동작한다 (접선 코드 자유 입력에 필수)
 *  - 다음 단계의 LLM 스트리밍 응답을 타자 효과로 붙이기 쉽다
 */
export class DialogueBox {
  constructor() {
    this.root = document.getElementById('dialogue');
    this.speakerEl = document.getElementById('dialogue-speaker');
    this.textEl = document.getElementById('dialogue-text');
    this.inputWrap = document.getElementById('dialogue-input');
    this.field = document.getElementById('dialogue-field');
    this.submitBtn = document.getElementById('dialogue-submit');

    this.onSubmit = null;

    this.submitBtn.addEventListener('click', () => this.#submit());
    this.field.addEventListener('keydown', (e) => {
      // IME 조합 중 Enter 는 무시해야 한글 입력이 끊기지 않는다.
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        this.#submit();
      }
      e.stopPropagation(); // Phaser 키 입력과 충돌 방지
    });
  }

  #submit() {
    const value = this.field.value.trim();
    if (!value || !this.onSubmit) return;
    this.field.value = '';
    this.onSubmit(value);
  }

  show(speaker, text) {
    this.speakerEl.textContent = speaker;
    this.textEl.textContent = text;
    this.root.classList.add('visible');
  }

  /** 스트리밍 응답용 — 다음 단계에서 사용 */
  append(chunk) {
    this.textEl.textContent += chunk;
  }

  showInput(placeholder = '접선 코드를 입력...') {
    this.field.placeholder = placeholder;
    this.inputWrap.classList.add('visible');
    this.field.focus();
  }

  hideInput() {
    this.inputWrap.classList.remove('visible');
    this.field.blur();
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
