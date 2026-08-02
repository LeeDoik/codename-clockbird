import { anthropic, MODEL_CHAT } from './client.js';
import { renderPrompt } from './promptStore.js';

/**
 * 동료 NPC 자유 대화 (스트리밍).
 *
 * ── 가드레일: 필터가 아니라 정보 설계 ──
 * 계획서 초안은 "NPC 응답에 코드 단어가 있으면 재생성"이었으나, 스트리밍에서는
 * 필터가 감지한 시점에 이미 그 글자가 플레이어 화면에 찍혀 있다.
 * 그래서 이 프롬프트에는 접선 코드를 아예 넣지 않는다.
 * 모델이 모르는 정보는 유출될 수 없다 — 필터보다 강한 보장이다.
 *
 * NPC 는 자신의 연상 단어만 안다. "코드를 알지만 말할 수 없다"는 설정은
 * 서사로만 유지되며, 실제로 모델은 코드를 모른다.
 *
 * ── 대화로 힌트를 더 준다 (난이도 하향) ──
 * 초기 프롬프트는 "단어 이상의 단서 금지 / 왜 그 단어인지 설명 금지"로 대화를 막았다.
 * 그 결과 플레이테스트에서 단서가 너무 모호해 코드를 못 맞히는 판이 대부분이었다.
 * 그래서 캐물으면 NPC 가 자기 단어를 구체적으로 풀어 주도록 열었다.
 * 이게 안전한 이유: 모델은 코드를 모르고 자기 연상 단어만 안다. 그러니 아무리 풀어 줘도
 * "단어 언저리"를 맴돌 뿐, 코드는 유출될 수 없다 (모르는 것은 새어나갈 수 없다).
 * ※ wordGen 이 남긴 reason(단어를 고른 이유)은 코드를 알고 쓴 문장이라 "톱니 달린 수문"처럼
 *    코드 조각이 들어있다. 그래서 reason 은 이 프롬프트에 절대 넣지 않는다 — 모델이 코드를
 *    모르는 상태를 깨는 순간 위 보장이 무너진다.
 *
 * ── 프롬프트 캐싱은 걸지 않았다 ──
 * 계획서에는 페르소나 블록 캐싱이 있었지만, Haiku 4.5 의 최소 캐시 프리픽스는
 * 4096 토큰이다. 우리 시스템 프롬프트는 500 토큰 남짓이라 cache_control 을 붙여도
 * 조용히 캐시되지 않는다 (에러 없이 무시됨). 착시를 만들지 않기 위해 생략한다.
 * 대화 이력이 길어져 프리픽스가 4096 토큰을 넘기면 그때 도입한다.
 */

// 시스템 프롬프트 본문(세계관·정체·상황·규칙·말투)은 src/data/prompts/dialogue-system.txt 에 있다.
// 프롬프트 스튜디오(/prompt-studio)에서 편집·미리보기할 수 있게 코드 밖으로 뺐다.
// 위의 "코드를 프롬프트에 넣지 않는다 / reason 을 넣지 않는다" 보장은 renderPrompt 에 넘기는
// vars 가 전부이므로 그대로 유지된다 — 템플릿을 어떻게 고쳐도 모델은 코드를 모른다.

/** 대화 이력이 무한정 길어지지 않게 제한 (비용·지연 관리) */
const MAX_HISTORY = 12;

export function trimHistory(history) {
  return history.length > MAX_HISTORY ? history.slice(-MAX_HISTORY) : history;
}

/**
 * 동료 NPC 의 응답을 스트리밍으로 생성.
 *
 * @param {object} params
 * @param {(text: string) => void} params.onText 텍스트 델타 콜백
 * @returns {Promise<string>} 완성된 응답 전문
 */
export async function streamAllyReply({
  ally,
  word,
  alertLevel,
  arrestedCount,
  history,
  userMessage,
  onText,
  promptOverride, // 스튜디오의 "저장 전 미리보기"용 — 게임 경로에서는 쓰지 않는다
}) {
  const system = await renderPrompt(
    'dialogue-system',
    {
      name: ally.name,
      role: ally.role,
      backstory: ally.backstory,
      personality: ally.personality,
      word,
      alertLevel,
      arrestedCount,
    },
    promptOverride,
  );

  const stream = anthropic.messages.stream({
    model: MODEL_CHAT,
    max_tokens: 300,
    system,
    messages: [...trimHistory(history), { role: 'user', content: userMessage }],
  });

  stream.on('text', onText);

  const final = await stream.finalMessage();
  return final.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * 저택 직원의 응답을 스트리밍으로 생성 (스테이지 2).
 *
 * 여기엔 접선 코드도 연상 단어도 없다. 대신 **모델은 자기가 동료인지 민간인인지 안다** —
 * 그 사실이 이 스테이지의 정답이고, 플레이어는 말투와 반응만으로 그걸 알아내야 한다.
 * 그래서 프롬프트가 "먼저 밝히지 마라"를 규칙으로 못박는다. 여기가 뚫리면 게임이 없다.
 *
 * 호감도·의심도 수치를 프롬프트에 넣는 이유는 연기의 온도를 맞추기 위해서다.
 * 수치 자체는 클라이언트로 나가지 않는다 (mansionSession.toMansionView 참고).
 */
/**
 * 호감도·의심도를 **말로** 바꾼다.
 *
 * 프롬프트에 "0 / 3" 같은 숫자를 넣었더니 모델이 그걸 대사에 적어 화면에 내보냈다
 * (`*마음 열림도: 0 / 3*`). 수치 비노출은 이 스테이지의 규칙이라 그 순간 게임이 깨진다.
 * "말하지 마라"로 막는 대신 아예 숫자를 주지 않는다 — 모르는 것은 유출될 수 없다.
 * 이제 모델이 제 상태를 흘려도 "아직 낯설다" 정도라 그건 연기의 일부다.
 */
const FAVOR_WORDS = [
  '아직 완전히 낯설다. 그저 지나가는 외부인이다',
  '조금 경계가 풀렸다. 말이 통하는 구석이 있는 것 같다',
  '꽤 마음이 놓인다. 어쩌면 같은 편일지도 모른다',
  '이 사람은 믿어도 될 것 같다',
];
const SUSPICION_WORDS = [
  '별로 신경 쓰지 않는다',
  '뭔가 거슬리는 말을 한다',
  '꽤 수상하다. 저 사람 조심해야겠다',
  '더는 못 참겠다',
];
const pick = (words, n) => words[Math.min(n, words.length - 1)];

export async function streamMansionReply({
  npc,
  room,
  clueTopic = null,
  history,
  userMessage,
  onText,
  promptOverride,
  // 동료/민간인 태도 조각(mansion-ally · mansion-civ)의 저장 전 미리보기용.
  // 이 둘도 스튜디오에서 편집하므로 덮어쓸 자리가 있어야 한다.
  kindOverride,
}) {
  const kindBlock = await renderPrompt(
    npc.kind === 'ally' ? 'mansion-ally' : 'mansion-civ',
    { mood: npc.kind === 'ally' ? pick(FAVOR_WORDS, npc.favor) : pick(SUSPICION_WORDS, npc.suspicion) },
    kindOverride,
  );

  // 플레이어가 이 NPC 관련 단서를 조사로 찾았으면, 그 화제를 프롬프트에 얹어 반응하게 한다.
  const clueBlock = clueTopic
    ? `\n[상대가 아는 것]\n상대는 저택을 둘러보다 이런 것을 보았다: ${clueTopic}.\n상대가 그 화제를 꺼내면 너는 뜨끔한다 — 모르는 척하지 말고, 그 얘기에 실제로 반응하라.`
    : '';

  const system = await renderPrompt(
    'mansion-dialogue',
    {
      name: npc.name,
      role: npc.name,
      backstory: npc.backstory,
      personality: npc.personality,
      room,
      kindBlock,
      clueBlock,
    },
    promptOverride,
  );

  const stream = anthropic.messages.stream({
    model: MODEL_CHAT,
    max_tokens: 250,
    system,
    messages: [...trimHistory(history), { role: 'user', content: userMessage }],
  });

  stream.on('text', onText);

  const final = await stream.finalMessage();
  return final.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * 튜토리얼 동료의 응답을 스트리밍으로 생성.
 *
 * streamAllyReply 와 다른 점은 딱 하나 — 여기서는 "왜 그 단어를 떠올렸는가"(reason)가
 * 게임 규칙으로 잠겨 있다. 신뢰도가 남아 있는 동안 reason 을 프롬프트에 넣지 않아
 * 모델이 그 이유를 아예 모르게 한다. 넣어 두고 "말하지 마라"로 막으면 몇 마디만에 새고,
 * 그러면 신뢰도 규칙 자체가 무의미해진다 — 모르는 것은 유출될 수 없다.
 *
 * @param {string|null} params.reason 신뢰도 0 에서만 넘긴다. null 이면 프롬프트가 잠긴다.
 * @returns {Promise<string>} 완성된 응답 전문
 */
export async function streamTutorialReply({
  ally,
  word,
  reason,
  history,
  userMessage,
  onText,
  promptOverride,
}) {
  const system = await renderPrompt(
    'tutorial-dialogue',
    {
      name: ally.name,
      role: ally.role,
      backstory: ally.backstory,
      personality: ally.personality,
      word,
      reasonBlock: reason
        ? `상대가 왜 그 단어를 떠올렸는지 물으면, 딱 이만큼만 말해도 된다: "${reason}"`
        : '왜 그 단어를 떠올렸는지는 절대 설명하지 마라. 너도 그 이유는 말할 수 없는 처지다 — 물으면 얼버무려라.',
    },
    promptOverride,
  );

  const stream = anthropic.messages.stream({
    model: MODEL_CHAT,
    max_tokens: 200,
    system,
    messages: [...trimHistory(history), { role: 'user', content: userMessage }],
  });

  stream.on('text', onText);

  const final = await stream.finalMessage();
  return final.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
