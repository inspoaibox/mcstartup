use crate::ocr::{BoundingBox, OcrResult, TextBlock};
use base64::{engine::general_purpose, Engine as _};
use edgefirst_tflite::{Interpreter, Library, Model};
use image::imageops::{self, FilterType};
use image::{Rgb, RgbImage};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const RESOURCE_ROOT: &str = "wps-ocr";
const DET_MODEL: &str = "textbox_detect_v1.tflite";
const CLS_MODEL: &str = "textbox_cls_v1.tflite";
const REC_MODEL: &str = "textbox_rec_v2.tflite";
const VOCAB_FILE: &str = "ppocr_keys_v1.txt";
const TFLITE_LIBRARY: &str = "tensorflowlite_c.dll";

const WPS_INSTALL_DIR: &str = r"D:\Program Files\wpsoffice\WPS Office";
const DET_INPUT_SIZE: u32 = 960;
const DET_THRESHOLD: f32 = 0.3;
const DET_DILATE_WIDTH: usize = 29;
const DET_DILATE_HEIGHT: usize = 9;
const DET_MIN_AREA: usize = 500;
const LINE_HEIGHT: u32 = 48;
const LINE_MAX_WIDTH: u32 = 960;
const CLS_WIDTH: u32 = 192;
const CLS_ROTATE_THRESHOLD: f32 = 0.8;
const LATIN_SPACE_GAP_FACTOR: f32 = 1.42;

static TFLITE_RUNTIME: OnceLock<Library> = OnceLock::new();

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WpsOcrEnvironment {
    pub available: bool,
    pub message: String,
    pub runtime_dir: String,
    pub install_dir: String,
    pub det_model: String,
    pub cls_model: String,
    pub rec_model: String,
    pub vocab_path: String,
    pub runtime_library: String,
    pub missing: Vec<String>,
}

#[derive(Debug, Clone)]
struct WpsOcrResolvedEnvironment {
    runtime_dir: PathBuf,
    install_dir: Option<PathBuf>,
    det_model: PathBuf,
    cls_model: PathBuf,
    rec_model: PathBuf,
    vocab_path: PathBuf,
    runtime_library: PathBuf,
    missing: Vec<String>,
}

#[derive(Clone, Debug)]
struct DetectedLine {
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
}

#[derive(Debug)]
struct TensorOutput {
    shape: Vec<usize>,
    data: Vec<f32>,
}

#[derive(Debug)]
struct DecodedToken {
    text: String,
    step: usize,
}

struct TfliteRunContext {
    library: &'static Library,
    detection_model: Model<'static>,
    classifier_model: Model<'static>,
    recognition_model: Model<'static>,
}

enum WpsModelKind {
    Detection,
    Classifier,
    Recognition,
}

impl TfliteRunContext {
    fn new(resolved: &WpsOcrResolvedEnvironment) -> Result<Self, String> {
        let library = tflite_library(&resolved.runtime_library)?;
        Ok(Self {
            library,
            detection_model: load_model(library, &resolved.det_model, "WPS 文字检测模型")?,
            classifier_model: load_model(library, &resolved.cls_model, "WPS 文本方向模型")?,
            recognition_model: load_model(library, &resolved.rec_model, "WPS 文字识别模型")?,
        })
    }

    fn run_model(
        &self,
        kind: WpsModelKind,
        input_shape: &[i32],
        input_data: &[f32],
    ) -> Result<TensorOutput, String> {
        validate_tensor_len(input_shape, input_data.len())?;
        let model = match kind {
            WpsModelKind::Detection => &self.detection_model,
            WpsModelKind::Classifier => &self.classifier_model,
            WpsModelKind::Recognition => &self.recognition_model,
        };

        let mut interpreter = Interpreter::builder(self.library)
            .map_err(|error| format!("创建 WPS OCR TFLite 解释器选项失败: {}", error))?
            .num_threads(1)
            .build(model)
            .map_err(|error| format!("创建 WPS OCR TFLite 解释器失败: {}", error))?;
        interpreter
            .resize_input(0, input_shape)
            .map_err(|error| format!("设置 WPS OCR 输入尺寸失败: {}", error))?;
        interpreter
            .allocate_tensors()
            .map_err(|error| format!("分配 WPS OCR 张量失败: {}", error))?;

        {
            let mut inputs = interpreter
                .inputs_mut()
                .map_err(|error| format!("读取 WPS OCR 输入张量失败: {}", error))?;
            let input = inputs
                .get_mut(0)
                .ok_or_else(|| "WPS OCR 模型没有输入张量".to_string())?;
            let actual_shape = input
                .shape()
                .map_err(|error| format!("读取 WPS OCR 输入形状失败: {}", error))?;
            let expected_shape = input_shape
                .iter()
                .map(|dim| {
                    if *dim <= 0 {
                        Err(format!("WPS OCR 输入维度非法: {:?}", input_shape))
                    } else {
                        Ok(*dim as usize)
                    }
                })
                .collect::<Result<Vec<_>, _>>()?;
            if actual_shape != expected_shape {
                return Err(format!(
                    "WPS OCR 输入形状不匹配: expected={:?}, actual={:?}",
                    expected_shape, actual_shape
                ));
            }
            input
                .copy_from_slice(input_data)
                .map_err(|error| format!("写入 WPS OCR 输入张量失败: {}", error))?;
        }

        interpreter
            .invoke()
            .map_err(|error| format!("执行 WPS OCR 模型失败: {}", error))?;
        let outputs = interpreter
            .outputs()
            .map_err(|error| format!("读取 WPS OCR 输出张量失败: {}", error))?;
        let output = outputs
            .get(0)
            .ok_or_else(|| "WPS OCR 模型没有输出张量".to_string())?;
        let shape = output
            .shape()
            .map_err(|error| format!("读取 WPS OCR 输出形状失败: {}", error))?;
        let data = output
            .as_slice::<f32>()
            .map_err(|error| format!("读取 WPS OCR 输出数据失败: {}", error))?
            .to_vec();

        Ok(TensorOutput { shape, data })
    }
}

pub fn detect_wps_ocr_environment() -> Result<WpsOcrEnvironment, String> {
    Ok(wps_ocr_environment_status(resolve_wps_ocr_environment()))
}

pub fn prepare_wps_ocr_environment() -> Result<WpsOcrEnvironment, String> {
    let resolved = resolve_wps_ocr_environment();
    if resolved.missing.is_empty() {
        let _runtime = TfliteRunContext::new(&resolved)?;
    }
    Ok(wps_ocr_environment_status(resolved))
}

pub fn stop_wps_ocr() {}

pub fn recognize(image_base64: &str) -> Result<OcrResult, String> {
    let resolved = resolve_wps_ocr_environment();
    if !resolved.missing.is_empty() {
        return Err(format!(
            "WPS OCR 本地运行时未就绪: {}",
            resolved.missing.join("；")
        ));
    }

    let context = TfliteRunContext::new(&resolved)?;
    let vocab = load_vocab(&resolved.vocab_path)?;
    let image = decode_image(image_base64)?;
    let lines = detect_text_lines(&context, &image)?;
    let target_lines = if lines.is_empty() {
        vec![DetectedLine {
            left: 0,
            top: 0,
            right: image.width(),
            bottom: image.height(),
        }]
    } else {
        lines
    };

    let mut blocks = Vec::new();
    let mut confidences = Vec::new();
    for line in target_lines.into_iter().take(120) {
        let crop_width = line.right.saturating_sub(line.left);
        let crop_height = line.bottom.saturating_sub(line.top);
        if crop_width < 2 || crop_height < 2 {
            continue;
        }
        let mut crop =
            imageops::crop_imm(&image, line.left, line.top, crop_width, crop_height).to_image();
        if should_rotate_line(&context, &crop).unwrap_or(false) {
            crop = imageops::rotate180(&crop);
        }
        let (input_shape, input_data) = preprocess_line(&crop, LINE_MAX_WIDTH);
        let output = context.run_model(WpsModelKind::Recognition, &input_shape, &input_data)?;
        let line_width = input_shape.get(2).copied().unwrap_or(LINE_MAX_WIDTH as i32) as usize;
        let (text, confidence) = decode_ctc(&output, &vocab, line_width)?;
        let trimmed = text.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        if confidence.is_finite() && confidence > 0.0 {
            confidences.push(confidence.min(1.0) as f64);
        }
        blocks.push(TextBlock {
            text: trimmed,
            location: BoundingBox {
                left: line.left as i32,
                top: line.top as i32,
                width: crop_width as i32,
                height: crop_height as i32,
            },
        });
    }

    let text = blocks
        .iter()
        .map(|block| block.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let confidence = if confidences.is_empty() {
        None
    } else {
        Some(confidences.iter().sum::<f64>() / confidences.len() as f64)
    };

    Ok(OcrResult {
        text,
        confidence,
        words: None,
        text_blocks: Some(blocks),
    })
}

fn detect_text_lines(
    context: &TfliteRunContext,
    image: &RgbImage,
) -> Result<Vec<DetectedLine>, String> {
    let (input_shape, input_data, scale) = preprocess_detection(image);
    let output = context.run_model(WpsModelKind::Detection, &input_shape, &input_data)?;
    let (width, height, scores) = extract_score_map(&output)?;
    let mask = dilate_mask(&scores, width, height, DET_THRESHOLD);
    let mut boxes = connected_components(&mask, width, height);
    let original_width = image.width() as f32;
    let original_height = image.height() as f32;

    boxes.retain(|line| {
        let width = line.right.saturating_sub(line.left) as usize;
        let height = line.bottom.saturating_sub(line.top) as usize;
        width * height >= DET_MIN_AREA && width >= 20 && height >= 8
    });

    let mut lines = boxes
        .into_iter()
        .filter_map(|line| {
            let left = ((line.left as f32 - 8.0) / scale).floor().max(0.0);
            let top = ((line.top as f32 - 8.0) / scale).floor().max(0.0);
            let right = ((line.right as f32 + 8.0) / scale)
                .ceil()
                .min(original_width);
            let bottom = ((line.bottom as f32 + 8.0) / scale)
                .ceil()
                .min(original_height);
            if right <= left || bottom <= top {
                return None;
            }
            Some(DetectedLine {
                left: left as u32,
                top: top as u32,
                right: right as u32,
                bottom: bottom as u32,
            })
        })
        .collect::<Vec<_>>();
    lines.sort_by_key(|line| (line.top, line.left));
    Ok(lines)
}

fn should_rotate_line(context: &TfliteRunContext, image: &RgbImage) -> Result<bool, String> {
    let (shape, data) = preprocess_line_classifier(image);
    let output = context.run_model(WpsModelKind::Classifier, &shape, &data)?;
    if output.data.len() < 2 {
        return Ok(false);
    }
    let normal = output.data[0];
    let rotated = output.data[1];
    Ok(rotated > normal && rotated > CLS_ROTATE_THRESHOLD)
}

fn preprocess_detection(image: &RgbImage) -> (Vec<i32>, Vec<f32>, f32) {
    let (width, height) = image.dimensions();
    let scale = (DET_INPUT_SIZE as f32 / width.max(1) as f32)
        .min(DET_INPUT_SIZE as f32 / height.max(1) as f32);
    let resized_width = ((width as f32 * scale).round() as u32).max(1);
    let resized_height = ((height as f32 * scale).round() as u32).max(1);
    let resized = imageops::resize(image, resized_width, resized_height, FilterType::Triangle);
    let mut canvas = RgbImage::from_pixel(DET_INPUT_SIZE, DET_INPUT_SIZE, Rgb([255, 255, 255]));
    imageops::overlay(&mut canvas, &resized, 0, 0);

    let mean = [0.4810938_f32, 0.45752457_f32, 0.40787053_f32];
    let std = [0.229_f32, 0.224_f32, 0.225_f32];
    let mut data = Vec::with_capacity((DET_INPUT_SIZE * DET_INPUT_SIZE * 3) as usize);
    for pixel in canvas.pixels() {
        for channel in 0..3 {
            data.push((pixel[channel] as f32 / 255.0 - mean[channel]) / std[channel]);
        }
    }
    (
        vec![1, DET_INPUT_SIZE as i32, DET_INPUT_SIZE as i32, 3],
        data,
        scale,
    )
}

fn preprocess_line(image: &RgbImage, max_width: u32) -> (Vec<i32>, Vec<f32>) {
    let (width, height) = image.dimensions();
    let resized_width = ((width.max(1) as f32 * LINE_HEIGHT as f32 / height.max(1) as f32).round()
        as u32)
        .clamp(1, max_width);
    let resized = imageops::resize(image, resized_width, LINE_HEIGHT, FilterType::Triangle);
    let mut data = Vec::with_capacity((LINE_HEIGHT * resized_width * 3) as usize);
    for pixel in resized.pixels() {
        for channel in 0..3 {
            data.push(pixel[channel] as f32 * (2.0 / 255.0) - 1.0);
        }
    }
    (vec![1, LINE_HEIGHT as i32, resized_width as i32, 3], data)
}

fn preprocess_line_classifier(image: &RgbImage) -> (Vec<i32>, Vec<f32>) {
    let (line_shape, line_data) = preprocess_line(image, CLS_WIDTH);
    let current_width = line_shape[2].max(1) as u32;
    if current_width == CLS_WIDTH {
        return (vec![1, LINE_HEIGHT as i32, CLS_WIDTH as i32, 3], line_data);
    }

    let mut data = vec![1.0_f32; (LINE_HEIGHT * CLS_WIDTH * 3) as usize];
    for y in 0..LINE_HEIGHT as usize {
        for x in 0..current_width as usize {
            for channel in 0..3 {
                let src = (y * current_width as usize + x) * 3 + channel;
                let dst = (y * CLS_WIDTH as usize + x) * 3 + channel;
                if let Some(value) = line_data.get(src) {
                    data[dst] = *value;
                }
            }
        }
    }
    (vec![1, LINE_HEIGHT as i32, CLS_WIDTH as i32, 3], data)
}

fn extract_score_map(output: &TensorOutput) -> Result<(usize, usize, Vec<f32>), String> {
    match output.shape.as_slice() {
        [1, height, width, 1] => Ok((*width, *height, output.data.clone())),
        [1, 1, height, width] => {
            let mut scores = vec![0.0_f32; width * height];
            for y in 0..*height {
                for x in 0..*width {
                    scores[y * width + x] = output.data[y * width + x];
                }
            }
            Ok((*width, *height, scores))
        }
        shape => Err(format!("WPS OCR 检测模型输出维度不支持: {:?}", shape)),
    }
}

fn dilate_mask(scores: &[f32], width: usize, height: usize, threshold: f32) -> Vec<bool> {
    let mut integral = vec![0_u32; (width + 1) * (height + 1)];
    for y in 0..height {
        let mut row_sum = 0_u32;
        for x in 0..width {
            if scores.get(y * width + x).copied().unwrap_or(0.0) > threshold {
                row_sum += 1;
            }
            let above = integral[y * (width + 1) + x + 1];
            integral[(y + 1) * (width + 1) + x + 1] = above + row_sum;
        }
    }

    let half_w = DET_DILATE_WIDTH / 2;
    let half_h = DET_DILATE_HEIGHT / 2;
    let mut mask = vec![false; width * height];
    for y in 0..height {
        let y0 = y.saturating_sub(half_h);
        let y1 = (y + half_h + 1).min(height);
        for x in 0..width {
            let x0 = x.saturating_sub(half_w);
            let x1 = (x + half_w + 1).min(width);
            let sum = integral[y1 * (width + 1) + x1] + integral[y0 * (width + 1) + x0]
                - integral[y0 * (width + 1) + x1]
                - integral[y1 * (width + 1) + x0];
            mask[y * width + x] = sum > 0;
        }
    }
    mask
}

fn connected_components(mask: &[bool], width: usize, height: usize) -> Vec<DetectedLine> {
    let mut visited = vec![false; mask.len()];
    let mut boxes = Vec::new();
    let mut stack = Vec::new();

    for index in 0..mask.len() {
        if !mask[index] || visited[index] {
            continue;
        }
        visited[index] = true;
        stack.clear();
        stack.push(index);
        let mut min_x = width;
        let mut min_y = height;
        let mut max_x = 0_usize;
        let mut max_y = 0_usize;

        while let Some(current) = stack.pop() {
            let x = current % width;
            let y = current / width;
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);

            let neighbors = [
                (x > 0).then_some(current - 1),
                (x + 1 < width).then_some(current + 1),
                (y > 0).then_some(current - width),
                (y + 1 < height).then_some(current + width),
            ];
            for next in neighbors.into_iter().flatten() {
                if mask[next] && !visited[next] {
                    visited[next] = true;
                    stack.push(next);
                }
            }
        }

        if min_x <= max_x && min_y <= max_y {
            boxes.push(DetectedLine {
                left: min_x as u32,
                top: min_y as u32,
                right: (max_x + 1) as u32,
                bottom: (max_y + 1) as u32,
            });
        }
    }
    boxes
}

fn decode_ctc(
    output: &TensorOutput,
    vocab: &[String],
    line_width: usize,
) -> Result<(String, f32), String> {
    let (steps, classes, base_offset) = match output.shape.as_slice() {
        [1, steps, classes] => (*steps, *classes, 0),
        [steps, classes] => (*steps, *classes, 0),
        shape => return Err(format!("WPS OCR 识别模型输出维度不支持: {:?}", shape)),
    };
    if classes == 0 || steps == 0 {
        return Ok((String::new(), 0.0));
    }

    let mut last = usize::MAX;
    let mut decoded = Vec::new();
    let mut confidences = Vec::new();
    for step in 0..steps {
        let offset = base_offset + step * classes;
        let row = output
            .data
            .get(offset..offset + classes)
            .ok_or_else(|| "WPS OCR 识别输出长度异常".to_string())?;
        let mut best_index = 0_usize;
        let mut best_score = f32::NEG_INFINITY;
        for (index, score) in row.iter().enumerate() {
            if score.is_finite() && *score > best_score {
                best_score = *score;
                best_index = index;
            }
        }
        if best_index != 0 && best_index != last && best_index < vocab.len() {
            decoded.push(DecodedToken {
                text: vocab[best_index].clone(),
                step,
            });
            confidences.push(best_score);
        }
        last = best_index;
    }

    let confidence = if confidences.is_empty() {
        0.0
    } else {
        confidences.iter().sum::<f32>() / confidences.len() as f32
    };
    Ok((
        restore_latin_spaces(&decoded, steps, line_width),
        confidence,
    ))
}

fn restore_latin_spaces(tokens: &[DecodedToken], steps: usize, line_width: usize) -> String {
    if tokens.is_empty() {
        return String::new();
    }

    let mut text = String::new();
    let mut previous: Option<&DecodedToken> = None;
    let normal_unit_gap = normal_token_unit_step_gap(tokens);

    for token in tokens {
        if let Some(prev) = previous {
            if should_insert_visual_space(prev, token, steps, line_width, normal_unit_gap) {
                text.push(' ');
            }
        }
        text.push_str(&token.text);
        previous = Some(token);
    }
    text
}

fn should_insert_visual_space(
    left: &DecodedToken,
    right: &DecodedToken,
    steps: usize,
    line_width: usize,
    normal_unit_gap: f32,
) -> bool {
    if steps == 0 || line_width == 0 || normal_unit_gap <= 0.0 {
        return false;
    }
    if !is_latin_space_candidate(&left.text) || !is_latin_space_candidate(&right.text) {
        return false;
    }

    let step_gap = right.step.saturating_sub(left.step);
    if step_gap <= 1 {
        return false;
    }
    let expected_gap = normal_unit_gap * latin_pair_width_factor(&left.text, &right.text);
    step_gap as f32 >= expected_gap * LATIN_SPACE_GAP_FACTOR
}

fn normal_token_unit_step_gap(tokens: &[DecodedToken]) -> f32 {
    let mut gaps = tokens
        .windows(2)
        .filter_map(|pair| {
            let left = pair.first()?;
            let right = pair.get(1)?;
            if is_latin_space_candidate(&left.text) && is_latin_space_candidate(&right.text) {
                let gap = right.step.saturating_sub(left.step);
                let width_factor = latin_pair_width_factor(&left.text, &right.text);
                (gap > 0 && width_factor > 0.0).then_some(gap as f32 / width_factor)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    if gaps.is_empty() {
        return 0.0;
    }
    gaps.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    gaps[gaps.len() / 2].max(1.0)
}

fn latin_pair_width_factor(left: &str, right: &str) -> f32 {
    (latin_token_width(left) + latin_token_width(right)) * 0.5
}

fn latin_token_width(text: &str) -> f32 {
    let mut width = 0.0_f32;
    let mut count = 0_usize;
    for ch in text.chars() {
        width += match ch {
            'W' | 'M' | 'w' | 'm' | '@' => 1.35,
            'I' | 'i' | 'l' | '1' | '|' | '.' | ',' | '\'' | '`' => 0.55,
            'f' | 'j' | 'r' | 't' | '-' | '/' | '\\' => 0.78,
            _ => 1.0,
        };
        count += 1;
    }
    if count == 0 {
        1.0
    } else {
        width / count as f32
    }
}

fn is_latin_space_candidate(text: &str) -> bool {
    text.chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '/' | '\\' | '.' | '@'))
}

fn decode_image(image_base64: &str) -> Result<RgbImage, String> {
    let payload = image_base64
        .split_once(',')
        .map(|(_, value)| value)
        .unwrap_or(image_base64);
    let image_data = general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|error| format!("Base64解码失败: {}", error))?;
    image::load_from_memory(&image_data)
        .map_err(|error| format!("读取 WPS OCR 图片失败: {}", error))
        .map(|image| image.to_rgb8())
}

fn load_vocab(path: &Path) -> Result<Vec<String>, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("读取 WPS OCR 字典失败 {}: {}", path.display(), error))?;
    let mut vocab = Vec::new();
    vocab.push(String::new());
    vocab.extend(raw.lines().map(|line| line.to_string()));
    Ok(vocab)
}

fn validate_tensor_len(shape: &[i32], data_len: usize) -> Result<(), String> {
    let expected = shape_len_i32(shape)?;
    if expected != data_len {
        return Err(format!(
            "WPS OCR 输入张量长度不匹配: shape={:?}, expected={}, actual={}",
            shape, expected, data_len
        ));
    }
    Ok(())
}

fn shape_len_i32(shape: &[i32]) -> Result<usize, String> {
    let mut len = 1_usize;
    for dim in shape {
        if *dim <= 0 {
            return Err(format!("WPS OCR 输入维度非法: {:?}", shape));
        }
        len = len
            .checked_mul(*dim as usize)
            .ok_or_else(|| format!("WPS OCR 输入维度过大: {:?}", shape))?;
    }
    Ok(len)
}

fn tflite_library(path: &Path) -> Result<&'static Library, String> {
    if let Some(library) = TFLITE_RUNTIME.get() {
        return Ok(library);
    }

    let library = Library::from_path(path).map_err(|error| {
        format!(
            "加载 WPS OCR TFLite 运行库失败 {}: {}",
            path.display(),
            error
        )
    })?;
    let _ = TFLITE_RUNTIME.set(library);
    TFLITE_RUNTIME
        .get()
        .ok_or_else(|| "WPS OCR TFLite 运行库初始化失败".to_string())
}

fn load_model(
    library: &'static Library,
    path: &Path,
    label: &str,
) -> Result<Model<'static>, String> {
    Model::from_file(library, path)
        .map_err(|error| format!("加载 {} 失败 {}: {}", label, path.display(), error))
}

fn resolve_wps_ocr_environment() -> WpsOcrResolvedEnvironment {
    let mut first_existing = None;
    for root in wps_ocr_resource_roots() {
        if !root.exists() {
            continue;
        }
        let resolved = build_wps_ocr_environment(root);
        if resolved.missing.is_empty() {
            return resolved;
        }
        if first_existing.is_none() {
            first_existing = Some(resolved);
        }
    }

    first_existing.unwrap_or_else(|| {
        let fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(RESOURCE_ROOT);
        build_wps_ocr_environment(fallback)
    })
}

fn build_wps_ocr_environment(runtime_dir: PathBuf) -> WpsOcrResolvedEnvironment {
    let install_dir = find_wps_install_dir();
    let det_model = runtime_dir.join(DET_MODEL);
    let cls_model = runtime_dir.join(CLS_MODEL);
    let rec_model = runtime_dir.join(REC_MODEL);
    let vocab_path = runtime_dir.join(VOCAB_FILE);
    let runtime_library = runtime_dir.join(TFLITE_LIBRARY);
    let mut missing = Vec::new();

    for (label, path) in [
        ("WPS 文字检测模型", &det_model),
        ("WPS 文本方向模型", &cls_model),
        ("WPS 文字识别模型", &rec_model),
        ("WPS 识别字典", &vocab_path),
        ("WPS TFLite 运行库", &runtime_library),
    ] {
        if !path.is_file() {
            missing.push(format!("缺少 {} {}", label, path.display()));
        }
    }

    WpsOcrResolvedEnvironment {
        runtime_dir,
        install_dir,
        det_model,
        cls_model,
        rec_model,
        vocab_path,
        runtime_library,
        missing,
    }
}

fn wps_ocr_environment_status(resolved: WpsOcrResolvedEnvironment) -> WpsOcrEnvironment {
    let available = resolved.missing.is_empty();
    WpsOcrEnvironment {
        available,
        message: if available {
            "WPS OCR 本地运行时已就绪，独立于 PaddleOCR 和微信 OCR".to_string()
        } else {
            "内置 WPS OCR 尚未就绪，请检查 resources/wps-ocr".to_string()
        },
        runtime_dir: path_to_string(&resolved.runtime_dir),
        install_dir: resolved
            .install_dir
            .as_ref()
            .map(|path| path_to_string(path))
            .unwrap_or_default(),
        det_model: path_to_string(&resolved.det_model),
        cls_model: path_to_string(&resolved.cls_model),
        rec_model: path_to_string(&resolved.rec_model),
        vocab_path: path_to_string(&resolved.vocab_path),
        runtime_library: path_to_string(&resolved.runtime_library),
        missing: resolved.missing,
    }
}

fn wps_ocr_resource_roots() -> Vec<PathBuf> {
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

fn find_wps_install_dir() -> Option<PathBuf> {
    [
        PathBuf::from(WPS_INSTALL_DIR),
        PathBuf::from(r"C:\Program Files\Kingsoft\WPS Office"),
        PathBuf::from(r"C:\Program Files (x86)\Kingsoft\WPS Office"),
    ]
    .into_iter()
    .find(|path| path.is_dir())
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wps_ocr_sample_smoke() {
        let sample = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")))
            .join("extracted_wps_ocr_standalone")
            .join("samples")
            .join("detect_sample.png");
        if !sample.is_file() {
            eprintln!("skip WPS OCR smoke test: sample image not found");
            return;
        }

        let image_bytes = fs::read(&sample).expect("read WPS OCR sample image");
        let image_base64 = general_purpose::STANDARD.encode(image_bytes);
        let result = recognize(&image_base64).expect("WPS OCR sample should run");
        assert!(
            result.text.contains("中文") || result.text.to_ascii_uppercase().contains("WPS"),
            "unexpected WPS OCR sample result: {:?}",
            result.text
        );
    }
}
