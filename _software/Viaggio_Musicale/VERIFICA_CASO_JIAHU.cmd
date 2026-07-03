@echo off
setlocal
set "APP_DIR=%~dp0"

echo Aggiornamento del catalogo musicale...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_CATALOGO.ps1"

if errorlevel 1 (
  echo.
  echo Catalogo non aggiornato.
  pause
  exit /b 1
)

echo Aggiornamento dell'indice dei profili...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_INDICE_PROFILI_CENTRI.ps1"

if errorlevel 1 (
  echo.
  echo Indice non aggiornato.
  pause
  exit /b 1
)

echo Verifica specifica del caso Jiahu...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\VERIFICA_CASO_JIAHU.ps1"

if errorlevel 1 (
  echo.
  echo Jiahu richiede correzioni. Consultare il rapporto.
  pause
  exit /b 1
)

echo.
echo Jiahu ha superato tutti i controlli.
pause
