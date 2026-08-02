import Phaser from 'phaser';
import { hasLineOfSight, rayDistance, LOS_STEP } from '../world/los.js';
import { CHAR_HEIGHT, CONE_ANGLE, CONE_RANGE, SENTRY_SPEED, TURN_PAUSE_MS } from '../world/escapeLayout.js';

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

    // chars.png 는 한 프레임이 32px 이라 무배율로 두면 이 맵의 사람(charHeight)보다
    // 절반 크기로 선다 — 수로 그림에서 로봇만 인형처럼 작았다.
    this.sprite = scene.add
      .sprite(route[0].x, route[0].y, 'chars', 7)
      .setScale(CHAR_HEIGHT / 32);
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
    // 정지 회전의 시작/목표 각. 지금은 정지 중이 아니라 둘 다 facing 과 같지만,
    // #move 가 pauseLeft>0 일 때만 읽으므로 다음 도착이 이 값들을 새로 채운다.
    this.turnFrom = this.facing;
    this.turnTo = this.facing;
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

    const wp = this.route[this.index];
    const dx = wp.x - this.sprite.x;
    const dy = wp.y - this.sprite.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= ARRIVE_EPS) {
      // 왕복이다 — 순환이 아니라 되돌아온다. 통로 한 줄에서는 순환이 곧 왕복이지만,
      // 웨이포인트가 3개 이상이 되면 달라진다.
      this.turnFrom = this.facing;
      this.index = (this.index + 1) % this.route.length;
      const next = this.route[this.index];
      this.turnTo = Math.atan2(next.y - this.sprite.y, next.x - this.sprite.x);
      this.pauseLeft = TURN_PAUSE_MS;
      return;
    }

    const step = (this.speed * delta) / 1000;
    this.facing = Math.atan2(dy, dx);
    const move = Math.min(step, dist);
    this.sprite.x += Math.cos(this.facing) * move;
    this.sprite.y += Math.sin(this.facing) * move;
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
