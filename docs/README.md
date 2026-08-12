# McStartUP 官网

这是 McStartUP 的官方推广页面，使用纯静态 HTML/CSS/JS 构建。

## 部署到 GitHub Pages

### 方法 1: 使用 docs 文件夹（推荐）

1. 将代码推送到 GitHub 仓库
2. 进入仓库的 Settings > Pages
3. 在 "Source" 下选择 "Deploy from a branch"
4. 在 "Branch" 下选择 `main` 分支和 `/docs` 文件夹
5. 点击 Save
6. 等待几分钟，访问 `https://inspoaibox.github.io/mcstartup`

### 方法 2: 使用 gh-pages 分支

```bash
# 安装 gh-pages
npm install -g gh-pages

# 部署
gh-pages -d docs
```

## 自定义配置

### 更新下载链接

编辑 `index.html`，将所有 `inspoaibox` 替换为你的 GitHub 用户名（如果需要）：

```html
<!-- 查找并替换 -->
https://github.com/inspoaibox/mcstartup
<!-- 替换为 -->
https://github.com/你的用户名/mcstartup
```

### 添加截图

1. 将截图放在 `docs/images/` 文件夹
2. 更新 `index.html` 中的截图占位符：

```html
<!-- 替换 -->
<div class="screenshot-placeholder">
  <p>主界面 - 网格视图</p>
</div>

<!-- 为 -->
<img src="images/screenshot-1.png" alt="主界面" />
```

### 自定义域名（可选）

1. 在 `docs` 文件夹创建 `CNAME` 文件
2. 写入你的域名，例如：`mcstartup.com`
3. 在域名提供商处添加 CNAME 记录指向 `inspoaibox.github.io`

## 本地预览

直接用浏览器打开 `docs/index.html` 即可预览。

或使用简单的 HTTP 服务器：

```bash
# Python 3
cd docs
python -m http.server 8000

# Node.js
npx serve docs
```

然后访问 `http://localhost:8000`

## 文件结构

```
docs/
├── index.html      # 主页面
├── style.css       # 样式表
├── script.js       # 交互脚本
├── README.md       # 说明文档
└── images/         # 图片资源（需自行添加）
```

## SEO 优化建议

1. 添加 `sitemap.xml`
2. 添加 `robots.txt`
3. 在 `index.html` 中添加 Open Graph 标签
4. 添加 Google Analytics（可选）

## 许可证

与主项目相同，采用 MIT 许可证。
