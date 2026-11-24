@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\db-restore.ps1" %*
set EXITCODE=%ERRORLEVEL%
if not "%ODYSSEY_NO_PAUSE%"=="1" if "%~1"=="" pause
exit /b %EXITCODE%
