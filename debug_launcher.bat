@echo off
chcp 65001 >nul

set "DIR=%APPDATA%\McStartUP\launchers"

echo === 飞书.cmd 内容 ===
type "%DIR%\飞书.cmd"
echo.
echo.

echo === 查找 VBS 文件 ===
for %%f in ("%DIR%\l*.vbs") do (
    echo 文件: %%~nxf
    type "%%f"
    echo.
)

pause
