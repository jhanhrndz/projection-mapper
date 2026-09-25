@echo off
chcp 65001 >nul
title Projection Mapper - Detener Servidor

echo ========================================================
echo       PROJECTION MAPPER - DETENER SERVIDOR
echo ========================================================
echo.
echo Deteniendo servidor y liberando puerto 8085...

:: Detener cualquier proceso en el puerto 8085
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8085 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo.
echo [OK] El servidor se ha detenido exitosamente.
echo      El puerto 8085 ha quedado libre.
echo ========================================================
ping -n 3 127.0.0.1 >nul 2>&1
exit
