"""
ml_regime.py
============
ML-based market regime detection using a Random Forest classifier.

Regime labels:
    TRENDING_STRONG  — ADX > 30
    TRENDING_WEAK    — ADX 22-30
    RANGING_TIGHT    — ADX < 22, ATR low
    RANGING_WIDE     — ADX < 22, ATR high
    VOLATILE         — Bollinger width > 2 std
    QUIET            — Volume + ATR below median

Trains on historical candles + manual labels (or heuristic labels).  Saves
the model to ``data/ml_model.pkl``.  Degrades gracefully if scikit-learn is
not installed (predict returns "UNKNOWN" with confidence 0).

Endpoints exposed by main.py:
    POST /api/ml/train       — trigger training
    GET  /api/ml/predict     — current regime prediction
    GET  /api/ml/features    — feature importance

Config:
    ML_REGIME_ENABLED=false
"""

from __future__ import annotations

import json
import logging
import pickle
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import config as cfg

logger = logging.getLogger(__name__)

try:
    import numpy as np
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import accuracy_score
    _SKLEARN_AVAILABLE = True
except ImportError:  # pragma: no cover
    np = None  # type: ignore
    RandomForestClassifier = None  # type: ignore
    train_test_split = None  # type: ignore
    accuracy_score = None  # type: ignore
    _SKLEARN_AVAILABLE = False


# --------------------------------------------------------------------------- #
# Regime label constants
# --------------------------------------------------------------------------- #

REGIME_TRENDING_STRONG: str = "TRENDING_STRONG"
REGIME_TRENDING_WEAK: str = "TRENDING_WEAK"
REGIME_RANGING_TIGHT: str = "RANGING_TIGHT"
REGIME_RANGING_WIDE: str = "RANGING_WIDE"
REGIME_VOLATILE: str = "VOLATILE"
REGIME_QUIET: str = "QUIET"

ALL_REGIMES: list[str] = [
    REGIME_TRENDING_STRONG, REGIME_TRENDING_WEAK,
    REGIME_RANGING_TIGHT, REGIME_RANGING_WIDE,
    REGIME_VOLATILE, REGIME_QUIET,
]

# Feature names — order matters for model interpretation.
FEATURE_NAMES: list[str] = [
    "adx", "atr", "atr_pct", "rsi",
    "bollinger_width", "volume_ratio",
    "return_skewness", "return_kurtosis",
    "hour_of_day", "day_of_week", "session_code",
]


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _model_path() -> Path:
    p = cfg.settings.paths.base_dir / "data" / "ml_model.pkl"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _session_code(hour: int) -> int:
    """Encode WIB hour → session code (0=off, 1=tokyo, 2=london, 3=overlap)."""
    if 9 <= hour < 12:
        return 1
    if 14 <= hour < 17:
        return 2
    if 20 <= hour < 22:
        return 3
    return 0


# --------------------------------------------------------------------------- #
# MLRegimeDetector
# --------------------------------------------------------------------------- #

class MLRegimeDetector:
    """Random-forest regime classifier."""

    def __init__(self) -> None:
        self.model: Any | None = None
        self._feature_importance: dict[str, float] = {}
        self._last_train_at: datetime | None = None
        self._training_accuracy: float = 0.0
        # Lazily load the saved model
        self._try_load_model()

    # ------------------------------------------------------------------ #
    # Feature extraction
    # ------------------------------------------------------------------ #

    def extract_features(self,
                         candles_m5: list[dict[str, Any]],
                         candles_m15: list[dict[str, Any]] | None = None
                         ) -> list[float]:
        """Extract a feature vector from M5 (and optional M15) candles.

        Returns a list aligned with :data:`FEATURE_NAMES`.
        """
        if not candles_m5:
            return [0.0] * len(FEATURE_NAMES)
        closes = [c.get("close", 0) for c in candles_m5]
        highs = [c.get("high", 0) for c in candles_m5]
        lows = [c.get("low", 0) for c in candles_m5]
        volumes = [c.get("volume", 0) for c in candles_m5]

        try:
            from indicators import (
                atr as ind_atr, adx as ind_adx, rsi as ind_rsi,
                bollinger_bands as ind_bb,
            )
            adx_val = _safe_float(ind_adx(highs, lows, closes, period=14))
            atr_val = _safe_float(ind_atr(highs, lows, closes, period=14))
            rsi_val = _safe_float(ind_rsi(closes, period=14))
            try:
                bb = ind_bb(closes, period=20, num_std=2.0)
                bb_width = _safe_float(bb.width)
            except Exception:
                bb_width = 0.0
        except Exception as exc:  # pragma: no cover
            logger.debug("indicators failed: %s", exc)
            adx_val = atr_val = rsi_val = bb_width = 0.0

        atr_pct = (atr_val / closes[-1]) if closes and closes[-1] else 0.0
        # Volume ratio: latest / median
        vol_ratio = 1.0
        try:
            sorted_v = sorted(volumes)
            median = sorted_v[len(sorted_v) // 2] if sorted_v else 0.0
            vol_ratio = (volumes[-1] / median) if median > 0 else 1.0
        except Exception:
            pass

        # Return skewness + kurtosis (simple numpy/scipy-free calc)
        rets = [closes[i] - closes[i - 1]
                for i in range(1, len(closes)) if closes[i - 1]]
        rets_mean = sum(rets) / len(rets) if rets else 0.0
        rets_var = (sum((r - rets_mean) ** 2 for r in rets) / len(rets)
                    if rets else 0.0)
        rets_std = rets_var ** 0.5
        if rets_std > 0:
            skew = (sum((r - rets_mean) ** 3 for r in rets)
                    / (len(rets) * rets_std ** 3))
            kurt = (sum((r - rets_mean) ** 4 for r in rets)
                    / (len(rets) * rets_var ** 2)) - 3.0
        else:
            skew = kurt = 0.0

        # Time-of-day / day-of-week / session — from last candle's time
        last_time = candles_m5[-1].get("time")
        hour_of_day = day_of_week = session_code = 0
        if last_time:
            try:
                dt = datetime.fromtimestamp(float(last_time), tz=timezone.utc)
                hour_of_day = dt.hour
                day_of_week = dt.weekday()
                session_code = _session_code(hour_of_day)
            except Exception:
                pass

        return [
            adx_val, atr_val, atr_pct, rsi_val,
            bb_width, vol_ratio,
            skew, kurt,
            hour_of_day, day_of_week, session_code,
        ]

    # ------------------------------------------------------------------ #
    # Heuristic labelling (for unsupervised training fallback)
    # ------------------------------------------------------------------ #

    @staticmethod
    def heuristic_label(features: list[float]) -> str:
        """Map a feature vector to one of the regime labels heuristically."""
        if len(features) < 7:
            return REGIME_QUIET
        adx = features[0]
        atr_pct = features[2]
        rsi = features[3]
        bb_width = features[4]
        vol_ratio = features[5]

        if adx > 30:
            return REGIME_TRENDING_STRONG
        if adx > 22:
            return REGIME_TRENDING_WEAK
        if bb_width > 0.0010 or vol_ratio > 1.8:
            return REGIME_VOLATILE
        if atr_pct > 0.0008:
            return REGIME_RANGING_WIDE
        if rsi < 35 or rsi > 65:
            return REGIME_TRENDING_WEAK
        if vol_ratio < 0.6:
            return REGIME_QUIET
        return REGIME_RANGING_TIGHT

    # ------------------------------------------------------------------ #
    # Train / predict
    # ------------------------------------------------------------------ #

    def train(self,
              historical_candles: list[list[dict[str, Any]]],
              labels: list[str] | None = None
              ) -> dict[str, Any]:
        """Train the Random Forest classifier.

        Parameters
        ----------
        historical_candles : list[list[dict]]
            One list of M5 candles per training sample (each will be
            passed through :meth:`extract_features`).
        labels : list[str] | None
            Optional human/manual labels.  If None, the heuristic labeler
            is used to bootstrap the training set.
        """
        if not _SKLEARN_AVAILABLE:
            logger.warning("scikit-learn not installed - train() no-op")
            return {"ok": False, "error": "scikit-learn not installed"}
        if not historical_candles:
            return {"ok": False, "error": "no training samples"}

        X: list[list[float]] = []
        y: list[str] = []
        for i, candles in enumerate(historical_candles):
            feats = self.extract_features(candles)
            X.append(feats)
            if labels and i < len(labels):
                y.append(labels[i])
            else:
                y.append(self.heuristic_label(feats))

        X_arr = np.array(X, dtype=float)
        y_arr = np.array(y)
        # Train/test split (20%)
        if len(X) >= 10:
            X_train, X_test, y_train, y_test = train_test_split(
                X_arr, y_arr, test_size=0.2, random_state=42,
                stratify=y_arr if len(set(y_arr)) > 1 else None,
            )
        else:
            X_train, X_test = X_arr, X_arr
            y_train, y_test = y_arr, y_arr

        self.model = RandomForestClassifier(
            n_estimators=100, max_depth=8, random_state=42, n_jobs=-1,
        )
        self.model.fit(X_train, y_train)
        preds = self.model.predict(X_test)
        self._training_accuracy = float(accuracy_score(y_test, preds))
        # Feature importance
        importance = self.model.feature_importances_
        self._feature_importance = {
            name: float(importance[i]) if i < len(importance) else 0.0
            for i, name in enumerate(FEATURE_NAMES)
        }
        self._last_train_at = datetime.now(timezone.utc)
        # Save to disk
        self._save_model()
        logger.info("ML regime model trained: accuracy=%.4f samples=%d",
                    self._training_accuracy, len(X))
        return {
            "ok": True,
            "samples": len(X),
            "accuracy": round(self._training_accuracy, 4),
            "feature_importance": self._feature_importance,
            "trained_at": self._last_train_at.isoformat(),
        }

    def predict(self,
                candles_m5: list[dict[str, Any]],
                candles_m15: list[dict[str, Any]] | None = None
                ) -> dict[str, Any]:
        """Predict the regime for the supplied candles.

        Returns
        -------
        dict
            ``{"regime": str, "confidence": float, "features": list}``.
        """
        feats = self.extract_features(candles_m5, candles_m15)
        if self.model is None or not _SKLEARN_AVAILABLE:
            return {
                "regime": self.heuristic_label(feats),
                "confidence": 0.0,
                "features": feats,
                "feature_names": FEATURE_NAMES,
                "source": "heuristic",
            }
        try:
            X = np.array([feats], dtype=float)
            pred = self.model.predict(X)[0]
            proba = self.model.predict_proba(X)[0]
            classes = list(self.model.classes_)
            idx = list(classes).index(pred) if pred in classes else 0
            confidence = float(proba[idx]) if len(proba) > idx else 0.0
        except Exception as exc:  # pragma: no cover
            logger.warning("predict failed: %s", exc)
            pred = self.heuristic_label(feats)
            confidence = 0.0
        return {
            "regime": str(pred),
            "confidence": round(confidence, 4),
            "features": feats,
            "feature_names": FEATURE_NAMES,
            "source": "model",
        }

    # ------------------------------------------------------------------ #
    # Feature importance accessor
    # ------------------------------------------------------------------ #

    def get_feature_importance(self) -> dict[str, Any]:
        """Return the feature importance dict (or empty if untrained)."""
        return {
            "importance": self._feature_importance,
            "trained_at": (self._last_train_at.isoformat()
                           if self._last_train_at else None),
            "accuracy": round(self._training_accuracy, 4),
            "sklearn_available": _SKLEARN_AVAILABLE,
        }

    # ------------------------------------------------------------------ #
    # Retrain check
    # ------------------------------------------------------------------ #

    def should_retrain(self,
                       last_train_date: datetime | None = None,
                       max_age_days: int = 30) -> bool:
        """Return True if the model is older than ``max_age_days``."""
        if last_train_date is None:
            last_train_date = self._last_train_at
        if last_train_date is None:
            return True
        if last_train_date.tzinfo is None:
            last_train_date = last_train_date.replace(tzinfo=timezone.utc)
        cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
        return last_train_date < cutoff

    # ------------------------------------------------------------------ #
    # Persistence
    # ------------------------------------------------------------------ #

    def _save_model(self) -> None:
        """Pickle the model + metadata to disk."""
        if self.model is None:
            return
        try:
            payload = {
                "model": self.model,
                "feature_importance": self._feature_importance,
                "trained_at": self._last_train_at,
                "accuracy": self._training_accuracy,
            }
            with open(_model_path(), "wb") as fh:
                pickle.dump(payload, fh)
        except Exception as exc:  # pragma: no cover
            logger.warning("save model failed: %s", exc)

    def _try_load_model(self) -> None:
        """Attempt to load the pickled model from disk."""
        if not _SKLEARN_AVAILABLE:
            return
        p = _model_path()
        if not p.exists():
            return
        try:
            with open(p, "rb") as fh:
                payload = pickle.load(fh)
            self.model = payload.get("model")
            self._feature_importance = payload.get("feature_importance", {})
            self._last_train_at = payload.get("trained_at")
            self._training_accuracy = payload.get("accuracy", 0.0)
            logger.info("Loaded ML regime model (accuracy=%.4f trained_at=%s)",
                        self._training_accuracy,
                        self._last_train_at.isoformat()
                        if self._last_train_at else "unknown")
        except Exception as exc:  # pragma: no cover
            logger.warning("load model failed: %s", exc)


# --------------------------------------------------------------------------- #
# Singleton
# --------------------------------------------------------------------------- #

_default_detector: MLRegimeDetector | None = None


def get_ml_regime_detector() -> MLRegimeDetector:
    """Return the module-level MLRegimeDetector singleton."""
    global _default_detector
    if _default_detector is None:
        _default_detector = MLRegimeDetector()
    return _default_detector


__all__ = [
    "MLRegimeDetector",
    "get_ml_regime_detector",
    "FEATURE_NAMES",
    "ALL_REGIMES",
    "REGIME_TRENDING_STRONG",
    "REGIME_TRENDING_WEAK",
    "REGIME_RANGING_TIGHT",
    "REGIME_RANGING_WIDE",
    "REGIME_VOLATILE",
    "REGIME_QUIET",
]
