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

/**
 * 발각 게이지 — 0 에서 시작해 오르고 100 에서 터진다.
 * (심문의 탐지 게이지는 100 에서 시작해 내려간다. 방향이 반대이므로 이름을 절대 섞지 않는다.)
 */
const GAUGE_MAX = 100;
/** 콘 안에 있을 때 초당 상승 — 약 1.8초 노출이면 터진다 */
const GAUGE_RISE = 55;
/** 콘 밖일 때 초당 하강 — 약 2.5초면 회복 */
const GAUGE_FALL = 40;
/**
 * 콘을 벗어난 뒤 하강이 시작되기까지의 유예 (ms).
 * 이게 없으면 콘 경계에서 게이지가 깜빡이며 오르내려 플레이어가 규칙 자체를 못 읽는다.
 */
const GAUGE_GRACE_MS = 1000;
/** 리스폰 직후 감지하지 않는 시간 (ms) */
const RESPAWN_GRACE_MS = 1500;

export class EscapeScene extends Phaser.Scene {
  constructor() {
    super('Escape');
  }

  init() {
    this.ended = false;
    this.gauge = 0;
    /** 콘 밖으로 나온 뒤 하강이 시작되는 시각 */
    this.fallAt = 0;
    /** 이 시각 전에는 감지하지 않는다 (리스폰 직후) */
    this.graceUntil = 0;
    /** 지금까지 발각된 횟수 — 페널티는 없고 밸런싱·영상용으로만 센다 */
    this.retries = 0;
    /** 마지막으로 통과한 체크포인트 번호 */
    this.checkpoint = 0;
    /** 리스폰 연출 중 — update 를 통째로 멈춘다 */
    this.respawning = false;
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

    // 게이지 바와 비네트는 화면 고정이다 — UI 카메라에 붙인다.
    this.gaugeBg = this.add.rectangle(960, 40, 420, 14, 0x000000, 0.45);
    this.gaugeFill = this.add.rectangle(960 - 210, 40, 0, 14, 0xc25b4a, 0.95).setOrigin(0, 0.5);
    this.vignette = this.add.rectangle(960, 540, 1920, 1080, 0xc2251a, 0).setOrigin(0.5);
    this.retryText = this.add.text(1880, 24, '', {
      fontFamily: 'monospace', fontSize: '20px', color: '#8a8378',
    }).setOrigin(1, 0);
    this.asUi(this.gaugeBg, this.gaugeFill, this.vignette, this.retryText);

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
    if (this.ended || this.respawning) {
      this.player.body.setVelocity(0, 0);
      for (const s of this.sentries) s.update(delta, null);
      this.playerVisual.update();
      return;
    }

    applyMovement(this.player, { cursors: this.cursors, wasd: this.wasd });
    this.playerVisual.update();

    // 앞선 체크포인트에 몸이 닿으면 거기까지 통과한 것으로 친다. 뒤로 돌아가도
    // 번호는 내려가지 않는다 — 되돌아갔다고 벌을 주면 살펴보는 행동이 위험해진다.
    for (let i = CHECKPOINTS.length - 1; i > this.checkpoint; i--) {
      const p = at(CHECKPOINTS[i].col, CHECKPOINTS[i].row);
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, p.x, p.y) < TILE * 2) {
        this.checkpoint = i;
        console.log(`[escape] 체크포인트 ${i}`);
        break;
      }
    }

    let seen = false;
    const canDetect = this.time.now >= this.graceUntil;
    for (const s of this.sentries) {
      if (s.update(delta, canDetect ? this.player : null)) seen = true;
    }

    if (seen) {
      this.gauge = Math.min(GAUGE_MAX, this.gauge + (GAUGE_RISE * delta) / 1000);
      this.fallAt = this.time.now + GAUGE_GRACE_MS;
    } else if (this.time.now >= this.fallAt) {
      this.gauge = Math.max(0, this.gauge - (GAUGE_FALL * delta) / 1000);
    }

    this.#drawGauge();

    if (this.gauge >= GAUGE_MAX) this.#caught();
  }

  #drawGauge() {
    const ratio = this.gauge / GAUGE_MAX;
    this.gaugeFill.width = 420 * ratio;
    // 게이지가 오르는 동안 화면 가장자리가 붉어진다 — 바를 안 보고 있어도 읽힌다.
    this.vignette.fillAlpha = 0.28 * ratio;
    this.retryText.setText(this.retries ? `재시도 ${this.retries}` : '');
  }

  /**
   * 발각 — 결과 화면을 띄우지 않고 직전 체크포인트로 돌려보낸다.
   *
   * 계획서는 "즉시 게임오버"였지만 1분 30초짜리 맵을 통째로 다시 걷게 하면 그것이
   * 루즈함의 주범이 된다 (스펙 §1 기각 이유). 재시도 총 소요는 약 2.7초다.
   */
  #caught() {
    if (this.respawning || this.ended) return;
    this.respawning = true;
    this.retries += 1;
    this.player.body.setVelocity(0, 0);

    this.cameras.main.flash(220, 194, 37, 26);
    this.time.delayedCall(400, () => {
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.#respawn());
    });
  }

  #respawn() {
    const cp = CHECKPOINTS[this.checkpoint];
    const p = at(cp.col, cp.row);
    this.player.setPosition(p.x, p.y);
    this.gauge = 0;
    this.fallAt = 0;
    // 순찰 위상을 되돌리지 않으면 리스폰하자마자 코앞에 로봇이 있는 판이 반복된다.
    // 게이지만 0으로 돌리고 로봇을 그대로 두는 것이 이 설계의 최악 실패다 (스펙 §6).
    for (const s of this.sentries) s.reset();
    this.graceUntil = this.time.now + RESPAWN_GRACE_MS;
    this.respawning = false;
    this.cameras.main.fadeIn(300, 0, 0, 0);
  }
}

// Interfaces 계약: 씬이 SEGMENTS · CHECKPOINTS 를 export 한다 (Task 8~10 이 참조).
// 값 자체는 escapeLayout.js 가 유일한 출처다 — 여기서는 그 값을 이름만 바꿔 다시
// 내보낼 뿐, 좌표를 이 파일에 다시 적지 않는다.
export { CHECKPOINTS };
export { CORRIDORS as SEGMENTS } from '../world/escapeLayout.js';
