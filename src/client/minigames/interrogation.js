/**
 * 검문 2단 — 순찰 로봇의 심문 (LLM 심사).
 *
 * 1단(타이밍)을 놓쳤을 때만 열리는 마지막 기회다. 여기서만 LLM 이 돌기 때문에
 * 2~4초 지연이 판마다 쌓이지 않고, 어쩌다 한 번이라 오히려 긴장 연출로 쓰인다.
 *
 * 네트워크는 이 모듈이 모른다 — 호출부가 넘겨준 두 함수만 부른다. 덕분에 UI 흐름과
 * 서버 계약이 따로 논다.
 */

/** 답변 길이 상한. 서버도 같은 값으로 자른다 (여기 것은 편의, 저기 것은 방어). */
const MAX_ANSWER_LEN = 120;

/**
 * @param {import('../ui/MinigamePanel.js').MinigamePanel} panel
 * @param {object} io
 * @param {() => Promise<{question: string, choices: string[]}>} io.fetchQuestion
 * @param {(answer: string, source: 'choice'|'free') => Promise<{outcome: string, npcReply: string}>} io.submitAnswer
 * @returns {Promise<'pass'|'caught'|'error'>}
 */
export async function runInterrogation(panel, { fetchQuestion, submitAnswer }) {
  panel.open({
    title: '불심검문',
    subtitle: '순찰 로봇이 앞을 막아선다.',
    hint: '여기서는 걸어나갈 수 없다',
  });
  // 질문 생성 지연을 연출로 덮는다. 빈 화면으로 두면 게임이 멈춘 줄 안다.
  panel.setStatus('신원 조회 중…');

  let q;
  try {
    q = await fetchQuestion();
  } catch (err) {
    panel.setStatus(`조회 실패 — ${err.message}`);
    await sleep(1200);
    panel.close();
    return 'error';
  }

  const { answer, source } = await askAnswer(panel, q);

  panel.setStatus('심사 중…');
  let verdict;
  try {
    verdict = await submitAnswer(answer, source);
  } catch (err) {
    panel.setStatus(`심사 실패 — ${err.message}`);
    await sleep(1200);
    panel.close();
    return 'error';
  }

  // 로봇의 대답을 읽을 틈을 주고 닫는다 — 통과인지 적발인지가 이 한 줄에 실린다.
  panel.setStatus(verdict.npcReply);
  panel.verdictEl.textContent = verdict.outcome === 'pass' ? '통과' : '적발';
  panel.verdictEl.className = verdict.outcome === 'pass' ? 'ok' : 'fail';
  await sleep(2200);
  panel.close();
  return verdict.outcome;
}

/** 선택지 3개 + 자유 입력. 어느 쪽으로 답하든 하나만 고르면 끝난다. */
function askAnswer(panel, { question, choices }) {
  return panel.run({
    title: '불심검문',
    subtitle: question,
    hint: '선택지를 고르거나, 직접 답한다',
    showVerdict: false,
    render: ({ content, finish }) => {
      const col = document.createElement('div');
      col.className = 'mg-col';
      for (const c of choices) {
        const b = document.createElement('button');
        b.className = 'mg-btn';
        b.textContent = c;
        b.onclick = () => finish({ answer: c, source: 'choice' });
        col.append(b);
      }

      const free = document.createElement('div');
      free.className = 'mg-free';
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '직접 답한다...';
      input.maxLength = MAX_ANSWER_LEN;
      input.autocomplete = 'off';
      const send = document.createElement('button');
      send.className = 'mg-btn';
      send.textContent = '답한다';

      const submit = () => {
        const v = input.value.trim();
        if (v) finish({ answer: v, source: 'free' });
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
      content.append(col, free);
      input.focus();
    },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
