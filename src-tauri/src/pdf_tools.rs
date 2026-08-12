use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize, Deserialize)]
pub struct GsStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PdfConvertResult {
    pub page: u32,
    pub output_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PdfCompressResult {
    pub output_path: String,
    pub output_size: u64,
}

/// 查找 Ghostscript 可执行文件
pub fn find_gs_binary() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        // 1. PATH 中查找
        let mut cmd = Command::new("where");
        cmd.arg("gswin64c").creation_flags(CREATE_NO_WINDOW);
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout);
                if let Some(p) = s.lines().next().map(|l| l.trim().to_string()) {
                    if !p.is_empty() {
                        return Some(p);
                    }
                }
            }
        }
        // gswin32c fallback
        let mut cmd2 = Command::new("where");
        cmd2.arg("gswin32c").creation_flags(CREATE_NO_WINDOW);
        if let Ok(out) = cmd2.output() {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout);
                if let Some(p) = s.lines().next().map(|l| l.trim().to_string()) {
                    if !p.is_empty() {
                        return Some(p);
                    }
                }
            }
        }

        // 2. 常见安装路径
        let program_files =
            std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
        let program_files_x86 = std::env::var("ProgramFiles(x86)")
            .unwrap_or_else(|_| "C:\\Program Files (x86)".to_string());

        for base in &[&program_files, &program_files_x86] {
            let gs_dir = Path::new(base).join("gs");
            if let Ok(entries) = std::fs::read_dir(&gs_dir) {
                for entry in entries.flatten() {
                    for bin in &["gswin64c.exe", "gswin32c.exe"] {
                        let candidate = entry.path().join("bin").join(bin);
                        if candidate.exists() {
                            return Some(candidate.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }

        // 3. winget 安装路径
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let winget_base = Path::new(&local)
                .join("Microsoft")
                .join("WinGet")
                .join("Packages");
            if let Ok(entries) = std::fs::read_dir(&winget_base) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_lowercase();
                    if name.contains("ghostscript") || name.contains("artifex") {
                        for sub in std::fs::read_dir(entry.path())
                            .into_iter()
                            .flatten()
                            .flatten()
                        {
                            for bin in &["gswin64c.exe", "gswin32c.exe"] {
                                let c = sub.path().join("bin").join(bin);
                                if c.exists() {
                                    return Some(c.to_string_lossy().to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("which");
        cmd.arg("gs");
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout);
                if let Some(p) = s.lines().next().map(|l| l.trim().to_string()) {
                    if !p.is_empty() {
                        return Some(p);
                    }
                }
            }
        }
        for p in &["/usr/bin/gs", "/usr/local/bin/gs", "/opt/homebrew/bin/gs"] {
            if Path::new(p).exists() {
                return Some(p.to_string());
            }
        }
    }

    None
}

/// 检测 Ghostscript 是否已安装
#[tauri::command]
pub fn check_ghostscript() -> GsStatus {
    let gs_path = match find_gs_binary() {
        Some(p) => p,
        None => {
            return GsStatus {
                installed: false,
                version: None,
                path: None,
            }
        }
    };

    let mut cmd = Command::new(&gs_path);
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.output() {
        Ok(out) => {
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            GsStatus {
                installed: true,
                version: Some(version),
                path: Some(gs_path),
            }
        }
        Err(_) => GsStatus {
            installed: false,
            version: None,
            path: None,
        },
    }
}

/// PDF 压缩（使用 Ghostscript）
#[tauri::command]
pub fn compress_pdf_gs(input_path: String, preset: String) -> Result<PdfCompressResult, String> {
    let gs = find_gs_binary().ok_or("未找到 Ghostscript，请先安装")?;
    let input = Path::new(&input_path);
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let dir = input.parent().and_then(|p| p.to_str()).unwrap_or(".");
    let output_path = PathBuf::from(dir).join(format!("{}_compressed.pdf", stem));
    let output_str = output_path.to_string_lossy().to_string();

    let dpi_setting = match preset.as_str() {
        "screen" => "/screen",
        "ebook" => "/ebook",
        "printer" => "/printer",
        "prepress" => "/prepress",
        _ => "/ebook",
    };

    let mut cmd = Command::new(&gs);
    cmd.args([
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        &format!("-dPDFSETTINGS={}", dpi_setting),
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        &format!("-sOutputFile={}", output_str),
        &input_path,
    ]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = cmd
        .output()
        .map_err(|e| format!("启动 Ghostscript 失败: {}", e))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "压缩失败: {}",
            err.lines().last().unwrap_or("未知错误")
        ));
    }

    let output_size = std::fs::metadata(&output_path)
        .map(|m| m.len())
        .unwrap_or(0);
    Ok(PdfCompressResult {
        output_path: output_str,
        output_size,
    })
}

/// PDF 转图片（使用 Ghostscript）
#[tauri::command]
pub fn pdf_to_images_gs(
    input_path: String,
    format: String,
    dpi: u32,
) -> Result<Vec<PdfConvertResult>, String> {
    let gs = find_gs_binary().ok_or("未找到 Ghostscript，请先安装")?;
    let input = Path::new(&input_path);
    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("page");
    let dir = input.parent().and_then(|p| p.to_str()).unwrap_or(".");

    let device = match format.as_str() {
        "jpg" | "jpeg" => "jpeg",
        _ => "png16m",
    };
    let ext = match format.as_str() {
        "jpg" | "jpeg" => "jpg",
        _ => "png",
    };

    let output_pattern = PathBuf::from(dir).join(format!("{}_page%04d.{}", stem, ext));
    let output_str = output_pattern.to_string_lossy().to_string();

    let mut cmd = Command::new(&gs);
    cmd.args([
        &format!("-sDEVICE={}", device),
        &format!("-r{}", dpi),
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        &format!("-sOutputFile={}", output_str),
        &input_path,
    ]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = cmd
        .output()
        .map_err(|e| format!("启动 Ghostscript 失败: {}", e))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "转换失败: {}",
            err.lines().last().unwrap_or("未知错误")
        ));
    }

    // 收集生成的文件
    let mut results: Vec<PdfConvertResult> = Vec::new();
    let mut page = 1u32;
    loop {
        let path = PathBuf::from(dir).join(format!("{}_page{:04}.{}", stem, page, ext));
        if !path.exists() {
            break;
        }
        results.push(PdfConvertResult {
            page,
            output_path: path.to_string_lossy().to_string(),
        });
        page += 1;
    }

    Ok(results)
}
