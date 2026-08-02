/**
 * 동료 스폰 안전 검사 — 스폰 지점이 (1) 걸을 수 있는 바닥이고
 * (2) 모든 순찰 경로 선분에서 최대 감지 반경 + 여유 밖인지 확인한다.
 * 불합격이면 해당 지점 주변에서 조건을 만족하는 가장 가까운 칸을 제안한다.
 *
 * 경로·반경은 `src/client/world/streetLayout.js` 에서 가져온다 — Phaser 를 import 하지
 * 않는 파일이라 node 에서 그대로 돌고, Patrol.js 와 같은 좌표를 본다. 예전엔 여기에
 * 좌표를 손으로 복사해 뒀는데, 한쪽만 고치면 이 검사가 **옛 경로를 재면서 통과**했다.
 */
import { readFile } from 'node:fs/promises';
import {
  PATROL_ROUTES,
  RADIUS_MAX,
  routeToPixels,
} from '../src/client/world/streetLayout.js';

const MARGIN = 16;

const map = JSON.parse(await readFile(new URL('../src/client/assets/map.json', import.meta.url), 'utf8'));
const props = JSON.parse(await readFile(new URL('../src/client/assets/street-props.json', import.meta.url), 'utf8'));
const blocked = new Set((props.blocked ?? []).map(([c, r]) => `${c},${r}`));

const TILE = map.tileSize;
const at = (col, row) => ({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 });
const ROUTES = Object.values(PATROL_ROUTES).map((route) => routeToPixels(route, TILE));

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
