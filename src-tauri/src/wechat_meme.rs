use base64::{engine::general_purpose, Engine as _};
use clipboard_win::options::DoClear;
use clipboard_win::raw;
use image::codecs::gif::{GifDecoder, GifEncoder, Repeat};
use image::AnimationDecoder;
use image::ImageDecoder;
use image::{imageops::FilterType, GenericImageView, ImageFormat};
use serde::Serialize;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatMemeResult {
    pub output_path: String,
    pub output_format: String,
    pub width: u32,
    pub height: u32,
    pub output_size: u64,
    pub copied_to_clipboard: bool,
    pub note: Option<String>,
}

fn app_data_dir() -> Result<PathBuf, String> {
    let app_data = std::env::var("APPDATA").map_err(|e| format!("读取 APPDATA 失败: {}", e))?;
    Ok(PathBuf::from(app_data).join("McStartUP"))
}

fn meme_temp_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("wechat-meme-temp");
    fs::create_dir_all(&dir).map_err(|e| format!("创建临时目录失败: {}", e))?;
    Ok(dir)
}

fn unique_temp_path(ext: &str) -> Result<PathBuf, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("生成时间戳失败: {}", e))?
        .as_millis();
    Ok(meme_temp_dir()?.join(format!("meme-{}.{}", now, ext)))
}

fn write_files_to_clipboard(paths: &[String]) -> Result<(), String> {
    let _clip =
        clipboard_win::Clipboard::new_attempts(10).map_err(|e| format!("打开剪贴板失败: {}", e))?;
    raw::set_file_list_with(paths, DoClear).map_err(|e| format!("写入文件剪贴板失败: {}", e))
}

fn decode_data_url(data: &str) -> Result<Vec<u8>, String> {
    let raw = if let Some(pos) = data.find(',') {
        &data[pos + 1..]
    } else {
        data
    };
    general_purpose::STANDARD
        .decode(raw)
        .map_err(|e| format!("base64 解码失败: {}", e))
}

fn output_max_bounds(size_mode: &str, width: u32, height: u32) -> (u32, u32) {
    match size_mode {
        "40" => (40, 40),
        "80" => (80, 80),
        "120" => (120, 120),
        "200" => (200, 200),
        _ => (width.min(1024), height.min(1024)),
    }
}

fn resize_dimensions_to_fit(
    width: u32,
    height: u32,
    max_width: u32,
    max_height: u32,
) -> (u32, u32) {
    if max_width == 0 || max_height == 0 {
        return (width, height);
    }

    if width == 0 || height == 0 {
        return (width, height);
    }

    if width <= max_width && height <= max_height {
        return (width, height);
    }

    let scale_x = max_width as f64 / width as f64;
    let scale_y = max_height as f64 / height as f64;
    let scale = scale_x.min(scale_y);
    let new_width = ((width as f64 * scale).round() as u32).max(1);
    let new_height = ((height as f64 * scale).round() as u32).max(1);
    (new_width, new_height)
}

fn resize_gif_preserve_animation(
    source_bytes: &[u8],
    output_path: &Path,
    max_width: u32,
    max_height: u32,
) -> Result<bool, String> {
    let decoder =
        GifDecoder::new(Cursor::new(source_bytes)).map_err(|e| format!("解析 GIF 失败: {}", e))?;
    let frames = decoder
        .into_frames()
        .collect_frames()
        .map_err(|e| format!("读取 GIF 帧失败: {}", e))?;

    if frames.is_empty() {
        return Err("GIF 中没有可用帧".to_string());
    }

    let first = &frames[0];
    let (width, height) = first.buffer().dimensions();
    let (new_width, new_height) = resize_dimensions_to_fit(width, height, max_width, max_height);

    if new_width == width && new_height == height {
        fs::write(output_path, source_bytes).map_err(|e| format!("写入 GIF 失败: {}", e))?;
        return Ok(false);
    }

    let file = fs::File::create(output_path).map_err(|e| format!("创建 GIF 失败: {}", e))?;
    let mut encoder = GifEncoder::new(file);
    encoder
        .set_repeat(Repeat::Infinite)
        .map_err(|e| format!("设置 GIF 循环失败: {}", e))?;

    let resized_frames = frames.into_iter().map(|frame| {
        let delay = frame.delay();
        let resized = image::DynamicImage::ImageRgba8(frame.into_buffer())
            .resize(new_width, new_height, FilterType::Triangle)
            .into_rgba8();
        image::Frame::from_parts(resized, 0, 0, delay)
    });

    encoder
        .encode_frames(resized_frames)
        .map_err(|e| format!("编码 GIF 失败: {}", e))?;

    Ok(true)
}

fn gif_dimensions(source_bytes: &[u8]) -> Result<(u32, u32), String> {
    let decoder =
        GifDecoder::new(Cursor::new(source_bytes)).map_err(|e| format!("解析 GIF 失败: {}", e))?;
    Ok(decoder.dimensions())
}

fn is_gif_file(path: &Path, bytes: &[u8]) -> bool {
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("gif"))
        .unwrap_or(false)
    {
        return true;
    }
    bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")
}

fn is_gif_bytes(bytes: &[u8]) -> bool {
    bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")
}

#[tauri::command]
pub fn convert_to_wechat_meme(
    input_path: Option<String>,
    data_url: Option<String>,
    size_mode: String,
) -> Result<WechatMemeResult, String> {
    let (source_bytes, source_name, source_path) = if let Some(path) = input_path {
        let bytes = fs::read(&path).map_err(|e| format!("读取图片失败: {}", e))?;
        let name = Path::new(&path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image")
            .to_string();
        (bytes, name, Some(PathBuf::from(path)))
    } else if let Some(data) = data_url {
        (decode_data_url(&data)?, "clipboard-image".to_string(), None)
    } else {
        return Err("请先选择或粘贴图片".to_string());
    };

    let mut note = None;
    let output_format = "gif".to_string();

    let source_is_gif = if let Some(source_path) = source_path.as_ref() {
        is_gif_file(source_path, &source_bytes)
    } else {
        is_gif_bytes(&source_bytes)
    };

    let output_path = unique_temp_path("gif")?;

    if source_is_gif {
        if size_mode == "raw" {
            fs::write(&output_path, &source_bytes).map_err(|e| format!("写入 GIF 失败: {}", e))?;
        } else {
            let dimensions = gif_dimensions(&source_bytes)?;
            let (max_width, max_height) = output_max_bounds(&size_mode, dimensions.0, dimensions.1);
            let resized =
                resize_gif_preserve_animation(&source_bytes, &output_path, max_width, max_height)?;
            note = Some(if resized {
                "检测到原图是 GIF 动图。已按 200×200 范围缩放，并尽量保留动画效果。".to_string()
            } else {
                "检测到原图是 GIF 动图。原图宽高本来就都不超过 200，因此保留原尺寸并继续保留动画。"
                    .to_string()
            });
        }
    } else {
        let mut image =
            image::load_from_memory(&source_bytes).map_err(|e| format!("解析图片失败: {}", e))?;
        let (width, height) = image.dimensions();
        let (max_width, max_height) = output_max_bounds(&size_mode, width, height);
        let (new_width, new_height) =
            resize_dimensions_to_fit(width, height, max_width, max_height);
        let resized = new_width != width || new_height != height;

        if resized {
            image = image.resize(new_width, new_height, FilterType::Triangle);
        }

        image
            .save_with_format(&output_path, ImageFormat::Gif)
            .map_err(|e| format!("生成 GIF 失败: {}", e))?;

        note = Some(if resized {
            "已转成 GIF，并按 200×200 范围缩放。".to_string()
        } else {
            "已转成 GIF。原图宽高本来就都不超过 200，因此未再缩放。".to_string()
        });
    }

    let file_path = output_path.to_string_lossy().to_string();
    write_files_to_clipboard(&[file_path.clone()])?;

    let (width, height) =
        image::image_dimensions(&output_path).map_err(|e| format!("读取输出尺寸失败: {}", e))?;
    let output_size = fs::metadata(&output_path)
        .map_err(|e| format!("读取输出文件信息失败: {}", e))?
        .len();

    if note.is_none() && size_mode == "raw" {
        note = Some(format!(
            "已将 {} 处理为 {} 文件并写入剪贴板，去微信里直接 Ctrl+V 即可。",
            source_name,
            output_format.to_uppercase()
        ));
    }

    Ok(WechatMemeResult {
        output_path: file_path,
        output_format,
        width,
        height,
        output_size,
        copied_to_clipboard: true,
        note,
    })
}

#[tauri::command]
pub fn copy_wechat_meme_to_clipboard(file_path: String) -> Result<(), String> {
    if !Path::new(&file_path).exists() {
        return Err("转换结果文件不存在，请重新生成".to_string());
    }
    write_files_to_clipboard(&[file_path])
}

#[tauri::command]
pub fn export_wechat_meme(temp_path: String, output_path: String) -> Result<String, String> {
    if !Path::new(&temp_path).exists() {
        return Err("临时文件不存在，请重新生成".to_string());
    }

    if let Some(parent) = Path::new(&output_path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {}", e))?;
    }

    fs::copy(&temp_path, &output_path).map_err(|e| format!("保存文件失败: {}", e))?;
    Ok(output_path)
}
