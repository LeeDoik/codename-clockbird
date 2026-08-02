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
import { MinigamePanel } from '../ui/MinigamePanel.js';
import { DialogueBox } from '../ui/DialogueBox.js';
import { runRobotInterrogation } from '../minigames/robotInterrogation.js';

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

    this.panel = new MinigamePanel();
    this.dialogue = new DialogueBox();
    // Object.values(at(...)) 는 at() 이 { x, y } 순서로 리턴하는 데 암묵적으로 기대던 것 —
    // 그 리터럴 순서가 바뀌면(예: { y, x }) 에러 없이 좌표가 뒤바뀐다. 명시적으로 뽑는다.
    const childPos = at(CHILD.col, CHILD.row);
    this.child = this.add.sprite(childPos.x, childPos.y, 'chars', 5);
    this.asWorld?.(this.child);

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

    // 심문실 도달 — 한 번만 발동한다.
    if (!this.ended) {
      const c = at(CHILD.col, CHILD.row);
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, c.x, c.y) < TILE * 2) {
        this.#startInterrogation();
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
   * 루즈함의 주범이 된다 (스펙 §1 기각 이유).
   *
   * 재시도 총 소요는 약 1.1초다 — 정지 0.4 + 페이드아웃 0.4 + 페이드인 0.3.
   * (스펙 초안의 2.7초는 어림이 틀린 값이었다. 이 셋을 만지면 여기 숫자도 같이 고칠 것.)
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

  /** 심문 개시 — 여기서부터 탈출 규칙은 멈추고 서버와 왕복한다. */
  async #startInterrogation() {
    if (this.ended) return;
    this.ended = true; // update() 의 탈출 로직을 멈춘다
    this.player.body.setVelocity(0, 0);

    const post = async (path, body = {}) => {
      const res = await fetch(`/api/escape${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json;
    };

    let sessionId = null;
    const outcome = await runRobotInterrogation(this.panel, {
      fetchStart: async () => {
        const r = await post('/interrogation/start');
        sessionId = r.state.sessionId;
        return r;
      },
      showIntro: (child) => this.#showChildIntro(child),
      pickIdentity: (identityId) => post('/interrogation/identity', { sessionId, identityId }),
      fetchQuestion: () => post('/interrogation/question', { sessionId }),
      submitAnswer: (answer) => post('/interrogation/answer', { sessionId, answer }),
    });

    if (outcome === 'win') {
      this.#toEnding();
      return;
    }
    // 패배·오류는 심문 직전으로 되돌린다 — 여기서 결과 화면을 덮으면 마지막 장면이
    // 통째로 날아간다. 탈출을 다시 걷게 하지도 않는다 (마지막 체크포인트에서 시작).
    //
    // #respawn() 끝의 fadeIn 은 #caught() 가 먼저 fadeOut 한 뒤 부르는 것을 전제로
    // 한다 — 화면이 이미 검게 죽어 있어야 다시 밝아지는 연출이 자연스럽다. 이 경로는
    // fadeOut 없이 밝은 화면 그대로 들어오므로, fadeOut 없이 바로 #respawn() 을 부르면
    // 멀쩡한 화면이 느닷없이 검게 깜빡였다 돌아온다. #caught() 와 같은 순서(먼저
    // fadeOut, 완료되면 #respawn())로 맞춘다.
    //
    // respawning 을 fadeOut 시작 전에 세운다 — update() 는 ended || respawning 일 때만
    // 이동을 얼린다. ended 를 먼저 false 로 내리면 fadeOut 이 끝나는 400ms 동안 둘 다
    // false 인 틈이 생겨, 화면이 검은 채로 캐릭터가 움직여 버린다.
    this.respawning = true;
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.ended = false;
      this.#respawn();
    });
  }

  #toEnding() {
    this.cameras.main.fadeOut(900, 0, 0, 0);
    this.uiCam?.fadeOut(900, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Ending'));
  }

  /**
   * 심문 전 반전 대사 — "사실 나는 로봇이야." 이 게임 전체의 반전이라 심문 패널의
   * 작은 상태줄이 아니라 DialogueBox 로 세운다 (StageScene#toMansion 과 같은 방식:
   * 대사를 띄우고 시간을 두었다 다음 줄로 넘긴다, 입력 대기가 아니다).
   *
   * 정체를 밝히기 전에는 '아이', 밝힌 뒤에는 '꼬마' — 아직 이름이 없는 인물이다.
   * portrait: 'child' 는 아직 파일이 없어 안 뜨지만(DialogueBox 가 조용히 no-portrait
   * 로 떨어진다), 아트가 들어오면 이 한 줄로 붙는다.
   */
  async #showChildIntro(child) {
    this.dialogue.show('아이', child.greet, { portrait: 'child' });
    await this.#beat(2600);
    this.dialogue.show('꼬마', child.reveal, { portrait: 'child' });
    await this.#beat(4200);
    this.dialogue.hide();
  }

  /** 연출용 사이 — delayedCall 을 await 할 수 있게 감싼다 (StageScene#beat 과 같은 모양). */
  #beat(ms) {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }
}

// Interfaces 계약: 씬이 SEGMENTS · CHECKPOINTS 를 export 한다 (Task 8~10 이 참조).
// 값 자체는 escapeLayout.js 가 유일한 출처다 — 여기서는 그 값을 이름만 바꿔 다시
// 내보낼 뿐, 좌표를 이 파일에 다시 적지 않는다.
export { CHECKPOINTS };
export { CORRIDORS as SEGMENTS } from '../world/escapeLayout.js';
