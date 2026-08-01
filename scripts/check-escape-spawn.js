/**
 * 탈출 체크포인트 안전 검증 — 코드네임: 태엽새
 *
 *   node scripts/check-escape-spawn.js
 *
 * 확인하는 것: 체크포인트 5곳이 (1) 걸을 수 있는 칸이고 (2) 어떤 로봇의 순찰 경로
 * **어느 지점에서도** 시야 부채꼴 안에 들어가지 않는가.
 *
 * 리스폰 직후 재발각은 이 설계의 최악 실패다. 무적 유예 1.5초가 완화해 주지만,
 * 유예가 끝나는 순간 콘 안이면 같은 문제다 — 그래서 유예에 기대지 않고 정적으로 막는다.
 *
 * 좌표·콘 상수는 씬과 **같은 파일**(world/escapeLayout.js)에서 읽는다. 여기 다시 적으면
 * 한쪽만 고쳐도 아무도 모르고, 이 검사가 실제와 다른 좌표를 재게 된다.
 *
 * 경로 위 점만으로는 충분하지 않다: Task 8 에서 끝점 회전 보간이 추가됐다. 로봇이
 * 웨이포인트에 닿으면 TURN_PAUSE_MS(1.5초) 동안 제자리에서 facing 이 순방향에서
 * 역방향으로 연속적으로 회전한다(Sentry.js #move() 의 pauseLeft 분기). 즉 경로
 * 양 끝점에서는 콘이 180도 가까이를 훑는다. [2]는 경로 위 순방향·역방향 두 극단만
 * 보므로 그 사이 각도를 전혀 안 보고, 경로에 수직인 체크포인트가 양 극단에서는
 * 안전해도 회전 도중에 잡힐 수 있다 — 그래서 [3]에서 그 회전 구간도 촘촘히 훑는다.
 */
import { readFile } from 'node:fs/promises';
import { hasLineOfSight, makeBlockedLookup } from '../src/client/world/los.js';
import {
  CHECKPOINTS,
  CONE_ANGLE,
  CONE_RANGE,
  SENTRY_ROUTES,
  TILE,
  at,
} from '../src/client/world/escapeLayout.js';

const map = JSON.parse(
  await readFile(new URL('../src/client/assets/escape.json', import.meta.url), 'utf8'),
);

let failures = 0;
const ok = (cond, label, extra = '') => {
  console.log(`  ${cond ? '✔' : '✘'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const isBlocked = makeBlockedLookup(map);
/**
 * Phaser.Math.Angle.Wrap 과 반드시 같은 값을 내야 한다 — Sentry.js #move() 가 실제로
 * 그 함수로 회전을 보간한다(이 스크립트는 Phaser 를 import 하지 않으므로 알고리즘을
 * 그대로 옮겨 적는다. node_modules/phaser/src/math/Wrap.js·math/angle/Wrap.js 참고).
 *
 * atan2(sin(a), cos(a)) 트릭은 언뜻 "각도를 감는다"는 목적에 맞아 보이지만 정확히
 * ±π 에서 Phaser 와 부호가 갈린다 — 실측: Phaser.Math.Angle.Wrap(π) = -π 인데
 * atan2 트릭은 +π 를 낸다. 이 맵의 SENTRY_ROUTES 는 셋 다 완전한 수평 왕복이라
 * 순방향·역방향 각도가 정확히 {0, π} 이고, 따라서 seesDuringTurn 의 모든 끝점
 * 회전에서 diff(turnTo - turnFrom)가 정확히 그 경계값에 걸린다. atan2 트릭을 쓰면
 * 이 경계에서 부호가 뒤집혀 facing 이 실제 게임과 거울상인 반대쪽 반원을 훑는다 —
 * 체크포인트가 진짜 위험한 쪽에 있어도 검사는 안전한 반대쪽만 보고 ✔ 를 찍는다.
 * "atan2 로 더 간단하게" 되돌리지 말 것 — 간단해 보이는 건 이 맵 데이터가 항상
 * 그 경계값(±π)을 정확히 찍기 때문에 드러나지 않을 뿐, 틀린 결과다.
 */
const wrap = (a) => {
  const range = Math.PI * 2;
  return -Math.PI + (((a + Math.PI) % range) + range) % range;
};
const HALF_CONE_RAD = ((CONE_ANGLE / 2) * Math.PI) / 180;

/**
 * 로봇이 pos 에 있고 facing 방향을 볼 때, p 가 콘 안인가.
 * Sentry.sees() 와 같은 순서로 판정한다: 거리 → 각도(감아서) → hasLineOfSight.
 * seesFrom(경로 위 이동 중)과 seesDuringTurn(끝점 회전 중) 이 이 함수 하나를 같이
 * 써야, 두 검사의 판정 기준이 갈라질 일이 없다.
 */
function seesFromPose(pos, facing, p) {
  const dx = p.x - pos.x;
  const dy = p.y - pos.y;
  if (Math.hypot(dx, dy) > CONE_RANGE) return false;
  if (Math.abs(wrap(Math.atan2(dy, dx) - facing)) > HALF_CONE_RAD) return false;
  return hasLineOfSight(pos, p, TILE, isBlocked);
}

/** 로봇이 route 위 t 지점(0~1)에 있고 진행 방향을 볼 때, p 가 콘 안인가 */
function seesFrom(route, t, forward, p) {
  const [a, b] = forward ? route : [route[1], route[0]];
  const pos = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const facing = Math.atan2(b.y - a.y, b.x - a.x);
  return seesFromPose(pos, facing, p);
}

// 1도 간격 — 브리프가 요구한 "촘촘히(1도 간격 또는 36등분)"의 하한을 넘는 값.
const TURN_SAMPLES = 180;

/**
 * 로봇이 웨이포인트 waypointIndex 에 도착해 제자리에서 도는 turnFrom→turnTo
 * 구간을 촘촘히 훑어, 회전 도중 p 가 콘 안에 드는 순간이 있는가.
 *
 * Sentry.js #move() 의 pauseLeft 분기를 그대로 재현한다: 도착 직후 facing 은
 * turnFrom(도착할 때까지의 진행 방향)에서 turnTo(다음 목표를 향한 방향)까지
 * TURN_PAUSE_MS 에 걸쳐 감은 각도차만큼 선형 보간된다
 * (facing = wrap(turnFrom + wrap(turnTo - turnFrom) * t)). wrap 을 빠뜨리거나
 * (위 wrap 정의의 주석 참고) Phaser 와 다른 방식으로 감으면 −π/π 경계에서 부호가
 * 갈려 반대 방향으로 도는 것으로 잘못 잰다 — 위 wrap 이 Phaser.Math.Angle.Wrap 과
 * 정확히 같아야 하는 이유가 바로 여기서 diff·facing 둘 다에 쓰이기 때문이다.
 *
 * route 배열 길이에 매이지 않는다 — 지금 SENTRY_ROUTES 는 2점 왕복이지만, 이 함수는
 * 웨이포인트 개수와 무관하게 "도착 시점의 진행 방향 → 다음 목표 방향" 회전을
 * Sentry 의 인덱스 순환(this.index = (this.index + 1) % route.length)과 같은
 * 규칙으로 재구성한다.
 */
function seesDuringTurn(route, waypointIndex, p) {
  const n = route.length;
  const prev = route[(waypointIndex - 1 + n) % n];
  const cur = route[waypointIndex];
  const next = route[(waypointIndex + 1) % n];
  const turnFrom = Math.atan2(cur.y - prev.y, cur.x - prev.x);
  const turnTo = Math.atan2(next.y - cur.y, next.x - cur.x);
  const diff = wrap(turnTo - turnFrom);
  for (let s = 0; s <= TURN_SAMPLES; s++) {
    const facing = wrap(turnFrom + diff * (s / TURN_SAMPLES));
    if (seesFromPose(cur, facing, p)) return true;
  }
  return false;
}

console.log('\n[1] 체크포인트가 걸을 수 있는 칸인가');
for (const [i, cp] of CHECKPOINTS.entries()) {
  ok(!isBlocked(cp.col, cp.row), `체크포인트 ${i} (${cp.col},${cp.row})`);
}

console.log('\n[2] 체크포인트가 어떤 순찰 지점의 콘에도 안 들어가는가');
// 경로를 100 등분해 양방향 전부 검사한다 — 한 지점만 재면 왕복 중 한쪽을 놓친다.
// 여기서는 "이동 중" 만 본다 — 웨이포인트에서 멈춰 도는 구간은 [3]에서 따로 훑는다.
// 주의: 샘플 간격(경로 길이/100 — 지금 맵은 약 7.7px)은 체크포인트가 경로에서
// 수직으로 멀어질수록 콘이 스치는 이동 구간(감지 창)을 좁힌다. 지금 CHECKPOINTS
// 5곳은 전부 자기 경로와 수직 거리 0(경로가 지나는 행·열 선상)이라 무관하지만,
// 나중에 축에서 크게 벗어난 체크포인트를 넣을 때는 100 등분으로 그 좁은 창을
// 완전히 건너뛸 수 있다 — 그때는 s 상한을 올려야 한다.
for (const [i, cp] of CHECKPOINTS.entries()) {
  const p = at(cp.col, cp.row);
  let hit = null;
  for (const [ri, route] of SENTRY_ROUTES.entries()) {
    for (let s = 0; s <= 100 && !hit; s++) {
      for (const forward of [true, false]) {
        if (seesFrom(route, s / 100, forward, p)) {
          hit = `로봇 ${ri} · ${forward ? '순' : '역'}방향 ${s}%`;
          break;
        }
      }
    }
  }
  ok(!hit, `체크포인트 ${i} 는 콘 밖`, hit ?? '');
}

console.log('\n[3] 체크포인트가 웨이포인트 끝점의 회전 구간에도 안 걸리는가');
// [2]는 순방향·역방향 두 극단만 본다. 그 사이(끝점에서 정지해 도는 1.5초)를 놓치면
// 경로에 수직인 체크포인트가 양 극단에서는 안전해 보여도 회전 도중 잡힐 수 있다.
for (const [i, cp] of CHECKPOINTS.entries()) {
  const p = at(cp.col, cp.row);
  let hit = null;
  for (const [ri, route] of SENTRY_ROUTES.entries()) {
    for (let wi = 0; wi < route.length && !hit; wi++) {
      if (seesDuringTurn(route, wi, p)) {
        hit = `로봇 ${ri} · 웨이포인트 ${wi} 회전 중`;
      }
    }
  }
  ok(!hit, `체크포인트 ${i} 는 회전 중에도 콘 밖`, hit ?? '');
}

console.log(failures ? `\n실패 ${failures}건\n` : '\n전부 통과\n');
process.exit(failures ? 1 : 0);
