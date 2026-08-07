import { playSfx } from '../audio/SoundManager.js';

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
    playSfx('close');
    this.titleEl.textContent = title;
    this.bodyEl.textContent = body;
    this.onClose = onClose;
    this.root.classList.add('visible');
  }

  close() {
    if (!this.isOpen) return;
    playSfx('close');
    this.root.classList.remove('visible');
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  get isOpen() {
    return this.root.classList.contains('visible');
  }
}
