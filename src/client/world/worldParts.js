import Phaser from 'phaser';
import { readWalk } from './los.js';

/**
 * 씬 사이에서 공유하는 월드 조각.
 *
 * StageScene 과 TutorialScene 은 규칙(순찰·검문·신뢰도)이 전혀 다르지만, 발밑은 같다 —
 * 같은 포맷의 타일맵을 깔고, 같은 몸으로 걷고, 같은 사거리로 NPC 를 집는다.
 * 그 세 조각만 여기에 둔다. 규칙은 각 씬이 가진다.
 */

/**
 * 타일맵 렌더 + 충돌.
 * map.json 의 layout 을 깔고, solid 타일은 정적 물리 바디로 만들어 플레이어를 막는다.
 * 정적 그룹의 create 는 보이는 스프라이트와 정적 바디를 한 번에 만든다.
 *
 * @param {string} textureKey BootScene 이 로드한 스프라이트시트 키.
 *   거리·본부는 'tiles', 저택은 'mansion' — layout 의 인덱스가 그 시트의 프레임 번호다.
 * @returns {Phaser.Physics.Arcade.StaticGroup} 벽 그룹 (충돌 등록에 쓴다)
 */
export function buildTilemap(scene, mapData, textureKey = 'tiles') {
  const TILE = mapData.tileSize;
  const walls = scene.physics.add.staticGroup();
  const { layout, tiles, rows, cols } = mapData;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const f = layout[r][c];
      if (f < 0) continue; // 빈칸
      if (tiles[f].solid) {
        walls.create(c * TILE + TILE / 2, r * TILE + TILE / 2, textureKey, f);
      } else {
        scene.add.image(c * TILE, r * TILE, textureKey, f).setOrigin(0, 0);
      }
    }
  }

  return walls;
}

/**
 * 보이지 않는 충돌만 세운다 — 그림은 이미 배경 한 장에 구워져 있는 맵용.
 *
 * 저택(스테이지 2)은 바닥·벽·가구·조명을 통째로 구운 이미지를 깔기 때문에 타일을
 * 한 칸씩 그릴 필요가 없다. 그래도 벽은 막아야 하므로 렌더와 충돌을 갈라 놓는다.
 *
 * @param {object} props 맵의 *-props.json. 두 형식을 받는다:
 *   walk 가 있으면 그게 유일한 원본이다 — 배경 그림 위에 손으로 칠한 걷는 길을
 *   scripts/walkmask.js 가 옮겨 적은 행 문자열('1' = 걸을 수 있다)로, layout 의
 *   solid 도 blocked 도 보지 않는다. 그림과 판정이 어긋날 자리가 없어진다.
 *   walk 가 없으면 옛 방식 — layout 의 solid 타일 + blocked(가구가 막는 칸).
 * @returns {Phaser.Physics.Arcade.StaticGroup}
 */
export function buildColliders(scene, mapData, props = {}) {
  const TILE = mapData.tileSize;
  const { layout, tiles, rows, cols } = mapData;
  // 길이가 맵과 안 맞으면 여기서 던진다 — 조용히 옛 경로로 되돌아가지 않는다 (los.readWalk).
  const walk = readWalk(mapData, props);
  const { blocked = [] } = props;
  const walls = scene.physics.add.staticGroup();

  const add = (c, r) => {
    // Zone 은 그려지지 않는 사각형이다 — 정적 바디를 얹으면 보이지 않는 벽이 된다.
    const zone = scene.add.zone(c * TILE + TILE / 2, r * TILE + TILE / 2, TILE, TILE);
    scene.physics.add.existing(zone, true);
    walls.add(zone);
    return zone;
  };

  if (walk) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) if (walk[r][c] !== '1') add(c, r);
    }
    return walls;
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) if (tiles[layout[r][c]].solid) add(c, r);
  }
  // 가구는 벽 위에 겹칠 수 있다 (벽에 붙인 책장 등) — 이미 막힌 칸은 건너뛴다.
  for (const [c, r] of blocked) {
    if (r >= 0 && r < rows && c >= 0 && c < cols && !tiles[layout[r][c]].solid) add(c, r);
  }

  return walls;
}

/** 메인 카메라의 월드 확대 배율. 픽셀 아트가 뭉개지지 않게 반드시 정수를 쓴다. */
export const WORLD_ZOOM = 2;

/**
 * 카메라 구성 — 내부 해상도(1920×1080)와 월드(32px 타일)를 분리한다.
 *
 * 메인 카메라는 월드를 WORLD_ZOOM 배로 그리고, 맵이 화면(월드 기준 960×540)보다
 * 크면 플레이어를 따라 스크롤한다 — 맵 크기가 캔버스 크기에 묶여 있던 결합이
 * 여기서 풀린다 (스토리보드의 9섹터 스테이지 대비). 맵은 최소 30×17 칸이어야
 * 화면에 빈 띠가 생기지 않는다.
 *
 * UI 카메라는 줌·스크롤 없이 화면에 고정된 것(HUD·수첩)을 1080p 원본으로 그린다.
 *
 * 호출 시점이 규약이다: 월드(타일·플레이어·NPC·순찰)를 전부 깐 직후, UI 를 만들기
 * 전에 부른다 — 그 시점까지의 자식은 전부 월드로 분류된다. 이후에 만드는 오브젝트는
 * scene.asWorld(...) / scene.asUi(...) 로 소속을 밝혀야 한다. 밝히지 않으면 양쪽
 * 카메라에 이중으로 그려진다 (UI 카메라 쪽에는 줌 없이 좌상단에 작게 나타난다).
 *
 * @param {number} [zoom] 안 주면 맵 json 의 `cameraZoom`, 그것도 없으면 WORLD_ZOOM(2).
 *
 *   줌은 맵마다 다를 수 있다 — 캐릭터 크기(charHeight)는 **그림의 축척**이 정하는데,
 *   화면에 인물이 몇 명분 보이는지는 그 둘의 곱(charHeight × zoom)이 정하기 때문이다.
 *   본부처럼 그림이 크게 그려진 맵(charHeight 96)은 줌 2 면 세로로 인물 5.6명분밖에
 *   안 보여 코앞만 보인다. 그래서 그림 축척은 charHeight 로, 화면에 담는 양은 zoom 으로
 *   따로 잡는다. 정수를 써야 픽셀 아트가 뭉개지지 않는다(WORLD_ZOOM 주석 참고).
 */
export function setupCameras(scene, mapData, player, zoom = mapData.cameraZoom ?? WORLD_ZOOM) {
  const TILE = mapData.tileSize;
  const w = mapData.cols * TILE;
  const h = mapData.rows * TILE;

  // 물리 경계도 맵 크기로 좁힌다 — 기본값(캔버스 크기)을 그대로 두면
  // setCollideWorldBounds 가 맵 밖 1920×1080 을 세상 끝으로 안다.
  scene.physics.world.setBounds(0, 0, w, h);

  const main = scene.cameras.main;
  main.setZoom(zoom);
  main.setBounds(0, 0, w, h);
  // ⚠ 두 번째 인자(roundPixels)는 **false** 여야 한다.
  //
  // true 면 카메라 스크롤이 월드 정수 픽셀로 반올림된다. 줌이 정수인 맵에서는 티가 안 나지만,
  // 저택(줌 1.5)에서는 스크롤 한 칸이 화면 1.5px 이라 인물의 화면 위치가 매끄럽게 못 는다 —
  // 실측하면 좌우로 걸을 때 프레임당 이동이 8.4 → 0 → 0 → 8.4 로 튀어 인물이 떠는 것처럼 보였다.
  // 스크롤을 소수로 두면 그 계단이 사라진다.
  //
  // 그림이 뭉개질 걱정은 없다 — main.js 의 pixelArt:true 가 렌더러 차원에서 그리는 위치를
  // 정수 화면 픽셀로 스냅한다. 여기서 한 번 더 반올림할 이유가 없다.
  main.startFollow(player, false, 0.15, 0.15);

  const ui = scene.cameras.add(0, 0, scene.scale.width, scene.scale.height);
  ui.ignore(scene.children.list);

  scene.uiCam = ui;
  // worldLabel 이 글자를 몇 배로 구울지 정하는 데 쓴다.
  scene.worldZoom = zoom;
  scene.asWorld = (...objs) => ui.ignore(objs);
  scene.asUi = (...objs) => main.ignore(objs);
}

/**
 * 월드에 놓이는 작은 글자 — 인물 이름표처럼 대상 옆에 붙어 있어야 하는 것들.
 *
 * 월드 텍스트는 카메라 줌만큼 확대되는데 pixelArt(NEAREST) 라 그 확대에 보간이 없다.
 * 11px 로 구워 본부의 2.8125 배 줌으로 늘리면 글자가 아니라 얼룩이 된다. 그래서
 * **화면에서 보일 크기로 크게 굽고 월드에서 그만큼 축소해 둔다** — 카메라를 지나면
 * 배율이 정확히 1 이 되어 구운 그대로 찍힌다. 월드에서 차지하는 크기는 예전과 같아
 * 배치(y 오프셋 등)는 손댈 것이 없다.
 *
 * style.fontSize 는 지금까지처럼 **월드 기준** 크기로 적는다 — 화면용 크기 계산은
 * 여기서 한다.
 *
 * 배율은 setupCameras 가 scene.worldZoom 에 남긴 값을 쓰고, 아직 안 불렀으면
 * 기본 배율로 굽는다 — 거리 씬은 이름표를 먼저 만들고 카메라를 나중에 세운다
 * (setupCameras 의 호출 시점 규약 때문이고, 거리의 줌은 그 기본값과 같다).
 */
/**
 * 이름표를 얹을 깊이.
 *
 * 기본 깊이(0)로 두면 나중에 태어난 월드 오브젝트가 전부 이름표를 덮는다 — 거리에서는
 * 등불(4)·수증기(6)·순찰 로봇과 시야 원이 그렇다. 이름은 인물이 지금 무엇에 가려져
 * 있든 읽혀야 하는 정보라 그 위로 올린다. 화면에 고정된 것(HUD·말풍선)은 UI 카메라
 * 소속이라 이 숫자와 경쟁하지 않는다.
 *
 * worldLabel 이 자동으로 걸지는 않는다 — 씬마다 무엇을 덮어도 되는지가 달라서,
 * 올릴 이름표를 씬이 직접 고르게 둔다.
 */
export const NAME_LABEL_DEPTH = 8;

export function worldLabel(scene, x, y, text, style) {
  const world = parseFloat(style.fontSize) || 11;
  const px = Math.max(1, Math.round(world * (scene.worldZoom ?? WORLD_ZOOM)));
  return scene.add
    .text(x, y, text, { ...style, fontSize: `${px}px` })
    .setScale(world / px)
    .setOrigin(0.5);
}

/**
 * 월드 좌표 → 화면 좌표 (회전 없는 카메라 기준).
 *
 * 월드에 놓인 것은 카메라 줌만큼 확대되는데, pixelArt(NEAREST) 라 그 확대에 보간이
 * 없다 — 타일 아트는 그러라고 켠 설정이지만 글자는 획이 1~2px 이라 통째로 뭉개진다
 * (본부의 2.8125 배 줌에서 11px 말풍선이 노란 얼룩이 되던 이유). 글자는 줌 없는 UI
 * 카메라에 두고 위치만 이 함수로 옮기면, 어떤 맵의 어떤 줌에서도 같은 크기로 또렷하다.
 */
export function worldToScreen(cam, x, y) {
  const ox = cam.width * cam.originX;
  const oy = cam.height * cam.originY;
  return {
    x: (x - cam.scrollX - ox) * cam.zoomX + cam.x + ox,
    y: (y - cam.scrollY - oy) * cam.zoomY + cam.y + oy,
  };
}

/**
 * 인물이 화면에 보일 높이(월드 px) — 맵이 `charHeight` 로 정한다.
 *
 * 그림마다 내부 축척이 달라서(같은 벤치가 거리에서는 64px, 저택에서는 96px) 캐릭터 크기는
 * 맵마다 다른 값이어야 한다. 씬 상수로 흩어져 있던 것을 맵 json 으로 옮겨, 배경을 갈아끼울
 * 때 그림과 캐릭터가 한 파일에서 같이 정해지게 한다.
 */
export const DEFAULT_CHAR_HEIGHT = 32;

/**
 * 발밑 판정의 비례 — 캐릭터 높이 대비.
 *
 * 예전엔 setSize(16,14) 로 못박혀 있었다. 32px 캐릭터에 맞춘 값이라 그림을 3배로 키우면
 * 몸통만 그대로 남아, 사람은 커졌는데 발은 예전 크기인 채로 좁은 틈을 빠져나간다.
 * 32px 에서는 옛 값과 정확히 같은 수(16×14)가 나오도록 잡았다.
 */
const BODY_W_RATIO = 16 / DEFAULT_CHAR_HEIGHT;
const BODY_H_RATIO = 14 / DEFAULT_CHAR_HEIGHT;

/**
 * 발밑 판정의 **상한** — 타일 대비.
 *
 * 충돌은 타일 격자로 표현된다. 몸이 한 타일보다 굵어지면 격자가 표현할 수 있는 가장
 * 좁은 길(한 칸짜리 골목)을 못 지나간다 — 거리 맵에는 그런 칸이 220개 넘게 있었다.
 * 사람이 커졌으니 발도 커져야 맞지만, 못 지나가는 길이 생기는 것보다는 발이 조금
 * 작은 편이 낫다 (걸리면 판이 끝나고, 겹쳐 보이는 건 눈에 잘 띄지도 않는다).
 * 32px 캐릭터에서는 상한에 안 걸려 예전 값(16×14) 그대로다.
 */
const BODY_MAX_W = 0.75;
const BODY_MAX_H = 0.65;

/**
 * 걷는 속도 / 캐릭터 높이.
 *
 * 절대 픽셀로 못박으면 그림이 큰 맵에서 발이 느려 보인다 — 같은 200px/s 라도 32px
 * 캐릭터에게는 초당 여섯 걸음이고 96px 캐릭터에게는 두 걸음이다. 눈이 재는 것은 절대
 * 픽셀이 아니라 **제 키의 몇 배를 갔는가** 라서 키에 비례시킨다.
 *
 * 6.25(=200/32)에서 3.0 으로 낮췄다. 6.25 는 걷기 그림 한 걸음(0.31초) 동안 **제 키의
 * 1.9배**를 미끄러지는 속도다 — 사람의 보폭은 걸을 때 키의 0.4~0.5배, 전력질주라도
 * 0.8~1.0배다. 다리는 걷는 시늉만 하고 몸은 그 네 배를 나가니 발이 땅을 안 딛는 것처럼
 * 보였다(공중부양). 캐릭터가 32px 이던 시절부터 있던 값인데, 96px 로 키우면서 드러났다.
 *
 * 3.0 은 STRIDE_RATIO 와 짝이다 — 이 속도에서 timeScale 이 정확히 1 이 되어 손으로
 * 그린 프레임률이 그대로 나온다. 속도를 여기서 바꿔도 그림은 알아서 따라온다.
 */
const SPEED_RATIO = 3.0;

/**
 * 한 걸음에 나아가는 거리 / 캐릭터 높이 — **걷는 그림의 재생 속도를 정하는 기준**이다.
 *
 * 걷기 시트는 방향마다 8프레임이고 한 사이클이 두 걸음이다. 손으로 정한 프레임률
 * (BootScene 의 CYCLE_SECONDS)은 고정이라, 이동 속도가 바뀌면 발이 미끄러진다.
 * 그래서 매 프레임 **실제 속도를 보고 재생 속도를 맞춘다** — 보폭이 늘 이 비율로
 * 유지되므로 속도를 어떻게 잡아도 발이 땅에 붙어 있다.
 *
 * 0.92 는 지금 그림의 박자에서 역산한 값이다: 8프레임 13fps → 한 걸음 0.31초 →
 * 초당 3.25걸음. 사람이 걸을 때가 초당 1.8~2.0걸음, 달릴 때가 2.6~3.0이니 이 그림은
 * 이미 **달리는 박자**다. 거기 맞는 보폭이 키의 0.8~1.0배다.
 */
const STRIDE_RATIO = 0.92;

/**
 * 재생 속도 상·하한. 벽에 붙어 밀거나(속도는 살아 있는데 안 움직인다) 씬이 속도를
 * 따로 넘길 때 다리가 정지하거나 깜빡이지 않게 잘라 둔다.
 */
const ANIM_SCALE_MIN = 0.5;
const ANIM_SCALE_MAX = 2.5;

/** 플레이어 — 맵이 지정한 스폰 칸 중앙에 두고 벽과 충돌시킨다. */
export function createPlayer(scene, mapData, walls, frame = 0) {
  const TILE = mapData.tileSize;
  const ps = mapData.spawns.player;
  const player = scene.add.sprite(
    ps.col * TILE + TILE / 2,
    ps.row * TILE + TILE / 2,
    'chars',
    frame,
  );
  scene.physics.add.existing(player);
  player.body.setCollideWorldBounds(true);

  // 충돌 판정은 발밑 위주로 좁혀 스프라이트 여백이 벽에 걸리지 않게 한다.
  // 세로 앵커는 프레임 한가운데 = createPlayerVisual 이 발을 맞추는 지점이라(originY),
  // 판정 사각형은 발에서 아래로 깔린다 — 그림자를 밟고 선 자리라고 보면 된다.
  const charHeight = mapData.charHeight ?? DEFAULT_CHAR_HEIGHT;
  const bw = Math.max(4, Math.round(Math.min(charHeight * BODY_W_RATIO, TILE * BODY_MAX_W)));
  const bh = Math.max(4, Math.round(Math.min(charHeight * BODY_H_RATIO, TILE * BODY_MAX_H)));
  player.body.setSize(bw, bh).setOffset((player.width - bw) / 2, player.height / 2);

  // 걷는 속도도 이 맵의 축척을 따른다 — applyMovement 가 기본값으로 읽는다.
  player.walkSpeed = Math.round(charHeight * SPEED_RATIO);

  scene.physics.add.collider(player, walls);
  return player;
}

/**
 * 방향 애니메이션이 있는 플레이어 그림 — 충돌 바디(player)와는 별개의 스프라이트다.
 * 매 프레임 위치만 따라가므로, 그림의 배율·원점을 얼마로 잡든 body.setSize/setOffset
 * (createPlayer 가 이미 세운 발밑 판정)에는 영향이 없다.
 *
 * 네 방향 모두 전용 프레임이 있다 — 왼쪽을 반전(flipX)해서 오른쪽에 쓰지 않는다.
 * 인물의 고글·가방·멜빵이 좌우 비대칭이라, 반전하면 방향을 바꿀 때마다 장비가
 * 반대쪽 어깨로 옮겨 다닌다.
 * createPlayer 직후, setupCameras 이전에 불러야 별도로 asWorld 등록할 필요가 없다.
 *
 * @param {{idle: string, walkDown: string, walkUp: string, walkLeft: string, walkRight: string}} anims 애니메이션 키
 * @param {number} originY 발 위치(0~1, 프레임 높이 기준 — 프레임마다 인물 배치가 달라 실측해야 한다)
 * @param {number} contentHeight 프레임 안 인물의 실제 높이(px, 정수리~발)
 * @param {number} displayHeight 화면에 표시할 발-정수리 높이(world px)
 * @param {number} [frameSize] 텍스처의 정사각 프레임 한 변(px)
 */
export function createPlayerVisual(
  scene,
  player,
  anims,
  originY,
  contentHeight,
  displayHeight,
  frameSize = 128,
) {
  const { idle } = anims;
  const scale = displayHeight / contentHeight;
  // **재생을 먼저, 크기를 나중에.** setDisplaySize 는 지금 붙어 있는 텍스처의 크기로
  // 배율을 역산하므로, 아직 엉뚱한(또는 없는) 텍스처가 붙어 있으면 배율이 통째로
  // 틀어진다. play() 가 올바른 프레임을 붙인 뒤에 크기를 잡으면 그 함정이 사라진다.
  const visual = scene.add
    .sprite(player.x, player.y, anims.texture ?? idle, 0)
    .setOrigin(0.5, originY)
    .play(idle)
    .setDisplaySize(frameSize * scale, frameSize * scale);

  /**
   * 마지막으로 향한 쪽. 걷다 멈추면 **보던 쪽 그대로** 서 있게 한다 —
   * 대기 그림이 한 장뿐이던 시절에는 왼쪽으로 걷다 멈추면 갑자기 정면을 봤다.
   * 방향별 대기가 없는 시트면 anims.idle 로 떨어진다.
   */
  let facing = 'Down';

  let current = idle;
  const play = (key) => {
    if (current === key) return;
    current = key;
    visual.play(key);
  };

  /**
   * 이 속도에서 손으로 그린 프레임률이 그대로 맞는다 (timeScale = 1).
   * 여기서 벗어난 만큼만 재생 속도를 당기거나 늦춘다 — 보폭이 늘 STRIDE_RATIO 로
   * 유지되므로 씬이 속도를 바꿔도 발이 미끄러지지 않는다.
   */
  const referenceSpeed = displayHeight * SPEED_RATIO;

  return {
    node: visual,
    /** 씬의 update() 에서 매 프레임 부른다 — 위치를 따라가고, 속도로 방향·박자를 고른다. */
    update() {
      visual.setPosition(player.x, player.y);
      const { x: vx, y: vy } = player.body.velocity;
      if (vx === 0 && vy === 0) {
        // 서 있는 그림은 걷기와 박자가 무관하다 — 배속을 되돌려 놓지 않으면
        // 마지막으로 걷던 속도가 그대로 남아 숨쉬기가 빨라진다.
        visual.anims.timeScale = 1;
        play(anims[`idle${facing}`] ?? idle);
        return;
      }

      // 걷는 그림의 재생 속도를 실제 이동 속도에 맞춘다 (STRIDE_RATIO 주석 참고).
      const speed = Math.hypot(vx, vy);
      visual.anims.timeScale = Math.min(
        ANIM_SCALE_MAX,
        Math.max(ANIM_SCALE_MIN, speed / referenceSpeed),
      );

      if (Math.abs(vx) > Math.abs(vy)) facing = vx > 0 ? 'Right' : 'Left';
      else facing = vy > 0 ? 'Down' : 'Up';
      play(anims[`walk${facing}`]);
    },
  };
}

/**
 * 방향키 + WASD → 속도. 대화 입력 중 정지는 호출하는 씬이 판단한다.
 * speed 를 안 주면 createPlayer 가 맵 축척으로 잡아 둔 값을 쓴다.
 */
export function applyMovement(player, { cursors, wasd, speed = player.walkSpeed ?? 200 }) {
  const left = cursors.left.isDown || wasd.A.isDown;
  const right = cursors.right.isDown || wasd.D.isDown;
  const up = cursors.up.isDown || wasd.W.isDown;
  const down = cursors.down.isDown || wasd.S.isDown;

  const dx = (right ? 1 : 0) - (left ? 1 : 0);
  const dy = (down ? 1 : 0) - (up ? 1 : 0);

  // 대각선은 길이를 1로 맞춘다. 두 축에 각각 speed 를 주면 √2 배(41%) 빨라져서,
  // 어디를 가든 대각선으로 지그재그 하는 것이 최적이 된다 — 순찰을 피하는 게임에서는
  // 그게 곧 난이도 구멍이다. 걷는 그림의 재생 속도도 실제 속도를 보므로, 안 맞추면
  // 대각선에서만 발이 41% 미끄러진다.
  const len = Math.hypot(dx, dy) || 1;
  player.body.setVelocity((dx / len) * speed, (dy / len) * speed);
}

/**
 * 사거리 안에서 가장 가까운 대상을 집는다.
 *
 * "첫 번째"가 아니라 "가장 가까운" 쪽인 이유: 감옥 슬롯 간격(44px)이 접선 거리(48px)보다
 * 좁아 두 명이 동시에 사거리에 들어오기 때문이다 — 옆 칸 동료가 잘못 잡히지 않게 한다.
 *
 * @param {Array<{value: any, x: number, y: number}>} items
 * @returns {any|null}
 */
export function nearestOf(player, items, range) {
  let best = null;
  let bestDist = range;
  for (const item of items) {
    const dist = Phaser.Math.Distance.Between(player.x, player.y, item.x, item.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = item.value;
    }
  }
  return best;
}
