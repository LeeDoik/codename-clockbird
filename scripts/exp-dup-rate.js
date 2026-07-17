/**
 * 난이도 측정 — 단서의 추리 가능성 + 중복 발생률.
 *
 *   node scripts/exp-dup-rate.js            # 기본 6개 코드 단어 × 2회
 *   node scripts/exp-dup-rate.js 3          # 반복 횟수 지정
 *
 * 이 게임의 난이도는 서로 반대로 움직이는 두 수치의 균형이다.
 * 하나만 보고 튜닝하면 반드시 다른 하나가 망가지므로 항상 같이 측정한다.
 *
 * 1) 추리 가능성 — 살아남은 동료들의 단어만 보고 코드를 맞힐 수 있는가.
 *    단어를 모호하게 만들수록 떨어진다. 이게 "게임이 너무 어렵다"의 정체다.
 * 2) 중복 발생률 — 몇 판에 한 번 같은 단어가 나오는가.
 *    단어를 직접적으로 만들수록 전원이 같은 답으로 수렴해 치솟는다.
 *    치솟으면 시작부터 동료가 다 잡혀 체포·구출 메커닉이 죽는다.
 *
 * ── 왜 LLM 으로 추리 가능성을 재는가 ──
 * 사람을 붙잡고 플레이테스트할 시간이 없다. 코드를 모르는 모델에게 단어만 주고
 * 맞혀보게 하면, 프롬프트 변경 전/후를 같은 자로 비교할 수 있다.
 * 절대 수치가 사람의 체감과 같다는 뜻은 아니다 — 변경 전/후의 상대 비교용이다.
 *
 * ── 측정 결과 (2026-07, 코드 단어 6종 × 2회 = 12판) ──
 * 현재 프롬프트(baseline):
 *   추리 1순위 적중 25% · 3순위 내 33%   ← "너무 어렵다"의 실체 (2/3판은 못 맞힘)
 *   중복(표기 일치) 50% · (LLM 판정 포함) 58%
 *   ※ README 의 "중복 25%"는 n=4 소표본 수치였다. n=12 로 재면 표기 일치 50% 다.
 *
 * ── 튜닝하다 발견한 함정 (기록으로 남긴다) ──
 * wordGen 규칙을 "단어를 더 직접적으로"로 바꿔 봤더니 중복이 50%→75%(LLM 포함 83%)로 튀었다.
 * 독립 생성이라 다들 코드의 "가장 뻔한 짝"으로 수렴하기 때문이다 (예: 열쇠→전원 "자물쇠").
 * 그렇게 겹친 동료는 곧바로 체포돼 단서가 사라지므로, 단어를 직접적으로 만들수록
 * 오히려 게임이 더 어려워지는 역설이 생긴다. → 연상 "단어"의 직접성은 중복률과 강하게
 * 묶여 있어 함부로 못 올린다. 난이도 하향은 이 스크립트로 재면서만 진행할 것.
 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { generateAssociations } from '../src/server/ai/wordGen.js';
import { judgeDuplicates } from '../src/server/ai/judge.js';
import { anthropic, MODEL_JUDGE } from '../src/server/ai/client.js';
import { normalize } from '../src/server/ai/guardrail.js';

// 4개 카테고리(기계·장소·사물·자연)를 고루 덮는다. 앞의 4개는 W1 측정과 같은 단어라
// README 의 기존 수치(중복 25%)와 직접 비교할 수 있다.
const CODE_WORDS = ['톱니바퀴', '안개', '열쇠', '시계탑', '회중시계', '증기기관'];

const load = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));

const SolveSchema = z.object({
  guesses: z.array(z.string()).describe('가능성이 높은 순서대로 한국어 명사 3개'),
});

/**
 * 코드를 모르는 모델에게 단어만 주고 맞혀보게 한다 = 플레이어 대역.
 * 카테고리(기계/장소/사물/자연)는 알려주지 않는다 — 플레이어도 볼 수 없기 때문이다.
 */
async function solve(words) {
  const message = await anthropic.beta.messages.parse({
    model: MODEL_JUDGE,
    max_tokens: 400,
    thinking: { type: 'disabled' },
    system: `증기와 태엽의 도시(스팀펑크)를 배경으로 한 단어 추리 게임이다.
비밀 코드 단어 하나가 있고, 다섯 명이 서로의 답을 모르는 채 그 코드에서 연상되는 단어를 하나씩 적었다.
그중 살아남은 사람들의 단어만 너에게 보여준다.

이 단어들이 공통으로 가리키는 코드 단어 하나를 추리하라.
- 코드는 한국어 명사 한 단어다 (기계 부품, 장소, 사물, 자연 현상 등).
- 제시된 단어 자체는 코드가 아니다.
- 가능성이 높은 순서대로 3개를 답하라.`,
    output_format: betaZodOutputFormat(SolveSchema),
    messages: [{ role: 'user', content: `단어들: ${words.map((w) => `"${w}"`).join(', ')}` }],
  });
  return message.parsed_output?.guesses ?? [];
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\n[!] ANTHROPIC_API_KEY 가 없습니다. .env 를 확인하세요.\n');
    process.exit(1);
  }

  const repeats = Number(process.argv[2]) || 2;
  const personas = await load('../src/data/personas.json');
  const allies = personas.allies;
  const byId = Object.fromEntries(allies.map((a) => [a.id, a]));

  let runs = 0;
  let dupRuns = 0; // 표기 완전 일치 (README 기준 — LLM 판정 없는 순수 중복률)
  let arrestRuns = 0; // 실제 게임 기준 (LLM 유사어 판정 포함)
  let top1 = 0;
  let top3 = 0;

  for (let rep = 0; rep < repeats; rep++) {
    for (const codeWord of CODE_WORDS) {
      const t = Date.now();
      let gen;
      try {
        gen = await generateAssociations({ codeWord, allies });
      } catch (err) {
        console.log(`「${codeWord}」 실패: HTTP ${err.status ?? '?'} ${err.message.slice(0, 60)}`);
        continue;
      }

      // 표기 완전 일치 중복 (LLM 없이, 순수 중복률 — README 의 25% 와 같은 기준)
      const counts = new Map();
      for (const a of gen.associations) {
        const k = normalize(a.word);
        counts.set(k, [...(counts.get(k) ?? []), byId[a.npcId].name]);
      }
      const dups = [...counts.values()].filter((v) => v.length > 1);

      // 실제 게임과 같은 판정 → 플레이어가 보게 될 단서는 살아남은 동료의 단어뿐
      const dup = await judgeDuplicates({ associations: gen.associations });
      const arrested = new Set(dup.arrestedIds);
      const survivors = gen.associations.filter((a) => !arrested.has(a.npcId));

      const guesses = survivors.length >= 2 ? await solve(survivors.map((s) => s.word)) : [];
      const rank = guesses.findIndex((g) => normalize(g) === normalize(codeWord));

      runs++;
      if (dups.length) dupRuns++;
      if (arrested.size) arrestRuns++;
      if (rank === 0) top1++;
      if (rank >= 0 && rank < 3) top3++;

      const words = gen.associations
        .map((a) => `${arrested.has(a.npcId) ? '✗' : ' '}${byId[a.npcId].role}:${a.word}`)
        .join('  ');
      const hit = rank === 0 ? '◎1순위' : rank > 0 ? `○${rank + 1}순위` : '✗못맞힘';
      console.log(
        `「${codeWord}」 ${String(Date.now() - t).padStart(6)}ms  ${hit}  중복 ${
          dups.length ? '★' + dups.map((d) => d.join('=')).join(',') : '없음'
        }`,
      );
      console.log(`   ${words}`);
      console.log(`   추리: ${guesses.join(' → ') || '(단서 부족)'}\n`);
    }
  }

  const pct = (n) => `${((n / runs) * 100).toFixed(0)}%`;
  console.log('── 결과 ──');
  console.log(`  총 ${runs}판`);
  console.log(`  추리 가능성: 1순위 적중 ${top1}/${runs} (${pct(top1)}) · 3순위 내 ${top3}/${runs} (${pct(top3)})`);
  console.log(`  중복(표기 일치): ${dupRuns}/${runs} (${pct(dupRuns)})   ← README 기준선 25%`);
  console.log(`  중복(LLM 판정 포함, 실게임): ${arrestRuns}/${runs} (${pct(arrestRuns)})\n`);
}

main().catch((e) => {
  console.error('실험 실패:', e.message);
  process.exit(1);
});
