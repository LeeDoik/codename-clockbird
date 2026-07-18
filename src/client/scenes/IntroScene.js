import Phaser from 'phaser';

/**
 * 오프닝 시네마틱 — "HEART OF STEEL" 스토리보드 10컷을 재생하고 첫 접선(튜토리얼)로 넘긴다.
 *
 * ── 왜 별도 씬이고, 왜 여기서 로딩 대기를 흡수하나 ──
 * 스테이지 시작은 Claude 5회 호출(연상 단어 생성 + 중복 판정)이라 11~20초 걸린다.
 * Boot 가 그 fetch 를 미리 쏘아 레지스트리에 프로미스로 얹어두고, 이 오프닝이 도는 동안
 * 뒤에서 완성된다. 30여 초짜리 오프닝이 곧 로딩 화면이라, 죽어 있던 대기시간이 연출이 된다.
 * (BootScene 이 원래 쓰던 "로딩 화면 뒤로 숨김" 전략을 그대로 이어받는다.)
 *
 * ── 왜 패널을 import 하지 않고 public/ 에서 런타임 로드하나 ──
 * 패널 아트는 아직 없을 수 있다. 없는 파일을 import 하면 Vite 빌드가 통째로 깨지므로,
 * public/intro/01.png … 를 URL 로 로드하고 404 는 어두운 배경으로 폴백한다.
 * 덕분에 그림이 하나도 없어도 지금 당장 타이밍·대사·페이싱을 확인할 수 있고,
 * 나중에 public/intro/ 에 그림만 떨구면 코드 수정 없이 붙는다.
 */

const W = 896;
const H = 576;
const BRASS = '#c9a227';
const PAPER = '#e8dcc0';
const FAINT = '#8a7f6a';

/**
 * 스토리보드 컷. dur = 표시 시간(ms), 스토리보드의 초 구간에서 그대로 옮겼다.
 * type: image = 아트 패널(+하단 자막) / title·subtitle·bridge = 엔진 렌더(아트 불필요).
 * image 컷의 sfx 는 있으면 재생, 없으면 무음.
 */
const BEATS = [
  { type: 'image', image: 'intro1', dur: 3000, text: '', sfx: 'intro_steam' }, // 1. 증기 도시의 평화
  { type: 'image', image: 'intro2', dur: 3000, text: '강철처럼 차가운 심장을 가진 그들은' }, // 2. 강철 로봇 군단 습격
  { type: 'image', image: 'intro3', dur: 4000, text: '너무나 쉽게 사람들의 마음을 무너뜨렸다.' }, // 3. 학살
  { type: 'image', image: 'intro4', dur: 4000, text: '강철을 가진 자가 권력을 가졌다.' }, // 4. 브루주아
  { type: 'image', image: 'intro5', dur: 6000, text: '하지만 모든 사람의 마음이 무너진 것은 아니었다.' }, // 5. 레지스탕스
  { type: 'image', image: 'intro6', dur: 4000, text: '강철보다 단단한 신념으로.' }, // 6. 은밀히 연결
  { type: 'image', image: 'intro7', dur: 2000, text: '그 고철덩어리와 주인을 노린다.' }, // 7. 표적
  { type: 'image', image: 'intro8', dur: 1500, text: '우리는…' }, // 8. 우리는
  { type: 'title', dur: 2200, sfx: 'intro_clang' }, // 9. 타이틀 등장
  { type: 'subtitle', dur: 2600, text: 'Steel cannot understand the human heart.\n(강철은 인간의 마음을 이해할 수 없다.)' }, // 10.
  // 튜토리얼 전환 — 접선책이 규칙을 일러준다. 그대로 첫 퍼즐로 넘어간다.
  {
    type: 'bridge',
    dur: 5200,
    text: '놈들은 모든 명령을 이해한다.\n하지만 사람의 생각은 이해하지 못해.\n우린 그걸 이용하지.\n내가 떠올린 단어를 보고 접선 코드를 맞혀봐.',
  },
];

export class IntroScene extends Phaser.Scene {
  constructor() {
    super('Intro');
  }

  preload() {
    // 404 여도 크래시하지 않는다 — 텍스처가 없으면 create 에서 어두운 배경으로 폴백한다.
    this.load.on('loaderror', () => {});

    for (let i = 1; i <= 8; i++) {
      this.load.image(`intro${i}`, `/intro/${String(i).padStart(2, '0')}.png`);
    }
    // 선택 에셋 — 있으면 분위기를 더하고, 없으면 조용히 건너뛴다.
    this.load.audio('intro_music', '/intro/music.mp3');
    this.load.audio('intro_steam', '/intro/steam.mp3');
    this.load.audio('intro_clang', '/intro/clang.mp3');
    this.load.image('intro_handler', '/intro/handler.png');
  }

  create() {
    this.done = false;
    this.currentImg = null;
    this.beatTimer = null;
    this.titleParts = [];

    this.cameras.main.setBackgroundColor('#000000');
    this.cameras.main.fadeIn(600, 0, 0, 0);

    // 하단 자막 스크림 — 어떤 그림 위에서도 글자가 읽히도록 항상 깔아둔다.
    this.add.rectangle(W / 2, H - 56, W, 128, 0x000000, 0.55).setDepth(10);
    this.narration = this.add
      .text(W / 2, H - 56, '', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '18px',
        color: PAPER,
        align: 'center',
        wordWrap: { width: 820 },
        lineSpacing: 6,
      })
      .setOrigin(0.5)
      .setDepth(11);

    this.add
      .text(W - 14, 12, '[Space/Esc/클릭] 건너뛰기', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '12px',
        color: FAINT,
      })
      .setOrigin(1, 0)
      .setDepth(20);

    this.#playMusic();
    this.#bindSkip();
    this.#playBeat(0);
  }

  #playMusic() {
    if (this.cache.audio.exists('intro_music')) {
      this.music = this.sound.add('intro_music', { volume: 0.45, loop: true });
      this.music.play();
    }
  }

  #bindSkip() {
    const skip = () => this.#skip();
    this.input.keyboard.once('keydown-SPACE', skip);
    this.input.keyboard.once('keydown-ESC', skip);
    this.input.once('pointerdown', skip);
  }

  #playBeat(i) {
    if (this.done) return;
    if (i >= BEATS.length) {
      this.#finish();
      return;
    }
    const beat = BEATS[i];

    if (beat.type === 'title') this.#renderTitle();
    else if (beat.type === 'subtitle') this.#renderSubtitle(beat.text);
    else if (beat.type === 'bridge') this.#renderBridge(beat.text);
    else this.#renderImage(beat);

    // 하단 자막은 아트 컷에서만 쓴다 — 타이틀/자막/브릿지는 자기 텍스트를 중앙에 직접 그린다.
    this.#setNarration(beat.type === 'image' ? beat.text : '');
    if (beat.sfx && this.cache.audio.exists(beat.sfx)) this.sound.play(beat.sfx, { volume: 0.6 });

    this.beatTimer = this.time.delayedCall(beat.dur, () => this.#playBeat(i + 1));
  }

  /** 아트 패널 — 커버 맞춤 + 느린 줌(켄 번스) + 크로스페이드. 텍스처가 없으면 어두운 배경. */
  #renderImage(beat) {
    const prev = this.currentImg;
    let img;

    if (this.textures.exists(beat.image)) {
      img = this.add.image(W / 2, H / 2, beat.image).setDepth(1).setAlpha(0);
      // 캔버스를 꽉 채우도록 덮고(비율 유지), 여유분으로 천천히 밀어넣을 공간을 둔다.
      const cover = Math.max(W / img.width, H / img.height) * 1.04;
      img.setScale(cover);
      this.tweens.add({ targets: img, alpha: 1, duration: 700, ease: 'Sine.easeOut' });
      this.tweens.add({ targets: img, scale: cover * 1.1, duration: beat.dur + 900, ease: 'Sine.easeInOut' });
    } else {
      // 폴백: 아트 미배치. 페이싱만 확인할 수 있게 어두운 판을 깐다.
      img = this.add.rectangle(W / 2, H / 2, W, H, 0x14100b).setDepth(1).setAlpha(0);
      this.tweens.add({ targets: img, alpha: 1, duration: 700 });
    }

    if (prev) {
      this.tweens.add({
        targets: prev,
        alpha: 0,
        duration: 700,
        onComplete: () => {
          this.tweens.killTweensOf(prev);
          prev.destroy();
        },
      });
    }
    this.currentImg = img;
  }

  /** 9컷 — 검은 화면 + 금속음 + 흰 플래시와 함께 타이틀 등장. */
  #renderTitle() {
    this.#fadeOutCurrent();

    const flash = this.add.rectangle(W / 2, H / 2, W, H, 0xffffff, 0.65).setDepth(30);
    this.tweens.add({ targets: flash, alpha: 0, duration: 500, onComplete: () => flash.destroy() });

    const title = this.add
      .text(W / 2, H / 2 - 26, 'HEART OF STEEL', {
        fontFamily: 'Georgia, "Malgun Gothic", serif',
        fontSize: '52px',
        color: BRASS,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(12)
      .setAlpha(0);
    const ko = this.add
      .text(W / 2, H / 2 + 22, '철혈(鐵血)', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '18px',
        color: FAINT,
      })
      .setOrigin(0.5)
      .setDepth(12)
      .setAlpha(0);

    this.tweens.add({ targets: title, alpha: 1, duration: 700, ease: 'Sine.easeOut' });
    this.tweens.add({ targets: ko, alpha: 1, duration: 700, delay: 250 });
    this.titleParts = [title, ko];
  }

  /** 10컷 — 타이틀 아래 문구. */
  #renderSubtitle(text) {
    const sub = this.add
      .text(W / 2, H / 2 + 74, text, {
        fontFamily: 'Georgia, "Malgun Gothic", serif',
        fontSize: '17px',
        color: BRASS,
        align: 'center',
        wordWrap: { width: 760 },
        lineSpacing: 6,
      })
      .setOrigin(0.5)
      .setDepth(12)
      .setAlpha(0);
    this.tweens.add({ targets: sub, alpha: 1, duration: 700 });
    this.titleParts.push(sub);
  }

  /** 튜토리얼 전환 — 접선책이 규칙을 일러준다. (portrait 는 있으면 표시) */
  #renderBridge(text) {
    this.#fadeOutCurrent();
    this.#clearTitle();

    let hasPortrait = false;
    if (this.textures.exists('intro_handler')) {
      const p = this.add.image(178, H / 2, 'intro_handler').setDepth(12).setAlpha(0);
      const cover = Math.min(280 / p.width, 360 / p.height);
      p.setScale(cover);
      this.tweens.add({ targets: p, alpha: 1, duration: 600 });
      hasPortrait = true;
    }

    const line = this.add
      .text(hasPortrait ? 360 : W / 2, H / 2 - 10, text, {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '19px',
        color: PAPER,
        align: hasPortrait ? 'left' : 'center',
        wordWrap: { width: hasPortrait ? 460 : 640 },
        lineSpacing: 10,
      })
      .setOrigin(hasPortrait ? 0 : 0.5, 0.5)
      .setDepth(12)
      .setAlpha(0);
    this.tweens.add({ targets: line, alpha: 1, duration: 700 });

    this.add
      .text(W / 2, H - 40, '— 접선책', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '13px',
        color: FAINT,
      })
      .setOrigin(0.5)
      .setDepth(12);
  }

  #fadeOutCurrent() {
    if (!this.currentImg) return;
    const c = this.currentImg;
    this.currentImg = null;
    this.tweens.add({
      targets: c,
      alpha: 0,
      duration: 450,
      onComplete: () => {
        this.tweens.killTweensOf(c);
        c.destroy();
      },
    });
  }

  #clearTitle() {
    for (const t of this.titleParts) {
      this.tweens.add({ targets: t, alpha: 0, duration: 400, onComplete: () => t.destroy() });
    }
    this.titleParts = [];
  }

  /** 하단 자막 크로스페이드. */
  #setNarration(text) {
    this.tweens.add({
      targets: this.narration,
      alpha: 0,
      duration: 200,
      onComplete: () => {
        this.narration.setText(text ?? '');
        this.tweens.add({ targets: this.narration, alpha: text ? 1 : 0, duration: 350 });
      },
    });
  }

  #skip() {
    // 이미 마무리 중이면 무시. #finish 가 done 을 세워 남은 비트 콜백을 막는다.
    this.#finish();
  }

  #finish() {
    if (this.done) return;
    this.done = true;
    if (this.beatTimer) {
      this.beatTimer.remove(false);
      this.beatTimer = null;
    }
    if (this.music) this.music.stop();

    // 자체 검은 오버레이로 덮는다(카메라 페이드는 이후 추가한 대기 문구까지 가려 버린다).
    // fillAlpha 는 1 로 두고 GameObject alpha 만 0→1 로 올린다 — 둘 다 0 이면 곱해져 안 보인다.
    const cover = this.add.rectangle(W / 2, H / 2, W, H, 0x000000).setDepth(50).setAlpha(0);
    this.tweens.add({
      targets: cover,
      alpha: 1,
      duration: 450,
      onComplete: () => this.#goStage(),
    });
  }

  /** 오프닝이 끝났다 — 스테이지 상태가 준비됐으면 넘어가고, 아직이면 잠깐 대기한다. */
  #goStage() {
    const waiting = this.add
      .text(W / 2, H / 2, '동료들의 암호를 수신하는 중…', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '15px',
        color: FAINT,
      })
      .setOrigin(0.5)
      .setDepth(51)
      .setAlpha(0);

    // Boot 가 얹어둔 프로미스는 {state} 또는 {error} 로만 resolve 한다 (절대 reject 안 함).
    Promise.resolve(this.registry.get('startPromise')).then((res) => {
      if (!res || res.error) {
        waiting.destroy();
        this.#showError(res?.error ?? '스테이지 시작에 실패했습니다.');
        return;
      }
      this.scene.start('Stage', { state: res.state });
    });

    // 스테이지가 이미 준비돼 있으면 위 then 이 즉시 씬을 바꾼다. 아직이라 남아 있을 때만 문구를 띄운다.
    this.time.delayedCall(150, () => {
      if (waiting.active) {
        this.tweens.add({ targets: waiting, alpha: 1, duration: 300, yoyo: true, repeat: -1 });
      }
    });
  }

  #showError(message) {
    this.add
      .text(
        W / 2,
        H / 2,
        `스테이지 시작 실패\n${message}\n\n.env 에 ANTHROPIC_API_KEY 를 넣었는지 확인하세요.`,
        {
          fontFamily: 'Malgun Gothic, sans-serif',
          fontSize: '14px',
          color: '#c25b4a',
          align: 'center',
          lineSpacing: 6,
        },
      )
      .setOrigin(0.5)
      .setDepth(60);
  }
}
