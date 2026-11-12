@echo off
rem ============================================================
rem  Abre Nova Sound SIN servidor (doble clic). Solo para ver y probar.
rem  Abre Edge en una ventana aparte (con su propio perfil) que puede
rem  leer los archivos de esta carpeta. No uses esa ventana para
rem  navegar por otras paginas.
rem ============================================================
set "CARPETA=%~dp0"
set "PERFIL=%TEMP%\nova-sound-perfil"
start "" msedge --allow-file-access-from-files --user-data-dir="%PERFIL%" --no-first-run --no-default-browser-check "%CARPETA%index.html"
