/**
 * 접선 코드 유출 방지 및 단어 비교용 정규화 유틸.
 *
 * LLM 프롬프트의 지시만으로는 코드 단어 유출을 100% 막을 수 없으므로,
 * 서버측에서 한 번 더 기계적으로 검사한다.
 */

/** 공백·문장부호 제거 + 소문자화. 단어 비교의 1차 기준. */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 두 단어가 표기상 같은지 (정규화 후 완전 일치) */
export function isSameWord(a, b) {
  const na = normalize(a);
  return na.length > 0 && na === normalize(b);
}

/**
 * 텍스트가 코드 단어를 유출하는지 검사.
 * 부분 문자열까지 잡는다 — "톱니바퀴"가 코드면 "톱니바퀴들"도 유출로 본다.
 */
export function leaksCodeWord(text, codeWord) {
  const nText = normalize(text);
  const nCode = normalize(codeWord);
  return nCode.length > 0 && nText.includes(nCode);
}
