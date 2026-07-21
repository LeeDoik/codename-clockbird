import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { IntroScene } from './scenes/IntroScene.js';
import { TutorialScene } from './scenes/TutorialScene.js';
import { StageScene } from './scenes/StageScene.js';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-canvas',
  // 28×18 타일(32px) 격자에 정확히 맞춘다 — 예전 920×600 은 32의 배수가 아니라 가장자리가 잘렸다.
  width: 896,
  height: 576,
  // 표시 크기만 브라우저 창에 맞춰 확대한다 — 내부 해상도(896×576)와 좌표계는 불변이라
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
    arcade: { debug: false },
  },
  // Boot(에셋 로드 + 스테이지 fetch 착수) → Intro(오프닝) → Tutorial(본부 훈련) → Stage(플레이)
  scene: [BootScene, IntroScene, TutorialScene, StageScene],
});
