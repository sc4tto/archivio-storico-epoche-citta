@echo off
setlocal
set "APP_DIR=%~dp0"

echo Aggiornamento dei metadati...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_METADATI_AFFIDABILITA.ps1"

if errorlevel 1 (
  echo.
  echo Metadati non aggiornati.
  pause
  exit /b 1
)

echo Normalizzazione dei JSON...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\NORMALIZZA_ARRAY_DATI_MUSICALI.ps1"

if errorlevel 1 (
  echo.
  echo Normalizzazione non completata.
  pause
  exit /b 1
)

echo Aggiornamento del catalogo...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_CATALOGO.ps1"

if errorlevel 1 (
  echo.
  echo Catalogo non aggiornato.
  pause
  exit /b 1
)

echo Aggiornamento dell'indice...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\AGGIORNA_INDICE_PROFILI_CENTRI.ps1"

if errorlevel 1 (
  echo.
  echo Indice non aggiornato.
  pause
  exit /b 1
)

echo Verifica del motore...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\VERIFICA_AFFIDABILITA_TRANSIZIONI.ps1"

if errorlevel 1 (
  echo.
  echo Il motore richiede correzioni. Consultare il rapporto.
  pause
  exit /b 1
)

echo.
echo Motore di affidabilita verificato.
pause
