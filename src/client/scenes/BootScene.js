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
import officerIdleUrl from '../assets/npc/officer-idle.png';
import t1IdleUrl from '../assets/npc/t1-idle.png';
import t2IdleUrl from '../assets/npc/t2-idle.png';
import t3IdleUrl from '../assets/npc/t3-idle.png';
import watchmakerIdleUrl from '../assets/npc/watchmaker-idle.png';
import maidIdleUrl from '../assets/npc/maid-idle.png';
import engineerIdleUrl from '../assets/npc/engineer-idle.png';
import musicianIdleUrl from '../assets/npc/musician-idle.png';
import playerIdleUrl from '../assets/player/player-idle.png';
import playerWalkUrl from '../assets/player/player-walk.png';
import {
  PLAYER_ANIM,
  PLAYER_FRAME_SIZE,
  PLAYER_IDLE_FRAMES,
  PLAYER_WALK_RANGES,
} from '../entities/playerSprite.js';
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
    // 캐릭터 8프레임: 0 플레이어 / 1 시계공 / 2 하녀 / 3 기관사 / 4 밀수꾼 / 5 악사 / 6 시민 / 7 순찰 로봇
    this.load.spritesheet('chars', charsUrl, { frameWidth: 32, frameHeight: 32 });
    // 브란트(간부) 아이들 모션 — 432×432 프레임 6×2, 여백 없이 딱 맞물린 시트.
    this.load.spritesheet('officerIdle', officerIdleUrl, { frameWidth: 432, frameHeight: 432 });
    // 튜토리얼 동료 3인(레나/미아/오토) 아이들 모션 — 256×256 프레임 6×2.
    this.load.spritesheet('t1Idle', t1IdleUrl, { frameWidth: 256, frameHeight: 256 });
    this.load.spritesheet('t2Idle', t2IdleUrl, { frameWidth: 256, frameHeight: 256 });
    this.load.spritesheet('t3Idle', t3IdleUrl, { frameWidth: 256, frameHeight: 256 });
    // 거리(스테이지 1) 동료 아이들 모션 — 같은 256×256 12프레임이지만 시트 배치가
    // 6×2 인 것과 12×1 인 것이 섞여 있다. 프레임 크기만 맞으면 인덱스는 같으므로
    // 로더는 구분하지 않는다. 밀수꾼(smuggler)·접선책은 전용 아트가 아직 없어
    // chars.png 프레임을 그대로 쓴다 (design/characters/portrait-map.md 참조).
    this.load.spritesheet('watchmakerIdle', watchmakerIdleUrl, { frameWidth: 256, frameHeight: 256 });
    this.load.spritesheet('maidIdle', maidIdleUrl, { frameWidth: 256, frameHeight: 256 });
    this.load.spritesheet('engineerIdle', engineerIdleUrl, { frameWidth: 256, frameHeight: 256 });
    this.load.spritesheet('musicianIdle', musicianIdleUrl, { frameWidth: 256, frameHeight: 256 });
    // 플레이어 — PixelLab 로 뽑은 시트를 scripts/import-player-sprite.js 가 구운 것.
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
  }

  create() {
    // 12프레임 아이들 시트 공통 등록 — 시트마다 프레임 수·크기는 같고 키만 다르다.
    for (const key of [
      'officerIdle',
      't1Idle',
      't2Idle',
      't3Idle',
      'watchmakerIdle',
      'maidIdle',
      'engineerIdle',
      'musicianIdle',
    ]) {
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
