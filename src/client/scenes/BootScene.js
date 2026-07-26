import Phaser from 'phaser';
// Vite 가 번들·핑거프린팅하도록 에셋을 import 한다 (문자열 URL 을 그대로 load 하면
// import 되지 않은 assets/ 는 프로덕션 빌드의 dist 에 복사되지 않아 404 가 난다).
import tilesUrl from '../assets/tiles/tiles.png';
import charsUrl from '../assets/chars.png';
import officerStandeeUrl from '../assets/npc/officer-standee.png';

/**
 * 로딩 씬.
 * 스테이지 시작은 LLM 호출(연상 단어 생성 + 중복 판정)로 11~20초 걸린다.
 * 그 fetch 를 여기서 미리 쏘아 레지스트리에 프로미스로 얹어두고, 오프닝(IntroScene)과
 * 튜토리얼(TutorialScene)이 도는 동안 뒤에서 완성시킨다 — 계획서 §5.4 "로딩 화면 뒤로 숨김"
 * 전략을, 이제 정적 로딩 화면이 아니라 오프닝+튜토리얼이 대신 수행한다.
 * 실제 소비(await)는 튜토리얼 통과 시점에 TutorialScene 이 한다.
 *
 * 개발용 URL 파라미터:
 *   ?nointro — 오프닝 시네마틱만 건너뛰고 튜토리얼부터 시작
 *   ?stage1  — 오프닝·튜토리얼을 모두 건너뛰고 곧장 스테이지1(저택)로 (프로미스 대기 필요)
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // 타일 스프라이트시트 (32×32 프레임). map.json 자체는 StageScene 에서 직접 import 한다.
    // 텍스처는 게임 전역이라 여기서 한 번 로드하면 StageScene 에서 바로 쓸 수 있다.
    this.load.spritesheet('tiles', tilesUrl, { frameWidth: 32, frameHeight: 32 });
    // 캐릭터 8프레임: 0 플레이어 / 1 시계공 / 2 하녀 / 3 기관사 / 4 밀수꾼 / 5 악사 / 6 튜토리얼 동료(placeholder) / 7 (미사용)
    this.load.spritesheet('chars', charsUrl, { frameWidth: 32, frameHeight: 32 });
    // 간부(브란트) — 32x32 그리드에 안 맞는 실사이즈 스탠딩 컷이라 별도 이미지로 로드한다.
    this.load.image('officerStandee', officerStandeeUrl);
  }

  create() {
    const params = new URLSearchParams(window.location.search);

    // 스테이지 시작을 지금 쏘고 그 대기를 오프닝+튜토리얼이 가린다. 프로미스는 {state} 또는
    // {error} 로만 resolve 하게 감싼다 — 한참 뒤(튜토리얼 통과 시점)에 한가롭게 await 해도
    // unhandledrejection 경고가 뜨지 않도록.
    const startPromise = this.#fetchStart();
    this.registry.set('startPromise', startPromise);

    // 개발용: 튜토리얼까지 건너뛰고 곧장 스테이지1로 — 이 경로만 여기서 프로미스를 기다린다.
    if (params.has('stage1')) {
      this.#legacyBoot(startPromise);
      return;
    }

    this.scene.start(params.has('nointro') ? 'Tutorial' : 'Intro');
  }

  #fetchStart() {
    return fetch('/api/stage/start', { method: 'POST' })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return { state: await res.json() };
      })
      .catch((err) => ({ error: err.message }));
  }

  /** 개발용(?stage1) — 오프닝·튜토리얼을 건너뛰고 로딩 화면을 거쳐 곧장 스테이지1로 간다. */
  #legacyBoot(startPromise) {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, height / 2 - 20, '저택에 잠입하는 중...', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '20px',
        color: '#c9a227',
      })
      .setOrigin(0.5);

    const sub = this.add
      .text(width / 2, height / 2 + 14, '동료들의 암호를 수신하고 있습니다', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '13px',
        color: '#8a7f6a',
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
        height / 2 + 60,
        `스테이지 시작 실패\n${message}\n\n.env 에 ANTHROPIC_API_KEY 를 넣었는지 확인하세요.`,
        {
          fontFamily: 'Malgun Gothic, sans-serif',
          fontSize: '13px',
          color: '#c25b4a',
          align: 'center',
        },
      )
      .setOrigin(0.5);
  }
}
