@echo off
title Actualizar SedimApp
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ==========================================
echo          ACTUALIZAR SEDIMAPP
echo ==========================================
echo.

if not exist ".env" goto :error_env
where git >nul 2>nul
if errorlevel 1 goto :error_git
where docker >nul 2>nul
if errorlevel 1 goto :error_docker
docker info >nul 2>nul
if errorlevel 1 goto :error_docker_running

set "COMPOSE=docker compose"
docker compose version >nul 2>nul
if errorlevel 1 set "COMPOSE=docker-compose"
set "UPDATE_LOG=%TEMP%\sedimapp-actualizacion.log"

echo [1/3] Descargando la ultima version...
git pull --ff-only
if errorlevel 1 goto :error_pull

echo [2/3] Instalando y reiniciando la aplicacion...
%COMPOSE% up -d --build --remove-orphans app >"!UPDATE_LOG!" 2>&1
if errorlevel 1 goto :error_compose

echo [3/3] Comprobando que SedimApp responda...
set "HEALTH="
for /l %%i in (1,1,24) do (
    for /f %%h in ('docker inspect --format "{{.State.Health.Status}}" sedim-app 2^>nul') do set "HEALTH=%%h"
    if "!HEALTH!"=="healthy" goto :success
    timeout /t 5 /nobreak >nul
)
goto :error_health

:success
set "APP_PORT=3000"
for /f "tokens=2 delims==" %%a in ('findstr /i "^PORT=" .env') do set "APP_PORT=%%a"
echo.
echo [OK] SedimApp se actualizo correctamente.
echo Abra: http://localhost:!APP_PORT!
start "" "http://localhost:!APP_PORT!"
pause
exit /b 0

:error_env
echo [ERROR] No se encontro el archivo .env.
goto :failed

:error_git
echo [ERROR] Git no esta instalado.
goto :failed

:error_docker
echo [ERROR] Docker no esta instalado.
goto :failed

:error_docker_running
echo [ERROR] Docker Desktop no esta iniciado.
goto :failed

:error_pull
echo [ERROR] No se pudo descargar la actualizacion.
echo Revise que no existan cambios locales en la carpeta del sistema.
goto :failed

:error_compose
echo [ERROR] No se pudo instalar o iniciar la nueva version.
echo.
type "!UPDATE_LOG!"
goto :failed

:error_health
echo [ERROR] SedimApp no respondio a tiempo.
echo Revise el detalle con: %COMPOSE% logs --tail 50 app

:failed
echo.
echo La actualizacion no termino. Comunique este mensaje al soporte.
pause
exit /b 1
