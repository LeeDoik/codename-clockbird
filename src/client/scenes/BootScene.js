import Phaser from 'phaser';
// Vite 가 번들·핑거프린팅하도록 에셋을 import 한다 (문자열 URL 을 그대로 load 하면
// import 되지 않은 assets/ 는 프로덕션 빌드의 dist 에 복사되지 않아 404 가 난다).
import tilesUrl from '../assets/tiles/tiles.png';
import mansionBgUrl from '../assets/mansion-bg.png';
import mansionDoorUrl from '../assets/mansion-door-open.png';
import charsUrl from '../assets/chars.png';
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
    // 저택은 타일을 한 칸씩 깔지 않는다 — 바닥·벽·가구·조명을 한 장에 구운 배경을 쓴다
    // (scripts/gen-mansion-art.js). 충돌은 mansion.json + mansion-props.json 이 맡는다.
    this.load.image('mansion-bg', mansionBgUrl);
    this.load.image('mansion-door-open', mansionDoorUrl);
    // 캐릭터 8프레임: 0 플레이어 / 1 시계공 / 2 하녀 / 3 기관사 / 4 밀수꾼 / 5 악사 / 6 시민 / 7 순찰 로봇
    this.load.spritesheet('chars', charsUrl, { frameWidth: 32, frameHeight: 32 });
  }

  create() {
    const params = new URLSearchParams(window.location.search);
    const noIntro = params.has('nointro');

    // 개발용 — 스테이지 2 저택으로 곧장 들어간다. 스테이지 1 세션이 없어도 되므로
    // 시작 fetch 를 쏘지 않는다 (저택은 LLM 대기 없이 시작한다).
    if (import.meta.env.DEV && params.has('stage2')) {
      waitForFonts(2000).then(() => this.scene.start('Mansion'));
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
