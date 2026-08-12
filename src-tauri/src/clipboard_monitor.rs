use crate::clipboard_history::{
    detect_text_subtype, single_image_file_metadata, ClipboardDb, ClipboardItem, IMAGE_FILE_SUBTYPE,
};
use chrono::Local;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const CLIPBOARD_POLL_INTERVAL: Duration = Duration::from_millis(800);
static CLIPBOARD_IO_LOCK: Mutex<()> = Mutex::new(());
static CLIPBOARD_MONITOR_SUPPRESSIONS: AtomicUsize = AtomicUsize::new(0);

pub struct ClipboardMonitorPause {
    _io_lock: MutexGuard<'static, ()>,
}

impl Drop for ClipboardMonitorPause {
    fn drop(&mut self) {
        CLIPBOARD_MONITOR_SUPPRESSIONS.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Blocks this application's clipboard reader while an internal operation
/// temporarily changes the system clipboard.
pub fn pause_clipboard_monitor() -> ClipboardMonitorPause {
    let io_lock = CLIPBOARD_IO_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    CLIPBOARD_MONITOR_SUPPRESSIONS.fetch_add(1, Ordering::SeqCst);
    ClipboardMonitorPause { _io_lock: io_lock }
}

fn clipboard_monitor_is_paused() -> bool {
    CLIPBOARD_MONITOR_SUPPRESSIONS.load(Ordering::SeqCst) > 0
}

struct LastClipboard {
    text: Option<String>,
    image_hash: Option<u64>,
    files: Option<Vec<String>>,
}

impl LastClipboard {
    fn new() -> Self {
        Self {
            text: None,
            image_hash: None,
            files: None,
        }
    }
}

pub fn start_clipboard_monitor(app_handle: AppHandle, db: Arc<ClipboardDb>) {
    thread::spawn(move || {
        let last = Arc::new(Mutex::new(LastClipboard::new()));

        if let Err(e) = poll_clipboard(&app_handle, &db, &last) {
            eprintln!("[clipboard] initial poll error: {}", e);
        }

        if start_event_driven(app_handle.clone(), db.clone(), last.clone()) {
            println!("[clipboard] Event-driven monitor started");
        } else {
            eprintln!(
                "[clipboard] Event-driven monitor unavailable, polling fallback remains active"
            );
        }

        start_polling(&app_handle, &db, &last);
    });
}

/// 使用 WM_CLIPBOARDUPDATE 消息驱动，CPU 占用接近 0
fn start_event_driven(
    app_handle: AppHandle,
    db: Arc<ClipboardDb>,
    last: Arc<Mutex<LastClipboard>>,
) -> bool {
    let started = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let started_for_thread = started.clone();

    thread::spawn(move || {
        use std::sync::atomic::Ordering;
        use winapi::shared::minwindef::{LPARAM, LRESULT, UINT, WPARAM};
        use winapi::shared::windef::HWND;
        use winapi::um::libloaderapi::GetModuleHandleW;
        use winapi::um::winuser::{
            AddClipboardFormatListener, CreateWindowExW, DefWindowProcW, DispatchMessageW,
            GetMessageW, PostQuitMessage, RegisterClassW, RemoveClipboardFormatListener,
            HWND_MESSAGE, MSG, WM_CLIPBOARDUPDATE, WM_DESTROY, WNDCLASSW, WS_EX_NOACTIVATE,
            WS_OVERLAPPED,
        };

        let class_name: Vec<u16> = {
            use std::ffi::OsStr;
            use std::os::windows::ffi::OsStrExt;
            OsStr::new("McStartUP_ClipboardWatcher\0")
                .encode_wide()
                .collect()
        };

        unsafe extern "system" fn wnd_proc(
            hwnd: HWND,
            msg: UINT,
            wparam: WPARAM,
            lparam: LPARAM,
        ) -> LRESULT {
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }

        unsafe {
            let hinstance = GetModuleHandleW(std::ptr::null());
            if hinstance.is_null() {
                eprintln!("[clipboard] GetModuleHandleW failed");
                return;
            }

            let wc = WNDCLASSW {
                lpfnWndProc: Some(wnd_proc),
                hInstance: hinstance,
                lpszClassName: class_name.as_ptr(),
                ..std::mem::zeroed()
            };
            let _ = RegisterClassW(&wc);

            let hwnd = CreateWindowExW(
                WS_EX_NOACTIVATE,
                class_name.as_ptr(),
                std::ptr::null(),
                WS_OVERLAPPED,
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                std::ptr::null_mut(),
                hinstance,
                std::ptr::null_mut(),
            );
            if hwnd.is_null() {
                eprintln!("[clipboard] watcher window creation failed");
                return;
            }

            if AddClipboardFormatListener(hwnd) == 0 {
                winapi::um::winuser::DestroyWindow(hwnd);
                eprintln!("[clipboard] AddClipboardFormatListener failed");
                return;
            }

            started_for_thread.store(true, Ordering::SeqCst);

            let mut msg: MSG = std::mem::zeroed();
            loop {
                let ret = GetMessageW(&mut msg, hwnd, 0, 0);
                if ret == 0 || ret == -1 {
                    break;
                }

                if msg.message == WM_CLIPBOARDUPDATE {
                    if let Err(e) = poll_clipboard(&app_handle, &db, &last) {
                        eprintln!("[clipboard] event poll error: {}", e);
                    }
                } else if msg.message == WM_DESTROY {
                    PostQuitMessage(0);
                    break;
                }

                DispatchMessageW(&msg);
            }

            RemoveClipboardFormatListener(hwnd);
            eprintln!("[clipboard] Event-driven monitor exited; polling fallback continues");
        }
    });

    thread::sleep(Duration::from_millis(100));
    started.load(std::sync::atomic::Ordering::SeqCst)
}

/// 轮询兜底：即使 Windows 事件通知失效，剪贴板历史也要继续采集。
fn start_polling(app_handle: &AppHandle, db: &Arc<ClipboardDb>, last: &Arc<Mutex<LastClipboard>>) {
    loop {
        thread::sleep(CLIPBOARD_POLL_INTERVAL);
        if let Err(e) = poll_clipboard(app_handle, db, last) {
            eprintln!("[clipboard] poll error: {}", e);
        }
    }
}

fn get_image_save_dir() -> PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(app_data)
        .join("McStartUP")
        .join("clipboard_images")
}

fn poll_clipboard(
    app_handle: &AppHandle,
    db: &Arc<ClipboardDb>,
    last: &Arc<Mutex<LastClipboard>>,
) -> anyhow::Result<()> {
    use clipboard_win::{formats, get_clipboard};

    if clipboard_monitor_is_paused() {
        return Ok(());
    }
    let _io_lock = CLIPBOARD_IO_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if clipboard_monitor_is_paused() {
        return Ok(());
    }

    // 1. 文件列表
    if let Ok(files) = get_clipboard::<Vec<String>, _>(formats::FileList) {
        let paths: Vec<String> = files.clone();
        if !paths.is_empty() {
            let mut g = last.lock().unwrap();
            if g.files.as_ref() != Some(&paths) {
                g.files = Some(paths.clone());
                g.text = None;
                g.image_hash = None;
                drop(g);
                let value = serde_json::to_string(&paths)?;
                let image_file = single_image_file_metadata(&paths);
                let search = paths
                    .iter()
                    .map(|p: &String| {
                        std::path::Path::new(p)
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_else(|| p.clone())
                    })
                    .collect::<Vec<_>>()
                    .join(" ");
                let count = image_file
                    .as_ref()
                    .map(|metadata| metadata.size)
                    .unwrap_or(paths.len() as i64);
                let item = ClipboardItem {
                    id: Uuid::new_v4().to_string(),
                    item_type: "files".to_string(),
                    group: "files".to_string(),
                    value: value.clone(),
                    search,
                    count,
                    width: image_file.as_ref().map(|metadata| metadata.width),
                    height: image_file.as_ref().map(|metadata| metadata.height),
                    favorite: false,
                    pinned: false,
                    shortcut: None,
                    create_time: now(),
                    note: None,
                    subtype: image_file.map(|_| IMAGE_FILE_SUBTYPE.to_string()),
                };
                save_and_notify(app_handle, db, item, &value, "files")?;
            }
            return Ok(());
        }
    }

    // 2. 图片 —— 保存为本地 PNG 文件，数据库存文件路径
    if let Ok(bitmap) = get_clipboard(formats::Bitmap) {
        let hash = simple_hash(&bitmap);
        let mut g = last.lock().unwrap();
        if g.image_hash != Some(hash) {
            g.image_hash = Some(hash);
            g.text = None;
            g.files = None;
            drop(g);
            if let Some((file_path, width, height)) = save_bitmap_to_file(&bitmap) {
                let path_str = file_path.to_string_lossy().to_string();
                let count = bitmap.len() as i64;
                let item = ClipboardItem {
                    id: Uuid::new_v4().to_string(),
                    item_type: "image".to_string(),
                    group: "image".to_string(),
                    value: path_str.clone(),
                    search: String::new(),
                    count,
                    width,
                    height,
                    favorite: false,
                    pinned: false,
                    shortcut: None,
                    create_time: now(),
                    note: None,
                    subtype: None,
                };
                save_and_notify(app_handle, db, item, &path_str, "image")?;
            }
        }
        return Ok(());
    }

    // 3. 文本
    if let Ok(text) = get_clipboard::<String, _>(formats::Unicode) {
        let text = text.trim().to_string();
        if text.is_empty() {
            return Ok(());
        }
        let mut g = last.lock().unwrap();
        if g.text.as_deref() == Some(&text) {
            return Ok(());
        }
        g.text = Some(text.clone());
        g.image_hash = None;
        g.files = None;
        drop(g);
        let subtype = detect_text_subtype(&text);
        let count = text.chars().count() as i64;
        let item = ClipboardItem {
            id: Uuid::new_v4().to_string(),
            item_type: "text".to_string(),
            group: "text".to_string(),
            value: text.clone(),
            search: text.clone(),
            count,
            width: None,
            height: None,
            favorite: false,
            pinned: false,
            shortcut: None,
            create_time: now(),
            note: None,
            subtype,
        };
        save_and_notify(app_handle, db, item, &text, "text")?;
    }
    Ok(())
}

fn save_bitmap_to_file(bmp_data: &[u8]) -> Option<(PathBuf, Option<i64>, Option<i64>)> {
    use image::ImageFormat;
    use std::io::Cursor;
    let img = decode_dib(bmp_data)?;
    let (width, height) = (img.width() as i64, img.height() as i64);
    let save_dir = get_image_save_dir();
    std::fs::create_dir_all(&save_dir).ok()?;
    let file_path = save_dir.join(format!("{}.png", Uuid::new_v4()));
    let mut png_bytes = Vec::new();
    img.write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
        .ok()?;
    std::fs::write(&file_path, &png_bytes).ok()?;
    Some((file_path, Some(width), Some(height)))
}

fn decode_dib(bmp_data: &[u8]) -> Option<image::DynamicImage> {
    use image::ImageFormat;
    // 直接尝试
    if let Ok(img) = image::load_from_memory_with_format(bmp_data, ImageFormat::Bmp) {
        return Some(img);
    }
    // 加 BMP 文件头再试
    if bmp_data.len() > 40 {
        let dib_header_size =
            u32::from_le_bytes([bmp_data[0], bmp_data[1], bmp_data[2], bmp_data[3]]);
        let pixel_offset = 14u32 + dib_header_size;
        let file_size = (bmp_data.len() + 14) as u32;
        let mut with_header = Vec::with_capacity(14 + bmp_data.len());
        with_header.extend_from_slice(b"BM");
        with_header.extend_from_slice(&file_size.to_le_bytes());
        with_header.extend_from_slice(&0u32.to_le_bytes());
        with_header.extend_from_slice(&pixel_offset.to_le_bytes());
        with_header.extend_from_slice(bmp_data);
        if let Ok(img) = image::load_from_memory_with_format(&with_header, ImageFormat::Bmp) {
            return Some(img);
        }
        if let Ok(img) = image::load_from_memory(&with_header) {
            return Some(img);
        }
    }
    None
}

fn save_and_notify(
    app_handle: &AppHandle,
    db: &Arc<ClipboardDb>,
    item: ClipboardItem,
    value: &str,
    item_type: &str,
) -> anyhow::Result<()> {
    if let Ok(Some(existing_id)) = db.find_by_value(item_type, value) {
        let _ = db.update_create_time(&existing_id, &now());
        let _ = app_handle.emit_all("clipboard-changed", serde_json::json!({ "reload": true }));
        return Ok(());
    }
    db.insert(&item)?;
    let _ = app_handle.emit_all("clipboard-changed", serde_json::json!({ "reload": true }));
    Ok(())
}

fn now() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn simple_hash(data: &[u8]) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    // 采样首部、中部、尾部各最多 2048 字节，降低相似图片碰撞概率
    let len = data.len();
    let chunk = 2048_usize.min(len);
    data[..chunk].hash(&mut hasher);
    if len > chunk * 2 {
        let mid = len / 2;
        data[mid..mid + chunk].hash(&mut hasher);
    }
    if len > chunk {
        data[len - chunk..].hash(&mut hasher);
    }
    len.hash(&mut hasher);
    hasher.finish()
}
