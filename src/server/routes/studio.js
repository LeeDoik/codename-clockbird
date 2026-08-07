import express from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { generateOne, generateAssociations } from '../ai/wordGen.js';
import { judgeDuplicates } from '../ai/judge.js';
import { streamAllyReply, streamMansionReply } from '../ai/dialogue.js';
import { judgeDisposition } from '../ai/disposition.js';
import { generateRobotQuestion, judgeAsRobot, judgeAsSystem } from '../ai/interrogation.js';
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
const MANSION_URL = new URL('../../data/mansion.json', import.meta.url);
const ESCAPE_URL = new URL('../../data/escape.json', import.meta.url);
const promptUrl = (name) => new URL(`../../data/prompts/${name}.txt`, import.meta.url);

/** 템플릿별로 빠지면 게임이 조용히 망가지는 변수 — 저장은 막지 않고 경고만 돌려준다. */
const RECOMMENDED_VARS = {
  'wordgen-system': ['name', 'role', 'backstory', 'personality'],
  'dialogue-system': ['name', 'role', 'backstory', 'personality', 'word', 'alertLevel', 'arrestedCount'],
  'tutorial-dialogue': ['name', 'role', 'backstory', 'personality', 'word', 'reasonBlock'],
  'mansion-disposition': ['name', 'backstory', 'personality', 'kindLabel', 'clueBlock'],
  'mansion-ally': ['mood'],
  'mansion-civ': ['mood'],
  'mansion-dialogue': ['backstory', 'personality'],
  'escape-question': ['asked', 'questionMax', 'historyBlock', 'backstory', 'personality'],
  'escape-system-judge': ['identityWord'],
  // escape-robot-judge 에 identityWord 는 **없어야 한다** — 로봇이 신분 단어를 알면
  // 3지선다 소거법으로 필승이라 심문이 죽는다. 그래서 권장 변수에도 넣지 않는다.
  'escape-robot-judge': ['historyBlock', 'backstory', 'personality'],
};

function missingVars(name, text) {
  return (RECOMMENDED_VARS[name] ?? []).filter((v) => !text.includes(`{{${v}}}`));
}

/** GET /api/studio/data — 편집 대상 전부 (페르소나 + 저택 NPC + 템플릿 + 미리보기용 코드 단어 풀) */
router.get('/data', async (req, res, next) => {
  try {
    const personas = JSON.parse(await readFile(PERSONAS_URL, 'utf8'));
    const codewords = JSON.parse(await readFile(CODEWORDS_URL, 'utf8'));
    const mansion = JSON.parse(await readFile(MANSION_URL, 'utf8'));
    const escape = JSON.parse(await readFile(ESCAPE_URL, 'utf8'));
    const prompts = {};
    for (const name of templateNames()) prompts[name] = await loadTemplate(name);
    res.json({
      allies: personas.allies,
      // kind(동료/민간인)는 게임의 정답이지만 스튜디오는 프로덕션에서 전 라우트 403 이고,
      // 성격을 고치려면 그가 동료인지 민간인인지 보여야 한다 — 첫 문장의 뉘앙스를
      // 그 역할에 맞춰야 하기 때문이다.
      mansionNpcs: mansion.npcs.map(({ id, name, kind, room, line, backstory, personality }) => ({
        id, name, kind, room, line, backstory, personality,
      })),
      // greet·reveal 은 편집 대상이 아니라(EscapeScene 이 그대로 쓰는 연출 대사) 내보내지 않는다.
      escapeChild: { backstory: escape.child.backstory, personality: escape.child.personality },
      prompts,
      categories: codewords.categories,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/studio/personas  { allies: [{id,name,role,backstory,personality}] }
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
      for (const field of ['name', 'role', 'backstory', 'personality']) {
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
      return {
        ...orig,
        name: inc.name.trim(),
        role: inc.role.trim(),
        backstory: inc.backstory.trim(),
        personality: inc.personality.trim(),
      };
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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * mansion.json 의 npcs 블록 안 name/line/backstory/personality 네 필드만 원문에서
 * 문자열 치환한다. `objects` 배열은 사람이 손으로 칸을 맞춘 한 줄짜리 포맷이고
 * escort·npcs·objects·rewards 사이사이에 구분용 빈 줄이 있는데, 이 파일 전체를
 * JSON.stringify(file, null, 2) 로 다시 쓰면 그 수작업 정렬과 빈 줄이 사라져
 * 안 건드린 구간까지 diff 가 퍼진다 (검증됨). id 로 해당 npc 블록만 찾아 그 안의
 * 네 필드 값만 바꿔치기하면 나머지 바이트는 원본과 그대로 같다.
 */
function patchMansionNpcFields(text, npcs) {
  for (const { id, name, line, backstory, personality } of npcs) {
    const idLit = escapeRe(JSON.stringify(id));
    const blockRe = new RegExp(`\\{\\s*"id":\\s*${idLit}[\\s\\S]*?\\n    \\}`);
    const m = text.match(blockRe);
    if (!m) throw new Error(`mansion.json 에서 ${id} 블록을 찾을 수 없습니다.`);
    let block = m[0];
    for (const [key, value] of Object.entries({ name, line, backstory, personality })) {
      const fieldRe = new RegExp(`"${key}":\\s*"(?:[^"\\\\]|\\\\.)*"`);
      if (!fieldRe.test(block)) {
        throw new Error(`mansion.json 의 ${id} 블록에서 ${key} 필드를 찾을 수 없습니다.`);
      }
      // replace 의 두 번째 인자가 "문자열"이면 그 안의 $&·$$·$`·$' 를 특수 치환
      // 패턴으로 해석한다 — value 는 팀원이 textarea 에 친 임의 문자열이라
      // "A&B" 같은 흔한 입력에도 매치 전체가 끼어들어 JSON 이 깨질 수 있다.
      // 함수를 넘기면 반환값이 그대로 삽입되어 그 해석을 피한다. 절대 문자열로
      // 되돌리지 말 것.
      block = block.replace(fieldRe, () => `"${key}": ${JSON.stringify(value)}`);
    }
    text = text.slice(0, m.index) + block + text.slice(m.index + m[0].length);
  }
  return text;
}

/**
 * PUT /api/studio/mansion-npcs  { npcs: [{id, name, line, backstory, personality}] }
 *
 * id 집합은 기존과 같아야 한다 (personas 와 같은 정책) — 좌표·방·kind 등 나머지 필드는
 * 보존한다. kind 를 편집 대상에 넣지 않는 이유: 누가 동료인지는 맵 배치·보상 데이터와
 * 얽혀 있어서 여기서 바꾸면 rewards 와 조용히 어긋난다.
 *
 * 진행 중인 세션은 createMansionSession 이 npc 를 복사해 두므로 영향받지 않는다.
 */
router.put('/mansion-npcs', async (req, res, next) => {
  try {
    const incoming = req.body?.npcs;
    const raw = await readFile(MANSION_URL, 'utf8');
    const file = JSON.parse(raw);

    if (!Array.isArray(incoming) || incoming.length !== file.npcs.length) {
      return res.status(400).json({ error: `저택 인물은 정확히 ${file.npcs.length}명이어야 합니다.` });
    }
    const byId = new Map(incoming.map((n) => [n?.id, n]));
    for (const orig of file.npcs) {
      const inc = byId.get(orig.id);
      if (!inc) return res.status(400).json({ error: `누락된 인물: ${orig.id} (id 는 바꿀 수 없습니다)` });
      for (const field of ['name', 'line', 'backstory', 'personality']) {
        if (typeof inc[field] !== 'string' || !inc[field].trim()) {
          return res.status(400).json({ error: `${orig.id}.${field} 가 비어 있습니다.` });
        }
        if (inc[field].length > 2000) {
          return res.status(400).json({ error: `${orig.id}.${field} 가 너무 깁니다 (2000자 제한).` });
        }
      }
    }

    file.npcs = file.npcs.map((orig) => {
      const inc = byId.get(orig.id);
      return {
        ...orig,
        name: inc.name.trim(),
        line: inc.line.trim(),
        backstory: inc.backstory.trim(),
        personality: inc.personality.trim(),
      };
    });

    const patched = patchMansionNpcFields(raw, file.npcs);
    // 이중 안전망 — 위 치환 로직에 놓친 경로가 있어도 깨진 결과가 디스크에
    // 닿기 전에 여기서 막는다. 이 파일에는 스테이지 2 등장인물 전부와
    // 저장소 주인의 다른 미커밋 작업이 함께 들어 있어, 조용히 깨지면 피해가 크다.
    try {
      JSON.parse(patched);
    } catch (parseErr) {
      throw new Error(`저택 인물 저장 결과가 손상되어 취소했습니다 (파일은 바뀌지 않았습니다): ${parseErr.message}`);
    }
    await writeFile(MANSION_URL, patched, 'utf8');
    res.json({ ok: true, npcs: file.npcs.map(({ id, name, kind, room, line, backstory, personality }) => ({
      id, name, kind, room, line, backstory, personality,
    })) });
  } catch (err) {
    next(err);
  }
});

/**
 * escape.json 의 child 블록 안 backstory/personality 두 필드만 원문에서 문자열 치환한다.
 * mansion.json 과 같은 이유 — identities 배열이 사람이 손으로 한 줄씩 맞춘 포맷이라
 * 파일 전체를 JSON.stringify(file, null, 2) 로 다시 쓰면 그 정렬이 사라진다 (검증됨).
 * child 블록만 찾아 그 안의 두 필드 값만 바꿔치기하면 나머지 바이트는 원본과 그대로 같다.
 *
 * greet·reveal·identities·_comment 는 여기서 손대지 않는다 — greet·reveal 은 EscapeScene 이
 * 그대로 쓰는 연출 대사라 편집 대상이 아니고, identities 는 신분 단어 고정 풀이라 이 경로와
 * 무관하다.
 */
function patchEscapeChildFields(text, { backstory, personality }) {
  const blockRe = /"child":\s*\{[\s\S]*?\n  \}/;
  const m = text.match(blockRe);
  if (!m) throw new Error('escape.json 에서 child 블록을 찾을 수 없습니다.');
  let block = m[0];
  for (const [key, value] of Object.entries({ backstory, personality })) {
    const fieldRe = new RegExp(`"${key}":\\s*"(?:[^"\\\\]|\\\\.)*"`);
    if (!fieldRe.test(block)) {
      throw new Error(`escape.json 의 child 블록에서 ${key} 필드를 찾을 수 없습니다.`);
    }
    // replace 의 두 번째 인자가 "문자열"이면 그 안의 $&·$$·$`·$' 를 특수 치환 패턴으로
    // 해석한다 — value 는 팀원이 textarea 에 친 임의 문자열이라 흔한 입력에도 매치 전체가
    // 끼어들어 JSON 이 깨질 수 있다. 함수를 넘기면 반환값이 그대로 삽입되어 그 해석을
    // 피한다 (patchMansionNpcFields 에서 검증된 패턴). 절대 문자열로 되돌리지 말 것.
    block = block.replace(fieldRe, () => `"${key}": ${JSON.stringify(value)}`);
  }
  text = text.slice(0, m.index) + block + text.slice(m.index + m[0].length);
  return text;
}

/**
 * PUT /api/studio/escape-child  { child: { backstory, personality } }
 *
 * greet·reveal·identities 는 이 경로로 바꿀 수 없다 — 요청 바디에 담겨 와도 무시한다.
 * mansion-npcs 와 같은 이중 안전망: 치환 결과를 디스크에 쓰기 전에 JSON.parse 로 검증한다.
 */
router.put('/escape-child', async (req, res, next) => {
  try {
    const incoming = req.body?.child;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'child 객체가 필요합니다.' });
    }
    for (const field of ['backstory', 'personality']) {
      if (typeof incoming[field] !== 'string' || !incoming[field].trim()) {
        return res.status(400).json({ error: `child.${field} 가 비어 있습니다.` });
      }
      if (incoming[field].length > 2000) {
        return res.status(400).json({ error: `child.${field} 가 너무 깁니다 (2000자 제한).` });
      }
    }

    const raw = await readFile(ESCAPE_URL, 'utf8');
    const patched = patchEscapeChildFields(raw, {
      backstory: incoming.backstory.trim(),
      personality: incoming.personality.trim(),
    });
    let parsed;
    try {
      parsed = JSON.parse(patched);
    } catch (parseErr) {
      throw new Error(`꼬마 성격 저장 결과가 손상되어 취소했습니다 (파일은 바뀌지 않았습니다): ${parseErr.message}`);
    }
    await writeFile(ESCAPE_URL, patched, 'utf8');
    res.json({ ok: true, child: { backstory: parsed.child.backstory, personality: parsed.child.personality } });
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

// ── 스테이지 2 미리보기 ────────────────────────────────────────────
//
// 저택은 **말이 곧 규칙**인 스테이지라(반브루주아 발언이 동료의 호감과 민간인의 의심을
// 동시에 움직인다) 대화와 성향 판정을 따로 돌려볼 수 있어야 한다. 게임에서는 이 둘이
// 나란히 돌지만 여기서는 갈라 놓는다 — 어느 쪽 프롬프트가 문제인지 가려야 하기 때문이다.

/**
 * POST /api/studio/preview/mansion-dialogue
 * { npc, room, gave?, clueTopic?, message, promptOverride?, kindOverride? }
 *
 * gave(이미 마음을 정했는가)는 연기의 온도를 정하므로 미리보기에서 켜 볼 수 있어야
 * 한다 — 실제 값 자체는 게임에서 화면에 안 나간다 (dialogue.js의 태도 말 참고).
 */
router.post('/preview/mansion-dialogue', async (req, res, next) => {
  try {
    const { npc, room = '홀', gave = false, clueTopic = null, message, promptOverride, kindOverride } =
      req.body ?? {};
    if (!npc?.name || !npc?.kind || !message?.trim()) {
      return res.status(400).json({ error: 'npc(name·kind) 와 message 가 필요합니다.' });
    }
    const t0 = Date.now();
    const reply = await streamMansionReply({
      npc: { ...npc, gave: Boolean(gave) },
      room,
      clueTopic: clueTopic?.trim() || null,
      history: [],
      userMessage: message.trim(),
      onText: () => {},
      promptOverride,
      kindOverride,
    });
    res.json({ reply, elapsedMs: Date.now() - t0 });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/studio/preview/mansion-disposition
 * { npc(name·kind·backstory·personality), message, clues?, promptOverride? }
 *
 * clues 는 [{id, topic}] — 발언이 그중 한 화제를 실제로 꺼냈는지까지 본다. 실제
 * judgeDisposition 은 대화 전체(history)를 보고 판단하지만, 여기는 세션 없는
 * 단발 미리보기라 이 한 마디만 놓고 "지금 처음 듣는다면 어떻게 반응할지"를 본다.
 */
router.post('/preview/mansion-disposition', async (req, res, next) => {
  try {
    const { npc, message, clues = [], promptOverride } = req.body ?? {};
    if (!npc?.name || (npc.kind !== 'ally' && npc.kind !== 'civ')) {
      return res.status(400).json({ error: 'npc(name, kind: ally|civ) 가 필요합니다.' });
    }
    if (!message?.trim()) return res.status(400).json({ error: 'message 가 필요합니다.' });
    const t0 = Date.now();
    const verdict = await judgeDisposition({
      npc,
      history: [],
      userMessage: message.trim(),
      clues: Array.isArray(clues) ? clues.filter((c) => c?.id && c?.topic) : [],
      promptOverride,
    });
    res.json({ ...verdict, elapsedMs: Date.now() - t0 });
  } catch (err) {
    next(err);
  }
});

// ── 스테이지 3 미리보기 ────────────────────────────────────────────

/**
 * POST /api/studio/preview/escape-question
 * { child, asked?, questionMax?, history?, promptOverride? }
 */
router.post('/preview/escape-question', async (req, res, next) => {
  try {
    const { child, asked = 0, questionMax = 8, history = [], promptOverride } = req.body ?? {};
    if (!child?.backstory || !child?.personality) {
      return res.status(400).json({ error: 'child(backstory·personality) 가 필요합니다.' });
    }
    const t0 = Date.now();
    const out = await generateRobotQuestion({
      history: Array.isArray(history) ? history : [],
      asked: Number(asked) || 0,
      questionMax: Number(questionMax) || 8,
      persona: child,
      promptOverride,
    });
    res.json({ ...out, elapsedMs: Date.now() - t0 });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/studio/preview/escape-judge
 * { child, identityWord, question, answer, history?, systemOverride?, robotOverride? }
 *
 * **두 판정을 한 번에 돌려 나란히 보여준다.** 이 심문의 설계 전체가 "시스템은 신분 단어를
 * 알고 로봇은 모른다"는 정보 격리에 걸려 있어서, 따로 보면 그게 지켜지는지 알 수 없다.
 * 로봇 쪽에는 identityWord 를 **넘길 자리가 없다** — judgeAsRobot 의 시그니처가 그렇다.
 */
router.post('/preview/escape-judge', async (req, res, next) => {
  try {
    const { child, identityWord, question, answer, history = [], systemOverride, robotOverride } = req.body ?? {};
    if (!child?.backstory || !child?.personality) {
      return res.status(400).json({ error: 'child(backstory·personality) 가 필요합니다.' });
    }
    if (!identityWord?.trim() || !question?.trim() || !answer?.trim()) {
      return res.status(400).json({ error: 'identityWord, question, answer 가 필요합니다.' });
    }
    const hist = Array.isArray(history) ? history : [];
    const t0 = Date.now();
    const [system, robot] = await Promise.all([
      judgeAsSystem({
        identityWord: identityWord.trim(),
        question: question.trim(),
        answer: answer.trim(),
        promptOverride: systemOverride,
      }),
      judgeAsRobot({
        history: hist,
        question: question.trim(),
        answer: answer.trim(),
        persona: child,
        promptOverride: robotOverride,
      }),
    ]);
    res.json({ system, robot, elapsedMs: Date.now() - t0 });
  } catch (err) {
    next(err);
  }
});

export default router;
