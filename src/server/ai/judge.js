import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { anthropic, MODEL_JUDGE } from './client.js';
import { normalize, isSameWord } from './guardrail.js';

/**
 * 중복 판정 / 정답 판정.
 *
 * 저스트원의 "같은 단어를 낸 사람은 제외" 규칙을 구현한다.
 * 이 게임에선 그것이 "같은 단어를 떠올린 동료는 이미 패턴이 노출되어 체포됨" 이라는 서사가 된다.
 */

const DuplicateSchema = z.object({
  duplicateGroups: z.array(
    z.object({
      npcIds: z.array(z.string()).describe('사실상 같은 단어를 낸 동료 id 2명 이상'),
      reason: z.string().describe('왜 같은 단어로 보는지 (한 문장)'),
    }),
  ),
});

/**
 * 1차: 표기 정규화 후 완전 일치로 그룹핑 (LLM 없이 확정)
 * 2차: 남은 단어들 중 동의어·표기 변형을 LLM 이 판정
 *
 * @returns {Promise<{ arrestedIds: string[], groups: Array<{npcIds,reason}>, usage: object|null }>}
 */
export async function judgeDuplicates({ associations }) {
  const groups = [];

  // --- 1차: 정규화 완전 일치 ---
  const byNormalized = new Map();
  for (const a of associations) {
    const key = normalize(a.word);
    if (!byNormalized.has(key)) byNormalized.set(key, []);
    byNormalized.get(key).push(a);
  }
  for (const [, members] of byNormalized) {
    if (members.length > 1) {
      groups.push({
        npcIds: members.map((m) => m.npcId),
        reason: `표기가 동일함 ("${members[0].word}")`,
      });
    }
  }

  // 1차에서 이미 걸린 동료는 2차 판정 대상에서 제외
  const alreadyGrouped = new Set(groups.flatMap((g) => g.npcIds));
  const remaining = associations.filter((a) => !alreadyGrouped.has(a.npcId));

  // --- 2차: LLM 동의어 판정 ---
  let usage = null;
  if (remaining.length >= 2) {
    const list = remaining.map((a) => `- ${a.npcId}: "${a.word}"`).join('\n');

    const message = await anthropic.beta.messages.parse({
      model: MODEL_JUDGE,
      max_tokens: 1000,
      thinking: { type: 'disabled' },
      system: `너는 단어 게임의 심판이다. 주어진 단어들 중 "사실상 같은 단어"인 것들을 찾아 묶어라.

같은 단어로 보는 기준:
- 동의어 (예: "기어" / "톱니바퀴")
- 표기 변형 (예: "시계 탑" / "시계탑", "라이트" / "light")
- 단수/복수, 어미 차이 (예: "등불" / "등불들")

같은 단어로 보지 않는 기준:
- 단순히 관련이 있거나 같은 범주에 속하는 것 (예: "석탄" / "증기" 는 다른 단어다)
- 상위·하위 개념 (예: "기계" / "톱니바퀴" 는 다른 단어다)

애매하면 다른 단어로 판정하라. 겹치는 단어가 없으면 빈 배열을 반환하라.`,
      output_format: betaZodOutputFormat(DuplicateSchema),
      messages: [{ role: 'user', content: `단어 목록:\n${list}` }],
    });

    usage = message.usage;
    const parsed = message.parsed_output;
    if (parsed) {
      const validIds = new Set(remaining.map((a) => a.npcId));
      for (const g of parsed.duplicateGroups) {
        const ids = g.npcIds.filter((id) => validIds.has(id));
        if (ids.length > 1) groups.push({ npcIds: ids, reason: g.reason });
      }
    }
  }

  return { arrestedIds: [...new Set(groups.flatMap((g) => g.npcIds))], groups, usage };
}

const GuessSchema = z.object({
  correct: z.boolean().describe('플레이어의 답이 접선 코드와 사실상 같은 단어인가'),
  reason: z.string().describe('판정 이유 (한 문장)'),
});

/**
 * 접선 코드 정답 판정.
 * 표기 일치는 LLM 없이 즉시 통과시키고, 경계 사례만 LLM 에 묻는다 (지연·비용 절약).
 */
export async function judgeGuess({ codeWord, guess }) {
  if (isSameWord(codeWord, guess)) {
    return { correct: true, reason: '표기 일치', usage: null };
  }
  if (!normalize(guess)) {
    return { correct: false, reason: '빈 입력', usage: null };
  }

  const message = await anthropic.beta.messages.parse({
    model: MODEL_JUDGE,
    max_tokens: 500,
    system: `너는 단어 맞히기 게임의 심판이다. 플레이어의 답이 정답 단어와 "사실상 같은 단어"인지만 판정하라.

정답으로 인정:
- 동의어, 표기 변형, 띄어쓰기 차이, 어미 차이

정답으로 인정하지 않음:
- 관련 개념, 상위/하위 개념, 같은 범주의 다른 단어
- 정답에 가깝지만 다른 사물을 가리키는 단어

엄격하게 판정하라. 애매하면 오답이다.`,
    output_format: betaZodOutputFormat(GuessSchema),
    messages: [
      { role: 'user', content: `정답 단어: "${codeWord}"\n플레이어의 답: "${guess}"` },
    ],
  });

  const parsed = message.parsed_output;
  return {
    correct: parsed?.correct ?? false,
    reason: parsed?.reason ?? '판정 실패',
    usage: message.usage,
  };
}
