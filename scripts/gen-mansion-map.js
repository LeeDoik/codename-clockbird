/**
 * 스테이지 2 저택 맵 생성기 — 코드네임: 태엽새
 *
 *   node scripts/gen-mansion-map.js
 *
 * 방·문 사각형 목록에서 60×34 타일맵을 만든다. 손으로 배열을 적으면 반드시 틀리고,
 * 틀려도 눈으로는 안 보인다 (문 한 칸이 어긋나면 그 방이 통째로 고립된다).
 * 그래서 사각형을 단일 출처로 두고 layout 은 여기서 뽑으며, 뽑은 뒤 도달성을 직접 검사한다.
 *
 * 좌표 출처: docs/archive/스테이지2 저택 맵.dc.html (클로드 디자인 프로토타입)의
 * rooms / doors 배열을 그대로 옮겼다. 타일 크기만 16 → 32 로 읽는다 (계획서 D2).
 *
 * 출력: src/client/assets/mansion.json
 */
import fs from 'node:fs';

const COLS = 60;
// 원본은 34행인데 홀(y23, h11)이 마지막 행까지 차서 아래쪽 벽이 없다. 방 좌표를 건드리는
// 대신 테두리 행 하나만 덧댄다 — 방 10개와 문 8개의 좌표는 원본 그대로 남는다.
const ROWS = 35;
const TILE = 32;

// ── 타일 ──────────────────────────────────────────────────────────
// 인덱스가 곧 mansion.png 의 프레임 번호다 (scripts/gen-mansion-tiles.js 와 짝).
const T = { WALL: 0, PARQUET: 1, CARPET: 2, STONE: 3, WOOD: 4, TILE: 5, METAL: 6, DOOR: 7, LOCKED: 8 };
const FLOOR = {
  parquet: T.PARQUET,
  carpet: T.CARPET,
  stone: T.STONE,
  wood: T.WOOD,
  tile: T.TILE,
  metal: T.METAL,
};
const TILE_META = [
  { name: '벽', solid: true },
  { name: '마루', solid: false },
  { name: '카펫', solid: false },
  { name: '석재', solid: false },
  { name: '나무', solid: false },
  { name: '타일', solid: false },
  { name: '금속', solid: false },
  { name: '문', solid: false },
  // 잠긴 문은 벽이다. 열쇠를 얻으면 씬이 그 자리의 정적 바디만 걷어낸다.
  { name: '잠긴 문', solid: true },
];

// ── 방 ────────────────────────────────────────────────────────────
// 사각형은 서로 닿지 않는다 — 벽 한 칸을 사이에 두고 문이 그 벽을 뚫는다.
// 예외: 복도와 홀은 y=23 행에서 겹쳐 문 없이 직접 통한다 (원본 그대로).
const ROOMS = [
  { id: 'hall',    name: '홀',        x: 21, y: 23, w: 18, h: 11, floor: 'parquet' },
  { id: 'corr',    name: '복도',      x: 26, y: 2,  w: 8,  h: 22, floor: 'carpet' },
  { id: 'laundry', name: '세탁실',    x: 13, y: 2,  w: 12, h: 8,  floor: 'stone' },
  { id: 'library', name: '서재',      x: 35, y: 2,  w: 12, h: 8,  floor: 'wood' },
  { id: 'locked',  name: '잠긴 방',   x: 14, y: 12, w: 11, h: 8,  floor: 'wood' },
  { id: 'kitchen', name: '주방',      x: 35, y: 12, w: 11, h: 8,  floor: 'tile' },
  { id: 'office',  name: '집사실',    x: 2,  y: 16, w: 11, h: 8,  floor: 'wood' },
  { id: 'lab',     name: '연구실',    x: 47, y: 17, w: 12, h: 8,  floor: 'metal' },
  { id: 'dining',  name: '식당',      x: 1,  y: 26, w: 19, h: 6,  floor: 'wood' },
  { id: 'walk',    name: '하인 통로', x: 40, y: 26, w: 19, h: 6,  floor: 'stone' },
];

// ── 문 ────────────────────────────────────────────────────────────
// key: 'lab' 은 연구실 열쇠로 열린다. locked: true 는 영구 잠김(스테이지 3 복선).
const DOORS = [
  { x: 25, y: 5,  w: 1, h: 2, between: ['laundry', 'corr'] },
  { x: 34, y: 5,  w: 1, h: 2, between: ['corr', 'library'] },
  { x: 25, y: 15, w: 1, h: 2, between: ['corr', 'locked'], locked: true },
  { x: 34, y: 15, w: 1, h: 2, between: ['corr', 'kitchen'] },
  { x: 6,  y: 24, w: 2, h: 2, between: ['office', 'dining'] },
  { x: 51, y: 25, w: 2, h: 1, between: ['walk', 'lab'], key: 'lab' },
  { x: 20, y: 28, w: 1, h: 2, between: ['dining', 'hall'] },
  { x: 39, y: 28, w: 1, h: 2, between: ['hall', 'walk'] },
];

const SPAWNS = {
  player: { col: 27, row: 28 }, // 홀 — 원본의 player {x:27.5, y:28}
};

// ── 조립 ──────────────────────────────────────────────────────────
const layout = Array.from({ length: ROWS }, () => new Array(COLS).fill(T.WALL));

const paint = (x, y, w, h, v) => {
  for (let r = y; r < y + h; r++) {
    for (let c = x; c < x + w; c++) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) throw new Error(`격자 밖: (${c},${r})`);
      layout[r][c] = v;
    }
  }
};

for (const room of ROOMS) paint(room.x, room.y, room.w, room.h, FLOOR[room.floor]);
for (const door of DOORS) paint(door.x, door.y, door.w, door.h, door.locked || door.key ? T.LOCKED : T.DOOR);

// ── 검사 1: 테두리가 전부 벽인가 ──────────────────────────────────
// 한 칸이라도 뚫려 있으면 플레이어가 맵 밖으로 걸어 나간다.
for (let c = 0; c < COLS; c++) {
  if (layout[0][c] !== T.WALL || layout[ROWS - 1][c] !== T.WALL) throw new Error(`테두리 구멍: col ${c}`);
}
for (let r = 0; r < ROWS; r++) {
  if (layout[r][0] !== T.WALL || layout[r][COLS - 1] !== T.WALL) throw new Error(`테두리 구멍: row ${r}`);
}

// ── 검사 2: 도달성 ────────────────────────────────────────────────
/** 플레이어 스폰에서 걸어서 닿는 칸을 전부 표시한다. openKeys 에 든 문은 열린 것으로 친다. */
function reachable(openKeys = []) {
  const opened = new Set();
  for (const d of DOORS) {
    if (d.key && openKeys.includes(d.key)) {
      for (let r = d.y; r < d.y + d.h; r++) for (let c = d.x; c < d.x + d.w; c++) opened.add(`${c},${r}`);
    }
  }
  const walkable = (c, r) =>
    c >= 0 && c < COLS && r >= 0 && r < ROWS && (!TILE_META[layout[r][c]].solid || opened.has(`${c},${r}`));

  const seen = new Set();
  const queue = [[SPAWNS.player.col, SPAWNS.player.row]];
  seen.add(`${SPAWNS.player.col},${SPAWNS.player.row}`);
  while (queue.length) {
    const [c, r] = queue.pop();
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      const k = `${nc},${nr}`;
      if (seen.has(k) || !walkable(nc, nr)) continue;
      seen.add(k);
      queue.push([nc, nr]);
    }
  }
  return seen;
}

/** 방의 모든 바닥 칸이 닿는가 (일부만 닿으면 방 안이 벽으로 갈린 것이다). */
function roomReached(room, seen) {
  for (let r = room.y; r < room.y + room.h; r++) {
    for (let c = room.x; c < room.x + room.w; c++) if (!seen.has(`${c},${r}`)) return false;
  }
  return true;
}

const before = reachable();
const after = reachable(['lab']);

const report = ROOMS.map((room) => ({
  방: room.name,
  열쇠전: roomReached(room, before),
  열쇠후: roomReached(room, after),
}));

// 잠긴 방은 영구 잠김이라 끝까지 못 닿는 것이 정상이다. 나머지는 전부 닿아야 한다.
const mustReachNow = ROOMS.filter((r) => r.id !== 'locked' && r.id !== 'lab');
const bad = mustReachNow.filter((r) => !roomReached(r, before));
if (bad.length) throw new Error(`열쇠 없이 못 가는 방: ${bad.map((r) => r.name).join(', ')}`);
if (!roomReached(ROOMS.find((r) => r.id === 'lab'), after)) throw new Error('열쇠를 얻어도 연구실에 못 간다');
if (roomReached(ROOMS.find((r) => r.id === 'lab'), before)) throw new Error('열쇠 없이 연구실에 들어가진다');
if (roomReached(ROOMS.find((r) => r.id === 'locked'), after)) throw new Error('잠긴 방이 열려 있다');

// 문마다 양쪽이 실제로 이어졌는지 — between 표기가 거짓이면 여기서 걸린다.
for (const d of DOORS) {
  if (d.locked) continue;
  const seen = d.key ? after : before;
  for (const id of d.between) {
    const room = ROOMS.find((r) => r.id === id);
    if (!roomReached(room, seen)) throw new Error(`문 (${d.x},${d.y}) 의 ${room.name} 쪽이 막혔다`);
  }
}

// ── 출력 ──────────────────────────────────────────────────────────
const map = {
  format: 'clockbird-tilemap',
  version: 1,
  tileSize: TILE,
  cols: COLS,
  rows: ROWS,
  tileset: 'mansion.png',
  tiles: TILE_META,
  layout,
  spawns: SPAWNS,
  // 씬이 쓰는 부가 정보 — 방 이름 표시와 열쇠로 여는 문 찾기에 필요하다.
  rooms: ROOMS.map(({ id, name, x, y, w, h }) => ({ id, name, x, y, w, h })),
  doors: DOORS,
};

// layout 은 한 행을 한 줄로 — 사람이 눈으로 지도를 읽을 수 있어야 한다.
const json = JSON.stringify(map, null, 2).replace(
  /"layout": \[[\s\S]*?\n {2}\]/,
  '"layout": [\n' + layout.map((row) => `    [${row.join(',')}]`).join(',\n') + '\n  ]',
);
fs.writeFileSync('src/client/assets/mansion.json', json + '\n');

console.table(report);
console.log(`\n${COLS}×${ROWS} · 타일 ${TILE}px · 월드 ${COLS * TILE}×${ROWS * TILE}px`);
console.log(`방 ${ROOMS.length} · 문 ${DOORS.length} · 도달성 검사 통과`);
console.log('→ src/client/assets/mansion.json');
