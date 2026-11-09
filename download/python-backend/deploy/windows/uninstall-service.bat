@echo off
REM ================================================================
REM Forex Scalping Backend - Windows Service uninstaller (NSSM)
REM ================================================================
REM Usage:  open an Administrator cmd, run uninstall-service.bat
REM ================================================================

setlocal

set SERVICE_NAME=ForexScalpingV2

where nssm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] NSSM not found on PATH.  Cannot remove service.
    exit /b 1
)

echo [INFO] Stopping service "%SERVICE_NAME%" ...
nssm stop %SERVICE_NAME% 2>nul

echo [INFO] Removing service "%SERVICE_NAME%" ...
nssm remove %SERVICE_NAME% confirm
if errorlevel 1 (
    echo [ERROR] NSSM remove failed (was the service installed?).
    exit /b 1
)

echo [OK] Service "%SERVICE_NAME%" removed.
endlocal
