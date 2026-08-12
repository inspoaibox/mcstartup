@echo off
echo ========================================
echo 强制清理所有缓存并重新构建
echo ========================================

echo.
echo [1/5] 停止开发服务器（如果正在运行）...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul

echo.
echo [2/5] 删除 Vite 缓存...
if exist "node_modules\.vite" (
    rmdir /s /q "node_modules\.vite"
    echo Vite 缓存已删除
) else (
    echo Vite 缓存不存在
)

echo.
echo [3/5] 删除 dist 目录...
if exist "dist" (
    rmdir /s /q "dist"
    echo dist 目录已删除
) else (
    echo dist 目录不存在
)

echo.
echo [4/5] 删除 Tauri 构建缓存...
if exist "src-tauri\target\debug" (
    echo 正在删除 Tauri debug 缓存（这可能需要一些时间）...
    rmdir /s /q "src-tauri\target\debug"
    echo Tauri debug 缓存已删除
) else (
    echo Tauri debug 缓存不存在
)

echo.
echo [5/5] 启动开发服务器...
echo.
echo ========================================
echo 缓存清理完成！正在启动开发服务器...
echo ========================================
echo.

npm run tauri dev
