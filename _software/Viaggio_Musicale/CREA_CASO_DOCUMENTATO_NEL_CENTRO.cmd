@echo off
setlocal
set "APP_DIR=%~dp0"

echo ============================================================
echo CREA DATI MUSICALI DOCUMENTATI NEL CENTRO
echo ============================================================
echo.
echo Nessuna cartella viene creata finche non sono compilati tutti
echo i campi e non viene confermato DOCUMENTATO.
echo.
pause

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\CREA_CASO_DOCUMENTATO_NEL_CENTRO.ps1"

if errorlevel 1 (
  echo.
  echo Pubblicazione non completata.
  pause
  exit /b 1
)

echo Normalizzazione degli array JSON...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\NORMALIZZA_ARRAY_DATI_MUSICALI.ps1"

if errorlevel 1 (
  echo.
  echo Il caso e stato creato, ma la normalizzazione non e riuscita.
  pause
  exit /b 1
)

echo Aggiornamento del catalogo delle scale...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_CATALOGO.ps1"

if errorlevel 1 (
  echo.
  echo Il caso e stato creato, ma il catalogo non e stato aggiornato.
  pause
  exit /b 1
)

echo Aggiornamento e validazione dei profili...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_INDICE_PROFILI_CENTRI.ps1"

if errorlevel 1 (
  echo.
  echo Il caso e stato creato, ma la validazione non e stata completata.
  pause
  exit /b 1
)

echo.
echo Operazione completata.
pause
