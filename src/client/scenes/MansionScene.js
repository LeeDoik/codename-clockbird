import Phaser from 'phaser';
import { DialogueBox } from '../ui/DialogueBox.js';
import { DocumentPanel } from '../ui/DocumentPanel.js';
import { ResultOverlay } from '../ui/ResultOverlay.js';
import { buildColliders, createPlayer, applyMovement, setupCameras } from '../world/worldParts.js';
import { InteractionManager } from '../world/interact.js';
import { readSSE } from '../net.js';
import { CSS, FONTS } from '../ui/theme.js';
import mansionData from '../assets/mansion.json';
import mansionProps from '../assets/mansion-props.json';

/**
 * 스테이지 2 — 저택 잠입.
 *
 * 경비도 발각 게이지도 없다 (계획서 §4.4). 위험은 오직 **말**에서 온다 —
 * 반브루주아 발언은 동료의 호감을 사지만 민간인에겐 의심을 산다. 누가 동료인지는
 * 이름에도 옷에도 안 적혀 있고, 첫 문장의 뉘앙스로만 짐작할 수 있다.
 *
 * 그래서 이 씬은 동료 명단을 모른다. 서버만 안다.
 */
const TILE = mansionData.tileSize;
const PLAYER_FRAME = 0;

/**
 * chars.png 프레임 배정. 전용 스프라이트는 아직 없다.
 *
 * **동료와 민간인이 같은 프레임을 나눠 쓴다** — 동료에게만 특정 모습을 주면 옷차림만
 * 보고 정답을 알 수 있어 이 스테이지의 퍼즐이 통째로 무너진다.
 */
const NPC_FRAME = {
  fixer: 1,
  cook: 2,
  washer: 6,
  shelver: 4,
  diner: 2,
  cleaner: 6,
  clerk: 3,
  gardener: 3,
  butler: 4,
  valet: 5,
  porter: 3,
};

const LABEL_STYLE = { fontFamily: FONTS.body, fontSize: '11px', color: CSS.paperDim };

/** 지금 있는 방이 아닌 곳을 덮는 어둠. 안에 누가 있는지 문 밖에서는 안 보인다. */
const SHROUD_DIM = 0.68;
/**
 * 잠긴 방은 영영 안 걷힌다. 다만 완전히 덮으면 그냥 검은 사각형이라
 * "무언가 있는데 안 보인다"가 아니라 "아무것도 없다"로 읽힌다 —
 * 안의 태엽 장치와 침대가 실루엣으로만 잡히는 정도로 남긴다 (스테이지 3 복선).
 */
const SHROUD_LOCKED = 0.85;
const SHROUD_COLOR = 0x05040a;
/**
 * 늘 밝은 방. 홀은 요른이 시계를 고치며 시간을 끄는 거점이고 모든 길이 여기서 갈라진다 —
 * 여기까지 어두워지면 돌아올 자리가 없어 방향 감각이 통째로 사라진다.
 */
const ALWAYS_LIT = new Set(['hall']);

/** 연구실 문서 받침대 — 스테이지 목표. 가구를 그린 자리와 같다. */
const DOCUMENT = { name: '신형 로봇 기록', col: 48, row: 32 };
/**
 * 홀과 벽 없이 맞닿는 방과, 그 경계에서 어둠이 풀어질 거리(칸).
 *
 * 다른 방들은 사이에 벽이 있어 덮개의 각진 끝이 벽에 가려진다. 복도만 홀의 윗변과
 * 직접 붙어 있어, 평평한 사각형으로 덮으면 마루 한가운데 검은 선이 그어진다.
 */
const FADE_INTO_HALL = { corr: 6 };

export class MansionScene extends Phaser.Scene {
  constructor() {
    super('Mansion');
  }

  init() {
    this.state = null;
    this.nodes = [];
    this.ended = false;
    this.startFailed = false;
    this.currentRoom = null;
    this.labUnlocked = false;
    /** 방 id → 그 방을 덮은 어둠 사각형 */
    this.shroud = new Map();
    /** 지금 자유 대화 중인 인물 */
    this.currentNpcId = null;
    /** 문서 열람 요청이 날아가는 중 — 연타로 두 번 보내지 않게 */
    this.reading = false;
    /** 밀고가 확정됐지만 플레이어가 아직 마지막 대사를 읽는 중 — 창이 닫히면 끝낸다 */
    this.reportedPending = false;
    /** 조사 요청이 날아가는 중 — 연타로 두 번 보내지 않게 */
    this.inspecting = false;
  }

  create() {
    this.dialogue = new DialogueBox();
    this.dialogue.onSend = (message) => this.#chat(message);
    this.docPanel = new DocumentPanel();
    this.result = new ResultOverlay();
    this.result.hide(); // 재시작으로 다시 들어온 경우 이전 판의 결과 화면을 걷어낸다

    // 그림은 구운 배경 한 장, 충돌은 따로. 배경은 무엇보다 뒤에 깔린다.
    this.add.image(0, 0, 'mansion-bg').setOrigin(0, 0).setDepth(-100);
    this.walls = buildColliders(this, mansionData, mansionProps.blocked);
    this.player = createPlayer(this, mansionData, this.walls, PLAYER_FRAME);
    // 여기까지가 월드. NPC 는 /start 응답 후에 생기므로 asWorld() 로 따로 등록한다.
    setupCameras(this, mansionData, this.player);
    this.interact = new InteractionManager(this, this.dialogue);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.keyE = this.input.keyboard.addKey('E');
    this.keySpace = this.input.keyboard.addKey('SPACE');
    this.keyEsc = this.input.keyboard.addKey('ESC');

    // 플레이어는 어둠보다 위에 둔다 — 어둠이 걷히는 짧은 사이에도 자기 몸은 보여야 한다.
    this.player.setDepth(30);

    this.#buildSteam();
    this.#buildShroud();
    this.#buildHud();

    // 거리에서 암전으로 넘어온다 — 받는 쪽도 밝아지며 열려야 한 장면으로 이어진다.
    this.cameras.main.fadeIn(700, 0, 0, 0);
    this.uiCam?.fadeIn(700, 0, 0, 0);

    this.#start();
  }

  /**
   * 방마다 덮개를 씌운다. 들어가 본 방만 걷힌다.
   *
   * 저택 전체가 한눈에 보이면 잠입이 아니라 도면 읽기가 된다. 문 너머가 안 보여야
   * 방을 하나씩 열어 보는 긴장이 생기고, **누가 어느 방에 있는지도 들어가야 안다** —
   * 동료를 찾아내는 것이 이 스테이지의 과제라 이건 연출이 아니라 규칙에 가깝다.
   */
  #buildShroud() {
    this.#makeFadeTexture();

    for (const r of mansionData.rooms) {
      if (ALWAYS_LIT.has(r.id)) continue; // 덮개를 아예 안 만든다
      const x0 = r.x * TILE;
      const y0 = r.y * TILE;
      const w = r.w * TILE;
      const h = r.h * TILE;
      const fade = (FADE_INTO_HALL[r.id] ?? 0) * TILE;

      // 조각을 컨테이너로 묶는다 — 컨테이너 alpha 가 자식에게 곱해지므로
      // 밝기 조절은 여전히 값 하나를 트윈하면 된다.
      const parts = this.add.container(0, 0);
      // Rectangle 은 x·y 가 중심이다.
      parts.add(
        this.add.rectangle(x0 + w / 2, y0 + (h - fade) / 2, w, h - fade, SHROUD_COLOR),
      );
      if (fade > 0) {
        parts.add(
          this.add.image(x0, y0 + h - fade, 'shroud-fade').setOrigin(0, 0).setDisplaySize(w, fade),
        );
      }
      // NPC(0)·김(6)보다 위, 플레이어(30)보다 아래.
      parts.setAlpha(r.id === 'locked' ? SHROUD_LOCKED : SHROUD_DIM).setDepth(20);
      this.asWorld(parts);
      this.shroud.set(r.id, parts);
    }
  }

  /** 위는 짙고 아래로 갈수록 풀어지는 띠. 세로로 늘여 경계에 깐다. */
  #makeFadeTexture() {
    if (this.textures.exists('shroud-fade')) return;
    const H = 96;
    const g = this.make.graphics({ add: false });
    for (let i = 0; i < H; i++) {
      // 제곱으로 떨어뜨린다 — 선형이면 시작하는 지점에 선이 보인다.
      g.fillStyle(SHROUD_COLOR, (1 - i / (H - 1)) ** 1.7);
      g.fillRect(0, i, 4, 1);
    }
    g.generateTexture('shroud-fade', 4, H);
    g.destroy();
  }

  /**
   * 방 하나만 밝다. 들어가면 걷히고, 나가면 도로 덮인다.
   *
   * 걷힌 채로 남겨 두면 저택을 한 바퀴 돈 뒤부터는 전체가 훤해져서, 방을 하나씩
   * 여는 긴장도 "지금 내가 있는 곳만 보인다"는 감각도 사라진다.
   * 덮이는 쪽을 조금 느리게 두어 등을 돌리고 나오는 느낌을 남긴다.
   */
  #setRoomLight(room, lit) {
    const s = this.shroud.get(room.id);
    if (!s || room.id === 'locked') return; // 잠긴 방은 영영 안 걷힌다
    const target = lit ? 0 : SHROUD_DIM;
    if (s.alpha === target) return;
    // 들고 나기를 빨리 반복하면 트윈이 겹쳐 어중간한 밝기에서 멈춘다.
    this.tweens.killTweensOf(s);
    this.tweens.add({
      targets: s,
      alpha: target,
      duration: lit ? 420 : 560,
      ease: lit ? 'Quad.easeOut' : 'Quad.easeIn',
    });
  }

  /**
   * 김 — 주방 화덕·조리대와 세탁실 빨래통에서 오른다.
   *
   * 배경에 구워 넣지 않고 파티클로 두는 이유: 김은 움직여야 김이다. 정지된 흰 얼룩은
   * 얼룩일 뿐이고, 이 방들이 "지금 누가 일하고 있는 방"으로 읽히려면 흔들려야 한다.
   */
  #buildSteam() {
    if (!this.textures.exists('steam')) {
      // 뭉툭한 도트 원 — 부드러운 그라디언트는 이 화면의 픽셀 규약과 안 맞는다.
      const g = this.make.graphics({ add: false });
      g.fillStyle(0xffffff, 1);
      g.fillRect(2, 0, 4, 8);
      g.fillRect(0, 2, 8, 4);
      g.fillRect(1, 1, 6, 6);
      g.generateTexture('steam', 8, 8);
      g.destroy();
    }

    // 좌표는 가구를 그린 자리 그대로 (scripts/gen-mansion-art.js).
    const vents = [
      { x: 1200, y: 402, tint: 0xffdcb0, freq: 210, rise: 34 }, // 화덕 불구멍
      { x: 1404, y: 392, tint: 0xffe8cc, freq: 380, rise: 26 }, // 조리대 냄비
      { x: 464, y: 176, tint: 0xdde8ef, freq: 300, rise: 24 }, // 빨래통
      { x: 528, y: 176, tint: 0xdde8ef, freq: 420, rise: 22 },
    ];

    for (const v of vents) {
      const em = this.add.particles(v.x, v.y, 'steam', {
        speedY: { min: -v.rise, max: -v.rise * 0.5 },
        speedX: { min: -11, max: 11 },
        scale: { start: 0.55, end: 2.7 },
        alpha: { start: 0.42, end: 0 },
        lifespan: { min: 1500, max: 2700 },
        frequency: v.freq,
        quantity: 1,
        tint: v.tint,
      });
      // 가구보다 앞, UI 보다 뒤.
      em.setDepth(6);
      this.asWorld(em);
    }
  }

  // ── UI ──────────────────────────────────────────────────────────
  #buildHud() {
    this.hud = this.add.text(20, 16, '', {
      fontFamily: FONTS.body,
      fontSize: '22px',
      color: CSS.paperDim,
    });

    // 방 이름 — 60×34 저택에서 길을 잃지 않게 하는 최소 장치. 들어간 순간 잠깐 뜬다.
    this.roomLabel = this.add
      .text(this.scale.width / 2, 92, '', {
        fontFamily: FONTS.head,
        fontSize: '40px',
        color: CSS.brass,
      })
      .setOrigin(0.5)
      .setAlpha(0);

    this.asUi(
      this.hud,
      this.roomLabel,
      this.add.text(20, this.scale.height - 40, '[E] 대화    [Esc] 닫기', {
        fontFamily: FONTS.body,
        fontSize: '20px',
        color: CSS.faint,
      }),
    );

    this.#updateHud();
  }

  #updateHud() {
    const pieces = this.state?.pieces.length ?? 0;
    const key = this.state?.hasKey ? '  ·  연구실 열쇠 ✔' : '';
    this.hud.setText(`저택 잠입 — 정보 ${pieces}/3${key}`);
  }

  /** 방이 바뀐 순간에만 이름을 띄운다 — 매 프레임 갱신하면 깜빡인다. */
  #showRoom(room) {
    this.roomLabel.setText(room.name).setAlpha(1);
    this.tweens.killTweensOf(this.roomLabel);
    this.tweens.add({ targets: this.roomLabel, alpha: 0, delay: 900, duration: 700 });
  }

  #roomAt(x, y) {
    const col = Math.floor(x / TILE);
    const row = Math.floor(y / TILE);
    return (
      mansionData.rooms.find(
        (r) => col >= r.x && col < r.x + r.w && row >= r.y && row < r.y + r.h,
      ) ?? null
    );
  }

  // ── 세션 ────────────────────────────────────────────────────────
  async #start() {
    // 개발용 ?stage2&key — 열쇠는 서버가 쥐고 있으므로 여기서 세우면 안 되고
    // 시작 요청에 실어 보내야 한다 (클라이언트에서만 세우면 문서 열람이 409 로 막힌다).
    const devKey =
      import.meta.env.DEV && new URLSearchParams(window.location.search).has('key');

    try {
      const res = await fetch('/api/mansion/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(devKey ? { debug: 'key' } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      this.state = data;
      this.startFailed = false;
    } catch (err) {
      this.startFailed = true;
      this.dialogue.show('오류', `저택에 들어갈 수 없습니다.\n${err.message}\n\n[Space] 로 다시 시도한다.`);
      return;
    }

    this.dialogue.preload([this.state.escort.id, ...this.state.npcs.map((n) => n.id)]);
    this.#spawnNpcs();
    this.#registerLabDoor();
    this.#registerObjects();
    this.#updateHud();
    this.#showEscortBriefing();
  }

  #spawnNpcs() {
    const place = (npc) => {
      const x = npc.col * TILE + TILE / 2;
      const y = npc.row * TILE + TILE / 2;
      const sprite = this.add.sprite(x, y, 'chars', NPC_FRAME[npc.id] ?? 6);
      const label = this.add.text(x, y - 26, npc.name, LABEL_STYLE).setOrigin(0.5);
      this.asWorld(sprite, label);
      this.nodes.push({ npc, sprite, label });

      if (npc.id === this.state.escort.id) {
        this.interact.register({
          id: npc.id,
          type: 'npc',
          sprite,
          speaker: `${npc.name} (${npc.role})`,
          line: npc.line,
          portrait: npc.id,
        });
        return;
      }
      this.interact.register({
        id: npc.id,
        type: 'choiceNpc',
        sprite,
        speaker: npc.name,
        line: `"${npc.line}"`,
        portrait: npc.id,
        choices: [
          { label: '대화하기', key: 'E' },
          { label: '그만하기', key: 'Esc' },
        ],
        onChoice: (key) => {
          if (key === 'E') this.#talk(npc);
          else this.dialogue.hide();
        },
      });
    };

    place(this.state.escort);
    for (const npc of this.state.npcs) place(npc);
  }

  /** 조사 오브젝트 — [E] 조사 → 단서 열람 (종이 패널). 위치는 서버 뷰가 준다. */
  #registerObjects() {
    for (const obj of this.state.objects ?? []) {
      this.interact.register({
        id: obj.id,
        type: 'object',
        x: obj.col * TILE + TILE / 2,
        y: obj.row * TILE + TILE / 2,
        bubble: '[E] 조사',
        onInteract: () => this.#inspect(obj),
      });
    }
  }

  async #inspect(obj) {
    if (this.inspecting) return;
    this.inspecting = true;
    try {
      const res = await fetch('/api/mansion/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.state.sessionId, objectId: obj.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      this.#syncState(data.state);
      this.docPanel.open({ title: obj.name, body: data.text });
    } catch (err) {
      this.dialogue.show('오류', err.message);
    } finally {
      this.inspecting = false;
    }
  }

  /** 실험실 문 — 열쇠가 있어야 [E] 로 연다 (스펙 §2 door). 자동 개방은 제거됐다. */
  #registerLabDoor() {
    const door = mansionData.doors.find((d) => d.key === 'lab');
    if (!door) return;
    this.interact.register({
      id: 'lab-door',
      type: 'door',
      x: (door.x + door.w / 2) * TILE,
      y: (door.y + door.h / 2) * TILE,
      range: 56,
      bubble: '[E] 열기',
      isUnlocked: () => Boolean(this.state?.hasKey),
      lockedText: '잠겨 있다. 열쇠가 필요할 것 같다.',
      openText: '문이 열렸다.',
      onOpen: () => {
        this.#syncLabDoor();
        this.interact.remove('lab-door');
      },
    });
  }

  /**
   * 문이 실제로 열릴 때(#registerLabDoor 의 onOpen)만 불린다 — 벽 바디를 걷어내고
   * 열린 문 그림을 덮어 그린 뒤, 문서 노드를 등록한다(문이 열려야 문서에 닿을 수 있다).
   */
  #syncLabDoor() {
    if (this.labUnlocked || !this.state?.hasKey) return;
    const door = mansionData.doors.find((d) => d.key === 'lab');
    if (!door) return;

    for (let r = door.y; r < door.y + door.h; r++) {
      for (let c = door.x; c < door.x + door.w; c++) {
        const cx = c * TILE + TILE / 2;
        const cy = r * TILE + TILE / 2;
        const body = this.walls.getChildren().find((w) => w.x === cx && w.y === cy);
        if (body) body.destroy();
      }
    }
    // 배경(-100)보다 앞, 플레이어보다 뒤.
    this.asWorld(
      this.add.image(door.x * TILE, door.y * TILE, 'mansion-door-open').setOrigin(0, 0).setDepth(-90),
    );
    this.labUnlocked = true;

    this.interact.register({
      id: 'document',
      type: 'document',
      x: DOCUMENT.col * TILE + TILE,
      y: DOCUMENT.row * TILE + TILE / 2,
      bubble: '[E] 열람',
      onInteract: () => this.#readDocument(),
    });
  }

  #showEscortBriefing() {
    const e = this.state.escort;
    this.dialogue.show(`${e.name} (${e.role})`, e.line, { portrait: e.id });
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  // ── 루프 ────────────────────────────────────────────────────────
  update() {
    if (this.ended) return;

    // 키 상태는 어떤 조기 return 보다 먼저 매 프레임 소비한다 — 단락 평가로 건너뛰면
    // 눌린 채 남은 플래그가 패널이 닫히거나 응답이 도착한 프레임에 뒤늦게 발동한다.
    const pressedTalk = Phaser.Input.Keyboard.JustDown(this.keyE);
    const pressedSpace = Phaser.Input.Keyboard.JustDown(this.keySpace);
    const pressedEsc = Phaser.Input.Keyboard.JustDown(this.keyEsc);

    // 밀고 확정 후 창이 닫힌 순간 판을 끝낸다 (#chat 의 reportedPending 참고).
    if (this.reportedPending && !this.dialogue.isOpen) {
      this.#endGame('reported');
      return;
    }

    // 문서 열람 중 세계는 정지한다 — 월드 카메라 키입력도 먹히지 않는다.
    if (this.docPanel?.isOpen) {
      this.player.body.setVelocity(0, 0);
      return;
    }

    const typing = this.dialogue.isTyping;
    if (typing) this.player.body.setVelocity(0, 0);
    else applyMovement(this.player, { cursors: this.cursors, wasd: this.wasd });

    // 문간(방 사각형 밖)에서는 null 이 나온다 — 그때는 방을 바꾸지 않는다.
    // 안 그러면 문턱을 밟을 때마다 앞뒤 방이 번갈아 깜빡인다.
    const room = this.#roomAt(this.player.x, this.player.y);
    if (room && room !== this.currentRoom) {
      if (this.currentRoom) this.#setRoomLight(this.currentRoom, false);
      this.currentRoom = room;
      this.#setRoomLight(room, true);
      this.#showRoom(room);
    }

    if (!this.state) {
      // /start 가 실패했다면 [Space] 는 창을 닫는 대신 재시도다.
      if (this.startFailed && pressedSpace) {
        this.startFailed = false;
        this.#start();
      }
      return;
    }

    // 말풍선·최근접 노드 갱신 — 대화 중이거나 대기 중이면 레이어가 알아서 감춘다.
    this.interact.update(this.player, { suppress: typing || this.dialogue.busy });

    if (!typing && !this.dialogue.busy && pressedTalk) {
      if (this.dialogue.isOpen && !this.dialogue.hasMore && this.dialogue.onChoice) {
        this.dialogue.onChoice('E');
      } else if (this.dialogue.isOpen && !this.dialogue.isTyping) {
        this.dialogue.advance();
      } else {
        this.interact.trigger();
      }
    }
    if (!typing && pressedSpace && this.dialogue.isOpen) {
      this.dialogue.advance();
    }
    if (pressedEsc && this.dialogue.isOpen) {
      this.dialogue.hide();
    }
  }

  /** 선택지 "대화하기" — 자유 입력을 연다. */
  #talk(npc) {
    if (npc.halted) {
      this.dialogue.show(
        npc.name,
        '…그는 눈을 마주치지 않는다.\n\n다른 사람과 이야기하고 다시 와야 한다.',
        { portrait: npc.id },
      );
      this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
      return;
    }
    this.currentNpcId = npc.id;
    this.dialogue.hideChoices();
    this.dialogue.showInput('말을 건넨다...', 'chat');
    this.dialogue.setHint('[Enter] 대화 · [Esc] 닫기');
  }

  /**
   * 자유 대화 — 서버가 SSE 로 흘려보내는 응답을 델타 단위로 붙인다.
   *
   * 호감도·의심도는 화면에 안 나온다. 상대가 마음을 열었는지 굳었는지는 말투로만
   * 읽어야 한다 (계획서 §4.4) — 그래서 여기서 받는 것도 수치가 아니라 "벌어진 사건"뿐이다.
   */
  async #chat(message) {
    const npc = this.state.npcs.find((n) => n.id === this.currentNpcId);
    if (!npc) return;

    this.dialogue.setBusy(true);
    this.dialogue.beginStream(npc.name, { portrait: npc.id });

    // 이벤트는 스트림 끝에 한 번 오지만, 본문이 다 찍힌 뒤에 이어 붙여야 순서가 맞는다.
    let pending = null;
    try {
      const res = await fetch('/api/mansion/talk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.state.sessionId, npcId: npc.id, message }),
      });

      // 실패는 SSE 가 아니라 JSON 으로 온다 (스트림 시작 전에 거절된 경우).
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      await readSSE(res, (payload) => {
        if (payload.type === 'text') this.dialogue.append(payload.text);
        else if (payload.type === 'event') pending = payload;
        else if (payload.type === 'error') throw new Error(payload.error);
      });
    } catch (err) {
      this.dialogue.reply('오류', err.message);
      return;
    } finally {
      this.dialogue.setBusy(false);
    }

    if (pending) this.#applyEvent(pending);
    this.dialogue.endStream('[Space] 다음 · [Esc] 닫기');
    // 밀고는 즉시 끝내지 않는다 — 즉시 ended 를 세우면 update() 가 멈춰 [Space] 페이지
    // 넘김이 죽고, 플레이어가 진 이유를 읽기 전에 결과 화면이 덮는다.
    // 창이 닫히는 순간(다 읽고 넘겼든, Esc 로 닫았든, 대기 중 이미 닫아 뒀든) 끝낸다.
    if (pending?.event === 'reported') this.reportedPending = true;
  }

  /** 서버가 알려준 상태를 기존 객체에 덮어쓴다 — 노드가 쥔 참조를 살려 두기 위해서. */
  #syncState(view) {
    this.state.pieces = view.pieces;
    this.state.hasKey = view.hasKey;
    this.state.cleared = view.cleared;
    this.state.over = view.over;
    this.state.objects = view.objects;
    for (const n of view.npcs) {
      const cur = this.state.npcs.find((x) => x.id === n.id);
      if (cur) Object.assign(cur, n);
    }
  }

  #applyEvent({ event, piece, state }) {
    this.#syncState(state);
    this.#updateHud();

    if (event === 'reported') {
      this.dialogue.append('\n\n…그가 뒷걸음질 치더니 복도로 뛰어나간다.\n"여기 외부인이 있어요!"');
      this.dialogue.hideInput();
      this.dialogue.setHint('');
      return;
    }
    if (event === 'halted') {
      this.dialogue.append(
        '\n\n…그가 입을 다문다. 더는 눈을 마주치지 않는다.\n\n' +
          '다른 사람과 이야기하고 다시 오는 수밖에 없다.',
      );
      this.dialogue.hideInput();
      this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
      return;
    }
    if (event === 'piece' || event === 'key') {
      // 조각 문구는 서버가 쥔 원문 그대로 붙인다 — 모델이 고쳐 말하면 단서가 흐려진다.
      this.dialogue.append(`\n\n"${piece}"`);
      if (event === 'key') {
        this.dialogue.append('\n\n[연구실 열쇠를 손에 넣었다. 하인 통로 끝의 문을 열 수 있다.]');
      } else {
        this.dialogue.append(`\n\n[정보 조각 ${this.state.pieces.length}/3]`);
      }
      return;
    }
  }

  /** [E] — 연구실 문서. 입장만으로는 클리어가 아니다 (수정안 p.20). */
  async #readDocument() {
    if (this.reading || this.state.cleared) return;
    this.reading = true;
    this.dialogue.hide();
    this.docPanel.open({
      title: DOCUMENT.name,
      body:
        '받침대 위에 도면과 기록이 펼쳐져 있다.\n\n' +
        '"…신형은 명령 없이도 판단한다. 통제는 더 이상 유효하지 않다."',
    });

    try {
      const res = await fetch('/api/mansion/document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.state.sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      this.#syncState(data.state);
    } catch (err) {
      this.reading = false;
      this.docPanel.close();
      this.dialogue.reply('오류', err.message);
      return;
    }

    this.#toSewer();
  }

  #beat(ms) {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  /**
   * 문서를 확보했다 — 이야기가 이어진다(스테이지1 #toMansion 과 같은 패턴).
   * 실패(#endGame('reported'))는 손대지 않는다 — 그건 여전히 결과 화면에서 끝난다.
   */
  async #toSewer() {
    if (this.ended) return;
    this.ended = true;
    this.player.body.setVelocity(0, 0);

    const e = this.state.escort;
    this.dialogue.show(
      `${e.name} (${e.role})`,
      '"이걸 봐야겠군… 명령 없이 판단한다니, 위험한 물건이야.\n\n' +
        '여기 오래 있을 수 없다. 하수도로 빠지는 길이 있다 — 거기서 다음을 준비하자."',
      { portrait: e.id },
    );
    await this.#beat(3400);

    this.dialogue.hide();
    this.cameras.main.fadeOut(900, 0, 0, 0);
    this.uiCam?.fadeOut(900, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Sewer'));
  }

  #endGame(outcome) {
    if (this.ended) return;
    this.ended = true;
    this.player.body.setVelocity(0, 0);

    this.time.delayedCall(2000, () => {
      // 문서를 읽는 2초의 여운은 그대로 두고, 결과 화면이 뜨는 순간 종이를 접는다
      // — #docpanel 은 z-index 를 가져 결과 화면(#result)을 덮기 때문이다.
      this.docPanel?.close();
      this.result.show({
        outcome,
        codeWord: null,
        stats: [`정보 조각 ${this.state.pieces.length}/3`, this.state.hasKey ? '열쇠 확보' : '열쇠 없음'],
        // 저택은 시작에 LLM 대기가 없다 — 스테이지 1의 /start 를 부르면 안 된다.
        restart: async () => ({ state: null }),
        waitText: '저택으로 돌아가는 중…',
        onRestart: () => this.scene.restart(),
      });
    });
  }
}
