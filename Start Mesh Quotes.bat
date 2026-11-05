@echo off
rem Double-click to start the Mesh quoting tool, then it opens in your browser.
rem Close this window to stop it.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org and try again.
  pause
  exit /b 1
)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node server.js
pause
