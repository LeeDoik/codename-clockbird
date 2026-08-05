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
