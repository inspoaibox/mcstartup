use base64::{engine::general_purpose, Engine as _};
use image::imageops::FilterType;
use image::{DynamicImage, GrayImage, ImageFormat, RgbImage};
use ndarray::{Array4, ArrayViewD};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::TensorRef;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

const MODEL_ROOT: &str = "ai-watermark-remove";
const AUTO_MODEL_FILES: &[&str] = &[
    "auto/segmenter_centered_text.pth",
    "auto/segmenter_repeated_text.pth",
    "auto/segmenter_logo.pth",
    "auto/segmenter_overlay_text.pth",
    "auto/segmenter_tiny_corner.pth",
    "auto/segmenter_line_pattern.pth",
    "auto/segmenter_universal.pth",
];
const MANUAL_MODEL_FILE: &str = "manual/lama_fp32.onnx";
const MANUAL_INPUT_SIZE: u32 = 512;
const MASK_THRESHOLD: u8 = 8;
const MIN_REGION_PADDING: u32 = 24;
const MAX_REGION_PADDING: u32 = 96;
const DEFAULT_MAGIC_MASK_EXPAND: u32 = 10;
const DEFAULT_MAGIC_BLEND_FEATHER: f32 = 3.0;
const WATERMARK_AUTO_SCRIPT: &str = include_str!("../../scripts/watermark_auto_segment.py");

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkAutoResult {
    pub data_url: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkAutoOptions {
    #[serde(default = "default_auto_sensitivity")]
    pub sensitivity: String,
    #[serde(default = "default_mask_dilate")]
    pub mask_dilate: u32,
    #[serde(default = "default_max_mask_ratio")]
    pub max_mask_ratio: f32,
    #[serde(default = "default_edge_filter")]
    pub edge_filter: bool,
}

impl Default for WatermarkAutoOptions {
    fn default() -> Self {
        Self {
            sensitivity: default_auto_sensitivity(),
            mask_dilate: default_mask_dilate(),
            max_mask_ratio: default_max_mask_ratio(),
            edge_filter: default_edge_filter(),
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkMaskComponent {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub area: u32,
    pub ratio: f32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkAutoMaskResult {
    pub mask_data_url: String,
    #[serde(default)]
    pub coverage: f32,
    #[serde(default)]
    pub models_used: Vec<String>,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub components: Vec<WatermarkMaskComponent>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub settings: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkManualResult {
    pub data_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageEraseResult {
    pub data_url: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageEraseOptions {
    #[serde(default = "default_magic_mask_expand")]
    pub mask_expand: u32,
    #[serde(default = "default_magic_blend_feather")]
    pub blend_feather: f32,
    #[serde(default = "default_true")]
    pub second_pass: bool,
}

impl Default for ImageEraseOptions {
    fn default() -> Self {
        Self {
            mask_expand: default_magic_mask_expand(),
            blend_feather: default_magic_blend_feather(),
            second_pass: true,
        }
    }
}

#[derive(Clone, Copy)]
struct RepairOptions {
    mask_expand: u32,
    blend_feather: f32,
    second_pass: bool,
}

impl RepairOptions {
    fn manual() -> Self {
        Self {
            mask_expand: 0,
            blend_feather: 1.5,
            second_pass: false,
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct Region {
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
}

impl Region {
    fn width(self) -> u32 {
        self.right.saturating_sub(self.left)
    }

    fn height(self) -> u32 {
        self.bottom.saturating_sub(self.top)
    }

    fn expand(self, image_width: u32, image_height: u32, padding: u32) -> Self {
        Self {
            left: self.left.saturating_sub(padding),
            top: self.top.saturating_sub(padding),
            right: self.right.saturating_add(padding).min(image_width),
            bottom: self.bottom.saturating_add(padding).min(image_height),
        }
    }
}

struct CachedSession {
    model_path: PathBuf,
    session: Session,
}

static MANUAL_SESSION: OnceLock<Mutex<Option<CachedSession>>> = OnceLock::new();

fn default_auto_sensitivity() -> String {
    "balanced".to_string()
}

fn default_mask_dilate() -> u32 {
    2
}

fn default_max_mask_ratio() -> f32 {
    0.35
}

fn default_edge_filter() -> bool {
    true
}

fn default_magic_mask_expand() -> u32 {
    DEFAULT_MAGIC_MASK_EXPAND
}

fn default_magic_blend_feather() -> f32 {
    DEFAULT_MAGIC_BLEND_FEATHER
}

fn default_true() -> bool {
    true
}

#[tauri::command]
pub async fn image_watermark_auto_remove(
    input_path: String,
    model_dir: String,
    options: Option<WatermarkAutoOptions>,
) -> Result<WatermarkAutoResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data_url = auto_remove_impl(&input_path, &model_dir, options.unwrap_or_default())?;
        Ok(WatermarkAutoResult { data_url })
    })
    .await
    .map_err(|e| format!("智能去水印任务执行失败: {}", e))?
}

#[tauri::command]
pub async fn image_watermark_auto_detect(
    input_path: String,
    model_dir: String,
    options: Option<WatermarkAutoOptions>,
) -> Result<WatermarkAutoMaskResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        detect_auto_mask_payload(&input_path, &model_dir, options.unwrap_or_default(), false)
    })
    .await
    .map_err(|e| format!("智能识别水印区域任务执行失败: {}", e))?
}

#[tauri::command]
pub async fn image_watermark_repair_with_mask(
    input_path: String,
    mask_data_url: String,
    model_dir: String,
) -> Result<WatermarkManualResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data_url = manual_remove_impl(&input_path, &mask_data_url, &model_dir)?;
        Ok(WatermarkManualResult { data_url })
    })
    .await
    .map_err(|e| format!("按遮罩去水印任务执行失败: {}", e))?
}

#[tauri::command]
pub async fn image_watermark_manual_remove(
    input_path: String,
    mask_data_url: String,
    model_dir: String,
) -> Result<WatermarkManualResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data_url = manual_remove_impl(&input_path, &mask_data_url, &model_dir)?;
        Ok(WatermarkManualResult { data_url })
    })
    .await
    .map_err(|e| format!("手动去水印任务执行失败: {}", e))?
}

#[tauri::command]
pub async fn image_magic_erase(
    input_path: String,
    mask_data_url: String,
    model_dir: String,
    options: Option<ImageEraseOptions>,
) -> Result<ImageEraseResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data_url = magic_erase_impl(
            &input_path,
            &mask_data_url,
            &model_dir,
            options.unwrap_or_default(),
        )?;
        Ok(ImageEraseResult { data_url })
    })
    .await
    .map_err(|e| format!("AI 智能擦除任务执行失败: {}", e))?
}

fn auto_remove_impl(
    input_path: &str,
    model_dir: &str,
    options: WatermarkAutoOptions,
) -> Result<String, String> {
    let image = image::open(input_path)
        .map_err(|e| format!("读取图片失败: {}", e))?
        .to_rgb8();
    let payload = detect_auto_mask_payload(input_path, model_dir, options, true)?;
    if payload.coverage <= 0.0 || payload.components.is_empty() {
        let models_desc = payload.models_used.join(", ");
        if models_desc.is_empty() {
            return Err("自动模式未检测到可去除的水印区域".to_string());
        }
        return Err(format!(
            "自动模式未检测到可去除的水印区域（已尝试模型：{}）",
            models_desc
        ));
    }
    let mut mask = decode_mask(&payload.mask_data_url)?;
    if mask.dimensions() != image.dimensions() {
        mask = image::imageops::resize(&mask, image.width(), image.height(), FilterType::Nearest);
    }
    repair_with_mask(&image, &mask, model_dir, RepairOptions::manual())
}

fn manual_remove_impl(
    input_path: &str,
    mask_data_url: &str,
    model_dir: &str,
) -> Result<String, String> {
    let image = image::open(input_path)
        .map_err(|e| format!("读取图片失败: {}", e))?
        .to_rgb8();
    let mut mask = decode_mask(mask_data_url)?;

    if mask.dimensions() != image.dimensions() {
        mask = image::imageops::resize(&mask, image.width(), image.height(), FilterType::Nearest);
    }

    repair_with_mask(&image, &mask, model_dir, RepairOptions::manual())
}

fn magic_erase_impl(
    input_path: &str,
    mask_data_url: &str,
    model_dir: &str,
    options: ImageEraseOptions,
) -> Result<String, String> {
    let image = image::open(input_path)
        .map_err(|e| format!("读取图片失败: {}", e))?
        .to_rgb8();
    let mut mask = decode_mask(mask_data_url)?;

    if mask.dimensions() != image.dimensions() {
        mask = image::imageops::resize(&mask, image.width(), image.height(), FilterType::Nearest);
    }

    let repair_options = RepairOptions {
        mask_expand: options.mask_expand.min(32),
        blend_feather: options.blend_feather.clamp(0.0, 10.0),
        second_pass: options.second_pass,
    };
    repair_with_mask(&image, &mask, model_dir, repair_options)
}

fn repair_with_mask(
    image: &RgbImage,
    mask: &GrayImage,
    model_dir: &str,
    options: RepairOptions,
) -> Result<String, String> {
    let model_path = PathBuf::from(model_dir)
        .join(MODEL_ROOT)
        .join(MANUAL_MODEL_FILE);
    let prepared_mask = prepare_repair_mask(mask, options.mask_expand);
    let regions = collect_mask_regions(&prepared_mask);

    if regions.is_empty() {
        return Err("没有检测到需要修复的遮罩区域".to_string());
    }

    let mut final_image = image.clone();
    for region in regions.iter().copied() {
        repair_region_in_place(
            &mut final_image,
            &prepared_mask,
            region,
            &model_path,
            options.blend_feather,
        )?;
    }

    if options.second_pass {
        let regions = collect_mask_regions(&prepared_mask);
        for region in regions {
            repair_region_in_place(
                &mut final_image,
                &prepared_mask,
                region,
                &model_path,
                options.blend_feather * 0.7,
            )?;
        }
    }

    encode_png_data_url_rgb(&final_image)
}

fn detect_auto_mask_payload(
    input_path: &str,
    model_dir: &str,
    options: WatermarkAutoOptions,
    fail_on_empty: bool,
) -> Result<WatermarkAutoMaskResult, String> {
    let image_size =
        image::image_dimensions(input_path).map_err(|e| format!("读取图片尺寸失败: {}", e))?;
    let auto_dir = PathBuf::from(model_dir).join(MODEL_ROOT).join("auto");
    let missing_models = AUTO_MODEL_FILES
        .iter()
        .filter(|relative| {
            !PathBuf::from(model_dir)
                .join(MODEL_ROOT)
                .join(relative)
                .is_file()
        })
        .map(|relative| relative.rsplit('/').next().unwrap_or(*relative).to_string())
        .collect::<Vec<_>>();
    if !missing_models.is_empty() {
        return Err(format!(
            "自动去水印模型未下载完整，缺少: {}",
            missing_models.join(", ")
        ));
    }

    let script_path = watermark_auto_script_path()?;

    let output = Command::new("python")
        .arg(&script_path)
        .arg(input_path)
        .arg(&auto_dir)
        .arg("--sensitivity")
        .arg(normalize_sensitivity(&options.sensitivity))
        .arg("--mask-dilate")
        .arg(options.mask_dilate.min(12).to_string())
        .arg("--max-mask-ratio")
        .arg(options.max_mask_ratio.clamp(0.01, 0.50).to_string())
        .args(if options.edge_filter {
            Vec::<&str>::new()
        } else {
            vec!["--disable-edge-filter"]
        })
        .output()
        .map_err(|e| format!("启动自动去水印分割脚本失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("自动去水印分割失败: {}", detail));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| format!("读取自动去水印分割输出失败: {}", e))?;
    let mut payload: WatermarkAutoMaskResult = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("解析自动去水印分割输出失败: {}", e))?;

    let mut mask = decode_mask(&payload.mask_data_url)?;
    if mask.dimensions() != image_size {
        mask = image::imageops::resize(&mask, image_size.0, image_size.1, FilterType::Nearest);
        payload.mask_data_url = encode_png_data_url_gray(&mask)?;
        payload.coverage = mask_coverage(&mask);
    }
    payload.width = image_size.0;
    payload.height = image_size.1;

    let regions = collect_mask_regions(&mask);
    if regions.is_empty() && fail_on_empty {
        let models_desc = payload.models_used.join(", ");
        if models_desc.is_empty() {
            return Err("自动模式未检测到可去除的水印区域".to_string());
        }
        return Err(format!(
            "自动模式未检测到可去除的水印区域（已尝试模型：{}）",
            models_desc
        ));
    }

    Ok(payload)
}

pub fn watermark_auto_script_path() -> Result<PathBuf, String> {
    let source_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("scripts")
        .join("watermark_auto_segment.py");
    if source_path.is_file() {
        return Ok(source_path);
    }

    let app_data = std::env::var("APPDATA")
        .unwrap_or_else(|_| std::env::var("HOME").unwrap_or_else(|_| ".".to_string()));
    let script_dir = PathBuf::from(app_data).join("McStartUP").join("scripts");
    fs::create_dir_all(&script_dir).map_err(|e| format!("创建脚本缓存目录失败: {}", e))?;
    let script_path = script_dir.join("watermark_auto_segment.py");
    let needs_write = fs::read_to_string(&script_path)
        .map(|current| current != WATERMARK_AUTO_SCRIPT)
        .unwrap_or(true);
    if needs_write {
        fs::write(&script_path, WATERMARK_AUTO_SCRIPT)
            .map_err(|e| format!("写入自动分割脚本失败: {}", e))?;
    }
    Ok(script_path)
}

fn normalize_sensitivity(value: &str) -> &'static str {
    match value {
        "conservative" => "conservative",
        "aggressive" => "aggressive",
        _ => "balanced",
    }
}

fn mask_coverage(mask: &GrayImage) -> f32 {
    let total = mask.width() as f32 * mask.height() as f32;
    if total <= 0.0 {
        return 0.0;
    }
    let count = mask
        .pixels()
        .filter(|pixel| pixel.0[0] > MASK_THRESHOLD)
        .count() as f32;
    count / total
}

fn prepare_repair_mask(mask: &GrayImage, expand: u32) -> GrayImage {
    let binary = binarize_mask(mask);
    if expand == 0 {
        return binary;
    }
    dilate_mask(&binary, expand)
}

fn binarize_mask(mask: &GrayImage) -> GrayImage {
    let mut out = GrayImage::new(mask.width(), mask.height());
    for (x, y, pixel) in mask.enumerate_pixels() {
        out.put_pixel(
            x,
            y,
            image::Luma([if pixel[0] > MASK_THRESHOLD { 255 } else { 0 }]),
        );
    }
    out
}

fn dilate_mask(mask: &GrayImage, radius: u32) -> GrayImage {
    let (width, height) = mask.dimensions();
    if width == 0 || height == 0 || radius == 0 {
        return mask.clone();
    }
    let mut out = GrayImage::new(width, height);
    let radius_i = radius as i32;
    let radius_sq = radius_i * radius_i;
    for y in 0..height {
        for x in 0..width {
            if mask.get_pixel(x, y)[0] <= MASK_THRESHOLD {
                continue;
            }
            let x_i = x as i32;
            let y_i = y as i32;
            for dy in -radius_i..=radius_i {
                for dx in -radius_i..=radius_i {
                    if dx * dx + dy * dy > radius_sq {
                        continue;
                    }
                    let nx = x_i + dx;
                    let ny = y_i + dy;
                    if nx >= 0 && ny >= 0 && (nx as u32) < width && (ny as u32) < height {
                        out.put_pixel(nx as u32, ny as u32, image::Luma([255]));
                    }
                }
            }
        }
    }
    out
}

fn collect_mask_regions(mask: &GrayImage) -> Vec<Region> {
    let (width, height) = mask.dimensions();
    if width == 0 || height == 0 {
        return Vec::new();
    }

    let width_usize = width as usize;
    let height_usize = height as usize;
    let mut visited = vec![false; width_usize * height_usize];
    let mut queue = VecDeque::new();
    let mut regions = Vec::new();

    for y in 0..height {
        for x in 0..width {
            let idx = y as usize * width_usize + x as usize;
            if visited[idx] || mask.get_pixel(x, y)[0] <= MASK_THRESHOLD {
                continue;
            }

            visited[idx] = true;
            queue.push_back((x, y));

            let mut min_x = x;
            let mut min_y = y;
            let mut max_x = x;
            let mut max_y = y;

            while let Some((cx, cy)) = queue.pop_front() {
                min_x = min_x.min(cx);
                min_y = min_y.min(cy);
                max_x = max_x.max(cx);
                max_y = max_y.max(cy);

                let x_start = cx.saturating_sub(1);
                let x_end = (cx + 1).min(width - 1);
                let y_start = cy.saturating_sub(1);
                let y_end = (cy + 1).min(height - 1);

                for ny in y_start..=y_end {
                    for nx in x_start..=x_end {
                        let nidx = ny as usize * width_usize + nx as usize;
                        if visited[nidx] || mask.get_pixel(nx, ny)[0] <= MASK_THRESHOLD {
                            continue;
                        }
                        visited[nidx] = true;
                        queue.push_back((nx, ny));
                    }
                }
            }

            regions.push(Region {
                left: min_x,
                top: min_y,
                right: max_x.saturating_add(1),
                bottom: max_y.saturating_add(1),
            });
        }
    }

    regions.sort_by_key(|region| std::cmp::Reverse(region.width() * region.height()));
    regions
}

fn repair_region_in_place(
    image: &mut RgbImage,
    full_mask: &GrayImage,
    region: Region,
    model_path: &Path,
    blend_feather: f32,
) -> Result<(), String> {
    let padding = ((region.width().max(region.height()) as f32) * 0.35)
        .round()
        .clamp(MIN_REGION_PADDING as f32, MAX_REGION_PADDING as f32) as u32;
    let crop = region.expand(image.width(), image.height(), padding);

    let image_patch =
        image::imageops::crop_imm(image, crop.left, crop.top, crop.width(), crop.height())
            .to_image();
    let mask_patch =
        image::imageops::crop_imm(full_mask, crop.left, crop.top, crop.width(), crop.height())
            .to_image();
    let restored_patch = run_lama_on_patch(&image_patch, &mask_patch, model_path)?;
    let blend_mask = if blend_feather > 0.0 {
        image::imageops::blur(&mask_patch, blend_feather)
    } else {
        mask_patch.clone()
    };

    for y in 0..crop.height() {
        for x in 0..crop.width() {
            let core_alpha = mask_patch.get_pixel(x, y)[0];
            let alpha = if core_alpha > MASK_THRESHOLD {
                1.0
            } else {
                blend_mask.get_pixel(x, y)[0] as f32 / 255.0
            };
            if alpha <= 0.0 {
                continue;
            }
            let dst_x = crop.left + x;
            let dst_y = crop.top + y;
            let original = image.get_pixel(dst_x, dst_y);
            let repaired = restored_patch.get_pixel(x, y);
            image.put_pixel(
                dst_x,
                dst_y,
                image::Rgb([
                    (original[0] as f32 * (1.0 - alpha) + repaired[0] as f32 * alpha)
                        .round()
                        .clamp(0.0, 255.0) as u8,
                    (original[1] as f32 * (1.0 - alpha) + repaired[1] as f32 * alpha)
                        .round()
                        .clamp(0.0, 255.0) as u8,
                    (original[2] as f32 * (1.0 - alpha) + repaired[2] as f32 * alpha)
                        .round()
                        .clamp(0.0, 255.0) as u8,
                ]),
            );
        }
    }

    Ok(())
}

fn run_lama_on_patch(
    image_patch: &RgbImage,
    mask_patch: &GrayImage,
    model_path: &Path,
) -> Result<RgbImage, String> {
    let resized_image = image::imageops::resize(
        image_patch,
        MANUAL_INPUT_SIZE,
        MANUAL_INPUT_SIZE,
        FilterType::Lanczos3,
    );
    let resized_mask = image::imageops::resize(
        mask_patch,
        MANUAL_INPUT_SIZE,
        MANUAL_INPUT_SIZE,
        FilterType::Nearest,
    );

    let image_tensor = rgb_to_chw_tensor(&resized_image, true, 1.0 / 255.0);
    let mask_tensor = mask_to_tensor(&resized_mask);

    let output = with_cached_session(&MANUAL_SESSION, model_path, |session| {
        let outputs = session
            .run(ort::inputs![
                TensorRef::from_array_view(image_tensor.view())
                    .map_err(|e| format!("创建手动模式图像输入张量失败: {}", e))?,
                TensorRef::from_array_view(mask_tensor.view())
                    .map_err(|e| format!("创建手动模式遮罩输入张量失败: {}", e))?
            ])
            .map_err(|e| format!("LaMa 修复模型推理失败: {}", e))?;

        if outputs.len() == 0 {
            return Err("LaMa 修复模型没有返回任何输出".to_string());
        }

        outputs[0]
            .try_extract_array::<f32>()
            .map(|arr| arr.to_owned())
            .map_err(|e| format!("读取 LaMa 修复结果失败: {}", e))
    })?;

    let restored_small = tensor_to_rgb_image(output.view(), false, true)?;
    Ok(image::imageops::resize(
        &restored_small,
        image_patch.width(),
        image_patch.height(),
        FilterType::Lanczos3,
    ))
}

fn with_cached_session<T>(
    cache: &OnceLock<Mutex<Option<CachedSession>>>,
    model_path: &Path,
    run: impl FnOnce(&mut Session) -> Result<T, String>,
) -> Result<T, String> {
    if !model_path.is_file() {
        return Err(format!("模型文件不存在: {}", model_path.display()));
    }

    let cache = cache.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().map_err(|_| "模型会话锁定失败".to_string())?;
    let needs_reload = guard
        .as_ref()
        .map(|entry| entry.model_path != model_path)
        .unwrap_or(true);

    if needs_reload {
        let thread_count = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .min(8);

        let session = Session::builder()
            .map_err(|e| format!("创建 ONNX 会话失败: {}", e))?
            .with_optimization_level(GraphOptimizationLevel::Level1)
            .map_err(|e| format!("设置 ONNX 优化级别失败: {}", e))?
            .with_intra_threads(thread_count)
            .map_err(|e| format!("设置 ONNX 线程数失败: {}", e))?
            .commit_from_file(model_path)
            .map_err(|e| format!("加载模型失败: {}", e))?;

        *guard = Some(CachedSession {
            model_path: model_path.to_path_buf(),
            session,
        });
    }

    let entry = guard
        .as_mut()
        .ok_or_else(|| "模型会话初始化失败".to_string())?;
    run(&mut entry.session)
}

fn rgb_to_chw_tensor(image: &RgbImage, bgr_order: bool, scale: f32) -> Array4<f32> {
    let (width, height) = image.dimensions();
    let mut tensor = Array4::<f32>::zeros((1, 3, height as usize, width as usize));

    for (x, y, pixel) in image.enumerate_pixels() {
        let [r, g, b] = pixel.0;
        let channels = if bgr_order { [b, g, r] } else { [r, g, b] };
        for channel in 0..3 {
            tensor[[0, channel, y as usize, x as usize]] = channels[channel] as f32 * scale;
        }
    }

    tensor
}

fn mask_to_tensor(mask: &GrayImage) -> Array4<f32> {
    let (width, height) = mask.dimensions();
    let mut tensor = Array4::<f32>::zeros((1, 1, height as usize, width as usize));

    for (x, y, pixel) in mask.enumerate_pixels() {
        tensor[[0, 0, y as usize, x as usize]] = if pixel.0[0] > MASK_THRESHOLD {
            1.0
        } else {
            0.0
        };
    }

    tensor
}

fn tensor_to_rgb_image(
    array: ArrayViewD<'_, f32>,
    from_zero_one: bool,
    swap_rb: bool,
) -> Result<RgbImage, String> {
    let dims = array.shape();
    let data = array
        .as_slice()
        .ok_or_else(|| "模型输出不是连续内存，无法读取".to_string())?;

    let (channels, height, width, layout_chw) = match dims.len() {
        4 if dims[1] == 3 => (dims[1], dims[2], dims[3], true),
        4 if dims[3] == 3 => (dims[3], dims[1], dims[2], false),
        3 if dims[0] == 3 => (dims[0], dims[1], dims[2], true),
        3 if dims[2] == 3 => (dims[2], dims[0], dims[1], false),
        _ => return Err(format!("不支持的模型输出维度: {:?}", dims)),
    };

    if channels != 3 {
        return Err(format!("模型输出通道数异常: {}", channels));
    }

    let mut image = RgbImage::new(width as u32, height as u32);
    for y in 0..height {
        for x in 0..width {
            let read = |c: usize| -> f32 {
                if layout_chw {
                    data[c * height * width + y * width + x]
                } else {
                    data[y * width * 3 + x * 3 + c]
                }
            };

            let mut r = read(0);
            let mut g = read(1);
            let mut b = read(2);

            if swap_rb {
                std::mem::swap(&mut r, &mut b);
            }

            if from_zero_one {
                r *= 255.0;
                g *= 255.0;
                b *= 255.0;
            }

            image.put_pixel(
                x as u32,
                y as u32,
                image::Rgb([
                    r.round().clamp(0.0, 255.0) as u8,
                    g.round().clamp(0.0, 255.0) as u8,
                    b.round().clamp(0.0, 255.0) as u8,
                ]),
            );
        }
    }

    Ok(image)
}

fn decode_mask(mask_data_url: &str) -> Result<GrayImage, String> {
    let raw = if let Some(idx) = mask_data_url.find(',') {
        &mask_data_url[idx + 1..]
    } else {
        mask_data_url
    };

    let bytes = general_purpose::STANDARD
        .decode(raw.trim())
        .map_err(|e| format!("遮罩 base64 解码失败: {}", e))?;
    let image = image::load_from_memory(&bytes).map_err(|e| format!("读取遮罩失败: {}", e))?;
    Ok(image.to_luma8())
}

fn encode_png_data_url_rgb(image: &RgbImage) -> Result<String, String> {
    let mut buffer = Vec::new();
    DynamicImage::ImageRgb8(image.clone())
        .write_to(&mut Cursor::new(&mut buffer), ImageFormat::Png)
        .map_err(|e| format!("输出 PNG 编码失败: {}", e))?;

    Ok(format!(
        "data:image/png;base64,{}",
        general_purpose::STANDARD.encode(buffer)
    ))
}

fn encode_png_data_url_gray(image: &GrayImage) -> Result<String, String> {
    let mut buffer = Vec::new();
    DynamicImage::ImageLuma8(image.clone())
        .write_to(&mut Cursor::new(&mut buffer), ImageFormat::Png)
        .map_err(|e| format!("输出遮罩 PNG 编码失败: {}", e))?;

    Ok(format!(
        "data:image/png;base64,{}",
        general_purpose::STANDARD.encode(buffer)
    ))
}
