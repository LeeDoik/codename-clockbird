/**
 * 중복 발생률 측정 — 체포·구출 메커닉의 난이도 조정 도구.
 *
 *   node scripts/exp-dup-rate.js
 *
 * 동료들은 서로의 답을 모른 채 독립 생성되므로 중복은 자연 발생한다.
 * 그 빈도가 곧 "감옥에 동료가 있을 확률" = 구출 콘텐츠 노출 빈도다.
 *
 * 측정 결과 (2026-07, 페르소나 5인 / 코드 단어 4종):
 *   표기 완전 일치 기준 4회 중 1회(25%). 현재 이 수준으로 확정.
 *   ※ 실제 게임에서는 judge.js 의 LLM 유사어 판정이 더해져 체감 빈도는 이보다 높다
 *      (예: "수증기" vs "증기" 처럼 표기가 달라도 중복 처리됨).
 *
 * 빈도를 올리려면 personas.json 의 직업을 서로 인접하게 (예: 기관사·밀수꾼을 둘 다
 * 지하/기계 계열로) 조정한 뒤 이 스크립트로 재측정한다.
 */
import { readFile } from 'node:fs/promises';
import { generateAssociations } from '../src/server/ai/wordGen.js';
import { normalize } from '../src/server/ai/guardrail.js';

const CODE_WORDS = ['톱니바퀴', '안개', '열쇠', '시계탑'];

const load = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));

async function main() {
  const personas = await load('../src/data/personas.json');
  const allies = personas.allies;
  const byId = Object.fromEntries(allies.map((a) => [a.id, a]));

  let dupRuns = 0;

  for (const codeWord of CODE_WORDS) {
    const t = Date.now();
    let gen;
    try {
      gen = await generateAssociations({ codeWord, allies });
    } catch (err) {
      console.log(`「${codeWord}」 실패: HTTP ${err.status ?? '?'} ${err.message.slice(0, 60)}`);
      continue;
    }

    // 정규화 후 완전 일치만 센다 (LLM 유사어 판정 없이, 순수 중복률)
    const counts = new Map();
    for (const a of gen.associations) {
      const k = normalize(a.word);
      counts.set(k, [...(counts.get(k) ?? []), byId[a.npcId].name]);
    }
    const dups = [...counts.values()].filter((v) => v.length > 1);
    if (dups.length) dupRuns++;

    const words = gen.associations.map((a) => `${byId[a.npcId].role}:${a.word}`).join('  ');
    console.log(
      `「${codeWord}」 ${String(Date.now() - t).padStart(6)}ms  중복 ${dups.length ? '★' + dups.map((d) => d.join('=')).join(',') : '없음'}`,
    );
    console.log(`   ${words}\n`);
  }

  console.log(`── 결과: ${CODE_WORDS.length}회 중 ${dupRuns}회에서 중복 발생 ──\n`);
}

main().catch((e) => {
  console.error('실험 실패:', e.message);
  process.exit(1);
});
