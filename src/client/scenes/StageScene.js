import Phaser from 'phaser';
import { DialogueBox } from '../ui/DialogueBox.js';
// 타일 스튜디오(tools/tilemap-studio.html)로 만들어 내보낸 맵. Vite 가 JSON 을 파싱해 객체로 준다.
import mapData from '../assets/map.json';

/**
 * Stage 1.
 *
 * 데이터 흐름(연상 단어 → 접선 → 코드 입력 → 서버 판정 → 신뢰도/클리어)은 그대로 두고,
 * 배경을 타일맵으로 교체했다. solid 타일에는 정적 충돌 바디가 붙어 플레이어를 막는다.
 * 시야·순찰 NPC 는 W3 에서 얹는다.
 */
const SPEED = 200;
const TALK_RANGE = 48;
const TILE = mapData.tileSize; // 32

// chars.png 스프라이트시트 프레임 — 동료 id → 프레임 (personas.json 순서)
const ALLY_FRAME = { watchmaker: 1, maid: 2, engineer: 3, smuggler: 4, musician: 5 };
const PLAYER_FRAME = 0;
const CITIZEN_FRAME = 6;

export class StageScene extends Phaser.Scene {
  constructor() {
    super('Stage');
  }

  init(data) {
    this.state = data.state;
    this.nearbyAlly = null;
    // 감옥 안에서 손이 닿는 동료 — 접선(E/F) 대신 구출(R) 대상이다.
    this.nearbyJailed = null;
    // 지금 떠 있는 대화창이 "지나가며 뜬 안내"인가 — 이것만 사거리를 벗어날 때 자동으로 접는다.
    this.proximityHint = false;
    // 개발용 정답 보기 (백틱 ` 키로 토글, REVEAL_ANSWER=1 일 때만 서버가 응답)
    this.debugAnswer = null;
    this.answerShown = false;
    // 단서 수첩 — F 접선으로 얻은 NPC → 연상 단어. (C 키로 열람)
    this.clues = new Map();
  }

  create() {
    this.dialogue = new DialogueBox();
    this.dialogue.onSend = (message) => this.#chat(message);
    this.dialogue.onCode = (guess) => this.#submitGuess(guess);

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
      else if (ally.informed) node.setTint(0xb87a3a).setAlpha(0.4);

      const label = this.add
        .text(pos.x, pos.y - 24, ally.arrested ? `${ally.name} (체포)` : ally.name, {
          fontFamily: 'Malgun Gothic, sans-serif',
          fontSize: '11px',
          color: '#8a7f6a',
        })
        .setOrigin(0.5);

      this.allyNodes.push({ ally, node, label, home, jailed: ally.arrested });
    });

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
    });

    this.#buildCluePanel();
    this.add.text(12, this.scale.height - 22, '[E] 대화    [F] 접선 코드    [R] 구출    [C] 단서 수첩', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '11px',
      color: '#6b6152',
    });

    this.#updateHud();
    this.#showBriefing();
  }

  /** 진입 쪽지 — 이미 붙잡힌 동료 수와 남은 동료 수를 알린다. */
  #showBriefing() {
    const total = this.state.allies.length;
    const arrested = this.state.allies.filter((a) => a.arrested).length;
    const remain = total - arrested;

    const lines = ['품 안에 접선책이 남긴 쪽지가 잡힌다.\n'];
    if (arrested === 0) {
      lines.push(`동료 ${total}명 전원이 아직 무사하다.`);
    } else if (remain === 0) {
      // 전원 체포 = 접선할 상대가 없다. 이 판에서 구출은 선택지가 아니라 유일한 활로다.
      lines.push(
        `동료 ${total}명이 모두 같은 암호를 떠올려 정체가 드러났다.\n밖에 남은 접선책이 없다 — 감옥에서 직접 빼내는 수밖에 없다.`,
      );
    } else {
      lines.push(
        `동료 ${total}명 중 ${arrested}명은 같은 암호를 떠올려 정체가 드러나 이미 붙잡혀 갔다.\n(감옥에 갇힌 얼굴을 확인하라.)`,
      );
    }
    if (remain > 0) lines.push(`\n남은 ${remain}명에게 [F] 접선해 단서를 모으고, 접선 코드를 추리하라.`);
    if (arrested > 0) {
      lines.push(
        `\n감옥(좌측 상단) 창살 앞에서 [R] — 붙잡힌 동료를 빼낼 수 있다.\n소란은 새어 나가 경계 레벨이 오르지만, 그가 떠올린 단어는\n둘이 겹쳐서 잡혀갈 만큼 확실한 단서다.`,
      );
    }
    lines.push('\n[E] 대화 · [F] 접선 코드 · [R] 구출 · [C] 단서 수첩');

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
    const active = this.state.allies.filter((a) => !a.arrested && !a.informed);
    const trust = active.map((a) => `${a.name}:${'●'.repeat(a.trust)}${'○'.repeat(a.maxTrust - a.trust)}`);
    const lines = [
      `경계 레벨 ${this.state.alertLevel}   |   접선 가능 ${active.length}/5`,
      trust.join('  '),
    ];
    if (this.answerShown && this.debugAnswer) {
      lines.push(`[디버그] 접선 코드: 「${this.debugAnswer.codeWord}」 (${this.debugAnswer.category})`);
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

  update() {
    if (this.state.cleared || this.state.gameOver) return;

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

    if (!typing && Phaser.Input.Keyboard.JustDown(this.keyE) && this.nearbyAlly) {
      this.#talk(this.nearbyAlly);
    }
    // F — 근처 동료에게 바로 접선 코드를 전달
    if (!typing && Phaser.Input.Keyboard.JustDown(this.keyF) && this.nearbyAlly) {
      this.#offerCode(this.nearbyAlly);
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

  #checkProximity() {
    let found = null;
    let jailed = null;
    let nearestFree = Infinity;
    let nearestJailed = Infinity;

    for (const { ally, node } of this.allyNodes) {
      if (ally.informed) continue; // 밀고자는 접선도 구출도 대상이 아니다
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

    if (found !== this.nearbyAlly || jailed !== this.nearbyJailed) {
      this.nearbyAlly = found;
      this.nearbyJailed = jailed;
      // 접선 대상이 우선 — 구출한 동료가 제자리로 돌아가는 동안 감옥 동료와 겹칠 수 있다.
      const target = found ?? jailed;
      if (target && !this.dialogue.isOpen) {
        this.dialogue.show(
          target.name,
          found
            ? `${found.name} — [E] 대화 · [F] 접선 코드`
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

  /** F — 접선: NPC 가 흘린 연상 단어(단서)를 밝혀 단서 수첩에 기록하고, 접선 코드 입력창을 연다. */
  async #offerCode(ally) {
    if (this.contacting) return;
    this.contacting = true;
    this.currentAllyId = ally.id;
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
      `"...「${contact.word}」."\n\n그가 흘린 단서다. [C] 단서 수첩에 기록됐다.\n접선 코드를 안다면 지금 건네라.`,
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

    const jailed = this.state.allies.filter((a) => a.arrested && !a.informed).length;
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
   * R — 구출 실행. 대가(경계 레벨·신뢰도) 계산은 전부 서버가 하고 여기선 결과만 반영한다.
   */
  async #rescue(ally) {
    if (this.rescuing) return;
    this.rescuing = true;
    this.proximityHint = false;
    this.dialogue.show(`${ally.name} (${ally.role})`, '창살 자물쇠를 조용히 비튼다...');

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
    const trust = `${'●'.repeat(freed.trust)}${'○'.repeat(freed.maxTrust - freed.trust)}`;
    this.dialogue.show(
      `${ally.name} (${ally.role})`,
      `${ally.name}이(가) 창살 밖으로 빠져나와 제자리로 돌아갔다.\n\n` +
        `소란이 새어 나갔다 — 경계 레벨 ${result.alertLevel}.\n` +
        `심문에 시달린 그는 겁에 질려 있다. 남은 신뢰: ${trust}\n\n` +
        `[F] 로 다시 접선할 수 있다. 그가 떠올린 단어는\n둘이 겹쳐 낸 만큼 확실한 단서다.`,
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
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
          allyId: this.currentAllyId,
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
        return;
      }

      this.#syncAllyNodes();

      if (result.informed) {
        this.dialogue.hideInput();
        this.dialogue.show(
          '밀고',
          `틀렸다. 동료의 신뢰를 완전히 잃었다.\n그는 당신을 밀고하고 사라졌다.\n\n경계 레벨이 올라갔다. (${this.state.alertLevel})`,
        );
      } else {
        this.dialogue.show(
          '접선 실패',
          `틀렸다. 동료가 의심스러운 눈으로 당신을 본다.\n남은 신뢰: ${'●'.repeat(result.trust)}${'○'.repeat(3 - result.trust)}`,
        );
      }
    } catch (err) {
      this.dialogue.show('오류', err.message);
    } finally {
      this.dialogue.setBusy(false);
    }
  }

  /**
   * this.state 를 노드에 반영한다 — 체포된 동료는 감옥으로 옮기고, 구출된 동료는 제자리로
   * 돌려보내고, 밀고된 동료는 흐리게.
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
      } else if (updated.informed) {
        entry.node.setTint(0xb87a3a).setAlpha(0.4);
        entry.label.setAlpha(0.4);
      }
    }
  }
}
