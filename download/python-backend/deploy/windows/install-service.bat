@echo off
REM ================================================================
REM Forex Scalping Backend - Windows Service installer (NSSM)
REM ================================================================
REM Prerequisites:
REM   - NSSM (https://nssm.cc/) installed and on PATH.
REM     Download, extract, and copy nssm.exe to C:\Windows\System32\.
REM   - Python 3.11+ with venv created at .venv\ and requirements
REM     installed (pip install -r requirements.txt).
REM   - .env file configured in the backend folder.
REM
REM Usage:  open an Administrator cmd, cd to the backend folder, run
REM         install-service.bat
REM ================================================================

setlocal enabledelayedexpansion

REM ---- Configuration ----------------------------------------------
set SERVICE_NAME=ForexScalpingV2
set SERVICE_DISPLAY=Forex Scalping Backend V2
set SERVICE_DESC=Automated Forex scalping trading system (V2 strategy) - FastAPI + MT5 + Ollama + Tiingo
set BACKEND_DIR=%~dp0
set BACKEND_DIR=%BACKEND_DIR:~0,-1%
set PYTHON_EXE=%BACKEND_DIR%\.venv\Scripts\python.exe
set MAIN_PY=%BACKEND_DIR%\main.py

REM ---- Verify prerequisites ---------------------------------------
where nssm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] NSSM not found on PATH.
    echo Download from https://nssm.cc/ and copy nssm.exe to C:\Windows\System32\.
    exit /b 1
)

if not exist "%PYTHON_EXE%" (
    echo [ERROR] Python venv not found at %PYTHON_EXE%
    echo Run:  python -m venv .venv ^&^& .venv\Scripts\activate ^&^& pip install -r requirements.txt
    exit /b 1
)

if not exist "%MAIN_PY%" (
    echo [ERROR] main.py not found at %MAIN_PY%
    exit /b 1
)

if not exist "%BACKEND_DIR%\.env" (
    echo [WARN] .env not found at %BACKEND_DIR%\.env - copy .env.example and fill in values.
)

REM ---- Install service via NSSM -----------------------------------
echo [INFO] Installing service "%SERVICE_NAME%" ...
nssm install %SERVICE_NAME% "%PYTHON_EXE%" "%MAIN_PY%"
if errorlevel 1 (
    echo [ERROR] NSSM install failed.
    exit /b 1
)

nssm set %SERVICE_NAME% DisplayName "%SERVICE_DISPLAY%"
nssm set %SERVICE_NAME% Description "%SERVICE_DESC%"
nssm set %SERVICE_NAME% AppDirectory "%BACKEND_DIR%"
nssm set %SERVICE_NAME% AppStdout "%BACKEND_DIR%\logs\service.out.log"
nssm set %SERVICE_NAME% AppStderr "%BACKEND_DIR%\logs\service.err.log"
nssm set %SERVICE_NAME% AppStdoutCreationDisposition 4
nssm set %SERVICE_NAME% AppStderrCreationDisposition 4
nssm set %SERVICE_NAME% AppRotateFiles 1
nssm set %SERVICE_NAME% AppRotateBytes 10485760
nssm set %SERVICE_NAME% Start SERVICE_AUTO_START
nssm set %SERVICE_NAME% Type SERVICE_WIN32_OWN_PROCESS
nssm set %SERVICE_NAME% AppExit Default Restart
nssm set %SERVICE_NAME% AppRestartDelay 10000
nssm set %SERVICE_NAME% AppThrottle 5000

REM ---- Configure recovery on failure ------------------------------
nssm set %SERVICE_NAME% AppExit Default Restart
nssm set %SERVICE_NAME% AppRestartDelay 10000

echo [INFO] Starting service "%SERVICE_NAME%" ...
nssm start %SERVICE_NAME%
if errorlevel 1 (
    echo [ERROR] Service install succeeded but start failed.
    echo Check:  nssm status %SERVICE_NAME%   and   event viewer.
    exit /b 1
)

echo.
echo [OK] Service "%SERVICE_NAME%" installed and started.
echo     Manage via: services.msc  or  nssm start/stop/restart %SERVICE_NAME%
echo     Logs at:    %BACKEND_DIR%\logs\service.{out,err}.log
endlocal
