/**
 * 동료 스폰 안전 검사 — 스폰 지점이 (1) 걸을 수 있는 바닥이고
 * (2) 모든 순찰 경로 선분에서 최대 감지 반경(228px)+여유 밖인지 확인한다.
 * 불합격이면 해당 지점 주변에서 조건을 만족하는 가장 가까운 칸을 제안한다.
 *
 * Patrol.js 의 경로를 import 하지 않는 이유: Phaser 의존이라 노드에서 안 돈다.
 * 좌표를 여기 복사해 두고, Patrol.js 를 고치면 여기도 고친다 (파일 상단 주석 계약).
 */
import { readFile } from 'node:fs/promises';

const TILE = 32;
const RADIUS_MAX = 150 + 26 * 3; // Patrol.js RADIUS_BASE + PER_LEVEL * MAX_LEVEL
const MARGIN = 16;
const at = (col, row) => ({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 });
// Patrol.js PATROL_ROUTES 사본
const ROUTES = [
  [at(19, 6), at(19, 42)],
  [at(6, 15), at(54, 15)],
  [at(52, 31), at(24, 31)],
  [at(39, 8), at(39, 40)],
];

const map = JSON.parse(await readFile(new URL('../src/client/assets/map.json', import.meta.url), 'utf8'));
const props = JSON.parse(await readFile(new URL('../src/client/assets/street-props.json', import.meta.url), 'utf8'));
const blocked = new Set((props.blocked ?? []).map(([c, r]) => `${c},${r}`));

// props.walk 는 배경 그림 위에 칠한 걷는 길(scripts/walkmask.js) — 있으면 그게 원본이다.
const walkable = (c, r) =>
  r >= 0 && r < map.rows && c >= 0 && c < map.cols &&
  (props.walk
    ? props.walk[r][c] === '1'
    : map.layout[r][c] >= 0 && !map.tiles[map.layout[r][c]].solid && !blocked.has(`${c},${r}`));

const distToSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
const safe = (c, r) => {
  const p = at(c, r);
  return ROUTES.every(([a, b]) => distToSeg(p, a, b) > RADIUS_MAX + MARGIN);
};

let fail = 0;
for (const s of map.spawns.allies) {
  const ok = walkable(s.col, s.row) && safe(s.col, s.row);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${s.id} (${s.col},${s.row})`);
  if (ok) continue;
  fail += 1;
  // 나선형으로 주변에서 대안 탐색
  outer: for (let radius = 1; radius <= 8; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
        const c = s.col + dc, r = s.row + dr;
        if (walkable(c, r) && safe(c, r)) {
          console.log(`      → 제안: (${c},${r})`);
          break outer;
        }
      }
    }
  }
}
process.exit(fail ? 1 : 0);
