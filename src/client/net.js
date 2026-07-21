/**
 * 서버 호출 헬퍼.
 *
 * 스테이지 시작은 BootScene(첫 진입)과 ResultOverlay(재시작) 두 곳에서 필요해
 * 여기로 뺐다.
 */

/**
 * 새 판을 시작한다.
 *
 * 절대 reject 하지 않고 {state} 또는 {error} 로만 resolve 한다. 호출부가 프로미스를
 * 만들어 두고 한참 뒤에 await 하는 사용법(BootScene 이 오프닝 뒤에서 미리 쏘는 방식)
 * 에서 unhandledrejection 경고가 뜨지 않게 하기 위한 계약이다.
 *
 * @returns {Promise<{state: object} | {error: string}>}
 */
export function fetchStageStart() {
  return fetch('/api/stage/start', { method: 'POST' })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return { state: await res.json() };
    })
    .catch((err) => ({ error: err.message }));
}

/**
 * POST 응답의 SSE 스트림을 읽는다.
 *
 * EventSource 는 GET 전용이라 쓸 수 없어 fetch 스트림을 직접 파싱한다.
 * 스테이지 대화와 튜토리얼 대화가 같은 프레이밍을 쓰므로 여기 한 벌만 둔다.
 *
 * @param {Response} res
 * @param {(payload: object) => void} onPayload
 */
export async function readSSE(res, onPayload) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE 이벤트 경계는 빈 줄. 마지막 조각은 미완성일 수 있으니 버퍼에 남긴다.
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      const line = event.split('\n').find((l) => l.startsWith('data: '));
      if (line) onPayload(JSON.parse(line.slice(6)));
    }
  }
}
