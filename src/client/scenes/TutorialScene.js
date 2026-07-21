import Phaser from 'phaser';
import { DialogueBox } from '../ui/DialogueBox.js';
import { buildTilemap, createPlayer, applyMovement, nearestOf } from '../world/worldParts.js';
import { readSSE } from '../net.js';
import hqData from '../assets/hq.json';

/**
 * 튜토리얼 — 레지스탕스 본부.
 *
 * 여기엔 순찰도 검문도 감옥도 없다. 실패해도 판이 끝나지 않는다 (신뢰도만 깎인다).
 * 가르치는 것은 셋이다: 걷고, 말을 걸고, 겹치는 단어를 찾아 한 사람에게 건넨다.
 */
const TALK_RANGE = 48;
const TILE = hqData.tileSize;
const PLAYER_FRAME = 0;
// 간부·동료 전용 스프라이트는 아직 없다 — chars.png 의 기존 프레임을 빌려 쓴다 (아트는 W3).
const OFFICER_FRAME = 6;
const TUTOR_FRAME = { t1: 2, t2: 5, t3: 3 };

const LABEL_STYLE = {
  fontFamily: 'Malgun Gothic, sans-serif',
  fontSize: '11px',
  color: '#8a7f6a',
};

export class TutorialScene extends Phaser.Scene {
  constructor() {
    super('Tutorial');
  }

  init() {
    this.state = null;
    this.allyNodes = [];
    this.nearbyAlly = null;
    this.nearbyOfficer = false;
    // 지나가며 뜬 안내인가 — 이것만 사거리를 벗어날 때 자동으로 접는다.
    this.proximityHint = false;
    this.ended = false;
    // /start 가 실패했다 — [Space] 로 다시 시도할 수 있게 열어 둔다.
    this.startFailed = false;
  }

  create() {
    this.dialogue = new DialogueBox();
    this.dialogue.onSend = (message) => this.#chat(message);
    this.dialogue.onCode = (guess) => this.#submitGuess(guess);

    this.walls = buildTilemap(this, hqData);
    this.player = createPlayer(this, hqData, this.walls, PLAYER_FRAME);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.keyE = this.input.keyboard.addKey('E');
    this.keyF = this.input.keyboard.addKey('F');
    this.keySpace = this.input.keyboard.addKey('SPACE');
    this.keyEsc = this.input.keyboard.addKey('ESC');

    this.add.text(12, 10, '레지스탕스 본부 — 훈련', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '12px',
      color: '#8a7f6a',
    });
    this.add.text(12, this.scale.height - 22, '[E] 대화    [F] 접선 코드', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '11px',
      color: '#6b6152',
    });

    this.#start();
  }

  /** 세션을 연다. 힌트가 고정 세트라 LLM 대기가 없어 곧바로 돌아온다. */
  async #start() {
    try {
      const res = await fetch('/api/tutorial/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      this.state = data;
      this.startFailed = false;
    } catch (err) {
      this.startFailed = true;
      this.dialogue.show(
        '오류',
        `튜토리얼을 시작할 수 없습니다.\n${err.message}\n\n[Space] 로 다시 시도한다.`,
      );
      return;
    }

    this.#spawnNpcs();
    this.#showBriefing();
  }

  #spawnNpcs() {
    const os = hqData.spawns.officer;
    const ox = os.col * TILE + TILE / 2;
    const oy = os.row * TILE + TILE / 2;
    this.officerNode = this.add.sprite(ox, oy, 'chars', OFFICER_FRAME);
    this.add
      .text(ox, oy - 24, `${this.state.officer.name} (${this.state.officer.role})`, LABEL_STYLE)
      .setOrigin(0.5);

    this.state.allies.forEach((ally, i) => {
      const sp = hqData.spawns.allies[i];
      const x = sp.col * TILE + TILE / 2;
      const y = sp.row * TILE + TILE / 2;

      const node = this.add.sprite(x, y, 'chars', TUTOR_FRAME[ally.id] ?? i + 1);
      const label = this.add.text(x, y - 24, ally.name, LABEL_STYLE).setOrigin(0.5);
      // 신뢰도는 튜토리얼에만 있는 규칙이라 여기서만 화면에 세운다.
      const trust = this.add
        .text(x, y - 38, '', { ...LABEL_STYLE, fontSize: '12px', color: '#c9a227' })
        .setOrigin(0.5);

      this.allyNodes.push({ ally, node, label, trust });
    });

    this.#refreshTrust();
  }

  /** this.state 의 신뢰도를 동료 머리 위 표시(●●/●○/○○)에 반영한다. */
  #refreshTrust() {
    for (const entry of this.allyNodes) {
      const live = this.state.allies.find((a) => a.id === entry.ally.id);
      if (live) entry.ally = live;
      entry.trust.setText('●'.repeat(entry.ally.trust) + '○'.repeat(2 - entry.ally.trust));
    }
  }

  #showBriefing() {
    this.dialogue.show(
      `${this.state.officer.name} (${this.state.officer.role})`,
      '"거리에 나가기 전에 한 가지만 익히고 가라.\n\n' +
        '우리는 서로를 단어로 알아본다. 저기 셋이 같은 것을 두고 각자 다른 단어를 떠올렸다.\n' +
        '셋을 모아 겹치는 것 하나를 찾아내라 — 그게 접선 코드다.\n\n' +
        '[WASD] 로 걷고, 동료 앞에서 [E] 로 말을 건다.\n답을 찾으면 내 앞에서 [F]."',
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  update() {
    if (this.ended) return;

    const typing = this.dialogue.isTyping;
    if (typing) this.player.body.setVelocity(0, 0);
    else applyMovement(this.player, { cursors: this.cursors, wasd: this.wasd });

    // 응답을 기다리는 동안에도 상호작용을 열어 두면, 늦게 도착한 스트림이 그 사이 띄운
    // 다른 대사 위에 그대로 이어붙는다 (setBusy 가 입력칸을 blur 시켜 typing 이 풀리기 때문).
    const waiting = typing || this.dialogue.busy;

    // 키 상태는 대기 중에도 매 프레임 소비한다 — 단락 평가로 건너뛰면 눌린 채 남은 플래그가
    // 응답이 도착하는 프레임에 뒤늦게 발동한다.
    const pressedTalk = Phaser.Input.Keyboard.JustDown(this.keyE);
    const pressedCode = Phaser.Input.Keyboard.JustDown(this.keyF);
    const pressedSpace = Phaser.Input.Keyboard.JustDown(this.keySpace);
    const pressedEsc = Phaser.Input.Keyboard.JustDown(this.keyEsc);

    // 근접 안내도 대기 중에는 띄우지 않는다 — 지나가다 뜬 안내 위에 스트림이 이어붙는다.
    if (this.state && !waiting) this.#checkProximity();

    if (!waiting && !this.startFailed && pressedTalk) {
      if (this.nearbyAlly) this.#talk(this.nearbyAlly);
      else if (this.nearbyOfficer) this.#talkOfficer();
    }
    // F — 코드 입력은 간부 앞에서만 열린다 (스테이지 1의 접선책과 같은 규칙).
    if (!waiting && !this.startFailed && pressedCode) {
      if (this.nearbyOfficer) this.#offerCode();
      else {
        this.proximityHint = false;
        this.dialogue.show('접선 코드', '코드는 간부에게만 건넨다.\n간부 앞으로 가서 [F].');
        this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
      }
    }
    // 시작에 실패했다면 [Space] 는 창을 닫는 대신 재시도다 — 여기서 막히면 스테이지 1 까지 못 간다.
    if (this.startFailed && (pressedSpace || pressedEsc)) {
      this.startFailed = false;
      this.scene.restart();
      return;
    }
    if (!typing && pressedSpace) this.dialogue.hide();
    if (pressedEsc) this.dialogue.hide();
  }

  #checkProximity() {
    if (!this.officerNode) return;

    const ally = nearestOf(
      this.player,
      this.allyNodes.map((e) => ({ value: e.ally, x: e.node.x, y: e.node.y })),
      TALK_RANGE,
    );
    const officer = Boolean(
      nearestOf(
        this.player,
        [{ value: true, x: this.officerNode.x, y: this.officerNode.y }],
        TALK_RANGE,
      ),
    );

    if (ally === this.nearbyAlly && officer === this.nearbyOfficer) return;
    this.nearbyAlly = ally;
    this.nearbyOfficer = officer;

    if (ally && !this.dialogue.isOpen) {
      this.dialogue.show(ally.name, `${ally.name} (${ally.role}) — [E] 대화`);
      this.proximityHint = true;
    } else if (officer && !ally && !this.dialogue.isOpen) {
      const o = this.state.officer;
      this.dialogue.show(o.name, `${o.name} (${o.role}) — [E] 대화 · [F] 접선 코드`);
      this.proximityHint = true;
    } else if (!ally && !officer && this.proximityHint) {
      this.dialogue.hide();
      this.proximityHint = false;
    }
  }

  /** E — 동료. 고정 첫 대사(힌트)를 보이고 자유 입력을 연다. */
  #talk(ally) {
    this.currentAllyId = ally.id;
    this.proximityHint = false;
    const live = this.state.allies.find((a) => a.id === ally.id) ?? ally;
    this.dialogue.show(`${live.name} (${live.role})`, `"${live.line}"`);
    this.dialogue.showInput('더 물어본다...', 'chat');
    this.dialogue.setHint('[Enter] 대화 · [Esc] 닫기');
  }

  /** E — 간부. 고정 대사만 한다 (자유 대화는 동료에게서 배운다). */
  #talkOfficer() {
    const o = this.state.officer;
    this.proximityHint = false;
    this.dialogue.show(
      `${o.name} (${o.role})`,
      '"셋의 말을 다 들었나?\n\n' +
        '하나는 색을 말하고, 하나는 그것이 무엇으로 분류되는지를 말하고,\n' +
        '하나는 누구나 아는 이야기를 말한다.\n세 갈래가 한 점에서 만난다 — 거기가 코드다.\n\n' +
        '답을 찾았으면 [F]."',
    );
    this.dialogue.setHint('[F] 코드 전달 · [Space] 닫기');
  }

  /** F — 간부에게 코드를 건넨다. 입력창은 오직 여기서만 열린다. */
  #offerCode() {
    const o = this.state.officer;
    this.proximityHint = false;
    this.dialogue.show(`${o.name} (${o.role})`, '"…코드는?"');
    this.dialogue.showInput('접선 코드 입력...', 'code');
    this.dialogue.setHint('[Enter] 코드 전달 · [Esc] 취소');
  }

  /** 자유 대화 — 서버가 SSE 로 흘려보내는 응답을 델타 단위로 붙인다. */
  async #chat(message) {
    const ally = this.state.allies.find((a) => a.id === this.currentAllyId);
    if (!ally) return;

    this.dialogue.setBusy(true);
    this.dialogue.beginStream(`${ally.name} (${ally.role})`);

    try {
      const res = await fetch('/api/tutorial/talk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.state.sessionId,
          allyId: this.currentAllyId,
          message,
        }),
      });

      if (res.status === 404) {
        this.#restartSession();
        return;
      }

      // 실패는 SSE 가 아니라 JSON 으로 온다 (스트림 시작 전에 거절된 경우).
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      await readSSE(res, (payload) => {
        if (payload.type === 'text') this.dialogue.append(payload.text);
        else if (payload.type === 'error') throw new Error(payload.error);
      });
    } catch (err) {
      // 자유 대화는 "있으면 좋은 것"이다 — 실패하면 고정 첫 대사로 되돌려 진행을 막지 않는다.
      console.warn('[tutorial/talk]', err.message);
      this.dialogue.show(`${ally.name} (${ally.role})`, `"${ally.line}"\n\n(…그 이상은 말이 없다.)`);
    } finally {
      this.dialogue.setBusy(false);
    }
  }

  async #submitGuess(guess) {
    this.dialogue.setBusy(true);
    this.dialogue.show('...', `"${guess}"...`);

    let result;
    try {
      const res = await fetch('/api/tutorial/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.state.sessionId, guess }),
      });
      result = await res.json();
      if (res.status === 404) {
        this.#restartSession();
        return;
      }
      if (!res.ok) throw new Error(result.error ?? `HTTP ${res.status}`);
    } catch (err) {
      // 판정이 실패한 것뿐이다 — 서버도 신뢰도를 깎지 않았으니 오답으로 취급하지 않는다.
      console.warn('[tutorial/guess]', err.message);
      this.dialogue.show(
        `${this.state.officer.name} (${this.state.officer.role})`,
        '"…뭐라고? 다시 말해 보게."',
      );
      return;
    } finally {
      this.dialogue.setBusy(false);
    }

    this.state = result.state;
    this.#refreshTrust();

    if (result.correct) {
      this.#clear(result.codeWord);
      return;
    }
    if (result.replaced) {
      this.#onReplaced(result.officerLine);
      return;
    }

    const opened = this.state.allies.every((a) => a.opened);
    this.dialogue.show(
      `${this.state.officer.name} (${this.state.officer.role})`,
      '"틀렸다."\n\n동료들의 표정이 굳는다. 신뢰가 한 칸씩 깎였다.' +
        (opened
          ? '\n\n다시 물어보면, 이번엔 왜 그 단어를 떠올렸는지까지 말해 줄 것이다.'
          : '\n\n동료들에게 다시 물어보고 오너라.'),
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  /** 누적 3회 실패 — 간부 앞으로 불려 가 코드를 갈아 치운다. */
  #onReplaced(officerLine) {
    this.dialogue.hideInput();
    const os = hqData.spawns.officer;
    // 간부 바로 아래 칸으로 옮긴다 — "불려 갔다"는 연출이자, 다음 [F] 가 바로 닿는 자리다.
    this.player.body.reset(os.col * TILE + TILE / 2, (os.row + 1) * TILE + TILE / 2);
    this.proximityHint = false;
    this.dialogue.show(
      `${this.state.officer.name} (${this.state.officer.role})`,
      `"${officerLine}"`,
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  #clear(codeWord) {
    this.ended = true;
    this.player.body.setVelocity(0, 0);
    this.dialogue.hideInput();
    this.dialogue.setHint('');
    this.dialogue.show(
      `${this.state.officer.name} (${this.state.officer.role})`,
      `접선 코드는 「${codeWord}」 였다.\n\n` +
        '"이제 알겠지. 거리에서도 방식은 같다.\n\n가라. 시계 수리공이 기다린다."',
    );
    this.time.delayedCall(2600, () => this.#goStage());
  }

  /** 스테이지 1 로. Boot 가 쏘아 둔 fetch 는 튜토리얼이 도는 동안 이미 끝나 있다. */
  #goStage() {
    const waiting = this.add
      .text(this.scale.width / 2, this.scale.height / 2, '거리로 나가는 중…', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '15px',
        color: '#8a7f6a',
      })
      .setOrigin(0.5)
      .setDepth(51);

    // Boot 가 얹어둔 프로미스는 {state} 또는 {error} 로만 resolve 한다 (절대 reject 안 함).
    Promise.resolve(this.registry.get('startPromise')).then((res) => {
      if (!res || res.error) {
        waiting.destroy();
        this.dialogue.show(
          '오류',
          `스테이지 시작 실패\n${res?.error ?? '알 수 없는 오류'}\n\n.env 에 ANTHROPIC_API_KEY 를 넣었는지 확인하세요.`,
        );
        return;
      }
      this.dialogue.hide();
      this.scene.start('Stage', { state: res.state });
    });
  }

  /**
   * 세션이 사라졌다 (서버 재시작 등) — 씬을 다시 시작해 새 세션을 연다.
   * scene.restart 는 init() 부터 다시 돌아 상태·노드가 모두 초기화된다.
   */
  #restartSession() {
    this.dialogue.hideInput();
    this.dialogue.show('본부', '…연결이 끊겼다.\n\n처음부터 다시 브리핑을 받는다.');
    this.time.delayedCall(1400, () => this.scene.restart());
  }
}
