use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

static TIKHUB_CANCELLED_TASKS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

const DEFAULT_API_BASE: &str = "https://api.tikhub.io";
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TikHubCommandPayload {
    api_key: Option<String>,
    api_base: Option<String>,
    platform: Option<String>,
    input: Option<String>,
    region: Option<String>,
    output_dir: Option<String>,
    task_id: Option<String>,
    resolved_url: Option<String>,
    title: Option<String>,
    author: Option<String>,
    video_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TikHubAccountStatus {
    ok: bool,
    message: String,
    email: Option<String>,
    balance: Option<f64>,
    free_credit: Option<f64>,
    api_key_name: Option<String>,
    api_key_status: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TikHubVideoInfo {
    platform: String,
    video_id: Option<String>,
    title: String,
    author: Option<String>,
    cover: Option<String>,
    download_url: String,
    duration: Option<f64>,
    size: Option<u64>,
    source_endpoint: String,
    message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TikHubDownloadResult {
    task_id: String,
    output_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TikHubDownloadProgress {
    task_id: String,
    status: String,
    percent: Option<f32>,
    downloaded: u64,
    total: Option<u64>,
    filename: Option<String>,
    output_path: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Clone)]
struct TikHubApiRequest {
    endpoint: &'static str,
    query: Vec<(&'static str, String)>,
}

#[tauri::command]
pub async fn tikhub_download_command(
    app_handle: AppHandle,
    action: String,
    payload: String,
) -> Result<String, String> {
    let payload: TikHubCommandPayload = if payload.trim().is_empty() {
        TikHubCommandPayload::default()
    } else {
        serde_json::from_str(&payload).map_err(|e| format!("解析 TikHub 参数失败: {}", e))?
    };

    match action.as_str() {
        "defaultDir" => json_response(default_download_dir()?),
        "account" => {
            run_tikhub_blocking("检测 TikHub 账户", move || {
                json_response(check_account(&payload)?)
            })
            .await
        }
        "probe" => {
            run_tikhub_blocking("解析 TikHub 视频", move || {
                json_response(fetch_video_info(&payload)?)
            })
            .await
        }
        "start" => {
            run_tikhub_blocking("启动 TikHub 下载", move || {
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
        _ => Err("未知 TikHub 下载动作".to_string()),
    }
}

async fn run_tikhub_blocking<F>(label: &str, task: F) -> Result<String, String>
where
    F: FnOnce() -> Result<String, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| format!("{}任务执行失败: {}", label, e))?
}

fn json_response<T: Serialize>(value: T) -> Result<String, String> {
    serde_json::to_string(&value).map_err(|e| format!("序列化 TikHub 响应失败: {}", e))
}

fn default_download_dir() -> Result<String, String> {
    Ok(dirs::download_dir()
        .or_else(dirs::video_dir)
        .or_else(dirs::desktop_dir)
        .unwrap_or_else(std::env::temp_dir)
        .to_string_lossy()
        .to_string())
}

fn check_account(payload: &TikHubCommandPayload) -> Result<TikHubAccountStatus, String> {
    let api_key = require_api_key(payload)?;
    let api_base = normalized_api_base(payload.api_base.as_deref());
    let client = api_client()?;
    let value = client
        .get(format!("{}/api/v1/tikhub/user/get_user_info", api_base))
        .bearer_auth(api_key)
        .send()
        .map_err(|e| format!("请求 TikHub 账户信息失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("TikHub 账户信息响应失败: {}", e))?
        .json::<Value>()
        .map_err(|e| format!("解析 TikHub 账户信息失败: {}", e))?;

    Ok(TikHubAccountStatus {
        ok: true,
        message: "TikHub API Key 可用".to_string(),
        email: json_string_path(&value, &["user_data", "email"]),
        balance: json_f64_path(&value, &["user_data", "balance"]),
        free_credit: json_f64_path(&value, &["user_data", "free_credit"]),
        api_key_name: json_string_path(&value, &["api_key_data", "api_key_name"]),
        api_key_status: json_i64_path(&value, &["api_key_data", "api_key_status"]),
    })
}

fn fetch_video_info(payload: &TikHubCommandPayload) -> Result<TikHubVideoInfo, String> {
    let api_key = require_api_key(payload)?;
    let input = payload
        .input
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "请输入 TikHub 支持的平台链接 / 作品 ID".to_string())?;
    let normalized_input = extract_first_url(input).unwrap_or_else(|| input.to_string());
    let platform = detect_platform(payload.platform.as_deref(), input)
        .or_else(|_| detect_platform(payload.platform.as_deref(), &normalized_input))?;
    match platform.as_str() {
        "douyin" => fetch_douyin_video(payload, &normalized_input, &api_key),
        "tiktok" => fetch_tiktok_video(payload, &normalized_input, &api_key),
        "xiaohongshu" => fetch_generic_platform_video(
            payload,
            &api_key,
            "xiaohongshu",
            xiaohongshu_requests(&normalized_input)?,
        ),
        "kuaishou" => fetch_generic_platform_video(
            payload,
            &api_key,
            "kuaishou",
            kuaishou_requests(&normalized_input),
        ),
        "bilibili" => fetch_bilibili_video(payload, &normalized_input, &api_key),
        "youtube" => fetch_youtube_video(payload, &normalized_input, &api_key),
        "toutiao" => fetch_generic_platform_video(
            payload,
            &api_key,
            "toutiao",
            toutiao_requests(&normalized_input)?,
        ),
        "weibo" => fetch_generic_platform_video(
            payload,
            &api_key,
            "weibo",
            weibo_requests(&normalized_input)?,
        ),
        _ => Err("当前平台暂未接入下载解析接口，请手动选择已支持的平台。".to_string()),
    }
}

fn fetch_douyin_video(
    payload: &TikHubCommandPayload,
    input: &str,
    api_key: &str,
) -> Result<TikHubVideoInfo, String> {
    let api_base = normalized_api_base(payload.api_base.as_deref());
    let region = normalized_region(payload.region.as_deref(), "CN");
    let aweme_id = extract_video_id(input);
    let client = api_client()?;
    let high_endpoint = "/api/v1/douyin/web/fetch_video_high_quality_play_url";
    let mut high_query = vec![("region", region.as_str())];
    if let Some(id) = aweme_id.as_deref() {
        high_query.push(("aweme_id", id));
    } else if !looks_like_url(input) {
        high_query.push(("aweme_id", input));
    }
    if looks_like_url(input) {
        high_query.push(("share_url", input));
    }

    let high_value = client
        .get(format!("{}{}", api_base, high_endpoint))
        .bearer_auth(api_key)
        .query(&high_query)
        .send()
        .map_err(|e| format!("请求 TikHub 抖音高清接口失败: {}", e))
        .and_then(|response| {
            response
                .error_for_status()
                .map_err(|e| format!("TikHub 抖音高清接口响应失败: {}", e))
        })
        .and_then(|response| {
            response
                .json::<Value>()
                .map_err(|e| format!("解析 TikHub 抖音高清响应失败: {}", e))
        })
        .and_then(|value| {
            ensure_tikhub_ok(&value)?;
            Ok(value)
        });

    let (value, endpoint) = if let Ok(value) = high_value {
        (value, high_endpoint)
    } else {
        let fallback_endpoint = if looks_like_url(input) {
            "/api/v1/douyin/web/fetch_one_video_by_share_url"
        } else {
            "/api/v1/douyin/app/v3/fetch_one_video"
        };
        let request = client
            .get(format!("{}{}", api_base, fallback_endpoint))
            .bearer_auth(api_key);
        let response = if looks_like_url(input) {
            request.query(&[("share_url", input)]).send()
        } else {
            request
                .query(&[
                    ("aweme_id", aweme_id.as_deref().unwrap_or(input)),
                    ("region", region.as_str()),
                ])
                .send()
        };
        let value = response
            .map_err(|e| format!("请求 TikHub 抖音作品接口失败: {}", e))?
            .error_for_status()
            .map_err(|e| format!("TikHub 抖音作品接口响应失败: {}", e))?
            .json::<Value>()
            .map_err(|e| format!("解析 TikHub 抖音响应失败: {}", e))?;
        ensure_tikhub_ok(&value)?;
        (value, fallback_endpoint)
    };

    let data = value.get("data").unwrap_or(&value);
    let video_data = data.get("video_data").unwrap_or(data);
    let download_url = douyin_video_url(data)
        .or_else(|| douyin_video_url(video_data))
        .or_else(|| best_video_url(data))
        .or_else(|| best_video_url(video_data))
        .ok_or_else(|| "TikHub 响应中没有找到可下载视频链接".to_string())?;

    Ok(TikHubVideoInfo {
        platform: "douyin".to_string(),
        video_id: json_string_path(data, &["video_id"])
            .or_else(|| find_first_string(video_data, &["aweme_id", "video_id", "id"]))
            .or(aweme_id),
        title: find_first_string(video_data, &["desc", "title", "caption"])
            .or_else(|| find_first_string(data, &["desc", "title", "caption"]))
            .unwrap_or_else(|| "抖音视频".to_string()),
        author: find_first_string(video_data, &["nickname", "author", "unique_id"])
            .or_else(|| find_first_string(data, &["nickname", "author", "unique_id"])),
        cover: best_cover_url(video_data).or_else(|| best_cover_url(data)),
        duration: find_first_f64(video_data, &["duration"])
            .or_else(|| find_first_f64(data, &["duration"])),
        size: find_first_u64(video_data, &["size", "data_size", "file_size"])
            .or_else(|| find_first_u64(data, &["size", "data_size", "file_size"])),
        download_url,
        source_endpoint: endpoint.to_string(),
        message: json_string_path(&value, &["message_zh"])
            .or_else(|| json_string_path(&value, &["message"])),
    })
}

fn fetch_tiktok_video(
    payload: &TikHubCommandPayload,
    input: &str,
    api_key: &str,
) -> Result<TikHubVideoInfo, String> {
    let api_base = normalized_api_base(payload.api_base.as_deref());
    let region = normalized_region(payload.region.as_deref(), "US");
    let client = api_client()?;
    let endpoint;
    let value = if looks_like_url(input) {
        endpoint = "/api/v1/tiktok/app/v3/fetch_one_video_by_share_url";
        client
            .get(format!("{}{}", api_base, endpoint))
            .bearer_auth(api_key)
            .query(&[("share_url", input)])
            .send()
            .map_err(|e| format!("请求 TikHub TikTok 分享链接接口失败: {}", e))?
            .error_for_status()
            .map_err(|e| format!("TikHub TikTok 分享链接接口响应失败: {}", e))?
            .json::<Value>()
            .map_err(|e| format!("解析 TikHub TikTok 响应失败: {}", e))?
    } else {
        endpoint = "/api/v1/tiktok/app/v3/fetch_one_video";
        client
            .get(format!("{}{}", api_base, endpoint))
            .bearer_auth(api_key)
            .query(&[("aweme_id", input), ("region", region.as_str())])
            .send()
            .map_err(|e| format!("请求 TikHub TikTok 接口失败: {}", e))?
            .error_for_status()
            .map_err(|e| format!("TikHub TikTok 接口响应失败: {}", e))?
            .json::<Value>()
            .map_err(|e| format!("解析 TikHub TikTok 响应失败: {}", e))?
    };

    ensure_tikhub_ok(&value)?;
    let data = value.get("data").unwrap_or(&value);
    let download_url = tiktok_video_url(data)
        .or_else(|| best_video_url(data))
        .ok_or_else(|| "TikHub 响应中没有找到可下载 TikTok 视频链接".to_string())?;

    Ok(TikHubVideoInfo {
        platform: "tiktok".to_string(),
        video_id: find_first_string(data, &["aweme_id", "id", "item_id"])
            .or_else(|| extract_video_id(input)),
        title: find_first_string(data, &["desc", "title", "caption"])
            .unwrap_or_else(|| "TikTok 视频".to_string()),
        author: find_first_string(data, &["nickname", "unique_id", "author"]),
        cover: best_cover_url(data),
        duration: find_first_f64(data, &["duration"]),
        size: find_first_u64(data, &["size", "data_size", "file_size"]),
        download_url,
        source_endpoint: endpoint.to_string(),
        message: json_string_path(&value, &["message_zh"])
            .or_else(|| json_string_path(&value, &["message"])),
    })
}

fn fetch_generic_platform_video(
    payload: &TikHubCommandPayload,
    api_key: &str,
    platform: &str,
    requests: Vec<TikHubApiRequest>,
) -> Result<TikHubVideoInfo, String> {
    let api_base = normalized_api_base(payload.api_base.as_deref());
    let client = api_client()?;
    let mut last_error = String::new();

    for request in requests {
        let response = client
            .get(format!("{}{}", api_base, request.endpoint))
            .bearer_auth(api_key)
            .query(&request.query)
            .send()
            .map_err(|e| format!("请求 TikHub {} 接口失败: {}", platform_label(platform), e))
            .and_then(|response| {
                response
                    .error_for_status()
                    .map_err(|e| format!("TikHub {} 接口响应失败: {}", platform_label(platform), e))
            })
            .and_then(|response| {
                response.json::<Value>().map_err(|e| {
                    format!("解析 TikHub {} 响应失败: {}", platform_label(platform), e)
                })
            })
            .and_then(|value| {
                ensure_tikhub_ok(&value)?;
                Ok(value)
            });

        match response {
            Ok(value) => {
                let data = value.get("data").unwrap_or(&value);
                if let Some(download_url) = generic_download_url(data) {
                    return Ok(TikHubVideoInfo {
                        platform: platform.to_string(),
                        video_id: find_first_string(
                            data,
                            &[
                                "id", "video_id", "item_id", "note_id", "aweme_id", "bvid", "aid",
                                "mid",
                            ],
                        ),
                        title: find_first_string(
                            data,
                            &["title", "desc", "caption", "content", "text", "share_title"],
                        )
                        .unwrap_or_else(|| format!("{}视频", platform_label(platform))),
                        author: find_first_string(
                            data,
                            &["nickname", "author", "user_name", "unique_id", "name"],
                        ),
                        cover: best_cover_url(data),
                        duration: find_first_f64(data, &["duration", "duration_ms", "length"]),
                        size: find_first_u64(
                            data,
                            &["size", "data_size", "file_size", "content_length"],
                        ),
                        download_url,
                        source_endpoint: request.endpoint.to_string(),
                        message: json_string_path(&value, &["message_zh"])
                            .or_else(|| json_string_path(&value, &["message"])),
                    });
                }
                last_error = format!("{} 接口没有返回可下载视频链接", request.endpoint);
            }
            Err(error) => {
                last_error = error;
            }
        }
    }

    Err(if last_error.is_empty() {
        format!(
            "TikHub 暂未返回 {} 可下载视频链接",
            platform_label(platform)
        )
    } else {
        last_error
    })
}

fn xiaohongshu_requests(input: &str) -> Result<Vec<TikHubApiRequest>, String> {
    let mut requests = Vec::new();
    if looks_like_url(input) {
        requests.push(TikHubApiRequest {
            endpoint: "/api/v1/xiaohongshu/app_v2/get_video_note_detail",
            query: vec![("share_text", input.to_string())],
        });
        requests.push(TikHubApiRequest {
            endpoint: "/api/v1/xiaohongshu/web_v2/fetch_feed_notes_v3",
            query: vec![("short_url", input.to_string())],
        });
    } else {
        requests.push(TikHubApiRequest {
            endpoint: "/api/v1/xiaohongshu/app_v2/get_video_note_detail",
            query: vec![("note_id", input.to_string())],
        });
    }
    Ok(requests)
}

fn kuaishou_requests(input: &str) -> Vec<TikHubApiRequest> {
    if looks_like_url(input) {
        vec![
            TikHubApiRequest {
                endpoint: "/api/v1/kuaishou/web/fetch_one_video_by_url",
                query: vec![("url", input.to_string())],
            },
            TikHubApiRequest {
                endpoint: "/api/v1/kuaishou/app/fetch_one_video_by_url",
                query: vec![("share_text", input.to_string())],
            },
            TikHubApiRequest {
                endpoint: "/api/v1/kuaishou/web/fetch_one_video",
                query: vec![("share_text", input.to_string())],
            },
        ]
    } else {
        let photo_id = input.to_string();
        vec![
            TikHubApiRequest {
                endpoint: "/api/v1/kuaishou/web/fetch_one_video_v2",
                query: vec![("photo_id", photo_id.clone())],
            },
            TikHubApiRequest {
                endpoint: "/api/v1/kuaishou/app/fetch_one_video",
                query: vec![("photo_id", photo_id)],
            },
        ]
    }
}

fn toutiao_requests(input: &str) -> Result<Vec<TikHubApiRequest>, String> {
    let id = extract_video_id(input).unwrap_or_else(|| input.to_string());
    Ok(vec![
        TikHubApiRequest {
            endpoint: "/api/v1/toutiao/web/get_video_info",
            query: vec![("aweme_id", id.clone())],
        },
        TikHubApiRequest {
            endpoint: "/api/v1/toutiao/app/get_video_info",
            query: vec![("group_id", id)],
        },
    ])
}

fn weibo_requests(input: &str) -> Result<Vec<TikHubApiRequest>, String> {
    let id = weibo_id_from_input(input).unwrap_or_else(|| input.to_string());
    Ok(vec![
        TikHubApiRequest {
            endpoint: "/api/v1/weibo/web_v2/fetch_post_detail",
            query: vec![("id", id.clone()), ("is_get_long_text", "1".to_string())],
        },
        TikHubApiRequest {
            endpoint: "/api/v1/weibo/app/fetch_status_detail",
            query: vec![("status_id", id.clone())],
        },
        TikHubApiRequest {
            endpoint: "/api/v1/weibo/app/fetch_video_detail",
            query: vec![("mid", id)],
        },
    ])
}

fn fetch_bilibili_video(
    payload: &TikHubCommandPayload,
    input: &str,
    api_key: &str,
) -> Result<TikHubVideoInfo, String> {
    let api_base = normalized_api_base(payload.api_base.as_deref());
    let client = api_client()?;
    let bv_id = extract_bilibili_bvid(input);
    let detail_request = if looks_like_url(input) {
        TikHubApiRequest {
            endpoint: "/api/v1/bilibili/web/fetch_one_video_v3",
            query: vec![("url", input.to_string())],
        }
    } else if let Some(bv_id) = bv_id.clone() {
        TikHubApiRequest {
            endpoint: "/api/v1/bilibili/web/fetch_one_video",
            query: vec![("bv_id", bv_id)],
        }
    } else {
        return Err("B站解析需要视频链接或 BV 号".to_string());
    };

    let detail_value = call_tikhub_get(&client, &api_base, api_key, &detail_request, "B站")?;
    let data = detail_value.get("data").unwrap_or(&detail_value);
    let cid = find_first_string(data, &["cid", "c_id"]);
    let resolved_bv = bv_id
        .or_else(|| find_first_string(data, &["bvid", "bv_id"]))
        .ok_or_else(|| "B站接口没有返回 BV 号，无法继续获取视频流地址".to_string())?;

    let mut stream_requests = Vec::new();
    if looks_like_url(input) {
        stream_requests.push(TikHubApiRequest {
            endpoint: "/api/v1/bilibili/web/fetch_video_play_info",
            query: vec![("url", input.to_string())],
        });
    }
    if let Some(cid) = cid {
        stream_requests.push(TikHubApiRequest {
            endpoint: "/api/v1/bilibili/web/fetch_video_playurl",
            query: vec![("bv_id", resolved_bv.clone()), ("cid", cid)],
        });
    }

    let mut last_error = String::new();
    for request in stream_requests {
        match call_tikhub_get(&client, &api_base, api_key, &request, "B站") {
            Ok(value) => {
                let stream_data = value.get("data").unwrap_or(&value);
                if let Some(download_url) =
                    bilibili_video_url(stream_data).or_else(|| best_video_url(stream_data))
                {
                    return Ok(TikHubVideoInfo {
                        platform: "bilibili".to_string(),
                        video_id: Some(resolved_bv),
                        title: find_first_string(data, &["title", "desc"])
                            .unwrap_or_else(|| "B站视频".to_string()),
                        author: find_first_string(data, &["owner", "name", "author", "uname"]),
                        cover: best_cover_url(data),
                        duration: find_first_f64(data, &["duration"]),
                        size: find_first_u64(stream_data, &["size", "bandwidth"]),
                        download_url,
                        source_endpoint: request.endpoint.to_string(),
                        message: json_string_path(&value, &["message_zh"])
                            .or_else(|| json_string_path(&value, &["message"])),
                    });
                }
                last_error = format!("{} 接口没有返回可下载视频流", request.endpoint);
            }
            Err(error) => last_error = error,
        }
    }

    Err(if last_error.is_empty() {
        "B站接口没有返回可下载视频流".to_string()
    } else {
        last_error
    })
}

fn fetch_youtube_video(
    payload: &TikHubCommandPayload,
    input: &str,
    api_key: &str,
) -> Result<TikHubVideoInfo, String> {
    let api_base = normalized_api_base(payload.api_base.as_deref());
    let client = api_client()?;
    let video_id = extract_youtube_video_id(input).unwrap_or_else(|| input.to_string());
    let stream_request = TikHubApiRequest {
        endpoint: "/api/v1/youtube/web_v2/get_video_streams_v2",
        query: if looks_like_url(input) {
            vec![("video_url", input.to_string())]
        } else {
            vec![("video_id", video_id.clone())]
        },
    };
    let value = call_tikhub_get(&client, &api_base, api_key, &stream_request, "YouTube")?;
    let data = value.get("data").unwrap_or(&value);
    let download_url = youtube_video_url(data)
        .or_else(|| best_video_url(data))
        .ok_or_else(|| "YouTube 接口没有返回可下载视频流".to_string())?;
    Ok(TikHubVideoInfo {
        platform: "youtube".to_string(),
        video_id: Some(video_id),
        title: find_first_string(data, &["title", "video_title"])
            .unwrap_or_else(|| "YouTube视频".to_string()),
        author: find_first_string(data, &["author", "channel", "channel_name"]),
        cover: best_cover_url(data),
        duration: find_first_f64(data, &["duration", "length_seconds"]),
        size: find_first_u64(data, &["content_length", "filesize", "size"]),
        download_url,
        source_endpoint: stream_request.endpoint.to_string(),
        message: json_string_path(&value, &["message_zh"])
            .or_else(|| json_string_path(&value, &["message"])),
    })
}

fn call_tikhub_get(
    client: &reqwest::blocking::Client,
    api_base: &str,
    api_key: &str,
    request: &TikHubApiRequest,
    platform_name: &str,
) -> Result<Value, String> {
    let value = client
        .get(format!("{}{}", api_base, request.endpoint))
        .bearer_auth(api_key)
        .query(&request.query)
        .send()
        .map_err(|e| format!("请求 TikHub {} 接口失败: {}", platform_name, e))?
        .error_for_status()
        .map_err(|e| format!("TikHub {} 接口响应失败: {}", platform_name, e))?
        .json::<Value>()
        .map_err(|e| format!("解析 TikHub {} 响应失败: {}", platform_name, e))?;
    ensure_tikhub_ok(&value)?;
    Ok(value)
}

fn platform_label(platform: &str) -> &'static str {
    match platform {
        "douyin" => "抖音",
        "tiktok" => "TikTok",
        "xiaohongshu" => "小红书",
        "kuaishou" => "快手",
        "bilibili" => "B站",
        "youtube" => "YouTube",
        "toutiao" => "头条",
        "weibo" => "微博",
        _ => "TikHub",
    }
}

fn generic_download_url(value: &Value) -> Option<String> {
    for path in [
        &["video", "url"][..],
        &["video", "urls"][..],
        &["video", "url_list"][..],
        &["video", "download_url"][..],
        &["video", "play_url"][..],
        &["video", "play_addr", "url_list"][..],
        &["video", "download_addr", "url_list"][..],
        &["video_url"][..],
        &["video_urls"][..],
        &["download_url"][..],
        &["play_url"][..],
        &["media", "video_url"][..],
        &["media", "url"][..],
        &["note_card", "video", "consumer", "origin_video_key"][..],
        &["note_card", "video", "media", "stream", "h264"][..],
        &["data", "video", "url"][..],
        &["data", "video_url"][..],
    ] {
        if let Some(found) = string_at_path(value, path).filter(|url| is_video_url(url)) {
            return Some(found);
        }
    }

    best_video_url(value)
}

fn start_download(
    app_handle: AppHandle,
    payload: TikHubCommandPayload,
) -> Result<TikHubDownloadResult, String> {
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
        TikHubVideoInfo {
            platform: payload
                .platform
                .clone()
                .unwrap_or_else(|| "tikhub".to_string()),
            video_id: payload.video_id.clone(),
            title: payload
                .title
                .clone()
                .unwrap_or_else(|| "TikHub 视频".to_string()),
            author: payload.author.clone(),
            cover: None,
            download_url: url.to_string(),
            duration: None,
            size: None,
            source_endpoint: "resolved_url".to_string(),
            message: None,
        }
    } else {
        fetch_video_info(&payload)?
    };

    let file_name = build_file_name(&info);
    let output_path = unique_output_path(output_dir.join(file_name));
    let output_path_string = output_path.to_string_lossy().to_string();
    let task_id_for_thread = task_id.clone();
    std::thread::spawn(move || {
        if let Err(message) =
            download_file(app_handle.clone(), &task_id_for_thread, &info, &output_path)
        {
            emit_progress(
                &app_handle,
                TikHubDownloadProgress {
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

    Ok(TikHubDownloadResult {
        task_id,
        output_path: output_path_string,
    })
}

fn download_file(
    app_handle: AppHandle,
    task_id: &str,
    info: &TikHubVideoInfo,
    output_path: &Path,
) -> Result<(), String> {
    let referer = platform_referer(&info.platform);
    let client = api_client()?;
    let mut response = client
        .get(&info.download_url)
        .header(reqwest::header::USER_AGENT, BROWSER_UA)
        .header(reqwest::header::REFERER, referer)
        .header(reqwest::header::ACCEPT, "*/*")
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send()
        .map_err(|e| format!("请求视频文件失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("视频文件响应失败: {}", e))?;
    let total = response.content_length().or(info.size);
    let mut file = File::create(output_path).map_err(|e| format!("创建输出文件失败: {}", e))?;
    let mut downloaded = 0u64;
    let mut buffer = [0u8; 1024 * 128];

    emit_progress(
        &app_handle,
        TikHubDownloadProgress {
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
            .map_err(|e| format!("读取视频流失败: {}", e))?;
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
            TikHubDownloadProgress {
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
        TikHubDownloadProgress {
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

fn platform_referer(platform: &str) -> &'static str {
    match platform {
        "douyin" => "https://www.douyin.com/",
        "tiktok" => "https://www.tiktok.com/",
        "xiaohongshu" => "https://www.xiaohongshu.com/",
        "kuaishou" => "https://www.kuaishou.com/",
        "bilibili" => "https://www.bilibili.com/",
        "youtube" => "https://www.youtube.com/",
        "toutiao" => "https://www.toutiao.com/",
        "weibo" => "https://weibo.com/",
        _ => "https://tikhub.io/",
    }
}

fn api_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .connect_timeout(std::time::Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent(BROWSER_UA)
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败: {}", e))
}

fn require_api_key(payload: &TikHubCommandPayload) -> Result<String, String> {
    payload
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "请先在设置中填写 TikHub API Key".to_string())
}

fn normalized_api_base(value: Option<&str>) -> String {
    let value = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_API_BASE);
    value.trim_end_matches('/').to_string()
}

fn normalized_region(value: Option<&str>, fallback: &str) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_uppercase()
}

fn detect_platform(configured: Option<&str>, input: &str) -> Result<String, String> {
    let configured = configured.unwrap_or("auto").trim().to_lowercase();
    if matches!(
        configured.as_str(),
        "douyin"
            | "tiktok"
            | "xiaohongshu"
            | "kuaishou"
            | "bilibili"
            | "youtube"
            | "toutiao"
            | "weibo"
    ) {
        return Ok(configured);
    }
    let lower = input.to_lowercase();
    if lower.contains("douyin") || lower.contains("iesdouyin") || lower.contains("douyinvod") {
        Ok("douyin".to_string())
    } else if lower.contains("tiktok")
        || lower.contains("tiktokcdn")
        || lower.contains("byteoversea")
    {
        Ok("tiktok".to_string())
    } else if lower.contains("xiaohongshu") || lower.contains("xhslink") || lower.contains("xhs.cn")
    {
        Ok("xiaohongshu".to_string())
    } else if lower.contains("kuaishou") || lower.contains("gifshow") || lower.contains("ksurl") {
        Ok("kuaishou".to_string())
    } else if lower.contains("bilibili") || lower.contains("b23.tv") || lower.contains("bili2233") {
        Ok("bilibili".to_string())
    } else if lower.contains("youtube") || lower.contains("youtu.be") {
        Ok("youtube".to_string())
    } else if lower.contains("toutiao") || lower.contains("ixigua") {
        Ok("toutiao".to_string())
    } else if lower.contains("weibo") || lower.contains("weibo.cn") {
        Ok("weibo".to_string())
    } else {
        Err("无法自动判断平台，请手动选择平台".to_string())
    }
}

fn ensure_tikhub_ok(value: &Value) -> Result<(), String> {
    let code = value.get("code").and_then(Value::as_i64).unwrap_or(200);
    if code == 200 || code == 0 {
        return Ok(());
    }
    let message = json_string_path(value, &["message_zh"])
        .or_else(|| json_string_path(value, &["message"]))
        .unwrap_or_else(|| format!("TikHub 返回错误码 {}", code));
    Err(message)
}

fn build_file_name(info: &TikHubVideoInfo) -> String {
    let id = info.video_id.as_deref().unwrap_or("video");
    let title = sanitize_filename(&info.title);
    format!("{}_{}_{}.mp4", info.platform, id, title)
}

fn unique_output_path(path: PathBuf) -> PathBuf {
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
        .unwrap_or("video")
        .to_string();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp4");
    for index in 1..1000 {
        let candidate = parent.join(format!("{} ({index}).{}", stem, extension));
        if !candidate.exists() {
            return candidate;
        }
    }
    path
}

fn sanitize_filename(value: &str) -> String {
    let mut result = value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>();
    result = result.trim().trim_matches('.').to_string();
    if result.is_empty() {
        "video".to_string()
    } else {
        result.chars().take(80).collect()
    }
}

fn looks_like_url(value: &str) -> bool {
    let lower = value.to_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

fn extract_first_url(value: &str) -> Option<String> {
    let http = value.find("http://");
    let https = value.find("https://");
    let start = match (http, https) {
        (Some(a), Some(b)) => a.min(b),
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => return None,
    };
    let rest = &value[start..];
    let mut end = rest.len();
    for (index, ch) in rest.char_indices() {
        if ch.is_whitespace()
            || matches!(
                ch,
                '"' | '\'' | '<' | '>' | '，' | '。' | '；' | ';' | '、' | ')' | '）' | ']' | '】'
            )
        {
            end = index;
            break;
        }
    }
    let url = rest[..end]
        .trim()
        .trim_end_matches(|ch| {
            matches!(
                ch,
                '.' | ',' | '，' | '。' | ';' | '；' | ')' | '）' | ']' | '】'
            )
        })
        .to_string();
    if looks_like_url(&url) {
        Some(url)
    } else {
        None
    }
}

fn extract_video_id(value: &str) -> Option<String> {
    let mut current = String::new();
    let mut best = String::new();
    for ch in value.chars() {
        if ch.is_ascii_digit() {
            current.push(ch);
        } else {
            if current.len() >= best.len() {
                best = current.clone();
            }
            current.clear();
        }
    }
    if current.len() >= best.len() {
        best = current;
    }
    if best.len() >= 12 {
        Some(best)
    } else {
        None
    }
}

fn extract_bilibili_bvid(value: &str) -> Option<String> {
    let upper = value.to_ascii_uppercase();
    let start = upper.find("BV")?;
    let tail = &value[start..];
    let id: String = tail
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric())
        .collect();
    if id.len() >= 10 {
        Some(id)
    } else {
        None
    }
}

fn extract_youtube_video_id(value: &str) -> Option<String> {
    if !looks_like_url(value) {
        let clean = value.trim();
        if clean.len() >= 8
            && clean
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
        {
            return Some(clean.to_string());
        }
        return None;
    }
    if let Some(index) = value.find("v=") {
        let rest = &value[index + 2..];
        let id: String = rest
            .chars()
            .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
            .collect();
        if !id.is_empty() {
            return Some(id);
        }
    }
    if let Some(index) = value.find("youtu.be/") {
        let rest = &value[index + "youtu.be/".len()..];
        let id: String = rest
            .chars()
            .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
            .collect();
        if !id.is_empty() {
            return Some(id);
        }
    }
    if let Some(index) = value.find("/shorts/") {
        let rest = &value[index + "/shorts/".len()..];
        let id: String = rest
            .chars()
            .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
            .collect();
        if !id.is_empty() {
            return Some(id);
        }
    }
    None
}

fn weibo_id_from_input(value: &str) -> Option<String> {
    let clean = value.trim().trim_end_matches('/');
    if !looks_like_url(clean) {
        return Some(clean.to_string()).filter(|item| !item.is_empty());
    }
    clean
        .rsplit('/')
        .next()
        .map(|item| item.split('?').next().unwrap_or(item).trim().to_string())
        .filter(|item| !item.is_empty())
        .or_else(|| extract_video_id(clean))
}

fn json_string_path(value: &Value, path: &[&str]) -> Option<String> {
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

fn json_f64_path(value: &Value, path: &[&str]) -> Option<f64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    value_as_f64(current)
}

fn json_i64_path(value: &Value, path: &[&str]) -> Option<i64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_i64()
        .or_else(|| current.as_u64().map(|value| value as i64))
        .or_else(|| current.as_str().and_then(|text| text.trim().parse().ok()))
}

fn find_first_string(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(found) = map.get(*key).and_then(value_to_string_or_first_url) {
                    return Some(found);
                }
            }
            for item in map.values() {
                if let Some(found) = find_first_string(item, keys) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(|item| find_first_string(item, keys)),
        _ => None,
    }
}

fn find_first_f64(value: &Value, keys: &[&str]) -> Option<f64> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(found) = map.get(*key).and_then(value_as_f64) {
                    return Some(found);
                }
            }
            for item in map.values() {
                if let Some(found) = find_first_f64(item, keys) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(|item| find_first_f64(item, keys)),
        _ => None,
    }
}

fn find_first_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(found) = map.get(*key).and_then(value_as_u64) {
                    return Some(found);
                }
            }
            for item in map.values() {
                if let Some(found) = find_first_u64(item, keys) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(|item| find_first_u64(item, keys)),
        _ => None,
    }
}

fn value_to_string_or_first_url(value: &Value) -> Option<String> {
    if let Some(text) = value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        return Some(text.to_string());
    }
    if let Some(items) = value.as_array() {
        return items.iter().find_map(value_to_string_or_first_url);
    }
    if let Some(map) = value.as_object() {
        for key in ["url_list", "urls", "url", "uri"] {
            if let Some(found) = map.get(key).and_then(value_to_string_or_first_url) {
                return Some(found);
            }
        }
    }
    None
}

fn value_as_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|value| value as f64))
        .or_else(|| value.as_u64().map(|value| value as f64))
        .or_else(|| value.as_str().and_then(|text| text.trim().parse().ok()))
}

fn value_as_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_i64().map(|value| value.max(0) as u64))
        .or_else(|| value.as_f64().map(|value| value.max(0.0) as u64))
        .or_else(|| value.as_str().and_then(|text| text.trim().parse().ok()))
}

fn tiktok_video_url(value: &Value) -> Option<String> {
    for path in [
        &["video", "play_addr", "url_list"][..],
        &["video", "download_addr", "url_list"][..],
        &["aweme_detail", "video", "play_addr", "url_list"][..],
        &["aweme_detail", "video", "download_addr", "url_list"][..],
        &["itemInfo", "itemStruct", "video", "playAddr"][..],
        &["itemInfo", "itemStruct", "video", "downloadAddr"][..],
    ] {
        if let Some(found) = string_at_path(value, path) {
            return Some(found);
        }
    }
    None
}

fn bilibili_video_url(value: &Value) -> Option<String> {
    for path in [
        &["durl", "url"][..],
        &["data", "durl", "url"][..],
        &["result", "durl", "url"][..],
        &["dash", "video", "base_url"][..],
        &["dash", "video", "baseUrl"][..],
        &["data", "dash", "video", "base_url"][..],
        &["data", "dash", "video", "baseUrl"][..],
    ] {
        if let Some(found) = string_at_path(value, path).filter(|url| is_video_url(url)) {
            return Some(found);
        }
    }
    best_video_url(value)
}

fn youtube_video_url(value: &Value) -> Option<String> {
    for path in [
        &["url"][..],
        &["video_url"][..],
        &["signatureCipher", "url"][..],
        &["formats", "url"][..],
        &["adaptiveFormats", "url"][..],
        &["streamingData", "formats", "url"][..],
        &["streamingData", "adaptiveFormats", "url"][..],
    ] {
        if let Some(found) = string_at_path(value, path).filter(|url| is_video_url(url)) {
            return Some(found);
        }
    }
    best_video_url(value)
}

fn douyin_video_url(value: &Value) -> Option<String> {
    for path in [
        &["original_video_url"][..],
        &["download_url"][..],
        &["play_url"][..],
        &["video", "play_addr", "url_list"][..],
        &["video", "download_addr", "url_list"][..],
        &["video", "play_addr", "url_list_265"][..],
        &["video", "download_addr", "url_list_265"][..],
        &["aweme_detail", "video", "play_addr", "url_list"][..],
        &["aweme_detail", "video", "download_addr", "url_list"][..],
        &["aweme_detail", "video", "play_addr", "url_list_265"][..],
        &["aweme_detail", "video", "download_addr", "url_list_265"][..],
        &["video_data", "video", "play_addr", "url_list"][..],
        &["video_data", "video", "download_addr", "url_list"][..],
        &[
            "video_data",
            "aweme_detail",
            "video",
            "play_addr",
            "url_list",
        ][..],
        &[
            "video_data",
            "aweme_detail",
            "video",
            "download_addr",
            "url_list",
        ][..],
    ] {
        if let Some(found) = string_at_path(value, path).filter(|url| is_video_url(url)) {
            return Some(found);
        }
    }

    best_bit_rate_url(value)
}

fn best_bit_rate_url(value: &Value) -> Option<String> {
    let candidates = collect_bit_rate_candidates(value);
    candidates
        .into_iter()
        .filter_map(|item| {
            let quality = find_first_u64(item, &["bit_rate", "quality_type", "gear_name"])
                .unwrap_or_default() as i32;
            string_at_path(item, &["play_addr", "url_list"])
                .or_else(|| string_at_path(item, &["play_addr", "url_list_265"]))
                .or_else(|| string_at_path(item, &["download_addr", "url_list"]))
                .filter(|url| is_video_url(url))
                .map(|url| (quality, url))
        })
        .max_by_key(|(quality, _)| *quality)
        .map(|(_, url)| url)
}

fn collect_bit_rate_candidates(value: &Value) -> Vec<&Value> {
    let mut output = Vec::new();
    collect_bit_rate_candidates_inner(value, &mut output);
    output
}

fn collect_bit_rate_candidates_inner<'a>(value: &'a Value, output: &mut Vec<&'a Value>) {
    match value {
        Value::Object(map) => {
            if let Some(items) = map.get("bit_rate").and_then(Value::as_array) {
                output.extend(items);
            }
            for item in map.values() {
                collect_bit_rate_candidates_inner(item, output);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_bit_rate_candidates_inner(item, output);
            }
        }
        _ => {}
    }
}

fn string_at_path(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    value_to_string_or_first_url(current)
}

fn best_cover_url(value: &Value) -> Option<String> {
    find_first_string(
        value,
        &[
            "cover",
            "origin_cover",
            "dynamic_cover",
            "thumbnail",
            "poster",
        ],
    )
}

fn best_video_url(value: &Value) -> Option<String> {
    let mut candidates = Vec::<(i32, String)>::new();
    collect_urls(value, "", &mut candidates);
    candidates
        .into_iter()
        .filter(|(_, url)| is_video_url(url))
        .max_by_key(|(score, _)| *score)
        .map(|(_, url)| url)
}

fn is_video_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    if lower.contains(".mp3")
        || lower.contains(".m4a")
        || lower.contains(".aac")
        || lower.contains("obj/ies-music")
        || lower.contains("/music/")
        || lower.contains("music")
        || lower.contains("audio")
        || lower.contains(".jpg")
        || lower.contains(".jpeg")
        || lower.contains(".png")
        || lower.contains(".webp")
        || lower.contains("cover")
    {
        return false;
    }
    lower.contains(".mp4")
        || lower.contains(".m3u8")
        || lower.contains("mime=video")
        || lower.contains("video")
        || lower.contains("douyinvod")
        || lower.contains("tiktokcdn")
        || lower.contains("byteoversea")
        || lower.contains("aweme")
        || lower.contains("tos-cn-ve-")
        || lower.contains("hdslb")
        || lower.contains("akamaized")
}

fn collect_urls(value: &Value, key_hint: &str, output: &mut Vec<(i32, String)>) {
    match value {
        Value::String(text) => {
            if text.starts_with("http://") || text.starts_with("https://") {
                let lower = text.to_lowercase();
                let mut score = 0;
                if lower.contains(".mp4") || lower.contains("video") {
                    score += 20;
                }
                if lower.contains("douyinvod")
                    || lower.contains("tiktokcdn")
                    || lower.contains("byteoversea")
                    || lower.contains("muscdn")
                    || lower.contains("aweme")
                {
                    score += 30;
                }
                if key_hint.contains("play")
                    || key_hint.contains("download")
                    || key_hint.contains("url")
                {
                    score += 10;
                }
                output.push((score, text.to_string()));
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_urls(item, key_hint, output);
            }
        }
        Value::Object(map) => {
            for (key, item) in map {
                collect_urls(item, key, output);
            }
        }
        _ => {}
    }
}

fn cancelled_tasks() -> &'static Mutex<HashSet<String>> {
    TIKHUB_CANCELLED_TASKS.get_or_init(|| Mutex::new(HashSet::new()))
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

fn emit_progress(app_handle: &AppHandle, progress: TikHubDownloadProgress) {
    let _ = app_handle.emit_all("tikhub-download-progress", progress);
}
