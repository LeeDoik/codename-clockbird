/**
 * UI 부품 표 — 코드네임: 태엽새
 *
 * 검문 조우 무대(수류탄 투척) · 단서 수첩([C]) · 씬 전환 로딩 화면.
 *
 * 굽는 쪽(gen-ui-assets.js)과 반입하는 쪽(import-ui-assets.js)이 같이 본다.
 * 두 군데 적으면 반드시 갈라지므로 여기가 단일 출처다 — `opaque` 는 반입 쪽만
 * 쓰지만 "이 부품이 무엇인가"의 일부라 표에 같이 산다.
 *
 * 프롬프트를 고치는 규칙: 결과가 마음에 안 들면 **문장을 손대기 전에 그대로 다시
 * 굴려 본다.** 문장을 고치면 그 부품만 화풍이 갈라져, 한 화면에 같이 놓았을 때
 * 그 하나만 튄다. 고칠 때는 왜 고쳤는지 주석으로 남긴다 — 아래 needle 처럼.
 */

/**
 * 게임 색 — index.html 의 `:root` 가 단일 출처다.
 *
 * 뒤의 다섯은 `:root` 에 짝이 없다. 무대에만 있는 색이라 grenadeThrow 용 CSS
 * (index.html 의 `.gr-cell.on` · `.gr-zone` · `.gr-track`)에서 가져왔다.
 */
export const C = {
  ink: '#1a1712', charcoal: '#231f19', leather: '#2c2018', iron: '#3a342b',
  brassLo: '#7a5f1a', brass: '#c9a227', brassHi: '#e8c15a',
  paperDim: '#8a7f6a', paper: '#e8dcc0',
  // 종이의 밝은 쪽·어두운 쪽. `:root` 에는 없고 index.html 의 #cluebook-card
  // 그라디언트에 박혀 있던 값이다 — 종이 부품이 그 종이와 같은 색이어야 한다.
  paperHi: '#f2e8ce', paperLo: '#d5c69f',
  patina: '#5e8b7e', wax: '#a03325',
  ember: '#c2451a', emberHi: '#ff8a3c',
  trackRed: '#6d1f14', zoneGreen: '#57c04a', spark: '#4aa8ff',
};

/**
 * 팔레트 묶음 — 부품마다 **줄 색만** 준다.
 *
 * ⚠ 안 쓸 색을 끼워 넣으면 반드시 샌다. 청동 트랙에 녹청(#5e8b7e)을 같이 줬더니
 *   금속에 청록 얼룩이 앉았고 같은 판에서 청동이 금빛으로 떴다. 팔레트는
 *   "이 색도 괜찮다"가 아니라 "이 색들로만 그려라"에 가깝게 작동한다.
 */
export const PALETTES = {
  // 금속 부품 — 초록·파랑·빨강이 없다. 있으면 청동이 그리로 끌려간다.
  metal: [C.ink, C.charcoal, C.leather, C.iron, C.brassLo, C.brass, C.brassHi, C.paperDim],
  // 자기력 — 잉걸빛만. 청동은 칸을 두르는 테두리 몫으로 남긴다.
  ember: [C.ink, C.charcoal, C.iron, C.brassLo, C.ember, C.emberHi, C.paper],
  // 번개 — 파랑만. 따뜻한 색을 주면 번개가 주황으로 나온다.
  spark: [C.ink, C.charcoal, C.spark, C.paper, C.paperDim],
  // 경고·실패 — 봉랍 빨강.
  alarm: [C.ink, C.charcoal, C.iron, C.wax, C.trackRed, C.paper, C.paperDim],
  // 종이 — 크림색 세 단계 + 얼룩질 갈색. 청동은 집게 하나 몫이고, 봉랍은 도장 몫이다.
  paper: [C.ink, C.leather, C.paperDim, C.paper, C.paperHi, C.paperLo, C.brassLo, C.wax],
  // 녹청 — 성공 도장 하나가 쓴다. 게임이 성공을 이 색으로 말하기 때문이다
  // (index.html 의 `#minigame-verdict.ok`). 황동을 빼야 놋쇠로 안 끌려간다.
  verdigris: [C.ink, C.charcoal, C.iron, C.patina, C.paperDim, C.paper],
  // 장면·인물 — 전부 쓴다. 여기서만 색이 넉넉해야 그림이 산다.
  scene: Object.values(C),
  // 문항 램프 — 같은 놋쇠 링에 렌즈 색만 갈린다. 링 몫의 놋쇠(brassLo·brass)를
  // 셋 다 같이 주지 않으면 램프마다 다른 물건으로 나온다 (verdigris 팔레트만
  // 쓰면 링이 쇳빛으로 식는다). 렌즈 색은 각자 한 계열만 — 섞으면 샌다.
  lampOk: [C.ink, C.charcoal, C.iron, C.brassLo, C.brass, C.patina, C.paper],
  lampWarn: [C.ink, C.charcoal, C.iron, C.brassLo, C.brass, C.ember, C.emberHi, C.paper],
  lampBad: [C.ink, C.charcoal, C.iron, C.brassLo, C.brass, C.wax, C.trackRed, C.paper],
};

/**
 * 모든 프롬프트가 공유하는 금속 꼬리말.
 * design/style-formula.txt 를 UI 용으로 줄인 것이다.
 */
const METAL = [
  'dark palette — charcoal, dark iron, weathered bronze',
  'heavily tarnished and grimy, matte not shiny',
  'dim gaslit Victorian steampunk mood',
  'chunky pixel art, limited palette, crisp hard edges, dark warm-brown outlines',
].join(', ');

/**
 * 액자가 절대 가지면 안 되는 것들.
 *
 * ⚠ 지우지 말 것. design/UI/pixellab-ui-prompts.md §7 의 재작업 표가 그대로 여기
 * 들어와 있다 — 가운데 문양은 가로로 5배 늘면서 뭉개지고, 가짜 글자는 진짜 대사와
 * 겹치고, 비스듬한 상자는 늘리면 소실점이 깨진다.
 */
const NO_FRAME = [
  'text, letters, numbers, glyphs',
  'emblem or ornament in the center',
  'tilted box, perspective, isometric, 3d',
  'bright gold, polished, shiny, glossy',
  'drop shadow, blurry, anti-aliased',
].join(', ');

/**
 * 부품 목록.
 *
 * `slice` — CSS `border-image` 에 넣을 값. 굽기 전에는 짐작일 뿐이고, 받은 뒤
 *   **8배 확대본에 격자를 얹어 눈으로 재서** 확정한다. 아래 값들은 2026-08-05 판을
 *   그렇게 잰 것이다 (변마다 다르면 `상하 좌우` 두 값).
 *
 *   ⚠ 자동으로 재려다 접었다. 액자가 `hollow empty center` 로 안 나오고 **속이
 *     불투명한 판으로 차서** 오는 데다, 그 판의 어두운 색이 테두리의 어두운 부분과
 *     색으로 안 갈린다. 투명을 찾는 방법도 색을 맞추는 방법도 엉뚱한 숫자를 냈다.
 *     틀린 숫자를 자신 있게 내놓는 도구는 없느니만 못하다.
 * `fill` — 9분할에 `fill` 을 붙일 부품. 판이 곧 배경인 것들이다.
 * `opaque` — 반입할 때 **배경을 벗기지 않는다.** 판 전체가 그림인 것.
 */
export const ASSETS = [
  // ── 액자류 (9분할) ──────────────────────────────────────────────
  //
  // 액자는 전부 `no_background: true` 다. 처음엔 안 줬는데, 그러면 모델이 액자
  // 둘레에 불투명한 회갈색 판을 깔아 놓는다. 그걸 반입할 때 flood fill 로 벗기려
  // 했더니 **gauge-frame 이 통째로 날아갔다** — 하우징의 검은 쇠 색이 그 배경색과
  // 거의 같아서, 배경에서 출발한 번짐이 몸통까지 먹고 뼈대만 남겼다.
  // 벗기는 것보다 처음부터 안 그리게 하는 쪽이 안전하다.
  {
    id: 'stage-frame',
    label: '무대 액자 — 제목·시계·경고 띠가 같이 쓴다',
    palette: 'metal',
    // 296×224 는 pixellab-ui-prompts.md §3 이 고른 비율이다. 가로형이라 모델이
    // "대화 상자"로 그리고, 16:9 까지 가면 위아래 변이 눌려 실오라기가 된다.
    size: { width: 296, height: 224 },
    slice: 36, // 실측: 모서리 브래킷 36px, 네 변의 레일 두께도 같다
    target: '#minigame-card.stage 의 head / timer / hint 세 칸',
    description:
      'a rectangular soot-blackened iron panel border, symmetrical on all four sides, ' +
      'a riveted bronze corner bracket with a small cogwheel in each of the four corners, ' +
      'rows of evenly spaced dark rivets along all four rails, a thin warm amber pinstripe just inside ' +
      'the edge, hollow empty center, ' + METAL,
    negative: NO_FRAME + ', asymmetric, cogwheel on one side only, open frame, missing edge',
    opts: { detail: 'medium detail', shading: 'detailed shading', outline: 'single color outline', view: 'side', no_background: true },
  },
  {
    id: 'track-frame',
    label: '가로 타이밍 트랙 액자 — 양끝 청동 캡',
    palette: 'metal',
    size: { width: 320, height: 72 },
    slice: '9 17', // 실측: 위아래 레일 9px, 양끝 청동 캡 17px
    target: '.gr-track (안쪽 빨강/초록은 CSS 가 그린다)',
    description:
      'a long horizontal metal gauge housing seen flat from the side, hollow empty channel running ' +
      'through the middle, a flat beveled bronze end cap at the left end and a mirrored one at the right end ' +
      'each with two rivets, thin dark iron rails along the top and bottom of the channel, ' + METAL,
    negative: NO_FRAME + ', filled bar, colored fill, red, green, progress bar, bulbous, rounded barrel, pipe',
    opts: { detail: 'medium detail', shading: 'detailed shading', outline: 'single color outline', view: 'side', no_background: true },
  },
  {
    id: 'gauge-frame',
    label: '세로 충전 게이지 액자',
    palette: 'metal',
    size: { width: 88, height: 264 },
    slice: '16 7', // 실측: 위아래 쇠 캡 16px, 좌우 레일 7px
    target: '.gr-gauge (칸은 CSS 가 그린다)',
    description:
      'a tall narrow vertical metal gauge housing seen flat from the side, hollow empty channel running ' +
      'through the middle, a flat beveled iron cap at the top and a mirrored one at the bottom each with ' +
      'a single rivet, a rivet on the left and right rails at mid height, ' + METAL,
    negative: NO_FRAME + ', filled bar, colored fill, orange, glow, lightning, bulbous, pipe',
    opts: { detail: 'medium detail', shading: 'detailed shading', outline: 'single color outline', view: 'side', no_background: true },
  },
  {
    id: 'space-plate',
    label: 'SPACE 사각 버튼 판 — 투척 단계',
    palette: 'metal',
    size: { width: 160, height: 56 },
    slice: 14,
    fill: true, // 판이 곧 배경이다 — 빼면 버튼이 뚫려 보인다 (button.png 와 같은 이유)
    target: '.throwing .gr-space',
    description:
      'a weathered bronze rectangular button plate seen flat from the front, warm amber along the top edge ' +
      'fading to dark tarnished bronze at the bottom, a thin dark iron outline, tiny rivets at the left and ' +
      'right ends, smooth empty surface, scratched grimy metal, ' + METAL,
    negative: NO_FRAME.replace('bright gold, polished, shiny, glossy, ', '') + ', hollow, transparent center, engraving',
    opts: { detail: 'medium detail', shading: 'detailed shading', outline: 'single color outline', view: 'side', no_background: true },
  },
  {
    id: 'screen-frame',
    label: '화면 테두리 — 게임 화면 전체를 가두는 기계 베젤',
    palette: 'metal',
    size: { width: 296, height: 224 },
    slice: 26, // 실측: 모서리 볼트판 26px (레일 두께도 거의 같다)
    target: '#game-root 전체 (지금은 1px 황동 실선)',
    // ⚠ 이것은 게임 **바깥**을 두르는 테두리다. 다른 액자들과 요구가 반대다 —
    //   저것들은 그 안의 글자를 돋보이게 하려고 장식을 얹지만, 이건 화면 전체를
    //   두르므로 **눈에 안 띄어야 한다.** 화려하면 매 순간 게임과 경쟁한다.
    //
    //   1차는 밝은 금색 실선에 모서리 문양이 들어간 판이 나왔다. 문양은 확대하면
    //   뭉개진 얼룩이었고(모델이 작은 칸에 무늬를 넣으면 늘 그렇다), 금색은 맵보다
    //   밝아서 시선이 테두리로 갔다. 이번엔 두껍고 어두운 쇠판에 볼트만 박는다.
    description:
      'a thick soot-blackened iron bezel framing a rectangular viewport, symmetrical on all four sides, ' +
      'a plain flat iron plate with a square bolt plate in each of the four corners each holding one ' +
      'large hex bolt, a single thin warm amber pinstripe running along the inner edge of the opening, ' +
      'plain unadorned metal along the four rails, very dark and matte, hollow empty center, ' + METAL,
    negative: NO_FRAME + ', cogwheel, gear, ornate, emblem, crest, badge, engraving, pattern, ' +
      'filigree, bright, glowing, gold, brass rails, thin frame, hairline',
    opts: { detail: 'low detail', shading: 'basic shading', outline: 'single color outline', view: 'side', no_background: true },
  },

  // ── 부품 스프라이트 ────────────────────────────────────────────
  {
    id: 'space-medallion',
    label: 'SPACE 원형 톱니 메달 — 충전 단계 연타 버튼',
    palette: 'metal',
    size: { width: 160, height: 160 },
    target: '.gr-space (충전 단계). 가운데 어두운 원반 위에 SPACE 글자가 CSS 로 올라간다',
    description:
      'a circular brass medallion button seen straight on, an outer ring of chunky cogwheel teeth, ' +
      'an inner ring of small screws, a flat dark near-black charcoal disc in the very center, ' +
      'a faint warm amber rim light around the inner disc, ' + METAL,
    negative: NO_FRAME + ', square, rectangular, hollow center, bright center',
    opts: { detail: 'highly detailed', shading: 'detailed shading', outline: 'single color outline', no_background: true, view: 'side' },
  },
  {
    id: 'needle',
    label: '손잡이 추 — 트랙 위를 왕복한다',
    palette: 'metal',
    // ⚠ 세 번 헛디딘 자리다. 셋 다 그럴듯한 수였기에 남겨 둔다.
    //   1차 48×104 — 좁고 긴 캔버스는 그 자체가 "가느다란 물건"이라는 지시로 읽힌다.
    //      정말 실오라기 같은 막대만 나와 트랙 위에서 안 보였다.
    //   2차 coverage_percentage:90 + "chunky/thick/heavy" — 프레임은 채웠는데 **형태가
    //      뭉개져** 덩어리가 됐다. 덩어리를 키우라는 지시가 톱니·가로대·팔각추라는
    //      구조를 이겼다. 형태가 단순한 물건에 쓸 손잡이가 아니다.
    //   3차 view 를 안 준 채 "세 토막" — 모델이 3/4 시점 입체로 그려 **괘종시계 탑**이
    //      나왔다. 작은 UI 부품은 반드시 view:'side' 로 눕히고 원근을 negative 로 막는다.
    size: { width: 64, height: 112 },
    target: '.gr-needle',
    description:
      'a flat brass slider handle icon for a game interface, drawn straight on with no perspective, ' +
      'made of three parts stacked vertically: a small cogwheel at the top, a straight vertical bar with ' +
      'a short horizontal crossbar in the middle, and an octagonal brass plate at the bottom with ' +
      'a rivet on each side, simple flat mechanical shape, ' + METAL,
    negative: NO_FRAME + ', tower, building, statue, lamppost, clock tower, thick base, pedestal, ' +
      'hairline, wire, rope, chain, blob, lump, melted, organic, creature, background',
    opts: { detail: 'medium detail', shading: 'basic shading', outline: 'single color outline', no_background: true, view: 'side' },
  },
  {
    id: 'clock-face',
    label: '시계 문자판 — 남은 시간 액자 왼쪽',
    palette: 'metal',
    size: { width: 56, height: 56 },
    target: '#minigame-card.stage #minigame-timer::before (지금은 CSS 원반)',
    description:
      'a round brass clock face seen straight on, dark near-black dial, a thin weathered bronze bezel ring, ' +
      'two plain pale hands pointing up and to the right, no numbers on the dial, ' + METAL,
    negative: NO_FRAME + ', numerals, digits, roman numerals, background',
    opts: { detail: 'medium detail', shading: 'detailed shading', outline: 'single color outline', no_background: true, view: 'side' },
  },
  {
    id: 'gauge-cell',
    label: '충전된 게이지 칸 — 자기력이 도는 주황빛',
    palette: 'ember',
    size: { width: 64, height: 48 },
    slice: 8,
    fill: true,
    target: '.gr-cell.on',
    description:
      'a glowing hot orange metal plate seen straight on, bright molten orange fading to deep ember red ' +
      'at the bottom, framed by a thin dark bronze bar at the top and bottom edge, a single rivet centered ' +
      'on the top bar, chunky pixel art, limited palette, crisp hard edges, dark warm-brown outlines, matte',
    negative: 'text, letters, perspective, tilted, 3d, blurry, anti-aliased, drop shadow, lightning, sparks',
    opts: { detail: 'medium detail', shading: 'basic shading', outline: 'single color outline', view: 'side', no_background: true },
  },
  {
    id: 'lightning',
    label: '번개 — 게이지 양옆에 감기는 자기력 연출',
    palette: 'spark',
    size: { width: 96, height: 240 },
    target: '.gr-gauge 좌우에 겹쳐 깜빡인다 (CSS 애니메이션)',
    // ⚠ 1차는 번개가 **크림색**으로 나왔다. spark 팔레트에 종이색(#e8dcc0)이 들어
    //   있어서 그리로 붙었다 — 파란 번개를 원하면 따뜻한 밝은 색을 아예 빼야 한다.
    description:
      'two vertical crackling electric lightning arcs on a plain empty background, bright pale blue core ' +
      'with a deeper blue outer glow, jagged forked branches, nothing else in the image, ' +
      'chunky pixel art, limited palette, crisp hard edges',
    negative: 'metal, machine, frame, gauge, text, ground, sky, character, orange, warm colors, brown, ' +
      'white, cream, beige, yellow',
    opts: { detail: 'medium detail', shading: 'flat shading', outline: 'lineless', no_background: true, view: 'side' },
  },
  {
    id: 'warn-triangle',
    label: '경고 삼각형 — 경고 띠 왼쪽',
    palette: 'alarm',
    size: { width: 56, height: 56 },
    target: '#minigame-card.stage #minigame-hint 왼쪽 (지금은 ⚠ 글자)',
    description:
      'a warning triangle sign seen straight on, deep sealing-wax red fill with a darker red border and ' +
      'a thick pale exclamation mark in the middle, rounded corners, matte, ' +
      'chunky pixel art, limited palette, crisp hard edges, dark warm-brown outlines',
    negative: 'text, letters, words, yellow, bright, glossy, background, drop shadow, 3d',
    opts: { detail: 'medium detail', shading: 'basic shading', outline: 'single color outline', no_background: true, view: 'side' },
  },

  // ── 판정 연출 (목업에 없다 — 지금 게임에서 비어 있는 자리다) ──
  //
  // 목업은 판이 도는 동안만 보여 주고 끝난다. 실제로는 finish(true/false) 뒤
  // 800ms 동안 "성공"/"실패" 글자만 뜨는데(MinigamePanel.run), 12초를 긴장하며
  // 두들긴 끝이 글자 두 자라 손맛이 거기서 끊긴다. 그 800ms 를 채울 그림이다.
  {
    id: 'hit-burst',
    label: '명중 — 로봇에 수류탄이 붙어 터지는 순간',
    palette: 'ember',
    size: { width: 200, height: 200 },
    target: '.gr-stage 오른쪽, finish(true) 순간 한 번 (신규)',
    description:
      'a single explosion burst on a plain empty background, a white-hot core with jagged orange and ' +
      'ember red flame tongues radiating outward, flying bronze shrapnel chips and sparks, ' +
      'chunky pixel art, limited palette, crisp hard edges, dark warm-brown outlines',
    negative: 'text, ui, frame, border, smoke cloud only, ground, building, character, robot, soft glow, blurry, 3d',
    opts: { detail: 'highly detailed', shading: 'basic shading', outline: 'single color outline', no_background: true, view: 'side' },
  },
  {
    id: 'fizzle',
    label: '빗나감 — 수류탄이 바닥에서 헛돌며 꺼진다',
    palette: 'metal',
    size: { width: 200, height: 200 },
    target: '.gr-stage 가운데 아래, finish(false) 순간 한 번 (신규)',
    description:
      'a dud brass grenade lying on cobblestones venting a thin puff of grey smoke and a few weak sparks, ' +
      'seen from the side, small and pathetic, dull and lifeless, ' + METAL,
    negative: 'text, ui, frame, border, explosion, fire, big flames, bright, character, background scenery, 3d',
    opts: { detail: 'medium detail', shading: 'basic shading', outline: 'single color outline', no_background: true, view: 'side' },
  },

  // ── 단서 수첩 ([C], 스테이지 1) ────────────────────────────────
  //
  // 지금 종이는 CSS 다 — 크림색 그라디언트 + clip-path 로 오려낸 찢긴 가장자리 +
  // feTurbulence 로 만든 구김 그늘(`--crumple`). 셋을 합쳐도 **결이 없다.**
  // 그라디언트는 매끈하고 난류는 얼룩이라, 종이라기보다 색칠한 판에 가깝다.
  //
  // 그림 한 장이 그 셋을 다 대신한다: 섬유 결·접힌 골·얼룩·찢긴 가장자리가
  // 한 장에 같이 그려져 있고, 서로 어긋날 일이 없다 (지금은 clip-path 의 찢긴 선과
  // 난류 얼룩이 따로 놀아서 가장자리에서 무늬가 뚝 끊긴다).
  {
    id: 'clue-paper',
    label: '단서 쪽지 — 구겨졌다 편 종이 한 장',
    palette: 'paper',
    // #cluebook-card 가 760×560 이다. 같은 비율(1.357)로 잡아야 늘릴 때 안 찌그러진다.
    size: { width: 320, height: 236 },
    target: '#cluebook-card 의 background (그라디언트 + clip-path + ::before 구김을 대신한다)',
    // ⚠ 두 번 헛디뎠다.
    //   1차 — 찢긴 가장자리는 훌륭했는데 **속이 텅 빈 크림색 판**이었다. 접힌 골도
    //      얼룩도 없었다. `basic shading` + `lineless` 가 표면을 눌러 버린 탓이다.
    //      종이의 값어치는 가장자리가 아니라 **표면의 사연**에 있으므로, 골을
    //      "선"으로 못박고(모델은 음영보다 선을 잘 그린다) 음영을 올렸다.
    //   2차 — 골은 나왔는데 **컷아웃이 종이를 통째로 먹었다**(97%). 재 보니
    //      배경색이 종이 하이라이트와 **글자 그대로 같은 값**(#f2e8ce)이었다.
    //      `no_background: true` 를 줘도 모델이 팔레트에서 밝은 크림을 골라 배경에
    //      깔아 버린 것이다. 어떤 허용 오차로도 못 가른다.
    //      → **검은 배경을 시켜서 판다.** 팔레트에 이미 먹(#1a1712)이 있으므로
    //        문장 한 줄로 배경을 그쪽으로 몰면 컷아웃이 깨끗이 갈라낸다.
    description:
      'a single sheet of aged cream paper lying flat on a plain solid pure black background, ' +
      'seen straight on from above, ' +
      'torn ragged edges all the way around, the surface broken up by several deep fold creases at ' +
      'irregular off-centre positions — two uneven vertical creases well away from the middle and one ' +
      'horizontal crease low on the sheet, each crease drawn as a distinct darker line with a band of ' +
      'shadow along one side, ' +
      'scattered brown coffee stain rings and blotchy foxing spots, dirty smudges in the corners, ' +
      'visible paper fibre grain, blank with nothing written on it, ' +
      'chunky pixel art, limited palette, crisp hard edges',
    negative: 'text, letters, handwriting, writing, ruled lines, lined paper, notebook, book, binding, ' +
      'frame, border, metal, table, desk, drop shadow, perspective, tilted, 3d, curled, rolled, ' +
      'clean, pristine, flat empty surface, plain, cream background, light background, ' +
      // ⚠ 정중앙 세로 골 하나만 나오면 **펼친 책**으로 읽힌다. 쪽지여야 한다.
      'open book, spine, centre fold, symmetrical, single fold, two pages, gutter',
    opts: { detail: 'highly detailed', shading: 'detailed shading', outline: 'selective outline', no_background: true, view: 'high top-down' },
  },
  {
    id: 'clue-clip',
    label: '놋쇠 집게 — 쪽지 위에 물려 있다',
    palette: 'paper',
    size: { width: 72, height: 96 },
    target: '#cluebook-card 좌상단에 얹는다 (신규)',
    // ⚠ 1차는 **철사 클립**이 나왔다 (실측 33×85 의 실오라기). 화면에서는 종이 위에
    //   그은 금 한 줄로 보인다. "paper clip" 이라는 낱말 자체가 가느다란 물건을
    //   부른다 — 'binder clip' 으로 갈아타고 두께를 못박았다.
    description:
      'a single chunky brass binder clip seen straight on from the front, a solid triangular clamp ' +
      'body of thick tarnished brass with two round lever loops sticking up from its top corners, ' +
      'heavy and blocky, thick solid metal, ' +
      'chunky pixel art, limited palette, crisp hard edges, dark warm-brown outlines',
    negative: 'text, paper, sheet, document, frame, border, background, shadow, perspective, 3d, ' +
      'bright gold, shiny, glossy, many clips, thin, wire, hairline, slender, oval loop, safety pin',
    opts: { detail: 'medium detail', shading: 'detailed shading', outline: 'single color outline', no_background: true, view: 'side' },
  },

  // ── 감옥 퍼즐 · 공용 패널 ──────────────────────────────────────
  //
  // 카드 액자는 **새로 안 굽는다.** 감옥 퍼즐과 결과창은 둘 다 `.sp-panel` 을 쓰므로
  // 거기에 stage-frame 을 걸면 두 화면이 한 번에 바뀐다. 남는 것은 그 안의 버튼이다.
  {
    id: 'key-plate',
    label: '감옥 퍼즐 버튼 판 — 숫자·기호 키',
    palette: 'metal',
    size: { width: 128, height: 64 },
    slice: 14,
    fill: true, // 판이 곧 배경이다 — 빼면 숫자가 허공에 뜬다
    target: '.mg-btn (지금은 검은 네모)',
    description:
      'a small square brass keypad key seen flat from the front, a raised bevelled edge catching a warm ' +
      'amber highlight along the top and a dark shadow along the bottom, a flat dark charcoal face in the ' +
      'middle for a number to sit on, a tiny rivet in each corner, scratched grimy metal, ' + METAL,
    negative: NO_FRAME + ', hollow, transparent center, engraving, symbol, keyboard, many keys, round',
    opts: { detail: 'medium detail', shading: 'detailed shading', outline: 'single color outline', view: 'side', no_background: true },
  },

  // ── 감옥 퍼즐 세 유형 (2026-08-05 기획 목업) ───────────────────
  //
  // lockPuzzle.js 의 세 유형에 각각 얼굴을 준다. **게임 방식은 하나도 안 건드린다** —
  // 배선 잇기는 여전히 기호→번호이고, 눈금 조정은 여전히 여섯 개를 순서대로,
  // 압력 맞추기는 여전히 다섯 중 둘을 골라 합을 맞춘다. 바뀌는 것은 그 단추가
  // 무엇으로 보이느냐뿐이다.
  //
  // ⚠ 목업은 밸브 4개·기어 4개로 그려져 있지만 코드는 6개·5개를 낸다. 그림 수에
  //   맞추려면 규칙을 고쳐야 하므로 **코드 쪽 수를 따른다.**
  //
  // ⚠ 이 다섯만 Pro(v2)다. 목업이 요구하는 것이 "금속 부품 한 점"이라 표준 모델의
  //   200~400px 로는 계기 눈금과 리벳이 뭉갠다. 대신 Pro 는 negative 도 팔레트도
  //   안 받으므로 금지 사항을 전부 문장 안에 적었다 (gen-ui-assets.js 의 generatePro 참고).
  {
    id: 'wire-port',
    label: '전선 포트 — 기호 단자 (배선 잇기 왼쪽)',
    model: 'pro',
    size: { width: 256, height: 256 },
    target: '[data-puzzle="wiring"] .lp-left .mg-btn',
    description:
      'a round brass steampunk cable port seen straight on from the front, a heavy riveted bronze ring ' +
      'with small bolts spaced around it, a flat pale bone-white disc in the very centre left completely ' +
      'blank for a symbol to be printed on later, a short pipe collar at the bottom edge, ' +
      'weathered tarnished brass, soot and grime in the crevices, matte not shiny, ' +
      'dim gaslit Victorian steampunk, chunky pixel art, limited palette, crisp hard edges, ' +
      'dark warm-brown outlines, no text, no letters, no numbers, no symbol in the centre, ' +
      'nothing behind it, plain empty background',
    opts: { no_background: true },
  },
  {
    id: 'wire-terminal',
    label: '전선 단자 — 번호 단자 (배선 잇기 오른쪽)',
    model: 'pro',
    size: { width: 256, height: 224 },
    target: '[data-puzzle="wiring"] .lp-right .mg-btn',
    // 왼쪽은 원, 오른쪽은 사각이다. 모양이 갈려야 "무엇을 무엇에 잇는가"가 눈에 보인다.
    description:
      'a square brass steampunk terminal plate seen straight on from the front, a heavy riveted bronze ' +
      'bracket frame around a flat dark slate panel, one bolt in each of the four corners, ' +
      'a short pipe collar entering from the left edge, weathered tarnished brass, soot and grime, ' +
      'matte not shiny, dim gaslit Victorian steampunk, chunky pixel art, limited palette, ' +
      'crisp hard edges, dark warm-brown outlines, no text, no letters, no numbers, ' +
      'the centre panel completely blank, nothing behind it, plain empty background',
    opts: { no_background: true },
  },
  {
    id: 'valve-stack',
    label: '압력 밸브 한 벌 — 계기 + 몸통 + 손잡이 바퀴 (눈금 조정)',
    model: 'pro',
    // 세로로 긴 부품이다. 계기가 위, 바퀴가 아래 — 목업의 배치 그대로다.
    size: { width: 224, height: 384 },
    // ⚠ 다이얼에 **바늘이 그려져 나온다.** 아래 문장에 `no markings on the dial` 을
    //   넣어도 그린다 — 계기라는 물건 자체가 바늘을 부르는 형태다. 그런데 그 자리에
    //   압력 값을 얹어야 해서 바늘이 숫자를 가로지른다. 다시 굴려도 또 그릴 공산이
    //   크므로 반입할 때 지운다 (import-ui-assets.js 의 clearDial).
    retouch: 'clearDial',
    target: '.lp-valve (감옥 퍼즐 · 압력 밸브)',
    description:
      'a tall steampunk pressure valve assembly seen straight on from the front, at the top a round brass ' +
      'pressure gauge with a pale cream dial face left completely blank, below it a riveted iron valve body ' +
      'with pipes and bolts, at the bottom a large spoked iron valve handwheel with a red-brown rim, ' +
      'weathered tarnished brass and dark iron, soot and grime, matte not shiny, ' +
      'dim gaslit Victorian steampunk, chunky pixel art, limited palette, crisp hard edges, ' +
      'dark warm-brown outlines, no text, no letters, no numbers, no markings on the dial, ' +
      'nothing behind it, plain empty background',
    opts: { no_background: true },
  },
  {
    id: 'gear-dial',
    label: '숫자 톱니바퀴 (기어비 계산)',
    model: 'pro',
    size: { width: 256, height: 256 },
    target: '[data-puzzle="pressure"] .mg-btn',
    description:
      'a single brass steampunk gear seen straight on from the front, chunky square teeth sticking outward ' +
      'from the rim all the way around, a ring of small bolts inside the rim, a flat dark slate disc in the ' +
      'very centre left completely blank for a number to be printed on later, ' +
      'weathered tarnished brass, soot and grime in the crevices, matte not shiny, ' +
      'dim gaslit Victorian steampunk, chunky pixel art, limited palette, crisp hard edges, ' +
      'dark warm-brown outlines, no text, no letters, no numbers in the centre, ' +
      'nothing behind it, plain empty background',
    opts: { no_background: true },
  },
  {
    id: 'puzzle-board',
    label: '퍼즐 안쪽 배경판 — 세 유형이 같이 쓴다',
    model: 'pro',
    // 목업 셋 모두 부품이 어두운 철판 위에 얹혀 있다. 그 판이 없으면 단추들이
    // 액자 속 허공에 떠 있다.
    size: { width: 384, height: 256 },
    target: '#minigame-content (감옥 퍼즐일 때만)',
    description:
      'a flat dark iron machine panel seen straight on from the front, a large plain riveted steel plate ' +
      'with a faint blueprint grid of thin blue lines etched across it, rows of small rivets along the ' +
      'edges, patches of rust and verdigris, scratched and grimy, very dark so that bright parts placed on ' +
      'top of it stand out, matte not shiny, dim gaslit Victorian steampunk, chunky pixel art, ' +
      'limited palette, crisp hard edges, no text, no letters, no numbers, no machinery, no gauges, ' +
      'nothing on the plate, empty flat surface',
    opts: {},
  },

  // ── HUD ────────────────────────────────────────────────────────
  {
    id: 'hud-plate',
    label: 'HUD 명판 — 상태·조작 안내·방 이름이 같이 쓴다',
    palette: 'metal',
    size: { width: 200, height: 72 },
    slice: 16,
    fill: true,
    target: '#hud-status · #hud-keys · #hud-room (지금은 액자 없는 맨 글자)',
    // ⚠ 이 판은 **맵 위에 얹힌다.** 액자류처럼 속이 비면 안 되고(글자가 배경 그림에
    //   묻힌다), 그렇다고 꽉 찬 판이면 화면을 가린다. 그래서 가운데를 어둡게 채우되
    //   가장자리로 갈수록 옅어지는 판으로 굽는다.
    description:
      'a thin dark iron name plate seen flat from the front, a narrow bevelled bronze rail along the top ' +
      'and bottom edges only with a small rivet at each end, the middle filled with flat near-black ' +
      'charcoal metal, no rails on the left and right sides, worn and grimy, ' + METAL,
    negative: NO_FRAME + ', hollow, transparent center, thick frame, cogwheel, ornate, engraving',
    opts: { detail: 'low detail', shading: 'basic shading', outline: 'single color outline', view: 'side', no_background: true },
  },

  // ── 결과창 도장 ────────────────────────────────────────────────
  //
  // 결말은 넷이지만(cleared·caught·spotted·reported) 도장은 둘이다. 셋을 따로 굽는
  // 것은 낭비다 — 패배 셋의 차이는 제목과 문장이 이미 말한다. 도장이 말해야 하는
  // 것은 "됐다"와 "안 됐다" 하나뿐이다.
  {
    id: 'seal-clear',
    label: '승인 도장 — 잠입 성공',
    // ⚠ metal 로 뒀다가 **놋쇠 톱니**가 나왔다. 녹청이 팔레트에 아예 없었으니
    //   당연한 결과다. 프롬프트에 `verdigris green ink` 라고 적어 둔 것만으로는
    //   색이 안 따라온다 — 색은 팔레트가 정한다.
    palette: 'verdigris',
    size: { width: 160, height: 160 },
    target: '#result-card 에 비스듬히 찍힌다 (신규)',
    // ⚠ **링을 그리게 하면 안 된다.** 1차에 "두 겹 원 링" 을 시켰더니 그 링을 따라
    //   가짜 알파벳이 빙 둘러 박혀 나왔다 (실측: seal-fail 에 "HO DO LIES OR HER…"
    //   비슷한 뜻 없는 획). negative 에 text·letters·words 를 넣어도 소용없었다 —
    //   **둥근 도장 링 자체가 글자를 부르는 형태**이기 때문이다. 링을 빼고 안쪽
    //   모양 하나만 남기면 글자가 앉을 자리가 사라진다.
    description:
      'a rubber ink stamp impression of a single cogwheel, seen straight on, just the cogwheel shape and ' +
      'nothing else, no ring or border around it, printed in muted verdigris green ink, the ink patchy and ' +
      'uneven with gaps where it did not take, ' +
      'chunky pixel art, limited palette, crisp hard edges',
    negative: 'text, letters, words, numbers, glyphs, ring, circle border, outline ring, badge, coin, ' +
      'wax, seal blob, ribbon, gold, brass, metal, solid fill, clean print, background, shadow, 3d',
    opts: { detail: 'medium detail', shading: 'flat shading', outline: 'lineless', no_background: true, view: 'side' },
  },
  {
    id: 'seal-fail',
    label: '기각 도장 — 붙잡힘·밀고·검거',
    palette: 'alarm',
    size: { width: 160, height: 160 },
    target: '#result-card 에 비스듬히 찍힌다 (신규)',
    // ⚠ seal-clear 와 같은 이유로 링이 없다. 1차에 링을 시켰더니 그 위로 가짜
    //   알파벳이 빙 둘러 박혔다.
    description:
      'a rubber ink stamp impression of two thick diagonal bars crossing each other like a big X, ' +
      'seen straight on, just the two bars and nothing else, no ring or border around them, ' +
      'printed in deep sealing-wax red ink, the ink patchy and uneven with gaps where it did not take, ' +
      'chunky pixel art, limited palette, crisp hard edges',
    negative: 'text, letters, words, numbers, glyphs, ring, circle border, outline ring, badge, coin, ' +
      'wax, seal blob, ribbon, gold, brass, metal, solid fill, clean print, background, shadow, 3d',
    opts: { detail: 'medium detail', shading: 'flat shading', outline: 'lineless', no_background: true, view: 'side' },
  },

  // ── 대화창 부속 ────────────────────────────────────────────────
  {
    id: 'dlg-arrow',
    label: '계속 표시 — 다음 대사가 남았다',
    palette: 'metal',
    size: { width: 48, height: 40 },
    target: '#dialogue-more (지금은 ▼ 글자)',
    // ⚠ 1차는 **위아래 양쪽을 가리키는 쌍화살표**가 나왔다. "arrow" 라는 낱말이
    //   축과 꼬리를 부르고, 그 김에 반대쪽 촉까지 붙는다. 화살이 아니라
    //   **아래를 가리키는 삼각형 하나**라고 도형으로 적는다.
    description:
      'a single solid triangle pointing downward, seen flat from the front, a wide flat top edge tapering ' +
      'to a point at the bottom, made of weathered bronze with a warm amber highlight along the top edge ' +
      'and a dark iron outline, one shape only, nothing above it and nothing below it, ' + METAL,
    negative: NO_FRAME + ', arrow, arrowhead, shaft, tail, feathers, line, stem, double headed, ' +
      'two triangles, pointing up, many shapes, background, curved',
    opts: { detail: 'medium detail', shading: 'basic shading', outline: 'single color outline', no_background: true, view: 'side' },
  },
  {
    id: 'dlg-field',
    label: '자유 대화 입력칸 — 글을 새겨 넣는 홈',
    palette: 'metal',
    size: { width: 200, height: 64 },
    slice: 16,
    fill: true,
    target: '#dialogue-field (지금은 맨 테두리)',
    // 눌러 들어간 홈이라야 "여기 쓴다"로 읽힌다. 튀어나온 판이면 버튼으로 읽혀
    // 옆의 [대화][닫기] 버튼과 구별이 안 간다.
    description:
      'a long horizontal recessed slot in a dark iron plate seen flat from the front, the slot pressed ' +
      'inward with a dark shadow along its top and inner-left edge and a faint warm amber highlight along ' +
      'its bottom edge, the inside filled with flat near-black charcoal, a small rivet at each end, ' + METAL,
    negative: NO_FRAME + ', raised, button, hollow, transparent center, text, cursor, keyboard',
    opts: { detail: 'medium detail', shading: 'detailed shading', outline: 'single color outline', view: 'side', no_background: true },
  },

  // ── 문서 열람 ──────────────────────────────────────────────────
  {
    id: 'doc-paper',
    label: '공문서 — 훔쳐 읽는 서류',
    palette: 'paper',
    size: { width: 320, height: 236 },
    target: '#docpanel-paper (지금은 매끈한 크림색 사각형)',
    // ⚠ 단서 수첩(clue-paper)과 **다른 물건**이어야 한다. 그쪽은 주머니에서 꺼낸
    //   찢긴 쪽지고 이쪽은 서류철에서 빼낸 공문서다. 가장자리를 자로 자른 듯
    //   곧게 두고(찢지 않는다) 괘선과 직인 자국으로 격을 만든다.
    //   배경을 검게 시키는 것은 clue-paper 와 같은 이유다 — 안 그러면 모델이
    //   종이색을 배경에도 깔아 컷아웃이 종이를 통째로 먹는다.
    description:
      'a single sheet of official document paper lying flat on a plain solid pure black background, ' +
      'seen straight on from above, straight clean-cut edges all the way around, ' +
      'a printed border rule just inside the edge, faint horizontal ruled lines across the sheet, ' +
      'a smudged round official ink stamp mark in one lower corner, a few brown age spots, ' +
      'blank with nothing written on it, chunky pixel art, limited palette, crisp hard edges',
    negative: 'text, letters, handwriting, writing, torn edges, ragged edges, crumpled, fold creases, ' +
      'curled, rolled, notebook, book, binding, metal, table, desk, perspective, tilted, 3d, ' +
      'cream background, light background',
    opts: { detail: 'highly detailed', shading: 'basic shading', outline: 'selective outline', no_background: true, view: 'high top-down' },
  },

  // ── 지하 탈출 경계 게이지 ──────────────────────────────────────
  {
    id: 'alert-gauge',
    label: '발각 게이지 액자 — 0 에서 올라 100 에서 터진다',
    palette: 'metal',
    size: { width: 320, height: 72 },
    slice: '18 24',
    target: 'EscapeScene 의 gaugeBg (Phaser 캔버스 — DOM 이 아니다)',
    // ⚠ 이것만 캔버스다. 나머지 부품은 CSS `border-image` 로 붙지만 이쪽은
    //   Phaser 의 nineslice 로 얹어야 한다 (BootScene 에서 미리 싣는다).
    // ⚠ 1차는 오른쪽 끝만 **창끝처럼 뾰족하게** 나왔다. 9분할은 좌우 모서리를 각각
    //   원본 크기로 박으므로 양끝이 다르면 액자가 짝짝이가 된다. 대칭을 못박는다.
    description:
      'a long horizontal metal gauge housing seen flat from the side, perfectly symmetrical left to right, ' +
      'hollow empty channel running through the middle, a flat square bronze end cap at the left end and ' +
      'an identical mirrored one at the right end, each cap with two rivets, ' +
      'thin dark iron rails along the top and bottom of the channel, ' +
      'a row of small engraved tick marks along the top rail, ' + METAL,
    negative: NO_FRAME + ', filled bar, colored fill, red, green, progress bar, bulbous, pipe, numbers, ' +
      'asymmetric, pointed end, arrow, spear tip, tapering, one end different',
    opts: { detail: 'medium detail', shading: 'detailed shading', outline: 'single color outline', view: 'side', no_background: true },
  },

  // ── 씬 전환 로딩 (튜토리얼 → 거리) ────────────────────────────
  //
  // 지금 화면은 CSS 로 그린 원반 시계 하나에 깜빡이는 말줄임 점 셋이다. 움직이긴
  // 하지만 **이 게임의 물건으로는 안 보인다** — 어느 게임에 갖다 놔도 어울리는
  // 일반적인 로딩 스피너다. 제목이 "태엽새"인데 시계가 그리다 만 원이면 아깝다.
  //
  // 세 층으로 짠다. 뒤에 톱니가 느리게 돌고, 가운데 회중시계가 놓이고, 아래로
  // 천공 테이프가 흘러간다. 테이프는 장식이 아니라 **부제를 그림으로 옮긴 것**이다
  // — 저 화면이 기다리는 동안 뜨는 말이 "동료들의 암호를 수신하고 있다"다.
  {
    id: 'watch-face',
    label: '회중시계 문자판 — 로딩 화면 한가운데',
    palette: 'metal',
    // 위쪽 용두와 고리까지 담아야 회중시계로 읽힌다 — 원만 있으면 그냥 계기판이다.
    size: { width: 208, height: 248 },
    target: '#transition-clock (지금은 CSS 원반). 바늘은 CSS 로 남는다',
    description:
      'an antique brass pocket watch seen straight on from the front, a thick tarnished bronze bezel ring ' +
      'around a dark near-black dial, fine tick marks around the rim, a small round brass pin at the exact ' +
      'centre of the dial, a ribbed winding crown and a small ring loop on top of the case, ' +
      'no hands on the dial, ' + METAL,
    negative: NO_FRAME + ', hands, pointers, needles, numerals, digits, roman numerals, chain, ' +
      'background, table, hand holding it, open lid, bright gold',
    opts: { detail: 'highly detailed', shading: 'detailed shading', outline: 'single color outline', no_background: true, view: 'side' },
  },
  {
    id: 'cog-large',
    label: '큰 톱니바퀴 — 로딩 화면 뒤에서 느리게 돈다',
    palette: 'metal',
    size: { width: 240, height: 240 },
    target: '#transition 의 배경 층 (신규)',
    // ⚠ 1차는 **이가 없는 바퀴**가 나왔다 — 테두리가 매끈한 살바퀴. "cogwheel ...
    //   teeth all the way around" 를 모델이 "둥근 테두리"로 읽었다. 이는 테두리의
    //   무늬가 아니라 **바깥으로 튀어나온 것**이므로 그렇게 적어야 한다.
    description:
      'a single large iron gear seen straight on from the front, chunky square gear teeth sticking outward ' +
      'from the outer edge all the way around like the teeth of a saw blade, a jagged spiky silhouette, ' +
      'a hollow hub in the middle with four spokes, heavy rivets on the spokes, ' +
      'very dark and soot-blackened, ' + METAL,
    negative: NO_FRAME + ', background, machine, chain, belt, second gear, bright, glowing, gold, ' +
      'smooth rim, round edge, solid ring, plain circle, wheel, tyre, porthole',
    opts: { detail: 'medium detail', shading: 'basic shading', outline: 'single color outline', no_background: true, view: 'side' },
  },
  {
    id: 'tape-strip',
    label: '천공 테이프 — 가로로 흘러간다 (= 수신 중)',
    palette: 'paper',
    // ⚠ 가로로 되풀이해 흘릴 것이라 **좌우 끝이 이어져야 한다.** 이음매가 보이면
    //   테이프가 아니라 같은 그림이 계속 튀어나오는 것으로 읽힌다. 구멍 간격이
    //   일정해야 하므로 폭은 구멍 간격의 배수로 잡히도록 넉넉히 준다.
    size: { width: 320, height: 56 },
    // 판 전체가 테이프다. 벗기려 들면 **통째로 사라진다**(실측 100%) — 테이프가
    // 좌우 끝까지 이어져 가장자리에 닿아 있으니 배경과 구분할 방법이 없다.
    // 이어 붙일 그림이라 애초에 투명할 자리도 없다.
    opaque: true,
    target: '#transition 아래쪽을 가로지르며 흐른다 (신규)',
    // ⚠ 1차는 **구멍 하나 없는 크림색 판**이 나왔다. `seamless repeating pattern` 이
    //   범인으로 보인다 — 모델이 "무늬 없는 바탕"으로 알아들었다. 구멍은 무늬가
    //   아니라 **뚫린 자리**이므로 뒤가 비쳐 검다고 적어야 그려진다.
    description:
      'a long horizontal strip of aged cream punched paper tape, seen straight on from above, ' +
      'eight evenly spaced square holes punched clean through the middle of the strip in a single row, ' +
      'each hole showing solid black through it, a second row of much smaller round holes punched below ' +
      'them, the strip runs straight off the left and right edges of the image, ' +
      'chunky pixel art, limited palette, crisp hard edges',
    negative: 'text, letters, numbers, torn edges, ragged edges, curled, rolled, spool, machine, ' +
      'shadow, perspective, tilted, 3d, tapering, blank, plain, empty strip, unbroken surface, no holes',
    opts: { detail: 'highly detailed', shading: 'basic shading', outline: 'single color outline', view: 'high top-down' },
  },

  // ── 심문 진행 명판 (스테이지 3 · 에바 대면) ────────────────────
  //
  // 문답이 몇 번째인지, 지금까지 어떻게 답해 왔는지가 지금은 본문 한 줄
  // (`탐지 100 · 3/8`)로만 흘러가고, 그 칸은 다음 턴에 지워진다. 쌓이는 느낌이
  // 없으니 "잘 버티고 있다"는 긴장도 같이 사라진다 — duel 배치 우상단 명판에
  // 문항 램프 여덟 개와 탐지 게이지를 상시 게시한다.
  //
  // 램프는 색으로만 가르지 않는다 — 무사는 온전한 점등, 감점은 **금 간 렌즈**.
  // 색약 사용자에게 색은 보조 신호이지 유일한 신호가 아니다.
  {
    id: 'duel-plaque',
    label: '심문 진행 명판 — 램프와 탐지 게이지가 앉는 판',
    palette: 'metal',
    size: { width: 240, height: 120 },
    // 실측(2026-08-06 판, 여백 잘린 222×101 기준): 놋쇠 레일 0~7px, 모서리
    // 리벳이 9~18px에 앉는다 — 리벳까지 모서리 조각에 담으려면 20. 판 속
    // 새김선(인셋 ~30px)은 가운데 조각에 남아 늘어나지만 램프가 그 위를 덮는다.
    slice: 20,
    fill: true, // 판이 곧 배경이다 — 빼면 램프가 수로 위 허공에 뜬다
    target: '#duel-progress (duel 배치 우상단, 신규)',
    description:
      'a rectangular dark iron plaque seen flat from the front, a narrow bevelled bronze rail along ' +
      'all four edges with a small rivet in each corner, the middle filled with flat near-black ' +
      'charcoal metal, worn and grimy, ' + METAL,
    negative: NO_FRAME + ', hollow, transparent center, thick frame, cogwheel, ornate, engraving',
    opts: { detail: 'low detail', shading: 'basic shading', outline: 'single color outline', view: 'side', no_background: true },
  },
  {
    id: 'duel-lamp-off',
    label: '문항 램프 — 아직 안 물은 질문',
    palette: 'metal',
    size: { width: 56, height: 56 },
    target: '#duel-progress .dp-lamp (기본 상태)',
    description:
      'a small round indicator lamp seen straight on from the front, a weathered bronze ring housing ' +
      'with four tiny rivets, a dark unlit near-black glass lens filling the inside, dead and dormant, ' + METAL,
    negative: NO_FRAME + ', glow, glowing, lit, bright center, light rays, cracked, background',
    opts: { detail: 'medium detail', shading: 'basic shading', outline: 'single color outline', no_background: true, view: 'side' },
  },
  {
    id: 'duel-lamp-ok',
    label: '문항 램프 — 무사히 넘겼다',
    palette: 'lampOk',
    size: { width: 56, height: 56 },
    target: '#duel-progress .dp-lamp.ok',
    // 녹청인 이유: 게임이 성공을 이 색으로 말한다 (#minigame-verdict.ok · seal-clear).
    description:
      'a small round indicator lamp seen straight on from the front, a weathered bronze ring housing ' +
      'with four tiny rivets, the glass lens glowing calm verdigris green with a brighter green core ' +
      'and a tiny pale glint, steady and reassuring, ' + METAL,
    negative: NO_FRAME + ', red, orange, blue, cracked, broken, dark lens, light rays, background',
    opts: { detail: 'medium detail', shading: 'basic shading', outline: 'single color outline', no_background: true, view: 'side' },
  },
  {
    id: 'duel-lamp-warn',
    label: '문항 램프 — 지적만 받고 넘어갔다 (첫 모순 사면)',
    palette: 'lampWarn',
    size: { width: 56, height: 56 },
    target: '#duel-progress .dp-lamp.warn',
    description:
      'a small round indicator lamp seen straight on from the front, a weathered bronze ring housing ' +
      'with four tiny rivets, the glass lens half-lit with a wavering warm amber ember glow, dimmer ' +
      'around the rim, uneasy and flickering, ' + METAL,
    negative: NO_FRAME + ', green, red, blue, cracked, broken, light rays, background',
    opts: { detail: 'medium detail', shading: 'basic shading', outline: 'single color outline', no_background: true, view: 'side' },
  },
  {
    id: 'duel-lamp-bad',
    label: '문항 램프 — 감점 (거짓·노출·모순)',
    palette: 'lampBad',
    size: { width: 56, height: 56 },
    target: '#duel-progress .dp-lamp.bad',
    // 금 간 렌즈가 곧 상태다 — 색을 못 읽어도 깨진 것은 보인다.
    description:
      'a small round indicator lamp seen straight on from the front, a weathered bronze ring housing ' +
      'with four tiny rivets, the glass lens glowing deep sealing-wax red and split by a jagged dark ' +
      'crack running across it, damaged and ominous, ' + METAL,
    negative: NO_FRAME + ', green, blue, intact, clean, light rays, background',
    opts: { detail: 'medium detail', shading: 'basic shading', outline: 'single color outline', no_background: true, view: 'side' },
  },
  {
    id: 'duel-meter',
    label: '탐지 게이지 액자 — 100 에서 깎여 0 이면 들킨다',
    palette: 'metal',
    // ⚠ 56 높이로 두 번 실패했다 — 두 번 다 캡이 왼쪽에만 붙고 오른쪽은 레일이
    //   화면 밖으로 흘렀다. 같은 문장으로 성공한 alert-gauge 와의 차이는 높이뿐
    //   (72 vs 56) — 납작한 캔버스는 그 자체가 "끝없는 레일"이라는 지시로 읽힌다
    //   (needle 의 1차 실패와 같은 함정). 문장은 안 고치고 높이만 72 로 세운다.
    size: { width: 320, height: 72 },
    // 실측(여백 잘린 304×51 기준): 모서리 볼트판이 x 8~24, 위 레일 y 0~17,
    // 빈 채널 y 18~31, 아래 레일 y 32~50 — 상하 18, 좌우 25.
    slice: '18 25',
    target: '#duel-progress-meter (안쪽 막대는 CSS 가 그린다)',
    // alert-gauge 와 같은 성격의 물건이지만 이쪽은 DOM 이고 눈금 없이 낮다 —
    // 명판 안에 앉는 부품이라 화면 전체용 게이지보다 조용해야 한다.
    description:
      'a long horizontal metal gauge housing seen flat from the side, perfectly symmetrical left to right, ' +
      'hollow empty channel running through the middle, a flat square bronze end cap at the left end and ' +
      'an identical mirrored one at the right end, each cap with a single rivet, ' +
      'thin dark iron rails along the top and bottom of the channel, ' + METAL,
    negative: NO_FRAME + ', filled bar, colored fill, red, green, progress bar, bulbous, pipe, numbers, ' +
      'asymmetric, pointed end, arrow, spear tip, tapering, one end different, tick marks',
    opts: { detail: 'medium detail', shading: 'detailed shading', outline: 'single color outline', view: 'side', no_background: true },
  },
  {
    id: 'duel-eye',
    label: '감시 렌즈 — 명판 왼쪽. 탐지가 낮아지면 붉게 깨어난다',
    palette: 'lampBad',
    size: { width: 72, height: 72 },
    target: '#duel-progress-eye',
    // 탐지 게이지의 주인이 누구인지 그림으로 말한다 — 이 판은 에바가 당신을
    // 재는 판이다. 낮은 탐지 구간에서 CSS 가 붉은 그림자를 얹어 깨운다.
    description:
      'a single round robot camera eye seen straight on from the front, a heavy riveted dark iron ring ' +
      'housing, a deep near-black glass lens with a narrow glowing red iris ring in the centre, ' +
      'cold and watchful, ' + METAL,
    negative: NO_FRAME + ', green, blue, eyeball, pupil, eyelashes, human eye, light rays, background',
    opts: { detail: 'medium detail', shading: 'detailed shading', outline: 'single color outline', no_background: true, view: 'side' },
  },

  // ── 게임오버 — 스테이지 3 검거 (순찰 로봇에게 잡혔을 때) ──────
  //
  // 지금은 붉은 번쩍임 → 암전 → 시작 지점, 1.1초다. 빠른 재시도라는 설계는
  // 지키되(스펙 §1 — 루즈함 방지), "잡혔다"가 화면에 한 번도 서지 않으니
  // 게이지가 왜 무서운지 그림이 말해 준 적이 없다 — 검거 한 장면을 세운다.
  // 아무 키로 건너뛸 수 있어 손이 빠른 사람은 여전히 즉시 재시도다.
  {
    id: 'gameover-catch',
    label: '검거 장면 — 서치라이트에 붙잡힌 소년과 순찰 로봇',
    model: 'pro',
    // 판 전체가 그림이다 (stage-bg 와 같은 이유로 벗기면 광선과 안개가 날아간다).
    opaque: true,
    size: { width: 416, height: 256 },
    target: '#gameover-scene (신규 — 검거 연출의 한가운데)',
    // 소년은 grenade-throw 의 인물 묘사를 그대로 쓴다 — 같은 인물이 다른 장면에
    // 다시 나오는 것이므로 낱말이 갈리면 사람이 갈린다.
    // 로봇은 **스테이지 3의 전투 로봇**(설정서 26, Sentry)이다 — 1차는 스테이지 1
    // 검문 로봇(guard-robot, 놋쇠 술통)을 그려 버려서 실제로 잡은 놈과 다른 놈이
    // 화면에 섰다. 설정화의 핵심: 머리가 따로 없고 둥근 몸통에 주황 렌즈 눈이
    // 여럿, 한 팔은 톱날·한 팔은 총열, 칠흑 장갑에 붉은 이음매.
    // Pro 는 negative 도 팔레트도 안 받으므로 금지 사항을 전부 문장 안에 적었다.
    // 배경은 순검정을 못박는다 — 2차 굴림에서 흰 바탕이 나왔었다 (이 판은 통짜
    // 그림이라 반입 때 배경을 안 벗긴다).
    description:
      'a dramatic pixel art game over scene seen from the side like a side-scrolling game, ' +
      'on the left a hulking jet-black armoured combat robot facing right, it has no head — ' +
      'its huge rounded dome torso is studded with several round glowing orange-red lens eyes ' +
      'of different sizes, thin antenna rods sticking up from the top of the dome, ' +
      'one arm ending in a jagged steel saw blade and the other arm ending in a thick gun barrel, ' +
      'heavy segmented near-black armour plates with faint deep-red seams and small bronze bolts, ' +
      'the largest lens projecting a wide harsh cone of warm amber searchlight to the right across the scene, ' +
      'caught inside the beam a small ragged young boy facing the robot with both hands raised in surrender, ' +
      'messy dark curly hair, brass goggles on his forehead, long red scarf, off-white shirt with rolled ' +
      'sleeves, leather satchel, worn trousers and boots, his long shadow stretching away from the light, ' +
      'a plain solid pure black background behind them, dim gaslit Victorian steampunk mood, ' +
      'the glowing lenses and the amber beam the only bright things in the frame, ' +
      'chunky pixel art, limited palette, crisp hard edges, dark warm-brown outlines, ' +
      'no text, no letters, no numbers, no ui, no frame, no border',
    opts: {},
  },
  // ── 게임오버 — 스테이지 3 심문 실패 (에바에게 들켰을 때) ──────
  //
  // 같은 스테이지의 두 번째 패배다. 순찰 로봇에게 잡히는 것(gameover-catch)과 나란히
  // 서지만 **성질이 정반대라 그림도 반대로 간다**: 로봇은 힘으로 붙잡고 뜨거운 앰버
  // 서치라이트가 소년을 몰아세우는데, 에바는 힘을 쓰지 않는다 — 거짓말을 알아본
  // 것뿐이고, 그 앎이 차가운 푸른빛으로 새어 나온다. 앰버 대 청백, 포위 대 응시.
  //
  // 인물 묘사는 두 곳에서 그대로 가져온다. 소년은 gameover-catch 의 문장을 한 자도
  // 안 바꾸고(같은 인물이 다른 장면에 다시 서는 것이라 낱말이 갈리면 사람이 갈린다),
  // 에바는 설정 일러스트(public/portraits/eva.png)를 옮겨 적었다 — 짧은 흰 곱슬머리,
  // 목까지 오는 크림색 빅토리아 드레스에 레이스, 옅은 청회색 주름 앞치마, 진홍 구두.
  // ⚠ 손은 반드시 기계 관절이 드러나야 한다. 이 장면에서 "사람이 아니다"를 말하는
  //   것은 눈빛과 그 손뿐이고, 그게 없으면 그냥 소녀 둘이 서 있는 그림이 된다.
  //
  // Pro 는 negative 도 팔레트도 안 받으므로 금지 사항을 전부 문장 안에 적었다
  // (gameover-catch 와 같은 규약). 배경도 같은 이유로 순검정을 못박는다.
  {
    id: 'gameover-eva',
    label: '심문 실패 장면 — 거짓말을 꿰뚫어 본 에바와 붙잡힌 소년',
    model: 'pro',
    // ⚠ gameover-catch 와 달리 **배경을 벗긴다**(opaque 를 안 붙인다).
    //
    // 그쪽은 서치라이트 광선과 안개가 배경에 녹아 있어 벗기면 연출이 통째로 날아가지만,
    // 이 장면은 인물 둘이 전부다 — 벗겨서 무대의 어둠(#gameover-scene 의 배경색) 위에
    // 바로 세우는 편이 낫다. 실제로 Pro 가 "순검정 배경"을 무시하고 **흰 바탕**을 깔아
    // 보냈는데(gameover-catch 2차 굴림과 같은 함정), 벗기면 그 사고가 그대로 무해해진다.
    // 소년의 미색 셔츠는 어두운 외곽선에 둘러싸여 있어 flood fill 이 못 들어간다.
    size: { width: 416, height: 256 },
    target: '#gameover-scene (에바 변형 — #gameover.eva 가 바꿔 끼운다)',
    description:
      'a dramatic pixel art game over scene seen from the side like a side-scrolling game, ' +
      'on the right a pale young woman standing perfectly still and facing left, ' +
      'short tousled snow-white curly hair, calm expressionless face, ' +
      'her eyes glowing with a cold pale blue-white light, ' +
      'a high-collared cream Victorian dress with lace ruffles at the throat and shoulders, ' +
      'a pale blue-grey pleated apron panel down the skirt, dark red shoes, ' +
      'one bare arm reached out gripping the boy by the wrist, ' +
      'her hand and wrist are exposed clockwork — brass finger joints, ' +
      'polished metal knuckles and a seam of tiny gears at the wrist, the only part of her that is not human, ' +
      'on the left a small ragged young boy pulled off balance towards her, leaning back and away, ' +
      'messy dark curly hair, brass goggles on his forehead, long red scarf, off-white shirt with rolled ' +
      'sleeves, leather satchel, worn trousers and boots, his free hand raised, alarmed, ' +
      'a plain solid pure black background behind them, ' +
      'the cold blue glow of her eyes falling on the boy is the only light in the frame, ' +
      'no searchlight, no beam, no lamp, no robot, no machinery around them, ' +
      'dim gaslit Victorian steampunk mood, ' +
      'chunky pixel art, limited palette, crisp hard edges, dark warm-brown outlines, ' +
      'no text, no letters, no numbers, no ui, no frame, no border',
    opts: {},
  },
  {
    id: 'gameover-bars',
    label: '감옥 창살 — 검거 순간 화면 위에서 내리꽂힌다',
    palette: 'metal',
    // 가로로 되풀이해 깐다(repeat-x, 높이는 화면에 맞춰 비례 확대). 창살 사이가
    // 뚫려 있어야 뒤의 장면이 비치므로 배경을 벗겨 투명으로 만든다 — 틈이 위아래
    // 가장자리에 닿아 있어 flood fill 이 그리로 들어간다.
    // 268 인 이유: 표준(pixflux)은 가로세로가 4의 배수라야 한다 (270 은 422 를 냈다).
    size: { width: 320, height: 268 },
    target: '#gameover-bars (신규 — repeat-x 로 화면 폭을 채운다)',
    // ⚠ 1차는 "gaps completely empty" 를 모델이 **어두운 갈색 바탕**으로 칠해 왔고
    //   (clue-paper 2차와 같은 함정 — '비어 있다'는 바탕색 칠하기로 읽힌다), 창살도
    //   바탕과 톤이 같은 실오라기로 나와 컷아웃이 가를 수 없었다. 처방도 같다 —
    //   배경을 순검정으로 못박고, 굵기는 "옆의 틈만큼 굵다"로 도형처럼 적는다.
    description:
      'a row of thick vertical iron prison bars standing on a plain solid pure black background, ' +
      'seen straight on from the front, four evenly spaced massive round iron bars each running from ' +
      'the top edge to the bottom edge of the image, each bar nearly as wide as the gap beside it, ' +
      'a warm pale highlight running down one side of each bar and a riveted iron cap at the top and ' +
      'bottom of each bar, heavy and oppressive, ' + METAL,
    negative: NO_FRAME + ', wall, bricks, chain, lock, door, gate frame, cell, room, background scenery, ' +
      'horizontal bars only, diagonal, bent bars, curved, thin, wire, hairline, pinstripe, fence, mesh, ' +
      'grey background, brown background',
    opts: { detail: 'medium detail', shading: 'detailed shading', outline: 'single color outline', view: 'side', no_background: true },
  },
  {
    id: 'gameover-plate',
    label: '검거 명판 — 「검 거」 글자가 앉는 쇠판',
    palette: 'alarm',
    // 도장(seal-fail)과 다른 물건이다 — 그쪽은 서류에 찍는 기각 도장이고 이쪽은
    // 판결을 내거는 철판이다. 봉랍 빨강 줄이 실패의 색을 미리 말한다
    // (#minigame-verdict.fail 과 같은 계열).
    size: { width: 288, height: 112 },
    target: '#gameover-plate (신규 — 위에 「검 거」 가 글자로 올라간다)',
    description:
      'a heavy rectangular battered iron sign plate seen flat from the front, thick bevelled edges, ' +
      'a large hex bolt in each of the four corners, the middle filled with flat near-black charcoal ' +
      'metal for large letters to sit on, a thin sealing-wax red pinstripe running just inside the edge, ' +
      'scratched and dented, ' + METAL,
    negative: NO_FRAME + ', hollow, transparent center, cogwheel, ornate, engraving, chain, hanging, rope',
    opts: { detail: 'medium detail', shading: 'detailed shading', outline: 'single color outline', view: 'side', no_background: true },
  },

  // ── 무대 그림 ──────────────────────────────────────────────────
  {
    id: 'stage-bg',
    label: '무대 배경 — 포격 맞은 거리',
    palette: 'scene',
    size: { width: 320, height: 184 },
    // 판 전체가 그림이다. 반입할 때 배경을 벗기면 하늘과 안개가 통째로 날아간다
    // (실측: 40% 가 도려내졌다).
    opaque: true,
    target: '.gr-stage 의 background (지금은 그라디언트)',
    // ⚠ 두 번은 소실점으로 빨려 들어가는 **원근 복도**가 나왔다. 무대는 좌우에
    //   인물을 세우는 옆보기 배경이라 복도면 인물이 공중에 뜬다. 'flat side view'
    //   와 'no vanishing point' 를 못박고 negative 에 'one point perspective' 까지
    //   넣었는데도 소용없었다 — 문제는 옵션이 아니라 낱말이었다. **모델은
    //   'street' 를 원근으로만 그린다.** 거리를 아예 빼고 'building facades'(정면에서
    //   본 건물 벽면)로 부르니 평면이 나온다. 낱말 하나가 옵션 셋을 이겼다.
    description:
      'a flat head-on elevation view of a row of bombed-out Victorian brick building facades, ' +
      'drawn like a side-scrolling game backdrop, caved-in roofs, broken chimneys, shattered windows, ' +
      'crumbling brick walls, heaps of rubble and stacked sandbags piled along the bottom edge, ' +
      'smoke and dust haze, muted brown and grey, a faint warm amber gaslight glow, gloomy and oppressive, ' +
      'chunky pixel art, limited palette, crisp hard edges, no characters',
    negative: 'people, characters, robot, text, ui, frame, border, street, road, pavement, cobblestones, ' +
      'vanishing point, one point perspective, receding, depth, corridor, alley, ' +
      'intact buildings, bright sky, blue sky, green grass, cheerful',
    opts: { detail: 'highly detailed', shading: 'detailed shading', outline: 'selective outline', view: 'side' },
  },
  {
    id: 'grenade-charge',
    label: '충전 단계 그림 — 자석 수류탄을 쥔 손',
    palette: 'scene',
    size: { width: 240, height: 240 },
    target: '충전 단계 왼쪽 그림 (지금은 없다)',
    // ⚠ 1차는 왼쪽 가장자리에 세로 띠가 하나 붙어 나왔다 (기둥인지 소매인지 모를
    //   물건). 가장자리에 닿아 있으면 컷아웃이 배경으로 못 읽어 그대로 남는다.
    //   `nothing touching the edges` 로 가장자리를 비우게 시켰다.
    description:
      'a single gloved hand in a worn brown leather gauntlet gripping a round brass steampunk grenade ' +
      'with a bolt on top and riveted bands, bright blue-white electric arcs crackling around the grenade, ' +
      'seen from the side, one isolated object floating on an empty background with nothing touching the ' +
      'edges of the image, dim gaslit Victorian steampunk, chunky pixel art, limited palette, ' +
      'crisp hard edges, dark warm-brown outlines',
    negative: 'text, ui, frame, border, face, full body, background scenery, bright colors, cheerful, ' +
      'arm, sleeve, shoulder, wall, pillar, post, vertical bar, second hand',
    opts: { detail: 'highly detailed', shading: 'detailed shading', outline: 'single color outline', no_background: true, view: 'side' },
  },
  {
    id: 'grenade-throw',
    label: '투척 단계 그림 — 던지는 소년 (왼쪽)',
    palette: 'scene',
    size: { width: 200, height: 264 },
    target: 'grenadeThrow.js 의 ART.left = /ui/grenade-throw.png',
    description:
      'a young ragged boy lunging forward and hurling a brass grenade with his right arm, seen from the side ' +
      'facing right, messy dark curly hair, brass goggles on his forehead, long red scarf streaming behind, ' +
      'off-white shirt with rolled sleeves, leather satchel, worn trousers and boots, ' +
      'dim gaslit Victorian steampunk, chunky pixel art, limited palette, crisp hard edges, ' +
      'dark warm-brown outlines',
    negative: 'text, ui, frame, border, background scenery, gun, adult, armour, bright colors',
    opts: { detail: 'highly detailed', shading: 'detailed shading', outline: 'single color outline', no_background: true, view: 'side', direction: 'east' },
  },
  {
    id: 'guard-robot',
    label: '투척 단계 그림 — 순찰 로봇 (오른쪽)',
    palette: 'scene',
    size: { width: 216, height: 264 },
    target: 'grenadeThrow.js 의 ART.right = /ui/guard-robot.png',
    // ⚠ 1차는 청록 배관이 잔뜩 끼고 발밑에 회색 그림자 판이 붙어 나왔다.
    //   scene 팔레트에 녹청(#5e8b7e)이 들어 있어서다. 색을 빼는 대신 negative 로
    //   막았다 — 배경(stage-bg)에는 녹청이 필요하고 팔레트를 공유하기 때문이다.
    description:
      'a bulky brass steampunk patrol robot standing and facing left, huge round riveted barrel torso, ' +
      'a single glowing red lens eye in the center of its chest, short stubby armoured legs, ' +
      'oversized segmented brass arms hanging at its sides, pipes and pressure valves, scratched and grimy, ' +
      'dim gaslit Victorian steampunk, chunky pixel art, limited palette, crisp hard edges, ' +
      'dark warm-brown outlines',
    negative: 'text, ui, frame, border, background scenery, human, face, sleek, chrome, futuristic, ' +
      'bright colors, teal, turquoise, mint green, cast shadow, ground shadow',
    opts: { detail: 'highly detailed', shading: 'detailed shading', outline: 'single color outline', no_background: true, view: 'side', direction: 'west' },
  },

  // ── 엔딩 커튼 (To be continued) ────────────────────────────────
  //
  // 게임 제목이 "태엽새"인데 정작 태엽새가 화면에 한 번도 안 나온다 — 엔딩의
  // 마지막 화면이 그 새가 처음이자 마지막으로 나는 자리다 (ui/EndingCurtain.js).
  //
  // Pro 인 이유: 이 그림은 화면 한가운데 2배로 크게 서는 주인공이라 표준 모델의
  // 뭉개진 디테일이 그대로 보인다. 감옥 퍼즐 부품 다섯과 같은 판단이다.
  {
    id: 'ending-bird',
    label: '태엽새 — 엔딩 마지막 화면의 엠블럼',
    model: 'pro',
    size: { width: 400, height: 288 },
    target: '#ending 파이널 타블로 한가운데 (신규)',
    description:
      'a mechanical clockwork bird flying with both wings spread wide, seen from the side facing right, ' +
      'built from weathered tarnished brass and dark iron plates, riveted metal feathers layered along ' +
      'the wings, a large brass wind-up key sticking up from its back, exposed cogwheels and gears ' +
      'visible inside its open chest, a small warm amber glowing eye, thin trailing steam wisps behind ' +
      'the wing tips, warm amber rim light along the upper edges, soot and grime in the crevices, ' +
      'matte not shiny, dim gaslit Victorian steampunk, chunky pixel art, limited palette, ' +
      'crisp hard edges, dark warm-brown outlines, no text, no letters, no numbers, ' +
      'one bird only, nothing behind it, plain empty background',
    opts: { no_background: true },
  },

  // ── 설정 창 (타이틀 [설정] · 인게임 [Esc]) ─────────────────────
  //
  // 카드 액자는 새로 안 굽는다 — `.sp-panel`(stage-frame)을 이미 쓰고 있고,
  // 버튼도 `.sp-btn` 공용이다. 남는 것은 **슬라이더 세 조각**인데 지금은 셋 다
  // CSS 그라디언트다. 한 화면 안에서 액자만 그림이고 그 속의 부품은 매끈한
  // 그라디언트라 서로 다른 게임의 물건처럼 놓여 있다.
  //
  // 셋을 따로 굽는 이유는 각자 다르게 늘어나기 때문이다. 홈은 가로로 늘고,
  // 띠는 0 에서 가득까지 매 프레임 늘고, 손잡이는 안 는다. 한 장으로 그리면
  // 늘어나는 부분과 안 늘어나는 부분이 한 그림에 섞인다.
  // ⚠ 홈과 손잡이는 **새로 안 굽는다.** 두 번씩 굴려 보고 접었다 — 실패가 우연이
  //   아니라 이미 이 표에 적혀 있는 함정이었다.
  //
  //   홈(320×56, `recessed channel ... identical mirrored end cap`) — 두 판 다
  //     오른쪽 캡이 캔버스 밖으로 잘려 나갔다 (양끝 거울 평균차 42 · 100). alert-gauge
  //     의 ⚠ 가 적어 둔 그 증상이고, 9분할은 좌우 모서리를 각각 박으므로 짝짝이가 된다.
  //   손잡이(64×112) — 1판은 3/4 입체(needle 의 ⚠ 3차와 같은 실패), 2판은 폭 21px
  //     실오라기(needle 의 ⚠ 1차와 같은 실패). 저 칸이 세 번 헛디딘 끝에 찾은 답이
  //     지금의 needle 이다.
  //
  //   두 부품 다 **이미 있다**: track-frame(가로 채널 + 대칭 청동 캡)과 needle(그 위를
  //   타는 놋쇠 손잡이). 게다가 둘은 짝으로 설계돼 검문 조우의 타이밍 트랙에서 같이
  //   돌고 있다 — 볼륨 슬라이더가 그 어휘를 그대로 쓰면 플레이어가 이미 아는 물건이
  //   된다. 감옥 퍼즐이 stage-frame 을 도로 쓴 것과 같은 판단이다.
  // ⚠ 차오르는 띠도 **안 굽는다.** 네 판을 굴렸고 네 판 다 사방에 테를 두른 판이
  //   나왔다 (negative 에 end cap·side border·frame·bracket 을 넣어도, tape-strip 처럼
  //   "좌우 끝까지 이어진다"고 못박아도 그렸다). 모델 탓이라기보다 부탁이 틀렸다 —
  //   **0 에서 가득까지 자라는 띠에는 끝동이 있으면 안 된다.** 9분할로 늘리면 100%
  //   에서는 멀쩡하지만 20% 에서는 좌우 테가 제 폭을 넘어 겹치고, 이어 붙이면 테가
  //   일정 간격으로 되풀이돼 띠가 토막 난다.
  //
  //   이 저장소는 이미 같은 답을 냈다: 검문 트랙도 **액자만 그림이고 차오르는 색은
  //   CSS 그라디언트**다 (.gr-track 의 빨강 배경 · .gr-zone 의 초록). 볼륨도 그대로 간다.
  {
    id: 'exit-plate',
    label: '[타이틀 화면으로] 버튼 판 — 판을 버리고 떠나는 문',
    palette: 'metal',
    // 글자가 여섯 자라 button.png(53×20)로는 좁다. 9분할이라 늘리면 그만이지만,
    // 원본이 가로로 짧으면 리벳 사이가 벌어져 판이 성기게 보인다.
    size: { width: 192, height: 64 },
    // 실측(2026-08-07 판, 여백 잘린 186×57 기준): 놋쇠 레일은 2px 로 얇지만 모서리
    // 브래킷의 곡선이 12px 까지 뻗는다. 10 으로 끊으면 그 꼬리가 잘리므로 14 —
    // space-plate·key-plate 와 같은 값이 되었다.
    slice: 14,
    fill: true, // 판이 곧 배경이다 — 빼면 글자가 허공에 뜬다 (space-plate 와 같은 이유)
    target: '#settings-to-title (지금은 .sp-btn 그라디언트)',
    // 문장은 hud-plate·duel-plaque 에서 그대로 가져왔다. 둘 다 한 번에 나온 판이고
    // **어두운 쇠판 + 놋쇠 테 + 모서리 리벳**이라는 같은 물건이라, 새로 쓰는 것보다
    // 검증된 문장을 옮기는 쪽이 화풍이 안 갈린다 (이 파일 머리말의 규칙).
    //
    // space-plate(놋쇠 얼굴)를 안 따라간 이유는 하나다 — 이 버튼 바로 위에 놋쇠
    // 슬라이더 셋이 늘어선다. 같은 놋쇠 얼굴이면 넷째 슬라이더처럼 보이고, 무엇보다
    // 이건 **판을 버리는 단추**라 소리 조절과 같은 무게로 보이면 안 된다.
    description:
      'a wide rectangular dark iron button plate seen flat from the front, a narrow bevelled bronze rim ' +
      'running along all four edges with a small rivet in each corner, the middle filled with flat ' +
      'near-black charcoal metal left completely blank for a label to sit on, a faint warm amber ' +
      'highlight along the top rim and a dark shadow along the bottom rim, scratched grimy metal, ' + METAL,
    negative: NO_FRAME + ', hollow, transparent center, thick frame, cogwheel, gear, ornate, engraving, ' +
      'bright brass face, golden face, keyboard, many keys, round, circular, lever, switch, handle',
    opts: { detail: 'medium detail', shading: 'detailed shading', outline: 'single color outline', view: 'side', no_background: true },
  },
];
