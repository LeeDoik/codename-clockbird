/**
 * ⚠ 은퇴한 스크립트 — 다시 돌리지 마라 (2026-08-02).
 *
 * 네 맵이 전부 AI 배틀맵으로 넘어갔다 (docs/맵교체_계획.md). 배경은
 * scripts/import-map-art.js 가 굽고, 충돌은 scripts/walkmask.js 의 walk 격자가 정한다.
 * 이 파일을 돌리면 그 결과물을 옛 절차적 생성물로 덮어써서 통째로 날린다.
 * 아래 내용은 그때 어떻게 만들었는지를 남겨 둔 기록이다.
 */
/**
 * 튜토리얼 본부 맵 생성기 — 코드네임: 태엽새
 *
 *   node scripts/gen-hq-map.js
 *
 * 좌표 출처: docs/archive/튜토리얼 본부 맵.dc.html (클로드 디자인 프로토타입).
 * 구역 5개와 칸막이 6개를 그대로 옮기고 타일만 16 → 32px 로 읽는다 (스테이지 1·2 와 같은 결정).
 *
 * 본부는 좁아야 한다 — 34×20 = 월드 1088×640 으로, 카메라(960×540)보다 조금 클 뿐이다.
 * 거리(1920×1536)나 저택(1920×1120)처럼 헤매는 곳이 아니라 세 사람에게 차례로 말을 걸고
 * 나가는 방이라, 넓히면 배우는 리듬이 늘어진다.
 *
 * 출력: src/client/assets/hq.json
 */
import fs from 'node:fs';

const COLS = 34;
const ROWS = 20;
const TILE = 32;

const T = { PLANK: 0, STONE: 1, TILE: 2, WALL: 3 };
const TILE_META = [
  { name: '널판 바닥', solid: false },
  { name: '석재 바닥', solid: false },
  { name: '취사 타일', solid: false },
  { name: '벽', solid: true },
];

/** 구역 — 벽으로 갈린 방이 아니라 한 층을 나눠 쓰는 자리다. floor 는 바닥재. */
const ZONES = [
  { id: 'armory', name: '무기고', x: 2, y: 2, w: 9, h: 10, floor: T.STONE },
  { id: 'command', name: '지휘 테이블', x: 12, y: 2, w: 12, h: 10, floor: T.PLANK },
  { id: 'board', name: '작전 게시판', x: 25, y: 2, w: 7, h: 10, floor: T.PLANK },
  { id: 'kitchen', name: '취사 구석', x: 2, y: 13, w: 13, h: 5, floor: T.TILE },
  { id: 'stairs', name: '계단 · 출구', x: 16, y: 13, w: 16, h: 5, floor: T.STONE },
];

/**
 * 칸막이 — 구역을 나누되 완전히 막지는 않는다.
 * 세로 칸막이는 아래 세 칸을, 가로 칸막이는 가운데를 비워 두어 통로가 남는다.
 */
const PARTS = [
  { x: 11, y: 2, w: 1, h: 7 },
  { x: 24, y: 2, w: 1, h: 7 },
  { x: 2, y: 12, w: 8, h: 1 },
  { x: 15, y: 12, w: 12, h: 1 },
  { x: 29, y: 12, w: 3, h: 1 },
  { x: 15, y: 13, w: 1, h: 5 },
];

const LAMPS = [
  [5, 4], [5, 10], [16, 3], [16, 10], [21, 5], [28, 4],
  [28, 10], [6, 14], [11, 16], [19, 14], [24, 16], [30, 13],
];

// 원본의 소수 좌표를 칸으로 내린다.
const PLAYER = { col: 17, row: 8 }; // 지휘 테이블 앞
const OFFICER = { col: 17, row: 4 }; // 테이블 너머 — 브리핑 자리
const ALLIES = [
  { id: 't1', col: 5, row: 7 }, // 레나 — 무기고
  { id: 't2', col: 28, row: 6 }, // 미아 — 작전 게시판
  { id: 't3', col: 5, row: 16 }, // 오토 — 취사 구석
];

// ── 조립 ──────────────────────────────────────────────────────────
const layout = Array.from({ length: ROWS }, () => new Array(COLS).fill(T.WALL));
const paint = (x, y, w, h, v) => {
  for (let r = y; r < y + h; r++) {
    for (let c = x; c < x + w; c++) if (layout[r]?.[c] !== undefined) layout[r][c] = v;
  }
};
// 안쪽은 통째로 한 층이다 — 구역 사각형은 바닥재를 칠하는 범위일 뿐 벽이 아니다.
// 구역만 칠하면 그 사이(열 11·24, 행 12)가 아무 데도 속하지 않아 벽으로 남고,
// 그러면 방마다 고립된다. 먼저 전부 깔고 구역을 덮은 뒤, 칸막이만 세운다.
paint(2, 2, COLS - 4, ROWS - 4, T.PLANK);
for (const z of ZONES) paint(z.x, z.y, z.w, z.h, z.floor);
for (const p of PARTS) paint(p.x, p.y, p.w, p.h, T.WALL);

// ── 검사 ──────────────────────────────────────────────────────────
const key = (c, r) => `${c},${r}`;
const walkable = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS && !TILE_META[layout[r][c]].solid;

const seen = new Set([key(PLAYER.col, PLAYER.row)]);
const queue = [[PLAYER.col, PLAYER.row]];
while (queue.length) {
  const [c, r] = queue.pop();
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const k = key(c + dc, r + dr);
    if (seen.has(k) || !walkable(c + dc, r + dr)) continue;
    seen.add(k);
    queue.push([c + dc, r + dr]);
  }
}

const near = (c, r) =>
  [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => seen.has(key(c + dc, r + dr)));

const bad = [];
if (!walkable(PLAYER.col, PLAYER.row)) bad.push('플레이어 스폰이 막혔다');
if (!near(OFFICER.col, OFFICER.row)) bad.push('간부에게 갈 수 없다');
for (const a of ALLIES) if (!near(a.col, a.row)) bad.push(`동료 ${a.id} 에게 갈 수 없다`);
// 구역마다 실제로 들어갈 수 있어야 한다 — 칸막이를 하나만 잘못 그어도 한 구역이 통째로 갇힌다
for (const z of ZONES) {
  let n = 0;
  for (let r = z.y; r < z.y + z.h; r++) for (let c = z.x; c < z.x + z.w; c++) if (seen.has(key(c, r))) n++;
  if (n < 10) bad.push(`${z.name}: 닿는 칸이 ${n}개뿐이다`);
}
if (bad.length) {
  console.error('\n도달성 오류\n  ' + bad.join('\n  ') + '\n');
  process.exit(1);
}

// ── 출력 ──────────────────────────────────────────────────────────
const map = {
  format: 'clockbird-tilemap',
  version: 1,
  tileSize: TILE,
  cols: COLS,
  rows: ROWS,
  tileset: 'hq-bg.png',
  tiles: TILE_META,
  layout,
  spawns: { player: PLAYER, officer: OFFICER, allies: ALLIES },
  zones: ZONES,
  parts: PARTS,
  lamps: LAMPS,
};

const json = JSON.stringify(map, null, 2).replace(
  /"layout": \[[\s\S]*?\n {2}\]/,
  '"layout": [\n' + layout.map((row) => `    [${row.join(',')}]`).join(',\n') + '\n  ]',
);
fs.writeFileSync('src/client/assets/hq.json', json + '\n');

console.log(`${COLS}×${ROWS} · 타일 ${TILE}px · 월드 ${COLS * TILE}×${ROWS * TILE}px`);
console.log(`구역 ${ZONES.length} · 칸막이 ${PARTS.length} · 등불 ${LAMPS.length}`);
console.log('도달성 검사 통과 — 간부 · 동료 3 · 구역 5');
console.log('→ src/client/assets/hq.json');
