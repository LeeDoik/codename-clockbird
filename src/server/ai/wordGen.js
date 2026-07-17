import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { anthropic, MODEL_JUDGE } from './client.js';
import { leaksCodeWord } from './guardrail.js';

/**
 * 동료 NPC 5인의 연상 단어 생성.
 *
 * 이 게임의 심장. 저스트원의 "제시어 → 각자 연상 단어" 단계를 LLM이 대행한다.
 * 스테이지 시작 시 1회만 호출하고 결과를 세션에 보관한다 (플레이 중 재호출 없음).
 *
 * ── 왜 1인 1호출인가 ──
 * 원작 저스트원에서 플레이어들은 서로의 답을 모르는 채 각자 단어를 쓴다.
 * 그래서 중복이 자연 발생하고, 그 중복이 곧 게임의 핵심 규칙이 된다.
 *
 * 5인을 한 번에 생성하면 모델이 서로를 의식해 단어를 분산시키므로
 * 중복이 거의 발생하지 않고 '체포 → 감옥 → 구출' 메커닉 전체가 죽는다.
 * 따라서 각 동료는 다른 동료의 존재를 모르는 독립 호출로 생성한다.
 * 부수 효과로 5개 호출이 병렬로 나가 지연도 크게 줄어든다.
 *
 * ── SDK 사용법 (0.71.x) ──
 *   client.beta.messages.parse({ output_format: betaZodOutputFormat(schema), ... })
 *   → 최상위 output_format 필드를 쓰며, parse() 가 structured-outputs 베타 헤더를 자동으로 붙인다.
 *   → 응답의 .parsed_output 이 스키마로 검증된 객체.
 *   ※ zod 는 v4 필수 (SDK 가 z.toJSONSchema 를 호출)
 */

const WordSchema = z.object({
  word: z.string().describe('연상되는 한국어 명사 한 단어 (띄어쓰기 없이)'),
  reason: z.string().describe('이 인물이 그 단어를 떠올린 이유 (한 문장, 디버깅·연출용)'),
});

function buildSystemPrompt(ally) {
  return `너는 스팀펑크 도시를 배경으로 한 잠입 게임의 등장인물 한 명을 연기한다.

너의 정체:
- 이름: ${ally.name}
- 직업: ${ally.role}
- 성격·배경: ${ally.persona}

너는 저항 세력의 조직원이다. 동료에게 비밀 접선 코드를 암시해야 하지만,
감시 때문에 코드를 직접 말할 수 없다. 대신 그 코드에서 연상되는 단어 하나만 흘린다.

주어진 접선 코드에서 연상되는 한국어 명사 한 단어를 골라라.

규칙:
1. 반드시 너의 직업과 삶의 경험에 비추어 자연스럽게 떠오르는 단어여야 한다.
   너는 시계공이 아니라 ${ally.role}다. ${ally.role}의 눈으로 세상을 본다.
2. 접선 코드 단어 자체를 쓰지 마라. 그것을 포함한 합성어도 금지다.
3. 접선 코드의 동의어, 외래어 표기, 번역어도 금지다.
   (예: 코드가 "톱니바퀴"라면 "기어"도 금지. 사실상 같은 사물을 가리키는 단어는 모두 금지)
4. 코드와 다른 사물이되, 그것을 떠올리게 하는 단어여야 한다.
   한 단어만 봐도 정답이 나올 만큼 노골적이면 안 된다.
5. 다른 동료가 무엇을 쓸지는 신경 쓰지 마라. 너는 그들의 답을 모른다.
   오직 너 자신에게 가장 자연스러운 단어를 골라라.
6. 반드시 명사여야 한다. 형용사("뿌옇다", "축축한")나 동사("돌아가다")는 금지다.
   사물·장소·현상의 이름이어야 한다.
7. 한 단어만. 문장이나 설명은 word 필드에 넣지 마라.`;
}

/** 동료 1인의 연상 단어 생성 (실패 시 재시도) */
async function generateOne({ codeWord, ally, maxRetries }) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const message = await anthropic.beta.messages.parse({
      model: MODEL_JUDGE,
      max_tokens: 300,
      // Sonnet 5 는 thinking 생략 시 adaptive thinking 이 켜진다.
      // 연상 단어 생성은 깊은 추론이 필요 없고 스테이지 시작 지연에 직결되므로 끈다.
      thinking: { type: 'disabled' },
      system: buildSystemPrompt(ally),
      output_format: betaZodOutputFormat(WordSchema),
      messages: [
        { role: 'user', content: `접선 코드 단어: "${codeWord}"\n\n네가 흘릴 단어 하나를 골라라.` },
      ],
    });

    const parsed = message.parsed_output;
    if (!parsed?.word) {
      lastError = new Error('structured output 파싱 실패');
      continue;
    }

    // 가드레일: 코드 단어를 그대로 흘린 응답은 폐기하고 재생성.
    // 동의어 유출("톱니바퀴" → "기어")은 문자열로 잡을 수 없어 프롬프트 규칙 3에 맡긴다.
    // PoC 로 유출률을 관찰하고, 규칙만으로 부족하면 LLM 유출 검사를 추가한다.
    if (leaksCodeWord(parsed.word, codeWord)) {
      lastError = new Error(`코드 단어 유출: "${parsed.word}"`);
      console.warn(
        `[wordGen] ${ally.name}: ${lastError.message} — 재생성 (${attempt + 1}/${maxRetries + 1})`,
      );
      continue;
    }

    return {
      npcId: ally.id,
      word: parsed.word,
      reason: parsed.reason ?? '',
      usage: message.usage,
    };
  }

  throw new Error(`${ally.name} 연상 단어 생성 실패: ${lastError?.message ?? '알 수 없는 오류'}`);
}

/**
 * 동시 실행 수 제한.
 * 5개를 한꺼번에 쏘면 529(Overloaded)로 실패하는 것을 실측으로 확인했다
 * (5개 동시 → 재시도 소진 후 실패 / 3개 동시 → 약 13초 성공).
 * 스테이지 시작이 통째로 실패하는 것보다 몇 초 느린 편이 낫다.
 */
const CONCURRENCY = 3;

/** 동시 실행 수를 제한하며 비동기 작업을 실행 */
async function pooledMap(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * 동료 5인의 연상 단어를 각각 독립 호출로 생성 (동시 실행 수 제한).
 *
 * @param {{ codeWord: string, allies: Array<object>, maxRetries?: number }} params
 * @returns {Promise<{ associations: Array<{npcId,word,reason}>, usage: object, calls: number }>}
 */
export async function generateAssociations({ codeWord, allies, maxRetries = 2 }) {
  const results = await pooledMap(allies, CONCURRENCY, (ally) =>
    generateOne({ codeWord, ally, maxRetries }),
  );

  // 호출별 usage 를 합산해 하나의 usage 처럼 보고한다.
  const usage = results.reduce(
    (acc, r) => ({
      input_tokens: acc.input_tokens + (r.usage?.input_tokens ?? 0),
      output_tokens: acc.output_tokens + (r.usage?.output_tokens ?? 0),
    }),
    { input_tokens: 0, output_tokens: 0 },
  );

  return {
    associations: results.map(({ npcId, word, reason }) => ({ npcId, word, reason })),
    usage,
    calls: results.length,
  };
}
