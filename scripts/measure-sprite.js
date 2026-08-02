/**
 * 스프라이트 시트의 인물 영역(알파 경계)을 실측한다.
 *
 * 캐릭터 아트는 256×256(브란트만 432×432) 프레임 안에 인물이 제각각 크기로 들어 있어서,
 * 프레임을 그대로 화면에 올리면 캐릭터마다 키가 들쭉날쭉해진다. 씬 쪽에서 "발바닥을
 * 타일에 붙이고 인물 높이를 N픽셀로 맞추려면" origin 과 배율이 필요한데, 그 근거가 되는
 * 값(인물의 top/bottom)을 여기서 뽑는다.
 *
 * 아이들 모션은 프레임마다 자세가 흔들리므로 전 프레임을 훑어 가장 바깥 경계를 쓴다.
 *
 *   node scripts/measure-sprite.js <시트.png> [프레임크기=256]
 *   node scripts/measure-sprite.js --all            # npc/ 에 적용된 시트 일괄
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

/** 알파가 이 값 이하인 픽셀은 비어 있는 것으로 본다 (외곽 안티에일리어싱 무시). */
const ALPHA_FLOOR = 8;

function decodePng(file) {
  const b = fs.readFileSync(file);
  if (b.readBigUInt64BE(0) !== 0x89504e470d0a1a0an) throw new Error('PNG 가 아니다: ' + file);

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
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`알파 있는 8bit RGBA 만 잰다 (bitDepth=${bitDepth}, colorType=${colorType})`);
  }

  const bpp = 4;
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
        const pa = Math.abs(up - ul);
        const pb = Math.abs(a - ul);
        const pc = Math.abs(a + up - 2 * ul);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : ul;
      }
      px[y * stride + x] = v & 255;
    }
    p += stride;
  }
  return { w, h, stride, px };
}

/**
 * 프레임 안 인물의 상·하단을 프레임 로컬 좌표로 돌려준다.
 * 시트가 6×2 든 12×1 든 프레임 크기만 같으면 결과는 같다.
 */
export function measureSheet(file, frame = 256) {
  const { w, h, stride, px } = decodePng(file);
  if (w % frame || h % frame) throw new Error(`${w}×${h} 가 프레임 ${frame} 로 안 나눠떨어진다`);
  const cols = w / frame;
  const rows = h / frame;

  let top = frame;
  let bottom = -1;
  let left = frame;
  let right = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (let y = 0; y < frame; y++) {
        const gy = r * frame + y;
        for (let x = 0; x < frame; x++) {
          if (px[gy * stride + (c * frame + x) * 4 + 3] <= ALPHA_FLOOR) continue;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
  }
  if (bottom < 0) throw new Error('빈 시트다: ' + file);
  return { frame, cols, rows, frames: cols * rows, top, bottom, left, right, height: bottom - top + 1 };
}

const ALL = 'src/client/assets/npc';

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  const files = args[0] === '--all'
    ? fs.readdirSync(ALL).filter((f) => f.endsWith('.png')).map((f) => `${ALL}/${f}`)
    : [args[0]];
  if (!files[0]) {
    console.error('사용: node scripts/measure-sprite.js <시트.png> [프레임크기] | --all');
    process.exit(1);
  }
  for (const f of files) {
    const frame = Number(args[1]) || (decodePng(f).w % 432 === 0 && decodePng(f).h % 432 === 0 ? 432 : 256);
    const m = measureSheet(f, frame);
    console.log(
      `${path.basename(f).padEnd(20)} ${m.cols}×${m.rows} ${m.frames}프레임 ${m.frame}px  ` +
        `top=${String(m.top).padStart(3)} bottom=${String(m.bottom).padStart(3)} 인물높이=${String(m.height).padStart(3)}`,
    );
  }
}
