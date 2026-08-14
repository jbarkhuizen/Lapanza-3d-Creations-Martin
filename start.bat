@echo off
title Lapanza 3D Site
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Download it from https://nodejs.org
  pause
  exit /b 1
)
node start.mjs
pause
