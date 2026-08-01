/**
 * 광선 시야 판정.
 *
 * Phaser 를 import 하지 않는다 — 순수 함수라 node 에서 그대로 돌릴 수 있고
 * (scripts/check-los.js), 시야는 눈으로 확인하기 가장 어려운 규칙이라 그 값이 크다.
 *
 * Patrol(거리, 원형 감지)과 Sentry(탈출, 부채꼴 감지)가 공유한다. 감지 모양은 서로
 * 다르지만 "그 사이를 벽이 막는가" 는 같은 문제다.
 */

/** 광선 샘플 간격 (px). 타일 32px 보다 촘촘해야 벽을 안 뚫는다. */
export const LOS_STEP = 8;

/**
 * 맵에서 "이 칸이 시야를 막는가" 를 묻는 함수를 만든다.
 *
 * **충돌과 같은 원본을 봐야 한다** — worldParts.buildColliders 가 walk 를 쓰면 여기도
 * walk 를 써야 화면에 그려진 벽과 시야 판정이 어긋나지 않는다. 어긋나면 플레이어는
 * 왜 걸렸는지 영영 알 수 없다.
 *
 * @param {object} mapData tileSize·cols·rows·layout·tiles
 * @param {object} [props] *-props.json. walk 가 있으면 그게 유일한 원본이다.
 * @returns {(col: number, row: number) => boolean} 막혀 있으면 true
 */
export function makeBlockedLookup(mapData, props = {}) {
  const { rows, cols, layout, tiles } = mapData;
  const { walk } = props;

  if (Array.isArray(walk) && walk.length === rows) {
    return (col, row) => {
      if (row < 0 || row >= rows || col < 0 || col >= cols) return true;
      return walk[row][col] !== '1';
    };
  }

  return (col, row) => {
    if (row < 0 || row >= rows || col < 0 || col >= cols) return true;
    const t = layout[row]?.[col];
    const tile = tiles[t];
    // 맵 밖·미정의 타일·tiles 배열 범위 밖 인덱스는 모두 막힌 것으로 본다 — 뚫리는
    // 쪽으로 틀리면 벽 관통 감지가 된다.
    if (t === undefined || tile === undefined) return true;
    return Boolean(tile.solid);
  };
}

/**
 * 두 점 사이를 벽이 막지 않는가.
 *
 * 양 끝점은 검사하지 않는다 — 감지자와 대상이 서 있는 칸 자체는 막힘 여부와 무관하다
 * (발밑 판정이 좁아 벽에 살짝 겹쳐 서는 경우가 있다).
 */
export function hasLineOfSight(from, to, tileSize, isBlocked, step = LOS_STEP) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.ceil(Math.hypot(dx, dy) / step);

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const col = Math.floor((from.x + dx * t) / tileSize);
    const row = Math.floor((from.y + dy * t) / tileSize);
    if (isBlocked(col, row)) return false;
  }
  return true;
}

/**
 * from 에서 angle 방향으로 얼마나 멀리 볼 수 있는가 (px).
 * 벽에 막히면 막히기 직전까지의 거리를, 아무것도 없으면 maxDist 를 돌려준다.
 * hasLineOfSight 와 같은 샘플 간격을 써야 그린 콘과 판정이 어긋나지 않는다.
 *
 * 시작점(dist=0)은 검사하지 않는다 — hasLineOfSight 가 감지자가 서 있는 칸을
 * 막힘 여부와 무관하게 두는 것과 같은 이유다.
 */
export function rayDistance(from, angle, maxDist, tileSize, isBlocked, step = LOS_STEP) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let dist = 0;

  while (dist < maxDist) {
    const next = Math.min(dist + step, maxDist);
    const col = Math.floor((from.x + dx * next) / tileSize);
    const row = Math.floor((from.y + dy * next) / tileSize);
    if (isBlocked(col, row)) return dist;
    dist = next;
  }
  return maxDist;
}
