import Phaser from 'phaser';
import { DialogueBox } from '../ui/DialogueBox.js';
import { Hud } from '../ui/Hud.js';
import { ClueBook } from '../ui/ClueBook.js';
import { ResultOverlay } from '../ui/ResultOverlay.js';
import { MinigamePanel } from '../ui/MinigamePanel.js';
import { runLockPuzzle } from '../minigames/lockPuzzle.js';
import { runTimingLock } from '../minigames/timingLock.js';
import { runInterrogation } from '../minigames/interrogation.js';
import { Patrol, PATROL_ROUTES, REINFORCE_AT } from '../entities/Patrol.js';
import {
  buildColliders,
  createPlayer,
  createPlayerVisual,
  applyMovement,
  setupCameras,
  worldLabel,
  DEFAULT_CHAR_HEIGHT,
} from '../world/worldParts.js';
import { InteractionManager } from '../world/interact.js';
import { readSSE } from '../net.js';
import { CSS, FONTS } from '../ui/theme.js';
// 타일 스튜디오(tools/tilemap-studio.html)로 만들어 내보낸 맵. Vite 가 JSON 을 파싱해 객체로 준다.
import mapData from '../assets/map.json';
import streetProps from '../assets/street-props.json';

/**
 * Stage 1.
 *
 * 데이터 흐름(연상 단어 → 접선 → 코드 입력 → 서버 판정 → 경계/클리어)은 그대로 두고,
 * 배경을 타일맵으로 교체했다. solid 타일에는 정적 충돌 바디가 붙어 플레이어를 막는다.
 * 시야·순찰 NPC 는 W3 에서 얹는다.
 */
const SPEED = 200;
/** 자석 수류탄 시작 개수 (스토리보드 p16 — 다 쓰면 게임오버) */
const GRENADES_START = 2;
/** 검문이 끝난 뒤 다시 잡히지 않는 시간. 서버의 checkpointCooldownUntil 과 같은 값이어야 한다. */
const CHECKPOINT_COOLDOWN_MS = 10_000;
const TILE = mapData.tileSize; // 32

// chars.png 스프라이트시트 프레임 — 동료 id → 프레임 (personas.json 순서)
const ALLY_FRAME = { watchmaker: 1, maid: 2, engineer: 3, smuggler: 4, musician: 5 };
const PLAYER_FRAME = 0;
const CITIZEN_FRAME = 6;
// 접선책은 시민과 같은 프레임을 쓴다 — 전용 스프라이트는 에셋 확장 때 교체한다.
const BROKER_FRAME = 6;

// 전용 아이들 모션이 있는 동료. 여기 없는 동료는 위 chars.png 프레임으로 폴백한다 —
// 밀수꾼(smuggler)은 캐릭터 바이블의 밀수업자가 여성(실비아)이라 카이와 성별이 어긋나
// 보류 중이고, 접선책은 대응 아트 자체가 없다 (design/characters/portrait-map.md).
const ALLY_ANIM = {
  watchmaker: 'watchmakerIdle',
  maid: 'maidIdle',
  engineer: 'engineerIdle',
  musician: 'musicianIdle',
};
// 네 시트 모두 256×256 프레임 안에서 발이 218px, 정수리가 23px 에 있다
// (scripts/measure-sprite.js 실측). 발바닥을 스폰 지점에 놓고 — 플레이어·튜토리얼과
// 같은 규칙 — 인물 높이를 이 씬의 기존 캐릭터 크기(32px)에 맞춘다.
const ALLY_SPRITE_FRAME = 256;
const ALLY_SPRITE_ORIGIN_Y = 218 / ALLY_SPRITE_FRAME;
const ALLY_SPRITE_SCALE = 32 / 196;
// 이름표는 정수리 위에 둔다. chars.png 동료는 스프라이트 중심이 스폰 지점이라 -24 로
// 충분하지만, 전용 스프라이트는 발이 스폰 지점이라 인물 높이만큼 더 올려야 한다.
const ALLY_LABEL_DY = -24;
const ALLY_SPRITE_LABEL_DY = -40;

/**
 * 플레이어는 튜토리얼부터 엔딩까지 **같은 인물**이다 (2026-08-02 확정).
 * 스테이지마다 다른 스프라이트를 쓰면 사람이 바뀐 것처럼 보인다.
 *
 * 앞의 두 상수는 **그 시트 안에서 인물이 어디 있는가**라 시트를 바꾸면 같이 바뀐다
 * (tutorial 시트 실측값 — TutorialScene 과 동일).
 * PLAYER_HEIGHT 만 이 씬 고유다: 그건 **이 맵에서 화면에 얼마로 보일지**이고,
 * 여기서는 다른 NPC(chars.png, 32px 무배율)와 키를 맞춘다.
 */
const PLAYER_ANIM = {
  idle: 'tutorialPlayerIdle',
  walkDown: 'tutorialPlayerWalkDown',
  walkUp: 'tutorialPlayerWalkUp',
  walkLeft: 'tutorialPlayerWalkLeft',
  walkRight: 'tutorialPlayerWalkRight',
};
const PLAYER_ORIGIN_Y = 176 / 256;
const PLAYER_CONTENT_HEIGHT = 176;
/** 화면에 보일 인물 높이 — 맵이 정한다 (worldParts.DEFAULT_CHAR_HEIGHT 참고). */
const PLAYER_HEIGHT = mapData.charHeight ?? DEFAULT_CHAR_HEIGHT;

export class StageScene extends Phaser.Scene {
  constructor() {
    super('Stage');
  }

  init(data) {
    this.state = data.state;
    // 개발용 정답 보기 (백틱 ` 키로 토글, REVEAL_ANSWER=1 일 때만 서버가 응답)
    this.debugAnswer = null;
    this.answerShown = false;
    // 단서 수첩 — 첫 대화(자동 접선)로 얻은 NPC → 연상 단어. (C 키로 열람)
    this.clues = new Map();
    // [F] 암호 말하기로 코드를 건넬 대상 id (지금은 접선책 고정, Task 14 에서 전 동료로 확대)
    this.codeTargetId = null;
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
    // 자석 수류탄 — 적발에서 빠져나갈 수단. 0 이 되면 다음 적발이 곧 게임오버다.
    this.grenades = GRENADES_START;
  }

  create() {
    this.dialogue = new DialogueBox();
    this.dialogue.onSend = (message) => this.#chat(message);
    this.dialogue.onCode = (guess) => this.#submitGuess(guess);
    // 이 판에 나올 얼굴은 정해져 있다 — 첫 접선에서 그림이 늦게 붙지 않게 미리 받는다.
    this.dialogue.preload([...this.state.allies.map((a) => a.id), this.state.broker.id]);
    this.result = new ResultOverlay();
    this.result.hide(); // 재시작으로 다시 들어온 경우 이전 판의 결과 화면을 걷어낸다
    this.minigame = new MinigamePanel();
    // 이전 판이 미니게임 도중에 끝났다면 그 판을 접는다 (타이머가 유령으로 남는다).
    this.minigame.abort?.();

    this.#buildMap();

    this.player = createPlayer(this, mapData, this.walls, PLAYER_FRAME);
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

    // 동료 NPC — 위치는 맵의 스폰 포인트를 순서대로 따른다 (없으면 서버 spawn 으로 폴백).
    // 체포된 동료는 감옥 구역에 배치한다.
    this.allyNodes = [];
    this.jailCount = 0; // 감옥에 들어간 동료 수 (체포 시 슬롯 번호로 쓴다)
    this.state.allies.forEach((ally, i) => {
      // id 로 먼저 찾는다 — 자리마다 직업이 맞물려 있어서(시계공은 목공소 뒷마당,
      // 기관사는 정거장…) 서버가 순서를 바꿔 보내도 배치가 어긋나면 안 된다.
      const sp = mapData.spawns.allies.find((s) => s.id === ally.id) ?? mapData.spawns.allies[i];
      // 구출하면 이 자리로 되돌려 보내야 하므로, 감옥에서 시작하는 동료의 원래 자리도 기억해 둔다.
      const home = sp ? { x: sp.col * TILE + TILE / 2, y: sp.row * TILE + TILE / 2 } : ally.spawn;
      const pos = ally.arrested ? this.#jailSlot(this.jailCount++) : home;

      const anim = ALLY_ANIM[ally.id];
      const node = anim
        ? this.add
            .sprite(pos.x, pos.y, anim, 0)
            .setOrigin(0.5, ALLY_SPRITE_ORIGIN_Y)
            .setDisplaySize(
              ALLY_SPRITE_FRAME * ALLY_SPRITE_SCALE,
              ALLY_SPRITE_FRAME * ALLY_SPRITE_SCALE,
            )
            .play(anim)
        : this.add.sprite(pos.x, pos.y, 'chars', ALLY_FRAME[ally.id] ?? i + 1);
      if (ally.arrested) node.setTint(0x9a9088);

      const labelDy = anim ? ALLY_SPRITE_LABEL_DY : ALLY_LABEL_DY;
      const label = worldLabel(
        this,
        pos.x,
        pos.y + labelDy,
        ally.arrested ? `${ally.name} (체포)` : ally.name,
        { fontFamily: FONTS.body, fontSize: '11px', color: CSS.paperDim },
      );

      // labelDy 는 감옥행·구출 연출에서 이름표를 다시 놓을 때도 쓴다 (#syncAllyNodes).
      this.allyNodes.push({ ally, node, label, labelDy, home, jailed: ally.arrested });
    });

    // 접선책 — 코드를 건넬 유일한 창구. 단어를 내지 않으므로 체포·중복 판정과 무관하다.
    const bz = mapData.spawns.broker;
    const bpos = bz
      ? { x: bz.col * TILE + TILE / 2, y: bz.row * TILE + TILE / 2 }
      : this.state.broker.spawn;
    this.brokerNode = this.add.sprite(bpos.x, bpos.y, 'chars', BROKER_FRAME);
    worldLabel(this, bpos.x, bpos.y - 24, this.state.broker.name, {
      fontFamily: FONTS.body,
      fontSize: '11px',
      color: CSS.paperDim,
    });

    this.#buildSteam();
    this.#buildPlayerLight();
    this.#spawnPatrols();
    // 여기까지가 월드 — 이후의 HUD·수첩·도움말은 UI 카메라 소속이다.
    // (경계 상승으로 나중에 붙는 증원 순찰은 #maybeReinforce 가 asWorld 로 등록한다.)
    setupCameras(this, mapData, this.player);
    this.interact = new InteractionManager(this, this.dialogue);
    this.#registerInteractables();

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.keyE = this.input.keyboard.addKey('E');
    this.keyF = this.input.keyboard.addKey('F');
    this.keyR = this.input.keyboard.addKey('R');
    this.keySpace = this.input.keyboard.addKey('SPACE');
    this.keyEsc = this.input.keyboard.addKey('ESC');
    this.keyReveal = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.BACKTICK);
    this.keyClues = this.input.keyboard.addKey('C');

    // 디버그(백틱) 표시의 이유 문장이 길어도 #hud-status 가 오른쪽 여백에서 접는다.
    this.hud = new Hud();
    this.hud.keys('[E] 대화    [F] 암호    [R] 구출    [C] 단서 수첩');

    // 수첩도 HUD 와 같은 이유로 DOM 이다 (ui/ClueBook.js). 생성자가 닫힌 상태로
    // 되돌리므로 재시작한 판이 이전 판의 펼친 수첩을 물려받지 않는다.
    this.clueBook = new ClueBook();

    this.#updateHud();
    this.#showBriefing();
  }

  /** 인터랙션 노드 등록. 체포 상태가 바뀌면 #syncAllyNodes 가 재등록한다. */
  #registerInteractables() {
    for (const entry of this.allyNodes) this.#registerAllyNode(entry);

    this.interact.register({
      id: 'broker',
      type: 'choiceNpc',
      sprite: this.brokerNode,
      speaker: `${this.state.broker.name} (${this.state.broker.role})`,
      line: '태엽 감는 소리 사이로 짧은 한마디.\n"동료들의 단어에서 겹치는 것을 찾아라. 그게 코드다."',
      portrait: this.state.broker.id,
      choices: [
        { label: '암호 말하기', key: 'F' },
        { label: '그만하기', key: 'Esc' },
      ],
      onChoice: (key) => {
        if (key === 'F') this.#offerCode(this.state.broker);
        else this.dialogue.hide();
      },
    });
  }

  #registerAllyNode(entry) {
    const ally = entry.ally;
    if (ally.arrested) {
      this.interact.register({
        id: entry.ally.id,
        type: 'object', // E 로는 반응하지 않는 자리 표시 — R 전용
        sprite: entry.node,
        bubble: '[R] 구출',
        onInteract: () => this.#tryRescue(),
      });
      return;
    }
    this.interact.register({
      id: ally.id,
      type: 'choiceNpc',
      sprite: entry.node,
      speaker: `${ally.name} (${ally.role})`,
      line: this.clues.has(ally.id)
        ? `"…내 단어는 이미 건넸다. 「${this.clues.get(ally.id).word}」."`
        : `${ally.name}이(가) 주위를 살피더니 낮게 말한다.\n"…조직에서 왔군."`,
      portrait: ally.id,
      choices: [
        { label: '대화하기', key: 'E' },
        { label: '암호 말하기', key: 'F' },
        { label: '그만하기', key: 'Esc' },
      ],
      onChoice: (key) => {
        if (key === 'E') this.#talk(ally);
        else if (key === 'F') this.#offerCode(ally);
        else this.dialogue.hide();
      },
    });
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

    for (const route of [PATROL_ROUTES.avenue, PATROL_ROUTES.crossing, PATROL_ROUTES.wharf]) {
      this.patrols.push(new Patrol(this, route));
    }
    if (this.state.alertLevel >= REINFORCE_AT) {
      this.patrols.push(new Patrol(this, PATROL_ROUTES.reinforce));
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
    const p = new Patrol(this, PATROL_ROUTES.reinforce);
    // 카메라 분리(setupCameras) 이후에 태어나는 월드 오브젝트라 소속을 직접 밝힌다.
    this.asWorld(p.sprite, p.cone);
    p.resume({ graceMs: 2000 });
    this.patrols.push(p);
  }

  /** 진입 쪽지 — 코드 힌트(글자 수·카테고리)와 붙잡힌/남은 동료 수를 알린다. */
  #showBriefing() {
    const total = this.state.allies.length;
    const arrested = this.state.allies.filter((a) => a.arrested).length;
    const remain = total - arrested;

    const lines = ['품 안에 조직이 남긴 쪽지가 잡힌다.\n'];
    if (this.state.hint) {
      lines.push(`코드는 ${this.state.hint.length}글자 — ${this.state.hint.category} 쪽 단어다.\n`);
    }
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
    if (remain > 0) lines.push(`\n남은 ${remain}명에게 [E] 대화해 단서를 모으고, 겹치는 단어(코드)를 추리해 시계 수리공에게 건네라.`);
    if (arrested > 0) {
      lines.push(
        `\n감옥(좌측 상단) 창살 앞에서 [R] — 붙잡힌 동료를 빼낼 수 있다.\n소란은 새어 나가 경계 레벨이 오르지만, 그가 떠올린 단어는\n둘이 겹쳐서 잡혀갈 만큼 확실한 단서다.`,
      );
    }
    lines.push('\n[E] 대화(첫 대화 = 접선) · [F] 암호 말하기 · [R] 구출 · [C] 단서 수첩');

    this.dialogue.show('접선 지령', lines.join('\n'));
    this.dialogue.setHint('[Space] / [Esc] 로 쪽지를 접는다');
  }

  /** C — 수첩 여닫기. 펼치는 순간에 다시 채운다 (덮어 둔 사이 단서가 늘었을 수 있다). */
  #toggleClues() {
    if (this.clueBook.isOpen) {
      this.clueBook.close();
      return;
    }
    this.#refreshClues();
    this.clueBook.open();
  }

  #refreshClues() {
    // 힌트는 단서 유무와 무관한 고정 머리줄 — 빈 수첩에서도 보인다.
    const hint = this.state.hint;
    const head = hint ? `접선 코드: ${'○'.repeat(hint.length)} (${hint.category})\n\n` : '';
    if (this.clues.size === 0) {
      this.clueBook.setText(`${head}아직 수집한 단서가 없다.\n\n동료에게 다가가 [E] 로 말을 걸면,\n그가 흘린 연상 단어가 여기 기록된다.`);
      return;
    }
    const lines = [];
    for (const { name, role, word, rescued } of this.clues.values()) {
      lines.push(`· ${name} (${role})\n     「${word}」${rescued ? '   ← 둘이 겹쳐 낸 단어' : ''}`);
    }
    lines.push(`\n수집한 단서 ${this.clues.size}개 — 이 단어들로 접선 코드를 추리하라.`);
    this.clueBook.setText(head + lines.join('\n'));
  }

  /**
   * 타일맵 렌더 + 충돌.
   * map.json 의 layout 을 깔고, solid 타일은 정적 물리 바디로 만들어 플레이어를 막는다.
   * 정적 그룹의 create 는 보이는 스프라이트와 정적 바디를 한 번에 만든다.
   */
  /**
   * 플레이어가 든 등불.
   *
   * 배경의 조명은 구워져 있어 가로등 사이가 어둡다. 밤거리로는 맞지만, 그 어둠 속을
   * 걸을 때 발밑이 안 보이면 길찾기가 답답해진다. 인물을 따라다니는 빛을 하나 얹어
   * "내가 선 자리만 밝다"를 만든다 — 어둠을 걷어내지 않으면서 갈 곳은 보이게 한다.
   *
   * ADD 합성이라 배경 위에 더해진다. 곱하기로 하면 어두운 자갈이 더 어두워질 뿐이다.
   */
  #buildPlayerLight() {
    if (!this.textures.exists('player-light')) {
      const R = 108;
      const g = this.make.graphics({ add: false });
      // 32단으로 끊어 그린다 — 도트 화면에 매끄러운 그라디언트를 얹으면 그 부분만
      // 해상도가 달라 보인다. 계단진 빛이 오히려 어울린다.
      for (let i = 32; i > 0; i--) {
        const t = i / 32;
        // 밝기는 낮게. 이 빛은 어둠을 걷어내는 것이 아니라 발밑을 알려 주는 정도여야
        // 한다 — 세게 주면 구운 배경의 등불 웅덩이가 통째로 묻힌다.
        g.fillStyle(0xffe2b0, 0.016 * (1 - t) ** 1.8);
        g.fillCircle(R, R, R * t);
      }
      g.generateTexture('player-light', R * 2, R * 2);
      g.destroy();
    }

    this.playerLight = this.add
      .image(this.player.x, this.player.y, 'player-light')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(4);
  }

  /**
   * 길바닥 배출구에서 오르는 김.
   *
   * 배경에 굽지 않는 이유는 김이 움직여야 김이기 때문이다 — 정지된 흰 얼룩은
   * 그냥 얼룩이고, 증기 도시라는 인상은 그것이 흔들릴 때 생긴다.
   * 자리는 아트 스크립트가 배출구를 그린 곳 그대로다 (street-props.json).
   */
  #buildSteam() {
    if (!this.textures.exists('steam')) {
      const g = this.make.graphics({ add: false });
      g.fillStyle(0xffffff, 1);
      g.fillRect(2, 0, 4, 8);
      g.fillRect(0, 2, 8, 4);
      g.fillRect(1, 1, 6, 6);
      g.generateTexture('steam', 8, 8);
      g.destroy();
    }

    for (const [i, [x, y]] of (streetProps.vents ?? []).entries()) {
      const em = this.add.particles(x, y, 'steam', {
        speedY: { min: -30, max: -14 },
        speedX: { min: -13, max: 13 },
        scale: { start: 0.6, end: 3.1 },
        alpha: { start: 0.34, end: 0 },
        lifespan: { min: 1800, max: 3200 },
        // 배출구마다 주기를 달리한다 — 같은 박자로 뿜으면 기계 장치처럼 보인다.
        frequency: 300 + (i % 4) * 130,
        quantity: 1,
        tint: 0xdfe4e8,
      });
      // setupCameras 앞에서 만들어지므로 월드 소속으로 자동 분류된다.
      em.setDepth(6);
    }
  }

  /** 감옥 안에서 체포된 동료가 서는 자리. 슬롯마다 오른쪽으로 밀린다. */
  #jailSlot(n) {
    const j = mapData.spawns.jail;
    return { x: j.col * TILE + TILE / 2 + n * j.step, y: j.row * TILE + TILE / 2 };
  }

  #buildMap() {
    // 거리는 저택과 같은 방식이다 — 자갈·건물·나무·가로등·조명을 한 장에 구워
    // 배경으로 깔고 충돌만 따로 세운다 (scripts/gen-street-art.js).
    this.add.image(0, 0, 'street-bg').setOrigin(0, 0).setDepth(-100);
    this.walls = buildColliders(this, mapData, streetProps);

    // 마을 사람 다섯 — 분기 대사는 W3 TODO. 지금은 맵이 지정한 자리에 세워만 둔다.
    for (const [i, z] of (mapData.spawns.citizens ?? []).entries()) {
      const x = z.col * TILE + TILE / 2;
      const y = z.row * TILE + TILE / 2;
      this.add.sprite(x, y, 'chars', CITIZEN_FRAME);
      worldLabel(this, x, y - 24, `마을 사람 ${i + 1}`, {
        fontFamily: FONTS.body,
        fontSize: '11px',
        color: CSS.paperDim,
      });
    }

    // 감옥은 이제 배경에 창살과 자물쇠까지 그려져 있다 — 자리를 알리는 이름표만 얹는다.
    const cage = mapData.cage;
    worldLabel(this, (cage.x + cage.w / 2) * TILE, (cage.y - 0.6) * TILE, '임시 감옥', {
      fontFamily: FONTS.body,
      fontSize: '12px',
      color: '#8a5a5a', // 감옥 표시색 — 테마 토큰 아님 (여기서만 쓴다)
    });
  }

  #updateHud() {
    // 상태가 바뀔 때마다 반드시 지나가는 길목이라, 증원 판정도 여기서 함께 본다.
    this.#maybeReinforce();

    const active = this.state.allies.filter((a) => !a.arrested);
    const lines = [
      `경계 레벨 ${this.state.alertLevel} / 3   |   접선 가능 ${active.length}/${this.state.allies.length}` +
        `   |   자석 수류탄 ${'◆'.repeat(this.grenades)}${'◇'.repeat(GRENADES_START - this.grenades)}`,
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
    this.hud.status(lines.join('\n'));
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
   * 판을 **패배로** 끝내고 결과 화면을 띄운다.
   *
   * 클리어는 여기로 오지 않는다 — 코드를 맞히면 결과 화면 대신 저택으로 이어진다
   * (#toMansion). 이야기가 계속되는 자리에 창을 덮으면 흐름이 끊긴다.
   *
   * 게임오버는 즉시 덮는다 — 진 이유는 이미 대사로 나왔고, 늘어질수록 다시 하기 싫어진다.
   *
   * @param {'caught'|'spotted'} outcome
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
      this.playerVisual.update();
      return;
    }

    if (this.#updatePatrols(delta)) {
      this.player.body.setVelocity(0, 0);
      this.playerVisual.update();
      this.#startCheckpoint();
      return;
    }

    // 대화창 입력 중에는 이동을 막는다.
    const typing = this.dialogue.isTyping;

    if (typing) {
      this.player.body.setVelocity(0, 0);
    } else {
      applyMovement(this.player, { cursors: this.cursors, wasd: this.wasd, speed: SPEED });
    }
    this.playerVisual.update();

    // 등불은 인물을 그대로 따라간다 (물리 바디가 아니라 표시용이라 매 프레임 위치만 맞춘다).
    this.playerLight?.setPosition(this.player.x, this.player.y);

    // 응답을 기다리는 동안에도 상호작용을 열어 두면, 늦게 도착한 스트림이 그 사이 띄운
    // 다른 대사 위에 그대로 이어붙는다 (setBusy 가 입력칸을 blur 시켜 typing 이 풀리기 때문).
    const waiting = typing || this.dialogue.busy;

    // 키 상태는 대기 중에도 매 프레임 소비한다 — 단락 평가로 건너뛰면 눌린 채 남은 플래그가
    // 응답이 도착하는 프레임에 뒤늦게 발동한다.
    const pressedTalk = Phaser.Input.Keyboard.JustDown(this.keyE);
    const pressedContact = Phaser.Input.Keyboard.JustDown(this.keyF);
    const pressedRescue = Phaser.Input.Keyboard.JustDown(this.keyR);
    const pressedSpace = Phaser.Input.Keyboard.JustDown(this.keySpace);
    const pressedClues = Phaser.Input.Keyboard.JustDown(this.keyClues);

    // 말풍선·최근접 노드 갱신 — 대기 중이거나 대화 중이면 레이어가 알아서 감춘다.
    this.interact.update(this.player, { suppress: waiting });

    if (!waiting && pressedTalk) {
      if (this.dialogue.isOpen && !this.dialogue.hasMore && this.dialogue.onChoice) {
        this.dialogue.onChoice('E');
      } else if (this.dialogue.isOpen && !this.dialogue.isTyping) {
        this.dialogue.advance();
      } else if (!this.dialogue.isOpen) {
        this.interact.trigger();
      }
    }
    // F — 선택지가 떠 있으면 "암호 말하기" 선택, 아니면 (튜토리얼과 같은 조작으로)
    // 코드를 받는 상대 앞에서 바로 입력창을 연다.
    if (!waiting && pressedContact) {
      if (this.dialogue.isOpen && this.dialogue.onChoice) {
        this.dialogue.onChoice('F');
      } else if (!this.dialogue.isOpen && this.interact.current) {
        const cur = this.interact.current;
        const target =
          cur.id === 'broker'
            ? this.state.broker
            : this.state.allies.find((a) => a.id === cur.id && !a.arrested);
        if (target) this.#offerCode(target);
      }
    }
    // R — 감옥의 동료 구출. 대상이 없어도 눌리게 둔다 (어디로 가야 하는지 알려주기 위해).
    if (!waiting && pressedRescue) {
      this.#tryRescue();
    }
    if (!typing && pressedSpace) {
      this.dialogue.advance();
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
    if (!typing && pressedClues) {
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
      if (outcome === 'caught') this.#useGrenade();
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

  /** 연출용 사이 — delayedCall 을 await 할 수 있게 감싼다. */
  #beat(ms) {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  /**
   * 스테이지 1 클리어 → 저택 잠입 (스테이지 2).
   *
   * 결과 화면을 띄우지 않는다. 여기는 판이 끝나는 자리가 아니라 **이야기가 이어지는
   * 자리**라, 창을 하나 덮어 흐름을 끊으면 "한 판 더?"로 읽힌다 (계획서 §4.3 마지막 줄
   * — 클리어 → 저택 잠입 연결 연출).
   *
   * 연결 대사의 화자는 요른이다. 스토리보드 수정안 p.19 에서 이 대사의 화자가
   * 비어 있던 것을 시계 수리공으로 확정했고, 그가 곧 스테이지 2 의 동행이 된다.
   */
  async #toMansion(codeWord) {
    if (this.ended) return;
    this.ended = true; // update() 를 멈춘다 — 이후는 연출 시간이다
    this.player.body.setVelocity(0, 0);
    for (const p of this.patrols) p.halt();
    // 펼쳐 둔 수첩을 여기서 접는다. C 가 이미 막힌 뒤라 플레이어가 닫을 방법이 없고,
    // 수첩은 DOM 이라 아래의 카메라 페이드가 걸리지 않아 저택까지 따라온다.
    this.clueBook.close();

    const b = this.state.broker;
    this.dialogue.show(
      `${b.name} (${b.role})`,
      `접선 코드는 「${codeWord}」 였다.\n\n"…맞군. 늦지 않아서 다행이야."`,
      { portrait: b.id },
    );
    await this.#beat(2600);

    this.dialogue.show(
      `${b.name} (${b.role})`,
      '"저택에서 시계 수리공을 구한다더군. 너는 내 보조로 같이 간다.\n\n' +
        '내가 괘종시계를 붙들고 시간을 끄는 동안, 안에 있는 동료를 찾아 정보를 받아 와."',
      { portrait: b.id },
    );
    await this.#beat(4200);

    this.dialogue.hide();
    // 월드와 HUD 를 함께 접는다 — 메인 카메라만 어둡게 하면 HUD 가 허공에 뜬다.
    this.cameras.main.fadeOut(900, 0, 0, 0);
    this.uiCam?.fadeOut(900, 0, 0, 0);
    this.hud.fadeOut(900); // HUD 는 DOM 이라 카메라 페이드가 안 걸린다
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Mansion'));
  }

  /**
   * 자석 수류탄 — 검문에 적발됐을 때의 마지막 수단 (스토리보드 p16, 계획서 §4.3).
   *
   * 강한 자기장으로 로봇의 구동부를 잠깐 붙여 놓고 그 틈에 빠져나간다.
   * 두 개로 시작하고, **다 쓰면 게임오버**다 — "게임오버 = 자석 수류탄 소진"이
   * 이 스테이지의 패배 조건이다. 적발 자체가 즉사가 아니라, 빠져나갈 수단이
   * 남아 있느냐가 판을 가른다.
   *
   * ※ 지금은 클라이언트가 개수를 센다. 판이 끝나면 세션도 끝나 되돌릴 여지가 없어
   *   당장 문제는 없지만, 서버 권위가 원칙이므로 세션으로 옮기는 것이 옳다 (후속).
   */
  #useGrenade() {
    if (this.grenades <= 0) {
      this.dialogue.show(
        '검문 적발',
        '주머니를 더듬었지만 아무것도 잡히지 않는다.\n\n' +
          '자석 수류탄이 없다. 로봇의 팔이 어깨를 붙든다.',
      );
      this.#endGame('caught', { delay: 1800 });
      return;
    }

    this.grenades -= 1;
    this.#updateHud();

    // 자기장이 터지는 순간 — 화면이 한 번 희게 튀고 로봇들이 굳는다.
    this.cameras.main.flash(220, 210, 230, 255);
    this.cameras.main.shake(180, 0.006);
    for (const p of this.patrols) p.halt();

    this.dialogue.show(
      '자석 수류탄',
      '진술이 받아들여지지 않았다. 팔이 뻗어 오는 순간, 주머니의 수류탄을 굴렸다.\n\n' +
        '푸른 섬광. 로봇의 관절이 서로 들러붙어 굳는다. 그 틈에 골목으로 몸을 던졌다.\n\n' +
        `경계 레벨 ${this.state.alertLevel}/3   ·   남은 수류탄 ${this.grenades}개` +
        (this.grenades === 0 ? '\n\n이제 다음은 없다.' : ''),
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
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

  /**
   * 선택지 "대화하기".
   *
   * 첫 대화는 접선을 겸한다 — /contact 로 연상 단어를 밝혀 수첩에 기록한 뒤
   * 자유 입력을 연다 (스펙 §2: [F] 는 "암호 말하기"로 넘어갔다).
   * 중복 판정(체포)도 이 첫 접촉 시점에 갱신된다 — 기존 F 접선과 같은 시점이다.
   */
  async #talk(ally) {
    this.currentAllyId = ally.id;
    this.dialogue.hideChoices();

    if (!this.clues.has(ally.id)) {
      this.dialogue.setBusy(true);
      this.dialogue.show(`${ally.name} (${ally.role})`, '조심스럽게 접선을 시도한다...', {
        portrait: ally.id,
      });

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
        this.dialogue.reply('오류', err.message);
        return;
      } finally {
        this.dialogue.setBusy(false);
      }

      this.state = contact.state;
      this.#recordClue(ally, contact.word);
      this.#syncAllyNodes();

      // 단어 공개는 두 페이지다 — 입력창은 다 읽은 뒤에 연다. 바로 열면
      // 포커스가 페이지 넘김([Space])을 막아 둘째 페이지에 영영 못 간다.
      this.dialogue.reply(
        `${ally.name} (${ally.role})`,
        `"...「${contact.word}」."\n\n그가 흘린 단서다. [C] 단서 수첩에 기록됐다.`,
        '[Space] 다음',
        {
          portrait: ally.id,
          onPagesDone: () => {
            this.dialogue.showInput('말을 건넨다...', 'chat');
            this.dialogue.setHint('[Enter] 대화 · [Esc] 닫기');
          },
        },
      );
      return;
    }

    this.dialogue.showInput('말을 건넨다...', 'chat');
    this.dialogue.setHint('[Enter] 대화 · [Esc] 닫기');
  }

  /** 선택지 "암호 말하기" — 코드 입력창을 연다. */
  #offerCode(target) {
    this.codeTargetId = target.id;
    this.dialogue.hideChoices();
    this.dialogue.show(
      `${target.name} (${target.role})`,
      '상대가 눈을 들지 않은 채 낮게 묻는다.\n"…코드는?"',
      { portrait: target.id },
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
    if (this.clueBook.isOpen) this.#refreshClues();
  }

  /**
   * R — 구출 시도.
   * 감옥 앞이 아니면 어디로 가야 하는지 알려준다. 감옥이 비었으면 그렇다고 말해 준다
   * (아무 반응도 없으면 키가 먹은 건지 대상이 없는 건지 플레이어가 구분할 수 없다).
   */
  #tryRescue() {
    const cur = this.interact.current;
    const jailedEntry =
      cur && this.allyNodes.find((e) => e.ally.id === cur.id && e.jailed);
    if (jailedEntry) {
      this.#rescue(jailedEntry.ally);
      return;
    }
    const jailed = this.state.allies.filter((a) => a.arrested).length;
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
        { portrait: ally.id },
      );
      this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
      return;
    }

    this.rescuing = true;
    this.dialogue.setBusy(true);
    this.dialogue.show(`${ally.name} (${ally.role})`, '자물쇠가 풀렸다. 창살을 밀어 젖힌다...', {
      portrait: ally.id,
    });

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
      this.dialogue.reply('오류', err.message);
      return;
    } finally {
      this.rescuing = false;
      this.dialogue.setBusy(false);
    }

    this.state = result.state;
    this.#syncAllyNodes();
    this.#updateHud();

    const freed = this.state.allies.find((a) => a.id === ally.id);
    this.dialogue.reply(
      `${ally.name} (${ally.role})`,
      `${freed.name}이(가) 창살 밖으로 빠져나와 제자리로 돌아갔다.\n\n` +
        `소란이 새어 나갔다 — 경계 레벨 ${result.alertLevel}.\n\n` +
        `[E] 대화로 다시 접선할 수 있다. 그가 떠올린 단어는\n둘이 겹쳐 낸 만큼 확실한 단서다.`,
      '[Space] / [Esc] 로 닫는다',
      { portrait: ally.id },
    );
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
    this.dialogue.beginStream(`${ally.name} (${ally.role})`, { portrait: ally.id });

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

      await readSSE(res, (payload) => {
        if (payload.type === 'text') this.dialogue.append(payload.text);
        else if (payload.type === 'error') throw new Error(payload.error);
      });
      this.dialogue.endStream('[Enter] 계속 · [Esc] 닫기');
    } catch (err) {
      this.dialogue.reply('오류', err.message);
    } finally {
      this.dialogue.setBusy(false);
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
          targetId: this.codeTargetId ?? this.state.broker.id,
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
        this.#toMansion(result.codeWord);
        return;
      }

      this.#syncAllyNodes();

      const target =
        this.state.allies.find((a) => a.id === this.codeTargetId) ?? this.state.broker;
      const maxed = this.state.alertLevel >= 3;
      this.dialogue.reply(
        '접선 실패',
        `틀렸다. ${target.name}이(가) 말없이 고개를 젓는다.\n거리에 소문이 샌다 — 경계 레벨 ${this.state.alertLevel}/3.` +
          (maxed ? '\n\n거리가 끓고 있다. 이제 발각되면 검문도 없이 끝난다.' : ''),
        '',
        { portrait: target.id },
      );
    } catch (err) {
      this.dialogue.reply('오류', err.message);
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
        const { x, y } = this.#jailSlot(this.jailCount++);
        entry.node.setTint(0x9a9088); // 붙잡혀 색이 죽는다
        entry.label.setText(`${updated.name} (체포)`).setColor(CSS.paperDim);
        // 감옥으로 끌려가는 연출
        this.tweens.add({ targets: entry.node, x, y, duration: 350, ease: 'Cubic.easeIn' });
        this.tweens.add({
          targets: entry.label,
          x,
          y: y + entry.labelDy,
          duration: 350,
          ease: 'Cubic.easeIn',
        });
      } else if (!updated.arrested && entry.jailed) {
        // 구출 — 감옥행 연출을 되감는다. 끌려갈 때 easeIn 이었으니 풀려날 땐 easeOut.
        entry.jailed = false;
        const { x, y } = entry.home;
        entry.node.clearTint();
        entry.label.setText(updated.name);
        this.tweens.add({ targets: entry.node, x, y, duration: 350, ease: 'Cubic.easeOut' });
        this.tweens.add({
          targets: entry.label,
          x,
          y: y + entry.labelDy,
          duration: 350,
          ease: 'Cubic.easeOut',
        });
      }
      // 체포↔자유 전환 시 인터랙션 노드도 유형이 바뀐다 (choiceNpc ↔ R 전용)
      this.#registerAllyNode(entry);
    }
  }
}
