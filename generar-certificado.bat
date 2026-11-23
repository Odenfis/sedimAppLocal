@echo off
title Generar certificado HTTPS de SedimApp
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ==========================================
echo     CERTIFICADO HTTPS LOCAL - SEDIMAPP
echo ==========================================
echo.
echo Crea (o reutiliza) la CA local y emite el certificado del servidor.
echo La IP del servidor debe ser FIJA. Si cambia, vuelva a ejecutar este archivo:
echo la CA se conserva y no hay que reinstalarla en las tablets.
echo.

if not exist ".env" goto :error_env
where docker >nul 2>nul
if errorlevel 1 goto :error_docker
docker info >nul 2>nul
if errorlevel 1 goto :error_docker_running

set "COMPOSE=docker compose"
docker compose version >nul 2>nul
if errorlevel 1 set "COMPOSE=docker-compose"

echo Direcciones IPv4 de este equipo:
ipconfig | findstr /i "IPv4"
echo.
set "SERVER_IP=%~1"
if "!SERVER_IP!"=="" set /p "SERVER_IP=Escriba la IP fija del servidor (ej. 192.168.1.50): "
if "!SERVER_IP!"=="" goto :error_ip

if not exist "certs" mkdir "certs"
%COMPOSE% run --rm --no-deps -T app node scripts/generate-local-certs.js --ip !SERVER_IP!
if errorlevel 1 goto :error_generate

echo.
echo [OK] Certificados listos en la carpeta certs.
echo.
echo Siguientes pasos:
echo  1. En .env ponga HTTPS_ENABLED=true y HTTPS_PORT=3443 (deje HTTPS_REDIRECT=false durante la prueba).
echo  2. Ejecute actualizar.bat para reiniciar la aplicacion.
echo  3. En la tablet piloto abra: http://!SERVER_IP!:PUERTO/instalar-certificado
echo     y siga las instrucciones de la pagina.
echo  4. Nunca copie ca.key ni server.key fuera de este equipo.
pause
exit /b 0

:error_env
echo [ERROR] No se encontro el archivo .env.
goto :failed

:error_docker
echo [ERROR] Docker no esta instalado.
goto :failed

:error_docker_running
echo [ERROR] Docker Desktop no esta iniciado.
goto :failed

:error_ip
echo [ERROR] Debe indicar la IP del servidor.
goto :failed

:error_generate
echo [ERROR] No se pudo generar el certificado.
echo Si el mensaje indica que falta openssl, ejecute primero actualizar.bat
echo para instalar la version nueva y vuelva a intentarlo.
goto :failed

:failed
echo.
echo Comunique este mensaje al soporte.
pause
exit /b 1
