import { VOLUME_CHANNELS, getVolume, setVolume, playSfx, setLoop } from '../audio/SoundManager.js';

/**
 * 설정 창 (DOM 오버레이) — index.html 의 #settings 와 짝.
 *
 * 타이틀의 [설정]과 인게임의 [Esc] 가 **같은 창**을 연다. 화면마다 다른 설정 창을
 * 두면 어느 쪽에서 만진 값이 진짜인지 플레이어가 알 수 없고, 실제로 값을 쥐고 있는
 * 것은 SoundManager 하나뿐이다.
 *
 * 다른 오버레이(Hud·ClueBook·DialogueBox)와 같은 싱글턴 규약 — scene.restart 로
 * create() 가 다시 돌아도 같은 DOM 을 가리키는 객체가 늘어나지 않는다.
 *
 * 이 클래스는 그리기와 입력만 맡는다. 값의 저장·적용은 SoundManager 의 몫이다.
 */
let instance = null;

/** 방향키 한 번에 움직이는 폭. 5% 면 0~100 을 스무 번에 건넌다 — 끌기의 보조다. */
const STEP = 0.05;

export class SettingsPanel {
  constructor() {
    if (instance) return instance;
    instance = this;

    this.root = document.getElementById('settings');
    this.rowsEl = document.getElementById('settings-rows');
    /** 닫힐 때 한 번 불린다 — 씬이 여기에 scene.resume 을 건다. */
    this.onClose = null;
    /** 인게임에서 열렸다면 그 씬 — [타이틀 화면으로]가 떠날 곳을 여기서 안다. */
    this.scene = null;
    this.sel = 0;
    this.rows = [];
    this.#buildRows();

    document.getElementById('settings-to-title').addEventListener('click', () => this.#toTitle());

    // 열려 있는 동안 키보드는 전부 이 창의 것이다. capture 단계에서 끊어야 타이틀
    // 메뉴(window 리스너)와 Phaser 보다 **먼저** 잡힌다 — 안 그러면 설정에서 방향키를
    // 누를 때마다 뒤의 타이틀 커서가 같이 움직이고, 인게임에서는 주인공이 걸어간다.
    // (미니게임 패널이 쓰는 것과 같은 수법 — ui/MinigamePanel.js)
    window.addEventListener('keydown', (e) => this.#onKey(e), true);
  }

  /**
   * @param {() => void} [onClose] 닫힌 뒤 할 일 — 씬이 멈춘 판을 다시 돌린다.
   */
  open(onClose = null) {
    this.onClose = onClose;
    // 기본은 "판 밖에서 열린 창" — 떠날 씬도 없고 [타이틀 화면으로]도 접힌다.
    // 인게임에서 여는 openPaused 가 뒤이어 이 둘을 세운다.
    this.scene = null;
    this.root.classList.remove('in-game');
    for (const entry of this.rows) this.#render(entry);
    this.#select(0);
    this.root.classList.add('visible');
  }

  /**
   * 인게임에서 연다 — 판을 **멈추고**, 닫히면 다시 돌린다.
   *
   * 멈추지 않으면 설정을 만지는 사이 순찰이 돌고 발각 게이지가 찬다. 소리를 줄이려고
   * 연 창 때문에 붙잡히는 것은 설정 창이 할 일이 아니다. 타이틀에서는 멈출 판이 없어
   * 그냥 open() 을 쓴다.
   *
   * @param {Phaser.Scene} scene 멈췄다 다시 돌릴 씬
   * @param {() => void} [onResume] 씬이 깨어난 직후 — 씬이 묵은 키 상태를 턴다
   */
  openPaused(scene, onResume = null) {
    // 걸음 소리는 씬의 update 가 매 프레임 유지하는 루프라(setLoop('walk', moving)),
    // 걷는 중에 [Esc] 를 누르면 **씬이 멈춰 그 갱신이 아예 끊긴다** — 발소리만 남아
    // 설정 창 위로 계속 울린다. 멈추는 쪽이 직접 끈다. 씬이 깨어나면 update 가 다시
    // 돌면서 실제로 걷고 있을 때만 소리를 되살린다.
    setLoop('walk', false);
    scene.scene.pause();
    this.open(() => {
      scene.scene.resume();
      onResume?.();
    });
    // open() 이 둘을 지우고 시작하므로 그 뒤에 세운다.
    this.scene = scene;
    this.root.classList.add('in-game');
  }

  /**
   * [타이틀 화면으로] — 판을 버리고 처음 화면으로 돌아간다.
   *
   * 멈춰 둔 씬을 **먼저 깨운다**(close 가 onClose 로 resume 을 부른다). 멈춘 채로
   * scene.start 를 부르면 떠나는 씬의 shutdown 이 정지 상태에서 돌아 뒷정리가
   * 어중간하게 끝난다. 화면에 남은 HUD·대화창·수첩은 도착한 TitleScene 이 지운다 —
   * 무엇이 지워져야 하는지는 떠나는 쪽이 아니라 **도착한 화면**이 안다.
   */
  #toTitle() {
    const scene = this.scene;
    if (!scene) return;
    playSfx('switch');
    this.close();
    scene.scene.start('Title');
  }

  close() {
    if (!this.isOpen) return;
    this.root.classList.remove('visible');
    this.scene = null;
    // 콜백을 먼저 비운다 — 씬이 resume 안에서 또 close 를 부르더라도 두 번 돌지 않는다.
    const done = this.onClose;
    this.onClose = null;
    done?.();
  }

  get isOpen() {
    return this.root.classList.contains('visible');
  }

  #buildRows() {
    this.rowsEl.replaceChildren();
    this.rows = VOLUME_CHANNELS.map((channel, i) => {
      const row = document.createElement('div');
      row.className = 'set-row';
      // 띠와 손잡이는 홈의 **자식**이다 — 홈의 액자가 border 라, 자식의 기준 상자가
      // 청동 캡 안쪽(채널)으로 저절로 옮겨진다. 퍼센트를 그 상자에 맡기면 손잡이가
      // 캡 위로 올라갈 일이 없다 (index.html 의 .set-track 주석 참고).
      row.innerHTML =
        '<div class="set-label"><span></span><span class="set-val"></span></div>' +
        '<div class="set-slider"><div class="set-track">' +
        '<div class="set-fill"></div><div class="set-knob"></div>' +
        '</div></div>';
      row.querySelector('.set-label span').textContent = channel.label;

      const entry = {
        channel: channel.key,
        rowEl: row,
        slider: row.querySelector('.set-slider'),
        trackEl: row.querySelector('.set-track'),
        valEl: row.querySelector('.set-val'),
        fillEl: row.querySelector('.set-fill'),
        knobEl: row.querySelector('.set-knob'),
      };
      this.#bindDrag(entry, i);
      this.rowsEl.append(row);
      return entry;
    });
  }

  /**
   * 마우스로 끌기.
   *
   * 홈 아무 데나 누르면 그 자리로 곧장 뛰고(눌린 지점이 곧 값이다), 누른 채 움직이면
   * 따라온다. 포인터 캡처를 걸어 두므로 끌다가 창 **밖으로** 나가도 계속 따라오고,
   * 밖에서 손을 떼도 끌던 상태가 남지 않는다 — 캡처가 없으면 슬라이더를 벗어나는
   * 순간 값이 그 자리에 얼어붙는다.
   */
  #bindDrag(entry, i) {
    let dragging = false;

    // 재는 상자는 홈의 **채널**이다 (getBoundingClientRect 는 액자까지 포함한 테두리
    // 상자라 그대로 쓰면 청동 캡 두께만큼 어긋난다). clientLeft = 왼쪽 테두리 두께,
    // clientWidth = 그 안쪽 폭 — 띠·손잡이가 % 로 앉는 바로 그 상자다.
    const applyAt = (e) => {
      const rect = entry.trackEl.getBoundingClientRect();
      const width = entry.trackEl.clientWidth;
      if (!width) return;
      this.#set(entry, (e.clientX - rect.left - entry.trackEl.clientLeft) / width);
    };

    entry.slider.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.#select(i);
      entry.slider.classList.add('dragging');
      entry.slider.setPointerCapture(e.pointerId);
      applyAt(e);
      e.preventDefault(); // 드래그가 글자 선택으로 새지 않게
    });
    entry.slider.addEventListener('pointermove', (e) => {
      if (dragging) applyAt(e);
    });

    const end = () => {
      if (!dragging) return;
      dragging = false;
      entry.slider.classList.remove('dragging');
      this.#preview(entry);
    };
    entry.slider.addEventListener('pointerup', end);
    entry.slider.addEventListener('pointercancel', end);
  }

  /** 값을 바꾸고 그 줄을 다시 그린다 — 저장·적용은 setVolume 이 한다. */
  #set(entry, value) {
    setVolume(entry.channel, value);
    this.#render(entry);
  }

  #render(entry) {
    const pct = getVolume(entry.channel) * 100;
    entry.valEl.textContent = `${Math.round(pct)}%`;
    entry.fillEl.style.width = `${pct}%`;
    entry.knobEl.style.left = `${pct}%`;
  }

  /**
   * 방금 정한 크기를 귀로 확인시켜 준다.
   *
   * 배경음만 빼는 이유: 그 줄은 지금 흐르고 있는 곡 자체가 이미 답이라 효과음을
   * 얹으면 정작 확인하려는 소리를 가린다.
   */
  #preview(entry) {
    if (entry.channel !== 'bgm') playSfx('switch');
  }

  #select(i) {
    const n = this.rows.length;
    this.sel = ((i % n) + n) % n;
    this.rows.forEach((entry, j) => entry.rowEl.classList.toggle('sel', j === this.sel));
  }

  #nudge(delta) {
    const entry = this.rows[this.sel];
    this.#set(entry, getVolume(entry.channel) + delta);
    this.#preview(entry);
  }

  #onKey(e) {
    if (!this.isOpen) return;
    // 아는 키든 모르는 키든 이 창이 떠 있는 동안에는 뒤로 흘려보내지 않는다.
    e.stopPropagation();

    const k = e.key;
    if (k === 'Escape') this.close();
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') this.#select(this.sel - 1);
    else if (k === 'ArrowDown' || k === 's' || k === 'S') this.#select(this.sel + 1);
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') this.#nudge(-STEP);
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') this.#nudge(STEP);
    else return;
    e.preventDefault();
  }
}
