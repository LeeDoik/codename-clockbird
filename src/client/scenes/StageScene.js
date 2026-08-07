import Phaser from 'phaser';
import { DialogueBox } from '../ui/DialogueBox.js';
import { SettingsPanel } from '../ui/SettingsPanel.js';
import { Hud } from '../ui/Hud.js';
import { ClueBook } from '../ui/ClueBook.js';
import { ResultOverlay } from '../ui/ResultOverlay.js';
import { MinigamePanel } from '../ui/MinigamePanel.js';
import { TransitionScreen, SCENE_TRANSITION_MS } from '../ui/TransitionScreen.js';
import { runLockPuzzle } from '../minigames/lockPuzzle.js';
import { runGrenadeThrow } from '../minigames/grenadeThrow.js';
import { Patrol, PATROL_NAMES, PATROL_ROUTES, REINFORCE_AT } from '../entities/Patrol.js';
import { jailCell, jailExit } from '../world/streetLayout.js';
import {
  buildColliders,
  createPlayer,
  createPlayerVisual,
  applyMovement,
  setupCameras,
  setWorldPaused,
  worldLabel,
  DEFAULT_CHAR_HEIGHT,
  NAME_LABEL_DEPTH,
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
import { makeBlockedLookup } from '../world/los.js';
import { readSSE } from '../net.js';
import { CSS, FONTS, nameLabelStyle } from '../ui/theme.js';
import { playBgm, setLoop } from '../audio/SoundManager.js';
// 타일 스튜디오(tools/tilemap-studio.html)로 만들어 내보낸 맵. Vite 가 JSON 을 파싱해 객체로 준다.
import mapData from '../assets/map.json';
import streetProps from '../assets/street-props.json';
import citizenLines from '../assets/citizens.json';

/**
 * Stage 1.
 *
 * 데이터 흐름(연상 단어 → 접선 → 코드 입력 → 서버 판정 → 경계/클리어)은 그대로 두고,
 * 배경을 타일맵으로 교체했다. solid 타일에는 정적 충돌 바디가 붙어 플레이어를 막는다.
 * 시야·순찰 NPC 는 W3 에서 얹는다.
 */
const SPEED = 200;
// 자석 수류탄의 개수 제한은 2026-08-06 에 삭제됐다. 원래 2개 시작에 "다 쓰면 게임오버"
// (스토리보드 p16)였다가 "다 쓰면 감옥행"(08-05)으로 물러섰는데, 이제는 세지 않는다 —
// 감옥행 여부는 오직 던지기 미니게임의 명중/빗나감이 가른다.
/** 검문이 끝난 뒤 다시 잡히지 않는 시간. 서버의 checkpointCooldownUntil 과 같은 값이어야 한다. */
const CHECKPOINT_COOLDOWN_MS = 10_000;
/**
 * 명중 후 로봇이 굳어 있는 시간 (ms).
 *
 * 수류탄의 판타지는 "자기장에 관절이 붙어 굳는다"인데, 예전에는 대사만 그렇게 말하고
 * 로봇은 곧장 다시 걸었다 — 감지만 유예(graceMs)로 막았을 뿐이다. 이제 그 말대로
 * 걸음이 실제로 멈춘다 (2026-08-06 기획). 굳음이 풀린 뒤의 감지 유예는 따로 이어진다
 * (#grenadeEscape 의 타이머).
 */
const GRENADE_FREEZE_MS = 4000;
const TILE = mapData.tileSize; // 32

/** 평소의 조작 안내. 감옥에 갇히면 여기 있는 키가 전부 막히므로 따로 세운다 (#toJail). */
const KEY_HINTS = '[E] 대화    [R] 구출    [C] 단서 수첩';

/**
 * 오답을 받은 동료의 반응 — 서버가 매긴 근접도(/guess 의 proximity)마다 다르다.
 * `[고갯짓, 대사]` 이고, 대사가 빈 문자열이면 그 줄은 아예 안 나온다.
 *
 * 예전에는 정답과의 거리에 상관없이 한 문장뿐이었다 — "기어" 정답에 「톱니바퀴」를
 * 냈든 「빵」을 냈든 화면이 똑같아서, 진 판에서 왜 틀렸는지를 끝내 모른 채 끝났다
 * (2026-08-07 기획 피드백).
 *
 * ⚠ **정답을 역으로 알려 주는 말은 넣지 말 것.** 여기 문장은 전부 고정 문자열이라
 * 안전하지만, 서버의 판정 이유(judge.js 의 reason)를 그대로 띄우고 싶어지는 순간
 * "석탄은 증기와 관련은 있으나…" 같은 문장이 정답을 적어 버린다. 서버가 등급만
 * 내려보내는 것이 그 방벽이다.
 *
 * unknown 은 판정을 못 받았을 때다 — 그때는 반응 줄 없이 예전 문구 그대로 간다.
 */
const MISS_REACTION = {
  near: [
    '눈을 크게 떴다가, 이내 고개를 젓는다.',
    '"…거의 닿았어. 하지만 비슷한 말로는 안 돼 — 코드는 그 단어 하나여야 해."',
  ],
  related: [
    '잠깐 뜸을 들이다 고개를 젓는다.',
    '"…근처까지는 왔어. 아직 그건 아니야, 한 걸음만 더 좁혀 봐."',
  ],
  far: ['말없이 고개를 젓는다.', '"…전혀 다른 얘기야. 수첩을 다시 보고 와."'],
  unknown: ['말없이 고개를 젓는다.', ''],
};

/**
 * [대화하기]의 기본 대사 — 페르소나(personas.json)의 말투를 따른 한 마디씩이다.
 *
 * 단서(연상 단어)는 여기서 나오지 않는다 (2026-08-06 기획: 말을 걸자마자 접선 코드
 * 단서부터 흘리는 것이 부자연스럽다 — 단서는 [암호 말하기] 쪽으로 옮겼다, #offerCode).
 * 자유 대화(LLM)로 들어가는 첫인사 격이라 서버에 둘 것 없이 클라이언트 고정 대사다
 * (citizens.json 과 같은 원칙).
 */
const ALLY_SMALL_TALK = {
  watchmaker: '"…태엽은 감은 만큼만 도는 법이지. 조급해하지 마라."',
  maid: '"…용건만 말씀하세요. 한자리에 오래 서 있으면 눈에 띕니다."',
  engineer: '"…기관 소리 때문에 잘 안 들린다. 짧게 말해라."',
  smuggler: '"어라, 낯이 익은데? …궁금한 게 있으면 물어봐. 값은 나중에 치르고."',
  musician: '"어디 아픈 데는 없습니까. …요즘 거리가 흉흉하니 몸조심하세요."',
};

/**
 * 감옥 탈출 퍼즐에 실패한 뒤 다음 판이 열리기까지 (ms).
 *
 * 실패 판정을 보여 주는 패널의 800ms 뒤에 붙는 시간이다 — 합쳐서 약 2.2초.
 * 붙잡힌 사람이 손을 고쳐 잡는 만큼이고, 여기서 더 늘리면 그냥 기다리는 시간이 된다.
 */
const JAIL_RETRY_MS = 1400;

/**
 * 충돌이 보는 벽 — 감옥에서 나올 자리를 고르는 데 쓴다 (streetLayout.jailExit).
 * 순찰의 시야(Patrol.IS_BLOCKED)와 같은 원본(walkmask)을 본다.
 */
const IS_BLOCKED = makeBlockedLookup(mapData, streetProps);

/** 갇힌 자리와 나올 자리. 규칙은 streetLayout 에 있다 — 검사 스크립트가 같은 것을 읽는다. */
const JAIL_CELL = jailCell(mapData.cage);
const JAIL_EXIT = jailExit(JAIL_CELL, IS_BLOCKED, mapData.spawns.player);

// chars.png 스프라이트시트 프레임 — 이제 플레이어 자리(0)만 쓴다. 거리의 인물은
// 전원 전용 아트를 갖고 있다 (2026-08-04 기획 배치도).
const PLAYER_FRAME = 0;

// 전용 아이들 모션이 있는 동료 — 에이던 하나뿐이다. 나머지 여덟(동료 넷·시민 넷)은
// 본부·저택과 같은 PixelLab 남향 정지 그림으로 갈아 끼웠다(npcSprite.js).
// 에이던만 남은 것은 기획 배치도에 그려진 그림이 이 시트의 것과 같아서다 — 갈아 끼울
// 이유가 없고, 새 내보내기에도 그만 빠져 있다.
const ALLY_ANIM = { watchmaker: 'watchmakerIdle' };
// 이 시트는 256×256 프레임 안에서 발이 218px, 정수리가 23px 에 있다
// (scripts/measure-sprite.js 실측). 발바닥을 스폰 지점에 놓고 — 플레이어·튜토리얼과
// 같은 규칙 — 인물 높이를 맵이 정한 charHeight 에 맞춘다.
const ALLY_SPRITE_FRAME = 256;
const ALLY_SPRITE_ORIGIN_Y = 218 / ALLY_SPRITE_FRAME;
const ALLY_SPRITE_CONTENT = 196;

/**
 * 플레이어는 튜토리얼부터 엔딩까지 **같은 인물**이다 (2026-08-02 확정).
 * 스테이지마다 다른 스프라이트를 쓰면 사람이 바뀐 것처럼 보인다.
 *
 * 앞의 두 상수는 **그 시트 안에서 인물이 어디 있는가**라 시트를 바꾸면 같이 바뀐다
 * (tutorial 시트 실측값 — TutorialScene 과 동일).
 * PLAYER_HEIGHT 만 이 씬 고유다: 그건 **이 맵에서 화면에 얼마로 보일지**이고, 맵이 정한다.
 */
/** 화면에 보일 인물 높이 — 맵이 정한다 (worldParts.DEFAULT_CHAR_HEIGHT 참고). */
const PLAYER_HEIGHT = mapData.charHeight ?? DEFAULT_CHAR_HEIGHT;

const ALLY_SPRITE_SCALE = PLAYER_HEIGHT / ALLY_SPRITE_CONTENT;
// 이름표는 정수리 위에 둔다. 거리의 인물은 전부 **발**이 스폰 지점이라 인물 높이만큼 올린다.
const ALLY_SPRITE_LABEL_DY = -(PLAYER_HEIGHT + 8);

/**
 * 이름표 — 규격은 본부(튜토리얼)와 같다. 줌만 이 맵의 것을 넘긴다.
 *
 * 거리는 넷 중 인물이 가장 작은 맵(charHeight 64)이라 이름이 묻히기 가장 쉬웠다.
 * 예전엔 흐린 종이색 11px 이었는데, 구운 거리 그림의 벽돌·간판 무늬 위에서 그대로
 * 회색 얼룩이 됐다.
 */
const LABEL_STYLE = nameLabelStyle(mapData.cameraZoom ?? WORLD_ZOOM);
/**
 * 붙잡혀 감옥에 있는 동료의 이름 색.
 *
 * 금색은 "지금 접선할 수 있는 사람"의 색이라 감옥 쪽에는 쓰지 않는다. 그렇다고
 * 어둡게 죽이면 정작 구하러 가야 할 사람이 안 보인다 — 밝기는 그대로 둔 채 색만
 * 뺀다. 그림 쪽 tint(0x9a9088)와 같은 뜻의 표시다.
 */
const LABEL_COLOR_JAILED = CSS.paper;

export class StageScene extends Phaser.Scene {
  constructor() {
    super('Stage');
  }

  init(data) {
    this.state = data.state;
    // 개발용 정답 보기 (백틱 ` 키로 토글, REVEAL_ANSWER=1 일 때만 서버가 응답)
    this.debugAnswer = null;
    this.answerShown = false;
    // 단서 수첩 — [F] 접선으로 얻은 NPC → 연상 단어. (C 키로 열람)
    this.clues = new Map();
    // 접선([F])으로 코드를 건넬 대상 id — 맞히면 그 동료가 접선책이 된다.
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
    // 감옥에 갇혀 있는가. 갇힌 동안은 이동·상호작용이 전부 멈추고 [R] 만 산다 (#toJail).
    this.jailed = false;
    // 탈출 퍼즐이 열려 있는가 — [R] 연타로 판이 겹치지 않게 한다.
    this.jailPicking = false;
    // 이번 수감에서 잠금장치를 몇 번 만졌는가 (수감할 때마다 0 으로 되돌린다).
    this.jailAttempts = 0;
    // 창살이 열려 나가는 중 — 암전이 걷힐 때까지 [R] 이 새 판을 열지 못하게 막는다.
    this.jailLeaving = false;
    // 명중 직후 로봇이 굳어 있는 동안 참 — 검문 finally 의 순찰 재개를 막는다 (#grenadeEscape).
    this.grenadeFreeze = false;
  }

  create() {
    playBgm('stage1');
    this.dialogue = new DialogueBox();
    this.dialogue.onSend = (message) => this.#chat(message);
    this.dialogue.onCode = (guess) => this.#submitGuess(guess);
    // 이 판에 나올 얼굴은 정해져 있다 — 첫 접선에서 그림이 늦게 붙지 않게 미리 받는다.
    // 시민 넷도 함께 — 초상 규약이 동료와 같아졌다 (#registerCitizenNode).
    this.dialogue.preload([
      ...this.state.allies.map((a) => a.id),
      ...(mapData.spawns.citizens ?? []).map((z) => z.id),
    ]);
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
      PLAYER_FRAME_SIZE,
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

      const node = this.#standingNpc(ally.id, pos.x, pos.y);
      if (ally.arrested) node.setTint(0x9a9088);

      const label = worldLabel(
        this,
        pos.x,
        pos.y + ALLY_SPRITE_LABEL_DY,
        ally.arrested ? `${ally.name} (체포)` : ally.name,
        ally.arrested ? { ...LABEL_STYLE, color: LABEL_COLOR_JAILED } : LABEL_STYLE,
      ).setDepth(NAME_LABEL_DEPTH);

      // labelDy 는 감옥행·구출 연출에서 이름표를 다시 놓을 때도 쓴다 (#syncAllyNodes).
      this.allyNodes.push({
        ally,
        node,
        label,
        labelDy: ALLY_SPRITE_LABEL_DY,
        home,
        jailed: ally.arrested,
      });
    });

    // 접선책 노드는 없다 — **암호를 건네 맞춘 동료가 그대로 접선책이 된다** (2026-08-04).
    // 예전에는 별개 인물(요른)이 코드를 받는 유일한 창구였는데, 기획 설정서에 그런 인물이
    // 없고 접선책 대사는 전부 에이던(watchmaker)의 것이라 같은 사람이 거리에 두 번 서 있었다.

    this.#buildSteam();
    this.#spawnPatrols();
    // 여기까지가 월드 — 이후의 HUD·수첩·도움말은 UI 카메라 소속이다.
    // (경계 상승으로 나중에 붙는 증원 순찰은 #maybeReinforce 가 asWorld 로 등록한다.)
    setupCameras(this, mapData, this.player);
    this.interact = new InteractionManager(this, this.dialogue, PLAYER_HEIGHT);
    this.#registerInteractables();

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.keyE = this.input.keyboard.addKey('E');
    // F 는 선택지가 떠 있을 때만 의미가 있다 — [접선 코드] 를 고르는 단축키다
    // (튜토리얼·저택과 같은 모양). 입력칸에 초점이 가 있을 때는 애초에 선택지가
    // 없으므로 한글 입력기와 부딪힐 일이 없다.
    this.keyF = this.input.keyboard.addKey('F');
    this.keyR = this.input.keyboard.addKey('R');
    this.keySpace = this.input.keyboard.addKey('SPACE');
    this.keyEsc = this.input.keyboard.addKey('ESC');
    this.keyReveal = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.BACKTICK);
    this.keyClues = this.input.keyboard.addKey('C');
    this.settings = new SettingsPanel();

    // 디버그(백틱) 표시의 이유 문장이 길어도 #hud-status 가 오른쪽 여백에서 접는다.
    this.hud = new Hud();
    this.hud.keys(KEY_HINTS);

    // 수첩도 HUD 와 같은 이유로 DOM 이다 (ui/ClueBook.js). 생성자가 닫힌 상태로
    // 되돌리므로 재시작한 판이 이전 판의 펼친 수첩을 물려받지 않는다.
    this.clueBook = new ClueBook();

    this.#updateHud();

    // 본부에서 넘어온 로딩 화면이 떠 있으면 여기서 걷는다 — "보여줄 준비가 됐다"는
    // 도착한 씬만이 안다 (TransitionScreen 머리말). 재시작·개발용 직행처럼 로딩을
    // 거치지 않은 판에서는 안 떠 있고, 그때 hide() 는 무해하다.
    new TransitionScreen().hide();
    // 거리는 언제나 페이드 인으로 열린다 — 로딩 화면의 걷힘(400ms)과 겹쳐 검은
    // 화면에서 거리가 밝아 오는 한 호흡이 된다. 재시작 판도 같은 문으로 들어온다.
    this.cameras.main.fadeIn(700, 0, 0, 0);
    this.uiCam?.fadeIn(700, 0, 0, 0);
    this.hud.fadeIn(700);
    // 진입 쪽지는 거리가 다 밝아진 뒤에 편다 — 대화창은 DOM 이라 페이드가 안 걸려,
    // 먼저 띄우면 새까만 화면 위에 쪽지만 또렷이 떠서 연출을 가린다.
    this.cameras.main.once('camerafadeincomplete', () => this.#showBriefing());

    // 개발용 — ?grenade 로 들어오면 검문 조우를 곧바로 한 판 연다 (?nopatrol 관례).
    // 순찰에 걸릴 때까지 골목을 헤매지 않고 연출과 난이도를 확인하는 자리다.
    const dev = new URLSearchParams(window.location.search);
    if (dev.has('grenade')) {
      this.time.delayedCall(400, () => this.#startCheckpoint());
    }
    // ?jail — 수감 연출부터 곧바로 본다. 수류탄을 일부러 빗맞혀야 닿는 자리라
    // (그것도 명중하면 다시 골목을 헤매야 한다) 따로 문을 낸다. 서버는 갇힌 줄
    // 모르므로 탈출 보고가 409 로 떨어진다 — 콘솔 경고 한 줄, 연출은 그대로 돈다.
    if (dev.has('jail')) {
      this.time.delayedCall(400, () => this.#toJail('개발용 — 곧바로 수감된 상태로 시작한다.'));
    }
  }

  /**
   * 인터랙션 노드 등록. 체포 상태가 바뀌면 #syncAllyNodes 가 재등록한다.
   *
   * 말을 걸 수 있는 사람은 두 갈래다. 동료 다섯은 [E] 로 기본 대사 + 자유 대화(서버
   * LLM)가 열리고, **그 창 안에서** [F] 로 접선 — 단서 공개 + 코드 접수 — 이 열린다
   * (2026-08-07: 사이에 있던 선택지 메뉴를 걷어냈다 — 기획 피드백. E 한 번이면 말이
   * 나와야지, 메뉴 한 층을 거치면 대화가 아니라 자판기다). 코드는 누구에게 건네도 되고
   * 맞힌 그 동료가 접선책이 되어 저택으로 데려간다. 마을 사람 넷은 정해진 대사만 읽는다.
   */
  #registerInteractables() {
    for (const entry of this.allyNodes) this.#registerAllyNode(entry);
    for (const entry of this.citizenNodes) this.#registerCitizenNode(entry);
  }

  /**
   * 마을 사람 — 자유 대화도 선택지도 없는 고정 대사 노드.
   *
   * 처음 한 번은 설정서의 기본 대사를, 그 뒤로는 반복 대사를 읽는다. 되풀이해서 같은
   * 속내를 털어놓으면 그 인물이 인형처럼 보이고, 무엇보다 넷 중 셋이 "여기까지만
   * 하자"로 끝나는 대사라 그걸 다시 처음부터 듣는 것이 어색하다.
   *
   * 기본 동작(type 'npc')을 쓰지 않고 onInteract 를 다는 것은 **말을 걸었다는 사실을
   * 알아야** 다음 번에 다른 대사를 낼 수 있어서다 — 레이어는 그 시점을 알려 주지 않는다.
   * 초상은 동료와 같은 규약으로 넘긴다 — 설정서 일러스트가 2026-08-05 에 들어왔다
   * (design/characters/portrait-map.md 의 거리 시민 표, public/portraits/<id>.png).
   */
  #registerCitizenNode(entry) {
    this.interact.register({
      id: entry.id,
      type: 'npc',
      sprite: entry.sprite,
      onInteract: () => {
        const line = entry.spoken ? entry.repeat : entry.line;
        entry.spoken = true;
        this.dialogue.show(`${entry.name} (${entry.role})`, line, { portrait: entry.id });
        this.dialogue.setHint('[Space] 다음 · [Esc] 닫기');
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
    // [E] 로 말을 걸면 기본 대사와 함께 **선택지**가 선다 — 곧바로 입력칸을 열지 않는다.
    // 예전에는 말을 거는 즉시 자유 대화 입력칸이 열렸는데, 그러면 포커스가 입력칸에
    // 붙어 [F](암호 말하기)를 누를 수 없었다. 한글 IME 를 켠 채로는 더 그렇다 — F 는
    // 'ㄹ' 조합으로 들어가 keydown 의 key 가 'Process' 가 되어 단축키 판정에 안 걸린다.
    // 튜토리얼의 간부·저택의 인물이 쓰는 choiceNpc 와 같은 방식으로 되돌린다.
    this.interact.register({
      id: ally.id,
      type: 'choiceNpc',
      sprite: entry.node,
      speaker: `${ally.name} (${ally.role})`,
      line: ALLY_SMALL_TALK[ally.id] ?? '"…조심해서 다녀라."',
      portrait: ally.id,
      // 튜토리얼·저택과 같은 모양 — 기본 대사 뒤에 선택지가 뜨고, [자유대화]를 골라야
      // 비로소 입력창이 열린다(2026-08-07 플레이테스트 피드백: E 한 번에 곧장 입력창이
      // 뜨니 [F] 로 접선을 고를 틈이 없었다).
      choices: [
        { label: '자유대화', key: 'E' },
        { label: '접선 코드', key: 'F' },
        { label: '그만하기', key: 'Esc' },
      ],
      onChoice: (key) => {
        if (key === 'E') this.#startChat(ally);
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

    for (const key of ['avenue', 'crossing', 'wharf']) {
      this.patrols.push(new Patrol(this, PATROL_ROUTES[key], PATROL_NAMES[key]));
    }
    if (this.state.alertLevel >= REINFORCE_AT) {
      this.patrols.push(new Patrol(this, PATROL_ROUTES.reinforce, PATROL_NAMES.reinforce));
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
    const p = new Patrol(this, PATROL_ROUTES.reinforce, PATROL_NAMES.reinforce);
    // 카메라 분리(setupCameras) 이후에 태어나는 월드 오브젝트라 소속을 직접 밝힌다.
    // 이름표를 빠뜨리면 줌 없는 UI 카메라에도 겹쳐 그려져 화면 좌상단에 유령 글자가 남는다.
    this.asWorld(p.sprite, p.cone, p.label);
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
    if (remain > 0) lines.push(`\n남은 ${remain}명에게 [E] 로 말을 걸고, 그 창에서 [F] 로 접선하라 —\n그가 흘리는 단서를 모아 겹치는 단어(코드)를 추리해 아무 동료에게나 건네면 된다.`);
    if (arrested > 0) {
      lines.push(
        `\n감옥(좌측 상단) 창살 앞에서 [R] — 붙잡힌 동료를 빼낼 수 있다.\n소란은 새어 나가 경계 레벨이 오르지만, 그가 떠올린 단어는\n둘이 겹쳐서 잡혀갈 만큼 확실한 단서다.`,
      );
    }
    lines.push('\n[E] 대화 (그 창에서 [F] 접선 = 단서) · [R] 구출 · [C] 단서 수첩');

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
      this.clueBook.setText(`${head}아직 수집한 단서가 없다.\n\n동료에게 [E] 로 말을 건 뒤 그 창에서 [F] 로 접선하면,\n그가 흘린 연상 단어가 여기 기록된다.`);
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

  /**
   * 거리에 제자리로 서 있는 인물 하나. **발바닥이 (x, y)** 에 놓이고 화면에 보일 키는
   * 맵이 정한 charHeight 다 — 플레이어·본부·저택과 같은 규칙이다.
   *
   * 그림은 두 갈래인데 규칙은 하나다: 에이던만 예전 256px 아이들 시트(움직인다)이고
   * 나머지 여덟은 PixelLab 남향 정지 그림이다. 어느 쪽이든 원점은 발, 배율은
   * charHeight / 인물높이라 호출하는 쪽은 구분할 필요가 없다.
   */
  #standingNpc(id, x, y) {
    const anim = ALLY_ANIM[id];
    if (anim) {
      const size = ALLY_SPRITE_FRAME * ALLY_SPRITE_SCALE;
      return this.add
        .sprite(x, y, anim, 0)
        .setOrigin(0.5, ALLY_SPRITE_ORIGIN_Y)
        .setDisplaySize(size, size)
        .play(anim);
    }
    const size = NPC_FRAME_SIZE * (PLAYER_HEIGHT / NPC_CONTENT_HEIGHT[id]);
    return this.add
      .image(x, y, NPC_TEXTURE[id])
      .setOrigin(0.5, NPC_ORIGIN_Y)
      .setDisplaySize(size, size);
  }

  /** 감옥 안에서 체포된 동료가 서는 자리. 슬롯마다 오른쪽으로 밀린다. */
  #jailSlot(n) {
    const j = mapData.spawns.jail;
    return { x: j.col * TILE + TILE / 2 + n * j.step, y: j.row * TILE + TILE / 2 };
  }

  #buildMap() {
    // 네 맵이 같은 방식이다 — 가구까지 한 장에 구운 배경을 1:1 로 깔고 충돌만 따로
    // 세운다. street-bg.png 는 scripts/import-map-art.js 가 AI 배틀맵에서 굽는다.
    this.add.image(0, 0, 'street-bg').setOrigin(0, 0).setDepth(-100);
    this.walls = buildColliders(this, mapData, streetProps);

    // 마을 사람 넷 — 기획 설정서의 1스테이지 시민(아이리스·벤·미사·노아)이다.
    // 대사는 정해진 것만 나온다 (assets/citizens.json). 자리와 이름은 맵이 정한다.
    this.citizenNodes = [];
    for (const z of mapData.spawns.citizens ?? []) {
      const x = z.col * TILE + TILE / 2;
      const y = z.row * TILE + TILE / 2;
      const sprite = this.#standingNpc(z.id, x, y);
      worldLabel(this, x, y + ALLY_SPRITE_LABEL_DY, z.name, LABEL_STYLE).setDepth(
        NAME_LABEL_DEPTH,
      );

      // 대사가 없는 인물은 말을 걸 수 없다 — 다가가도 말풍선이 안 뜬다. 빈 창이 열리는
      // 것보다 낫다. 설정서에 대사가 생기면 citizens.json 에 한 줄 더하면 그만이다.
      const talk = citizenLines[z.id];
      if (talk) this.citizenNodes.push({ ...talk, id: z.id, name: z.name, sprite, spoken: false });
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
      `경계 레벨 ${this.state.alertLevel} / 3   |   접선 가능 ${active.length}/${this.state.allies.length}`,
    ];
    // 갇힌 동안에는 다른 줄보다 이게 먼저 읽혀야 한다 — 왜 안 움직이는지의 답이다.
    if (this.jailed) lines.push('구속됨 — 창살 잠금장치를 풀어야 나갈 수 있다. [R]');
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
   * (대사를 먼저 읽히려고 늦추던 `delay` 옵션이 있었는데, 그걸 쓰던 검문 적발이
   * 감옥행으로 바뀌면서 쓰는 곳이 없어졌다 — 지웠다.)
   *
   * 검문 적발('caught')은 이제 여기로 오지 않는다 — 붙잡히면 감옥이다(#toJail).
   * 스테이지 1 에서 판이 끝나는 길은 경계 3 에서의 발각('spotted') 하나뿐이다.
   *
   * @param {'caught'|'spotted'} outcome
   */
  #endGame(outcome) {
    if (this.ended) return;
    this.ended = true;
    // 조기 return 만으로 멈추면 마지막 프레임의 속도가 남아 플레이어가 계속 미끄러진다.
    this.player.body.setVelocity(0, 0);
    for (const p of this.patrols) p.halt();

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
  }

  update(time, delta) {
    // ⚠ 걸음 소리는 **매 프레임 setLoop('walk', moving) 로 유지되는 루프**다. 그래서
    // 이 함수에서 조기 return 하는 갈래는 **전부** 먼저 소리를 꺼야 한다 — 안 끄면
    // 마지막으로 참이었던 상태 그대로 계속 울린다. 걸어가다 [E] 로 대화창이나
    // 미니게임을 열면 발소리가 끊기지 않던 것이 이것이었다(2026-08-08 피드백).
    // 새 갈래를 더할 때도 같은 규칙을 지킬 것. (씬을 멈추는 설정 창은 ui/SettingsPanel
    // 의 openPaused 가 같은 이유로 직접 끈다 — 멈춘 씬은 update 가 아예 안 돈다.)
    if (this.ended) {
      setLoop('walk', false);
      return;
    }

    // 대화창이 열리는 순간 화면 전체가 얼어붙는다 — 딤 처리 아래로 순찰이 계속
    // 돌아다니면 "대화 중엔 안전하다"가 눈에 안 읽힌다(2026-08-07 플레이테스트 피드백).
    setWorldPaused(this, this.dialogue.isOpen);

    // 미니게임 중에는 월드를 멈춘다. 패널이 키를 capture 단계에서 가로채므로 Phaser 는
    // 새 입력을 못 받지만, 패널이 열리기 직전에 눌려 있던 키는 그대로 눌린 상태로 남는다.
    if (this.minigame.isOpen) {
      this.player.body.setVelocity(0, 0);
      setLoop('walk', false);
      this.playerVisual.update();
      return;
    }

    // 감옥 — 창살 안에서 할 수 있는 일은 잠금장치를 만지는 것뿐이다.
    // 순찰도 감지도 여기서 멈춘다 (갇힌 사람을 다시 검문할 수는 없다).
    if (this.jailed) {
      setLoop('walk', false); // 창살 안에서는 걷지 않는다 (머리말의 규칙)
      this.playerVisual.update();
      // 대사 말풍선이 창살 밖 동료를 가리키며 남아 있지 않게 한다.
      this.interact.update(this.player, { suppress: true });
      // 키 상태는 여기서도 매 프레임 소비한다 — 안 읽으면 갇혀 있는 동안 눌린 플래그가
      // 남아 있다가 풀려나는 첫 프레임에 뒤늦게 발동한다 (아래 본문의 같은 주석 참고).
      const pressedRescue = Phaser.Input.Keyboard.JustDown(this.keyR);
      const pressedSpace = Phaser.Input.Keyboard.JustDown(this.keySpace);
      const pressedClues = Phaser.Input.Keyboard.JustDown(this.keyClues);
      const pressedReveal = Phaser.Input.Keyboard.JustDown(this.keyReveal);
      Phaser.Input.Keyboard.JustDown(this.keyE);
      Phaser.Input.Keyboard.JustDown(this.keyF);

      // 나가는 중(암전)에는 [R] 이 죽는다 — 이미 열린 창살을 다시 따는 판이 열린다.
      if (pressedRescue && !this.jailLeaving) this.#pickJailLock();
      if (pressedSpace) this.dialogue.advance();
      if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) this.#escape();
      // 수첩은 갇혀서도 읽힌다 — 월드를 건드리지 않는 기록이고, 여기 앉아 다음 수를
      // 생각하는 것이 이 시간의 쓸모다.
      if (pressedClues) this.#toggleClues();
      if (pressedReveal) this.#toggleAnswer();
      return;
    }

    if (this.#updatePatrols(delta)) {
      this.player.body.setVelocity(0, 0);
      setLoop('walk', false); // 검문에 걸린 순간 발이 멈춘다 (머리말의 규칙)
      this.playerVisual.update();
      this.#startCheckpoint();
      return;
    }

    // 대화창이 떠 있는 동안은 이동을 막는다 — 입력 중일 때만 막으면, 대화창을 띄운
    // 채로 걸어 다니며 순찰의 검문까지 피해 다니는 게 가능했다(2026-08-07 플레이테스트
    // 피드백). 대화창 아래 레이어는 전부 멈춰야 자연스럽다.
    const typing = this.dialogue.isTyping;
    const dialogueOpen = this.dialogue.isOpen;

    let moving = false;
    if (dialogueOpen) {
      this.player.body.setVelocity(0, 0);
      // 펴 둔 수첩을 들고 말을 걸었다면 여기서 접는다 — 대화 중에 수첩이 떠 있으면
      // 안 되는 이유는 아래 [C] 갈래의 주석과 같다. 접어 두면 [Esc] 한 번이 대화창을
      // 닫고, 그다음 [C] 로 다시 펴면 된다.
      this.clueBook.close();
    } else {
      moving = applyMovement(this.player, { cursors: this.cursors, wasd: this.wasd, speed: SPEED });
    }
    setLoop('walk', moving);
    this.playerVisual.update();

    // 응답을 기다리는 동안에도 상호작용을 열어 두면, 늦게 도착한 스트림이 그 사이 띄운
    // 다른 대사 위에 그대로 이어붙는다 (setBusy 가 입력칸을 blur 시켜 typing 이 풀리기 때문).
    const waiting = typing || this.dialogue.busy;

    // 키 상태는 대기 중에도 매 프레임 소비한다 — 단락 평가로 건너뛰면 눌린 채 남은 플래그가
    // 응답이 도착하는 프레임에 뒤늦게 발동한다.
    const pressedTalk = Phaser.Input.Keyboard.JustDown(this.keyE);
    const pressedCode = Phaser.Input.Keyboard.JustDown(this.keyF);
    const pressedRescue = Phaser.Input.Keyboard.JustDown(this.keyR);
    const pressedSpace = Phaser.Input.Keyboard.JustDown(this.keySpace);
    const pressedClues = Phaser.Input.Keyboard.JustDown(this.keyClues);

    // 말풍선·최근접 노드 갱신 — 대기 중이거나 대화 중이면 레이어가 알아서 감춘다.
    this.interact.update(this.player, { suppress: waiting });

    if (!waiting && pressedTalk) {
      if (this.dialogue.isOpen && !this.dialogue.hasMore && this.dialogue.onChoice) {
        // 선택지가 떠 있으면 E = [자유대화] 선택
        this.dialogue.onChoice('E');
        // 글자가 아직 찍히는 중이면 E 를 먹지 않는다 — 연타로 대사를 건너뛰지 못하게.
      } else if (this.dialogue.isOpen && !this.dialogue.isTyping) {
        this.dialogue.advance();
      } else {
        this.interact.trigger();
      }
    }
    // F — 선택지가 떠 있을 때만 의미가 있다: [접선 코드] 선택.
    if (!waiting && pressedCode && this.dialogue.isOpen && !this.dialogue.hasMore && this.dialogue.onChoice) {
      this.dialogue.onChoice('F');
    }
    // R — 감옥의 동료 구출. 대상이 없어도 눌리게 둔다 (어디로 가야 하는지 알려주기 위해).
    if (!waiting && pressedRescue) {
      this.#tryRescue();
    }
    if (!typing && pressedSpace) {
      this.dialogue.advance();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
      this.#escape();
    }
    // 백틱(`) — 개발용 정답 토글
    if (Phaser.Input.Keyboard.JustDown(this.keyReveal)) {
      this.#toggleAnswer();
    }
    // C — 단서 수첩 열람. **대화 중에는 열리지 않는다** (2026-08-07 기획 피드백).
    // 수첩은 화면 절반을 덮는 DOM 이라 대화창 위에 겹치면 누가 말하는 중인지 사라지고,
    // 대화 중에는 이동도 순찰도 멈춰 있어(setWorldPaused) 수첩을 펼 이유도 없다.
    // 이미 펴 둔 채로 말을 걸었다면 그때 접는다 — 아래의 dialogueOpen 갈래가 맡는다.
    if (!typing && !dialogueOpen && pressedClues) {
      this.#toggleClues();
    }
  }

  /**
   * [Esc] — 위에 덮인 것부터 차례로 걷는다: 대화창이 떠 있으면 그것을 닫고, 아무것도
   * 없으면 설정 창을 연다.
   *
   * 입력칸에 글을 쓰는 중일 때는 여기까지 오지 않는다 — DialogueBox 가 그 Esc 를 직접
   * 처리하고 stopPropagation 으로 끊어 Phaser 가 아예 못 본다.
   */
  #escape() {
    if (this.dialogue.isOpen) this.dialogue.hide();
    else if (this.clueBook.isOpen) this.#toggleClues();
    else this.settings.openPaused(this, () => this.keyEsc.reset());
  }

  /**
   * 순찰을 전진시키고 감지 여부를 돌려준다.
   *
   * 대화창이 떠 있는 동안은 update() 자체를 건너뛴다 — Patrol#update 는 target 이
   * null 이어도 걸음은 그대로 옮긴다(감지만 꺼진다), 그래서 예전엔 대화 중에도 로봇이
   * 눈에 보이게 돌아다녔다(2026-08-07 플레이테스트 피드백). 아예 부르지 않아야
   * 위치도 시야 원도 그 자리에 완전히 멈춘다. 예전에 "검문 결과 메시지를 닫지 않는
   * 한 순찰이 영영 눈이 먼다"던 악용 걱정은, 지금은 대화창이 떠 있으면 이동 자체가
   * 막히므로(update 의 setWorldPaused) 성립하지 않는다 — 제자리에 멈출 뿐 도망칠
   * 수 없다.
   */
  #updatePatrols(delta) {
    if (this.dialogue.isOpen) return false;
    const canDetect = !this.checkpointActive;
    let seen = false;
    for (const p of this.patrols) {
      if (p.update(delta, this.state.alertLevel, canDetect ? this.player : null)) seen = true;
    }
    return seen;
  }

  /**
   * 발각 → 자석 수류탄 투척.
   *
   * ⚠ 2026-08-05 에 조우 전체를 갈아 끼웠다 (기획 목업). 예전에는 신원 스캔을 피하는
   * 타이밍 게임 한 판이었고, 그걸 놓치면 **LLM 심문**이 마지막 기회로 열렸으며,
   * 심문에서도 걸렸을 때 비로소 수류탄을 썼다. 지금은 조우가 곧 수류탄 시퀀스이고
   * 심문은 삭제됐다 (계획서 §5.1 의 AI 활용 지점 4번이 여기서 빠진다).
   *
   * 결과는 둘뿐이다:
   *  - **명중** — 로봇이 굳고 그 틈에 빠져나간다. 경계는 오르지 않는다.
   *  - **빗나감** — 붙잡혀 임시 감옥에 갇힌다 (#toJail). 경계도 오른다(2026-08-07).
   *    판이 끝나지는 않는다 — 경계 3 에서 다음 검문에 걸려야 비로소 끝난다.
   *
   * 수류탄에 개수 제한은 없다 (2026-08-06 기획 — 상단 상수 블록 주석 참고). 감옥행
   * 여부는 오직 던지기의 명중/빗나감이 가른다.
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

      const hit = await runGrenadeThrow(this.minigame, this.state.alertLevel);
      if (this.ended) return;

      // 판정의 대가는 서버가 매긴다 — 명중이면 쿨다운만, 빗나가면 감옥 수감이다.
      const r = await this.#post('checkpoint/qte', { result: hit ? 'pass' : 'fail' });
      this.state = r.state;
      this.#updateHud();
      if (this.ended) return;

      if (hit) this.#grenadeEscape();
      else this.#grenadeMissed();
    } catch (err) {
      // 검문이 네트워크 사고로 게임을 멈추게 두지 않는다. 패널을 접고 그냥 보내 준다.
      this.minigame.close();
      console.warn('[checkpoint]', err.message);
    } finally {
      this.checkpointActive = false;
      // 통과 직후 같은 자리에서 다시 잡히면 빠져나갈 방법이 없다. 유예를 서버 쿨다운과
      // 같은 길이로 준다 — 짧게 주면 그 차이만큼 거절당할 요청을 계속 쏘게 된다.
      //
      // 갇힌 채로 되돌리지는 않는다. 감옥에 있는 동안 순찰이 다시 돌면 창살 안에 선
      // 플레이어를 향해 유예가 끝나기만 기다리는 꼴이고, 나오는 순간의 유예는 창살을
      // 열어 준 쪽(#leaveJail)이 새로 준다. #toJail 은 첫 await 전에 jailed 를 세우므로
      // 이 finally 가 도는 시점에는 이미 참이다.
      //
      // 명중으로 굳어 있는 동안에도 재개하지 않는다 — 굳음이 풀리는 시점에
      // #grenadeEscape 의 타이머가 대신 재개한다 (grenadeFreeze 도 jailed 처럼
      // 첫 await 없이 세워지므로 여기서 이미 참이다).
      if (!this.jailed && !this.grenadeFreeze) {
        for (const p of this.patrols) p.resume({ graceMs: CHECKPOINT_COOLDOWN_MS });
      }
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
   * 저택으로 데려가는 사람은 **누구에게 암호를 건넸든 에이던**이다 (2026-08-05 기획
   * 목업). 저택 쪽 안내인이 이미 에이던 고정이라(mansion.json escort, 2026-08-04),
   * 여기서 암호를 받아 준 동료가 "나와 같이 가자"고 말하면 저택에 도착하는 순간
   * 사람이 바뀌어 버린다. 암호를 받은 동료는 코드를 인정하는 것까지만 하고,
   * 저택행 브리핑은 **페이드 아웃된 화면 위에서 에이던이** 한다 (목업의 연출 순서).
   */
  async #toMansion(codeWord) {
    if (this.ended) return;
    this.ended = true; // update() 를 멈춘다 — 이후는 연출 시간이다
    this.player.body.setVelocity(0, 0);
    for (const p of this.patrols) p.halt();
    // 펼쳐 둔 수첩을 여기서 접는다. C 가 이미 막힌 뒤라 플레이어가 닫을 방법이 없고,
    // 수첩은 DOM 이라 아래의 카메라 페이드가 걸리지 않아 저택까지 따라온다.
    this.clueBook.close();

    // 암호를 받아 준 동료가 코드를 인정한다 — 동료로 확인되는 순간. 그의 역할은 여기까지다.
    // ⚠ 줄바꿈은 한 번만 — 빈 줄을 넣으면 대화창이 페이지를 나눠 뒷문장이 ▼ 뒤에
    // 숨는데, 연출 중에는 [Space] 로 넘길 수 없다 (#toMansion 은 ended 뒤에 돈다).
    const b = this.state.allies.find((a) => a.id === this.codeTargetId);
    this.dialogue.show(
      `${b.name} (${b.role})`,
      `접선 코드는 「${codeWord}」 였다.\n"…맞군. 늦지 않아서 다행이야."`,
      { portrait: b.id },
    );
    await this.#beat(2600);
    this.dialogue.hide();

    // 월드를 먼저 접는다 — 에이던의 브리핑은 암전 위에서 나온다. 대화창은 DOM 이라
    // 카메라 페이드에 걸리지 않아 검은 화면 위에 또렷이 뜬다 (목업 그대로).
    this.cameras.main.fadeOut(900, 0, 0, 0);
    this.uiCam?.fadeOut(900, 0, 0, 0);
    this.hud.fadeOut(900); // HUD 는 DOM 이라 카메라 페이드가 안 걸린다
    await new Promise((done) => this.cameras.main.once('camerafadeoutcomplete', done));

    // 에이던은 다섯 동료 중 하나라 언제나 state 에 있다 — 이름·직함은 그쪽에서 읽는다.
    // 두 문장을 한 박스에 넣지 않는 것은 대화창이 빈 줄마다 페이지를 나누기 때문이다
    // (EscapeScene#playIntro 와 같은 이유 — 연출 중에는 [Space] 로 넘길 수 없다).
    const aiden = this.state.allies.find((a) => a.id === 'watchmaker');
    const speaker = `${aiden?.name ?? '에이던'} (${aiden?.role ?? '시계 수리공'})`;
    this.dialogue.show(speaker, '이번에 저택에서 괘종시계 수리 의뢰가 들어왔다.', {
      portrait: 'watchmaker',
    });
    await this.#beat(2400);
    this.dialogue.show(speaker, '보조공 역할을 해줄 어린 단원이 필요했는데 딱 맞게 찾았군…', {
      portrait: 'watchmaker',
    });
    await this.#beat(3000);
    this.dialogue.hide();

    // 시간이 흐른다 — 여기서 저택까지는 걸어가는 거리이고, 시계 수리공의 보조공으로
    // 위장해 들어가는 준비까지가 이 사이에 있다. 화면만 잠깐 검었다가 저택이 열리면
    // 에이던이 같은 자리에서 말을 두 번 잇는 것처럼 보여서 이동이 사라진다
    // (2026-08-07 기획 피드백). 본부 → 거리와 **같은 화면**을 쓴다 — 도는 회중시계가
    // 이 게임에서 "시간이 지나는 중"을 뜻하는 그림이라, 여기서 다른 걸 쓰면 규약이 깨진다.
    //
    // 걷는 것은 도착한 씬(MansionScene)의 몫이다 (TransitionScreen 머리말).
    new TransitionScreen().show('저택으로 향하는 중', '시계 수리공의 보조공으로 들어간다');
    await this.#beat(SCENE_TRANSITION_MS);
    this.scene.start('Mansion');
  }

  /**
   * 명중 — 로봇이 몇 초간 정말로 굳고(GRENADE_FREEZE_MS) 그 틈에 빠져나간다.
   *
   * 강한 자기장으로 구동부를 잠깐 붙여 놓는 무기다 (스토리보드 p16, 계획서 §4.3).
   * 개수 제한은 없다 (2026-08-06 기획 — 상단 상수 블록 주석 참고).
   */
  #grenadeEscape() {
    // 자기장이 터지는 순간 — 화면이 한 번 희게 튀고 로봇들이 굳는다.
    this.cameras.main.flash(220, 210, 230, 255);
    this.cameras.main.shake(180, 0.006);

    // 대사가 말하는 대로 걸음이 실제로 멈춘다 (2026-08-06). 푸른 기운은 자기장에
    // 붙들렸다는 표시다 — 굳음이 풀리는 시점에 여기의 타이머가 순찰을 재개하므로,
    // #startCheckpoint 의 finally 는 grenadeFreeze 를 보고 재개를 건너뛴다.
    this.grenadeFreeze = true;
    for (const p of this.patrols) {
      p.halt();
      p.sprite.setTint(0x9fc4e0);
    }
    this.time.delayedCall(GRENADE_FREEZE_MS, () => {
      this.grenadeFreeze = false;
      for (const p of this.patrols) p.sprite.clearTint();
      // 굳어 있는 사이 판이 끝났거나 다시 잡혀갔다면 재개는 그쪽 흐름의 몫이다.
      if (this.ended || this.jailed) return;
      for (const p of this.patrols) p.resume({ graceMs: CHECKPOINT_COOLDOWN_MS });
    });

    this.dialogue.show(
      '자석 수류탄',
      '팔이 뻗어 오는 순간, 충전을 끝낸 수류탄을 굴렸다.\n\n' +
        // ⚠ 문단(빈 줄)을 늘리지 말 것 — 빈 줄마다 페이지가 갈려 [Space] 를 한 번 더
        // 받아야 한다. 감지 원이 어떻게 변하는지(Patrol#drawCone 의 세 상태)는 한 줄로
        // 앞 문단에 붙인다 — 화면에서 원이 달라지는 이유를 여기서 한 번은 말해야 한다.
        '푸른 섬광. 로봇의 관절이 서로 들러붙어 굳는다. 그 틈에 골목으로 몸을 던졌다.\n' +
        '센서도 한동안 죽어 있다 — 원이 푸른 점선인 동안에는 안 걸린다. 그 사이에 거리를 벌려라.\n\n' +
        `경계 레벨 ${this.state.alertLevel}/3`,
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  /**
   * 빗나감 — 붙잡혀 감옥으로 끌려간다. 경계도 오른다(2026-08-07 — #startCheckpoint 가
   * 이미 서버에 result:'fail' 을 보고했고, 그 응답의 상승된 alertLevel 이 이 시점엔
   * this.state 에 반영돼 있다).
   *
   * 받아 줄 다음 단계가 없다. 예전에는 LLM 심문이 그 자리였는데 2026-08-05 에
   * 삭제됐다 (#startCheckpoint 머리말).
   */
  #grenadeMissed() {
    this.cameras.main.shake(240, 0.008);
    this.#toJail(
      '손이 미끄러졌다. 수류탄이 엉뚱한 곳에서 터지며 골목 벽만 파랗게 물들인다.\n\n' +
        '자기장이 닿지 않은 로봇의 팔이 그대로 어깨를 붙든다.\n\n' +
        `경계 레벨이 올라갔다. (${this.state.alertLevel})`,
    );
  }

  /**
   * 붙잡혔다 — **게임오버 대신 임시 감옥에 갇힌다** (2026-08-05 기획).
   *
   * 나가는 길은 하나뿐이다: 창살 잠금장치를 직접 따는 것. 몇 번이든 다시 딸 수 있지만
   * 실패마다 경계가 오른다(2026-08-07, #pickJailLock) — 감옥은 벌이 아니라 시간이지만,
   * 대가 없이 무한히 다시 딸 수 있으면 잡혀도 경계 3(발각 즉시 구속)에 절대 닿지 않는
   * 사각지대가 된다. 나오는 데 걸린 시간만큼 경계가 오른 거리를 다시 걸어야 한다.
   *
   * 갇히는 동안 물리 바디를 끄는 이유는 streetLayout.jailCell 머리말 참고 —
   * 창살 안은 걷는 칸이 아니라, 켜 둔 채로 옮기면 정적 충돌 바디에 밀려 튀어나간다.
   *
   * ⚠ 첫 await 전에 this.jailed 를 세운다. #startCheckpoint 의 finally 가 이 값을 보고
   * 순찰을 되돌릴지 정하는데, 그 finally 는 이 함수를 부른 직후(await 없이) 돌기 때문이다.
   *
   * @param {string} caption 붙잡히는 순간의 대사 — 경로마다 다르다 (빗나감 / 수류탄 없음).
   */
  async #toJail(caption) {
    if (this.jailed || this.ended) return;
    this.jailed = true;
    this.jailAttempts = 0;
    this.player.body.setVelocity(0, 0);
    for (const p of this.patrols) p.halt();

    this.dialogue.show('검문 적발', caption);
    this.dialogue.setHint('');
    await this.#beat(2200);
    if (this.ended) return;

    // 끌려가는 길은 보여 주지 않는다 — 로봇에게 붙들려 걷는 그림이 없어서, 움직이면
    // 인물이 창살까지 미끄러져 가는 것으로만 보인다. 암전으로 자르는 편이 낫다.
    this.cameras.main.fadeOut(420, 0, 0, 0);
    await new Promise((done) => this.cameras.main.once('camerafadeoutcomplete', done));
    if (this.ended) return;

    this.player.body.enable = false;
    this.player.setPosition(JAIL_CELL.col * TILE + TILE / 2, JAIL_CELL.row * TILE + TILE / 2);
    // 카메라는 따라오는 중이라 암전이 걷히는 동안 거리에서 감옥까지 훑고 온다 —
    // 순간이동한 자리에 바로 붙여 둔다.
    this.cameras.main.centerOn(this.player.x, this.player.y);
    this.playerVisual.update();
    this.#updateHud();
    this.hud.keys('[R] 창살 잠금장치    [C] 단서 수첩');
    this.cameras.main.fadeIn(420, 0, 0, 0);

    this.dialogue.show(
      '임시 감옥',
      '철문이 등 뒤에서 닫힌다. 같은 창살 안에 낯익은 얼굴들이 앉아 있다.\n\n' +
        '문 안쪽에도 잠금장치가 있다. 밖에서 동료를 빼낼 때 만지던 그 물건이다.',
    );
    this.dialogue.setHint('[R] 잠금장치를 만진다');
    await this.#beat(2400);
    // 갇힌 직후 한 판은 자동으로 연다 — 여기까지 왔는데 키를 찾게 만들 이유가 없다.
    // 그 사이 플레이어가 먼저 [R] 을 눌러 한 판 치렀다면 여기서는 열지 않는다.
    // 그 판의 뒤처리(실패 시 재개)는 #pickJailLock 이 이미 쥐고 있다.
    if (this.jailAttempts === 0) this.#pickJailLock();
  }

  /**
   * 창살 잠금장치를 딴다 — 감옥에서 나가는 유일한 길.
   *
   * **실패하면 스스로 다시 열린다** — 여기서 할 수 있는 일이 이것 하나뿐이라 키를
   * 기다리는 것은 대기일 뿐이다.
   *
   * 실패는 경계도 올린다(2026-08-07) — 동료 구출 락픽(#raiseAlarm('lockpick'))과 같은
   * 이유다. 실패해도 감옥에 갇힐 뿐 게임오버가 아니니, 대가 없이 몇 번이든 다시 딸 수
   * 있으면 검문에 계속 잡혀도 경계 3(발각 즉시 구속)에 절대 닿지 않는 사각지대가 된다.
   *
   * 처음에는 실패 후 [R] 을 누르게 했는데 그게 안 먹는 것처럼 보였다: 판정('실패')을
   * 보여 주는 800ms 동안 패널이 아직 떠 있고, 그 사이의 키는 패널의 키 가드가
   * 삼킨다(MinigamePanel.keyGuard). 실패하자마자 손이 가는 그 순간이 정확히 그 구간이다.
   */
  async #pickJailLock() {
    if (this.jailPicking || !this.jailed || this.ended) return;
    this.jailPicking = true;
    this.jailAttempts += 1;
    this.dialogue.hide();

    let opened;
    try {
      opened = await runLockPuzzle(this.minigame, { from: 'inside' });
    } finally {
      this.jailPicking = false;
    }
    // 퍼즐을 푸는 사이 판이 끝났거나(경계 3 발각 등) 이미 풀려났다면 결과를 버린다.
    if (this.ended || !this.jailed) return;

    if (!opened) {
      await this.#raiseAlarm('jailpick');
      this.dialogue.show(
        '임시 감옥',
        '잠금장치가 딸깍 소리와 함께 도로 잠긴다.\n\n' +
          `복도 끝의 로봇은 이쪽을 보지 않는다. 손을 다시 가져간다.\n\n` +
          `경계 레벨이 올라갔다. (${this.state.alertLevel})`,
      );
      this.dialogue.setHint('잠시 후 다시 시도한다 · [R] 즉시 다시');
      // 왜 다시 열렸는지 읽을 틈만 준다. 0 으로 두면 실패 판정과 새 판이 붙어 버려
      // 뭘 틀렸는지 못 보고, 길게 두면 갇힌 채로 기다리는 시간이 된다.
      await this.#beat(JAIL_RETRY_MS);
      // 기다리는 사이 [R] 로 이미 새 판을 열었거나(jailPicking) 판이 끝났으면 겹치지 않는다.
      if (this.jailPicking || this.jailLeaving || !this.jailed || this.ended) return;
      this.#pickJailLock();
      return;
    }

    await this.#leaveJail();
  }

  /**
   * 창살이 열렸다 — 거리로 돌아간다.
   *
   * jailed 는 **암전이 걷힐 때까지** 참으로 둔다. 여기서 먼저 내리면 창살 안에 선 채로
   * 순찰 감지와 이동이 되살아나, 검은 화면 뒤에서 감옥 안의 플레이어가 다시 발각된다.
   * 그동안 [R] 은 jailLeaving 이 막는다.
   */
  async #leaveJail() {
    this.jailLeaving = true;
    // 서버에도 알린다. 여기서 재검문 쿨다운이 다시 걸린다 (routes/stage.js /jail/escape).
    try {
      const r = await this.#post('jail/escape');
      this.state = r.state;
    } catch (err) {
      // 네트워크 사고가 창살을 도로 잠그게 두지 않는다 (#startCheckpoint 와 같은 정책).
      // 서버는 갇힌 것으로 알고 있지만, 막히는 것은 다음 검문뿐이라 판은 계속 굴러간다.
      console.warn('[jail]', err.message);
    }
    if (this.ended) return;

    this.cameras.main.fadeOut(320, 0, 0, 0);
    await new Promise((done) => this.cameras.main.once('camerafadeoutcomplete', done));
    if (this.ended) return;

    this.player.body.enable = true;
    // reset 은 위치와 속도를 함께 되돌린다 — 바디를 꺼 둔 사이 어긋난 물리 좌표까지
    // 여기서 맞춰진다 (setPosition 만으로는 바디가 감옥에 남는다).
    this.player.body.reset(JAIL_EXIT.col * TILE + TILE / 2, JAIL_EXIT.row * TILE + TILE / 2);
    this.cameras.main.centerOn(this.player.x, this.player.y);
    this.playerVisual.update();

    this.jailed = false;
    this.jailLeaving = false;
    this.hud.keys(KEY_HINTS);
    this.#updateHud();
    // 나오자마자 코앞의 로봇에게 다시 잡히면 감옥이 무한 반복된다 — 검문 통과와 같은
    // 길이의 유예를 준다 (서버 쿨다운과 짝).
    for (const p of this.patrols) p.resume({ graceMs: CHECKPOINT_COOLDOWN_MS });
    this.cameras.main.fadeIn(320, 0, 0, 0);

    this.dialogue.show(
      '탈출',
      '창살이 소리 없이 열린다. 골목의 찬 공기가 얼굴에 닿는다.\n\n' +
        `경계 레벨 ${this.state.alertLevel}/3`,
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
   * 선택지 [자유대화] — 기본 대사는 choiceNpc 레이어가 이미 띄웠다. 여기서는
   * 자유 대화(LLM) 입력창만 연다.
   *
   * 접선(/contact)은 여기서 하지 않는다 (2026-08-06 기획). 예전에는 첫 대화가 접선을
   * 겸해 말을 걸자마자 연상 단어부터 나왔는데, 만나자마자 코드 단서를 흘리는 것이
   * 부자연스러웠다 — 단서는 코드를 주고받는 자리인 [접선 코드] 선택지(#offerCode)에서
   * 나온다.
   */
  #startChat(ally) {
    this.currentAllyId = ally.id;
    this.dialogue.hideChoices();
    this.dialogue.showInput('말을 건넨다...', 'chat');
    this.dialogue.setHint('[Enter] 대화 · [Esc] 닫기');
  }

  /**
   * 선택지 [접선 코드] — 접선의 자리다.
   *
   * 첫 번째에는 /contact 로 상대의 연상 단어(단서)를 받아 수첩에 적고, 코드를 말하라는
   * 대사와 함께 입력창을 연다 (2026-08-06 기획 — 단서는 대화가 아니라 여기서 나온다).
   * 두 번째부터는 "이미 말했잖아"다. 중복 판정(체포)도 첫 접선 시점에 갱신된다.
   */
  async #offerCode(target) {
    this.codeTargetId = target.id;
    // 선택지에서 왔다면 그 버튼줄부터 걷는다 (튜토리얼 #offerCode 와 같은 순서).
    this.dialogue.hideChoices();

    if (!this.clues.has(target.id)) {
      this.dialogue.setBusy(true);
      this.dialogue.show(`${target.name} (${target.role})`, '조심스럽게 접선을 시도한다...', {
        portrait: target.id,
      });

      let contact;
      try {
        const res = await fetch('/api/stage/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: this.state.sessionId, allyId: target.id }),
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
      this.#recordClue(target, contact.word);
      this.#syncAllyNodes();
      this.#updateHud();

      // 접선하는 그 순간 중복이 확인돼 상대까지 붙잡혀 갈 수 있다 (session.contactAlly).
      // 그때는 코드를 받을 사람이 없다 — 단어만 수첩에 남고 입력창은 열지 않는다.
      if (this.state.allies.find((a) => a.id === target.id)?.arrested) {
        this.dialogue.reply(
          `${target.name} (${target.role})`,
          `"…내 단어는 「${contact.word}」."\n\n말이 끝나기도 전에 로봇들이 그를 둘러싼다 — 같은 단어를 말한 자가 또 있었다.\n\n끌려가며 남긴 단어는 [C] 수첩에 적었다. 둘이 겹친 만큼 확실한 단서다.`,
          '[Space] / [Esc] 로 닫는다',
          { portrait: target.id },
        );
        return;
      }

      this.dialogue.show(
        `${target.name} (${target.role})`,
        `상대가 눈을 들지 않은 채 낮게 말한다.\n"…내 단어는 「${contact.word}」. 그래서 — 코드는?"`,
        { portrait: target.id },
      );
      this.dialogue.showInput('접선 코드 입력...', 'code');
      this.dialogue.setHint('[Enter] 코드 전달 · [Esc] 취소 · 단어는 [C] 수첩에 기록됐다');
      return;
    }

    // 두 번째부터 — 단서는 한 번만 나온다. 수첩([C])이 이미 쥐고 있다.
    this.dialogue.show(
      `${target.name} (${target.role})`,
      `상대가 잠깐 눈을 들었다 내린다.\n"…단서는 이미 말했잖아. 「${this.clues.get(target.id).word}」. 코드는?"`,
      { portrait: target.id },
    );
    this.dialogue.showInput('접선 코드 입력...', 'code');
    this.dialogue.setHint('[Enter] 코드 전달 · [Esc] 취소');
  }

  /** [F] 접선(#offerCode)으로 얻은 단서(NPC → 연상 단어)를 수첩에 기록한다. */
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
        : `감옥에 ${jailed}명이 붙잡혀 있다.\n창살 바로 앞(지도 좌측 아래)까지 다가가서 [R].`,
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
        `[E] 로 말을 걸고 [F] 로 다시 접선할 수 있다. 그가 떠올린 단어는\n둘이 겹쳐 낸 만큼 확실한 단서다.`,
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
          targetId: this.codeTargetId,
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

      const target = this.state.allies.find((a) => a.id === this.codeTargetId);
      const maxed = this.state.alertLevel >= 3;
      // 얼마나 빗나갔는지를 동료의 반응으로 돌려준다 (서버 /guess 의 proximity).
      // 등급을 못 받았으면(판정 실패·빈 입력) 반응 줄 없이 예전 문구 그대로 간다 —
      // 모르는 것을 "전혀 다르다"로 뭉개면 아깝게 빗나간 판에서 거짓말이 된다.
      const [nod, line] = MISS_REACTION[result.proximity] ?? MISS_REACTION.unknown;
      this.dialogue.reply(
        '접선 실패',
        `틀렸다. ${target.name}이(가) ${nod}` +
          (line ? `\n${line}` : '') +
          `\n거리에 소문이 샌다 — 경계 레벨 ${this.state.alertLevel}/3.` +
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
        entry.label.setText(`${updated.name} (체포)`).setColor(LABEL_COLOR_JAILED);
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
        // 색까지 되돌린다 — 감옥행에서 뺏은 금색을 여기서 돌려주지 않으면, 구출된
        // 동료만 영영 흰 이름으로 남아 "아직 잡혀 있나" 싶어진다.
        entry.label.setText(updated.name).setColor(LABEL_STYLE.color);
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
