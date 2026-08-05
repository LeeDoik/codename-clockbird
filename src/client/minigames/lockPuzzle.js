/**
 * 감옥 퍼즐 — 창살 잠금장치를 푸는 미니게임.
 *
 * 구출은 한 동료당 한 번뿐이라 반복 압박이 없다. 그래서 반사신경이 아니라 잠깐
 * 생각하게 만드는 쪽으로 짰다. 대신 판당 최대 4번(감옥에 갇힐 수 있는 인원수)까지
 * 나오므로 유형을 셋 두고 매번 다르게 출제한다.
 *
 * LLM 을 쓰지 않는다 — 생성 지연(2~4초)이 붙으면 "잠깐 생각하는 맛"이 대기로 바뀌고,
 * API 장애가 구출 자체를 막아 버린다. 감옥 앞 소프트락은 가장 피하고 싶은 사고다.
 */

import wpBgUrl from '../assets/minigame/wp-bg.png';
import wpHeaderUrl from '../assets/minigame/wp-header.png';
import wpInfoUrl from '../assets/minigame/wp-info.png';
import wpLegendUrl from '../assets/minigame/wp-legend.png';
import wpTimerUrl from '../assets/minigame/wp-timer.png';
import wpNum1Url from '../assets/minigame/wp-num-1.png';
import wpNum2Url from '../assets/minigame/wp-num-2.png';
import wpNum3Url from '../assets/minigame/wp-num-3.png';
import wpNum4Url from '../assets/minigame/wp-num-4.png';
import wpHoseRedUrl from '../assets/minigame/wp-hose-red.png';
import wpHoseBlueUrl from '../assets/minigame/wp-hose-blue.png';
import wpHoseGreenUrl from '../assets/minigame/wp-hose-green.png';
import wpHoseYellowUrl from '../assets/minigame/wp-hose-yellow.png';
import wpFillTriangleUrl from '../assets/minigame/wp-fill-triangle.png';
import wpFillSquareUrl from '../assets/minigame/wp-fill-square.png';
import wpFillCircleUrl from '../assets/minigame/wp-fill-circle.png';
import wpFillStarUrl from '../assets/minigame/wp-fill-star.png';
import opBgUrl from '../assets/minigame/op-bg.png';
import opResetUrl from '../assets/minigame/op-reset.png';
import ppBgUrl from '../assets/minigame/pp-bg.png';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
const range = (n) => Array.from({ length: n }, (_, i) => i);

/** 오답 허용치. 한 번은 봐주고 두 번째에 잠금장치가 잠긴다. */
const MAX_MISTAKES = 2;

/** 배선 잇기 전용 리스킨 좌표 — 카드 설계 단위(1600×904, calc(N*var(--s))) 기준으로,
 * ?wiringlayout 에디터에서 사용자가 직접 드래그해 잡은 값이다(번호 4개는 서로 다른
 * 자리에 놓였다 — 그림의 빈 링 위치가 완전히 나란하지 않아서 하나씩 맞춘 결과다).
 * 도형은 정체성마다 색이 고정돼 있다(그림 자체가 그렇게 나와 있다 — 삼각=빨강,
 * 사각=파랑, 원=초록, 별=노랑). 랜덤은 "몇 번이 어느 도형으로 가는가" 뿐이다. */
const WP_NUM_POS = {
  1: { x: 650.33, y: 321.83 },
  2: { x: 653.67, y: 472.5 },
  3: { x: 650.33, y: 623 },
  4: { x: 650.33, y: 778.5 },
};
const WP_SHAPE_POS = {
  triangle: { x: 1272, y: 301 },
  square: { x: 1272, y: 455 },
  circle: { x: 1272, y: 608 },
  star: { x: 1272, y: 761 },
};
const WP_PORT_R = 75; // 번호·도형 링 반지름 — 호스가 시작/끝나는 가장자리 계산용.
const WP_NUM_URL = { 1: wpNum1Url, 2: wpNum2Url, 3: wpNum3Url, 4: wpNum4Url };
const WP_SHAPES = ['triangle', 'square', 'circle', 'star'];
const WP_SHAPE_NAME = { triangle: '▲', square: '■', circle: '●', star: '★' };
const WP_SHAPE_COLOR = { triangle: 'red', square: 'blue', circle: 'green', star: 'yellow' };
// 정답 도형이 채워질 때 쓰는 그림 — steampunk_brass_ 계열 포트를 도형별로 그대로 쓴다.
const WP_SHAPE_FILL_URL = {
  triangle: wpFillTriangleUrl, square: wpFillSquareUrl, circle: wpFillCircleUrl, star: wpFillStarUrl,
};
const WP_HOSE_URL = { red: wpHoseRedUrl, blue: wpHoseBlueUrl, green: wpHoseGreenUrl, yellow: wpHoseYellowUrl };
// 호스 원본 이미지의 실제 가로:세로 비율 — 늘일 때 이 비율로 높이를 derive 해서 찌그러지지 않게 한다.
const WP_HOSE_ASPECT = { red: 1415 / 198, blue: 1427 / 171, green: 1427 / 159, yellow: 1718 / 184 };
const WP_TIME_LIMIT_MS = 30_000;

/** 압력 밸브 조절(순서) 전용 좌표 — 카드 설계 단위(1600×850). 밸브 4개가 전부 같은
 * 그림이라 중심 X 좌표 4개만 있으면 된다. */
const OP_VALVE_X = [680.333, 903, 1169, 1435];
const OP_VALVE_TOP = 310;
const OP_SLOT_X = [115.556, 207.222, 301.111, 389.444];
const OP_SLOT_TOP = [750, 753.333, 751.111, 745.556];
const OP_TIME_LIMIT_MS = 30_000;

/** 압력 조정(합) 전용 좌표 — 카드 설계 단위(1600×904, steampunk_gear_puzzle_template
 * 배경 자체의 종횡비 2096:1184 에 맞췄다). 게이지 4개가 배경에 이미 그려져 있어
 * 그 중심 좌표만 있으면 되고, 아래 작은 원 2개는 지금까지 고른 값을 보여주는
 * 슬롯으로 쓴다. */
const PP_GEAR_X = [534.444, 796.667, 1054.444, 1325.556];
const PP_GEAR_TOP = [373.111, 369.778, 368.667, 369.778];
const PP_SLOT_X = [477.333, 836.667];
const PP_SLOT_TOP = [646.667, 644.444];
const PP_TIME_LIMIT_MS = 30_000;

/**
 * 유형 3 — 압력 조정(합).
 * 게이지 넷 중 둘을 골라 합을 목표 압력에 맞춘다. 답이 하나만 나오도록 값을 고른다.
 */
function runPressure(panel) {
  const card = document.getElementById('minigame-card');
  card.classList.add('pp-active');

  // 서로 다른 값 네 개를 뽑고, 그중 "합이 유일한" 짝만 정답 후보로 삼는다.
  // 같은 합을 만드는 짝이 둘이면 정답이 둘이 되어 판정이 거짓말을 하게 된다.
  let values;
  let unique;
  do {
    values = shuffle(range(24).map((i) => i + 2)).slice(0, 4);
    const pairs = [];
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) pairs.push([values[i], values[j]]);
    }
    const count = new Map();
    for (const [a, b] of pairs) count.set(a + b, (count.get(a + b) ?? 0) + 1);
    unique = pairs.filter(([a, b]) => count.get(a + b) === 1);
  } while (unique.length === 0);

  const [x, y] = pick(unique);
  const target = x + y;

  const bg = document.createElement('img');
  bg.className = 'pp-bg';
  bg.src = ppBgUrl;
  bg.alt = '';

  const rule = document.createElement('div');
  rule.className = 'pp-rule';
  rule.textContent = `목표 압력: ${target}`;

  const slotEls = [0, 1].map((i) => {
    const s = document.createElement('span');
    s.className = 'pp-slot';
    s.style.left = `calc(${PP_SLOT_X[i]} * var(--s))`;
    s.style.top = `calc(${PP_SLOT_TOP[i]} * var(--s))`;
    return s;
  });

  const timerText = document.createElement('span');
  timerText.className = 'pp-timer-text';

  card.append(bg, rule, ...slotEls, timerText);

  let timerRafId = 0;
  let timerLast = performance.now();
  let timerElapsed = 0;
  const tickTimer = () => {
    const now = performance.now();
    timerElapsed += Math.min(now - timerLast, 100);
    timerLast = now;
    const remainMs = Math.max(0, PP_TIME_LIMIT_MS - timerElapsed);
    const remainSec = Math.ceil(remainMs / 1000);
    timerText.textContent = `00:${String(remainSec).padStart(2, '0')}`;
    timerText.classList.toggle('blink', remainMs <= 5000);
    if (remainMs > 0) timerRafId = requestAnimationFrame(tickTimer);
  };
  timerRafId = requestAnimationFrame(tickTimer);

  return panel.run({
    title: '압력 조정',
    subtitle: '게이지 둘을 골라 압력을 목표에 맞추세요.',
    hint: '두 개를 고르면 자동으로 잠긴다.',
    timeLimitMs: PP_TIME_LIMIT_MS,
    render: ({ content, finish, setHint }) => {
      const selected = new Set();
      let mistakes = 0;
      let slotIdx = 0;
      const gearEls = [];

      values.forEach((v, i) => {
        const btn = document.createElement('div');
        btn.className = 'pp-gear';
        btn.style.left = `calc(${PP_GEAR_X[i]} * var(--s))`;
        btn.style.top = `calc(${PP_GEAR_TOP[i]} * var(--s))`;
        const valueEl = document.createElement('div');
        valueEl.className = 'pp-gear-value';
        valueEl.textContent = String(v);
        btn.append(valueEl);
        btn.onclick = () => {
          if (btn.classList.contains('sel')) return;
          if (selected.size >= 2) return;
          selected.add(v);
          btn.classList.add('sel');
          slotEls[slotIdx].textContent = String(v);
          slotIdx += 1;
          if (selected.size < 2) return;

          if (selected.has(x) && selected.has(y)) {
            finish(true);
            return;
          }
          // 틀린 조합 — 선택을 풀어 다시 고르게 한다.
          for (const el of gearEls) {
            if (el.classList.contains('sel')) {
              el.classList.remove('sel');
              el.classList.add('bad');
              setTimeout(() => el.classList.remove('bad'), 250);
            }
          }
          selected.clear();
          slotIdx = 0;
          slotEls.forEach((s) => { s.textContent = ''; });
          if (++mistakes >= MAX_MISTAKES) finish(false);
          else setHint('압력이 맞지 않는다. 한 번 더 틀리면 잠긴다.');
        };
        gearEls.push(btn);
        content.append(btn);
      });

      // 판정 문구가 뜨는 동안(약 800ms) MinigamePanel 이 content 를 안 비운 채로 놔두는데,
      // 그 사이 pp-active 를 지우면 자리 잡은 게이지가 다음 위치 기준 조상으로 튀어 카드
      // 밖에 붕 떠 보인다 — 여기서 바로 치운다.
      return () => {
        content.replaceChildren();
        cancelAnimationFrame(timerRafId);
        bg.remove();
        rule.remove();
        slotEls.forEach((s) => s.remove());
        timerText.remove();
        card.classList.remove('pp-active');
      };
    },
  });
}

/**
 * 유형 1 — 배선 잇기 (그림 리스킨판).
 *
 * 왼쪽 번호(1~4)와 오른쪽 도형(삼각·사각·원·별)은 항상 같은 자리에 그려진 그림
 * (BG_1) 위에 얹힌다 — 자리가 바뀌면 이미 이은 호스와 어긋나므로 절대 섞지 않는다.
 * 대신 "몇 번이 어느 도형으로 이어지는가"만 매판 무작위로 정해서 좌측 안내판 위
 * 명판(.wp-legend)에 "1→네모" 식 표로 띄운다. 도형마다 색이 그림 자체에 고정돼
 * 있어(삼각=빨강 등) 호스 색도 그 도형을 따라간다 — 랜덤으로 고를 대상이 아니다.
 *
 * 번호를 먼저 고르고 도형을 눌러 확인하는 흐름이다. 세 유형(wiring/keypad/pressure)
 * 모두 각자 그림에 맞춰 따로 짠 함수라 서로 공유하는 렌더링 로직은 없다.
 */
function runWiring(panel) {
  const card = document.getElementById('minigame-card');
  card.classList.add('wp-active');

  // 번호 → 도형의 무작위 대응 — 이 판의 정답표.
  const shapesShuffled = shuffle(WP_SHAPES);
  const answer = new Map([1, 2, 3, 4].map((n, i) => [n, shapesShuffled[i]]));
  const legendText = [1, 2, 3, 4].map((n) => `${n}→${WP_SHAPE_NAME[answer.get(n)]}`).join('   ');

  const header = document.createElement('img');
  header.className = 'wp-header';
  header.src = wpHeaderUrl;
  header.alt = '';
  const info = document.createElement('img');
  info.className = 'wp-info';
  info.src = wpInfoUrl;
  info.alt = '';
  const grid = document.createElement('div');
  grid.className = 'wp-grid';
  const gridBg = document.createElement('img');
  gridBg.className = 'wp-bg-img';
  gridBg.src = wpBgUrl;
  gridBg.alt = '';
  grid.append(gridBg);

  const legend = document.createElement('div');
  legend.className = 'wp-legend';
  legend.style.backgroundImage = `url("${wpLegendUrl}")`;
  legend.style.backgroundSize = '100% 100%';
  legend.style.backgroundRepeat = 'no-repeat';
  const legendSpan = document.createElement('span');
  legendSpan.className = 'wp-legend-text';
  legendSpan.textContent = legendText;
  legend.append(legendSpan);

  const timerChip = document.createElement('div');
  timerChip.className = 'wp-timer-chip';
  timerChip.style.backgroundImage = `url("${wpTimerUrl}")`;
  timerChip.style.backgroundSize = '100% 100%';
  timerChip.style.backgroundRepeat = 'no-repeat';
  const timerText = document.createElement('span');
  timerText.className = 'wp-timer-text';
  timerChip.append(timerText);

  const resetLabel = document.createElement('div');
  resetLabel.className = 'wp-reset-label';
  resetLabel.textContent = '초기화';

  card.append(header, info, grid, legend, timerChip, resetLabel);

  let timerRafId = 0;
  let timerLast = performance.now();
  let timerElapsed = 0;
  const tickTimer = () => {
    const now = performance.now();
    timerElapsed += Math.min(now - timerLast, 100);
    timerLast = now;
    const remainMs = Math.max(0, WP_TIME_LIMIT_MS - timerElapsed);
    const remainSec = Math.ceil(remainMs / 1000);
    timerText.textContent = `00:${String(remainSec).padStart(2, '0')}`;
    timerText.classList.toggle('blink', remainMs <= 5000);
    if (remainMs > 0) timerRafId = requestAnimationFrame(tickTimer);
  };
  timerRafId = requestAnimationFrame(tickTimer);

  return panel.run({
    title: '배선 잇기',
    subtitle: '표를 보고 번호를 우측 도형에\n순서대로 연결한다.',
    hint: '번호를 먼저 고르고, 이어질 도형을 누른다.',
    timeLimitMs: WP_TIME_LIMIT_MS,
    render: ({ content, finish, setHint }) => {
      const numBtns = new Map();
      let selectedNum = null;
      let solved = 0;
      let mistakes = 0;

      [1, 2, 3, 4].forEach((n) => {
        const pos = WP_NUM_POS[n];
        const btn = document.createElement('div');
        btn.className = 'wp-num-btn';
        btn.style.left = `calc(${pos.x} * var(--s))`;
        btn.style.top = `calc(${pos.y} * var(--s))`;
        const img = document.createElement('img');
        img.src = WP_NUM_URL[n];
        img.alt = String(n);
        btn.append(img);
        btn.onclick = () => {
          if (btn.classList.contains('done')) return;
          if (selectedNum != null) numBtns.get(selectedNum).classList.remove('sel');
          selectedNum = n;
          btn.classList.add('sel');
        };
        numBtns.set(n, btn);
        content.append(btn);
      });

      WP_SHAPES.forEach((shape) => {
        const pos = WP_SHAPE_POS[shape];
        const btn = document.createElement('div');
        btn.className = 'wp-shape-btn';
        btn.style.left = `calc(${pos.x} * var(--s))`;
        btn.style.top = `calc(${pos.y} * var(--s))`;
        const fillImg = document.createElement('img');
        fillImg.className = 'wp-shape-fill';
        fillImg.src = WP_SHAPE_FILL_URL[shape];
        fillImg.alt = '';
        btn.append(fillImg);
        btn.onclick = () => {
          if (btn.classList.contains('done')) return;
          if (selectedNum == null) { setHint('먼저 번호를 고른다.'); return; }
          const n = selectedNum;
          if (answer.get(n) === shape) {
            const color = WP_SHAPE_COLOR[shape];
            drawHose(content, n, shape, color);
            numBtns.get(n).classList.remove('sel');
            numBtns.get(n).classList.add('done');
            btn.classList.add('done');
            selectedNum = null;
            if (++solved === 4) finish(true);
          } else {
            numBtns.get(n).classList.add('bad');
            btn.classList.add('bad');
            setTimeout(() => {
              numBtns.get(n).classList.remove('bad');
              btn.classList.remove('bad');
            }, 250);
            if (++mistakes >= MAX_MISTAKES) finish(false);
            else setHint('불꽃이 튄다. 한 번 더 틀리면 잠긴다.');
          }
        };
        content.append(btn);
      });

      // 판정 문구가 뜨는 동안(약 800ms) MinigamePanel 이 content 를 안 비운 채로 놔두는데,
      // 그 사이 wp-active 를 지우면 자리 잡은 번호·도형·호스가 다음 위치 기준 조상으로
      // 튀어 카드 밖에 붕 떠 보인다(자석 폭탄에서 겪은 것과 같은 문제) — 여기서 바로
      // 다 치운다.
      return () => {
        content.replaceChildren();
        cancelAnimationFrame(timerRafId);
        header.remove();
        info.remove();
        grid.remove();
        legend.remove();
        timerChip.remove();
        resetLabel.remove();
        card.classList.remove('wp-active');
      };
    },
  });
}

/** 번호 i 우측 가장자리 → 도형 좌측 가장자리로 이어지는 호스를 그린다. 원본이 고정된
 * S자 곡선이라, 두 점 사이 각도·거리로 회전·신축시켜 붙이는 방식이 유일한 선택이다. */
function drawHose(content, n, shape, color) {
  const p1 = WP_NUM_POS[n];
  const p2 = WP_SHAPE_POS[shape];
  const x1 = p1.x + WP_PORT_R;
  const y1 = p1.y;
  const x2 = p2.x - WP_PORT_R;
  const y2 = p2.y;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const height = dist / WP_HOSE_ASPECT[color];

  const hose = document.createElement('div');
  hose.className = 'wp-hose';
  hose.style.left = `calc(${x1} * var(--s))`;
  hose.style.top = `calc(${y1 - height / 2} * var(--s))`;
  hose.style.width = `calc(${dist} * var(--s))`;
  hose.style.height = `calc(${height} * var(--s))`;
  hose.style.transform = `rotate(${angle}deg)`;
  const img = document.createElement('img');
  img.src = WP_HOSE_URL[color];
  img.alt = '';
  hose.append(img);
  content.append(hose);
}

/**
 * 유형 2 — 압력 밸브 조절 (그림 리스킨판, 기존 keypad() 대체).
 *
 * steampunk_valve_template 은 헤더·안내판·밸브 4개까지 이미 한 장에 다 그려진
 * 완성형 배경이라(연출을 따로 많이 넣을 필요가 없어 그대로 쓰기로 함), 배선 잇기처럼
 * 조각을 따로 배치하지 않고 배경 이미지 한 장(.op-bg) 위에 텍스트·클릭 영역만 얹는다.
 * 매판 무작위 값 4개를 뽑고, 오름차순/내림차순을 무작위로 정한 뒤 그 값 그대로 게이지
 * 자리에 얹는다 — 정답은 "낮은 값부터" 또는 "높은 값부터" 누르는 것뿐이라 규칙 문구를
 * 압력 단계 이름(저압/중압/고압/최고압)으로 설명한다. 좌측 안내판의 네모 4칸(그림에
 * 이미 그려져 있음)엔 지금까지 누른 값을 텍스트로만 얹는다.
 *
 * 우하단 Meta AI 워터마크는 초기화 버튼(aged_brass_plate_1)으로 가린다 — 장식이
 * 아니라 실제로 누르면 지금까지 고른 순서(선택)만 지운다. 이미 낸 오답 횟수는 그대로
 * 남는다 — 그것까지 지우면 오답 제한(MAX_MISTAKES)을 무의미하게 우회하는 버튼이
 * 되어 버린다.
 */
function runOrder(panel) {
  const card = document.getElementById('minigame-card');
  card.classList.add('op-active');

  const values = shuffle(range(30).map((i) => i + 1)).slice(0, 4);
  const ascending = Math.random() < 0.5;
  const order = [...values].sort((a, b) => (ascending ? a - b : b - a));
  const ruleText = ascending ? '저압 → 중압 → 고압 → 최고압' : '최고압 → 고압 → 중압 → 저압';

  const bg = document.createElement('img');
  bg.className = 'op-bg';
  bg.src = opBgUrl;
  bg.alt = '';

  const rule = document.createElement('div');
  rule.className = 'op-rule';
  rule.textContent = ruleText;

  const progressLabel = document.createElement('div');
  progressLabel.className = 'op-progress-label';
  progressLabel.textContent = '선택 순서';
  const slotEls = [0, 1, 2, 3].map((i) => {
    const s = document.createElement('span');
    s.className = 'op-progress-slot';
    s.style.left = `calc(${OP_SLOT_X[i]} * var(--s))`;
    s.style.top = `calc(${OP_SLOT_TOP[i]} * var(--s))`;
    return s;
  });

  const timerText = document.createElement('span');
  timerText.className = 'op-timer-text';

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'op-reset-btn';
  const resetImg = document.createElement('img');
  resetImg.src = opResetUrl;
  resetImg.alt = '';
  const resetLabel = document.createElement('span');
  resetLabel.textContent = '초기화';
  resetBtn.append(resetImg, resetLabel);

  card.append(bg, rule, progressLabel, ...slotEls, timerText, resetBtn);

  let timerRafId = 0;
  let timerLast = performance.now();
  let timerElapsed = 0;
  const tickTimer = () => {
    const now = performance.now();
    timerElapsed += Math.min(now - timerLast, 100);
    timerLast = now;
    const remainMs = Math.max(0, OP_TIME_LIMIT_MS - timerElapsed);
    const remainSec = Math.ceil(remainMs / 1000);
    timerText.textContent = `00:${String(remainSec).padStart(2, '0')}`;
    timerText.classList.toggle('blink', remainMs <= 5000);
    if (remainMs > 0) timerRafId = requestAnimationFrame(tickTimer);
  };
  timerRafId = requestAnimationFrame(tickTimer);

  return panel.run({
    title: '압력 밸브 조절',
    subtitle: '압력이 폭발하지 않도록\n올바른 순서로 밸브를 여세요.',
    hint: '밸브를 순서대로 누르세요.',
    timeLimitMs: OP_TIME_LIMIT_MS,
    render: ({ content, finish, setHint }) => {
      let idx = 0;
      let mistakes = 0;
      const valveEls = [];

      values.forEach((v, i) => {
        const btn = document.createElement('div');
        btn.className = 'op-valve';
        btn.style.left = `calc(${OP_VALVE_X[i]} * var(--s))`;
        btn.style.top = `calc(${OP_VALVE_TOP} * var(--s))`;
        const valueEl = document.createElement('div');
        valueEl.className = 'op-valve-value';
        valueEl.textContent = String(v);
        const unitEl = document.createElement('div');
        unitEl.className = 'op-valve-unit';
        unitEl.textContent = `${v} kPa`;
        btn.append(valueEl, unitEl);
        btn.onclick = () => {
          if (btn.classList.contains('done')) return;
          if (v === order[idx]) {
            btn.classList.add('done');
            slotEls[idx].textContent = String(v);
            if (++idx === order.length) finish(true);
          } else {
            btn.classList.add('bad');
            setTimeout(() => btn.classList.remove('bad'), 250);
            if (++mistakes >= MAX_MISTAKES) finish(false);
            else setHint('압력이 어긋났다. 한 번 더 틀리면 폭발한다.');
          }
        };
        valveEls.push(btn);
        content.append(btn);
      });

      // 초기화 — 오답 횟수(mistakes)는 그대로 두고, 지금까지 고른 순서(선택)만 지운다.
      resetBtn.onclick = () => {
        idx = 0;
        for (const el of valveEls) el.classList.remove('done', 'sel', 'bad');
        for (const s of slotEls) s.textContent = '';
        setHint('밸브를 순서대로 누르세요.');
      };

      // 판정 문구가 뜨는 동안(약 800ms) MinigamePanel 이 content 를 안 비운 채로 놔두는데,
      // 그 사이 op-active 를 지우면 자리 잡은 밸브가 다음 위치 기준 조상으로 튀어 카드
      // 밖에 붕 떠 보인다(자석 폭탄·배선 잇기에서 겪은 것과 같은 문제) — 여기서 바로 치운다.
      return () => {
        content.replaceChildren();
        cancelAnimationFrame(timerRafId);
        bg.remove();
        rule.remove();
        progressLabel.remove();
        slotEls.forEach((s) => s.remove());
        timerText.remove();
        resetBtn.remove();
        card.classList.remove('op-active');
      };
    },
  });
}

/**
 * 감옥 퍼즐 한 판을 실행한다.
 *
 * @param {import('../ui/MinigamePanel.js').MinigamePanel} panel
 * @param {'wiring'|'keypad'|'pressure'} [forceType] 생략하면 무작위 — 개발용 테스트 도구가
 *        특정 유형만 반복해서 확인하고 싶을 때 쓴다. 실제 게임 경로는 안 넘긴다.
 * @returns {Promise<boolean>} 성공 여부
 */
export function runLockPuzzle(panel, forceType) {
  const type = forceType ?? pick(['wiring', 'keypad', 'pressure']);
  if (type === 'wiring') return runWiring(panel);
  if (type === 'keypad') return runOrder(panel);
  return runPressure(panel);
}
