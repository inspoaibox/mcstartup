use crate::media_convert::get_media_info;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const MEDIA_PENDING_FILE: &str = "media_open_pending.json";
const APP_NAME: &str = "McStartUP";
const MPV_RUNTIME_ARCHIVE: &str = "mpv-runtime.7z";
const MPV_RUNTIME_CACHE_DIR: &str = "media-runtime/mpv";
const VIDEO_PROG_ID: &str = "McStartUP.Video";
const AUDIO_PROG_ID: &str = "McStartUP.Audio";
const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mov", "webm", "mkv", "avi", "flv", "wmv", "ts", "m2ts", "3gp", "ogv", "mpg",
    "mpeg", "mpe", "m2v", "vob", "rmvb", "divx", "f4v", "mxf", "mts",
];
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "mp1", "mp2", "flac", "wav", "wave", "m4a", "mp4a", "aac", "adts", "m4b", "alac", "ogg",
    "oga", "opus", "wma", "asf", "wm", "ape", "amr", "3ga", "ac3", "eac3", "dts", "tta", "tak",
    "mpc", "mpp", "ra", "rm", "au", "snd", "aiff", "aif", "aifc", "caf", "mka",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvStatusRequest {
    mpv_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvStatus {
    installed: bool,
    path: Option<String>,
    version: Option<String>,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvOpenRequest {
    mpv_path: Option<String>,
    media: String,
    start_paused: Option<bool>,
    fullscreen: Option<bool>,
    volume: Option<u8>,
    speed: Option<f64>,
    audio_track: Option<u32>,
    subtitle_track: Option<u32>,
    external_subtitles: Option<Vec<String>>,
    always_on_top: Option<bool>,
    window_width: Option<u32>,
    window_height: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoProbeRequest {
    media: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoTrackInfo {
    ordinal: u32,
    stream_index: u32,
    codec_name: Option<String>,
    language: Option<String>,
    title: Option<String>,
    default_track: bool,
    forced: bool,
    channels: Option<u32>,
    sample_rate: Option<u32>,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoProbeResult {
    media: String,
    duration: Option<f64>,
    audio_tracks: Vec<VideoTrackInfo>,
    subtitle_tracks: Vec<VideoTrackInfo>,
    video_tracks: Vec<VideoTrackInfo>,
    companion_subtitle_paths: Vec<String>,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvOpenResult {
    pid: u32,
    path: String,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaOpenPayload {
    pub kind: String,
    pub paths: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPendingRequest {
    kind: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAssociationRequest {
    kind: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAssociationStatus {
    registered: bool,
    kind: String,
    extensions: Vec<String>,
    command: Option<String>,
    missing: Vec<String>,
    can_set_default_directly: bool,
    message: String,
}

#[tauri::command]
pub fn video_player_mpv_status(request: Option<MpvStatusRequest>) -> Result<MpvStatus, String> {
    let custom_path = request
        .as_ref()
        .and_then(|value| value.mpv_path.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty());

    match resolve_mpv_path(custom_path) {
        Ok(path) => {
            let version = read_mpv_version(&path);
            let origin = mpv_origin_label(&path);
            let message = version
                .as_ref()
                .map(|value| format!("已找到{origin}：{value}"))
                .unwrap_or_else(|| format!("已找到{origin}。"));
            Ok(MpvStatus {
                installed: true,
                path: Some(path.to_string_lossy().to_string()),
                version,
                message,
            })
        }
        Err(message) => Ok(MpvStatus {
            installed: false,
            path: None,
            version: None,
            message,
        }),
    }
}

#[tauri::command]
pub fn video_player_mpv_open(request: MpvOpenRequest) -> Result<MpvOpenResult, String> {
    let media = request.media.trim();
    if media.is_empty() {
        return Err("没有可播放的视频地址。".to_string());
    }

    if !is_remote_media(media) && !Path::new(media).is_file() {
        return Err(format!("视频文件不存在：{}", media));
    }

    let custom_path = request
        .mpv_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mpv_path = resolve_mpv_path(custom_path)?;
    let volume = request.volume.unwrap_or(85).min(100);
    let speed = request.speed.unwrap_or(1.0).clamp(0.25, 4.0);

    let mut command = Command::new(&mpv_path);
    command
        .arg("--force-window=yes")
        .arg("--keep-open=yes")
        .arg(format!("--volume={volume}"))
        .arg(format!("--speed={speed:.3}"));

    if request.start_paused.unwrap_or(false) {
        command.arg("--pause=yes");
    }
    if request.fullscreen.unwrap_or(false) {
        command.arg("--fs");
    }
    if request.always_on_top.unwrap_or(false) {
        command.arg("--ontop");
    }
    if let (Some(width), Some(height)) = (request.window_width, request.window_height) {
        let width = width.clamp(240, 3840);
        let height = height.clamp(135, 2160);
        command
            .arg(format!("--autofit={width}x{height}"))
            .arg("--keepaspect-window=yes");
    }
    if let Some(audio_track) = request.audio_track {
        if audio_track > 0 {
            command.arg(format!("--aid={audio_track}"));
        }
    }
    if let Some(subtitle_track) = request.subtitle_track {
        if subtitle_track == 0 {
            command.arg("--sid=no");
        } else {
            command.arg(format!("--sid={subtitle_track}"));
        }
    }
    if let Some(subtitles) = request.external_subtitles {
        let mut seen = HashSet::new();
        for subtitle in subtitles {
            let subtitle = subtitle.trim().trim_matches('"');
            if subtitle.is_empty() || !seen.insert(subtitle.to_ascii_lowercase()) {
                continue;
            }
            if !Path::new(subtitle).is_file() {
                return Err(format!("外部字幕文件不存在：{subtitle}"));
            }
            command.arg(format!("--sub-file={subtitle}"));
        }
    }

    command.arg(media);
    apply_no_window(&mut command);

    let child = command
        .spawn()
        .map_err(|err| format!("启动 MPV 失败：{err}"))?;
    Ok(MpvOpenResult {
        pid: child.id(),
        path: mpv_path.to_string_lossy().to_string(),
        message: "已交给 MPV 播放。".to_string(),
    })
}

#[tauri::command]
pub fn video_player_probe_media(request: VideoProbeRequest) -> Result<VideoProbeResult, String> {
    let media = request.media.trim().trim_matches('"');
    if media.is_empty() {
        return Err("缺少视频文件路径。".to_string());
    }

    let source = Path::new(media);
    if !source.is_file() && !is_remote_media(media) {
        return Err(format!("视频文件不存在：{media}"));
    }

    let info = get_media_info(media.to_string())?;
    let duration = info
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(json_value_to_f64);
    let mut audio_tracks = Vec::new();
    let mut subtitle_tracks = Vec::new();
    let mut video_tracks = Vec::new();
    let mut audio_ordinal = 0_u32;
    let mut subtitle_ordinal = 0_u32;
    let mut video_ordinal = 0_u32;

    for stream in info
        .get("streams")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let stream_index = json_value_to_u32(stream.get("index")).unwrap_or(0);
        let codec_type = stream
            .get("codec_type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let codec_name = stream
            .get("codec_name")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let tags = stream.get("tags").and_then(Value::as_object);
        let disposition = stream.get("disposition").and_then(Value::as_object);
        let language = tags
            .and_then(|value| value.get("language"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let title = tags
            .and_then(|value| value.get("title"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let default_track = disposition
            .and_then(|value| value.get("default"))
            .map(json_value_to_bool)
            .unwrap_or(false);
        let forced = disposition
            .and_then(|value| value.get("forced"))
            .map(json_value_to_bool)
            .unwrap_or(false);

        match codec_type {
            "audio" => {
                audio_ordinal += 1;
                audio_tracks.push(VideoTrackInfo {
                    ordinal: audio_ordinal,
                    stream_index,
                    codec_name,
                    language,
                    title,
                    default_track,
                    forced,
                    channels: json_value_to_u32(stream.get("channels")),
                    sample_rate: stream
                        .get("sample_rate")
                        .and_then(Value::as_str)
                        .and_then(|value| value.parse::<u32>().ok()),
                    width: None,
                    height: None,
                });
            }
            "subtitle" => {
                subtitle_ordinal += 1;
                subtitle_tracks.push(VideoTrackInfo {
                    ordinal: subtitle_ordinal,
                    stream_index,
                    codec_name,
                    language,
                    title,
                    default_track,
                    forced,
                    channels: None,
                    sample_rate: None,
                    width: None,
                    height: None,
                });
            }
            "video" => {
                video_ordinal += 1;
                video_tracks.push(VideoTrackInfo {
                    ordinal: video_ordinal,
                    stream_index,
                    codec_name,
                    language,
                    title,
                    default_track,
                    forced,
                    channels: None,
                    sample_rate: None,
                    width: json_value_to_u32(stream.get("width")),
                    height: json_value_to_u32(stream.get("height")),
                });
            }
            _ => {}
        }
    }

    let companion_subtitle_paths = if source.is_file() {
        companion_subtitle_candidates(source)
            .into_iter()
            .filter(|path| path.is_file())
            .map(|path| path.to_string_lossy().to_string())
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    let message = if audio_tracks.len() > 1
        || subtitle_tracks.len() > 0
        || !companion_subtitle_paths.is_empty()
    {
        format!(
            "已探测到 {} 条音轨、{} 条字幕轨，外挂字幕 {} 个。",
            audio_tracks.len(),
            subtitle_tracks.len(),
            companion_subtitle_paths.len()
        )
    } else {
        "已完成媒体探测。".to_string()
    };

    Ok(VideoProbeResult {
        media: media.to_string(),
        duration,
        audio_tracks,
        subtitle_tracks,
        video_tracks,
        companion_subtitle_paths,
        message,
    })
}

#[tauri::command]
pub fn media_take_pending_open(
    request: Option<MediaPendingRequest>,
) -> Result<Option<MediaOpenPayload>, String> {
    let Some(path) = media_pending_path() else {
        return Ok(None);
    };
    if !path.exists() {
        return Ok(None);
    }

    let text =
        std::fs::read_to_string(&path).map_err(|err| format!("读取媒体打开请求失败：{err}"))?;
    let payload = serde_json::from_str::<MediaOpenPayload>(&text)
        .map_err(|err| format!("解析媒体打开请求失败：{err}"))?;
    let expected_kind = request
        .as_ref()
        .and_then(|value| value.kind.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(kind) = expected_kind {
        if payload.kind != kind {
            return Ok(None);
        }
    }

    let _ = std::fs::remove_file(path);
    Ok(Some(payload))
}

#[tauri::command]
pub fn media_file_association_status(
    request: Option<MediaAssociationRequest>,
) -> Result<MediaAssociationStatus, String> {
    file_association_status(normalize_media_kind(request))
}

#[tauri::command]
pub fn media_register_file_associations(
    request: Option<MediaAssociationRequest>,
) -> Result<MediaAssociationStatus, String> {
    let kind = normalize_media_kind(request);
    register_file_associations(kind)?;
    file_association_status(kind)
}

#[tauri::command]
pub fn media_unregister_file_associations(
    request: Option<MediaAssociationRequest>,
) -> Result<MediaAssociationStatus, String> {
    let kind = normalize_media_kind(request);
    unregister_file_associations(kind)?;
    file_association_status(kind)
}

#[tauri::command]
pub fn media_open_default_apps_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", "ms-settings:defaultapps"]);
        apply_no_window(&mut command);
        command
            .spawn()
            .map_err(|err| format!("打开默认应用设置失败：{err}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("当前系统不支持打开 Windows 默认应用设置。".to_string())
    }
}

pub fn pending_media_payload_from_args() -> Option<MediaOpenPayload> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.iter().any(|value| value == "--add") {
        return None;
    }

    if let Some(paths) = collect_after_flag(&args, "--play-video") {
        return build_media_payload("video", paths);
    }
    if let Some(paths) = collect_after_flag(&args, "--play-audio") {
        return build_media_payload("audio", paths);
    }

    let paths = args
        .iter()
        .filter(|value| !value.starts_with("--"))
        .filter(|value| media_kind_for_path(value).is_some())
        .cloned()
        .collect::<Vec<_>>();
    let first_kind = paths.first().and_then(|value| media_kind_for_path(value))?;
    build_media_payload(first_kind, paths)
}

pub fn write_pending_media_payload(payload: &MediaOpenPayload) {
    let Some(path) = media_pending_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string(payload) {
        let _ = std::fs::write(path, text);
    }
}

pub fn pending_media_window_label() -> Option<&'static str> {
    let path = media_pending_path()?;
    let text = std::fs::read_to_string(path).ok()?;
    let payload = serde_json::from_str::<MediaOpenPayload>(&text).ok()?;
    media_window_label(&payload.kind)
}

pub fn media_window_label(kind: &str) -> Option<&'static str> {
    match kind {
        "video" => Some("tool-video-player"),
        "audio" => Some("tool-music-player"),
        _ => None,
    }
}

fn resolve_mpv_path(custom_path: Option<&str>) -> Result<PathBuf, String> {
    if let Some(value) = custom_path {
        let path = PathBuf::from(value.trim_matches('"'));
        if path.is_file() {
            return Ok(path);
        }
        if let Some(runtime) = find_mpv_binary() {
            return Ok(runtime);
        }
        return Err(format!(
            "指定的 mpv.exe 不存在：{}，且未找到内置 MPV 运行时。",
            path.display()
        ));
    }

    find_mpv_binary().ok_or_else(|| {
        "未找到内置 MPV 运行时。请检查资源包是否完整，或手动选择 mpv.exe 作为兜底。".to_string()
    })
}

fn find_mpv_binary() -> Option<PathBuf> {
    find_mpv_in_cache()
        .or_else(ensure_mpv_runtime_from_archive)
        .or_else(find_mpv_in_app_dir)
        .or_else(find_mpv_in_source_tree)
        .or_else(find_mpv_in_path)
        .or_else(find_mpv_common_locations)
}

fn find_mpv_in_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("where.exe");
        command.arg("mpv");
        command
    };

    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut command = Command::new("which");
        command.arg("mpv");
        command
    };

    apply_no_window(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

fn find_mpv_in_app_dir() -> Option<PathBuf> {
    let app_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    [
        app_dir.join("mpv.exe"),
        app_dir.join("bin").join("mpv.exe"),
        app_dir.join("resources").join("mpv").join("mpv.exe"),
        app_dir.join("resources").join("bin").join("mpv.exe"),
        app_dir.join("resources").join("mpv").join("mpv-x86_64.exe"),
        app_dir.join("resources").join("mpv").join("mpv-i686.exe"),
        app_dir
            .join("resources")
            .join("mpv")
            .join("mpv-aarch64.exe"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

fn find_mpv_in_source_tree() -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;
    [
        cwd.join("src-tauri")
            .join("resources")
            .join("mpv")
            .join("mpv.exe"),
        cwd.join("src-tauri")
            .join("resources")
            .join("mpv")
            .join("mpv-x86_64.exe"),
        cwd.join("resources").join("mpv").join("mpv.exe"),
        cwd.join("resources").join("mpv").join("mpv-x86_64.exe"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

fn find_mpv_in_cache() -> Option<PathBuf> {
    cached_mpv_exe_path().filter(|path| path.is_file())
}

fn ensure_mpv_runtime_from_archive() -> Option<PathBuf> {
    let archive = find_mpv_runtime_archive()?;
    let seven_zip = find_7zip_binary_for_runtime()?;
    let output_dir = cached_mpv_dir()?;
    let mpv_exe = output_dir.join("mpv.exe");

    if mpv_exe.is_file() {
        return Some(mpv_exe);
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

    mpv_exe.is_file().then_some(mpv_exe)
}

fn cached_mpv_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|base| base.join(APP_NAME).join(MPV_RUNTIME_CACHE_DIR))
        .or_else(|| {
            Some(
                std::env::temp_dir()
                    .join(APP_NAME)
                    .join(MPV_RUNTIME_CACHE_DIR),
            )
        })
}

fn cached_mpv_exe_path() -> Option<PathBuf> {
    cached_mpv_dir().map(|dir| dir.join("mpv.exe"))
}

fn find_mpv_runtime_archive() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("resources").join("mpv").join(MPV_RUNTIME_ARCHIVE));
            candidates.push(dir.join("mpv").join(MPV_RUNTIME_ARCHIVE));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(
            cwd.join("src-tauri")
                .join("resources")
                .join("mpv")
                .join(MPV_RUNTIME_ARCHIVE),
        );
        candidates.push(cwd.join("resources").join("mpv").join(MPV_RUNTIME_ARCHIVE));
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

fn mpv_origin_label(path: &Path) -> &'static str {
    let lower = path
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    if lower.contains("\\mcstartup\\media-runtime\\mpv\\") || lower.contains("\\resources\\mpv\\") {
        "内置 MPV"
    } else {
        "MPV"
    }
}

fn find_mpv_common_locations() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        let base = PathBuf::from(program_files);
        candidates.push(base.join("mpv").join("mpv.exe"));
        candidates.push(base.join("mpv.net").join("mpv.exe"));
    }
    if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)") {
        let base = PathBuf::from(program_files_x86);
        candidates.push(base.join("mpv").join("mpv.exe"));
        candidates.push(base.join("mpv.net").join("mpv.exe"));
    }
    if let Some(program_data) = std::env::var_os("ProgramData") {
        candidates.push(
            PathBuf::from(program_data)
                .join("chocolatey")
                .join("bin")
                .join("mpv.exe"),
        );
    }
    if let Some(user_profile) = std::env::var_os("USERPROFILE") {
        let base = PathBuf::from(user_profile);
        candidates.push(base.join("scoop").join("shims").join("mpv.exe"));
        candidates.push(
            base.join("scoop")
                .join("apps")
                .join("mpv")
                .join("current")
                .join("mpv.exe"),
        );
    }

    #[cfg(not(target_os = "windows"))]
    {
        candidates.push(PathBuf::from("/usr/bin/mpv"));
        candidates.push(PathBuf::from("/usr/local/bin/mpv"));
        candidates.push(PathBuf::from("/opt/homebrew/bin/mpv"));
    }

    candidates.into_iter().find(|path| path.is_file())
}

fn read_mpv_version(path: &Path) -> Option<String> {
    let mut command = Command::new(path);
    command.arg("--version");
    apply_no_window(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn is_remote_media(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

fn media_pending_path() -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|base| base.join(APP_NAME).join(MEDIA_PENDING_FILE))
}

fn companion_subtitle_candidates(path: &Path) -> Vec<PathBuf> {
    let Some(dir) = path.parent() else {
        return Vec::new();
    };
    let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
        return Vec::new();
    };

    let mut candidates = vec![
        dir.join(format!("{stem}.srt")),
        dir.join(format!("{stem}.ass")),
        dir.join(format!("{stem}.ssa")),
        dir.join(format!("{stem}.vtt")),
        dir.join(format!("{stem}.sub")),
        dir.join(format!("{stem}.idx")),
        dir.join(format!("{stem}.sup")),
        dir.join("subtitle.srt"),
        dir.join("subtitle.ass"),
        dir.join("subtitle.ssa"),
        dir.join("subtitle.vtt"),
        dir.join("subtitles.srt"),
        dir.join("subtitles.ass"),
        dir.join("subtitles.ssa"),
        dir.join("subtitles.vtt"),
    ];

    let lower_stem = stem.to_ascii_lowercase();
    let mut seen = HashSet::new();
    for candidate in candidates.clone() {
        seen.insert(candidate.to_string_lossy().to_string().to_ascii_lowercase());
    }

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let candidate = entry.path();
            if !is_subtitle_extension(&candidate) {
                continue;
            }
            let candidate_stem = candidate
                .file_stem()
                .and_then(|value| value.to_str())
                .map(|value| value.to_ascii_lowercase());
            let Some(candidate_stem) = candidate_stem else {
                continue;
            };
            let matches = candidate_stem == lower_stem
                || candidate_stem.starts_with(&format!("{lower_stem}."))
                || candidate_stem.starts_with(&format!("{lower_stem}_"))
                || candidate_stem.starts_with(&format!("{lower_stem}-"))
                || candidate_stem.contains(&lower_stem);
            if matches {
                let key = candidate.to_string_lossy().to_string().to_ascii_lowercase();
                if seen.insert(key) {
                    candidates.push(candidate);
                }
            }
        }
    }

    candidates
}

fn is_subtitle_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "srt" | "ass" | "ssa" | "vtt" | "sub" | "idx" | "sup"
            )
        })
        .unwrap_or(false)
}

fn json_value_to_u32(value: Option<&Value>) -> Option<u32> {
    let value = value?;
    if let Some(number) = value.as_u64() {
        return Some(number as u32);
    }
    if let Some(number) = value.as_i64() {
        return u32::try_from(number).ok();
    }
    value.as_str().and_then(|text| text.parse::<u32>().ok())
}

fn json_value_to_f64(value: &Value) -> Option<f64> {
    if let Some(number) = value.as_f64() {
        return Some(number);
    }
    value.as_str().and_then(|text| text.parse::<f64>().ok())
}

fn json_value_to_bool(value: &Value) -> bool {
    if let Some(flag) = value.as_bool() {
        return flag;
    }
    if let Some(number) = value.as_u64() {
        return number != 0;
    }
    if let Some(number) = value.as_i64() {
        return number != 0;
    }
    matches!(
        value.as_str().map(|value| value.to_ascii_lowercase()),
        Some(value) if value == "1" || value == "true" || value == "yes"
    )
}

fn collect_after_flag(args: &[String], flag: &str) -> Option<Vec<String>> {
    let index = args.iter().position(|value| value == flag)?;
    let paths = args
        .iter()
        .skip(index + 1)
        .filter(|value| !value.trim().is_empty() && !value.starts_with("--"))
        .filter(|value| media_kind_for_path(value).is_some())
        .cloned()
        .collect::<Vec<_>>();
    Some(paths)
}

fn build_media_payload(kind: &str, paths: Vec<String>) -> Option<MediaOpenPayload> {
    let normalized = paths
        .into_iter()
        .map(|value| value.trim().trim_matches('"').to_string())
        .filter(|value| media_kind_for_path(value) == Some(kind))
        .collect::<Vec<_>>();
    if normalized.is_empty() {
        return None;
    }
    Some(MediaOpenPayload {
        kind: kind.to_string(),
        paths: normalized,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

fn media_kind_for_path(path: &str) -> Option<&'static str> {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        return Some("video");
    }
    if AUDIO_EXTENSIONS.contains(&extension.as_str()) {
        return Some("audio");
    }
    None
}

fn normalize_media_kind(request: Option<MediaAssociationRequest>) -> &'static str {
    match request
        .as_ref()
        .and_then(|value| value.kind.as_deref())
        .map(str::trim)
    {
        Some("audio") => "audio",
        _ => "video",
    }
}

fn media_extensions(kind: &str) -> &'static [&'static str] {
    if kind == "audio" {
        AUDIO_EXTENSIONS
    } else {
        VIDEO_EXTENSIONS
    }
}

fn media_prog_id(kind: &str) -> &'static str {
    if kind == "audio" {
        AUDIO_PROG_ID
    } else {
        VIDEO_PROG_ID
    }
}

fn media_open_flag(kind: &str) -> &'static str {
    if kind == "audio" {
        "--play-audio"
    } else {
        "--play-video"
    }
}

fn file_association_status(kind: &str) -> Result<MediaAssociationStatus, String> {
    #[cfg(target_os = "windows")]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let prog_id = media_prog_id(kind);
        let command_path = format!("Software\\Classes\\{prog_id}\\shell\\open\\command");
        let command = hkcu
            .open_subkey_with_flags(&command_path, KEY_READ)
            .ok()
            .and_then(|key| key.get_value::<String, _>("").ok());

        let mut missing = Vec::new();
        if command
            .as_ref()
            .map(|value| !value.contains(media_open_flag(kind)))
            .unwrap_or(true)
        {
            missing.push(format!("HKCU\\{command_path}"));
        }

        let caps_path = "Software\\McStartUP\\Capabilities\\FileAssociations";
        match hkcu.open_subkey_with_flags(caps_path, KEY_READ) {
            Ok(key) => {
                for extension in media_extensions(kind) {
                    let name = format!(".{extension}");
                    let value = key.get_value::<String, _>(&name).unwrap_or_default();
                    if value != prog_id {
                        missing.push(format!("HKCU\\{caps_path}\\{name}"));
                    }
                }
            }
            Err(_) => missing.push(format!("HKCU\\{caps_path}")),
        }

        let registered_app = hkcu
            .open_subkey_with_flags("Software\\RegisteredApplications", KEY_READ)
            .ok()
            .and_then(|key| key.get_value::<String, _>(APP_NAME).ok())
            .unwrap_or_default();
        if registered_app != "Software\\McStartUP\\Capabilities" {
            missing.push("HKCU\\Software\\RegisteredApplications\\McStartUP".to_string());
        }

        let registered = missing.is_empty();
        let message = if registered {
            "已注册到 Windows 打开方式和默认应用列表。".to_string()
        } else {
            "尚未完整注册到 Windows 打开方式。".to_string()
        };

        return Ok(MediaAssociationStatus {
            registered,
            kind: kind.to_string(),
            extensions: media_extensions(kind)
                .iter()
                .map(|value| format!(".{value}"))
                .collect(),
            command,
            missing,
            can_set_default_directly: false,
            message,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(MediaAssociationStatus {
            registered: false,
            kind: kind.to_string(),
            extensions: media_extensions(kind)
                .iter()
                .map(|value| format!(".{value}"))
                .collect(),
            command: None,
            missing: vec!["当前只实现 Windows 打开方式注册。".to_string()],
            can_set_default_directly: false,
            message: "当前只实现 Windows 打开方式注册。".to_string(),
        })
    }
}

fn register_file_associations(kind: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let exe_path = std::env::current_exe()
            .map_err(|err| format!("获取当前程序路径失败：{err}"))?
            .to_string_lossy()
            .to_string();
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let prog_id = media_prog_id(kind);
        let command = format!("\"{}\" {} \"%1\"", exe_path, media_open_flag(kind));
        let generic_command = format!("\"{}\" \"%1\"", exe_path);

        let prog_key_path = format!("Software\\Classes\\{prog_id}");
        let prog_key = hkcu
            .create_subkey(&prog_key_path)
            .map_err(|err| format!("创建 ProgID 失败：{err}"))?
            .0;
        prog_key
            .set_value(
                "",
                &if kind == "audio" {
                    "McStartUP 音乐"
                } else {
                    "McStartUP 视频"
                },
            )
            .map_err(|err| err.to_string())?;
        prog_key
            .set_value("FriendlyTypeName", &format!("{APP_NAME} 媒体文件"))
            .map_err(|err| err.to_string())?;
        prog_key
            .create_subkey("DefaultIcon")
            .map_err(|err| err.to_string())?
            .0
            .set_value("", &format!("\"{}\",0", exe_path))
            .map_err(|err| err.to_string())?;
        prog_key
            .create_subkey("shell\\open\\command")
            .map_err(|err| err.to_string())?
            .0
            .set_value("", &command)
            .map_err(|err| err.to_string())?;

        let app_key = hkcu
            .create_subkey("Software\\Classes\\Applications\\McStartUP.exe")
            .map_err(|err| err.to_string())?
            .0;
        app_key
            .set_value("FriendlyAppName", &APP_NAME)
            .map_err(|err| err.to_string())?;
        app_key
            .create_subkey("shell\\open\\command")
            .map_err(|err| err.to_string())?
            .0
            .set_value("", &generic_command)
            .map_err(|err| err.to_string())?;
        let supported = app_key
            .create_subkey("SupportedTypes")
            .map_err(|err| err.to_string())?
            .0;

        let capabilities = hkcu
            .create_subkey("Software\\McStartUP\\Capabilities")
            .map_err(|err| err.to_string())?
            .0;
        capabilities
            .set_value("ApplicationName", &APP_NAME)
            .map_err(|err| err.to_string())?;
        capabilities
            .set_value(
                "ApplicationDescription",
                &"McStartUP 内置媒体播放器，可从系统打开方式调用。",
            )
            .map_err(|err| err.to_string())?;
        let file_associations = capabilities
            .create_subkey("FileAssociations")
            .map_err(|err| err.to_string())?
            .0;

        for extension in media_extensions(kind) {
            let dot_ext = format!(".{extension}");
            file_associations
                .set_value(&dot_ext, &prog_id)
                .map_err(|err| err.to_string())?;
            supported
                .set_value(&dot_ext, &"")
                .map_err(|err| err.to_string())?;

            let open_with = hkcu
                .create_subkey(format!("Software\\Classes\\{dot_ext}\\OpenWithProgids"))
                .map_err(|err| err.to_string())?
                .0;
            open_with
                .set_value(prog_id, &"")
                .map_err(|err| err.to_string())?;
        }

        hkcu.create_subkey("Software\\RegisteredApplications")
            .map_err(|err| err.to_string())?
            .0
            .set_value(APP_NAME, &"Software\\McStartUP\\Capabilities")
            .map_err(|err| err.to_string())?;

        notify_shell_assoc_changed();
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = kind;
        Err("当前只实现 Windows 打开方式注册。".to_string())
    }
}

fn unregister_file_associations(kind: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let prog_id = media_prog_id(kind);
        let _ = hkcu.delete_subkey_all(format!("Software\\Classes\\{prog_id}"));

        if let Ok(caps) = hkcu.open_subkey_with_flags(
            "Software\\McStartUP\\Capabilities\\FileAssociations",
            KEY_WRITE,
        ) {
            for extension in media_extensions(kind) {
                let _ = caps.delete_value(format!(".{extension}"));
            }
        }
        if let Ok(app_key) = hkcu.open_subkey_with_flags(
            "Software\\Classes\\Applications\\McStartUP.exe\\SupportedTypes",
            KEY_WRITE,
        ) {
            for extension in media_extensions(kind) {
                let _ = app_key.delete_value(format!(".{extension}"));
            }
        }
        for extension in media_extensions(kind) {
            if let Ok(open_with) = hkcu.open_subkey_with_flags(
                format!("Software\\Classes\\.{extension}\\OpenWithProgids"),
                KEY_WRITE,
            ) {
                let _ = open_with.delete_value(prog_id);
            }
        }

        notify_shell_assoc_changed();
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = kind;
        Err("当前只实现 Windows 打开方式注册。".to_string())
    }
}

#[cfg(target_os = "windows")]
fn notify_shell_assoc_changed() {
    use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
    }
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
