use enigo::{Enigo, MouseButton, MouseControllable};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, GlobalShortcutManager, Manager};

const MIN_INTERVAL_MS: u64 = 10;
const MAX_INTERVAL_MS: u64 = 600_000;
const MAX_START_DELAY_MS: u64 = 60_000;
const MAX_PRESS_DURATION_MS: u64 = 1_000;
const MAX_CLICK_LIMIT: u64 = 10_000_000;
const MAX_POINTS: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClickPoint {
    pub x: i32,
    pub y: i32,
    #[serde(default)]
    pub delay_ms: u64,
    #[serde(default = "default_point_label")]
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoClickerConfig {
    #[serde(default = "default_interval_ms")]
    pub interval_ms: u64,
    #[serde(default = "default_button")]
    pub button: String,
    #[serde(default = "default_click_mode")]
    pub click_mode: String,
    #[serde(default)]
    pub max_clicks: Option<u64>,
    #[serde(default)]
    pub start_delay_ms: u64,
    #[serde(default = "default_press_duration_ms")]
    pub press_duration_ms: u64,
    #[serde(default = "default_target_mode")]
    pub target_mode: String,
    #[serde(default)]
    pub points: Vec<ClickPoint>,
    #[serde(default = "default_return_to_original")]
    pub return_to_original: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoClickerStatus {
    pub running: bool,
    pub clicks_done: u64,
    pub shortcut: Option<String>,
    pub config: AutoClickerConfig,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone)]
struct PersistedAutoClickerSettings {
    config: AutoClickerConfig,
    shortcut: String,
    shortcut_enabled: bool,
}

struct AutoClickerState {
    running: AtomicBool,
    clicks_done: AtomicU64,
    run_id: AtomicU64,
    config: Mutex<AutoClickerConfig>,
    shortcut: Mutex<Option<String>>,
}

impl AutoClickerState {
    fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
            clicks_done: AtomicU64::new(0),
            run_id: AtomicU64::new(0),
            config: Mutex::new(AutoClickerConfig::default()),
            shortcut: Mutex::new(None),
        }
    }
}

impl Default for AutoClickerConfig {
    fn default() -> Self {
        Self {
            interval_ms: default_interval_ms(),
            button: default_button(),
            click_mode: default_click_mode(),
            max_clicks: None,
            start_delay_ms: 0,
            press_duration_ms: default_press_duration_ms(),
            target_mode: default_target_mode(),
            points: Vec::new(),
            return_to_original: default_return_to_original(),
        }
    }
}

fn default_interval_ms() -> u64 {
    100
}

fn default_button() -> String {
    "left".to_string()
}

fn default_click_mode() -> String {
    "single".to_string()
}

fn default_press_duration_ms() -> u64 {
    10
}

fn default_point_label() -> String {
    "点击点".to_string()
}

fn default_target_mode() -> String {
    "current".to_string()
}

fn default_return_to_original() -> bool {
    true
}

fn state() -> &'static AutoClickerState {
    static STATE: OnceLock<AutoClickerState> = OnceLock::new();
    STATE.get_or_init(AutoClickerState::new)
}

fn normalize_config(mut config: AutoClickerConfig) -> AutoClickerConfig {
    config.interval_ms = config.interval_ms.clamp(MIN_INTERVAL_MS, MAX_INTERVAL_MS);
    config.start_delay_ms = config.start_delay_ms.min(MAX_START_DELAY_MS);
    config.press_duration_ms = config.press_duration_ms.min(MAX_PRESS_DURATION_MS);
    config.button = match config.button.to_lowercase().as_str() {
        "right" => "right".to_string(),
        "middle" => "middle".to_string(),
        _ => "left".to_string(),
    };
    config.click_mode = match config.click_mode.to_lowercase().as_str() {
        "double" => "double".to_string(),
        _ => "single".to_string(),
    };
    config.target_mode = match config.target_mode.to_lowercase().as_str() {
        "fixed" => "fixed".to_string(),
        "sequence" => "sequence".to_string(),
        _ => "current".to_string(),
    };
    config.points = config
        .points
        .into_iter()
        .take(MAX_POINTS)
        .map(|mut point| {
            point.delay_ms = point.delay_ms.min(MAX_INTERVAL_MS);
            if point.label.trim().is_empty() {
                point.label = default_point_label();
            }
            point
        })
        .collect();
    if config.target_mode == "fixed" && config.points.is_empty() {
        config.target_mode = "current".to_string();
    }
    if config.target_mode == "sequence" && config.points.is_empty() {
        config.target_mode = "current".to_string();
    }
    config.max_clicks = config
        .max_clicks
        .and_then(|value| (value > 0).then_some(value.min(MAX_CLICK_LIMIT)));
    config
}

fn mouse_button(button: &str) -> MouseButton {
    match button {
        "right" => MouseButton::Right,
        "middle" => MouseButton::Middle,
        _ => MouseButton::Left,
    }
}

fn current_status() -> AutoClickerStatus {
    let state = state();
    let config = state
        .config
        .lock()
        .map(|config| config.clone())
        .unwrap_or_default();
    let shortcut = state
        .shortcut
        .lock()
        .ok()
        .and_then(|shortcut| shortcut.clone());

    AutoClickerStatus {
        running: state.running.load(Ordering::SeqCst),
        clicks_done: state.clicks_done.load(Ordering::SeqCst),
        shortcut,
        config,
    }
}

fn load_persisted_settings() -> Option<PersistedAutoClickerSettings> {
    let data_path = crate::storage::Storage::get_config_dir()
        .ok()?
        .join("tool_data.json");
    let content = std::fs::read_to_string(data_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;
    let auto_clicker = value.get("autoClicker")?;

    let config = auto_clicker
        .get("config")
        .and_then(|config| serde_json::from_value::<AutoClickerConfig>(config.clone()).ok())
        .map(normalize_config)
        .unwrap_or_default();
    let shortcut = auto_clicker
        .get("shortcut")
        .and_then(|shortcut| shortcut.as_str())
        .map(str::trim)
        .filter(|shortcut| !shortcut.is_empty())
        .unwrap_or("F8")
        .to_string();
    let shortcut_enabled = auto_clicker
        .get("shortcutEnabled")
        .and_then(|enabled| enabled.as_bool())
        .unwrap_or(false);

    Some(PersistedAutoClickerSettings {
        config,
        shortcut,
        shortcut_enabled,
    })
}

fn set_saved_config(config: AutoClickerConfig) -> AutoClickerConfig {
    let config = normalize_config(config);
    if let Ok(mut saved) = state().config.lock() {
        *saved = config.clone();
    }
    config
}

fn sleep_checked(run_id: u64, duration_ms: u64) -> bool {
    let state = state();
    let mut remaining = duration_ms;

    while remaining > 0 {
        if !state.running.load(Ordering::SeqCst) || state.run_id.load(Ordering::SeqCst) != run_id {
            return false;
        }

        let slice = remaining.min(25);
        thread::sleep(Duration::from_millis(slice));
        remaining -= slice;
    }

    true
}

fn click_once(enigo: &mut Enigo, button: MouseButton, press_duration_ms: u64) {
    if press_duration_ms == 0 {
        enigo.mouse_click(button);
        return;
    }

    enigo.mouse_down(button);
    thread::sleep(Duration::from_millis(press_duration_ms));
    enigo.mouse_up(button);
}

fn target_points(config: &AutoClickerConfig) -> Vec<ClickPoint> {
    match config.target_mode.as_str() {
        "fixed" => config.points.first().cloned().into_iter().collect(),
        "sequence" => config.points.clone(),
        _ => Vec::new(),
    }
}

fn click_at(
    enigo: &mut Enigo,
    button: MouseButton,
    press_duration_ms: u64,
    point: Option<&ClickPoint>,
) {
    if let Some(point) = point {
        enigo.mouse_move_to(point.x, point.y);
    }
    click_once(enigo, button, press_duration_ms);
}

fn start_with_config(config: AutoClickerConfig) -> AutoClickerStatus {
    let config = set_saved_config(config);
    let clicker_state = state();

    if clicker_state.running.load(Ordering::SeqCst) {
        return current_status();
    }

    clicker_state.clicks_done.store(0, Ordering::SeqCst);
    clicker_state.running.store(true, Ordering::SeqCst);
    let run_id = clicker_state.run_id.fetch_add(1, Ordering::SeqCst) + 1;

    thread::spawn(move || {
        let mut enigo = Enigo::new();
        let original_location = enigo.mouse_location();

        if config.start_delay_ms > 0 && !sleep_checked(run_id, config.start_delay_ms) {
            return;
        }

        loop {
            if !state().running.load(Ordering::SeqCst)
                || state().run_id.load(Ordering::SeqCst) != run_id
            {
                break;
            }

            let config = state()
                .config
                .lock()
                .map(|config| config.clone())
                .unwrap_or_default();
            let button = mouse_button(&config.button);
            let per_cycle = if config.click_mode == "double" { 2 } else { 1 };
            let points = target_points(&config);
            let cycle_targets: Vec<Option<&ClickPoint>> = if points.is_empty() {
                vec![None]
            } else {
                points.iter().map(Some).collect()
            };

            for target in cycle_targets {
                for index in 0..per_cycle {
                    if !state().running.load(Ordering::SeqCst)
                        || state().run_id.load(Ordering::SeqCst) != run_id
                    {
                        break;
                    }

                    if let Some(limit) = config.max_clicks {
                        if state().clicks_done.load(Ordering::SeqCst) >= limit {
                            state().running.store(false, Ordering::SeqCst);
                            break;
                        }
                    }

                    click_at(&mut enigo, button, config.press_duration_ms, target);
                    state().clicks_done.fetch_add(1, Ordering::SeqCst);

                    if index + 1 < per_cycle && !sleep_checked(run_id, 35) {
                        break;
                    }
                }

                if let Some(point) = target {
                    if point.delay_ms > 0 && !sleep_checked(run_id, point.delay_ms) {
                        break;
                    }
                }
            }

            if !sleep_checked(run_id, config.interval_ms) {
                break;
            }
        }

        if state().run_id.load(Ordering::SeqCst) == run_id {
            state().running.store(false, Ordering::SeqCst);
        }
        let saved_config = state()
            .config
            .lock()
            .map(|config| config.clone())
            .unwrap_or_default();
        if saved_config.return_to_original && saved_config.target_mode != "current" {
            enigo.mouse_move_to(original_location.0, original_location.1);
        }
    });

    current_status()
}

pub fn toggle_saved_config() -> AutoClickerStatus {
    if state().running.load(Ordering::SeqCst) {
        stop_clicking()
    } else {
        let config = state()
            .config
            .lock()
            .map(|config| config.clone())
            .unwrap_or_default();
        start_with_config(config)
    }
}

fn stop_clicking() -> AutoClickerStatus {
    let state = state();
    state.running.store(false, Ordering::SeqCst);
    state.run_id.fetch_add(1, Ordering::SeqCst);
    current_status()
}

pub fn restore_from_tool_data(app_handle: AppHandle) {
    let Some(settings) = load_persisted_settings() else {
        return;
    };

    set_saved_config(settings.config);
    if !settings.shortcut_enabled {
        return;
    }

    match register_shortcut(app_handle, settings.shortcut) {
        Ok(status) => {
            if let Some(shortcut) = status.shortcut {
                println!("[AutoClicker] Restored shortcut: {}", shortcut);
            }
        }
        Err(error) => eprintln!("[AutoClicker] Failed to restore shortcut: {}", error),
    }
}

fn normalize_shortcut(value: &str) -> String {
    value
        .split('+')
        .map(|part| part.trim().to_ascii_lowercase())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("+")
}

fn is_reserved_app_shortcut(app_handle: &AppHandle, shortcut: &str) -> bool {
    let requested = normalize_shortcut(shortcut);
    if requested.is_empty() {
        return false;
    }

    let Ok(settings_manager) = crate::settings::SettingsManager::new() else {
        return false;
    };
    let settings = settings_manager.load().unwrap_or_default();
    let current_auto_clicker = state()
        .shortcut
        .lock()
        .ok()
        .and_then(|shortcut| shortcut.clone())
        .map(|shortcut| normalize_shortcut(&shortcut));

    let shortcuts = [
        Some(settings.quick_launch_shortcut),
        settings.clipboard_shortcut,
        settings.toolbox_shortcut,
        settings.ai_chat_shortcut,
        settings.ocr_shortcut,
        settings.translate_shortcut,
        settings.quick_translate_shortcut,
        settings.word_selection_translate_shortcut,
        settings.screenshot_fullscreen_shortcut,
        settings.screenshot_region_shortcut,
    ];

    if shortcuts
        .into_iter()
        .flatten()
        .map(|shortcut| normalize_shortcut(&shortcut))
        .any(|shortcut| shortcut == requested)
    {
        return true;
    }

    match app_handle.global_shortcut_manager().is_registered(shortcut) {
        Ok(true) => current_auto_clicker.as_deref() != Some(requested.as_str()),
        _ => false,
    }
}

#[tauri::command]
pub fn auto_clicker_set_config(config: AutoClickerConfig) -> Result<AutoClickerStatus, String> {
    set_saved_config(config);
    Ok(current_status())
}

#[tauri::command]
pub fn auto_clicker_start(config: AutoClickerConfig) -> Result<AutoClickerStatus, String> {
    Ok(start_with_config(config))
}

#[tauri::command]
pub fn auto_clicker_stop() -> Result<AutoClickerStatus, String> {
    Ok(stop_clicking())
}

#[tauri::command]
pub fn auto_clicker_toggle(config: AutoClickerConfig) -> Result<AutoClickerStatus, String> {
    set_saved_config(config);
    Ok(toggle_saved_config())
}

#[tauri::command]
pub fn auto_clicker_status() -> Result<AutoClickerStatus, String> {
    Ok(current_status())
}

#[tauri::command]
pub fn auto_clicker_cursor_position() -> Result<CursorPosition, String> {
    let enigo = Enigo::new();
    let (x, y) = enigo.mouse_location();
    Ok(CursorPosition { x, y })
}

#[tauri::command]
pub fn auto_clicker_register_shortcut(
    app_handle: AppHandle,
    shortcut: String,
) -> Result<AutoClickerStatus, String> {
    register_shortcut(app_handle, shortcut)
}

fn register_shortcut(app_handle: AppHandle, shortcut: String) -> Result<AutoClickerStatus, String> {
    let shortcut = shortcut.trim().to_string();
    if shortcut.is_empty() {
        return Err("快捷键不能为空".to_string());
    }

    let old_shortcut = state()
        .shortcut
        .lock()
        .map_err(|_| "快捷键状态锁定失败".to_string())?
        .clone();
    if old_shortcut.as_deref() == Some(shortcut.as_str()) {
        return Ok(current_status());
    }
    if is_reserved_app_shortcut(&app_handle, &shortcut) {
        return Err(format!("快捷键 {} 已被应用内其他功能占用", shortcut));
    }

    let mut shortcuts = app_handle.global_shortcut_manager();
    let _ = shortcuts.unregister(&shortcut);

    let handle = app_handle.clone();
    shortcuts
        .register(&shortcut, move || {
            let status = toggle_saved_config();
            let _ = handle.emit_all("auto-clicker-status", status);
        })
        .map_err(|error| format!("注册快捷键失败: {}", error))?;

    if let Some(old_shortcut) = old_shortcut {
        let _ = shortcuts.unregister(&old_shortcut);
    }

    if let Ok(mut saved) = state().shortcut.lock() {
        *saved = Some(shortcut);
    }

    Ok(current_status())
}

#[tauri::command]
pub fn auto_clicker_unregister_shortcut(
    app_handle: AppHandle,
) -> Result<AutoClickerStatus, String> {
    let shortcut = {
        let mut saved = state()
            .shortcut
            .lock()
            .map_err(|_| "快捷键状态锁定失败".to_string())?;
        saved.take()
    };

    if let Some(shortcut) = shortcut {
        let mut shortcuts = app_handle.global_shortcut_manager();
        let _ = shortcuts.unregister(&shortcut);
    }

    Ok(current_status())
}
