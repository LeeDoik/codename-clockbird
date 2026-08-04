# PixelLab 프롬프트 — UI 배경 (대화창 · 공용 패널)

지금 게임의 UI 배경은 전부 **CSS 로 그린 것**이다 (`src/client/index.html` 의
`#dialogue` 와 `.sp-panel`). 그림으로 갈아끼우기 위한 작업 지시서다.

인물(`design/NPC/pixellab-prompts.md`)과 **다른 도구를 쓴다.** 인물은 캐릭터
생성기(mannequin·8방향)지만 UI 는 PixelLab 의 **Create UI** 다.

---

## 1. Create UI 는 프롬프트 도구가 아니다

이 도구는 **배치를 도형이 정하고, Description 은 재질만 정한다.**
화면에도 그렇게 적혀 있다 — *"The shapes define the layout; this defines how they look."*

그래서 일반적인 이미지 프롬프트처럼 "네 변 두께를 같게, 모서리에 리벳 4개, 가운데는
비우고…" 를 글로 적으면 안 된다. 그건 캔버스에서 도형으로 잡는다. Description 에는
**재질·색·시대·분위기**만 넣는다.

## 2. 왜 9분할(border-image)인가

대화창은 크기가 고정이 아니다.

| 상태 | 크기 (1920×1080 기준) |
| --- | --- |
| 초상 있음 | 1224 × 340 |
| 초상 없음 (시스템 대사) | 1808 × 240 |
| 자유 대화 (입력창 열림) | 세로로 더 자란다 |

그림 한 장을 통째로 늘리면 **모서리 장식과 테두리 굵기가 같이 찌그러진다.** 그래서
`border-image` 9분할로 쓴다 — 네 모서리는 원본 크기 그대로 두고 네 변만 늘린다.

여기서 따라 나오는 결론 두 개가 이 문서의 나머지를 지배한다.

1. **뽑는 비율이 최종 대화창 비율과 같을 필요가 없다.** 296×224 로 뽑은 액자가 화면에서
1224×340 으로도 1808×240 으로도 왜곡 없이 늘어난다.
2. **그림이 작아도 된다.** `image-rendering: pixelated` 라 확대해도 픽셀이 뭉개지지 않는다.
오히려 크게 뽑으면 테두리가 상대적으로 가늘어져 화면에서 안 보인다.

## 3. Output size — 비율을 고르는 것이지 해상도를 고르는 게 아니다

tier 1 다섯 개는 **총 픽셀 수가 사실상 같다.**

| 옵션 | 총 픽셀 |
| --- | --- |
| 256×256 (square) | 65,536 |
| 296×224 (4:3 landscape) | 66,304 |
| 344×192 (16:9 landscape) | 66,048 |

**→ 296×224 (4:3 landscape) 를 쓴다.**

- 가로형이라 모델이 "대화 상자"로 그린다. 정사각을 주면 아이콘 액자로 그릴 확률이 오른다.
- 16:9 까지 가면 위아래 테두리와 모서리 리벳이 눌려 얇아진다. 그걸 9분할해서 확대하면
실오라기로 보인다.

tier 2(512×512 등)를 쓸 수 있게 되면 **592×448** 이 모서리가 더 또렷해 낫다.

## 4. 도형 배치 (1차 — 대화창 패널)

1. **`Clear`** — 예시 레이아웃(원·툴바·버튼 3개)을 전부 지운다. 버튼을 남기면 그림 안에
버튼이 같이 그려지고 `Inventory` 같은 **라벨 글자까지 박힌다.** 그 자리엔 진짜 대사가 온다.
2. **`+ Panel` 하나만.** `Window` 는 제목 표시줄이 붙는데, 화자명 탭은 별개 CSS 요소라
필요 없다. 게다가 제목 표시줄은 가로 띠라서 세로로 늘리면 깨진다.
3. Panel 을 **296×224, 0,0 — 캔버스에 꽉 차게.** 9분할은 이미지 가장자리에서 잘라내므로
바깥에 투명 여백이 남으면 테두리 대신 빈칸이 늘어난다.
4. **Label 은 비운다** (회색 placeholder 상태 그대로).
5. 모서리 반경 **r8 정도로 작게.** 지금 CSS 가 `border-radius: 6` 이라 r28 처럼 둥글면 튄다.

## 5. Description

게임의 색은 `index.html` 의 `:root` 가 단일 출처다. 박아 둔 hex 는 그 값이다.
화풍 꼬리말은 `design/style-formula.txt` 를 UI 용으로 줄인 것이라 NPC 스프라이트와 한
세트로 보인다.

### A. 대화창 패널 — `#dialogue` (1순위)

```
soot-blackened iron panel frame with weathered bronze corner brackets and a small riveted cogwheel at each corner, rows of dark rivets along the edges, filled with near-black charcoal metal, heavily tarnished and grimy with faint rust streaks, matte not shiny, dim gaslit Victorian steampunk mood, dark palette — charcoal #231f19, dark iron #3a342b, weathered bronze #7a5f1a, with only a thin warm amber #c9a227 accent line, chunky pixel art, limited palette, crisp hard edges, dark warm-brown outlines, plain empty interior, no text, no bright gold
```

⚠ **`plain empty interior, no text` 를 지우지 말 것.** 가운데에 문양이 들어가면 가로로
5배 늘어나면서 뭉개지고, 가짜 글자가 들어가면 진짜 대사와 겹친다.

**한 번 실패한 판을 여기 남긴다.** 처음엔 `polished gold` · `brass` · `dark brown worn
leather` 로 적었는데 **통째로 금색 가죽 액자**가 나왔다. 세 가지가 원인이었다.

1. **금색을 본체로 만들었다.** 원하는 그림은 몸통이 거의 검정에 가까운 숯빛 쇠판이고
따뜻한 금빛은 실선 한 줄과 톱니 몇 개뿐이다. 그래서 지금 문장은 금색을 `only a thin
warm amber accent line` 으로 격하하고 끝에 `no bright gold` 를 박았다.
2. **가죽이 갈색을 끌어올렸다.** `dark brown worn leather` → `near-black charcoal metal`.
3. **톱니가 빠져 있었다.** 스팀펑크로 읽히게 만드는 것은 사실 색이 아니라 네 귀퉁이의
**톱니바퀴와 리벳 브래킷**이다.

색값은 `design/style-formula.txt` 의 환경 팔레트(`#231f19` / `#3a342b`)다 — 맵 타일이
이미 그 색이라 배경과 따로 놀지 않는다.

**모서리 장식은 9분할에 안전하다.** 늘어나는 것은 네 변과 가운데뿐이고 **모서리는 원본
크기 그대로 박힌다** — 장식을 몰아넣기 가장 좋은 자리다. 금지 구역은 변과 가운데다.
거기 톱니가 들어가면 가로로 5배 늘면서 타원으로 뭉개진다.

톱니가 안 나오면 도형 목록의 **`+ Octagon`** 을 Panel 네 귀퉁이에 작게 겹쳐 놓아 본다
(미검증 — 별개의 팔각 버튼으로 그려질 수도 있다). Description 만으로 먼저 돌려 볼 것.

### B. 황동 버튼 — `.dlg-choice` (2순위, 선택)

**따로 돌리고, 그때 `Style reference` 에 A 의 결과 이미지를 올린다.** 두 판을 같은
화풍으로 묶는 장치가 그것뿐이다.

도형은 `+ Button` 2~3개, Label 은 비운다.

```
weathered bronze plate with a warm amber top edge fading to dark tarnished bronze at the bottom, a thin dark iron outline, tiny rivets at the left and right ends, scratched grimy metal, matte not shiny, dim gaslit Victorian steampunk mood, dark palette — amber #c9a227, weathered bronze #7a5f1a, dark iron #3a342b, chunky pixel art, limited palette, crisp hard edges, dark warm-brown outlines, smooth empty surface, no text
```

⚠ **버튼만은 패널만큼 어둡게 하면 안 된다.** 글자가 먹색(`--ink` #1a1712)으로 올라가므로
판이 어두우면 묻힌다. 키 라벨(`[E]`·`[Esc]`)이 안 보이던 문제를 이미 한 번 겪었다 —
`warm amber top edge` 를 지우지 말 것. 패널(거의 검정)과 버튼(청동빛)의 명도 차가
누를 것과 못 누를 것을 가르는 유일한 신호다.

### C. 공용 액자 — `.sp-panel` (3순위, 선택)

단서 수첩·미니게임·결과창 3곳이 같이 쓴다. 대화창보다 장식이 한 단계 화려하다.
배치는 A 와 같고 Description 만 다르다.

```
soot-blackened iron frame with a double border line — dark iron outside, thin warm amber inside — and a large riveted bronze cogwheel in each corner, filled with near-black charcoal metal, heavily tarnished and grimy, matte not shiny, dim gaslit Victorian steampunk mood, dark palette — charcoal #231f19, dark iron #3a342b, weathered bronze #7a5f1a, amber #c9a227 accent only, chunky pixel art, limited palette, crisp hard edges, dark warm-brown outlines, plain empty interior, no text, no bright gold
```

## 6. Style reference 를 쓰는 법

선택 항목이지만 **팔레트를 붙잡는 가장 확실한 수단**이다. 색을 글로 설명하는 것보다
그림 한 장이 훨씬 정확하다 — 위의 "금색 액자" 실패도 이걸 안 쓰고 글로만 밀어서 났다.

- **1차(A)** — 원하는 분위기의 참조 그림을 올린다. 지금 기준은 `참조/` 에 둔 스팀펑크
UI 스크린샷(검정 쇠판 + 모서리 톱니 + 얇은 호박색 실선)이다.
- **2차 이후(B·C)** — 반드시 **A 의 결과 이미지**를 올린다. 안 그러면 판마다 금속 색이
미묘하게 갈라져 한 화면에 놓았을 때 티가 난다.

## 7. 다시 뽑아야 하는 그림

받자마자 이것부터 본다. 하나라도 걸리면 Description 을 고치지 말고 **그대로 다시 굴린다** —
문장을 손대면 세 판의 화풍이 갈라진다.

| 증상 | 왜 못 쓰나 |
| --- | --- |
| 가운데에 문양·엠블럼·톱니가 있다 | 가로로 5배 늘어나면서 뭉개진다 |
| 가짜 글자·줄이 들어가 있다 | 진짜 대사가 그 위에 겹친다 |
| 네 변의 두께가 다르다 | 9분할 값을 하나로 잡을 수 없다 |
| 비스듬한 상자·원근이 있다 | 늘어나면 소실점이 깨진다 |
| 테두리가 너무 가늘다 (2~3px) | 화면에서 확대돼도 실오라기로 보인다 |
| 안쪽 바탕이 밝다 | 그 위의 대사(`--paper` #e8dcc0)가 안 읽힌다 |
| 통째로 금빛이다 | 배경 맵(`#231f19` 계열)과 따로 논다. §5-A 의 실패 기록 참고 |

## 8. 뽑은 뒤

`public/ui/` 에 둔다 (`public/portraits/` 와 같은 방식 — 코드가 `/ui/<파일명>.png` 로 부른다).

붙이는 것은 CSS 한 곳뿐이다. `#dialogue` 의 `background` 를 `border-image` + `url()` 로
바꾼다. **9분할 값(모서리를 몇 px 에서 자를지)은 받은 그림의 테두리 두께를 재서 정한다** —
미리 정할 수 없다. 투명 여백이 남아 있으면 반입할 때 잘라낸다.
