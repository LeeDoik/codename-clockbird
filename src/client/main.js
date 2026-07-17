import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { StageScene } from './scenes/StageScene.js';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-canvas',
  width: 920,
  height: 600,
  backgroundColor: '#231f19',
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  scene: [BootScene, StageScene],
});
