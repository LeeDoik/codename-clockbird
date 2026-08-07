import Phaser from 'phaser';
import {
  applyMovement,
  buildColliders,
  createPlayer,
  createPlayerVisual,
  setupCameras,
  setWorldPaused,
  DEFAULT_CHAR_HEIGHT,
} from '../world/worldParts.js';
import {
  PLAYER_ANIM,
  PLAYER_CONTENT_HEIGHT,
  PLAYER_FRAME_SIZE,
  PLAYER_ORIGIN_Y,
} from '../entities/playerSprite.js';
import escapeData from '../assets/escape.json';
import escapeProps from '../assets/escape-props.json';
import { Sentry } from '../entities/Sentry.js';
import {
  EVA_ANIM,
  EVA_CONTENT_HEIGHT,
  EVA_FRAME_SIZE,
  EVA_ORIGIN_Y,
  EVA_WALK_SPEED,
} from '../entities/evaSprite.js';
import { facingName } from '../entities/facing.js';
import { makeBlockedLookup } from '../world/los.js';
// 좌표·상수의 단일 출처. 씬은 여기서만 읽는다 — 씬 안에 좌표를 다시 적지 않는다.
import {
  EVA,
  RESPAWN_GRACE_MS,
  SENTRY_HOMES,
  SPAWN,
  TILE,
  at,
  makeRoamBlocked,
} from '../world/escapeLayout.js';
import { MinigamePanel } from '../ui/MinigamePanel.js';
import { DialogueBox } from '../ui/DialogueBox.js';
import { GameOverOverlay } from '../ui/GameOverOverlay.js';
import { runRobotInterrogation } from '../minigames/robotInterrogation.js';
import { FONTS } from '../ui/theme.js';
import { playBgm, setLoop, setLoopVolume, playSfx } from '../audio/SoundManager.js';

/**
 * 스테이지 3 — 저택 탈출.
 *
 * 저택에서 문서를 훔쳐 지하로 도망친 직후다. 여기서는 말이 통하지 않는다 —
 * 경비는 구형 순찰 로봇이고, 걸리면 변명할 기회가 없다 (이미 문서를 쥐고 있다).
 *
 * 길은 물웅덩이 넷을 도는 순환 통로다. 바깥 띠와 가운데 십자 복도가 전부라 잃을 수
 * 없고, 어려운 것은 길이 아니라 **언제 지나가느냐**다 — 로봇 셋이 맵 전역을 돈다.
 * 예전에는 그 십자를 하나씩 맡아 왕복했는데, 주기가 일정해 지나갈 틈이 아예 안 났다
 * (escapeLayout.SENTRY_HOMES).
 */

/**
 * 플레이어는 튜토리얼부터 엔딩까지 **같은 인물**이다 (2026-08-02 확정).
 * 스테이지마다 다른 스프라이트를 쓰면 사람이 바뀐 것처럼 보인다.
 *
 * 앞의 두 상수는 **그 스프라이트 시트 안에서 인물이 어디 있는가**라, 시트를 바꾸면
 * 같이 바뀐다 (tutorial 시트 실측값 — TutorialScene 과 동일).
 * PLAYER_HEIGHT 만 다르다: 그건 **이 맵에서 화면에 얼마로 보일지**이고, 맵이 정한다.
 */
const PLAYER_FRAME = 0;
/** 화면에 보일 인물 높이 — 맵이 정한다 (worldParts.DEFAULT_CHAR_HEIGHT 참고). */
const PLAYER_HEIGHT = escapeData.charHeight ?? DEFAULT_CHAR_HEIGHT;

/**
 * 발각 게이지 — 0 에서 시작해 오르고 100 에서 터진다.
 * (심문의 탐지 게이지는 100 에서 시작해 내려간다. 방향이 반대이므로 이름을 절대 섞지 않는다.)
 */
const GAUGE_MAX = 100;
/** 콘 안에 있을 때 초당 상승 — 약 1.8초 노출이면 터진다 */
const GAUGE_RISE = 55;
/** 콘 밖일 때 초당 하강 — 약 2.5초면 회복 */
const GAUGE_FALL = 40;
/**
 * 콘을 벗어난 뒤 하강이 시작되기까지의 유예 (ms).
 * 이게 없으면 콘 경계에서 게이지가 깜빡이며 오르내려 플레이어가 규칙 자체를 못 읽는다.
 */
const GAUGE_GRACE_MS = 1000;
/**
 * 경고음 최대 볼륨 (0~1). 게이지가 다 찰 때 이 값에 닿는다 — 사이렌처럼 계속 크게
 * 울리면 정작 중요한 순간(발각 직전)의 위기감이 묻히므로 다른 효과음보다 낮게 잡는다.
 */
const WARNING_MAX_VOLUME = 0.3;

/**
 * 에바가 ㄴ 자로 다가올 때 **먼저 내려오는 거리** (월드 px, #evaApproach).
 *
 * 플레이어가 에바보다 아래에 있으면 그 행까지 내려오므로 이 값은 하한이다 — 플레이어가
 * 에바와 거의 같은 행에 서 있어도 꺾임이 보이도록 최소한 이만큼은 내려온다.
 *
 * 상한은 발동 구역이 정한다: 에바는 2행(y 80)에 서고 구역은 5행(y 176)까지라, 여기에
 * 96px 보다 큰 값을 넣으면 꺾이는 자리가 구역 밖으로 나가 걷는 칸이라는 보장이 깨진다.
 */
const EVA_DESCENT = TILE * 1.5;

/**
 * 심문을 통과하고 혼자 남아 속으로 하는 말 (2026-08-07 대사 개정).
 *
 * 괄호로 묶은 것은 오타가 아니다 — **소리 내지 않은 말**이다. 이 장면에 남은
 * 사람은 자기 하나뿐이라 대사로 적으면 허공에 말하는 것이 된다. 두 문장이라
 * 한 호흡씩 나눠 보여준다(#toEnding — MansionScene#alarm 과 같은 규칙).
 */
const MONOLOGUE = ['(진짜로 로봇이 나를 놓아 준다고?!)', '(일단 본부로 돌아가자, 빨리 보고해야해)'];

export class EscapeScene extends Phaser.Scene {
  constructor() {
    super('Escape');
  }

  init() {
    this.ended = false;
    /** 도입 연출 중 — update 를 통째로 멈춘다 (#playIntro) */
    this.intro = false;
    this.gauge = 0;
    /** 콘 밖으로 나온 뒤 하강이 시작되는 시각 */
    this.fallAt = 0;
    /** 이 시각 전에는 감지하지 않는다 (리스폰 직후) */
    this.graceUntil = 0;
    /** 지금까지 발각된 횟수 — 페널티는 없고 밸런싱·영상용으로만 센다 */
    this.retries = 0;
    /** 리스폰 연출 중 — update 를 통째로 멈춘다 */
    this.respawning = false;
  }

  create() {
    playBgm('stage3');
    // 네 맵이 같은 방식이다 — 한 장에 구운 배경을 1:1 로 깔고 충돌만 따로 세운다.
    this.add.image(0, 0, 'escape-bg').setOrigin(0, 0).setDepth(-100);
    this.walls = buildColliders(this, escapeData, escapeProps);
    this.player = createPlayer(this, escapeData, this.walls, PLAYER_FRAME);
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

    // 시야가 보는 벽은 충돌이 보는 벽과 같아야 한다 — 수로는 물이 시야를 막는다.
    this.isBlocked = makeBlockedLookup(escapeData, escapeProps);
    // 로봇 셋은 정해진 길이 없다 — 도로(ROAM_ROADS) 위를 무작위로 돈다 (Sentry 머리말).
    // 배회만 도로로 제한하고 시야는 isBlocked 그대로다 — makeRoamBlocked 주석 참고.
    // cols·rows 는 길찾기가 격자를 훑는 범위다.
    const roamBlocked = makeRoamBlocked(this.isBlocked);
    this.sentries = SENTRY_HOMES.map(
      (home) =>
        new Sentry(this, {
          home,
          tileSize: TILE,
          cols: escapeData.cols,
          rows: escapeData.rows,
          isBlocked: this.isBlocked,
          roamBlocked,
        }),
    );

    // 월드를 다 깐 직후·UI 를 만들기 전에 부른다 (worldParts.setupCameras 의 호출 시점 규약).
    setupCameras(this, escapeData, this.player);

    // 게이지 바와 비네트는 화면 고정이다 — UI 카메라에 붙인다.
    //
    // 액자는 9분할(nineslice)이다. 통짜 이미지를 늘리면 양끝 청동 캡과 리벳이 같이
    // 늘어나 뭉개진다 — DOM 쪽 `border-image ... round` 와 같은 이유이고, 캔버스에서
    // 그 역할을 하는 것이 nineslice 다. 좌우 캡 25px · 위아래 레일 10px 은
    // public/ui/alert-gauge.png(292×42)를 재서 정했다.
    //
    // ⚠ **액자를 먼저 깔고 막대를 그 위에 얹는다.** 반대로 두었다가 게이지가 통째로
    //   안 보였다 — CSS 의 `border-image` 는 slice 에 `fill` 이 없으면 가운데를 아예
    //   안 그리지만, **Phaser 의 nineslice 는 가운데도 그린다.** 액자 그림의 가운데는
    //   불투명한 검은 쇠(실측 100%)라 그 아래 붉은 막대를 완전히 덮었다.
    //
    //   막대가 캡을 가리지는 않는다. 액자가 460 인데 막대는 410 이고(좌우 캡 25씩),
    //   높이도 46 대 18 이라 위아래 레일 안쪽에 들어앉는다.
    const GAUGE_W = 410; // 액자 460 에서 좌우 캡 25씩 뺀 안쪽 폭
    this.gaugeFrame = this.add.nineslice(960, 40, 'alert-gauge', undefined, 460, 46, 25, 25, 10, 10);
    this.gaugeBg = this.add.rectangle(960, 40, GAUGE_W, 18, 0x000000, 0.55);
    this.gaugeFill = this.add.rectangle(960 - GAUGE_W / 2, 40, 0, 18, 0xc25b4a, 0.95).setOrigin(0, 0.5);
    /**
     * 발각 경고 — 콘 안에 있는 동안만 게이지 위에 뜬다.
     *
     * 게이지 막대만으로는 **지금 걸리고 있다**가 안 읽힌다. 화면 맨 위의 얇은 띠라
     * 발밑을 보며 걷는 동안에는 시야 밖이고, 붉은 콘 안에 서 있어도 그 콘이 원래
     * 붉어서 "들어왔다"는 순간이 안 잡힌다. 글자 하나가 그 순간을 못박는다.
     */
    this.alertText = this.add.text(960, 84, '발 각 됨', {
      fontFamily: FONTS.head, fontSize: '34px', color: '#ff5a3c',
      stroke: '#2a0d06', strokeThickness: 6,
    }).setOrigin(0.5).setAlpha(0);
    this.vignette = this.add.rectangle(960, 540, 1920, 1080, 0xc2251a, 0).setOrigin(0.5);
    this.retryText = this.add.text(1880, 24, '', {
      fontFamily: 'monospace', fontSize: '20px', color: '#8a8378',
    }).setOrigin(1, 0);
    this.asUi(this.gaugeFrame, this.gaugeBg, this.gaugeFill, this.alertText, this.vignette, this.retryText);

    this.panel = new MinigamePanel();
    this.dialogue = new DialogueBox();
    this.gameover = new GameOverOverlay();
    // 에바는 **처음에는 없다**. 북쪽 복도에 발을 들이는 순간 나타난다 (기획 도면).
    // 미리 세워 두면 맵 저쪽 끝에 서 있는 것이 보여서, 올라가는 내내 "저기 뭔가 있다"가
    // 되어 버린다 — 도면이 말하는 '등장'은 그 반대다.
    //
    // Object.values(at(...)) 는 at() 이 { x, y } 순서로 리턴하는 데 암묵적으로 기대던 것 —
    // 그 리터럴 순서가 바뀌면(예: { y, x }) 에러 없이 좌표가 뒤바뀐다. 명시적으로 뽑는다.
    const evaPos = at(EVA.col, EVA.row);
    const evaScale = PLAYER_HEIGHT / EVA_CONTENT_HEIGHT;
    // ⚠ **재생을 먼저, 크기를 나중에** (Patrol 과 같은 함정 — 그쪽 주석 참고).
    this.eva = this.add.sprite(evaPos.x, evaPos.y, EVA_ANIM.texture, 0).setOrigin(0.5, EVA_ORIGIN_Y);
    this.eva.play(EVA_ANIM.idleDown);
    this.eva.setDisplaySize(EVA_FRAME_SIZE * evaScale, EVA_FRAME_SIZE * evaScale).setVisible(false);
    this.asWorld?.(this.eva);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');

    this.#playIntro();
  }

  /**
   * 도입 — 저택에서 경보를 등지고 수로로 뛰어내린 직후다 (기획 목업 2026-08-05).
   *
   * 화면을 한 톤 죽인 채(Dim) 규칙을 한 번 말하고 시작한다: 여기는 말이 통하는 곳이
   * 아니고, 걸리면 심문이 아니라 끝이다. 완전한 검정이 아니라 수로가 비쳐 보여야
   * "이제 이 길을 걷는다"가 대사와 함께 읽힌다.
   *
   * 대사가 걷히면 리스폰과 같은 무적 유예를 주고 놓아 준다 — 읽는 동안에도 로봇은
   * 돌고 있어서, 유예가 없으면 첫 걸음을 떼기 전에 잡힐 수 있다.
   */
  async #playIntro() {
    this.intro = true;
    // 저택의 페이드 아웃을 받아 어둠에서 밝아 온다 (씬 전환 규약 — Mansion create 와 동일).
    this.cameras.main.fadeIn(700, 0, 0, 0);
    this.uiCam?.fadeIn(700, 0, 0, 0);

    const dim = this.add.rectangle(960, 540, 1920, 1080, 0x000000, 0.55);
    this.asUi(dim);

    // 두 문장을 한 번에 넣으면 대화창이 페이지를 나눠 둘째 문장이 ▼ 뒤에 숨는다 —
    // 도입 중에는 update 가 멈춰 있어 [Space] 로 넘길 수도 없다. 한 박자씩 보여 준다.
    this.dialogue.show('나', '전투 로봇이 쫙 깔렸네. 잡히면 바로 죽음이야.');
    this.dialogue.setHint('');
    await this.#beat(2400);
    this.dialogue.show('나', '최대한 몸을 숨기면서, 출구까지 이동하자.');
    await this.#beat(2600);
    this.dialogue.hide();

    this.tweens.add({ targets: dim, alpha: 0, duration: 500, onComplete: () => dim.destroy() });
    this.graceUntil = this.time.now + RESPAWN_GRACE_MS;
    this.intro = false;
  }

  update(time, delta) {
    // 대화창이 떠 있는 동안(독백·연출 대사 등)은 화면 전체가 멈춘다 — 대화에 손이
    // 묶인 채 일방적으로 발각되는 것도 막고, 뒤에서 로봇이 계속 돌아다니는 것도
    // 막는다(2026-08-07 플레이테스트 피드백: 딤 처리 아래는 완전히 정지해야 한다).
    // ended/respawning/intro 는 다르다 — 그때는 로봇이 계속 걷되(다만 감지는 꺼서)
    // 화면이 살아 있어야 리스폰 연출이 죽어 보이지 않는다.
    setWorldPaused(this, this.dialogue.isOpen);
    if (this.dialogue.isOpen) {
      this.player.body.setVelocity(0, 0);
      setLoop('walk', false);
      this.playerVisual.update();
      return;
    }

    if (this.ended || this.respawning || this.intro) {
      this.player.body.setVelocity(0, 0);
      setLoop('walk', false);
      // 발각된 순간(#caught) 게이지가 꽉 찬 채로 여기 들어올 수 있다 — 걸음 소리와
      // 같은 이유로 같이 끊는다. 안 그러면 리스폰 연출 내내 경고음이 최대 볼륨으로 남는다.
      setLoop('warning', false);
      for (const s of this.sentries) s.update(delta, null);
      this.playerVisual.update();
      return;
    }

    const moving = applyMovement(this.player, { cursors: this.cursors, wasd: this.wasd });
    setLoop('walk', moving);
    this.playerVisual.update();

    // 배수구 앞 통로에 발을 들이면 에바가 나타나고 심문이 시작된다 — 한 번만 발동한다.
    // 가로·세로를 **둘 다** 본다: 행만 보면 좌우 세로 복도가 그대로 이 띠로 이어져
    // 있어서 복도 맨 위 모서리에 닿는 순간 걸린다 (escapeLayout.EVA 주석 참고).
    if (!this.ended) {
      const col = Math.floor(this.player.x / TILE);
      const row = Math.floor(this.player.y / TILE);
      const z = EVA.zone;
      if (col >= z.col0 && col <= z.col1 && row >= z.row0 && row <= z.row1) {
        this.#startInterrogation();
      }
    }

    let seen = false;
    const canDetect = this.time.now >= this.graceUntil;
    for (const s of this.sentries) {
      if (s.update(delta, canDetect ? this.player : null)) seen = true;
    }

    if (seen) {
      this.gauge = Math.min(GAUGE_MAX, this.gauge + (GAUGE_RISE * delta) / 1000);
      this.fallAt = this.time.now + GAUGE_GRACE_MS;
    } else if (this.time.now >= this.fallAt) {
      this.gauge = Math.max(0, this.gauge - (GAUGE_FALL * delta) / 1000);
    }

    // 게이지가 찰수록 경고음도 함께 커진다 — 콘 밖으로 나가면 즉시 끊는다(다음
    // 발각 때 다시 작은 소리부터 시작해야 "또 걸렸다"는 느낌이 새로 산다).
    setLoop('warning', seen);
    if (seen) setLoopVolume('warning', WARNING_MAX_VOLUME * (this.gauge / GAUGE_MAX));

    this.#drawGauge(seen);

    if (this.gauge >= GAUGE_MAX) this.#caught();
  }

  /**
   * 위험도를 화면에 세 겹으로 알린다.
   *
   * 한 겹으로는 부족했다. 게이지 막대는 화면 맨 위의 얇은 띠라 발밑을 보며 걷는
   * 동안 시야 밖이고, 붉은 콘은 원래 붉어서 "들어왔다"는 **순간**이 안 잡힌다.
   *
   *   1. 막대 — 얼마나 찼는가 (숫자에 해당하는 정보)
   *   2. 비네트 — 안 보고 있어도 화면 가장자리가 붉어진다
   *   3. 경고 글자 — 콘 안에 **있는 동안만** 깜빡인다 (지금 걸리는 중이라는 사실)
   *
   * @param {boolean} seen 이번 프레임에 콘 안에 있었는가
   */
  #drawGauge(seen) {
    const ratio = this.gauge / GAUGE_MAX;
    // 410 은 액자 안쪽 폭이다 (create 의 GAUGE_W). 액자 폭을 고치면 여기도 고친다.
    this.gaugeFill.width = 410 * ratio;
    // 찰수록 달아오른다 — 같은 붉은색이 길어지기만 하면 얼마나 급한지가 안 읽힌다.
    this.gaugeFill.fillColor = ratio > 0.66 ? 0xff3a20 : ratio > 0.33 ? 0xe0662a : 0xc98a27;

    // 가장자리가 붉어진다. 0.28 은 너무 옅어 바닥의 붉은 콘에 묻혔다 — 게다가
    // 비율에 정비례하면 초반이 거의 안 보인다. 제곱근을 쓰면 **들어서자마자** 뜬다.
    this.vignette.fillAlpha = 0.45 * Math.sqrt(ratio);

    // 콘 안에 있는 동안만. 깜빡임은 시간으로 만든다 — 트윈을 켜고 끄면 벗어나는
    // 순간 어중간한 밝기에서 굳는다.
    this.alertText.setAlpha(seen ? 0.55 + 0.45 * Math.sin(this.time.now / 90) : 0);

    this.retryText.setText(this.retries ? `재시도 ${this.retries}` : '');
  }

  /**
   * 발각 — 검거 연출(GameOverOverlay)을 세운 뒤 시작 지점으로 돌려보낸다.
   *
   * 계획서는 "즉시 게임오버"였지만 1분 30초짜리 맵을 통째로 다시 걷게 하면 그것이
   * 루즈함의 주범이 된다 (스펙 §1 기각 이유) — 그래서 결과 화면·재시작 버튼 없이
   * 연출 한 장면만 서고 저절로 다시 시작한다. 아무 키로 건너뛸 수 있어 손이 빠른
   * 사람에게는 여전히 즉시 재시도다 (붉은 번쩍임 0.4 + 건너뛴 연출 + 걷힘 0.4).
   *
   * 순서가 중요하다: 연출이 화면을 다 덮은 채 끝나고(show 의 resolve), 그 **뒤에서**
   * #respawn 이 판을 처음 상태로 되돌린 다음 hide 로 걷는다 — 덮개가 곧 암전이라
   * 캐릭터가 순간이동하는 것이 보이지 않는다.
   */
  #caught() {
    if (this.respawning || this.ended) return;
    this.respawning = true;
    this.retries += 1;
    this.player.body.setVelocity(0, 0);

    this.cameras.main.flash(220, 194, 37, 26);
    this.time.delayedCall(400, async () => {
      await this.gameover.show(this.retries);
      this.#respawn();
      this.gameover.hide();
    });
  }

  #respawn() {
    // 언제나 시작 지점이다 — 구간별 체크포인트는 없앴다(escapeLayout.SPAWN 주석 참고).
    const p = at(SPAWN.col, SPAWN.row);
    this.player.setPosition(p.x, p.y);
    this.eva.setVisible(false);
    this.gauge = 0;
    this.fallAt = 0;
    // 화면에도 곧바로 반영한다 — 안 그리면 다음 프레임까지 붉은 비네트와 '발각됨'
    // 글자가 남아, 되살아난 순간 아직 걸려 있는 것처럼 보인다.
    this.#drawGauge(false);
    // 순찰 위상을 되돌리지 않으면 리스폰하자마자 코앞에 로봇이 있는 판이 반복된다.
    // 게이지만 0으로 돌리고 로봇을 그대로 두는 것이 이 설계의 최악 실패다 (스펙 §6).
    for (const s of this.sentries) s.reset();
    this.graceUntil = this.time.now + RESPAWN_GRACE_MS;
    this.respawning = false;
    this.cameras.main.fadeIn(300, 0, 0, 0);
  }

  /**
   * 목적지까지 한 구간 걷는다 — 진행 방향에 맞는 걸음 그림으로.
   * 거리가 0에 가까우면 아무것도 하지 않는다 (제자리 트윈은 그림만 바꾸고 끝난다).
   */
  #evaWalk(x, y) {
    const dist = Phaser.Math.Distance.Between(this.eva.x, this.eva.y, x, y);
    if (dist < 1) return Promise.resolve();
    this.eva.play(EVA_ANIM[`walk${facingName(Math.atan2(y - this.eva.y, x - this.eva.x))}`]);
    return new Promise((done) => {
      this.tweens.add({
        targets: this.eva,
        x,
        y,
        duration: (dist / EVA_WALK_SPEED) * 1000,
        ease: 'Linear',
        onComplete: done,
      });
    });
  }

  /** 심문 개시 — 여기서부터 탈출 규칙은 멈추고 서버와 왕복한다. */
  /**
   * 에바가 배수구 앞에서 나타나 **플레이어 앞까지 걸어온다**.
   *
   * ⚠ 곧장 대각선으로 오지 않는다. **먼저 아래로 내려온 뒤 옆으로 돌아 ㄴ 자로** 온다
   * (2026-08-05 기획). 배수구에서 플레이어까지 직선으로 미끄러져 오면 걸어오는 것이
   * 아니라 끌려오는 것처럼 보인다 — 이 그림은 방향 넷짜리 걸음이라 대각선으로 움직이면
   * 몸이 향한 쪽과 실제 진행 방향이 내내 어긋난다. 축을 하나씩 쓰면 걸음과 방향이 맞다.
   *
   * 마지막 구간이 가로라서, 다가오는 내내 옆모습이었다가 멈추면서 플레이어를 본다.
   *
   * 길찾기를 하지 않는 것은 그대로다 — 발동 구역(21~31칸 × 1~5행) 55칸이 전부 걷는
   * 칸이고, 아래 두 구간은 **꺾이는 점까지 포함해 전부 그 안**이다. 세로 구간은 에바의
   * 열(26)을 따라 내려오고 가로 구간은 플레이어의 행(1~5행 안)을 따라가며, 꺾이는 행도
   * 아래 EVA_DESCENT 가 구역 안에 들도록 잡혀 있다.
   */
  async #evaApproach() {
    const from = at(EVA.col, EVA.row);
    const { x: px, y: py } = this.player;

    // 플레이어를 밟고 서지 않게 한 칸 앞에서 멈춘다. 이미 그보다 가까우면 안 걷는다 —
    // 뒷걸음질로 거리를 벌리면 "다가온다"가 아니라 물러서는 것으로 보인다.
    const gap = TILE * 1.2;
    // 플레이어가 에바와 같은 열에 서 있으면 ㄴ 자가 성립하지 않는다 (가로 구간이 없다).
    // 그때는 세로 한 구간으로 내려와 플레이어 앞에 선다 — 가운데 통로로 곧장 올라온 경우다.
    const sameColumn = Math.abs(px - from.x) <= gap;
    const cornerY = sameColumn
      ? Math.max(from.y, py - gap)
      : Math.max(py, from.y + EVA_DESCENT);
    const stopX = sameColumn ? from.x : px - Math.sign(px - from.x) * gap;

    this.eva.setPosition(from.x, from.y).setVisible(true);

    await this.#evaWalk(from.x, cornerY); // ㄴ 의 세로획 — 배수구에서 내려온다
    if (!sameColumn) {
      // 꺾이는 자리에서 한 박자 선다. 걸음 그림이 아래를 보다가 곧바로 옆을 보면
      // 미끄러지듯 방향만 바뀌는데, 짧게 멈췄다 돌면 "돌아섰다"로 읽힌다.
      this.eva.play(EVA_ANIM.idleDown);
      await this.#beat(200);
      await this.#evaWalk(stopX, cornerY); // ㄴ 의 가로획 — 옆에서 다가온다
    }

    // 도착하면 걸음을 멈추고 플레이어를 본 채로 선다.
    const dir = facingName(Math.atan2(py - this.eva.y, px - this.eva.x));
    this.eva.play(EVA_ANIM[`idle${dir}`]);

    // 돌아갈 길 — 심문을 통과하면 이 ㄴ 자를 거꾸로 걸어 배수구로 물러난다
    // (#toEnding). 플레이어는 심문 내내 얼어 있으므로(ended) 지금 잰 좌표가
    // 그대로 유효하다. 같은 열이면 가로획이 없으니 세로 한 구간뿐이다.
    this.evaRetreat = sameColumn ? [from] : [{ x: from.x, y: cornerY }, from];
  }

  async #startInterrogation() {
    if (this.ended) return;
    this.ended = true; // update() 의 탈출 로직을 멈춘다
    this.player.body.setVelocity(0, 0);
    await this.#evaApproach(); // 여기서 처음 나타나 걸어온다

    const post = async (path, body = {}) => {
      const res = await fetch(`/api/escape${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json;
    };

    let sessionId = null;
    const outcome = await runRobotInterrogation(this.panel, {
      fetchStart: async () => {
        const r = await post('/interrogation/start');
        sessionId = r.state.sessionId;
        return r;
      },
      showIntro: () => this.#showChildIntro(),
      pickIdentity: (identityId) => post('/interrogation/identity', { sessionId, identityId }),
      fetchQuestion: () => post('/interrogation/question', { sessionId }),
      submitAnswer: (answer) => post('/interrogation/answer', { sessionId, answer }),
    });

    if (outcome === 'win') {
      playSfx('clear');
      this.#toEnding();
      return;
    }
    // 패배·오류는 심문 직전으로 되돌린다 — 여기서 결과 화면을 덮으면 마지막 장면이
    // 통째로 날아간다. 탈출을 다시 걷게 하지도 않는다 (마지막 체크포인트에서 시작).
    //
    // #respawn() 끝의 fadeIn 은 #caught() 가 먼저 fadeOut 한 뒤 부르는 것을 전제로
    // 한다 — 화면이 이미 검게 죽어 있어야 다시 밝아지는 연출이 자연스럽다. 이 경로는
    // fadeOut 없이 밝은 화면 그대로 들어오므로, fadeOut 없이 바로 #respawn() 을 부르면
    // 멀쩡한 화면이 느닷없이 검게 깜빡였다 돌아온다. #caught() 와 같은 순서(먼저
    // fadeOut, 완료되면 #respawn())로 맞춘다.
    //
    // respawning 을 fadeOut 시작 전에 세운다 — update() 는 ended || respawning 일 때만
    // 이동을 얼린다. ended 를 먼저 false 로 내리면 fadeOut 이 끝나는 400ms 동안 둘 다
    // false 인 틈이 생겨, 화면이 검은 채로 캐릭터가 움직여 버린다.
    this.respawning = true;
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.ended = false;
      this.#respawn();
    });
  }

  /**
   * 심문을 통과한 뒤 — 본부로 넘어가기 전 한 박자 (2026-08-06 기획 목업).
   *
   * 곧바로 암전하면 **방금 무슨 일이 있었는지 삼킬 틈이 없다.** 이 게임의 반전이
   * 여기서 끝나는데, 통과 판정이 뜨자마자 화면이 검어지면 그게 그냥 관문 하나
   * 넘은 것으로 읽힌다. 그래서 세 박자를 둔다:
   *
   *   1. **에바가 돌아간다** — 보내 준 쪽이 먼저 자리를 뜬다. 제자리에서
   *      옅어지기만 하면 "사라졌다"이지 "제 갈 길을 갔다"가 아니다 — 왔던
   *      ㄴ 자를 거꾸로 걸어 배수구까지 가서야 스며들 듯 옅어진다 (2026-08-06).
   *   2. **혼자 남아 속으로 말한다** — 화자 이름도 초상도 없다. 괄호로 묶인
   *      혼잣말이라 말이 아니라 생각이고, 이 장면에 다른 사람은 없다.
   *   3. 그러고 나서 암전 → 본부.
   *
   * 주인공 일러스트는 세우지 않는다 (기획 지시). 수로에 혼자 서 있는 그림은
   * 이미 화면에 있는 스프라이트가 하고 있다.
   */
  async #toEnding() {
    // 곧장 돌아서면 매정하다 — 패널이 닫히고 한 박자 마주 선 뒤 걸음을 뗀다.
    await this.#beat(500);

    // 왔던 길의 역순 (#evaApproach 가 남긴 evaRetreat): 가로획 → 꺾임 → 세로획.
    const [corner, origin] = this.evaRetreat.length === 2
      ? this.evaRetreat
      : [null, this.evaRetreat[0]];
    if (corner) {
      const side = facingName(Math.atan2(0, corner.x - this.eva.x)); // Left | Right
      await this.#evaWalk(corner.x, corner.y);
      // 꺾이는 자리에서 한 박자 서서 돌아선다 — 올 때와 같은 이유 (#evaApproach).
      this.eva.play(EVA_ANIM[`idle${side}`]);
      await this.#beat(200);
    }
    await this.#evaWalk(origin.x, origin.y); // ㄴ 의 세로획 — 배수구로 올라간다

    // 배수구 앞에서 옅어진다 — 나타났던 곳으로 스며들어야 "돌아갔다"가 맺힌다.
    // ⚠ 트윈이 alpha 를 0 으로 만들어 두므로 setVisible(false) 만으로는 안 되고,
    //   다시 세울 때 alpha 를 되돌려야 한다 (#respawn 은 이 경로를 안 타지만,
    //   나중에 재시작이 붙으면 여기서 물린다).
    await new Promise((resolve) => {
      this.tweens.add({
        targets: this.eva, alpha: 0, duration: 450, ease: 'Sine.easeIn',
        onComplete: () => { this.eva.setVisible(false).setAlpha(1); resolve(); },
      });
    });
    await this.#beat(400);

    // 혼잣말. 화자 칸을 비우면 이름표가 통째로 접힌다 (#dialogue-speaker:empty).
    for (const line of MONOLOGUE) {
      this.dialogue.show('', line);
      await this.#beat(2400);
    }
    this.dialogue.hide();
    await this.#beat(500);

    this.cameras.main.fadeOut(900, 0, 0, 0);
    this.uiCam?.fadeOut(900, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Ending'));
  }

  /**
   * 심문 전 주고받는 대화 — 정체 반전("나는 로봇이야")부터 신분 질문("당신 뭐하는
   * 사람이야?")까지, 신분 카드 패널이 뜨기 전에 둘이 말을 섞는 자리다(2026-08-07
   * 기획 대사). StageScene#toMansion 과 같은 방식 — 대사를 띄우고 시간을 두었다
   * 다음 줄로 넘긴다, 입력 대기가 아니다.
   *
   * 이름은 처음부터 '에바' 다 — 첫 마디부터 스스로 로봇이라 밝히므로 '아이'로
   * 숨길 반전이 없다(2026-08-07 대사 개정 — 예전에는 인사만 하고 한 박자 뒤에
   * 정체를 밝혔다).
   */
  async #showChildIntro() {
    this.dialogue.setHint('');
    const eva = (text) => this.dialogue.show('에바', text, { portrait: 'eva' });
    const me = (text) => this.dialogue.show('나', text, { portrait: 'player' });

    eva('"안녕? 여기로 올 줄 알고 있었어."');
    await this.#beat(2200);
    me('(이런 곳에 왠 꼬마 아이가?)');
    await this.#beat(2200);
    eva('"지금 어린 아이라고 무시했지? 그렇지 않는게 좋아 나는 로봇이거든."');
    await this.#beat(2800);
    me('(아, 그 연구소에서 본… 진짜 사람이랑 똑같잖아? 것보다 이렇게 아이 모습일 줄이야…)');
    await this.#beat(3000);
    eva('"음… 여기서 뭐하고 있었는지 물어보면 사실 대로 대답 할꺼야?"');
    await this.#beat(2800);
    me('(어떻게 하지, 전투 로봇 보다 강하다는 연구 기록이 사실이라면 도망은 절대 무리야...)');
    await this.#beat(3000);
    eva('"아니야, 대답하지마 내가 맞춰 볼게!"');
    await this.#beat(2200);
    eva('"일단 직업 부터 시작하자. 당신 뭐하는 사람이야?"');
    await this.#beat(2800);
    me('(뭐지, 일단은 대화를 하면서 틈을 보자... 직업은 뭐라고 하지?)');
    await this.#beat(2800);
    this.dialogue.hide();
  }

  /** 연출용 사이 — delayedCall 을 await 할 수 있게 감싼다 (StageScene#beat 과 같은 모양). */
  #beat(ms) {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }
}

// 옛 `SEGMENTS`(= CORRIDORS)·`CHECKPOINTS` 재수출은 지웠다. 걷는 길이 사각형 목록에서
// 그림(escape-props.json 의 walk)으로 넘어가면서 CORRIDORS 가 없어졌고, 체크포인트는
// 2026-08-04 레벨 개편에서 없어졌다 — 둘 다 읽는 곳이 없었다.
