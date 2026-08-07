import Phaser from 'phaser';
import { DialogueBox } from '../ui/DialogueBox.js';
import { SettingsPanel } from '../ui/SettingsPanel.js';
import { EndingCurtain } from '../ui/EndingCurtain.js';
import {
  buildColliders,
  createPlayer,
  createPlayerVisual,
  setupCameras,
  DEFAULT_CHAR_HEIGHT,
} from '../world/worldParts.js';
import {
  PLAYER_ANIM,
  PLAYER_CONTENT_HEIGHT,
  PLAYER_FRAME_SIZE,
  PLAYER_ORIGIN_Y,
} from '../entities/playerSprite.js';
import {
  NPC_CONTENT_HEIGHT,
  NPC_FRAME_SIZE,
  NPC_ORIGIN_Y,
  NPC_TEXTURE,
} from '../entities/npcSprite.js';
import { playBgm, GAMEPLAY_BGM_VOLUME } from '../audio/SoundManager.js';
import hqData from '../assets/hq.json';
import hqProps from '../assets/hq-props.json';

/**
 * 엔딩 — 본부 귀환.
 *
 * 시작한 곳으로 돌아와 끝난다. 새 아트가 한 장도 필요 없다는 점이 이 안을 고른
 * 이유다 (스펙 §2) — 튜토리얼의 맵·간부·대화 체계를 그대로 쓴다.
 *
 * 플레이어가 걸어가서 [E] 를 누르는 상호작용이 아니라, 씬에 들어서면 두 사람이
 * 알아서 대화하는 연출이다(2026-08-07 플레이테스트 피드백 — 마지막까지 조작을
 * 요구하지 않는다). EscapeScene#playIntro·MansionScene#alarm 과 같은 방식으로
 * dialogue.show() 와 시간 지연(#beat)만으로 진행한다.
 */
// 본부는 튜토리얼과 같은 맵·같은 규격이다 — 값이 갈라지면 두 씬의 화면이 달라진다.
const TILE = hqData.tileSize;

// 브란트(간부)는 PixelLab 남향 정지 그림이다 — 규격은 entities/npcSprite.js 가
// 단일 출처라, 그림을 갈아끼워도 이 씬과 튜토리얼이 갈라지지 않는다.

// 플레이어는 튜토리얼과 같은 외형이다 — TutorialScene 의 값과 같아야 한다.
const PLAYER_FRAME = 0;
// 브리프 원문은 218/256·197·32 였으나, TutorialScene.js:66-68 의 실제 값(176/256·176·56)과
// 어긋나 "튜토리얼과 같은 외형이어야 한다"는 브리프 자신의 의도와 모순됐다 — 실제 소스를
// 따른다 (task-13-report.md 참고).
/** 화면에 보일 인물 높이 — 맵이 정한다 (worldParts.DEFAULT_CHAR_HEIGHT 참고). */
const PLAYER_HEIGHT = hqData.charHeight ?? DEFAULT_CHAR_HEIGHT;
/** 간부도 플레이어와 키를 맞춘다 (TutorialScene 과 같은 값이어야 한다). */
const OFFICER_SCALE = PLAYER_HEIGHT / NPC_CONTENT_HEIGHT.officer;

/**
 * 간부. 자리는 `hq.json` 의 `spawns.officer` 를 그대로 쓴다 — 좌표를 여기 적으면
 * 맵을 고쳤을 때 조용히 어긋난다.
 * 초상 id 는 `public/portraits/officer.png` 의 파일명이다 (튜토리얼은 서버가 준
 * `state.officer.id` 를 쓰지만 엔딩엔 세션이 없다).
 */
const OFFICER = { id: 'officer', name: '브란트', role: '간부' };

/**
 * 보고 연출 — 한 호흡(문단)씩 나눠 시간차로 보여준다. DialogueBox#paginate 에
 * 맡기지 않는 이유: 페이지가 넘어가도 사용자가 넘기지 않는 한 다음 페이지가 안
 * 뜨는데, 여기는 사용자 조작 없이 흘러야 하는 연출이라 문단 하나가 곧 한 비트다
 * (MansionScene#alarm 과 같은 규칙).
 */
const REPORT_BEATS = [
  { text: '"…살아 돌아왔군."', ms: 2200 },
  { text: '브란트가 서류를 받아 든다. 한 장 한 장, 말없이.', ms: 2600 },
  { text: '"자유 의지를 가진 로봇이라."', ms: 2200 },
  { text: '그가 서류를 덮는다.', ms: 1800 },
  { text: '"양날의 검이 될 수 있겠군...."', ms: 2800 },
  { text: '"쉬어라. 오래는 못 쉰다."', ms: 2200 },
  { text: '창밖에서 첫 기적이 울린다. 반격의 서막이다.', ms: 2800 },
];

export class EndingScene extends Phaser.Scene {
  constructor() {
    super('Ending');
  }

  init() {
    this.done = false;
  }

  create() {
    // 막이 내리는 자리에 타이틀 곡을 다시 올린다 — 오프닝·타이틀에서 들었던 그 곡으로
    // 돌아오며 한 바퀴가 닫힌다. 다만 볼륨은 타이틀(0.45)이 아니라 플레이 화면 기준이다.
    // 이 씬에는 브란트의 대사 세 장이 흐르고, 그것이 엔딩의 본문이기 때문이다.
    playBgm('title', { volume: GAMEPLAY_BGM_VOLUME });
    this.dialogue = new DialogueBox();

    this.add.image(0, 0, 'hq-bg').setOrigin(0, 0).setDepth(-100);
    // props 를 통째로 넘긴다 — walk(손으로 칠한 걷는 길)가 충돌의 원본이다.
    // 한동안 `hqProps.blocked` 를 넘기고 있었는데, 그러면 walk 가 undefined 라 판정이
    // 조용히 옛 layout 경로로 떨어져 이 씬에는 가구 충돌이 사실상 없었다 (본부 layout 의
    // solid 는 바깥 테두리뿐이다). TutorialScene 과 반드시 같은 인자를 써야 한다.
    this.walls = buildColliders(this, hqData, hqProps);
    this.player = createPlayer(this, hqData, this.walls, PLAYER_FRAME);
    this.player.setVisible(false);
    this.playerVisual = createPlayerVisual(
      this, this.player, PLAYER_ANIM,
      PLAYER_ORIGIN_Y, PLAYER_CONTENT_HEIGHT, PLAYER_HEIGHT,
      PLAYER_FRAME_SIZE,
    );

    const os = hqData.spawns.officer;
    this.officerNode = this.add
      .image(os.col * TILE + TILE / 2, os.row * TILE + TILE / 2, NPC_TEXTURE.officer)
      .setOrigin(0.5, NPC_ORIGIN_Y)
      .setDisplaySize(NPC_FRAME_SIZE * OFFICER_SCALE, NPC_FRAME_SIZE * OFFICER_SCALE);

    // 월드를 다 깐 직후·UI 를 만들기 전. 줌·카메라 추적 모두 TutorialScene 과 같다.
    setupCameras(this, hqData, this.player);

    // 플레이어 조작은 없다 — 씬에 들어서면 곧바로 보고 연출이 흐른다.
    this.cameras.main.fadeIn(700, 0, 0, 0);
    this.uiCam?.fadeIn(700, 0, 0, 0);
    this.cameras.main.once('camerafadeincomplete', () => this.#playReport());

    // 걷지도 말을 걸지도 못하지만 [Esc] 설정 창만은 남긴다 — 타이틀 [설정]과 인게임
    // [Esc] 가 같은 창을 연다는 규칙(2026-08-07)이 이 씬에서만 끊기면 그게 더 어색하다.
    this.keyEsc = this.input.keyboard.addKey('ESC');
    this.settings = new SettingsPanel();
  }

  /** 씬 진입과 함께 자동으로 흐르는 보고 연출. 조작 없이 문단마다 시간차로 넘어간다. */
  async #playReport() {
    this.dialogue.setHint('');
    for (const beat of REPORT_BEATS) {
      this.dialogue.show(`${OFFICER.name} (${OFFICER.role})`, beat.text, { portrait: OFFICER.id });
      await this.#beat(beat.ms);
    }
    this.dialogue.hide();
    this.done = true;
    this.#curtain();
  }

  /** 연출용 사이 — delayedCall 을 await 할 수 있게 감싼다 (다른 씬의 #beat 와 같은 모양). */
  #beat(ms) {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  /**
   * 막이 내린다 — 내레이션 두 장을 거쳐 태엽새가 나는 파이널 타블로.
   *
   * 예전에는 여기서 캔버스에 모노스페이스 글자 두 줄을 직접 그렸다. 연출은 전부
   * DOM(ui/EndingCurtain.js)으로 옮겼다 — 타이틀 화면과 같은 서체·조명을 그대로
   * 쓰기 위해서다. 카메라는 접기만 하고 다시 밝히지 않는다 (커튼이 위를 덮는다).
   */
  #curtain() {
    this.cameras.main.fadeOut(1200, 0, 0, 0);
    this.uiCam?.fadeOut(1200, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => new EndingCurtain().play());
  }

  /** 조작이 없는 씬이다 — 플레이어는 그 자리에 서 있고, 연출(#playReport)이 전부 끈다. */
  update() {
    this.player.body.setVelocity(0, 0);
    this.playerVisual.update();

    // 보고를 넘기거나 멈출 길은 없다 — [Esc] 는 오직 설정 창을 연다. 막이 내리기
    // 전까지는 여기도 판 위라 openPaused 로 씬을 세운 채 띄운다.
    if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
      this.settings.openPaused(this, () => this.keyEsc.reset());
    }
  }
}
