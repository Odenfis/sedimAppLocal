@echo off
title Diagnostico impresora de Barra
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ==========================================
echo     DIAGNOSTICO IMPRESORA DE BARRA
echo ==========================================
echo.

if not exist ".env" goto :error_env
where docker >nul 2>nul
if errorlevel 1 goto :error_docker
docker info >nul 2>nul
if errorlevel 1 goto :error_docker_running

set "COMPOSE=docker compose"
docker compose version >nul 2>nul
if errorlevel 1 set "COMPOSE=docker-compose"
set "BAR_HOST="
set "BAR_PORT=9100"
for /f "tokens=1,* delims==" %%a in ('findstr /b /i "BAR_PRINTER_HOST=" .env') do set "BAR_HOST=%%b"
for /f "tokens=1,* delims==" %%a in ('findstr /b /i "BAR_PRINTER_PORT=" .env') do set "BAR_PORT=%%b"
if not defined BAR_HOST goto :error_host

echo [1/3] Prueba de red desde Windows: !BAR_HOST!:!BAR_PORT!
ping -n 2 !BAR_HOST!
echo.
powershell -NoProfile -Command "$r=Test-NetConnection -ComputerName $env:BAR_HOST -Port ([int]$env:BAR_PORT) -WarningAction SilentlyContinue; $r | Select-Object ComputerName,RemotePort,PingSucceeded,TcpTestSucceeded; if(-not $r.TcpTestSucceeded){exit 1}"
if errorlevel 1 goto :error_tcp_windows

echo.
echo [2/3] Prueba desde el contenedor y lectura segura de la cola...
%COMPOSE% exec -T app npm run diagnose:bar
if errorlevel 1 goto :error_container

echo.
echo [3/3] Prueba fisica opcional.
choice /c SN /n /m "Desea imprimir ahora una PRUEBA TECNICA DE BARRA? [S/N]: "
if errorlevel 2 goto :success_no_print
%COMPOSE% exec -T app npm run diagnose:bar -- --print
if errorlevel 1 goto :error_print
echo.
echo [OK] La trama fue enviada. Confirme papel, caracteres espanoles y corte.
goto :done

:success_no_print
echo.
echo [OK] Red, configuracion, migracion y cola verificadas. No se envio papel.
goto :done

:error_env
echo [ERROR] No se encontro .env en esta carpeta.
goto :failed
:error_docker
echo [ERROR] Docker no esta instalado.
goto :failed
:error_docker_running
echo [ERROR] Docker Desktop no esta iniciado.
goto :failed
:error_host
echo [ERROR] BAR_PRINTER_HOST no esta configurado en .env.
goto :failed
:error_tcp_windows
echo [ERROR] Windows no alcanza !BAR_HOST!:!BAR_PORT!.
echo Imprima el autotest de la RPT004 y confirme IP, cable, subred y puerto.
goto :failed
:error_container
echo [ERROR] El contenedor no completo el diagnostico.
echo Revise el mensaje [CONFIG], [RED] o [SQL] mostrado arriba.
goto :failed
:error_print
echo [ERROR] La prueba ESC/POS no pudo transmitirse.
goto :failed

:failed
echo.
echo No cambie tablas ni instale npm en Windows. Corrija la causa indicada y repita este archivo.
pause
exit /b 1

:done
echo.
pause
exit /b 0
