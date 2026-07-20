import Phaser from 'phaser';
import mapData from '../assets/map.json';

/**
 * 순찰 로봇.
 *
 * 웨이포인트를 하드코딩한다 — 맵이 1장뿐인 게임에서 map.json 포맷을 확장하는 건
 * 과투자다. 경로가 바뀔 일이 생기면 아래 상수만 고치면 된다.
 *
 * 밸런스 상수를 파일 맨 위에 모아 둔 이유: 플레이테스트 후 손댈 곳이 여기뿐이어야
 * 하기 때문이다. 순찰 속도는 어떤 경계 레벨에서도 플레이어(200)보다 느리다 —
 * 걸리면 무조건 검문이지 도망칠 방법이 없는 게임은 만들지 않는다.
 */
const SPEED_BASE = 60;
const SPEED_PER_LEVEL = 15;
const RADIUS_BASE = 70;
const RADIUS_PER_LEVEL = 12;
const CONE_HALF_ANGLE = Phaser.Math.DegToRad(35);
/** 경계 레벨이 아무리 올라도 이 이상 빨라지지 않는다 (min(alert, MAX_LEVEL)) */
const MAX_LEVEL = 4;
/** 웨이포인트 도착 판정 반경 (px) */
const ARRIVE_EPS = 5;
/** 시야 판정에 쓰는 광선 샘플 간격 (px). 타일 32px 보다 촘촘해야 벽을 안 뚫는다. */
const LOS_STEP = 8;

const TILE = mapData.tileSize;
/** 타일 좌표 → 픽셀 중심 */
const at = (col, row) => ({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 });

/**
 * 순찰 경로.
 *  - corridor: 중앙 복도(행 7~10)를 도는 상주 1기. 경계 0 에서도 항상 있다.
 *  - lowerHall: 하부 홀(행 12~16) 증원. 경계 1 이상에서만 배치된다 —
 *    구출(+1)·밀고(+1)가 순찰을 깨우는 구조라, 조용히 푸는 판에서는
 *    검증된 기존 동선이 그대로 보존된다.
 */
export const PATROL_ROUTES = {
  corridor: [at(3, 8), at(24, 8), at(24, 10), at(3, 10)],
  lowerHall: [at(3, 13), at(24, 13), at(24, 16), at(3, 16)],
};

/** 하부 홀 증원이 붙는 경계 레벨 */
export const REINFORCE_AT = 1;

const clampLevel = (alertLevel) => Math.min(alertLevel, MAX_LEVEL);

export class Patrol {
  /**
   * @param {Phaser.Scene} scene
   * @param {{x: number, y: number}[]} waypoints
   */
  constructor(scene, waypoints) {
    this.scene = scene;
    this.waypoints = waypoints;
    this.index = 0;
    /** 정지 상태 — 검문 중이거나 통과 직후 유예 중 */
    this.halted = false;
    /** 이 시각 전에는 감지하지 않는다 (통과 직후 재감지 금지) */
    this.graceUntil = 0;
    /** 마지막으로 바라본 방향 (라디안). 멈춰 있어도 시야는 유지된다. */
    this.facing = 0;

    const start = waypoints[0];
    this.sprite = scene.add.sprite(start.x, start.y, 'chars', 7);
    // 시야 콘은 반투명이라 위에 겹쳐 그려도 아래가 보인다. 오히려 "지금 내가 빛
    // 안에 있다"가 즉시 읽혀서 스텔스 게임에서는 이 편이 낫다.
    this.cone = scene.add.graphics();
  }

  /** 현재 경계 레벨에서의 이동 속도 (px/s) */
  speed(alertLevel) {
    return SPEED_BASE + SPEED_PER_LEVEL * clampLevel(alertLevel);
  }

  /** 현재 경계 레벨에서의 시야 거리 (px) */
  radius(alertLevel) {
    return RADIUS_BASE + RADIUS_PER_LEVEL * clampLevel(alertLevel);
  }

  /** 검문 중에는 순찰이 멈춘다. */
  halt() {
    this.halted = true;
  }

  /**
   * 다시 돌기 시작한다.
   * graceMs 동안은 감지하지 않는다 — 검문을 막 통과했는데 같은 자리에서 곧바로
   * 다시 잡히면 빠져나갈 방법이 없다. (서버의 통과 쿨다운이 이중 안전망이다.)
   */
  resume({ graceMs = 4000 } = {}) {
    this.halted = false;
    this.graceUntil = this.scene.time.now + graceMs;
  }

  /**
   * 한 프레임 전진하고 시야를 다시 그린다.
   *
   * @param {number} delta   ms
   * @param {number} alertLevel
   * @param {{x: number, y: number}|null} target  감지 대상(플레이어). null 이면 감지하지 않는다.
   * @returns {boolean} 이번 프레임에 대상을 발견했는가
   */
  update(delta, alertLevel, target) {
    if (!this.halted) this.#move(delta, alertLevel);
    this.#drawCone(alertLevel);

    if (!target || this.halted || this.scene.time.now < this.graceUntil) return false;
    return this.sees(target, alertLevel);
  }

  #move(delta, alertLevel) {
    const wp = this.waypoints[this.index];
    const dx = wp.x - this.sprite.x;
    const dy = wp.y - this.sprite.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= ARRIVE_EPS) {
      this.index = (this.index + 1) % this.waypoints.length;
      return;
    }

    const step = (this.speed(alertLevel) * delta) / 1000;
    this.facing = Math.atan2(dy, dx);
    // 남은 거리보다 크게 움직이면 웨이포인트를 지나쳐 떨린다 — 도착점에서 잘라낸다.
    const move = Math.min(step, dist);
    this.sprite.x += Math.cos(this.facing) * move;
    this.sprite.y += Math.sin(this.facing) * move;
  }

  #drawCone(alertLevel) {
    const r = this.radius(alertLevel);
    // 경계가 오를수록 진해진다 — 위험도가 숫자가 아니라 화면으로 보여야 한다.
    const alpha = 0.10 + 0.05 * clampLevel(alertLevel);
    this.cone.clear();
    this.cone.fillStyle(0xc25b4a, this.halted ? alpha * 0.4 : alpha);
    this.cone.slice(
      this.sprite.x, this.sprite.y, r,
      this.facing - CONE_HALF_ANGLE, this.facing + CONE_HALF_ANGLE,
      false,
    );
    this.cone.fillPath();
  }

  /** 대상이 시야 콘 안에 있고, 그 사이를 벽이 막지 않는가. */
  sees(target, alertLevel) {
    const dx = target.x - this.sprite.x;
    const dy = target.y - this.sprite.y;
    const dist = Math.hypot(dx, dy);
    if (dist > this.radius(alertLevel)) return false;

    const angle = Math.atan2(dy, dx);
    if (Math.abs(Phaser.Math.Angle.Wrap(angle - this.facing)) > CONE_HALF_ANGLE) return false;

    return this.#hasLineOfSight(target);
  }

  /**
   * 벽 관통 검문 방지.
   *
   * 이게 없으면 로봇이 방 하나를 사이에 두고 플레이어를 "투시"해 세운다. 콘은
   * 화면에 그려지는데 그 안이 벽이라는 걸 판정이 모르면 플레이어는 이유를 알 수 없다.
   */
  #hasLineOfSight(target) {
    const dx = target.x - this.sprite.x;
    const dy = target.y - this.sprite.y;
    const steps = Math.ceil(Math.hypot(dx, dy) / LOS_STEP);

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const col = Math.floor((this.sprite.x + dx * t) / TILE);
      const row = Math.floor((this.sprite.y + dy * t) / TILE);
      const tile = mapData.layout[row]?.[col];
      if (tile === undefined || mapData.tiles[tile].solid) return false;
    }
    return true;
  }

  destroy() {
    this.sprite.destroy();
    this.cone.destroy();
  }
}
