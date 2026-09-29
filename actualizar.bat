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

echo [1/5] Descargando la ultima version...
git pull --ff-only
if errorlevel 1 goto :error_pull

echo [2/5] Instalando y reiniciando la aplicacion...
%COMPOSE% up -d --build --remove-orphans app >"!UPDATE_LOG!" 2>&1
if errorlevel 1 goto :error_compose

echo [3/5] Comprobando que SedimApp responda...
set "HEALTH="
for /l %%i in (1,1,24) do (
    for /f %%h in ('docker inspect --format "{{.State.Health.Status}}" sedim-app 2^>nul') do set "HEALTH=%%h"
    if "!HEALTH!"=="healthy" goto :verify_pos
    timeout /t 5 /nobreak >nul
)
goto :error_health

:verify_pos
echo [4/5] Comprobando el contexto de empresa del POS...
set "POS_LOG=%TEMP%\sedimapp-pos.log"
%COMPOSE% exec -T app npm run diagnose:pos -- --empresa=2 >"!POS_LOG!" 2>&1
if errorlevel 1 goto :error_pos
type "!POS_LOG!"

:verify_kitchen
echo [5/5] Comprobando la lectura real de Cocina...
set "KITCHEN_LOG=%TEMP%\sedimapp-cocina.log"
%COMPOSE% exec -T app npm run diagnose:kitchen -- --empresa=2 >"!KITCHEN_LOG!" 2>&1
if errorlevel 1 goto :error_kitchen
type "!KITCHEN_LOG!"
goto :success

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
echo Ultimos mensajes del contenedor:
%COMPOSE% logs --tail 80 app
echo.
echo Revise nuevamente con: %COMPOSE% logs --tail 100 app
goto :failed

:error_kitchen
echo [ERROR] SedimApp inicio, pero Cocina no supero la comprobacion funcional.
echo Diagnostico de Cocina:
type "!KITCHEN_LOG!"
echo.
echo Ultimos mensajes del contenedor:
%COMPOSE% logs --tail 80 app
goto :failed

:error_pos
echo [ERROR] SedimApp inicio, pero el POS no supero la comprobacion funcional.
echo Diagnostico del POS:
type "!POS_LOG!"
echo.
echo Ultimos mensajes del contenedor:
%COMPOSE% logs --tail 80 app
goto :failed

:failed
echo.
echo La actualizacion no termino. Comunique este mensaje al soporte.
pause
exit /b 1
