/**
 * 타일 검수기 — PixExact 로 뽑은 바닥 타일이 실제로 쓸 만한지 픽셀 단위로 검사한다.
 *
 *   node scripts/check-tile.js src/client/assets/tiles/metal_floor2.png
 *
 * 눈으로는 이음새와 반복 패턴을 못 잡는다. 검사 항목:
 *   1. 규격      — 32x32 정사각, 완전 불투명 (투명 픽셀이 있으면 바닥이 아니라 오브젝트)
 *   2. 이음새    — 마주보는 가장자리끼리 이어붙였을 때 튀는가 (내부 인접 픽셀 대비로 정규화)
 *   3. 밝기      — 플레이어 스프라이트(#e8dcc0)가 위에 올라가도 묻히지 않는가
 *   4. 디테일    — 32x32 에 디테일이 과하면 맵 전체가 시끄러워진다
 *
 * --preview 를 붙이면 4x4 로 깐 미리보기 PNG 를 옆에 떨군다. 반복 패턴은 이걸로 본다.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const PLAYER_LUM = 220; // #e8dcc0 — StageScene 의 플레이어 색

function decodePng(file) {
  const b = fs.readFileSync(file);
  if (b.readBigUInt64BE(0) !== 0x89504e470d0a1a0an) throw new Error('PNG 가 아니다');

  let off = 8;
  const idat = [];
  let w, h, bitDepth, colorType;

  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.subarray(off + 4, off + 8).toString('ascii');
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }

  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(`지원하지 않는 형식 (bitDepth=${bitDepth}, colorType=${colorType})`);
  }

  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);

  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y > 0 ? px[(y - 1) * stride + x] : 0;
      const ul = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = raw[p + x];
      if (ft === 1) v += a;
      else if (ft === 2) v += up;
      else if (ft === 3) v += (a + up) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(up - ul), pb = Math.abs(a - ul), pc = Math.abs(a + up - 2 * ul);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : ul;
      }
      px[y * stride + x] = v & 255;
    }
    p += stride;
  }
  return { w, h, bpp, stride, px };
}

function encodePng({ w, h, rgba }) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) >>> 0 : crc32(td));
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
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// zlib.crc32 는 Node 22.2+ 에서만 있다. 없으면 직접 계산.
let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function analyse(file, { preview }) {
  const { w, h, bpp, stride, px } = decodePng(file);
  const at = (x, y) => {
    const i = y * stride + x * bpp;
    return [px[i], px[i + 1], px[i + 2], bpp === 4 ? px[i + 3] : 255];
  };
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const pass = (ok) => (ok ? 'PASS' : 'FAIL');

  console.log(`\n=== ${path.basename(file)} ===`);

  // 1. 규격
  let transparent = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y)[3] < 255) transparent++;
  const square32 = w === 32 && h === 32;
  console.log(`[규격]   ${w}x${h}, 투명 픽셀 ${transparent}/${w * h}`);
  console.log(`         32x32 정사각 ......... ${pass(square32)}`);
  console.log(`         완전 불투명 .......... ${pass(transparent === 0)}`);

  // 2. 이음새 — wrap 차이를 내부 인접 픽셀 차이로 정규화한다.
  //    노이즈가 강한 텍스처는 인접 픽셀 차이 자체가 크므로 절대값으로 판단하면 안 된다.
  const meanAdjDiff = (dx, dy) => {
    let sum = 0, n = 0;
    for (let y = 0; y + dy < h; y++)
      for (let x = 0; x + dx < w; x++) { sum += Math.abs(lum(at(x, y)) - lum(at(x + dx, y + dy))); n++; }
    return sum / n;
  };
  const interiorH = meanAdjDiff(1, 0);
  const interiorV = meanAdjDiff(0, 1);

  let wrapH = 0, wrapV = 0;
  for (let y = 0; y < h; y++) wrapH += Math.abs(lum(at(w - 1, y)) - lum(at(0, y)));
  for (let x = 0; x < w; x++) wrapV += Math.abs(lum(at(x, h - 1)) - lum(at(x, 0)));
  wrapH /= h;
  wrapV /= w;

  // 이음새가 안 보이려면 wrap 차이가 내부 인접 차이와 비슷해야 한다 (비율 ~1.0).
  const ratioH = wrapH / interiorH;
  const ratioV = wrapV / interiorV;
  console.log(`[이음새] 좌우 wrap ${wrapH.toFixed(1)} vs 내부 인접 ${interiorH.toFixed(1)} → 비율 ${ratioH.toFixed(2)}  ${pass(ratioH < 1.5)}`);
  console.log(`         상하 wrap ${wrapV.toFixed(1)} vs 내부 인접 ${interiorV.toFixed(1)} → 비율 ${ratioV.toFixed(2)}  ${pass(ratioV < 1.5)}`);

  // 3. 테두리 — 이음새 검사가 절대 못 잡는 결함.
  //    가장자리가 어두운 타일은 wrap 검사를 통과한다 (어두운 쪽끼리 만나니 차이가 없다).
  //    그런데 깔아놓으면 32px 간격의 어두운 격자가 그대로 보인다. AI 생성 타일의 단골 실패다.
  //
  //    링 평균을 내면 안 된다. 베벨 처리된 판때기는 바깥 링이 어둡고 그 안쪽 링이 밝아서
  //    평균이 서로 상쇄돼 멀쩡해 보인다. 가장자리 줄을 하나씩 전체 평균과 비교해야 잡힌다.
  let global = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) global += lum(at(x, y));
  global /= w * h;

  const lineMean = (pick, n) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += lum(pick(i));
    return s / n;
  };
  const edges = [
    ['상', lineMean((i) => at(i, 0), w)],
    ['하', lineMean((i) => at(i, h - 1), w)],
    ['좌', lineMean((i) => at(0, i), h)],
    ['우', lineMean((i) => at(w - 1, i), h)],
  ];
  const worst = edges.reduce((m, e) => (Math.abs(e[1] - global) > Math.abs(m[1] - global) ? e : m));
  const dev = worst[1] - global;
  console.log(
    `[테두리] 전체 ${global.toFixed(1)} vs ` +
      edges.map(([n, v]) => `${n}${v.toFixed(0)}`).join(' ') +
      ` → 최대 편차 ${worst[0]}변 ${dev > 0 ? '+' : ''}${dev.toFixed(1)}  ${pass(Math.abs(dev) < 15)}`,
  );

  // 4. 밝기
  let tot = 0, min = 255, max = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const L = lum(at(x, y)); tot += L; min = Math.min(min, L); max = Math.max(max, L);
  }
  const mean = tot / (w * h);
  const contrast = PLAYER_LUM - mean;
  console.log(`[밝기]   평균 ${mean.toFixed(1)} (min ${min.toFixed(0)} / max ${max.toFixed(0)})`);
  console.log(`         플레이어(${PLAYER_LUM}) 와의 대비 ${contrast.toFixed(0)} ... ${pass(contrast > 90)}`);

  // 4. 디테일 밀도 — 인접 픽셀 밝기차 평균이 크면 시끄럽다.
  const detail = (interiorH + interiorV) / 2;
  console.log(`[디테일] 인접 픽셀 평균 밝기차 ${detail.toFixed(1)} ......... ${pass(detail < 18)}`);

  if (preview) {
    // 4x4 로 깔고 4배 확대(nearest) — 32px 원본은 너무 작아서 육안 검수가 안 된다.
    const N = 4, Z = 4;
    const pw = w * N * Z, ph = h * N * Z;
    const out = Buffer.alloc(pw * ph * 4);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const c = at(Math.floor(x / Z) % w, Math.floor(y / Z) % h);
      const i = (y * pw + x) * 4;
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = c[3];
    }
    const dest = file.replace(/\.png$/, '.preview4x4.png');
    fs.writeFileSync(dest, encodePng({ w: pw, h: ph, rgba: out }));
    console.log(`\n미리보기 → ${dest}`);
  }
}

const args = process.argv.slice(2);
const preview = args.includes('--preview');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('사용법: node scripts/check-tile.js <타일.png> [--preview]');
  process.exit(1);
}
for (const f of files) analyse(f, { preview });
