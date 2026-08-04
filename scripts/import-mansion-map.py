# -*- coding: utf-8 -*-
"""
저택(스테이지 2) 맵 반입 — 코드네임: 태엽새

    python scripts/import-mansion-map.py

원본: design/맵/2스테이지_저택/
  760826519_...n.webp                  보이는 맵 (1872x1264)
  mansion_floorplan_collision_map.webp 충돌 맵   (1872x1264, 같은 좌표계)

출력: src/client/assets/mansion-bg.png      (1888x1280 = 59x40칸)
      src/client/assets/mansion-props.json  (walk 마스크 59x40)

── 왜 여백을 왼쪽·아래에 채우는가 ──

1872x1264 는 32 로 안 나눠떨어진다(58.5 x 39.5). 그런데 이 그림은 **지금 쓰던 배경과
같은 도면**이고, 실측하면 정확히 new(x+16, y) == cur(x, y) 다 (평균 오차 0.00).
즉 새 그림은 예전 것의 왼쪽에 16px 이 더 있고 아래 16px 이 없는 판이다.

그래서 **왼쪽 16 · 아래 16** 을 채우면 1888x1280 = 59x40 칸이 되고, 예전 좌표계와의
관계가 padded_x = cur_x + 32 — 정확히 **한 칸** 차이가 된다. 방·문·스폰을 col+1 로
옮기기만 하면 그대로 맞는다. 오른쪽에 채우면 반 칸이 어긋나 전부 다시 재야 한다.

아래 반 칸(row 39 의 아랫부분)은 그림이 없다. 어느 방도 쓰지 않는 자리다.

── 걷는 길 ──

충돌 맵은 바닥이 흰색, 벽·기둥·바깥이 검은색이다. 칸 안의 밝은 픽셀 비율이 기준을
넘으면 걸을 수 있는 칸으로 친다. 손으로 칠하던 마스크를 대신한다.
"""
import io
import json
import os
from PIL import Image

SRC = 'design/맵/2스테이지_저택'
VIS = os.path.join(SRC, '760826519_2096983204559217_5552567175664447904_n.webp')
COL = os.path.join(SRC, 'mansion_floorplan_collision_map.webp')
OUT_BG = 'src/client/assets/mansion-bg.png'
OUT_PROPS = 'src/client/assets/mansion-props.json'

TILE = 32
PAD_LEFT = 16
COLS, ROWS = 59, 40
W, H = COLS * TILE, ROWS * TILE  # 1888 x 1280

# 칸을 걷는 길로 치는 기준.
#   BRIGHT : 이 밝기를 넘으면 바닥 픽셀
#   RATIO  : 칸 안 바닥 픽셀이 이 비율을 넘으면 걸을 수 있는 칸
# 벽 위에 걸친 칸이 통째로 열리지 않게 절반보다 높게 잡았다.
BRIGHT = 110
RATIO = 0.60
# 문(아치)은 돌 테두리가 칸을 어둡게 만들어 위 기준에 못 미친다 — 실측하면 아치가 0.58,
# 확실한 벽이 0.42 로 겹친다. 그래서 그 사이는 **후보**로 두고, 마주 보는 두 쪽이 모두
# 바닥인 칸만 연다. 벽은 한쪽이 막혀 있어 안 열리고, 문은 양쪽이 방이라 열린다.
DOOR_RATIO = 0.44


def padded(path):
    """원본을 1888x1280 캔버스의 (PAD_LEFT, 0) 에 앉힌다. 늘리거나 줄이지 않는다."""
    im = Image.open(path).convert('RGBA')
    out = Image.new('RGBA', (W, H), (0, 0, 0, 255))
    out.paste(im, (PAD_LEFT, 0))
    return out


# ── 보이는 맵 ──────────────────────────────────────────────────
bg = padded(VIS)
os.makedirs(os.path.dirname(OUT_BG), exist_ok=True)
bg.convert('RGB').save(OUT_BG)

# ── 걷는 길 ────────────────────────────────────────────────────
col = padded(COL).convert('L')
px = col.load()
walk = []
for r in range(ROWS):
    row = []
    for c in range(COLS):
        lit = 0
        for y in range(r * TILE, (r + 1) * TILE, 2):
            for x in range(c * TILE, (c + 1) * TILE, 2):
                if px[x, y] >= BRIGHT:
                    lit += 1
        ratio = lit / 256.0
        row.append('1' if ratio >= RATIO else ('?' if ratio >= DOOR_RATIO else '0'))
    walk.append(row)

# 문 후보를 연다 — 마주 보는 두 쪽(위·아래 또는 좌·우)이 모두 바닥인 칸만.
def solid_floor(c, r):
    return 0 <= c < COLS and 0 <= r < ROWS and walk[r][c] == '1'


opened = 0
for r in range(ROWS):
    for c in range(COLS):
        if walk[r][c] != '?':
            continue
        if (solid_floor(c, r - 1) and solid_floor(c, r + 1)) or            (solid_floor(c - 1, r) and solid_floor(c + 1, r)):
            walk[r][c] = '1'
            opened += 1
        else:
            walk[r][c] = '0'

# 선언된 문을 연다.
#
# 문틀은 그림에서 어둡게 그려져 있어(실측 0.28~0.42, 확실한 벽과 겹친다) 밝기만으로는
# 열 수 없다. 그런데 mansion.json 의 doors 좌표는 그림의 아치와 정확히 맞는 것을
# 확인했으므로, 그 데이터를 믿고 강제로 연다 — 임계값을 낮춰 진짜 벽까지 여는 것보다 낫다.
#
# 두 문은 **일부러 닫아 둔다**:
#   key: 'lab'    연구실 — 열쇠를 얻으면 MansionScene.#syncLabDoor 가 벽 바디를 걷어낸다.
#                 여기서 미리 열면 열쇠 없이 걸어 들어간다.
#   locked: true  영영 잠긴 방 — 스테이지 3 복선이라 들어갈 수 없어야 한다.
MAP = json.load(io.open('src/client/assets/mansion.json', encoding='utf-8'))
doors = 0
for dr in MAP.get('doors', []):
    if dr.get('key') or dr.get('locked'):
        continue
    for r in range(dr['y'], dr['y'] + dr['h']):
        for c in range(dr['x'], dr['x'] + dr['w']):
            if 0 <= c < COLS and 0 <= r < ROWS and walk[r][c] != '1':
                walk[r][c] = '1'
                doors += 1

# ⚠ 행은 **문자열**이어야 한다. worldParts.buildColliders 가 walk[r][c] !== '1' 로
#   비교하므로 숫자 배열로 쓰면 1 !== '1' 이 늘 참이 되어 온 맵이 벽이 된다.
walk = [''.join(row) for row in walk]

props = json.load(io.open(OUT_PROPS, encoding='utf-8')) if os.path.exists(OUT_PROPS) else {}
props['_comment'] = (
    'walk 은 scripts/import-mansion-map.py 가 충돌 맵 그림(mansion_floorplan_collision_map.webp)'
    '에서 구워 낸다 — 손으로 칠하지 않는다. 1 이 걸을 수 있는 칸이다. 그림을 다시 받으면 '
    '스크립트를 다시 돌리면 된다. blocked 는 쓰지 않는다(마스크가 대신한다).'
)
props['walk'] = walk
io.open(OUT_PROPS, 'w', encoding='utf-8').write(json.dumps(props, ensure_ascii=False) + '\n')

open_cells = sum(r.count('1') for r in walk)
print('→ %s  %dx%d' % (OUT_BG, W, H))
print('→ %s  walk %dx%d · 걸을 수 있는 칸 %d (%.1f%%) · 아치로 연 칸 %d · 선언된 문으로 연 칸 %d'
      % (OUT_PROPS, COLS, ROWS, open_cells, 100.0 * open_cells / (COLS * ROWS), opened, doors))
print()
for r in range(ROWS):
    print('  %2d %s' % (r, walk[r].replace('1', '#').replace('0', '.')))
