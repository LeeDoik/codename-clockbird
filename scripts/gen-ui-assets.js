/**
 * PixelLab API → 검문 조우 무대 UI 부품 굽기 — 코드네임: 태엽새
 *
 *   node scripts/gen-ui-assets.js --list          어떤 부품이 있는지만 본다
 *   node scripts/gen-ui-assets.js --dry --all     보낼 요청을 찍어만 본다 (돈 안 든다)
 *   node scripts/gen-ui-assets.js --all           전부 굽는다
 *   node scripts/gen-ui-assets.js stage-frame needle
 *
 * 부품 표(치수·프롬프트·팔레트)는 ui-assets.js 다. 이 파일은 그것을 API 에 보내고
 * 받아 적는 일만 한다. 받은 것을 쓸 수 있게 다듬는 것은 import-ui-assets.js 몫이다.
 *
 * 출력: design/UI/pixellab-out/<id>.png             검수용 원본
 *       design/UI/pixellab-out/<id>.preview8x.png   8배 확대본 (.gitignore 가 거른다)
 *
 * ── 왜 웹 UI 가 아니라 API 인가 ──
 *
 * NPC 스프라이트는 PixelLab 웹앱에서 손으로 뽑아 design/NPC/pixellab/ 에 내려받았다
 * (import-npc-sprites.js 참고). 그쪽은 인물 15명을 한 번 뽑고 끝나는 일이었다.
 *
 * 무대 부품은 반대다. 17개가 **한 화면에 같이 놓이므로** 하나만 톤이 어긋나도
 * 티가 나고, 그때 고치는 방법은 그 하나만 다시 굽는 것이다. 손으로 하면 열 번을
 * 다시 눌러야 하고 그때마다 옵션을 똑같이 맞췄는지 확신할 수 없다. 여기 적어 두면
 * `node scripts/gen-ui-assets.js needle` 한 줄이 되고, 프롬프트는 파일에 남는다.
 *
 * ── 화풍은 style_image 가 아니라 팔레트로 붙잡는다 ──
 *
 * 처음엔 bitforge 로 갔다. `style_image` 에 이미 게임에 박혀 있는
 * `public/ui/dialogue-frame.png` 을 물리면 대화창과 금속 톤이 갈리지 않을 거라고
 * 봤다 (pixellab-ui-prompts.md §6 이 적어 둔 "2차 이후는 1차 결과를 올린다"의 코드판).
 *
 * **틀렸다. bitforge 는 화풍이 아니라 배치를 베낀다.** 액자를 기준으로 주었더니
 * 톱니가 좌상단에만 박히고 오른쪽·아래 변이 빈 그림이 나왔다 — 기준 그림의 구도를
 * 그대로 옮긴 것이다. 9분할 액자는 네 변이 대칭이어야 하므로 그대로는 못 쓴다.
 * (거기까지 가는 길에 두 번 더 헛디뎠다. style_image 는 image_size 와 한 픽셀도
 * 다르면 500 을 내고, 액자는 64.9% 가 투명이라 가운데를 오리면 빈 그림이 된다.)
 *
 * 지금은 **pixflux + color_image** 한 갈래다. 색은 팔레트 그림이 붙잡고 형태는
 * 프롬프트가 정한다. 색을 글로 적는 것은 안 먹힌다 — `deep sealing-wax red #a03325`
 * 라고 못박고 negative 에 `bright, glossy` 까지 넣은 경고 삼각형이 형광 빨강에
 * 광택을 달고 나왔다. hex 는 모델에게 그냥 낱말이다. 그림으로 줘야 한다.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { encodePng, decodePng } from './png.js';
import { PALETTES, ASSETS } from './ui-assets.js';

const API = process.env.PIXELLAB_BASE_URL ?? 'https://api.pixellab.ai/v1';
const OUT_DIR = 'design/UI/pixellab-out';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const picked = argv.filter((a) => !a.startsWith('--'));

if (flags.has('--list')) {
  for (const a of ASSETS) {
    const size = `${a.size.width}×${a.size.height}`;
    console.log(`${a.id.padEnd(16)} ${size.padEnd(9)} ${a.palette.padEnd(6)} ${a.label}`);
  }
  process.exit(0);
}

const todo = flags.has('--all')
  ? ASSETS
  : picked.map((id) => {
    const a = ASSETS.find((x) => x.id === id);
    if (!a) {
      console.error(`모르는 부품: ${id}\n--list 로 목록을 봐라.`);
      process.exit(1);
    }
    return a;
  });

if (todo.length === 0) {
  console.error('무엇을 구울지 골라라 — 부품 id 를 적거나 --all 을 붙인다. --list 로 목록을 본다.');
  process.exit(1);
}

/**
 * 키는 두 이름을 다 받는다.
 *
 * `PIXELLAB_SECRET` 은 공식 SDK 가 쓰는 이름이고(나중에 SDK 로 갈아타도 그대로다),
 * `PIXELLAB_API_KEY` 는 이 저장소 .env 의 `ANTHROPIC_API_KEY` 와 맞춘 이름이다.
 * 둘 중 하나만 있으면 된다 — 이름 하나 때문에 .env 를 고치게 만들지 않는다.
 */
const SECRET = process.env.PIXELLAB_SECRET ?? process.env.PIXELLAB_API_KEY;
if (!SECRET && !flags.has('--dry')) {
  console.error('PixelLab 키가 없다. .env 에 넣어라:\n\n  PIXELLAB_API_KEY=<키>\n');
  process.exit(1);
}

/** 묶음마다 한 번만 만든다. */
const paletteCache = new Map();

/**
 * 팔레트를 그림 한 장으로 만든다 (한 색이 한 줄).
 *
 * 모델은 이 그림에서 **쓰인 색만** 읽는다 — 배치가 아니라 목록이다. 그래서
 * 가로세로가 색 수와 같기만 하면 되고 어떤 모양이든 상관없다.
 */
function paletteImage(kind) {
  if (paletteCache.has(kind)) return paletteCache.get(kind);
  const colors = PALETTES[kind];
  if (!colors) throw new Error(`모르는 팔레트: ${kind}`);
  const n = colors.length;
  const px = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(colors[y].slice(i, i + 2), 16));
    for (let x = 0; x < n; x++) {
      const d = (y * n + x) * 4;
      px[d] = r; px[d + 1] = g; px[d + 2] = b; px[d + 3] = 255;
    }
  }
  const img = { type: 'base64', base64: encodePng(n, n, px).toString('base64'), format: 'png' };
  paletteCache.set(kind, img);
  return img;
}

function body(asset) {
  return {
    description: asset.description,
    negative_description: asset.negative,
    image_size: asset.size,
    text_guidance_scale: 8,
    color_image: paletteImage(asset.palette),
    ...asset.opts,
  };
}

/** v2 는 잔액 단위가 다르다 — 아래 balance() 주석 참고. */
const API2 = process.env.PIXELLAB_BASE_URL_V2 ?? 'https://api.pixellab.ai/v2';
const auth = { Authorization: `Bearer ${SECRET}` };
const authJson = { ...auth, 'Content-Type': 'application/json' };

/**
 * 잔액.
 *
 * ⚠ **달러가 아니라 `generations` 다.** v1 의 /balance 는 USD 크레딧만 보여 줘서
 *   매 호출이 `$0.0000` 으로 찍혔고, 그래서 한동안 "요금이 안 붙는다"고 오해했다.
 *   실제로는 구독 풀(Tier 1 = 월 2000)에서 깎인다. v2 의 /balance 가 둘 다 준다.
 *
 *   표준(pixflux) 한 장은 1~2, **Pro 한 장은 20** 이다. Pro 를 함부로 돌리면
 *   한 달 치가 스물몇 장에 사라진다.
 */
async function balance() {
  const r = await fetch(`${API2}/balance`, { headers: auth });
  if (!r.ok) throw new Error(`잔액 조회 실패 ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return { usd: j.credits?.usd ?? 0, gen: j.subscription?.generations ?? 0, plan: j.subscription?.plan ?? '' };
}

/**
 * Pro 로 굽는다 (v2 `/generate-image-v2`).
 *
 * 표준(v1 pixflux)과 다른 점이 셋이고, 셋 다 프롬프트 쓰는 법을 바꾼다.
 *
 *   1. **비동기다.** 202 로 job id 만 오고, `/background-jobs/{id}` 를 물어봐야 한다.
 *      한 장에 1~2분 걸린다 (표준은 10초 안쪽).
 *   2. **negative_description 도 color_image 도 안 받는다.** 표준에서 색을 붙잡던
 *      팔레트 그림이 여기엔 없다 — 색·금지 사항을 전부 description 안에 적어야 한다.
 *   3. 그림이 `last_response.images[0]` 에 있다 (v1 은 `image`).
 *
 * 512×512 까지 되지만 171px 이상이면 어차피 한 장만 나온다 (그 아래는 여러 장을
 * 격자로 묶어 준다). 부품 하나를 원하는 것이므로 늘 171 이상으로 잡는다.
 */
async function generatePro(asset) {
  const req = {
    description: asset.description,
    image_size: asset.size,
    ...(asset.opts?.no_background ? { no_background: true } : {}),
  };
  const r = await fetch(`${API2}/generate-image-v2`, {
    method: 'POST', headers: authJson, body: JSON.stringify(req),
  });
  if (!r.ok) throw new Error(`${asset.id}: HTTP ${r.status}\n${(await r.text()).slice(0, 600)}`);
  const { background_job_id: id } = await r.json();

  // 4초 간격으로 최대 4분. 그보다 오래 걸리면 뭔가 잘못된 것이라 붙잡고 있을 이유가 없다.
  for (let i = 0; i < 60; i++) {
    await new Promise((s) => setTimeout(s, 4000));
    const j = await fetch(`${API2}/background-jobs/${id}`, { headers: auth });
    if (!j.ok) continue;
    const o = await j.json();
    if (o.status === 'completed') {
      const b64 = o.last_response?.images?.[0]?.base64;
      if (!b64) throw new Error(`${asset.id}: 끝났다는데 그림이 없다\n${JSON.stringify(o).slice(0, 400)}`);
      return { png: Buffer.from(b64, 'base64'), gen: o.usage?.generations ?? 0 };
    }
    if (o.status === 'failed' || o.status === 'error') {
      throw new Error(`${asset.id}: 작업 실패\n${JSON.stringify(o).slice(0, 400)}`);
    }
  }
  throw new Error(`${asset.id}: 4분이 지나도 안 끝났다 (job ${id})`);
}

async function generate(asset) {
  if (asset.model === 'pro') return generatePro(asset);
  const r = await fetch(`${API}/generate-image-pixflux`, {
    method: 'POST', headers: authJson, body: JSON.stringify(body(asset)),
  });
  if (!r.ok) {
    // 402 는 잔액 부족, 422 는 치수가 규격을 벗어난 것, 500 은 딸려 보낸 그림의
    // 크기가 안 맞는 것이다 — 본문을 그대로 보여 줘야 어느 쪽인지 바로 안다.
    throw new Error(`${asset.id}: HTTP ${r.status}\n${(await r.text()).slice(0, 600)}`);
  }
  const json = await r.json();
  return { png: Buffer.from(json.image.base64, 'base64'), gen: json.usage?.generations ?? 1 };
}

/**
 * 8배 확대본을 나란히 남긴다 (`<id>.preview8x.png`).
 *
 * 부품이 48~320px 라 1:1 로는 리벳이 붙었는지 테두리가 균일한지 눈으로 못 고른다.
 * 확대는 **최근접**이어야 한다 — 부드럽게 늘리면 없는 중간색이 생겨 "색이 뭉갰다"
 * 를 그림 탓으로 오해한다. 파일 이름은 .gitignore 가 이미 거르는 규칙에 맞췄다.
 */
function writePreview(id, png) {
  const { w, h, data } = decodePng(png);
  const S = 8;
  const out = new Uint8ClampedArray(w * S * h * S * 4);
  for (let y = 0; y < h * S; y++) {
    for (let x = 0; x < w * S; x++) {
      const s = (Math.floor(y / S) * w + Math.floor(x / S)) * 4;
      const d = (y * w * S + x) * 4;
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, `${id}.preview8x.png`), encodePng(w * S, h * S, out));
}

fs.mkdirSync(OUT_DIR, { recursive: true });

if (flags.has('--dry')) {
  for (const a of todo) {
    const b = body(a);
    b.color_image = `<${a.palette} 팔레트 ${PALETTES[a.palette].length}색>`;
    console.log(`\n── ${a.id} — ${a.label}`);
    console.log(JSON.stringify(b, null, 2));
  }
  process.exit(0);
}

let spent = 0;
const before = await balance();
const pro = todo.filter((a) => a.model === 'pro').length;
console.log(`${before.plan} · 남은 generations ${before.gen} (USD 크레딧 $${before.usd.toFixed(2)})`);
console.log(`${todo.length}개를 굽는다${pro ? ` — 그중 Pro ${pro}장 (한 장 20 generations · 1~2분)` : ''}\n`);

for (const a of todo) {
  process.stdout.write(`${a.id.padEnd(16)} `);
  try {
    // 한 장씩 순서대로 — 동시에 쏘면 429 가 나고, 어느 것이 실패했는지도 흐려진다.
    const { png, gen } = await generate(a);
    fs.writeFileSync(path.join(OUT_DIR, `${a.id}.png`), png);
    writePreview(a.id, png);
    spent += gen;
    console.log(`✔ ${a.size.width}×${a.size.height}  ${gen} gen`);
  } catch (err) {
    console.log('✘');
    console.error(`   ${err.message}\n`);
  }
}

console.log(`\n이번에 쓴 generations ${spent} · 남은 ${before.gen - spent}`);
console.log(`받은 그림: ${OUT_DIR}/  —  <id>.preview8x.png 로 확대해 보고 고른다.`);
console.log('통과한 것만 반입한다:  node scripts/import-ui-assets.js');
console.log('다시 굽는 것은 프롬프트를 고치지 말고 그대로 굴려라 — 문장을 손대면 부품끼리 화풍이 갈린다.');
