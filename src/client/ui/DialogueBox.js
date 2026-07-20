/**
 * DOM 오버레이 대화창.
 *
 * Phaser 캔버스 텍스트가 아니라 DOM 을 쓰는 이유:
 *  - 한글 IME 입력이 정상 동작한다 (자유 대화·접선 코드 입력에 필수)
 *  - LLM 스트리밍 응답을 델타 단위로 붙이기 쉽다
 */
let instance = null;

export class DialogueBox {
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

  /** 재시작 시 이전 판의 잔재(열린 창·잠긴 입력·묵은 핸들러)를 털어낸다. */
  #reset() {
    this.onSend = null;
    this.onCode = null;
    this.inputMode = 'chat';
    this.busy = false;
    this.field.value = '';
    this.field.disabled = false;
    this.sendBtn.disabled = false;
    this.codeBtn.disabled = false;
    this.hide();
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
