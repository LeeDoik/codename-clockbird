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

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
const range = (n) => Array.from({ length: n }, (_, i) => i);

/** 오답 허용치. 한 번은 봐주고 두 번째에 잠금장치가 잠긴다. */
const MAX_MISTAKES = 2;

const button = (label) => {
  const b = document.createElement('button');
  b.className = 'mg-btn';
  b.textContent = label;
  return b;
};

const row = (children) => {
  const d = document.createElement('div');
  d.className = 'mg-row';
  d.append(...children);
  return d;
};

const legend = (html) => {
  const d = document.createElement('div');
  d.className = 'mg-legend';
  d.innerHTML = html;
  return d;
};

/**
 * 유형 1 — 배선 잇기.
 * 좌측 기호 단자를 대응표가 지정한 우측 번호 단자에 잇는다. 표를 읽어야 풀린다.
 */
function wiring() {
  const SYMBOLS = ['◆', '▲', '●', '■', '★'];
  const symbols = shuffle(SYMBOLS).slice(0, 4);
  const numbers = shuffle(range(4).map((i) => i + 1));
  // 기호 → 번호 대응. 이 표가 곧 정답이다.
  const map = new Map(symbols.map((s, i) => [s, numbers[i]]));

  return {
    title: '배선 잇기',
    subtitle: '대응표대로 좌측 단자를 우측 단자에 잇는다.',
    hint: '기호를 누르고, 이어질 번호를 누른다.',
    mount(content, { finish, setHint }) {
      content.append(
        legend(symbols.map((s) => `<b>${s}</b>→${map.get(s)}`).join('&nbsp;&nbsp; ')),
      );

      const leftBtns = new Map();
      const rightBtns = new Map();
      let selected = null;
      let solved = 0;
      let mistakes = 0;

      // 좌우를 각각 섞어 표의 나열 순서가 곧 정답 순서가 되지 않게 한다.
      const left = row(shuffle(symbols).map((s) => {
        const b = button(s);
        leftBtns.set(s, b);
        b.onclick = () => {
          if (selected) leftBtns.get(selected).classList.remove('sel');
          selected = s;
          b.classList.add('sel');
        };
        return b;
      }));

      const right = row(shuffle(numbers).map((n) => {
        const b = button(String(n));
        rightBtns.set(n, b);
        b.onclick = () => {
          if (!selected) { setHint('먼저 좌측 기호를 고른다.'); return; }
          if (map.get(selected) === n) {
            leftBtns.get(selected).classList.remove('sel');
            leftBtns.get(selected).classList.add('done');
            leftBtns.get(selected).disabled = true;
            b.classList.add('done');
            b.disabled = true;
            selected = null;
            if (++solved === symbols.length) finish(true);
          } else {
            b.classList.add('bad');
            setTimeout(() => b.classList.remove('bad'), 250);
            if (++mistakes >= MAX_MISTAKES) finish(false);
            else setHint('불꽃이 튄다. 한 번 더 틀리면 잠긴다.');
          }
        };
        return b;
      }));

      content.append(left, right);
    },
  };
}

/**
 * 유형 2 — 키패드 순서.
 * 눈금 여섯 개를 지시받은 순서로 누른다. 정렬만 하면 되지만 시간 압박이 있다.
 */
function keypad() {
  const values = shuffle(range(30).map((i) => i + 1)).slice(0, 6);
  const ascending = Math.random() < 0.5;
  const order = [...values].sort((a, b) => (ascending ? a - b : b - a));

  return {
    title: '눈금 조정',
    subtitle: ascending ? '눈금을 낮은 쪽부터 차례로 누른다.' : '눈금을 높은 쪽부터 차례로 누른다.',
    hint: '',
    mount(content, { finish, setHint }) {
      let idx = 0;
      let mistakes = 0;

      content.append(row(values.map((v) => {
        const b = button(String(v));
        b.onclick = () => {
          if (v === order[idx]) {
            b.classList.add('done');
            b.disabled = true;
            if (++idx === order.length) finish(true);
          } else {
            b.classList.add('bad');
            setTimeout(() => b.classList.remove('bad'), 250);
            if (++mistakes >= MAX_MISTAKES) finish(false);
            else setHint('눈금이 어긋났다. 한 번 더 틀리면 잠긴다.');
          }
        };
        return b;
      })));
    },
  };
}

/**
 * 유형 3 — 압력 맞추기.
 * 밸브 둘을 골라 합을 목표 압력에 맞춘다. 답이 하나만 나오도록 값을 고른다.
 */
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
    title: '압력 조정',
    subtitle: `두 밸브를 열어 압력을 ${target} 에 맞춘다.`,
    hint: '두 개를 고르면 자동으로 잠긴다.',
    mount(content, { finish, setHint }) {
      const selected = new Set();
      let mistakes = 0;

      content.append(row(values.map((v) => {
        const b = button(String(v));
        b.onclick = () => {
          if (selected.has(v)) {
            selected.delete(v);
            b.classList.remove('sel');
            return;
          }
          selected.add(v);
          b.classList.add('sel');
          if (selected.size < 2) return;

          if (selected.has(x) && selected.has(y)) {
            finish(true);
            return;
          }
          // 틀린 조합 — 선택을 풀어 다시 고르게 한다.
          for (const el of content.querySelectorAll('.mg-btn.sel')) {
            el.classList.remove('sel');
            el.classList.add('bad');
            setTimeout(() => el.classList.remove('bad'), 250);
          }
          selected.clear();
          if (++mistakes >= MAX_MISTAKES) finish(false);
          else setHint('압력이 맞지 않는다. 한 번 더 틀리면 잠긴다.');
        };
        return b;
      })));
    },
  };
}

const TYPES = [wiring, keypad, pressure];

/** 제한 시간. 넉넉하지만 손이 굳을 만큼은 짧다. */
const TIME_LIMIT_MS = 30_000;

/**
 * 감옥 퍼즐 한 판을 실행한다.
 *
 * @param {import('../ui/MinigamePanel.js').MinigamePanel} panel
 * @returns {Promise<boolean>} 성공 여부
 */
export function runLockPuzzle(panel) {
  const puzzle = pick(TYPES)();
  return panel.run({
    title: `창살 잠금장치 — ${puzzle.title}`,
    subtitle: puzzle.subtitle,
    hint: puzzle.hint,
    timeLimitMs: TIME_LIMIT_MS,
    render: ({ content, finish, setHint }) => {
      puzzle.mount(content, { finish, setHint });
    },
  });
}
