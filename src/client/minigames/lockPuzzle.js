/**
 * 감옥 퍼즐 — 창살 잠금장치를 푸는 미니게임.
 *
 * 두 자리에서 쓴다: 갇힌 **동료를 빼낼 때**(밖에서)와 플레이어 **자신이 갇혔을 때**
 * (안에서). 구출은 한 동료당 한 번뿐이라 반복 압박이 없다. 그래서 반사신경이 아니라
 * 잠깐 생각하게 만드는 쪽으로 짰다. 대신 판당 최대 4번(감옥에 갇힐 수 있는 인원수)
 * 까지, 자기 탈출까지 세면 그보다 더 나오므로 유형을 셋 두고 매번 다르게 출제한다.
 *
 * LLM 을 쓰지 않는다 — 생성 지연(2~4초)이 붙으면 "잠깐 생각하는 맛"이 대기로 바뀌고,
 * API 장애가 구출 자체를 막아 버린다. 감옥 앞 소프트락은 가장 피하고 싶은 사고다.
 *
 * ── 2026-08-06 화면을 새로 짰다 ──
 *
 * 규칙은 한 줄도 안 바뀌었다. 바뀐 것은 **판을 어떻게 보여 주느냐**다.
 *
 * 예전에는 셋 다 가운데에 뜬 작은 카드 안에서 단추 몇 개가 한 줄로 늘어선 모양이었다.
 * 부품 그림을 입혀도 여전히 "아이콘 줄"로 보였는데, 원인이 그림이 아니라 **배치**였다.
 * 기획 목업의 셋은 전부 같은 골격을 쓴다:
 *
 *     ┌──────────────────────────────── 머리띠 (제목 · 시계 · 남은 시간)
 *     │ 정보 레일 │ 작 업 판                     │
 *     └──────────────────────────────── 바닥띠 (경고 한 줄)
 *
 * 왼쪽 레일이 "무엇을 해야 하나"를 계속 붙들고 있고, 오른쪽 판이 기계다. 그래서
 * 각 유형이 `rail()` 과 `board()` 를 따로 낸다 — 예전의 `mount(content)` 하나로는
 * 이 골격을 못 만든다.
 */

import { playBgm, playSfx } from '../audio/SoundManager.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
const range = (n) => Array.from({ length: n }, (_, i) => i);

/** 오답 허용치. 한 번은 봐주고 두 번째에 잠금장치가 잠긴다. */
const MAX_MISTAKES = 2;
/** 제한 시간. 넉넉하지만 손이 굳을 만큼은 짧다. */
const TIME_LIMIT_MS = 30_000;

const el = (tag, cls, text) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text != null) d.textContent = text;
  return d;
};

/** 기계 부품 단추 하나. 글자는 그림 위에 CSS 가 얹는다 (부품 그림은 가운데가 비어 있다). */
const part = (label) => {
  const b = el('button', 'lp-part');
  b.type = 'button';
  b.append(el('span', 'lp-face', label));
  return b;
};

/** 오답 표시 — 250ms 뒤 스스로 걷힌다. 세 유형이 같은 몸짓을 쓴다. */
const flashBad = (node) => {
  node.classList.add('bad');
  setTimeout(() => node.classList.remove('bad'), 250);
};

// ─────────────────────────────────────────────────────────────────
// 유형 1 — 배선 잇기
//
// 좌측 기호 단자를 대응표가 지정한 우측 번호 단자에 잇는다. 표를 읽어야 풀린다.
//
// ⚠ 목업은 왼쪽이 숫자 다이얼이고 오른쪽이 도형이다. 여기는 **반대**로 두었다 —
//   규칙이 "기호를 누르고 이어질 번호를 누른다" 라서, 먼저 누를 것이 왼쪽에
//   있어야 손이 왼→오로 자연스럽게 흐른다. 둥근 포트 / 사각 단자라는 모양의
//   구분은 목업 그대로다.
// ─────────────────────────────────────────────────────────────────
function wiring() {
  const SYMBOLS = ['◆', '▲', '●', '■', '★'];
  const symbols = shuffle(SYMBOLS).slice(0, 4);
  const numbers = shuffle(range(4).map((i) => i + 1));
  // 기호 → 번호 대응. 이 표가 곧 정답이다.
  const map = new Map(symbols.map((s, i) => [s, numbers[i]]));
  /** 이어진 배선의 색 — 목업의 빨강·파랑·초록·황동 순서 그대로. */
  const CABLE = ['#a8382a', '#3f6fa8', '#4a8f3d', '#c9a227'];

  return {
    kind: 'wiring',
    title: '전선 연결',
    subtitle: '대응표대로 좌측 단자를 우측 단자에 잇는다.',
    hint: '기호를 누르고, 이어질 번호를 누른다.',

    rail() {
      const r = document.createDocumentFragment();
      r.append(el('div', 'lp-rail-label', '배선표'));
      const table = el('div', 'lp-table');
      for (const s of symbols) {
        const line = el('div', 'lp-table-row');
        line.append(el('span', 'lp-sym', s), el('span', 'lp-arrow', '→'), el('span', 'lp-num', String(map.get(s))));
        table.append(line);
      }
      r.append(table);
      r.append(el('p', 'lp-note', '표에 적힌 짝끼리만 이어진다.\n엉뚱한 단자를 물리면 불꽃이 튄다.'));
      return r;
    },

    board(content, { finish, setHint }) {
      const wrap = el('div', 'lp-wire');
      // 배선이 그려질 층. 단추보다 아래에 깔린다 — 케이블이 단자 위를 덮으면
      // 숫자가 안 보인다.
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'lp-cables');
      const left = el('div', 'lp-col lp-col-left');
      const right = el('div', 'lp-col lp-col-right');
      wrap.append(svg, left, right);
      content.append(wrap);

      const leftBtns = new Map();
      const rightBtns = new Map();
      let selected = null;
      let solved = 0;
      let mistakes = 0;

      // 좌우를 각각 섞어 표의 나열 순서가 곧 정답 순서가 되지 않게 한다.
      for (const s of shuffle(symbols)) {
        const b = part(s);
        b.classList.add('lp-port');
        leftBtns.set(s, b);
        b.onclick = () => {
          if (b.disabled) return;
          if (selected) leftBtns.get(selected).classList.remove('sel');
          selected = s;
          b.classList.add('sel');
        };
        left.append(b);
      }

      for (const n of shuffle(numbers)) {
        const b = part(String(n));
        b.classList.add('lp-jack');
        rightBtns.set(n, b);
        b.onclick = () => {
          if (b.disabled) return;
          if (!selected) { setHint('먼저 좌측 기호를 고른다.'); return; }
          if (map.get(selected) === n) {
            playSfx('switch');
            const from = leftBtns.get(selected);
            from.classList.remove('sel');
            from.classList.add('done');
            from.disabled = true;
            b.classList.add('done');
            b.disabled = true;
            drawCable(from, b, CABLE[solved % CABLE.length]);
            selected = null;
            if (++solved === symbols.length) finish(true);
          } else {
            flashBad(b);
            if (++mistakes >= MAX_MISTAKES) finish(false);
            else setHint('불꽃이 튄다. 한 번 더 틀리면 잠긴다.');
          }
        };
        right.append(b);
      }

      /**
       * 이어진 두 단자 사이에 케이블을 그린다.
       *
       * 목업의 케이블은 늘어진 곡선이다. 직선으로 그으면 회로도처럼 보이고,
       * 늘어져야 "선을 물려 놓았다"로 읽힌다 — 제어점을 가로 중간에 두 개 두고
       * 그 사이를 벌려 S 자를 만든다.
       *
       * ⚠ 좌표는 wrap 기준이다. getBoundingClientRect 는 화면 기준이라 그대로 쓰면
       *   패널이 화면 가운데 떠 있는 만큼 선이 어긋난다.
       */
      function drawCable(a, b, color) {
        const base = wrap.getBoundingClientRect();
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const x1 = ra.right - base.left;
        const y1 = ra.top + ra.height / 2 - base.top;
        const x2 = rb.left - base.left;
        const y2 = rb.top + rb.height / 2 - base.top;
        const mid = (x2 - x1) / 2;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`);
        path.setAttribute('stroke', color);
        path.setAttribute('class', 'lp-cable');
        svg.append(path);
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// 유형 2 — 압력 밸브
//
// 눈금 여섯 개를 지시받은 순서로 누른다. 정렬만 하면 되지만 시간 압박이 있다.
// ─────────────────────────────────────────────────────────────────
function keypad() {
  const values = shuffle(range(30).map((i) => i + 1)).slice(0, 6);
  const ascending = Math.random() < 0.5;
  const order = [...values].sort((a, b) => (ascending ? a - b : b - a));

  return {
    kind: 'keypad',
    title: '압력 밸브 조절',
    subtitle: ascending ? '압력이 낮은 밸브부터 차례로 연다.' : '압력이 높은 밸브부터 차례로 연다.',
    hint: '잘못된 순서로 열면 압력이 치솟는다.',

    rail() {
      const r = document.createDocumentFragment();
      r.append(el('div', 'lp-rail-label', '안전 절차'));
      r.append(el('p', 'lp-note', ascending
        ? '저압 → 고압 순서로 열어야\n압력이 안정된다.'
        : '고압 → 저압 순서로 열어야\n압력이 안정된다.'));
      r.append(el('div', 'lp-rail-label', '연 순서'));
      // 연 밸브가 차례로 채워진다. **자기가 한 일을 되읽는 칸**이지 답을 알려
      // 주는 칸이 아니다 — 규칙은 그대로다.
      const slots = el('div', 'lp-slots');
      for (const _ of values) slots.append(el('div', 'lp-slot'));
      r.append(slots);
      this._slots = slots;
      return r;
    },

    board(content, { finish, setHint }) {
      const rowEl = el('div', 'lp-valves');
      content.append(rowEl);

      const slots = this._slots;
      let idx = 0;
      let mistakes = 0;

      for (const v of values) {
        const b = part(String(v));
        b.classList.add('lp-valve');
        // 밸브 아래 번호판 — 목업의 1·2·3·4 자리. 값이 아니라 **자리 번호**다.
        b.append(el('span', 'lp-valve-tag', String(values.indexOf(v) + 1)));
        b.onclick = () => {
          if (b.disabled) return;
          if (v === order[idx]) {
            playSfx('steam');
            b.classList.add('done');
            b.disabled = true;
            slots.children[idx].textContent = String(v);
            slots.children[idx].classList.add('filled');
            if (++idx === order.length) finish(true);
          } else {
            flashBad(b);
            if (++mistakes >= MAX_MISTAKES) finish(false);
            else setHint('압력이 치솟는다. 한 번 더 틀리면 잠긴다.');
          }
        };
        rowEl.append(b);
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// 유형 3 — 기어비 계산
//
// 기어 둘을 골라 합을 목표 출력에 맞춘다. 답이 하나만 나오도록 값을 고른다.
// ─────────────────────────────────────────────────────────────────
function pressure() {
  // 서로 다른 값 다섯 개를 뽑고, 그중 "합이 유일한" 짝만 정답 후보로 삼는다.
  // 같은 합을 만드는 짝이 둘이면 정답이 둘이 되어 판정이 거짓말을 하게 된다.
  let values;
  let unique;
  do {
    values = shuffle(range(24).map((i) => i + 2)).slice(0, 5);
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

  return {
    kind: 'pressure',
    title: '기어비 계산',
    subtitle: '두 개의 기어를 골라 목표 출력값을 만든다.',
    hint: '두 개를 고르면 자동으로 맞춰 본다.',

    rail() {
      const r = document.createDocumentFragment();
      r.append(el('div', 'lp-rail-label', '목표 출력'));
      r.append(el('div', 'lp-target', String(target)));
      r.append(el('p', 'lp-note', '고른 두 기어의 수를 더해\n목표 출력값과 같아야 한다.'));
      return r;
    },

    board(content, { finish, setHint }) {
      const rowEl = el('div', 'lp-gears');
      // 아래 계산 띠 — 목업의 [선택1] + [선택2] = [출력].
      const sum = el('div', 'lp-sum');
      const s1 = el('div', 'lp-slot lp-slot-round');
      const s2 = el('div', 'lp-slot lp-slot-round');
      const out = el('div', 'lp-out', '0');
      sum.append(
        el('span', 'lp-sum-label', '선택 1'), s1,
        el('span', 'lp-op', '+'),
        el('span', 'lp-sum-label', '선택 2'), s2,
        el('span', 'lp-op', '='),
        el('span', 'lp-sum-label', '출력'), out,
      );
      content.append(rowEl, sum);

      const selected = new Set();
      const btns = new Map();
      let mistakes = 0;

      const redraw = () => {
        const picked = [...selected];
        s1.textContent = picked[0] != null ? String(picked[0]) : '';
        s2.textContent = picked[1] != null ? String(picked[1]) : '';
        s1.classList.toggle('filled', picked[0] != null);
        s2.classList.toggle('filled', picked[1] != null);
        const total = picked.reduce((a, b) => a + b, 0);
        out.textContent = String(total);
        out.classList.toggle('hit', picked.length === 2 && total === target);
      };

      for (const v of values) {
        const b = part(String(v));
        b.classList.add('lp-gear');
        btns.set(v, b);
        b.onclick = () => {
          if (selected.has(v)) {
            selected.delete(v);
            b.classList.remove('sel');
            redraw();
            return;
          }
          playSfx('gear');
          selected.add(v);
          b.classList.add('sel');
          redraw();
          if (selected.size < 2) return;

          if (selected.has(x) && selected.has(y)) {
            finish(true);
            return;
          }
          // 틀린 조합 — 선택을 풀어 다시 고르게 한다.
          for (const [, node] of btns) {
            if (!node.classList.contains('sel')) continue;
            node.classList.remove('sel');
            flashBad(node);
          }
          selected.clear();
          redraw();
          if (++mistakes >= MAX_MISTAKES) finish(false);
          else setHint('기어가 맞물리지 않는다. 한 번 더 틀리면 잠긴다.');
        };
        rowEl.append(b);
      }
    },
  };
}

const TYPES = [wiring, keypad, pressure];

/**
 * 감옥 퍼즐 한 판을 실행한다.
 *
 * 같은 잠금장치를 양쪽에서 연다. `from: 'inside'` 는 **플레이어 자신이 갇혔을 때**로,
 * 붙잡혀 창살 안에 있는 경우다 (StageScene#toJail). 규칙과 유형은 그대로 두고 제목만
 * 바꾼다 — 퍼즐이 다른 물건인 척할 이유가 없고, 어느 쪽에서 여는지는 플레이어가 이미 안다.
 *
 * @param {import('../ui/MinigamePanel.js').MinigamePanel} panel
 * @param {{from?: 'outside'|'inside'}} [opts]
 * @returns {Promise<boolean>} 성공 여부
 */
export function runLockPuzzle(panel, { from = 'outside' } = {}) {
  const puzzle = pick(TYPES)();
  playBgm('minigame2');
  return panel.run({
    title: `${from === 'inside' ? '감옥 탈출' : '창살 잠금장치'} — ${puzzle.title}`,
    subtitle: puzzle.subtitle,
    hint: puzzle.hint,
    timeLimitMs: TIME_LIMIT_MS,
    layout: 'lock',
    render: ({ content, finish, setHint }) => {
      // 유형은 겉모습에만 전해진다 — CSS 가 `[data-puzzle]` 로 세 기계를 가려낸다.
      content.dataset.puzzle = puzzle.kind;

      const rail = el('aside', 'lp-rail');
      const board = el('div', 'lp-board');
      rail.append(puzzle.rail());
      content.append(rail, board);

      // ⚠ 판을 붙인 **뒤에** 그려야 한다. 배선 잇기의 케이블이 단자의 실제 위치를
      //   재는데, DOM 에 안 붙은 요소는 크기가 0 이라 선이 한 점으로 뭉친다.
      puzzle.board(board, { finish, setHint });

      return () => { delete content.dataset.puzzle; };
    },
  }).then((result) => {
    playBgm('stage1');
    return result;
  });
}
