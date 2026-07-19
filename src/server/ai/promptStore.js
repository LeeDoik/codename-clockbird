import { readFile } from 'node:fs/promises';

/**
 * 프롬프트 템플릿 저장소.
 *
 * 시스템 프롬프트의 프로즈 블록을 src/data/prompts/*.txt 로 분리해,
 * 코드를 만지지 않는 팀원도 프롬프트 스튜디오(/prompt-studio)에서 조율할 수 있게 한다.
 * structured output 스키마와 가드레일 로직은 게임 규칙이므로 코드에 남긴다.
 *
 * 템플릿 문법: {{변수}} — render 시 vars 의 같은 키로 치환된다.
 * 개발 모드에서는 매 호출마다 파일을 다시 읽어 저장이 즉시 반영되고,
 * 프로덕션(제출 빌드)에서는 1회 읽고 캐시한다 (파일 IO 는 LLM 지연 대비 무시할 수준).
 */

const TEMPLATES = ['wordgen-system', 'dialogue-system'];
const isProd = process.env.NODE_ENV === 'production';
const cache = new Map();

export function templateNames() {
  return [...TEMPLATES];
}

export async function loadTemplate(name) {
  if (!TEMPLATES.includes(name)) throw new Error(`알 수 없는 템플릿: ${name}`);
  if (isProd && cache.has(name)) return cache.get(name);

  const url = new URL(`../../data/prompts/${name}.txt`, import.meta.url);
  // CRLF 정규화 + 끝 개행 제거 — 추출 전 코드의 템플릿 리터럴과 글자 단위로 같아지게.
  const text = (await readFile(url, 'utf8')).replace(/\r\n/g, '\n').trimEnd();
  cache.set(name, text);
  return text;
}

export function renderTemplate(template, vars) {
  const rendered = template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    Object.hasOwn(vars, key) ? String(vars[key]) : match,
  );
  // 오타로 치환되지 않은 변수는 조용히 새지 않게 경고만 남긴다 (게임은 계속 돈다).
  const leftover = rendered.match(/\{\{\w+\}\}/g);
  if (leftover) {
    console.warn(`[promptStore] 치환되지 않은 변수: ${[...new Set(leftover)].join(', ')}`);
  }
  return rendered;
}

/**
 * 템플릿 로드 + 렌더.
 * @param {string} [override] 파일 대신 쓸 템플릿 원문 — 스튜디오의 "저장 전 미리보기"용.
 */
export async function renderPrompt(name, vars, override) {
  const template = override ?? (await loadTemplate(name));
  return renderTemplate(template, vars);
}
