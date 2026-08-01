import Phaser from 'phaser';
import mapData from '../assets/map.json';
import { hasLineOfSight, makeBlockedLookup, LOS_STEP } from '../world/los.js';

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
/**
 * 감지 반경.
 *
 * 로봇은 눈이 아니라 **감지기**로 사람을 찾는다 — 그래서 앞뒤를 가리지 않는 원이다.
 * 부채꼴이던 때는 뒤로 돌아가면 코앞에서도 안 걸려, 로봇을 피하는 것이 아니라
 * 등 뒤에 붙어 따라다니는 것이 최적 전략이 됐다.
 *
 * 맵이 30×18 에서 60×48 로 넓어져 반경도 같이 키웠다. 예전 값(70)은 새 거리에서
 * 타일 두 칸 남짓이라 그냥 지나쳐도 안 걸렸다.
 */
const RADIUS_BASE = 150;
const RADIUS_PER_LEVEL = 26;
/** 경계 레벨이 아무리 올라도 이 이상 빨라지지 않는다 (min(alert, MAX_LEVEL)). 레벨 3 은 발각 즉사 단계다. */
const MAX_LEVEL = 3;
/** 웨이포인트 도착 판정 반경 (px) */
const ARRIVE_EPS = 5;

const TILE = mapData.tileSize;
/** 거리 맵은 walkmask 를 쓰지 않는다 — layout 의 solid 가 원본이다. */
const IS_BLOCKED = makeBlockedLookup(mapData);
/** 타일 좌표 → 픽셀 중심 */
const at = (col, row) => ({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 });

/**
 * 순찰 경로 — 거리 맵(60×48)의 큰 축을 따라 왕복한다.
 *
 * 좌표는 docs/archive/스테이지1 거리 맵.dc.html 의 baseGuards 를 옮긴 것이다.
 * 세 축이 시가지를 열십자로 가르므로 어느 구역에 있든 한 번은 마주치게 된다.
 *
 * 상주 셋 + 증원 하나로 나눈 이유: 맵이 넓어져 한 기로는 존재감이 없고, 그렇다고
 * 처음부터 넷을 돌리면 조용히 푸는 판에서도 검문이 잦아진다. 넷째는 경계 2
 * (증원 단계)부터 붙어, 소동을 일으킨 판에서만 축이 하나 더 생긴다.
 */
export const PATROL_ROUTES = {
  avenue: [at(19, 6), at(19, 42)], // 세로 축 — 중앙 대로를 오르내린다
  crossing: [at(6, 15), at(54, 15)], // 가로 축 — 시가지를 가로지른다
  wharf: [at(52, 31), at(24, 31)], // 아래쪽 가로 축 — 부두 방면
  reinforce: [at(39, 8), at(39, 40)], // 증원 — 경계 2 이상에서만
};

/** 하부 홀 증원이 붙는 경계 레벨 (스토리보드: 레벨 2 = 증원) */
export const REINFORCE_AT = 2;

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
