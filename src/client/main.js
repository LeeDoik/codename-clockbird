import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { IntroScene } from './scenes/IntroScene.js';
import { TutorialScene } from './scenes/TutorialScene.js';
import { StageScene } from './scenes/StageScene.js';
import { MansionScene } from './scenes/MansionScene.js';
import { EscapeScene } from './scenes/EscapeScene.js';
import { EndingScene } from './scenes/EndingScene.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-canvas',
  // 내부 해상도 1920×1080 (16:9). 월드(32px 타일)는 메인 카메라가 2배 줌으로 그리므로
  // 화면에 보이는 월드는 960×540px = 가로 30칸 — 맵은 최소 30×17 칸이어야 한다
  // (worldParts.setupCameras 참고). 화면 고정 UI 는 줌 없는 UI 카메라가 1080p 로 그린다.
  width: 1920,
  height: 1080,
  // 표시 크기만 브라우저 창에 맞춰 조정한다 — 내부 해상도와 좌표계는 불변이라
  // 씬 코드·맵·입력 처리에 영향이 없다. 크기는 #game-root 의 CSS 가 정한다.
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // 확대 시 픽셀 아트가 뭉개지지 않게 (NEAREST 필터 + 정수 좌표 반올림)
  pixelArt: true,
  backgroundColor: '#231f19',
  physics: {
    default: 'arcade',
    arcade: {
      debug: false,
      /**
       * 프레임 간격 그대로 물리를 돌린다.
       *
       * Phaser 3.60 부터 arcade 는 fixedStep 이 기본 켜짐이라 물리가 60Hz 로 고정된다.
       * 화면이 그보다 빠르면(실측: 렌더 167Hz · 물리 61Hz) 인물 위치가 세 프레임에 한 번만
       * 갱신돼서 5.6 → 0 → 0 → 5.6 으로 튄다 — 걸을 때 "약간 떠는" 것처럼 보이던 원인이다.
       * 끄면 매 프레임 delta 만큼 움직여 주사율과 무관하게 매끄럽다.
       *
       * 이 게임의 충돌은 느린 속도의 사각형 몇 개뿐이라 가변 스텝으로 뚫릴 걱정은 없다.
       */
      fixedStep: false,
    },
  },
  // Boot(에셋 로드 + 스테이지 fetch 착수) → Intro(오프닝) → Tutorial(본부 훈련)
  //   → Stage(거리) → Mansion(저택 잠입) → Escape(지하 탈출) → Ending(본부 귀환)
  scene: [BootScene, IntroScene, TutorialScene, StageScene, MansionScene, EscapeScene, EndingScene],
});

// 개발 콘솔·자동화 검증에서 씬 상태를 들여다보기 위한 손잡이 (프로덕션 빌드에서는 빠진다).
if (import.meta.env.DEV) window.__game = game;
