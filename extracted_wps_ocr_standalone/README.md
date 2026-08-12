# Extracted WPS OCR Standalone

This folder is a standalone local OCR package extracted from WPS OCR resources.
It excludes image-to-Excel, table recognition, WPS web UI, cloud APIs, and WPS account/login logic.

## Contents

```text
models/
  textbox_detect_v1.tflite   text-line detection model
  textbox_cls_v1.tflite      text direction classifier
  textbox_rec_v2.tflite      text recognition model
  ppocr_keys_v1.txt          recognition vocabulary

wps_ocr/
  engine.py                  reusable Python OCR engine

ocr_cli.py                   command-line runner
samples/
  sample_line.png            single-line sample
  detect_sample.png          two-line page sample
requirements.txt
```

## Important extraction detail

The original WPS model files are TFLite models with a 14-byte WPS prefix:

```text
KINGSOFTOFFICE
```

The models in this standalone folder have already had that prefix removed, so they can be loaded by LiteRT directly.

## Install runtime

Use Python 3.12+ on 64-bit Windows:

```powershell
python -m pip install -r requirements.txt
```

In this Codex environment, the tested Python is:

```powershell
C:\Users\nfksu\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe
```

## CLI usage

Single-line recognition:

```powershell
python ocr_cli.py --line samples\sample_line.png
```

Page recognition with rough line detection:

```powershell
python ocr_cli.py --page samples\detect_sample.png
```

Full JSON output:

```powershell
python ocr_cli.py --page samples\detect_sample.png --json
```

Model shape info:

```powershell
python ocr_cli.py --info
```

## Python API

```python
from wps_ocr import WpsOcrEngine

engine = WpsOcrEngine()
print(engine.recognize_line("samples/sample_line.png")["text"])
print(engine.recognize_page("samples/detect_sample.png")["text"])
```

## Verified output

For `samples/detect_sample.png`:

```text
中文识别测试123
WPSOCRTEST456
```

## Current limitations

- The line recognition model is directly callable and works well for cropped text lines.
- Page recognition uses a simple Python post-processor over `textbox_detect_v1.tflite` score maps.
- WPS native `OCRBoxDetectPostNode` box-merging logic is not fully reproduced.
- Text spaces may be dropped by the CTC-style decoder/model output, for example `WPS OCR TEST` can become `WPSOCRTEST`.
