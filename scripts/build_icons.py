"""Resize the supplied temporary icon without cropping or changing its artwork.

Development-only dependency: Pillow. Committed outputs are served as static files.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "assets" / "icons"


def main():
    source = ICONS / "sekasoko_icon_temp.png"
    with Image.open(source) as original:
        if original.format != "PNG" or original.width != original.height:
            raise ValueError("Use the supplied square PNG; do not crop or substitute artwork")
        for size, name in (
            (180, "apple-touch-icon.png"),
            (32, "favicon-32x32.png"),
            (16, "favicon-16x16.png"),
        ):
            original.resize((size, size), Image.Resampling.LANCZOS).save(ICONS / name, optimize=True)
        original.save(ICONS / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print("Generated 180px touch icon, 16/32px PNG favicons and 16/32/48px ICO")


if __name__ == "__main__":
    main()
