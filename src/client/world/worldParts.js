import Phaser from 'phaser';

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
  const { walk, blocked = [] } = props;
  const walls = scene.physics.add.staticGroup();

  const add = (c, r) => {
    // Zone 은 그려지지 않는 사각형이다 — 정적 바디를 얹으면 보이지 않는 벽이 된다.
    const zone = scene.add.zone(c * TILE + TILE / 2, r * TILE + TILE / 2, TILE, TILE);
    scene.physics.add.existing(zone, true);
    walls.add(zone);
    return zone;
  };

  if (Array.isArray(walk) && walk.length === rows) {
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
 * @param {number} [zoom] 기본은 WORLD_ZOOM(2). 타일 크기가 다른 맵(예: 배경 그림을
 *   축소해 깐 본부)은 화면에 보이는 칸 수를 맞추려면 다른 배율이 필요할 수 있다 —
 *   그때만 넘긴다. 정수를 써야 픽셀 아트가 뭉개지지 않는다(WORLD_ZOOM 주석 참고).
 */
export function setupCameras(scene, mapData, player, zoom = WORLD_ZOOM) {
  const TILE = mapData.tileSize;
  const w = mapData.cols * TILE;
  const h = mapData.rows * TILE;

  // 물리 경계도 맵 크기로 좁힌다 — 기본값(캔버스 크기)을 그대로 두면
  // setCollideWorldBounds 가 맵 밖 1920×1080 을 세상 끝으로 안다.
  scene.physics.world.setBounds(0, 0, w, h);

  const main = scene.cameras.main;
  main.setZoom(zoom);
  main.setBounds(0, 0, w, h);
  main.startFollow(player, true, 0.15, 0.15);

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
  player.body.setSize(16, 14).setOffset(8, 16);
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
  { idle, walkDown, walkUp, walkLeft, walkRight },
  originY,
  contentHeight,
  displayHeight,
  frameSize = 256,
) {
  const scale = displayHeight / contentHeight;
  const visual = scene.add
    .sprite(player.x, player.y, idle, 0)
    .setOrigin(0.5, originY)
    .setDisplaySize(frameSize * scale, frameSize * scale)
    .play(idle);

  let current = idle;
  const play = (key) => {
    if (current === key) return;
    current = key;
    visual.play(key);
  };

  return {
    node: visual,
    /** 씬의 update() 에서 매 프레임 부른다 — 위치를 따라가고, 속도로 방향을 고른다. */
    update() {
      visual.setPosition(player.x, player.y);
      const { x: vx, y: vy } = player.body.velocity;
      if (vx === 0 && vy === 0) {
        play(idle);
        return;
      }
      if (Math.abs(vx) > Math.abs(vy)) {
        play(vx > 0 ? walkRight : walkLeft);
      } else {
        play(vy > 0 ? walkDown : walkUp);
      }
    },
  };
}

/** 방향키 + WASD → 속도. 대화 입력 중 정지는 호출하는 씬이 판단한다. */
export function applyMovement(player, { cursors, wasd, speed = 200 }) {
  const left = cursors.left.isDown || wasd.A.isDown;
  const right = cursors.right.isDown || wasd.D.isDown;
  const up = cursors.up.isDown || wasd.W.isDown;
  const down = cursors.down.isDown || wasd.S.isDown;

  player.body.setVelocity(
    (right ? speed : 0) - (left ? speed : 0),
    (down ? speed : 0) - (up ? speed : 0),
  );
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
