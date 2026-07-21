import Phaser from 'phaser';
import { DialogueBox } from '../ui/DialogueBox.js';
import { buildTilemap, createPlayer, applyMovement, nearestOf } from '../world/worldParts.js';
import hqData from '../assets/hq.json';

/**
 * 튜토리얼 — 레지스탕스 본부.
 *
 * 여기엔 순찰도 검문도 감옥도 없다. 실패해도 판이 끝나지 않는다 (신뢰도만 깎인다).
 * 가르치는 것은 셋이다: 걷고, 말을 걸고, 겹치는 단어를 찾아 한 사람에게 건넨다.
 */
const TALK_RANGE = 48;
const TILE = hqData.tileSize;
const PLAYER_FRAME = 0;
// 간부·동료 전용 스프라이트는 아직 없다 — chars.png 의 기존 프레임을 빌려 쓴다 (아트는 W3).
const OFFICER_FRAME = 6;
const TUTOR_FRAME = { t1: 2, t2: 5, t3: 3 };

const LABEL_STYLE = {
  fontFamily: 'Malgun Gothic, sans-serif',
  fontSize: '11px',
  color: '#8a7f6a',
};

export class TutorialScene extends Phaser.Scene {
  constructor() {
    super('Tutorial');
  }

  init() {
    this.state = null;
    this.allyNodes = [];
    this.nearbyAlly = null;
    this.nearbyOfficer = false;
    // 지나가며 뜬 안내인가 — 이것만 사거리를 벗어날 때 자동으로 접는다.
    this.proximityHint = false;
    this.ended = false;
  }

  create() {
    this.dialogue = new DialogueBox();

    this.walls = buildTilemap(this, hqData);
    this.player = createPlayer(this, hqData, this.walls, PLAYER_FRAME);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.keyE = this.input.keyboard.addKey('E');
    this.keyF = this.input.keyboard.addKey('F');
    this.keySpace = this.input.keyboard.addKey('SPACE');
    this.keyEsc = this.input.keyboard.addKey('ESC');

    this.add.text(12, 10, '레지스탕스 본부 — 훈련', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '12px',
      color: '#8a7f6a',
    });
    this.add.text(12, this.scale.height - 22, '[E] 대화    [F] 접선 코드', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '11px',
      color: '#6b6152',
    });

    this.#start();
  }

  /** 세션을 연다. 힌트가 고정 세트라 LLM 대기가 없어 곧바로 돌아온다. */
  async #start() {
    try {
      const res = await fetch('/api/tutorial/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      this.state = data;
    } catch (err) {
      this.dialogue.show('오류', `튜토리얼을 시작할 수 없습니다.\n${err.message}`);
      return;
    }

    this.#spawnNpcs();
    this.#showBriefing();
  }

  #spawnNpcs() {
    const os = hqData.spawns.officer;
    const ox = os.col * TILE + TILE / 2;
    const oy = os.row * TILE + TILE / 2;
    this.officerNode = this.add.sprite(ox, oy, 'chars', OFFICER_FRAME);
    this.add
      .text(ox, oy - 24, `${this.state.officer.name} (${this.state.officer.role})`, LABEL_STYLE)
      .setOrigin(0.5);

    this.state.allies.forEach((ally, i) => {
      const sp = hqData.spawns.allies[i];
      const x = sp.col * TILE + TILE / 2;
      const y = sp.row * TILE + TILE / 2;

      const node = this.add.sprite(x, y, 'chars', TUTOR_FRAME[ally.id] ?? i + 1);
      const label = this.add.text(x, y - 24, ally.name, LABEL_STYLE).setOrigin(0.5);
      // 신뢰도는 튜토리얼에만 있는 규칙이라 여기서만 화면에 세운다.
      const trust = this.add
        .text(x, y - 38, '', { ...LABEL_STYLE, fontSize: '12px', color: '#c9a227' })
        .setOrigin(0.5);

      this.allyNodes.push({ ally, node, label, trust });
    });

    this.#refreshTrust();
  }

  /** this.state 의 신뢰도를 동료 머리 위 표시(●●/●○/○○)에 반영한다. */
  #refreshTrust() {
    for (const entry of this.allyNodes) {
      const live = this.state.allies.find((a) => a.id === entry.ally.id);
      if (live) entry.ally = live;
      entry.trust.setText('●'.repeat(entry.ally.trust) + '○'.repeat(2 - entry.ally.trust));
    }
  }

  #showBriefing() {
    this.dialogue.show(
      `${this.state.officer.name} (${this.state.officer.role})`,
      '"거리에 나가기 전에 한 가지만 익히고 가라.\n\n' +
        '우리는 서로를 단어로 알아본다. 저기 셋이 같은 것을 두고 각자 다른 단어를 떠올렸다.\n' +
        '셋을 모아 겹치는 것 하나를 찾아내라 — 그게 접선 코드다.\n\n' +
        '[WASD] 로 걷고, 동료 앞에서 [E] 로 말을 건다.\n답을 찾으면 내 앞에서 [F]."',
    );
    this.dialogue.setHint('[Space] / [Esc] 로 닫는다');
  }

  update() {
    if (this.ended || !this.state) return;

    const typing = this.dialogue.isTyping;
    if (typing) this.player.body.setVelocity(0, 0);
    else applyMovement(this.player, { cursors: this.cursors, wasd: this.wasd });

    this.#checkProximity();

    if (!typing && Phaser.Input.Keyboard.JustDown(this.keySpace)) this.dialogue.hide();
    if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) this.dialogue.hide();
  }

  #checkProximity() {
    if (!this.officerNode) return;

    const ally = nearestOf(
      this.player,
      this.allyNodes.map((e) => ({ value: e.ally, x: e.node.x, y: e.node.y })),
      TALK_RANGE,
    );
    const officer = Boolean(
      nearestOf(
        this.player,
        [{ value: true, x: this.officerNode.x, y: this.officerNode.y }],
        TALK_RANGE,
      ),
    );

    if (ally === this.nearbyAlly && officer === this.nearbyOfficer) return;
    this.nearbyAlly = ally;
    this.nearbyOfficer = officer;

    if (ally && !this.dialogue.isOpen) {
      this.dialogue.show(ally.name, `${ally.name} (${ally.role}) — [E] 대화`);
      this.proximityHint = true;
    } else if (officer && !ally && !this.dialogue.isOpen) {
      const o = this.state.officer;
      this.dialogue.show(o.name, `${o.name} (${o.role}) — [E] 대화 · [F] 접선 코드`);
      this.proximityHint = true;
    } else if (!ally && !officer && this.proximityHint) {
      this.dialogue.hide();
      this.proximityHint = false;
    }
  }
}
