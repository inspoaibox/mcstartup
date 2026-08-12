use crate::media_convert::find_ffmpeg_binary;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static VIDEO_DOWNLOAD_TASKS: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
static VIDEO_DOWNLOAD_CANCELLED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtDlpStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub ffmpeg_installed: bool,
    pub ffmpeg_path: Option<String>,
    pub install_dir: String,
    pub download_url: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtDlpUpdateStatus {
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
    pub has_update: bool,
    pub update_commands: Vec<String>,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDownloadInfoRequest {
    pub url: String,
    pub playlist: Option<bool>,
    pub cookies_browser: Option<String>,
    pub cookies_file: Option<String>,
    pub cookies_text: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDownloadInfo {
    pub title: String,
    pub webpage_url: String,
    pub original_url: String,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub uploader: Option<String>,
    pub extractor: Option<String>,
    pub is_playlist: bool,
    pub entry_count: usize,
    pub formats: Vec<VideoDownloadFormat>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDownloadFormat {
    pub format_id: String,
    pub ext: String,
    pub resolution: String,
    pub format_note: String,
    pub filesize: Option<u64>,
    pub fps: Option<f64>,
    pub vcodec: String,
    pub acodec: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDownloadRequest {
    pub task_id: Option<String>,
    pub url: String,
    pub output_dir: Option<String>,
    pub mode: String,
    pub format_id: Option<String>,
    pub audio_format: Option<String>,
    pub subtitle_langs: Option<String>,
    pub cookies_browser: Option<String>,
    pub cookies_file: Option<String>,
    pub cookies_text: Option<String>,
    pub playlist: Option<bool>,
    pub merge_mp4: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDownloadResult {
    pub task_id: String,
    pub output_path: Option<String>,
    pub file_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoDownloadProgress {
    task_id: String,
    status: String,
    percent: Option<f32>,
    speed: Option<String>,
    eta: Option<String>,
    filename: Option<String>,
    output_path: Option<String>,
    message: Option<String>,
}

#[tauri::command(async)]
pub fn video_download_command(
    app_handle: AppHandle,
    action: String,
    payload: String,
) -> Result<String, String> {
    let payload: Value = if payload.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&payload).map_err(|e| format!("解析下载工具参数失败: {}", e))?
    };

    match action.as_str() {
        "check" => json_response(check_yt_dlp_impl()),
        "defaultDir" => json_response(video_download_default_dir_impl()?),
        "checkUpdate" => json_response(video_download_check_update_blocking()?),
        "probe" => {
            let payload = serde_json::from_value::<VideoDownloadInfoRequest>(payload)
                .map_err(|e| format!("解析下载信息请求失败: {}", e))?;
            json_response(video_download_probe_blocking(payload)?)
        }
        "start" => {
            let payload = serde_json::from_value::<VideoDownloadRequest>(payload)
                .map_err(|e| format!("解析下载请求失败: {}", e))?;
            json_response(video_download_start_background(app_handle, payload)?)
        }
        "cancel" => {
            let task_id = payload
                .get("taskId")
                .and_then(Value::as_str)
                .ok_or_else(|| "任务 ID 不能为空".to_string())?;
            video_download_cancel_impl(task_id.to_string())?;
            json_response(serde_json::json!({ "ok": true }))
        }
        _ => Err("未知下载工具动作".to_string()),
    }
}

fn json_response<T: Serialize>(value: T) -> Result<String, String> {
    serde_json::to_string(&value).map_err(|e| format!("序列化下载工具响应失败: {}", e))
}

#[inline(never)]
fn video_download_probe_blocking(
    request: VideoDownloadInfoRequest,
) -> Result<VideoDownloadInfo, String> {
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("初始化下载解析运行时失败: {}", e))?;
        runtime.block_on(video_download_probe_impl(request))
    })
    .join()
    .map_err(|_| "读取视频信息线程异常退出".to_string())?
}

#[inline(never)]
fn video_download_start_background(
    app_handle: AppHandle,
    mut request: VideoDownloadRequest,
) -> Result<VideoDownloadResult, String> {
    let task_id = request
        .task_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    request.task_id = Some(task_id.clone());

    let task_id_for_thread = task_id.clone();
    std::thread::spawn(move || {
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("初始化下载运行时失败: {}", e))
            .and_then(|runtime| {
                runtime.block_on(video_download_start_impl(app_handle.clone(), request))
            });

        if let Err(message) = result {
            if message != "下载已取消" {
                emit_progress(
                    &app_handle,
                    VideoDownloadProgress {
                        task_id: task_id_for_thread,
                        status: "error".to_string(),
                        percent: None,
                        speed: None,
                        eta: None,
                        filename: None,
                        output_path: None,
                        message: Some(message),
                    },
                );
            }
        }
    });

    Ok(VideoDownloadResult {
        task_id,
        output_path: None,
        file_size: None,
    })
}

pub fn check_yt_dlp_impl() -> YtDlpStatus {
    let ffmpeg_path = find_ffmpeg_binary();
    let install_dir = yt_dlp_runtime_dir();
    let Some(path) = find_yt_dlp_binary() else {
        return YtDlpStatus {
            installed: false,
            version: None,
            path: None,
            ffmpeg_installed: ffmpeg_path.is_some(),
            ffmpeg_path,
            install_dir: install_dir.to_string_lossy().to_string(),
            download_url: "https://github.com/yt-dlp/yt-dlp/releases/latest".to_string(),
            message:
                "未检测到 yt-dlp。可通过 winget、scoop、pip 安装，或把 yt-dlp.exe 放入运行时目录。"
                    .to_string(),
        };
    };

    let mut command = std::process::Command::new(&path);
    command.arg("--version");
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let version = command.output().ok().and_then(|output| {
        if !output.status.success() {
            return None;
        }
        String::from_utf8(output.stdout)
            .ok()
            .and_then(|text| text.lines().next().map(|line| line.trim().to_string()))
    });

    YtDlpStatus {
        installed: true,
        version,
        path: Some(path),
        ffmpeg_installed: ffmpeg_path.is_some(),
        ffmpeg_path,
        install_dir: install_dir.to_string_lossy().to_string(),
        download_url: "https://github.com/yt-dlp/yt-dlp/releases/latest".to_string(),
        message: "yt-dlp 已就绪。部分网站或音视频合并需要 FFmpeg。".to_string(),
    }
}

#[inline(never)]
fn video_download_check_update_blocking() -> Result<YtDlpUpdateStatus, String> {
    std::thread::spawn(move || {
        let status = check_yt_dlp_impl();
        let latest_version = fetch_latest_yt_dlp_version()?;
        let has_update = match (status.version.as_deref(), latest_version.as_deref()) {
            (Some(current), Some(latest)) => current.trim() != latest.trim(),
            (None, Some(_)) => true,
            _ => false,
        };
        let update_commands = yt_dlp_update_commands(&status);
        let message = if !status.installed {
            "未检测到 yt-dlp，请按命令安装。".to_string()
        } else if has_update {
            format!(
                "检测到 yt-dlp 新版本：当前 {}，最新 {}。请按命令自行更新。",
                status.version.as_deref().unwrap_or("未知"),
                latest_version.as_deref().unwrap_or("未知")
            )
        } else {
            format!(
                "yt-dlp 已是最新版本：{}",
                status.version.as_deref().unwrap_or("未知")
            )
        };
        Ok(YtDlpUpdateStatus {
            current_version: status.version,
            latest_version,
            has_update,
            update_commands,
            message,
        })
    })
    .join()
    .map_err(|_| "检测 yt-dlp 更新线程异常退出".to_string())?
}

fn fetch_latest_yt_dlp_version() -> Result<Option<String>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("McStartUP/yt-dlp-update-check")
        .build()
        .map_err(|e| format!("初始化 yt-dlp 更新检测失败: {}", e))?;
    let value = client
        .get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")
        .send()
        .map_err(|e| format!("请求 yt-dlp 最新版本失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("yt-dlp 最新版本响应失败: {}", e))?
        .json::<Value>()
        .map_err(|e| format!("解析 yt-dlp 最新版本失败: {}", e))?;
    Ok(value
        .get("tag_name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string))
}

fn yt_dlp_update_commands(status: &YtDlpStatus) -> Vec<String> {
    if !status.installed {
        return vec![
            "winget install yt-dlp.yt-dlp".to_string(),
            "scoop install yt-dlp".to_string(),
            format!("下载 yt-dlp.exe 后放入：{}", status.install_dir),
        ];
    }
    let mut commands = vec![
        "yt-dlp -U".to_string(),
        "winget upgrade yt-dlp.yt-dlp".to_string(),
        "scoop update yt-dlp".to_string(),
    ];
    if status
        .path
        .as_deref()
        .map(|path| path.starts_with(&status.install_dir))
        .unwrap_or(false)
    {
        commands.push(format!(
            "手动下载最新版 yt-dlp.exe 覆盖：{}",
            status.path.as_deref().unwrap_or(&status.install_dir)
        ));
    }
    commands
}

pub fn video_download_default_dir_impl() -> Result<String, String> {
    let dir = dirs::download_dir()
        .or_else(dirs::video_dir)
        .or_else(dirs::desktop_dir)
        .unwrap_or_else(std::env::temp_dir);
    Ok(dir.to_string_lossy().to_string())
}

pub async fn video_download_probe_impl(
    request: VideoDownloadInfoRequest,
) -> Result<VideoDownloadInfo, String> {
    let url = request.url.trim().to_string();
    if url.is_empty() {
        return Err("请输入视频链接".to_string());
    }
    let yt_dlp = find_yt_dlp_binary()
        .ok_or_else(|| "未找到 yt-dlp，请先安装或放入运行时目录。".to_string())?;

    let mut command = Command::new(&yt_dlp);
    command
        .arg("-J")
        .arg("--no-warnings")
        .arg(if request.playlist.unwrap_or(false) {
            "--yes-playlist"
        } else {
            "--no-playlist"
        });
    add_cookie_args(
        &mut command,
        request.cookies_browser.as_deref(),
        request.cookies_file.as_deref(),
        request.cookies_text.as_deref(),
    )?;
    add_youtube_args(&mut command, &url);
    command.arg(url.clone());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command.kill_on_drop(true);

    let output = tokio::time::timeout(std::time::Duration::from_secs(90), command.output())
        .await
        .map_err(|_| "读取视频信息超时，请检查链接或网络状态。".to_string())?
        .map_err(|e| format!("启动 yt-dlp 失败: {}", e))?;
    if !output.status.success() {
        return Err(command_error(
            "读取视频信息失败",
            &output.stderr,
            &output.stdout,
        ));
    }
    let value: Value =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("解析视频信息失败: {}", e))?;
    Ok(parse_video_info(&value, &url))
}

pub async fn video_download_start_impl(
    app_handle: AppHandle,
    request: VideoDownloadRequest,
) -> Result<VideoDownloadResult, String> {
    let url = request.url.trim().to_string();
    if url.is_empty() {
        return Err("请输入视频链接".to_string());
    }
    let yt_dlp = find_yt_dlp_binary()
        .ok_or_else(|| "未找到 yt-dlp，请先安装或放入运行时目录。".to_string())?;
    let task_id = request
        .task_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    mark_task_cancelled(&task_id, false);

    let output_dir = request
        .output_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::download_dir()
                .or_else(dirs::video_dir)
                .or_else(dirs::desktop_dir)
                .unwrap_or_else(std::env::temp_dir)
        });
    tokio::fs::create_dir_all(&output_dir)
        .await
        .map_err(|e| format!("创建保存目录失败: {}", e))?;

    let output_template = output_template_for_request(&request);
    let mut command = Command::new(&yt_dlp);
    command
        .arg("--newline")
        .arg("--no-color")
        .arg("--no-warnings")
        .arg("--no-overwrites")
        .arg("--progress-template")
        .arg("download:%(progress.status)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.filename)s")
        .arg("--print")
        .arg("after_move:mcstartup-output:%(filepath)s")
        .arg("-P")
        .arg(&output_dir)
        .arg("-o")
        .arg(output_template)
        .arg(if request.playlist.unwrap_or(false) {
            "--yes-playlist"
        } else {
            "--no-playlist"
        });

    #[cfg(target_os = "windows")]
    command.arg("--windows-filenames");

    add_cookie_args(
        &mut command,
        request.cookies_browser.as_deref(),
        request.cookies_file.as_deref(),
        request.cookies_text.as_deref(),
    )?;
    add_youtube_args(&mut command, &url);
    add_ffmpeg_args(&mut command);
    add_mode_args(&mut command, &request)?;
    command.arg(url);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command.kill_on_drop(true);

    emit_progress(
        &app_handle,
        VideoDownloadProgress {
            task_id: task_id.clone(),
            status: "processing".to_string(),
            percent: Some(0.0),
            speed: None,
            eta: None,
            filename: None,
            output_path: None,
            message: Some("开始下载".to_string()),
        },
    );

    let mut child = command
        .spawn()
        .map_err(|e| format!("启动 yt-dlp 失败: {}", e))?;
    if let Some(pid) = child.id() {
        active_tasks().lock().unwrap().insert(task_id.clone(), pid);
    }

    let output_path = Arc::new(Mutex::new(None::<String>));
    let stderr_lines = Arc::new(Mutex::new(Vec::<String>::new()));
    let mut readers = Vec::new();

    if let Some(stdout) = child.stdout.take() {
        readers.push(spawn_output_reader(
            app_handle.clone(),
            task_id.clone(),
            stdout,
            output_path.clone(),
            stderr_lines.clone(),
        ));
    }
    if let Some(stderr) = child.stderr.take() {
        readers.push(spawn_output_reader(
            app_handle.clone(),
            task_id.clone(),
            stderr,
            output_path.clone(),
            stderr_lines.clone(),
        ));
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("等待 yt-dlp 完成失败: {}", e))?;
    for reader in readers {
        let _ = reader.await;
    }
    active_tasks().lock().unwrap().remove(&task_id);

    let was_cancelled = take_task_cancelled(&task_id);
    let final_output = output_path.lock().unwrap().clone();
    if was_cancelled {
        emit_progress(
            &app_handle,
            VideoDownloadProgress {
                task_id: task_id.clone(),
                status: "cancelled".to_string(),
                percent: None,
                speed: None,
                eta: None,
                filename: None,
                output_path: final_output.clone(),
                message: Some("下载已取消".to_string()),
            },
        );
        return Err("下载已取消".to_string());
    }

    if !status.success() {
        let message = stderr_lines
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|line| !line.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| "yt-dlp 下载失败".to_string());
        emit_progress(
            &app_handle,
            VideoDownloadProgress {
                task_id: task_id.clone(),
                status: "error".to_string(),
                percent: None,
                speed: None,
                eta: None,
                filename: None,
                output_path: final_output.clone(),
                message: Some(message.clone()),
            },
        );
        return Err(message);
    }

    let file_size = final_output
        .as_deref()
        .and_then(|path| std::fs::metadata(path).ok())
        .map(|metadata| metadata.len());
    emit_progress(
        &app_handle,
        VideoDownloadProgress {
            task_id: task_id.clone(),
            status: "done".to_string(),
            percent: Some(100.0),
            speed: None,
            eta: None,
            filename: final_output
                .as_deref()
                .and_then(|path| Path::new(path).file_name())
                .and_then(|name| name.to_str())
                .map(str::to_string),
            output_path: final_output.clone(),
            message: Some("下载完成".to_string()),
        },
    );

    Ok(VideoDownloadResult {
        task_id,
        output_path: final_output,
        file_size,
    })
}

pub fn video_download_cancel_impl(task_id: String) -> Result<(), String> {
    let task_id = task_id.trim().to_string();
    if task_id.is_empty() {
        return Err("任务 ID 不能为空".to_string());
    }
    mark_task_cancelled(&task_id, true);
    let Some(pid) = active_tasks().lock().unwrap().get(&task_id).copied() else {
        return Ok(());
    };
    kill_process_tree(pid)
}

fn spawn_output_reader<R>(
    app_handle: AppHandle,
    task_id: String,
    reader: R,
    output_path: Arc<Mutex<Option<String>>>,
    stderr_lines: Arc<Mutex<Vec<String>>>,
) -> tokio::task::JoinHandle<()>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            let Ok(bytes) = reader.read_line(&mut line).await else {
                break;
            };
            if bytes == 0 {
                break;
            }
            let text = line.trim().to_string();
            if text.is_empty() {
                continue;
            }
            if let Some(path) = text.strip_prefix("mcstartup-output:") {
                let path = path.trim().to_string();
                if !path.is_empty() {
                    *output_path.lock().unwrap() = Some(path.clone());
                    emit_progress(
                        &app_handle,
                        VideoDownloadProgress {
                            task_id: task_id.clone(),
                            status: "processing".to_string(),
                            percent: Some(99.0),
                            speed: None,
                            eta: None,
                            filename: Path::new(&path)
                                .file_name()
                                .and_then(|name| name.to_str())
                                .map(str::to_string),
                            output_path: Some(path),
                            message: Some("正在收尾".to_string()),
                        },
                    );
                    continue;
                }
            }
            if let Some(progress) = parse_progress_line(&task_id, &text) {
                if let Some(path) = progress.output_path.clone() {
                    *output_path.lock().unwrap() = Some(path);
                }
                emit_progress(&app_handle, progress);
            } else if is_yt_dlp_warning_line(&text) {
                continue;
            } else {
                if let Some(path) = parse_destination_line(&text) {
                    *output_path.lock().unwrap() = Some(path);
                }
                stderr_lines.lock().unwrap().push(text);
            }
        }
    })
}

fn parse_progress_line(task_id: &str, line: &str) -> Option<VideoDownloadProgress> {
    let payload = line.strip_prefix("download:")?;
    let mut parts = payload.splitn(5, '|');
    let status = parts.next().unwrap_or_default().trim();
    let percent_text = parts.next().unwrap_or_default().trim();
    let speed = clean_progress_value(parts.next().unwrap_or_default());
    let eta = clean_progress_value(parts.next().unwrap_or_default());
    let filename = clean_progress_value(parts.next().unwrap_or_default());
    let percent = parse_percent(percent_text);
    Some(VideoDownloadProgress {
        task_id: task_id.to_string(),
        status: if status.eq_ignore_ascii_case("finished") {
            "processing".to_string()
        } else {
            "processing".to_string()
        },
        percent,
        speed,
        eta,
        output_path: filename.clone(),
        filename: filename
            .as_deref()
            .and_then(|value| Path::new(value).file_name())
            .and_then(|name| name.to_str())
            .map(str::to_string),
        message: None,
    })
}

fn is_yt_dlp_warning_line(line: &str) -> bool {
    line.trim_start().starts_with("WARNING:")
}

fn parse_percent(value: &str) -> Option<f32> {
    let cleaned = value.replace('%', "").replace(',', "").trim().to_string();
    if cleaned.is_empty() || cleaned.eq_ignore_ascii_case("na") {
        return None;
    }
    cleaned
        .parse::<f32>()
        .ok()
        .map(|value| value.clamp(0.0, 100.0))
}

fn clean_progress_value(value: &str) -> Option<String> {
    let value = value.trim().trim_matches('"').to_string();
    if value.is_empty() || value.eq_ignore_ascii_case("na") || value == "N/A" {
        None
    } else {
        Some(value)
    }
}

fn parse_destination_line(line: &str) -> Option<String> {
    if let Some((_, path)) = line.split_once("Destination:") {
        return Some(path.trim().trim_matches('"').to_string()).filter(|value| !value.is_empty());
    }
    if let Some(start) = line.find("Merging formats into \"") {
        let rest = &line[start + "Merging formats into \"".len()..];
        if let Some(end) = rest.find('"') {
            return Some(rest[..end].to_string());
        }
    }
    None
}

fn add_mode_args(command: &mut Command, request: &VideoDownloadRequest) -> Result<(), String> {
    match request.mode.as_str() {
        "audio" => {
            let audio_format = request.audio_format.as_deref().unwrap_or("mp3").trim();
            let audio_format = if audio_format.is_empty() {
                "mp3"
            } else {
                audio_format
            };
            if !matches!(audio_format, "mp3" | "m4a" | "opus" | "wav" | "flac") {
                return Err("音频格式无效".to_string());
            }
            command.arg("-x").arg("--audio-format").arg(audio_format);
        }
        "subtitles" => {
            let langs = request
                .subtitle_langs
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("zh.*,en.*");
            command
                .arg("--write-subs")
                .arg("--write-auto-subs")
                .arg("--sub-langs")
                .arg(langs)
                .arg("--skip-download");
        }
        "video" | "" => {
            if let Some(format_id) = request
                .format_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                command.arg("-f").arg(format_id);
            } else {
                command
                    .arg("-f")
                    .arg("bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best");
            }
            if request.merge_mp4.unwrap_or(true) {
                command.arg("--merge-output-format").arg("mp4");
            }
        }
        _ => return Err("下载模式无效".to_string()),
    }
    Ok(())
}

fn output_template_for_request(request: &VideoDownloadRequest) -> &'static str {
    match request.mode.as_str() {
        "audio" => "%(title).200B [%(id)s] [audio-%(format_id)s].%(ext)s",
        "subtitles" => "%(title).200B [%(id)s] [subtitles].%(ext)s",
        _ => "%(title).200B [%(id)s] [%(resolution)s %(format_id)s].%(ext)s",
    }
}

fn add_cookie_args(
    command: &mut Command,
    browser: Option<&str>,
    cookies_file: Option<&str>,
    cookies_text: Option<&str>,
) -> Result<(), String> {
    if let Some(cookie) = normalize_custom_cookie(cookies_text) {
        command
            .arg("--add-header")
            .arg(format!("Cookie: {}", cookie));
        return Ok(());
    }
    if let Some(file) = cookies_file
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let path = Path::new(file);
        if !path.exists() || !path.is_file() {
            return Err("Cookie 文件不存在，请重新选择 cookies.txt。".to_string());
        }
        command.arg("--cookies").arg(path);
        return Ok(());
    }
    let Some(browser) = normalize_cookie_browser(browser) else {
        return Ok(());
    };
    command.arg("--cookies-from-browser").arg(browser);
    Ok(())
}

fn normalize_custom_cookie(value: Option<&str>) -> Option<String> {
    let raw = value?.trim();
    if raw.is_empty() {
        return None;
    }
    for line in raw.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if line.len() >= 7 && line[..7].eq_ignore_ascii_case("cookie:") {
            return Some(line[7..].trim().to_string()).filter(|value| !value.is_empty());
        }
    }
    let cleaned = if raw.len() >= 7 && raw[..7].eq_ignore_ascii_case("cookie:") {
        raw[7..].trim()
    } else {
        raw
    };
    Some(
        cleaned
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("; "),
    )
    .filter(|value| !value.is_empty())
}

fn add_youtube_args(command: &mut Command, url: &str) {
    let lower = url.to_lowercase();
    if !(lower.contains("youtube.com") || lower.contains("youtu.be")) {
        return;
    }
    command
        .arg("--extractor-args")
        .arg("youtube:player_client=default,ios");
}

fn normalize_cookie_browser(browser: Option<&str>) -> Option<String> {
    let value = browser?.trim().to_lowercase();
    match value.as_str() {
        "" | "none" => None,
        "chrome" | "edge" | "firefox" | "brave" | "opera" | "vivaldi" => Some(value),
        _ => None,
    }
}

fn add_ffmpeg_args(command: &mut Command) {
    let Some(ffmpeg) = find_ffmpeg_binary() else {
        return;
    };
    let parent = Path::new(&ffmpeg)
        .parent()
        .unwrap_or_else(|| Path::new(&ffmpeg));
    command.arg("--ffmpeg-location").arg(parent);
}

fn parse_video_info(value: &Value, original_url: &str) -> VideoDownloadInfo {
    let entries = value
        .get("entries")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| !item.is_null())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let source = entries.first().copied().unwrap_or(value);
    let formats_source = source
        .get("formats")
        .and_then(Value::as_array)
        .or_else(|| value.get("formats").and_then(Value::as_array));
    let formats = formats_source
        .map(|items| {
            items
                .iter()
                .filter_map(parse_format)
                .take(250)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    VideoDownloadInfo {
        title: json_string(value, "title")
            .or_else(|| json_string(source, "title"))
            .unwrap_or_else(|| "未命名视频".to_string()),
        webpage_url: json_string(source, "webpage_url")
            .or_else(|| json_string(value, "webpage_url"))
            .unwrap_or_else(|| original_url.to_string()),
        original_url: original_url.to_string(),
        thumbnail: json_string(source, "thumbnail").or_else(|| json_string(value, "thumbnail")),
        duration: json_f64(source, "duration").or_else(|| json_f64(value, "duration")),
        uploader: json_string(source, "uploader").or_else(|| json_string(value, "uploader")),
        extractor: json_string(source, "extractor_key")
            .or_else(|| json_string(value, "extractor_key")),
        is_playlist: !entries.is_empty(),
        entry_count: entries.len(),
        formats,
    }
}

fn parse_format(value: &Value) -> Option<VideoDownloadFormat> {
    let format_id = json_string(value, "format_id")?;
    let ext = json_string(value, "ext").unwrap_or_else(|| "-".to_string());
    let resolution = json_string(value, "resolution")
        .or_else(|| {
            let width = json_u64(value, "width")?;
            let height = json_u64(value, "height")?;
            Some(format!("{}x{}", width, height))
        })
        .unwrap_or_else(|| "audio/video".to_string());
    Some(VideoDownloadFormat {
        format_id,
        ext,
        resolution,
        format_note: json_string(value, "format_note")
            .or_else(|| json_string(value, "format"))
            .unwrap_or_default(),
        filesize: json_u64(value, "filesize").or_else(|| json_u64(value, "filesize_approx")),
        fps: json_f64(value, "fps"),
        vcodec: json_string(value, "vcodec").unwrap_or_default(),
        acodec: json_string(value, "acodec").unwrap_or_default(),
    })
}

fn json_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn json_u64(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(|item| {
        item.as_u64()
            .or_else(|| item.as_f64().map(|value| value.max(0.0) as u64))
            .or_else(|| {
                item.as_str()
                    .and_then(|text| text.trim().parse::<u64>().ok())
            })
    })
}

fn json_f64(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(|item| {
        item.as_f64()
            .or_else(|| item.as_u64().map(|value| value as f64))
            .or_else(|| {
                item.as_str()
                    .and_then(|text| text.trim().parse::<f64>().ok())
            })
    })
}

fn find_yt_dlp_binary() -> Option<String> {
    let cached = yt_dlp_runtime_dir().join(yt_dlp_executable_name());
    if cached.exists() {
        return Some(cached.to_string_lossy().to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(path) = find_on_path("yt-dlp.exe").or_else(|| find_on_path("yt-dlp")) {
            return Some(path);
        }
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            let scoop = Path::new(&user_profile)
                .join("scoop")
                .join("shims")
                .join("yt-dlp.exe");
            if scoop.exists() {
                return Some(scoop.to_string_lossy().to_string());
            }
        }
        let choco = Path::new(r"C:\ProgramData\chocolatey\bin\yt-dlp.exe");
        if choco.exists() {
            return Some(choco.to_string_lossy().to_string());
        }
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let packages = Path::new(&local_app_data)
                .join("Microsoft")
                .join("WinGet")
                .join("Packages");
            if let Some(path) = find_file_limited(&packages, "yt-dlp.exe", 4) {
                return Some(path.to_string_lossy().to_string());
            }
        }
        for candidate in [
            r"C:\yt-dlp\yt-dlp.exe",
            r"C:\Program Files\yt-dlp\yt-dlp.exe",
            r"C:\Program Files (x86)\yt-dlp\yt-dlp.exe",
        ] {
            if Path::new(candidate).exists() {
                return Some(candidate.to_string());
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(path) = find_on_path("yt-dlp") {
            return Some(path);
        }
        for candidate in [
            "/usr/local/bin/yt-dlp",
            "/opt/homebrew/bin/yt-dlp",
            "/usr/bin/yt-dlp",
        ] {
            if Path::new(candidate).exists() {
                return Some(candidate.to_string());
            }
        }
    }

    None
}

fn find_on_path(name: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("where");
        command.arg(name);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    };
    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut command = std::process::Command::new("which");
        command.arg(name);
        command
    };

    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|path| !path.is_empty())
        .map(str::to_string)
}

fn find_file_limited(dir: &Path, filename: &str, depth: usize) -> Option<PathBuf> {
    if depth == 0 || !dir.exists() {
        return None;
    }
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.eq_ignore_ascii_case(filename))
            .unwrap_or(false)
        {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_file_limited(&path, filename, depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

fn yt_dlp_runtime_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("McStartUP")
        .join("runtimes")
        .join("yt-dlp")
}

fn yt_dlp_executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

fn active_tasks() -> &'static Mutex<HashMap<String, u32>> {
    VIDEO_DOWNLOAD_TASKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cancelled_tasks() -> &'static Mutex<HashSet<String>> {
    VIDEO_DOWNLOAD_CANCELLED.get_or_init(|| Mutex::new(HashSet::new()))
}

fn mark_task_cancelled(task_id: &str, cancelled: bool) {
    let mut guard = cancelled_tasks().lock().unwrap();
    if cancelled {
        guard.insert(task_id.to_string());
    } else {
        guard.remove(task_id);
    }
}

fn take_task_cancelled(task_id: &str) -> bool {
    cancelled_tasks().lock().unwrap().remove(task_id)
}

fn kill_process_tree(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut command = std::process::Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]);
        command.creation_flags(CREATE_NO_WINDOW);
        let output = command
            .output()
            .map_err(|e| format!("终止下载进程失败: {}", e))?;
        if output.status.success() {
            return Ok(());
        }
        return Err(command_error(
            "终止下载进程失败",
            &output.stderr,
            &output.stdout,
        ));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output()
            .map_err(|e| format!("终止下载进程失败: {}", e))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(command_error(
                "终止下载进程失败",
                &output.stderr,
                &output.stdout,
            ))
        }
    }
}

fn emit_progress(app_handle: &AppHandle, progress: VideoDownloadProgress) {
    let _ = app_handle.emit_all("video-download-progress", progress);
}

fn command_error(prefix: &str, stderr: &[u8], stdout: &[u8]) -> String {
    let stderr = decode_output(stderr);
    let stdout = decode_output(stdout);
    let detail = if !stderr.trim().is_empty() {
        stderr.trim().to_string()
    } else if !stdout.trim().is_empty() {
        stdout.trim().to_string()
    } else {
        "未知错误".to_string()
    };
    format!("{}: {}", prefix, normalize_download_error(&detail))
}

fn decode_output(bytes: &[u8]) -> String {
    match String::from_utf8(bytes.to_vec()) {
        Ok(value) => value,
        Err(_) => {
            let (cow, _, _) = encoding_rs::GBK.decode(bytes);
            cow.into_owned()
        }
    }
}

fn normalize_download_error(detail: &str) -> String {
    let lower = detail.to_lowercase();
    if lower.contains("could not copy chrome cookie database") {
        return format!(
            "{}\n\nChrome 的 Cookie 数据库当前无法复制。通常是 Chrome 正在运行、数据库被锁定，或浏览器安全策略阻止读取。请完全退出 Chrome 后重试；也可以改选 Edge，或在 Cookie 里选择“自定义 Cookie”后粘贴请求头 Cookie。",
            detail.trim()
        );
    }
    if lower.contains("sign in to confirm")
        || lower.contains("confirm you're not a bot")
        || lower.contains("cookies")
        || lower.contains("login")
    {
        return format!(
            "{}\n\nYouTube 触发了登录/真人校验。请先在浏览器登录 YouTube，然后在工具里把 Cookie 选择为 Chrome 或 Edge 再下载。这不是版本更新问题，除非“检测更新”提示有新版本。",
            detail.trim()
        );
    }
    if lower.contains("requested format is not available")
        || lower.contains("format is not available")
    {
        return format!(
            "{}\n\n当前选择的格式不可用。请先点“解析信息”选择一个可用格式，或点击“使用推荐格式”后再下载。",
            detail.trim()
        );
    }
    if lower.contains("unable to extract") || lower.contains("signature") || lower.contains("nsig")
    {
        return format!(
            "{}\n\nYouTube 页面结构可能变化，通常需要更新 yt-dlp。请点击“检测更新”，如果有新版本再按提示命令自行更新。",
            detail.trim()
        );
    }
    detail.trim().to_string()
}
