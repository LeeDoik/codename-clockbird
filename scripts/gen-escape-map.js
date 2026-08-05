/**
 * 탈출 맵 생성 — 코드네임: 태엽새
 *
 *   node scripts/gen-escape-map.js
 *
 * escapeLayout.js 의 크기·상수를 escape.json 으로 굽는다. 좌표를 씬과 검증 스크립트에
 * 나눠 적으면 한쪽만 고쳐도 아무도 모른다.
 *
 * 2026-08-02 수로 그림이 붙으면서 충돌은 walkmask(escape-props.json)로 넘어갔다 —
 * layout 은 바깥 테두리만 solid 인 껍데기다 (worldParts.buildColliders 가 walk 를 우선).
 */
import { writeFile } from 'node:fs/promises';
import { CAMERA_ZOOM, CHAR_HEIGHT, COLS, ROWS, SPAWN, TILE } from '../src/client/world/escapeLayout.js';

// 바깥 테두리만 solid 인 껍데기 — 충돌은 escape-props.json 의 walk 가 정한다
// (다른 세 맵과 같다). layout 은 walkmask 가 blocked 를 뽑을 때와 시야 폴백에만 쓴다.
const layout = Array.from({ length: ROWS }, (_, r) =>
  Array.from({ length: COLS }, (_, c) => (r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1 ? 1 : 0)),
);

const map = {
  format: 'clockbird-tilemap',
  version: 1,
  _comment:
    '스크립트 생성물 — 손으로 고치지 마라. 좌표의 출처는 src/client/world/escapeLayout.js 이고, ' +
    'node scripts/gen-escape-map.js 로 다시 굽는다.',
  tileSize: TILE,
  charHeight: CHAR_HEIGHT,
  cameraZoom: CAMERA_ZOOM,
  cols: COLS,
  rows: ROWS,
  tileset: 'escape-bg.png',
  tiles: [
    { name: '바닥', solid: false },
    { name: '벽', solid: true },
  ],
  layout,
  // 하드코딩하면 escapeLayout.js 의 SPAWN 을 옮겼을 때 여기만 안 따라가도 아무도
  // 모른다 (Patrol.js<->check-spawn-safety 전례).
  spawns: { player: SPAWN },
};

const out = new URL('../src/client/assets/escape.json', import.meta.url);
await writeFile(out, `${JSON.stringify(map, null, 2)}\n`, 'utf8');

console.log(`escape.json 생성 — ${COLS}×${ROWS} (충돌은 escape-props.json 의 walk)`);
console.log('다음: node scripts/walkmask.js seed escape · import escape');
