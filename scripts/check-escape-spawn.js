/**
 * 탈출 시작 지점 안전 검증 — 코드네임: 태엽새
 *
 *   node scripts/check-escape-spawn.js
 *
 * ⚠ 2026-08-05 에 로봇이 **고정 순찰로를 버리고 맵 전역을 무작위로 돌게** 됐다
 * (escapeLayout.SENTRY_HOMES). 그래서 "경로 위 어느 지점에서도 시작 지점이 콘 밖인가"
 * 라는 예전 검사는 성립하지 않는다 — 경로가 없고, 로봇은 언젠가 어디든 간다.
 *
 * 대신 지켜야 할 것이 남는다. **리스폰하는 순간**이다. 발각되면 로봇 셋이 각자의 집으로
 * 되돌아가고 플레이어는 시작 지점에서 다시 시작하는데, 그 순간 집이 시작 지점 코앞이면
 * 무적 유예가 끝나자마자 다시 잡힌다. 되돌아올 곳이 없어지는 것이고, 이 설계의 최악
 * 실패다 (스펙 §6).
 *
 * 그래서 검사하는 것은 셋이다:
 *   [1] 시작 지점이 걸을 수 있는 칸인가
 *   [2] 집이 콘 사거리 밖인가 — 집에 선 로봇이 **어느 쪽을 보든** 안 보여야 한다.
 *       무작위 순회는 리스폰 직후 로봇이 어느 방향을 향할지 정해 주지 않는다.
 *   [3] 집에서 시작 지점까지 걸어오는 시간이 무적 유예보다 넉넉한가 — 유예가 끝나는
 *       순간 이미 코앞이면 [2]를 통과해도 소용없다.
 *   [4] 각 집에서 맵 전역에 닿는가 — 순회의 전제다. 집이 막다른 구역에 있으면 그 로봇은
 *       평생 그 구역만 돈다.
 *
 * 좌표·상수는 씬과 **같은 파일**(world/escapeLayout.js)에서, 길찾기는 씬과 **같은 함수**
 * (world/roam.js)에서 읽는다. 여기 다시 적으면 한쪽만 고쳐도 아무도 모르고, 이 검사가
 * 실제와 다른 것을 재게 된다.
 */
import { readFile } from 'node:fs/promises';
import { makeBlockedLookup } from '../src/client/world/los.js';
import { walkField } from '../src/client/world/roam.js';
import {
  SPAWN,
  CONE_RANGE,
  RESPAWN_GRACE_MS,
  SENTRY_HOMES,
  SENTRY_SPEED,
  TILE,
  at,
  makeRoamBlocked,
} from '../src/client/world/escapeLayout.js';

const map = JSON.parse(
  await readFile(new URL('../src/client/assets/escape.json', import.meta.url), 'utf8'),
);
// 시야가 보는 벽은 **충돌이 보는 벽과 같아야 한다** — 수로는 물이 시야를 막는다.
// escape.json 의 layout 은 이제 바깥 테두리만 solid 인 껍데기라 이걸 안 넘기면
// 물 위를 그대로 꿰뚫어 보는 셈이 되어, 실제보다 훨씬 빡빡한 검사가 된다.
const props = JSON.parse(
  await readFile(new URL('../src/client/assets/escape-props.json', import.meta.url), 'utf8'),
);

let failures = 0;
const ok = (cond, label, extra = '') => {
  console.log(`  ${cond ? '✔' : '✘'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const isBlocked = makeBlockedLookup(map, props);
const grid = { cols: map.cols, rows: map.rows, isBlocked };
const spawn = at(SPAWN.col, SPAWN.row);

console.log('\n[1] 시작 지점이 걸을 수 있는 칸인가');
ok(!isBlocked(SPAWN.col, SPAWN.row), `시작 지점 (${SPAWN.col},${SPAWN.row})`);

console.log('\n[2] 로봇의 집이 시작 지점에서 콘 사거리 밖인가 (어느 방향을 보든)');
for (const [i, home] of SENTRY_HOMES.entries()) {
  const dist = Math.hypot(home.x - spawn.x, home.y - spawn.y);
  ok(
    dist > CONE_RANGE,
    `로봇 ${i} 의 집`,
    `${Math.round(dist)}px (콘 ${CONE_RANGE}px 의 ${(dist / CONE_RANGE).toFixed(1)}배)`,
  );
}

console.log('\n[3] 집에서 시작 지점까지 걸어오는 시간이 무적 유예보다 긴가');
// 직선 거리로 잰다 — 실제로는 길을 돌아오므로 이보다 오래 걸린다. 짧게 잡히는 쪽으로
// 틀리는 검사라 안전하다. 여유 2배를 요구하는 것은, 유예가 끝나는 순간 로봇이 이미
// 시야에 걸칠 만큼 다가와 있으면 통과해도 뜻이 없기 때문이다.
const graceSec = RESPAWN_GRACE_MS / 1000;
for (const [i, home] of SENTRY_HOMES.entries()) {
  const dist = Math.hypot(home.x - spawn.x, home.y - spawn.y);
  // 콘 사거리만큼 다가오면 이미 보이는 거리다 — 거기까지 걸리는 시간을 잰다.
  const seconds = Math.max(0, dist - CONE_RANGE) / SENTRY_SPEED;
  ok(
    seconds > graceSec * 2,
    `로봇 ${i}`,
    `${seconds.toFixed(1)}초 (유예 ${graceSec}초)`,
  );
}

console.log('\n[4] 각 집에서 도로 전체에 닿는가');
// 배회는 walk 마스크가 아니라 **도로(ROAM_ROADS)로 제한**된다 — Sentry 가 길찾기에
// 쓰는 것과 같은 판정으로 재야 검사의 뜻이 있다 (makeRoamBlocked 주석 참고).
const roamBlocked = makeRoamBlocked(isBlocked);
const roamGrid = { cols: map.cols, rows: map.rows, isBlocked: roamBlocked };
let roadCells = 0;
for (let r = 0; r < map.rows; r++) {
  for (let c = 0; c < map.cols; c++) if (!roamBlocked(c, r)) roadCells++;
}
for (const [i, home] of SENTRY_HOMES.entries()) {
  const from = { col: Math.floor(home.x / TILE), row: Math.floor(home.y / TILE) };
  ok(!roamBlocked(from.col, from.row), `로봇 ${i} 의 집이 도로 위인가`, `(${from.col},${from.row})`);
  const { dist } = walkField(from, roamGrid);
  let reached = 0;
  for (let k = 0; k < dist.length; k++) if (dist[k] >= 0) reached++;
  const pct = (reached / roadCells) * 100;
  // 도로는 사각형끼리 전부 이어지게 그렸으므로 100% 여야 한다 — 사각형을 하나
  // 옮기다 끊기면 그 로봇은 평생 한 토막만 돈다. 막다른 골목(가운데 위 통로)도
  // 도로에 넣었으니 "닿는가"에는 포함된다.
  ok(pct >= 100, `로봇 ${i}`, `도로 ${reached}/${roadCells}칸 (${pct.toFixed(1)}%)`);
}

console.log(failures ? `\n실패 ${failures}건\n` : '\n전부 통과\n');
process.exit(failures ? 1 : 0);
