@echo off
title Actualizacion segura SedimApp
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ==========================================
echo    ACTUALIZACION SEGURA DE SEDIMAPP
echo ==========================================
echo.

if not exist ".env" (
    echo [ERROR] No se encontro .env. Copie .env.example y configurelo.
    pause
    exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Git no esta instalado.
    pause
    exit /b 1
)
where docker >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker no esta instalado.
    pause
    exit /b 1
)
docker info >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker Desktop no esta corriendo.
    pause
    exit /b 1
)

findstr /r /c:"^SESSION_SECRET=................................" .env >nul
if errorlevel 1 (
    echo [ERROR] SESSION_SECRET debe tener al menos 32 caracteres.
    pause
    exit /b 1
)
findstr /x "SESSION_SECRET=reemplace_con_un_valor_aleatorio_de_32_caracteres_o_mas" .env >nul
if not errorlevel 1 (
    echo [ERROR] Reemplace el SESSION_SECRET de ejemplo por un valor aleatorio propio.
    pause
    exit /b 1
)
findstr /x /i "PRINTER_ENABLED=false" .env >nul
if errorlevel 1 (
    echo [ERROR] La v1 requiere PRINTER_ENABLED=false hasta validar la RPT004.
    pause
    exit /b 1
)

echo Antes de continuar debe existir un respaldo COMPLETO reciente de SQL Server,
echo no debe haber pedidos activos y la actualizacion debe hacerse fuera de servicio.
set /p "CONFIRMACION=Escriba RESPALDO para confirmar: "
if /i not "!CONFIRMACION!"=="RESPALDO" (
    echo Actualizacion cancelada sin cambios.
    pause
    exit /b 1
)

set "COMPOSE=docker compose"
where docker-compose >nul 2>nul && set "COMPOSE=docker-compose"
for /f %%i in ('git rev-parse --short HEAD') do set "COMMIT_ANTERIOR=%%i"

echo [1/6] Descargando main por avance directo...
git pull --ff-only
if errorlevel 1 goto :error_pull
for /f %%i in ('git rev-parse --short HEAD') do set "COMMIT_NUEVO=%%i"

docker inspect sedim-app >nul 2>nul
if not errorlevel 1 (
    for /f %%i in ('docker inspect --format "{{.Image}}" sedim-app') do docker tag %%i sedim-app:rollback
) else (
    docker image inspect sedim-app:current >nul 2>nul
    if not errorlevel 1 docker tag sedim-app:current sedim-app:rollback
)

echo [2/6] Construyendo la imagen nueva sin detener el servicio actual...
%COMPOSE% build --pull app
if errorlevel 1 goto :error_build
docker tag sedim-app:current sedim-app:!COMMIT_NUEVO!

echo [3/6] Ejecutando preflight de base de datos (solo lectura)...
%COMPOSE% run --rm --no-deps app node scripts/preflight-phase22.js
if errorlevel 1 goto :error_preflight

echo [4/6] Instalando la nueva version...
%COMPOSE% up -d --no-build app
if errorlevel 1 goto :rollback

echo [5/6] Esperando salud de aplicacion y SQL Server...
set "HEALTH="
for /l %%i in (1,1,30) do (
    for /f %%h in ('docker inspect --format "{{.State.Health.Status}}" sedim-app 2^>nul') do set "HEALTH=%%h"
    if "!HEALTH!"=="healthy" goto :healthy
    if "!HEALTH!"=="unhealthy" goto :rollback
    timeout /t 5 /nobreak >nul
)
goto :rollback

:healthy
echo [6/6] Verificando estado final...
%COMPOSE% ps
set "APP_PORT=3000"
for /f "tokens=2 delims==" %%a in ('findstr /i "^PORT=" .env') do set "APP_PORT=%%a"
echo.
echo [OK] SedimApp esta saludable en http://localhost:!APP_PORT!
echo Version instalada: !COMMIT_NUEVO!  Version anterior: !COMMIT_ANTERIOR!
start "" "http://localhost:!APP_PORT!"
pause
exit /b 0

:rollback
echo [ERROR] La version nueva no quedo saludable. Restaurando imagen anterior...
docker image inspect sedim-app:rollback >nul 2>nul
if errorlevel 1 (
    echo [CRITICO] No existe una imagen anterior. Revise: docker compose logs app
    pause
    exit /b 1
)
docker tag sedim-app:rollback sedim-app:current
%COMPOSE% up -d --no-build --force-recreate app
echo Se restauro la imagen anterior. Las migraciones nuevas son aditivas y se conservan.
%COMPOSE% ps
pause
exit /b 1

:error_pull
echo [ERROR] No se pudo actualizar main por avance directo. No se reemplazo el servicio.
pause
exit /b 1

:error_build
echo [ERROR] Fallo la construccion. El contenedor anterior continua activo.
pause
exit /b 1

:error_preflight
echo [ERROR] El preflight no aprobo la base. El contenedor anterior continua activo.
pause
exit /b 1
