import { fetchStageStart } from '../net.js';

/**
 * 결과 화면 (클리어 / 게임오버).
 *
 * 새 씬이 아니라 씬 위에 덮는 DOM 오버레이다:
 *  - DialogueBox 가 Phaser 밖 DOM 이라, 씬을 갈아타면 대화창 소유권이 애매해진다
 *  - 정지된 월드를 배경으로 깔아 두는 편이 연출에 유리하다
 *
 * 재시작은 페이지 리로드도 씬 전환도 아닌 scene.restart 다. 오프닝은 다시 틀지 않는다
 * — 두 번째 판부터는 이미 본 컷이라 기다림이 되어 버린다.
 */

/** outcome → [제목, 첫 줄] */
const OUTCOMES = {
  cleared: ['잠입 성공', '접선에 성공했다. 동료들이 흩어지기 시작한다.'],
  caught: ['검문 적발', '순찰 로봇의 심문을 통과하지 못했다.'],
  informerCaught: ['즉시 구속', '이미 밀고당한 몸이었다. 변명할 틈도 없었다.'],
  allInformed: ['접선망 전멸', '코드를 건넬 동료가 한 명도 남지 않았다.'],
};

let instance = null;

export class ResultOverlay {
  /**
   * DOM 리스너를 두 번 달지 않도록 싱글턴으로 쓴다 — scene.restart 로 create()
   * 가 다시 도는데, 매번 새 인스턴스를 만들면 [다시 잠입한다] 한 번에 재시작이
   * 여러 번 걸린다.
   */
  constructor() {
    if (instance) return instance;
    instance = this;

    this.root = document.getElementById('result');
    this.titleEl = document.getElementById('result-title');
    this.lineEl = document.getElementById('result-line');
    this.codeEl = document.getElementById('result-code');
    this.statsEl = document.getElementById('result-stats');
    this.restartBtn = document.getElementById('result-restart');
    this.waitEl = document.getElementById('result-wait');

    /** 현재 판을 끝낸 씬이 넘겨준 재시작 콜백 */
    this.onRestart = null;

    this.restartBtn.addEventListener('click', () => this.#restart());
  }

  /**
   * @param {object} opts
   * @param {keyof OUTCOMES} opts.outcome
   * @param {string|null} opts.codeWord   서버가 종료 후에만 내려주는 정답
   * @param {string[]} opts.stats         한 줄로 이어 붙일 통계 조각들
   * @param {(state: object) => void} opts.onRestart  새 판 상태를 받아 씬을 재시작
   */
  show({ outcome, codeWord, stats, onRestart }) {
    const [title, line] = OUTCOMES[outcome] ?? OUTCOMES.allInformed;
    this.onRestart = onRestart;

    this.titleEl.textContent = title;
    this.lineEl.textContent = line;
    // 정답을 모른 채 끝나는 판이 없게 한다 — 못 맞힌 판일수록 정답이 궁금하다.
    this.codeEl.innerHTML = codeWord
      ? `접선 코드는 <b>「${codeWord}」</b>였다.`
      : '';
    this.statsEl.textContent = stats.join('  ·  ');

    this.waitEl.textContent = '';
    this.restartBtn.disabled = false;
    this.root.classList.add('visible');
  }

  hide() {
    this.root.classList.remove('visible');
  }

  async #restart() {
    if (this.restartBtn.disabled) return; // 연타 방지
    this.restartBtn.disabled = true;
    // 새 판은 연상 단어 생성 때문에 11~20초 걸린다. 버튼을 눌렀는데 아무 반응이
    // 없으면 고장으로 읽히므로 대기 문구를 세운다 (오프닝이 하던 역할의 축소판).
    this.waitEl.textContent = '동료들의 암호를 수신하는 중…';

    const result = await fetchStageStart();

    if (result.error) {
      this.waitEl.textContent = `재시작 실패 — ${result.error}`;
      this.restartBtn.disabled = false;
      return;
    }

    this.hide();
    this.onRestart?.(result.state);
  }
}
