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
      // 패널 안 입력칸에 글을 쓰는 중이라면 키는 그 입력칸 것이다. Space 를 막으면
      // 띄어쓰기가 안 되고, 미니게임 단축키까지 얹으면 타이핑이 게임 조작이 된다.
      if (e.target instanceof HTMLInputElement) return;
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
   * 패널만 연다 (본문 없음).
   *
   * run() 은 자기완결적인 미니게임용이고, 이쪽은 여러 단계가 이어지는 흐름용이다.
   * 검문은 [조회 대기] → [질문·답변] → [심사 대기] → [판정] 네 단계를 거치는데,
   * 그 사이에 패널이 닫혔다 열리면 화면이 깜빡여 긴장이 끊긴다.
   */
  open({ title, subtitle = '', hint = '' }) {
    this.abort?.();
    this.titleEl.textContent = title;
    this.subtitleEl.textContent = subtitle;
    this.hintEl.textContent = hint;
    this.verdictEl.textContent = '';
    this.verdictEl.className = '';
    this.timerEl.classList.remove('visible');
    this.contentEl.replaceChildren();
    this.root.classList.add('visible');
  }

  /**
   * 본문을 한 줄짜리 상태 문구로 바꾼다.
   * LLM 왕복(2~4초)을 연출로 덮는 자리다 — 빈 화면으로 두면 멈춘 것처럼 보인다.
   */
  setStatus(text) {
    const p = document.createElement('div');
    p.textContent = text;
    p.style.opacity = '0.75';
    this.contentEl.replaceChildren(p);
  }

  /** 흐름형(open) 패널을 닫는다. run() 은 스스로 닫으므로 부를 필요가 없다. */
  close() {
    this.#close();
  }

  /**
   * 미니게임 한 판을 실행한다.
   *
   * @param {object} opts
   * @param {string} opts.title
   * @param {string} [opts.subtitle]
   * @param {string} [opts.hint]
   * @param {number} [opts.timeLimitMs]  0/생략이면 제한 시간 없음
   * @param {boolean} [opts.showVerdict]  false 면 성공/실패 연출 없이 finish 값을 그대로 돌려준다
   *        (심문처럼 판정이 아직 안 난, 값만 받아 오는 단계에 쓴다)
   * @param {(ctx: {content: HTMLElement, finish: (ok: boolean) => void, setHint: (s: string) => void}) => (void | (() => void))} opts.render
   *        본문을 그린다. 정리 함수를 반환하면 판이 끝날 때 호출된다.
   * @returns {Promise<boolean>} 성공 여부
   */
  run({ title, subtitle = '', hint = '', timeLimitMs = 0, showVerdict = true, render }) {
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

      const finish = (value) => {
        // 제한 시간과 플레이어 입력이 같은 프레임에 도착할 수 있다 — 먼저 온 쪽만 센다.
        if (settled) return;
        settled = true;

        cancelAnimationFrame(rafId);
        cleanup?.();
        this.onKey = null;

        if (!showVerdict) {
          // 값만 받아 가는 단계 — 패널은 열어 둔 채 다음 단계가 이어받는다.
          resolve(value);
          return;
        }

        this.verdictEl.textContent = value ? '성공' : '실패';
        this.verdictEl.className = value ? 'ok' : 'fail';
        // 결과를 눈으로 확인할 틈. 이게 없으면 패널이 깜빡하고 사라져 뭐가 됐는지 모른다.
        timeoutId = window.setTimeout(() => {
          this.#close();
          resolve(value);
        }, 800);
      };

      const setHint = (s) => { this.hintEl.textContent = s; };

      if (timeLimitMs > 0) {
        this.timerEl.classList.add('visible');
        // 흘러간 시간을 시작 시각과의 차이로 재지 않고 프레임 간격을 쌓아서 잰다.
        // 탭이 백그라운드로 가면 브라우저가 rAF 를 통째로 멈추는데, 돌아왔을 때 그
        // 공백을 그대로 인정하면 제한 시간이 즉시 소진돼 손도 못 대고 실패한다.
        // 한 프레임에 인정하는 시간을 상한으로 묶어 그 구간을 흘려보낸다.
        const MAX_FRAME_MS = 100;
        let last = performance.now();
        let elapsed = 0;
        const tick = () => {
          const now = performance.now();
          elapsed += Math.min(now - last, MAX_FRAME_MS);
          last = now;
          const left = Math.max(0, 1 - elapsed / timeLimitMs);
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
