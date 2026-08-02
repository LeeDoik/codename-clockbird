/**
 * 스테이지 2 저택 배경 굽기 — 코드네임: 태엽새
 *
 *   node scripts/gen-mansion-art.js
 *
 * 타일을 격자로 깔면 방마다 같은 무늬가 반복될 뿐이라 저택으로 안 보인다. 그래서
 * 바닥·벽·가구·조명을 한 장에 구워 배경 이미지로 쓴다 (원본 프로토타입의 bake() 와 같은 방식).
 * 충돌은 계속 mansion.json 의 layout 이 맡고, 가구가 막는 칸만 mansion-props.json 으로 따로 낸다.
 *
 * 픽셀 규약 (design/style-formula.txt):
 *   - 재료마다 5단 색 램프
 *   - 모든 오브젝트에 어두운 외곽선 + 윗면 하이라이트 + 바닥 그림자
 *   - 광원은 좌상단 고정
 *   - 가구는 윗면과 앞면이 함께 보이는 3/4 배치
 *
 * 월드 1픽셀 = 화면 2픽셀(카메라 줌 2)이므로, 1px 단위 디테일이 그대로 도트로 읽힌다.
 *
 * 출력: src/client/assets/mansion-bg.png · mansion-door-open.png · mansion-props.json
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { keepWalk } from './walkmask.js';

const map = JSON.parse(fs.readFileSync('src/client/assets/mansion.json', 'utf8'));
const T = map.tileSize;
const W = map.cols * T;
const H = map.rows * T;
const room = (id) => map.rooms.find((r) => r.id === id);

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const ramp = (...hs) => hs.map(hex);

// ── 5단 램프 (어두움 → 밝음) ──────────────────────────────────────
const R = {
  oak: ramp('#2a1c10', '#4a3520', '#6b4d2e', '#8a663c', '#a8814f'),
  wal: ramp('#1e1409', '#3a2917', '#553c23', '#6f5030', '#8a6640'),
  stone: ramp('#1a1815', '#2f2c27', '#46423a', '#615c51', '#7d7666'),
  brass: ramp('#3a2c0c', '#7a5f1a', '#a8861f', '#c9a227', '#e8c15a'),
  // 강철 — 연구실. 저택의 나무·황동과 대비되는 차가운 면이지만, 채도를 올리면
  // 스팀펑크가 아니라 SF 로 읽힌다. 푸른 기운은 남기되 회색 쪽으로 눌러 둔다.
  steel: ramp('#14161a', '#282c30', '#3f4448', '#585d62', '#767b80'),
  red: ramp('#2e0f0d', '#4a1e1a', '#6b2c26', '#8c3d34', '#ad5348'),
  cream: ramp('#463f32', '#6a604c', '#8e836a', '#b2a68a', '#d6c9ac'),
  green: ramp('#12201a', '#20362a', '#324e3c', '#456a52', '#5e8b7e'),
  copper: ramp('#331a0e', '#5e321a', '#844826', '#a85e33', '#c77a48'),
  rug: ramp('#2a0f10', '#4a1c1c', '#6b2a28', '#8a3a34', '#a85048'),
};
const OL = hex('#120c07');

// ── 버퍼 ──────────────────────────────────────────────────────────
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
/** 채운 사각형 — (x, y) 에서 w×h */
function fill(x, y, w, h, c, a = 1) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c, a);
}
function disc(cx, cy, r, c, a = 1) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) put(cx + x, cy + y, c, a);
}
function ring(cx, cy, r, c) {
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const d = x * x + y * y;
      if (d <= r * r && d > (r - 2) * (r - 2)) put(cx + x, cy + y, c);
    }
}
/**
 * 결정적 잡티 — 다시 구워도 그림이 흔들리지 않는다.
 *
 * 값을 3단(-amp / 0 / +amp)으로 끊는다. 연속값을 쓰면 픽셀마다 다른 색이 되어
 * PNG 가 거의 안 줄어드는데, 도트 그림에서 얻는 것은 "결이 있다"는 인상뿐이라
 * 3단으로도 충분하다. 파일이 절반 아래로 떨어진다.
 */
function grain(x, y, amp) {
  const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (Math.round((h - Math.floor(h)) * 2) - 1) * amp;
}

/** 정수 해시 — 널 한 장, 돌 한 덩이처럼 "단위마다 다른 값"에 쓴다. 0~1. */
function hash(a, b) {
  let n = (a * 374761393 + b * 668265263) | 0;
  n = ((n ^ (n >> 13)) * 1274126177) | 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}
/** 램프 위를 연속 좌표로 훑는다 — 0(어두움) ~ 1(밝음) */
function step(rp, t) {
  const v = Math.max(0, Math.min(0.999, t)) * (rp.length - 1);
  const i = v | 0;
  const f = v - i;
  return rp[i].map((c, k) => c + (rp[i + 1] ?? rp[i])[k] * 0 + ((rp[i + 1] ?? rp[i])[k] - c) * f);
}
const tint = (c, d) => [c[0] + d, c[1] + d, c[2] + d];

/** 바닥 그림자 — 오브젝트가 바닥에서 떠 보이지 않게 밑에 깐다 */
function shadow(x, y, w, h) {
  fill(x + 2, y + h, w - 2, 3, [0, 0, 0], 0.34);
}
/** 3/4 상자 — 윗면(빛) + 앞면 + 외곽선 + 그림자 */
function box(x, y, w, h, rp, topH = 7) {
  shadow(x, y, w, h);
  fill(x - 1, y - 1, w + 2, h + 2, OL);
  fill(x, y, w, topH, rp[3]);
  fill(x, y, w, 1, rp[4]);
  fill(x, y, 1, topH, rp[4]);
  fill(x, y + topH, w, h - topH, rp[2]);
  fill(x, y + topH, w, 1, rp[1]);
  fill(x, y + h - 2, w, 2, rp[1]);
  fill(x, y + topH, 2, h - topH, rp[3]); // 좌상단 광원
}
/** 타일 칸을 막는다 + 픽셀 좌표로 그린다 */
function prop(tx, ty, tw, th, draw) {
  for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) blocked.add(`${tx + i},${ty + j}`);
  draw(tx * T, ty * T, tw * T, th * T);
}

// ── 바닥 ──────────────────────────────────────────────────────────
const FLOOR = {
  /**
   * 쪽모이 마루 — 홀.
   *
   * 16px 블록마다 결 방향을 90° 틀고, 블록 안에 8px 널 두 장을 깐다 (베르사유 쪽모이의
   * 단순형). 널마다 밝기를 조금씩 달리하고 이음선·모서리 빗면·옹이를 넣는다 —
   * 단색 + 잡티로는 절대 안 나오는 "짜임"이 여기서 생긴다.
   */
  parquet(x, y) {
    const B = 16;
    const bx = (x / B) | 0;
    const by = (y / B) | 0;
    const horiz = (bx + by) % 2 === 0;
    const lx = x % B;
    const ly = y % B;
    const plank = horiz ? (ly / 8) | 0 : (lx / 8) | 0;
    const across = horiz ? ly % 8 : lx % 8; // 널 폭 방향 (0~7)
    const along = horiz ? lx : ly;

    let t = 0.34 + hash(bx * 2 + (horiz ? 0 : 1), by * 2 + plank) * 0.2;
    if (across === 0) t += 0.16; // 널 윗모서리 빗면
    if (across === 7) t -= 0.14; // 아랫모서리 그늘
    if (along % 4 === 0) t -= 0.03; // 결
    if (lx === 0 || ly === 0) t -= 0.2; // 블록 이음선
    // 옹이 — 널마다 드물게 하나
    const kh = hash(bx * 7 + plank, by * 13 + (horiz ? 3 : 5));
    if (kh > 0.86) {
      const kx = 3 + ((kh * 97) | 0) % 10;
      const d = Math.abs(along % B - kx) + Math.abs(across - 4);
      if (d <= 1) t -= 0.22;
      else if (d <= 2) t -= 0.1;
    }
    return step(R.oak, t + grain(x, y, 0.012));
  },

  /** 융단 — 복도. 씨실·날실이 교차하는 짜임을 2px 단위로 낸다. */
  carpet(x, y) {
    const weave = ((x >> 1) + (y >> 1)) % 2 === 0;
    let t = 0.22 + (weave ? 0.05 : 0);
    if (y % 2 === 0) t += 0.03; // 씨실이 도드라진다
    // 은은한 다마스크 — 32px 마름모
    const dx = Math.abs((x % 32) - 16);
    const dy = Math.abs((y % 32) - 16);
    if (dx + dy < 9) t += 0.07;
    if (dx + dy > 20) t -= 0.03;
    return step(R.rug, t + grain(x, y, 0.02));
  },

  /**
   * 석재 — 세탁실·하인 통로.
   *
   * 돌마다 크기가 조금씩 다르고(해시로 폭을 흔든다), 윗변은 빛을 받고 아랫변은 그늘진다.
   * 줄눈은 두 단 어둡게 파서 돌이 얹혀 있는 것처럼 보이게 한다.
   */
  stone(x, y) {
    const RH = 16;
    const row = (y / RH) | 0;
    const off = (row % 2) * 14 + ((hash(row, 3) * 8) | 0);
    const col = ((x + off) / 28) | 0;
    const lx = (x + off) % 28;
    const ly = y % RH;
    const joint = ly === 0 || ly === RH - 1 || lx === 0;

    // 젖은 정도. 줄눈은 파여 있어 물이 먼저 고이고 물기가 더 멀리 번진다 —
    // 그래서 웅덩이 가장자리가 타원이 아니라 줄눈을 따라 각진 모양이 된다.
    const w = Math.min(1, wetAt(x, y) * (joint ? 1.55 : 1));

    if (joint) {
      // 줄눈에 고인 물은 거의 검게 가라앉는다
      return wet(step(R.stone, 0.06 - 0.03 * w), w, 0);
    }

    let t = 0.28 + hash(col, row) * 0.26;
    if (ly === 1) t += 0.2; // 윗변 빛
    if (ly === RH - 2) t -= 0.12; // 아랫변 그늘
    if (lx === 1) t += 0.1;
    if (lx === 27) t -= 0.08;
    // 돌 표면의 얼룩
    if (hash(x >> 2, y >> 2) > 0.82) t -= 0.07;
    // 드물게 금
    if (hash(col * 5, row * 11) > 0.9 && Math.abs(ly - 8) < 5 && (lx + ly) % 7 === 0) t -= 0.16;

    // 물막이 표면을 매끄럽게 만들면 명암이 벌어진다 — 어두워지되 대비는 커진다.
    // 결(grain)도 물 아래로 가라앉아 옅어진다.
    const tw = 0.5 + (t - 0.5) * (1 + 0.55 * w) - 0.11 * w;
    const c = step(R.stone, tw + grain(x, y, 0.012 * (1 - 0.6 * w)));
    // 반사는 돌 윗면 왼쪽에만 — 광원이 좌상단이고, 물은 그 면에서만 하늘을 비춘다.
    const spec = w > 0.3 && ly >= 1 && ly <= 4 && lx > 1 && lx < 15 ? (w - 0.3) * 1.4 : 0;
    return wet(c, w, spec);
  },

  /** 널판 — 서재·집사실·식당·잠긴 방. 가로로 긴 널에 결·못·옹이. */
  wood(x, y) {
    const PH = 11; // 널 높이
    const p = (y / PH) | 0;
    const seg = ((x + p * 37) / 96) | 0; // 널이 이어지는 마디
    const ly = y % PH;

    if (ly === 0) return step(R.wal, 0.06); // 널 이음선
    let t = 0.3 + hash(seg, p) * 0.22;
    if (ly === 1) t += 0.14;
    if (ly === PH - 1) t -= 0.1;
    // 나뭇결 — 널마다 위상이 다르다
    t += Math.sin(x * 0.22 + p * 2.7) * 0.035;
    if ((x + p * 37) % 96 === 0) t -= 0.18; // 마디 이음
    // 못 — 마디 양 끝에 두 개
    const nx = (x + p * 37) % 96;
    if ((nx === 4 || nx === 91) && ly === 5) t -= 0.3;
    // 옹이
    const kh = hash(seg * 3 + 1, p * 7);
    if (kh > 0.88) {
      const kx = 20 + ((kh * 211) | 0) % 50;
      const d = Math.abs(nx - kx) * 0.7 + Math.abs(ly - 5);
      if (d <= 1.5) t -= 0.24;
      else if (d <= 3) t -= 0.1;
    }
    return step(R.wal, t + grain(x, y, 0.01));
  },

  /**
   * 유약 타일 — 주방. 16px 흑백 체크.
   *
   * 줄눈을 파고 타일 면에 빗면 + 좌상단 반사점을 넣는다. 광택이 있어야 부엌의
   * 차갑고 닦인 느낌이 나온다 — 평평한 체크만으로는 격자무늬 종이다.
   */
  tile(x, y) {
    const S = 16;
    const gx = x % S;
    const gy = y % S;
    if (gx === 0 || gy === 0) return step(R.stone, 0.08); // 줄눈
    const dark = (((x / S) | 0) + ((y / S) | 0)) % 2 === 0;
    const rp = dark ? R.stone : R.cream;
    // 밝은 칸과 어두운 칸의 간극을 좁힌다 — 흑백을 끝까지 벌리면 바닥이 아니라
    // 체스판이 되어, 그 위에 선 인물과 가구가 안 읽힌다.
    let t = dark ? 0.24 : 0.32;
    if (gx === 1 || gy === 1) t += 0.12; // 좌상단 빗면
    if (gx === S - 1 || gy === S - 1) t -= 0.1; // 우하단 그늘
    if (gx >= 3 && gx <= 6 && gy >= 3 && gy <= 4) t += 0.1; // 반사
    if (hash((x / S) | 0, (y / S) | 0) > 0.93) t -= 0.06; // 드물게 때 탄 타일
    return step(rp, t + grain(x, y, 0.008));
  },

  /**
   * 리벳 강철판 — 연구실.
   *
   * 판을 64px 로 크게 잡는다. 32px 판이면 리벳이 화면 가득 격자로 박혀 바닥이
   * 물방울무늬가 된다 — 리벳은 드물어야 "이음매를 박은 자리"로 읽힌다.
   */
  metal(x, y) {
    const S = 64;
    const gx = x % S;
    const gy = y % S;
    if (gx === 0 || gy === 0) return step(R.steel, 0.1); // 판 이음매

    // 리벳 — 이음매를 따라 판 모서리 두 곳에만.
    for (const [rx, ry] of [[7, 7], [S - 7, 7], [7, S - 7], [S - 7, S - 7]]) {
      const rd = (gx - rx) ** 2 + (gy - ry) ** 2;
      if (rd <= 6) return step(R.brass, gx - rx + gy - ry < 0 ? 0.55 : 0.26);
      if (rd <= 12) return step(R.steel, 0.06);
    }

    let t = 0.36 + hash((x / S) | 0, (y / S) | 0) * 0.06;
    if (gy === 1) t += 0.14;
    if (gy === S - 1) t -= 0.1;
    // 결 방향 브러시 자국
    t += Math.sin((x + y * 0.4) * 0.7) * 0.028;
    // 긁힘 — 대각선으로 드물게
    if (hash((x - y) >> 2, 7) > 0.94 && (x + y) % 3 === 0) t += 0.12;
    return step(R.steel, t + grain(x, y, 0.01));
  },
};

// ── 젖은 바닥 ─────────────────────────────────────────────────────
// 세탁실 물기. 웅덩이를 바닥 **위에 덧그리지 않고**, 돌을 그리는 함수가 젖은 정도를
// 읽어 스스로 다르게 그린다. 덧그리면 아무리 손봐도 타일 위에 얹힌 스티커로 보인다 —
// 물은 돌의 줄눈·윗면·결을 알고 있어야 물이 된다.
const PUDDLES = [
  { tx: 14.6, ty: 6.5, r: 40, k: 1 },
  { tx: 16.9, ty: 6.1, r: 30, k: 1 },
  { tx: 15.5, ty: 7.5, r: 22, k: 0.85 },
  { tx: 18.5, ty: 6.9, r: 26, k: 0.75 },
  { tx: 20.7, ty: 6.3, r: 19, k: 0.55 },
  { tx: 22.5, ty: 6.0, r: 14, k: 0.4 },
  { tx: 13.9, ty: 4.4, r: 17, k: 0.6 },
  { tx: 17.5, ty: 4.2, r: 13, k: 0.45 },
].map((p) => ({ x: p.tx * T, y: p.ty * T, rx: p.r, ry: p.r * 0.62, k: p.k, seed: p.tx * 3.1 }));

/** 0(마름) ~ 1(흠뻑). 가운데는 평평하게 젖고 가장자리만 번진다. */
function wetAt(x, y) {
  let w = 0;
  for (const p of PUDDLES) {
    const dx = (x - p.x) / p.rx;
    const dy = (y - p.y) / p.ry;
    const a = Math.atan2(dy, dx);
    // 가장자리를 두 겹으로 흔든다 — 안 그러면 어디까지나 타원이다
    const wob = 1 + Math.sin(a * 3.3 + p.seed) * 0.17 + Math.sin(a * 7.1 + p.seed * 2) * 0.09;
    const d = Math.hypot(dx, dy) / wob;
    if (d < 1) w = Math.max(w, Math.min(1, (1 - d) * 2.4) * p.k);
  }
  return w;
}

/** 젖은 색 보정 — 채도가 푸른 쪽으로 기울고, spec 만큼 하늘을 비춘다. */
function wet(c, w, spec) {
  if (w <= 0) return c;
  const out = [c[0] * (1 - 0.12 * w), c[1] * (1 - 0.06 * w), Math.min(255, c[2] * (1 + 0.05 * w) + 10 * w)];
  if (spec > 0) {
    out[0] = Math.min(255, out[0] + 44 * spec);
    out[1] = Math.min(255, out[1] + 52 * spec);
    out[2] = Math.min(255, out[2] + 62 * spec);
  }
  return out;
}

// layout 인덱스 → 바닥 함수 (mansion.json 의 tiles 이름과 짝)
const FLOOR_BY_INDEX = [null, FLOOR.parquet, FLOOR.carpet, FLOOR.stone, FLOOR.wood, FLOOR.tile, FLOOR.metal, FLOOR.wood, null];

for (let r = 0; r < map.rows; r++) {
  for (let c = 0; c < map.cols; c++) {
    const fn = FLOOR_BY_INDEX[map.layout[r][c]];
    if (!fn) continue;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) put(c * T + x, r * T + y, fn(c * T + x, r * T + y));
  }
}

// ── 벽 ────────────────────────────────────────────────────────────
// 아래가 바닥인 벽은 "앞면"이 보인다 — 굽도리와 벽지를 그려 3/4 로 세운다.
const solid = (c, r) => c < 0 || r < 0 || c >= map.cols || r >= map.rows || map.tiles[map.layout[r][c]].solid;

for (let r = 0; r < map.rows; r++) {
  for (let c = 0; c < map.cols; c++) {
    if (!solid(c, r)) continue;
    const px = c * T;
    const py = r * T;
    const face = !solid(c, r + 1); // 아래가 방이면 이 칸이 벽면이다
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const wx = px + x;
        const g = grain(wx, py + y, 0.012);
        let col;
        if (face) {
          // 방을 마주 보는 벽면 — 위에서 아래로 두께 · 픽처 레일 · 벽지 · 웨인스코트 · 굽도리
          if (y < 3) col = step(R.wal, 0.06 + g); // 벽 두께 윗면
          else if (y < 7) {
            col = step(R.brass, (y === 3 ? 0.62 : y === 6 ? 0.16 : 0.4) + g); // 황동 픽처 레일
          } else if (y < 19) {
            // 벽지 — 24px 마름모 다마스크
            const dx = Math.abs((wx % 24) - 12);
            const dy = Math.abs(((y - 7) % 12) - 6);
            const motif = dx + dy * 2 < 9;
            col = step(R.wal, 0.3 + (motif ? 0.1 : 0) - (y - 7) * 0.006 + g);
          } else if (y < T - 4) {
            // 웨인스코트 — 32px 간격 패널. 안쪽으로 파인 것처럼 빗면을 준다.
            const lx = wx % 32;
            const inner = lx > 3 && lx < 28;
            let t = inner ? 0.24 : 0.38;
            if (inner && (lx === 4 || y === 20)) t += 0.16; // 파인 면의 좌상단 → 빛
            if (inner && (lx === 27 || y === T - 5)) t -= 0.12;
            col = step(R.wal, t + g);
          } else col = step(R.wal, 0.05 + g); // 굽도리
        } else {
          // 방과 안 닿는 벽 — 위에서 내려다본 우물반자. 가라앉아야 한다.
          const gx = wx % 24;
          const gy = (py + y) % 24;
          const groove = gx < 2 || gy < 2;
          col = step(R.wal, (groove ? 0.04 : 0.14) + (gx === 2 || gy === 2 ? 0.06 : 0) + g);
        }
        put(wx, py + y, col);
      }
    }
    if (face) fill(px, py + T - 1, T, 1, OL);
  }
}

// ── 벽 그늘 (앰비언트 오클루전) ──────────────────────────────────
// 바닥이 벽에 닿는 자리를 어둡게 깐다. 이것 하나로 바닥이 "벽 위에 얹힌 종이"에서
// "벽이 둘러싼 방"이 된다. 광원이 좌상단이므로 북·서쪽 벽의 그늘이 더 짙다.
{
  const AO = 8;
  const STRENGTH = { n: 0.5, w: 0.44, s: 0.2, e: 0.22 };
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (solid(c, r)) continue;
      const n = solid(c, r - 1);
      const s = solid(c, r + 1);
      const w = solid(c - 1, r);
      const e = solid(c + 1, r);
      const nw = solid(c - 1, r - 1);
      const ne = solid(c + 1, r - 1);
      const sw = solid(c - 1, r + 1);
      const se = solid(c + 1, r + 1);
      if (!(n || s || w || e || nw || ne || sw || se)) continue;

      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          let k = 0;
          if (n) k = Math.max(k, (1 - y / AO) * STRENGTH.n);
          if (w) k = Math.max(k, (1 - x / AO) * STRENGTH.w);
          if (s) k = Math.max(k, (1 - (T - 1 - y) / AO) * STRENGTH.s);
          if (e) k = Math.max(k, (1 - (T - 1 - x) / AO) * STRENGTH.e);
          // 안쪽 모서리 — 두 벽이 만나는 구석은 더 어둡다
          if (nw && !n && !w) k = Math.max(k, (1 - Math.hypot(x, y) / AO) * STRENGTH.n);
          if (ne && !n && !e) k = Math.max(k, (1 - Math.hypot(T - 1 - x, y) / AO) * STRENGTH.e);
          if (sw && !s && !w) k = Math.max(k, (1 - Math.hypot(x, T - 1 - y) / AO) * STRENGTH.w);
          if (se && !s && !e) k = Math.max(k, (1 - Math.hypot(T - 1 - x, T - 1 - y) / AO) * STRENGTH.s);
          if (k <= 0) continue;
          const i = ((r * T + y) * W + c * T + x) * 4;
          const m = 1 - k;
          buf[i] *= m;
          buf[i + 1] *= m;
          buf[i + 2] *= m;
        }
      }
    }
  }
}

// ── 문 ────────────────────────────────────────────────────────────
function drawDoor(d, open) {
  const px = d.x * T;
  const py = d.y * T;
  const w = d.w * T;
  const h = d.h * T;
  if (open) {
    fill(px, py, w, h, R.wal[1]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(px + x, py + y, tint(R.wal[1], grain(px + x, py + y, 5)));
    fill(px, py + (h >> 1) - 2, w, 4, R.brass[1]); // 문지방
    fill(px, py + (h >> 1) - 2, w, 1, R.brass[3]);
    return;
  }
  fill(px, py, w, h, OL);
  fill(px + 2, py + 2, w - 4, h - 4, R.wal[2]);
  for (let i = 0; i < w; i += 10) fill(px + 2 + i, py + 2, 2, h - 4, R.wal[1]); // 널
  fill(px + 2, py + 2, w - 4, 2, R.wal[3]);
  const cx = px + (w >> 1);
  const cy = py + (h >> 1);
  if (d.key) {
    disc(cx, cy, 9, R.brass[1]);
    disc(cx - 1, cy - 1, 7, R.brass[3]);
    disc(cx, cy, 3, OL); // 열쇠 구멍
  } else if (d.locked) {
    fill(cx - 10, cy - 5, 20, 10, OL);
    fill(cx - 9, cy - 4, 18, 8, R.steel[2]);
    fill(cx - 9, cy - 4, 18, 2, R.steel[4]);
    fill(cx - 2, cy - 2, 4, 5, OL);
  } else {
    disc(cx + (w >> 2), cy, 3, R.brass[3]); // 손잡이
  }
}
for (const d of map.doors) drawDoor(d, !d.locked && !d.key);

// 가구를 올리기 직전의 바닥 상태를 떠 둔다 — 나중에 "막았는데 아무것도 안 그린 칸"을
// 찾는 데 쓴다. 막는 범위와 그림 크기가 어긋나는 실수는 눈으로는 안 보이고,
// 플레이하다 보이지 않는 벽에 부딪혀야 알게 된다.
const floorOnly = Uint8ClampedArray.from(buf);

// ── 오브제 ────────────────────────────────────────────────────────
/** 창 — 바깥 벽에 뚫는다. 빛이 새 들어오는 자리이기도 하다. */
function window_(tx, ty, tw) {
  const px = tx * T;
  const py = ty * T + 6;
  const w = tw * T;
  fill(px - 2, py - 2, w + 4, 24, OL);
  fill(px, py, w, 20, R.steel[0]);
  for (let i = 0; i < w; i += 12) fill(px + i, py, 10, 18, tint(R.cream[3], -30));
  fill(px, py, w, 3, R.brass[1]);
  fill(px, py + 18, w, 3, R.wal[0]);
}
/** 벽에 거는 액자 */
function painting(tx, ty, tw) {
  const px = tx * T;
  const py = ty * T + 8;
  const w = tw * T;
  fill(px - 2, py - 2, w + 4, 22, OL);
  fill(px, py, w, 18, R.brass[1]);
  fill(px + 3, py + 3, w - 6, 12, R.green[1]);
  fill(px + 3, py + 3, w - 6, 4, R.green[2]);
  fill(px, py, w, 2, R.brass[3]);
}
function shelf(px, py, w, h) {
  box(px, py, w, h, R.wal, 8);
  for (let sy = py + 12; sy < py + h - 6; sy += 14) {
    fill(px + 3, sy, w - 6, 2, R.wal[0]);
    for (let bx = px + 5; bx < px + w - 8; bx += 5) {
      const rp = [R.red, R.green, R.brass, R.cream][(bx + sy) % 4];
      fill(bx, sy - 9, 4, 9, rp[2]);
      fill(bx, sy - 9, 4, 2, rp[3]);
    }
  }
}
function table(px, py, w, h) {
  box(px, py, w, h, R.oak, 10);
  fill(px + 4, py + 3, w - 8, 4, R.oak[4]); // 상판 광택
}
function chair(px, py, dir) {
  shadow(px + 4, py + 6, 22, 20);
  fill(px + 2, py + 4, 26, 24, OL);
  fill(px + 4, py + 6, 22, 20, R.wal[2]);
  fill(px + 8, py + 10, 14, 12, R.rug[2]);
  fill(px + 8, py + 10, 14, 3, R.rug[3]);
  fill(dir < 0 ? px + 4 : px + 21, py + 6, 5, 20, R.wal[1]);
}
function barrel(px, py) {
  shadow(px + 4, py + 4, 24, 24);
  disc(px + 16, py + 16, 15, OL);
  disc(px + 16, py + 16, 13, R.wal[2]);
  disc(px + 13, py + 13, 8, R.wal[3]);
  ring(px + 16, py + 16, 11, R.brass[2]);
  ring(px + 16, py + 16, 6, R.brass[1]);
}
function crate(px, py) {
  shadow(px + 2, py + 2, 28, 26);
  fill(px, py, 32, 30, OL);
  fill(px + 2, py + 2, 28, 26, R.oak[2]);
  fill(px + 2, py + 2, 28, 4, R.oak[4]);
  fill(px + 2, py + 14, 28, 3, R.oak[1]);
  fill(px + 14, py + 2, 3, 26, R.oak[1]);
}
function plant(px, py) {
  box(px + 6, py + 14, 20, 16, R.copper, 6);
  for (const [ox, oy, hgt] of [[10, 2, 14], [16, 0, 18], [21, 4, 11]]) {
    fill(px + ox, py + oy, 4, hgt, R.green[2]);
    fill(px + ox, py + oy, 2, hgt, R.green[3]);
  }
}
function tub(px, py) {
  shadow(px + 3, py + 6, 26, 22);
  disc(px + 16, py + 17, 14, OL);
  disc(px + 16, py + 17, 12, R.steel[2]);
  disc(px + 16, py + 17, 9, R.steel[1]);
  disc(px + 14, py + 15, 5, R.cream[3], 0.5); // 물·거품
  ring(px + 16, py + 17, 12, R.brass[1]);
}

// 홀 — 괘종시계 · 기둥 · 러그 · 의자
const hall = room('hall');
// 괘종시계 — 막는 칸과 그려지는 크기를 맞춘다.
// 3칸(96px)을 막고 안에 좁은 기둥만 그리면, 옆의 빈 마루가 이유 없이 안 지나가진다.
prop(35, 23, 2, 3, (px, py, w) => {
  shadow(px + 3, py, w - 6, 94);
  fill(px + 2, py - 2, w - 4, 98, OL);
  fill(px + 4, py, w - 8, 94, R.wal[2]);
  fill(px + 4, py, 4, 94, R.wal[3]); // 좌상단 광원
  fill(px + w - 8, py, 4, 94, R.wal[1]);
  fill(px + 4, py, w - 8, 5, R.brass[2]); // 관
  fill(px + 4, py, w - 8, 2, R.brass[3]);
  const cx = px + (w >> 1);
  disc(cx, py + 24, 19, OL);
  disc(cx, py + 24, 16, R.cream[3]);
  disc(cx, py + 24, 13, R.cream[4]);
  for (let a = 0; a < 12; a++) {
    // 시각 눈금
    const t = (a / 12) * Math.PI * 2;
    put(cx + Math.round(Math.sin(t) * 13), cy0(py) + Math.round(-Math.cos(t) * 13), OL);
  }
  fill(cx - 1, py + 12, 2, 13, OL); // 시침
  fill(cx - 1, py + 23, 10, 2, OL); // 분침
  disc(cx, py + 24, 3, R.brass[1]);
  fill(cx - 13, py + 50, 26, 38, OL); // 추 상자
  fill(cx - 11, py + 52, 22, 34, hex('#0d0a06'));
  fill(cx - 1, py + 52, 2, 22, R.brass[1]); // 추 대
  disc(cx, py + 78, 8, R.brass[2]);
  disc(cx - 2, py + 76, 4, R.brass[4]);
});
function cy0(py) {
  return py + 24;
}
function column(px, py) {
  shadow(px + 2, py + 2, 28, 26);
  fill(px, py, 32, 32, OL);
  fill(px + 2, py + 2, 28, 28, R.stone[2]);
  fill(px + 2, py + 2, 28, 8, R.stone[3]);
  fill(px + 2, py + 2, 28, 2, R.stone[4]);
  fill(px + 6, py + 10, 20, 16, R.brass[2]);
  fill(px + 6, py + 10, 20, 4, R.brass[3]);
  fill(px + 6, py + 22, 20, 4, R.brass[1]);
}
prop(25, 23, 1, 1, column);
prop(34, 23, 1, 1, column);
prop(23, 28, 1, 1, (px, py) => chair(px, py, -1));
prop(32, 29, 1, 1, (px, py) => chair(px, py, 1));
prop(22, 24, 1, 1, plant);
// 홀 러그 — 카펫과 같은 램프. 막지 않는다.
(() => {
  const rx = 25 * T;
  const ry = 27 * T;
  const rw = 8 * T;
  const rh = 4 * T;
  fill(rx + 3, ry + 3, rw, rh, [0, 0, 0], 0.3);
  fill(rx - 1, ry - 1, rw + 2, rh + 2, OL);
  // 4px 줄무늬로 깔면 융단이 아니라 차양이 된다 — 바닥 카펫과 같은 2px 짜임을 쓴다.
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const weave = ((x >> 1) + (y >> 1)) % 2 === 0;
      const edge = x < 9 || y < 9 || x >= rw - 9 || y >= rh - 9;
      put(rx + x, ry + y, step(R.rug, (edge ? 0.42 : 0.24) + (weave ? 0.05 : 0) + (y % 2 ? 0 : 0.03)));
    }
  }
  fill(rx + 4, ry + 4, rw - 8, 2, R.brass[2]);
  fill(rx + 4, ry + rh - 6, rw - 8, 2, R.brass[2]);
  fill(rx + 4, ry + 4, 2, rh - 8, R.brass[2]);
  fill(rx + rw - 6, ry + 4, 2, rh - 8, R.brass[2]);
  const dia = (cx, cy, s, rp) => {
    for (let y = -s; y <= s; y++)
      for (let x = -s; x <= s; x++) {
        const d = Math.abs(x) + Math.abs(y);
        if (d <= s) put(cx + x, cy + y, d > s - 4 ? rp[3] : rp[1]);
      }
  };
  dia(rx + rw / 2, ry + rh / 2, 22, R.brass);
  dia(rx + 44, ry + rh / 2, 12, R.cream);
  dia(rx + rw - 44, ry + rh / 2, 12, R.cream);
})();

// 주방 — 화덕 · 조리대 · 선반
prop(36, 12, 3, 1, (px, py, w) => {
  shadow(px, py, w, 44);
  fill(px - 2, py - 2, w + 4, 48, OL);
  fill(px, py, w, 44, R.steel[2]);
  fill(px, py, w, 12, R.steel[3]);
  fill(px, py, w, 2, R.steel[4]);
  fill(px + 8, py + 18, w - 16, 20, OL);
  fill(px + 10, py + 20, w - 20, 16, R.red[3]); // 불
  fill(px + 12, py + 22, w - 24, 5, R.brass[3]);
  fill(px + 4, py + 6, 8, 4, R.brass[2]);
  fill(px + w - 12, py + 6, 8, 4, R.brass[2]);
});
prop(42, 12, 3, 1, (px, py, w) => {
  table(px, py, w, 40);
  fill(px + 6, py + 4, 14, 8, R.cream[3]);
  fill(px + 28, py + 3, 12, 10, R.green[2]);
  disc(px + 60, py + 8, 6, R.brass[2]);
});
// crate 는 32px 한 칸짜리 그림이다 — 2칸을 막으면 옆 칸이 빈 채로 막힌다.
prop(36, 18, 1, 1, crate);
prop(37, 18, 1, 1, barrel);
prop(43, 18, 1, 1, crate);

// 세탁실 — 빨래통 · 바구니 · 널린 빨래
prop(14, 5, 1, 1, tub);
prop(16, 5, 1, 1, tub);
prop(21, 4, 1, 1, crate);
prop(22, 7, 1, 1, barrel);
(() => {
  // 빨랫줄 — 막지 않는다
  const y = 3 * T + 10;
  fill(13 * T + 4, y, 11 * T - 8, 2, R.wal[0]);
  for (let i = 0; i < 6; i++) {
    const x = 13 * T + 20 + i * 54;
    const rp = [R.cream, R.paper ?? R.cream, R.steel][i % 3];
    fill(x, y + 2, 26, 30 + (i % 3) * 8, rp[3]);
    fill(x, y + 2, 26, 4, rp[4]);
  }
})();

// 서재 — 책장 벽면 · 책상
prop(35, 2, 12, 1, (px, py, w) => shelf(px, py + 4, w, 40));
prop(37, 8, 3, 1, (px, py, w) => shelf(px, py, w, 30));
prop(43, 8, 3, 1, (px, py, w) => shelf(px, py, w, 30));
prop(40, 6, 3, 1, (px, py, w) => {
  table(px, py, w, 36);
  fill(px + 8, py + 4, 26, 18, R.cream[3]); // 펼친 책
  fill(px + 8, py + 4, 26, 3, R.cream[4]);
  fill(px + 21, py + 4, 2, 18, R.wal[1]);
  disc(px + 62, py + 10, 5, R.brass[2]);
});
// 좌우 벽면 책장 — 서재가 위쪽 한 줄만 차 있으면 방이 비어 보인다.
// 왼쪽 벽은 (34,5)~(34,6) 문이 열리는 자리다 — 들어서는 칸을 막으면 서재에 못 들어간다.
prop(35, 7, 1, 2, (px, py, w, h) => shelf(px, py, w, h - 4));
prop(46, 4, 1, 4, (px, py, w, h) => shelf(px, py, w, h - 4));
prop(39, 7, 1, 1, (px, py) => chair(px, py, -1));
prop(42, 3, 1, 1, (px, py) => {
  // 사다리 — 높은 서가에 손이 닿게 하는 물건
  fill(px + 6, py, 4, 30, R.oak[2]);
  fill(px + 22, py, 4, 30, R.oak[2]);
  for (let i = 4; i < 30; i += 7) fill(px + 6, py + i, 20, 3, R.oak[3]);
});

// 집사실 — 책상 · 금고 · 장부 선반
prop(4, 18, 3, 1, (px, py, w) => {
  table(px, py, w, 38);
  fill(px + 6, py + 4, 20, 14, R.cream[3]);
  fill(px + 52, py + 2, 14, 16, R.wal[1]);
});
prop(10, 17, 1, 1, (px, py) => {
  box(px, py, 32, 34, R.steel, 8);
  disc(px + 16, py + 20, 8, R.brass[1]);
  disc(px + 16, py + 20, 4, R.brass[3]);
});
prop(3, 22, 2, 1, (px, py, w) => shelf(px, py, w, 26));
prop(8, 21, 1, 1, (px, py) => chair(px, py, 1));
prop(2, 16, 1, 2, (px, py, w, h) => {
  // 서류 캐비닛 — 장부의 방답게
  box(px, py, w, h - 6, R.oak, 8);
  for (let i = 0; i < 3; i++) {
    fill(px + 4, py + 14 + i * 14, w - 8, 10, R.oak[1]);
    fill(px + 4, py + 14 + i * 14, w - 8, 2, R.oak[3]);
    disc(px + w / 2, py + 19 + i * 14, 3, R.brass[3]);
  }
});

// 식당 — 긴 식탁 + 의자
prop(5, 28, 10, 1, (px, py, w) => {
  table(px, py, w, 42);
  for (let i = 0; i < 6; i++) {
    const cx = px + 22 + i * 48;
    disc(cx, py + 12, 7, R.cream[3]); // 접시
    disc(cx, py + 12, 5, R.cream[4]);
    fill(cx + 11, py + 8, 2, 10, R.brass[3]); // 은식기
  }
});
for (const c of [5, 8, 11, 14]) prop(c, 26, 1, 1, (px, py) => chair(px, py, -1));
for (const c of [6, 9, 12]) prop(c, 30, 1, 1, (px, py) => chair(px, py, 1));
prop(17, 27, 1, 1, plant);

// 하인 통로 — 화분 · 상자 · 통
for (const c of [42, 46, 55]) prop(c, 26, 1, 1, plant);
prop(44, 30, 1, 1, crate);
prop(49, 30, 1, 1, barrel);
prop(57, 27, 1, 1, crate);

// 복도 — 러너 · 기둥 · 액자 · 화분 · 촛대
// 8×22 짜리 통짜 붉은 바닥은 그냥 큰 판이다. 가운데 러너를 깔아 축을 만들고
// 양옆에 물건을 세워 걸어가는 동안 지나가는 것이 생기게 한다.
(() => {
  const rx = 27 * T;
  const ry = 3 * T;
  const rw = 6 * T;
  const rh = 20 * T;
  fill(rx - 1, ry - 1, rw + 2, rh + 2, OL);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const weave = ((x >> 1) + (y >> 1)) % 2 === 0;
      const edge = x < 7 || x >= rw - 7;
      put(rx + x, ry + y, step(R.rug, (edge ? 0.44 : 0.28) + (weave ? 0.05 : 0) + (y % 2 ? 0 : 0.03)));
    }
  }
  fill(rx + 3, ry, 2, rh, R.brass[1]);
  fill(rx + rw - 5, ry, 2, rh, R.brass[1]);
  // 마름모 모티프를 일정 간격으로 — 걸을 때 지나간 거리가 읽힌다
  for (let cy = ry + 60; cy < ry + rh - 40; cy += 128) {
    for (let y = -14; y <= 14; y++)
      for (let x = -14; x <= 14; x++) {
        const d = Math.abs(x) + Math.abs(y);
        if (d <= 14) put(rx + rw / 2 + x, cy + y, d > 10 ? R.brass[2] : R.rug[0]);
      }
  }
})();
function candle(px, py) {
  box(px + 8, py + 16, 16, 14, R.brass, 5);
  fill(px + 14, py + 2, 4, 15, R.cream[3]);
  disc(px + 16, py + 2, 4, R.brass[4]); // 불빛
}
prop(26, 3, 1, 1, column);
prop(33, 3, 1, 1, column);
prop(26, 22, 1, 1, column);
prop(33, 22, 1, 1, column);
prop(26, 8, 1, 1, candle);
prop(33, 8, 1, 1, candle);
prop(26, 17, 1, 1, plant);
prop(33, 12, 1, 1, plant);
prop(33, 19, 1, 1, crate);
painting(28, 1, 2);
painting(30, 23, 2);

// 잠긴 방 — 못 들어가지만 위에서 내려다보는 시점이라 안이 보인다.
// "규칙적인 기계음"의 근거를 눈으로도 남긴다 — 태엽 장치와 작은 침대(스테이지 3 복선).
prop(16, 14, 3, 1, (px, py, w) => {
  box(px, py, w, 34, R.steel, 9);
  for (let i = 0; i < 3; i++) {
    disc(px + 20 + i * 28, py + 18, 11, R.brass[1]);
    disc(px + 20 + i * 28, py + 18, 6, R.brass[3]);
    ring(px + 20 + i * 28, py + 18, 11, R.brass[0]);
  }
});
prop(21, 16, 2, 1, (px, py, w) => {
  box(px, py, w, 28, R.wal, 7); // 작은 침대
  fill(px + 4, py + 4, w - 8, 14, R.cream[2]);
  fill(px + 4, py + 4, w - 8, 3, R.cream[3]);
});
prop(16, 17, 1, 1, barrel);

// 연구실 — 작업대 · 기계 · 문서 받침대(목표)
prop(48, 18, 4, 1, (px, py, w) => {
  box(px, py, w, 36, R.steel, 9);
  fill(px + 8, py + 4, 22, 12, R.green[3]);
  fill(px + 40, py + 4, 30, 12, R.cream[2]);
  disc(px + 96, py + 12, 7, R.brass[2]);
});
prop(54, 18, 3, 1, (px, py, w) => {
  box(px, py, w, 40, R.steel, 10);
  for (let i = 0; i < 3; i++) {
    disc(px + 18 + i * 26, py + 22, 8, R.brass[1]);
    disc(px + 18 + i * 26, py + 22, 4, R.brass[3]);
  }
  fill(px + 6, py + 4, w - 12, 5, R.copper[3]);
});
prop(52, 22, 2, 1, (px, py, w) => {
  // 문서 받침대 — 스테이지 목표. 유일하게 밝은 종이를 얹는다.
  box(px + 8, py + 10, w - 16, 22, R.wal, 6);
  fill(px + 14, py - 2, w - 28, 20, OL);
  fill(px + 16, py, w - 32, 16, R.cream[4]);
  for (let i = 0; i < 4; i++) fill(px + 20, py + 3 + i * 3, w - 40, 1, R.stone[1]);
});

// 창 — 바깥 벽 쪽에만
window_(15, 1, 3);
window_(20, 1, 3);
window_(38, 1, 3);
window_(43, 1, 3);
window_(3, 25, 3);
window_(12, 25, 3);
window_(48, 16, 3);
window_(53, 16, 3);

// ── 보이지 않는 벽 검사 ───────────────────────────────────────────
// 막았는데 그린 것이 없는 칸을 찾는다. 반드시 **조명 이전에** 대조해야 한다 —
// 조명은 버퍼 전체를 건드리므로 그 뒤에 비교하면 모든 칸이 "달라졌다"로 잡힌다.
const invisibleWalls = [];
for (const k of blocked) {
  const [c, r] = k.split(',').map(Number);
  if (map.tiles[map.layout[r][c]].solid) continue; // 벽은 원래 막힌다
  let changed = 0;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const i = ((r * T + y) * W + c * T + x) * 4;
      if (Math.abs(buf[i] - floorOnly[i]) + Math.abs(buf[i + 1] - floorOnly[i + 1]) > 12) changed++;
    }
  }
  const pct = (changed / (T * T)) * 100;
  if (pct < 18) invisibleWalls.push(`(${c},${r}) 을 막았는데 그린 것이 ${pct.toFixed(0)}% 뿐 — 보이지 않는 벽`);
}

// ── 조명 ──────────────────────────────────────────────────────────
// 좌상단 고정 광원 + 방마다 등불. 어두운 저택에 등불이 웅덩이를 만든다.
const AMBIENT = 0.4;
const LAMPS = [
  ...map.rooms.flatMap((r) => {
    const cx = (r.x + r.w / 2) * T;
    const cy = (r.y + r.h / 2) * T;
    // 반경을 방보다 좁게 잡아 구석이 어두워지게 둔다 — 방 전체가 고르게 밝으면
    // 저택이 아니라 도면이 된다. 그래도 NPC 를 못 알아볼 만큼 어둡지는 않다.
    const rad = Math.max(r.w, r.h) * T * 0.62;
    return [{ x: cx, y: cy, r: rad, i: 0.8 }];
  }),
  { x: 29.5 * T, y: 26.5 * T, r: 300, i: 0.95 }, // 홀 샹들리에
  { x: 37.5 * T, y: 12.6 * T, r: 190, i: 0.7 }, // 주방 화덕
  // 홀과 복도가 벽 없이 맞닿는 목. 두 방의 등불이 다 멀어 여기만 띠처럼 어두워진다 —
  // 이음매에 등을 하나 더 달아 밝기가 끊기지 않고 넘어가게 한다.
  { x: 29.5 * T, y: 23 * T, r: 250, i: 0.72 },
  { x: 29.5 * T, y: 19 * T, r: 190, i: 0.4 },
];
// 창에서 새는 빛
for (const [cx, cy] of [[16.5, 2], [21.5, 2], [39.5, 2], [44.5, 2], [4.5, 26], [13.5, 26], [49.5, 17], [54.5, 17]]) {
  LAMPS.push({ x: cx * T, y: cy * T, r: 210, i: 0.55, cool: true });
}

const WARM = [1.12, 1.0, 0.78];
// 창빛은 서늘하되 파랗지는 않게. 강하게 주면 금속 바닥이 SF 처럼 퍼렇게 뜬다.
const COOL = [0.92, 0.99, 1.06];
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
    // 좌상단 방향광 — 오브젝트의 입체가 죽지 않게 아주 옅게만
    lit += 0.06 * (1 - (x / W) * 0.5 - (y / H) * 0.5);
    // 48단으로 끊는다 — 매끄러운 그라데이션은 픽셀마다 값이 달라 압축이 안 되고,
    // 도트 그림에서는 계단진 빛이 오히려 어울린다.
    lit = Math.round(Math.min(1.28, lit) * 48) / 48;
    const t = warmth > 0 ? WARM : COOL;
    const k = Math.min(1, Math.abs(warmth));
    const i = (y * W + x) * 4;
    for (let ch = 0; ch < 3; ch++) {
      const mul = lit * (1 + (t[ch] - 1) * k * 0.55);
      buf[i + ch] = Math.min(255, buf[i + ch] * mul);
    }
  }
}

// ── 출력 ──────────────────────────────────────────────────────────
/**
 * PNG 행 필터 — 행마다 None/Sub/Up/Average/Paeth 중 하나를 고른다.
 *
 * 전 행을 filter 0(None)으로 두면 조명 그라데이션이 통째로 원본 바이트로 남아
 * deflate 가 거의 못 줄인다. 표준 휴리스틱(절대값 합이 가장 작은 필터)만 써도
 * 이런 그림에서 파일이 절반 아래로 떨어진다.
 */
function filterRows(src, w, h) {
  const stride = w * 4;
  const out = Buffer.alloc(h * (stride + 1));
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
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
      const x = src[row + i];
      const a = i >= 4 ? src[row + i - 4] : 0;
      const b = y > 0 ? src[prev + i] : 0;
      const c = y > 0 && i >= 4 ? src[prev + i - 4] : 0;
      const v = [x, (x - a) & 255, (x - b) & 255, (x - ((a + b) >> 1)) & 255, (x - paeth(a, b, c)) & 255];
      for (let f = 0; f < 5; f++) {
        cand[f][i] = v[f];
        // 부호 있는 값으로 보고 크기를 재는 것이 표준 휴리스틱이다
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
  const stride = w * 4;
  const raw = filterRows(Buffer.from(src.buffer, src.byteOffset, h * stride), w, h);
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

fs.writeFileSync('src/client/assets/mansion-bg.png', encodePng(W, H, buf));

// --debug: 막힌 칸을 그림 위에 겹쳐 낸다.
//
// 가구가 막는 범위와 실제로 그려진 크기가 어긋나면 "아무것도 없는데 안 지나가지는 칸"이
// 생긴다. 플레이해서 부딪혀 보기 전에는 못 찾는 종류라, 눈으로 대조할 수단을 둔다.
if (process.argv.includes('--debug')) {
  const dbg = Uint8ClampedArray.from(buf);
  for (const k of blocked) {
    const [c, r] = k.split(',').map(Number);
    if (map.tiles[map.layout[r][c]].solid) continue; // 벽은 원래 막힌다 — 가구만 본다
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
  fs.writeFileSync('src/client/assets/mansion-blocked-debug.png', encodePng(W, H, dbg));
  console.log('→ src/client/assets/mansion-blocked-debug.png (막힌 칸 겹쳐 보기)');
}

// 열린 연구실 문 — 열쇠를 얻으면 씬이 이 조각을 덮어 그린다.
const labDoor = map.doors.find((d) => d.key === 'lab');
const dw = labDoor.w * T;
const dh = labDoor.h * T;
const piece = new Uint8ClampedArray(dw * dh * 4);
drawDoor(labDoor, true);
for (let y = 0; y < dh; y++) {
  for (let x = 0; x < dw; x++) {
    const s = ((labDoor.y * T + y) * W + labDoor.x * T + x) * 4;
    const d = (y * dw + x) * 4;
    piece[d] = buf[s];
    piece[d + 1] = buf[s + 1];
    piece[d + 2] = buf[s + 2];
    piece[d + 3] = 255;
  }
}
fs.writeFileSync('src/client/assets/mansion-door-open.png', encodePng(dw, dh, piece));

const list = [...blocked].map((k) => k.split(',').map(Number));
fs.writeFileSync(
  'src/client/assets/mansion-props.json',
  JSON.stringify({ _comment: '가구가 막는 칸. scripts/gen-mansion-art.js 가 낸다.', blocked: list, ...keepWalk('mansion') }) + '\n',
);

// ── 도달성 검사 ───────────────────────────────────────────────────
// gen-mansion-map.js 도 도달성을 보지만 그때는 **벽만** 안다. 방 안에 가구를 놓고 나면
// 문 앞을 책장으로 막는 것 같은 일이 생기는데, 그림으로는 멀쩡해 보이고 걸어가 봐야 안다.
// 그래서 가구까지 포함해 플레이어 스폰에서 다시 BFS 를 돌린다.
const cast = JSON.parse(fs.readFileSync('src/data/mansion.json', 'utf8'));
const key = (c, r) => `${c},${r}`;

function reach(openLab) {
  const labDoorTiles = new Set();
  if (openLab) {
    const d = map.doors.find((x) => x.key === 'lab');
    for (let r = d.y; r < d.y + d.h; r++) for (let c = d.x; c < d.x + d.w; c++) labDoorTiles.add(key(c, r));
  }
  const ok = (c, r) =>
    c >= 0 &&
    r >= 0 &&
    c < map.cols &&
    r < map.rows &&
    (!map.tiles[map.layout[r][c]].solid || labDoorTiles.has(key(c, r))) &&
    !blocked.has(key(c, r));

  const seen = new Set([key(map.spawns.player.col, map.spawns.player.row)]);
  const queue = [[map.spawns.player.col, map.spawns.player.row]];
  while (queue.length) {
    const [c, r] = queue.pop();
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = key(c + dc, r + dr);
      if (seen.has(k) || !ok(c + dc, r + dr)) continue;
      seen.add(k);
      queue.push([c + dc, r + dr]);
    }
  }
  return seen;
}

const before = reach(false);
const after = reach(true);
const bad = [];

bad.push(...invisibleWalls);

// 플레이어가 스폰 칸에 갇혀 있지 않은가
if (before.size < 50) bad.push(`플레이어 스폰에서 ${before.size}칸밖에 못 간다 — 갇혔다`);

// NPC 한 명 한 명에게 실제로 걸어갈 수 있는가
for (const n of [cast.escort, ...cast.npcs]) {
  const rm = room(n.room);
  if (!rm) {
    bad.push(`${n.name}: 방 '${n.room}' 이 맵에 없다`);
    continue;
  }
  if (n.col < rm.x || n.col >= rm.x + rm.w || n.row < rm.y || n.row >= rm.y + rm.h) {
    bad.push(`${n.name}: (${n.col},${n.row}) 이 ${rm.name} 밖이다`);
    continue;
  }
  if (blocked.has(key(n.col, n.row))) {
    bad.push(`${n.name}: (${n.col},${n.row}) 은 가구가 차지한 칸이다`);
    continue;
  }
  // NPC 는 서 있기만 하면 되고, 플레이어가 옆 칸까지 오면 말을 걸 수 있다.
  const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => before.has(key(n.col + dc, n.row + dr)));
  if (!near) bad.push(`${n.name}: ${rm.name} (${n.col},${n.row}) 까지 걸어갈 수 없다`);
}

// 방마다 최소한 발 디딜 곳이 있는가 (잠긴 방은 예외, 연구실은 열쇠 뒤)
for (const rm of map.rooms) {
  if (rm.id === 'locked') continue;
  const set = rm.id === 'lab' ? after : before;
  let n = 0;
  for (let r = rm.y; r < rm.y + rm.h; r++) for (let c = rm.x; c < rm.x + rm.w; c++) if (set.has(key(c, r))) n++;
  if (n < 6) bad.push(`${rm.name}: 들어가서 설 수 있는 칸이 ${n}개뿐이다 — 가구가 입구를 막았다`);
}

// 목표 — 연구실 문서 받침대 옆에 설 수 있어야 클리어할 수 있다
const doc = [52, 22];
if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => after.has(key(doc[0] + dc, doc[1] + dr)))) {
  bad.push('연구실 문서 받침대에 다가갈 수 없다');
}

if (bad.length) {
  console.error('\n도달성 오류\n  ' + bad.join('\n  ') + '\n');
  process.exit(1);
}

console.log(`배경 ${W}×${H} · 가구가 막는 칸 ${list.length} · 등불 ${LAMPS.length}`);
console.log(`도달성 검사 통과 — NPC ${cast.npcs.length + 1}명 · 방 ${map.rooms.length}개 · 목표 문서`);
console.log('→ src/client/assets/mansion-bg.png · mansion-door-open.png · mansion-props.json');
