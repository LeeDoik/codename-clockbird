/**
 * 검문 1단 — 신원 스캔 회피 (타이밍 게임).
 *
 * 발각은 한 판에 몇 번이고 일어난다. 그래서 이 단계는 3~5초 안에 끝나야 하고,
 * 서버 왕복도 LLM 도 끼지 않는다. 놓쳤을 때 비로소 LLM 심문이 열린다.
 *
 * 경계 수위가 오르면 목표 구간이 좁아지고 커서가 빨라진다 — 같은 사건이 반복될수록
 * 실제로 어려워져야 "경계가 올랐다"는 숫자가 몸으로 읽힌다.
 */

/** 목표 구간 폭 (트랙 대비 비율) */
const ZONE_BASE = 0.24;
const ZONE_PER_LEVEL = 0.035;
const ZONE_MIN = 0.09;
/** 커서가 트랙을 한 번 훑는 시간 (ms) */
const SWEEP_MS_BASE = 1500;
const SWEEP_MS_PER_LEVEL = 170;
const SWEEP_MS_MIN = 620;
/** 이 안에 멈추지 못하면 실패 */
const TIME_LIMIT_MS = 6000;
/** 경계 레벨 상한 — Patrol 과 같은 값을 쓴다 */
const MAX_LEVEL = 3;

/**
 * @param {import('../ui/MinigamePanel.js').MinigamePanel} panel
 * @param {number} alertLevel
 * @returns {Promise<boolean>} 통과 여부
 */
export function runTimingLock(panel, alertLevel) {
  const level = Math.min(alertLevel, MAX_LEVEL);
  const zoneW = Math.max(ZONE_MIN, ZONE_BASE - ZONE_PER_LEVEL * level);
  const sweepMs = Math.max(SWEEP_MS_MIN, SWEEP_MS_BASE - SWEEP_MS_PER_LEVEL * level);
  // 구간이 가장자리에 붙으면 왕복 끝에서 커서가 오래 머물러 쉬워진다 — 안쪽에만 둔다.
  const zoneStart = 0.08 + Math.random() * (1 - zoneW - 0.16);

  return panel.run({
    title: '신원 스캔',
    subtitle: '위이잉— 스캔 광선이 훑고 지나간다.\n광선이 빈틈에 들어왔을 때 숨을 멈춘다.',
    hint: '[Space] 또는 클릭',
    timeLimitMs: TIME_LIMIT_MS,
    render: ({ content, finish }) => {
      const track = document.createElement('div');
      track.className = 'mg-track';

      const zone = document.createElement('div');
      zone.className = 'mg-zone';
      zone.style.left = `${zoneStart * 100}%`;
      zone.style.width = `${zoneW * 100}%`;

      const cursor = document.createElement('div');
      cursor.className = 'mg-cursor';

      track.append(zone, cursor);
      content.append(track);

      let rafId = 0;
      let pos = 0;
      // 패널의 제한 시간과 같은 이유로 프레임 간격을 쌓아 잰다 — 탭을 다녀오면
      // 커서가 엉뚱한 데로 순간이동해 있는 것보다 이어서 도는 편이 덜 억울하다.
      const MAX_FRAME_MS = 100;
      let last = performance.now();
      let elapsed = 0;

      const tick = () => {
        const now = performance.now();
        elapsed += Math.min(now - last, MAX_FRAME_MS);
        last = now;
        // 삼각파: 0 → 1 → 0 을 반복한다. sin 을 쓰면 양끝에서 느려져 가장자리 구간이
        // 거저먹기가 된다.
        const phase = (elapsed / sweepMs) % 2;
        pos = phase <= 1 ? phase : 2 - phase;
        cursor.style.left = `${pos * 100}%`;
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);

      const stop = () => {
        cancelAnimationFrame(rafId);
        finish(pos >= zoneStart && pos <= zoneStart + zoneW);
      };

      track.addEventListener('click', stop);
      panel.onKey = (e) => { if (e.key === ' ' || e.key === 'Enter') stop(); };

      // 제한 시간에 걸려 패널이 접을 때도 rAF 는 반드시 멈춰야 한다.
      return () => cancelAnimationFrame(rafId);
    },
  });
}
