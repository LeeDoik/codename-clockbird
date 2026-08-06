import Phaser from 'phaser';
import { hasLineOfSight, rayDistance, LOS_STEP } from '../world/los.js';
import { randomRoamPath } from '../world/roam.js';
import {
  CHAR_HEIGHT,
  CONE_ANGLE,
  CONE_RANGE,
  ROAM_MIN_STEPS,
  SENTRY_SPEED,
  TURN_PAUSE_MS,
  TURN_RATE,
} from '../world/escapeLayout.js';
import { facingName } from './facing.js';
import {
  SENTRY_ANIM,
  SENTRY_CONTENT_HEIGHT,
  SENTRY_FRAME_SIZE,
  SENTRY_ORIGIN_Y,
} from './sentrySprite.js';

/**
 * 부채꼴 시야 순찰 로봇 — 스테이지 3 탈출 전용.
 *
 * 거리(Patrol)는 앞뒤를 안 가리는 **원형 감지기**다. 열린 60×48 맵에서 부채꼴을 쓰면
 * 로봇 등 뒤에 붙어 따라다니는 것이 최적 전략이 되기 때문이다.
 *
 * 여기서는 부채꼴이 맞다. 폭 5칸 통로에서는 로봇 뒤로 돌아갈 공간 자체가 없어서
 * 그 악용이 성립하지 않고, 대신 "지금 어디가 위험한가"가 바닥에 그려진다.
 *
 * Patrol 을 고쳐 쓰지 않고 새로 만든 이유: Patrol 은 map.json 을 직접 import 하고
 * 거리 좌표를 상수로 들고 있다. 범용화하려면 사수 라인인 스테이지 1을 건드려야 한다.
 * 공유할 값어치가 있는 것(광선 판정)만 world/los.js 로 빼서 함께 쓴다.
 *
 * ── 순찰 방식 (2026-08-05) ──
 *
 * 고정 왕복 경로를 걷어내고 **무작위 순회**로 바꿨다. 갈 수 있는 칸 중 하나를
 * 뽑아 길찾기로 걸어가고, 닿으면 잠시 둘러본 뒤 다시 뽑는다. 왕복이던 시절에는 셋이
 * 세 복도를 일정한 주기로 지켜서 지나갈 틈이 아예 안 났다 (escapeLayout.SENTRY_HOMES).
 *
 * 길찾기(world/roam.js)가 필요한 이유는 이 로봇이 **길을 찾지 않기** 때문이다 — 두 점
 * 사이를 직선으로 갈 뿐이라, 목적지만 무작위로 뽑으면 물웅덩이를 가로질러 간다.
 * roam.js 가 꺾이는 칸만 남긴 길을 주고, 여기서는 그 직선 구간을 이어 달린다.
 *
 * 배회와 시야는 **다른 격자를 본다** (2026-08-07). walk 마스크는 플레이어용 관대한
 * 판정이라 바위섬·웅덩이 테두리 같은 "길 아닌" 칸도 열려 있는데, 로봇이 거길 목적지로
 * 찍으면 벽을 타는 것처럼 보였다. 그래서 길찾기는 도로로 제한한 roamBlocked 를 쓰고
 * (escapeLayout.makeRoamBlocked), 시야·감지는 그대로 isBlocked 를 쓴다 — 시야까지
 * 도로에 막히면 그려지는 콘과 판정이 어긋난다.
 */

/** 웨이포인트 도착 판정 반경 (px) */
const ARRIVE_EPS = 4;
/**
 * 콘 폭에 고르게 쏘는 광선 수(양 끝 포함) — 다각형의 꼭짓점 수가 된다.
 * escapeLayout.js 는 검증 스크립트가 봐야 하는 값만 두는 곳이라, 렌더 세부인
 * 이 값은 여기 둔다.
 */
const CONE_RAYS = 24;

export class Sentry {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} opts
   * @param {{x: number, y: number}} opts.home 출발 자리. 리스폰 때 여기로 되돌아온다.
   * @param {number} opts.tileSize
   * @param {number} opts.cols 맵 칸 수 — 길찾기가 격자를 훑는 범위다
   * @param {number} opts.rows
   * @param {(col: number, row: number) => boolean} opts.isBlocked 시야·감지가 보는 벽
   * @param {(col: number, row: number) => boolean} [opts.roamBlocked] 길찾기가 보는 벽 —
   *   도로 제한(escapeLayout.makeRoamBlocked). 안 주면 isBlocked 를 그대로 쓴다.
   */
  constructor(scene, { home, tileSize, cols, rows, isBlocked, roamBlocked, speed = SENTRY_SPEED,
    coneAngle = CONE_ANGLE, coneRange = CONE_RANGE }) {
    this.scene = scene;
    this.home = home;
    this.tileSize = tileSize;
    this.cols = cols;
    this.rows = rows;
    this.isBlocked = isBlocked;
    this.roamBlocked = roamBlocked ?? isBlocked;
    this.speed = speed;
    this.coneAngle = coneAngle;
    this.coneRange = coneRange;
    /** 지금 걷고 있는 길 — 꺾이는 칸과 목적지 (world/roam.js) */
    this.path = [];
    this.index = 0;

    /** 지금 재생 중인 애니메이션 키 — 같은 키를 다시 play() 하면 걸음이 첫 프레임으로 되감긴다. */
    this.anim = null;
    // 그림은 플레이어와 같은 규칙이다: **발**이 순찰 좌표에 놓이고, 화면에 보일 높이는
    // 맵이 정한 charHeight 다. 예전에는 chars.png 32px 프레임을 통째로 확대해 세웠다.
    //
    // ⚠ **재생을 먼저, 크기를 나중에** (Patrol 과 같은 함정 — 그쪽 주석 참고).
    const scale = CHAR_HEIGHT / SENTRY_CONTENT_HEIGHT;
    this.sprite = scene.add
      .sprite(home.x, home.y, SENTRY_ANIM.texture, 0)
      .setOrigin(0.5, SENTRY_ORIGIN_Y);
    this.#play(SENTRY_ANIM.idleDown);
    this.sprite.setDisplaySize(SENTRY_FRAME_SIZE * scale, SENTRY_FRAME_SIZE * scale);
    this.cone = scene.add.graphics();
    this.reset();
  }

  /** 같은 애니메이션을 다시 걸지 않는다 — 매 프레임 play() 하면 걸음이 첫 장에서 멈춘다. */
  #play(key) {
    if (this.anim === key) return;
    this.anim = key;
    this.sprite.play(key);
  }

  /**
   * 그림을 지금 보는 쪽으로 돌린다.
   *
   * 끝점에서 도는 1.5초 동안 `facing` 이 연속으로 회전하므로 **그 사이에도 그림이
   * 같이 돌아간다** — 콘만 돌고 몸이 굳어 있으면 어느 쪽을 보는지가 두 개로 갈려
   * 보인다. 이 스테이지는 "지금 어디가 위험한가"를 눈으로 읽는 게임이라, 몸과 콘이
   * 어긋나면 그 판단이 흔들린다.
   */
  #faceSprite() {
    const dir = facingName(this.facing);
    this.#play(SENTRY_ANIM[this.pauseLeft > 0 ? `idle${dir}` : `walk${dir}`]);
  }

  /**
   * 로봇을 제 자리(home)로 되돌리고 새 길을 고른다.
   *
   * 리스폰이 반드시 이걸 함께 불러야 한다 — 안 부르면 "리스폰하자마자 코앞에 로봇"이
   * 반복돼 재시도가 운에 좌우된다 (스펙 §3). 무작위 순회로 바꾸면서 이게 **더**
   * 중요해졌다: 고정 경로 시절에는 로봇이 어디 있을지 정해져 있었지만, 지금은
   * 죽는 순간 셋이 어디에 흩어져 있을지 알 수 없다. 되돌려 놓지 않으면 시작 지점
   * 옆에서 죽었을 때 그 옆에 로봇이 선 채로 부활한다.
   */
  reset() {
    this.sprite.setPosition(this.home.x, this.home.y);
    this.pauseLeft = 0;
    this.#pickPath();
    const next = this.path[0];
    this.facing = Math.atan2(next.y - this.home.y, next.x - this.home.x);
    // 정지 회전의 시작/목표 각. 지금은 정지 중이 아니라 둘 다 facing 과 같지만,
    // #move 가 pauseLeft>0 일 때만 읽으므로 다음 도착이 이 값들을 새로 채운다.
    this.turnFrom = this.facing;
    this.turnTo = this.facing;
  }

  /**
   * 다음 목적지와 거기까지의 길을 새로 뽑는다.
   *
   * 갈 곳이 없으면(사방이 막힌 자리) 제자리 한 점을 길로 둔다 — 다음 프레임에 곧바로
   * "도착"으로 처리되어 1.5초 뒤 다시 뽑는다. 빈 배열을 그대로 두면 #move 가 없는
   * 웨이포인트를 읽는다.
   */
  #pickPath() {
    const col = Math.floor(this.sprite.x / this.tileSize);
    const row = Math.floor(this.sprite.y / this.tileSize);
    const cells = randomRoamPath(
      { col, row },
      { cols: this.cols, rows: this.rows, isBlocked: this.roamBlocked, minSteps: ROAM_MIN_STEPS },
    );
    this.path = cells.map((c) => ({
      x: c.col * this.tileSize + this.tileSize / 2,
      y: c.row * this.tileSize + this.tileSize / 2,
    }));
    if (!this.path.length) this.path = [{ x: this.sprite.x, y: this.sprite.y }];
    this.index = 0;
  }

  /**
   * 한 프레임 전진하고 시야를 다시 그린다.
   * @param {number} delta ms
   * @param {{x: number, y: number}|null} target 감지 대상. null 이면 감지하지 않는다.
   * @returns {boolean} 이번 프레임에 대상이 시야 안에 있는가
   */
  update(delta, target) {
    this.#move(delta);
    this.#faceSprite();
    this.#drawCone();
    if (!target) return false;
    return this.sees(target);
  }

  #move(delta) {
    if (this.pauseLeft > 0) {
      // 정지 중에도 콘은 돈다 — turnFrom 에서 turnTo 로 정지 시간에 걸쳐 서서히
      // 돌려, "지금 지나갈까"를 판단할 1.5초를 실제로 준다. 그냥 굳어 있다가
      // 이동 재개 순간 홱 돌면 그 판단 시간이 아예 없어진다. 각도 차는 감아서
      // 재야 한다 — 그냥 빼면 −π/π 경계에서 반대로 돈다.
      this.pauseLeft -= delta;
      const t = 1 - Math.max(0, this.pauseLeft) / TURN_PAUSE_MS;
      const diff = Phaser.Math.Angle.Wrap(this.turnTo - this.turnFrom);
      this.facing = Phaser.Math.Angle.Wrap(this.turnFrom + diff * t);
      return;
    }

    const wp = this.path[this.index];
    const dx = wp.x - this.sprite.x;
    const dy = wp.y - this.sprite.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= ARRIVE_EPS) {
      this.index += 1;
      // 길 도중의 꺾임이면 멈추지 않는다 — 모퉁이마다 1.5초씩 서면 맵을 한 번
      // 가로지르는 데만 한나절이 걸린다. 콘은 아래에서 걸어가며 서서히 돈다.
      if (this.index < this.path.length) return;

      // 목적지다. 다음 갈 곳을 고르고, 그쪽을 향해 도는 동안 1.5초 서서 둘러본다 —
      // 플레이어가 "지금 지나갈까"를 판단할 시간이자 순회에 박자를 주는 정지다.
      this.turnFrom = this.facing;
      this.#pickPath();
      const next = this.path[0];
      this.turnTo = Math.atan2(next.y - this.sprite.y, next.x - this.sprite.x);
      this.pauseLeft = TURN_PAUSE_MS;
      return;
    }

    // 몸은 길을 따라 곧장 가고, 시야는 그 방향으로 **따라 돈다**. 예전에는 진행 방향이
    // 곧 시야 방향이었는데(왕복이라 방향이 둘뿐이었다) 지금은 모퉁이에서 90도씩 꺾여,
    // 그대로 두면 콘이 순간이동한다.
    const moveAngle = Math.atan2(dy, dx);
    const turnStep = Phaser.Math.DegToRad(TURN_RATE) * (delta / 1000);
    const diff = Phaser.Math.Angle.Wrap(moveAngle - this.facing);
    this.facing = Phaser.Math.Angle.Wrap(
      this.facing + Math.sign(diff) * Math.min(Math.abs(diff), turnStep),
    );

    const move = Math.min((this.speed * delta) / 1000, dist);
    this.sprite.x += Math.cos(moveAngle) * move;
    this.sprite.y += Math.sin(moveAngle) * move;
  }

  /**
   * 콘 폭에 광선 CONE_RAYS 개를 고르게 쏘아, 벽에 막힌 지점을 잇는 다각형을 그린다.
   *
   * 예전처럼 Graphics.arc() 로 통짜 부채꼴을 그리면 그려진 빨간 영역이 sees() 의
   * 실제 감지 영역(벽 뒤는 안 보임)의 상위집합이 된다 — 벽 너머 안전한 바닥이
   * 빨갛게 칠해진다. 이 스테이지의 난이도는 전부 "바닥에 그려진 위험을 읽는다"에
   * 걸려 있어서, 그려진 것과 실제 판정이 어긋나면 안전한 통로에서 플레이어가
   * 얼어붙는다 (설계 스펙 §3 — 광선이 벽·엄폐물에 막혀 콘을 잘라낸다).
   */
  #drawCone() {
    const half = Phaser.Math.DegToRad(this.coneAngle) / 2;
    const points = [{ x: this.sprite.x, y: this.sprite.y }];
    for (let i = 0; i < CONE_RAYS; i++) {
      const t = i / (CONE_RAYS - 1);
      const angle = this.facing - half + t * (2 * half);
      const dist = rayDistance(this.sprite, angle, this.coneRange, this.tileSize, this.isBlocked, LOS_STEP);
      points.push({ x: this.sprite.x + Math.cos(angle) * dist, y: this.sprite.y + Math.sin(angle) * dist });
    }

    this.cone.clear();
    // 안쪽을 옅게 채우고 가장자리를 진하게 둘러 경계가 어디까지인지 눈으로 재게 한다
    // (Patrol 의 원과 같은 원칙). 채우기만 하면 어디서부터 걸리는지 알 수 없다.
    //
    // 값이 예전(0.16 / 0.5)보다 진하다. 임시 배경은 짙은 남색이라 그 위에서는 옅어도
    // 읽혔는데, 수로 그림은 바닥이 밝은 돌이라 붉은 콘이 통째로 씻겨 사라졌다.
    // 이 스테이지의 난이도는 전부 "바닥에 그려진 위험을 읽는다"에 걸려 있다.
    this.cone.fillStyle(0xd8402c, 0.3);
    this.cone.fillPoints(points, true);
    this.cone.lineStyle(3, 0xff5a3c, 0.85);
    this.cone.strokePoints(points, true);
  }

  /** 대상이 부채꼴 안에 있고, 그 사이를 벽·엄폐물이 막지 않는가. */
  sees(target) {
    const dx = target.x - this.sprite.x;
    const dy = target.y - this.sprite.y;
    if (Math.hypot(dx, dy) > this.coneRange) return false;

    // 각도 차를 -π~π 로 감아서 잰다 — 그냥 빼면 경계에서 2π 만큼 어긋난다.
    const diff = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - this.facing));
    if (diff > Phaser.Math.DegToRad(this.coneAngle) / 2) return false;

    return hasLineOfSight(this.sprite, target, this.tileSize, this.isBlocked, LOS_STEP);
  }

  destroy() {
    this.sprite.destroy();
    this.cone.destroy();
  }
}
