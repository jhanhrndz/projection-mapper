@echo off
chcp 65001 >nul
title Projection Mapper - Iniciando Estudio...

echo ========================================================
echo       PROJECTION MAPPER - ESTUDIO DE MAPEO
echo ========================================================
echo.

:: 1. Detectar comando de Python disponible
set PY_CMD=
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set PY_CMD=python
) else (
    where py >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        set PY_CMD=py
    )
)

if "%PY_CMD%"=="" (
    echo [ERROR] No se encontro Python en este equipo.
    echo Por favor instala Python 3.9 o superior desde python.org
    echo asegurandote de marcar la casilla "Add Python to PATH".
    echo.
    pause
    exit /b 1
)

:: 2. Verificar dependencias requeridas (OpenCV y NumPy)
echo [1/3] Verificando dependencias con %PY_CMD%...
%PY_CMD% -c "import cv2, numpy" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [INFO] Instalando dependencias requeridas desde requirements.txt...
    %PY_CMD% -m pip install -r "%~dp0requirements.txt"
)

:: 3. Limpiar puerto 8085 si habia una instancia colgada previa
echo [2/3] Comprobando puerto 8085...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8085 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

:: 4. Iniciar el servidor local de fondo
echo [3/3] Iniciando servidor local...
cd /d "%~dp0"
start "ProjectionMapperServer" /b %PY_CMD% server.py

:: 5. Esperar y abrir el navegador en la Ventana de Control
ping -n 2 127.0.0.1 >nul 2>&1
start http://localhost:8085/

echo.
echo ========================================================
echo   ¡PROJECTION MAPPER INICIADO CON EXITO!
echo ========================================================
echo   Ventana de Control:   http://localhost:8085/
echo   Ventana de Proyector: http://localhost:8085/projector
echo.
echo   * Para cerrar la aplicacion cuando termines,
echo     simplemente ejecuta el archivo DETENER.bat
echo ========================================================
echo.
ping -n 4 127.0.0.1 >nul 2>&1
exit
