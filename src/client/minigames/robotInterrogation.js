/**
 * 신형 로봇 '에바'의 심문 — 스테이지 3 종반.
 *
 * 네트워크는 이 모듈이 모른다 — 호출부가 넘겨준 네 함수만 부른다 (검문 2단
 * interrogation.js 와 같은 정책). 덕분에 UI 흐름과 서버 계약이 따로 논다.
 */

import { DuelProgress } from '../ui/DuelProgress.js';

/** 답변 길이 상한. 서버도 같은 값으로 자른다 (여기 것은 편의, 저기 것은 방어). */
const MAX_ANSWER_LEN = 120;

/**
 * 에바의 대사는 이제 전부 고정 대본이다 — LLM 대사(reply)를 없앤 이유(interrogation.js
 * 주석 참조)와 같다. 판정마다 뜨는 대사도, 특이사항이 없는 평범한 턴에 뜨는 대사도
 * 전부 여기 있는 것 중 하나다. 즉흥 잡담이 낄 자리가 없어야 "질문 → 답변 → 평가 →
 * 다음 질문"이 안 새고 그대로 유지된다(2026-08-07 기획 대사).
 */
const LIE_WARN_LINE = '미세한 떨림, 신뢰도가 떨어지는 답변이네… 거짓말 할 생각은 안하는게 좋아!';
const LIE_FATAL_LINE = '또 거짓말? 나는 당신한테 기회를 준건데 실망이야... 죽어!';
const CONTRADICTION_LINE = '이전 답변과 말이 맞지 않는걸? 죽어!';
const VAGUE_LINE = '대답 똑바로 하는게 좋을거야. 내가 당신에게 기회를 준 것이란 거 잊지마!';
const EXPOSED_LINE = '시시하네... 죽어!';
const WIN_LINE = '오... 제법인걸.. 흥미롭군.. 약속은 약속이니까! 가도 좋아.';
/** 특이사항 없이 넘어갈 때 — 매번 같은 말이면 티가 나므로 몇 개 중 하나를 고른다. */
const NEXT_LINES = [
  '음... 좋아, 일단 넘어가지.',
  '좋아, 다음 질문.',
  '흠, 알겠어. 다음으로 가지.',
  '그렇군... 계속해 볼까.',
];

/**
 * @param {import('../ui/MinigamePanel.js').MinigamePanel} panel
 * @param {object} io
 * @param {() => Promise<{state: object}>} io.fetchStart
 * @param {() => Promise<void>} io.showIntro 심문 전 반전 대사 연출 (DialogueBox 등) — 끝날 때까지 기다린다
 * @param {(identityId: string) => Promise<{state: object}>} io.pickIdentity
 * @param {() => Promise<{question: string}>} io.fetchQuestion
 * @param {(answer: string) => Promise<{events: string[], declaration: object|null, state: object}>} io.submitAnswer
 * @returns {Promise<'win'|'lose'|'error'>}
 */
export async function runRobotInterrogation(panel, io) {
  const openPanel = () => panel.open({
    title: '심문',
    subtitle: '에바가 고개를 들어 올려다본다.',
    hint: '여기서는 걸어나갈 수 없다',
  });

  let start;
  try {
    start = await io.fetchStart();
  } catch (err) {
    openPanel();
    return fail(panel, `연결 실패 — ${err.message}`);
  }

  // 반전 대사("사실 나는 로봇이야") 가 다 나온 뒤에야 심문 패널을 연다 — 대사 위에
  // 심문 패널이 먼저 떠 있으면 순서가 어색하고, 이 게임 전체의 반전이 작은 상태줄로
  // 흘러 무게가 죽는다. 대사 연출 자체는 호출부(DialogueBox 를 쥔 씬)가 한다 —
  // 이 모듈은 여전히 DialogueBox 도 fetch 도 모른다.
  await io.showIntro();

  openPanel();
  panel.setStatus('…');

  // ── 1. 신분 카드 3장 ──
  const identityId = await askIdentity(panel, start.state.choices);
  try {
    await io.pickIdentity(identityId);
  } catch (err) {
    return fail(panel, `신분 확정 실패 — ${err.message}`);
  }

  // 개발 플래그(debug.identityId)는 제시된 카드 3장 밖의 신분을 강제로 세울 수 있다 —
  // "고른 카드는 항상 카드 3장 중 하나" 라는 전제가 그 경로에서는 깨진다. 카드에서
  // 못 찾으면 서버가 실제로 세운 신분(state.identity)으로 대신한다.
  const chosen = start.state.choices.find((c) => c.id === identityId) ?? start.state.identity;

  // 진행 명판 — 문항 램프와 탐지 게이지 (duel 배치에서만 보인다). 총 문항 수도
  // 탐지 시작값도 여기서 못박지 않는다 — 서버 state 가 단일 출처다.
  const progress = new DuelProgress();
  progress.reset(start.state);

  // ── 2. 문답 루프 ──
  for (;;) {
    panel.setStatus('…에바가 생각한다.');
    let q;
    try {
      q = await io.fetchQuestion();
    } catch (err) {
      return fail(panel, `질문 실패 — ${err.message}`);
    }

    const answer = await askAnswer(panel, q.question, chosen.word);

    panel.setStatus('…에바가 당신을 본다.');
    let r;
    try {
      r = await io.submitAnswer(answer);
    } catch (err) {
      return fail(panel, `전송 실패 — ${err.message}`);
    }

    // 대사가 나오는 동안 명판의 램프가 켜지고 게이지가 움직인다 — 판정이
    // 구석까지 갔다는 손맛은 말보다 그림이 먼저 준다.
    progress.record(r);
    await showReply(panel, r);

    if (r.state.outcome === 'win') {
      panel.setStatus(`"${WIN_LINE}"`);
      panel.verdictEl.textContent = '통과';
      panel.verdictEl.className = 'ok';
      await sleep(2600);
      panel.close();
      return 'win';
    }
    if (r.state.outcome === 'lose') {
      panel.verdictEl.textContent = '탐지';
      panel.verdictEl.className = 'fail';
      await sleep(2600);
      panel.close();
      return 'lose';
    }
  }
}

/** 신분 카드 3장 중 하나를 고른다. 고르기 전에는 진행할 수 없다. */
function askIdentity(panel, choices) {
  return panel.run({
    title: '신분을 고른다',
    subtitle: '에바 앞에서 당신은 누구인가. 끝까지 그 사람을 연기해야 한다.',
    hint: '고른 단어를 입 밖에 내면 그것도 위험하다',
    showVerdict: false,
    render: ({ content, finish }) => {
      const row = document.createElement('div');
      row.className = 'mg-col';
      for (const c of choices) {
        const b = document.createElement('button');
        b.className = 'mg-btn';
        b.textContent = c.word;
        b.onclick = () => finish(c.id);
        row.append(b);
      }
      content.append(row);
    },
  });
}

/**
 * 질문 하나에 자유 입력으로 답한다. 선택지는 없다 — 연기는 고르는 것이 아니다.
 *
 * 신분을 고른 뒤부터는 **마주 선 장면**이다 (layout: 'duel'). 에바가 왼쪽, 당신이
 * 오른쪽에 서고 대화 상자가 그 사이에 놓인다 — 카드 안의 문답이 아니라 둘이
 * 마주 보고 주고받는 말이라야 이 대목의 긴장이 산다.
 *
 * 제목은 이제 **말하는 사람**이다. 신분은 아래 안내로 내렸다 — 대화 상자의 머리에
 * 「단어」가 붙어 있으면 에바가 그 단어를 말하는 것처럼 읽힌다.
 */
function askAnswer(panel, question, identityWord) {
  return panel.run({
    title: '에바',
    subtitle: question,
    hint: `당신은 지금 「${identityWord}」다 — 그 사람으로 답한다`,
    layout: 'duel',
    showVerdict: false,
    render: ({ content, finish }) => {
      const free = document.createElement('div');
      free.className = 'mg-free';
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '답한다...';
      input.maxLength = MAX_ANSWER_LEN;
      input.autocomplete = 'off';
      const send = document.createElement('button');
      send.className = 'mg-btn';
      send.textContent = '답한다';

      const submit = () => {
        const v = input.value.trim();
        if (v) finish(v);
      };
      send.onclick = submit;
      input.addEventListener('keydown', (e) => {
        // IME 조합 중 Enter 는 한글 입력을 끊는다 — DialogueBox 와 같은 규칙.
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          submit();
        }
        e.stopPropagation(); // Phaser 키 입력과 충돌 방지 (DialogueBox 의 입력칸과 같은 규칙)
      });

      free.append(input, send);
      content.append(free);
      input.focus();
    },
  });
}

/**
 * 로봇의 대사와 이번 턴에 벌어진 일을 보여 준다.
 *
 * 대사는 전부 고정 대본이다(NEXT_LINES 위 주석 참조) — 판정에 걸린 게 없으면
 * NEXT_LINES 중 하나로 그냥 다음 질문으로 넘어간다. 여러 결함이 한 턴에 같이
 * 잡혀도 상자에는 한 줄만 걸리므로, 가장 무거운 것부터 우선순위를 매긴다:
 * 모순 > 거짓(2회째) > 거짓(1회째) > 모호.
 */
async function showReply(panel, r) {
  const notes = [];
  let line;

  if (r.events.includes('contradiction')) line = CONTRADICTION_LINE;
  else if (r.events.includes('lie-fatal')) line = LIE_FATAL_LINE;
  else if (r.events.includes('lie-warned')) line = LIE_WARN_LINE;
  else if (r.events.includes('vague')) line = VAGUE_LINE;
  else line = NEXT_LINES[Math.floor(Math.random() * NEXT_LINES.length)];

  if (r.declaration) {
    if (r.declaration.hit) {
      line = EXPOSED_LINE;
    } else {
      notes.push(`"당신은 ${r.declaration.word}이지?" — 빗나갔다.`);
    }
  }

  // 에바의 대답은 **대화 상자 안**에 온다 (title/subtitle). 예전에는 본문 칸에
  // 넣었는데, 마주 선 배치에서는 상자에 아직 앞 질문이 걸려 있어 "묻고 답하는"
  // 순서가 어긋나 보였다. 상자가 곧 그 사람의 입이다.
  panel.titleEl.textContent = '에바';
  panel.subtitleEl.textContent = line;

  // 이번 턴에 벌어진 일과 눈금은 상자 밖 — 대사가 아니라 기록이다.
  const box = document.createElement('div');
  box.className = 'mg-col';

  for (const n of notes) {
    const p = document.createElement('div');
    p.textContent = n;
    p.style.opacity = '0.7';
    box.append(p);
  }

  // 탐지 수치와 몇 문째인지는 우상단 진행 명판(DuelProgress)이 상시 게시한다 —
  // 예전의 `탐지 100 · 3/8` 한 줄은 그쪽으로 옮겨 갔다.
  panel.contentEl.replaceChildren(box);
  await sleep(notes.length ? 3000 : 2000);
}

function fail(panel, message) {
  panel.setStatus(message);
  return sleep(1600).then(() => {
    panel.close();
    return 'error';
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
