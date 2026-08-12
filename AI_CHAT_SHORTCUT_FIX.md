# AI 聊天快捷键修复说明

## 问题描述

用户在全局设置中修改了 AI 聊天快捷键（从默认的 `Alt+G` 改为 `Alt+5`），但修改后软件仍然响应旧的快捷键 `Alt+G`，新的快捷键 `Alt+5` 不生效。

## 问题定位

通过检查发现：

1. **配置文件已正确保存**：`C:\Users\nfksu\AppData\Roaming\McStartUP\settings.json` 中 `aiChatShortcut` 字段已更新为 `Alt+5`
2. **快捷键注册逻辑有缺陷**：在 `register_ai_chat_shortcut` 函数中，只注销了新的快捷键，但没有注销旧的快捷键
3. **结果**：旧的 `Alt+G` 和新的 `Alt+5` 同时生效，但用户期望只有新的快捷键生效

## 根本原因

在 `src-tauri/src/commands.rs` 中的快捷键更新命令（`update_ai_chat_shortcut`、`update_global_shortcut`、`update_clipboard_shortcut`、`update_toolbox_shortcut`）没有先注销旧的快捷键，导致旧快捷键残留。

## 修复方案

### 1. 修改快捷键更新命令

在 `src-tauri/src/commands.rs` 中，为所有快捷键更新命令添加"先注销旧快捷键"的逻辑：

```rust
#[tauri::command]
pub fn update_ai_chat_shortcut(
    shortcut: String,
    app_handle: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    // 先获取旧的快捷键设置并注销
    if let Ok(settings_manager) = state.settings.lock() {
        if let Ok(old_settings) = settings_manager.load() {
            if let Some(old_shortcut) = old_settings.ai_chat_shortcut {
                let mut gsm = app_handle.global_shortcut_manager();
                let _ = gsm.unregister(&old_shortcut);
            }
        }
    }

    // 注册新的快捷键
    crate::register_ai_chat_shortcut(&app_handle, &shortcut);
    Ok(())
}
```

### 2. 添加必要的导入

在 `src-tauri/src/commands.rs` 顶部添加 `GlobalShortcutManager` trait 的导入：

```rust
use tauri::{GlobalShortcutManager, State};
```

### 3. 修复其他快捷键命令

同样的修复应用到：

- `update_global_shortcut`（快速启动快捷键）
- `update_clipboard_shortcut`（剪贴板快捷键）
- `update_toolbox_shortcut`（工具箱快捷键）

## 测试步骤

1. **安装修复后的版本**：
   - 运行 `D:\website\mcheng-start-up\src-tauri\target\release\bundle\nsis\McStartUP_0.1.0_x64-setup.exe`

2. **测试快捷键修改**：
   - 打开软件设置
   - 修改 AI 聊天快捷键为 `Alt+5`
   - 点击保存
   - 测试 `Alt+G`（应该不再响应）
   - 测试 `Alt+5`（应该正常打开 AI 聊天）

3. **测试重启后的持久化**：
   - 关闭软件
   - 重新启动软件
   - 测试 `Alt+5`（应该正常工作）
   - 测试 `Alt+G`（应该不响应）

## 修改的文件

1. `src-tauri/src/commands.rs`
   - 添加 `GlobalShortcutManager` 导入
   - 修改 `update_global_shortcut` 函数
   - 修改 `update_clipboard_shortcut` 函数
   - 修改 `update_toolbox_shortcut` 函数
   - 修改 `update_ai_chat_shortcut` 函数

2. `src/components/ChatInterface.tsx`
   - 删除未使用的 `onShowMemoryPanel` 参数

3. `src/components/AIChatPanel.tsx`
   - 删除 `onShowMemoryPanel` 属性传递

4. `src/components/QuickLauncherWindow.tsx`
   - 删除未使用的 `aiProviders` 和 `defaultAiModel` 变量

## 预期效果

修复后，当用户在设置中修改快捷键时：

1. 旧的快捷键会被立即注销
2. 新的快捷键会被立即注册
3. 只有新的快捷键会响应用户操作
4. 重启软件后，新的快捷键设置会被正确加载

## 安装包位置

- **NSIS 安装包**：`D:\website\mcheng-start-up\src-tauri\target\release\bundle\nsis\McStartUP_0.1.0_x64-setup.exe`
- **MSI 安装包**：`D:\website\mcheng-start-up\src-tauri\target\release\bundle\msi\McStartUP_0.1.0_x64_zh-CN.msi`
