/**
 * 에바 스프라이트의 규격과 애니메이션 키 — **단일 출처**.
 *
 * 스테이지 3 심문 상대(설정서 `24_에바`, 안드로이드). 북쪽 배수구 앞 통로에 발을
 * 들이면 나타나 **플레이어 앞까지 걸어온다** — 제자리에 서 있기만 하는 NPC 가 아니라
 * 방향과 걸음이 있는 인물이라, 주인공·로봇과 같은 시트 구조를 쓴다.
 *
 * 아래 세 숫자는 **scripts/import-actor-sprites.js eva 가 찍어 주는 값**이다.
 * 시트를 다시 구우면 그 출력을 그대로 옮겨 적으면 된다.
 *
 * ⚠ 예전에는 기획이 준 256칸 12프레임 숨쉬기 시트 한 벌이었다(방향 없음). 걸어오는
 * 연출이 들어오면서 방향별 걷기가 필요해져 PixelLab 판으로 갈아 끼웠다.
 */

/** 시트의 정사각 프레임 한 변 (px) */
export const EVA_FRAME_SIZE = 192;
/** 발이 닿는 높이 (프레임 높이 기준 0~1). 서 있을 좌표에 이 지점이 놓인다. */
export const EVA_ORIGIN_Y = 144 / EVA_FRAME_SIZE;
/**
 * 프레임 안 인물의 실제 높이 (px, 정수리~발). 화면 크기 계산의 분모다.
 * 정면 걷기 기준이다 — 옆모습은 실루엣이 몇 px 다른데, 그쪽을 기준으로 삼으면
 * 정면이 그만큼 어긋난다.
 */
export const EVA_CONTENT_HEIGHT = 95;

/**
 * 걸어오는 속도 (px/s).
 *
 * 감시 로봇(90)보다 느긋하고 주인공(264)보다 한참 느리다. 쫓아오는 것이 아니라
 * **다가오는** 장면이라 급하면 안 된다 — 이 걸음이 곧 심문 전의 뜸이다.
 */
export const EVA_WALK_SPEED = 70;

/** 애니메이션 키. BootScene 이 이 이름으로 등록하고 EscapeScene 이 그대로 쓴다. */
export const EVA_ANIM = {
  /** 스프라이트를 만들 때 쓸 **텍스처** 키 — 애니메이션 키와 다르다(playerSprite.js 주석 참고). */
  texture: 'evaIdleSheet',
  walkSheet: 'evaWalkSheet',
  idleDown: 'evaIdleDown',
  idleUp: 'evaIdleUp',
  idleLeft: 'evaIdleLeft',
  idleRight: 'evaIdleRight',
  walkDown: 'evaWalkDown',
  walkUp: 'evaWalkUp',
  walkLeft: 'evaWalkLeft',
  walkRight: 'evaWalkRight',
};

/**
 * 시트 안 프레임 배치 — BootScene 이 애니메이션을 등록할 때 쓴다.
 * import-actor-sprites.js 가 이 순서로 굽는다 (아래·위·왼·오).
 * 걷기 시트는 방향마다 한 줄인 8×4 격자다 (한 줄이면 6144px 이라 최대 텍스처 한 변이
 * 4096 인 기기에서 안 뜬다). Phaser 는 왼→오, 위→아래로 세므로 번호는 같다.
 */
export const EVA_IDLE_FRAMES = { Down: 0, Up: 1, Left: 2, Right: 3 };
export const EVA_WALK_RANGES = {
  Down: [0, 7],
  Up: [8, 15],
  Left: [16, 23],
  Right: [24, 31],
};
