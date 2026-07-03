@echo off
setlocal
set "APP_DIR=%~dp0"

echo Aggiornamento dei profili musicali dei centri...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_INDICE_PROFILI_CENTRI.ps1"

if errorlevel 1 (
  echo.
  echo Non e stato possibile aggiornare i profili dei centri.
  pause
  exit /b 1
)

start "" "%APP_DIR%CENTER_MUSIC_CATALOG.html"
exit /b 0
