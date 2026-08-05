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
 *
 * 2026-08-02 새 광장 그림(70×35)에 맞춰 다시 그었다. 눈으로 고르지 않고 walk 격자에서
 * **20칸 이상 이어지는 직선**을 뽑아 골랐다 — 로봇은 길을 찾지 않고 두 점 사이를
 * 직선으로 오가므로, 경로가 지나는 칸이 전부 걸을 수 있어야 건물을 뚫고 다니지 않는다.
 * 네 경로 모두 전 구간이 걷는 칸 위에 있는 것을 확인했다.
 */
export const PATROL_ROUTES = {
  crossing: [[5, 8], [52, 8]], // 위쪽 가로 축 — 가게 앞을 길게 훑는다 (48칸)
  avenue: [[44, 8], [44, 29]], // 세로 축 — 동쪽 시가지를 오르내린다 (22칸)
  wharf: [[4, 17], [28, 17]], // 가운데 가로 축 — 광장 서편 (25칸)
  reinforce: [[41, 16], [64, 16]], // 증원 — 광장 동편, 경계 2 이상에서만 (24칸)
};

/**
 * 순찰 개체 이름 — 머리 위 이름표에 그대로 찍힌다.
 *
 * 경로와 같은 파일에 두는 이유는 이름이 곧 **그 축의 이름**이기 때문이다. 로봇은
 * 사람처럼 자리를 옮겨 다니지 않고 배정된 경로 하나를 평생 돈다 — 경로를 지우면
 * 이름도 같이 사라져야 하고, 경로를 하나 더 그으면 번호도 하나 더 필요하다.
 * 번호는 스폰 순서가 아니라 이 표의 순서다 (#spawnPatrols 는 avenue 부터 세운다).
 *
 * 용어는 스토리보드 수정안 p.17 의 확정 표기 "경비 로봇"을 따른다.
 */
export const PATROL_NAMES = {
  crossing: '경비 로봇 RB-01',
  avenue: '경비 로봇 RB-02',
  wharf: '경비 로봇 RB-03',
  reinforce: '경비 로봇 RB-04',
};

/** 증원이 붙는 경계 레벨 (스토리보드: 레벨 2 = 증원) */
export const REINFORCE_AT = 2;

/**
 * 밸런스 상수 — 플레이테스트 후 손댈 곳이 여기뿐이어야 한다.
 * 순찰 속도는 어떤 경계 레벨에서도 플레이어보다 느려야 한다 — 걸리면 무조건 검문이지
 * 도망칠 방법이 없는 게임은 만들지 않는다. 거리의 플레이어는 192px/s 다
 * (charHeight 64 × worldParts.SPEED_RATIO 3.0). 순찰은 60~105 이니 1.8~3.2배 빠르다.
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

/**
 * 붙잡힌 플레이어가 갇혀 서는 칸 — 창살 안, 붙잡힌 동료들(StageScene#jailSlot) 한 줄 뒤.
 *
 * 감옥 안은 **걸을 수 있는 칸이 아니다** (walkmask 상 통째로 막힌 구역이라 갇힌 동료들도
 * 그림만 서 있다). 그래서 갇혀 있는 동안 씬은 플레이어의 물리 바디를 끈다 — 안 끄면
 * 정적 충돌 바디와 겹친 채로 매 프레임 밀려나 창살 밖으로 튀어나간다.
 *
 * @param {{x: number, y: number, w: number, h: number}} cage 맵 json 의 감옥 사각형(타일)
 */
export const jailCell = (cage) => ({ col: cage.x + Math.floor(cage.w / 2), row: cage.y + 2 });

/**
 * 창살 밖 첫 걸음 — 감옥 칸에서 가장 가까운 **걸을 수 있는 칸**.
 *
 * 좌표를 못박지 않는 이유는 감옥 안이 걷는 칸이 아니라서다. 문 앞이 어디인지는 배경
 * 그림에 칠한 walkmask 가 정하고, 그림을 다시 칠하면 그 자리도 같이 옮겨간다 — 여기에
 * 숫자로 적어 두면 그때부터 조용히 벽 속으로 내보내게 된다.
 *
 * 같은 거리면 **좌우로 덜 벗어난 쪽**을 고른다. 지금 그림에서는 감옥 앞 인도(북쪽)가
 * 그렇게 잡혀, 나오는 자리가 창살 정면이 된다.
 *
 * @param {{col: number, row: number}} cell 갇혀 있던 칸 (jailCell)
 * @param {(col: number, row: number) => boolean} isBlocked 충돌이 보는 벽 (los.makeBlockedLookup)
 * @param {{col: number, row: number}} fallback 둘레에 걷는 칸이 하나도 없을 때 내보낼 자리
 */
export function jailExit(cell, isBlocked, fallback) {
  for (let ring = 1; ring <= 16; ring++) {
    let best = null;
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        if (isBlocked(cell.col + dc, cell.row + dr)) continue;
        if (!best || Math.abs(dc) < Math.abs(best.dc)) best = { dc, dr };
      }
    }
    if (best) return { col: cell.col + best.dc, row: cell.row + best.dr };
  }
  // 감옥 둘레 16칸 안에 걷는 칸이 하나도 없다 — 마스크가 통째로 잘못 칠해진 경우다.
  // 갇힌 채로 판이 멈추는 것보다는 낫다 (scripts/check-jail.js 가 먼저 잡아 준다).
  return fallback;
}
