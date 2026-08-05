/**
 * PixelLab 결과 → 쓸 수 있는 UI 부품 — 코드네임: 태엽새
 *
 *   node scripts/import-ui-assets.js            전부 굽고 public/ui/ 로 넣는다
 *   node scripts/import-ui-assets.js --dry      무엇이 어떻게 잘리는지 표로만 본다
 *   node scripts/import-ui-assets.js needle     한 장만
 *
 * 원본: design/UI/pixellab-out/<id>.png   (gen-ui-assets.js 가 받아 둔 것)
 * 출력: public/ui/<id>.png                (코드가 /ui/<id>.png 로 부른다)
 *
 * ── 왜 그냥 복사하지 않는가 ──
 *
 * 두 가지가 받은 그대로는 안 맞는다.
 *
 * 1. **배경이 불투명하게 온다.** `no_background: true` 를 줬는데도 인물·로봇처럼
 *    큰 그림은 회갈색 판을 깔고 나온다 (17장 중 5장이 그랬다). 그대로 얹으면
 *    무대 위에 네모난 판이 뜬다.
 * 2. **여백이 제각각이다.** 같은 부품을 다시 구우면 물건이 프레임 안에서 몇 픽셀씩
 *    옮겨 앉는다. CSS 로 위치를 맞춰 둔 뒤 다시 구우면 그만큼 어긋난다 —
 *    NPC 스프라이트에서 이미 겪은 함정이라(import-npc-sprites.js §왜 다시 굽는가)
 *    여기서도 **내용물에 딱 맞춰** 잘라 원점을 하나로 만든다.
 *
 * ── 배경을 어떻게 가려내는가 ──
 *
 * **가장자리에서 흘려보낸다** (flood fill). "가장 많이 쓰인 색을 지운다" 는 못 쓴다 —
 * 로봇은 몸통이 화면의 절반이라 몸이 지워진다. 배경은 정의상 **테두리에 닿아
 * 있는 한 덩어리**이고, 그림은 (대개) 안 닿아 있다.
 *
 * 그래서 네 변의 픽셀에서 출발해 비슷한 색으로만 번져 나간다. 인물의 발이 아래
 * 변에 닿아 있어도, 발 색이 배경색과 다르면 거기서 번짐이 멈춘다.
 *
 * 허용 오차(TOL)가 필요한 이유는 배경이 단색이 아니기 때문이다 — 모델이 옅은
 * 노이즈를 깔아서 같은 배경 안에서도 채널당 몇 단계씩 흔들린다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, encodePng } from './png.js';
import { ASSETS } from './ui-assets.js';

const SRC_DIR = 'design/UI/pixellab-out';
const OUT_DIR = 'public/ui';

/**
 * 배경으로 인정할 색 차이 (채널당).
 *
 * 24 는 실측으로 잡았다. 12 면 노이즈 낀 배경이 얼룩덜룩 남고, 40 을 넘기면
 * 로봇의 어두운 다리가 배경으로 딸려 나간다.
 */
const TOL = 24;

/**
 * 이미 투명한 그림은 건드리지 않는다.
 *
 * hit-burst 처럼 `no_background` 가 제대로 먹은 판은 배경이 이미 알파 0 이다.
 * 거기에 flood fill 을 또 돌리면 폭발의 옅은 바깥 불티까지 배경으로 읽혀 깎인다.
 */
const ALREADY_CUT = 0.12; // 테두리의 이 비율 이상이 투명하면 손대지 않는다

function cutBackground(img) {
  const { w, h, data } = img;

  // 테두리가 이미 투명한가?
  let edge = 0, edgeClear = 0;
  const edgePixels = [];
  for (let x = 0; x < w; x++) { edgePixels.push([x, 0], [x, h - 1]); }
  for (let y = 1; y < h - 1; y++) { edgePixels.push([0, y], [w - 1, y]); }
  for (const [x, y] of edgePixels) {
    edge++;
    if (data[(y * w + x) * 4 + 3] < 16) edgeClear++;
  }
  if (edgeClear / edge > ALREADY_CUT) return { cut: 0, skipped: true };

  // 배경색은 네 모서리의 중앙값으로 잡는다. 한 모서리만 보면 거기 마침 물건이
  // 걸쳐 있을 때 그 색을 배경으로 오인한다.
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]
    .map(([x, y]) => { const s = (y * w + x) * 4; return [data[s], data[s + 1], data[s + 2]]; });
  const bg = [0, 1, 2].map((k) => corners.map((c) => c[k]).sort((a, b) => a - b)[1]);

  const near = (i) => Math.abs(data[i] - bg[0]) <= TOL
    && Math.abs(data[i + 1] - bg[1]) <= TOL
    && Math.abs(data[i + 2] - bg[2]) <= TOL;

  // 4방향 flood fill. 재귀 대신 스택 — 320×264 면 최악에 8만 칸이라 재귀는 넘친다.
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (const [x, y] of edgePixels) {
    const p = y * w + x;
    if (!seen[p] && near(p * 4)) { seen[p] = 1; stack.push(p); }
  }
  let cut = 0;
  while (stack.length) {
    const p = stack.pop();
    const x = p % w, y = (p / w) | 0;
    data[p * 4 + 3] = 0;
    cut++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (seen[q] || !near(q * 4)) continue;
      seen[q] = 1;
      stack.push(q);
    }
  }
  return { cut, skipped: false };
}

/** 투명 여백을 잘라 내용물에 딱 맞춘다. 전부 투명이면 원본을 그대로 돌려준다. */
function trim(img) {
  const { w, h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 16) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return img;
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1;
  if (nw === w && nh === h) return img;
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const src = ((y + y0) * w + x0) * 4;
    out.set(data.subarray(src, src + nw * 4), y * nw * 4);
  }
  return { w: nw, h: nh, data: out };
}

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const picked = argv.filter((a) => !a.startsWith('--'));

if (!fs.existsSync(SRC_DIR)) {
  console.error(`${SRC_DIR} 이 없다. 먼저 굽는다:\n\n  node scripts/gen-ui-assets.js --all\n`);
  process.exit(1);
}

// 표를 도는 것이지 폴더를 훑는 것이 아니다 — `opaque` 같은 부품별 규칙이 표에만
// 있고, 폴더에는 아직 안 지운 실패작이 섞여 있을 수 있다.
const todo = ASSETS
  .filter((a) => picked.length === 0 || picked.includes(a.id))
  .filter((a) => fs.existsSync(path.join(SRC_DIR, `${a.id}.png`)));

if (todo.length === 0) {
  console.error(`반입할 그림이 없다. 먼저 굽는다:\n\n  node scripts/gen-ui-assets.js --all\n`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
console.log(`${'부품'.padEnd(18)}${'원본'.padEnd(12)}${'→ 결과'.padEnd(14)}배경`);

for (const a of todo) {
  const img = decodePng(fs.readFileSync(path.join(SRC_DIR, `${a.id}.png`)));
  const was = `${img.w}×${img.h}`;
  let note;
  let out = img;
  if (a.opaque) {
    // 판 전체가 그림이다. 벗기면 하늘과 안개가 배경으로 읽혀 통째로 날아간다.
    note = '판째 그림 — 안 건드림';
  } else {
    const { cut, skipped } = cutBackground(img);
    out = trim(img);
    note = skipped ? '이미 투명' : `${((100 * cut) / (img.w * img.h)).toFixed(0)}% 벗김`;
    // 거의 다 벗겨졌다면 배경색과 몸통색이 같았다는 뜻이다 — 살아남은 뼈대를
    // 조용히 설치하면 화면에서야 알게 된다. 여기서 소리를 낸다.
    if (!skipped && cut / (img.w * img.h) > 0.9) note += '  ⚠ 몸통까지 먹혔을 수 있다 — 확인해라';
  }
  console.log(`${a.id.padEnd(18)}${was.padEnd(12)}${`${out.w}×${out.h}`.padEnd(14)}${note}`);
  if (!dry) fs.writeFileSync(path.join(OUT_DIR, `${a.id}.png`), encodePng(out.w, out.h, out.data));
}

if (dry) console.log('\n--dry 라 아무것도 쓰지 않았다.');
else console.log(`\n${OUT_DIR}/ 에 넣었다.`);
