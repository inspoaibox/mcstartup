use ab_glyph::{FontArc, PxScale};
use image::imageops::{overlay, FilterType};
use image::{DynamicImage, GenericImageView, ImageFormat, Rgba, RgbaImage};
use imageproc::drawing::draw_text_mut;
use imageproc::geometric_transformations::{rotate_about_center, Interpolation};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageBatchScanOptions {
    pub recursive: bool,
    pub include_hidden: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageBatchFileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub width: u32,
    pub height: u32,
    pub format: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageBatchProcessOptions {
    pub input_paths: Vec<String>,
    pub output_dir: String,
    pub output_template: String,
    pub overwrite: bool,
    pub steps: Vec<ImageBatchStep>,
    pub output_format: ImageBatchOutputFormat,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type")]
pub enum ImageBatchStep {
    Crop(ImageBatchCropStep),
    Resize(ImageBatchResizeStep),
    Transform(ImageBatchTransformStep),
    Watermark(ImageBatchWatermarkStep),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageBatchCropStep {
    pub mode: String,
    pub aspect_w: Option<u32>,
    pub aspect_h: Option<u32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub anchor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageBatchResizeStep {
    pub mode: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub percent: Option<f32>,
    pub allow_enlarge: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageBatchTransformStep {
    pub rotate: Option<u16>,
    pub flip_h: bool,
    pub flip_v: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageBatchWatermarkStep {
    pub mode: String,
    pub text: Option<String>,
    pub image_path: Option<String>,
    pub opacity: f32,
    pub scale: f32,
    pub font_size: Option<f32>,
    pub color: Option<String>,
    pub angle: Option<f32>,
    pub layout: String,
    pub position: String,
    pub gap_x: Option<u32>,
    pub gap_y: Option<u32>,
    pub offset_x: Option<i32>,
    pub offset_y: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageBatchOutputFormat {
    pub format: String,
    pub quality: Option<u8>,
    pub keep_original: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageBatchProcessResult {
    pub total: usize,
    pub success: usize,
    pub failed: usize,
    pub items: Vec<ImageBatchItemResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageBatchItemResult {
    pub input_path: String,
    pub output_path: Option<String>,
    pub success: bool,
    pub error: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub size: Option<u64>,
}

#[tauri::command]
pub fn image_batch_inspect_paths(paths: Vec<String>) -> Result<Vec<ImageBatchFileInfo>, String> {
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    for path in paths {
        let path = absolute_path(Path::new(&path))?;
        if path.is_dir() {
            let nested = image_batch_scan_dir(
                path.to_string_lossy().to_string(),
                ImageBatchScanOptions {
                    recursive: false,
                    include_hidden: true,
                },
            )?;
            for item in nested {
                if seen.insert(item.path.to_ascii_lowercase()) {
                    files.push(item);
                }
            }
            continue;
        }
        if !path.is_file() || !is_supported_image_path(&path) {
            continue;
        }
        let item = inspect_image_path(&path)?;
        if seen.insert(item.path.to_ascii_lowercase()) {
            files.push(item);
        }
    }
    Ok(files)
}

#[tauri::command]
pub fn image_batch_scan_dir(
    root: String,
    options: ImageBatchScanOptions,
) -> Result<Vec<ImageBatchFileInfo>, String> {
    let root = absolute_path(Path::new(&root))?;
    if !root.is_dir() {
        return Err("请选择有效图片文件夹".to_string());
    }
    let mut files = Vec::new();
    let mut stack = vec![root];

    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {}", e))?;
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if !options.include_hidden && is_hidden_path(&path, &metadata) {
                continue;
            }
            if metadata.is_dir() {
                if options.recursive {
                    stack.push(path);
                }
                continue;
            }
            if !metadata.is_file() || !is_supported_image_path(&path) {
                continue;
            }
            if let Ok(info) = inspect_image_path(&path) {
                files.push(info);
            }
        }
    }
    Ok(files)
}

#[tauri::command]
pub async fn image_batch_process(
    options: ImageBatchProcessOptions,
) -> Result<ImageBatchProcessResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_image_batch_process(options))
        .await
        .map_err(|e| format!("批量图片处理任务失败: {}", e))?
}

fn run_image_batch_process(
    options: ImageBatchProcessOptions,
) -> Result<ImageBatchProcessResult, String> {
    if options.input_paths.is_empty() {
        return Err("请先添加图片".to_string());
    }
    let output_dir = absolute_path(Path::new(&options.output_dir))?;
    std::fs::create_dir_all(&output_dir).map_err(|e| format!("创建输出目录失败: {}", e))?;

    let mut used_targets = HashSet::new();
    let mut items = Vec::new();

    for (index, input_path) in options.input_paths.iter().enumerate() {
        let result = process_one_image(input_path, index, &output_dir, &options, &mut used_targets);
        items.push(result);
    }

    let success = items.iter().filter(|item| item.success).count();
    Ok(ImageBatchProcessResult {
        total: items.len(),
        success,
        failed: items.len().saturating_sub(success),
        items,
    })
}

fn process_one_image(
    input_path: &str,
    index: usize,
    output_dir: &Path,
    options: &ImageBatchProcessOptions,
    used_targets: &mut HashSet<String>,
) -> ImageBatchItemResult {
    let input = match absolute_path(Path::new(input_path)) {
        Ok(value) => value,
        Err(error) => return failed_result(input_path, error),
    };

    let original_format = image::ImageReader::open(&input)
        .and_then(|reader| reader.with_guessed_format())
        .ok()
        .and_then(|reader| reader.format());
    let mut img = match image::open(&input) {
        Ok(value) => value,
        Err(error) => return failed_result(input_path, format!("读取图片失败: {}", error)),
    };

    for step in &options.steps {
        match apply_step(img, step) {
            Ok(value) => img = value,
            Err(error) => return failed_result(input_path, error),
        }
    }

    let output_format =
        resolve_output_format(&options.output_format, original_format).unwrap_or(ImageFormat::Png);
    let target = match build_output_path(
        &input,
        &img,
        index,
        output_dir,
        output_format,
        options,
        used_targets,
    ) {
        Ok(value) => value,
        Err(error) => return failed_result(input_path, error),
    };

    if let Err(error) = write_image(
        &img,
        &target,
        output_format,
        options.output_format.quality.unwrap_or(90),
    ) {
        return failed_result(input_path, error);
    }

    let size = std::fs::metadata(&target).ok().map(|m| m.len());
    ImageBatchItemResult {
        input_path: input.to_string_lossy().to_string(),
        output_path: Some(target.to_string_lossy().to_string()),
        success: true,
        error: None,
        width: Some(img.width()),
        height: Some(img.height()),
        size,
    }
}

fn apply_step(img: DynamicImage, step: &ImageBatchStep) -> Result<DynamicImage, String> {
    match step {
        ImageBatchStep::Crop(step) => apply_crop(img, step),
        ImageBatchStep::Resize(step) => apply_resize(img, step),
        ImageBatchStep::Transform(step) => Ok(apply_transform(img, step)),
        ImageBatchStep::Watermark(step) => apply_watermark(img, step),
    }
}

fn apply_crop(mut img: DynamicImage, step: &ImageBatchCropStep) -> Result<DynamicImage, String> {
    let (iw, ih) = img.dimensions();
    let (cw, ch) = if step.mode == "size" {
        (
            step.width.unwrap_or(iw).clamp(1, iw),
            step.height.unwrap_or(ih).clamp(1, ih),
        )
    } else {
        let aw = step.aspect_w.unwrap_or(1).max(1) as f32;
        let ah = step.aspect_h.unwrap_or(1).max(1) as f32;
        let target = aw / ah;
        let current = iw as f32 / ih as f32;
        if current > target {
            ((ih as f32 * target).round() as u32, ih)
        } else {
            (iw, (iw as f32 / target).round() as u32)
        }
    };
    let (x, y) = anchored_offset(iw, ih, cw, ch, step.anchor.as_deref().unwrap_or("center"));
    let cropped = image::imageops::crop(&mut img, x, y, cw, ch).to_image();
    Ok(DynamicImage::ImageRgba8(cropped))
}

fn apply_resize(img: DynamicImage, step: &ImageBatchResizeStep) -> Result<DynamicImage, String> {
    let (iw, ih) = img.dimensions();
    let (mut w, mut h) = match step.mode.as_str() {
        "percent" => {
            let p = step.percent.unwrap_or(100.0).clamp(1.0, 1000.0) / 100.0;
            (
                ((iw as f32 * p).round() as u32).max(1),
                ((ih as f32 * p).round() as u32).max(1),
            )
        }
        "fitWidth" => {
            let w = step.width.unwrap_or(iw).max(1);
            let h = ((w as f32 * ih as f32 / iw as f32).round() as u32).max(1);
            (w, h)
        }
        "fitHeight" => {
            let h = step.height.unwrap_or(ih).max(1);
            let w = ((h as f32 * iw as f32 / ih as f32).round() as u32).max(1);
            (w, h)
        }
        "fitBox" => {
            let max_w = step.width.unwrap_or(iw).max(1);
            let max_h = step.height.unwrap_or(ih).max(1);
            let scale = (max_w as f32 / iw as f32).min(max_h as f32 / ih as f32);
            (
                ((iw as f32 * scale).round() as u32).max(1),
                ((ih as f32 * scale).round() as u32).max(1),
            )
        }
        _ => (
            step.width.unwrap_or(iw).max(1),
            step.height.unwrap_or(ih).max(1),
        ),
    };

    if !step.allow_enlarge {
        w = w.min(iw);
        h = h.min(ih);
    }
    if w == iw && h == ih {
        return Ok(img);
    }
    Ok(img.resize_exact(w, h, FilterType::Lanczos3))
}

fn apply_transform(mut img: DynamicImage, step: &ImageBatchTransformStep) -> DynamicImage {
    img = match step.rotate.unwrap_or(0) {
        90 => img.rotate90(),
        180 => img.rotate180(),
        270 => img.rotate270(),
        _ => img,
    };
    if step.flip_h {
        img = img.fliph();
    }
    if step.flip_v {
        img = img.flipv();
    }
    img
}

fn apply_watermark(
    img: DynamicImage,
    step: &ImageBatchWatermarkStep,
) -> Result<DynamicImage, String> {
    let mut base = img.to_rgba8();
    let opacity = step.opacity.clamp(0.0, 1.0);
    if opacity <= 0.0 {
        return Ok(DynamicImage::ImageRgba8(base));
    }

    let watermark = if step.mode == "image" {
        let path = step
            .image_path
            .as_ref()
            .ok_or_else(|| "请选择水印图片".to_string())?;
        let stamp = image::open(path).map_err(|e| format!("读取水印图片失败: {}", e))?;
        make_image_watermark(stamp, step.scale.clamp(0.01, 2.0), opacity)
    } else {
        let text = step.text.as_deref().unwrap_or("").trim();
        if text.is_empty() {
            return Ok(DynamicImage::ImageRgba8(base));
        }
        make_text_watermark(
            text,
            step.font_size.unwrap_or(42.0).clamp(8.0, 300.0),
            parse_hex_rgba(step.color.as_deref().unwrap_or("#FFFFFF"), opacity),
        )?
    };

    let angle = step.angle.unwrap_or(0.0);
    let watermark = rotate_watermark(watermark, angle);
    if step.layout == "tile" {
        draw_tiled_watermark(
            &mut base,
            &watermark,
            step.gap_x.unwrap_or(220).max(20),
            step.gap_y.unwrap_or(160).max(20),
        );
    } else {
        let (x, y) = watermark_position(
            base.width(),
            base.height(),
            watermark.width(),
            watermark.height(),
            &step.position,
            step.offset_x.unwrap_or(0),
            step.offset_y.unwrap_or(0),
        );
        overlay(&mut base, &watermark, x as i64, y as i64);
    }

    Ok(DynamicImage::ImageRgba8(base))
}

fn make_text_watermark(text: &str, font_size: f32, color: Rgba<u8>) -> Result<RgbaImage, String> {
    let font =
        find_watermark_font().ok_or_else(|| "未找到可用系统字体，无法添加文字水印".to_string())?;
    let scale = PxScale::from(font_size);
    let width = ((text.chars().count().max(1) as f32 * font_size * 0.72).ceil() as u32).max(80);
    let height = (font_size * 1.8).ceil() as u32;
    let mut image = RgbaImage::from_pixel(width, height, Rgba([0, 0, 0, 0]));
    draw_text_mut(
        &mut image,
        color,
        (font_size * 0.25) as i32,
        (font_size * 0.25) as i32,
        scale,
        &font,
        text,
    );
    Ok(image)
}

fn make_image_watermark(stamp: DynamicImage, scale: f32, opacity: f32) -> RgbaImage {
    let (w, h) = stamp.dimensions();
    let sw = ((w as f32 * scale).round() as u32).max(1);
    let sh = ((h as f32 * scale).round() as u32).max(1);
    let mut rgba = stamp.resize(sw, sh, FilterType::Lanczos3).to_rgba8();
    for pixel in rgba.pixels_mut() {
        pixel.0[3] = ((pixel.0[3] as f32 * opacity).round() as u8).min(255);
    }
    rgba
}

fn rotate_watermark(watermark: RgbaImage, angle: f32) -> RgbaImage {
    let normalized = ((angle.round() as i32 % 360) + 360) % 360;
    match normalized {
        90 => image::imageops::rotate90(&watermark),
        180 => image::imageops::rotate180(&watermark),
        270 => image::imageops::rotate270(&watermark),
        0 => watermark,
        _ => rotate_about_center(
            &watermark,
            angle.to_radians(),
            Interpolation::Bilinear,
            Rgba([0, 0, 0, 0]),
        ),
    }
}

fn draw_tiled_watermark(base: &mut RgbaImage, watermark: &RgbaImage, gap_x: u32, gap_y: u32) {
    let step_x = watermark.width().saturating_add(gap_x).max(1);
    let step_y = watermark.height().saturating_add(gap_y).max(1);
    let start_x = -(watermark.width() as i64);
    let start_y = -(watermark.height() as i64);
    let end_x = base.width() as i64 + watermark.width() as i64;
    let end_y = base.height() as i64 + watermark.height() as i64;
    let mut y = start_y;
    while y < end_y {
        let mut x = start_x;
        while x < end_x {
            overlay(base, watermark, x, y);
            x += step_x as i64;
        }
        y += step_y as i64;
    }
}

fn watermark_position(
    bw: u32,
    bh: u32,
    ww: u32,
    wh: u32,
    position: &str,
    offset_x: i32,
    offset_y: i32,
) -> (i64, i64) {
    let margin = 24i64;
    let (x, y) = match position {
        "tl" => (margin, margin),
        "tr" => (bw as i64 - ww as i64 - margin, margin),
        "bl" => (margin, bh as i64 - wh as i64 - margin),
        "br" => (
            bw as i64 - ww as i64 - margin,
            bh as i64 - wh as i64 - margin,
        ),
        _ => ((bw as i64 - ww as i64) / 2, (bh as i64 - wh as i64) / 2),
    };
    (x + offset_x as i64, y + offset_y as i64)
}

fn anchored_offset(iw: u32, ih: u32, cw: u32, ch: u32, anchor: &str) -> (u32, u32) {
    let x = match anchor {
        "left" | "tl" | "bl" => 0,
        "right" | "tr" | "br" => iw.saturating_sub(cw),
        _ => iw.saturating_sub(cw) / 2,
    };
    let y = match anchor {
        "top" | "tl" | "tr" => 0,
        "bottom" | "bl" | "br" => ih.saturating_sub(ch),
        _ => ih.saturating_sub(ch) / 2,
    };
    (x, y)
}

fn build_output_path(
    input: &Path,
    img: &DynamicImage,
    index: usize,
    output_dir: &Path,
    format: ImageFormat,
    options: &ImageBatchProcessOptions,
    used_targets: &mut HashSet<String>,
) -> Result<PathBuf, String> {
    let stem = input
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let ext = image_format_ext(format);
    let template = if options.output_template.trim().is_empty() {
        "{name}_processed".to_string()
    } else {
        options.output_template.clone()
    };
    let mut base = template
        .replace("{name}", stem)
        .replace("{index}", &(index + 1).to_string())
        .replace("{num}", &format!("{:03}", index + 1))
        .replace("{width}", &img.width().to_string())
        .replace("{height}", &img.height().to_string());
    base = sanitize_file_name(&base);
    if base.is_empty() {
        base = format!("image_{:03}", index + 1);
    }
    let mut target = output_dir.join(format!("{}.{}", base, ext));
    let mut suffix = 1usize;
    while (!options.overwrite && target.exists()) || !used_targets.insert(path_key(&target)) {
        target = output_dir.join(format!("{}_{}.{}", base, suffix, ext));
        suffix += 1;
    }
    Ok(target)
}

fn write_image(
    img: &DynamicImage,
    target: &Path,
    format: ImageFormat,
    quality: u8,
) -> Result<(), String> {
    let file = std::fs::File::create(target).map_err(|e| format!("创建输出文件失败: {}", e))?;
    let mut writer = std::io::BufWriter::new(file);
    match format {
        ImageFormat::Jpeg => {
            let rgb = img.to_rgb8();
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
                &mut writer,
                quality.clamp(1, 100),
            );
            encoder
                .encode_image(&DynamicImage::ImageRgb8(rgb))
                .map_err(|e| format!("JPEG 写入失败: {}", e))
        }
        _ => img
            .write_to(&mut writer, format)
            .map_err(|e| format!("图片写入失败: {}", e)),
    }
}

fn resolve_output_format(
    option: &ImageBatchOutputFormat,
    original: Option<ImageFormat>,
) -> Option<ImageFormat> {
    if option.keep_original {
        return original;
    }
    Some(match option.format.as_str() {
        "jpeg" | "jpg" => ImageFormat::Jpeg,
        "webp" => ImageFormat::WebP,
        "bmp" => ImageFormat::Bmp,
        "tiff" => ImageFormat::Tiff,
        _ => ImageFormat::Png,
    })
}

fn image_format_ext(format: ImageFormat) -> &'static str {
    match format {
        ImageFormat::Jpeg => "jpg",
        ImageFormat::WebP => "webp",
        ImageFormat::Bmp => "bmp",
        ImageFormat::Tiff => "tiff",
        _ => "png",
    }
}

fn inspect_image_path(path: &Path) -> Result<ImageBatchFileInfo, String> {
    let metadata = std::fs::metadata(path).map_err(|e| format!("读取图片信息失败: {}", e))?;
    let reader = image::ImageReader::open(path)
        .map_err(|e| format!("打开图片失败: {}", e))?
        .with_guessed_format()
        .map_err(|e| format!("识别图片格式失败: {}", e))?;
    let format = reader.format().unwrap_or(ImageFormat::Png);
    let img = reader
        .decode()
        .map_err(|e| format!("读取图片尺寸失败: {}", e))?;
    Ok(ImageBatchFileInfo {
        path: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_string(),
        size: metadata.len(),
        width: img.width(),
        height: img.height(),
        format: image_format_ext(format).to_string(),
    })
}

fn is_supported_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "jpg" | "jpeg" | "png" | "webp" | "bmp" | "tif" | "tiff"
            )
        })
        .unwrap_or(false)
}

fn absolute_path(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        std::env::current_dir()
            .map(|dir| dir.join(path))
            .map_err(|e| format!("解析路径失败: {}", e))
    }
}

fn sanitize_file_name(value: &str) -> String {
    value
        .replace(['<', '>', ':', '"', '/', '\\', '|', '?', '*'], "_")
        .trim_matches(['.', ' '])
        .to_string()
}

fn parse_hex_rgba(hex: &str, opacity: f32) -> Rgba<u8> {
    let value = hex.trim().trim_start_matches('#');
    let parse = |range: std::ops::Range<usize>| {
        value
            .get(range)
            .and_then(|part| u8::from_str_radix(part, 16).ok())
            .unwrap_or(255)
    };
    Rgba([
        parse(0..2),
        parse(2..4),
        parse(4..6),
        (opacity.clamp(0.0, 1.0) * 255.0) as u8,
    ])
}

fn find_watermark_font() -> Option<FontArc> {
    #[cfg(target_os = "windows")]
    {
        let fonts_dir = Path::new(r"C:\Windows\Fonts");
        for name in [
            "simhei.ttf",
            "simkai.ttf",
            "arial.ttf",
            "msyh.ttf",
            "msyh.ttc",
            "simsun.ttc",
        ] {
            let path = fonts_dir.join(name);
            if path.exists() {
                if let Ok(bytes) = std::fs::read(path) {
                    if let Ok(font) = FontArc::try_from_vec(bytes) {
                        return Some(font);
                    }
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        for path in [
            "/System/Library/Fonts/PingFang.ttc",
            "/Library/Fonts/Arial Unicode.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
        ] {
            if Path::new(path).exists() {
                if let Ok(bytes) = std::fs::read(path) {
                    if let Ok(font) = FontArc::try_from_vec(bytes) {
                        return Some(font);
                    }
                }
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        for path in [
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ] {
            if Path::new(path).exists() {
                if let Ok(bytes) = std::fs::read(path) {
                    if let Ok(font) = FontArc::try_from_vec(bytes) {
                        return Some(font);
                    }
                }
            }
        }
    }
    None
}

fn failed_result(input_path: &str, error: String) -> ImageBatchItemResult {
    ImageBatchItemResult {
        input_path: input_path.to_string(),
        output_path: None,
        success: false,
        error: Some(error),
        width: None,
        height: None,
        size: None,
    }
}

fn path_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    #[cfg(target_os = "windows")]
    {
        value.to_ascii_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        value
    }
}

fn is_hidden_path(path: &Path, metadata: &std::fs::Metadata) -> bool {
    if path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|name| name.starts_with('.'))
        .unwrap_or(false)
    {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}
