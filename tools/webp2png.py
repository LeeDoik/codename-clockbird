"""design/맵/ 의 원본 webp 를 PNG 로 푼다 — 나머지 처리는 전부 node 가 한다.

    python tools/webp2png.py            # 계획서에 적힌 네 맵을 한 번에
    python tools/webp2png.py a.webp b.png

기획자가 받아 온 배틀맵은 webp 인데 node 로 webp 를 푸는 방법이 없다 (scripts/png.js 는
PNG 전용이고, 순수 JS 로 VP8 디코더를 짜는 건 이 일에 비해 터무니없이 크다). 그래서
**푸는 일만** 파이썬(Pillow)에 맡기고, 워터마크 지우기·자르기·맵 json 은 전부
scripts/import-map-art.js 가 이어받는다 — 로직은 한 언어에 모아 둔다.

푼 PNG 는 design/맵/_png/ 에 떨어진다 (gitignore — 원본 webp 에서 언제든 다시 만든다).
"""
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow 가 없다:  python -m pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "design" / "맵" / "_png"

# 맵 교체 계획(docs/맵교체_계획.md §2)에서 배경으로 굽기로 한 그림들.
SOURCES = [
    "1스테이지_거리/steampunk_city_map_1.webp",
    "1스테이지_거리/clean_town_square_base.webp",       # 걷는 길 시드용(완성본과 diff)
    "2스테이지_저택/760826519_2096983204559217_5552567175664447904_n.webp",
    "2스테이지_저택/mansion_floorplan_collision_map.webp",  # 걷는 길 시드용(기계가 읽는 충돌도)
    "3스테이지_지하 수로/empty_sewer_map.webp",
    "튜토리얼_본부/empty_stone_hideout.webp",           # 걷는 길 시드용(완성본과 diff)
]


def convert(src: Path, dst: Path) -> None:
    im = Image.open(src)
    # 배경은 전부 불투명하다 — 알파를 달면 PNG 가 25% 커지기만 한다.
    im = im.convert("RGBA") if im.mode == "RGBA" else im.convert("RGB")
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, optimize=True)
    print(f"{im.size[0]}x{im.size[1]}  {dst.relative_to(ROOT)}  ({dst.stat().st_size / 1024:.0f}KB)")


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) == 2:
        convert(Path(args[0]), Path(args[1]))
    elif args:
        sys.exit(__doc__)
    else:
        for rel in SOURCES:
            src = ROOT / "design" / "맵" / rel
            if not src.exists():
                print(f"⚠ 없음: {rel}")
                continue
            convert(src, OUT_DIR / (Path(rel).stem + ".png"))
        print(f"\n→ {OUT_DIR.relative_to(ROOT)}")
        print("   다음: node scripts/import-map-art.js <street|mansion|escape>")
