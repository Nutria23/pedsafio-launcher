@echo off
title Configurar Entorno - Pedsafio Launcher
echo === INSTALANDO DEPENDENCIAS DEL BACKEND ===
cd backend
call npm install
if %ERRORLEVEL% neq 0 (
    echo Error al instalar dependencias del backend.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo === INSTALANDO DEPENDENCIAS DEL LAUNCHER ===
cd ../launcher
call npm install
if %ERRORLEVEL% neq 0 (
    echo Error al instalar dependencias del launcher.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo === CONFIGURANDO ARCHIVOS E IMAGENES DEL PROYECTO ===
cd ..
node setup-workspace.js
if %ERRORLEVEL% neq 0 (
    echo Error al configurar el espacio de trabajo.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ==========================================================
echo Entorno configurado con exito.
echo.
echo Para iniciar el proyecto, abre terminales separadas y ejecuta:
echo  1. run-backend.bat  ^(Servidor REST API^)
echo  2. run-admin.bat    ^(Panel de Administracion Web^)
echo  3. run-launcher.bat ^(Launcher de Escritorio Electron^)
echo ==========================================================
pause
