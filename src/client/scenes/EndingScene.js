import Phaser from 'phaser';
import { DialogueBox } from '../ui/DialogueBox.js';
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
import { InteractionManager } from '../world/interact.js';
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

// 브란트(간부) 아이들 모션 — TutorialScene 과 같은 값
const OFFICER_FRAME = 432;
const OFFICER_CONTENT_HEIGHT = 408;
const OFFICER_ORIGIN_Y = 426 / OFFICER_FRAME;

// 플레이어는 튜토리얼과 같은 외형이다 — TutorialScene 의 값과 같아야 한다.
const PLAYER_FRAME = 0;
// 브리프 원문은 218/256·197·32 였으나, TutorialScene.js:66-68 의 실제 값(176/256·176·56)과
// 어긋나 "튜토리얼과 같은 외형이어야 한다"는 브리프 자신의 의도와 모순됐다 — 실제 소스를
// 따른다 (task-13-report.md 참고).
/** 화면에 보일 인물 높이 — 맵이 정한다 (worldParts.DEFAULT_CHAR_HEIGHT 참고). */
const PLAYER_HEIGHT = hqData.charHeight ?? DEFAULT_CHAR_HEIGHT;
/** 간부도 플레이어와 키를 맞춘다 (TutorialScene 과 같은 값이어야 한다). */
const OFFICER_SCALE = PLAYER_HEIGHT / OFFICER_CONTENT_HEIGHT;

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
      .sprite(os.col * TILE + TILE / 2, os.row * TILE + TILE / 2, 'officerIdle', 0)
      .setOrigin(0.5, OFFICER_ORIGIN_Y)
      .setDisplaySize(OFFICER_FRAME * OFFICER_SCALE, OFFICER_FRAME * OFFICER_SCALE)
      .play('officerIdle');

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

  /** 마지막 화면 — To be continued. */
  #curtain() {
    this.cameras.main.fadeOut(1200, 0, 0, 0);
    this.uiCam?.fadeOut(1200, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      const text = this.add
        .text(960, 540, '코드네임: 태엽새\n\nTo be continued', {
          fontFamily: 'monospace',
          fontSize: '44px',
          color: '#d9cfc0',
          align: 'center',
          lineSpacing: 12,
        })
        .setOrigin(0.5)
        .setAlpha(0);
      this.asUi(text);
      // 페이드아웃된 카메라 위에 UI 카메라만 다시 밝힌다 — 월드는 어두운 채로 둔다.
      this.uiCam.fadeIn(900, 0, 0, 0);
      this.tweens.add({ targets: text, alpha: 1, duration: 1400, delay: 300 });
    });
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
    if (this.dialogue.isOpen) this.player.body.setVelocity(0, 0);
    else applyMovement(this.player, { cursors: this.cursors, wasd: this.wasd });
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
    }
  }
}
