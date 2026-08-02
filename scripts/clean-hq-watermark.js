/**
 * hq-bg.png 에 구워진 AI 생성기 워터마크("Meta AI")를 지운다.
 *
 * 튜토리얼 본부 배경은 AI 로 뽑은 그림이라 오른쪽 아래 벽 위에 생성기 워터마크가
 * 같이 구워져 나왔다. 게임 화면에 그대로 보이므로 없애야 하는데, 그 자리만 단색으로
 * 칠하면 벽 무늬가 끊겨 오히려 더 눈에 띈다. 그래서 두 가지를 같이 한다:
 *
 *   1) 글자·로고 픽셀만 골라 낸다. 배경 아트는 전부 갈색·회색 계열이라
 *      '밝은 무채색'(r,g,b 다 165 위 + 채널 차이 25 미만) 은 워터마크뿐이다.
 *      반투명 흰색으로 얹혀 있어 글자 둘레 3px 까지 옅은 후광이 남으므로 그만큼 부풀린다.
 *   2) 그 자리를 같은 y 대역의 왼쪽 벽(기본 368px 왼쪽)에서 가져와 메운다.
 *      단순 복사가 아니라 포아송 합성이다 — 원본에서 '기울기'만 빌리고 실제 밝기는
 *      구멍 둘레의 진짜 픽셀에 맞춰 풀어낸다. 그래서 이음매가 안 보이고, 글자가
 *      가리고 있던 벽의 세로 이음새도 위아래 문맥에서 되살아난다.
 *
 *      벽은 가로로는 거의 균일하고(행마다 톤이 정해져 있다) 세로로만 구조가 있다
 *      — 위쪽 벽면 / 밝은 몰딩선(y1178~1182) / 어두운 밑동. 같은 y 를 베껴 오므로
 *      세로 기울기는 그대로 쓰고, 가로 기울기는 큰 것만 버린다. 가로로 큰 기울기 =
 *      원본 쪽 벽돌 이음새인데, 그걸 같이 가져오면 없던 세로줄이 생겨 버린다.
 *
 * 손대는 범위는 워터마크 상자(x1602~1845, y1161~1206)를 3px 부풀린 만큼으로 못 박고,
 * 끝나면 실제로 바뀐 픽셀의 경계상자를 재서 그 밖으로 새지 않았는지 확인한다.
 * 아래쪽 체커무늬 띠(y1209~)는 위상이 어긋나면 바로 티가 나므로 아예 건드리지 않는다.
 *
 *   node scripts/clean-hq-watermark.js                  # 원본을 덮어쓴다
 *   node scripts/clean-hq-watermark.js --dry <낼파일>    # 원본은 두고 결과만 따로 낸다
 *   node scripts/clean-hq-watermark.js --compare <파일>  # 처리 전/후 2배 확대 비교 이미지
 *   --dx N / --edge N / --grow N                        # 방법을 바꿔 보고 눈으로 고를 때만
 *   --harmonic                                          # 무늬 없이 매끈하게만 메운다(비교용)
 *
 * ⚠ scripts/gen-hq-art.js 는 절대 같이 돌리지 마라 — hq-bg.png 를 절차적 생성물로
 *   덮어써 이 작업이 통째로 날아간다.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.js';

const BG = 'src/client/assets/hq-bg.png';

/** 워터마크가 들어 있는 상자(실측). */
const BOX = { x0: 1602, x1: 1845, y0: 1161, y1: 1206 };
/** 이 밖은 단 한 픽셀도 바뀌면 안 된다. */
const LIMIT = { x0: 1596, x1: 1851, y0: 1155, y1: 1212 };
/** 글자 둘레 후광까지 먹는 부풀림 반경. d=3 까지 밝기가 뜨고 d=4 부터는 벽과 같다. */
const GROW = 3;
/** 체커무늬 띠가 시작하는 y — 여기부터는 손대지 않는다(위상이 깨진다). */
const CHECKER_Y = 1209;
/** 메울 무늬를 떠 올 거리(왼쪽으로). 같은 벽 대역이면서 세로 이음새가 가장 적은 구간. */
const DX = 368;
/** 원본에서 가져오지 않을 가로 기울기 크기 — 이보다 크면 벽돌 이음새로 보고 버린다. */
const EDGE = 10;
/** 포아송 반복(SOR). 구멍이 작아 이 정도면 충분히 수렴한다. */
const ITERS = 4000;
const OMEGA = 1.9;

/** 밝은 무채색 = 워터마크. 배경 아트에는 이런 색이 없다. */
function isWatermark(px, i) {
  const r = px[i], g = px[i + 1], b = px[i + 2];
  return r > 165 && g > 165 && b > 160 && Math.max(r, g, b) - Math.min(r, g, b) < 25;
}

/** 상자 안 워터마크 픽셀을 grow 만큼 부풀린 마스크. LIMIT·체커무늬를 넘지 않는다. */
function buildMask(img, grow = GROW) {
  const { w, data } = img;
  const core = [];
  for (let y = BOX.y0; y <= BOX.y1; y++) {
    for (let x = BOX.x0; x <= BOX.x1; x++) if (isWatermark(data, (y * w + x) * 4)) core.push([x, y]);
  }
  const mask = new Set();
  for (const [x, y] of core) {
    for (let dy = -grow; dy <= grow; dy++) {
      for (let dx = -grow; dx <= grow; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < LIMIT.x0 || nx > LIMIT.x1 || ny < LIMIT.y0 || ny > LIMIT.y1) continue;
        if (ny >= CHECKER_Y) continue;
        mask.add(ny * w + nx);
      }
    }
  }
  return { core: core.length, mask };
}

/**
 * 포아송 합성 — 구멍을 원본(dx 만큼 왼쪽) 의 기울기로 채우되 밝기는 둘레에 맞춘다.
 * 가로 기울기는 edge 를 넘으면 0 으로 눕힌다(원본 쪽 이음새를 안 끌고 오려고).
 * harmonic 이면 기울기를 아예 안 쓴다 — 무늬 없이 매끈하게만 메운다.
 */
function fill(img, mask, { dx = DX, edge = EDGE, harmonic = false } = {}) {
  const { w, data } = img;
  const out = Uint8ClampedArray.from(data);
  const ids = [...mask];
  const src = (i) => i - dx * 4; // 픽셀 인덱스(바이트) 기준 왼쪽으로 dx

  for (let ch = 0; ch < 3; ch++) {
    const u = new Float64Array(ids.length);
    const idx = new Map(ids.map((p, n) => [p, n]));
    for (let n = 0; n < ids.length; n++) u[n] = data[ids[n] * 4 + ch];

    // 이웃별 안내값(원본 기울기)을 미리 굽는다.
    const nb = ids.map((p) => {
      const list = [];
      for (const [d, horiz] of [[-1, true], [1, true], [-w, false], [w, false]]) {
        const q = p + d;
        let g = 0;
        if (!harmonic) {
          g = data[src(p * 4) + ch] - data[src(q * 4) + ch];
          if (horiz && Math.abs(g) > edge) g = 0;
        }
        list.push([q, g, idx.has(q) ? idx.get(q) : -1]);
      }
      return list;
    });

    for (let it = 0; it < ITERS; it++) {
      for (let n = 0; n < ids.length; n++) {
        let sum = 0;
        for (const [q, g, qn] of nb[n]) sum += (qn >= 0 ? u[qn] : data[q * 4 + ch]) + g;
        u[n] += OMEGA * (sum / 4 - u[n]);
      }
    }
    for (let n = 0; n < ids.length; n++) out[ids[n] * 4 + ch] = Math.round(u[n]);
  }
  return out;
}

// ── 다시 굽기 ─────────────────────────────────────────────────────

/**
 * 원본 파일을 그대로 두고 픽셀(IDAT)만 갈아끼운다.
 *
 * png.js 의 encodePng 은 8비트 RGBA(색 타입 6)로만 내는데 hq-bg.png 은 알파 없는
 * RGB(색 타입 2)다. 그걸로 다시 구우면 색 타입이 바뀌고, 붙어 있는 iCCP 색 프로필과
 * gAMA·cHRM 도 날아가 그림 전체 색감이 달라진다 — 워터마크 하나 지우자고 치를
 * 대가가 아니다. 그래서 IHDR 을 비롯한 나머지 청크는 바이트 그대로 옮기고
 * IDAT 만 새로 만든다.
 */
function rebake(orig, w, h, px) {
  const stride = w * 3;
  const raw = Buffer.alloc(h * (stride + 1));
  let prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < 3; k++) line[x * 3 + k] = px[(y * w + x) * 4 + k];
    }
    const o = y * (stride + 1);
    raw[o] = 4; // Paeth
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? line[i - 3] : 0;
      const b = prev[i];
      const c = i >= 3 ? prev[i - 3] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      raw[o + 1 + i] = (line[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
    }
    prev = Buffer.from(line);
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };

  const out = [orig.subarray(0, 8)];
  let p = 8, done = false;
  while (p + 8 <= orig.length) {
    const len = orig.readUInt32BE(p);
    const type = orig.toString('latin1', p + 4, p + 8);
    if (type === 'IDAT') {
      if (!done) {
        out.push(chunk('IDAT', zlib.deflateSync(raw, { level: 9 })));
        done = true;
      }
    } else out.push(orig.subarray(p, p + 12 + len));
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}

// ── 검증 ──────────────────────────────────────────────────────────

function verify(before, after, w) {
  let left = 0;
  for (let y = BOX.y0; y <= BOX.y1; y++) {
    for (let x = BOX.x0; x <= BOX.x1; x++) if (isWatermark(after, (y * w + x) * 4)) left++;
  }
  let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let i = 0; i < before.length; i += 4) {
    if (before[i] === after[i] && before[i + 1] === after[i + 1] && before[i + 2] === after[i + 2] && before[i + 3] === after[i + 3]) continue;
    const p = i / 4, x = p % w, y = (p / w) | 0;
    n++;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const inside = n === 0 || (x0 >= LIMIT.x0 && x1 <= LIMIT.x1 && y0 >= LIMIT.y0 && y1 <= LIMIT.y1);
  return { left, n, box: [x0, x1, y0, y1], inside };
}

/** 처리 전/후를 2배로 확대해 위아래로 붙인 비교 이미지. */
function compare(before, after, w, file) {
  const cx0 = 1590, cx1 = 1860, cy0 = 1145, cy1 = 1220, S = 2, GAP = 6;
  const cw = (cx1 - cx0 + 1) * S, chh = (cy1 - cy0 + 1) * S;
  const H = chh * 2 + GAP;
  const out = new Uint8ClampedArray(cw * H * 4);
  const put = (px, top) => {
    for (let y = 0; y < chh; y++) {
      for (let x = 0; x < cw; x++) {
        const s = ((cy0 + ((y / S) | 0)) * w + cx0 + ((x / S) | 0)) * 4;
        const d = ((top + y) * cw + x) * 4;
        out[d] = px[s];
        out[d + 1] = px[s + 1];
        out[d + 2] = px[s + 2];
        out[d + 3] = 255;
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
  fs.writeFileSync(file, encodePng(cw, H, out));
  return `${cw}×${H}`;
}

// ── ─────────────────────────────────────────────────────────────

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const dry = opt('--dry');
  const cmpFile = opt('--compare');
  const grow = Number(opt('--grow') ?? GROW);
  const tune = { dx: Number(opt('--dx') ?? DX), edge: Number(opt('--edge') ?? EDGE), harmonic: args.includes('--harmonic') };

  const orig = fs.readFileSync(BG);
  const img = decodePng(orig);
  if (img.w !== 1920 || img.h !== 1280) throw new Error(`${BG} 크기가 1920×1280 이 아니다: ${img.w}×${img.h}`);
  if (orig[24] !== 8 || orig[25] !== 2) throw new Error(`${BG} 이 8비트 RGB(색 타입 2) 가 아니다: depth=${orig[24]} type=${orig[25]}`);
  const before = Uint8ClampedArray.from(img.data);

  const { core, mask } = buildMask(img, grow);
  console.log(`워터마크 픽셀 ${core} → ${grow}px 부풀려 메울 픽셀 ${mask.size}  (dx=${tune.dx} edge=${tune.edge}${tune.harmonic ? ' harmonic' : ''})`);

  const after = fill(img, mask, tune);
  const v = verify(before, after, img.w);
  console.log(`남은 워터마크 픽셀 ${v.left} (0 이어야 한다)`);
  console.log(`바뀐 픽셀 ${v.n}` + (v.n ? ` · 경계상자 x[${v.box[0]}, ${v.box[1]}] y[${v.box[2]}, ${v.box[3]}]` : ' — 지울 게 없다(이미 처리된 파일)'));
  console.log(`허용 범위 x[${LIMIT.x0}, ${LIMIT.x1}] y[${LIMIT.y0}, ${LIMIT.y1}] 안: ${v.inside ? '예' : '아니오'}`);
  if (!v.inside) {
    console.error('허용 범위를 벗어났다 — 쓰지 않고 멈춘다');
    process.exit(1);
  }

  if (cmpFile) console.log(`→ ${cmpFile}  (${compare(before, after, img.w, cmpFile)}, 위=처리 전 · 아래=처리 후)`);

  const buf = rebake(orig, img.w, img.h, after);

  // 쓰기 전에 되읽어 본다 — 크기·색 타입이 그대로이고 픽셀이 의도한 값과 똑같아야 한다.
  const back = decodePng(buf);
  let diff = 0;
  for (let i = 0; i < back.data.length; i += 4) {
    for (let k = 0; k < 3; k++) if (back.data[i + k] !== after[i + k]) diff++;
  }
  if (back.w !== img.w || back.h !== img.h || buf[24] !== 8 || buf[25] !== 2 || diff) {
    console.error(`다시 구운 결과가 어긋난다: ${back.w}×${back.h} depth=${buf[24]} type=${buf[25]} 어긋난채널=${diff}`);
    process.exit(1);
  }

  const target = dry || BG;
  fs.writeFileSync(target, buf);
  console.log(`→ ${target}  (${back.w}×${back.h}, 8비트 RGB(색 타입 2) 유지 · iCCP 등 부가 청크 그대로 · ${buf.length} 바이트)`);
  if (v.left) {
    console.error('아직 워터마크가 남았다');
    process.exit(1);
  }
}
