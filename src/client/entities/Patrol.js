import Phaser from 'phaser';
import mapData from '../assets/map.json';
import streetProps from '../assets/street-props.json';
import { hasLineOfSight, makeBlockedLookup, LOS_STEP } from '../world/los.js';
import { NAME_LABEL_DEPTH, WORLD_ZOOM, worldLabel } from '../world/worldParts.js';
import { nameLabelStyle } from '../ui/theme.js';
import { facingName } from './facing.js';
import {
  ROBOT_ANIM,
  ROBOT_CONTENT_HEIGHT,
  ROBOT_FRAME_SIZE,
  ROBOT_ORIGIN_Y,
} from './robotSprite.js';
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

/**
 * 센서가 죽어 있는 동안 그리는 점선 고리의 토막 수와, 한 토막이 차지하는 비율
 * (0.55 = 칠한 곳 55% · 빈 곳 45%). 토막을 더 잘게 쪼개면 이 축척(줌 1.5)에서는
 * 점선이 아니라 흐린 실선으로 보인다. #drawOfflineRing 참고.
 */
const OFFLINE_RING_DASHES = 16;
const OFFLINE_RING_FILL = 0.55;

const TILE = mapData.tileSize;
/**
 * 이름표를 정수리 위로 올리는 거리 — 발이 좌표에 놓이므로 인물 높이만큼 올린다.
 * 거리의 사람들(StageScene 의 ALLY_SPRITE_LABEL_DY)과 같은 규칙이라 로봇 이름과
 * 사람 이름이 한 줄로 나란히 뜬다.
 */
const LABEL_DY = -((mapData.charHeight ?? 32) + 8);
/**
 * 이름표 — 규격(크기·테두리)은 사람과 똑같고 **색만** 다르다.
 *
 * 시야 원(0xc25b4a)의 붉은색을 금색 이름표와 같은 밝기로 올린 값이다. 원본 그대로
 * 쓰면 옆에 선 사람 이름보다 어두워 로봇 쪽만 묻힌다 — 정작 먼저 읽어야 하는 쪽이다.
 * 테마 토큰 아님(여기서만 쓴다).
 */
const LABEL_STYLE = nameLabelStyle(mapData.cameraZoom ?? WORLD_ZOOM, '#e8846a');
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

export { PATROL_NAMES, REINFORCE_AT } from '../world/streetLayout.js';

const clampLevel = (alertLevel) => Math.min(alertLevel, MAX_LEVEL);

export class Patrol {
  /**
   * @param {Phaser.Scene} scene
   * @param {{x: number, y: number}[]} waypoints
   * @param {string} name  머리 위에 띄울 이름 (streetLayout.PATROL_NAMES)
   */
  constructor(scene, waypoints, name = '경비 로봇') {
    this.scene = scene;
    this.waypoints = waypoints;
    this.index = 0;
    /** 정지 상태 — 검문 중이거나 통과 직후 유예 중 */
    this.halted = false;
    /** 이 시각 전에는 감지하지 않는다 (통과 직후 재감지 금지) */
    this.graceUntil = 0;
    /** 그 유예의 전체 길이 — 점선 고리가 얼마나 진해졌는지 재는 분모다 (#graceProgress) */
    this.graceMs = 0;
    /** 마지막으로 바라본 방향 (라디안). 멈춰 있어도 시야는 유지된다. */
    this.facing = 0;
    /** 지금 재생 중인 애니메이션 키 — 같은 키를 다시 play() 하면 걸음이 첫 프레임으로 되감긴다. */
    this.anim = null;

    const start = waypoints[0];
    // 그림은 플레이어와 같은 규칙이다: **발**이 순찰 좌표에 놓이고, 화면에 보일 높이는
    // 맵이 정한 charHeight 다. 예전에는 chars.png 32px 프레임을 통째로 확대해 세웠는데,
    // 그때는 방향도 걸음도 없어서 로봇이 옆으로 미끄러지듯 다녔다.
    //
    // ⚠ **재생을 먼저, 크기를 나중에.** setDisplaySize 는 지금 붙어 있는 프레임 크기로
    // 배율을 역산해 두고 그 배율을 계속 쓴다. 두 시트가 같은 220칸이라 지금은 어느
    // 순서든 맞지만, 나중에 프레임 크기가 다른 시트를 물리면 그때부터 조용히 틀어진다
    // (플레이어에서 겪은 함정이라 같은 순서를 지킨다).
    const scale = (mapData.charHeight ?? 32) / ROBOT_CONTENT_HEIGHT;
    this.sprite = scene.add
      .sprite(start.x, start.y, ROBOT_ANIM.texture, 0)
      .setOrigin(0.5, ROBOT_ORIGIN_Y);
    this.#play(ROBOT_ANIM.idleDown);
    this.sprite.setDisplaySize(ROBOT_FRAME_SIZE * scale, ROBOT_FRAME_SIZE * scale);
    // 시야 콘은 반투명이라 위에 겹쳐 그려도 아래가 보인다. 오히려 "지금 내가 빛
    // 안에 있다"가 즉시 읽혀서 스텔스 게임에서는 이 편이 낫다.
    this.cone = scene.add.graphics();

    // 이름표. 로봇은 걸어 다니므로 매 프레임 따라붙어야 한다(#syncLabel).
    // 시야 원 위로 올려 둔다 — 원 안에 들어가는 순간이 이름을 가장 읽고 싶은 순간이다.
    this.label = worldLabel(scene, start.x, start.y + LABEL_DY, name, LABEL_STYLE).setDepth(
      NAME_LABEL_DEPTH,
    );
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
   * 지금 이 로봇이 사람을 알아볼 수 있는가.
   *
   * 판정(update)과 그림(#drawCone)이 **같은 이 하나를 본다**. 예전에는 감지만 꺼지고
   * 붉은 원은 그대로 떠 있어서, 검문을 통과한 직후 원 한가운데를 지나가도 아무 일이
   * 없다가 유예가 끝나는 순간 갑자기 붙잡혔다 — 플레이어에게는 게임이 고장 난 것으로
   * 읽힌다(2026-08-07 플레이테스트 피드백). 원이 없으면 안 걸린다, 로 규칙을 눈에
   * 보이게 못박는다.
   */
  get detecting() {
    return !this.halted && this.scene.time.now >= this.graceUntil;
  }

  /**
   * 유예가 얼마나 지났는가 (0 = 방금 풀려남, 1 = 곧 되살아남). 유예 중이 아니면 1.
   * 점선 원이 옅은 데서 진해지며 "돌아오는 중"을 보여주는 데 쓴다 (#drawOfflineRing).
   */
  get #graceProgress() {
    if (!this.graceMs) return 1;
    const left = this.graceUntil - this.scene.time.now;
    return left <= 0 ? 1 : Math.min(1, Math.max(0, 1 - left / this.graceMs));
  }

  /**
   * 다시 돌기 시작한다.
   * graceMs 동안은 감지하지 않는다 — 검문을 막 통과했는데 같은 자리에서 곧바로
   * 다시 잡히면 빠져나갈 방법이 없다. (서버의 통과 쿨다운이 이중 안전망이다.)
   *
   * ⚠ 이 유예가 곧 **탈출 시간**이다. 자석 수류탄으로 굳히는 4초(GRENADE_FREEZE_MS)는
   * 대개 대사창을 읽는 사이에 다 지나가 버리므로 — 창이 떠 있는 동안은 이동 자체가
   * 막힌다 — 실제로 도망칠 수 있는 시간은 여기서 나온다. 그래서 짧게 줄일 수 없다.
   */
  resume({ graceMs = 4000 } = {}) {
    this.halted = false;
    this.graceMs = graceMs;
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
    // 검문 중에는 걸음을 멈추되 **보던 쪽 그대로** 선다 — 시야 판정도 그 방향을 계속
    // 쓰므로, 그림만 정면으로 돌아서면 화면과 판정이 어긋나 보인다.
    else this.#play(ROBOT_ANIM[`idle${facingName(this.facing)}`]);
    this.#drawCone(alertLevel);
    this.#syncLabel();

    if (!target || !this.detecting) return false;
    return this.sees(target, alertLevel);
  }

  /** 같은 애니메이션을 다시 걸지 않는다 — 매 프레임 play() 하면 걸음이 첫 장에서 멈춘다. */
  #play(key) {
    if (this.anim === key) return;
    this.anim = key;
    this.sprite.play(key);
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
    this.#play(ROBOT_ANIM[`walk${facingName(this.facing)}`]);
  }

  /** 이름표를 정수리 위에 다시 놓는다. 걸음은 스프라이트 좌표를 직접 옮기므로 매 프레임 필요하다. */
  #syncLabel() {
    this.label.setPosition(this.sprite.x, this.sprite.y + LABEL_DY);
  }

  /**
   * 감지 원은 **세 가지 상태**를 그린다. 셋이 다 필요하다는 걸 두 번의 플레이테스트가
   * 하나씩 알려 줬다.
   *
   *  1. 멈춤(halted) — **아무것도 안 그린다.** 검문 중이거나 자석 수류탄에 굳어 있는
   *     동안이다. 로봇이 눈에 띄게 서 있으므로 원이 없는 이유가 화면에 이미 있다.
   *  2. 유예(!detecting) — **점선 고리.** 걷기는 하는데 센서가 아직 안 돌아온 상태다.
   *     처음엔 아무것도 안 그렸는데, 로봇이 다시 걸어다니는데도 원이 없어서 "범위가
   *     영영 안 돌아온다"로 읽혔다(2026-08-08 피드백). 그렇다고 평소의 붉은 원을
   *     그리면 이번엔 "원 안인데 안 걸린다"가 되어(그게 08-07 피드백이었다) 원점이다.
   *     그래서 **평소와 다른 그림**을 쓴다: 채우기 없이, 자기장에 붙들렸을 때의 푸른색
   *     점선으로, 유예가 끝나갈수록 진해지며 천천히 돈다. "아직 죽어 있다, 그러나
   *     돌아오는 중"이 한 눈에 읽힌다.
   *  3. 살아 있음 — 평소의 붉은 원. 이 원 안이면 걸린다.
   */
  #drawCone(alertLevel) {
    this.cone.clear();
    if (this.halted) return;

    const r = this.radius(alertLevel);
    if (!this.detecting) {
      this.#drawOfflineRing(r);
      return;
    }

    // 경계가 오를수록 진해진다 — 위험도가 숫자가 아니라 화면으로 보여야 한다.
    const a = 0.1 + 0.05 * clampLevel(alertLevel);
    // 감지 원 — 안쪽을 옅게 채우고 가장자리를 한 겹 진하게 둘러, 경계가 어디까지인지
    // 눈으로 재게 한다. 채우기만 하면 어디서부터 걸리는지 알 수 없다.
    this.cone.fillStyle(0xc25b4a, a);
    this.cone.fillCircle(this.sprite.x, this.sprite.y, r);
    this.cone.lineStyle(2, 0xc25b4a, Math.min(0.75, a * 3.4));
    this.cone.strokeCircle(this.sprite.x, this.sprite.y, r);
  }

  /**
   * 센서가 죽어 있는 동안의 고리 (#drawCone 의 상태 2).
   *
   * 채우기가 없는 것이 핵심이다 — 살아 있는 원은 안이 붉게 차 있어서 "이 안은 위험"
   * 이지만, 이건 테두리만 있어서 "여기까지가 곧 위험해질 자리"로 읽힌다. 색도 붉은색
   * 이 아니라 자기장에 붙들린 로봇의 푸른빛(#grenadeEscape 의 tint 와 같은 값)이다.
   *
   * 토막이 천천히 도는 것과 유예가 끝날수록 진해지는 것, 둘 다 "다시 켜지는 중"이라는
   * 같은 말을 한다 — 남은 시간을 숫자로 띄우는 대신 화면으로 세게 한다.
   */
  #drawOfflineRing(r) {
    const progress = this.#graceProgress;
    // 처음엔 거의 안 보이다가 되살아날 즈음 또렷해진다. 끝값을 살아 있는 원의 테두리
    // (최대 0.75)보다 낮게 잡아, 진해진 점선이 살아 있는 원보다 세 보이지 않게 한다.
    const alpha = 0.16 + 0.34 * progress;
    // 한 바퀴 4초. 걸음보다 느려야 로봇이 아니라 센서가 도는 것으로 보인다.
    // 나머지만 취해 한 바퀴 안에 가둔다 — 판이 길어져도 각도가 무한정 커지지 않는다.
    const spin = ((this.scene.time.now / 4000) % 1) * Math.PI * 2;
    const span = (Math.PI * 2) / OFFLINE_RING_DASHES;

    this.cone.lineStyle(2, 0x9fc4e0, alpha);
    for (let i = 0; i < OFFLINE_RING_DASHES; i++) {
      const from = spin + i * span;
      this.cone.beginPath();
      this.cone.arc(this.sprite.x, this.sprite.y, r, from, from + span * OFFLINE_RING_FILL);
      this.cone.strokePath();
    }
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
    this.label.destroy();
  }
}
