# 贡献指南

感谢你考虑为 McStartUP 做出贡献！

## 行为准则

请友善、尊重地对待所有贡献者。我们致力于营造一个开放和包容的社区环境。

## 如何贡献

### 报告 Bug

如果你发现了 Bug，请：

1. 检查 [Issues](https://github.com/inspoaibox/mcstartup/issues) 确认问题是否已被报告
2. 如果没有，创建新 Issue，包含：
   - 清晰的标题和描述
   - 重现步骤
   - 预期行为和实际行为
   - 系统环境（Windows 版本、应用版本等）
   - 截图或错误日志（如果适用）

### 建议新功能

1. 先在 [Discussions](https://github.com/inspoaibox/mcstartup/discussions) 讨论你的想法
2. 如果得到积极反馈，创建 Feature Request Issue
3. 描述功能的用途和预期行为

### 提交代码

#### 开发环境设置

```bash
# 1. Fork 并克隆仓库
git clone https://github.com/你的用户名/mcstartup.git
cd mcstartup

# 2. 安装依赖
npm install

# 3. 创建特性分支
git checkout -b feature/your-feature-name

# 4. 启动开发服务器
npm run tauri dev
```

#### 代码规范

- **TypeScript/React**:
  - 使用 TypeScript 严格模式
  - 遵循 ESLint 规则
  - 使用函数式组件和 Hooks
  - 组件文件使用 PascalCase 命名

- **Rust**:
  - 遵循 Rust 官方风格指南
  - 使用 `cargo fmt` 格式化代码
  - 使用 `cargo clippy` 检查代码质量

- **提交信息**:
  - 使用清晰的中文或英文描述
  - 格式：`类型: 简短描述`
  - 类型：feat（新功能）、fix（修复）、docs（文档）、style（格式）、refactor（重构）、test（测试）、chore（构建）

示例：

```
feat: 添加文件夹类型支持
fix: 修复中文输入法问题
docs: 更新 README 安装说明
```

#### 提交流程

1. 确保代码通过所有检查：

```bash
# 前端检查
npm run lint
npm run type-check

# 后端检查
cd src-tauri
cargo fmt --check
cargo clippy
cargo test
```

2. 提交更改：

```bash
git add .
git commit -m "feat: 你的功能描述"
```

3. 推送到你的 Fork：

```bash
git push origin feature/your-feature-name
```

4. 创建 Pull Request：
   - 提供清晰的标题和描述
   - 关联相关 Issue（如果有）
   - 添加截图或 GIF（如果是 UI 更改）
   - 等待代码审查

### 文档贡献

文档改进同样重要！你可以：

- 修正拼写或语法错误
- 改进现有文档的清晰度
- 添加使用示例
- 翻译文档

### 测试

- 添加新功能时，请确保功能正常工作
- 修复 Bug 时，验证问题已解决且没有引入新问题
- 在不同 Windows 版本上测试（如果可能）

## 项目结构

```
mcstartup/
├── src/                    # React 前端
│   ├── components/         # UI 组件
│   ├── stores/            # 状态管理
│   ├── types/             # 类型定义
│   └── utils/             # 工具函数
├── src-tauri/             # Rust 后端
│   └── src/
│       ├── commands.rs    # Tauri 命令
│       ├── launcher.rs    # 启动逻辑
│       ├── registry.rs    # 注册表操作
│       └── storage.rs     # 数据存储
└── docs/                  # 官网页面
```

## 开发技巧

### 调试前端

```bash
# 在浏览器中打开开发者工具
# Tauri 窗口中按 F12
```

### 调试后端

```rust
// 在 Rust 代码中使用
println!("Debug: {:?}", variable);

// 或使用 log crate
log::info!("Info message");
log::error!("Error message");
```

### 热重载

开发模式下，前端代码修改会自动热重载。Rust 代码修改需要重启开发服务器。

## 获取帮助

- 查看 [文档](https://inspoaibox.github.io/mcstartup)
- 在 [Discussions](https://github.com/inspoaibox/mcstartup/discussions) 提问
- 查看现有 [Issues](https://github.com/inspoaibox/mcstartup/issues)

## 许可证

提交代码即表示你同意你的贡献将在 MIT 许可证下发布。

---

再次感谢你的贡献！🎉
