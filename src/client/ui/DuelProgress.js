/**
 * 심문 진행 명판 — 에바 대면(duel 배치) 우상단.
 *
 * 문답이 총 몇 문인지, 지금 몇 문째인지, 지금까지 어떻게 답해 왔는지를 상시
 * 게시한다. 본문 칸(#minigame-content)은 턴마다 `replaceChildren` 으로 지워지는
 * 자리라 진행 기록이 쌓이지 못한다 — 그래서 에바 초상과 같은 정책으로 카드에
 * 눌러앉는 별도 요소를 쓴다 (보이고 안 보이고는 `.duel` 클래스가 정한다).
 *
 * 표시는 셋이다.
 *   문항 램프  질문 하나가 램프 하나. 무사 = 녹청 점등, 사면 = 호박 반점등,
 *              감점 = 금 간 붉은 렌즈. 다음 문항 램프는 흐리게 깜빡인다.
 *   탐지 게이지 state.detection (100 → 0, 낮을수록 위험). 남은 폭이 남은 안전이다.
 *   감시 렌즈  탐지가 낮아지면 붉게 깨어난다 — 이 판의 주인이 누구인지 말한다.
 *
 * DialogueBox·MinigamePanel 과 같은 이유로 싱글턴이다. 숫자는 어디에도 하드코딩
 * 하지 않는다 — 총 문항은 서버가 주는 state.questionMax, 탐지도 state.detection.
 */

let instance = null;

/** 탐지 잔량 → 명판의 낯빛. 2/3 위는 평온, 1/3 위는 경계, 그 아래는 경보. */
const MOODS = ['alarm', 'wary', 'calm'];
const moodOf = (ratio) => (ratio > 2 / 3 ? 'calm' : ratio > 1 / 3 ? 'wary' : 'alarm');

export class DuelProgress {
  constructor() {
    if (instance) return instance;
    instance = this;

    this.root = document.getElementById('duel-progress');
    this.lampsEl = document.getElementById('duel-progress-lamps');
    this.countEl = document.getElementById('duel-progress-count');
    this.meterEl = document.getElementById('duel-progress-meter');
    this.fillEl = document.getElementById('duel-progress-meter-fill');
    this.detectEl = document.getElementById('duel-progress-detect');

    this.total = 0;
    this.max = 100; // 탐지 시작값 — reset 이 서버 값으로 덮는다
  }

  /**
   * 심문 한 판을 시작한다. 램프를 총 문항 수만큼 새로 깔고 게이지를 채운다.
   * @param {{questionMax: number, detection: number, asked: number}} state 서버의 시작 상태
   */
  reset(state) {
    this.total = state.questionMax;
    this.max = Math.max(state.detection, 1);
    this.lampsEl.replaceChildren();
    for (let i = 0; i < this.total; i++) {
      const lamp = document.createElement('div');
      lamp.className = 'dp-lamp';
      this.lampsEl.append(lamp);
    }
    this.#draw(state.asked, state.detection);
  }

  /**
   * 답변 한 번의 결과를 새긴다.
   * @param {{state: object, events: string[]}} r submitAnswer 응답
   */
  record(r) {
    // asked 는 답변 후 +1 — 방금 답한 문항은 asked 번째, 램프 색인은 asked-1.
    const lamp = this.lampsEl.children[r.state.asked - 1];
    if (lamp) {
      lamp.className = `dp-lamp lit ${gradeOf(r.events)}`;
    }
    this.#draw(r.state.asked, r.state.detection);
  }

  #draw(asked, detection) {
    // 다음 문항 램프만 흐리게 깜빡인다 — "지금 여기"를 눈이 바로 찾는다.
    for (let i = 0; i < this.lampsEl.children.length; i++) {
      this.lampsEl.children[i].classList.toggle('now', i === asked);
    }
    this.countEl.textContent = `${asked} / ${this.total}`;

    const ratio = Math.max(0, Math.min(1, detection / this.max));
    this.fillEl.style.width = `${ratio * 100}%`;
    this.detectEl.textContent = `탐지 ${detection}`;
    this.root.classList.remove(...MOODS);
    this.root.classList.add(moodOf(ratio));
  }
}

/**
 * 이번 턴의 사건들 → 램프 등급.
 * 감점이 하나라도 있으면 bad, 지적만 받고 넘어갔으면 warn, 아니면 ok.
 * exposed(추리 선언 적중)는 그 자체로 패배라 감점 없이도 bad 다 — 그 답이
 * 깨끗했어도 플레이어가 기억하는 것은 "여기서 들켰다"이기 때문이다.
 * (이벤트 이름은 서버 escapeSession/routes 가 단일 출처다.)
 */
function gradeOf(events) {
  if (['lie', 'reveal', 'contradiction', 'exposed'].some((e) => events.includes(e))) return 'bad';
  if (events.includes('contradiction-forgiven')) return 'warn';
  return 'ok';
}
