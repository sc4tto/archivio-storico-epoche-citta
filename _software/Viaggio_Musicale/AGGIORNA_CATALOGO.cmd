@echo off
setlocal
set "APP_DIR=%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_CATALOGO.ps1"

if errorlevel 1 (
  echo.
  echo Aggiornamento non completato.
  pause
  exit /b 1
)

echo.
echo Catalogo aggiornato correttamente.
pause
