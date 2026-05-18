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

    FEATURE_ORDER = ["avg_delay", "variance", "max_delay", "slope", "trend"]

    def __init__(self, model_path: str = MODEL_PATH):
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Model not found at '{model_path}'.\n"
                f"Train it first:  python -m ml_engine.model"
            )
        self._model = joblib.load(model_path)
        print(f"[ML] Congestion predictor loaded from {model_path}")
        try:
            import shap
            self.explainer = shap.TreeExplainer(self._model)
            print("[ML] SHAP TreeExplainer initialized.")
        except ImportError:
            self.explainer = None
            print("[ML] SHAP not installed — explain() unavailable. Run: pip install 'shap>=0.44'")

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

    def explain(self, features: dict) -> dict:
        X = np.array([[features[f] for f in self.FEATURE_ORDER]])
        risk = float(self._model.predict_proba(X)[0, 1])
        risk_label = "HIGH" if risk >= 0.7 else "MEDIUM" if risk >= 0.3 else "LOW"

        contributions = []
        if self.explainer is not None:
            try:
                shap_values = self.explainer.shap_values(X)
                sv = shap_values[1][0] if isinstance(shap_values, list) else shap_values[..., 1].values[0]
            except Exception:
                sv = np.zeros(len(self.FEATURE_ORDER))
            for i, fname in enumerate(self.FEATURE_ORDER):
                contributions.append({
                    "feature":    fname,
                    "value":      float(features[fname]),
                    "shap_value": round(float(sv[i]), 6),
                    "direction":  "increases_risk" if sv[i] > 0 else "decreases_risk",
                })
            contributions.sort(key=lambda c: abs(c["shap_value"]), reverse=True)

        return {
            "risk":          round(risk, 4),
            "risk_label":    risk_label,
            "contributions": contributions,
            "rationale":     self._make_rationale(risk, risk_label, contributions),
        }

    def explain_window(self, delay_window: list[float]) -> dict:
        feats = extract_features(np.array(delay_window, dtype=float))
        return self.explain(dict(zip(self.FEATURE_ORDER, feats)))

    def _make_rationale(self, risk: float, risk_label: str, contributions: list) -> str:
        pct = round(risk * 100, 1)
        if not contributions:
            return f"Predicted {risk_label} risk ({pct}%)."
        parts = []
        for c in contributions[:2]:
            fname = c["feature"]
            val   = c["value"]
            if fname in ("avg_delay", "max_delay"):
                val_str = f"{round(val * 1000, 1)}ms"
            elif fname == "variance":
                val_str = f"{round(val * 1e6, 1)}ms²"
            elif fname in ("slope", "trend"):
                val_str = f"{round(val * 1000, 1)}ms"
            else:
                val_str = str(round(val, 4))
            direction = "increasing risk" if c["direction"] == "increases_risk" else "decreasing risk"
            parts.append(f"{fname} ({val_str}, {direction})")
        return f"Predicted {risk_label} risk ({pct}%) driven by {' and '.join(parts)}."
