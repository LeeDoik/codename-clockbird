import { DEFAULT_CHAR_HEIGHT, nearestOf, worldToScreen } from './worldParts.js';

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
/**
 * 사거리·말풍선 높이는 **캐릭터 키에 비례한다** (맵 json 의 charHeight).
 *
 * 절대 픽셀로 두면 그림이 큰 맵에서 팔 길이가 반으로 줄어든 것처럼 된다 — 인물이
 * 96px 인데 사거리가 48px 이면 상대 몸에 겹쳐야 말이 걸린다. 아래 비율은 32px
 * 캐릭터에서 예전 값(48 · 30)과 정확히 같은 수가 나오도록 잡았다.
 */
const RANGE_RATIO = 48 / DEFAULT_CHAR_HEIGHT;
const BUBBLE_RATIO = 30 / DEFAULT_CHAR_HEIGHT;
const VERB = { npc: '대화', choiceNpc: '대화', door: '열기', document: '열람', object: '조사' };

/**
 * 말풍선 글자 크기 (화면 px). 말풍선은 줌 없는 UI 카메라에 그리므로 이 값이 곧
 * 화면에서 보이는 크기다 — 맵의 줌이나 charHeight 와 무관하게 어느 씬에서나 같다.
 *
 * 1920×1080 캔버스에서 22px 은 인물 키의 1/7 도 안 돼, 다가가도 안내가 눈에 안 들어왔다.
 * 대화창 본문(24px)과 비슷한 급으로 올린다.
 */
const BUBBLE_FONT_PX = 32;
/** 글자 주위 여백·모서리 (화면 px). 글자 크기를 바꾸면 같이 따라와야 테가 답답하지 않다. */
const BUBBLE_PAD_X = Math.round(BUBBLE_FONT_PX * 0.34);
const BUBBLE_PAD_Y = Math.round(BUBBLE_FONT_PX * 0.20);
const BUBBLE_RADIUS = 5;

export class InteractionManager {
  /**
   * @param {number} [charHeight] 이 맵의 인물 높이(월드 px). 씬이 맵 json 에서 읽어 넘긴다.
   */
  constructor(scene, dialogue, charHeight = DEFAULT_CHAR_HEIGHT) {
    this.scene = scene;
    this.dialogue = dialogue;
    this.nodes = new Map();
    this.nearest = null;
    this.defaultRange = charHeight * RANGE_RATIO;
    this.bubbleDy = charHeight * BUBBLE_RATIO;
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
      .text(0, 0, '', { fontFamily: 'Gowun Batang, serif', fontSize: `${BUBBLE_FONT_PX}px`, color: '#e8c15a' })
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
    // 머리 위 간격은 월드 기준이다 — 화면으로 옮기기 전에 더해야 줌이 달라도
    // 인물과의 간격이 그대로 유지된다.
    const p = worldToScreen(this.scene.cameras.main, x, y - this.bubbleDy);
    this.bubbleText.setText(text).setPosition(Math.round(p.x), Math.round(p.y)).setVisible(true);
    const b = this.bubbleText.getBounds();
    const rect = [
      b.x - BUBBLE_PAD_X,
      b.y - BUBBLE_PAD_Y,
      b.width + BUBBLE_PAD_X * 2,
      b.height + BUBBLE_PAD_Y * 2,
      BUBBLE_RADIUS,
    ];
    this.bubbleBg
      .clear()
      .fillStyle(0x0a0906, 0.88)
      .lineStyle(2, 0x7a5f1a, 1)
      .fillRoundedRect(...rect)
      .strokeRoundedRect(...rect)
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
    let maxRange = this.defaultRange;
    for (const node of this.nodes.values()) {
      const { x, y } = this.#posOf(node);
      items.push({ value: node, x, y });
      maxRange = Math.max(maxRange, node.range ?? this.defaultRange);
    }
    // range 는 노드마다 다를 수 있어(저택 연구실 문) 최대 범위로 모은 뒤 개별 확인한다.
    const found = nearestOf(player, items, maxRange);
    const near =
      found &&
      (() => {
        const { x, y } = this.#posOf(found);
        const dist = Math.hypot(player.x - x, player.y - y);
        return dist <= (found.range ?? this.defaultRange) ? found : null;
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
