/**
 * 신형 로봇 '꼬마'의 심문 — 스테이지 3 종반.
 *
 * 네트워크는 이 모듈이 모른다 — 호출부가 넘겨준 네 함수만 부른다 (검문 2단
 * interrogation.js 와 같은 정책). 덕분에 UI 흐름과 서버 계약이 따로 논다.
 */

/** 답변 길이 상한. 서버도 같은 값으로 자른다 (여기 것은 편의, 저기 것은 방어). */
const MAX_ANSWER_LEN = 120;

/**
 * @param {import('../ui/MinigamePanel.js').MinigamePanel} panel
 * @param {object} io
 * @param {() => Promise<{state: object, child: object}>} io.fetchStart
 * @param {(child: object) => Promise<void>} io.showIntro 심문 전 반전 대사 연출 (DialogueBox 등) — 끝날 때까지 기다린다
 * @param {(identityId: string) => Promise<{state: object}>} io.pickIdentity
 * @param {() => Promise<{question: string}>} io.fetchQuestion
 * @param {(answer: string) => Promise<{npcReply: string, events: string[], declaration: object|null, state: object}>} io.submitAnswer
 * @returns {Promise<'win'|'lose'|'error'>}
 */
export async function runRobotInterrogation(panel, io) {
  const openPanel = () => panel.open({
    title: '심문',
    subtitle: '아이가 고개를 들어 올려다본다.',
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
  await io.showIntro(start.child);

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

  // ── 2. 문답 루프 ──
  for (;;) {
    panel.setStatus('…아이가 생각한다.');
    let q;
    try {
      q = await io.fetchQuestion();
    } catch (err) {
      return fail(panel, `질문 실패 — ${err.message}`);
    }

    const answer = await askAnswer(panel, q.question, chosen.word);

    panel.setStatus('…아이가 당신을 본다.');
    let r;
    try {
      r = await io.submitAnswer(answer);
    } catch (err) {
      return fail(panel, `전송 실패 — ${err.message}`);
    }

    await showReply(panel, r, chosen.word);

    if (r.state.outcome === 'win') {
      panel.setStatus('"흥미롭네. 가도 좋아."');
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
    subtitle: '이 아이 앞에서 당신은 누구인가. 끝까지 그 사람을 연기해야 한다.',
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

/** 질문 하나에 자유 입력으로 답한다. 선택지는 없다 — 연기는 고르는 것이 아니다. */
function askAnswer(panel, question, identityWord) {
  return panel.run({
    title: `심문 — 「${identityWord}」`,
    subtitle: question,
    hint: '직접 답한다',
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
      });

      free.append(input, send);
      content.append(free);
      input.focus();
    },
  });
}

/** 로봇의 대사와 이번 턴에 벌어진 일을 보여 준다. */
async function showReply(panel, r, identityWord) {
  const notes = [];
  if (r.events.includes('contradiction-forgiven')) notes.push('아이가 앞뒤가 안 맞는다고 짚는다. 이번은 넘어간다.');
  if (r.events.includes('contradiction')) notes.push('또 어긋났다.');
  if (r.events.includes('lie')) notes.push(`「${identityWord}」답지 않은 말이었다.`);
  if (r.events.includes('reveal')) notes.push('신분을 그대로 말해 버렸다.');
  if (r.declaration) {
    notes.push(
      r.declaration.hit
        ? `"당신은 ${r.declaration.word}이지." — 맞혔다.`
        : `"당신은 ${r.declaration.word}이지?" — 빗나갔다.`,
    );
  }

  const box = document.createElement('div');
  box.className = 'mg-col';

  const reply = document.createElement('div');
  reply.textContent = r.npcReply;
  box.append(reply);

  for (const n of notes) {
    const p = document.createElement('div');
    p.textContent = n;
    p.style.opacity = '0.7';
    box.append(p);
  }

  const bar = document.createElement('div');
  bar.textContent = `탐지 ${r.state.detection} · ${r.state.asked}/${r.state.questionMax}`;
  bar.style.opacity = '0.55';
  box.append(bar);

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
