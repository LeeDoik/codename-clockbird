/**
 * AI 배틀맵 → 게임 배경 — 코드네임: 태엽새
 *
 *   python tools/webp2png.py                      # 원본 webp 를 design/맵/_png/ 로 푼다
 *   node scripts/import-map-art.js <이름> [옵션]   # 워터마크 지우고 칸에 맞춰 잘라 assets 로
 *
 *   --dry <파일>   assets 를 건드리지 않고 결과만 따로 낸다
 *   --compare <파일>  워터마크 처리 전/후를 2배로 확대해 붙인 비교 이미지
 *   --keep-watermark  워터마크는 그대로 두고 자르기만 한다 (자르기만 확인할 때)
 *
 * 하는 일은 셋뿐이고, 순서가 중요하다:
 *
 *   1) **워터마크 지우기** — 생성기가 오른쪽 아래에 구워 넣은 "Meta AI".
 *      상자째 옆에서 베껴 오고 가장자리만 부드럽게 잇는다 (아래 patchCopy).
 *      본부 배경에 썼던 포아송 합성(scripts/clean-hq-watermark.js)을 먼저 시도했는데,
 *      이 그림들에서는 글자 자국이 그대로 비쳐 남았다 — 벽돌·돌담처럼 무늬가 굵고
 *      불규칙하면 기울기만 옮겨서는 그 무늬가 재구성되지 않는다. 넷을 나란히 놓고
 *      눈으로 고른 결과다 (본부 벽은 가로로 균일해서 포아송이 통했다 — 그림이 다르다).
 *   2) **칸에 맞춰 자르기/덧대기** — 월드는 타일 32px 격자라 배경도 32의 배수여야 한다.
 *      맵마다 남는 자투리는 그림 가장자리의 검은 여백이므로, 여백이 있는 쪽에서
 *      잘라 내고 모자라면 검은 띠를 덧댄다 (자세한 값은 아래 MAPS).
 *   3) **크기 보고** — 결과가 몇 칸짜리인지 찍는다. 그 수를 맵 json 의 cols/rows 에 적는다.
 *
 * 맵 json 은 여기서 안 만든다 — 스폰·방·문 좌표는 사람이 그림을 보고 정하는 것이라,
 * 자동 생성물로 덮어쓰면 그 작업이 조용히 날아간다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.js';

const PNG_DIR = 'design/맵/_png';

/**
 * 맵마다의 처리 명세.
 *
 * `crop`/`pad` 는 결과를 32의 배수로 맞추기 위한 것이다. 어느 쪽을 자르고 어느 쪽에
 * 덧댈지는 **검은 여백이 어디에 얼마나 있는지**로 정했다 (그림 안쪽을 자르면 안 된다).
 *
 * `watermark.boxes` 는 실측한 상자다. 자동 탐지는 못 쓴다 — 저택은 바닥이 흰 대리석이라
 * '밝은 무채색' 픽셀이 31만 개나 되고, 거리는 종이·증기가 같은 조건에 걸린다.
 */
const MAPS = {
  street: {
    src: `${PNG_DIR}/steampunk_city_map_1.png`,
    out: 'src/client/assets/street-bg.png',
    // 2240×1120 = 70×35칸. 정확히 나눠떨어져 자를 것이 없다.
    watermark: {
      // 진한 "Meta AI" + 그 왼쪽에 겹쳐 찍힌 옅은 두 번째 각인까지 한 상자로 덮는다.
      boxes: [{ x0: 1840, y0: 1000, x1: 2205, y1: 1080 }],
      // 아래 테두리(돌담 + 검은 띠)는 가로로 반복되는 무늬라 왼쪽에서 떠 와도 이음매가 없다.
      dx: 420,
    },
  },
  mansion: {
    src: `${PNG_DIR}/760826519_2096983204559217_5552567175664447904_n.png`,
    out: 'src/client/assets/mansion-bg.png',
    // 1872×1264 → 1856×1280 = 58×40칸.
    // 가로: 왼쪽 검은 여백이 156px 이라 16px 잘라 낸다.
    // 세로: 위 12px·아래 0px 뿐이라 자르면 현관 포치가 잘린다 — 아래에 16px 덧댄다.
    crop: { left: 16 },
    pad: { bottom: 16 },
    watermark: null, // 이 그림엔 없다 (완성본만 깨끗하다 — 충돌도 쪽엔 있지만 도구 입력이라 상관없다)
    // 걷는 길 초안(walkmask seed)이 볼 도면. **같은 자르기를 거쳐야** 칸이 맞는다 —
    // 왼쪽을 16px 잘라 낸 배경과 안 자른 도면을 나란히 놓으면 반 칸씩 밀린다.
    seedSrc: {
      src: `${PNG_DIR}/mansion_floorplan_collision_map.png`,
      out: 'design/walkmask/src/mansion-collision.png',
    },
  },
  escape: {
    src: `${PNG_DIR}/empty_sewer_map.png`,
    out: 'src/client/assets/escape-bg.png',
    // 1728×1344 = 54×42칸. 정확히 나눠떨어진다.
    watermark: {
      boxes: [{ x0: 1385, y0: 1210, x1: 1660, y1: 1275 }],
      // 아래 벽돌벽이 계속되는 왼쪽에서 떠 온다. 320 도 깨끗하지만 380 쪽이 이음매가
      // 덜 보였다 (네 가지를 나란히 놓고 고름).
      dx: 380,
    },
  },
};

/** 타일 한 변 (월드 격자). 배경은 이 배수여야 한다. */
const TILE = 32;

/** 밝은 무채색 판정 — 워터마크가 남았는지 세는 데만 쓴다(상자 안에서만 본다). */
const LUM = 165;
const CHROMA = 25;
/** 베낀 상자의 가장자리를 원래 그림과 섞는 폭(px). 이음매의 톤 차이를 여기서 눕힌다. */
const FEATHER = 10;

// ── 워터마크 ──────────────────────────────────────────────────────

export const isBright = (px, i, lum = LUM, chroma = CHROMA) => {
  const r = px[i], g = px[i + 1], b = px[i + 2];
  return r > lum && g > lum && b > lum - 5 && Math.max(r, g, b) - Math.min(r, g, b) < chroma;
};

/** 상자 안에 남은 밝은 무채색 픽셀 수 — 지워졌는지 세는 데 쓴다. */
function countBright(px, w, boxes, opt) {
  let n = 0;
  for (const box of boxes) {
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) if (isBright(px, (y * w + x) * 4, opt?.lum, opt?.chroma)) n++;
    }
  }
  return n;
}

/**
 * 워터마크 상자를 (dx 만큼 왼쪽 / dy 만큼 위)의 같은 크기 조각으로 덮는다.
 *
 * 글자 모양대로 오려 메우지 않고 **상자째** 베낀다 — 글자만 메우면 어떤 방법을 써도
 * 그 자리의 원래 밝기가 남아 글자가 비친다. 상자째 갈면 남을 것이 없다.
 * 대신 상자 테두리에 이음매가 생기므로 feather 폭만큼 원래 그림과 섞어 눕힌다.
 *
 * 떠 올 자리는 **같은 재질이 이어지는 곳**이어야 한다 — 셋 다 그림 아래 테두리(돌담·
 * 벽돌벽)라 가로로 밀면 같은 벽이 계속된다. 그 자리에 워터마크가 없는지도 확인한다.
 */
function patchCopy(img, boxes, { dx = 0, dy = 0, feather = FEATHER } = {}) {
  const { w, data } = img;
  const out = Uint8ClampedArray.from(data);
  for (const box of boxes) {
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        const d = (y * w + x) * 4;
        const s = ((y - dy) * w + (x - dx)) * 4;
        const k =
          Math.min(1, Math.min(x - box.x0, box.x1 - x) / feather) *
          Math.min(1, Math.min(y - box.y0, box.y1 - y) / feather);
        for (let ch = 0; ch < 3; ch++) out[d + ch] = data[d + ch] * (1 - k) + data[s + ch] * k;
      }
    }
  }
  return out;
}

// ── 자르기·덧대기 ─────────────────────────────────────────────────

/** 잘라 내고(crop) 덧댄(pad) 새 버퍼. 덧대는 색은 그림 테두리와 같은 검정이다. */
function reframe(img, px, { crop = {}, pad = {} }) {
  const { left = 0, right = 0, top = 0, bottom = 0 } = crop;
  const cw = img.w - left - right;
  const chh = img.h - top - bottom;
  const w = cw + (pad.left ?? 0) + (pad.right ?? 0);
  const h = chh + (pad.top ?? 0) + (pad.bottom ?? 0);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 3; i < out.length; i += 4) out[i] = 255; // 덧댄 띠는 불투명 검정

  const ox = pad.left ?? 0;
  const oy = pad.top ?? 0;
  for (let y = 0; y < chh; y++) {
    const src = ((y + top) * img.w + left) * 4;
    const dst = ((y + oy) * w + ox) * 4;
    out.set(px.subarray(src, src + cw * 4), dst);
  }
  return { w, h, data: out };
}

/** 처리 전/후를 2배로 확대해 위아래로 붙인 비교 이미지. */
function compare(before, after, w, box, file) {
  const M = 24;
  const cx0 = Math.max(0, box.x0 - M), cx1 = box.x1 + M;
  const cy0 = Math.max(0, box.y0 - M), cy1 = box.y1 + M;
  const S = 2, GAP = 6;
  const cw = (cx1 - cx0 + 1) * S, chh = (cy1 - cy0 + 1) * S;
  const out = new Uint8ClampedArray(cw * (chh * 2 + GAP) * 4);
  const put = (px, top) => {
    for (let y = 0; y < chh; y++) {
      for (let x = 0; x < cw; x++) {
        const s = ((cy0 + ((y / S) | 0)) * w + cx0 + ((x / S) | 0)) * 4;
        const d = ((top + y) * cw + x) * 4;
        out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = 255;
      }
    }
  };
  put(before, 0);
  put(after, chh + GAP);
  for (let y = chh; y < chh + GAP; y++) {
    for (let x = 0; x < cw; x++) {
      const d = (y * cw + x) * 4;
      out[d] = 255; out[d + 1] = 0; out[d + 2] = 255; out[d + 3] = 255;
    }
  }
  fs.writeFileSync(file, encodePng(cw, chh * 2 + GAP, out));
  return `${cw}×${chh * 2 + GAP}`;
}

// ── ─────────────────────────────────────────────────────────────

export function importMapArt(name, { dry = null, cmpFile = null, keepWatermark = false, tune = {} } = {}) {
  const cfg = MAPS[name];
  if (!fs.existsSync(cfg.src)) {
    throw new Error(`${cfg.src} 가 없다 — 먼저 'python tools/webp2png.py' 로 원본을 풀어라`);
  }
  const img = decodePng(fs.readFileSync(cfg.src));
  console.log(`${cfg.src}  ${img.w}×${img.h}`);

  let px = Uint8ClampedArray.from(img.data);
  if (cfg.watermark && !keepWatermark) {
    const { boxes, dx = 0, dy = 0, feather, ...opt } = { ...cfg.watermark, ...tune };
    const before = px;
    const had = countBright(before, img.w, boxes, opt);
    // 떠 올 자리에도 워터마크가 있으면 그걸 그대로 옮겨 오게 된다 — 먼저 막는다.
    const srcBoxes = boxes.map((b) => ({ x0: b.x0 - dx, x1: b.x1 - dx, y0: b.y0 - dy, y1: b.y1 - dy }));
    const dirty = countBright(before, img.w, srcBoxes, opt);
    console.log(`  워터마크 픽셀 ${had} · 떠 올 자리(dx=${dx} dy=${dy})의 밝은 픽셀 ${dirty}`);
    if (!had) console.log('  ⚠ 상자 안에서 워터마크를 못 찾았다 — 이미 처리된 파일이거나 상자가 어긋났다');
    // 램프 불빛·종이 같은 밝은 티끌 몇 개는 상관없다. 글자가 통째로 걸린 경우만 막는다.
    const area = boxes.reduce((a, b) => a + (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1), 0);
    if (dirty > area * 0.001) {
      throw new Error(`떠 올 자리에 워터마크로 보이는 픽셀이 ${dirty}개 있다 (상자의 ${(dirty / area * 100).toFixed(1)}%) — dx/dy 를 옮겨라`);
    }

    px = patchCopy({ ...img, data: px }, boxes, { dx, dy, feather });

    // 상자 밖으로 새지 않았는지 — 새면 그림 전체가 조용히 망가진다.
    const inBox = (p) => {
      const x = p % img.w, y = (p / img.w) | 0;
      return boxes.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
    };
    let leak = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] === before[i] && px[i + 1] === before[i + 1] && px[i + 2] === before[i + 2]) continue;
      if (!inBox(i / 4)) leak++;
    }
    if (leak) throw new Error(`베낀 자리가 상자 밖으로 ${leak}픽셀 샜다 — 쓰지 않고 멈춘다`);

    const left = countBright(px, img.w, boxes, opt);
    console.log(`  남은 밝은 무채색 픽셀 ${left} / ${had} (베껴 온 티끌 몇 개는 정상)`);
    if (cmpFile) console.log(`  → ${cmpFile}  (${compare(before, px, img.w, boxes[0], cmpFile)}, 위=처리 전 · 아래=처리 후)`);
    if (left > area * 0.001) throw new Error(`워터마크가 ${left}픽셀 남았다 — 상자를 넓히거나 dx/dy 를 옮겨라`);
  }

  const framed = reframe(img, px, cfg);
  if (framed.w % TILE || framed.h % TILE) {
    throw new Error(
      `자른 결과 ${framed.w}×${framed.h} 가 타일 ${TILE}px 의 배수가 아니다 — MAPS.${name} 의 crop/pad 를 고쳐라`,
    );
  }

  const target = dry || cfg.out;
  // 배경은 불투명하다 — 알파를 버리면(색 타입 2) 파일이 눈에 띄게 준다.
  fs.writeFileSync(target, encodePng(framed.w, framed.h, framed.data, { rgb: true }));
  const kb = (fs.statSync(target).size / 1024).toFixed(0);
  console.log(`→ ${target}  ${framed.w}×${framed.h} = ${framed.w / TILE}×${framed.h / TILE}칸  (${kb}KB)`);
  console.log(`   맵 json 에 적을 값:  "tileSize": ${TILE}, "cols": ${framed.w / TILE}, "rows": ${framed.h / TILE}`);

  // 걷는 길 초안이 볼 도면도 **같은 자르기**로 낸다 (dry 여도 같이 낸다 — 도구 입력이라 assets 를 안 건드린다).
  if (cfg.seedSrc) {
    const s = decodePng(fs.readFileSync(cfg.seedSrc.src));
    if (s.w !== img.w || s.h !== img.h) {
      throw new Error(`${cfg.seedSrc.src} 크기(${s.w}×${s.h})가 배경 원본(${img.w}×${img.h})과 다르다`);
    }
    const sf = reframe(s, s.data, cfg);
    fs.mkdirSync(path.dirname(cfg.seedSrc.out), { recursive: true });
    fs.writeFileSync(cfg.seedSrc.out, encodePng(sf.w, sf.h, sf.data));
    console.log(`→ ${cfg.seedSrc.out}  ${sf.w}×${sf.h}  (걷는 길 초안용 — 같은 자르기)`);
  }
  return framed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith('--'));
  const opt = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  if (!MAPS[name]) {
    console.error(`사용법: node scripts/import-map-art.js <${Object.keys(MAPS).join('|')}> [--dry 파일] [--compare 파일] [--keep-watermark]`);
    process.exit(1);
  }
  try {
    // --dx/--dy 는 메울 무늬를 어디서 떠 올지 눈으로 고를 때만 쓴다 (정하면 MAPS 에 적는다).
    const tune = {};
    if (opt('--dx') !== null) tune.dx = Number(opt('--dx'));
    if (opt('--dy') !== null) tune.dy = Number(opt('--dy'));
    importMapArt(name, {
      dry: opt('--dry'),
      cmpFile: opt('--compare'),
      keepWatermark: args.includes('--keep-watermark'),
      tune,
    });
  } catch (e) {
    console.error(`오류: ${e.message}`);
    process.exit(1);
  }
}
