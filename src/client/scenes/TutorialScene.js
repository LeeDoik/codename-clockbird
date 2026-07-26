import Phaser from 'phaser';
import { DialogueBox } from '../ui/DialogueBox.js';
import tutorialMapData from '../assets/map-tutorial.json';
import officerPortraitUrl from '../assets/portraits/officer.png';
import companion1PortraitUrl from '../assets/portraits/companion1.png';
import companion2PortraitUrl from '../assets/portraits/companion2.png';
import companion3PortraitUrl from '../assets/portraits/companion3.png';

/**
 * 튜토리얼(레지스탕스 본부) — 스테이지1(저택)과는 별개의 작은 공간.
 * 브란트(간부) + 에이다/토마스/리아(본부 인력)에게 규칙을 배우는 연습 라운드다.
 *
 * 스테이지1과 달리 서버/세션이 없다 — 접선 코드는 고정값("사과")이고 클라이언트에서
 * 바로 비교한다. 통과하면 Boot 가 미리 fetch 해둔 스테이지1 상태(registry 의
 * startPromise, IntroScene.js 와 동일한 패턴)를 받아 'Stage' 씬으로 넘어간다.
 */
const SPEED = 200;
const TALK_RANGE = 48;
const TILE = tutorialMapData.tileSize;
const PLAYER_FRAME = 0;
// chars.png 의 같은 placeholder 프레임 — 스테이지1 동료와 겹치지 않는 공간이라 재사용해도 안전하다.
const COMPANION_FRAME = 6;
const COMPANION_TINTS = [0xb08a5a, 0x6a8ab0, 0x9a6ab0];

// 연습용 접선 코드 — 나중에 바꾸기 쉽도록 상수로 뺐다.
const TUTORIAL_CODE = '사과';

// 힌트는 personas.json 의 cast(에이다=companion1/토마스=companion2/리아=companion3)
// 캐릭터성에 맞춰 짧게 썼다. "사과"를 직접 말하지 않고 각자 관점에서 다르게 흘린다.
const TUTORIAL_COMPANIONS = [
  { id: 'companion1', name: '에이다', portrait: companion1PortraitUrl, hint: '"이번 접선 코드는... 빨간 게 특징이야."' },
  { id: 'companion2', name: '토마스', portrait: companion2PortraitUrl, hint: '"겉은 매끈하고, 베어 물면 사각거리는 소리가 난다더군."' },
  { id: 'companion3', name: '리아', portrait: companion3PortraitUrl, hint: '"동그랗고, 손에 쥐면 딱 좋은 크기지."' },
];

export class TutorialScene extends Phaser.Scene {
  constructor() {
    super('Tutorial');
  }

  init() {
    this.nearbyOfficer = false;
    this.nearbyCompanion = null;
  }

  create() {
    this.dialogue = new DialogueBox();
    this.dialogue.onCode = (guess) => this.#submitGuess(guess);

    this.#buildMap();

    const ps = tutorialMapData.spawns.player;
    this.player = this.add.sprite(ps.col * TILE + TILE / 2, ps.row * TILE + TILE / 2, 'chars', PLAYER_FRAME);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.player.body.setSize(16, 14).setOffset(8, 16);
    this.physics.add.collider(this.player, this.walls);

    this.companionNodes = [];
    (tutorialMapData.spawns.companions ?? []).forEach((sp, i) => {
      const info = TUTORIAL_COMPANIONS[i];
      if (!info) return;
      const x = sp.col * TILE + TILE / 2;
      const y = sp.row * TILE + TILE / 2;
      const node = this.add.sprite(x, y, 'chars', COMPANION_FRAME).setTint(COMPANION_TINTS[i] ?? 0xffffff);
      this.add
        .text(x, y - 24, info.name, {
          fontFamily: 'Malgun Gothic, sans-serif',
          fontSize: '11px',
          color: '#8a7f6a',
        })
        .setOrigin(0.5);
      this.companionNodes.push({ info, node });
    });

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.keyE = this.input.keyboard.addKey('E');
    this.keySpace = this.input.keyboard.addKey('SPACE');
    this.keyEsc = this.input.keyboard.addKey('ESC');

    this.promptIcon = this.add
      .text(0, 0, '[E]', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '11px',
        color: '#1a1712',
        backgroundColor: '#c9a227',
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(900)
      .setVisible(false);

    this.add.text(12, this.scale.height - 22, '[E] 상호작용', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '11px',
      color: '#6b6152',
    });

    this.#showBriefing();
  }

  #showBriefing() {
    this.dialogue.show(
      '접선 지령',
      '레지스탕스 본부다.\n\n' +
        '에이다, 토마스, 리아가 접선 코드에 대한 단서를 하나씩 쥐고 있다.\n' +
        '[E] 로 말을 걸어 단서를 모으고, 브란트에게 접선 코드를 보고하라.\n\n' +
        '[E] 상호작용',
    );
    this.dialogue.setHint('[Space] / [Esc] 로 쪽지를 접는다');
  }

  /**
   * 타일맵 렌더 + 충돌 + 브란트 렌더링. StageScene#buildMap 과 같은 구조.
   */
  #buildMap() {
    this.walls = this.physics.add.staticGroup();
    const { layout, tiles, rows, cols } = tutorialMapData;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const f = layout[r][c];
        if (f < 0) continue;
        if (tiles[f].solid) {
          this.walls.create(c * TILE + TILE / 2, r * TILE + TILE / 2, 'tiles', f);
        } else {
          this.add.image(c * TILE, r * TILE, 'tiles', f).setOrigin(0, 0);
        }
      }
    }

    // 브란트 — 4방향 스프라이트 시트에서 정면만 잘라 배경을 지운 정사각(360x360) 이미지를
    // 별도 텍스처로 확대 렌더링한다 (StageScene 과 동일한 처리, BootScene 이 이미 프리로드해둔 텍스처 재사용).
    const op = tutorialMapData.spawns.officer;
    if (op) {
      this.officerPos = { x: op.col * TILE + TILE / 2, y: op.row * TILE + TILE / 2 };
      const feetY = this.officerPos.y + TILE / 2;
      const officerHeight = 80;
      this.add
        .image(this.officerPos.x, feetY, 'officerStandee')
        .setDisplaySize(officerHeight, officerHeight)
        .setOrigin(0.5, 1);
      this.add
        .text(this.officerPos.x, feetY - officerHeight - 10, '브란트', {
          fontFamily: 'Malgun Gothic, sans-serif',
          fontSize: '11px',
          color: '#8a7f6a',
        })
        .setOrigin(0.5);
      this.officerIconY = feetY - officerHeight - 26;
    }
  }

  update() {
    const typing = this.dialogue.isTyping;
    const body = this.player.body;

    if (typing) {
      body.setVelocity(0, 0);
    } else {
      const left = this.cursors.left.isDown || this.wasd.A.isDown;
      const right = this.cursors.right.isDown || this.wasd.D.isDown;
      const up = this.cursors.up.isDown || this.wasd.W.isDown;
      const down = this.cursors.down.isDown || this.wasd.S.isDown;

      body.setVelocity(
        (right ? SPEED : 0) - (left ? SPEED : 0),
        (down ? SPEED : 0) - (up ? SPEED : 0),
      );
    }

    this.#checkProximity();

    if (!typing && Phaser.Input.Keyboard.JustDown(this.keyE)) {
      if (this.nearbyOfficer) this.#talkToOfficer();
      else if (this.nearbyCompanion) this.#talkToCompanion(this.nearbyCompanion);
    }
    if (!typing && Phaser.Input.Keyboard.JustDown(this.keySpace)) {
      this.dialogue.hide();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
      this.dialogue.hide();
    }
  }

  #checkProximity() {
    let officer = false;
    if (this.officerPos) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.officerPos.x, this.officerPos.y);
      officer = dist < TALK_RANGE;
    }

    let companion = null;
    let companionNode = null;
    if (!officer) {
      let nearestCompanion = Infinity;
      for (const entry of this.companionNodes) {
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, entry.node.x, entry.node.y);
        if (dist < TALK_RANGE && dist < nearestCompanion) {
          nearestCompanion = dist; companion = entry.info; companionNode = entry.node;
        }
      }
    }

    this.nearbyOfficer = officer;
    this.nearbyCompanion = companion;

    if (this.dialogue.isOpen) {
      this.promptIcon.setVisible(false);
    } else if (officer) {
      this.promptIcon.setPosition(this.officerPos.x, this.officerIconY).setText('[E]').setVisible(true);
    } else if (companionNode) {
      this.promptIcon.setPosition(companionNode.x, companionNode.y - 40).setText('[E]').setVisible(true);
    } else {
      this.promptIcon.setVisible(false);
    }
  }

  /** 본부 인력 — 선택지 없이 초상화+힌트 한 줄만 보여준다. */
  #talkToCompanion(companion) {
    this.dialogue.show(companion.name, companion.hint, companion.portrait);
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  /** 브란트 — 초상화+대사와 함께 접선 코드 입력창을 연다. */
  #talkToOfficer() {
    this.dialogue.show(
      '브란트 (간부)',
      '"동료들 단서는 다 모았나? 접선 코드를 말해봐라."',
      officerPortraitUrl,
    );
    this.dialogue.showInput('접선 코드 입력...', 'code');
    this.dialogue.setHint('[Enter] 코드 전달 · [Esc] 취소');
  }

  /** 정답이면 미리 fetch 해둔 스테이지1 상태로 전환, 틀리면 페널티 없이 재입력. */
  #submitGuess(guess) {
    if (guess.trim() === TUTORIAL_CODE) {
      this.dialogue.hideInput();
      this.dialogue.setHint('');
      this.dialogue.show('통과', '"...좋다. 준비는 끝났군."\n\n저택으로 향한다.', officerPortraitUrl);
      Promise.resolve(this.registry.get('startPromise')).then((res) => {
        if (!res || res.error) {
          this.dialogue.show('오류', res?.error ?? '스테이지 시작에 실패했습니다.');
          return;
        }
        this.scene.start('Stage', { state: res.state });
      });
      return;
    }

    this.dialogue.show('브란트 (간부)', '"틀렸다. 동료들 말을 다시 잘 들어봐라."', officerPortraitUrl);
    this.dialogue.showInput('접선 코드 입력...', 'code');
    this.dialogue.setHint('[Enter] 코드 전달 · [Esc] 취소');
  }
}
