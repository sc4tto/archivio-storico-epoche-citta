@echo off
setlocal
set "APP_DIR=%~dp0"

echo Aggiornamento del catalogo e del tema...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_CATALOGO.ps1"

if errorlevel 1 (
  echo.
  echo Non e stato possibile aggiornare il catalogo.
  pause
  exit /b 1
)

start "" "%APP_DIR%STYLE_LAB.html"
exit /b 0
