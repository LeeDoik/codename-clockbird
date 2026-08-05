/**
 * 감옥 수감·탈출 검증 — 코드네임: 태엽새
 *
 *   node scripts/check-jail.js
 *
 * 2026-08-05 부터 스테이지 1 의 적발은 게임오버가 아니라 **수감**이다. 붙잡히면 창살
 * 안으로 옮겨지고, 잠금장치 퍼즐을 풀어야 거리로 돌아온다 (StageScene#toJail).
 * 여기서 잡는 것은 그 두 자리다 — **갇히는 칸**과 **나오는 칸**.
 *
 * 걸어 보기 전에는 모르는 종류의 사고라 검사가 필요하다. 감옥 안은 걷는 칸이 아니라서
 * 나올 자리를 좌표로 못박을 수 없고, 그래서 walkmask 에서 찾는다(streetLayout.jailExit).
 * 마스크를 다시 칠하면 그 자리가 조용히 벽 속으로, 또는 다른 구역으로 옮겨갈 수 있다.
 *
 * check-spawn-safety.js 와 같은 방식이다: 서버도 LLM 도 쓰지 않는다. 좌표 규칙은 씬과
 * **같은 파일**(world/streetLayout.js)에서, 벽 판정은 순찰의 시야와 **같은 함수**
 * (world/los.js)에서 읽는다 — 여기 다시 적으면 이 검사가 실제와 다른 것을 재게 된다.
 *
 * 서버 쪽 규칙(빗나감 → 수감, 갇힌 동안 재검문 거부, 탈출 보고)은 npm run smoke 가 본다.
 */
import { readFile } from 'node:fs/promises';
import { makeBlockedLookup } from '../src/client/world/los.js';
import { walkField } from '../src/client/world/roam.js';
import {
  PATROL_ROUTES,
  RADIUS_MAX,
  jailCell,
  jailExit,
  routeToPixels,
} from '../src/client/world/streetLayout.js';

const read = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
const map = await read('../src/client/assets/map.json');
const props = await read('../src/client/assets/street-props.json');

let failures = 0;
const ok = (cond, label, extra = '') => {
  console.log(`  ${cond ? '✔' : '✘'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const TILE = map.tileSize;
const isBlocked = makeBlockedLookup(map, props);
const cell = jailCell(map.cage);
const exit = jailExit(cell, isBlocked, map.spawns.player);
const center = ({ col, row }) => ({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 });

const cage = map.cage;
const inCage = ({ col, row }) =>
  col >= cage.x && col < cage.x + cage.w && row >= cage.y && row < cage.y + cage.h;

console.log(`\n감옥 ${JSON.stringify(cage)}   갇히는 칸 (${cell.col},${cell.row})   나오는 칸 (${exit.col},${exit.row})`);

console.log('\n[1] 갇히는 칸이 창살 안인가');
ok(inCage(cell), `(${cell.col},${cell.row}) 가 cage 사각형 안`);
// 붙잡힌 동료들과 같은 구역이어야 "같은 창살 안에 앉아 있다"는 대사가 성립한다.
const slot = { col: map.spawns.jail.col, row: map.spawns.jail.row };
ok(inCage(slot), `동료 슬롯 (${slot.col},${slot.row}) 도 같은 사각형 안`);

console.log('\n[2] 나오는 칸이 걸을 수 있고, 창살 밖인가');
ok(!isBlocked(exit.col, exit.row), `(${exit.col},${exit.row}) 가 걷는 칸`);
ok(!inCage(exit), '창살 밖');
// 못 찾았을 때의 폴백(시작 지점)이 그대로 나왔다면 둘레에 걷는 칸이 없다는 뜻이다.
ok(
  !(exit.col === map.spawns.player.col && exit.row === map.spawns.player.row),
  '폴백(시작 지점)으로 떨어지지 않았다',
);

console.log('\n[3] 나온 자리에서 거리 전체로 이어지는가');
// 걷는 칸이어도 사방이 막힌 주머니면 나오자마자 다시 갇힌 것과 같다.
let walkable = 0;
for (let r = 0; r < map.rows; r++) {
  for (let c = 0; c < map.cols; c++) if (!isBlocked(c, r)) walkable++;
}
const { dist } = walkField(exit, { cols: map.cols, rows: map.rows, isBlocked });
let reached = 0;
for (let k = 0; k < dist.length; k++) if (dist[k] >= 0) reached++;
const pct = (reached / walkable) * 100;
ok(pct >= 90, '거리의 대부분에 닿는다', `${reached}/${walkable}칸 (${pct.toFixed(1)}%)`);
// 동료에게 다시 접선하러 갈 수 있어야 한다 — 스폰과 끊겨 있으면 판이 거기서 멎는다.
const idx = ({ col, row }) => row * map.cols + col;
ok(dist[idx(map.spawns.player)] >= 0, '시작 지점까지 걸어서 닿는다');

console.log('\n[4] 나오는 칸이 순찰 감지 반경 밖인가');
// 나올 때 검문 통과와 같은 길이의 유예를 주지만, 그 유예가 끝나는 자리가 이미 순찰
// 경로 위라면 유예는 재수감을 늦출 뿐이다. 어느 로봇도 경로의 **어느 지점에서든**
// 이 칸을 보지 못해야 한다 (경계 3 기준 반경 = RADIUS_MAX).
const p = center(exit);
const distToSegment = (a, b) => {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
};
for (const [name, route] of Object.entries(PATROL_ROUTES)) {
  const way = routeToPixels(route, TILE);
  let min = Infinity;
  for (let i = 0; i < way.length - 1; i++) min = Math.min(min, distToSegment(way[i], way[i + 1]));
  ok(min > RADIUS_MAX, `${name} 경로`, `${Math.round(min)}px (반경 ${RADIUS_MAX}px)`);
}

console.log(failures ? `\n실패 ${failures}건\n` : '\n전부 통과\n');
process.exit(failures ? 1 : 0);
