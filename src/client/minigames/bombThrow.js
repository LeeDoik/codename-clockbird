/**
 * 검문 마지막 기회 — 자석 폭탄 충전 후 투척.
 *
 * 신원 스캔(1단 타이밍 게임)을 놓쳤을 때만 열린다. 두 단계를 순서대로 지나간다:
 *   1단 충전 — [Space]/클릭 연타로 게이지를 채운다. 손을 놓으면 서서히 빠진다.
 *              게이지가 가득 차면 2단으로 화면이 전환된다.
 *   2단 조준 — 좌우로 오가는 손잡이를 목표 구간(초록) 안에서 멈추면 성공, 벗어나면
 *              그 즉시 실패다 — 재도전 없이 한 번의 투척으로 판가름난다.
 * 전체 20초 제한 시간 안에 위 과정을 다 마쳐야 한다. 시간을 넘기면 그 순간 실패
 * (panel.run 의 timeLimitMs 가 그 시점에 자동으로 finish(false) 한다).
 */

import gaugeEmptyUrl from '../assets/minigame/bomb-chargebar-empty.png';
import gaugeFilledUrl from '../assets/minigame/bomb-chargebar-filled.png';
import dialNormalUrl from '../assets/minigame/bomb-dial-normal.png';
import dialPressedUrl from '../assets/minigame/bomb-dial-pressed.png';
import spaceNormalUrl from '../assets/minigame/bomb-space-normal.png';
import spacePressedUrl from '../assets/minigame/bomb-space-pressed.png';
import aimBarUrl from '../assets/minigame/bomb-aimbar.png';
import handleUrl from '../assets/minigame/bomb-handle.png';
import bgChargeUrl from '../assets/minigame/bomb-bg-charge.jpg';
import bgAimUrl from '../assets/minigame/bomb-bg-aim.jpg';
import warnPlateUrl from '../assets/minigame/bomb-warn-plate.png';
import bannerUrl from '../assets/minigame/bomb-title-banner.png';
import timerPanelUrl from '../assets/minigame/bomb-timer-panel.png';

/** 정적 <style> 블록의 문자열 url() 은 Vite 에셋 파이프라인을 안 타므로, import 된 URL 을
 * 여기서 합성해 인라인으로 얹는다(반드시 backgroundImage 로만 — background 단축 속성을 쓰면
 * 스타일시트에 정의된 background-size/position 이 초기값으로 리셋돼 그림이 잘리고 어긋나 보인다).
 *
 * 제목·타이머·경고 배너는 그 위에 얹는 오버레이라 두 단계 내내 그대로라 한 번만 얹는다 — 카드
 * 크기는 #minigame-card.bt-active 의 고정 height(440px)가 보장하므로, 배경이 바뀌어도 두 단계가
 * 항상 같은 크기로 보인다. 타이머는 제목/경고판과 같은 양쪽 톱니 프레임을 쓰지 않고, 시계
 * 아이콘만 있는 전용 판(bomb-timer-panel.png)을 쓴다. */
const BANNER_BG = `url("${bannerUrl}")`;
const WARN_BG = `url("${warnPlateUrl}")`;
const TIMER_BG = `url("${timerPanelUrl}")`;

/** 장면 그림(손+폭탄 / 캐릭터+로봇) 배치 — ?bomblayout 에디터에서 직접 드래그·줌으로 잡은
 * 좌표(실제 px)를 그대로 옮긴 값이다. 실제 이미지 비율(가로:세로)로 높이를 유도한다. */
const BG_LAYOUT = {
  charge: { url: bgChargeUrl, width: 1382, left: -51, top: 125.2, ratio: 750 / 333 },
  aim: { url: bgAimUrl, width: 1282, left: -6.34, top: 143.16, ratio: 750 / 313 },
};

const CHARGE_SEGMENTS = 6;
const CHARGE_PER_PRESS = 1;
const DECAY_PER_SEC_BASE = 0.55;
const DECAY_PER_SEC_PER_LEVEL = 0.28;

/** 조준 구간 폭 (트랙 대비 비율)·손잡이 왕복 시간 — 신원 스캔과 같은 감각으로 맞춘다. */
const ZONE_BASE = 0.28;
const ZONE_PER_LEVEL = 0.035;
const ZONE_MIN = 0.13;
const SWEEP_MS_BASE = 1500;
const SWEEP_MS_PER_LEVEL = 160;
const SWEEP_MS_MIN = 650;

const MAX_LEVEL = 3;
const TIME_LIMIT_MS = 20_000;
const TIMER_BLINK_MS = 5_000;
const MAX_FRAME_MS = 100; // 배경 tab 이 멈췄다 돌아와도 한 프레임에 인정하는 시간의 상한.

/**
 * @param {import('../ui/MinigamePanel.js').MinigamePanel} panel
 * @param {number} alertLevel
 * @returns {Promise<boolean>} 성공 여부
 */
export function runBombThrow(panel, alertLevel) {
  const level = Math.min(alertLevel, MAX_LEVEL);
  const decayPerSec = DECAY_PER_SEC_BASE + DECAY_PER_SEC_PER_LEVEL * level;
  const zoneW = Math.max(ZONE_MIN, ZONE_BASE - ZONE_PER_LEVEL * level);
  const sweepMs = Math.max(SWEEP_MS_MIN, SWEEP_MS_BASE - SWEEP_MS_PER_LEVEL * level);

  const card = document.getElementById('minigame-card');
  const titleEl = document.getElementById('minigame-title');
  const hintEl = document.getElementById('minigame-hint');
  card.classList.add('bt-active');
  titleEl.style.backgroundImage = BANNER_BG;
  hintEl.style.backgroundImage = WARN_BG;

  // 장면 그림 — CSS background 대신 실제 <img> 를 카드의 맨 첫 자식으로 넣어서(항상 다른
  // 요소들보다 뒤에 깔린다) ?bomblayout 에서 뽑은 width/left/top 을 그대로 적용한다.
  const bgImg = document.createElement('img');
  bgImg.className = 'bt-bg';
  bgImg.alt = '';
  card.insertBefore(bgImg, card.firstChild);
  const setBg = (key) => {
    const b = BG_LAYOUT[key];
    bgImg.src = b.url;
    // 카드 전체가 --s(게임 캔버스 폭 기준 스케일 단위)로 늘고 줄어드는데, 여기만 고정 px 를
    // 쓰면 창이 커져도 그림만 카드 안에서 고정 크기로 남아 어긋나 보인다.
    bgImg.style.width = `calc(${b.width} * var(--s))`;
    bgImg.style.height = `calc(${b.width / b.ratio} * var(--s))`;
    bgImg.style.left = `calc(${b.left} * var(--s))`;
    bgImg.style.top = `calc(${b.top} * var(--s))`;
  };

  // 디지털 타이머는 두 단계에 걸쳐 하나만 떠 있어야 하므로(단계가 바뀔 때마다 새로 만들면
  // 깜빡이거나 리셋돼 보인다), 판 전체를 통틀어 한 번만 만들고 여기서 직접 자체 rAF 로 돌린다.
  // 전용 타이머판을 카드 우상단에 얹는다 — 시계 아이콘은 그림에 이미 있으니 숫자만 그린다.
  const timerEl = document.createElement('div');
  timerEl.className = 'bt-timer-chip';
  timerEl.style.backgroundImage = TIMER_BG;
  const timerText = document.createElement('span');
  timerText.className = 'bt-timer-text';
  timerEl.append(timerText);
  card.appendChild(timerEl);

  let timerRafId = 0;
  let timerLast = performance.now();
  let timerElapsed = 0;
  const tickTimer = () => {
    const now = performance.now();
    timerElapsed += Math.min(now - timerLast, MAX_FRAME_MS);
    timerLast = now;
    const remainMs = Math.max(0, TIME_LIMIT_MS - timerElapsed);
    const remainSec = Math.ceil(remainMs / 1000);
    // 연출용 표기 — 실제 분:초가 아니라 "남은 초"를 분 자리에 그대로 찍는다(TimerCountdown.cs 그대로).
    timerText.textContent = `${String(remainSec).padStart(2, '0')}:00`;
    timerText.classList.toggle('blink', remainMs <= TIMER_BLINK_MS);
    if (remainMs > 0) timerRafId = requestAnimationFrame(tickTimer);
  };
  timerRafId = requestAnimationFrame(tickTimer);

  return panel.run({
    // 제목은 두 단계 내내 그대로 — 단계별로 바뀌는 건 subtitle/hint 뿐이다.
    title: '수류탄 투척',
    subtitle: '버튼을 연타 하여 자기력을 충전하세요.',
    hint: '충전이 완료 되면 바로 투척 단계로 넘어 갑니다.',
    timeLimitMs: TIME_LIMIT_MS,
    render: ({ content, finish, setHint, setSubtitle }) => {
      setBg('charge');
      let phaseCleanup = mountCharge(panel, content, setHint, setSubtitle, decayPerSec, () => {
        phaseCleanup?.();
        setBg('aim');
        phaseCleanup = mountAim(panel, content, setHint, setSubtitle, zoneW, sweepMs, (hit) => finish(hit));
      });

      return () => {
        phaseCleanup?.();
        // 판정 문구가 뜨는 동안(약 800ms) MinigamePanel 이 content 를 안 비운 채로 놔두는데,
        // 그 사이 bt-active 를 지우면 #minigame-content 의 position:absolute 도 같이 풀려서
        // 그 안의 게이지·트랙·버튼이 다음 위치 기준 조상(뷰포트 쪽)으로 튀어 카드 밖에 붕 떠
        // 보인다 — content 를 여기서 바로 비워 그 잔여물이 하나도 안 남게 한다.
        content.replaceChildren();
        cancelAnimationFrame(timerRafId);
        timerEl.remove();
        bgImg.remove();
        card.classList.remove('bt-active');
        titleEl.style.backgroundImage = '';
        hintEl.style.backgroundImage = '';
      };
    },
  });
}

/** SPACE 버튼 — 평소엔 normal, 누르는 순간 pressed(주황 발광)로 바뀌며 살짝 튀어오른다.
 * 1단(충전)은 목업처럼 원형 다이얼, 2단(투척)은 직사각 명판 — 모양만 다르고 동작은 같아서
 * 에셋 URL·감싸는 클래스만 바꿔 같은 헬퍼를 재사용한다. */
function createSpaceButton(shapeClass, normalUrl, pressedUrl) {
  const btn = document.createElement('div');
  btn.className = `bt-space-btn ${shapeClass}`;
  const normal = document.createElement('img');
  normal.className = 'bt-space-normal';
  normal.src = normalUrl;
  normal.alt = 'SPACE';
  const pressed = document.createElement('img');
  pressed.className = 'bt-space-pressed';
  pressed.src = pressedUrl;
  pressed.alt = '';
  btn.append(normal, pressed);

  let resetId = 0;
  const flash = () => {
    btn.classList.add('pressed');
    clearTimeout(resetId);
    resetId = window.setTimeout(() => btn.classList.remove('pressed'), 90);
  };

  return { el: btn, flash, cleanup: () => clearTimeout(resetId) };
}

/** 1단 — 연타 충전. 게이지가 가득 차면 onFull 을 부른다. */
function mountCharge(panel, content, setHint, setSubtitle, decayPerSec, onFull) {
  setSubtitle('버튼을 연타 하여 자기력을 충전하세요.');
  setHint('충전이 완료 되면 바로 투척 단계로 넘어 갑니다.');

  const gauge = document.createElement('div');
  gauge.className = 'bt-gauge';
  const gaugeBg = document.createElement('img');
  gaugeBg.src = gaugeEmptyUrl;
  gaugeBg.alt = '';
  const gaugeFill = document.createElement('img');
  gaugeFill.className = 'bt-gauge-fill';
  gaugeFill.src = gaugeFilledUrl;
  gaugeFill.alt = '';
  gauge.append(gaugeBg, gaugeFill);

  const spaceBtn = createSpaceButton('bt-dial', dialNormalUrl, dialPressedUrl);

  content.replaceChildren(gauge, spaceBtn.el);

  let charge = 0; // 0..CHARGE_SEGMENTS
  let done = false;
  const render = () => {
    const frac = charge / CHARGE_SEGMENTS;
    gaugeFill.style.clipPath = `inset(${(1 - frac) * 100}% 0 0 0)`;
  };

  let rafId = 0;
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const dt = Math.min(now - last, 100) / 1000;
    last = now;
    charge = Math.max(0, charge - decayPerSec * dt);
    render();
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  const press = () => {
    if (done) return;
    spaceBtn.flash();
    charge = Math.min(CHARGE_SEGMENTS, charge + CHARGE_PER_PRESS);
    render();
    if (charge >= CHARGE_SEGMENTS) {
      done = true;
      cancelAnimationFrame(rafId);
      onFull();
    }
  };

  content.addEventListener('click', press);
  panel.onKey = (e) => { if (e.key === ' ' || e.key === 'Enter') press(); };

  return () => {
    cancelAnimationFrame(rafId);
    content.removeEventListener('click', press);
    spaceBtn.cleanup();
  };
}

/** 2단 — 손잡이가 좌우로 오간다. 목표 구간 안에서 멈추면 명중, 벗어나면 그 즉시 실패다(재도전 없음). */
function mountAim(panel, content, setHint, setSubtitle, zoneW, sweepMs, onResult) {
  setSubtitle('손잡이가 초록색 구간일 때 던지세요');
  setHint('범위가 벗어나면 바로 실패!');

  const track = document.createElement('div');
  track.className = 'bt-track';
  const trackBg = document.createElement('img');
  trackBg.src = aimBarUrl;
  trackBg.alt = '';
  track.append(trackBg);

  // 구간이 가장자리에 붙으면 왕복 끝에서 손잡이가 오래 머물러 쉬워진다 — 안쪽에만 둔다.
  const zoneStart = 0.08 + Math.random() * (1 - zoneW - 0.16);
  const zoneEnd = zoneStart + zoneW;

  // 목표 구간 — 빈 채널 위에 초록 박스 하나만 얹는 대신, 채널 전체를 빨강↔초록
  // 그라디언트로 물들여서 "여기가 성공 범위" 가 한눈에 보이게 한다. 경계에는 약간의
  // 블렌드 폭을 둬 목업처럼 부드럽게 섞이게 한다(칼같이 자르면 싸구려 티가 난다).
  const BLEND = 0.035;
  const pct = (v) => `${Math.max(0, Math.min(100, v * 100)).toFixed(2)}%`;
  const RED = '#8a2a1e';
  const GREEN = '#3f9a3f';
  const gradient = document.createElement('div');
  gradient.className = 'bt-gradient';
  gradient.style.backgroundImage = `linear-gradient(90deg, ${RED} 0%, ${RED} ${pct(zoneStart - BLEND)}, ${GREEN} ${pct(zoneStart + BLEND)}, ${GREEN} ${pct(zoneEnd - BLEND)}, ${RED} ${pct(zoneEnd + BLEND)}, ${RED} 100%)`;

  const handle = document.createElement('div');
  handle.className = 'bt-handle';
  const handleImg = document.createElement('img');
  handleImg.src = handleUrl;
  handleImg.alt = '';
  handle.append(handleImg);

  track.append(gradient, handle);

  const spaceBtn = createSpaceButton('bt-plate', spaceNormalUrl, spacePressedUrl);

  content.replaceChildren(track, spaceBtn.el);

  let rafId = 0;
  let pos = 0;
  let last = performance.now();
  let elapsed = 0;
  let done = false;

  const tick = () => {
    const now = performance.now();
    elapsed += Math.min(now - last, MAX_FRAME_MS);
    last = now;
    // 삼각파: 0 → 1 → 0 반복. sin 이면 양끝에서 느려져 가장자리가 거저먹기가 된다.
    const phase = (elapsed / sweepMs) % 2;
    pos = phase <= 1 ? phase : 2 - phase;
    handle.style.left = `${pos * 100}%`;
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  const stop = () => {
    if (done) return;
    done = true;
    spaceBtn.flash();
    cancelAnimationFrame(rafId);
    onResult(pos >= zoneStart && pos <= zoneEnd);
  };

  track.addEventListener('click', stop);
  panel.onKey = (e) => { if (e.key === ' ' || e.key === 'Enter') stop(); };

  return () => {
    cancelAnimationFrame(rafId);
    spaceBtn.cleanup();
  };
}
