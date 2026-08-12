use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenInfo {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
}

#[cfg(target_os = "windows")]
pub fn get_cursor_position() -> Result<CursorPosition, String> {
    use winapi::shared::windef::POINT;
    use winapi::um::winuser::GetCursorPos;

    unsafe {
        let mut point = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut point) != 0 {
            Ok(CursorPosition {
                x: point.x,
                y: point.y,
            })
        } else {
            Err("获取光标位置失败".to_string())
        }
    }
}

#[cfg(target_os = "windows")]
pub fn get_screen_info() -> Result<ScreenInfo, String> {
    use winapi::um::winuser::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

    unsafe {
        let width = GetSystemMetrics(SM_CXSCREEN) as u32;
        let height = GetSystemMetrics(SM_CYSCREEN) as u32;

        Ok(ScreenInfo {
            width,
            height,
            x: 0,
            y: 0,
        })
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_cursor_position() -> Result<CursorPosition, String> {
    Err("当前系统不支持获取光标位置".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn get_screen_info() -> Result<ScreenInfo, String> {
    Err("当前系统不支持获取屏幕信息".to_string())
}

/// 计算窗口位置（靠近光标，但保持在屏幕内）
pub fn calculate_window_position(
    cursor_pos: CursorPosition,
    window_width: u32,
    window_height: u32,
    screen_info: ScreenInfo,
) -> (i32, i32) {
    let offset = 20; // 距离光标的偏移量

    // 初始位置：光标右下方
    let mut window_x = cursor_pos.x + offset;
    let mut window_y = cursor_pos.y + offset;

    // 检查右边界
    if window_x + window_width as i32 > screen_info.x + screen_info.width as i32 {
        // 放到光标左边
        window_x = cursor_pos.x - window_width as i32 - offset;
    }

    // 检查底边界
    if window_y + window_height as i32 > screen_info.y + screen_info.height as i32 {
        // 调整到屏幕底部
        window_y = screen_info.y + screen_info.height as i32 - window_height as i32 - 10;
    }

    // 检查左边界
    if window_x < screen_info.x {
        window_x = screen_info.x + 10;
    }

    // 检查顶边界
    if window_y < screen_info.y {
        window_y = screen_info.y + 10;
    }

    (window_x, window_y)
}
