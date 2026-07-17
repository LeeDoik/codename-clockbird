import Phaser from 'phaser';
// Vite 가 번들·핑거프린팅하도록 에셋을 import 한다 (문자열 URL 을 그대로 load 하면
// import 되지 않은 assets/ 는 프로덕션 빌드의 dist 에 복사되지 않아 404 가 난다).
import tilesUrl from '../assets/tiles/tiles.png';
import charsUrl from '../assets/chars.png';

/**
 * 로딩 씬.
 * 스테이지 시작은 LLM 호출(연상 단어 생성 + 중복 판정)을 기다려야 하므로
 * 그 지연을 여기서 흡수한다 — 계획서 §5.4 의 "로딩 화면 뒤로 숨김" 전략.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // 타일 스프라이트시트 (32×32 프레임). map.json 자체는 StageScene 에서 직접 import 한다.
    // 텍스처는 게임 전역이라 여기서 한 번 로드하면 StageScene 에서 바로 쓸 수 있다.
    this.load.spritesheet('tiles', tilesUrl, { frameWidth: 32, frameHeight: 32 });
    // 캐릭터 7프레임: 0 플레이어 / 1 시계공 / 2 하녀 / 3 기관사 / 4 밀수꾼 / 5 악사 / 6 시민
    this.load.spritesheet('chars', charsUrl, { frameWidth: 32, frameHeight: 32 });
  }

  create() {
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

    this.tweens.add({
      targets: sub,
      alpha: 0.3,
      duration: 700,
      yoyo: true,
      repeat: -1,
    });

    this.#start();
  }

  async #start() {
    try {
      const res = await fetch('/api/stage/start', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const state = await res.json();
      this.scene.start('Stage', { state });
    } catch (err) {
      this.#showError(err.message);
    }
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
