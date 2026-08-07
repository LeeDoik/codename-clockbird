/**
 * 게임 전역 사운드 매니저.
 *
 * Phaser 의 사운드 시스템은 씬이 아니라 게임(Phaser.Game) 소속이라, 어느 씬에서
 * `scene.sound` 를 잡든 같은 매니저를 가리킨다 — 그래서 이 모듈은 씬을 매개변수로
 * 받지 않는다. BootScene 이 init(game) 으로 한 번만 매니저를 넘겨주면, 그 뒤로는
 * 어떤 파일에서든(씬이든 미니게임이든 UI 클래스든) import 해서 바로 playSfx/playBgm 을
 * 부를 수 있다.
 *
 * BGM 전환은 크로스페이드 없이 즉시 끊고 새로 튼다 — 트윈으로 페이드를 걸면 페이드가
 * 끝나기 전에 이전 씬이 shutdown 되면서 트윈이 죽어 소리가 어중간한 볼륨에 걸린 채
 * 멈출 수 있다(씬 소속 트윈 매니저의 생명주기 문제). 단순한 정지+재생이 훨씬 안전하다.
 */

const BGM_FILES = {
  title: '/audio/bgm/title.mp3',
  tutorial: '/audio/bgm/tutorial.mp3',
  stage1: '/audio/bgm/stage1.mp3',
  stage2: '/audio/bgm/stage2.mp3',
  stage3: '/audio/bgm/stage3.mp3',
  minigame1: '/audio/bgm/minigame1.mp3',
  minigame2: '/audio/bgm/minigame2.mp3',
};

const SFX_FILES = {
  walk: '/audio/sfx/walk.mp3',
  textNext: '/audio/sfx/text-next.mp3',
  fail: '/audio/sfx/fail.mp3',
  clear: '/audio/sfx/clear.mp3',
  close: '/audio/sfx/close.mp3',
  energyCharge: '/audio/sfx/energy-charge.mp3',
  boom: '/audio/sfx/boom.mp3',
  switch: '/audio/sfx/switch.mp3',
  gear: '/audio/sfx/gear.mp3',
  steam: '/audio/sfx/steam.mp3',
  warning: '/audio/sfx/warning.mp3',
};

/** 타이틀(메뉴)에서만 쓰는 볼륨 — 대사·효과음과 겹칠 일이 없는 화면이라 또렷하게 튼다. */
const MENU_BGM_VOLUME = 0.45;
/**
 * 실제 플레이 중(튜토리얼·스테이지 1~3·미니게임) 배경음 볼륨 — 대사·효과음을
 * 가리지 않도록 뒤에 낮게 깐다.
 *
 * 내보내는 이유: 엔딩처럼 **메뉴 곡을 플레이 화면에서 트는** 자리가 있다. 엔딩은
 * 타이틀 곡을 다시 쓰지만(EndingScene) 그 위로 브란트의 대사가 흐르므로, 곡 자체가
 * 아니라 그 화면의 성격에 볼륨을 맞춰야 한다 — 부르는 쪽이 이 값을 넘긴다.
 */
export const GAMEPLAY_BGM_VOLUME = 0.18;
const GAMEPLAY_BGM_KEYS = new Set(['tutorial', 'stage1', 'stage2', 'stage3', 'minigame1', 'minigame2']);
const SFX_VOLUME = 0.7;

let manager = null; // Phaser.Sound.BaseSoundManager
let currentBgmKey = null;
let currentBgmSound = null;
/** walk/energyCharge 처럼 "누르고 있는 동안" 도는 루프 하나당 재생 중인 Sound 인스턴스. */
const loops = new Map();

/** BootScene.preload() 에서 씬 하나로 전부 로드한다 (전역 자산이라 한 번이면 충분). */
export function preloadAudio(scene) {
  for (const [key, url] of Object.entries(BGM_FILES)) scene.load.audio(`bgm-${key}`, url);
  for (const [key, url] of Object.entries(SFX_FILES)) scene.load.audio(`sfx-${key}`, url);
}

/** BootScene.create() 에서 한 번 호출 — 이후 다른 모든 함수가 쓸 매니저를 잡아 둔다. */
export function initSoundManager(scene) {
  manager = scene.sound;
}

/** 루프 없는 단발 효과음. */
export function playSfx(key, opts = {}) {
  manager?.play(`sfx-${key}`, { volume: SFX_VOLUME, ...opts });
}

/**
 * 배경음악 전환 — 이미 같은 곡이 돌고 있으면 아무 일도 하지 않는다.
 *
 * 곡이 바뀌기 전에 반드시 이전 곡부터 멈춘다(currentBgmSound.stop()) — 동시에 두 곡이
 * 도는 일이 없다. 스테이지 중 미니게임이 열리며 playBgm('minigame1') 을 부르면 거리
 * 배경음은 이 시점에 이미 꺼진 뒤라, 따로 stopBgm() 을 부를 필요가 없다.
 */
export function playBgm(key, opts = {}) {
  if (!manager) return;
  const soundKey = `bgm-${key}`;
  if (currentBgmKey === soundKey && currentBgmSound?.isPlaying) {
    // 같은 곡이어도 볼륨을 명시해 불렀다면 그건 들어준다 — 타이틀 곡을 엔딩에서 낮게
    // 다시 트는 것처럼, 곡은 같고 화면의 성격만 다른 자리가 있다.
    if (opts.volume !== undefined) currentBgmSound.setVolume(opts.volume);
    return;
  }
  currentBgmSound?.stop();
  const volume = GAMEPLAY_BGM_KEYS.has(key) ? GAMEPLAY_BGM_VOLUME : MENU_BGM_VOLUME;
  currentBgmSound = manager.add(soundKey, { loop: true, volume, ...opts });
  currentBgmSound.play();
  currentBgmKey = soundKey;
}

export function stopBgm() {
  currentBgmSound?.stop();
  currentBgmSound = null;
  currentBgmKey = null;
}

/**
 * 눌려 있는 동안 도는 루프(발소리·충전음)를 켜고 끈다. 같은 key 를 두 번 켜도
 * 중복 재생되지 않는다 — 매 프레임 `setLoop('walk', moving)` 처럼 불러도 안전하다.
 */
export function setLoop(key, active, opts = {}) {
  if (!manager) return;
  const playing = loops.get(key);
  if (active) {
    if (playing) return;
    const sound = manager.add(`sfx-${key}`, { loop: true, volume: SFX_VOLUME, ...opts });
    sound.play();
    loops.set(key, sound);
  } else if (playing) {
    playing.stop();
    loops.delete(key);
  }
}

/**
 * 이미 켜져 있는 루프의 볼륨만 갈아 끼운다 — 게이지처럼 시간에 따라 커지는 연출용.
 * 루프가 꺼져 있으면 아무 일도 하지 않는다 (setLoop 로 먼저 켜야 한다).
 */
export function setLoopVolume(key, volume) {
  loops.get(key)?.setVolume(volume);
}
