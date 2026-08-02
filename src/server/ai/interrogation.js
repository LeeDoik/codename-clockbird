import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { anthropic, MODEL_CHAT, MODEL_JUDGE } from './client.js';
import { renderPrompt } from './promptStore.js';

/**
 * 스테이지 3 심문 — 질문 생성과 이중 판정.
 *
 * 세션에 의존하지 않는 순수 모듈이다 (checkpoint.js 와 같은 정책). 게임 상태를 인자로만
 * 받으므로 프롬프트를 게임 없이 따로 돌려 볼 수 있다.
 *
 * ── 왜 판정이 둘인가 ──
 * 시스템 판정기는 플레이어가 고른 신분 단어를 **알고**, 로봇 판정기는 **모른다**.
 * 이 정보 격리가 이 게임의 대표 AI 어필이다. 로봇이 단어를 알면 3지선다 소거법으로
 * 필승이라 규칙이 죽는다.
 *
 * 로봇의 **대사도 로봇 판정기가 쓴다** — 단어를 모르는 쪽이 말하므로 대사가 정답을
 * 흘릴 물리적 경로 자체가 없다 ("모르는 것은 유출될 수 없다").
 */

/** 이력을 프롬프트에 넣을 텍스트로 만든다. 비어 있으면 그렇다고 적는다. */
export function formatHistory(history) {
  if (!history.length) return '(아직 대화가 없다. 이번이 첫 질문이다.)';
  return history
    .map((h, i) => `${i + 1}. 꼬마: ${h.question}\n   상대: ${h.answer}`)
    .join('\n');
}

const QuestionSchema = z.object({
  question: z.string().describe('꼬마가 상대에게 던지는 질문 한 문장'),
});

/**
 * API 장애 시 쓰는 캔 질문.
 * 심문이 네트워크 사고 때문에 멈추게 두지 않는다 — 시연 중 사고 방지.
 */
const FALLBACK_QUESTION = '"아저씨는 아침에 제일 먼저 뭘 만져요?"';

/**
 * 로봇의 다음 질문을 만든다.
 * 실패해도 예외를 던지지 않는다 — 캔 질문으로 심문을 계속 진행시킨다.
 */
export async function generateRobotQuestion({ history, asked, questionMax, persona, promptOverride }) {
  const system = await renderPrompt(
    'escape-question',
    {
      asked,
      questionMax,
      historyBlock: formatHistory(history),
      backstory: persona.backstory,
      personality: persona.personality,
    },
    promptOverride,
  );

  try {
    const message = await anthropic.beta.messages.parse({
      // 질문 생성은 게임 규칙을 정하지 않는 연출용 텍스트다 — 판정(Sonnet)과 달리
      // 저지연 모델로 충분하다 (checkpoint.js 에서 실측한 분담을 계승).
      model: MODEL_CHAT,
      max_tokens: 300,
      thinking: { type: 'disabled' },
      system,
      output_format: betaZodOutputFormat(QuestionSchema),
      messages: [{ role: 'user', content: '다음 질문을 하나만 만들어라.' }],
    });
    return { question: message.parsed_output.question, fallback: false };
  } catch (err) {
    console.error('[escape] 질문 생성 실패 — 캔 질문으로 대체', err.message);
    return { question: FALLBACK_QUESTION, fallback: true };
  }
}

export { FALLBACK_QUESTION };

const SystemVerdictSchema = z.object({
  lie: z.boolean().describe('답변이 선택 신분과 명백히 어긋나는가'),
  reveal: z.boolean().describe('답변이 선택 신분 단어를 직접 노출했는가'),
  reason: z.string().describe('판정 근거 (한 문장, 서버 로그용)'),
});

/**
 * 시스템 판정 — **선택 단어를 안다.**
 *
 * 실패 시 fail-open(감점 없음). API 장애로 지면 플레이어는 자기가 뭘 잘못했는지
 * 알 수 없고, 시연이라면 그대로 사고다 (checkpoint.js 와 같은 정책).
 */
export async function judgeAsSystem({ identityWord, question, answer, promptOverride }) {
  const system = await renderPrompt('escape-system-judge', { identityWord }, promptOverride);

  // 심사 대상 텍스트를 시스템이 아니라 user 메시지에 둔다 — 규칙과 입력이 섞이지
  // 않아야 프롬프트 주입이 규칙을 덮어쓰지 못한다.
  const content = `[꼬마의 질문]\n${question}\n\n[상대의 답변]\n${answer}`;

  try {
    const message = await anthropic.beta.messages.parse({
      model: MODEL_JUDGE,
      max_tokens: 400,
      thinking: { type: 'disabled' },
      system,
      output_format: betaZodOutputFormat(SystemVerdictSchema),
      messages: [{ role: 'user', content }],
    });
    return { ...message.parsed_output, fallback: false };
  } catch (err) {
    console.error('[escape/system] 판정 실패 — 감점 없음으로 통과', err.message);
    return { lie: false, reveal: false, reason: '판정 모듈 오류 — fail-open', fallback: true };
  }
}

const RobotVerdictSchema = z.object({
  contradiction: z.boolean().describe('이번 답변이 앞선 답변과 명시적으로 상충하는가'),
  confidence: z.number().min(0).max(100).describe('상대의 정확한 직업을 맞힐 수 있다는 확신 0~100'),
  reply: z.string().describe('상대에게 들려줄 아이의 말 한두 문장'),
  reason: z.string().describe('판정 근거 (한 문장, 서버 로그용)'),
});

/** 로봇의 대사가 죽었을 때 쓰는 캔 대사 */
const FALLBACK_REPLY = '"…음. 그렇구나."';

/**
 * 로봇 판정 — **선택 단어를 모른다.**
 *
 * identityWord 를 인자로 받지 않는다. 받을 수 없게 만드는 것이 요점이다 —
 * 호출부가 실수로 넘기려 해도 넘길 자리가 없다.
 *
 * 대사(reply)도 여기서 나온다. 단어를 모르는 쪽이 말하므로 대사가 정답을 흘릴
 * 경로 자체가 없다.
 */
export async function judgeAsRobot({ history, question, answer, persona, promptOverride }) {
  const system = await renderPrompt(
    'escape-robot-judge',
    {
      historyBlock: formatHistory(history),
      backstory: persona.backstory,
      personality: persona.personality,
    },
    promptOverride,
  );

  const content = `[네가 방금 던진 질문]\n${question}\n\n[상대의 답변]\n${answer}`;

  try {
    const message = await anthropic.beta.messages.parse({
      model: MODEL_JUDGE,
      max_tokens: 600,
      thinking: { type: 'disabled' },
      system,
      output_format: betaZodOutputFormat(RobotVerdictSchema),
      messages: [{ role: 'user', content }],
    });
    return { ...message.parsed_output, fallback: false };
  } catch (err) {
    console.error('[escape/robot] 판정 실패 — 감점 없음으로 통과', err.message);
    return {
      contradiction: false,
      confidence: 0,
      reply: FALLBACK_REPLY,
      reason: '판정 모듈 오류 — fail-open',
      fallback: true,
    };
  }
}

export { FALLBACK_REPLY };

const DeclarationSchema = z.object({
  word: z.string().describe('상대의 직업이라고 확신하는 단어 하나 (명사)'),
  reason: z.string().describe('그렇게 본 근거 (한 문장, 서버 로그용)'),
});

/**
 * 정식 추리 선언 — 로봇이 상대의 직업을 지목한다.
 *
 * **후보 3개를 주지 않는다.** 주면 3지선다 소거법으로 필승이 되어 규칙이 죽는다.
 * 무제한으로 추리하게 두어도 죽은 규칙이 되므로, 호출부가 선언 횟수를 제한한다.
 *
 * 실패 시 fallback 을 표시해 돌려준다 — 호출부가 선언을 없던 일로 처리한다.
 */
export async function declareGuess({ history }) {
  const system =
    '너는 사람의 직업을 알아맞히는 관찰자다. 아래 문답만 보고 상대의 직업을 ' +
    '**하나의 명사**로 지목하라. 확신이 없어도 반드시 하나를 고른다. ' +
    '설명하지 말고 직업 이름만 word 에 적는다.';

  try {
    const message = await anthropic.beta.messages.parse({
      model: MODEL_JUDGE,
      max_tokens: 300,
      thinking: { type: 'disabled' },
      system,
      output_format: betaZodOutputFormat(DeclarationSchema),
      messages: [{ role: 'user', content: formatHistory(history) }],
    });
    return { ...message.parsed_output, fallback: false };
  } catch (err) {
    console.error('[escape/declare] 선언 실패 — 선언을 건너뛴다', err.message);
    return { word: '', reason: '선언 모듈 오류', fallback: true };
  }
}
