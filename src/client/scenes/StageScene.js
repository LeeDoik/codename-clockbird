import Phaser from 'phaser';
import { DialogueBox } from '../ui/DialogueBox.js';
import { ResultOverlay } from '../ui/ResultOverlay.js';
import { MinigamePanel } from '../ui/MinigamePanel.js';
import { runLockPuzzle } from '../minigames/lockPuzzle.js';
import { runTimingLock } from '../minigames/timingLock.js';
import { runInterrogation } from '../minigames/interrogation.js';
import { Patrol, PATROL_ROUTES, REINFORCE_AT } from '../entities/Patrol.js';
// 타일 스튜디오(tools/tilemap-studio.html)로 만들어 내보낸 맵. Vite 가 JSON 을 파싱해 객체로 준다.
import mapData from '../assets/map.json';

/**
 * Stage 1.
 *
 * 데이터 흐름(연상 단어 → 접선 → 코드 입력 → 서버 판정 → 경계/클리어)은 그대로 두고,
 * 배경을 타일맵으로 교체했다. solid 타일에는 정적 충돌 바디가 붙어 플레이어를 막는다.
 * 시야·순찰 NPC 는 W3 에서 얹는다.
 */
const SPEED = 200;
const TALK_RANGE = 48;
/** 검문이 끝난 뒤 다시 잡히지 않는 시간. 서버의 checkpointCooldownUntil 과 같은 값이어야 한다. */
const CHECKPOINT_COOLDOWN_MS = 10_000;
const TILE = mapData.tileSize; // 32

// chars.png 스프라이트시트 프레임 — 동료 id → 프레임 (personas.json 순서)
const ALLY_FRAME = { watchmaker: 1, maid: 2, engineer: 3, smuggler: 4, musician: 5 };
const PLAYER_FRAME = 0;
const CITIZEN_FRAME = 6;
// 접선책은 시민과 같은 프레임을 쓴다 — 전용 스프라이트는 에셋 확장 때 교체한다.
const BROKER_FRAME = 6;

export class StageScene extends Phaser.Scene {
  constructor() {
    super('Stage');
  }

  init(data) {
    this.state = data.state;
    this.nearbyAlly = null;
    // 감옥 안에서 손이 닿는 동료 — 접선(E/F) 대신 구출(R) 대상이다.
    this.nearbyJailed = null;
    this.nearbyBroker = null;
    // 지금 떠 있는 대화창이 "지나가며 뜬 안내"인가 — 이것만 사거리를 벗어날 때 자동으로 접는다.
    this.proximityHint = false;
    // 개발용 정답 보기 (백틱 ` 키로 토글, REVEAL_ANSWER=1 일 때만 서버가 응답)
    this.debugAnswer = null;
    this.answerShown = false;
    // 단서 수첩 — F 접선으로 얻은 NPC → 연상 단어. (C 키로 열람)
    this.clues = new Map();
    // 판이 끝났는가. update() 를 멈추는 스위치이자 결과 화면 중복 호출 가드.
    this.ended = false;
    this.startedAt = Date.now();
    // 순찰 로봇들. ?nopatrol 이면 비워 둔다.
    this.patrols = [];
    // 증원 여부. scene.restart 는 인스턴스를 재사용하므로 여기서 되돌리지 않으면
    // 첫 판에서 증원이 붙은 순간부터 다음 판들의 하부 홀 증원이 영영 사라진다.
    this.reinforced = false;
    // 검문 진행 중 — 감지·입력·중복 호출을 한꺼번에 막는 스위치.
    this.checkpointActive = false;
  }

  create() {
    this.dialogue = new DialogueBox();
    this.dialogue.onSend = (message) => this.#chat(message);
    this.dialogue.onCode = (guess) => this.#submitGuess(guess);
    this.result = new ResultOverlay();
    this.result.hide(); // 재시작으로 다시 들어온 경우 이전 판의 결과 화면을 걷어낸다
    this.minigame = new MinigamePanel();
    // 이전 판이 미니게임 도중에 끝났다면 그 판을 접는다 (타이머가 유령으로 남는다).
    this.minigame.abort?.();

    this.#buildMap();

    // 플레이어 — 맵이 지정한 스폰 칸 중앙에 두고 벽과 충돌시킨다.
    const ps = mapData.spawns.player;
    this.player = this.add.sprite(ps.col * TILE + TILE / 2, ps.row * TILE + TILE / 2, 'chars', PLAYER_FRAME);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    // 충돌 판정은 발밑 위주로 좁혀 스프라이트 여백이 벽에 걸리지 않게 한다.
    this.player.body.setSize(16, 14).setOffset(8, 16);
    this.physics.add.collider(this.player, this.walls);

    // 동료 NPC — 위치는 맵의 스폰 포인트를 순서대로 따른다 (없으면 서버 spawn 으로 폴백).
    // 체포된 동료는 감옥 구역에 배치한다.
    this.allyNodes = [];
    this.jailCount = 0; // 감옥에 들어간 동료 수 (체포 시 슬롯 번호로 쓴다)
    this.state.allies.forEach((ally, i) => {
      const sp = mapData.spawns.allies[i];
      // 구출하면 이 자리로 되돌려 보내야 하므로, 감옥에서 시작하는 동료의 원래 자리도 기억해 둔다.
      const home = sp ? { x: sp.col * TILE + TILE / 2, y: sp.row * TILE + TILE / 2 } : ally.spawn;
      const pos = ally.arrested ? { x: 80 + this.jailCount++ * 44, y: 60 } : home;

      const frame = ALLY_FRAME[ally.id] ?? i + 1;
      const node = this.add.sprite(pos.x, pos.y, 'chars', frame);
      if (ally.arrested) node.setTint(0x9a9088);

      const label = this.add
        .text(pos.x, pos.y - 24, ally.arrested ? `${ally.name} (체포)` : ally.name, {
          fontFamily: 'Malgun Gothic, sans-serif',
          fontSize: '11px',
          color: '#8a7f6a',
        })
        .setOrigin(0.5);

      this.allyNodes.push({ ally, node, label, home, jailed: ally.arrested });
    });

    // 접선책 — 코드를 건넬 유일한 창구. 단어를 내지 않으므로 체포·중복 판정과 무관하다.
    const bz = mapData.spawns.broker;
    const bpos = bz
      ? { x: bz.col * TILE + TILE / 2, y: bz.row * TILE + TILE / 2 }
      : this.state.broker.spawn;
    this.brokerNode = this.add.sprite(bpos.x, bpos.y, 'chars', BROKER_FRAME);
    this.add
      .text(bpos.x, bpos.y - 24, this.state.broker.name, {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '11px',
        color: '#8a7f6a',
      })
      .setOrigin(0.5);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.keyE = this.input.keyboard.addKey('E');
    this.keyF = this.input.keyboard.addKey('F');
    this.keyR = this.input.keyboard.addKey('R');
    this.keySpace = this.input.keyboard.addKey('SPACE');
    this.keyEsc = this.input.keyboard.addKey('ESC');
    this.keyReveal = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.BACKTICK);
    this.keyClues = this.input.keyboard.addKey('C');

    this.hud = this.add.text(12, 10, '', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '12px',
      color: '#8a7f6a',
      // 디버그(백틱) 표시의 이유 문장이 캔버스 밖으로 흘러넘치지 않게 감싼다.
      wordWrap: { width: 872 },
    });

    this.#buildCluePanel();
    this.add.text(12, this.scale.height - 22, '[E] 대화    [F] 접선    [R] 구출    [C] 단서 수첩', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '11px',
      color: '#6b6152',
    });

    this.#spawnPatrols();

    this.#updateHud();
    this.#showBriefing();
  }

  /**
   * 순찰 배치.
   *
   * 중앙 복도 1기는 상주하고, 하부 홀 증원은 경계 2(증원 단계)부터 붙는다.
   * 코드 오답·구출·자물쇠 소동이 쌓이면 순찰이 깨어난다.
   */
  #spawnPatrols() {
    // 시연 직전 비상용 킬스위치 (?nointro 관례를 그대로 따른다).
    if (new URLSearchParams(window.location.search).has('nopatrol')) return;

    this.patrols.push(new Patrol(this, PATROL_ROUTES.corridor));
    if (this.state.alertLevel >= REINFORCE_AT) {
      this.patrols.push(new Patrol(this, PATROL_ROUTES.lowerHall));
      this.reinforced = true;
    }
    // 스폰 직후 유예 — 시작하자마자 검문에 걸리면 플레이어는 뭘 한 것도 없이 당한다.
    for (const p of this.patrols) p.resume({ graceMs: 3000 });
  }

  /** 경계가 증원 단계(2)에 이르는 순간 하부 홀에 증원이 붙는다. */
  #maybeReinforce() {
    if (this.reinforced || !this.patrols.length) return;
    if (this.state.alertLevel < REINFORCE_AT) return;
    this.reinforced = true;
    const p = new Patrol(this, PATROL_ROUTES.lowerHall);
    p.resume({ graceMs: 2000 });
    this.patrols.push(p);
  }

  /** 진입 쪽지 — 이미 붙잡힌 동료 수와 남은 동료 수를 알린다. */
  #showBriefing() {
    const total = this.state.allies.length;
    const arrested = this.state.allies.filter((a) => a.arrested).length;
    const remain = total - arrested;

    const lines = ['품 안에 조직이 남긴 쪽지가 잡힌다.\n'];
    if (arrested === 0) {
      lines.push(`동료 ${total}명 전원이 아직 무사하다.`);
    } else if (remain === 0) {
      // 전원 체포 = 접선할 상대가 없다. 이 판에서 구출은 선택지가 아니라 유일한 활로다.
      lines.push(
        `동료 ${total}명이 모두 같은 암호를 떠올려 정체가 드러났다.\n단서를 쥔 동료가 밖에 없다 — 감옥에서 직접 빼내는 수밖에 없다.`,
      );
    } else {
      lines.push(
        `동료 ${total}명 중 ${arrested}명은 같은 암호를 떠올려 정체가 드러나 이미 붙잡혀 갔다.\n(감옥에 갇힌 얼굴을 확인하라.)`,
      );
    }
    if (remain > 0) lines.push(`\n남은 ${remain}명에게 [F] 접선해 단서를 모으고, 겹치는 단어(코드)를 추리해 시계 수리공에게 건네라.`);
    if (arrested > 0) {
      lines.push(
        `\n감옥(좌측 상단) 창살 앞에서 [R] — 붙잡힌 동료를 빼낼 수 있다.\n소란은 새어 나가 경계 레벨이 오르지만, 그가 떠올린 단어는\n둘이 겹쳐서 잡혀갈 만큼 확실한 단서다.`,
      );
    }
    lines.push('\n[E] 대화 · [F] 접선 · [R] 구출 · [C] 단서 수첩');

    this.dialogue.show('접선 지령', lines.join('\n'));
    this.dialogue.setHint('[Space] / [Esc] 로 쪽지를 접는다');
  }

  /** 단서 수첩 패널 (숨김 상태로 생성). */
  #buildCluePanel() {
    const w = 380, h = 280;
    const cx = this.scale.width / 2, cy = this.scale.height / 2;
    const bg = this.add.rectangle(cx, cy, w, h, 0x17130e, 0.97).setStrokeStyle(2, 0xc9a227);
    const title = this.add
      .text(cx, cy - h / 2 + 20, '단서 수첩', {
        fontFamily: 'Malgun Gothic, sans-serif', fontSize: '16px', color: '#c9a227', fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const rule = this.add.rectangle(cx, cy - h / 2 + 38, w - 36, 1, 0x3a3120);
    this.clueText = this.add.text(cx - w / 2 + 22, cy - h / 2 + 54, '', {
      fontFamily: 'Malgun Gothic, sans-serif', fontSize: '13px', color: '#e8dcc0',
      lineSpacing: 8, wordWrap: { width: w - 44 },
    });
    const hint = this.add
      .text(cx, cy + h / 2 - 16, '[C] 닫기', {
        fontFamily: 'Malgun Gothic, sans-serif', fontSize: '11px', color: '#8a7f6a',
      })
      .setOrigin(0.5);
    this.cluePanel = this.add.container(0, 0, [bg, title, rule, this.clueText, hint]).setDepth(1000).setVisible(false);
  }

  #toggleClues() {
    if (!this.cluePanel) return;
    const show = !this.cluePanel.visible;
    if (show) this.#refreshClues();
    this.cluePanel.setVisible(show);
  }

  #refreshClues() {
    if (this.clues.size === 0) {
      this.clueText.setText('아직 수집한 단서가 없다.\n\n동료 근처에서 [F] 로 접선하면,\n그가 흘린 연상 단어가 여기 기록된다.');
      return;
    }
    const lines = [];
    for (const { name, role, word, rescued } of this.clues.values()) {
      lines.push(`· ${name} (${role})\n     「${word}」${rescued ? '   ← 둘이 겹쳐 낸 단어' : ''}`);
    }
    lines.push(`\n수집한 단서 ${this.clues.size}개 — 이 단어들로 접선 코드를 추리하라.`);
    this.clueText.setText(lines.join('\n'));
  }

  /**
   * 타일맵 렌더 + 충돌.
   * map.json 의 layout 을 깔고, solid 타일은 정적 물리 바디로 만들어 플레이어를 막는다.
   * 정적 그룹의 create 는 보이는 스프라이트와 정적 바디를 한 번에 만든다.
   */
  #buildMap() {
    this.walls = this.physics.add.staticGroup();
    const { layout, tiles, rows, cols } = mapData;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const f = layout[r][c];
        if (f < 0) continue; // 빈칸
        if (tiles[f].solid) {
          this.walls.create(c * TILE + TILE / 2, r * TILE + TILE / 2, 'tiles', f);
        } else {
          this.add.image(c * TILE, r * TILE, 'tiles', f).setOrigin(0, 0);
        }
      }
    }

    // 시민 스폰 — 마을 NPC 분기 대사는 W3 TODO. 지금은 맵이 지정한 위치에 표시만 한다.
    const cz = mapData.spawns.citizen;
    if (cz) {
      const x = cz.col * TILE + TILE / 2, y = cz.row * TILE + TILE / 2;
      this.add.sprite(x, y, 'chars', CITIZEN_FRAME);
      this.add
        .text(x, y - 24, '시민', {
          fontFamily: 'Malgun Gothic, sans-serif',
          fontSize: '11px',
          color: '#8a7f6a',
        })
        .setOrigin(0.5);
    }

    // 감옥 구역 표시 (상단 좌측 방)
    this.add.rectangle(160, 60, 300, 70).setStrokeStyle(1, 0x6b4a4a);
    this.add
      .text(160, 20, '감옥', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '11px',
        color: '#6b4a4a',
      })
      .setOrigin(0.5);
  }

  #updateHud() {
    // 상태가 바뀔 때마다 반드시 지나가는 길목이라, 증원 판정도 여기서 함께 본다.
    this.#maybeReinforce();

    const active = this.state.allies.filter((a) => !a.arrested);
    const lines = [
      `경계 레벨 ${this.state.alertLevel} / 3   |   접선 가능 ${active.length}/${this.state.allies.length}`,
    ];
    if (this.answerShown && this.debugAnswer) {
      lines.push(`[디버그] 접선 코드: 「${this.debugAnswer.codeWord}」 (${this.debugAnswer.category})`);
      // 동료별 연상 단어 + 그 단어를 떠올린 이유 (wordGen 의 reason).
      // 단어·이유는 판이 끝날 때까지 불변이라 캐시해도 되지만, 체포 여부는 플레이 중
      // 변하므로 실시간 state 쪽에서 읽는다.
      for (const a of this.debugAnswer.allies ?? []) {
        const live = this.state.allies.find((s) => s.id === a.id);
        lines.push(`  ${live?.arrested ? '✕' : '·'} ${a.name}「${a.word}」 — ${a.reason}`);
      }
    }
    this.hud.setText(lines.join('\n'));
  }

  /** 개발용 정답 토글. 서버는 REVEAL_ANSWER=1 일 때만 정답을 준다. */
  async #toggleAnswer() {
    if (this.answerShown) {
      this.answerShown = false;
      this.#updateHud();
      return;
    }
    if (!this.debugAnswer) {
      try {
        const res = await fetch(`/api/stage/${this.state.sessionId}/answer`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          this.dialogue.show('디버그', data.error ?? '정답을 확인할 수 없습니다.');
          return;
        }
        this.debugAnswer = data;
      } catch {
        this.dialogue.show('디버그', '정답 확인 요청에 실패했습니다.');
        return;
      }
    }
    this.answerShown = true;
    this.#updateHud();
  }

  /**
   * 판을 끝내고 결과 화면을 띄운다.
   *
   * 클리어는 기존 "STAGE 1 CLEAR" 대사를 읽을 틈을 준 뒤 덮고, 게임오버는 즉시 덮는다
   * — 진 이유는 이미 대사로 나왔고, 늘어질수록 다시 하기 싫어진다.
   *
   * @param {'cleared'|'caught'|'spotted'} outcome
   */
  #endGame(outcome, { delay = 0 } = {}) {
    if (this.ended) return;
    this.ended = true;
    // 조기 return 만으로 멈추면 마지막 프레임의 속도가 남아 플레이어가 계속 미끄러진다.
    this.player.body.setVelocity(0, 0);
    for (const p of this.patrols) p.halt();

    const show = () => {
      this.dialogue.hide();
      this.result.show({
        outcome,
        codeWord: this.state.codeWord,
        stats: [
          `단서 ${this.clues.size}개`,
          `경계 레벨 ${this.state.alertLevel}`,
          `${Math.round((Date.now() - this.startedAt) / 1000)}초`,
        ],
        onRestart: (state) => this.scene.restart({ state }),
      });
    };

    if (delay) this.time.delayedCall(delay, show);
    else show();
  }

  update(time, delta) {
    if (this.ended) return;

    // 미니게임 중에는 월드를 멈춘다. 패널이 키를 capture 단계에서 가로채므로 Phaser 는
    // 새 입력을 못 받지만, 패널이 열리기 직전에 눌려 있던 키는 그대로 눌린 상태로 남는다.
    if (this.minigame.isOpen) {
      this.player.body.setVelocity(0, 0);
      return;
    }

    if (this.#updatePatrols(delta)) {
      this.player.body.setVelocity(0, 0);
      this.#startCheckpoint();
      return;
    }

    // 대화창 입력 중에는 이동을 막는다.
    const typing = this.dialogue.isTyping;
    const body = this.player.body;

    if (typing) {
      body.setVelocity(0, 0);
    } else {
      const left = this.cursors.left.isDown || this.wasd.A.isDown;
      const right = this.cursors.right.isDown || this.wasd.D.isDown;
      const up = this.cursors.up.isDown || this.wasd.W.isDown;
      const down = this.cursors.down.isDown || this.wasd.S.isDown;

      body.setVelocity(
        (right ? SPEED : 0) - (left ? SPEED : 0),
        (down ? SPEED : 0) - (up ? SPEED : 0),
      );
    }

    this.#checkProximity();

    if (!typing && Phaser.Input.Keyboard.JustDown(this.keyE)) {
      if (this.nearbyAlly) this.#talk(this.nearbyAlly);
      else if (this.nearbyBroker) this.#talkBroker();
    }
    // F — 동료 앞이면 접선(단어 확인), 접선책 앞이면 코드 전달
    if (!typing && Phaser.Input.Keyboard.JustDown(this.keyF)) {
      if (this.nearbyAlly) this.#contactAlly(this.nearbyAlly);
      else if (this.nearbyBroker) this.#offerCodeToBroker();
    }
    // R — 감옥의 동료 구출. 대상이 없어도 눌리게 둔다 (어디로 가야 하는지 알려주기 위해).
    if (!typing && Phaser.Input.Keyboard.JustDown(this.keyR)) {
      this.#tryRescue();
    }
    if (!typing && Phaser.Input.Keyboard.JustDown(this.keySpace)) {
      this.dialogue.hide();
    }
    // Esc 로도 대화창을 닫는다. 입력칸 포커스 중일 때는 DialogueBox 가 직접 처리하므로
    // 여기서는 입력칸 밖(메시지만 표시 중)일 때를 담당한다.
    if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
      this.dialogue.hide();
    }
    // 백틱(`) — 개발용 정답 토글
    if (Phaser.Input.Keyboard.JustDown(this.keyReveal)) {
      this.#toggleAnswer();
    }
    // C — 단서 수첩 열람
    if (!typing && Phaser.Input.Keyboard.JustDown(this.keyClues)) {
      this.#toggleClues();
    }
  }

  /**
   * 순찰을 전진시키고 감지 여부를 돌려준다.
   *
   * 감지를 멈추는 조건은 "대화창이 떠 있다" 가 아니라 "대화에 손이 묶여 있다" 다.
   * 이 게임은 근처를 지나기만 해도 안내 대화창이 뜨고, 검문 결과 메시지도 플레이어가
   * 닫을 때까지 남는다. 떠 있다는 이유로 감지를 끄면 한 번 검문당한 뒤 그 메시지를
   * 닫지 않는 한 순찰이 영원히 눈이 먼다.
   *
   * 실제로 막아야 하는 건 두 가지뿐이다:
   *  - 응답 대기 중(busy) — SSE 로 대사가 흘러나오는 중에 검문이 끼어들면 대화창을
   *    강탈해 응답이 허공으로 사라진다
   *  - 입력칸에 타이핑 중 — 손이 키보드에 묶여 있어 피할 수단이 없다
   */
  #updatePatrols(delta) {
    const busyTalking = this.dialogue.busy || this.dialogue.isTyping;
    const canDetect = !this.checkpointActive && !busyTalking;
    let seen = false;
    for (const p of this.patrols) {
      if (p.update(delta, this.state.alertLevel, canDetect ? this.player : null)) seen = true;
    }
    return seen;
  }

  /**
   * 발각 → 검문.
   *
   * 1단은 지연 0 인 타이밍 게임이라 대부분의 조우가 여기서 끝난다. 놓쳤을 때만
   * LLM 심문이 마지막 기회로 열린다 (계획서 §5.1 의 AI 활용 지점 4번).
   */
  async #startCheckpoint() {
    if (this.checkpointActive) return;
    this.checkpointActive = true;
    for (const p of this.patrols) p.halt();
    this.dialogue.hide();

    try {
      const started = await this.#post('checkpoint/start');
      this.state = started.state;
      this.#updateHud();

      // 경계가 극에 달한 거리 — 로봇은 묻지 않는다.
      if (started.outcome === 'spotted') {
        this.#endGame('spotted');
        return;
      }

      const passed = await runTimingLock(this.minigame, this.state.alertLevel);
      if (this.ended) return;

      if (passed) {
        const r = await this.#post('checkpoint/qte', { result: 'pass' });
        this.state = r.state;
        this.#updateHud();
        return;
      }

      const outcome = await runInterrogation(this.minigame, {
        // 질문 생성(LLM 2~4초)이 여기서 돈다 — 패널의 "신원 조회 중…" 이 그 대기를 덮는다.
        fetchQuestion: async () => {
          const r = await this.#post('checkpoint/qte', { result: 'fail' });
          this.state = r.state;
          this.#updateHud();
          return r;
        },
        submitAnswer: async (answer, source) => {
          const r = await this.#post('checkpoint/answer', { answer, source });
          this.state = r.state;
          this.#updateHud();
          return r;
        },
      });

      if (this.ended) return;
      if (outcome === 'caught') {
        this.dialogue.show(
          '검문 적발',
          '진술이 받아들여지지 않았다. 기록이 남았다.\n\n' +
            `경계 레벨이 올라갔다. (${this.state.alertLevel}/3)\n` +
            '경계가 극에 달하면 다음 발각은 검문도 없이 끝난다.',
        );
        this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
      }
    } catch (err) {
      // 검문이 네트워크 사고로 게임을 멈추게 두지 않는다. 패널을 접고 그냥 보내 준다.
      this.minigame.close();
      console.warn('[checkpoint]', err.message);
    } finally {
      this.checkpointActive = false;
      // 통과 직후 같은 자리에서 다시 잡히면 빠져나갈 방법이 없다. 유예를 서버 쿨다운과
      // 같은 길이로 준다 — 짧게 주면 그 차이만큼 거절당할 요청을 계속 쏘게 된다.
      for (const p of this.patrols) p.resume({ graceMs: CHECKPOINT_COOLDOWN_MS });
    }
  }

  /** 상태를 갱신하는 POST 한 번. 실패는 예외로 올린다. */
  async #post(path, body = {}) {
    const res = await fetch(`/api/stage/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: this.state.sessionId, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  }

  #checkProximity() {
    let found = null;
    let jailed = null;
    let nearestFree = Infinity;
    let nearestJailed = Infinity;

    for (const { ally, node } of this.allyNodes) {
      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y, node.x, node.y,
      );
      if (dist >= TALK_RANGE) continue;
      // 감옥 슬롯 간격(44px)이 접선 거리(48px)보다 좁아 두 명이 동시에 사거리에 들어온다.
      // 그래서 첫 번째가 아니라 가장 가까운 쪽을 집는다 — 옆 칸 동료가 잘못 잡히지 않게.
      if (ally.arrested) {
        if (dist < nearestJailed) { nearestJailed = dist; jailed = ally; }
      } else if (dist < nearestFree) {
        nearestFree = dist; found = ally;
      }
    }

    const bd = Phaser.Math.Distance.Between(
      this.player.x, this.player.y, this.brokerNode.x, this.brokerNode.y,
    );
    const broker = bd < TALK_RANGE ? this.state.broker : null;

    if (found !== this.nearbyAlly || jailed !== this.nearbyJailed || broker !== this.nearbyBroker) {
      this.nearbyAlly = found;
      this.nearbyJailed = jailed;
      this.nearbyBroker = broker;
      const target = found ?? broker ?? jailed;
      if (target && !this.dialogue.isOpen) {
        this.dialogue.show(
          target.name,
          found
            ? `${found.name} — [E] 대화 · [F] 접선(단어 확인)`
            : broker
              ? `${broker.name} (${broker.role}) — [E] 대화 · [F] 코드 전달`
              : `${jailed.name} — 창살 너머에 있다. [R] 구출 (경계 레벨 +1)`,
        );
        this.proximityHint = true;
      } else if (!target && this.proximityHint) {
        // 지나가며 뜬 안내만 자동으로 접는다. 접선·구출 결과는 플레이어가 [Space] 로 닫는다
        // — 결과를 읽기도 전에 동료가 tween 으로 사거리를 벗어나 사라져 버리기 때문.
        this.dialogue.hide();
        this.proximityHint = false;
      }
    }
  }

  /** E — 자유 대화. 연상 단어는 밝히지 않는다 (단서는 F 접선으로 얻는다). */
  #talk(ally) {
    this.currentAllyId = ally.id;
    this.dialogue.show(`${ally.name} (${ally.role})`, `${ally.name}에게 말을 건넨다.`);
    this.dialogue.showInput('말을 건넨다...', 'chat');
    this.dialogue.setHint('[Enter] 대화 · [Esc] 닫기');
  }

  /** F — 접선: NPC 가 흘린 연상 단어(단서)를 밝혀 단서 수첩에 기록한다. 코드 입력은 접선책 전용. */
  async #contactAlly(ally) {
    if (this.contacting) return;
    this.contacting = true;
    this.dialogue.show(`${ally.name} (${ally.role})`, '조심스럽게 접선을 시도한다...');

    let contact;
    try {
      const res = await fetch('/api/stage/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.state.sessionId, allyId: ally.id }),
      });
      contact = await res.json();
      if (!res.ok) throw new Error(contact.error ?? `HTTP ${res.status}`);
    } catch (err) {
      this.dialogue.show('오류', err.message);
      return;
    } finally {
      this.contacting = false;
    }

    this.state = contact.state;
    this.#recordClue(ally, contact.word);
    this.#syncAllyNodes();

    this.dialogue.show(
      `${ally.name} (${ally.role})`,
      `"...「${contact.word}」."\n\n그가 흘린 단서다. [C] 단서 수첩에 기록됐다.\n코드를 확신하게 되면 시계 수리공에게 가라.`,
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  /** E — 접선책 고정 대사. 자유 대화(LLM)는 붙이지 않는다 — 그는 말을 아끼는 인물이다. */
  #talkBroker() {
    const b = this.state.broker;
    this.proximityHint = false;
    this.dialogue.show(
      `${b.name} (${b.role})`,
      '태엽 감는 소리 사이로 짧은 한마디.\n"동료들의 단어에서 겹치는 것을 찾아라. 그게 코드다."',
    );
    this.dialogue.setHint('[F] 코드 전달 · [Space] 닫기');
  }

  /** F — 접선책에게 코드를 건넨다. 입력창은 오직 여기서만 열린다. */
  #offerCodeToBroker() {
    const b = this.state.broker;
    this.proximityHint = false;
    this.dialogue.show(
      `${b.name} (${b.role})`,
      '수리공이 시계에서 눈을 떼지 않은 채 낮게 묻는다.\n"…코드는?"',
    );
    this.dialogue.showInput('접선 코드 입력...', 'code');
    this.dialogue.setHint('[Enter] 코드 전달 · [Esc] 취소');
  }

  /** F 접선으로 얻은 단서(NPC → 연상 단어)를 수첩에 기록한다. */
  #recordClue(ally, word) {
    if (!word) return;
    // 구출한 동료의 단어는 둘 이상이 겹쳐 냈기에 그가 잡혀갔던 단어다 — 수첩에서 구분해 준다.
    const rescued = this.state.allies.find((a) => a.id === ally.id)?.rescued ?? false;
    this.clues.set(ally.id, { name: ally.name, role: ally.role, word, rescued });
    if (this.cluePanel && this.cluePanel.visible) this.#refreshClues();
  }

  /**
   * R — 구출 시도.
   * 감옥 앞이 아니면 어디로 가야 하는지 알려준다. 감옥이 비었으면 그렇다고 말해 준다
   * (아무 반응도 없으면 키가 먹은 건지 대상이 없는 건지 플레이어가 구분할 수 없다).
   */
  #tryRescue() {
    if (this.nearbyJailed) {
      this.#rescue(this.nearbyJailed);
      return;
    }

    const jailed = this.state.allies.filter((a) => a.arrested).length;
    this.proximityHint = false;
    this.dialogue.show(
      '구출',
      jailed === 0
        ? '감옥은 비어 있다.\n지금 빼낼 동료는 없다.'
        : `감옥에 ${jailed}명이 붙잡혀 있다.\n창살 바로 앞(지도 좌측 상단)까지 다가가서 [R].`,
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  /**
   * R — 구출 실행. 대가(경계 레벨) 계산은 전부 서버가 하고 여기선 결과만 반영한다.
   */
  async #rescue(ally) {
    if (this.rescuing) return;
    this.rescuing = true;
    this.proximityHint = false;
    this.dialogue.hide();

    // 잠금장치 퍼즐을 먼저 통과해야 한다. 실패해도 즉시 게임오버가 아니라 경계만
    // 올린다 — 감옥 앞에서 판이 끝나 버리면 "전원 체포 판의 유일한 활로"라는 구출의
    // 역할이 사라진다.
    let picked;
    try {
      picked = await runLockPuzzle(this.minigame);
    } finally {
      this.rescuing = false;
    }
    if (this.ended) return; // 퍼즐을 푸는 사이 판이 끝났다면 결과를 버린다

    if (!picked) {
      await this.#raiseAlarm('lockpick');
      this.dialogue.show(
        `${ally.name} (${ally.role})`,
        '자물쇠가 잠겨 버렸다. 쇳소리가 복도를 타고 번진다.\n\n' +
          `경계 레벨이 올라갔다. (${this.state.alertLevel})\n다시 시도할 수는 있다.`,
      );
      this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
      return;
    }

    this.rescuing = true;
    this.dialogue.show(`${ally.name} (${ally.role})`, '자물쇠가 풀렸다. 창살을 밀어 젖힌다...');

    let result;
    try {
      const res = await fetch('/api/stage/rescue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.state.sessionId, allyId: ally.id }),
      });
      result = await res.json();
      if (!res.ok) throw new Error(result.error ?? `HTTP ${res.status}`);
    } catch (err) {
      this.dialogue.show('오류', err.message);
      return;
    } finally {
      this.rescuing = false;
    }

    this.state = result.state;
    this.#syncAllyNodes();
    this.#updateHud();

    const freed = this.state.allies.find((a) => a.id === ally.id);
    this.dialogue.show(
      `${ally.name} (${ally.role})`,
      `${freed.name}이(가) 창살 밖으로 빠져나와 제자리로 돌아갔다.\n\n` +
        `소란이 새어 나갔다 — 경계 레벨 ${result.alertLevel}.\n\n` +
        `[F] 로 다시 접선할 수 있다. 그가 떠올린 단어는\n둘이 겹쳐 낸 만큼 확실한 단서다.`,
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  /** 클라이언트에서 판정이 끝난 사건의 대가를 서버에 청구한다 (경계 레벨 상승). */
  async #raiseAlarm(reason) {
    try {
      const res = await fetch('/api/stage/alarm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.state.sessionId, reason }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? `HTTP ${res.status}`);
      this.state = result.state;
      this.#updateHud();
    } catch (err) {
      // 경계 상승은 게임을 막지 않는 부수 효과다 — 실패해도 진행을 멈추지 않는다.
      console.warn('[alarm]', err.message);
    }
  }

  /** 자유 대화 — 서버가 SSE 로 흘려보내는 응답을 델타 단위로 붙인다 */
  async #chat(message) {
    const ally = this.state.allies.find((a) => a.id === this.currentAllyId);
    if (!ally) return;

    this.dialogue.setBusy(true);
    this.dialogue.beginStream(`${ally.name} (${ally.role})`);

    try {
      const res = await fetch('/api/stage/talk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.state.sessionId,
          allyId: this.currentAllyId,
          message,
        }),
      });

      // 실패는 SSE 가 아니라 JSON 으로 온다 (스트림 시작 전에 거절된 경우).
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      await this.#readSSE(res, (payload) => {
        if (payload.type === 'text') this.dialogue.append(payload.text);
        else if (payload.type === 'error') throw new Error(payload.error);
      });
    } catch (err) {
      this.dialogue.show('오류', err.message);
    } finally {
      this.dialogue.setBusy(false);
    }
  }

  /**
   * POST 응답의 SSE 스트림을 읽는다.
   * EventSource 는 GET 전용이라 쓸 수 없어 fetch 스트림을 직접 파싱한다.
   */
  async #readSSE(res, onPayload) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE 이벤트 경계는 빈 줄. 마지막 조각은 미완성일 수 있으니 버퍼에 남긴다.
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const event of events) {
        const line = event.split('\n').find((l) => l.startsWith('data: '));
        if (line) onPayload(JSON.parse(line.slice(6)));
      }
    }
  }

  async #submitGuess(guess) {
    this.dialogue.setBusy(true);
    this.dialogue.show('...', `"${guess}"...\n\n조심스럽게 코드를 건넨다.`);

    try {
      const res = await fetch('/api/stage/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.state.sessionId,
          brokerId: this.state.broker.id,
          guess,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? `HTTP ${res.status}`);

      this.state = result.state;
      this.#updateHud();

      if (result.correct) {
        this.dialogue.hideInput();
        this.dialogue.setHint('');
        this.dialogue.show(
          '접선 성공',
          `접선 코드는 「${result.codeWord}」 였다.\n\nSTAGE 1 CLEAR`,
        );
        this.#endGame('cleared', { delay: 1200 });
        return;
      }

      this.#syncAllyNodes();

      const maxed = this.state.alertLevel >= 3;
      this.dialogue.show(
        '접선 실패',
        `틀렸다. 수리공이 말없이 고개를 젓는다.\n거리에 소문이 샌다 — 경계 레벨 ${this.state.alertLevel}/3.` +
          (maxed ? '\n\n거리가 끓고 있다. 이제 발각되면 검문도 없이 끝난다.' : ''),
      );
    } catch (err) {
      this.dialogue.show('오류', err.message);
    } finally {
      this.dialogue.setBusy(false);
    }
  }

  /**
   * this.state 를 노드에 반영한다 — 체포된 동료는 감옥으로 옮기고, 구출된 동료는 제자리로
   * 돌려보낸다.
   */
  #syncAllyNodes() {
    for (const entry of this.allyNodes) {
      const updated = this.state.allies.find((a) => a.id === entry.ally.id);
      if (!updated) continue;
      entry.ally = updated;

      if (updated.arrested && !entry.jailed) {
        entry.jailed = true;
        const x = 80 + this.jailCount++ * 44;
        const y = 60;
        entry.node.setTint(0x9a9088); // 붙잡혀 색이 죽는다
        entry.label.setText(`${updated.name} (체포)`).setColor('#8a7f6a');
        // 감옥으로 끌려가는 연출
        this.tweens.add({ targets: entry.node, x, y, duration: 350, ease: 'Cubic.easeIn' });
        this.tweens.add({ targets: entry.label, x, y: y - 24, duration: 350, ease: 'Cubic.easeIn' });
      } else if (!updated.arrested && entry.jailed) {
        // 구출 — 감옥행 연출을 되감는다. 끌려갈 때 easeIn 이었으니 풀려날 땐 easeOut.
        entry.jailed = false;
        const { x, y } = entry.home;
        entry.node.clearTint();
        entry.label.setText(updated.name);
        this.tweens.add({ targets: entry.node, x, y, duration: 350, ease: 'Cubic.easeOut' });
        this.tweens.add({ targets: entry.label, x, y: y - 24, duration: 350, ease: 'Cubic.easeOut' });
      }
    }
  }
}
