from __future__ import annotations

import argparse
import json
from pathlib import Path

from wps_ocr import WpsOcrEngine


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the extracted WPS OCR models locally.")
    parser.add_argument("image", nargs="?", type=Path, help="Image path to recognize.")
    parser.add_argument("--line", action="store_true", help="Treat the image as one text line.")
    parser.add_argument("--page", action="store_true", help="Detect text lines and recognize a page image.")
    parser.add_argument("--threshold", type=float, default=0.3, help="Detection score threshold for --page.")
    parser.add_argument("--model-dir", type=Path, default=None, help="Directory containing extracted OCR models.")
    parser.add_argument("--info", action="store_true", help="Print model input/output shapes.")
    parser.add_argument("--json", action="store_true", help="Print full JSON result.")
    args = parser.parse_args()

    engine = WpsOcrEngine(model_dir=args.model_dir)

    if args.info:
        print(json.dumps(engine.model_info(), ensure_ascii=False, indent=2))
        return

    if not args.image:
        raise SystemExit("image is required unless --info is used")

    if args.line and args.page:
        raise SystemExit("use only one of --line or --page")

    if args.line:
        result = engine.recognize_line(args.image)
    else:
        result = engine.recognize_page(args.image, threshold=args.threshold)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(result["text"])


if __name__ == "__main__":
    main()
