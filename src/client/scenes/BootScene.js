import Phaser from 'phaser';
// Vite 가 번들·핑거프린팅하도록 에셋을 import 한다 (문자열 URL 을 그대로 load 하면
// import 되지 않은 assets/ 는 프로덕션 빌드의 dist 에 복사되지 않아 404 가 난다).
import tilesUrl from '../assets/tiles/tiles.png';
import hqBgUrl from '../assets/hq-bg.png';
import streetBgUrl from '../assets/street-bg.png';
import mansionBgUrl from '../assets/mansion-bg.png';
import escapeBgUrl from '../assets/escape-bg.png';
import mansionDoorUrl from '../assets/mansion-door-open.png';
import charsUrl from '../assets/chars.png';
import officerSouthUrl from '../assets/npc/officer-south.png';
import t1SouthUrl from '../assets/npc/t1-south.png';
import t2SouthUrl from '../assets/npc/t2-south.png';
import t3SouthUrl from '../assets/npc/t3-south.png';
import butlerSouthUrl from '../assets/npc/butler-south.png';
import cookSouthUrl from '../assets/npc/cook-south.png';
import gardenerSouthUrl from '../assets/npc/gardener-south.png';
import washerSouthUrl from '../assets/npc/washer-south.png';
import shelverSouthUrl from '../assets/npc/shelver-south.png';
import dinerSouthUrl from '../assets/npc/diner-south.png';
import cleanerSouthUrl from '../assets/npc/cleaner-south.png';
import clerkSouthUrl from '../assets/npc/clerk-south.png';
import guardSouthUrl from '../assets/npc/guard-south.png';
import coachSouthUrl from '../assets/npc/coach-south.png';
import maidSouthUrl from '../assets/npc/maid-south.png';
import engineerSouthUrl from '../assets/npc/engineer-south.png';
import smugglerSouthUrl from '../assets/npc/smuggler-south.png';
import musicianSouthUrl from '../assets/npc/musician-south.png';
import floristSouthUrl from '../assets/npc/florist-south.png';
import porterSouthUrl from '../assets/npc/porter-south.png';
import bakerSouthUrl from '../assets/npc/baker-south.png';
import newsboySouthUrl from '../assets/npc/newsboy-south.png';
import watchmakerIdleUrl from '../assets/npc/watchmaker-idle.png';
import robotIdleUrl from '../assets/npc/robot-idle.png';
import robotWalkUrl from '../assets/npc/robot-walk.png';
import sentryIdleUrl from '../assets/npc/sentry-idle.png';
import sentryWalkUrl from '../assets/npc/sentry-walk.png';
import evaIdleUrl from '../assets/npc/eva-idle.png';
import evaWalkUrl from '../assets/npc/eva-walk.png';
import playerIdleUrl from '../assets/player/player-idle.png';
import playerWalkUrl from '../assets/player/player-walk.png';
import {
  PLAYER_ANIM,
  PLAYER_FRAME_SIZE,
  PLAYER_IDLE_FRAMES,
  PLAYER_WALK_RANGES,
} from '../entities/playerSprite.js';
import { NPC_TEXTURE } from '../entities/npcSprite.js';
import {
  ROBOT_ANIM,
  ROBOT_FRAME_SIZE,
  ROBOT_IDLE_FRAMES,
  ROBOT_WALK_RANGES,
} from '../entities/robotSprite.js';
import {
  SENTRY_ANIM,
  SENTRY_FRAME_SIZE,
  SENTRY_IDLE_FRAMES,
  SENTRY_WALK_RANGES,
} from '../entities/sentrySprite.js';
import {
  EVA_ANIM,
  EVA_FRAME_SIZE,
  EVA_IDLE_FRAMES,
  EVA_WALK_RANGES,
} from '../entities/evaSprite.js';
import { fetchStageStart } from '../net.js';
import { waitForFonts, FONTS, CSS } from '../ui/theme.js';

/**
 * 로딩 씬.
 * 스테이지 시작은 LLM 호출(연상 단어 생성 + 중복 판정)로 11~20초 걸린다.
 * 그 fetch 를 여기서 미리 쏘아 레지스트리에 프로미스로 얹어두고, 오프닝(IntroScene)이
 * 도는 동안 뒤에서 완성시킨다 — 계획서 §5.4 "로딩 화면 뒤로 숨김" 전략을, 이제
 * 정적 로딩 화면이 아니라 오프닝 시네마틱이 대신 수행한다.
 * (개발 중 오프닝을 건너뛰려면 URL 에 ?nointro 를 붙인다.)
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // 타일 스프라이트시트 (32×32 프레임). map.json 자체는 StageScene 에서 직접 import 한다.
    // 텍스처는 게임 전역이라 여기서 한 번 로드하면 StageScene 에서 바로 쓸 수 있다.
    this.load.spritesheet('tiles', tilesUrl, { frameWidth: 32, frameHeight: 32 });
    // 거리(스테이지 1)와 저택(스테이지 2)은 타일을 한 칸씩 깔지 않는다 — 바닥·건물·
    // 가구까지 한 장에 구운 AI 배틀맵 배경 (scripts/import-map-art.js).
    // 충돌은 각 맵 json + *-props.json 의 walk 가 맡는다.
    this.load.image('hq-bg', hqBgUrl);
    this.load.image('street-bg', streetBgUrl);
    this.load.image('mansion-bg', mansionBgUrl);
    this.load.image('escape-bg', escapeBgUrl);
    this.load.image('mansion-door-open', mansionDoorUrl);
    // 캐릭터 8프레임 — 이제 둘만 남았다. 0 은 **보이지 않는 충돌 바디**(worldParts.createPlayer
    // 가 그 위에 진짜 그림을 얹는다), 5 는 탈출의 아이다.
    // 나머지(거리 인물·순찰 로봇·감시 로봇)는 전부 전용 아트로 갈아 끼웠다 (2026-08-04).
    this.load.spritesheet('chars', charsUrl, { frameWidth: 32, frameHeight: 32 });
    // 본부 NPC 4인 — PixelLab 남향 정지 그림. 200×200 한 장씩이라 spritesheet 가
    // 아니라 image 로 싣는다. 이 인물들은 제자리에 서 있기만 해서 프레임이 하나면
    // 충분하다. 규격은 entities/npcSprite.js 가 단일 출처다.
    this.load.image(NPC_TEXTURE.officer, officerSouthUrl);
    this.load.image(NPC_TEXTURE.t1, t1SouthUrl);
    this.load.image(NPC_TEXTURE.t2, t2SouthUrl);
    this.load.image(NPC_TEXTURE.t3, t3SouthUrl);
    // 저택(스테이지 2) NPC 10인 — 같은 규격의 정지 그림이다.
    this.load.image(NPC_TEXTURE.butler, butlerSouthUrl);
    this.load.image(NPC_TEXTURE.cook, cookSouthUrl);
    this.load.image(NPC_TEXTURE.gardener, gardenerSouthUrl);
    this.load.image(NPC_TEXTURE.washer, washerSouthUrl);
    this.load.image(NPC_TEXTURE.shelver, shelverSouthUrl);
    this.load.image(NPC_TEXTURE.diner, dinerSouthUrl);
    this.load.image(NPC_TEXTURE.cleaner, cleanerSouthUrl);
    this.load.image(NPC_TEXTURE.clerk, clerkSouthUrl);
    this.load.image(NPC_TEXTURE.guard, guardSouthUrl);
    this.load.image(NPC_TEXTURE.coach, coachSouthUrl);
    // 거리(스테이지 1) 8인 — 동료 넷과 시민 넷. 저택과 같은 규격의 정지 그림이다
    // (2026-08-04, 기획 배치도). 밀수꾼(smuggler)까지 전용 아트가 생겨서 거리에서
    // chars.png 로 서는 인물은 이제 없다.
    this.load.image(NPC_TEXTURE.maid, maidSouthUrl);
    this.load.image(NPC_TEXTURE.engineer, engineerSouthUrl);
    this.load.image(NPC_TEXTURE.smuggler, smugglerSouthUrl);
    this.load.image(NPC_TEXTURE.musician, musicianSouthUrl);
    this.load.image(NPC_TEXTURE.florist, floristSouthUrl);
    this.load.image(NPC_TEXTURE.porter, porterSouthUrl);
    this.load.image(NPC_TEXTURE.baker, bakerSouthUrl);
    this.load.image(NPC_TEXTURE.newsboy, newsboySouthUrl);
    // 에이던(watchmaker)만 예전 256×256 12프레임 아이들 시트를 그대로 쓴다 — 기획
    // 배치도에 그려진 것도 이 그림이라(대조 확인) 갈아끼울 이유가 없었다.
    this.load.spritesheet('watchmakerIdle', watchmakerIdleUrl, { frameWidth: 256, frameHeight: 256 });
    // 플레이어 — PixelLab 로 뽑은 시트를 scripts/import-actor-sprites.js 가 구운 것.
    // 128×128 프레임. 대기 4장(아래·위·왼·오) · 걷기 32장(방향마다 8장).
    // 배치는 entities/playerSprite.js 가 단일 출처다.
    //
    // 스테이지마다 다른 시트를 쓰지 않는다 — 주인공은 튜토리얼부터 엔딩까지 같은
    // 인물이다(2026-08-02 확정). 예전 stage1/stage2 시트는 아무도 안 쓰면서 번들에만
    // 900KB 를 얹고 있어서 지웠다.
    this.load.spritesheet('playerIdleSheet', playerIdleUrl, {
      frameWidth: PLAYER_FRAME_SIZE,
      frameHeight: PLAYER_FRAME_SIZE,
    });
    this.load.spritesheet('playerWalkSheet', playerWalkUrl, {
      frameWidth: PLAYER_FRAME_SIZE,
      frameHeight: PLAYER_FRAME_SIZE,
    });
    // 거리(스테이지 1) 순찰 로봇 — 플레이어와 같은 구조다. 걷기 시트만 8×4 격자라
    // 세로로도 여러 줄인데, frameWidth/Height 만 주면 Phaser 가 알아서 센다.
    this.load.spritesheet(ROBOT_ANIM.texture, robotIdleUrl, {
      frameWidth: ROBOT_FRAME_SIZE,
      frameHeight: ROBOT_FRAME_SIZE,
    });
    this.load.spritesheet(ROBOT_ANIM.walkSheet, robotWalkUrl, {
      frameWidth: ROBOT_FRAME_SIZE,
      frameHeight: ROBOT_FRAME_SIZE,
    });
    // 탈출(스테이지 3) 감시 로봇 — 같은 구조의 다른 인물이다. 거리 쪽은 놋쇠 증기
    // 자동인형이고 이쪽은 검은 장갑에 붉은 센서를 단 전투형이라 시트가 따로 있다.
    this.load.spritesheet(SENTRY_ANIM.texture, sentryIdleUrl, {
      frameWidth: SENTRY_FRAME_SIZE,
      frameHeight: SENTRY_FRAME_SIZE,
    });
    this.load.spritesheet(SENTRY_ANIM.walkSheet, sentryWalkUrl, {
      frameWidth: SENTRY_FRAME_SIZE,
      frameHeight: SENTRY_FRAME_SIZE,
    });
    // 에바(스테이지 3 심문 상대) — 로봇들과 같은 구조다. 플레이어 앞까지 걸어오므로
    // 방향별 걷기가 필요하다. 규격은 entities/evaSprite.js 가 단일 출처다.
    this.load.spritesheet(EVA_ANIM.texture, evaIdleUrl, {
      frameWidth: EVA_FRAME_SIZE,
      frameHeight: EVA_FRAME_SIZE,
    });
    this.load.spritesheet(EVA_ANIM.walkSheet, evaWalkUrl, {
      frameWidth: EVA_FRAME_SIZE,
      frameHeight: EVA_FRAME_SIZE,
    });
  }

  create() {
    // 12프레임 아이들 시트 등록 — 이제 거리의 에이던 하나뿐이다.
    // 나머지 인물은 정지 그림 한 장이거나 아래의 방향별 시트를 쓴다.
    for (const key of ['watchmakerIdle']) {
      if (this.anims.exists(key)) continue;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(key, { start: 0, end: 11 }),
        frameRate: 6,
        repeat: -1,
      });
    }

    // 플레이어 걷기 — 한 바퀴가 같은 시간(0.6초) 걸리도록 프레임 수에서 frameRate 를
    // 역산한다. 지금은 네 방향이 전부 8프레임이라 결과가 같지만, 시트가 바뀌어 방향별
    // 프레임 수가 어긋나도 걷는 속도는 그대로 유지된다.
    const CYCLE_SECONDS = 0.6;

    // 대기는 방향마다 한 장이다 — 애니메이션이라기보다 "그 방향으로 서 있는 그림"이다.
    // 그래도 애니메이션으로 등록해 두면 씬이 걷기와 같은 방식(play(key))으로 다룰 수 있다.
    for (const [dir, frame] of Object.entries(PLAYER_IDLE_FRAMES)) {
      const key = PLAYER_ANIM[`idle${dir}`];
      if (this.anims.exists(key)) continue;
      this.anims.create({ key, frames: [{ key: 'playerIdleSheet', frame }], frameRate: 1, repeat: -1 });
    }

    // 걷기 — 한 바퀴가 같은 시간(0.6초) 걸리도록 프레임 수에서 frameRate 를 역산한다.
    // 시트가 바뀌어 방향별 프레임 수가 어긋나도 한 바퀴 시간은 그대로 유지된다.
    //
    // 실제 재생 속도는 여기서 끝이 아니다 — worldParts.createPlayerVisual 이 매 프레임
    // **이동 속도를 보고 timeScale 을 맞춘다**. 이 frameRate 는 그 기준점(timeScale 1)이다.
    for (const [dir, [start, end]] of Object.entries(PLAYER_WALK_RANGES)) {
      const key = PLAYER_ANIM[`walk${dir}`];
      if (this.anims.exists(key)) continue;
      const count = end - start + 1;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers('playerWalkSheet', { start, end }),
        frameRate: Math.round(count / CYCLE_SECONDS),
        repeat: -1,
      });
    }

    // 로봇 둘 — 위와 같은 규칙이다. 다만 걸음이 사람보다 느긋해야 기계처럼 보여서
    // 한 바퀴를 조금 길게 잡았다. Patrol 은 경계 레벨에 따라 이동 속도가 오르는데,
    // 재생 속도는 그대로 둔다 — 빨라진 걸음이 그림보다 앞서는 편이 오히려 급해 보인다.
    const ROBOT_CYCLE_SECONDS = 0.8;
    for (const [anim, idleFrames, walkRanges] of [
      [ROBOT_ANIM, ROBOT_IDLE_FRAMES, ROBOT_WALK_RANGES],   // 거리 — 놋쇠 증기 자동인형
      [SENTRY_ANIM, SENTRY_IDLE_FRAMES, SENTRY_WALK_RANGES], // 탈출 — 검은 장갑 전투형
      [EVA_ANIM, EVA_IDLE_FRAMES, EVA_WALK_RANGES],          // 탈출 — 에바(심문 상대)
    ]) {
      for (const [dir, frame] of Object.entries(idleFrames)) {
        const key = anim[`idle${dir}`];
        if (this.anims.exists(key)) continue;
        this.anims.create({ key, frames: [{ key: anim.texture, frame }], frameRate: 1, repeat: -1 });
      }
      for (const [dir, [start, end]] of Object.entries(walkRanges)) {
        const key = anim[`walk${dir}`];
        if (this.anims.exists(key)) continue;
        const count = end - start + 1;
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(anim.walkSheet, { start, end }),
          frameRate: Math.round(count / ROBOT_CYCLE_SECONDS),
          repeat: -1,
        });
      }
    }

    const params = new URLSearchParams(window.location.search);
    const noIntro = params.has('nointro');

    // 개발용 — 튜토리얼(본부)로 곧장 들어간다.
    //
    // ?nointro 는 오프닝만 건너뛰고 스테이지 1 로 가므로, 본부를 보려면 3분짜리 오프닝을
    // 매번 봐야 했다. 본부는 자기 세션(/api/tutorial/start)을 스스로 열고 힌트가 고정
    // 세트라 LLM 대기도 없어서, 스테이지 시작 fetch 를 쏠 것이 없다 (?stage2 와 같다).
    if (import.meta.env.DEV && params.has('tutorial')) {
      waitForFonts(2000).then(() => this.scene.start('Tutorial'));
      return;
    }

    // 개발용 — 스테이지 2 저택으로 곧장 들어간다. 스테이지 1 세션이 없어도 되므로
    // 시작 fetch 를 쏘지 않는다 (저택은 LLM 대기 없이 시작한다).
    if (import.meta.env.DEV && params.has('stage2')) {
      waitForFonts(2000).then(() => this.scene.start('Mansion'));
      return;
    }

    // 개발용 — 스테이지 3 지하 탈출로 곧장 들어간다.
    //
    // ?stage2&key 처럼 "서버 상태를 바꾸는" 플래그가 아니라서 시작 요청에 실을 것이 없다:
    // 탈출 파트는 전부 클라이언트 계산이고, 심문 세션은 심문실에 닿을 때 서버가 새로 연다.
    // (?stage2&key 는 클라이언트에만 열쇠를 세워 /document 가 409 로 거절하던 함정이 있었다.)
    if (import.meta.env.DEV && params.has('stage3')) {
      waitForFonts(2000).then(() => this.scene.start('Escape'));
      return;
    }

    // 스테이지 시작을 지금 쏘고 그 대기를 오프닝이 가린다. 프로미스는 {state} 또는 {error}
    // 로만 resolve 하게 감싼다 — 오프닝이 끝날 때까지 소비되지 않아도 unhandledrejection
    // 경고가 뜨지 않도록(그래서 IntroScene 이 30여 초 뒤에 한가롭게 await 해도 안전하다).
    const startPromise = fetchStageStart();
    this.registry.set('startPromise', startPromise);

    // 웹폰트가 준비되기 전에 씬 텍스트를 그리면 폴백 고딕으로 래스터돼 굳는다.
    // 2초 안에 안 오면 그대로 진행 — CDN 이 막혀도 게임은 열려야 한다.
    waitForFonts(2000).then(() => {
      if (noIntro) this.#legacyBoot(startPromise);
      else this.scene.start('Intro');
    });
  }

  /** 개발용(?nointro) — 오프닝을 건너뛰고 기존 로딩 화면을 거쳐 곧장 스테이지로 간다. */
  #legacyBoot(startPromise) {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, height / 2 - 36, '저택에 잠입하는 중...', {
        fontFamily: FONTS.body,
        fontSize: '38px',
        color: CSS.brass,
      })
      .setOrigin(0.5);

    const sub = this.add
      .text(width / 2, height / 2 + 26, '동료들의 암호를 수신하고 있습니다', {
        fontFamily: FONTS.body,
        fontSize: '24px',
        color: CSS.paperDim,
      })
      .setOrigin(0.5);

    this.tweens.add({ targets: sub, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });

    startPromise.then((r) => {
      if (r.error) this.#showError(r.error);
      else this.scene.start('Stage', { state: r.state });
    });
  }

  #showError(message) {
    const { width, height } = this.scale;
    this.add
      .text(
        width / 2,
        height / 2 + 110,
        `스테이지 시작 실패\n${message}\n\n.env 에 ANTHROPIC_API_KEY 를 넣었는지 확인하세요.`,
        {
          fontFamily: FONTS.body,
          fontSize: '24px',
          color: CSS.wax,
          align: 'center',
        },
      )
      .setOrigin(0.5);
  }
}
