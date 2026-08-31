#!/usr/bin/env python3
"""Generate the small category badges used by macOS file associations.

The source App icon remains the product icon. These derived icons are only used
for Finder-associated files, so changing the association style never changes
the App icon itself.
"""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "appicon.png"
OUTPUT = ROOT / "assets" / "file-icons"
SIZE = 1024

STYLES = {
    "classic": {
        "document": (52, 120, 246, 245),
        "media": (142, 68, 214, 245),
        "image": (18, 154, 128, 245),
        "archive": (221, 137, 27, 245),
    },
    "monochrome": {
        "document": (55, 65, 81, 245),
        "media": (75, 85, 99, 245),
        "image": (107, 114, 128, 245),
        "archive": (31, 41, 55, 245),
    },
    "vivid": {
        "document": (14, 116, 220, 245),
        "media": (220, 38, 127, 245),
        "image": (5, 168, 115, 245),
        "archive": (234, 125, 16, 245),
    },
}


def glyph(draw: ImageDraw.ImageDraw, kind: str, box: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = box
    white = (255, 255, 255, 255)
    if kind == "media":
        draw.polygon([(left + 80, top + 55), (right - 80, (top + bottom) // 2), (left + 80, bottom - 55)], fill=white)
    elif kind == "image":
        draw.ellipse((left + 70, top + 48, left + 150, top + 128), fill=white)
        draw.polygon([(left + 55, bottom - 58), (left + 145, bottom - 145), (left + 220, bottom - 80), (left + 292, bottom - 168), (right - 48, bottom - 58)], fill=white)
    elif kind == "archive":
        draw.rounded_rectangle((left + 55, top + 62, right - 55, bottom - 48), radius=28, outline=white, width=28)
        draw.line((left + 55, top + 142, right - 55, top + 142), fill=white, width=24)
        draw.line(((left + right) // 2 - 50, top + 62, (left + right) // 2 + 50, top + 62), fill=white, width=28)
    else:
        draw.polygon([(left + 72, top + 45), (right - 96, top + 45), (right - 52, top + 90), (right - 52, bottom - 45), (left + 72, bottom - 45)], fill=white)
        draw.line((left + 118, top + 170, right - 105, top + 170), fill=(92, 105, 125, 255), width=20)
        draw.line((left + 118, top + 235, right - 105, top + 235), fill=(92, 105, 125, 255), width=20)


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA").resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    for style, colours in STYLES.items():
        style_dir = OUTPUT / style
        style_dir.mkdir(parents=True, exist_ok=True)
        for kind, colour in colours.items():
            icon = source.copy()
            draw = ImageDraw.Draw(icon, "RGBA")
            badge = (SIZE - 360, SIZE - 360, SIZE - 36, SIZE - 36)
            draw.rounded_rectangle(badge, radius=64, fill=colour, outline=(255, 255, 255, 220), width=10)
            glyph(draw, kind, badge)
            icon.save(style_dir / f"{kind}icon.png", format="PNG", optimize=True)


if __name__ == "__main__":
    main()
