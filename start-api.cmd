@echo off
cd /d "C:\Users\JC\OneDrive - Madison88\AP Invoice\apps\api"
set OLLAMA_BASE_URL=http://127.0.0.1:11434
start "AP-API" /b node dist\index.js > "C:\Users\JC\AppData\Local\Temp\ap-api-run.log" 2>&1
echo STARTED
