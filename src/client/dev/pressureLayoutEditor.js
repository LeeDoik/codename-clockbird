/**
 * 감옥 퍼즐 — 압력 조정(합) 좌표 직접 배치용 개발자 전용 화면 (?pressurelayout).
 *
 * ?orderlayout 과 같은 목적·같은 방식이다 — 실제 그림을 드래그·리사이즈해서 위치를
 * 잡고, 그 결과 숫자를 그대로 lockPuzzle.js/index.html 에 옮긴다.
 *
 * steampunk_gear_puzzle_template 을 배경(.pp-bg) 한 장으로 그대로 쓰기로 하면서
 * (연출을 따로 많이 넣을 필요가 없어서), 톱니바퀴 게이지 4개는 그림 위에 얹는 "빈
 * 클릭 영역"일 뿐이라 각자 따로 그림 조각이 없다 — 그래서 게이지 4개는 노란 점선
 * 대신 하늘색 점선 빈 박스(원형)로 잡는다. 게이지 숫자는 게이지 4개가 전부 같은
 * 상대 오프셋을 공유하므로 게이지1 위에서만 잡는다.
 */

import ppBgUrl from '../assets/minigame/pp-bg.png';

const SCALE = 0.9;
const CARD_W = 1600;
const CARD_H = 904;
const STORE_KEY = 'pressureLayoutEditor.v1';

const PP_GEAR_X = [534.444, 796.667, 1054.444, 1325.556];
const PP_GEAR_TOP = [373.111, 369.778, 368.667, 369.778];
const PP_SLOT_X = [477.333, 836.667];
const PP_SLOT_TOP = [646.667, 644.444];

/** 종횡비 고정 그림 조각/빈 클릭 영역. img 가 없으면 그냥 점선 빈 박스만 그린다. */
const BOX_DEFS = {
  bg: { img: ppBgUrl, aspect: 1700 / 960, label: '배경', left: 0, top: 0, width: 1600 },
  gear1: { aspect: 1, label: '게이지1 클릭영역', left: PP_GEAR_X[0] - 110, top: PP_GEAR_TOP[0] - 110, width: 220 },
  gear2: { aspect: 1, label: '게이지2 클릭영역', left: PP_GEAR_X[1] - 110, top: PP_GEAR_TOP[1] - 110, width: 220 },
  gear3: { aspect: 1, label: '게이지3 클릭영역', left: PP_GEAR_X[2] - 110, top: PP_GEAR_TOP[2] - 110, width: 220 },
  gear4: { aspect: 1, label: '게이지4 클릭영역', left: PP_GEAR_X[3] - 110, top: PP_GEAR_TOP[3] - 110, width: 220 },
};

/** 자유 리사이즈 텍스트 박스. gearValue 는 게이지1 위에서만 잡되, 실제 코드에는
 * 게이지1 기준 상대 오프셋으로 옮겨써야 한다(4개 게이지가 전부 이 값을 공유). */
const TEXTBOX_DEFS = {
  title: {
    label: '제목', left: 344.444, top: 38.333, width: 460, height: 40,
    text: '압력 조정', textLeft: 0, textTop: 0, fontSize: 26,
  },
  subtitle: {
    label: '부제', left: 346.667, top: 86.889, width: 460, height: 34,
    text: '게이지 둘을 골라 압력을 목표에 맞추세요.', textLeft: 0, textTop: 0, fontSize: 14,
  },
  timerText: {
    label: '타이머 숫자', left: 1401.111, top: 71.667, width: 160, height: 40,
    text: '00:20', textLeft: 0, textTop: 0, fontSize: 24,
  },
  hint: {
    label: '진행 피드백', left: 100, top: 626.667, width: 360, height: 90,
    text: '두 개를 고르면 자동으로 잠긴다.', textLeft: 0, textTop: 0, fontSize: 15,
  },
  rule: {
    label: '목표 압력 문구', left: 82.222, top: 288.889, width: 480, height: 50,
    text: '목표 압력: 30', textLeft: 0, textTop: 0, fontSize: 20,
  },
  slot1: { label: '슬롯1', left: PP_SLOT_X[0], top: PP_SLOT_TOP[0], width: 80, height: 80, text: '12', textLeft: 0, textTop: 0, fontSize: 26 },
  slot2: { label: '슬롯2', left: PP_SLOT_X[1], top: PP_SLOT_TOP[1], width: 80, height: 80, text: '18', textLeft: 0, textTop: 0, fontSize: 26 },
  gearValue: {
    label: '게이지 숫자(게이지1 기준, 4개 공유)', left: 480, top: 232, width: 80, height: 40,
    text: '26', textLeft: 0, textTop: 0, fontSize: 34,
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

export function initPressureLayoutEditor() {
  const state = loadState() ?? cloneDefaults();
  const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));

  const root = document.createElement('div');
  root.id = 'pressure-layout-editor';
  root.innerHTML = `
    <style>
      #pressure-layout-editor {
        position: fixed; inset: 0; z-index: 10000;
        background: #1a1712; color: #e8dcc0; font-family: system-ui, sans-serif; font-size: 13px;
        display: flex; align-items: stretch;
      }
      #ple-stage-wrap {
        flex: 1; display: flex; align-items: center; justify-content: center;
        overflow: auto; background:
          repeating-conic-gradient(#26221a 0% 25%, #201c15 0% 50%) 0 0 / 20px 20px;
      }
      #ple-stage {
        position: relative; width: ${CARD_W * SCALE}px; height: ${CARD_H * SCALE}px;
        background: #0f0d0a; border: 2px solid #7a5f1a; border-radius: 10px; overflow: hidden;
        box-shadow: 0 24px 60px rgba(0,0,0,0.7); flex-shrink: 0;
      }
      .ple-box {
        position: absolute; box-sizing: border-box; z-index: 2;
        border: 2px dashed rgba(232, 193, 90, 0.85);
        background: rgba(232, 193, 90, 0.08);
        cursor: move;
      }
      .ple-box.ple-zone { background: rgba(120, 200, 255, 0.12); border-color: rgba(120, 200, 255, 0.85); border-radius: 50%; }
      .ple-box img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
      .ple-box .ple-label, .ple-textbox .ple-label {
        position: absolute; top: -20px; left: 0; font-size: 11px; color: #e8c15a;
        background: rgba(10,9,7,0.8); padding: 1px 5px; border-radius: 2px; white-space: nowrap;
      }
      .ple-handle {
        position: absolute; right: -6px; bottom: -6px; width: 14px; height: 14px;
        background: #e8c15a; border: 1px solid #1a1712; border-radius: 50%; cursor: nwse-resize; z-index: 6;
      }
      .ple-textbox {
        position: absolute; box-sizing: border-box; z-index: 5;
        border: 2px dashed rgba(120, 200, 255, 0.85);
        cursor: move;
      }
      .ple-textbox .ple-text {
        position: absolute; max-width: calc(100% - 16px); white-space: pre-wrap;
        color: #e8c15a; font-weight: 700; font-family: Georgia, serif;
        outline: none; cursor: text; text-shadow: 0 1px 3px rgba(0,0,0,0.9);
      }
      .ple-text-handle {
        position: absolute; width: 16px; height: 16px; margin-left: -20px; margin-top: -2px;
        background: rgba(120, 200, 255, 0.9); border: 1px solid #1a1712; border-radius: 3px;
        cursor: move; z-index: 7; font-size: 10px; display: flex; align-items: center;
        justify-content: center; color: #1a1712;
      }
      #ple-panel {
        width: 320px; padding: 14px; overflow-y: auto; border-left: 1px solid #4a4234;
        display: flex; flex-direction: column; gap: 14px;
      }
      #ple-panel h3 { margin: 0 0 6px; color: #c9a227; font-size: 14px; }
      #ple-panel p.ple-hint-text { margin: 0; opacity: 0.65; font-size: 11.5px; line-height: 1.5; }
      #ple-actions button {
        background: #2a2416; border: 1px solid #7a5f1a; color: #e8dcc0; padding: 6px 10px;
        border-radius: 4px; cursor: pointer; font-size: 12px;
      }
      #ple-out {
        width: 100%; height: 320px; background: #0f0d0a; color: #9fdc9f; font-family: monospace;
        font-size: 11px; border: 1px solid #4a4234; border-radius: 4px; padding: 8px; resize: vertical;
      }
      #ple-close { position: absolute; top: 8px; right: 8px; }
    </style>
    <div id="ple-stage-wrap">
      <div id="ple-stage"></div>
    </div>
    <div id="ple-panel">
      <button id="ple-close">✕ 닫기</button>
      <h3>압력 조정 좌표 편집</h3>
      <p class="ple-hint-text">노란 점선 = 배경 그림. 하늘색 점선 원 = 빈 클릭 영역(게이지 4개, 그림은 배경에 이미 있음) 또는 텍스트(자유 리사이즈, 글자 클릭해서 바로 수정, 노란 손잡이 ✥ 로 글자만 옮기기, 글자 위에서 휠로 크기 조절). "게이지 숫자"는 게이지1 위에서만 잡아도 4개 전부에 같은 자리로 적용돼.</p>
      <div id="ple-actions">
        <button id="ple-reset">기본값으로</button>
        <button id="ple-copy">값 복사</button>
      </div>
      <textarea id="ple-out" readonly></textarea>
    </div>
  `;
  document.body.appendChild(root);

  const stage = root.querySelector('#ple-stage');
  const outEl = root.querySelector('#ple-out');

  const boxEls = {};
  function makeBox(key, def) {
    const el = document.createElement('div');
    el.className = 'ple-box';
    if (!def.img) el.classList.add('ple-zone');
    if (def.img) {
      const img = document.createElement('img');
      img.src = def.img;
      img.alt = '';
      el.append(img);
    }
    const lab = document.createElement('div');
    lab.className = 'ple-label';
    lab.textContent = def.label;
    const handle = document.createElement('div');
    handle.className = 'ple-handle';
    el.append(lab, handle);
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

  const textEls = {};
  function makeTextBox(key, def) {
    const el = document.createElement('div');
    el.className = 'ple-textbox';
    const lab = document.createElement('div');
    lab.className = 'ple-label';
    lab.textContent = def.label;
    const text = document.createElement('div');
    text.className = 'ple-text';
    text.contentEditable = 'true';
    text.spellcheck = false;
    text.textContent = state.texts[key].text;
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'ple-handle';
    const textHandle = document.createElement('div');
    textHandle.className = 'ple-text-handle';
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

  function syncOutput() {
    outEl.value = JSON.stringify(state, null, 2);
  }

  root.querySelector('#ple-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(outEl.value);
      const btn = root.querySelector('#ple-copy');
      const old = btn.textContent;
      btn.textContent = '복사됨!';
      setTimeout(() => { btn.textContent = old; }, 1000);
    } catch {
      outEl.select();
    }
  });
  root.querySelector('#ple-reset').addEventListener('click', () => {
    Object.assign(state, cloneDefaults());
    for (const key of Object.keys(TEXTBOX_DEFS)) {
      textEls[key].text.textContent = state.texts[key].text;
    }
    renderAllBoxes();
    renderAllTextBoxes();
    save();
    syncOutput();
  });
  root.querySelector('#ple-close').addEventListener('click', () => root.remove());

  renderAllBoxes();
  renderAllTextBoxes();
  syncOutput();
}
