# PaddleOCR bundled runtime

Place the offline ONNX models used by the built-in PaddleOCR provider here.

Required files for the first global shortcut OCR implementation:

- `ch_PP-OCRv5_mobile_det.onnx`
- `ch_ppocr_mobile_v2.0_cls_infer.onnx`
- `ch_PP-OCRv5_rec_mobile_infer.onnx`

These files are bundled into the installer through `tauri.conf.json`, so a
fresh installation on another computer can use local PaddleOCR without manual
downloads.
