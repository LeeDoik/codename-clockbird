/**
 * 튜토리얼 본부 배경 굽기 — 코드네임: 태엽새
 *
 *   node scripts/gen-hq-art.js [--debug]
 *
 * 거리·저택과 같은 방식(바닥·벽·가구·조명을 한 장에 굽고 충돌만 따로)이되, 본부는
 * **레지스탕스의 지하실**이다. 저택이 남의 집이고 거리가 감시받는 바깥이라면,
 * 여기는 유일하게 안전한 곳이라 빛이 따뜻하고 물건이 어질러져 있어도 된다.
 *
 * 출력: src/client/assets/hq-bg.png · hq-props.json
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const map = JSON.parse(fs.readFileSync('src/client/assets/hq.json', 'utf8'));
const T = map.tileSize;
const W = map.cols * T;
const H = map.rows * T;
const zone = (id) => map.zones.find((z) => z.id === id);

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const ramp = (...hs) => hs.map(hex);

// 원본 프로토타입의 램프를 어두움 → 밝음 순으로 뒤집어 옮겼다.
const R = {
  oak: ramp('#241a0f', '#3f2e1a', '#553f24', '#6d5230', '#8a6a3f'),
  wal: ramp('#1d1209', '#342212', '#48301b', '#5f3f24', '#7a5330'),
  wall: ramp('#160f0a', '#2a1e14', '#3d2c1e', '#523c2a', '#6b503a'),
  rug: ramp('#33100a', '#571a11', '#7a2619', '#9a3524', '#c04a33'),
  brass: ramp('#4d3c0d', '#8a6d18', '#c9a227', '#e8c15a', '#f5dc8f'),
  steel: ramp('#1f1e1a', '#37352f', '#4e4c45', '#6b6961', '#8d8b83'),
  stone: ramp('#1c1a17', '#33302a', '#48433c', '#5f5951', '#7d766a'),
  tileF: ramp('#2e281f', '#544b3b', '#7e735c', '#a89b7e', '#cfc3a4'),
  green: ramp('#16221e', '#2a423b', '#3f6459', '#5e8b7e', '#8fc4ac'),
  leaf: ramp('#182611', '#2a3f1e', '#3d5b2c', '#547a3e', '#79a05a'),
  red: ramp('#280b08', '#4d1610', '#78231a', '#a03325', '#d4614a'),
  cream: ramp('#413a2c', '#786d54', '#ab9d7c', '#d8c9a5', '#f3ead0'),
  brick: ramp('#33170c', '#5c2915', '#833d21', '#a8552f', '#c8734a'),
};
const OL = hex('#0e0a06');

const buf = new Uint8ClampedArray(W * H * 4);
const blocked = new Set();

function put(x, y, c, a = 1) {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  if (a >= 1) {
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
  } else {
    buf[i] += (c[0] - buf[i]) * a;
    buf[i + 1] += (c[1] - buf[i + 1]) * a;
    buf[i + 2] += (c[2] - buf[i + 2]) * a;
  }
  buf[i + 3] = 255;
}
const fill = (x, y, w, h, c, a = 1) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c, a);
};
const disc = (cx, cy, r, c, a = 1) => {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) put(cx + x, cy + y, c, a);
};
function hash(a, b) {
  let n = (a * 374761393 + b * 668265263) | 0;
  n = ((n ^ (n >> 13)) * 1274126177) | 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}
function grain(x, y, amp) {
  const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (Math.round((h - Math.floor(h)) * 2) - 1) * amp;
}
function step(rp, t) {
  const v = Math.max(0, Math.min(0.999, t)) * (rp.length - 1);
  const i = v | 0;
  const f = v - i;
  return rp[i].map((c, k) => c + ((rp[i + 1] ?? rp[i])[k] - c) * f);
}
const shadow = (x, y, w, h) => fill(x + 2, y + h, w - 2, 3, [0, 0, 0], 0.34);
function box(x, y, w, h, rp, topH = 7) {
  shadow(x, y, w, h);
  fill(x - 1, y - 1, w + 2, h + 2, OL);
  fill(x, y, w, topH, rp[3]);
  fill(x, y, w, 1, rp[4]);
  fill(x, y + topH, w, h - topH, rp[2]);
  fill(x, y + topH, w, 1, rp[1]);
  fill(x, y + h - 2, w, 2, rp[1]);
  fill(x, y + topH, 2, h - topH, rp[3]);
}
const overlaps = [];
function freeRect(tx, ty, tw, th, what) {
  let ok = true;
  for (let j = 0; j < th; j++) {
    for (let i = 0; i < tw; i++) {
      const c = tx + i;
      const r = ty + j;
      if (c < 0 || r < 0 || c >= map.cols || r >= map.rows || map.tiles[map.layout[r][c]].solid) {
        overlaps.push(`${what} (${c},${r})`);
        ok = false;
      }
    }
  }
  return ok;
}
function prop(tx, ty, tw, th, draw) {
  if (!freeRect(tx, ty, tw, th, '소품')) return;
  for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) blocked.add(`${tx + i},${ty + j}`);
  draw(tx * T, ty * T, tw * T, th * T);
}

// ── 바닥 ──────────────────────────────────────────────────────────
const FLOOR = [
  /** 널판 — 지휘·게시판. 가로로 긴 널에 못과 결. */
  (x, y) => {
    const PH = 12;
    const p = (y / PH) | 0;
    const seg = ((x + p * 41) / 104) | 0;
    const ly = y % PH;
    if (ly === 0) return step(R.oak, 0.05);
    let t = 0.3 + hash(seg, p) * 0.2;
    if (ly === 1) t += 0.14;
    if (ly === PH - 1) t -= 0.1;
    t += Math.sin(x * 0.2 + p * 2.7) * 0.03;
    const nx = (x + p * 41) % 104;
    if (nx === 0) t -= 0.18;
    if ((nx === 5 || nx === 98) && ly === 6) t -= 0.28; // 못
    return step(R.oak, t + grain(x, y, 0.01));
  },
  /** 석재 — 무기고·계단. 지하실 바닥이라 거칠고 차다. */
  (x, y) => {
    const RH = 18;
    const row = (y / RH) | 0;
    const off = (row % 2) * 15;
    const lx = (x + off) % 30;
    const ly = y % RH;
    if (ly === 0 || lx === 0) return step(R.stone, 0.05);
    let t = 0.26 + hash(((x + off) / 30) | 0, row) * 0.22;
    if (ly === 1) t += 0.18;
    if (ly === RH - 1) t -= 0.1;
    if (hash(x >> 2, y >> 2) > 0.86) t -= 0.07;
    return step(R.stone, t + grain(x, y, 0.012));
  },
  /** 취사 타일 — 유약을 먹여 반질거린다. 본부에서 가장 밝은 바닥. */
  (x, y) => {
    const S = 16;
    const gx = x % S;
    const gy = y % S;
    if (gx === 0 || gy === 0) return step(R.stone, 0.08);
    let t = 0.4 + hash((x / S) | 0, (y / S) | 0) * 0.1;
    if (gx === 1 || gy === 1) t += 0.14;
    if (gx === S - 1 || gy === S - 1) t -= 0.12;
    if (gx >= 3 && gx <= 5 && gy >= 3 && gy <= 4) t += 0.14; // 반사
    return step(R.tileF, t + grain(x, y, 0.008));
  },
];

for (let r = 0; r < map.rows; r++) {
  for (let c = 0; c < map.cols; c++) {
    const t = map.layout[r][c];
    const fn = FLOOR[t];
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const wx = c * T + x;
        const wy = r * T + y;
        // 벽 자리도 일단 바닥을 깔아 둔다 — 밑이 비면 벽 가장자리에 검은 테가 남는다.
        put(wx, wy, (fn ?? FLOOR[1])(wx, wy));
      }
    }
  }
}

// ── 벽·칸막이 ─────────────────────────────────────────────────────
const solid = (c, r) =>
  c < 0 || r < 0 || c >= map.cols || r >= map.rows || map.tiles[map.layout[r][c]].solid;

for (let r = 0; r < map.rows; r++) {
  for (let c = 0; c < map.cols; c++) {
    if (!solid(c, r)) continue;
    const px = c * T;
    const py = r * T;
    const face = !solid(c, r + 1); // 아래가 바닥이면 이 칸이 벽면이다
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const wx = px + x;
        const g = grain(wx, py + y, 0.012);
        let col;
        if (face) {
          // 지하실 벽 — 회벽이 떨어져 벽돌이 드러난 자리가 섞인다
          if (y < 3) col = step(R.wall, 0.06 + g);
          else if (y < 6) col = step(R.wal, 0.34 + g); // 몰딩
          else if (y > T - 5) col = step(R.wall, 0.04 + g); // 굽도리
          else {
            const bare = hash((wx / 14) | 0, ((py + y) / 9) | 0) > 0.72;
            if (bare) {
              const row = ((py + y) / 9) | 0;
              const lx = (wx + (row % 2) * 8) % 16;
              col = step(R.brick, (lx < 2 || (py + y) % 9 === 0 ? 0.12 : 0.34) + g);
            } else col = step(R.wall, 0.3 + g + (y < 10 ? 0.06 : 0));
          }
        } else {
          const gx = wx % 20;
          const gy = (py + y) % 20;
          col = step(R.wall, (gx < 2 || gy < 2 ? 0.04 : 0.14) + g);
        }
        put(wx, py + y, col);
      }
    }
    if (face) fill(px, py + T - 1, T, 1, OL);
  }
}

// ── 벽 그늘 ───────────────────────────────────────────────────────
{
  const AO = 8;
  const S = { n: 0.5, w: 0.44, s: 0.2, e: 0.22 };
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (solid(c, r)) continue;
      const n = solid(c, r - 1);
      const s = solid(c, r + 1);
      const w = solid(c - 1, r);
      const e = solid(c + 1, r);
      if (!(n || s || w || e)) continue;
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          let k = 0;
          if (n) k = Math.max(k, (1 - y / AO) * S.n);
          if (w) k = Math.max(k, (1 - x / AO) * S.w);
          if (s) k = Math.max(k, (1 - (T - 1 - y) / AO) * S.s);
          if (e) k = Math.max(k, (1 - (T - 1 - x) / AO) * S.e);
          if (k <= 0) continue;
          const i = ((r * T + y) * W + c * T + x) * 4;
          buf[i] *= 1 - k;
          buf[i + 1] *= 1 - k;
          buf[i + 2] *= 1 - k * 0.94;
        }
      }
    }
  }
}

const floorOnly = Uint8ClampedArray.from(buf);

// ── 가구 ──────────────────────────────────────────────────────────
function table(px, py, w, h) {
  box(px, py, w, h, R.oak, 10);
  fill(px + 4, py + 3, w - 8, 4, R.oak[4]);
}
function crate(px, py) {
  shadow(px + 2, py + 2, 28, 26);
  fill(px, py, 32, 30, OL);
  fill(px + 2, py + 2, 28, 26, step(R.oak, 0.36));
  fill(px + 2, py + 2, 28, 4, step(R.oak, 0.56));
  fill(px + 2, py + 14, 28, 3, step(R.oak, 0.18));
  fill(px + 14, py + 2, 3, 26, step(R.oak, 0.18));
}
function barrel(px, py) {
  shadow(px + 4, py + 4, 24, 24);
  disc(px + 16, py + 16, 15, OL);
  disc(px + 16, py + 16, 13, step(R.wal, 0.34));
  disc(px + 13, py + 13, 8, step(R.wal, 0.5));
  for (const rr of [11, 6]) {
    for (let y = -rr; y <= rr; y++)
      for (let x = -rr; x <= rr; x++) {
        const d = x * x + y * y;
        if (d <= rr * rr && d > (rr - 2) * (rr - 2)) put(px + 16 + x, py + 16 + y, step(R.brass, 0.4));
      }
  }
}
function chair(px, py, dir) {
  shadow(px + 4, py + 6, 22, 20);
  fill(px + 2, py + 4, 26, 24, OL);
  fill(px + 4, py + 6, 22, 20, step(R.wal, 0.34));
  fill(px + 8, py + 10, 14, 12, step(R.rug, 0.4));
  fill(px + 8, py + 10, 14, 3, step(R.rug, 0.56));
  fill(dir < 0 ? px + 4 : px + 21, py + 6, 5, 20, step(R.wal, 0.2));
}
/** 자석 수류탄 상자 — 무기고. 거리에서 목숨을 대신하는 물건이 여기 있다. */
function grenadeCrate(px, py, w) {
  box(px, py, w, 30, R.steel, 8);
  for (let i = 0; i * 22 < w - 14; i++) {
    const cx = px + 14 + i * 22;
    disc(cx, py + 18, 7, OL);
    disc(cx, py + 18, 5, step(R.brass, 0.5));
    disc(cx - 1, py + 17, 2, step(R.brass, 0.8));
  }
  fill(px + 4, py + 2, w - 8, 3, step(R.red, 0.5)); // 위험 표시
}
/** 공구벽 — 무기고 벽에 늘어놓은 연장 */
function toolWall(px, py, w) {
  fill(px, py + 6, w, 4, step(R.wal, 0.24));
  for (let i = 0; i * 18 < w - 10; i++) {
    const x = px + 8 + i * 18;
    const kind = (i + (px >> 5)) % 3;
    if (kind === 0) {
      fill(x, py + 10, 4, 20, step(R.steel, 0.4)); // 망치
      fill(x - 4, py + 26, 12, 5, step(R.steel, 0.26));
    } else if (kind === 1) {
      fill(x, py + 10, 3, 22, step(R.steel, 0.34)); // 렌치
      disc(x + 1, py + 32, 4, step(R.steel, 0.44));
      disc(x + 1, py + 32, 2, OL);
    } else {
      fill(x - 1, py + 10, 6, 12, step(R.brass, 0.42)); // 부품
      fill(x - 1, py + 10, 6, 3, step(R.brass, 0.64));
    }
  }
}
/** 작전 지도 — 지휘 테이블 위. 붉은 실이 도시를 잇는다. */
function warMap(px, py, w, h) {
  fill(px - 1, py - 1, w + 2, h + 2, OL);
  fill(px, py, w, h, step(R.cream, 0.44));
  for (let i = 0; i < 5; i++) {
    const x0 = px + 8 + ((hash(i, 3) * (w - 20)) | 0);
    const y0 = py + 6 + ((hash(3, i) * (h - 14)) | 0);
    const x1 = px + 8 + ((hash(i + 9, 5) * (w - 20)) | 0);
    const y1 = py + 6 + ((hash(5, i + 9) * (h - 14)) | 0);
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let k = 0; k <= n; k++) {
      put(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), step(R.red, 0.6));
    }
    disc(x0, y0, 2, step(R.red, 0.8));
    disc(x1, y1, 2, step(R.red, 0.8));
  }
}
/** 게시판 — 붉은 실로 이어 붙인 전단 */
function board(px, py, w, h) {
  shadow(px + 2, py + 4, w - 4, h - 6);
  fill(px - 2, py - 2, w + 4, h + 4, OL);
  fill(px, py, w, h, step(R.wal, 0.28));
  for (let i = 0; i < 7; i++) {
    const ox = 6 + ((hash(px + i, py) * (w - 28)) | 0);
    const oy = 5 + ((hash(py, px + i) * (h - 26)) | 0);
    fill(ox + px, oy + py, 18, 20, step(R.cream, 0.5 + hash(i, 7) * 0.25));
    fill(ox + px + 3, oy + py + 14, 12, 2, step(R.red, 0.5));
    disc(ox + px + 9, oy + py + 2, 2, step(R.red, 0.7)); // 압정
  }
}
/** 화덕 — 취사 구석. 본부에서 가장 따뜻한 자리. */
function stove(px, py, w) {
  shadow(px, py, w, 40);
  fill(px - 2, py - 2, w + 4, 44, OL);
  fill(px, py, w, 40, step(R.steel, 0.34));
  fill(px, py, w, 10, step(R.steel, 0.5));
  fill(px + 8, py + 16, w - 16, 18, OL);
  fill(px + 10, py + 18, w - 20, 14, step(R.red, 0.66)); // 불
  fill(px + 12, py + 20, w - 24, 4, step(R.brass, 0.8));
  fill(px + 4, py + 5, 8, 4, step(R.brass, 0.44));
}
function planter(px, py) {
  box(px + 6, py + 14, 20, 16, R.wal, 6);
  for (const [ox, oy, hgt] of [[10, 2, 14], [16, 0, 18], [21, 4, 11]]) {
    fill(px + ox, py + oy, 4, hgt, step(R.leaf, 0.4));
    fill(px + ox, py + oy, 2, hgt, step(R.leaf, 0.58));
  }
}
/** 계단 — 거리로 나가는 출구. 위로 올라가는 단을 그린다. */
function stairs(px, py, w, h) {
  fill(px - 2, py - 2, w + 4, h + 4, OL);
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const sy = py + (h * i) / steps;
    const sh = h / steps;
    fill(px, sy, w, sh, step(R.stone, 0.24 + i * 0.05));
    fill(px, sy, w, 2, step(R.stone, 0.48 + i * 0.05));
  }
  fill(px, py, 4, h, step(R.stone, 0.5));
  fill(px + w - 4, py, 4, h, step(R.stone, 0.14));
}

// 무기고 — 자석 수류탄 상자와 공구벽 (원본의 구역 설명 그대로)
prop(3, 3, 3, 1, (px, py, w) => grenadeCrate(px, py, w));
prop(7, 3, 3, 1, (px, py, w) => toolWall(px, py, w));
prop(3, 10, 1, 1, crate);
prop(9, 10, 1, 1, barrel);
prop(9, 6, 1, 1, crate);

// 지휘 테이블 — 간부가 붙박여 있는 자리
prop(15, 5, 6, 2, (px, py, w, h) => {
  table(px, py, w, h - 12);
  warMap(px + 18, py + 8, w - 36, h - 34);
});
prop(14, 8, 1, 1, (px, py) => chair(px, py, -1));
prop(21, 8, 1, 1, (px, py) => chair(px, py, 1));
prop(22, 3, 1, 1, planter);

// 작전 게시판
prop(26, 3, 5, 1, (px, py, w) => board(px, py, w, 40));
prop(26, 9, 1, 1, crate);
prop(30, 9, 1, 1, barrel);

// 취사 구석 — 화덕과 긴 식탁
prop(3, 14, 3, 1, (px, py, w) => stove(px, py, w));
prop(8, 15, 5, 1, (px, py, w) => table(px, py, w, 34));
prop(8, 14, 1, 1, (px, py) => chair(px, py, -1));
prop(11, 17, 1, 1, (px, py) => chair(px, py, 1));

// 계단 · 출구
prop(28, 14, 3, 3, (px, py, w, h) => stairs(px, py, w, h));
prop(17, 16, 1, 1, crate);
prop(20, 14, 1, 1, barrel);
prop(24, 17, 1, 1, planter);

// 등불 — 벽에 건 램프. 막지 않는다.
for (const [x, y] of map.lamps) {
  const px = x * T;
  const py = y * T;
  fill(px + 11, py + 2, 10, 13, OL);
  fill(px + 12, py + 3, 8, 11, step(R.brass, 0.74));
  fill(px + 12, py + 3, 8, 3, step(R.brass, 0.92));
  fill(px + 10, py + 15, 12, 3, step(R.steel, 0.3));
}

// ── 보이지 않는 벽 검사 (조명 이전에) ─────────────────────────────
const invisibleWalls = [];
for (const k of blocked) {
  const [c, r] = k.split(',').map(Number);
  if (map.tiles[map.layout[r][c]].solid) continue;
  let changed = 0;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const i = ((r * T + y) * W + c * T + x) * 4;
      if (Math.abs(buf[i] - floorOnly[i]) + Math.abs(buf[i + 1] - floorOnly[i + 1]) > 12) changed++;
    }
  }
  const pct = (changed / (T * T)) * 100;
  if (pct < 18) invisibleWalls.push(`(${c},${r}) 을 막았는데 그린 것이 ${pct.toFixed(0)}% 뿐`);
}

// ── 조명 ──────────────────────────────────────────────────────────
// 지하 은신처다. 창이 없어 빛은 전부 등불에서 오지만, 여기는 유일하게 안전한 곳이라
// 거리보다 따뜻하고 밝다 — 밖으로 나가는 순간의 온도 차가 그 자체로 연출이 된다.
const AMBIENT = 0.5;
const LAMPS = map.lamps.map(([x, y]) => ({ x: x * T + T / 2, y: y * T + 10, r: 210, i: 0.86 }));
LAMPS.push({ x: 4.5 * T, y: 14.5 * T, r: 190, i: 0.8 }); // 화덕
LAMPS.push({ x: 18 * T, y: 6 * T, r: 200, i: 0.5 }); // 지휘 테이블 위

const WARM = [1.13, 1.0, 0.76];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let lit = AMBIENT;
    let warmth = 0;
    for (const L of LAMPS) {
      const d = Math.hypot(x - L.x, y - L.y) / L.r;
      if (d >= 1) continue;
      const f = (1 - d) * (1 - d) * L.i;
      lit += f;
      warmth += f;
    }
    lit += 0.05 * (1 - (x / W) * 0.5 - (y / H) * 0.5);
    lit = Math.round(Math.min(1.3, lit) * 48) / 48;
    const k = Math.min(1, warmth);
    const i = (y * W + x) * 4;
    for (let ch = 0; ch < 3; ch++) buf[i + ch] = Math.min(255, buf[i + ch] * lit * (1 + (WARM[ch] - 1) * k * 0.55));
  }
}

// ── PNG ───────────────────────────────────────────────────────────
function filterRows(src, w, h) {
  const stride = w * 4;
  const out = Buffer.alloc(h * (stride + 1));
  const cand = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    const prev = (y - 1) * stride;
    const sums = [0, 0, 0, 0, 0];
    for (let i = 0; i < stride; i++) {
      const v0 = src[row + i];
      const a = i >= 4 ? src[row + i - 4] : 0;
      const b = y > 0 ? src[prev + i] : 0;
      const c = y > 0 && i >= 4 ? src[prev + i - 4] : 0;
      const v = [v0, (v0 - a) & 255, (v0 - b) & 255, (v0 - ((a + b) >> 1)) & 255, (v0 - paeth(a, b, c)) & 255];
      for (let f = 0; f < 5; f++) {
        cand[f][i] = v[f];
        sums[f] += v[f] < 128 ? v[f] : 256 - v[f];
      }
    }
    let best = 0;
    for (let f = 1; f < 5; f++) if (sums[f] < sums[best]) best = f;
    out[y * (stride + 1)] = best;
    cand[best].copy(out, y * (stride + 1) + 1);
  }
  return out;
}
function encodePng(w, h, src) {
  const raw = filterRows(Buffer.from(src.buffer, src.byteOffset, h * w * 4), w, h);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.writeFileSync('src/client/assets/hq-bg.png', encodePng(W, H, buf));
const list = [...blocked].map((k) => k.split(',').map(Number));
fs.writeFileSync(
  'src/client/assets/hq-props.json',
  JSON.stringify({ _comment: '가구가 막는 칸. scripts/gen-hq-art.js 가 낸다.', blocked: list }) + '\n',
);

// ── 도달성 재검사 ─────────────────────────────────────────────────
const key = (c, r) => `${c},${r}`;
const okAt = (c, r) => !solid(c, r) && !blocked.has(key(c, r));
const seen = new Set([key(map.spawns.player.col, map.spawns.player.row)]);
const queue = [[map.spawns.player.col, map.spawns.player.row]];
while (queue.length) {
  const [c, r] = queue.pop();
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const k = key(c + dc, r + dr);
    if (seen.has(k) || !okAt(c + dc, r + dr)) continue;
    seen.add(k);
    queue.push([c + dc, r + dr]);
  }
}
const near = (c, r) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => seen.has(key(c + a, r + b)));
const bad = [...invisibleWalls];
if (overlaps.length) bad.push(`벽 위에 놓인 가구 — ${[...new Set(overlaps)].join(', ')}`);
if (!near(map.spawns.officer.col, map.spawns.officer.row)) bad.push('간부에게 갈 수 없다');
for (const a of map.spawns.allies) if (!near(a.col, a.row)) bad.push(`동료 ${a.id} 에게 갈 수 없다`);
for (const z of map.zones) {
  let n = 0;
  for (let r = z.y; r < z.y + z.h; r++) for (let c = z.x; c < z.x + z.w; c++) if (seen.has(key(c, r))) n++;
  if (n < 10) bad.push(`${z.name}: 닿는 칸이 ${n}개뿐이다`);
}
if (bad.length) {
  console.error('\n오류\n  ' + bad.join('\n  ') + '\n');
  process.exit(1);
}

if (process.argv.includes('--debug')) {
  const dbg = Uint8ClampedArray.from(buf);
  for (const k of blocked) {
    const [c, r] = k.split(',').map(Number);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const i = ((r * T + y) * W + c * T + x) * 4;
        const edge = x < 2 || y < 2 || x >= T - 2 || y >= T - 2;
        dbg[i] = dbg[i] * (edge ? 0.2 : 0.62) + (edge ? 230 : 150) * (edge ? 0.8 : 0.38);
        dbg[i + 1] *= edge ? 0.2 : 0.62;
        dbg[i + 2] *= edge ? 0.2 : 0.62;
      }
    }
  }
  fs.writeFileSync('src/client/assets/hq-blocked-debug.png', encodePng(W, H, dbg));
  console.log('→ src/client/assets/hq-blocked-debug.png');
}

console.log(`배경 ${W}×${H} · 가구가 막는 칸 ${list.length} · 등불 ${LAMPS.length}`);
console.log('도달성·겹침 검사 통과');
console.log('→ src/client/assets/hq-bg.png · hq-props.json');
