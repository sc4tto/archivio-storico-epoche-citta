@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0..\..\..\..\strumenti\genera_centro_da_json_v2.py" --data "%~dp0dati" --output "%~dp0" --root "%~dp0..\..\..\.."
) else (
  python "%~dp0..\..\..\..\strumenti\genera_centro_da_json_v2.py" --data "%~dp0dati" --output "%~dp0" --root "%~dp0..\..\..\.."
)
echo.
pause
