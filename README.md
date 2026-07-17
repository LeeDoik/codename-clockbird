# 코드네임: 태엽새 (Codename: Clockbird)

> NAN 2026 (NHN Game × AI 해커톤) 출품작 — 스팀펑크 잠입 어드벤처 × AI 워드 추리
> 기획 문서: [`NAN2026_계획서.md`](./NAN2026_계획서.md)

동료 AI NPC들이 각자 흘린 **연상 단어**를 단서로, 저택에 숨겨진 **접선 코드**를 추리하는 게임입니다.
코드 단어와 동료들의 연상 단어는 **매 판 Claude가 새로 생성**하므로 같은 판이 반복되지 않습니다.

---

## 실행 방법

### 사전 준비

1. **Node.js 22 이상** ([nodejs.org](https://nodejs.org))
2. **Anthropic API 키** — [console.anthropic.com](https://console.anthropic.com/settings/keys) 에서 발급
3. `.env.example` 을 `.env` 로 복사한 뒤 키를 입력:

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

### 실행 (심사용)

```bash
npm install
npm run build
npm start
```

→ 브라우저에서 http://localhost:3000

Windows 사용자는 **`play.bat` 더블클릭** 한 번으로 위 과정이 전부 실행됩니다.

### 실행 (개발용)

```bash
npm run dev
```

→ http://localhost:5173 (Vite HMR + Express API 동시 기동)

---

## 조작

| 키 | 동작 |
|---|---|
| `방향키` / `WASD` | 이동 |
| `E` | 동료에게 접선 시도 (연상 단어 확인) |
| `Enter` | 접선 코드 입력 |
| `Space` | 대화창 닫기 |

---

## 개발자용: AI 파이프라인 단독 실행

게임을 띄우지 않고 **연상 단어 생성 + 중복 판정**만 터미널에서 확인합니다.
프롬프트 튜닝 시 이 스크립트로 빠르게 반복하세요.

```bash
npm run poc              # 무작위 코드 단어
npm run poc -- 톱니바퀴    # 코드 단어 지정
```

출력: 코드 단어 → 5인의 연상 단어 + 생성 이유 → 중복(체포) 판정 → 소요 시간·토큰 사용량

---

## 구조

```
src/
  client/           Phaser 3 게임 클라이언트 (Vite 번들)
    scenes/         Boot(로딩·스테이지 생성) → Stage(플레이)
    ui/             DOM 오버레이 대화창 (한글 IME·스트리밍 대응)
  server/           Express — API 키 보호 + 게임 상태·정답 보관
    ai/
      client.js     Claude 클라이언트 + 모델 상수
      wordGen.js    연상 단어 5인 일괄 생성 (structured outputs)
      judge.js      중복·유사어 판정 / 정답 판정
      guardrail.js  코드 단어 유출 필터 + 단어 정규화
    session.js      인메모리 세션 (코드 단어는 여기에만 존재)
    routes/stage.js POST /start, POST /guess
  data/             코드 단어 풀, NPC 페르소나 (서버 전용)
scripts/
  poc-wordgen.js    AI 파이프라인 단독 검증
```

### 모델 사용

| 용도 | 모델 |
|---|---|
| 연상 단어 생성 · 중복/정답 판정 | `claude-sonnet-5` |
| 실시간 NPC 자유 대화 (W2 예정) | `claude-haiku-4-5` |

### 보안 설계

- `ANTHROPIC_API_KEY` 는 **서버에서만** 로드됩니다. Vite 는 `VITE_` 접두사 변수만 번들에 노출하므로 키가 클라이언트로 새지 않습니다.
- **접선 코드는 클라이언트로 전송되지 않습니다.** `src/server/session.js` 에만 보관되고, 정답 판정도 서버(`POST /api/stage/guess`)에서 수행합니다. 개발자도구로 정답을 볼 수 없습니다.
- 코드 단어 풀(`src/data/`)도 서버에서만 읽습니다.

---

## 구현 메모

- **structured outputs**: SDK `@anthropic-ai/sdk@0.71.x` 기준으로 `client.beta.messages.parse({ output_format: betaZodOutputFormat(schema) })` 형태를 씁니다. 이 버전은 최상위 `output_format` 필드를 받으며, `parse()` 가 `structured-outputs-2025-11-13` 베타 헤더를 자동으로 붙입니다. (SDK 소스 확인 결과 — `output_config.format` 은 이 버전의 `parse()` 가 읽지 않습니다.) SDK 업그레이드 시 재확인 필요.
- **zod 는 반드시 v4** 여야 합니다. SDK 의 `betaZodOutputFormat` 이 `z.toJSONSchema()` 를 호출하는데, 이는 zod v4 API 입니다. zod 3.25.x 의 루트 export 는 아직 v3 라 `z.toJSONSchema is not a function` 으로 실패합니다 (SDK peer 범위는 `^3.25.0 || ^4.0.0` 이라 설치 시 경고가 없으니 주의).
- **ESM**: 프로젝트 전체가 `"type": "module"` 입니다. `__dirname` 대신 `fileURLToPath(import.meta.url)` 을 쓰세요.
- **Express 5**: `app.get('*')` 는 path-to-regexp v8 에서 에러가 납니다. SPA 폴백은 `app.use()` 미들웨어로 구현돼 있습니다.

## 설계 근거 (실측)

- **연상 단어는 동료 1인당 1회 독립 호출** 로 생성한다. 5인을 한 번에 생성하면 모델이
  서로를 의식해 단어를 분산시켜 중복이 사라지고, 체포·구출 메커닉 전체가 죽는다.
  독립 생성 시 중복률은 표기 일치 기준 **약 25%** (여기에 LLM 유사어 판정이 더해진다).
  난이도 조정은 `scripts/exp-dup-rate.js` 로 측정하며 진행한다.
- **동시 실행은 3개로 제한** (`wordGen.js` 의 `CONCURRENCY`). 5개를 한꺼번에 쏘면
  529 Overloaded 로 실패하는 것을 실측 확인했다. 3개면 스테이지 시작에 약 11~20초.
- **`thinking: { type: 'disabled' }`** 를 명시한다. Sonnet 5 는 생략 시 adaptive thinking 이
  켜져 있어 지연이 2배가 된다 (33초 → 17초). 연상 단어 생성에는 깊은 추론이 불필요하다.
- **`maxRetries: 5`** (`client.js`). 호출 하나만 실패해도 스테이지 시작이 통째로 실패하므로
  기본값 2보다 넉넉히 잡는다.

## 현재 상태 (W1)

- [x] 프로젝트 셋업 (Phaser + Express + Claude SDK)
- [x] AI 파이프라인: 연상 단어 생성 → 중복 판정 → 정답 판정
- [x] 핵심 루프 스켈레톤: 이동 → 접선 → 코드 입력 → 신뢰도 → 클리어/밀고
- [x] **PoC 검증 완료** — 단어 품질·중복 발생·동의어 유출 차단 확인
- [ ] 게임 실플레이 검증 (`npm run dev`) ← 다음
- [ ] NPC 자유 대화 (Haiku, 스트리밍)
- [ ] 순찰 NPC · 검문 · 구출 미니게임 (W3)
- [ ] 타일맵 · 아트 · 사운드 (W3)
