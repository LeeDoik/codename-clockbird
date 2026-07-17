import Phaser from 'phaser';
import { DialogueBox } from '../ui/DialogueBox.js';

/**
 * Stage 1 스켈레톤.
 *
 * 지금은 도형만 쓴다. 검증 대상은 그래픽이 아니라 데이터 흐름이다:
 *   서버가 생성한 연상 단어 → 접선 → 코드 입력 → 서버 판정 → 신뢰도/클리어
 * 타일맵·스프라이트·시야·순찰 NPC 는 W2~W3 에서 얹는다.
 */
const SPEED = 200;
const TALK_RANGE = 48;

export class StageScene extends Phaser.Scene {
  constructor() {
    super('Stage');
  }

  init(data) {
    this.state = data.state;
    this.nearbyAlly = null;
  }

  create() {
    this.dialogue = new DialogueBox();
    this.dialogue.onSend = (message) => this.#chat(message);
    this.dialogue.onCode = (guess) => this.#submitGuess(guess);

    this.#drawRoom();

    // 플레이어
    this.player = this.add.rectangle(460, 520, 20, 20, 0xe8dcc0);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);

    // 동료 NPC — 체포된 동료는 감옥 구역에 배치한다.
    this.allyNodes = [];
    let jailSlot = 0;
    for (const ally of this.state.allies) {
      const pos = ally.arrested
        ? { x: 80 + jailSlot++ * 44, y: 60 }
        : ally.spawn;

      const color = ally.arrested ? 0x6b4a4a : ally.informed ? 0x8a5a2a : 0x4a7a6b;
      const node = this.add.rectangle(pos.x, pos.y, 22, 22, color);
      const label = this.add
        .text(pos.x, pos.y - 22, ally.arrested ? `${ally.name} (체포)` : ally.name, {
          fontFamily: 'Malgun Gothic, sans-serif',
          fontSize: '11px',
          color: '#8a7f6a',
        })
        .setOrigin(0.5);

      this.allyNodes.push({ ally, node, label });
    }

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.keyE = this.input.keyboard.addKey('E');
    this.keySpace = this.input.keyboard.addKey('SPACE');

    this.hud = this.add.text(12, 10, '', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '12px',
      color: '#8a7f6a',
    });

    this.#updateHud();
  }

  #drawRoom() {
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width, height, 0x231f19);
    // 감옥 구역 표시
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
    this.hud.setText(
      `경계 레벨 ${this.state.alertLevel}   |   접선 가능 ${active.length}/5\n${trust.join('  ')}`,
    );
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
    if (!typing && Phaser.Input.Keyboard.JustDown(this.keySpace)) {
      this.dialogue.hide();
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
        this.dialogue.show(found.name, `[E] 를 눌러 ${found.name}에게 접선을 시도한다.`);
      } else if (!found) {
        this.dialogue.hide();
      }
    }
  }

  #talk(ally) {
    this.currentAllyId = ally.id;
    // 연상 단어는 스테이지 시작 시 이미 확정돼 있다. 접선 첫 마디로 그것부터 흘린다.
    this.dialogue.show(
      `${ally.name} (${ally.role})`,
      `"...「${ally.word}」."\n\n그는 그 한 마디만 남기고 입을 다물었다.`,
    );
    this.dialogue.showInput('말을 건넨다...');
    this.dialogue.setHint('[Enter] 대화 · [Space] 닫기');
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

      this.#refreshAllyNodes();

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

  #refreshAllyNodes() {
    for (const entry of this.allyNodes) {
      const updated = this.state.allies.find((a) => a.id === entry.ally.id);
      entry.ally = updated;
      if (updated.informed) {
        entry.node.setFillStyle(0x8a5a2a);
        entry.node.setAlpha(0.3);
        entry.label.setAlpha(0.3);
      }
    }
  }
}
