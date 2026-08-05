/**
 * 걷는 칸 격자 위의 무작위 순회 경로.
 *
 * Phaser 도 JSON 도 import 하지 않는다 — los.js 와 같은 이유다. 순수 함수라 node 에서
 * 그대로 돌고(검증 스크립트), 길찾기는 눈으로 확인하기 어려운 규칙이라 그 값이 크다.
 *
 * ── 왜 길찾기가 필요한가 ──
 *
 * 이 게임의 로봇은 길을 찾지 않는다. 웨이포인트 두 점 사이를 **직선으로** 오갈 뿐이라,
 * 지금까지는 경로가 지나는 칸이 전부 걸을 수 있도록 사람이 좌표를 골라 줘야 했다
 * (streetLayout·escapeLayout 의 경로 주석). 목적지를 무작위로 뽑는 순간 그 전제가
 * 깨진다 — 물웅덩이 건너편을 찍으면 로봇이 물 위를 가로질러 간다.
 *
 * 그래서 목적지만 뽑는 게 아니라 **거기까지 가는 길**을 같이 준다. 길은 꺾이는 칸만
 * 남기므로, 로봇은 지금까지처럼 직선 구간만 이어 달리면 된다. 각 직선 구간은 이웃한
 * 걷는 칸들의 한가운데를 잇는 선이라 벽을 스치지 않는다.
 *
 * 대각선을 쓰지 않는 것도 같은 이유다 — 대각으로 이으면 벽 모서리를 대각선이
 * 가로지르는 자리가 생긴다.
 */

/** 상하좌우. 대각선은 위 머리말 참고 — 모서리를 뚫는다. */
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * 꺾이는 칸만 남긴다.
 *
 * BFS 가 준 것은 칸 하나하나의 목록이라 그대로 쓰면 웨이포인트가 수십 개가 된다.
 * 직선으로 이어지는 구간은 양 끝만 있으면 같은 길이다.
 */
function keepCorners(cells, from) {
  const out = [];
  let prev = from;
  for (let i = 0; i < cells.length; i++) {
    const cur = cells[i];
    const next = cells[i + 1];
    if (!next) {
      out.push(cur); // 목적지는 언제나 남긴다
      break;
    }
    const inC = cur.col - prev.col;
    const inR = cur.row - prev.row;
    const outC = next.col - cur.col;
    const outR = next.row - cur.row;
    if (inC !== outC || inR !== outR) out.push(cur);
    prev = cur;
  }
  return out;
}

/**
 * from 칸에서 갈 수 있는 칸을 전부 너비 우선으로 훑는다.
 *
 * "아무 칸이나 찍고 길이 있나 확인"을 반복하는 것보다 확실하다. 이 맵에는 못 닿는
 * 구역이 실제로 있어서 (가운데 세로 통로가 19행에서 끊겨 위쪽에 매달린 막다른 골목),
 * 그런 칸을 찍으면 영영 못 가는 목적지가 된다.
 *
 * 검증 스크립트가 "로봇이 맵의 몇 %에 닿는가"를 재는 데도 같은 함수를 쓴다 —
 * 실제로 순회에 쓰이는 격자와 다른 격자를 재면 검사의 뜻이 없다.
 *
 * @param {{col: number, row: number}} from
 * @param {{cols: number, rows: number, isBlocked: (c: number, r: number) => boolean}} opts
 * @returns {{dist: Int32Array, prev: Int32Array, start: number, cols: number}}
 *   dist·prev 는 `row * cols + col` 로 색인한다. 못 닿는 칸은 dist −1.
 */
export function walkField(from, { cols, rows, isBlocked }) {
  const size = cols * rows;
  const prev = new Int32Array(size).fill(-1);
  const dist = new Int32Array(size).fill(-1);
  const start = from.row * cols + from.col;
  if (from.col < 0 || from.row < 0 || from.col >= cols || from.row >= rows) {
    return { dist, prev, start: -1, cols };
  }

  dist[start] = 0;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const c = cur % cols;
    const r = (cur - c) / cols;
    for (const [dc, dr] of DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const idx = nr * cols + nc;
      if (dist[idx] !== -1 || isBlocked(nc, nr)) continue;
      dist[idx] = dist[cur] + 1;
      prev[idx] = cur;
      queue.push(idx);
    }
  }
  return { dist, prev, start, cols };
}

/**
 * from 칸에서 갈 수 있는 곳 하나를 무작위로 골라, 거기까지의 길을 돌려준다.
 *
 * @param {{col: number, row: number}} from 출발 칸
 * @param {object} opts
 * @param {number} opts.cols
 * @param {number} opts.rows
 * @param {(col: number, row: number) => boolean} opts.isBlocked 막힌 칸이면 true
 * @param {number} [opts.minSteps] 이만큼은 떨어진 곳을 고른다 (칸 수). 그만큼 먼 칸이
 *   하나도 없으면 가까운 곳에서 고른다 — 길이 막혀 갇혔을 때 아예 못 움직이는 것보다 낫다.
 * @param {() => number} [opts.random] 0~1. 시험에서 갈아 끼울 수 있게 받는다.
 * @returns {{col: number, row: number}[]} 꺾이는 칸과 목적지. 갈 곳이 없으면 빈 배열.
 */
export function randomRoamPath(from, { cols, rows, isBlocked, minSteps = 0, random = Math.random }) {
  const { dist, prev, start } = walkField(from, { cols, rows, isBlocked });
  if (start < 0) return [];

  const far = []; // minSteps 이상 떨어진 칸
  const near = []; // 그보다 가까운 칸 (far 가 비었을 때의 대비책)
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] < 0 || i === start) continue;
    (dist[i] >= minSteps ? far : near).push(i);
  }

  const pool = far.length ? far : near;
  if (!pool.length) return [];

  const goal = pool[Math.floor(random() * pool.length)];
  const cells = [];
  for (let cur = goal; cur !== start && cur !== -1; cur = prev[cur]) {
    const c = cur % cols;
    cells.push({ col: c, row: (cur - c) / cols });
  }
  cells.reverse();
  return keepCorners(cells, from);
}
