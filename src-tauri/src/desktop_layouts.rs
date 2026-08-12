use crate::storage::Storage;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::SystemTime;
use uuid::Uuid;

const STORE_FILE: &str = "desktop_layouts.json";
const DESKTOP_BOX_PENDING_FILE: &str = "desktop_box_pending.json";
const DESKTOP_BOX_MANAGE_PENDING_FILE: &str = "desktop_box_manage_pending.json";
const DESKTOP_BOX_LABEL_PREFIX: &str = "desktop-box-";
const DESKTOP_BOX_FILES_DIR: &str = "desktop_boxes";
const DESKTOP_BOX_DATA_CHANGED_EVENT: &str = "desktop-box-data-changed";
const DESKTOP_BOX_APPEARANCE_CHANGED_EVENT: &str = "desktop-box-appearance-changed";
const DESKTOP_BOX_ICON_DROP_REQUEST_EVENT: &str = "desktop-box-icon-drop-request";
const DESKTOP_BOX_DROP_ERROR_EVENT: &str = "desktop-box-drop-error";
const PENDING_REQUEST_MAX_AGE_SECONDS: i64 = 30;
const STORE_VERSION: u32 = 4;
const DEFAULT_CANVAS_WIDTH: i32 = 1920;
const DEFAULT_CANVAS_HEIGHT: i32 = 1080;
const FENCE_PADDING_X: i32 = 20;
const FENCE_PADDING_TOP: i32 = 42;
const ICON_CELL_WIDTH: i32 = 86;
const ICON_CELL_HEIGHT: i32 = 82;
const DEFAULT_BOX_WIDTH: i32 = 520;
const DEFAULT_BOX_HEIGHT: i32 = 300;
const COLLAPSED_BOX_HEIGHT: i32 = 36;
const BOX_PLACEMENT_GAP: i32 = 24;
const BOX_SNAP_GAP: i32 = 2;
const BOX_SNAP_DISTANCE: i32 = 12;
const LEGACY_DEFAULT_BOX_ICON_SPACING: i32 = 8;
const DEFAULT_BOX_ICON_HORIZONTAL_SPACING: i32 = 4;
const DEFAULT_BOX_ICON_VERTICAL_SPACING: i32 = 8;
const MIN_BOX_ICON_SPACING: i32 = 0;
const MAX_BOX_ICON_SPACING: i32 = 32;
const DEFAULT_BOX_VIEW_MODE: &str = "grid";
const DEFAULT_BOX_SORT_MODE: &str = "manual";
const DEFAULT_BOX_OPACITY: f32 = 0.78;
const DEFAULT_BOX_BACKGROUND: &str = "#111827";
const FENCE_COLORS: [&str; 6] = [
    "#2563eb", "#16a34a", "#9333ea", "#ea580c", "#dc2626", "#0891b2",
];

static STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static BOX_FOCUS_REQUESTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static BOX_SCALE_FACTORS: OnceLock<Mutex<HashMap<String, f32>>> = OnceLock::new();
static BOX_RESIZE_WINDOWS: OnceLock<Mutex<HashSet<isize>>> = OnceLock::new();
static BOX_DRAG_WINDOWS: OnceLock<Mutex<HashSet<isize>>> = OnceLock::new();
static BOX_ICON_DRAGS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
#[cfg(windows)]
thread_local! {
    static BOX_SHELL_OLE_INITIALIZED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static BOX_SHELL_DROP_TARGETS: std::cell::RefCell<
        HashMap<String, Vec<(isize, windows::Win32::System::Ole::IDropTarget)>>
    > = std::cell::RefCell::new(HashMap::new());
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLayoutStore {
    pub version: u32,
    pub active_layout_id: Option<String>,
    #[serde(default)]
    pub box_appearance: DesktopBoxAppearance,
    pub layouts: Vec<DesktopLayout>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBoxAppearance {
    #[serde(default = "default_box_opacity")]
    pub opacity: f32,
    #[serde(default = "default_box_icon_horizontal_spacing")]
    pub icon_spacing: i32,
    #[serde(default = "default_box_icon_vertical_spacing")]
    pub icon_vertical_spacing: i32,
}

impl Default for DesktopBoxAppearance {
    fn default() -> Self {
        Self {
            opacity: default_box_opacity(),
            icon_spacing: default_box_icon_horizontal_spacing(),
            icon_vertical_spacing: default_box_icon_vertical_spacing(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLayout {
    pub id: String,
    pub name: String,
    pub canvas_width: i32,
    pub canvas_height: i32,
    pub fences: Vec<DesktopFence>,
    #[serde(default)]
    pub icon_assignments: Vec<DesktopIconAssignment>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopFence {
    pub id: String,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub color: String,
    #[serde(default = "default_box_view_mode")]
    pub view_mode: String,
    #[serde(default = "default_box_sort_mode")]
    pub sort_mode: String,
    #[serde(default = "default_box_opacity")]
    pub opacity: f32,
    #[serde(default = "default_box_background")]
    pub background_color: String,
    #[serde(default = "legacy_default_box_icon_spacing")]
    pub icon_spacing: i32,
    #[serde(default = "default_box_icon_vertical_spacing")]
    pub icon_vertical_spacing: i32,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub hidden: bool,
    pub order: i32,
}

fn default_box_view_mode() -> String {
    DEFAULT_BOX_VIEW_MODE.to_string()
}

fn default_box_sort_mode() -> String {
    DEFAULT_BOX_SORT_MODE.to_string()
}

fn default_box_opacity() -> f32 {
    DEFAULT_BOX_OPACITY
}

fn default_box_background() -> String {
    DEFAULT_BOX_BACKGROUND.to_string()
}

fn legacy_default_box_icon_spacing() -> i32 {
    LEGACY_DEFAULT_BOX_ICON_SPACING
}

fn default_box_icon_horizontal_spacing() -> i32 {
    DEFAULT_BOX_ICON_HORIZONTAL_SPACING
}

fn default_box_icon_vertical_spacing() -> i32 {
    DEFAULT_BOX_ICON_VERTICAL_SPACING
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopIconAssignment {
    pub icon_id: String,
    pub label: String,
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell_id: Option<String>,
    pub fence_id: String,
    pub order: i32,
    #[serde(default)]
    pub offset_x: Option<i32>,
    #[serde(default)]
    pub offset_y: Option<i32>,
    #[serde(default)]
    pub native_index: Option<i32>,
    #[serde(default)]
    pub original_path: Option<String>,
    #[serde(default)]
    pub managed_file: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopIconInfo {
    pub id: String,
    pub label: String,
    pub path: Option<String>,
    pub extension: Option<String>,
    pub is_directory: bool,
    pub source: String,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub native_index: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopIconScanResult {
    pub icons: Vec<DesktopIconInfo>,
    pub desktop_dir: Option<String>,
    pub public_desktop_dir: Option<String>,
    pub native_available: bool,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLayoutApplyResult {
    pub moved: usize,
    pub skipped: usize,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBoxView {
    pub layout_id: String,
    pub fence: DesktopFence,
    #[serde(default)]
    pub icons: Vec<DesktopIconAssignment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apply_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBoxContextMenuResult {
    pub deleted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DesktopBoxSortMode {
    Manual,
    NameAscending,
    NameDescending,
    ModifiedNewest,
    ModifiedOldest,
    TypeAscending,
    TypeDescending,
}

impl DesktopBoxSortMode {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "manual" => Ok(Self::Manual),
            "name_asc" => Ok(Self::NameAscending),
            "name_desc" => Ok(Self::NameDescending),
            "modified_desc" => Ok(Self::ModifiedNewest),
            "modified_asc" => Ok(Self::ModifiedOldest),
            "type_asc" => Ok(Self::TypeAscending),
            "type_desc" => Ok(Self::TypeDescending),
            _ => Err("不支持的桌面 Box 排序方式。".to_string()),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::NameAscending => "name_asc",
            Self::NameDescending => "name_desc",
            Self::ModifiedNewest => "modified_desc",
            Self::ModifiedOldest => "modified_asc",
            Self::TypeAscending => "type_asc",
            Self::TypeDescending => "type_desc",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ManagedShortcutIssue {
    StorageFileMissing,
    TargetMissing,
}

#[derive(Default)]
struct ManagedFileRecovery {
    changed: bool,
    moved_files: Vec<(PathBuf, PathBuf)>,
    restored_count: usize,
    first_error: Option<String>,
}

impl ManagedShortcutIssue {
    fn open_error_message(self) -> &'static str {
        match self {
            Self::StorageFileMissing => {
                "此快捷方式文件已经不存在。请右键该项目并选择“删除失效快捷方式”。"
            }
            Self::TargetMissing => {
                "此快捷方式的目标程序已卸载或路径已不存在。请右键该项目并选择“删除失效快捷方式”。"
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopBoxIconDropRequest {
    source_box_id: String,
    icon_id: String,
    client_x: f64,
    client_y: f64,
}

#[cfg(windows)]
#[derive(Debug, Clone, PartialEq, Eq)]
struct DesktopShellDropItem {
    shell_id: String,
    label: String,
}

#[derive(Debug, Clone)]
struct DesktopFileEntry {
    label: String,
    path: String,
    alias_paths: Vec<String>,
    extension: Option<String>,
    is_directory: bool,
    source: String,
}

#[derive(Debug, Clone)]
struct NativeDesktopIcon {
    label: String,
    x: i32,
    y: i32,
    index: i32,
}

#[derive(Debug, Clone, Copy)]
struct DesktopWorkArea {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct BoxSnapRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

impl BoxSnapRect {
    fn from_geometry(x: i32, y: i32, width: i32, height: i32) -> Self {
        Self {
            left: x,
            top: y,
            right: x.saturating_add(width),
            bottom: y.saturating_add(height),
        }
    }

    fn width(self) -> i32 {
        self.right.saturating_sub(self.left)
    }

    fn height(self) -> i32 {
        self.bottom.saturating_sub(self.top)
    }

    fn center(self) -> (i32, i32) {
        (
            self.left.saturating_add(self.width() / 2),
            self.top.saturating_add(self.height() / 2),
        )
    }

    fn contains(self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }
}

#[cfg(windows)]
#[derive(Debug, Clone)]
struct DesktopBoxWindowTarget {
    box_id: String,
    label: String,
    hwnd: isize,
    process_id: u32,
    rect: BoxSnapRect,
}

#[derive(Debug, Clone, Copy)]
struct BoxResizeEdges {
    left: bool,
    top: bool,
    right: bool,
    bottom: bool,
}

impl BoxResizeEdges {
    fn parse(direction: &str) -> Option<Self> {
        Some(match direction {
            "n" => Self {
                left: false,
                top: true,
                right: false,
                bottom: false,
            },
            "ne" => Self {
                left: false,
                top: true,
                right: true,
                bottom: false,
            },
            "e" => Self {
                left: false,
                top: false,
                right: true,
                bottom: false,
            },
            "se" => Self {
                left: false,
                top: false,
                right: true,
                bottom: true,
            },
            "s" => Self {
                left: false,
                top: false,
                right: false,
                bottom: true,
            },
            "sw" => Self {
                left: true,
                top: false,
                right: false,
                bottom: true,
            },
            "w" => Self {
                left: true,
                top: false,
                right: false,
                bottom: false,
            },
            "nw" => Self {
                left: true,
                top: true,
                right: false,
                bottom: false,
            },
            _ => return None,
        })
    }
}

fn lock_store() -> MutexGuard<'static, ()> {
    STORE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn mark_box_for_focus(box_id: &str) {
    let mut requests = BOX_FOCUS_REQUESTS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    requests.insert(box_id.to_string());
}

fn take_box_focus_request(box_id: &str) -> bool {
    BOX_FOCUS_REQUESTS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(box_id)
}

fn set_box_scale_factor(box_id: &str, scale_factor: f32) {
    BOX_SCALE_FACTORS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(box_id.to_string(), scale_factor.clamp(0.5, 4.0));
}

fn box_scale_factor(box_id: &str) -> f32 {
    BOX_SCALE_FACTORS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(box_id)
        .copied()
        .unwrap_or_else(system_scale_factor)
}

#[tauri::command]
pub fn desktop_layout_get_store() -> Result<DesktopLayoutStore, String> {
    read_store()
}

#[tauri::command]
pub fn desktop_layout_save_store(store: DesktopLayoutStore) -> Result<DesktopLayoutStore, String> {
    let normalized = normalize_store(store);
    {
        let _store_guard = lock_store();
        write_store_unlocked(&normalized)?;
    }
    sync_desktop_box_icon_filter();
    Ok(normalized)
}

#[tauri::command]
pub fn desktop_layout_scan_icons() -> Result<DesktopIconScanResult, String> {
    scan_icons()
}

#[tauri::command]
pub fn desktop_layout_apply(layout: DesktopLayout) -> Result<DesktopLayoutApplyResult, String> {
    apply_layout(&layout)
}

#[tauri::command]
pub fn desktop_box_create(app_handle: tauri::AppHandle) -> Result<DesktopBoxView, String> {
    let view = create_desktop_box_window(&app_handle)?;
    sync_desktop_box_icon_filter();
    Ok(view)
}

#[tauri::command]
pub fn desktop_box_get(box_id: String) -> Result<Option<DesktopBoxView>, String> {
    find_box(&box_id)
}

#[tauri::command]
pub fn desktop_box_update_name(box_id: String, name: String) -> Result<DesktopBoxView, String> {
    update_box(&box_id, |fence| {
        fence.name = clean_name(&name, "盒子");
    })
}

#[tauri::command]
pub fn desktop_box_update_collapsed(
    box_id: String,
    collapsed: bool,
) -> Result<DesktopBoxView, String> {
    update_box(&box_id, |fence| {
        fence.collapsed = collapsed;
    })
}

#[tauri::command]
pub fn desktop_box_update_hidden(box_id: String, hidden: bool) -> Result<DesktopBoxView, String> {
    let view = update_box(&box_id, |fence| {
        fence.hidden = hidden;
    })?;
    sync_desktop_box_icon_filter();
    Ok(view)
}

#[tauri::command]
pub fn desktop_box_update_view_mode(
    box_id: String,
    view_mode: String,
) -> Result<DesktopBoxView, String> {
    let normalized = match view_mode.trim().to_ascii_lowercase().as_str() {
        "grid" => "grid".to_string(),
        "table" => "table".to_string(),
        _ => return Err("桌面盒子显示方式无效。".to_string()),
    };
    update_box(&box_id, |fence| fence.view_mode = normalized)
}

#[tauri::command]
pub fn desktop_box_update_appearance(
    app_handle: tauri::AppHandle,
    box_id: String,
    opacity: f32,
    icon_spacing: i32,
    icon_vertical_spacing: i32,
) -> Result<DesktopBoxView, String> {
    if !opacity.is_finite() || !(0.1..=1.0).contains(&opacity) {
        return Err("桌面盒子透明度必须在 10% 到 100% 之间。".to_string());
    }
    if !(MIN_BOX_ICON_SPACING..=MAX_BOX_ICON_SPACING).contains(&icon_spacing) {
        return Err("桌面盒子图标左右间距必须在 0 到 32 像素之间。".to_string());
    }
    if !(MIN_BOX_ICON_SPACING..=MAX_BOX_ICON_SPACING).contains(&icon_vertical_spacing) {
        return Err("桌面盒子图标上下间距必须在 0 到 32 像素之间。".to_string());
    }
    let appearance = DesktopBoxAppearance {
        opacity,
        icon_spacing,
        icon_vertical_spacing,
    };
    let view = update_box(&box_id, |fence| {
        fence.opacity = appearance.opacity;
        fence.icon_spacing = appearance.icon_spacing;
        fence.icon_vertical_spacing = appearance.icon_vertical_spacing;
    })?;
    emit_box_event(
        &app_handle,
        &box_id,
        DESKTOP_BOX_APPEARANCE_CHANGED_EVENT,
        appearance,
    );
    Ok(view)
}

#[tauri::command]
pub fn desktop_box_update_geometry(
    box_id: String,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<DesktopBoxView, String> {
    update_box_geometry(&box_id, x, y, width, height)
}

#[tauri::command]
pub fn desktop_box_update_scale_factor(box_id: String, scale_factor: f32) -> Result<(), String> {
    if !scale_factor.is_finite() || !(0.5..=4.0).contains(&scale_factor) {
        return Err("桌面盒子缩放比例无效。".to_string());
    }
    let _store_guard = lock_store();
    let store = read_store_unlocked()?;
    if !store
        .layouts
        .iter()
        .any(|layout| layout.fences.iter().any(|fence| fence.id == box_id))
    {
        return Err("桌面盒子不存在。".to_string());
    }
    set_box_scale_factor(&box_id, scale_factor);
    Ok(())
}

#[tauri::command]
pub fn desktop_box_start_resize(
    app_handle: tauri::AppHandle,
    box_id: String,
    direction: String,
) -> Result<(), String> {
    use tauri::Manager;

    let edges = BoxResizeEdges::parse(direction.trim())
        .ok_or_else(|| "桌面盒子拉伸方向无效。".to_string())?;
    let label = format!("{}{}", DESKTOP_BOX_LABEL_PREFIX, box_id);
    let window = app_handle
        .get_window(&label)
        .ok_or_else(|| "桌面盒子窗口不存在。".to_string())?;
    let scale_factor = window.scale_factor().unwrap_or(1.0).clamp(0.5, 4.0);
    let snap_targets = desktop_box_snap_targets(&app_handle, &label);
    start_box_window_resize(&window, edges, scale_factor, snap_targets)
}

#[tauri::command]
pub fn desktop_box_start_drag(app_handle: tauri::AppHandle, box_id: String) -> Result<(), String> {
    use tauri::Manager;

    let label = format!("{}{}", DESKTOP_BOX_LABEL_PREFIX, box_id);
    let window = app_handle
        .get_window(&label)
        .ok_or_else(|| "桌面盒子窗口不存在。".to_string())?;
    let scale_factor = window.scale_factor().unwrap_or(1.0).clamp(0.5, 4.0);
    let snap_targets = desktop_box_snap_targets(&app_handle, &label);
    start_box_window_drag(&window, scale_factor, snap_targets)
}

#[tauri::command]
pub fn desktop_box_persist_geometry(
    app_handle: tauri::AppHandle,
    box_id: String,
) -> Result<DesktopBoxView, String> {
    use tauri::Manager;

    let label = format!("{}{}", DESKTOP_BOX_LABEL_PREFIX, box_id);
    let window = app_handle
        .get_window(&label)
        .ok_or_else(|| "桌面盒子窗口不存在。".to_string())?;
    let (x, y, width, height) = box_window_screen_geometry(&window)?;
    update_box_geometry(&box_id, x, y, width, height)
}

#[tauri::command]
pub fn desktop_box_delete(box_id: String) -> Result<(), String> {
    delete_box(&box_id)?;
    sync_desktop_box_icon_filter();
    Ok(())
}

#[tauri::command]
pub fn desktop_box_assign_paths(
    app_handle: tauri::AppHandle,
    box_id: String,
    paths: Vec<String>,
) -> Result<DesktopBoxView, String> {
    let (view, affected_box_ids) = assign_paths_to_box(&box_id, paths)?;
    refresh_box_windows(&app_handle, &affected_box_ids);
    sync_desktop_box_icon_filter();
    Ok(view)
}

#[tauri::command]
pub fn desktop_box_remove_icon(box_id: String, icon_id: String) -> Result<DesktopBoxView, String> {
    let view = remove_icon_from_box(&box_id, &icon_id)?;
    sync_desktop_box_icon_filter();
    Ok(view)
}

#[tauri::command]
pub fn desktop_box_place_icon(
    app_handle: tauri::AppHandle,
    source_box_id: String,
    target_box_id: String,
    icon_id: String,
    target_index: usize,
) -> Result<DesktopBoxView, String> {
    let view = place_icon_between_boxes(&source_box_id, &target_box_id, &icon_id, target_index)?;
    refresh_box_window(&app_handle, &source_box_id);
    if source_box_id != target_box_id {
        refresh_box_window(&app_handle, &target_box_id);
    }
    sync_desktop_box_icon_filter();
    Ok(view)
}

#[tauri::command]
pub fn desktop_box_open_icon(box_id: String, icon_id: String) -> Result<(), String> {
    let view = find_box(&box_id)?.ok_or_else(|| "桌面盒子不存在。".to_string())?;
    let normalized_icon_id = normalize_path_key(&icon_id);
    let assignment = view
        .icons
        .iter()
        .find(|assignment| {
            assignment.icon_id == icon_id
                || normalize_path_key(&assignment.icon_id) == normalized_icon_id
        })
        .ok_or_else(|| "桌面盒子中不存在这个图标。".to_string())?;
    if let Some(shell_id) = assignment.shell_id.as_deref() {
        return open_shell_item(shell_id);
    }
    if let Some(issue) = desktop_box_item_issue(assignment) {
        return Err(issue.open_error_message().to_string());
    }
    let target_path = assignment
        .path
        .as_deref()
        .unwrap_or(assignment.icon_id.as_str());
    crate::commands::open_path(target_path.to_string())
}

#[tauri::command]
pub fn desktop_box_show_context_menu(
    app_handle: tauri::AppHandle,
    box_id: String,
    icon_id: Option<String>,
    target_path: Option<String>,
    screen_x: f64,
    screen_y: f64,
) -> Result<DesktopBoxContextMenuResult, String> {
    use tauri::Manager;

    if !screen_x.is_finite() || !screen_y.is_finite() {
        return Err("右键菜单坐标无效。".to_string());
    }
    let box_view = find_box(&box_id)?.ok_or_else(|| "桌面盒子不存在。".to_string())?;
    let assignment = icon_id.as_deref().and_then(|icon_id| {
        let normalized_icon_id = normalize_path_key(icon_id);
        box_view.icons.iter().find(|assignment| {
            assignment.icon_id == icon_id
                || normalize_path_key(&assignment.icon_id) == normalized_icon_id
        })
    });
    let resolved_target_path = assignment
        .and_then(|assignment| {
            assignment
                .shell_id
                .as_deref()
                .or(assignment.path.as_deref())
                .or(Some(assignment.icon_id.as_str()))
        })
        .map(str::to_string)
        .or(target_path);
    let label = format!("{}{}", DESKTOP_BOX_LABEL_PREFIX, box_id);
    let window = app_handle
        .get_window(&label)
        .ok_or_else(|| "桌面盒子窗口不存在。".to_string())?;

    #[cfg(windows)]
    {
        let hwnd = window
            .hwnd()
            .map_err(|error| format!("读取桌面盒子窗口句柄失败: {}", error))?;
        let scale_factor = window.scale_factor().unwrap_or(1.0).clamp(0.5, 4.0);
        let point_x = (screen_x * scale_factor).round() as i32;
        let point_y = (screen_y * scale_factor).round() as i32;
        if assignment.is_some_and(|assignment| {
            desktop_box_item_issue(assignment) == Some(ManagedShortcutIssue::StorageFileMissing)
        }) {
            let delete_requested = show_invalid_shortcut_context_menu(hwnd.0, point_x, point_y)?;
            if delete_requested {
                let icon_id = icon_id
                    .as_deref()
                    .ok_or_else(|| "失效快捷方式标识不存在。".to_string())?;
                remove_invalid_icon_record(&box_id, icon_id)?;
                sync_desktop_box_icon_filter();
            }
            return Ok(DesktopBoxContextMenuResult {
                deleted: delete_requested,
            });
        }

        let invoked_verb = show_native_shell_context_menu(
            hwnd.0,
            resolved_target_path.as_deref(),
            point_x,
            point_y,
        )?;

        let deleted = invoked_verb
            .as_deref()
            .is_some_and(|verb| verb.eq_ignore_ascii_case("delete"))
            && assignment
                .and_then(|assignment| assignment.path.as_deref())
                .is_some_and(|path| !Path::new(path).exists());
        if deleted {
            let icon_id = icon_id
                .as_deref()
                .ok_or_else(|| "桌面项目标识不存在。".to_string())?;
            remove_invalid_icon_record(&box_id, icon_id)?;
            sync_desktop_box_icon_filter();
        }
        return Ok(DesktopBoxContextMenuResult { deleted });
    }

    #[cfg(not(windows))]
    {
        let _ = (window, resolved_target_path, assignment, icon_id);
        Err("桌面右键菜单仅支持 Windows。".to_string())
    }
}

#[tauri::command]
pub fn desktop_box_start_icon_drag(
    app_handle: tauri::AppHandle,
    box_id: String,
    icon_id: String,
) -> Result<(), String> {
    let view = find_box(&box_id)?.ok_or_else(|| "桌面盒子不存在。".to_string())?;
    let normalized_icon_id = normalize_path_key(&icon_id);
    if !view.icons.iter().any(|icon| {
        icon.icon_id == icon_id || normalize_path_key(&icon.icon_id) == normalized_icon_id
    }) {
        return Err("桌面盒子中不存在这个图标。".to_string());
    }
    start_box_icon_drag(app_handle, box_id, icon_id)
}

#[tauri::command]
pub fn desktop_box_window_ready(
    app_handle: tauri::AppHandle,
    box_id: String,
) -> Result<(), String> {
    use tauri::Manager;

    let label = format!("{}{}", DESKTOP_BOX_LABEL_PREFIX, box_id);
    let Some(window) = app_handle.get_window(&label) else {
        return Err("桌面盒子窗口不存在。".to_string());
    };
    eprintln!("[DesktopBox] ready begin id={}", box_id);
    eprintln!(
        "[DesktopBox] ready window label={} hwnd={:?}",
        label,
        window.hwnd()
    );
    set_box_scale_factor(&box_id, window.scale_factor().unwrap_or(1.0) as f32);
    let Some(view) = find_box(&box_id)? else {
        let _ = window.close();
        return Err("桌面盒子不存在。".to_string());
    };
    if view.fence.hidden {
        let _ = window.close();
        return Ok(());
    }
    // The normal path is already an Explorer child because the parent is
    // supplied to WindowBuilder before WebView2 is created. This call is
    // idempotent and only repairs a stale parent after Explorer restarts.
    attach_box_window_to_desktop(&window, &view.fence)?;
    #[cfg(windows)]
    {
        // RegisterDragDrop must be called from a thread that pumps the Win32
        // message loop. Tauri commands can run on worker threads, so marshal
        // registration to the window's dispatcher instead of registering from
        // the IPC command thread.
        let registration_app_handle = app_handle.clone();
        let registration_window = window.clone();
        let registration_box_id = box_id.clone();
        if let Err(error) = window.run_on_main_thread(move || {
            if let Err(error) = install_box_shell_drop_targets(
                &registration_app_handle,
                &registration_window,
                &registration_box_id,
            ) {
                eprintln!("[DesktopBox] shell drop target install failed: {}", error);
            }
        }) {
            eprintln!("[DesktopBox] shell drop target dispatch failed: {}", error);
        }
    }
    reveal_box_window(&window, &view.fence, take_box_focus_request(&box_id));
    eprintln!("[DesktopBox] ready revealed id={}", box_id);
    Ok(())
}

/// Restore the active layout's Box windows after the main application starts.
/// The windows are created hidden and reveal themselves after their React view
/// has loaded, which avoids flashing or stealing focus during startup.
pub fn restore_desktop_box_windows(app_handle: &tauri::AppHandle) -> Result<usize, String> {
    use tauri::Manager;

    // Read and normalize the persisted state first, then release STORE_LOCK
    // before creating WebView windows. Each Box page invokes desktop_box_get
    // during its load; keeping this lock across WindowBuilder::build can block
    // every page during startup (especially when several Boxes are restored).
    let (layout, legacy_recovery_moves) = {
        let _store_guard = lock_store();
        let mut store = read_store_unlocked()?;
        let Some(active_id) = store.active_layout_id.clone() else {
            return Ok(0);
        };
        let Some(layout_index) = store
            .layouts
            .iter()
            .position(|layout| layout.id == active_id)
        else {
            return Ok(0);
        };

        // Version 3 and older moved direct desktop files into private Box
        // storage. Recover those records before opening Box windows so every
        // current assignment is a non-destructive reference to the real item.
        let legacy_recovery = recover_legacy_managed_desktop_assignments(&mut store);
        if let Some(error) = legacy_recovery.first_error.as_deref() {
            eprintln!("[DesktopBox] legacy file recovery incomplete: {}", error);
        }
        // An empty Box is still a real user-created Box. Explicit deletion
        // already removes it from the store, so startup must not infer that an
        // empty Box was deleted merely because it has no assigned icons.
        let store_changed = legacy_recovery.changed;
        let mut layout = store.layouts[layout_index].clone();
        let mut geometry_changed = false;
        let mut placed_fences = Vec::with_capacity(layout.fences.len());
        for fence in &mut layout.fences {
            if fence.hidden {
                continue;
            }
            let (bounded_width, bounded_height) = bounded_box_dimensions(fence);
            if fence.width != bounded_width || (!fence.collapsed && fence.height != bounded_height)
            {
                fence.width = bounded_width;
                if !fence.collapsed {
                    fence.height = bounded_height;
                }
                geometry_changed = true;
            }

            let (visible_x, visible_y) = visible_box_position(fence);
            let overlaps_existing = placed_fences.iter().any(|placed: &DesktopFence| {
                rectangles_overlap(
                    visible_x,
                    visible_y,
                    fence.width,
                    fence.height,
                    placed.x,
                    placed.y,
                    placed.width,
                    placed.height,
                )
            });
            let (next_x, next_y) = if overlaps_existing {
                find_box_position(
                    &placed_fences,
                    visible_x,
                    visible_y,
                    fence.width,
                    fence.height,
                    desktop_work_area_at(visible_x, visible_y),
                )
            } else {
                (visible_x, visible_y)
            };
            if fence.x != next_x || fence.y != next_y {
                fence.x = next_x;
                fence.y = next_y;
                geometry_changed = true;
            }
            placed_fences.push(fence.clone());
        }
        if geometry_changed || store_changed {
            layout.updated_at = Utc::now().to_rfc3339();
            store.layouts[layout_index] = layout.clone();
            write_store_unlocked(&normalize_store(store))?;
        }
        (layout, legacy_recovery.moved_files)
    };

    for (source, destination) in &legacy_recovery_moves {
        notify_desktop_path_move(source, destination);
    }
    #[cfg(windows)]
    if !legacy_recovery_moves.is_empty() {
        windows_desktop_icons::refresh_desktop();
    }

    sync_desktop_box_icon_filter();

    let desired_labels = desired_box_window_labels(&layout);
    eprintln!(
        "[DesktopBox] reconcile desired={} registered_windows={}",
        desired_labels.len(),
        app_handle.windows().len()
    );

    // Reconciliation is deliberately idempotent. Desired windows are reused
    // and reattached; only stale windows are closed. Closing every window and
    // immediately rebuilding the same labels races Tauri's asynchronous close
    // event and can destroy a freshly "restored" Box moments later.
    let stale_box_windows = app_handle
        .windows()
        .into_iter()
        .filter_map(|(label, window)| {
            (label.starts_with(DESKTOP_BOX_LABEL_PREFIX) && !desired_labels.contains(&label))
                .then_some(window)
        })
        .collect::<Vec<_>>();
    for window in stale_box_windows {
        let _ = window.close();
    }

    // Only non-hidden fences are allowed to have a live Box window after
    // startup; hidden/deleted entries must not reappear as stale WebViews.
    let mut restored = 0usize;
    let mut first_error = None;
    for fence in layout.fences.iter().filter(|fence| !fence.hidden) {
        match open_box_window(app_handle, fence, Some(false)) {
            Ok(()) => {
                restored += 1;
                eprintln!("[DesktopBox] reconcile opened id={}", fence.id);
            }
            Err(error) if first_error.is_none() => {
                eprintln!("[DesktopBox] reconcile {} failed: {}", fence.id, error);
                first_error = Some(format!("{}: {}", fence.name, error));
            }
            Err(_) => {}
        }
    }

    if !layout.icon_assignments.is_empty() {
        if let Err(error) = apply_layout(&layout) {
            eprintln!(
                "[DesktopBox] restore native icon positions failed: {}",
                error
            );
        }
    }

    if let Some(error) = first_error {
        Err(format!(
            "恢复桌面盒子失败（已恢复 {} 个）：{}",
            restored, error
        ))
    } else {
        Ok(restored)
    }
}

fn desired_box_window_labels(layout: &DesktopLayout) -> HashSet<String> {
    layout
        .fences
        .iter()
        .filter(|fence| !fence.hidden)
        .map(|fence| format!("{}{}", DESKTOP_BOX_LABEL_PREFIX, fence.id))
        .collect()
}

/// Last-chance recovery for legacy records created before BOX assignments became
/// non-destructive references. Current records never need exit-time file moves.
pub fn restore_desktop_icons_before_exit() -> Result<usize, String> {
    let recovery = {
        let _store_guard = lock_store();
        let mut store = read_store_unlocked()?;
        let recovery = recover_legacy_managed_desktop_assignments(&mut store);
        if recovery.changed {
            if let Err(error) = write_store_unlocked(&normalize_store(store)) {
                rollback_managed_file_moves(&recovery.moved_files);
                return Err(format!("保存退出前桌面还原状态失败: {}", error));
            }
        }
        recovery
    };

    for (source, destination) in &recovery.moved_files {
        notify_desktop_path_move(source, destination);
    }
    #[cfg(windows)]
    if !recovery.moved_files.is_empty() {
        windows_desktop_icons::refresh_desktop();
    }

    if let Some(error) = recovery.first_error {
        Err(format!(
            "已还原 {} 个桌面项目，但仍有项目还原失败: {}",
            recovery.restored_count, error
        ))
    } else {
        Ok(recovery.restored_count)
    }
}

/// Re-show existing Box windows without reapplying the native icon layout.
/// This is used by the tray action after a Box was hidden by the user.
pub fn show_desktop_box_windows(app_handle: &tauri::AppHandle) -> Result<usize, String> {
    let layout = {
        let _store_guard = lock_store();
        let mut store = read_store_unlocked()?;
        let Some(active_id) = store.active_layout_id.as_deref() else {
            return Ok(0);
        };
        let Some(layout_index) = store
            .layouts
            .iter()
            .position(|layout| layout.id == active_id)
        else {
            return Ok(0);
        };

        let mut layout = store.layouts[layout_index].clone();
        let mut changed = false;
        for fence in &mut layout.fences {
            if fence.hidden {
                fence.hidden = false;
                changed = true;
            }
        }
        if changed {
            layout.updated_at = Utc::now().to_rfc3339();
            store.layouts[layout_index] = layout.clone();
            write_store_unlocked(&normalize_store(store))?;
        }
        layout
    };

    let mut shown = 0usize;
    let mut first_error = None;
    for fence in &layout.fences {
        if fence.hidden {
            continue;
        }
        match open_box_window(app_handle, fence, Some(true)) {
            Ok(()) => shown += 1,
            Err(error) if first_error.is_none() => first_error = Some(error),
            Err(_) => {}
        }
    }
    sync_desktop_box_icon_filter();
    if let Some(error) = first_error {
        Err(format!(
            "显示桌面盒子失败（已显示 {} 个）：{}",
            shown, error
        ))
    } else {
        Ok(shown)
    }
}

/// Recreate or realign Box windows after the Windows desktop shell restarts.
pub fn start_desktop_box_shell_monitor(app_handle: &tauri::AppHandle) {
    #[cfg(windows)]
    {
        let app_handle = app_handle.clone();
        std::thread::spawn(move || {
            let mut shell_identity = windows_desktop_icons::desktop_shell_identity();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let next_identity = windows_desktop_icons::desktop_shell_identity();
                if next_identity == shell_identity {
                    continue;
                }
                shell_identity = next_identity;
                if shell_identity.is_none() {
                    continue;
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
                if let Err(error) = restore_desktop_box_windows(&app_handle) {
                    eprintln!("[DesktopBox] shell restart restore failed: {}", error);
                }
            }
        });
    }
}

pub fn start_desktop_box_icon_filter_lease_monitor() {
    crate::desktop_icon_filter::start_lease_monitor();
    sync_desktop_box_icon_filter();
}

pub fn disable_desktop_box_icon_filter() {
    crate::desktop_icon_filter::disable();
}

fn sync_desktop_box_icon_filter() {
    if let Err(error) = crate::desktop_icon_filter::sync_from_disk() {
        // Explorer integration is optional and must never make normal BOX
        // persistence fail. A missing DLL or an Explorer restart leaves the
        // native desktop untouched until the next successful lease refresh.
        eprintln!("[DesktopIconFilter] sync failed: {}", error);
    }
}

/// Persist the final native window geometry when a Box is closed by the user.
pub fn persist_box_geometry_for_window(window: &tauri::Window) -> Result<(), String> {
    let Some(box_id) = window.label().strip_prefix(DESKTOP_BOX_LABEL_PREFIX) else {
        return Ok(());
    };
    let (x, y, width, height) = box_window_screen_geometry(window)?;
    match update_box_geometry(box_id, x, y, width, height) {
        Ok(_) => Ok(()),
        Err(error) if error == "桌面盒子不存在。" => Ok(()),
        Err(error) => Err(error),
    }
}

fn read_store() -> Result<DesktopLayoutStore, String> {
    let _store_guard = lock_store();
    read_store_unlocked()
}

fn read_store_unlocked() -> Result<DesktopLayoutStore, String> {
    let path = store_path()?;
    if !path.exists() {
        let store = default_store();
        write_store_unlocked(&store)?;
        return Ok(store);
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("读取桌面布局数据失败: {}", e))?;
    match serde_json::from_str::<DesktopLayoutStore>(&content) {
        Ok(store) => {
            let normalized = normalize_store(store.clone());
            if normalized != store {
                write_store_unlocked(&normalized)?;
            }
            Ok(normalized)
        }
        Err(parse_error) => {
            let Some(recovered) = latest_valid_backup(&path) else {
                return Err(format!("解析桌面布局数据失败: {}", parse_error));
            };
            let recovered = normalize_store(recovered);
            write_store_unlocked(&recovered).map_err(|write_error| {
                format!(
                    "桌面布局数据损坏（{}），且恢复备份失败: {}",
                    parse_error, write_error
                )
            })?;
            Ok(recovered)
        }
    }
}

fn write_store_unlocked(store: &DesktopLayoutStore) -> Result<(), String> {
    write_store_unlocked_with_backup(store, true)
}

fn write_geometry_store_unlocked(store: &DesktopLayoutStore) -> Result<(), String> {
    write_store_unlocked_with_backup(store, false)
}

fn write_store_unlocked_with_backup(
    store: &DesktopLayoutStore,
    create_backup: bool,
) -> Result<(), String> {
    let path = store_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建桌面布局目录失败: {}", e))?;
    }
    if create_backup {
        backup_store_file(&path)?;
    }
    let content =
        serde_json::to_string_pretty(store).map_err(|e| format!("序列化桌面布局失败: {}", e))?;
    let temp_path = path.with_file_name(format!(".desktop_layouts.{}.tmp", new_id()));
    let write_result = (|| -> Result<(), String> {
        let mut temp_file =
            File::create(&temp_path).map_err(|e| format!("创建桌面布局临时文件失败: {}", e))?;
        temp_file
            .write_all(content.as_bytes())
            .map_err(|e| format!("写入桌面布局临时文件失败: {}", e))?;
        temp_file
            .sync_all()
            .map_err(|e| format!("同步桌面布局临时文件失败: {}", e))?;
        drop(temp_file);
        replace_store_file(&temp_path, &path)
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

#[cfg(windows)]
fn replace_store_file(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::winbase::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH};

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        Err(format!(
            "替换桌面布局数据失败: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_store_file(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination).map_err(|e| format!("替换桌面布局数据失败: {}", e))
}

pub fn desktop_box_launch_flag_enabled() -> bool {
    std::env::args().any(|value| value == "--desktop-box-new")
}

pub fn desktop_box_manage_launch_flag_enabled() -> bool {
    std::env::args().any(|value| value == "--desktop-box-manage")
}

pub fn write_desktop_box_pending_request() {
    let Ok(path) = pending_box_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let count = if pending_request_is_recent(&path) {
        read_pending_request_count(&path).saturating_add(1)
    } else {
        1
    };
    let payload = serde_json::json!({
        "count": count,
        "createdAt": Utc::now().to_rfc3339(),
    });
    let _ = fs::write(path, payload.to_string());
}

pub fn write_desktop_box_manage_pending_request() {
    let Ok(path) = desktop_box_manage_pending_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let payload = serde_json::json!({
        "createdAt": Utc::now().to_rfc3339(),
    });
    let _ = fs::write(path, payload.to_string());
}

pub fn desktop_box_pending_exists() -> bool {
    pending_box_path()
        .map(|path| {
            if !pending_request_is_recent(&path) {
                let _ = fs::remove_file(path);
                return false;
            }
            read_pending_request_count(&path) > 0
        })
        .unwrap_or(false)
}

pub fn desktop_box_manage_pending_exists() -> bool {
    desktop_box_manage_pending_path()
        .map(|path| {
            if !pending_request_is_recent(&path) {
                let _ = fs::remove_file(path);
                return false;
            }
            path.exists()
        })
        .unwrap_or(false)
}

/// Pending files are only valid while another McStartUP instance is already
/// running and the single-instance listener can consume them. A normal app
/// startup must never replay requests left by a crashed or killed process.
pub fn discard_pending_desktop_box_requests() {
    if let Ok(path) = pending_box_path() {
        let _ = fs::remove_file(path);
    }
    if let Ok(path) = desktop_box_manage_pending_path() {
        let _ = fs::remove_file(path);
    }
}

pub fn take_pending_desktop_box_request() -> bool {
    desktop_box_pending_exists()
}

pub fn handle_pending_desktop_box_request(app_handle: &tauri::AppHandle) -> Result<bool, String> {
    if !take_pending_desktop_box_request() {
        return Ok(false);
    }
    match create_desktop_box_window(app_handle) {
        Ok(_) => {
            acknowledge_pending_desktop_box_request()?;
            Ok(true)
        }
        Err(error) => Err(error),
    }
}

pub fn handle_pending_desktop_box_manage_request(
    app_handle: &tauri::AppHandle,
) -> Result<bool, String> {
    use tauri::Manager;

    if !desktop_box_manage_pending_exists() {
        return Ok(false);
    }

    let result = show_desktop_box_windows(app_handle);
    if let Ok(path) = desktop_box_manage_pending_path() {
        let _ = fs::remove_file(path);
    }
    result.map(|shown| {
        if shown == 0 {
            if let Some(window) = app_handle.get_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        true
    })
}

#[tauri::command]
pub fn desktop_box_set_sort_mode(
    app_handle: tauri::AppHandle,
    box_id: String,
    sort_mode: String,
) -> Result<DesktopBoxView, String> {
    let mode = DesktopBoxSortMode::parse(&sort_mode)?;
    let view = set_box_icon_sort_mode(&box_id, mode)?;
    refresh_box_window(&app_handle, &box_id);
    Ok(view)
}

fn acknowledge_pending_desktop_box_request() -> Result<(), String> {
    let path = pending_box_path()?;
    let count = read_pending_request_count(&path);
    if count <= 1 {
        if path.exists() {
            fs::remove_file(path).map_err(|e| format!("清理桌面盒子请求失败: {}", e))?;
        }
        return Ok(());
    }
    let payload = serde_json::json!({
        "count": count - 1,
        "createdAt": Utc::now().to_rfc3339(),
    });
    fs::write(path, payload.to_string()).map_err(|e| format!("更新桌面盒子请求队列失败: {}", e))
}

fn read_pending_request_count(path: &Path) -> u32 {
    let Ok(content) = fs::read_to_string(path) else {
        return 0;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return 1;
    };
    value
        .get("count")
        .and_then(|count| count.as_u64())
        .map(|count| count.min(u32::MAX as u64) as u32)
        .unwrap_or_else(|| {
            if value.get("createdAt").is_some() {
                1
            } else {
                0
            }
        })
}

fn pending_request_is_recent(path: &Path) -> bool {
    let Ok(content) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return false;
    };
    let Some(created_at) = value.get("createdAt").and_then(|value| value.as_str()) else {
        return false;
    };
    let Ok(created_at) = DateTime::parse_from_rfc3339(created_at) else {
        return false;
    };
    let age = Utc::now().signed_duration_since(created_at.with_timezone(&Utc));
    age >= Duration::seconds(-5) && age <= Duration::seconds(PENDING_REQUEST_MAX_AGE_SECONDS)
}

fn pending_box_path() -> Result<PathBuf, String> {
    Storage::get_config_dir()
        .map(|dir| dir.join(DESKTOP_BOX_PENDING_FILE))
        .map_err(|e| e.to_string())
}

fn desktop_box_manage_pending_path() -> Result<PathBuf, String> {
    Storage::get_config_dir()
        .map(|dir| dir.join(DESKTOP_BOX_MANAGE_PENDING_FILE))
        .map_err(|e| e.to_string())
}

fn create_desktop_box_window(app_handle: &tauri::AppHandle) -> Result<DesktopBoxView, String> {
    let _store_guard = lock_store();
    let mut store = read_store_unlocked()?;
    let previous_store = store.clone();
    let global_appearance = store.box_appearance.clone();
    let (cursor_x, cursor_y) = cursor_position().unwrap_or((120, 120));
    let now = Utc::now().to_rfc3339();
    if store.layouts.is_empty() {
        let layout = DesktopLayout {
            id: new_id(),
            name: "默认桌面".to_string(),
            canvas_width: DEFAULT_CANVAS_WIDTH.max(cursor_x + DEFAULT_BOX_WIDTH + 120),
            canvas_height: DEFAULT_CANVAS_HEIGHT.max(cursor_y + DEFAULT_BOX_HEIGHT + 120),
            fences: Vec::new(),
            icon_assignments: Vec::new(),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        store.active_layout_id = Some(layout.id.clone());
        store.layouts.push(layout);
    }
    let active_id = store
        .active_layout_id
        .clone()
        .or_else(|| store.layouts.first().map(|layout| layout.id.clone()))
        .ok_or_else(|| "无法创建桌面盒子：没有可用布局。".to_string())?;
    let layout = store
        .layouts
        .iter_mut()
        .find(|layout| layout.id == active_id)
        .ok_or_else(|| "无法创建桌面盒子：当前布局不存在。".to_string())?;
    let (x, y) = find_box_position(
        &layout.fences,
        cursor_x,
        cursor_y,
        DEFAULT_BOX_WIDTH,
        DEFAULT_BOX_HEIGHT,
        desktop_work_area_at(cursor_x, cursor_y),
    );
    let order = layout.fences.len() as i32;
    let fence = DesktopFence {
        id: new_id(),
        name: format!("Box {}", order + 1),
        x,
        y,
        width: DEFAULT_BOX_WIDTH,
        height: DEFAULT_BOX_HEIGHT,
        color: FENCE_COLORS[order as usize % FENCE_COLORS.len()].to_string(),
        view_mode: default_box_view_mode(),
        sort_mode: default_box_sort_mode(),
        opacity: global_appearance.opacity,
        background_color: default_box_background(),
        icon_spacing: global_appearance.icon_spacing,
        icon_vertical_spacing: global_appearance.icon_vertical_spacing,
        collapsed: false,
        hidden: false,
        order,
    };
    layout.canvas_width = layout.canvas_width.max(fence.x + fence.width + 120);
    layout.canvas_height = layout.canvas_height.max(fence.y + fence.height + 120);
    layout.updated_at = now;
    layout.fences.push(fence.clone());
    let view = box_view(layout, &fence, None);
    write_store_unlocked(&normalize_store(store))?;
    mark_box_for_focus(&fence.id);
    if let Err(error) = open_box_window(app_handle, &fence, None) {
        take_box_focus_request(&fence.id);
        let _ = write_store_unlocked(&previous_store);
        return Err(error);
    }
    Ok(view)
}

fn open_box_window(
    app_handle: &tauri::AppHandle,
    fence: &DesktopFence,
    reveal_focus: Option<bool>,
) -> Result<(), String> {
    use tauri::{Manager, WindowBuilder, WindowUrl};

    let label = format!("{}{}", DESKTOP_BOX_LABEL_PREFIX, fence.id);
    let (window_x, window_y) = visible_box_position(fence);
    let (window_width, _) = bounded_box_dimensions(fence);
    if let Some(window) = app_handle.get_window(&label) {
        eprintln!("[DesktopBox] reuse window id={}", fence.id);
        attach_box_window_to_desktop(&window, fence)?;
        if let Some(focus) = reveal_focus {
            reveal_box_window(&window, fence, focus);
        }
        return Ok(());
    }

    let builder = WindowBuilder::new(app_handle, &label, WindowUrl::App("index.html".into()))
        // The React header is the only visible Box title. A native title lets
        // Windows/WebView2 paint a second title above the transparent page.
        .title("")
        // The persisted geometry uses Windows physical pixels. Build at a
        // neutral size, then apply the physical geometry below to avoid DPI
        // scaling drift.
        .position(0.0, 0.0)
        .inner_size(160.0, 120.0)
        .min_inner_size(160.0, COLLAPSED_BOX_HEIGHT as f64)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(false)
        .skip_taskbar(true)
        // The page is hidden while WebView2 initializes. The native HWND is
        // created as a child of Explorer below, so no post-load SetParent is
        // needed for the normal startup path.
        .visible(false);

    #[cfg(windows)]
    let builder = {
        let host = windows_desktop_icons::desktop_shell_host()
            .ok_or_else(|| "没有找到 Explorer 桌面 SHELLDLL_DefView。".to_string())?;
        builder.parent_window(windows_039::Win32::Foundation::HWND(host as isize))
    };

    let window = builder
        .build()
        .map_err(|e| format!("创建桌面盒子窗口失败: {}", e))?;
    eprintln!("[DesktopBox] built hidden window id={}", fence.id);
    // Apply screen-space geometry directly to the child HWND. Tauri's
    // set_position would interpret a child position as parent-client
    // coordinates and would shift Boxes on secondary/negative monitors.
    #[cfg(windows)]
    {
        let window_height = box_window_height(&window, fence) as i32;
        let hwnd = window
            .hwnd()
            .map_err(|error| format!("无法获取桌面盒子窗口句柄: {}", error))?;
        unsafe {
            set_box_hwnd_screen_geometry(
                hwnd.0 as winapi::shared::windef::HWND,
                window_x,
                window_y,
                window_width.max(160),
                window_height.max(1),
                winapi::um::winuser::SWP_NOACTIVATE
                    | winapi::um::winuser::SWP_NOZORDER
                    | winapi::um::winuser::SWP_FRAMECHANGED,
            )?;
        }
    }
    #[cfg(not(windows))]
    {
        let window_height = box_window_height(&window, fence);
        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: window_x,
                y: window_y,
            }))
            .map_err(|error| format!("设置桌面盒子位置失败: {}", error))?;
        window
            .set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: window_width.max(160) as u32,
                height: window_height,
            }))
            .map_err(|error| format!("设置桌面盒子大小失败: {}", error))?;
    }
    attach_box_window_to_desktop(&window, fence)?;
    Ok(())
}

fn box_window_height(window: &tauri::Window, fence: &DesktopFence) -> u32 {
    if !fence.collapsed {
        return fence.height.max(120) as u32;
    }
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    (COLLAPSED_BOX_HEIGHT as f64 * scale_factor)
        .round()
        .max(1.0) as u32
}

fn reveal_box_window(window: &tauri::Window, fence: &DesktopFence, focus: bool) {
    let _ = window.show();
    #[cfg(windows)]
    {
        // Tao reapplies its default frame styles when the queued show
        // operation runs. Queue the cleanup after show on the same event-loop
        // thread, otherwise a caption/border can reappear intermittently.
        let native_window = window.clone();
        let fence = fence.clone();
        let _ = window.run_on_main_thread(move || {
            let Ok(hwnd) = native_window.hwnd() else {
                return;
            };
            unsafe {
                let hwnd = hwnd.0 as winapi::shared::windef::HWND;
                clear_box_window_frame(hwnd);
                let (x, y) = visible_box_position(&fence);
                let (width, _) = bounded_box_dimensions(&fence);
                let height = box_window_height(&native_window, &fence) as i32;
                if let Err(error) = set_box_hwnd_screen_geometry(
                    hwnd,
                    x,
                    y,
                    width.max(160),
                    height.max(1),
                    winapi::um::winuser::SWP_NOACTIVATE
                        | winapi::um::winuser::SWP_NOZORDER
                        | winapi::um::winuser::SWP_FRAMECHANGED,
                ) {
                    eprintln!("[DesktopBox] final geometry failed: {}", error);
                }
                winapi::um::winuser::ShowWindow(hwnd, winapi::um::winuser::SW_SHOWNOACTIVATE);
            }
            pulse_window_z_order(&native_window);
            if focus {
                let _ = native_window.set_focus();
            }
        });
    }
    #[cfg(not(windows))]
    {
        let _ = fence;
        if focus {
            let _ = window.set_focus();
        }
    }
}

#[cfg(windows)]
fn start_box_window_resize(
    window: &tauri::Window,
    edges: BoxResizeEdges,
    scale_factor: f64,
    snap_targets: Vec<BoxSnapRect>,
) -> Result<(), String> {
    use winapi::um::winuser::{
        GetAsyncKeyState, GetCursorPos, GetWindowRect, IsWindow, VK_LBUTTON,
    };

    let hwnd = window
        .hwnd()
        .map_err(|error| format!("无法获取桌面盒子窗口句柄: {}", error))?
        .0 as isize;
    {
        let mut active = BOX_RESIZE_WINDOWS
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !active.insert(hwnd) {
            return Ok(());
        }
    }

    let min_width = (160.0 * scale_factor).round().max(1.0) as i32;
    let min_height = (120.0 * scale_factor).round().max(1.0) as i32;
    let snap_distance = scaled_box_snap_value(BOX_SNAP_DISTANCE, scale_factor);
    let snap_gap = scaled_box_snap_value(BOX_SNAP_GAP, scale_factor);
    std::thread::spawn(move || {
        let resize = || unsafe {
            let hwnd = hwnd as winapi::shared::windef::HWND;
            let mut start_rect: winapi::shared::windef::RECT = std::mem::zeroed();
            let mut start_cursor: winapi::shared::windef::POINT = std::mem::zeroed();
            if GetWindowRect(hwnd, &mut start_rect) == 0 || GetCursorPos(&mut start_cursor) == 0 {
                return;
            }

            while IsWindow(hwnd) != 0 && GetAsyncKeyState(VK_LBUTTON) < 0 {
                let mut cursor: winapi::shared::windef::POINT = std::mem::zeroed();
                if GetCursorPos(&mut cursor) == 0 {
                    break;
                }
                let delta_x = cursor.x.saturating_sub(start_cursor.x);
                let delta_y = cursor.y.saturating_sub(start_cursor.y);
                let mut left = start_rect.left;
                let mut top = start_rect.top;
                let mut right = start_rect.right;
                let mut bottom = start_rect.bottom;

                if edges.left {
                    left = start_rect
                        .left
                        .saturating_add(delta_x)
                        .min(start_rect.right.saturating_sub(min_width));
                }
                if edges.right {
                    right = start_rect
                        .right
                        .saturating_add(delta_x)
                        .max(start_rect.left.saturating_add(min_width));
                }
                if edges.top {
                    top = start_rect
                        .top
                        .saturating_add(delta_y)
                        .min(start_rect.bottom.saturating_sub(min_height));
                }
                if edges.bottom {
                    bottom = start_rect
                        .bottom
                        .saturating_add(delta_y)
                        .max(start_rect.top.saturating_add(min_height));
                }

                let raw_rect = BoxSnapRect {
                    left,
                    top,
                    right,
                    bottom,
                };
                let (center_x, center_y) = raw_rect.center();
                let snapped = snap_resized_box_rect(
                    raw_rect,
                    edges,
                    min_width,
                    min_height,
                    desktop_work_area_at(center_x, center_y),
                    &snap_targets,
                    snap_distance,
                    snap_gap,
                );

                let _ = set_box_hwnd_screen_geometry(
                    hwnd,
                    snapped.left,
                    snapped.top,
                    snapped.width(),
                    snapped.height(),
                    box_interactive_geometry_flags(),
                );
                std::thread::sleep(std::time::Duration::from_millis(8));
            }
        };
        resize();
        BOX_RESIZE_WINDOWS
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&hwnd);
    });
    Ok(())
}

#[cfg(not(windows))]
fn start_box_window_resize(
    _window: &tauri::Window,
    _edges: BoxResizeEdges,
    _scale_factor: f64,
    _snap_targets: Vec<BoxSnapRect>,
) -> Result<(), String> {
    Err("桌面盒子拉伸仅支持 Windows。".to_string())
}

#[cfg(windows)]
fn start_box_window_drag(
    window: &tauri::Window,
    scale_factor: f64,
    snap_targets: Vec<BoxSnapRect>,
) -> Result<(), String> {
    use winapi::um::winuser::{
        GetAsyncKeyState, GetCursorPos, GetWindowRect, IsWindow, VK_LBUTTON,
    };

    let hwnd = window
        .hwnd()
        .map_err(|error| format!("无法获取桌面盒子窗口句柄: {}", error))?
        .0 as isize;
    {
        let mut active = BOX_DRAG_WINDOWS
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !active.insert(hwnd) {
            return Ok(());
        }
    }

    let snap_distance = scaled_box_snap_value(BOX_SNAP_DISTANCE, scale_factor);
    let snap_gap = scaled_box_snap_value(BOX_SNAP_GAP, scale_factor);
    std::thread::spawn(move || {
        let drag = || unsafe {
            let hwnd = hwnd as winapi::shared::windef::HWND;
            let mut start_rect: winapi::shared::windef::RECT = std::mem::zeroed();
            let mut start_cursor: winapi::shared::windef::POINT = std::mem::zeroed();
            if GetWindowRect(hwnd, &mut start_rect) == 0 || GetCursorPos(&mut start_cursor) == 0 {
                return;
            }
            while IsWindow(hwnd) != 0 && GetAsyncKeyState(VK_LBUTTON) < 0 {
                let mut cursor: winapi::shared::windef::POINT = std::mem::zeroed();
                if GetCursorPos(&mut cursor) == 0 {
                    break;
                }
                let raw_rect = BoxSnapRect::from_geometry(
                    start_rect
                        .left
                        .saturating_add(cursor.x.saturating_sub(start_cursor.x)),
                    start_rect
                        .top
                        .saturating_add(cursor.y.saturating_sub(start_cursor.y)),
                    start_rect.right.saturating_sub(start_rect.left),
                    start_rect.bottom.saturating_sub(start_rect.top),
                );
                let (center_x, center_y) = raw_rect.center();
                let snapped = snap_moved_box_rect(
                    raw_rect,
                    desktop_work_area_at(center_x, center_y),
                    &snap_targets,
                    snap_distance,
                    snap_gap,
                );
                let _ = set_box_hwnd_screen_geometry(
                    hwnd,
                    snapped.left,
                    snapped.top,
                    snapped.width(),
                    snapped.height(),
                    box_interactive_geometry_flags(),
                );
                std::thread::sleep(std::time::Duration::from_millis(8));
            }
        };
        drag();
        BOX_DRAG_WINDOWS
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&hwnd);
    });
    Ok(())
}

#[cfg(not(windows))]
fn start_box_window_drag(
    _window: &tauri::Window,
    _scale_factor: f64,
    _snap_targets: Vec<BoxSnapRect>,
) -> Result<(), String> {
    Err("桌面盒子拖动仅支持 Windows。".to_string())
}

#[cfg(windows)]
fn attach_box_window_to_desktop(
    window: &tauri::Window,
    fence: &DesktopFence,
) -> Result<(), String> {
    use winapi::um::winuser::{
        GetParent, GetWindowLongW, IsWindow, SetParent, GWL_EXSTYLE, GWL_STYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOZORDER,
    };

    let hwnd = window
        .hwnd()
        .map_err(|error| format!("无法获取桌面盒子窗口句柄: {}", error))?;
    let hwnd = hwnd.0 as winapi::shared::windef::HWND;
    let host = windows_desktop_icons::desktop_shell_host()
        .map(|value| value as winapi::shared::windef::HWND)
        .ok_or_else(|| "没有找到 Explorer 桌面 SHELLDLL_DefView。".to_string())?;
    if unsafe { IsWindow(host) } == 0 {
        return Err("Explorer 桌面宿主窗口已经失效。".to_string());
    }

    unsafe {
        clear_box_window_frame(hwnd);
        let current_parent = GetParent(hwnd);

        // Microsoft documents that WS_CHILD must be set before SetParent when
        // moving a top-level window into a new parent. The normal startup path
        // never enters this branch because WindowBuilder creates the child
        // directly; it is retained only for an Explorer shell restart.
        if current_parent != host {
            eprintln!(
                "[DesktopBox] reparent hwnd=0x{:X} old_parent=0x{:X} host=0x{:X}",
                hwnd as usize, current_parent as usize, host as usize
            );
            SetParent(hwnd, host);
            if GetParent(hwnd) != host {
                return Err(format!(
                    "挂载桌面盒子到 Explorer 失败: {}",
                    std::io::Error::last_os_error()
                ));
            }
        }

        let (x, y) = visible_box_position(fence);
        let (width, _) = bounded_box_dimensions(fence);
        let height = box_window_height(window, fence) as i32;
        set_box_hwnd_screen_geometry(
            hwnd,
            x,
            y,
            width.max(160),
            height.max(1),
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_FRAMECHANGED,
        )?;

        let applied_style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
        let applied_ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if GetParent(hwnd) != host || !box_window_styles_are_valid(applied_style, applied_ex_style)
        {
            return Err("Explorer 桌面子窗口样式没有成功应用。".to_string());
        }
        eprintln!(
            "[DesktopBox] attached hwnd=0x{:X} host=0x{:X} style=0x{:08X} ex=0x{:08X}",
            hwnd as usize, host as usize, applied_style, applied_ex_style
        );
    }
    Ok(())
}

#[cfg(windows)]
unsafe fn clear_box_window_frame(hwnd: winapi::shared::windef::HWND) {
    use winapi::um::winuser::{
        GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_EXSTYLE, GWL_STYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    };

    let style = normalized_box_window_style(GetWindowLongW(hwnd, GWL_STYLE) as u32);
    SetWindowLongW(hwnd, GWL_STYLE, style as i32);
    let ex_style = normalized_box_window_ex_style(GetWindowLongW(hwnd, GWL_EXSTYLE) as u32);
    SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style as i32);
    SetWindowPos(
        hwnd,
        std::ptr::null_mut(),
        0,
        0,
        0,
        0,
        SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED,
    );
}

#[cfg(windows)]
fn normalized_box_window_style(current: u32) -> u32 {
    use winapi::um::winuser::{
        WS_BORDER, WS_CAPTION, WS_CHILD, WS_DLGFRAME, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP,
        WS_SYSMENU, WS_THICKFRAME,
    };

    let top_level_frame = WS_CAPTION
        | WS_SYSMENU
        | WS_MINIMIZEBOX
        | WS_MAXIMIZEBOX
        | WS_THICKFRAME
        | WS_BORDER
        | WS_DLGFRAME
        | WS_POPUP;
    (current & !top_level_frame) | WS_CHILD
}

#[cfg(windows)]
fn normalized_box_window_ex_style(current: u32) -> u32 {
    use winapi::um::winuser::{WS_EX_APPWINDOW, WS_EX_TOPMOST};

    current & !(WS_EX_APPWINDOW | WS_EX_TOPMOST)
}

#[cfg(windows)]
fn box_window_styles_are_valid(style: u32, ex_style: u32) -> bool {
    use winapi::um::winuser::{
        WS_BORDER, WS_CAPTION, WS_CHILD, WS_DLGFRAME, WS_EX_APPWINDOW, WS_EX_TOPMOST,
        WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP, WS_SYSMENU, WS_THICKFRAME,
    };

    let forbidden_style = WS_CAPTION
        | WS_SYSMENU
        | WS_MINIMIZEBOX
        | WS_MAXIMIZEBOX
        | WS_THICKFRAME
        | WS_BORDER
        | WS_DLGFRAME
        | WS_POPUP;
    style & WS_CHILD != 0
        && style & forbidden_style == 0
        && ex_style & (WS_EX_APPWINDOW | WS_EX_TOPMOST) == 0
}

#[cfg(not(windows))]
fn attach_box_window_to_desktop(
    _window: &tauri::Window,
    _fence: &DesktopFence,
) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
unsafe fn set_box_hwnd_screen_geometry(
    hwnd: winapi::shared::windef::HWND,
    screen_x: i32,
    screen_y: i32,
    width: i32,
    height: i32,
    flags: u32,
) -> Result<(), String> {
    use std::ptr::null_mut;
    use winapi::shared::windef::{POINT, RECT};
    use winapi::um::winuser::{
        GetParent, GetWindowRect, MapWindowPoints, RedrawWindow, SetWindowPos, RDW_ALLCHILDREN,
        RDW_ERASE, RDW_INVALIDATE, RDW_UPDATENOW, SWP_NOCOPYBITS,
    };

    let parent = GetParent(hwnd);
    let mut previous_rect: RECT = std::mem::zeroed();
    let had_previous_rect = GetWindowRect(hwnd, &mut previous_rect) != 0;
    let mut origin = POINT {
        x: screen_x,
        y: screen_y,
    };
    if !parent.is_null() {
        MapWindowPoints(null_mut(), parent, &mut origin, 1);
    }
    if SetWindowPos(
        hwnd,
        null_mut(),
        origin.x,
        origin.y,
        width.max(1),
        height.max(1),
        flags,
    ) == 0
    {
        return Err(format!(
            "设置桌面盒子窗口位置失败: {}",
            std::io::Error::last_os_error()
        ));
    }
    if flags & SWP_NOCOPYBITS != 0 {
        RedrawWindow(
            hwnd,
            null_mut(),
            null_mut(),
            RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN,
        );
        if had_previous_rect && !parent.is_null() {
            MapWindowPoints(
                null_mut(),
                parent,
                (&mut previous_rect as *mut RECT).cast::<POINT>(),
                2,
            );
            RedrawWindow(
                parent,
                &previous_rect,
                null_mut(),
                RDW_INVALIDATE | RDW_ERASE | RDW_UPDATENOW | RDW_ALLCHILDREN,
            );
        }
    }
    Ok(())
}

#[cfg(windows)]
fn box_interactive_geometry_flags() -> u32 {
    use winapi::um::winuser::{SWP_NOACTIVATE, SWP_NOCOPYBITS, SWP_NOZORDER};

    SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOCOPYBITS
}

#[cfg(windows)]
fn box_window_screen_geometry(window: &tauri::Window) -> Result<(i32, i32, i32, i32), String> {
    use winapi::um::winuser::GetWindowRect;

    let hwnd = window
        .hwnd()
        .map_err(|error| format!("无法获取桌面盒子窗口句柄: {}", error))?;
    let mut rect: winapi::shared::windef::RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(hwnd.0 as winapi::shared::windef::HWND, &mut rect) } == 0 {
        return Err(format!(
            "读取桌面盒子屏幕位置失败: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok((
        rect.left,
        rect.top,
        rect.right.saturating_sub(rect.left),
        rect.bottom.saturating_sub(rect.top),
    ))
}

#[cfg(not(windows))]
fn box_window_screen_geometry(window: &tauri::Window) -> Result<(i32, i32, i32, i32), String> {
    let position = window
        .outer_position()
        .map_err(|error| format!("读取桌面盒子位置失败: {}", error))?;
    let size = window
        .outer_size()
        .map_err(|error| format!("读取桌面盒子大小失败: {}", error))?;
    Ok((
        position.x,
        position.y,
        size.width as i32,
        size.height as i32,
    ))
}

#[cfg(windows)]
fn pulse_window_z_order(window: &tauri::Window) {
    use winapi::um::winuser::{
        SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };

    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let hwnd = hwnd.0 as winapi::shared::windef::HWND;
    let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE;
    unsafe {
        SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, flags);
    }
}

fn find_box(box_id: &str) -> Result<Option<DesktopBoxView>, String> {
    let store = read_store()?;
    for layout in store.layouts {
        if let Some(fence) = layout.fences.iter().find(|fence| fence.id == box_id) {
            return Ok(Some(box_view(&layout, fence, None)));
        }
    }
    Ok(None)
}

fn scaled_box_snap_value(value: i32, scale_factor: f64) -> i32 {
    (value as f64 * scale_factor).round().max(1.0) as i32
}

fn nearest_snap(value: i32, candidates: impl IntoIterator<Item = i32>, distance: i32) -> i32 {
    candidates
        .into_iter()
        .filter_map(|candidate| {
            let delta = (candidate as i64 - value as i64).abs();
            (delta <= distance as i64).then_some((delta, candidate))
        })
        .min_by_key(|(delta, _)| *delta)
        .map_or(value, |(_, candidate)| candidate)
}

fn snap_moved_box_rect(
    raw: BoxSnapRect,
    work_area: Option<DesktopWorkArea>,
    targets: &[BoxSnapRect],
    snap_distance: i32,
    gap: i32,
) -> BoxSnapRect {
    let width = raw.width();
    let height = raw.height();
    let mut x_candidates = Vec::with_capacity(2 + targets.len() * 4);
    let mut y_candidates = Vec::with_capacity(2 + targets.len() * 4);

    if let Some(area) = work_area {
        x_candidates.extend([area.left, area.right.saturating_sub(width)]);
        y_candidates.extend([area.top, area.bottom.saturating_sub(height)]);
    }
    for target in targets {
        x_candidates.extend([
            target.left,
            target.right.saturating_sub(width),
            target.right.saturating_add(gap),
            target.left.saturating_sub(gap).saturating_sub(width),
        ]);
        y_candidates.extend([
            target.top,
            target.bottom.saturating_sub(height),
            target.bottom.saturating_add(gap),
            target.top.saturating_sub(gap).saturating_sub(height),
        ]);
    }

    let left = nearest_snap(raw.left, x_candidates, snap_distance);
    let top = nearest_snap(raw.top, y_candidates, snap_distance);
    BoxSnapRect::from_geometry(left, top, width, height)
}

fn snap_resized_box_rect(
    raw: BoxSnapRect,
    edges: BoxResizeEdges,
    min_width: i32,
    min_height: i32,
    work_area: Option<DesktopWorkArea>,
    targets: &[BoxSnapRect],
    snap_distance: i32,
    gap: i32,
) -> BoxSnapRect {
    let mut left_candidates = Vec::with_capacity(1 + targets.len() * 2);
    let mut right_candidates = Vec::with_capacity(1 + targets.len() * 2);
    let mut top_candidates = Vec::with_capacity(1 + targets.len() * 2);
    let mut bottom_candidates = Vec::with_capacity(1 + targets.len() * 2);

    if let Some(area) = work_area {
        left_candidates.push(area.left);
        right_candidates.push(area.right);
        top_candidates.push(area.top);
        bottom_candidates.push(area.bottom);
    }
    for target in targets {
        left_candidates.extend([target.left, target.right.saturating_add(gap)]);
        right_candidates.extend([target.right, target.left.saturating_sub(gap)]);
        top_candidates.extend([target.top, target.bottom.saturating_add(gap)]);
        bottom_candidates.extend([target.bottom, target.top.saturating_sub(gap)]);
    }

    let left = if edges.left {
        nearest_snap(
            raw.left,
            left_candidates
                .into_iter()
                .filter(|candidate| *candidate <= raw.right.saturating_sub(min_width)),
            snap_distance,
        )
    } else {
        raw.left
    };
    let right = if edges.right {
        nearest_snap(
            raw.right,
            right_candidates
                .into_iter()
                .filter(|candidate| *candidate >= raw.left.saturating_add(min_width)),
            snap_distance,
        )
    } else {
        raw.right
    };
    let top = if edges.top {
        nearest_snap(
            raw.top,
            top_candidates
                .into_iter()
                .filter(|candidate| *candidate <= raw.bottom.saturating_sub(min_height)),
            snap_distance,
        )
    } else {
        raw.top
    };
    let bottom = if edges.bottom {
        nearest_snap(
            raw.bottom,
            bottom_candidates
                .into_iter()
                .filter(|candidate| *candidate >= raw.top.saturating_add(min_height)),
            snap_distance,
        )
    } else {
        raw.bottom
    };

    BoxSnapRect {
        left,
        top,
        right,
        bottom,
    }
}

#[cfg(windows)]
fn desktop_box_snap_targets(
    app_handle: &tauri::AppHandle,
    current_label: &str,
) -> Vec<BoxSnapRect> {
    desktop_box_window_targets(app_handle)
        .into_iter()
        .filter(|target| target.label != current_label)
        .map(|target| target.rect)
        .collect()
}

#[cfg(not(windows))]
fn desktop_box_snap_targets(
    _app_handle: &tauri::AppHandle,
    _current_label: &str,
) -> Vec<BoxSnapRect> {
    Vec::new()
}

#[cfg(windows)]
fn desktop_box_window_targets(app_handle: &tauri::AppHandle) -> Vec<DesktopBoxWindowTarget> {
    use tauri::Manager;
    use winapi::um::winuser::{GetWindowRect, GetWindowThreadProcessId};

    app_handle
        .windows()
        .into_iter()
        .filter(|(label, window)| {
            label.starts_with(DESKTOP_BOX_LABEL_PREFIX) && window.is_visible().unwrap_or(false)
        })
        .filter_map(|(label, window)| {
            let box_id = label.strip_prefix(DESKTOP_BOX_LABEL_PREFIX)?.to_string();
            let hwnd = window.hwnd().ok()?.0 as isize;
            let mut process_id = 0;
            unsafe {
                GetWindowThreadProcessId(hwnd as winapi::shared::windef::HWND, &mut process_id);
            }
            if process_id == 0 {
                return None;
            }
            let mut rect: winapi::shared::windef::RECT = unsafe { std::mem::zeroed() };
            if unsafe { GetWindowRect(hwnd as winapi::shared::windef::HWND, &mut rect) } == 0
                || rect.right <= rect.left
                || rect.bottom <= rect.top
            {
                return None;
            }
            Some(DesktopBoxWindowTarget {
                box_id,
                label,
                hwnd,
                process_id,
                rect: BoxSnapRect {
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                },
            })
        })
        .collect()
}

fn emit_box_event<S: Serialize + Clone>(
    app_handle: &tauri::AppHandle,
    box_id: &str,
    event: &str,
    payload: S,
) {
    use tauri::Manager;

    let label = format!("{}{}", DESKTOP_BOX_LABEL_PREFIX, box_id);
    if let Some(window) = app_handle.get_window(&label) {
        let _ = window.emit(event, payload);
    }
}

fn refresh_box_window(app_handle: &tauri::AppHandle, box_id: &str) {
    emit_box_event(app_handle, box_id, DESKTOP_BOX_DATA_CHANGED_EVENT, ());
}

fn refresh_box_windows(app_handle: &tauri::AppHandle, box_ids: &HashSet<String>) {
    for box_id in box_ids {
        refresh_box_window(app_handle, box_id);
    }
}

#[cfg(windows)]
fn install_box_shell_drop_targets(
    app_handle: &tauri::AppHandle,
    window: &tauri::Window,
    box_id: &str,
) -> Result<(), String> {
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::System::Ole::OleInitialize;
    use windows::Win32::System::Ole::{IDropTarget, RegisterDragDrop, RevokeDragDrop};
    use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;

    // RegisterDragDrop is an OLE API and must run on an OLE-initialized
    // thread. Tauri may dispatch this command on a worker thread, so
    // initialize OLE once for that thread and keep it alive with the native
    // drop targets for the process lifetime. RPC_E_CHANGED_MODE means the
    // thread was already initialized by the host; registration is still
    // attempted and any HRESULT is reported below.
    BOX_SHELL_OLE_INITIALIZED.with(|initialized| {
        if initialized.get() {
            return;
        }
        match unsafe { OleInitialize(None) } {
            Ok(()) => initialized.set(true),
            Err(error) if error.code() == RPC_E_CHANGED_MODE => {
                eprintln!(
                    "[DesktopBox] OLE thread already initialized with another apartment model; continuing registration"
                );
            }
            Err(error) => {
                eprintln!(
                    "[DesktopBox] OLE initialization failed (HRESULT=0x{:08X}); RegisterDragDrop may fail",
                    error.code().0 as u32
                );
            }
        }
    });

    unsafe extern "system" fn collect_child(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let children = &mut *(lparam.0 as *mut Vec<HWND>);
        children.push(hwnd);
        BOOL(1)
    }

    let root = HWND(
        window
            .hwnd()
            .map_err(|error| format!("读取桌面盒子窗口句柄失败: {}", error))?
            .0,
    );
    let mut children: Vec<HWND> = Vec::new();
    unsafe {
        EnumChildWindows(
            root,
            Some(collect_child),
            LPARAM((&mut children as *mut Vec<HWND>) as isize),
        );
    }
    if children.is_empty() {
        return Err("没有找到桌面盒子的 WebView2 子窗口。".to_string());
    }

    BOX_SHELL_DROP_TARGETS.with(|targets| {
        let mut targets = targets.borrow_mut();
        if let Some(previous_targets) = targets.remove(box_id) {
            for (hwnd, _) in previous_targets {
                unsafe {
                    let _ = RevokeDragDrop(HWND(hwnd));
                }
            }
        }

        let mut registered = Vec::new();
        for child in children {
            let target: IDropTarget =
                DesktopBoxShellDropTarget::new(app_handle.clone(), box_id.to_string()).into();
            unsafe {
                let _ = RevokeDragDrop(child);
                match RegisterDragDrop(child, &target) {
                    Ok(()) => registered.push((child.0, target)),
                    Err(error) => eprintln!(
                        "[DesktopBox] RegisterDragDrop failed hwnd={:?} HRESULT=0x{:08X}",
                        child,
                        error.code().0 as u32
                    ),
                }
            }
        }
        if registered.is_empty() {
            return Err("Windows 未能注册桌面盒子的 Shell 拖放目标。".to_string());
        }
        targets.insert(box_id.to_string(), registered);
        Ok(())
    })
}

#[cfg(windows)]
#[windows::core::implement(windows::Win32::System::Ole::IDropTarget)]
struct DesktopBoxShellDropTarget {
    app_handle: tauri::AppHandle,
    box_id: String,
    cursor_effect: Mutex<u32>,
}

#[cfg(windows)]
impl DesktopBoxShellDropTarget {
    fn new(app_handle: tauri::AppHandle, box_id: String) -> Self {
        Self {
            app_handle,
            box_id,
            cursor_effect: Mutex::new(0),
        }
    }

    fn emit_drop_error(&self, message: impl Into<String>) {
        emit_box_event(
            &self.app_handle,
            &self.box_id,
            DESKTOP_BOX_DROP_ERROR_EVENT,
            message.into(),
        );
    }

    fn shell_id_list_format() -> u16 {
        use windows::core::w;
        use windows::Win32::System::DataExchange::RegisterClipboardFormatW;

        unsafe { RegisterClipboardFormatW(w!("Shell IDList Array")) as u16 }
    }

    fn data_format(format: u16) -> windows::Win32::System::Com::FORMATETC {
        use windows::Win32::System::Com::{DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL};

        FORMATETC {
            cfFormat: format,
            ptd: std::ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0 as u32,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
        }
    }

    fn supports_format(
        data_object: &windows::Win32::System::Com::IDataObject,
        format: u16,
    ) -> bool {
        unsafe { data_object.QueryGetData(&Self::data_format(format)).is_ok() }
    }

    fn choose_effect(allowed: u32, valid: bool) -> u32 {
        use windows::Win32::System::Ole::{
            DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE, DROPEFFECT_NONE,
        };

        if !valid {
            return DROPEFFECT_NONE.0;
        }
        [DROPEFFECT_MOVE.0, DROPEFFECT_COPY.0, DROPEFFECT_LINK.0]
            .into_iter()
            .find(|effect| allowed & effect != 0)
            .unwrap_or(DROPEFFECT_COPY.0)
    }

    unsafe fn collect_file_paths(
        data_object: &windows::Win32::System::Com::IDataObject,
    ) -> Result<Vec<String>, String> {
        use windows::Win32::System::Ole::{ReleaseStgMedium, CF_HDROP};
        use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

        let mut medium = data_object
            .GetData(&Self::data_format(CF_HDROP.0 as u16))
            .map_err(|error| format!("读取文件拖放数据失败: {}", error))?;
        let result = (|| {
            let hdrop = HDROP(medium.u.hGlobal.0 as isize);
            let count = DragQueryFileW(hdrop, u32::MAX, None);
            let mut paths = Vec::with_capacity(count as usize);
            for index in 0..count {
                let length = DragQueryFileW(hdrop, index, None) as usize;
                let mut buffer = vec![0u16; length + 1];
                DragQueryFileW(hdrop, index, Some(&mut buffer));
                paths.push(String::from_utf16_lossy(&buffer[..length]));
            }
            Ok(paths)
        })();
        ReleaseStgMedium(&mut medium);
        result
    }

    unsafe fn valid_pidl_in_buffer(data: *const u8, size: usize, offset: usize) -> bool {
        if offset >= size {
            return false;
        }
        let mut cursor = offset;
        loop {
            if cursor.saturating_add(2) > size {
                return false;
            }
            let item_size = std::ptr::read_unaligned(data.add(cursor).cast::<u16>()) as usize;
            if item_size == 0 {
                return true;
            }
            if item_size < 2 || cursor.saturating_add(item_size) > size {
                return false;
            }
            cursor += item_size;
        }
    }

    unsafe fn shell_item_display_name(
        item: &windows::Win32::UI::Shell::IShellItem,
        kind: windows::Win32::UI::Shell::SIGDN,
    ) -> Option<String> {
        use windows::Win32::System::Com::CoTaskMemFree;

        let value = item.GetDisplayName(kind).ok()?;
        let result = value.to_string().ok();
        CoTaskMemFree(Some(value.0.cast()));
        result.filter(|value| !value.trim().is_empty())
    }

    unsafe fn collect_shell_items(
        data_object: &windows::Win32::System::Com::IDataObject,
    ) -> Result<(Vec<String>, Vec<DesktopShellDropItem>), String> {
        use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
        use windows::Win32::System::Ole::ReleaseStgMedium;
        use windows::Win32::UI::Shell::{
            ILCombine, ILFree, IShellItem, SHCreateItemFromIDList, SIGDN_DESKTOPABSOLUTEPARSING,
            SIGDN_FILESYSPATH, SIGDN_NORMALDISPLAY,
        };

        let format = Self::shell_id_list_format();
        let mut medium = data_object
            .GetData(&Self::data_format(format))
            .map_err(|error| format!("读取系统图标拖放数据失败: {}", error))?;
        let hglobal = medium.u.hGlobal;
        let size = GlobalSize(hglobal);
        let data = GlobalLock(hglobal).cast::<u8>();
        let result = (|| {
            if data.is_null() || size < 8 {
                return Err("系统图标拖放数据为空。".to_string());
            }
            let count = std::ptr::read_unaligned(data.cast::<u32>()) as usize;
            let offsets_size = 4usize.saturating_mul(count.saturating_add(1));
            let header_size = 4usize.saturating_add(offsets_size);
            if count == 0 || count > 4096 || header_size > size {
                return Err("系统图标拖放数据结构无效。".to_string());
            }
            let offset_at = |index: usize| {
                std::ptr::read_unaligned(data.add(4 + index * 4).cast::<u32>()) as usize
            };
            let parent_offset = offset_at(0);
            if !Self::valid_pidl_in_buffer(data, size, parent_offset) {
                return Err("系统图标父级标识无效。".to_string());
            }

            let parent = data.add(parent_offset).cast();
            let mut paths = Vec::new();
            let mut shell_items = Vec::new();
            for index in 0..count {
                let child_offset = offset_at(index + 1);
                if !Self::valid_pidl_in_buffer(data, size, child_offset) {
                    continue;
                }
                let child = data.add(child_offset).cast();
                let absolute = ILCombine(Some(parent), Some(child));
                if absolute.is_null() {
                    continue;
                }
                let shell_item = SHCreateItemFromIDList::<IShellItem>(absolute);
                ILFree(Some(absolute));
                let Ok(shell_item) = shell_item else {
                    continue;
                };
                if let Some(path) = Self::shell_item_display_name(&shell_item, SIGDN_FILESYSPATH) {
                    paths.push(path);
                    continue;
                }
                let Some(shell_id) =
                    Self::shell_item_display_name(&shell_item, SIGDN_DESKTOPABSOLUTEPARSING)
                else {
                    continue;
                };
                let label = Self::shell_item_display_name(&shell_item, SIGDN_NORMALDISPLAY)
                    .unwrap_or_else(|| shell_id.clone());
                shell_items.push(DesktopShellDropItem { shell_id, label });
            }
            Ok((paths, shell_items))
        })();
        let _ = GlobalUnlock(hglobal);
        ReleaseStgMedium(&mut medium);
        result
    }

    fn accept_drop(
        &self,
        data_object: &windows::Win32::System::Com::IDataObject,
    ) -> Result<bool, String> {
        use windows::Win32::System::Ole::CF_HDROP;

        let mut file_drop_error = None;
        if Self::supports_format(data_object, CF_HDROP.0 as u16) {
            match unsafe { Self::collect_file_paths(data_object) } {
                Ok(paths) if !paths.is_empty() => {
                    // Preserve the existing Tauri file-drop contract for
                    // ordinary filesystem items. The frontend mutation queue
                    // remains the single owner of file-drop persistence; this
                    // native target only adds Shell namespace support when
                    // CF_HDROP is empty or unavailable.
                    use tauri::Manager;
                    let label = format!("{}{}", DESKTOP_BOX_LABEL_PREFIX, self.box_id);
                    let window = self
                        .app_handle
                        .get_window(&label)
                        .ok_or_else(|| "桌面盒子窗口不存在。".to_string())?;
                    window
                        .emit("tauri://file-drop", paths)
                        .map_err(|error| format!("发送文件拖放事件失败: {}", error))?;
                    return Ok(true);
                }
                Ok(_) => {}
                Err(error) => {
                    // Explorer may advertise CF_HDROP during DragEnter but
                    // reject the same FORMATETC during Drop for a virtual
                    // Shell item. That is a format fallback, not a fatal drop
                    // error: continue with Shell IDList Array below.
                    eprintln!(
                        "[DesktopBox] CF_HDROP unavailable at drop time; trying Shell IDList: {}",
                        error
                    );
                    file_drop_error = Some(error);
                }
            }
            // Explorer exposes CF_HDROP for some virtual desktop items, but
            // DragQueryFileW returns no paths for them. Fall through to the
            // Shell IDList Array parser instead of rejecting the drop.
        }
        let shell_format = Self::shell_id_list_format();
        if !Self::supports_format(data_object, shell_format) {
            return file_drop_error.map(Err).unwrap_or(Ok(false));
        }
        let (paths, shell_items) = unsafe { Self::collect_shell_items(data_object) }?;
        let mut accepted = false;
        let mut affected_box_ids = HashSet::new();
        let mut drop_notice = None;
        if !paths.is_empty() {
            let (view, affected) = assign_paths_to_box(&self.box_id, paths)?;
            if view
                .apply_message
                .as_deref()
                .is_some_and(|message| message.contains("失败"))
            {
                drop_notice = view.apply_message;
            }
            affected_box_ids.extend(affected);
            accepted = true;
        }
        if !shell_items.is_empty() {
            let (_, affected) = assign_shell_items_to_box(&self.box_id, shell_items)?;
            affected_box_ids.extend(affected);
            accepted = true;
        }
        if accepted {
            refresh_box_windows(&self.app_handle, &affected_box_ids);
            sync_desktop_box_icon_filter();
            if let Some(message) = drop_notice {
                self.emit_drop_error(message);
            }
        }
        Ok(accepted)
    }
}

#[cfg(windows)]
#[allow(non_snake_case)]
impl windows::Win32::System::Ole::IDropTarget_Impl for DesktopBoxShellDropTarget {
    fn DragEnter(
        &self,
        data_object: Option<&windows::Win32::System::Com::IDataObject>,
        _key_state: windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS,
        _point: &windows::Win32::Foundation::POINTL,
        effect: *mut windows::Win32::System::Ole::DROPEFFECT,
    ) -> windows::core::Result<()> {
        use windows::Win32::System::Ole::CF_HDROP;

        let allowed = unsafe { effect.as_ref().map(|effect| effect.0).unwrap_or(0) };
        let valid = data_object.is_some_and(|data_object| {
            Self::supports_format(data_object, CF_HDROP.0 as u16)
                || Self::supports_format(data_object, Self::shell_id_list_format())
        });
        let selected_effect = Self::choose_effect(allowed, valid);
        *self
            .cursor_effect
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = selected_effect;
        if let Some(effect) = unsafe { effect.as_mut() } {
            effect.0 = selected_effect;
        }
        Ok(())
    }

    fn DragOver(
        &self,
        _key_state: windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS,
        _point: &windows::Win32::Foundation::POINTL,
        effect: *mut windows::Win32::System::Ole::DROPEFFECT,
    ) -> windows::core::Result<()> {
        if let Some(effect) = unsafe { effect.as_mut() } {
            effect.0 = *self
                .cursor_effect
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
        Ok(())
    }

    fn DragLeave(&self) -> windows::core::Result<()> {
        *self
            .cursor_effect
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = 0;
        Ok(())
    }

    fn Drop(
        &self,
        data_object: Option<&windows::Win32::System::Com::IDataObject>,
        _key_state: windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS,
        _point: &windows::Win32::Foundation::POINTL,
        effect: *mut windows::Win32::System::Ole::DROPEFFECT,
    ) -> windows::core::Result<()> {
        let selected_effect = *self
            .cursor_effect
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let (accepted, drop_error) = match data_object {
            Some(data_object) => match self.accept_drop(data_object) {
                Ok(true) => (true, None),
                Ok(false) => (
                    false,
                    Some("无法加入该项目：Windows 未提供可识别的文件或系统图标数据。".to_string()),
                ),
                Err(error) => {
                    eprintln!("[DesktopBox] shell drop failed: {}", error);
                    (false, Some(format!("加入桌面盒子失败：{}", error)))
                }
            },
            None => (
                false,
                Some("无法加入该项目：Windows 未提供拖放数据。".to_string()),
            ),
        };
        if let Some(message) = drop_error {
            self.emit_drop_error(message);
        }
        if let Some(effect) = unsafe { effect.as_mut() } {
            effect.0 = if accepted { selected_effect } else { 0 };
        }
        Ok(())
    }
}

#[cfg(windows)]
fn box_target_at_point<'a>(
    targets: &'a [DesktopBoxWindowTarget],
    point: winapi::shared::windef::POINT,
    app_process_ids: &HashSet<u32>,
) -> Option<&'a DesktopBoxWindowTarget> {
    use winapi::um::winuser::{GetWindowThreadProcessId, IsChild, WindowFromPoint};

    let hit = unsafe { WindowFromPoint(point) };
    if hit.is_null() {
        return None;
    }
    if let Some(target) = targets.iter().find(|target| {
        let hwnd = target.hwnd as winapi::shared::windef::HWND;
        hit == hwnd || unsafe { IsChild(hwnd, hit) } != 0
    }) {
        return Some(target);
    }

    // Windowed WebView2 content can be visually attached to the Tauri HWND
    // while its cross-process HWND is absent from the GetParent chain. Only
    // use geometry after proving the hit belongs to this application's
    // WebView2 process tree, so a normal app covering the desktop cancels the
    // drop instead of targeting a hidden Box underneath it.
    let mut hit_process_id = 0;
    unsafe {
        GetWindowThreadProcessId(hit, &mut hit_process_id);
    }
    if !app_process_ids.contains(&hit_process_id) {
        return None;
    }
    targets
        .iter()
        .find(|target| target.rect.contains(point.x, point.y))
}

#[cfg(windows)]
fn descendant_process_ids(root_process_id: u32) -> HashSet<u32> {
    use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
    use winapi::um::tlhelp32::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return HashSet::from([root_process_id]);
    }
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut processes = Vec::new();
    if unsafe { Process32FirstW(snapshot, &mut entry) } != 0 {
        loop {
            processes.push((entry.th32ProcessID, entry.th32ParentProcessID));
            if unsafe { Process32NextW(snapshot, &mut entry) } == 0 {
                break;
            }
        }
    }
    unsafe {
        CloseHandle(snapshot);
    }

    collect_descendant_process_ids(root_process_id, &processes)
}

fn collect_descendant_process_ids(root_process_id: u32, processes: &[(u32, u32)]) -> HashSet<u32> {
    let mut result = HashSet::from([root_process_id]);
    loop {
        let mut changed = false;
        for (process_id, parent_process_id) in processes {
            if result.contains(parent_process_id) && result.insert(*process_id) {
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    result
}

#[cfg(windows)]
fn point_is_on_windows_desktop(point: winapi::shared::windef::POINT) -> bool {
    use winapi::um::winuser::{IsChild, WindowFromPoint};

    let Some(host) = windows_desktop_icons::desktop_shell_host() else {
        return false;
    };
    let host = host as winapi::shared::windef::HWND;
    let hit = unsafe { WindowFromPoint(point) };
    !hit.is_null() && (hit == host || unsafe { IsChild(host, hit) } != 0)
}

#[cfg(windows)]
fn start_box_icon_drag(
    app_handle: tauri::AppHandle,
    source_box_id: String,
    icon_id: String,
) -> Result<(), String> {
    use winapi::um::winuser::{GetAsyncKeyState, GetCursorPos, VK_LBUTTON};

    let targets = desktop_box_window_targets(&app_handle);
    if !targets.iter().any(|target| target.box_id == source_box_id) {
        return Err("桌面盒子窗口不存在。".to_string());
    }
    let app_process_ids = descendant_process_ids(targets[0].process_id);

    let drag_key = format!("{}\0{}", source_box_id, icon_id);
    {
        let mut active = BOX_ICON_DRAGS
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !active.insert(drag_key.clone()) {
            return Ok(());
        }
    }

    std::thread::spawn(move || {
        let mut final_point = winapi::shared::windef::POINT { x: 0, y: 0 };
        while unsafe { GetAsyncKeyState(VK_LBUTTON) } < 0 {
            let mut point = winapi::shared::windef::POINT { x: 0, y: 0 };
            if unsafe { GetCursorPos(&mut point) } == 0 {
                break;
            }
            final_point = point;
            std::thread::sleep(std::time::Duration::from_millis(12));
        }
        let _ = unsafe { GetCursorPos(&mut final_point) };

        let drop_target = box_target_at_point(&targets, final_point, &app_process_ids);
        let result = match drop_target {
            Some(target) => {
                request_box_icon_drop(&app_handle, target, &source_box_id, &icon_id, final_point)
                    .map(|_| None)
            }
            None if point_is_on_windows_desktop(final_point) => {
                remove_icon_from_box(&source_box_id, &icon_id).map(|_| Some(String::new()))
            }
            None => Ok(None),
        };

        match result {
            Ok(Some(target_box_id)) => {
                refresh_box_window(&app_handle, &source_box_id);
                if !target_box_id.is_empty() {
                    refresh_box_window(&app_handle, &target_box_id);
                }
                sync_desktop_box_icon_filter();
            }
            Ok(None) => {}
            Err(error) => {
                eprintln!("[DesktopBox] icon drag failed: {}", error);
            }
        }

        BOX_ICON_DRAGS
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&drag_key);
    });
    Ok(())
}

#[cfg(windows)]
fn request_box_icon_drop(
    app_handle: &tauri::AppHandle,
    target: &DesktopBoxWindowTarget,
    source_box_id: &str,
    icon_id: &str,
    point: winapi::shared::windef::POINT,
) -> Result<(), String> {
    use tauri::Manager;

    let scale_factor = box_scale_factor(&target.box_id).max(0.5) as f64;
    let payload = DesktopBoxIconDropRequest {
        source_box_id: source_box_id.to_string(),
        icon_id: icon_id.to_string(),
        client_x: (point.x - target.rect.left) as f64 / scale_factor,
        client_y: (point.y - target.rect.top) as f64 / scale_factor,
    };
    let window = app_handle
        .get_window(&target.label)
        .ok_or_else(|| "目标桌面盒子窗口不存在。".to_string())?;
    window
        .emit(DESKTOP_BOX_ICON_DROP_REQUEST_EVENT, payload)
        .map_err(|error| format!("发送图标放置请求失败: {}", error))
}

#[cfg(not(windows))]
fn start_box_icon_drag(
    _app_handle: tauri::AppHandle,
    _source_box_id: String,
    _icon_id: String,
) -> Result<(), String> {
    Err("桌面盒子拖放仅支持 Windows。".to_string())
}

fn find_box_position(
    fences: &[DesktopFence],
    preferred_x: i32,
    preferred_y: i32,
    width: i32,
    height: i32,
    work_area: Option<DesktopWorkArea>,
) -> (i32, i32) {
    let (preferred_x, preferred_y) = if let Some(area) = work_area {
        let max_x = area.right.saturating_sub(width).max(area.left);
        let max_y = area.bottom.saturating_sub(height).max(area.top);
        (
            preferred_x.clamp(area.left, max_x),
            preferred_y.clamp(area.top, max_y),
        )
    } else {
        (preferred_x, preferred_y)
    };

    let mut candidates = vec![(preferred_x, preferred_y)];
    if let Some(area) = work_area {
        let max_x = area.right.saturating_sub(width).max(area.left);
        let max_y = area.bottom.saturating_sub(height).max(area.top);
        let mut y = area.top;
        for _ in 0..256 {
            let mut x = area.left;
            for _ in 0..256 {
                candidates.push((x.min(max_x), y.min(max_y)));
                if x >= max_x {
                    break;
                }
                x = x.saturating_add(width + BOX_PLACEMENT_GAP).min(max_x);
            }
            if y >= max_y {
                break;
            }
            y = y.saturating_add(height + BOX_PLACEMENT_GAP).min(max_y);
        }
        candidates
            .sort_by_key(|(x, y)| x.abs_diff(preferred_x) as u64 + y.abs_diff(preferred_y) as u64);
    } else {
        for row in 0..32 {
            for column in 0..32 {
                if row == 0 && column == 0 {
                    continue;
                }
                candidates.push((
                    preferred_x.saturating_add(column * (width + BOX_PLACEMENT_GAP)),
                    preferred_y.saturating_add(row * (height + BOX_PLACEMENT_GAP)),
                ));
            }
        }
    }
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|position| seen.insert(*position))
        .find(|(x, y)| {
            !fences.iter().any(|fence| {
                rectangles_overlap(
                    *x,
                    *y,
                    width,
                    height,
                    fence.x,
                    fence.y,
                    fence.width,
                    fence.height,
                )
            })
        })
        .unwrap_or((preferred_x, preferred_y))
}

fn visible_box_position(fence: &DesktopFence) -> (i32, i32) {
    let Some(area) = desktop_work_area_at(
        fence.x.saturating_add(fence.width / 2),
        fence.y.saturating_add(fence.height / 2),
    ) else {
        return (fence.x, fence.y);
    };
    let max_x = area.right.saturating_sub(fence.width).max(area.left);
    let visible_height = if fence.collapsed {
        (COLLAPSED_BOX_HEIGHT as f32 * system_scale_factor()).round() as i32
    } else {
        fence.height
    };
    let max_y = area.bottom.saturating_sub(visible_height).max(area.top);
    (
        fence.x.clamp(area.left, max_x),
        fence.y.clamp(area.top, max_y),
    )
}

fn bounded_box_dimensions(fence: &DesktopFence) -> (i32, i32) {
    let Some(area) = desktop_work_area_at(
        fence.x.saturating_add(fence.width / 2),
        fence.y.saturating_add(fence.height / 2),
    ) else {
        return (fence.width.max(160), fence.height.max(120));
    };
    let area_width = area.right.saturating_sub(area.left).max(160);
    let area_height = area.bottom.saturating_sub(area.top).max(120);
    (
        fence.width.clamp(160, area_width),
        fence.height.clamp(120, area_height),
    )
}

fn rectangles_overlap(
    left_x: i32,
    left_y: i32,
    left_width: i32,
    left_height: i32,
    right_x: i32,
    right_y: i32,
    right_width: i32,
    right_height: i32,
) -> bool {
    left_x < right_x.saturating_add(right_width)
        && left_x.saturating_add(left_width) > right_x
        && left_y < right_y.saturating_add(right_height)
        && left_y.saturating_add(left_height) > right_y
}

fn update_box<F>(box_id: &str, updater: F) -> Result<DesktopBoxView, String>
where
    F: FnOnce(&mut DesktopFence),
{
    let _store_guard = lock_store();
    let mut store = read_store_unlocked()?;
    let now = Utc::now().to_rfc3339();
    for layout in &mut store.layouts {
        if let Some(fence) = layout.fences.iter_mut().find(|fence| fence.id == box_id) {
            updater(fence);
            layout.canvas_width = layout.canvas_width.max(fence.x + fence.width + 120);
            layout.canvas_height = layout.canvas_height.max(fence.y + fence.height + 120);
            layout.updated_at = now;
            let fence = fence.clone();
            let view = box_view(layout, &fence, None);
            write_store_unlocked(&normalize_store(store))?;
            return Ok(view);
        }
    }
    Err("桌面盒子不存在。".to_string())
}

fn update_box_geometry(
    box_id: &str,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<DesktopBoxView, String> {
    let _store_guard = lock_store();
    let mut store = read_store_unlocked()?;
    let now = Utc::now().to_rfc3339();
    for layout in &mut store.layouts {
        if let Some(fence) = layout.fences.iter_mut().find(|fence| fence.id == box_id) {
            let previous_geometry = (fence.x, fence.y, fence.width, fence.height);
            fence.x = x;
            fence.y = y;
            fence.width = width.max(160);
            if !fence.collapsed {
                fence.height = height.max(120);
            }
            if previous_geometry == (fence.x, fence.y, fence.width, fence.height) {
                let unchanged_fence = fence.clone();
                return Ok(box_view(layout, &unchanged_fence, None));
            }
            layout.canvas_width = layout
                .canvas_width
                .max(fence.x.saturating_add(fence.width).saturating_add(120));
            layout.canvas_height = layout
                .canvas_height
                .max(fence.y.saturating_add(fence.height).saturating_add(120));
            layout.updated_at = now;
            let fence = fence.clone();
            let layout_clone = layout.clone();
            let view = box_view(layout, &fence, None);
            write_geometry_store_unlocked(&normalize_store(store))?;
            let apply_message = match apply_layout(&layout_clone) {
                Ok(result) => Some(result.message),
                Err(error) => Some(format!("已保存盒子位置，但移动桌面图标失败: {}", error)),
            };
            return Ok(DesktopBoxView {
                apply_message,
                ..view
            });
        }
    }
    Err("桌面盒子不存在。".to_string())
}

fn delete_box(box_id: &str) -> Result<(), String> {
    let _store_guard = lock_store();
    let store = read_store_unlocked()?;
    let mut found = false;
    let mut icon_count = 0usize;
    for layout in &store.layouts {
        if layout.fences.iter().any(|fence| fence.id == box_id) {
            found = true;
            icon_count = layout
                .icon_assignments
                .iter()
                .filter(|assignment| assignment.fence_id == box_id)
                .count();
            break;
        }
    }
    if !found {
        return Err("桌面盒子不存在。".to_string());
    }
    if icon_count > 0 {
        return Err("盒子非空，请先移出图标。".to_string());
    }

    let mut removed = false;
    let mut next_store = store.clone();
    for layout in &mut next_store.layouts {
        let before = layout.fences.len();
        layout.fences.retain(|fence| fence.id != box_id);
        if layout.fences.len() != before {
            removed = true;
            layout
                .icon_assignments
                .retain(|assignment| assignment.fence_id != box_id);
            layout.updated_at = Utc::now().to_rfc3339();
        }
    }
    if !removed {
        return Err("桌面盒子不存在。".to_string());
    }

    write_store_unlocked(&normalize_store(next_store))?;

    remove_box_runtime_state(box_id);
    if let Ok(box_dir) = desktop_box_files_dir(box_id) {
        if box_dir.exists() {
            // Legacy managed files may leave unrelated metadata behind. Do
            // not fail a successful Box deletion just because cleanup is
            // unable to remove an otherwise harmless empty directory.
            if let Err(error) = fs::remove_dir(&box_dir) {
                eprintln!("[DesktopBox] legacy directory cleanup failed: {}", error);
            }
        }
    }
    Ok(())
}

fn remove_icon_from_box(box_id: &str, icon_id: &str) -> Result<DesktopBoxView, String> {
    let _store_guard = lock_store();
    let mut store = read_store_unlocked()?;
    let normalized_icon_id = normalize_path_key(icon_id);
    let mut removed_assignment = None;
    let mut target_layout_index = None;

    for (layout_index, layout) in store.layouts.iter_mut().enumerate() {
        if !layout.fences.iter().any(|fence| fence.id == box_id) {
            continue;
        }
        target_layout_index = Some(layout_index);
        if let Some(index) = layout.icon_assignments.iter().position(|assignment| {
            assignment.fence_id == box_id
                && (assignment.icon_id == icon_id
                    || normalize_path_key(&assignment.icon_id) == normalized_icon_id)
        }) {
            removed_assignment = Some(layout.icon_assignments.remove(index));
        }
        break;
    }

    let layout_index = target_layout_index.ok_or_else(|| "桌面盒子不存在。".to_string())?;
    removed_assignment.ok_or_else(|| "桌面盒子中不存在这个图标。".to_string())?;
    let layout = &mut store.layouts[layout_index];
    normalize_box_icon_orders(layout, box_id);
    layout.updated_at = Utc::now().to_rfc3339();
    let fence = layout
        .fences
        .iter()
        .find(|fence| fence.id == box_id)
        .cloned()
        .ok_or_else(|| "桌面盒子不存在。".to_string())?;
    let view = box_view(layout, &fence, None);

    write_store_unlocked(&normalize_store(store))?;
    Ok(DesktopBoxView {
        apply_message: Some("已移出".to_string()),
        ..view
    })
}

/// Removes an assignment whose backing desktop item no longer exists. This
/// deliberately differs from `remove_icon_from_box`: the latter restores a
/// managed desktop file, while this only clears a stale BOX record.
fn remove_invalid_icon_record(box_id: &str, icon_id: &str) -> Result<DesktopBoxView, String> {
    let _store_guard = lock_store();
    let mut store = read_store_unlocked()?;
    let normalized_icon_id = normalize_path_key(icon_id);
    let layout_index = store
        .layouts
        .iter()
        .position(|layout| layout.fences.iter().any(|fence| fence.id == box_id))
        .ok_or_else(|| "桌面盒子不存在。".to_string())?;
    let layout = &mut store.layouts[layout_index];
    let assignment_index = layout
        .icon_assignments
        .iter()
        .position(|assignment| {
            assignment.fence_id == box_id
                && (assignment.icon_id == icon_id
                    || normalize_path_key(&assignment.icon_id) == normalized_icon_id)
        })
        .ok_or_else(|| "桌面盒子中不存在这个图标。".to_string())?;

    if desktop_box_item_issue(&layout.icon_assignments[assignment_index]).is_none() {
        return Err("该桌面项目仍然有效，不能作为失效快捷方式删除。".to_string());
    }

    layout.icon_assignments.remove(assignment_index);
    normalize_box_icon_orders(layout, box_id);
    layout.updated_at = Utc::now().to_rfc3339();
    let fence = layout
        .fences
        .iter()
        .find(|fence| fence.id == box_id)
        .cloned()
        .ok_or_else(|| "桌面盒子不存在。".to_string())?;
    let view = box_view(layout, &fence, Some("已删除失效快捷方式".to_string()));
    write_store_unlocked(&normalize_store(store))?;
    Ok(view)
}

fn move_icon_assignment(
    layout: &mut DesktopLayout,
    source_box_id: &str,
    target_box_id: &str,
    icon_id: &str,
    target_index: usize,
) -> Result<(), String> {
    if !layout.fences.iter().any(|fence| fence.id == target_box_id) {
        return Err("目标盒子不存在。".to_string());
    }
    let normalized_icon_id = normalize_path_key(icon_id);
    let assignment_index = layout
        .icon_assignments
        .iter()
        .position(|assignment| {
            assignment.fence_id == source_box_id
                && (assignment.icon_id == icon_id
                    || normalize_path_key(&assignment.icon_id) == normalized_icon_id)
        })
        .ok_or_else(|| "桌面盒子中不存在这个图标。".to_string())?;
    let source_visual_index = sorted_box_assignment_indices(layout, source_box_id)
        .iter()
        .position(|index| *index == assignment_index)
        .unwrap_or(0);
    let mut assignment = layout.icon_assignments.remove(assignment_index);
    let assignment_path_key = assignment
        .path
        .as_deref()
        .map(normalize_path_key)
        .unwrap_or_default();
    let assignment_original_key = assignment
        .original_path
        .as_deref()
        .map(normalize_path_key)
        .unwrap_or_default();
    let assignment_shell_key = assignment
        .shell_id
        .as_deref()
        .map(normalize_shell_key)
        .unwrap_or_default();
    if layout.icon_assignments.iter().any(|candidate| {
        candidate.fence_id == target_box_id
            && (candidate.icon_id == assignment.icon_id
                || (!assignment_path_key.is_empty()
                    && candidate
                        .path
                        .as_deref()
                        .is_some_and(|path| normalize_path_key(path) == assignment_path_key))
                || (!assignment_original_key.is_empty()
                    && candidate
                        .original_path
                        .as_deref()
                        .is_some_and(|path| normalize_path_key(path) == assignment_original_key))
                || (!assignment_shell_key.is_empty()
                    && candidate.shell_id.as_deref().is_some_and(|shell_id| {
                        normalize_shell_key(shell_id) == assignment_shell_key
                    })))
    }) {
        layout.icon_assignments.insert(assignment_index, assignment);
        return Err("目标盒子中已有这个图标。".to_string());
    }

    if source_box_id != target_box_id {
        normalize_box_icon_orders(layout, source_box_id);
    }
    let mut insertion_index = target_index;
    if source_box_id == target_box_id && source_visual_index < insertion_index {
        insertion_index = insertion_index.saturating_sub(1);
    }
    let target_indices = sorted_box_assignment_indices(layout, target_box_id);
    insertion_index = insertion_index.min(target_indices.len());
    for (visual_index, assignment_index) in target_indices.into_iter().enumerate() {
        layout.icon_assignments[assignment_index].order = if visual_index >= insertion_index {
            visual_index as i32 + 1
        } else {
            visual_index as i32
        };
    }

    assignment.fence_id = target_box_id.to_string();
    assignment.order = insertion_index as i32;
    assignment.offset_x = None;
    assignment.offset_y = None;
    assignment.native_index = None;
    layout.icon_assignments.push(assignment);
    set_box_sort_mode_in_layout(layout, target_box_id, DesktopBoxSortMode::Manual)?;
    normalize_box_icon_orders(layout, target_box_id);
    layout.updated_at = Utc::now().to_rfc3339();
    Ok(())
}

fn sorted_box_assignment_indices(layout: &DesktopLayout, box_id: &str) -> Vec<usize> {
    let mut indices = layout
        .icon_assignments
        .iter()
        .enumerate()
        .filter_map(|(index, assignment)| (assignment.fence_id == box_id).then_some(index))
        .collect::<Vec<_>>();
    indices.sort_by_key(|index| {
        let assignment = &layout.icon_assignments[*index];
        (assignment.order, assignment.label.clone())
    });
    indices
}

fn normalize_box_icon_orders(layout: &mut DesktopLayout, box_id: &str) {
    for (order, assignment_index) in sorted_box_assignment_indices(layout, box_id)
        .into_iter()
        .enumerate()
    {
        layout.icon_assignments[assignment_index].order = order as i32;
    }
}

fn set_box_icon_sort_mode(
    box_id: &str,
    mode: DesktopBoxSortMode,
) -> Result<DesktopBoxView, String> {
    let _store_guard = lock_store();
    let mut store = read_store_unlocked()?;
    let layout_index = store
        .layouts
        .iter()
        .position(|layout| layout.fences.iter().any(|fence| fence.id == box_id))
        .ok_or_else(|| "桌面盒子不存在。".to_string())?;
    let layout = &mut store.layouts[layout_index];
    set_box_sort_mode_in_layout(layout, box_id, mode)?;
    sort_box_icon_assignments(layout, box_id, mode);
    layout.updated_at = Utc::now().to_rfc3339();
    let fence = layout
        .fences
        .iter()
        .find(|fence| fence.id == box_id)
        .cloned()
        .ok_or_else(|| "桌面盒子不存在。".to_string())?;
    let view = box_view(layout, &fence, None);
    write_store_unlocked(&normalize_store(store))?;
    Ok(view)
}

fn set_box_sort_mode_in_layout(
    layout: &mut DesktopLayout,
    box_id: &str,
    mode: DesktopBoxSortMode,
) -> Result<(), String> {
    let fence = layout
        .fences
        .iter_mut()
        .find(|fence| fence.id == box_id)
        .ok_or_else(|| "桌面盒子不存在。".to_string())?;
    fence.sort_mode = mode.as_str().to_string();
    Ok(())
}

fn sort_box_icon_assignments(layout: &mut DesktopLayout, box_id: &str, mode: DesktopBoxSortMode) {
    if mode == DesktopBoxSortMode::Manual {
        normalize_box_icon_orders(layout, box_id);
        return;
    }
    let mut indices = layout
        .icon_assignments
        .iter()
        .enumerate()
        .filter_map(|(index, assignment)| (assignment.fence_id == box_id).then_some(index))
        .collect::<Vec<_>>();
    indices.sort_by(|left_index, right_index| {
        compare_box_icon_assignments(
            &layout.icon_assignments[*left_index],
            &layout.icon_assignments[*right_index],
            mode,
        )
    });
    for (order, index) in indices.into_iter().enumerate() {
        layout.icon_assignments[index].order = order as i32;
    }
}

fn compare_box_icon_assignments(
    left: &DesktopIconAssignment,
    right: &DesktopIconAssignment,
    mode: DesktopBoxSortMode,
) -> std::cmp::Ordering {
    use std::cmp::Ordering;

    let name_order = compare_box_icon_names(&left.label, &right.label)
        .then_with(|| compare_box_icon_names(&left.icon_id, &right.icon_id));
    let order = match mode {
        DesktopBoxSortMode::NameAscending => name_order,
        DesktopBoxSortMode::NameDescending => name_order.reverse(),
        DesktopBoxSortMode::ModifiedNewest => compare_modified_time(
            assignment_modified_time(left),
            assignment_modified_time(right),
            true,
        ),
        DesktopBoxSortMode::ModifiedOldest => compare_modified_time(
            assignment_modified_time(left),
            assignment_modified_time(right),
            false,
        ),
        DesktopBoxSortMode::TypeAscending => assignment_file_type(left)
            .cmp(&assignment_file_type(right))
            .then(name_order),
        DesktopBoxSortMode::TypeDescending => assignment_file_type(right)
            .cmp(&assignment_file_type(left))
            .then(name_order),
        DesktopBoxSortMode::Manual => Ordering::Equal,
    };
    order
        .then(name_order)
        .then_with(|| left.order.cmp(&right.order))
}

fn assignment_modified_time(assignment: &DesktopIconAssignment) -> Option<SystemTime> {
    assignment
        .path
        .as_deref()
        .or(assignment.original_path.as_deref())
        .and_then(|path| fs::metadata(path).ok())
        .and_then(|metadata| metadata.modified().ok())
}

fn compare_modified_time(
    left: Option<SystemTime>,
    right: Option<SystemTime>,
    newest_first: bool,
) -> std::cmp::Ordering {
    match (left, right) {
        (Some(left), Some(right)) if newest_first => right.cmp(&left),
        (Some(left), Some(right)) => left.cmp(&right),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    }
}

fn assignment_file_type(assignment: &DesktopIconAssignment) -> String {
    assignment
        .path
        .as_deref()
        .or(assignment.original_path.as_deref())
        .and_then(|path| Path::new(path).extension())
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .unwrap_or_else(|| "~system".to_string())
}

#[cfg(windows)]
fn compare_box_icon_names(left: &str, right: &str) -> std::cmp::Ordering {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::StrCmpLogicalW;

    let left = left
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let right = right
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe { StrCmpLogicalW(PCWSTR(left.as_ptr()), PCWSTR(right.as_ptr())).cmp(&0) }
}

#[cfg(not(windows))]
fn compare_box_icon_names(left: &str, right: &str) -> std::cmp::Ordering {
    left.to_lowercase().cmp(&right.to_lowercase())
}

fn place_icon_between_boxes(
    source_box_id: &str,
    target_box_id: &str,
    icon_id: &str,
    target_index: usize,
) -> Result<DesktopBoxView, String> {
    let _store_guard = lock_store();
    let store = read_store_unlocked()?;
    let layout_index = store
        .layouts
        .iter()
        .position(|layout| {
            layout.fences.iter().any(|fence| fence.id == source_box_id)
                && layout.fences.iter().any(|fence| fence.id == target_box_id)
        })
        .ok_or_else(|| "目标盒子不存在。".to_string())?;
    let mut next_store = store.clone();
    move_icon_assignment(
        &mut next_store.layouts[layout_index],
        source_box_id,
        target_box_id,
        icon_id,
        target_index,
    )?;
    let normalized_store = normalize_store(next_store);
    let target_layout = &normalized_store.layouts[layout_index];
    let target_fence = target_layout
        .fences
        .iter()
        .find(|fence| fence.id == target_box_id)
        .ok_or_else(|| "目标盒子不存在。".to_string())?;
    let target_view = box_view(target_layout, target_fence, None);
    write_store_unlocked(&normalized_store)?;
    Ok(target_view)
}

#[allow(dead_code)]
fn move_icon_between_boxes(
    source_box_id: &str,
    target_box_id: &str,
    icon_id: &str,
) -> Result<(), String> {
    place_icon_between_boxes(source_box_id, target_box_id, icon_id, usize::MAX).map(|_| ())
}

fn remove_box_runtime_state(box_id: &str) {
    if let Some(requests) = BOX_FOCUS_REQUESTS.get() {
        requests
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(box_id);
    }
    if let Some(scale_factors) = BOX_SCALE_FACTORS.get() {
        scale_factors
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(box_id);
    }
}

fn rollback_managed_file_moves(moves: &[(PathBuf, PathBuf)]) {
    for (source, destination) in moves.iter().rev() {
        if destination.exists() && !source.exists() {
            let _ = fs::rename(destination, source);
        }
    }
}

fn assign_paths_to_box(
    box_id: &str,
    paths: Vec<String>,
) -> Result<(DesktopBoxView, HashSet<String>), String> {
    let mut seen_paths = HashSet::new();
    let clean_paths = paths
        .into_iter()
        .map(|path| normalize_dropped_path(&path))
        .filter(|path| !path.trim().is_empty())
        .filter(|path| seen_paths.insert(normalize_path_key(path)))
        .collect::<Vec<_>>();
    if clean_paths.is_empty() {
        let view = find_box(box_id)?.ok_or_else(|| "桌面盒子不存在。".to_string())?;
        return Ok((view, HashSet::from([box_id.to_string()])));
    }

    // A BOX is a desktop grouping, not a file container. Keep the original
    // item where Explorer owns it and persist only a stable reference.
    assign_paths_to_box_references(box_id, clean_paths)
}

#[cfg(windows)]
fn assign_shell_items_to_box(
    box_id: &str,
    items: Vec<DesktopShellDropItem>,
) -> Result<(DesktopBoxView, HashSet<String>), String> {
    let mut seen_shell_ids = HashSet::new();
    let items = items
        .into_iter()
        .filter_map(|item| {
            let shell_id = item.shell_id.trim().to_string();
            if shell_id.is_empty() || !seen_shell_ids.insert(normalize_shell_key(&shell_id)) {
                return None;
            }
            Some(DesktopShellDropItem {
                label: if item.label.trim().is_empty() {
                    shell_id.clone()
                } else {
                    item.label.trim().to_string()
                },
                shell_id,
            })
        })
        .collect::<Vec<_>>();
    if items.is_empty() {
        let view = find_box(box_id)?.ok_or_else(|| "桌面盒子不存在。".to_string())?;
        return Ok((view, HashSet::from([box_id.to_string()])));
    }

    let _store_guard = lock_store();
    let mut store = read_store_unlocked()?;
    let layout_index = store
        .layouts
        .iter()
        .position(|layout| layout.fences.iter().any(|fence| fence.id == box_id))
        .ok_or_else(|| "桌面盒子不存在。".to_string())?;
    let layout = &mut store.layouts[layout_index];
    let fence = layout
        .fences
        .iter()
        .find(|fence| fence.id == box_id)
        .cloned()
        .ok_or_else(|| "桌面盒子不存在。".to_string())?;
    let incoming_keys = items
        .iter()
        .map(|item| normalize_shell_key(&item.shell_id))
        .collect::<HashSet<_>>();
    let mut affected_box_ids = layout
        .icon_assignments
        .iter()
        .filter(|assignment| {
            assignment
                .shell_id
                .as_deref()
                .is_some_and(|shell_id| incoming_keys.contains(&normalize_shell_key(shell_id)))
        })
        .map(|assignment| assignment.fence_id.clone())
        .collect::<HashSet<_>>();
    layout.icon_assignments.retain(|assignment| {
        !assignment
            .shell_id
            .as_deref()
            .is_some_and(|shell_id| incoming_keys.contains(&normalize_shell_key(shell_id)))
    });
    for touched_box in affected_box_ids.clone() {
        normalize_box_icon_orders(layout, &touched_box);
    }
    affected_box_ids.insert(box_id.to_string());

    let mut next_order = sorted_box_assignment_indices(layout, box_id).len() as i32;
    for item in items {
        layout.icon_assignments.push(DesktopIconAssignment {
            icon_id: format!("shell:{}", item.shell_id),
            label: item.label,
            path: None,
            shell_id: Some(item.shell_id),
            fence_id: box_id.to_string(),
            order: next_order,
            offset_x: None,
            offset_y: None,
            native_index: None,
            original_path: None,
            managed_file: false,
        });
        next_order += 1;
    }
    let sort_mode =
        DesktopBoxSortMode::parse(&fence.sort_mode).unwrap_or(DesktopBoxSortMode::Manual);
    sort_box_icon_assignments(layout, box_id, sort_mode);
    layout.updated_at = Utc::now().to_rfc3339();
    let view = box_view(layout, &fence, None);
    write_store_unlocked(&normalize_store(store))?;
    Ok((view, affected_box_ids))
}

fn assign_paths_to_box_references(
    box_id: &str,
    paths: Vec<String>,
) -> Result<(DesktopBoxView, HashSet<String>), String> {
    let _store_guard = lock_store();
    let mut store = read_store_unlocked()?;
    let mut target_layout_index = None;
    for (layout_index, layout) in store.layouts.iter().enumerate() {
        if layout.fences.iter().any(|fence| fence.id == box_id) {
            target_layout_index = Some(layout_index);
            break;
        }
    }
    let layout_index = target_layout_index.ok_or_else(|| "桌面盒子不存在。".to_string())?;

    let mut accepted_items: Vec<(String, String)> = Vec::new();
    let mut failed_items = Vec::new();
    for path in paths {
        let dropped_path = PathBuf::from(&path);
        // Desktop managers can expose a .lnk target instead of its shortcut
        // path. Resolve that target to the unique real desktop shortcut when
        // possible, then retain that real path as the BOX reference.
        let source = resolve_desktop_source_path(&dropped_path).unwrap_or(dropped_path);
        if !source.exists() {
            failed_items.push(format!("{} 不存在", label_from_path(&path)));
            continue;
        }
        let source_path = strip_windows_extended_path_prefix(&source.to_string_lossy());
        accepted_items.push((source_path.clone(), label_from_path(&source_path)));
    }

    let (view, accepted_count, affected_box_ids) = {
        let layout = &mut store.layouts[layout_index];
        let fence = layout
            .fences
            .iter()
            .find(|fence| fence.id == box_id)
            .cloned()
            .ok_or_else(|| "桌面盒子不存在。".to_string())?;
        let moved_keys = accepted_items
            .iter()
            .map(|(path, _)| normalize_path_key(path))
            .collect::<HashSet<_>>();
        let affected_box_ids = box_ids_affected_by_path_assignment(layout, box_id, &moved_keys);
        layout
            .icon_assignments
            .retain(|assignment| !assignment_matches_path_keys(assignment, &moved_keys));
        let mut next_order = layout
            .icon_assignments
            .iter()
            .filter(|assignment| assignment.fence_id == box_id)
            .map(|assignment| assignment.order)
            .max()
            .unwrap_or(-1)
            + 1;

        for (path, label) in &accepted_items {
            layout.icon_assignments.push(DesktopIconAssignment {
                icon_id: path.clone(),
                label: label.clone(),
                path: Some(path.clone()),
                shell_id: None,
                fence_id: box_id.to_string(),
                order: next_order,
                offset_x: None,
                offset_y: None,
                native_index: None,
                original_path: None,
                managed_file: false,
            });
            next_order += 1;
        }

        let sort_mode =
            DesktopBoxSortMode::parse(&fence.sort_mode).unwrap_or(DesktopBoxSortMode::Manual);
        sort_box_icon_assignments(layout, box_id, sort_mode);

        layout.updated_at = Utc::now().to_rfc3339();
        let accepted_count = accepted_items.len();
        let view = box_view(layout, &fence, None);
        (view, accepted_count, affected_box_ids)
    };

    write_store_unlocked(&normalize_store(store))?;
    let message = if failed_items.is_empty() {
        format!("已加入 {} 个项目", accepted_count)
    } else {
        format!(
            "已加入 {} 个，{} 个失败",
            accepted_count,
            failed_items.len()
        )
    };
    Ok((
        DesktopBoxView {
            apply_message: Some(message),
            ..view
        },
        affected_box_ids,
    ))
}

fn box_ids_affected_by_path_assignment(
    layout: &DesktopLayout,
    target_box_id: &str,
    path_keys: &HashSet<String>,
) -> HashSet<String> {
    let mut box_ids = layout
        .icon_assignments
        .iter()
        .filter(|assignment| assignment_matches_path_keys(assignment, path_keys))
        .map(|assignment| assignment.fence_id.clone())
        .collect::<HashSet<_>>();
    box_ids.insert(target_box_id.to_string());
    box_ids
}

fn assignment_matches_path_keys(
    assignment: &DesktopIconAssignment,
    path_keys: &HashSet<String>,
) -> bool {
    let path_key = assignment
        .path
        .as_deref()
        .map(normalize_path_key)
        .unwrap_or_default();
    let original_key = assignment
        .original_path
        .as_deref()
        .map(normalize_path_key)
        .unwrap_or_default();
    path_keys.contains(&path_key) || path_keys.contains(&original_key)
}

fn is_desktop_item(path: &Path) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    let parent_key = normalize_path_key(&parent.to_string_lossy());
    let mut desktop_dirs = Vec::new();
    if let Some(desktop) = dirs::desktop_dir() {
        desktop_dirs.push(desktop);
    }
    if let Ok(public) = std::env::var("PUBLIC") {
        desktop_dirs.push(PathBuf::from(public).join("Desktop"));
    }
    desktop_dirs
        .iter()
        .any(|desktop| normalize_path_key(&desktop.to_string_lossy()) == parent_key)
}

fn resolve_desktop_source_path(path: &Path) -> Option<PathBuf> {
    if is_desktop_item(path) {
        return Some(path.to_path_buf());
    }

    let key = normalize_path_key(&path.to_string_lossy());
    if key.is_empty() {
        return None;
    }
    let desktop_dir = dirs::desktop_dir();
    let public_desktop_dir = std::env::var("PUBLIC")
        .ok()
        .map(|public| PathBuf::from(public).join("Desktop"))
        .filter(|path| path.is_dir());
    let entries = collect_desktop_files(desktop_dir.as_deref(), public_desktop_dir.as_deref());
    let mut matches = entries
        .into_iter()
        .filter(|entry| {
            entry
                .alias_paths
                .iter()
                .any(|alias| normalize_path_key(alias) == key)
        })
        .map(|entry| PathBuf::from(entry.path))
        .collect::<Vec<_>>();
    matches.sort_by_key(|candidate| normalize_path_key(&candidate.to_string_lossy()));
    matches.dedup_by(|left, right| {
        normalize_path_key(&left.to_string_lossy()) == normalize_path_key(&right.to_string_lossy())
    });
    (matches.len() == 1).then(|| matches.remove(0))
}

#[cfg(windows)]
fn notify_desktop_path_move(source: &Path, destination: &Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::Shell::{
        SHChangeNotify, SHCNE_RENAMEITEM, SHCNE_UPDATEDIR, SHCNF_PATHW,
    };

    let source_wide = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination_wide = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    unsafe {
        SHChangeNotify(
            SHCNE_RENAMEITEM,
            SHCNF_PATHW,
            Some(source_wide.as_ptr() as *const core::ffi::c_void),
            Some(destination_wide.as_ptr() as *const core::ffi::c_void),
        );
    }

    for parent in [source.parent(), destination.parent()]
        .into_iter()
        .flatten()
    {
        let parent_wide = parent
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        unsafe {
            SHChangeNotify(
                SHCNE_UPDATEDIR,
                SHCNF_PATHW,
                Some(parent_wide.as_ptr() as *const core::ffi::c_void),
                None,
            );
        }
    }
}

#[cfg(not(windows))]
fn notify_desktop_path_move(_source: &Path, _destination: &Path) {}

fn recover_legacy_managed_desktop_assignments(
    store: &mut DesktopLayoutStore,
) -> ManagedFileRecovery {
    let mut recovery = ManagedFileRecovery::default();
    for layout in &mut store.layouts {
        let mut layout_changed = false;
        for assignment in &mut layout.icon_assignments {
            if !assignment.managed_file {
                continue;
            }

            match restore_managed_file(assignment) {
                Ok(Some((source, destination))) => {
                    let restored_path =
                        strip_windows_extended_path_prefix(&destination.to_string_lossy());
                    assignment.path = Some(restored_path.clone());
                    assignment.icon_id = restored_path;
                    assignment.original_path = None;
                    assignment.managed_file = false;
                    assignment.native_index = None;
                    assignment.offset_x = None;
                    assignment.offset_y = None;
                    recovery.moved_files.push((source, destination));
                    recovery.restored_count += 1;
                    layout_changed = true;
                }
                // A missing legacy storage file remains an explicitly broken
                // record. It can be removed through the invalid-item flow; we
                // must not invent a replacement desktop path.
                Ok(None) => {}
                Err(error) if recovery.first_error.is_none() => {
                    recovery.first_error = Some(error);
                }
                Err(_) => {}
            }
        }
        if layout_changed {
            layout.updated_at = Utc::now().to_rfc3339();
            recovery.changed = true;
        }
    }
    recovery
}

fn desktop_box_files_dir(box_id: &str) -> Result<PathBuf, String> {
    let safe_id = box_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-')
        .collect::<String>();
    if safe_id.is_empty() {
        return Err("桌面盒子 ID 无效。".to_string());
    }
    Storage::get_config_dir()
        .map(|dir| dir.join(DESKTOP_BOX_FILES_DIR).join(safe_id))
        .map_err(|e| e.to_string())
}

fn unique_destination_from_candidate(candidate: &Path) -> Result<PathBuf, String> {
    if !candidate.exists() {
        return Ok(candidate.to_path_buf());
    }
    let parent = candidate
        .parent()
        .ok_or_else(|| "无法生成目标路径。".to_string())?;
    let stem = candidate
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("桌面项目");
    let extension = candidate.extension().and_then(|value| value.to_str());
    for index in 1..10_000 {
        let file_name = match extension {
            Some(extension) if !extension.is_empty() => {
                format!("{} ({}).{}", stem, index, extension)
            }
            _ => format!("{} ({})", stem, index),
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("无法生成不重复的 Box 文件名。".to_string())
}

fn restore_managed_file(
    assignment: &DesktopIconAssignment,
) -> Result<Option<(PathBuf, PathBuf)>, String> {
    if !assignment.managed_file {
        return Ok(None);
    }
    let Some(current_path) = assignment.path.as_deref() else {
        return Ok(None);
    };
    let source = PathBuf::from(current_path);
    if !source.exists() {
        return Ok(None);
    }
    let destination = assignment
        .original_path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            dirs::desktop_dir()
                .and_then(|desktop| source.file_name().map(|file_name| desktop.join(file_name)))
        })
        .ok_or_else(|| "无法确定桌面项目还原位置。".to_string())?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建还原目录失败: {}", e))?;
    }
    let destination = if destination.exists()
        && normalize_path_key(&destination.to_string_lossy())
            != normalize_path_key(&source.to_string_lossy())
    {
        unique_destination_from_candidate(&destination)?
    } else {
        destination
    };
    if normalize_path_key(&source.to_string_lossy())
        == normalize_path_key(&destination.to_string_lossy())
    {
        return Ok(None);
    }

    match fs::rename(&source, &destination) {
        Ok(()) => Ok(Some((source, destination))),
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            let user_desktop =
                dirs::desktop_dir().ok_or_else(|| format!("还原 Box 文件失败: {}", error))?;
            fs::create_dir_all(&user_desktop).map_err(|fallback_error| {
                format!("创建当前用户桌面目录失败: {}", fallback_error)
            })?;
            let file_name = source
                .file_name()
                .ok_or_else(|| "无法确定要还原的桌面项目名称。".to_string())?;
            let fallback = unique_destination_from_candidate(&user_desktop.join(file_name))?;
            if normalize_path_key(&fallback.to_string_lossy())
                == normalize_path_key(&destination.to_string_lossy())
            {
                return Err(format!("还原 Box 文件失败: {}", error));
            }
            fs::rename(&source, &fallback).map_err(|fallback_error| {
                format!(
                    "原桌面位置无写入权限，恢复到当前用户桌面也失败: {}",
                    fallback_error
                )
            })?;
            Ok(Some((source, fallback)))
        }
        Err(error) => Err(format!("还原 Box 文件失败: {}", error)),
    }
}

fn box_view(
    layout: &DesktopLayout,
    fence: &DesktopFence,
    apply_message: Option<String>,
) -> DesktopBoxView {
    let mut icons = layout
        .icon_assignments
        .iter()
        .filter(|assignment| assignment.fence_id == fence.id)
        .cloned()
        .collect::<Vec<_>>();
    icons.sort_by_key(|item| (item.order, item.label.clone()));
    DesktopBoxView {
        layout_id: layout.id.clone(),
        fence: fence.clone(),
        icons,
        apply_message,
    }
}

fn normalize_box_background(value: &str) -> Option<String> {
    let value = value.trim();
    let hex = value.strip_prefix('#').unwrap_or(value);
    if (hex.len() != 6 && hex.len() != 8) || !hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("#{}", hex.to_ascii_uppercase()))
}

fn normalize_dropped_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let normalized = fs::canonicalize(trimmed)
        .unwrap_or_else(|_| PathBuf::from(trimmed))
        .to_string_lossy()
        .to_string();
    strip_windows_extended_path_prefix(&normalized)
}

fn normalize_path_key(path: &str) -> String {
    strip_windows_extended_path_prefix(path)
        .replace('/', "\\")
        .to_ascii_lowercase()
}

fn normalize_shell_key(shell_id: &str) -> String {
    shell_id.trim().to_ascii_lowercase()
}

fn desktop_box_item_issue(assignment: &DesktopIconAssignment) -> Option<ManagedShortcutIssue> {
    desktop_box_item_issue_with(assignment, Path::exists, resolve_lnk_target)
}

fn desktop_box_item_issue_with<F, R>(
    assignment: &DesktopIconAssignment,
    path_exists: F,
    resolve_lnk_target: R,
) -> Option<ManagedShortcutIssue>
where
    F: Fn(&Path) -> bool,
    R: Fn(&Path) -> Option<String>,
{
    if assignment.shell_id.is_some() {
        return None;
    }
    let path = assignment
        .path
        .as_deref()
        .unwrap_or(assignment.icon_id.as_str());
    let path = Path::new(path);
    if !path_exists(path) {
        return Some(ManagedShortcutIssue::StorageFileMissing);
    }
    if !path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"))
    {
        return None;
    }
    let target = resolve_lnk_target(path)?;
    // Network, URI and PIDL-backed shortcuts may be temporarily unavailable
    // without being invalid. Detect only local-file targets that have gone.
    if target.starts_with(r"\\") || target.contains("://") || target.starts_with("::") {
        return None;
    }
    (!target.trim().is_empty() && !path_exists(Path::new(&target)))
        .then_some(ManagedShortcutIssue::TargetMissing)
}

#[cfg(windows)]
fn show_native_shell_context_menu(
    hwnd_value: isize,
    target_path: Option<&str>,
    screen_x: i32,
    screen_y: i32,
) -> Result<Option<String>, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{PCSTR, PCWSTR};
    use windows::Win32::Foundation::{HWND, LPARAM, RPC_E_CHANGED_MODE, WPARAM};
    use windows::Win32::System::Com::{
        CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        CDefFolderMenu_Create2, IContextMenu, IShellFolder, SHBindToParent, SHGetDesktopFolder,
        SHParseDisplayName, CMF_NORMAL, CMINVOKECOMMANDINFO, GCS_VERBW,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreatePopupMenu, DestroyMenu, PostMessageW, SetForegroundWindow, TrackPopupMenuEx,
        SW_SHOWNORMAL, TPM_RETURNCMD, TPM_RIGHTBUTTON, WM_NULL,
    };
    if hwnd_value == 0 {
        return Err("桌面盒子窗口句柄无效。".to_string());
    }
    let hwnd = HWND(hwnd_value);
    let should_uninitialize = match unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) } {
        Ok(()) => true,
        Err(error) if error.code() == RPC_E_CHANGED_MODE => false,
        Err(error) => return Err(format!("初始化 Windows Shell 失败: {}", error)),
    };

    let result = (|| {
        let context_menu: IContextMenu = unsafe {
            if let Some(target_path) = target_path.filter(|value| !value.trim().is_empty()) {
                let wide = std::ffi::OsStr::new(target_path)
                    .encode_wide()
                    .chain(std::iter::once(0))
                    .collect::<Vec<_>>();
                let mut absolute_pidl = std::ptr::null_mut();
                SHParseDisplayName(PCWSTR(wide.as_ptr()), None, &mut absolute_pidl, 0, None)
                    .map_err(|error| format!("解析右键项目失败: {}", error))?;

                let mut child_pidl = std::ptr::null_mut();
                let result = (|| {
                    let parent: IShellFolder = SHBindToParent(absolute_pidl, Some(&mut child_pidl))
                        .map_err(|error| format!("获取右键项目父级失败: {}", error))?;
                    let child_items = [child_pidl as *const _];
                    parent
                        .GetUIObjectOf(hwnd, &child_items, None)
                        .map_err(|error| format!("获取 Windows 原生右键菜单失败: {}", error))
                })();
                CoTaskMemFree(Some(absolute_pidl.cast()));
                result?
            } else {
                let desktop = SHGetDesktopFolder()
                    .map_err(|error| format!("获取 Windows 桌面 Shell 失败: {}", error))?;
                CDefFolderMenu_Create2(None, hwnd, None, &desktop, None, None)
                    .map_err(|error| format!("创建 Windows 桌面右键菜单失败: {}", error))?
            }
        };

        let menu = unsafe { CreatePopupMenu() }
            .map_err(|error| format!("创建右键菜单窗口失败: {}", error))?;
        let menu_result = (|| {
            unsafe {
                context_menu
                    .QueryContextMenu(menu, 0, 1, 0x7fff, CMF_NORMAL)
                    .map_err(|error| format!("填充 Windows 原生右键菜单失败: {}", error))?;
            }

            unsafe {
                let _ = SetForegroundWindow(hwnd);
            }
            let command_id = unsafe {
                TrackPopupMenuEx(
                    menu,
                    (TPM_RETURNCMD | TPM_RIGHTBUTTON).0,
                    screen_x,
                    screen_y,
                    hwnd,
                    None,
                )
                .0 as u32
            };
            unsafe {
                let _ = PostMessageW(hwnd, WM_NULL, WPARAM(0), LPARAM(0));
            }
            if command_id == 0 {
                return Ok(None);
            }
            let verb_offset = command_id.saturating_sub(1);
            if verb_offset > 0x7ffe {
                return Err("Windows 原生右键菜单命令无效。".to_string());
            }
            let mut canonical_verb = vec![0u16; 260];
            let canonical_verb = unsafe {
                context_menu
                    .GetCommandString(
                        verb_offset as usize,
                        GCS_VERBW,
                        None,
                        windows::core::PSTR(canonical_verb.as_mut_ptr().cast()),
                        canonical_verb.len() as u32,
                    )
                    .ok()
                    .and_then(|_| {
                        let length = canonical_verb
                            .iter()
                            .position(|character| *character == 0)
                            .unwrap_or(canonical_verb.len());
                        (length > 0).then(|| String::from_utf16_lossy(&canonical_verb[..length]))
                    })
            };
            let invoke_info = CMINVOKECOMMANDINFO {
                cbSize: std::mem::size_of::<CMINVOKECOMMANDINFO>() as u32,
                hwnd,
                lpVerb: PCSTR(verb_offset as usize as *const u8),
                lpParameters: PCSTR(std::ptr::null()),
                lpDirectory: PCSTR(std::ptr::null()),
                nShow: SW_SHOWNORMAL.0,
                ..Default::default()
            };
            unsafe {
                context_menu
                    .InvokeCommand(&invoke_info)
                    .map_err(|error| format!("执行 Windows 原生右键命令失败: {}", error))?;
            }
            Ok(canonical_verb)
        })();
        unsafe {
            let _ = DestroyMenu(menu);
        }
        menu_result
    })();

    if should_uninitialize {
        unsafe { CoUninitialize() };
    }
    result
}

#[cfg(windows)]
fn show_invalid_shortcut_context_menu(
    hwnd_value: isize,
    screen_x: i32,
    screen_y: i32,
) -> Result<bool, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        AppendMenuW, CreatePopupMenu, DestroyMenu, PostMessageW, SetForegroundWindow,
        TrackPopupMenuEx, MF_STRING, TPM_RETURNCMD, TPM_RIGHTBUTTON, WM_NULL,
    };

    const DELETE_INVALID_SHORTCUT_COMMAND: usize = 1;
    if hwnd_value == 0 {
        return Err("桌面盒子窗口句柄无效。".to_string());
    }
    let hwnd = HWND(hwnd_value);
    let menu = unsafe { CreatePopupMenu() }
        .map_err(|error| format!("创建失效快捷方式菜单失败: {}", error))?;
    let label = "删除失效快捷方式\0".encode_utf16().collect::<Vec<_>>();
    let result = (|| {
        unsafe {
            AppendMenuW(
                menu,
                MF_STRING,
                DELETE_INVALID_SHORTCUT_COMMAND,
                PCWSTR(label.as_ptr()),
            )
            .map_err(|error| format!("填充失效快捷方式菜单失败: {}", error))?;
            let _ = SetForegroundWindow(hwnd);
        }
        let command_id = unsafe {
            TrackPopupMenuEx(
                menu,
                (TPM_RETURNCMD | TPM_RIGHTBUTTON).0,
                screen_x,
                screen_y,
                hwnd,
                None,
            )
            .0 as usize
        };
        unsafe {
            let _ = PostMessageW(hwnd, WM_NULL, WPARAM(0), LPARAM(0));
        }
        Ok(command_id == DELETE_INVALID_SHORTCUT_COMMAND)
    })();
    unsafe {
        let _ = DestroyMenu(menu);
    }
    result
}

#[cfg(windows)]
fn open_shell_item(shell_id: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{
        SHParseDisplayName, ShellExecuteExW, SEE_MASK_IDLIST, SHELLEXECUTEINFOW,
    };
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let wide = std::ffi::OsStr::new(shell_id)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut pidl = std::ptr::null_mut();
    unsafe {
        SHParseDisplayName(PCWSTR(wide.as_ptr()), None, &mut pidl, 0, None)
            .map_err(|error| format!("解析系统图标失败: {}", error))?;
        let mut execute_info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_IDLIST,
            lpIDList: pidl.cast(),
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };
        let result = ShellExecuteExW(&mut execute_info)
            .map_err(|error| format!("打开系统图标失败: {}", error));
        CoTaskMemFree(Some(pidl.cast()));
        result
    }
}

#[cfg(not(windows))]
fn open_shell_item(_shell_id: &str) -> Result<(), String> {
    Err("系统图标仅支持 Windows。".to_string())
}

fn strip_windows_extended_path_prefix(path: &str) -> String {
    let trimmed = path.trim();
    if let Some(rest) = trimmed.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", rest)
    } else if let Some(rest) = trimmed.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        trimmed.to_string()
    }
}

fn label_from_path(path: &str) -> String {
    let path = Path::new(path);
    path.file_stem()
        .or_else(|| path.file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("桌面图标")
        .to_string()
}

#[cfg(windows)]
fn resolve_lnk_target(path: &Path) -> Option<String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{ComInterface, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    let path_wide = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();

    unsafe {
        // A successful CoInitializeEx (including S_FALSE) must be balanced.
        // RPC_E_CHANGED_MODE means the caller already initialized COM using a
        // different apartment model; the existing apartment remains usable.
        let should_uninitialize = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        let resolved = (|| -> windows::core::Result<Option<String>> {
            let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            let persist_file: IPersistFile = shell_link.cast()?;
            persist_file.Load(PCWSTR(path_wide.as_ptr()), STGM_READ)?;

            let mut target = vec![0u16; 32_768];
            shell_link.GetPath(&mut target, std::ptr::null_mut(), 0)?;
            let length = target
                .iter()
                .position(|value| *value == 0)
                .unwrap_or(target.len());
            if length == 0 {
                return Ok(None);
            }
            Ok(Some(String::from_utf16_lossy(&target[..length])))
        })();
        if should_uninitialize {
            CoUninitialize();
        }
        resolved.ok().flatten()
    }
}

#[cfg(not(windows))]
fn resolve_lnk_target(_path: &Path) -> Option<String> {
    None
}

fn store_path() -> Result<PathBuf, String> {
    Storage::get_config_dir()
        .map(|dir| dir.join(STORE_FILE))
        .map_err(|e| e.to_string())
}

fn backup_store_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    let backup_dir = parent.join("backups");
    fs::create_dir_all(&backup_dir).map_err(|e| format!("创建桌面布局备份目录失败: {}", e))?;
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S%.3f").to_string();
    let backup_path = backup_dir.join(format!(
        "desktop_layouts_{}.json",
        timestamp.replace('.', "_")
    ));
    fs::copy(path, backup_path).map_err(|e| format!("备份桌面布局失败: {}", e))?;
    cleanup_backups(&backup_dir);
    Ok(())
}

fn cleanup_backups(backup_dir: &Path) {
    let Ok(entries) = fs::read_dir(backup_dir) else {
        return;
    };
    let mut backups = entries
        .flatten()
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            name.starts_with("desktop_layouts_") && name.ends_with(".json")
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.path()))
        })
        .collect::<Vec<_>>();
    backups.sort_by_key(|(modified, _)| *modified);
    if backups.len() <= 20 {
        return;
    }
    let remove_count = backups.len().saturating_sub(20);
    for (_, path) in backups.into_iter().take(remove_count) {
        let _ = fs::remove_file(path);
    }
}

fn latest_valid_backup(path: &Path) -> Option<DesktopLayoutStore> {
    let backup_dir = path.parent()?.join("backups");
    let mut backups = fs::read_dir(backup_dir)
        .ok()?
        .flatten()
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            name.starts_with("desktop_layouts_") && name.ends_with(".json")
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.path()))
        })
        .collect::<Vec<_>>();
    backups.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    backups.into_iter().find_map(|(_, backup_path)| {
        let content = fs::read_to_string(backup_path).ok()?;
        serde_json::from_str::<DesktopLayoutStore>(&content).ok()
    })
}

fn normalized_unique_id(
    original: &str,
    kind: &str,
    index: usize,
    used: &mut HashSet<String>,
) -> String {
    let trimmed = original.trim();
    let base = if trimmed.is_empty() {
        format!("legacy-{}-{}", kind, index + 1)
    } else {
        trimmed.to_string()
    };
    if used.insert(base.clone()) {
        return base;
    }
    for suffix in 2..10_000usize {
        let candidate = format!("{}-duplicate-{}-{}", base, index + 1, suffix);
        if used.insert(candidate.clone()) {
            return candidate;
        }
    }
    new_id()
}

fn normalize_store(mut store: DesktopLayoutStore) -> DesktopLayoutStore {
    let previous_version = store.version;
    if previous_version < 2 {
        store.box_appearance = legacy_box_appearance(&store);
    }
    if previous_version < 3 {
        let legacy_spacing = store.box_appearance.icon_spacing;
        store.box_appearance.icon_spacing = legacy_spacing.saturating_add(1) / 2;
        store.box_appearance.icon_vertical_spacing = legacy_spacing;
    }
    // Before version 4, the appearance panel was global and normalization
    // repeatedly overwrote every fence. Preserve that established appearance
    // once during the upgrade; version 4 and later retain each fence's values.
    let upgrade_global_appearance = previous_version < 4;
    store.version = STORE_VERSION;
    if store.layouts.is_empty() {
        store.layouts = default_store().layouts;
    }
    store.box_appearance.opacity = if store.box_appearance.opacity.is_finite() {
        store.box_appearance.opacity.clamp(0.1, 1.0)
    } else {
        default_box_opacity()
    };
    store.box_appearance.icon_spacing = if (MIN_BOX_ICON_SPACING..=MAX_BOX_ICON_SPACING)
        .contains(&store.box_appearance.icon_spacing)
    {
        store.box_appearance.icon_spacing
    } else {
        default_box_icon_horizontal_spacing()
    };
    store.box_appearance.icon_vertical_spacing = if (MIN_BOX_ICON_SPACING..=MAX_BOX_ICON_SPACING)
        .contains(&store.box_appearance.icon_vertical_spacing)
    {
        store.box_appearance.icon_vertical_spacing
    } else {
        default_box_icon_vertical_spacing()
    };
    let global_opacity = store.box_appearance.opacity;
    let global_icon_spacing = store.box_appearance.icon_spacing;
    let global_icon_vertical_spacing = store.box_appearance.icon_vertical_spacing;

    let mut layout_ids = HashSet::new();
    let mut layout_id_map = HashMap::new();
    for (index, layout) in store.layouts.iter_mut().enumerate() {
        let original_id = layout.id.clone();
        layout.id = normalized_unique_id(&original_id, "layout", index, &mut layout_ids);
        layout_id_map
            .entry(original_id)
            .or_insert_with(|| layout.id.clone());
    }
    if let Some(active_id) = store.active_layout_id.clone() {
        if let Some(mapped_id) = layout_id_map.get(&active_id) {
            store.active_layout_id = Some(mapped_id.clone());
        }
    }
    if store
        .active_layout_id
        .as_ref()
        .is_none_or(|id| !store.layouts.iter().any(|layout| layout.id == *id))
    {
        store.active_layout_id = store.layouts.first().map(|layout| layout.id.clone());
    }
    for layout in &mut store.layouts {
        layout.canvas_width = layout.canvas_width.max(800);
        layout.canvas_height = layout.canvas_height.max(500);
        layout.name = clean_name(&layout.name, "桌面布局");
        layout.updated_at = clean_timestamp(&layout.updated_at);
        layout.created_at = clean_timestamp(&layout.created_at);
        let mut fence_ids = HashSet::new();
        let mut fence_id_map = HashMap::new();
        for (index, fence) in layout.fences.iter_mut().enumerate() {
            let original_id = fence.id.clone();
            fence.id = normalized_unique_id(&original_id, "fence", index, &mut fence_ids);
            fence_id_map
                .entry(original_id)
                .or_insert_with(|| fence.id.clone());
            fence.name = clean_name(&fence.name, "分类");
            fence.width = fence.width.clamp(160, layout.canvas_width);
            fence.height = fence.height.clamp(120, layout.canvas_height);
            // Keep virtual-desktop coordinates, including negative positions
            // used by monitors placed to the left or above the primary one.
            fence.x = fence.x.clamp(-100_000, 100_000);
            fence.y = fence.y.clamp(-100_000, 100_000);
            if fence.color.trim().is_empty() {
                fence.color = "#2563eb".to_string();
            }
            fence.view_mode = match fence.view_mode.trim().to_ascii_lowercase().as_str() {
                "table" => "table".to_string(),
                _ => default_box_view_mode(),
            };
            fence.sort_mode = DesktopBoxSortMode::parse(&fence.sort_mode)
                .map(|mode| mode.as_str().to_string())
                .unwrap_or_else(|_| default_box_sort_mode());
            fence.opacity = if upgrade_global_appearance {
                global_opacity
            } else if fence.opacity.is_finite() {
                fence.opacity.clamp(0.1, 1.0)
            } else {
                global_opacity
            };
            fence.background_color = normalize_box_background(&fence.background_color)
                .unwrap_or_else(default_box_background);
            fence.icon_spacing = if upgrade_global_appearance {
                global_icon_spacing
            } else if (MIN_BOX_ICON_SPACING..=MAX_BOX_ICON_SPACING).contains(&fence.icon_spacing) {
                fence.icon_spacing
            } else {
                global_icon_spacing
            };
            fence.icon_vertical_spacing = if upgrade_global_appearance {
                global_icon_vertical_spacing
            } else if (MIN_BOX_ICON_SPACING..=MAX_BOX_ICON_SPACING)
                .contains(&fence.icon_vertical_spacing)
            {
                fence.icon_vertical_spacing
            } else {
                global_icon_vertical_spacing
            };
        }
        let valid_fences = layout
            .fences
            .iter()
            .map(|fence| fence.id.as_str())
            .collect::<HashSet<_>>();
        for item in &mut layout.icon_assignments {
            if let Some(mapped_id) = fence_id_map.get(&item.fence_id) {
                item.fence_id = mapped_id.clone();
            }
        }
        layout.icon_assignments.retain(|item| {
            !item.icon_id.trim().is_empty() && valid_fences.contains(item.fence_id.as_str())
        });
        for item in &mut layout.icon_assignments {
            item.icon_id = strip_windows_extended_path_prefix(&item.icon_id);
            if let Some(path) = item.path.as_mut() {
                *path = strip_windows_extended_path_prefix(path);
            }
            if let Some(path) = item.original_path.as_mut() {
                *path = strip_windows_extended_path_prefix(path);
            }
        }
    }
    store
}

fn default_store() -> DesktopLayoutStore {
    let now = Utc::now().to_rfc3339();
    let layout_id = new_id();
    DesktopLayoutStore {
        version: STORE_VERSION,
        active_layout_id: Some(layout_id.clone()),
        box_appearance: DesktopBoxAppearance::default(),
        layouts: vec![DesktopLayout {
            id: layout_id,
            name: "默认桌面".to_string(),
            canvas_width: DEFAULT_CANVAS_WIDTH,
            canvas_height: DEFAULT_CANVAS_HEIGHT,
            fences: Vec::new(),
            icon_assignments: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
        }],
    }
}

fn legacy_box_appearance(store: &DesktopLayoutStore) -> DesktopBoxAppearance {
    let active_layout = store
        .active_layout_id
        .as_ref()
        .and_then(|active_id| store.layouts.iter().find(|layout| layout.id == *active_id));
    let legacy_fence = active_layout
        .and_then(|layout| layout.fences.iter().min_by_key(|fence| fence.order))
        .or_else(|| {
            store
                .layouts
                .iter()
                .flat_map(|layout| layout.fences.iter())
                .min_by_key(|fence| fence.order)
        });
    legacy_fence
        .map(|fence| DesktopBoxAppearance {
            opacity: fence.opacity,
            icon_spacing: fence.icon_spacing,
            icon_vertical_spacing: fence.icon_spacing,
        })
        .unwrap_or_default()
}

fn scan_icons() -> Result<DesktopIconScanResult, String> {
    let desktop_dir = dirs::desktop_dir();
    let public_desktop_dir = std::env::var("PUBLIC")
        .ok()
        .map(|public| PathBuf::from(public).join("Desktop"))
        .filter(|path| path.is_dir());
    let file_entries = collect_desktop_files(desktop_dir.as_deref(), public_desktop_dir.as_deref());
    let file_index = build_file_index(&file_entries);

    match native_desktop_icons() {
        Ok(native_icons) if !native_icons.is_empty() => {
            let mut icons = native_icons
                .into_iter()
                .map(|icon| {
                    let matched = match_file_entry(&file_index, &icon.label);
                    DesktopIconInfo {
                        id: matched
                            .as_ref()
                            .map(|entry| entry.path.clone())
                            .unwrap_or_else(|| format!("native:{}:{}", icon.label, icon.index)),
                        label: icon.label,
                        path: matched.as_ref().map(|entry| entry.path.clone()),
                        extension: matched.as_ref().and_then(|entry| entry.extension.clone()),
                        is_directory: matched.as_ref().is_some_and(|entry| entry.is_directory),
                        source: matched
                            .as_ref()
                            .map(|entry| entry.source.clone())
                            .unwrap_or_else(|| "desktop".to_string()),
                        x: Some(icon.x),
                        y: Some(icon.y),
                        native_index: Some(icon.index),
                    }
                })
                .collect::<Vec<_>>();
            icons
                .sort_by_key(|icon| (icon.y.unwrap_or(0), icon.x.unwrap_or(0), icon.label.clone()));
            Ok(DesktopIconScanResult {
                icons,
                desktop_dir: desktop_dir.map(|path| path.to_string_lossy().to_string()),
                public_desktop_dir: public_desktop_dir
                    .map(|path| path.to_string_lossy().to_string()),
                native_available: true,
                message: "已读取 Explorer 桌面图标位置。".to_string(),
            })
        }
        Ok(_) => Ok(file_system_scan_result(
            desktop_dir,
            public_desktop_dir,
            file_entries,
            "没有从 Explorer 读取到桌面图标，已回退为文件列表。",
        )),
        Err(error) => Ok(file_system_scan_result(
            desktop_dir,
            public_desktop_dir,
            file_entries,
            &format!(
                "无法读取 Explorer 桌面图标位置，已回退为文件列表: {}",
                error
            ),
        )),
    }
}

fn file_system_scan_result(
    desktop_dir: Option<PathBuf>,
    public_desktop_dir: Option<PathBuf>,
    file_entries: Vec<DesktopFileEntry>,
    message: &str,
) -> DesktopIconScanResult {
    let mut icons = file_entries
        .into_iter()
        .map(|entry| DesktopIconInfo {
            id: entry.path.clone(),
            label: entry.label,
            path: Some(entry.path),
            extension: entry.extension,
            is_directory: entry.is_directory,
            source: entry.source,
            x: None,
            y: None,
            native_index: None,
        })
        .collect::<Vec<_>>();
    icons.sort_by_key(|icon| icon.label.to_ascii_lowercase());
    DesktopIconScanResult {
        icons,
        desktop_dir: desktop_dir.map(|path| path.to_string_lossy().to_string()),
        public_desktop_dir: public_desktop_dir.map(|path| path.to_string_lossy().to_string()),
        native_available: false,
        message: message.to_string(),
    }
}

fn collect_desktop_files(
    desktop_dir: Option<&Path>,
    public_desktop_dir: Option<&Path>,
) -> Vec<DesktopFileEntry> {
    let mut entries = Vec::new();
    if let Some(dir) = desktop_dir {
        collect_desktop_dir(dir, "用户桌面", &mut entries);
    }
    if let Some(dir) = public_desktop_dir {
        collect_desktop_dir(dir, "公共桌面", &mut entries);
    }
    entries
}

fn collect_desktop_dir(dir: &Path, source: &str, entries: &mut Vec<DesktopFileEntry>) {
    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.trim().is_empty() || file_name.eq_ignore_ascii_case("desktop.ini") {
            continue;
        }
        let label = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(file_name.as_str())
            .to_string();
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());
        let mut alias_paths = vec![path.to_string_lossy().to_string()];
        if extension.as_deref() == Some("lnk") {
            if let Some(target) = resolve_lnk_target(&path) {
                alias_paths.push(target);
            }
        }
        entries.push(DesktopFileEntry {
            label,
            path: path.to_string_lossy().to_string(),
            alias_paths,
            extension,
            is_directory: metadata.is_dir(),
            source: source.to_string(),
        });
    }
}

fn build_file_index(entries: &[DesktopFileEntry]) -> HashMap<String, Vec<DesktopFileEntry>> {
    let mut index: HashMap<String, Vec<DesktopFileEntry>> = HashMap::new();
    for entry in entries {
        push_file_index(&mut index, &entry.label, entry);
        if let Some(file_name) = Path::new(&entry.path)
            .file_name()
            .and_then(|value| value.to_str())
        {
            push_file_index(&mut index, file_name, entry);
        }
        for alias in &entry.alias_paths {
            push_file_index(&mut index, alias, entry);
        }
    }
    index
}

fn push_file_index(
    index: &mut HashMap<String, Vec<DesktopFileEntry>>,
    key: &str,
    entry: &DesktopFileEntry,
) {
    index
        .entry(key.trim().to_ascii_lowercase())
        .or_default()
        .push(entry.clone());
}

fn match_file_entry(
    index: &HashMap<String, Vec<DesktopFileEntry>>,
    label: &str,
) -> Option<DesktopFileEntry> {
    let items = index.get(&label.trim().to_ascii_lowercase())?;
    let mut unique = Vec::new();
    for item in items {
        if !unique.iter().any(|entry: &DesktopFileEntry| {
            normalize_path_key(&entry.path) == normalize_path_key(&item.path)
        }) {
            unique.push(item.clone());
        }
    }
    (unique.len() == 1).then(|| unique.remove(0))
}

fn apply_layout(layout: &DesktopLayout) -> Result<DesktopLayoutApplyResult, String> {
    if layout.icon_assignments.is_empty() {
        return Ok(DesktopLayoutApplyResult {
            moved: 0,
            skipped: 0,
            message: "当前布局没有分配任何桌面图标。".to_string(),
        });
    }
    let planned = plan_icon_positions(layout);
    if planned.is_empty() {
        return Ok(DesktopLayoutApplyResult {
            moved: 0,
            skipped: layout.icon_assignments.len(),
            message: "当前布局没有可应用的位置。".to_string(),
        });
    }
    apply_native_positions(&planned)
}

fn plan_icon_positions(layout: &DesktopLayout) -> Vec<(DesktopIconAssignment, i32, i32)> {
    let fence_map = layout
        .fences
        .iter()
        .map(|fence| (fence.id.as_str(), fence))
        .collect::<HashMap<_, _>>();
    let mut grouped: HashMap<&str, Vec<DesktopIconAssignment>> = HashMap::new();
    for assignment in &layout.icon_assignments {
        if fence_map.contains_key(assignment.fence_id.as_str()) {
            grouped
                .entry(assignment.fence_id.as_str())
                .or_default()
                .push(assignment.clone());
        }
    }
    let mut planned = Vec::new();
    for (fence_id, mut assignments) in grouped {
        let Some(fence) = fence_map.get(fence_id) else {
            continue;
        };
        if fence.hidden {
            continue;
        }
        let scale_factor = box_scale_factor(fence.id.as_str());
        let padding_x = (FENCE_PADDING_X as f32 * scale_factor).round() as i32;
        let padding_top = (FENCE_PADDING_TOP as f32 * scale_factor).round() as i32;
        let icon_cell_width = (ICON_CELL_WIDTH as f32 * scale_factor).round().max(1.0) as i32;
        let icon_cell_height = (ICON_CELL_HEIGHT as f32 * scale_factor).round().max(1.0) as i32;
        assignments.sort_by_key(|item| (item.order, item.label.clone()));
        let columns = ((fence.width - padding_x * 2) / icon_cell_width).max(1);
        for (index, assignment) in assignments.into_iter().enumerate() {
            let x = assignment
                .offset_x
                .map(|offset| fence.x + offset)
                .unwrap_or_else(|| {
                    fence.x + padding_x + (index as i32 % columns) * icon_cell_width
                });
            let y = assignment
                .offset_y
                .map(|offset| fence.y + offset)
                .unwrap_or_else(|| {
                    fence.y + padding_top + (index as i32 / columns) * icon_cell_height
                });
            planned.push((assignment, x, y));
        }
    }
    planned
}

fn clean_name(value: &str, fallback: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        fallback.to_string()
    } else {
        value.chars().take(40).collect()
    }
}

fn clean_timestamp(value: &str) -> String {
    if value.trim().is_empty() {
        Utc::now().to_rfc3339()
    } else {
        value.to_string()
    }
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

#[cfg(windows)]
fn cursor_position() -> Option<(i32, i32)> {
    use winapi::shared::windef::POINT;
    use winapi::um::winuser::GetCursorPos;

    let mut point = POINT { x: 120, y: 120 };
    let ok = unsafe { GetCursorPos(&mut point) };
    if ok == 0 {
        None
    } else {
        Some((point.x, point.y))
    }
}

#[cfg(windows)]
fn desktop_work_area_at(x: i32, y: i32) -> Option<DesktopWorkArea> {
    use std::mem::{size_of, zeroed};
    use winapi::shared::windef::POINT;
    use winapi::um::winuser::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };

    let monitor = unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST) };
    if monitor.is_null() {
        return None;
    }
    let mut info: MONITORINFO = unsafe { zeroed() };
    info.cbSize = size_of::<MONITORINFO>() as u32;
    if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
        return None;
    }
    Some(DesktopWorkArea {
        left: info.rcWork.left,
        top: info.rcWork.top,
        right: info.rcWork.right,
        bottom: info.rcWork.bottom,
    })
}

#[cfg(windows)]
fn system_scale_factor() -> f32 {
    use winapi::um::winuser::GetDpiForSystem;

    let dpi = unsafe { GetDpiForSystem() };
    if dpi == 0 {
        1.0
    } else {
        dpi as f32 / 96.0
    }
}

#[cfg(not(windows))]
fn cursor_position() -> Option<(i32, i32)> {
    None
}

#[cfg(not(windows))]
fn desktop_work_area_at(_x: i32, _y: i32) -> Option<DesktopWorkArea> {
    None
}

#[cfg(not(windows))]
fn system_scale_factor() -> f32 {
    1.0
}

#[cfg(windows)]
fn native_desktop_icons() -> Result<Vec<NativeDesktopIcon>, String> {
    windows_desktop_icons::native_desktop_icons()
}

#[cfg(windows)]
pub(crate) fn desktop_box_shell_host() -> Option<isize> {
    windows_desktop_icons::desktop_shell_host()
}

#[cfg(not(windows))]
pub(crate) fn desktop_box_shell_host() -> Option<isize> {
    None
}

#[cfg(not(windows))]
fn native_desktop_icons() -> Result<Vec<NativeDesktopIcon>, String> {
    Err("当前平台不支持读取桌面图标位置。".to_string())
}

#[cfg(windows)]
fn apply_native_positions(
    planned: &[(DesktopIconAssignment, i32, i32)],
) -> Result<DesktopLayoutApplyResult, String> {
    windows_desktop_icons::apply_native_positions(planned)
}

#[cfg(not(windows))]
fn apply_native_positions(
    planned: &[(DesktopIconAssignment, i32, i32)],
) -> Result<DesktopLayoutApplyResult, String> {
    Ok(DesktopLayoutApplyResult {
        moved: 0,
        skipped: planned.len(),
        message: "当前平台不支持移动桌面图标。".to_string(),
    })
}

#[cfg(windows)]
mod windows_desktop_icons {
    use super::{DesktopIconAssignment, DesktopLayoutApplyResult, NativeDesktopIcon};
    use std::ffi::OsStr;
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr::{null, null_mut};
    use winapi::shared::minwindef::{BOOL, FALSE, LPARAM, TRUE, WPARAM};
    use winapi::shared::windef::{HWND, POINT};
    use winapi::um::commctrl::{
        LVIF_TEXT, LVITEMW, LVM_GETITEMCOUNT, LVM_GETITEMPOSITION, LVM_GETITEMTEXTW,
        LVM_SETITEMPOSITION,
    };
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::memoryapi::{
        ReadProcessMemory, VirtualAllocEx, VirtualFreeEx, WriteProcessMemory,
    };
    use winapi::um::processthreadsapi::OpenProcess;
    use winapi::um::winnt::{
        HANDLE, MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE, PROCESS_QUERY_INFORMATION,
        PROCESS_VM_OPERATION, PROCESS_VM_READ, PROCESS_VM_WRITE,
    };
    use winapi::um::winuser::{
        EnumWindows, FindWindowExW, FindWindowW, GetWindowRect, GetWindowThreadProcessId,
        InvalidateRect, SendMessageW, UpdateWindow,
    };

    const TEXT_BUFFER_CHARS: usize = 260;

    pub fn desktop_shell_identity() -> Option<isize> {
        desktop_shell_host()
    }

    pub fn desktop_shell_host() -> Option<isize> {
        find_desktop_shell().map(|hwnd| hwnd as isize)
    }

    /// Ask Explorer to repaint the desktop icon host after files have been
    /// moved back from Box storage. The filesystem notifications update the
    /// item model; invalidating both the list view and its shell host removes
    /// any stale pixels left by the hidden Box WebViews.
    pub fn refresh_desktop() {
        let shell = find_desktop_shell();
        let listview = find_desktop_listview();
        unsafe {
            for hwnd in [shell, listview].into_iter().flatten() {
                let _ = InvalidateRect(hwnd, null(), TRUE);
                let _ = UpdateWindow(hwnd);
            }
        }
    }

    pub fn native_desktop_icons() -> Result<Vec<NativeDesktopIcon>, String> {
        let hwnd = find_desktop_listview().ok_or_else(|| {
            "没有找到 Explorer 桌面图标列表。请确认 Windows 桌面由 Explorer 管理。".to_string()
        })?;
        let count = listview_item_count(hwnd);
        if count <= 0 {
            return Ok(Vec::new());
        }
        let process = RemoteProcess::from_window(hwnd)?;
        let mut icons = Vec::new();
        for index in 0..count {
            let label = process
                .get_item_text(hwnd, index)
                .unwrap_or_else(|| format!("桌面图标 {}", index + 1));
            let point = process
                .get_item_position(hwnd, index)
                .unwrap_or(POINT { x: 0, y: 0 });
            icons.push(NativeDesktopIcon {
                label,
                x: point.x,
                y: point.y,
                index,
            });
        }
        Ok(icons)
    }

    pub fn apply_native_positions(
        planned: &[(DesktopIconAssignment, i32, i32)],
    ) -> Result<DesktopLayoutApplyResult, String> {
        let hwnd = find_desktop_listview()
            .ok_or_else(|| "没有找到 Explorer 桌面图标列表，无法移动桌面图标。".to_string())?;
        let current = native_desktop_icons()?;
        if current.is_empty() {
            return Ok(DesktopLayoutApplyResult {
                moved: 0,
                skipped: planned.len(),
                message: "Explorer 当前没有返回任何桌面图标。可能桌面图标被隐藏，或已被 Coodesker/Fences 等桌面管理工具接管；已保存到 Box，但无法移动原生 Explorer 图标。".to_string(),
            });
        }
        let mut moved = 0usize;
        let mut skipped = 0usize;
        let mut used_indexes = Vec::new();
        let origin = listview_origin(hwnd);

        for (assignment, x, y) in planned {
            if let Some(icon) = find_matching_icon(&current, &used_indexes, assignment) {
                let packed = make_lparam(*x - origin.x, *y - origin.y);
                let applied = unsafe {
                    SendMessageW(hwnd, LVM_SETITEMPOSITION, icon.index as WPARAM, packed)
                };
                if applied == 0 {
                    skipped += 1;
                    continue;
                }
                used_indexes.push(icon.index);
                moved += 1;
            } else {
                skipped += 1;
            }
        }

        Ok(DesktopLayoutApplyResult {
            moved,
            skipped,
            message: if skipped == 0 {
                format!("已移动 {} 个桌面图标。", moved)
            } else {
                format!("已移动 {} 个桌面图标，{} 个未找到。", moved, skipped)
            },
        })
    }

    fn find_matching_icon<'a>(
        icons: &'a [NativeDesktopIcon],
        used_indexes: &[i32],
        assignment: &DesktopIconAssignment,
    ) -> Option<&'a NativeDesktopIcon> {
        // A path-only assignment has no reliable native identity. Refuse to
        // guess by label when extensions are hidden and names collide.
        if assignment.native_index.is_none()
            && assignment.path.is_some()
            && assignment.path.as_deref() == Some(assignment.icon_id.as_str())
        {
            return None;
        }
        let candidates = assignment_label_candidates(assignment);
        let label_matches = |icon: &&NativeDesktopIcon| {
            !used_indexes.contains(&icon.index)
                && candidates
                    .iter()
                    .any(|candidate| normalize_label(&icon.label) == *candidate)
        };

        // Explorer list indexes are not stable across refreshes, sorting, or
        // restarts. Use a saved index only to disambiguate a matching label;
        // never let a stale index move an unrelated desktop icon.
        if let Some(native_index) = assignment.native_index {
            if let Some(icon) = icons
                .iter()
                .filter(label_matches)
                .find(|icon| icon.index == native_index)
            {
                return Some(icon);
            }
        }
        icons.iter().find(label_matches)
    }

    fn assignment_label_candidates(assignment: &DesktopIconAssignment) -> Vec<String> {
        let mut candidates = Vec::new();
        push_candidate(&mut candidates, &assignment.label);
        push_candidate(&mut candidates, &assignment.icon_id);

        if let Some(path) = assignment.path.as_deref() {
            push_candidate(&mut candidates, path);
            let path = Path::new(path);
            if let Some(file_name) = path.file_name().and_then(|value| value.to_str()) {
                push_candidate(&mut candidates, file_name);
            }
            if let Some(stem) = path.file_stem().and_then(|value| value.to_str()) {
                push_candidate(&mut candidates, stem);
            }
        }

        candidates
    }

    fn push_candidate(candidates: &mut Vec<String>, value: &str) {
        let normalized = normalize_label(value);
        if !normalized.is_empty() && !candidates.contains(&normalized) {
            candidates.push(normalized);
        }
    }

    fn normalize_label(value: &str) -> String {
        let trimmed = value.trim().trim_matches('"');
        if trimmed.is_empty() {
            return String::new();
        }
        let path = Path::new(trimmed);
        if path.components().count() > 1 {
            if let Some(file_name) = path.file_name().and_then(|value| value.to_str()) {
                return file_name.trim().to_ascii_lowercase();
            }
        }
        trimmed.to_ascii_lowercase()
    }

    struct RemoteProcess {
        handle: HANDLE,
    }

    impl RemoteProcess {
        fn from_window(hwnd: HWND) -> Result<Self, String> {
            let mut pid = 0u32;
            unsafe {
                GetWindowThreadProcessId(hwnd, &mut pid);
            }
            if pid == 0 {
                return Err("无法获取 Explorer 桌面进程。".to_string());
            }
            let handle = unsafe {
                OpenProcess(
                    PROCESS_QUERY_INFORMATION
                        | PROCESS_VM_OPERATION
                        | PROCESS_VM_READ
                        | PROCESS_VM_WRITE,
                    FALSE,
                    pid,
                )
            };
            if handle.is_null() {
                Err("无法打开 Explorer 桌面进程用于读取图标。".to_string())
            } else {
                Ok(Self { handle })
            }
        }

        fn get_item_text(&self, hwnd: HWND, index: i32) -> Option<String> {
            let item_size = size_of::<LVITEMW>();
            let text_size = TEXT_BUFFER_CHARS * size_of::<u16>();
            let total_size = item_size + text_size;
            let remote_item = self.alloc(total_size)?;
            let remote_text = (remote_item as usize + item_size) as *mut u16;

            let mut item: LVITEMW = unsafe { zeroed() };
            item.mask = LVIF_TEXT;
            item.iItem = index;
            item.iSubItem = 0;
            item.pszText = remote_text;
            item.cchTextMax = TEXT_BUFFER_CHARS as i32;

            let wrote = unsafe {
                WriteProcessMemory(
                    self.handle,
                    remote_item,
                    &item as *const LVITEMW as *const _,
                    item_size,
                    null_mut(),
                )
            };
            if wrote == FALSE {
                let _ = self.free(remote_item);
                return None;
            }

            unsafe {
                SendMessageW(
                    hwnd,
                    LVM_GETITEMTEXTW,
                    index as WPARAM,
                    remote_item as LPARAM,
                );
            }

            let mut buffer = vec![0u16; TEXT_BUFFER_CHARS];
            let read = unsafe {
                ReadProcessMemory(
                    self.handle,
                    remote_text as *const _,
                    buffer.as_mut_ptr() as *mut _,
                    text_size,
                    null_mut(),
                )
            };
            let _ = self.free(remote_item);
            if read == FALSE {
                return None;
            }
            let len = buffer
                .iter()
                .position(|value| *value == 0)
                .unwrap_or(buffer.len());
            Some(String::from_utf16_lossy(&buffer[..len]))
        }

        fn get_item_position(&self, hwnd: HWND, index: i32) -> Option<POINT> {
            let point_size = size_of::<POINT>();
            let remote_point = self.alloc(point_size)?;
            let ok = unsafe {
                SendMessageW(
                    hwnd,
                    LVM_GETITEMPOSITION,
                    index as WPARAM,
                    remote_point as LPARAM,
                )
            };
            if ok == 0 {
                let _ = self.free(remote_point);
                return None;
            }
            let mut point: POINT = POINT { x: 0, y: 0 };
            let read = unsafe {
                ReadProcessMemory(
                    self.handle,
                    remote_point as *const _,
                    &mut point as *mut POINT as *mut _,
                    point_size,
                    null_mut(),
                )
            };
            let _ = self.free(remote_point);
            if read == FALSE {
                None
            } else {
                Some(point)
            }
        }

        fn alloc(&self, size: usize) -> Option<*mut winapi::ctypes::c_void> {
            let ptr = unsafe {
                VirtualAllocEx(
                    self.handle,
                    null_mut(),
                    size,
                    MEM_COMMIT | MEM_RESERVE,
                    PAGE_READWRITE,
                )
            };
            if ptr.is_null() {
                None
            } else {
                Some(ptr)
            }
        }

        fn free(&self, ptr: *mut winapi::ctypes::c_void) -> bool {
            unsafe { VirtualFreeEx(self.handle, ptr, 0, MEM_RELEASE) != FALSE }
        }
    }

    impl Drop for RemoteProcess {
        fn drop(&mut self) {
            if !self.handle.is_null() {
                unsafe {
                    CloseHandle(self.handle);
                }
            }
        }
    }

    fn find_desktop_shell() -> Option<HWND> {
        let progman = unsafe { FindWindowW(wide("Progman").as_ptr(), null()) };
        if !progman.is_null() {
            let shell = unsafe {
                FindWindowExW(
                    progman,
                    null_mut(),
                    wide("SHELLDLL_DefView").as_ptr(),
                    null(),
                )
            };
            if !shell.is_null() {
                return Some(shell);
            }
        }

        let mut desktop_shell: HWND = null_mut();
        unsafe {
            EnumWindows(
                Some(enum_desktop_shell_proc),
                &mut desktop_shell as *mut HWND as LPARAM,
            );
        }
        if desktop_shell.is_null() {
            None
        } else {
            Some(desktop_shell)
        }
    }

    unsafe extern "system" fn enum_desktop_shell_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let result = lparam as *mut HWND;
        if result.is_null()
            || (!window_class_is(hwnd, "WorkerW") && !window_class_is(hwnd, "Progman"))
        {
            return TRUE;
        }
        let shell = FindWindowExW(hwnd, null_mut(), wide("SHELLDLL_DefView").as_ptr(), null());
        if !shell.is_null() {
            *result = shell;
            FALSE
        } else {
            TRUE
        }
    }

    fn find_desktop_listview() -> Option<HWND> {
        let shell = find_desktop_shell()?;
        let listview =
            unsafe { FindWindowExW(shell, null_mut(), wide("SysListView32").as_ptr(), null()) };
        if listview.is_null() {
            None
        } else {
            Some(listview)
        }
    }

    fn window_class_is(hwnd: HWND, expected: &str) -> bool {
        let mut buffer = [0u16; 64];
        let length = unsafe {
            winapi::um::winuser::GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32)
        };
        if length <= 0 {
            return false;
        }
        String::from_utf16_lossy(&buffer[..length as usize]).eq_ignore_ascii_case(expected)
    }

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(Some(0)).collect()
    }

    fn make_lparam(x: i32, y: i32) -> LPARAM {
        (((y as u32 & 0xffff) << 16) | (x as u32 & 0xffff)) as LPARAM
    }

    fn listview_item_count(hwnd: HWND) -> i32 {
        unsafe { SendMessageW(hwnd, LVM_GETITEMCOUNT, 0, 0) as i32 }
    }

    fn listview_origin(hwnd: HWND) -> POINT {
        let mut rect = winapi::shared::windef::RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
            POINT { x: 0, y: 0 }
        } else {
            POINT {
                x: rect.left,
                y: rect.top,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fence(id: &str, hidden: bool) -> DesktopFence {
        DesktopFence {
            id: id.to_string(),
            name: id.to_string(),
            x: 10,
            y: 20,
            width: DEFAULT_BOX_WIDTH,
            height: DEFAULT_BOX_HEIGHT,
            color: FENCE_COLORS[0].to_string(),
            view_mode: default_box_view_mode(),
            sort_mode: default_box_sort_mode(),
            opacity: default_box_opacity(),
            background_color: default_box_background(),
            icon_spacing: default_box_icon_horizontal_spacing(),
            icon_vertical_spacing: default_box_icon_vertical_spacing(),
            collapsed: false,
            hidden,
            order: 0,
        }
    }

    fn assignment(icon_id: &str, fence_id: &str, order: i32) -> DesktopIconAssignment {
        DesktopIconAssignment {
            icon_id: icon_id.to_string(),
            label: icon_id.to_string(),
            path: Some(format!("C:\\items\\{}", icon_id)),
            shell_id: None,
            fence_id: fence_id.to_string(),
            order,
            offset_x: None,
            offset_y: None,
            native_index: None,
            original_path: None,
            managed_file: false,
        }
    }

    #[test]
    fn missing_box_storage_file_is_marked_as_an_invalid_shortcut() {
        let mut item = assignment("missing.lnk", "box", 0);
        item.managed_file = true;

        let issue = desktop_box_item_issue_with(&item, |_| false, |_| None);

        assert_eq!(issue, Some(ManagedShortcutIssue::StorageFileMissing));
    }

    #[test]
    fn legacy_managed_file_recovers_to_a_non_destructive_desktop_reference() {
        let root = std::env::temp_dir().join(format!("mcstartup-box-test-{}", Uuid::new_v4()));
        let storage_dir = root.join("desktop_boxes").join("box");
        let desktop_dir = root.join("Desktop");
        fs::create_dir_all(&storage_dir).expect("create legacy storage directory");
        fs::create_dir_all(&desktop_dir).expect("create desktop directory");
        let source = storage_dir.join("demo.lnk");
        let destination = desktop_dir.join("demo.lnk");
        fs::write(&source, b"legacy shortcut").expect("create legacy file");

        let mut store = default_store();
        store.layouts[0].fences.push(fence("box", false));
        store.layouts[0]
            .icon_assignments
            .push(DesktopIconAssignment {
                icon_id: source.to_string_lossy().to_string(),
                label: "demo".to_string(),
                path: Some(source.to_string_lossy().to_string()),
                shell_id: None,
                fence_id: "box".to_string(),
                order: 0,
                offset_x: Some(11),
                offset_y: Some(22),
                native_index: Some(3),
                original_path: Some(destination.to_string_lossy().to_string()),
                managed_file: true,
            });

        let recovery = recover_legacy_managed_desktop_assignments(&mut store);
        let recovered = &store.layouts[0].icon_assignments[0];

        assert!(recovery.changed);
        assert_eq!(recovery.restored_count, 1);
        assert!(!source.exists());
        assert!(destination.exists());
        assert_eq!(
            recovered.path.as_deref(),
            Some(destination.to_string_lossy().as_ref())
        );
        assert_eq!(recovered.icon_id, destination.to_string_lossy());
        assert_eq!(recovered.original_path, None);
        assert!(!recovered.managed_file);
        assert_eq!(recovered.offset_x, None);
        assert_eq!(recovered.offset_y, None);
        assert_eq!(recovered.native_index, None);

        fs::remove_dir_all(&root).expect("remove temporary test directory");
    }

    #[test]
    fn shortcut_with_missing_local_target_is_marked_invalid() {
        let mut item = assignment("removed-program.lnk", "box", 0);
        item.managed_file = true;

        let issue = desktop_box_item_issue_with(
            &item,
            |path| !path.to_string_lossy().ends_with("removed-program.exe"),
            |_| Some(r"C:\Programs\removed-program.exe".to_string()),
        );

        assert_eq!(issue, Some(ManagedShortcutIssue::TargetMissing));
    }

    #[test]
    fn shell_items_are_not_treated_as_missing_files() {
        let mut item = assignment("shell:::{645FF040-5081-101B-9F08-00AA002F954E}", "box", 0);
        item.path = None;
        item.shell_id = Some("::{645FF040-5081-101B-9F08-00AA002F954E}".to_string());

        let issue = desktop_box_item_issue_with(&item, |_| false, |_| None);

        assert_eq!(issue, None);
    }

    #[test]
    fn reconciliation_targets_every_visible_persisted_box() {
        let layout = DesktopLayout {
            id: "layout".to_string(),
            name: "layout".to_string(),
            canvas_width: DEFAULT_CANVAS_WIDTH,
            canvas_height: DEFAULT_CANVAS_HEIGHT,
            fences: vec![
                fence("first", false),
                fence("second", false),
                fence("hidden", true),
            ],
            icon_assignments: Vec::new(),
            created_at: String::new(),
            updated_at: String::new(),
        };

        let labels = desired_box_window_labels(&layout);
        assert_eq!(labels.len(), 2);
        assert!(labels.contains("desktop-box-first"));
        assert!(labels.contains("desktop-box-second"));
        assert!(!labels.contains("desktop-box-hidden"));
    }

    #[test]
    fn default_store_does_not_create_implicit_boxes() {
        let store = default_store();
        assert_eq!(store.layouts.len(), 1);
        assert!(store.layouts[0].fences.is_empty());
    }

    #[test]
    fn legacy_box_without_icon_spacing_uses_current_default() {
        let legacy = serde_json::json!({
            "id": "legacy",
            "name": "Legacy Box",
            "x": 10,
            "y": 20,
            "width": 520,
            "height": 300,
            "color": "#2563eb",
            "collapsed": false,
            "hidden": false,
            "order": 0
        });
        let fence: DesktopFence = serde_json::from_value(legacy).expect("legacy Box data");
        assert_eq!(fence.icon_spacing, LEGACY_DEFAULT_BOX_ICON_SPACING);
        assert_eq!(
            fence.icon_vertical_spacing,
            DEFAULT_BOX_ICON_VERTICAL_SPACING
        );
    }

    #[test]
    fn legacy_store_migrates_first_active_box_appearance_to_all_boxes() {
        let legacy = serde_json::json!({
            "version": 1,
            "activeLayoutId": "layout",
            "layouts": [{
                "id": "layout",
                "name": "Default",
                "canvasWidth": 1920,
                "canvasHeight": 1080,
                "fences": [
                    {
                        "id": "first",
                        "name": "First",
                        "x": 10,
                        "y": 20,
                        "width": 520,
                        "height": 300,
                        "color": "#2563eb",
                        "opacity": 0.42,
                        "iconSpacing": 17,
                        "order": 0
                    },
                    {
                        "id": "second",
                        "name": "Second",
                        "x": 540,
                        "y": 20,
                        "width": 520,
                        "height": 300,
                        "color": "#16a34a",
                        "opacity": 0.9,
                        "iconSpacing": 2,
                        "order": 1
                    }
                ],
                "iconAssignments": [],
                "createdAt": "",
                "updatedAt": ""
            }]
        });
        let store: DesktopLayoutStore =
            serde_json::from_value(legacy).expect("legacy desktop layout store");
        let normalized = normalize_store(store);

        assert_eq!(normalized.version, STORE_VERSION);
        assert!((normalized.box_appearance.opacity - 0.42).abs() < f32::EPSILON);
        assert_eq!(normalized.box_appearance.icon_spacing, 9);
        assert_eq!(normalized.box_appearance.icon_vertical_spacing, 17);
        assert!(normalized.layouts[0].fences.iter().all(|fence| {
            (fence.opacity - normalized.box_appearance.opacity).abs() < f32::EPSILON
                && fence.icon_spacing == normalized.box_appearance.icon_spacing
                && fence.icon_vertical_spacing == normalized.box_appearance.icon_vertical_spacing
        }));
    }

    #[test]
    fn version_two_spacing_migrates_to_visual_horizontal_and_vertical_values() {
        let version_two = serde_json::json!({
            "version": 2,
            "activeLayoutId": "layout",
            "boxAppearance": {
                "opacity": 0.5,
                "iconSpacing": 13
            },
            "layouts": [{
                "id": "layout",
                "name": "Default",
                "canvasWidth": 1920,
                "canvasHeight": 1080,
                "fences": [],
                "iconAssignments": [],
                "createdAt": "",
                "updatedAt": ""
            }]
        });
        let store: DesktopLayoutStore =
            serde_json::from_value(version_two).expect("version two desktop layout store");

        let normalized = normalize_store(store);

        assert_eq!(normalized.box_appearance.icon_spacing, 7);
        assert_eq!(normalized.box_appearance.icon_vertical_spacing, 13);
    }

    #[test]
    fn per_box_appearance_survives_version_four_normalization() {
        let mut first = fence("first", false);
        first.opacity = 0.2;
        first.icon_spacing = 1;
        first.icon_vertical_spacing = 2;
        let mut second = fence("second", false);
        second.opacity = 0.9;
        second.icon_spacing = 31;
        second.icon_vertical_spacing = 30;
        let mut store = default_store();
        store.box_appearance = DesktopBoxAppearance {
            opacity: 0.65,
            icon_spacing: 14,
            icon_vertical_spacing: 19,
        };
        store.layouts[0].fences = vec![first, second];

        let normalized = normalize_store(store);

        assert_eq!(normalized.box_appearance.opacity, 0.65);
        assert_eq!(normalized.box_appearance.icon_spacing, 14);
        assert_eq!(normalized.box_appearance.icon_vertical_spacing, 19);
        assert!((normalized.layouts[0].fences[0].opacity - 0.2).abs() < f32::EPSILON);
        assert_eq!(normalized.layouts[0].fences[0].icon_spacing, 1);
        assert_eq!(normalized.layouts[0].fences[0].icon_vertical_spacing, 2);
        assert!((normalized.layouts[0].fences[1].opacity - 0.9).abs() < f32::EPSILON);
        assert_eq!(normalized.layouts[0].fences[1].icon_spacing, 31);
        assert_eq!(normalized.layouts[0].fences[1].icon_vertical_spacing, 30);
    }

    #[test]
    fn moving_box_snaps_to_work_area_and_neighbour_with_two_pixel_gap() {
        let area = DesktopWorkArea {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1040,
        };
        let target = BoxSnapRect::from_geometry(500, 100, 300, 200);
        let near_left_edge = BoxSnapRect::from_geometry(7, 400, 300, 200);
        let snapped_to_screen = snap_moved_box_rect(near_left_edge, Some(area), &[target], 12, 2);
        assert_eq!(snapped_to_screen.left, 0);

        let near_target = BoxSnapRect::from_geometry(193, 106, 300, 200);
        let snapped_to_target = snap_moved_box_rect(near_target, Some(area), &[target], 12, 2);
        assert_eq!(snapped_to_target.right, target.left - 2);
        assert_eq!(snapped_to_target.top, target.top);
    }

    #[test]
    fn moving_box_outside_threshold_keeps_raw_geometry() {
        let target = BoxSnapRect::from_geometry(500, 100, 300, 200);
        let raw = BoxSnapRect::from_geometry(170, 140, 300, 200);
        assert_eq!(snap_moved_box_rect(raw, None, &[target], 12, 2), raw);
    }

    #[test]
    fn resizing_box_snaps_only_the_active_edges() {
        let target = BoxSnapRect::from_geometry(500, 100, 300, 200);
        let raw = BoxSnapRect::from_geometry(100, 100, 393, 200);
        let edges = BoxResizeEdges::parse("e").expect("east resize edges");
        let snapped = snap_resized_box_rect(raw, edges, 160, 120, None, &[target], 12, 2);
        assert_eq!(snapped.left, raw.left);
        assert_eq!(snapped.right, target.left - 2);
        assert_eq!(snapped.top, raw.top);
        assert_eq!(snapped.bottom, raw.bottom);
    }

    #[test]
    fn moving_icon_assignment_preserves_real_path_and_appends_to_target() {
        let mut source = fence("source", false);
        source.order = 0;
        let mut target = fence("target", false);
        target.order = 1;
        let mut layout = DesktopLayout {
            id: "layout".to_string(),
            name: "layout".to_string(),
            canvas_width: DEFAULT_CANVAS_WIDTH,
            canvas_height: DEFAULT_CANVAS_HEIGHT,
            fences: vec![source, target],
            icon_assignments: vec![
                DesktopIconAssignment {
                    icon_id: "C:\\Users\\test\\Desktop\\demo.lnk".to_string(),
                    label: "demo".to_string(),
                    path: Some("C:\\Users\\test\\Desktop\\demo.lnk".to_string()),
                    shell_id: None,
                    fence_id: "source".to_string(),
                    order: 0,
                    offset_x: Some(10),
                    offset_y: Some(20),
                    native_index: Some(3),
                    original_path: None,
                    managed_file: false,
                },
                DesktopIconAssignment {
                    icon_id: "D:\\reference.txt".to_string(),
                    label: "reference".to_string(),
                    path: Some("D:\\reference.txt".to_string()),
                    shell_id: None,
                    fence_id: "target".to_string(),
                    order: 4,
                    offset_x: None,
                    offset_y: None,
                    native_index: None,
                    original_path: None,
                    managed_file: false,
                },
            ],
            created_at: String::new(),
            updated_at: String::new(),
        };

        move_icon_assignment(
            &mut layout,
            "source",
            "target",
            "C:\\Users\\test\\Desktop\\demo.lnk",
            usize::MAX,
        )
        .expect("move assignment");

        assert!(layout
            .icon_assignments
            .iter()
            .all(|assignment| assignment.fence_id != "source"));
        let moved = layout
            .icon_assignments
            .iter()
            .find(|assignment| assignment.label == "demo")
            .expect("moved assignment");
        assert_eq!(moved.fence_id, "target");
        assert_eq!(moved.order, 1);
        assert_eq!(
            moved.path.as_deref(),
            Some("C:\\Users\\test\\Desktop\\demo.lnk")
        );
        assert_eq!(moved.icon_id, "C:\\Users\\test\\Desktop\\demo.lnk");
        assert_eq!(moved.original_path, None);
        assert!(!moved.managed_file);
        assert_eq!(moved.offset_x, None);
        assert_eq!(moved.offset_y, None);
        assert_eq!(moved.native_index, None);
    }

    #[test]
    fn path_reassignment_marks_source_and_target_boxes_for_refresh() {
        let path = r"C:\Users\test\Desktop\demo.lnk";
        let mut source_assignment = assignment("demo.lnk", "source", 0);
        source_assignment.icon_id = path.to_string();
        source_assignment.path = Some(path.to_string());
        let layout = DesktopLayout {
            id: "layout".to_string(),
            name: "layout".to_string(),
            canvas_width: DEFAULT_CANVAS_WIDTH,
            canvas_height: DEFAULT_CANVAS_HEIGHT,
            fences: vec![fence("source", false), fence("target", false)],
            icon_assignments: vec![source_assignment],
            created_at: String::new(),
            updated_at: String::new(),
        };
        let path_keys = HashSet::from([normalize_path_key(path)]);

        let affected = box_ids_affected_by_path_assignment(&layout, "target", &path_keys);

        assert_eq!(
            affected,
            HashSet::from(["source".to_string(), "target".to_string()])
        );
    }

    #[test]
    fn moving_icon_inside_same_box_reorders_and_normalizes_orders() {
        let mut layout = DesktopLayout {
            id: "layout".to_string(),
            name: "layout".to_string(),
            canvas_width: DEFAULT_CANVAS_WIDTH,
            canvas_height: DEFAULT_CANVAS_HEIGHT,
            fences: vec![fence("box", false)],
            icon_assignments: vec![
                assignment("alpha", "box", 0),
                assignment("beta", "box", 4),
                assignment("gamma", "box", 9),
            ],
            created_at: String::new(),
            updated_at: String::new(),
        };

        move_icon_assignment(&mut layout, "box", "box", "gamma", 0).expect("reorder assignment");

        let ordered = box_view(&layout, &layout.fences[0], None)
            .icons
            .into_iter()
            .map(|item| (item.icon_id, item.order))
            .collect::<Vec<_>>();
        assert_eq!(
            ordered,
            vec![
                ("gamma".to_string(), 0),
                ("alpha".to_string(), 1),
                ("beta".to_string(), 2),
            ]
        );
    }

    #[test]
    fn moving_icon_between_boxes_inserts_at_requested_position() {
        let mut target = fence("target", false);
        target.order = 1;
        let mut layout = DesktopLayout {
            id: "layout".to_string(),
            name: "layout".to_string(),
            canvas_width: DEFAULT_CANVAS_WIDTH,
            canvas_height: DEFAULT_CANVAS_HEIGHT,
            fences: vec![fence("source", false), target],
            icon_assignments: vec![
                assignment("moving", "source", 8),
                assignment("first", "target", 2),
                assignment("last", "target", 7),
            ],
            created_at: String::new(),
            updated_at: String::new(),
        };

        move_icon_assignment(&mut layout, "source", "target", "moving", 1)
            .expect("place assignment");

        let target_fence = layout
            .fences
            .iter()
            .find(|item| item.id == "target")
            .expect("target fence");
        let ordered = box_view(&layout, target_fence, None)
            .icons
            .into_iter()
            .map(|item| (item.icon_id, item.order))
            .collect::<Vec<_>>();
        assert_eq!(
            ordered,
            vec![
                ("first".to_string(), 0),
                ("moving".to_string(), 1),
                ("last".to_string(), 2),
            ]
        );
        assert!(layout
            .icon_assignments
            .iter()
            .all(|item| item.fence_id != "source"));
    }

    #[test]
    fn automatic_name_sort_uses_stable_natural_order() {
        let mut layout = DesktopLayout {
            id: "layout".to_string(),
            name: "layout".to_string(),
            canvas_width: DEFAULT_CANVAS_WIDTH,
            canvas_height: DEFAULT_CANVAS_HEIGHT,
            fences: vec![fence("box", false)],
            icon_assignments: vec![assignment("10", "box", 0), assignment("2", "box", 1)],
            created_at: String::new(),
            updated_at: String::new(),
        };

        sort_box_icon_assignments(&mut layout, "box", DesktopBoxSortMode::NameAscending);

        let ordered = box_view(&layout, &layout.fences[0], None)
            .icons
            .into_iter()
            .map(|item| item.label)
            .collect::<Vec<_>>();
        assert_eq!(ordered, vec!["2".to_string(), "10".to_string()]);
    }

    #[test]
    fn modified_sort_places_items_without_file_time_after_real_files() {
        use std::time::{Duration as StdDuration, UNIX_EPOCH};

        let newest = UNIX_EPOCH + StdDuration::from_secs(2);
        assert_eq!(
            compare_modified_time(Some(newest), None, true),
            std::cmp::Ordering::Less
        );
        assert_eq!(
            compare_modified_time(None, Some(newest), true),
            std::cmp::Ordering::Greater
        );
    }

    #[test]
    fn shell_assignment_identity_survives_json_round_trip() {
        let assignment = DesktopIconAssignment {
            icon_id: "shell:::{645FF040-5081-101B-9F08-00AA002F954E}".to_string(),
            label: "Recycle Bin".to_string(),
            path: None,
            shell_id: Some("::{645FF040-5081-101B-9F08-00AA002F954E}".to_string()),
            fence_id: "box".to_string(),
            order: 0,
            offset_x: None,
            offset_y: None,
            native_index: None,
            original_path: None,
            managed_file: false,
        };

        let json = serde_json::to_string(&assignment).expect("serialize shell assignment");
        let restored: DesktopIconAssignment =
            serde_json::from_str(&json).expect("deserialize shell assignment");
        assert_eq!(restored, assignment);
    }

    #[test]
    fn process_tree_includes_nested_webview_children_only() {
        let processes = vec![(20, 10), (30, 20), (40, 30), (50, 999), (60, 50)];
        let descendants = collect_descendant_process_ids(10, &processes);
        assert_eq!(descendants, HashSet::from([10, 20, 30, 40]));
    }

    #[cfg(windows)]
    #[test]
    fn desktop_box_style_contract_removes_top_level_window_bits() {
        use winapi::um::winuser::{
            SWP_NOCOPYBITS, WS_CAPTION, WS_CHILD, WS_EX_ACCEPTFILES, WS_EX_APPWINDOW,
            WS_EX_TOPMOST, WS_POPUP, WS_SYSMENU, WS_THICKFRAME, WS_VISIBLE,
        };

        let style = normalized_box_window_style(
            WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_VISIBLE,
        );
        let ex_style =
            normalized_box_window_ex_style(WS_EX_APPWINDOW | WS_EX_TOPMOST | WS_EX_ACCEPTFILES);

        assert!(box_window_styles_are_valid(style, ex_style));
        assert_ne!(style & WS_CHILD, 0);
        assert_ne!(style & WS_VISIBLE, 0);
        assert_ne!(ex_style & WS_EX_ACCEPTFILES, 0);
        assert_ne!(box_interactive_geometry_flags() & SWP_NOCOPYBITS, 0);
    }
}
