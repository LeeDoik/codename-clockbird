import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { anthropic, MODEL_CHAT } from './client.js';
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
export async function generateRobotQuestion({ history, asked, questionMax }) {
  const system = await renderPrompt('escape-question', {
    asked,
    questionMax,
    historyBlock: formatHistory(history),
  });

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
