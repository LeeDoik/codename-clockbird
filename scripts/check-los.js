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

// 양 끝점 제외 규칙: 감지자·대상이 서 있는 칸 자체는 막힘 여부와 무관해야 한다
// (발밑 판정이 좁아 벽에 살짝 겹쳐 서는 경우가 있다).
//
// 타일 "중심"끼리(mid ↔ mid)는 이 규칙을 가르지 못한다 — LOS_STEP(8)이 타일(32)보다
// 촘촘해, 인접 타일까지의 거리(32)를 8 단위로 쪼갠 첫 중간 샘플(8px 지점)이 여전히
// 출발 타일 안이라 끝점 포함 여부와 무관하게 항상 막힌다. 그래서 시작/도착 "점"을
// 벽 타일의 반대쪽 가장자리 바로 안쪽(0.1px 여유)에 둔다 — 그 지점에서 한 스텝(8px)만
// 나가면 바로 이웃 타일이므로, 끝점 자체를 검사하는 버그가 있을 때만 걸린다.
const wallEdgeOut = { x: 2 * TILE + TILE - 0.1, y: 1 * TILE + TILE / 2 }; // col2(벽) 오른쪽 가장자리 안쪽
ok(
  hasLineOfSight(wallEdgeOut, mid(3, 1), TILE, blocked) === true,
  '출발점이 벽 가장자리에 겹쳐 있어도 그 점 자체는 막힘 판정에서 빠진다'
);
const wallEdgeIn = { x: 2 * TILE + 0.1, y: 1 * TILE + TILE / 2 }; // col2(벽) 왼쪽 가장자리 안쪽
ok(
  hasLineOfSight(mid(1, 1), wallEdgeIn, TILE, blocked) === true,
  '도착점이 벽 가장자리에 겹쳐 있어도 그 점 자체는 막힘 판정에서 빠진다'
);

console.log('\n[2] walk 기반 (걷는 길 마스크가 유일한 원본)');
// walkmask 를 쓰는 맵은 layout 의 solid 를 보지 않는다 — buildColliders 와 같은 규칙이어야
// 화면에 그려진 벽과 시야 판정이 어긋나지 않는다.
const props = { walk: ['11011', '11011', '11011'] };
const wblocked = makeBlockedLookup(mapData, props);
ok(wblocked(2, 1) === true, "walk 의 '0' 은 막힌 칸");
ok(wblocked(0, 1) === false, "walk 의 '1' 은 걷는 길");
ok(hasLineOfSight(mid(0, 1), mid(4, 1), TILE, wblocked) === false, 'walk 기준으로도 벽 너머는 안 보인다');
ok(
  hasLineOfSight(wallEdgeOut, mid(3, 1), TILE, wblocked) === true,
  'walk 기준으로도 출발점이 벽 가장자리에 겹쳐 있으면 그 점은 제외된다'
);

console.log('\n[3] tiles 배열 범위 밖 인덱스');
// layout 이 tiles 배열에 없는 인덱스를 가리키면(맵 데이터 오류) 조용히 뚫리면 안 된다 —
// 이관 전 코드는 이 경우 TypeError 로 시끄럽게 죽었다. 지금 map.json 은 tiles 가 7개라
// (인덱스 0~6) 이 경로에 닿지 않지만, 데이터가 틀렸을 때 뚫리는 쪽으로 조용히 틀리면
// 벽 관통 감지가 된다.
const oobMapData = {
  tileSize: TILE,
  cols: 1,
  rows: 1,
  tiles: [{ name: '바닥', solid: false }], // index 0 만 정의
  layout: [[5]], // tiles 범위 밖 인덱스
};
const oobBlocked = makeBlockedLookup(oobMapData);
ok(oobBlocked(0, 0) === true, 'tiles 범위 밖 인덱스는 막힌 것으로 본다');

console.log(failures ? `\n실패 ${failures}건\n` : '\n전부 통과\n');
process.exit(failures ? 1 : 0);
