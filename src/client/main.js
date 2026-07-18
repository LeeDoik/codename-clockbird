import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { IntroScene } from './scenes/IntroScene.js';
import { StageScene } from './scenes/StageScene.js';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-canvas',
  // 28×18 타일(32px) 격자에 정확히 맞춘다 — 예전 920×600 은 32의 배수가 아니라 가장자리가 잘렸다.
  width: 896,
  height: 576,
  backgroundColor: '#231f19',
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  // Boot(에셋 로드 + 스테이지 fetch 착수) → Intro(오프닝 시네마틱, 그 대기를 흡수) → Stage(플레이)
  scene: [BootScene, IntroScene, StageScene],
});
