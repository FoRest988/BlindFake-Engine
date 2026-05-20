@echo off
title BlindFake: Phantom
cd /d "%~dp0"
echo.
echo   Starting BlindFake: Phantom v0.2 (Client + Server)...
echo.
npm run dev:all
pause
  