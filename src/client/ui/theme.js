/**
 * 캔버스 UI 테마 토큰 — index.html 의 :root CSS 변수와 짝이다 (색을 바꾸면 두 곳 함께).
 *
 * 인라인 CSS 와 모듈 사이에 빌드 파이프라인 없이 단일 출처를 만들 수 없어 의도적으로
 * 중복해 둔다. DOM 오버레이와 Phaser 캔버스가 같은 팔레트·폰트를 쓰기 위한 참조점.
 */
export const COLORS = {
  brassHi: 0xe8c15a,
  brass: 0xc9a227,
  brassLo: 0x7a5f1a,
  leather: 0x2c2018,
  ink: 0x1a1712,
  paper: 0xe8dcc0,
  paperDim: 0x8a7f6a,
  patina: 0x5e8b7e,
  wax: 0xa03325,
};

/** Phaser 텍스트 스타일의 color 는 CSS 문자열을 받는다 — COLORS 와 같은 값. */
export const CSS = {
  brassHi: '#e8c15a',
  brass: '#c9a227',
  brassLo: '#7a5f1a',
  paper: '#e8dcc0',
  paperDim: '#8a7f6a',
  patina: '#5e8b7e',
  wax: '#a03325',
  faint: '#6b6152', // 캔버스 전용 — :root 에 짝 없음
};

export const FONTS = {
  head: "'Hahmlet', 'Malgun Gothic', serif",
  body: "'Gowun Batang', 'Malgun Gothic', serif",
};

/**
 * 웹폰트 로드 대기. Phaser 텍스트는 생성 시점의 폰트로 래스터되므로, 로드 전에
 * 그리면 폴백 고딕으로 굳는다. CDN 이 막힌 환경에서 게임이 잠기지 않도록
 * 타임아웃이 지나면 폴백 폰트인 채로 그냥 진행한다.
 */
export function waitForFonts(timeoutMs = 2000) {
  if (!document.fonts?.load) return Promise.resolve();
  const wanted = Promise.all([
    document.fonts.load('700 32px Hahmlet'),
    document.fonts.load("400 24px 'Gowun Batang'"),
    document.fonts.load("700 24px 'Gowun Batang'"),
  ]);
  const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  return Promise.race([wanted, timeout]).catch(() => {});
}

/**
 * 황동 이중 프레임 패널 — DOM 쪽 .sp-panel 의 캔버스 판.
 * 가죽 바탕 + 바깥 어두운 선 + 안쪽 밝은 선 + 모서리 리벳 4개.
 * 컨테이너에 넣거나 asUi 등록은 호출자 몫이다.
 */
export function drawOrnateFrame(scene, cx, cy, w, h) {
  const g = scene.add.graphics();
  const x = cx - w / 2;
  const y = cy - h / 2;
  g.fillStyle(COLORS.leather, 0.97).fillRect(x, y, w, h);
  g.lineStyle(3, COLORS.brassLo, 1).strokeRect(x, y, w, h);
  g.lineStyle(1, COLORS.brassHi, 0.9).strokeRect(x + 5, y + 5, w - 10, h - 10);
  g.fillStyle(COLORS.brassHi, 1);
  for (const [rx, ry] of [
    [x + 10, y + 10],
    [x + w - 10, y + 10],
    [x + 10, y + h - 10],
    [x + w - 10, y + h - 10],
  ]) {
    g.fillCircle(rx, ry, 3);
  }
  return g;
}
