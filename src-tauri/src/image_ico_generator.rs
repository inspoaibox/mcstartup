use image::codecs::ico::{IcoEncoder, IcoFrame};
use image::imageops::FilterType;
use image::{ExtendedColorType, Rgba, RgbaImage};
use imageproc::drawing::{draw_text_mut, text_size};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipWriter};

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "ico"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IcoGenerateOptions {
    #[serde(default)]
    pub input_paths: Vec<String>,
    pub output_dir: String,
    pub sizes: Vec<u32>,
    #[serde(default = "default_color_mode")]
    pub color_mode: String,
    #[serde(default)]
    pub text_icons: Vec<IcoTextIconRequest>,
    #[serde(default)]
    pub include_zip: bool,
    #[serde(default)]
    pub recursive: bool,
    #[serde(default = "default_zip_name")]
    pub zip_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IcoTextIconRequest {
    pub text: String,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_text_color")]
    pub text_color: String,
    #[serde(default = "default_background_color")]
    pub background_color: String,
    #[serde(default = "default_background_color2")]
    pub background_color2: String,
    #[serde(default = "default_text_shape")]
    pub shape: String,
    #[serde(default = "default_background_style")]
    pub background_style: String,
    #[serde(default = "default_padding_percent")]
    pub padding_percent: u32,
    #[serde(default)]
    pub font_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IcoSourceInfo {
    pub path: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IcoGeneratedFile {
    pub input_path: String,
    pub output_path: String,
    pub output_size: u64,
    pub sizes: Vec<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IcoGenerateResult {
    pub total_inputs: usize,
    pub generated: Vec<IcoGeneratedFile>,
    pub errors: Vec<String>,
    pub skipped_sizes: Vec<u32>,
    pub zip_path: Option<String>,
}

#[tauri::command]
pub fn image_ico_scan_directory(
    path: String,
    recursive: bool,
) -> Result<Vec<IcoSourceInfo>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err("请选择有效的图片目录".to_string());
    }
    let mut paths = Vec::new();
    collect_image_paths(&root, recursive, &mut paths)?;
    paths
        .into_iter()
        .map(|path| source_info(&path))
        .collect::<Result<Vec<_>, _>>()
}

#[tauri::command]
pub fn image_ico_inspect_files(paths: Vec<String>) -> Result<Vec<IcoSourceInfo>, String> {
    paths
        .into_iter()
        .map(PathBuf::from)
        .filter(|path| path.is_file() && is_supported_image(path))
        .map(|path| source_info(&path))
        .collect::<Result<Vec<_>, _>>()
}

#[tauri::command]
pub async fn image_ico_generate(options: IcoGenerateOptions) -> Result<IcoGenerateResult, String> {
    tauri::async_runtime::spawn_blocking(move || generate_ico_impl(options))
        .await
        .map_err(|e| format!("ICO 生成任务执行失败: {}", e))?
}

fn generate_ico_impl(options: IcoGenerateOptions) -> Result<IcoGenerateResult, String> {
    let output_dir = PathBuf::from(&options.output_dir);
    fs::create_dir_all(&output_dir).map_err(|e| format!("创建输出目录失败: {}", e))?;
    let (sizes, skipped_sizes) = normalize_sizes(&options.sizes)?;
    let color_mode = normalize_color_mode(&options.color_mode);
    let mut input_paths = Vec::new();
    for input in &options.input_paths {
        let path = PathBuf::from(input);
        if path.is_dir() {
            collect_image_paths(&path, options.recursive, &mut input_paths)?;
        } else if path.is_file() && is_supported_image(&path) {
            input_paths.push(path);
        }
    }
    dedupe_paths(&mut input_paths);
    let text_icons = options
        .text_icons
        .into_iter()
        .map(normalize_text_icon_request)
        .filter(|item| !item.text.trim().is_empty())
        .collect::<Vec<_>>();
    if input_paths.is_empty() && text_icons.is_empty() {
        return Err("请添加图片，或输入要生成图标的文字".to_string());
    }

    let mut generated = Vec::new();
    let mut errors = Vec::new();
    for input_path in &input_paths {
        match generate_one_icon(input_path, &output_dir, &sizes, color_mode) {
            Ok(file) => generated.push(file),
            Err(err) => errors.push(format!("{}：{}", display_name(input_path), err)),
        }
    }
    for (index, text_icon) in text_icons.iter().enumerate() {
        match generate_one_text_icon(text_icon, index, &output_dir, &sizes, color_mode) {
            Ok(file) => generated.push(file),
            Err(err) => errors.push(format!(
                "{}：{}",
                text_icon_output_stem(text_icon, index),
                err
            )),
        }
    }

    let zip_path = if options.include_zip && !generated.is_empty() {
        Some(create_zip(&output_dir, &options.zip_name, &generated)?)
    } else {
        None
    };

    Ok(IcoGenerateResult {
        total_inputs: input_paths.len() + text_icons.len(),
        generated,
        errors,
        skipped_sizes,
        zip_path,
    })
}

fn normalize_text_icon_request(mut value: IcoTextIconRequest) -> IcoTextIconRequest {
    value.text = value.text.trim().to_string();
    value.name = value.name.trim().to_string();
    value.text_color = value.text_color.trim().to_string();
    value.background_color = value.background_color.trim().to_string();
    value.background_color2 = value.background_color2.trim().to_string();
    value.shape = value.shape.trim().to_string();
    value.background_style = value.background_style.trim().to_string();
    value.font_path = value.font_path.trim().to_string();
    value.padding_percent = value.padding_percent.clamp(8, 42);
    value
}

fn generate_one_icon(
    input_path: &Path,
    output_dir: &Path,
    sizes: &[u32],
    color_mode: ColorMode,
) -> Result<IcoGeneratedFile, String> {
    let image = image::open(input_path).map_err(|e| format!("读取图片失败: {}", e))?;
    let stem = input_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("icon");
    let output_path = unique_output_path(output_dir, stem, "ico");
    let mut frames = Vec::new();
    for size in sizes {
        let resized = image.resize_exact(*size, *size, FilterType::Lanczos3);
        match color_mode {
            ColorMode::Rgba => {
                let rgba = resized.to_rgba8();
                frames.push(
                    IcoFrame::as_png(rgba.as_raw(), *size, *size, ExtendedColorType::Rgba8)
                        .map_err(|e| format!("编码 {}x{} 透明图层失败: {}", size, size, e))?,
                );
            }
            ColorMode::Rgb => {
                let rgb = flatten_to_rgb(&resized);
                frames.push(
                    IcoFrame::as_png(rgb.as_raw(), *size, *size, ExtendedColorType::Rgb8)
                        .map_err(|e| format!("编码 {}x{} RGB 图层失败: {}", size, size, e))?,
                );
            }
        }
    }

    let mut bytes = Vec::new();
    IcoEncoder::new(&mut bytes)
        .encode_images(&frames)
        .map_err(|e| format!("写入 ICO 失败: {}", e))?;
    fs::write(&output_path, &bytes).map_err(|e| format!("保存 ICO 失败: {}", e))?;
    let output_size = fs::metadata(&output_path)
        .map(|meta| meta.len())
        .unwrap_or(bytes.len() as u64);

    Ok(IcoGeneratedFile {
        input_path: input_path.to_string_lossy().to_string(),
        output_path: output_path.to_string_lossy().to_string(),
        output_size,
        sizes: sizes.to_vec(),
    })
}

fn generate_one_text_icon(
    request: &IcoTextIconRequest,
    index: usize,
    output_dir: &Path,
    sizes: &[u32],
    color_mode: ColorMode,
) -> Result<IcoGeneratedFile, String> {
    let stem = text_icon_output_stem(request, index);
    let output_path = unique_output_path(output_dir, &stem, "ico");
    let font = load_text_icon_font(&request.font_path)?;
    let mut frames = Vec::new();
    for size in sizes {
        let rgba = render_text_icon_frame(request, &font, *size)?;
        match color_mode {
            ColorMode::Rgba => {
                frames.push(
                    IcoFrame::as_png(rgba.as_raw(), *size, *size, ExtendedColorType::Rgba8)
                        .map_err(|e| format!("编码 {}x{} 文字透明图层失败: {}", size, size, e))?,
                );
            }
            ColorMode::Rgb => {
                let dynamic = image::DynamicImage::ImageRgba8(rgba);
                let rgb = flatten_to_rgb(&dynamic);
                frames.push(
                    IcoFrame::as_png(rgb.as_raw(), *size, *size, ExtendedColorType::Rgb8)
                        .map_err(|e| format!("编码 {}x{} 文字 RGB 图层失败: {}", size, size, e))?,
                );
            }
        }
    }

    let mut bytes = Vec::new();
    IcoEncoder::new(&mut bytes)
        .encode_images(&frames)
        .map_err(|e| format!("写入文字 ICO 失败: {}", e))?;
    fs::write(&output_path, &bytes).map_err(|e| format!("保存文字 ICO 失败: {}", e))?;
    let output_size = fs::metadata(&output_path)
        .map(|meta| meta.len())
        .unwrap_or(bytes.len() as u64);

    Ok(IcoGeneratedFile {
        input_path: format!("text:{}", request.text),
        output_path: output_path.to_string_lossy().to_string(),
        output_size,
        sizes: sizes.to_vec(),
    })
}

fn render_text_icon_frame(
    request: &IcoTextIconRequest,
    font: &ab_glyph::FontArc,
    output_size: u32,
) -> Result<RgbaImage, String> {
    let scale_factor = if output_size <= 32 { 6 } else { 4 };
    let canvas_size = output_size * scale_factor;
    let mut canvas = RgbaImage::from_pixel(canvas_size, canvas_size, Rgba([0, 0, 0, 0]));
    let background_style = normalize_background_style(&request.background_style);
    let shape = normalize_text_shape(&request.shape);
    let background = parse_hex_color(&request.background_color, Rgba([37, 99, 235, 255]));
    let background2 = parse_hex_color(&request.background_color2, Rgba([14, 165, 233, 255]));
    if background_style != TextBackgroundStyle::Transparent {
        paint_text_icon_background(
            &mut canvas,
            shape,
            background_style,
            background,
            background2,
        );
    }

    let text_color = parse_hex_color(&request.text_color, Rgba([255, 255, 255, 255]));
    let lines = text_icon_lines(&request.text);
    if lines.is_empty() {
        return Err("请输入文字内容".to_string());
    }
    let padding = ((canvas_size as f32) * (request.padding_percent as f32 / 100.0)).round() as u32;
    let available = canvas_size.saturating_sub(padding * 2).max(1);
    let scale = fit_text_scale(font, &lines, available, available);
    let metrics = text_icon_layout_metrics(font, &lines, scale);
    let line_gap = (scale * 0.12).round().max(1.0) as u32;
    let total_height = metrics
        .iter()
        .map(|(_, height)| *height)
        .sum::<u32>()
        .saturating_add(line_gap.saturating_mul(lines.len().saturating_sub(1) as u32));
    let mut y = ((canvas_size.saturating_sub(total_height)) / 2) as i32;
    for (line, (width, height)) in lines.iter().zip(metrics.iter()) {
        let x = ((canvas_size.saturating_sub(*width)) / 2) as i32;
        draw_text_mut(&mut canvas, text_color, x, y, scale, font, line);
        y += *height as i32 + line_gap as i32;
    }

    let resized = image::imageops::resize(&canvas, output_size, output_size, FilterType::Lanczos3);
    Ok(resized)
}

fn fit_text_scale(
    font: &ab_glyph::FontArc,
    lines: &[String],
    max_width: u32,
    max_height: u32,
) -> f32 {
    let mut low = 4.0f32;
    let mut high = max_height.max(8) as f32;
    for _ in 0..18 {
        let mid = (low + high) / 2.0;
        let metrics = text_icon_layout_metrics(font, lines, mid);
        let line_gap = (mid * 0.12).round().max(1.0) as u32;
        let width = metrics.iter().map(|(w, _)| *w).max().unwrap_or(0);
        let height = metrics
            .iter()
            .map(|(_, h)| *h)
            .sum::<u32>()
            .saturating_add(line_gap.saturating_mul(lines.len().saturating_sub(1) as u32));
        if width <= max_width && height <= max_height {
            low = mid;
        } else {
            high = mid;
        }
    }
    low.max(4.0)
}

fn text_icon_layout_metrics(
    font: &ab_glyph::FontArc,
    lines: &[String],
    scale: f32,
) -> Vec<(u32, u32)> {
    lines
        .iter()
        .map(|line| {
            let (width, height) = text_size(scale, font, line);
            (width.max(1), height.max(1))
        })
        .collect()
}

fn paint_text_icon_background(
    image: &mut RgbaImage,
    shape: TextIconShape,
    style: TextBackgroundStyle,
    color1: Rgba<u8>,
    color2: Rgba<u8>,
) {
    let size = image.width().max(1);
    for y in 0..size {
        for x in 0..size {
            if !text_icon_shape_contains(shape, x, y, size) {
                continue;
            }
            let color = match style {
                TextBackgroundStyle::Solid => color1,
                TextBackgroundStyle::Gradient => blend_rgba(
                    color1,
                    color2,
                    (x + y) as f32 / ((size - 1).max(1) * 2) as f32,
                ),
                TextBackgroundStyle::Transparent => Rgba([0, 0, 0, 0]),
            };
            image.put_pixel(x, y, color);
        }
    }
}

fn text_icon_shape_contains(shape: TextIconShape, x: u32, y: u32, size: u32) -> bool {
    match shape {
        TextIconShape::Square => true,
        TextIconShape::Circle => {
            let center = (size as f32 - 1.0) / 2.0;
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            let radius = center;
            dx * dx + dy * dy <= radius * radius
        }
        TextIconShape::Rounded => {
            let radius = (size as f32 * 0.22).round().max(1.0);
            let xf = x as f32;
            let yf = y as f32;
            let max = size as f32 - 1.0;
            let cx = if xf < radius {
                radius
            } else if xf > max - radius {
                max - radius
            } else {
                xf
            };
            let cy = if yf < radius {
                radius
            } else if yf > max - radius {
                max - radius
            } else {
                yf
            };
            let dx = xf - cx;
            let dy = yf - cy;
            dx * dx + dy * dy <= radius * radius
        }
    }
}

fn blend_rgba(a: Rgba<u8>, b: Rgba<u8>, t: f32) -> Rgba<u8> {
    let t = t.clamp(0.0, 1.0);
    let inv = 1.0 - t;
    Rgba([
        (f32::from(a[0]) * inv + f32::from(b[0]) * t).round() as u8,
        (f32::from(a[1]) * inv + f32::from(b[1]) * t).round() as u8,
        (f32::from(a[2]) * inv + f32::from(b[2]) * t).round() as u8,
        (f32::from(a[3]) * inv + f32::from(b[3]) * t).round() as u8,
    ])
}

fn text_icon_lines(text: &str) -> Vec<String> {
    let lines = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(3)
        .map(|line| line.chars().take(14).collect::<String>())
        .collect::<Vec<_>>();
    if lines.is_empty() && !text.trim().is_empty() {
        vec![text.trim().chars().take(14).collect()]
    } else {
        lines
    }
}

fn load_text_icon_font(font_path: &str) -> Result<ab_glyph::FontArc, String> {
    let mut candidates = Vec::new();
    if !font_path.trim().is_empty() {
        candidates.push(PathBuf::from(font_path));
    }
    if cfg!(target_os = "windows") {
        let font_dir = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
            .join("Fonts");
        for name in [
            "msyh.ttc",
            "msyh.ttf",
            "simhei.ttf",
            "simsunb.ttf",
            "arialbd.ttf",
            "seguisb.ttf",
            "arial.ttf",
            "SegUIVar.ttf",
        ] {
            candidates.push(font_dir.join(name));
        }
    }
    for candidate in candidates {
        if !candidate.is_file() {
            continue;
        }
        let Ok(bytes) = fs::read(&candidate) else {
            continue;
        };
        if let Ok(font) = ab_glyph::FontArc::try_from_vec(bytes) {
            return Ok(font);
        }
    }
    Err("未找到可用字体。可手动选择 .ttf/.otf 字体文件后再生成。".to_string())
}

fn parse_hex_color(value: &str, fallback: Rgba<u8>) -> Rgba<u8> {
    let hex = value.trim().trim_start_matches('#');
    let expanded = match hex.len() {
        3 => hex.chars().flat_map(|ch| [ch, ch]).collect::<String>(),
        4 => hex.chars().flat_map(|ch| [ch, ch]).collect::<String>(),
        6 | 8 => hex.to_string(),
        _ => return fallback,
    };
    let parse = |range: std::ops::Range<usize>| u8::from_str_radix(&expanded[range], 16).ok();
    match (parse(0..2), parse(2..4), parse(4..6)) {
        (Some(r), Some(g), Some(b)) => {
            let alpha = if expanded.len() >= 8 {
                parse(6..8).unwrap_or(255)
            } else {
                255
            };
            Rgba([r, g, b, alpha])
        }
        _ => fallback,
    }
}

fn text_icon_output_stem(request: &IcoTextIconRequest, index: usize) -> String {
    let raw = if request.name.trim().is_empty() {
        request.text.trim()
    } else {
        request.name.trim()
    };
    let stem = raw
        .chars()
        .filter(|ch| !ch.is_control())
        .take(40)
        .collect::<String>();
    if stem.trim().is_empty() {
        format!("text-icon-{}", index + 1)
    } else {
        stem
    }
}

fn flatten_to_rgb(image: &image::DynamicImage) -> image::RgbImage {
    let rgba = image.to_rgba8();
    let mut out =
        image::RgbImage::from_pixel(rgba.width(), rgba.height(), image::Rgb([255, 255, 255]));
    for (x, y, pixel) in rgba.enumerate_pixels() {
        let alpha = f32::from(pixel[3]) / 255.0;
        let inv = 1.0 - alpha;
        out.put_pixel(
            x,
            y,
            image::Rgb([
                (f32::from(pixel[0]) * alpha + 255.0 * inv).round() as u8,
                (f32::from(pixel[1]) * alpha + 255.0 * inv).round() as u8,
                (f32::from(pixel[2]) * alpha + 255.0 * inv).round() as u8,
            ]),
        );
    }
    out
}

fn collect_image_paths(dir: &Path, recursive: bool, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录条目失败: {}", e))?;
        let path = entry.path();
        if path.is_dir() && recursive {
            collect_image_paths(&path, recursive, out)?;
        } else if path.is_file() && is_supported_image(&path) {
            out.push(path);
        }
    }
    Ok(())
}

fn source_info(path: &Path) -> Result<IcoSourceInfo, String> {
    let (width, height) = image::image_dimensions(path)
        .map_err(|e| format!("读取 {} 尺寸失败: {}", display_name(path), e))?;
    Ok(IcoSourceInfo {
        path: path.to_string_lossy().to_string(),
        name: display_name(path),
        width,
        height,
    })
}

fn create_zip(
    output_dir: &Path,
    zip_name: &str,
    generated: &[IcoGeneratedFile],
) -> Result<String, String> {
    let zip_stem = Path::new(zip_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(zip_name);
    let zip_path = unique_output_path(output_dir, sanitize_stem(zip_stem).as_str(), "zip");
    let file = fs::File::create(&zip_path).map_err(|e| format!("创建 ZIP 失败: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);
    for item in generated {
        let path = PathBuf::from(&item.output_path);
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("icon.ico");
        let data = fs::read(&path).map_err(|e| format!("读取 {} 失败: {}", name, e))?;
        zip.start_file(name, options)
            .map_err(|e| format!("写入 ZIP 条目失败: {}", e))?;
        zip.write_all(&data)
            .map_err(|e| format!("写入 ZIP 数据失败: {}", e))?;
    }
    zip.finish().map_err(|e| format!("保存 ZIP 失败: {}", e))?;
    Ok(zip_path.to_string_lossy().to_string())
}

fn unique_output_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let stem = sanitize_stem(stem);
    let mut candidate = dir.join(format!("{}.{}", stem, ext));
    let mut index = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{}_{}.{}", stem, index, ext));
        index += 1;
    }
    candidate
}

fn sanitize_stem(value: &str) -> String {
    let mut out = value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => ch,
        })
        .collect::<String>();
    out = out.trim_matches(['.', ' ']).to_string();
    if out.is_empty() {
        "icons".to_string()
    } else {
        out
    }
}

fn normalize_sizes(values: &[u32]) -> Result<(Vec<u32>, Vec<u32>), String> {
    let mut sizes = values
        .iter()
        .copied()
        .filter(|size| (1..=256).contains(size))
        .collect::<Vec<_>>();
    sizes.sort_unstable();
    sizes.dedup();
    let mut skipped = values
        .iter()
        .copied()
        .filter(|size| *size > 256)
        .collect::<Vec<_>>();
    skipped.sort_unstable();
    skipped.dedup();
    if sizes.is_empty() {
        return Err("请至少选择一个 1 到 256 之间的 ICO 尺寸".to_string());
    }
    Ok((sizes, skipped))
}

fn dedupe_paths(paths: &mut Vec<PathBuf>) {
    let mut seen = HashSet::new();
    paths.retain(|path| seen.insert(path.to_string_lossy().to_lowercase()));
}

fn is_supported_image(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|ext| {
            IMAGE_EXTENSIONS
                .iter()
                .any(|item| ext.eq_ignore_ascii_case(item))
        })
        .unwrap_or(false)
}

fn display_name(path: &Path) -> String {
    match path.file_name().and_then(|value| value.to_str()) {
        Some(name) => name.to_string(),
        None => path.to_string_lossy().to_string(),
    }
}

#[derive(Clone, Copy)]
enum ColorMode {
    Rgba,
    Rgb,
}

#[derive(Clone, Copy)]
enum TextIconShape {
    Square,
    Rounded,
    Circle,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TextBackgroundStyle {
    Solid,
    Gradient,
    Transparent,
}

fn normalize_color_mode(value: &str) -> ColorMode {
    if value.eq_ignore_ascii_case("rgb") {
        ColorMode::Rgb
    } else {
        ColorMode::Rgba
    }
}

fn normalize_text_shape(value: &str) -> TextIconShape {
    match value.to_lowercase().as_str() {
        "square" => TextIconShape::Square,
        "circle" => TextIconShape::Circle,
        _ => TextIconShape::Rounded,
    }
}

fn normalize_background_style(value: &str) -> TextBackgroundStyle {
    match value.to_lowercase().as_str() {
        "transparent" => TextBackgroundStyle::Transparent,
        "gradient" => TextBackgroundStyle::Gradient,
        _ => TextBackgroundStyle::Solid,
    }
}

fn default_color_mode() -> String {
    "rgba".to_string()
}

fn default_zip_name() -> String {
    "icons.zip".to_string()
}

fn default_text_color() -> String {
    "#ffffff".to_string()
}

fn default_background_color() -> String {
    "#2563eb".to_string()
}

fn default_background_color2() -> String {
    "#06b6d4".to_string()
}

fn default_text_shape() -> String {
    "rounded".to_string()
}

fn default_background_style() -> String {
    "gradient".to_string()
}

fn default_padding_percent() -> u32 {
    20
}
