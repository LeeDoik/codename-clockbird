# -*- coding: utf-8 -*-
"""
저택(스테이지 2) 구역·문·걷는 길 — 코드네임: 태엽새

    python scripts/import-mansion-rooms.py

기획이 그려 준 두 장을 좌표로 옮긴다.
  design/맵/2스테이지_저택/방 구분 + 구역 이름.png   구역 경계와 이름
  design/맵/2스테이지_저택/캐릭터 이동 경로 + 문.jpg  빨간 선=이동 경로, 노란 상자=문

구역은 그림에 격자를 얹어 눈으로 읽어 아래 ROOMS 에 적었다(경계선이 두껍고 지도 자체에도
붉은 카펫·황동이 있어 색 추출은 신뢰할 수 없었다). 문과 경로는 색이 뚜렷해 그림에서 뽑는다.

걷는 길은 세 겹으로 쌓는다.
  1. 충돌 맵 그림의 흰 바닥            (import-mansion-map.py 가 구운 것)
  2. + 노란 문 상자가 덮는 칸          문틀이 어두워 1 에서 닫히는 자리
  3. + 빨간 경로선이 지나는 칸          기획이 "여기는 다녀야 한다"고 그은 선
연구실로 들어가는 문만 닫아 둔다 — 열쇠를 얻어야 열리는 방이라 미리 열면 걸어 들어간다.
"""
import io
import json
from collections import deque, Counter
from PIL import Image

TILE = 32
COLS, ROWS = 59, 40
PAD = 16                      # 네이티브(1872) 를 패딩 캔버스(1888) 에 앉힌 x 오프셋

MAP = 'src/client/assets/mansion.json'
PROPS = 'src/client/assets/mansion-props.json'
PATHS = 'design/맵/2스테이지_저택/캐릭터 이동 경로 + 문.jpg'

# 기획 그림에서 읽은 구역. (id, 이름, [사각형…])
#
# 방 하나가 사각형 여럿일 수 있다 — 아래 서재(아래)가 ㄱ자다. 기획이 화면에 빨간 펜으로
# 그려 준 모양이라 사각형 하나로는 담기지 않는다. 어둠 덮개도 사각형마다 하나씩 만든다.
ROOMS = [
    ('laundry', '세탁실',    [(7,  3, 12, 12)]),
    ('kitchen', '주방',      [(7, 15, 12, 10)]),
    ('storage', '창고',      [(7, 25, 12, 12)]),
    ('dining',  '식당',     [(19, 11,  8, 14)]),
    ('corr',    '중앙 복도', [(27, 11,  5, 16)]),
    ('lobby',   '로비',     [(19, 25, 18, 14)]),   # 현관 계단(row 38)까지 — 안 그러면 거기 선 동안 방이 없다
    ('study_n', '서재',     [(19,  2, 26,  9)]),
    ('empty',   '빈 방',    [(32, 11, 13,  6)]),
    ('study_s', '서재',     [(31, 18, 14,  9), (45, 21,  8,  6)]),
    ('lab',     '연구실',   [(45,  2,  9, 19)]),
    ('machine', '기계실',   [(37, 27, 16, 10)]),
]

# 연구실은 열쇠를 얻어야 들어간다 — 그 방으로 통하는 문은 마스크에서 닫아 둔다.
LOCKED_ROOM = 'lab'


def yellow_doors():
    """이동 경로 그림의 노란 상자 → 문이 덮는 칸 집합."""
    im = Image.open(PATHS).convert('RGB')
    W, H = im.size
    px = im.load()
    pts = {(x, y) for y in range(H) for x in range(W)
           if (lambda p: 215 <= p[0] <= 255 and 180 <= p[1] <= 230 and p[2] <= 100 and p[1] - p[2] > 90)(px[x, y])}
    seen, boxes = set(), []
    for p in list(pts):
        if p in seen:
            continue
        q = deque([p]); seen.add(p); grp = [p]
        while q:
            x, y = q.popleft()
            for dx in range(-3, 4):
                for dy in range(-3, 4):
                    n = (x + dx, y + dy)
                    if n in pts and n not in seen:
                        seen.add(n); q.append(n); grp.append(n)
        if len(grp) < 150:
            continue
        xs = [a for a, _ in grp]; ys = [b for _, b in grp]
        boxes.append((min(xs), min(ys), max(xs), max(ys)))
    cells = set()
    for x0, y0, x1, y1 in boxes:
        for r in range(y0 // TILE, y1 // TILE + 1):
            for c in (x0 + PAD) // TILE, (x1 + PAD) // TILE:
                pass
        for r in range(y0 // TILE, y1 // TILE + 1):
            for c in ((x0 + PAD) // TILE, ((x1 + PAD) // TILE) + 1):
                pass
        for r in range(y0 // TILE, y1 // TILE + 1):
            for c in range((x0 + PAD) // TILE, (x1 + PAD) // TILE + 1):
                if 0 <= c < COLS and 0 <= r < ROWS:
                    cells.add((c, r))
    return boxes, cells


def red_paths():
    """이동 경로 그림의 빨간 선이 지나는 칸."""
    im = Image.open(PATHS).convert('RGB')
    W, H = im.size
    px = im.load()
    cells = set()
    for y in range(H):
        for x in range(W):
            r, g, b = px[x, y]
            if r > 150 and g < 80 and b < 80 and r - g > 90 and r - b > 90:
                c, rr = (x + PAD) // TILE, y // TILE
                if 0 <= c < COLS and 0 <= rr < ROWS:
                    cells.add((c, rr))
    return cells


def room_of(c, r):
    for rid, _n, rects in ROOMS:
        for x, y, w, h in rects:
            if x <= c < x + w and y <= r < y + h:
                return rid
    return None


def bbox(rects):
    x0 = min(x for x, _y, _w, _h in rects); y0 = min(y for _x, y, _w, _h in rects)
    x1 = max(x + w for x, _y, w, _h in rects); y1 = max(y + h for _x, y, _w, h in rects)
    return x0, y0, x1 - x0, y1 - y0


# ── 걷는 길 ────────────────────────────────────────────────────
walk = [list(row) for row in json.load(io.open(PROPS, encoding='utf-8'))['walk']]
boxes, door_cells = yellow_doors()
path_cells = red_paths()

def gap_between_floors(c, r):
    """이 칸의 마주 보는 두 쪽이 모두 바닥인가 — 즉 진짜 통로인가."""
    def floor(a, b):
        return 0 <= a < COLS and 0 <= b < ROWS and walk[b][a] == '1'
    return (floor(c, r - 1) and floor(c, r + 1)) or (floor(c - 1, r) and floor(c + 1, r))


# 노란 문 상자와 빨간 경로선이 지나는 칸을 연다.
#
# ⚠ 무조건 열면 안 된다. 선은 손으로 두껍게 그은 것이라 벽 위를 지나가기도 하고, 지도
#   바깥 검은 여백까지 스친다 — 처음에는 그렇게 열었다가 (40,1)·(46,1) 처럼 저택 밖이
#   걸을 수 있게 뚫렸다. 그래서 **마주 보는 두 쪽이 모두 바닥인 칸만** 연다. 진짜 문틀은
#   양쪽이 방이라 열리고, 벽 한가운데나 바깥은 한쪽이 막혀 있어 안 열린다.
opened_door = opened_path = held = skipped = 0
for c, r in sorted(door_cells | path_cells):
    if walk[r][c] == '1':
        continue
    # 연구실로 들어가는 자리는 열지 않는다 (열쇠로 여는 방).
    if room_of(c, r) == LOCKED_ROOM:
        held += 1
        continue
    if not gap_between_floors(c, r):
        skipped += 1
        continue
    walk[r][c] = '1'
    if (c, r) in door_cells:
        opened_door += 1
    else:
        opened_path += 1

# 연구실을 봉한다.
#
# 충돌 맵 그림에는 서재(아래)에서 연구실로 넘어가는 아치가 열린 채로 그려져 있어,
# 그대로 두면 열쇠 없이 걸어 들어간다. 그래서 **바깥 방과 맞닿은 연구실 칸을 전부 막는다** —
# 열쇠 문이 덮는 칸도 함께 막힌다. 열쇠를 얻으면 MansionScene.#syncLabDoor 가 그 칸의
# 벽 바디를 걷어내므로, 문이 유일한 입구가 된다.
sealed = 0
for r in range(ROWS):
    for c in range(COLS):
        if walk[r][c] != '1' or room_of(c, r) != LOCKED_ROOM:
            continue
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (c + dc, r + dr)
            if (0 <= n[0] < COLS and 0 <= n[1] < ROWS and walk[n[1]][n[0]] == '1'
                    and room_of(*n) not in (None, LOCKED_ROOM)):
                walk[r][c] = '0'
                sealed += 1
                break

walk = [''.join(row) for row in walk]
props = json.load(io.open(PROPS, encoding='utf-8'))
props['_comment'] = (
    'walk 은 두 스크립트가 겹쳐 만든다. ① import-mansion-map.py 가 충돌 맵 그림의 흰 바닥을 굽고, '
    '② import-mansion-rooms.py 가 기획이 그린 "캐릭터 이동 경로 + 문" 의 노란 문 상자와 빨간 경로선이 '
    '지나는 칸을 덧연다. 문틀은 그림에서 어둡게 그려져 ① 만으로는 닫히기 때문이다. '
    '연구실로 들어가는 자리는 일부러 닫아 둔다 — 열쇠를 얻으면 MansionScene.#syncLabDoor 가 벽 바디를 '
    '걷어낸다. 1 이 걸을 수 있는 칸이고, 행은 **문자열**이어야 한다(worldParts 가 !== "1" 로 비교한다).'
)
props['walk'] = walk
io.open(PROPS, 'w', encoding='utf-8').write(json.dumps(props, ensure_ascii=False) + '\n')

# ── 구역·문 ────────────────────────────────────────────────────
m = json.load(io.open(MAP, encoding='utf-8'))
def as_room(rid, n, rects):
    x, y, w, h = bbox(rects)
    d = {'id': rid, 'name': n, 'x': x, 'y': y, 'w': w, 'h': h}
    # 사각형이 둘 이상이면 그대로 내보낸다 — 씬이 조각마다 덮개를 만든다.
    if len(rects) > 1:
        d['rects'] = [{'x': a, 'y': b, 'w': c2, 'h': d2} for a, b, c2, d2 in rects]
    return d


m['rooms'] = [as_room(rid, n, rects) for rid, n, rects in ROOMS]

# 노란 상자를 문으로 옮긴다.
#
# 기획은 문 하나를 문짝 두 개로 그렸다 — 나란히 붙은 두 상자가 한 문이다. 그 둘만 묶어야
# 하는데, 처음에는 "1칸 안이면 묶는다"로 잡았다가 **서로 다른 문까지 한 덩어리**가 됐다
# (창고·로비 쪽이 6×9칸짜리 뭉텅이가 됐다). 그래서 조건을 둘로 좁혔다.
#   · 한 축으로는 서로 겹쳐 있고 (같은 문틀에 나란히 붙어 있다는 뜻)
#   · 다른 축의 틈이 반 칸 미만 (문짝 사이의 선 두께 정도)
GAP = TILE // 2


def pairable(a, b):
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    x_ov = min(ax1, bx1) - max(ax0, bx0)
    y_ov = min(ay1, by1) - max(ay0, by0)
    x_gap = max(ax0, bx0) - min(ax1, bx1)
    y_gap = max(ay0, by0) - min(ay1, by1)
    # 세로로 겹치며 가로로 붙어 있다 (좌우 문짝)
    if y_ov > 0 and x_gap < GAP:
        return True
    # 가로로 겹치며 세로로 붙어 있다 (위아래 문짝)
    return x_ov > 0 and y_gap < GAP


merged = []
for box in sorted(boxes, key=lambda b: (b[1], b[0])):
    for i, seen_box in enumerate(merged):
        if pairable(box, seen_box):
            merged[i] = (min(seen_box[0], box[0]), min(seen_box[1], box[1]),
                         max(seen_box[2], box[2]), max(seen_box[3], box[3]))
            break
    else:
        merged.append(box)

doors = []
for x0, y0, x1, y1 in merged:
    c0, c1 = (x0 + PAD) // TILE, (x1 + PAD) // TILE
    r0, r1 = y0 // TILE, y1 // TILE
    # 문이 가르는 두 방 — 상자 둘레에서 가장 많이 닿는 방 둘.
    near = Counter()
    for c in range(c0 - 1, c1 + 2):
        for r in range(r0 - 1, r1 + 2):
            rid = room_of(c, r)
            if rid:
                near[rid] += 1
    between = [k for k, _ in near.most_common(2)]
    # 방 하나에만 닿는 상자는 문이 아니다 — 방 안쪽을 표시한 것이라 버린다.
    if len(between) < 2:
        continue
    doors.append({'x': c0, 'y': r0, 'w': c1 - c0 + 1, 'h': r1 - r0 + 1, 'between': between})

# 연구실 입구 중 하나에만 열쇠를 건다 — 입구가 여럿이면 열쇠의 의미가 사라지므로,
# 나머지 입구는 마스크에서 닫힌 채로 둔다(walk 단계에서 이미 안 열었다).
# MansionScene 이 key === 'lab' 로 이 문을 찾는다.
lab_doors = [d for d in doors if LOCKED_ROOM in d['between']]
if lab_doors:
    lab_doors[0]['key'] = 'lab'
m['doors'] = doors
io.open(MAP, 'w', encoding='utf-8').write(json.dumps(m, ensure_ascii=False, indent=2) + '\n')

# ── 보고 ───────────────────────────────────────────────────────
print('노란 문 상자 %d개 → 문 %d개 · %d칸 · 빨간 경로 %d칸'
      % (len(boxes), len(m['doors']), len(door_cells), len(path_cells)))
for dr in m['doors']:
    print('    문 (%2d,%2d) %d×%d  %s%s'
          % (dr['x'], dr['y'], dr['w'], dr['h'], '-'.join(dr['between']), '  [열쇠]' if dr.get('key') else ''))
print('덧연 칸: 문 %d · 경로 %d · 연구실이라 안 연 칸 %d · 통로가 아니라 안 연 칸 %d · 연구실 봉한 칸 %d'
      % (opened_door, opened_path, held, skipped, sealed))
total = sum(r.count('1') for r in walk)
print('걷는 칸 %d (%.1f%%)' % (total, 100.0 * total / (COLS * ROWS)))

sp = m['spawns']['player']
seen = {(sp['col'], sp['row'])}
q = deque(seen)
while q:
    c, r = q.popleft()
    for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        n = (c + dc, r + dr)
        if 0 <= n[0] < COLS and 0 <= n[1] < ROWS and n not in seen and walk[n[1]][n[0]] == '1':
            seen.add(n); q.append(n)
print('스폰에서 닿는 칸 %d (%.1f%%)' % (len(seen), 100.0 * len(seen) / total))
print()
for rid, n, rects in ROOMS:
    cells = [(c, r) for x, y, w, h in rects
             for r in range(y, y + h) for c in range(x, x + w)
             if 0 <= c < COLS and 0 <= r < ROWS and walk[r][c] == '1']
    reach = [p for p in cells if p in seen]
    tag = '  ← 열쇠로 여는 방' if rid == LOCKED_ROOM else ''
    mark = 'OK' if cells and len(reach) == len(cells) else ('부분' if reach else '못감')
    print('  %-8s %-6s %-4s %3d/%3d%s' % (rid, n, mark, len(reach), len(cells), tag))
