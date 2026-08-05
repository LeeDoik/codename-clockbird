/**
 * 검문 조우 — 자석 수류탄 투척 (2단계).
 *
 * 순찰 로봇에게 걸린 순간 열린다. 빠져나갈 방법은 이것 하나뿐이다 — 예전에는 신원
 * 스캔을 피하는 타이밍 게임 한 판이었고 그걸 놓치면 LLM 심문이 마지막 기회로 열렸는데,
 * 2026-08-05 기획 목업에서 **조우 전체가 수류탄 시퀀스**로 바뀌었다 (심문은 삭제).
 *
 * ── 두 단계 ──
 *
 *   1. **자기력 충전** — [Space] 를 연타해 세로 게이지를 채운다. 손을 놓으면 빠지므로
 *      두들겨야 오른다. 가득 차면 **곧바로** 투척 단계로 넘어간다 (기다려 주지 않는다).
 *   2. **투척** — 손잡이가 트랙 위를 왕복한다. 초록 구간에서 [Space] 를 누르면 명중,
 *      벗어나면 그 자리에서 실패다.
 *
 * 두 단계가 제한 시간 하나를 나눠 쓴다. 충전에서 꾸물대면 던질 시간이 줄어든다 —
 * 두 개의 타이머로 나누면 "충전은 아무리 늦어도 괜찮다"가 되어 긴박함이 사라진다.
 *
 * 경계 수위가 오르면 초록 구간이 좁아지고 손잡이가 빨라진다. 같은 사건이 반복될수록
 * 실제로 어려워져야 "경계가 올랐다"는 숫자가 몸으로 읽힌다.
 */

/** 게이지 칸 수 — 화면에 그려지는 칸이자 충전의 단위다. */
const CHARGE_CELLS = 6;
/** 한 번 누를 때 차오르는 양 (칸). 여섯 칸을 채우는 데 최소 다섯 번이다. */
const CHARGE_PER_HIT = 1.2;
/** 손을 놓으면 초당 이만큼 빠진다 — 이게 없으면 천천히 눌러도 채워져 연타가 아니다. */
const CHARGE_DECAY_PER_SEC = 1.9;

/** 초록 구간 폭 (트랙 대비 비율) */
const ZONE_BASE = 0.24;
const ZONE_PER_LEVEL = 0.035;
const ZONE_MIN = 0.09;
/** 손잡이가 트랙을 한 번 훑는 시간 (ms) */
const SWEEP_MS_BASE = 1500;
const SWEEP_MS_PER_LEVEL = 170;
const SWEEP_MS_MIN = 620;
/** 두 단계를 합쳐 이 안에 끝내야 한다 */
const TIME_LIMIT_MS = 12_000;
/** 경계 레벨 상한 — Patrol 과 같은 값을 쓴다 */
const MAX_LEVEL = 3;

/**
 * 인물 그림. 파일이 없으면 숨는다 — 초상(DialogueBox)과 같은 규약이다.
 *
 * 왼쪽은 단계마다 갈린다. 충전은 수류탄을 쥔 손을 **클로즈업**으로 보여 주고
 * (지금 하는 일이 "충전"이라 손과 번개가 화면을 채워야 한다), 투척은 던지는
 * 소년의 전신으로 물러난다 (겨눌 대상인 로봇이 같이 보여야 한다).
 */
const ART = {
  charge: '/ui/grenade-charge.png',
  left: '/ui/grenade-throw.png',
  right: '/ui/guard-robot.png',
};

function artImage(src, cls) {
  const img = document.createElement('img');
  img.className = `gr-art ${cls}`;
  img.alt = '';
  // 아트가 아직 없다 — 없는 채로도 판은 성립해야 하므로 조용히 숨긴다.
  img.addEventListener('error', () => img.remove());
  img.src = src;
  return img;
}

/**
 * @param {import('../ui/MinigamePanel.js').MinigamePanel} panel
 * @param {number} alertLevel
 * @returns {Promise<boolean>} 명중 여부
 */
export function runGrenadeThrow(panel, alertLevel) {
  const level = Math.min(alertLevel, MAX_LEVEL);
  const zoneW = Math.max(ZONE_MIN, ZONE_BASE - ZONE_PER_LEVEL * level);
  const sweepMs = Math.max(SWEEP_MS_MIN, SWEEP_MS_BASE - SWEEP_MS_PER_LEVEL * level);
  // 구간이 가장자리에 붙으면 왕복 끝에서 손잡이가 오래 머물러 쉬워진다 — 안쪽에만 둔다.
  const zoneStart = 0.08 + Math.random() * (1 - zoneW - 0.16);

  return panel.run({
    title: '수류탄 투척',
    subtitle: '버튼을 연타하여 자기력을 충전하세요.',
    // ⚠ 글자를 넣지 않는다 — 경고 삼각형은 이제 그림이다 (index.html 의
    //   #minigame-hint 배경). 글자를 두면 삼각형이 둘이 된다.
    hint: '충전이 완료되면 바로 투척 단계로 넘어갑니다.',
    timeLimitMs: TIME_LIMIT_MS,
    layout: 'stage',
    render: ({ content, finish, setHint, setSubtitle }) => {
      const stage = document.createElement('div');
      stage.className = 'gr-stage charging';

      const controls = document.createElement('div');
      controls.className = 'gr-controls';
      const button = document.createElement('button');
      button.className = 'gr-space';
      button.type = 'button';
      button.textContent = 'SPACE';
      controls.append(button);

      // 세로 게이지 (1단계)
      const gauge = document.createElement('div');
      gauge.className = 'gr-gauge';
      const cells = Array.from({ length: CHARGE_CELLS }, () => {
        const cell = document.createElement('div');
        cell.className = 'gr-cell';
        gauge.append(cell);
        return cell;
      });

      // 가로 트랙 (2단계)
      const track = document.createElement('div');
      track.className = 'gr-track';
      const zone = document.createElement('div');
      zone.className = 'gr-zone';
      zone.style.left = `${zoneStart * 100}%`;
      zone.style.width = `${zoneW * 100}%`;
      const needle = document.createElement('div');
      needle.className = 'gr-needle';
      track.append(zone, needle);

      stage.append(
        artImage(ART.charge, 'gr-art-charge'),
        artImage(ART.left, 'gr-art-left'),
        controls,
        artImage(ART.right, 'gr-art-right'),
        gauge,
        track,
      );
      content.append(stage);

      let phase = 'charge';
      let charge = 0;
      let pos = 0;
      // 투척 단계에 들어선 시각부터 손잡이를 돌린다 — 충전에 쓴 시간만큼 위상이
      // 어긋나 있으면 매번 다른 자리에서 시작해 첫 프레임을 읽을 수 없다.
      let sweepElapsed = 0;

      // 패널의 제한 시간과 같은 이유로 프레임 간격을 쌓아 잰다 — 탭을 다녀왔을 때
      // 그 공백을 그대로 인정하면 게이지가 통째로 빠지거나 손잡이가 순간이동한다.
      const MAX_FRAME_MS = 100;
      let last = performance.now();
      let rafId = 0;

      const tick = () => {
        const now = performance.now();
        const dt = Math.min(now - last, MAX_FRAME_MS);
        last = now;

        if (phase === 'charge') {
          charge = Math.max(0, charge - (CHARGE_DECAY_PER_SEC * dt) / 1000);
          for (const [i, cell] of cells.entries()) cell.classList.toggle('on', charge > i);
          if (charge >= CHARGE_CELLS) toThrow();
        } else {
          sweepElapsed += dt;
          // 삼각파: 0 → 1 → 0 을 반복한다. sin 을 쓰면 양끝에서 느려져 가장자리 구간이
          // 거저먹기가 된다.
          const t = (sweepElapsed / sweepMs) % 2;
          pos = t <= 1 ? t : 2 - t;
          needle.style.left = `${pos * 100}%`;
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);

      function toThrow() {
        phase = 'throw';
        stage.classList.replace('charging', 'throwing');
        setSubtitle('손잡이가 초록색 구간일 때 던지세요.');
        setHint('범위를 벗어나면 바로 실패!');
      }

      const press = () => {
        // 눌린 티를 즉시 낸다. 연타는 손맛이 전부라, 반응이 한 프레임만 늦어도
        // 버튼이 안 먹는 것처럼 느껴진다.
        button.classList.add('hit');
        window.setTimeout(() => button.classList.remove('hit'), 70);

        if (phase === 'charge') {
          charge = Math.min(CHARGE_CELLS, charge + CHARGE_PER_HIT);
          for (const [i, cell] of cells.entries()) cell.classList.toggle('on', charge > i);
          if (charge >= CHARGE_CELLS) toThrow();
          return;
        }
        cancelAnimationFrame(rafId);
        const ok = pos >= zoneStart && pos <= zoneStart + zoneW;

        // 판정 연출을 **finish 보다 먼저** 붙인다. finish 는 성공/실패 글자를 띄우고
        // 800ms 뒤 패널을 접는데(MinigamePanel.run), 그 800ms 동안 무대 DOM 은 살아
        // 있다. 그 틈이 이 그림이 사는 자리다 — finish 뒤에 붙이면 이미 정리 함수가
        // 돌아 rAF 는 멈췄어도 순서가 헷갈리고, 패널이 접히며 같이 지워질 수 있다.
        // ⚠ 'throwing' 을 떼면 안 된다. 단계 표시는 `.charging`/`.throwing` 둘뿐이라
        //   떼는 순간 어느 쪽도 아니게 되어 **숨겨 뒀던 게이지가 도로 나타난다.**
        //   덧붙이는 'settled' 로 조작부만 걷어낸다.
        stage.classList.add('settled');
        const burst = document.createElement('div');
        burst.className = `gr-burst ${ok ? 'hit' : 'miss'}`;
        stage.append(burst);

        finish(ok);
      };

      button.addEventListener('click', press);
      panel.onKey = (e) => {
        // ⚠ 자동 반복(꾹 누르기)은 세지 않는다. 키를 누르고 있으면 브라우저가 초당
        // 수십 번 keydown 을 쏘는데, 그걸 인정하면 **누르고만 있어도 충전이 끝난다** —
        // 연타 게임이 아니라 버튼 하나 누르고 기다리는 게임이 된다.
        if (e.repeat) return;
        if (e.key === ' ' || e.key === 'Enter') press();
      };

      // 제한 시간에 걸려 패널이 접을 때도 rAF 는 반드시 멈춰야 한다.
      return () => cancelAnimationFrame(rafId);
    },
  });
}
