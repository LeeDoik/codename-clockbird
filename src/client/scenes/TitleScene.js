import Phaser from 'phaser';
import { TitleScreen } from '../ui/TitleScreen.js';
import { TransitionScreen } from '../ui/TransitionScreen.js';
import { CSS, FONTS } from '../ui/theme.js';
import { fetchStageStart } from '../net.js';
import { playBgm } from '../audio/SoundManager.js';
import { SettingsPanel } from '../ui/SettingsPanel.js';
import { Hud } from '../ui/Hud.js';
import { DialogueBox } from '../ui/DialogueBox.js';
import { ClueBook } from '../ui/ClueBook.js';

const W = 1920;
const H = 1080;

/**
 * 타이틀 씬 — 오프닝(Intro) 다음에 서는 관문이다. 게임 입장은 여기의 [게임 시작]뿐.
 *
 * 화면 자체는 DOM(ui/TitleScreen.js)이 그리고, 이 씬은 행선지만 안다:
 *   게임 시작  → Tutorial(본부 훈련) → Stage → … (오프닝은 이미 봤다)
 *   게임 종료  → window.close() — 스크립트가 연 창이 아니면 브라우저가
 *                조용히 무시하므로, 그때는 안내 한 줄로 대신한다
 *
 * 스테이지 시작 fetch(LLM, 실측 11~20초)는 [게임 시작]을 누른 순간 쏜다. 타이틀에
 * 머무는 동안 LLM 세션을 열어 둘 이유가 없고, 대기는 본부 훈련(LLM 없이 시작한다)이
 * 가린다 — 훈련 퍼즐 한 판이 그 20초보다 길다 (TutorialScene#goStage 가 소비한다).
 */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create() {
    playBgm('title');
    // 판 도중에 돌아왔을 수 있다 (설정 창의 [타이틀 화면으로]). 이 셋은 씬 밖 DOM 이라
    // 씬을 끝내도 저절로 사라지지 않는다 — HUD 의 조작 안내가 타이틀 위에 그대로 남는다.
    // 오프닝에서 처음 들어오는 길에서는 셋 다 이미 비어 있어 아무 일도 하지 않는다.
    new Hud().hide();
    new DialogueBox().hide();
    new ClueBook().close();

    const title = new TitleScreen();
    title.show((key) => {
      if (key === 'start') {
        const startPromise = fetchStageStart();
        this.registry.set('startPromise', startPromise);
        title.hide();

        // 개발용(?notutorial) — 본부 훈련을 건너뛰고 곧장 거리로 간다. 이때는
        // 훈련이 LLM 대기를 못 가리므로 로딩 화면이 덮는다.
        if (new URLSearchParams(window.location.search).has('notutorial')) {
          this.#waitAndStartStage(startPromise);
          return;
        }
        this.scene.start('Tutorial');
      } else if (key === 'settings') {
        // 타이틀은 그대로 둔 채 위에 띄운다 — 곡이 흐르는 중이라 배경음 슬라이더를
        // 끌면 그 자리에서 결과가 들린다. 닫으면 메뉴가 그대로 있다.
        new SettingsPanel().open();
      } else {
        window.close();
        title.setHint('창이 닫히지 않으면 브라우저 탭을 직접 닫아 주세요.');
      }
    });
  }

  /**
   * 스테이지 상태가 준비됐으면 넘어가고, 아직이면 로딩 화면을 세운다.
   * (예전 IntroScene 에 있던 것을 흐름 개편으로 그대로 옮겨 왔다 — 로딩을 덮는
   * 화면은 여전히 공용 TransitionScreen 하나다. 여는 쪽이 show, 도착한 씬이 hide.)
   */
  #waitAndStartStage(startPromise) {
    const transition = new TransitionScreen();
    let arrived = false;

    // 프로미스는 {state} 또는 {error} 로만 resolve 한다 (절대 reject 안 함 — net.js).
    Promise.resolve(startPromise).then((res) => {
      arrived = true;
      if (!res || res.error) {
        // 안 띄웠으면 hide 는 무해하다 — TransitionScreen 의 규약이 그렇다.
        transition.hide();
        this.#showError(res?.error ?? '스테이지 시작에 실패했습니다.');
        return;
      }
      // 로딩 화면은 켠 채로 넘긴다 — StageScene 이 다 지어진 뒤 스스로 걷는다.
      this.scene.start('Stage', { state: res.state });
    });

    // ⚠ 곧바로 띄우지 않는다. 이미 준비돼 있으면 위 then 이 즉시 씬을 바꾸는데,
    //   그때 로딩 화면을 세웠다면 회중시계가 한 번 번쩍하고 사라져 연출이 아니라
    //   고장으로 보인다. 150ms 는 예전 문구가 쓰던 값 그대로다.
    this.time.delayedCall(150, () => {
      if (!arrived) transition.show('거리로 이동 중', '동료들의 암호를 수신하고 있다');
    });
  }

  #showError(message) {
    this.add
      .text(
        W / 2,
        H / 2,
        `스테이지 시작 실패\n${message}\n\n.env 에 ANTHROPIC_API_KEY 를 넣었는지 확인하세요.`,
        {
          fontFamily: FONTS.body,
          fontSize: '26px',
          color: CSS.wax,
          align: 'center',
          lineSpacing: 12,
        },
      )
      .setOrigin(0.5)
      .setDepth(60);
  }
}
