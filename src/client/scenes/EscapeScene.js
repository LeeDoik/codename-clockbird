import Phaser from 'phaser';
import {
  applyMovement,
  buildColliders,
  createPlayer,
  createPlayerVisual,
  setupCameras,
} from '../world/worldParts.js';
import escapeData from '../assets/escape.json';
import { Sentry } from '../entities/Sentry.js';
import { makeBlockedLookup } from '../world/los.js';
// 좌표·상수의 단일 출처. 씬은 여기서만 읽는다 — 씬 안에 좌표를 다시 적지 않는다.
import { CHECKPOINTS, CHILD, SENTRY_ROUTES, TILE, at } from '../world/escapeLayout.js';

/**
 * 스테이지 3 — 저택 탈출.
 *
 * 저택에서 문서를 훔쳐 지하로 도망친 직후다. 여기서는 말이 통하지 않는다 —
 * 경비는 구형 순찰 로봇이고, 걸리면 변명할 기회가 없다 (이미 문서를 쥐고 있다).
 *
 * 길은 ㄹ자 한 줄이라 잃을 수 없다. 어려운 것은 길이 아니라 **언제 지나가느냐**다.
 */

// 플레이어는 저택과 같은 인물·같은 외형이다 (MansionScene 과 같은 값).
const PLAYER_FRAME = 0;
const PLAYER_ANIM = {
  idle: 'stage2PlayerIdle',
  walkDown: 'stage2PlayerWalkDown',
  walkUp: 'stage2PlayerWalkUp',
  walkLeft: 'stage2PlayerWalkLeft',
  walkRight: 'stage2PlayerWalkRight',
};
const PLAYER_ORIGIN_Y = 218 / 256;
const PLAYER_CONTENT_HEIGHT = 197;
const PLAYER_HEIGHT = 32;

export class EscapeScene extends Phaser.Scene {
  constructor() {
    super('Escape');
  }

  init() {
    this.ended = false;
  }

  create() {
    // 임시 배경 — 아트가 붙기 전까지 걷는 칸을 눈으로 구분하기 위한 것이다.
    // escape-bg.png 가 들어오면 이 블록을 this.add.image 한 줄로 갈아 끼운다.
    this.#drawPlaceholder();

    this.walls = buildColliders(this, escapeData);
    this.player = createPlayer(this, escapeData, this.walls, PLAYER_FRAME);
    this.player.setVisible(false);
    this.playerVisual = createPlayerVisual(
      this,
      this.player,
      PLAYER_ANIM,
      PLAYER_ORIGIN_Y,
      PLAYER_CONTENT_HEIGHT,
      PLAYER_HEIGHT,
    );

    this.isBlocked = makeBlockedLookup(escapeData);
    this.sentries = SENTRY_ROUTES.map(
      (route) => new Sentry(this, { route, tileSize: TILE, isBlocked: this.isBlocked }),
    );

    // 월드를 다 깐 직후·UI 를 만들기 전에 부른다 (worldParts.setupCameras 의 호출 시점 규약).
    setupCameras(this, escapeData, this.player);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
  }

  /** 걷는 칸만 옅게 칠한 임시 바닥. 아트가 붙으면 통째로 사라진다. */
  #drawPlaceholder() {
    const g = this.add.graphics().setDepth(-100);
    g.fillStyle(0x11131a, 1);
    g.fillRect(0, 0, escapeData.cols * TILE, escapeData.rows * TILE);
    g.fillStyle(0x39415c, 1);
    for (let r = 0; r < escapeData.rows; r++) {
      for (let c = 0; c < escapeData.cols; c++) {
        if (escapeData.layout[r][c] === 0) g.fillRect(c * TILE, r * TILE, TILE - 1, TILE - 1);
      }
    }
  }

  update(time, delta) {
    if (this.ended) {
      this.player.body.setVelocity(0, 0);
      for (const s of this.sentries) s.update(delta, null);
      this.playerVisual.update();
      return;
    }

    applyMovement(this.player, { cursors: this.cursors, wasd: this.wasd });
    this.playerVisual.update();

    let seen = false;
    for (const s of this.sentries) {
      if (s.update(delta, this.player)) seen = true;
    }
    // 게이지는 Task 9 에서 붙인다. 지금은 콘 안에 들어갔는지만 콘솔로 확인한다.
    if (seen !== this.wasSeen) {
      this.wasSeen = seen;
      console.log(seen ? '[escape] 시야 안' : '[escape] 시야 밖');
    }
  }
}

// Interfaces 계약: 씬이 SEGMENTS · CHECKPOINTS 를 export 한다 (Task 8~10 이 참조).
// 값 자체는 escapeLayout.js 가 유일한 출처다 — 여기서는 그 값을 이름만 바꿔 다시
// 내보낼 뿐, 좌표를 이 파일에 다시 적지 않는다.
export { CHECKPOINTS };
export { CORRIDORS as SEGMENTS } from '../world/escapeLayout.js';
