use crate::media_convert::{check_managed_ffmpeg, find_managed_ffmpeg_binary, FfmpegStatus};
use rodio::{Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, Source};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::fs::File;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Default)]
pub struct MusicAudioState {
    session: Mutex<Option<NativeAudioSession>>,
}

struct NativeAudioSession {
    _sink: MixerDeviceSink,
    player: Player,
    path: String,
    duration: Option<f64>,
    engine: AudioEngineDescriptor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AudioBackend {
    Symphonia,
    FfmpegPcm,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioEngineDescriptor {
    id: String,
    label: String,
    family: String,
    strict: bool,
    extensions: Vec<String>,
    backend: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicAudioProbeRequest {
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicAudioProbe {
    extension: String,
    supported: bool,
    engine: Option<AudioEngineDescriptor>,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicMediaContextRequest {
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicMediaContext {
    cue_paths: Vec<String>,
    cover_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicAudioPlayRequest {
    path: String,
    volume: Option<f32>,
    speed: Option<f32>,
    start_paused: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicAudioPlayResult {
    path: String,
    duration: Option<f64>,
    engine: AudioEngineDescriptor,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicAudioSeekRequest {
    position: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicAudioValueRequest {
    value: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicAudioStatus {
    active: bool,
    path: Option<String>,
    duration: Option<f64>,
    position: f64,
    paused: bool,
    ended: bool,
    volume: f32,
    speed: f32,
    engine: Option<AudioEngineDescriptor>,
}

#[tauri::command]
pub fn music_audio_probe(request: MusicAudioProbeRequest) -> Result<MusicAudioProbe, String> {
    let path = request.path.trim();
    let extension = path_extension(path);
    let engine = audio_engine_for_extension(&extension);
    Ok(MusicAudioProbe {
        extension: extension.clone(),
        supported: engine.is_some(),
        engine,
        message: if extension.is_empty() {
            "缺少文件扩展名，已阻止平台兜底。".to_string()
        } else if audio_engine_for_extension(&extension).is_some() {
            "已匹配内置音频核心。".to_string()
        } else {
            format!("暂未接入 .{extension} 的内置核心，已阻止平台兜底。")
        },
    })
}

#[tauri::command]
pub fn music_audio_ffmpeg_status() -> FfmpegStatus {
    check_managed_ffmpeg()
}

#[tauri::command]
pub fn music_media_context(request: MusicMediaContextRequest) -> Result<MusicMediaContext, String> {
    let path = request.path.trim().trim_matches('"');
    if path.is_empty() {
        return Ok(MusicMediaContext {
            cue_paths: vec![],
            cover_path: None,
        });
    }
    let source = Path::new(path);
    if !source.is_file() {
        return Ok(MusicMediaContext {
            cue_paths: vec![],
            cover_path: None,
        });
    }
    let mut cue_paths = Vec::new();
    for candidate in companion_cue_candidates(source) {
        if candidate.is_file() {
            cue_paths.push(candidate.to_string_lossy().to_string());
        }
    }
    let cover_path = companion_cover_path(source).map(|path| path.to_string_lossy().to_string());
    Ok(MusicMediaContext {
        cue_paths,
        cover_path,
    })
}

#[tauri::command]
pub fn music_audio_play(
    state: tauri::State<MusicAudioState>,
    request: MusicAudioPlayRequest,
) -> Result<MusicAudioPlayResult, String> {
    let path = request.path.trim().trim_matches('"');
    if path.is_empty() {
        return Err("缺少音频文件路径。".to_string());
    }
    if !Path::new(path).is_file() {
        return Err(format!("音频文件不存在：{path}"));
    }

    let extension = path_extension(path);
    let engine = audio_engine_for_extension(&extension)
        .ok_or_else(|| format!("未接入 .{extension} 的内置音频核心，已阻止平台兜底。"))?;
    let play_path = if audio_backend(&engine.id) == AudioBackend::FfmpegPcm {
        decode_with_ffmpeg_to_pcm_cache(path, &extension)?
    } else {
        Path::new(path).to_path_buf()
    };

    let file = File::open(&play_path).map_err(|err| format!("打开音频失败：{err}"))?;
    let source = Decoder::try_from(file).map_err(|err| {
        format!(
            "{} 无法解码该文件：{err}。未调用系统播放器或备用平台。",
            engine.label
        )
    })?;
    let duration = source.total_duration().map(|value| value.as_secs_f64());
    let sink = DeviceSinkBuilder::open_default_sink()
        .map_err(|err| format!("初始化音频输出核心失败：{err}"))?;
    let player = Player::connect_new(sink.mixer());
    player.set_volume(request.volume.unwrap_or(0.85).clamp(0.0, 1.0));
    player.set_speed(request.speed.unwrap_or(1.0).clamp(0.25, 4.0));
    player.append(source);
    if request.start_paused.unwrap_or(false) {
        player.pause();
    } else {
        player.play();
    }

    let mut session = state
        .session
        .lock()
        .map_err(|_| "音频核心状态锁定失败。".to_string())?;
    *session = Some(NativeAudioSession {
        _sink: sink,
        player,
        path: path.to_string(),
        duration,
        engine: engine.clone(),
    });

    Ok(MusicAudioPlayResult {
        path: path.to_string(),
        duration,
        engine,
        message: "已使用内置音频核心播放。".to_string(),
    })
}

#[tauri::command]
pub fn music_audio_pause(state: tauri::State<MusicAudioState>) -> Result<(), String> {
    with_session(&state, |session| {
        session.player.pause();
        Ok(())
    })
}

#[tauri::command]
pub fn music_audio_resume(state: tauri::State<MusicAudioState>) -> Result<(), String> {
    with_session(&state, |session| {
        session.player.play();
        Ok(())
    })
}

#[tauri::command]
pub fn music_audio_stop(state: tauri::State<MusicAudioState>) -> Result<(), String> {
    let mut session = state
        .session
        .lock()
        .map_err(|_| "音频核心状态锁定失败。".to_string())?;
    *session = None;
    Ok(())
}

#[tauri::command]
pub fn music_audio_seek(
    state: tauri::State<MusicAudioState>,
    request: MusicAudioSeekRequest,
) -> Result<(), String> {
    with_session(&state, |session| {
        let position = request.position.max(0.0);
        session
            .player
            .try_seek(std::time::Duration::from_secs_f64(position))
            .map_err(|err| format!("音频核心 seek 失败：{err}"))
    })
}

#[tauri::command]
pub fn music_audio_set_volume(
    state: tauri::State<MusicAudioState>,
    request: MusicAudioValueRequest,
) -> Result<(), String> {
    with_session(&state, |session| {
        session.player.set_volume(request.value.clamp(0.0, 1.0));
        Ok(())
    })
}

#[tauri::command]
pub fn music_audio_set_speed(
    state: tauri::State<MusicAudioState>,
    request: MusicAudioValueRequest,
) -> Result<(), String> {
    with_session(&state, |session| {
        session.player.set_speed(request.value.clamp(0.25, 4.0));
        Ok(())
    })
}

#[tauri::command]
pub fn music_audio_status(
    state: tauri::State<MusicAudioState>,
) -> Result<MusicAudioStatus, String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "音频核心状态锁定失败。".to_string())?;
    let Some(session) = session.as_ref() else {
        return Ok(MusicAudioStatus {
            active: false,
            path: None,
            duration: None,
            position: 0.0,
            paused: true,
            ended: false,
            volume: 0.0,
            speed: 1.0,
            engine: None,
        });
    };

    Ok(MusicAudioStatus {
        active: true,
        path: Some(session.path.clone()),
        duration: session.duration,
        position: session.player.get_pos().as_secs_f64(),
        paused: session.player.is_paused(),
        ended: session.player.empty(),
        volume: session.player.volume(),
        speed: session.player.speed(),
        engine: Some(session.engine.clone()),
    })
}

fn with_session<T>(
    state: &tauri::State<MusicAudioState>,
    action: impl FnOnce(&mut NativeAudioSession) -> Result<T, String>,
) -> Result<T, String> {
    let mut session = state
        .session
        .lock()
        .map_err(|_| "音频核心状态锁定失败。".to_string())?;
    let session = session
        .as_mut()
        .ok_or_else(|| "没有正在运行的内置音频核心。".to_string())?;
    action(session)
}

fn path_extension(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn audio_engine_for_extension(extension: &str) -> Option<AudioEngineDescriptor> {
    let (id, label, family, extensions, backend): (&str, &str, &str, &[&str], AudioBackend) =
        match extension {
            "mp3" => (
                "symphonia-mpeg",
                "Symphonia MPEG 音频核心",
                "MPEG Layer III",
                &["mp3"],
                AudioBackend::Symphonia,
            ),
            "mp1" | "mp2" => (
                "ffmpeg-mpeg-audio",
                "FFmpeg MPEG 音频解码核心",
                "MPEG Layer I/II",
                &["mp1", "mp2"],
                AudioBackend::FfmpegPcm,
            ),
            "flac" => (
                "symphonia-flac",
                "Symphonia FLAC 无损核心",
                "FLAC Lossless",
                &["flac"],
                AudioBackend::Symphonia,
            ),
            "wav" | "wave" => (
                "symphonia-pcm",
                "Symphonia PCM/WAV 核心",
                "PCM/WAV",
                &["wav", "wave"],
                AudioBackend::Symphonia,
            ),
            "m4a" | "mp4a" | "aac" | "adts" | "m4b" => (
                "symphonia-aac",
                "Symphonia AAC/MP4 音频核心",
                "AAC/ISO-MP4",
                &["m4a", "mp4a", "aac", "adts", "m4b"],
                AudioBackend::Symphonia,
            ),
            "alac" => (
                "symphonia-alac",
                "Symphonia ALAC 无损核心",
                "Apple Lossless",
                &["alac"],
                AudioBackend::Symphonia,
            ),
            "ogg" | "oga" => (
                "symphonia-ogg-vorbis",
                "Symphonia Ogg/Vorbis 核心",
                "Ogg/Vorbis",
                &["ogg", "oga"],
                AudioBackend::Symphonia,
            ),
            "opus" => (
                "ffmpeg-opus",
                "FFmpeg Opus 解码核心",
                "Opus",
                &["opus"],
                AudioBackend::FfmpegPcm,
            ),
            "wma" | "asf" | "wm" => (
                "ffmpeg-wma",
                "FFmpeg Windows Media Audio 解码核心",
                "Windows Media Audio",
                &["wma", "asf", "wm"],
                AudioBackend::FfmpegPcm,
            ),
            "ape" => (
                "ffmpeg-ape",
                "FFmpeg Monkey's Audio 解码核心",
                "Monkey's Audio",
                &["ape"],
                AudioBackend::FfmpegPcm,
            ),
            "amr" | "3ga" => (
                "ffmpeg-amr",
                "FFmpeg AMR 语音音频解码核心",
                "AMR",
                &["amr", "3ga"],
                AudioBackend::FfmpegPcm,
            ),
            "ac3" | "eac3" => (
                "ffmpeg-dolby",
                "FFmpeg Dolby AC-3 解码核心",
                "AC-3/E-AC-3",
                &["ac3", "eac3"],
                AudioBackend::FfmpegPcm,
            ),
            "dts" => (
                "ffmpeg-dts",
                "FFmpeg DTS 解码核心",
                "DTS",
                &["dts"],
                AudioBackend::FfmpegPcm,
            ),
            "tta" => (
                "ffmpeg-tta",
                "FFmpeg TTA 无损解码核心",
                "True Audio",
                &["tta"],
                AudioBackend::FfmpegPcm,
            ),
            "tak" => (
                "ffmpeg-tak",
                "FFmpeg TAK 无损解码核心",
                "Tom's lossless Audio",
                &["tak"],
                AudioBackend::FfmpegPcm,
            ),
            "mpc" | "mpp" => (
                "ffmpeg-musepack",
                "FFmpeg Musepack 解码核心",
                "Musepack",
                &["mpc", "mpp"],
                AudioBackend::FfmpegPcm,
            ),
            "ra" | "rm" => (
                "ffmpeg-realaudio",
                "FFmpeg RealAudio 解码核心",
                "RealAudio",
                &["ra", "rm"],
                AudioBackend::FfmpegPcm,
            ),
            "au" | "snd" => (
                "ffmpeg-sun-au",
                "FFmpeg AU/SND 解码核心",
                "Sun/NeXT AU",
                &["au", "snd"],
                AudioBackend::FfmpegPcm,
            ),
            "aiff" | "aif" | "aifc" => (
                "symphonia-aiff",
                "Symphonia AIFF/PCM 核心",
                "AIFF",
                &["aiff", "aif", "aifc"],
                AudioBackend::Symphonia,
            ),
            "caf" => (
                "ffmpeg-caf",
                "FFmpeg Core Audio Format 解码核心",
                "Core Audio Format",
                &["caf"],
                AudioBackend::FfmpegPcm,
            ),
            "mka" => (
                "symphonia-matroska",
                "Symphonia Matroska 音频核心",
                "Matroska Audio",
                &["mka"],
                AudioBackend::Symphonia,
            ),
            _ => return None,
        };

    Some(AudioEngineDescriptor {
        id: id.to_string(),
        label: label.to_string(),
        family: family.to_string(),
        strict: true,
        extensions: extensions.iter().map(|value| format!(".{value}")).collect(),
        backend: match backend {
            AudioBackend::Symphonia => "symphonia".to_string(),
            AudioBackend::FfmpegPcm => "ffmpeg-pcm".to_string(),
        },
    })
}

fn companion_cue_candidates(path: &Path) -> Vec<PathBuf> {
    let stem = path.with_extension("");
    let mut candidates = Vec::new();
    candidates.push(stem.with_extension("cue"));
    if let Some(parent) = path.parent() {
        if let Some(file_stem) = path.file_stem().and_then(|value| value.to_str()) {
            for name in [
                format!("{file_stem}.cue"),
                "album.cue".to_string(),
                "disc.cue".to_string(),
            ] {
                candidates.push(parent.join(name));
            }
        }
    }
    candidates
}

fn companion_cover_path(path: &Path) -> Option<PathBuf> {
    let dir = path.parent()?;
    let candidates = [
        "cover.jpg",
        "cover.jpeg",
        "cover.png",
        "folder.jpg",
        "folder.jpeg",
        "folder.png",
        "front.jpg",
        "front.jpeg",
        "front.png",
        "album.jpg",
        "album.jpeg",
        "album.png",
    ];
    candidates
        .iter()
        .map(|name| dir.join(name))
        .find(|candidate| candidate.is_file())
        .or_else(|| {
            fs::read_dir(dir).ok().and_then(|entries| {
                entries
                    .flatten()
                    .map(|entry| entry.path())
                    .find(|candidate| {
                        candidate
                            .extension()
                            .and_then(|value| value.to_str())
                            .map(|ext| {
                                matches!(ext.to_ascii_lowercase().as_str(), "jpg" | "jpeg" | "png")
                            })
                            .unwrap_or(false)
                            && candidate
                                .file_stem()
                                .and_then(|value| value.to_str())
                                .map(|stem| {
                                    let lower = stem.to_ascii_lowercase();
                                    lower.contains("cover")
                                        || lower.contains("folder")
                                        || lower.contains("front")
                                        || lower.contains("album")
                                })
                                .unwrap_or(false)
                    })
            })
        })
}

fn audio_backend(engine_id: &str) -> AudioBackend {
    if engine_id.starts_with("ffmpeg-") {
        AudioBackend::FfmpegPcm
    } else {
        AudioBackend::Symphonia
    }
}

fn decode_with_ffmpeg_to_pcm_cache(
    path: &str,
    extension: &str,
) -> Result<std::path::PathBuf, String> {
    let ffmpeg = find_managed_ffmpeg_binary().ok_or_else(|| {
        format!(
            ".{extension} 需要内置 FFmpeg full build 扩展核心，但当前未检测到 resources/ffmpeg/ffmpeg-runtime.7z 或缓存核心。未调用系统播放器、浏览器或 PATH 兜底。"
        )
    })?;
    let cache_path = pcm_cache_path(path, extension)?;
    if cache_path.is_file() && cache_path.metadata().map(|m| m.len()).unwrap_or(0) > 44 {
        return Ok(cache_path);
    }
    if let Some(parent) = cache_path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| format!("创建音频缓存目录失败：{err}"))?;
    }

    let mut command = Command::new(ffmpeg);
    command.args([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        path,
        "-vn",
        "-map",
        "0:a:0",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-f",
        "wav",
    ]);
    command.arg(&cache_path);
    apply_no_window(&mut command);

    let output = command
        .output()
        .map_err(|err| format!("启动 FFmpeg 音频核心失败：{err}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let _ = std::fs::remove_file(&cache_path);
        return Err(if detail.is_empty() {
            format!("FFmpeg 音频核心无法解码 .{extension} 文件。")
        } else {
            format!("FFmpeg 音频核心无法解码 .{extension} 文件：{detail}")
        });
    }
    Ok(cache_path)
}

fn pcm_cache_path(path: &str, extension: &str) -> Result<std::path::PathBuf, String> {
    let source = Path::new(path);
    let metadata = source
        .metadata()
        .map_err(|err| format!("读取源音频信息失败：{err}"))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or(0);

    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    extension.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    modified.hash(&mut hasher);
    let file_name = format!("{:016x}.wav", hasher.finish());

    Ok(app_cache_dir()?.join("music_pcm_cache").join(file_name))
}

fn app_cache_dir() -> Result<std::path::PathBuf, String> {
    if let Some(app_data) = std::env::var_os("APPDATA") {
        return Ok(std::path::PathBuf::from(app_data).join("McStartUP"));
    }
    Ok(std::env::temp_dir().join("McStartUP"))
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
