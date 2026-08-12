@echo off
chcp 65001 >nul
echo 测试中文别名启动器
echo.

set "LAUNCHER_DIR=%APPDATA%\McStartUP\launchers"
echo 启动器目录: %LAUNCHER_DIR%
echo.

if not exist "%LAUNCHER_DIR%" (
    echo 错误: 启动器目录不存在
    pause
    exit /b 1
)

echo 查找"飞书"相关文件:
dir /b "%LAUNCHER_DIR%\飞书*"
echo.

if exist "%LAUNCHER_DIR%\飞书.cmd" (
    echo 找到 飞书.cmd
    echo 内容:
    type "%LAUNCHER_DIR%\飞书.cmd"
    echo.
) else (
    echo 未找到 飞书.cmd
)

echo.
echo 查找所有 launcher_*.vbs 文件:
dir /b "%LAUNCHER_DIR%\launcher_*.vbs"
echo.

echo 按任意键继续...
pause >nul
