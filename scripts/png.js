/**
 * PNG 읽기·쓰기 — 의존성 없이 노드 zlib 만 쓴다.
 *
 * 아트 스크립트(gen-*-art.js)들이 각자 인코더를 들고 있었고, 걷는 길 마스크를
 * 읽으면서 디코더가 필요해졌다. 둘 다 여기 모아 두고 도구들이 가져다 쓴다.
 *
 * 디코더는 편집기가 흔히 내는 형식을 받는다: 색 타입 0·2·3·4·6, 8/16비트
 * (팔레트는 1/2/4비트도), 인터레이스는 안 받는다. 인코더는 8비트 RGBA 로만 낸다.
 */
import zlib from 'node:zlib';

// ── PNG ───────────────────────────────────────────────────────────

export function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG 파일이 아니다');
  let p = 8;
  let w = 0, h = 0, depth = 8, ctype = 6, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    p += 12 + len;
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      ctype = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (interlace) throw new Error('인터레이스(Adam7) PNG 는 못 읽는다 — 편집기에서 인터레이스를 끄고 다시 저장해라');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new Error(`모르는 PNG 색 타입 ${ctype}`);
  if (ctype !== 3 && depth !== 8 && depth !== 16) throw new Error(`PNG 비트 깊이 ${depth} 는 못 읽는다 — 채널당 8비트로 저장해라`);

  const bpp = Math.max(1, (ch * depth) >> 3);
  const stride = Math.ceil((w * ch * depth) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const lines = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1);
    const cur = lines.subarray(y * stride, (y + 1) * stride);
    const prev = y ? lines.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
  }

  const out = new Uint8ClampedArray(w * h * 4);
  const step = depth === 16 ? 2 : 1;
  const per = 8 / depth; // 팔레트 저비트용
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r, g, b, a = 255;
      if (ctype === 3) {
        let idx;
        if (depth === 8) idx = lines[y * stride + x];
        else {
          const byte = lines[y * stride + ((x / per) | 0)];
          idx = (byte >> (8 - depth * ((x % per) + 1))) & ((1 << depth) - 1);
        }
        r = palette[idx * 3];
        g = palette[idx * 3 + 1];
        b = palette[idx * 3 + 2];
        if (trns && idx < trns.length) a = trns[idx];
      } else {
        const base = y * stride + x * ch * step;
        if (ctype === 0) r = g = b = lines[base];
        else if (ctype === 4) {
          r = g = b = lines[base];
          a = lines[base + step];
        } else {
          r = lines[base];
          g = lines[base + step];
          b = lines[base + 2 * step];
          if (ctype === 6) a = lines[base + 3 * step];
        }
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return { w, h, data: out };
}

/**
 * @param {Uint8ClampedArray} px RGBA 픽셀
 * @param {{rgb?: boolean}} [opt] rgb 면 알파를 버리고 색 타입 2 로 낸다.
 *   배경처럼 불투명한 그림은 이것만으로 원본 바이트가 1/4 줄고, 압축 결과도 그만큼 준다.
 *
 * 행 필터는 **다섯 가지를 다 해 보고 가장 작은 것을 고른다**(표준 휴리스틱: 부호 있는
 * 절대값 합이 최소인 것). 예전엔 Paeth 로 못박혀 있었는데, AI 배틀맵처럼 색이 잔뜩
 * 섞인 그림에서는 행마다 잘 맞는 필터가 달라 손해가 컸다 — 배경 네 장 13.5MB 가
 * 이 두 가지로 줄어든다.
 */
export function encodePng(w, h, px, { rgb = false } = {}) {
  const bpp = rgb ? 3 : 4;
  const stride = w * bpp;

  // 알파를 버리는 경우 먼저 촘촘한 버퍼로 옮긴다 — 필터가 이웃 픽셀을 bpp 만큼 뒤로 본다.
  let src = px;
  if (rgb) {
    src = new Uint8ClampedArray(w * h * 3);
    for (let i = 0, j = 0; i < w * h; i++, j += 3) {
      src[j] = px[i * 4];
      src[j + 1] = px[i * 4 + 1];
      src[j + 2] = px[i * 4 + 2];
    }
  }

  const raw = Buffer.alloc(h * (stride + 1));
  const cand = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    const prev = (y - 1) * stride;
    for (let i = 0; i < stride; i++) {
      const x = src[row + i];
      const a = i >= bpp ? src[row + i - bpp] : 0;
      const b = y ? src[prev + i] : 0;
      const c = y && i >= bpp ? src[prev + i - bpp] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      cand[0][i] = x;
      cand[1][i] = (x - a) & 0xff;
      cand[2][i] = (x - b) & 0xff;
      cand[3][i] = (x - ((a + b) >> 1)) & 0xff;
      cand[4][i] = (x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
    }
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      let s = 0;
      for (let i = 0; i < stride; i++) {
        const v = cand[f][i];
        s += v < 128 ? v : 256 - v;
      }
      if (s < bestScore) { bestScore = s; best = f; }
    }
    const o = y * (stride + 1);
    raw[o] = best;
    cand[best].copy(raw, o + 1);
  }
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
  ihdr[9] = rgb ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
