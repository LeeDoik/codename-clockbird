/**
 * 대화창 초상 더미 생성기 — 코드네임: 태엽새
 *
 *   node scripts/gen-portrait-dummies.js
 *
 * 진짜 일러스트는 기획자가 그린다. 이건 그 그림이 도착하기 전에 **레이아웃을 눈으로 보기 위한**
 * 자리표시자다 — 크기·비율·투명 배경·세이프 에어리어가 계약(`public/portraits/README.md`)과
 * 같으므로, 나중에 같은 이름의 진짜 그림으로 덮어쓰면 그대로 교체된다.
 *
 * 절차적 생성 방식은 scripts/gen-characters.js 를 따른다 (PNG 인코더도 같은 것).
 * 팔레트는 design/style-formula.txt 의 역할별 색 배분.
 *
 * 출력: public/portraits/<id>.png  (640×800, 4:5, 투명 배경) × 10
 *
 * 자리표시자임을 한눈에 알 수 있도록:
 *   - 평면 단색 + 단순 실루엣 (진짜 일러스트와 혼동될 수 없다)
 *   - 가슴에 식별용 점(pip) — 아래 CAST 순서대로 1~10개. 대화 중 "맞는 얼굴이 떴는가"를
 *     이름과 대조하지 않고 점 개수로 셀 수 있다.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// 반신(半身). 레퍼런스(넥슨 계열 VN 대화창)처럼 인물이 화면에 크게 서고 대화 패널이
// 그 위를 덮는 구성이라, 4:5 흉상으로는 프레임이 안 찬다. 4:7 로 세워 허리 위까지 담는다.
const W = 640;
const H = 1120;
const SS = 2; // 슈퍼샘플링 배수 — 이 배수로 그린 뒤 축소해 가장자리를 부드럽게 만든다
const OUTLINE = hex('#241c14'); // 어두운 웜브라운 — 스프라이트와 같은 외곽선 색

function hex(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

// ── 캐스트 ────────────────────────────────────────────────────────
// id 는 personas.json / tutorial.json 이 단일 출처다. 파일명 = id.
// pip 은 이 배열의 순서(1부터) — 더미를 구분하기 위한 것이지 게임 데이터가 아니다.
const CAST = [
  { id: 'watchmaker', who: '에이다 · 시계공 (54M)',
    skin: '#d8b48c', coat: '#8a8378', collar: '#6f6960', hair: '#cfcabf', hat: 'short', accent: '#c9a227', acc: 'monocle' },
  { id: 'maid', who: '리나 · 주방 하녀 (18F)',
    skin: '#e0c09a', coat: '#4a7a6b', collar: '#d8d2c4', hair: '#6b4a2a', hat: 'bun', accent: '#d8d2c4', acc: 'collar' },
  { id: 'engineer', who: '보리스 · 기관사 (35M)',
    skin: '#d8a878', coat: '#7a4a34', collar: '#5f3a28', hair: '#3a3228', hat: 'cap', accent: '#c9a227', acc: 'goggles', build: 'big' },
  { id: 'smuggler', who: '카이 · 밀수꾼 (28M)',
    skin: '#cfa77e', coat: '#45514a', collar: '#35403a', hair: '#2a2620', hat: 'wide', accent: '#8a5a2a', acc: 'strap' },
  { id: 'musician', who: '노아 · 거리 악사 (34M)',
    skin: '#d8b48c', coat: '#7a5a3a', collar: '#5f4530', hair: '#5a4028', hat: 'wide', accent: '#c9a227', acc: 'scarf' },
  { id: 'fixer', who: '요른 · 시계 수리공 (접선책)',
    skin: '#c9a07a', coat: '#5a5048', collar: '#3f3830', hair: '#8a8074', hat: 'cap', accent: '#c9a227', acc: 'monocle' },
  { id: 't1', who: '미라 · 인쇄공 (40F)',
    skin: '#dbb287', coat: '#3f4a58', collar: '#2c343e', hair: '#4a3524', hat: 'scarf', accent: '#c25b4a', acc: 'collar' },
  { id: 't2', who: '한나 · 사서 (31F)',
    skin: '#e2c39d', coat: '#4a5a6b', collar: '#e8dcc0', hair: '#3a2c1e', hat: 'bun', accent: '#c9a227', acc: 'glasses' },
  { id: 't3', who: '테오 · 이야기꾼 (26M)',
    skin: '#d6a97c', coat: '#8a6a3a', collar: '#6b5028', hair: '#4a3a24', hat: 'short', accent: '#4a7a6b', acc: 'scarf' },
  // 간부는 적대 쪽 — STYLE FORMULA 의 hazards 색(rust-red)을 신호색으로 쓴다.
  { id: 'officer', who: '베르나 · 간부',
    skin: '#c9a888', coat: '#2f3540', collar: '#1e232b', hair: '#2a2620', hat: 'peaked', accent: '#c25b4a', acc: 'braid' },
];

// ── 버퍼 (슈퍼샘플 해상도) ────────────────────────────────────────
const SW = W * SS;
const SH = H * SS;
const S = (v) => Math.round(v * SS);

function newBuf() {
  return new Uint8ClampedArray(SW * SH * 4);
}
function put(buf, x, y, c) {
  if (x < 0 || x >= SW || y < 0 || y >= SH) return;
  const i = (y * SW + x) * 4;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
}

/** 타원. grow 는 외곽선 패스에서 도형을 부풀리는 양(px, 원본 기준). */
function ellipse(buf, cx, cy, rx, ry, c, { grow = 0, topOnly = false } = {}) {
  const [ex, ey, gx, gy] = [S(cx), S(cy), S(rx + grow), S(ry + grow)];
  for (let y = ey - gy; y <= ey + gy; y++) {
    if (topOnly && y > ey) break;
    for (let x = ex - gx; x <= ex + gx; x++) {
      const dx = (x - ex) / gx, dy = (y - ey) / gy;
      if (dx * dx + dy * dy <= 1) put(buf, x, y, c);
    }
  }
}

function rect(buf, x0, y0, x1, y1, c, { grow = 0 } = {}) {
  for (let y = S(y0 - grow); y <= S(y1 + grow); y++) {
    for (let x = S(x0 - grow); x <= S(x1 + grow); x++) put(buf, x, y, c);
  }
}

/**
 * 어깨 + 몸통. 어깨선은 `run` 거리 안에서 다 벌어지고 그 아래는 수직으로 내려간다 —
 * 끝까지 벌어지게 두면 반신 비율에서 사람이 아니라 원뿔이 된다.
 */
function shoulders(buf, cx, top, halfTop, halfBottom, c, { grow = 0, run = 300 } = {}) {
  const t = S(top - grow);
  for (let y = t; y < SH; y++) {
    const k = Math.min(1, (y - t) / S(run));
    const half = S(halfTop + grow) + (S(halfBottom + grow) - S(halfTop + grow)) * Math.sqrt(k);
    for (let x = Math.round(S(cx) - half); x <= Math.round(S(cx) + half); x++) put(buf, x, y, c);
  }
}

/**
 * 외곽선을 두른 도형 — 부풀린 어두운 패스를 먼저 깔고 그 위에 채운다.
 * 안티에일리어싱된 가장자리와 공존시키려면 이 방식이 사후 윤곽 검출보다 깔끔하다.
 */
function stroked(buf, fn, fill, w = 5) {
  fn(OUTLINE, w);
  fn(fill, 0);
}

// ── 한 명 그리기 ──────────────────────────────────────────────────
function drawBust(buf, s) {
  const cx = 320;
  const big = s.build === 'big';
  const headRx = big ? 124 : 116;
  const headRy = big ? 148 : 142;
  const headCy = 252;
  const shoulderTop = 452;

  const coat = hex(s.coat);
  const collar = hex(s.collar);
  const skin = hex(s.skin);
  const hair = hex(s.hair);
  const accent = hex(s.accent);

  // 어깨 → 목 → 머리 순으로 뒤에서 앞으로 겹쳐 그린다.
  const halfW = big ? 300 : 272;
  stroked(buf, (c, g) => shoulders(buf, cx, shoulderTop, big ? 205 : 178, halfW, c, { grow: g }), coat, 6);

  // 팔 이음선과 앞여밈 — 반신 비율에서 몸통이 한 덩어리로 보이지 않게 끊어 준다.
  for (const sx of [-1, 1]) rect(buf, cx + sx * (halfW - 78) - 3, 640, cx + sx * (halfW - 78) + 3, H, OUTLINE);
  rect(buf, cx - 3, 560, cx + 3, H, OUTLINE);

  // 목
  stroked(buf, (c, g) => rect(buf, cx - 46, 352, cx + 46, 470, c, { grow: g }), skin, 5);

  // 옷깃 — 목과 코트 사이를 끊어 준다
  stroked(
    buf,
    (c, g) => {
      rect(buf, cx - 118, shoulderTop - 8, cx - 30, shoulderTop + 96, c, { grow: g });
      rect(buf, cx + 30, shoulderTop - 8, cx + 118, shoulderTop + 96, c, { grow: g });
    },
    collar,
    5,
  );

  // 머리
  stroked(buf, (c, g) => ellipse(buf, cx, headCy, headRx, headRy, c, { grow: g }), skin, 5);

  // 머리카락 / 모자
  drawHead(buf, s, cx, headCy, headRx, headRy, hair);

  // 눈 — 실루엣이 얼굴로 읽히게 하는 최소한의 표시
  const eyeY = headCy + 12;
  ellipse(buf, cx - 44, eyeY, 15, 10, OUTLINE);
  ellipse(buf, cx + 44, eyeY, 15, 10, OUTLINE);

  drawAccessory(buf, s, cx, headCy, headRx, accent, eyeY);

  // 식별용 점 — 가슴에 CAST 순서만큼. 자리표시자 표식이자 대화 중 인물 대조용.
  const n = CAST.findIndex((x) => x.id === s.id) + 1;
  for (let i = 0; i < n; i++) {
    const px = cx - (n - 1) * 21 + i * 42;
    stroked(buf, (c, g) => ellipse(buf, px, 980, 13, 13, c, { grow: g }), accent, 4);
  }
}

function drawHead(buf, s, cx, cy, rx, ry, hair) {
  const top = cy - ry;
  switch (s.hat) {
    case 'short':
      stroked(buf, (c, g) => ellipse(buf, cx, cy - 34, rx + 6, ry - 20, c, { grow: g, topOnly: true }), hair, 5);
      break;
    case 'bun':
      stroked(buf, (c, g) => ellipse(buf, cx, cy - 24, rx + 12, ry - 10, c, { grow: g, topOnly: true }), hair, 5);
      stroked(buf, (c, g) => ellipse(buf, cx, top - 26, 46, 46, c, { grow: g }), hair, 5);
      break;
    case 'cap':
      stroked(buf, (c, g) => ellipse(buf, cx, cy - 62, rx + 4, 82, c, { grow: g, topOnly: true }), hair, 5);
      stroked(buf, (c, g) => rect(buf, cx - rx - 26, cy - 66, cx + rx + 26, cy - 46, c, { grow: g }), hair, 5);
      break;
    case 'wide':
      stroked(buf, (c, g) => ellipse(buf, cx, cy - 76, 96, 74, c, { grow: g, topOnly: true }), hair, 5);
      stroked(buf, (c, g) => ellipse(buf, cx, cy - 74, rx + 88, 20, c, { grow: g }), hair, 5);
      break;
    case 'scarf':
      // 머릿수건 — 머리 위를 덮고 양옆으로 흘러내린다
      stroked(buf, (c, g) => ellipse(buf, cx, cy - 20, rx + 10, ry - 16, c, { grow: g, topOnly: true }), hair, 5);
      stroked(buf, (c, g) => ellipse(buf, cx - rx + 4, cy + 40, 30, 84, c, { grow: g }), hair, 5);
      stroked(buf, (c, g) => ellipse(buf, cx + rx - 4, cy + 40, 30, 84, c, { grow: g }), hair, 5);
      break;
    case 'peaked':
      // 정모 — 각진 실루엣으로 간부임이 멀리서도 갈린다
      stroked(buf, (c, g) => rect(buf, cx - rx - 4, cy - ry - 46, cx + rx + 4, cy - 62, c, { grow: g }), hair, 5);
      stroked(buf, (c, g) => rect(buf, cx - rx - 10, cy - 66, cx + rx + 10, cy - 40, c, { grow: g }), OUTLINE, 5);
      stroked(buf, (c, g) => ellipse(buf, cx, cy - 40, rx + 46, 18, c, { grow: g }), hair, 5);
      break;
  }
}

function drawAccessory(buf, s, cx, cy, rx, accent, eyeY) {
  switch (s.acc) {
    case 'monocle':
      stroked(buf, (c, g) => ellipse(buf, cx + 44, eyeY, 34, 32, c, { grow: g }), accent, 6);
      // 렌즈 안을 다시 피부색으로 비워 테만 남긴다
      ellipse(buf, cx + 44, eyeY, 26, 24, hex(s.skin));
      ellipse(buf, cx + 44, eyeY, 15, 10, OUTLINE);
      break;
    case 'glasses':
      for (const sx of [-44, 44]) {
        stroked(buf, (c, g) => ellipse(buf, cx + sx, eyeY, 34, 30, c, { grow: g }), accent, 5);
        ellipse(buf, cx + sx, eyeY, 27, 23, hex(s.skin));
        ellipse(buf, cx + sx, eyeY, 15, 10, OUTLINE);
      }
      rect(buf, cx - 12, eyeY - 4, cx + 12, eyeY + 2, accent);
      break;
    case 'goggles':
      stroked(buf, (c, g) => rect(buf, cx - rx - 14, cy - 96, cx + rx + 14, cy - 56, c, { grow: g }), accent, 5);
      ellipse(buf, cx - 52, cy - 76, 26, 18, OUTLINE);
      ellipse(buf, cx + 52, cy - 76, 26, 18, OUTLINE);
      break;
    case 'collar':
      stroked(buf, (c, g) => ellipse(buf, cx, 470, 92, 34, c, { grow: g }), accent, 5);
      break;
    case 'scarf':
      stroked(buf, (c, g) => ellipse(buf, cx, 492, 128, 46, c, { grow: g }), accent, 5);
      break;
    case 'strap':
      // 대각선 가죽끈
      for (let t = 0; t <= 1; t += 0.002) {
        const x = cx - 190 + t * 340;
        const y = 500 + t * 300;
        ellipse(buf, x, y, 20, 20, accent);
      }
      break;
    case 'braid':
      // 견장 — 어깨 양쪽 계급장
      for (const sx of [-1, 1]) {
        stroked(buf, (c, g) => rect(buf, cx + sx * 196 - 44, 596, cx + sx * 196 + 44, 632, c, { grow: g }), accent, 5);
      }
      break;
  }
}

/**
 * 좌상단 키라이트. 평면 단색이라도 이것만 얹으면 어두운 대화 패널 위에서
 * 실루엣이 납작하게 죽지 않는다 — 진짜 일러스트의 조명 방향(스타일 라인)과 같게 맞춘다.
 */
function light(buf) {
  const lx = SW * 0.2, ly = -SH * 0.12;
  const maxD = Math.hypot(SW, SH) * 1.05;
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const i = (y * SW + x) * 4;
      if (buf[i + 3] === 0) continue;
      const d = Math.hypot(x - lx, y - ly) / maxD;
      const f = Math.max(0.62, Math.min(1.16, 1.2 - d * 0.85));
      buf[i] *= f; buf[i + 1] *= f; buf[i + 2] *= f;
    }
  }
}

/** 슈퍼샘플 버퍼를 최종 크기로 박스 축소 — 여기서 가장자리가 부드러워진다. */
function downsample(buf) {
  const out = new Uint8ClampedArray(W * H * 4);
  const n = SS * SS;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * SW + x * SS + sx) * 4;
          const al = buf[i + 3];
          r += buf[i] * al; g += buf[i + 1] * al; b += buf[i + 2] * al; a += al;
        }
      }
      const o = (y * W + x) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = a / n;
    }
  }
  return out;
}

// ── PNG 인코딩 (RGBA, colorType 6) — scripts/gen-characters.js 와 동일 ──
function encodePng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) >>> 0 : crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
  }
  let c = -1; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ── 실행 ──────────────────────────────────────────────────────────
const outDir = 'public/portraits';
fs.mkdirSync(outDir, { recursive: true });

for (const s of CAST) {
  const buf = newBuf();
  drawBust(buf, s);
  light(buf);
  const png = encodePng(W, H, downsample(buf));
  fs.writeFileSync(path.join(outDir, `${s.id}.png`), png);
  console.log(`  ${s.id}.png  ${String(Math.round(png.length / 1024)).padStart(3)}KB  — ${s.who}`);
}

console.log(`\n${CAST.length}장 생성 완료 → ${outDir}/ (${W}×${H}, 투명 배경)`);
console.log('※ 자리표시자다. 기획자 일러스트가 도착하면 같은 이름으로 덮어쓰면 된다.');
console.log('  레이아웃 확인: tools/portrait-preview.html 를 브라우저로 연다.');
