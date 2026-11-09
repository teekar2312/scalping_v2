"""
Tests package for the Forex scalping backend.

Run with::

    cd download/python-backend
    python -m pytest tests/ -v --cov=. --cov-report=term-missing

Environment requirements:
    * MT5_LOGIN / MT5_PASSWORD / MT5_SERVER must be set (any dummy values).
    * PAPER_MODE=true
    * API_KEYS empty (auth disabled for tests)
"""
