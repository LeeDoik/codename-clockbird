/**
 * 씬 전환 로딩 화면 — index.html 의 #transition 과 짝.
 *
 * 씬(Phaser)이 아니라 DOM 인 이유: 이 화면의 소임은 **씬이 바뀌는 사이**를 덮는 것이다.
 * 씬에 그리면 scene.start 와 함께 죽어 정확히 덮어야 할 프레임을 못 덮는다. 카메라
 * 페이드가 캔버스만 어둡게 하고 HUD·대화창(DOM)은 남기는 문제도 같이 풀린다.
 *
 * 여는 쪽과 걷는 쪽이 다르다: **떠나는 씬이 show(), 도착한 씬이 hide()** 를 부른다 —
 * "이제 보여줄 것이 준비됐다"는 도착한 씬만이 안다. 도착한 씬은 로딩을 거치지 않고
 * 들어왔을 수도 있으므로(재시작·개발용 직행) hide() 는 안 떠 있어도 무해해야 한다.
 */
let instance = null;

/**
 * 스테이지 사이에 이 화면이 떠 있는 최소 시간 (ms).
 *
 * 본부 → 거리(스테이지 1)에는 기다릴 것이 실제로 있다 — 연상 단어 생성이 11~20초라
 * 이 화면은 그 대기를 덮는 판이었다. 그런데 2 → 3, 3 → 엔딩에는 기다릴 것이 없어서,
 * 예전에는 페이드 아웃이 끝나자마자 다음 씬이 열렸다. 그 결과 저택에서는 에이던이
 * 암전 위에서 브리핑을 마치자마자 저택 안에서 또 말을 걸어, 장소를 옮긴 것이 아니라
 * 같은 자리에서 말을 이은 것처럼 보였다 (2026-08-07 기획 피드백).
 *
 * 그래서 **기다릴 것이 없어도 이만큼은 머문다**. 안팎의 CSS 페이드가 400ms 씩이므로
 * 꽉 찬 채로 보이는 시간은 이 값에서 800ms 를 뺀 만큼이다 — 그 사이가 "이동했다"로
 * 읽히는 자리다. 더 줄이면 깜빡임이 되고, 더 늘리면 다시 해 보는 판에서 지루해진다.
 */
export const SCENE_TRANSITION_MS = 2200;

/**
 * 이 화면이 뜨고 걷히는 데 걸리는 시간 (ms) — index.html `#transition` 의
 * `transition: opacity 400ms` 와 **반드시 같은 값**이어야 한다.
 *
 * 도착한 씬이 hide() 뒤에 대사를 띄울 때 이만큼 기다리라고 알려 주는 값이다.
 * 대화창도 DOM 이라 이 화면 아래에 깔리므로, 곧바로 띄우면 첫 문장이 커튼 뒤에서
 * 흘러가 버린다.
 */
export const TRANSITION_FADE_MS = 400;

export class TransitionScreen {
  /** 다른 DOM 오버레이(Hud·DialogueBox)와 같은 이유로 싱글턴 — 같은 노드를 여럿이 쥐면 안 된다. */
  constructor() {
    if (instance) return instance;
    instance = this;

    this.root = document.getElementById('transition');
    this.titleEl = document.getElementById('transition-title');
    this.subEl = document.getElementById('transition-sub');
  }

  /**
   * @param {string} title 예: '거리로 이동 중' — 차례로 깜빡이는 말줄임 점 셋은 여기서 붙는다
   * @param {string} [sub] 그 아래 흐린 한 줄 (무엇을 기다리는지)
   */
  show(title, sub = '') {
    this.titleEl.replaceChildren(title);
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'tr-dot';
      dot.textContent = '.';
      this.titleEl.append(dot);
    }
    this.subEl.textContent = sub;
    this.root.classList.add('visible');
  }

  /** CSS transition(400ms)을 타고 서서히 걷힌다 — 도착한 씬의 페이드 인과 겹친다. */
  hide() {
    this.root.classList.remove('visible');
  }
}
