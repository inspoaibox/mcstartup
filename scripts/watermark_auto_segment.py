import base64
import io
import json
import sys
import argparse
from pathlib import Path

import cv2
import numpy as np
import segmentation_models_pytorch as smp
import torch
from PIL import Image

MAX_INFER_SIDE = 1280
MIN_COMPONENT_AREA = 20
MAX_MASK_RATIO = 0.35
TEXT_MASK_THRESHOLD = 0.26
LOGO_MASK_THRESHOLD = 0.34
PATTERN_MASK_THRESHOLD = 0.30
MAX_COMPONENT_AREA_RATIO = 0.18

SENSITIVITY_PROFILES = {
    "conservative": {
        "text_threshold": 0.32,
        "logo_threshold": 0.42,
        "pattern_threshold": 0.38,
        "min_component_area": 36,
    },
    "balanced": {
        "text_threshold": TEXT_MASK_THRESHOLD,
        "logo_threshold": LOGO_MASK_THRESHOLD,
        "pattern_threshold": PATTERN_MASK_THRESHOLD,
        "min_component_area": MIN_COMPONENT_AREA,
    },
    "aggressive": {
        "text_threshold": 0.20,
        "logo_threshold": 0.28,
        "pattern_threshold": 0.24,
        "min_component_area": 12,
    },
}

MODEL_SPECS = [
    ("segmenter_centered_text.pth", "centered_text"),
    ("segmenter_repeated_text.pth", "repeated_text"),
    ("segmenter_logo.pth", "logo"),
    ("segmenter_overlay_text.pth", "overlay_text"),
    ("segmenter_tiny_corner.pth", "tiny_corner"),
    ("segmenter_line_pattern.pth", "line_pattern"),
    ("segmenter_universal.pth", "universal"),
]

TEXT_MODELS = {"centered_text", "repeated_text", "overlay_text", "universal"}
LOGO_MODELS = {"logo", "tiny_corner", "universal"}
PATTERN_MODELS = {"line_pattern", "repeated_text", "universal"}

_MODEL_CACHE = {}
_FILTERED_EDGE_COMPONENTS = 0


def load_model(model_path: Path):
    key = str(model_path.resolve())
    cached = _MODEL_CACHE.get(key)
    if cached is not None:
        return cached

    model = smp.UnetPlusPlus(
        encoder_name="efficientnet-b4",
        encoder_weights=None,
        in_channels=3,
        classes=1,
    )
    state = torch.load(model_path, map_location="cpu")
    if isinstance(state, dict) and "state_dict" in state:
        state = state["state_dict"]
    if isinstance(state, dict):
        state = {
            (name[7:] if name.startswith("module.") else name): value
            for name, value in state.items()
        }
    model.load_state_dict(state, strict=True)
    model.eval()
    _MODEL_CACHE[key] = model
    return model


def build_settings(args):
    profile = SENSITIVITY_PROFILES.get(args.sensitivity, SENSITIVITY_PROFILES["balanced"])
    max_mask_ratio = float(np.clip(args.max_mask_ratio, 0.01, 0.50))
    return {
        **profile,
        "sensitivity": args.sensitivity,
        "mask_dilate": int(np.clip(args.mask_dilate, 0, 12)),
        "max_mask_ratio": max_mask_ratio,
        "edge_filter": not args.disable_edge_filter,
    }


def resize_with_padding(image: np.ndarray):
    height, width = image.shape[:2]
    scale = min(1.0, MAX_INFER_SIDE / max(height, width))
    resized_w = max(32, int(round(width * scale / 32.0)) * 32)
    resized_h = max(32, int(round(height * scale / 32.0)) * 32)
    resized = cv2.resize(image, (resized_w, resized_h), interpolation=cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR)
    pad_w = (32 - resized_w % 32) % 32
    pad_h = (32 - resized_h % 32) % 32
    padded = cv2.copyMakeBorder(
        resized,
        0,
        pad_h,
        0,
        pad_w,
        cv2.BORDER_REFLECT_101,
    )
    return padded, resized_w, resized_h, width, height


def infer_probability(model, image_rgb: np.ndarray):
    padded, resized_w, resized_h, orig_w, orig_h = resize_with_padding(image_rgb)
    tensor = torch.from_numpy(padded.transpose(2, 0, 1)).float().unsqueeze(0) / 255.0

    with torch.inference_mode():
        logits = model(tensor)
        probs = torch.sigmoid(logits)[0, 0].cpu().numpy()

    probs = probs[:resized_h, :resized_w]
    probs = cv2.resize(probs, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)
    return probs


def is_edge_strip(x: int, y: int, w: int, h: int, area: int, image_w: int, image_h: int, settings):
    if not settings.get("edge_filter", True):
        return False

    width_ratio = w / float(image_w or 1)
    height_ratio = h / float(image_h or 1)
    area_ratio = area / float((image_w or 1) * (image_h or 1))
    touches_horizontal_edge = y <= image_h * 0.04 or (y + h) >= image_h * 0.96
    touches_vertical_edge = x <= image_w * 0.04 or (x + w) >= image_w * 0.96

    if touches_horizontal_edge and width_ratio >= 0.68 and height_ratio <= 0.075:
        return True
    if touches_vertical_edge and height_ratio >= 0.68 and width_ratio <= 0.075:
        return True
    if touches_horizontal_edge and h <= max(8, image_h * 0.018) and area_ratio <= 0.006:
        return True
    if touches_vertical_edge and w <= max(8, image_w * 0.018) and area_ratio <= 0.006:
        return True

    aspect_ratio = max(w / max(h, 1), h / max(w, 1))
    if (touches_horizontal_edge or touches_vertical_edge) and aspect_ratio >= 18 and area_ratio <= 0.04:
        return True

    return False


def filter_components(mask: np.ndarray, max_mask_ratio: float, settings):
    global _FILTERED_EDGE_COMPONENTS
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    cleaned = np.zeros_like(mask)
    image_h, image_w = mask.shape[:2]
    min_component_area = int(settings.get("min_component_area", MIN_COMPONENT_AREA))
    for idx in range(1, num_labels):
        x, y, w, h, area = stats[idx].tolist()
        if area < min_component_area:
            continue
        if area > image_w * image_h * MAX_COMPONENT_AREA_RATIO:
            continue
        if is_edge_strip(x, y, w, h, area, image_w, image_h, settings):
            _FILTERED_EDGE_COMPONENTS += 1
            continue
        cleaned[labels == idx] = 255

    mask_ratio = float(np.count_nonzero(cleaned)) / float(cleaned.size or 1)
    if mask_ratio > max_mask_ratio:
        return np.zeros_like(cleaned), mask_ratio

    return cleaned, mask_ratio


def build_bright_text_hint(image_rgb: np.ndarray):
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (0, 0), 3.0)
    delta = gray.astype(np.int16) - blurred.astype(np.int16)
    min_c = image_rgb.min(axis=2).astype(np.int16)
    max_c = image_rgb.max(axis=2).astype(np.int16)
    color_span = max_c - min_c

    hint = np.where((delta >= 18) & (min_c >= 160) & (color_span <= 65), 255, 0).astype(np.uint8)
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 3))
    hint = cv2.morphologyEx(hint, cv2.MORPH_CLOSE, close_kernel, iterations=1)
    hint = cv2.dilate(hint, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3)), iterations=1)
    return hint


def clean_text_mask(probability: np.ndarray, image_rgb: np.ndarray, settings):
    bright_hint = build_bright_text_hint(image_rgb)
    simple_text_mask = cv2.morphologyEx(
        bright_hint,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (25, 5)),
        iterations=1,
    )
    simple_text_mask = cv2.dilate(
        simple_text_mask,
        cv2.getStructuringElement(cv2.MORPH_RECT, (7, 3)),
        iterations=1,
    )
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats((simple_text_mask > 0).astype(np.uint8), connectivity=8)
    direct_text_mask = np.zeros_like(simple_text_mask)
    image_area = float(bright_hint.shape[0] * bright_hint.shape[1] or 1)
    accepted_direct = 0
    for idx in range(1, num_labels):
        x, y, w, h, area = stats[idx].tolist()
        if area < 40 or area > image_area * 0.06:
            continue
        aspect_ratio = w / max(h, 1)
        if aspect_ratio < 1.8 or h > bright_hint.shape[0] * 0.15:
            continue

        region_prob = probability[y : y + h, x : x + w]
        region_pixels = labels[y : y + h, x : x + w] == idx
        if region_prob.size == 0 or not np.any(region_pixels):
            continue

        mean_prob = float(region_prob[region_pixels].mean())
        max_prob = float(region_prob[region_pixels].max())
        if mean_prob < 0.08 and max_prob < 0.20:
            continue

        direct_text_mask[labels == idx] = 255
        accepted_direct += 1

    if accepted_direct > 0:
        direct_text_mask = cv2.morphologyEx(
            direct_text_mask,
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_RECT, (19, 5)),
            iterations=1,
        )
        direct_text_mask = cv2.dilate(
            direct_text_mask,
            cv2.getStructuringElement(cv2.MORPH_RECT, (11, 5)),
            iterations=1,
        )
        return filter_components(direct_text_mask, 0.08, settings)

    hint_mask = np.zeros_like(bright_hint)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats((bright_hint > 0).astype(np.uint8), connectivity=8)
    for idx in range(1, num_labels):
        x, y, w, h, area = stats[idx].tolist()
        if area < 24 or area > image_area * 0.08:
            continue
        aspect_ratio = w / max(h, 1)
        if aspect_ratio < 1.2 or h > bright_hint.shape[0] * 0.18:
            continue

        region_prob = probability[y : y + h, x : x + w]
        region_pixels = labels[y : y + h, x : x + w] == idx
        if region_prob.size == 0 or not np.any(region_pixels):
            continue

        mean_prob = float(region_prob[region_pixels].mean())
        max_prob = float(region_prob[region_pixels].max())
        if mean_prob < 0.12 and max_prob < 0.28:
            continue

        hint_mask[labels == idx] = 255

    if np.count_nonzero(hint_mask) > 0:
        hint_mask = cv2.morphologyEx(
            hint_mask,
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_RECT, (11, 3)),
            iterations=1,
        )
        hint_mask = cv2.dilate(
            hint_mask,
            cv2.getStructuringElement(cv2.MORPH_RECT, (9, 3)),
            iterations=1,
        )
        return filter_components(hint_mask, 0.12, settings)

    mask = (probability >= settings["text_threshold"]).astype(np.uint8) * 255
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (17, 5))
    open_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    dilate_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, open_kernel, iterations=1)
    mask = cv2.dilate(mask, dilate_kernel, iterations=1)
    return filter_components(mask, 0.16, settings)


def clean_logo_mask(probability: np.ndarray, settings):
    mask = (probability >= settings["logo_threshold"]).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    return filter_components(mask, 0.08, settings)


def clean_pattern_mask(probability: np.ndarray, settings):
    mask = (probability >= settings["pattern_threshold"]).astype(np.uint8) * 255
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (11, 5))
    open_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, open_kernel, iterations=1)
    return filter_components(mask, 0.18, settings)


def apply_mask_dilation(mask: np.ndarray, radius: int):
    if radius <= 0 or np.count_nonzero(mask) == 0:
        return mask
    size = radius * 2 + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
    return cv2.dilate(mask, kernel, iterations=1)


def describe_components(mask: np.ndarray):
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), connectivity=8)
    image_h, image_w = mask.shape[:2]
    image_area = float(image_w * image_h or 1)
    components = []
    for idx in range(1, num_labels):
        x, y, w, h, area = stats[idx].tolist()
        components.append({
            "x": int(x),
            "y": int(y),
            "width": int(w),
            "height": int(h),
            "area": int(area),
            "ratio": round(float(area) / image_area, 6),
        })
    components.sort(key=lambda item: item["area"], reverse=True)
    return components


def encode_mask_data_url(mask: np.ndarray):
    image = Image.fromarray(mask, mode="L")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def main():
    global _FILTERED_EDGE_COMPONENTS
    _FILTERED_EDGE_COMPONENTS = 0

    if len(sys.argv) >= 2 and sys.argv[1] == "--validate-only":
        if len(sys.argv) < 3:
            raise SystemExit("usage: python watermark_auto_segment.py --validate-only <model_dir>")
        model_dir = Path(sys.argv[2])
        missing_models = []
        invalid_models = []
        loaded_models = []
        for filename, label in MODEL_SPECS:
            model_path = model_dir / filename
            if not model_path.is_file():
                missing_models.append(filename)
                continue
            try:
                load_model(model_path)
                loaded_models.append(label)
            except Exception as exc:
                invalid_models.append({"file": filename, "error": str(exc)})
        payload = {
            "ok": not missing_models and not invalid_models,
            "missingModels": missing_models,
            "invalidModels": invalid_models,
            "loadedModels": loaded_models,
        }
        print(json.dumps(payload, ensure_ascii=False))
        return

    if len(sys.argv) < 3:
        raise SystemExit("usage: python watermark_auto_segment.py <image_path> <model_dir>")

    parser = argparse.ArgumentParser(description="Automatic watermark mask segmentation")
    parser.add_argument("image_path")
    parser.add_argument("model_dir")
    parser.add_argument(
        "--sensitivity",
        choices=sorted(SENSITIVITY_PROFILES.keys()),
        default="balanced",
    )
    parser.add_argument("--mask-dilate", type=int, default=2)
    parser.add_argument("--max-mask-ratio", type=float, default=MAX_MASK_RATIO)
    parser.add_argument("--disable-edge-filter", action="store_true")
    args = parser.parse_args()
    settings = build_settings(args)

    image_path = Path(args.image_path)
    model_dir = Path(args.model_dir)

    if not image_path.is_file():
        raise SystemExit(f"image not found: {image_path}")
    if not model_dir.is_dir():
        raise SystemExit(f"model dir not found: {model_dir}")

    image = Image.open(image_path).convert("RGB")
    image_rgb = np.array(image)

    probability_maps = {}
    models_used = []
    for filename, label in MODEL_SPECS:
        model_path = model_dir / filename
        if not model_path.is_file():
            continue
        model = load_model(model_path)
        probability = infer_probability(model, image_rgb)
        probability_maps[label] = probability
        models_used.append(label)

    if not probability_maps:
        raise SystemExit("no available automatic watermark segmentation models found")

    text_maps = [probability_maps[label] for label in TEXT_MODELS if label in probability_maps]
    logo_maps = [probability_maps[label] for label in LOGO_MODELS if label in probability_maps]
    pattern_maps = [probability_maps[label] for label in PATTERN_MODELS if label in probability_maps]

    masks = []
    coverages = []

    if text_maps:
        text_probability = np.mean(text_maps, axis=0)
        text_mask, text_ratio = clean_text_mask(text_probability, image_rgb, settings)
        masks.append(text_mask)
        coverages.append(text_ratio)

    if logo_maps:
        logo_probability = np.max(np.stack(logo_maps, axis=0), axis=0)
        logo_mask, logo_ratio = clean_logo_mask(logo_probability, settings)
        masks.append(logo_mask)
        coverages.append(logo_ratio)

    if pattern_maps:
        pattern_probability = np.mean(pattern_maps, axis=0)
        pattern_mask, pattern_ratio = clean_pattern_mask(pattern_probability, settings)
        masks.append(pattern_mask)
        coverages.append(pattern_ratio)

    if not masks:
        raise SystemExit("automatic watermark segmentation produced no mask candidates")

    mask = np.maximum.reduce(masks)
    mask = apply_mask_dilation(mask, settings["mask_dilate"])
    mask, mask_ratio = filter_components(mask, settings["max_mask_ratio"], settings)
    components = describe_components(mask)
    warnings = []
    if _FILTERED_EDGE_COMPONENTS:
        warnings.append(f"filtered {_FILTERED_EDGE_COMPONENTS} edge-like components")
    if not components:
        warnings.append("no reliable watermark region detected")
    payload = {
        "maskDataUrl": encode_mask_data_url(mask),
        "coverage": mask_ratio,
        "modelsUsed": models_used,
        "width": image.width,
        "height": image.height,
        "components": components,
        "warnings": warnings,
        "settings": {
            "sensitivity": settings["sensitivity"],
            "maskDilate": settings["mask_dilate"],
            "maxMaskRatio": settings["max_mask_ratio"],
            "edgeFilter": settings["edge_filter"],
        },
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
