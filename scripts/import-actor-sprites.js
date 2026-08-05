/**
 * PixelLab 내보내기 → **걸어다니는 것**의 스프라이트 시트 — 코드네임: 태엽새
 *
 *   node scripts/import-actor-sprites.js [player|robot|sentry|eva] [--debug]
 *
 * 원본: PixelLab 내보내기 그대로 (rotations/ 에 방향별 대기 1장씩,
 *   animations/<걷기>/<방향>/ 에 걷기 8장씩). 프레임 크기는 인물마다 다르다.
 * 출력: <이름>-idle.png  (4프레임: 아래·위·왼·오)
 *       <이름>-walk.png  (32프레임: 방향마다 8장)
 *
 * 제자리에 서 있기만 하는 NPC 는 여기가 아니라 scripts/import-npc-sprites.js 다 —
 * 그쪽은 남향 한 장씩이고, 여럿을 **공통 프레임 하나**에 함께 앉힌다. 여기서 다루는
 * 것은 방향과 걸음이 있는 것들이라 사람마다 시트가 따로 나온다.
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

/**
 * 구울 대상.
 *
 * `walk` 는 걷기 폴더 이름이다 — PixelLab 이 내보낼 때마다 대소문자가 달라진다
 * (주인공·감시 로봇·에바는 `Walking`, 거리 순찰 로봇만 `walking`). 윈도우에서는 아무거나 열리지만
 * 리눅스에서는 안 열려서, 짐작하지 않고 여기에 적어 둔다.
 */
const ACTORS = {
  player: {
    src: 'design/Player/pixellab/Idle',
    out: 'src/client/assets/player',
    name: 'player',
    walk: 'Walking',
    spec: 'src/client/entities/playerSprite.js',
  },
  robot: {
    // 거리(스테이지 1) 순찰 로봇 — 놋쇠 증기 자동인형.
    src: 'design/NPC/pixellab3/경비로봇/Idle',
    out: 'src/client/assets/npc',
    name: 'robot',
    walk: 'walking',
    spec: 'src/client/entities/robotSprite.js',
  },
  sentry: {
    // 탈출(스테이지 3) 감시 로봇 — 검은 장갑에 붉은 센서. 거리 것보다 험한 물건이다.
    src: 'design/NPC/pixellab4/경비로봇/Idle',
    out: 'src/client/assets/npc',
    name: 'sentry',
    walk: 'Walking',
    spec: 'src/client/entities/sentrySprite.js',
  },
  eva: {
    // 탈출(스테이지 3) 심문 상대. 제자리에 서 있기만 하는 것이 아니라 **플레이어 앞까지
    // 걸어온다** — 그래서 NPC 가 아니라 여기(걸어다니는 것) 쪽이다.
    src: 'design/NPC/pixellab4/에바/Idle',
    out: 'src/client/assets/npc',
    name: 'eva',
    walk: 'Walking',
    spec: 'src/client/entities/evaSprite.js',
  },
};

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

/**
 * 프레임들을 `cols` 개씩 끊어 격자로 잇는다 (`cols` 를 안 주면 한 줄).
 *
 * Phaser 는 프레임을 왼→오, 위→아래 순으로 세므로 **몇 칸씩 끊든 프레임 번호는 같다** —
 * 씬 쪽은 손댈 것이 없다. 끊는 이유는 순전히 가로 길이다: GPU 의 최대 텍스처 한 변이
 * 4096 인 기기가 아직 흔하고(휴대폰), 넘으면 그림이 통째로 안 뜬다.
 * 로봇 걷기는 220칸짜리 32장이라 한 줄이면 7040 이 된다.
 */
function grid(frames, cols = frames.length) {
  const F = frames[0].w;
  const rows = Math.ceil(frames.length / cols);
  const w = F * Math.min(cols, frames.length);
  const h = F * rows;
  const out = new Uint8ClampedArray(w * h * 4);
  frames.forEach((img, n) => {
    const ox = (n % cols) * F;
    const oy = ((n / cols) | 0) * F;
    for (let y = 0; y < F; y++) {
      const s = y * F * 4;
      const d = ((oy + y) * w + ox) * 4;
      out.set(img.data.subarray(s, s + F * 4), d);
    }
  });
  return { w, h, data: out };
}

/** 가로 한 변이 이 값을 넘으면 격자로 접는다. 넘는 텍스처는 기기에 따라 아예 안 뜬다. */
const MAX_SHEET_W = 4096;

// ── 읽기 ──────────────────────────────────────────────────────────

const target = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'player';
const actor = ACTORS[target];
if (!actor) {
  console.error(`사용법: node scripts/import-actor-sprites.js [${Object.keys(ACTORS).join('|')}] [--debug]`);
  process.exit(1);
}
const { src: SRC, out: OUT_DIR } = actor;

const groups = [];
for (const d of DIRS) {
  groups.push({ label: `대기 ${d.name}`, kind: 'idle', dir: d, frames: [load(`${SRC}/rotations/${d.key}.png`)] });
}
for (const d of DIRS) {
  const frames = [];
  for (let i = 0; i < WALK_FRAMES; i++) {
    frames.push(load(`${SRC}/animations/${actor.walk}/${d.key}/frame_${String(i).padStart(3, '0')}.png`));
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

// 걷기가 한 줄로 안 들어가면 **방향마다 한 줄**로 접는다 — 8칸씩 네 줄이라
// 그림을 열어 봤을 때도 어느 줄이 어느 방향인지 바로 읽힌다.
const walkCols = F * walk.length > MAX_SHEET_W ? WALK_FRAMES : walk.length;
const idleSheet = grid(idle);
const walkSheet = grid(walk, walkCols);
const idleFile = path.join(OUT_DIR, `${actor.name}-idle.png`);
const walkFile = path.join(OUT_DIR, `${actor.name}-walk.png`);
fs.writeFileSync(idleFile, encodePng(idleSheet.w, idleSheet.h, idleSheet.data));
fs.writeFileSync(walkFile, encodePng(walkSheet.w, walkSheet.h, walkSheet.data));

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
const KEY = actor.name.toUpperCase();
console.log(`\n→ ${idleFile}  ${idleSheet.w}×${idleSheet.h}  (${idle.length}프레임: 아래·위·왼·오)`);
console.log(`→ ${walkFile}  ${walkSheet.w}×${walkSheet.h}  (${walk.length}프레임: 방향마다 ${WALK_FRAMES}장)`);
console.log(`\n${actor.spec} 에 적을 값:`);
console.log(`  ${KEY}_FRAME_SIZE    = ${F}`);
console.log(`  ${KEY}_ORIGIN_Y      = ${FOOT_Y} / ${F}`);
console.log(`  ${KEY}_CONTENT_HEIGHT = ${contentHeight}`);

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
