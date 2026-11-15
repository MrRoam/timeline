@echo off
setlocal
cd /d "%~dp0"
node scripts\update-chrome.js %*
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
timeout /t 3 >nul
