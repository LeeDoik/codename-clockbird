import Phaser from 'phaser';
import { DialogueBox } from '../ui/DialogueBox.js';
import { SettingsPanel } from '../ui/SettingsPanel.js';
import { EndingCurtain } from '../ui/EndingCurtain.js';
import {
  applyMovement,
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
import { InteractionManager } from '../world/interact.js';
import { playBgm, setLoop, GAMEPLAY_BGM_VOLUME } from '../audio/SoundManager.js';
import hqData from '../assets/hq.json';
import hqProps from '../assets/hq-props.json';

/**
 * 엔딩 — 본부 귀환.
 *
 * 시작한 곳으로 돌아와 끝난다. 새 아트가 한 장도 필요 없다는 점이 이 안을 고른
 * 이유다 (스펙 §2) — 튜토리얼의 맵·간부·대화 체계를 그대로 쓴다.
 *
 * 여기엔 규칙이 없다. 걸어가서 [E] 한 번이 전부다.
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

const LINES = [
  '"…살아 돌아왔군."\n\n브란트가 서류를 받아 든다. 한 장 한 장, 말없이.',
  '"자유 의지를 가진 로봇이라."\n\n그가 서류를 덮는다.\n\n"저쪽도 우리와 같은 것을 만들고 있었다는 뜻이다."',
  '"쉬어라. 오래는 못 쉰다."\n\n창밖에서 첫 기적이 울린다. 반격의 서막이다.',
];

export class EndingScene extends Phaser.Scene {
  constructor() {
    super('Ending');
  }

  init() {
    this.step = 0;
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

    // InteractionManager 는 대화창을 직접 부린다 — 생성자가 dialogue 를 받는다.
    this.interact = new InteractionManager(this, this.dialogue, PLAYER_HEIGHT);
    // onInteract 가 있으면 type 별 기본 동작을 제치고 이쪽이 불린다 (interact.js:129-132).
    this.interact.register({
      id: 'officer',
      type: 'npc',
      sprite: this.officerNode,
      onInteract: () => this.#report(),
    });

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.keyE = this.input.keyboard.addKey('E');
    // 각 대사가 문단(\n\n)을 두세 개씩 품고 있어 DialogueBox#paginate 가 여러 페이지로
    // 쪼갠다 — 힌트("[Space] 다음 · [Esc] 닫기")를 실제로 동작시키려면 튜토리얼·거리·
    // 저택 씬과 같은 방식으로 Space/Esc 를 직접 받아 dialogue.advance()/hide() 에
    // 연결해야 한다 (브리프 원문엔 이 두 키가 빠져 있었다 — task-13-report.md 참고).
    this.keySpace = this.input.keyboard.addKey('SPACE');
    this.keyEsc = this.input.keyboard.addKey('ESC');
    this.settings = new SettingsPanel();
  }

  /** [E] 한 번에 한 줄. 마지막 줄을 읽고 창을 닫으면 update() 가 막을 내린다. */
  #report() {
    if (this.done || this.step >= LINES.length) return;
    this.dialogue.show(`${OFFICER.name} (${OFFICER.role})`, LINES[this.step], {
      portrait: OFFICER.id,
    });
    this.dialogue.setHint('[Space] 다음 · [Esc] 닫기');
    this.step += 1;
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

  update() {
    if (this.done) {
      this.player.body.setVelocity(0, 0);
      this.playerVisual.update();
      return;
    }

    // 마지막 줄까지 읽고 창을 닫은 순간이 끝이다.
    if (this.step >= LINES.length && !this.dialogue.isOpen) {
      this.done = true;
      this.#curtain();
      return;
    }

    // 대화 중에는 걷지 않는다.
    let moving = false;
    if (this.dialogue.isOpen) this.player.body.setVelocity(0, 0);
    else moving = applyMovement(this.player, { cursors: this.cursors, wasd: this.wasd });
    setLoop('walk', moving);
    this.playerVisual.update();

    this.interact.update(this.player);
    // 대화 중엔 E/Space 모두 "다음 페이지" (마지막 페이지에서는 dialogue.advance() 가
    // onPagesDone 없이 알아서 닫는다) — 닫혀 있을 때만 E 가 간부와의 상호작용을 연다.
    // 그래야 페이지가 남았는데 E 를 연타해 다음 대사로 건너뛰는 일이 없다.
    const pressedE = Phaser.Input.Keyboard.JustDown(this.keyE);
    const pressedSpace = Phaser.Input.Keyboard.JustDown(this.keySpace);
    const pressedEsc = Phaser.Input.Keyboard.JustDown(this.keyEsc);
    if (this.dialogue.isOpen) {
      if (pressedE || pressedSpace) this.dialogue.advance();
      if (pressedEsc) this.dialogue.hide();
    } else if (pressedE) {
      this.interact.trigger();
    } else if (pressedEsc) {
      // 대화창이 없을 때의 [Esc] — 설정 창. 막이 내리기 전까지는 여기도 판 위다.
      this.settings.openPaused(this, () => this.keyEsc.reset());
    }
  }
}
