use crate::cursor_position::{get_cursor_position, get_screen_info};
use crate::text_selection::{get_selected_text_via_uia, UiaFailureKind, UiaSelectionError};
use crate::translate::translate;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;
use tauri::Manager;

static WORD_SELECTION_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
static WORD_SELECTION_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordSelectionTranslateSettings {
    pub provider: String,
    pub from_lang: String,
    pub to_lang: String,
    pub auto_detect_language: bool,
    pub auto_copy: bool,
    pub translate_config: crate::translate::TranslateConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TranslateEvent {
    #[serde(rename = "loading")]
    Loading { request_id: u64 },
    #[serde(rename = "success")]
    Success {
        request_id: u64,
        original_text: String,
        translated_text: String,
        from_lang: String,
        to_lang: String,
        copied_to_clipboard: bool,
    },
    #[serde(rename = "error")]
    Error {
        request_id: u64,
        error: String,
        error_code: String,
    },
}

#[derive(Debug, Clone, Copy)]
enum SelectionMethod {
    UiAutomation,
    ClipboardCopy,
}

impl SelectionMethod {
    fn as_str(self) -> &'static str {
        match self {
            Self::UiAutomation => "uia",
            Self::ClipboardCopy => "clipboard-copy",
        }
    }
}

#[derive(Debug, Clone)]
struct SelectionCapture {
    text: String,
    method: SelectionMethod,
}

#[derive(Debug, Clone)]
struct SelectionCaptureError {
    code: &'static str,
    message: String,
    diagnostic: String,
}

impl SelectionCaptureError {
    fn new(code: &'static str, message: impl Into<String>, diagnostic: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            diagnostic: diagnostic.into(),
        }
    }
}

struct SelectionExecutionGuard;

impl Drop for SelectionExecutionGuard {
    fn drop(&mut self) {
        WORD_SELECTION_IN_PROGRESS.store(false, Ordering::Release);
    }
}

pub async fn execute_word_selection_translate(
    app_handle: tauri::AppHandle,
    settings: WordSelectionTranslateSettings,
    target_hwnd: isize,
    shortcut: String,
) -> Result<(), String> {
    if WORD_SELECTION_IN_PROGRESS
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .is_err()
    {
        eprintln!("[WordSelection] Ignored duplicate trigger while a request is running");
        return Ok(());
    }
    let _execution_guard = SelectionExecutionGuard;
    let request_id = WORD_SELECTION_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    let started_at = Instant::now();

    let selection_result = acquire_selected_text(target_hwnd, shortcut).await;
    match &selection_result {
        Ok(capture) => println!(
            "[WordSelection:{}] capture succeeded method={} chars={} elapsed_ms={}",
            request_id,
            capture.method.as_str(),
            capture.text.chars().count(),
            started_at.elapsed().as_millis()
        ),
        Err(error) => eprintln!(
            "[WordSelection:{}] capture failed code={} {} elapsed_ms={}",
            request_id,
            error.code,
            error.diagnostic,
            started_at.elapsed().as_millis()
        ),
    }

    let cursor_pos = get_cursor_position()?;
    let screen_info = get_screen_info()?;
    let window_width = 540;
    let window_height = 405;
    let (window_x, window_y) = crate::cursor_position::calculate_window_position(
        cursor_pos,
        window_width,
        window_height,
        screen_info,
    );

    let (window, is_new_window) =
        if let Some(window) = app_handle.get_window("word-selection-translate") {
            let _ = window.hide();
            (window, false)
        } else {
            let window = tauri::WindowBuilder::new(
                &app_handle,
                "word-selection-translate",
                tauri::WindowUrl::App("index.html".into()),
            )
            .title("Word Selection Translate")
            .inner_size(window_width as f64, window_height as f64)
            .decorations(false)
            .transparent(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .build()
            .map_err(|error| format!("创建窗口失败: {}", error))?;

            #[cfg(target_os = "windows")]
            set_window_no_activate(&window);

            (window, true)
        };

    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: window_x,
        y: window_y,
    }));

    let start_translation = move |window: tauri::Window| {
        let _ = window.emit(
            "word-selection-translate-event",
            TranslateEvent::Loading { request_id },
        );
        let _ = window.show();

        let app_handle_clone = app_handle.clone();
        let settings_clone = settings.clone();
        let selection_result_clone = selection_result.clone();

        std::thread::spawn(move || {
            let event = match selection_result_clone {
                Ok(capture) => {
                    let trimmed = capture.text.trim().to_string();
                    if trimmed.is_empty() {
                        translate_error(request_id, "未检测到选中文本", "empty_selection")
                    } else if trimmed.chars().count() > 5000 {
                        translate_error(
                            request_id,
                            "选中文本过长（最多 5000 字符）",
                            "selection_too_long",
                        )
                    } else {
                        println!(
                            "[WordSelection:{}] translation started provider={} chars={}",
                            request_id,
                            settings_clone.provider,
                            trimmed.chars().count()
                        );
                        match translate(
                            &trimmed,
                            &settings_clone.from_lang,
                            &settings_clone.to_lang,
                            &settings_clone.provider,
                            settings_clone.auto_detect_language,
                            &settings_clone.translate_config,
                        ) {
                            Ok(result) => {
                                let copied_to_clipboard = if settings_clone.auto_copy {
                                    copy_text_to_clipboard(&result.translated_text)
                                } else {
                                    false
                                };
                                TranslateEvent::Success {
                                    request_id,
                                    original_text: trimmed,
                                    translated_text: result.translated_text,
                                    from_lang: result.from_lang,
                                    to_lang: result.to_lang,
                                    copied_to_clipboard,
                                }
                            }
                            Err(error) => translate_error(request_id, error, "translation_failed"),
                        }
                    }
                }
                Err(error) => translate_error(request_id, error.message, error.code),
            };

            if let Some(window) = app_handle_clone.get_window("word-selection-translate") {
                let _ = window.emit("word-selection-translate-event", event);
                let _ = window.show();
            }
        });
    };

    if is_new_window {
        let window_clone = window.clone();
        window.once("word-selection-translate-ready", move |_| {
            start_translation(window_clone);
        });
    } else {
        start_translation(window);
    }

    Ok(())
}

fn translate_error(
    request_id: u64,
    error: impl Into<String>,
    error_code: impl Into<String>,
) -> TranslateEvent {
    TranslateEvent::Error {
        request_id,
        error: error.into(),
        error_code: error_code.into(),
    }
}

async fn acquire_selected_text(
    target_hwnd: isize,
    shortcut: String,
) -> Result<SelectionCapture, SelectionCaptureError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    std::thread::Builder::new()
        .name("word-selection-capture".to_string())
        .spawn(move || {
            let result = acquire_selected_text_blocking(target_hwnd, &shortcut);
            let _ = sender.send(result);
        })
        .map_err(|error| {
            SelectionCaptureError::new(
                "capture_worker_failed",
                "无法启动选中文本读取线程",
                error.to_string(),
            )
        })?;

    receiver.await.map_err(|error| {
        SelectionCaptureError::new(
            "capture_worker_stopped",
            "选中文本读取线程意外结束",
            error.to_string(),
        )
    })?
}

fn acquire_selected_text_blocking(
    target_hwnd: isize,
    shortcut: &str,
) -> Result<SelectionCapture, SelectionCaptureError> {
    wait_for_shortcut_release(shortcut)?;

    let uia_error = match get_selected_text_via_uia(target_hwnd) {
        Ok(text) if !text.trim().is_empty() => {
            return Ok(SelectionCapture {
                text,
                method: SelectionMethod::UiAutomation,
            })
        }
        Ok(_) => UiaSelectionError {
            kind: UiaFailureKind::NoSelection,
            stage: "empty-uia-result",
            hresult: None,
        },
        Err(error) => error,
    };

    match get_selected_text_via_clipboard_copy(target_hwnd) {
        Ok(text) => Ok(SelectionCapture {
            text,
            method: SelectionMethod::ClipboardCopy,
        }),
        Err(clipboard_error) => Err(combine_capture_errors(uia_error, clipboard_error)),
    }
}

fn combine_capture_errors(
    uia_error: UiaSelectionError,
    clipboard_error: ClipboardCaptureError,
) -> SelectionCaptureError {
    let diagnostic = format!(
        "uia=({}); clipboard=({})",
        uia_error.diagnostic(),
        clipboard_error.diagnostic
    );

    match clipboard_error.kind {
        ClipboardFailureKind::FocusChanged => SelectionCaptureError::new(
            "focus_changed",
            "触发快捷键后目标窗口焦点已经改变，请重新选择文本后再试",
            diagnostic,
        ),
        ClipboardFailureKind::HigherIntegrity => SelectionCaptureError::new(
            "target_elevated",
            "目标应用以更高权限运行，Windows 阻止了取词；请让两个应用使用相同权限运行",
            diagnostic,
        ),
        ClipboardFailureKind::ClipboardBusy => SelectionCaptureError::new(
            "clipboard_busy",
            "剪贴板正在被其他应用占用，请稍后重试",
            diagnostic,
        ),
        ClipboardFailureKind::RestoreFailed => SelectionCaptureError::new(
            "clipboard_restore_failed",
            "读取选中文本后未能恢复原剪贴板，请检查剪贴板内容",
            diagnostic,
        ),
        ClipboardFailureKind::CopyTimedOut if uia_error.kind == UiaFailureKind::NoSelection => {
            SelectionCaptureError::new(
                "no_selection",
                "未检测到选中文本，目标应用也没有响应复制命令",
                diagnostic,
            )
        }
        ClipboardFailureKind::CopyTimedOut => SelectionCaptureError::new(
            "copy_not_supported",
            "目标应用未公开文本选区，并且没有响应复制命令",
            diagnostic,
        ),
        ClipboardFailureKind::InputFailed => SelectionCaptureError::new(
            "copy_input_failed",
            "Windows 未能向目标应用发送复制命令",
            diagnostic,
        ),
        ClipboardFailureKind::Initialization
        | ClipboardFailureKind::SnapshotFailed
        | ClipboardFailureKind::ReadFailed
        | ClipboardFailureKind::WorkerFailed => SelectionCaptureError::new(
            "selection_capture_failed",
            "未能读取选中文本，请重新选择后再试",
            diagnostic,
        ),
    }
}

#[cfg(target_os = "windows")]
fn wait_for_shortcut_release(shortcut: &str) -> Result<(), SelectionCaptureError> {
    use std::time::Duration;
    use winapi::um::winuser::{GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT};

    let mut keys = parse_shortcut_virtual_keys(shortcut);
    for key in [VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN] {
        if !keys.contains(&key) {
            keys.push(key);
        }
    }

    let deadline = Instant::now() + Duration::from_millis(1200);
    loop {
        let any_pressed = keys.iter().any(|key| unsafe { GetAsyncKeyState(*key) } < 0);
        if !any_pressed {
            std::thread::sleep(Duration::from_millis(35));
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(SelectionCaptureError::new(
                "shortcut_release_timeout",
                "快捷键按键仍处于按下状态，请松开按键后重试",
                format!("shortcut={}", shortcut),
            ));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(not(target_os = "windows"))]
fn wait_for_shortcut_release(_shortcut: &str) -> Result<(), SelectionCaptureError> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn parse_shortcut_virtual_keys(shortcut: &str) -> Vec<i32> {
    use winapi::um::winuser::{
        VK_BACK, VK_CONTROL, VK_DELETE, VK_DOWN, VK_END, VK_ESCAPE, VK_HOME, VK_LEFT, VK_MENU,
        VK_NEXT, VK_PRIOR, VK_RETURN, VK_RIGHT, VK_SHIFT, VK_SPACE, VK_TAB, VK_UP,
    };

    let mut result = Vec::new();
    for token in shortcut
        .split('+')
        .map(|part| part.trim().to_ascii_lowercase())
    {
        let key = match token.as_str() {
            "alt" | "option" => Some(VK_MENU),
            "ctrl" | "control" | "cmdorctrl" | "commandorcontrol" | "command" => Some(VK_CONTROL),
            "shift" => Some(VK_SHIFT),
            "space" => Some(VK_SPACE),
            "tab" => Some(VK_TAB),
            "enter" | "return" => Some(VK_RETURN),
            "esc" | "escape" => Some(VK_ESCAPE),
            "backspace" => Some(VK_BACK),
            "delete" => Some(VK_DELETE),
            "left" | "arrowleft" => Some(VK_LEFT),
            "right" | "arrowright" => Some(VK_RIGHT),
            "up" | "arrowup" => Some(VK_UP),
            "down" | "arrowdown" => Some(VK_DOWN),
            "home" => Some(VK_HOME),
            "end" => Some(VK_END),
            "pageup" => Some(VK_PRIOR),
            "pagedown" => Some(VK_NEXT),
            _ => parse_letter_digit_or_function_key(&token),
        };

        if let Some(key) = key {
            if !result.contains(&key) {
                result.push(key);
            }
        }
    }
    result
}

#[cfg(target_os = "windows")]
fn parse_letter_digit_or_function_key(token: &str) -> Option<i32> {
    if token.len() == 1 {
        let character = token.chars().next()?.to_ascii_uppercase();
        if character.is_ascii_alphanumeric() {
            return Some(character as i32);
        }
    }

    token
        .strip_prefix('f')
        .and_then(|number| number.parse::<i32>().ok())
        .filter(|number| (1..=24).contains(number))
        .map(|number| 0x70 + number - 1)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClipboardFailureKind {
    Initialization,
    SnapshotFailed,
    FocusChanged,
    HigherIntegrity,
    InputFailed,
    CopyTimedOut,
    ClipboardBusy,
    ReadFailed,
    RestoreFailed,
    WorkerFailed,
}

#[derive(Debug, Clone)]
struct ClipboardCaptureError {
    kind: ClipboardFailureKind,
    diagnostic: String,
}

impl ClipboardCaptureError {
    fn new(kind: ClipboardFailureKind, diagnostic: impl Into<String>) -> Self {
        Self {
            kind,
            diagnostic: diagnostic.into(),
        }
    }
}

#[cfg(target_os = "windows")]
fn get_selected_text_via_clipboard_copy(
    target_hwnd: isize,
) -> Result<String, ClipboardCaptureError> {
    std::thread::Builder::new()
        .name("word-selection-clipboard".to_string())
        .spawn(move || clipboard_copy_worker(target_hwnd))
        .map_err(|error| {
            ClipboardCaptureError::new(ClipboardFailureKind::WorkerFailed, error.to_string())
        })?
        .join()
        .map_err(|_| {
            ClipboardCaptureError::new(
                ClipboardFailureKind::WorkerFailed,
                "clipboard worker panicked",
            )
        })?
}

#[cfg(target_os = "windows")]
fn clipboard_copy_worker(target_hwnd: isize) -> Result<String, ClipboardCaptureError> {
    use windows::Win32::System::Ole::{OleInitialize, OleUninitialize};

    if !foreground_matches_target(target_hwnd) {
        return Err(ClipboardCaptureError::new(
            ClipboardFailureKind::FocusChanged,
            "foreground process no longer matches target",
        ));
    }

    let _monitor_pause = crate::clipboard_monitor::pause_clipboard_monitor();
    unsafe { OleInitialize(None) }.map_err(|error| {
        ClipboardCaptureError::new(
            ClipboardFailureKind::Initialization,
            format!("OleInitialize HRESULT=0x{:08X}", error.code().0 as u32),
        )
    })?;

    let result = (|| {
        let snapshot = retry_ole_get_clipboard()?;
        let before_sequence = clipboard_win::raw::seq_num().map(|value| value.get());

        if !foreground_matches_target(target_hwnd) {
            let restore_result = retry_ole_set_clipboard(&snapshot);
            return match restore_result {
                Ok(()) => Err(ClipboardCaptureError::new(
                    ClipboardFailureKind::FocusChanged,
                    "foreground changed before copy",
                )),
                Err(error) => Err(error),
            };
        }

        let capture_result = send_copy_and_wait(before_sequence, target_hwnd);
        let restore_result = retry_ole_set_clipboard(&snapshot);

        match (capture_result, restore_result) {
            (Ok(text), Ok(())) => Ok(text),
            (_, Err(error)) => Err(error),
            (Err(error), Ok(())) => Err(error),
        }
    })();

    unsafe { OleUninitialize() };
    result
}

#[cfg(target_os = "windows")]
fn retry_ole_get_clipboard(
) -> Result<windows::Win32::System::Com::IDataObject, ClipboardCaptureError> {
    use std::time::Duration;
    use windows::Win32::System::Ole::OleGetClipboard;

    let deadline = Instant::now() + Duration::from_millis(500);
    loop {
        match unsafe { OleGetClipboard() } {
            Ok(data_object) => return Ok(data_object),
            Err(error) => {
                if Instant::now() >= deadline {
                    return Err(ClipboardCaptureError::new(
                        ClipboardFailureKind::SnapshotFailed,
                        format!("OleGetClipboard HRESULT=0x{:08X}", error.code().0 as u32),
                    ));
                }
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[cfg(target_os = "windows")]
fn retry_ole_set_clipboard(
    data_object: &windows::Win32::System::Com::IDataObject,
) -> Result<(), ClipboardCaptureError> {
    use std::time::Duration;
    use windows::Win32::System::Ole::OleSetClipboard;

    let deadline = Instant::now() + Duration::from_millis(500);
    loop {
        match unsafe { OleSetClipboard(data_object) } {
            Ok(()) => return Ok(()),
            Err(error) => {
                if Instant::now() >= deadline {
                    return Err(ClipboardCaptureError::new(
                        ClipboardFailureKind::RestoreFailed,
                        format!("OleSetClipboard HRESULT=0x{:08X}", error.code().0 as u32),
                    ));
                }
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[cfg(target_os = "windows")]
fn send_copy_and_wait(
    before_sequence: Option<u32>,
    target_hwnd: isize,
) -> Result<String, ClipboardCaptureError> {
    use clipboard_win::{formats, get_clipboard, Format};
    use std::time::Duration;

    send_ctrl_c(target_hwnd)?;

    let deadline = Instant::now() + Duration::from_millis(900);
    let mut clipboard_changed = false;
    let mut last_read_error = None;
    let mut clipboard_was_busy = false;
    loop {
        let current_sequence = clipboard_win::raw::seq_num().map(|value| value.get());
        if current_sequence.is_some() && current_sequence != before_sequence {
            clipboard_changed = true;
        }

        if clipboard_changed {
            if !formats::Unicode.is_format_avail() {
                last_read_error = Some("clipboard did not contain Unicode text".to_string());
                clipboard_was_busy = false;
            } else {
                match get_clipboard::<String, _>(formats::Unicode) {
                    Ok(text) if !text.trim().is_empty() => return Ok(text),
                    Ok(_) => {
                        last_read_error = Some("clipboard text was empty".to_string());
                        clipboard_was_busy = false;
                    }
                    Err(error) => {
                        last_read_error = Some(error.to_string());
                        clipboard_was_busy = true;
                    }
                }
            }
        }

        if Instant::now() >= deadline {
            let (kind, detail) = if !clipboard_changed {
                (
                    ClipboardFailureKind::CopyTimedOut,
                    "clipboard sequence did not change".to_string(),
                )
            } else if clipboard_was_busy {
                (
                    ClipboardFailureKind::ClipboardBusy,
                    last_read_error.unwrap_or_else(|| "clipboard remained unavailable".to_string()),
                )
            } else if last_read_error.is_some() {
                (
                    ClipboardFailureKind::ReadFailed,
                    last_read_error.unwrap_or_else(|| "clipboard read failed".to_string()),
                )
            } else {
                (
                    ClipboardFailureKind::ReadFailed,
                    "clipboard did not contain Unicode text".to_string(),
                )
            };
            return Err(ClipboardCaptureError::new(kind, detail));
        }
        std::thread::sleep(Duration::from_millis(15));
    }
}

#[cfg(target_os = "windows")]
fn send_ctrl_c(target_hwnd: isize) -> Result<(), ClipboardCaptureError> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_C,
        VK_CONTROL,
    };

    if !foreground_matches_target(target_hwnd) {
        return Err(ClipboardCaptureError::new(
            ClipboardFailureKind::FocusChanged,
            "foreground changed before SendInput",
        ));
    }

    fn keyboard_input(key: VIRTUAL_KEY, key_up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    wScan: 0,
                    dwFlags: if key_up {
                        KEYEVENTF_KEYUP
                    } else {
                        Default::default()
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    let inputs = [
        keyboard_input(VK_CONTROL, false),
        keyboard_input(VK_C, false),
        keyboard_input(VK_C, true),
        keyboard_input(VK_CONTROL, true),
    ];
    let inserted = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if inserted == inputs.len() as u32 {
        return Ok(());
    }

    if inserted > 0 {
        let releases = [keyboard_input(VK_C, true), keyboard_input(VK_CONTROL, true)];
        let _ = unsafe { SendInput(&releases, std::mem::size_of::<INPUT>() as i32) };
    }

    if target_has_higher_integrity(target_hwnd) {
        return Err(ClipboardCaptureError::new(
            ClipboardFailureKind::HigherIntegrity,
            format!("SendInput inserted {}/{} events", inserted, inputs.len()),
        ));
    }

    let last_error = unsafe { winapi::um::errhandlingapi::GetLastError() };
    Err(ClipboardCaptureError::new(
        ClipboardFailureKind::InputFailed,
        format!(
            "SendInput inserted {}/{} events, GetLastError={}",
            inserted,
            inputs.len(),
            last_error
        ),
    ))
}

#[cfg(target_os = "windows")]
fn foreground_matches_target(target_hwnd: isize) -> bool {
    use winapi::um::winuser::{GetForegroundWindow, GetWindowThreadProcessId};

    let foreground = unsafe { GetForegroundWindow() };
    if foreground.is_null() {
        return false;
    }
    if foreground as isize == target_hwnd {
        return true;
    }

    let mut foreground_pid = 0u32;
    let mut target_pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(foreground, &mut foreground_pid);
        GetWindowThreadProcessId(target_hwnd as _, &mut target_pid);
    }
    foreground_pid != 0 && foreground_pid == target_pid
}

#[cfg(target_os = "windows")]
fn target_has_higher_integrity(target_hwnd: isize) -> bool {
    use winapi::um::processthreadsapi::GetCurrentProcessId;
    use winapi::um::winuser::GetWindowThreadProcessId;

    let mut target_pid = 0u32;
    unsafe { GetWindowThreadProcessId(target_hwnd as _, &mut target_pid) };
    if target_pid == 0 {
        return false;
    }

    match (
        process_integrity_level(unsafe { GetCurrentProcessId() }),
        process_integrity_level(target_pid),
    ) {
        (Some(current), Some(target)) => target > current,
        _ => false,
    }
}

#[cfg(target_os = "windows")]
fn process_integrity_level(process_id: u32) -> Option<u32> {
    use winapi::shared::minwindef::{DWORD, FALSE};
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::processthreadsapi::{OpenProcess, OpenProcessToken};
    use winapi::um::securitybaseapi::{
        GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation,
    };
    use winapi::um::winnt::{
        TokenIntegrityLevel, PROCESS_QUERY_LIMITED_INFORMATION, TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
    };

    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, process_id);
        if process.is_null() {
            return None;
        }

        let mut token = std::ptr::null_mut();
        if OpenProcessToken(process, TOKEN_QUERY, &mut token) == 0 {
            CloseHandle(process);
            return None;
        }

        let mut required_size: DWORD = 0;
        GetTokenInformation(
            token,
            TokenIntegrityLevel,
            std::ptr::null_mut(),
            0,
            &mut required_size,
        );
        if required_size == 0 {
            CloseHandle(token);
            CloseHandle(process);
            return None;
        }

        let mut buffer = vec![0u8; required_size as usize];
        let succeeded = GetTokenInformation(
            token,
            TokenIntegrityLevel,
            buffer.as_mut_ptr() as _,
            required_size,
            &mut required_size,
        );
        if succeeded == 0 {
            CloseHandle(token);
            CloseHandle(process);
            return None;
        }

        let label = &*(buffer.as_ptr() as *const TOKEN_MANDATORY_LABEL);
        let sid = label.Label.Sid;
        if sid.is_null() {
            CloseHandle(token);
            CloseHandle(process);
            return None;
        }
        let sub_authority_count = *GetSidSubAuthorityCount(sid);
        if sub_authority_count == 0 {
            CloseHandle(token);
            CloseHandle(process);
            return None;
        }
        let integrity_level = *GetSidSubAuthority(sid, sub_authority_count as DWORD - 1);

        CloseHandle(token);
        CloseHandle(process);
        Some(integrity_level)
    }
}

#[cfg(not(target_os = "windows"))]
fn get_selected_text_via_clipboard_copy(
    _target_hwnd: isize,
) -> Result<String, ClipboardCaptureError> {
    Err(ClipboardCaptureError::new(
        ClipboardFailureKind::Initialization,
        "clipboard capture is only supported on Windows",
    ))
}

#[cfg(target_os = "windows")]
fn copy_text_to_clipboard(text: &str) -> bool {
    clipboard_win::set_clipboard(clipboard_win::formats::Unicode, &text).is_ok()
}

#[cfg(not(target_os = "windows"))]
fn copy_text_to_clipboard(_text: &str) -> bool {
    false
}

#[cfg(target_os = "windows")]
fn set_window_no_activate(window: &tauri::Window) {
    use winapi::shared::windef::HWND;
    use winapi::um::winuser::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let hwnd = hwnd.0 as HWND;
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                ex_style | WS_EX_NOACTIVATE as isize | WS_EX_TOOLWINDOW as isize,
            );
        }
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::parse_shortcut_virtual_keys;
    use winapi::um::winuser::{VK_CONTROL, VK_MENU, VK_NEXT, VK_SHIFT};

    #[test]
    fn parses_registered_shortcut_keys() {
        assert_eq!(
            parse_shortcut_virtual_keys("Ctrl+Alt+W"),
            vec![VK_CONTROL, VK_MENU, 'W' as i32]
        );
        assert_eq!(
            parse_shortcut_virtual_keys("Shift+PageDown"),
            vec![VK_SHIFT, VK_NEXT]
        );
    }

    #[test]
    fn parses_function_keys_digits_and_aliases() {
        assert_eq!(
            parse_shortcut_virtual_keys("CommandOrControl+7+F24"),
            vec![VK_CONTROL, '7' as i32, 0x87]
        );
        assert_eq!(
            parse_shortcut_virtual_keys("Option+f1"),
            vec![VK_MENU, 0x70]
        );
    }

    #[test]
    fn ignores_unknown_and_duplicate_tokens() {
        assert_eq!(
            parse_shortcut_virtual_keys("Ctrl+Ctrl+Unknown+Q"),
            vec![VK_CONTROL, 'Q' as i32]
        );
    }
}
