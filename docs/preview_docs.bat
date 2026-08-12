@echo off
chcp 65001 >nul
echo ========================================
echo McStartUP 文档预览
echo ========================================
echo.
echo 正在启动本地服务器...
echo.
echo 预览地址：
echo   主页：http://localhost:8000/index.html
echo   脚本指南：http://localhost:8000/script-guide.html
echo.
echo 按 Ctrl+C 停止服务器
echo.
python -m http.server 8000
