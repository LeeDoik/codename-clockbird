/**
 * 탈출 맵의 좌표와 상수 — **단일 출처**.
 *
 * Phaser 도 JSON 도 import 하지 않는다. 그래서 브라우저(EscapeScene)와 node
 * (gen-escape-map.js · check-escape-spawn.js) 양쪽에서 같은 파일이 그대로 돈다.
 *
 * escape.json 을 읽지 않는 이유: Vite 는 JSON 을 그냥 import 하지만 Node 22 는
 * `with { type: 'json' }` 을 요구해서 한 파일이 양쪽에서 못 돈다. 대신 TILE 을
 * 리터럴로 두고 **escape.json 을 이 파일에서 굽는다** — 출처가 위에서 아래로 흐른다.
 *
 * 좌표를 씬과 검증 스크립트에 나눠 적으면 한쪽만 고쳐도 아무도 모른다.
 * 그러면 "체크포인트가 콘 밖인가" 검사가 실제와 다른 좌표를 재게 된다.
 */

export const TILE = 32;
export const COLS = 60;
export const ROWS = 34;

/**
 * 인물이 화면에 보일 높이(월드 px). escape.json 의 `charHeight` 로 구워져 씬과
 * worldParts(발밑 판정 크기)가 같이 읽는다 — worldParts.DEFAULT_CHAR_HEIGHT 참고.
 */
export const CHAR_HEIGHT = 32;

/** 타일 좌표 → 픽셀 중심 */
export const at = (col, row) => ({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 });

/** 걸을 수 있는 사각형들. [col, row, w, h] — 스펙 §3 의 구간 표. */
export const CORRIDORS = [
  { name: 'top', rect: [2, 2, 49, 5] },
  { name: 'rightV', rect: [46, 2, 5, 15] },
  { name: 'mid', rect: [5, 12, 46, 5] },
  { name: 'leftV', rect: [5, 12, 5, 16] },
  { name: 'bottom', rect: [5, 23, 48, 5] },
  { name: 'hall', rect: [48, 20, 11, 12] },
];

/** 각 구간의 진입점 — 발각 시 여기로 돌아온다 (스펙 §3). */
export const CHECKPOINTS = [
  { col: 4, row: 4 },
  { col: 48, row: 4 },
  { col: 48, row: 14 },
  { col: 7, row: 14 },
  { col: 7, row: 25 },
];

/**
 * 순찰 경로 — 구간마다 1기. 순찰 폭 24칸(768px)이라 왕복 약 17초다.
 * 양 끝을 구간 안쪽으로 물려 굽이(코너)에는 콘이 닿지 않게 한다 — 코너는 플레이어가
 * 다음 구간을 살피는 자리라, 여기가 막히면 진입 자체가 도박이 된다.
 * 중단은 반대 방향으로 출발시켜 위상을 어긋나게 둔다.
 */
export const SENTRY_ROUTES = [
  [at(14, 4), at(38, 4)],
  [at(38, 14), at(14, 14)],
  [at(16, 25), at(40, 25)],
];

/** 심문실 — 꼬마가 서 있는 자리. 여기 닿으면 심문이 시작된다. */
export const CHILD = { col: 53, row: 26 };

// ── 감지 상수 (Sentry 와 검증 스크립트가 같은 값을 봐야 한다) ──
/** 이동 속도 (px/s). 플레이어(200)의 45% — 마주쳐도 뒤로 빼서 엄폐물까지 갈 수 있어야 한다. */
export const SENTRY_SPEED = 90;
/** 부채꼴 각 (도) */
export const CONE_ANGLE = 70;
/** 시야 거리 (px) — 약 7칸 */
export const CONE_RANGE = 220;
/** 끝점에서 멈춰 콘이 도는 시간 (ms) */
export const TURN_PAUSE_MS = 1500;
