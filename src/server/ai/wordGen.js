import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { anthropic, MODEL_JUDGE } from './client.js';
import { leaksCodeWord } from './guardrail.js';
import { renderPrompt } from './promptStore.js';

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

// 시스템 프롬프트 본문은 src/data/prompts/wordgen-system.txt 에 있다.
// 프롬프트 스튜디오(/prompt-studio)에서 편집·미리보기할 수 있게 코드 밖으로 뺐다.

/**
 * 동료 1인의 연상 단어 생성 (실패 시 재시도).
 * promptOverride 는 스튜디오의 "저장 전 미리보기"용 — 게임 경로에서는 쓰지 않는다.
 */
export async function generateOne({ codeWord, ally, maxRetries = 1, promptOverride }) {
  let lastError = null;

  const system = await renderPrompt(
    'wordgen-system',
    { name: ally.name, role: ally.role, persona: ally.persona },
    promptOverride,
  );

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const message = await anthropic.beta.messages.parse({
      model: MODEL_JUDGE,
      max_tokens: 300,
      // Sonnet 5 는 thinking 생략 시 adaptive thinking 이 켜진다.
      // 연상 단어 생성은 깊은 추론이 필요 없고 스테이지 시작 지연에 직결되므로 끈다.
      thinking: { type: 'disabled' },
      system,
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
 * @param {{ codeWord: string, allies: Array<object>, maxRetries?: number, promptOverride?: string }} params
 * @returns {Promise<{ associations: Array<{npcId,word,reason}>, usage: object, calls: number }>}
 */
export async function generateAssociations({ codeWord, allies, maxRetries = 2, promptOverride }) {
  const results = await pooledMap(allies, CONCURRENCY, (ally) =>
    generateOne({ codeWord, ally, maxRetries, promptOverride }),
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
