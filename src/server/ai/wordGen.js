import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { anthropic, MODEL_JUDGE } from './client.js';
import { leaksCodeWord } from './guardrail.js';

/**
 * 동료 NPC 5인의 연상 단어 일괄 생성.
 *
 * 이 게임의 심장. 저스트원의 "제시어 → 각자 연상 단어" 단계를 LLM이 대행한다.
 * 스테이지 시작 시 1회만 호출하고 결과를 세션에 보관한다 (플레이 중 재호출 없음).
 *
 * SDK 0.71.x 기준 structured outputs 사용법:
 *   client.beta.messages.parse({ output_format: betaZodOutputFormat(schema), ... })
 *   → 최상위 output_format 필드를 쓰며, parse() 가 structured-outputs 베타 헤더를 자동으로 붙인다.
 *   → 응답의 .parsed_output 이 스키마로 검증된 객체.
 */

const AssociationSchema = z.object({
  associations: z.array(
    z.object({
      npcId: z.string().describe('주어진 동료의 id를 그대로 사용'),
      word: z.string().describe('연상되는 한국어 명사 한 단어 (띄어쓰기 없이)'),
      reason: z.string().describe('이 인물이 그 단어를 떠올린 이유 (한 문장, 디버깅·연출용)'),
    }),
  ),
});

function buildSystemPrompt(allies) {
  const roster = allies
    .map((a) => `- id: ${a.id} / 이름: ${a.name} / 직업: ${a.role}\n  성격·배경: ${a.persona}`)
    .join('\n');

  return `너는 스팀펑크 도시를 배경으로 한 잠입 게임의 퍼즐 생성기다.

저항 세력 조직원 5명이 있다. 각자 아래의 직업과 배경을 가진다:
${roster}

플레이어에게는 비밀 접선 코드 단어가 주어지지 않는다. 플레이어는 이 5명이 각자 흘린
연상 단어 하나씩만 보고 접선 코드를 추리해야 한다.

각 조직원에 대해, 접선 코드에서 연상되는 한국어 명사 한 단어를 골라라.

규칙:
1. 반드시 그 인물의 직업과 배경에 비추어 자연스럽게 떠올릴 단어여야 한다.
   시계공은 기계·시간의 관점에서, 악사는 소리·감정의 관점에서 연상한다.
2. 5명의 단어는 서로 최대한 겹치지 않아야 한다. 다른 각도에서 접근하라.
3. 접선 코드 단어 자체, 또는 그것을 포함한 합성어는 절대 금지다.
4. 너무 뻔해서 한 단어만 봐도 정답이 나오는 단어는 피하되,
   5개를 모아 놓으면 추리가 가능할 만큼의 단서는 되어야 한다.
5. 한 단어만. 문장이나 설명은 word 필드에 넣지 마라.`;
}

/**
 * @param {{ codeWord: string, allies: Array<object>, maxRetries?: number }} params
 * @returns {Promise<{ associations: Array<{npcId,word,reason}>, usage: object, retries: number }>}
 */
export async function generateAssociations({ codeWord, allies, maxRetries = 2 }) {
  const system = buildSystemPrompt(allies);
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const message = await anthropic.beta.messages.parse({
      model: MODEL_JUDGE,
      max_tokens: 2000,
      system,
      output_format: betaZodOutputFormat(AssociationSchema),
      messages: [
        {
          role: 'user',
          content: `접선 코드 단어: "${codeWord}"\n\n5명 각각의 연상 단어를 생성하라.`,
        },
      ],
    });

    const parsed = message.parsed_output;
    if (!parsed) {
      lastError = new Error('structured output 파싱 실패');
      continue;
    }

    // 가드레일: 코드 단어를 그대로 흘린 응답은 폐기하고 재생성.
    const leaked = parsed.associations.filter((a) => leaksCodeWord(a.word, codeWord));
    if (leaked.length > 0) {
      lastError = new Error(
        `코드 단어 유출 감지 (${leaked.map((l) => l.word).join(', ')}) — 재생성`,
      );
      console.warn(`[wordGen] ${lastError.message} (시도 ${attempt + 1}/${maxRetries + 1})`);
      continue;
    }

    // NPC id 가 요청한 명단과 일치하는지 확인.
    const wanted = new Set(allies.map((a) => a.id));
    const got = parsed.associations.filter((a) => wanted.has(a.npcId));
    if (got.length !== allies.length) {
      lastError = new Error(`동료 수 불일치: ${got.length}/${allies.length} — 재생성`);
      continue;
    }

    return { associations: got, usage: message.usage, retries: attempt };
  }

  throw new Error(`연상 단어 생성 실패: ${lastError?.message ?? '알 수 없는 오류'}`);
}
