import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { anthropic, MODEL_CHAT } from './client.js';
import { renderPrompt } from './promptStore.js';

/**
 * 성향 판정 — 스테이지 2 저택.
 *
 * 플레이어의 발언이 체제에 비판적인가, 두둔하는가, 어느 쪽도 아닌가를 가린다.
 * 이 판정 하나가 동료의 호감도와 민간인의 의심도를 동시에 움직인다 (계획서 §4.4).
 *
 * ── 대화와 분리된 별도 호출인 이유 ──
 * 대화는 스트리밍이라 structured output 을 겹칠 수 없고, 겹치면 첫 글자가 늦게 뜬다.
 * 수치는 화면에 안 나오므로 판정이 조금 늦어도 플레이어는 모른다 — 그래서 갈라 놓고
 * 대화 스트림과 나란히 돌린다. 스트리밍 경로는 이 판정을 전혀 기다리지 않는다.
 *
 * ── 애매하면 neutral ──
 * 오판으로 민간인의 의심도가 올라 밀고까지 가면 판이 끝난다. 놓치는 쪽이 훨씬 싸다.
 *
 * 프롬프트는 src/data/prompts/mansion-stance.txt 로 나갔다 — 판정 기준 튜닝은
 * 프롬프트 스튜디오에서 한다. 스키마(게임 규칙)는 여기 남는다.
 *
 * clues: 플레이어가 조사로 발견한 단서 목록 (Task 11). 발언이 그중 하나의 화제를
 * 실질적으로 꺼내면 usedClueId 로 보고된다 → 호감도 보너스 (스펙 §5.3).
 */
const StanceSchema = z.object({
  stance: z.enum(['anti', 'pro', 'neutral']).describe('발언이 기운 방향'),
  reason: z.string().describe('판정 이유 (한 문장)'),
  usedClueId: z.string().nullable().describe('발언이 실질적으로 꺼낸 단서의 id. 없으면 null'),
});

/**
 * @param {string} [promptOverride] 파일 대신 쓸 템플릿 원문 — 스튜디오의 "저장 전 미리보기"용.
 *   게임 경로에서는 넘기지 않는다.
 */
export async function judgeStance({ message, clues = [], promptOverride }) {
  const clueBlock = clues.length
    ? `\n[단서 대조]\n플레이어가 저택을 조사해 알아낸 것들:\n${clues
        .map((c) => `- id "${c.id}": ${c.topic}`)
        .join('\n')}\n플레이어의 말이 위 중 하나의 화제를 실질적으로 꺼내고 있으면(지나가는 단어 일치가 아니라 그 내용을 화제로 삼으면) usedClueId 에 해당 id 를 적어라. 아니면 null.`
    : '';

  const system = await renderPrompt('mansion-stance', { clueBlock }, promptOverride);

  const res = await anthropic.beta.messages.parse({
    model: MODEL_CHAT,
    max_tokens: 250,
    // 이 판정은 대화 응답과 나란히 도는 곁가지다 — 생각을 켜면 그만큼 늦어진다.
    thinking: { type: 'disabled' },
    system,
    output_format: betaZodOutputFormat(StanceSchema),
    messages: [{ role: 'user', content: `플레이어의 말: "${message}"` }],
  });

  const parsed = res.parsed_output;
  return {
    stance: parsed?.stance ?? 'neutral',
    reason: parsed?.reason ?? '판정 실패',
    // 모델이 목록에 없는 id 를 지어내면 버린다 — 프롬프트 주입 방어와 같은 원칙.
    usedClueId: clues.some((c) => c.id === parsed?.usedClueId) ? parsed.usedClueId : null,
  };
}
