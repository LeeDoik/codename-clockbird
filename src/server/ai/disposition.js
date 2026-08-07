import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { anthropic, MODEL_CHAT } from './client.js';
import { renderPrompt } from './promptStore.js';
import { trimHistory } from './dialogue.js';

/**
 * 행동 판정 — 스테이지 2 저택.
 *
 * 예전(judgeStance)엔 발언 하나를 anti/pro/neutral 로 분류해 호감도·의심도 숫자를
 * 누적하고, 정해진 문턱(3)에서 기계적으로 신고·정보 공개가 터졌다. 지금은 매 턴,
 * 이 NPC 라면 지금까지의 대화 전체를 보고 "지금 확신이 서서 행동할지, 아직
 * 지켜볼지"를 통째로 다시 판단한다 — 인물마다·대화마다 판단이 갈리게 하려는
 * 의도적 설계다. "정확히 몇 번째 발언에서 신고당하는가" 같은 예측 가능한 문턱을
 * 버리는 대신, 살아있는 사람처럼 불규칙하게 반응하는 쪽을 택했다.
 *
 * 대화 응답 생성(dialogue.js 의 streamMansionReply)과 나란히 병렬로 돈다 — 대화는
 * 스트리밍이라 structured output 을 겹칠 수 없어서 여전히 별도 호출로 분리한다.
 *
 * 프롬프트는 src/data/prompts/mansion-disposition.txt 로 나갔다 — 판정 기준 튜닝은
 * 프롬프트 스튜디오에서 한다. 스키마(게임 규칙)는 여기 남는다.
 */
const DispositionSchema = z.object({
  decision: z.enum(['act', 'wait']).describe('지금 확신이 서서 결정적으로 행동할지, 아직 지켜볼지'),
  direction: z
    .enum(['trust', 'distrust'])
    .nullable()
    .describe(
      'decision 이 act 일 때만 의미 있다 — 상대를 믿기로 했는지(trust), 위협/의심스럽다고 확신했는지(distrust). wait 면 null.',
    ),
  reason: z.string().describe('판단 이유 (한 문장)'),
});

const KIND_LABEL = {
  ally: '동료 (겉으론 이 저택의 직원이지만, 속으론 레지스탕스에 마음이 기운 사람)',
  civ: '민간인 (정치에 관심 없는 평범한 직원)',
};

export async function judgeDisposition({ npc, history, userMessage, clues = [], promptOverride }) {
  const clueBlock = clues.length
    ? `\n[단서 대조]\n플레이어가 저택을 조사해 알아낸 것들:\n${clues
        .map((c) => `- ${c.topic}`)
        .join('\n')}\n플레이어가 대화에서 이 화제를 실제로 꺼냈다면 판단에 참고하라 — 동료라면 신뢰의 근거가, 민간인이라면 수상함의 근거가 될 수 있다.`
    : '';

  const system = await renderPrompt(
    'mansion-disposition',
    {
      name: npc.name,
      backstory: npc.backstory,
      personality: npc.personality,
      kindLabel: KIND_LABEL[npc.kind] ?? npc.kind,
      clueBlock,
    },
    promptOverride,
  );

  const res = await anthropic.beta.messages.parse({
    model: MODEL_CHAT,
    max_tokens: 300,
    // 이 판정은 대화 응답과 나란히 도는 곁가지다 — 생각을 켜면 그만큼 늦어진다.
    thinking: { type: 'disabled' },
    system,
    output_format: betaZodOutputFormat(DispositionSchema),
    messages: [...trimHistory(history), { role: 'user', content: userMessage }],
  });

  const parsed = res.parsed_output;
  const decision = parsed?.decision === 'act' ? 'act' : 'wait';
  const direction =
    decision === 'act' && (parsed?.direction === 'trust' || parsed?.direction === 'distrust')
      ? parsed.direction
      : null;

  return {
    decision,
    direction,
    reason: parsed?.reason ?? '판정 실패',
  };
}
