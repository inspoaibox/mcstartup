use crate::media_convert::find_ffmpeg_binary;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static RECORDING_SESSION: OnceLock<Mutex<Option<RecordingSession>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordableWindow {
    pub hwnd: String,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub minimized: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenRecordingOptions {
    pub source_mode: String,
    pub screen_index: Option<usize>,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub hwnd: Option<String>,
    pub output_path: String,
    pub fps: Option<u32>,
    pub quality: Option<String>,
    pub draw_mouse: Option<bool>,
    pub audio_mode: Option<String>,
    pub audio_device: Option<String>,
    pub audio_device2: Option<String>,
    pub watermark: Option<ScreenRecordingWatermarkOptions>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenRecordingWatermarkOptions {
    pub enabled: Option<bool>,
    pub kind: Option<String>,
    pub text: Option<String>,
    pub image_path: Option<String>,
    pub mode: Option<String>,
    pub motion: Option<String>,
    pub layout: Option<String>,
    pub position: Option<String>,
    pub font_size: Option<u32>,
    pub color: Option<String>,
    pub opacity: Option<f32>,
    pub angle: Option<f32>,
    pub margin: Option<i32>,
    pub spacing_x: Option<i32>,
    pub spacing_y: Option<i32>,
    pub image_width: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenRecordingStatus {
    pub active: bool,
    pub paused: bool,
    pub source_mode: Option<String>,
    pub audio_mode: Option<String>,
    pub output_path: Option<String>,
    pub started_at: Option<u128>,
    pub elapsed_ms: u128,
    pub paused_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenRecordingStopResult {
    pub output_path: String,
    pub file_size: Option<u64>,
    pub elapsed_ms: u128,
}

struct RecordingSession {
    child: Child,
    source_mode: String,
    audio_mode: String,
    output_path: String,
    started_at: Instant,
    paused: bool,
    pause_started_at: Option<Instant>,
    accumulated_paused: Duration,
}

#[tauri::command]
pub fn screen_recording_default_output_path(format: Option<String>) -> Result<String, String> {
    let format = normalize_format(format.as_deref().unwrap_or("mp4"));
    let dir = dirs::video_dir()
        .or_else(dirs::desktop_dir)
        .or_else(dirs::download_dir)
        .unwrap_or_else(std::env::temp_dir);
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    Ok(dir
        .join(format!("screen-recording-{}.{}", stamp, format))
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub fn screen_recording_get_status() -> Result<ScreenRecordingStatus, String> {
    let session_mutex = RECORDING_SESSION.get_or_init(|| Mutex::new(None));
    let mut guard = session_mutex
        .lock()
        .map_err(|_| "录制状态锁定失败".to_string())?;

    if let Some(session) = guard.as_mut() {
        if session
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_some()
        {
            *guard = None;
            return Ok(inactive_status());
        }

        return Ok(ScreenRecordingStatus {
            active: true,
            paused: session.paused,
            source_mode: Some(session.source_mode.clone()),
            audio_mode: Some(session.audio_mode.clone()),
            output_path: Some(session.output_path.clone()),
            started_at: None,
            elapsed_ms: session_elapsed_ms(session),
            paused_ms: session_paused_duration(session).as_millis(),
        });
    }

    Ok(inactive_status())
}

#[tauri::command]
pub fn screen_recording_list_windows() -> Result<Vec<RecordableWindow>, String> {
    list_recordable_windows()
}

#[tauri::command]
pub fn screen_recording_list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    list_audio_devices()
}

#[tauri::command]
pub fn screen_recording_start(
    options: ScreenRecordingOptions,
) -> Result<ScreenRecordingStatus, String> {
    let session_mutex = RECORDING_SESSION.get_or_init(|| Mutex::new(None));
    let mut guard = session_mutex
        .lock()
        .map_err(|_| "录制状态锁定失败".to_string())?;

    if let Some(session) = guard.as_mut() {
        if session
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_none()
        {
            return Err("已有屏幕录制正在进行".to_string());
        }
        *guard = None;
    }

    let output_path = options.output_path.trim();
    if output_path.is_empty() {
        return Err("请选择输出文件".to_string());
    }
    if let Some(parent) = Path::new(output_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {}", e))?;
    }

    let ffmpeg =
        find_ffmpeg_binary().ok_or_else(|| "未找到 FFmpeg，请先安装 FFmpeg".to_string())?;
    let args = build_ffmpeg_args(&options)?;

    let mut command = Command::new(ffmpeg);
    command
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|e| format!("启动 FFmpeg 录制失败: {}", e))?;

    std::thread::sleep(Duration::from_millis(450));
    if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
        let mut stderr = String::new();
        if let Some(mut reader) = child.stderr.take() {
            let _ = reader.read_to_string(&mut stderr);
        }
        let detail = stderr.lines().take(6).collect::<Vec<_>>().join(" ");
        return Err(if detail.trim().is_empty() {
            format!("FFmpeg 录制进程已退出: {}", status)
        } else {
            format!("FFmpeg 录制进程已退出: {}，{}", status, detail)
        });
    }

    let source_mode = options.source_mode.clone();
    let audio_mode = normalize_audio_mode(options.audio_mode.as_deref());
    let output_path = output_path.to_string();
    *guard = Some(RecordingSession {
        child,
        source_mode: source_mode.clone(),
        audio_mode: audio_mode.clone(),
        output_path: output_path.clone(),
        started_at: Instant::now(),
        paused: false,
        pause_started_at: None,
        accumulated_paused: Duration::from_millis(0),
    });

    Ok(ScreenRecordingStatus {
        active: true,
        paused: false,
        source_mode: Some(source_mode),
        audio_mode: Some(audio_mode),
        output_path: Some(output_path),
        started_at: None,
        elapsed_ms: 0,
        paused_ms: 0,
    })
}

#[tauri::command]
pub fn screen_recording_stop() -> Result<ScreenRecordingStopResult, String> {
    let session_mutex = RECORDING_SESSION.get_or_init(|| Mutex::new(None));
    let mut guard = session_mutex
        .lock()
        .map_err(|_| "录制状态锁定失败".to_string())?;
    let mut session = guard.take().ok_or_else(|| "当前没有录制任务".to_string())?;

    if session.paused {
        let _ = set_process_suspended(session.child.id(), false);
        if let Some(started_at) = session.pause_started_at.take() {
            session.accumulated_paused += started_at.elapsed();
        }
        session.paused = false;
    }

    let elapsed_ms = session_elapsed_ms(&session);
    if let Some(stdin) = session.child.stdin.as_mut() {
        let _ = stdin.write_all(b"q\n");
        let _ = stdin.flush();
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if session
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_some()
        {
            break;
        }
        if Instant::now() >= deadline {
            let _ = session.child.kill();
            let _ = session.child.wait();
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    let file_size = std::fs::metadata(&session.output_path)
        .ok()
        .map(|m| m.len());
    Ok(ScreenRecordingStopResult {
        output_path: session.output_path,
        file_size,
        elapsed_ms,
    })
}

#[tauri::command]
pub fn screen_recording_pause() -> Result<ScreenRecordingStatus, String> {
    set_recording_paused(true)
}

#[tauri::command]
pub fn screen_recording_resume() -> Result<ScreenRecordingStatus, String> {
    set_recording_paused(false)
}

fn inactive_status() -> ScreenRecordingStatus {
    ScreenRecordingStatus {
        active: false,
        paused: false,
        source_mode: None,
        audio_mode: None,
        output_path: None,
        started_at: None,
        elapsed_ms: 0,
        paused_ms: 0,
    }
}

fn session_paused_duration(session: &RecordingSession) -> Duration {
    if session.paused {
        session.accumulated_paused
            + session
                .pause_started_at
                .map(|started_at| started_at.elapsed())
                .unwrap_or_default()
    } else {
        session.accumulated_paused
    }
}

fn session_elapsed_ms(session: &RecordingSession) -> u128 {
    session
        .started_at
        .elapsed()
        .saturating_sub(session_paused_duration(session))
        .as_millis()
}

fn normalize_audio_mode(value: Option<&str>) -> String {
    match value.unwrap_or("none").trim().to_ascii_lowercase().as_str() {
        "microphone" => "microphone".to_string(),
        "system" => "system".to_string(),
        "mixed" => "mixed".to_string(),
        _ => "none".to_string(),
    }
}

fn set_recording_paused(paused: bool) -> Result<ScreenRecordingStatus, String> {
    let session_mutex = RECORDING_SESSION.get_or_init(|| Mutex::new(None));
    let mut guard = session_mutex
        .lock()
        .map_err(|_| "录制状态锁定失败".to_string())?;
    let session = guard
        .as_mut()
        .ok_or_else(|| "当前没有录制任务".to_string())?;

    if session
        .child
        .try_wait()
        .map_err(|e| e.to_string())?
        .is_some()
    {
        *guard = None;
        return Ok(inactive_status());
    }

    if paused == session.paused {
        return Ok(ScreenRecordingStatus {
            active: true,
            paused: session.paused,
            source_mode: Some(session.source_mode.clone()),
            audio_mode: Some(session.audio_mode.clone()),
            output_path: Some(session.output_path.clone()),
            started_at: None,
            elapsed_ms: session_elapsed_ms(session),
            paused_ms: session_paused_duration(session).as_millis(),
        });
    }

    set_process_suspended(session.child.id(), paused)?;

    if paused {
        session.paused = true;
        session.pause_started_at = Some(Instant::now());
    } else {
        if let Some(started_at) = session.pause_started_at.take() {
            session.accumulated_paused += started_at.elapsed();
        }
        session.paused = false;
    }

    Ok(ScreenRecordingStatus {
        active: true,
        paused: session.paused,
        source_mode: Some(session.source_mode.clone()),
        audio_mode: Some(session.audio_mode.clone()),
        output_path: Some(session.output_path.clone()),
        started_at: None,
        elapsed_ms: session_elapsed_ms(session),
        paused_ms: session_paused_duration(session).as_millis(),
    })
}

fn build_ffmpeg_args(options: &ScreenRecordingOptions) -> Result<Vec<String>, String> {
    let fps = options.fps.unwrap_or(30).clamp(5, 120);
    let draw_mouse = if options.draw_mouse.unwrap_or(true) {
        "1"
    } else {
        "0"
    };
    let output_path = options.output_path.trim();
    let quality = options.quality.as_deref().unwrap_or("balanced");
    let watermark = normalized_watermark(options.watermark.as_ref())?;
    let mut capture_width = 0i32;
    let mut capture_height = 0i32;

    let mut args = vec![
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-rtbufsize".to_string(),
        "512M".to_string(),
        "-f".to_string(),
        "gdigrab".to_string(),
        "-draw_mouse".to_string(),
        draw_mouse.to_string(),
        "-use_wallclock_as_timestamps".to_string(),
        "1".to_string(),
        "-framerate".to_string(),
        fps.to_string(),
    ];

    match options.source_mode.as_str() {
        "fullscreen" => {
            let screens = crate::screenshot_tool::get_screens_info()?;
            let screen = options
                .screen_index
                .and_then(|index| screens.iter().find(|screen| screen.index == index))
                .or_else(|| screens.iter().find(|screen| screen.is_primary))
                .or_else(|| screens.first())
                .ok_or_else(|| "未找到可录制屏幕".to_string())?;
            capture_width = screen.width as i32;
            capture_height = screen.height as i32;
            args.extend([
                "-offset_x".to_string(),
                screen.x.to_string(),
                "-offset_y".to_string(),
                screen.y.to_string(),
                "-video_size".to_string(),
                format!("{}x{}", screen.width, screen.height),
                "-i".to_string(),
                "desktop".to_string(),
            ]);
        }
        "region" => {
            let x = options.x.unwrap_or(0);
            let y = options.y.unwrap_or(0);
            let width = options.width.unwrap_or(0);
            let height = options.height.unwrap_or(0);
            if width < 16 || height < 16 {
                return Err("录制区域过小，请重新选择".to_string());
            }
            capture_width = width;
            capture_height = height;
            args.extend([
                "-offset_x".to_string(),
                x.to_string(),
                "-offset_y".to_string(),
                y.to_string(),
                "-video_size".to_string(),
                format!("{}x{}", width, height),
                "-i".to_string(),
                "desktop".to_string(),
            ]);
        }
        "window" => {
            let hwnd = options
                .hwnd
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "请选择要录制的软件窗口".to_string())?;
            if let Some((width, height)) = get_window_size_by_hwnd_value(hwnd) {
                capture_width = width;
                capture_height = height;
            }
            args.extend(["-i".to_string(), format!("hwnd={}", hwnd)]);
        }
        _ => return Err("未知录制来源".to_string()),
    }

    let mut image_input_index = None;
    if let Some(watermark) = watermark.as_ref() {
        if watermark.kind.as_deref() == Some("image") {
            let image_path = watermark
                .image_path
                .as_deref()
                .ok_or_else(|| "请选择水印图片".to_string())?;
            if !Path::new(image_path).exists() {
                return Err("水印图片不存在".to_string());
            }
            image_input_index = Some(1usize);
            args.extend([
                "-loop".to_string(),
                "1".to_string(),
                "-i".to_string(),
                image_path.to_string(),
            ]);
        }
    }

    let output_ext = PathBuf::from(output_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(normalize_format)
        .unwrap_or_else(|| "mp4".to_string());
    let audio_mode = if output_ext == "gif" {
        "none".to_string()
    } else {
        normalize_audio_mode(options.audio_mode.as_deref())
    };
    let audio_inputs = audio_input_args(options, &audio_mode)?;
    let audio_input_count = audio_inputs.len();
    for input in audio_inputs {
        args.extend(input);
    }

    let audio_start_index = if image_input_index.is_some() { 2 } else { 1 };
    args.extend(filter_and_map_args(
        output_path,
        watermark.as_ref(),
        capture_width,
        capture_height,
        image_input_index,
        audio_start_index,
        audio_input_count,
        fps,
    ));
    args.extend(["-vsync".to_string(), "vfr".to_string()]);
    args.extend(output_encoder_args(output_path, quality));
    args.push(output_path.to_string());
    Ok(args)
}

fn audio_input_args(
    options: &ScreenRecordingOptions,
    audio_mode: &str,
) -> Result<Vec<Vec<String>>, String> {
    match audio_mode {
        "microphone" | "system" => {
            let device = options
                .audio_device
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "请选择音频设备".to_string())?;
            Ok(vec![audio_input_for_device(device)])
        }
        "mixed" => {
            let device1 = options
                .audio_device
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "请选择第一个音频设备".to_string())?;
            let device2 = options
                .audio_device2
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "请选择第二个音频设备".to_string())?;
            Ok(vec![
                audio_input_for_device(device1),
                audio_input_for_device(device2),
            ])
        }
        _ => Ok(Vec::new()),
    }
}

fn audio_input_for_device(device: &str) -> Vec<String> {
    let device = device.trim();
    vec![
        "-thread_queue_size".to_string(),
        "512".to_string(),
        "-f".to_string(),
        "dshow".to_string(),
        "-i".to_string(),
        format!("audio={}", device),
    ]
}

fn filter_and_map_args(
    output_path: &str,
    watermark: Option<&ScreenRecordingWatermarkOptions>,
    capture_width: i32,
    capture_height: i32,
    image_input_index: Option<usize>,
    audio_start_index: usize,
    audio_input_count: usize,
    fps: u32,
) -> Vec<String> {
    let ext = PathBuf::from(output_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(normalize_format)
        .unwrap_or_else(|| "mp4".to_string());
    let mut chains = vec!["[0:v]pad=ceil(iw/2)*2:ceil(ih/2)*2[vbase]".to_string()];
    let mut video_label = "vbase".to_string();
    if let Some(watermark) = watermark {
        if watermark.kind.as_deref() == Some("image") {
            if let Some(index) = image_input_index {
                chains.extend(image_watermark_chains(
                    watermark,
                    index,
                    &video_label,
                    capture_width,
                    capture_height,
                ));
                video_label = "vout".to_string();
            }
        } else {
            chains.extend(text_watermark_chains(
                watermark,
                &video_label,
                capture_width,
                capture_height,
            ));
            video_label = "vout".to_string();
        }
    }

    let mut audio_codec_args = Vec::new();
    if audio_input_count == 1 {
        let input_index = audio_start_index;
        audio_codec_args.extend([
            "-map".to_string(),
            format!("{}:a", input_index),
            "-c:a".to_string(),
            audio_codec(output_path).0.to_string(),
            "-b:a".to_string(),
            audio_codec(output_path).1.to_string(),
            "-shortest".to_string(),
        ]);
    } else if audio_input_count >= 2 {
        let first = audio_start_index;
        let second = audio_start_index + 1;
        chains.push(format!(
            "[{}:a][{}:a]amix=inputs=2:duration=longest:dropout_transition=2[aout]",
            first, second
        ));
        audio_codec_args.extend([
            "-map".to_string(),
            "[aout]".to_string(),
            "-c:a".to_string(),
            audio_codec(output_path).0.to_string(),
            "-b:a".to_string(),
            audio_codec(output_path).1.to_string(),
            "-shortest".to_string(),
        ]);
    }

    let mut args = Vec::new();
    if ext == "gif" {
        let gif_fps = fps.clamp(5, 30).to_string();
        chains.push(format!(
            "[{}]fps={},split[gif_a][gif_b];[gif_a]palettegen=stats_mode=diff[gif_p];[gif_b][gif_p]paletteuse=dither=bayer:bayer_scale=3[vout_gif]",
            video_label, gif_fps
        ));
        args.extend([
            "-filter_complex".to_string(),
            chains.join(";"),
            "-map".to_string(),
            "[vout_gif]".to_string(),
            "-an".to_string(),
        ]);
    } else {
        args.extend([
            "-filter_complex".to_string(),
            chains.join(";"),
            "-map".to_string(),
            format!("[{}]", video_label),
        ]);
    }
    args.extend(audio_codec_args);
    args
}

fn audio_codec(output_path: &str) -> (&'static str, &'static str) {
    let ext = PathBuf::from(output_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(normalize_format)
        .unwrap_or_else(|| "mp4".to_string());
    if ext == "webm" {
        ("libopus", "128k")
    } else {
        ("aac", "160k")
    }
}

fn normalized_watermark(
    value: Option<&ScreenRecordingWatermarkOptions>,
) -> Result<Option<ScreenRecordingWatermarkOptions>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if !value.enabled.unwrap_or(false) {
        return Ok(None);
    }

    let kind = normalize_option(value.kind.as_deref(), &["text", "image"], "text");
    if kind == "text" {
        let text = value.text.as_deref().unwrap_or("").trim();
        if text.is_empty() {
            return Err("请输入水印文字".to_string());
        }
    } else {
        let image_path = value.image_path.as_deref().unwrap_or("").trim();
        if image_path.is_empty() {
            return Err("请选择水印图片".to_string());
        }
    }

    Ok(Some(ScreenRecordingWatermarkOptions {
        enabled: Some(true),
        kind: Some(kind),
        text: value.text.clone(),
        image_path: value.image_path.clone(),
        mode: Some(normalize_option(
            value.mode.as_deref(),
            &["static", "dynamic"],
            "static",
        )),
        motion: Some(normalize_option(
            value.motion.as_deref(),
            &["none", "horizontal", "vertical", "diagonal", "blink"],
            "horizontal",
        )),
        layout: Some(normalize_option(
            value.layout.as_deref(),
            &["single", "tile"],
            "single",
        )),
        position: Some(normalize_option(
            value.position.as_deref(),
            &[
                "top-left",
                "top",
                "top-right",
                "left",
                "center",
                "right",
                "bottom-left",
                "bottom",
                "bottom-right",
            ],
            "bottom-right",
        )),
        font_size: Some(value.font_size.unwrap_or(28).clamp(10, 120)),
        color: Some(normalize_color(value.color.as_deref().unwrap_or("#ffffff"))),
        opacity: Some(value.opacity.unwrap_or(0.45).clamp(0.05, 1.0)),
        angle: Some(value.angle.unwrap_or(0.0).clamp(-180.0, 180.0)),
        margin: Some(value.margin.unwrap_or(24).clamp(0, 300)),
        spacing_x: Some(value.spacing_x.unwrap_or(220).clamp(40, 1000)),
        spacing_y: Some(value.spacing_y.unwrap_or(140).clamp(40, 1000)),
        image_width: Some(value.image_width.unwrap_or(180).clamp(24, 1200)),
    }))
}

fn normalize_option(value: Option<&str>, allowed: &[&str], fallback: &str) -> String {
    let value = value.unwrap_or(fallback).trim().to_ascii_lowercase();
    if allowed.iter().any(|item| *item == value) {
        value
    } else {
        fallback.to_string()
    }
}

fn normalize_color(value: &str) -> String {
    let value = value.trim();
    let hex = value.strip_prefix('#').unwrap_or(value);
    if hex.len() == 6 && hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        format!("0x{}", hex)
    } else {
        "0xffffff".to_string()
    }
}

fn text_watermark_chains(
    watermark: &ScreenRecordingWatermarkOptions,
    input_label: &str,
    capture_width: i32,
    capture_height: i32,
) -> Vec<String> {
    let text = escape_drawtext_text(watermark.text.as_deref().unwrap_or(""));
    let color = watermark.color.as_deref().unwrap_or("0xffffff");
    let alpha = alpha_expression(watermark);
    let font_size = watermark.font_size.unwrap_or(28);
    let spacing_x = watermark.spacing_x.unwrap_or(220);
    let spacing_y = watermark.spacing_y.unwrap_or(140);
    let font_file = watermark_font_file_expr();
    let (base_w, base_h) = watermark_canvas_size(capture_width, capture_height);
    let canvas_w = if watermark.layout.as_deref() == Some("tile") {
        base_w + spacing_x
    } else {
        (font_size as i32 * text.chars().count().max(1) as i32).clamp(180, base_w.max(360))
    };
    let canvas_h = if watermark.layout.as_deref() == Some("tile") {
        base_h + spacing_y
    } else {
        (font_size as i32 * 3).clamp(80, 260)
    };
    let angle = watermark.angle.unwrap_or(0.0);
    let mut chains = vec![format!(
        "color=c=black@0.0:s={}x{},format=rgba[wmtext_base]",
        canvas_w, canvas_h
    )];

    if watermark.layout.as_deref() == Some("tile") {
        let positions = tile_positions(canvas_w, canvas_h, spacing_x, spacing_y);
        let mut previous = "wmtext_base".to_string();
        for (index, (x, y)) in positions.iter().enumerate() {
            let next = format!("wmtext_tile_{}", index);
            chains.push(format!(
                "[{}]drawtext=fontfile='{}':text='{}':fontsize={}:fontcolor={}@{}:box=1:boxcolor=0x000000@{}:boxborderw=8:x={}:y={}[{}]",
                previous,
                font_file,
                text,
                font_size,
                color,
                alpha,
                watermark_box_alpha(&alpha),
                x,
                y,
                next
            ));
            previous = next;
        }
        chains.push(format!("[{}]null[wmtext0]", previous));
    } else {
        chains.push(format!(
            "[wmtext_base]drawtext=fontfile='{}':text='{}':fontsize={}:fontcolor={}@{}:box=1:boxcolor=0x000000@{}:boxborderw=8:x=(w-text_w)/2:y=(h-text_h)/2[wmtext0]",
            font_file,
            text,
            font_size,
            color,
            alpha,
            watermark_box_alpha(&alpha)
        ));
    }

    let wm_label = if angle.abs() > 0.1 {
        let rad = angle.to_radians();
        chains.push(format!(
            "[wmtext0]rotate={}:c=none:ow=rotw({}):oh=roth({})[wmtext]",
            rad, rad, rad
        ));
        "wmtext"
    } else {
        "wmtext0"
    };

    let margin = watermark.margin.unwrap_or(24);
    let (x, y) = if watermark.layout.as_deref() == Some("tile") {
        tile_overlay_position(watermark)
    } else {
        watermark_position_expr(watermark, "overlay_w", "overlay_h", margin)
    };
    chains.push(format!(
        "[{}][{}]overlay=x={}:y={}:format=auto{}[vout]",
        input_label,
        wm_label,
        x,
        y,
        overlay_enable_expr(watermark)
    ));
    chains
}

fn image_watermark_chains(
    watermark: &ScreenRecordingWatermarkOptions,
    image_input_index: usize,
    input_label: &str,
    capture_width: i32,
    capture_height: i32,
) -> Vec<String> {
    let width = watermark.image_width.unwrap_or(180);
    let alpha = watermark.opacity.unwrap_or(0.45);
    let angle = watermark.angle.unwrap_or(0.0);
    let mut chains = vec![format!(
        "[{}:v]scale={}:-1,format=rgba,colorchannelmixer=aa={}[wm0]",
        image_input_index, width, alpha
    )];
    let wm_label = if angle.abs() > 0.1 {
        chains.push(format!(
            "[wm0]rotate={}:c=none:ow=rotw({}):oh=roth({})[wm]",
            angle.to_radians(),
            angle.to_radians(),
            angle.to_radians()
        ));
        "wm"
    } else {
        "wm0"
    };
    let margin = watermark.margin.unwrap_or(24);
    let (x, y, source_label) = if watermark.layout.as_deref() == Some("tile") {
        let spacing_x = watermark.spacing_x.unwrap_or(220);
        let spacing_y = watermark.spacing_y.unwrap_or(140);
        let (base_w, base_h) = watermark_canvas_size(capture_width, capture_height);
        let tile_w = base_w + spacing_x;
        let tile_h = base_h + spacing_y;
        let positions = tile_positions(tile_w, tile_h, spacing_x, spacing_y);
        let split_outputs: Vec<String> = (0..positions.len())
            .map(|index| format!("[wm_copy_{}]", index))
            .collect();
        chains.push(format!(
            "[{}]split={}{}",
            wm_label,
            positions.len(),
            split_outputs.join("")
        ));
        chains.push(format!(
            "color=c=black@0.0:s={}x{},format=rgba[wm_canvas0]",
            tile_w, tile_h
        ));
        let mut previous = "wm_canvas0".to_string();
        for (index, (x, y)) in positions.iter().enumerate() {
            let next = format!("wm_canvas{}", index + 1);
            chains.push(format!(
                "[{}][wm_copy_{}]overlay=x={}:y={}:format=auto[{}]",
                previous, index, x, y, next
            ));
            previous = next;
        }
        let (x, y) = tile_overlay_position(watermark);
        (x, y, previous)
    } else {
        let (x, y) = watermark_position_expr(watermark, "overlay_w", "overlay_h", margin);
        (x, y, wm_label.to_string())
    };
    chains.push(format!(
        "[{}][{}]overlay=x={}:y={}:format=auto{}[vout]",
        input_label,
        source_label,
        x,
        y,
        overlay_enable_expr(watermark)
    ));
    chains
}

fn watermark_position_expr(
    watermark: &ScreenRecordingWatermarkOptions,
    width_name: &str,
    height_name: &str,
    margin: i32,
) -> (String, String) {
    if watermark.mode.as_deref() == Some("dynamic") {
        match watermark.motion.as_deref().unwrap_or("horizontal") {
            "vertical" => {
                return (
                    format!("(W-{})/2", width_name),
                    format!("mod(t*90\\,H+{})-{}", height_name, height_name),
                )
            }
            "diagonal" => {
                return (
                    format!("mod(t*110\\,W+{})-{}", width_name, width_name),
                    format!("mod(t*70\\,H+{})-{}", height_name, height_name),
                )
            }
            "blink" => {}
            _ => {
                return (
                    format!("mod(t*120\\,W+{})-{}", width_name, width_name),
                    format!("H-{}-{}", height_name, margin),
                )
            }
        }
    }

    match watermark.position.as_deref().unwrap_or("bottom-right") {
        "top-left" => (margin.to_string(), margin.to_string()),
        "top" => (format!("(W-{})/2", width_name), margin.to_string()),
        "top-right" => (format!("W-{}-{}", width_name, margin), margin.to_string()),
        "left" => (margin.to_string(), format!("(H-{})/2", height_name)),
        "center" => (
            format!("(W-{})/2", width_name),
            format!("(H-{})/2", height_name),
        ),
        "right" => (
            format!("W-{}-{}", width_name, margin),
            format!("(H-{})/2", height_name),
        ),
        "bottom-left" => (margin.to_string(), format!("H-{}-{}", height_name, margin)),
        "bottom" => (
            format!("(W-{})/2", width_name),
            format!("H-{}-{}", height_name, margin),
        ),
        _ => (
            format!("W-{}-{}", width_name, margin),
            format!("H-{}-{}", height_name, margin),
        ),
    }
}

fn watermark_canvas_size(capture_width: i32, capture_height: i32) -> (i32, i32) {
    (capture_width.max(1280), capture_height.max(720))
}

fn tile_positions(canvas_w: i32, canvas_h: i32, spacing_x: i32, spacing_y: i32) -> Vec<(i32, i32)> {
    let spacing_x = spacing_x.max(40);
    let spacing_y = spacing_y.max(40);
    let cols = ((canvas_w as f32 / spacing_x as f32).ceil() as i32 + 1).clamp(1, 24);
    let rows = ((canvas_h as f32 / spacing_y as f32).ceil() as i32 + 1).clamp(1, 24);
    let mut positions = Vec::with_capacity((cols * rows) as usize);
    for row in 0..rows {
        for col in 0..cols {
            let offset = if row % 2 == 0 { 0 } else { spacing_x / 2 };
            positions.push((col * spacing_x + offset, row * spacing_y));
        }
    }
    positions
}

fn tile_overlay_position(watermark: &ScreenRecordingWatermarkOptions) -> (String, String) {
    if watermark.mode.as_deref() == Some("dynamic") {
        match watermark.motion.as_deref().unwrap_or("horizontal") {
            "vertical" => (
                "0".to_string(),
                "mod(t*90\\,overlay_h)-overlay_h".to_string(),
            ),
            "diagonal" => (
                "mod(t*110\\,overlay_w)-overlay_w".to_string(),
                "mod(t*70\\,overlay_h)-overlay_h".to_string(),
            ),
            "blink" => ("0".to_string(), "0".to_string()),
            _ => (
                "mod(t*120\\,overlay_w)-overlay_w".to_string(),
                "0".to_string(),
            ),
        }
    } else {
        ("0".to_string(), "0".to_string())
    }
}

fn overlay_enable_expr(watermark: &ScreenRecordingWatermarkOptions) -> String {
    if watermark.mode.as_deref() == Some("dynamic") && watermark.motion.as_deref() == Some("blink")
    {
        ":enable='gte(sin(t*4),0)'".to_string()
    } else {
        String::new()
    }
}

fn alpha_expression(watermark: &ScreenRecordingWatermarkOptions) -> String {
    let opacity = watermark.opacity.unwrap_or(0.45).clamp(0.05, 1.0);
    format!("{:.3}", opacity)
}

fn watermark_box_alpha(alpha: &str) -> String {
    alpha
        .parse::<f32>()
        .map(|value| format!("{:.3}", (value * 0.28).max(0.08)))
        .unwrap_or_else(|_| "0.120".to_string())
}

fn watermark_font_file_expr() -> String {
    let candidates = [
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\arial.ttf",
    ];
    let path = candidates
        .iter()
        .find(|path| Path::new(path).exists())
        .copied()
        .unwrap_or(r"C:\Windows\Fonts\arial.ttf");
    escape_drawtext_path(path)
}

fn escape_drawtext_path(value: &str) -> String {
    value.replace('\\', "/").replace(':', "\\:")
}

fn escape_drawtext_text(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace('\'', "\\'")
        .replace('%', "\\%")
        .replace('\n', "\\n")
        .replace('\r', "")
}

fn output_encoder_args(output_path: &str, quality: &str) -> Vec<String> {
    let ext = PathBuf::from(output_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(normalize_format)
        .unwrap_or_else(|| "mp4".to_string());

    if ext == "gif" {
        return Vec::new();
    }

    let (preset, crf) = match quality {
        "lossless" => ("ultrafast", "12"),
        "quality" => ("veryfast", "16"),
        "small" => ("veryfast", "26"),
        _ => ("veryfast", "20"),
    };

    if ext == "webm" {
        let webm_crf = match quality {
            "lossless" => "18",
            "quality" => "24",
            "small" => "36",
            _ => "30",
        };
        return vec![
            "-c:v".to_string(),
            "libvpx-vp9".to_string(),
            "-deadline".to_string(),
            "realtime".to_string(),
            "-cpu-used".to_string(),
            "6".to_string(),
            "-b:v".to_string(),
            "0".to_string(),
            "-crf".to_string(),
            webm_crf.to_string(),
        ];
    }

    let mut args = vec![
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        preset.to_string(),
        "-crf".to_string(),
        crf.to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
    ];

    if ext == "mp4" || ext == "mov" {
        args.extend(["-movflags".to_string(), "+faststart".to_string()]);
    }

    args
}

fn normalize_format(value: &str) -> String {
    match value
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .as_str()
    {
        "gif" => "gif".to_string(),
        "webm" => "webm".to_string(),
        "mkv" => "mkv".to_string(),
        "mov" => "mov".to_string(),
        _ => "mp4".to_string(),
    }
}

#[cfg(target_os = "windows")]
fn list_recordable_windows() -> Result<Vec<RecordableWindow>, String> {
    use winapi::shared::minwindef::{BOOL, LPARAM};
    use winapi::shared::windef::{HWND, RECT};
    use winapi::um::winuser::{
        EnumWindows, GetShellWindow, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, IsIconic,
        IsWindowVisible,
    };

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let windows = &mut *(lparam as *mut Vec<RecordableWindow>);
        if IsWindowVisible(hwnd) == 0 || hwnd == GetShellWindow() {
            return 1;
        }

        let title_len = GetWindowTextLengthW(hwnd);
        if title_len <= 0 {
            return 1;
        }

        let mut rect: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return 1;
        }
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width < 80 || height < 50 {
            return 1;
        }

        let mut buffer = vec![0u16; title_len as usize + 1];
        let copied = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
        if copied <= 0 {
            return 1;
        }
        let title = String::from_utf16_lossy(&buffer[..copied as usize])
            .trim()
            .to_string();
        if title.is_empty() {
            return 1;
        }

        windows.push(RecordableWindow {
            hwnd: (hwnd as usize).to_string(),
            title,
            x: rect.left,
            y: rect.top,
            width,
            height,
            minimized: IsIconic(hwnd) != 0,
        });
        1
    }

    let mut windows: Vec<RecordableWindow> = Vec::new();
    unsafe {
        EnumWindows(Some(enum_proc), &mut windows as *mut _ as LPARAM);
    }
    windows.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(windows)
}

#[cfg(not(target_os = "windows"))]
fn list_recordable_windows() -> Result<Vec<RecordableWindow>, String> {
    Ok(Vec::new())
}

#[cfg(target_os = "windows")]
fn get_window_size_by_hwnd_value(value: &str) -> Option<(i32, i32)> {
    use winapi::shared::windef::{HWND, RECT};
    use winapi::um::winuser::GetWindowRect;

    let hwnd_value = value.trim().parse::<usize>().ok()?;
    let hwnd = hwnd_value as HWND;
    let mut rect: RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return None;
    }
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width > 0 && height > 0 {
        Some((width, height))
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn get_window_size_by_hwnd_value(_value: &str) -> Option<(i32, i32)> {
    None
}

#[cfg(target_os = "windows")]
fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    let ffmpeg =
        find_ffmpeg_binary().ok_or_else(|| "未找到 FFmpeg，请先安装 FFmpeg".to_string())?;
    let mut command = Command::new(ffmpeg);
    command.args([
        "-hide_banner",
        "-list_devices",
        "true",
        "-f",
        "dshow",
        "-i",
        "dummy",
    ]);
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .map_err(|e| format!("读取音频设备失败: {}", e))?;
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(parse_dshow_audio_devices(&text))
}

#[cfg(not(target_os = "windows"))]
fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    Ok(Vec::new())
}

fn parse_dshow_audio_devices(text: &str) -> Vec<AudioDevice> {
    let mut devices = Vec::new();
    let mut in_audio_section = false;
    for line in text.lines() {
        if line.contains("DirectShow video devices") {
            in_audio_section = false;
            continue;
        }
        if line.contains("DirectShow audio devices") {
            in_audio_section = true;
            continue;
        }
        if !in_audio_section || line.contains("Alternative name") {
            continue;
        }
        if let Some(name) = extract_quoted_value(line) {
            if !devices
                .iter()
                .any(|device: &AudioDevice| device.name == name)
            {
                devices.push(AudioDevice {
                    kind: classify_audio_device(&name),
                    name,
                });
            }
        }
    }
    devices
}

fn extract_quoted_value(line: &str) -> Option<String> {
    let start = line.find('"')?;
    let rest = &line[start + 1..];
    let end = rest.find('"')?;
    let value = rest[..end].trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn classify_audio_device(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if lower.contains("stereo mix")
        || lower.contains("立体声混音")
        || lower.contains("what u hear")
        || lower.contains("loopback")
        || lower.contains("virtual")
    {
        "system".to_string()
    } else {
        "microphone".to_string()
    }
}

#[cfg(target_os = "windows")]
fn set_process_suspended(process_id: u32, suspend: bool) -> Result<(), String> {
    use winapi::shared::minwindef::FALSE;
    use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
    use winapi::um::processthreadsapi::OpenThread;
    use winapi::um::tlhelp32::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use winapi::um::winnt::{THREAD_QUERY_INFORMATION, THREAD_SUSPEND_RESUME};

    extern "system" {
        fn SuspendThread(h_thread: winapi::shared::ntdef::HANDLE) -> u32;
        fn ResumeThread(h_thread: winapi::shared::ntdef::HANDLE) -> u32;
    }

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err("无法创建线程快照".to_string());
        }

        let mut entry: THREADENTRY32 = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        let mut found = false;
        let mut ok = true;

        if Thread32First(snapshot, &mut entry) != FALSE {
            loop {
                if entry.th32OwnerProcessID == process_id {
                    found = true;
                    let thread = OpenThread(
                        THREAD_SUSPEND_RESUME | THREAD_QUERY_INFORMATION,
                        FALSE,
                        entry.th32ThreadID,
                    );
                    if thread.is_null() {
                        ok = false;
                    } else {
                        let result = if suspend {
                            SuspendThread(thread)
                        } else {
                            ResumeThread(thread)
                        };
                        if result == u32::MAX {
                            ok = false;
                        }
                        CloseHandle(thread);
                    }
                }

                if Thread32Next(snapshot, &mut entry) == FALSE {
                    break;
                }
            }
        }

        CloseHandle(snapshot);
        if !found {
            return Err("未找到录制进程线程".to_string());
        }
        if !ok {
            return Err(if suspend {
                "暂停录制失败".to_string()
            } else {
                "继续录制失败".to_string()
            });
        }
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn set_process_suspended(_process_id: u32, _suspend: bool) -> Result<(), String> {
    Err("当前平台暂不支持暂停/继续录制".to_string())
}
