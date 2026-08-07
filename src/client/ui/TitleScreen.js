import { playSfx } from '../audio/SoundManager.js';

/**
 * 타이틀 화면 — index.html 의 #title 과 짝.
 *
 * 클로드 디자인의 「태엽새 타이틀 화면.dc.html」을 그대로 옮긴 것이다. 씬(Phaser)이
 * 아니라 DOM 인 이유는 대화창·HUD 와 같다: 획이 가는 글자는 캔버스의 NEAREST 확대에서
 * 깨지고, 디자인의 주사선·비네트·베벨도 전부 CSS 그라디언트 원본이라 DOM 이면 옮겨
 * 그릴 것이 없다. 치수는 index.html 쪽 주석 참고 — 디자인 파일의 px 와 1:1 이다.
 *
 * 이 클래스는 그리기와 입력만 맡는다. 고른 것이 어디로 가는지는 씬(TitleScene)의 몫.
 */
let instance = null;

const ITEMS = [
  { key: 'start', label: '게임 시작' },
  { key: 'settings', label: '설정' },
  { key: 'quit', label: '게임 종료', danger: true },
];

export class TitleScreen {
  /** 다른 DOM 오버레이(Hud·TransitionScreen)와 같은 이유로 싱글턴. */
  constructor() {
    if (instance) return instance;
    instance = this;

    this.root = document.getElementById('title');
    this.menuEl = document.getElementById('title-menu');
    this.hintEl = document.getElementById('title-hint');

    this.sel = 0;
    this.buttons = [];
    this.onKey = (e) => this.#handleKey(e);
  }

  /** @param {(key: 'start'|'quit') => void} onPick */
  show(onPick) {
    this.onPick = onPick;
    this.hintEl.textContent = '';
    this.#buildMenu();
    this.root.classList.add('visible');
    window.addEventListener('keydown', this.onKey);
  }

  hide() {
    window.removeEventListener('keydown', this.onKey);
    this.root.classList.remove('visible');
  }

  /** 메뉴 아래 안내 한 줄 — 지금은 [게임 종료]를 브라우저가 거부했을 때만 쓴다. */
  setHint(text) {
    this.hintEl.textContent = text;
  }

  #buildMenu() {
    this.menuEl.replaceChildren();
    this.buttons = ITEMS.map((item, i) => {
      const btn = document.createElement('button');
      btn.className = 'title-item' + (item.danger ? ' danger' : '');
      const cursor = document.createElement('span');
      cursor.className = 'cursor';
      cursor.textContent = '▶';
      btn.append(cursor, item.label);
      // 마우스는 얹으면 고르고 누르면 결정 — 키보드(W/S + Enter)와 같은 두 단계다.
      btn.addEventListener('mouseenter', () => this.#select(i));
      btn.addEventListener('click', () => this.#pick(i));
      this.menuEl.append(btn);
      return btn;
    });
    // 첫 렌더의 기본 선택은 플레이어가 고른 것이 아니다 — 소리 없이 세운다.
    this.#select(0, { silent: true });
  }

  #select(i, { silent = false } = {}) {
    if (silent || i !== this.sel) {
      if (!silent) playSfx('switch');
      this.sel = i;
      this.buttons.forEach((btn, j) => btn.classList.toggle('sel', j === i));
    }
  }

  #pick(i) {
    playSfx('select');
    this.onPick?.(ITEMS[i].key);
  }

  #handleKey(e) {
    const n = ITEMS.length;
    const k = e.key;
    if (k === 'ArrowDown' || k === 's' || k === 'S') {
      this.#select((this.sel + 1) % n);
    } else if (k === 'ArrowUp' || k === 'w' || k === 'W') {
      this.#select((this.sel + n - 1) % n);
    } else if (k === 'Enter' || k === ' ') {
      this.#pick(this.sel);
    } else {
      return; // 모르는 키는 그대로 흘려보낸다
    }
    e.preventDefault();
  }
}
