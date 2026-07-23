# 스팀펑크 UI 테마 — 설계

2026-07-23. 기본 디자인(평면 단색 + 맑은 고딕)인 UI 를 세계관(코드네임: 태엽새 —
태엽·시계 수리공·종이 쪽지)에 맞는 스팀펑크로 전환한다. 색 변수(brass/ink/paper)는
이미 스팀펑크 팔레트라 뼈대는 있다 — 부족한 것은 질감·장식·타이포그래피다.

## 이 세션에서 결정한 것

| 항목 | 결정 | 근거 |
|---|---|---|
| 구현 방식 | **CSS/코드만 — 이미지 에셋 없음** | 질감은 CSS 그라디언트·인라인 SVG(feTurbulence)로 충분. 에셋 관리·재생성 비용 0, 배포 단순 |
| 범위 | **전체 UI** — DOM 오버레이(대화창·미니게임·결과) + Phaser 캔버스(HUD·수첩·씬 텍스트) + 페이지 배경/헤더 | 반쪽 적용은 DOM/캔버스가 따로 놀아 오히려 어색 |
| 톤 | **황동·종이·가죽** (빅토리아 서재) | 쪽지·수첩·접선 지령 등 종이 소재 서사와 정합. 산업 기계 톤은 종이 소품과 이질감 |
| 폰트 | **Google Fonts CDN** — Hahmlet(제목)·Gowun Batang(본문) | 시연이 배포 링크 방식(온라인)이라 CDN 허용. 로드 실패 시 맑은 고딕 폴백으로 진행 |
| 구조 | **테마 토큰** — CSS `:root` 확장 + 공용 클래스, 캔버스는 `ui/theme.js` 상수·헬퍼 | `fontFamily` 가 4개 씬 26곳에 산재. 한 곳 수정으로 전체 조정 가능해야 함 |

## 1. 디자인 토큰

**`index.html :root`** (기존 3색 유지·확장):

| 변수 | 값 | 용도 |
|---|---|---|
| `--brass-hi` | `#e8c15a` | 황동 하이라이트 (그라디언트 상단·광택) |
| `--brass` | `#c9a227` | 기존 유지 — 기준 황동 |
| `--brass-lo` | `#7a5f1a` | 황동 음영 (그라디언트 하단·이중 테두리 바깥) |
| `--leather` | `#2c2018` | 가죽 브라운 — 패널 배경 |
| `--ink` | `#1a1712` | 기존 유지 — 페이지 배경·명판 글자 |
| `--paper` | `#e8dcc0` | 기존 유지 — 본문 |
| `--paper-dim` | `#8a7f6a` | 보조 텍스트 (기존 산재값을 변수로 수렴) |
| `--patina` | `#5e8b7e` | 성공 판정 (기존 `#6fae8e` 대체 — 녹청) |
| `--wax` | `#a03325` | 실패 판정 (기존 `#c25b4a` 대체 — 봉랍) |

**`src/client/ui/theme.js`** (신규): 같은 팔레트를 `0x…` 숫자와 문자열로 export.
빌드 파이프라인 없이 인라인 CSS 와 단일 출처를 만들 수 없으므로 **의도적 중복**이며,
양쪽 파일 상단 주석으로 서로가 짝임을 명시한다 (색 바꿀 때 두 곳 함께).

## 2. 타이포그래피

- **Hahmlet** (600·700) — 제목·화자 명판·버튼·HUD 헤더. 활판 인쇄 느낌의 한글 세리프.
- **Gowun Batang** (400·700) — 본문·대화·입력창. 종이 위 명조.
- 폴백 스택: `'Gowun Batang', 'Malgun Gothic', serif` (Hahmlet 도 동일 요령).
- `index.html` 에 `<link rel="preconnect">` + css2 링크, `font-display: swap`.
- **BootScene 이 `document.fonts.load()` 로 두 폰트를 기다린 뒤** 다음 씬으로 넘어간다
  (Phaser 텍스트는 생성 시점 폰트로 래스터되므로, 로드 전에 그리면 고딕으로 굳는다).
  타임아웃 2초 — CDN 이 막혀도 게임은 폴백 폰트로 진행돼야 한다.

## 3. DOM 오버레이 — `index.html` CSS

공용 부품을 만들고 기존 id 스타일이 가져다 쓴다:

- **`.sp-panel`** (황동 프레임 패널) — `#dialogue`·`#minigame-card`·`#result-card` 공용:
  - 가죽 배경(`--leather`) + 이중 테두리: 바깥 `--brass-lo` / 안쪽 `--brass-hi`
    (box-shadow inset 활용, 입체감)
  - 모서리 리벳 4개 — 다중 `radial-gradient` 배경으로 표현 (pseudo-element 불필요)
  - 은은한 종이 노이즈 — 인라인 SVG `feTurbulence` data URI 오버레이 (외부 파일 없음)
- **`.sp-btn`** (황동 버튼) — 세로 금속 그라디언트(`--brass-hi`→`--brass-lo`) + `--ink` 글자,
  hover 시 광택(밝기 상승), active 시 1px 눌림. `#dialogue-send`·`#dialogue-code`·
  `#result-restart`·`.mg-free .mg-btn` 적용. 일반 `.mg-btn`(선택지)은 어두운 바탕 유지하되
  테두리를 황동 계열로.
- **화자 명판** — `#dialogue-speaker` 를 inline-block 황동 플레이트로: 그라디언트 배경 +
  `--ink` 글자 + 미세 text-shadow 로 음각 느낌.
- **게이지** — `#minigame-timer` 를 눈금 있는 계기 띠로: `repeating-linear-gradient` 눈금 +
  황동 fill. 판정색은 `--patina`/`--wax` 로 교체 (`#minigame-verdict`, `.mg-btn.bad`, `.mg-zone`).
- **페이지** — `body` 를 가죽 질감(브라운 + 노이즈 + 비네트 radial-gradient)으로,
  `header` 는 Hahmlet 레터링 + 황동색 + letter-spacing 확대.

동작 로직(JS)은 건드리지 않는다 — DialogueBox·MinigamePanel API 불변.

## 4. Phaser 캔버스 — `src/client/ui/theme.js` (신규)

- `COLORS` (0x 숫자·CSS 문자열), `FONTS = { head, body }` (폴백 스택 포함) export.
- 텍스트 스타일 프리셋: `hudStyle()`·`bodyStyle()`·`titleStyle()` 등 — 4개 씬 26곳의
  `fontFamily: 'Malgun Gothic…'` 인라인 스타일을 프리셋 호출로 교체.
- `drawOrnateFrame(scene, x, y, w, h)` 헬퍼 — Graphics 로 이중 황동 선 + 모서리 장식.
  `#buildCluePanel` 의 단색 사각형을 이 프레임 + 가죽/종이 배경으로 교체.
- 캔버스에는 노이즈 질감을 넣지 않는다 — 프레임·색·폰트로만 통일감을 낸다.

## 5. 검증

- 서버 기동 후 상태별 스크린샷: 시작 쪽지 → 대화창(입력 모드) → 단서 수첩 →
  자물쇠·검문 미니게임 → 결과 화면. 인트로·튜토리얼 씬도 1컷씩.
- 기존 스모크 테스트 통과 (UI 만 변경이지만 회귀 확인).
- 폰트 CDN 차단 시나리오: 폴백 폰트로 게임 진행 가능해야 함 (BootScene 타임아웃 동작).

## 6. 알려진 한계 (허용)

- CSS 질감은 이미지 에셋 대비 품질 상한이 있다 — 부족하면 nine-slice 생성 에셋이
  다음 레버 (이번 범위 아님).
- 캔버스 쪽은 DOM 과 완전히 같은 질감이 아니다 (노이즈 없음) — 색·프레임·폰트 통일로 갈음.
- 고딕 → 명조 전환은 가독성 인상이 달라진다. 시연 피드백에 따라 본문만 고딕으로
  되돌릴 수 있게 폰트는 토큰 한 곳에서만 지정한다.
