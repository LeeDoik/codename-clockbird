/**
 * 단서 수첩 (DOM 오버레이) — index.html 의 #cluebook 과 짝.
 *
 * 캔버스가 아니라 DOM 인 이유는 Hud·DialogueBox 와 같다: 캔버스는 1920×1080 버퍼에
 * 그려진 뒤 창 크기에 맞춰 정수가 아닌 배율로 늘어나는데, pixelArt(NEAREST) 와
 * image-rendering:pixelated 때문에 그 확대에 보간이 없어 글자 획이 들쭉날쭉해진다.
 * 수첩은 여러 줄을 앉아서 읽으라고 띄우는 화면이라 그 흠이 가장 크게 드러나는 자리다.
 *
 * 치수는 캔버스 좌표 그대로다 — CSS 가 `calc(N * var(--s))` 로 적혀 있고 --s 가
 * "1920 기준 1px" 이라, 옛 컨테이너의 760×560 패널과 30/24/20px 글자가 그대로 산다.
 *
 * DocumentPanel 과 같은 싱글턴 규약 — scene.restart 로 create() 가 다시 돌 때마다
 * 같은 DOM 을 가리키는 객체가 늘어나지 않게 한다.
 */
let instance = null;

export class ClueBook {
  constructor() {
    if (instance) {
      // 새 판은 수첩이 닫힌 채로 출발해야 한다. 캔버스 시절엔 씬이 끝나면 컨테이너가
      // 통째로 사라졌지만, DOM 은 씬 밖에 살아남아 열린 상태가 다음 판까지 따라온다.
      instance.close();
      return instance;
    }
    instance = this;

    this.root = document.getElementById('cluebook');
    this.bodyEl = document.getElementById('cluebook-body');
  }

  /** 수첩 본문. 줄바꿈이 든 문자열이 그대로 나온다 (white-space: pre-wrap). */
  setText(text) {
    this.bodyEl.textContent = text;
  }

  open() {
    this.root.classList.add('visible');
  }

  close() {
    this.root.classList.remove('visible');
  }

  get isOpen() {
    return this.root.classList.contains('visible');
  }
}
