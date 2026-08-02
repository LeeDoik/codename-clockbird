/**
 * 걷는 길 마스크 — 배경 그림 위에 손으로 칠한 색을 그대로 충돌 격자로 바꾼다.
 *
 * 지금까지 걸을 수 있는 칸은 두 군데에 흩어져 있었다: 맵 json 의 layout(solid 타일)과
 * props json 의 blocked(가구가 막는 칸 목록). 둘 다 사람이 좌표로 적은 것이라 그림이
 * 바뀌면 바로 어긋난다 — AI 일러스트 맵으로 넘어온 뒤로는 특히 그렇다.
 * 여기서는 그림 자체를 유일한 원본으로 삼는다. 칠한 색이 곧 판정이다.
 *
 *   node scripts/walkmask.js template <hq|mansion|street>
 *     지금 판정을 그대로 칠해 넣은 밑그림을 design/walkmask/<맵>-walk.png 로 낸다.
 *     배경은 회색조라 초록/빨강이 절대 섞이지 않는다 — 칠한 것만 색이 있다.
 *
 *   node scripts/walkmask.js import <hq|mansion|street>
 *     그 파일을 다시 읽어 props json 의 walk 격자를 갈아끼우고,
 *     실제 배경에 결과를 덮어 그린 확인용 그림(<맵>-walk-applied.png)을 낸다.
 *
 * 칠하는 규칙 — 브러시 색만 맞으면 편집기는 아무거나 상관없다:
 *   초록 계열(G 가 R·B 보다 뚜렷이 높음) = 걸을 수 있다
 *   빨강 계열(R 이 G·B 보다 뚜렷이 높음) = 막힌다
 *   그 밖(회색·투명) = 손대지 않은 것으로 보고 지금 판정을 유지한다
 * 한 칸(그림 32×32px)은 그 안에서 많이 칠해진 쪽으로 정해진다 — 격자선 위로
 * 삐져나온 붓자국이나 안티에일리어싱 가장자리는 알아서 묻힌다.
 *
 * 마스크 크기는 배경과 같지 않아도 된다. 칸 수(cols×rows)로 나눠 읽으므로
 * 배수·약수 어느 쪽으로 리사이즈해도 같은 격자가 나온다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.js';

const MAPS = {
  hq: { map: 'src/client/assets/hq.json', bg: 'src/client/assets/hq-bg.png', props: 'src/client/assets/hq-props.json' },
  mansion: { map: 'src/client/assets/mansion.json', bg: 'src/client/assets/mansion-bg.png', props: 'src/client/assets/mansion-props.json' },
  street: { map: 'src/client/assets/map.json', bg: 'src/client/assets/street-bg.png', props: 'src/client/assets/street-props.json' },
};
const MASK_DIR = 'design/walkmask';

/** 칠한 색으로 볼 최소 채널 차이. 격자선(곱하기로 어둡게 한 것)은 색상비를 지키므로 이 밑으로 안 내려간다. */
const THRESHOLD = 18;
const TINT_WALK = [64, 208, 96];
const TINT_BLOCK = [214, 64, 64];
/** 밑그림에서 색이 배경을 덮는 비율. 밑의 아트가 보일 만큼 옅되, 채널 차이(초록 45·빨강 60)는 THRESHOLD 를 크게 넘는다. */
const TINT_ALPHA = 0.4;

// ── 격자 ──────────────────────────────────────────────────────────

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/**
 * 지금 걸을 수 있는 칸 — props.walk 가 있으면 그게 원본이고,
 * 없으면 옛 방식(layout 의 solid 타일 + props.blocked)에서 만들어 낸다.
 * @returns {Uint8Array[]} rows[r][c] === 1 이면 걸을 수 있다
 */
function currentWalk(map, props) {
  const grid = Array.from({ length: map.rows }, () => new Uint8Array(map.cols));
  if (Array.isArray(props.walk) && props.walk.length === map.rows) {
    for (let r = 0; r < map.rows; r++) for (let c = 0; c < map.cols; c++) grid[r][c] = props.walk[r][c] === '1' ? 1 : 0;
    return grid;
  }
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      const t = map.layout[r][c];
      grid[r][c] = t >= 0 && !map.tiles[t].solid ? 1 : 0;
    }
  }
  for (const [c, r] of props.blocked ?? []) if (r >= 0 && r < map.rows && c >= 0 && c < map.cols) grid[r][c] = 0;
  return grid;
}

/** 플레이어 스폰에서 4방향으로 번져 닿는 칸 수. 칠하다 만든 섬을 잡는다. */
function flood(grid, map) {
  const start = map.spawns?.player;
  if (!start || !grid[start.row]?.[start.col]) return null;
  const seen = Array.from({ length: map.rows }, () => new Uint8Array(map.cols));
  const stack = [[start.col, start.row]];
  seen[start.row][start.col] = 1;
  let n = 1;
  while (stack.length) {
    const [c, r] = stack.pop();
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= map.cols || nr >= map.rows) continue;
      if (seen[nr][nc] || !grid[nr][nc]) continue;
      seen[nr][nc] = 1;
      n++;
      stack.push([nc, nr]);
    }
  }
  return { seen, n };
}

// ── template ──────────────────────────────────────────────────────

function template(name) {
  const cfg = MAPS[name];
  const map = readJson(cfg.map);
  const props = fs.existsSync(cfg.props) ? readJson(cfg.props) : {};
  const bg = decodePng(fs.readFileSync(cfg.bg));
  const grid = currentWalk(map, props);

  const { w, h, data } = bg;
  const out = new Uint8ClampedArray(w * h * 4);
  const cw = w / map.cols, chh = h / map.rows;

  for (let y = 0; y < h; y++) {
    const r = Math.min(map.rows - 1, (y / chh) | 0);
    const rowEdge = y % chh < 1;
    const rowMajor = rowEdge && r % 5 === 0;
    for (let x = 0; x < w; x++) {
      const c = Math.min(map.cols - 1, (x / cw) | 0);
      const i = (y * w + x) * 4;
      // 회색조로 눕힌다 — 배경에 남은 색이 판정에 섞이지 않게. 명암은 오히려 벌려서 가구 윤곽을 살린다.
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const gray = 30 + lum * 0.72;
      const tint = grid[r][c] ? TINT_WALK : TINT_BLOCK;
      // 격자선은 곱하기로만 어둡게 한다 — 채널 비율이 유지돼 색 판정이 흔들리지 않는다.
      const line = (rowMajor || (x % cw < 1 && c % 5 === 0)) ? 0.62 : (rowEdge || x % cw < 1) ? 0.82 : 1;
      for (let k = 0; k < 3; k++) out[i + k] = (gray * (1 - TINT_ALPHA) + tint[k] * TINT_ALPHA) * line;
      out[i + 3] = 255;
    }
  }

  fs.mkdirSync(MASK_DIR, { recursive: true });
  const file = path.join(MASK_DIR, `${name}-walk.png`);
  fs.writeFileSync(file, encodePng(w, h, out));
  let walkable = 0;
  for (const row of grid) for (const v of row) walkable += v;
  console.log(`→ ${file}  (${w}×${h}, ${map.cols}×${map.rows}칸 · 한 칸 ${cw}×${chh}px)`);
  console.log(`   지금 걸을 수 있는 칸 ${walkable} / ${map.cols * map.rows}`);
  console.log('   초록 = 걸을 수 있다 · 빨강 = 막힌다. 고쳐 칠하고 같은 자리에 덮어써라.');
  console.log(`   그 다음: node scripts/walkmask.js import ${name}`);
}

// ── import ────────────────────────────────────────────────────────

function importMask(name) {
  const cfg = MAPS[name];
  const file = path.join(MASK_DIR, `${name}-walk.png`);
  if (!fs.existsSync(file)) throw new Error(`${file} 가 없다 — 먼저 'node scripts/walkmask.js template ${name}' 로 밑그림을 내라`);

  const map = readJson(cfg.map);
  const props = fs.existsSync(cfg.props) ? readJson(cfg.props) : {};
  const before = currentWalk(map, props);
  const mask = decodePng(fs.readFileSync(file));

  const cw = mask.w / map.cols, chh = mask.h / map.rows;
  const grid = Array.from({ length: map.rows }, () => new Uint8Array(map.cols));
  let untouched = 0, changed = 0;

  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      let green = 0, red = 0;
      const y0 = Math.round(r * chh), y1 = Math.round((r + 1) * chh);
      const x0 = Math.round(c * cw), x1 = Math.round((c + 1) * cw);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * mask.w + x) * 4;
          if (mask.data[i + 3] < 100) continue; // 투명 = 손 안 댄 것
          const R = mask.data[i], G = mask.data[i + 1], B = mask.data[i + 2];
          if (G - Math.max(R, B) >= THRESHOLD) green++;
          else if (R - Math.max(G, B) >= THRESHOLD) red++;
        }
      }
      if (green === red) {
        grid[r][c] = before[r][c]; // 안 칠했거나 반반 — 지금 판정을 지킨다
        if (green === 0) untouched++;
      } else grid[r][c] = green > red ? 1 : 0;
      if (grid[r][c] !== before[r][c]) changed++;
    }
  }

  // walk 가 원본이지만, blocked 를 읽는 기존 도구(check-spawn-safety 등)를 위해
  // 옛 형식도 같이 낸다 — layout 이 이미 solid 로 막은 칸은 뺀다(옛 의미 그대로).
  const blocked = [];
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      const t = map.layout[r][c];
      if (!grid[r][c] && t >= 0 && !map.tiles[t].solid) blocked.push([c, r]);
    }
  }

  const next = { ...props };
  next._comment = `걸을 수 있는 칸. ${file} 를 손으로 칠해 scripts/walkmask.js 가 낸다 — 이 파일을 직접 고치지 말고 그림을 고쳐라. walk 가 원본이고 blocked 는 옛 도구용 파생물이다.`;
  next.walk = grid.map((row) => Array.from(row).join(''));
  next.blocked = blocked;
  fs.writeFileSync(cfg.props, JSON.stringify(next) + '\n');

  // 확인용 — 진짜 배경 위에 막힌 칸을 덮어 그린다.
  const bg = decodePng(fs.readFileSync(cfg.bg));
  const bw = bg.w / map.cols, bh = bg.h / map.rows;
  const dbg = Uint8ClampedArray.from(bg.data);
  const reach = flood(grid, map);
  for (let y = 0; y < bg.h; y++) {
    const r = Math.min(map.rows - 1, (y / bh) | 0);
    for (let x = 0; x < bg.w; x++) {
      const c = Math.min(map.cols - 1, (x / bw) | 0);
      if (grid[r][c] && (!reach || reach.seen[r][c])) continue;
      const i = (y * bg.w + x) * 4;
      // 막힌 칸은 빨강, 걸을 수 있는데 스폰에서 못 닿는 섬은 노랑.
      const t = grid[r][c] ? [230, 210, 60] : [220, 50, 50];
      const edge = x % bw < 2 || y % bh < 2 || x % bw >= bw - 2 || y % bh >= bh - 2;
      const k = edge ? 0.72 : 0.38;
      for (let ch = 0; ch < 3; ch++) dbg[i + ch] = dbg[i + ch] * (1 - k) + t[ch] * k;
    }
  }
  const applied = path.join(MASK_DIR, `${name}-walk-applied.png`);
  fs.writeFileSync(applied, encodePng(bg.w, bg.h, dbg));

  let walkable = 0;
  for (const row of grid) for (const v of row) walkable += v;
  console.log(`→ ${cfg.props}  (걸을 수 있는 칸 ${walkable} / ${map.cols * map.rows} · 바뀐 칸 ${changed} · blocked ${blocked.length})`);
  console.log(`→ ${applied}  (빨강 = 막힘 · 노랑 = 걸을 수 있지만 못 닿는 섬)`);
  if (untouched) console.log(`   ⚠ 색이 없어 지금 판정을 그대로 둔 칸 ${untouched} — 밑그림 위에 칠했다면 0 이어야 정상이다`);
  if (!reach) console.log('   ⚠ 플레이어 스폰이 막힌 칸에 있다');
  else if (reach.n < walkable) console.log(`   ⚠ 스폰에서 못 닿는 칸 ${walkable - reach.n} (위 그림에서 노랑)`);
  else console.log('   스폰에서 모든 칸에 닿는다');
}

// ── ─────────────────────────────────────────────────────────────

/**
 * gen-*-art.js 가 props json 을 다시 쓸 때 손으로 칠한 walk 를 지우지 않게 한다.
 * 그림이 바뀌었으면 격자도 다시 칠해야 맞지만, 조용히 날려 버리는 것보다는
 * 남겨 두고 시끄럽게 알리는 쪽이 낫다 — 다시 칠하는 건 비싼 일이다.
 */
export function keepWalk(name) {
  const f = MAPS[name]?.props;
  if (!f || !fs.existsSync(f)) return {};
  const { walk } = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!walk) return {};
  console.warn(
    `\n⚠ ${f} 의 walk(손으로 칠한 걷는 길)를 그대로 남겼다.\n` +
      `  그림이 바뀌었다면 격자는 이제 안 맞는다 — 다시 칠해라:\n` +
      `    node scripts/walkmask.js template ${name}\n` +
      `    node scripts/walkmask.js import ${name}\n`,
  );
  return { walk };
}

// 직접 실행할 때만 CLI 다 (gen-*-art.js 는 keepWalk 만 가져다 쓴다).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, name] = process.argv.slice(2);
  if (!MAPS[name] || (cmd !== 'template' && cmd !== 'import')) {
    console.error(`사용법: node scripts/walkmask.js <template|import> <${Object.keys(MAPS).join('|')}>`);
    process.exit(1);
  }
  try {
    (cmd === 'template' ? template : importMask)(name);
  } catch (e) {
    console.error(`오류: ${e.message}`);
    process.exit(1);
  }
}
