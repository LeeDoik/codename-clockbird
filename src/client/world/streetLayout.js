/**
 * 거리(스테이지 1) 순찰 명세 — 좌표와 밸런스 상수의 단일 출처.
 *
 * Phaser 도 JSON 도 import 하지 않는다 — 브라우저(Patrol.js)와 node(check-spawn-safety.js)가
 * **같은 파일**을 읽어야 하기 때문이다. 지금까지는 순찰 경로가 두 곳에 손으로 적혀 있었고
 * (`Patrol.js` 와 `check-spawn-safety.js` 상단), 한쪽만 고치면 검사가 옛 경로를 재면서도
 * 통과했다. 스폰이 안전한지는 걸어 보기 전엔 모르는 종류의 규칙이라 그 침묵이 특히 나쁘다.
 * escapeLayout.js 가 탈출 맵에 하는 일을 거리에 대해 한다.
 *
 * 픽셀이 아니라 **타일 좌표**로 적는다 — 맵의 tileSize 는 맵 json 이 정하고, 변환은
 * routeToPixels 로 쓰는 쪽에서 한다. TILE 상수를 여기 또 적으면 그게 세 번째 사본이 된다.
 */

/**
 * 순찰 경로 — 각 원소는 `[col, row]` 왕복 웨이포인트다.
 *
 * 상주 셋 + 증원 하나로 나눈 이유: 맵이 넓어 한 기로는 존재감이 없고, 그렇다고 처음부터
 * 넷을 돌리면 조용히 푸는 판에서도 검문이 잦아진다. 넷째는 경계 2(증원 단계)부터 붙어,
 * 소동을 일으킨 판에서만 축이 하나 더 생긴다.
 */
export const PATROL_ROUTES = {
  avenue: [[19, 6], [19, 42]], // 세로 축 — 중앙 대로를 오르내린다
  crossing: [[6, 15], [54, 15]], // 가로 축 — 시가지를 가로지른다
  wharf: [[52, 31], [24, 31]], // 아래쪽 가로 축 — 부두 방면
  reinforce: [[39, 8], [39, 40]], // 증원 — 경계 2 이상에서만
};

/** 증원이 붙는 경계 레벨 (스토리보드: 레벨 2 = 증원) */
export const REINFORCE_AT = 2;

/**
 * 밸런스 상수 — 플레이테스트 후 손댈 곳이 여기뿐이어야 한다.
 * 순찰 속도는 어떤 경계 레벨에서도 플레이어(200)보다 느리다 — 걸리면 무조건 검문이지
 * 도망칠 방법이 없는 게임은 만들지 않는다.
 */
export const SPEED_BASE = 60;
export const SPEED_PER_LEVEL = 15;

/**
 * 감지 반경.
 *
 * 로봇은 눈이 아니라 **감지기**로 사람을 찾는다 — 그래서 앞뒤를 가리지 않는 원이다.
 * 부채꼴이던 때는 뒤로 돌아가면 코앞에서도 안 걸려, 로봇을 피하는 것이 아니라 등 뒤에
 * 붙어 따라다니는 것이 최적 전략이 됐다.
 */
export const RADIUS_BASE = 150;
export const RADIUS_PER_LEVEL = 26;

/** 경계 레벨이 아무리 올라도 이 이상 빨라지지 않는다. 레벨 3 은 발각 즉사 단계다. */
export const MAX_LEVEL = 3;

/** 어떤 경계 레벨에서도 넘지 않는 감지 반경 — 스폰 안전 검사의 기준이다. */
export const RADIUS_MAX = RADIUS_BASE + RADIUS_PER_LEVEL * MAX_LEVEL;

/** 타일 좌표 경로 → 픽셀 웨이포인트 (칸 중앙) */
export const routeToPixels = (route, tileSize) =>
  route.map(([col, row]) => ({
    x: col * tileSize + tileSize / 2,
    y: row * tileSize + tileSize / 2,
  }));
