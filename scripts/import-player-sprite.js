/**
 * PixelLab 내보내기 → 플레이어 스프라이트 시트 — 코드네임: 태엽새
 *
 *   node scripts/import-player-sprite.js [--debug]
 *
 * 원본: design/Player/pixellab/  (PixelLab 내보내기 그대로. 128×128 프레임,
 *   rotations/ 에 방향별 대기 1장씩, animations/Walking/<방향>/ 에 걷기 8장씩)
 * 출력: src/client/assets/player/player-idle.png  (4프레임: 아래·위·왼·오)
 *       src/client/assets/player/player-walk.png  (32프레임: 방향마다 8장)
 *
 * ── 왜 그냥 이어 붙이지 않고 정렬을 하는가 ──
 *
 * 내보낸 그대로는 **방향마다 발 높이가 다르다** (실측: 남 96 · 북 96 · 서/동 93,
 * 대기 93~94). 원점은 하나로 고정돼 있으므로, 그대로 쓰면 방향을 바꿀 때마다 인물이
 * 위아래로 5px 튄다 — 키가 63px 인 캐릭터에서 8%다.
 * 그래서 **방향 묶음마다 통째로 평행이동**해 땅에 닿는 선을 맞춘다. 묶음 안의 프레임
 * 사이 1~3px 흔들림은 그대로 둔다 — 그게 걸을 때의 자연스러운 상하 반동이다.
 *
 * 가로도 같은 이유로 묶음 단위로 가운데에 맞춘다 (서 66.3 · 동 60.7 로 좌우가 어긋나
 * 있어서, 안 맞추면 방향을 바꿀 때 옆으로 밀린다).
 *
 * 이동은 전부 **정수 픽셀 평행이동**이다. 늘리거나 기울이지 않는다 — 예전 시트의
 * 상체 롤링을 행 단위 밀기로 지워 보려다 목이 끊긴 적이 있다 (그때 배운 것).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.js';

const SRC = 'design/Player/pixellab/Idle';
const OUT_DIR = 'src/client/assets/player';

/** PixelLab 의 방위 → 게임의 방향. 이 순서가 곧 시트의 프레임 순서다. */
const DIRS = [
  { key: 'south', name: 'down' },
  { key: 'north', name: 'up' },
  { key: 'west', name: 'left' },
  { key: 'east', name: 'right' },
];
const WALK_FRAMES = 8;
/** 알파가 이보다 진해야 인물로 친다 — 가장자리 반투명 픽셀에 경계상자가 끌려가지 않게. */
const ALPHA = 96;

const load = (p) => decodePng(fs.readFileSync(p));

/** 인물이 실제로 차지한 사각형. 없으면 null. */
function bbox(img) {
  const { w, h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < ALPHA) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** 정수 픽셀 평행이동. 프레임 밖으로 나간 부분은 잘린다(그럴 일이 없게 목표를 잡는다). */
function shift(img, dx, dy) {
  const { w, h, data } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= w) continue;
      const s = (sy * w + sx) * 4;
      const d = (y * w + x) * 4;
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
    }
  }
  return { w, h, data: out };
}

/** 프레임들을 가로로 한 줄에 잇는다. */
function strip(frames) {
  const F = frames[0].w;
  const w = F * frames.length;
  const out = new Uint8ClampedArray(w * F * 4);
  frames.forEach((img, n) => {
    for (let y = 0; y < F; y++) {
      const s = y * F * 4;
      const d = (y * w + n * F) * 4;
      out.set(img.data.subarray(s, s + F * 4), d);
    }
  });
  return { w, h: F, data: out };
}

// ── 읽기 ──────────────────────────────────────────────────────────

const groups = [];
for (const d of DIRS) {
  groups.push({ label: `대기 ${d.name}`, kind: 'idle', dir: d, frames: [load(`${SRC}/rotations/${d.key}.png`)] });
}
for (const d of DIRS) {
  const frames = [];
  for (let i = 0; i < WALK_FRAMES; i++) {
    frames.push(load(`${SRC}/animations/Walking/${d.key}/frame_${String(i).padStart(3, '0')}.png`));
  }
  groups.push({ label: `걷기 ${d.name}`, kind: 'walk', dir: d, frames });
}

const F = groups[0].frames[0].w;
if (groups.some((g) => g.frames.some((f) => f.w !== F || f.h !== F))) {
  throw new Error('프레임이 정사각·같은 크기가 아니다');
}

// ── 정렬 ──────────────────────────────────────────────────────────
//
// 세로 기준은 묶음 안에서 **가장 낮게 내려온 발**이다. 걷는 동안 두 발이 다 땅에 닿는
// 순간이 있고, 그 순간이 곧 땅 높이다. 평균이나 중앙값을 쓰면 묶음마다 반동의 위상이
// 달라 땅이 어긋난다.

for (const g of groups) {
  g.boxes = g.frames.map(bbox);
  g.footRaw = Math.max(...g.boxes.map((b) => b.y1));
  g.cxRaw = g.boxes.reduce((a, b) => a + (b.x0 + b.x1) / 2, 0) / g.boxes.length;
}

/** 모든 묶음이 공유할 땅 높이 — 어느 것도 위로 잘리지 않게 가장 낮은 발에 맞춘다. */
const FOOT_Y = Math.max(...groups.map((g) => g.footRaw));
const CENTER_X = F / 2;

for (const g of groups) {
  g.dy = FOOT_Y - g.footRaw;
  g.dx = Math.round(CENTER_X - g.cxRaw);
  g.out = g.frames.map((f) => shift(f, g.dx, g.dy));
}

// ── 쓰기 ──────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });
const idle = groups.filter((g) => g.kind === 'idle').flatMap((g) => g.out);
const walk = groups.filter((g) => g.kind === 'walk').flatMap((g) => g.out);

const idleSheet = strip(idle);
const walkSheet = strip(walk);
fs.writeFileSync(path.join(OUT_DIR, 'player-idle.png'), encodePng(idleSheet.w, idleSheet.h, idleSheet.data));
fs.writeFileSync(path.join(OUT_DIR, 'player-walk.png'), encodePng(walkSheet.w, walkSheet.h, walkSheet.data));

// ── 보고 ──────────────────────────────────────────────────────────

console.log(`프레임 ${F}×${F} · 땅 높이 y=${FOOT_Y}\n`);
console.log(`${'묶음'.padEnd(12)} ${'옮긴 양'.padStart(10)} ${'발 y'.padStart(8)} ${'키'.padStart(5)}`);
for (const g of groups) {
  const b = g.out.map(bbox);
  const feet = b.map((x) => x.y1);
  const hs = b.map((x) => x.y1 - x.y0);
  console.log(
    `${g.label.padEnd(12)} ${`x${g.dx >= 0 ? '+' : ''}${g.dx} y${g.dy >= 0 ? '+' : ''}${g.dy}`.padStart(10)} ` +
      `${`${Math.min(...feet)}~${Math.max(...feet)}`.padStart(8)} ${String(Math.max(...hs)).padStart(5)}`,
  );
}

// 씬이 쓸 값. 원점은 땅(발), 인물 높이는 **정면 걷기** 기준이다 — 옆모습은 머리
// 실루엣이 좁아 몇 px 낮게 잡히는데, 그걸 기준으로 삼으면 정면이 그만큼 커진다.
const front = groups.find((g) => g.kind === 'walk' && g.dir.name === 'down');
const frontBoxes = front.out.map(bbox);
const contentHeight = FOOT_Y - Math.min(...frontBoxes.map((b) => b.y0));
console.log(`\n→ ${OUT_DIR}/player-idle.png  ${idleSheet.w}×${idleSheet.h}  (${idle.length}프레임: 아래·위·왼·오)`);
console.log(`→ ${OUT_DIR}/player-walk.png  ${walkSheet.w}×${walkSheet.h}  (${walk.length}프레임: 방향마다 ${WALK_FRAMES}장)`);
console.log('\n씬에 적을 값:');
console.log(`  PLAYER_ORIGIN_Y      = ${FOOT_Y} / ${F}`);
console.log(`  PLAYER_CONTENT_HEIGHT = ${contentHeight}`);
console.log(`  프레임 크기(frameSize) = ${F}`);

if (process.argv.includes('--debug')) {
  // 상체 롤링 실측 — 예전 시트를 갈아엎은 이유가 이것이라 매번 확인한다.
  console.log('\n좌우 흔들림 (걷는 동안 부위별 가로 중심의 진폭):');
  for (const g of groups.filter((x) => x.kind === 'walk')) {
    const band = (img, lo, hi) => {
      const b = bbox(img);
      const h = b.y1 - b.y0;
      let sum = 0, n = 0;
      for (let y = Math.round(b.y0 + h * lo); y < Math.round(b.y0 + h * hi); y++) {
        for (let x = 0; x < F; x++) {
          if (img.data[(y * F + x) * 4 + 3] >= ALPHA) { sum += x; n++; }
        }
      }
      return n ? sum / n : null;
    };
    const amp = (lo, hi) => {
      const v = g.out.map((f) => band(f, lo, hi)).filter((x) => x !== null);
      return Math.max(...v) - Math.min(...v);
    };
    const h = Math.max(...g.out.map((f) => { const b = bbox(f); return b.y1 - b.y0; }));
    console.log(
      `  ${g.label.padEnd(10)} 머리 ${amp(0, 0.25).toFixed(1)}px (키의 ${((amp(0, 0.25) / h) * 100).toFixed(1)}%) · ` +
        `가슴 ${amp(0.25, 0.5).toFixed(1)} · 허리 ${amp(0.5, 0.75).toFixed(1)} · 다리 ${amp(0.75, 1).toFixed(1)}`,
    );
  }
  console.log('  (참고: 예전 시트는 머리가 키의 7.4% — 그것 때문에 갈아엎었다. 사람은 1~2%)');
}
