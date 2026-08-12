use base64::{engine::general_purpose, Engine as _};
use image::imageops::FilterType;
use image::{DynamicImage, GrayImage, ImageFormat, Luma, RgbaImage};
use ndarray::{Array4, ArrayViewD};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::TensorRef;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::{Path, PathBuf};

const MODEL_REPO_ID: &str = "onnx-community/BiRefNet_lite-ONNX";
const MODEL_FILE: &str = "onnx/model.onnx";
const INPUT_WIDTH: u32 = 1024;
const INPUT_HEIGHT: u32 = 1024;
const IMAGE_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const IMAGE_STD: [f32; 3] = [0.229, 0.224, 0.225];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BgRemoveResult {
    pub input_path: String,
    pub data_url: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BgRemoveOptions {
    pub cleanup_mode: Option<String>,
    pub alpha_threshold: Option<u8>,
    pub foreground_threshold: Option<u8>,
    pub decontaminate_edges: Option<bool>,
}

#[derive(Debug, Clone, Copy)]
struct ResolvedBgRemoveOptions {
    alpha_threshold: u8,
    foreground_threshold: u8,
    decontaminate_edges: bool,
}

struct PreparedImage {
    original: RgbaImage,
    tensor: Array4<f32>,
}

#[tauri::command]
pub async fn image_bg_remove_batch(
    input_paths: Vec<String>,
    model_dir: String,
    options: Option<BgRemoveOptions>,
) -> Result<Vec<BgRemoveResult>, String> {
    tauri::async_runtime::spawn_blocking(move || run_batch(input_paths, model_dir, options))
        .await
        .map_err(|e| format!("抠图任务执行失败: {}", e))?
}

fn run_batch(
    input_paths: Vec<String>,
    model_dir: String,
    options: Option<BgRemoveOptions>,
) -> Result<Vec<BgRemoveResult>, String> {
    if input_paths.is_empty() {
        return Ok(Vec::new());
    }
    let options = resolve_options(options);

    let model_path = PathBuf::from(&model_dir)
        .join(MODEL_REPO_ID)
        .join(MODEL_FILE);
    if !model_path.is_file() {
        return Err(format!("模型文件不存在: {}", model_path.display()));
    }

    let thread_count = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8);

    let mut session = Session::builder()
        .map_err(|e| format!("创建 ONNX 会话失败: {}", e))?
        .with_optimization_level(GraphOptimizationLevel::Level1)
        .map_err(|e| format!("设置 ONNX 优化级别失败: {}", e))?
        .with_intra_threads(thread_count)
        .map_err(|e| format!("设置 ONNX 线程数失败: {}", e))?
        .commit_from_file(&model_path)
        .map_err(|e| format!("加载模型失败: {}", e))?;

    let mut results = Vec::with_capacity(input_paths.len());
    for input_path in input_paths {
        let result = match process_one(&mut session, &input_path, options) {
            Ok(data_url) => BgRemoveResult {
                input_path,
                data_url: Some(data_url),
                error: None,
            },
            Err(error) => BgRemoveResult {
                input_path,
                data_url: None,
                error: Some(error),
            },
        };
        results.push(result);
    }

    Ok(results)
}

fn process_one(
    session: &mut Session,
    input_path: &str,
    options: ResolvedBgRemoveOptions,
) -> Result<String, String> {
    let prepared = prepare_input(Path::new(input_path))?;
    let outputs = session
        .run(ort::inputs![TensorRef::from_array_view(
            prepared.tensor.view()
        )
        .map_err(|e| format!("创建输入张量失败: {}", e))?])
        .map_err(|e| format!("模型推理失败: {}", e))?;

    if outputs.len() == 0 {
        return Err("模型没有返回任何输出".to_string());
    }

    let output = &outputs[0];
    let output = output
        .try_extract_array::<f32>()
        .map_err(|e| format!("读取模型输出失败: {}", e))?;

    let mask = tensor_to_mask(output)?;
    let mask = image::imageops::resize(
        &mask,
        prepared.original.width(),
        prepared.original.height(),
        FilterType::Triangle,
    );
    let mask = clean_mask(mask, options);
    let composited = apply_mask(prepared.original, mask, options);
    encode_png_data_url(&DynamicImage::ImageRgba8(composited))
}

fn resolve_options(options: Option<BgRemoveOptions>) -> ResolvedBgRemoveOptions {
    let options = options.unwrap_or(BgRemoveOptions {
        cleanup_mode: None,
        alpha_threshold: None,
        foreground_threshold: None,
        decontaminate_edges: None,
    });

    let (default_alpha, default_foreground, default_decontaminate) =
        match options.cleanup_mode.as_deref().unwrap_or("standard") {
            "soft" => (4, 252, false),
            "clean" => (28, 220, true),
            "logo" => (48, 185, true),
            _ => (12, 240, true),
        };

    let alpha_threshold = options.alpha_threshold.unwrap_or(default_alpha).min(240);
    let foreground_threshold = options
        .foreground_threshold
        .unwrap_or(default_foreground)
        .max(alpha_threshold.saturating_add(1));

    ResolvedBgRemoveOptions {
        alpha_threshold,
        foreground_threshold,
        decontaminate_edges: options.decontaminate_edges.unwrap_or(default_decontaminate),
    }
}

fn prepare_input(path: &Path) -> Result<PreparedImage, String> {
    let original = image::open(path)
        .map_err(|e| format!("读取图片失败: {}", e))?
        .to_rgba8();

    let resized = image::imageops::resize(
        &DynamicImage::ImageRgba8(original.clone()).to_rgb8(),
        INPUT_WIDTH,
        INPUT_HEIGHT,
        FilterType::Triangle,
    );

    let mut tensor = Array4::<f32>::zeros((1, 3, INPUT_HEIGHT as usize, INPUT_WIDTH as usize));
    for (x, y, pixel) in resized.enumerate_pixels() {
        let [r, g, b] = pixel.0;
        let values = [r, g, b];
        for channel in 0..3 {
            let normalized =
                (values[channel] as f32 / 255.0 - IMAGE_MEAN[channel]) / IMAGE_STD[channel];
            tensor[[0, channel, y as usize, x as usize]] = normalized;
        }
    }

    Ok(PreparedImage { original, tensor })
}

fn tensor_to_mask(array: ArrayViewD<'_, f32>) -> Result<GrayImage, String> {
    let dims = array.shape();
    let data = array
        .as_slice()
        .ok_or_else(|| "模型输出不是连续内存，无法读取".to_string())?;

    let (height, width) = match dims.len() {
        4 => (dims[2], dims[3]),
        3 => (dims[1], dims[2]),
        2 => (dims[0], dims[1]),
        _ => return Err(format!("不支持的输出维度: {:?}", dims)),
    };

    let (min_value, max_value) = data.iter().fold((f32::MAX, f32::MIN), |acc, value| {
        (acc.0.min(*value), acc.1.max(*value))
    });
    let output_is_probability = min_value >= -0.01 && max_value <= 1.01;

    let mut mask = GrayImage::new(width as u32, height as u32);
    for y in 0..height {
        for x in 0..width {
            let raw = data[y * width + x];
            let alpha = if output_is_probability {
                raw.clamp(0.0, 1.0)
            } else {
                1.0f32 / (1.0f32 + (-raw).exp())
            };
            let value = (alpha * 255.0f32).round().clamp(0.0, 255.0) as u8;
            mask.put_pixel(x as u32, y as u32, Luma([value]));
        }
    }

    Ok(mask)
}

fn clean_mask(mut mask: GrayImage, options: ResolvedBgRemoveOptions) -> GrayImage {
    let low = options.alpha_threshold;
    let high = options.foreground_threshold.max(low.saturating_add(1));
    for pixel in mask.pixels_mut() {
        let value = pixel.0[0];
        pixel.0[0] = if value <= low {
            0
        } else if value >= high {
            255
        } else {
            let normalized = (value.saturating_sub(low) as f32) / ((high - low) as f32);
            (normalized * 255.0).round().clamp(0.0, 255.0) as u8
        };
    }
    mask
}

fn apply_mask(
    mut image: RgbaImage,
    mask: GrayImage,
    options: ResolvedBgRemoveOptions,
) -> RgbaImage {
    let background = if options.decontaminate_edges {
        estimate_background_color(&image, &mask)
    } else {
        None
    };

    for (x, y, pixel) in image.enumerate_pixels_mut() {
        let alpha = mask.get_pixel(x, y).0[0];
        if let Some(bg) = background {
            if alpha > 0 && alpha < 250 {
                decontaminate_pixel(pixel, alpha, bg);
            }
        }
        pixel.0[3] = alpha;
    }
    image
}

fn estimate_background_color(image: &RgbaImage, mask: &GrayImage) -> Option<[f32; 3]> {
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return None;
    }

    let mut count = 0.0f32;
    let mut sum = [0.0f32; 3];
    let mut sum_sq = [0.0f32; 3];
    let step = ((width.max(height) / 160).max(1)) as usize;

    for x in (0..width).step_by(step) {
        collect_background_sample(image, mask, x, 0, &mut count, &mut sum, &mut sum_sq);
        collect_background_sample(
            image,
            mask,
            x,
            height - 1,
            &mut count,
            &mut sum,
            &mut sum_sq,
        );
    }
    for y in (0..height).step_by(step) {
        collect_background_sample(image, mask, 0, y, &mut count, &mut sum, &mut sum_sq);
        collect_background_sample(image, mask, width - 1, y, &mut count, &mut sum, &mut sum_sq);
    }

    if count < 8.0 {
        return None;
    }

    let mean = [sum[0] / count, sum[1] / count, sum[2] / count];
    let std = (0..3)
        .map(|idx| {
            (sum_sq[idx] / count - mean[idx] * mean[idx])
                .max(0.0)
                .sqrt()
        })
        .sum::<f32>()
        / 3.0;

    // Only decontaminate when the border background is reasonably uniform.
    if std > 32.0 {
        return None;
    }
    Some(mean)
}

fn collect_background_sample(
    image: &RgbaImage,
    mask: &GrayImage,
    x: u32,
    y: u32,
    count: &mut f32,
    sum: &mut [f32; 3],
    sum_sq: &mut [f32; 3],
) {
    if mask.get_pixel(x, y).0[0] > 12 {
        return;
    }
    let pixel = image.get_pixel(x, y).0;
    for channel in 0..3 {
        let value = pixel[channel] as f32;
        sum[channel] += value;
        sum_sq[channel] += value * value;
    }
    *count += 1.0;
}

fn decontaminate_pixel(pixel: &mut image::Rgba<u8>, alpha: u8, background: [f32; 3]) {
    let a = (alpha as f32 / 255.0).clamp(0.01, 1.0);
    for channel in 0..3 {
        let observed = pixel.0[channel] as f32;
        let foreground = (observed - background[channel] * (1.0 - a)) / a;
        pixel.0[channel] = foreground.round().clamp(0.0, 255.0) as u8;
    }
}

fn encode_png_data_url(image: &DynamicImage) -> Result<String, String> {
    let mut buffer = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut buffer), ImageFormat::Png)
        .map_err(|e| format!("输出 PNG 编码失败: {}", e))?;

    Ok(format!(
        "data:image/png;base64,{}",
        general_purpose::STANDARD.encode(buffer)
    ))
}
