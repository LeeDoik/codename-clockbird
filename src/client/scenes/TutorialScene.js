import Phaser from 'phaser';
import { DialogueBox } from '../ui/DialogueBox.js';
import { SettingsPanel } from '../ui/SettingsPanel.js';
import { Hud } from '../ui/Hud.js';
import {
  buildColliders,
  createPlayer,
  createPlayerVisual,
  applyMovement,
  setupCameras,
  setWorldPaused,
  worldLabel,
  DEFAULT_CHAR_HEIGHT,
  WORLD_ZOOM,
} from '../world/worldParts.js';
import {
  PLAYER_ANIM,
  PLAYER_CONTENT_HEIGHT,
  PLAYER_FRAME_SIZE,
  PLAYER_ORIGIN_Y,
} from '../entities/playerSprite.js';
import {
  NPC_CONTENT_HEIGHT,
  NPC_FRAME_SIZE,
  NPC_ORIGIN_Y,
  NPC_TEXTURE,
} from '../entities/npcSprite.js';
import { InteractionManager } from '../world/interact.js';
import { readSSE, fetchStageStart } from '../net.js';
import { nameLabelStyle } from '../ui/theme.js';
import { TransitionScreen } from '../ui/TransitionScreen.js';
import { playBgm, setLoop } from '../audio/SoundManager.js';
import hqData from '../assets/hq.json';
import hqProps from '../assets/hq-props.json';

/**
 * 튜토리얼 — 강철 심장(IRON HEART) 본부.
 *
 * 여기엔 순찰도 검문도 감옥도 없다. 실패해도 판이 끝나지 않는다 (신뢰도만 깎인다).
 * 가르치는 것은 셋이다: 걷고, 말을 걸고, 겹치는 단어를 찾아 한 사람에게 건넨다.
 */
const TILE = hqData.tileSize;
const PLAYER_FRAME = 0;

// 플레이어(튜토리얼 전용 외형): 256×256 프레임, 인물은 y[0,176] 영역(실측) —
// 정수리가 프레임 맨 위에 닿아 있어 발-정수리 높이가 곧 인물 높이(176px)다.
// 화면에 얼마로 보일지는 맵이 정한다 (hq.json 의 charHeight).
/** 화면에 보일 인물 높이 — 맵이 정한다 (worldParts.DEFAULT_CHAR_HEIGHT 참고). */
const PLAYER_HEIGHT = hqData.charHeight ?? DEFAULT_CHAR_HEIGHT;

/** 이름표를 인물 머리 위 어디에 둘지 (월드 px, 발 기준) */
const LABEL_DY = PLAYER_HEIGHT + 8;

/**
 * NPC 한 명을 세운다 — PixelLab 남향 정지 그림.
 *
 * 인물마다 그림 속 키가 달라(91~98px) 배율을 따로 잡는다. 그래서 화면에서는
 * 넷이 정확히 같은 키(맵의 charHeight)로 선다. 발이 놓이는 선은 넷이 공유한다
 * (굽는 쪽에서 맞춰 두었다 — scripts/import-npc-sprites.js).
 */
function spawnNpc(scene, id, x, y) {
  const scale = PLAYER_HEIGHT / NPC_CONTENT_HEIGHT[id];
  return scene.add
    .image(x, y, NPC_TEXTURE[id])
    .setOrigin(0.5, NPC_ORIGIN_Y)
    .setDisplaySize(NPC_FRAME_SIZE * scale, NPC_FRAME_SIZE * scale);
}


/**
 * 인물 이름표 — 여기서 정한 규격을 거리·저택도 그대로 쓴다(ui/theme.nameLabelStyle).
 *
 * 숫자를 그 파일로 옮긴 것은 크기가 **화면 기준**이어야 하기 때문이다. 본부는 줌이
 * 1 이라 24px 이 화면에서도 24px 이지만, 거리는 줌 2 라 같은 24 를 적으면 화면 48px 로
 * 부푼다. 줌만 넘기면 어느 맵에서나 같은 크기로 나온다.
 */
const LABEL_STYLE = nameLabelStyle(hqData.cameraZoom ?? WORLD_ZOOM);

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
    // 스테이지 1 의 /start 가 실패했다 — ended 상태에서도 재시도를 열어 둔다 (#goStage).
    this.stageStartFailed = false;
  }

  create() {
    playBgm('tutorial');
    this.dialogue = new DialogueBox();
    this.dialogue.onSend = (message) => this.#chat(message);
    this.dialogue.onCode = (guess) => this.#submitGuess(guess);

    // 거리·저택·수로와 같은 방식 — 가구까지 한 장에 구운 배경을 1:1 로 깔고 충돌만 따로 세운다.
    this.add.image(0, 0, 'hq-bg').setOrigin(0, 0).setDepth(-100);
    this.walls = buildColliders(this, hqData, hqProps);
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
      PLAYER_FRAME_SIZE,
    );
    // 여기까지가 월드 — NPC 는 /start 응답 후에 생기므로 asWorld 로 따로 등록한다.
    // 줌은 나머지 세 맵과 같은 기본값(2)이다. 방(60×40칸)이 화면(30×17칸)보다 커서
    // 카메라가 플레이어를 따라다닌다 — 예전처럼 방 전체를 한 화면에 담지 않는다.
    setupCameras(this, hqData, this.player);
    this.interact = new InteractionManager(this, this.dialogue, PLAYER_HEIGHT);

    // 거리·저택·수로와 같은 진입 연출 — 씬이 바뀔 때마다 암전에서 밝아 온다
    // (2026-08-07 플레이테스트 피드백: 튜토리얼만 뚝 끊겨 나타났다).
    this.cameras.main.fadeIn(700, 0, 0, 0);
    this.uiCam?.fadeIn(700, 0, 0, 0);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.keyE = this.input.keyboard.addKey('E');
    this.keyF = this.input.keyboard.addKey('F');
    this.keySpace = this.input.keyboard.addKey('SPACE');
    this.keyEsc = this.input.keyboard.addKey('ESC');
    this.settings = new SettingsPanel();

    this.hud = new Hud();
    this.hud.status('강철 심장 본부 — 훈련');
    this.hud.keys('[E] 대화    [F] 접선 코드');
    this.transition = new TransitionScreen();

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
    this.officerNode = spawnNpc(this, 'officer', ox, oy);
    const officerLabel = worldLabel(
      this,
      ox,
      oy - LABEL_DY,
      `${this.state.officer.name} (${this.state.officer.role})`,
      LABEL_STYLE,
    );
    this.asWorld(this.officerNode, officerLabel);

    this.state.allies.forEach((ally, i) => {
      const sp = hqData.spawns.allies[i];
      const x = sp.col * TILE + TILE / 2;
      const y = sp.row * TILE + TILE / 2;

      const node = spawnNpc(this, ally.id, x, y);
      const label = worldLabel(this, x, y - LABEL_DY, ally.name, LABEL_STYLE);
      this.asWorld(node, label);

      this.allyNodes.push({ ally, node, label });
    });

    this.#syncAllies();

    // 인터랙션 노드 — 간부는 선택지 NPC(코드 제출 창구), 동료는 대화 NPC.
    this.interact.register({
      id: 'officer',
      type: 'choiceNpc',
      sprite: this.officerNode,
      speaker: `${this.state.officer.name} (${this.state.officer.role})`,
      line:
        '"셋의 말을 다 들었나?\n\n' +
        '각자 하나의 단어에 대해 이야기하지만, 다른 이야기를 하지,' +
        '세 갈래가 한 점에서 만난다 — 거기가 코드다.\n실전에서는 이렇게 친절하지 않겠지만"',
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

  /**
   * 머리 위 노드가 들고 있는 동료 정보를 서버가 방금 준 상태로 갈아 끼운다.
   *
   * **화면 갱신이 아니라 대사 갱신이다.** 오답을 내면 서버에서 동료의 신뢰도가 깎이고,
   * 0 이 되면 그 동료의 `line` 이 강화 힌트(reason)로 바뀌어 내려온다. 여기서 다시
   * 받아 두지 않으면 E 를 눌렀을 때 처음 받은 힌트를 계속 말한다.
   *
   * 신뢰도 자체는 머리 위에 표시하지 않는다 — ●●/●○/○○ 는 벌점처럼 읽히는데
   * 실제로는 반대로 "깎일수록 더 알려준다"는 장치라, 튜토리얼에서 오히려 헷갈렸다.
   * 장치는 서버에 그대로 있고 강화 힌트도 그대로 열린다.
   */
  #syncAllies() {
    for (const entry of this.allyNodes) {
      const live = this.state.allies.find((a) => a.id === entry.ally.id);
      if (live) entry.ally = live;
    }
  }

  #showBriefing() {
    this.dialogue.show(
      `${this.state.officer.name} (${this.state.officer.role})`,
      // 기획 설정서(2026-08-04 판) '캐릭터 대사' 시트의 브란트 — 튜토리얼 시작 대사.
      // 조작 안내 한 줄만 게임 쪽에서 덧붙였다(설정서에는 조작 설명이 없다).
      '"이번 임무는 알드리치 폰 바이스 백작의 저택에 잠입해, 백작을 괴롭히고 있다는 소문의 정체를 파악하는 일이다.\n\n' +
        '거리의 동료들이 잠입 경로를 확보하고 있으니, 합류할 수 있도록.\n' +
        '동료들과 접선하는 방식은 이미 알고 있겠지?\n\n' +
        '각자 동료들이 말하는 단서를 모아, 접선 암호가 무엇인지 유추한다.\n' +
        '고철 덩어리 놈들은 할 수 없는 방식이지!\n\n' +
        '준비되어 있는지 한번 확인해볼까?\n' +
        '[WASD] 로 걷고, 동료들과 대화한 후, 암호를 알 것 같다면 내게 오도록"',
      { portrait: this.state.officer.id },
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  update() {
    // ⚠ 걸음 소리는 매 프레임 setLoop('walk', moving) 로 유지되는 루프라, 조기 return
    // 하는 갈래는 전부 먼저 꺼야 한다 — 안 끄면 마지막 상태 그대로 계속 울린다
    // (2026-08-08 피드백, StageScene#update 머리말에 같은 규칙을 적어 뒀다). 본부는
    // #goStage 가 ended 를 세운 뒤 대사·페이드·로딩 화면이 흐르는데, 그 사이 내내
    // 발소리가 깔리던 자리다.
    if (this.ended) {
      setLoop('walk', false);
      // 스테이지 시작 실패 후 대기 중 — ended 라 아래 입력 처리가 전부 죽어 있으므로
      // 재시도만 여기서 받는다. 실패한 프로미스는 레지스트리에 굳어 있으니 새로 쏘고
      // 같은 길(#goStage)을 다시 걷는다. 이게 없으면 새로고침(=튜토리얼 처음부터)뿐이다.
      if (
        this.stageStartFailed &&
        (Phaser.Input.Keyboard.JustDown(this.keySpace) || Phaser.Input.Keyboard.JustDown(this.keyEsc))
      ) {
        this.stageStartFailed = false;
        this.registry.set('startPromise', fetchStageStart());
        this.#goStage();
      }
      return;
    }

    // 대화창이 열리는 순간 화면 전체가 얼어붙는다(2026-08-07 플레이테스트 피드백).
    setWorldPaused(this, this.dialogue.isOpen);

    const typing = this.dialogue.isTyping;
    let moving = false;
    if (this.dialogue.isOpen) this.player.body.setVelocity(0, 0);
    else moving = applyMovement(this.player, { cursors: this.cursors, wasd: this.wasd });
    setLoop('walk', moving);
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
    // [Esc] — 위에 덮인 것부터 걷는다: 대화창이 떠 있으면 그것을, 아니면 설정 창을 연다.
    // 입력칸에 글을 쓰는 중이면 여기까지 오지 않는다 (DialogueBox 가 직접 처리한다).
    if (pressedEsc) {
      if (this.dialogue.isOpen) this.dialogue.hide();
      else this.settings.openPaused(this, () => this.keyEsc.reset());
    }
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
    this.#syncAllies();

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
          ? '\n\n암호를 유추하기 어렵다면, 이번엔 왜 그 단어를 떠올렸지 대화해 보는 것도 방법이다.'
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
      // 기획 설정서(2026-08-04 판) '캐릭터 대사' 시트의 브란트 — 튜토리얼 완료 대사.
      `접선 코드는 「${codeWord}」 였다.\n\n` +
        '"좋아. 방법은 확실히 아는 것 같군.\n\n' +
        '하지만 실전에서는 이렇게 친절하지 않을 테니 정신 바짝 차리도록.\n\n' +
        '가라. 시계 수리공이 기다린다."',
      { portrait: this.state.officer.id },
    );
    this.time.delayedCall(2600, () => this.#goStage());
  }

  /**
   * 스테이지 1 로 — 페이드 아웃 → 로딩 화면 → (준비되면) 거리.
   *
   * Boot 가 쏘아 둔 fetch 는 튜토리얼이 도는 동안 대개 이미 끝나 있지만, 그래도 로딩
   * 화면(TransitionScreen)을 반드시 거친다: 끝나 있으면 한 박자짜리 전환 연출이 되고,
   * 아직이면(첫 판의 연상 단어 생성, 실측 11~20초) 그 대기가 "멈춤"이 아니라 "이동
   * 중"으로 읽히는 것이 이 화면의 존재 이유다. 예전에는 본부 화면이 굳은 채 구석의
   * 문구 한 줄이 전부라 게임이 죽은 것처럼 보였다.
   *
   * 걷는 것은 도착한 씬(StageScene)의 몫이다 — TransitionScreen 머리말 참고.
   */
  #goStage() {
    // 대화창·HUD 는 DOM 이라 카메라 페이드가 안 걸린다 — 같이 접는다.
    this.dialogue.hide();
    this.hud.fadeOut(600);
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.uiCam?.fadeOut(600, 0, 0, 0);

    this.cameras.main.once('camerafadeoutcomplete', async () => {
      this.transition.show('거리로 이동 중', '동료들의 암호를 수신하고 있다');

      // Boot 가 얹어둔 프로미스는 {state} 또는 {error} 로만 resolve 한다 (절대 reject 안 함).
      // 한 박자(900ms)는 로딩 화면의 최소 체류 시간이다 — 준비가 이미 끝나 있으면
      // 이 판이 한 프레임 번쩍하고 사라져 연출이 아니라 고장으로 보인다.
      const [res] = await Promise.all([
        Promise.resolve(this.registry.get('startPromise')),
        this.#beat(900),
      ]);

      if (!res || res.error) {
        // 본부로 되돌아와 오류를 읽게 한다 — 로딩 화면 위에 올리면 재시도 안내가
        // 로딩 판 아래 깔린다. ended 는 그대로 둔다(훈련은 이미 끝났다) — 재시도는
        // update() 의 ended 갈래가 stageStartFailed 로 받는다.
        this.transition.hide();
        this.hud.fadeIn(400);
        this.cameras.main.fadeIn(400, 0, 0, 0);
        this.uiCam?.fadeIn(400, 0, 0, 0);
        this.stageStartFailed = true;
        this.dialogue.show(
          '오류',
          `스테이지를 시작할 수 없습니다.\n${res?.error ?? '알 수 없는 오류'}\n\n` +
            '회선이 불안정할 수 있다 — [Space] 로 다시 시도한다.' +
            // 키 누락은 개발 환경에서만 있는 사고다 — 플레이어에게 .env 얘기를 하지 않는다.
            (import.meta.env.DEV ? '\n\n(개발: .env 의 ANTHROPIC_API_KEY 확인)' : ''),
        );
        return;
      }
      // 로딩 화면은 켠 채로 넘긴다 — StageScene 이 다 지어진 뒤 스스로 걷는다.
      this.scene.start('Stage', { state: res.state });
    });
  }

  /** 연출용 사이 — delayedCall 을 await 할 수 있게 감싼다 (StageScene#beat 과 같은 모양). */
  #beat(ms) {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
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
