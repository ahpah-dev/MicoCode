@echo off
title MicoCode local model relay
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer from https://nodejs.org/en/download
  pause
  exit /b 1
)
echo MicoCode connects to Ollama running on this computer.
echo Keep this window open while using local AI.
echo If another relay is already running, close this window and use that one.
start "" "https://micocode.vercel.app/app/"
node micocode-proxy.mjs
pause
