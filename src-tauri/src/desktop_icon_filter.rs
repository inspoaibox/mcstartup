use crate::desktop_layouts::{DesktopIconAssignment, DesktopLayoutStore};
use crate::storage::Storage;
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const CONFIG_FILE: &str = "desktop_box_icon_filter.json";
const CONFIG_VERSION: u32 = 1;
const LEASE_DURATION: Duration = Duration::from_secs(15);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IconFilterConfig {
    version: u32,
    enabled: bool,
    expires_at_unix_ms: u64,
    labels: Vec<String>,
}

pub fn sync_from_store(store: &DesktopLayoutStore) -> Result<(), String> {
    let labels = filter_labels(store);
    let config = IconFilterConfig {
        version: CONFIG_VERSION,
        enabled: !labels.is_empty(),
        expires_at_unix_ms: unix_time_millis().saturating_add(LEASE_DURATION.as_millis() as u64),
        labels: labels.into_iter().collect(),
    };
    write_config(&config)?;

    #[cfg(windows)]
    {
        if config.enabled {
            ensure_attached()?;
        } else {
            detach();
        }
    }
    Ok(())
}

pub fn sync_from_disk() -> Result<(), String> {
    let store = crate::desktop_layouts::desktop_layout_get_store()?;
    sync_from_store(&store)
}

pub fn disable() {
    let config = IconFilterConfig {
        version: CONFIG_VERSION,
        enabled: false,
        expires_at_unix_ms: unix_time_millis(),
        labels: Vec::new(),
    };
    if let Err(error) = write_config(&config) {
        eprintln!("[DesktopIconFilter] disable config write failed: {}", error);
    }
    #[cfg(windows)]
    detach();
}

pub fn start_lease_monitor() {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(5));
        if let Err(error) = sync_from_disk() {
            eprintln!("[DesktopIconFilter] lease refresh failed: {}", error);
        }
    });
}

fn filter_labels(store: &DesktopLayoutStore) -> BTreeSet<String> {
    let Some(active_layout_id) = store.active_layout_id.as_deref() else {
        return BTreeSet::new();
    };
    let Some(layout) = store
        .layouts
        .iter()
        .find(|layout| layout.id == active_layout_id)
    else {
        return BTreeSet::new();
    };
    let visible_box_ids = layout
        .fences
        .iter()
        .filter(|fence| !fence.hidden)
        .map(|fence| fence.id.as_str())
        .collect::<BTreeSet<_>>();
    layout
        .icon_assignments
        .iter()
        .filter(|assignment| visible_box_ids.contains(assignment.fence_id.as_str()))
        .filter(|assignment| assignment_is_desktop_candidate(assignment))
        .flat_map(assignment_label_candidates)
        .filter(|label| !label.is_empty())
        .collect()
}

fn assignment_label_candidates(assignment: &DesktopIconAssignment) -> Vec<String> {
    let mut labels = BTreeSet::new();
    labels.insert(normalize_label(&assignment.label));
    if let Some(path) = assignment.path.as_deref() {
        let path = Path::new(path);
        if let Some(file_name) = path.file_name().and_then(|name| name.to_str()) {
            labels.insert(normalize_label(file_name));
        }
        if let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) {
            labels.insert(normalize_label(stem));
        }
    }
    labels.into_iter().collect()
}

fn assignment_is_desktop_candidate(assignment: &DesktopIconAssignment) -> bool {
    assignment.shell_id.is_some() || assignment.path.as_deref().is_some_and(is_desktop_path)
}

fn is_desktop_path(path: &str) -> bool {
    let path = Path::new(path);
    let Some(parent) = path.parent() else {
        return false;
    };
    let parent = normalize_path(parent);
    let mut desktop_directories = Vec::new();
    if let Some(directory) = dirs::desktop_dir() {
        desktop_directories.push(directory);
    }
    if let Ok(public) = std::env::var("PUBLIC") {
        desktop_directories.push(PathBuf::from(public).join("Desktop"));
    }
    desktop_directories
        .iter()
        .any(|directory| normalize_path(directory) == parent)
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy()
        .trim()
        .trim_matches('"')
        .replace('/', "\\")
        .to_lowercase()
}

fn normalize_label(value: &str) -> String {
    value.trim().to_lowercase()
}

fn config_path() -> Result<PathBuf, String> {
    Storage::get_config_dir()
        .map(|directory| directory.join(CONFIG_FILE))
        .map_err(|error| error.to_string())
}

fn write_config(config: &IconFilterConfig) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create icon filter directory: {}", error))?;
    }
    let content = serde_json::to_string(config)
        .map_err(|error| format!("serialize icon filter config: {}", error))?;
    let temp = path.with_file_name(format!(
        ".desktop_box_icon_filter.{}.tmp",
        uuid::Uuid::new_v4()
    ));
    let write_result = (|| -> Result<(), String> {
        let mut file = File::create(&temp)
            .map_err(|error| format!("create icon filter temp config: {}", error))?;
        file.write_all(content.as_bytes())
            .map_err(|error| format!("write icon filter config: {}", error))?;
        file.sync_all()
            .map_err(|error| format!("sync icon filter config: {}", error))?;
        drop(file);
        replace_file(&temp, &path)
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    write_result
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
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
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(format!(
            "replace icon filter config: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination)
        .map_err(|error| format!("replace icon filter config: {}", error))
}

fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

#[cfg(windows)]
const FILTER_REFRESH_MESSAGE: u32 = 0x8000 + 0x52A;
#[cfg(windows)]
const FILTER_DETACH_MESSAGE: u32 = 0x8000 + 0x52B;
#[cfg(windows)]
const FILTER_DETACH_TIMEOUT_MS: u32 = 1_000;

#[cfg(windows)]
struct ExplorerFilterRuntime {
    library: libloading::os::windows::Library,
    hook: windows::Win32::UI::WindowsAndMessaging::HHOOK,
    desktop_thread_id: u32,
    folder_view: isize,
}

#[cfg(windows)]
fn runtime() -> &'static Mutex<Option<ExplorerFilterRuntime>> {
    static RUNTIME: OnceLock<Mutex<Option<ExplorerFilterRuntime>>> = OnceLock::new();
    RUNTIME.get_or_init(|| Mutex::new(None))
}

#[cfg(windows)]
fn ensure_attached() -> Result<(), String> {
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowThreadProcessId, PostThreadMessageW, SetWindowsHookExW, WINDOWS_HOOK_ID,
    };

    let folder_view = crate::desktop_layouts::desktop_box_shell_host()
        .ok_or_else(|| "Explorer desktop folder view is unavailable".to_string())?;
    let thread_id = unsafe { GetWindowThreadProcessId(HWND(folder_view), None) };
    if thread_id == 0 {
        return Err("Explorer desktop thread is unavailable".to_string());
    }

    let mut runtime = runtime()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if runtime.as_ref().is_some_and(|current| {
        current.folder_view == folder_view && current.desktop_thread_id == thread_id
    }) {
        unsafe {
            let _ = windows::Win32::UI::WindowsAndMessaging::PostMessageW(
                HWND(folder_view),
                FILTER_REFRESH_MESSAGE,
                WPARAM(0),
                LPARAM(0),
            );
        }
        return Ok(());
    }
    detach_locked(&mut runtime)?;
    // A prior McStartUP process can have stopped without unhooking the DLL.
    // Ask the currently installed desktop procedure to restore itself before
    // installing this process's copy. The message is harmless when no filter
    // is present and has a timeout so Explorer cannot block startup.
    request_explorer_filter_detach(folder_view)?;

    let path = filter_dll_path().ok_or_else(|| {
        "McStartUP desktop icon filter DLL was not found. Build the native extension first."
            .to_string()
    })?;
    let library = unsafe { libloading::os::windows::Library::new(&path) }
        .map_err(|error| format!("load desktop icon filter DLL: {}", error))?;
    type ExplorerHookProc =
        unsafe extern "system" fn(i32, WPARAM, LPARAM) -> windows::Win32::Foundation::LRESULT;
    let hook_proc = unsafe {
        let symbol = library
            .get::<ExplorerHookProc>(b"McStartUPDesktopIconFilterHook\0")
            .map_err(|error| format!("load desktop icon filter hook: {}", error))?;
        *symbol
    };
    let module = library.into_raw();
    let library = unsafe { libloading::os::windows::Library::from_raw(module) };
    let hook = unsafe {
        SetWindowsHookExW(
            WINDOWS_HOOK_ID(3),
            Some(hook_proc),
            HINSTANCE(module as isize),
            thread_id,
        )
    }
    .map_err(|error| format!("install Explorer icon filter hook: {}", error))?;
    *runtime = Some(ExplorerFilterRuntime {
        library,
        hook,
        desktop_thread_id: thread_id,
        folder_view,
    });
    unsafe {
        PostThreadMessageW(thread_id, 0, WPARAM(0), LPARAM(0))
            .map_err(|error| format!("activate Explorer icon filter hook: {}", error))?;
    }
    Ok(())
}

#[cfg(windows)]
fn detach() {
    let mut runtime = runtime()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Err(error) = detach_locked(&mut runtime) {
        eprintln!("[DesktopIconFilter] detach skipped: {}", error);
    }
}

#[cfg(windows)]
fn detach_locked(runtime: &mut Option<ExplorerFilterRuntime>) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::UnhookWindowsHookEx;

    let Some(current) = runtime.take() else {
        return Ok(());
    };
    if let Err(error) = request_explorer_filter_detach(current.folder_view) {
        // The Explorer-side window procedure still points into this DLL. Keep
        // the hook and library alive rather than unloading executable code
        // from a process that did not acknowledge the detach request.
        *runtime = Some(current);
        return Err(error);
    }
    if let Err(error) = unsafe { UnhookWindowsHookEx(current.hook) } {
        // The window procedure is restored, but the hook callback may still
        // reference this module. Keep both alive until a later detach can
        // complete instead of unloading executable code prematurely.
        *runtime = Some(current);
        return Err(format!("unhook Explorer icon filter: {}", error));
    }
    drop(current.library);
    Ok(())
}

#[cfg(windows)]
fn request_explorer_filter_detach(folder_view: isize) -> Result<(), String> {
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, SMTO_ABORTIFHUNG};

    let mut message_result = 0usize;
    let delivered = unsafe {
        SendMessageTimeoutW(
            HWND(folder_view),
            FILTER_DETACH_MESSAGE,
            WPARAM(0),
            LPARAM(0),
            SMTO_ABORTIFHUNG,
            FILTER_DETACH_TIMEOUT_MS,
            Some(&mut message_result),
        )
        .0
    };
    if delivered == 0 {
        return Err(
            "Explorer desktop thread did not acknowledge icon-filter detach within 1 second"
                .to_string(),
        );
    }
    Ok(())
}

#[cfg(windows)]
fn filter_dll_path() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    let executable_dir = executable.parent()?;
    let directories = [
        executable_dir.to_path_buf(),
        executable_dir.join("resources"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"),
    ];
    let mut candidates = Vec::<(SystemTime, u8, PathBuf)>::new();
    for directory in directories {
        let priority = u8::from(directory == executable_dir);
        add_dll_candidate(
            &mut candidates,
            directory.join("McStartUPDesktopIconFilter.dll"),
            priority,
        );
        if let Ok(entries) = fs::read_dir(&directory) {
            for entry in entries.flatten() {
                let path = entry.path();
                let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                    continue;
                };
                if name.starts_with("McStartUPDesktopIconFilter.")
                    && name.to_ascii_lowercase().ends_with(".dll")
                {
                    add_dll_candidate(&mut candidates, path, priority.saturating_add(1));
                }
            }
        }
    }
    if candidates
        .iter()
        .any(|(_, _, path)| path.parent() == Some(executable_dir))
    {
        candidates.retain(|(_, _, path)| path.parent() == Some(executable_dir));
    }
    candidates.sort_by(|left, right| right.cmp(left));
    candidates.into_iter().next().map(|(_, _, path)| path)
}

#[cfg(windows)]
fn add_dll_candidate(candidates: &mut Vec<(SystemTime, u8, PathBuf)>, path: PathBuf, priority: u8) {
    if !path.is_file() {
        return;
    }
    let modified = fs::metadata(&path)
        .and_then(|metadata| metadata.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    candidates.push((modified, priority, path));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop_layouts::{DesktopFence, DesktopLayout};

    fn store_with(active_box_hidden: bool, inactive_box_hidden: bool) -> DesktopLayoutStore {
        DesktopLayoutStore {
            version: 4,
            active_layout_id: Some("active".to_string()),
            box_appearance: Default::default(),
            layouts: vec![
                DesktopLayout {
                    id: "active".to_string(),
                    name: "active".to_string(),
                    canvas_width: 100,
                    canvas_height: 100,
                    fences: vec![fence("box", active_box_hidden)],
                    icon_assignments: vec![shell_assignment("This PC", "box")],
                    created_at: "now".to_string(),
                    updated_at: "now".to_string(),
                },
                DesktopLayout {
                    id: "inactive".to_string(),
                    name: "inactive".to_string(),
                    canvas_width: 100,
                    canvas_height: 100,
                    fences: vec![fence("inactive-box", inactive_box_hidden)],
                    icon_assignments: vec![shell_assignment("Recycle Bin", "inactive-box")],
                    created_at: "now".to_string(),
                    updated_at: "now".to_string(),
                },
            ],
        }
    }

    fn fence(id: &str, hidden: bool) -> DesktopFence {
        DesktopFence {
            id: id.to_string(),
            name: id.to_string(),
            x: 0,
            y: 0,
            width: 160,
            height: 120,
            color: "#000000".to_string(),
            view_mode: "grid".to_string(),
            sort_mode: "manual".to_string(),
            opacity: 1.0,
            background_color: "#000000".to_string(),
            icon_spacing: 0,
            icon_vertical_spacing: 0,
            collapsed: false,
            hidden,
            order: 0,
        }
    }

    fn shell_assignment(label: &str, fence_id: &str) -> DesktopIconAssignment {
        DesktopIconAssignment {
            icon_id: format!("shell:{}", label),
            label: label.to_string(),
            path: None,
            shell_id: Some(format!("::{{{}}}", label)),
            fence_id: fence_id.to_string(),
            order: 0,
            offset_x: None,
            offset_y: None,
            native_index: None,
            original_path: None,
            managed_file: false,
        }
    }

    #[test]
    fn only_active_visible_box_assignments_enter_filter_config() {
        let labels = filter_labels(&store_with(false, false));
        assert_eq!(labels, BTreeSet::from(["this pc".to_string()]));
    }

    #[test]
    fn hidden_box_assignments_remain_visible_in_explorer() {
        let labels = filter_labels(&store_with(true, false));
        assert!(labels.is_empty());
    }
}
