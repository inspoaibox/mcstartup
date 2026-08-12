use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const APP_DIR_NAME: &str = "McStartUP";
const PYTHON_CONFIG_FILE: &str = "markitdown_python_path.txt";
const MARKITDOWN_RUNTIME_DIR: &str = "runtimes/markitdown";
const MARKITDOWN_VENV_DIR: &str = ".venv";
const MARKITDOWN_PACKAGE_SPEC: &str = "markitdown[all]";
const MARKITDOWN_EXTRA_PACKAGE_SPEC: &str = "openai";
const MARKITDOWN_DOCS_URL: &str = "https://github.com/microsoft/markitdown";
const MIN_PYTHON_MAJOR: u32 = 3;
const MIN_PYTHON_MINOR: u32 = 10;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkitdownRuntimeStatus {
    pub ready: bool,
    pub mode: String,
    pub python_path: Option<String>,
    pub python_version: Option<String>,
    pub package_version: Option<String>,
    pub install_dir: String,
    pub message: String,
    pub docs_url: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkitdownConvertOptions {
    pub enable_plugins: Option<bool>,
    pub keep_data_uris: Option<bool>,
    pub extension_hint: Option<String>,
    pub mime_type_hint: Option<String>,
    pub charset_hint: Option<String>,
    pub use_docintel: Option<bool>,
    pub docintel_endpoint: Option<String>,
    pub use_content_understanding: Option<bool>,
    pub content_understanding_endpoint: Option<String>,
    pub content_understanding_analyzer: Option<String>,
    pub content_understanding_file_types: Option<String>,
    pub llm_enabled: Option<bool>,
    pub llm_api_key: Option<String>,
    pub llm_base_url: Option<String>,
    pub llm_model: Option<String>,
    pub llm_prompt: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkitdownConvertResult {
    pub output_path: String,
    pub output_size: u64,
    pub title: Option<String>,
    pub characters: usize,
    pub preview: String,
    pub python_path: String,
    pub package_version: Option<String>,
    pub command_summary: String,
}

#[derive(Debug, Deserialize)]
struct PackageProbe {
    ok: bool,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ConvertProbe {
    title: Option<String>,
    characters: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkitdownPluginInfo {
    pub name: String,
    pub value: String,
}

#[tauri::command]
pub fn markitdown_get_custom_python_path() -> Option<String> {
    let config_file = python_config_file().ok()?;
    let path = fs::read_to_string(config_file).ok()?.trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

#[tauri::command]
pub fn markitdown_set_python_path(path: String) -> Result<MarkitdownRuntimeStatus, String> {
    let path = normalize_python_input(&path)
        .ok_or_else(|| "请选择可用的 python.exe 或 Python 安装目录。".to_string())?;
    let config_file = python_config_file()?;
    if let Some(parent) = config_file.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    fs::write(&config_file, &path).map_err(|e| format!("保存 Python 路径失败: {}", e))?;
    markitdown_check_runtime()
}

#[tauri::command]
pub fn markitdown_clear_python_path() -> Result<MarkitdownRuntimeStatus, String> {
    if let Ok(config_file) = python_config_file() {
        let _ = fs::remove_file(config_file);
    }
    markitdown_check_runtime()
}

#[tauri::command]
pub fn markitdown_check_runtime() -> Result<MarkitdownRuntimeStatus, String> {
    let install_dir = default_markitdown_dir()?;
    let configured = markitdown_get_custom_python_path();

    if let Some(configured_python) = configured.as_deref().and_then(normalize_python_input) {
        let python_version = probe_python_version(&configured_python);
        if let Some(message) = python_version_error(python_version.as_deref()) {
            return Ok(status_missing(
                "pythonUnsupported",
                Some(configured_python),
                python_version,
                None,
                install_dir,
                &message,
            ));
        }
        let probe = probe_markitdown_package(&configured_python)?;
        if probe.ok {
            return Ok(status_ready(
                "custom",
                configured_python,
                python_version,
                probe.version,
                install_dir,
            ));
        }
        return Ok(status_missing(
            "packageMissing",
            Some(configured_python),
            python_version,
            None,
            install_dir,
            &format!(
                "当前 Python 环境未安装 MarkItDown。{}",
                probe.error.unwrap_or_default()
            ),
        ));
    }

    if let Some(cached_python) = cached_venv_python(&install_dir).filter(|path| {
        path.is_file() && command_works(path.to_string_lossy().as_ref(), "--version")
    }) {
        let python = cached_python.to_string_lossy().to_string();
        let python_version = probe_python_version(&python);
        if python_version_error(python_version.as_deref()).is_none() {
            let probe = probe_markitdown_package(&python)?;
            if probe.ok {
                return Ok(status_ready(
                    "cached",
                    python,
                    python_version,
                    probe.version,
                    install_dir,
                ));
            }
        }
    }

    let python = resolve_python(None);
    let Some(python) = python else {
        return Ok(status_missing(
            "pythonMissing",
            None,
            None,
            None,
            install_dir,
            "未检测到 Python。MarkItDown 需要 Python 3.10+；可安装 Python 后点击安装到本地缓存。",
        ));
    };

    let python_version = probe_python_version(&python);
    if let Some(message) = python_version_error(python_version.as_deref()) {
        return Ok(status_missing(
            "pythonUnsupported",
            Some(python),
            python_version,
            None,
            install_dir,
            &message,
        ));
    }

    let probe = probe_markitdown_package(&python)?;
    if probe.ok {
        return Ok(status_ready(
            "system",
            python,
            python_version,
            probe.version,
            install_dir,
        ));
    }

    Ok(status_missing(
        "packageMissing",
        Some(python),
        python_version,
        None,
        install_dir,
        &format!(
            "当前 Python 环境未安装 MarkItDown。{}",
            probe.error.unwrap_or_default()
        ),
    ))
}

#[tauri::command]
pub async fn markitdown_install_runtime(
    app_handle: tauri::AppHandle,
    python_path: Option<String>,
) -> Result<MarkitdownRuntimeStatus, String> {
    let configured = python_path
        .as_deref()
        .and_then(|value| resolve_python(Some(value)))
        .or_else(|| resolve_python(markitdown_get_custom_python_path().as_deref()));
    let python = configured.ok_or_else(|| {
        "未检测到 Python。请先安装 Python 3.10+，或选择已安装环境里的 python.exe。".to_string()
    })?;

    let python_version = probe_python_version(&python);
    if let Some(message) = python_version_error(python_version.as_deref()) {
        return Err(message);
    }

    let install_dir = default_markitdown_dir()?;
    let venv_dir = install_dir.join(MARKITDOWN_VENV_DIR);
    let venv_python = cached_venv_python(&install_dir);

    emit_install_progress(&app_handle, "创建隔离运行时", 5);
    if !venv_python.as_ref().is_some_and(|path| {
        path.is_file() && command_works(path.to_string_lossy().as_ref(), "--version")
    }) {
        if venv_dir.exists() {
            let _ = fs::remove_dir_all(&venv_dir);
        }
        let venv_dir_arg = venv_dir.to_string_lossy().to_string();
        run_python_command(&python, &["-m", "venv", venv_dir_arg.as_str()])
            .map_err(|e| format!("创建 MarkItDown 隔离运行时失败: {}", e))?;
    }

    let venv_python = cached_venv_python(&install_dir)
        .filter(|path| path.is_file())
        .ok_or_else(|| "隔离运行时创建完成，但未找到 python 可执行文件。".to_string())?
        .to_string_lossy()
        .to_string();

    emit_install_progress(&app_handle, "检查 pip", 10);
    if !python_module_works(&venv_python, "pip") {
        emit_install_progress(&app_handle, "准备 pip", 20);
        run_python_command(&venv_python, &["-m", "ensurepip", "--upgrade"])
            .map_err(|e| format!("准备 pip 失败: {}", e))?;
    }

    emit_install_progress(&app_handle, "更新 pip", 20);
    run_python_command(&venv_python, &["-m", "pip", "install", "--upgrade", "pip"])
        .map_err(|e| format!("更新 pip 失败: {}", e))?;

    emit_install_progress(&app_handle, "安装 MarkItDown 完整依赖", 35);
    run_python_command(
        &venv_python,
        &[
            "-m",
            "pip",
            "install",
            "--upgrade",
            MARKITDOWN_PACKAGE_SPEC,
            MARKITDOWN_EXTRA_PACKAGE_SPEC,
        ],
    )
    .map_err(|e| format!("安装 MarkItDown 失败: {}", e))?;

    emit_install_progress(&app_handle, "验证 MarkItDown", 92);
    let _ = markitdown_clear_python_path();
    let python_version = probe_python_version(&venv_python);
    let probe = probe_markitdown_package(&venv_python)?;
    if !probe.ok {
        return Err(format!(
            "MarkItDown 已安装但验证失败: {}",
            probe.error.unwrap_or_default()
        ));
    }
    emit_install_progress(&app_handle, "完成", 100);
    Ok(status_ready(
        "cached",
        venv_python,
        python_version,
        probe.version,
        install_dir,
    ))
}

#[tauri::command]
pub async fn markitdown_convert_file(
    input_path: String,
    output_path: String,
    options: Option<MarkitdownConvertOptions>,
) -> Result<MarkitdownConvertResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        convert_file_impl(input_path, output_path, options.unwrap_or_default())
    })
    .await
    .map_err(|e| format!("MarkItDown 转换任务执行失败: {}", e))?
}

#[tauri::command]
pub fn markitdown_list_plugins() -> Result<Vec<MarkitdownPluginInfo>, String> {
    let status = markitdown_check_runtime()?;
    let python = status
        .python_path
        .ok_or_else(|| "MarkItDown 运行时未就绪，请先安装或选择 Python 环境。".to_string())?;
    run_python_json::<Vec<MarkitdownPluginInfo>>(&python, MARKITDOWN_PLUGIN_LIST_SCRIPT, &[])
}

fn convert_file_impl(
    input_path: String,
    output_path: String,
    options: MarkitdownConvertOptions,
) -> Result<MarkitdownConvertResult, String> {
    let status = markitdown_check_runtime()?;
    let python = status
        .python_path
        .clone()
        .ok_or_else(|| "MarkItDown 运行时未就绪，请先安装或选择 Python 环境。".to_string())?;

    let input = PathBuf::from(input_path);
    if !input.is_file() {
        return Err(format!("输入文件不存在: {}", input.display()));
    }

    let output = PathBuf::from(output_path);
    ensure_markdown_extension(&output)?;
    ensure_not_same_file(&input, &output)?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {}", e))?;
    }

    validate_convert_options(&options)?;
    let input_arg = input.to_string_lossy().to_string();
    let output_arg = output.to_string_lossy().to_string();
    let options_json =
        serde_json::to_string(&options).map_err(|e| format!("序列化转换选项失败: {}", e))?;
    let convert = run_python_json::<ConvertProbe>(
        &python,
        MARKITDOWN_CONVERT_SCRIPT,
        &[
            input_arg.as_str(),
            output_arg.as_str(),
            options_json.as_str(),
        ],
    )
    .map_err(|e| format!("MarkItDown 转换失败: {}", e))?;

    if !output.is_file() {
        return Err(format!("MarkItDown 未生成输出文件: {}", output.display()));
    }

    let output_size = fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
    let preview = fs::read_to_string(&output)
        .unwrap_or_default()
        .chars()
        .take(8000)
        .collect::<String>();

    Ok(MarkitdownConvertResult {
        output_path: output.to_string_lossy().to_string(),
        output_size,
        title: convert.title,
        characters: convert.characters,
        preview,
        python_path: python,
        package_version: status.package_version.clone(),
        command_summary: format!(
            "MarkItDown {} · {} 字符",
            status
                .package_version
                .unwrap_or_else(|| "runtime".to_string()),
            convert.characters
        ),
    })
}

fn app_data_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(base).join(APP_DIR_NAME)
}

fn default_markitdown_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir().join(MARKITDOWN_RUNTIME_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("创建 MarkItDown 缓存目录失败: {}", e))?;
    Ok(dir)
}

fn python_config_file() -> Result<PathBuf, String> {
    let dir = app_data_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    Ok(dir.join(PYTHON_CONFIG_FILE))
}

fn status_ready(
    mode: &str,
    python_path: String,
    python_version: Option<String>,
    package_version: Option<String>,
    install_dir: PathBuf,
) -> MarkitdownRuntimeStatus {
    MarkitdownRuntimeStatus {
        ready: true,
        mode: mode.to_string(),
        python_path: Some(python_path),
        python_version,
        package_version: package_version.clone(),
        install_dir: install_dir.to_string_lossy().to_string(),
        message: format!(
            "MarkItDown 已就绪{}",
            package_version
                .as_deref()
                .map(|v| format!(": {}", v))
                .unwrap_or_default()
        ),
        docs_url: MARKITDOWN_DOCS_URL.to_string(),
    }
}

fn status_missing(
    mode: &str,
    python_path: Option<String>,
    python_version: Option<String>,
    package_version: Option<String>,
    install_dir: PathBuf,
    message: &str,
) -> MarkitdownRuntimeStatus {
    MarkitdownRuntimeStatus {
        ready: false,
        mode: mode.to_string(),
        python_path,
        python_version,
        package_version,
        install_dir: install_dir.to_string_lossy().to_string(),
        message: message.trim().to_string(),
        docs_url: MARKITDOWN_DOCS_URL.to_string(),
    }
}

fn cached_venv_python(install_dir: &Path) -> Option<PathBuf> {
    let venv = install_dir.join(MARKITDOWN_VENV_DIR);
    #[cfg(target_os = "windows")]
    {
        Some(venv.join("Scripts").join("python.exe"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Some(venv.join("bin").join("python"))
    }
}

fn normalize_python_input(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = PathBuf::from(trimmed);
    if path.is_dir() {
        for name in python_binary_candidates() {
            let candidate = path.join(name);
            if candidate.is_file()
                && command_works(candidate.to_string_lossy().as_ref(), "--version")
            {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        return None;
    }
    if command_works(trimmed, "--version") {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn resolve_python(provided: Option<&str>) -> Option<String> {
    if let Some(path) = provided.and_then(normalize_python_input) {
        return Some(path);
    }

    for candidate in ["python", "python3"] {
        if let Some(path) = probe_python_executable(candidate, &[]) {
            return Some(path);
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(path) = probe_python_executable("py", &["-3"]) {
            return Some(path);
        }
    }

    None
}

fn probe_python_executable(command: &str, fixed_args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(command);
    cmd.args(fixed_args)
        .arg("-c")
        .arg("import sys; print(sys.executable)");
    apply_no_window(&mut cmd);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() || !command_works(&path, "--version") {
        None
    } else {
        Some(path)
    }
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

fn python_version_error(version: Option<&str>) -> Option<String> {
    let version = version?;
    let number = version
        .split_whitespace()
        .find(|part| part.chars().next().is_some_and(|c| c.is_ascii_digit()))?;
    let mut parts = number.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next()?.parse::<u32>().ok()?;
    if major < MIN_PYTHON_MAJOR || (major == MIN_PYTHON_MAJOR && minor < MIN_PYTHON_MINOR) {
        Some(format!(
            "检测到 {}；MarkItDown 官方要求 Python {}.{}+，请安装新版 Python 后重试。",
            version, MIN_PYTHON_MAJOR, MIN_PYTHON_MINOR
        ))
    } else {
        None
    }
}

fn probe_markitdown_package(python: &str) -> Result<PackageProbe, String> {
    run_python_json::<PackageProbe>(python, MARKITDOWN_PROBE_SCRIPT, &[])
}

fn python_module_works(python: &str, module: &str) -> bool {
    let mut cmd = Command::new(python);
    cmd.args(["-m", module, "--version"]);
    apply_no_window(&mut cmd);
    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

fn run_python_json<T: for<'de> Deserialize<'de>>(
    python: &str,
    script: &str,
    args: &[&str],
) -> Result<T, String> {
    let mut cmd = Command::new(python);
    cmd.arg("-c").arg(script).args(args);
    apply_no_window(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("启动 Python 失败: {}", e))?;
    if !output.status.success() {
        let detail = command_output_detail(&output.stdout, &output.stderr);
        return Err(if detail.is_empty() {
            "Python 脚本执行失败，但没有返回详细错误。".to_string()
        } else {
            detail
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .ok_or_else(|| "Python 没有返回结果。".to_string())?;
    serde_json::from_str(line).map_err(|e| format!("解析 Python 返回结果失败: {}", e))
}

fn run_python_command(python: &str, args: &[&str]) -> Result<(), String> {
    let mut cmd = Command::new(python);
    cmd.args(args);
    apply_no_window(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("启动 Python 失败: {}", e))?;
    if output.status.success() {
        Ok(())
    } else {
        let detail = command_output_detail(&output.stdout, &output.stderr);
        Err(if detail.is_empty() {
            format!("命令执行失败: python {}", args.join(" "))
        } else {
            detail
        })
    }
}

fn validate_convert_options(options: &MarkitdownConvertOptions) -> Result<(), String> {
    if options.use_docintel.unwrap_or(false) && options.use_content_understanding.unwrap_or(false) {
        return Err(
            "Azure Document Intelligence 与 Content Understanding 只能选择一种。".to_string(),
        );
    }
    if options.use_docintel.unwrap_or(false)
        && clean_option(options.docintel_endpoint.as_deref()).is_none()
    {
        return Err("使用 Azure Document Intelligence 时必须填写 Endpoint。".to_string());
    }
    if options.use_content_understanding.unwrap_or(false)
        && clean_option(options.content_understanding_endpoint.as_deref()).is_none()
    {
        return Err("使用 Azure Content Understanding 时必须填写 Endpoint。".to_string());
    }
    if options.llm_enabled.unwrap_or(false) && clean_option(options.llm_model.as_deref()).is_none()
    {
        return Err("启用 LLM 图片描述时必须填写模型名称。".to_string());
    }
    if let Some(mime) = clean_option(options.mime_type_hint.as_deref()) {
        if mime.matches('/').count() != 1 {
            return Err("MIME 类型格式不正确，例如 application/pdf。".to_string());
        }
    }
    Ok(())
}

fn clean_option(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn command_output_detail(stdout: &[u8], stderr: &[u8]) -> String {
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(stdout).trim().to_string();
    if !stderr.is_empty() {
        stderr
    } else {
        stdout
    }
}

fn command_works(command: &str, arg: &str) -> bool {
    let mut cmd = Command::new(command);
    cmd.arg(arg);
    apply_no_window(&mut cmd);
    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

fn ensure_markdown_extension(path: &Path) -> Result<(), String> {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext == "md" || ext == "markdown" {
        Ok(())
    } else {
        Err("输出文件扩展名必须是 .md 或 .markdown。".to_string())
    }
}

fn ensure_not_same_file(input: &Path, output: &Path) -> Result<(), String> {
    if output.exists() {
        if let (Ok(input), Ok(output)) = (input.canonicalize(), output.canonicalize()) {
            if input == output {
                return Err("输出文件不能覆盖输入文件。".to_string());
            }
        }
    }
    Ok(())
}

fn python_binary_candidates() -> &'static [&'static str] {
    #[cfg(target_os = "windows")]
    {
        &["python.exe", "python3.exe", "python"]
    }
    #[cfg(not(target_os = "windows"))]
    {
        &["python3", "python"]
    }
}

fn emit_install_progress(app_handle: &tauri::AppHandle, message: &str, progress: u8) {
    let _ = app_handle.emit_all(
        "markitdown-install-progress",
        serde_json::json!({
            "message": message,
            "progress": progress
        }),
    );
}

fn apply_no_window(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

const MARKITDOWN_PROBE_SCRIPT: &str = r#"
import json
try:
    import importlib.metadata as metadata
    from markitdown import MarkItDown
    version = metadata.version("markitdown")
    print(json.dumps({"ok": True, "version": version}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False))
"#;

const MARKITDOWN_CONVERT_SCRIPT: &str = r#"
import json
import codecs
import pathlib
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]
options = json.loads(sys.argv[3])

def clean(value):
    if value is None:
        return None
    value = str(value).strip()
    return value or None

def normalize_extension(value):
    value = clean(value)
    if value and not value.startswith("."):
        return "." + value
    return value.lower() if value else None

def normalize_charset(value):
    value = clean(value)
    if not value:
        return None
    try:
        return codecs.lookup(value).name
    except LookupError:
        raise ValueError(f"Invalid charset: {value}")

try:
    from markitdown import MarkItDown, StreamInfo

    kwargs = {
        "enable_plugins": bool(options.get("enable_plugins")),
    }

    if options.get("use_docintel"):
        kwargs["docintel_endpoint"] = clean(options.get("docintel_endpoint"))

    if options.get("use_content_understanding"):
        kwargs["cu_endpoint"] = clean(options.get("content_understanding_endpoint"))
        analyzer = clean(options.get("content_understanding_analyzer"))
        if analyzer:
            kwargs["cu_analyzer_id"] = analyzer
        file_types = clean(options.get("content_understanding_file_types"))
        if file_types:
            from markitdown.converters import ContentUnderstandingFileType

            kwargs["cu_file_types"] = [
                ContentUnderstandingFileType(item.strip().lower())
                for item in file_types.split(",")
                if item.strip()
            ]

    if options.get("llm_enabled"):
        from openai import OpenAI

        client_kwargs = {}
        api_key = clean(options.get("llm_api_key"))
        base_url = clean(options.get("llm_base_url"))
        if api_key:
            client_kwargs["api_key"] = api_key
        if base_url:
            client_kwargs["base_url"] = base_url
        kwargs["llm_client"] = OpenAI(**client_kwargs)
        kwargs["llm_model"] = clean(options.get("llm_model"))
        prompt = clean(options.get("llm_prompt"))
        if prompt:
            kwargs["llm_prompt"] = prompt

    converter = MarkItDown(**kwargs)

    stream_info = None
    extension = normalize_extension(options.get("extension_hint"))
    mimetype = clean(options.get("mime_type_hint"))
    charset = normalize_charset(options.get("charset_hint"))
    if extension or mimetype or charset:
        stream_info = StreamInfo(extension=extension, mimetype=mimetype, charset=charset)

    try:
        result = converter.convert_local(
            input_path,
            stream_info=stream_info,
            keep_data_uris=bool(options.get("keep_data_uris")),
        )
    except AttributeError:
        result = converter.convert(
            input_path,
            stream_info=stream_info,
            keep_data_uris=bool(options.get("keep_data_uris")),
        )

    text = getattr(result, "markdown", None) or getattr(result, "text_content", None) or ""
    output = pathlib.Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(text, encoding="utf-8", newline="\n")
    print(json.dumps({
        "title": getattr(result, "title", None),
        "characters": len(text),
    }, ensure_ascii=False))
except Exception as exc:
    print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
    sys.exit(1)
"#;

const MARKITDOWN_PLUGIN_LIST_SCRIPT: &str = r#"
import json
from importlib.metadata import entry_points

plugins = [
    {"name": entry.name, "value": entry.value}
    for entry in entry_points(group="markitdown.plugin")
]
print(json.dumps(plugins, ensure_ascii=False))
"#;
