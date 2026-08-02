/**
 * ⚠ 은퇴한 스크립트 — 다시 돌리지 마라 (2026-08-02).
 *
 * 네 맵이 전부 AI 배틀맵으로 넘어갔다 (docs/맵교체_계획.md). 배경은
 * scripts/import-map-art.js 가 굽고, 충돌은 scripts/walkmask.js 의 walk 격자가 정한다.
 * 이 파일을 돌리면 그 결과물을 옛 절차적 생성물로 덮어써서 통째로 날린다.
 * 아래 내용은 그때 어떻게 만들었는지를 남겨 둔 기록이다.
 */
/**
 * 스테이지 1 거리 맵 생성기 — 코드네임: 태엽새
 *
 *   node scripts/gen-street-map.js
 *
 * 좌표 출처: docs/archive/스테이지1 거리 맵.dc.html (클로드 디자인 프로토타입).
 * 건물·광장·지름길·나무·가로등·감옥 위치를 그대로 옮기고, 타일 크기만 16 → 32 로 읽는다
 * (스테이지 2 와 같은 결정 — 16px 이면 월드가 960×768 이라 카메라가 한 화면에 다 담는다).
 *
 * 저택과 반대로 여기는 **바깥**이다. 방이 아니라 블록이 있고, 건물은 들어가는 곳이 아니라
 * 돌아가는 것이다. 그래서 걷는 면이 기본이고 건물이 그 위에 얹힌다.
 *
 * 스토리보드 p13 의 "9섹터"는 맵을 3×3 으로 나눈 것이다 — 섹터 경계는 벽이 아니라
 * 이름일 뿐이라 layout 에는 들어가지 않고, 씬이 위치를 이름으로 옮길 때만 쓴다.
 *
 * 출력: src/client/assets/map.json
 */
import fs from 'node:fs';

const COLS = 60;
const ROWS = 48;
const TILE = 32;
/** 맵 가장자리 — 걸어 나갈 수 없는 띠. 원본이 2칸을 비워 뒀다. */
const EDGE = 2;

const T = { STREET: 0, PLAZA: 1, PATH: 2, BUILDING: 3, CAGE: 4, TREE: 5, EDGEBAND: 6 };
const TILE_META = [
  { name: '자갈 거리', solid: false },
  { name: '광장 포석', solid: false },
  { name: '흙 지름길', solid: false },
  { name: '건물', solid: true },
  { name: '임시 감옥', solid: true },
  { name: '나무', solid: true },
  { name: '경계', solid: true },
];

// ── 원본 배치 ─────────────────────────────────────────────────────
const BUILDINGS = [
  { x: 3, y: 2, w: 5, h: 6, s: 'tower' }, { x: 11, y: 3, w: 6, h: 5, s: 'brick' },
  { x: 24, y: 2, w: 6, h: 5, s: 'plas' }, { x: 31, y: 3, w: 6, h: 5, s: 'brick' },
  { x: 26, y: 9, w: 6, h: 4, s: 'brick' }, { x: 44, y: 3, w: 8, h: 5, s: 'slate' },
  { x: 53, y: 4, w: 4, h: 4, s: 'plas' }, { x: 10, y: 20, w: 6, h: 5, s: 'plas' },
  { x: 44, y: 20, w: 7, h: 5, s: 'brick' }, { x: 53, y: 21, w: 5, h: 5, s: 'plas' },
  { x: 2, y: 37, w: 6, h: 5, s: 'plas' }, { x: 10, y: 36, w: 7, h: 5, s: 'brick' },
  { x: 24, y: 36, w: 4, h: 4, s: 'slate' }, { x: 45, y: 37, w: 8, h: 6, s: 'slate' },
];
const CAGE = { x: 29, y: 37, w: 7, h: 5 };
const PLAZAS = [{ x: 3, y: 9, w: 11, h: 4 }, { x: 24, y: 20, w: 13, h: 9 }];
const TREES = [
  [8, 11], [15, 10], [34, 8], [24, 11], [52, 8], [13, 26], [25, 22],
  [35, 26], [56, 27], [7, 44], [35, 44], [56, 34], [20, 44], [43, 17],
];
const LAMPS = [
  [17, 8], [23, 13], [17, 26], [23, 31], [37, 8], [43, 13], [37, 27], [43, 31],
  [8, 17], [28, 17], [48, 17], [8, 33], [28, 33], [48, 33], [5, 9], [31, 21],
  [31, 43], [46, 43], [55, 16],
];
/** 대각 지름길 — 블록 모서리를 잘라내며 구역 경계를 흐린다 */
const PATHS = [[14, 12, 25, 21], [36, 28, 46, 37], [17, 41, 26, 35], [37, 13, 45, 19]];

const SECTORS = [
  { id: 0, name: '종탑 광장' }, { id: 1, name: '중앙 대로' }, { id: 2, name: '정거장 뒷골목' },
  { id: 3, name: '시장 골목' }, { id: 4, name: '게시판 광장' }, { id: 5, name: '목공소 뒷마당' },
  { id: 6, name: '빨래 골목' }, { id: 7, name: '임시 감옥 앞' }, { id: 8, name: '부두 창고' },
];

/**
 * NPC 자리.
 *
 * 원본은 요른(시계 수리공)을 단어를 내는 동료 다섯 중 하나로 넣었지만, 이 게임의 규칙은
 * **동료 5 + 접선책 1** 이다 (W2 ① 확정 — 접선책은 단어를 안 내고 코드를 받는 쪽).
 * 그래서 요른은 종탑 광장 자리에 접선책으로 남기고, 동료 다섯은 나머지 자리와
 * 정거장 뒷골목에 나눠 세운다. 직업과 장소가 맞물리게 배치했다.
 */
const BROKER = { col: 9, row: 11 }; // 종탑 광장 — 멎은 종탑 아래 시계 수리공
const ALLIES = [
  { id: 'watchmaker', col: 51, row: 27 }, // 에이다 시계공 — 목공소 뒷마당 (추를 깎는 곳)
  { id: 'maid', col: 8, row: 25 }, // 리나 주방 하녀 — 시장 골목 좌판
  { id: 'engineer', col: 46, row: 11 }, // 보리스 기관사 — 정거장 뒷골목
  { id: 'smuggler', col: 53, row: 44 }, // 카이 밀수꾼 — 부두 창고
  { id: 'musician', col: 33, row: 11 }, // 노아 거리 악사 — 중앙 대로
];
const CITIZENS = [
  { col: 26, row: 16 }, { col: 46, row: 16 }, { col: 13, row: 32 },
  { col: 30, row: 33 }, { col: 55, row: 16 },
];
const PLAYER = { col: 29, row: 27 }; // 게시판 광장 한복판

// ── 조립 ──────────────────────────────────────────────────────────
const layout = Array.from({ length: ROWS }, () => new Array(COLS).fill(T.EDGEBAND));
const paint = (x, y, w, h, v) => {
  for (let r = y; r < y + h; r++) {
    for (let c = x; c < x + w; c++) if (layout[r]?.[c] !== undefined) layout[r][c] = v;
  }
};

// 안쪽은 전부 거리
paint(EDGE, EDGE, COLS - EDGE * 2, ROWS - EDGE * 2, T.STREET);
for (const p of PLAZAS) paint(p.x, p.y, p.w, p.h, T.PLAZA);

// 대각 지름길 — 사람들이 밟아 다져 놓은 길.
//
// 2칸 폭으로 반듯하게 그으면 계단이 된다. 폭을 3칸으로 넓히고 걸음마다 가장자리를
// 흔들어, 발길이 만든 길처럼 테두리가 들쭉날쭉하게 남긴다.
const jitter = (a, b) => {
  let n = (a * 374761393 + b * 668265263) | 0;
  n = ((n ^ (n >> 13)) * 1274126177) | 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
};
for (const [pi, [x0, y0, x1, y1]] of PATHS.entries()) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
  for (let i = 0; i <= steps; i++) {
    const fx = x0 + ((x1 - x0) * i) / steps;
    const fy = y0 + ((y1 - y0) * i) / steps;
    const rad = 1.6 + jitter(pi * 31 + i, 7) * 1.1;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (Math.hypot(dx, dy) > rad) continue;
        const c = Math.round(fx) + dx;
        const r = Math.round(fy) + dy;
        if (layout[r]?.[c] === T.STREET) layout[r][c] = T.PATH;
      }
    }
  }
}

for (const b of BUILDINGS) paint(b.x, b.y, b.w, b.h, T.BUILDING);
paint(CAGE.x, CAGE.y, CAGE.w, CAGE.h, T.CAGE);
for (const [x, y] of TREES) paint(x, y, 1, 1, T.TREE);

// ── 검사 ──────────────────────────────────────────────────────────
const key = (c, r) => `${c},${r}`;
const walkable = (c, r) =>
  c >= 0 && r >= 0 && c < COLS && r < ROWS && !TILE_META[layout[r][c]].solid;

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

const bad = [];
if (!walkable(PLAYER.col, PLAYER.row)) bad.push('플레이어 스폰이 막혀 있다');
const near = (c, r) =>
  [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => seen.has(key(c + dc, r + dr)));

for (const a of ALLIES) if (!near(a.col, a.row)) bad.push(`동료 ${a.id} (${a.col},${a.row}) 에 못 간다`);
if (!near(BROKER.col, BROKER.row)) bad.push(`접선책 (${BROKER.col},${BROKER.row}) 에 못 간다`);
for (const [i, z] of CITIZENS.entries()) if (!near(z.col, z.row)) bad.push(`시민 ${i + 1} 에 못 간다`);

// 감옥 앞 — 창살 너머로 구출하려면 우리 바로 앞에 설 수 있어야 한다
const jailFront = Array.from({ length: CAGE.w }, (_, i) => [CAGE.x + i, CAGE.y + CAGE.h]);
if (!jailFront.some(([c, r]) => seen.has(key(c, r)))) bad.push('감옥 앞에 설 수 없다');

// 섹터마다 발 디딜 곳이 있는가 — 한 구역이 통째로 갇히면 9섹터 설계가 무너진다
const SW = COLS / 3;
const SH = ROWS / 3;
for (const s of SECTORS) {
  const cx = (s.id % 3) * SW;
  const cy = Math.floor(s.id / 3) * SH;
  let n = 0;
  for (let r = cy; r < cy + SH; r++) for (let c = cx; c < cx + SW; c++) if (seen.has(key(c, r))) n++;
  if (n < 40) bad.push(`${s.name}: 닿는 칸이 ${n}개뿐이다`);
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
  tileset: 'street-bg.png',
  tiles: TILE_META,
  layout,
  spawns: {
    player: PLAYER,
    allies: ALLIES,
    broker: BROKER,
    citizens: CITIZENS,
    // 체포된 동료가 서는 자리 — 우리 안쪽 앞줄. 슬롯마다 오른쪽으로 밀린다.
    jail: { col: CAGE.x + 1, row: CAGE.y + CAGE.h - 2, step: 44 },
  },
  // 씬이 쓰는 부가 정보
  sectors: SECTORS,
  cage: CAGE,
  buildings: BUILDINGS,
  plazas: PLAZAS,
  trees: TREES,
  lamps: LAMPS,
};

const json = JSON.stringify(map, null, 2).replace(
  /"layout": \[[\s\S]*?\n {2}\]/,
  '"layout": [\n' + layout.map((row) => `    [${row.join(',')}]`).join(',\n') + '\n  ]',
);
fs.writeFileSync('src/client/assets/map.json', json + '\n');

console.log(`${COLS}×${ROWS} · 타일 ${TILE}px · 월드 ${COLS * TILE}×${ROWS * TILE}px`);
console.log(`건물 ${BUILDINGS.length} · 나무 ${TREES.length} · 가로등 ${LAMPS.length} · 섹터 ${SECTORS.length}`);
console.log(`도달성 검사 통과 — 동료 ${ALLIES.length} · 접선책 · 시민 ${CITIZENS.length} · 감옥 앞`);
console.log('→ src/client/assets/map.json');
