/**
 * 검거 연출 — 스테이지 3에서 순찰 로봇에게 잡혔을 때 (게임오버).
 *
 * 결과 화면(ResultOverlay)이 아니다 — 그쪽은 판이 끝나는 자리고, 이쪽은 곧바로
 * 시작 지점에서 다시 서기까지 사이의 한 장면이다. 그래서 버튼이 없다: 연출이
 * 끝나면 저절로 걷히고, 아무 키·클릭으로 건너뛸 수 있다. 빠른 재시도가 이 판의
 * 설계 기둥이라(스펙 §1 — 루즈함 방지) 연출이 그것을 잡아먹으면 안 된다.
 *
 * show() 는 화면을 **다 덮은 채로** resolve 된다 — 호출부(EscapeScene#caught)가
 * 그 뒤에서 판을 처음 상태로 되돌리고 hide() 로 걷어낸다. 덮개가 곧 암전 노릇이라
 * 되돌리는 순간이 비쳐 보이지 않는다.
 *
 * DialogueBox·MinigamePanel 과 같은 이유로 싱글턴 — scene.restart 마다 리스너가
 * 쌓이면 안 된다.
 */

let instance = null;

/** 창살(320ms)·장면(180+340ms)·명판(560+260ms)이 다 선 뒤 눈에 담을 시간까지. */
const HOLD_MS = 2400;

/** CSS #gameover.leaving 의 opacity transition(400ms)과 짝 — 여유 50ms. */
const LEAVE_MS = 450;

export class GameOverOverlay {
  constructor() {
    if (instance) return instance;
    instance = this;

    this.root = document.getElementById('gameover');
    this.retryEl = document.getElementById('gameover-retry');
    /** show 가 진행 중일 때만 산다 — 건너뛰기(아무 키·클릭)가 이걸 부른다. */
    this.skip = null;

    // capture 로 잡아 Phaser 까지 안 흘린다 — 검거된 채로 걷는 소리가 나면 안 된다.
    const onSkip = (e) => {
      if (!this.skip) return;
      e.stopPropagation();
      e.preventDefault();
      this.skip();
    };
    window.addEventListener('keydown', onSkip, true);
    this.root.addEventListener('pointerdown', onSkip);
  }

  /**
   * 연출을 세운다. 다 보여 준 뒤(또는 건너뛴 뒤)에도 화면은 덮인 채다.
   * @param {number} retries 몇 번째인지 — EscapeScene 의 retryText 와 같은 낱말을 쓴다
   * @returns {Promise<void>}
   */
  show(retries) {
    this.retryEl.textContent = retries > 0 ? `재시도 ${retries}` : '';
    // 애니메이션(창살 낙하·명판 도장)을 처음부터 다시 돌린다 — visible 을 붙이기만
    // 하면 두 번째 검거부터는 이미 끝난 애니메이션이라 그림이 그냥 서 있다.
    // reflow 한 번이 리셋이다.
    this.root.classList.remove('visible', 'leaving');
    void this.root.offsetWidth;
    this.root.classList.add('visible');

    return new Promise((resolve) => {
      const timer = window.setTimeout(() => { this.skip = null; resolve(); }, HOLD_MS);
      this.skip = () => {
        window.clearTimeout(timer);
        this.skip = null;
        resolve();
      };
    });
  }

  /** 덮개를 걷는다 — 뒤에서 판이 이미 처음 상태로 서 있어야 한다. */
  hide() {
    this.root.classList.add('leaving');
    // transitionend 는 탭이 뒤로 가 있으면 안 올 수 있다 — 시간을 못 박는다.
    window.setTimeout(() => this.root.classList.remove('visible', 'leaving'), LEAVE_MS);
  }
}
