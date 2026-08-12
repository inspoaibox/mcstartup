use crate::browser_cookies::{auto_chromium_cookie_for_hosts, browser_label};
use crate::media_convert::find_ffmpeg_binary;
use reqwest::blocking::{Client, Response};
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, ACCEPT, ACCEPT_RANGES, CONTENT_DISPOSITION, CONTENT_LENGTH,
    CONTENT_RANGE, COOKIE, RANGE, REFERER, USER_AGENT,
};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const PROCESS_LOG_LIMIT: usize = 16 * 1024;

static DOWNLOAD_TASKS: OnceLock<Mutex<HashMap<String, Arc<DownloadTaskControl>>>> = OnceLock::new();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadManagerPayload {
    task_id: Option<String>,
    url: Option<String>,
    output_dir: Option<String>,
    file_name: Option<String>,
    thread_count: Option<usize>,
    overwrite: Option<bool>,
    user_agent: Option<String>,
    referer: Option<String>,
    cookie: Option<String>,
    cookie_mode: Option<String>,
    cookie_browser: Option<String>,
    manual_cookie: Option<String>,
    download_type: Option<String>,
    headers: Option<Vec<DownloadHeaderInput>>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadHeaderInput {
    name: String,
    value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProbeInfo {
    url: String,
    final_url: String,
    file_name: String,
    content_type: Option<String>,
    total_size: Option<u64>,
    supports_ranges: bool,
    suggested_threads: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadStartResult {
    task_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadCookieProbeResult {
    browser: String,
    found: bool,
    count: usize,
    hosts: Vec<String>,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRuntimeStatus {
    ffmpeg_installed: bool,
    ffmpeg_path: Option<String>,
    aria2_installed: bool,
    aria2_path: Option<String>,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    task_id: String,
    status: String,
    downloaded: u64,
    total: Option<u64>,
    percent: Option<f32>,
    speed: Option<String>,
    eta: Option<String>,
    file_name: Option<String>,
    output_path: Option<String>,
    message: Option<String>,
}

struct DownloadTaskControl {
    cancel: AtomicBool,
    pause: AtomicBool,
    supports_pause: AtomicBool,
}

struct ProgressTracker {
    downloaded: Arc<AtomicU64>,
    total: Option<u64>,
    last_emit: Mutex<Instant>,
    started_at: Instant,
    task_id: String,
    file_name: String,
    output_path: PathBuf,
}

#[tauri::command]
pub fn download_manager_command(
    app_handle: AppHandle,
    action: String,
    payload: String,
) -> Result<String, String> {
    let payload: Value = if payload.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&payload).map_err(|e| format!("解析下载管理器参数失败: {}", e))?
    };

    match action.as_str() {
        "defaultDir" => json_response(default_download_dir()?),
        "runtime" => json_response(download_runtime_status()),
        "probe" => {
            let payload = serde_json::from_value::<DownloadManagerPayload>(payload)
                .map_err(|e| format!("解析链接检测参数失败: {}", e))?;
            json_response(download_probe(payload)?)
        }
        "probeCookie" => {
            let payload = serde_json::from_value::<DownloadManagerPayload>(payload)
                .map_err(|e| format!("解析 Cookie 检测参数失败: {}", e))?;
            json_response(download_cookie_probe(payload)?)
        }
        "start" => {
            let payload = serde_json::from_value::<DownloadManagerPayload>(payload)
                .map_err(|e| format!("解析下载任务参数失败: {}", e))?;
            json_response(start_download(app_handle, payload)?)
        }
        "pause" => {
            set_task_paused(&payload, true)?;
            json_response(serde_json::json!({ "ok": true }))
        }
        "resume" => {
            set_task_paused(&payload, false)?;
            json_response(serde_json::json!({ "ok": true }))
        }
        "cancel" => {
            set_task_cancelled(&payload)?;
            json_response(serde_json::json!({ "ok": true }))
        }
        _ => Err("未知下载管理器动作".to_string()),
    }
}

fn json_response<T: Serialize>(value: T) -> Result<String, String> {
    serde_json::to_string(&value).map_err(|e| format!("序列化下载管理器响应失败: {}", e))
}

fn default_download_dir() -> Result<String, String> {
    Ok(dirs::download_dir()
        .or_else(dirs::desktop_dir)
        .unwrap_or_else(std::env::temp_dir)
        .to_string_lossy()
        .to_string())
}

fn task_map() -> &'static Mutex<HashMap<String, Arc<DownloadTaskControl>>> {
    DOWNLOAD_TASKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn payload_task_id(payload: &Value) -> Result<String, String> {
    payload
        .get("taskId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "任务 ID 不能为空".to_string())
}

fn set_task_paused(payload: &Value, paused: bool) -> Result<(), String> {
    let task_id = payload_task_id(payload)?;
    let Some(control) = task_map()
        .lock()
        .map_err(|_| "下载任务状态已被占用".to_string())?
        .get(&task_id)
        .cloned()
    else {
        return Err("没有找到正在运行的下载任务".to_string());
    };
    if !control.supports_pause.load(Ordering::Relaxed) && paused {
        return Err("该协议任务暂不支持暂停，请使用取消。".to_string());
    }
    control.pause.store(paused, Ordering::Relaxed);
    Ok(())
}

fn set_task_cancelled(payload: &Value) -> Result<(), String> {
    let task_id = payload_task_id(payload)?;
    if let Some(control) = task_map()
        .lock()
        .map_err(|_| "下载任务状态已被占用".to_string())?
        .get(&task_id)
        .cloned()
    {
        control.cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("初始化下载客户端失败: {}", e))
}

fn download_runtime_status() -> DownloadRuntimeStatus {
    let ffmpeg_path = find_ffmpeg_binary();
    let aria2_path = find_aria2_binary();
    let mut notes = Vec::new();
    if ffmpeg_path.is_none() {
        notes.push("HLS / m3u8 需要 FFmpeg。");
    }
    if aria2_path.is_none() {
        notes.push("FTP、磁力/BT、Metalink 需要 aria2c。");
    }
    DownloadRuntimeStatus {
        ffmpeg_installed: ffmpeg_path.is_some(),
        ffmpeg_path,
        aria2_installed: aria2_path.is_some(),
        aria2_path,
        message: if notes.is_empty() {
            "协议运行时已就绪。".to_string()
        } else {
            notes.join(" ")
        },
    }
}

fn headers_from_payload(payload: &DownloadManagerPayload) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
    let ua = payload
        .user_agent
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("McStartUP Downloader/1.0");
    headers.insert(
        USER_AGENT,
        HeaderValue::from_str(ua).map_err(|e| format!("User-Agent 不合法: {}", e))?,
    );
    if let Some(value) = payload
        .referer
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        headers.insert(
            REFERER,
            HeaderValue::from_str(value).map_err(|e| format!("Referer 不合法: {}", e))?,
        );
    }
    if let Some(cookie) = download_cookie_from_payload(payload)? {
        headers.insert(
            COOKIE,
            HeaderValue::from_str(&cookie).map_err(|e| format!("Cookie 不合法: {}", e))?,
        );
    }
    if let Some(items) = payload.headers.as_ref() {
        for item in items {
            let name = item.name.trim();
            let value = item.value.trim();
            if name.is_empty() || value.is_empty() {
                continue;
            }
            let header_name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|e| format!("请求头名称不合法 {}: {}", name, e))?;
            let header_value = HeaderValue::from_str(value)
                .map_err(|e| format!("请求头值不合法 {}: {}", name, e))?;
            headers.insert(header_name, header_value);
        }
    }
    Ok(headers)
}

fn download_cookie_probe(
    payload: DownloadManagerPayload,
) -> Result<DownloadCookieProbeResult, String> {
    let browser = payload
        .cookie_browser
        .as_deref()
        .or(payload.cookie_mode.as_deref())
        .unwrap_or("chrome")
        .trim()
        .to_lowercase();
    let hosts = cookie_hosts_from_payload(&payload)?;
    if hosts.is_empty() {
        return Ok(DownloadCookieProbeResult {
            browser,
            found: false,
            count: 0,
            hosts,
            message: "当前链接不需要或无法匹配浏览器 Cookie。".to_string(),
        });
    }
    let cookie = auto_chromium_cookie_for_hosts(&browser, &hosts, "下载链接")?;
    let count = cookie
        .split(';')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .count();
    let message = if count > 0 {
        format!(
            "已从 {} 读取到 {} 个匹配当前链接域名的 Cookie。",
            browser_label(&browser),
            count
        )
    } else {
        "没有读取到匹配 Cookie。".to_string()
    };
    Ok(DownloadCookieProbeResult {
        browser,
        found: count > 0,
        count,
        hosts,
        message,
    })
}

fn download_cookie_from_payload(
    payload: &DownloadManagerPayload,
) -> Result<Option<String>, String> {
    let mode = payload
        .cookie_mode
        .as_deref()
        .unwrap_or_else(|| {
            if payload
                .cookie
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_some()
            {
                "manual"
            } else {
                "none"
            }
        })
        .trim()
        .to_lowercase();
    match mode.as_str() {
        "" | "none" => Ok(None),
        "manual" | "custom" => Ok(payload
            .manual_cookie
            .as_deref()
            .or(payload.cookie.as_deref())
            .and_then(normalize_manual_cookie)),
        "chrome" | "edge" | "brave" | "vivaldi" | "opera" => {
            let browser = payload
                .cookie_browser
                .as_deref()
                .unwrap_or(&mode)
                .trim()
                .to_lowercase();
            let hosts = cookie_hosts_from_payload(payload)?;
            if hosts.is_empty() {
                return Ok(None);
            }
            auto_chromium_cookie_for_hosts(&browser, &hosts, "下载链接").map(Some)
        }
        _ => Err("Cookie 读取方式无效".to_string()),
    }
}

fn normalize_manual_cookie(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(
        trimmed
            .strip_prefix("Cookie:")
            .unwrap_or(trimmed)
            .trim()
            .to_string(),
    )
}

fn cookie_hosts_from_payload(payload: &DownloadManagerPayload) -> Result<Vec<String>, String> {
    let url = payload
        .url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "请先填写下载链接，用于匹配浏览器 Cookie 域名。".to_string())?;
    if url.to_ascii_lowercase().starts_with("magnet:") {
        return Ok(Vec::new());
    }
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("下载链接格式无效: {}", e))?;
    let host = parsed
        .host_str()
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "下载链接没有有效域名，无法自动读取 Cookie。".to_string())?;
    let mut hosts = vec![host.clone()];
    let parts = host.split('.').collect::<Vec<_>>();
    if parts.len() > 2 {
        hosts.push(parts[parts.len() - 2..].join("."));
    }
    hosts.sort();
    hosts.dedup();
    Ok(hosts)
}

fn download_probe(payload: DownloadManagerPayload) -> Result<DownloadProbeInfo, String> {
    let url = payload
        .url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "请输入下载链接".to_string())?;
    let download_type = detect_download_type(url, payload.download_type.as_deref());
    if download_type != "http" {
        let file_name = payload
            .file_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(sanitize_file_name)
            .or_else(|| file_name_for_protocol(url, &download_type));
        return Ok(DownloadProbeInfo {
            url: url.to_string(),
            final_url: url.to_string(),
            file_name: file_name.unwrap_or_else(|| "download".to_string()),
            content_type: Some(protocol_content_type(&download_type).to_string()),
            total_size: None,
            supports_ranges: false,
            suggested_threads: if download_type == "hls" { 1 } else { 8 },
        });
    }
    validate_url(url)?;
    let client = client()?;
    let headers = headers_from_payload(&payload)?;
    let response = probe_response(&client, url, &headers)?;
    let final_url = response.url().to_string();
    let status = response.status();
    if !status.is_success() && status.as_u16() != 206 {
        return Err(format!("链接检测失败: HTTP {}", status));
    }
    let response_headers = response.headers().clone();
    let content_type = response_headers
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string);
    let total_size = content_length_from_headers(&response_headers);
    let supports_ranges = response_headers
        .get(ACCEPT_RANGES)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_ascii_lowercase().contains("bytes"))
        .unwrap_or(false)
        || response_headers
            .get(CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .is_some();
    let file_name = payload
        .file_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(sanitize_file_name)
        .or_else(|| file_name_from_headers(&response_headers))
        .or_else(|| file_name_from_url(&final_url))
        .unwrap_or_else(|| "download.bin".to_string());
    let suggested_threads = if supports_ranges && total_size.unwrap_or(0) >= 2 * 1024 * 1024 {
        8
    } else {
        1
    };

    Ok(DownloadProbeInfo {
        url: url.to_string(),
        final_url,
        file_name,
        content_type,
        total_size,
        supports_ranges,
        suggested_threads,
    })
}

fn probe_response(client: &Client, url: &str, headers: &HeaderMap) -> Result<Response, String> {
    match client.head(url).headers(headers.clone()).send() {
        Ok(response) if response.status().is_success() => Ok(response),
        _ => client
            .get(url)
            .headers(headers.clone())
            .header(RANGE, "bytes=0-0")
            .send()
            .map_err(|e| format!("链接检测请求失败: {}", e)),
    }
}

fn start_download(
    app_handle: AppHandle,
    payload: DownloadManagerPayload,
) -> Result<DownloadStartResult, String> {
    let task_id = payload
        .task_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let initial_download_type = payload
        .url
        .as_deref()
        .map(|url| detect_download_type(url, payload.download_type.as_deref()))
        .unwrap_or_else(|| "http".to_string());
    let control = Arc::new(DownloadTaskControl {
        cancel: AtomicBool::new(false),
        pause: AtomicBool::new(false),
        supports_pause: AtomicBool::new(initial_download_type == "http"),
    });
    task_map()
        .lock()
        .map_err(|_| "下载任务状态已被占用".to_string())?
        .insert(task_id.clone(), control.clone());

    let thread_task_id = task_id.clone();
    std::thread::spawn(move || {
        let result = download_worker(app_handle.clone(), thread_task_id.clone(), payload, control);
        task_map()
            .lock()
            .ok()
            .and_then(|mut map| map.remove(&thread_task_id));
        if let Err(message) = result {
            emit_progress(
                &app_handle,
                DownloadProgress {
                    task_id: thread_task_id,
                    status: if message == "下载已取消" {
                        "cancelled".to_string()
                    } else {
                        "error".to_string()
                    },
                    downloaded: 0,
                    total: None,
                    percent: None,
                    speed: None,
                    eta: None,
                    file_name: None,
                    output_path: None,
                    message: Some(message),
                },
            );
        }
    });

    Ok(DownloadStartResult { task_id })
}

fn download_worker(
    app_handle: AppHandle,
    task_id: String,
    payload: DownloadManagerPayload,
    control: Arc<DownloadTaskControl>,
) -> Result<(), String> {
    let url = payload
        .url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "请输入下载链接".to_string())?
        .to_string();
    let download_type = detect_download_type(&url, payload.download_type.as_deref());
    if download_type != "http" {
        control.supports_pause.store(false, Ordering::Relaxed);
    }
    let output_dir = payload
        .output_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or(default_download_dir()?.into());
    fs::create_dir_all(&output_dir).map_err(|e| format!("创建保存目录失败: {}", e))?;

    match download_type.as_str() {
        "hls" => {
            return hls_download_worker(app_handle, task_id, payload, control, url, output_dir);
        }
        "aria2" => {
            return aria2_download_worker(app_handle, task_id, payload, control, url, output_dir);
        }
        _ => validate_url(&url)?,
    }

    let client = client()?;
    let headers = headers_from_payload(&payload)?;
    let probe = download_probe(DownloadManagerPayload {
        url: Some(url.clone()),
        headers: payload.headers.clone(),
        user_agent: payload.user_agent.clone(),
        referer: payload.referer.clone(),
        cookie: payload.cookie.clone(),
        cookie_mode: payload.cookie_mode.clone(),
        cookie_browser: payload.cookie_browser.clone(),
        manual_cookie: payload.manual_cookie.clone(),
        download_type: payload.download_type.clone(),
        file_name: payload.file_name.clone(),
        ..DownloadManagerPayload {
            task_id: None,
            url: None,
            output_dir: None,
            file_name: None,
            thread_count: None,
            overwrite: None,
            user_agent: None,
            referer: None,
            cookie: None,
            cookie_mode: None,
            cookie_browser: None,
            manual_cookie: None,
            download_type: None,
            headers: None,
        }
    })?;
    let file_name = sanitize_file_name(
        payload
            .file_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&probe.file_name),
    );
    let target_path =
        resolve_target_path(&output_dir, &file_name, payload.overwrite.unwrap_or(false));
    let final_file_name = target_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&file_name)
        .to_string();
    let total = probe.total_size;
    let requested_threads = payload
        .thread_count
        .unwrap_or(probe.suggested_threads)
        .clamp(1, 16);
    let use_segments =
        probe.supports_ranges && total.unwrap_or(0) > 1024 * 1024 && requested_threads > 1;
    let downloaded = Arc::new(AtomicU64::new(0));
    let tracker = Arc::new(ProgressTracker {
        downloaded: downloaded.clone(),
        total,
        last_emit: Mutex::new(Instant::now() - Duration::from_secs(1)),
        started_at: Instant::now(),
        task_id: task_id.clone(),
        file_name: final_file_name.clone(),
        output_path: target_path.clone(),
    });

    emit_progress(
        &app_handle,
        tracker.snapshot("downloading", None, Some("开始下载".to_string())),
    );

    if use_segments {
        segmented_download(
            &app_handle,
            &client,
            headers,
            &url,
            &target_path,
            requested_threads,
            control,
            tracker,
        )?;
    } else {
        single_download(
            &app_handle,
            &client,
            headers,
            &url,
            &target_path,
            control,
            tracker,
        )?;
    }

    Ok(())
}

fn segmented_download(
    app_handle: &AppHandle,
    client: &Client,
    headers: HeaderMap,
    url: &str,
    target_path: &Path,
    thread_count: usize,
    control: Arc<DownloadTaskControl>,
    tracker: Arc<ProgressTracker>,
) -> Result<(), String> {
    let total = tracker
        .total
        .ok_or_else(|| "多线程下载需要文件大小信息".to_string())?;
    let part_dir = part_dir_for(target_path);
    fs::create_dir_all(&part_dir).map_err(|e| format!("创建分片目录失败: {}", e))?;
    let segment_count = thread_count.min(total.max(1) as usize);
    let chunk_size = (total + segment_count as u64 - 1) / segment_count as u64;
    let mut handles = Vec::new();

    for index in 0..segment_count {
        let start = index as u64 * chunk_size;
        if start >= total {
            continue;
        }
        let end = ((start + chunk_size).min(total)).saturating_sub(1);
        let part_path = part_dir.join(format!("part-{}", index));
        let existing = normalized_part_size(&part_path, end - start + 1)?;
        tracker.downloaded.fetch_add(existing, Ordering::Relaxed);
        let client = client.clone();
        let headers = headers.clone();
        let url = url.to_string();
        let control = control.clone();
        let tracker = tracker.clone();
        let app_handle = app_handle.clone();
        handles.push(std::thread::spawn(move || {
            download_segment(
                &app_handle,
                &client,
                headers,
                &url,
                &part_path,
                start + existing,
                end,
                control,
                tracker,
            )
        }));
    }

    for handle in handles {
        handle
            .join()
            .map_err(|_| "下载分片线程异常退出".to_string())??;
    }

    if control.cancel.load(Ordering::Relaxed) {
        return Err("下载已取消".to_string());
    }

    let mut output = File::create(target_path).map_err(|e| format!("创建输出文件失败: {}", e))?;
    for index in 0..segment_count {
        let part_path = part_dir.join(format!("part-{}", index));
        let mut part = File::open(&part_path).map_err(|e| format!("读取分片失败: {}", e))?;
        std::io::copy(&mut part, &mut output).map_err(|e| format!("合并分片失败: {}", e))?;
    }
    let _ = fs::remove_dir_all(&part_dir);
    emit_progress(
        app_handle,
        tracker.snapshot("done", Some(100.0), Some("下载完成".to_string())),
    );
    Ok(())
}

fn single_download(
    app_handle: &AppHandle,
    client: &Client,
    headers: HeaderMap,
    url: &str,
    target_path: &Path,
    control: Arc<DownloadTaskControl>,
    tracker: Arc<ProgressTracker>,
) -> Result<(), String> {
    let part_path = target_path.with_extension(format!(
        "{}part",
        target_path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| format!("{}.", value))
            .unwrap_or_default()
    ));
    let existing = fs::metadata(&part_path).map(|meta| meta.len()).unwrap_or(0);
    tracker.downloaded.store(existing, Ordering::Relaxed);
    let mut request = client.get(url).headers(headers);
    if existing > 0 {
        request = request.header(RANGE, format!("bytes={}-", existing));
    }
    let mut response = request
        .send()
        .map_err(|e| format!("下载请求失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("下载响应失败: {}", e))?;
    let append = !(existing > 0 && response.status() != StatusCode::PARTIAL_CONTENT);
    if existing > 0 && !append {
        tracker.downloaded.store(0, Ordering::Relaxed);
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(append)
        .write(!append)
        .truncate(!append)
        .open(&part_path)
        .map_err(|e| format!("创建临时文件失败: {}", e))?;
    copy_response(
        app_handle,
        &mut response,
        &mut file,
        control.clone(),
        tracker.clone(),
    )?;
    if control.cancel.load(Ordering::Relaxed) {
        return Err("下载已取消".to_string());
    }
    fs::rename(&part_path, target_path)
        .or_else(|_| {
            fs::copy(&part_path, target_path)
                .and_then(|_| fs::remove_file(&part_path))
                .map(|_| ())
        })
        .map_err(|e| format!("写入输出文件失败: {}", e))?;
    emit_progress(
        app_handle,
        tracker.snapshot("done", Some(100.0), Some("下载完成".to_string())),
    );
    Ok(())
}

fn hls_download_worker(
    app_handle: AppHandle,
    task_id: String,
    payload: DownloadManagerPayload,
    control: Arc<DownloadTaskControl>,
    url: String,
    output_dir: PathBuf,
) -> Result<(), String> {
    let ffmpeg = find_ffmpeg_binary()
        .ok_or_else(|| "未找到 FFmpeg，HLS / m3u8 下载需要先安装 FFmpeg。".to_string())?;
    let inferred_name =
        file_name_for_protocol(&url, "hls").unwrap_or_else(|| "hls-video.mp4".to_string());
    let file_name = sanitize_file_name(
        payload
            .file_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&inferred_name),
    );
    let target_path = resolve_target_path(
        &output_dir,
        &ensure_extension(&file_name, "mp4"),
        payload.overwrite.unwrap_or(false),
    );
    let final_file_name = target_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("hls-video.mp4")
        .to_string();
    let headers = ffmpeg_header_lines(&payload)?;
    let mut args = vec![
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-stats".to_string(),
    ];
    if !headers.is_empty() {
        args.push("-headers".to_string());
        args.push(headers);
    }
    args.extend([
        "-user_agent".to_string(),
        payload
            .user_agent
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("McStartUP Downloader/1.0")
            .to_string(),
        "-i".to_string(),
        url,
        "-c".to_string(),
        "copy".to_string(),
        "-bsf:a".to_string(),
        "aac_adtstoasc".to_string(),
        target_path.to_string_lossy().to_string(),
    ]);

    emit_progress(
        &app_handle,
        DownloadProgress {
            task_id: task_id.clone(),
            status: "downloading".to_string(),
            downloaded: 0,
            total: None,
            percent: None,
            speed: None,
            eta: None,
            file_name: Some(final_file_name.clone()),
            output_path: Some(target_path.to_string_lossy().to_string()),
            message: Some("HLS / m3u8 正在通过 FFmpeg 合并下载。".to_string()),
        },
    );

    let mut command = Command::new(ffmpeg);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command
        .spawn()
        .map_err(|e| format!("启动 FFmpeg 失败: {}", e))?;
    let error_log = child.stderr.take().map(spawn_process_log_reader);
    let mut last_emit = Instant::now();
    loop {
        if control.cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            return Err("下载已取消".to_string());
        }
        match child
            .try_wait()
            .map_err(|e| format!("检查 FFmpeg 状态失败: {}", e))?
        {
            Some(status) => {
                if status.success() {
                    let size = fs::metadata(&target_path)
                        .map(|meta| meta.len())
                        .unwrap_or(0);
                    emit_progress(
                        &app_handle,
                        DownloadProgress {
                            task_id,
                            status: "done".to_string(),
                            downloaded: size,
                            total: Some(size),
                            percent: Some(100.0),
                            speed: None,
                            eta: None,
                            file_name: Some(final_file_name),
                            output_path: Some(target_path.to_string_lossy().to_string()),
                            message: Some("HLS / m3u8 下载完成".to_string()),
                        },
                    );
                    return Ok(());
                }
                let stderr = process_log_text(&error_log);
                let detail = if stderr.is_empty() {
                    format!("exit status: {}", status)
                } else {
                    stderr
                };
                return Err(format!("FFmpeg HLS 下载失败: {}", detail));
            }
            None => {
                if last_emit.elapsed() >= Duration::from_secs(1) {
                    last_emit = Instant::now();
                    let size = fs::metadata(&target_path)
                        .map(|meta| meta.len())
                        .unwrap_or(0);
                    emit_progress(
                        &app_handle,
                        DownloadProgress {
                            task_id: task_id.clone(),
                            status: "downloading".to_string(),
                            downloaded: size,
                            total: None,
                            percent: None,
                            speed: None,
                            eta: None,
                            file_name: Some(final_file_name.clone()),
                            output_path: Some(target_path.to_string_lossy().to_string()),
                            message: Some(
                                "HLS / m3u8 下载中，进度以输出文件大小显示。".to_string(),
                            ),
                        },
                    );
                }
                std::thread::sleep(Duration::from_millis(300));
            }
        }
    }
}

fn aria2_download_worker(
    app_handle: AppHandle,
    task_id: String,
    payload: DownloadManagerPayload,
    control: Arc<DownloadTaskControl>,
    url: String,
    output_dir: PathBuf,
) -> Result<(), String> {
    let aria2 = find_aria2_binary()
        .ok_or_else(|| "未找到 aria2c，FTP、磁力/BT、Metalink 需要先安装 aria2。".to_string())?;
    let file_name = payload
        .file_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(sanitize_file_name);
    let display_name = file_name.clone().unwrap_or_else(|| {
        file_name_for_protocol(&url, "aria2").unwrap_or_else(|| "aria2-task".to_string())
    });
    let mut args = vec![
        "--allow-overwrite=false".to_string(),
        "--auto-file-renaming=true".to_string(),
        "--continue=true".to_string(),
        "--summary-interval=1".to_string(),
        "--console-log-level=warn".to_string(),
        "--dir".to_string(),
        output_dir.to_string_lossy().to_string(),
        "-x".to_string(),
        payload.thread_count.unwrap_or(8).clamp(1, 16).to_string(),
        "-s".to_string(),
        payload.thread_count.unwrap_or(8).clamp(1, 16).to_string(),
    ];
    if payload.overwrite.unwrap_or(false) {
        args[0] = "--allow-overwrite=true".to_string();
        args[1] = "--auto-file-renaming=false".to_string();
    }
    if let Some(name) = file_name {
        args.push("--out".to_string());
        args.push(name);
    }
    if let Some(value) = payload
        .user_agent
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        args.push("--user-agent".to_string());
        args.push(value.to_string());
    }
    if let Some(value) = payload
        .referer
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        args.push("--referer".to_string());
        args.push(value.to_string());
    }
    if let Some(cookie) = download_cookie_from_payload(&payload)? {
        args.push("--header".to_string());
        args.push(format!("Cookie: {}", cookie));
    }
    if let Some(headers) = payload.headers.as_ref() {
        for item in headers {
            let name = item.name.trim();
            let value = item.value.trim();
            if !name.is_empty() && !value.is_empty() {
                args.push("--header".to_string());
                args.push(format!("{}: {}", name, value));
            }
        }
    }
    args.push(url);

    emit_progress(
        &app_handle,
        DownloadProgress {
            task_id: task_id.clone(),
            status: "downloading".to_string(),
            downloaded: 0,
            total: None,
            percent: None,
            speed: None,
            eta: None,
            file_name: Some(display_name.clone()),
            output_path: Some(output_dir.to_string_lossy().to_string()),
            message: Some("协议任务正在通过 aria2c 下载。".to_string()),
        },
    );

    let mut command = Command::new(aria2);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command
        .spawn()
        .map_err(|e| format!("启动 aria2c 失败: {}", e))?;
    let error_log = child.stderr.take().map(spawn_process_log_reader);
    loop {
        if control.cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            return Err("下载已取消".to_string());
        }
        match child
            .try_wait()
            .map_err(|e| format!("检查 aria2c 状态失败: {}", e))?
        {
            Some(status) => {
                if status.success() {
                    emit_progress(
                        &app_handle,
                        DownloadProgress {
                            task_id,
                            status: "done".to_string(),
                            downloaded: 0,
                            total: None,
                            percent: Some(100.0),
                            speed: None,
                            eta: None,
                            file_name: Some(display_name),
                            output_path: Some(output_dir.to_string_lossy().to_string()),
                            message: Some("aria2 协议任务完成".to_string()),
                        },
                    );
                    return Ok(());
                }
                let stderr = process_log_text(&error_log);
                let detail = if stderr.is_empty() {
                    format!("exit status: {}", status)
                } else {
                    stderr
                };
                return Err(format!("aria2 下载失败: {}", detail));
            }
            None => {
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }
}

fn download_segment(
    app_handle: &AppHandle,
    client: &Client,
    headers: HeaderMap,
    url: &str,
    part_path: &Path,
    start: u64,
    end: u64,
    control: Arc<DownloadTaskControl>,
    tracker: Arc<ProgressTracker>,
) -> Result<(), String> {
    if start > end {
        return Ok(());
    }
    let mut response = client
        .get(url)
        .headers(headers)
        .header(RANGE, format!("bytes={}-{}", start, end))
        .send()
        .map_err(|e| format!("下载分片请求失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("下载分片响应失败: {}", e))?;
    if response.status() != StatusCode::PARTIAL_CONTENT {
        return Err(
            "服务器未按分片范围返回数据，已停止以避免文件损坏；请改用 1 线程下载。".to_string(),
        );
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(part_path)
        .map_err(|e| format!("创建分片文件失败: {}", e))?;
    copy_response(app_handle, &mut response, &mut file, control, tracker)?;
    Ok(())
}

fn copy_response(
    app_handle: &AppHandle,
    response: &mut Response,
    file: &mut File,
    control: Arc<DownloadTaskControl>,
    tracker: Arc<ProgressTracker>,
) -> Result<(), String> {
    let mut buffer = [0u8; 64 * 1024];
    loop {
        if control.cancel.load(Ordering::Relaxed) {
            return Err("下载已取消".to_string());
        }
        while control.pause.load(Ordering::Relaxed) {
            emit_progress(
                app_handle,
                tracker.snapshot("paused", None, Some("已暂停".to_string())),
            );
            if control.cancel.load(Ordering::Relaxed) {
                return Err("下载已取消".to_string());
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        let read = response
            .read(&mut buffer)
            .map_err(|e| format!("读取下载数据失败: {}", e))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|e| format!("写入下载数据失败: {}", e))?;
        tracker.downloaded.fetch_add(read as u64, Ordering::Relaxed);
        tracker.emit_throttled(app_handle, "downloading", None);
    }
    Ok(())
}

impl ProgressTracker {
    fn snapshot(
        &self,
        status: &str,
        percent_override: Option<f32>,
        message: Option<String>,
    ) -> DownloadProgress {
        let downloaded = self.downloaded.load(Ordering::Relaxed);
        let percent = percent_override.or_else(|| {
            self.total
                .filter(|total| *total > 0)
                .map(|total| ((downloaded as f64 / total as f64) * 100.0).min(100.0) as f32)
        });
        let elapsed = self.started_at.elapsed().as_secs_f64().max(0.001);
        let bytes_per_second = downloaded as f64 / elapsed;
        let speed = if bytes_per_second > 1.0 {
            Some(format!("{}/s", format_bytes(bytes_per_second as u64)))
        } else {
            None
        };
        let eta = match (self.total, bytes_per_second > 1.0) {
            (Some(total), true) if total > downloaded => Some(format_duration(
                ((total - downloaded) as f64 / bytes_per_second) as u64,
            )),
            _ => None,
        };
        DownloadProgress {
            task_id: self.task_id.clone(),
            status: status.to_string(),
            downloaded,
            total: self.total,
            percent,
            speed,
            eta,
            file_name: Some(self.file_name.clone()),
            output_path: Some(self.output_path.to_string_lossy().to_string()),
            message,
        }
    }

    fn emit_throttled(&self, app_handle: &AppHandle, status: &str, message: Option<String>) {
        let Ok(mut last_emit) = self.last_emit.lock() else {
            return;
        };
        if last_emit.elapsed() < Duration::from_millis(350) {
            return;
        }
        *last_emit = Instant::now();
        emit_progress(app_handle, self.snapshot(status, None, message));
    }
}

fn emit_progress(app_handle: &AppHandle, progress: DownloadProgress) {
    let _ = app_handle.emit_all("download-manager-progress", progress);
}

fn spawn_process_log_reader<R: Read + Send + 'static>(mut pipe: R) -> Arc<Mutex<Vec<u8>>> {
    let log = Arc::new(Mutex::new(Vec::new()));
    let target = Arc::clone(&log);
    std::thread::spawn(move || {
        let mut buffer = [0u8; 2048];
        loop {
            match pipe.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    if let Ok(mut text) = target.lock() {
                        text.extend_from_slice(&buffer[..size]);
                        if text.len() > PROCESS_LOG_LIMIT {
                            let overflow = text.len() - PROCESS_LOG_LIMIT;
                            text.drain(0..overflow);
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });
    log
}

fn process_log_text(log: &Option<Arc<Mutex<Vec<u8>>>>) -> String {
    log.as_ref()
        .and_then(|value| {
            value
                .lock()
                .ok()
                .map(|bytes| String::from_utf8_lossy(&bytes).trim().to_string())
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
}

fn validate_url(url: &str) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        Ok(())
    } else {
        Err(
            "HTTP 多线程模式只支持 HTTP/HTTPS 直链；FTP、磁力/BT、Metalink 请使用 Aria2 协议任务。"
                .to_string(),
        )
    }
}

fn detect_download_type(url: &str, requested: Option<&str>) -> String {
    let requested = requested.unwrap_or("auto").trim().to_lowercase();
    if requested != "auto" && !requested.is_empty() {
        return requested;
    }
    let lower = url.trim().to_ascii_lowercase();
    if lower.starts_with("magnet:") || lower.contains(".torrent") {
        "aria2".to_string()
    } else if lower.starts_with("ftp://")
        || lower.contains(".metalink")
        || lower.contains(".meta4")
        || lower.contains(".torrent")
    {
        "aria2".to_string()
    } else if lower.contains(".m3u8") || lower.ends_with(".m3u8") {
        "hls".to_string()
    } else {
        "http".to_string()
    }
}

fn protocol_content_type(download_type: &str) -> &'static str {
    match download_type {
        "hls" => "application/vnd.apple.mpegurl",
        "aria2" => "application/x-aria2-task",
        _ => "application/octet-stream",
    }
}

fn file_name_for_protocol(url: &str, download_type: &str) -> Option<String> {
    match download_type {
        "hls" => file_name_from_url(url)
            .map(|value| ensure_extension(&value, "mp4"))
            .or_else(|| Some("hls-video.mp4".to_string())),
        "aria2" => {
            if url.starts_with("magnet:") {
                Some("magnet-task".to_string())
            } else {
                file_name_from_url(url).or_else(|| Some("aria2-task".to_string()))
            }
        }
        _ => file_name_from_url(url),
    }
}

fn ensure_extension(file_name: &str, ext: &str) -> String {
    let wanted = ext.trim_start_matches('.');
    let path = Path::new(file_name);
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case(wanted))
        .unwrap_or(false)
    {
        file_name.to_string()
    } else {
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(file_name)
            .trim_end_matches('.');
        format!("{}.{}", stem, wanted)
    }
}

fn ffmpeg_header_lines(payload: &DownloadManagerPayload) -> Result<String, String> {
    let mut lines = Vec::new();
    if let Some(value) = payload
        .referer
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("Referer: {}", value));
    }
    if let Some(cookie) = download_cookie_from_payload(payload)? {
        lines.push(format!("Cookie: {}", cookie));
    }
    if let Some(headers) = payload.headers.as_ref() {
        for item in headers {
            let name = item.name.trim();
            let value = item.value.trim();
            if !name.is_empty() && !value.is_empty() {
                lines.push(format!("{}: {}", name, value));
            }
        }
    }
    Ok(lines.join("\r\n"))
}

fn find_aria2_binary() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("where");
        cmd.arg("aria2c");
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(output) = cmd.output() {
            if output.status.success() {
                if let Some(path) = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    return Some(path.to_string());
                }
            }
        }
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            let scoop = Path::new(&user_profile)
                .join("scoop")
                .join("shims")
                .join("aria2c.exe");
            if scoop.exists() {
                return Some(scoop.to_string_lossy().to_string());
            }
        }
        if let Some(path) = find_winget_aria2_binary() {
            return Some(path);
        }
        let choco = Path::new(r"C:\ProgramData\chocolatey\bin\aria2c.exe");
        if choco.exists() {
            return Some(choco.to_string_lossy().to_string());
        }
        for candidate in &[
            r"C:\aria2\aria2c.exe",
            r"C:\Program Files\aria2\aria2c.exe",
            r"C:\Program Files (x86)\aria2\aria2c.exe",
        ] {
            if Path::new(candidate).exists() {
                return Some((*candidate).to_string());
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("which");
        cmd.arg("aria2c");
        if let Ok(output) = cmd.output() {
            if output.status.success() {
                if let Some(path) = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    return Some(path.to_string());
                }
            }
        }
        for candidate in &[
            "/usr/local/bin/aria2c",
            "/opt/homebrew/bin/aria2c",
            "/usr/bin/aria2c",
        ] {
            if Path::new(candidate).exists() {
                return Some((*candidate).to_string());
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn find_winget_aria2_binary() -> Option<String> {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
    let package_root = local.join(r"Microsoft\WinGet\Packages");
    let entries = fs::read_dir(package_root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !name.contains("aria2") {
            continue;
        }
        if let Some(binary) = find_file_breadth_first(&path, "aria2c.exe", 4) {
            return Some(binary.to_string_lossy().to_string());
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn find_file_breadth_first(root: &Path, file_name: &str, max_depth: usize) -> Option<PathBuf> {
    let mut queue = vec![(root.to_path_buf(), 0usize)];
    let target_name = file_name.to_ascii_lowercase();
    while let Some((dir, depth)) = queue.pop() {
        let entries = fs::read_dir(&dir).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                if name == target_name {
                    return Some(path);
                }
            } else if depth < max_depth && path.is_dir() {
                queue.push((path, depth + 1));
            }
        }
    }
    None
}

fn content_length_from_headers(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit('/').next())
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| {
            headers
                .get(CONTENT_LENGTH)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
        })
}

fn file_name_from_headers(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(CONTENT_DISPOSITION)?.to_str().ok()?;
    for part in value.split(';') {
        let part = part.trim();
        if let Some(file_name) = part.strip_prefix("filename*=") {
            let decoded = file_name
                .split("''")
                .last()
                .map(urlencoding::decode)
                .and_then(Result::ok)
                .map(|value| value.to_string())?;
            return Some(sanitize_file_name(&decoded));
        }
        if let Some(file_name) = part.strip_prefix("filename=") {
            return Some(sanitize_file_name(file_name.trim_matches('"')));
        }
    }
    None
}

fn file_name_from_url(url: &str) -> Option<String> {
    let without_query = url.split('?').next().unwrap_or(url);
    without_query
        .rsplit('/')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| sanitize_file_name(value))
}

fn sanitize_file_name(value: &str) -> String {
    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let cleaned = value
        .chars()
        .map(|ch| {
            if invalid.contains(&ch) || ch.is_control() {
                '_'
            } else {
                ch
            }
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();
    if cleaned.is_empty() {
        "download.bin".to_string()
    } else {
        cleaned
    }
}

fn resolve_target_path(output_dir: &Path, file_name: &str, overwrite: bool) -> PathBuf {
    let mut path = output_dir.join(file_name);
    if overwrite || !path.exists() {
        return path;
    }
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value))
        .unwrap_or_default();
    for index in 1..10_000 {
        path = output_dir.join(format!("{} ({}){}", stem, index, extension));
        if !path.exists() {
            return path;
        }
    }
    output_dir.join(format!("{}-{}{}", stem, uuid::Uuid::new_v4(), extension))
}

fn part_dir_for(target_path: &Path) -> PathBuf {
    let mut name = target_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("download")
        .to_string();
    name.push_str(".mcdl");
    target_path.with_file_name(name)
}

fn normalized_part_size(path: &Path, max_size: u64) -> Result<u64, String> {
    let size = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    if size > max_size {
        OpenOptions::new()
            .write(true)
            .open(path)
            .and_then(|file| file.set_len(max_size))
            .map_err(|e| format!("修正分片大小失败: {}", e))?;
        Ok(max_size)
    } else {
        Ok(size)
    }
}

fn format_bytes(value: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut size = value as f64;
    let mut unit = 0usize;
    while size >= 1024.0 && unit < UNITS.len() - 1 {
        size /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{} {}", value, UNITS[unit])
    } else {
        format!("{:.2} {}", size, UNITS[unit])
    }
}

fn format_duration(seconds: u64) -> String {
    let h = seconds / 3600;
    let m = (seconds % 3600) / 60;
    let s = seconds % 60;
    if h > 0 {
        format!("{}:{:02}:{:02}", h, m, s)
    } else {
        format!("{}:{:02}", m, s)
    }
}
