@echo off
title Subir Proyecto a GitHub - Pedsafio Launcher
echo ==========================================================
echo       PUBLICACION AUTOMATICA EN GITHUB Y CONFIGURACION
echo ==========================================================
echo.
echo Para que el Launcher funcione sin localhost, debemos hospedar
echo la configuracion y los mods en un repositorio publico de GitHub.
echo.
echo Requisitos:
echo  1. Crea un repositorio vacio en GitHub (ej: "pedsafio-launcher-repo").
echo  2. Asegurate de que sea PUBLICO.
echo.
set /p REPO_URL="Pega la URL de tu repositorio de GitHub (ej: https://github.com/Usuario/Repositorio): "

if "%REPO_URL%"=="" (
    echo Error: No has introducido una URL valida.
    pause
    exit /b 1
)

echo.
echo === CONFIGURANDO URLS DEL LAUNCHER Y BACKEND PARA GITHUB ===
node update-git-config.js "%REPO_URL%"
if %ERRORLEVEL% neq 0 (
    echo.
    echo Error al reconfigurar los enlaces de GitHub.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo === RE-GENERANDO MANIFIESTO DE ACTUALIZACION CON ENLACES NUEVOS ===
node setup-workspace.js
if %ERRORLEVEL% neq 0 (
    echo.
    echo Error al reconstruir el manifiesto del espacio de trabajo.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo === INICIALIZANDO REPOSITORIO GIT LOCAL Y SUBIENDO A GITHUB ===
git init
:: Remueve del cache archivos que deban ignorarse (como node_modules)
git rm -r --cached . >nul 2>&1
git add .
git commit -m "Inicializar Suite de Launcher Pedsafio con hosting en GitHub"
git branch -M main

:: Clean up old origin if exists
git remote remove origin >nul 2>&1

:: Add remote origin (ensure it ends with .git if not present)
echo %REPO_URL% | findstr /I "\.git$" >nul
if %ERRORLEVEL% equ 0 (
    git remote add origin %REPO_URL%
) else (
    git remote add origin %REPO_URL%.git
)

echo.
echo Subiendo archivos a GitHub... (puede requerir iniciar sesion si es la primera vez)
git push -u origin main

if %ERRORLEVEL% neq 0 (
    echo.
    echo ⚠ Ocurrio un error al subir los archivos a GitHub.
    echo Asegurate de haber creado el repositorio en la web de GitHub
    echo y de tener permisos de escritura.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ==========================================================
echo ¡PROYECTO SUBIDO Y CONFIGURADO CON EXITO!
echo.
echo Todos los launchers que compiles ahora leeran la configuracion
echo y los mods directamente desde tu repositorio de GitHub.
echo.
echo Para actualizar la IP o los mods en el futuro, solo debes:
echo  1. Modificar backend/config.json o agregar mods en backend/public/mods/
echo  2. Regenerar el manifiesto con setup-workspace.js o el Panel Admin.
echo  3. Hacer un "git commit" y "git push" en tu terminal.
echo ==========================================================
pause
