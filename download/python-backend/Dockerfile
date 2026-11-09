# Forex Scalping Backend - Dockerfile (Sprint 8 #18)
#
# NOTE: MetaTrader5 is Windows-only.  This container therefore runs the
# backend in PAPER / DRY mode (or for backtest / analytics only).  For live
# trading, run the backend on the Windows host where MT5 is installed.
#
# Build:
#   docker build -t forex-backend ./download/python-backend
# Run:
#   docker run -p 8000:8000 --env-file .env forex-backend

FROM python:3.12-slim AS base

# System deps for sqlcipher3 (libsqlcipher-dev) + bcrypt (gcc) + reportlab
# (libfreetype + libjpeg).
RUN apt-get update && apt-get install -y --no-install-recommends \
        libsqlcipher-dev \
        libsqlcipher0 \
        gcc \
        g++ \
        libffi-dev \
        libssl-dev \
        libfreetype6-dev \
        libjpeg-dev \
        zlib1g-dev \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create data + logs dirs (mounted as volumes in production)
RUN mkdir -p /app/data /app/logs

EXPOSE 8000

# Health check (Sprint 8 #20): /healthz returns 200 if the process is alive
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://localhost:8000/healthz || exit 1

# Run uvicorn with the configured host/port (default 0.0.0.0:8000)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--no-access-log"]
