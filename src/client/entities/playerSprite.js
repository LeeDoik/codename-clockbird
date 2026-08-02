/**
 * 플레이어 스프라이트의 규격과 애니메이션 키 — **단일 출처**.
 *
 * 플레이어는 튜토리얼부터 엔딩까지 같은 인물이라 다섯 씬이 전부 같은 시트를 쓴다.
 * 그런데 시트 실측값(원점·인물 높이·프레임 크기)과 애니메이션 키가 다섯 곳에 똑같이
 * 적혀 있어서, 시트를 갈아끼울 때마다 다섯 군데를 고쳐야 했다 — 한 곳만 빠뜨리면
 * 그 씬에서만 인물이 땅에 안 붙거나 크기가 어긋나고, 그 씬에 들어가 봐야 안다.
 *
 * 아래 세 숫자는 **scripts/import-player-sprite.js 가 찍어 주는 값**이다.
 * 시트를 다시 구우면 그 출력을 그대로 옮겨 적으면 된다.
 */

/** 시트의 정사각 프레임 한 변 (px) */
export const PLAYER_FRAME_SIZE = 128;
/** 발이 닿는 높이 (프레임 높이 기준 0~1). 스폰 좌표에 이 지점이 놓인다. */
export const PLAYER_ORIGIN_Y = 96 / PLAYER_FRAME_SIZE;
/** 프레임 안 인물의 실제 높이 (px, 정수리~발). 화면 크기 계산의 분모다. */
export const PLAYER_CONTENT_HEIGHT = 64;

/**
 * 애니메이션 키. BootScene 이 이 이름으로 등록하고 씬은 그대로 넘긴다.
 *
 * 대기도 **방향별**이다 — 걷다 멈추면 보던 쪽을 그대로 본다. 예전에는 대기가 한
 * 장뿐이라 왼쪽으로 걷다 멈추면 갑자기 정면을 봤다.
 * `idle` 은 방향을 모를 때의 기본값(아래)이다.
 */
export const PLAYER_ANIM = {
  /**
   * 스프라이트를 만들 때 쓸 **텍스처** 키. 애니메이션 키와 반드시 구분해야 한다 —
   * 예전에는 시트 이름과 애니메이션 이름이 둘 다 `tutorialPlayerIdle` 이라 우연히
   * 통했는데, 이름이 갈라지자 Phaser 가 32×32 대체 텍스처로 배율을 계산해 인물이
   * 4배(88px → 352px)로 그려졌다. 화면으로는 "좀 크네" 정도라 놓치기 쉽다.
   */
  texture: 'playerIdleSheet',
  idle: 'playerIdleDown',
  idleDown: 'playerIdleDown',
  idleUp: 'playerIdleUp',
  idleLeft: 'playerIdleLeft',
  idleRight: 'playerIdleRight',
  walkDown: 'playerWalkDown',
  walkUp: 'playerWalkUp',
  walkLeft: 'playerWalkLeft',
  walkRight: 'playerWalkRight',
};

/**
 * 시트 안 프레임 배치 — BootScene 이 애니메이션을 등록할 때 쓴다.
 * import-player-sprite.js 가 이 순서로 굽는다 (아래·위·왼·오).
 */
export const PLAYER_IDLE_FRAMES = { Down: 0, Up: 1, Left: 2, Right: 3 };
export const PLAYER_WALK_RANGES = {
  Down: [0, 7],
  Up: [8, 15],
  Left: [16, 23],
  Right: [24, 31],
};
