use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;
use tokio::io::AsyncWriteExt;
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipWriter};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const APP_DIR_NAME: &str = "McStartUP";
const PANDOC_CONFIG_FILE: &str = "pandoc_path.txt";
const PANDOC_RUNTIME_DIR: &str = "runtimes/pandoc";
const PANDOC_RELEASE_API: &str = "https://api.github.com/repos/jgm/pandoc/releases/latest";
const PANDOC_RELEASES_URL: &str = "https://github.com/jgm/pandoc/releases/latest";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocRuntimeStatus {
    pub ready: bool,
    pub mode: String,
    pub pandoc_path: Option<String>,
    pub install_dir: String,
    pub version: Option<String>,
    pub message: String,
    pub releases_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocConvertOptions {
    pub reference_docx: Option<String>,
    pub reference_docx_template: Option<String>,
    pub reference_pptx: Option<String>,
    pub extract_media: Option<bool>,
    pub metadata_title: Option<String>,
    pub metadata_author: Option<String>,
    pub epub_cover_image: Option<String>,
    pub epub_css: Option<String>,
    pub toc: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocConvertResult {
    pub output_path: String,
    pub media_dir: Option<String>,
    pub command_summary: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: Option<u64>,
}

#[tauri::command]
pub fn get_pandoc_dir() -> Result<String, String> {
    let dir = default_pandoc_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_custom_pandoc_path() -> Option<String> {
    let config_file = pandoc_config_file().ok()?;
    let path = fs::read_to_string(config_file).ok()?.trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

#[tauri::command]
pub fn set_pandoc_path(path: String) -> Result<PandocRuntimeStatus, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Pandoc 路径不能为空".to_string());
    }
    let config_file = pandoc_config_file()?;
    if let Some(parent) = config_file.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    fs::write(&config_file, path).map_err(|e| format!("保存 Pandoc 路径失败: {}", e))?;
    check_pandoc_runtime()
}

#[tauri::command]
pub fn clear_pandoc_path() -> Result<PandocRuntimeStatus, String> {
    if let Ok(config_file) = pandoc_config_file() {
        let _ = fs::remove_file(config_file);
    }
    check_pandoc_runtime()
}

#[tauri::command]
pub fn check_pandoc_runtime() -> Result<PandocRuntimeStatus, String> {
    let install_dir = default_pandoc_dir()?;

    if let Some(custom_path) = get_custom_pandoc_path() {
        let path = PathBuf::from(custom_path.trim());
        if let Some(binary) = find_pandoc_executable(&path) {
            if let Some(version) = pandoc_version(&binary) {
                return Ok(status_ready("custom", binary, install_dir, version));
            }
        }
        return Ok(status_missing(
            "invalid",
            install_dir,
            "已配置的 Pandoc 路径不可用，请重新选择 pandoc.exe 或安装目录。",
        ));
    }

    if let Some(binary) = find_pandoc_executable(&install_dir) {
        if let Some(version) = pandoc_version(&binary) {
            return Ok(status_ready("cached", binary, install_dir, version));
        }
    }

    if let Some(binary) = find_pandoc_in_path() {
        if let Some(version) = pandoc_version(&binary) {
            return Ok(status_ready("system", binary, install_dir, version));
        }
    }

    Ok(status_missing(
        "missing",
        install_dir,
        "未检测到 Pandoc。可直接下载到本地缓存，或选择已安装的 Pandoc。",
    ))
}

#[tauri::command]
pub async fn download_pandoc(
    app_handle: tauri::AppHandle,
    install_dir: Option<String>,
    overwrite: Option<bool>,
) -> Result<PandocRuntimeStatus, String> {
    let install_dir = match install_dir
        .map(|value| value.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        Some(path) => PathBuf::from(path),
        None => default_pandoc_dir()?,
    };
    let overwrite = overwrite.unwrap_or(false);

    if !overwrite {
        if let Some(binary) = find_pandoc_executable(&install_dir) {
            if let Some(version) = pandoc_version(&binary) {
                return Ok(status_ready("cached", binary, install_dir, version));
            }
        }
    }

    tokio::fs::create_dir_all(&install_dir)
        .await
        .map_err(|e| format!("创建 Pandoc 安装目录失败: {}", e))?;

    emit_pandoc_progress(&app_handle, "查询 Pandoc 最新版本", 0, 1, false);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .user_agent("McStartUP Pandoc runtime downloader")
        .build()
        .map_err(|e| e.to_string())?;

    let release = client
        .get(PANDOC_RELEASE_API)
        .send()
        .await
        .map_err(|e| format!("查询 Pandoc 最新版本失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("查询 Pandoc 最新版本失败: {}", e))?
        .json::<GithubRelease>()
        .await
        .map_err(|e| format!("解析 Pandoc 最新版本失败: {}", e))?;

    let asset = select_pandoc_asset(&release).cloned().ok_or_else(|| {
        format!(
            "没有找到适合当前系统的 Pandoc 压缩包，请访问 {} 手动下载。",
            PANDOC_RELEASES_URL
        )
    })?;
    emit_pandoc_progress(&app_handle, "查询 Pandoc 最新版本", 1, 1, true);

    let archive_path = install_dir.join(&asset.name);
    let tmp_path = install_dir.join(format!("{}.download", asset.name));
    if tokio::fs::try_exists(&tmp_path)
        .await
        .map_err(|e| e.to_string())?
    {
        let _ = tokio::fs::remove_file(&tmp_path).await;
    }

    let resp = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(|e| format!("下载 Pandoc 失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("下载 Pandoc 失败: {}", e))?;

    let total = resp.content_length().or(asset.size).unwrap_or(0);
    let mut loaded = 0u64;
    let mut stream = resp.bytes_stream();
    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("创建 Pandoc 临时文件失败: {}", e))?;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入 Pandoc 下载文件失败: {}", e))?;
        loaded += chunk.len() as u64;
        emit_pandoc_progress(&app_handle, &asset.name, loaded, total, false);
    }
    file.flush()
        .await
        .map_err(|e| format!("保存 Pandoc 下载文件失败: {}", e))?;
    drop(file);

    if tokio::fs::try_exists(&archive_path)
        .await
        .map_err(|e| e.to_string())?
    {
        tokio::fs::remove_file(&archive_path)
            .await
            .map_err(|e| format!("覆盖旧 Pandoc 压缩包失败: {}", e))?;
    }
    tokio::fs::rename(&tmp_path, &archive_path)
        .await
        .map_err(|e| format!("写入 Pandoc 压缩包失败: {}", e))?;
    emit_pandoc_progress(&app_handle, &asset.name, loaded, total, true);

    emit_pandoc_progress(&app_handle, "解压 Pandoc", 0, 1, false);
    let archive_for_extract = archive_path.clone();
    let install_for_extract = install_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        extract_zip_archive(&archive_for_extract, &install_for_extract)
    })
    .await
    .map_err(|e| format!("解压任务执行失败: {}", e))??;
    emit_pandoc_progress(&app_handle, "解压 Pandoc", 1, 1, true);

    if let Some(binary) = find_pandoc_executable(&install_dir) {
        if let Some(version) = pandoc_version(&binary) {
            return Ok(status_ready("cached", binary, install_dir, version));
        }
    }

    Err("Pandoc 已下载但未找到可执行文件，请检查压缩包内容。".to_string())
}

#[tauri::command]
pub async fn pandoc_convert_document(
    input_path: String,
    output_path: String,
    direction: String,
    options: Option<PandocConvertOptions>,
) -> Result<PandocConvertResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        convert_document_impl(
            input_path,
            output_path,
            direction,
            options.unwrap_or(PandocConvertOptions {
                reference_docx: None,
                reference_docx_template: None,
                reference_pptx: None,
                extract_media: None,
                metadata_title: None,
                metadata_author: None,
                epub_cover_image: None,
                epub_css: None,
                toc: None,
            }),
        )
    })
    .await
    .map_err(|e| format!("文档转换任务执行失败: {}", e))?
}

fn convert_document_impl(
    input_path: String,
    output_path: String,
    direction: String,
    options: PandocConvertOptions,
) -> Result<PandocConvertResult, String> {
    let status = check_pandoc_runtime()?;
    let pandoc = status
        .pandoc_path
        .ok_or_else(|| "Pandoc 未就绪，请先下载或选择已安装的 Pandoc。".to_string())?;

    let input = PathBuf::from(input_path);
    if !input.is_file() {
        return Err(format!("输入文件不存在: {}", input.display()));
    }
    if is_doc_file(&input) {
        return Err("当前功能不支持 .doc 老格式，请使用 .docx 或 Markdown 文件。".to_string());
    }

    let output = PathBuf::from(output_path);
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {}", e))?;
    }

    let direction = direction.trim();
    let mut args: Vec<String> = Vec::new();
    let mut media_dir = None;

    match direction {
        "mdToDocx" => {
            ensure_extension(&input, &["md", "markdown"], "请选择 Markdown 文件。")?;
            args.push("--from".to_string());
            args.push("gfm".to_string());
            args.push("--to".to_string());
            args.push("docx".to_string());
            let reference = resolve_reference_docx(&options)?;
            if let Some(reference) = reference {
                args.push(format!("--reference-doc={}", reference.to_string_lossy()));
            }
        }
        "docxToMd" => {
            ensure_extension(&input, &["docx"], "请选择 .docx Word 文件。")?;
            args.push("--from".to_string());
            args.push("docx".to_string());
            args.push("--to".to_string());
            args.push("gfm".to_string());
            args.push("--wrap=none".to_string());
            if options.extract_media.unwrap_or(true) {
                let dir = default_media_dir(&output);
                fs::create_dir_all(&dir).map_err(|e| format!("创建图片目录失败: {}", e))?;
                args.push(format!("--extract-media={}", dir.to_string_lossy()));
                media_dir = Some(dir.to_string_lossy().to_string());
            }
        }
        "mdToPptx" => {
            ensure_extension(&input, &["md", "markdown"], "请选择 Markdown 文件。")?;
            args.push("--from".to_string());
            args.push("gfm".to_string());
            args.push("--to".to_string());
            args.push("pptx".to_string());
            if let Some(reference_pptx) = options
                .reference_pptx
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
            {
                let reference = PathBuf::from(&reference_pptx);
                ensure_extension(&reference, &["pptx"], "PPT 样式模板必须是 .pptx 文件。")?;
                if !reference.is_file() {
                    return Err(format!("PPT 样式模板不存在: {}", reference.display()));
                }
                args.push(format!("--reference-doc={}", reference.to_string_lossy()));
            }
        }
        "toEpub" => {
            ensure_extension(
                &input,
                &["md", "markdown", "docx", "html", "htm", "txt"],
                "请选择 Markdown、DOCX、HTML 或 TXT 文件。",
            )?;
            let from = match input
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or("")
                .to_ascii_lowercase()
                .as_str()
            {
                "docx" => "docx",
                "html" | "htm" => "html",
                "txt" => "markdown",
                _ => "gfm",
            };
            args.push("--from".to_string());
            args.push(from.to_string());
            args.push("--to".to_string());
            args.push("epub".to_string());
            if options.toc.unwrap_or(true) {
                args.push("--toc".to_string());
            }
            push_metadata(&mut args, "title", options.metadata_title.as_deref());
            push_metadata(&mut args, "author", options.metadata_author.as_deref());
            if let Some(cover) = options
                .epub_cover_image
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
            {
                let cover_path = PathBuf::from(&cover);
                ensure_extension(
                    &cover_path,
                    &["png", "jpg", "jpeg"],
                    "封面图片必须是 PNG 或 JPG。",
                )?;
                if !cover_path.is_file() {
                    return Err(format!("封面图片不存在: {}", cover_path.display()));
                }
                args.push(format!(
                    "--epub-cover-image={}",
                    cover_path.to_string_lossy()
                ));
            }
            if let Some(css) = options
                .epub_css
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
            {
                let css_path = PathBuf::from(&css);
                ensure_extension(&css_path, &["css"], "EPUB 样式文件必须是 .css 文件。")?;
                if !css_path.is_file() {
                    return Err(format!("EPUB 样式文件不存在: {}", css_path.display()));
                }
                args.push(format!("--css={}", css_path.to_string_lossy()));
            }
        }
        _ => return Err("不支持的转换方向。".to_string()),
    }

    args.push(input.to_string_lossy().to_string());
    args.push("-o".to_string());
    args.push(output.to_string_lossy().to_string());

    let mut command = Command::new(&pandoc);
    command.args(&args);
    if let Some(parent) = input.parent() {
        command.current_dir(parent);
    }
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let output_result = command
        .output()
        .map_err(|e| format!("启动 Pandoc 失败: {}", e))?;
    if !output_result.status.success() {
        let stderr = String::from_utf8_lossy(&output_result.stderr)
            .trim()
            .to_string();
        let stdout = String::from_utf8_lossy(&output_result.stdout)
            .trim()
            .to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if detail.is_empty() {
            "Pandoc 转换失败，但没有返回详细错误。".to_string()
        } else {
            format!("Pandoc 转换失败: {}", detail)
        });
    }

    if !output.is_file() {
        return Err(format!("Pandoc 未生成输出文件: {}", output.display()));
    }

    Ok(PandocConvertResult {
        output_path: output.to_string_lossy().to_string(),
        media_dir,
        command_summary: format!(
            "{} · {}",
            status.version.unwrap_or_else(|| "Pandoc".to_string()),
            direction
        ),
    })
}

fn status_ready(
    mode: &str,
    binary: PathBuf,
    install_dir: PathBuf,
    version: String,
) -> PandocRuntimeStatus {
    PandocRuntimeStatus {
        ready: true,
        mode: mode.to_string(),
        pandoc_path: Some(binary.to_string_lossy().to_string()),
        install_dir: install_dir.to_string_lossy().to_string(),
        version: Some(version.clone()),
        message: format!("Pandoc 已就绪: {}", version),
        releases_url: PANDOC_RELEASES_URL.to_string(),
    }
}

fn status_missing(mode: &str, install_dir: PathBuf, message: &str) -> PandocRuntimeStatus {
    PandocRuntimeStatus {
        ready: false,
        mode: mode.to_string(),
        pandoc_path: None,
        install_dir: install_dir.to_string_lossy().to_string(),
        version: None,
        message: message.to_string(),
        releases_url: PANDOC_RELEASES_URL.to_string(),
    }
}

fn app_data_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(base).join(APP_DIR_NAME)
}

fn default_pandoc_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir().join(PANDOC_RUNTIME_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("创建 Pandoc 缓存目录失败: {}", e))?;
    Ok(dir)
}

fn pandoc_config_file() -> Result<PathBuf, String> {
    let dir = app_data_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    Ok(dir.join(PANDOC_CONFIG_FILE))
}

fn select_pandoc_asset(release: &GithubRelease) -> Option<&GithubAsset> {
    release.assets.iter().find(|asset| {
        let name = asset.name.to_ascii_lowercase();
        if !name.ends_with(".zip") {
            return false;
        }
        #[cfg(target_os = "windows")]
        {
            name.contains("windows") && (name.contains("x86_64") || name.contains("amd64"))
        }
        #[cfg(target_os = "macos")]
        {
            name.contains("macos") || name.contains("darwin")
        }
        #[cfg(target_os = "linux")]
        {
            name.contains("linux") && (name.contains("amd64") || name.contains("x86_64"))
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            false
        }
    })
}

fn find_pandoc_executable(path: &Path) -> Option<PathBuf> {
    if path.is_file() && looks_like_pandoc(path) && pandoc_version(path).is_some() {
        return Some(path.to_path_buf());
    }
    if !path.is_dir() {
        return None;
    }

    for candidate in direct_pandoc_candidates(path) {
        if candidate.is_file() && pandoc_version(&candidate).is_some() {
            return Some(candidate);
        }
    }

    find_file_named(path, pandoc_binary_name(), 4).and_then(|candidate| {
        if pandoc_version(&candidate).is_some() {
            Some(candidate)
        } else {
            None
        }
    })
}

fn direct_pandoc_candidates(root: &Path) -> Vec<PathBuf> {
    vec![
        root.join(pandoc_binary_name()),
        root.join("bin").join(pandoc_binary_name()),
    ]
}

fn find_pandoc_in_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("where.exe");
        cmd.arg("pandoc.exe");
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                for line in stdout.lines() {
                    let candidate = PathBuf::from(line.trim());
                    if candidate.is_file() && pandoc_version(&candidate).is_some() {
                        return Some(candidate);
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("which");
        cmd.arg("pandoc");
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                for line in stdout.lines() {
                    let candidate = PathBuf::from(line.trim());
                    if candidate.is_file() && pandoc_version(&candidate).is_some() {
                        return Some(candidate);
                    }
                }
            }
        }
    }

    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).find_map(|dir| {
            let candidate = dir.join(pandoc_binary_name());
            if candidate.is_file() && pandoc_version(&candidate).is_some() {
                Some(candidate)
            } else {
                None
            }
        })
    })
}

fn pandoc_version(binary: &Path) -> Option<String> {
    let mut cmd = Command::new(binary);
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

fn looks_like_pandoc(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| {
            name.eq_ignore_ascii_case(pandoc_binary_name()) || name.eq_ignore_ascii_case("pandoc")
        })
        .unwrap_or(false)
}

fn pandoc_binary_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "pandoc.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "pandoc"
    }
}

fn find_file_named(root: &Path, filename: &str, max_depth: usize) -> Option<PathBuf> {
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let entries = fs::read_dir(&dir).ok()?;
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.eq_ignore_ascii_case(filename))
                    .unwrap_or(false)
            {
                return Some(path);
            }
            if path.is_dir() && depth < max_depth {
                stack.push((path, depth + 1));
            }
        }
    }
    None
}

fn extract_zip_archive(archive_path: &Path, output_dir: &Path) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|e| format!("打开 Pandoc 压缩包失败: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("读取 Pandoc 压缩包失败: {}", e))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("读取压缩包条目失败: {}", e))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| format!("压缩包包含不安全路径: {}", entry.name()))?
            .to_owned();
        let out_path = output_dir.join(enclosed);

        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| format!("创建目录失败: {}", e))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
        let mut outfile = File::create(&out_path).map_err(|e| format!("创建文件失败: {}", e))?;
        io::copy(&mut entry, &mut outfile).map_err(|e| format!("解压文件失败: {}", e))?;
        mark_executable_if_needed(&out_path)?;
    }

    Ok(())
}

fn mark_executable_if_needed(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name == "pandoc")
            .unwrap_or(false)
        {
            let mut perms = fs::metadata(path)
                .map_err(|e| format!("读取权限失败: {}", e))?
                .permissions();
            perms.set_mode(perms.mode() | 0o755);
            fs::set_permissions(path, perms).map_err(|e| format!("设置执行权限失败: {}", e))?;
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn emit_pandoc_progress(
    app_handle: &tauri::AppHandle,
    file: &str,
    loaded: u64,
    total: u64,
    done: bool,
) {
    let _ = app_handle.emit_all(
        "pandoc-download-progress",
        serde_json::json!({
            "file": file,
            "loaded": loaded,
            "total": total,
            "done": done
        }),
    );
}

fn ensure_extension(path: &Path, allowed: &[&str], message: &str) -> Result<(), String> {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if allowed.iter().any(|item| *item == ext) {
        Ok(())
    } else {
        Err(message.to_string())
    }
}

fn push_metadata(args: &mut Vec<String>, key: &str, value: Option<&str>) {
    if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
        args.push("-M".to_string());
        args.push(format!("{}={}", key, value));
    }
}

fn resolve_reference_docx(options: &PandocConvertOptions) -> Result<Option<PathBuf>, String> {
    if let Some(reference_docx) = options
        .reference_docx
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let reference = PathBuf::from(reference_docx);
        ensure_extension(&reference, &["docx"], "样式模板必须是 .docx 文件。")?;
        if !reference.is_file() {
            return Err(format!("样式模板不存在: {}", reference.display()));
        }
        return Ok(Some(reference));
    }

    let Some(template_id) = options
        .reference_docx_template
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "none")
    else {
        return Ok(None);
    };

    let profile = BuiltinDocxTemplate::from_id(template_id)?;
    let template_dir = app_data_dir()
        .join("templates")
        .join("pandoc-reference-docx");
    fs::create_dir_all(&template_dir).map_err(|e| format!("创建内置模板目录失败: {}", e))?;
    let template_path = template_dir.join(format!("{}.docx", profile.id));
    write_builtin_reference_docx(&template_path, profile)?;
    Ok(Some(template_path))
}

#[derive(Debug, Clone, Copy)]
struct BuiltinDocxTemplate {
    id: &'static str,
    title: &'static str,
    body_font: &'static str,
    east_asia_font: &'static str,
    heading_font: &'static str,
    accent: &'static str,
    body_size: u32,
    line: u32,
    after: u32,
    page_margin: u32,
}

impl BuiltinDocxTemplate {
    fn from_id(id: &str) -> Result<Self, String> {
        match id {
            "general-report" => Ok(Self {
                id: "general-report",
                title: "通用报告模板",
                body_font: "Microsoft YaHei",
                east_asia_font: "Microsoft YaHei",
                heading_font: "Microsoft YaHei",
                accent: "2563eb",
                body_size: 22,
                line: 360,
                after: 160,
                page_margin: 1440,
            }),
            "business-proposal" => Ok(Self {
                id: "business-proposal",
                title: "商务方案模板",
                body_font: "Microsoft YaHei",
                east_asia_font: "Microsoft YaHei",
                heading_font: "Microsoft YaHei",
                accent: "0f766e",
                body_size: 22,
                line: 360,
                after: 180,
                page_margin: 1260,
            }),
            "tech-doc" => Ok(Self {
                id: "tech-doc",
                title: "技术文档模板",
                body_font: "Microsoft YaHei",
                east_asia_font: "Microsoft YaHei",
                heading_font: "Microsoft YaHei",
                accent: "334155",
                body_size: 21,
                line: 330,
                after: 120,
                page_margin: 1260,
            }),
            "official-simple" => Ok(Self {
                id: "official-simple",
                title: "公文简洁模板",
                body_font: "SimSun",
                east_asia_font: "SimSun",
                heading_font: "SimHei",
                accent: "111827",
                body_size: 24,
                line: 420,
                after: 120,
                page_margin: 1600,
            }),
            _ => Err("未知的内置 Word 模板。".to_string()),
        }
    }
}

fn write_builtin_reference_docx(path: &Path, profile: BuiltinDocxTemplate) -> Result<(), String> {
    let file = File::create(path).map_err(|e| format!("创建内置 Word 模板失败: {}", e))?;
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
        document_xml(profile),
        options,
    )?;
    write_zip_file(&mut zip, "word/styles.xml", styles_xml(profile), options)?;
    write_zip_file(&mut zip, "word/settings.xml", settings_xml(), options)?;
    write_zip_file(
        &mut zip,
        "word/_rels/document.xml.rels",
        document_rels_xml(),
        options,
    )?;
    write_zip_file(
        &mut zip,
        "docProps/core.xml",
        core_props_xml(profile),
        options,
    )?;
    write_zip_file(&mut zip, "docProps/app.xml", app_props_xml(), options)?;
    zip.finish()
        .map_err(|e| format!("保存内置 Word 模板失败: {}", e))?;
    Ok(())
}

fn write_zip_file(
    zip: &mut ZipWriter<File>,
    name: &str,
    content: String,
    options: FileOptions,
) -> Result<(), String> {
    zip.start_file(name, options)
        .map_err(|e| format!("写入模板条目失败: {}", e))?;
    use std::io::Write as _;
    zip.write_all(content.as_bytes())
        .map_err(|e| format!("写入模板内容失败: {}", e))
}

fn content_types_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
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
</Relationships>"#
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

fn core_props_xml(profile: BuiltinDocxTemplate) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>{}</dc:title>
  <dc:creator>McStartUP</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-05-08T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-05-08T00:00:00Z</dcterms:modified>
</cp:coreProperties>"#,
        profile.title
    )
}

fn document_xml(profile: BuiltinDocxTemplate) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Title"/></w:pPr>
      <w:r><w:t>{}</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Subtitle"/></w:pPr>
      <w:r><w:t>Markdown 转 Word 样式模板</w:t></w:r>
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="{m}" w:right="{m}" w:bottom="{m}" w:left="{m}" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>"#,
        profile.title,
        m = profile.page_margin
    )
}

fn styles_xml(profile: BuiltinDocxTemplate) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="{body}" w:hAnsi="{body}" w:eastAsia="{east}"/>
        <w:sz w:val="{body_size}"/>
        <w:szCs w:val="{body_size}"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="{after}" w:line="{line}" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="{after}" w:line="{line}" w:lineRule="auto"/></w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="{body}" w:hAnsi="{body}" w:eastAsia="{east}"/>
      <w:sz w:val="{body_size}"/>
      <w:szCs w:val="{body_size}"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="240" w:after="240"/><w:jc w:val="center"/></w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="{heading}" w:hAnsi="{heading}" w:eastAsia="{heading}"/>
      <w:b/><w:color w:val="{accent}"/><w:sz w:val="36"/><w:szCs w:val="36"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr>
    <w:rPr><w:color w:val="64748b"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="{heading}" w:hAnsi="{heading}" w:eastAsia="{heading}"/><w:b/><w:color w:val="{accent}"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="280" w:after="140"/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="{heading}" w:hAnsi="{heading}" w:eastAsia="{heading}"/><w:b/><w:color w:val="{accent}"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="220" w:after="100"/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="{heading}" w:hAnsi="{heading}" w:eastAsia="{heading}"/><w:b/><w:color w:val="334155"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="BlockText">
    <w:name w:val="Block Text"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="360"/><w:spacing w:before="120" w:after="120"/></w:pPr>
    <w:rPr><w:color w:val="475569"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="SourceCode">
    <w:name w:val="Source Code"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="100" w:after="100"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="Hyperlink">
    <w:name w:val="Hyperlink"/>
    <w:rPr><w:color w:val="{accent}"/><w:u w:val="single"/></w:rPr>
  </w:style>
</w:styles>"#,
        body = profile.body_font,
        east = profile.east_asia_font,
        heading = profile.heading_font,
        body_size = profile.body_size,
        after = profile.after,
        line = profile.line,
        accent = profile.accent
    )
}

fn is_doc_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("doc"))
        .unwrap_or(false)
}

fn default_media_dir(output: &Path) -> PathBuf {
    let stem = output
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("media");
    output
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("{}_media", stem))
}
