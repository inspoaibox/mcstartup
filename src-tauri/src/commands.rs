use crate::ai_chat_commands::AiChatState;
use crate::ai_chat_db::AiChatBackup;
use crate::context_menu::ContextMenuManager;
use crate::launcher;
use crate::models::{Group, GroupInput, LaunchItem, LaunchItemInput};
use crate::registry::RegistryManager;
use crate::settings::{AppSettings, SettingsManager};
use crate::storage::Storage;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use tauri::{GlobalShortcutManager, State};
use uuid::Uuid;

pub const APP_TRAY_ID: &str = "main-tray";
pub const APP_TRAY_TOOLTIP: &str = "McStartUP";
pub const RSS_READER_TRAY_ID_PREFIX: &str = "rss-reader-tray";
pub const RSS_READER_TRAY_TOOLTIP: &str = "RSS 阅读器";

fn rss_reader_tray_state() -> &'static Mutex<Option<String>> {
    static STATE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(None))
}

pub struct AppState {
    pub storage: Mutex<Storage>,
    pub registry: Mutex<RegistryManager>,
    pub settings: Mutex<SettingsManager>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendBackupData {
    #[serde(default)]
    pub local_storage: serde_json::Value,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullConfigBackup {
    pub backup_kind: String,
    pub version: u32,
    pub exported_at: String,
    pub app: String,
    pub config: crate::models::AppConfig,
    pub settings: AppSettings,
    #[serde(default)]
    pub tool_data: serde_json::Value,
    #[serde(default)]
    pub frontend: serde_json::Value,
    #[serde(default)]
    pub ai_chat: AiChatBackup,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportConfigResult {
    pub backup_kind: String,
    pub version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frontend: Option<serde_json::Value>,
    pub restored_tool_data: bool,
    pub restored_ai_chat: bool,
    pub notes: Vec<String>,
}

fn unregister_shortcuts(
    app_handle: &tauri::AppHandle,
    old_shortcut: Option<&str>,
    new_shortcut: &str,
) {
    let mut gsm = app_handle.global_shortcut_manager();

    if let Some(old_shortcut) = old_shortcut.filter(|s| !s.is_empty()) {
        let _ = gsm.unregister(old_shortcut);
    }

    if !new_shortcut.is_empty() {
        let _ = gsm.unregister(new_shortcut);
    }
}

fn app_data_file(name: &str) -> Result<std::path::PathBuf, String> {
    Storage::get_config_dir()
        .map(|dir| dir.join(name))
        .map_err(|e| e.to_string())
}

fn read_tool_data_value() -> serde_json::Value {
    let Ok(path) = app_data_file("tool_data.json") else {
        return serde_json::json!({});
    };
    let Ok(content) = std::fs::read_to_string(path) else {
        return serde_json::json!({});
    };
    serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
}

pub fn app_window_icon() -> Result<tauri::Icon, String> {
    let image = image::load_from_memory(include_bytes!("../icons/128x128.png"))
        .map_err(|error| format!("读取窗口图标失败: {}", error))?
        .to_rgba8();
    let (width, height) = image.dimensions();
    Ok(tauri::Icon::Rgba {
        rgba: image.into_raw(),
        width,
        height,
    })
}

pub fn apply_app_window_icon(window: &tauri::Window) {
    if let Ok(icon) = app_window_icon() {
        let _ = window.set_icon(icon);
    }
    apply_native_window_icons(window);
}

pub fn refresh_app_tray_icon(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let tray = app_handle
        .tray_handle_by_id(APP_TRAY_ID)
        .ok_or_else(|| "系统托盘尚未初始化".to_string())?;
    let icon = app_window_icon()?;
    tray.set_icon(icon)
        .map_err(|error| format!("刷新托盘图标失败: {}", error))?;
    let _ = tray.set_tooltip(APP_TRAY_TOOLTIP);
    Ok(())
}

pub fn destroy_rss_reader_tray(app_handle: &tauri::AppHandle) {
    let tray_id = rss_reader_tray_state()
        .lock()
        .ok()
        .and_then(|mut id| id.take());
    if let Some(tray_id) = tray_id {
        if let Some(tray) = app_handle.tray_handle_by_id(&tray_id) {
            let _ = tray.destroy();
        }
    }
}

pub fn ensure_rss_reader_tray(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let icon = app_window_icon()?;
    if let Ok(mut state) = rss_reader_tray_state().lock() {
        if let Some(tray_id) = state.as_ref() {
            if let Some(tray) = app_handle.tray_handle_by_id(tray_id) {
                tray.set_icon(icon)
                    .map_err(|error| format!("刷新 RSS 托盘图标失败: {}", error))?;
                let _ = tray.set_tooltip(RSS_READER_TRAY_TOOLTIP);
                return Ok(());
            }
            state.take();
        }
    }

    let tray_id = format!("{}-{}", RSS_READER_TRAY_ID_PREFIX, Uuid::new_v4());
    let app_handle_for_tray = app_handle.clone();
    tauri::SystemTray::new()
        .with_id(tray_id.clone())
        .with_icon(icon)
        .with_tooltip(RSS_READER_TRAY_TOOLTIP)
        .with_menu(
            tauri::SystemTrayMenu::new().add_item(tauri::CustomMenuItem::new(
                "rss_reader_show",
                "显示 RSS 阅读器",
            )),
        )
        .on_event(move |event| match event {
            tauri::SystemTrayEvent::LeftClick { .. } => {
                let handle = app_handle_for_tray.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = show_tool_window("tool-rss-reader".to_string(), handle);
                });
            }
            tauri::SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "rss_reader_show" => {
                    let handle = app_handle_for_tray.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = show_tool_window("tool-rss-reader".to_string(), handle);
                    });
                }
                _ => {}
            },
            _ => {}
        })
        .build(app_handle)
        .map_err(|error| format!("创建 RSS 托盘图标失败: {}", error))?;

    if let Ok(mut state) = rss_reader_tray_state().lock() {
        *state = Some(tray_id);
    }
    Ok(())
}

#[tauri::command]
pub fn refresh_tray_icon(app_handle: tauri::AppHandle) -> Result<(), String> {
    refresh_app_tray_icon(&app_handle)
}

#[cfg(windows)]
fn apply_native_window_icons(window: &tauri::Window) {
    if let Ok(hwnd) = window.hwnd() {
        let (small, big) = native_app_icon_handles();
        unsafe {
            use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
            use windows::Win32::UI::WindowsAndMessaging::{
                SendMessageW, ICON_BIG, ICON_SMALL, WM_SETICON,
            };
            let hwnd = HWND(hwnd.0 as isize);
            if small != 0 {
                SendMessageW(hwnd, WM_SETICON, WPARAM(ICON_SMALL as usize), LPARAM(small));
            }
            if big != 0 {
                SendMessageW(hwnd, WM_SETICON, WPARAM(ICON_BIG as usize), LPARAM(big));
            }
        }
    }
}

#[cfg(not(windows))]
fn apply_native_window_icons(_window: &tauri::Window) {}

#[cfg(windows)]
fn native_app_icon_handles() -> (isize, isize) {
    static APP_ICON_HANDLES: OnceLock<(isize, isize)> = OnceLock::new();
    *APP_ICON_HANDLES.get_or_init(|| {
        let small = create_native_icon_from_png(include_bytes!("../icons/32x32.png"))
            .unwrap_or_else(|error| {
                eprintln!("Failed to create small app icon: {}", error);
                0
            });
        let big = create_native_icon_from_png(include_bytes!("../icons/128x128.png"))
            .unwrap_or_else(|error| {
                eprintln!("Failed to create taskbar app icon: {}", error);
                small
            });
        (small, big)
    })
}

#[cfg(windows)]
fn create_native_icon_from_png(bytes: &[u8]) -> Result<isize, String> {
    let image = image::load_from_memory(bytes)
        .map_err(|error| format!("读取 Windows 图标失败: {}", error))?
        .to_rgba8();
    let (width, height) = image.dimensions();
    let mut bgra = image.into_raw();
    let mut and_mask = Vec::with_capacity(bgra.len() / 4);
    for pixel in bgra.chunks_exact_mut(4) {
        and_mask.push(pixel[3].wrapping_sub(u8::MAX));
        pixel.swap(0, 2);
    }
    unsafe {
        use windows::Win32::Foundation::HINSTANCE;
        use windows::Win32::UI::WindowsAndMessaging::CreateIcon;
        let icon = CreateIcon(
            HINSTANCE::default(),
            width as i32,
            height as i32,
            1,
            32,
            and_mask.as_ptr(),
            bgra.as_ptr(),
        )
        .map_err(|error| format!("创建 Windows 图标失败: {:?}", error))?;
        Ok(icon.0)
    }
}

fn portable_launcher_config(config: &crate::models::AppConfig) -> crate::models::AppConfig {
    let allowed_types = ["app", "url", "script"];
    let mut used_group_ids = HashSet::new();

    let items = config
        .items
        .iter()
        .filter(|item| {
            let item_type = item.item_type.as_deref().unwrap_or("app");
            allowed_types.contains(&item_type)
        })
        .map(|item| {
            if let Some(group_id) = &item.group_id {
                used_group_ids.insert(group_id.clone());
            }

            let mut portable_item = item.clone();
            portable_item.startup_enabled = false;
            portable_item.last_used = None;
            portable_item.launch_count = None;
            portable_item
        })
        .collect::<Vec<_>>();

    let groups = config
        .groups
        .iter()
        .filter(|group| used_group_ids.contains(&group.id))
        .cloned()
        .collect::<Vec<_>>();

    crate::models::AppConfig {
        items,
        groups,
        settings: config.settings.clone(),
    }
}

fn write_tool_data_value(value: &serde_json::Value) -> Result<(), String> {
    let path = app_data_file("tool_data.json")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建数据目录失败: {}", e))?;
    }
    let content =
        serde_json::to_string_pretty(value).map_err(|e| format!("序列化工具数据失败: {}", e))?;
    std::fs::write(path, content).map_err(|e| format!("保存工具数据失败: {}", e))
}

fn refresh_aliases_and_startup(
    old_config: &crate::models::AppConfig,
    new_config: &crate::models::AppConfig,
    registry: &RegistryManager,
    storage: &Storage,
) {
    for item in &old_config.items {
        let _ = registry.unregister_alias(&item.alias);
        let item_type = item.item_type.as_deref().unwrap_or("app");
        if item_type == "app" && item.startup_enabled {
            let _ = registry.set_startup(&item.alias, &item.target_path, false);
        }
    }

    for item in &new_config.items {
        let item_type = item.item_type.as_deref().unwrap_or("app");
        let _ = registry.register_alias_batch(
            &item.alias,
            &item.target_path,
            item.arguments.as_deref(),
            item_type,
        );
        if item_type == "app" && item.startup_enabled {
            let _ = registry.set_startup(&item.alias, &item.target_path, true);
        }
    }

    registry.broadcast_app_paths_change();

    let snapshot = storage.build_alias_snapshot(new_config);
    let cache = crate::storage::AliasCache {
        aliases: snapshot,
        last_updated: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    };
    let _ = storage.save_alias_cache(&cache);
}

fn reapply_imported_shortcuts(app_handle: &tauri::AppHandle, settings: &AppSettings) {
    let _ = app_handle.global_shortcut_manager().unregister_all();
    crate::register_shortcut(app_handle, &settings.quick_launch_shortcut);
    if let Some(shortcut) = settings.clipboard_shortcut.as_deref() {
        crate::register_clipboard_shortcut(app_handle, shortcut);
    }
    if let Some(shortcut) = settings.toolbox_shortcut.as_deref() {
        crate::register_toolbox_shortcut(app_handle, shortcut);
    }
    if let Some(shortcut) = settings.ai_chat_shortcut.as_deref() {
        crate::register_ai_chat_shortcut(app_handle, shortcut);
    }
    if let Some(shortcut) = settings.ocr_shortcut.as_deref() {
        crate::register_ocr_screenshot_shortcut(app_handle, shortcut);
    }
    if let Some(shortcut) = settings.translate_shortcut.as_deref() {
        if let Err(error) = crate::register_translate_screenshot_shortcut(app_handle, shortcut) {
            eprintln!(
                "[Shortcuts] Failed to restore screenshot translate shortcut: {}",
                error
            );
        }
    }
    if let Some(shortcut) = settings.quick_translate_shortcut.as_deref() {
        if let Err(error) = crate::register_quick_translate_shortcut(app_handle, shortcut) {
            eprintln!(
                "[Shortcuts] Failed to restore quick translate shortcut: {}",
                error
            );
        }
    }
    if let Some(shortcut) = settings.word_selection_translate_shortcut.as_deref() {
        if let Err(error) = crate::register_word_selection_translate_shortcut(app_handle, shortcut)
        {
            eprintln!(
                "[Shortcuts] Failed to restore word selection translate shortcut: {}",
                error
            );
        }
    }
    if let Some(shortcut) = settings.screenshot_fullscreen_shortcut.as_deref() {
        if let Err(error) = crate::register_screenshot_fullscreen_shortcut(app_handle, shortcut) {
            eprintln!(
                "[Shortcuts] Failed to restore screenshot fullscreen shortcut: {}",
                error
            );
        }
    }
    if let Some(shortcut) = settings.screenshot_region_shortcut.as_deref() {
        if let Err(error) = crate::register_screenshot_region_shortcut(app_handle, shortcut) {
            eprintln!(
                "[Shortcuts] Failed to restore screenshot region shortcut: {}",
                error
            );
        }
    }
}

#[tauri::command]
pub fn get_all_items(state: State<AppState>) -> Result<Vec<LaunchItem>, String> {
    let storage = state.storage.lock().unwrap();
    let config = storage.load().map_err(|e| e.to_string())?;
    Ok(config.items)
}

#[tauri::command]
pub fn add_item(item: LaunchItemInput, state: State<AppState>) -> Result<LaunchItem, String> {
    let storage = state.storage.lock().unwrap();
    let mut config = storage.load().map_err(|e| e.to_string())?;

    let new_item = LaunchItem {
        id: Uuid::new_v4().to_string(),
        name: item.name,
        alias: item.alias.clone(),
        target_path: item.target_path.clone(),
        item_type: item.item_type.clone(),
        arguments: item.arguments,
        working_dir: item.working_dir,
        env_vars: item.env_vars,
        run_as_admin: item.run_as_admin,
        startup_enabled: item.startup_enabled,
        group_id: item.group_id,
        icon: item.icon,
        description: item.description,
        hotkey: item.hotkey,
        created_at: chrono::Utc::now().timestamp(),
        last_used: None,
        launch_count: Some(0),
        launch_profiles: item.launch_profiles,
        script_show_window: item.script_show_window,
        script_content: item.script_content,
        script_type: item.script_type,
    };

    // 所有类型都注册别名（应用程序、网址、文件夹）
    let item_type = item.item_type.as_deref().unwrap_or("app");
    let registry = state.registry.lock().unwrap();
    registry
        .register_alias(
            &new_item.alias,
            &new_item.target_path,
            new_item.arguments.as_deref(),
            item_type,
        )
        .map_err(|e| e.to_string())?;

    // 只有应用程序类型才支持开机启动
    if item_type == "app" && new_item.startup_enabled {
        registry
            .set_startup(&new_item.alias, &new_item.target_path, true)
            .map_err(|e| e.to_string())?;
    }

    // 为每个启动配置注册独立别名
    if let Some(profiles) = &new_item.launch_profiles {
        for profile in profiles {
            if !profile.alias.is_empty() {
                let _ = registry.register_alias(
                    &profile.alias,
                    &new_item.target_path,
                    profile.arguments.as_deref(),
                    item_type,
                );
            }
        }
    }

    config.items.push(new_item.clone());
    storage.save(&config).map_err(|e| e.to_string())?;

    Ok(new_item)
}

#[tauri::command]
pub fn update_item(
    id: String,
    item: LaunchItemInput,
    state: State<AppState>,
) -> Result<LaunchItem, String> {
    let storage = state.storage.lock().unwrap();
    let mut config = storage.load().map_err(|e| e.to_string())?;

    let index = config
        .items
        .iter()
        .position(|i| i.id == id)
        .ok_or("Item not found")?;

    let old_item = config.items[index].clone();
    let registry = state.registry.lock().unwrap();

    let old_item_type = old_item.item_type.as_deref().unwrap_or("app");
    let new_item_type = item.item_type.as_deref().unwrap_or("app");

    // 所有类型都处理别名注册
    // 如果别名、路径、参数或类型有任何变化，都需要重新注册
    if old_item.alias != item.alias
        || old_item.target_path != item.target_path
        || old_item.arguments != item.arguments
        || old_item_type != new_item_type
    {
        // 如果别名改了，先删除旧的
        if old_item.alias != item.alias {
            registry
                .unregister_alias(&old_item.alias)
                .map_err(|e| e.to_string())?;
        }

        // 注册新的（会覆盖同名的）
        registry
            .register_alias(
                &item.alias,
                &item.target_path,
                item.arguments.as_deref(),
                new_item_type,
            )
            .map_err(|e| e.to_string())?;
    }

    // Update startup if changed (only for app type)
    if new_item_type == "app" && old_item.startup_enabled != item.startup_enabled {
        // 如果别名改了，先清理旧的启动项
        if old_item.alias != item.alias && old_item.startup_enabled {
            let _ = registry.set_startup(&old_item.alias, &old_item.target_path, false);
        }
        registry
            .set_startup(&item.alias, &item.target_path, item.startup_enabled)
            .map_err(|e| e.to_string())?;
    }

    // 后端做 merge：保留 id、created_at、last_used，其余用前端传入的值
    let updated_item = LaunchItem {
        id: id.clone(),
        name: item.name,
        alias: item.alias,
        target_path: item.target_path,
        item_type: item.item_type,
        arguments: item.arguments,
        working_dir: item.working_dir,
        env_vars: item.env_vars,
        run_as_admin: item.run_as_admin,
        startup_enabled: item.startup_enabled,
        group_id: item.group_id,
        icon: item.icon,
        description: item.description,
        hotkey: item.hotkey,
        created_at: old_item.created_at,
        last_used: old_item.last_used,
        launch_count: old_item.launch_count,
        launch_profiles: item.launch_profiles,
        script_show_window: item.script_show_window,
        script_content: item.script_content,
        script_type: item.script_type,
    };

    // 清理旧的 profile 别名
    if let Some(old_profiles) = &old_item.launch_profiles {
        for profile in old_profiles {
            if !profile.alias.is_empty() {
                let _ = registry.unregister_alias(&profile.alias);
            }
        }
    }

    // 注册新的 profile 别名
    if let Some(new_profiles) = &updated_item.launch_profiles {
        let utype = updated_item.item_type.as_deref().unwrap_or("app");
        for profile in new_profiles {
            if !profile.alias.is_empty() {
                let _ = registry.register_alias(
                    &profile.alias,
                    &updated_item.target_path,
                    profile.arguments.as_deref(),
                    utype,
                );
            }
        }
    }

    config.items[index] = updated_item.clone();
    storage.save(&config).map_err(|e| e.to_string())?;

    Ok(updated_item)
}

#[tauri::command]
pub fn delete_item(id: String, state: State<AppState>) -> Result<(), String> {
    let storage = state.storage.lock().unwrap();
    let mut config = storage.load().map_err(|e| e.to_string())?;

    let item = config
        .items
        .iter()
        .find(|i| i.id == id)
        .ok_or("Item not found")?
        .clone();

    // 所有类型都需要删除别名
    let registry = state.registry.lock().unwrap();
    registry
        .unregister_alias(&item.alias)
        .map_err(|e| e.to_string())?;

    // 删除 profile 别名
    if let Some(profiles) = &item.launch_profiles {
        for profile in profiles {
            if !profile.alias.is_empty() {
                let _ = registry.unregister_alias(&profile.alias);
            }
        }
    }

    // 只有应用程序类型才处理开机启动
    let item_type = item.item_type.as_deref().unwrap_or("app");
    if item_type == "app" && item.startup_enabled {
        registry
            .set_startup(&item.alias, &item.target_path, false)
            .map_err(|e| e.to_string())?;
    }

    config.items.retain(|i| i.id != id);
    storage.save(&config).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn launch_item(id: String, state: State<AppState>) -> Result<(), String> {
    let storage = state.storage.lock().unwrap();
    let mut config = storage.load().map_err(|e| e.to_string())?;

    let item = config
        .items
        .iter_mut()
        .find(|i| i.id == id)
        .ok_or("Item not found")?;

    launcher::launch_item(item).map_err(|e| e.to_string())?;

    item.last_used = Some(chrono::Utc::now().timestamp());
    item.launch_count = Some(item.launch_count.unwrap_or(0) + 1);
    storage.save(&config).map_err(|e| e.to_string())?;

    Ok(())
}

/// 使用指定的启动配置启动项目
#[tauri::command]
pub fn launch_item_with_profile(
    id: String,
    profile_name: String,
    state: State<AppState>,
) -> Result<(), String> {
    let storage = state.storage.lock().unwrap();
    let mut config = storage.load().map_err(|e| e.to_string())?;

    let item = config
        .items
        .iter_mut()
        .find(|i| i.id == id)
        .ok_or("Item not found")?;

    // 查找指定的 profile
    let profile = item
        .launch_profiles
        .as_ref()
        .and_then(|profiles| profiles.iter().find(|p| p.name == profile_name))
        .cloned();

    launcher::launch_item_with_profile(item, profile.as_ref()).map_err(|e| e.to_string())?;

    item.last_used = Some(chrono::Utc::now().timestamp());
    item.launch_count = Some(item.launch_count.unwrap_or(0) + 1);
    storage.save(&config).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_all_groups(state: State<AppState>) -> Result<Vec<Group>, String> {
    let storage = state.storage.lock().unwrap();
    let config = storage.load().map_err(|e| e.to_string())?;
    Ok(config.groups)
}

#[tauri::command]
pub fn add_group(group: GroupInput, state: State<AppState>) -> Result<Group, String> {
    let storage = state.storage.lock().unwrap();
    let mut config = storage.load().map_err(|e| e.to_string())?;

    let new_group = Group {
        id: Uuid::new_v4().to_string(),
        name: group.name,
        color: group.color,
        order: group.order,
    };

    config.groups.push(new_group.clone());
    storage.save(&config).map_err(|e| e.to_string())?;

    Ok(new_group)
}

#[tauri::command]
pub fn update_group(id: String, group: Group, state: State<AppState>) -> Result<Group, String> {
    let storage = state.storage.lock().unwrap();
    let mut config = storage.load().map_err(|e| e.to_string())?;

    let index = config
        .groups
        .iter()
        .position(|g| g.id == id)
        .ok_or("Group not found")?;

    let updated_group = Group {
        id: id.clone(),
        ..group
    };

    config.groups[index] = updated_group.clone();
    storage.save(&config).map_err(|e| e.to_string())?;

    Ok(updated_group)
}

#[tauri::command]
pub fn delete_group(id: String, state: State<AppState>) -> Result<(), String> {
    let storage = state.storage.lock().unwrap();
    let mut config = storage.load().map_err(|e| e.to_string())?;

    config.groups.retain(|g| g.id != id);

    // Remove group assignment from items and re-register their aliases for consistency
    let registry = state.registry.lock().unwrap();
    for item in &mut config.items {
        if item.group_id.as_ref() == Some(&id) {
            item.group_id = None;
            // 重新注册别名以确保一致性
            let item_type = item.item_type.as_deref().unwrap_or("app");
            let _ = registry.register_alias(
                &item.alias,
                &item.target_path,
                item.arguments.as_deref(),
                item_type,
            );
        }
    }

    storage.save(&config).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn reorder_groups(group_ids: Vec<String>, state: State<AppState>) -> Result<(), String> {
    let storage = state.storage.lock().unwrap();
    let mut config = storage.load().map_err(|e| e.to_string())?;

    // 根据传入的 ID 顺序更新 order 值
    for (new_order, gid) in group_ids.iter().enumerate() {
        if let Some(group) = config.groups.iter_mut().find(|g| g.id == *gid) {
            group.order = new_order as i32;
        }
    }

    // 按 order 排序
    config.groups.sort_by_key(|g| g.order);

    storage.save(&config).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn export_config(
    frontend_data: Option<FrontendBackupData>,
    state: State<AppState>,
    ai_state: State<AiChatState>,
) -> Result<String, String> {
    let storage = state.storage.lock().unwrap();
    let config = storage.load().map_err(|e| e.to_string())?;
    let portable_config = portable_launcher_config(&config);
    let settings = state
        .settings
        .lock()
        .unwrap()
        .load()
        .map_err(|e| e.to_string())?;
    let tool_data = read_tool_data_value();
    let ai_chat = ai_state
        .db
        .lock()
        .unwrap()
        .export_backup()
        .map_err(|e| format!("导出 AI 聊天数据失败: {}", e))?;

    let backup = FullConfigBackup {
        backup_kind: "mcstartup-full-backup".to_string(),
        version: 2,
        exported_at: chrono::Local::now().to_rfc3339(),
        app: "McStartUP".to_string(),
        config: portable_config,
        settings,
        tool_data,
        frontend: frontend_data
            .map(|data| serde_json::json!({ "localStorage": data.local_storage }))
            .unwrap_or_else(|| serde_json::json!({})),
        ai_chat,
        notes: vec![
            "包含便携启动器数据、全局设置、工具箱数据、前端偏好和 AI 聊天历史/记忆。".to_string(),
            "启动器仅导出系统应用、网址、脚本和这些项目实际使用的分组；会保留项目快捷键，但不会迁移每台电脑不同的开机启动状态、使用次数和最近使用时间。".to_string(),
            "不包含剪贴板历史数据库和本地下载模型文件。".to_string(),
        ],
    };

    let backup_dir = Storage::get_config_dir()
        .map_err(|e| e.to_string())?
        .join("backups");
    std::fs::create_dir_all(&backup_dir).map_err(|e| format!("创建备份目录失败: {}", e))?;
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let backup_path = backup_dir.join(format!("mcstartup_full_backup_{}.json", timestamp));
    let content =
        serde_json::to_string_pretty(&backup).map_err(|e| format!("序列化备份失败: {}", e))?;
    std::fs::write(&backup_path, content).map_err(|e| format!("写入备份失败: {}", e))?;
    Ok(backup_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn import_config(
    path: String,
    app_handle: tauri::AppHandle,
    state: State<AppState>,
    ai_state: State<AiChatState>,
) -> Result<ImportConfigResult, String> {
    let backup_path = std::path::PathBuf::from(path);
    let content =
        std::fs::read_to_string(&backup_path).map_err(|e| format!("读取备份失败: {}", e))?;
    let value: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("备份 JSON 格式错误: {}", e))?;

    if value.get("backupKind").and_then(|v| v.as_str()) != Some("mcstartup-full-backup") {
        let legacy_config: crate::models::AppConfig = serde_json::from_value(value)
            .map_err(|e| format!("无法识别备份格式，也不是旧版 config.json: {}", e))?;
        let storage = state.storage.lock().unwrap();
        let registry = state.registry.lock().unwrap();
        let old_config = storage.load().map_err(|e| e.to_string())?;
        storage
            .restore_config(&legacy_config)
            .map_err(|e| e.to_string())?;
        refresh_aliases_and_startup(&old_config, &legacy_config, &registry, &storage);

        return Ok(ImportConfigResult {
            backup_kind: "legacy-config".to_string(),
            version: 1,
            frontend: None,
            restored_tool_data: false,
            restored_ai_chat: false,
            notes: vec!["已兼容导入旧版备份，仅恢复项目、分组和旧版配置。".to_string()],
        });
    }

    let backup: FullConfigBackup =
        serde_json::from_value(value).map_err(|e| format!("解析完整备份失败: {}", e))?;

    let storage = state.storage.lock().unwrap();
    let registry = state.registry.lock().unwrap();
    let old_config = storage.load().map_err(|e| e.to_string())?;
    storage
        .restore_config(&backup.config)
        .map_err(|e| e.to_string())?;
    refresh_aliases_and_startup(&old_config, &backup.config, &registry, &storage);

    state
        .settings
        .lock()
        .unwrap()
        .save(&backup.settings)
        .map_err(|e| e.to_string())?;
    reapply_imported_shortcuts(&app_handle, &backup.settings);

    let tool_data = if backup.tool_data.is_null() {
        serde_json::json!({})
    } else {
        backup.tool_data
    };
    write_tool_data_value(&tool_data)?;

    let mut ai_db = ai_state.db.lock().unwrap();
    ai_db
        .import_backup(&backup.ai_chat)
        .map_err(|e| format!("导入 AI 聊天数据失败: {}", e))?;

    Ok(ImportConfigResult {
        backup_kind: backup.backup_kind,
        version: backup.version,
        frontend: Some(backup.frontend),
        restored_tool_data: true,
        restored_ai_chat: true,
        notes: backup.notes,
    })
}

#[tauri::command]
pub fn get_batch_dir(state: State<AppState>) -> Result<String, String> {
    let registry = state.registry.lock().unwrap();
    Ok(registry.get_batch_dir().to_string_lossy().to_string())
}

#[tauri::command]
pub fn check_alias_exists(alias: String, state: State<AppState>) -> Result<bool, String> {
    let registry = state.registry.lock().unwrap();
    Ok(registry.alias_exists(&alias))
}

#[tauri::command]
pub fn cleanup_duplicate_groups(state: State<AppState>) -> Result<(), String> {
    let storage = state.storage.lock().unwrap();
    let mut config = storage.load().map_err(|e| e.to_string())?;

    // 第一步：在过滤前，建立 name -> kept_id 和 removed_id -> name 两张表
    let mut seen_names: std::collections::HashMap<String, String> =
        std::collections::HashMap::new(); // name -> kept_id
    let mut removed_id_to_name: std::collections::HashMap<String, String> =
        std::collections::HashMap::new(); // removed_id -> name

    for group in &config.groups {
        if seen_names.contains_key(&group.name) {
            removed_id_to_name.insert(group.id.clone(), group.name.clone());
        } else {
            seen_names.insert(group.name.clone(), group.id.clone());
        }
    }

    // 第二步：过滤分组，只保留每个名称第一次出现的
    config
        .groups
        .retain(|g| !removed_id_to_name.contains_key(&g.id));

    // 第三步：将 items 中指向被删除分组的 group_id 重映射到保留的分组
    for item in &mut config.items {
        if let Some(gid) = &item.group_id.clone() {
            if let Some(name) = removed_id_to_name.get(gid) {
                item.group_id = seen_names.get(name).cloned();
            }
        }
    }

    storage.save(&config).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn regenerate_all_aliases(state: State<AppState>) -> Result<(), String> {
    let storage = state.storage.lock().unwrap();
    let config = storage.load().map_err(|e| e.to_string())?;

    let registry = state.registry.lock().unwrap();

    // 批量重新生成所有项目的别名（不广播）
    for item in &config.items {
        let item_type = item.item_type.as_deref().unwrap_or("app");
        registry
            .register_alias_batch(
                &item.alias,
                &item.target_path,
                item.arguments.as_deref(),
                item_type,
            )
            .map_err(|e| e.to_string())?;
    }

    // 统一广播一次
    registry.broadcast_app_paths_change();

    // 清理旧的 VBS 文件
    let current_aliases: Vec<String> = config.items.iter().map(|item| item.alias.clone()).collect();

    registry
        .cleanup_old_vbs_files(&current_aliases)
        .map_err(|e| e.to_string())?;

    // 更新别名缓存
    let snapshot = storage.build_alias_snapshot(&config);
    let cache = crate::storage::AliasCache {
        aliases: snapshot,
        last_updated: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    };
    let _ = storage.save_alias_cache(&cache);

    Ok(())
}

/// 解析 .lnk 快捷方式文件，返回目标路径
/// 使用快速的 lnk 库，避免 PowerShell 启动延迟
#[tauri::command]
pub fn resolve_shortcut(lnk_path: String) -> Result<String, String> {
    use std::path::Path;

    let path = Path::new(&lnk_path);

    // 如果不是 .lnk 文件，直接返回原路径
    if !lnk_path.to_lowercase().ends_with(".lnk") {
        return Ok(lnk_path);
    }

    // 使用 lnk 库解析（快速且可靠）
    match lnk::ShellLink::open(path) {
        Ok(link) => {
            // 尝试获取本地路径
            if let Some(target) = link.link_info() {
                if let Some(local_path) = target.local_base_path() {
                    let resolved = local_path.to_string();
                    if !resolved.is_empty() {
                        return Ok(resolved);
                    }
                }
            }

            // 如果没有本地路径，尝试获取相对路径
            if let Some(relative_path) = link.relative_path() {
                if !relative_path.is_empty() {
                    return Ok(relative_path.to_string());
                }
            }

            // 对于应用商店应用等特殊快捷方式，返回原始 .lnk 路径
            // Windows 可以直接启动 .lnk 文件
            Ok(lnk_path)
        }
        Err(e) => {
            // lnk 库解析失败，返回原始路径
            eprintln!("Failed to parse .lnk file: {:?}", e);
            Ok(lnk_path)
        }
    }
}

// 设置相关命令

#[tauri::command]
pub fn load_settings(state: State<AppState>) -> Result<AppSettings, String> {
    let settings_manager = state.settings.lock().unwrap();
    settings_manager.load().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_settings(settings: AppSettings, state: State<AppState>) -> Result<(), String> {
    let settings_manager = state.settings.lock().unwrap();
    settings_manager.save(&settings).map_err(|e| e.to_string())
}

/// 动态更新全局快捷键（由前端设置页面调用）
#[tauri::command]
pub fn update_global_shortcut(
    shortcut: String,
    app_handle: tauri::AppHandle,
    old_shortcut: Option<String>,
) -> Result<(), String> {
    unregister_shortcuts(&app_handle, old_shortcut.as_deref(), &shortcut);
    crate::register_shortcut(&app_handle, &shortcut);
    Ok(())
}

#[tauri::command]
pub fn update_clipboard_shortcut(
    shortcut: String,
    app_handle: tauri::AppHandle,
    old_shortcut: Option<String>,
) -> Result<(), String> {
    unregister_shortcuts(&app_handle, old_shortcut.as_deref(), &shortcut);
    crate::register_clipboard_shortcut(&app_handle, &shortcut);
    Ok(())
}

#[tauri::command]
pub fn update_toolbox_shortcut(
    shortcut: String,
    app_handle: tauri::AppHandle,
    old_shortcut: Option<String>,
) -> Result<(), String> {
    unregister_shortcuts(&app_handle, old_shortcut.as_deref(), &shortcut);
    crate::register_toolbox_shortcut(&app_handle, &shortcut);
    Ok(())
}

#[tauri::command]
pub fn update_ai_chat_shortcut(
    shortcut: String,
    app_handle: tauri::AppHandle,
    old_shortcut: Option<String>,
) -> Result<(), String> {
    unregister_shortcuts(&app_handle, old_shortcut.as_deref(), &shortcut);
    crate::register_ai_chat_shortcut(&app_handle, &shortcut);
    Ok(())
}

#[tauri::command]
pub fn show_tool_window(label: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    if let Some(window) = app_handle.get_window(&label) {
        // 窗口已存在（隐藏状态），直接显示
        let window: tauri::Window = window;
        apply_app_window_icon(&window);
        if label == "tool-rss-reader" {
            let _ = window.set_skip_taskbar(false);
        }
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    // 窗口不存在，动态创建
    let handle = app_handle.clone();
    let label_clone = label.clone();
    tauri::async_runtime::spawn(async move {
        use tauri::{WindowBuilder, WindowUrl};

        let (width, height, resizable, always_on_top, transparent) = match label_clone.as_str() {
            "tool-calculator" => (400.0f64, 600.0f64, false, true, true),
            "tool-kiro-account-manager" => (1220.0f64, 780.0f64, true, false, true),
            "tool-pdf-word-ocr" => (1120.0f64, 780.0f64, true, false, true),
            "tool-tencent-table-ocr" => (1120.0f64, 780.0f64, true, false, true),
            "tool-tencent-bank-card-ocr" => (1120.0f64, 780.0f64, true, false, true),
            "tool-tencent-general-invoice-ocr" => (1180.0f64, 820.0f64, true, false, true),
            "tool-md-word-convert" => (1120.0f64, 780.0f64, true, false, true),
            "tool-file-to-markdown" => (1120.0f64, 820.0f64, true, false, true),
            "tool-md-ppt-convert" => (1120.0f64, 780.0f64, true, false, true),
            "tool-epub-generator" => (1120.0f64, 820.0f64, true, false, true),
            "tool-draw-stamp" => (1480.0f64, 920.0f64, true, false, false),
            "tool-local-speech-to-text" => (1180.0f64, 820.0f64, true, false, true),
            "tool-local-text-to-speech" => (1180.0f64, 820.0f64, true, false, true),
            "tool-local-speech-denoise" => (1180.0f64, 820.0f64, true, false, true),
            "tool-local-vocal-separation" => (1180.0f64, 820.0f64, true, false, true),
            "tool-project-manager" => (1360.0f64, 860.0f64, true, false, true),
            "tool-esim-manager" => (1440.0f64, 900.0f64, true, false, false),
            "tool-subscription-manager" => (1440.0f64, 900.0f64, true, false, false),
            "tool-subscription-editor" => (760.0f64, 860.0f64, true, false, false),
            "tool-rss-reader" => (1440.0f64, 900.0f64, true, false, false),
            "tool-resume-generator" => (1440.0f64, 920.0f64, true, false, false),
            "tool-website-bookmarks" => (1440.0f64, 900.0f64, true, false, false),
            "tool-mind-map" => (1500.0f64, 920.0f64, true, false, false),
            "tool-flowchart" => (1500.0f64, 920.0f64, true, false, false),
            "tool-whiteboard" => (1500.0f64, 920.0f64, true, false, false),
            "tool-auto-clicker" => (1280.0f64, 760.0f64, true, false, false),
            "tool-password-manager" => (1280.0f64, 820.0f64, true, false, false),
            "tool-archive-manager" => (1180.0f64, 780.0f64, true, false, false),
            "tool-download-manager" => (1280.0f64, 820.0f64, true, false, false),
            "tool-video-downloader" => (1280.0f64, 820.0f64, true, false, false),
            "tool-tikhub-downloader" => (1280.0f64, 820.0f64, true, false, false),
            "tool-douyin-downloader" => (1280.0f64, 820.0f64, true, false, false),
            "tool-wx-channels-downloader" => (1280.0f64, 820.0f64, true, false, false),
            "tool-video-player" => (1280.0f64, 780.0f64, true, false, false),
            "tool-music-player" => (1220.0f64, 780.0f64, true, false, false),
            "tool-traceroute" => (1280.0f64, 820.0f64, true, false, false),
            "tool-gif-recorder" => (520.0f64, 360.0f64, true, true, true),
            "tool-hosts-editor" => (1100.0f64, 760.0f64, true, false, false),
            "tool-shutdown-scheduler" => (980.0f64, 640.0f64, true, false, false),
            "tool-startup-manager" => (1180.0f64, 760.0f64, true, false, false),
            "tool-file-unlocker" => (1080.0f64, 720.0f64, true, false, false),
            "tool-force-delete" => (960.0f64, 680.0f64, true, false, false),
            "tool-large-files" => (1180.0f64, 760.0f64, true, false, false),
            "tool-junk-cleaner" => (1120.0f64, 720.0f64, true, false, false),
            "tool-dns-switch" => (1180.0f64, 760.0f64, true, false, false),
            "tool-network-repair" => (1280.0f64, 820.0f64, true, false, false),
            "tool-environment-variables" => (1220.0f64, 780.0f64, true, false, false),
            "tool-context-menu-manager" => (1220.0f64, 780.0f64, true, false, false),
            "tool-services-manager" => (1280.0f64, 780.0f64, true, false, false),
            "tool-scheduled-tasks" => (1280.0f64, 780.0f64, true, false, false),
            "tool-installed-apps" => (1180.0f64, 760.0f64, true, false, false),
            "tool-system-info" => (1180.0f64, 760.0f64, true, false, false),
            "tool-windows-update" => (1180.0f64, 760.0f64, true, false, false),
            "tool-wsl-dashboard" => (1280.0f64, 820.0f64, true, false, false),
            "tool-driver-manager" => (1360.0f64, 840.0f64, true, false, false),
            "tool-system-monitor" => (1380.0f64, 860.0f64, true, false, false),
            "tool-github-store" => (1440.0f64, 860.0f64, true, false, false),
            "tool-web-check" => (1440.0f64, 900.0f64, true, false, false),
            "tool-database-manager" => (1480.0f64, 900.0f64, true, false, false),
            "tool-software-copyright" => (1480.0f64, 900.0f64, true, false, false),
            "tool-prompt-library" => (1200.0f64, 800.0f64, true, false, false),
            "tool-skills-library" => (1240.0f64, 820.0f64, true, false, false),
            "tool-mcp-library" => (1240.0f64, 820.0f64, true, false, false),
            _ => (1200.0f64, 800.0f64, true, false, true),
        };
        let title = match label_clone.as_str() {
            "tool-network" => "网络工具箱",
            "tool-ping" => "Ping 测试工具",
            "tool-css" => "CSS 工具",
            "tool-qrcode" => "二维码生成器",
            "tool-unit-converter" => "单位换算",
            "tool-date-calculator" => "时间差计算",
            "tool-todo" => "待办事项",
            "tool-project-manager" => "项目管理",
            "tool-esim-manager" => "手机号码 eSIM 管理",
            "tool-subscription-manager" => "订阅管理",
            "tool-subscription-editor" => "新增/编辑订阅",
            "tool-rss-reader" => "RSS 阅读器",
            "tool-resume-generator" => "简历生成器",
            "tool-website-bookmarks" => "网址收藏",
            "tool-file-rename" => "批量重命名",
            "tool-mind-map" => "思维导图",
            "tool-flowchart" => "流程图",
            "tool-whiteboard" => "白板",
            "tool-auto-clicker" => "超级连点器",
            "tool-password-manager" => "密码管理器",
            "tool-archive-manager" => "压缩解压",
            "tool-hosts-editor" => "Hosts 编辑",
            "tool-shutdown-scheduler" => "定时关机",
            "tool-startup-manager" => "开机启动管理",
            "tool-file-unlocker" => "解除占用",
            "tool-force-delete" => "强制删除",
            "tool-large-files" => "大文件查找",
            "tool-junk-cleaner" => "垃圾清理",
            "tool-dns-switch" => "DNS 快速切换",
            "tool-network-repair" => "断网急救箱",
            "tool-environment-variables" => "环境变量 / PATH",
            "tool-context-menu-manager" => "右键菜单管理",
            "tool-services-manager" => "系统服务管理",
            "tool-scheduled-tasks" => "计划任务管理",
            "tool-installed-apps" => "软件卸载管理",
            "tool-system-info" => "系统信息",
            "tool-windows-update" => "Windows 更新辅助",
            "tool-wsl-dashboard" => "WSL 管理面板",
            "tool-driver-manager" => "驱动管理",
            "tool-system-monitor" => "系统监控信息",
            "tool-github-store" => "GitHub Store",
            "tool-web-check" => "Web Check 网站体检",
            "tool-database-manager" => "数据库管理",
            "tool-prompt-library" => "AI Prompt 库",
            "tool-skills-library" => "AI Skills 库",
            "tool-mcp-library" => "MCP 管理工具",
            "tool-kiro-account-manager" => "Kiro 账号管理",
            "tool-calculator" => "计算器",
            "tool-pinyin" => "文字转拼音",
            "tool-text-prefix" => "批量添加前后缀",
            "tool-remove-linenum" => "去行号工具",
            "tool-url-extractor" => "URL 提取器",
            "tool-url-encode" => "URL 编解码",
            "tool-url-parser" => "URL 解析",
            "tool-base64" => "Base64 转换",
            "tool-line-processor" => "换行处理",
            "tool-text-formatter" => "一键排版",
            "tool-text-deduplicate" => "文本去重",
            "tool-case-converter" => "大小写转换",
            "tool-chinese-converter" => "简繁转换",
            "tool-text-batch-replace" => "批量替换",
            "tool-text-diff" => "文本比较",
            "tool-html-editor" => "HTML 编辑器",
            "tool-md-editor" => "Markdown 编辑器",
            "tool-color-assistant" => "颜色助手",
            "tool-json" => "JSON 工具箱",
            "tool-regex" => "正则表达式工具",
            "tool-random" => "随机生成器",
            "tool-timestamp" => "时间戳转换",
            "tool-hash" => "Hash 计算",
            "tool-jwt" => "JWT 解析",
            "tool-http-client" => "HTTP 请求",
            "tool-cron" => "Cron 表达式",
            "tool-sql" => "SQL 格式化",
            "tool-code-formatter" => "代码格式化",
            "tool-image-compress" => "图片压缩",
            "tool-image-batch-process" => "图片批量处理",
            "tool-image-crop" => "图片裁剪",
            "tool-image-resize" => "图片尺寸调整",
            "tool-image-transform" => "图片旋转翻转",
            "tool-image-filter" => "图片滤镜",
            "tool-image-watermark" => "图片水印",
            "tool-image-exif" => "EXIF 查看修改",
            "tool-image-convert" => "图片格式转换",
            "tool-image-ico-generator" => "ICO 生成器",
            "tool-image-bg-remove" => "AI 智能抠图",
            "tool-image-ai-upscale" => "AI 图像放大增强",
            "tool-image-watermark-remove" => "AI 智能去水印",
            "tool-image-magic-eraser" => "AI 智能擦除",
            "tool-video-player" => "视频播放器",
            "tool-music-player" => "音乐播放器",
            "tool-video-convert" => "视频格式转换",
            "tool-audio-convert" => "音频格式转换",
            "tool-video-compress" => "视频压缩",
            "tool-audio-compress" => "音频压缩",
            "tool-video-split" => "视频音频分离",
            "tool-video-watermark-remove" => "AI 去除视频水印",
            "tool-download-manager" => "多线程下载器",
            "tool-video-downloader" => "视频下载",
            "tool-tikhub-downloader" => "TikHub 下载",
            "tool-douyin-downloader" => "抖音下载",
            "tool-wx-channels-downloader" => "微信视频任务管理",
            "tool-gif-recorder" => "GIF 小工具",
            "tool-pdf-merge" => "PDF 合并",
            "tool-pdf-split" => "PDF 拆分",
            "tool-pdf-rotate" => "PDF 旋转",
            "tool-pdf-encrypt" => "PDF 加密/解密",
            "tool-pdf-watermark" => "PDF 水印",
            "tool-pdf-compress" => "PDF 压缩",
            "tool-pdf-to-image" => "PDF 转图片",
            "tool-image-to-pdf" => "图片转 PDF",
            "tool-pdf-delete-pages" => "PDF 删除页面",
            "tool-pdf-translate" => "AI PDF 格式翻译",
            "tool-pdf-word-ocr" => "PDF 转 Word",
            "tool-tencent-table-ocr" => "腾讯云 OCR 表格识别",
            "tool-tencent-bank-card-ocr" => "腾讯云 OCR 银行卡识别",
            "tool-tencent-general-invoice-ocr" => "腾讯云 OCR 通用票据识别",
            "tool-md-word-convert" => "Markdown / Word 互转",
            "tool-file-to-markdown" => "文件转 Markdown",
            "tool-md-ppt-convert" => "Markdown 转 PPT",
            "tool-epub-generator" => "EPUB 电子书生成器",
            "tool-draw-stamp" => "电子印章制作",
            "tool-local-speech-to-text" => "本地语音转文字",
            "tool-local-text-to-speech" => "本地文字转语音 TTS",
            "tool-local-speech-denoise" => "本地语音增强 / 降噪",
            "tool-local-vocal-separation" => "本地人声 / 伴奏分离",
            "tool-word-format" => "AI 文档智能整理",
            "tool-word-duplicate-check" => "AI 文档查重",
            "tool-word-semantic-compare" => "AI 双文档语义对比",
            "tool-word-semantic-search" => "AI 本地文档语义搜索",
            "tool-software-copyright" => "软著信息提取",
            _ => "工具",
        };

        let make_builder = || {
            WindowBuilder::new(&handle, &label_clone, WindowUrl::App("index.html".into()))
                .title(title)
                .inner_size(width, height)
                .resizable(resizable)
                .decorations(false)
                .transparent(transparent)
                .always_on_top(always_on_top)
                .center()
                .skip_taskbar(false)
        };

        let builder = match app_window_icon() {
            Ok(icon) => match make_builder().icon(icon) {
                Ok(builder) => builder,
                Err(e) => {
                    eprintln!("Failed to set tool window icon '{}': {}", label_clone, e);
                    make_builder()
                }
            },
            Err(e) => {
                eprintln!("Failed to load tool window icon '{}': {}", label_clone, e);
                make_builder()
            }
        };

        match builder.build() {
            Ok(window) => {
                apply_app_window_icon(&window);
                let _ = window.show();
                let _ = window.set_focus();
            }
            Err(e) => eprintln!("Failed to create tool window '{}': {}", label_clone, e),
        }
    });

    Ok(())
}

#[tauri::command]
pub fn set_auto_start(enabled: bool) -> Result<(), String> {
    use std::env;
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = hkcu
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            KEY_WRITE,
        )
        .map_err(|e| e.to_string())?;

    if enabled {
        let exe_path = env::current_exe()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string();
        run_key
            .set_value("McStartUP", &format!("\"{}\"", exe_path))
            .map_err(|e| e.to_string())?;
    } else {
        let _ = run_key.delete_value("McStartUP");
    }

    Ok(())
}

#[tauri::command]
pub fn set_context_menu(enabled: bool) -> Result<crate::context_menu::ContextMenuStatus, String> {
    if enabled {
        ContextMenuManager::register().map_err(|e| e.to_string())
    } else {
        ContextMenuManager::unregister().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn get_context_menu_status() -> Result<crate::context_menu::ContextMenuStatus, String> {
    ContextMenuManager::status().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn launcher_take_pending_add_request() -> Result<Option<serde_json::Value>, String> {
    let path = app_data_file("add_pending.json")?;
    if !path.exists() {
        return Ok(None);
    }
    let text =
        std::fs::read_to_string(&path).map_err(|e| format!("读取右键添加请求失败: {}", e))?;
    let _ = std::fs::remove_file(&path);
    let value = serde_json::from_str(&text).map_err(|e| format!("解析右键添加请求失败: {}", e))?;
    Ok(Some(value))
}

#[tauri::command]
pub fn validate_path(path: String, path_type: String) -> Result<bool, String> {
    let p = std::path::Path::new(&path);

    match path_type.as_str() {
        "folder" => Ok(p.exists() && p.is_dir()),
        "app" => Ok(p.exists() && p.is_file()),
        _ => Ok(true),
    }
}

#[tauri::command]
pub fn open_data_dir() -> Result<String, String> {
    let app_data = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    let data_dir = std::path::PathBuf::from(app_data).join("McStartUP");
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let dir_str = data_dir.to_string_lossy().to_string();
    std::process::Command::new("explorer")
        .arg(&dir_str)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(dir_str)
}

#[tauri::command]
pub fn detect_file_type(path: String) -> Result<String, String> {
    let p = std::path::Path::new(&path);

    if !p.exists() {
        return Ok("unknown".to_string());
    }

    if p.is_dir() {
        return Ok("folder".to_string());
    }

    if p.is_file() {
        if let Some(ext) = p.extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            match ext_str.as_str() {
                "exe" | "bat" | "cmd" | "ps1" | "lnk" => Ok("app".to_string()),
                _ => Ok("file".to_string()),
            }
        } else {
            Ok("file".to_string())
        }
    } else {
        Ok("unknown".to_string())
    }
}

struct RecoveredTarget {
    target_path: String,
    item_type: String,
    arguments: Option<String>,
}

/// 从注册表和 CMD 文件反向扫描，恢复丢失的数据
#[tauri::command]
pub fn recover_from_registry(state: State<AppState>) -> Result<Vec<LaunchItem>, String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let registry = state.registry.lock().unwrap();
    let batch_dir = registry.get_batch_dir().clone();
    drop(registry);

    let storage = state.storage.lock().unwrap();
    let config = storage.load().map_err(|e| e.to_string())?;

    let existing_aliases: std::collections::HashSet<String> =
        config.items.iter().map(|i| i.alias.clone()).collect();

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let app_paths = hkcu
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\App Paths")
        .map_err(|e| e.to_string())?;

    let mut recovered: Vec<LaunchItem> = Vec::new();

    for key_name in app_paths.enum_keys().flatten() {
        if !key_name.to_lowercase().ends_with(".exe") {
            continue;
        }

        let alias = key_name
            .trim_end_matches(".exe")
            .trim_end_matches(".EXE")
            .to_string();

        if existing_aliases.contains(&alias) {
            continue;
        }

        let sub_key = match app_paths.open_subkey(&key_name) {
            Ok(k) => k,
            Err(_) => continue,
        };

        let raw_path: String = match sub_key.get_value("") {
            Ok(v) => v,
            Err(_) => continue,
        };

        let managed_flag = sub_key.get_value::<u32, _>("McStartUP.Managed").ok();
        let stored_type = sub_key.get_value::<String, _>("McStartUP.Type").ok();
        let stored_target = sub_key.get_value::<String, _>("McStartUP.Target").ok();
        let stored_arguments = sub_key.get_value::<String, _>("McStartUP.Arguments").ok();
        let expected_cmd_path = batch_dir.join(format!("{}.cmd", alias));
        let expected_cmd_str = expected_cmd_path.to_string_lossy().to_string();

        let is_ours = managed_flag == Some(1)
            || raw_path.eq_ignore_ascii_case(&expected_cmd_str)
            || raw_path.to_lowercase().contains("\\mcstartup\\launchers\\");

        if !is_ours {
            continue;
        }

        let recovered_target = if raw_path.to_lowercase().ends_with(".cmd") {
            parse_cmd_file(&raw_path)
        } else {
            RecoveredTarget {
                target_path: stored_target.unwrap_or_else(|| raw_path.clone()),
                item_type: stored_type.unwrap_or_else(|| "app".to_string()),
                arguments: stored_arguments.filter(|args| !args.trim().is_empty()),
            }
        };

        if recovered_target.target_path.is_empty() {
            continue;
        }

        recovered.push(LaunchItem {
            id: Uuid::new_v4().to_string(),
            name: alias.clone(),
            alias: alias.clone(),
            target_path: recovered_target.target_path,
            item_type: Some(recovered_target.item_type),
            arguments: recovered_target.arguments,
            working_dir: None,
            env_vars: None,
            run_as_admin: false,
            startup_enabled: false,
            group_id: None,
            icon: None,
            description: Some("从注册表恢复".to_string()),
            hotkey: None,
            created_at: chrono::Utc::now().timestamp(),
            last_used: None,
            launch_count: Some(0),
            launch_profiles: None,
            script_show_window: None,
            script_content: None,
            script_type: None,
        });
    }

    Ok(recovered)
}

/// 解析 CMD 文件，提取目标路径、类型和参数
fn parse_cmd_file(cmd_path: &str) -> RecoveredTarget {
    let content = match std::fs::read(cmd_path) {
        Ok(bytes) => {
            let (decoded, _, _) = encoding_rs::GBK.decode(&bytes);
            decoded.into_owned()
        }
        Err(_) => {
            return RecoveredTarget {
                target_path: String::new(),
                item_type: "app".to_string(),
                arguments: None,
            };
        }
    };

    for line in content.lines() {
        let line = line.trim();

        // 新格式：CMD 调用 VBS 文件
        // @start /b wscript.exe //nologo "C:\...\alias.vbs" & exit
        if line.contains("wscript.exe") && line.contains(".vbs") {
            // 提取 VBS 文件路径
            if let Some(start) = line.find('"') {
                if let Some(end) = line[start + 1..].find('"') {
                    let vbs_path = &line[start + 1..start + 1 + end];
                    if let Ok(vbs_content) = std::fs::read_to_string(vbs_path) {
                        return parse_vbs_content(&vbs_content);
                    }
                }
            }
        }

        // 旧格式兼容：PowerShell Start-Process（URL）
        if line.contains("Start-Process") {
            if let Some(start) = line.find('\'') {
                if let Some(end) = line.rfind('\'') {
                    if end > start {
                        let url = line[start + 1..end].to_string();
                        if !url.is_empty() {
                            return RecoveredTarget {
                                target_path: url,
                                item_type: "url".to_string(),
                                arguments: None,
                            };
                        }
                    }
                }
            }
        }

        // 旧格式兼容：explorer（文件夹）
        if line.starts_with("explorer ") {
            let path = line
                .trim_start_matches("explorer ")
                .trim_matches('"')
                .to_string();
            if !path.is_empty() {
                return RecoveredTarget {
                    target_path: path,
                    item_type: "folder".to_string(),
                    arguments: None,
                };
            }
        }

        // 旧格式兼容：start ""（应用程序）
        if line.starts_with("start \"\"") {
            let rest = line.trim_start_matches("start \"\"").trim();
            if rest.starts_with('"') {
                if let Some(end) = rest[1..].find('"') {
                    let path = rest[1..end + 1].to_string();
                    if !path.is_empty() {
                        let args_part = rest[end + 2..].trim();
                        let args_part = args_part.strip_suffix("%*").unwrap_or(args_part).trim();

                        return RecoveredTarget {
                            target_path: path,
                            item_type: "app".to_string(),
                            arguments: if args_part.is_empty() {
                                None
                            } else {
                                Some(args_part.to_string())
                            },
                        };
                    }
                }
            }
        }
    }

    RecoveredTarget {
        target_path: String::new(),
        item_type: "app".to_string(),
        arguments: None,
    }
}

/// 解析 VBS 文件内容，提取目标路径和类型
fn parse_vbs_content(content: &str) -> RecoveredTarget {
    // VBS 格式示例：
    // URL:    CreateObject("WScript.Shell").Run "https://...", 1, False
    // Folder: CreateObject("WScript.Shell").Run "explorer.exe ""C:\path"" ", 1, False
    // App:    CreateObject("WScript.Shell").Run """C:\path\app.exe"" --args", 1, False

    for line in content.lines() {
        let line = line.trim();
        if !line.contains("WScript.Shell") || !line.contains(".Run ") {
            continue;
        }

        // 提取 .Run 后面的字符串
        if let Some(run_pos) = line.find(".Run ") {
            let after_run = &line[run_pos + 5..];
            // 找到第一个引号和最后一个引号之间的内容
            if let Some(start) = after_run.find('"') {
                // 找到 ", 1, False 之前的部分
                let inner = &after_run[start + 1..];
                if let Some(end) = inner.rfind("\", ") {
                    let command = &inner[..end];

                    if command.starts_with("http://") || command.starts_with("https://") {
                        return RecoveredTarget {
                            target_path: command.to_string(),
                            item_type: "url".to_string(),
                            arguments: None,
                        };
                    }

                    if command.starts_with("explorer.exe ") {
                        let path = command
                            .trim_start_matches("explorer.exe ")
                            .replace("\"\"", "\"")
                            .trim_matches('"')
                            .trim()
                            .to_string();
                        return RecoveredTarget {
                            target_path: path,
                            item_type: "folder".to_string(),
                            arguments: None,
                        };
                    }

                    // 应用程序："""C:\path\app.exe"" args"
                    let cleaned = command.replace("\"\"", "\x00"); // 临时替换转义引号
                    let cleaned = cleaned.trim_matches('\x00');
                    let parts: Vec<&str> = cleaned.splitn(2, '\x00').collect();
                    let exe_path = parts[0].replace('\x00', "\"");
                    let args = parts
                        .get(1)
                        .map(|a| a.replace('\x00', "\"").trim().to_string());

                    if !exe_path.is_empty() {
                        return RecoveredTarget {
                            target_path: exe_path,
                            item_type: "app".to_string(),
                            arguments: args.filter(|a| !a.is_empty()),
                        };
                    }
                }
            }
        }
    }

    RecoveredTarget {
        target_path: String::new(),
        item_type: "app".to_string(),
        arguments: None,
    }
}

/// 将恢复的数据保存到 config 并注册别名
#[tauri::command]
pub fn save_recovered_items(
    items: Vec<LaunchItem>,
    state: State<AppState>,
) -> Result<usize, String> {
    let storage = state.storage.lock().unwrap();
    let registry = state.registry.lock().unwrap();
    let mut config = storage.load().map_err(|e| e.to_string())?;

    let count = items.len();

    // 批量注册别名（不广播）
    for item in &items {
        let item_type = item.item_type.as_deref().unwrap_or("app");
        let _ = registry.register_alias_batch(
            &item.alias,
            &item.target_path,
            item.arguments.as_deref(),
            item_type,
        );
    }

    // 统一广播一次
    if count > 0 {
        registry.broadcast_app_paths_change();
    }

    config.items.extend(items);
    storage.save(&config).map_err(|e| e.to_string())?;

    // 更新别名缓存
    let snapshot = storage.build_alias_snapshot(&config);
    let cache = crate::storage::AliasCache {
        aliases: snapshot,
        last_updated: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    };
    let _ = storage.save_alias_cache(&cache);

    Ok(count)
}

/// 检查是否有可恢复的备份
#[tauri::command]
pub fn check_recoverable_backup() -> bool {
    crate::storage::Storage::has_recoverable_backup()
}

/// 列出所有备份文件
#[tauri::command]
pub fn list_backups() -> Result<Vec<(String, String)>, String> {
    crate::storage::Storage::list_backups().map_err(|e| e.to_string())
}

/// 从指定备份文件恢复
#[tauri::command]
pub fn restore_from_backup(
    path: String,
    app_handle: tauri::AppHandle,
    state: State<AppState>,
    ai_state: State<AiChatState>,
) -> Result<(), String> {
    let _ = import_config(path, app_handle, state, ai_state)?;
    Ok(())
}

/// 提取 EXE 文件图标，返回 base64 编码的 PNG 数据
#[tauri::command]
pub fn extract_icon(target_path: String, icon_size: Option<u32>) -> Result<Option<String>, String> {
    extract_icon_impl(&target_path, icon_size.unwrap_or(32).clamp(16, 256))
        .map_err(|e| e.to_string())
}

fn serialize_icon_data(icon_data: &IconData) -> String {
    let json = serde_json::json!({
        "width": icon_data.width,
        "height": icon_data.height,
        "data": base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &icon_data.rgba,
        ),
    });
    json.to_string()
}

fn hbitmap_to_icon_data(
    bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
) -> Result<Option<IconData>, anyhow::Error> {
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
        DIB_RGB_COLORS,
    };

    let mut native_bitmap: BITMAP = unsafe { std::mem::zeroed() };
    let got = unsafe {
        GetObjectW(
            bitmap,
            std::mem::size_of::<BITMAP>() as i32,
            Some((&mut native_bitmap as *mut BITMAP).cast()),
        )
    };
    if got == 0 || native_bitmap.bmWidth <= 0 || native_bitmap.bmHeight <= 0 {
        return Ok(None);
    }

    let width = native_bitmap.bmWidth as u32;
    let height = native_bitmap.bmHeight as u32;
    let hdc = unsafe { CreateCompatibleDC(None) };
    if hdc.0 == 0 {
        return Ok(None);
    }
    let mut bitmap_info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        ..Default::default()
    };
    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let lines = unsafe {
        GetDIBits(
            hdc,
            bitmap,
            0,
            height,
            Some(pixels.as_mut_ptr().cast()),
            &mut bitmap_info,
            DIB_RGB_COLORS,
        )
    };
    unsafe {
        let _ = DeleteDC(hdc);
    }
    if lines == 0 {
        return Ok(None);
    }

    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    Ok(Some(IconData {
        width,
        height,
        rgba: pixels,
    }))
}

fn extract_shell_item_icon(
    target_path: &str,
    requested_size: u32,
) -> Result<Option<IconData>, anyhow::Error> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{RPC_E_CHANGED_MODE, SIZE};
    use windows::Win32::Graphics::Gdi::DeleteObject;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
    };

    let init_result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let should_uninitialize = init_result.is_ok();
    if let Err(error) = &init_result {
        if error.code() != RPC_E_CHANGED_MODE {
            return Ok(None);
        }
    }

    let wide_path = std::ffi::OsStr::new(target_path)
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let result = (|| -> Result<Option<IconData>, anyhow::Error> {
        let factory: IShellItemImageFactory =
            unsafe { SHCreateItemFromParsingName(PCWSTR(wide_path.as_ptr()), None) }?;
        let bitmap = unsafe {
            factory.GetImage(
                SIZE {
                    cx: requested_size as i32,
                    cy: requested_size as i32,
                },
                SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
            )
        }?;
        let icon_data = hbitmap_to_icon_data(bitmap);
        unsafe {
            let _ = DeleteObject(bitmap);
        }
        icon_data
    })();

    if should_uninitialize {
        unsafe { CoUninitialize() };
    }
    result
}

fn extract_icon_impl(
    target_path: &str,
    requested_size: u32,
) -> Result<Option<String>, anyhow::Error> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    #[repr(C)]
    struct SHFILEINFOW {
        h_icon: isize,
        i_icon: i32,
        dw_attributes: u32,
        sz_display_name: [u16; 260],
        sz_type_name: [u16; 80],
    }

    #[link(name = "shell32")]
    extern "system" {
        fn SHGetFileInfoW(
            pszPath: *const u16,
            dwFileAttributes: u32,
            psfi: *mut SHFILEINFOW,
            cbFileInfo: u32,
            uFlags: u32,
        ) -> usize;
    }

    #[link(name = "user32")]
    extern "system" {
        fn DestroyIcon(hIcon: isize) -> i32;
        fn GetIconInfo(hIcon: isize, piconinfo: *mut ICONINFO) -> i32;
    }

    #[link(name = "gdi32")]
    extern "system" {
        fn GetDIBits(
            hdc: isize,
            hbm: isize,
            start: u32,
            cLines: u32,
            lpvBits: *mut u8,
            lpbmi: *mut BITMAPINFO,
            usage: u32,
        ) -> i32;
        fn CreateCompatibleDC(hdc: isize) -> isize;
        fn DeleteDC(hdc: isize) -> i32;
        fn DeleteObject(ho: isize) -> i32;
        fn GetObjectW(h: isize, c: i32, pv: *mut u8) -> i32;
    }

    #[repr(C)]
    struct ICONINFO {
        f_icon: i32,
        x_hotspot: u32,
        y_hotspot: u32,
        hbm_mask: isize,
        hbm_color: isize,
    }

    #[repr(C)]
    struct BITMAP {
        bm_type: i32,
        bm_width: i32,
        bm_height: i32,
        bm_width_bytes: i32,
        bm_planes: u16,
        bm_bits_pixel: u16,
        bm_bits: *mut u8,
    }

    impl Default for BITMAP {
        fn default() -> Self {
            Self {
                bm_type: 0,
                bm_width: 0,
                bm_height: 0,
                bm_width_bytes: 0,
                bm_planes: 0,
                bm_bits_pixel: 0,
                bm_bits: std::ptr::null_mut(),
            }
        }
    }

    #[repr(C)]
    struct BITMAPINFOHEADER {
        bi_size: u32,
        bi_width: i32,
        bi_height: i32,
        bi_planes: u16,
        bi_bit_count: u16,
        bi_compression: u32,
        bi_size_image: u32,
        bi_x_pels_per_meter: i32,
        bi_y_pels_per_meter: i32,
        bi_clr_used: u32,
        bi_clr_important: u32,
    }

    #[repr(C)]
    struct BITMAPINFO {
        bmi_header: BITMAPINFOHEADER,
        bmi_colors: [u32; 1],
    }

    const SHGFI_ICON: u32 = 0x000000100;
    const SHGFI_LARGEICON: u32 = 0x000000000;

    let wide_path: Vec<u16> = OsStr::new(target_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    if let Ok(Some(icon_data)) = extract_shell_item_icon(target_path, requested_size) {
        return Ok(Some(serialize_icon_data(&icon_data)));
    }

    let mut sfi = SHFILEINFOW {
        h_icon: 0,
        i_icon: 0,
        dw_attributes: 0,
        sz_display_name: [0u16; 260],
        sz_type_name: [0u16; 80],
    };

    let result = unsafe {
        SHGetFileInfoW(
            wide_path.as_ptr(),
            0,
            &mut sfi,
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };

    if result == 0 || sfi.h_icon == 0 {
        return Ok(None);
    }

    // 获取图标信息
    let mut icon_info = ICONINFO {
        f_icon: 0,
        x_hotspot: 0,
        y_hotspot: 0,
        hbm_mask: 0,
        hbm_color: 0,
    };

    let success = unsafe { GetIconInfo(sfi.h_icon, &mut icon_info) };
    if success == 0 || icon_info.hbm_color == 0 {
        unsafe { DestroyIcon(sfi.h_icon) };
        return Ok(None);
    }

    // 获取位图尺寸
    let mut bm = BITMAP::default();
    let got = unsafe {
        GetObjectW(
            icon_info.hbm_color,
            std::mem::size_of::<BITMAP>() as i32,
            &mut bm as *mut BITMAP as *mut u8,
        )
    };

    if got == 0 || bm.bm_width == 0 || bm.bm_height == 0 {
        unsafe {
            DeleteObject(icon_info.hbm_color);
            DeleteObject(icon_info.hbm_mask);
            DestroyIcon(sfi.h_icon);
        }
        return Ok(None);
    }

    let width = bm.bm_width as u32;
    let height = bm.bm_height as u32;

    // 获取像素数据
    let hdc = unsafe { CreateCompatibleDC(0) };
    let mut bmi = BITMAPINFO {
        bmi_header: BITMAPINFOHEADER {
            bi_size: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            bi_width: width as i32,
            bi_height: -(height as i32), // top-down
            bi_planes: 1,
            bi_bit_count: 32,
            bi_compression: 0, // BI_RGB
            bi_size_image: 0,
            bi_x_pels_per_meter: 0,
            bi_y_pels_per_meter: 0,
            bi_clr_used: 0,
            bi_clr_important: 0,
        },
        bmi_colors: [0],
    };

    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let lines = unsafe {
        GetDIBits(
            hdc,
            icon_info.hbm_color,
            0,
            height,
            pixels.as_mut_ptr(),
            &mut bmi,
            0, // DIB_RGB_COLORS
        )
    };

    unsafe {
        DeleteDC(hdc);
        DeleteObject(icon_info.hbm_color);
        DeleteObject(icon_info.hbm_mask);
        DestroyIcon(sfi.h_icon);
    }

    if lines == 0 {
        return Ok(None);
    }

    // BGRA -> RGBA 转换，并编码为简易 BMP 再转 base64
    // 使用简单的 BMP 格式（带 alpha）
    for chunk in pixels.chunks_exact_mut(4) {
        chunk.swap(0, 2); // B <-> R
    }

    // 编码为简易 PNG-like 格式：使用 BMP with BITMAPV4HEADER for alpha
    // 为简化，直接返回 raw RGBA 数据的 base64，前端用 canvas 渲染
    let icon_data = IconData {
        width,
        height,
        rgba: pixels,
    };

    Ok(Some(serialize_icon_data(&icon_data)))
}

struct IconData {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

#[cfg(all(test, windows))]
mod icon_extraction_tests {
    use super::*;

    #[test]
    fn shell_icon_extraction_returns_requested_high_resolution_image() {
        let explorer = std::env::var_os("WINDIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from(r"C:\Windows"))
            .join("explorer.exe");
        let encoded = extract_icon_impl(&explorer.to_string_lossy(), 96)
            .expect("extract Windows Explorer icon")
            .expect("Windows Explorer has a Shell icon");
        let parsed: serde_json::Value =
            serde_json::from_str(&encoded).expect("parse extracted icon payload");
        let width = parsed["width"].as_u64().expect("icon width");
        let height = parsed["height"].as_u64().expect("icon height");

        assert!(width >= 96, "expected width >= 96, got {width}");
        assert!(height >= 96, "expected height >= 96, got {height}");
    }
}

/// 扫描已安装程序（开始菜单快捷方式 + 桌面快捷方式）
#[tauri::command]
pub fn scan_installed_programs() -> Result<Vec<InstalledProgram>, String> {
    scan_installed_programs_impl().map_err(|e| e.to_string())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledProgram {
    pub name: String,
    pub target_path: String,
    pub icon_path: Option<String>,
    pub source: String, // "registry", "start_menu"
}

/// 从注册表 Uninstall 键读取已安装程序（与 HiBit Uninstaller 等工具相同的方式）
fn scan_installed_programs_impl() -> Result<Vec<InstalledProgram>, anyhow::Error> {
    use winreg::enums::*;
    use winreg::RegKey;

    let mut programs: Vec<InstalledProgram> = Vec::new();
    let mut seen_names: std::collections::HashSet<String> = std::collections::HashSet::new();

    // 三个注册表位置：64位程序、32位程序（WOW6432Node）、当前用户
    let registry_paths = [
        (
            HKEY_LOCAL_MACHINE,
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ),
        (
            HKEY_LOCAL_MACHINE,
            "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ),
        (
            HKEY_CURRENT_USER,
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ),
    ];

    for (hkey, path) in &registry_paths {
        let root = RegKey::predef(*hkey);
        let uninstall_key = match root.open_subkey_with_flags(path, KEY_READ) {
            Ok(k) => k,
            Err(_) => continue,
        };

        for key_name in uninstall_key.enum_keys().flatten() {
            let sub_key = match uninstall_key.open_subkey_with_flags(&key_name, KEY_READ) {
                Ok(k) => k,
                Err(_) => continue,
            };

            // 跳过系统组件和没有名称的条目
            let system_component: u32 = sub_key.get_value("SystemComponent").unwrap_or(0);
            if system_component == 1 {
                continue;
            }

            let display_name: String = match sub_key.get_value("DisplayName") {
                Ok(v) => v,
                Err(_) => continue,
            };

            if display_name.trim().is_empty() {
                continue;
            }

            // 跳过更新补丁
            let lower_name = display_name.to_lowercase();
            if lower_name.contains("update for")
                || lower_name.contains("hotfix")
                || lower_name.contains("security update")
                || lower_name.starts_with("kb")
            {
                continue;
            }

            // 去重（按名称）
            if seen_names.contains(&lower_name) {
                continue;
            }

            // 尝试获取 exe 路径：优先 DisplayIcon，其次 InstallLocation
            let exe_path = find_exe_path(&sub_key);

            if let Some(target_path) = exe_path {
                // 验证文件存在
                if !std::path::Path::new(&target_path).exists() {
                    continue;
                }

                seen_names.insert(lower_name);

                let icon_path: Option<String> = sub_key
                    .get_value::<String, _>("DisplayIcon")
                    .ok()
                    .map(|s| {
                        s.trim_matches('"')
                            .split(',')
                            .next()
                            .unwrap_or("")
                            .to_string()
                    })
                    .filter(|s| !s.is_empty());

                programs.push(InstalledProgram {
                    name: display_name.trim().to_string(),
                    target_path,
                    icon_path,
                    source: "registry".to_string(),
                });
            }
        }
    }

    programs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(programs)
}

/// 从注册表子键中提取 exe 路径
fn find_exe_path(sub_key: &winreg::RegKey) -> Option<String> {
    // 方法1：DisplayIcon 通常指向主 exe
    if let Ok(icon) = sub_key.get_value::<String, _>("DisplayIcon") {
        let icon_path = icon
            .trim_matches('"')
            .split(',')
            .next()
            .unwrap_or("")
            .trim()
            .to_string();

        if icon_path.to_lowercase().ends_with(".exe") && std::path::Path::new(&icon_path).exists() {
            return Some(icon_path);
        }
    }

    // 方法2：InstallLocation + 查找 exe
    if let Ok(install_loc) = sub_key.get_value::<String, _>("InstallLocation") {
        let install_dir = install_loc.trim_matches('"').trim();
        if !install_dir.is_empty() {
            let dir_path = std::path::Path::new(install_dir);
            if dir_path.exists() && dir_path.is_dir() {
                // 在安装目录根下查找 exe 文件（不递归）
                if let Ok(entries) = std::fs::read_dir(dir_path) {
                    let mut best_exe: Option<String> = None;
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() {
                            if let Some(ext) = path.extension() {
                                if ext.to_string_lossy().to_lowercase() == "exe" {
                                    let fname = path
                                        .file_name()
                                        .unwrap_or_default()
                                        .to_string_lossy()
                                        .to_lowercase();
                                    // 跳过卸载程序和辅助工具
                                    if fname.contains("uninstall")
                                        || fname.contains("uninst")
                                        || fname.contains("update")
                                        || fname.contains("crash")
                                        || fname.contains("helper")
                                    {
                                        continue;
                                    }
                                    let full = path.to_string_lossy().to_string();
                                    // 优先选择与目录名相似的 exe
                                    if best_exe.is_none() {
                                        best_exe = Some(full);
                                    }
                                }
                            }
                        }
                    }
                    if let Some(exe) = best_exe {
                        return Some(exe);
                    }
                }
            }
        }
    }

    None
}

/// 批量检测路径有效性
#[tauri::command]
pub fn validate_paths(items: Vec<PathCheckItem>) -> Vec<PathCheckResult> {
    items
        .into_iter()
        .map(|item| {
            let valid = if item.item_type == "url" {
                // URL 不检测文件系统
                true
            } else {
                let p = std::path::Path::new(&item.target_path);
                if p.is_absolute() {
                    p.exists()
                } else {
                    true // 相对路径（如 notepad.exe）假定有效
                }
            };
            PathCheckResult { id: item.id, valid }
        })
        .collect()
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathCheckItem {
    pub id: String,
    pub target_path: String,
    pub item_type: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PathCheckResult {
    pub id: String,
    pub valid: bool,
}

/// 批量启动一组项目
#[tauri::command]
pub fn launch_group(group_id: String, state: State<AppState>) -> Result<usize, String> {
    let storage = state.storage.lock().unwrap();
    let mut config = storage.load().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().timestamp();
    let mut launched = 0;

    // 收集要启动的项目索引
    let indices: Vec<usize> = config
        .items
        .iter()
        .enumerate()
        .filter(|(_, item)| item.group_id.as_ref() == Some(&group_id))
        .map(|(i, _)| i)
        .collect();

    for idx in &indices {
        let item = &config.items[*idx];
        if let Err(e) = launcher::launch_item(item) {
            eprintln!("Failed to launch {}: {}", item.name, e);
            continue;
        }
        launched += 1;
    }

    // 更新 last_used 和 launch_count
    for idx in &indices {
        config.items[*idx].last_used = Some(now);
        config.items[*idx].launch_count = Some(config.items[*idx].launch_count.unwrap_or(0) + 1);
    }

    storage.save(&config).map_err(|e| e.to_string())?;

    Ok(launched)
}

/// 增加使用次数（launch_item 已更新 last_used，这里额外提供 launch_count 字段）
#[tauri::command]
pub fn get_item_stats(state: State<AppState>) -> Result<Vec<ItemStats>, String> {
    let storage = state.storage.lock().unwrap();
    let config = storage.load().map_err(|e| e.to_string())?;

    let stats: Vec<ItemStats> = config
        .items
        .iter()
        .map(|item| ItemStats {
            id: item.id.clone(),
            last_used: item.last_used,
            launch_count: item.launch_count.unwrap_or(0),
        })
        .collect();

    Ok(stats)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemStats {
    pub id: String,
    pub last_used: Option<i64>,
    pub launch_count: u32,
}

/// 直接启动系统程序（不需要先导入到 McStartUP）
#[tauri::command]
pub fn launch_system_program(target_path: String) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let path = std::path::Path::new(&target_path);
    if !path.exists() {
        return Err(format!("程序不存在: {}", target_path));
    }

    std::process::Command::new("cmd")
        .creation_flags(CREATE_NO_WINDOW)
        .arg("/c")
        .arg("start")
        .arg("")
        .arg(&target_path)
        .spawn()
        .map_err(|e| format!("启动失败: {}", e))?;

    Ok(())
}

/// Everything 搜索状态
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EverythingStatus {
    pub available: bool,
    pub es_path: Option<String>,
    pub message: String,
    pub ipc_class: Option<String>,
    pub auto_started: bool,
}

/// 检测 Everything 是否可用（通过 IPC 直接连接，不依赖 es.exe）
#[tauri::command]
pub fn check_everything_status() -> EverythingStatus {
    use everything_ipc::IpcWindow;

    if let Some(status) = everything_ready_status(None, false) {
        return status;
    }

    let exe_path = find_everything_exe_path();
    if let Some(path) = exe_path.as_ref() {
        let _ = start_everything(path);
        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_millis(150));
            if let Some(status) = everything_ready_status(exe_path.clone(), true) {
                return status;
            }
        }
    }

    let ipc_window = IpcWindow::new();
    EverythingStatus {
        available: false,
        es_path: exe_path,
        ipc_class: ipc_window.as_ref().map(|window| window.class_name().to_string()),
        auto_started: false,
        message: match ipc_window {
            Some(window) => format!(
                "Everything IPC 窗口已找到但连接失败，请检查权限是否一致。（窗口：{}）",
                window.class_name()
            ),
            None => {
                "Everything IPC 暂不可用，未找到可自动启动的 Everything.exe。请确认 Everything 已安装并启动用户界面。"
                    .to_string()
            }
        },
    }
}

fn everything_ready_status(
    es_path: Option<String>,
    auto_started: bool,
) -> Option<EverythingStatus> {
    use everything_ipc::wm::EverythingClient;

    match EverythingClient::new() {
        Ok(client) => Some(EverythingStatus {
            available: true,
            es_path,
            message: if auto_started {
                "Everything 已自动启动并就绪".to_string()
            } else {
                "Everything 已就绪".to_string()
            },
            ipc_class: Some(client.class_name().to_string()),
            auto_started,
        }),
        Err(_) => None,
    }
}

fn start_everything(path: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    std::process::Command::new(path)
        .arg("-startup")
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn find_everything_exe_path() -> Option<String> {
    if let Some(path) = find_everything_from_registry() {
        return Some(path);
    }

    let candidates = [
        Some(r"C:\Program Files\Everything\Everything.exe".to_string()),
        Some(r"C:\Program Files (x86)\Everything\Everything.exe".to_string()),
        std::env::var("LOCALAPPDATA")
            .ok()
            .map(|dir| format!(r"{}\Programs\Everything\Everything.exe", dir)),
        std::env::var("APPDATA")
            .ok()
            .map(|dir| format!(r"{}\Everything\Everything.exe", dir)),
    ];

    candidates
        .into_iter()
        .flatten()
        .find(|path| std::path::Path::new(path).is_file())
}

fn find_everything_from_registry() -> Option<String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let registry_paths = [
        (
            HKEY_LOCAL_MACHINE,
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ),
        (
            HKEY_LOCAL_MACHINE,
            "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ),
        (
            HKEY_CURRENT_USER,
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ),
    ];

    for (hkey, path) in registry_paths {
        let root = RegKey::predef(hkey);
        let uninstall_key = match root.open_subkey_with_flags(path, KEY_READ) {
            Ok(key) => key,
            Err(_) => continue,
        };

        for key_name in uninstall_key.enum_keys().flatten() {
            let sub_key = match uninstall_key.open_subkey_with_flags(&key_name, KEY_READ) {
                Ok(key) => key,
                Err(_) => continue,
            };
            let display_name = sub_key
                .get_value::<String, _>("DisplayName")
                .unwrap_or_default();
            if !display_name.to_lowercase().contains("everything") {
                continue;
            }

            if let Some(path) = find_exe_path(&sub_key) {
                if path.to_lowercase().ends_with("everything.exe")
                    && std::path::Path::new(&path).is_file()
                {
                    return Some(path);
                }
            }
        }
    }

    None
}

/// Everything 搜索结果
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EverythingResult {
    pub name: String,
    pub full_path: String,
    pub is_folder: bool,
}

/// 通过 Everything IPC 搜索本地文件（直接与 Everything 进程通信，无需 es.exe）
#[tauri::command]
pub fn search_everything(
    query: String,
    max_results: Option<u32>,
) -> Result<Vec<EverythingResult>, String> {
    use everything_ipc::wm::{EverythingClient, RequestFlags};

    let client = EverythingClient::new()
        .map_err(|_| "Everything 未运行，请先启动 Everything。".to_string())?;

    let limit = max_results.unwrap_or(15);

    let list = client
        .query_wait(&query)
        .request_flags(RequestFlags::FileName | RequestFlags::Path | RequestFlags::Attributes)
        .max_results(limit)
        .call()
        .map_err(|e| format!("Everything 搜索失败: {}", e))?;

    let results: Vec<EverythingResult> = list
        .iter()
        .filter_map(|item| {
            let name = item.get_string(RequestFlags::FileName)?;
            let path_dir = item.get_str(RequestFlags::Path)?;
            let full_path = format!("{}\\{}", path_dir.display(), name);

            // FILE_ATTRIBUTE_DIRECTORY = 0x10
            let attrs = item.get_u32(RequestFlags::Attributes).unwrap_or(0);
            let is_folder = (attrs & 0x10) != 0;

            Some(EverythingResult {
                name,
                full_path,
                is_folder,
            })
        })
        .collect();

    Ok(results)
}

/// 打开文件或文件夹（通用，用于 Everything 搜索结果）
#[tauri::command]
pub fn open_path(target_path: String) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let path = std::path::Path::new(&target_path);

    if path.is_dir() {
        // 文件夹：用 explorer 打开
        std::process::Command::new("explorer")
            .arg(&target_path)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    } else if path.exists() {
        // 文件：用系统默认程序打开
        std::process::Command::new("cmd")
            .creation_flags(CREATE_NO_WINDOW)
            .arg("/c")
            .arg("start")
            .arg("")
            .arg(&target_path)
            .spawn()
            .map_err(|e| format!("打开文件失败: {}", e))?;
    } else {
        return Err(format!("路径不存在: {}", target_path));
    }

    Ok(())
}

// ===== 和风天气 =====

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherNow {
    pub obs_time: String,
    pub temp: String,
    pub feels_like: String,
    pub icon: String,
    pub text: String,
    pub wind360: String,
    pub wind_dir: String,
    pub wind_scale: String,
    pub wind_speed: String,
    pub humidity: String,
    pub precip: String,
    pub pressure: String,
    pub vis: String,
    pub cloud: String,
    pub dew: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherDaily {
    pub fx_date: String,
    pub sunrise: String,
    pub sunset: String,
    pub moonrise: String,
    pub moonset: String,
    pub moon_phase: String,
    pub moon_phase_icon: String,
    pub temp_max: String,
    pub temp_min: String,
    pub icon_day: String,
    pub text_day: String,
    pub icon_night: String,
    pub text_night: String,
    pub wind360_day: String,
    pub wind_dir_day: String,
    pub wind_scale_day: String,
    pub wind_speed_day: String,
    pub wind360_night: String,
    pub wind_dir_night: String,
    pub wind_scale_night: String,
    pub wind_speed_night: String,
    pub humidity: String,
    pub precip: String,
    pub pressure: String,
    pub vis: String,
    pub cloud: String,
    pub uv_index: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherResult {
    pub city_name: String,
    pub city_id: String,
    pub now: WeatherNow,
    pub daily: Vec<WeatherDaily>,
    pub update_time: String,
}

/// 查询天气（城市名 → 城市ID → 实时天气 + N天预报）
#[tauri::command]
pub fn query_weather(
    city: String,
    api_key: String,
    api_host: String,
    days: Option<u8>,
) -> Result<WeatherResult, String> {
    if api_key.trim().is_empty() {
        return Err("请先在设置 → 天气 中配置和风天气 API Key".to_string());
    }
    if api_host.trim().is_empty() {
        return Err("请先在设置 → 天气 中配置和风天气 API Host（在控制台-设置中查看）".to_string());
    }

    // 清理 host，去掉可能带的 https:// 前缀和末尾斜杠
    let host = api_host
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/');

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .gzip(true)
        .deflate(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    // 第一步：城市搜索（GeoAPI 也使用同一个 Host）
    let geo_url = format!(
        "https://{}/geo/v2/city/lookup?location={}&lang=zh",
        host,
        urlencoding_simple(&city)
    );

    let geo_text = client
        .get(&geo_url)
        .header("X-QW-Api-Key", api_key.trim())
        .send()
        .map_err(|e| format!("城市搜索请求失败: {}", e))?
        .text()
        .map_err(|e| format!("城市搜索读取响应失败: {}", e))?;

    if geo_text.trim().is_empty() {
        return Err("城市搜索返回空响应，请检查网络连接和 API Key 是否正确".to_string());
    }

    let geo_resp: serde_json::Value = serde_json::from_str(&geo_text).map_err(|e| {
        format!(
            "城市搜索响应解析失败: {} | 原始响应: {}",
            e,
            &geo_text[..geo_text.len().min(200)]
        )
    })?;

    let code = geo_resp["code"].as_str().unwrap_or("unknown");
    if code != "200" {
        return Err(match code {
            "401" => "API Key 无效，请检查设置中的和风天气 API Key".to_string(),
            "402" => "API Key 已超出调用次数限制".to_string(),
            "404" => format!("未找到城市：{}", city),
            _ => format!(
                "城市搜索失败，错误码: {} | 响应: {}",
                code,
                &geo_text[..geo_text.len().min(200)]
            ),
        });
    }

    let location = geo_resp["location"]
        .as_array()
        .and_then(|arr| arr.first())
        .ok_or_else(|| format!("未找到城市：{}", city))?;

    let city_id = location["id"].as_str().unwrap_or("").to_string();
    let city_name = location["name"].as_str().unwrap_or(&city).to_string();

    if city_id.is_empty() {
        return Err(format!("未找到城市：{}", city));
    }

    // 第二步：实时天气
    let now_url = format!(
        "https://{}/v7/weather/now?location={}&lang=zh&unit=m",
        host, city_id
    );

    let now_text = client
        .get(&now_url)
        .header("X-QW-Api-Key", api_key.trim())
        .send()
        .map_err(|e| format!("实时天气请求失败: {}", e))?
        .text()
        .map_err(|e| format!("实时天气读取响应失败: {}", e))?;

    if now_text.trim().is_empty() {
        return Err("实时天气返回空响应".to_string());
    }

    let now_resp: serde_json::Value = serde_json::from_str(&now_text).map_err(|e| {
        format!(
            "实时天气响应解析失败: {} | 原始: {}",
            e,
            &now_text[..now_text.len().min(200)]
        )
    })?;

    if now_resp["code"].as_str() != Some("200") {
        return Err(format!(
            "获取实时天气失败，错误码: {}",
            now_resp["code"].as_str().unwrap_or("unknown")
        ));
    }

    let now_data = &now_resp["now"];
    let now = WeatherNow {
        obs_time: now_data["obsTime"].as_str().unwrap_or("").to_string(),
        temp: now_data["temp"].as_str().unwrap_or("--").to_string(),
        feels_like: now_data["feelsLike"].as_str().unwrap_or("--").to_string(),
        icon: now_data["icon"].as_str().unwrap_or("").to_string(),
        text: now_data["text"].as_str().unwrap_or("").to_string(),
        wind360: now_data["wind360"].as_str().unwrap_or("").to_string(),
        wind_dir: now_data["windDir"].as_str().unwrap_or("").to_string(),
        wind_scale: now_data["windScale"].as_str().unwrap_or("").to_string(),
        wind_speed: now_data["windSpeed"].as_str().unwrap_or("").to_string(),
        humidity: now_data["humidity"].as_str().unwrap_or("").to_string(),
        precip: now_data["precip"].as_str().unwrap_or("").to_string(),
        pressure: now_data["pressure"].as_str().unwrap_or("").to_string(),
        vis: now_data["vis"].as_str().unwrap_or("").to_string(),
        cloud: now_data["cloud"].as_str().unwrap_or("").to_string(),
        dew: now_data["dew"].as_str().unwrap_or("").to_string(),
    };

    let update_time = now_resp["updateTime"].as_str().unwrap_or("").to_string();

    // 第三步：天气预报（支持 7/15/30 天）
    let forecast_days = match days.unwrap_or(7) {
        d if d <= 7 => "7d",
        d if d <= 15 => "15d",
        _ => "30d",
    };
    let daily_url = format!(
        "https://{}/v7/weather/{}?location={}&lang=zh&unit=m",
        host, forecast_days, city_id
    );

    let daily_text = client
        .get(&daily_url)
        .header("X-QW-Api-Key", api_key.trim())
        .send()
        .map_err(|e| format!("7天预报请求失败: {}", e))?
        .text()
        .map_err(|e| format!("7天预报读取响应失败: {}", e))?;

    if daily_text.trim().is_empty() {
        return Err("7天预报返回空响应".to_string());
    }

    let daily_resp: serde_json::Value = serde_json::from_str(&daily_text).map_err(|e| {
        format!(
            "7天预报响应解析失败: {} | 原始: {}",
            e,
            &daily_text[..daily_text.len().min(200)]
        )
    })?;

    let daily: Vec<WeatherDaily> = daily_resp["daily"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|d| WeatherDaily {
            fx_date: d["fxDate"].as_str().unwrap_or("").to_string(),
            sunrise: d["sunrise"].as_str().unwrap_or("").to_string(),
            sunset: d["sunset"].as_str().unwrap_or("").to_string(),
            moonrise: d["moonrise"].as_str().unwrap_or("").to_string(),
            moonset: d["moonset"].as_str().unwrap_or("").to_string(),
            moon_phase: d["moonPhase"].as_str().unwrap_or("").to_string(),
            moon_phase_icon: d["moonPhaseIcon"].as_str().unwrap_or("").to_string(),
            temp_max: d["tempMax"].as_str().unwrap_or("--").to_string(),
            temp_min: d["tempMin"].as_str().unwrap_or("--").to_string(),
            icon_day: d["iconDay"].as_str().unwrap_or("").to_string(),
            text_day: d["textDay"].as_str().unwrap_or("").to_string(),
            icon_night: d["iconNight"].as_str().unwrap_or("").to_string(),
            text_night: d["textNight"].as_str().unwrap_or("").to_string(),
            wind360_day: d["wind360Day"].as_str().unwrap_or("").to_string(),
            wind_dir_day: d["windDirDay"].as_str().unwrap_or("").to_string(),
            wind_scale_day: d["windScaleDay"].as_str().unwrap_or("").to_string(),
            wind_speed_day: d["windSpeedDay"].as_str().unwrap_or("").to_string(),
            wind360_night: d["wind360Night"].as_str().unwrap_or("").to_string(),
            wind_dir_night: d["windDirNight"].as_str().unwrap_or("").to_string(),
            wind_scale_night: d["windScaleNight"].as_str().unwrap_or("").to_string(),
            wind_speed_night: d["windSpeedNight"].as_str().unwrap_or("").to_string(),
            humidity: d["humidity"].as_str().unwrap_or("").to_string(),
            precip: d["precip"].as_str().unwrap_or("").to_string(),
            pressure: d["pressure"].as_str().unwrap_or("").to_string(),
            vis: d["vis"].as_str().unwrap_or("").to_string(),
            cloud: d["cloud"].as_str().unwrap_or("").to_string(),
            uv_index: d["uvIndex"].as_str().unwrap_or("").to_string(),
        })
        .collect();

    Ok(WeatherResult {
        city_name,
        city_id,
        now,
        daily,
        update_time,
    })
}

/// 简单的 URL 编码（只处理中文和常见特殊字符）
fn urlencoding_simple(s: &str) -> String {
    let mut encoded = String::new();
    for byte in s.bytes() {
        if byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_' || byte == b'.' {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{:02X}", byte));
        }
    }
    encoded
}

fn infer_favicon_mime(content_type: Option<&str>, url: &reqwest::Url) -> &'static str {
    let content_type = content_type.unwrap_or("").to_ascii_lowercase();
    if content_type.starts_with("image/") {
        if content_type.contains("svg") {
            return "image/svg+xml";
        }
        if content_type.contains("icon") || content_type.contains("x-icon") {
            return "image/x-icon";
        }
        if content_type.contains("jpeg") || content_type.contains("jpg") {
            return "image/jpeg";
        }
        if content_type.contains("png") {
            return "image/png";
        }
        if content_type.contains("gif") {
            return "image/gif";
        }
        if content_type.contains("webp") {
            return "image/webp";
        }
    }

    let path = url.path().to_ascii_lowercase();
    if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".ico") {
        "image/x-icon"
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        "image/jpeg"
    } else if path.ends_with(".gif") {
        "image/gif"
    } else if path.ends_with(".webp") {
        "image/webp"
    } else {
        "image/png"
    }
}

fn extract_link_attr(tag: &str, attr_name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let attr_name = attr_name.to_ascii_lowercase();
    let mut start = 0usize;

    while let Some(found) = lower[start..].find(&attr_name) {
        let idx = start + found;
        let prev = if idx == 0 {
            ' '
        } else {
            lower[..idx].chars().next_back().unwrap_or(' ')
        };
        if prev.is_ascii_alphanumeric() || prev == '-' || prev == '_' {
            start = idx + attr_name.len();
            continue;
        }

        let mut cursor = idx + attr_name.len();
        while let Some(ch) = tag[cursor..].chars().next() {
            if ch.is_whitespace() {
                cursor += ch.len_utf8();
            } else {
                break;
            }
        }

        if !tag[cursor..].starts_with('=') {
            start = idx + attr_name.len();
            continue;
        }
        cursor += 1;

        while let Some(ch) = tag[cursor..].chars().next() {
            if ch.is_whitespace() {
                cursor += ch.len_utf8();
            } else {
                break;
            }
        }

        let remainder = &tag[cursor..];
        let first = remainder.chars().next()?;
        if first == '"' || first == '\'' {
            let quote = first;
            let rest = &remainder[first.len_utf8()..];
            let end = rest.find(quote)?;
            return Some(rest[..end].trim().to_string());
        }

        let end = remainder
            .find(|ch: char| ch.is_whitespace() || ch == '>')
            .unwrap_or(remainder.len());
        return Some(remainder[..end].trim().to_string());
    }

    None
}

fn extract_favicon_candidates(html: &str, base_url: &reqwest::Url) -> Vec<reqwest::Url> {
    let mut results = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut cursor = 0usize;

    while let Some(found) = html[cursor..].find("<link") {
        let start = cursor + found;
        let Some(end_offset) = html[start..].find('>') else {
            break;
        };
        let end = start + end_offset + 1;
        let tag = &html[start..end];
        let lower = tag.to_ascii_lowercase();
        if lower.contains("icon") {
            if let Some(href) = extract_link_attr(tag, "href") {
                if let Ok(icon_url) = base_url.join(href.trim()) {
                    let icon = icon_url.to_string();
                    if seen.insert(icon) {
                        results.push(icon_url);
                    }
                }
            }
        }
        cursor = end;
    }

    for fallback in ["/favicon.ico", "/apple-touch-icon.png"] {
        if let Ok(url) = base_url.join(fallback) {
            let icon = url.to_string();
            if seen.insert(icon) {
                results.push(url);
            }
        }
    }

    results
}

fn build_generated_favicon_data_url(title: Option<&str>, site_url: &reqwest::Url) -> String {
    use base64::Engine;

    let host = site_url.host_str().unwrap_or("网站").replace("www.", "");
    let label_source = title
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or(&host);
    let glyph = label_source
        .chars()
        .find(|ch| !ch.is_whitespace())
        .unwrap_or('网')
        .to_uppercase()
        .collect::<String>();

    let hash = host.bytes().fold(0u32, |acc, byte| {
        acc.wrapping_mul(131).wrapping_add(byte as u32)
    });
    let hue = hash % 360;
    let accent = (hue + 36) % 360;
    let svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
<defs>
<linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
<stop offset="0%" stop-color="hsl({hue}, 78%, 58%)" />
<stop offset="100%" stop-color="hsl({accent}, 82%, 66%)" />
</linearGradient>
</defs>
<rect width="96" height="96" rx="24" fill="url(#g)" />
<text x="48" y="55" text-anchor="middle" font-family="Segoe UI, Microsoft YaHei, Arial, sans-serif" font-size="38" font-weight="700" fill="white">{glyph}</text>
</svg>"#
    );

    format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(svg.as_bytes())
    )
}

/// 获取网站图标并转成 data URL，获取失败时自动生成首字母图标
#[tauri::command]
pub fn fetch_website_favicon(url: String, title: Option<String>) -> Result<String, String> {
    use base64::Engine;
    use std::time::Duration;

    let normalized_url = if url.trim().is_empty() {
        return Err("网址不能为空".to_string());
    } else if url.contains("://") {
        url.trim().to_string()
    } else {
        format!("https://{}", url.trim())
    };

    let base_url =
        reqwest::Url::parse(&normalized_url).map_err(|e| format!("网址格式无效: {}", e))?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .connect_timeout(Duration::from_secs(3))
        .user_agent("McStartUP/1.0 WebsiteBookmarks")
        .build()
        .map_err(|e| format!("创建图标请求客户端失败: {}", e))?;

    let html = client
        .get(base_url.as_str())
        .send()
        .ok()
        .and_then(|response| response.text().ok())
        .unwrap_or_default();

    let candidates = extract_favicon_candidates(&html, &base_url);
    for candidate in candidates {
        let Ok(response) = client.get(candidate.clone()).send() else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string());
        let Ok(bytes) = response.bytes() else {
            continue;
        };
        if bytes.is_empty() {
            continue;
        }

        let mime = infer_favicon_mime(content_type.as_deref(), &candidate);
        return Ok(format!(
            "data:{};base64,{}",
            mime,
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ));
    }

    Ok(build_generated_favicon_data_url(
        title.as_deref(),
        &base_url,
    ))
}

/// 解析书签图标输入：支持 data URL、图片网址、普通网址（自动抓 favicon）
#[tauri::command]
pub fn resolve_bookmark_icon_source(
    input: String,
    title: Option<String>,
) -> Result<String, String> {
    use base64::Engine;
    use std::time::Duration;

    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("图标输入不能为空".to_string());
    }

    if trimmed.starts_with("data:image/") {
        return Ok(trimmed.to_string());
    }

    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("仅支持图片网址、网站网址或 data:image/base64".to_string());
    }

    let url = reqwest::Url::parse(trimmed).map_err(|e| format!("图标网址格式无效: {}", e))?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(6))
        .connect_timeout(Duration::from_secs(3))
        .user_agent("McStartUP/1.0 WebsiteBookmarks")
        .build()
        .map_err(|e| format!("创建图标请求客户端失败: {}", e))?;

    if let Ok(response) = client.get(url.clone()).send() {
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if response.status().is_success()
            && (content_type.starts_with("image/")
                || url
                    .path()
                    .rsplit('.')
                    .next()
                    .map(|ext| {
                        matches!(
                            ext.to_ascii_lowercase().as_str(),
                            "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "ico"
                        )
                    })
                    .unwrap_or(false))
        {
            let mime = infer_favicon_mime(Some(&content_type), &url);
            let bytes = response
                .bytes()
                .map_err(|e| format!("读取图标内容失败: {}", e))?;
            return Ok(format!(
                "data:{};base64,{}",
                mime,
                base64::engine::general_purpose::STANDARD.encode(bytes)
            ));
        }
    }

    fetch_website_favicon(trimmed.to_string(), title)
}

// ============ 工具数据存储 ============

/// 加载工具数据
#[tauri::command]
pub fn load_tool_data() -> Result<String, String> {
    use std::fs;
    use std::path::PathBuf;

    let app_data = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    let data_dir = PathBuf::from(app_data).join("McStartUP");
    let tool_data_path = data_dir.join("tool_data.json");

    if !tool_data_path.exists() {
        // 返回默认数据
        return Ok(r#"{"todo":{"tasks":[],"lastModified":""}}"#.to_string());
    }

    fs::read_to_string(&tool_data_path).map_err(|e| format!("读取工具数据失败: {}", e))
}

/// 保存工具数据
#[tauri::command]
pub fn save_tool_data(data: String) -> Result<(), String> {
    use std::fs;
    use std::path::PathBuf;

    let app_data = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    let data_dir = PathBuf::from(app_data).join("McStartUP");

    // 确保目录存在
    fs::create_dir_all(&data_dir).map_err(|e| format!("创建数据目录失败: {}", e))?;

    let tool_data_path = data_dir.join("tool_data.json");
    fs::write(&tool_data_path, data).map_err(|e| format!("保存工具数据失败: {}", e))
}

/// 读取本地文件内容供 AI 分析（限制大小，避免超出 token 限制）
#[tauri::command]
pub fn read_file_for_ai(path: String) -> Result<serde_json::Value, String> {
    use std::fs;
    use std::path::Path;

    let p = Path::new(&path);

    // 检查文件是否存在
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }

    // 只允许读取文件，不允许读取目录
    if p.is_dir() {
        return Err(format!("路径是目录，不是文件: {}", path));
    }

    // 获取文件大小
    let metadata = fs::metadata(p).map_err(|e| format!("无法读取文件信息: {}", e))?;
    let file_size = metadata.len();

    // 限制最大 500KB（约 50 万字符，足够大多数代码文件）
    const MAX_SIZE: u64 = 512 * 1024;
    if file_size > MAX_SIZE {
        return Err(format!(
            "文件过大（{}KB），超过 512KB 限制，请选择较小的文件",
            file_size / 1024
        ));
    }

    // 读取文件内容
    let content =
        fs::read_to_string(p).map_err(|e| format!("读取文件失败（可能是二进制文件）: {}", e))?;

    // 获取文件扩展名用于语言提示
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let file_name = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    Ok(serde_json::json!({
        "content": content,
        "fileName": file_name,
        "ext": ext,
        "sizeKb": file_size / 1024,
        "lines": content.lines().count(),
    }))
}

// ==================== 图片处理辅助 ====================

fn decode_base64_image(data: &str) -> Result<image::DynamicImage, String> {
    use base64::{engine::general_purpose, Engine};
    let raw = if let Some(pos) = data.find(',') {
        &data[pos + 1..]
    } else {
        data
    };
    let bytes = general_purpose::STANDARD
        .decode(raw)
        .map_err(|e| format!("base64解码失败: {}", e))?;
    image::load_from_memory(&bytes).map_err(|e| format!("图片加载失败: {}", e))
}

fn encode_base64_image(
    img: &image::DynamicImage,
    format: &str,
    quality: u8,
) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine};
    use image::ImageFormat;
    use std::io::Cursor;
    let mut buf = Vec::new();
    let q = quality.clamp(1, 100);
    match format {
        "jpeg" | "jpg" => {
            let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, q);
            img.write_with_encoder(enc)
                .map_err(|e| format!("JPEG编码失败: {}", e))?;
        }
        "webp" => {
            img.write_to(&mut Cursor::new(&mut buf), ImageFormat::WebP)
                .map_err(|e| format!("WebP编码失败: {}", e))?;
        }
        "bmp" => {
            img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Bmp)
                .map_err(|e| format!("BMP编码失败: {}", e))?;
        }
        "tiff" => {
            img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Tiff)
                .map_err(|e| format!("TIFF编码失败: {}", e))?;
        }
        "ico" => {
            img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Ico)
                .map_err(|e| format!("ICO编码失败: {}", e))?;
        }
        _ => {
            use image::codecs::png::{CompressionType, FilterType, PngEncoder};
            let enc =
                PngEncoder::new_with_quality(&mut buf, CompressionType::Best, FilterType::Adaptive);
            img.write_with_encoder(enc)
                .map_err(|e| format!("PNG编码失败: {}", e))?;
        }
    }
    let mime = match format {
        "jpeg" | "jpg" => "image/jpeg",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "tiff" => "image/tiff",
        "ico" => "image/x-icon",
        _ => "image/png",
    };
    Ok(format!(
        "data:{};base64,{}",
        mime,
        general_purpose::STANDARD.encode(&buf)
    ))
}

// ==================== 图片压缩 ====================

#[tauri::command]
pub fn image_compress(data: String, format: String, quality: u8) -> Result<String, String> {
    let img = decode_base64_image(&data)?;
    encode_base64_image(&img, &format, quality)
}

/// 高级压缩：支持更多格式、尺寸限制，返回 {data, size, width, height}
/// 核心逻辑：压缩后与原始字节比较，取更小的那个
#[tauri::command]
pub fn image_compress_advanced(
    data: String,
    format: String,
    quality: u8,
    max_width: Option<u32>,
    max_height: Option<u32>,
) -> Result<serde_json::Value, String> {
    use base64::{engine::general_purpose, Engine};
    use image::imageops::FilterType;

    // 解码原始字节（用于大小比较）
    let raw_input = if let Some(pos) = data.find(',') {
        &data[pos + 1..]
    } else {
        &data
    };
    let orig_bytes = general_purpose::STANDARD
        .decode(raw_input)
        .map_err(|e| format!("base64解码失败: {}", e))?;
    let orig_size = orig_bytes.len();

    let mut img =
        image::load_from_memory(&orig_bytes).map_err(|e| format!("图片加载失败: {}", e))?;

    let needs_resize = match (max_width, max_height) {
        (Some(mw), Some(mh)) => img.width() > mw || img.height() > mh,
        (Some(mw), None) => img.width() > mw,
        (None, Some(mh)) => img.height() > mh,
        _ => false,
    };

    if needs_resize {
        img = match (max_width, max_height) {
            (Some(mw), Some(mh)) => img.resize(mw, mh, FilterType::Lanczos3),
            (Some(mw), None) => img.resize(mw, u32::MAX, FilterType::Lanczos3),
            (None, Some(mh)) => img.resize(u32::MAX, mh, FilterType::Lanczos3),
            _ => img,
        };
    }

    let w = img.width();
    let h = img.height();

    // 编码为目标格式
    let mut buf = Vec::new();
    let q = quality.clamp(1, 100);
    match format.as_str() {
        "jpeg" | "jpg" => {
            let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, q);
            img.write_with_encoder(enc)
                .map_err(|e| format!("JPEG编码失败: {}", e))?;
        }
        "webp" => {
            use std::io::Cursor;
            img.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::WebP)
                .map_err(|e| format!("WebP编码失败: {}", e))?;
        }
        "bmp" => {
            use std::io::Cursor;
            img.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Bmp)
                .map_err(|e| format!("BMP编码失败: {}", e))?;
        }
        "tiff" => {
            use std::io::Cursor;
            img.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Tiff)
                .map_err(|e| format!("TIFF编码失败: {}", e))?;
        }
        _ => {
            use image::codecs::png::{CompressionType, FilterType as PngFilter, PngEncoder};
            let enc =
                PngEncoder::new_with_quality(&mut buf, CompressionType::Best, PngFilter::Adaptive);
            img.write_with_encoder(enc)
                .map_err(|e| format!("PNG编码失败: {}", e))?;

            // oxipng 无损二次优化（level 3：速度和压缩率的平衡点）
            let opts = oxipng::Options::from_preset(3);
            if let Ok(optimized) = oxipng::optimize_from_memory(&buf, &opts) {
                buf = optimized;
            }
        }
    }

    // 关键：如果没有 resize 且压缩后比原图大，直接返回原始数据
    // 这才是正确行为：压缩的目的是减小体积，变大了就没意义
    // 提前检测原始格式（在 orig_bytes 被移动前）
    let orig_mime_detected = if orig_bytes.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else if orig_bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "image/png"
    } else if orig_bytes.starts_with(b"RIFF") {
        "image/webp"
    } else {
        ""
    };

    let (final_bytes, final_size, enlarged) = if !needs_resize && buf.len() >= orig_size {
        (orig_bytes, orig_size, true)
    } else {
        let sz = buf.len();
        (buf, sz, false)
    };

    let mime = match format.as_str() {
        "jpeg" | "jpg" => "image/jpeg",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "tiff" => "image/tiff",
        _ => "image/png",
    };

    // 如果用了原始数据，mime 也用原始的
    let (out_data, out_mime) = if enlarged {
        let orig_mime = if !orig_mime_detected.is_empty() {
            orig_mime_detected
        } else {
            mime
        };
        (
            format!(
                "data:{};base64,{}",
                orig_mime,
                general_purpose::STANDARD.encode(&final_bytes)
            ),
            orig_mime,
        )
    } else {
        (
            format!(
                "data:{};base64,{}",
                mime,
                general_purpose::STANDARD.encode(&final_bytes)
            ),
            mime,
        )
    };

    Ok(serde_json::json!({
        "data": out_data,
        "size": final_size,
        "width": w,
        "height": h,
        "enlarged": enlarged,
        "mime": out_mime,
    }))
}

// ==================== 图片裁剪 ====================

#[tauri::command]
pub fn image_crop(data: String, x: u32, y: u32, w: u32, h: u32) -> Result<String, String> {
    let mut img = decode_base64_image(&data)?;
    let iw = img.width();
    let ih = img.height();
    let x = x.min(iw.saturating_sub(1));
    let y = y.min(ih.saturating_sub(1));
    let w = w.min(iw - x);
    let h = h.min(ih - y);
    if w == 0 || h == 0 {
        return Err("裁剪区域无效".to_string());
    }
    let cropped = image::imageops::crop(&mut img, x, y, w, h).to_image();
    let result = image::DynamicImage::ImageRgba8(cropped);
    encode_base64_image(&result, "png", 100)
}

// ==================== 图片尺寸调整 ====================

#[tauri::command]
pub fn image_resize(data: String, width: u32, height: u32) -> Result<String, String> {
    let img = decode_base64_image(&data)?;
    let resized = img.resize_exact(width, height, image::imageops::FilterType::Lanczos3);
    encode_base64_image(&resized, "png", 100)
}

// ==================== 图片变换（旋转/翻转） ====================

#[tauri::command]
pub fn image_transform(data: String, op: String) -> Result<String, String> {
    let img = decode_base64_image(&data)?;
    let result = match op.as_str() {
        "rotate90" => img.rotate90(),
        "rotate180" => img.rotate180(),
        "rotate270" => img.rotate270(),
        "flipH" => img.fliph(),
        "flipV" => img.flipv(),
        _ => return Err(format!("不支持的操作: {}", op)),
    };
    encode_base64_image(&result, "png", 100)
}

// ==================== 图片滤镜 ====================

#[tauri::command]
pub fn image_filter(
    data: String,
    grayscale: bool,
    invert: bool,
    brightness: i32, // -100 ~ 100
    contrast: f32,   // 0.0 ~ 3.0，1.0 为原始
    blur: f32,       // 0.0 ~ 20.0
    unsharpen: f32,  // 0.0 ~ 5.0
) -> Result<String, String> {
    let mut img = decode_base64_image(&data)?;
    if grayscale {
        img = img.grayscale();
    }
    if invert {
        img.invert();
    }
    if brightness != 0 {
        img = img.brighten(brightness);
    }
    if contrast != 0.0 {
        img = img.adjust_contrast(contrast);
    }
    if blur > 0.0 {
        img = img.blur(blur);
    }
    if unsharpen > 0.0 {
        img = img.unsharpen(unsharpen, 1);
    }
    encode_base64_image(&img, "png", 100)
}

// ==================== EXIF 读取 ====================

#[tauri::command]
pub fn image_read_exif(data: String) -> Result<serde_json::Value, String> {
    use base64::{engine::general_purpose, Engine};
    use exif::Tag;
    use std::io::Cursor;

    let raw = if let Some(pos) = data.find(',') {
        &data[pos + 1..]
    } else {
        &data
    };
    let bytes = general_purpose::STANDARD
        .decode(raw)
        .map_err(|e| format!("base64解码失败: {}", e))?;

    let mut warnings = Vec::new();
    let format = image::guess_format(&bytes).ok();
    let image_info = match image::load_from_memory(&bytes) {
        Ok(img) => {
            let color = img.color();
            let width = img.width();
            let height = img.height();
            let megapixels = (width as f64 * height as f64) / 1_000_000.0;
            Some(serde_json::json!({
                "format": format.and_then(image_format_name).unwrap_or("未知格式"),
                "mime": format.and_then(image_format_mime).unwrap_or("application/octet-stream"),
                "width": width,
                "height": height,
                "megapixels": round_f64(megapixels, 2),
                "colorType": color_type_label(color),
                "colorTypeRaw": format!("{:?}", color),
                "bitsPerPixel": color.bits_per_pixel(),
                "channelCount": color.channel_count(),
                "hasAlpha": color.has_alpha(),
                "fileSize": bytes.len(),
            }))
        }
        Err(e) => {
            warnings.push(format!("图片基础信息读取失败: {}", e));
            None
        }
    };

    let mut fields = Vec::new();
    let exif_result = exif::Reader::new().read_from_container(&mut Cursor::new(&bytes));
    let mut summary = Vec::new();
    let mut gps = serde_json::Value::Null;

    match exif_result {
        Ok(exif) => {
            if let Some(info) = image_info.as_ref() {
                push_summary(
                    &mut summary,
                    "图片格式",
                    info.get("format")
                        .and_then(|v| v.as_str())
                        .unwrap_or("未知格式"),
                    "图片信息",
                    "image",
                    false,
                );
                if let (Some(width), Some(height)) = (
                    info.get("width").and_then(|v| v.as_u64()),
                    info.get("height").and_then(|v| v.as_u64()),
                ) {
                    push_summary(
                        &mut summary,
                        "实际像素",
                        &format!("{} x {} px", width, height),
                        "图片信息",
                        "image",
                        false,
                    );
                }
                if let Some(color_type) = info.get("colorType").and_then(|v| v.as_str()) {
                    push_summary(
                        &mut summary,
                        "颜色类型",
                        color_type,
                        "图片信息",
                        "image",
                        false,
                    );
                }
            }

            if let Some(orientation) = exif_uint(&exif, Tag::Orientation) {
                let orientation_label = orientation_label(orientation);
                push_summary(
                    &mut summary,
                    "方向",
                    &format!("{} ({})", orientation_label, orientation),
                    "图片信息",
                    "Orientation",
                    false,
                );
                if matches!(orientation, 5 | 6 | 7 | 8) {
                    if let Some(info) = image_info.as_ref() {
                        if let (Some(width), Some(height)) = (
                            info.get("width").and_then(|v| v.as_u64()),
                            info.get("height").and_then(|v| v.as_u64()),
                        ) {
                            push_summary(
                                &mut summary,
                                "按方向显示",
                                &format!("{} x {} px", height, width),
                                "图片信息",
                                "Orientation",
                                false,
                            );
                        }
                    }
                }
            }

            for (tag, label, group) in [
                (Tag::Make, "设备厂商", "相机信息"),
                (Tag::Model, "设备型号", "相机信息"),
                (Tag::LensMake, "镜头厂商", "相机信息"),
                (Tag::LensModel, "镜头型号", "相机信息"),
                (Tag::Software, "处理软件", "相机信息"),
                (Tag::BodySerialNumber, "机身序列号", "相机信息"),
                (Tag::DateTimeOriginal, "拍摄时间", "时间信息"),
                (Tag::OffsetTimeOriginal, "拍摄时区", "时间信息"),
                (Tag::DateTimeDigitized, "数字化时间", "时间信息"),
                (Tag::DateTime, "文件时间", "时间信息"),
                (Tag::ExposureTime, "快门速度", "拍摄参数"),
                (Tag::FNumber, "光圈", "拍摄参数"),
                (Tag::PhotographicSensitivity, "ISO", "拍摄参数"),
                (Tag::ISOSpeed, "ISO 速度", "拍摄参数"),
                (Tag::FocalLength, "焦距", "拍摄参数"),
                (Tag::FocalLengthIn35mmFilm, "等效焦距", "拍摄参数"),
                (Tag::ExposureBiasValue, "曝光补偿", "拍摄参数"),
                (Tag::ExposureProgram, "曝光程序", "拍摄参数"),
                (Tag::MeteringMode, "测光模式", "拍摄参数"),
                (Tag::WhiteBalance, "白平衡", "拍摄参数"),
                (Tag::Flash, "闪光灯", "拍摄参数"),
                (Tag::ColorSpace, "色彩空间", "图片信息"),
                (Tag::XResolution, "水平分辨率", "图片信息"),
                (Tag::YResolution, "垂直分辨率", "图片信息"),
                (Tag::ResolutionUnit, "分辨率单位", "图片信息"),
                (Tag::ExifVersion, "EXIF 版本", "其他"),
                (Tag::Artist, "作者", "其他"),
                (Tag::Copyright, "版权", "其他"),
                (Tag::ImageDescription, "图片描述", "其他"),
                (Tag::UserComment, "用户备注", "其他"),
            ] {
                if let Some(value) = exif_display(&exif, tag) {
                    push_summary(
                        &mut summary,
                        label,
                        &value,
                        group,
                        &tag.to_string(),
                        is_privacy_tag(tag),
                    );
                }
            }

            if let (Some(latitude), Some(longitude)) = (
                exif_gps_coordinate(&exif, Tag::GPSLatitude, Tag::GPSLatitudeRef),
                exif_gps_coordinate(&exif, Tag::GPSLongitude, Tag::GPSLongitudeRef),
            ) {
                let altitude = exif_gps_altitude(&exif);
                let map_url = format!(
                    "https://maps.google.com/?q={:.8},{:.8}",
                    latitude, longitude
                );
                gps = serde_json::json!({
                    "latitude": round_f64(latitude, 8),
                    "longitude": round_f64(longitude, 8),
                    "altitude": altitude.map(|v| round_f64(v, 2)),
                    "display": match altitude {
                        Some(alt) => format!("{:.6}, {:.6} ({:.2} m)", latitude, longitude, alt),
                        None => format!("{:.6}, {:.6}", latitude, longitude),
                    },
                    "mapUrl": map_url,
                });
                push_summary(
                    &mut summary,
                    "GPS 坐标",
                    gps.get("display").and_then(|v| v.as_str()).unwrap_or(""),
                    "GPS 位置",
                    "GPS",
                    true,
                );
            }
            if let Some(gps_time) = exif_gps_datetime(&exif) {
                push_summary(
                    &mut summary,
                    "GPS 时间",
                    &gps_time,
                    "GPS 位置",
                    "GPSDateTime",
                    true,
                );
            }

            for f in exif.fields() {
                let tag = format!("{}", f.tag);
                let context = format!("{:?}", f.tag.context());
                let value = format!("{}", f.display_value().with_unit(&exif));
                let mut field = serde_json::json!({
                    "tag": tag,
                    "label": exif_tag_label(f.tag),
                    "value": value,
                    "rawValue": exif_raw_value_json(&f.value),
                    "rawText": exif_raw_value_text(&f.value),
                    "valueType": exif_value_type(&f.value),
                    "ifd": f.ifd_num.to_string(),
                    "context": context,
                    "code": format!("0x{:04X}", f.tag.number()),
                    "group": exif_tag_group(f.tag),
                    "privacy": is_privacy_tag(f.tag),
                });
                if f.tag == Tag::GPSLatitude {
                    if let Some(value) =
                        exif_gps_coordinate(&exif, Tag::GPSLatitude, Tag::GPSLatitudeRef)
                    {
                        field["normalizedValue"] = serde_json::json!(round_f64(value, 8));
                    }
                } else if f.tag == Tag::GPSLongitude {
                    if let Some(value) =
                        exif_gps_coordinate(&exif, Tag::GPSLongitude, Tag::GPSLongitudeRef)
                    {
                        field["normalizedValue"] = serde_json::json!(round_f64(value, 8));
                    }
                } else if f.tag == Tag::GPSAltitude {
                    if let Some(value) = exif_gps_altitude(&exif) {
                        field["normalizedValue"] = serde_json::json!(round_f64(value, 2));
                    }
                } else if f.tag == Tag::Orientation {
                    if let Some(value) = f.value.get_uint(0) {
                        field["normalizedValue"] = serde_json::json!(orientation_label(value));
                    }
                }
                fields.push(field);
            }
        }
        Err(e) => {
            warnings.push(format!("未检测到可读取的 EXIF 元数据: {}", e));
            if let Some(info) = image_info.as_ref() {
                push_summary(
                    &mut summary,
                    "图片格式",
                    info.get("format")
                        .and_then(|v| v.as_str())
                        .unwrap_or("未知格式"),
                    "图片信息",
                    "image",
                    false,
                );
                if let (Some(width), Some(height)) = (
                    info.get("width").and_then(|v| v.as_u64()),
                    info.get("height").and_then(|v| v.as_u64()),
                ) {
                    push_summary(
                        &mut summary,
                        "实际像素",
                        &format!("{} x {} px", width, height),
                        "图片信息",
                        "image",
                        false,
                    );
                }
                if let Some(color_type) = info.get("colorType").and_then(|v| v.as_str()) {
                    push_summary(
                        &mut summary,
                        "颜色类型",
                        color_type,
                        "图片信息",
                        "image",
                        false,
                    );
                }
            }
        }
    }

    Ok(serde_json::json!({
        "image": image_info,
        "summary": summary,
        "fields": fields,
        "gps": gps,
        "warnings": warnings,
    }))
}

fn image_format_name(format: image::ImageFormat) -> Option<&'static str> {
    Some(match format {
        image::ImageFormat::Png => "PNG",
        image::ImageFormat::Jpeg => "JPEG",
        image::ImageFormat::Gif => "GIF",
        image::ImageFormat::WebP => "WebP",
        image::ImageFormat::Pnm => "PNM",
        image::ImageFormat::Tiff => "TIFF",
        image::ImageFormat::Tga => "TGA",
        image::ImageFormat::Dds => "DDS",
        image::ImageFormat::Bmp => "BMP",
        image::ImageFormat::Ico => "ICO",
        image::ImageFormat::Hdr => "HDR",
        image::ImageFormat::OpenExr => "OpenEXR",
        image::ImageFormat::Farbfeld => "Farbfeld",
        image::ImageFormat::Avif => "AVIF",
        image::ImageFormat::Qoi => "QOI",
        _ => return None,
    })
}

fn image_format_mime(format: image::ImageFormat) -> Option<&'static str> {
    Some(match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::Gif => "image/gif",
        image::ImageFormat::WebP => "image/webp",
        image::ImageFormat::Tiff => "image/tiff",
        image::ImageFormat::Tga => "image/x-tga",
        image::ImageFormat::Bmp => "image/bmp",
        image::ImageFormat::Ico => "image/x-icon",
        image::ImageFormat::Hdr => "image/vnd.radiance",
        image::ImageFormat::OpenExr => "image/x-exr",
        image::ImageFormat::Avif => "image/avif",
        image::ImageFormat::Qoi => "image/qoi",
        _ => return None,
    })
}

fn color_type_label(color: image::ColorType) -> &'static str {
    match color {
        image::ColorType::L8 => "灰度 8-bit",
        image::ColorType::La8 => "灰度 + Alpha 8-bit",
        image::ColorType::Rgb8 => "RGB 8-bit",
        image::ColorType::Rgba8 => "RGBA 8-bit",
        image::ColorType::L16 => "灰度 16-bit",
        image::ColorType::La16 => "灰度 + Alpha 16-bit",
        image::ColorType::Rgb16 => "RGB 16-bit",
        image::ColorType::Rgba16 => "RGBA 16-bit",
        image::ColorType::Rgb32F => "RGB 32-bit float",
        image::ColorType::Rgba32F => "RGBA 32-bit float",
        _ => "未知颜色类型",
    }
}

fn round_f64(value: f64, digits: i32) -> f64 {
    let factor = 10_f64.powi(digits);
    (value * factor).round() / factor
}

fn push_summary(
    summary: &mut Vec<serde_json::Value>,
    label: &str,
    value: &str,
    group: &str,
    source: &str,
    privacy: bool,
) {
    if value.trim().is_empty() {
        return;
    }
    if summary
        .iter()
        .any(|item| item.get("label").and_then(|v| v.as_str()) == Some(label))
    {
        return;
    }
    summary.push(serde_json::json!({
        "label": label,
        "value": value,
        "group": group,
        "source": source,
        "privacy": privacy,
    }));
}

fn exif_display(exif: &exif::Exif, tag: exif::Tag) -> Option<String> {
    exif.get_field(tag, exif::In::PRIMARY)
        .map(|field| field.display_value().with_unit(exif).to_string())
        .filter(|value| !value.trim().is_empty())
}

fn exif_uint(exif: &exif::Exif, tag: exif::Tag) -> Option<u32> {
    exif.get_field(tag, exif::In::PRIMARY)
        .and_then(|field| field.value.get_uint(0))
}

fn exif_ascii(exif: &exif::Exif, tag: exif::Tag) -> Option<String> {
    exif.get_field(tag, exif::In::PRIMARY)
        .and_then(|field| match &field.value {
            exif::Value::Ascii(values) => values.first().map(|value| ascii_bytes_to_string(value)),
            _ => None,
        })
}

fn exif_gps_coordinate(exif: &exif::Exif, coord_tag: exif::Tag, ref_tag: exif::Tag) -> Option<f64> {
    let coord = exif
        .get_field(coord_tag, exif::In::PRIMARY)
        .and_then(|field| match &field.value {
            exif::Value::Rational(values) if values.len() >= 3 => Some(values),
            _ => None,
        })?;
    let degrees = rational_to_f64(coord[0].num as f64, coord[0].denom as f64)?;
    let minutes = rational_to_f64(coord[1].num as f64, coord[1].denom as f64)?;
    let seconds = rational_to_f64(coord[2].num as f64, coord[2].denom as f64)?;
    let mut decimal = degrees + minutes / 60.0 + seconds / 3600.0;
    let reference = exif_ascii(exif, ref_tag)
        .unwrap_or_default()
        .to_ascii_uppercase();
    if reference.starts_with('S') || reference.starts_with('W') {
        decimal = -decimal;
    }
    Some(decimal)
}

fn exif_gps_altitude(exif: &exif::Exif) -> Option<f64> {
    let mut altitude = exif
        .get_field(exif::Tag::GPSAltitude, exif::In::PRIMARY)
        .and_then(|field| match &field.value {
            exif::Value::Rational(values) => values.first(),
            _ => None,
        })
        .and_then(|value| rational_to_f64(value.num as f64, value.denom as f64))?;
    if exif_uint(exif, exif::Tag::GPSAltitudeRef) == Some(1) {
        altitude = -altitude;
    }
    Some(altitude)
}

fn exif_gps_datetime(exif: &exif::Exif) -> Option<String> {
    let date = exif_ascii(exif, exif::Tag::GPSDateStamp)?;
    let time = exif
        .get_field(exif::Tag::GPSTimeStamp, exif::In::PRIMARY)
        .and_then(|field| match &field.value {
            exif::Value::Rational(values) if values.len() >= 3 => {
                let h = rational_to_f64(values[0].num as f64, values[0].denom as f64)?;
                let m = rational_to_f64(values[1].num as f64, values[1].denom as f64)?;
                let s = rational_to_f64(values[2].num as f64, values[2].denom as f64)?;
                Some(format!("{:02}:{:02}:{:06.3} UTC", h as u32, m as u32, s))
            }
            _ => None,
        })?;
    Some(format!("{} {}", date, time))
}

fn rational_to_f64(num: f64, denom: f64) -> Option<f64> {
    if denom == 0.0 {
        None
    } else {
        Some(num / denom)
    }
}

fn exif_value_type(value: &exif::Value) -> &'static str {
    match value {
        exif::Value::Byte(_) => "BYTE",
        exif::Value::Ascii(_) => "ASCII",
        exif::Value::Short(_) => "SHORT",
        exif::Value::Long(_) => "LONG",
        exif::Value::Rational(_) => "RATIONAL",
        exif::Value::SByte(_) => "SBYTE",
        exif::Value::Undefined(_, _) => "UNDEFINED",
        exif::Value::SShort(_) => "SSHORT",
        exif::Value::SLong(_) => "SLONG",
        exif::Value::SRational(_) => "SRATIONAL",
        exif::Value::Float(_) => "FLOAT",
        exif::Value::Double(_) => "DOUBLE",
        exif::Value::Unknown(_, _, _) => "UNKNOWN",
    }
}

fn exif_raw_value_json(value: &exif::Value) -> serde_json::Value {
    match value {
        exif::Value::Byte(values) => byte_value_json(values),
        exif::Value::Ascii(values) => serde_json::json!(values
            .iter()
            .map(|value| ascii_bytes_to_string(value))
            .collect::<Vec<_>>()),
        exif::Value::Short(values) => serde_json::json!(values),
        exif::Value::Long(values) => serde_json::json!(values),
        exif::Value::Rational(values) => serde_json::json!(values
            .iter()
            .map(|value| {
                serde_json::json!({
                    "numerator": value.num,
                    "denominator": value.denom,
                    "decimal": rational_to_f64(value.num as f64, value.denom as f64),
                })
            })
            .collect::<Vec<_>>()),
        exif::Value::SByte(values) => serde_json::json!(values),
        exif::Value::Undefined(values, offset) => serde_json::json!({
            "offset": offset,
            "data": byte_value_json(values),
        }),
        exif::Value::SShort(values) => serde_json::json!(values),
        exif::Value::SLong(values) => serde_json::json!(values),
        exif::Value::SRational(values) => serde_json::json!(values
            .iter()
            .map(|value| {
                serde_json::json!({
                    "numerator": value.num,
                    "denominator": value.denom,
                    "decimal": rational_to_f64(value.num as f64, value.denom as f64),
                })
            })
            .collect::<Vec<_>>()),
        exif::Value::Float(values) => serde_json::json!(values),
        exif::Value::Double(values) => serde_json::json!(values),
        exif::Value::Unknown(field_type, count, offset) => serde_json::json!({
            "fieldType": field_type,
            "count": count,
            "offset": offset,
        }),
    }
}

fn exif_raw_value_text(value: &exif::Value) -> String {
    match value {
        exif::Value::Ascii(values) => values
            .iter()
            .map(|value| ascii_bytes_to_string(value))
            .collect::<Vec<_>>()
            .join(", "),
        exif::Value::Rational(values) => values
            .iter()
            .map(|value| rational_text(value.num as i64, value.denom as i64))
            .collect::<Vec<_>>()
            .join(", "),
        exif::Value::SRational(values) => values
            .iter()
            .map(|value| rational_text(value.num as i64, value.denom as i64))
            .collect::<Vec<_>>()
            .join(", "),
        exif::Value::Byte(values) => byte_preview_text(values),
        exif::Value::Undefined(values, _) => byte_preview_text(values),
        exif::Value::Short(values) => join_numbers(values),
        exif::Value::Long(values) => join_numbers(values),
        exif::Value::SByte(values) => join_numbers(values),
        exif::Value::SShort(values) => join_numbers(values),
        exif::Value::SLong(values) => join_numbers(values),
        exif::Value::Float(values) => join_numbers(values),
        exif::Value::Double(values) => join_numbers(values),
        exif::Value::Unknown(field_type, count, offset) => {
            format!("type={}, count={}, offset={}", field_type, count, offset)
        }
    }
}

fn byte_value_json(values: &[u8]) -> serde_json::Value {
    serde_json::json!({
        "length": values.len(),
        "hexPreview": values
            .iter()
            .take(64)
            .map(|value| format!("{:02X}", value))
            .collect::<Vec<_>>()
            .join(" "),
        "truncated": values.len() > 64,
        "asciiPreview": ascii_bytes_to_string(&values[..values.len().min(64)]),
    })
}

fn byte_preview_text(values: &[u8]) -> String {
    let preview = values
        .iter()
        .take(24)
        .map(|value| format!("{:02X}", value))
        .collect::<Vec<_>>()
        .join(" ");
    if values.len() > 24 {
        format!("{} bytes [{} ...]", values.len(), preview)
    } else {
        format!("{} bytes [{}]", values.len(), preview)
    }
}

fn ascii_bytes_to_string(value: &[u8]) -> String {
    String::from_utf8_lossy(value)
        .trim_matches(char::from(0))
        .trim()
        .to_string()
}

fn rational_text(num: i64, denom: i64) -> String {
    if denom == 0 {
        format!("{}/0", num)
    } else {
        format!("{}/{} ({:.6})", num, denom, num as f64 / denom as f64)
    }
}

fn join_numbers<T: std::fmt::Display>(values: &[T]) -> String {
    values
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

fn exif_tag_group(tag: exif::Tag) -> &'static str {
    let tag_name = tag.to_string();
    if tag.context() == exif::Context::Gps || tag_name.starts_with("GPS") {
        "GPS 位置"
    } else if matches!(
        tag,
        exif::Tag::Make
            | exif::Tag::Model
            | exif::Tag::LensMake
            | exif::Tag::LensModel
            | exif::Tag::Software
            | exif::Tag::BodySerialNumber
    ) {
        "相机信息"
    } else if matches!(
        tag,
        exif::Tag::ExposureTime
            | exif::Tag::FNumber
            | exif::Tag::ExposureProgram
            | exif::Tag::PhotographicSensitivity
            | exif::Tag::ISOSpeed
            | exif::Tag::ExposureBiasValue
            | exif::Tag::MeteringMode
            | exif::Tag::Flash
            | exif::Tag::FocalLength
            | exif::Tag::FocalLengthIn35mmFilm
            | exif::Tag::WhiteBalance
            | exif::Tag::SubjectDistance
            | exif::Tag::SubjectDistanceRange
    ) {
        "拍摄参数"
    } else if matches!(
        tag,
        exif::Tag::DateTime
            | exif::Tag::DateTimeOriginal
            | exif::Tag::DateTimeDigitized
            | exif::Tag::OffsetTime
            | exif::Tag::OffsetTimeOriginal
            | exif::Tag::OffsetTimeDigitized
            | exif::Tag::SubSecTime
            | exif::Tag::SubSecTimeOriginal
            | exif::Tag::SubSecTimeDigitized
    ) {
        "时间信息"
    } else if matches!(
        tag,
        exif::Tag::ImageWidth
            | exif::Tag::ImageLength
            | exif::Tag::PixelXDimension
            | exif::Tag::PixelYDimension
            | exif::Tag::ColorSpace
            | exif::Tag::Orientation
            | exif::Tag::XResolution
            | exif::Tag::YResolution
            | exif::Tag::ResolutionUnit
            | exif::Tag::BitsPerSample
            | exif::Tag::Compression
            | exif::Tag::PhotometricInterpretation
    ) {
        "图片信息"
    } else {
        "其他"
    }
}

fn exif_tag_label(tag: exif::Tag) -> String {
    let label = match tag {
        exif::Tag::Make => "设备厂商",
        exif::Tag::Model => "设备型号",
        exif::Tag::Software => "处理软件",
        exif::Tag::LensMake => "镜头厂商",
        exif::Tag::LensModel => "镜头型号",
        exif::Tag::BodySerialNumber => "机身序列号",
        exif::Tag::DateTime => "文件时间",
        exif::Tag::DateTimeOriginal => "拍摄时间",
        exif::Tag::DateTimeDigitized => "数字化时间",
        exif::Tag::OffsetTime => "文件时区",
        exif::Tag::OffsetTimeOriginal => "拍摄时区",
        exif::Tag::ExposureTime => "快门速度",
        exif::Tag::FNumber => "光圈",
        exif::Tag::PhotographicSensitivity => "ISO",
        exif::Tag::ISOSpeed => "ISO 速度",
        exif::Tag::FocalLength => "焦距",
        exif::Tag::FocalLengthIn35mmFilm => "等效焦距",
        exif::Tag::Flash => "闪光灯",
        exif::Tag::WhiteBalance => "白平衡",
        exif::Tag::ExposureMode => "曝光模式",
        exif::Tag::ExposureProgram => "曝光程序",
        exif::Tag::MeteringMode => "测光模式",
        exif::Tag::ExposureBiasValue => "曝光补偿",
        exif::Tag::GPSLatitude => "GPS 纬度",
        exif::Tag::GPSLongitude => "GPS 经度",
        exif::Tag::GPSLatitudeRef => "纬度参考",
        exif::Tag::GPSLongitudeRef => "经度参考",
        exif::Tag::GPSAltitude => "GPS 海拔",
        exif::Tag::GPSAltitudeRef => "海拔参考",
        exif::Tag::GPSTimeStamp => "GPS 时间",
        exif::Tag::GPSDateStamp => "GPS 日期",
        exif::Tag::ImageWidth => "图像宽度",
        exif::Tag::ImageLength => "图像高度",
        exif::Tag::PixelXDimension => "有效宽度",
        exif::Tag::PixelYDimension => "有效高度",
        exif::Tag::ColorSpace => "色彩空间",
        exif::Tag::Orientation => "方向",
        exif::Tag::XResolution => "水平分辨率",
        exif::Tag::YResolution => "垂直分辨率",
        exif::Tag::ResolutionUnit => "分辨率单位",
        exif::Tag::ExifVersion => "EXIF 版本",
        exif::Tag::Artist => "作者",
        exif::Tag::Copyright => "版权",
        exif::Tag::ImageDescription => "图片描述",
        exif::Tag::UserComment => "用户备注",
        exif::Tag::MakerNote => "厂商私有信息",
        _ => return tag.to_string(),
    };
    label.to_string()
}

fn is_privacy_tag(tag: exif::Tag) -> bool {
    let tag_name = tag.to_string();
    tag.context() == exif::Context::Gps
        || tag_name.starts_with("GPS")
        || tag_name.contains("SerialNumber")
        || matches!(tag, exif::Tag::MakerNote | exif::Tag::UserComment)
}

fn orientation_label(value: u32) -> &'static str {
    match value {
        1 => "正常",
        2 => "水平翻转",
        3 => "旋转 180°",
        4 => "垂直翻转",
        5 => "转置",
        6 => "顺时针旋转 90°",
        7 => "横向转置",
        8 => "逆时针旋转 90°",
        _ => "未知方向",
    }
}

#[tauri::command]
pub fn image_strip_exif(data: String) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine};

    let raw = if let Some(pos) = data.find(',') {
        &data[pos + 1..]
    } else {
        &data
    };
    let bytes = general_purpose::STANDARD
        .decode(raw)
        .map_err(|e| format!("base64解码失败: {}", e))?;

    // 通过 image crate 重新编码，自动丢弃 EXIF 元数据
    let img = image::load_from_memory(&bytes).map_err(|e| format!("图片加载失败: {}", e))?;

    // 检测原始格式
    let format = image::guess_format(&bytes).unwrap_or(image::ImageFormat::Jpeg);
    let mut buf = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut buf), format)
        .map_err(|e| format!("编码失败: {}", e))?;

    let mime = match format {
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::WebP => "image/webp",
        _ => "image/jpeg",
    };

    Ok(format!(
        "data:{};base64,{}",
        mime,
        general_purpose::STANDARD.encode(&buf)
    ))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageExifEdit {
    pub tag: String,
    pub value: Option<String>,
}

#[tauri::command]
pub fn image_exiftool_status() -> Result<serde_json::Value, String> {
    let Some(path) = find_exiftool_binary() else {
        return Ok(serde_json::json!({
            "installed": false,
            "installHint": exiftool_install_hint(),
        }));
    };

    let version = exiftool_version(&path).unwrap_or_else(|| "unknown".to_string());
    Ok(serde_json::json!({
        "installed": true,
        "version": version,
        "path": path.to_string_lossy(),
        "installHint": exiftool_install_hint(),
    }))
}

#[tauri::command]
pub fn image_exif_apply_edits(data: String, edits: Vec<ImageExifEdit>) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine};
    use std::fs;
    use std::process::Command;

    if edits.is_empty() {
        return Err("没有需要写入的 EXIF 修改".to_string());
    }

    let exiftool = find_exiftool_binary().ok_or_else(|| {
        format!(
            "未检测到 ExifTool，无法修改 EXIF。{}",
            exiftool_install_hint()
        )
    })?;
    let (mime_from_data_url, bytes) = decode_image_data_url(&data)?;
    let format = image::guess_format(&bytes).map_err(|_| "无法识别图片格式".to_string())?;
    if !matches!(
        format,
        image::ImageFormat::Jpeg
            | image::ImageFormat::Png
            | image::ImageFormat::Tiff
            | image::ImageFormat::WebP
    ) {
        return Err("EXIF 修改暂支持 JPEG、PNG、TIFF、WebP 图片".to_string());
    }

    let temp_dir = std::env::temp_dir().join("McStartUP").join("exiftool");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;
    let unique = format!(
        "{}_{}",
        chrono::Utc::now().timestamp_millis(),
        uuid::Uuid::new_v4().simple()
    );
    let input_path = temp_dir.join(format!("{}.{}", unique, image_format_extension(format)));
    fs::write(&input_path, &bytes).map_err(|e| format!("写入临时图片失败: {}", e))?;

    let mut args = vec![
        "-overwrite_original".to_string(),
        "-P".to_string(),
        "-charset".to_string(),
        "filename=UTF8".to_string(),
    ];
    for edit in edits {
        args.extend(exif_edit_to_args(edit)?);
    }
    args.push(input_path.to_string_lossy().to_string());

    let mut command = Command::new(&exiftool);
    command.args(&args);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command
        .output()
        .map_err(|e| format!("ExifTool 启动失败: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let message = if !stderr.is_empty() { stderr } else { stdout };
        let _ = fs::remove_file(&input_path);
        return Err(if message.is_empty() {
            format!("ExifTool 写入失败，退出码: {:?}", output.status.code())
        } else {
            format!("ExifTool 写入失败: {}", message)
        });
    }

    let result_bytes = fs::read(&input_path).map_err(|e| format!("读取修改后图片失败: {}", e))?;
    let _ = fs::remove_file(&input_path);

    let mime = image_format_mime(format)
        .or(mime_from_data_url.as_deref())
        .unwrap_or("application/octet-stream");
    Ok(format!(
        "data:{};base64,{}",
        mime,
        general_purpose::STANDARD.encode(&result_bytes)
    ))
}

fn decode_image_data_url(data: &str) -> Result<(Option<String>, Vec<u8>), String> {
    use base64::{engine::general_purpose, Engine};

    let trimmed = data.trim();
    let (mime, raw) = if let Some(pos) = trimmed.find(',') {
        let meta = &trimmed[..pos];
        let mime = meta
            .strip_prefix("data:")
            .and_then(|value| value.split(';').next())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        (mime, &trimmed[pos + 1..])
    } else {
        (None, trimmed)
    };
    let bytes = general_purpose::STANDARD
        .decode(raw)
        .map_err(|e| format!("base64解码失败: {}", e))?;
    Ok((mime, bytes))
}

fn image_format_extension(format: image::ImageFormat) -> &'static str {
    match format {
        image::ImageFormat::Jpeg => "jpg",
        image::ImageFormat::Png => "png",
        image::ImageFormat::Tiff => "tiff",
        image::ImageFormat::WebP => "webp",
        _ => "img",
    }
}

fn exiftool_install_hint() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "可用 winget install OliverBetz.ExifTool 安装，或从 https://exiftool.org/ 下载，将 exiftool(-k).exe 重命名为 exiftool.exe 后加入 PATH。"
    }
    #[cfg(target_os = "macos")]
    {
        "可用 brew install exiftool 安装，或从 https://exiftool.org/ 下载。"
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        "请通过系统包管理器安装 ExifTool，或从 https://exiftool.org/ 下载并加入 PATH。"
    }
}

fn exiftool_binary_names() -> &'static [&'static str] {
    #[cfg(target_os = "windows")]
    {
        &["exiftool.exe", "exiftool"]
    }
    #[cfg(not(target_os = "windows"))]
    {
        &["exiftool"]
    }
}

fn find_exiftool_binary() -> Option<std::path::PathBuf> {
    find_exiftool_in_path().or_else(find_exiftool_common_locations)
}

fn find_exiftool_in_path() -> Option<std::path::PathBuf> {
    use std::path::PathBuf;
    use std::process::Command;

    #[cfg(target_os = "windows")]
    {
        for name in exiftool_binary_names() {
            let mut cmd = Command::new("where.exe");
            cmd.arg(name);
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
            if let Ok(out) = cmd.output() {
                if out.status.success() {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    for line in stdout.lines() {
                        let candidate = PathBuf::from(line.trim());
                        if candidate.is_file() && exiftool_version(&candidate).is_some() {
                            return Some(candidate);
                        }
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("which");
        cmd.arg("exiftool");
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                for line in stdout.lines() {
                    let candidate = PathBuf::from(line.trim());
                    if candidate.is_file() && exiftool_version(&candidate).is_some() {
                        return Some(candidate);
                    }
                }
            }
        }
    }

    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).find_map(|dir| {
            exiftool_binary_names().iter().find_map(|name| {
                let candidate = dir.join(name);
                if candidate.is_file() && exiftool_version(&candidate).is_some() {
                    Some(candidate)
                } else {
                    None
                }
            })
        })
    })
}

fn find_exiftool_common_locations() -> Option<std::path::PathBuf> {
    let mut roots = Vec::new();
    #[cfg(target_os = "windows")]
    {
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            roots.push(std::path::PathBuf::from(program_files).join("ExifTool"));
        }
        if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)") {
            roots.push(std::path::PathBuf::from(program_files_x86).join("ExifTool"));
        }
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            let local_app_data = std::path::PathBuf::from(local_app_data);
            roots.push(local_app_data.join("Programs").join("ExifTool"));
            roots.push(
                local_app_data
                    .join("Microsoft")
                    .join("WinGet")
                    .join("Packages"),
            );
        }
        if let Some(user_profile) = std::env::var_os("USERPROFILE") {
            let user_profile = std::path::PathBuf::from(user_profile);
            roots.push(user_profile.join("scoop").join("shims"));
            roots.push(user_profile.join("scoop").join("apps").join("exiftool"));
        }
        roots.push(std::path::PathBuf::from(r"C:\ProgramData\chocolatey\bin"));
        roots.push(std::path::PathBuf::from(r"C:\exiftool"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        roots.extend([
            std::path::PathBuf::from("/usr/local/bin"),
            std::path::PathBuf::from("/opt/homebrew/bin"),
            std::path::PathBuf::from("/usr/bin"),
        ]);
    }

    roots.into_iter().find_map(|root| {
        if !root.exists() {
            return None;
        }
        find_exiftool_under_root(&root, 4)
    })
}

fn find_exiftool_under_root(
    root: &std::path::Path,
    max_depth: usize,
) -> Option<std::path::PathBuf> {
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
                    if exiftool_binary_names()
                        .iter()
                        .any(|candidate| name.eq_ignore_ascii_case(candidate))
                        && exiftool_version(&path).is_some()
                    {
                        return Some(path);
                    }
                }
            } else if path.is_dir() && depth < max_depth {
                stack.push((path, depth + 1));
            }
        }
    }
    None
}

fn exiftool_version(binary: &std::path::Path) -> Option<String> {
    let mut command = std::process::Command::new(binary);
    command.arg("-ver");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

fn exif_edit_to_args(edit: ImageExifEdit) -> Result<Vec<String>, String> {
    let tag = edit.tag.trim();
    let value = edit.value.unwrap_or_default();
    let trimmed = value.trim();
    let remove = trimmed.is_empty();

    match tag {
        "Make" | "Model" | "LensModel" | "Artist" | "Copyright" | "ImageDescription"
        | "UserComment" | "Software" | "DateTimeOriginal" | "DateTimeDigitized" | "DateTime" => {
            Ok(vec![format!("-{}={}", tag, trimmed)])
        }
        "GPSLatitude" => gps_coordinate_args(
            "GPSLatitude",
            "GPSLatitudeRef",
            trimmed,
            remove,
            'N',
            'S',
            90.0,
        ),
        "GPSLongitude" => gps_coordinate_args(
            "GPSLongitude",
            "GPSLongitudeRef",
            trimmed,
            remove,
            'E',
            'W',
            180.0,
        ),
        "GPSAltitude" => gps_altitude_args(trimmed, remove),
        "GPS:all" => Ok(vec!["-gps:all=".to_string()]),
        "MakerNotes" | "MakerNote" => Ok(vec!["-MakerNotes=".to_string()]),
        "SerialNumber" | "BodySerialNumber" | "InternalSerialNumber" => {
            Ok(vec![format!("-{}=", tag)])
        }
        _ => Err(format!("不支持写入的 EXIF 字段: {}", tag)),
    }
}

fn gps_coordinate_args(
    tag: &str,
    ref_tag: &str,
    value: &str,
    remove: bool,
    positive_ref: char,
    negative_ref: char,
    limit: f64,
) -> Result<Vec<String>, String> {
    if remove {
        return Ok(vec![format!("-{}=", tag), format!("-{}=", ref_tag)]);
    }
    let parsed = value
        .parse::<f64>()
        .map_err(|_| format!("{} 需要填写十进制度数，例如 31.230416", tag))?;
    if !parsed.is_finite() || parsed.abs() > limit {
        return Err(format!("{} 超出有效范围 ±{}", tag, limit));
    }
    let reference = if parsed < 0.0 {
        negative_ref
    } else {
        positive_ref
    };
    Ok(vec![
        format!("-{}={:.8}", tag, parsed.abs()),
        format!("-{}={}", ref_tag, reference),
    ])
}

fn gps_altitude_args(value: &str, remove: bool) -> Result<Vec<String>, String> {
    if remove {
        return Ok(vec![
            "-GPSAltitude=".to_string(),
            "-GPSAltitudeRef=".to_string(),
        ]);
    }
    let parsed = value
        .parse::<f64>()
        .map_err(|_| "GPSAltitude 需要填写数字，例如 12.5".to_string())?;
    if !parsed.is_finite() {
        return Err("GPSAltitude 不是有效数字".to_string());
    }
    Ok(vec![
        format!("-GPSAltitude={:.2}", parsed.abs()),
        format!("-GPSAltitudeRef={}", if parsed < 0.0 { 1 } else { 0 }),
    ])
}

// ==================== 图片格式转换 ====================

#[tauri::command]
pub fn image_convert(
    data: String,
    format: String,
    quality: u8,
) -> Result<serde_json::Value, String> {
    use base64::{engine::general_purpose, Engine};

    let raw = if let Some(pos) = data.find(',') {
        &data[pos + 1..]
    } else {
        &data
    };
    let orig_bytes = general_purpose::STANDARD
        .decode(raw)
        .map_err(|e| format!("base64解码失败: {}", e))?;
    let orig_size = orig_bytes.len();

    let img = image::load_from_memory(&orig_bytes).map_err(|e| format!("图片加载失败: {}", e))?;
    let w = img.width();
    let h = img.height();

    let encoded = encode_base64_image(&img, &format, quality)?;
    let enc_raw = if let Some(pos) = encoded.find(',') {
        &encoded[pos + 1..]
    } else {
        &encoded
    };
    let new_size = (enc_raw.len() * 3) / 4;

    Ok(serde_json::json!({
        "data": encoded,
        "size": new_size,
        "orig_size": orig_size,
        "width": w,
        "height": h,
    }))
}

// ==================== 图片主色提取 ====================

#[tauri::command]
pub fn image_extract_palette(data: String, count: usize) -> Result<serde_json::Value, String> {
    use auto_palette::{Algorithm, ImageData, Palette};
    use base64::{engine::general_purpose, Engine};

    let raw = if let Some(pos) = data.find(',') {
        &data[pos + 1..]
    } else {
        &data
    };
    let bytes = general_purpose::STANDARD
        .decode(raw)
        .map_err(|e| format!("base64解码失败: {}", e))?;

    let img = image::load_from_memory(&bytes).map_err(|e| format!("图片加载失败: {}", e))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();

    let image_data =
        ImageData::new(w, h, rgba.as_raw()).map_err(|e| format!("图片数据创建失败: {}", e))?;

    let palette: Palette<f32> = Palette::extract_with_algorithm(&image_data, Algorithm::DBSCAN)
        .map_err(|e| format!("颜色提取失败: {}", e))?;

    let n = count.min(palette.len()).max(1);
    let mut colors = Vec::new();
    let swatches = palette.swatches();

    for swatch in swatches.iter().take(n) {
        let color: &auto_palette::color::Color<f32> = swatch.color();
        let rgb = color.to_rgb();
        let r = rgb.r;
        let g = rgb.g;
        let b = rgb.b;
        let hex = format!("#{:02X}{:02X}{:02X}", r, g, b);
        colors.push(serde_json::json!({
            "hex": hex,
            "r": r, "g": g, "b": b,
            "population": swatch.population(),
        }));
    }

    Ok(serde_json::json!({ "colors": colors }))
}

// ==================== 本地文件批量重命名 ====================

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRenameScanOptions {
    pub include_files: bool,
    pub include_folders: bool,
    pub recursive: bool,
    pub include_hidden: bool,
    #[serde(default)]
    pub extensions: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRenameOperation {
    pub source_path: String,
    pub target_path: String,
}

#[tauri::command]
pub fn file_rename_inspect_paths(paths: Vec<String>) -> Result<serde_json::Value, String> {
    let mut items = Vec::new();
    let mut seen = HashSet::new();

    for path in paths {
        let path = absolute_path(std::path::Path::new(&path))?;
        let key = path_key(&path);
        if !seen.insert(key) {
            continue;
        }
        items.push(file_rename_item_json(&path)?);
    }

    Ok(serde_json::json!({ "items": items }))
}

#[tauri::command]
pub fn file_rename_scan_dir(
    root: String,
    options: FileRenameScanOptions,
) -> Result<serde_json::Value, String> {
    let root_path = absolute_path(std::path::Path::new(&root))?;
    if !root_path.is_dir() {
        return Err("请选择有效文件夹".to_string());
    }

    let extensions = options
        .extensions
        .iter()
        .map(|value| value.trim().trim_start_matches('.').to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();
    let mut items = Vec::new();
    let mut stack = vec![root_path];

    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {}", e))?;
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if !options.include_hidden && is_hidden_path(&path, &metadata) {
                continue;
            }

            let is_dir = metadata.is_dir();
            let is_file = metadata.is_file();
            if is_dir && options.recursive {
                stack.push(path.clone());
            }

            if is_file && !options.include_files {
                continue;
            }
            if is_dir && !options.include_folders {
                continue;
            }
            if is_file && !extensions.is_empty() {
                let ext = path
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                if !extensions.contains(&ext) {
                    continue;
                }
            }

            items.push(file_rename_item_json(&path)?);
        }
    }

    Ok(serde_json::json!({ "items": items }))
}

#[tauri::command]
pub fn file_rename_apply(
    operations: Vec<FileRenameOperation>,
) -> Result<serde_json::Value, String> {
    if operations.is_empty() {
        return Err("没有需要执行的重命名操作".to_string());
    }

    let mut planned = Vec::new();
    let mut source_keys = HashSet::new();
    let mut target_keys = HashSet::new();

    for operation in operations {
        let source = absolute_path(std::path::Path::new(&operation.source_path))?;
        let target = absolute_path(std::path::Path::new(&operation.target_path))?;
        if source == target {
            continue;
        }
        if !source.exists() {
            return Err(format!("源路径不存在: {}", source.display()));
        }
        let source_parent = source
            .parent()
            .ok_or_else(|| format!("无法识别源路径父目录: {}", source.display()))?;
        let target_parent = target
            .parent()
            .ok_or_else(|| format!("无法识别目标路径父目录: {}", target.display()))?;
        if path_key(source_parent) != path_key(target_parent) {
            return Err("仅支持在同一文件夹内重命名，不支持移动文件位置".to_string());
        }
        let target_name = target
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "目标文件名无效".to_string())?;
        validate_file_rename_name(target_name)?;

        let source_key = path_key(&source);
        let target_key = path_key(&target);
        if !source_keys.insert(source_key.clone()) {
            return Err(format!("重复的源路径: {}", source.display()));
        }
        if !target_keys.insert(target_key.clone()) {
            return Err(format!("多个项目将重命名为同一目标: {}", target.display()));
        }
        let is_dir = source.is_dir();
        planned.push((source, target, is_dir));
    }

    for (source, target, _) in &planned {
        let target_key = path_key(target);
        let target_is_batch_source = source_keys.contains(&target_key);
        if target.exists() && !target_is_batch_source && path_key(source) != target_key {
            return Err(format!("目标已存在: {}", target.display()));
        }
    }

    if planned.is_empty() {
        return Ok(serde_json::json!({ "renamed": 0, "items": [] }));
    }

    for (dir_source, _, _) in planned.iter().filter(|(_, _, is_dir)| *is_dir) {
        for (source, _, _) in &planned {
            if source != dir_source && source.starts_with(dir_source) {
                return Err(format!(
                    "不能在同一次操作中同时重命名父文件夹和其内部项目: {}",
                    dir_source.display()
                ));
            }
        }
    }

    let batch_id = uuid::Uuid::new_v4().simple().to_string();
    let mut staged = Vec::new();

    for (index, (source, target, _)) in planned.iter().enumerate() {
        let parent = source
            .parent()
            .ok_or_else(|| format!("无法识别源路径父目录: {}", source.display()))?;
        let mut temp = parent.join(format!(".mcstartup-renaming-{}-{}.tmp", batch_id, index));
        let mut suffix = 0usize;
        while temp.exists() {
            suffix += 1;
            temp = parent.join(format!(
                ".mcstartup-renaming-{}-{}-{}.tmp",
                batch_id, index, suffix
            ));
        }
        if let Err(e) = std::fs::rename(source, &temp) {
            rollback_staged_sources(&staged);
            return Err(format!(
                "重命名到临时路径失败: {} -> {} ({})",
                source.display(),
                temp.display(),
                e
            ));
        }
        staged.push((source.clone(), temp, target.clone()));
    }

    let mut completed = Vec::new();
    for (source, temp, target) in &staged {
        if let Err(e) = std::fs::rename(temp, target) {
            rollback_completed_targets(&completed);
            rollback_staged_temps(&staged);
            return Err(format!(
                "写入目标名称失败: {} -> {} ({})",
                source.display(),
                target.display(),
                e
            ));
        }
        completed.push((source.clone(), target.clone()));
    }

    let items = completed
        .iter()
        .map(|(source, target)| {
            serde_json::json!({
                "sourcePath": source.to_string_lossy(),
                "targetPath": target.to_string_lossy(),
                "success": true,
            })
        })
        .collect::<Vec<_>>();

    Ok(serde_json::json!({
        "renamed": completed.len(),
        "items": items,
    }))
}

fn file_rename_item_json(path: &std::path::Path) -> Result<serde_json::Value, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("读取路径信息失败: {} ({})", path.display(), e))?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("无法识别文件名: {}", path.display()))?;
    let parent = path
        .parent()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let extension = if metadata.is_dir() {
        String::new()
    } else {
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string()
    };
    let stem = if metadata.is_dir() {
        name.to_string()
    } else {
        path.file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(name)
            .to_string()
    };
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);

    Ok(serde_json::json!({
        "path": path.to_string_lossy(),
        "parent": parent,
        "name": name,
        "stem": stem,
        "extension": extension,
        "isDir": metadata.is_dir(),
        "size": if metadata.is_file() { metadata.len() } else { 0 },
        "modified": modified,
    }))
}

fn absolute_path(path: &std::path::Path) -> Result<std::path::PathBuf, String> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        std::env::current_dir()
            .map(|dir| dir.join(path))
            .map_err(|e| format!("解析路径失败: {}", e))
    }
}

fn path_key(path: &std::path::Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    #[cfg(target_os = "windows")]
    {
        value.to_ascii_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        value
    }
}

fn validate_file_rename_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("目标名称不能为空".to_string());
    }
    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err(format!("目标名称不能以空格或点结尾: {}", name));
    }
    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    if name
        .chars()
        .any(|ch| invalid.contains(&ch) || ch.is_control())
    {
        return Err(format!("目标名称包含非法字符: {}", name));
    }
    let stem = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .to_ascii_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if reserved.contains(&stem.as_str()) {
        return Err(format!("目标名称是 Windows 保留名: {}", name));
    }
    Ok(())
}

fn is_hidden_path(path: &std::path::Path, metadata: &std::fs::Metadata) -> bool {
    if path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|name| name.starts_with('.'))
        .unwrap_or(false)
    {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

fn rollback_staged_sources(
    staged: &[(std::path::PathBuf, std::path::PathBuf, std::path::PathBuf)],
) {
    for (source, temp, _) in staged.iter().rev() {
        if temp.exists() && !source.exists() {
            let _ = std::fs::rename(temp, source);
        }
    }
}

fn rollback_staged_temps(staged: &[(std::path::PathBuf, std::path::PathBuf, std::path::PathBuf)]) {
    for (source, temp, _) in staged.iter().rev() {
        if temp.exists() && !source.exists() {
            let _ = std::fs::rename(temp, source);
        }
    }
}

fn rollback_completed_targets(completed: &[(std::path::PathBuf, std::path::PathBuf)]) {
    for (source, target) in completed.iter().rev() {
        if target.exists() && !source.exists() {
            let _ = std::fs::rename(target, source);
        }
    }
}

/// 在文件管理器中显示文件（选中该文件）
#[tauri::command]
pub fn show_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        // Linux 没有统一的"选中文件"命令，打开父目录
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(path);
        std::process::Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 用系统默认程序打开文件
#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn has_invalid_loopback_proxy() -> bool {
    ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]
        .iter()
        .filter_map(|key| std::env::var(key).ok())
        .any(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            normalized.contains("127.0.0.1:9") || normalized.contains("localhost:9")
        })
}

fn normalize_connection_mode(mode: Option<String>) -> String {
    match mode
        .unwrap_or_else(|| "auto".to_string())
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "direct" => "direct".to_string(),
        "system" => "system".to_string(),
        "custom" => "custom".to_string(),
        _ => "auto".to_string(),
    }
}

fn build_http_client(mode: &str, proxy_url: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30));

    match mode {
        "direct" => {
            builder = builder.no_proxy();
        }
        "system" => {
            if has_invalid_loopback_proxy() {
                builder = builder.no_proxy();
            }
        }
        "custom" => {
            let proxy = proxy_url
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "已选择自定义代理，但代理地址为空".to_string())?;
            let proxy =
                reqwest::Proxy::all(proxy).map_err(|e| format!("自定义代理地址无效: {}", e))?;
            builder = builder.no_proxy().proxy(proxy);
        }
        _ => {
            if has_invalid_loopback_proxy() {
                builder = builder.no_proxy();
            }
        }
    }

    builder.build().map_err(|e| e.to_string())
}

fn is_retryable_network_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    [
        "timed out",
        "timeout",
        "dns",
        "lookup",
        "failed to connect",
        "error trying to connect",
        "connection refused",
        "connection reset",
        "tcp connect",
        "proxy",
        "tls",
        "certificate",
        "network is unreachable",
        "actively refused",
        "无效代理",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn map_send_error(error: reqwest::Error) -> String {
    let message = error.to_string();
    if message.contains("127.0.0.1:9") || message.contains("localhost:9") {
        "网络请求被本机无效代理拦截（127.0.0.1:9）。请检查系统/环境代理配置，或关闭该无效代理后重试。"
            .to_string()
    } else {
        message
    }
}

async fn execute_http_request(
    method: reqwest::Method,
    url: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    body: Option<&serde_json::Value>,
    mode: &str,
    proxy_url: Option<&str>,
) -> Result<String, String> {
    let client = build_http_client(mode, proxy_url)?;
    let mut req = client.request(method, url);

    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            req = req.header(k, v);
        }
    }

    if let Some(json_body) = body {
        req = req.json(json_body);
    }

    let resp = req.send().await.map_err(map_send_error)?;
    let status = resp.status();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        let details = text.trim();
        if details.is_empty() {
            return Err(format!(
                "HTTP {}: {}",
                status.as_u16(),
                status.canonical_reason().unwrap_or("error")
            ));
        }
        return Err(format!(
            "HTTP {}: {}\n{}",
            status.as_u16(),
            status.canonical_reason().unwrap_or("error"),
            details
        ));
    }

    if !content_type.contains("application/json") && !content_type.contains("text/json") {
        if text.trim_start().to_lowercase().starts_with("<!doctype")
            || text.trim_start().to_lowercase().starts_with("<html")
        {
            return Err(format!(
                "服务器返回了 HTML 页面而不是 JSON 数据 (Content-Type: {})\n请检查 API Base URL 是否正确，确保 URL 末尾没有多余的斜杠",
                content_type
            ));
        }
        if text.len() < 500 && !text.contains('{') {
            return Err(format!("服务器返回了非 JSON 响应: {}", text));
        }
    }

    Ok(text)
}

async fn execute_http_request_with_mode(
    method: reqwest::Method,
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<serde_json::Value>,
    connection_mode: Option<String>,
    proxy_url: Option<String>,
) -> Result<String, String> {
    let mode = normalize_connection_mode(connection_mode);

    if mode == "auto" {
        match execute_http_request(
            method.clone(),
            &url,
            headers.as_ref(),
            body.as_ref(),
            "direct",
            None,
        )
        .await
        {
            Ok(result) => Ok(result),
            Err(error) if is_retryable_network_error(&error) => {
                execute_http_request(
                    method,
                    &url,
                    headers.as_ref(),
                    body.as_ref(),
                    "system",
                    None,
                )
                .await
            }
            Err(error) => Err(error),
        }
    } else {
        execute_http_request(
            method,
            &url,
            headers.as_ref(),
            body.as_ref(),
            &mode,
            proxy_url.as_deref(),
        )
        .await
    }
}

/// 通用 HTTP GET 代理（绕过前端 CORS 限制）
#[tauri::command]
pub async fn http_get(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    connection_mode: Option<String>,
    proxy_url: Option<String>,
) -> Result<String, String> {
    execute_http_request_with_mode(
        reqwest::Method::GET,
        url,
        headers,
        None,
        connection_mode,
        proxy_url,
    )
    .await
}

/// 通用 HTTP POST JSON 代理（绕过前端 CORS 限制）
#[tauri::command]
pub async fn http_post_json(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    body: serde_json::Value,
    connection_mode: Option<String>,
    proxy_url: Option<String>,
) -> Result<String, String> {
    execute_http_request_with_mode(
        reqwest::Method::POST,
        url,
        headers,
        Some(body),
        connection_mode,
        proxy_url,
    )
    .await
}

/// 读取系统中文字体文件（用于 PDF 水印矢量文字）
#[tauri::command]
pub fn get_chinese_font() -> Result<Vec<u8>, String> {
    // 按优先级尝试常见中文字体
    #[cfg(target_os = "windows")]
    {
        let fonts_dir = std::path::Path::new(r"C:\Windows\Fonts");
        for name in &["simhei.ttf", "msyh.ttc", "simsun.ttc", "simkai.ttf"] {
            let path = fonts_dir.join(name);
            if path.exists() {
                return std::fs::read(&path).map_err(|e| e.to_string());
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        for path in &[
            "/System/Library/Fonts/PingFang.ttc",
            "/Library/Fonts/Arial Unicode.ttf",
            "/System/Library/Fonts/STHeiti Light.ttc",
        ] {
            if std::path::Path::new(path).exists() {
                return std::fs::read(path).map_err(|e| e.to_string());
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        for path in &[
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        ] {
            if std::path::Path::new(path).exists() {
                return std::fs::read(path).map_err(|e| e.to_string());
            }
        }
    }
    Err("未找到系统中文字体".to_string())
}

/// 获取 AI 模型默认存储目录（AppData/McStartUP/models）
#[tauri::command]
pub fn get_model_dir() -> Result<String, String> {
    let app_data = std::env::var("APPDATA")
        .unwrap_or_else(|_| std::env::var("HOME").unwrap_or_else(|_| ".".to_string()));
    let dir = std::path::PathBuf::from(app_data)
        .join("McStartUP")
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

/// 设置/保存用户自定义模型目录
#[tauri::command]
pub fn set_model_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    // 写入配置文件
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    let config_dir = std::path::PathBuf::from(app_data).join("McStartUP");
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let config_file = config_dir.join("model_dir.txt");
    std::fs::write(config_file, &path).map_err(|e| e.to_string())?;
    Ok(())
}

/// 读取用户配置的模型目录（如果有）
#[tauri::command]
pub fn get_custom_model_dir() -> Option<String> {
    let app_data = std::env::var("APPDATA").ok()?;
    let config_file = std::path::PathBuf::from(app_data)
        .join("McStartUP")
        .join("model_dir.txt");
    let path = std::fs::read_to_string(config_file).ok()?;
    let path = path.trim().to_string();
    if path.is_empty() || !std::path::Path::new(&path).exists() {
        None
    } else {
        Some(path)
    }
}

/// 检查模型文件是否已存在
#[tauri::command]
pub fn check_model_exists(model_dir: String, model_name: String) -> bool {
    let path = std::path::PathBuf::from(&model_dir).join(&model_name);
    path.exists()
        && path
            .metadata()
            .map(|m| m.is_file() && m.len() > 0)
            .unwrap_or(false)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatermarkAutoValidationResult {
    ok: bool,
    #[serde(default)]
    missing_models: Vec<String>,
    #[serde(default)]
    invalid_models: Vec<serde_json::Value>,
}

/// 校验 AI 去水印自动模型是否完整且可实际加载
#[tauri::command]
pub fn validate_watermark_auto_models(model_dir: String) -> Result<(), String> {
    let manual_model = std::path::PathBuf::from(&model_dir)
        .join("ai-watermark-remove")
        .join("manual")
        .join("lama_fp32.onnx");
    if !manual_model.is_file() {
        return Err(format!("缺少 LaMa 修复模型: {}", manual_model.display()));
    }

    let script_path = crate::image_watermark_remove::watermark_auto_script_path()?;

    let auto_dir = std::path::PathBuf::from(&model_dir)
        .join("ai-watermark-remove")
        .join("auto");
    let output = std::process::Command::new("python")
        .arg(&script_path)
        .arg("--validate-only")
        .arg(&auto_dir)
        .output()
        .map_err(|e| format!("启动自动分割模型校验失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("自动分割模型校验失败: {}", detail));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| format!("读取自动分割模型校验输出失败: {}", e))?;
    let result: WatermarkAutoValidationResult = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("解析自动分割模型校验输出失败: {}", e))?;

    if result.ok {
        return Ok(());
    }

    let mut parts = Vec::new();
    if !result.missing_models.is_empty() {
        parts.push(format!("缺少模型: {}", result.missing_models.join(", ")));
    }
    if !result.invalid_models.is_empty() {
        parts.push(format!(
            "损坏/不可加载模型数: {}",
            result.invalid_models.len()
        ));
    }
    if parts.is_empty() {
        parts.push("自动分割模型校验未通过".to_string());
    }
    Err(parts.join("；"))
}

/// 将 base64 图片数据保存为文件
#[tauri::command]
pub fn save_base64_image(base64_data: String, output_path: String) -> Result<(), String> {
    use base64::Engine as _;
    use std::io::Write;
    let data = if let Some(idx) = base64_data.find(',') {
        &base64_data[idx + 1..]
    } else {
        &base64_data
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|e| e.to_string())?;
    let mut file = std::fs::File::create(&output_path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    Ok(())
}

fn expand_user_path(path: &str) -> Result<std::path::PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("目标目录为空".to_string());
    }

    let home_dir = || {
        std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(std::path::PathBuf::from)
    };

    if trimmed == "~" {
        return home_dir().ok_or_else(|| "无法解析用户主目录".to_string());
    }
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        return home_dir()
            .map(|home| home.join(rest))
            .ok_or_else(|| "无法解析用户主目录".to_string());
    }

    Ok(std::path::PathBuf::from(trimmed))
}

fn sanitize_skill_dir_name(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            {
                '-'
            } else {
                ch
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches(|ch| ch == ' ' || ch == '.' || ch == '-');
    if trimmed.is_empty() {
        "skill".to_string()
    } else {
        trimmed.to_string()
    }
}

/// 将 AI Skill 写入指定 Agent 的 skills 目录，返回最终 SKILL.md 路径。
#[tauri::command]
pub fn install_skill_to_agent(
    skill_slug: String,
    target_dir: String,
    content: String,
) -> Result<String, String> {
    let base_dir = expand_user_path(&target_dir)?;
    let skill_dir = base_dir.join(sanitize_skill_dir_name(&skill_slug));
    std::fs::create_dir_all(&skill_dir).map_err(|err| format!("创建目标目录失败: {}", err))?;

    let skill_file = skill_dir.join("SKILL.md");
    std::fs::write(&skill_file, content).map_err(|err| format!("写入 Skill 失败: {}", err))?;
    Ok(skill_file.to_string_lossy().to_string())
}

/// 下载单个模型文件到本地（带进度回调）
#[tauri::command]
pub async fn download_model_file(
    app_handle: tauri::AppHandle,
    url: String,
    dest_path: String,
    overwrite: Option<bool>,
) -> Result<(), String> {
    use tauri::Manager;
    use tokio::io::AsyncWriteExt;
    let overwrite = overwrite.unwrap_or(false);
    let dest = std::path::PathBuf::from(&dest_path);

    // 创建父目录
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    // 如果文件已存在且非空，跳过
    if let Ok(meta) = tokio::fs::metadata(&dest).await {
        if !overwrite && meta.is_file() && meta.len() > 0 {
            let _ = app_handle.emit_all(
                "model-download-progress",
                serde_json::json!({
                    "file": dest_path,
                    "loaded": meta.len(),
                    "total": meta.len(),
                    "done": true
                }),
            );
            return Ok(());
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status().as_u16(), url));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut stream = resp.bytes_stream();
    let tmp_path = dest.with_extension(format!(
        "{}download",
        dest.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| format!("{ext}."))
            .unwrap_or_default()
    ));

    if tokio::fs::try_exists(&tmp_path)
        .await
        .map_err(|e| e.to_string())?
    {
        let _ = tokio::fs::remove_file(&tmp_path).await;
    }

    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| e.to_string())?;
    let mut loaded: u64 = 0;

    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        loaded += chunk.len() as u64;
        let _ = app_handle.emit_all(
            "model-download-progress",
            serde_json::json!({
                "file": dest_path,
                "loaded": loaded,
                "total": total,
                "done": false
            }),
        );
    }

    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    if overwrite
        && tokio::fs::try_exists(&dest)
            .await
            .map_err(|e| e.to_string())?
    {
        tokio::fs::remove_file(&dest)
            .await
            .map_err(|e| format!("覆盖旧模型失败: {}", e))?;
    }

    tokio::fs::rename(&tmp_path, &dest)
        .await
        .map_err(|e| format!("写入模型文件失败: {}", e))?;

    let _ = app_handle.emit_all(
        "model-download-progress",
        serde_json::json!({
            "file": dest_path,
            "loaded": loaded,
            "total": total,
            "done": true
        }),
    );

    Ok(())
}
