import Phaser from 'phaser';
import { hasLineOfSight, LOS_STEP } from '../world/los.js';
import { CONE_ANGLE, CONE_RANGE, SENTRY_SPEED, TURN_PAUSE_MS } from '../world/escapeLayout.js';

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
 */

/** 웨이포인트 도착 판정 반경 (px) */
const ARRIVE_EPS = 4;

export class Sentry {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} opts
   * @param {{x: number, y: number}[]} opts.route 왕복 웨이포인트 (2개 이상)
   * @param {number} opts.tileSize
   * @param {(col: number, row: number) => boolean} opts.isBlocked
   */
  constructor(scene, { route, tileSize, isBlocked, speed = SENTRY_SPEED,
    coneAngle = CONE_ANGLE, coneRange = CONE_RANGE }) {
    this.scene = scene;
    this.route = route;
    this.tileSize = tileSize;
    this.isBlocked = isBlocked;
    this.speed = speed;
    this.coneAngle = coneAngle;
    this.coneRange = coneRange;

    this.sprite = scene.add.sprite(route[0].x, route[0].y, 'chars', 7);
    this.cone = scene.add.graphics();
    this.reset();
  }

  /**
   * 순찰 위상을 시작점으로 되돌린다.
   *
   * 체크포인트 리스폰이 반드시 이걸 함께 불러야 한다 — 안 부르면 "리스폰하자마자
   * 코앞에 로봇"이 반복돼 재시도가 운에 좌우된다 (스펙 §3).
   */
  reset() {
    this.index = 1 % this.route.length;
    this.sprite.setPosition(this.route[0].x, this.route[0].y);
    this.facing = Math.atan2(
      this.route[this.index].y - this.route[0].y,
      this.route[this.index].x - this.route[0].x,
    );
    this.pauseLeft = 0;
  }

  /**
   * 한 프레임 전진하고 시야를 다시 그린다.
   * @param {number} delta ms
   * @param {{x: number, y: number}|null} target 감지 대상. null 이면 감지하지 않는다.
   * @returns {boolean} 이번 프레임에 대상이 시야 안에 있는가
   */
  update(delta, target) {
    this.#move(delta);
    this.#drawCone();
    if (!target) return false;
    return this.sees(target);
  }

  #move(delta) {
    if (this.pauseLeft > 0) {
      this.pauseLeft -= delta;
      return;
    }

    const wp = this.route[this.index];
    const dx = wp.x - this.sprite.x;
    const dy = wp.y - this.sprite.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= ARRIVE_EPS) {
      // 왕복이다 — 순환이 아니라 되돌아온다. 통로 한 줄에서는 순환이 곧 왕복이지만,
      // 웨이포인트가 3개 이상이 되면 달라진다.
      this.index = (this.index + 1) % this.route.length;
      this.pauseLeft = TURN_PAUSE_MS;
      return;
    }

    const step = (this.speed * delta) / 1000;
    this.facing = Math.atan2(dy, dx);
    const move = Math.min(step, dist);
    this.sprite.x += Math.cos(this.facing) * move;
    this.sprite.y += Math.sin(this.facing) * move;
  }

  #drawCone() {
    const half = Phaser.Math.DegToRad(this.coneAngle) / 2;
    this.cone.clear();
    // 안쪽을 옅게 채우고 가장자리를 진하게 둘러 경계가 어디까지인지 눈으로 재게 한다
    // (Patrol 의 원과 같은 원칙). 채우기만 하면 어디서부터 걸리는지 알 수 없다.
    this.cone.fillStyle(0xc25b4a, 0.16);
    this.cone.beginPath();
    this.cone.moveTo(this.sprite.x, this.sprite.y);
    this.cone.arc(
      this.sprite.x, this.sprite.y, this.coneRange,
      this.facing - half, this.facing + half, false,
    );
    this.cone.closePath();
    this.cone.fillPath();
    this.cone.lineStyle(2, 0xc25b4a, 0.5);
    this.cone.strokePath();
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
