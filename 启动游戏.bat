@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0web"
if errorlevel 1 (
  echo [RPG] Cannot open the web directory.
  pause
  exit /b 1
)
set "PATH=F:\ai\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo [RPG] Node.js was not found. Check F:\ai\nodejs.
  pause
  exit /b 1
)
set "RPG_PORT=%~1"
if not defined RPG_PORT set "RPG_PORT=8000"
echo [RPG] Starting server at http://127.0.0.1:%RPG_PORT%/
echo [RPG] Keep this window open. Press Ctrl+C to stop.
node server\index.js "%RPG_PORT%"
set "RPG_EXIT_CODE=%ERRORLEVEL%"
if not "%RPG_EXIT_CODE%"=="0" (
  echo [RPG] Server stopped with exit code %RPG_EXIT_CODE%.
  pause
)
exit /b %RPG_EXIT_CODE%
