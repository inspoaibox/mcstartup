// Keep context-menu helper launches silent on Windows.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod ai_chat_commands;
mod ai_chat_db;
mod archive_tools;
mod auto_clicker;
mod browser_cookies;
mod clipboard_commands;
mod clipboard_history;
mod clipboard_monitor;
mod commands;
mod context_menu;
mod cursor_position;
mod database_tools;
mod desktop_icon_filter;
mod desktop_layouts;
mod doc_convert;
mod douyin_download;
mod download_manager;
mod excel_convert;
mod excel_diff;
mod excel_formula_to_value;
mod excel_merge;
mod excel_preview;
mod excel_remove_duplicates;
mod excel_remove_empty;
mod excel_split;
mod excel_utils;
mod github_store;
mod image_ai_upscale;
mod image_batch_process;
mod image_bg_remove;
mod image_ico_generator;
mod image_watermark_remove;
mod kiro_account_tool;
mod launcher;
mod markitdown_convert;
mod mcp_commands;
mod mcp_manager;
mod media_convert;
mod models;
mod music_player;
mod network_tools;
mod ocr;
mod paddle_ocr;
mod pdf_tools;
mod pdf_word_ocr;
mod registry;
mod rss_reader;
mod screen_recording;
mod screenshot_tool;
mod scroll_stitcher;
mod settings;
mod sherpa_audio_tools;
mod software_copyright;
mod storage;
mod system_tools;
mod tencent_bank_card_ocr;
mod tencent_general_invoice_ocr;
mod tencent_table_ocr;
mod text_selection;
mod tikhub_download;
mod translate;
mod video_download;
mod video_player;
mod video_watermark_remove;
mod web_check;
mod wechat_meme;
mod word_format;
mod word_selection_translate;
mod wps_ocr;
mod wx_channels_download;

use clipboard_commands::ClipboardState;
use clipboard_history::ClipboardDb;
use clipboard_monitor::start_clipboard_monitor;
use commands::AppState;
use mcp_manager::{McpManager, McpManagerState};
use registry::RegistryManager;
use settings::SettingsManager;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use storage::Storage;
use tauri::{
    CustomMenuItem, GlobalShortcutManager, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu,
    SystemTrayMenuItem,
};

static QUITTING: AtomicBool = AtomicBool::new(false);
static STARTUP_PHASE: AtomicBool = AtomicBool::new(true);
static SCREENSHOT_REGION_BUSY: AtomicBool = AtomicBool::new(false);
const ADD_PENDING_RELATIVE_PATH: &str = "McStartUP\\add_pending.json";

struct AtomicFlagReset(&'static AtomicBool);

impl Drop for AtomicFlagReset {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn screenshot_region_pending_bg() -> &'static Mutex<Option<String>> {
    static PENDING_BG: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    PENDING_BG.get_or_init(|| Mutex::new(None))
}

fn ensure_screenshot_region_window(app_handle: &tauri::AppHandle) -> Result<tauri::Window, String> {
    use tauri::Manager;

    if let Some(window) = app_handle.get_window("screenshot-region") {
        let _ = window.set_resizable(false);
        return Ok(window);
    }

    tauri::WindowBuilder::new(
        app_handle,
        "screenshot-region",
        tauri::WindowUrl::App("index.html".into()),
    )
    .title("区域截图")
    .fullscreen(false)
    .decorations(false)
    .transparent(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .inner_size(1.0, 1.0)
    .position(-32000.0, -32000.0)
    .visible(true)
    .build()
    .map_err(|e| format!("{:?}", e))
    .map(|window| {
        let _ = disable_window_transitions(&window);
        window
    })
}

fn prewarm_screenshot_region_window(app_handle: &tauri::AppHandle) {
    match ensure_screenshot_region_window(app_handle) {
        Ok(window) => {
            let window_clone = window.clone();
            tauri::async_runtime::spawn(async move {
                std::thread::sleep(std::time::Duration::from_millis(800));
                let _ = window_clone.hide();
                println!("[screenshot-region] hidden window prewarmed");
            });
        }
        Err(e) => eprintln!("[screenshot-region] prewarm failed: {}", e),
    }
}

fn position_screenshot_region_window(window: &tauri::Window) {
    let primary_screen = screenshot_tool::get_screens_info()
        .ok()
        .and_then(|screens| screens.into_iter().find(|screen| screen.is_primary));

    if let Some(screen) = primary_screen {
        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: screen.x,
            y: screen.y,
        }));
        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: screen.width,
            height: screen.height,
        }));
    }
}

#[cfg(target_os = "windows")]
const SINGLE_INSTANCE_MUTEX_NAME: &str = "McStartUP_SingleInstance_Mutex";
#[cfg(target_os = "windows")]
const SINGLE_INSTANCE_SHOW_EVENT_NAME: &str = "McStartUP_Show_Main_Window_Event";

struct ScrollScreenshotState {
    session: Mutex<Option<screenshot_tool::ScrollScreenshotSession>>,
}

#[cfg(target_os = "windows")]
fn to_wide_null(value: &str) -> Vec<u16> {
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;

    OsStr::new(value).encode_wide().chain(once(0)).collect()
}

#[cfg(target_os = "windows")]
fn notify_existing_instance() {
    let event_name = to_wide_null(SINGLE_INSTANCE_SHOW_EVENT_NAME);
    unsafe {
        // EVENT_MODIFY_STATE = 0x0002
        let event = winapi::um::synchapi::OpenEventW(0x0002, 0, event_name.as_ptr());
        if !event.is_null() {
            let _ = winapi::um::synchapi::SetEvent(event);
            winapi::um::handleapi::CloseHandle(event);
        }
    }
}

fn app_data_file(relative: &str) -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|base| base.join(relative))
}

fn add_payload_from_args() -> Option<serde_json::Value> {
    let args = std::env::args().collect::<Vec<_>>();
    let index = args.iter().position(|value| value == "--add")?;
    let paths = args
        .iter()
        .skip(index + 1)
        .filter_map(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() || trimmed.starts_with("--") {
                None
            } else {
                Some(value.clone())
            }
        })
        .collect::<Vec<_>>();
    if paths.is_empty() {
        return None;
    }
    Some(serde_json::json!({
        "paths": paths,
        "createdAt": chrono::Utc::now().to_rfc3339(),
    }))
}

fn write_add_pending_payload(payload: &serde_json::Value) {
    let Some(path) = app_data_file(ADD_PENDING_RELATIVE_PATH) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, payload.to_string());
}

fn add_pending_exists() -> bool {
    app_data_file(ADD_PENDING_RELATIVE_PATH)
        .map(|path| path.exists())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn acquire_single_instance_mutex() -> isize {
    use std::ffi::CString;

    let name = CString::new(SINGLE_INSTANCE_MUTEX_NAME).unwrap();
    unsafe {
        let mutex = winapi::um::synchapi::CreateMutexA(std::ptr::null_mut(), 1, name.as_ptr());
        let last_err = winapi::um::errhandlingapi::GetLastError();
        if mutex.is_null() || last_err == winapi::shared::winerror::ERROR_ALREADY_EXISTS {
            if desktop_layouts::desktop_box_launch_flag_enabled() {
                desktop_layouts::write_desktop_box_pending_request();
            } else if desktop_layouts::desktop_box_manage_launch_flag_enabled() {
                desktop_layouts::write_desktop_box_manage_pending_request();
            } else if let Some(payload) = video_player::pending_media_payload_from_args() {
                video_player::write_pending_media_payload(&payload);
            } else if let Some(payload) = add_payload_from_args() {
                write_add_pending_payload(&payload);
            }
            if !mutex.is_null() {
                winapi::um::handleapi::CloseHandle(mutex);
            }
            notify_existing_instance();
            std::process::exit(0);
        }
        mutex as isize
    }
}

#[cfg(target_os = "windows")]
fn create_single_instance_show_event() -> Option<isize> {
    let event_name = to_wide_null(SINGLE_INSTANCE_SHOW_EVENT_NAME);
    unsafe {
        let event =
            winapi::um::synchapi::CreateEventW(std::ptr::null_mut(), 0, 0, event_name.as_ptr());
        if event.is_null() {
            None
        } else {
            Some(event as isize)
        }
    }
}

#[cfg(target_os = "windows")]
fn start_single_instance_show_listener(app_handle: tauri::AppHandle, event_handle: Option<isize>) {
    let Some(event_handle) = event_handle else {
        return;
    };

    std::thread::spawn(move || {
        let event = event_handle as winapi::shared::ntdef::HANDLE;
        loop {
            // INFINITE = 0xFFFF_FFFF, WAIT_OBJECT_0 = 0
            let wait_result =
                unsafe { winapi::um::synchapi::WaitForSingleObject(event, 0xFFFF_FFFF) };
            if wait_result != 0 {
                break;
            }
            if desktop_layouts::desktop_box_pending_exists() {
                while desktop_layouts::desktop_box_pending_exists() {
                    if let Err(error) =
                        desktop_layouts::handle_pending_desktop_box_request(&app_handle)
                    {
                        eprintln!("[DesktopBox] pending create failed: {}", error);
                        break;
                    }
                }
                continue;
            }
            if desktop_layouts::desktop_box_manage_pending_exists() {
                if let Err(error) =
                    desktop_layouts::handle_pending_desktop_box_manage_request(&app_handle)
                {
                    eprintln!("[DesktopBox] pending manage failed: {}", error);
                }
                continue;
            }
            if let Some(label) = video_player::pending_media_window_label() {
                let _ = commands::show_tool_window(label.to_string(), app_handle.clone());
                continue;
            }
            if add_pending_exists() {
                if let Some(window) = app_handle.get_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                continue;
            }
            if let Some(window) = app_handle.get_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    });
}

#[cfg(target_os = "windows")]
fn set_window_exclude_from_capture(window: &tauri::Window, enable: bool) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };

    let hwnd = window
        .hwnd()
        .map_err(|e| format!("无法获取截图窗口句柄: {}", e))?;
    let affinity = if enable {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };

    unsafe { SetWindowDisplayAffinity(HWND(hwnd.0 as isize), affinity) }
        .map_err(|e| format!("无法设置截图窗口捕获排除状态: {}", e))
}

#[cfg(target_os = "windows")]
fn disable_window_transitions(window: &tauri::Window) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED};

    let hwnd = window
        .hwnd()
        .map_err(|e| format!("无法获取窗口句柄: {}", e))?;
    let disable_transitions: i32 = 1;
    unsafe {
        DwmSetWindowAttribute(
            HWND(hwnd.0 as isize),
            DWMWA_TRANSITIONS_FORCEDISABLED,
            &disable_transitions as *const _ as *const _,
            std::mem::size_of::<i32>() as u32,
        )
    }
    .map_err(|e| format!("无法禁用窗口动画: {}", e))
}

#[cfg(not(target_os = "windows"))]
fn disable_window_transitions(_window: &tauri::Window) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn set_window_exclude_from_capture(_window: &tauri::Window, _enable: bool) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn screen_recording_set_window_capture_excluded(
    app_handle: tauri::AppHandle,
    label: String,
    enable: bool,
) -> Result<(), String> {
    let window = app_handle
        .get_window(&label)
        .ok_or_else(|| format!("未找到窗口: {}", label))?;
    set_window_exclude_from_capture(&window, enable)
}

fn unregister_old_shortcut(app_handle: &tauri::AppHandle, old_shortcut: Option<&str>) {
    if let Some(old_shortcut) = old_shortcut.filter(|s| !s.is_empty()) {
        let mut gsm = app_handle.global_shortcut_manager();
        let _ = gsm.unregister(old_shortcut);
    }
}

pub fn register_shortcut(app_handle: &tauri::AppHandle, shortcut: &str) {
    let mut gsm = app_handle.global_shortcut_manager();
    let _ = gsm.unregister(shortcut);
    if shortcut.is_empty() {
        return;
    }
    let handle = app_handle.clone();
    let _ = gsm.register(shortcut, move || {
        // 忽略启动阶段的快捷键触发
        if STARTUP_PHASE.load(Ordering::SeqCst) {
            println!("Quick launcher shortcut triggered during startup phase, ignoring...");
            return;
        }

        // 检查窗口是否存在，不存在则创建
        if let Some(w) = handle.get_window("quicklauncher") {
            if w.is_visible().unwrap_or(false) {
                let _ = w.hide();
            } else {
                let _ = w.center();
                let _ = w.show();
                let _ = w.set_focus();
                let _ = w.emit("open-quick-launcher", ());
            }
        } else {
            // 动态创建快速启动器窗口
            println!("Creating quick launcher window dynamically...");
            match tauri::WindowBuilder::new(
                &handle,
                "quicklauncher",
                tauri::WindowUrl::App("index.html".into()),
            )
            .title("Quick Launcher")
            .inner_size(600.0, 500.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .center()
            .skip_taskbar(true)
            .build()
            {
                Ok(window) => {
                    println!("Quick launcher window created successfully");
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("open-quick-launcher", ());
                }
                Err(e) => {
                    eprintln!("Failed to create quick launcher window: {:?}", e);
                }
            }
        }
    });
}

pub fn register_clipboard_shortcut(app_handle: &tauri::AppHandle, shortcut: &str) {
    if shortcut.is_empty() {
        return;
    }
    let mut gsm = app_handle.global_shortcut_manager();
    let _ = gsm.unregister(shortcut);
    let handle = app_handle.clone();
    match gsm.register(shortcut, move || {
        // 忽略启动阶段的快捷键触发
        if STARTUP_PHASE.load(Ordering::SeqCst) {
            println!("Clipboard shortcut triggered during startup phase, ignoring...");
            return;
        }

        println!("Clipboard shortcut triggered!");

        // 检查窗口是否存在，不存在则创建
        if let Some(w) = handle.get_window("clipboard") {
            if w.is_visible().unwrap_or(false) {
                let _ = w.hide();
            } else {
                let _ = w.center();
                let _ = w.show();
                let _ = w.set_focus();
            }
        } else {
            // 动态创建剪贴板窗口
            println!("Creating clipboard window dynamically...");
            match tauri::WindowBuilder::new(
                &handle,
                "clipboard",
                tauri::WindowUrl::App("index.html".into()),
            )
            .title("剪贴板历史")
            .inner_size(380.0, 600.0)
            .min_inner_size(320.0, 400.0)
            .resizable(true)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .center()
            .skip_taskbar(true)
            .build()
            {
                Ok(window) => {
                    println!("Clipboard window created successfully");
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                Err(e) => {
                    eprintln!("Failed to create clipboard window: {:?}", e);
                }
            }
        }
    }) {
        Ok(_) => println!("Clipboard shortcut registered successfully: {}", shortcut),
        Err(e) => eprintln!(
            "Failed to register clipboard shortcut '{}': {:?}",
            shortcut, e
        ),
    }
}

pub fn register_toolbox_shortcut(app_handle: &tauri::AppHandle, shortcut: &str) {
    if shortcut.is_empty() {
        return;
    }
    let mut gsm = app_handle.global_shortcut_manager();
    let _ = gsm.unregister(shortcut);
    let handle = app_handle.clone();
    let _ = gsm.register(shortcut, move || {
        // Alt+T：打开主窗口并切换到工具箱模块
        use tauri::Manager;
        if let Some(w) = handle.get_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
            let _ = w.emit("open-toolbox", ());
        }
    });
}

pub fn register_ai_chat_shortcut(app_handle: &tauri::AppHandle, shortcut: &str) {
    let mut gsm = app_handle.global_shortcut_manager();

    // 先注销所有可能的旧快捷键（包括默认的 Alt+G）
    let _ = gsm.unregister("Alt+G");

    if shortcut.is_empty() {
        return;
    }

    // 注销当前要注册的快捷键（如果已存在）
    let _ = gsm.unregister(shortcut);

    let handle = app_handle.clone();
    let _ = gsm.register(shortcut, move || {
        // 打开主窗口并切换到AI聊天模块
        use tauri::Manager;
        if let Some(w) = handle.get_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
            let _ = w.emit("open-ai-chat", ());
        }
    });
}

pub fn register_ocr_screenshot_shortcut(app_handle: &tauri::AppHandle, shortcut: &str) {
    if shortcut.is_empty() {
        return;
    }
    let mut gsm = app_handle.global_shortcut_manager();

    // 先注销旧的快捷键
    let _ = gsm.unregister(shortcut);

    let handle = app_handle.clone();

    match gsm.register(shortcut, move || {
        println!("OCR shortcut triggered!");
        ocr_screenshot(&handle);
    }) {
        Ok(_) => println!("OCR shortcut registered successfully: {}", shortcut),
        Err(e) => eprintln!("Failed to register OCR shortcut '{}': {:?}", shortcut, e),
    }
}

fn ocr_screenshot(app_handle: &tauri::AppHandle) {
    use tauri::Manager;

    println!("OCR screenshot triggered");
    let base64 = match ocr::capture_screenshot() {
        Ok(b) => b,
        Err(e) => {
            eprintln!("OCR screenshot background capture failed: {}", e);
            return;
        }
    };

    // 检查窗口是否已存在
    if let Some(window) = app_handle.get_window("screenshot-ocr") {
        println!("Reusing existing screenshot-ocr window");
        // 窗口已存在，直接复用
        // 先确保窗口隐藏，再设置全屏，避免闪烁
        let _ = window.hide();
        let _ = window.set_fullscreen(true);
        let _ = window.set_always_on_top(true);
        let window_clone = window.clone();
        window.once("screenshot-ocr-ready", move |_| {
            let _ = window_clone.emit("screenshot-ocr-bg-data", &base64);
            let _ = window_clone.show();
            let _ = window_clone.set_focus();
        });
        // 通知前端重新开始截图流程
        let _ = window.emit("restart-screenshot", ());
        return;
    }

    // 窗口不存在，创建新窗口
    println!("Creating new screenshot-ocr window");
    match tauri::WindowBuilder::new(
        app_handle,
        "screenshot-ocr",
        tauri::WindowUrl::App("index.html".into()),
    )
    .title("Screenshot OCR")
    .fullscreen(true)
    .decorations(false)
    .transparent(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false) // 不要自动获取焦点
    .visible(false) // 初始隐藏，等截图加载完再显示
    .build()
    {
        Ok(window) => {
            println!("Screenshot OCR window created (hidden)");
            let window_clone = window.clone();
            window.once("screenshot-ocr-ready", move |_| {
                let _ = window_clone.emit("screenshot-ocr-bg-data", &base64);
                let _ = window_clone.show();
                let _ = window_clone.set_focus();
            });
        }
        Err(e) => {
            eprintln!("Failed to create screenshot-ocr window: {:?}", e);
        }
    }
}

fn get_data_dir() -> PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(app_data).join("McStartUP")
}

// ============ 翻译快捷键 ============

pub fn register_translate_screenshot_shortcut(
    app_handle: &tauri::AppHandle,
    shortcut: &str,
) -> Result<(), String> {
    let mut gsm = app_handle.global_shortcut_manager();

    // 先注销默认值和 settings 中保存的旧快捷键
    let _ = gsm.unregister("Alt+Shift+T");
    if let Some(state) = app_handle.try_state::<AppState>() {
        if let Ok(sm) = state.settings.lock() {
            if let Ok(s) = sm.load() {
                if let Some(old) = &s.translate_shortcut {
                    let _ = gsm.unregister(old.as_str());
                }
            }
        }
    }

    if shortcut.is_empty() {
        println!("Translate shortcut is empty, skipping registration");
        return Ok(());
    }
    println!("Attempting to register translate shortcut: {}", shortcut);

    let handle = app_handle.clone();

    gsm.register(shortcut, move || {
        println!("=== Translate shortcut triggered! ===");
        translate_screenshot(&handle);
    })
    .map_err(|e| format!("注册截图翻译快捷键 {} 失败: {}", shortcut, e))?;
    println!("Translate shortcut registered successfully: {}", shortcut);
    Ok(())
}

fn translate_screenshot(app_handle: &tauri::AppHandle) {
    use tauri::Manager;

    println!("=== translate_screenshot function called ===");
    let base64 = match ocr::capture_screenshot() {
        Ok(b) => b,
        Err(e) => {
            eprintln!("Translate screenshot background capture failed: {}", e);
            return;
        }
    };

    // 检查窗口是否已存在
    if let Some(window) = app_handle.get_window("screenshot-translate") {
        println!("Reusing existing screenshot-translate window");
        // 窗口已存在，直接复用
        // 先确保窗口隐藏，再设置全屏，避免闪烁
        let _ = window.hide();
        let _ = window.set_fullscreen(true);
        let _ = window.set_always_on_top(true);
        let window_clone = window.clone();
        window.once("screenshot-translate-ready", move |_| {
            let _ = window_clone.emit("screenshot-translate-bg-data", &base64);
            let _ = window_clone.show();
            let _ = window_clone.set_focus();
        });
        // 通知前端重新开始截图流程
        match window.emit("restart-screenshot-translate", ()) {
            Ok(_) => println!("Emitted restart-screenshot-translate event"),
            Err(e) => eprintln!("Failed to emit restart event: {:?}", e),
        }
        return;
    }

    // 窗口不存在，创建新窗口
    println!("Creating new screenshot-translate window");
    match tauri::WindowBuilder::new(
        app_handle,
        "screenshot-translate",
        tauri::WindowUrl::App("index.html".into()),
    )
    .title("Screenshot Translate")
    .fullscreen(true)
    .decorations(false)
    .transparent(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false) // 不要自动获取焦点
    .visible(false) // 初始隐藏，等截图加载完再显示
    .build()
    {
        Ok(window) => {
            println!("Screenshot Translate window created successfully (hidden)");
            let window_clone = window.clone();
            window.once("screenshot-translate-ready", move |_| {
                let _ = window_clone.emit("screenshot-translate-bg-data", &base64);
                let _ = window_clone.show();
                let _ = window_clone.set_focus();
            });
        }
        Err(e) => {
            eprintln!("Failed to create screenshot-translate window: {:?}", e);
        }
    }
}

// ============ 快捷翻译窗口 ============

pub fn register_quick_translate_shortcut(
    app_handle: &tauri::AppHandle,
    shortcut: &str,
) -> Result<(), String> {
    let mut gsm = app_handle.global_shortcut_manager();

    // 先注销默认值和 settings 中保存的旧快捷键
    let _ = gsm.unregister("Alt+Q");
    if let Some(state) = app_handle.try_state::<AppState>() {
        if let Ok(sm) = state.settings.lock() {
            if let Ok(s) = sm.load() {
                if let Some(old) = &s.quick_translate_shortcut {
                    let _ = gsm.unregister(old.as_str());
                }
            }
        }
    }

    if shortcut.is_empty() {
        println!("Quick translate shortcut is empty, skipping registration");
        return Ok(());
    }
    println!(
        "Attempting to register quick translate shortcut: {}",
        shortcut
    );

    let handle = app_handle.clone();

    gsm.register(shortcut, move || {
        println!("=== Quick translate shortcut triggered! ===");
        quick_translate(&handle);
    })
    .map_err(|e| format!("注册快捷翻译快捷键 {} 失败: {}", shortcut, e))?;
    println!(
        "Quick translate shortcut registered successfully: {}",
        shortcut
    );
    Ok(())
}

fn quick_translate(app_handle: &tauri::AppHandle) {
    use tauri::Manager;

    println!("=== quick_translate function called ===");

    // 检查窗口是否已存在
    if let Some(window) = app_handle.get_window("quick-translate") {
        println!("Reusing existing quick-translate window");
        // 窗口已存在，显示并聚焦
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        // 通知前端重新开始
        match window.emit("restart-quick-translate", ()) {
            Ok(_) => println!("Emitted restart-quick-translate event"),
            Err(e) => eprintln!("Failed to emit restart event: {:?}", e),
        }
        return;
    }

    // 窗口不存在，创建新窗口
    println!("Creating new quick-translate window");
    match tauri::WindowBuilder::new(
        app_handle,
        "quick-translate",
        tauri::WindowUrl::App("index.html".into()),
    )
    .title("Quick Translate")
    .inner_size(700.0, 450.0)
    .decorations(false)
    .transparent(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(false)
    .focused(true)
    .center()
    .build()
    {
        Ok(window) => {
            println!("Quick Translate window created successfully");
            match window.set_focus() {
                Ok(_) => println!("Window focus set successfully"),
                Err(e) => eprintln!("Failed to set window focus: {:?}", e),
            }
        }
        Err(e) => {
            eprintln!("Failed to create quick-translate window: {:?}", e);
        }
    }
}

// ============ 划词翻译 ============

pub fn register_word_selection_translate_shortcut(
    app_handle: &tauri::AppHandle,
    shortcut: &str,
) -> Result<(), String> {
    let mut gsm = app_handle.global_shortcut_manager();

    // 注销默认快捷键和所有可能的旧值（从 settings 读取当前已注册的快捷键）
    let _ = gsm.unregister("Alt+W");
    if let Some(state) = app_handle.try_state::<AppState>() {
        if let Ok(sm) = state.settings.lock() {
            if let Ok(s) = sm.load() {
                if let Some(old) = &s.word_selection_translate_shortcut {
                    let _ = gsm.unregister(old.as_str());
                }
            }
        }
    }

    if shortcut.is_empty() {
        println!("Word selection translate shortcut is empty, skipping registration");
        return Ok(());
    }
    println!(
        "Attempting to register word selection translate shortcut: {}",
        shortcut
    );

    let handle = app_handle.clone();
    let registered_shortcut = shortcut.to_string();

    gsm.register(shortcut, move || {
        println!("=== Word selection translate shortcut triggered! ===");
        word_selection_translate(&handle, registered_shortcut.clone());
    })
    .map_err(|e| format!("注册划词翻译快捷键 {} 失败: {}", shortcut, e))?;
    println!(
        "Word selection translate shortcut registered successfully: {}",
        shortcut
    );
    Ok(())
}

fn word_selection_translate(app_handle: &tauri::AppHandle, selection_shortcut: String) {
    use tauri::Manager;

    println!("=== word_selection_translate function called ===");

    // 在快捷键回调的第一时间捕获前台窗口句柄
    // 必须在这里捕获，之后 Tauri 窗口可能会抢占前台导致 GetForegroundWindow 返回错误句柄
    #[cfg(target_os = "windows")]
    let target_hwnd: isize = unsafe {
        use winapi::um::winuser::GetForegroundWindow;
        GetForegroundWindow() as isize
    };
    #[cfg(not(target_os = "windows"))]
    let target_hwnd: isize = 0;

    // 加载设置
    if let Some(state) = app_handle.try_state::<AppState>() {
        if let Ok(settings_manager) = state.settings.lock() {
            if let Ok(settings) = settings_manager.load() {
                let openai_compatible_provider = settings
                    .translate_openai_compatible_providers
                    .iter()
                    .find(|provider| {
                        !settings.translate_openai_compatible_provider_id.is_empty()
                            && provider.id == settings.translate_openai_compatible_provider_id
                    })
                    .or_else(|| settings.translate_openai_compatible_providers.first());
                // 准备翻译配置
                let translate_settings = word_selection_translate::WordSelectionTranslateSettings {
                    provider: settings.translate_provider.clone(),
                    from_lang: settings.translate_from_lang.clone(),
                    to_lang: settings.translate_to_lang.clone(),
                    auto_detect_language: settings.translate_auto_detect_language,
                    auto_copy: settings.translate_auto_copy,
                    translate_config: translate::TranslateConfig {
                        baidu_app_id: settings.translate_baidu_app_id.clone(),
                        baidu_secret_key: settings.translate_baidu_secret_key.clone(),
                        google_api_key: settings.translate_google_api_key.clone(),
                        bing_api_key: settings.translate_bing_api_key.clone(),
                        tencent_secret_id: settings.translate_tencent_secret_id.clone(),
                        tencent_secret_key: settings.translate_tencent_secret_key.clone(),
                        tencent_region: settings.translate_tencent_region.clone(),
                        openai_api_key: settings.translate_openai_api_key.clone(),
                        openai_model: settings.translate_openai_model.clone(),
                        openai_base_url: settings.translate_openai_base_url.clone(),
                        openai_compatible_name: openai_compatible_provider
                            .map(|provider| provider.name.clone())
                            .unwrap_or_default(),
                        openai_compatible_api_key: openai_compatible_provider
                            .map(|provider| provider.api_key.clone())
                            .unwrap_or_default(),
                        openai_compatible_model: openai_compatible_provider
                            .map(|provider| provider.model.clone())
                            .unwrap_or_default(),
                        openai_compatible_base_url: openai_compatible_provider
                            .map(|provider| provider.base_url.clone())
                            .unwrap_or_default(),
                        deepseek_api_key: settings.translate_deepseek_api_key.clone(),
                        deepseek_model: settings.translate_deepseek_model.clone(),
                        deepseek_base_url: settings.translate_deepseek_base_url.clone(),
                        gemini_api_key: settings.translate_gemini_api_key.clone(),
                        gemini_model: settings.translate_gemini_model.clone(),
                    },
                };

                // 异步执行翻译，传入已捕获的前台窗口句柄
                let app_handle_clone = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    match word_selection_translate::execute_word_selection_translate(
                        app_handle_clone,
                        translate_settings,
                        target_hwnd,
                        selection_shortcut,
                    )
                    .await
                    {
                        Ok(_) => println!("Word selection translate executed successfully"),
                        Err(e) => eprintln!("Word selection translate failed: {}", e),
                    }
                });
            }
        }
    }
}

// ============ 截图工具快捷键 ============

pub fn register_screenshot_shortcuts(app_handle: &tauri::AppHandle) {
    if let Some(state) = app_handle.try_state::<AppState>() {
        if let Ok(settings_manager) = state.settings.lock() {
            if let Ok(settings) = settings_manager.load() {
                // 注册全屏截图快捷键
                if let Some(shortcut) = &settings.screenshot_fullscreen_shortcut {
                    if let Err(error) =
                        register_screenshot_fullscreen_shortcut(app_handle, shortcut)
                    {
                        eprintln!(
                            "[Shortcuts] Failed to register screenshot fullscreen shortcut: {}",
                            error
                        );
                    }
                }

                // 注册区域截图快捷键
                if let Some(shortcut) = &settings.screenshot_region_shortcut {
                    if let Err(error) = register_screenshot_region_shortcut(app_handle, shortcut) {
                        eprintln!(
                            "[Shortcuts] Failed to register screenshot region shortcut: {}",
                            error
                        );
                    }
                }
            }
        }
    }
}

// 全屏截图快捷键
pub fn register_screenshot_fullscreen_shortcut(
    app_handle: &tauri::AppHandle,
    shortcut: &str,
) -> Result<(), String> {
    let mut gsm = app_handle.global_shortcut_manager();

    if shortcut.is_empty() {
        println!("Screenshot fullscreen shortcut is disabled");
        return Ok(());
    }

    println!(
        "Attempting to register screenshot fullscreen shortcut: {}",
        shortcut
    );

    let _ = gsm.unregister(shortcut);

    let handle = app_handle.clone();

    match gsm.register(shortcut, move || {
        println!("=== Screenshot fullscreen shortcut triggered! ===");
        trigger_screenshot_fullscreen(&handle);
    }) {
        Ok(_) => {
            println!(
                "Screenshot fullscreen shortcut registered successfully: {}",
                shortcut
            );
            Ok(())
        }
        Err(error) => {
            let message = format!(
                "Failed to register screenshot fullscreen shortcut '{}': {:?}",
                shortcut, error
            );
            eprintln!("{}", message);
            Err(message)
        }
    }
}

// 区域截图快捷键
pub fn register_screenshot_region_shortcut(
    app_handle: &tauri::AppHandle,
    shortcut: &str,
) -> Result<(), String> {
    let mut gsm = app_handle.global_shortcut_manager();

    if shortcut.is_empty() {
        println!("Screenshot region shortcut is disabled");
        return Ok(());
    }

    println!(
        "Attempting to register screenshot region shortcut: {}",
        shortcut
    );

    let _ = gsm.unregister(shortcut);

    let handle = app_handle.clone();

    match gsm.register(shortcut, move || {
        println!("=== Screenshot region shortcut triggered! ===");
        trigger_screenshot_region(&handle);
    }) {
        Ok(_) => {
            println!(
                "Screenshot region shortcut registered successfully: {}",
                shortcut
            );
            Ok(())
        }
        Err(error) => {
            let message = format!(
                "Failed to register screenshot region shortcut '{}': {:?}",
                shortcut, error
            );
            eprintln!("{}", message);
            Err(message)
        }
    }
}

// 应用启动时预创建截图相关窗口（隐藏），消除首次触发的 WebView 闪烁
// 触发全屏截图
fn trigger_screenshot_fullscreen(app_handle: &tauri::AppHandle) {
    println!("=== trigger_screenshot_fullscreen function called ===");

    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        match screenshot_tool::capture_fullscreen() {
            Ok(base64) => {
                println!("Fullscreen captured successfully");

                // 关闭旧结果窗口
                if let Some(old) = app_handle_clone.get_window("screenshot-result") {
                    let _ = old.close();
                    std::thread::sleep(std::time::Duration::from_millis(80));
                }

                // 创建结果窗口（不可见）
                match tauri::WindowBuilder::new(
                    &app_handle_clone,
                    "screenshot-result",
                    tauri::WindowUrl::App("index.html".into()),
                )
                .title("截图完成")
                .inner_size(800.0, 600.0)
                .center()
                .resizable(true)
                .always_on_top(true)
                .decorations(false)
                .visible(false)
                .build()
                {
                    Ok(window) => {
                        let base64_clone = base64.clone();
                        let window_clone = window.clone();
                        window.once("screenshot-result-ready", move |_| {
                            println!("Frontend ready, sending screenshot data");
                            let _ = window_clone.emit("screenshot-data", &base64_clone);
                        });
                    }
                    Err(e) => eprintln!("Failed to create screenshot result window: {:?}", e),
                }
            }
            Err(e) => eprintln!("Failed to capture fullscreen: {}", e),
        }
    });
}

// 触发区域截图
fn trigger_screenshot_region(app_handle: &tauri::AppHandle) {
    println!("=== trigger_screenshot_region function called ===");

    if SCREENSHOT_REGION_BUSY.swap(true, Ordering::SeqCst) {
        println!("[screenshot-region] trigger ignored: capture/window creation already running");
        return;
    }

    let trigger_started_at = std::time::Instant::now();
    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let _busy_reset = AtomicFlagReset(&SCREENSHOT_REGION_BUSY);
        println!(
            "[screenshot-region][perf] async task started after {}ms",
            trigger_started_at.elapsed().as_millis()
        );
        let total_started_at = std::time::Instant::now();

        // 隐藏复用的区域截图窗口，再截图，避免把旧遮罩截进新背景。
        let hide_started_at = std::time::Instant::now();
        let window = match ensure_screenshot_region_window(&app_handle_clone) {
            Ok(window) => window,
            Err(e) => {
                eprintln!("创建区域截图窗口失败: {}", e);
                return;
            }
        };
        let was_visible = window.is_visible().unwrap_or(false);
        let _ = window.hide();
        if was_visible {
            std::thread::sleep(std::time::Duration::from_millis(35));
        }
        let _ = window.set_always_on_top(true);
        println!(
            "[screenshot-region][perf] ensure+hide window: {}ms",
            hide_started_at.elapsed().as_millis()
        );

        // 截图
        let capture_started_at = std::time::Instant::now();
        let base64 = match screenshot_tool::capture_fullscreen() {
            Ok(b) => {
                println!(
                    "[screenshot-region][perf] capture fullscreen+encode: {}ms, bytes={}",
                    capture_started_at.elapsed().as_millis(),
                    b.len()
                );
                b
            }
            Err(e) => {
                eprintln!("区域截图背景截取失败: {}", e);
                return;
            }
        };

        // 缓存截图数据，由前端窗口启动后主动读取，避免隐藏窗口 ready 事件延迟。
        match screenshot_region_pending_bg().lock() {
            Ok(mut pending) => {
                *pending = Some(base64);
            }
            Err(e) => {
                eprintln!("区域截图背景缓存失败: {}", e);
                return;
            }
        }

        position_screenshot_region_window(&window);
        let create_started_at = std::time::Instant::now();
        let _ = window.emit("screenshot-bg-data", ());
        println!(
            "[screenshot-region][perf] emit reload event: {}ms, total={}ms",
            create_started_at.elapsed().as_millis(),
            total_started_at.elapsed().as_millis()
        );
    });
}

// ============ OCR 命令 ============

#[tauri::command]
fn ocr_recognize(
    image_base64: String,
    provider: String,
    config: ocr::OcrConfig,
) -> Result<ocr::OcrResult, String> {
    ocr::recognize(&image_base64, &provider, &config)
}

#[tauri::command]
fn detect_wechat_ocr_environment() -> Result<ocr::WechatOcrEnvironment, String> {
    ocr::detect_wechat_ocr_environment()
}

#[tauri::command]
fn prepare_wechat_ocr_environment() -> Result<ocr::WechatOcrEnvironment, String> {
    ocr::prepare_wechat_ocr_environment()
}

#[tauri::command]
fn stop_wechat_ocr() {
    ocr::stop_wechat_ocr();
}

#[tauri::command]
fn detect_paddle_ocr_environment() -> Result<paddle_ocr::PaddleOcrEnvironment, String> {
    paddle_ocr::detect_paddle_ocr_environment()
}

#[tauri::command]
fn prepare_paddle_ocr_environment() -> Result<paddle_ocr::PaddleOcrEnvironment, String> {
    paddle_ocr::prepare_paddle_ocr_environment()
}

#[tauri::command]
fn stop_paddle_ocr() {
    paddle_ocr::stop_paddle_ocr();
}

#[tauri::command]
fn detect_wps_ocr_environment() -> Result<wps_ocr::WpsOcrEnvironment, String> {
    wps_ocr::detect_wps_ocr_environment()
}

#[tauri::command]
fn prepare_wps_ocr_environment() -> Result<wps_ocr::WpsOcrEnvironment, String> {
    wps_ocr::prepare_wps_ocr_environment()
}

#[tauri::command]
fn stop_wps_ocr() {
    wps_ocr::stop_wps_ocr();
}

#[tauri::command]
fn recognize_table(
    image_base64: String,
    provider: String,
    config: ocr::OcrConfig,
) -> Result<ocr::TableResult, String> {
    ocr::recognize_table(&image_base64, &provider, &config)
}

#[tauri::command]
fn recognize_qrcode(image_base64: String) -> Result<String, String> {
    ocr::recognize_qrcode(&image_base64)
}

#[tauri::command]
fn has_qrcode(image_base64: String) -> bool {
    ocr::has_qrcode(&image_base64)
}

#[tauri::command]
fn capture_screenshot() -> Result<String, String> {
    ocr::capture_screenshot()
}

#[tauri::command]
fn capture_screenshot_region(x: i32, y: i32, width: i32, height: i32) -> Result<String, String> {
    ocr::capture_screenshot_region(x, y, width, height)
}

#[tauri::command]
fn crop_image_region(
    image_base64: String,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<String, String> {
    ocr::crop_image_region(&image_base64, x, y, width, height)
}

// ============ 翻译命令 ============

#[tauri::command]
fn translate_text(
    text: String,
    from_lang: String,
    to_lang: String,
    provider: String,
    auto_detect_language: bool,
    config: translate::TranslateConfig,
) -> Result<translate::TranslateResult, String> {
    translate::translate(
        &text,
        &from_lang,
        &to_lang,
        &provider,
        auto_detect_language,
        &config,
    )
}
#[tauri::command]
fn update_ocr_screenshot_shortcut(
    app_handle: tauri::AppHandle,
    shortcut: String,
    old_shortcut: Option<String>,
) {
    println!("Updating OCR shortcut to: {}", shortcut);
    unregister_old_shortcut(&app_handle, old_shortcut.as_deref());
    register_ocr_screenshot_shortcut(&app_handle, &shortcut);
}

#[tauri::command]
fn update_translate_screenshot_shortcut(
    app_handle: tauri::AppHandle,
    shortcut: String,
    old_shortcut: Option<String>,
) -> Result<(), String> {
    println!("Updating Translate shortcut to: {}", shortcut);
    unregister_old_shortcut(&app_handle, old_shortcut.as_deref());
    register_translate_screenshot_shortcut(&app_handle, &shortcut)
}

#[tauri::command]
fn update_quick_translate_shortcut(
    app_handle: tauri::AppHandle,
    shortcut: String,
    old_shortcut: Option<String>,
) -> Result<(), String> {
    println!("Updating Quick Translate shortcut to: {}", shortcut);
    unregister_old_shortcut(&app_handle, old_shortcut.as_deref());
    register_quick_translate_shortcut(&app_handle, &shortcut)
}

#[tauri::command]
fn update_word_selection_translate_shortcut(
    app_handle: tauri::AppHandle,
    shortcut: String,
    old_shortcut: Option<String>,
) -> Result<(), String> {
    println!(
        "Updating Word Selection Translate shortcut to: {}",
        shortcut
    );
    unregister_old_shortcut(&app_handle, old_shortcut.as_deref());
    register_word_selection_translate_shortcut(&app_handle, &shortcut)
}

// ============ 截图工具命令 ============

#[tauri::command]
fn screenshot_get_screens_info() -> Result<Vec<screenshot_tool::ScreenInfo>, String> {
    screenshot_tool::get_screens_info()
}

#[tauri::command]
fn screenshot_get_selectable_windows(
    app_handle: tauri::AppHandle,
) -> Result<Vec<screenshot_tool::SelectableWindow>, String> {
    use tauri::Manager;

    let excluded_hwnd = app_handle
        .get_window("screenshot-region")
        .and_then(|window| window.hwnd().ok())
        .map(|hwnd| hwnd.0 as isize);
    screenshot_tool::get_selectable_windows(excluded_hwnd)
}

#[tauri::command]
fn screenshot_capture_fullscreen() -> Result<String, String> {
    screenshot_tool::capture_fullscreen()
}

#[tauri::command]
fn screenshot_region_take_pending_bg() -> Option<String> {
    screenshot_region_pending_bg()
        .lock()
        .ok()
        .and_then(|mut pending| pending.take())
}

#[tauri::command]
fn screenshot_capture_screen(screen_index: usize) -> Result<String, String> {
    screenshot_tool::capture_screen(screen_index)
}

#[tauri::command]
fn screenshot_capture_region(x: i32, y: i32, width: i32, height: i32) -> Result<String, String> {
    screenshot_tool::capture_region(x, y, width, height)
}

#[tauri::command]
fn screenshot_capture_long_region(
    app_handle: tauri::AppHandle,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<String, String> {
    use tauri::Manager;

    if let Some(window) = app_handle.get_window("screenshot-region") {
        let _ = window.hide();
        std::thread::sleep(std::time::Duration::from_millis(120));
    }

    screenshot_tool::capture_long_region(x, y, width, height)
}

#[tauri::command]
fn screenshot_long_capture_step(
    app_handle: tauri::AppHandle,
    focus_x: i32,
    focus_y: i32,
    scroll_amount: i32,
) -> Result<String, String> {
    use tauri::Manager;

    let window = app_handle.get_window("screenshot-region");

    if let Some(window) = &window {
        let _ = window.set_ignore_cursor_events(true);
        std::thread::sleep(std::time::Duration::from_millis(24));
    }

    let scroll_result = screenshot_tool::scroll_page_at(focus_x, focus_y, scroll_amount);

    let result = match scroll_result {
        Ok(()) => screenshot_tool::capture_fullscreen(),
        Err(error) => Err(error),
    };

    if let Some(window) = &window {
        let _ = window.set_ignore_cursor_events(false);
    }

    result
}

fn capture_long_screenshot_frame(
    window: Option<&tauri::Window>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<::image::DynamicImage, String> {
    if let Some(window) = window {
        let _ = window.hide();
        std::thread::sleep(std::time::Duration::from_millis(45));
    }
    let result = screenshot_tool::capture_region_dynamic_image(x, y, width, height);
    if let Some(window) = window {
        let _ = window.show();
    }
    result
}

#[tauri::command]
fn scroll_screenshot_init(
    app_handle: tauri::AppHandle,
    state: tauri::State<ScrollScreenshotState>,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    _initial_frame_base64: String,
) -> Result<String, String> {
    use tauri::Manager;

    println!(
        "[long-screenshot] init command: x={}, y={}, width={}, height={}",
        x, y, width, height
    );

    let focus_x = x + width / 2;
    let focus_y = y + height / 2;
    let window = app_handle.get_window("screenshot-region");

    if let Some(window) = &window {
        println!("[long-screenshot] init: exclude screenshot window and pass mouse through");
        set_window_exclude_from_capture(window, true)?;
        let _ = window.set_ignore_cursor_events(true);
        std::thread::sleep(std::time::Duration::from_millis(80));
    } else {
        println!("[long-screenshot] init: screenshot-region window not found");
    }

    let result = (|| -> Result<String, String> {
        println!(
            "[long-screenshot] init: focus page at {}, {}",
            focus_x, focus_y
        );
        screenshot_tool::focus_page_at(focus_x, focus_y)?;
        let first_frame =
            capture_long_screenshot_frame(window.as_ref(), x, y, width as u32, height as u32)?;
        println!(
            "[long-screenshot] init: first frame captured {}x{}",
            first_frame.width(),
            first_frame.height()
        );
        let mut session = screenshot_tool::create_scroll_screenshot_session(
            x,
            y,
            width as u32,
            height as u32,
            first_frame,
        )?;
        let target_hwnd = screenshot_tool::get_window_handle_at_point(focus_x, focus_y).ok();
        screenshot_tool::set_scroll_screenshot_target(&mut session, target_hwnd, focus_x, focus_y);
        let first_frame_base64 = screenshot_tool::export_scroll_screenshot_session(&mut session)?;

        let mut guard = state
            .session
            .lock()
            .map_err(|_| "滚动截图状态锁定失败".to_string())?;

        *guard = Some(session);

        println!(
            "[long-screenshot] init: session ready, first preview bytes={}",
            first_frame_base64.len()
        );
        Ok(first_frame_base64)
    })();

    if let Some(window) = &window {
        let _ = window.set_ignore_cursor_events(false);
        if result.is_err() {
            let _ = set_window_exclude_from_capture(window, false);
        }
    }

    if let Err(error) = &result {
        println!("[long-screenshot] init failed: {}", error);
    }

    result
}

#[tauri::command]
fn scroll_screenshot_focus(
    app_handle: tauri::AppHandle,
    focus_x: i32,
    focus_y: i32,
) -> Result<(), String> {
    use tauri::Manager;

    let window = app_handle.get_window("screenshot-region");
    if let Some(window) = &window {
        let _ = window.set_ignore_cursor_events(true);
        std::thread::sleep(std::time::Duration::from_millis(24));
    }

    let result = screenshot_tool::focus_page_at(focus_x, focus_y);

    if let Some(window) = &window {
        let _ = window.set_ignore_cursor_events(false);
    }

    result
}

#[tauri::command]
fn scroll_screenshot_scroll_through(
    app_handle: tauri::AppHandle,
    focus_x: i32,
    focus_y: i32,
    scroll_amount: i32,
) -> Result<(), String> {
    use tauri::Manager;

    println!(
        "[long-screenshot] scroll through command: focus_x={}, focus_y={}, scroll_amount={}",
        focus_x, focus_y, scroll_amount
    );

    let Some(window) = app_handle.get_window("screenshot-region") else {
        return screenshot_tool::scroll_page_at(focus_x, focus_y, scroll_amount);
    };

    let _ = window.set_ignore_cursor_events(true);
    std::thread::sleep(std::time::Duration::from_millis(24));
    let result = screenshot_tool::scroll_page_at(focus_x, focus_y, scroll_amount);
    std::thread::sleep(std::time::Duration::from_millis(24));
    let _ = window.set_ignore_cursor_events(false);
    result
}

#[tauri::command]
fn scroll_screenshot_step(
    app_handle: tauri::AppHandle,
    state: tauri::State<ScrollScreenshotState>,
    focus_x: i32,
    focus_y: i32,
    scroll_amount: i32,
) -> Result<screenshot_tool::ScrollScreenshotStepResult, String> {
    use tauri::Manager;

    println!(
        "[long-screenshot] step command: focus_x={}, focus_y={}, scroll_amount={}",
        focus_x, focus_y, scroll_amount
    );

    let window = app_handle.get_window("screenshot-region");
    if let Some(window) = &window {
        let _ = window.set_ignore_cursor_events(true);
        std::thread::sleep(std::time::Duration::from_millis(24));
    } else {
        println!("[long-screenshot] step: screenshot-region window not found");
    }

    let result = (|| -> Result<screenshot_tool::ScrollScreenshotStepResult, String> {
        let mut guard = state
            .session
            .lock()
            .map_err(|_| "滚动截图状态锁定失败".to_string())?;
        let session = guard
            .as_mut()
            .ok_or_else(|| "滚动截图会话不存在".to_string())?;

        if let Some(limit_result) =
            screenshot_tool::begin_scroll_screenshot_step(session, focus_x, focus_y, scroll_amount)?
        {
            return Ok(limit_result);
        }
        let current_frame = capture_long_screenshot_frame(
            window.as_ref(),
            session.x,
            session.y,
            session.width,
            session.height,
        )?;
        screenshot_tool::finish_scroll_screenshot_step(session, current_frame)
    })();

    if let Some(window) = &window {
        let _ = window.show();
        let _ = window.set_ignore_cursor_events(false);
    }

    if let Err(error) = &result {
        println!("[long-screenshot] step failed: {}", error);
    }

    result
}

#[tauri::command]
fn scroll_screenshot_export(state: tauri::State<ScrollScreenshotState>) -> Result<String, String> {
    let mut guard = state
        .session
        .lock()
        .map_err(|_| "滚动截图状态锁定失败".to_string())?;
    let session = guard
        .as_mut()
        .ok_or_else(|| "滚动截图会话不存在".to_string())?;
    screenshot_tool::export_scroll_screenshot_session(session)
}

#[tauri::command]
fn scroll_screenshot_clear(
    app_handle: tauri::AppHandle,
    state: tauri::State<ScrollScreenshotState>,
) -> Result<(), String> {
    use tauri::Manager;

    let mut guard = state
        .session
        .lock()
        .map_err(|_| "滚动截图状态锁定失败".to_string())?;
    *guard = None;

    if let Some(window) = app_handle.get_window("screenshot-region") {
        let _ = set_window_exclude_from_capture(&window, false);
        let _ = window.set_ignore_cursor_events(false);
    }

    println!("[long-screenshot] clear: session cleared");
    Ok(())
}

#[tauri::command]
fn screenshot_save_file(base64_data: String, file_path: String) -> Result<(), String> {
    screenshot_tool::save_screenshot(&base64_data, &file_path)
}

#[tauri::command]
fn screenshot_get_default_dir() -> Result<String, String> {
    screenshot_tool::get_default_screenshot_dir().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn screenshot_generate_filename() -> String {
    screenshot_tool::generate_screenshot_filename()
}

fn update_screenshot_shortcut_registration(
    app_handle: &tauri::AppHandle,
    shortcut: &str,
    old_shortcut: Option<&str>,
    register: fn(&tauri::AppHandle, &str) -> Result<(), String>,
) -> Result<(), String> {
    unregister_old_shortcut(app_handle, old_shortcut);

    if let Err(error) = register(app_handle, shortcut) {
        if let Some(old_shortcut) = old_shortcut.filter(|value| !value.is_empty()) {
            if let Err(restore_error) = register(app_handle, old_shortcut) {
                return Err(format!(
                    "{}; failed to restore previous shortcut '{}': {}",
                    error, old_shortcut, restore_error
                ));
            }
        }
        return Err(error);
    }

    Ok(())
}

#[tauri::command]
fn update_screenshot_fullscreen_shortcut(
    app_handle: tauri::AppHandle,
    shortcut: String,
    old_shortcut: Option<String>,
) -> Result<(), String> {
    println!("Updating Screenshot fullscreen shortcut to: {}", shortcut);
    update_screenshot_shortcut_registration(
        &app_handle,
        &shortcut,
        old_shortcut.as_deref(),
        register_screenshot_fullscreen_shortcut,
    )
}

#[tauri::command]
fn update_screenshot_region_shortcut(
    app_handle: tauri::AppHandle,
    shortcut: String,
    old_shortcut: Option<String>,
) -> Result<(), String> {
    println!("Updating Screenshot region shortcut to: {}", shortcut);
    update_screenshot_shortcut_registration(
        &app_handle,
        &shortcut,
        old_shortcut.as_deref(),
        register_screenshot_region_shortcut,
    )
}

#[tauri::command]
fn test_translate_window(app_handle: tauri::AppHandle) {
    println!("=== Manual test_translate_window command called ===");
    translate_screenshot(&app_handle);
}

// ============ 网络工具命令 ============

#[tauri::command]
async fn network_ping(host: String, timeout_ms: u64) -> Result<network_tools::PingResult, String> {
    network_tools::ping_host(host, timeout_ms).await
}

#[tauri::command]
async fn network_dns_query(
    domain: String,
    record_type: String,
    dns_server: Option<String>,
) -> Result<network_tools::DnsQueryResult, String> {
    network_tools::dns_query(domain, record_type, dns_server).await
}

#[tauri::command]
async fn network_get_ip_info(ip: Option<String>) -> Result<network_tools::IpInfo, String> {
    network_tools::get_ip_info(ip).await
}

#[tauri::command]
async fn network_scan_port(
    host: String,
    port: u16,
    timeout_ms: u64,
) -> Result<network_tools::PortScanResult, String> {
    network_tools::scan_port(host, port, timeout_ms).await
}

#[tauri::command]
async fn network_list_local_ports() -> Result<Vec<network_tools::LocalPortInfo>, String> {
    network_tools::list_local_ports().await
}

#[tauri::command]
async fn network_kill_process(pid: u32) -> Result<(), String> {
    network_tools::kill_process(pid).await
}

#[tauri::command]
async fn network_reveal_process_path(path: String) -> Result<(), String> {
    network_tools::reveal_process_path(path).await
}

#[tauri::command]
async fn network_traceroute(
    host: String,
    max_hops: u32,
    timeout_ms: u64,
) -> Result<network_tools::TracerouteResult, String> {
    network_tools::traceroute(host, max_hops, timeout_ms).await
}

#[tauri::command]
async fn web_check_scan(
    input: String,
    scan_ports: bool,
) -> Result<web_check::WebCheckResult, String> {
    web_check::web_check_scan(input, scan_ports).await
}

#[tauri::command]
async fn github_store_search_repositories(
    params: github_store::GithubStoreSearchParams,
) -> Result<github_store::GithubStoreSearchResult, String> {
    github_store::github_store_search_repositories(params).await
}

#[tauri::command]
async fn github_store_daily(
    params: github_store::GithubStoreDailyParams,
) -> Result<github_store::GithubStoreDailyResult, String> {
    github_store::github_store_daily(params).await
}

#[tauri::command]
async fn github_store_repository(
    params: github_store::GithubStoreRepoParams,
) -> Result<github_store::GithubStoreRepoDetail, String> {
    github_store::github_store_repository(params).await
}

fn main() {
    #[cfg(target_os = "windows")]
    let single_instance_show_event = create_single_instance_show_event();

    #[cfg(target_os = "windows")]
    let _single_instance_mutex = acquire_single_instance_mutex();

    let storage = Storage::new().expect("Failed to initialize storage");
    let registry = RegistryManager::new().expect("Failed to initialize registry manager");
    let settings_manager = SettingsManager::new().expect("Failed to initialize settings manager");

    let initial_settings = settings_manager.load().unwrap_or_default();
    let context_menu_enabled_on_start = initial_settings.context_menu_enabled;
    let initial_shortcut = initial_settings.quick_launch_shortcut.clone();
    let clipboard_shortcut = initial_settings
        .clipboard_shortcut
        .clone()
        .unwrap_or_else(|| "Alt+C".to_string());
    let toolbox_shortcut = initial_settings
        .toolbox_shortcut
        .clone()
        .unwrap_or_else(|| "Alt+T".to_string());
    let ai_chat_shortcut = initial_settings
        .ai_chat_shortcut
        .clone()
        .unwrap_or_else(|| "Alt+G".to_string());

    // 加载 OCR 截图快捷键
    let ocr_shortcut = initial_settings
        .ocr_shortcut
        .clone()
        .unwrap_or_else(|| "Ctrl+Shift+A".to_string());

    // 加载翻译截图快捷键
    let translate_shortcut = initial_settings
        .translate_shortcut
        .clone()
        .unwrap_or_else(|| "Alt+Shift+T".to_string());

    // 加载快捷翻译快捷键
    let quick_translate_shortcut = initial_settings
        .quick_translate_shortcut
        .clone()
        .unwrap_or_else(|| "Alt+Q".to_string());

    // 加载划词翻译快捷键
    let word_selection_translate_shortcut = initial_settings
        .word_selection_translate_shortcut
        .clone()
        .unwrap_or_else(|| "Alt+W".to_string());

    // 加载 MCP 服务器配置
    let mcp_server_configs = initial_settings.mcp_servers.clone();

    // 截图快捷键将在 register_screenshot_shortcuts 中加载

    println!("Loading OCR shortcut from settings: {}", ocr_shortcut);
    println!(
        "Loading Translate shortcut from settings: {}",
        translate_shortcut
    );
    println!(
        "Loading Quick Translate shortcut from settings: {}",
        quick_translate_shortcut
    );
    println!(
        "Loading Word Selection Translate shortcut from settings: {}",
        word_selection_translate_shortcut
    );

    if let Err(e) = registry.ensure_path_added() {
        eprintln!("Warning: Failed to add PATH: {}", e);
    }

    let data_dir = get_data_dir();
    let clipboard_db =
        Arc::new(ClipboardDb::new(&data_dir).expect("Failed to initialize clipboard DB"));

    // 初始化 AI Chat 数据库
    let ai_chat_db_path = data_dir.join("ai_chat.db");
    let ai_chat_db =
        ai_chat_db::AiChatDb::new(ai_chat_db_path).expect("Failed to initialize AI chat DB");

    let show = CustomMenuItem::new("show", "显示窗口");
    let hide = CustomMenuItem::new("hide", "隐藏窗口");
    let clipboard_menu = CustomMenuItem::new("clipboard", "剪贴板历史");
    let toolbox_menu = CustomMenuItem::new("toolbox", "工具箱");
    let rss_reader_menu = CustomMenuItem::new("rss_reader", "RSS 阅读器");
    let desktop_boxes_menu = CustomMenuItem::new("desktop_boxes", "显示桌面 Box");
    let quit = CustomMenuItem::new("quit", "退出");
    let tray_menu = SystemTrayMenu::new()
        .add_item(show)
        .add_item(hide)
        .add_item(clipboard_menu)
        .add_item(toolbox_menu)
        .add_item(rss_reader_menu)
        .add_item(desktop_boxes_menu)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(quit);

    let mut system_tray = SystemTray::new()
        .with_id(commands::APP_TRAY_ID)
        .with_tooltip(commands::APP_TRAY_TOOLTIP)
        .with_menu(tray_menu);
    if let Ok(icon) = commands::app_window_icon() {
        system_tray = system_tray.with_icon(icon);
    }
    let db_for_state = clipboard_db.clone();

    tauri::Builder::default()
        .manage(AppState {
            storage: Mutex::new(storage),
            registry: Mutex::new(registry),
            settings: Mutex::new(settings_manager),
        })
        .manage(ClipboardState { db: db_for_state })
        .manage(ai_chat_commands::AiChatState {
            db: Mutex::new(ai_chat_db),
        })
        .manage(ScrollScreenshotState {
            session: Mutex::new(None),
        })
        .manage(music_player::MusicAudioState::default())
        .setup(move |app| {
            println!("Registering shortcuts at startup:");
            println!("  Quick launch: {}", initial_shortcut);
            println!("  Clipboard: {}", clipboard_shortcut);
            println!("  Toolbox: {}", toolbox_shortcut);
            println!("  AI Chat: {}", ai_chat_shortcut);
            println!("  OCR: {}", ocr_shortcut);
            println!("  Translate: {}", translate_shortcut);
            println!("  Quick Translate: {}", quick_translate_shortcut);

            if context_menu_enabled_on_start {
                let _ = context_menu::ContextMenuManager::register();
            } else if let Err(error) = context_menu::ContextMenuManager::register_desktop_box() {
                eprintln!("[ContextMenu] desktop Box registration failed: {}", error);
            }

            #[cfg(target_os = "windows")]
            start_single_instance_show_listener(app.handle(), single_instance_show_event);
            rss_reader::start_rss_reader_background_refresh(app.handle());
            kiro_account_tool::start_kiro_background_refresh(app.handle());

            let desktop_box_new_launch = desktop_layouts::desktop_box_launch_flag_enabled();
            let desktop_box_manage_launch =
                desktop_layouts::desktop_box_manage_launch_flag_enabled();
            if !desktop_box_new_launch && !desktop_box_manage_launch {
                // Do not replay requests left by a previous process. Requests
                // from a second live instance are handled by the listener.
                desktop_layouts::discard_pending_desktop_box_requests();
            }

            // All launch modes use the same post-event-loop reconciliation.
            // The desired Box IDs come from the store; an arbitrary existing
            // window is never treated as proof that restoration is complete.
            let desktop_box_app_handle = app.handle();
            std::thread::spawn(move || {
                for delay in [0u64, 150, 350] {
                    if delay > 0 {
                        std::thread::sleep(std::time::Duration::from_millis(delay));
                    }
                    match desktop_layouts::restore_desktop_box_windows(&desktop_box_app_handle) {
                        Ok(_) => break,
                        Err(error) => {
                            eprintln!("[DesktopBox] startup reconcile failed: {}", error);
                        }
                    }
                }

                if desktop_box_new_launch {
                    if !desktop_layouts::desktop_box_pending_exists() {
                        desktop_layouts::write_desktop_box_pending_request();
                    }
                    while desktop_layouts::desktop_box_pending_exists() {
                        if let Err(error) = desktop_layouts::handle_pending_desktop_box_request(
                            &desktop_box_app_handle,
                        ) {
                            eprintln!("[DesktopBox] startup create failed: {}", error);
                            break;
                        }
                    }
                } else if desktop_box_manage_launch {
                    if !desktop_layouts::desktop_box_manage_pending_exists() {
                        desktop_layouts::write_desktop_box_manage_pending_request();
                    }
                    if let Err(error) = desktop_layouts::handle_pending_desktop_box_manage_request(
                        &desktop_box_app_handle,
                    ) {
                        eprintln!("[DesktopBox] startup manage failed: {}", error);
                    }
                }
            });
            desktop_layouts::start_desktop_box_shell_monitor(&app.handle());
            desktop_layouts::start_desktop_box_icon_filter_lease_monitor();

            if !desktop_box_new_launch && !desktop_box_manage_launch {
                if let Some(payload) = video_player::pending_media_payload_from_args() {
                    video_player::write_pending_media_payload(&payload);
                    if let Some(label) = video_player::media_window_label(&payload.kind) {
                        let _ = commands::show_tool_window(label.to_string(), app.handle());
                    }
                } else if let Some(payload) = add_payload_from_args() {
                    write_add_pending_payload(&payload);
                    if let Some(window) = app.get_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                } else if rss_reader::rss_reader_launch_flag_enabled() {
                    let app_handle = app.handle();
                    tauri::async_runtime::spawn(async move {
                        let _ =
                            commands::show_tool_window("tool-rss-reader".to_string(), app_handle);
                    });
                }
            }

            // 延迟注册快捷键，避免启动时误触发
            let app_handle = app.handle();
            let initial_shortcut_clone = initial_shortcut.clone();
            let clipboard_shortcut_clone = clipboard_shortcut.clone();
            let toolbox_shortcut_clone = toolbox_shortcut.clone();
            let ai_chat_shortcut_clone = ai_chat_shortcut.clone();
            let ocr_shortcut_clone = ocr_shortcut.clone();
            let translate_shortcut_clone = translate_shortcut.clone();
            let quick_translate_shortcut_clone = quick_translate_shortcut.clone();
            let word_selection_translate_shortcut_clone = word_selection_translate_shortcut.clone();
            let clipboard_db_for_shortcuts = clipboard_db.clone();

            std::thread::spawn(move || {
                // 等待 1000ms 后再注册快捷键，避免启动时误触发
                std::thread::sleep(std::time::Duration::from_millis(1000));

                register_shortcut(&app_handle, &initial_shortcut_clone);
                register_clipboard_shortcut(&app_handle, &clipboard_shortcut_clone);
                register_toolbox_shortcut(&app_handle, &toolbox_shortcut_clone);
                register_ai_chat_shortcut(&app_handle, &ai_chat_shortcut_clone);
                register_toolbox_shortcut(&app_handle, &toolbox_shortcut_clone);
                register_ocr_screenshot_shortcut(&app_handle, &ocr_shortcut_clone);
                if let Err(error) =
                    register_translate_screenshot_shortcut(&app_handle, &translate_shortcut_clone)
                {
                    eprintln!("[Shortcuts] {}", error);
                }
                if let Err(error) =
                    register_quick_translate_shortcut(&app_handle, &quick_translate_shortcut_clone)
                {
                    eprintln!("[Shortcuts] {}", error);
                }
                if let Err(error) = register_word_selection_translate_shortcut(
                    &app_handle,
                    &word_selection_translate_shortcut_clone,
                ) {
                    eprintln!("[Shortcuts] {}", error);
                }
                register_screenshot_shortcuts(&app_handle);
                clipboard_commands::restore_favorite_shortcuts(
                    app_handle.clone(),
                    clipboard_db_for_shortcuts.clone(),
                );
                auto_clicker::restore_from_tool_data(app_handle.clone());

                // 方案A：预热 DXGI/GDI，消除首次截图延迟，不创建任何窗口
                std::thread::spawn(|| {
                    let _ = screenshots::Screen::all();
                    println!("[Warmup] Screenshot backend warmed up");
                });
                prewarm_screenshot_region_window(&app_handle);

                println!("[Shortcuts] All shortcuts registered after delay");
                // 再等待 500ms 后结束启动阶段，确保所有窗口都已初始化完成
                std::thread::sleep(std::time::Duration::from_millis(500));
                STARTUP_PHASE.store(false, Ordering::SeqCst);
                println!("[Shortcuts] Startup phase completed, shortcuts now active");
            });

            start_clipboard_monitor(app.handle(), clipboard_db.clone());

            // 初始化 MCP Manager 并连接所有已启用的服务器
            let mcp_manager = McpManager::new(app.handle());
            let mcp_state = McpManagerState(Arc::new(tokio::sync::Mutex::new(mcp_manager)));
            app.manage(mcp_state);
            if !mcp_server_configs.is_empty() {
                let mcp_handle = app.handle();
                tauri::async_runtime::spawn(async move {
                    if let Some(state) = mcp_handle.try_state::<McpManagerState>() {
                        let mut manager = state.0.lock().await;
                        manager.connect_all_enabled(&mcp_server_configs).await;
                    }
                });
            }

            // 启动时智能重建别名 - 使用缓存优化，只处理变化的部分
            let app_handle = app.handle();
            std::thread::spawn(move || {
                println!("[Background] Starting smart alias rebuild...");
                if let Some(state) = app_handle.try_state::<AppState>() {
                    if let (Ok(storage), Ok(registry)) =
                        (state.storage.lock(), state.registry.lock())
                    {
                        if let Ok(config) = storage.load() {
                            // 加载上次的别名缓存
                            let old_cache = storage.load_alias_cache().unwrap_or_default();
                            let old_aliases = old_cache.aliases;

                            // 构建当前的别名快照
                            let new_aliases = storage.build_alias_snapshot(&config);

                            // 清理旧版本遗留的 .lnk 文件
                            registry.cleanup_legacy_lnk_files();

                            let mut changed_count = 0;
                            let mut unchanged_count = 0;

                            // 只处理变化的别名
                            for item in &config.items {
                                let item_type = item.item_type.as_deref().unwrap_or("app");
                                let arguments = item.arguments.as_deref().unwrap_or("");

                                let current = (
                                    item.target_path.clone(),
                                    arguments.to_string(),
                                    item_type.to_string(),
                                );

                                // 检查是否有变化
                                let needs_update = match old_aliases.get(&item.alias) {
                                    Some(old) => old != &current, // 内容变化了
                                    None => true,                 // 新增的别名
                                };

                                if needs_update {
                                    // 批量注册别名（不广播）
                                    let _ = registry.register_alias_batch(
                                        &item.alias,
                                        &item.target_path,
                                        item.arguments.as_deref(),
                                        item_type,
                                    );
                                    changed_count += 1;
                                } else {
                                    unchanged_count += 1;
                                }

                                // 修复 startup_enabled 项目的注册表值格式
                                if item_type == "app" && item.startup_enabled {
                                    let _ =
                                        registry.set_startup(&item.alias, &item.target_path, true);
                                }
                            }

                            // 删除已移除的别名
                            for old_alias in old_aliases.keys() {
                                if !new_aliases.contains_key(old_alias) {
                                    let _ = registry.unregister_alias(old_alias);
                                    changed_count += 1;
                                }
                            }

                            // 如果有任何变化，统一广播一次
                            if changed_count > 0 {
                                registry.broadcast_app_paths_change();
                                println!("[Background] Broadcasted App Paths changes");
                            }

                            // 保存新的缓存
                            let new_cache = crate::storage::AliasCache {
                                aliases: new_aliases,
                                last_updated: std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap()
                                    .as_secs(),
                            };
                            let _ = storage.save_alias_cache(&new_cache);

                            println!(
                                "[Background] Alias rebuild completed: {} changed, {} unchanged",
                                changed_count, unchanged_count
                            );
                        }
                    }
                }
            });

            if let Some(state) = app.try_state::<ClipboardState>() {
                let arc_conn = state.db.get_conn();
                let conn = arc_conn.lock().unwrap();
                let _ = conn.execute(
                    "DELETE FROM history WHERE type = 'image' AND value LIKE 'data:image/%'",
                    [],
                );
            }
            Ok(())
        })
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { tray_id, .. } => {
                if tray_id != commands::APP_TRAY_ID {
                    return;
                }
                if let Some(w) = app.get_window("main") {
                    commands::apply_app_window_icon(&w);
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            SystemTrayEvent::MenuItemClick { tray_id, id, .. } => {
                if tray_id != commands::APP_TRAY_ID {
                    return;
                }
                match id.as_str() {
                    "show" => {
                        if let Some(w) = app.get_window("main") {
                            commands::apply_app_window_icon(&w);
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(w) = app.get_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "clipboard" => {
                        // 检查窗口是否存在，不存在则创建
                        if let Some(w) = app.get_window("clipboard") {
                            commands::apply_app_window_icon(&w);
                            let _ = w.center();
                            let _ = w.show();
                            let _ = w.set_focus();
                        } else {
                            // 动态创建剪贴板窗口
                            println!("Creating clipboard window from tray menu...");
                            match tauri::WindowBuilder::new(
                                app,
                                "clipboard",
                                tauri::WindowUrl::App("index.html".into()),
                            )
                            .title("剪贴板历史")
                            .inner_size(380.0, 600.0)
                            .min_inner_size(320.0, 400.0)
                            .resizable(true)
                            .decorations(false)
                            .transparent(true)
                            .always_on_top(true)
                            .center()
                            .skip_taskbar(true)
                            .build()
                            {
                                Ok(window) => {
                                    println!("Clipboard window created from tray");
                                    commands::apply_app_window_icon(&window);
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                                Err(e) => {
                                    eprintln!("Failed to create clipboard window: {:?}", e);
                                }
                            }
                        }
                    }
                    "toolbox" => {
                        // 打开主窗口并切换到工具箱模块
                        if let Some(w) = app.get_window("main") {
                            commands::apply_app_window_icon(&w);
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = w.emit("open-toolbox", ());
                        }
                    }
                    "rss_reader" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = commands::show_tool_window(
                                "tool-rss-reader".to_string(),
                                app_handle,
                            );
                        });
                    }
                    "desktop_boxes" => {
                        if let Err(error) = desktop_layouts::show_desktop_box_windows(app) {
                            eprintln!("[DesktopBox] show from tray failed: {}", error);
                        }
                    }
                    "quit" => {
                        QUITTING.store(true, Ordering::SeqCst);
                        desktop_layouts::disable_desktop_box_icon_filter();

                        // Hide Box WebViews before moving managed files back to
                        // the Explorer desktop. This prevents a live child
                        // window from obscuring the restored desktop icons.
                        let desktop_box_windows = app
                            .windows()
                            .into_iter()
                            .filter_map(|(label, window)| {
                                label.starts_with("desktop-box-").then_some(window)
                            })
                            .collect::<Vec<_>>();
                        for window in &desktop_box_windows {
                            let _ = window.hide();
                        }
                        match desktop_layouts::restore_desktop_icons_before_exit() {
                            Ok(restored) => {
                                eprintln!("[Exit] Restored {} managed desktop item(s)", restored)
                            }
                            Err(error) => {
                                eprintln!("[Exit] Desktop icon restore incomplete: {}", error)
                            }
                        }

                        // 退出前保存别名缓存
                        if let Some(state) = app.try_state::<AppState>() {
                            if let Ok(storage) = state.storage.lock() {
                                if let Ok(config) = storage.load() {
                                    let snapshot = storage.build_alias_snapshot(&config);
                                    let cache = crate::storage::AliasCache {
                                        aliases: snapshot,
                                        last_updated: std::time::SystemTime::now()
                                            .duration_since(std::time::UNIX_EPOCH)
                                            .unwrap()
                                            .as_secs(),
                                    };
                                    let _ = storage.save_alias_cache(&cache);
                                    println!("[Exit] Alias cache saved");
                                }
                            }
                        }

                        // 退出前关闭所有 MCP 子进程
                        if let Some(mcp_state) = app.try_state::<McpManagerState>() {
                            tauri::async_runtime::block_on(async {
                                let mut manager = mcp_state.0.lock().await;
                                manager.shutdown_all().await;
                            });
                        }
                        ocr::stop_wechat_ocr();

                        for (_, w) in app.windows() {
                            let _ = w.close();
                        }
                        app.exit(0);
                    }
                    _ => {}
                }
            }
            _ => {}
        })
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                if QUITTING.load(Ordering::SeqCst) {
                    return;
                }
                let window = event.window();
                let label = window.label();
                if label.starts_with("desktop-box-") {
                    eprintln!("[DesktopBox] close requested label={}", label);
                    if let Err(error) = desktop_layouts::persist_box_geometry_for_window(&window) {
                        eprintln!("[DesktopBox] close geometry save failed: {}", error);
                    }
                    return;
                }
                if label == "quicklauncher" || label == "clipboard" {
                    let _ = window.hide();
                    api.prevent_close();
                    return;
                }
                if label == "tool-rss-reader" && rss_reader::rss_reader_minimize_flag_enabled() {
                    let _ = window.hide();
                    api.prevent_close();
                    return;
                }
                if label == "tool-wx-channels-downloader" {
                    wx_channels_download::shutdown_wx_channels_runtime(&window.app_handle());
                    return;
                }
                // tool-* 窗口：允许真正关闭，下次打开时动态重建，节省内存
                let app_handle = window.app_handle();
                if let Some(state) = app_handle.try_state::<AppState>() {
                    if let Ok(sm) = state.settings.lock() {
                        if let Ok(s) = sm.load() {
                            if s.close_to_tray && s.show_in_tray {
                                let _ = window.hide();
                                api.prevent_close();
                            }
                        }
                    }
                }
            }
        })
        .invoke_handler({
            let core_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![
                    commands::get_all_items,
                    commands::add_item,
                    commands::update_item,
                    commands::delete_item,
                    commands::launch_item,
                    commands::launch_item_with_profile,
                    commands::get_all_groups,
                    commands::add_group,
                    commands::update_group,
                    commands::delete_group,
                    commands::reorder_groups,
                    commands::export_config,
                    commands::import_config,
                    commands::get_batch_dir,
                    commands::check_alias_exists,
                    commands::cleanup_duplicate_groups,
                    commands::regenerate_all_aliases,
                    commands::resolve_shortcut,
                    commands::load_settings,
                    commands::save_settings,
                    desktop_layouts::desktop_layout_get_store,
                    desktop_layouts::desktop_layout_save_store,
                    desktop_layouts::desktop_layout_scan_icons,
                    desktop_layouts::desktop_layout_apply,
                    desktop_layouts::desktop_box_create,
                    desktop_layouts::desktop_box_get,
                    desktop_layouts::desktop_box_update_name,
                    desktop_layouts::desktop_box_update_collapsed,
                    desktop_layouts::desktop_box_update_hidden,
                    desktop_layouts::desktop_box_update_view_mode,
                    desktop_layouts::desktop_box_set_sort_mode,
                    desktop_layouts::desktop_box_update_appearance,
                    desktop_layouts::desktop_box_update_geometry,
                    desktop_layouts::desktop_box_update_scale_factor,
                    desktop_layouts::desktop_box_start_resize,
                    desktop_layouts::desktop_box_start_drag,
                    desktop_layouts::desktop_box_persist_geometry,
                    desktop_layouts::desktop_box_delete,
                    desktop_layouts::desktop_box_assign_paths,
                    desktop_layouts::desktop_box_remove_icon,
                    desktop_layouts::desktop_box_place_icon,
                    desktop_layouts::desktop_box_open_icon,
                    desktop_layouts::desktop_box_show_context_menu,
                    desktop_layouts::desktop_box_start_icon_drag,
                    desktop_layouts::desktop_box_window_ready,
                    commands::set_auto_start,
                    commands::set_context_menu,
                    commands::get_context_menu_status,
                    commands::launcher_take_pending_add_request,
                    commands::validate_path,
                    commands::detect_file_type,
                    commands::open_data_dir,
                    commands::recover_from_registry,
                    commands::save_recovered_items,
                    commands::check_recoverable_backup,
                    commands::list_backups,
                    commands::restore_from_backup,
                    commands::extract_icon,
                    commands::scan_installed_programs,
                    commands::validate_paths,
                    commands::launch_group,
                    commands::get_item_stats,
                    commands::update_global_shortcut,
                    commands::update_clipboard_shortcut,
                    commands::update_toolbox_shortcut,
                    commands::update_ai_chat_shortcut,
                    commands::show_tool_window,
                    commands::launch_system_program,
                    commands::check_everything_status,
                    commands::search_everything,
                    commands::open_path,
                    commands::query_weather,
                    commands::load_tool_data,
                    commands::save_tool_data,
                    commands::fetch_website_favicon,
                    commands::resolve_bookmark_icon_source,
                    commands::refresh_tray_icon,
                    commands::file_rename_inspect_paths,
                    commands::file_rename_scan_dir,
                    commands::file_rename_apply,
                    commands::show_in_folder,
                    commands::open_file,
                    commands::http_get,
                    commands::http_post_json,
                    commands::get_chinese_font,
                    commands::get_model_dir,
                    commands::set_model_dir,
                    commands::get_custom_model_dir,
                    commands::check_model_exists,
                    commands::validate_watermark_auto_models,
                    commands::save_base64_image,
                    commands::install_skill_to_agent,
                    commands::download_model_file,
                    commands::read_file_for_ai,
                    kiro_account_tool::kiro_account_tool_get_state,
                    kiro_account_tool::kiro_account_tool_get_fast_state,
                    kiro_account_tool::kiro_account_tool_list_accounts,
                    kiro_account_tool::kiro_account_tool_local_status,
                    kiro_account_tool::kiro_account_tool_oauth_start,
                    kiro_account_tool::kiro_account_tool_oauth_complete,
                    kiro_account_tool::kiro_account_tool_oauth_cancel,
                    kiro_account_tool::kiro_account_tool_oauth_submit_callback_url,
                    kiro_account_tool::kiro_account_tool_import_local,
                    kiro_account_tool::kiro_account_tool_add_token,
                    kiro_account_tool::kiro_account_tool_refresh_account,
                    kiro_account_tool::kiro_account_tool_refresh_all,
                    kiro_account_tool::kiro_account_tool_refresh_stale,
                    kiro_account_tool::kiro_account_tool_import_json,
                    kiro_account_tool::kiro_account_tool_export,
                    kiro_account_tool::kiro_account_tool_export_safe,
                    kiro_account_tool::kiro_account_tool_update_tags,
                    kiro_account_tool::kiro_account_tool_delete,
                    kiro_account_tool::kiro_account_tool_switch,
                    kiro_account_tool::kiro_account_tool_launch,
                    kiro_account_tool::kiro_account_tool_launch_isolated,
                    kiro_account_tool::kiro_account_tool_list_instances,
                    kiro_account_tool::kiro_account_tool_stop_instance,
                    kiro_account_tool::kiro_account_tool_clean_instance,
                    kiro_account_tool::kiro_account_tool_list_local_backups,
                    kiro_account_tool::kiro_account_tool_restore_local_backup,
                    kiro_account_tool::kiro_account_tool_reveal_data_dir,
                    kiro_account_tool::kiro_account_tool_set_background_refresh,
                    kiro_account_tool::kiro_account_tool_get_background_refresh,
                    kiro_account_tool::kiro_account_tool_get_background_status,
                    kiro_account_tool::kiro_account_tool_set_tool_settings,
                ]);
            let clipboard_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![
                    clipboard_commands::clipboard_query,
                    clipboard_commands::clipboard_toggle_favorite,
                    clipboard_commands::clipboard_toggle_pin,
                    clipboard_commands::clipboard_update_note,
                    clipboard_commands::clipboard_update_text_value,
                    clipboard_commands::clipboard_update_favorite_shortcut,
                    clipboard_commands::clipboard_delete,
                    clipboard_commands::clipboard_clear,
                    clipboard_commands::clipboard_clear_base64_images,
                    clipboard_commands::clipboard_copy_item,
                    clipboard_commands::clipboard_paste_item,
                ]);
            let ocr_translate_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![
                    ocr_recognize,
                    detect_wechat_ocr_environment,
                    prepare_wechat_ocr_environment,
                    stop_wechat_ocr,
                    detect_paddle_ocr_environment,
                    prepare_paddle_ocr_environment,
                    stop_paddle_ocr,
                    detect_wps_ocr_environment,
                    prepare_wps_ocr_environment,
                    stop_wps_ocr,
                    recognize_table,
                    recognize_qrcode,
                    has_qrcode,
                    capture_screenshot,
                    capture_screenshot_region,
                    crop_image_region,
                    update_ocr_screenshot_shortcut,
                    translate_text,
                    update_translate_screenshot_shortcut,
                    update_quick_translate_shortcut,
                    update_word_selection_translate_shortcut,
                    test_translate_window,
                ]);
            let screenshot_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![
                    screenshot_get_screens_info,
                    screenshot_get_selectable_windows,
                    screenshot_capture_fullscreen,
                    screenshot_region_take_pending_bg,
                    screenshot_capture_screen,
                    screenshot_capture_region,
                    screenshot_capture_long_region,
                    screenshot_long_capture_step,
                    scroll_screenshot_init,
                    scroll_screenshot_focus,
                    scroll_screenshot_scroll_through,
                    scroll_screenshot_step,
                    scroll_screenshot_export,
                    scroll_screenshot_clear,
                    screenshot_save_file,
                    screenshot_get_default_dir,
                    screenshot_generate_filename,
                    update_screenshot_fullscreen_shortcut,
                    update_screenshot_region_shortcut,
                ]);
            let network_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![
                    network_ping,
                    network_dns_query,
                    network_get_ip_info,
                    network_scan_port,
                    network_list_local_ports,
                    network_kill_process,
                    network_reveal_process_path,
                    network_traceroute,
                ]);
            let web_check_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![web_check_scan]);
            let github_store_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![
                    github_store_search_repositories,
                    github_store_daily,
                    github_store_repository,
                ]);
            let rss_reader_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![
                    rss_reader::rss_reader_fetch_feed,
                    rss_reader::rss_reader_fetch_web_feed,
                    rss_reader::rss_reader_apply_resident_settings,
                    rss_reader::rss_reader_ensure_tray_icon,
                    rss_reader::rss_reader_load_article_detail,
                    rss_reader::rss_reader_load_article_page,
                    rss_reader::rss_reader_load_store,
                    rss_reader::rss_reader_upsert_articles,
                    rss_reader::rss_reader_update_article_translation,
                    rss_reader::rss_reader_update_article_states,
                    rss_reader::rss_reader_delete_articles,
                    rss_reader::rss_reader_delete_feed_articles,
                    rss_reader::rss_reader_save_store,
                ]);
            let database_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![
                    database_tools::database_execute_query,
                    database_tools::database_delete_row,
                    database_tools::database_insert_row,
                    database_tools::database_load_schema,
                    database_tools::database_preview_object,
                    database_tools::database_test_connection,
                    database_tools::database_update_cell,
                ]);
            let ai_chat_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![
                    ai_chat_commands::ai_chat_list_threads,
                    ai_chat_commands::ai_chat_get_thread,
                    ai_chat_commands::ai_chat_create_thread,
                    ai_chat_commands::ai_chat_update_thread_title,
                    ai_chat_commands::ai_chat_update_thread_model,
                    ai_chat_commands::ai_chat_update_thread_system_prompt,
                    ai_chat_commands::ai_chat_update_thread_params,
                    ai_chat_commands::ai_chat_archive_thread,
                    ai_chat_commands::ai_chat_unarchive_thread,
                    ai_chat_commands::ai_chat_delete_thread,
                    ai_chat_commands::ai_chat_list_messages,
                    ai_chat_commands::ai_chat_add_message,
                    ai_chat_commands::ai_chat_delete_message,
                    ai_chat_commands::ai_chat_clear_thread_messages,
                    ai_chat_commands::ai_chat_get_thread_message_count,
                    ai_chat_commands::ai_chat_get_total_threads,
                    ai_chat_commands::ai_chat_add_memory,
                    ai_chat_commands::ai_chat_list_memories,
                    ai_chat_commands::ai_chat_search_memories,
                    ai_chat_commands::ai_chat_update_memory,
                    ai_chat_commands::ai_chat_delete_memory,
                    ai_chat_commands::ai_chat_get_memories_by_category,
                    ai_chat_commands::ai_chat_extract_memories,
                    ai_chat_commands::ai_chat_get_thread_summary,
                    ai_chat_commands::ai_chat_upsert_thread_summary,
                    ai_chat_commands::ai_chat_delete_thread_summary,
                ]);
            let auto_clicker_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![
                    auto_clicker::auto_clicker_cursor_position,
                    auto_clicker::auto_clicker_register_shortcut,
                    auto_clicker::auto_clicker_set_config,
                    auto_clicker::auto_clicker_start,
                    auto_clicker::auto_clicker_status,
                    auto_clicker::auto_clicker_stop,
                    auto_clicker::auto_clicker_toggle,
                    auto_clicker::auto_clicker_unregister_shortcut,
                ]);
            let image_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![
                    commands::image_compress,
                    commands::image_compress_advanced,
                    commands::image_crop,
                    commands::image_resize,
                    commands::image_transform,
                    commands::image_filter,
                    commands::image_read_exif,
                    commands::image_strip_exif,
                    commands::image_exiftool_status,
                    commands::image_exif_apply_edits,
                    commands::image_convert,
                    commands::image_extract_palette,
                    image_ico_generator::image_ico_generate,
                    image_ico_generator::image_ico_inspect_files,
                    image_ico_generator::image_ico_scan_directory,
                    image_batch_process::image_batch_inspect_paths,
                    image_batch_process::image_batch_scan_dir,
                    image_batch_process::image_batch_process,
                    image_ai_upscale::check_realesrgan_runtime,
                    image_ai_upscale::download_realesrgan_runtime,
                    image_ai_upscale::image_ai_upscale,
                    image_ai_upscale::copy_ai_upscale_output,
                    image_bg_remove::image_bg_remove_batch,
                    image_watermark_remove::image_watermark_auto_detect,
                    image_watermark_remove::image_watermark_auto_remove,
                    image_watermark_remove::image_magic_erase,
                    image_watermark_remove::image_watermark_manual_remove,
                    image_watermark_remove::image_watermark_repair_with_mask,
                    wechat_meme::convert_to_wechat_meme,
                    wechat_meme::copy_wechat_meme_to_clipboard,
                    wechat_meme::export_wechat_meme,
                ]);
            let mcp_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![
                    mcp_commands::mcp_list_tools,
                    mcp_commands::mcp_call_tool,
                    mcp_commands::mcp_connect_server,
                    mcp_commands::mcp_disconnect_server,
                    mcp_commands::mcp_get_servers_status,
                ]);
            let media_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![
                    media_convert::check_ffmpeg,
                    media_convert::get_file_size,
                    media_convert::get_media_info,
                    media_convert::convert_media,
                    media_convert::batch_convert_media,
                    screen_recording::screen_recording_default_output_path,
                    screen_recording::screen_recording_get_status,
                    screen_recording::screen_recording_list_audio_devices,
                    screen_recording::screen_recording_list_windows,
                    screen_recording::screen_recording_pause,
                    screen_recording::screen_recording_resume,
                    screen_recording::screen_recording_start,
                    screen_recording::screen_recording_stop,
                    screen_recording_set_window_capture_excluded,
                    download_manager::download_manager_command,
                    douyin_download::douyin_download_command,
                    video_player::media_file_association_status,
                    video_player::media_open_default_apps_settings,
                    video_player::media_register_file_associations,
                    video_player::media_take_pending_open,
                    video_player::media_unregister_file_associations,
                    music_player::music_audio_pause,
                    music_player::music_audio_ffmpeg_status,
                    music_player::music_audio_play,
                    music_player::music_audio_probe,
                    music_player::music_media_context,
                    music_player::music_audio_resume,
                    music_player::music_audio_seek,
                    music_player::music_audio_set_speed,
                    music_player::music_audio_set_volume,
                    music_player::music_audio_status,
                    music_player::music_audio_stop,
                    tikhub_download::tikhub_download_command,
                    video_download::video_download_command,
                    wx_channels_download::wx_channels_download_command,
                    video_player::video_player_mpv_open,
                    video_player::video_player_probe_media,
                    video_player::video_player_mpv_status,
                    sherpa_audio_tools::sherpa_audio_check_model,
                    sherpa_audio_tools::sherpa_audio_check_runtime,
                    sherpa_audio_tools::sherpa_audio_denoise,
                    sherpa_audio_tools::sherpa_audio_extract_archive,
                    sherpa_audio_tools::sherpa_audio_separate,
                    sherpa_audio_tools::sherpa_audio_transcribe,
                    sherpa_audio_tools::sherpa_audio_tts,
                    video_watermark_remove::check_propainter_runtime,
                    video_watermark_remove::ensure_propainter_dirs,
                    video_watermark_remove::video_watermark_remove_fixed,
                    video_watermark_remove::video_watermark_remove_propainter,
                ]);
            let archive_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![
                    archive_tools::archive_compress,
                    archive_tools::archive_default_extract_dir,
                    archive_tools::archive_extract,
                    archive_tools::archive_inspect_paths,
                    archive_tools::archive_list,
                    archive_tools::archive_runtime_status,
                    archive_tools::archive_suggest_output_path,
                ]);
            let system_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![
                    system_tools::system_cleanup_delete,
                    system_tools::system_cleanup_delete_with_options,
                    system_tools::system_cleanup_cancel,
                    system_tools::system_cleanup_preview,
                    system_tools::system_cleanup_scan,
                    system_tools::system_cleanup_scan_with_options,
                    system_tools::system_context_menu_delete,
                    system_tools::system_context_menu_export,
                    system_tools::system_context_menu_list,
                    system_tools::system_context_menu_save,
                    system_tools::system_context_menu_set_disabled,
                    system_tools::system_explorer_refresh,
                    system_tools::system_disk_usage_cancel_scan,
                    system_tools::system_disk_usage_scan,
                    system_tools::system_disk_volumes,
                    system_tools::system_drivers_action,
                    system_tools::system_drivers_list,
                    system_tools::system_dns_adapters,
                    system_tools::system_dns_flush,
                    system_tools::system_dns_set,
                    system_tools::system_env_delete,
                    system_tools::system_env_list,
                    system_tools::system_env_open_editor,
                    system_tools::system_env_update,
                    system_tools::system_env_update_path,
                    system_tools::system_env_validate_paths,
                    system_tools::system_force_delete,
                    system_tools::system_hosts_open_dir,
                    system_tools::system_hosts_read,
                    system_tools::system_hosts_resolve,
                    system_tools::system_hosts_save,
                    system_tools::system_hosts_save_admin,
                    system_tools::system_info_overview,
                    system_tools::system_installed_app_uninstall,
                    system_tools::system_installed_app_leftovers_delete,
                    system_tools::system_installed_app_leftovers_scan,
                    system_tools::system_installed_apps_list,
                    system_tools::system_large_files_scan,
                    system_tools::system_locks_kill,
                    system_tools::system_locks_query,
                    system_tools::system_monitor_snapshot,
                    system_tools::system_network_repair_action,
                    system_tools::system_network_repair_snapshot,
                    system_tools::system_print_job_action,
                    system_tools::system_printer_action,
                    system_tools::system_printer_diagnose,
                    system_tools::system_printer_manager_snapshot,
                    system_tools::system_service_action,
                    system_tools::system_services_list,
                    system_tools::system_shutdown_cancel,
                    system_tools::system_shutdown_restart,
                    system_tools::system_shutdown_schedule,
                    system_tools::system_shutdown_status,
                    system_tools::system_shutdown_task_delete,
                    system_tools::system_shutdown_task_save,
                    system_tools::system_startup_list,
                    system_tools::system_startup_list_by_kind,
                    system_tools::system_startup_set_enabled,
                    system_tools::system_task_action,
                    system_tools::system_task_detail,
                    system_tools::system_tasks_list,
                    system_tools::system_tasks_summary_list,
                    system_tools::system_windows_update_action,
                    system_tools::system_windows_update_status,
                    system_tools::system_wsl_action,
                    system_tools::system_wsl_status,
                ]);
            let document_handler: Box<tauri::InvokeHandler<tauri::Wry>> =
                Box::new(tauri::generate_handler![
                    pdf_tools::check_ghostscript,
                    pdf_tools::compress_pdf_gs,
                    pdf_tools::pdf_to_images_gs,
                    pdf_word_ocr::doc_pdf_ocr_to_word,
                    doc_convert::get_pandoc_dir,
                    doc_convert::get_custom_pandoc_path,
                    doc_convert::set_pandoc_path,
                    doc_convert::clear_pandoc_path,
                    doc_convert::check_pandoc_runtime,
                    doc_convert::download_pandoc,
                    doc_convert::pandoc_convert_document,
                    markitdown_convert::markitdown_get_custom_python_path,
                    markitdown_convert::markitdown_set_python_path,
                    markitdown_convert::markitdown_clear_python_path,
                    markitdown_convert::markitdown_check_runtime,
                    markitdown_convert::markitdown_install_runtime,
                    markitdown_convert::markitdown_convert_file,
                    markitdown_convert::markitdown_list_plugins,
                    excel_merge::merge_excel_files,
                    excel_split::get_excel_headers,
                    excel_split::split_excel_file,
                    excel_diff::diff_excel_files,
                    excel_convert::convert_spreadsheet,
                    excel_remove_empty::remove_empty_rows,
                    excel_preview::excel_preview_get_workbook,
                    excel_preview::excel_preview_get_sheet_page,
                    excel_formula_to_value::convert_excel_formulas_to_values,
                    excel_remove_duplicates::remove_excel_duplicates,
                    tencent_bank_card_ocr::recognize_tencent_bank_card_ocr,
                    tencent_general_invoice_ocr::recognize_tencent_general_invoice_ocr,
                    tencent_table_ocr::recognize_tencent_table_accurate_ocr,
                    word_format::check_word_ai_runtime,
                    word_format::word_ai_compare_documents,
                    word_format::word_ai_duplicate_check,
                    word_format::word_ai_semantic_search,
                    word_format::word_format_document,
                    software_copyright::check_software_copyright_text_model_runtime,
                    software_copyright::software_copyright_generate_main_functions,
                    software_copyright::software_copyright_scan_project,
                    software_copyright::software_copyright_write_files,
                    software_copyright::software_copyright_write_docx,
                ]);
            move |invoke: tauri::Invoke<tauri::Wry>| {
                let command = invoke.message.command().to_string();
                match command.as_str() {
                    c if c.starts_with("clipboard_") => clipboard_handler(invoke),
                    c if c.starts_with("ai_chat_") => ai_chat_handler(invoke),
                    c if c.starts_with("auto_clicker_") => auto_clicker_handler(invoke),
                    c if c.starts_with("network_") => network_handler(invoke),
                    c if c.starts_with("web_check_") => web_check_handler(invoke),
                    c if c.starts_with("github_store_") => github_store_handler(invoke),
                    c if c.starts_with("rss_reader_") => rss_reader_handler(invoke),
                    c if c.starts_with("database_") => database_handler(invoke),
                    c if c.starts_with("archive_") => archive_handler(invoke),
                    c if c.starts_with("screenshot_") || c.starts_with("scroll_screenshot_") => {
                        screenshot_handler(invoke)
                    }
                    c if c.starts_with("mcp_") => mcp_handler(invoke),
                    c if c.starts_with("media_") => media_handler(invoke),
                    c if c.starts_with("system_") => system_handler(invoke),
                    c if c.starts_with("screen_recording_") => media_handler(invoke),
                    c if c.starts_with("video_player_") => media_handler(invoke),
                    c if c.starts_with("video_watermark_remove_") => media_handler(invoke),
                    c if c.starts_with("image_") => image_handler(invoke),
                    c if c.starts_with("excel_")
                        || c.starts_with("word_")
                        || c.starts_with("doc_")
                        || c.starts_with("markitdown_") =>
                    {
                        document_handler(invoke)
                    }
                    "ocr_recognize"
                    | "detect_wechat_ocr_environment"
                    | "prepare_wechat_ocr_environment"
                    | "stop_wechat_ocr"
                    | "detect_paddle_ocr_environment"
                    | "prepare_paddle_ocr_environment"
                    | "stop_paddle_ocr"
                    | "detect_wps_ocr_environment"
                    | "prepare_wps_ocr_environment"
                    | "stop_wps_ocr"
                    | "recognize_table"
                    | "recognize_qrcode"
                    | "has_qrcode"
                    | "capture_screenshot"
                    | "capture_screenshot_region"
                    | "crop_image_region"
                    | "update_ocr_screenshot_shortcut"
                    | "translate_text"
                    | "update_translate_screenshot_shortcut"
                    | "update_quick_translate_shortcut"
                    | "update_word_selection_translate_shortcut"
                    | "test_translate_window" => ocr_translate_handler(invoke),
                    "update_screenshot_fullscreen_shortcut"
                    | "update_screenshot_region_shortcut" => screenshot_handler(invoke),
                    "check_realesrgan_runtime"
                    | "download_realesrgan_runtime"
                    | "copy_ai_upscale_output"
                    | "convert_to_wechat_meme"
                    | "copy_wechat_meme_to_clipboard"
                    | "export_wechat_meme" => image_handler(invoke),
                    "check_ffmpeg"
                    | "get_file_size"
                    | "get_media_info"
                    | "convert_media"
                    | "batch_convert_media"
                    | "screen_recording_set_window_capture_excluded"
                    | "download_manager_command"
                    | "douyin_download_command"
                    | "tikhub_download_command"
                    | "video_download_command"
                    | "wx_channels_download_command"
                    | "music_audio_pause"
                    | "music_audio_ffmpeg_status"
                    | "music_audio_play"
                    | "music_audio_probe"
                    | "music_media_context"
                    | "music_audio_resume"
                    | "music_audio_seek"
                    | "music_audio_set_speed"
                    | "music_audio_set_volume"
                    | "music_audio_status"
                    | "music_audio_stop"
                    | "video_player_mpv_open"
                    | "video_player_probe_media"
                    | "video_player_mpv_status"
                    | "sherpa_audio_check_model"
                    | "sherpa_audio_check_runtime"
                    | "sherpa_audio_denoise"
                    | "sherpa_audio_extract_archive"
                    | "sherpa_audio_separate"
                    | "sherpa_audio_transcribe"
                    | "sherpa_audio_tts"
                    | "check_propainter_runtime"
                    | "ensure_propainter_dirs"
                    | "video_watermark_remove_fixed"
                    | "video_watermark_remove_propainter" => media_handler(invoke),
                    "check_ghostscript"
                    | "compress_pdf_gs"
                    | "pdf_to_images_gs"
                    | "get_pandoc_dir"
                    | "get_custom_pandoc_path"
                    | "set_pandoc_path"
                    | "clear_pandoc_path"
                    | "check_pandoc_runtime"
                    | "download_pandoc"
                    | "pandoc_convert_document"
                    | "markitdown_get_custom_python_path"
                    | "markitdown_set_python_path"
                    | "markitdown_clear_python_path"
                    | "markitdown_check_runtime"
                    | "markitdown_install_runtime"
                    | "markitdown_convert_file"
                    | "markitdown_list_plugins"
                    | "merge_excel_files"
                    | "get_excel_headers"
                    | "split_excel_file"
                    | "diff_excel_files"
                    | "convert_spreadsheet"
                    | "remove_empty_rows"
                    | "convert_excel_formulas_to_values"
                    | "remove_excel_duplicates"
                    | "recognize_tencent_bank_card_ocr"
                    | "recognize_tencent_general_invoice_ocr"
                    | "recognize_tencent_table_accurate_ocr"
                    | "check_word_ai_runtime"
                    | "check_software_copyright_text_model_runtime"
                    | "software_copyright_generate_main_functions"
                    | "software_copyright_scan_project"
                    | "software_copyright_write_files"
                    | "software_copyright_write_docx" => document_handler(invoke),
                    _ => core_handler(invoke),
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
