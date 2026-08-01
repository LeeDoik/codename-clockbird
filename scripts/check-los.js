/**
 * world/los.js 단위 검증 — 코드네임: 태엽새
 *
 *   node scripts/check-los.js
 *
 * los.js 는 Phaser 를 import 하지 않는 순수 함수다. 그래서 브라우저 없이 여기서 돌린다 —
 * 시야 판정은 눈으로 확인하기 가장 어려운 규칙이라 자동 검증이 특히 값지다.
 */
import { hasLineOfSight, makeBlockedLookup } from '../src/client/world/los.js';

let failures = 0;
const ok = (cond, label, extra = '') => {
  console.log(`  ${cond ? '✔' : '✘'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

// 5×3 맵. 가운데 세로줄(col 2)이 벽이다.
//   . . # . .
//   . . # . .
//   . . # . .
const TILE = 32;
const mapData = {
  tileSize: TILE,
  cols: 5,
  rows: 3,
  tiles: [{ name: '바닥', solid: false }, { name: '벽', solid: true }],
  layout: [
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
  ],
};
const mid = (c, r) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });

console.log('\n[1] layout 기반 (walk 없음)');
const blocked = makeBlockedLookup(mapData);
ok(blocked(2, 1) === true, 'col 2 는 벽이다');
ok(blocked(0, 1) === false, 'col 0 은 바닥이다');
ok(blocked(-1, 0) === true, '맵 밖은 막힌 것으로 본다');
ok(blocked(99, 0) === true, '맵 밖(오른쪽)도 막힌 것으로 본다');
ok(hasLineOfSight(mid(0, 1), mid(1, 1), TILE, blocked) === true, '벽 없는 이웃 칸은 보인다');
ok(hasLineOfSight(mid(0, 1), mid(4, 1), TILE, blocked) === false, '벽 너머는 안 보인다');
ok(hasLineOfSight(mid(3, 1), mid(4, 1), TILE, blocked) === true, '벽 오른쪽끼리는 보인다');

console.log('\n[2] walk 기반 (걷는 길 마스크가 유일한 원본)');
// walkmask 를 쓰는 맵은 layout 의 solid 를 보지 않는다 — buildColliders 와 같은 규칙이어야
// 화면에 그려진 벽과 시야 판정이 어긋나지 않는다.
const props = { walk: ['11011', '11011', '11011'] };
const wblocked = makeBlockedLookup(mapData, props);
ok(wblocked(2, 1) === true, "walk 의 '0' 은 막힌 칸");
ok(wblocked(0, 1) === false, "walk 의 '1' 은 걷는 길");
ok(hasLineOfSight(mid(0, 1), mid(4, 1), TILE, wblocked) === false, 'walk 기준으로도 벽 너머는 안 보인다');

console.log(failures ? `\n실패 ${failures}건\n` : '\n전부 통과\n');
process.exit(failures ? 1 : 0);
