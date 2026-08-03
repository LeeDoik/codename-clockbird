/**
 * 캐릭터 스프라이트시트의 자홍(마젠타) 테두리를 지운다.
 *
 * 원본 일러스트에서 배경을 뺄 때 알파를 0/255 로 하드컷 해서, 인물 외곽에 남아 있던
 * 배경 색 후광이 "불투명한 자홍 픽셀"로 굳어 버렸다. 시트 전체에 반투명 픽셀이 0개인 게
 * 그 증거다. 게임 화면에서는 캐릭터가 보랏빛 테를 두른 것처럼 보인다.
 *
 * 고치는 방식은 알파를 건드리지 않고 RGB 만 갈아 끼우는 것이다. 후광으로 판정된 픽셀은
 * 가장 가까운 "성한 불투명 이웃"들의 색 평균으로 덮어쓴다. 반경 1(3×3)부터 보고 거기서
 * 못 찾으면 반경을 넓혀 가며, 안쪽이 채워지면 그 색이 다시 바깥 픽셀의 재료가 되도록
 * 여러 번 반복한다(후광이 2px 이상 두꺼운 시트가 있다).
 *
 * 픽셀을 투명하게 만드는 침식(erode)은 쓰지 않는다 — 인물 외곽선을 갉아먹어서 실루엣이
 * 얇아지고, 32×48 로 줄여 쓰는 이 게임에선 바로 티가 난다. 그래서 처리 전후로 불투명
 * 픽셀 수는 정확히 같아야 한다(스크립트가 저장 후 다시 읽어서 직접 검증한다).
 *
 * 후광에는 밝기가 다른 두 켜가 있다:
 *   ① 밝은 켜 (178,2,175) 처럼 쨍한 자홍 — MAGENTA 기준으로 잡는다. 보고용 지표도 이것.
 *   ② 어두운 켜 (110,1,113)·(47,0,46) 처럼 같은 색이 어두운 외곽선 위에 얹힌 것.
 *      밝은 켜만 지우면 이 켜가 그대로 남아 여전히 보랏빛 테로 보인다. 다만 기준을
 *      느슨하게 풀면 진짜 보라색 아트까지 먹을 수 있으니, "초록이 거의 죽고 빨강≈파랑"
 *      이면서 "투명 픽셀에서 2px 안"인 것만 잡는다. 실측상 이 후보의 95~100% 가
 *      실루엣 가장자리에 붙어 있어서 아트가 아니라 후광이 맞다.
 * 두 켜를 한 마스크로 묶어 한꺼번에 메운다 — 안 그러면 밝은 켜를 메울 때 어두운 켜를
 * 재료로 써서 보랏빛이 안쪽으로 번진다.
 *
 * PixelLab 에서 온 그림(*-south.png, player-*.png)은 애초에 후광이 없다 — 배경을
 * 하드컷한 적이 없어서 ①도 ②도 0개다. 굳이 제외하지 않아도 잡히는 픽셀이 없다.
 *
 *   node scripts/defringe-sprites.js            # 기본 대상(npc/·player/) 전부 처리
 *   node scripts/defringe-sprites.js --check    # 안 고치고 수치만 센다
 *   node scripts/defringe-sprites.js a.png b.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 기본 대상 폴더. */
const DIRS = ['src/client/assets/npc', 'src/client/assets/player'];
/** 후광이 없어서 제외하는 파일. */
const SKIP = new Set();

/** 이웃 탐색 최대 반경(체비쇼프). 여기까지도 성한 이웃이 없으면 이번 패스는 건너뛴다. */
const MAX_RADIUS = 4;
/** 반복 상한. 보통 2~3번이면 끝나고, 더 못 고치면 조기 종료한다. */
const MAX_PASSES = 12;
/** 어두운 켜를 후광으로 인정하는 투명 픽셀까지의 거리(체비쇼프). */
const EDGE_REACH = 2;

/**
 * 밝은 자홍 판정 — 보고용 지표. 이 기준을 바꾸면 전후 수치를 비교할 수 없으니 손대지 마라.
 * 빨강·파랑이 둘 다 높고 초록만 푹 꺼진 색 = 배경 후광.
 */
export function isMagenta(r, g, b, a) {
  return a !== 0 && r > 110 && b > 110 && g < Math.min(r, b) - 45;
}

/**
 * 어두운 자홍 판정 — 같은 후광이 어두운 외곽선 위에 얹혀 밝기만 떨어진 것.
 * 초록이 빨강·파랑의 1/4 미만이고 빨강≈파랑일 때만. 이 조건에 진짜 아트가 걸리는 일은
 * 실측상 없었다(officer 의 보라 계열 (94,31,95) 은 초록이 살아 있어서 안 걸린다).
 */
export function isDimMagenta(r, g, b, a) {
  return (
    a !== 0 &&
    Math.min(r, b) > 24 &&
    g < Math.min(r, b) * 0.25 &&
    Math.abs(r - b) <= Math.max(10, 0.12 * Math.max(r, b))
  );
}

/** 시트 하나의 자홍(밝은/어두운)·불투명 픽셀 수를 센다. */
export function countPixels(w, h, data) {
  const edge = edgeMask(w, h, data);
  let magenta = 0;
  let dim = 0;
  let opaque = 0;
  for (let p = 0; p < w * h; p++) {
    const o = p * 4;
    const [r, g, b, a] = [data[o], data[o + 1], data[o + 2], data[o + 3]];
    if (a !== 0) opaque++;
    if (isMagenta(r, g, b, a)) magenta++;
    else if (edge[p] && isDimMagenta(r, g, b, a)) dim++;
  }
  return { magenta, dim, opaque };
}

/** 투명 픽셀에서 EDGE_REACH 안에 있는가 — 실루엣 가장자리 마스크. */
function edgeMask(w, h, data) {
  const clear = new Uint8Array(w * h); // 1 = 투명
  for (let p = 0; p < w * h; p++) clear[p] = data[p * 4 + 3] === 0 ? 1 : 0;
  // 가로·세로로 나눠 훑는 분리형 팽창(dilate) — 시트가 11264px 라 2중 루프는 느리다
  const rowd = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let d = -EDGE_REACH; d <= EDGE_REACH && !v; d++) {
        const nx = x + d;
        if (nx >= 0 && nx < w && clear[y * w + nx]) v = 1;
      }
      rowd[y * w + x] = v;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let d = -EDGE_REACH; d <= EDGE_REACH && !v; d++) {
        const ny = y + d;
        if (ny >= 0 && ny < h && rowd[ny * w + x]) v = 1;
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/**
 * 후광 픽셀의 RGB 를 이웃 색으로 덮어쓴다. 알파는 읽기만 하고 절대 쓰지 않는다.
 * 한 패스 안에서는 이전 패스의 스냅샷만 보고 계산해서, 픽셀을 훑는 순서에 결과가
 * 휘둘리지 않게 한다(안 그러면 왼쪽 위에서 오른쪽 아래로 색이 질질 끌린다).
 */
export function defringe(w, h, data) {
  const passes = [];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const src = Uint8ClampedArray.from(data); // 참조용 스냅샷
    const edge = edgeMask(w, h, src);
    const bad = new Uint8Array(w * h);
    const todo = [];
    for (let p = 0; p < w * h; p++) {
      const o = p * 4;
      const [r, g, b, a] = [src[o], src[o + 1], src[o + 2], src[o + 3]];
      if (isMagenta(r, g, b, a) || (edge[p] && isDimMagenta(r, g, b, a))) {
        bad[p] = 1;
        todo.push(p);
      }
    }
    if (!todo.length) break;

    let fixed = 0;
    let changed = 0;
    for (const p of todo) {
      const cx = p % w;
      const cy = (p / w) | 0;
      // 가까운 고리부터 본다 — 반경 1에 성한 이웃이 있으면 거기서 끝낸다.
      for (let rad = 1; rad <= MAX_RADIUS; rad++) {
        let sr = 0, sg = 0, sb = 0, wt = 0;
        for (let dy = -rad; dy <= rad; dy++) {
          const y = cy + dy;
          if (y < 0 || y >= h) continue;
          for (let dx = -rad; dx <= rad; dx++) {
            // rad>1 이면 이미 안쪽 고리는 다 봤으니 바깥 고리만 훑는다
            if (rad > 1 && Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
            const x = cx + dx;
            if (x < 0 || x >= w || (dx === 0 && dy === 0)) continue;
            const q = y * w + x;
            if (bad[q]) continue;            // 후광 이웃은 재료로 안 쓴다
            const o = q * 4;
            if (src[o + 3] === 0) continue;  // 투명 이웃도 안 쓴다(배경색이 배어 나온다)
            const k = 1 / Math.hypot(dx, dy); // 가까울수록 세게
            sr += src[o] * k;
            sg += src[o + 1] * k;
            sb += src[o + 2] * k;
            wt += k;
          }
        }
        if (wt > 0) {
          const o = p * 4;
          const nr = Math.round(sr / wt);
          const ng = Math.round(sg / wt);
          const nb = Math.round(sb / wt);
          if (nr !== data[o] || ng !== data[o + 1] || nb !== data[o + 2]) changed++;
          data[o] = nr;
          data[o + 1] = ng;
          data[o + 2] = nb;
          fixed++;
          break;
        }
      }
    }
    passes.push({ pass: pass + 1, targets: todo.length, fixed, changed });
    // 아무 픽셀도 실제로 안 바뀌었으면 수렴한 것이다. 여기서 멈추지 않으면
    // 판정에 계속 걸리지만(거의 검정에 가까운 옅은 자주색 외곽선) 이웃 평균이
    // 자기 자신인 픽셀들 때문에 상한까지 헛돈다.
    if (!changed) break;
  }
  return passes;
}

function listTargets() {
  const out = [];
  for (const d of DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.toLowerCase().endsWith('.png') && !SKIP.has(f)) out.push(path.join(abs, f));
    }
  }
  return out;
}

function run(files, { check }) {
  const rows = [];
  for (const file of files) {
    const raw = fs.readFileSync(file);
    const { w, h, data } = decodePng(raw);
    const before = countPixels(w, h, data);
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');

    if (check || (!before.magenta && !before.dim)) {
      rows.push({ rel, w, h, bytes: [raw.length, raw.length], before, after: before, passes: 0, skipped: !check });
      continue;
    }

    const passes = defringe(w, h, data);
    if (countPixels(w, h, data).opaque !== before.opaque) {
      throw new Error(`${rel}: 불투명 픽셀 수가 달라졌다 — 알파를 건드렸다`);
    }
    fs.writeFileSync(file, encodePng(w, h, data));

    // 저장한 파일을 다시 읽어 크기·알파가 그대로인지 확인한다
    const back = fs.readFileSync(file);
    const dec = decodePng(back);
    if (dec.w !== w || dec.h !== h) throw new Error(`${rel}: 해상도가 바뀌었다`);
    const after = countPixels(dec.w, dec.h, dec.data);
    if (after.opaque !== before.opaque) throw new Error(`${rel}: 저장 후 불투명 픽셀 수가 달라졌다`);
    rows.push({ rel, w, h, bytes: [raw.length, back.length], before, after, passes: passes.length, skipped: false });
  }

  const pad = Math.max(...rows.map((r) => r.rel.length));
  const cell = (v, n) => String(v).padStart(n);
  console.log(
    `${'파일'.padEnd(pad)}  ${'크기'.padEnd(10)} 자홍(전→후)   어두운(전→후)  ` +
      `${'불투명(전)'.padStart(10)} ${'불투명(후)'.padStart(10)}  패스`,
  );
  for (const r of rows) {
    console.log(
      `${r.rel.padEnd(pad)}  ${`${r.w}×${r.h}`.padEnd(10)} ` +
        `${cell(r.before.magenta, 5)}→${cell(r.after.magenta, 4)}   ${cell(r.before.dim, 6)}→${cell(r.after.dim, 4)}  ` +
        `${cell(r.before.opaque, 10)} ${cell(r.after.opaque, 10)}  ${r.skipped ? '건너뜀' : r.passes}`,
    );
  }
  const left = rows.reduce((s, r) => s + r.after.magenta + r.after.dim, 0);
  const alphaOk = rows.every((r) => r.before.opaque === r.after.opaque);
  console.log(`\n남은 후광 ${left}개 / 알파 보존 ${alphaOk ? 'OK' : '깨짐'}`);
  return rows;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const named = args.filter((a) => !a.startsWith('--')).map((a) => path.resolve(ROOT, a));
  run(named.length ? named : listTargets(), { check });
}
