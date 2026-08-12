use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SherpaRuntimeStatus {
    pub ready: bool,
    pub version: Option<String>,
    pub runtime_dir: String,
    pub bin_dir: Option<String>,
    pub missing: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SherpaModelStatus {
    pub ready: bool,
    pub model_dir: String,
    pub missing: Vec<String>,
    pub files: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SherpaTranscribeResult {
    pub text: String,
    pub raw_output: String,
    pub prepared_wav: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SherpaAudioResult {
    pub output_path: String,
    pub output_size: u64,
    pub log: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SherpaSeparationResult {
    pub vocals_path: String,
    pub accompaniment_path: String,
    pub vocals_size: u64,
    pub accompaniment_size: u64,
    pub log: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SherpaTranscribeOptions {
    pub language: Option<String>,
    pub use_itn: Option<bool>,
    pub num_threads: Option<u32>,
    pub restore_punctuation: Option<bool>,
    pub model_variant: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SherpaTtsOptions {
    pub speaker_id: Option<u32>,
    pub speed: Option<f32>,
    pub num_threads: Option<u32>,
    pub model_variant: Option<String>,
    pub denoise_output: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SherpaProcessOptions {
    pub num_threads: Option<u32>,
    pub denoise_model: Option<String>,
}

struct RuntimePaths {
    bin_dir: PathBuf,
    offline_asr: PathBuf,
    offline_tts: PathBuf,
    offline_punctuation: PathBuf,
    offline_denoiser: PathBuf,
    offline_separator: PathBuf,
    version: PathBuf,
}

struct SenseVoiceModel {
    model: PathBuf,
    tokens: PathBuf,
}

struct PunctuationModel {
    model: PathBuf,
}

struct KokoroModel {
    model: PathBuf,
    voices: PathBuf,
    tokens: PathBuf,
    data_dir: PathBuf,
    lexicons: Vec<PathBuf>,
    rule_fsts: Vec<PathBuf>,
}

struct SpleeterModel {
    vocals: PathBuf,
    accompaniment: PathBuf,
}

#[tauri::command]
pub fn sherpa_audio_check_runtime(model_dir: String) -> Result<SherpaRuntimeStatus, String> {
    let runtime_dir = sherpa_base_dir(&model_dir).join("runtime");
    let paths = find_runtime_paths(&runtime_dir);
    let mut missing = Vec::new();

    let Some(paths) = paths else {
        return Ok(SherpaRuntimeStatus {
            ready: false,
            version: None,
            runtime_dir: runtime_dir.to_string_lossy().to_string(),
            bin_dir: None,
            missing: vec![
                "sherpa-onnx-offline.exe".to_string(),
                "sherpa-onnx-offline-tts.exe".to_string(),
                "sherpa-onnx-offline-punctuation.exe".to_string(),
                "sherpa-onnx-offline-denoiser.exe".to_string(),
                "sherpa-onnx-offline-source-separation.exe".to_string(),
            ],
        });
    };

    for path in [
        &paths.offline_asr,
        &paths.offline_tts,
        &paths.offline_punctuation,
        &paths.offline_denoiser,
        &paths.offline_separator,
    ] {
        if !path.is_file() {
            missing.push(
                path.file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("unknown")
                    .to_string(),
            );
        }
    }

    let version = if paths.version.is_file() {
        let mut command = Command::new(&paths.version);
        apply_no_window(&mut command);
        command
            .output()
            .ok()
            .map(|output| {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if stdout.is_empty() {
                    stderr
                } else {
                    stdout
                }
            })
            .filter(|value| !value.trim().is_empty())
    } else {
        None
    };

    Ok(SherpaRuntimeStatus {
        ready: missing.is_empty(),
        version,
        runtime_dir: runtime_dir.to_string_lossy().to_string(),
        bin_dir: Some(paths.bin_dir.to_string_lossy().to_string()),
        missing,
    })
}

#[tauri::command]
pub fn sherpa_audio_check_model(
    model_dir: String,
    tool: String,
    denoise_model: Option<String>,
    tts_model_variant: Option<String>,
    stt_model_variant: Option<String>,
) -> Result<SherpaModelStatus, String> {
    let model_root = tool_model_root(&model_dir, &tool);
    match tool.as_str() {
        "stt" => {
            let model = find_sense_voice_model(&model_root, stt_model_variant.as_deref());
            Ok(model_status_from_result(
                model_root,
                model.map(|m| vec![m.model, m.tokens]),
            ))
        }
        "punctuation" => {
            let model = find_punctuation_model(&model_root);
            Ok(model_status_from_result(
                model_root,
                model.map(|m| vec![m.model]),
            ))
        }
        "tts" => {
            let model = find_kokoro_model(&model_root, tts_model_variant.as_deref());
            Ok(model_status_from_result(
                model_root,
                model.map(|m| {
                    let mut files = vec![m.model, m.voices, m.tokens, m.data_dir];
                    files.extend(m.lexicons);
                    files
                }),
            ))
        }
        "denoise" => {
            let name = denoise_model.unwrap_or_else(|| "dpdfnet4.onnx".to_string());
            let path = model_root.join(&name);
            if path.is_file() {
                Ok(SherpaModelStatus {
                    ready: true,
                    model_dir: model_root.to_string_lossy().to_string(),
                    missing: Vec::new(),
                    files: vec![path.to_string_lossy().to_string()],
                })
            } else {
                Ok(SherpaModelStatus {
                    ready: false,
                    model_dir: model_root.to_string_lossy().to_string(),
                    missing: vec![name],
                    files: Vec::new(),
                })
            }
        }
        "separation" => {
            let model = find_spleeter_model(&model_root);
            Ok(model_status_from_result(
                model_root,
                model.map(|m| vec![m.vocals, m.accompaniment]),
            ))
        }
        _ => Err(format!("未知 sherpa 音频工具类型: {}", tool)),
    }
}

#[tauri::command]
pub fn sherpa_audio_extract_archive(
    archive_path: String,
    output_dir: String,
) -> Result<(), String> {
    let archive = PathBuf::from(&archive_path);
    if !archive.is_file() {
        return Err(format!("压缩包不存在: {}", archive.display()));
    }
    let output = PathBuf::from(&output_dir);
    fs::create_dir_all(&output).map_err(|error| format!("创建解压目录失败: {}", error))?;

    let mut command = Command::new("tar");
    command.arg("-xf").arg(&archive).arg("-C").arg(&output);
    apply_no_window(&mut command);
    let result = command
        .output()
        .map_err(|error| format!("启动 tar 解压失败，请确认系统可用 tar: {}", error))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&result.stdout).trim().to_string();
        return Err(format!(
            "解压失败: {}",
            if stderr.is_empty() { stdout } else { stderr }
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn sherpa_audio_transcribe(
    model_dir: String,
    input_path: String,
    options: SherpaTranscribeOptions,
) -> Result<SherpaTranscribeResult, String> {
    tauri::async_runtime::spawn_blocking(move || transcribe_impl(model_dir, input_path, options))
        .await
        .map_err(|error| format!("语音转文字任务失败: {}", error))?
}

#[tauri::command]
pub async fn sherpa_audio_tts(
    model_dir: String,
    text: String,
    output_dir: Option<String>,
    options: SherpaTtsOptions,
) -> Result<SherpaAudioResult, String> {
    tauri::async_runtime::spawn_blocking(move || tts_impl(model_dir, text, output_dir, options))
        .await
        .map_err(|error| format!("文字转语音任务失败: {}", error))?
}

#[tauri::command]
pub async fn sherpa_audio_denoise(
    model_dir: String,
    input_path: String,
    output_dir: Option<String>,
    options: SherpaProcessOptions,
) -> Result<SherpaAudioResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        denoise_impl(model_dir, input_path, output_dir, options)
    })
    .await
    .map_err(|error| format!("语音增强任务失败: {}", error))?
}

#[tauri::command]
pub async fn sherpa_audio_separate(
    model_dir: String,
    input_path: String,
    output_dir: Option<String>,
    options: SherpaProcessOptions,
) -> Result<SherpaSeparationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        separate_impl(model_dir, input_path, output_dir, options)
    })
    .await
    .map_err(|error| format!("音源分离任务失败: {}", error))?
}

fn transcribe_impl(
    model_dir: String,
    input_path: String,
    options: SherpaTranscribeOptions,
) -> Result<SherpaTranscribeResult, String> {
    let runtime = require_runtime(&model_dir)?;
    let model = find_sense_voice_model(
        &tool_model_root(&model_dir, "stt"),
        options.model_variant.as_deref(),
    )
    .ok_or_else(|| stt_model_missing_message(options.model_variant.as_deref()))?;
    let prepared_wav = prepare_wav(&input_path, Some(16000), Some(1), "stt")?;

    let language = options.language.unwrap_or_else(|| "auto".to_string());
    let mut command = Command::new(&runtime.offline_asr);
    command
        .arg("--print-args=false")
        .arg(format!(
            "--num-threads={}",
            options.num_threads.unwrap_or(2)
        ))
        .arg(format!("--tokens={}", model.tokens.to_string_lossy()))
        .arg(format!(
            "--sense-voice-model={}",
            model.model.to_string_lossy()
        ))
        .arg(format!("--sense-voice-language={}", language))
        .arg(format!(
            "--sense-voice-use-itn={}",
            options.use_itn.unwrap_or(true)
        ))
        .arg(&prepared_wav);
    apply_no_window(&mut command);

    let output = run_command(command, "sherpa-onnx 语音转文字失败")?;
    let raw_output = join_log(&output.stdout, &output.stderr);
    let mut text = parse_transcript(&raw_output, &prepared_wav);
    let needs_external_punctuation = options.restore_punctuation.unwrap_or(true)
        && normalize_stt_variant(options.model_variant.as_deref()) == Some("latest");
    if needs_external_punctuation {
        text = restore_punctuation(
            &runtime,
            &model_dir,
            &text,
            options.num_threads.unwrap_or(2),
        )?;
    }
    if text.trim().is_empty() {
        return Err(format!(
            "语音转文字没有返回文本。stdout: {} stderr: {}",
            output.stdout, output.stderr
        ));
    }

    Ok(SherpaTranscribeResult {
        text,
        raw_output,
        prepared_wav: Some(prepared_wav.to_string_lossy().to_string()),
    })
}

fn tts_impl(
    model_dir: String,
    text: String,
    output_dir: Option<String>,
    options: SherpaTtsOptions,
) -> Result<SherpaAudioResult, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("请输入要合成的文字".to_string());
    }

    let runtime = require_runtime(&model_dir)?;
    let model = find_kokoro_model(
        &tool_model_root(&model_dir, "tts"),
        options.model_variant.as_deref(),
    )
    .ok_or_else(|| tts_model_missing_message(options.model_variant.as_deref()))?;
    let output_path = output_path_for_text(&model_dir, output_dir, "kokoro_tts", "wav")?;
    let lexicons = model
        .lexicons
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(",");
    let rule_fsts = model
        .rule_fsts
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(",");
    let speed = options.speed.unwrap_or(1.0).clamp(0.5, 2.0);
    let length_scale = 1.0f32 / speed;

    let mut command = Command::new(&runtime.offline_tts);
    command
        .arg("--print-args=false")
        .arg("--debug=false")
        .arg(format!(
            "--num-threads={}",
            options.num_threads.unwrap_or(2)
        ))
        .arg(format!("--kokoro-model={}", model.model.to_string_lossy()))
        .arg(format!(
            "--kokoro-voices={}",
            model.voices.to_string_lossy()
        ))
        .arg(format!(
            "--kokoro-tokens={}",
            model.tokens.to_string_lossy()
        ))
        .arg(format!(
            "--kokoro-data-dir={}",
            model.data_dir.to_string_lossy()
        ))
        .arg(format!("--kokoro-lexicon={}", lexicons))
        .arg(format!("--kokoro-length-scale={}", length_scale))
        .arg(format!("--sid={}", options.speaker_id.unwrap_or(45)))
        .arg(format!(
            "--output-filename={}",
            output_path.to_string_lossy()
        ));
    if !rule_fsts.is_empty() {
        command.arg(format!("--tts-rule-fsts={}", rule_fsts));
    }
    command.arg(text);
    apply_no_window(&mut command);

    let output = run_command(command, "sherpa-onnx 文字转语音失败")?;
    ensure_output_file(&output_path, "TTS 输出文件")?;
    if options.denoise_output.unwrap_or(false) {
        apply_tts_audio_cleanup(&model_dir, &output_path, options.num_threads.unwrap_or(2))?;
    }
    Ok(SherpaAudioResult {
        output_size: file_size(&output_path),
        output_path: output_path.to_string_lossy().to_string(),
        log: join_log(&output.stdout, &output.stderr),
    })
}

fn denoise_impl(
    model_dir: String,
    input_path: String,
    output_dir: Option<String>,
    options: SherpaProcessOptions,
) -> Result<SherpaAudioResult, String> {
    let runtime = require_runtime(&model_dir)?;
    let model_name = options
        .denoise_model
        .unwrap_or_else(|| "dpdfnet4.onnx".to_string());
    let model = tool_model_root(&model_dir, "denoise").join(&model_name);
    if !model.is_file() {
        return Err(format!("降噪模型不存在: {}", model.display()));
    }
    let sample_rate = if model_name.contains("48khz") {
        48000
    } else {
        16000
    };
    let prepared_wav = prepare_wav(&input_path, Some(sample_rate), Some(1), "denoise")?;
    let output_path = output_path_for_input(&input_path, output_dir, "denoised", "wav")?;

    let mut command = Command::new(&runtime.offline_denoiser);
    command
        .arg("--print-args=false")
        .arg(format!(
            "--num-threads={}",
            options.num_threads.unwrap_or(2)
        ))
        .arg(format!(
            "--speech-denoiser-dpdfnet-model={}",
            model.to_string_lossy()
        ))
        .arg(format!("--input-wav={}", prepared_wav.to_string_lossy()))
        .arg(format!("--output-wav={}", output_path.to_string_lossy()));
    apply_no_window(&mut command);

    let output = run_command(command, "sherpa-onnx 语音增强失败")?;
    ensure_output_file(&output_path, "语音增强输出文件")?;
    Ok(SherpaAudioResult {
        output_size: file_size(&output_path),
        output_path: output_path.to_string_lossy().to_string(),
        log: join_log(&output.stdout, &output.stderr),
    })
}

fn apply_tts_audio_cleanup(
    model_dir: &str,
    output_path: &Path,
    num_threads: u32,
) -> Result<(), String> {
    let runtime = require_runtime(model_dir)?;
    let model = tool_model_root(model_dir, "denoise").join("dpdfnet4.onnx");
    if !model.is_file() {
        return Err("TTS 音频后处理需要 DPDFNet4 降噪模型，请先在语音增强工具下载 dpdfnet4.onnx，或关闭音频后处理。".to_string());
    }

    let temp_output = unique_path(output_path.with_file_name(format!(
        "{}_cleanup.wav",
        output_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("kokoro_tts")
    )));
    let mut command = Command::new(&runtime.offline_denoiser);
    command
        .arg("--print-args=false")
        .arg(format!("--num-threads={}", num_threads.max(1)))
        .arg(format!(
            "--speech-denoiser-dpdfnet-model={}",
            model.to_string_lossy()
        ))
        .arg(format!("--input-wav={}", output_path.to_string_lossy()))
        .arg(format!("--output-wav={}", temp_output.to_string_lossy()));
    apply_no_window(&mut command);

    run_command(command, "TTS 音频后处理失败")?;
    ensure_output_file(&temp_output, "TTS 音频后处理输出文件")?;
    fs::copy(&temp_output, output_path)
        .map_err(|error| format!("替换 TTS 输出文件失败: {}", error))?;
    let _ = fs::remove_file(&temp_output);
    Ok(())
}

fn separate_impl(
    model_dir: String,
    input_path: String,
    output_dir: Option<String>,
    options: SherpaProcessOptions,
) -> Result<SherpaSeparationResult, String> {
    let runtime = require_runtime(&model_dir)?;
    let model = find_spleeter_model(&tool_model_root(&model_dir, "separation"))
        .ok_or_else(|| "Spleeter 2-stem 模型未就绪，请先下载并解压模型。".to_string())?;
    let prepared_wav = prepare_wav(&input_path, None, None, "separate")?;
    let vocals_path = output_path_for_input(&input_path, output_dir.clone(), "vocals", "wav")?;
    let accompaniment_path =
        output_path_for_input(&input_path, output_dir, "accompaniment", "wav")?;

    let mut command = Command::new(&runtime.offline_separator);
    command
        .arg("--print-args=false")
        .arg(format!(
            "--num-threads={}",
            options.num_threads.unwrap_or(2)
        ))
        .arg(format!(
            "--spleeter-vocals={}",
            model.vocals.to_string_lossy()
        ))
        .arg(format!(
            "--spleeter-accompaniment={}",
            model.accompaniment.to_string_lossy()
        ))
        .arg(format!("--input-wav={}", prepared_wav.to_string_lossy()))
        .arg(format!(
            "--output-vocals-wav={}",
            vocals_path.to_string_lossy()
        ))
        .arg(format!(
            "--output-accompaniment-wav={}",
            accompaniment_path.to_string_lossy()
        ));
    apply_no_window(&mut command);

    let output = run_command(command, "sherpa-onnx 人声/伴奏分离失败")?;
    ensure_output_file(&vocals_path, "人声输出文件")?;
    ensure_output_file(&accompaniment_path, "伴奏输出文件")?;
    Ok(SherpaSeparationResult {
        vocals_size: file_size(&vocals_path),
        accompaniment_size: file_size(&accompaniment_path),
        vocals_path: vocals_path.to_string_lossy().to_string(),
        accompaniment_path: accompaniment_path.to_string_lossy().to_string(),
        log: join_log(&output.stdout, &output.stderr),
    })
}

fn model_status_from_result(model_root: PathBuf, files: Option<Vec<PathBuf>>) -> SherpaModelStatus {
    match files {
        Some(files) => SherpaModelStatus {
            ready: true,
            model_dir: model_root.to_string_lossy().to_string(),
            missing: Vec::new(),
            files: files
                .into_iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect(),
        },
        None => SherpaModelStatus {
            ready: false,
            model_dir: model_root.to_string_lossy().to_string(),
            missing: vec!["模型文件不完整或未解压".to_string()],
            files: Vec::new(),
        },
    }
}

fn require_runtime(model_dir: &str) -> Result<RuntimePaths, String> {
    let runtime_dir = sherpa_base_dir(model_dir).join("runtime");
    let runtime = find_runtime_paths(&runtime_dir)
        .ok_or_else(|| "sherpa-onnx 运行时未就绪，请先下载并解压运行时。".to_string())?;
    for path in [
        &runtime.offline_asr,
        &runtime.offline_tts,
        &runtime.offline_punctuation,
        &runtime.offline_denoiser,
        &runtime.offline_separator,
    ] {
        if !path.is_file() {
            return Err(format!("sherpa-onnx 运行时缺少文件: {}", path.display()));
        }
    }
    Ok(runtime)
}

fn sherpa_base_dir(model_dir: &str) -> PathBuf {
    PathBuf::from(model_dir).join("sherpa-onnx")
}

fn tool_model_root(model_dir: &str, tool: &str) -> PathBuf {
    sherpa_base_dir(model_dir).join("models").join(tool)
}

fn find_runtime_paths(runtime_dir: &Path) -> Option<RuntimePaths> {
    let offline_asr = find_file(runtime_dir, &exe_name("sherpa-onnx-offline"))?;
    let bin_dir = offline_asr.parent()?.to_path_buf();
    Some(RuntimePaths {
        offline_tts: bin_dir.join(exe_name("sherpa-onnx-offline-tts")),
        offline_punctuation: bin_dir.join(exe_name("sherpa-onnx-offline-punctuation")),
        offline_denoiser: bin_dir.join(exe_name("sherpa-onnx-offline-denoiser")),
        offline_separator: bin_dir.join(exe_name("sherpa-onnx-offline-source-separation")),
        version: bin_dir.join(exe_name("sherpa-onnx-version")),
        offline_asr,
        bin_dir,
    })
}

fn exe_name(stem: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{}.exe", stem)
    } else {
        stem.to_string()
    }
}

fn find_sense_voice_model(root: &Path, variant: Option<&str>) -> Option<SenseVoiceModel> {
    let model = match normalize_stt_variant(variant) {
        Some("punctuated") => find_file_in_dir(
            root,
            "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
            "model.int8.onnx",
        )
        .or_else(|| {
            find_file_in_dir(
                root,
                "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
                "model.onnx",
            )
        }),
        Some("latest") => find_file_in_dir(
            root,
            "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09",
            "model.int8.onnx",
        )
        .or_else(|| {
            find_file_in_dir(
                root,
                "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09",
                "model.onnx",
            )
        }),
        _ => find_file_in_dir(
            root,
            "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
            "model.int8.onnx",
        )
        .or_else(|| {
            find_file_in_dir(
                root,
                "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09",
                "model.int8.onnx",
            )
        })
        .or_else(|| find_file(root, "model.int8.onnx"))
        .or_else(|| find_file(root, "model.onnx")),
    }?;
    let model_root = model.parent()?.to_path_buf();
    let tokens = model_root.join("tokens.txt");
    if !tokens.is_file() {
        return None;
    }
    Some(SenseVoiceModel { model, tokens })
}

fn normalize_stt_variant(variant: Option<&str>) -> Option<&'static str> {
    match variant.map(|value| value.trim().to_ascii_lowercase()) {
        Some(value) if value == "punctuated" || value == "2024" || value == "standard" => {
            Some("punctuated")
        }
        Some(value)
            if value == "latest"
                || value == "multilingual"
                || value == "2025"
                || value == "yue"
                || value == "cantonese" =>
        {
            Some("latest")
        }
        _ => None,
    }
}

fn stt_model_missing_message(variant: Option<&str>) -> String {
    match normalize_stt_variant(variant) {
        Some("punctuated") => "SenseVoice 标点版模型未就绪，请先下载 2024-07-17 模型。".to_string(),
        Some("latest") => "SenseVoice 新版多语言模型未就绪，请先下载 2025-09-09 模型。".to_string(),
        _ => "SenseVoice 模型未就绪，请先下载并解压模型。".to_string(),
    }
}

fn find_punctuation_model(root: &Path) -> Option<PunctuationModel> {
    let model = find_file(root, "model.int8.onnx")
        .or_else(|| find_file(root, "model.onnx"))
        .or_else(|| find_file(root, "ct-transformer.onnx"))
        .or_else(|| find_file(root, "ct-transformer.int8.onnx"))?;
    Some(PunctuationModel { model })
}

fn restore_punctuation(
    runtime: &RuntimePaths,
    model_dir: &str,
    text: &str,
    num_threads: u32,
) -> Result<String, String> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(String::new());
    }
    let model =
        find_punctuation_model(&tool_model_root(model_dir, "punctuation")).ok_or_else(|| {
            "标点恢复模型未就绪，请先下载并解压 punctuation 模型，或关闭标点恢复。".to_string()
        })?;
    let mut command = Command::new(&runtime.offline_punctuation);
    command
        .arg("--print-args=false")
        .arg(format!("--num-threads={}", num_threads.max(1)))
        .arg(format!(
            "--ct-transformer={}",
            model.model.to_string_lossy()
        ))
        .arg(text);
    apply_no_window(&mut command);

    let output = run_command(command, "sherpa-onnx 标点恢复失败")?;
    let restored = parse_punctuation_output(&join_log(&output.stdout, &output.stderr), text);
    if restored.trim().is_empty() {
        Ok(text.to_string())
    } else {
        Ok(restored)
    }
}

fn parse_punctuation_output(output: &str, fallback: &str) -> String {
    let mut candidates = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.starts_with("Started"))
        .filter(|line| !line.starts_with("Elapsed"))
        .filter(|line| !line.starts_with("Done"))
        .filter(|line| !line.starts_with("Creating"))
        .filter(|line| !line.starts_with("num threads:"))
        .filter(|line| !line.starts_with("Num threads:"))
        .filter(|line| !line.starts_with("Input text:"))
        .filter(|line| !line.starts_with("Offline"))
        .filter(|line| *line != "----")
        .map(|line| line.strip_prefix("Output text:").unwrap_or(line).trim())
        .collect::<Vec<_>>();

    candidates.retain(|line| line != &fallback);
    candidates
        .last()
        .map(|line| line.to_string())
        .unwrap_or_else(|| fallback.to_string())
}

fn find_kokoro_model(root: &Path, variant: Option<&str>) -> Option<KokoroModel> {
    let model = match normalize_tts_variant(variant) {
        Some("quality") => find_file_in_dir(root, "kokoro-multi-lang-v1_1", "model.onnx"),
        Some("int8") => find_file_in_dir(root, "kokoro-int8-multi-lang-v1_1", "model.int8.onnx"),
        _ => find_file_in_dir(root, "kokoro-multi-lang-v1_1", "model.onnx")
            .or_else(|| find_file_in_dir(root, "kokoro-int8-multi-lang-v1_1", "model.int8.onnx"))
            .or_else(|| find_file(root, "model.onnx"))
            .or_else(|| find_file(root, "model.int8.onnx")),
    }?;
    let model_root = model.parent()?.to_path_buf();
    let voices = model_root.join("voices.bin");
    let tokens = model_root.join("tokens.txt");
    let data_dir = model_root.join("espeak-ng-data");
    let mut lexicons = Vec::new();
    for name in ["lexicon-us-en.txt", "lexicon-zh.txt"] {
        let path = model_root.join(name);
        if path.is_file() {
            lexicons.push(path);
        }
    }
    if !voices.is_file() || !tokens.is_file() || !data_dir.is_dir() || lexicons.is_empty() {
        return None;
    }

    let rule_fsts = ["date-zh.fst", "phone-zh.fst", "number-zh.fst"]
        .into_iter()
        .map(|name| model_root.join(name))
        .filter(|path| path.is_file())
        .collect();

    Some(KokoroModel {
        model,
        voices,
        tokens,
        data_dir,
        lexicons,
        rule_fsts,
    })
}

fn normalize_tts_variant(variant: Option<&str>) -> Option<&'static str> {
    match variant.map(|value| value.trim().to_ascii_lowercase()) {
        Some(value) if value == "quality" || value == "standard" || value == "full" => {
            Some("quality")
        }
        Some(value) if value == "int8" || value == "lite" || value == "light" => Some("int8"),
        _ => None,
    }
}

fn tts_model_missing_message(variant: Option<&str>) -> String {
    match normalize_tts_variant(variant) {
        Some("quality") => "Kokoro 高质量 TTS 模型未就绪，请先下载并解压非量化模型。".to_string(),
        Some("int8") => "Kokoro int8 TTS 模型未就绪，请先下载并解压轻量模型。".to_string(),
        _ => "Kokoro TTS 模型未就绪，请先下载并解压模型。".to_string(),
    }
}

fn find_spleeter_model(root: &Path) -> Option<SpleeterModel> {
    let vocals = find_file(root, "vocals.fp16.onnx")
        .or_else(|| find_file(root, "vocals.int8.onnx"))
        .or_else(|| find_file(root, "vocals.onnx"))?;
    let model_root = vocals.parent()?.to_path_buf();
    let accompaniment = [
        "accompaniment.fp16.onnx",
        "accompaniment.int8.onnx",
        "accompaniment.onnx",
    ]
    .into_iter()
    .map(|name| model_root.join(name))
    .find(|path| path.is_file())?;

    Some(SpleeterModel {
        vocals,
        accompaniment,
    })
}

fn find_file(root: &Path, file_name: &str) -> Option<PathBuf> {
    find_files(root, file_name).into_iter().next()
}

fn find_file_in_dir(root: &Path, dir_name: &str, file_name: &str) -> Option<PathBuf> {
    find_files(root, file_name).into_iter().find(|path| {
        path.components().any(|component| {
            component
                .as_os_str()
                .to_str()
                .map(|name| name.eq_ignore_ascii_case(dir_name))
                .unwrap_or(false)
        })
    })
}

fn find_files(root: &Path, file_name: &str) -> Vec<PathBuf> {
    if !root.is_dir() {
        return Vec::new();
    }
    let mut matches = Vec::new();
    let mut stack = vec![root.to_path_buf()];
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
                    .map(|name| name.eq_ignore_ascii_case(file_name))
                    .unwrap_or(false)
            {
                matches.push(path);
                continue;
            }
            if path.is_dir() {
                stack.push(path);
            }
        }
    }
    matches.sort_by(|left, right| {
        left.to_string_lossy()
            .to_ascii_lowercase()
            .cmp(&right.to_string_lossy().to_ascii_lowercase())
    });
    matches
}

fn prepare_wav(
    input_path: &str,
    sample_rate: Option<u32>,
    channels: Option<u32>,
    prefix: &str,
) -> Result<PathBuf, String> {
    let input = Path::new(input_path);
    if !input.is_file() {
        return Err(format!("输入文件不存在: {}", input.display()));
    }
    let ffmpeg = crate::media_convert::find_ffmpeg_binary()
        .ok_or_else(|| "未找到 FFmpeg，无法为 sherpa-onnx 准备 WAV 输入".to_string())?;
    let temp_dir = std::env::temp_dir()
        .join("McStartUP")
        .join("sherpa-audio")
        .join(Uuid::new_v4().to_string());
    fs::create_dir_all(&temp_dir).map_err(|error| format!("创建临时目录失败: {}", error))?;
    let wav = temp_dir.join(format!("{}_input.wav", prefix));

    let mut command = Command::new(ffmpeg);
    command.arg("-y").arg("-i").arg(input).arg("-vn");
    if let Some(channels) = channels {
        command.arg("-ac").arg(channels.to_string());
    }
    if let Some(sample_rate) = sample_rate {
        command.arg("-ar").arg(sample_rate.to_string());
    }
    command.arg("-c:a").arg("pcm_s16le").arg(&wav);
    apply_no_window(&mut command);
    run_command(command, "FFmpeg 准备 WAV 输入失败")?;
    ensure_output_file(&wav, "WAV 输入文件")?;
    Ok(wav)
}

fn output_path_for_input(
    input_path: &str,
    output_dir: Option<String>,
    suffix: &str,
    extension: &str,
) -> Result<PathBuf, String> {
    let input = Path::new(input_path);
    let stem = input
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("audio");
    let dir = output_dir
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| input.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."));
    fs::create_dir_all(&dir).map_err(|error| format!("创建输出目录失败: {}", error))?;
    Ok(unique_path(
        dir.join(format!("{}_{}.{}", stem, suffix, extension)),
    ))
}

fn output_path_for_text(
    model_dir: &str,
    output_dir: Option<String>,
    stem: &str,
    extension: &str,
) -> Result<PathBuf, String> {
    let dir = output_dir
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| sherpa_base_dir(model_dir).join("outputs"));
    fs::create_dir_all(&dir).map_err(|error| format!("创建输出目录失败: {}", error))?;
    Ok(unique_path(dir.join(format!("{}.{}", stem, extension))))
}

fn unique_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("output")
        .to_string();
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    for index in 1..1000 {
        let file_name = if ext.is_empty() {
            format!("{}_{}", stem, index)
        } else {
            format!("{}_{}.{}", stem, index, ext)
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    path
}

struct CommandOutput {
    stdout: String,
    stderr: String,
}

fn run_command(mut command: Command, prefix: &str) -> Result<CommandOutput, String> {
    let output = command
        .output()
        .map_err(|error| format!("{}: {}", prefix, error))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(format!(
            "{}: {}",
            prefix,
            if stderr.is_empty() {
                stdout.clone()
            } else {
                stderr.clone()
            }
        ));
    }
    Ok(CommandOutput { stdout, stderr })
}

fn parse_transcript(stdout: &str, input_path: &Path) -> String {
    let mut json_texts = Vec::new();
    for line in stdout.lines() {
        if let Some(text) = parse_transcript_json_text(line) {
            if json_texts.last() != Some(&text) {
                json_texts.push(text);
            }
        }
    }
    if !json_texts.is_empty() {
        return json_texts.join("\n");
    }

    let input_name = input_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let lines = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.contains(input_name))
        .filter(|line| !line.starts_with("Started") && !line.starts_with("Elapsed"))
        .filter(|line| !line.starts_with("Done"))
        .filter(|line| !line.starts_with("Creating recognizer"))
        .filter(|line| !line.starts_with("recognizer created"))
        .filter(|line| !line.starts_with("num threads:"))
        .filter(|line| !line.starts_with("decoding method:"))
        .filter(|line| !line.starts_with("Real time factor"))
        .filter(|line| !line.starts_with("OfflineRecognizerConfig("))
        .filter(|line| *line != "----")
        .collect::<Vec<_>>();
    if lines.is_empty() {
        stdout.trim().to_string()
    } else {
        lines.last().unwrap_or(&"").to_string()
    }
}

fn parse_transcript_json_text(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end <= start {
        return None;
    }

    let value: serde_json::Value = serde_json::from_str(&trimmed[start..=end]).ok()?;
    value
        .get("text")
        .and_then(|text| text.as_str())
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToString::to_string)
}

fn ensure_output_file(path: &Path, label: &str) -> Result<(), String> {
    if path.is_file() && file_size(path) > 0 {
        Ok(())
    } else {
        Err(format!("{}未生成或为空: {}", label, path.display()))
    }
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

fn join_log(stdout: &str, stderr: &str) -> String {
    match (stdout.trim().is_empty(), stderr.trim().is_empty()) {
        (true, true) => String::new(),
        (false, true) => stdout.trim().to_string(),
        (true, false) => stderr.trim().to_string(),
        (false, false) => format!("{}\n{}", stdout.trim(), stderr.trim()),
    }
}

fn apply_no_window(command: &mut Command) {
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
}
