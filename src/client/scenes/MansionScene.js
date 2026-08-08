import Phaser from 'phaser';
import { DialogueBox } from '../ui/DialogueBox.js';
import { SettingsPanel } from '../ui/SettingsPanel.js';
import { Hud } from '../ui/Hud.js';
import { DocumentPanel } from '../ui/DocumentPanel.js';
import { ResultOverlay } from '../ui/ResultOverlay.js';
import {
  TransitionScreen,
  SCENE_TRANSITION_MS,
  TRANSITION_FADE_MS,
} from '../ui/TransitionScreen.js';
import {
  buildColliders,
  createPlayer,
  createPlayerVisual,
  applyMovement,
  setupCameras,
  setWorldPaused,
  worldLabel,
  DEFAULT_CHAR_HEIGHT,
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
import { readSSE } from '../net.js';
import { CSS, FONTS } from '../ui/theme.js';
import { playBgm, setLoop, playSfx, stopBgm } from '../audio/SoundManager.js';
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
 * 플레이어는 튜토리얼부터 엔딩까지 **같은 인물**이다 (2026-08-02 확정).
 * 스테이지마다 다른 스프라이트를 쓰면 사람이 바뀐 것처럼 보인다.
 * (저택 잠입은 이야기상 시계 수리공의 보조로 위장한 것이지만, 위장을 그림으로
 *  보여주는 것보다 주인공이 같은 사람으로 보이는 쪽을 택했다.)
 *
 * 앞의 두 상수는 **그 시트 안에서 인물이 어디 있는가**라 시트를 바꾸면 같이 바뀐다
 * (tutorial 시트 실측값 — TutorialScene 과 동일).
 * PLAYER_HEIGHT 만 이 씬 고유다: 그건 **이 맵에서 화면에 얼마로 보일지**이고, 맵이 정한다.
 */
/** 화면에 보일 인물 높이 — 맵이 정한다 (worldParts.DEFAULT_CHAR_HEIGHT 참고). */
const PLAYER_HEIGHT = mansionData.charHeight ?? DEFAULT_CHAR_HEIGHT;
/**
 * 이름표는 정수리 위. NPC 는 PixelLab 정지 그림이라 원점이 **발**이므로
 * 인물 키만큼 통째로 올린다 (chars.png 시절에는 중심이 원점이라 절반만 올렸다).
 */
const LABEL_DY = -(PLAYER_HEIGHT + 8);

/**
 * 안내인 에이던의 그림 규격 — 저택의 다른 열 명과 **다른 시트**를 쓴다.
 *
 * 열 명은 PixelLab 남향 정지 그림 한 장(npcSprite.js)인데, 에이던만 거리(스테이지 1)에서
 * 쓰던 예전 256×256 12프레임 아이들 시트다. 숫자는 StageScene 의 ALLY_SPRITE_* 와 같은
 * 실측값이고(scripts/measure-sprite.js), 규칙도 같다:
 * **발바닥이 좌표에 놓이고, 화면에 보일 키는 맵의 charHeight 다.**
 *
 * ⚠ 시트는 아이들 애니메이션이지만 **저택에서는 재생하지 않는다** — 첫 프레임 한 장을
 * 정지 그림으로 쓴다(2026-08-08 기획). 저택에 선 열한 명 중 혼자만 숨을 쉬면 그 인물만
 * 다른 규격으로 보여 눈이 그리로 간다. 거리(StageScene)는 그대로 재생한다 — 그쪽은
 * 애초에 에이던이 유일한 동적 인물이라는 전제로 짜인 화면이다.
 * 그래서 이름도 ANIM 이 아니라 TEXTURE 다. 애니메이션 키와 텍스처 키가 'watchmakerIdle'
 * 로 같은 문자열이라(BootScene 이 둘 다 그 이름으로 등록한다) 헷갈리기 쉬운 자리다.
 */
const ESCORT_TEXTURE = 'watchmakerIdle';
const ESCORT_FRAME = 0;
const ESCORT_FRAME_SIZE = 256;
const ESCORT_ORIGIN_Y = 218 / ESCORT_FRAME_SIZE;
const ESCORT_CONTENT_HEIGHT = 196;


/**
 * 인물 이름표. 본부와 같은 규칙이다 — 흐린 종이색 11px 은 밝은 마루 위에서 회색으로
 * 묻혀 안 읽혔다. `[E] 대화` 말풍선과 같은 금색에 어두운 테두리를 둘러 끊어 준다.
 *
 * ⚠ worldLabel 의 크기는 **월드 기준**이라 화면 크기는 맵의 줌이 함께 정한다.
 * 본부는 줌 1 이라 24px 이 곧 화면 24px 이지만, 저택은 줌 1.5 라 16px 이 화면 24px 이다.
 * 두 스테이지에서 같은 크기로 보이게 하려면 이 값이 달라야 한다.
 */
const LABEL_STYLE = {
  fontFamily: FONTS.body,
  fontSize: '16px',
  color: CSS.brassHi,
  stroke: '#0a0906',
  strokeThickness: 3,
};

/** 지금 있는 방이 아닌 곳을 덮는 어둠. 안에 누가 있는지 문 밖에서는 안 보인다. */
const SHROUD_DIM = 0.68;
/**
 * 연구실은 열쇠를 얻기 전까지 안 걷힌다. 다만 완전히 덮으면 그냥 검은 사각형이라
 * "무언가 있는데 안 보인다"가 아니라 "아무것도 없다"로 읽힌다 —
 * 안의 태엽 장치가 실루엣으로만 잡히는 정도로 남긴다.
 */
const SHROUD_LOCKED = 0.85;
const SHROUD_COLOR = 0x05040a;
/**
 * 늘 밝은 방. 로비는 저택 남쪽에서 모든 길이 갈라지는 곳이다 —
 * 여기까지 어두워지면 돌아올 자리가 없어 방향 감각이 통째로 사라진다.
 *
 * (2026-08-07 부터 시작 지점은 로비가 아니라 북쪽 괘종시계 아래 중앙 복도다 —
 *  mansion.json spawns 주석. 복도는 덮개가 걷히는 방이지만, 시계가 있는 서재(위)의
 *  **위쪽 가장자리**는 덮개의 풀림(SHROUD_FEATHER) 안이라 첫 화면에서도 시계가 보인다.
 *  이 자리를 옮길 때는 그 점을 같이 확인해야 한다.)
 */
const ALWAYS_LIT = new Set(['lobby']);

/**
 * 연구실 문서 받침대 — 스테이지 목표. 잠긴 연구실(rooms.lab) 안쪽이다.
 * 2026-08-04 격자가 58→59칸이 되면서 다른 좌표와 함께 한 칸 옮겼다(47→48).
 */
/**
 * 연구실 문서 — 스테이지 2 의 목표물이자 스테이지 3 의 예고편.
 *
 * 제목·본문은 기획 목업(2026-08-05)의 것을 그대로 옮겼다. EVA Mark-1 이 "인간이
 * 되도록 설계"됐다는 이 기록이, 수로 끝에서 만나는 아이(에바)의 반전을 미리 심는다.
 * 마지막의 "……."는 오탈자가 아니다 — 다 읽기 전에 경보가 끊는다 (#readDocument).
 */
const DOCUMENT = {
  name: '연구 기록 제7시리즈 — 대상: EVA Mark-1',
  col: 49,
  row: 17,
  body: [
    '외형은 인간과 완전히 동일하다.\n아니, 더 정확히 말하자면 — 인간이 되도록 설계되었다.',
    '표피 아래 흐르는 것은 혈액이 아니라 정제된 윤활유이나, 촉감과 체온, 미세한 표정의 떨림까지 인간의 그것과 구별할 수 없는 수준에 도달했다.',
    '기존 전투 로봇들이 힘과 내구성만을 좇아 인간을 흉내조차 내지 않았던 것과 달리, 본 개체는 그 반대의 길을 걷는다. 인간처럼 보이고, 인간처럼 움직이고, 인간처럼 학습한다.',
    "그러면서도 신체 능력은 기존 전투 로봇의 평균치를 상회한다. 관절 구동 속도, 반응 시간, 하중 지지력 — 모든 수치가 '인간형'이라는 제약을 두었음에도 그 이상을 기록했다.",
    '이는 인간의 형태가 결코 비효율의 증거가 아니며, 오히려 가장 정교하게 다듬어진 설계도였음을 반증한다.',
    '다만 한 가지 변수가 남아있다.',
    '…….',
  ].join('\n\n'),
};

/**
 * 문서를 읽도록 허락되는 시간 (ms) — 지나면 저절로 덮이고 경보가 울린다 (기획 목업).
 * 본문을 거의 다 읽을 만큼은 주되, 마지막 줄에서 끊기는 느낌이 남게 잡았다.
 */
const DOC_ALARM_MS = 12_000;
/**
 * 어둠 덮개의 가장자리가 풀어지는 거리(칸).
 *
 * 예전에는 평평한 사각형으로 덮어서 방 경계에 칼같은 직선이 그어졌다 — 벽이 있는 자리는
 * 벽이 가려 줬지만, 벽 없이 이어지는 자리(중앙 복도의 위·아래)에서는 마루 한가운데 검은
 * 선이 보였다. 이제 **모든 방의 사방**을 풀어 준다.
 */
const SHROUD_FEATHER = 3;

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
    /**
     * 동료 id → 그가 정보를 건네며 한 대사 전문.
     *
     * 서버는 누가 이미 줬는지(npc.gave)만 알려 주고 **무엇을 줬는지는 다시 안 준다** —
     * 그 대사를 다시 보여 주려면 받은 순간에 여기 적어 둬야 한다 (#applyEvent).
     */
    this.rewardLines = new Map();
  }

  create() {
    playBgm('stage2');
    this.dialogue = new DialogueBox();
    this.dialogue.onSend = (message) => this.#chat(message);
    this.docPanel = new DocumentPanel();
    this.result = new ResultOverlay();
    this.result.hide(); // 재시작으로 다시 들어온 경우 이전 판의 결과 화면을 걷어낸다
    // ⚠ 로딩 화면(TransitionScreen)은 여기서 걷지 않는다 — 저택이 다 지어지고
    // /start 응답까지 온 뒤, #start() 끝에서 걷는다. 커튼이 먼저 올라가면 텅 빈
    // 저택이 잠깐 보였다가 인물들이 뒤늦게 하나씩 나타난다.

    // 그림은 구운 배경 한 장, 충돌은 따로. 배경은 무엇보다 뒤에 깔린다.
    this.add.image(0, 0, 'mansion-bg').setOrigin(0, 0).setDepth(-100);
    this.walls = buildColliders(this, mansionData, mansionProps);
    this.player = createPlayer(this, mansionData, this.walls, PLAYER_FRAME);
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
    // 여기까지가 월드. NPC 는 /start 응답 후에 생기므로 asWorld() 로 따로 등록한다.
    setupCameras(this, mansionData, this.player);
    this.interact = new InteractionManager(this, this.dialogue, PLAYER_HEIGHT);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.keyE = this.input.keyboard.addKey('E');
    this.keySpace = this.input.keyboard.addKey('SPACE');
    this.keyEsc = this.input.keyboard.addKey('ESC');
    this.settings = new SettingsPanel();

    // 플레이어는 어둠보다 위에 둔다 — 어둠이 걷히는 짧은 사이에도 자기 몸은 보여야 한다.
    // 화면에 실제로 보이는 건 playerVisual 이므로 깊이는 그쪽에 준다.
    this.player.setDepth(30);
    this.playerVisual.node.setDepth(30);

    this.#buildSteam();
    this.#buildShroud();
    this.#buildHud();

    // 거리에서 암전으로 넘어온다 — 받는 쪽도 밝아지며 열려야 한 장면으로 이어진다.
    // 로딩 화면이 위를 덮고 있는 판에서는 이 페이드가 커튼 뒤에서 도는데, 그래도
    // create 에서 거는 이유는 커튼 없이 들어오는 판(개발용 ?stage2)이 첫 프레임부터
    // 검은 화면에서 열려야 하기 때문이다 — fadeIn 은 progress 0 이 곧 암전이다.
    this.cameras.main.fadeIn(700, 0, 0, 0);
    this.uiCam?.fadeIn(700, 0, 0, 0);
    this.hud.fadeIn(700); // HUD 는 DOM 이라 카메라 페이드가 안 걸린다

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
    for (const r of mansionData.rooms) {
      if (ALWAYS_LIT.has(r.id)) continue; // 덮개를 아예 안 만든다
      // 방 하나가 사각형 여럿일 수 있다 (서재(아래)가 ㄱ자다).
      const rects = r.rects ?? [{ x: r.x, y: r.y, w: r.w, h: r.h }];

      // 조각을 컨테이너로 묶는다 — 컨테이너 alpha 가 자식에게 곱해지므로
      // 밝기 조절은 여전히 값 하나를 트윈하면 된다.
      const parts = this.add.container(0, 0);
      for (const rect of rects) {
        // 이음매는 풀지 않는다 — 조각 사이를 풀면 방 한가운데 밝은 띠가 생긴다.
        parts.add(this.#featheredShroud(rect, r, rects));
      }
      // NPC(0)·김(6)보다 위, 플레이어(30)보다 아래.
      parts.setAlpha(r.id === 'lab' ? SHROUD_LOCKED : SHROUD_DIM).setDepth(20);
      this.asWorld(parts);
      this.shroud.set(r.id, parts);
    }
  }

  /**
   * 사각형 하나를 덮는 덮개. 가장자리가 바깥으로 갈수록 옅어진다.
   *
   * 안쪽은 꽉 찬 사각형 하나로 칠하고, 바깥으로 겹치지 않는 테를 한 겹씩 두르며 알파를
   * 떨어뜨린다. 겹치지 않게 그리므로 알파가 곱해져 진해지는 일이 없다.
   * 방의 바깥 가장자리만 푼다 — 다른 조각과 맞닿는 변은 그대로 둬야 이음매가 안 보인다.
   */
  #featheredShroud(rect, room, rects) {
    const x0 = rect.x * TILE;
    const y0 = rect.y * TILE;
    const w = rect.w * TILE;
    const h = rect.h * TILE;
    // 풀림 폭은 방 크기에 맞춰 줄인다 — 작은 방(빈 방은 6칸 높이)에서 고정 폭을 쓰면
    // 양쪽 풀림이 가운데서 만나 꽉 찬 안쪽이 사라지고, 방 전체가 훤해진다.
    const F = Math.min(SHROUD_FEATHER * TILE, w / 3, h / 3);

    /** 이 변이 같은 방의 다른 조각과 맞닿는가 — 맞닿으면 풀지 않는다. */
    const joins = (side) =>
      rects.some((o) => {
        if (o === rect) return false;
        const ox0 = o.x * TILE, oy0 = o.y * TILE, ox1 = ox0 + o.w * TILE, oy1 = oy0 + o.h * TILE;
        if (side === 'left') return ox1 === x0 && oy0 < y0 + h && oy1 > y0;
        if (side === 'right') return ox0 === x0 + w && oy0 < y0 + h && oy1 > y0;
        if (side === 'top') return oy1 === y0 && ox0 < x0 + w && ox1 > x0;
        return oy0 === y0 + h && ox0 < x0 + w && ox1 > x0;
      });
    const fl = joins('left') ? 0 : F;
    const fr = joins('right') ? 0 : F;
    const ft = joins('top') ? 0 : F;
    const fb = joins('bottom') ? 0 : F;

    const g = this.add.graphics();
    // 꽉 찬 안쪽
    g.fillStyle(SHROUD_COLOR, 1);
    g.fillRect(x0 + fl, y0 + ft, Math.max(0, w - fl - fr), Math.max(0, h - ft - fb));

    // 안쪽 사각형에서 바깥으로 한 겹씩 두른다. 겹치지 않게 그리므로 알파가 곱해져
    // 진해지는 일이 없다. 제곱으로 떨어뜨린다 — 선형이면 시작하는 지점에 선이 보인다.
    const STEPS = 12;
    // 겹 하나의 두께. 안 푸는 변은 0 이라 그쪽으로는 자라지 않는다.
    const dl = fl / STEPS, dr2 = fr / STEPS, dt = ft / STEPS, db = fb / STEPS;
    for (let i = 1; i <= STEPS; i++) {
      const a = (1 - i / STEPS) ** 1.7;
      if (a <= 0.004) break;
      g.fillStyle(SHROUD_COLOR, a);
      // 이번 겹의 바깥 테두리
      const ox = x0 + fl - dl * i;
      const oy = y0 + ft - dt * i;
      const ow = w - fl - fr + dl * i + dr2 * i;
      const oh = h - ft - fb + dt * i + db * i;
      // 지난 겹의 바깥 테두리 (이 안쪽은 이미 칠했다)
      const ix = x0 + fl - dl * (i - 1);
      const iy = y0 + ft - dt * (i - 1);
      const iw = w - fl - fr + dl * (i - 1) + dr2 * (i - 1);
      const ih = h - ft - fb + dt * (i - 1) + db * (i - 1);
      // 사이의 고리를 네 조각으로 (위·아래는 폭 전체, 좌·우는 그 사이만)
      if (iy - oy > 0) g.fillRect(ox, oy, ow, iy - oy);
      if (oy + oh - (iy + ih) > 0) g.fillRect(ox, iy + ih, ow, oy + oh - (iy + ih));
      if (ix - ox > 0) g.fillRect(ox, iy, ix - ox, ih);
      if (ox + ow - (ix + iw) > 0) g.fillRect(ix + iw, iy, ox + ow - (ix + iw), ih);
    }
    return g;
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
    // 연구실은 열쇠로 문을 열기 전까지 안 걷힌다 — 문이 열리면 #syncLabDoor 가 덮개를 지운다.
    if (!s || (room.id === 'lab' && !this.labUnlocked)) return;
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

    // 좌표는 새 그림에서 김이 오르는 자리다 (칸 → 픽셀). 화덕·조리대는 주방(6~16열,
    // 14~24행), 빨래통은 세탁실(6~16열, 5~13행) 안이다.
    const vents = [
      { col: 8, row: 19, tint: 0xffdcb0, freq: 210, rise: 34 }, // 주방 화덕
      { col: 11, row: 19, tint: 0xffe8cc, freq: 380, rise: 26 }, // 조리대 냄비
      { col: 7, row: 8, tint: 0xdde8ef, freq: 300, rise: 24 }, // 세탁 대야
      { col: 10, row: 8, tint: 0xdde8ef, freq: 420, rise: 22 },
    ].map((v) => ({ ...v, x: v.col * TILE + TILE / 2, y: v.row * TILE + TILE / 2 }));

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
    // 방 이름(#hud-room)은 60×34 저택에서 길을 잃지 않게 하는 최소 장치다 —
    // 들어간 순간 잠깐 떴다 사라진다. #showRoom 참고.
    this.hud = new Hud();
    this.hud.keys('[E] 대화    [Esc] 닫기');

    this.#updateHud();
  }

  /**
   * 진행도를 숫자로 세지 않는다 — 열쇠는 한 사람에게 있고, 그게 누구인지가 곧 과제다.
   * "0/3" 같은 눈금은 남은 분량을 알려 주지만 여기서는 알려 줄 분량 자체가 없다.
   */
  #updateHud() {
    this.hud.status(
      this.state?.hasKey
        ? '저택 잠입 — 마스터 키 ✔'
        : '저택 잠입 — 저택의 동료를 찾아라',
    );
  }

  /** 방이 바뀐 순간에만 이름을 띄운다 — 매 프레임 갱신하면 깜빡인다. */
  #showRoom(room) {
    this.hud.showRoom(room.name);
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
      // 오류는 커튼을 걷고 읽힌다 — 로딩 화면이 위를 덮은 채로 띄우면 [Space] 재시도
      // 안내가 그 아래 깔려 무엇이 잘못됐는지조차 보이지 않는다.
      new TransitionScreen().hide();
      this.startFailed = true;
      this.dialogue.show('오류', `저택에 들어갈 수 없습니다.\n${err.message}\n\n[Space] 로 다시 시도한다.`);
      return;
    }

    // sentry·player 는 경보 연출(#alarm)의 얼굴 — NPC 가 아니라서 목록에 따로 얹는다.
    this.dialogue.preload([
      this.state.escort.id,
      ...this.state.npcs.map((n) => n.id),
      'sentry',
      'player',
    ]);
    this.#spawnNpcs();
    this.#registerLabDoor();
    this.#registerObjects();
    this.#updateHud();

    // 저택이 다 지어졌다 — 이제 커튼을 걷는다 (**떠나는 쪽이 show, 도착한 쪽이 hide**
    // 라는 TransitionScreen 의 규약). 거리에서 넘어온 판은 이 400ms 가 곧 도착 연출이고,
    // 결과창의 [다시 잠입한다]로 되돌아온 판(ui/ResultOverlay.js#restart)도 같은 문으로
    // 들어온다. 안 떠 있었다면 hide 는 무해하다.
    new TransitionScreen().hide();

    // 에이던은 커튼이 다 걷힌 뒤에 말한다. 대화창도 DOM 이라 로딩 화면 **아래**에 깔려,
    // 곧바로 띄우면 브리핑 첫 문장이 커튼 뒤에서 흘러간다 — 거리에서 암전 위로 듣던
    // 그의 대사와 이어붙어 "장소를 옮겼다"가 사라지는 자리가 정확히 여기다.
    this.time.delayedCall(TRANSITION_FADE_MS, () => this.#showEscortBriefing());
  }

  #spawnNpcs() {
    const place = (npc) => {
      // 자리가 없는 인물은 세우지 않는다 — 좌표를 비워 두는 것이 그 표시다.
      if (npc.col == null || npc.row == null) return;
      const x = npc.col * TILE + TILE / 2;
      const y = npc.row * TILE + TILE / 2;
      const sprite = this.#standingNpc(npc.id, x, y);
      const label = worldLabel(this, x, y + LABEL_DY, npc.name, LABEL_STYLE);
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

  /**
   * 저택에 제자리로 서 있는 인물 하나. **발바닥이 (x, y)** 에 놓이고 화면에 보일 키는
   * 맵이 정한 charHeight 다 — 거리·본부와 같은 규칙이다 (StageScene#standingNpc 와 짝).
   *
   * 그림은 두 갈래인데 규칙은 하나다: 에이던만 다른 시트에서 프레임 하나를 떼어 쓰고
   * 나머지 열은 PixelLab 남향 정지 그림이다. **양쪽 다 움직이지 않는다** — 에이던의
   * 시트가 아이들 애니메이션이긴 해도 여기서는 재생하지 않는다(ESCORT_TEXTURE 주석).
   * 인물마다 그림 속 키가 달라 배율을 따로 잡는다 — 그래서 화면에서는 전원이 똑같은
   * 키로 선다.
   */
  #standingNpc(id, x, y) {
    if (id === this.state.escort.id) {
      const size = ESCORT_FRAME_SIZE * (PLAYER_HEIGHT / ESCORT_CONTENT_HEIGHT);
      // sprite 가 아니라 image 다 — 재생할 것이 없으면 애니메이션을 물 수 있는 객체를
      // 쓸 이유가 없고, image 로 두면 "여기서는 안 움직인다"가 코드로도 못박힌다.
      return this.add
        .image(x, y, ESCORT_TEXTURE, ESCORT_FRAME)
        .setOrigin(0.5, ESCORT_ORIGIN_Y)
        .setDisplaySize(size, size);
    }
    const size = NPC_FRAME_SIZE * (PLAYER_HEIGHT / NPC_CONTENT_HEIGHT[id]);
    return this.add
      .image(x, y, NPC_TEXTURE[id])
      .setOrigin(0.5, NPC_ORIGIN_Y)
      .setDisplaySize(size, size);
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
      // 기본 사거리(charHeight×1.5)보다 조금 넉넉하게 — 문 앞은 한 칸이라 비켜 서기 쉽다.
      range: PLAYER_HEIGHT * 1.75,
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
   * 문서 노드를 등록한다(문이 열려야 문서에 닿을 수 있다). 열림은 방 덮개가 걷히는
   * 것으로 보인다 — 그린 배경에 문짝이 따로 없어서 덮어 그릴 열림 그림도 없다.
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
    this.labUnlocked = true;
    // 덮개를 잠긴 상태(0.85)에서 보통 상태로 돌린다 — 안 그러면 문을 열고 들어가도
    // 방이 계속 어둡다. 지금 그 방에 서 있으면 곧바로 밝아진다.
    const lab = mansionData.rooms.find((r) => r.id === 'lab');
    if (lab) this.#setRoomLight(lab, this.currentRoom?.id === 'lab');

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
    // ⚠ 걸음 소리는 매 프레임 setLoop('walk', moving) 로 유지되는 루프라, 조기 return
    // 하는 갈래는 전부 먼저 꺼야 한다 — 안 끄면 마지막 상태 그대로 계속 울린다
    // (2026-08-08 피드백, StageScene#update 머리말에 같은 규칙을 적어 뒀다).
    if (this.ended) {
      setLoop('walk', false);
      return;
    }

    // 대화창이 열리는 순간 화면 전체가 얼어붙는다(2026-08-07 플레이테스트 피드백).
    setWorldPaused(this, this.dialogue.isOpen);

    // 키 상태는 어떤 조기 return 보다 먼저 매 프레임 소비한다 — 단락 평가로 건너뛰면
    // 눌린 채 남은 플래그가 패널이 닫히거나 응답이 도착한 프레임에 뒤늦게 발동한다.
    const pressedTalk = Phaser.Input.Keyboard.JustDown(this.keyE);
    const pressedSpace = Phaser.Input.Keyboard.JustDown(this.keySpace);
    const pressedEsc = Phaser.Input.Keyboard.JustDown(this.keyEsc);

    // 밀고 확정 후 창이 닫힌 순간 판을 끝낸다 (#chat 의 reportedPending 참고).
    if (this.reportedPending && !this.dialogue.isOpen) {
      setLoop('walk', false); // 위 규칙 — 판이 끝나는 갈래도 발소리를 끄고 나간다
      this.#endGame('reported');
      return;
    }

    // 문서 열람 중 세계는 정지한다 — 월드 카메라 키입력도 먹히지 않는다.
    if (this.docPanel?.isOpen) {
      this.player.body.setVelocity(0, 0);
      setLoop('walk', false);
      // 멈춘 김에 걷기 애니메이션도 접어야 한다 — 안 그러면 제자리에서 계속 걷는다.
      this.playerVisual.update();
      return;
    }

    const typing = this.dialogue.isTyping;
    let moving = false;
    if (typing) this.player.body.setVelocity(0, 0);
    else moving = applyMovement(this.player, { cursors: this.cursors, wasd: this.wasd });
    setLoop('walk', moving);
    this.playerVisual.update();

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
    // [Esc] — 위에 덮인 것부터 걷는다: 대화창이 떠 있으면 그것을, 아니면 설정 창을 연다.
    // 입력칸에 글을 쓰는 중이면 여기까지 오지 않는다 (DialogueBox 가 직접 처리한다).
    if (pressedEsc) {
      if (this.dialogue.isOpen) this.dialogue.hide();
      else this.settings.openPaused(this, () => this.keyEsc.reset());
    }
  }

  /** 선택지 "대화하기" — 자유 입력을 연다. */
  #talk(npc) {
    // 이미 정보를 준 동료 — 자유 대화를 다시 열지 않고 그때 한 말을 되풀이한다
    // (2026-08-08 기획). 서버도 두 번은 안 주므로(gave), 입력칸을 열어 두면 아무리
    // 말을 붙여도 같은 자리를 맴도는 잡담만 남는다. 무엇을 얻었는지 다시 확인하는
    // 창구로 쓰는 편이 낫다 — 열쇠 위치도 단서도 이 대사 안에 있다.
    const reward = this.rewardLines.get(npc.id);
    if (npc.gave && reward) {
      this.dialogue.hideChoices();
      this.dialogue.hideInput();
      this.dialogue.show(npc.name, reward, { portrait: npc.id });
      this.dialogue.setHint('[Space] 다음 · [Esc] 닫기');
      return;
    }

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

    if (pending) await this.#applyEvent(pending);
    // 마지막 장을 넘겼을 때 무엇을 할지는 **대화가 이어지느냐**로 갈린다.
    //  - 입력칸이 남아 있으면(평범한 답변) 초점을 되돌려 이어서 말하게 한다. 안 넣으면
    //    advance() 가 창을 닫아 버려서, "[Space] 다음"이라 써 놓고 마지막 [Space] 에
    //    대화가 끝난다 — 안내와 실제가 어긋난다.
    //  - 입력칸이 접혔으면(정보를 줬거나·밀고·굳음) 더 할 말이 없으므로 그냥 닫는다.
    //    null 을 넘기면 advance() 의 기본 동작(hide)이 그대로 산다.
    const canGoOn = this.dialogue.inputVisible;
    this.dialogue.endStream('[Space] 다음 · [Esc] 닫기', {
      onPagesDone: canGoOn ? () => this.dialogue.focusInput() : null,
    });
    // 페이지가 남았으면 초점을 입력칸에서 뗀다 — 초점이 거기 있으면 [Space] 가
    // 페이지가 아니라 글자가 되어 뒷장을 볼 수 없다(2026-08-08 피드백). 접지 않고
    // 초점만 비키므로, 다 읽고 나면 위의 onPagesDone 이 그대로 대화를 이어 준다.
    if (this.dialogue.hasMore) this.dialogue.blurInput();
    // 밀고는 즉시 끝내지 않는다 — 즉시 ended 를 세우면 update() 가 멈춰 [Space] 페이지
    // 넘김이 죽고, 플레이어가 진 이유를 읽기 전에 결과 화면이 덮는다.
    // 창이 닫히는 순간(다 읽고 넘겼든, Esc 로 닫았든, 대기 중 이미 닫아 뒀든) 끝낸다.
    if (pending?.event === 'reported') this.reportedPending = true;
  }

  /** 서버가 알려준 상태를 기존 객체에 덮어쓴다 — 노드가 쥔 참조를 살려 두기 위해서. */
  #syncState(view) {
    this.state.hints = view.hints;
    this.state.hasKey = view.hasKey;
    this.state.cleared = view.cleared;
    this.state.over = view.over;
    this.state.objects = view.objects;
    for (const n of view.npcs) {
      const cur = this.state.npcs.find((x) => x.id === n.id);
      if (cur) Object.assign(cur, n);
    }
  }

  /**
   * 동료를 확인한 순간(key/hint)은 여느 대화 턴과 달라야 한다 — 예전엔 이 순간에도
   * 그냥 보상 문구 한 줄이 조용히 이어 붙을 뿐이라, 플레이어가 "뭔가 풀렸다"는 걸
   * 느낄 길이 없었다(2026-08-07 피드백). 그래서 이 사건만 따로 세 박자로 늘어뜨린다:
   * ① 동료가 "이제 확인됐다"는 그 순간의 반응(revealLine) — 정보가 아니라 반응이다.
   * ② (열쇠 보유자만) 화면 플래시 — 열쇠를 건네받는 무게를 그림 없이 카메라 효과로 낸다.
   * ③ 실질 정보(key/hint 원문)와 시스템 안내.
   * `#chat` 이 이 함수를 끝까지 기다린 뒤에야 "[Space] 다음" 힌트를 띄우므로, 대사가
   * 다 나오기 전에 다음으로 넘어가란 안내가 먼저 뜨는 일은 없다.
   */
  async #applyEvent({ event, revealLine, line, state }) {
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
    if (event === 'key' || event === 'hint') {
      // 여기서 대화가 끝난다 — **입력칸을 먼저 접는다.** 접기 전에는 [Space] 가
      // 페이지 넘김이 아니라 입력칸의 글자가 되어서, 뒤에 이어 붙는 정보 대사를
      // 읽을 방법이 아예 없었다(2026-08-08 피드백). 이 사건이 나온 뒤로 이 동료와
      // 더 나눌 말은 없으므로(서버도 gave 를 세워 두 번은 안 준다) 접는 것이 맞다.
      this.dialogue.hideInput();

      // 받은 대사는 그대로 적어 둔다 — 다시 말을 걸면 이걸 되풀이한다 (#talk).
      const rewardOwner = this.currentNpcId;

      if (revealLine) {
        await this.#beat(400);
        this.dialogue.append(`\n\n"${revealLine}"`);
        await this.#beat(1800);
      }
      playSfx('clear');
      // 플래시는 **확인된 모든 동료**에게 건다 (2026-08-08 피드백 — 열쇠 보유자에게만
      // 걸려 있어서, 클라라·오스카를 확인했을 때는 소리만 나고 아무 일도 안 일어난
      // 것처럼 보였다). 다만 세기로 위계를 남긴다: 열쇠를 건네받는 순간은 이 판에서
      // 가장 큰 사건이라 더 밝고 길게, 단서는 짧고 옅게 — 둘이 같으면 열쇠의 무게가 죽는다.
      const flash = event === 'key' ? [400, 255, 255, 255] : [260, 210, 190, 140];
      this.cameras.main.flash(...flash, false);
      this.uiCam?.flash(...flash, false);
      await this.#beat(event === 'key' ? 300 : 200);
      // 보상 문구는 서버가 쥔 원문 그대로 붙인다 — 모델이 고쳐 말하면 단서가 흐려진다.
      const notice =
        event === 'key'
          ? '[세드릭에게서 저택의 마스터 키를 건네받았다. 하인 통로 끝의 연구실 문을 열 수 있다.]'
          : '[열쇠를 쥔 사람의 단서를 얻었다.]';
      this.dialogue.append(`\n\n"${line}"`);
      this.dialogue.append(`\n\n${notice}`);

      // 되풀이할 때는 그때 흘러나온 LLM 답변은 빼고 **정해진 부분만** 남긴다 —
      // 자유 대화 쪽은 매번 다른 말이라 "마지막 대사"로 다시 보여줄 것이 못 된다.
      if (rewardOwner) {
        const parts = revealLine ? [`"${revealLine}"`] : [];
        parts.push(`"${line}"`, notice);
        this.rewardLines.set(rewardOwner, parts.join('\n\n'));
      }
    }
  }

  /**
   * [E] — 연구실 문서. 입장만으로는 클리어가 아니다 (수정안 p.20).
   *
   * 읽기 시작한 순간 결말은 정해진다: 일정 시간이 지나면 문서가 저절로 덮이고 경보가
   * 울린다 (기획 목업 2026-08-05). 먼저 덮어도(Space/Esc/클릭) 그 순간 울린다 —
   * 어느 쪽이든 경보는 피할 수 없다. 조기 종료를 그냥 보내 주면 cleared 세션의
   * reading 가드에 걸려 문서를 다시 펼 수도, 판을 진행할 수도 없는 구멍이 생긴다.
   */
  async #readDocument() {
    if (this.reading || this.state.cleared) return;
    this.reading = true;
    this.dialogue.hide();
    this.docPanel.open({ title: DOCUMENT.name, body: DOCUMENT.body });

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
      // open() 이 onClose 를 비워 두었으므로 이 close 는 경보를 부르지 않는다.
      this.docPanel.close();
      this.dialogue.reply('오류', err.message);
      return;
    }

    // 서버가 클리어를 기록한 뒤에야 경보를 건다 — 왕복이 실패했는데 연출만 나가면
    // 화면은 스테이지 3 인데 세션은 진행 전인 채로 갈라진다.
    if (!this.docPanel.isOpen) {
      // 응답을 기다리는 사이에 이미 덮었다 — 바로 울린다.
      this.#alarm();
      return;
    }
    this.docPanel.onClose = () => this.#alarm();
    // close() 가 onClose 를 부르므로 타이머는 덮기만 한다. 경보가 이미 울린 뒤에
    // 도는 판(조기 종료)에서는 패널이 닫혀 있어 close() 가 그대로 무시된다.
    this.time.delayedCall(DOC_ALARM_MS, () => this.docPanel.close());
  }

  /**
   * 경보 — 문서가 덮이는 순간 저택이 깨어난다 (기획 목업 2026-08-05).
   *
   * 결과 화면을 띄우지 않는다 — 판이 끝나는 자리가 아니라 이야기가 스테이지 3
   * (지하 수로 탈출)으로 이어지는 자리다 (StageScene#toMansion 과 같은 원칙).
   * 예전에는 여기서 '문서 확보' 결과 화면을 덮고 저택을 재시작하게 했다.
   */
  async #alarm() {
    if (this.ended) return;
    this.ended = true; // update() 를 멈춘다 — 이후는 연출 시간이다
    this.player.body.setVelocity(0, 0);
    // 어느 경로로 왔든 문서는 이미 덮여 있지만(close 가 부른다), 안전하게 한 번 더 —
    // onClose 를 먼저 비워 close() → #alarm 재진입 고리를 끊는다.
    this.docPanel.onClose = null;
    this.docPanel.close();

    // 소리가 먼저 온다 — 무슨 일이 벌어졌는지는 아직 모른다.
    playSfx('boom');
    this.cameras.main.shake(320, 0.004);
    this.dialogue.show('연구실', '(밖에서 소란스러운 소리가 들린다.)');
    this.dialogue.setHint('');
    await this.#beat(2000);

    // 경보 방송 — 저택의 로봇들이 깨어난다. 방송이지만 얼굴은 로봇을 세운다:
    // "누가 깨어났는가"를 그림 한 장으로 보여 주는 자리다. 그림은 스테이지 3 의
    // 감시 로봇(일러스트 26_전투 로봇, 검은 장갑·붉은 센서)과 같은 기체 — 이 경보가
    // 곧 그 추격으로 이어진다는 예고이기도 하다.
    this.cameras.main.flash(240, 194, 37, 26);
    // 침입자를 특정했다는 대사다 — 배경음이 계속 돌면 위협이 묻힌다. 여기서 끊고
    // 경고음이 그 자리를 대신한다.
    stopBgm();
    playSfx('warning');
    this.dialogue.show('경보', '"침입자 정보 발견, 경계 태세 강화."', { portrait: 'sentry' });
    await this.#beat(2600);

    this.dialogue.show('나', '이런, 일단 이 기록들을 챙겨서 탈출하자.', { portrait: 'player' });
    await this.#beat(2600);

    // 탈출 대사 출력 후 페이드 아웃 (목업 3) — 받는 쪽 연출은 EscapeScene#playIntro.
    this.dialogue.hide();
    this.cameras.main.fadeOut(900, 0, 0, 0);
    this.uiCam?.fadeOut(900, 0, 0, 0);
    this.hud.fadeOut(900); // HUD 는 DOM 이라 카메라 페이드가 안 걸린다
    this.cameras.main.once('camerafadeoutcomplete', async () => {
      // 저택 연구실에서 지하 수로까지는 **도망친 거리**가 있다 — 경보가 울리는 방에서
      // 곧바로 수로 바닥으로 이어지면 그 사이가 통째로 사라진다. 스테이지 1 → 2 와
      // 같은 화면으로 그 사이를 채운다 (TransitionScreen.SCENE_TRANSITION_MS 주석).
      new TransitionScreen().show('저택을 빠져나가는 중', '경보가 등 뒤로 멀어진다');
      await this.#beat(SCENE_TRANSITION_MS);
      this.scene.start('Escape');
    });
  }

  /** 연출용 사이 — delayedCall 을 await 할 수 있게 감싼다 (StageScene#beat 과 같은 모양). */
  #beat(ms) {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  /**
   * 판을 패배로 끝낸다 — 지금 여기로 오는 길은 밀고('reported')뿐이다.
   * 문서 열람은 2026-08-05 부터 결과 화면 대신 스테이지 3 으로 이어진다 (#alarm).
   */
  #endGame(outcome) {
    if (this.ended) return;
    this.ended = true;
    this.player.body.setVelocity(0, 0);

    // 마지막 대사가 닫힌 뒤 한 호흡 두고 결과를 덮는다 — 즉시 덮으면 무슨 일이
    // 있었는지 되짚을 틈이 없다.
    this.time.delayedCall(2000, () => {
      this.result.show({
        outcome,
        codeWord: null,
        stats: [
          this.state.hasKey ? '연구실 열쇠 확보' : '열쇠 없음',
          `조사한 단서 ${this.state.objects.filter((o) => o.found).length}/${this.state.objects.length}`,
        ],
        // 저택은 시작에 LLM 대기가 없다 — 스테이지 1의 /start 를 부르면 안 된다.
        restart: async () => ({ state: null }),
        waitTitle: '저택으로 돌아가는 중',
        waitText: '괘종시계 앞에서 다시 시작한다',
        onRestart: () => this.scene.restart(),
      });
    });
  }
}
