use chrono::{SecondsFormat, Utc};
use ndarray::Array4;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::{DynValue, Tensor};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::{Mutex, MutexGuard, OnceLock};
use tokenizers::Tokenizer;
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipWriter};

const TEXT_MODEL_DIR_NAME: &str = "software-copyright-qwen2.5-0.5b";
const TEXT_MODEL_REQUIRED_FILES: &[&str] = &[
    "config.json",
    "generation_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "onnx/model_q4.onnx",
];
const TEXT_MODEL_LAYERS: usize = 24;
const TEXT_MODEL_KV_HEADS: usize = 2;
const TEXT_MODEL_HEAD_DIM: usize = 64;
const TEXT_MODEL_EOS_TOKENS: &[u32] = &[151643, 151645];
const TEXT_MODEL_MAX_INPUT_TOKENS: usize = 1800;
const TEXT_MODEL_DEFAULT_MAX_NEW_TOKENS: usize = 520;
const TEXT_MODEL_MAX_NEW_TOKENS: usize = 1200;
const TEXT_MODEL_MAX_THREADS: usize = 4;

static SOFTWARE_COPYRIGHT_QWEN: OnceLock<Mutex<Option<SoftwareCopyrightQwenRuntime>>> =
    OnceLock::new();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareCopyrightTextFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareCopyrightWriteFilesRequest {
    #[serde(default)]
    pub dirs: Vec<String>,
    #[serde(default)]
    pub files: Vec<SoftwareCopyrightTextFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareCopyrightAnalyzeRequest {
    pub root: String,
    pub max_files: Option<usize>,
    pub max_chars_per_file: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareCopyrightProjectFile {
    pub path: String,
    pub relative_path: String,
    pub name: String,
    pub ext: String,
    pub language: String,
    pub kind: String,
    pub size: usize,
    pub lines: usize,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareCopyrightScanResult {
    pub files: Vec<SoftwareCopyrightProjectFile>,
    pub total_files: usize,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareCopyrightTextModelStatus {
    pub model_ready: bool,
    pub mode: String,
    pub model_dir: String,
    pub message: String,
    pub required_files: Vec<String>,
    pub missing_files: Vec<String>,
    pub validation_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareCopyrightDocxRequest {
    pub output_path: String,
    pub title: String,
    pub content: String,
    pub kind: Option<String>,
    pub header_text: Option<String>,
    pub lines_per_page: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareCopyrightGenerateMainFunctionsRequest {
    pub prompt: String,
    pub max_new_tokens: Option<usize>,
    pub min_output_chars: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareCopyrightGenerateMainFunctionsResult {
    pub text: String,
    pub generated_tokens: usize,
    pub model_dir: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SoftwareCopyrightGenerationProgress {
    stage: String,
    progress: usize,
    generated_tokens: usize,
    max_new_tokens: usize,
    message: String,
}

struct SoftwareCopyrightQwenRuntime {
    model_path: std::path::PathBuf,
    tokenizer_path: std::path::PathBuf,
    model_signature: FileSignature,
    tokenizer_signature: FileSignature,
    session: Session,
    tokenizer: Tokenizer,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FileSignature {
    len: u64,
    modified_ms: u128,
}

#[tauri::command]
pub async fn software_copyright_scan_project(
    request: SoftwareCopyrightAnalyzeRequest,
) -> Result<SoftwareCopyrightScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || scan_project(&request))
        .await
        .map_err(|error| format!("扫描软著项目任务失败: {}", error))?
}

#[tauri::command]
pub async fn software_copyright_write_files(
    request: SoftwareCopyrightWriteFilesRequest,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_files(&request))
        .await
        .map_err(|error| format!("写入软著资料任务失败: {}", error))?
}

#[tauri::command]
pub async fn software_copyright_write_docx(
    request: SoftwareCopyrightDocxRequest,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_docx(&request))
        .await
        .map_err(|error| format!("生成 DOCX 任务失败: {}", error))?
}

#[tauri::command]
pub fn check_software_copyright_text_model_runtime(
) -> Result<SoftwareCopyrightTextModelStatus, String> {
    Ok(software_copyright_text_model_status())
}

#[tauri::command]
pub async fn software_copyright_generate_main_functions(
    app_handle: tauri::AppHandle,
    request: SoftwareCopyrightGenerateMainFunctionsRequest,
) -> Result<SoftwareCopyrightGenerateMainFunctionsResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        generate_main_functions_with_qwen(app_handle, request)
    })
    .await
    .map_err(|error| format!("Qwen 后端推理任务失败: {}", error))?
}

fn scan_project(
    request: &SoftwareCopyrightAnalyzeRequest,
) -> Result<SoftwareCopyrightScanResult, String> {
    let root = Path::new(&request.root);
    if !root.is_dir() {
        return Err("请选择有效的软件项目目录。".to_string());
    }
    let max_files = request.max_files.unwrap_or(8_000).clamp(100, 50_000);
    let max_chars_per_file = request
        .max_chars_per_file
        .unwrap_or(140_000)
        .clamp(1_000, 2_000_000);
    let mut files = Vec::new();
    let mut visited_files = 0_usize;
    scan_dir(
        root,
        root,
        0,
        max_files,
        max_chars_per_file,
        &mut visited_files,
        &mut files,
    )?;
    let truncated = files.len() >= max_files;
    Ok(SoftwareCopyrightScanResult {
        files,
        total_files: visited_files,
        truncated,
    })
}

fn scan_dir(
    root: &Path,
    current: &Path,
    depth: usize,
    max_files: usize,
    max_chars_per_file: usize,
    visited_files: &mut usize,
    files: &mut Vec<SoftwareCopyrightProjectFile>,
) -> Result<(), String> {
    if depth > 64 || files.len() >= max_files {
        return Ok(());
    }
    let entries = match std::fs::read_dir(current) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    let mut entries = entries.filter_map(Result::ok).collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        if files.len() >= max_files {
            return Ok(());
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if entry
            .file_type()
            .map(|kind| kind.is_symlink())
            .unwrap_or(true)
        {
            continue;
        }
        if path.is_dir() {
            if should_ignore_dir(&name) || name.starts_with('.') {
                continue;
            }
            scan_dir(
                root,
                &path,
                depth + 1,
                max_files,
                max_chars_per_file,
                visited_files,
                files,
            )?;
            continue;
        }
        *visited_files += 1;
        let ext = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if should_skip_file(&name) {
            continue;
        }
        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let Some((kind, language)) = classify_file(&name, &relative_path, &ext) else {
            continue;
        };
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        if metadata.len() > max_chars_per_file as u64 {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        if bytes.iter().take(2048).any(|byte| *byte == 0) {
            continue;
        }
        let mut content = String::from_utf8_lossy(&bytes).to_string();
        if content.chars().count() > max_chars_per_file {
            content = content.chars().take(max_chars_per_file).collect();
        }
        let content = content.replace("\r\n", "\n").replace('\r', "\n");
        files.push(SoftwareCopyrightProjectFile {
            path: path.to_string_lossy().to_string(),
            relative_path,
            name,
            ext,
            language: language.to_string(),
            kind: kind.to_string(),
            size: content.len(),
            lines: content.split('\n').count(),
            content,
        });
    }
    Ok(())
}

fn software_copyright_text_model_dir() -> std::path::PathBuf {
    std::env::var("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("McStartUP")
        .join("models")
        .join(TEXT_MODEL_DIR_NAME)
}

fn software_copyright_text_model_status() -> SoftwareCopyrightTextModelStatus {
    let model_dir = software_copyright_text_model_dir();
    let _ = std::fs::create_dir_all(&model_dir);
    let required_files = TEXT_MODEL_REQUIRED_FILES
        .iter()
        .map(|file| file.to_string())
        .collect::<Vec<_>>();
    let missing_files = required_files
        .iter()
        .filter(|file| {
            let path = model_dir.join(file);
            !path
                .metadata()
                .map(|metadata| metadata.is_file() && metadata.len() > 0)
                .unwrap_or(false)
        })
        .cloned()
        .collect::<Vec<_>>();
    let model_ready = missing_files.is_empty();

    SoftwareCopyrightTextModelStatus {
        model_ready,
        mode: if model_ready {
            "onnx-qwen".to_string()
        } else {
            "missing".to_string()
        },
        model_dir: model_dir.to_string_lossy().to_string(),
        message: if model_ready {
            "本地 Qwen2.5 轻量文本模型文件已就绪。模型仅在点击 AI 整理或 AI 分析字段时使用；添加目录扫描默认使用本地规则。"
                .to_string()
        } else {
            "未检测到 Qwen2.5-0.5B-Instruct ONNX 文本模型。AI 分析和整理需要先下载模型文件。"
                .to_string()
        },
        required_files,
        missing_files,
        validation_error: None,
    }
}

fn generate_main_functions_with_qwen(
    app_handle: tauri::AppHandle,
    request: SoftwareCopyrightGenerateMainFunctionsRequest,
) -> Result<SoftwareCopyrightGenerateMainFunctionsResult, String> {
    let status = software_copyright_text_model_status();
    if !status.model_ready {
        return Err(format!(
            "Qwen 模型文件不完整，缺少：{}",
            status.missing_files.join(" / ")
        ));
    }
    let model_dir = software_copyright_text_model_dir();
    let max_new_tokens = request
        .max_new_tokens
        .unwrap_or(TEXT_MODEL_DEFAULT_MAX_NEW_TOKENS)
        .clamp(64, TEXT_MODEL_MAX_NEW_TOKENS);
    let min_output_chars = request
        .min_output_chars
        .unwrap_or(0)
        .min(usize::min(900, max_new_tokens.saturating_mul(2)));
    emit_generation_progress(
        &app_handle,
        "loading",
        2,
        0,
        max_new_tokens,
        "正在加载后端 Qwen 模型",
    );

    let mut guard = qwen_runtime()?;
    let runtime = guard
        .as_mut()
        .ok_or_else(|| "Qwen 运行时初始化失败".to_string())?;

    let input_ids = encode_qwen_prompt(&runtime.tokenizer, &request.prompt)?;
    let input_ids = tail_tokens(input_ids, TEXT_MODEL_MAX_INPUT_TOKENS);
    if input_ids.is_empty() {
        return Err("Qwen 输入为空，无法生成软著文本内容。".to_string());
    }

    emit_generation_progress(
        &app_handle,
        "generating",
        5,
        0,
        max_new_tokens,
        "正在后端生成软著文本内容",
    );
    let generated = qwen_greedy_generate(
        &mut runtime.session,
        &runtime.tokenizer,
        input_ids,
        max_new_tokens,
        min_output_chars,
        |generated_tokens, max_tokens| {
            let progress = 5 + ((generated_tokens.min(max_tokens) * 94) / max_tokens.max(1));
            emit_generation_progress(
                &app_handle,
                "generating",
                progress.min(99),
                generated_tokens,
                max_tokens,
                "正在后端生成软著文本内容",
            );
        },
    )?;
    emit_generation_progress(
        &app_handle,
        "done",
        100,
        generated.1,
        max_new_tokens,
        "Qwen 后端推理完成",
    );

    Ok(SoftwareCopyrightGenerateMainFunctionsResult {
        text: generated.0,
        generated_tokens: generated.1,
        model_dir: model_dir.to_string_lossy().to_string(),
    })
}

fn qwen_runtime() -> Result<MutexGuard<'static, Option<SoftwareCopyrightQwenRuntime>>, String> {
    let model_dir = software_copyright_text_model_dir();
    let model_path = model_dir.join("onnx").join("model_q4.onnx");
    let tokenizer_path = model_dir.join("tokenizer.json");
    let model_signature = file_signature(&model_path)
        .map_err(|error| format!("读取 Qwen 模型文件信息失败: {}", error))?;
    let tokenizer_signature = file_signature(&tokenizer_path)
        .map_err(|error| format!("读取 Qwen tokenizer 文件信息失败: {}", error))?;

    let cache = SOFTWARE_COPYRIGHT_QWEN.get_or_init(|| Mutex::new(None));
    let mut guard = cache
        .lock()
        .map_err(|_| "Qwen 后端模型会话锁定失败".to_string())?;
    let needs_reload = guard
        .as_ref()
        .map(|entry| {
            entry.model_path != model_path
                || entry.tokenizer_path != tokenizer_path
                || entry.model_signature != model_signature
                || entry.tokenizer_signature != tokenizer_signature
        })
        .unwrap_or(true);

    if needs_reload {
        let thread_count = qwen_thread_count();
        let session = Session::builder()
            .map_err(|error| format!("创建 Qwen ONNX 会话失败: {}", error))?
            .with_optimization_level(GraphOptimizationLevel::Level1)
            .map_err(|error| format!("设置 Qwen ONNX 优化级别失败: {}", error))?
            .with_intra_threads(thread_count)
            .map_err(|error| format!("设置 Qwen ONNX 线程数失败: {}", error))?
            .commit_from_file(&model_path)
            .map_err(|error| format!("加载 Qwen ONNX 模型失败: {}", error))?;
        let tokenizer = Tokenizer::from_file(&tokenizer_path)
            .map_err(|error| format!("加载 Qwen tokenizer 失败: {}", error))?;
        *guard = Some(SoftwareCopyrightQwenRuntime {
            model_path,
            tokenizer_path,
            model_signature,
            tokenizer_signature,
            session,
            tokenizer,
        });
    }

    Ok(guard)
}

fn qwen_thread_count() -> usize {
    std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(2)
        .saturating_div(2)
        .clamp(1, TEXT_MODEL_MAX_THREADS)
}

fn encode_qwen_prompt(tokenizer: &Tokenizer, prompt: &str) -> Result<Vec<u32>, String> {
    let chat_prompt = format!(
        "<|im_start|>system\n你是软件著作权材料整理助手，只输出符合登记字段的正式中文正文。<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n",
        prompt
    );
    tokenizer
        .encode(chat_prompt, false)
        .map(|encoding| encoding.get_ids().to_vec())
        .map_err(|error| format!("Qwen 输入编码失败: {}", error))
}

fn tail_tokens(mut tokens: Vec<u32>, max_len: usize) -> Vec<u32> {
    if tokens.len() <= max_len {
        return tokens;
    }
    let keep_from = tokens.len() - max_len;
    tokens.drain(0..keep_from);
    tokens
}

fn qwen_greedy_generate<F>(
    session: &mut Session,
    tokenizer: &Tokenizer,
    prompt_ids: Vec<u32>,
    max_new_tokens: usize,
    min_output_chars: usize,
    mut on_progress: F,
) -> Result<(String, usize), String>
where
    F: FnMut(usize, usize),
{
    let mut generated_ids: Vec<u32> = Vec::new();
    let mut next_input_ids = prompt_ids
        .iter()
        .map(|token| i64::from(*token))
        .collect::<Vec<_>>();
    let mut past_len = 0_usize;
    let mut past: Vec<(DynValue, DynValue)> = Vec::new();

    for step in 0..max_new_tokens {
        let seq_len = next_input_ids.len();
        let total_len = past_len + seq_len;
        let attention_mask = vec![1_i64; total_len];
        let position_ids = (past_len..total_len)
            .map(|value| value as i64)
            .collect::<Vec<_>>();
        let mut inputs = Vec::with_capacity(3 + TEXT_MODEL_LAYERS * 2);
        inputs.push((
            "input_ids".to_string(),
            Tensor::from_array((
                vec![1_usize, seq_len],
                next_input_ids.clone().into_boxed_slice(),
            ))
            .map_err(|error| format!("创建 Qwen input_ids 张量失败: {}", error))?
            .into_dyn(),
        ));
        inputs.push((
            "attention_mask".to_string(),
            Tensor::from_array((vec![1_usize, total_len], attention_mask.into_boxed_slice()))
                .map_err(|error| format!("创建 Qwen attention_mask 张量失败: {}", error))?
                .into_dyn(),
        ));
        inputs.push((
            "position_ids".to_string(),
            Tensor::from_array((vec![1_usize, seq_len], position_ids.into_boxed_slice()))
                .map_err(|error| format!("创建 Qwen position_ids 张量失败: {}", error))?
                .into_dyn(),
        ));

        if past.is_empty() {
            for layer in 0..TEXT_MODEL_LAYERS {
                inputs.push((
                    format!("past_key_values.{}.key", layer),
                    Tensor::from_array(Array4::<f32>::zeros((
                        1,
                        TEXT_MODEL_KV_HEADS,
                        0,
                        TEXT_MODEL_HEAD_DIM,
                    )))
                    .map_err(|error| format!("创建 Qwen 空 key cache 失败: {}", error))?
                    .into_dyn(),
                ));
                inputs.push((
                    format!("past_key_values.{}.value", layer),
                    Tensor::from_array(Array4::<f32>::zeros((
                        1,
                        TEXT_MODEL_KV_HEADS,
                        0,
                        TEXT_MODEL_HEAD_DIM,
                    )))
                    .map_err(|error| format!("创建 Qwen 空 value cache 失败: {}", error))?
                    .into_dyn(),
                ));
            }
        } else {
            for (layer, (key, value)) in past.into_iter().enumerate() {
                inputs.push((format!("past_key_values.{}.key", layer), key));
                inputs.push((format!("past_key_values.{}.value", layer), value));
            }
        }

        let mut outputs = session
            .run(inputs)
            .map_err(|error| format!("Qwen 后端推理失败: {}", error))?;
        let logits = outputs["logits"]
            .try_extract_array::<f32>()
            .map_err(|error| format!("读取 Qwen logits 失败: {}", error))?;
        let dims = logits.shape();
        if dims.len() != 3 || dims[1] == 0 || dims[2] == 0 {
            return Err(format!("Qwen logits 维度异常: {:?}", dims));
        }
        let last_index = dims[1] - 1;
        let vocab = dims[2];
        let must_continue = min_output_chars > 0
            && generated_text_char_count(tokenizer, &generated_ids) < min_output_chars;
        let mut best_id = 0_usize;
        let mut best_score = f32::NEG_INFINITY;
        for token_id in 0..vocab {
            if must_continue && TEXT_MODEL_EOS_TOKENS.contains(&(token_id as u32)) {
                continue;
            }
            let score = logits[[0, last_index, token_id]];
            if score > best_score {
                best_score = score;
                best_id = token_id;
            }
        }
        drop(logits);

        past = Vec::with_capacity(TEXT_MODEL_LAYERS);
        for layer in 0..TEXT_MODEL_LAYERS {
            let key = outputs
                .remove(format!("present.{}.key", layer))
                .ok_or_else(|| format!("Qwen 输出缺少 present.{}.key", layer))?;
            let value = outputs
                .remove(format!("present.{}.value", layer))
                .ok_or_else(|| format!("Qwen 输出缺少 present.{}.value", layer))?;
            past.push((key, value));
        }

        let next_token = best_id as u32;
        if TEXT_MODEL_EOS_TOKENS.contains(&next_token) {
            return decode_qwen_output(tokenizer, &generated_ids).map(|text| (text, step));
        }
        generated_ids.push(next_token);
        on_progress(generated_ids.len(), max_new_tokens);
        next_input_ids = vec![i64::from(next_token)];
        past_len = total_len;

        if generated_ids.len() >= 80
            && sentence_like_finished(tokenizer, &generated_ids, min_output_chars)
        {
            break;
        }
    }

    decode_qwen_output(tokenizer, &generated_ids).map(|text| (text, generated_ids.len()))
}

fn generated_text_char_count(tokenizer: &Tokenizer, ids: &[u32]) -> usize {
    decode_qwen_output(tokenizer, ids)
        .map(|text| text.chars().filter(|ch| !ch.is_whitespace()).count())
        .unwrap_or(0)
}

fn decode_qwen_output(tokenizer: &Tokenizer, ids: &[u32]) -> Result<String, String> {
    tokenizer
        .decode(ids, true)
        .map(|text| {
            text.replace("<|im_end|>", "")
                .replace("<|endoftext|>", "")
                .trim()
                .to_string()
        })
        .map_err(|error| format!("Qwen 输出解码失败: {}", error))
}

fn sentence_like_finished(tokenizer: &Tokenizer, ids: &[u32], min_output_chars: usize) -> bool {
    let Ok(text) = decode_qwen_output(tokenizer, ids) else {
        return false;
    };
    let count = text.chars().filter(|ch| !ch.is_whitespace()).count();
    count >= min_output_chars.max(500) && matches!(text.chars().last(), Some('。' | '！' | '？'))
}

fn emit_generation_progress(
    app_handle: &tauri::AppHandle,
    stage: &str,
    progress: usize,
    generated_tokens: usize,
    max_new_tokens: usize,
    message: &str,
) {
    use tauri::Manager;
    let _ = app_handle.emit_all(
        "software-copyright-qwen-progress",
        SoftwareCopyrightGenerationProgress {
            stage: stage.to_string(),
            progress,
            generated_tokens,
            max_new_tokens,
            message: message.to_string(),
        },
    );
}

fn file_signature(path: &Path) -> std::io::Result<FileSignature> {
    let metadata = std::fs::metadata(path)?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    Ok(FileSignature {
        len: metadata.len(),
        modified_ms,
    })
}

fn should_ignore_dir(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "node_modules"
            | "target"
            | "dist"
            | "build"
            | "out"
            | ".git"
            | ".next"
            | ".nuxt"
            | ".svelte-kit"
            | ".tauri"
            | "coverage"
            | "__pycache__"
            | ".pytest_cache"
            | ".mypy_cache"
            | ".ruff_cache"
            | ".idea"
            | ".vscode"
            | "__tests__"
            | "test"
            | "tests"
            | "mocks"
            | "mock"
            | "fixtures"
            | "generated"
            | "tmp"
            | "temp"
            | "软件著作权申请资料"
    )
}

fn should_skip_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let ext = Path::new(&lower)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let sensitive_config = matches!(
        ext,
        "json" | "yml" | "yaml" | "toml" | "xml" | "properties" | "ini" | "conf"
    ) && (lower.contains("secret")
        || lower.contains("credential")
        || lower.contains("password")
        || lower.contains("token"));
    lower == ".env"
        || lower.starts_with(".env.")
        || lower.ends_with(".pem")
        || lower.ends_with(".key")
        || sensitive_config
        || lower.contains(".min.")
        || lower.ends_with(".map")
        || lower.ends_with(".lock")
        || lower.ends_with(".d.ts")
        || lower.ends_with(".test.ts")
        || lower.ends_with(".test.tsx")
        || lower.ends_with(".test.js")
        || lower.ends_with(".test.jsx")
        || lower.ends_with(".spec.ts")
        || lower.ends_with(".spec.tsx")
        || lower.ends_with(".spec.js")
        || lower.ends_with(".spec.jsx")
        || lower.ends_with(".stories.tsx")
        || lower.ends_with(".stories.ts")
        || lower.ends_with(".stories.jsx")
        || lower.ends_with(".stories.js")
        || matches!(
            lower.as_str(),
            "package-lock.json"
                | "pnpm-lock.yaml"
                | "yarn.lock"
                | "cargo.lock"
                | "composer.lock"
                | "poetry.lock"
                | "go.sum"
                | "thumbs.db"
                | ".ds_store"
        )
}

fn classify_file(
    name: &str,
    relative_path: &str,
    ext: &str,
) -> Option<(&'static str, &'static str)> {
    let lower_name = name.to_ascii_lowercase();
    let lower_path = relative_path.to_ascii_lowercase();
    if let Some(language) = config_language(&lower_name, &lower_path, ext) {
        return Some(("config", language));
    }
    if let Some(language) = doc_language(ext, &lower_name) {
        return Some(("doc", language));
    }
    source_language(ext).map(|language| ("source", language))
}

fn config_language(name: &str, path: &str, ext: &str) -> Option<&'static str> {
    if matches!(
        name,
        "package.json"
            | "pom.xml"
            | "build.gradle"
            | "build.gradle.kts"
            | "settings.gradle"
            | "settings.gradle.kts"
            | "requirements.txt"
            | "pyproject.toml"
            | "setup.py"
            | "pubspec.yaml"
            | "go.mod"
            | "composer.json"
            | "cargo.toml"
            | "tauri.conf.json"
            | "vite.config.ts"
            | "vite.config.js"
            | "webpack.config.js"
            | "next.config.js"
            | "nuxt.config.ts"
            | "dockerfile"
            | "makefile"
    ) {
        return Some("Config");
    }
    if path.ends_with("/package.json")
        || path.ends_with("/pom.xml")
        || path.ends_with("/build.gradle")
        || path.ends_with("/build.gradle.kts")
        || path.ends_with("/requirements.txt")
        || path.ends_with("/pubspec.yaml")
        || path.ends_with("/go.mod")
        || path.ends_with("/composer.json")
    {
        return Some("Config");
    }
    match ext {
        "json" | "yml" | "yaml" | "toml" | "xml" | "gradle" | "properties" => Some("Config"),
        _ => None,
    }
}

fn source_language(ext: &str) -> Option<&'static str> {
    match ext {
        "ts" | "tsx" => Some("TypeScript"),
        "js" | "jsx" | "mjs" | "cjs" => Some("JavaScript"),
        "vue" => Some("Vue"),
        "svelte" => Some("Svelte"),
        "rs" => Some("Rust"),
        "py" => Some("Python"),
        "java" => Some("Java"),
        "kt" | "kts" => Some("Kotlin"),
        "go" => Some("Go"),
        "php" => Some("PHP"),
        "cs" => Some("C#"),
        "cpp" | "cc" | "cxx" | "c" | "h" | "hpp" => Some("C/C++"),
        "swift" => Some("Swift"),
        "dart" => Some("Dart"),
        "html" | "htm" => Some("HTML"),
        "css" | "scss" | "sass" | "less" => Some("Style"),
        "sql" => Some("SQL"),
        "sh" | "bat" | "ps1" => Some("Script"),
        _ => None,
    }
}

fn doc_language(ext: &str, name: &str) -> Option<&'static str> {
    if name == "readme" || name.starts_with("readme.") {
        return Some("文档");
    }
    match ext {
        "md" | "mdx" | "txt" | "rst" => Some("文档"),
        _ => None,
    }
}

fn write_files(request: &SoftwareCopyrightWriteFilesRequest) -> Result<(), String> {
    for dir in &request.dirs {
        if dir.trim().is_empty() {
            continue;
        }
        std::fs::create_dir_all(Path::new(dir))
            .map_err(|error| format!("创建目录失败 {}: {}", dir, error))?;
    }

    for file in &request.files {
        let path = Path::new(&file.path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("创建输出目录失败 {}: {}", parent.display(), error))?;
        }
        std::fs::write(path, file.content.as_bytes())
            .map_err(|error| format!("写入文件失败 {}: {}", file.path, error))?;
    }
    Ok(())
}

fn write_docx(request: &SoftwareCopyrightDocxRequest) -> Result<(), String> {
    let path = Path::new(&request.output_path);
    let is_docx = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("docx"))
        .unwrap_or(false);
    if !is_docx {
        return Err("输出文件必须是 .docx 格式。".to_string());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("创建输出目录失败: {}", error))?;
    }

    let file = File::create(path).map_err(|error| format!("创建 Word 文件失败: {}", error))?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default().compression_method(CompressionMethod::Deflated);
    write_zip_file(
        &mut zip,
        "[Content_Types].xml",
        content_types_xml(),
        options,
    )?;
    write_zip_file(&mut zip, "_rels/.rels", package_rels_xml(), options)?;
    write_zip_file(
        &mut zip,
        "word/document.xml",
        document_xml(request),
        options,
    )?;
    write_zip_file(&mut zip, "word/styles.xml", styles_xml(), options)?;
    write_zip_file(&mut zip, "word/settings.xml", settings_xml(), options)?;
    write_zip_file(
        &mut zip,
        "word/header1.xml",
        header_xml(request.header_text.as_deref().unwrap_or(&request.title)),
        options,
    )?;
    write_zip_file(&mut zip, "word/footer1.xml", footer_xml(), options)?;
    write_zip_file(
        &mut zip,
        "word/_rels/document.xml.rels",
        document_rels_xml(),
        options,
    )?;
    write_zip_file(
        &mut zip,
        "docProps/core.xml",
        core_props_xml(&request.title),
        options,
    )?;
    write_zip_file(&mut zip, "docProps/app.xml", app_props_xml(), options)?;
    zip.finish()
        .map_err(|error| format!("保存 Word 文件失败: {}", error))?;
    Ok(())
}

fn write_zip_file(
    zip: &mut ZipWriter<File>,
    name: &str,
    content: String,
    options: FileOptions,
) -> Result<(), String> {
    zip.start_file(name, options)
        .map_err(|error| format!("写入 Word 条目失败: {}", error))?;
    zip.write_all(content.as_bytes())
        .map_err(|error| format!("写入 Word 内容失败: {}", error))
}

fn document_xml(request: &SoftwareCopyrightDocxRequest) -> String {
    let kind = request.kind.as_deref().unwrap_or("manual");
    let mut body = String::new();
    if kind != "code" {
        body.push_str(&paragraph(&request.title, "Title", false, false));
    }
    let code_lines_per_page = request.lines_per_page.unwrap_or(60).clamp(50, 80);
    let mut code_line_index = 0_usize;
    for raw_line in request.content.split('\n') {
        let line = raw_line.trim_end();
        if kind == "code" {
            let page_break = code_line_index > 0 && code_line_index % code_lines_per_page == 0;
            body.push_str(&paragraph(line, "CodeLine", page_break, true));
            code_line_index += 1;
            continue;
        }
        if line.trim().is_empty() {
            body.push_str(&paragraph("", "Normal", false, false));
            continue;
        }
        let (style, text) = if let Some(value) = line.strip_prefix("# ") {
            ("Heading1", value)
        } else if let Some(value) = line.strip_prefix("## ") {
            ("Heading2", value)
        } else if let Some(value) = line.strip_prefix("### ") {
            ("Heading3", value)
        } else if let Some(value) = line.strip_prefix("- ") {
            ("ListParagraph", value)
        } else {
            ("Normal", line)
        };
        if line.starts_with('|') {
            body.push_str(&paragraph(line, "TableLine", false, false));
        } else {
            body.push_str(&paragraph(text, style, false, false));
        }
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    {}
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId3"/>
      <w:footerReference w:type="default" r:id="rId4"/>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>"#,
        body
    )
}

fn paragraph(text: &str, style: &str, page_break: bool, preserve: bool) -> String {
    let text_attr = if preserve {
        r#" xml:space="preserve""#
    } else {
        ""
    };
    let page_break_xml = if page_break {
        r#"<w:r><w:br w:type="page"/></w:r>"#
    } else {
        ""
    };
    format!(
        r#"<w:p><w:pPr><w:pStyle w:val="{}"/></w:pPr>{}<w:r><w:t{}>{}</w:t></w:r></w:p>"#,
        style,
        page_break_xml,
        text_attr,
        escape_xml(text)
    )
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn content_types_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"#
        .to_string()
}

fn package_rels_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"#
        .to_string()
}

fn document_rels_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>"#
        .to_string()
}

fn header_xml(text: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr><w:jc w:val="center"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="000000"/></w:pBdr></w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun"/><w:color w:val="000000"/><w:sz w:val="18"/></w:rPr><w:t>{}</w:t></w:r>
  </w:p>
</w:hdr>"#,
        escape_xml(text)
    )
}

fn footer_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun"/><w:color w:val="000000"/><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun"/><w:color w:val="000000"/><w:sz w:val="18"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun"/><w:color w:val="000000"/><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun"/><w:color w:val="000000"/><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun"/><w:color w:val="000000"/><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
</w:ftr>"#
        .to_string()
}

fn settings_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:zoom w:percent="100"/>
  <w:defaultTabStop w:val="420"/>
</w:settings>"#
        .to_string()
}

fn app_props_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>McStartUP</Application>
</Properties>"#
        .to_string()
}

fn core_props_xml(title: &str) -> String {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>{}</dc:title>
  <dc:creator>McStartUP</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">{}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{}</dcterms:modified>
</cp:coreProperties>"#,
        escape_xml(title),
        now,
        now
    )
}

fn styles_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun"/>
        <w:color w:val="000000"/>
        <w:sz w:val="24"/>
        <w:szCs w:val="24"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="120" w:line="360" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="360"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="240" w:after="180"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:spacing w:before="200" w:after="140"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:spacing w:before="160" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:pPr><w:ind w:left="420"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="TableLine"><w:name w:val="Table Line"/><w:rPr><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="CodeLine"><w:name w:val="Code Line"/><w:pPr><w:spacing w:before="0" w:after="0" w:line="200" w:lineRule="exact"/><w:widowControl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="SimSun"/><w:color w:val="000000"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr></w:style>
</w:styles>"#
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use zip::ZipArchive;

    #[test]
    fn code_docx_has_header_footer_and_fixed_page_breaks() {
        let path =
            std::env::temp_dir().join(format!("mcstartup-copyright-{}.docx", uuid::Uuid::new_v4()));
        let content = (1..=120)
            .map(|line| format!("line {}", line))
            .collect::<Vec<_>>()
            .join("\n");
        let request = SoftwareCopyrightDocxRequest {
            output_path: path.to_string_lossy().to_string(),
            title: "测试软件 源程序鉴别材料".to_string(),
            content,
            kind: Some("code".to_string()),
            header_text: Some("测试软件 V1.0".to_string()),
            lines_per_page: Some(60),
        };

        write_docx(&request).expect("code docx should be generated");
        let file = File::open(&path).expect("generated docx should exist");
        let mut archive = ZipArchive::new(file).expect("generated file should be a zip package");
        let names = (0..archive.len())
            .map(|index| archive.by_index(index).unwrap().name().to_string())
            .collect::<Vec<_>>();
        assert!(names.iter().any(|name| name == "word/header1.xml"));
        assert!(names.iter().any(|name| name == "word/footer1.xml"));

        let mut document_xml = String::new();
        archive
            .by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut document_xml)
            .unwrap();
        assert_eq!(document_xml.matches("w:type=\"page\"").count(), 1);
        assert!(document_xml.contains("r:id=\"rId3\""));
        assert!(document_xml.contains("r:id=\"rId4\""));

        let mut footer_xml = String::new();
        archive
            .by_name("word/footer1.xml")
            .unwrap()
            .read_to_string(&mut footer_xml)
            .unwrap();
        assert!(footer_xml.contains(" PAGE "));

        drop(archive);
        let _ = std::fs::remove_file(path);
    }
}
