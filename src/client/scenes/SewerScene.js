import Phaser from 'phaser';
import {
  buildColliders,
  createPlayer,
  createPlayerVisual,
  applyMovement,
  setupCameras,
} from '../world/worldParts.js';
import { CSS, FONTS } from '../ui/theme.js';
import sewerData from '../assets/sewer.json';
import sewerProps from '../assets/sewer-props.json';

/**
 * 스테이지3 — 지하수로.
 *
 * 저택을 클리어하면 여기로 넘어온다. 아직 NPC·퍼즐 설계가 없어서 이번 범위는
 * 걸어 다니며 새 맵을 확인하는 것뿐이다 — 접선도 판정도 없다.
 */
const TILE = sewerData.tileSize;
const PLAYER_FRAME = 0;

// 플레이어(지하수로 전용 외형): 256×256 프레임, 인물은 y[42,216] 영역(실측).
// 다른 스테이지 NPC 가 아직 없는 새 씬이라 스테이지1 과 같은 32px 로 맞춘다.
const PLAYER_ANIM = {
  idle: 'sewerPlayerIdle',
  walkDown: 'sewerPlayerWalkDown',
  walkUp: 'sewerPlayerWalkUp',
  walkLeft: 'sewerPlayerWalkLeft',
};
const PLAYER_ORIGIN_Y = 216 / 256;
const PLAYER_CONTENT_HEIGHT = 174;
const PLAYER_HEIGHT = 32;

// 은/엄폐물 — 배경에 안 굽고 따로 얹은 소품(각자 원본 크기의 절반쯤으로 축소).
// 스텔스 메커닉이 붙으면 이 자리들이 엄폐 판정 지점이 된다.
const PROPS = [
  { key: 'sewer-crate', col: 8, row: 5, scale: 0.18 },
  { key: 'sewer-barrels', col: 46, row: 5, scale: 0.2 },
  { key: 'sewer-pillar', col: 6, row: 30, scale: 0.16 },
  { key: 'sewer-moss', col: 46, row: 35, scale: 0.16 },
];

export class SewerScene extends Phaser.Scene {
  constructor() {
    super('Sewer');
  }

  create() {
    this.add.image(0, 0, 'sewer-bg').setOrigin(0, 0).setDepth(-100);
    this.walls = buildColliders(this, sewerData, sewerProps.blocked);

    for (const p of PROPS) {
      const x = p.col * TILE + TILE / 2;
      const y = p.row * TILE + TILE / 2;
      this.add.image(x, y, p.key).setScale(p.scale).setOrigin(0.5, 0.85);
    }

    this.player = createPlayer(this, sewerData, this.walls, PLAYER_FRAME);
    this.player.setVisible(false);
    this.playerVisual = createPlayerVisual(
      this,
      this.player,
      PLAYER_ANIM,
      PLAYER_ORIGIN_Y,
      PLAYER_CONTENT_HEIGHT,
      PLAYER_HEIGHT,
    );
    setupCameras(this, sewerData, this.player);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');

    this.asUi(
      this.add.text(20, 16, '지하수로 — (개발 중)', {
        fontFamily: FONTS.body,
        fontSize: '22px',
        color: CSS.paperDim,
      }),
    );
  }

  update() {
    applyMovement(this.player, { cursors: this.cursors, wasd: this.wasd });
    this.playerVisual.update();
  }
}
