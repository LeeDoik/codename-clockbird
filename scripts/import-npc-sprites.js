/**
 * PixelLab 내보내기 → NPC 정지 스프라이트 — 코드네임: 태엽새
 *
 *   node scripts/import-npc-sprites.js
 *
 * 원본: design/NPC/pixellab/<이름>/Idle/rotations/south.png
 * 출력: src/client/assets/npc/<게임 id>-south.png
 *
 * ── 왜 남향 한 장뿐인가 ──
 *
 * 본부 NPC 는 게임 안에서 한 발짝도 움직이지 않는다 (TutorialScene 이 제자리에
 * 세워두고 말만 건다). 걷기 프레임은 쓸 곳이 없고, 방향도 남향 하나면 된다.
 * 그래서 PixelLab 에서도 rotations 만 받았다 — 애니메이션까지 받으면 크레딧이
 * 몇 배로 든다. design/NPC/pixellab-prompts.md §1 에 그 판단이 적혀 있다.
 *
 * ── 왜 그냥 복사하지 않고 다시 굽는가 ──
 *
 * 내보낸 그대로는 **인물마다 프레임 크기도 발 높이도 다르다** (실측: 브란트 196칸에
 * 발 142 · 토마스 196칸에 143 · 리아 200칸에 146). 원점을 하나로 못 쓰니 씬에서
 * 인물마다 숫자를 따로 들고 있어야 하고, 한 명만 틀려도 그 사람만 땅에서 뜬 채
 * 들어가 봐야 안다 — 플레이어 시트에서 이미 겪은 함정이다.
 *
 * 그래서 **공통 프레임에 공통 땅 높이로 다시 앉힌다**. 그러면 씬이 드는 값은
 * 원점 하나(모두 공유) + 인물 키(사람마다 다름)뿐이다.
 *
 * 가로는 **프레임 중심을 그대로 유지**한다. 경계상자 중심에 맞추면 안 된다 —
 * 리아는 오른손의 렌치가 상자를 오른쪽으로 늘려서, 상자 기준으로 가운데를 맞추면
 * 몸통이 왼쪽으로 밀린다. PixelLab 은 이미 몸을 프레임 한가운데에 그려준다.
 *
 * 이동은 전부 **정수 픽셀 평행이동**이다. 늘리거나 줄이지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, encodePng } from './png.js';

const SRC_DIR = 'design/NPC/pixellab';
const OUT_DIR = 'src/client/assets/npc';

/**
 * 내보내기 폴더 → 게임 id.
 *
 * id 의 출처는 src/data/tutorial.json 이다. t1·t2·t3 은 **담당 축에 묶인 키**이지
 * 인물 이름이 아니다 — t1 색상 · t2 분류 · t3 특징.
 *
 * ⚠ 2026-08-04 에 인물을 한 칸씩 옮겼다. 기획 설정서가 담당 축을 인물마다 못박아
 *   두었는데(에이다 색상 · 토마스 분류 · 리아 특징) 예전 대응은 그와 어긋나 있었다
 *   — t1(색상)에 리아가, t3(특징)에 토마스가 서 있었다. 축을 옮기면 tutorial.json 의
 *   힌트 아홉 줄을 전부 다시 써야 하므로 인물 쪽을 옮겼다.
 */
const CHARACTERS = [
  { dir: '브란트', id: 'officer', label: '브란트 → 간부' },
  { dir: '에이다', id: 't1', label: '에이다 → 경리(색상)' },
  { dir: '토마스', id: 't2', label: '토마스 → 총무(분류)' },
  { dir: '리아', id: 't3', label: '리아 → 정비공(특징)' },
];

/** 알파가 이보다 진해야 인물로 친다 — 가장자리 반투명 픽셀에 경계상자가 끌려가지 않게. */
const ALPHA = 96;

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

/** 원본을 F×F 캔버스의 (dx, dy) 에 정수 평행이동으로 앉힌다. */
function place(img, F, dx, dy) {
  const out = new Uint8ClampedArray(F * F * 4);
  const { w, h, data } = img;
  for (let y = 0; y < h; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= F) continue;
    for (let x = 0; x < w; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= F) continue;
      const s = (y * w + x) * 4;
      const d = (ty * F + tx) * 4;
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
    }
  }
  return { w: F, h: F, data: out };
}

// ── 읽기 ──────────────────────────────────────────────────────────

for (const c of CHARACTERS) {
  const p = path.join(SRC_DIR, c.dir, 'Idle/rotations/south.png');
  if (!fs.existsSync(p)) throw new Error(`내보내기가 없다: ${p}`);
  c.src = decodePng(fs.readFileSync(p));
  if (c.src.w !== c.src.h) throw new Error(`${c.dir}: 프레임이 정사각이 아니다 (${c.src.w}×${c.src.h})`);
  c.box = bbox(c.src);
  if (!c.box) throw new Error(`${c.dir}: 빈 그림이다`);
}

// ── 정렬 ──────────────────────────────────────────────────────────
//
// 공통 프레임은 가장 큰 원본에 맞춘다 (줄이면 인물이 잘린다).
// 공통 땅 높이는 프레임 중심에 앉혔을 때 **가장 낮게 내려온 발**에 맞춘다 —
// 그보다 위로 잡으면 그 인물이 프레임 밖으로 밀려 발이 잘린다.

const F = Math.max(...CHARACTERS.map((c) => c.src.w));

for (const c of CHARACTERS) {
  c.dx = Math.round((F - c.src.w) / 2);
  c.footCentered = c.box.y1 + Math.round((F - c.src.h) / 2);
}

const FOOT_Y = Math.max(...CHARACTERS.map((c) => c.footCentered));
/** 발이 닿는 선은 마지막 불투명 행의 **한 줄 아래**다 — 거기가 땅이다. */
const GROUND_Y = FOOT_Y + 1;

for (const c of CHARACTERS) {
  c.dy = FOOT_Y - c.box.y1;
  c.out = place(c.src, F, c.dx, c.dy);
  c.outBox = bbox(c.out);
  c.contentHeight = GROUND_Y - c.outBox.y0;
}

// ── 쓰기 ──────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const c of CHARACTERS) {
  c.file = path.join(OUT_DIR, `${c.id}-south.png`);
  fs.writeFileSync(c.file, encodePng(F, F, c.out.data));
}

// ── 보고 ──────────────────────────────────────────────────────────

console.log(`공통 프레임 ${F}×${F} · 땅 높이 y=${GROUND_Y}\n`);
console.log(`${'인물'.padEnd(22)} ${'원본'.padStart(6)} ${'옮긴 양'.padStart(9)} ${'발 y'.padStart(5)} ${'키'.padStart(4)}`);
for (const c of CHARACTERS) {
  console.log(
    `${c.label.padEnd(22)} ${`${c.src.w}칸`.padStart(6)} ` +
      `${`x+${c.dx} y+${c.dy}`.padStart(9)} ${String(c.outBox.y1).padStart(5)} ${String(c.contentHeight).padStart(4)}`,
  );
}

for (const c of CHARACTERS) {
  console.log(`\n→ ${c.file}  ${F}×${F}`);
}

console.log('\nsrc/client/entities/npcSprite.js 에 적을 값:');
console.log(`  NPC_FRAME_SIZE = ${F}`);
console.log(`  NPC_ORIGIN_Y   = ${GROUND_Y} / ${F}`);
console.log('  NPC_CONTENT_HEIGHT = {');
for (const c of CHARACTERS) console.log(`    ${c.id}: ${c.contentHeight},`);
console.log('  }');
