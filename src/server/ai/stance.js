import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { anthropic, MODEL_CHAT } from './client.js';

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
 */
const StanceSchema = z.object({
  stance: z.enum(['anti', 'pro', 'neutral']).describe('발언이 기운 방향'),
  reason: z.string().describe('판정 이유 (한 문장)'),
});

const SYSTEM = `너는 잠입 게임의 판정기다. 플레이어가 저택 직원에게 한 말이 어느 쪽으로 기울었는지 판정하라.

anti — 지배 세력·로봇·저택 주인·현 체제를 비판하거나, 저항·자유·사람의 존엄을 옹호하는 말
pro  — 지배 세력·로봇·저택 주인을 두둔하거나 칭송하는 말, 저항 세력을 비난하는 말
neutral — 어느 쪽도 아닌 말. 인사, 일 이야기, 길 묻기, 잡담, 사실을 묻는 질문

판정 기준:
- 기울기가 분명할 때만 anti 나 pro 로 판정하라.
- 조금이라도 애매하면 neutral 이다. 잘못 판정해서 판이 끝나는 쪽이 놓치는 쪽보다 훨씬 나쁘다.
- 질문 형태여도 내용이 분명히 한쪽으로 기울면 그쪽으로 본다.
  ("로봇들 지긋지긋하지 않아요?" → anti)
- 남의 말을 인용하거나 되묻기만 하는 것은 기울지 않은 것으로 본다.
- 로봇이나 기계를 **물건으로서** 평하는 말은 정치가 아니다.
  ("이 저택 시계는 오래됐네요" → neutral)`;

/**
 * @param {string} message 플레이어의 발언
 * @returns {Promise<{stance: 'anti'|'pro'|'neutral', reason: string}>}
 */
export async function judgeStance({ message }) {
  const res = await anthropic.beta.messages.parse({
    model: MODEL_CHAT,
    max_tokens: 200,
    // 이 판정은 대화 응답과 나란히 도는 곁가지다 — 생각을 켜면 그만큼 늦어진다.
    thinking: { type: 'disabled' },
    system: SYSTEM,
    output_format: betaZodOutputFormat(StanceSchema),
    messages: [{ role: 'user', content: `플레이어의 말: "${message}"` }],
  });

  const parsed = res.parsed_output;
  return {
    stance: parsed?.stance ?? 'neutral',
    reason: parsed?.reason ?? '판정 실패',
  };
}
