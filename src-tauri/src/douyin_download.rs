use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

static DOUYIN_CANCELLED_TASKS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

const MOBILE_UA: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const DOUYIN_HOME_REFERER: &str = "https://www.douyin.com/";
const DOUYIN_SHARE_REFERER: &str = "https://www.iesdouyin.com/";

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DouyinCommandPayload {
    input: Option<String>,
    output_dir: Option<String>,
    task_id: Option<String>,
    selected_source_id: Option<String>,
    selected_source_label: Option<String>,
    resolved_url: Option<String>,
    title: Option<String>,
    author: Option<String>,
    video_id: Option<String>,
    share_url: Option<String>,
    cookie_mode: Option<String>,
    cookie_browser: Option<String>,
    manual_cookie: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DouyinVideoInfo {
    video_id: String,
    title: String,
    author: Option<String>,
    cover: Option<String>,
    duration: Option<f64>,
    width: Option<u64>,
    height: Option<u64>,
    share_url: String,
    sources: Vec<DouyinDownloadSource>,
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DouyinDownloadSource {
    id: String,
    label: String,
    url: String,
    preview_url: Option<String>,
    size: Option<u64>,
    width: Option<u64>,
    height: Option<u64>,
    quality: Option<String>,
    codec: Option<String>,
    bitrate: Option<u64>,
    source_type: String,
    note: String,
}

#[derive(Debug, Default)]
struct MediaProbe {
    preview_url: Option<String>,
    size: Option<u64>,
}

#[derive(Debug, Default, Clone)]
struct DouyinRequestContext {
    share_url: String,
    cookie: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DouyinCookieProbeResult {
    browser: String,
    found: bool,
    count: usize,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DouyinDownloadResult {
    task_id: String,
    output_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DouyinDownloadProgress {
    task_id: String,
    status: String,
    percent: Option<f32>,
    downloaded: u64,
    total: Option<u64>,
    filename: Option<String>,
    output_path: Option<String>,
    message: Option<String>,
}

#[tauri::command]
pub async fn douyin_download_command(
    app_handle: AppHandle,
    action: String,
    payload: String,
) -> Result<String, String> {
    let payload: DouyinCommandPayload = if payload.trim().is_empty() {
        DouyinCommandPayload::default()
    } else {
        serde_json::from_str(&payload).map_err(|e| format!("解析抖音下载参数失败: {}", e))?
    };

    match action.as_str() {
        "defaultDir" => json_response(default_download_dir()?),
        "probe" => {
            run_douyin_blocking("解析抖音视频", move || {
                json_response(fetch_video_info(&payload)?)
            })
            .await
        }
        "probeCookie" => {
            run_douyin_blocking("读取抖音 Cookie", move || {
                json_response(probe_douyin_cookie(&payload)?)
            })
            .await
        }
        "start" => {
            run_douyin_blocking("启动抖音下载", move || {
                json_response(start_download(app_handle, payload)?)
            })
            .await
        }
        "cancel" => {
            let task_id = payload
                .task_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "任务 ID 不能为空".to_string())?;
            mark_cancelled(task_id, true);
            json_response(serde_json::json!({ "ok": true }))
        }
        _ => Err("未知抖音下载动作".to_string()),
    }
}

async fn run_douyin_blocking<F>(label: &str, task: F) -> Result<String, String>
where
    F: FnOnce() -> Result<String, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| format!("{}任务执行失败: {}", label, e))?
}

fn json_response<T: Serialize>(value: T) -> Result<String, String> {
    serde_json::to_string(&value).map_err(|e| format!("序列化抖音下载响应失败: {}", e))
}

fn default_download_dir() -> Result<String, String> {
    Ok(dirs::download_dir()
        .or_else(dirs::video_dir)
        .or_else(dirs::desktop_dir)
        .unwrap_or_else(std::env::temp_dir)
        .to_string_lossy()
        .to_string())
}

fn fetch_video_info(payload: &DouyinCommandPayload) -> Result<DouyinVideoInfo, String> {
    let input = payload
        .input
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "请输入抖音分享链接、分享文案或作品 ID。".to_string())?;
    let client = http_client()?;
    let first_url = extract_first_url(input);
    let resolved_url = if let Some(url) = first_url.as_deref() {
        resolve_share_url(&client, url)?
    } else {
        input.to_string()
    };
    let video_id = extract_aweme_id(&resolved_url)
        .or_else(|| extract_aweme_id(input))
        .ok_or_else(|| "没有识别到抖音作品 ID，请粘贴完整分享链接或作品页链接。".to_string())?;
    let share_url = format!("https://www.iesdouyin.com/share/video/{}/", video_id);
    let html = fetch_share_html(&client, &share_url)?;
    let data = extract_router_data(&html)?;
    let item = find_video_item(&data).ok_or_else(|| {
        "分享页没有返回视频详情，可能需要稍后重试或该作品不可公开访问。".to_string()
    })?;
    let title = json_string(item, "desc").unwrap_or_else(|| "抖音视频".to_string());
    let author = item
        .get("author")
        .and_then(|value| json_string(value, "nickname"));
    let video = item
        .get("video")
        .ok_or_else(|| "分享页没有返回视频播放信息。".to_string())?;
    let cover = string_at_path(video, &["cover", "url_list"])
        .or_else(|| string_at_path(video, &["origin_cover", "url_list"]))
        .or_else(|| string_at_path(video, &["dynamic_cover", "url_list"]));
    let width = json_u64(video, "width");
    let height = json_u64(video, "height");
    let duration = json_f64(video, "duration").map(|value| {
        if value > 1000.0 {
            value / 1000.0
        } else {
            value
        }
    });
    let mut sources = Vec::new();

    append_bit_rate_sources(&client, &mut sources, video, &share_url, width, height);

    if let Some(url) = string_at_path(video, &["play_addr", "url_list"]) {
        let probe = probe_media_source(&client, &url, &share_url);
        sources.push(DouyinDownloadSource {
            id: "play-wm".to_string(),
            label: "普通播放源".to_string(),
            preview_url: probe.preview_url,
            size: probe.size,
            url,
            width,
            height,
            quality: resolution_label(width, height),
            codec: None,
            bitrate: None,
            source_type: "fallback".to_string(),
            note: "公开分享页 play_addr 兜底源，兼容性最好，不代表最高画质。".to_string(),
        });
    }
    if let Some(play_uri) = json_string_at_path(video, &["play_addr", "uri"]) {
        let url = format!(
            "https://aweme.snssdk.com/aweme/v1/play/?line=0&ratio=720p&video_id={}",
            play_uri
        );
        let probe = probe_media_source(&client, &url, &share_url);
        sources.push(DouyinDownloadSource {
            id: "play-direct".to_string(),
            label: "备用播放源".to_string(),
            preview_url: probe.preview_url,
            size: probe.size,
            url,
            width,
            height,
            quality: resolution_label(width, height),
            codec: None,
            bitrate: None,
            source_type: "fallback".to_string(),
            note: "按公开视频 ID 拼接的备用播放源，不代表更高清；若失败请改用其它版本。"
                .to_string(),
        });
    }
    dedupe_sources(&mut sources);
    if sources.is_empty() {
        return Err(
            "没有解析到可下载的视频地址。抖音页面结构可能变化，或该作品不允许网页播放。"
                .to_string(),
        );
    }

    Ok(DouyinVideoInfo {
        video_id,
        title,
        author,
        cover,
        duration,
        width,
        height,
        share_url,
        sources,
        message: Some("已通过抖音公开分享页解析，不依赖 TikHub 或 yt-dlp。".to_string()),
    })
}

fn probe_douyin_cookie(payload: &DouyinCommandPayload) -> Result<DouyinCookieProbeResult, String> {
    let browser = payload
        .cookie_browser
        .as_deref()
        .or(payload.cookie_mode.as_deref())
        .unwrap_or("chrome")
        .trim()
        .to_string();
    let cookie = auto_douyin_cookie(&browser)?;
    let count = cookie
        .split(';')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .count();
    Ok(DouyinCookieProbeResult {
        browser,
        found: count > 0,
        count,
        message: if count > 0 {
            format!("已读取到 {} 个抖音相关 Cookie。", count)
        } else {
            "没有读取到抖音 Cookie，请确认浏览器已登录抖音，或改用手动 Cookie。".to_string()
        },
    })
}

fn start_download(
    app_handle: AppHandle,
    payload: DouyinCommandPayload,
) -> Result<DouyinDownloadResult, String> {
    let task_id = payload
        .task_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    mark_cancelled(&task_id, false);

    let output_dir = payload
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
    std::fs::create_dir_all(&output_dir).map_err(|e| format!("创建保存目录失败: {}", e))?;

    let info = if let Some(url) = payload
        .resolved_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        DouyinVideoInfo {
            video_id: payload
                .video_id
                .clone()
                .unwrap_or_else(|| "douyin".to_string()),
            title: payload
                .title
                .clone()
                .unwrap_or_else(|| "抖音视频".to_string()),
            author: payload.author.clone(),
            cover: None,
            duration: None,
            width: None,
            height: None,
            share_url: payload
                .share_url
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| DOUYIN_SHARE_REFERER.to_string()),
            sources: vec![DouyinDownloadSource {
                id: payload
                    .selected_source_id
                    .clone()
                    .unwrap_or_else(|| "selected".to_string()),
                label: payload
                    .selected_source_label
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| match payload.selected_source_id.as_deref() {
                        Some("play-wm") => "普通播放版".to_string(),
                        Some("play-direct") => "备用播放版".to_string(),
                        _ => "已选版本".to_string(),
                    }),
                url: url.to_string(),
                preview_url: None,
                size: None,
                width: None,
                height: None,
                quality: None,
                codec: None,
                bitrate: None,
                source_type: "selected".to_string(),
                note: String::new(),
            }],
            message: None,
        }
    } else {
        fetch_video_info(&payload)?
    };
    let selected_id = payload.selected_source_id.as_deref().unwrap_or("play-wm");
    let source = info
        .sources
        .iter()
        .find(|item| item.id == selected_id)
        .or_else(|| info.sources.first())
        .ok_or_else(|| "没有可下载的视频版本。".to_string())?
        .clone();
    let output_path = unique_output_path(output_dir.join(build_file_name(&info, &source)));
    let output_path_string = output_path.to_string_lossy().to_string();
    let request_context = DouyinRequestContext {
        share_url: info.share_url.clone(),
        cookie: douyin_cookie_from_payload(&payload)?,
    };
    let task_id_for_thread = task_id.clone();
    std::thread::spawn(move || {
        if let Err(message) = download_file(
            app_handle.clone(),
            &task_id_for_thread,
            &source,
            &output_path,
            &request_context,
        ) {
            emit_progress(
                &app_handle,
                DouyinDownloadProgress {
                    task_id: task_id_for_thread,
                    status: if message == "下载已取消" {
                        "cancelled"
                    } else {
                        "error"
                    }
                    .to_string(),
                    percent: None,
                    downloaded: 0,
                    total: None,
                    filename: output_path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .map(str::to_string),
                    output_path: Some(output_path.to_string_lossy().to_string()),
                    message: Some(message),
                },
            );
        }
    });

    Ok(DouyinDownloadResult {
        task_id,
        output_path: output_path_string,
    })
}

fn download_file(
    app_handle: AppHandle,
    task_id: &str,
    source: &DouyinDownloadSource,
    output_path: &Path,
    context: &DouyinRequestContext,
) -> Result<(), String> {
    let client = http_client()?;
    let mut response = request_media_for_download(&client, source, context)?;
    let total = response.content_length().or(source.size);
    let mut file = File::create(output_path).map_err(|e| format!("创建输出文件失败: {}", e))?;
    let mut downloaded = 0u64;
    let mut buffer = [0u8; 1024 * 128];
    emit_progress(
        &app_handle,
        DouyinDownloadProgress {
            task_id: task_id.to_string(),
            status: "processing".to_string(),
            percent: Some(0.0),
            downloaded,
            total,
            filename: output_path
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string),
            output_path: Some(output_path.to_string_lossy().to_string()),
            message: Some("开始下载".to_string()),
        },
    );

    loop {
        if is_cancelled(task_id) {
            let _ = std::fs::remove_file(output_path);
            take_cancelled(task_id);
            return Err("下载已取消".to_string());
        }
        let read = response
            .read(&mut buffer)
            .map_err(|e| format!("读取抖音视频流失败: {}", e))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|e| format!("写入视频文件失败: {}", e))?;
        downloaded += read as u64;
        let percent = total.map(|value| {
            if value == 0 {
                0.0
            } else {
                ((downloaded as f64 / value as f64) * 100.0).clamp(0.0, 100.0) as f32
            }
        });
        emit_progress(
            &app_handle,
            DouyinDownloadProgress {
                task_id: task_id.to_string(),
                status: "processing".to_string(),
                percent,
                downloaded,
                total,
                filename: output_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(str::to_string),
                output_path: Some(output_path.to_string_lossy().to_string()),
                message: None,
            },
        );
    }
    file.flush()
        .map_err(|e| format!("保存视频文件失败: {}", e))?;
    take_cancelled(task_id);
    emit_progress(
        &app_handle,
        DouyinDownloadProgress {
            task_id: task_id.to_string(),
            status: "done".to_string(),
            percent: Some(100.0),
            downloaded,
            total: Some(total.unwrap_or(downloaded)),
            filename: output_path
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string),
            output_path: Some(output_path.to_string_lossy().to_string()),
            message: Some("下载完成".to_string()),
        },
    );
    Ok(())
}

fn resolve_share_url(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .header(reqwest::header::USER_AGENT, MOBILE_UA)
        .header(
            reqwest::header::ACCEPT,
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .send()
        .map_err(|e| format!("展开抖音短链失败: {}", e))?;
    Ok(response.url().as_str().to_string())
}

fn fetch_share_html(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    client
        .get(url)
        .header(reqwest::header::USER_AGENT, MOBILE_UA)
        .header(
            reqwest::header::ACCEPT,
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .send()
        .map_err(|e| format!("请求抖音分享页失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("抖音分享页响应失败: {}", e))?
        .text()
        .map_err(|e| format!("读取抖音分享页失败: {}", e))
}

fn extract_router_data(html: &str) -> Result<Value, String> {
    let marker = "window._ROUTER_DATA = ";
    let start = html
        .find(marker)
        .ok_or_else(|| "分享页没有找到 _ROUTER_DATA 数据。".to_string())?
        + marker.len();
    let rest = &html[start..];
    let end = rest
        .find("</script>")
        .ok_or_else(|| "分享页 _ROUTER_DATA 数据不完整。".to_string())?;
    let raw = rest[..end].trim().trim_end_matches(';').trim();
    serde_json::from_str(raw).map_err(|e| format!("解析抖音分享页数据失败: {}", e))
}

fn find_video_item(value: &Value) -> Option<&Value> {
    value
        .pointer("/loaderData/video_(id)~1page/videoInfoRes/item_list/0")
        .or_else(|| value.pointer("/loaderData/video_(id)~1page/videoInfoRes/aweme_detail"))
        .or_else(|| value.pointer("/loaderData/video/videoInfoRes/item_list/0"))
        .or_else(|| find_video_item_deep(value))
}

fn find_video_item_deep(value: &Value) -> Option<&Value> {
    match value {
        Value::Object(map) => {
            if map.contains_key("aweme_id")
                && map
                    .get("video")
                    .and_then(|video| video.get("play_addr"))
                    .is_some()
            {
                return Some(value);
            }
            map.values().find_map(find_video_item_deep)
        }
        Value::Array(items) => items.iter().find_map(find_video_item_deep),
        _ => None,
    }
}

fn extract_first_url(input: &str) -> Option<String> {
    let re = regex::Regex::new(r#"https?://[^\s"'<>，。！？；、)]+"#).ok()?;
    re.find(input).map(|item| {
        item.as_str()
            .trim_end_matches(['，', '。', '！', '？', '；', '、', ')'])
            .to_string()
    })
}

fn extract_aweme_id(input: &str) -> Option<String> {
    let patterns = [
        r"/video/(\d+)",
        r"/share/video/(\d+)",
        r"aweme_id=(\d+)",
        r"item_ids=(\d+)",
        r"\b(\d{15,25})\b",
    ];
    for pattern in patterns {
        let re = regex::Regex::new(pattern).ok()?;
        if let Some(value) = re
            .captures(input)
            .and_then(|captures| captures.get(1))
            .map(|item| item.as_str().to_string())
        {
            return Some(value);
        }
    }
    None
}

fn append_bit_rate_sources(
    client: &reqwest::blocking::Client,
    sources: &mut Vec<DouyinDownloadSource>,
    video: &Value,
    share_url: &str,
    fallback_width: Option<u64>,
    fallback_height: Option<u64>,
) {
    let mut index = 0usize;
    for item in bit_rate_items(video) {
        let quality_type = json_u64(item, "quality_type");
        let gear = json_string(item, "gear_name")
            .or_else(|| json_string(item, "quality"))
            .or_else(|| quality_type.map(|value| format!("quality{}", value)));
        let bit_rate = json_u64(item, "bit_rate")
            .or_else(|| json_u64(item, "bitrate"))
            .or_else(|| json_u64(item, "video_bit_rate"));

        for (addr_key, codec_hint) in [("play_addr", None), ("play_addr_265", Some("H265"))] {
            let Some(addr) = item.get(addr_key) else {
                continue;
            };
            let Some(url) = string_at_path(addr, &["url_list"]) else {
                continue;
            };
            let width = json_u64(addr, "width").or(fallback_width);
            let height = json_u64(addr, "height").or(fallback_height);
            let size = json_u64(addr, "data_size").or_else(|| json_u64(addr, "file_size"));
            let probe = if size.is_some() {
                MediaProbe {
                    preview_url: None,
                    size,
                }
            } else {
                probe_media_source(client, &url, share_url)
            };
            let codec = codec_hint
                .map(str::to_string)
                .or_else(|| infer_codec(item, addr, addr_key));
            let quality = resolution_label(width, height).or_else(|| gear.clone());
            let label = source_label(quality.as_deref(), codec.as_deref(), bit_rate);
            sources.push(DouyinDownloadSource {
                id: format!("bitrate-{index}-{addr_key}"),
                label,
                url,
                preview_url: probe.preview_url,
                size: probe.size.or(size),
                width,
                height,
                quality,
                codec,
                bitrate: bit_rate,
                source_type: "quality".to_string(),
                note: format!(
                    "来自 bit_rate 清晰度列表{}{}。",
                    gear.as_deref()
                        .map(|value| format!(" · {}", value))
                        .unwrap_or_default(),
                    quality_type
                        .map(|value| format!(" · quality_type {}", value))
                        .unwrap_or_default()
                ),
            });
            index += 1;
        }
    }
}

fn bit_rate_items(video: &Value) -> Vec<&Value> {
    let Some(value) = video.get("bit_rate") else {
        return Vec::new();
    };
    if let Some(items) = value.as_array() {
        return items.iter().collect();
    }
    if let Some(items) = value.get("data").and_then(Value::as_array) {
        return items.iter().collect();
    }
    if let Some(items) = value.get("list").and_then(Value::as_array) {
        return items.iter().collect();
    }
    Vec::new()
}

fn source_label(quality: Option<&str>, codec: Option<&str>, bit_rate: Option<u64>) -> String {
    let mut parts = Vec::new();
    if let Some(quality) = quality.map(str::trim).filter(|value| !value.is_empty()) {
        parts.push(quality.to_string());
    } else {
        parts.push("清晰度版本".to_string());
    }
    if let Some(codec) = codec.map(str::trim).filter(|value| !value.is_empty()) {
        parts.push(codec.to_string());
    }
    if let Some(bit_rate) = bit_rate {
        parts.push(format_bitrate(bit_rate));
    }
    parts.join(" · ")
}

fn resolution_label(width: Option<u64>, height: Option<u64>) -> Option<String> {
    match (width, height) {
        (Some(width), Some(height)) if width > 0 && height > 0 => {
            Some(format!("{}P", width.max(height)))
        }
        (_, Some(height)) if height > 0 => Some(format!("{}P", height)),
        _ => None,
    }
}

fn infer_codec(item: &Value, addr: &Value, addr_key: &str) -> Option<String> {
    if addr_key.contains("265") {
        return Some("H265".to_string());
    }
    let text = [
        json_string(item, "format"),
        json_string(item, "codec_type"),
        json_string(item, "codec"),
        json_string(addr, "format"),
        json_string(addr, "codec_type"),
        json_string(addr, "codec"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ")
    .to_lowercase();
    if text.contains("265") || text.contains("hevc") || text.contains("hvc") {
        Some("H265".to_string())
    } else if text.contains("264") || text.contains("avc") {
        Some("H264".to_string())
    } else {
        Some("H264".to_string())
    }
}

fn format_bitrate(value: u64) -> String {
    if value >= 1_000_000 {
        format!("{:.1} Mbps", value as f64 / 1_000_000.0)
    } else if value >= 1_000 {
        format!("{} Kbps", (value as f64 / 1_000.0).round() as u64)
    } else {
        format!("{} bps", value)
    }
}

fn request_media_for_download(
    client: &reqwest::blocking::Client,
    source: &DouyinDownloadSource,
    context: &DouyinRequestContext,
) -> Result<reqwest::blocking::Response, String> {
    let candidates = download_url_candidates(source);
    let referers = referer_candidates(&context.share_url);
    let mut last_error = String::new();

    for url in candidates {
        for referer in &referers {
            let mut request = client
                .get(&url)
                .header(reqwest::header::USER_AGENT, MOBILE_UA)
                .header(reqwest::header::REFERER, referer.as_str())
                .header(reqwest::header::ACCEPT, "*/*")
                .header(reqwest::header::ACCEPT_ENCODING, "identity");
            if let Some(cookie) = context
                .cookie
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                request = request.header(reqwest::header::COOKIE, cookie);
            }
            match request.send() {
                Ok(response) => match response.error_for_status() {
                    Ok(response) => return Ok(response),
                    Err(error) => {
                        last_error = format!("抖音视频文件响应失败: {}", error);
                    }
                },
                Err(error) => {
                    last_error = format!("请求抖音视频文件失败: {}", error);
                }
            }
        }
    }

    if last_error.contains("403") {
        Err(format!(
            "{}。该地址被抖音 CDN 拒绝访问，通常需要登录 Cookie 或重新解析后下载；可在左侧 Cookie 中选择浏览器自动读取，或粘贴 douyin.com 的 Cookie。",
            last_error
        ))
    } else {
        Err(last_error)
    }
}

fn download_url_candidates(source: &DouyinDownloadSource) -> Vec<String> {
    let mut values = Vec::new();
    if !source.url.trim().is_empty() {
        values.push(source.url.clone());
    }
    if let Some(preview_url) = source
        .preview_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        values.push(preview_url.to_string());
    }
    dedupe_strings(values)
}

fn referer_candidates(share_url: &str) -> Vec<String> {
    dedupe_strings(vec![
        share_url.to_string(),
        DOUYIN_HOME_REFERER.to_string(),
        DOUYIN_SHARE_REFERER.to_string(),
    ])
}

fn dedupe_strings(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

fn probe_media_source(client: &reqwest::blocking::Client, url: &str, referer: &str) -> MediaProbe {
    match client
        .head(url)
        .header(reqwest::header::USER_AGENT, MOBILE_UA)
        .header(reqwest::header::REFERER, referer)
        .header(reqwest::header::ACCEPT, "*/*")
        .send()
    {
        Ok(response) => {
            let final_url = response.url().as_str().to_string();
            MediaProbe {
                preview_url: if final_url != url {
                    Some(final_url)
                } else {
                    None
                },
                size: response.content_length(),
            }
        }
        Err(_) => MediaProbe::default(),
    }
}

fn douyin_cookie_from_payload(payload: &DouyinCommandPayload) -> Result<Option<String>, String> {
    let mode = payload
        .cookie_mode
        .as_deref()
        .unwrap_or("none")
        .trim()
        .to_lowercase();
    match mode.as_str() {
        "" | "none" => Ok(None),
        "manual" => Ok(payload
            .manual_cookie
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)),
        "chrome" | "edge" | "brave" | "vivaldi" | "opera" => auto_douyin_cookie(&mode).map(Some),
        _ => Err("Cookie 读取方式无效".to_string()),
    }
}

#[cfg(target_os = "windows")]
fn auto_douyin_cookie(browser: &str) -> Result<String, String> {
    let db_paths = chromium_cookie_db_paths(browser);
    if db_paths.is_empty() {
        return Err(format!(
            "没有找到 {} 的 Cookie 数据库。",
            browser_label(browser)
        ));
    }
    let local_state_path = chromium_local_state_path(browser)
        .ok_or_else(|| format!("没有找到 {} 的 Local State 文件。", browser_label(browser)))?;
    let key = chromium_master_key(&local_state_path)?;
    let temp_dir =
        std::env::temp_dir().join(format!("mcstartup-douyin-cookie-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).map_err(|e| format!("创建 Cookie 临时目录失败: {}", e))?;

    let mut cookie_strings = Vec::new();
    let mut errors = Vec::new();
    for (index, db_path) in db_paths.iter().enumerate() {
        let temp_db = temp_dir.join(format!("Cookies-{index}"));
        match fs::copy(db_path, &temp_db) {
            Ok(_) => match read_chromium_douyin_cookie(&temp_db, &key) {
                Ok(cookie) => cookie_strings.push(cookie),
                Err(error) => errors.push(error),
            },
            Err(error) => errors.push(format!("复制 Cookie 数据库失败: {}", error)),
        }
    }
    let _ = fs::remove_dir_all(&temp_dir);
    let merged = merge_cookie_strings(cookie_strings);
    if merged.is_empty() {
        let detail = errors
            .into_iter()
            .next()
            .unwrap_or_else(|| "没有读取到抖音相关 Cookie。".to_string());
        Err(format!(
            "{} 请确认 {} 已登录 douyin.com；如果浏览器正在占用 Cookie 数据库，请关闭浏览器后重试，或改用手动 Cookie。",
            detail,
            browser_label(browser)
        ))
    } else {
        Ok(merged)
    }
}

#[cfg(not(target_os = "windows"))]
fn auto_douyin_cookie(_browser: &str) -> Result<String, String> {
    Err("当前系统暂不支持自动读取浏览器 Cookie，请使用手动 Cookie。".to_string())
}

#[cfg(target_os = "windows")]
fn chromium_cookie_db_paths(browser: &str) -> Vec<PathBuf> {
    let Some(root) = chromium_user_data_dir(browser) else {
        return Vec::new();
    };
    if browser == "opera" {
        let path = root.join(r"Network\Cookies");
        return path.exists().then_some(path).into_iter().collect();
    }
    let mut paths = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if name == "Default" || name.starts_with("Profile ") {
                let cookie_path = path.join(r"Network\Cookies");
                if cookie_path.exists() {
                    paths.push(cookie_path);
                }
            }
        }
    }
    paths
}

#[cfg(target_os = "windows")]
fn chromium_local_state_path(browser: &str) -> Option<PathBuf> {
    let path = chromium_user_data_dir(browser)?.join("Local State");
    path.exists().then_some(path)
}

#[cfg(target_os = "windows")]
fn chromium_user_data_dir(browser: &str) -> Option<PathBuf> {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
    let roaming = std::env::var_os("APPDATA").map(PathBuf::from);
    let path = match browser {
        "chrome" => local.join(r"Google\Chrome\User Data"),
        "edge" => local.join(r"Microsoft\Edge\User Data"),
        "brave" => local.join(r"BraveSoftware\Brave-Browser\User Data"),
        "vivaldi" => local.join(r"Vivaldi\User Data"),
        "opera" => roaming?.join(r"Opera Software\Opera Stable"),
        _ => return None,
    };
    path.exists().then_some(path)
}

#[cfg(target_os = "windows")]
fn chromium_master_key(local_state_path: &Path) -> Result<Vec<u8>, String> {
    let text = fs::read_to_string(local_state_path)
        .map_err(|e| format!("读取浏览器 Local State 失败: {}", e))?;
    let value: Value =
        serde_json::from_str(&text).map_err(|e| format!("解析浏览器 Local State 失败: {}", e))?;
    let encrypted_key = value
        .pointer("/os_crypt/encrypted_key")
        .and_then(Value::as_str)
        .ok_or_else(|| "浏览器 Local State 中没有 encrypted_key。".to_string())?;
    let mut bytes = base64::engine::general_purpose::STANDARD
        .decode(encrypted_key)
        .map_err(|e| format!("解析浏览器 Cookie 密钥失败: {}", e))?;
    if bytes.starts_with(b"DPAPI") {
        bytes.drain(..5);
    }
    dpapi_unprotect(&bytes)
}

#[cfg(target_os = "windows")]
fn read_chromium_douyin_cookie(db_path: &Path, key: &[u8]) -> Result<String, String> {
    let connection = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("打开浏览器 Cookie 数据库失败: {}", e))?;
    let mut statement = connection
        .prepare(
            "SELECT host_key, name, value, encrypted_value FROM cookies \
             WHERE host_key LIKE '%douyin.com' OR host_key LIKE '%iesdouyin.com'",
        )
        .map_err(|e| format!("读取浏览器 Cookie 表失败: {}", e))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2).unwrap_or_default(),
                row.get::<_, Vec<u8>>(3).unwrap_or_default(),
            ))
        })
        .map_err(|e| format!("查询抖音 Cookie 失败: {}", e))?;

    let mut pairs = Vec::new();
    let mut seen = HashSet::new();
    for row in rows {
        let (_host, name, value, encrypted) =
            row.map_err(|e| format!("读取抖音 Cookie 行失败: {}", e))?;
        let cookie_value = if !value.is_empty() {
            value
        } else {
            decrypt_chromium_cookie(&encrypted, key).unwrap_or_default()
        };
        if name.trim().is_empty() || cookie_value.trim().is_empty() {
            continue;
        }
        if seen.insert(name.clone()) {
            pairs.push(format!("{}={}", name, cookie_value));
        }
    }

    if pairs.is_empty() {
        Err(
            "没有读取到抖音相关 Cookie，请确认浏览器已登录 douyin.com，或改用手动 Cookie。"
                .to_string(),
        )
    } else {
        Ok(pairs.join("; "))
    }
}

#[cfg(target_os = "windows")]
fn decrypt_chromium_cookie(encrypted: &[u8], key: &[u8]) -> Result<String, String> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }
    let plain = if encrypted.starts_with(b"v10") || encrypted.starts_with(b"v11") {
        if encrypted.len() < 15 {
            return Err("Cookie 密文长度无效。".to_string());
        }
        let nonce = Nonce::from_slice(&encrypted[3..15]);
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| format!("初始化 Cookie 解密器失败: {}", e))?;
        cipher
            .decrypt(nonce, &encrypted[15..])
            .map_err(|e| format!("解密 Cookie 失败: {}", e))?
    } else {
        dpapi_unprotect(encrypted)?
    };
    String::from_utf8(plain).map_err(|e| format!("Cookie 内容不是 UTF-8: {}", e))
}

fn merge_cookie_strings(values: Vec<String>) -> String {
    let mut seen = HashSet::new();
    let mut pairs = Vec::new();
    for value in values {
        for pair in value
            .split(';')
            .map(str::trim)
            .filter(|item| !item.is_empty())
        {
            let name = pair
                .split_once('=')
                .map(|(name, _)| name.trim())
                .unwrap_or(pair);
            if !name.is_empty() && seen.insert(name.to_string()) {
                pairs.push(pair.to_string());
            }
        }
    }
    pairs.join("; ")
}

#[cfg(target_os = "windows")]
fn dpapi_unprotect(input: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr;
    use winapi::um::dpapi::CryptUnprotectData;
    use winapi::um::winbase::LocalFree;
    use winapi::um::wincrypt::DATA_BLOB;

    let mut input_blob = DATA_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_ptr() as *mut u8,
    };
    let mut output_blob = DATA_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    let success = unsafe {
        CryptUnprotectData(
            &mut input_blob,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            0,
            &mut output_blob,
        )
    };
    if success == 0 {
        return Err("系统 DPAPI 解密浏览器 Cookie 失败。".to_string());
    }
    let result = unsafe {
        std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec()
    };
    unsafe {
        LocalFree(output_blob.pbData as *mut _);
    }
    Ok(result)
}

fn browser_label(browser: &str) -> &str {
    match browser {
        "chrome" => "Chrome",
        "edge" => "Edge",
        "brave" => "Brave",
        "vivaldi" => "Vivaldi",
        "opera" => "Opera",
        _ => "浏览器",
    }
}

fn dedupe_sources(sources: &mut Vec<DouyinDownloadSource>) {
    let mut seen = HashSet::new();
    sources.retain(|item| {
        let key = item
            .preview_url
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(&item.url)
            .to_string();
        seen.insert(key)
    });
    sources.sort_by(|a, b| {
        let rank_a = source_rank(a);
        let rank_b = source_rank(b);
        rank_a
            .cmp(&rank_b)
            .then_with(|| b.height.unwrap_or(0).cmp(&a.height.unwrap_or(0)))
            .then_with(|| b.width.unwrap_or(0).cmp(&a.width.unwrap_or(0)))
            .then_with(|| b.bitrate.unwrap_or(0).cmp(&a.bitrate.unwrap_or(0)))
            .then_with(|| b.size.unwrap_or(0).cmp(&a.size.unwrap_or(0)))
    });
}

fn source_rank(source: &DouyinDownloadSource) -> u8 {
    match source.source_type.as_str() {
        "quality" => 0,
        "fallback" => 1,
        _ => 2,
    }
}

fn build_file_name(info: &DouyinVideoInfo, source: &DouyinDownloadSource) -> String {
    let title = sanitize_file_name(&info.title);
    let author = info
        .author
        .as_deref()
        .map(sanitize_file_name)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "douyin".to_string());
    let label = sanitize_file_name(&source.label);
    format!("{} - {} [{} {}].mp4", author, title, info.video_id, label)
}

fn sanitize_file_name(value: &str) -> String {
    let mut result = value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            ch if ch.is_control() => ' ',
            ch => ch,
        })
        .collect::<String>();
    while result.contains("  ") {
        result = result.replace("  ", " ");
    }
    let trimmed = result.trim().trim_matches('.').to_string();
    let shortened: String = trimmed.chars().take(80).collect();
    if shortened.is_empty() {
        "douyin-video".to_string()
    } else {
        shortened
    }
}

fn unique_output_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let parent = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(PathBuf::new);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("video")
        .to_string();
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp4");
    for index in 1..10_000 {
        let candidate = parent.join(format!("{} ({index}).{}", stem, ext));
        if !candidate.exists() {
            return candidate;
        }
    }
    path
}

fn json_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn json_string_at_path(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn string_at_path(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    if let Some(value) = current.as_str() {
        return Some(value.trim().to_string()).filter(|value| !value.is_empty());
    }
    current.as_array()?.iter().find_map(|item| {
        item.as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
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

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .connect_timeout(std::time::Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent(BROWSER_UA)
        .build()
        .map_err(|e| format!("初始化抖音请求客户端失败: {}", e))
}

fn cancelled_tasks() -> &'static Mutex<HashSet<String>> {
    DOUYIN_CANCELLED_TASKS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn mark_cancelled(task_id: &str, cancelled: bool) {
    let mut guard = cancelled_tasks().lock().unwrap();
    if cancelled {
        guard.insert(task_id.to_string());
    } else {
        guard.remove(task_id);
    }
}

fn is_cancelled(task_id: &str) -> bool {
    cancelled_tasks().lock().unwrap().contains(task_id)
}

fn take_cancelled(task_id: &str) -> bool {
    cancelled_tasks().lock().unwrap().remove(task_id)
}

fn emit_progress(app_handle: &AppHandle, progress: DouyinDownloadProgress) {
    let _ = app_handle.emit_all("douyin-download-progress", progress);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_video_item_when_route_key_contains_slash() {
        let value = serde_json::json!({
            "loaderData": {
                "video_(id)/page": {
                    "videoInfoRes": {
                        "item_list": [{
                            "aweme_id": "7634174387473681716",
                            "desc": "demo",
                            "video": {
                                "play_addr": {
                                    "uri": "v0200",
                                    "url_list": ["https://aweme.snssdk.com/aweme/v1/playwm/?video_id=v0200"]
                                }
                            }
                        }]
                    }
                }
            }
        });
        let item = find_video_item(&value).expect("video item");
        assert_eq!(
            json_string(item, "aweme_id").as_deref(),
            Some("7634174387473681716")
        );
    }
}
