import express from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { generateOne, generateAssociations } from '../ai/wordGen.js';
import { judgeDuplicates } from '../ai/judge.js';
import { streamAllyReply } from '../ai/dialogue.js';
import { templateNames, loadTemplate } from '../ai/promptStore.js';

/**
 * 프롬프트 스튜디오 API — 팀원용 프롬프트 튜닝 도구의 백엔드.
 *
 * 페르소나(src/data/personas.json)와 시스템 프롬프트 템플릿(src/data/prompts/*.txt)을
 * 읽고/저장하고, 저장하기 전에 초안 그대로 연상 단어·대화를 미리 돌려볼 수 있다.
 *
 * 개발 모드 전용. 제출 빌드(NODE_ENV=production)에서는 전 라우트가 403 이다 —
 * 파일 쓰기 API 를 심사 환경에 열어두지 않기 위함 (REVEAL_ANSWER 게이트와 같은 취지).
 */

const router = express.Router();

router.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: '프롬프트 스튜디오는 개발 모드 전용입니다.' });
  }
  next();
});

const PERSONAS_URL = new URL('../../data/personas.json', import.meta.url);
const CODEWORDS_URL = new URL('../../data/codewords.json', import.meta.url);
const promptUrl = (name) => new URL(`../../data/prompts/${name}.txt`, import.meta.url);

/** 템플릿별로 빠지면 게임이 조용히 망가지는 변수 — 저장은 막지 않고 경고만 돌려준다. */
const RECOMMENDED_VARS = {
  'wordgen-system': ['name', 'role', 'persona'],
  'dialogue-system': ['name', 'role', 'persona', 'word', 'alertLevel', 'arrestedCount'],
  'tutorial-dialogue': ['name', 'role', 'persona', 'word', 'reasonBlock'],
  'checkpoint-question': ['alertLevel', 'arrestedCount'],
  'checkpoint-judge': ['alertLevel', 'arrestedCount', 'strictness'],
};

function missingVars(name, text) {
  return (RECOMMENDED_VARS[name] ?? []).filter((v) => !text.includes(`{{${v}}}`));
}

/** GET /api/studio/data — 편집 대상 전부 (페르소나 + 템플릿 + 미리보기용 코드 단어 풀) */
router.get('/data', async (req, res, next) => {
  try {
    const personas = JSON.parse(await readFile(PERSONAS_URL, 'utf8'));
    const codewords = JSON.parse(await readFile(CODEWORDS_URL, 'utf8'));
    const prompts = {};
    for (const name of templateNames()) prompts[name] = await loadTemplate(name);
    res.json({ allies: personas.allies, prompts, categories: codewords.categories });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/studio/personas  { allies: [{id,name,role,persona}] }
 * id 집합은 기존과 동일해야 한다 (구조 파괴 방지). spawn 등 나머지 필드는 보존.
 */
router.put('/personas', async (req, res, next) => {
  try {
    const incoming = req.body?.allies;
    const file = JSON.parse(await readFile(PERSONAS_URL, 'utf8'));

    if (!Array.isArray(incoming) || incoming.length !== file.allies.length) {
      return res.status(400).json({ error: `동료는 정확히 ${file.allies.length}명이어야 합니다.` });
    }
    const byId = new Map(incoming.map((a) => [a?.id, a]));
    for (const orig of file.allies) {
      const inc = byId.get(orig.id);
      if (!inc) return res.status(400).json({ error: `누락된 동료: ${orig.id} (id 는 바꿀 수 없습니다)` });
      for (const field of ['name', 'role', 'persona']) {
        if (typeof inc[field] !== 'string' || !inc[field].trim()) {
          return res.status(400).json({ error: `${orig.id}.${field} 가 비어 있습니다.` });
        }
        if (inc[field].length > 2000) {
          return res.status(400).json({ error: `${orig.id}.${field} 가 너무 깁니다 (2000자 제한).` });
        }
      }
    }

    file.allies = file.allies.map((orig) => {
      const inc = byId.get(orig.id);
      return { ...orig, name: inc.name.trim(), role: inc.role.trim(), persona: inc.persona.trim() };
    });

    await writeFile(PERSONAS_URL, JSON.stringify(file, null, 2) + '\n', 'utf8');
    res.json({ ok: true, allies: file.allies });
  } catch (err) {
    next(err);
  }
});

/**
 * codewords.json 직렬화 — 분류당 한 줄(원본 손글씨 포맷 유지).
 * JSON.stringify(…, null, 2) 는 단어 하나당 한 줄로 펼쳐 git diff 를 읽기 어렵게 만든다.
 */
function formatCodewords(file) {
  const lines = Object.entries(file).map(([key, value]) => {
    if (key !== 'categories') return `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
    const cats = Object.entries(value)
      .map(([name, words]) => `    ${JSON.stringify(name)}: [${words.map((w) => JSON.stringify(w)).join(', ')}]`)
      .join(',\n');
    return `  "categories": {\n${cats}\n  }`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

/**
 * PUT /api/studio/codewords  { categories: { 분류명: [단어, ...] } }
 * 접선 코드 단어 풀 전체 교체 — 분류 추가·삭제·이름 변경 모두 허용.
 * 진행 중인 세션은 이미 뽑힌 코드를 세션에 복사해 두므로 영향받지 않는다.
 * categories 밖 필드(_comment 등)는 보존한다.
 */
router.put('/codewords', async (req, res, next) => {
  try {
    const categories = req.body?.categories;
    if (!categories || typeof categories !== 'object' || Array.isArray(categories)) {
      return res.status(400).json({ error: 'categories 객체가 필요합니다.' });
    }

    const names = Object.keys(categories);
    if (names.length === 0) return res.status(400).json({ error: '분류가 최소 1개 필요합니다.' });
    if (names.length > 20) return res.status(400).json({ error: '분류는 최대 20개입니다.' });

    const cleaned = {};
    const seen = new Map(); // 단어 → 분류. 풀 전체에서 같은 단어가 두 번 나오면 거절한다.
    for (const rawName of names) {
      const name = String(rawName).trim();
      if (!name) return res.status(400).json({ error: '빈 분류 이름이 있습니다.' });
      if (name.length > 20) {
        return res.status(400).json({ error: `분류 이름이 너무 깁니다: ${name} (20자 제한)` });
      }
      if (Object.hasOwn(cleaned, name)) {
        return res.status(400).json({ error: `분류 이름이 중복됩니다: ${name}` });
      }

      const rawWords = categories[rawName];
      if (!Array.isArray(rawWords) || rawWords.length === 0) {
        return res.status(400).json({ error: `「${name}」 분류에 단어가 없습니다.` });
      }
      const words = [];
      for (const raw of rawWords) {
        const word = typeof raw === 'string' ? raw.trim() : '';
        if (!word) return res.status(400).json({ error: `「${name}」 분류에 빈 단어가 있습니다.` });
        // 화이트리스트 — 이모지·기호는 글자 수 힌트(.length)를 실제 보이는 글자 수와
        // 어긋나게 만들므로(예: ⚙️ = 2) 공백과 함께 통째로 막는다.
        if (!/^[가-힣a-zA-Z0-9]+$/.test(word)) {
          return res.status(400).json({ error: `「${word}」 — 한글·영문·숫자만 쓸 수 있습니다 (공백·특수문자 불가).` });
        }
        if (word.length > 12) {
          return res.status(400).json({ error: `「${word}」 — 단어가 너무 깁니다 (12자 제한).` });
        }
        if (seen.has(word)) {
          const where = seen.get(word);
          return res.status(400).json({
            error: `「${word}」 가 중복됩니다 (${where === name ? `「${name}」 안에서 두 번` : `「${where}」 과 「${name}」 양쪽`}).`,
          });
        }
        seen.set(word, name);
        words.push(word);
      }
      cleaned[name] = words;
    }
    if (seen.size > 500) {
      return res.status(400).json({ error: `단어가 너무 많습니다 (총 ${seen.size}개, 500개 제한).` });
    }

    const file = JSON.parse(await readFile(CODEWORDS_URL, 'utf8'));
    file.categories = cleaned;
    await writeFile(CODEWORDS_URL, formatCodewords(file), 'utf8');
    res.json({ ok: true, categories: cleaned, total: seen.size });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/studio/prompts/:name  { text } — 화이트리스트 밖 이름은 loadTemplate 이 던진다 */
router.put('/prompts/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    if (!templateNames().includes(name)) {
      return res.status(400).json({ error: `알 수 없는 템플릿: ${name}` });
    }
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: '템플릿이 비어 있습니다.' });
    }
    if (text.length > 20000) {
      return res.status(400).json({ error: '템플릿이 너무 깁니다 (20000자 제한).' });
    }

    await writeFile(promptUrl(name), text.replace(/\r\n/g, '\n').trimEnd() + '\n', 'utf8');
    res.json({ ok: true, warnings: missingVars(name, text).map((v) => `{{${v}}} 가 템플릿에 없습니다 — 게임에서 이 정보가 주입되지 않습니다.`) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/studio/preview/wordgen  { codeWord, ally, promptOverride? }
 * 초안 페르소나·초안 템플릿 그대로 1인 생성. 저장하지 않아도 미리볼 수 있다.
 */
router.post('/preview/wordgen', async (req, res, next) => {
  try {
    const { codeWord, ally, promptOverride } = req.body ?? {};
    if (!codeWord?.trim() || !ally?.name) {
      return res.status(400).json({ error: 'codeWord 와 ally 가 필요합니다.' });
    }
    const t0 = Date.now();
    const r = await generateOne({ codeWord: codeWord.trim(), ally, maxRetries: 1, promptOverride });
    res.json({ word: r.word, reason: r.reason, elapsedMs: Date.now() - t0 });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/studio/preview/wordgen-all  { codeWord, allies, promptOverride? }
 * 5인 전원 생성 + 실제 중복(체포) 판정 — wordGen 튜닝의 필수 확인 루프.
 * (직접성을 높이면 중복률이 폭등하는 함정이 실측돼 있다. README 설계 근거 참조)
 */
router.post('/preview/wordgen-all', async (req, res, next) => {
  try {
    const { codeWord, allies, promptOverride } = req.body ?? {};
    if (!codeWord?.trim() || !Array.isArray(allies) || allies.length === 0) {
      return res.status(400).json({ error: 'codeWord 와 allies 가 필요합니다.' });
    }
    const t0 = Date.now();
    const gen = await generateAssociations({ codeWord: codeWord.trim(), allies, promptOverride });
    const dup = await judgeDuplicates({ associations: gen.associations });
    res.json({
      associations: gen.associations,
      duplicateGroups: dup.groups,
      arrestedIds: dup.arrestedIds,
      elapsedMs: Date.now() - t0,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/studio/preview/dialogue
 * { ally, word, alertLevel, arrestedCount, message, promptOverride? }
 * 스트리밍 없이 완성 응답만 돌려준다 (스튜디오는 미리보기라 지연 몇 초가 문제되지 않는다).
 */
router.post('/preview/dialogue', async (req, res, next) => {
  try {
    const { ally, word, alertLevel = 0, arrestedCount = 0, message, promptOverride } = req.body ?? {};
    if (!ally?.name || !word?.trim() || !message?.trim()) {
      return res.status(400).json({ error: 'ally, word, message 가 필요합니다.' });
    }
    const t0 = Date.now();
    const reply = await streamAllyReply({
      ally,
      word: word.trim(),
      alertLevel: Number(alertLevel) || 0,
      arrestedCount: Number(arrestedCount) || 0,
      history: [],
      userMessage: message.trim(),
      onText: () => {},
      promptOverride,
    });
    res.json({ reply, elapsedMs: Date.now() - t0 });
  } catch (err) {
    next(err);
  }
});

export default router;
