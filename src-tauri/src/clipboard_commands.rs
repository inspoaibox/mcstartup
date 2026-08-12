use crate::clipboard_history::{ClipboardDb, ClipboardItem};
use rusqlite;
use std::sync::Arc;
use tauri::{GlobalShortcutManager, State};

pub struct ClipboardState {
    pub db: Arc<ClipboardDb>,
}

#[tauri::command]
pub fn clipboard_query(
    group: String,
    search: String,
    page: i64,
    page_size: i64,
    state: State<ClipboardState>,
) -> Result<Vec<ClipboardItem>, String> {
    state
        .db
        .query(&group, &search, page, page_size)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_toggle_favorite(id: String, state: State<ClipboardState>) -> Result<bool, String> {
    state.db.toggle_favorite(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_update_note(
    id: String,
    note: Option<String>,
    state: State<ClipboardState>,
) -> Result<(), String> {
    state
        .db
        .update_note(&id, note.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_toggle_pin(id: String, state: State<ClipboardState>) -> Result<bool, String> {
    state.db.toggle_pin(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_update_text_value(
    id: String,
    value: String,
    state: State<ClipboardState>,
) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("内容不能为空".to_string());
    }
    state
        .db
        .update_text_value(&id, value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_update_favorite_shortcut(
    id: String,
    shortcut: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<ClipboardState>,
) -> Result<(), String> {
    let old_shortcut = state.db.shortcut_for_item(&id).map_err(|e| e.to_string())?;
    if let Some(old) = old_shortcut.as_deref().filter(|s| !s.trim().is_empty()) {
        let mut gsm = app_handle.global_shortcut_manager();
        let _ = gsm.unregister(old);
    }

    state
        .db
        .update_shortcut(&id, shortcut.as_deref())
        .map_err(|e| e.to_string())?;

    if let Some(next) = shortcut.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        register_favorite_shortcut(&app_handle, state.db.clone(), id, next.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn clipboard_delete(id: String, state: State<ClipboardState>) -> Result<(), String> {
    // 如果是图片类型，先删除对应的 PNG 文件
    if let Ok(Some((item_type, value))) = state.db.get_item_type_and_value(&id) {
        if item_type == "image" && !value.is_empty() {
            let path = std::path::Path::new(&value);
            if path.exists() {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    state.db.delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_clear(keep_favorites: bool, state: State<ClipboardState>) -> Result<(), String> {
    // 清理图片文件：在删除记录前先收集路径，确保 conn/stmt 借用在删除文件前释放
    let image_paths: Vec<String> = {
        let conn_arc = state.db.get_conn();
        let conn = conn_arc.lock().unwrap();
        let sql = if keep_favorites {
            "SELECT value FROM history WHERE type = 'image' AND favorite = 0"
        } else {
            "SELECT value FROM history WHERE type = 'image'"
        };
        conn.prepare(sql)
            .and_then(|mut stmt| {
                stmt.query_map([], |row| row.get(0))
                    .map(|rows| rows.flatten().collect())
            })
            .unwrap_or_default()
    }; // conn 和 stmt 在此 drop

    for p in &image_paths {
        let path = std::path::Path::new(p);
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
    }

    state
        .db
        .clear_all(keep_favorites)
        .map_err(|e| e.to_string())
}

/// 清理旧的 base64 图片记录（数据迁移）
#[tauri::command]
pub fn clipboard_clear_base64_images(state: State<ClipboardState>) -> Result<u64, String> {
    let conn = state.db.get_conn();
    let conn = conn.lock().unwrap();
    let count = conn
        .execute(
            "DELETE FROM history WHERE type = 'image' AND value LIKE 'data:image/%'",
            [],
        )
        .map_err(|e| e.to_string())?;
    Ok(count as u64)
}

/// 根据 id 查找单条记录
fn find_item(db: &Arc<ClipboardDb>, id: &str) -> Result<ClipboardItem, String> {
    // 用 find_by_id 查询（直接 SQL）
    let conn = db.get_conn();
    let conn = conn.lock().unwrap();
    conn.query_row(
        "SELECT id, type, grp, value, search, count, width, height, favorite, pinned, shortcut, create_time, note, subtype
         FROM history WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(ClipboardItem {
                id: row.get(0)?,
                item_type: row.get(1)?,
                group: row.get(2)?,
                value: row.get(3)?,
                search: row.get(4)?,
                count: row.get(5)?,
                width: row.get(6)?,
                height: row.get(7)?,
                favorite: row.get::<_, i32>(8)? != 0,
                pinned: row.get::<_, i32>(9)? != 0,
                shortcut: row.get(10)?,
                create_time: row.get(11)?,
                note: row.get(12)?,
                subtype: row.get(13)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

/// 将图片文件写入系统剪贴板（Bitmap 格式）
fn write_image_to_clipboard(png_path: &str) -> Result<(), String> {
    use clipboard_win::{formats, set_clipboard};
    use image::{DynamicImage, ImageFormat, Rgba};

    let png_bytes = std::fs::read(png_path).map_err(|e| format!("读取图片文件失败: {}", e))?;

    let img = image::load_from_memory_with_format(&png_bytes, ImageFormat::Png)
        .or_else(|_| image::load_from_memory(&png_bytes))
        .map_err(|e| format!("解码图片失败: {}", e))?;

    // 将图片合并到白色背景，处理 alpha 通道，避免透明区域变黑
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut bg = image::RgbaImage::from_pixel(w, h, Rgba([255u8, 255, 255, 255]));
    for (x, y, pixel) in rgba.enumerate_pixels() {
        let a = pixel[3] as f32 / 255.0;
        let r = (pixel[0] as f32 * a + 255.0 * (1.0 - a)) as u8;
        let g = (pixel[1] as f32 * a + 255.0 * (1.0 - a)) as u8;
        let b = (pixel[2] as f32 * a + 255.0 * (1.0 - a)) as u8;
        bg.put_pixel(x, y, Rgba([r, g, b, 255]));
    }
    let rgb_img = DynamicImage::ImageRgba8(bg).to_rgb8();

    // Windows 剪贴板 CF_DIB 要求 BGR 字节序的 DIB
    // image crate 的 BMP 编码器输出 RGB，需要手动构造正确的 BITMAPINFOHEADER + BGR 数据
    let dib = encode_dib_bgr(&rgb_img);
    set_clipboard(formats::RawData(formats::CF_DIB), dib.as_slice()).map_err(|e| e.to_string())?;

    Ok(())
}

/// 手动构造 Windows DIB（BITMAPINFOHEADER + BGR 像素数据，无文件头）
/// 标准格式：BGR 字节序，正高度（行从下到上存储），每行4字节对齐
/// 兼容所有 Windows 应用（Word、微信、QQ、画图等）
fn encode_dib_bgr(img: &image::RgbImage) -> Vec<u8> {
    let (w, h) = img.dimensions();
    let row_stride = ((w as usize * 3) + 3) & !3; // 每行4字节对齐
    let pixel_data_size = row_stride * h as usize;

    // BITMAPINFOHEADER = 40 字节
    let mut dib = Vec::with_capacity(40 + pixel_data_size);

    dib.extend_from_slice(&40u32.to_le_bytes()); // biSize
    dib.extend_from_slice(&(w as i32).to_le_bytes()); // biWidth
    dib.extend_from_slice(&(h as i32).to_le_bytes()); // biHeight（正值=自下而上，标准格式）
    dib.extend_from_slice(&1u16.to_le_bytes()); // biPlanes
    dib.extend_from_slice(&24u16.to_le_bytes()); // biBitCount
    dib.extend_from_slice(&0u32.to_le_bytes()); // biCompression (BI_RGB)
    dib.extend_from_slice(&(pixel_data_size as u32).to_le_bytes()); // biSizeImage
    dib.extend_from_slice(&0i32.to_le_bytes()); // biXPelsPerMeter
    dib.extend_from_slice(&0i32.to_le_bytes()); // biYPelsPerMeter
    dib.extend_from_slice(&0u32.to_le_bytes()); // biClrUsed
    dib.extend_from_slice(&0u32.to_le_bytes()); // biClrImportant

    // 正高度 DIB：像素从最后一行（底部）开始写到第一行（顶部）
    for y in (0..h).rev() {
        for x in 0..w {
            let p = img.get_pixel(x, y);
            dib.push(p[2]); // B
            dib.push(p[1]); // G
            dib.push(p[0]); // R
        }
        // 行尾填充到4字节对齐
        let padding = row_stride - w as usize * 3;
        for _ in 0..padding {
            dib.push(0);
        }
    }

    dib
}

/// 将文件列表写入系统剪贴板（真正的文件对象，可粘贴到资源管理器）
fn write_files_to_clipboard(paths: &[String]) -> Result<(), String> {
    use clipboard_win::formats::FileList;
    use clipboard_win::Setter;
    // 需要先打开剪贴板
    let _clip =
        clipboard_win::Clipboard::new_attempts(10).map_err(|e| format!("打开剪贴板失败: {}", e))?;
    FileList.write_clipboard(paths).map_err(|e| e.to_string())
}

/// 将指定条目写回系统剪贴板
#[tauri::command]
pub fn clipboard_copy_item(id: String, state: State<ClipboardState>) -> Result<(), String> {
    use clipboard_win::{formats, set_clipboard};
    let item = find_item(&state.db, &id)?;

    match item.item_type.as_str() {
        "text" | "html" | "rtf" => {
            set_clipboard(formats::Unicode, &item.value).map_err(|e| e.to_string())?;
        }
        "image" => {
            write_image_to_clipboard(&item.value)?;
        }
        "files" => {
            let paths: Vec<String> =
                serde_json::from_str(&item.value).map_err(|e| e.to_string())?;
            write_files_to_clipboard(&paths)?;
        }
        _ => {}
    }
    Ok(())
}

/// 将内容写入剪贴板并模拟 Ctrl+V 粘贴
#[tauri::command]
pub fn clipboard_paste_item(
    id: String,
    as_plain: bool,
    state: State<ClipboardState>,
) -> Result<(), String> {
    use clipboard_win::{formats, set_clipboard};
    let item = find_item(&state.db, &id)?;

    match item.item_type.as_str() {
        "text" | "html" | "rtf" => {
            let text = if as_plain {
                item.search.clone()
            } else {
                item.value.clone()
            };
            set_clipboard(formats::Unicode, &text).map_err(|e| e.to_string())?;
        }
        "image" => {
            write_image_to_clipboard(&item.value)?;
        }
        "files" => {
            let paths: Vec<String> =
                serde_json::from_str(&item.value).map_err(|e| e.to_string())?;
            write_files_to_clipboard(&paths)?;
        }
        _ => {}
    }

    simulate_paste();
    Ok(())
}

pub fn restore_favorite_shortcuts(app_handle: tauri::AppHandle, db: Arc<ClipboardDb>) {
    let bindings = match db.shortcut_bindings() {
        Ok(bindings) => bindings,
        Err(error) => {
            eprintln!("[Clipboard] Failed to load favorite shortcuts: {}", error);
            return;
        }
    };

    for (id, shortcut) in bindings {
        if let Err(error) = register_favorite_shortcut(&app_handle, db.clone(), id, shortcut) {
            eprintln!(
                "[Clipboard] Failed to register favorite shortcut: {}",
                error
            );
        }
    }
}

fn register_favorite_shortcut(
    app_handle: &tauri::AppHandle,
    db: Arc<ClipboardDb>,
    id: String,
    shortcut: String,
) -> Result<(), String> {
    let normalized = shortcut.trim().to_string();
    if normalized.is_empty() {
        return Ok(());
    }

    let mut gsm = app_handle.global_shortcut_manager();
    let _ = gsm.unregister(normalized.as_str());
    gsm.register(normalized.as_str(), move || {
        let _ = paste_item_by_id(&db, &id, false);
    })
    .map_err(|e| format!("注册收藏快捷键失败 {}: {}", normalized, e))
}

fn paste_item_by_id(db: &Arc<ClipboardDb>, id: &str, as_plain: bool) -> Result<(), String> {
    use clipboard_win::{formats, set_clipboard};
    let item = find_item(db, id)?;

    match item.item_type.as_str() {
        "text" | "html" | "rtf" => {
            let text = if as_plain {
                item.search.clone()
            } else {
                item.value.clone()
            };
            set_clipboard(formats::Unicode, &text).map_err(|e| e.to_string())?;
        }
        "image" => {
            write_image_to_clipboard(&item.value)?;
        }
        "files" => {
            let paths: Vec<String> =
                serde_json::from_str(&item.value).map_err(|e| e.to_string())?;
            write_files_to_clipboard(&paths)?;
        }
        _ => {}
    }

    simulate_paste();
    Ok(())
}

fn simulate_paste() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let _ = std::process::Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-NoProfile", "-WindowStyle", "Hidden", "-Command",
            r#"Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 150; [System.Windows.Forms.SendKeys]::SendWait('^v')"#,
        ])
        .spawn();
}
