@echo off
set PATH=F:\ai\nodejs;%PATH%
cd /d F:\role_play2\web
echo 启动 RPG 跑团台 http://127.0.0.1:8000
echo （剧情插图需要 ComfyUI 在线：运行 F:\ai\启动ComfyUI.bat）
node server\index.js
pause
