import Phaser from 'phaser';
import mapData from '../assets/map.json';
import streetProps from '../assets/street-props.json';
import { hasLineOfSight, makeBlockedLookup, LOS_STEP } from '../world/los.js';
import {
  MAX_LEVEL,
  PATROL_ROUTES as ROUTE_TILES,
  RADIUS_BASE,
  RADIUS_PER_LEVEL,
  SPEED_BASE,
  SPEED_PER_LEVEL,
  routeToPixels,
} from '../world/streetLayout.js';

/**
 * 순찰 로봇.
 *
 * 경로와 밸런스 상수는 `world/streetLayout.js` 에 있다 — node 로 도는 스폰 안전 검사와
 * **같은 파일**을 봐야 하기 때문이다 (그 파일 머리말 참고).
 */

/** 웨이포인트 도착 판정 반경 (px) */
const ARRIVE_EPS = 5;

const TILE = mapData.tileSize;
/**
 * 시야가 보는 벽은 **충돌이 보는 벽과 같아야 한다**.
 * 거리도 이제 walkmask(street-props.json 의 walk)가 충돌의 원본이라 시야도 같은 것을
 * 넘긴다. 예전엔 여기만 layout 의 solid 를 봤는데, 마스크를 새로 칠하는 순간 로봇이
 * 그림에 없는 벽에 막히거나 있는 벽을 뚫어 보게 된다 — 플레이어는 이유를 알 수 없다.
 */
const IS_BLOCKED = makeBlockedLookup(mapData, streetProps);

/** 순찰 경로 — 타일 좌표(streetLayout)를 이 맵의 픽셀로 옮긴 것 */
export const PATROL_ROUTES = Object.fromEntries(
  Object.entries(ROUTE_TILES).map(([key, route]) => [key, routeToPixels(route, TILE)]),
);

export { REINFORCE_AT } from '../world/streetLayout.js';

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
    // chars.png 는 한 프레임이 32px 이라 무배율로 두면 이 맵의 사람들(charHeight)보다
    // 절반 크기로 선다 — 새 광장 그림에서 로봇만 인형처럼 작았다.
    this.sprite = scene.add
      .sprite(start.x, start.y, 'chars', 7)
      .setScale((mapData.charHeight ?? 32) / 32);
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
    const alpha = 0.1 + 0.05 * clampLevel(alertLevel);
    const a = this.halted ? alpha * 0.4 : alpha;
    this.cone.clear();
    // 감지 원 — 안쪽을 옅게 채우고 가장자리를 한 겹 진하게 둘러, 경계가 어디까지인지
    // 눈으로 재게 한다. 채우기만 하면 어디서부터 걸리는지 알 수 없다.
    this.cone.fillStyle(0xc25b4a, a);
    this.cone.fillCircle(this.sprite.x, this.sprite.y, r);
    this.cone.lineStyle(2, 0xc25b4a, Math.min(0.75, a * 3.4));
    this.cone.strokeCircle(this.sprite.x, this.sprite.y, r);
  }

  /** 대상이 감지 반경 안에 있고, 그 사이를 벽이 막지 않는가. */
  sees(target, alertLevel) {
    const dist = Math.hypot(target.x - this.sprite.x, target.y - this.sprite.y);
    if (dist > this.radius(alertLevel)) return false;
    // 벽 관통 검문 방지. 이게 없으면 로봇이 방 하나를 사이에 두고 플레이어를 "투시"해
    // 세운다. 콘은 화면에 그려지는데 그 안이 벽이라는 걸 판정이 모르면 이유를 알 수 없다.
    return hasLineOfSight(this.sprite, target, TILE, IS_BLOCKED, LOS_STEP);
  }

  destroy() {
    this.sprite.destroy();
    this.cone.destroy();
  }
}
