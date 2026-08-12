use crate::ocr::{BoundingBox, OcrResult, TextBlock};
use base64::{engine::general_purpose, Engine as _};
use image::RgbImage;
use paddle_ocr_rs::ocr_lite::OcrLite;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const RESOURCE_ROOT: &str = "paddle-ocr";
const DET_MODEL: &str = "ch_PP-OCRv5_mobile_det.onnx";
const CLS_MODEL: &str = "ch_ppocr_mobile_v2.0_cls_infer.onnx";
const REC_MODEL: &str = "ch_PP-OCRv5_rec_mobile_infer.onnx";

const OCR_PADDING: u32 = 50;
const OCR_MAX_SIDE: u32 = 1024;
const OCR_BOX_SCORE_THRESH: f32 = 0.5;
const OCR_BOX_THRESH: f32 = 0.3;
const OCR_UNCLIP_RATIO: f32 = 1.6;
const OCR_ANGLE_ROLLBACK_THRESHOLD: f32 = 0.8;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PaddleOcrEnvironment {
    pub available: bool,
    pub message: String,
    pub runtime_dir: String,
    pub det_model: String,
    pub cls_model: String,
    pub rec_model: String,
    pub missing: Vec<String>,
}

#[derive(Debug, Clone)]
struct PaddleOcrResolvedEnvironment {
    runtime_dir: PathBuf,
    det_model: PathBuf,
    cls_model: PathBuf,
    rec_model: PathBuf,
    missing: Vec<String>,
}

struct CachedPaddleOcr {
    runtime_dir: PathBuf,
    ocr: OcrLite,
}

fn paddle_ocr_state() -> &'static Mutex<Option<CachedPaddleOcr>> {
    static STATE: OnceLock<Mutex<Option<CachedPaddleOcr>>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(None))
}

pub fn detect_paddle_ocr_environment() -> Result<PaddleOcrEnvironment, String> {
    Ok(paddle_ocr_environment_status(
        resolve_paddle_ocr_environment()?,
    ))
}

pub fn prepare_paddle_ocr_environment() -> Result<PaddleOcrEnvironment, String> {
    let resolved = resolve_paddle_ocr_environment()?;
    if !resolved.missing.is_empty() {
        return Ok(paddle_ocr_environment_status(resolved));
    }

    with_paddle_ocr(&resolved, |_| Ok(()))?;
    Ok(paddle_ocr_environment_status(resolved))
}

pub fn stop_paddle_ocr() {
    if let Ok(mut guard) = paddle_ocr_state().lock() {
        *guard = None;
    }
}

pub fn recognize(image_base64: &str) -> Result<OcrResult, String> {
    let resolved = resolve_paddle_ocr_environment()?;
    if !resolved.missing.is_empty() {
        return Err(format!(
            "PaddleOCR 本地运行时未就绪: {}",
            resolved.missing.join("；")
        ));
    }

    let image = decode_image(image_base64)?;
    let result = with_paddle_ocr(&resolved, |ocr| {
        ocr.detect_angle_rollback(
            &image,
            OCR_PADDING,
            OCR_MAX_SIDE,
            OCR_BOX_SCORE_THRESH,
            OCR_BOX_THRESH,
            OCR_UNCLIP_RATIO,
            true,
            false,
            OCR_ANGLE_ROLLBACK_THRESHOLD,
        )
        .map_err(|error| format!("PaddleOCR 识别失败: {}", error))
    })?;

    let mut confidence_values = Vec::new();
    let text_blocks = result
        .text_blocks
        .into_iter()
        .filter(|block| !block.text.trim().is_empty())
        .map(|block| {
            if block.text_score.is_finite() && block.text_score > 0.0 {
                confidence_values.push(block.text_score.min(1.0) as f64);
            }
            let (left, top, width, height) = bounding_box_from_points(&block.box_points);
            TextBlock {
                text: block.text,
                location: BoundingBox {
                    left,
                    top,
                    width,
                    height,
                },
            }
        })
        .collect::<Vec<_>>();

    let text = text_blocks
        .iter()
        .map(|block| block.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let confidence = if confidence_values.is_empty() {
        None
    } else {
        Some(confidence_values.iter().sum::<f64>() / confidence_values.len() as f64)
    };

    Ok(OcrResult {
        text,
        confidence,
        words: None,
        text_blocks: Some(text_blocks),
    })
}

fn with_paddle_ocr<T>(
    resolved: &PaddleOcrResolvedEnvironment,
    run: impl FnOnce(&mut OcrLite) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = paddle_ocr_state()
        .lock()
        .map_err(|_| "PaddleOCR 模型状态锁定失败".to_string())?;
    let needs_reload = guard
        .as_ref()
        .map(|cached| cached.runtime_dir != resolved.runtime_dir)
        .unwrap_or(true);

    if needs_reload {
        let thread_count = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .min(8);
        let mut ocr = OcrLite::new();
        ocr.init_models(
            &path_to_string(&resolved.det_model),
            &path_to_string(&resolved.cls_model),
            &path_to_string(&resolved.rec_model),
            thread_count,
        )
        .map_err(|error| format!("加载 PaddleOCR 模型失败: {}", error))?;
        *guard = Some(CachedPaddleOcr {
            runtime_dir: resolved.runtime_dir.clone(),
            ocr,
        });
    }

    let cached = guard
        .as_mut()
        .ok_or_else(|| "PaddleOCR 模型初始化失败".to_string())?;
    run(&mut cached.ocr)
}

fn decode_image(image_base64: &str) -> Result<RgbImage, String> {
    let image_data = general_purpose::STANDARD
        .decode(image_base64)
        .map_err(|error| format!("Base64解码失败: {}", error))?;
    image::load_from_memory(&image_data)
        .map_err(|error| format!("读取 OCR 图片失败: {}", error))
        .map(|image| image.to_rgb8())
}

fn bounding_box_from_points(points: &[paddle_ocr_rs::ocr_result::Point]) -> (i32, i32, i32, i32) {
    if points.is_empty() {
        return (0, 0, 0, 0);
    }
    let min_x = points.iter().map(|point| point.x).min().unwrap_or(0);
    let min_y = points.iter().map(|point| point.y).min().unwrap_or(0);
    let max_x = points.iter().map(|point| point.x).max().unwrap_or(min_x);
    let max_y = points.iter().map(|point| point.y).max().unwrap_or(min_y);
    (
        min_x as i32,
        min_y as i32,
        max_x.saturating_sub(min_x) as i32,
        max_y.saturating_sub(min_y) as i32,
    )
}

fn resolve_paddle_ocr_environment() -> Result<PaddleOcrResolvedEnvironment, String> {
    let mut first_existing = None;
    for root in paddle_ocr_resource_roots() {
        if !root.exists() {
            continue;
        }
        let resolved = build_paddle_ocr_environment(root);
        if resolved.missing.is_empty() {
            return Ok(resolved);
        }
        if first_existing.is_none() {
            first_existing = Some(resolved);
        }
    }

    if let Some(resolved) = first_existing {
        return Ok(resolved);
    }

    Err("未找到内置 PaddleOCR 运行时，请确认应用资源目录包含 resources/paddle-ocr。".to_string())
}

fn build_paddle_ocr_environment(runtime_dir: PathBuf) -> PaddleOcrResolvedEnvironment {
    let det_model = runtime_dir.join(DET_MODEL);
    let cls_model = runtime_dir.join(CLS_MODEL);
    let rec_model = runtime_dir.join(REC_MODEL);
    let mut missing = Vec::new();
    for (label, path) in [
        ("文字检测模型", &det_model),
        ("文本行方向模型", &cls_model),
        ("文字识别模型", &rec_model),
    ] {
        if !path.is_file() {
            missing.push(format!("缺少 {} {}", label, path.display()));
        }
    }

    PaddleOcrResolvedEnvironment {
        runtime_dir,
        det_model,
        cls_model,
        rec_model,
        missing,
    }
}

fn paddle_ocr_environment_status(resolved: PaddleOcrResolvedEnvironment) -> PaddleOcrEnvironment {
    let available = resolved.missing.is_empty();
    PaddleOcrEnvironment {
        available,
        message: if available {
            "PaddleOCR 本地运行时已就绪".to_string()
        } else {
            "内置 PaddleOCR 尚未就绪，请检查打包模型文件".to_string()
        },
        runtime_dir: path_to_string(&resolved.runtime_dir),
        det_model: path_to_string(&resolved.det_model),
        cls_model: path_to_string(&resolved.cls_model),
        rec_model: path_to_string(&resolved.rec_model),
        missing: resolved.missing,
    }
}

fn paddle_ocr_resource_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.join("resources").join(RESOURCE_ROOT));
        }
    }
    roots.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(RESOURCE_ROOT),
    );
    roots
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
