/**
 * 화면 고정 HUD — DOM 오버레이 (index.html 의 #hud 와 짝).
 *
 * Phaser 캔버스 텍스트가 아니라 DOM 을 쓰는 이유:
 * 캔버스는 1920×1080 버퍼에 그려진 뒤 창 크기에 맞춰 정수가 아닌 배율로 늘어나는데,
 * pixelArt(NEAREST) 와 image-rendering:pixelated 때문에 그 확대에 보간이 없다.
 * 타일 아트는 그러라고 켠 설정이지만, 획이 1~2px 인 글자는 그 확대에서 획마다
 * 두께가 들쭉날쭉해져 깨져 보인다. DOM 은 브라우저가 실제 화면 해상도로 직접
 * 그리므로 창 크기·DPI 와 무관하게 또렷하다 (대화창이 DOM 인 것과 같은 계열의 이유).
 *
 * 좌표는 캔버스와 같다 — CSS 가 `calc(N * var(--s))` 로 적혀 있고 --s 는
 * "1920 기준 1px" 이라, 여기 적는 20·16·92 같은 값이 캔버스 좌표 그대로다.
 */
let instance = null;

export class Hud {
  constructor() {
    // 싱글턴 — 씬을 옮기거나 restart 할 때마다 새로 만들면 같은 DOM 을 가리키는
    // 객체가 늘어나고, 방 이름 타이머가 겹쳐 남는다 (DialogueBox 와 같은 이유).
    if (instance) {
      instance.reset();
      return instance;
    }
    instance = this;

    this.root = document.getElementById('hud');
    this.statusEl = document.getElementById('hud-status');
    this.roomEl = document.getElementById('hud-room');
    this.keysEl = document.getElementById('hud-keys');
    /** 방 이름을 지울 예약 — 다음 방에 들어오면 취소하고 다시 잡는다. */
    this.roomTimer = null;

    this.reset();
  }

  /** 씬이 새로 시작할 때 — 이전 씬이 남긴 문구와 페이드를 지운다. */
  reset() {
    clearTimeout(this.roomTimer);
    this.statusEl.textContent = '';
    this.keysEl.textContent = '';
    this.roomEl.textContent = '';
    this.roomEl.classList.remove('visible');
    this.root.style.display = 'block';
    this.root.style.transition = 'none';
    this.root.style.opacity = '1';
  }

  /** 좌상단 진행 상태. 줄바꿈이 든 문자열도 그대로 나온다. */
  status(text) {
    this.statusEl.textContent = text;
  }

  /** 좌하단 조작 안내. 씬마다 쓸 수 있는 키가 다르다. */
  keys(text) {
    this.keysEl.textContent = text;
  }

  /**
   * 방 이름을 잠깐 띄운다 (저택). 방이 바뀐 순간에만 부른다 —
   * 매 프레임 부르면 타이머가 계속 밀려 사라지지 않는다.
   */
  showRoom(name) {
    clearTimeout(this.roomTimer);
    this.roomEl.textContent = name;
    this.roomEl.classList.add('visible');
    // 클래스를 떼면 #hud-room 의 transition(700ms)을 타고 서서히 사라진다.
    this.roomTimer = setTimeout(() => this.roomEl.classList.remove('visible'), 900);
  }

  /**
   * 씬 전환의 암전과 함께 뜨고 진다.
   *
   * 카메라 페이드(cameras.main.fadeIn/Out)는 캔버스만 덮는다 — HUD 는 그 밖의
   * DOM 이라 같이 걸어 주지 않으면 월드가 어두워지는 동안 글자만 또렷하게 남는다.
   */
  fadeIn(ms) {
    this.root.style.transition = 'none';
    this.root.style.opacity = '0';
    // 다음 프레임에 켜야 전환이 실제로 돈다 — 같은 프레임에 0→1 을 적으면 합쳐진다.
    requestAnimationFrame(() => {
      this.root.style.transition = `opacity ${ms}ms linear`;
      this.root.style.opacity = '1';
    });
  }

  fadeOut(ms) {
    this.root.style.transition = `opacity ${ms}ms linear`;
    this.root.style.opacity = '0';
  }

  /** 씬을 떠날 때 — 다음 화면(결과·오프닝)에 문구가 남지 않게. */
  hide() {
    clearTimeout(this.roomTimer);
    this.root.style.display = 'none';
  }
}
