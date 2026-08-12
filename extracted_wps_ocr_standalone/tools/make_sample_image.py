from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def find_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
    ]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--text", action="append", required=True)
    parser.add_argument("--font-size", type=int, default=54)
    args = parser.parse_args()

    font = find_font(args.font_size)
    padding_x = 70
    padding_y = 55
    line_gap = 36
    dummy = Image.new("RGB", (10, 10), "white")
    draw = ImageDraw.Draw(dummy)
    boxes = [draw.textbbox((0, 0), line, font=font) for line in args.text]
    widths = [box[2] - box[0] for box in boxes]
    heights = [box[3] - box[1] for box in boxes]
    width = max(widths) + padding_x * 2
    height = sum(heights) + line_gap * (len(args.text) - 1) + padding_y * 2
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    y = padding_y
    for line, box, line_h in zip(args.text, boxes, heights):
        draw.text((padding_x, y - box[1]), line, fill="black", font=font)
        y += line_h + line_gap
    args.out.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.out)


if __name__ == "__main__":
    main()
