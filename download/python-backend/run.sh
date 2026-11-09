#!/usr/bin/env bash
# Convenience launcher for the Forex scalping backend.
# On Windows use run.bat instead.  This script is mainly for WSL/Linux
# development (MT5 routes will return 503).

set -euo pipefail
cd "$(dirname "$0")"

# Create venv if missing
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

# Activate
# shellcheck disable=SC1091
source .venv/bin/activate

# Install deps if missing (ignore MetaTrader5 install failure on Linux)
if ! python -c "import fastapi" 2>/dev/null; then
    echo "Installing dependencies (Linux: MetaTrader5 may fail - safe to ignore)..."
    pip install --upgrade pip
    pip install -r requirements.txt || true
fi

# Copy .env if missing
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "Created .env from .env.example - edit it before running for real."
    fi
fi

mkdir -p data logs

echo "Starting backend on http://localhost:8000 ..."
exec python main.py
