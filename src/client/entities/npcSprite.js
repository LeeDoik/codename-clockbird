/**
 * 본부·저택 NPC 정지 스프라이트의 규격 — **단일 출처**.
 *
 * 아래 숫자는 **scripts/import-npc-sprites.js 가 찍어 주는 값**이다.
 * 그림을 다시 구우면 그 출력을 그대로 옮겨 적으면 된다.
 *
 * 플레이어(entities/playerSprite.js)와 같은 이유로 여기에 모아 둔다 — 본부 NPC 는
 * 튜토리얼과 엔딩 두 씬에 나오고, 실측값이 양쪽에 흩어져 있으면 그림을 갈아끼울 때
 * 한 씬만 고치고 다른 씬은 어긋난 채로 남는다.
 *
 * ── 왜 애니메이션 키가 없는가 ──
 *
 * 이 인물들은 **남향 정지 그림 한 장**이다. 게임 안에서 움직이지 않으니 걷기가
 * 필요 없고, 제자리 숨쉬기 루프도 받지 않았다 (PixelLab 크레딧을 아꼈다).
 * 그래서 텍스처 키만 있고 anims 는 등록하지 않는다 — 씬은 play() 를 부르지 않는다.
 */

/** 시트의 정사각 프레임 한 변 (px). 세 인물이 공통으로 쓴다. */
export const NPC_FRAME_SIZE = 204;

/** 발이 닿는 높이 (프레임 높이 기준 0~1). 스폰 좌표에 이 지점이 놓인다. */
export const NPC_ORIGIN_Y = 152 / NPC_FRAME_SIZE;

/**
 * 프레임 안 인물의 실제 높이 (px, 정수리~발). 화면 크기 계산의 분모다.
 *
 * 인물마다 다르다 — 리아(t3)는 두건과 고글이 얹혀 가장 높고(98) 에이다(t1)는 낮게
 * 묶은 머리라 가장 낮다(91). 이 값으로 나눠서 맵의 charHeight 에 맞추므로, 화면에서는
 * 넷이 같은 키로 선다.
 *
 * ⚠ t1·t2·t3 은 **담당 축**의 키다 (색상·분류·특징). 인물 이름이 아니다 —
 * tutorial.json 의 주석 참고.
 */
export const NPC_CONTENT_HEIGHT = {
  // 본부 (튜토리얼·엔딩)
  officer: 94,
  t1: 91,
  t2: 95,
  t3: 98,
  // 저택 (스테이지 2)
  butler: 94,
  cook: 98,
  gardener: 93,
  washer: 97,
  shelver: 95,
  diner: 94,
  cleaner: 97,
  clerk: 93,
  guard: 91,
  coach: 97,
};

/**
 * 스프라이트를 만들 때 쓸 **텍스처** 키. BootScene 이 이 이름으로 로드한다.
 *
 * ⚠ 애니메이션 키와 반드시 구분해야 한다 — 예전에 플레이어에서, 텍스처 자리에
 * 애니메이션 키를 넘겼더니 Phaser 가 32×32 대체 텍스처로 배율을 역산해 인물이
 * 4배로 그려진 적이 있다. 화면으로는 "좀 크네" 정도라 놓치기 쉽다.
 * 여기 인물들은 애니메이션이 아예 없으니 이 키가 유일한 이름이다.
 *
 * 본부 4인과 저택 10인이 모두 여기 있다. 거리(스테이지 1) 동료들은 아직 예전 12프레임
 * 아이들 시트를 쓰므로 이 표에 없다 — 그쪽을 갈아끼울 때 여기에 더하면 된다.
 */
export const NPC_TEXTURE = {
  // 본부 (튜토리얼·엔딩)
  officer: 'officerSouth',
  t1: 't1South',
  t2: 't2South',
  t3: 't3South',
  // 저택 (스테이지 2). 사무엘(shelver)만 북동향이지만 키 이름은 같은 규칙을 따른다.
  butler: 'butlerSouth',
  cook: 'cookSouth',
  gardener: 'gardenerSouth',
  washer: 'washerSouth',
  shelver: 'shelverSouth',
  diner: 'dinerSouth',
  cleaner: 'cleanerSouth',
  clerk: 'clerkSouth',
  guard: 'guardSouth',
  coach: 'coachSouth',
};
