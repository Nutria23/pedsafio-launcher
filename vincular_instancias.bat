@echo off
title Vinculador de Instancias - Pedsafio
echo ===================================================
echo   VINCULADOR DE INSTANCIAS DE ARCHIVE.ORG
echo ===================================================
echo.
echo [1/2] Descargando y analizando archivos desde Archive.org...
node .\scratch_update_manifest.js
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Hubo un fallo al descargar o calcular las firmas.
    pause
    exit /b
)
echo.
echo [2/2] Subiendo actualizacion del manifiesto a GitHub...
call .\subir_con_token.bat
echo.
echo ===================================================
echo   ¡PROCESO FINALIZADO CON EXITO!
echo   Las instancias ya estan vinculadas en el Launcher.
echo ===================================================
pause
