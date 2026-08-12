use anyhow::{Context, Result};
use serde::Serialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use winreg::enums::*;
use winreg::RegKey;

const DESKTOP_BOX_CLSID: &str = "{B9E1F7D5-6D89-4A1A-9E8B-6E4D3D03D5F4}";
const DESKTOP_BOX_CLSID_KEY: &str =
    "Software\\Classes\\CLSID\\{B9E1F7D5-6D89-4A1A-9E8B-6E4D3D03D5F4}";
const DESKTOP_BOX_HANDLER_KEY: &str =
    "Software\\Classes\\Directory\\Background\\ShellEx\\ContextMenuHandlers\\McStartUPDesktopBox";
const LEGACY_DESKTOP_BOX_HANDLER_KEY: &str =
    "Software\\Classes\\DesktopBackground\\ShellEx\\ContextMenuHandlers\\McStartUPDesktopBox";

pub struct ContextMenuManager;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuStatus {
    pub installed: bool,
    pub desktop_box_installed: bool,
    pub registry_path: String,
    pub command: Option<String>,
    pub desktop_box_command: Option<String>,
    pub missing: Vec<String>,
}

impl ContextMenuManager {
    /// 注册右键菜单
    pub fn register() -> Result<ContextMenuStatus> {
        let hkcr = RegKey::predef(HKEY_CURRENT_USER);

        // 获取当前可执行文件路径
        let exe_path = env::current_exe()
            .context("Failed to get current exe path")?
            .to_string_lossy()
            .to_string();

        // 先清理旧版只写入 exefile 的菜单，避免重复显示。
        let _ = hkcr.delete_subkey_all("Software\\Classes\\exefile\\shell\\McStartUP");

        write_add_menu(
            &hkcr,
            "Software\\Classes\\*\\shell\\McStartUP",
            &exe_path,
            "%1",
        )?;
        write_add_menu(
            &hkcr,
            "Software\\Classes\\Directory\\shell\\McStartUP",
            &exe_path,
            "%1",
        )?;
        register_desktop_box_shell_extension(&hkcr, &exe_path)?;

        notify_shell_assoc_changed();
        Self::status()
    }

    /// Register only the desktop Box menu. This menu is intentionally
    /// independent from the file/folder context-menu preference.
    pub fn register_desktop_box() -> Result<ContextMenuStatus> {
        let hkcr = RegKey::predef(HKEY_CURRENT_USER);
        let exe_path = env::current_exe()
            .context("Failed to get current exe path")?
            .to_string_lossy()
            .to_string();
        register_desktop_box_shell_extension(&hkcr, &exe_path)?;
        notify_shell_assoc_changed();
        Self::status()
    }

    /// 取消注册右键菜单
    pub fn unregister() -> Result<ContextMenuStatus> {
        let hkcr = RegKey::predef(HKEY_CURRENT_USER);

        // 删除注册表项
        let _ = hkcr.delete_subkey_all("Software\\Classes\\exefile\\shell\\McStartUP");
        let _ = hkcr.delete_subkey_all("Software\\Classes\\*\\shell\\McStartUP");
        let _ = hkcr.delete_subkey_all("Software\\Classes\\Directory\\shell\\McStartUP");
        // The desktop Box menu is a separate integration and must remain
        // available even when file/folder context actions are disabled.
        let exe_path = env::current_exe()
            .context("Failed to get current exe path")?
            .to_string_lossy()
            .to_string();
        register_desktop_box_shell_extension(&hkcr, &exe_path)?;

        notify_shell_assoc_changed();
        Self::status()
    }

    pub fn status() -> Result<ContextMenuStatus> {
        let hkcr = RegKey::predef(HKEY_CURRENT_USER);
        let registry_path = format!(
            "HKCU\\Software\\Classes\\*\\shell\\McStartUP；HKCU\\Software\\Classes\\Directory\\shell\\McStartUP；HKCU\\{}；HKCU\\{}",
            DESKTOP_BOX_CLSID_KEY, DESKTOP_BOX_HANDLER_KEY
        );
        let mut missing = Vec::new();

        let generic_required = [
            "Software\\Classes\\*\\shell\\McStartUP\\command",
            "Software\\Classes\\Directory\\shell\\McStartUP\\command",
        ];
        let desktop_box_server = format!("{}\\InprocServer32", DESKTOP_BOX_CLSID_KEY);
        let mut commands = Vec::new();
        for path in generic_required {
            match hkcr.open_subkey_with_flags(path, KEY_READ) {
                Ok(key) => {
                    if let Ok(command) = key.get_value::<String, _>("") {
                        commands.push(command);
                    } else {
                        missing.push(format!("HKCU\\{}", path));
                    }
                }
                Err(_) => missing.push(format!("HKCU\\{}", path)),
            }
        }
        let generic_installed = commands.len() == generic_required.len()
            && commands.iter().all(|value| value.contains("--add"));
        let registered_clsid = hkcr
            .open_subkey_with_flags(DESKTOP_BOX_HANDLER_KEY, KEY_READ)
            .and_then(|key| key.get_value::<String, _>(""))
            .unwrap_or_default();
        let registered_dll = hkcr
            .open_subkey_with_flags(&desktop_box_server, KEY_READ)
            .and_then(|key| key.get_value::<String, _>(""))
            .unwrap_or_default();
        let registered_exe = hkcr
            .open_subkey_with_flags(DESKTOP_BOX_CLSID_KEY, KEY_READ)
            .and_then(|key| key.get_value::<String, _>("McStartUPPath"))
            .unwrap_or_default();
        let dll_exists = Path::new(&registered_dll).is_file();
        let desktop_box_installed = registered_clsid.eq_ignore_ascii_case(DESKTOP_BOX_CLSID)
            && !registered_exe.is_empty()
            && Path::new(&registered_exe).is_file()
            && dll_exists;
        if !desktop_box_installed {
            missing.push(format!("HKCU\\{}\\InprocServer32", DESKTOP_BOX_CLSID_KEY));
            missing.push(format!("HKCU\\{}", DESKTOP_BOX_HANDLER_KEY));
        }

        Ok(ContextMenuStatus {
            installed: generic_installed,
            desktop_box_installed,
            registry_path,
            command: commands.first().cloned(),
            desktop_box_command: if registered_exe.is_empty() {
                None
            } else {
                Some(format!("\"{}\" --desktop-box-new", registered_exe))
            },
            missing,
        })
    }
}

fn write_add_menu(root: &RegKey, path: &str, exe_path: &str, placeholder: &str) -> Result<()> {
    let key = root
        .create_subkey(path)
        .with_context(|| format!("Failed to create registry key: {}", path))?
        .0;
    key.set_value("", &"添加到 McStartUP")?;
    key.set_value("MUIVerb", &"添加到 McStartUP")?;
    key.set_value("Icon", &exe_path)?;
    let command = key.create_subkey("command")?.0;
    command.set_value("", &format!("\"{}\" --add \"{}\"", exe_path, placeholder))?;
    Ok(())
}

fn register_desktop_box_shell_extension(root: &RegKey, exe_path: &str) -> Result<()> {
    // Remove older registry-only cascade variants. Windows and third-party
    // desktop managers may rebuild the Explorer HMENU, so a static
    // DesktopBackground\Shell cascade is not a reliable submenu mechanism.
    let _ =
        root.delete_subkey_all("Software\\Classes\\DesktopBackground\\Shell\\McStartUPDesktopBox");
    let _ = root.delete_subkey_all(LEGACY_DESKTOP_BOX_HANDLER_KEY);

    let dll_path = desktop_box_dll_path(exe_path).ok_or_else(|| {
        anyhow::anyhow!("McStartUP desktop Box shell extension DLL was not found")
    })?;
    let clsid = root.create_subkey(DESKTOP_BOX_CLSID_KEY)?.0;
    clsid.set_value("", &"McStartUP Desktop Box Shell Extension")?;
    clsid.set_value("McStartUPPath", &exe_path)?;
    let server = clsid.create_subkey("InprocServer32")?.0;
    server.set_value("", &dll_path.to_string_lossy().to_string())?;
    server.set_value("ThreadingModel", &"Apartment")?;

    let handler = root.create_subkey(DESKTOP_BOX_HANDLER_KEY)?.0;
    handler.set_value("", &DESKTOP_BOX_CLSID)?;
    Ok(())
}

fn desktop_box_dll_path(exe_path: &str) -> Option<PathBuf> {
    let exe = Path::new(exe_path);
    let exe_dir = exe.parent()?;
    let resource_dirs = [
        exe_dir.to_path_buf(),
        exe_dir.join("resources"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"),
    ];
    let mut candidates: Vec<(SystemTime, u8, PathBuf)> = Vec::new();

    for directory in resource_dirs {
        for file_name in ["McStartUPDesktopBox.dll", "mcstartup_desktop_box.dll"] {
            let priority = if directory == exe_dir { 1 } else { 0 };
            add_dll_candidate(&mut candidates, directory.join(file_name), priority);
        }
        if let Ok(entries) = fs::read_dir(&directory) {
            for entry in entries.flatten() {
                let path = entry.path();
                let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                    continue;
                };
                if name.starts_with("McStartUPDesktopBox.")
                    && name.to_ascii_lowercase().ends_with(".dll")
                {
                    add_dll_candidate(&mut candidates, path, 2);
                }
            }
        }
    }

    // Development builds publish a side-by-side DLL beside the executable.
    // Prefer files whose parent is exactly the executable directory. Do not
    // select target/debug/resources here: Tauri copies bundled resources into
    // that directory and Explorer may keep an older copy loaded while Cargo
    // is rebuilding the app.
    if candidates
        .iter()
        .any(|(_, _, path)| path.parent() == Some(exe_dir))
    {
        candidates.retain(|(_, _, path)| path.parent() == Some(exe_dir));
    }

    // A locked DLL cannot be replaced while Explorer has it loaded. The
    // build script publishes a timestamped side-by-side copy in that case;
    // selecting the newest file makes the next registration pick it up.
    candidates.sort_by(
        |(left_time, left_priority, left_path), (right_time, right_priority, right_path)| {
            right_time
                .cmp(left_time)
                .then_with(|| right_priority.cmp(left_priority))
                .then_with(|| right_path.cmp(left_path))
        },
    );
    candidates.into_iter().next().map(|(_, _, path)| path)
}

fn add_dll_candidate(candidates: &mut Vec<(SystemTime, u8, PathBuf)>, path: PathBuf, priority: u8) {
    if !path.is_file() {
        return;
    }
    let modified = fs::metadata(&path)
        .and_then(|metadata| metadata.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    candidates.push((modified, priority, path));
}

#[cfg(target_os = "windows")]
fn notify_shell_assoc_changed() {
    use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
    }
}

#[cfg(not(target_os = "windows"))]
fn notify_shell_assoc_changed() {}
