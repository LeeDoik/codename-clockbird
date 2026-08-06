/**
 * 엔딩 커튼 — index.html 의 #ending 과 짝.
 *
 * 브란트와의 마지막 대화가 끝나면 씬(EndingScene#curtain)이 카메라를 접고 이것을
 * 연다. 예전에는 검은 화면에 모노스페이스 글자 두 줄("To be continued")이 전부였다
 * — 30분을 잠입한 끝이 글자 두 줄이라 막이 내리는 느낌이 없었다 (2026-08-06 기획).
 *
 * 세 박자로 내린다:
 *   1. 내레이션 — 훔친 서류가 도시로 흩어진다 (검은 화면에 글 한 장)
 *   2. 내레이션 — 멈춰 있던 회중시계가 다시 간다 (로딩 화면의 시계 그림을 다른
 *      속도로 재사용 — 그쪽은 1.8초에 한 바퀴 도는 스피너, 여기는 12초 한 바퀴)
 *   3. 파이널 타블로 — 타이틀의 도시가 새벽으로 밝아 오르고, 그 한가운데에 제목·
 *      인용구·TO BE CONTINUED 가 차례로 떠오른다 (2026-08-07: 태엽새 그림을 넣었다
 *      뺐다 — 기획 피드백. 구운 그림은 public/ui/ending-bird.png 로 남아 있다).
 *
 * 클릭이나 [Space/Enter/Esc] 는 곧장 3으로 건너뛴다 — 심사 중 서두를 수 있어야 한다.
 * 되감기는 없다. 이 화면 다음은 없으므로 hide() 도 없다.
 */
let instance = null;

/** 카드 1이 떠 있는 시간 (페이드 인 900ms 포함). */
const BEAT1_MS = 4800;
/** 카드 2(시계)가 떠 있는 시간. */
const BEAT2_MS = 5600;
/** 카드가 걷히고 다음 박자까지의 어둠. */
const GAP_MS = 800;

export class EndingCurtain {
  /** 다른 DOM 오버레이(TitleScreen 등)와 같은 이유로 싱글턴. */
  constructor() {
    if (instance) return instance;
    instance = this;

    this.root = document.getElementById('ending');
    this.card1 = document.getElementById('ending-card1');
    this.card2 = document.getElementById('ending-card2');
    this.final = document.getElementById('ending-final');
    this.timers = [];

    this.root.addEventListener('click', () => this.#toFinal());
    this.onKey = (e) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') this.#toFinal();
    };
  }

  play() {
    this.root.classList.add('visible');
    window.addEventListener('keydown', this.onKey);

    this.#at(200, () => this.card1.classList.add('on'));
    this.#at(BEAT1_MS, () => this.card1.classList.remove('on'));
    this.#at(BEAT1_MS + GAP_MS, () => this.card2.classList.add('on'));
    this.#at(BEAT1_MS + GAP_MS + BEAT2_MS, () => this.card2.classList.remove('on'));
    this.#at(BEAT1_MS + GAP_MS + BEAT2_MS + GAP_MS, () => this.#toFinal());
  }

  #at(ms, fn) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  /** 마지막 화면으로 — 예정대로 도착했든 건너뛰었든 같은 자리다. */
  #toFinal() {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
    window.removeEventListener('keydown', this.onKey);
    this.card1.classList.remove('on');
    this.card2.classList.remove('on');
    this.final.classList.add('on');
  }
}
