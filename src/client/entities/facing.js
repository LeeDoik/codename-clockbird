/**
 * 이동 방향(라디안) → 네 방향 스프라이트 이름.
 *
 * 걸어다니는 것은 전부 이 규칙을 쓴다 — 거리의 순찰 로봇(Patrol)과 탈출의 감시
 * 로봇(Sentry). 각자 자기 파일에 두면 한쪽만 고쳐도 아무도 모르고, 방향이 갈리는
 * 경계가 두 스테이지에서 달라진다.
 *
 * Phaser 의 y 축은 아래가 양수다. 가로·세로 중 **더 많이 움직이는 쪽**을 고른다 —
 * 순찰 경로가 축에 나란해서 대개 한쪽이 0 이지만, 웨이포인트에 거의 다 와서 남은
 * 거리가 몇 px 일 때나 끝점에서 콘이 도는 동안에는 대각선처럼 보이는 순간이 있다.
 * 그때 방향이 깜빡이지 않게 한다.
 *
 * @param {number} radians
 * @returns {'Down'|'Up'|'Left'|'Right'}
 */
export function facingName(radians) {
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'Right' : 'Left';
  return dy >= 0 ? 'Down' : 'Up';
}
