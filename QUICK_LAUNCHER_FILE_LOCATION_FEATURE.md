# 快捷搜索 - 添加"打开文件所在目录"功能

## 功能描述

在快捷搜索（Alt+空格）中，当搜索到本地文件时，现在可以快速打开文件所在的目录。

## 使用方法

1. 按 `Alt+空格` 打开快捷搜索
2. 输入文件名进行搜索（需要安装并运行 Everything）
3. 在文件搜索结果中，每个文件项右侧会显示一个 📁 图标
4. 点击 📁 图标即可打开文件所在的目录

## 功能特点

- ✅ **智能处理**：
  - 对于文件：打开所在目录
  - 对于文件夹：直接打开该文件夹（点击主按钮）
- ✅ **视觉反馈**：
  - 鼠标悬停时图标变为黄色
  - 有明确的 tooltip 提示"打开文件所在目录"

- ✅ **不影响主操作**：
  - 点击文件项本身：打开文件
  - 点击 📁 图标：打开所在目录
  - 两个操作互不干扰

## 实现细节

### 前端修改 (src/components/QuickLauncherWindow.tsx)

1. **添加新的处理函数**：

```typescript
const handleOpenFileLocation = useCallback(
  async (result: EverythingResult, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (result.isFolder) {
        await invoke('open_path', { targetPath: result.fullPath });
      } else {
        const dirPath = result.fullPath.substring(0, result.fullPath.lastIndexOf('\\'));
        await invoke('open_path', { targetPath: dirPath });
      }
      handleClose();
    } catch (error) {
      console.error('打开文件位置失败:', error);
    }
  },
  [handleClose]
);
```

2. **添加UI按钮**：

```tsx
{
  item.type === 'file' && !item.fileResult?.isFolder && (
    <button
      onClick={(e) => handleOpenFileLocation(item.fileResult!, e)}
      className="p-1 text-gray-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded transition-colors"
      title="打开文件所在目录"
    >
      <FolderOpen size={14} />
    </button>
  );
}
```

## 使用场景

1. **快速定位文件**：找到文件后，想要查看同目录下的其他文件
2. **文件管理**：需要对文件进行重命名、移动等操作
3. **查看上下文**：了解文件所在的目录结构

## 依赖

- Everything（用于文件搜索）
- 后端 `open_path` 命令（已存在）

## 测试建议

1. 搜索一个文件，点击 📁 图标，验证是否打开了正确的目录
2. 搜索一个文件夹，验证主按钮是否直接打开文件夹
3. 测试深层目录中的文件
4. 测试中文路径和特殊字符路径

## 界面预览

```
┌─────────────────────────────────────────────┐
│ 🔍 test.txt                                 │
├─────────────────────────────────────────────┤
│ 📄 test.txt                    [📁] ↵       │
│    C:\Users\...\Documents\test.txt          │
│                                             │
│ 📄 test2.txt                   [📁] ↵       │
│    C:\Users\...\Downloads\test2.txt         │
└─────────────────────────────────────────────┘
```

点击 [📁] 图标 → 打开文件所在目录
点击文件项本身 → 打开文件

## 相关文件

- `src/components/QuickLauncherWindow.tsx` - 快捷搜索窗口组件
