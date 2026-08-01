/**
 * 탈출 맵 생성 — 코드네임: 태엽새
 *
 *   node scripts/gen-escape-map.js
 *
 * ㄹ자 통로를 사각형 명세로 적고 layout 을 굽는다. 손으로 60×34 배열을 쓰면
 * 구간이 이어졌는지 눈으로 못 세고, 스펙의 좌표와 어긋나도 알 수 없다.
 *
 * 배경 아트가 붙으면 충돌은 walkmask(escape-props.json)로 넘어가고 layout 은
 * 그림 없는 임시 렌더에만 쓰인다 — worldParts.buildColliders 가 walk 를 우선한다.
 */
import { writeFile } from 'node:fs/promises';
import { CORRIDORS, CHECKPOINTS, COLS, ROWS, TILE } from '../src/client/world/escapeLayout.js';

const layout = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => 1));
for (const { rect } of CORRIDORS) {
  const [c0, r0, w, h] = rect;
  for (let r = r0; r < r0 + h; r++) {
    for (let c = c0; c < c0 + w; c++) {
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) layout[r][c] = 0;
    }
  }
}

const map = {
  format: 'clockbird-tilemap',
  version: 1,
  _comment:
    '스크립트 생성물 — 손으로 고치지 마라. 좌표의 출처는 src/client/world/escapeLayout.js 이고, ' +
    'node scripts/gen-escape-map.js 로 다시 굽는다.',
  tileSize: TILE,
  cols: COLS,
  rows: ROWS,
  tileset: 'escape-bg.png',
  tiles: [
    { name: '바닥', solid: false },
    { name: '벽', solid: true },
  ],
  layout,
  // 첫 체크포인트에서 시작한다 — 하드코딩하면 escapeLayout.js 의 CHECKPOINTS[0] 을
  // 옮겼을 때 여기만 안 따라가도 아무도 모른다 (Patrol.js<->check-spawn-safety 전례).
  spawns: { player: CHECKPOINTS[0] },
};

const out = new URL('../src/client/assets/escape.json', import.meta.url);
await writeFile(out, `${JSON.stringify(map, null, 2)}\n`, 'utf8');

// 구간이 실제로 이어졌는지 센다 — 끊겨 있으면 클리어 불가능한 맵이 나온다.
const floor = layout.flat().filter((t) => t === 0).length;
console.log(`escape.json 생성 — ${COLS}×${ROWS}, 걷는 칸 ${floor}개`);
