# PixelLab 프롬프트 — NPC 26인 + 백작

주인공을 PixelLab 판으로 갈아끼운 것(`f02bd26`)과 **같은 방식**으로 나머지 인물을 뽑기 위한
프롬프트 모음이다. 출처는 두 개다.

- **문장 구조** — 주인공이 실제로 쓴 프롬프트 (`design/Player/pixellab/metadata.json` 의 `prompt`).
그 문장을 그대로 본떠 자리만 갈아끼웠다.
- **인물 내용** — `design/characters/HEART_OF_STEEL_Character_List_설정초안_10.xlsx` 의 외형·미드저니
칸과, 실제 인게임 일러스트 `design/NPC/일러스트/<번호_이름>/0_<이름>_인게임.png`.
**둘이 어긋나면 일러스트를 따랐다** — 대화창에 뜨는 초상과 필드의 스프라이트가 같은 사람으로
보여야 하기 때문이다. 어긋난 자리는 표의 비고에 적었다.

## 반입된 것 — 본부 4인 (2026-08-04)

표에서 취소선이 그어진 넷은 이미 게임에 들어갔다. 남향 정지 그림 한 장씩이다.

| 인물 | 게임 id | 원본 프레임 | 인물 키 | 파일 |
| --- | --- | --- | --- | --- |
| 01 브란트 | `officer` (콘라트) | 196 | 94 | `src/client/assets/npc/officer-south.png` |
| 02 에이다 | `t2` (미아) | 188 | 91 | `t2-south.png` |
| 03 토마스 | `t3` (오토) | 196 | 95 | `t3-south.png` |
| 04 리아 | `t1` (레나) | 200 | 98 | `t1-south.png` |

내보내기 원본은 `design/NPC/pixellab/<이름>/` 에 그대로 두었다. 굽는 것은
`node scripts/import-npc-sprites.js` 한 줄이고, 실측값은
`src/client/entities/npcSprite.js` 가 단일 출처다.

**PixelLab 은 인물마다 프레임 크기를 다르게 준다** (188~200). 그대로 쓰면 원점을 하나로
잡을 수 없어 인물마다 발 높이가 어긋나므로, 반입 스크립트가 **공통 200칸에 공통
땅선(y=147)으로 다시 앉힌다**. 그래서 씬이 드는 값은 원점 하나(넷이 공유) + 인물
키(사람마다 다름)뿐이고, 화면에서는 넷이 정확히 같은 키(본부 `charHeight`)로 선다.

**그 `charHeight` 를 96 → 128 로 키웠다** (2026-08-04, `src/client/assets/hq.json`). 갈아끼우고
보니 인물이 배경 가구 대비 너무 작았다 — 배경 그림이 큰 축척으로 그려져 있어서다. 128 은
거리 맵의 화면 인물 높이와 같은 값이고, 주인공 그림이 정확히 2배로 확대돼 픽셀이 고르게
찍힌다. 본부는 카메라 줌이 1 이라 **인물을 키운 만큼 방이 덜 보인다** (세로 11.2명분 →
8.4명분) — 그게 더 올리지 않은 이유다. 저택·탈출(88)은 배경 축척이 달라 손대지 않았다.

다음 인물을 반입할 때는 `import-npc-sprites.js` 의 `CHARACTERS` 에 한 줄 더하고,
스크립트가 찍어 주는 값을 `npcSprite.js` 로 옮겨 적으면 된다.

---

## 1. PixelLab 화면에서 고를 값 (전원 공통)

주인공을 뽑을 때 쓴 설정 그대로다. 이 값이 달라지면 프레임 크기·발 높이가 어긋나서 반입
스크립트를 다시 재야 한다.


| 항목         | 값                 |
| ---------- | ----------------- |
| Size       | **128 × 128**     |
| Template   | **mannequin**     |
| View       | **high top-down** |
| Directions | **8**             |


**애니메이션은 인물마다 다르다.**

- **서 있기만 하는 NPC (01~24, 27)** — 게임 안에서 한 발짝도 움직이지 않는다
(`StageScene`·`TutorialScene` 이 제자리 sprite 로 놓는다). **rotations 만 받으면 된다.**
지금 시트처럼 제자리에서 숨 쉬는 루프를 유지하고 싶으면 애니메이션 하나만 더 뽑는다.
Walking 은 받을 필요가 없다 — 크레딧과 시간만 든다.
- **순찰 로봇 (25·26)** — `EscapeScene` 에서 실제로 걷는다. **Walking 8프레임 × 4방향**까지 받는다
(주인공과 같은 구성).

## 2. 공통 꼬리말

모든 프롬프트가 **글자 하나까지 똑같은 꼬리말**로 끝난다. 이게 화풍을 묶어주는 장치라서
인물마다 손대면 안 된다.

```
muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow
```

단 **25·26·(24)** 는 사람이 아니라서 `muted earth-tone palette` 자리만 바꿔 쓴다. 그 자리를
흙빛으로 두면 검은 장갑판과 도자기 피부가 전부 흙색으로 죽는다. 바뀐 꼬리말은 표 안에
그대로 적어두었으니 통째로 복사하면 된다.

## 3. 공통 앞머리

```
top-down JRPG chibi sprite of a <나이·역할>, big head short limbs chibi proportions (head is 40% of total height), <머리> , <피부> , <표정·특징> , <옷 위> , <옷 장식> , <허리> , <옷 아래> , <신발> , <복장 한 줄> , <공통 꼬리말>
```

표의 프롬프트 칸은 이 자리를 전부 채운 **완성본**이다. 조립할 것 없이 칸을 통째로 복사해서
PixelLab 에 붙이면 된다.

---

## 4. 본부·거리 — 01 ~ 13


| #      | 이름 / 역할                | 게임 id                | PixelLab 프롬프트                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 비고                                                                                  |
| ------ | ---------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| ~~01~~ | ~~브란트 / 레지스탕스 간부 47남~~ | `officer` ~~(콘라트)~~  | `top-down JRPG chibi sprite of a 47-year-old resistance veteran commander, big head short limbs chibi proportions (head is 40% of total height), short swept-back grey-white hair with a full grey beard, weathered tanned skin, thick brows over stern narrow eyes, an old scar on the cheek, a broad barrel chest and thick arms, a faded olive-tan short-sleeved work shirt with rolled cuffs, dark brown heavy work trousers, a worn brown leather glove on the left hand, the entire right arm a brass mechanical automail prosthetic with visible pistons, brown leather work boots, steampunk resistance outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow` | ~~오른팔 오토메일이 실루엣의 핵심 — 빠지면 다시 뽑기~~                                                   |
| ~~02~~ | ~~에이다 / 병참·장부 18여~~    | `t2` ~~(미아)~~        | `top-down JRPG chibi sprite of an 18-year-old resistance quartermaster girl, big head short limbs chibi proportions (head is 40% of total height), light brown wavy hair tied in a low bun, fair skin, round brass-rimmed glasses over bright alert eyes, a cream white shirt with rolled sleeves, a red cloth armband on the upper left arm, a dark grey ink-stained sleeve protector on the right forearm, a wide brown leather belt with a small satchel at the hip, khaki tan trousers, tall brown leather boots, holding a small ledger against her chest, steampunk resistance outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                            | 바이블은 사무복이지만 일러스트는 카키 바지·부츠 — 일러스트를 따랐다                                              |
| ~~03~~ | ~~토마스 / 정보 관리 24남~~    | `t3` ~~(오토)~~        | `top-down JRPG chibi sprite of a 24-year-old resistance archivist young man, big head short limbs chibi proportions (head is 40% of total height), messy dark brown hair, pale skin with tired shadows under the eyes, round thin-rimmed glasses, a white shirt with rolled sleeves, a rust-red neckerchief at the throat, brown leather shoulder straps with small document pouches, a brass magnifying lens hanging on his chest, pale tan trousers, brown leather boots, steampunk resistance outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                                                                                |                                                                                     |
| ~~04~~ | ~~리아 / 장비 제작~~         | `t1` ~~(레나)~~        | `top-down JRPG chibi sprite of a middle-aged resistance equipment craftswoman, big head short limbs chibi proportions (head is 40% of total height), curly grey hair wrapped in a rust-red headscarf, brass welding goggles pushed up on her forehead, weathered tan skin, a stout heavy build with thick forearms, a rust-orange jacket with rolled sleeves over a cream shirt, a soot-stained tan work apron, a wide brown tool belt, a large steel monkey wrench in her right hand, brown work boots, steampunk resistance outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                                                   | **나이 충돌** — 바이블 본문 32세, 미드저니 칸·일러스트는 40~50대. 일러스트를 따라 나이를 적지 않았다                    |
| ~~05~~ | ~~에이던 / 시계 수리공 34남~~   | `watchmaker` (에이다)   | `top-down JRPG chibi sprite of a 34-year-old steampunk watchmaker man, big head short limbs chibi proportions (head is 40% of total height), black hair neatly combed back, pale skin, a brass jeweler's loupe monocle over the right eye, a calm quiet expression, a deep burgundy-red waistcoat over a white shirt with rolled sleeves, a dark necktie, a silver pocket watch chain on the vest, a brown leather pouch of small brass tools on the right hip, tan brown trousers, brown leather boots, steampunk watch-repair outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                                                 |                                                                                     |
| ~~06~~ | ~~엘라 / 클럽 여급 22여~~     | `maid` (리나)          | `top-down JRPG chibi sprite of a 22-year-old tavern waitress girl, big head short limbs chibi proportions (head is 40% of total height), wavy blonde shoulder-length hair loosely tied back, fair skin, a faint restrained smile, a cream white puff-sleeve blouse, a brown leather corset-style bodice laced at the front, a long cream apron skirt over a rust-red underskirt, dark fingerless gloves, brown ankle boots, steampunk tavern outfit, no headdress, not holding a tray, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                                                                                                  | 바이블 본문은 검은 메이드복이지만 일러스트는 선술집 차림 — `no headdress` 를 반드시 남길 것                         |
| ~~07~~ | ~~가레스 / 기관 정비공 41남~~   | `engineer` (보리스)     | `top-down JRPG chibi sprite of a 41-year-old steam engine mechanic man, big head short limbs chibi proportions (head is 40% of total height), short greying hair and a thick grey beard, a grease-smudged tanned face, broad shoulders, a cream shirt with rolled sleeves under faded blue-grey denim overalls, a rust-orange neckerchief around the neck, a brown leather tool belt with a large steel wrench, thick brown work gloves, brown work boots, steampunk mechanic outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                                                                                                   |                                                                                     |
| ~~08~~ | ~~실비아 / 밀수업자 29여~~     | *(보류)* `smuggler` 후보 | `top-down JRPG chibi sprite of a 29-year-old smuggler woman, big head short limbs chibi proportions (head is 40% of total height), dark auburn bob hair, pale skin, sharp mischievous eyes with a confident smirk, a deep red hooded traveler's cloak over the shoulders with the hood up, a fitted black leather coat and dark corset beneath, a wide brown belt covered in small pouches at the waist, a long dark skirt over dark trousers, dark brown boots, steampunk smuggler outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                                                                                             | 게임의 카이는 28**남**이라 성별 충돌로 보류 중 (`portrait-map.md`). 카이를 여성으로 바꾸기로 정하면 그대로 투입         |
| ~~09~~ | ~~루카스 / 의사 52남~~       | `musician` (노아)      | `top-down JRPG chibi sprite of a 52-year-old back-alley physician, big head short limbs chibi proportions (head is 40% of total height), grey-white hair combed back and a short white beard, pale lined skin, thin-rimmed glasses over gentle weary eyes, a slightly stooped posture, a long worn dark grey-brown coat over a pale shirt and dark vest, a brass stethoscope around the neck, a brown leather strap across the chest, a worn brown leather doctor's bag in one hand, dark trousers, brown leather shoes, steampunk street-doctor outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                                | **직업 불일치** — 게임 자리는 거리 악사인데 일러스트는 의사다. 초상이 이미 의사라 스프라이트도 의사로 맞췄다                    |
| ~~10~~ | ~~노아 / 신문팔이 15남~~      | *(자리 없음)* 시민         | `top-down JRPG chibi sprite of a 15-year-old newspaper boy, big head short limbs chibi proportions (head is 40% of total height), tousled dark curly hair under an old grey-blue flat cap, tanned skin, big curious eyes, a rust-orange neckerchief, an outgrown grey-blue jacket with short sleeves, a brown canvas newspaper bag slung across the shoulder, patched tan trousers cinched at the knee, scuffed brown boots, a folded newspaper in one hand, steampunk street urchin outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                                                                                            | 거리 시민 몹으로 쓰면 `chars.png` 시민 프레임을 대체 가능                                              |
| ~~11~~ | ~~미사 / 제빵사 38여~~       | *(자리 없음)* 시민         | `top-down JRPG chibi sprite of a 38-year-old baker woman, big head short limbs chibi proportions (head is 40% of total height), brown hair wrapped in a cream kerchief, a warm round face with a flour smudge on the cheek and a dimpled smile, a plump motherly build, a cream blouse with rolled sleeves over a faded blue-grey dress, a large flour-dusted white apron, a rust-red cloth tucked at the waist, brown leather ankle boots, steampunk town baker outfit, no oven, no background props, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                                                                                  | 원본 일러스트에 화덕 배경이 붙어 있다 — `no oven, no background props` 를 지우지 말 것                    |
| ~~12~~ | ~~벤 / 짐꾼 45남~~         | *(자리 없음)* 시민         | `top-down JRPG chibi sprite of a 45-year-old dock porter man, big head short limbs chibi proportions (head is 40% of total height), short grey hair and a short grey beard, a weathered tanned face with a square jaw and a silent stoic expression, a tall burly build, a dusty cream work shirt with rolled sleeves, a tall canvas carrying frame pack on his back, a thick brown leather back-support belt with a leather satchel, brown work gloves, dark olive work trousers, tan work boots, steampunk laborer outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                                                            | 등짐이 위에서 보면 몸을 다 덮는다 — 뭉개지면 `a tall canvas carrying frame pack on his back` 만 빼고 재시도 |
| ~~13~~ | ~~아이리스 / 꽃집 26여~~      | *(자리 없음)* 시민         | `top-down JRPG chibi sprite of a 26-year-old florist woman, big head short limbs chibi proportions (head is 40% of total height), soft brown hair tied low with a small orange flower pinned at the temple, fair skin, a warm gentle smile, a pale sage-green blouse with puff sleeves, a long cream apron dress over an olive skirt, a thin brown belt, brown ankle boots, a small bouquet of red and orange flowers in her arms, steampunk flower shop outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                                                                                                                        |                                                                                     |


## 5. 저택 — 14 ~ 23


| #      | 이름 / 역할             | 게임 id                                 | PixelLab 프롬프트                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 비고                                                                               |
| ------ | ------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ~~14~~ | ~~세드릭 / 수석 집사 58남~~ | `butler` (집사보)                        | `top-down JRPG chibi sprite of a 58-year-old head butler, big head short limbs chibi proportions (head is 40% of total height), neatly combed white hair, a pale lined face with calm unreadable grey eyes, an upright dignified posture, an impeccably pressed black tailcoat over a black waistcoat and a white shirt with a black bow tie, white gloves, a gold pocket watch chain, a large brass ring of keys hanging at the waist, black trousers, polished black shoes, victorian mansion butler outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                          | 검은 연미복이라 어두운 바닥에 묻힌다 — 흰 장갑·흰 셔츠가 실루엣을 살리는 유일한 대비                                |
| ~~15~~ | ~~클라라 / 요리장 44여~~   | `cook` (주방 직원)                        | `top-down JRPG chibi sprite of a 44-year-old head cook woman, big head short limbs chibi proportions (head is 40% of total height), grey-blonde hair under a tall white chef's toque, rosy plump cheeks and a hearty commanding smile, a cream-white cooking uniform with rolled sleeves, a large cream apron, a rust-brown neckerchief, brown leather gloves, a brown underskirt, brown leather boots, a long brass ladle over one shoulder, victorian mansion kitchen outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                                         | 위에서 보면 토크(모자)만 보인다 — 그게 오히려 식별점이라 그대로 둔다                                         |
| 16     | ~~오스카 / 정원사 36남~~   | `gardener` (정원사)                      | `top-down JRPG chibi sprite of a 36-year-old mansion gardener, big head short limbs chibi proportions (head is 40% of total height), dark shaggy hair and a short dark beard under a wide-brimmed straw hat, sun-tanned skin, a quiet reserved expression, an ochre-tan shirt with rolled sleeves, a brown leather strap across the chest, olive-green dirt-stained work trousers, a brown tool belt with red-handled pruning shears and a trowel, brown work boots, victorian mansion gardener outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                 | 밀짚모자 챙이 넓어 위에서 보면 얼굴을 다 가린다. 그래도 26인 중 유일한 원형 실루엣이라 식별에는 유리                      |
| 1~~7~~ | ~~에밀리 / 메이드 20여~~   | *(미배정)* `washer`·`shelver`·`diner` 후보 | `top-down JRPG chibi sprite of a 20-year-old mansion housemaid, big head short limbs chibi proportions (head is 40% of total height), red hair in a neat updo under a small white lace maid cap, pale freckled skin, large anxious eyes glancing sideways, a dark brown long-sleeved maid dress with puff shoulders and a white collar, a large white bibbed apron, white cuffs, brown ankle boots, victorian mansion maid outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                                                                                      | 저택 여성 근로자 자리 세 곳이 아직 placeholder 다 — 붙일 자리는 넉넉하다                                 |
| 18     | 빅터 / 경비병 39남        | *(자리 없음)*                             | `top-down JRPG chibi sprite of a 39-year-old mansion gate guard, big head short limbs chibi proportions (head is 40% of total height), short cropped greying dark hair, a stern square face with a tightly closed mouth and deep fatigue under the eyes, a rigid military posture, a dark navy-blue long guard coat with brass shoulder epaulettes and a red noble family crest badge on the chest, a brown leather belt with a baton and a whistle, dark gloves, dark navy trousers, brown leather boots, victorian mansion guard uniform, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`             | 저택에 인간 경비를 세우게 되면 바로 쓸 수 있는 유일한 인물                                               |
| 19     | 피터 / 시종 17남         | *(미배정)* `diner`·`shelver` 후보          | `top-down JRPG chibi sprite of a 17-year-old mansion page boy, big head short limbs chibi proportions (head is 40% of total height), neatly combed dark curly hair, pale skin, a cautious watchful gaze, a thin small frame, a worn brown short servant's jacket with oversized hand-me-down sleeves over a white collar shirt, brown knee breeches, brown ankle boots, clutching a small errand note, victorian mansion servant livery, no belt pouches, no weapons, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                                                   | `no belt pouches, no weapons` 는 원본 미드저니 프롬프트가 겪은 문제(모험가처럼 그려짐)를 막는 구절이다. 지우지 말 것 |
| 20     | 조셉 / 청소부 48남        | *(보류)* `cleaner` 후보                   | `top-down JRPG chibi sprite of a 48-year-old mansion cleaner, big head short limbs chibi proportions (head is 40% of total height), dishevelled greying hair and a scruffy grey beard, a reddish drinker's nose, a stooped slouching posture, a rust-orange ragged scarf around the neck, a long faded tan-beige work coat over a cream shirt, a brown belt with a cream rag tucked at the waist, a straw broom in one hand, brown work trousers, brown work boots, victorian mansion cleaner outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                   | 게임의 청소 직원은 30대**여**라 성별 충돌로 보류 중                                                 |
| 21     | 헤나 / 마부 31여         | *(자리 없음)*                             | `top-down JRPG chibi sprite of a 31-year-old mansion coachwoman, big head short limbs chibi proportions (head is 40% of total height), long wavy brown hair tied back, sun-tanned skin, bold confident eyes, a long olive-green coachman coat with a wide collar worn open, a brown high-collar jacket and brown riding breeches beneath, brown leather gloves, a coiled leather whip at the waist, tall brown riding boots, victorian coachman outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                                                                 |                                                                                  |
| 22     | 올리버 / 사무원 27남       | `clerk` (경리 직원)                       | `top-down JRPG chibi sprite of a 27-year-old mansion accounting clerk, big head short limbs chibi proportions (head is 40% of total height), black hair slicked back, pale skin, round glasses perched low on the nose, an ambitious calculating expression, a charcoal grey waistcoat over a white shirt, a rust-orange cravat, ink-stained sleeve protectors on both forearms, a pen tucked behind the ear, a small brown satchel on the hip, brown trousers, brown leather boots, a stack of documents in his arms, victorian mansion clerk outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow`  | 게임 자리는 50대남, 일러스트는 27남 — 나이 차는 그대로 두고 일러스트를 따랐다                                  |
| 23     | 사무엘 / 창고지기 55남      | *(자리 없음)*                             | `top-down JRPG chibi sprite of a 55-year-old mansion warehouse keeper, big head short limbs chibi proportions (head is 40% of total height), bald on top with white hair at the sides and a full white beard, a thin wiry build, small round reading glasses over suspicious narrowed eyes, a dark olive-green vest over a rust-red waistcoat and a cream shirt with rolled sleeves, a wide brown leather belt with a large brass ring of keys and a leather tool box on the hip, tan trousers, brown work boots, victorian mansion storekeeper outfit, muted earth-tone palette, dark outline, soft cel shading, transparent background, no drop shadow` | 열쇠 꾸러미가 세드릭(14)과 겹친다 — 나란히 세우지 말 것                                               |


## 6. 로봇·안드로이드·백작 — 24 ~ 27

이 넷만 꼬리말이 다르다. **흙빛 팔레트 자리를 각자의 색으로 바꿨다** — 그대로 두면 검은
장갑판과 도자기 피부가 전부 흙색으로 죽는다. 표의 칸을 통째로 복사하면 된다.


| #   | 이름 / 역할             | 게임 id               | PixelLab 프롬프트                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 비고                                                                                            |
| --- | ------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 24  | 에바 / 안드로이드          | *(자리 없음)* 스테이지 3 후보 | `top-down JRPG chibi sprite of an android girl resembling a 12-year-old aristocrat child, big head short limbs chibi proportions (head is 40% of total height), silver-white hair in elaborate ringlet curls, porcelain-smooth pale skin, glassy emotionless doll-like eyes, a high-necked long-sleeved ivory-cream Victorian dress with layered lace trim covering her fully to the wrists and neck, a pale blue-grey pleated underskirt, white lace gloves, dark red shoes, an uncannily precise doll-like posture, humanoid android, no exposed mechanical parts, pale ivory and cold silver palette, dark outline, soft cel shading, transparent background, no drop shadow` | 스테이지 3 심문 상대로 붙일 수 있는 유일한 인간형. `no exposed mechanical parts` 는 원본 설정(목덜미 이음새만 유일한 단서)을 지키는 구절 |
| 25  | 경비 로봇               | 스테이지 3 순찰           | `top-down JRPG chibi sprite of a bipedal steam-powered security robot, big head short limbs chibi proportions (head is 40% of total height), a round riveted brass helmet head with a single large glowing red lens eye, a heavy barrel-shaped body plated with tarnished brass and steel, two short steam exhaust stacks on the back venting white steam, a noble family crest engraved on the chest plate, thick piston arms with clamp hands, stubby armored legs, a stiff clunky posture, steampunk patrol automaton, tarnished brass and charcoal palette, dark outline, soft cel shading, transparent background, no drop shadow`                                          | **Walking 8프레임 × 4방향까지 받을 것** — `EscapeScene` 에서 실제로 순찰한다                                     |
| 26  | 전투 로봇               | 스테이지 3 (미투입)        | `top-down JRPG chibi sprite of a bipedal combat robot, big head short limbs chibi proportions (head is 40% of total height), a compact angular black head with multiple glowing red and amber sensor lenses arrayed across it, sleek black-coated armor plates over a dark charcoal frame with brass joint accents, a bladed forearm on the left arm and a built-in gun barrel on the right arm, a sharp menacing silhouette, a smooth predatory posture, steampunk hunter-killer automaton, black and dark brass palette, dark outline, soft cel shading, transparent background, no drop shadow`                                                                               | 25번과 한 화면에 서면 색(황동 vs 검정)으로 구분된다 — 그 대비를 위해 꼬리말 색을 갈랐다                                        |
| 27  | 알드리치 폰 바이스 / 백작 52남 | *(자리 없음)*           | `top-down JRPG chibi sprite of a 52-year-old tyrant count, big head short limbs chibi proportions (head is 40% of total height), silver hair combed back, pale skin, emotionless pale grey eyes, a brass mechanical monocle over the right eye, a black frock coat with gold thread embroidery over a dark waistcoat, a noble family crest brooch at the throat, black gloves, a black cane with a steel ornament in one hand, black trousers, polished black shoes, victorian aristocrat outfit, black and pale silver palette with gold accents, dark outline, soft cel shading, transparent background, no drop shadow`                                                       | 인게임 일러스트가 없는 유일한 인물 — `design/characters/portraits/count.png` 만 있다                            |


---

## 7. 뽑는 순서 (권장)

크레딧이 한정돼 있으면 **게임에 실제로 붙는 12자리부터** 뽑는다. 나머지는 자리가 정해진
뒤에 뽑아도 늦지 않다.

1. **1순위 — 지금 화면에 나오는 8인** (전용 아트가 이미 붙어 있어 갈아끼우면 바로 보인다)
 `01 브란트` `02 에이다` `03 토마스` `04 리아` `05 에이던` `06 엘라` `07 가레스` `09 루카스`
2. **2순위 — 저택 4인** (지금은 `chars.png` 32px 프레임을 쓰고 있어서 개선 폭이 가장 크다)
 `14 세드릭` `15 클라라` `16 오스카` `22 올리버`
3. **3순위 — 로봇 2종** (걷기까지 필요해서 가장 비싸다)
 `25 경비 로봇` `26 전투 로봇`
4. **4순위 — 자리 미정 11인** `08` `10` `11` `12` `13` `17` `18` `19` `20` `21` `23` `24` `27`

## 8. 뽑은 뒤에 걸리는 함정

주인공을 갈아끼울 때 실제로 밟은 것들이다 (`f02bd26` 커밋 메시지에 전말이 있다).

- **방향마다 발 높이가 다르게 나온다.** 주인공은 남 96 · 북 96 · 서/동 93 이라, 방향을 바꿀
때마다 인물이 5px 씩 튀었다. 반입할 때 **방향 묶음마다 통째로 정수 평행이동**해서 맞춘다.
묶음 안의 1~3px 은 손대면 안 된다 — 그게 걷는 반동이다.
→ `scripts/import-player-sprite.js` 가 그 처리를 이미 하고 있으니 NPC 용은 그걸 본떠 만든다.
- **텍스처 키와 애니메이션 키를 헷갈리면 인물이 4배로 커진다.** `add.sprite(x, y, key)` 의 세
번째 인자는 **텍스처** 키다. 애니메이션 키를 넣으면 Phaser 가 32×32 대체 텍스처로 배율을
역산해서 조용히 4배로 그린다. 화면으로는 "좀 크네" 정도라 놓치기 쉽다.
- **축척은 맵의 `charHeight` 가 정한다.** 주인공이 화면에서 88px 이다. NPC도 같은 자를 쓴다 —
인물마다 눈대중으로 맞추면 같은 방에 선 둘의 키가 어긋난다.
- **손 소품이 8방향 회전에서 뭉개질 수 있다.** 국자(15)·빗자루(20)·꽃다발(13)·신문(10)·
렌치(04)·왕진가방(09)이 해당한다. 뭉개지면 **그 소품 구절만 지우고** 다시 뽑는다 —
나머지 문장은 건드리지 않아야 인물이 같은 사람으로 남는다.
- **일러스트 배경이 딸려 나오는 원본이 있다.** 11번(화덕)이 그렇다. 프롬프트의
`no oven, no background props` 가 그 방어선이다.

