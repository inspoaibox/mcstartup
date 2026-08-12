# Gemini UI 更新 - 工具菜单整合

## 更新内容

### 1. 工具下拉菜单

将"参数"和"记忆"按钮整合到一个"工具"下拉菜单中，类似 Google Gemini 的界面设计。

#### 变更位置

- **文件**: `src/components/ChatInterface.tsx`
- **组件**: `GeminiComposer`

#### 功能说明

- 点击"工具"按钮显示下拉菜单
- 菜单包含两个选项：
  1. **AI 参数** - 切换参数面板显示/隐藏
  2. **记忆管理** - 打开记忆管理面板

#### UI 特性

- 下拉菜单位于输入框上方
- 点击菜单外部自动关闭
- 选择选项后自动关闭菜单
- 使用 Gemini 风格的颜色和圆角设计

### 2. 布局优化

- 移除了独立的"参数"和"记忆"按钮
- 统一放在"工具"下拉菜单中
- 保持左对齐布局
- 符合 Gemini 的 Material Design 风格

### 3. 代码清理

- 移除了未使用的 props（topP, frequencyPenalty, presencePenalty 的 setter）
- 简化了 GeminiComposer 的 props 接口
- 添加了 TypeScript 类型定义

## 使用方法

1. 点击输入框左侧的"工具"按钮
2. 从下拉菜单中选择：
   - "AI 参数" - 调整 Temperature 和 Max Tokens
   - "记忆管理" - 查看和管理自动提取的记忆

## 技术实现

```tsx
// 工具菜单状态
const [showToolsMenu, setShowToolsMenu] = useState(false);

// 下拉菜单结构
<div className="relative">
  <button onClick={() => setShowToolsMenu(!showToolsMenu)}>工具</button>

  {showToolsMenu && (
    <>
      {/* 背景遮罩 */}
      <div className="fixed inset-0 z-10" onClick={() => setShowToolsMenu(false)} />

      {/* 菜单内容 */}
      <div className="absolute left-0 bottom-full mb-2 z-20">
        <button
          onClick={() => {
            setShowParams(!showParams);
            setShowToolsMenu(false);
          }}
        >
          AI 参数
        </button>
        <button
          onClick={() => {
            onShowMemoryPanel();
            setShowToolsMenu(false);
          }}
        >
          记忆管理
        </button>
      </div>
    </>
  )}
</div>;
```

## 样式说明

### 颜色方案（Gemini Material Design）

- 背景: `#f8f9fa` (light) / `#131314` (dark)
- 输入框: `#fff` (light) / `#1e1f20` (dark)
- 文本: `#1f1f1f` (light) / `#e3e3e3` (dark)
- 按钮悬停: `#444746/8` (light) / `#c4c7c5/8` (dark)

### 圆角设计

- 输入框: `rounded-4xl` (24px)
- 按钮: `rounded-full`
- 下拉菜单: `rounded-lg`

## 相关文件

- `src/components/ChatInterface.tsx` - 主要更新文件
- `src/components/AIChatPanel.tsx` - 记忆面板切换逻辑
- `src/components/MemoryPanel.tsx` - 记忆管理界面

## 测试建议

1. 测试工具菜单的打开/关闭
2. 验证 AI 参数面板的切换
3. 确认记忆管理面板的导航
4. 检查点击外部区域关闭菜单
5. 测试深色模式下的显示效果
