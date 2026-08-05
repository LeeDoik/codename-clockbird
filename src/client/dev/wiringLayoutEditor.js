/**
 * 감옥 퍼즐 — 배선 잇기 좌표 직접 배치용 개발자 전용 화면 (?wiringlayout).
 *
 * 자석 폭탄 투척 때 쓴 ?bomblayout 과 같은 목적·같은 방식이다 — 코드로 좌표를 추측해
 * 넣고 화면으로 확인하는 왕복 대신, 실제 그림을 드래그·리사이즈해서 위치를 잡고 그
 * 결과 숫자를 그대로 lockPuzzle.js/index.html 에 옮긴다.
 *
 * 이 퍼즐은 자석 폭탄과 달리 "단계(충전/투척)" 가 없다 — 화면이 하나뿐이라 단계
 * 전환 UI가 필요 없다. 대신 조각이 훨씬 많다: 종횡비 고정 그림 조각(헤더·안내판·
 * 그리드·정답표판·타이머판·번호 버튼 4개)과, 그 위에 얹는 자유 크기 텍스트/클릭
 * 영역(제목·초기화·타이머 숫자·규칙·피드백·정답표 문구, 그리고 도형 4개의 클릭
 * 영역)이다. 도형 클릭 영역은 실제 그림(.wp-bg 안에 이미 그려져 있음)이 없어서
 * 라벨만 있는 빈 점선 박스로 보여준다 — 그리드 그림 위에 겹쳐서 위치만 맞추면 된다.
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

const SCALE = 1.2; // 화면에서 보이는 배율 — 값은 전부 실제(1x) px 로 환산해 내보낸다.
const CARD_W = 1600;
const CARD_H = 904;
const STORE_KEY = 'wiringLayoutEditor.v1';

/** 종횡비 고정 그림 조각 — 리사이즈는 폭만 조절하고 높이는 여기서 유도한다(프로덕션과 동일).
 * img 가 없는 항목(도형 클릭 영역)은 실제 그림이 없어 라벨만 있는 빈 박스로 그린다. */
const BOX_DEFS = {
  bg: { img: wpBgUrl, aspect: 2096 / 1184, label: '배경(그리드)', left: 299, top: 177, width: 1301 },
  header: { img: wpHeaderUrl, aspect: 1869 / 207, label: '헤더', left: 0, top: 0, width: 1600 },
  info: { img: wpInfoUrl, aspect: 415 / 1010, label: '안내판', left: 0, top: 177, width: 299 },
  legend: { img: wpLegendUrl, aspect: 604 / 159, label: '정답표판', left: 692, top: 178, width: 500 },
  timer: { img: wpTimerUrl, aspect: 698 / 304, label: '타이머판', left: 830, top: 28, width: 280 },
  num1: { img: wpNum1Url, aspect: 1, label: '번호1', left: 652 - 74.5, top: 301 - 74.5, width: 149 },
  num2: { img: wpNum2Url, aspect: 1, label: '번호2', left: 652 - 74.5, top: 455 - 74.5, width: 149 },
  num3: { img: wpNum3Url, aspect: 1, label: '번호3', left: 652 - 74.5, top: 608 - 74.5, width: 149 },
  num4: { img: wpNum4Url, aspect: 1, label: '번호4', left: 652 - 74.5, top: 761 - 74.5, width: 149 },
  shapeTriangle: { img: null, aspect: 1, label: '▲ 자리', left: 1272 - 75, top: 301 - 75, width: 150 },
  shapeSquare: { img: null, aspect: 1, label: '■ 자리', left: 1272 - 75, top: 455 - 75, width: 150 },
  shapeCircle: { img: null, aspect: 1, label: '● 자리', left: 1272 - 75, top: 608 - 75, width: 150 },
  shapeStar: { img: null, aspect: 1, label: '★ 자리', left: 1272 - 75, top: 761 - 75, width: 150 },
};

/** 자유 리사이즈 텍스트 박스 — 밑에 깔린 그림 조각(헤더/안내판/정답표판/타이머판) 위에
 * 겹쳐서 글자 위치만 맞춘다. 자체 그림은 없다. */
const TEXTBOX_DEFS = {
  title: {
    label: '제목', left: 40, top: 0, width: 520, height: 177,
    text: '배선 잇기', textLeft: 20, textTop: 70, fontSize: 32,
  },
  resetLabel: {
    label: '초기화 라벨', left: 1390, top: 51, width: 195, height: 77,
    text: '초기화', textLeft: 40, textTop: 25, fontSize: 22,
  },
  timerText: {
    label: '타이머 숫자', left: 830, top: 28, width: 280, height: 122,
    text: '00:20', textLeft: 100, textTop: 40, fontSize: 34,
  },
  subtitle: {
    label: '규칙 설명', left: 28, top: 255, width: 243, height: 100,
    text: '표를 보고 번호를 우측 도형에\n순서대로 연결한다.', textLeft: 0, textTop: 0, fontSize: 18,
  },
  hint: {
    label: '진행 피드백', left: 28, top: 560, width: 243, height: 80,
    text: '번호를 먼저 고르고, 이어질 도형을 누른다.', textLeft: 0, textTop: 0, fontSize: 17,
  },
  legendText: {
    label: '정답표 문구', left: 692, top: 178, width: 500, height: 46,
    text: '1→▲   2→■   3→●   4→★', textLeft: 20, textTop: 10, fontSize: 19,
  },
};

const DEFAULTS = {
  boxes: Object.fromEntries(
    Object.entries(BOX_DEFS).map(([k, v]) => [k, { left: v.left, top: v.top, width: v.width }]),
  ),
  texts: Object.fromEntries(
    Object.entries(TEXTBOX_DEFS).map(([k, v]) => [k, {
      left: v.left, top: v.top, width: v.width, height: v.height, text: v.text,
      textLeft: v.textLeft, textTop: v.textTop, fontSize: v.fontSize,
    }]),
  ),
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

export function initWiringLayoutEditor() {
  const state = loadState() ?? cloneDefaults();
  const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));

  const root = document.createElement('div');
  root.id = 'wiring-layout-editor';
  root.innerHTML = `
    <style>
      #wiring-layout-editor {
        position: fixed; inset: 0; z-index: 10000;
        background: #1a1712; color: #e8dcc0; font-family: system-ui, sans-serif; font-size: 13px;
        display: flex; align-items: stretch;
      }
      #wle-stage-wrap {
        flex: 1; display: flex; align-items: center; justify-content: center;
        overflow: auto; background:
          repeating-conic-gradient(#26221a 0% 25%, #201c15 0% 50%) 0 0 / 20px 20px;
      }
      #wle-stage {
        position: relative; width: ${CARD_W * SCALE}px; height: ${CARD_H * SCALE}px;
        background: #0f0d0a; border: 2px solid #7a5f1a; border-radius: 10px; overflow: hidden;
        box-shadow: 0 24px 60px rgba(0,0,0,0.7); flex-shrink: 0;
      }
      .wle-box {
        position: absolute; box-sizing: border-box; z-index: 2;
        border: 2px dashed rgba(232, 193, 90, 0.85);
        background: rgba(232, 193, 90, 0.08);
        cursor: move;
      }
      .wle-box img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
      .wle-box.no-img { display: flex; align-items: center; justify-content: center; }
      .wle-box .wle-label, .wle-textbox .wle-label {
        position: absolute; top: -20px; left: 0; font-size: 11px; color: #e8c15a;
        background: rgba(10,9,7,0.8); padding: 1px 5px; border-radius: 2px; white-space: nowrap;
      }
      .wle-handle {
        position: absolute; right: -6px; bottom: -6px; width: 14px; height: 14px;
        background: #e8c15a; border: 1px solid #1a1712; border-radius: 50%; cursor: nwse-resize; z-index: 6;
      }
      /* 텍스트 박스 — 항상 맨 앞, 자유 리사이즈, 텍스트 직접 편집. */
      .wle-textbox {
        position: absolute; box-sizing: border-box; z-index: 5;
        border: 2px dashed rgba(120, 200, 255, 0.85);
        cursor: move;
      }
      .wle-textbox .wle-text {
        position: absolute; max-width: calc(100% - 16px); white-space: pre-wrap;
        color: #e8c15a; font-weight: 700; font-family: Georgia, serif;
        outline: none; cursor: text; text-shadow: 0 1px 3px rgba(0,0,0,0.9);
      }
      .wle-text-handle {
        position: absolute; width: 16px; height: 16px; margin-left: -20px; margin-top: -2px;
        background: rgba(120, 200, 255, 0.9); border: 1px solid #1a1712; border-radius: 3px;
        cursor: move; z-index: 7; font-size: 10px; display: flex; align-items: center;
        justify-content: center; color: #1a1712;
      }
      #wle-panel {
        width: 320px; padding: 14px; overflow-y: auto; border-left: 1px solid #4a4234;
        display: flex; flex-direction: column; gap: 14px;
      }
      #wle-panel h3 { margin: 0 0 6px; color: #c9a227; font-size: 14px; }
      #wle-panel p.wle-hint-text { margin: 0; opacity: 0.65; font-size: 11.5px; line-height: 1.5; }
      #wle-actions button {
        background: #2a2416; border: 1px solid #7a5f1a; color: #e8dcc0; padding: 6px 10px;
        border-radius: 4px; cursor: pointer; font-size: 12px;
      }
      #wle-out {
        width: 100%; height: 320px; background: #0f0d0a; color: #9fdc9f; font-family: monospace;
        font-size: 11px; border: 1px solid #4a4234; border-radius: 4px; padding: 8px; resize: vertical;
      }
      #wle-close { position: absolute; top: 8px; right: 8px; }
    </style>
    <div id="wle-stage-wrap">
      <div id="wle-stage"></div>
    </div>
    <div id="wle-panel">
      <button id="wle-close">✕ 닫기</button>
      <h3>배선 잇기 좌표 편집</h3>
      <p class="wle-hint-text">노란 점선 = 그림 조각(드래그로 이동, 모서리 손잡이로 폭 리사이즈 — 높이는 원본 비율대로 자동). 파란 점선 = 텍스트(자유 리사이즈, 글자 클릭해서 바로 수정, 노란 손잡이 ✥ 로 글자만 옮기기, 글자 위에서 휠로 크기 조절).</p>
      <div id="wle-actions">
        <button id="wle-reset">기본값으로</button>
        <button id="wle-copy">값 복사</button>
      </div>
      <textarea id="wle-out" readonly></textarea>
    </div>
  `;
  document.body.appendChild(root);

  const stage = root.querySelector('#wle-stage');
  const outEl = root.querySelector('#wle-out');

  // ---- 종횡비 고정 그림 조각 ----
  const boxEls = {};
  function makeBox(key, def) {
    const el = document.createElement('div');
    el.className = def.img ? 'wle-box' : 'wle-box no-img';
    if (def.img) {
      const img = document.createElement('img');
      img.src = def.img;
      img.alt = '';
      el.append(img);
    }
    const lab = document.createElement('div');
    lab.className = 'wle-label';
    lab.textContent = def.label;
    const handle = document.createElement('div');
    handle.className = 'wle-handle';
    el.append(lab, handle);
    if (!def.img) el.append(document.createTextNode(''));
    stage.appendChild(el);
    boxEls[key] = el;

    let mode = null;
    let start = null;
    el.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      mode = 'move';
      const box = state.boxes[key];
      start = { x: e.clientX, y: e.clientY, left: box.left, top: box.top };
    });
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      mode = 'resize';
      const box = state.boxes[key];
      start = { x: e.clientX, y: e.clientY, width: box.width };
    });
    window.addEventListener('mousemove', (e) => {
      if (!mode) return;
      const box = state.boxes[key];
      if (mode === 'move') {
        box.left = start.left + (e.clientX - start.x) / SCALE;
        box.top = start.top + (e.clientY - start.y) / SCALE;
      } else {
        box.width = Math.max(16, start.width + (e.clientX - start.x) / SCALE);
      }
      renderBox(key);
    });
    window.addEventListener('mouseup', () => {
      if (mode) { mode = null; save(); syncOutput(); }
    });
  }

  function renderBox(key) {
    const el = boxEls[key];
    const box = state.boxes[key];
    const def = BOX_DEFS[key];
    const h = box.width / def.aspect;
    el.style.left = `${box.left * SCALE}px`;
    el.style.top = `${box.top * SCALE}px`;
    el.style.width = `${box.width * SCALE}px`;
    el.style.height = `${h * SCALE}px`;
  }

  for (const [key, def] of Object.entries(BOX_DEFS)) makeBox(key, def);
  function renderAllBoxes() {
    for (const key of Object.keys(BOX_DEFS)) renderBox(key);
  }

  // ---- 자유 리사이즈 텍스트 박스 ----
  const textEls = {};
  function makeTextBox(key, def) {
    const el = document.createElement('div');
    el.className = 'wle-textbox';
    const lab = document.createElement('div');
    lab.className = 'wle-label';
    lab.textContent = def.label;
    const text = document.createElement('div');
    text.className = 'wle-text';
    text.contentEditable = 'true';
    text.spellcheck = false;
    text.textContent = state.texts[key].text;
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'wle-handle';
    const textHandle = document.createElement('div');
    textHandle.className = 'wle-text-handle';
    textHandle.textContent = '✥';
    textHandle.title = '드래그해서 글자 위치만 옮기기';
    el.append(text, textHandle, lab, resizeHandle);
    stage.appendChild(el);
    textEls[key] = { el, text, textHandle };

    text.addEventListener('input', () => {
      state.texts[key].text = text.textContent;
      save();
      syncOutput();
    });
    text.addEventListener('mousedown', (e) => e.stopPropagation());
    text.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const box = state.texts[key];
      box.fontSize = Math.max(8, Math.min(72, box.fontSize - Math.sign(e.deltaY) * 1));
      renderTextBox(key);
      save();
      syncOutput();
    }, { passive: false });

    let mode = null;
    let start = null;
    el.addEventListener('mousedown', (e) => {
      if (e.target === text) return;
      e.stopPropagation();
      e.preventDefault();
      mode = 'move';
      const box = state.texts[key];
      start = { x: e.clientX, y: e.clientY, left: box.left, top: box.top };
    });
    resizeHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      mode = 'resize';
      const box = state.texts[key];
      start = { x: e.clientX, y: e.clientY, width: box.width, height: box.height };
    });
    textHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      mode = 'moveText';
      const box = state.texts[key];
      start = { x: e.clientX, y: e.clientY, textLeft: box.textLeft, textTop: box.textTop };
    });
    window.addEventListener('mousemove', (e) => {
      if (!mode) return;
      const box = state.texts[key];
      if (mode === 'move') {
        box.left = start.left + (e.clientX - start.x) / SCALE;
        box.top = start.top + (e.clientY - start.y) / SCALE;
      } else if (mode === 'resize') {
        box.width = Math.max(20, start.width + (e.clientX - start.x) / SCALE);
        box.height = Math.max(16, start.height + (e.clientY - start.y) / SCALE);
      } else {
        box.textLeft = Math.max(0, start.textLeft + (e.clientX - start.x) / SCALE);
        box.textTop = Math.max(0, start.textTop + (e.clientY - start.y) / SCALE);
      }
      renderTextBox(key);
    });
    window.addEventListener('mouseup', () => {
      if (mode) { mode = null; save(); syncOutput(); }
    });
  }

  function renderTextBox(key) {
    const { el, text, textHandle } = textEls[key];
    const box = state.texts[key];
    el.style.left = `${box.left * SCALE}px`;
    el.style.top = `${box.top * SCALE}px`;
    el.style.width = `${box.width * SCALE}px`;
    el.style.height = `${box.height * SCALE}px`;
    text.style.left = `${box.textLeft * SCALE}px`;
    text.style.top = `${box.textTop * SCALE}px`;
    text.style.fontSize = `${box.fontSize * SCALE}px`;
    textHandle.style.left = `${box.textLeft * SCALE}px`;
    textHandle.style.top = `${box.textTop * SCALE}px`;
  }

  for (const [key, def] of Object.entries(TEXTBOX_DEFS)) makeTextBox(key, def);
  function renderAllTextBoxes() {
    for (const key of Object.keys(TEXTBOX_DEFS)) renderTextBox(key);
  }

  // ---- 내보내기 ----
  function syncOutput() {
    outEl.value = JSON.stringify(state, null, 2);
  }

  root.querySelector('#wle-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(outEl.value);
      const btn = root.querySelector('#wle-copy');
      const old = btn.textContent;
      btn.textContent = '복사됨!';
      setTimeout(() => { btn.textContent = old; }, 1000);
    } catch {
      outEl.select();
    }
  });
  root.querySelector('#wle-reset').addEventListener('click', () => {
    Object.assign(state, cloneDefaults());
    for (const key of Object.keys(TEXTBOX_DEFS)) {
      textEls[key].text.textContent = state.texts[key].text;
    }
    renderAllBoxes();
    renderAllTextBoxes();
    save();
    syncOutput();
  });
  root.querySelector('#wle-close').addEventListener('click', () => root.remove());

  // ---- 초기 렌더 ----
  renderAllBoxes();
  renderAllTextBoxes();
  syncOutput();
}
