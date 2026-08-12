use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use tokio::io::{AsyncBufReadExt, BufReader};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoWatermarkRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoWatermarkRemoveOptions {
    pub regions: Vec<VideoWatermarkRegion>,
    pub output_path: Option<String>,
    pub output_format: Option<String>,
    pub mask_padding: Option<u32>,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    pub video_codec: Option<String>,
    pub crf: Option<u32>,
    pub preset: Option<String>,
    pub audio_mode: Option<String>,
    pub show_mask: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProPainterOptions {
    pub regions: Vec<VideoWatermarkRegion>,
    pub output_path: Option<String>,
    pub python_path: Option<String>,
    pub propainter_dir: String,
    pub mask_padding: Option<u32>,
    pub mask_dilation: Option<u32>,
    pub resize_ratio: Option<f32>,
    pub use_fp16: Option<bool>,
    pub ref_stride: Option<u32>,
    pub neighbor_length: Option<u32>,
    pub subvideo_length: Option<u32>,
    pub keep_audio: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoWatermarkRemoveResult {
    pub output_path: String,
    pub output_size: u64,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProPainterRuntimeStatus {
    pub ready: bool,
    pub python_path: Option<String>,
    pub python_version: Option<String>,
    pub propainter_dir: Option<String>,
    pub script_path: Option<String>,
    pub missing: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct VideoMeta {
    width: u32,
    height: u32,
    duration: f64,
}

#[derive(Debug, Clone)]
struct RegionPx {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[tauri::command]
pub async fn video_watermark_remove_fixed(
    app_handle: tauri::AppHandle,
    input_path: String,
    options: VideoWatermarkRemoveOptions,
) -> Result<VideoWatermarkRemoveResult, String> {
    let ffmpeg_bin =
        crate::media_convert::find_ffmpeg_binary().ok_or("未找到 FFmpeg，请先安装".to_string())?;
    let meta = get_video_meta(&input_path)?;
    let regions = validate_regions(&options.regions, &meta, options.mask_padding.unwrap_or(0))?;
    let output_path = resolve_output_path(
        &input_path,
        options.output_path.as_deref(),
        "watermark_removed",
        options.output_format.as_deref().unwrap_or("mp4"),
    )?;
    ensure_output_not_input(&input_path, &output_path)?;

    let filter = build_delogo_filter(
        &regions,
        options.start_time,
        options.end_time,
        options.show_mask.unwrap_or(false),
    );

    let codec = normalize_video_codec(options.video_codec.as_deref());
    let crf = options.crf.unwrap_or(18).min(51);
    let preset = normalize_preset(options.preset.as_deref());
    let audio_mode = normalize_audio_mode(options.audio_mode.as_deref());

    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(),
        input_path.clone(),
        "-vf".to_string(),
        filter,
        "-map".to_string(),
        "0:v:0".to_string(),
    ];

    if audio_mode == "none" {
        args.push("-an".to_string());
    } else {
        args.push("-map".to_string());
        args.push("0:a?".to_string());
    }

    args.push("-c:v".to_string());
    args.push(codec.to_string());
    if codec == "libx264" || codec == "libx265" {
        args.push("-crf".to_string());
        args.push(crf.to_string());
        args.push("-preset".to_string());
        args.push(preset.to_string());
        args.push("-pix_fmt".to_string());
        args.push("yuv420p".to_string());
    }

    match audio_mode {
        "copy" => {
            args.push("-c:a".to_string());
            args.push("copy".to_string());
        }
        "none" => {}
        _ => {
            args.push("-c:a".to_string());
            args.push("aac".to_string());
            args.push("-b:a".to_string());
            args.push("160k".to_string());
        }
    }

    if output_path.to_ascii_lowercase().ends_with(".mp4") {
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());
    }
    args.push(output_path.clone());

    run_ffmpeg_with_progress(
        &app_handle,
        &ffmpeg_bin,
        args,
        &input_path,
        &output_path,
        meta.duration,
        "ffmpeg",
    )
    .await?;

    let output_size = std::fs::metadata(&output_path)
        .map(|m| m.len())
        .unwrap_or(0);
    emit_progress(
        &app_handle,
        &input_path,
        100.0,
        "done",
        "完成",
        None,
        Some(&output_path),
        Some(output_size),
    );

    Ok(VideoWatermarkRemoveResult {
        output_path,
        output_size,
        width: meta.width,
        height: meta.height,
        duration: meta.duration,
        mode: "ffmpeg".to_string(),
    })
}

#[tauri::command]
pub fn check_propainter_runtime(
    python_path: Option<String>,
    propainter_dir: Option<String>,
) -> Result<ProPainterRuntimeStatus, String> {
    let mut missing = Vec::new();
    let mut warnings = Vec::new();

    let python = match resolve_python(python_path.as_deref()) {
        Some(path) => path,
        None => {
            missing.push("Python 运行时".to_string());
            String::new()
        }
    };

    let python_version = if python.is_empty() {
        None
    } else {
        probe_python_version(&python)
    };
    if let Some(warning) = python_version_warning(python_version.as_deref()) {
        warnings.push(warning);
    }

    let dir = propainter_dir
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(default_propainter_dir);
    let dir_path = PathBuf::from(&dir);
    let script_path = dir_path.join("inference_propainter.py");

    if !dir_path.exists() {
        missing.push("ProPainter 仓库目录".to_string());
    }
    if !script_path.exists() {
        missing.push("inference_propainter.py".to_string());
    }
    for required_dir in ["model", "core", "utils"] {
        if !dir_path.join(required_dir).exists() {
            missing.push(format!("ProPainter/{}", required_dir));
        }
    }

    for weight in [
        "weights/ProPainter.pth",
        "weights/recurrent_flow_completion.pth",
        "weights/raft-things.pth",
    ] {
        if !dir_path.join(weight).exists() {
            warnings.push(format!(
                "{} 未发现，可提前下载到 weights 目录；未提前下载时 ProPainter 首次运行会尝试自动下载",
                weight
            ));
        }
    }

    Ok(ProPainterRuntimeStatus {
        ready: missing.is_empty(),
        python_path: if python.is_empty() {
            None
        } else {
            Some(python)
        },
        python_version,
        propainter_dir: Some(dir),
        script_path: Some(script_path.to_string_lossy().to_string()),
        missing,
        warnings,
    })
}

#[tauri::command]
pub async fn video_watermark_remove_propainter(
    app_handle: tauri::AppHandle,
    input_path: String,
    options: ProPainterOptions,
) -> Result<VideoWatermarkRemoveResult, String> {
    let ffmpeg_bin =
        crate::media_convert::find_ffmpeg_binary().ok_or("未找到 FFmpeg，请先安装".to_string())?;
    let meta = get_video_meta(&input_path)?;
    let regions = validate_regions(&options.regions, &meta, options.mask_padding.unwrap_or(4))?;
    let runtime = check_propainter_runtime(
        options.python_path.clone(),
        Some(options.propainter_dir.clone()),
    )?;
    if !runtime.ready {
        return Err(format!(
            "ProPainter 环境未就绪: {}",
            runtime.missing.join("、")
        ));
    }

    let python = runtime
        .python_path
        .clone()
        .ok_or("未找到 Python 运行时".to_string())?;
    let repo_dir = PathBuf::from(&options.propainter_dir);
    let output_path = resolve_output_path(
        &input_path,
        options.output_path.as_deref(),
        "ai_watermark_removed",
        "mp4",
    )?;
    ensure_output_not_input(&input_path, &output_path)?;

    let work_dir = std::env::temp_dir().join(format!(
        "mcstartup_propainter_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));
    std::fs::create_dir_all(&work_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;

    let mask_path = work_dir.join("watermark_mask.png");
    write_mask_png(&mask_path, meta.width, meta.height, &regions)?;

    emit_progress(
        &app_handle,
        &input_path,
        6.0,
        "processing",
        "生成遮罩",
        None,
        None,
        None,
    );

    let output_root = work_dir.join("propainter_result");
    std::fs::create_dir_all(&output_root).map_err(|e| format!("创建输出目录失败: {}", e))?;

    let mut args = vec![
        "inference_propainter.py".to_string(),
        "--video".to_string(),
        input_path.clone(),
        "--mask".to_string(),
        mask_path.to_string_lossy().to_string(),
        "--output".to_string(),
        output_root.to_string_lossy().to_string(),
        "--mask_dilation".to_string(),
        options.mask_dilation.unwrap_or(6).to_string(),
        "--ref_stride".to_string(),
        options.ref_stride.unwrap_or(10).to_string(),
        "--neighbor_length".to_string(),
        options.neighbor_length.unwrap_or(10).to_string(),
        "--subvideo_length".to_string(),
        options.subvideo_length.unwrap_or(80).to_string(),
    ];
    if let Some(ratio) = options.resize_ratio {
        if (0.1..1.0).contains(&ratio) || (1.0..=2.0).contains(&ratio) {
            args.push("--resize_ratio".to_string());
            args.push(format!("{:.3}", ratio));
        }
    }
    if options.use_fp16.unwrap_or(false) {
        args.push("--fp16".to_string());
    }

    run_propainter_with_progress(&app_handle, &python, &repo_dir, &args, &input_path).await?;

    let video_name = Path::new(&input_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let ai_video = output_root.join(video_name).join("inpaint_out.mp4");
    if !ai_video.exists() {
        return Err(format!(
            "ProPainter 已结束，但未找到输出文件: {}",
            ai_video.to_string_lossy()
        ));
    }

    emit_progress(
        &app_handle,
        &input_path,
        92.0,
        "processing",
        "合并音频",
        None,
        None,
        None,
    );

    if options.keep_audio.unwrap_or(true) {
        mux_audio(
            &app_handle,
            &ffmpeg_bin,
            &ai_video,
            &input_path,
            &output_path,
            meta.duration,
        )
        .await?;
    } else {
        std::fs::copy(&ai_video, &output_path).map_err(|e| format!("复制结果失败: {}", e))?;
    }

    let output_size = std::fs::metadata(&output_path)
        .map(|m| m.len())
        .unwrap_or(0);
    emit_progress(
        &app_handle,
        &input_path,
        100.0,
        "done",
        "完成",
        None,
        Some(&output_path),
        Some(output_size),
    );

    Ok(VideoWatermarkRemoveResult {
        output_path,
        output_size,
        width: meta.width,
        height: meta.height,
        duration: meta.duration,
        mode: "propainter".to_string(),
    })
}

#[tauri::command]
pub fn ensure_propainter_dirs(propainter_dir: Option<String>) -> Result<String, String> {
    let dir = propainter_dir
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(default_propainter_dir);
    std::fs::create_dir_all(Path::new(&dir).join("weights"))
        .map_err(|e| format!("创建 ProPainter 目录失败: {}", e))?;
    Ok(dir)
}

fn get_video_meta(input_path: &str) -> Result<VideoMeta, String> {
    let ffmpeg_bin =
        crate::media_convert::find_ffmpeg_binary().ok_or("未找到 FFmpeg，请先安装".to_string())?;
    let ffprobe_bin = ffprobe_from_ffmpeg(&ffmpeg_bin);
    let mut cmd = Command::new(&ffprobe_bin);
    cmd.args([
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        input_path,
    ]);
    apply_no_window(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("ffprobe 执行失败: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let value: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("解析媒体信息失败: {}", e))?;
    let streams = value
        .get("streams")
        .and_then(|v| v.as_array())
        .ok_or("未读取到视频流信息".to_string())?;
    let video = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("video"))
        .ok_or("未找到视频流".to_string())?;
    let width = video
        .get("width")
        .and_then(|v| v.as_u64())
        .ok_or("无法读取视频宽度".to_string())? as u32;
    let height = video
        .get("height")
        .and_then(|v| v.as_u64())
        .ok_or("无法读取视频高度".to_string())? as u32;
    let duration = value
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .or_else(|| {
            video
                .get("duration")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<f64>().ok())
        })
        .unwrap_or(0.0);

    Ok(VideoMeta {
        width,
        height,
        duration,
    })
}

fn validate_regions(
    regions: &[VideoWatermarkRegion],
    meta: &VideoMeta,
    padding: u32,
) -> Result<Vec<RegionPx>, String> {
    if regions.is_empty() {
        return Err("请先在视频预览上框选水印区域".to_string());
    }

    let mut out = Vec::new();
    for region in regions {
        if region.width < 2 || region.height < 2 {
            continue;
        }
        let x = region.x.min(meta.width.saturating_sub(1));
        let y = region.y.min(meta.height.saturating_sub(1));
        let right = region
            .x
            .saturating_add(region.width)
            .min(meta.width)
            .saturating_add(padding)
            .min(meta.width);
        let bottom = region
            .y
            .saturating_add(region.height)
            .min(meta.height)
            .saturating_add(padding)
            .min(meta.height);
        let x = x.saturating_sub(padding);
        let y = y.saturating_sub(padding);
        let width = right.saturating_sub(x);
        let height = bottom.saturating_sub(y);
        if width >= 2 && height >= 2 {
            out.push(RegionPx {
                x,
                y,
                width,
                height,
            });
        }
    }

    if out.is_empty() {
        Err("水印区域太小，请重新框选".to_string())
    } else {
        Ok(out)
    }
}

fn build_delogo_filter(
    regions: &[RegionPx],
    start_time: Option<f64>,
    end_time: Option<f64>,
    show_mask: bool,
) -> String {
    let timeline = match (start_time, end_time) {
        (Some(start), Some(end)) if end > start && start >= 0.0 => {
            Some(format!(":enable='between(t,{:.3},{:.3})'", start, end))
        }
        _ => None,
    };

    regions
        .iter()
        .map(|region| {
            format!(
                "delogo=x={}:y={}:w={}:h={}:show={}{}",
                region.x,
                region.y,
                region.width,
                region.height,
                if show_mask { 1 } else { 0 },
                timeline.as_deref().unwrap_or("")
            )
        })
        .collect::<Vec<_>>()
        .join(",")
}

async fn run_ffmpeg_with_progress(
    app_handle: &tauri::AppHandle,
    ffmpeg_bin: &str,
    mut args: Vec<String>,
    input_path: &str,
    output_path: &str,
    duration_secs: f64,
    mode: &str,
) -> Result<(), String> {
    let progress_file = std::env::temp_dir().join(format!(
        "mcstartup_video_watermark_{}.txt",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));

    args.splice(
        1..1,
        [
            "-progress".to_string(),
            progress_file.to_string_lossy().to_string(),
            "-nostats".to_string(),
        ],
    );

    let mut cmd = tokio::process::Command::new(ffmpeg_bin);
    cmd.args(&args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    apply_tokio_no_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 FFmpeg 失败: {}", e))?;
    emit_progress(
        app_handle,
        input_path,
        1.0,
        "processing",
        mode,
        None,
        None,
        None,
    );

    let app_handle_clone = app_handle.clone();
    let progress_file_clone = progress_file.clone();
    let input_path_clone = input_path.to_string();
    let mode_string = mode.to_string();
    let progress_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(350)).await;
            if let Ok(content) = tokio::fs::read_to_string(&progress_file_clone).await {
                let percent = parse_ffmpeg_progress(&content, duration_secs).unwrap_or(0.0);
                if percent > 0.0 {
                    emit_progress(
                        &app_handle_clone,
                        &input_path_clone,
                        percent.min(99.0),
                        "processing",
                        &mode_string,
                        None,
                        None,
                        None,
                    );
                }
            }
        }
    });

    let mut err_lines = Vec::new();
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
    let _ = std::fs::remove_file(progress_file);

    if !status.success() {
        let error_text = ffmpeg_error_text(ffmpeg_bin, &args, &err_lines, "视频去水印失败");
        emit_progress(
            app_handle,
            input_path,
            0.0,
            "error",
            mode,
            Some(&error_text),
            None,
            None,
        );
        return Err(error_text);
    }

    if !Path::new(output_path).exists() {
        return Err("处理完成但未找到输出文件".to_string());
    }
    Ok(())
}

async fn run_propainter_with_progress(
    app_handle: &tauri::AppHandle,
    python: &str,
    repo_dir: &Path,
    args: &[String],
    input_path: &str,
) -> Result<(), String> {
    let mut cmd = tokio::process::Command::new(python);
    cmd.args(args)
        .current_dir(repo_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    apply_tokio_no_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 ProPainter 失败: {}", e))?;

    let app_handle_clone = app_handle.clone();
    let input_path_clone = input_path.to_string();
    let progress_task = tokio::spawn(async move {
        let mut percent: f64 = 10.0;
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            percent = (percent + 0.8).min(88.0);
            emit_progress(
                &app_handle_clone,
                &input_path_clone,
                percent,
                "processing",
                "ProPainter AI 修复",
                None,
                None,
                None,
            );
        }
    });

    let mut logs = Vec::new();
    let mut stdout_task = None;
    if let Some(stdout) = child.stdout.take() {
        stdout_task = Some(tokio::spawn(read_process_lines(stdout)));
    }
    let mut stderr_task = None;
    if let Some(stderr) = child.stderr.take() {
        stderr_task = Some(tokio::spawn(read_process_lines(stderr)));
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("等待 ProPainter 完成失败: {}", e))?;
    progress_task.abort();

    if let Some(task) = stdout_task {
        if let Ok(mut lines) = task.await {
            logs.append(&mut lines);
        }
    }
    if let Some(task) = stderr_task {
        if let Ok(mut lines) = task.await {
            logs.append(&mut lines);
        }
    }

    if !status.success() {
        let detail = logs
            .iter()
            .rev()
            .take(12)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" | ");
        let error_text = if detail.is_empty() {
            "ProPainter AI 修复失败".to_string()
        } else {
            format!("ProPainter AI 修复失败: {}", detail)
        };
        emit_progress(
            app_handle,
            input_path,
            0.0,
            "error",
            "ProPainter AI 修复",
            Some(&error_text),
            None,
            None,
        );
        return Err(error_text);
    }

    Ok(())
}

async fn mux_audio(
    app_handle: &tauri::AppHandle,
    ffmpeg_bin: &str,
    ai_video: &Path,
    original_video: &str,
    output_path: &str,
    duration_secs: f64,
) -> Result<(), String> {
    let args = vec![
        "-y".to_string(),
        "-i".to_string(),
        ai_video.to_string_lossy().to_string(),
        "-i".to_string(),
        original_video.to_string(),
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        "1:a?".to_string(),
        "-c:v".to_string(),
        "copy".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "160k".to_string(),
        "-shortest".to_string(),
        output_path.to_string(),
    ];

    run_ffmpeg_with_progress(
        app_handle,
        ffmpeg_bin,
        args,
        original_video,
        output_path,
        duration_secs,
        "合并音频",
    )
    .await
}

async fn read_process_lines<R>(stream: R) -> Vec<String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut reader = BufReader::new(stream);
    let mut lines = Vec::new();
    let mut line = String::new();
    while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
        let trimmed = line.trim().to_string();
        if !trimmed.is_empty() {
            lines.push(trimmed);
        }
        line.clear();
    }
    lines
}

fn write_mask_png(
    path: &Path,
    width: u32,
    height: u32,
    regions: &[RegionPx],
) -> Result<(), String> {
    let mut mask = image::GrayImage::new(width, height);
    for region in regions {
        let max_x = region.x.saturating_add(region.width).min(width);
        let max_y = region.y.saturating_add(region.height).min(height);
        for y in region.y..max_y {
            for x in region.x..max_x {
                mask.put_pixel(x, y, image::Luma([255]));
            }
        }
    }
    mask.save(path)
        .map_err(|e| format!("保存 ProPainter 遮罩失败: {}", e))
}

fn parse_ffmpeg_progress(content: &str, duration_secs: f64) -> Option<f64> {
    if duration_secs <= 0.0 {
        return None;
    }
    content.lines().rev().find_map(|line| {
        if let Some(value) = line.strip_prefix("out_time_us=") {
            value
                .trim()
                .parse::<f64>()
                .ok()
                .map(|us| (us / 1_000_000.0) / duration_secs * 100.0)
        } else if let Some(value) = line.strip_prefix("out_time_ms=") {
            value
                .trim()
                .parse::<f64>()
                .ok()
                .map(|us| (us / 1_000_000.0) / duration_secs * 100.0)
        } else if let Some(value) = line.strip_prefix("out_time=") {
            parse_hms(value.trim()).map(|secs| secs / duration_secs * 100.0)
        } else {
            None
        }
    })
}

fn parse_hms(value: &str) -> Option<f64> {
    let parts = value.split(':').collect::<Vec<_>>();
    if parts.len() != 3 {
        return None;
    }
    let hours = parts[0].parse::<f64>().ok()?;
    let minutes = parts[1].parse::<f64>().ok()?;
    let seconds = parts[2].parse::<f64>().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

fn ffmpeg_error_text(ffmpeg_bin: &str, args: &[String], lines: &[String], prefix: &str) -> String {
    let detail = lines
        .iter()
        .filter(|line| {
            line.contains("Error")
                || line.contains("Invalid")
                || line.contains("error")
                || line.contains("No such")
                || line.contains("failed")
        })
        .cloned()
        .collect::<Vec<_>>()
        .join(" | ");
    let last_line = lines.last().map(|s| s.as_str()).unwrap_or("未知错误");
    format!(
        "{}: {} [cmd: {} {}]",
        prefix,
        if detail.is_empty() {
            last_line.to_string()
        } else {
            detail
        },
        ffmpeg_bin,
        args.join(" ")
    )
}

fn emit_progress(
    app_handle: &tauri::AppHandle,
    input_path: &str,
    percent: f64,
    status: &str,
    stage: &str,
    error: Option<&str>,
    output_path: Option<&str>,
    output_size: Option<u64>,
) {
    use tauri::Manager;
    let _ = app_handle.emit_all(
        "video-watermark-progress",
        serde_json::json!({
            "file": input_path,
            "percent": percent,
            "status": status,
            "stage": stage,
            "error": error,
            "output_path": output_path,
            "output_size": output_size,
        }),
    );
}

fn resolve_output_path(
    input_path: &str,
    output_path: Option<&str>,
    suffix: &str,
    default_ext: &str,
) -> Result<String, String> {
    if let Some(path) = output_path {
        if !path.trim().is_empty() {
            let p = PathBuf::from(path);
            if p.extension().is_some() {
                return Ok(p.to_string_lossy().to_string());
            }
            return Ok(p
                .with_extension(normalize_output_format(default_ext))
                .to_string_lossy()
                .to_string());
        }
    }

    let input = Path::new(input_path);
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let ext = normalize_output_format(default_ext);
    Ok(parent
        .join(format!("{}_{}.{}", stem, suffix, ext))
        .to_string_lossy()
        .to_string())
}

fn ensure_output_not_input(input_path: &str, output_path: &str) -> Result<(), String> {
    let input_abs = PathBuf::from(input_path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(input_path));
    let output_abs = if Path::new(output_path).exists() {
        PathBuf::from(output_path)
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(output_path))
    } else {
        PathBuf::from(output_path)
    };
    if input_abs == output_abs {
        return Err("输出文件不能覆盖原视频，请选择不同路径".to_string());
    }
    Ok(())
}

fn ffprobe_from_ffmpeg(ffmpeg_bin: &str) -> String {
    let path = PathBuf::from(ffmpeg_bin);
    let ffprobe_name = if cfg!(target_os = "windows") {
        "ffprobe.exe"
    } else {
        "ffprobe"
    };
    if path.file_name().is_some() {
        path.with_file_name(ffprobe_name)
            .to_string_lossy()
            .to_string()
    } else {
        ffprobe_name.to_string()
    }
}

fn normalize_output_format(format: &str) -> &str {
    match format.to_ascii_lowercase().as_str() {
        "mkv" => "mkv",
        "mov" => "mov",
        _ => "mp4",
    }
}

fn normalize_video_codec(codec: Option<&str>) -> &str {
    match codec {
        Some("libx265") => "libx265",
        _ => "libx264",
    }
}

fn normalize_preset(preset: Option<&str>) -> &str {
    match preset {
        Some("ultrafast") => "ultrafast",
        Some("veryfast") => "veryfast",
        Some("fast") => "fast",
        Some("slow") => "slow",
        Some("veryslow") => "veryslow",
        _ => "medium",
    }
}

fn normalize_audio_mode(mode: Option<&str>) -> &str {
    match mode {
        Some("copy") => "copy",
        Some("none") => "none",
        _ => "aac",
    }
}

fn resolve_python(provided: Option<&str>) -> Option<String> {
    if let Some(path) = provided {
        let trimmed = path.trim();
        if !trimmed.is_empty() && command_works(trimmed, "--version") {
            return Some(trimmed.to_string());
        }
    }
    for candidate in ["python", "python3"] {
        if command_works(candidate, "--version") {
            return Some(candidate.to_string());
        }
    }
    None
}

fn probe_python_version(python: &str) -> Option<String> {
    let mut cmd = Command::new(python);
    cmd.arg("--version");
    apply_no_window(&mut cmd);
    let output = cmd.output().ok()?;
    let text = if output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr).to_string()
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };
    Some(text.trim().to_string()).filter(|s| !s.is_empty())
}

fn python_version_warning(version: Option<&str>) -> Option<String> {
    let version = version?;
    let number = version
        .split_whitespace()
        .find(|part| part.chars().next().is_some_and(|c| c.is_ascii_digit()))?;
    let mut parts = number.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next()?.parse::<u32>().ok()?;
    if major != 3 || minor < 8 || minor > 10 {
        Some(format!(
            "检测到 {}；ProPainter 官方推荐 Python 3.8，建议使用 Conda 创建独立环境，Python 3.14 等新版本可能无法安装匹配的 PyTorch/torchvision",
            version
        ))
    } else {
        None
    }
}

fn command_works(command: &str, arg: &str) -> bool {
    let mut cmd = Command::new(command);
    cmd.arg(arg);
    apply_no_window(&mut cmd);
    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

fn default_propainter_dir() -> String {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("McStartUP")
        .join("models")
        .join("video-watermark-remove")
        .join("ProPainter")
        .to_string_lossy()
        .to_string()
}

fn apply_no_window(command: &mut Command) {
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
}

fn apply_tokio_no_window(command: &mut tokio::process::Command) {
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
}
