@echo off
REM ============================================================ #
REM Forex Scalping Backend - Windows launcher
REM Runs the FastAPI backend on http://localhost:8000
REM ============================================================ #

setlocal
cd /d "%~dp0"

REM Create virtual environment if missing
if not exist ".venv\Scripts\python.exe" (
    echo Creating virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo ERROR: could not create venv. Make sure Python 3.11+ is installed.
        exit /b 1
    )
)

REM Activate
call .venv\Scripts\activate.bat

REM Install deps if FastAPI is missing
python -c "import fastapi" >nul 2>nul
if errorlevel 1 (
    echo Installing dependencies...
    python -m pip install --upgrade pip
    python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo ERROR: pip install failed. See messages above.
        pause
        exit /b 1
    )
)

REM Copy .env if missing
if not exist ".env" (
    if exist ".env.example" (
        copy .env.example .env >nul
        echo Created .env from .env.example - EDIT IT BEFORE RUNNING FOR REAL.
    )
)

REM Create data / logs dirs
if not exist "data" mkdir data
if not exist "logs" mkdir logs

echo.
echo ============================================================
echo  Forex Scalping Backend starting on http://localhost:8000
echo  Swagger UI:               http://localhost:8000/docs
echo  WebSocket:                ws://localhost:8000/ws
echo  Press Ctrl+C to stop.
echo ============================================================
echo.

python main.py

REM Keep window open if crashed
if errorlevel 1 (
    echo.
    echo Backend exited with error code %errorlevel%
    pause
)

endlocal
