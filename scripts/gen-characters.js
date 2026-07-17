/**
 * 캐릭터 스프라이트 생성기 — 코드네임: 태엽새
 *
 *   node scripts/gen-characters.js
 *
 * Higgsfield 크레딧이 없어 AI 생성 대신, STYLE FORMULA(design/style-formula.txt)에 맞춰
 * 32×32 픽셀 캐릭터를 코드로 직접 그린다. 톱다운·크림/골드 주인공·청록/녹/가죽 동료.
 *
 * 출력:
 *   src/client/assets/chars.png         — 7프레임 가로 스트립 (게임용, frameWidth 32)
 *   src/client/assets/chars.preview8x.png — 8배 확대 미리보기 (육안 검수용)
 *
 * 프레임 순서: 0 플레이어 / 1 시계공 / 2 하녀 / 3 기관사 / 4 밀수꾼 / 5 악사 / 6 시민
 * (동료 순서는 personas.json 순서와 일치: watchmaker,maid,engineer,smuggler,musician)
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const S = 32; // 프레임 한 변
const OUTLINE = [36, 28, 20]; // #241c14 어두운 웜브라운 외곽선

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ── 한 프레임(32×32 RGBA) 버퍼 조작 ──────────────────────────────
const newFrame = () => new Uint8ClampedArray(S * S * 4); // 전부 투명(0,0,0,0)
function px(buf, x, y, c, a = 255) {
  if (x < 0 || x >= S || y < 0 || y >= S) return;
  const i = (y * S + x) * 4;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = a;
}
const isSolid = (buf, x, y) => x >= 0 && x < S && y >= 0 && y < S && buf[(y * S + x) * 4 + 3] > 0;

function rect(buf, x0, y0, x1, y1, c) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(buf, x, y, c);
}
function ellipse(buf, cx, cy, rx, ry, c, { topOnly = false } = {}) {
  for (let y = cy - ry; y <= cy + ry; y++) {
    if (topOnly && y > cy) break;
    for (let x = cx - rx; x <= cx + rx; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1.02) px(buf, x, y, c);
    }
  }
}

/** 실루엣 바깥 1px 에 외곽선을 두른다 (4-이웃 기준). */
function outline(buf) {
  const edges = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (isSolid(buf, x, y)) continue;
    if (isSolid(buf, x - 1, y) || isSolid(buf, x + 1, y) || isSolid(buf, x, y - 1) || isSolid(buf, x, y + 1)) {
      edges.push([x, y]);
    }
  }
  for (const [x, y] of edges) px(buf, x, y, OUTLINE);
}

// ── 캐릭터 한 명 그리기 ──────────────────────────────────────────
function drawCharacter(buf, s) {
  const cx = 16;
  const big = s.build === 'big';
  const bodyL = big ? 7 : 9, bodyR = big ? 24 : 22;
  const armLo = big ? 5 : 7, armRo = big ? 26 : 24;

  // 다리 / 부츠
  rect(buf, cx - 5, 26, cx - 2, 30, s.boots);
  rect(buf, cx + 2, 26, cx + 5, 30, s.boots);
  // 팔 (코트 어두운 색)
  rect(buf, armLo, 15, armLo + 2, 24, s.coatDark);
  rect(buf, armRo - 2, 15, armRo, 24, s.coatDark);
  // 몸통 / 코트
  rect(buf, bodyL, 14, bodyR, 26, s.coat);
  // 코트 어깨 둥글리기
  px(buf, bodyL, 14, [0, 0, 0], 0); px(buf, bodyR, 14, [0, 0, 0], 0);

  // 머리 (피부)
  ellipse(buf, cx, 9, 6, 6, s.skin);

  // 모자 / 머리카락
  drawHead(buf, s, cx);

  // 눈
  const eyeY = s.hat === 'hood' ? 11 : 9;
  px(buf, cx - 3, eyeY, OUTLINE); px(buf, cx - 2, eyeY, OUTLINE);
  px(buf, cx + 2, eyeY, OUTLINE); px(buf, cx + 3, eyeY, OUTLINE);

  // 액세서리 / 강조색
  drawAccent(buf, s, cx);
}

function drawHead(buf, s, cx) {
  const c = s.hatColor;
  switch (s.hat) {
    case 'hood':
      // 크림 망토 후드가 머리 위·옆을 감싸고, 그늘진 얼굴만 아래쪽에 드러난다.
      ellipse(buf, cx, 8, 7, 7, c);          // 후드 바깥(크림)
      ellipse(buf, cx, 8, 5, 5, s.coatDark); // 후드 안쪽 그늘
      ellipse(buf, cx, 11, 4, 3, s.skin);    // 그늘진 얼굴
      px(buf, cx, 14, hex('#c9a227')); px(buf, cx, 15, hex('#c9a227')); // 금색 여밈
      break;
    case 'cap':
      ellipse(buf, cx, 7, 6, 4, c, { topOnly: true }); // 돔
      rect(buf, cx - 6, 7, cx + 6, 7, c); // 챙
      break;
    case 'wide':
      ellipse(buf, cx, 6, 5, 3, c, { topOnly: true }); // 돔
      rect(buf, cx - 8, 7, cx + 8, 7, c); // 넓은 챙
      break;
    case 'hairShort':
      ellipse(buf, cx, 6, 6, 4, c, { topOnly: true });
      break;
    case 'bun':
      ellipse(buf, cx, 6, 6, 4, c, { topOnly: true });
      ellipse(buf, cx, 4, 2, 2, c); // 정수리 번
      break;
  }
}

function drawAccent(buf, s, cx) {
  if (!s.accent) return;
  switch (s.accentType) {
    case 'belt':
      rect(buf, s.build === 'big' ? 8 : 10, 20, s.build === 'big' ? 23 : 21, 20, s.accent);
      break;
    case 'apron':
      rect(buf, cx - 3, 15, cx + 3, 25, s.accent); // 앞치마 패널
      break;
    case 'goggles':
      rect(buf, cx - 5, 6, cx + 5, 6, s.accent); // 모자 위 고글 밴드
      px(buf, cx - 3, 6, OUTLINE); px(buf, cx + 3, 6, OUTLINE);
      break;
    case 'monocle':
      px(buf, cx + 2, 9, s.accent); px(buf, cx + 3, 9, s.accent);
      px(buf, cx + 2, 10, s.accent); px(buf, cx + 3, 10, s.accent);
      break;
    case 'organ':
      rect(buf, s.build === 'big' ? 24 : 22, 18, 26, 23, s.accent); // 옆구리 손풍금 상자
      break;
    case 'strap':
      for (let y = 15; y <= 24; y++) px(buf, cx - 4 + (y - 15), y, s.accent); // 대각선 가죽끈
      break;
  }
}

// ── 캐릭터 스펙 (프레임 순서대로) ────────────────────────────────
const SPECS = [
  { // 0 플레이어 — 후드 잠입 요원, 크림 망토 + 그늘진 얼굴 + 금색
    skin: hex('#9a7a54'), coat: hex('#dcd0b0'), coatDark: hex('#b7ad8d'),
    hat: 'hood', hatColor: hex('#dcd0b0'), accent: hex('#c9a227'), accentType: 'belt', boots: hex('#3a2e22'),
  },
  { // 1 에이다 · 시계공 — 회색 코트, 흰 머리, 모노클
    skin: hex('#d8b48c'), coat: hex('#8a8378'), coatDark: hex('#6f6960'),
    hat: 'hairShort', hatColor: hex('#cfcabf'), accent: hex('#c9a227'), accentType: 'monocle', boots: hex('#3a2e22'),
  },
  { // 2 리나 · 주방 하녀 — 청록 드레스, 흰 앞치마
    skin: hex('#e0c09a'), coat: hex('#4a7a6b'), coatDark: hex('#3a6153'),
    hat: 'bun', hatColor: hex('#6b4a2a'), accent: hex('#d8d2c4'), accentType: 'apron', boots: hex('#3a2e22'),
  },
  { // 3 보리스 · 기관사 — 녹슨 코트, 고글, 덩치 큼
    skin: hex('#d8a878'), coat: hex('#7a4a34'), coatDark: hex('#5f3a28'),
    hat: 'cap', hatColor: hex('#3a3228'), accent: hex('#c9a227'), accentType: 'goggles', boots: hex('#2a231a'), build: 'big',
  },
  { // 4 카이 · 밀수꾼 — 어두운 코트, 챙 넓은 모자, 가죽끈
    skin: hex('#cfa77e'), coat: hex('#45514a'), coatDark: hex('#35403a'),
    hat: 'wide', hatColor: hex('#2a2620'), accent: hex('#8a5a2a'), accentType: 'strap', boots: hex('#2a231a'),
  },
  { // 5 노아 · 거리 악사 — 갈색 코트, 플로피 모자, 손풍금
    skin: hex('#d8b48c'), coat: hex('#7a5a3a'), coatDark: hex('#5f4530'),
    hat: 'wide', hatColor: hex('#5a4028'), accent: hex('#c9a227'), accentType: 'organ', boots: hex('#3a2e22'),
  },
  { // 6 시민 — 무채색 서민, 챙모자
    skin: hex('#d8b48c'), coat: hex('#6b6055'), coatDark: hex('#524a41'),
    hat: 'cap', hatColor: hex('#4a4038'), accent: null, boots: hex('#3a2e22'),
  },
];

// ── PNG 인코딩 (RGBA, colorType 6) ───────────────────────────────
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

// ── 렌더 & 합성 ──────────────────────────────────────────────────
const frames = SPECS.map((s) => { const b = newFrame(); drawCharacter(b, s); outline(b); return b; });
const N = frames.length;

// 가로 스트립 (N*32 × 32)
const sheet = new Uint8ClampedArray(N * S * S * 4);
for (let f = 0; f < N; f++) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const si = (y * S + x) * 4, di = (y * (N * S) + f * S + x) * 4;
    for (let k = 0; k < 4; k++) sheet[di + k] = frames[f][si + k];
  }
}
fs.writeFileSync('src/client/assets/chars.png', encodePng(N * S, S, sheet));

// 8배 확대 미리보기 (검수용)
const Z = 8, pw = N * S * Z, ph = S * Z;
const prev = new Uint8ClampedArray(pw * ph * 4);
// 체커 배경(투명 확인용)
for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
  const i = (y * pw + x) * 4, checker = ((x >> 3) + (y >> 3)) & 1 ? 40 : 28;
  prev[i] = checker; prev[i + 1] = checker - 4; prev[i + 2] = checker - 8; prev[i + 3] = 255;
}
for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
  const si = (Math.floor(y / Z) * (N * S) + Math.floor(x / Z)) * 4;
  const a = sheet[si + 3];
  if (a > 0) { const i = (y * pw + x) * 4; prev[i] = sheet[si]; prev[i + 1] = sheet[si + 1]; prev[i + 2] = sheet[si + 2]; prev[i + 3] = 255; }
}
fs.writeFileSync('src/client/assets/chars.preview8x.png', encodePng(pw, ph, prev));

console.log(`chars.png (${N * S}×${S}, ${N}프레임) + chars.preview8x.png 생성 완료`);
