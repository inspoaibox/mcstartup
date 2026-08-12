use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;
use tokio::io::AsyncWriteExt;

const RUNTIME_ROOT: &str = "real-esrgan";
const RUNTIME_DIR_NAME: &str = "ncnn-vulkan-20220424";
const RELEASE_TAG: &str = "v0.2.5.0";
const GITHUB_RELEASE_BASE: &str = "https://github.com/xinntao/Real-ESRGAN/releases/download";
const DEFAULT_MODEL_FILES: &[&str] = &[
    "realesrgan-x4plus.param",
    "realesrgan-x4plus.bin",
    "realesrgan-x4plus-anime.param",
    "realesrgan-x4plus-anime.bin",
    "realesr-animevideov3-x2.param",
    "realesr-animevideov3-x2.bin",
    "realesr-animevideov3-x3.param",
    "realesr-animevideov3-x3.bin",
    "realesr-animevideov3-x4.param",
    "realesr-animevideov3-x4.bin",
];
const OFFICIAL_MODELS: &[&str] = &[
    "realesrgan-x4plus",
    "realesrgan-x4plus-anime",
    "realesr-animevideov3",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealEsrganRuntimeStatus {
    pub installed: bool,
    pub runtime_dir: String,
    pub executable_path: Option<String>,
    pub models_path: Option<String>,
    pub missing_files: Vec<String>,
    pub platform: String,
    pub version: String,
    pub archive_name: String,
    pub download_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAiUpscaleOptions {
    pub scale: u32,
    pub model_name: String,
    pub output_format: String,
    pub tile_size: u32,
    #[serde(default)]
    pub tta: bool,
    #[serde(default)]
    pub custom_model_dir: Option<String>,
    #[serde(default)]
    pub custom_model_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAiUpscaleResult {
    pub input_path: String,
    pub output_path: String,
    pub input_width: u32,
    pub input_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub input_size: u64,
    pub output_size: u64,
}

#[tauri::command]
pub fn check_realesrgan_runtime(model_dir: String) -> Result<RealEsrganRuntimeStatus, String> {
    get_runtime_status(&model_dir)
}

#[tauri::command]
pub async fn download_realesrgan_runtime(
    app_handle: tauri::AppHandle,
    model_dir: String,
    overwrite: Option<bool>,
) -> Result<RealEsrganRuntimeStatus, String> {
    let overwrite = overwrite.unwrap_or(false);
    let current = get_runtime_status(&model_dir)?;
    if current.installed && !overwrite {
        return Ok(current);
    }

    let runtime_dir = runtime_dir(&model_dir);
    tokio::fs::create_dir_all(&runtime_dir)
        .await
        .map_err(|e| format!("创建 Real-ESRGAN 运行时目录失败: {}", e))?;

    let archive_name = runtime_archive_name();
    let archive_path = runtime_dir.join(archive_name);
    let tmp_path = runtime_dir.join(format!("{}.download", archive_name));

    if tokio::fs::try_exists(&tmp_path)
        .await
        .map_err(|e| e.to_string())?
    {
        let _ = tokio::fs::remove_file(&tmp_path).await;
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .user_agent("McStartUP Real-ESRGAN runtime downloader")
        .build()
        .map_err(|e| e.to_string())?;
    let url = runtime_download_url();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载 Real-ESRGAN 运行时失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status().as_u16(), url));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut loaded = 0u64;
    let mut stream = resp.bytes_stream();
    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("创建运行时临时文件失败: {}", e))?;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入运行时文件失败: {}", e))?;
        loaded += chunk.len() as u64;
        emit_download_progress(&app_handle, archive_name, loaded, total, false);
    }
    file.flush()
        .await
        .map_err(|e| format!("保存运行时文件失败: {}", e))?;
    drop(file);

    if tokio::fs::try_exists(&archive_path)
        .await
        .map_err(|e| e.to_string())?
    {
        tokio::fs::remove_file(&archive_path)
            .await
            .map_err(|e| format!("覆盖旧运行时包失败: {}", e))?;
    }
    tokio::fs::rename(&tmp_path, &archive_path)
        .await
        .map_err(|e| format!("写入运行时包失败: {}", e))?;
    emit_download_progress(&app_handle, archive_name, loaded, total, true);

    emit_download_progress(&app_handle, "解压 Real-ESRGAN 运行时", 0, 1, false);
    let archive_for_extract = archive_path.clone();
    let extract_dir = runtime_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        extract_archive(&archive_for_extract, &extract_dir)
    })
    .await
    .map_err(|e| format!("解压任务执行失败: {}", e))??;
    emit_download_progress(&app_handle, "解压 Real-ESRGAN 运行时", 1, 1, true);

    get_runtime_status(&model_dir)
}

#[tauri::command]
pub async fn image_ai_upscale(
    input_path: String,
    model_dir: String,
    options: ImageAiUpscaleOptions,
) -> Result<ImageAiUpscaleResult, String> {
    tauri::async_runtime::spawn_blocking(move || upscale_impl(input_path, model_dir, options))
        .await
        .map_err(|e| format!("AI 图像放大任务执行失败: {}", e))?
}

#[tauri::command]
pub fn copy_ai_upscale_output(source_path: String, output_path: String) -> Result<(), String> {
    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err(format!("结果文件不存在: {}", source.display()));
    }
    let output = PathBuf::from(&output_path);
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {}", e))?;
    }
    fs::copy(&source, &output).map_err(|e| format!("保存结果失败: {}", e))?;
    Ok(())
}

fn get_runtime_status(model_dir: &str) -> Result<RealEsrganRuntimeStatus, String> {
    let runtime_dir = runtime_dir(model_dir);
    fs::create_dir_all(&runtime_dir).map_err(|e| format!("创建运行时目录失败: {}", e))?;

    let executable = find_file_named(&runtime_dir, runtime_executable_name());
    let models_dir = find_models_dir(&runtime_dir);
    let mut missing_files = Vec::new();

    if executable.is_none() {
        missing_files.push(runtime_executable_name().to_string());
    }

    match &models_dir {
        Some(models) => {
            for file in DEFAULT_MODEL_FILES {
                if !models.join(file).is_file() {
                    missing_files.push(format!("models/{}", file));
                }
            }
        }
        None => missing_files.push("models/".to_string()),
    }

    Ok(RealEsrganRuntimeStatus {
        installed: missing_files.is_empty(),
        runtime_dir: runtime_dir.to_string_lossy().to_string(),
        executable_path: executable.map(|path| path.to_string_lossy().to_string()),
        models_path: models_dir.map(|path| path.to_string_lossy().to_string()),
        missing_files,
        platform: runtime_platform().to_string(),
        version: RELEASE_TAG.to_string(),
        archive_name: runtime_archive_name().to_string(),
        download_url: runtime_download_url(),
    })
}

fn upscale_impl(
    input_path: String,
    model_dir: String,
    options: ImageAiUpscaleOptions,
) -> Result<ImageAiUpscaleResult, String> {
    let input = PathBuf::from(&input_path);
    if !input.is_file() {
        return Err(format!("输入图片不存在: {}", input.display()));
    }

    let status = get_runtime_status(&model_dir)?;
    if !status.installed {
        return Err(format!(
            "Real-ESRGAN 运行时未安装完整，缺少: {}",
            status.missing_files.join(", ")
        ));
    }
    let executable = status
        .executable_path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| "Real-ESRGAN 可执行文件不存在".to_string())?;
    let default_models = status
        .models_path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| "Real-ESRGAN 模型目录不存在".to_string())?;

    let scale = validate_scale(options.scale)?;
    let output_format = validate_output_format(&options.output_format)?;
    let tile_size = validate_tile_size(options.tile_size)?;
    let (model_name, model_path) = resolve_model(&options, &default_models)?;
    let (input_width, input_height) =
        image::image_dimensions(&input).map_err(|e| format!("读取图片尺寸失败: {}", e))?;
    let input_size = fs::metadata(&input)
        .map_err(|e| format!("读取输入图片大小失败: {}", e))?
        .len();

    let output_path = make_output_path(&input, scale, output_format)?;
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {}", e))?;
    }

    let mut command = Command::new(&executable);
    command
        .arg("-i")
        .arg(&input)
        .arg("-o")
        .arg(&output_path)
        .arg("-n")
        .arg(&model_name)
        .arg("-s")
        .arg(scale.to_string())
        .arg("-t")
        .arg(tile_size.to_string())
        .arg("-m")
        .arg(&model_path)
        .arg("-f")
        .arg(output_format);
    if options.tta {
        command.arg("-x");
    }
    if let Some(parent) = executable.parent() {
        command.current_dir(parent);
    }
    hide_console_window(&mut command);

    let output = command
        .output()
        .map_err(|e| format!("启动 Real-ESRGAN 失败: {}", e))?;
    if !output.status.success() {
        return Err(format_realesrgan_error(&output.stdout, &output.stderr));
    }
    if !output_path.is_file() {
        return Err("Real-ESRGAN 未生成输出图片".to_string());
    }

    let (output_width, output_height) = image::image_dimensions(&output_path)
        .map_err(|e| format!("读取输出图片尺寸失败: {}", e))?;
    let output_size = fs::metadata(&output_path)
        .map_err(|e| format!("读取输出图片大小失败: {}", e))?
        .len();

    Ok(ImageAiUpscaleResult {
        input_path,
        output_path: output_path.to_string_lossy().to_string(),
        input_width,
        input_height,
        output_width,
        output_height,
        input_size,
        output_size,
    })
}

fn resolve_model(
    options: &ImageAiUpscaleOptions,
    default_models: &Path,
) -> Result<(String, PathBuf), String> {
    let requested = options.model_name.trim();
    if requested == "custom" {
        let custom_dir = options
            .custom_model_dir
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "请选择自定义模型目录".to_string())?;
        let custom_name = options
            .custom_model_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "请输入自定义模型名称".to_string())?;
        let custom_path = PathBuf::from(custom_dir);
        if !custom_path.is_dir() {
            return Err(format!("自定义模型目录不存在: {}", custom_path.display()));
        }
        if !custom_path.join(format!("{}.param", custom_name)).is_file()
            || !custom_path.join(format!("{}.bin", custom_name)).is_file()
        {
            return Err(format!(
                "自定义模型需要同时包含 {}.param 和 {}.bin",
                custom_name, custom_name
            ));
        }
        return Ok((custom_name.to_string(), custom_path));
    }

    if !OFFICIAL_MODELS.contains(&requested) {
        return Err(format!("不支持的 Real-ESRGAN 模型: {}", requested));
    }
    Ok((requested.to_string(), default_models.to_path_buf()))
}

fn validate_scale(scale: u32) -> Result<u32, String> {
    match scale {
        2 | 3 | 4 => Ok(scale),
        _ => Err("放大倍数仅支持 2x / 3x / 4x".to_string()),
    }
}

fn validate_output_format(format: &str) -> Result<&'static str, String> {
    match format.trim().to_ascii_lowercase().as_str() {
        "png" => Ok("png"),
        "jpg" | "jpeg" => Ok("jpg"),
        "webp" => Ok("webp"),
        _ => Err("输出格式仅支持 PNG / JPG / WebP".to_string()),
    }
}

fn validate_tile_size(tile_size: u32) -> Result<u32, String> {
    if tile_size == 0 || tile_size >= 32 {
        Ok(tile_size)
    } else {
        Err("Tile 尺寸需要为自动或不小于 32".to_string())
    }
}

fn make_output_path(input: &Path, scale: u32, format: &str) -> Result<PathBuf, String> {
    let stem = input
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("image");
    let output_dir = std::env::temp_dir()
        .join("McStartUP")
        .join("real-esrgan-output");
    let filename = format!(
        "{}_upscaled_{}x_{}.{}",
        stem,
        scale,
        uuid::Uuid::new_v4().simple(),
        format
    );
    Ok(output_dir.join(filename))
}

fn extract_archive(archive_path: &Path, output_dir: &Path) -> Result<(), String> {
    let file = File::open(archive_path)
        .map_err(|e| format!("打开 Real-ESRGAN 运行时压缩包失败: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("读取运行时压缩包失败: {}", e))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("读取压缩包条目失败: {}", e))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| format!("压缩包包含不安全路径: {}", entry.name()))?
            .to_owned();
        let out_path = output_dir.join(enclosed);

        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| format!("创建目录失败: {}", e))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
        let mut outfile = File::create(&out_path).map_err(|e| format!("创建文件失败: {}", e))?;
        io::copy(&mut entry, &mut outfile).map_err(|e| format!("解压文件失败: {}", e))?;
        mark_executable_if_needed(&out_path)?;
    }

    Ok(())
}

fn find_models_dir(root: &Path) -> Option<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir).ok()?;
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                if path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.eq_ignore_ascii_case("models"))
                    .unwrap_or(false)
                    && DEFAULT_MODEL_FILES
                        .iter()
                        .any(|file| path.join(file).is_file())
                {
                    return Some(path);
                }
                stack.push(path);
            }
        }
    }
    None
}

fn find_file_named(root: &Path, filename: &str) -> Option<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir).ok()?;
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.eq_ignore_ascii_case(filename))
                    .unwrap_or(false)
            {
                return Some(path);
            }
            if path.is_dir() {
                stack.push(path);
            }
        }
    }
    None
}

fn format_realesrgan_error(stdout: &[u8], stderr: &[u8]) -> String {
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(stdout).trim().to_string();
    let detail = if !stderr.is_empty() { stderr } else { stdout };
    if detail.contains("vkCreateInstance")
        || detail.contains("No GPU device")
        || detail.to_ascii_lowercase().contains("vulkan")
    {
        return format!(
            "Real-ESRGAN 启动失败，可能是显卡或 Vulkan 驱动不可用。详情: {}",
            detail
        );
    }
    if detail.is_empty() {
        "Real-ESRGAN 处理失败，但没有返回详细错误".to_string()
    } else {
        format!("Real-ESRGAN 处理失败: {}", detail)
    }
}

fn emit_download_progress(
    app_handle: &tauri::AppHandle,
    file: &str,
    loaded: u64,
    total: u64,
    done: bool,
) {
    let _ = app_handle.emit_all(
        "model-download-progress",
        serde_json::json!({
            "file": file,
            "loaded": loaded,
            "total": total,
            "done": done
        }),
    );
}

fn runtime_dir(model_dir: &str) -> PathBuf {
    PathBuf::from(model_dir)
        .join(RUNTIME_ROOT)
        .join(RUNTIME_DIR_NAME)
}

fn runtime_download_url() -> String {
    format!(
        "{}/{}/{}",
        GITHUB_RELEASE_BASE,
        RELEASE_TAG,
        runtime_archive_name()
    )
}

fn runtime_archive_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "realesrgan-ncnn-vulkan-20220424-windows.zip"
    }
    #[cfg(target_os = "macos")]
    {
        "realesrgan-ncnn-vulkan-20220424-macos.zip"
    }
    #[cfg(target_os = "linux")]
    {
        "realesrgan-ncnn-vulkan-20220424-ubuntu.zip"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        "realesrgan-ncnn-vulkan-20220424-windows.zip"
    }
}

fn runtime_executable_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "realesrgan-ncnn-vulkan.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "realesrgan-ncnn-vulkan"
    }
}

fn runtime_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        "unsupported"
    }
}

#[cfg(target_os = "windows")]
fn hide_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn hide_console_window(_command: &mut Command) {}

#[cfg(unix)]
fn mark_executable_if_needed(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    if path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name == runtime_executable_name())
        .unwrap_or(false)
    {
        let mut permissions = fs::metadata(path)
            .map_err(|e| format!("读取可执行文件权限失败: {}", e))?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions)
            .map_err(|e| format!("设置可执行文件权限失败: {}", e))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn mark_executable_if_needed(_path: &Path) -> Result<(), String> {
    Ok(())
}
