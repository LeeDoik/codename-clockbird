/**
 * 오프닝 영상 오버레이.
 *
 * Phaser 의 Video 오브젝트가 아니라 DOM `<video>` 를 쓰는 이유:
 *  - 브라우저 코덱·하드웨어 디코딩을 그대로 탄다 (캔버스 텍스처 업로드가 없다)
 *  - 자동 재생 정책·음소거 해제 같은 브라우저 규칙을 직접 다룰 수 있다
 *  - #game-root 가 16:9 박스라 CSS 만으로 캔버스와 같은 크기·위치에 얹힌다
 * 대화창·미니게임과 같은 결정이다 — 브라우저가 잘하는 일은 브라우저에 맡긴다.
 */
export class IntroVideo {
  constructor() {
    this.root = document.getElementById('intro-video');
    this.el = document.getElementById('intro-video-el');
    this.unmuteBtn = document.getElementById('intro-unmute');

    // 건너뛰기 클릭과 겹치지 않게 버블링을 끊는다.
    this.unmuteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.el.muted = false;
      this.unmuteBtn.classList.remove('visible');
    });
  }

  /**
   * 영상을 열고 재생을 시작한다.
   *
   * 파일이 없거나(404) 코덱을 못 열거나 너무 늦으면 **false** 를 돌려준다 —
   * 호출한 쪽이 기존 패널 오프닝으로 돌아갈 수 있게 하기 위해서다.
   * public/intro 의 규약(파일이 없어도 게임은 돌아간다)을 영상에도 그대로 적용한다.
   *
   * @returns {Promise<boolean>} 실제로 재생이 시작됐는가
   */
  async start(src, { timeoutMs = 2500 } = {}) {
    const opened = await new Promise((resolve) => {
      let settled = false;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        this.el.removeEventListener('canplay', onCan);
        this.el.removeEventListener('error', onErr);
        resolve(v);
      };
      const onCan = () => finish(true);
      const onErr = () => finish(false);
      this.el.addEventListener('canplay', onCan);
      this.el.addEventListener('error', onErr);
      this.el.src = src;
      this.el.load();
      // 회선이 느리면 오프닝을 기다리게 두지 않는다 — 그 시간이 곧 검은 화면이다.
      setTimeout(() => finish(false), timeoutMs);
    });

    if (!opened) {
      this.#release();
      return false;
    }

    this.root.classList.add('visible');

    // 소리를 켠 채로 자동 재생을 시도하고, 브라우저가 거절하면 음소거로 되돌린다.
    // 사용자가 아직 아무것도 누르지 않은 상태라 대부분의 브라우저는 소리 있는
    // 자동 재생을 막는다 — 막혔다고 오프닝을 포기하면 안 되므로 음소거로라도 튼다.
    try {
      this.el.muted = false;
      await this.el.play();
    } catch {
      this.el.muted = true;
      try {
        await this.el.play();
      } catch {
        this.#release();
        this.root.classList.remove('visible');
        return false;
      }
      this.unmuteBtn.classList.add('visible');
    }
    return true;
  }

  /** 재생이 끝났을 때 한 번 부른다. */
  onEnded(handler) {
    this.el.addEventListener('ended', handler, { once: true });
  }

  /**
   * 화면을 누르면 건너뛴다.
   *
   * Phaser 의 pointerdown 은 캔버스에서만 잡히는데 영상이 그 위를 덮고 있어 닿지 않는다.
   * 키보드는 Phaser 가 window 에서 듣고 있어 그대로 통한다 — 클릭만 여기서 받는다.
   */
  onSkip(handler) {
    this.root.addEventListener('pointerdown', handler, { once: true });
  }

  hide() {
    this.root.classList.remove('visible');
    this.unmuteBtn.classList.remove('visible');
    this.#release();
  }

  /** 디코더와 버퍼를 놓는다 — src 만 지우면 브라우저가 계속 받아 온다. */
  #release() {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
  }
}
