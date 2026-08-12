@echo off
chcp 65001 >nul
echo 检查飞书启动器文件
echo.

set "LAUNCHER_DIR=%APPDATA%\McStartUP\launchers"

echo 启动器目录: %LAUNCHER_DIR%
echo.

if exist "%LAUNCHER_DIR%\飞书.cmd" (
    echo === 飞书.cmd 内容 ===
    type "%LAUNCHER_DIR%\飞书.cmd"
    echo.
    echo.
) else (
    echo 未找到 飞书.cmd
)

echo === 所有 VBS 文件 ===
dir /b "%LAUNCHER_DIR%\*.vbs"
echo.

echo 按任意键手动测试 VBS 文件...
pause >nul

echo.
echo 请输入 VBS 文件名（如 l12345678.vbs）:
set /p vbsfile=
if exist "%LAUNCHER_DIR%\%vbsfile%" (
    echo.
    echo === %vbsfile% 内容 ===
    type "%LAUNCHER_DIR%\%vbsfile%"
    echo.
    echo.
    echo 按任意键测试执行此 VBS...
    pause >nul
    wscript.exe "%LAUNCHER_DIR%\%vbsfile%" //B //Nologo
)

pause
