use anyhow::{Context, Result};
use encoding_rs::GBK;
use std::fs;
use std::path::PathBuf;
use winreg::enums::*;
use winreg::RegKey;

pub struct RegistryManager {
    batch_dir: PathBuf,
}

impl RegistryManager {
    pub fn new() -> Result<Self> {
        let app_data = std::env::var("APPDATA").context("Failed to get APPDATA")?;
        let batch_dir = PathBuf::from(app_data).join("McStartUP").join("launchers");
        fs::create_dir_all(&batch_dir)?;

        Ok(Self { batch_dir })
    }

    /// 内部实现：注册别名但不广播（用于批量操作）
    fn register_alias_internal(
        &self,
        alias: &str,
        target_path: &str,
        arguments: Option<&str>,
        item_type: &str,
    ) -> Result<()> {
        use winreg::RegKey;

        // 先清理可能存在的旧文件，避免冲突
        for ext in &["cmd", "vbs", "ps1", "bat", "url", "lnk"] {
            let file = self.batch_dir.join(format!("{}.{}", alias, ext));
            if file.exists() {
                let _ = fs::remove_file(&file);
            }
        }

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        // 在 App Paths 注册表中创建键
        let app_paths_key = format!(
            "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{}.exe",
            alias
        );

        let (key, _) = hkcu.create_subkey(&app_paths_key)?;
        key.set_value("McStartUP.Managed", &1u32)?;
        key.set_value("McStartUP.Type", &item_type)?;
        key.set_value("McStartUP.Target", &target_path)?;
        key.set_value("McStartUP.Arguments", &arguments.unwrap_or(""))?;

        // 根据类型创建不同的启动方式
        match item_type {
            "url" => {
                // URL 类型：创建 Windows Internet Shortcut (.url 文件)
                let url_file = self.batch_dir.join(format!("{}.url", alias));
                let url_content = format!("[InternetShortcut]\r\nURL={}\r\n", target_path);
                fs::write(&url_file, url_content.as_bytes())?;
                key.set_value("", &url_file.to_string_lossy().to_string())?;
            }
            "folder" => {
                // 文件夹类型：写一个 VBS 文件
                let vbs_file = self.batch_dir.join(format!("{}.vbs", alias));
                let escaped = target_path.replace("\"", "\"\"");
                let vbs_content = format!(
                    "CreateObject(\"WScript.Shell\").Run \"explorer.exe \"\"{}\"\"\", 1, False\r\n",
                    escaped
                );
                fs::write(&vbs_file, vbs_content.as_bytes())?;
                key.set_value("", &vbs_file.to_string_lossy().to_string())?;
            }
            _ => {
                // 应用程序类型（默认）
                key.set_value("", &target_path)?;

                if let Some(parent) = std::path::Path::new(target_path).parent() {
                    key.set_value("Path", &parent.to_string_lossy().to_string())?;
                }

                // 如果有参数，用 VBS 包装避免弹窗
                if let Some(args) = arguments {
                    if !args.trim().is_empty() {
                        let vbs_file = self.batch_dir.join(format!("{}.vbs", alias));
                        let escaped_path = target_path.replace("\"", "\"\"");
                        let escaped_args = args.trim().replace("\"", "\"\"");
                        let vbs_content = format!(
                            "CreateObject(\"WScript.Shell\").Run \"\"\"{}\"\" {}\", 1, False\r\n",
                            escaped_path, escaped_args
                        );
                        fs::write(&vbs_file, &vbs_content)?;

                        let cmd_file = self.batch_dir.join(format!("{}.cmd", alias));
                        let cmd_content = format!(
                            "@start /b wscript.exe //nologo \"{}\" & exit\r\n",
                            vbs_file.to_string_lossy()
                        );
                        let (encoded, _, _) = GBK.encode(&cmd_content);
                        fs::write(&cmd_file, &*encoded)?;

                        key.set_value("", &cmd_file.to_string_lossy().to_string())?;
                    }
                }
            }
        }

        Ok(())
    }

    /// 公开接口：注册别名并广播（单个操作使用）
    pub fn register_alias(
        &self,
        alias: &str,
        target_path: &str,
        arguments: Option<&str>,
        item_type: &str,
    ) -> Result<()> {
        self.register_alias_internal(alias, target_path, arguments, item_type)?;
        // 单个保存不应被系统广播拖住，刷新放到后台执行。
        Self::broadcast_app_paths_change_async();
        Ok(())
    }

    /// 批量注册别名（不广播，需要手动调用 broadcast_app_paths_change）
    pub fn register_alias_batch(
        &self,
        alias: &str,
        target_path: &str,
        arguments: Option<&str>,
        item_type: &str,
    ) -> Result<()> {
        self.register_alias_internal(alias, target_path, arguments, item_type)
    }

    /// Remove an alias by deleting its App Paths registry entry
    pub fn unregister_alias(&self, alias: &str) -> Result<()> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        let app_paths_key = format!(
            "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{}.exe",
            alias
        );

        // 删除注册表键
        let _ = hkcu.delete_subkey_all(&app_paths_key);

        // 删除可能存在的各类启动文件
        for ext in &["cmd", "vbs", "ps1", "bat", "url", "lnk"] {
            let file = self.batch_dir.join(format!("{}.{}", alias, ext));
            if file.exists() {
                let _ = fs::remove_file(&file);
            }
        }
        // 删除 startup 包装 VBS
        let startup_vbs = self.batch_dir.join(format!("{}_startup.vbs", alias));
        if startup_vbs.exists() {
            let _ = fs::remove_file(&startup_vbs);
        }

        Ok(())
    }

    /// Add the batch directory to user PATH environment variable
    fn add_to_path(&self) -> Result<()> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let env = hkcu.open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)?;

        let current_path: String = env.get_value("Path").unwrap_or_default();
        let batch_dir_str = self.batch_dir.to_string_lossy().to_string();

        // 按分号分割后精确去重，避免重复追加
        let mut parts: Vec<&str> = current_path.split(';').filter(|s| !s.is_empty()).collect();
        if parts.iter().any(|p| p.eq_ignore_ascii_case(&batch_dir_str)) {
            return Ok(());
        }

        parts.push(&batch_dir_str);
        let new_path = parts.join(";");
        env.set_value("Path", &new_path)?;
        self.broadcast_environment_change();

        Ok(())
    }

    /// 确保 PATH 已添加（公开方法，供启动时调用）
    pub fn ensure_path_added(&self) -> Result<()> {
        self.add_to_path()
    }

    /// Manage startup registry entry
    pub fn set_startup(&self, name: &str, path: &str, enabled: bool) -> Result<()> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu.open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            KEY_WRITE,
        )?;

        if enabled {
            let ext = std::path::Path::new(path)
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();

            // .bat/.cmd 文件直接写入注册表会弹出 cmd 窗口
            // 用 wscript.exe 包装 VBS 来静默启动
            let startup_value = if ext == "bat" || ext == "cmd" {
                let vbs_file = self.batch_dir.join(format!("{}_startup.vbs", name));
                let escaped = path.replace("\"", "\"\"");
                let vbs_content = format!(
                    "CreateObject(\"WScript.Shell\").Run \"\"\"{}\"\" \", 0, False\r\n",
                    escaped
                );
                fs::write(&vbs_file, &vbs_content)?;
                format!("wscript.exe //nologo \"{}\"", vbs_file.to_string_lossy())
            } else {
                // exe 等其他类型直接写路径（加引号防止空格问题）
                format!("\"{}\"", path)
            };

            run_key.set_value(name, &startup_value)?;
        } else {
            let _ = run_key.delete_value(name); // Ignore if doesn't exist
                                                // 清理可能存在的 startup VBS 文件
            let vbs_file = self.batch_dir.join(format!("{}_startup.vbs", name));
            if vbs_file.exists() {
                let _ = fs::remove_file(&vbs_file);
            }
        }

        Ok(())
    }

    fn broadcast_environment_change(&self) {
        Self::broadcast_setting_change("Environment", 1000);
    }

    /// 广播 App Paths 注册表变更，通知 Windows 刷新 App Paths 缓存
    /// 这样更新别名后，Win+R 会立即使用新的目标路径
    pub fn broadcast_app_paths_change(&self) {
        Self::broadcast_setting_change(
            "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths",
            300,
        );
    }

    fn broadcast_app_paths_change_async() {
        std::thread::spawn(|| {
            Self::broadcast_setting_change(
                "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths",
                300,
            );
        });
    }

    fn broadcast_setting_change(area: &'static str, timeout_ms: u32) {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        const HWND_BROADCAST: isize = 0xffff;
        const WM_SETTINGCHANGE: u32 = 0x001A;
        const SMTO_ABORTIFHUNG: u32 = 0x0002;

        #[link(name = "user32")]
        extern "system" {
            fn SendMessageTimeoutW(
                hWnd: isize,
                Msg: u32,
                wParam: usize,
                lParam: *const u16,
                fuFlags: u32,
                uTimeout: u32,
                lpdwResult: *mut usize,
            ) -> isize;
        }

        let area: Vec<u16> = OsStr::new(area)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        unsafe {
            let mut result: usize = 0;
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0,
                area.as_ptr(),
                SMTO_ABORTIFHUNG,
                timeout_ms,
                &mut result,
            );
        }
    }

    /// Get the batch directory path for user reference
    pub fn get_batch_dir(&self) -> &PathBuf {
        &self.batch_dir
    }

    /// Check if an alias exists in App Paths registry
    pub fn alias_exists(&self, alias: &str) -> bool {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let app_paths_key = format!(
            "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{}.exe",
            alias
        );
        hkcu.open_subkey(&app_paths_key).is_ok()
    }

    /// 清理旧版本用 powershell 创建的 .lnk 文件（已改用 .vbs 方式）
    pub fn cleanup_legacy_lnk_files(&self) {
        if !self.batch_dir.exists() {
            return;
        }
        if let Ok(entries) = fs::read_dir(&self.batch_dir) {
            for entry in entries.flatten() {
                if let Ok(name) = entry.file_name().into_string() {
                    if name.ends_with(".lnk") {
                        let _ = fs::remove_file(entry.path());
                    }
                }
            }
        }
    }

    /// Clean up all batch files (for uninstall)
    #[allow(dead_code)]
    pub fn cleanup_all(&self) -> Result<()> {
        if self.batch_dir.exists() {
            fs::remove_dir_all(&self.batch_dir)?;
        }
        Ok(())
    }

    /// Clean up old files
    pub fn cleanup_old_vbs_files(&self, current_aliases: &[String]) -> Result<()> {
        if !self.batch_dir.exists() {
            return Ok(());
        }

        if let Ok(entries) = fs::read_dir(&self.batch_dir) {
            for entry in entries.flatten() {
                if let Ok(file_name) = entry.file_name().into_string() {
                    let is_valid = if file_name.ends_with(".cmd") {
                        let alias = file_name.trim_end_matches(".cmd");
                        current_aliases.contains(&alias.to_string())
                    } else if file_name.ends_with(".vbs") {
                        let alias = file_name.trim_end_matches(".vbs");
                        current_aliases.contains(&alias.to_string())
                    } else {
                        true // 不认识的文件类型不删
                    };

                    if !is_valid {
                        let _ = fs::remove_file(entry.path());
                    }
                }
            }
        }

        Ok(())
    }
}
