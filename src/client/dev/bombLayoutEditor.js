/**
 * 자석 폭탄 투척 미니게임 — 좌표 직접 배치용 개발자 전용 화면 (?bomblayout).
 *
 * 코드로 숫자를 추측해 넣고 스크린샷으로 확인하는 왕복이 너무 잦아져서, 사용자가 직접
 * 드래그·리사이즈로 배치하고 그 결과 숫자를 뽑아갈 수 있게 만든 도구다. 여기서 나온 값을
 * bombThrow.js/index.html 의 CSS 에 그대로 옮기면 된다.
 *
 * 배경(장면 그림)은 CSS background-position/size 대신 실제 <img> 로 다뤄서 "드래그로 이동,
 * 휠로 확대/축소"가 직관적으로 되게 한다 — 결과값(width/left/top, 실제 px)을 그대로
 * #minigame-card 에 적용할 <img class="bt-bg"> 로 옮기면 된다(프로덕션 쪽도 이 방식으로 바꿀 것).
 *
 * 제목판/타이머/경고판은 게이지·트랙 같은 장면 UI 와 달리 "항상 맨 앞" 이어야 하고(실제
 * 프로덕션에서도 그림 위에 얹는 오버레이), 종횡비 고정 없이 자유 리사이즈 + 텍스트 내용까지
 * 그 자리에서 바로 고칠 수 있어야 한다 — 그래서 게이지/트랙류(.ble-box)와는 다른
 * 종류(.ble-textbox)로 따로 만든다.
 */

import gaugeEmptyUrl from '../assets/minigame/bomb-chargebar-empty.png';
import gaugeFilledUrl from '../assets/minigame/bomb-chargebar-filled.png';
import dialNormalUrl from '../assets/minigame/bomb-dial-normal.png';
import spaceNormalUrl from '../assets/minigame/bomb-space-normal.png';
import aimBarUrl from '../assets/minigame/bomb-aimbar.png';
import handleUrl from '../assets/minigame/bomb-handle.png';
import bgChargeUrl from '../assets/minigame/bomb-bg-charge.jpg';
import bgAimUrl from '../assets/minigame/bomb-bg-aim.jpg';
import warnPlateUrl from '../assets/minigame/bomb-warn-plate.png';
import bannerUrl from '../assets/minigame/bomb-title-banner.png';
import timerPanelUrl from '../assets/minigame/bomb-timer-panel.png';

const SCALE = 1.5; // 화면에서 보이는 배율 — 값은 전부 실제(1x) px 로 환산해 내보낸다.
const CARD_W = 640;
const CARD_H = 440;
const STORE_KEY = 'bombLayoutEditor.v6';

/** 박스 종류별 고정 종횡비 — 리사이즈는 폭만 조절하고 높이는 여기서 유도한다(프로덕션과 동일). */
const ASPECT = {
  gauge: 268 / 1110,
  dial: 460 / 456,
  track: 2430 / 350,
  plate: 820 / 460,
};

/** 텍스트 박스(제목·부제·타이머·경고)는 종횡비 고정이 없고, 배경 이미지 + 편집 가능한 글자로 구성된다. */
const TEXTBOX_DEFS = {
  title: {
    img: bannerUrl, cls: 'bt-title',
    left: 16, top: 10, width: 400, height: 50, text: '자기력 수류탄 투척',
    textLeft: 16, textTop: 12, fontSize: 22,
  },
  timer: {
    img: timerPanelUrl, cls: 'bt-timer',
    left: CARD_W - 212, top: 8, width: 200, height: 90, text: '20:00',
    textLeft: 68, textTop: 30, fontSize: 21,
  },
  hint: {
    img: warnPlateUrl, cls: 'bt-hint',
    left: 0, top: CARD_H - 70, width: CARD_W, height: 70,
    text: '버튼을 빠르게 연타해서 충전 게이지를 올리세요!',
    textLeft: 190, textTop: 24, fontSize: 14,
  },
};

const DEFAULTS = {
  charge: {
    bg: { width: CARD_H * (750 / 333), left: null, top: 0 }, // left 는 초기화 시 중앙 정렬로 계산
    gauge: { left: CARD_W - 26 - 60, top: 107, width: 53 },
    dial: { left: CARD_W / 2 - 55, top: 213, width: 110 },
  },
  aim: {
    bg: { width: CARD_H * (750 / 313), left: null, top: 0 },
    track: { left: 38, top: 112, width: CARD_W - 76 },
    plate: { left: CARD_W / 2 - 75, top: 189, width: 150 },
  },
  shared: Object.fromEntries(
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

export function initBombLayoutEditor() {
  const state = loadState() ?? cloneDefaults();
  // 배경 left 기본값(중앙 정렬)은 카드 크기 기준으로 매번 계산 — 저장된 값이 없을 때만.
  for (const p of ['charge', 'aim']) {
    if (state[p].bg.left == null) {
      state[p].bg.left = (CARD_W - state[p].bg.width) / 2;
    }
  }
  let phase = 'charge';

  const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));

  // ---- 뼈대 ----
  const root = document.createElement('div');
  root.id = 'bomb-layout-editor';
  root.innerHTML = `
    <style>
      #bomb-layout-editor {
        position: fixed; inset: 0; z-index: 10000;
        background: #1a1712; color: #e8dcc0; font-family: system-ui, sans-serif; font-size: 13px;
        display: flex; align-items: stretch;
      }
      #ble-stage-wrap {
        flex: 1; display: flex; align-items: center; justify-content: center;
        overflow: auto; background:
          repeating-conic-gradient(#26221a 0% 25%, #201c15 0% 50%) 0 0 / 20px 20px;
      }
      #ble-stage {
        position: relative; width: ${CARD_W * SCALE}px; height: ${CARD_H * SCALE}px;
        background: #0f0d0a; border: 2px solid #7a5f1a; border-radius: 10px; overflow: hidden;
        box-shadow: 0 24px 60px rgba(0,0,0,0.7); flex-shrink: 0;
      }
      #ble-bg { position: absolute; left: 0; top: 0; cursor: grab; user-select: none; -webkit-user-drag: none; z-index: 0; }
      #ble-bg.dragging { cursor: grabbing; }
      .ble-box {
        position: absolute; box-sizing: border-box; z-index: 2;
        border: 2px dashed rgba(232, 193, 90, 0.85);
        background: rgba(232, 193, 90, 0.08);
        cursor: move;
      }
      .ble-box img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
      .ble-box .ble-label, .ble-textbox .ble-label {
        position: absolute; top: -20px; left: 0; font-size: 11px; color: #e8c15a;
        background: rgba(10,9,7,0.8); padding: 1px 5px; border-radius: 2px; white-space: nowrap;
      }
      .ble-handle {
        position: absolute; right: -6px; bottom: -6px; width: 14px; height: 14px;
        background: #e8c15a; border: 1px solid #1a1712; border-radius: 50%; cursor: nwse-resize; z-index: 6;
      }
      /* 제목판/타이머/경고판 — 항상 맨 앞(z-index 5), 자유 리사이즈, 텍스트 직접 편집. */
      .ble-textbox {
        position: absolute; box-sizing: border-box; z-index: 5;
        border: 2px dashed rgba(120, 200, 255, 0.85);
        cursor: move;
      }
      .ble-textbox img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
      /* 텍스트는 상자 안에서 독립적으로 위치가 잡힌다(더 이상 가운데 고정이 아니다) —
         노란 손잡이(.ble-text-handle)를 드래그해서 텍스트만 따로 옮긴다. */
      .ble-textbox .ble-text {
        position: absolute; max-width: calc(100% - 16px); white-space: pre-wrap;
        color: #e8c15a; font-weight: 700; font-family: Georgia, serif;
        outline: none; cursor: text; text-shadow: 0 1px 3px rgba(0,0,0,0.9);
      }
      /* fontSize 는 상태값이라 JS(renderTextBox)가 인라인 스타일로 직접 지정한다 — 위 규칙엔 안 둔다. */
      .ble-textbox.bt-timer .ble-text { color: #e35d43; }
      .ble-textbox.bt-hint .ble-text { color: #e8dcc0; font-weight: 400; }
      .ble-text-handle {
        position: absolute; width: 16px; height: 16px; margin-left: -20px; margin-top: -2px;
        background: rgba(120, 200, 255, 0.9); border: 1px solid #1a1712; border-radius: 3px;
        cursor: move; z-index: 7; font-size: 10px; display: flex; align-items: center;
        justify-content: center; color: #1a1712;
      }
      .ble-overlay-ref { position: absolute; pointer-events: none; }
      #ble-panel {
        width: 320px; padding: 14px; overflow-y: auto; border-left: 1px solid #4a4234;
        display: flex; flex-direction: column; gap: 14px;
      }
      #ble-panel h3 { margin: 0 0 6px; color: #c9a227; font-size: 14px; }
      #ble-panel p.ble-hint-text { margin: 0; opacity: 0.65; font-size: 11.5px; line-height: 1.5; }
      #ble-phase-btns button, #ble-actions button {
        background: #2a2416; border: 1px solid #7a5f1a; color: #e8dcc0; padding: 6px 10px;
        border-radius: 4px; cursor: pointer; font-size: 12px;
      }
      #ble-phase-btns button.active { background: #7a5f1a; color: #1a1712; font-weight: 700; }
      #ble-out {
        width: 100%; height: 220px; background: #0f0d0a; color: #9fdc9f; font-family: monospace;
        font-size: 11px; border: 1px solid #4a4234; border-radius: 4px; padding: 8px; resize: vertical;
      }
      #ble-close { position: absolute; top: 8px; right: 8px; }
    </style>
    <div id="ble-stage-wrap">
      <div id="ble-stage">
        <img id="ble-bg" alt="" />
      </div>
    </div>
    <div id="ble-panel">
      <button id="ble-close">✕ 닫기</button>
      <div>
        <h3>단계</h3>
        <div id="ble-phase-btns">
          <button data-phase="charge">충전</button>
          <button data-phase="aim">투척</button>
        </div>
      </div>
      <div>
        <h3>배경 (드래그로 이동, 휠로 확대/축소)</h3>
        <div class="ble-row"><label>폭(zoom)</label><input type="range" id="ble-bg-zoom" min="400" max="1600" step="1" style="width:100%"></div>
      </div>
      <p class="ble-hint-text">파란 점선 상자(제목·부제·타이머·경고판)는 항상 맨 앞에 떠 있고, 안의 글자를 클릭해서 바로 고칠 수 있어. 드래그는 글자 바깥 여백을 잡고 옮기면 돼.</p>
      <div id="ble-actions">
        <button id="ble-reset">기본값으로</button>
        <button id="ble-copy">값 복사</button>
      </div>
      <textarea id="ble-out" readonly></textarea>
    </div>
  `;
  document.body.appendChild(root);

  const stage = root.querySelector('#ble-stage');
  const bgImg = root.querySelector('#ble-bg');
  const bgZoom = root.querySelector('#ble-bg-zoom');
  const outEl = root.querySelector('#ble-out');

  // ---- 배경 드래그 + 휠 줌 ----
  let bgDrag = null;
  bgImg.addEventListener('mousedown', (e) => {
    e.preventDefault();
    bgImg.classList.add('dragging');
    bgDrag = { startX: e.clientX, startY: e.clientY, left: state[phase].bg.left, top: state[phase].bg.top };
  });
  window.addEventListener('mousemove', (e) => {
    if (!bgDrag) return;
    const dx = (e.clientX - bgDrag.startX) / SCALE;
    const dy = (e.clientY - bgDrag.startY) / SCALE;
    state[phase].bg.left = bgDrag.left + dx;
    state[phase].bg.top = bgDrag.top + dy;
    renderBg();
  });
  window.addEventListener('mouseup', () => {
    if (bgDrag) { bgDrag = null; bgImg.classList.remove('dragging'); save(); syncOutput(); }
  });
  bgImg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const b = state[phase].bg;
    const oldW = b.width;
    const newW = Math.max(200, Math.min(2400, oldW - e.deltaY));
    const cx = CARD_W / 2, cy = CARD_H / 2;
    const ratio = newW / oldW;
    b.left = cx - (cx - b.left) * ratio;
    b.top = cy - (cy - b.top) * ratio;
    b.width = newW;
    bgZoom.value = String(Math.round(newW));
    renderBg();
    save();
    syncOutput();
  }, { passive: false });
  bgZoom.addEventListener('input', () => {
    const b = state[phase].bg;
    const oldW = b.width;
    const newW = Number(bgZoom.value);
    const cx = CARD_W / 2, cy = CARD_H / 2;
    const ratio = newW / oldW;
    b.left = cx - (cx - b.left) * ratio;
    b.top = cy - (cy - b.top) * ratio;
    b.width = newW;
    renderBg();
    save();
    syncOutput();
  });

  function renderBg() {
    const b = state[phase].bg;
    const nativeRatio = phase === 'charge' ? 750 / 333 : 750 / 313;
    bgImg.src = phase === 'charge' ? bgChargeUrl : bgAimUrl;
    bgImg.style.width = `${b.width * SCALE}px`;
    bgImg.style.height = `${(b.width / nativeRatio) * SCALE}px`;
    bgImg.style.left = `${b.left * SCALE}px`;
    bgImg.style.top = `${b.top * SCALE}px`;
    bgZoom.value = String(Math.round(b.width));
  }

  // ---- 종횡비 고정 박스 (게이지/다이얼/트랙/플레이트) — 단계별로만 보인다 ----
  const boxEls = {};
  function makeBox(key, imgUrl, label) {
    const el = document.createElement('div');
    el.className = 'ble-box';
    const img = document.createElement('img');
    img.src = imgUrl;
    img.alt = '';
    const lab = document.createElement('div');
    lab.className = 'ble-label';
    lab.textContent = label;
    const handle = document.createElement('div');
    handle.className = 'ble-handle';
    el.append(img, lab, handle);
    stage.appendChild(el);
    boxEls[key] = el;

    let mode = null;
    let start = null;
    el.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      mode = 'move';
      const box = state[phase][key];
      start = { x: e.clientX, y: e.clientY, left: box.left, top: box.top };
    });
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      mode = 'resize';
      const box = state[phase][key];
      start = { x: e.clientX, y: e.clientY, width: box.width };
    });
    window.addEventListener('mousemove', (e) => {
      if (!mode) return;
      const box = state[phase][key];
      if (!box) return;
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
    return el;
  }

  function renderBox(key) {
    const el = boxEls[key];
    if (!el) return;
    const box = state[phase][key];
    if (!box) return; // gauge/dial 은 charge 에만, track/plate 는 aim 에만 있다.
    const h = box.width / ASPECT[key];
    el.style.left = `${box.left * SCALE}px`;
    el.style.top = `${box.top * SCALE}px`;
    el.style.width = `${box.width * SCALE}px`;
    el.style.height = `${h * SCALE}px`;
  }

  makeBox('gauge', gaugeFilledUrl, '게이지');
  makeBox('dial', dialNormalUrl, '다이얼');
  makeBox('track', aimBarUrl, '트랙');
  makeBox('plate', spaceNormalUrl, '플레이트');
  void gaugeEmptyUrl; void handleUrl; // (빈 게이지·손잡이는 배치 대상 아님, 참고용 import 만 유지)

  function renderPhaseVisibility() {
    const showCharge = phase === 'charge';
    boxEls.gauge.style.display = showCharge ? '' : 'none';
    boxEls.dial.style.display = showCharge ? '' : 'none';
    boxEls.track.style.display = showCharge ? 'none' : '';
    boxEls.plate.style.display = showCharge ? 'none' : '';
  }

  function renderAllBoxes() {
    renderBox('gauge');
    renderBox('dial');
    renderBox('track');
    renderBox('plate');
  }

  // ---- 자유 리사이즈 텍스트 박스 (제목/부제/타이머/경고) — 항상 맨 앞, 두 단계 내내 그대로 ----
  const textEls = {};
  function makeTextBox(key, def) {
    const el = document.createElement('div');
    el.className = `ble-textbox ${def.cls}`;
    const img = document.createElement('img');
    img.src = def.img;
    img.alt = '';
    const lab = document.createElement('div');
    lab.className = 'ble-label';
    lab.textContent = { title: '제목', timer: '타이머', hint: '경고판' }[key];
    const text = document.createElement('div');
    text.className = 'ble-text';
    text.contentEditable = 'true';
    text.spellcheck = false;
    text.textContent = state.shared[key].text;
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'ble-handle';
    // 텍스트 전용 드래그 손잡이 — 상자(그림 프레임)는 그대로 두고 글자 위치만 옮길 때 쓴다.
    const textHandle = document.createElement('div');
    textHandle.className = 'ble-text-handle';
    textHandle.textContent = '✥';
    textHandle.title = '드래그해서 글자 위치만 옮기기';
    el.append(img, text, textHandle, lab, resizeHandle);
    stage.appendChild(el);
    textEls[key] = { el, text, textHandle };

    text.addEventListener('input', () => {
      state.shared[key].text = text.textContent;
      save();
      syncOutput();
    });
    // 텍스트 영역 안에서 클릭할 땐 드래그가 아니라 커서 배치/편집이 되어야 한다.
    text.addEventListener('mousedown', (e) => e.stopPropagation());
    // 글자 위에서 휠 — 폰트 크기 조절(배경 확대/축소 휠과 겹치지 않도록 여기서 끊는다).
    text.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const box = state.shared[key];
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
      const box = state.shared[key];
      start = { x: e.clientX, y: e.clientY, left: box.left, top: box.top };
    });
    resizeHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      mode = 'resize';
      const box = state.shared[key];
      start = { x: e.clientX, y: e.clientY, width: box.width, height: box.height };
    });
    textHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      mode = 'moveText';
      const box = state.shared[key];
      start = { x: e.clientX, y: e.clientY, textLeft: box.textLeft, textTop: box.textTop };
    });
    window.addEventListener('mousemove', (e) => {
      if (!mode) return;
      const box = state.shared[key];
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
    const box = state.shared[key];
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

  // ---- 단계 전환 ----
  const phaseBtns = Array.from(root.querySelectorAll('#ble-phase-btns button'));
  function setPhase(p) {
    phase = p;
    phaseBtns.forEach((b) => b.classList.toggle('active', b.dataset.phase === p));
    renderBg();
    renderAllBoxes();
    renderPhaseVisibility();
    syncOutput();
  }
  phaseBtns.forEach((b) => b.addEventListener('click', () => setPhase(b.dataset.phase)));

  // ---- 내보내기 ----
  function syncOutput() {
    outEl.value = JSON.stringify(state, null, 2);
  }

  root.querySelector('#ble-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(outEl.value);
      const btn = root.querySelector('#ble-copy');
      const old = btn.textContent;
      btn.textContent = '복사됨!';
      setTimeout(() => { btn.textContent = old; }, 1000);
    } catch {
      outEl.select();
    }
  });
  root.querySelector('#ble-reset').addEventListener('click', () => {
    const fresh = cloneDefaults();
    for (const p of ['charge', 'aim']) fresh[p].bg.left = (CARD_W - fresh[p].bg.width) / 2;
    Object.assign(state, fresh);
    for (const key of Object.keys(TEXTBOX_DEFS)) {
      textEls[key].text.textContent = state.shared[key].text;
    }
    renderAllTextBoxes();
    setPhase(phase);
    save();
  });
  root.querySelector('#ble-close').addEventListener('click', () => root.remove());

  // ---- 초기 렌더 ----
  renderAllTextBoxes();
  setPhase('charge');
}
