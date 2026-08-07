import { fetchStageStart } from '../net.js';
import { TransitionScreen } from './TransitionScreen.js';
import { playSfx } from '../audio/SoundManager.js';

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
  caught: ['검문 적발', '자석 수류탄이 빗나갔다. 로봇의 팔을 뿌리치지 못했다.'],
  spotted: ['현장 검거', '경계가 극에 달한 거리였다. 로봇은 묻지 않고 팔을 뻗었다.'],
  // 스테이지 2 — 저택. 문서 열람('document')은 2026-08-05 부터 결과 화면 대신
  // 스테이지 3 으로 이어지므로(MansionScene#alarm) 패배 결말만 남는다.
  reported: ['밀고', '입을 잘못 놀렸다. 복도 끝에서 여러 사람의 발소리가 몰려온다.'],
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
    this.cardEl = document.getElementById('result-card');
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
   * @param {() => Promise<{state?: object, error?: string}>} [opts.restart]
   *   새 판을 여는 방법. 기본은 스테이지 1의 /start 다 — 저택(스테이지 2)처럼 시작
   *   조건이 다른 판은 자기 것을 넘긴다.
   * @param {string} [opts.waitText] 재시작을 기다리는 동안 띄울 문구
   * @param {string} [opts.waitTitle]
   *   그동안 뜨는 로딩 화면의 제목. 판마다 돌아가는 곳이 다르다 — 저택(스테이지 2)의
   *   [다시 잠입한다]가 "거리로 이동 중"을 띄우면 어디로 가는 판인지 어긋난다.
   */
  show({ outcome, codeWord, stats, onRestart, restart, waitText, waitTitle }) {
    playSfx(outcome === 'cleared' ? 'clear' : 'fail');
    const [title, line] = OUTCOMES[outcome] ?? OUTCOMES.caught;
    this.onRestart = onRestart;
    this.restartFn = restart ?? fetchStageStart;
    this.waitText = waitText ?? '동료들의 암호를 수신하는 중…';
    this.waitTitle = waitTitle ?? '거리로 이동 중';

    this.titleEl.textContent = title;
    this.lineEl.textContent = line;
    // 판정 도장 — 카드 모서리에 걸쳐 내리찍힌다 (index.html 의 #result-card::after).
    // 결말 넷 중 성공은 'cleared' 하나뿐이고 나머지 셋은 전부 패배다.
    this.cardEl.classList.toggle('ok', outcome === 'cleared');
    this.cardEl.classList.toggle('fail', outcome !== 'cleared');
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
    // 없으면 고장으로 읽히므로 대기 화면을 세운다 (오프닝이 하던 역할의 축소판).
    //
    // 카드 안의 한 줄이 아니라 **화면을 통째로 덮는 로딩 화면**을 쓴다. 11~20초는
    // 결과를 다 읽고도 한참 남는 시간이라, 다 읽은 결과창을 그대로 두고 그 아래에
    // 작은 글씨만 바뀌면 멈춘 것처럼 보인다. 게다가 이 기다림은 다른 씬으로 넘어가는
    // 대기와 같은 것이므로 같은 화면을 써야 한다 (IntroScene·BootScene 과 한 규약).
    this.waitEl.textContent = this.waitText;
    const transition = new TransitionScreen();
    transition.show(this.waitTitle, this.waitText);

    const result = await this.restartFn();

    if (result.error) {
      // 오류는 결과창으로 되돌아와 읽게 한다 — 로딩 판 위에 올리면 [다시 잠입한다]가
      // 그 아래 깔려 손댈 수가 없다 (TutorialScene 이 같은 이유로 같은 선택을 한다).
      transition.hide();
      this.waitEl.textContent = `재시작 실패 — ${result.error}`;
      this.restartBtn.disabled = false;
      return;
    }

    // 로딩 화면은 켠 채로 넘긴다 — 재시작된 씬이 다 지어진 뒤 스스로 걷는다.
    this.hide();
    this.onRestart?.(result.state);
  }
}
