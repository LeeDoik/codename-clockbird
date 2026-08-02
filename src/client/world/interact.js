import { nearestOf, worldToScreen } from './worldParts.js';

/**
 * 공통 인터랙션 레이어 (스펙 §2).
 *
 * 세 씬(튜토리얼·거리·저택)이 각자 들고 있던 근접 감지·안내 표시·E 분기를 여기로
 * 모은다. 씬은 노드를 등록만 하고, 감지와 말풍선과 유형별 기본 동작은 레이어가 갖는다.
 * 기존의 "지나가면 대화창에 안내 문자열" 방식(proximityHint)은 말풍선으로 대체된다 —
 * 대화창은 이제 플레이어가 E 를 눌렀을 때만 열린다.
 *
 * E 이외의 키(F 접선·R 구출 등)는 씬의 몫이다 — 레이어는 current 를 내줄 뿐이다.
 */
const DEFAULT_RANGE = 48;
const VERB = { npc: '대화', choiceNpc: '대화', door: '열기', document: '열람', object: '조사' };

export class InteractionManager {
  constructor(scene, dialogue) {
    this.scene = scene;
    this.dialogue = dialogue;
    this.nodes = new Map();
    this.nearest = null;
    this.#buildBubble();
  }

  /**
   * 말풍선 — 검은 바탕 + 황동 테두리의 작은 라벨. 대상의 머리 위를 따라다닌다.
   *
   * 그리는 쪽은 월드가 아니라 **UI 카메라**다. 월드에 두면 카메라 줌만큼 확대되는데
   * pixelArt(NEAREST) 라 보간 없이 늘어나, 본부(줌 2.8125)에서는 글자가 아니라
   * 노란 얼룩이 됐다. 위치만 worldToScreen 으로 옮기면 어떤 맵에서도 같은 크기로 또렷하다.
   */
  #buildBubble() {
    const s = this.scene;
    this.bubbleText = s.add
      .text(0, 0, '', { fontFamily: 'Gowun Batang, serif', fontSize: '22px', color: '#e8c15a' })
      .setOrigin(0.5, 1)
      .setDepth(40);
    this.bubbleBg = s.add.graphics().setDepth(39);
    this.bubbleText.setVisible(false);
    this.bubbleBg.setVisible(false);
    // setupCameras 이후에 만들어질 수 있으므로 소속을 밝힌다 (없으면 no-op)
    s.asUi?.(this.bubbleText, this.bubbleBg);
  }

  /** @param {number} x @param {number} y 대상의 **월드** 좌표 */
  #drawBubble(x, y, text) {
    // 머리 위 30px 은 월드 기준이다 — 화면으로 옮기기 전에 더해야 줌이 달라도
    // 인물과의 간격이 그대로 유지된다.
    const p = worldToScreen(this.scene.cameras.main, x, y - 30);
    this.bubbleText.setText(text).setPosition(Math.round(p.x), Math.round(p.y)).setVisible(true);
    const b = this.bubbleText.getBounds();
    this.bubbleBg
      .clear()
      .fillStyle(0x0a0906, 0.88)
      .lineStyle(1, 0x7a5f1a, 1)
      .fillRoundedRect(b.x - 5, b.y - 3, b.width + 10, b.height + 6, 3)
      .strokeRoundedRect(b.x - 5, b.y - 3, b.width + 10, b.height + 6, 3)
      .setVisible(true);
  }

  #hideBubble() {
    this.bubbleText.setVisible(false);
    this.bubbleBg.setVisible(false);
  }

  register(node) {
    this.nodes.set(node.id, node);
    return node;
  }

  remove(id) {
    this.nodes.delete(id);
    if (this.nearest?.id === id) this.nearest = null;
  }

  clear() {
    this.nodes.clear();
    this.nearest = null;
    this.#hideBubble();
  }

  #posOf(node) {
    return node.sprite ? { x: node.sprite.x, y: node.sprite.y } : { x: node.x, y: node.y };
  }

  get current() {
    return this.nearest;
  }

  /** 매 프레임 — 최근접 노드를 갱신하고 말풍선을 옮긴다. */
  update(player, { suppress = false } = {}) {
    if (suppress || this.dialogue.isOpen) {
      // 대화 중에는 말풍선이 소음이다. 노드 추적은 유지한다 (F/R 분기가 current 를 쓴다).
      this.#hideBubble();
    }
    const items = [];
    let maxRange = DEFAULT_RANGE;
    for (const node of this.nodes.values()) {
      const { x, y } = this.#posOf(node);
      items.push({ value: node, x, y });
      maxRange = Math.max(maxRange, node.range ?? DEFAULT_RANGE);
    }
    // range 는 노드마다 다를 수 있어(문은 56) 최대 범위로 모은 뒤 개별 확인한다.
    const found = nearestOf(player, items, maxRange);
    const near =
      found &&
      (() => {
        const { x, y } = this.#posOf(found);
        const dist = Math.hypot(player.x - x, player.y - y);
        return dist <= (found.range ?? DEFAULT_RANGE) ? found : null;
      })();

    this.nearest = near ?? null;
    if (!this.nearest || suppress || this.dialogue.isOpen) {
      if (!this.nearest) this.#hideBubble();
      return;
    }
    const { x, y } = this.#posOf(this.nearest);
    const verb = VERB[this.nearest.type] ?? '대화';
    this.#drawBubble(x, y, this.nearest.bubble ?? `[E] ${verb}`);
  }

  /** E — 현재 노드의 유형별 기본 동작 (스펙 §2 표). */
  trigger() {
    const node = this.nearest;
    if (!node) return false;
    this.#hideBubble();

    if (node.onInteract && node.type !== 'door') {
      node.onInteract(node);
      return true;
    }

    switch (node.type) {
      case 'npc':
        this.dialogue.show(node.speaker, node.line, { portrait: node.portrait });
        this.dialogue.setHint('[Space] 다음 · [Esc] 닫기');
        return true;

      case 'choiceNpc': {
        const open = () => {
          this.dialogue.showChoices(node.choices);
          this.dialogue.onChoice = (key) => node.onChoice?.(key);
          this.dialogue.setHint('');
        };
        // 기본 대사를 다 읽으면 선택지가 나온다. 대사가 짧으면 첫 페이지부터 함께 보인다.
        this.dialogue.show(node.speaker, node.line, {
          portrait: node.portrait,
          onPagesDone: open,
        });
        if (!this.dialogue.hasMore) open();
        else this.dialogue.setHint('[Space] 다음');
        return true;
      }

      case 'door':
        if (node.isUnlocked?.()) {
          this.dialogue.show('문', node.openText ?? '문이 열렸다.');
          this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
          node.onOpen?.();
        } else {
          this.dialogue.show('문', node.lockedText ?? '잠겨 있다. 열쇠가 필요할 것 같다.');
          this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
        }
        return true;

      default:
        return false;
    }
  }
}
