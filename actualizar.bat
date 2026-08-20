@echo off
title Actualizacion SedimApp
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ==========================================
echo    ACTUALIZACION DE SEDIMAPP
echo ==========================================
echo.

REM ---- 0. Verificar .env (evita error silencioso de docker-compose) ----
if not exist ".env" (
    echo [ERROR] No se encontro el archivo .env
    echo Copie .env.example a .env y configure DB_USER, DB_PASS, DB_SERVER y DB_NAME.
    echo.
    pause
    exit /b 1
)

REM ---- 1. Verificar Git ----
where git >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Git no esta instalado. Instale Git for Windows.
    echo.
    pause
    exit /b 1
)

REM ---- 2. Descargar ultima version ----
echo [1/4] Descargando ultima version desde GitHub...
git pull
if errorlevel 1 (
    echo.
    echo [ERROR] No se pudo actualizar desde GitHub.
    echo - Hay cambios locales en el proyecto que chocan con git pull.
    echo - Sin conexion a internet.
    echo - Credenciales de GitHub no guardadas.
    echo Nada fue modificado. Vuelva a intentar o llame a soporte.
    echo.
    pause
    exit /b 1
)

REM ---- 3. Verificar Docker Desktop ----
where docker >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker no esta instalado. Instale Docker Desktop.
    echo.
    pause
    exit /b 1
)
docker info >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker Desktop no esta corriendo.
    echo Abralo, espere a que inicie y vuelva a ejecutar este archivo.
    echo.
    pause
    exit /b 1
)

REM ---- 4. Reconstruir y arrancar (compatible docker-compose v1 y v2) ----
echo [2/4] Reconstruyendo imagen de Docker (puede tardar varios minutos)...
set "COMPOSE=docker compose"
where docker-compose >nul 2>nul && set "COMPOSE=docker-compose"

%COMPOSE% up -d --build
if errorlevel 1 (
    echo.
    echo [ERROR] Fallo la construccion o el arranque de los contenedores.
    echo Revise la salida de arriba.
    echo.
    pause
    exit /b 1
)

echo [3/4] Verificando estado de los contenedores...
%COMPOSE% ps

REM ---- 5. Abrir la app en el navegador ----
set "APP_PORT=3000"
for /f "tokens=2 delims==" %%a in ('findstr /i "^PORT=" .env') do set "APP_PORT=%%a"

echo.
echo ==========================================
echo    ACTUALIZACION COMPLETADA
echo    La app esta disponible en:
echo    http://localhost:!APP_PORT!
echo ==========================================
echo.
start "" "http://localhost:!APP_PORT!"
pause