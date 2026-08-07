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
  select: '/audio/sfx/select.mp3',
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
/**
 * 효과음별 볼륨 예외.
 *
 * 걸음 소리는 다른 효과음과 성격이 다르다 — 문 여닫이나 성공음처럼 한 번 나고 마는
 * 것이 아니라 플레이어가 움직이는 **내내** 끊이지 않고 도는 루프다. 공용 볼륨으로
 * 두면 게임 시간의 대부분을 이 소리가 차지해 대사도 배경음도 그 위에 얹힌다.
 * 그래서 절반으로 깐다.
 */
const SFX_VOLUME_OVERRIDE = {
  walk: 0.35,
};

/** 이 효과음이 기본으로 쓸 볼륨 — 예외 표에 없으면 공용 값이다. */
function sfxVolume(key) {
  return SFX_VOLUME_OVERRIDE[key] ?? SFX_VOLUME;
}

/* ── 플레이어 볼륨 설정 ───────────────────────────────────────────────────
 *
 * 실제로 나는 소리 = **제작 볼륨 × 채널 × 전체**, 셋을 곱해서 얻는다.
 *
 *   제작 볼륨 — 위의 SFX_VOLUME·GAMEPLAY_BGM_VOLUME 처럼 이 게임이 정한 균형.
 *               걸음이 성공음보다 작아야 한다는 판단은 플레이어의 몫이 아니다.
 *   채널      — 설정 창의 [배경음]·[효과음] 슬라이더.
 *   전체      — 설정 창의 [전체 음량]. Phaser 매니저의 전역 볼륨을 그대로 쓴다.
 *
 * 곱으로 겹치기 때문에 플레이어가 슬라이더를 만져도 게임이 잡아 둔 균형(걸음이 대사를
 * 덮지 않는다 같은 것)은 그대로 유지된다. 슬라이더가 제작 볼륨을 **대체**하게 두면
 * 배경음을 조금 키운 순간 튜토리얼 배경음이 타이틀 곡만큼 커져 대사를 덮는다.
 */
const STORAGE_KEY = 'clockbird.audio.volumes';

/** 설정 창이 이 표를 그대로 읽어 슬라이더를 만든다 (ui/SettingsPanel.js). */
export const VOLUME_CHANNELS = [
  { key: 'master', label: '전체 음량' },
  { key: 'bgm', label: '배경음' },
  { key: 'sfx', label: '효과음' },
];

const volumes = { master: 1, bgm: 1, sfx: 1 };

/**
 * 저장된 설정을 읽는다. 값이 깨졌거나 localStorage 자체가 막혀 있어도(사생활 보호
 * 모드) 조용히 기본값으로 간다 — 소리 설정 때문에 게임이 안 열릴 이유는 없다.
 */
function loadVolumes() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    for (const { key } of VOLUME_CHANNELS) {
      const v = Number(saved[key]);
      if (Number.isFinite(v)) volumes[key] = Math.min(1, Math.max(0, v));
    }
  } catch {
    /* 기본값 유지 */
  }
}
loadVolumes();

function saveVolumes() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(volumes));
  } catch {
    /* 저장을 못 해도 이번 판에는 설정이 살아 있다 */
  }
}

/** @param {'master'|'bgm'|'sfx'} channel @returns {number} 0~1 */
export function getVolume(channel) {
  return volumes[channel];
}

/**
 * 슬라이더가 부른다. 지금 울리고 있는 소리에도 **즉시** 반영된다 — 배경음을 줄이려고
 * 연 설정 창인데 다음 곡부터 적용되면 무엇을 조절했는지 귀로 확인할 수 없다.
 */
export function setVolume(channel, value) {
  volumes[channel] = Math.min(1, Math.max(0, value));
  saveVolumes();
  applyVolumes();
}

/** 저장된 설정을 실제 소리에 입힌다 — 설정이 바뀔 때와 매니저가 처음 붙을 때. */
function applyVolumes() {
  if (!manager) return;
  // 전체 음량은 Phaser 매니저의 전역 볼륨이 맡는다 (모든 소리에 이미 곱해진다).
  manager.volume = volumes.master;
  if (currentBgmSound) currentBgmSound.setVolume(currentBgmBase * volumes.bgm);
  for (const loop of loops.values()) loop.sound.setVolume(loop.base * volumes.sfx);
}

let manager = null; // Phaser.Sound.BaseSoundManager
let currentBgmKey = null;
let currentBgmSound = null;
/** 지금 곡의 **제작 볼륨** — 채널 설정이 바뀔 때 여기에 다시 곱한다. */
let currentBgmBase = MENU_BGM_VOLUME;
/**
 * walk/energyCharge 처럼 "누르고 있는 동안" 도는 루프.
 * key → { sound, base } — base 는 제작 볼륨이라 설정이 바뀌어도 잃지 않는다.
 */
const loops = new Map();

/** BootScene.preload() 에서 씬 하나로 전부 로드한다 (전역 자산이라 한 번이면 충분). */
export function preloadAudio(scene) {
  for (const [key, url] of Object.entries(BGM_FILES)) scene.load.audio(`bgm-${key}`, url);
  for (const [key, url] of Object.entries(SFX_FILES)) scene.load.audio(`sfx-${key}`, url);
}

/** BootScene.create() 에서 한 번 호출 — 이후 다른 모든 함수가 쓸 매니저를 잡아 둔다. */
export function initSoundManager(scene) {
  manager = scene.sound;
  // 저장된 설정을 바로 입힌다 — 지난 판에 소리를 꺼 둔 사람에게 타이틀 곡부터
  // 다시 울리면, 그 설정은 저장된 적이 없는 것과 같다.
  applyVolumes();
}

/** 루프 없는 단발 효과음. */
export function playSfx(key, opts = {}) {
  const base = opts.volume ?? sfxVolume(key);
  manager?.play(`sfx-${key}`, { ...opts, volume: base * volumes.sfx });
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
  const base = opts.volume ?? (GAMEPLAY_BGM_KEYS.has(key) ? GAMEPLAY_BGM_VOLUME : MENU_BGM_VOLUME);
  if (currentBgmKey === soundKey && currentBgmSound?.isPlaying) {
    // 곡은 그대로 두고 볼륨만 이 화면의 것으로 고쳐 단다 — 곡이 같고 화면의 성격만
    // 다른 자리가 있다. 엔딩은 타이틀 곡을 대사 아래에 낮게 깔고(0.18), 거기서
    // [타이틀 화면으로] 돌아가면 같은 곡이 다시 메뉴 크기(0.45)로 서야 한다.
    // 곡을 끊지 않으므로 이어지는 느낌은 그대로다.
    if (base !== currentBgmBase) {
      currentBgmBase = base;
      currentBgmSound.setVolume(base * volumes.bgm);
    }
    return;
  }
  currentBgmSound?.stop();
  currentBgmBase = base;
  // 곡별 기본 크기(base)에 사용자 설정(volumes.bgm)을 곱한다 — 설정 창 슬라이더가
  // 곧바로 들리는 이유다. base 는 위에서 이미 opts.volume 과 메뉴/게임플레이 구분을
  // 흡수했으므로 여기서 다시 고를 필요가 없다.
  const sound = manager.add(soundKey, { loop: true, ...opts, volume: base * volumes.bgm });
  currentBgmSound = sound;
  currentBgmKey = soundKey;
  // 타이틀처럼 첫 화면부터 트는 곡은 사용자가 아직 아무것도 누르기 전이라 오디오
  // 컨텍스트가 잠겨 있다 — 지금 play() 를 불러도 소리 없이 씹힌다. 잠겨 있으면
  // Phaser 가 "unlock" 을 쏘는 순간(첫 클릭·키 입력)까지 기다렸다가 그때 튼다.
  if (manager.locked) manager.once('unlocked', () => { if (currentBgmSound === sound) sound.play(); });
  else sound.play();
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
    const base = opts.volume ?? sfxVolume(key);
    const sound = manager.add(`sfx-${key}`, { loop: true, ...opts, volume: base * volumes.sfx });
    sound.play();
    loops.set(key, { sound, base });
  } else if (playing) {
    playing.sound.stop();
    loops.delete(key);
  }
}

/**
 * 이미 켜져 있는 루프의 볼륨만 갈아 끼운다 — 게이지처럼 시간에 따라 커지는 연출용.
 * 루프가 꺼져 있으면 아무 일도 하지 않는다 (setLoop 로 먼저 켜야 한다).
 *
 * 넘기는 값은 **제작 볼륨**이다 — 효과음 채널 설정은 여기서 다시 곱해진다. 부르는
 * 쪽(EscapeScene 의 경고음)은 플레이어 설정을 몰라도 되고, 알아서도 안 된다.
 */
export function setLoopVolume(key, volume) {
  const loop = loops.get(key);
  if (!loop) return;
  loop.base = volume;
  loop.sound.setVolume(volume * volumes.sfx);
}
