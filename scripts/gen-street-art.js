/**
 * 스테이지 1 거리 배경 굽기 — 코드네임: 태엽새
 *
 *   node scripts/gen-street-art.js [--debug]
 *
 * 저택(gen-mansion-art.js)과 같은 방식이다 — 바닥·건물·소품·조명을 한 장에 구워
 * 배경으로 깔고 충돌만 따로 세운다. 다른 점은 여기가 **바깥**이라는 것.
 *
 *   - 저택은 실내 등불이 방마다 웅덩이를 만들지만, 거리는 스모그 덮인 하늘 아래
 *     가로등이 점점이 서 있다. 그래서 기본 밝기가 더 낮고 빛이 더 작고 따뜻하다.
 *   - 건물은 들어가는 곳이 아니라 돌아가는 것이다. 위에서 내려다본 지붕과,
 *     아래를 보는 면(정면 벽)이 함께 보이는 3/4 로 세운다.
 *   - 벽 그늘 대신 **건물 그림자**가 바닥에 떨어진다. 광원이 좌상단이므로 우하단으로.
 *
 * 출력: src/client/assets/street-bg.png · street-props.json
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { keepWalk } from './walkmask.js';

const map = JSON.parse(fs.readFileSync('src/client/assets/map.json', 'utf8'));
const T = map.tileSize;
const W = map.cols * T;
const H = map.rows * T;

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const ramp = (...hs) => hs.map(hex);

// 원본 프로토타입의 램프를 어두움 → 밝음 순으로 뒤집어 옮겼다.
const R = {
  // 밤 장면이라 램프를 어둡게 잡았더니 등불 사이가 새까매졌다. 재료 자체를 한 단
  // 올리고 명암은 조명이 만들게 둔다 — 어두운 재료 + 어두운 조명은 겹쳐서 곱해진다.
  cobble: ramp('#241f19', '#39332b', '#4e463a', '#675d4d', '#847a66'),
  plaza: ramp('#272219', '#3f3830', '#584f42', '#736855', '#928469'),
  dirt: ramp('#2a2016', '#453626', '#5e4a32', '#7a6141', '#9a7d52'),
  brick: ramp('#33170c', '#5c2915', '#833d21', '#a8552f', '#c8734a'),
  plas: ramp('#3d3425', '#6b5c40', '#98855f', '#c2ac81', '#e2cfa6'),
  slate: ramp('#14171c', '#252b33', '#39424d', '#525f6d', '#6f7f90'),
  tower: ramp('#221c14', '#3b3125', '#564939', '#75654f', '#96836a'),
  iron: ramp('#15181a', '#262c30', '#3a4248', '#525c64', '#6e7a84'),
  brass: ramp('#3a2c0c', '#7a5f1a', '#a8861f', '#c9a227', '#e8c15a'),
  wood: ramp('#1e1409', '#3a2917', '#553c23', '#6f5030', '#8a6640'),
  leaf: ramp('#101b14', '#1c2e21', '#2b4531', '#3d5f44', '#527a58'),
  cream: ramp('#413a2c', '#786d54', '#ab9d7c', '#d8c9a5', '#f3ead0'),
  wax: ramp('#2e0f0d', '#5a1d18', '#8a2d24', '#a03325', '#c25b4a'),
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
/**
 * 소품이 놓일 자리가 비어 있는가.
 *
 * 좌표를 손으로 찍다 보면 건물이나 맵 가장자리 위에 놓게 된다. 소품은 건물 **뒤에**
 * 그려지므로 그 위를 덮어 버리고, 그림으로만 보면 건물 벽에 통이 박힌 것처럼 보인다.
 * 걸리면 그리지 않고 목록에 남겨, 스크립트가 끝날 때 좌표를 고치라고 세운다.
 */
const overlaps = [];
function freeRect(tx, ty, tw, th, what) {
  let ok = true;
  for (let j = 0; j < th; j++) {
    for (let i = 0; i < tw; i++) {
      const c = tx + i;
      const r = ty + j;
      const solid =
        c < 0 || r < 0 || c >= map.cols || r >= map.rows || map.tiles[map.layout[r][c]].solid;
      if (solid) {
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
const FLOOR = {
  /**
   * 자갈 거리.
   *
   * 반듯한 돌만 깔면 새로 포장한 길처럼 깨끗해서 이 세계관이 안 나온다.
   * 증기 도시의 바닥은 늘 뭔가 묻어 있다 — 굴뚝에서 내린 검댕, 기계가 흘린 기름,
   * 빠져서 흙이 드러난 자리, 마차가 판 골. 넷을 겹쳐야 "쓰이고 있는 길"이 된다.
   */
  cobble(x, y) {
    const RH = 11;
    const row = (y / RH) | 0;
    const off = (row % 2) * 9 + ((hash(row, 5) * 6) | 0);
    const cw = 13 + ((hash(row, ((x + off) / 13) | 0) * 5) | 0);
    const col = ((x + off) / cw) | 0;
    const lx = (x + off) % cw;
    const ly = y % RH;

    // 빠진 돌 — 흙이 드러난다. 드물어야 사고로 읽힌다.
    if (hash(col * 13 + 7, row * 17 + 3) > 0.965) {
      return step(R.dirt, 0.24 + hash(x >> 1, y >> 1) * 0.16 + grain(x, y, 0.02));
    }
    if (ly === 0 || lx === 0) return step(R.cobble, 0.04); // 줄눈

    let t = 0.24 + hash(col, row) * 0.26;
    if (ly === 1) t += 0.18; // 돌 윗변이 빛을 받는다
    if (ly === RH - 1) t -= 0.1;
    if (lx === 1) t += 0.09;
    // 바퀴가 판 골 — 가로로 길게 두 줄, 거리 한복판이 닳아 있다
    if (Math.abs((y % 220) - 96) < 5 || Math.abs((y % 220) - 124) < 5) t -= 0.1;

    // 검댕 — 굵은 얼룩으로 뭉쳐 내려앉는다. 넓은 주기의 잡음을 문턱으로 잘라 쓴다.
    const soot =
      hash((x / 26) | 0, (y / 26) | 0) * 0.6 + hash((x / 11) | 0, (y / 11) | 0) * 0.4;
    if (soot > 0.62) t -= (soot - 0.62) * 0.9;

    let c = step(R.cobble, t + grain(x, y, 0.012));

    // 기름 — 검댕보다 좁고 짙게 번진다. 빛을 받는 가장자리에만 무지개가 돈다.
    const oil = hash((x / 19) | 0 + 41, (y / 19) | 0 + 17);
    if (oil > 0.9) {
      const k = (oil - 0.9) * 10;
      c = [c[0] * (1 - 0.42 * k), c[1] * (1 - 0.38 * k), c[2] * (1 - 0.22 * k)];
      if (ly <= 2) {
        c[1] = Math.min(255, c[1] + 12 * k);
        c[2] = Math.min(255, c[2] + 22 * k);
      }
    }
    return c;
  },
  /** 광장 포석 — 거리보다 크고 반듯한 판석. 사람이 모이는 곳이라 닳아서 밝다. */
  plaza(x, y) {
    const S = 24;
    const gx = x % S;
    const gy = y % S;
    if (gx === 0 || gy === 0) return step(R.plaza, 0.06);
    let t = 0.34 + hash((x / S) | 0, (y / S) | 0) * 0.14;
    if (gx === 1 || gy === 1) t += 0.12;
    if (gx === S - 1 || gy === S - 1) t -= 0.1;
    if (hash(x >> 3, y >> 3) > 0.88) t -= 0.06; // 얼룩
    return step(R.plaza, t + grain(x, y, 0.01));
  },
  /** 흙 지름길 — 사람들이 밟아 다져 놓은 길. 돌이 없어 부드럽고 어둡다. */
  dirt(x, y) {
    let t = 0.3 + hash(x >> 2, y >> 2) * 0.2;
    if (hash(x >> 1, y >> 1) > 0.93) t -= 0.12; // 잔돌
    return step(R.dirt, t + grain(x, y, 0.02));
  },
};
const FLOOR_BY_INDEX = [FLOOR.cobble, FLOOR.plaza, FLOOR.dirt, null, null, null, null];

const tileAt = (c, r) => (r >= 0 && r < map.rows && c >= 0 && c < map.cols ? map.layout[r][c] : -1);

for (let r = 0; r < map.rows; r++) {
  for (let c = 0; c < map.cols; c++) {
    const t = map.layout[r][c];
    const fn = FLOOR_BY_INDEX[t];
    const bx = c * T;
    const by = r * T;

    // 흙 지름길과 자갈이 만나는 칸 경계는 칼같이 잘려 계단처럼 보인다.
    // 다른 재료와 닿는 쪽에서 두 재료를 확률적으로 섞어(디더) 발길이 만든 길처럼
    // 테두리를 흩뜨린다 — 도트 그림에서 흔히 쓰는 방법이고 격자를 지운다.
    const dither =
      t === 2
        ? { n: tileAt(c, r - 1) !== 2, s: tileAt(c, r + 1) !== 2, w: tileAt(c - 1, r) !== 2, e: tileAt(c + 1, r) !== 2 }
        : null;

    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const wx = bx + x;
        const wy = by + y;
        if (!fn) {
          // 건물·감옥·나무가 설 자리는 일단 거리로 채운다 — 그 위에 얹을 것들이라
          // 밑을 비워 두면 가장자리에 검은 테가 남는다.
          put(wx, wy, FLOOR.cobble(wx, wy));
          continue;
        }
        if (dither) {
          // 경계에서 멀수록 흙이 이길 확률이 높다
          let d = T;
          if (dither.n) d = Math.min(d, y);
          if (dither.s) d = Math.min(d, T - 1 - y);
          if (dither.w) d = Math.min(d, x);
          if (dither.e) d = Math.min(d, T - 1 - x);
          if (d < 14 && hash(wx * 3 + 1, wy * 5 + 2) > 0.15 + (d / 14) * 0.85) {
            put(wx, wy, FLOOR.cobble(wx, wy));
            continue;
          }
        }
        put(wx, wy, fn(wx, wy));
      }
    }
  }
}

// ── 바닥 잔손질 ───────────────────────────────────────────────────
// 재료 함수만으로는 어디를 봐도 같은 밀도라 눈이 쉴 곳도 걸릴 곳도 없다.
// 도트 게임의 "오밀조밀함"은 이런 한 뼘짜리 사건들이 흩어져 있을 때 생긴다.
{
  const solidAt = (c, r) =>
    c < 0 || r < 0 || c >= map.cols || r >= map.rows || map.tiles[map.layout[r][c]].solid;

  // 배수구 — 길가에 규칙적으로. 쇠살대에 낙엽이 걸려 있다.
  for (let r = 4; r < map.rows - 4; r += 7) {
    for (let c = 4; c < map.cols - 4; c += 9) {
      if (solidAt(c, r) || hash(c * 3, r * 5) < 0.62) continue;
      const px = c * T + 8;
      const py = r * T + 10;
      fill(px - 1, py - 1, 16, 12, OL);
      fill(px, py, 14, 10, step(R.iron, 0.14));
      for (let i = 0; i < 3; i++) fill(px + 2 + i * 4, py + 1, 2, 8, step(R.iron, 0.3));
    }
  }

  // 건물에 기대 쌓인 검댕·먼지 — 벽 밑동은 늘 더 더럽다
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (solidAt(c, r)) continue;
      const near = [[0, -1], [-1, 0], [1, 0], [0, 1]].filter(([dc, dr]) => solidAt(c + dc, r + dr));
      if (!near.length) continue;
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          let d = T;
          for (const [dc, dr] of near) {
            if (dr === -1) d = Math.min(d, y);
            if (dr === 1) d = Math.min(d, T - 1 - y);
            if (dc === -1) d = Math.min(d, x);
            if (dc === 1) d = Math.min(d, T - 1 - x);
          }
          if (d > 9) continue;
          const k = (1 - d / 9) ** 1.5 * 0.5;
          const i = ((r * T + y) * W + c * T + x) * 4;
          buf[i] *= 1 - k;
          buf[i + 1] *= 1 - k;
          buf[i + 2] *= 1 - k * 0.94;
        }
      }
    }
  }

  // 웅덩이 · 잡초 · 흩어진 부스러기 — 밟고 지나가는 것들이라 막지 않는다
  for (let n = 0; n < 460; n++) {
    const c = 3 + ((hash(n, 11) * (map.cols - 6)) | 0);
    const r = 3 + ((hash(n, 29) * (map.rows - 6)) | 0);
    if (solidAt(c, r) || blocked.has(`${c},${r}`)) continue;
    const px = c * T + ((hash(n, 3) * 24) | 0);
    const py = r * T + ((hash(n, 7) * 24) | 0);
    const kind = hash(n, 41);

    if (kind < 0.3) {
      // 빗물 웅덩이 — 젖어서 어둡고 가장자리만 하늘을 비춘다
      const rx = 5 + ((hash(n, 13) * 7) | 0);
      for (let y = -4; y <= 4; y++) {
        for (let x = -rx; x <= rx; x++) {
          const d = Math.hypot(x / rx, y / 4);
          if (d > 1) continue;
          const i = ((py + y) * W + px + x) * 4;
          if (i < 0 || i >= buf.length) continue;
          if (d > 0.82) {
            buf[i] = Math.min(255, buf[i] + 16);
            buf[i + 1] = Math.min(255, buf[i + 1] + 20);
            buf[i + 2] = Math.min(255, buf[i + 2] + 26);
          } else {
            buf[i] *= 0.66;
            buf[i + 1] *= 0.7;
            buf[i + 2] = Math.min(255, buf[i + 2] * 0.86 + 10);
          }
        }
      }
    } else if (kind < 0.62) {
      // 돌 틈의 잡초 — 도시가 버려지고 있다는 신호
      for (let i = 0; i < 3 + ((hash(n, 5) * 3) | 0); i++) {
        const bx = px + i * 2 - 2;
        const bh = 3 + ((hash(n + i, 17) * 4) | 0);
        for (let y = 0; y < bh; y++) put(bx + ((y / 3) | 0), py - y, step(R.leaf, 0.3 + y * 0.04));
      }
    } else if (kind < 0.86) {
      // 부스러기 — 석탄 조각, 깨진 타일
      for (let i = 0; i < 4; i++) {
        const bx = px + ((hash(n + i, 23) * 9) | 0) - 4;
        const by = py + ((hash(n + i, 31) * 7) | 0) - 3;
        fill(bx, by, 2, 2, step(hash(i, n) > 0.5 ? R.iron : R.cobble, 0.06));
      }
    } else {
      // 버려진 나사·볼트 — 황동 한 점이 어두운 바닥에서 눈에 걸린다
      disc(px, py, 2, step(R.brass, 0.32));
      put(px - 1, py - 1, step(R.brass, 0.5));
    }
  }
}

// 맵 가장자리는 안개에 잠긴다 — 벽을 세우는 대신 어둠으로 끝을 알린다
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const d = Math.min(x, y, W - 1 - x, H - 1 - y) / (EDGE_PX());
    if (d >= 1) continue;
    const k = (1 - d) ** 1.5;
    const i = (y * W + x) * 4;
    buf[i] *= 1 - k;
    buf[i + 1] *= 1 - k;
    buf[i + 2] *= 1 - k * 0.92;
  }
}
function EDGE_PX() {
  return 2.6 * T;
}

// ── 건물 ──────────────────────────────────────────────────────────
/**
 * 3/4 건물. 위에서 본 지붕 + 아래를 보는 정면 벽.
 *
 * 정면 벽을 사각형 아래쪽에 두는 이유: 플레이어가 아래에서 올려다보는 각이라
 * 건물의 남쪽 면만 보인다. 창과 문도 그 면에만 낸다.
 */
function building(b) {
  const rp = R[b.s] ?? R.brick;
  const px = b.x * T;
  const py = b.y * T;
  const w = b.w * T;
  const h = b.h * T;
  const faceH = Math.min(52, (h * 0.42) | 0); // 정면 벽 높이

  // 바닥 그림자 — 좌상단 광원이라 우하단으로 진다
  for (let y = 0; y < h + 14; y++) {
    for (let x = 0; x < w + 14; x++) {
      const k = Math.min(1, Math.min(x, y, w + 14 - x, h + 14 - y) / 12);
      put(px + x + 10, py + y + 12, [0, 0, 0], 0.3 * k);
    }
  }

  fill(px - 2, py - 2, w + 4, h + 4, OL);

  // 지붕
  for (let y = 0; y < h - faceH; y++) {
    for (let x = 0; x < w; x++) {
      // 기와 골 — 세로줄
      const ridge = x % 9 === 0;
      const t = 0.4 + hash((x / 9) | 0, (y / 7) | 0) * 0.1 - (ridge ? 0.14 : 0) + (y < 3 ? 0.14 : 0);
      put(px + x, py + y, step(rp, t + grain(px + x, py + y, 0.012)));
    }
  }
  // 처마 — 지붕과 벽 사이 그늘
  fill(px, py + h - faceH - 3, w, 3, step(rp, 0.05));

  // 정면 벽
  for (let y = h - faceH; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let t = 0.26 + hash((x / 6) | 0, (y / 6) | 0) * 0.08;
      if (b.s === 'brick') {
        // 벽돌 줄눈
        const row = ((y - (h - faceH)) / 6) | 0;
        const lx = (x + (row % 2) * 7) % 14;
        if ((y - (h - faceH)) % 6 === 0 || lx === 0) t -= 0.16;
      } else if (b.s === 'slate' || b.s === 'tower') {
        if (x % 16 === 0) t -= 0.12; // 석재 이음
      } else if ((y - (h - faceH)) % 11 === 0) t -= 0.07; // 회벽 균열
      if (y === h - faceH) t += 0.2; // 벽 윗변
      if (y > h - 5) t -= 0.14; // 바닥에 닿는 자리
      put(px + x, py + y, step(rp, t + grain(px + x, py + y, 0.012)));
    }
  }

  // 창 — 정면 벽에만. 불 켜진 창을 드물게 섞는다.
  const wy = py + h - faceH + 12;
  for (let i = 1; i * 34 < w - 18; i++) {
    const wx = px + i * 34 - 12;
    const lit = hash(b.x + i, b.y) > 0.62;
    fill(wx - 1, wy - 1, 20, 24, OL);
    fill(wx, wy, 18, 22, lit ? step(R.brass, 0.62) : step(R.iron, 0.14));
    if (lit) {
      fill(wx, wy, 18, 4, step(R.brass, 0.8));
      // 창틀 십자
      fill(wx + 8, wy, 2, 22, step(R.wood, 0.2));
      fill(wx, wy + 10, 18, 2, step(R.wood, 0.2));
    } else {
      fill(wx + 8, wy, 2, 22, step(R.iron, 0.05));
    }
  }
  // 문 — 가운데 하나
  const dx = px + (w >> 1) - 11;
  const dy = py + h - 30;
  fill(dx - 1, dy - 1, 24, 31, OL);
  fill(dx, dy, 22, 30, step(R.wood, 0.3));
  fill(dx, dy, 22, 3, step(R.wood, 0.5));
  disc(dx + 17, dy + 16, 2, step(R.brass, 0.7));

  // ── 여기부터는 세계관 장식 ──────────────────────────────────────
  // 반듯한 상자에 창만 뚫으면 어느 시대 건물인지 알 수 없다. 굴뚝·배관·철대·간판이
  // 붙어야 "증기로 돌아가는 도시의 집"이 된다.

  // 굴뚝 — 지붕 위. 아래로 검댕이 흘러내린다.
  const chx = px + 8 + ((hash(b.x, b.y) * (w - 40)) | 0);
  const chw = 15;
  fill(chx - 1, py - 15, chw + 2, 22, OL);
  fill(chx, py - 14, chw, 20, step(R.brick, 0.34));
  fill(chx, py - 14, chw, 3, step(R.brick, 0.52));
  fill(chx - 2, py - 17, chw + 4, 4, step(R.iron, 0.3)); // 갓
  for (let y = 0; y < h - faceH; y++) {
    // 검댕 자국 — 굴뚝 바로 아래가 제일 짙다
    const k = Math.max(0, 1 - y / 46);
    for (let x = -3; x < chw + 3; x++) {
      if (hash(chx + x, py + y) > 0.42) put(chx + x, py + y, [0, 0, 0], 0.34 * k);
    }
  }

  // 벽을 타고 내려오는 배관 — 한쪽 끝에 붙인다
  const ppx = hash(b.y, b.x) > 0.5 ? px + 5 : px + w - 12;
  fill(ppx, py + h - faceH - 4, 7, faceH + 4, step(R.iron, 0.28));
  fill(ppx, py + h - faceH - 4, 3, faceH + 4, step(R.iron, 0.44));
  for (let y = py + h - faceH; y < py + h - 6; y += 15) {
    fill(ppx - 2, y, 11, 4, step(R.brass, 0.4)); // 이음쇠
    fill(ppx - 2, y, 11, 1, step(R.brass, 0.62));
  }

  // 철제 보강대 — 벽 윗변을 가로지르고 끝에 대못을 박는다
  const by2 = py + h - faceH + 5;
  fill(px + 2, by2, w - 4, 4, step(R.iron, 0.26));
  fill(px + 2, by2, w - 4, 1, step(R.iron, 0.42));
  for (let x = px + 6; x < px + w - 6; x += 22) disc(x, by2 + 2, 2, step(R.iron, 0.6));

  // 간판 — 절반쯤에만. 문 옆에 매달아 놓는다.
  if (hash(b.x + 5, b.y + 9) > 0.45) {
    const sx = dx + 30;
    const sy = py + h - 42;
    fill(sx + 8, sy - 6, 3, 7, step(R.iron, 0.34)); // 걸이
    fill(sx - 1, sy - 1, 22, 15, OL);
    fill(sx, sy, 20, 13, step(R.brass, 0.36));
    fill(sx, sy, 20, 3, step(R.brass, 0.58));
    fill(sx + 4, sy + 5, 12, 2, step(R.iron, 0.12)); // 글자 자리
    fill(sx + 4, sy + 9, 8, 2, step(R.iron, 0.12));
  }
}

// 종탑만 예외 — 첫 건물 위에 탑을 얹고 멎은 시계를 건다 (스토리보드 p13 랜드마크)
function belfry(b) {
  const px = b.x * T;
  const py = b.y * T;
  const w = b.w * T;
  const tw = 46;
  const tx = px + (w >> 1) - (tw >> 1);
  const ty = py - 62;
  for (let y = 0; y < 74; y++) {
    for (let x = 0; x < tw; x++) {
      const t = 0.32 + (x < 4 ? 0.16 : 0) - (x > tw - 5 ? 0.1 : 0) + (y % 13 === 0 ? -0.1 : 0);
      put(tx + x, ty + y, step(R.tower, t + grain(tx + x, ty + y, 0.012)));
    }
  }
  fill(tx - 3, ty - 8, tw + 6, 9, step(R.slate, 0.3)); // 처마
  fill(tx - 3, ty - 8, tw + 6, 2, step(R.slate, 0.5));
  // 멎은 시계 — 바늘이 정오를 지나 굳어 있다
  const cx = tx + (tw >> 1);
  const cy = ty + 26;
  disc(cx, cy, 16, OL);
  disc(cx, cy, 13, step(R.cream, 0.62));
  disc(cx, cy, 11, step(R.cream, 0.78));
  fill(cx - 1, cy - 10, 2, 11, OL);
  fill(cx - 1, cy - 1, 8, 2, OL);
  disc(cx, cy, 2, step(R.brass, 0.5));
}

for (const [i, b] of map.buildings.entries()) {
  building(b);
  if (i === 0) belfry(b);
}

// ── 임시 감옥 ─────────────────────────────────────────────────────
(() => {
  const g = map.cage;
  const px = g.x * T;
  const py = g.y * T;
  const w = g.w * T;
  const h = g.h * T;
  for (let y = 0; y < h + 12; y++) {
    for (let x = 0; x < w + 12; x++) {
      const k = Math.min(1, Math.min(x, y, w + 12 - x, h + 12 - y) / 10);
      put(px + x + 8, py + y + 10, [0, 0, 0], 0.32 * k);
    }
  }
  fill(px - 3, py - 3, w + 6, h + 6, OL);
  // 안쪽 바닥 — 흙바닥에 짚. 갇힌 사람이 보여야 하므로 창살보다 밝게 둔다.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      put(px + x, py + y, step(R.dirt, 0.3 + hash(x >> 2, y >> 2) * 0.14 + grain(px + x, py + y, 0.02)));
    }
  }
  for (let i = 0; i < 26; i++) {
    // 흩어진 짚
    const sx = px + 6 + ((hash(i, 3) * (w - 14)) | 0);
    const sy = py + 10 + ((hash(3, i) * (h - 18)) | 0);
    fill(sx, sy, 7, 2, step(R.cream, 0.34));
  }

  // 창살 — 굵고 밝게. 가늘게 그으면 위에서 볼 때 그냥 무늬가 되어 우리로 안 읽힌다.
  const bar = step(R.iron, 0.46);
  const barHi = step(R.iron, 0.66);
  fill(px, py, w, 10, bar); // 뒤쪽 가로대
  fill(px, py, w, 3, barHi);
  fill(px, py + h - 12, w, 12, bar); // 앞쪽 가로대
  fill(px, py + h - 12, w, 3, barHi);
  fill(px, py, 10, h, bar); // 좌우 기둥
  fill(px + w - 10, py, 10, h, bar);
  fill(px, py, 3, h, barHi);
  for (let x = 14; x < w - 12; x += 16) {
    fill(px + x, py, 6, h, bar);
    fill(px + x, py, 2, h, barHi);
  }
  // 대못 — 창살이 쇠라는 것을 알려 준다
  for (let x = 14; x < w - 12; x += 16) {
    disc(px + x + 3, py + 5, 2, step(R.iron, 0.8));
    disc(px + x + 3, py + h - 6, 2, step(R.iron, 0.8));
  }

  // 자물쇠 — 앞면 한가운데
  const lx = px + (w >> 1) - 11;
  const ly = py + h - 30;
  fill(lx - 2, ly - 2, 26, 24, OL);
  fill(lx, ly, 22, 20, step(R.brass, 0.5));
  fill(lx, ly, 22, 4, step(R.brass, 0.76));
  fill(lx + 9, ly + 7, 4, 9, OL);
  disc(lx + 11, ly + 7, 3, OL);
})();

// ── 나무 · 가로등 · 소품 ──────────────────────────────────────────
// 나무 한 칸(32px)에 다 넣으면 화분처럼 작아진다. 그림은 칸 밖으로 넘겨 크게 그리고
// 막는 것은 밑동 한 칸만 — 위에서 내려다보는 시점이라 가지 밑은 지나갈 수 있다.
function tree(px, py) {
  shadow(px + 6, py + 14, 20, 18);
  fill(px + 13, py + 12, 7, 20, step(R.wood, 0.22)); // 줄기
  fill(px + 13, py + 12, 3, 20, step(R.wood, 0.4));
  for (const [ox, oy, r] of [[16, 2, 19], [4, 9, 13], [28, 9, 13], [16, 16, 14]]) {
    disc(px + ox, py + oy, r + 2, OL);
    disc(px + ox, py + oy, r, step(R.leaf, 0.3));
    disc(px + ox - 4, py + oy - 4, r - 5, step(R.leaf, 0.48));
    disc(px + ox - 6, py + oy - 6, (r - 10) | 0, step(R.leaf, 0.62));
  }
}
function lamp(px, py) {
  shadow(px + 12, py + 20, 8, 8);
  fill(px + 14, py + 10, 4, 20, step(R.iron, 0.3)); // 기둥
  fill(px + 14, py + 10, 2, 20, step(R.iron, 0.46));
  fill(px + 10, py + 27, 12, 3, step(R.iron, 0.2)); // 받침
  fill(px + 11, py + 1, 10, 12, OL); // 등갓
  fill(px + 12, py + 2, 8, 10, step(R.brass, 0.72));
  fill(px + 12, py + 2, 8, 3, step(R.brass, 0.9));
  fill(px + 10, py, 12, 3, step(R.iron, 0.34));
}
function well(px, py, w) {
  shadow(px + 4, py + 6, w - 8, 26);
  disc(px + (w >> 1), py + 20, 26, OL);
  disc(px + (w >> 1), py + 20, 23, step(R.cobble, 0.34));
  disc(px + (w >> 1), py + 20, 16, step(R.cobble, 0.06)); // 물 없는 우물
  fill(px + 6, py - 10, 5, 34, step(R.wood, 0.28));
  fill(px + w - 11, py - 10, 5, 34, step(R.wood, 0.28));
  fill(px + 4, py - 14, w - 8, 6, step(R.wood, 0.42)); // 도르래 대
}
function board(px, py, w) {
  shadow(px + 2, py + 10, w - 4, 22);
  fill(px + 4, py + 24, 5, 14, step(R.wood, 0.24));
  fill(px + w - 9, py + 24, 5, 14, step(R.wood, 0.24));
  fill(px - 1, py - 1, w + 2, 28, OL);
  fill(px, py, w, 26, step(R.wood, 0.3));
  // 겹겹이 붙은 수배 전단
  for (let i = 0; i < 5; i++) {
    const ox = 5 + ((hash(px + i, py) * (w - 26)) | 0);
    const oy = 3 + ((hash(py, px + i) * 8) | 0);
    fill(px + ox, py + oy, 15, 17, step(R.cream, 0.62 + hash(i, 3) * 0.2));
    fill(px + ox + 2, py + oy + 12, 11, 2, step(R.wax, 0.5));
  }
}
function stall(px, py, w) {
  shadow(px + 2, py + 12, w - 4, 20);
  box(px, py + 12, w, 22, R.wood, 7);
  fill(px - 3, py, w + 6, 10, step(R.wax, 0.44)); // 차양
  fill(px - 3, py, w + 6, 3, step(R.wax, 0.62));
  for (let i = 0; i < 4; i++) disc(px + 12 + i * 18, py + 18, 5, step(R.brass, 0.52)); // 황동 그릇
}
function crate(px, py) {
  shadow(px + 2, py + 2, 28, 26);
  fill(px, py, 32, 30, OL);
  fill(px + 2, py + 2, 28, 26, step(R.wood, 0.36));
  fill(px + 2, py + 2, 28, 4, step(R.wood, 0.54));
  fill(px + 2, py + 14, 28, 3, step(R.wood, 0.2));
  fill(px + 14, py + 2, 3, 26, step(R.wood, 0.2));
}
function barrel(px, py) {
  shadow(px + 4, py + 4, 24, 24);
  disc(px + 16, py + 16, 15, OL);
  disc(px + 16, py + 16, 13, step(R.wood, 0.34));
  disc(px + 13, py + 13, 8, step(R.wood, 0.5));
  for (const r of [11, 6]) {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        const d = x * x + y * y;
        if (d <= r * r && d > (r - 2) * (r - 2)) put(px + 16 + x, py + 16 + y, step(R.brass, 0.4));
      }
  }
}

// ── 세계관 소품 ───────────────────────────────────────────────────
/** 증기가 오르는 배출구. 여기 좌표를 씬에 넘겨 파티클을 세운다. */
const vents = [];
function vent(tx, ty) {
  if (!freeRect(tx, ty, 1, 1, '배출구')) return;
  const px = tx * T;
  const py = ty * T;
  fill(px + 2, py + 6, 28, 20, OL);
  fill(px + 4, py + 8, 24, 16, step(R.iron, 0.16));
  for (let i = 0; i < 5; i++) fill(px + 5 + i * 5, py + 9, 3, 14, step(R.iron, 0.34)); // 살
  fill(px + 4, py + 8, 24, 2, step(R.iron, 0.5));
  vents.push([px + 16, py + 12]);
}
/** 땅을 기어가는 배관 다발 — 증기 도시의 혈관. 밟고 넘지 못한다. */
function pipes(px, py, w) {
  shadow(px, py + 8, w, 16);
  fill(px - 1, py + 7, w + 2, 18, OL);
  for (let i = 0; i < 3; i++) {
    const y = py + 8 + i * 6;
    fill(px, y, w, 5, step(R.iron, 0.24 + i * 0.04));
    fill(px, y, w, 1, step(R.iron, 0.46));
  }
  for (let x = 14; x < w - 10; x += 34) {
    fill(px + x, py + 5, 8, 22, step(R.brass, 0.36)); // 이음 밴드
    fill(px + x, py + 5, 8, 2, step(R.brass, 0.6));
  }
  // 밸브 손잡이
  const vx = px + (w >> 1);
  disc(vx, py + 3, 7, OL);
  disc(vx, py + 3, 5, step(R.brass, 0.5));
  disc(vx, py + 3, 2, step(R.iron, 0.2));
}
/** 화물 선로 — 정거장 뒷골목. 침목 위에 강철 레일 두 줄. */
function rails(tx, ty, len) {
  if (!freeRect(tx, ty, len, 1, '선로')) return;
  const px = tx * T;
  const py = ty * T;
  const w = len * T;
  for (let x = 0; x < w; x += 13) {
    fill(px + x, py + 4, 9, 26, step(R.wood, 0.2)); // 침목
    fill(px + x, py + 4, 9, 2, step(R.wood, 0.32));
  }
  for (const oy of [9, 23]) {
    fill(px, py + oy, w, 5, step(R.iron, 0.3));
    fill(px, py + oy, w, 2, step(R.iron, 0.62)); // 닳아 반짝이는 윗면
  }
}
/** 빨랫줄 — 빨래 골목. 젖은 천이 골목을 가로지른다. */
function laundry(tx, ty, len) {
  if (!freeRect(tx, ty, len, 1, '빨랫줄')) return;
  const px = tx * T;
  const py = ty * T + 8;
  fill(px, py, len * T, 2, step(R.iron, 0.24));
  for (let i = 0; i < len * 2; i++) {
    if (hash(tx + i, ty) < 0.35) continue;
    const x = px + 8 + i * 15;
    const h = 20 + ((hash(i, ty) * 16) | 0);
    const rp = [R.cream, R.plas, R.iron][i % 3];
    fill(x - 1, py + 1, 13, h + 2, OL);
    fill(x, py + 2, 11, h, step(rp, 0.42 + hash(i, 5) * 0.2));
    fill(x, py + 2, 11, 3, step(rp, 0.62));
  }
}
function cart(px, py) {
  shadow(px + 2, py + 10, 28, 16);
  box(px + 2, py + 6, 28, 18, R.wood, 6);
  disc(px + 8, py + 26, 6, OL);
  disc(px + 8, py + 26, 4, step(R.iron, 0.3));
  disc(px + 24, py + 26, 6, OL);
  disc(px + 24, py + 26, 4, step(R.iron, 0.3));
  fill(px + 28, py + 2, 12, 3, step(R.wood, 0.34)); // 손잡이
}
function coalPile(px, py) {
  shadow(px + 4, py + 16, 24, 12);
  for (let i = 0; i < 26; i++) {
    const ox = 6 + ((hash(px + i, py) * 20) | 0);
    const oy = 12 + ((hash(py, px + i) * 14) | 0);
    disc(px + ox, py + oy, 2 + ((hash(i, 9) * 3) | 0), step(R.iron, 0.04 + hash(i, 2) * 0.1));
  }
}
function bench(px, py) {
  shadow(px + 2, py + 14, 28, 10);
  fill(px + 2, py + 10, 28, 6, step(R.wood, 0.34));
  fill(px + 2, py + 10, 28, 2, step(R.wood, 0.5));
  fill(px + 4, py + 16, 4, 8, step(R.iron, 0.24));
  fill(px + 24, py + 16, 4, 8, step(R.iron, 0.24));
  fill(px + 2, py + 2, 28, 4, step(R.wood, 0.28)); // 등받이
}
/** 벽에 기대 놓은 큰 톱니 — 이 도시가 무엇으로 돌아가는지 알려 주는 물건 */
function gear(px, py) {
  const cx = px + 16;
  const cy = py + 16;
  shadow(px + 2, py + 18, 28, 10);
  disc(cx, cy, 16, OL);
  disc(cx, cy, 14, step(R.brass, 0.3));
  disc(cx, cy, 8, step(R.brass, 0.46));
  disc(cx, cy, 4, OL);
  for (let a = 0; a < 10; a++) {
    const t = (a / 10) * Math.PI * 2;
    const tx = cx + Math.round(Math.cos(t) * 15);
    const ty = cy + Math.round(Math.sin(t) * 15);
    fill(tx - 3, ty - 3, 6, 6, step(R.brass, 0.38));
  }
}

// 나무는 map.json 의 layout 이 이미 TREE(solid) 로 막고 있다 — prop() 을 거치면
// 자기 칸을 "건물 위"로 오해해 걸린다. 그림만 얹는다.
for (const [x, y] of map.trees) tree(x * T, y * T);

// 정거장 뒷골목 — 화물 선로. 막지 않는다(넘어 다닐 수 있다).
// 행 5 는 역사 건물(44,3,8,5)과 (53,4,4,4)를 관통해서 아래로 내렸다.
rails(41, 9, 17);
rails(41, 12, 17);
// 빨래 골목 — 젖은 천이 시야를 끊는다 (스토리보드의 은폐 후보지)
laundry(3, 30, 7);
laundry(4, 34, 6);
laundry(14, 43, 6);

// 증기 배출구 — 길 곳곳. 밟고 지나갈 수 있다.
for (const [x, y] of [[21, 18], [33, 25], [42, 22], [19, 39], [38, 34], [27, 8], [41, 40]]) {
  vent(x, y);
}
// 배관 다발 — 건물 사이를 잇는다
prop(18, 12, 4, 1, (px, py, w) => pipes(px, py, w));
prop(38, 30, 5, 1, (px, py, w) => pipes(px, py, w));
prop(6, 20, 3, 1, (px, py, w) => pipes(px, py, w));
prop(48, 14, 4, 1, (px, py, w) => pipes(px, py, w));

for (const [x, y] of [[23, 7], [41, 44], [9, 15], [57, 36]]) prop(x, y, 1, 1, cart);
for (const [x, y] of [[19, 34], [44, 16], [3, 28]]) prop(x, y, 1, 1, coalPile);
for (const [x, y] of [[28, 26], [34, 22], [15, 17], [50, 34]]) prop(x, y, 1, 1, bench);
for (const [x, y] of [[8, 42], [56, 12], [24, 43]]) prop(x, y, 1, 1, gear);
for (const [x, y] of [[46, 34], [11, 43], [31, 15], [56, 20], [36, 41], [20, 26]]) prop(x, y, 1, 1, crate);
for (const [x, y] of [[47, 35], [10, 44], [30, 16], [16, 22], [53, 33], [42, 8]]) prop(x, y, 1, 1, barrel);
// 가로등은 막지 않는다 — 기둥이 얇고, 길 한가운데 서 있어 막으면 통행이 답답해진다
for (const [x, y] of map.lamps) lamp(x * T, y * T);

// 섹터마다 하나씩 — 스토리보드가 지목한 랜드마크
prop(30, 24, 2, 1, (px, py, w) => well(px, py, w)); // 게시판 광장 우물
prop(26, 20, 3, 1, (px, py, w) => board(px, py, w)); // 수배 전단 게시판
prop(6, 24, 3, 1, (px, py, w) => stall(px, py, w)); // 시장 골목 좌판
prop(49, 26, 2, 1, (px, py, w) => stall(px, py, w)); // 목공소 앞 좌판
for (const [x, y] of [[51, 44], [55, 43], [50, 30], [17, 30]]) prop(x, y, 1, 1, crate);
for (const [x, y] of [[54, 45], [12, 30], [39, 43], [22, 15]]) prop(x, y, 1, 1, barrel);

// ── 조명 ──────────────────────────────────────────────────────────
// 실내가 아니라 바깥이다. 스모그 덮인 하늘은 어둡고, 빛은 가로등에서만 온다.
// 밤거리다. 바닥 전체를 밝히면 낮처럼 보여 잠입하는 느낌이 사라진다.
//
// 한 번 0.46 까지 올렸던 이유는 등불 사이에서 NPC 를 놓치기 때문이었는데, 그 사이
// 플레이어가 등불을 들게 됐다(StageScene.#buildPlayerLight). 발밑은 그 빛이 맡으므로
// 배경은 다시 가라앉히고, 명암은 등불 웅덩이의 대비로 만든다.
const AMBIENT = 0.34;
const LAMPS = map.lamps.map(([x, y]) => ({ x: x * T + T / 2, y: y * T + 10, r: 240, i: 0.9 }));
// 불 켜진 창에서 새는 빛
for (const b of map.buildings) {
  LAMPS.push({ x: (b.x + b.w / 2) * T, y: (b.y + b.h) * T - 18, r: 130, i: 0.34 });
}
LAMPS.push({ x: 32.5 * T, y: 39.5 * T, r: 210, i: 0.5, cool: true }); // 감옥 초소등
LAMPS.push({ x: 5.5 * T, y: 4 * T, r: 240, i: 0.44, cool: true }); // 종탑 시계 조명

const WARM = [1.14, 1.0, 0.74];
const COOL = [0.9, 0.98, 1.08];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let lit = AMBIENT;
    let warmth = 0;
    for (const L of LAMPS) {
      const d = Math.hypot(x - L.x, y - L.y) / L.r;
      if (d >= 1) continue;
      const f = (1 - d) * (1 - d) * L.i;
      lit += f;
      warmth += L.cool ? -f : f;
    }
    lit += 0.05 * (1 - (x / W) * 0.5 - (y / H) * 0.5);
    lit = Math.round(Math.min(1.3, lit) * 48) / 48;
    const t = warmth > 0 ? WARM : COOL;
    const k = Math.min(1, Math.abs(warmth));
    const i = (y * W + x) * 4;
    for (let ch = 0; ch < 3; ch++) buf[i + ch] = Math.min(255, buf[i + ch] * lit * (1 + (t[ch] - 1) * k * 0.5));
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

fs.writeFileSync('src/client/assets/street-bg.png', encodePng(W, H, buf));
const list = [...blocked].map((k) => k.split(',').map(Number));
fs.writeFileSync(
  'src/client/assets/street-props.json',
  JSON.stringify({
    _comment: '소품이 막는 칸과 증기 배출구. scripts/gen-street-art.js 가 낸다.',
    blocked: list,
    // 씬이 여기에 김 파티클을 세운다 — 배경에 굽지 않는 이유는 김이 움직여야 김이기 때문.
    vents,
    ...keepWalk('street'),
  }) + '\n',
);

// ── 도달성 재검사 (소품 포함) ─────────────────────────────────────
const key = (c, r) => `${c},${r}`;
const okAt = (c, r) =>
  c >= 0 && r >= 0 && c < map.cols && r < map.rows && !map.tiles[map.layout[r][c]].solid && !blocked.has(key(c, r));
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
const bad = [];
if (overlaps.length) {
  bad.push(`건물·경계 위에 놓인 장식 ${overlaps.length}개 — ${[...new Set(overlaps)].join(', ')}`);
}
for (const a of map.spawns.allies) if (!near(a.col, a.row)) bad.push(`동료 ${a.id} 에 못 간다`);
if (!near(map.spawns.broker.col, map.spawns.broker.row)) bad.push('접선책에 못 간다');
for (const [i, z] of map.spawns.citizens.entries()) if (!near(z.col, z.row)) bad.push(`시민 ${i + 1} 에 못 간다`);
if (!Array.from({ length: map.cage.w }, (_, i) => map.cage.x + i).some((c) => seen.has(key(c, map.cage.y + map.cage.h))))
  bad.push('감옥 앞에 설 수 없다');
if (bad.length) {
  console.error('\n도달성 오류 (소품 포함)\n  ' + bad.join('\n  ') + '\n');
  process.exit(1);
}

if (process.argv.includes('--debug')) {
  const dbg = Uint8ClampedArray.from(buf);
  for (const k of blocked) {
    const [c, r] = k.split(',').map(Number);
    if (map.tiles[map.layout[r][c]].solid) continue;
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
  fs.writeFileSync('src/client/assets/street-blocked-debug.png', encodePng(W, H, dbg));
  console.log('→ src/client/assets/street-blocked-debug.png');
}

console.log(`배경 ${W}×${H} · 건물 ${map.buildings.length} · 소품이 막는 칸 ${list.length} · 등불 ${LAMPS.length}`);
console.log('도달성 검사 통과 (소품 포함)');
console.log('→ src/client/assets/street-bg.png · street-props.json');
