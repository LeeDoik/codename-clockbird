import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Claude 클라이언트 단일 인스턴스.
 *
 * 키는 서버 프로세스에서만 읽는다. 클라이언트 번들에는 절대 들어가지 않는다
 * (Vite 는 VITE_ 접두사 변수만 노출하므로 ANTHROPIC_API_KEY 는 자동으로 차단된다).
 */
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '[ai] ANTHROPIC_API_KEY 가 설정되지 않았습니다. .env.example 을 .env 로 복사하고 키를 넣으세요.',
  );
}

export const anthropic = new Anthropic();

/** 게임 룰에 영향을 주는 생성·판정용 (품질 우선) */
export const MODEL_JUDGE = 'claude-sonnet-5';

/** 실시간 NPC 자유 대화용 (지연·비용 우선) — 다음 단계에서 사용 */
export const MODEL_CHAT = 'claude-haiku-4-5';
