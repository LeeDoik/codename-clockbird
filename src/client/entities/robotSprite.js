/**
 * 순찰 로봇 스프라이트의 규격과 애니메이션 키 — **단일 출처**.
 *
 * 거리(스테이지 1)의 경비 로봇이다. 탈출(스테이지 3)의 Sentry 는 아직 chars.png
 * 7번 프레임을 쓴다 — 그쪽 로봇 그림은 따로 받기로 되어 있다.
 *
 * 아래 세 숫자는 **scripts/import-actor-sprites.js robot 이 찍어 주는 값**이다.
 * 시트를 다시 구우면 그 출력을 그대로 옮겨 적으면 된다.
 *
 * 구조는 playerSprite.js 와 같다 — 방향 넷의 대기 한 장씩과 걷기 여덟 장씩. 로봇도
 * 경로를 따라 걸어다니므로 사람과 같은 규칙이 그대로 필요하다.
 */

/** 시트의 정사각 프레임 한 변 (px) */
export const ROBOT_FRAME_SIZE = 220;
/** 발이 닿는 높이 (프레임 높이 기준 0~1). 순찰 좌표에 이 지점이 놓인다. */
export const ROBOT_ORIGIN_Y = 172 / ROBOT_FRAME_SIZE;
/**
 * 프레임 안 로봇의 실제 높이 (px, 정수리~발). 화면 크기 계산의 분모다.
 * 정면 걷기 기준이다 — 옆모습은 팔을 뻗어 실루엣이 몇 px 높은데, 그쪽을 기준으로
 * 삼으면 정면이 그만큼 작아진다.
 */
export const ROBOT_CONTENT_HEIGHT = 119;

/** 애니메이션 키. BootScene 이 이 이름으로 등록하고 Patrol 이 그대로 쓴다. */
export const ROBOT_ANIM = {
  /** 스프라이트를 만들 때 쓸 **텍스처** 키 — 애니메이션 키와 다르다(playerSprite.js 주석 참고). */
  texture: 'robotIdleSheet',
  walkSheet: 'robotWalkSheet',
  idleDown: 'robotIdleDown',
  idleUp: 'robotIdleUp',
  idleLeft: 'robotIdleLeft',
  idleRight: 'robotIdleRight',
  walkDown: 'robotWalkDown',
  walkUp: 'robotWalkUp',
  walkLeft: 'robotWalkLeft',
  walkRight: 'robotWalkRight',
};

/**
 * 시트 안 프레임 배치 — BootScene 이 애니메이션을 등록할 때 쓴다.
 * import-actor-sprites.js 가 이 순서로 굽는다 (아래·위·왼·오).
 *
 * 걷기 시트는 방향마다 한 줄인 8×4 격자다 (한 줄로 이으면 7040px 이라 최대 텍스처
 * 한 변이 4096 인 기기에서 안 뜬다). Phaser 는 왼→오, 위→아래로 세므로 번호는
 * 한 줄일 때와 같다.
 */
export const ROBOT_IDLE_FRAMES = { Down: 0, Up: 1, Left: 2, Right: 3 };
export const ROBOT_WALK_RANGES = {
  Down: [0, 7],
  Up: [8, 15],
  Left: [16, 23],
  Right: [24, 31],
};
