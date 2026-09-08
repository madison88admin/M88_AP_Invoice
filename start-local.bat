@echo off
cd /d "C:\Users\JC\OneDrive - Madison88\AP Invoice\apps\api"
start "API" /min cmd /c "node dist/index.js"
echo API started on port 3001
timeout /t 5 /nobreak >nul
cd /d "C:\Users\JC\OneDrive - Madison88\AP Invoice\apps\web"
start "WEB" /min cmd /c "npx vite --host"
echo Web started on port 3000
timeout /t 5 /nobreak >nul
echo.
echo ========================================
echo   AP Invoice Local Dev Servers
echo   API: http://localhost:3001
echo   Web: http://localhost:3000
echo ========================================
echo.
echo Press Ctrl+C in the server windows to stop.
