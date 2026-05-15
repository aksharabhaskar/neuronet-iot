"""
ml_engine/model.py — Congestion Prediction Model (v2)

Problem framing:
  Label = 1 if avg_delay in the NEXT 10 packets will exceed 0.080 s.
  Label = 0 if the network stays healthy for the next 10 packets.

  This is a PREDICTION problem, not detection.  During the rising-
  transition phase the current window avg may still be 0.055 s but
  slope is positive and the future avg will cross threshold — so the
  model must use slope/trend/variance, not just avg_delay.

Dataset:
  3 nodes × 60 mixed-state episodes per node.
  Each episode contains: normal ->rising ->congested ->recovery phases.
  Windows extracted with a 10-packet look-back and 10-packet look-ahead.
  Classes overlap in the critical 0.04 – 0.10 s zone ->realistic accuracy.

Methodology:
  - Random Forest (100 trees, max_depth=10)
  - Features: avg_delay, variance, max_delay, slope, trend
  - 70 / 15 / 15 stratified split
  - Metrics: accuracy, precision, recall, F1, ROC-AUC
"""

import numpy as np
import pandas as pd
import json
import os
import sys

from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import (
    classification_report, confusion_matrix,
    roc_auc_score, accuracy_score, roc_curve,
)
import joblib

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edge_controller.config import MODEL_PATH, MODEL_METRICS

np.random.seed(42)

WINDOW_SIZE  = 10       # packets used for feature extraction (look-back)
LOOK_AHEAD   = 10       # packets whose avg determines the label (look-forward)
THRESHOLD    = 0.080    # seconds — congestion boundary
N_EPISODES   = 60       # per node
NODES        = ["N1", "N2", "N3"]


# ---------------------------------------------------------------
# 1. Phase-level delay generators
# ---------------------------------------------------------------

def _normal_delays(n: int) -> np.ndarray:
    """
    Healthy network: clearly below threshold.
    ~65 % on-time, rest small jitter.  Mean ~0.015 s, well under 0.080 s.
    """
    delays = np.zeros(n)
    r = np.random.random(n)
    jitter = (r >= 0.65) & (r < 0.90)
    medium = (r >= 0.90)
    delays[jitter] = np.abs(np.random.normal(0.015, 0.010, jitter.sum()))
    delays[medium] = np.abs(np.random.normal(0.045, 0.012, medium.sum()))
    return np.clip(delays, 0, 0.075)   # hard cap: never crosses threshold alone


def _congested_delays(n: int) -> np.ndarray:
    """
    Fully congested: clearly above threshold.
    Mean ~0.38 s, minimum floor ~0.100 s.
    """
    delays = np.zeros(n)
    r = np.random.random(n)
    med   = r < 0.25
    high  = (r >= 0.25) & (r < 0.65)
    vhigh = (r >= 0.65)
    delays[med]   = np.abs(np.random.normal(0.140, 0.025, med.sum()))
    delays[high]  = np.abs(np.random.normal(0.340, 0.080, high.sum()))
    delays[vhigh] = np.abs(np.random.normal(0.700, 0.180, vhigh.sum()))
    return np.clip(delays, 0.090, None)  # floor above threshold


def _transition_delays(n: int, rising: bool) -> np.ndarray:
    """
    Gradual transition through the ambiguous 0.040 – 0.120 s zone.
    rising=True  ->ramps from ~0.020 s up to ~0.130 s
    rising=False ->ramps from ~0.130 s back down to ~0.020 s
    This is the zone that forces the model to use slope/trend.
    """
    if n == 0:
        return np.array([])
    t = np.linspace(0, 1, n)
    if rising:
        base = 0.020 + t * 0.110          # 0.020 ->0.130
    else:
        base = 0.130 - t * 0.110          # 0.130 ->0.020
    noise = np.random.normal(0, 0.018, n)
    return np.clip(base + noise, 0, None)


# ---------------------------------------------------------------
# 2. Episode generation
# ---------------------------------------------------------------

def _generate_episode() -> np.ndarray:
    """
    One episode = normal ->rising ->congested ->recovery.
    Phase lengths are randomised to prevent the model from learning
    position-within-episode as a proxy.
    """
    normal_len     = np.random.randint(40, 100)
    rise_len       = np.random.randint(20, 50)
    congested_len  = np.random.randint(40, 100)
    recovery_len   = np.random.randint(20, 50)
    tail_len       = np.random.randint(30, 80)   # second normal period

    seq = np.concatenate([
        _normal_delays(normal_len),
        _transition_delays(rise_len,    rising=True),
        _congested_delays(congested_len),
        _transition_delays(recovery_len, rising=False),
        _normal_delays(tail_len),
    ])
    return seq


# ---------------------------------------------------------------
# 3. Feature extraction (unchanged — used by predict.py too)
# ---------------------------------------------------------------

def extract_features(window: np.ndarray) -> list[float]:
    """
    5 features from a rolling window of delay values:
      avg_delay — mean
      variance  — spread / instability
      max_delay — worst-case in window
      slope     — linear trend (positive = rising)
      trend     — avg(second half) - avg(first half)
    """
    if len(window) < 2:
        return [0.0, 0.0, 0.0, 0.0, 0.0]

    avg      = float(np.mean(window))
    variance = float(np.var(window))
    max_val  = float(np.max(window))
    x        = np.arange(len(window), dtype=float)
    slope    = float(np.polyfit(x, window, 1)[0])
    mid      = len(window) // 2
    trend    = float(np.mean(window[mid:]) - np.mean(window[:mid]))

    return [avg, variance, max_val, slope, trend]


# ---------------------------------------------------------------
# 4. Dataset generation with look-ahead labelling
# ---------------------------------------------------------------

def generate_dataset() -> tuple[np.ndarray, np.ndarray]:
    """
    For every position i in every episode:
      features = extract_features(delays[i-WINDOW_SIZE : i])
      label    = 1 if mean(delays[i : i+LOOK_AHEAD]) > THRESHOLD else 0

    This means a window whose current avg is 0.055 s but is rising
    sharply gets label=1 — the model must learn to predict from slope
    and trend, not just avg_delay.
    """
    X, y = [], []

    for node in NODES:
        for _ in range(N_EPISODES):
            delays = _generate_episode()
            n = len(delays)

            for i in range(WINDOW_SIZE, n - LOOK_AHEAD):
                window      = delays[i - WINDOW_SIZE : i]
                future      = delays[i : i + LOOK_AHEAD]
                features    = extract_features(window)
                label       = int(np.mean(future) > THRESHOLD)
                X.append(features)
                y.append(label)

    return np.array(X), np.array(y)


# ---------------------------------------------------------------
# 5. Train, evaluate, save
# ---------------------------------------------------------------

def train():
    print("=" * 55)
    print("  Neuronet IoT — Congestion Prediction Model v2")
    print("=" * 55)
    print(f"\n  Labelling: avg of next {LOOK_AHEAD} packets > {THRESHOLD:.3f} s -> Congested")
    print(f"  Features : 10-packet look-back window")

    # --- Generate dataset ---
    print("\n[1/4] Generating predictive dataset...")
    X, y = generate_dataset()
    n_normal     = (y == 0).sum()
    n_congested  = (y == 1).sum()
    print(f"      Total samples : {len(X)}")
    print(f"      Normal (0)    : {n_normal}  ({100*n_normal/len(X):.1f} %)")
    print(f"      Congested (1) : {n_congested}  ({100*n_congested/len(X):.1f} %)")

    # --- Split ---
    print("\n[2/4] Splitting dataset (70 / 15 / 15, stratified)...")
    X_train, X_tmp, y_train, y_tmp = train_test_split(
        X, y, test_size=0.30, random_state=42, stratify=y
    )
    X_val, X_test, y_val, y_test = train_test_split(
        X_tmp, y_tmp, test_size=0.50, random_state=42, stratify=y_tmp
    )
    print(f"      Train : {len(X_train)}")
    print(f"      Val   : {len(X_val)}")
    print(f"      Test  : {len(X_test)}")

    # --- Train ---
    print("\n[3/4] Training Random Forest (100 trees, max_depth=10)...")
    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=10,
        min_samples_split=8,
        min_samples_leaf=4,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    cv_scores = cross_val_score(model, X_train, y_train, cv=5, scoring="f1")
    print(f"      5-fold CV F1  : {cv_scores.mean():.4f} ± {cv_scores.std():.4f}")

    # --- Evaluate ---
    print("\n[4/4] Evaluating on held-out sets...")

    val_pred   = model.predict(X_val)
    val_proba  = model.predict_proba(X_val)[:, 1]
    val_acc    = accuracy_score(y_val, val_pred)
    val_auc    = roc_auc_score(y_val, val_proba)

    test_pred  = model.predict(X_test)
    test_proba = model.predict_proba(X_test)[:, 1]
    test_acc   = accuracy_score(y_test, test_pred)
    test_auc   = roc_auc_score(y_test, test_proba)

    print(f"\n  Validation  — Accuracy: {val_acc:.4f}  AUC: {val_auc:.4f}")
    print(f"  Test        — Accuracy: {test_acc:.4f}  AUC: {test_auc:.4f}")
    print(f"\n  Classification Report (Test Set):")
    print(classification_report(y_test, test_pred,
                                target_names=["Normal", "Congested"]))

    print("  Feature Importance:")
    names = ["avg_delay", "variance", "max_delay", "slope", "trend"]
    for name, imp in sorted(zip(names, model.feature_importances_),
                            key=lambda x: -x[1]):
        bar = "#" * int(imp * 40)
        print(f"    {name:<12} {imp:.4f}  {bar}")

    cm = confusion_matrix(y_test, test_pred)
    fpr, tpr, _ = roc_curve(y_test, test_proba)
    report_dict = classification_report(
        y_test, test_pred,
        target_names=["Normal", "Congested"],
        output_dict=True,
    )

    # --- Save model ---
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    print(f"\n  Model saved   ->{MODEL_PATH}")

    # --- Save metrics ---
    metrics = {
        "val_accuracy"          : round(val_acc,  4),
        "val_auc"               : round(val_auc,  4),
        "test_accuracy"         : round(test_acc, 4),
        "test_auc"              : round(test_auc, 4),
        "cv_f1_mean"            : round(float(cv_scores.mean()), 4),
        "cv_f1_std"             : round(float(cv_scores.std()),  4),
        "classification_report" : report_dict,
        "confusion_matrix"      : cm.tolist(),
        "feature_importance"    : model.feature_importances_.tolist(),
        "feature_names"         : ["avg_delay", "variance", "max_delay", "slope", "trend"],
        "roc_fpr"               : [round(v, 4) for v in fpr.tolist()],
        "roc_tpr"               : [round(v, 4) for v in tpr.tolist()],
        "train_size"            : len(X_train),
        "val_size"              : len(X_val),
        "test_size"             : len(X_test),
        "window_size"           : WINDOW_SIZE,
        "look_ahead"            : LOOK_AHEAD,
        "threshold"             : THRESHOLD,
        "n_estimators"          : 100,
        "model_type"            : "RandomForestClassifier",
        "label_strategy"        : f"future_{LOOK_AHEAD}pkt_avg_gt_{THRESHOLD}",
    }

    with open(MODEL_METRICS, "w") as f:
        json.dump(metrics, f, indent=2)

    print(f"  Metrics saved ->{MODEL_METRICS}")
    print("\n" + "=" * 55)
    print("  Training complete.")
    print("=" * 55)

    return model, metrics


if __name__ == "__main__":
    train()
