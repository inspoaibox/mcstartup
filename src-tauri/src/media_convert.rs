use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const APP_NAME: &str = "McStartUP";
const FFMPEG_RUNTIME_ARCHIVE: &str = "ffmpeg-runtime.7z";
const FFMPEG_RUNTIME_CACHE_DIR: &str = "media-runtime/ffmpeg";

#[derive(Debug, Serialize, Deserialize)]
pub struct FfmpegStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ConvertProgress {
    pub file: String,
    pub percent: f32,
    pub status: String, // "processing" | "done" | "error"
    pub error: Option<String>,
    pub output_path: Option<String>,
    pub output_size: Option<u64>,
}

/// 查找 ffmpeg 可执行文件的绝对路径（含 Windows 常见安装位置 fallback）
pub fn find_ffmpeg_binary() -> Option<String> {
    // 1. 优先使用随应用放置的 FFmpeg 核心，避免依赖系统默认播放器或平台兜底。
    if let Some(path) = find_managed_ffmpeg_binary() {
        return Some(path);
    }

    // 2. 尝试 PATH 中的 ffmpeg（通过 where/which）
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("where");
        cmd.arg("ffmpeg");
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout);
                if let Some(p) = path.lines().next().map(|s| s.trim().to_string()) {
                    if !p.is_empty() {
                        return Some(p);
                    }
                }
            }
        }

        // 3. winget 安装路径（%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*\ffmpeg*\bin\ffmpeg.exe）
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let winget_base = std::path::Path::new(&local_app_data)
                .join("Microsoft")
                .join("WinGet")
                .join("Packages");
            if let Ok(entries) = std::fs::read_dir(&winget_base) {
                for entry in entries.flatten() {
                    let name = entry.file_name();
                    let name_str = name.to_string_lossy();
                    if name_str.starts_with("Gyan.FFmpeg") {
                        // 进入子目录找 bin/ffmpeg.exe
                        if let Ok(sub) = std::fs::read_dir(entry.path()) {
                            for sub_entry in sub.flatten() {
                                let candidate = sub_entry.path().join("bin").join("ffmpeg.exe");
                                if candidate.exists() {
                                    return Some(candidate.to_string_lossy().to_string());
                                }
                            }
                        }
                        // 有时直接在包目录下
                        let direct = entry.path().join("bin").join("ffmpeg.exe");
                        if direct.exists() {
                            return Some(direct.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }

        // 4. Scoop 安装路径（%USERPROFILE%\scoop\shims\ffmpeg.exe）
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            let scoop = std::path::Path::new(&user_profile)
                .join("scoop")
                .join("shims")
                .join("ffmpeg.exe");
            if scoop.exists() {
                return Some(scoop.to_string_lossy().to_string());
            }
        }

        // 5. Chocolatey（C:\ProgramData\chocolatey\bin\ffmpeg.exe）
        let choco = std::path::Path::new(r"C:\ProgramData\chocolatey\bin\ffmpeg.exe");
        if choco.exists() {
            return Some(choco.to_string_lossy().to_string());
        }

        // 6. 常见手动安装位置
        for candidate in &[
            r"C:\ffmpeg\bin\ffmpeg.exe",
            r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
            r"C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe",
        ] {
            if std::path::Path::new(candidate).exists() {
                return Some(candidate.to_string());
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("which");
        cmd.arg("ffmpeg");
        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout);
                if let Some(p) = path.lines().next().map(|s| s.trim().to_string()) {
                    if !p.is_empty() {
                        return Some(p);
                    }
                }
            }
        }
        // Homebrew 常见路径
        for candidate in &[
            "/usr/local/bin/ffmpeg",
            "/opt/homebrew/bin/ffmpeg",
            "/usr/bin/ffmpeg",
        ] {
            if std::path::Path::new(candidate).exists() {
                return Some(candidate.to_string());
            }
        }
    }

    None
}

/// 查找软件托管的 FFmpeg 核心。音乐播放器等严格模式只允许走这条路径。
pub fn find_managed_ffmpeg_binary() -> Option<String> {
    find_cached_ffmpeg_binary()
        .or_else(ensure_ffmpeg_runtime_from_archive)
        .or_else(find_bundled_ffmpeg_binary)
        .or_else(find_source_ffmpeg_binary)
}

pub fn check_managed_ffmpeg() -> FfmpegStatus {
    let ffmpeg_path = match find_managed_ffmpeg_binary() {
        Some(path) => path,
        None => {
            return FfmpegStatus {
                installed: false,
                version: None,
                path: None,
            }
        }
    };

    ffmpeg_status_from_path(ffmpeg_path)
}

fn find_bundled_ffmpeg_binary() -> Option<String> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let binary_name = if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    [
        exe_dir.join(binary_name),
        exe_dir.join("bin").join(binary_name),
        exe_dir.join("resources").join("ffmpeg").join(binary_name),
        exe_dir
            .join("resources")
            .join("ffmpeg")
            .join("bin")
            .join(binary_name),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .map(|path| path.to_string_lossy().to_string())
}

fn find_source_ffmpeg_binary() -> Option<String> {
    let cwd = std::env::current_dir().ok()?;
    let binary_name = ffmpeg_binary_name();
    [
        cwd.join("src-tauri")
            .join("resources")
            .join("ffmpeg")
            .join(binary_name),
        cwd.join("src-tauri")
            .join("resources")
            .join("ffmpeg")
            .join("bin")
            .join(binary_name),
        cwd.join("resources").join("ffmpeg").join(binary_name),
        cwd.join("resources")
            .join("ffmpeg")
            .join("bin")
            .join(binary_name),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .map(|path| path.to_string_lossy().to_string())
}

fn find_cached_ffmpeg_binary() -> Option<String> {
    let dir = cached_ffmpeg_dir()?;
    find_binary_under_dir(&dir, ffmpeg_binary_name()).map(|path| path.to_string_lossy().to_string())
}

fn ensure_ffmpeg_runtime_from_archive() -> Option<String> {
    let archive = find_ffmpeg_runtime_archive()?;
    let seven_zip = find_7zip_binary_for_runtime()?;
    let output_dir = cached_ffmpeg_dir()?;

    if let Some(path) = find_binary_under_dir(&output_dir, ffmpeg_binary_name()) {
        return Some(path.to_string_lossy().to_string());
    }
    if fs::create_dir_all(&output_dir).is_err() {
        return None;
    }

    let mut command = Command::new(seven_zip);
    command
        .arg("x")
        .arg("-y")
        .arg(format!("-o{}", output_dir.to_string_lossy()))
        .arg(&archive);
    apply_no_window(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }

    find_binary_under_dir(&output_dir, ffmpeg_binary_name())
        .map(|path| path.to_string_lossy().to_string())
}

fn cached_ffmpeg_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|base| base.join(APP_NAME).join(FFMPEG_RUNTIME_CACHE_DIR))
        .or_else(|| {
            Some(
                std::env::temp_dir()
                    .join(APP_NAME)
                    .join(FFMPEG_RUNTIME_CACHE_DIR),
            )
        })
}

fn find_ffmpeg_runtime_archive() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(
                dir.join("resources")
                    .join("ffmpeg")
                    .join(FFMPEG_RUNTIME_ARCHIVE),
            );
            candidates.push(dir.join("ffmpeg").join(FFMPEG_RUNTIME_ARCHIVE));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(
            cwd.join("src-tauri")
                .join("resources")
                .join("ffmpeg")
                .join(FFMPEG_RUNTIME_ARCHIVE),
        );
        candidates.push(
            cwd.join("resources")
                .join("ffmpeg")
                .join(FFMPEG_RUNTIME_ARCHIVE),
        );
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn find_7zip_binary_for_runtime() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("resources").join("7zip").join("7z.exe"));
            candidates.push(dir.join("7zip").join("7z.exe"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(
            cwd.join("src-tauri")
                .join("resources")
                .join("7zip")
                .join("7z.exe"),
        );
        candidates.push(cwd.join("resources").join("7zip").join("7z.exe"));
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn find_binary_under_dir(dir: &Path, binary_name: &str) -> Option<PathBuf> {
    if !dir.is_dir() {
        return None;
    }
    let direct = dir.join(binary_name);
    if direct.is_file() {
        return Some(direct);
    }

    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file()
                && path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(|name| name.eq_ignore_ascii_case(binary_name))
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

fn ffmpeg_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    }
}

/// 检测 FFmpeg 是否已安装
#[tauri::command]
pub fn check_ffmpeg() -> FfmpegStatus {
    let ffmpeg_path = match find_ffmpeg_binary() {
        Some(p) => p,
        None => {
            return FfmpegStatus {
                installed: false,
                version: None,
                path: None,
            }
        }
    };

    ffmpeg_status_from_path(ffmpeg_path)
}

fn ffmpeg_status_from_path(ffmpeg_path: String) -> FfmpegStatus {
    let mut cmd = Command::new(&ffmpeg_path);
    cmd.arg("-version");

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let version = stdout
                .lines()
                .next()
                .and_then(|l| l.split("version ").nth(1))
                .and_then(|v| v.split_whitespace().next())
                .map(|v| v.to_string());

            FfmpegStatus {
                installed: true,
                version,
                path: Some(ffmpeg_path),
            }
        }
        Err(_) => FfmpegStatus {
            installed: false,
            version: None,
            path: None,
        },
    }
}

/// 获取文件大小（字节），避免前端 readBinaryFile 把整个文件加载进内存
#[tauri::command]
pub fn get_file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}

/// 获取媒体文件信息（时长、分辨率、编码等）
#[tauri::command]
pub fn get_media_info(input_path: String) -> Result<serde_json::Value, String> {
    // 用 ffprobe（与 ffmpeg 同目录）
    let ffmpeg_bin = find_ffmpeg_binary().ok_or("未找到 FFmpeg，请先安装".to_string())?;
    let ffprobe_bin = ffprobe_from_ffmpeg(&ffmpeg_bin);

    let mut cmd = Command::new(&ffprobe_bin);
    cmd.args([
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        &input_path,
    ]);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .map_err(|e| format!("ffprobe 执行失败: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&json_str).map_err(|e| format!("解析媒体信息失败: {}", e))
}

/// 转换音视频文件
#[tauri::command]
pub async fn convert_media(
    app_handle: tauri::AppHandle,
    input_path: String,
    output_dir: Option<String>,
    output_format: String,
    options: ConvertOptions,
) -> Result<ConvertResult, String> {
    use tauri::Manager;

    let input = Path::new(&input_path);
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");

    // output_dir 为空时使用输入文件所在目录
    let dir = match output_dir {
        Some(ref d) if !d.is_empty() => d.clone(),
        _ => input
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or(".")
            .to_string(),
    };

    // 提取音频时，先检测源文件是否有音频流
    if options.no_video.unwrap_or(false) {
        let has_audio = check_has_stream(&input_path, "audio");
        if !has_audio {
            let error_text = "转换失败: 该文件没有音频流".to_string();
            let _ = app_handle.emit_all(
                "convert-progress",
                serde_json::json!({
                    "file": input_path,
                    "percent": 0.0,
                    "status": "error",
                    "error": error_text
                }),
            );
            return Err(error_text);
        }
    }

    // 提取视频时，先检测源文件是否有视频流
    if options.no_audio.unwrap_or(false) {
        let has_video = check_has_stream(&input_path, "video");
        if !has_video {
            let error_text = "转换失败: 该文件没有视频流".to_string();
            let _ = app_handle.emit_all(
                "convert-progress",
                serde_json::json!({
                    "file": input_path,
                    "percent": 0.0,
                    "status": "error",
                    "error": error_text
                }),
            );
            return Err(error_text);
        }
    }

    let output_path = {
        let mut p = std::path::PathBuf::from(&dir);
        // 如果输出格式和输入格式相同且在同一目录，加 _compressed 后缀避免覆盖源文件
        let input_ext = input
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        let out_stem = if input_ext == output_format.to_lowercase()
            && input.parent().and_then(|p| p.to_str()).unwrap_or("") == dir
        {
            format!("{}_compressed", stem)
        } else {
            stem.to_string()
        };
        p.push(format!("{}.{}", out_stem, output_format));
        p.to_string_lossy().to_string()
    };

    // Windows 不支持 pipe:1/pipe:2 作为 -progress 目标（mp4/mkv 等需要 seekable 输出）
    // 改用临时文件接收进度数据，且 -progress 必须作为全局选项放在 -i 之前
    let progress_file = std::env::temp_dir().join(format!(
        "ffmpeg_prog_{}.txt",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));

    // 构建 ffmpeg 命令：全局选项 → -i 输入 → 编码选项 → 输出
    let mut args: Vec<String> = vec![
        "-y".to_string(),
        "-progress".to_string(),
        progress_file.to_string_lossy().to_string(),
        "-nostats".to_string(),
        "-i".to_string(),
        input_path.clone(),
    ];

    // 根据格式和选项添加参数
    build_ffmpeg_args(&output_format, &options, &mut args);

    args.push(output_path.clone());

    let ffmpeg_bin = find_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    let mut cmd = tokio::process::Command::new(&ffmpeg_bin);
    cmd.args(&args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 FFmpeg 失败: {}", e))?;

    let duration_secs = get_duration_from_input(&input_path);
    let progress_file_clone = progress_file.clone();
    let input_path_clone = input_path.clone();
    let app_handle_clone = app_handle.clone();

    // 后台任务：每 300ms 轮询进度文件
    let progress_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
            if let Ok(content) = tokio::fs::read_to_string(&progress_file_clone).await {
                for line in content.lines() {
                    if line.starts_with("out_time_us=") {
                        if let Ok(us) = line.trim_start_matches("out_time_us=").parse::<f64>() {
                            if duration_secs > 0.0 && us > 0.0 {
                                let pct = ((us / 1_000_000.0) / duration_secs * 100.0)
                                    .min(99.0)
                                    .max(0.0);
                                let _ = app_handle_clone.emit_all(
                                    "convert-progress",
                                    serde_json::json!({
                                        "file": input_path_clone,
                                        "percent": pct,
                                        "status": "processing"
                                    }),
                                );
                            }
                        }
                    }
                }
            }
        }
    });

    // 收集 stderr 错误信息（FFmpeg 的诊断输出）
    let mut err_lines: Vec<String> = Vec::new();
    if let Some(stderr) = child.stderr.take() {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
            let trimmed = line.trim().to_string();
            if !trimmed.is_empty() {
                err_lines.push(trimmed);
            }
            line.clear();
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("等待 FFmpeg 完成失败: {}", e))?;

    progress_task.abort();
    let _ = std::fs::remove_file(&progress_file);

    if !status.success() {
        // 输出完整命令和错误，方便调试
        let cmd_str = format!("{} {}", ffmpeg_bin, args.join(" "));
        let error_detail = err_lines
            .iter()
            .filter(|l| {
                l.contains("Error")
                    || l.contains("Invalid")
                    || l.contains("error")
                    || l.contains("No such")
            })
            .cloned()
            .collect::<Vec<_>>()
            .join(" | ");
        let last_line = err_lines.last().map(|s| s.as_str()).unwrap_or("未知错误");
        let error_text = format!(
            "转换失败: {} [cmd: {}]",
            if error_detail.is_empty() {
                last_line.to_string()
            } else {
                error_detail
            },
            cmd_str
        );
        let _ = app_handle.emit_all(
            "convert-progress",
            serde_json::json!({
                "file": input_path,
                "percent": 0.0,
                "status": "error",
                "error": error_text
            }),
        );
        return Err(error_text);
    }

    // 获取输出文件大小
    let output_size = std::fs::metadata(&output_path)
        .map(|m| m.len())
        .unwrap_or(0);

    let _ = app_handle.emit_all(
        "convert-progress",
        serde_json::json!({
            "file": input_path,
            "percent": 100.0,
            "status": "done",
            "output_path": output_path,
            "output_size": output_size
        }),
    );

    Ok(ConvertResult {
        output_path,
        output_size,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConvertResult {
    pub output_path: String,
    pub output_size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConvertOptions {
    // 视频选项
    pub video_codec: Option<String>, // libx264, libx265, libvpx-vp9, copy
    pub video_bitrate: Option<String>, // 如 "2M", "5000k"
    pub video_crf: Option<u32>,      // 0-51，越小质量越高
    pub resolution: Option<String>,  // 如 "1920x1080", "1280x720"
    pub fps: Option<f32>,            // 帧率
    // 音频选项
    pub audio_codec: Option<String>,    // aac, mp3, libopus, copy
    pub audio_bitrate: Option<String>,  // 如 "192k", "320k"
    pub audio_sample_rate: Option<u32>, // 44100, 48000
    pub audio_channels: Option<u32>,    // 1=单声道, 2=立体声
    // 通用
    pub start_time: Option<String>, // 开始时间 "00:01:30"
    pub duration: Option<String>,   // 持续时长 "00:02:00"
    pub no_video: Option<bool>,     // 仅提取音频
    pub no_audio: Option<bool>,     // 仅保留视频
    pub preset: Option<String>,     // ultrafast/fast/medium/slow/veryslow
}

fn build_ffmpeg_args(format: &str, opts: &ConvertOptions, args: &mut Vec<String>) {
    // 开始时间（放在 -i 之前更高效，但这里放后面更安全）
    if let Some(ref t) = opts.start_time {
        args.push("-ss".to_string());
        args.push(t.clone());
    }
    if let Some(ref d) = opts.duration {
        args.push("-t".to_string());
        args.push(d.clone());
    }

    // 仅音频 / 仅视频
    if opts.no_video.unwrap_or(false) {
        args.push("-vn".to_string());
    }
    if opts.no_audio.unwrap_or(false) {
        args.push("-an".to_string());
    }

    // 视频编码
    match format {
        "mp4" | "mkv" | "mov" | "avi" => {
            let codec = opts.video_codec.as_deref().unwrap_or("libx264");
            args.push("-c:v".to_string());
            args.push(codec.to_string());

            if codec != "copy" {
                if let Some(crf) = opts.video_crf {
                    args.push("-crf".to_string());
                    args.push(crf.to_string());
                }
                if let Some(ref bitrate) = opts.video_bitrate {
                    args.push("-b:v".to_string());
                    args.push(bitrate.clone());
                }
                let preset = opts.preset.as_deref().unwrap_or("medium");
                if codec == "libx264" || codec == "libx265" {
                    args.push("-preset".to_string());
                    args.push(preset.to_string());
                }
                if let Some(ref res) = opts.resolution {
                    args.push("-vf".to_string());
                    args.push(format!("scale={}", res.replace('x', ":")));
                }
                if let Some(fps) = opts.fps {
                    args.push("-r".to_string());
                    args.push(fps.to_string());
                }
            }
        }
        "webm" => {
            args.push("-c:v".to_string());
            args.push("libvpx-vp9".to_string());
            if let Some(crf) = opts.video_crf {
                args.push("-crf".to_string());
                args.push(crf.to_string());
                args.push("-b:v".to_string());
                args.push("0".to_string());
            }
        }
        "gif" => {
            // GIF 特殊处理：生成调色板提升质量
            args.push("-vf".to_string());
            let fps = opts.fps.unwrap_or(15.0);
            let scale = opts.resolution.as_deref().unwrap_or("320:-1");
            args.push(format!(
                "fps={},scale={}:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
                fps,
                scale.replace('x', ":")
            ));
        }
        _ => {}
    }

    // 音频编码
    match format {
        "mp3" => {
            let codec = opts.audio_codec.as_deref().unwrap_or("libmp3lame");
            args.push("-c:a".to_string());
            args.push(codec.to_string());
            if codec != "copy" {
                let bitrate = opts.audio_bitrate.as_deref().unwrap_or("192k");
                args.push("-b:a".to_string());
                args.push(bitrate.to_string());
            }
        }
        "aac" => {
            let codec = opts.audio_codec.as_deref().unwrap_or("aac");
            args.push("-c:a".to_string());
            args.push(codec.to_string());
            if codec != "copy" {
                // 裸 AAC 流需要 -f adts 容器
                args.push("-f".to_string());
                args.push("adts".to_string());
                let bitrate = opts.audio_bitrate.as_deref().unwrap_or("192k");
                args.push("-b:a".to_string());
                args.push(bitrate.to_string());
            }
        }
        "m4a" => {
            let codec = opts.audio_codec.as_deref().unwrap_or("aac");
            args.push("-c:a".to_string());
            args.push(codec.to_string());
            if codec != "copy" {
                let bitrate = opts.audio_bitrate.as_deref().unwrap_or("192k");
                args.push("-b:a".to_string());
                args.push(bitrate.to_string());
            }
        }
        "flac" => {
            let codec = opts.audio_codec.as_deref().unwrap_or("flac");
            args.push("-c:a".to_string());
            args.push(codec.to_string());
        }
        "wav" => {
            let codec = opts.audio_codec.as_deref().unwrap_or("pcm_s16le");
            args.push("-c:a".to_string());
            args.push(codec.to_string());
        }
        "ogg" => {
            let codec = opts.audio_codec.as_deref().unwrap_or("libvorbis");
            args.push("-c:a".to_string());
            args.push(codec.to_string());
            if codec != "copy" {
                let bitrate = opts.audio_bitrate.as_deref().unwrap_or("192k");
                args.push("-b:a".to_string());
                args.push(bitrate.to_string());
            }
        }
        "opus" => {
            let codec = opts.audio_codec.as_deref().unwrap_or("libopus");
            args.push("-c:a".to_string());
            args.push(codec.to_string());
            if codec != "copy" {
                let bitrate = opts.audio_bitrate.as_deref().unwrap_or("128k");
                args.push("-b:a".to_string());
                args.push(bitrate.to_string());
            }
        }
        _ => {
            // 视频格式的音频流
            if !opts.no_audio.unwrap_or(false) {
                let codec = opts.audio_codec.as_deref().unwrap_or("aac");
                args.push("-c:a".to_string());
                args.push(codec.to_string());
                if codec != "copy" {
                    let bitrate = opts.audio_bitrate.as_deref().unwrap_or("192k");
                    args.push("-b:a".to_string());
                    args.push(bitrate.to_string());
                }
            }
        }
    }

    // 采样率和声道
    if let Some(sr) = opts.audio_sample_rate {
        args.push("-ar".to_string());
        args.push(sr.to_string());
    }
    if let Some(ch) = opts.audio_channels {
        args.push("-ac".to_string());
        args.push(ch.to_string());
    }
}

fn check_has_stream(input_path: &str, stream_type: &str) -> bool {
    let ffmpeg_bin = find_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    let ffprobe_bin = ffprobe_from_ffmpeg(&ffmpeg_bin);

    let mut cmd = Command::new(&ffprobe_bin);
    cmd.args([
        "-v",
        "error",
        "-select_streams",
        if stream_type == "audio" { "a:0" } else { "v:0" },
        "-show_entries",
        "stream=codec_type",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        input_path,
    ]);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    if let Ok(output) = cmd.output() {
        let s = String::from_utf8_lossy(&output.stdout);
        return s.trim() == stream_type;
    }
    false
}

fn get_duration_from_input(input_path: &str) -> f64 {
    let ffmpeg_bin = find_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    let ffprobe_bin = ffprobe_from_ffmpeg(&ffmpeg_bin);

    let mut cmd = Command::new(&ffprobe_bin);
    cmd.args([
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        input_path,
    ]);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    if let Ok(output) = cmd.output() {
        let s = String::from_utf8_lossy(&output.stdout);
        if let Ok(d) = s.trim().parse::<f64>() {
            return d;
        }
    }
    0.0
}

fn ffprobe_from_ffmpeg(ffmpeg_bin: &str) -> String {
    let binary_name = if cfg!(target_os = "windows") {
        "ffprobe.exe"
    } else {
        "ffprobe"
    };
    let path = Path::new(ffmpeg_bin);
    if let Some(parent) = path.parent() {
        let candidate = parent.join(binary_name);
        if candidate.is_file() {
            return candidate.to_string_lossy().to_string();
        }
    }
    binary_name.to_string()
}

/// 批量转换（逐个调用 convert_media）
#[tauri::command]
pub async fn batch_convert_media(
    app_handle: tauri::AppHandle,
    input_paths: Vec<String>,
    output_dir: Option<String>,
    output_format: String,
    options: ConvertOptions,
) -> Result<Vec<Result<ConvertResult, String>>, String> {
    let mut results = Vec::new();
    for path in input_paths {
        let result = convert_media(
            app_handle.clone(),
            path,
            output_dir.clone(),
            output_format.clone(),
            options.clone(),
        )
        .await;
        results.push(result);
    }
    Ok(results)
}

fn apply_no_window(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = command;
    }
}
