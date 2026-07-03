@echo off
setlocal
set "APP_DIR=%~dp0"

echo Aggiornamento del catalogo delle tradizioni e delle scale...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_CATALOGO.ps1"

if errorlevel 1 (
  echo.
  echo Catalogo non aggiornato.
  pause
  exit /b 1
)

echo Validazione dei pacchetti musica_documentata...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_INDICE_PROFILI_CENTRI.ps1"

if errorlevel 1 (
  echo.
  echo Validazione non completata.
  pause
  exit /b 1
)

start "" "%APP_DIR%generated\RAPPORTO_VALIDAZIONE_DATI_DOCUMENTATI.txt"
exit /b 0
