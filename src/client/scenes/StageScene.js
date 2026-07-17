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
    // 개발용 정답 보기 (백틱 ` 키로 토글, REVEAL_ANSWER=1 일 때만 서버가 응답)
    this.debugAnswer = null;
    this.answerShown = false;
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
      const pos = ally.arrested
        ? { x: 80 + this.jailCount++ * 44, y: 60 }
        : sp
          ? { x: sp.col * TILE + TILE / 2, y: sp.row * TILE + TILE / 2 }
          : ally.spawn;

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

      this.allyNodes.push({ ally, node, label, jailed: ally.arrested });
    });

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.keyE = this.input.keyboard.addKey('E');
    this.keyF = this.input.keyboard.addKey('F');
    this.keySpace = this.input.keyboard.addKey('SPACE');
    this.keyEsc = this.input.keyboard.addKey('ESC');
    this.keyReveal = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.BACKTICK);

    this.hud = this.add.text(12, 10, '', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '12px',
      color: '#8a7f6a',
    });

    this.#updateHud();
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
  }

  #checkProximity() {
    let found = null;
    for (const { ally, node } of this.allyNodes) {
      if (ally.arrested || ally.informed) continue;
      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y, node.x, node.y,
      );
      if (dist < TALK_RANGE) { found = ally; break; }
    }

    if (found !== this.nearbyAlly) {
      this.nearbyAlly = found;
      if (found && !this.dialogue.isOpen) {
        this.dialogue.show(found.name, `[E] 대화 · [F] 접선 코드 전달 — ${found.name}`);
      } else if (!found) {
        this.dialogue.hide();
      }
    }
  }

  async #talk(ally) {
    if (this.contacting) return;
    this.contacting = true;
    this.currentAllyId = ally.id;
    this.dialogue.show(`${ally.name} (${ally.role})`, '접선하는 중...');

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

    // 접선으로 상태가 바뀌었을 수 있다 (중복 확인 → 체포).
    this.state = contact.state;
    this.#syncAllyNodes();
    this.#updateHud();

    const newlyArrested = contact.newlyArrested ?? [];
    const selfArrested = newlyArrested.includes(ally.id);

    // 연상 단어를 밝힌다. (접선하기 전엔 알 수 없던 정보)
    if (selfArrested) {
      // 접선한 이 동료의 단어가 이미 접선한 다른 동료와 겹쳐, 그 자리에서 체포됐다.
      const others = newlyArrested
        .filter((id) => id !== ally.id)
        .map((id) => this.state.allies.find((a) => a.id === id)?.name)
        .filter(Boolean);
      this.dialogue.hideInput();
      this.dialogue.setHint('');
      this.dialogue.show(
        `${ally.name} (${ally.role})`,
        `"...「${contact.word}」."\n\n그 단어를 입에 올리는 순간, ${
          others.length ? `${others.join('·')}과(와) ` : ''
        }같은 패턴이 드러났다.\n정체가 노출되어 그 자리에서 붙잡혀 갔다.`,
      );
      return;
    }

    this.dialogue.show(
      `${ally.name} (${ally.role})`,
      `"...「${contact.word}」."\n\n그는 그 한 마디만 남기고 입을 다물었다.`,
    );
    this.dialogue.showInput('말을 건넨다...');
    this.dialogue.setHint('[Enter] 대화 · [Esc] 닫기');
  }

  /** F — 근처 동료에게 곧바로 접선 코드를 건넨다 (대화 없이 코드 입력창을 연다). */
  #offerCode(ally) {
    this.currentAllyId = ally.id;
    this.dialogue.show(
      `${ally.name} (${ally.role})`,
      '접선 코드를 건넨다...\n\n조심스럽게 암호를 말할 준비를 한다.',
    );
    this.dialogue.showInput('접선 코드 입력...', 'code');
    this.dialogue.setHint('[Enter] 코드 전달 · [Esc] 취소');
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

  /** this.state 를 노드에 반영한다 — 체포된 동료는 감옥으로 옮기고, 밀고된 동료는 흐리게. */
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
      } else if (updated.informed) {
        entry.node.setTint(0xb87a3a).setAlpha(0.4);
        entry.label.setAlpha(0.4);
      }
    }
  }
}
