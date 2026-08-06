import Phaser from 'phaser';
import { TitleScreen } from '../ui/TitleScreen.js';
import { fetchStageStart } from '../net.js';
import { playBgm } from '../audio/SoundManager.js';

/**
 * 타이틀 씬 — Boot 다음, 플레이어가 처음 보는 화면이다.
 *
 * 화면 자체는 DOM(ui/TitleScreen.js)이 그리고, 이 씬은 행선지만 안다:
 *   게임 시작  → Intro → Tutorial → … (기존 흐름 그대로)
 *   게임 종료  → window.close() — 스크립트가 연 창이 아니면 브라우저가
 *                조용히 무시하므로, 그때는 안내 한 줄로 대신한다
 *
 * 스테이지 시작 fetch(LLM, 실측 11~20초)는 예전의 Boot 이 아니라 [게임 시작]을 누른
 * 순간 쏜다. 타이틀에 머무는 동안 LLM 세션을 열어 둘 이유가 없고, 누른 직후 오프닝이
 * 시작되므로 "오프닝이 대기를 가린다"는 원래 전략(BootScene 머리말)은 그대로 성립한다.
 */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create() {
    playBgm('title');
    const title = new TitleScreen();
    title.show((key) => {
      if (key === 'start') {
        this.registry.set('startPromise', fetchStageStart());
        title.hide();
        this.scene.start('Intro');
      } else {
        window.close();
        title.setHint('창이 닫히지 않으면 브라우저 탭을 직접 닫아 주세요.');
      }
    });
  }
}
