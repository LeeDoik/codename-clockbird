/**
 * 미니게임 패널 — 감옥 퍼즐과 검문 타이밍이 공유하는 껍데기.
 *
 * 어몽어스 미션 패널처럼 화면을 덮고, 안에서 벌어지는 일은 미니게임 모듈이 그린다.
 * 이 클래스가 책임지는 것은 네 가지뿐이다: 열고 닫기, 제한 시간, 판정 연출, 키 격리.
 *
 * DialogueBox 와 마찬가지로 Phaser 캔버스가 아니라 DOM 이다 — 클릭 판정과 레이아웃이
 * 캔버스보다 훨씬 싸게 붙고, 대화창과 같은 방식이라 스타일이 따로 놀지 않는다.
 */

let instance = null;

export class MinigamePanel {
  /** DialogueBox 와 같은 이유로 싱글턴 — scene.restart 마다 리스너가 쌓이면 안 된다. */
  constructor() {
    if (instance) return instance;
    instance = this;

    this.root = document.getElementById('minigame');
    this.titleEl = document.getElementById('minigame-title');
    this.subtitleEl = document.getElementById('minigame-subtitle');
    this.timerEl = document.getElementById('minigame-timer');
    this.timerFill = document.getElementById('minigame-timer-fill');
    this.contentEl = document.getElementById('minigame-content');
    this.hintEl = document.getElementById('minigame-hint');
    this.verdictEl = document.getElementById('minigame-verdict');

    /** 실행 중인 미니게임의 키 핸들러 (run 의 render 가 등록한다) */
    this.onKey = null;

    // 패널이 열린 동안 키를 Phaser 로 흘려보내지 않는다. capture 단계에서 가로채야
    // Phaser 의 리스너보다 먼저 잡힌다 — 안 그러면 퍼즐을 푸는 동안 플레이어가 걸어다닌다.
    this.keyGuard = (e) => {
      if (!this.isOpen) return;
      e.stopPropagation();
      // Space/방향키의 기본 동작(스크롤)까지 막는다. Esc 는 삼켜서 탈출을 봉쇄한다.
      if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key)) {
        e.preventDefault();
      }
      this.onKey?.(e);
    };
    window.addEventListener('keydown', this.keyGuard, true);
  }

  get isOpen() {
    return this.root.classList.contains('visible');
  }

  /**
   * 미니게임 한 판을 실행한다.
   *
   * @param {object} opts
   * @param {string} opts.title
   * @param {string} [opts.subtitle]
   * @param {string} [opts.hint]
   * @param {number} [opts.timeLimitMs]  0/생략이면 제한 시간 없음
   * @param {(ctx: {content: HTMLElement, finish: (ok: boolean) => void, setHint: (s: string) => void}) => (void | (() => void))} opts.render
   *        본문을 그린다. 정리 함수를 반환하면 판이 끝날 때 호출된다.
   * @returns {Promise<boolean>} 성공 여부
   */
  run({ title, subtitle = '', hint = '', timeLimitMs = 0, render }) {
    // 앞선 판이 아직 살아 있으면 접고 시작한다. 두 판이 겹치면 옛 판의 타이머가 새 판의
    // DOM 을 건드려 멀쩡히 풀고 있는데 실패로 끝나는 사고가 난다.
    this.abort?.();

    this.titleEl.textContent = title;
    this.subtitleEl.textContent = subtitle;
    this.hintEl.textContent = hint;
    this.verdictEl.textContent = '';
    this.verdictEl.className = '';
    this.contentEl.replaceChildren();
    this.root.classList.add('visible');

    return new Promise((resolve) => {
      let settled = false;
      let cleanup = null;
      let rafId = 0;
      let timeoutId = 0;

      const finish = (ok) => {
        // 제한 시간과 플레이어 입력이 같은 프레임에 도착할 수 있다 — 먼저 온 쪽만 센다.
        if (settled) return;
        settled = true;

        cancelAnimationFrame(rafId);
        cleanup?.();
        this.onKey = null;

        this.verdictEl.textContent = ok ? '성공' : '실패';
        this.verdictEl.className = ok ? 'ok' : 'fail';
        // 결과를 눈으로 확인할 틈. 이게 없으면 패널이 깜빡하고 사라져 뭐가 됐는지 모른다.
        timeoutId = window.setTimeout(() => {
          this.#close();
          resolve(ok);
        }, 800);
      };

      const setHint = (s) => { this.hintEl.textContent = s; };

      if (timeLimitMs > 0) {
        this.timerEl.classList.add('visible');
        const startedAt = performance.now();
        const tick = () => {
          const left = Math.max(0, 1 - (performance.now() - startedAt) / timeLimitMs);
          this.timerFill.style.width = `${left * 100}%`;
          if (left <= 0) finish(false);
          else rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } else {
        this.timerEl.classList.remove('visible');
      }

      cleanup = render({ content: this.contentEl, finish, setHint }) ?? null;

      // 판이 끝나기 전에 씬이 갈아엎히면(재시작) 타이머가 유령으로 남는다.
      this.abort = () => {
        if (settled) { window.clearTimeout(timeoutId); }
        settled = true;
        cancelAnimationFrame(rafId);
        cleanup?.();
        this.onKey = null;
        this.#close();
        resolve(false);
      };
    });
  }

  #close() {
    this.root.classList.remove('visible');
    this.contentEl.replaceChildren();
    this.timerEl.classList.remove('visible');
    this.abort = null;
  }
}
