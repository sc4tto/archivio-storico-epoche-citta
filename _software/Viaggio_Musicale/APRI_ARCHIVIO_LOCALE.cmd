@echo off
setlocal
set "APP_DIR=%~dp0"

echo Aggiornamento dell'indice dell'archivio locale...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_INDICE_ARCHIVIO.ps1"

if errorlevel 1 (
  echo.
  echo Non e stato possibile aggiornare l'indice dell'archivio.
  pause
  exit /b 1
)

echo Aggiornamento dei profili musicali dei centri...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_INDICE_PROFILI_CENTRI.ps1"

if errorlevel 1 (
  echo.
  echo Non e stato possibile aggiornare i profili musicali dei centri.
  pause
  exit /b 1
)

start "" "%APP_DIR%ARCHIVE_BROWSER.html"
exit /b 0
