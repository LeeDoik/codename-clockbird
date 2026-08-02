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
export const COLS = 54;
export const ROWS = 42;

/**
 * 인물이 화면에 보일 높이(월드 px). escape.json 의 `charHeight` 로 구워져 씬과
 * worldParts(발밑 판정 크기)가 같이 읽는다 — worldParts.DEFAULT_CHAR_HEIGHT 참고.
 */
export const CHAR_HEIGHT = 88;
/** 카메라 배율. charHeight × cameraZoom ≈ 100~130 이 눈에 맞는 구간이다 (docs/맵교체_계획.md §1). */
export const CAMERA_ZOOM = 1;

/** 타일 좌표 → 픽셀 중심 */
export const at = (col, row) => ({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 });

/**
 * 걷는 길은 이제 **그림이 정한다** — escape-props.json 의 walk 가 유일한 출처다
 * (배경이 붙기 전까지는 여기 CORRIDORS 사각형이 그 역할을 했다).
 * 수로 그림은 물(청록)과 돌길(황갈)이 색으로 갈려서 scripts/walkmask.js 의 seed 가
 * 기계로 뽑는다. escape.json 의 layout 은 바깥 테두리만 solid 인 껍데기로 남는다.
 */

/**
 * 각 구간의 진입점 — 발각 시 여기로 돌아온다 (스펙 §3).
 *
 * 수로는 물웅덩이 네 개를 도는 순환 구조다. 바깥 통로(폭 6칸)와 가운데 십자 복도가
 * 걸을 수 있는 전부라, 진입점은 **순찰이 도는 가로 복도가 아닌 세로 통로**에 둔다 —
 * 통로가 좁아 같은 띠 안에 있으면 로봇이 끝점에서 도는 동안 콘에 쓸린다.
 */
export const CHECKPOINTS = [
  { col: 26, row: 2 },  // 북쪽 배수구 아래 — 시작
  { col: 2, row: 10 },  // 서편 위
  { col: 2, row: 31 },  // 서편 아래
  { col: 51, row: 31 }, // 동편 아래
  { col: 51, row: 10 }, // 동편 위
];

/**
 * 순찰 경로 — 물웅덩이 사이를 가르는 십자 복도를 왕복한다. 세로 하나 + 가로 둘이라
 * 어느 쪽으로 내려가든 한 번은 마주친다. 가운데 가로 축만 반대 방향으로 출발시켜
 * 위상을 어긋나게 둔다.
 * 북쪽 복도(1~6행)에는 두지 않는다 — 통로가 6칸뿐이라 로봇이 끝점에서 도는 동안
 * 배수구 아래 시작 지점이 콘에 쓸린다 (check:escape 가 실제로 잡아냈다).
 * 좌표는 walk 격자에서 34칸 이상 이어지는 직선만 후보로 놓고 골랐다 — 전 구간이
 * 걷는 칸 위에 있는 것을 확인했다.
 */
export const SENTRY_ROUTES = [
  [at(26, 12), at(26, 34)],
  [at(42, 24), at(12, 24)],
  [at(12, 39), at(42, 39)],
];

/** 심문실 — 꼬마가 서 있는 자리. 남쪽 수문 앞이다. 여기 닿으면 심문이 시작된다. */
export const CHILD = { col: 26, row: 40 };

// ── 감지 상수 (Sentry 와 검증 스크립트가 같은 값을 봐야 한다) ──
/** 이동 속도 (px/s). 플레이어(200)의 45% — 마주쳐도 뒤로 빼서 엄폐물까지 갈 수 있어야 한다. */
export const SENTRY_SPEED = 90;
/** 부채꼴 각 (도) */
export const CONE_ANGLE = 70;
/** 시야 거리 (px) — 약 7칸 */
export const CONE_RANGE = 220;
/** 끝점에서 멈춰 콘이 도는 시간 (ms) */
export const TURN_PAUSE_MS = 1500;
