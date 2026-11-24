@echo off
setlocal
title Odyssey - One-Command Dev Environment
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\odyssey.ps1" %*
set EXITCODE=%ERRORLEVEL%
if not "%ODYSSEY_NO_PAUSE%"=="1" if "%~1"=="" pause
exit /b %EXITCODE%
