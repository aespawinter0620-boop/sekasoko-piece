"""Remove the original white surround and resize the existing golden artwork.

Development-only dependency: Pillow. Committed outputs are served as static files.
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "assets" / "icons"


def main():
    source = ICONS / "sekasoko_icon_temp.png"
    with Image.open(source) as original:
        if original.format != "PNG" or original.width != original.height:
            raise ValueError("Use the supplied square PNG; do not substitute artwork")
        # Only the connected outside white area is replaced; internal highlights stay intact.
        bounds = ImageChops.difference(original, Image.new('RGB', original.size, 'white')).convert('L').point(lambda p: 255 if p > 80 else 0).getbbox()
        margin = min(bounds[0], bounds[1], original.width - bounds[2], original.height - bounds[3]) + 3
        background = original.getpixel((original.width // 2, margin + 5))
        square = original.copy()
        ImageDraw.floodfill(square, (0, 0), background, thresh=200)
        outside = ImageChops.difference(square, original).convert('L').point(lambda p: 255 if p else 0).filter(ImageFilter.MaxFilter(3))
        square.paste(background, mask=outside)
        square = square.crop((margin, margin, original.width - margin, original.height - margin))
        square.save(ICONS / 'icon-square.png', optimize=True)
        for size, name in (
            (180, "apple-touch-icon.png"),
            (32, "favicon-32x32.png"),
            (16, "favicon-16x16.png"),
        ):
            square.resize((size, size), Image.Resampling.LANCZOS).save(ICONS / name, optimize=True)
        square.save(ICONS / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print("Generated 180px touch icon, 16/32px PNG favicons and 16/32/48px ICO")


if __name__ == "__main__":
    main()
