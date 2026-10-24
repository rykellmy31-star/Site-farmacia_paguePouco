@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 22 antes de iniciar o robo. Nenhum arquivo foi modificado.
  pause
  exit /b 1
)
echo.
echo ROBO INOVAFARMA - TRIAGEM LOCAL, SOMENTE LEITURA
echo Nao envia dados pela internet nem altera a loja.
echo.
set "INOVA_ORIGEM="
set /p "INOVA_ORIGEM=Digite ou cole a pasta que recebe os CSVs exportados pelo InovaFarma: "
if not defined INOVA_ORIGEM (
  echo Pasta nao informada.
  pause
  exit /b 1
)
if not exist "%INOVA_ORIGEM%\" (
  echo Essa pasta nao existe. Confira o caminho e execute novamente.
  pause
  exit /b 1
)
node "%~dp0inovafarma-robo-windows.mjs" --pasta "%INOVA_ORIGEM%" --assistir
echo O robo foi encerrado. Nenhuma alteracao online foi feita.
pause