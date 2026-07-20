import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { anthropic, MODEL_JUDGE, MODEL_CHAT } from './client.js';
import { renderPrompt } from './promptStore.js';

/**
 * 불심검문 — 질문 생성과 답변 심사.
 *
 * 세션에 의존하지 않는 순수 모듈이다. 게임 상태(경계 수위·체포 인원)를 인자로만
 * 받으므로 poc-checkpoint.js 가 게임 없이 이 모듈만 돌려 프롬프트를 튜닝할 수 있고,
 * 본선에서 다른 게임에 그대로 옮겨 붙일 수도 있다.
 *
 * ── 왜 검문이 2단인가 ──
 * 발각은 한 판에 여러 번 일어난다. 매번 2~4초짜리 LLM 왕복이 걸리면 게임이 늘어진다.
 * 그래서 앞단에 지연 0 인 타이밍 미니게임을 두고, 그것을 놓쳤을 때만 이 모듈이
 * 마지막 기회로 열린다. 자주 나오지 않으므로 지연이 오히려 긴장 연출로 흡수된다.
 */

const InterrogationSchema = z.object({
  question: z.string().describe('순찰 로봇이 통행인에게 던지는 심문 질문 한 문장'),
  choices: z.array(z.string()).length(3).describe('통행인이 고를 수 있는 답변 3개 (순종/능청/뻣뻣)'),
});

const VerdictSchema = z.object({
  // 2단 구조에서는 '의심 → 재질문' 라운드가 필요 없다. 앞단의 타이밍 게임이 이미
  // 한 번의 기회였으므로, 여기서는 통과 아니면 적발뿐이다. 스키마로 못박아 모델이
  // 중간 판정을 만들어 내지 못하게 한다.
  verdict: z.enum(['pass', 'caught']),
  npcReply: z.string().describe('로봇이 통행인에게 들려주는 한 문장'),
  reason: z.string().describe('판정 근거 (한 문장, 서버 로그·디버깅용)'),
});

/** 경계 수위 → 심사 엄격도. alertLevel 이 순찰 속도 말고도 일하게 만드는 두 번째 이빨. */
function strictness(alertLevel) {
  if (alertLevel <= 1) return '평상시다. 어지간한 답변은 통과시킨다.';
  if (alertLevel === 2) return '경계 중이다. 애매한 답변은 걸러낸다.';
  return '비상이다. 조금이라도 미심쩍으면 붙잡는다.';
}

/**
 * API 장애 시 쓰는 캔 질문.
 * 검문이 네트워크 사고 때문에 게임을 멈추게 두지 않는다 — 시연 중 사고 방지.
 */
const FALLBACK_INTERROGATION = {
  question: '정지. 신원을 밝혀라. 이 시각에 이 구역을 지나는 이유는 무엇인가.',
  choices: [
    '야간 배송을 나왔습니다. 확인해 주십시오.',
    '길을 잃었지 뭡니까. 이쪽이 지름길이라 해서요.',
    '지나가는 것도 허락이 필요한가.',
  ],
};

/**
 * 심문 질문 + 선택지 3개를 생성한다.
 * 실패해도 예외를 던지지 않는다 — 캔 질문으로 검문을 계속 진행시킨다.
 */
export async function generateInterrogation({ alertLevel, arrestedCount, promptOverride }) {
  const system = await renderPrompt(
    'checkpoint-question',
    { alertLevel, arrestedCount },
    promptOverride,
  );

  try {
    const message = await anthropic.beta.messages.parse({
      // 질문 생성은 게임 규칙을 정하지 않는 연출용 텍스트다 — 판정(Sonnet)과 달리
      // 저지연 모델로 충분하다. Sonnet 으로 재면 5.3초, Haiku 로는 그 절반 아래.
      // 검문 지연은 곧 체감 지연이라 여기서 아낀 시간이 그대로 게임 속도가 된다.
      model: MODEL_CHAT,
      max_tokens: 500,
      // 깊은 추론이 필요한 작업이 아니다.
      thinking: { type: 'disabled' },
      system,
      output_format: betaZodOutputFormat(InterrogationSchema),
      messages: [{ role: 'user', content: '통행인을 세웠다. 심문을 시작하라.' }],
    });
    return { ...message.parsed_output, fallback: false, usage: message.usage };
  } catch (err) {
    console.error('[checkpoint] 질문 생성 실패 — 캔 질문으로 대체', err.message);
    return { ...FALLBACK_INTERROGATION, fallback: true, usage: null };
  }
}

/**
 * 답변을 심사한다.
 *
 * 실패 시 fail-open(pass) 이다. API 장애로 게임오버가 나면 플레이어는 자기가 뭘
 * 잘못했는지 알 수 없고, 시연이라면 그대로 사고가 된다. 검문은 게임을 조이는
 * 장치이지 게임을 끝내는 장치가 아니다.
 *
 * @param {object} opts
 * @param {'choice'|'free'} opts.answerSource 선택지에서 고른 답인지 직접 쓴 답인지
 */
export async function judgeCheckpointAnswer({
  question, answer, answerSource, alertLevel, arrestedCount, promptOverride,
}) {
  const system = await renderPrompt(
    'checkpoint-judge',
    { alertLevel, arrestedCount, strictness: strictness(alertLevel) },
    promptOverride,
  );

  // 심사 대상 텍스트를 시스템이 아니라 user 메시지에 둔다 — 규칙과 입력이 섞이지
  // 않아야 프롬프트 주입이 규칙을 덮어쓰지 못한다.
  const content =
    `[로봇의 질문]\n${question}\n\n` +
    `[통행인의 답변 — ${answerSource === 'choice' ? '제시된 선택지에서 고름' : '직접 진술'}]\n${answer}`;

  try {
    const message = await anthropic.beta.messages.parse({
      model: MODEL_JUDGE,
      max_tokens: 500,
      thinking: { type: 'disabled' },
      system,
      output_format: betaZodOutputFormat(VerdictSchema),
      messages: [{ role: 'user', content }],
    });
    return { ...message.parsed_output, fallback: false, usage: message.usage };
  } catch (err) {
    console.error('[checkpoint] 심사 실패 — 통과 처리', err.message);
    return {
      verdict: 'pass',
      npcReply: '...확인됐다. 통과하라.',
      reason: '심사 모듈 오류 — fail-open',
      fallback: true,
      usage: null,
    };
  }
}

export { FALLBACK_INTERROGATION, strictness };
