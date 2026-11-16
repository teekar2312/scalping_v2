@echo off
REM ============================================================ #
REM One-click update + restart — pulls latest, clears cache,
REM restarts backend + frontend
REM ============================================================ #

setlocal
cd /d "%~dp0"

echo ============================================================
echo  UPDATE + RESTART — Scalping V2
echo ============================================================
echo.

REM Step 1: Pull latest code
echo [1/5] Pulling latest code...
git pull origin main
if errorlevel 1 (
    echo ERROR: git pull failed. Try: git stash ^& git pull origin main
    pause
    exit /b 1
)
echo.

REM Step 2: Clear Next.js cache
echo [2/5] Clearing Next.js cache...
if exist ".next" rmdir /s /q ".next"
if exist "download\python-backend\__pycache__" rmdir /s /q "download\python-backend\__pycache__"
echo Cache cleared.
echo.

REM Step 3: Restart backend (in new window)
echo [3/5] Starting backend...
start "Scalping V2 Backend" cmd /k "cd /d %~dp0download\python-backend && .\run.bat"
timeout /t 5 /nobreak >nul
echo Backend started in new window.
echo.

REM Step 4: Start frontend (in new window)
echo [4/5] Starting frontend...
start "Scalping V2 Frontend" cmd /k "cd /d %~dp0 && npm run dev"
timeout /t 3 /nobreak >nul
echo Frontend started in new window.
echo.

REM Step 5: Health check
echo [5/5] Health check...
timeout /t 10 /nobreak >nul
curl -s http://localhost:8000/ >nul 2>nul
if %errorlevel%==0 (
    echo ✅ Backend running at http://localhost:8000
) else (
    echo ❌ Backend not responding — check backend window for errors
)
curl -s http://localhost:3000/ >nul 2>nul
if %errorlevel%==0 (
    echo ✅ Frontend running at http://localhost:3000
) else (
    echo ❌ Frontend not responding — check frontend window for errors
)

echo.
echo ============================================================
echo  DONE! Open http://localhost:3000 in browser
echo  Backend: http://localhost:8000/docs (Swagger UI)
echo ============================================================
echo.
echo  Important:
echo  - Login with admin credentials from .env (ADMIN_PASSWORD)
echo  - Or set API_KEYS= (empty) in .env to disable auth
echo  - Check Audit Log view for bot process events
echo.
pause
endlocal
