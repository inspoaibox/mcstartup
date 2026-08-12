@echo off
chcp 65001 >nul
echo ========================================
echo McStartUP - 测试 URL 和文件夹 Win+R 支持
echo ========================================
echo.
echo 修改内容：
echo.
echo 1. URL 类型现在支持 Win+R 快速启动
echo    - 创建 CMD 包装器：start "" "网址"
echo    - 自动调用默认浏览器打开
echo.
echo 2. 文件夹类型现在支持 Win+R 快速启动
echo    - 创建 CMD 包装器：explorer "路径"
echo    - 在资源管理器中打开文件夹
echo.
echo 3. 应用程序类型保持不变
echo    - 无参数：直接注册 EXE 路径
echo    - 有参数：创建 CMD 包装器
echo.
echo ========================================
echo 测试步骤：
echo ========================================
echo.
echo 1. 运行 npm run tauri dev 启动应用
echo.
echo 2. 添加一个网址项目：
echo    - 类型：网址
echo    - 名称：谷歌
echo    - 别名：谷歌
echo    - 网址：https://www.google.com
echo.
echo 3. 添加一个文件夹项目：
echo    - 类型：文件夹
echo    - 名称：下载文件夹
echo    - 别名：下载
echo    - 路径：C:\Users\%USERNAME%\Downloads
echo.
echo 4. 重启 Windows 资源管理器（首次使用）：
echo    - Ctrl+Shift+Esc 打开任务管理器
echo    - 找到"Windows 资源管理器"
echo    - 右键 → 重新启动
echo.
echo 5. 测试 Win+R 启动：
echo    - Win+R → 输入"谷歌" → 应该打开默认浏览器访问 Google
echo    - Win+R → 输入"下载" → 应该打开下载文件夹
echo.
echo ========================================
echo 技术实现：
echo ========================================
echo.
echo 注册表位置：
echo HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\{别名}.exe
echo.
echo CMD 包装器位置：
echo %%APPDATA%%\McStartUP\launchers\{别名}.cmd
echo.
echo URL 类型 CMD 内容：
echo @echo off
echo start "" "https://www.google.com"
echo.
echo 文件夹类型 CMD 内容：
echo @echo off
echo explorer "C:\Users\...\Downloads"
echo.
echo ========================================
pause
