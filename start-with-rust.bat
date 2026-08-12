@echo off
echo 正在设置 Rust 环境...

REM 添加 Rust 到 PATH
set PATH=%USERPROFILE%\.cargo\bin;%PATH%

REM 验证 Rust 是否可用
cargo --version >nul 2>&1
if errorlevel 1 (
    echo 错误: 找不到 Rust/Cargo
    echo 请确保已安装 Rust: https://rustup.rs/
    echo.
    echo 安装后，重启终端再运行此脚本
    pause
    exit /b 1
)

echo Rust 环境已设置
echo.
echo 正在启动开发服务器...
npm run tauri:dev
