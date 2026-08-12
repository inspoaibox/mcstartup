// 截图工具模块
use crate::scroll_stitcher::{ScrollImageList, ScrollScreenshotService};
use base64::engine::general_purpose;
use base64::Engine;
use enigo::{Enigo, MouseControllable};
use screenshots::image::codecs::png::{
    CompressionType as PngCompressionType, FilterType as PngFilterType, PngEncoder,
};
use screenshots::image::{
    load_from_memory, ColorType, DynamicImage, ImageBuffer, ImageEncoder, ImageFormat, Rgba,
    RgbaImage,
};
use screenshots::Screen;
use std::fs;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

const MAX_SCROLL_SCREENSHOT_HEIGHT: u32 = 60_000;

// 截图信息结构体（预留用于未来的截图历史功能）
#[allow(dead_code)]
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ScreenshotInfo {
    pub id: String,
    pub timestamp: i64,
    pub width: u32,
    pub height: u32,
    pub file_path: Option<String>,
}

// 获取所有屏幕信息
pub fn get_screens_info() -> Result<Vec<ScreenInfo>, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕失败: {}", e))?;

    Ok(screens
        .iter()
        .enumerate()
        .map(|(index, screen)| ScreenInfo {
            index,
            width: screen.display_info.width,
            height: screen.display_info.height,
            x: screen.display_info.x,
            y: screen.display_info.y,
            is_primary: screen.display_info.is_primary,
        })
        .collect())
}

#[cfg(target_os = "windows")]
pub fn get_selectable_windows(
    excluded_hwnd: Option<isize>,
) -> Result<Vec<SelectableWindow>, String> {
    use winapi::shared::minwindef::{BOOL, LPARAM};
    use winapi::shared::windef::{HWND, RECT};
    use winapi::um::winuser::{
        EnumWindows, GetShellWindow, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, IsIconic,
        IsWindowVisible,
    };

    struct EnumContext {
        windows: Vec<SelectableWindow>,
        excluded_hwnd: Option<isize>,
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let context = &mut *(lparam as *mut EnumContext);
        if IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 || hwnd == GetShellWindow() {
            return 1;
        }

        if context
            .excluded_hwnd
            .is_some_and(|excluded| hwnd as isize == excluded)
        {
            return 1;
        }

        let title_len = GetWindowTextLengthW(hwnd);
        if title_len <= 0 {
            return 1;
        }

        let mut rect: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return 1;
        }
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width < 80 || height < 50 {
            return 1;
        }

        let mut buffer = vec![0u16; title_len as usize + 1];
        let copied = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
        if copied <= 0 {
            return 1;
        }
        let title = String::from_utf16_lossy(&buffer[..copied as usize])
            .trim()
            .to_string();
        if title.is_empty() {
            return 1;
        }

        context.windows.push(SelectableWindow {
            hwnd: (hwnd as usize).to_string(),
            title,
            x: rect.left,
            y: rect.top,
            width,
            height,
        });
        1
    }

    let mut context = EnumContext {
        windows: Vec::new(),
        excluded_hwnd,
    };
    unsafe {
        EnumWindows(Some(enum_proc), &mut context as *mut _ as LPARAM);
    }
    Ok(context.windows)
}

#[cfg(not(target_os = "windows"))]
pub fn get_selectable_windows(
    _excluded_hwnd: Option<isize>,
) -> Result<Vec<SelectableWindow>, String> {
    Ok(Vec::new())
}

#[derive(Debug, serde::Serialize)]
pub struct ScreenInfo {
    pub index: usize,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_primary: bool,
}

#[derive(Debug, serde::Serialize)]
pub struct SelectableWindow {
    pub hwnd: String,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

pub struct ScrollScreenshotSession {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub focus_x: i32,
    pub focus_y: i32,
    pub stitcher: ScrollScreenshotService,
}

#[derive(Debug, serde::Serialize)]
pub struct ScrollScreenshotStepResult {
    pub changed: bool,
    pub full_base64: String,
    pub frame_base64: String,
    pub stitched_base64: String,
    pub stitched_height: u32,
    pub reached_limit: bool,
}

// 全屏截图（主屏幕）
pub fn capture_fullscreen() -> Result<String, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕失败: {}", e))?;

    let screen = screens
        .into_iter()
        .find(|s| s.display_info.is_primary)
        .ok_or_else(|| "未找到主屏幕".to_string())?;

    let image = screen.capture().map_err(|e| format!("截图失败: {}", e))?;
    encode_rgba_image_base64_fast(&image)
}

// 指定屏幕截图
pub fn capture_screen(screen_index: usize) -> Result<String, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕失败: {}", e))?;

    let screen = screens
        .get(screen_index)
        .ok_or_else(|| format!("屏幕索引 {} 不存在", screen_index))?;

    let image = screen.capture().map_err(|e| format!("截图失败: {}", e))?;
    encode_rgba_image_base64_fast(&image)
}

// 区域截图
pub fn capture_region(x: i32, y: i32, width: i32, height: i32) -> Result<String, String> {
    if width <= 0 || height <= 0 {
        return Err("宽度和高度必须大于0".to_string());
    }

    // 先截全屏
    let screens = Screen::all().map_err(|e| format!("获取屏幕失败: {}", e))?;
    let screen = screens
        .into_iter()
        .find(|s| s.display_info.is_primary)
        .ok_or_else(|| "未找到主屏幕".to_string())?;

    let full_image = screen.capture().map_err(|e| format!("截图失败: {}", e))?;

    // 裁剪区域
    let cropped = crop_image(&full_image, x, y, width as u32, height as u32)?;

    encode_rgba_image_base64_fast(&cropped)
}

fn capture_primary_image() -> Result<ImageBuffer<Rgba<u8>, Vec<u8>>, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕失败: {}", e))?;
    let screen = screens
        .into_iter()
        .find(|s| s.display_info.is_primary)
        .ok_or_else(|| "未找到主屏幕".to_string())?;

    screen.capture().map_err(|e| format!("截图失败: {}", e))
}

pub fn capture_region_image(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<ImageBuffer<Rgba<u8>, Vec<u8>>, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕失败: {}", e))?;
    let center_x = x + width as i32 / 2;
    let center_y = y + height as i32 / 2;
    println!(
        "[long-screenshot] capture_region_image: request x={}, y={}, width={}, height={}, center=({}, {})",
        x, y, width, height, center_x, center_y
    );

    let screen = screens
        .iter()
        .find(|screen| {
            let info = &screen.display_info;
            center_x >= info.x
                && center_x < info.x + info.width as i32
                && center_y >= info.y
                && center_y < info.y + info.height as i32
        })
        .or_else(|| screens.iter().find(|screen| screen.display_info.is_primary))
        .ok_or_else(|| "未找到可用屏幕".to_string())?;

    println!(
        "[long-screenshot] capture_region_image: screen x={}, y={}, width={}, height={}, primary={}",
        screen.display_info.x,
        screen.display_info.y,
        screen.display_info.width,
        screen.display_info.height,
        screen.display_info.is_primary
    );
    let full_image = screen.capture().map_err(|e| format!("截图失败: {}", e))?;
    crop_image(
        &full_image,
        x - screen.display_info.x,
        y - screen.display_info.y,
        width,
        height,
    )
}

pub fn capture_region_dynamic_image(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<::image::DynamicImage, String> {
    let image = capture_region_image(x, y, width, height)?;
    let image_width = image.width();
    let image_height = image.height();
    let raw = image.into_raw();
    let rgba = ::image::RgbaImage::from_raw(image_width, image_height, raw)
        .ok_or_else(|| "无法创建长截图图像缓冲区".to_string())?;
    Ok(::image::DynamicImage::ImageRgba8(rgba))
}

#[allow(dead_code)]
pub fn capture_fullscreen_base64_and_region_image(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(String, RgbaImage), String> {
    let full_image = capture_primary_image()?;
    let full_base64 = encode_rgba_image_base64(&full_image)?;
    let region = crop_image(&full_image, x, y, width, height)?;
    Ok((full_base64, region))
}

#[cfg(target_os = "windows")]
#[allow(dead_code)]
pub fn get_window_handle_at_point(x: i32, y: i32) -> Result<isize, String> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::WindowFromPoint;

    unsafe {
        let hwnd = WindowFromPoint(POINT { x, y });
        if hwnd.0 == 0 {
            Err("无法获取选区内窗口".to_string())
        } else {
            Ok(hwnd.0)
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_window_handle_at_point(_x: i32, _y: i32) -> Result<isize, String> {
    Err("仅支持 Windows 平台".to_string())
}

#[cfg(target_os = "windows")]
#[allow(dead_code)]
fn capture_window_client_image(
    target_hwnd: isize,
) -> Result<(RgbaImage, i32, i32, u32, u32), String> {
    use winapi::shared::windef::POINT as WinPoint;
    use winapi::um::winuser::ClientToScreen;
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

    unsafe {
        let hwnd = HWND(target_hwnd);
        if hwnd.0 == 0 {
            return Err("目标窗口句柄无效".to_string());
        }

        let mut rect = RECT::default();
        if GetClientRect(hwnd, &mut rect).is_err() {
            return Err("无法获取窗口客户区大小".to_string());
        }

        let width = (rect.right - rect.left) as u32;
        let height = (rect.bottom - rect.top) as u32;
        if width == 0 || height == 0 {
            return Err("窗口客户区大小无效".to_string());
        }

        // 获取客户区左上角在屏幕上的真实坐标，避免标题栏/边框/DPI 偏移。
        let mut origin = WinPoint { x: 0, y: 0 };
        if ClientToScreen(hwnd.0 as _, &mut origin) == 0 {
            return Err("无法获取窗口客户区坐标".to_string());
        }
        let origin_x = origin.x;
        let origin_y = origin.y;

        let hdc_window = GetDC(hwnd);
        if hdc_window.0 == 0 {
            return Err("无法获取窗口 DC".to_string());
        }

        let hdc_mem = CreateCompatibleDC(hdc_window);
        let hbitmap = CreateCompatibleBitmap(hdc_window, width as i32, height as i32);
        let old_bitmap = SelectObject(hdc_mem, hbitmap);
        let _ = BitBlt(
            hdc_mem,
            0,
            0,
            width as i32,
            height as i32,
            hdc_window,
            0,
            0,
            SRCCOPY,
        );

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [Default::default(); 1],
        };

        let mut buffer = vec![0u8; (width * height * 4) as usize];
        GetDIBits(
            hdc_mem,
            hbitmap,
            0,
            height,
            Some(buffer.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(hdc_mem, old_bitmap);
        DeleteObject(hbitmap);
        DeleteDC(hdc_mem);
        ReleaseDC(hwnd, hdc_window);

        let mut rgba_buffer = Vec::with_capacity((width * height * 4) as usize);
        for chunk in buffer.chunks(4) {
            rgba_buffer.push(chunk[2]);
            rgba_buffer.push(chunk[1]);
            rgba_buffer.push(chunk[0]);
            rgba_buffer.push(chunk[3]);
        }

        let image = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_raw(width, height, rgba_buffer)
            .ok_or_else(|| "无法创建窗口图像缓冲区".to_string())?;

        Ok((image, origin_x, origin_y, width, height))
    }
}

#[cfg(target_os = "windows")]
#[allow(dead_code)]
pub fn capture_window_region_image(
    target_hwnd: isize,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<RgbaImage, String> {
    let (image, origin_x, origin_y, _, _) = capture_window_client_image(target_hwnd)?;
    crop_image(&image, x - origin_x, y - origin_y, width, height)
}

#[cfg(not(target_os = "windows"))]
pub fn capture_window_region_image(
    _target_hwnd: isize,
    _x: i32,
    _y: i32,
    _width: u32,
    _height: u32,
) -> Result<RgbaImage, String> {
    Err("仅支持 Windows 平台".to_string())
}

#[allow(dead_code)]
fn decode_base64_rgba_image(base64_data: &str) -> Result<RgbaImage, String> {
    let bytes = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Base64解码失败: {}", e))?;
    let image = load_from_memory(&bytes).map_err(|e| format!("图片解码失败: {}", e))?;
    Ok(image.to_rgba8())
}

fn encode_rgba_image_base64(image: &RgbaImage) -> Result<String, String> {
    encode_rgba_image_base64_fast(image)
}

fn encode_rgba_image_base64_fast(image: &RgbaImage) -> Result<String, String> {
    let mut buffer = Vec::new();
    PngEncoder::new_with_quality(&mut buffer, PngCompressionType::Fast, PngFilterType::Paeth)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ColorType::Rgba8,
        )
        .map_err(|e| format!("图片编码失败: {}", e))?;
    Ok(general_purpose::STANDARD.encode(&buffer))
}

fn rgba24_to_dynamic25(image: RgbaImage) -> Result<::image::DynamicImage, String> {
    let width = image.width();
    let height = image.height();
    let rgba = ::image::RgbaImage::from_raw(width, height, image.into_raw())
        .ok_or_else(|| "无法转换长截图图像缓冲区".to_string())?;
    Ok(::image::DynamicImage::ImageRgba8(rgba))
}

fn encode_dynamic25_base64(image: &::image::DynamicImage) -> Result<String, String> {
    use ::image::codecs::png::{
        CompressionType as PngCompressionType25, FilterType as PngFilterType25, PngEncoder,
    };
    use ::image::{ColorType as ColorType25, ImageEncoder};

    let rgba = image.to_rgba8();
    let mut buffer = Vec::new();
    PngEncoder::new_with_quality(
        &mut buffer,
        PngCompressionType25::Fast,
        PngFilterType25::Paeth,
    )
    .write_image(
        rgba.as_raw(),
        rgba.width(),
        rgba.height(),
        ColorType25::Rgba8.into(),
    )
    .map_err(|e| format!("图片编码失败: {}", e))?;
    Ok(general_purpose::STANDARD.encode(&buffer))
}

#[allow(dead_code)]
fn crop_rgba_image(
    image: &RgbaImage,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<RgbaImage, String> {
    crop_image(image, x, y, width, height)
}

fn row_diff(prev: &RgbaImage, next: &RgbaImage, prev_y: u32, next_y: u32) -> f64 {
    let width = prev.width().min(next.width()) as usize;
    if width == 0 {
        return f64::MAX;
    }

    let sample_step = ((width / 64).max(1)) as u32;
    let mut total = 0.0f64;
    let mut count = 0usize;

    let mut x = 0u32;
    while x < width as u32 {
        let p1 = prev.get_pixel(x, prev_y).0;
        let p2 = next.get_pixel(x, next_y).0;
        total += ((p1[0] as f64 - p2[0] as f64).abs()
            + (p1[1] as f64 - p2[1] as f64).abs()
            + (p1[2] as f64 - p2[2] as f64).abs())
            / 3.0;
        count += 1;
        x += sample_step;
    }

    if count == 0 {
        f64::MAX
    } else {
        total / count as f64
    }
}

fn calc_overlap_score(prev: &RgbaImage, next: &RgbaImage, overlap: u32) -> f64 {
    if overlap == 0 {
        return f64::MAX;
    }

    let sample_rows = overlap.min(48);
    let row_step = (overlap / sample_rows.max(1)).max(1);
    let mut total = 0.0f64;
    let mut count = 0usize;
    let mut i = 0u32;

    while i < overlap {
        let prev_y = prev.height().saturating_sub(overlap) + i;
        let next_y = i;
        total += row_diff(prev, next, prev_y, next_y);
        count += 1;
        i += row_step;
    }

    if count == 0 {
        f64::MAX
    } else {
        total / count as f64
    }
}

fn find_vertical_overlap(prev: &RgbaImage, next: &RgbaImage) -> Option<u32> {
    let height = prev.height().min(next.height());
    if height < 80 {
        return None;
    }

    // 长截图滚动通常是“小位移、大重叠”，尤其是浏览器和表格场景。
    // 把搜索范围收紧到较大的重叠区间，避免重复列表/表格行造成错配。
    let min_overlap = ((height as f32 * 0.55).round() as u32).max(60);
    let max_overlap = height.saturating_sub(8);
    let mut best_overlap = 0u32;
    let mut best_score = f64::MAX;
    let mut overlap = min_overlap;

    while overlap <= max_overlap {
        let score = calc_overlap_score(prev, next, overlap);
        if score < best_score || ((score - best_score).abs() < 0.75 && overlap > best_overlap) {
            best_score = score;
            best_overlap = overlap;
        }
        overlap += 2;
    }

    if best_overlap > 0 && best_score < 14.0 {
        Some(best_overlap)
    } else {
        None
    }
}

#[allow(dead_code)]
fn frames_are_nearly_identical(prev: &RgbaImage, next: &RgbaImage) -> bool {
    let width = prev.width().min(next.width());
    let height = prev.height().min(next.height());
    if width < 8 || height < 8 {
        return false;
    }

    let margin_x = (width / 32).max(4);
    let margin_y = (height / 32).max(4);
    let start_x = margin_x.min(width.saturating_sub(1));
    let end_x = width.saturating_sub(margin_x).max(start_x + 1);
    let start_y = margin_y.min(height.saturating_sub(1));
    let end_y = height.saturating_sub(margin_y).max(start_y + 1);
    let step_x = ((end_x - start_x) / 24).max(1);
    let step_y = ((end_y - start_y) / 24).max(1);

    let mut total = 0f64;
    let mut count = 0u32;
    let mut y = start_y;
    while y < end_y {
        let mut x = start_x;
        while x < end_x {
            let p1 = prev.get_pixel(x, y);
            let p2 = next.get_pixel(x, y);
            total += ((p1[0] as i32 - p2[0] as i32).abs()
                + (p1[1] as i32 - p2[1] as i32).abs()
                + (p1[2] as i32 - p2[2] as i32).abs()) as f64
                / 3.0;
            count += 1;
            x += step_x;
        }
        y += step_y;
    }

    count > 0 && (total / count as f64) < 10.0
}

fn append_stitched_image(base: &RgbaImage, next: &RgbaImage, overlap: u32) -> RgbaImage {
    let unique_height = next.height().saturating_sub(overlap);
    let mut stitched = RgbaImage::new(base.width(), base.height() + unique_height);

    for y in 0..base.height() {
        for x in 0..base.width() {
            stitched.put_pixel(x, y, *base.get_pixel(x, y));
        }
    }

    for y in overlap..next.height() {
        for x in 0..next.width() {
            stitched.put_pixel(x, base.height() + (y - overlap), *next.get_pixel(x, y));
        }
    }

    stitched
}

#[allow(dead_code)]
pub fn init_scroll_screenshot_session(
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    initial_frame_base64: &str,
) -> Result<ScrollScreenshotSession, String> {
    if width <= 0 || height <= 0 {
        return Err("宽度和高度必须大于0".to_string());
    }

    let initial_frame = decode_base64_rgba_image(initial_frame_base64)?;
    let initial_frame = rgba24_to_dynamic25(initial_frame)?;
    create_scroll_screenshot_session(x, y, width as u32, height as u32, initial_frame)
}

pub fn create_scroll_screenshot_session(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    initial_frame: ::image::DynamicImage,
) -> Result<ScrollScreenshotSession, String> {
    if width == 0 || height == 0 {
        return Err("宽度和高度必须大于0".to_string());
    }

    let mut stitcher = ScrollScreenshotService::new();
    stitcher.init_for_region(width, height);
    let (result, _) = stitcher.handle_image(initial_frame, ScrollImageList::Bottom);
    println!(
        "[long-screenshot] session init: stitcher first result={}",
        result.is_some()
    );
    if result.is_none() {
        return Err("长截图初始化失败：未识别到可拼接图像特征".to_string());
    }

    Ok(ScrollScreenshotSession {
        x,
        y,
        width,
        height,
        focus_x: x + width as i32 / 2,
        focus_y: y + height as i32 / 2,
        stitcher,
    })
}

pub fn set_scroll_screenshot_target(
    session: &mut ScrollScreenshotSession,
    _target_hwnd: Option<isize>,
    focus_x: i32,
    focus_y: i32,
) {
    session.focus_x = focus_x;
    session.focus_y = focus_y;
    println!(
        "[long-screenshot] target focus locked: focus=({}, {})",
        session.focus_x, session.focus_y
    );
}

pub fn export_scroll_screenshot_session(
    session: &mut ScrollScreenshotSession,
) -> Result<String, String> {
    let image = session
        .stitcher
        .export()
        .ok_or_else(|| "长截图暂无可导出内容".to_string())?;
    encode_dynamic25_base64(&image)
}

pub fn handle_scroll_screenshot_step_image(
    session: &mut ScrollScreenshotSession,
    current: ::image::DynamicImage,
) -> Result<bool, String> {
    let (result, is_origin) = session
        .stitcher
        .handle_image(current, ScrollImageList::Bottom);
    let has_append = result.and_then(|(_, list)| list).is_some();
    println!(
        "[long-screenshot] handle step image: is_origin={}, has_append={}, top_size={}, bottom_size={}",
        is_origin,
        has_append,
        session.stitcher.top_image_size,
        session.stitcher.bottom_image_size
    );
    Ok(!is_origin && has_append)
}

#[allow(dead_code)]
pub fn capture_scroll_screenshot_step(
    session: &mut ScrollScreenshotSession,
    fallback_focus_x: i32,
    fallback_focus_y: i32,
    scroll_amount: i32,
) -> Result<ScrollScreenshotStepResult, String> {
    if let Some(result) =
        begin_scroll_screenshot_step(session, fallback_focus_x, fallback_focus_y, scroll_amount)?
    {
        return Ok(result);
    }

    println!("[long-screenshot] step: capture after scroll");
    let current_frame =
        capture_region_dynamic_image(session.x, session.y, session.width, session.height)?;
    finish_scroll_screenshot_step(session, current_frame)
}

pub fn begin_scroll_screenshot_step(
    session: &ScrollScreenshotSession,
    fallback_focus_x: i32,
    fallback_focus_y: i32,
    scroll_amount: i32,
) -> Result<Option<ScrollScreenshotStepResult>, String> {
    let current_height = scroll_screenshot_height(session);
    if current_height >= MAX_SCROLL_SCREENSHOT_HEIGHT {
        return Ok(Some(ScrollScreenshotStepResult {
            changed: false,
            full_base64: String::new(),
            frame_base64: String::new(),
            stitched_base64: String::new(),
            stitched_height: current_height,
            reached_limit: true,
        }));
    }

    scroll_page_for_session(session, fallback_focus_x, fallback_focus_y, scroll_amount)?;
    println!("[long-screenshot] step: scroll_page_for_session done");
    Ok(None)
}

pub fn finish_scroll_screenshot_step(
    session: &mut ScrollScreenshotSession,
    current_frame: ::image::DynamicImage,
) -> Result<ScrollScreenshotStepResult, String> {
    println!(
        "[long-screenshot] step: current frame captured {}x{}",
        current_frame.width(),
        current_frame.height()
    );

    let frame_base64 = encode_dynamic25_base64(&current_frame)?;
    let changed = handle_scroll_screenshot_step_image(session, current_frame)?;
    let stitched_height = scroll_screenshot_height(session);
    let reached_limit = stitched_height >= MAX_SCROLL_SCREENSHOT_HEIGHT;
    let stitched_base64 = export_scroll_screenshot_session(session)?;
    println!(
        "[long-screenshot] step: changed={}, stitched_bytes={}",
        changed,
        stitched_base64.len()
    );

    Ok(ScrollScreenshotStepResult {
        changed,
        full_base64: String::new(),
        frame_base64,
        stitched_base64,
        stitched_height,
        reached_limit,
    })
}

fn scroll_screenshot_height(session: &ScrollScreenshotSession) -> u32 {
    (session.stitcher.top_image_size + session.stitcher.bottom_image_size).max(0) as u32
}

#[allow(dead_code)]
pub fn handle_scroll_screenshot_step(
    session: &mut ScrollScreenshotSession,
    full_base64: &str,
) -> Result<bool, String> {
    let full_image = decode_base64_rgba_image(full_base64)?;
    let current = crop_rgba_image(
        &full_image,
        session.x,
        session.y,
        session.width,
        session.height,
    )?;

    handle_scroll_screenshot_step_image(session, rgba24_to_dynamic25(current)?)
}

pub fn capture_long_region(x: i32, y: i32, width: i32, height: i32) -> Result<String, String> {
    if width <= 0 || height <= 0 {
        return Err("宽度和高度必须大于0".to_string());
    }

    let width = width as u32;
    let height = height as u32;

    let mut enigo = Enigo::new();
    let center_x = x + (width as i32 / 2);
    let center_y = y + (height as i32 / 2);
    enigo.mouse_move_to(center_x, center_y);
    thread::sleep(Duration::from_millis(80));

    let mut previous = capture_region_image(x, y, width, height)?;
    let mut stitched = previous.clone();
    let mut stagnant_count = 0usize;
    let max_steps = 18usize;
    let max_total_height = 20000u32;

    for _ in 0..max_steps {
        enigo.mouse_scroll_y(-7);
        thread::sleep(Duration::from_millis(280));

        let current = capture_region_image(x, y, width, height)?;
        let overlap = match find_vertical_overlap(&previous, &current) {
            Some(v) => v,
            None => break,
        };

        let unique_height = height.saturating_sub(overlap);
        if unique_height < 8 {
            stagnant_count += 1;
            if stagnant_count >= 2 {
                break;
            }
            continue;
        }
        stagnant_count = 0;

        stitched = append_stitched_image(&stitched, &current, overlap);
        if stitched.height() >= max_total_height {
            break;
        }

        previous = current;
    }

    let mut buffer = Vec::new();
    DynamicImage::ImageRgba8(stitched)
        .write_to(&mut std::io::Cursor::new(&mut buffer), ImageFormat::Png)
        .map_err(|e| format!("图片编码失败: {}", e))?;

    Ok(general_purpose::STANDARD.encode(&buffer))
}

pub fn focus_page_at(focus_x: i32, focus_y: i32) -> Result<(), String> {
    let mut enigo = Enigo::new();
    enigo.mouse_move_to(focus_x, focus_y);
    let _ = focus_window_at_point(focus_x, focus_y);
    thread::sleep(Duration::from_millis(80));
    Ok(())
}

#[cfg(target_os = "windows")]
fn focus_window_at_point(focus_x: i32, focus_y: i32) -> Result<(), String> {
    use winapi::shared::windef::POINT;
    use winapi::um::winuser::{GetAncestor, SetForegroundWindow, WindowFromPoint, GA_ROOT};

    unsafe {
        let hwnd = WindowFromPoint(POINT {
            x: focus_x,
            y: focus_y,
        });
        if hwnd.is_null() {
            return Err("无法获取焦点窗口".to_string());
        }

        let root = GetAncestor(hwnd, GA_ROOT);
        let target = if root.is_null() { hwnd } else { root };
        if SetForegroundWindow(target) == 0 {
            return Err("无法激活滚动目标窗口".to_string());
        }
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn focus_window_at_point(_focus_x: i32, _focus_y: i32) -> Result<(), String> {
    Err("仅支持 Windows 平台".to_string())
}

#[cfg(target_os = "windows")]
#[allow(dead_code)]
pub fn get_foreground_window_handle() -> Result<isize, String> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0 == 0 {
            Err("无法获取前台窗口".to_string())
        } else {
            Ok(hwnd.0)
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_foreground_window_handle() -> Result<isize, String> {
    Err("仅支持 Windows 平台".to_string())
}

#[cfg(target_os = "windows")]
#[allow(dead_code)]
pub fn scroll_window_with_wheel(
    target_hwnd: isize,
    focus_x: i32,
    focus_y: i32,
    scroll_amount: i32,
) -> Result<(), String> {
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{SendMessageW, WM_MOUSEWHEEL};

    if target_hwnd == 0 {
        return Err("目标窗口句柄无效".to_string());
    }

    let wheel_notches = normalized_scroll_notches(scroll_amount);
    let wheel_delta = if wheel_notches > 0 { 120 } else { -120 };
    let wparam = WPARAM(((wheel_delta as u32) << 16) as usize);
    let lparam = LPARAM((((focus_y as u16 as u32) << 16) | (focus_x as u16 as u32)) as isize);

    unsafe {
        for _ in 0..wheel_notches.unsigned_abs() {
            SendMessageW(HWND(target_hwnd), WM_MOUSEWHEEL, wparam, lparam);
            thread::sleep(Duration::from_millis(8));
        }
    }

    thread::sleep(Duration::from_millis(280));
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn scroll_window_with_wheel(
    _target_hwnd: isize,
    _focus_x: i32,
    _focus_y: i32,
    _scroll_amount: i32,
) -> Result<(), String> {
    Err("仅支持 Windows 平台".to_string())
}

pub fn scroll_page_at(focus_x: i32, focus_y: i32, scroll_amount: i32) -> Result<(), String> {
    println!(
        "[long-screenshot] scroll_page_at: move cursor to target=({}, {}), amount={}",
        focus_x, focus_y, scroll_amount
    );
    if scroll_amount == 0 {
        return Ok(());
    }

    let mut enigo = Enigo::new();
    enigo.mouse_move_to(focus_x, focus_y);
    let _ = focus_window_at_point(focus_x, focus_y);
    thread::sleep(Duration::from_millis(80));

    scroll_with_enigo(&mut enigo, scroll_amount);
    Ok(())
}

pub fn scroll_page_for_session(
    session: &ScrollScreenshotSession,
    fallback_focus_x: i32,
    fallback_focus_y: i32,
    scroll_amount: i32,
) -> Result<(), String> {
    let focus_x = if session.focus_x != 0 {
        session.focus_x
    } else {
        fallback_focus_x
    };
    let focus_y = if session.focus_y != 0 {
        session.focus_y
    } else {
        fallback_focus_y
    };

    if scroll_amount == 0 {
        return Ok(());
    }

    scroll_page_at(focus_x, focus_y, scroll_amount)
}

fn normalized_scroll_notches(scroll_amount: i32) -> i32 {
    if scroll_amount > 0 {
        scroll_amount.max(1).min(3)
    } else {
        scroll_amount.min(-1).max(-3)
    }
}

fn scroll_with_enigo(enigo: &mut Enigo, scroll_amount: i32) {
    let wheel_notches = normalized_scroll_notches(scroll_amount);
    let direction = if wheel_notches > 0 { 1 } else { -1 };
    for _ in 0..wheel_notches.unsigned_abs() {
        enigo.mouse_scroll_y(direction);
        thread::sleep(Duration::from_millis(8));
    }
    thread::sleep(Duration::from_millis(280));
}

#[allow(dead_code)]
pub fn scroll_and_capture_fullscreen(
    focus_x: i32,
    focus_y: i32,
    scroll_amount: i32,
) -> Result<String, String> {
    scroll_page_at(focus_x, focus_y, scroll_amount)?;
    capture_fullscreen()
}

// 裁剪图片
fn crop_image(
    image: &ImageBuffer<Rgba<u8>, Vec<u8>>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<ImageBuffer<Rgba<u8>, Vec<u8>>, String> {
    let img_width = image.width();
    let img_height = image.height();

    let x = x.max(0) as u32;
    let y = y.max(0) as u32;
    let width = width.min(img_width.saturating_sub(x));
    let height = height.min(img_height.saturating_sub(y));

    if width == 0 || height == 0 {
        return Err("裁剪区域超出图片范围".to_string());
    }

    let mut cropped = ImageBuffer::new(width, height);
    for (cx, cy, pixel) in cropped.enumerate_pixels_mut() {
        let src_x = x + cx;
        let src_y = y + cy;
        if src_x < img_width && src_y < img_height {
            *pixel = *image.get_pixel(src_x, src_y);
        }
    }

    Ok(cropped)
}

// 保存截图到文件
pub fn save_screenshot(base64_data: &str, file_path: &str) -> Result<(), String> {
    let image_data = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Base64解码失败: {}", e))?;

    fs::write(file_path, image_data).map_err(|e| format!("保存文件失败: {}", e))?;

    Ok(())
}

// 获取默认截图保存目录
pub fn get_default_screenshot_dir() -> Result<PathBuf, String> {
    let pictures_dir = dirs::picture_dir().ok_or_else(|| "无法获取图片目录".to_string())?;
    let screenshot_dir = pictures_dir.join("Screenshots");

    if !screenshot_dir.exists() {
        fs::create_dir_all(&screenshot_dir).map_err(|e| format!("创建截图目录失败: {}", e))?;
    }

    Ok(screenshot_dir)
}

// 生成截图文件名
pub fn generate_screenshot_filename() -> String {
    let now = chrono::Local::now();
    format!("Screenshot_{}.png", now.format("%Y%m%d_%H%M%S"))
}

// 捕获指定坐标下的窗口（Windows 平台）
#[allow(dead_code)]
#[cfg(target_os = "windows")]
pub fn capture_window_at_cursor(x: i32, y: i32) -> Result<String, String> {
    use windows::Win32::Foundation::{POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, WindowFromPoint};

    unsafe {
        // 获取指定坐标下的窗口
        let point = POINT { x, y };
        let hwnd = WindowFromPoint(point);
        if hwnd.0 == 0 {
            return Err("无法获取窗口".to_string());
        }

        // 获取窗口客户区大小
        let mut rect = RECT::default();
        if GetClientRect(hwnd, &mut rect).is_err() {
            return Err("无法获取窗口大小".to_string());
        }

        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;

        if width <= 0 || height <= 0 {
            return Err("窗口大小无效".to_string());
        }

        // 获取窗口 DC
        let hdc_window = GetDC(hwnd);
        if hdc_window.0 == 0 {
            return Err("无法获取窗口 DC".to_string());
        }

        // 创建兼容 DC 和位图
        let hdc_mem = CreateCompatibleDC(hdc_window);
        let hbitmap = CreateCompatibleBitmap(hdc_window, width, height);
        let old_bitmap = SelectObject(hdc_mem, hbitmap);

        // 复制窗口内容到内存 DC
        let _ = BitBlt(hdc_mem, 0, 0, width, height, hdc_window, 0, 0, SRCCOPY);

        // 准备位图信息
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [Default::default(); 1],
        };

        // 获取位图数据
        let mut buffer = vec![0u8; (width * height * 4) as usize];
        use windows::Win32::Graphics::Gdi::GetDIBits;
        GetDIBits(
            hdc_mem,
            hbitmap,
            0,
            height as u32,
            Some(buffer.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        // 清理资源
        SelectObject(hdc_mem, old_bitmap);
        DeleteObject(hbitmap);
        DeleteDC(hdc_mem);
        ReleaseDC(hwnd, hdc_window);

        // 转换为 RGBA 格式
        let mut rgba_buffer = Vec::with_capacity((width * height * 4) as usize);
        for chunk in buffer.chunks(4) {
            rgba_buffer.push(chunk[2]); // R
            rgba_buffer.push(chunk[1]); // G
            rgba_buffer.push(chunk[0]); // B
            rgba_buffer.push(chunk[3]); // A
        }

        let image =
            ImageBuffer::<Rgba<u8>, Vec<u8>>::from_raw(width as u32, height as u32, rgba_buffer)
                .ok_or_else(|| "无法创建图像缓冲区".to_string())?;

        // 编码为 PNG
        let mut png_buffer = Vec::new();
        image
            .write_to(&mut std::io::Cursor::new(&mut png_buffer), ImageFormat::Png)
            .map_err(|e| format!("图片编码失败: {}", e))?;

        Ok(general_purpose::STANDARD.encode(&png_buffer))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn capture_window_at_cursor(_x: i32, _y: i32) -> Result<String, String> {
    Err("窗口截图仅支持 Windows 平台".to_string())
}

// 捕获活动窗口（Windows 平台）
#[allow(dead_code)]
#[cfg(target_os = "windows")]
pub fn capture_active_window() -> Result<String, String> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, GetForegroundWindow};

    unsafe {
        // 获取前台窗口
        let hwnd = GetForegroundWindow();
        if hwnd.0 == 0 {
            return Err("无法获取前台窗口".to_string());
        }

        // 获取窗口客户区大小
        let mut rect = RECT::default();
        if GetClientRect(hwnd, &mut rect).is_err() {
            return Err("无法获取窗口大小".to_string());
        }

        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;

        if width <= 0 || height <= 0 {
            return Err("窗口大小无效".to_string());
        }

        // 获取窗口 DC
        let hdc_window = GetDC(hwnd);
        if hdc_window.0 == 0 {
            return Err("无法获取窗口 DC".to_string());
        }

        // 创建兼容 DC 和位图
        let hdc_mem = CreateCompatibleDC(hdc_window);
        let hbitmap = CreateCompatibleBitmap(hdc_window, width, height);
        let old_bitmap = SelectObject(hdc_mem, hbitmap);

        // 复制窗口内容到内存 DC
        let _ = BitBlt(hdc_mem, 0, 0, width, height, hdc_window, 0, 0, SRCCOPY);

        // 准备位图信息
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height, // 负值表示自上而下
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [Default::default(); 1],
        };

        // 获取位图数据
        let mut buffer = vec![0u8; (width * height * 4) as usize];
        use windows::Win32::Graphics::Gdi::GetDIBits;
        GetDIBits(
            hdc_mem,
            hbitmap,
            0,
            height as u32,
            Some(buffer.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        // 清理资源
        SelectObject(hdc_mem, old_bitmap);
        DeleteObject(hbitmap);
        DeleteDC(hdc_mem);
        ReleaseDC(hwnd, hdc_window);

        // 转换为 RGBA 格式的 ImageBuffer
        let mut rgba_buffer = Vec::with_capacity((width * height * 4) as usize);
        for chunk in buffer.chunks(4) {
            rgba_buffer.push(chunk[2]); // R
            rgba_buffer.push(chunk[1]); // G
            rgba_buffer.push(chunk[0]); // B
            rgba_buffer.push(chunk[3]); // A
        }

        let image =
            ImageBuffer::<Rgba<u8>, Vec<u8>>::from_raw(width as u32, height as u32, rgba_buffer)
                .ok_or_else(|| "无法创建图像缓冲区".to_string())?;

        // 编码为 PNG
        let mut png_buffer = Vec::new();
        image
            .write_to(&mut std::io::Cursor::new(&mut png_buffer), ImageFormat::Png)
            .map_err(|e| format!("图片编码失败: {}", e))?;

        Ok(general_purpose::STANDARD.encode(&png_buffer))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn capture_active_window() -> Result<String, String> {
    Err("窗口截图仅支持 Windows 平台".to_string())
}
