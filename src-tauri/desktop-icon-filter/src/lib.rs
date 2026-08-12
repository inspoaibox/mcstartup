#![allow(non_snake_case)]

use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{BOOL, HMODULE, HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::Graphics::Gdi::{ClientToScreen, InvalidateRect, ScreenToClient};
use windows::Win32::System::LibraryLoader::{
    GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS, GET_MODULE_HANDLE_EX_FLAG_PIN,
};
use windows::Win32::UI::Controls::{
    CDDS_ITEMPREPAINT, CDDS_PREPAINT, CDRF_NOTIFYITEMDRAW, CDRF_SKIPDEFAULT, LVHITTESTINFO,
    LVIF_TEXT, LVITEMW, LVM_DELETEALLITEMS, LVM_DELETEITEM, LVM_GETITEMCOUNT, LVM_GETITEMTEXTW,
    LVM_GETTOOLTIPS, LVM_HITTEST, LVM_INSERTITEMA, LVM_INSERTITEMW, LVM_SETITEMA, LVM_SETITEMCOUNT,
    LVM_SETITEMTEXTA, LVM_SETITEMTEXTW, LVM_SETITEMW, LVM_SORTITEMS, LVM_SORTITEMSEX,
    LVM_SUBITEMHITTEST, NMHDR, NMLVCUSTOMDRAW, NM_CUSTOMDRAW, TTM_POP, WM_MOUSEHOVER,
    WM_MOUSELEAVE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, CallWindowProcW, EnumWindows, FindWindowExW, FindWindowW, GetWindowLongPtrW,
    IsWindow, KillTimer, PostMessageW, SendMessageW, SetTimer, SetWindowLongPtrW, GWLP_WNDPROC,
    WM_CONTEXTMENU, WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_RBUTTONDBLCLK,
    WM_RBUTTONDOWN, WM_RBUTTONUP, WNDPROC,
};

const CONFIG_FILE: &str = "desktop_box_icon_filter.json";
const CONFIG_VERSION: u32 = 1;
const FILTER_REFRESH_MESSAGE: u32 = 0x8000 + 0x52A;
const FILTER_DETACH_MESSAGE: u32 = 0x8000 + 0x52B;
const FILTER_LEASE_TIMER_ID: usize = 0x4D43_5342;
// The desktop Folder View is on Explorer's GUI thread. Do not refresh more
// frequently than the timer that drives this DLL, and never refresh while the
// ListView is sending a NM_CUSTOMDRAW notification.
const REFRESH_INTERVAL: Duration = Duration::from_secs(1);
const LIST_VIEW_TEXT_CAPACITY: usize = 32_768;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FilterConfig {
    version: u32,
    enabled: bool,
    expires_at_unix_ms: u64,
    #[serde(default)]
    labels: Vec<String>,
}

#[derive(Default)]
struct FilterState {
    folder_view: isize,
    list_view: isize,
    original_proc: isize,
    original_list_proc: isize,
    config_modified: Option<SystemTime>,
    expires_at_unix_ms: u64,
    labels: HashSet<String>,
    hidden_items: HashSet<usize>,
    last_refresh: Option<Instant>,
    refresh_pending: bool,
    pointer_over_hidden_item: bool,
}

#[derive(Clone)]
struct RefreshSnapshot {
    folder_view: isize,
    list_view: isize,
    config_modified: Option<SystemTime>,
    expires_at_unix_ms: u64,
    labels: HashSet<String>,
}

struct RefreshedConfig {
    modified: Option<SystemTime>,
    expires_at_unix_ms: u64,
    labels: HashSet<String>,
    active: bool,
}

struct RefreshPublish {
    invalidate: bool,
    detach: bool,
}

fn state() -> &'static Mutex<FilterState> {
    static STATE: OnceLock<Mutex<FilterState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(FilterState::default()))
}

#[no_mangle]
/// Windows calls this hook only on the Explorer desktop GUI thread.
///
/// # Safety
/// `wparam` and `lparam` must be the values supplied by Windows for the
/// installed hook type; callers must not invoke this export directly.
pub unsafe extern "system" fn McStartUPDesktopIconFilterHook(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code >= 0 && pin_current_module() {
        ensure_folder_view_subclass();
    }
    CallNextHookEx(None, code, wparam, lparam)
}

fn pin_current_module() -> bool {
    static PINNED: OnceLock<bool> = OnceLock::new();
    *PINNED.get_or_init(|| {
        let mut module = HMODULE(0);
        unsafe {
            GetModuleHandleExW(
                GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
                PCWSTR(McStartUPDesktopIconFilterHook as *const () as *const u16),
                &mut module,
            )
            .is_ok()
                && module.0 != 0
        }
    })
}

unsafe extern "system" fn folder_view_wndproc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        FILTER_REFRESH_MESSAGE => {
            clear_refresh_pending();
            refresh_and_invalidate(true);
            return LRESULT(0);
        }
        FILTER_DETACH_MESSAGE => {
            detach_folder_view_subclass(hwnd);
            return LRESULT(0);
        }
        0x0113 if wparam.0 == FILTER_LEASE_TIMER_ID => {
            refresh_and_invalidate(false);
            return LRESULT(0);
        }
        0x004E => {
            if let Some(result) = handle_custom_draw(lparam) {
                return result;
            }
        }
        _ => {}
    }
    call_original_proc(hwnd, message, wparam, lparam)
}

unsafe extern "system" fn list_view_wndproc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if matches!(message, LVM_HITTEST | LVM_SUBITEMHITTEST) {
        return mask_hidden_hit_test(hwnd, message, wparam, lparam);
    }

    if matches!(message, WM_MOUSEMOVE | WM_MOUSEHOVER) {
        if hidden_item_at_client_point(hwnd, point_from_lparam(lparam)) {
            if mark_pointer_over_hidden_item(true) {
                dismiss_list_view_tooltip(hwnd);
            }
            return LRESULT(0);
        }
        mark_pointer_over_hidden_item(false);
    } else if message == WM_MOUSELEAVE && mark_pointer_over_hidden_item(false) {
        dismiss_list_view_tooltip(hwnd);
    }

    if message == WM_RBUTTONUP && hidden_item_at_client_point(hwnd, point_from_lparam(lparam)) {
        dismiss_list_view_tooltip(hwnd);
        return forward_background_context_menu(hwnd, lparam);
    }

    if message == WM_CONTEXTMENU && hidden_item_at_screen_point(hwnd, lparam) {
        dismiss_list_view_tooltip(hwnd);
        return forward_background_context_menu_screen(hwnd, lparam);
    }

    if input_message_targets_hidden_item(hwnd, message, lparam) {
        // The assignment stays in the actual Desktop folder, so Explorer and
        // file dialogs can enumerate it. Only the desktop ListView is made
        // non-interactive at the hidden item's original coordinates.
        return LRESULT(0);
    }
    let result = call_original_list_view_proc(hwnd, message, wparam, lparam);
    if is_list_view_structure_message(message) {
        queue_filter_refresh();
    }
    result
}

fn handle_custom_draw(lparam: LPARAM) -> Option<LRESULT> {
    if lparam.0 == 0 {
        return None;
    }
    let header = unsafe { &*(lparam.0 as *const NMHDR) };
    if header.code != NM_CUSTOMDRAW {
        return None;
    }

    let list_view = state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .list_view;
    if list_view == 0 || header.hwndFrom.0 != list_view {
        return None;
    }

    let draw = unsafe { &*(lparam.0 as *const NMLVCUSTOMDRAW) };
    if draw.nmcd.dwDrawStage == CDDS_PREPAINT {
        // Explorer is currently painting this ListView. Calling LVM_GETITEM*
        // here synchronously re-enters the Folder View window procedure and
        // can deadlock Explorer. The timer refreshes this cache separately.
        return Some(LRESULT(CDRF_NOTIFYITEMDRAW as isize));
    }
    if draw.nmcd.dwDrawStage == CDDS_ITEMPREPAINT
        && state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .hidden_items
            .contains(&draw.nmcd.dwItemSpec)
    {
        return Some(LRESULT(CDRF_SKIPDEFAULT as isize));
    }
    None
}

fn ensure_folder_view_subclass() {
    let attached_folder_view = state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .folder_view;
    if attached_folder_view != 0 && unsafe { IsWindow(HWND(attached_folder_view)).as_bool() } {
        return;
    }

    let Some(folder_view) = find_desktop_folder_view() else {
        return;
    };
    let Some(list_view) = find_desktop_list_view(folder_view) else {
        return;
    };
    let original_list_proc = unsafe { GetWindowLongPtrW(list_view, GWLP_WNDPROC) };
    if original_list_proc == 0 {
        return;
    }
    let replaced_list_proc = unsafe {
        SetWindowLongPtrW(
            list_view,
            GWLP_WNDPROC,
            list_view_wndproc as *const () as usize as isize,
        )
    };
    if replaced_list_proc == 0 {
        return;
    }

    let original_proc = unsafe { GetWindowLongPtrW(folder_view, GWLP_WNDPROC) };
    if original_proc == 0 {
        unsafe {
            let _ = SetWindowLongPtrW(list_view, GWLP_WNDPROC, original_list_proc);
        }
        return;
    }
    let replaced_folder_proc = unsafe {
        SetWindowLongPtrW(
            folder_view,
            GWLP_WNDPROC,
            folder_view_wndproc as *const () as usize as isize,
        )
    };
    if replaced_folder_proc == 0 {
        unsafe {
            let _ = SetWindowLongPtrW(list_view, GWLP_WNDPROC, original_list_proc);
        }
        return;
    }
    {
        let mut guard = state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = FilterState {
            folder_view: folder_view.0,
            list_view: list_view.0,
            original_proc: replaced_folder_proc,
            original_list_proc: replaced_list_proc,
            ..Default::default()
        };
    }
    let _ = unsafe { SetTimer(folder_view, FILTER_LEASE_TIMER_ID, 1_000, None) };
    refresh_and_invalidate(true);
}

fn detach_folder_view_subclass(hwnd: HWND) {
    let (original_proc, list_view, original_list_proc) = {
        let mut guard = state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.folder_view != hwnd.0 || guard.original_proc == 0 {
            return;
        }
        let original_proc = guard.original_proc;
        let list_view = guard.list_view;
        let original_list_proc = guard.original_list_proc;
        *guard = FilterState::default();
        (original_proc, list_view, original_list_proc)
    };
    unsafe {
        let _ = KillTimer(hwnd, FILTER_LEASE_TIMER_ID);
        if list_view != 0 && original_list_proc != 0 && IsWindow(HWND(list_view)).as_bool() {
            let _ = SetWindowLongPtrW(HWND(list_view), GWLP_WNDPROC, original_list_proc);
        }
        let _ = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, original_proc);
        if list_view != 0 {
            let _ = InvalidateRect(HWND(list_view), None, BOOL(1));
        }
    }
}

fn call_original_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let original_proc = state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .original_proc;
    call_window_proc(original_proc, hwnd, message, wparam, lparam)
}

fn call_original_list_view_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let original_proc = state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .original_list_proc;
    call_window_proc(original_proc, hwnd, message, wparam, lparam)
}

fn call_window_proc(
    original_proc: isize,
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if original_proc == 0 {
        return LRESULT(0);
    }
    let proc: WNDPROC = unsafe { std::mem::transmute(original_proc) };
    unsafe { CallWindowProcW(proc, hwnd, message, wparam, lparam) }
}

fn mask_hidden_hit_test(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let result = call_original_list_view_proc(hwnd, message, wparam, lparam);
    if lparam.0 == 0 {
        return result;
    }
    let hit = unsafe { &mut *(lparam.0 as *mut LVHITTESTINFO) };
    if hit.iItem >= 0 && hidden_items_contains(hit.iItem as usize) {
        hit.iItem = -1;
        hit.iSubItem = 0;
        return LRESULT(-1);
    }
    result
}

fn hidden_items_contains(index: usize) -> bool {
    state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .hidden_items
        .contains(&index)
}

fn mark_pointer_over_hidden_item(value: bool) -> bool {
    let mut guard = state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let changed = guard.pointer_over_hidden_item != value;
    guard.pointer_over_hidden_item = value;
    changed
}

fn dismiss_list_view_tooltip(list_view: HWND) {
    let tooltip = HWND(unsafe { SendMessageW(list_view, LVM_GETTOOLTIPS, WPARAM(0), LPARAM(0)).0 });
    if tooltip.0 != 0 && unsafe { IsWindow(tooltip).as_bool() } {
        unsafe {
            SendMessageW(tooltip, TTM_POP, WPARAM(0), LPARAM(0));
        }
    }
}

fn forward_background_context_menu(list_view: HWND, client_lparam: LPARAM) -> LRESULT {
    let mut point = point_from_lparam(client_lparam);
    if !unsafe { ClientToScreen(list_view, &mut point).as_bool() } {
        return LRESULT(0);
    }
    forward_background_context_menu_screen(list_view, point_to_lparam(point))
}

fn forward_background_context_menu_screen(list_view: HWND, screen_lparam: LPARAM) -> LRESULT {
    let folder_view = state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .folder_view;
    if folder_view == 0 {
        return LRESULT(0);
    }
    // The Folder View asks its child ListView which item is under the cursor.
    // Our LVM_HITTEST handler reports a hidden item as empty, so Explorer
    // builds its native desktop-background menu at the real cursor position.
    call_original_proc(
        HWND(folder_view),
        WM_CONTEXTMENU,
        WPARAM(list_view.0 as usize),
        screen_lparam,
    )
}

fn point_to_lparam(point: POINT) -> LPARAM {
    let x = point.x as i16 as u16 as u32;
    let y = point.y as i16 as u16 as u32;
    LPARAM(((y << 16) | x) as isize)
}

fn is_list_view_structure_message(message: u32) -> bool {
    matches!(
        message,
        LVM_DELETEALLITEMS
            | LVM_DELETEITEM
            | LVM_INSERTITEMA
            | LVM_INSERTITEMW
            | LVM_SETITEMA
            | LVM_SETITEMW
            | LVM_SETITEMCOUNT
            | LVM_SETITEMTEXTA
            | LVM_SETITEMTEXTW
            | LVM_SORTITEMS
            | LVM_SORTITEMSEX
    )
}

fn queue_filter_refresh() {
    let folder_view = {
        let mut guard = state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.folder_view == 0 || guard.refresh_pending {
            return;
        }
        guard.refresh_pending = true;
        guard.folder_view
    };
    if unsafe {
        PostMessageW(
            HWND(folder_view),
            FILTER_REFRESH_MESSAGE,
            WPARAM(0),
            LPARAM(0),
        )
    }
    .is_err()
    {
        clear_refresh_pending();
    }
}

fn clear_refresh_pending() {
    state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .refresh_pending = false;
}

fn input_message_targets_hidden_item(hwnd: HWND, message: u32, lparam: LPARAM) -> bool {
    match message {
        WM_LBUTTONDOWN | WM_LBUTTONUP | WM_LBUTTONDBLCLK | WM_RBUTTONDOWN | WM_RBUTTONUP
        | WM_RBUTTONDBLCLK => hidden_item_at_client_point(hwnd, point_from_lparam(lparam)),
        WM_CONTEXTMENU => hidden_item_at_screen_point(hwnd, lparam),
        _ => false,
    }
}

fn hidden_item_at_screen_point(list_view: HWND, lparam: LPARAM) -> bool {
    let mut point = point_from_lparam(lparam);
    // A keyboard-invoked context menu uses (-1, -1), which has no desktop
    // coordinate. It must retain Explorer's standard keyboard behavior.
    if is_keyboard_context_menu_point(point) {
        return false;
    }
    if !unsafe { ScreenToClient(list_view, &mut point).as_bool() } {
        return false;
    }
    hidden_item_at_client_point(list_view, point)
}

fn hidden_item_at_client_point(list_view: HWND, point: POINT) -> bool {
    if !unsafe { IsWindow(list_view).as_bool() } {
        return false;
    }
    let mut hit = LVHITTESTINFO {
        pt: point,
        iItem: -1,
        ..Default::default()
    };
    // This helper is called from our ListView subclass. Invoke the original
    // procedure directly so our public LVM_HITTEST masking does not recurse
    // or hide the item before we decide which input policy applies.
    let index = call_original_list_view_proc(
        list_view,
        LVM_HITTEST,
        WPARAM(0),
        LPARAM((&mut hit as *mut LVHITTESTINFO) as isize),
    )
    .0;
    if index < 0 {
        return false;
    }
    state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .hidden_items
        .contains(&(index as usize))
}

fn point_from_lparam(lparam: LPARAM) -> POINT {
    let raw = lparam.0 as u32;
    POINT {
        x: (raw as u16 as i16) as i32,
        y: ((raw >> 16) as u16 as i16) as i32,
    }
}

fn is_keyboard_context_menu_point(point: POINT) -> bool {
    point.x == -1 && point.y == -1
}

fn refresh_and_invalidate(force: bool) {
    let Some(snapshot) = begin_refresh(force) else {
        return;
    };

    // These operations may enter Explorer's ListView window procedure. The
    // shared state mutex must remain unlocked until the complete replacement
    // cache is ready to publish.
    let config = read_config(&snapshot);
    let hidden_items = collect_hidden_items(HWND(snapshot.list_view), &config.labels);
    let publish = publish_refresh(&snapshot, config, hidden_items);
    if publish.invalidate {
        dismiss_list_view_tooltip(HWND(snapshot.list_view));
        unsafe {
            let _ = InvalidateRect(HWND(snapshot.list_view), None, BOOL(1));
        }
    }
    if publish.detach {
        // A host may have exited without first unhooking us. Once its lease
        // expires, restore Explorer's original procedure from inside the
        // still-pinned DLL before any future message can reach stale code.
        detach_folder_view_subclass(HWND(snapshot.folder_view));
    }
}

fn begin_refresh(force: bool) -> Option<RefreshSnapshot> {
    let mut guard = state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if guard.folder_view == 0 || guard.list_view == 0 {
        return None;
    }
    if !force
        && guard
            .last_refresh
            .is_some_and(|last_refresh| last_refresh.elapsed() < REFRESH_INTERVAL)
    {
        return None;
    }
    guard.last_refresh = Some(Instant::now());
    Some(RefreshSnapshot {
        folder_view: guard.folder_view,
        list_view: guard.list_view,
        config_modified: guard.config_modified,
        expires_at_unix_ms: guard.expires_at_unix_ms,
        labels: guard.labels.clone(),
    })
}

fn read_config(snapshot: &RefreshSnapshot) -> RefreshedConfig {
    let modified = fs::metadata(config_path())
        .and_then(|metadata| metadata.modified())
        .ok();
    if snapshot.config_modified == modified && snapshot.expires_at_unix_ms > unix_time_millis() {
        return RefreshedConfig {
            modified,
            expires_at_unix_ms: snapshot.expires_at_unix_ms,
            labels: snapshot.labels.clone(),
            active: !snapshot.labels.is_empty(),
        };
    }

    let mut refreshed = RefreshedConfig {
        modified,
        expires_at_unix_ms: 0,
        labels: HashSet::new(),
        active: false,
    };
    let Ok(content) = fs::read_to_string(config_path()) else {
        return refreshed;
    };
    let Ok(config) = serde_json::from_str::<FilterConfig>(&content) else {
        return refreshed;
    };
    if config.version != CONFIG_VERSION
        || !config.enabled
        || config.expires_at_unix_ms <= unix_time_millis()
    {
        return refreshed;
    }
    refreshed.expires_at_unix_ms = config.expires_at_unix_ms;
    refreshed.labels = config
        .labels
        .into_iter()
        .map(|label| normalize_label(&label))
        .filter(|label| !label.is_empty())
        .collect();
    refreshed.active = !refreshed.labels.is_empty();
    refreshed
}

fn collect_hidden_items(list_view: HWND, labels: &HashSet<String>) -> HashSet<usize> {
    if labels.is_empty() || !unsafe { IsWindow(list_view).as_bool() } {
        return HashSet::new();
    }
    let count = unsafe { SendMessageW(list_view, LVM_GETITEMCOUNT, WPARAM(0), LPARAM(0)).0 };
    if count <= 0 {
        return HashSet::new();
    }
    let mut labels_by_index = Vec::new();
    let mut counts = HashMap::<String, usize>::new();
    let mut text = vec![0u16; LIST_VIEW_TEXT_CAPACITY];
    for index in 0..count as usize {
        let Some(label) = list_view_item_label(list_view, index, &mut text) else {
            continue;
        };
        *counts.entry(label.clone()).or_default() += 1;
        labels_by_index.push((index, label));
    }
    let mut hidden_items = HashSet::new();
    for (index, label) in labels_by_index {
        if labels.contains(&label) && counts.get(&label) == Some(&1) {
            hidden_items.insert(index);
        }
    }
    hidden_items
}

fn publish_refresh(
    snapshot: &RefreshSnapshot,
    config: RefreshedConfig,
    hidden_items: HashSet<usize>,
) -> RefreshPublish {
    let mut guard = state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if guard.folder_view != snapshot.folder_view || guard.list_view != snapshot.list_view {
        return RefreshPublish {
            invalidate: false,
            detach: false,
        };
    }
    let changed = guard.hidden_items != hidden_items;
    let detach = !config.active;
    guard.config_modified = config.modified;
    guard.expires_at_unix_ms = config.expires_at_unix_ms;
    guard.labels = config.labels;
    guard.hidden_items = hidden_items;
    RefreshPublish {
        // A forced refresh bypasses the throttle, but must not repaint an
        // unchanged ListView. Repainting every heartbeat is what made hidden
        // desktop items flash during Explorer refreshes.
        invalidate: changed,
        detach,
    }
}

fn list_view_item_label(list_view: HWND, index: usize, text: &mut [u16]) -> Option<String> {
    text.fill(0);
    let mut item = LVITEMW {
        mask: LVIF_TEXT,
        iItem: index as i32,
        iSubItem: 0,
        pszText: windows::core::PWSTR(text.as_mut_ptr()),
        cchTextMax: text.len() as i32,
        ..Default::default()
    };
    let length = unsafe {
        SendMessageW(
            list_view,
            LVM_GETITEMTEXTW,
            WPARAM(index),
            LPARAM((&mut item as *mut LVITEMW) as isize),
        )
        .0
    };
    if length <= 0 {
        return None;
    }
    Some(normalize_label(&String::from_utf16_lossy(
        &text[..(length as usize).min(text.len())],
    )))
}

fn find_desktop_folder_view() -> Option<HWND> {
    let progman = unsafe { FindWindowW(wide("Progman"), PCWSTR::null()) };
    if progman.0 != 0 {
        let folder_view =
            unsafe { FindWindowExW(progman, HWND(0), wide("SHELLDLL_DefView"), PCWSTR::null()) };
        if folder_view.0 != 0 {
            return Some(folder_view);
        }
    }

    let mut folder_view = HWND(0);
    unsafe {
        let _ = EnumWindows(
            Some(find_folder_view_in_worker_window),
            LPARAM((&mut folder_view as *mut HWND) as isize),
        );
    }
    (folder_view.0 != 0).then_some(folder_view)
}

unsafe extern "system" fn find_folder_view_in_worker_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let result = lparam.0 as *mut HWND;
    if result.is_null() || (!window_class_is(hwnd, "WorkerW") && !window_class_is(hwnd, "Progman"))
    {
        return BOOL(1);
    }
    let folder_view = FindWindowExW(hwnd, HWND(0), wide("SHELLDLL_DefView"), PCWSTR::null());
    if folder_view.0 == 0 {
        BOOL(1)
    } else {
        *result = folder_view;
        BOOL(0)
    }
}

fn find_desktop_list_view(folder_view: HWND) -> Option<HWND> {
    let list_view =
        unsafe { FindWindowExW(folder_view, HWND(0), wide("SysListView32"), PCWSTR::null()) };
    (list_view.0 != 0).then_some(list_view)
}

fn window_class_is(hwnd: HWND, expected: &str) -> bool {
    let mut class_name = [0u16; 64];
    let length =
        unsafe { windows::Win32::UI::WindowsAndMessaging::GetClassNameW(hwnd, &mut class_name) };
    length > 0
        && String::from_utf16_lossy(&class_name[..length as usize]).eq_ignore_ascii_case(expected)
}

fn config_path() -> std::path::PathBuf {
    std::env::var_os("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_default()
        .join("McStartUP")
        .join(CONFIG_FILE)
}

fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn normalize_label(value: &str) -> String {
    value.trim().to_lowercase()
}

fn wide(value: &str) -> PCWSTR {
    thread_local! {
        static BUFFER: std::cell::RefCell<Vec<u16>> = const { std::cell::RefCell::new(Vec::new()) };
    }
    BUFFER.with(|buffer| {
        let mut buffer = buffer.borrow_mut();
        buffer.clear();
        buffer.extend(value.encode_utf16());
        buffer.push(0);
        PCWSTR(buffer.as_ptr())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn point_from_lparam_preserves_signed_screen_coordinates() {
        let lparam = LPARAM((((-240i16 as u16 as u32) << 16) | (120i16 as u16 as u32)) as isize);
        assert_eq!(point_from_lparam(lparam), POINT { x: 120, y: -240 });
    }

    #[test]
    fn keyboard_context_menu_has_no_screen_coordinate() {
        assert!(is_keyboard_context_menu_point(POINT { x: -1, y: -1 }));
        assert!(!is_keyboard_context_menu_point(POINT { x: 0, y: 0 }));
    }

    #[test]
    fn client_context_point_round_trips_to_screen_message_coordinates() {
        let point = POINT { x: -320, y: 1440 };
        assert_eq!(point_from_lparam(point_to_lparam(point)), point);
    }

    #[test]
    fn list_view_structure_changes_schedule_hidden_index_refresh() {
        assert!(is_list_view_structure_message(LVM_INSERTITEMW));
        assert!(is_list_view_structure_message(LVM_DELETEITEM));
        assert!(is_list_view_structure_message(LVM_SORTITEMSEX));
        assert!(!is_list_view_structure_message(LVM_HITTEST));
    }
}
