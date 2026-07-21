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
 * @returns {Phaser.Physics.Arcade.StaticGroup} 벽 그룹 (충돌 등록에 쓴다)
 */
export function buildTilemap(scene, mapData) {
  const TILE = mapData.tileSize;
  const walls = scene.physics.add.staticGroup();
  const { layout, tiles, rows, cols } = mapData;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const f = layout[r][c];
      if (f < 0) continue; // 빈칸
      if (tiles[f].solid) {
        walls.create(c * TILE + TILE / 2, r * TILE + TILE / 2, 'tiles', f);
      } else {
        scene.add.image(c * TILE, r * TILE, 'tiles', f).setOrigin(0, 0);
      }
    }
  }

  return walls;
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
