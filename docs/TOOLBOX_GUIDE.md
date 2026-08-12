# 工具箱开发指南

## 概述

McStartUP 的工具箱系统是一个可扩展的工具集合，提供了各种实用工具，包括文本处理、图片处理、网络工具、开发工具等。本文档详细说明工具箱的架构、工作流程以及如何添加新工具。

## 目录结构

```
src/
├── tools/                      # 工具组件目录
│   ├── registry.ts            # 工具注册表（核心配置文件）
│   ├── ToolboxWindow.tsx      # 工具箱主窗口
│   ├── ToolHeader.tsx         # 工具标题栏组件
│   ├── useToolTheme.ts        # 工具主题 Hook
│   ├── CalculatorTool.tsx     # 示例：计算器工具
│   ├── PinyinTool.tsx         # 示例：拼音转换工具
│   └── ...                    # 其他工具组件
├── App.tsx                     # 主应用路由
└── types/index.ts             # 类型定义

src-tauri/src/
├── commands.rs                 # Rust 后端命令
└── main.rs                     # 主程序入口
```

## 核心架构

### 1. 工具注册表 (`src/tools/registry.ts`)

这是工具箱的核心配置文件，所有工具都必须在这里注册。

#### 工具定义接口

```typescript
export interface ToolDefinition {
  id: string; // 唯一标识符
  name: string; // 工具名称
  description: string; // 工具描述
  keywords: string[]; // 搜索关键词
  categoryId: string; // 分类ID
  icon: string; // 图标（emoji）
  type: ToolType; // 工具类型
  windowLabel?: string; // 窗口标签（type='window'时必需）
  windowWidth?: number; // 窗口宽度
  windowHeight?: number; // 窗口高度
  linkUrl?: string; // 外部链接（type='link'时必需）
  inlineComponent?: string; // 内联组件名（type='inline'时使用）
}

export type ToolType = 'inline' | 'window' | 'link';
```

#### 工具类型说明

1. **window**: 独立窗口工具（最常用）
   - 在独立窗口中运行
   - 需要指定 `windowLabel`、`windowWidth`、`windowHeight`
   - 示例：计算器、图片编辑器、文本处理工具

2. **link**: 外部链接工具
   - 在浏览器中打开外部网站
   - 需要指定 `linkUrl`
   - 示例：在线工具、文档链接

3. **inline**: 内联工具（较少使用）
   - 在工具箱窗口内直接显示
   - 需要指定 `inlineComponent`

#### 工具分类

```typescript
export const ALL_CATEGORIES = [
  'efficiency', // 效率工具
  'text', // 文本处理
  'network', // 网络工具
  'dev', // 开发工具
  'image', // 图片处理
  'media', // 音视频处理
  'pdf', // PDF 工具
  'office', // Office 工具
  'other', // 其他
] as const;
```

### 2. 工具箱窗口 (`src/tools/ToolboxWindow.tsx`)

工具箱主窗口负责：

- 显示所有已注册的工具
- 提供搜索功能（按名称和关键词）
- 分类筛选
- 打开工具窗口或外部链接

核心功能：

```typescript
function openTool(tool: ToolDefinition) {
  if (tool.type === 'window' && tool.windowLabel) {
    // 调用后端命令打开工具窗口
    invoke('show_tool_window', { label: tool.windowLabel });
  } else if (tool.type === 'link' && tool.linkUrl) {
    // 在浏览器中打开链接
    open(tool.linkUrl);
  }
}
```

### 3. 应用路由 (`src/App.tsx`)

根据窗口标签（windowLabel）路由到对应的工具组件：

```typescript
if (windowLabel === 'tool-calculator') {
  return <CalculatorTool />;
}
if (windowLabel === 'tool-pinyin') {
  return <PinyinTool />;
}
// ... 其他工具路由
```

### 4. 后端窗口管理 (`src-tauri/src/commands.rs`)

Rust 后端负责创建和管理工具窗口：

```rust
#[tauri::command]
pub fn show_tool_window(label: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    // 如果窗口已存在，直接显示
    if let Some(window) = app_handle.get_window(&label) {
        window.show();
        window.set_focus();
        return Ok(());
    }

    // 窗口不存在，动态创建
    // 根据 label 设置窗口标题、尺寸等属性
    WindowBuilder::new(&handle, &label_clone, WindowUrl::App("index.html".into()))
        .title(title)
        .inner_size(width, height)
        .resizable(resizable)
        .always_on_top(always_on_top)
        .build()
}
```

## 添加新工具的完整流程

### 步骤 1: 创建工具组件

在 `src/tools/` 目录下创建新的工具组件文件，例如 `MyNewTool.tsx`：

```typescript
import { useState } from 'react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

export default function MyNewTool() {
  // 1. 使用主题 Hook（必需）
  const ready = useToolTheme();

  // 2. 组件状态
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');

  // 3. 业务逻辑
  const handleProcess = () => {
    // 处理逻辑
    setOutput(input.toUpperCase());
  };

  // 4. 等待主题加载完成
  if (!ready) return null;

  // 5. 渲染 UI
  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      {/* 标题栏 */}
      <ToolHeader
        icon="🔧"
        title="我的新工具"
        subtitle="工具描述"
      />

      {/* 主内容区 */}
      <div className="flex-1 overflow-auto p-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="w-full h-32 p-2 border rounded dark:bg-gray-800 dark:text-white"
          placeholder="输入内容..."
        />

        <button
          onClick={handleProcess}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          处理
        </button>

        <div className="mt-4 p-2 border rounded dark:bg-gray-800 dark:text-white">
          {output}
        </div>
      </div>
    </div>
  );
}
```

#### 关键要点：

1. **使用 `useToolTheme` Hook**：确保工具窗口正确应用主题
2. **使用 `ToolHeader` 组件**：提供统一的标题栏和关闭按钮
3. **响应式布局**：使用 Tailwind CSS 的 dark 模式类
4. **等待 ready 状态**：避免主题未加载时渲染

### 步骤 2: 在注册表中注册工具

编辑 `src/tools/registry.ts`，在 `tools` 数组中添加新工具：

```typescript
const tools: ToolDefinition[] = [
  // ... 现有工具
  {
    id: 'my-new-tool', // 唯一ID
    name: '我的新工具', // 显示名称
    description: '这是一个示例工具', // 描述
    keywords: ['新工具', 'demo', '示例'], // 搜索关键词
    categoryId: 'efficiency', // 分类
    icon: '🔧', // 图标
    type: 'window', // 类型
    windowLabel: 'tool-my-new-tool', // 窗口标签（必须以 tool- 开头）
    windowWidth: 800, // 窗口宽度
    windowHeight: 600, // 窗口高度
  },
];
```

### 步骤 3: 在 App.tsx 中添加路由

编辑 `src/App.tsx`，导入组件并添加路由：

```typescript
// 1. 导入组件
import MyNewTool from './tools/MyNewTool';

function App() {
  // ... 现有代码

  // 2. 添加路由判断
  if (windowLabel === 'tool-my-new-tool') {
    return <MyNewTool />;
  }

  // ... 其他路由
}
```

### 步骤 4: 在后端添加窗口配置

编辑 `src-tauri/src/commands.rs`，在 `show_tool_window` 函数中添加窗口配置：

```rust
let (width, height, resizable, always_on_top) = match label_clone.as_str() {
    "tool-my-new-tool" => (800.0f64, 600.0f64, true, false),
    // ... 其他工具配置
    _ => (1200.0f64, 800.0f64, true, false),
};

let title = match label_clone.as_str() {
    "tool-my-new-tool" => "我的新工具",
    // ... 其他工具标题
    _ => "工具",
};
```

### 步骤 5: 测试工具

1. 启动开发服务器：`npm run tauri dev`
2. 打开工具箱（快捷键或主界面）
3. 在工具箱中找到并点击新工具
4. 测试功能是否正常

## 常见工具模式

### 1. 文本处理工具

```typescript
export default function TextProcessTool() {
  const ready = useToolTheme();
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');

  const handleProcess = () => {
    // 文本处理逻辑
    setOutput(processText(input));
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen">
      <ToolHeader icon="📝" title="文本处理" />
      <div className="flex-1 flex gap-4 p-4">
        {/* 输入区 */}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 p-2 border rounded"
        />
        {/* 输出区 */}
        <textarea
          value={output}
          readOnly
          className="flex-1 p-2 border rounded bg-gray-50"
        />
      </div>
    </div>
  );
}
```

### 2. 图片处理工具

```typescript
import { useImageInput } from './useImageInput';

export default function ImageProcessTool() {
  const ready = useToolTheme();
  const { image, handleImageSelect } = useImageInput();
  const [processed, setProcessed] = useState<string | null>(null);

  const handleProcess = async () => {
    if (!image) return;
    // 图片处理逻辑
    const result = await processImage(image);
    setProcessed(result);
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen">
      <ToolHeader icon="🖼️" title="图片处理" />
      <div className="flex-1 p-4">
        <input
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
        />
        {image && <img src={image} alt="原图" />}
        {processed && <img src={processed} alt="处理后" />}
      </div>
    </div>
  );
}
```

### 3. 网络工具

```typescript
import { invoke } from '@tauri-apps/api/tauri';

export default function NetworkTool() {
  const ready = useToolTheme();
  const [url, setUrl] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRequest = async () => {
    setLoading(true);
    try {
      // 调用后端命令
      const response = await invoke('http_get', { url });
      setResult(response);
    } catch (error) {
      setResult(`错误: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen">
      <ToolHeader icon="🌐" title="网络工具" />
      <div className="flex-1 p-4">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="输入 URL"
          className="w-full p-2 border rounded"
        />
        <button
          onClick={handleRequest}
          disabled={loading}
          className="mt-2 px-4 py-2 bg-blue-500 text-white rounded"
        >
          {loading ? '请求中...' : '发送请求'}
        </button>
        <pre className="mt-4 p-2 bg-gray-100 rounded overflow-auto">
          {result}
        </pre>
      </div>
    </div>
  );
}
```

## 工具开发最佳实践

### 1. 命名规范

- **组件文件名**：使用 PascalCase，如 `MyNewTool.tsx`
- **窗口标签**：使用 kebab-case，必须以 `tool-` 开头，如 `tool-my-new-tool`
- **工具 ID**：使用 kebab-case，如 `my-new-tool`

### 2. 样式规范

- 使用 Tailwind CSS
- 支持深色模式（使用 `dark:` 前缀）
- 保持与其他工具一致的视觉风格
- 使用 `ToolHeader` 组件提供统一的标题栏

### 3. 性能优化

- 使用 `useState` 管理本地状态
- 大量计算使用 `useMemo` 缓存结果
- 异步操作使用 `useEffect` 清理
- 图片处理使用 Web Workers（如需要）

### 4. 用户体验

- 提供清晰的操作提示
- 显示加载状态
- 处理错误并显示友好的错误信息
- 支持键盘快捷键（如适用）
- 提供复制、导出等常用功能

### 5. 代码组织

```typescript
// 1. 导入
import { useState, useEffect } from 'react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

// 2. 类型定义
interface MyToolProps {
  // ...
}

// 3. 辅助函数
function processData(input: string): string {
  // ...
}

// 4. 主组件
export default function MyNewTool() {
  // 4.1 Hooks
  const ready = useToolTheme();
  const [state, setState] = useState('');

  // 4.2 副作用
  useEffect(() => {
    // ...
  }, []);

  // 4.3 事件处理
  const handleAction = () => {
    // ...
  };

  // 4.4 渲染守卫
  if (!ready) return null;

  // 4.5 渲染
  return (
    <div>
      {/* ... */}
    </div>
  );
}
```

## 调用后端功能

### 1. HTTP 请求

```typescript
import { invoke } from '@tauri-apps/api/tauri';

const response = await invoke('http_get', { url: 'https://api.example.com' });
const data = await invoke('http_post', {
  url: 'https://api.example.com',
  body: JSON.stringify({ key: 'value' }),
});
```

### 2. 文件操作

```typescript
import { open } from '@tauri-apps/api/dialog';
import { readBinaryFile, writeBinaryFile } from '@tauri-apps/api/fs';

// 选择文件
const selected = await open({
  multiple: false,
  filters: [{ name: 'Images', extensions: ['png', 'jpg'] }],
});

// 读取文件
const contents = await readBinaryFile(selected as string);

// 写入文件
await writeBinaryFile('output.png', new Uint8Array(contents));
```

### 3. 系统命令

```typescript
import { invoke } from '@tauri-apps/api/tauri';

// 调用自定义后端命令
const result = await invoke('my_custom_command', {
  param1: 'value1',
  param2: 'value2',
});
```

## 调试技巧

### 1. 开发者工具

在工具窗口中按 `F12` 打开开发者工具

### 2. 日志输出

```typescript
console.log('[MyTool] Debug info:', data);
```

### 3. 错误处理

```typescript
try {
  const result = await invoke('some_command');
  console.log('Success:', result);
} catch (error) {
  console.error('Error:', error);
  // 显示错误提示
}
```

## 常见问题

### Q1: 工具窗口主题不正确？

确保使用了 `useToolTheme` Hook 并等待 `ready` 状态：

```typescript
const ready = useToolTheme();
if (!ready) return null;
```

### Q2: 工具在工具箱中不显示？

检查以下几点：

1. 是否在 `registry.ts` 中正确注册
2. `id` 是否唯一
3. `categoryId` 是否有效

### Q3: 点击工具无反应？

检查：

1. `windowLabel` 是否正确
2. 是否在 `App.tsx` 中添加了路由
3. 是否在 `commands.rs` 中添加了窗口配置

### Q4: 窗口尺寸不合适？

在 `registry.ts` 和 `commands.rs` 中调整 `windowWidth` 和 `windowHeight`

## 示例：完整的新工具

以下是一个完整的示例，展示如何创建一个"文本统计"工具：

### 1. 创建组件 `src/tools/TextStatsTool.tsx`

```typescript
import { useState, useMemo } from 'react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

export default function TextStatsTool() {
  const ready = useToolTheme();
  const [text, setText] = useState('');

  const stats = useMemo(() => {
    const chars = text.length;
    const charsNoSpace = text.replace(/\s/g, '').length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lines = text ? text.split('\n').length : 0;
    const paragraphs = text.trim() ? text.split(/\n\n+/).length : 0;

    return { chars, charsNoSpace, words, lines, paragraphs };
  }, [text]);

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      <ToolHeader
        icon="📊"
        title="文本统计"
        subtitle="统计字符、单词、行数等信息"
      />

      <div className="flex-1 flex gap-4 p-4">
        {/* 输入区 */}
        <div className="flex-1 flex flex-col">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="在此输入或粘贴文本..."
            className="flex-1 p-3 border border-gray-300 dark:border-gray-600 rounded-lg
                     bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                     focus:ring-2 focus:ring-blue-500 outline-none resize-none"
          />
        </div>

        {/* 统计区 */}
        <div className="w-64 flex flex-col gap-3">
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <div className="text-sm text-gray-600 dark:text-gray-400">字符数</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {stats.chars.toLocaleString()}
            </div>
          </div>

          <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <div className="text-sm text-gray-600 dark:text-gray-400">字符数（不含空格）</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {stats.charsNoSpace.toLocaleString()}
            </div>
          </div>

          <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
            <div className="text-sm text-gray-600 dark:text-gray-400">单词数</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {stats.words.toLocaleString()}
            </div>
          </div>

          <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
            <div className="text-sm text-gray-600 dark:text-gray-400">行数</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {stats.lines.toLocaleString()}
            </div>
          </div>

          <div className="p-4 bg-pink-50 dark:bg-pink-900/20 rounded-lg">
            <div className="text-sm text-gray-600 dark:text-gray-400">段落数</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {stats.paragraphs.toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

### 2. 注册工具 `src/tools/registry.ts`

```typescript
const tools: ToolDefinition[] = [
  // ... 现有工具
  {
    id: 'text-stats',
    name: '文本统计',
    description: '统计文本的字符数、单词数、行数、段落数等信息',
    keywords: ['文本', '统计', '字数', '字符', '单词', 'count', 'stats', '行数'],
    categoryId: 'text',
    icon: '📊',
    type: 'window',
    windowLabel: 'tool-text-stats',
    windowWidth: 1000,
    windowHeight: 700,
  },
];
```

### 3. 添加路由 `src/App.tsx`

```typescript
import TextStatsTool from './tools/TextStatsTool';

function App() {
  // ...

  if (windowLabel === 'tool-text-stats') {
    return <TextStatsTool />;
  }

  // ...
}
```

### 4. 配置窗口 `src-tauri/src/commands.rs`

```rust
let (width, height, resizable, always_on_top) = match label_clone.as_str() {
    "tool-text-stats" => (1000.0f64, 700.0f64, true, false),
    // ...
};

let title = match label_clone.as_str() {
    "tool-text-stats" => "文本统计",
    // ...
};
```

## 总结

添加新工具的核心步骤：

1. ✅ 创建工具组件（`src/tools/YourTool.tsx`）
2. ✅ 在注册表中注册（`src/tools/registry.ts`）
3. ✅ 添加路由（`src/App.tsx`）
4. ✅ 配置窗口（`src-tauri/src/commands.rs`）
5. ✅ 测试功能

遵循这些步骤和最佳实践，你就可以轻松地为 McStartUP 添加新的工具了！
