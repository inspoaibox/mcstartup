from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter


class WpsOcrEngine:
    """Minimal standalone runner for the extracted WPS OCR models."""

    def __init__(self, model_dir: str | Path | None = None, num_threads: int = 1) -> None:
        root = Path(__file__).resolve().parents[1]
        self.model_dir = Path(model_dir) if model_dir else root / "models"
        self.num_threads = num_threads
        self.detect_model = self.model_dir / "textbox_detect_v1.tflite"
        self.direction_model = self.model_dir / "textbox_cls_v1.tflite"
        self.recognition_model = self.model_dir / "textbox_rec_v2.tflite"
        self.vocab_path = self.model_dir / "ppocr_keys_v1.txt"
        self.vocab = self._load_vocab()

    def model_info(self) -> dict[str, dict]:
        return {
            "detect": self._model_info(self.detect_model),
            "direction": self._model_info(self.direction_model),
            "recognition": self._model_info(self.recognition_model),
        }

    def recognize_line(self, image_path: str | Path) -> dict:
        input_data = self._preprocess_line_image(Path(image_path))
        text, confidence, logits = self._run_recognition(input_data)
        return {
            "image": str(image_path),
            "input_shape": list(input_data.shape),
            "output_shape": list(logits.shape),
            "text": text,
            "mean_confidence": confidence,
        }

    def recognize_page(self, image_path: str | Path, threshold: float = 0.3) -> dict:
        image_path = Path(image_path)
        detection = self.detect_text_lines(image_path, threshold=threshold)
        image = self._read_rgb(image_path)
        lines = []
        for item in detection["boxes"]:
            x0, y0, x1, y1 = item["box_original"]
            crop = image[y0:y1, x0:x1]
            if crop.size == 0:
                continue
            input_data = self._prepare_line_array(crop)
            text, confidence, logits = self._run_recognition(input_data)
            lines.append(
                {
                    "box_original": [x0, y0, x1, y1],
                    "text": text,
                    "mean_confidence": confidence,
                    "input_shape": list(input_data.shape),
                    "output_shape": list(logits.shape),
                }
            )
        return {
            "image": str(image_path),
            "detection": detection,
            "lines": lines,
            "text": "\n".join(line["text"] for line in lines),
        }

    def detect_text_lines(self, image_path: str | Path, threshold: float = 0.3) -> dict:
        input_data, original_size, resized_size, scale = self._preprocess_detection(Path(image_path))
        interpreter = Interpreter(model_path=str(self.detect_model), num_threads=self.num_threads)
        interpreter.allocate_tensors()
        input_detail = interpreter.get_input_details()[0]
        output_detail = interpreter.get_output_details()[0]
        interpreter.set_tensor(input_detail["index"], input_data)
        interpreter.invoke()
        score_map = interpreter.get_tensor(output_detail["index"])[0, :, :, 0]

        mask = (score_map > threshold).astype(np.uint8) * 255
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (29, 9))
        mask = cv2.dilate(mask, kernel, iterations=1)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        boxes: list[dict] = []
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            if w * h < 500 or h < 8 or w < 20:
                continue
            x0 = max(0, int((x - 8) / scale))
            y0 = max(0, int((y - 8) / scale))
            x1 = min(original_size[0], int((x + w + 8) / scale))
            y1 = min(original_size[1], int((y + h + 8) / scale))
            boxes.append(
                {
                    "box_960": [int(x), int(y), int(w), int(h)],
                    "box_original": [x0, y0, x1, y1],
                    "score_mean": float(score_map[y : y + h, x : x + w].mean()),
                }
            )
        boxes.sort(key=lambda item: (item["box_original"][1], item["box_original"][0]))
        return {
            "input_shape": list(input_data.shape),
            "original_size": list(original_size),
            "resized_size": list(resized_size),
            "scale": scale,
            "threshold": threshold,
            "score_min": float(score_map.min()),
            "score_max": float(score_map.max()),
            "boxes": boxes,
        }

    def _model_info(self, model_path: Path) -> dict:
        interpreter = Interpreter(model_path=str(model_path), num_threads=self.num_threads)
        interpreter.allocate_tensors()
        return {
            "model": str(model_path),
            "inputs": [
                {
                    "name": item["name"],
                    "shape": item["shape"].tolist(),
                    "shape_signature": item["shape_signature"].tolist(),
                    "dtype": str(item["dtype"]),
                }
                for item in interpreter.get_input_details()
            ],
            "outputs": [
                {
                    "name": item["name"],
                    "shape": item["shape"].tolist(),
                    "shape_signature": item["shape_signature"].tolist(),
                    "dtype": str(item["dtype"]),
                }
                for item in interpreter.get_output_details()
            ],
        }

    def _load_vocab(self) -> list[str]:
        chars = self.vocab_path.read_text(encoding="utf-8").splitlines()
        return ["blank"] + chars

    def _read_rgb(self, image_path: Path) -> np.ndarray:
        image = cv2.imdecode(np.fromfile(str(image_path), dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError(f"Cannot read image: {image_path}")
        return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    def _preprocess_line_image(self, image_path: Path, target_h: int = 48, max_w: int = 960) -> np.ndarray:
        return self._prepare_line_array(self._read_rgb(image_path), target_h=target_h, max_w=max_w)

    def _prepare_line_array(self, rgb: np.ndarray, target_h: int = 48, max_w: int = 960) -> np.ndarray:
        h, w = rgb.shape[:2]
        new_w = max(1, int(round(w * target_h / h)))
        new_w = min(max_w, new_w)
        resized = cv2.resize(rgb, (new_w, target_h), interpolation=cv2.INTER_LINEAR)
        arr = resized.astype(np.float32) * (2.0 / 255.0) - 1.0
        return arr[np.newaxis, :, :, :]

    def _preprocess_detection(self, image_path: Path) -> tuple[np.ndarray, tuple[int, int], tuple[int, int], float]:
        rgb = self._read_rgb(image_path)
        h, w = rgb.shape[:2]
        scale = min(960.0 / w, 960.0 / h)
        resized_w = int(round(w * scale))
        resized_h = int(round(h * scale))
        resized = cv2.resize(rgb, (resized_w, resized_h), interpolation=cv2.INTER_LINEAR)
        canvas = np.full((960, 960, 3), 255, dtype=np.uint8)
        canvas[:resized_h, :resized_w] = resized
        mean = np.array([0.48109378172549, 0.45752457890196, 0.40787054090196], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        arr = (canvas.astype(np.float32) / 255.0 - mean) / std
        return arr[np.newaxis, :, :, :], (w, h), (resized_w, resized_h), scale

    def _run_recognition(self, input_data: np.ndarray) -> tuple[str, float, np.ndarray]:
        interpreter = Interpreter(model_path=str(self.recognition_model), num_threads=self.num_threads)
        input_detail = interpreter.get_input_details()[0]
        interpreter.resize_tensor_input(input_detail["index"], input_data.shape, strict=False)
        interpreter.allocate_tensors()
        interpreter.set_tensor(input_detail["index"], input_data)
        interpreter.invoke()
        output_detail = interpreter.get_output_details()[0]
        logits = interpreter.get_tensor(output_detail["index"])
        text, confidences = self._ctc_decode(logits)
        confidence = float(np.mean(confidences)) if confidences else 0.0
        return text, confidence, logits

    def _ctc_decode(self, logits: np.ndarray) -> tuple[str, list[float]]:
        indices = logits.argmax(axis=-1)[0]
        probs = logits.max(axis=-1)[0]
        last = -1
        chars: list[str] = []
        confidences: list[float] = []
        for idx, prob in zip(indices.tolist(), probs.tolist()):
            if idx != 0 and idx != last and idx < len(self.vocab):
                chars.append(self.vocab[idx])
                confidences.append(float(prob))
            last = idx
        return "".join(chars), confidences
