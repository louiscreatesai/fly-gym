@echo off
rem Fly Gym launcher: serves this folder on http://localhost:5600 and opens it in your browser.
cd /d "%~dp0"
set PY=python
where python >nul 2>nul || set PY=py
where %PY% >nul 2>nul || (
  echo Fly Gym needs Python to run locally: https://www.python.org/downloads/
  echo Or use the online version: https://louiscreatesai.github.io/fly-gym/
  pause
  exit /b 1
)
powershell -NoProfile -Command "if (-not (Get-NetTCPConnection -LocalPort 5600 -State Listen -ErrorAction SilentlyContinue)) { Start-Process '%PY%' -ArgumentList '-m','http.server','5600' -WorkingDirectory (Get-Location) -WindowStyle Hidden; Start-Sleep -Seconds 2 }"
start "" "http://localhost:5600/menu.html"
