@echo off
setlocal
set "APP_DIR=%~dp0"

echo Normalizzazione dei dati musicali...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\NORMALIZZA_ARRAY_DATI_MUSICALI.ps1"

if errorlevel 1 (
  echo.
  echo Non e stato possibile normalizzare i dati musicali.
  pause
  exit /b 1
)

echo Aggiornamento della politica di selezione...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_POLITICA_SELEZIONE.ps1"

if errorlevel 1 (
  echo.
  echo Non e stato possibile aggiornare la politica di selezione.
  pause
  exit /b 1
)

echo Aggiornamento del catalogo delle scale...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_CATALOGO.ps1"

if errorlevel 1 (
  echo.
  echo Non e stato possibile aggiornare il catalogo delle scale.
  pause
  exit /b 1
)

echo Aggiornamento dell'indice dell'archivio...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_INDICE_ARCHIVIO.ps1"

if errorlevel 1 (
  echo.
  echo Non e stato possibile aggiornare l'indice dell'archivio.
  pause
  exit /b 1
)

echo Aggiornamento dei profili musicali documentati...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_INDICE_PROFILI_CENTRI.ps1"

if errorlevel 1 (
  echo.
  echo Non e stato possibile aggiornare i profili documentati.
  pause
  exit /b 1
)

start "" "%APP_DIR%VIAGGIO_CENTRI.html"
exit /b 0
