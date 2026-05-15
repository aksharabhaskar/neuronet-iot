"""
ml_engine/predict.py — Real-time Congestion Predictor

Loaded once at startup, called on every incoming packet.
Uses the same 5 features and window size as model.py.
"""

import numpy as np
import joblib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edge_controller.config import MODEL_PATH
from ml_engine.model import extract_features


class CongestionPredictor:
    """
    Wraps the trained Random Forest and exposes a single predict() method.

    Usage:
        predictor = CongestionPredictor()
        risk = predictor.predict([0.0, 0.01, 0.0, 0.08, 0.0, 0.0, 0.02, 0.0, 0.0, 0.0])
        # returns float 0.0 – 1.0
    """

    def __init__(self, model_path: str = MODEL_PATH):
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Model not found at '{model_path}'.\n"
                f"Train it first:  python -m ml_engine.model"
            )
        self._model = joblib.load(model_path)
        print(f"[ML] Congestion predictor loaded from {model_path}")

    def predict(self, delay_window: list[float]) -> float:
        """
        Returns the probability that the network is congested (0.0 – 1.0).

        Parameters
        ----------
        delay_window : list of recent per-packet network delays (seconds)
                       Should have at least 2 values; 10 is ideal.
        """
        if len(delay_window) < 2:
            return 0.0

        features = extract_features(np.array(delay_window, dtype=float))
        prob = float(self._model.predict_proba([features])[0][1])
        return round(prob, 4)

    def risk_label(self, prob: float) -> str:
        """Human-readable label for a probability score."""
        if prob >= 0.70:
            return "HIGH RISK"
        if prob >= 0.40:
            return "MEDIUM RISK"
        return "LOW RISK"
