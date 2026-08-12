use crate::models::{LaunchItem, LaunchProfile};
use anyhow::{Context, Result};
use std::os::windows::process::CommandExt;
use std::process::Command;
use winreg;

const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 使用指定的 profile 启动项目（覆盖默认参数和工作目录）
pub fn launch_item_with_profile(item: &LaunchItem, profile: Option<&LaunchProfile>) -> Result<()> {
    // 如果有 profile，用 profile 的参数覆盖默认值
    let arguments = profile
        .and_then(|p| p.arguments.as_deref())
        .or(item.arguments.as_deref());
    let working_dir = profile
        .and_then(|p| p.working_dir.as_deref())
        .or(item.working_dir.as_deref());

    launch_item_inner(item, arguments, working_dir)
}

pub fn launch_item(item: &LaunchItem) -> Result<()> {
    launch_item_inner(item, item.arguments.as_deref(), item.working_dir.as_deref())
}

/// 简单的 shell 风格参数分割：支持双引号保护含空格参数
/// 例：`--foo "bar baz" --baz` → `["--foo", "bar baz", "--baz"]`
fn split_args(args: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for ch in args.chars() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
            }
            ' ' if !in_quotes => {
                if !current.is_empty() {
                    result.push(current.clone());
                    current.clear();
                }
            }
            _ => {
                current.push(ch);
            }
        }
    }
    if !current.is_empty() {
        result.push(current);
    }
    result
}

fn launch_item_inner(
    item: &LaunchItem,
    arguments: Option<&str>,
    working_dir: Option<&str>,
) -> Result<()> {
    let item_type = item.item_type.as_deref().unwrap_or("app");

    if item_type == "url" {
        let url = item.target_path.trim();
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err(anyhow::anyhow!(
                "不支持的 URL 协议: {}\n仅支持 http:// 和 https://",
                url
            ));
        }
        Command::new("explorer")
            .arg(url)
            .spawn()
            .with_context(|| format!("无法打开网址: {}", item.target_path))?;
        return Ok(());
    }

    if item_type == "folder" {
        Command::new("explorer")
            .arg(&item.target_path)
            .spawn()
            .with_context(|| format!("无法打开文件夹: {}", item.target_path))?;
        return Ok(());
    }

    if item_type == "script" {
        return launch_script(item, arguments, working_dir);
    }

    // 应用程序类型
    let path = std::path::Path::new(&item.target_path);
    let is_full_path = path.is_absolute();

    if is_full_path && !path.exists() {
        return Err(anyhow::anyhow!(
            "程序不存在: {}\n请检查路径是否正确",
            item.target_path
        ));
    }

    let result = if item.run_as_admin {
        let mut c = Command::new("powershell");
        c.creation_flags(CREATE_NO_WINDOW);
        c.arg("-NoProfile");
        c.arg("-WindowStyle");
        c.arg("Hidden");
        c.arg("-Command");

        let escaped_path = item.target_path.replace('\'', "''");
        let mut ps_cmd = format!("Start-Process -FilePath '{}' -Verb RunAs", escaped_path);

        if let Some(args) = arguments {
            let trimmed = args.trim();
            if !trimmed.is_empty() {
                ps_cmd.push_str(&format!(" -ArgumentList '{}'", trimmed.replace('\'', "''")));
            }
        }

        if let Some(wd) = working_dir {
            let trimmed = wd.trim();
            if !trimmed.is_empty() {
                ps_cmd.push_str(&format!(
                    " -WorkingDirectory '{}'",
                    trimmed.replace('\'', "''")
                ));
            }
        }

        c.arg(ps_cmd);
        c.spawn()
    } else {
        let mut c = Command::new("cmd");
        c.creation_flags(CREATE_NO_WINDOW);
        c.arg("/c");
        c.arg("start");
        c.arg("");

        if let Some(wd) = working_dir {
            let trimmed = wd.trim();
            if !trimmed.is_empty() {
                c.arg("/d");
                c.arg(trimmed);
            }
        }

        c.arg(&item.target_path);

        if let Some(args) = arguments {
            let trimmed = args.trim();
            if !trimmed.is_empty() {
                for arg in split_args(trimmed) {
                    c.arg(arg);
                }
            }
        }

        c.spawn()
    };

    result.with_context(|| format!("无法启动程序: {}", item.target_path))?;
    Ok(())
}

/// 执行脚本文件（.cmd/.bat/.ps1/.ahk）
fn launch_script(
    item: &LaunchItem,
    arguments: Option<&str>,
    working_dir: Option<&str>,
) -> Result<()> {
    // 如果有脚本内容，创建临时文件执行
    if let Some(content) = &item.script_content {
        return launch_script_content(item, content, arguments, working_dir);
    }

    // 否则执行脚本文件
    let path = std::path::Path::new(&item.target_path);

    if !path.exists() {
        return Err(anyhow::anyhow!(
            "脚本文件不存在: {}\n请检查路径是否正确",
            item.target_path
        ));
    }

    let ext = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();

    // 是否显示窗口（默认显示，方便查看输出）
    let show_window = item.script_show_window.unwrap_or(true);
    let creation_flags = if show_window { 0u32 } else { CREATE_NO_WINDOW };

    let wd = working_dir
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            // 默认工作目录为脚本所在目录
            path.parent().map(|p| p.to_string_lossy().to_string())
        });

    let extra_args: Vec<String> = arguments
        .map(|a| a.trim())
        .filter(|a| !a.is_empty())
        .map(|a| split_args(a))
        .unwrap_or_default();

    let result = match ext.as_str() {
        "cmd" | "bat" => {
            if item.run_as_admin {
                // 管理员模式：用 PowerShell Start-Process 提权
                let mut c = Command::new("powershell");
                c.creation_flags(CREATE_NO_WINDOW);
                c.arg("-NoProfile");
                c.arg("-WindowStyle");
                c.arg("Hidden");
                c.arg("-Command");
                let escaped = item.target_path.replace('\'', "''");
                let mut ps_cmd = format!(
                    "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c \"{}\"' -Verb RunAs",
                    escaped
                );
                if let Some(wd_str) = &wd {
                    ps_cmd.push_str(&format!(
                        " -WorkingDirectory '{}'",
                        wd_str.replace('\'', "''")
                    ));
                }
                c.arg(ps_cmd);
                c.spawn()
            } else {
                let mut c = Command::new("cmd");
                c.creation_flags(creation_flags);
                c.arg("/c");
                c.arg(&item.target_path);
                for arg in &extra_args {
                    c.arg(arg);
                }
                if let Some(wd_str) = &wd {
                    c.current_dir(wd_str);
                }
                c.spawn()
            }
        }
        "ps1" => {
            let mut c = Command::new("powershell");
            c.creation_flags(creation_flags);
            c.arg("-NoProfile");
            c.arg("-ExecutionPolicy");
            c.arg("Bypass");
            if item.run_as_admin {
                // 管理员模式
                c.arg("-Command");
                let escaped = item.target_path.replace('\'', "''");
                let mut ps_cmd = format!(
                    "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"{}\"' -Verb RunAs",
                    escaped
                );
                if let Some(wd_str) = &wd {
                    ps_cmd.push_str(&format!(
                        " -WorkingDirectory '{}'",
                        wd_str.replace('\'', "''")
                    ));
                }
                c.arg(ps_cmd);
            } else {
                c.arg("-File");
                c.arg(&item.target_path);
                for arg in &extra_args {
                    c.arg(arg);
                }
                if let Some(wd_str) = &wd {
                    c.current_dir(wd_str);
                }
            }
            c.spawn()
        }
        "ahk" => {
            // AutoHotkey：查找 AutoHotkey.exe
            let ahk_exe = find_autohotkey();
            match ahk_exe {
                Some(ahk_path) => {
                    let mut c = Command::new(&ahk_path);
                    c.creation_flags(creation_flags);
                    c.arg(&item.target_path);
                    for arg in &extra_args {
                        c.arg(arg);
                    }
                    if let Some(wd_str) = &wd {
                        c.current_dir(wd_str);
                    }
                    c.spawn()
                }
                None => {
                    return Err(anyhow::anyhow!(
                        "未找到 AutoHotkey，请先安装 AutoHotkey（https://www.autohotkey.com）"
                    ));
                }
            }
        }
        _ => {
            return Err(anyhow::anyhow!(
                "不支持的脚本类型: .{}\n支持：.cmd、.bat、.ps1、.ahk",
                ext
            ));
        }
    };

    result.with_context(|| format!("无法执行脚本: {}", item.target_path))?;
    Ok(())
}

/// 查找 AutoHotkey 可执行文件路径
fn find_autohotkey() -> Option<String> {
    // 常见安装路径
    let candidates = [
        "C:\\Program Files\\AutoHotkey\\AutoHotkey.exe",
        "C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey.exe",
        "C:\\Program Files (x86)\\AutoHotkey\\AutoHotkey.exe",
        "C:\\Program Files\\AutoHotkey\\AutoHotkey64.exe",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    // 从注册表查找
    if let Ok(hklm) = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
        .open_subkey("SOFTWARE\\AutoHotkey")
    {
        if let Ok(install_dir) = hklm.get_value::<String, _>("InstallDir") {
            let exe = std::path::PathBuf::from(&install_dir).join("AutoHotkey.exe");
            if exe.exists() {
                return Some(exe.to_string_lossy().to_string());
            }
        }
    }
    None
}

/// 执行脚本内容（创建临时文件）
fn launch_script_content(
    item: &LaunchItem,
    content: &str,
    arguments: Option<&str>,
    working_dir: Option<&str>,
) -> Result<()> {
    // 确定脚本类型
    let script_type = item.script_type.as_deref().unwrap_or("bat");
    let ext = match script_type {
        "ps1" => "ps1",
        "ahk" => "ahk",
        _ => "bat",
    };

    // 创建临时目录
    let temp_dir = std::env::temp_dir().join("McStartUP");
    std::fs::create_dir_all(&temp_dir)?;

    // 生成临时文件名（使用 script_id 保证不受包含非法字符的 alias 影响）
    let temp_file = temp_dir.join(format!("script_{}.{}", item.id, ext));

    // 写入脚本内容
    std::fs::write(&temp_file, content)?;

    // 创建一个临时 item 来执行
    let mut temp_item = item.clone();
    temp_item.target_path = temp_file.to_string_lossy().to_string();
    temp_item.script_content = None; // 避免递归

    // 执行脚本
    // 注意：不删除临时文件，因为脚本可能还在执行
    // 临时文件会在系统清理临时目录时自动删除
    launch_script(&temp_item, arguments, working_dir)
}
