@echo off
chcp 65001 >nul
echo ========================================
echo 脚本功能测试
echo ========================================
echo.
echo 这是一个测试脚本，用于验证脚本类型功能。
echo.
echo 当前时间: %date% %time%
echo 当前目录: %cd%
echo.
echo 按任意键继续...
pause >nul
echo.
echo 测试完成！
timeout /t 3
