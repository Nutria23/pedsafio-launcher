@echo off
title Compilar Launcher - Pedsafio Launcher
echo ==========================================================
echo Iniciando proceso de compilacion y empaquetado del Launcher...
echo Generando instalador .MSI e instalador .EXE ^(NSIS^)...
echo ==========================================================
echo.
echo === LIBERANDO PROCESOS Y ARCHIVOS BLOQUEADOS ===
taskkill /f /im electron.exe >nul 2>&1
taskkill /f /im "Pedsafio Launcher.exe" >nul 2>&1
taskkill /f /im "Pedsafio Launcher Setup.exe" >nul 2>&1
timeout /t 1 /nobreak >nul

cd launcher
call npm run dist
if %ERRORLEVEL% neq 0 (
    echo.
    echo ⚠ Ocurrio un error durante la compilacion.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ==========================================================
echo Compilacion exitosa.
echo Los instaladores se han generado en: launcher/dist/
echo  - Instalador Ejecutable: launcher/dist/Pedsafio Launcher Setup *.exe
echo  - Instalador de Windows: launcher/dist/Pedsafio Launcher *.msi
echo ==========================================================
pause
