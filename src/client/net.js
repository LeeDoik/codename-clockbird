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
