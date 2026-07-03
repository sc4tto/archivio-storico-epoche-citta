@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Consolidamento globale - Viaggio Musicale

echo ============================================================
echo CONSOLIDAMENTO GLOBALE - VIAGGIO MUSICALE
echo ============================================================
echo.
echo Questa operazione ricostruisce catalogo e indice dei profili.
echo Puo richiedere diversi minuti.
echo.
pause

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0CONSOLIDA_BLOCCHI_MUSICALI.ps1"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo Consolidamento completato senza errori.
) else (
  echo Consolidamento terminato con codice %RC%.
  echo Consultare il rapporto aperto e le righe precedenti.
)
echo.
pause
exit /b %RC%
