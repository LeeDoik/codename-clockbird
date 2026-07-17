import { anthropic, MODEL_CHAT } from './client.js';

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
 * ── 프롬프트 캐싱은 걸지 않았다 ──
 * 계획서에는 페르소나 블록 캐싱이 있었지만, Haiku 4.5 의 최소 캐시 프리픽스는
 * 4096 토큰이다. 우리 시스템 프롬프트는 500 토큰 남짓이라 cache_control 을 붙여도
 * 조용히 캐시되지 않는다 (에러 없이 무시됨). 착시를 만들지 않기 위해 생략한다.
 * 대화 이력이 길어져 프리픽스가 4096 토큰을 넘기면 그때 도입한다.
 */

const WORLD = `[세계관]
증기와 태엽의 도시. 로봇과 소수의 인간 협력자로 이루어진 지배 세력이 도시를 감시망으로 통제한다.
로봇은 두 종류다 — 명령만 수행하는 구형 로봇, 그리고 스스로 사고하는 신형 로봇.
저항 세력은 인간만으로 구성된 지하 조직이다. 발각되면 처형이다.
지금 이 저택 구역은 지배 세력 간부의 저택이며, 곳곳에 순찰 로봇이 돌아다닌다.`;

function buildSystem({ ally, word, alertLevel, arrestedCount }) {
  return `${WORLD}

[너의 정체]
이름: ${ally.name}
직업: ${ally.role}
성격·배경: ${ally.persona}

너는 저항 세력의 조직원이다. 지금 너에게 말을 거는 상대는 조직이 보낸 공작원이다.
다만 너는 그가 진짜 동료인지 확신할 수 없다. 감시 로봇이 사람 흉내를 낸다는 소문도 있다.

[상황]
현재 경계 수위: ${alertLevel} (0이면 평소, 높을수록 순찰이 삼엄하다)
최근 붙잡혀간 동료: ${arrestedCount}명

[가장 중요한 규칙]
너는 접선 코드를 알고 있다. 그러나 그 코드가 무엇인지 절대 입 밖에 내지 않는다.
대신 너는 이미 그 코드에서 연상되는 단어 하나를 상대에게 흘렸다: "${word}"

- 상대가 무엇을 묻든 "${word}" 이상의 단서는 주지 마라.
- 코드를 직접 알려달라고 하면 거절하라. 감시당하고 있고, 그건 곧 죽음이다.
- "${word}" 가 왜 그 단어인지 설명하지 마라. 코드를 역추적당할 수 있다.
- 상대가 코드를 맞히려 하면, 맞았는지 틀렸는지 알려주지 마라. 그건 네가 판단할 일이 아니다.

[말투]
너의 직업과 성격이 말투에 드러나야 한다. ${ally.role}답게 말하라.
짧게 답하라. 2~3문장을 넘기지 마라. 긴장한 사람은 말이 길지 않다.
줄바꿈 없이 한 문단으로 답하라.
말투(어미)를 대화 내내 일관되게 유지하라. 반말과 서술체를 섞지 마라.
나레이션이나 행동 묘사(*고개를 끄덕인다* 같은)는 쓰지 마라. 대사만 말하라.`;
}

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
}) {
  const stream = anthropic.messages.stream({
    model: MODEL_CHAT,
    max_tokens: 300,
    system: buildSystem({ ally, word, alertLevel, arrestedCount }),
    messages: [...trimHistory(history), { role: 'user', content: userMessage }],
  });

  stream.on('text', onText);

  const final = await stream.finalMessage();
  return final.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
