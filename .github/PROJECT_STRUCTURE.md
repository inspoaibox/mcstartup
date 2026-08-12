# 项目结构说明

## 📁 根目录文件

### 核心文档

- `README.md` - 项目主文档，包含功能介绍、安装使用、开发指南
- `CHANGELOG.md` - 版本更新历史
- `CONTRIBUTING.md` - 贡献指南
- `LICENSE` - MIT 开源协议

### 配置文件

- `package.json` - Node.js 项目配置
- `vite.config.ts` - Vite 构建配置
- `tailwind.config.js` - Tailwind CSS 配置
- `tsconfig.json` - TypeScript 配置
- `.eslintrc.cjs` - ESLint 代码检查配置
- `.prettierrc` - Prettier 代码格式化配置
- `.gitignore` - Git 忽略文件配置

### 其他

- `index.html` - 应用入口 HTML
- `logo.png` - 应用图标
- `start-with-rust.bat` - 快速启动脚本

## 📂 主要目录

### src/ - 前端源码

```
src/
├── components/          # React 组件
│   ├── MainLayout.tsx   # 主布局
│   ├── Sidebar.tsx      # 侧边栏
│   ├── ItemList.tsx     # 项目列表
│   ├── ItemEditor.tsx   # 项目编辑器
│   ├── GroupEditor.tsx  # 分组编辑器
│   ├── SearchBar.tsx    # 搜索栏
│   └── Settings.tsx     # 设置页面
├── stores/              # Zustand 状态管理
│   ├── itemsStore.ts    # 项目状态
│   ├── groupsStore.ts   # 分组状态
│   └── settingsStore.ts # 设置状态
├── types/               # TypeScript 类型定义
│   └── index.ts
├── utils/               # 工具函数
│   └── defaultItems.ts  # 默认系统应用
├── App.tsx              # 应用根组件
├── main.tsx             # 应用入口
└── index.css            # 全局样式
```

### src-tauri/ - Rust 后端

```
src-tauri/
├── src/
│   ├── main.rs          # 主程序入口
│   ├── commands.rs      # Tauri 命令（前后端通信）
│   ├── launcher.rs      # 应用启动逻辑
│   ├── registry.rs      # Win+R 注册表管理
│   ├── storage.rs       # 数据存储
│   ├── settings.rs      # 设置管理
│   ├── context_menu.rs  # 右键菜单集成
│   └── models.rs        # 数据模型
├── icons/               # 应用图标（各种尺寸）
├── Cargo.toml           # Rust 项目配置
└── tauri.conf.json      # Tauri 配置
```

### docs/ - 官网静态页面

```
docs/
├── index.html           # 官网主页
├── style.css            # 样式表
├── script.js            # 交互脚本
├── README.md            # 部署说明
├── preview.bat          # 本地预览脚本
└── images/              # 截图资源
    └── README.md        # 截图说明
```

### .github/ - GitHub 配置

```
.github/
└── workflows/
    └── deploy-pages.yml # GitHub Pages 自动部署
```

## 🗂️ 数据存储位置

### Windows

- 配置文件: `%APPDATA%\McStartUP\config.json`
- 启动器: `%APPDATA%\McStartUP\launchers\`
  - `*.cmd` - CMD 入口文件
  - `*.vbs` - VBScript 启动脚本

## 🔧 开发命令

```bash
# 安装依赖
npm install

# 开发模式
npm run tauri dev

# 构建生产版本
npm run tauri build

# 代码检查
npm run lint
npm run type-check

# Rust 检查
cd src-tauri
cargo fmt --check
cargo clippy
cargo test
```

## 📦 构建输出

```
src-tauri/target/release/
├── bundle/
│   └── msi/
│       └── McStartUP_1.0.0_x64_en-US.msi  # 安装包
└── McStartUP.exe                           # 可执行文件
```

## 🌐 部署

### GitHub Pages

- 源码: `docs/` 文件夹
- 访问: `https://inspoaibox.github.io/mcstartup`
- 自动部署: 推送到 main 分支时触发

### Release

1. 更新版本号: `src-tauri/tauri.conf.json`
2. 更新日志: `CHANGELOG.md`
3. 构建: `npm run tauri build`
4. 创建 GitHub Release 并上传安装包

---

保持项目结构简洁，只保留必要文件。
