import Phaser from 'phaser';
import { DialogueBox } from '../ui/DialogueBox.js';
import {
  buildColliders,
  createPlayer,
  createPlayerVisual,
  applyMovement,
  setupCameras,
} from '../world/worldParts.js';
import { InteractionManager } from '../world/interact.js';
import { readSSE } from '../net.js';
import { CSS, FONTS } from '../ui/theme.js';
import hqData from '../assets/hq.json';
import hqProps from '../assets/hq-props.json';

/**
 * 튜토리얼 — 레지스탕스 본부.
 *
 * 여기엔 순찰도 검문도 감옥도 없다. 실패해도 판이 끝나지 않는다 (신뢰도만 깎인다).
 * 가르치는 것은 셋이다: 걷고, 말을 걸고, 겹치는 단어를 찾아 한 사람에게 건넨다.
 */
const TILE = hqData.tileSize;
const PLAYER_FRAME = 0;

// 배경 가구가 캐릭터 대비 크다 — 그림을 0.3배로 줄여 깔고(hq.json 의 tileSize 도
// 32→9.6으로 같은 비율로 줄여 가구·충돌 칸 인덱스는 그대로 유지), 캐릭터(고정
// 픽셀 크기)는 손대지 않아 상대적으로 커 보이게 한다.
const BG_SCALE = 0.3;
// 방이 작아서 스크롤이 필요 없다 — 방 전체 높이(rows*TILE)가 내부 해상도
// 1080px 에 꼭 맞는 배율로 고정해 카메라가 플레이어를 따라다니지 않고
// 방 전체를 계속 보여주게 한다(세로 기준: 가로 1920 에 맞추면 위아래가
// 잘린다 — 방 가로세로비가 화면보다 좁아서 좌우에 약간의 여백이 남는 대신
// 위아래는 절대 안 잘리는 쪽을 택했다).
const CAMERA_ZOOM = 1080 / (hqData.rows * hqData.tileSize);

// 브란트(간부) 아이들 모션: 432×432 프레임, 인물은 그 안의 대략 x[66,360]·
// y[18,426] 영역을 차지한다(대표 프레임 실측 — 프레임마다 자세가 살짝 달라
// ±수 px 흔들리는 건 아이들 모션 자체다). 발-정수리 높이가 1.75타일(56px)이
// 되도록, 인물 실제 높이(408px) 기준으로 프레임 전체를 함께 축소한다.
const OFFICER_FRAME = 432;
const OFFICER_CONTENT_HEIGHT = 408;
const OFFICER_HEIGHT = 56;
const OFFICER_SCALE = OFFICER_HEIGHT / OFFICER_CONTENT_HEIGHT;
const OFFICER_ORIGIN_Y = 426 / OFFICER_FRAME;

// 동료 3인(레나·미아·오토) 아이들 모션: 256×256 프레임. 발 위치(216px)는 셋 다
// 같지만 인물 키(정수리 위치)는 캐릭터마다 달라 실측치로 따로 잡는다.
const ALLY_FRAME = 256;
const ALLY_CONTENT_BOTTOM = 216;
const ALLY_ORIGIN_Y = ALLY_CONTENT_BOTTOM / ALLY_FRAME;
const ALLY_CONTENT_TOP = { t1: 26, t2: 58, t3: 26 };
const ALLY_ANIM = { t1: 't1Idle', t2: 't2Idle', t3: 't3Idle' };

// 플레이어(튜토리얼 전용 외형): 256×256 프레임, 인물은 y[0,176] 영역(실측) —
// 정수리가 프레임 맨 위에 닿아 있어 발-정수리 높이가 곧 인물 높이(176px)다.
// 다른 캐릭터와 같은 1.75타일(56px)로 맞춘다.
const PLAYER_ANIM = {
  idle: 'tutorialPlayerIdle',
  walkDown: 'tutorialPlayerWalkDown',
  walkUp: 'tutorialPlayerWalkUp',
  walkLeft: 'tutorialPlayerWalkLeft',
};
const PLAYER_ORIGIN_Y = 176 / 256;
const PLAYER_CONTENT_HEIGHT = 176;
const PLAYER_HEIGHT = 56;

const LABEL_STYLE = {
  fontFamily: FONTS.body,
  fontSize: '11px',
  color: CSS.paperDim,
};

export class TutorialScene extends Phaser.Scene {
  constructor() {
    super('Tutorial');
  }

  init() {
    this.state = null;
    this.allyNodes = [];
    this.ended = false;
    // /start 가 실패했다 — [Space] 로 다시 시도할 수 있게 열어 둔다.
    this.startFailed = false;
  }

  create() {
    this.dialogue = new DialogueBox();
    this.dialogue.onSend = (message) => this.#chat(message);
    this.dialogue.onCode = (guess) => this.#submitGuess(guess);

    // 거리·저택과 같은 방식 — 바닥·벽·가구·조명을 한 장에 구운 배경을 깔고
    // 충돌만 따로 세운다 (scripts/gen-hq-art.js).
    this.add.image(0, 0, 'hq-bg').setOrigin(0, 0).setScale(BG_SCALE).setDepth(-100);
    this.walls = buildColliders(this, hqData, hqProps.blocked);
    this.player = createPlayer(this, hqData, this.walls, PLAYER_FRAME);
    // 충돌 판정은 이 안 보이는 스프라이트가 그대로 맡고, 화면에는 방향 애니메이션이
    // 있는 별도 그림(playerVisual)을 얹어 위치만 따라가게 한다.
    this.player.setVisible(false);
    this.playerVisual = createPlayerVisual(
      this,
      this.player,
      PLAYER_ANIM,
      PLAYER_ORIGIN_Y,
      PLAYER_CONTENT_HEIGHT,
      PLAYER_HEIGHT,
    );
    // 여기까지가 월드 — NPC 는 /start 응답 후에 생기므로 asWorld 로 따로 등록한다.
    setupCameras(this, hqData, this.player, CAMERA_ZOOM);
    // 방 전체가 한 화면에 들어오므로 따라다닐 필요가 없다 — 방 한가운데 고정한다.
    this.cameras.main.stopFollow();
    this.cameras.main.centerOn((hqData.cols * hqData.tileSize) / 2, (hqData.rows * hqData.tileSize) / 2);
    this.interact = new InteractionManager(this, this.dialogue);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.keyE = this.input.keyboard.addKey('E');
    this.keyF = this.input.keyboard.addKey('F');
    this.keySpace = this.input.keyboard.addKey('SPACE');
    this.keyEsc = this.input.keyboard.addKey('ESC');

    this.asUi(
      this.add.text(20, 16, '레지스탕스 본부 — 훈련', {
        fontFamily: FONTS.body,
        fontSize: '22px',
        color: CSS.paperDim,
      }),
      this.add.text(20, this.scale.height - 40, '[E] 대화    [F] 접선 코드', {
        fontFamily: FONTS.body,
        fontSize: '20px',
        color: CSS.faint,
      }),
    );

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
      // 브리핑이 바로 이어진다 — 간부 얼굴은 그 전에 받아 둬야 늦게 붙지 않는다.
      this.dialogue.preload([this.state.officer.id, ...this.state.allies.map((a) => a.id)]);
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
    this.officerNode = this.add
      .sprite(ox, oy, 'officerIdle', 0)
      .setOrigin(0.5, OFFICER_ORIGIN_Y)
      .setDisplaySize(OFFICER_FRAME * OFFICER_SCALE, OFFICER_FRAME * OFFICER_SCALE)
      .play('officerIdle');
    const officerLabel = this.add
      .text(ox, oy - 64, `${this.state.officer.name} (${this.state.officer.role})`, LABEL_STYLE)
      .setOrigin(0.5);
    this.asWorld(this.officerNode, officerLabel);

    this.state.allies.forEach((ally, i) => {
      const sp = hqData.spawns.allies[i];
      const x = sp.col * TILE + TILE / 2;
      const y = sp.row * TILE + TILE / 2;

      const contentHeight = ALLY_CONTENT_BOTTOM - ALLY_CONTENT_TOP[ally.id];
      const scale = OFFICER_HEIGHT / contentHeight;
      const node = this.add
        .sprite(x, y, ALLY_ANIM[ally.id], 0)
        .setOrigin(0.5, ALLY_ORIGIN_Y)
        .setDisplaySize(ALLY_FRAME * scale, ALLY_FRAME * scale)
        .play(ALLY_ANIM[ally.id]);
      const label = this.add.text(x, y - 64, ally.name, LABEL_STYLE).setOrigin(0.5);
      // 신뢰도는 튜토리얼에만 있는 규칙이라 여기서만 화면에 세운다.
      const trust = this.add
        .text(x, y - 78, '', { ...LABEL_STYLE, fontSize: '12px', color: CSS.brass })
        .setOrigin(0.5);
      this.asWorld(node, label, trust);

      this.allyNodes.push({ ally, node, label, trust });
    });

    this.#refreshTrust();

    // 인터랙션 노드 — 간부는 선택지 NPC(코드 제출 창구), 동료는 대화 NPC.
    this.interact.register({
      id: 'officer',
      type: 'choiceNpc',
      sprite: this.officerNode,
      speaker: `${this.state.officer.name} (${this.state.officer.role})`,
      line:
        '"셋의 말을 다 들었나?\n\n' +
        '하나는 색을 말하고, 하나는 그것이 무엇으로 분류되는지를 말하고,\n' +
        '하나는 누구나 아는 이야기를 말한다.\n세 갈래가 한 점에서 만난다 — 거기가 코드다."',
      portrait: this.state.officer.id,
      choices: [
        { label: '암호 말하기', key: 'F' },
        { label: '그만하기', key: 'Esc' },
      ],
      onChoice: (key) => {
        if (key === 'F') this.#offerCode();
        else this.dialogue.hide();
      },
    });

    for (const entry of this.allyNodes) {
      this.interact.register({
        id: entry.ally.id,
        type: 'choiceNpc',
        sprite: entry.node,
        speaker: `${entry.ally.name} (${entry.ally.role})`,
        line: `"${entry.ally.line}"`,
        portrait: entry.ally.id,
        choices: [
          { label: '대화하기', key: 'E' },
          { label: '그만하기', key: 'Esc' },
        ],
        onChoice: (key) => {
          if (key === 'E') this.#talk(entry.ally);
          else this.dialogue.hide();
        },
      });
    }
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
      // 스토리보드(튜토리얼 본부 맵.dc.html) 의 chiefBrief 를 옮겼다.
      '"브루주아 대저택에 심상치 않은 일이 있다는 소식이다.\n\n' +
        '거리의 동료들이 잠입 방법을 준비해 뒀다고 한다. 동료를 만나 접선 코드를 말하고 합류해라.\n' +
        '동료들이 말하는 단어들을 조합해서 접선 코드를 유추해라. 로봇들은 알 수 없는 방법이지.\n\n' +
        '준비되어 있는지 한번 확인해볼까? 여기 동료들과 대화로 코드를 유추해 봐.\n' +
        '[WASD] 로 걷고, 동료 앞에서 [E]. 답을 찾으면 내 앞에서 [F]."',
      { portrait: this.state.officer.id },
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  update() {
    if (this.ended) return;

    const typing = this.dialogue.isTyping;
    if (typing) this.player.body.setVelocity(0, 0);
    else applyMovement(this.player, { cursors: this.cursors, wasd: this.wasd });
    this.playerVisual.update();

    // 응답을 기다리는 동안에도 상호작용을 열어 두면, 늦게 도착한 스트림이 그 사이 띄운
    // 다른 대사 위에 그대로 이어붙는다 (setBusy 가 입력칸을 blur 시켜 typing 이 풀리기 때문).
    const waiting = typing || this.dialogue.busy;

    // 키 상태는 대기 중에도 매 프레임 소비한다 — 단락 평가로 건너뛰면 눌린 채 남은 플래그가
    // 응답이 도착하는 프레임에 뒤늦게 발동한다.
    const pressedTalk = Phaser.Input.Keyboard.JustDown(this.keyE);
    const pressedCode = Phaser.Input.Keyboard.JustDown(this.keyF);
    const pressedSpace = Phaser.Input.Keyboard.JustDown(this.keySpace);
    const pressedEsc = Phaser.Input.Keyboard.JustDown(this.keyEsc);

    // 말풍선·최근접 노드 갱신 — 대화 중이거나 대기 중이면 레이어가 알아서 감춘다.
    if (this.state) this.interact.update(this.player, { suppress: waiting });

    if (!waiting && !this.startFailed && pressedTalk) {
      if (this.dialogue.isOpen && !this.dialogue.hasMore && this.dialogue.onChoice) {
        // 선택지가 떠 있으면 E = "대화하기" 선택
        this.dialogue.onChoice('E');
      } else if (this.dialogue.isOpen) {
        this.dialogue.advance();
      } else {
        this.interact.trigger();
      }
    }
    // F — 코드 입력은 간부 앞에서만 열린다 (스테이지 1의 접선책과 같은 규칙).
    if (!waiting && !this.startFailed && pressedCode) {
      if (this.interact.current?.id === 'officer') this.#offerCode();
      else {
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
    if (!typing && pressedSpace) this.dialogue.advance();
    if (pressedEsc) this.dialogue.hide();
  }

  /** 선택지 "대화하기" — 자유 입력을 연다 (기본 대사는 레이어가 이미 띄웠다). */
  #talk(ally) {
    this.currentAllyId = ally.id;
    this.dialogue.hideChoices();
    this.dialogue.showInput('더 물어본다...', 'chat');
    this.dialogue.setHint('[Enter] 대화 · [Esc] 닫기');
  }

  /** F — 간부에게 코드를 건넨다. 입력창은 오직 여기서만 열린다. */
  #offerCode() {
    const o = this.state.officer;
    this.dialogue.hideChoices();
    this.dialogue.show(`${o.name} (${o.role})`, '"…코드는?"', { portrait: o.id });
    this.dialogue.showInput('접선 코드 입력...', 'code');
    this.dialogue.setHint('[Enter] 코드 전달 · [Esc] 취소');
  }

  /** 자유 대화 — 서버가 SSE 로 흘려보내는 응답을 델타 단위로 붙인다. */
  async #chat(message) {
    const ally = this.state.allies.find((a) => a.id === this.currentAllyId);
    if (!ally) return;

    this.dialogue.setBusy(true);
    this.dialogue.beginStream(`${ally.name} (${ally.role})`, { portrait: ally.id });

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
      this.dialogue.endStream('[Enter] 계속 묻기 · [Esc] 닫기');
    } catch (err) {
      // 자유 대화는 "있으면 좋은 것"이다 — 실패하면 고정 첫 대사로 되돌려 진행을 막지 않는다.
      console.warn('[tutorial/talk]', err.message);
      this.dialogue.reply(
        `${ally.name} (${ally.role})`,
        `"${ally.line}"\n\n(…그 이상은 말이 없다.)`,
        '',
        { portrait: ally.id },
      );
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
      this.dialogue.reply(
        `${this.state.officer.name} (${this.state.officer.role})`,
        '"…뭐라고? 다시 말해 보게."',
        '',
        { portrait: this.state.officer.id },
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
    this.dialogue.reply(
      `${this.state.officer.name} (${this.state.officer.role})`,
      '"틀렸다."\n\n동료들의 표정이 굳는다. 신뢰가 한 칸씩 깎였다.' +
        (opened
          ? '\n\n다시 물어보면, 이번엔 왜 그 단어를 떠올렸는지까지 말해 줄 것이다.'
          : '\n\n동료들에게 다시 물어보고 오너라.'),
      '[Space] / [Esc] 로 닫는다',
      { portrait: this.state.officer.id },
    );
  }

  /** 누적 3회 실패 — 간부 앞으로 불려 가 코드를 갈아 치운다. */
  #onReplaced(officerLine) {
    this.dialogue.hideInput();
    const os = hqData.spawns.officer;
    // 간부 바로 아래 칸으로 옮긴다 — "불려 갔다"는 연출이자, 다음 [F] 가 바로 닿는 자리다.
    this.player.body.reset(os.col * TILE + TILE / 2, (os.row + 1) * TILE + TILE / 2);
    // 창을 닫아 뒀더라도 이건 띄운다 — 갑자기 순간이동당한 이유를 설명하는 유일한 대사다.
    this.dialogue.show(
      `${this.state.officer.name} (${this.state.officer.role})`,
      `"${officerLine}"`,
      { portrait: this.state.officer.id },
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  #clear(codeWord) {
    this.ended = true;
    this.player.body.setVelocity(0, 0);
    this.dialogue.hideInput();
    this.dialogue.setHint('');
    // 창을 닫아 뒀더라도 이건 띄운다 — 코드를 밝히는 대사이고, 곧 씬이 넘어간다.
    this.dialogue.show(
      `${this.state.officer.name} (${this.state.officer.role})`,
      `접선 코드는 「${codeWord}」 였다.\n\n` +
        '"이제 알겠지. 거리에서도 방식은 같다.\n\n가라. 시계 수리공이 기다린다."',
      { portrait: this.state.officer.id },
    );
    this.time.delayedCall(2600, () => this.#goStage());
  }

  /** 스테이지 1 로. Boot 가 쏘아 둔 fetch 는 튜토리얼이 도는 동안 이미 끝나 있다. */
  #goStage() {
    const waiting = this.add
      .text(this.scale.width / 2, this.scale.height / 2, '거리로 나가는 중…', {
        fontFamily: FONTS.body,
        fontSize: '28px',
        color: CSS.paperDim,
      })
      .setOrigin(0.5)
      .setDepth(51);
    this.asUi(waiting);

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
