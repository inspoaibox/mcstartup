use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveRuntimeStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub bundled: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePathInfo {
    pub path: String,
    pub name: String,
    pub parent: String,
    pub stem: String,
    pub extension: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveOperationResult {
    pub output_path: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveListEntry {
    pub path: String,
    pub size: Option<u64>,
    pub packed_size: Option<u64>,
    pub modified: Option<String>,
    pub attributes: Option<String>,
    pub encrypted: bool,
    pub is_dir: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveCompressRequest {
    pub sources: Vec<String>,
    pub output_path: String,
    pub format: String,
    pub level: Option<u8>,
    pub password: Option<String>,
    pub encrypt_headers: Option<bool>,
    pub split_size: Option<String>,
    pub overwrite: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveExtractRequest {
    pub archive_path: String,
    pub output_dir: String,
    pub password: Option<String>,
    pub overwrite: Option<bool>,
    pub selected_paths: Option<Vec<String>>,
}

#[tauri::command]
pub fn archive_runtime_status() -> ArchiveRuntimeStatus {
    let Some(path) = find_7zip_binary() else {
        return ArchiveRuntimeStatus {
            installed: false,
            version: None,
            path: None,
            bundled: false,
            message: "未找到内置 7-Zip 运行时，请确认 src-tauri/resources/7zip/7z.exe 和 7z.dll 已随应用打包。".to_string(),
        };
    };

    let version = seven_zip_version(&path);
    ArchiveRuntimeStatus {
        installed: true,
        version,
        bundled: is_bundled_7zip_path(&path),
        path: Some(path.to_string_lossy().to_string()),
        message: "内置 7-Zip 引擎已就绪，支持压缩、解压和密码。".to_string(),
    }
}

#[tauri::command]
pub fn archive_inspect_paths(paths: Vec<String>) -> Result<Vec<ArchivePathInfo>, String> {
    let mut items = Vec::new();
    for path in paths {
        let path = absolute_path(Path::new(&path))?;
        if !path.exists() {
            continue;
        }
        items.push(path_info(&path)?);
    }
    Ok(items)
}

#[tauri::command]
pub fn archive_suggest_output_path(paths: Vec<String>, format: String) -> Result<String, String> {
    let ext = normalize_archive_format(&format)?;
    let first = paths
        .first()
        .ok_or_else(|| "请先添加文件或文件夹".to_string())?;
    let first = absolute_path(Path::new(first))?;
    let parent = first
        .parent()
        .ok_or_else(|| "无法识别输出目录".to_string())?;
    let base_name = if paths.len() == 1 {
        first
            .file_stem()
            .or_else(|| first.file_name())
            .and_then(|value| value.to_str())
            .unwrap_or("archive")
            .to_string()
    } else {
        "archive".to_string()
    };
    Ok(
        unique_path(parent.join(format!("{}.{}", sanitize_file_name(&base_name), ext)))
            .to_string_lossy()
            .to_string(),
    )
}

#[tauri::command]
pub fn archive_default_extract_dir(archive_path: String) -> Result<String, String> {
    let archive = absolute_path(Path::new(&archive_path))?;
    let parent = archive
        .parent()
        .ok_or_else(|| "无法识别压缩包所在目录".to_string())?;
    let stem = archive
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("extracted");
    Ok(parent
        .join(sanitize_file_name(stem))
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub fn archive_list(
    archive_path: String,
    password: Option<String>,
) -> Result<Vec<ArchiveListEntry>, String> {
    let seven_zip = find_7zip_binary().ok_or_else(|| "未找到内置 7-Zip 运行时".to_string())?;
    let archive = absolute_path(Path::new(&archive_path))?;
    if !archive.is_file() {
        return Err("请选择有效压缩包".to_string());
    }

    let mut args = vec!["l".to_string(), "-slt".to_string(), "-ba".to_string()];
    if let Some(password) = password.filter(|value| !value.is_empty()) {
        args.push(format!("-p{}", password));
    }
    args.push(archive.to_string_lossy().to_string());
    let output = run_7zip_capture(&seven_zip, &args, archive.parent())?;
    Ok(parse_7zip_list(&output))
}

#[tauri::command]
pub fn archive_compress(request: ArchiveCompressRequest) -> Result<ArchiveOperationResult, String> {
    let seven_zip = find_7zip_binary().ok_or_else(|| "未找到内置 7-Zip 运行时".to_string())?;
    if request.sources.is_empty() {
        return Err("请先添加需要压缩的文件或文件夹".to_string());
    }
    let format = normalize_archive_format(&request.format)?;
    let output = absolute_path(Path::new(&request.output_path))?;
    if output.exists() && !request.overwrite.unwrap_or(false) {
        return Err(format!("输出文件已存在: {}", output.display()));
    }
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {}", e))?;
    }

    let mut sources = Vec::new();
    for source in &request.sources {
        let source = absolute_path(Path::new(source))?;
        if !source.exists() {
            return Err(format!("源路径不存在: {}", source.display()));
        }
        sources.push(source);
    }

    let work_dir = common_parent(&sources)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let mut args = vec![
        "a".to_string(),
        "-y".to_string(),
        format!("-t{}", format),
        format!("-mx={}", request.level.unwrap_or(5).min(9)),
        output.to_string_lossy().to_string(),
    ];
    if let Some(password) = request.password.filter(|value| !value.is_empty()) {
        args.push(format!("-p{}", password));
        if request.encrypt_headers.unwrap_or(format == "7z") && format == "7z" {
            args.push("-mhe=on".to_string());
        }
    }
    if let Some(split) = request
        .split_size
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        args.push(format!("-v{}", split));
    }
    for source in &sources {
        args.push(path_arg_for_work_dir(source, &work_dir));
    }

    run_7zip_status(&seven_zip, &args, Some(&work_dir), "压缩失败")?;
    Ok(ArchiveOperationResult {
        output_path: output.to_string_lossy().to_string(),
        message: "压缩完成".to_string(),
    })
}

#[tauri::command]
pub fn archive_extract(request: ArchiveExtractRequest) -> Result<ArchiveOperationResult, String> {
    let seven_zip = find_7zip_binary().ok_or_else(|| "未找到内置 7-Zip 运行时".to_string())?;
    let archive = absolute_path(Path::new(&request.archive_path))?;
    if !archive.is_file() {
        return Err("请选择有效压缩包".to_string());
    }
    let output_dir = absolute_path(Path::new(&request.output_dir))?;
    std::fs::create_dir_all(&output_dir).map_err(|e| format!("创建解压目录失败: {}", e))?;

    let entries = archive_list(
        archive.to_string_lossy().to_string(),
        request.password.clone(),
    )?;
    validate_archive_entries(&entries)?;

    let mut args = vec![
        "x".to_string(),
        if request.overwrite.unwrap_or(false) {
            "-aoa"
        } else {
            "-aou"
        }
        .to_string(),
        archive.to_string_lossy().to_string(),
        format!("-o{}", output_dir.to_string_lossy()),
    ];
    if let Some(password) = request.password.filter(|value| !value.is_empty()) {
        args.push(format!("-p{}", password));
    }
    for item in request.selected_paths.unwrap_or_default() {
        let item = item.trim();
        if !item.is_empty() {
            args.push(item.to_string());
        }
    }

    run_7zip_status(&seven_zip, &args, archive.parent(), "解压失败")?;
    Ok(ArchiveOperationResult {
        output_path: output_dir.to_string_lossy().to_string(),
        message: "解压完成".to_string(),
    })
}

fn find_7zip_binary() -> Option<PathBuf> {
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
    for candidate in candidates {
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn is_bundled_7zip_path(path: &Path) -> bool {
    path.to_string_lossy()
        .to_ascii_lowercase()
        .contains(r"resources\7zip")
}

fn seven_zip_version(path: &Path) -> Option<String> {
    let output = run_7zip_raw(path, &["i".to_string()], None).ok()?;
    output
        .lines()
        .find(|line| line.contains("7-Zip"))
        .map(|line| line.trim().to_string())
}

fn run_7zip_capture(
    binary: &Path,
    args: &[String],
    work_dir: Option<&Path>,
) -> Result<String, String> {
    run_7zip_raw(binary, args, work_dir)
}

fn run_7zip_status(
    binary: &Path,
    args: &[String],
    work_dir: Option<&Path>,
    prefix: &str,
) -> Result<(), String> {
    let output = run_7zip_output(binary, args, work_dir)?;
    if output.status.success() {
        return Ok(());
    }
    Err(format!(
        "{}: {}",
        prefix,
        combined_output(&output)
            .lines()
            .rev()
            .take(8)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" ")
    ))
}

fn run_7zip_raw(binary: &Path, args: &[String], work_dir: Option<&Path>) -> Result<String, String> {
    let output = run_7zip_output(binary, args, work_dir)?;
    if !output.status.success() {
        return Err(combined_output(&output));
    }
    Ok(combined_output(&output))
}

fn run_7zip_output(
    binary: &Path,
    args: &[String],
    work_dir: Option<&Path>,
) -> Result<std::process::Output, String> {
    let mut command = Command::new(binary);
    command.args(args);
    if let Some(work_dir) = work_dir {
        command.current_dir(work_dir);
    }
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command
        .output()
        .map_err(|e| format!("启动 7-Zip 失败: {}", e))
}

fn combined_output(output: &std::process::Output) -> String {
    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    if !output.stderr.is_empty() {
        if !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    text
}

fn normalize_archive_format(value: &str) -> Result<String, String> {
    match value
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .as_str()
    {
        "7z" => Ok("7z".to_string()),
        "zip" => Ok("zip".to_string()),
        "tar" => Ok("tar".to_string()),
        "wim" => Ok("wim".to_string()),
        _ => Err("暂不支持该压缩格式".to_string()),
    }
}

fn parse_7zip_list(output: &str) -> Vec<ArchiveListEntry> {
    let mut rows = Vec::new();
    let mut current = std::collections::HashMap::<String, String>::new();
    for line in output.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            push_list_entry(&mut rows, &mut current);
            continue;
        }
        if let Some((key, value)) = line.split_once(" = ") {
            current.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    push_list_entry(&mut rows, &mut current);
    rows
}

fn push_list_entry(
    rows: &mut Vec<ArchiveListEntry>,
    current: &mut std::collections::HashMap<String, String>,
) {
    let Some(path) = current.remove("Path") else {
        current.clear();
        return;
    };
    if path.is_empty() {
        current.clear();
        return;
    }
    let attributes = current.remove("Attributes");
    let is_dir = attributes
        .as_deref()
        .map(|value| value.contains('D'))
        .unwrap_or(false);
    let encrypted = current
        .remove("Encrypted")
        .map(|value| value.eq_ignore_ascii_case("+") || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    rows.push(ArchiveListEntry {
        path,
        size: current.remove("Size").and_then(|value| value.parse().ok()),
        packed_size: current
            .remove("Packed Size")
            .and_then(|value| value.parse().ok()),
        modified: current.remove("Modified"),
        attributes,
        encrypted,
        is_dir,
    });
    current.clear();
}

fn validate_archive_entries(entries: &[ArchiveListEntry]) -> Result<(), String> {
    for entry in entries {
        let normalized = entry.path.replace('\\', "/");
        if normalized.starts_with('/')
            || normalized.contains("../")
            || normalized == ".."
            || normalized.contains("..\\")
        {
            return Err(format!("压缩包包含不安全路径，已阻止解压: {}", entry.path));
        }
        if Path::new(&entry.path).is_absolute() {
            return Err(format!("压缩包包含绝对路径，已阻止解压: {}", entry.path));
        }
    }
    Ok(())
}

fn path_info(path: &Path) -> Result<ArchivePathInfo, String> {
    let metadata = std::fs::metadata(path).map_err(|e| format!("读取路径信息失败: {}", e))?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();
    let parent = path
        .parent()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let stem = if metadata.is_dir() {
        name.clone()
    } else {
        path.file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(&name)
            .to_string()
    };
    let extension = if metadata.is_dir() {
        String::new()
    } else {
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_string()
    };
    Ok(ArchivePathInfo {
        path: path.to_string_lossy().to_string(),
        name,
        parent,
        stem,
        extension,
        is_dir: metadata.is_dir(),
        size: if metadata.is_file() {
            metadata.len()
        } else {
            0
        },
    })
}

fn absolute_path(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        std::env::current_dir()
            .map(|dir| dir.join(path))
            .map_err(|e| format!("解析路径失败: {}", e))
    }
}

fn common_parent(paths: &[PathBuf]) -> Option<PathBuf> {
    if paths.is_empty() {
        return None;
    }
    if paths.len() == 1 {
        return paths[0].parent().map(Path::to_path_buf);
    }
    let mut parent = paths[0].parent()?.to_path_buf();
    while !paths.iter().all(|path| path.starts_with(&parent)) {
        parent = parent.parent()?.to_path_buf();
    }
    Some(parent)
}

fn path_arg_for_work_dir(path: &Path, work_dir: &Path) -> String {
    path.strip_prefix(work_dir)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string()
}

fn sanitize_file_name(value: &str) -> String {
    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let cleaned = value
        .chars()
        .map(|ch| {
            if invalid.contains(&ch) || ch.is_control() {
                '_'
            } else {
                ch
            }
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();
    if cleaned.is_empty() {
        "archive".to_string()
    } else {
        cleaned
    }
}

fn unique_path(path: PathBuf) -> PathBuf {
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
        .unwrap_or("archive");
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value))
        .unwrap_or_default();
    for index in 1..1000 {
        let candidate = parent.join(format!("{} ({}){}", stem, index, ext));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{}-{}{}", stem, uuid::Uuid::new_v4().simple(), ext))
}
