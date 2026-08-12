# AI 参数面板完整更新

## 更新内容

### 1. 添加完整的四个参数

现在参数面板包含所有四个 AI 参数，与新建对话保持一致：

1. **Temperature** (温度)
   - 范围：0 - 2
   - 步长：0.1
   - 说明：控制输出的随机性。较高的值使输出更随机，较低的值使输出更确定。

2. **Max Tokens** (最大令牌数)
   - 范围：1 - 32000
   - 输入框形式
   - 说明：生成的最大 token 数量。较大的值允许更长的响应。

3. **Top P** (核采样)
   - 范围：0 - 1
   - 步长：0.05
   - 说明：核采样参数。较低的值使输出更集中，较高的值使输出更多样化。

4. **Frequency Penalty** (频率惩罚)
   - 范围：0 - 2
   - 步长：0.1
   - 说明：降低重复词语的频率。较高的值会减少重复内容。

5. **Presence Penalty** (存在惩罚)
   - 范围：0 - 2
   - 步长：0.1
   - 说明：鼓励讨论新话题。较高的值会增加话题多样性。

### 2. 添加中文说明

每个参数都包含：

- 参数名称（英文）
- 当前值显示
- 滑块或输入框控制
- 详细的中文说明文字

### 3. 布局优化

- 垂直排列，每个参数独立一行
- 使用 Gemini 风格的颜色和间距
- 说明文字使用小字号（10px），不占用太多空间
- 圆角设计（rounded-2xl）

### 4. 按钮布局

- "参数"和"记忆"按钮直接显示在工具栏
- 不使用二级下拉菜单
- 左对齐布局
- 符合 Gemini Material Design 风格

## 代码结构

```tsx
{/* 参数面板 */}
{showParams && (
  <div className="mb-2 px-4 py-3 bg-gray-50 dark:bg-gray-800 rounded-2xl space-y-3">
    {/* Temperature */}
    <div>
      <div className="flex items-center justify-between mb-1">
        <label>Temperature</label>
        <span>{temperature}</span>
      </div>
      <input type="range" ... />
      <p className="text-[10px]">说明文字</p>
    </div>

    {/* 其他参数... */}
  </div>
)}
```

## 样式说明

### 颜色

- 背景：`bg-gray-50` (light) / `bg-gray-800` (dark)
- 标签：`text-[#444746]` (light) / `text-[#c4c7c5]` (dark)
- 值显示：`text-[#70757a]` (light) / `text-[#9aa0a6]` (dark)
- 说明文字：`text-[#70757a]` (light) / `text-[#9aa0a6]` (dark)
- 滑块：`accent-[#0066ff]`

### 字体大小

- 标签：`text-xs` (12px)
- 值显示：`text-xs` (12px)
- 说明文字：`text-[10px]` (10px)

### 间距

- 面板内边距：`px-4 py-3`
- 参数间距：`space-y-3`
- 圆角：`rounded-2xl`

## 功能特性

1. **实时更新**
   - 所有参数修改立即生效
   - 滑块拖动时实时显示当前值
   - Max Tokens 支持直接输入数字

2. **数值格式化**
   - Temperature：显示一位小数
   - Top P：显示两位小数（toFixed(2)）
   - Frequency/Presence Penalty：显示一位小数（toFixed(1)）
   - Max Tokens：整数

3. **响应式设计**
   - 适配深色模式
   - 移动端友好
   - 平滑过渡动画

## 与新建对话的一致性

参数面板现在与新建对话对话框中的"高级参数设置"完全一致：

- ✅ 相同的四个参数
- ✅ 相同的取值范围和步长
- ✅ 相同的中文说明文字
- ✅ 相同的交互方式

## 测试建议

1. 测试所有参数的调整
2. 验证参数值的实时显示
3. 检查中文说明的可读性
4. 测试深色模式下的显示效果
5. 验证参数修改后对 AI 响应的影响
6. 测试 Max Tokens 输入框的数值验证

## 相关文件

- `src/components/ChatInterface.tsx` - 主要更新文件
- `src/components/NewConversationDialog.tsx` - 参考的参数设置
