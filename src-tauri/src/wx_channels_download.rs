use crate::media_convert::find_ffmpeg_binary;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use std::thread;
use std::time::Duration;
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const DEFAULT_CAPTURE_BRIDGE_PORT: u16 = 2024;
const INTERNAL_COMPONENT_VERSION: &str = "page-capture-1";
const WX_DECRYPT_PREFIX_LEN: usize = 128 * 1024;

static CAPTURE_BRIDGE: OnceLock<Mutex<Option<Arc<CaptureBridge>>>> = OnceLock::new();
static LOCAL_TASKS: OnceLock<Mutex<HashMap<String, WxLocalTask>>> = OnceLock::new();

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WxChannelsPayload {
    output_dir: Option<String>,
    task_id: Option<String>,
    task_action: Option<String>,
    url: Option<String>,
    spec: Option<String>,
    mp3: Option<bool>,
    cover: Option<bool>,
    media: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WxChannelsStatus {
    ready: bool,
    version: String,
    captures_available: bool,
    capture_bridge_running: bool,
    running: bool,
    default_output_dir: String,
    message: String,
}

#[derive(Debug)]
struct CaptureBridge {
    port: u16,
    captures: Mutex<Vec<Value>>,
    shutdown: AtomicBool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WxLocalTask {
    id: String,
    name: String,
    status: String,
    output_path: String,
    url: String,
    title: String,
    spec: String,
    suffix: String,
    downloaded: u64,
    total: Option<u64>,
    message: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug)]
struct WxDirectSource {
    title: String,
    url: String,
    key: u64,
    spec: String,
    suffix: String,
    output_path: PathBuf,
    is_cover: bool,
    is_mp3: bool,
}

#[tauri::command]
pub async fn wx_channels_download_command(
    app_handle: tauri::AppHandle,
    action: String,
    payload: String,
) -> Result<String, String> {
    let payload: WxChannelsPayload = if payload.trim().is_empty() {
        WxChannelsPayload::default()
    } else {
        serde_json::from_str(&payload).map_err(|e| format!("解析微信视频下载参数失败: {}", e))?
    };

    tauri::async_runtime::spawn_blocking(move || command_impl(app_handle, &action, payload))
        .await
        .map_err(|e| format!("微信视频下载任务执行失败: {}", e))?
}

fn command_impl(
    app_handle: tauri::AppHandle,
    action: &str,
    payload: WxChannelsPayload,
) -> Result<String, String> {
    match action {
        "check" => json_response(check_status()),
        "ensure" => {
            ensure_internal_ready()?;
            json_response(check_status())
        }
        "tasks" => json_response(fetch_task_list()),
        "createDownloadTask" => {
            create_download_task(&payload)?;
            json_response(serde_json::json!({ "ok": true }))
        }
        "captures" => json_response(fetch_captures()),
        "openCaptureWindow" => {
            open_capture_window(&app_handle, &payload)?;
            json_response(serde_json::json!({ "ok": true }))
        }
        "clearCaptures" => {
            clear_captures();
            json_response(serde_json::json!({ "ok": true }))
        }
        "shutdown" => {
            shutdown_capture_bridge(&app_handle);
            json_response(serde_json::json!({ "ok": true }))
        }
        "taskAction" => {
            task_action(payload)?;
            json_response(serde_json::json!({ "ok": true }))
        }
        "openDownloadDir" => {
            open_download_dir(&payload)?;
            json_response(serde_json::json!({ "ok": true }))
        }
        "defaultDir" => json_response(default_output_dir()),
        _ => Err("未知微信视频下载动作".to_string()),
    }
}

fn json_response<T: Serialize>(value: T) -> Result<String, String> {
    serde_json::to_string(&value).map_err(|e| format!("序列化微信视频下载响应失败: {}", e))
}

fn default_output_dir() -> String {
    dirs::download_dir()
        .or_else(dirs::video_dir)
        .or_else(dirs::desktop_dir)
        .unwrap_or_else(std::env::temp_dir)
        .to_string_lossy()
        .to_string()
}

fn check_status() -> WxChannelsStatus {
    let capture_bridge = current_capture_bridge();
    let capture_bridge_running = capture_bridge.is_some();
    let captures_available = capture_bridge
        .as_ref()
        .and_then(|bridge| bridge.captures.lock().ok().map(|items| !items.is_empty()))
        .unwrap_or(false);
    let message = if capture_bridge_running && captures_available {
        "已捕获作品信息，可以创建下载任务。".to_string()
    } else if capture_bridge_running {
        "捕获模块已就绪。粘贴视频号链接后打开页面，等待作品加载即可捕获。".to_string()
    } else {
        "捕获模块暂未启动。".to_string()
    };

    WxChannelsStatus {
        ready: capture_bridge_running,
        version: INTERNAL_COMPONENT_VERSION.to_string(),
        captures_available,
        capture_bridge_running,
        running: capture_bridge_running,
        default_output_dir: default_output_dir(),
        message,
    }
}

fn ensure_internal_ready() -> Result<(), String> {
    ensure_capture_bridge().map(|_| ())
}

fn fetch_task_list() -> Value {
    let mut list = local_task_list();
    list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    serde_json::json!({
        "code": 0,
        "msg": "ok",
        "data": {
            "list": list.into_iter().map(local_task_to_view).collect::<Vec<_>>()
        }
    })
}

fn open_capture_window(
    app_handle: &tauri::AppHandle,
    payload: &WxChannelsPayload,
) -> Result<(), String> {
    let bridge = ensure_capture_bridge()?;
    let target_url = resolve_capture_window_url(payload)?;
    let script = capture_window_script(bridge.port);
    if let Some(window) = app_handle.get_window("wx-channels-capture") {
        window
            .eval(&format!(
                "window.location.href = {};",
                serde_json::to_string(&target_url)
                    .unwrap_or_else(|_| "\"https://channels.weixin.qq.com/\"".to_string())
            ))
            .map_err(|e| format!("切换内置捕获窗口失败: {}", e))?;
        window
            .set_focus()
            .map_err(|e| format!("聚焦内置捕获窗口失败: {}", e))?;
        return Ok(());
    }
    let external = target_url
        .parse()
        .map_err(|e| format!("微信视频号捕获窗口地址无效: {}", e))?;
    tauri::WindowBuilder::new(
        app_handle,
        "wx-channels-capture",
        tauri::WindowUrl::External(external),
    )
    .title("McStartUP 微信视频号内置捕获")
    .inner_size(1180.0, 820.0)
    .resizable(true)
    .initialization_script(&script)
    .build()
    .map_err(|e| format!("打开内置微信视频号捕获窗口失败: {}", e))?;
    Ok(())
}

fn resolve_capture_window_url(payload: &WxChannelsPayload) -> Result<String, String> {
    let url =
        trimmed_opt(&payload.url).unwrap_or_else(|| "https://channels.weixin.qq.com/".to_string());
    let extracted = extract_first_http_url(&url).unwrap_or(url);
    let parsed =
        reqwest::Url::parse(&extracted).map_err(|e| format!("微信视频号链接无效: {}", e))?;
    let host = parsed.host_str().unwrap_or_default();
    if host.ends_with("weixin.qq.com") || host.ends_with("qq.com") {
        Ok(parsed.to_string())
    } else {
        Err("请使用微信视频号页面链接。".to_string())
    }
}

fn extract_first_http_url(text: &str) -> Option<String> {
    let start = text.find("https://").or_else(|| text.find("http://"))?;
    let tail = &text[start..];
    let end = tail
        .find(|ch: char| {
            ch.is_whitespace() || matches!(ch, '"' | '\'' | '<' | '>' | '，' | '。' | '；' | '、')
        })
        .unwrap_or(tail.len());
    Some(tail[..end].trim().to_string()).filter(|value| !value.is_empty())
}

fn capture_window_script(bridge_port: u16) -> String {
    format!(
        r#"
(function () {{
  if (window.__mcstartup_wx_capture_installed__) return;
  window.__mcstartup_wx_capture_installed__ = true;
  var bridgeUrl = "http://127.0.0.1:{bridge_port}/capture";
  function textOf(value) {{
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return "";
  }}
  function firstObject(value) {{
    if (!value || typeof value !== "object") return null;
    if (value.object && typeof value.object === "object") return value.object;
    if (value.data && typeof value.data === "object") {{
      if (value.data.object && typeof value.data.object === "object") return value.data.object;
      if (Array.isArray(value.data.object) && value.data.object[0]) return value.data.object[0];
    }}
    if (Array.isArray(value.object) && value.object[0]) return value.object[0];
    return null;
  }}
  function directMediaUrl(media) {{
    return textOf(media && media.url) + textOf(media && media.urlToken);
  }}
  function formatFeed(feed, source) {{
    try {{
      if (!feed || typeof feed !== "object") return null;
      var desc = feed.objectDesc || {{}};
      var mediaList = Array.isArray(desc.media) ? desc.media : [];
      var media = mediaList[0] || {{}};
      var mediaType = Number(desc.mediaType || 0);
      if (mediaType !== 4 && !media.url && !media.urlToken) return null;
      var contact = feed.contact || feed.anchorContact || {{}};
      var id = textOf(feed.id || feed.objectId || feed.objectid);
      var title = textOf(desc.description || feed.description || id || document.title || "微信视频");
      var url = directMediaUrl(media);
      if (!url) return null;
      return {{
        type: "media",
        id: id,
        nonce_id: textOf(feed.objectNonceId || feed.objectNonceID || feed.nonceId),
        source_url: source || location.href,
        title: title,
        url: url,
        key: Number(media.decodeKey || 0),
        cover_url: textOf(media.coverUrl || media.cover_url),
        createtime: feed.createtime || feed.createTime || null,
        spec: Array.isArray(media.spec) ? media.spec : [],
        size: Number(media.fileSize || 0),
        duration: Number(media.videoPlayLen || 0),
        contact: {{
          id: textOf(contact.username || contact.id),
          avatar_url: textOf(contact.headUrl || contact.avatar_url),
          nickname: textOf(contact.nickname || contact.name)
        }},
        captured_at: new Date().toISOString()
      }};
    }} catch (err) {{
      return null;
    }}
  }}
  function postProfile(profile) {{
    if (!profile || !profile.url) return;
    try {{
      fetch(bridgeUrl, {{
        method: "POST",
        mode: "no-cors",
        headers: {{ "Content-Type": "text/plain" }},
        body: JSON.stringify(profile)
      }}).catch(function () {{}});
    }} catch (err) {{}}
  }}
  function inspectJson(value, source) {{
    try {{
      var object = firstObject(value);
      if (object) {{
        postProfile(formatFeed(object, source));
      }}
      if (value && value.objectDesc) {{
        postProfile(formatFeed(value, source));
      }}
      if (value && value.data && Array.isArray(value.data.object)) {{
        value.data.object.forEach(function (item) {{
          postProfile(formatFeed(item, source));
        }});
      }}
    }} catch (err) {{}}
  }}
  var oldFetch = window.fetch;
  if (typeof oldFetch === "function") {{
    window.fetch = function () {{
      var requestUrl = "";
      try {{
        requestUrl = typeof arguments[0] === "string" ? arguments[0] : arguments[0] && arguments[0].url || "";
      }} catch (err) {{}}
      return oldFetch.apply(this, arguments).then(function (response) {{
        try {{
          var contentType = response.headers && response.headers.get && response.headers.get("content-type") || "";
          if (contentType.indexOf("json") !== -1 || /finder|comment|feed|profile|object/i.test(requestUrl)) {{
            response.clone().json().then(function (json) {{
              inspectJson(json, requestUrl || location.href);
            }}).catch(function () {{}});
          }}
        }} catch (err) {{}}
        return response;
      }});
    }};
  }}
  var oldOpen = XMLHttpRequest.prototype.open;
  var oldSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {{
    this.__mcstartup_wx_url__ = url;
    return oldOpen.apply(this, arguments);
  }};
  XMLHttpRequest.prototype.send = function () {{
    this.addEventListener("load", function () {{
      try {{
        var url = this.__mcstartup_wx_url__ || "";
        var text = this.responseText || "";
        if (text && /finder|comment|feed|profile|object/i.test(url + " " + text.slice(0, 300))) {{
          inspectJson(JSON.parse(text), url || location.href);
        }}
      }} catch (err) {{}}
    }});
    return oldSend.apply(this, arguments);
  }};
  var seenVideo = "";
  setInterval(function () {{
    try {{
      var video = document.querySelector("video");
      if (video && video.currentSrc && video.currentSrc !== seenVideo) {{
        seenVideo = video.currentSrc;
        postProfile({{
          type: "media",
          id: "video-" + Date.now(),
          nonce_id: "",
          source_url: location.href,
          title: document.title || "微信视频",
          url: video.currentSrc,
          key: 0,
          cover_url: textOf(video.poster),
          spec: [],
          size: 0,
          duration: Number(video.duration || 0),
          contact: {{}},
          captured_at: new Date().toISOString()
        }});
      }}
    }} catch (err) {{}}
  }}, 1500);
}})();
"#,
        bridge_port = bridge_port
    )
}

fn create_download_task(payload: &WxChannelsPayload) -> Result<(), String> {
    let source = build_direct_source(payload)?;
    let task_id = format!(
        "wx-local-{}-{}",
        chrono::Utc::now().timestamp_millis(),
        uuid::Uuid::new_v4()
    );
    let task = WxLocalTask {
        id: task_id.clone(),
        name: source
            .output_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("wx-video.mp4")
            .to_string(),
        status: "waiting".to_string(),
        output_path: source.output_path.to_string_lossy().to_string(),
        url: source.url.clone(),
        title: source.title.clone(),
        spec: source.spec.clone(),
        suffix: source.suffix.clone(),
        downloaded: 0,
        total: None,
        message: Some("等待下载".to_string()),
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    upsert_local_task(task);
    thread::spawn(move || {
        if let Err(err) = run_direct_download(&task_id, source) {
            let message = Some(err);
            update_local_task(&task_id, |task| {
                task.status = "error".to_string();
                task.message = message.clone();
            });
        }
    });
    Ok(())
}

fn fetch_captures() -> Value {
    let captures = current_capture_bridge()
        .and_then(|bridge| bridge.captures.lock().ok().map(|items| items.clone()))
        .unwrap_or_default();
    serde_json::json!({
        "list": captures,
    })
}

fn clear_captures() {
    if let Some(bridge) = current_capture_bridge() {
        if let Ok(mut captures) = bridge.captures.lock() {
            captures.clear();
        }
    }
}

fn task_action(payload: WxChannelsPayload) -> Result<(), String> {
    let action = payload
        .task_action
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少任务操作".to_string())?;
    if action == "clear" {
        clear_local_tasks();
        return Ok(());
    }
    if !matches!(action, "start" | "pause" | "resume" | "delete") {
        return Err("不支持的任务操作".to_string());
    }
    let task_id = payload
        .task_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少任务 ID".to_string())?;
    if action == "delete" {
        remove_local_task(&task_id);
        return Ok(());
    }
    if action == "start" || action == "resume" {
        update_local_task(&task_id, |task| {
            if task.status != "done" {
                task.message = Some("任务已由内置下载器接管，进行中的下载会自动完成。".to_string());
            }
        });
        return Ok(());
    }
    if action == "pause" {
        update_local_task(&task_id, |task| {
            if task.status == "downloading" {
                task.message = Some("当前内置下载暂不支持暂停，后续会补齐断点续传。".to_string());
            }
        });
    }
    Ok(())
}

fn local_tasks() -> &'static Mutex<HashMap<String, WxLocalTask>> {
    LOCAL_TASKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn local_task_list() -> Vec<WxLocalTask> {
    local_tasks()
        .lock()
        .map(|tasks| tasks.values().cloned().collect())
        .unwrap_or_default()
}

fn upsert_local_task(task: WxLocalTask) {
    if let Ok(mut tasks) = local_tasks().lock() {
        tasks.insert(task.id.clone(), task);
    }
}

fn update_local_task<F>(task_id: &str, mut update: F)
where
    F: FnMut(&mut WxLocalTask),
{
    if let Ok(mut tasks) = local_tasks().lock() {
        if let Some(task) = tasks.get_mut(task_id) {
            update(task);
            task.updated_at = chrono::Utc::now().to_rfc3339();
        }
    }
}

fn remove_local_task(task_id: &str) {
    if let Ok(mut tasks) = local_tasks().lock() {
        tasks.remove(task_id);
    }
}

fn clear_local_tasks() {
    if let Ok(mut tasks) = local_tasks().lock() {
        tasks.clear();
    }
}

fn local_task_to_view(task: WxLocalTask) -> Value {
    serde_json::json!({
        "id": task.id,
        "status": task.status,
        "name": task.name,
        "progress": {
            "downloaded": task.downloaded,
            "total": task.total.unwrap_or(0),
        },
        "meta": {
            "id": task.id,
            "opts": {
                "name": task.name,
                "path": task.output_path,
            },
            "req": {
                "url": task.url,
                "labels": {
                    "title": task.title,
                    "spec": task.spec,
                    "suffix": task.suffix,
                }
            },
            "res": {
                "size": task.total.unwrap_or(task.downloaded),
            }
        },
        "message": task.message,
    })
}

fn build_direct_source(payload: &WxChannelsPayload) -> Result<WxDirectSource, String> {
    let media = payload
        .media
        .as_ref()
        .ok_or_else(|| "缺少已捕获的微信视频详情，请先从捕获结果里选择下载。".to_string())?;
    let is_cover = payload.cover.unwrap_or(false);
    let is_mp3 = payload.mp3.unwrap_or(false);
    let spec = trimmed_opt(&payload.spec).unwrap_or_default();
    let title = json_string(media, &["title"])
        .or_else(|| json_string(media, &["objectDesc", "description"]))
        .or_else(|| json_string(media, &["id"]))
        .unwrap_or_else(|| "微信视频".to_string());
    let id = json_string(media, &["id"])
        .unwrap_or_else(|| format!("wx-{}", chrono::Utc::now().timestamp()));
    let author = json_string(media, &["contact", "nickname"]);
    let key = json_u64(media, &["key"])
        .or_else(|| json_u64(media, &["decodeKey"]))
        .unwrap_or(0);
    let mut source_url = if is_cover {
        json_string(media, &["cover_url"])
            .or_else(|| json_string(media, &["coverUrl"]))
            .ok_or_else(|| "当前捕获结果里没有封面地址。".to_string())?
    } else {
        json_string(media, &["url"])
            .or_else(|| {
                let media_item = media
                    .pointer("/objectDesc/media/0")
                    .or_else(|| media.pointer("/media/0"))?;
                let url = media_item.get("url").and_then(Value::as_str)?;
                let token = media_item
                    .get("urlToken")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                Some(format!("{}{}", url, token))
            })
            .ok_or_else(|| {
                "当前捕获结果里没有可下载的视频地址，请刷新微信视频号页面后重新捕获。".to_string()
            })?
    };

    if is_cover {
        source_url = source_url.replacen("http://", "https://", 1);
    } else if !spec.is_empty() {
        source_url = append_query_param(&source_url, "X-snsvideoflag", &spec);
    } else {
        source_url = normalize_original_video_url(&source_url);
    }

    let suffix = if is_cover {
        guess_image_suffix(&source_url)
    } else if is_mp3 {
        ".mp3".to_string()
    } else {
        ".mp4".to_string()
    };
    let output_dir = payload
        .output_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(default_output_dir()));
    fs::create_dir_all(&output_dir).map_err(|e| format!("创建下载目录失败: {}", e))?;
    let mut stem = sanitize_file_name(&format_file_stem(&title, author.as_deref(), &spec));
    if stem.is_empty() {
        stem = sanitize_file_name(&id);
    }
    let output_path = unique_path(output_dir.join(format!("{}{}", stem, suffix)));
    Ok(WxDirectSource {
        title,
        url: source_url,
        key,
        spec,
        suffix,
        output_path,
        is_cover,
        is_mp3,
    })
}

fn run_direct_download(task_id: &str, source: WxDirectSource) -> Result<(), String> {
    update_local_task(task_id, |task| {
        task.status = "downloading".to_string();
        task.message = Some("开始下载".to_string());
    });

    let temp_path = source.output_path.with_extension(format!(
        "{}download",
        source
            .output_path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| format!("{}.", value))
            .unwrap_or_default()
    ));
    download_to_file(task_id, &source, &temp_path)?;
    if !source.is_cover && source.key != 0 {
        decrypt_file_prefix(&temp_path, source.key)?;
    }
    if source.is_mp3 {
        convert_to_mp3(&temp_path, &source.output_path)?;
        let _ = fs::remove_file(&temp_path);
    } else {
        fs::rename(&temp_path, &source.output_path)
            .or_else(|_| {
                fs::copy(&temp_path, &source.output_path)?;
                fs::remove_file(&temp_path)
            })
            .map_err(|e| format!("保存微信视频下载文件失败: {}", e))?;
    }
    let size = fs::metadata(&source.output_path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    update_local_task(task_id, |task| {
        task.status = "done".to_string();
        task.downloaded = size;
        task.total = Some(size);
        task.output_path = source.output_path.to_string_lossy().to_string();
        task.message = Some("下载完成".to_string());
    });
    Ok(())
}

fn download_to_file(task_id: &str, source: &WxDirectSource, target: &Path) -> Result<(), String> {
    let client = local_client_with_timeout(Duration::from_secs(300))?;
    let mut response = client
        .get(&source.url)
        .header(reqwest::header::USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
        .header(reqwest::header::REFERER, "https://channels.weixin.qq.com/")
        .send()
        .map_err(|e| format!("下载微信视频失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("微信视频下载响应失败: {}", e))?;
    let total = response.content_length();
    let mut file = File::create(target).map_err(|e| format!("创建下载文件失败: {}", e))?;
    let mut downloaded = 0u64;
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|e| format!("读取微信视频数据失败: {}", e))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|e| format!("写入微信视频文件失败: {}", e))?;
        downloaded += read as u64;
        update_local_task(task_id, |task| {
            task.downloaded = downloaded;
            task.total = total;
            task.message = None;
        });
    }
    file.flush()
        .map_err(|e| format!("保存微信视频文件失败: {}", e))
}

fn decrypt_file_prefix(path: &Path, key: u64) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| format!("打开待解密视频失败: {}", e))?;
    let mut data = vec![0u8; WX_DECRYPT_PREFIX_LEN];
    let read = file
        .read(&mut data)
        .map_err(|e| format!("读取待解密视频失败: {}", e))?;
    data.truncate(read);
    decrypt_wx_data(&mut data, key);
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("定位待解密视频失败: {}", e))?;
    file.write_all(&data)
        .map_err(|e| format!("写入解密视频失败: {}", e))
}

fn convert_to_mp3(input: &Path, output: &Path) -> Result<(), String> {
    let ffmpeg = find_ffmpeg_binary().ok_or_else(|| "下载 MP3 需要先安装 FFmpeg。".to_string())?;
    let mut command = Command::new(ffmpeg);
    command
        .args(["-y", "-i"])
        .arg(input)
        .args(["-vn", "-acodec", "libmp3lame", "-ab", "192k", "-f", "mp3"])
        .arg(output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let output_result = command
        .output()
        .map_err(|e| format!("启动 FFmpeg 转 MP3 失败: {}", e))?;
    if output_result.status.success() {
        return Ok(());
    }
    Err(command_output_error(
        "FFmpeg 转 MP3 失败",
        &output_result.stderr,
    ))
}

fn json_string(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    match current {
        Value::String(text) => Some(text.trim().to_string()).filter(|text| !text.is_empty()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn json_u64(value: &Value, path: &[&str]) -> Option<u64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_u64()
        .or_else(|| current.as_str().and_then(|text| text.parse::<u64>().ok()))
}

fn append_query_param(url: &str, key: &str, value: &str) -> String {
    let sep = if url.contains('?') { "&" } else { "?" };
    format!("{}{}{}={}", url, sep, key, urlencoding::encode(value))
}

fn normalize_original_video_url(url: &str) -> String {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return url.to_string();
    };
    let encfilekey = parsed
        .query_pairs()
        .find(|(key, _)| key == "encfilekey")
        .map(|(_, value)| value.to_string());
    let token = parsed
        .query_pairs()
        .find(|(key, _)| key == "token")
        .map(|(_, value)| value.to_string());
    match (encfilekey, token) {
        (Some(encfilekey), Some(token)) => {
            let mut clean = parsed.clone();
            clean.set_query(None);
            clean
                .query_pairs_mut()
                .append_pair("encfilekey", &encfilekey)
                .append_pair("token", &token);
            clean.to_string()
        }
        _ => url.to_string(),
    }
}

fn format_file_stem(title: &str, author: Option<&str>, spec: &str) -> String {
    let mut parts = Vec::new();
    if let Some(author) = author.filter(|value| !value.trim().is_empty()) {
        parts.push(author.trim().to_string());
    }
    parts.push(title.trim().to_string());
    if !spec.trim().is_empty() {
        parts.push(spec.trim().to_string());
    }
    parts.join("_")
}

fn sanitize_file_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .chars()
        .take(120)
        .collect()
}

fn unique_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let parent = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    for index in 1..1000 {
        let name = if ext.is_empty() {
            format!("{} ({})", stem, index)
        } else {
            format!("{} ({}).{}", stem, index, ext)
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    path
}

fn guess_image_suffix(url: &str) -> String {
    let lower = url.to_ascii_lowercase();
    if lower.contains(".webp") {
        ".webp".to_string()
    } else if lower.contains(".png") {
        ".png".to_string()
    } else {
        ".jpg".to_string()
    }
}

fn decrypt_wx_data(data: &mut [u8], key: u64) {
    if data.is_empty() {
        return;
    }
    let mut ctx = Isaac64::new(key);
    let limit = data.len().min(WX_DECRYPT_PREFIX_LEN);
    let mut index = 0usize;
    while index < limit {
        let rand = ctx.random().to_be_bytes();
        for byte in rand {
            if index >= limit {
                break;
            }
            data[index] ^= byte;
            index += 1;
        }
    }
}

struct Isaac64 {
    rand_cnt: usize,
    seed: [u64; 256],
    mm: [u64; 256],
    aa: u64,
    bb: u64,
    cc: u64,
}

impl Isaac64 {
    fn new(key: u64) -> Self {
        let mut ctx = Self {
            rand_cnt: 255,
            seed: [0; 256],
            mm: [0; 256],
            aa: 0,
            bb: 0,
            cc: 0,
        };
        ctx.seed[0] = key;
        ctx.init();
        ctx
    }

    fn init(&mut self) {
        const GOLDEN: u64 = 0x9e3779b97f4a7c13;
        let mut values = [GOLDEN; 8];
        for _ in 0..4 {
            isaac_mix(&mut values);
        }
        for i in (0..256).step_by(8) {
            for j in 0..8 {
                values[j] = values[j].wrapping_add(self.seed[i + j]);
            }
            isaac_mix(&mut values);
            self.mm[i..i + 8].copy_from_slice(&values);
        }
        for i in (0..256).step_by(8) {
            for j in 0..8 {
                values[j] = values[j].wrapping_add(self.mm[i + j]);
            }
            isaac_mix(&mut values);
            self.mm[i..i + 8].copy_from_slice(&values);
        }
        self.generate();
    }

    fn random(&mut self) -> u64 {
        let result = self.seed[self.rand_cnt];
        if self.rand_cnt == 0 {
            self.generate();
            self.rand_cnt = 255;
        } else {
            self.rand_cnt -= 1;
        }
        result
    }

    fn generate(&mut self) {
        self.cc = self.cc.wrapping_add(1);
        self.bb = self.bb.wrapping_add(self.cc);
        for i in 0..256 {
            self.aa = match i % 4 {
                0 => !(self.aa ^ self.aa.wrapping_shl(21)),
                1 => self.aa ^ (self.aa >> 5),
                2 => self.aa ^ self.aa.wrapping_shl(12),
                _ => self.aa ^ (self.aa >> 33),
            };
            self.aa = self.aa.wrapping_add(self.mm[(i + 128) % 256]);
            let x = self.mm[i];
            let y = self.mm[((x >> 3) as usize) % 256]
                .wrapping_add(self.aa)
                .wrapping_add(self.bb);
            self.mm[i] = y;
            self.bb = self.mm[((y >> 11) as usize) % 256].wrapping_add(x);
            self.seed[i] = self.bb;
        }
    }
}

fn isaac_mix(values: &mut [u64; 8]) {
    values[0] = values[0].wrapping_sub(values[4]);
    values[5] ^= values[7] >> 9;
    values[7] = values[7].wrapping_add(values[0]);
    values[1] = values[1].wrapping_sub(values[5]);
    values[6] ^= values[0].wrapping_shl(9);
    values[0] = values[0].wrapping_add(values[1]);
    values[2] = values[2].wrapping_sub(values[6]);
    values[7] ^= values[1] >> 23;
    values[1] = values[1].wrapping_add(values[2]);
    values[3] = values[3].wrapping_sub(values[7]);
    values[0] ^= values[2].wrapping_shl(15);
    values[2] = values[2].wrapping_add(values[3]);
    values[4] = values[4].wrapping_sub(values[0]);
    values[1] ^= values[3] >> 14;
    values[3] = values[3].wrapping_add(values[4]);
    values[5] = values[5].wrapping_sub(values[1]);
    values[2] ^= values[4].wrapping_shl(20);
    values[4] = values[4].wrapping_add(values[5]);
    values[6] = values[6].wrapping_sub(values[2]);
    values[3] ^= values[5] >> 17;
    values[5] = values[5].wrapping_add(values[6]);
    values[7] = values[7].wrapping_sub(values[3]);
    values[4] ^= values[6].wrapping_shl(14);
    values[6] = values[6].wrapping_add(values[7]);
}

fn trimmed_opt(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn capture_bridge_slot() -> &'static Mutex<Option<Arc<CaptureBridge>>> {
    CAPTURE_BRIDGE.get_or_init(|| Mutex::new(None))
}

fn current_capture_bridge() -> Option<Arc<CaptureBridge>> {
    capture_bridge_slot()
        .lock()
        .ok()
        .and_then(|bridge| bridge.clone())
}

fn ensure_capture_bridge() -> Result<Arc<CaptureBridge>, String> {
    {
        let slot = capture_bridge_slot()
            .lock()
            .map_err(|_| "读取微信视频页面捕获状态失败。".to_string())?;
        if let Some(bridge) = slot.as_ref() {
            return Ok(bridge.clone());
        }
    }

    let listener = TcpListener::bind(("127.0.0.1", DEFAULT_CAPTURE_BRIDGE_PORT))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
        .map_err(|e| format!("启动微信视频页面捕获失败: {}", e))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("设置微信视频页面捕获通道失败: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("读取微信视频页面捕获通道失败: {}", e))?
        .port();
    let bridge = Arc::new(CaptureBridge {
        port,
        captures: Mutex::new(Vec::new()),
        shutdown: AtomicBool::new(false),
    });
    let bridge_for_thread = bridge.clone();
    thread::Builder::new()
        .name("wx-capture-bridge".to_string())
        .spawn(move || {
            while !bridge_for_thread.shutdown.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => handle_capture_bridge_connection(stream, &bridge_for_thread),
                    Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(80));
                    }
                    Err(_) => break,
                }
            }
        })
        .map_err(|e| format!("启动微信视频页面捕获线程失败: {}", e))?;
    let mut slot = capture_bridge_slot()
        .lock()
        .map_err(|_| "保存微信视频页面捕获状态失败。".to_string())?;
    if let Some(existing) = slot.as_ref() {
        bridge.shutdown.store(true, Ordering::SeqCst);
        return Ok(existing.clone());
    }
    *slot = Some(bridge.clone());
    Ok(bridge)
}

fn shutdown_capture_bridge(app_handle: &tauri::AppHandle) {
    if let Ok(mut slot) = capture_bridge_slot().lock() {
        if let Some(bridge) = slot.take() {
            bridge.shutdown.store(true, Ordering::SeqCst);
            if let Ok(mut captures) = bridge.captures.lock() {
                captures.clear();
            }
        }
    }
    if let Some(window) = app_handle.get_window("wx-channels-capture") {
        let _ = window.close();
    }
}

pub fn shutdown_wx_channels_runtime(app_handle: &tauri::AppHandle) {
    shutdown_capture_bridge(app_handle);
}

fn handle_capture_bridge_connection(mut stream: TcpStream, bridge: &Arc<CaptureBridge>) {
    let Some((head, body)) = read_http_request(&mut stream) else {
        return;
    };
    let first_line = head.lines().next().unwrap_or_default();
    let is_options = first_line.starts_with("OPTIONS ");
    let is_capture = first_line.starts_with("POST /capture ");

    if is_capture {
        if let Ok(mut value) = serde_json::from_str::<Value>(body.trim()) {
            if let Value::Object(map) = &mut value {
                map.entry("received_at".to_string())
                    .or_insert_with(|| Value::String(chrono::Utc::now().to_rfc3339()));
            }
            if let Ok(mut captures) = bridge.captures.lock() {
                let key = capture_key(&value);
                captures.retain(|item| capture_key(item) != key);
                captures.insert(0, value);
                if captures.len() > 100 {
                    captures.truncate(100);
                }
            }
        }
    }

    let status = if is_capture || is_options {
        "HTTP/1.1 200 OK"
    } else {
        "HTTP/1.1 404 Not Found"
    };
    let body = if is_capture || is_options {
        "{}"
    } else {
        "{\"error\":\"not found\"}"
    };
    let response = format!(
        "{status}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn read_http_request(stream: &mut TcpStream) -> Option<(String, String)> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut data = Vec::new();
    let mut header_end = None;
    let mut content_length = 0usize;
    let mut chunk = [0u8; 4096];

    loop {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            break;
        }
        data.extend_from_slice(&chunk[..read]);
        if header_end.is_none() {
            if let Some(pos) = find_header_end(&data) {
                header_end = Some(pos);
                let head = String::from_utf8_lossy(&data[..pos]).to_string();
                content_length = parse_content_length(&head);
            }
        }
        if let Some(pos) = header_end {
            let body_start = pos + 4;
            if data.len() >= body_start + content_length {
                break;
            }
        }
        if data.len() > 1024 * 1024 {
            return None;
        }
    }

    let pos = header_end?;
    let body_start = pos + 4;
    let head = String::from_utf8_lossy(&data[..pos]).to_string();
    let body_end = (body_start + content_length).min(data.len());
    let body = String::from_utf8_lossy(&data[body_start..body_end]).to_string();
    Some((head, body))
}

fn find_header_end(data: &[u8]) -> Option<usize> {
    data.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_content_length(head: &str) -> usize {
    head.lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0)
}

fn capture_key(value: &Value) -> String {
    value
        .get("id")
        .and_then(Value::as_str)
        .or_else(|| value.get("url").and_then(Value::as_str))
        .or_else(|| value.get("source_url").and_then(Value::as_str))
        .unwrap_or("")
        .to_string()
}

fn open_download_dir(payload: &WxChannelsPayload) -> Result<(), String> {
    let output_dir = payload
        .output_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(default_output_dir()));
    fs::create_dir_all(&output_dir).map_err(|e| format!("创建下载目录失败: {}", e))?;
    open_path(&output_dir)
}

fn open_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
        return Ok(());
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
        Ok(())
    }
}

fn local_client_with_timeout(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .timeout(timeout)
        .connect_timeout(Duration::from_secs(2))
        .no_proxy()
        .build()
        .map_err(|e| format!("初始化本地请求失败: {}", e))
}

fn command_output_error(prefix: &str, stderr: &[u8]) -> String {
    let detail = decode_output(stderr);
    let detail = detail.trim();
    if detail.is_empty() {
        prefix.to_string()
    } else {
        format!("{}: {}", prefix, detail)
    }
}

fn decode_output(bytes: &[u8]) -> String {
    match String::from_utf8(bytes.to_vec()) {
        Ok(value) => value,
        Err(_) => {
            let (text, _, _) = encoding_rs::GBK.decode(bytes);
            text.into_owned()
        }
    }
}
