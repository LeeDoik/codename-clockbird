/**
 * W1 PoC — 연상 단어 생성 파이프라인 검증.
 *
 *   npm run poc              # 무작위 코드 단어
 *   npm run poc -- 톱니바퀴   # 특정 코드 단어 지정
 *
 * 이 스크립트가 그럴듯한 결과를 내면 W1 최대 리스크(연상 단어 품질)가 해소된다.
 * 게임을 띄우지 않고 프롬프트만 빠르게 반복 튜닝하는 용도다.
 */
import { readFile } from 'node:fs/promises';
import { generateAssociations } from '../src/server/ai/wordGen.js';
import { judgeDuplicates } from '../src/server/ai/judge.js';

const load = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));

function pickRandomCodeWord(pool) {
  const all = Object.entries(pool.categories).flatMap(([category, words]) =>
    words.map((word) => ({ category, word })),
  );
  return all[Math.floor(Math.random() * all.length)];
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\n[!] ANTHROPIC_API_KEY 가 없습니다.');
    console.error('    .env.example 을 .env 로 복사하고 키를 넣은 뒤 다시 실행하세요.\n');
    process.exit(1);
  }

  const [pool, personas] = await Promise.all([
    load('../src/data/codewords.json'),
    load('../src/data/personas.json'),
  ]);
  const allies = personas.allies;

  const override = process.argv[2];
  const picked = override
    ? { word: override, category: '(지정)' }
    : pickRandomCodeWord(pool);

  console.log('\n═══════════════════════════════════════════');
  console.log(`  접선 코드: 「${picked.word}」  [${picked.category}]`);
  console.log('═══════════════════════════════════════════\n');

  const t0 = Date.now();

  console.log('  연상 단어 생성 중... (동료 5인 독립 병렬 호출)');
  const gen = await generateAssociations({ codeWord: picked.word, allies });
  const tGen = Date.now();

  console.log('  중복 판정 중...\n');
  const dup = await judgeDuplicates({ associations: gen.associations });
  const tEnd = Date.now();

  const arrested = new Set(dup.arrestedIds);
  const byId = Object.fromEntries(allies.map((a) => [a.id, a]));

  console.log('  ── 동료들의 연상 단어 ──\n');
  for (const a of gen.associations) {
    const ally = byId[a.npcId];
    const mark = arrested.has(a.npcId) ? '[체포됨]' : '[접선가능]';
    console.log(`  ${mark} ${ally.name} (${ally.role})`);
    console.log(`      단어: 「${a.word}」`);
    console.log(`      이유: ${a.reason}\n`);
  }

  if (dup.groups.length > 0) {
    console.log('  ── 중복 판정 ──\n');
    for (const g of dup.groups) {
      const names = g.npcIds.map((id) => byId[id]?.name ?? id).join(', ');
      console.log(`  · ${names} → ${g.reason}`);
    }
    console.log('');
  } else {
    console.log('  ── 중복 없음: 5명 전원 접선 가능 ──\n');
  }

  const survivors = gen.associations.filter((a) => !arrested.has(a.npcId));
  console.log('  ── 플레이어가 보게 될 단서 ──\n');
  console.log(`  ${survivors.map((s) => `「${s.word}」`).join('  ')}`);
  console.log(`\n  → 이걸로 「${picked.word}」 를 추리할 수 있는가?\n`);

  const tok = (u) => (u ? u.input_tokens + u.output_tokens : 0);
  console.log('  ── 성능 ──');
  console.log(`  단어 생성: ${tGen - t0}ms (병렬 ${gen.calls}회 호출, ${tok(gen.usage)} 토큰)`);
  console.log(`  중복 판정: ${tEnd - tGen}ms (${tok(dup.usage)} 토큰)`);
  console.log(`  합계: ${tEnd - t0}ms\n`);
}

main().catch((err) => {
  console.error('\n[PoC 실패]', err.message);
  if (err.status) console.error(`  HTTP ${err.status}`);
  process.exit(1);
});
