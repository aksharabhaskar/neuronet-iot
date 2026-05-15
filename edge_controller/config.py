# ============================================================
#  Neuronet IoT — Central Configuration
# ============================================================

import os
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent

# --- MQTT Broker ---
BROKER_HOST = os.getenv("BROKER_HOST", "localhost")
BROKER_PORT  = int(os.getenv("BROKER_PORT", "1883"))

# Topics
MQTT_TOPIC_DATA = "iot/data"
MQTT_TOPIC_CMD  = "cmd/{node_id}"

# --- Real nodes ---
REAL_NODES = ["N1", "N2", "N3"]

# --- Congestion detection ---
# Thresholds calibrated to real hardware observations.
# Real WiFi delays: 0.0-0.05s normal, spikes to 0.49s observed.
# Congestion is declared at 0.08s avg — well above normal noise floor.
EXPECTED_PUBLISH_INTERVAL = 1.0   # seconds
CONGESTION_THRESHOLD      = 0.08  # avg delay above this = congested
CONGESTION_CLEAR          = 0.05  # avg delay below this = clear
LATENCY_WINDOW_SIZE       = 10    # rolling window (packets per node)

# --- IR sensor ---
IR_NO_DETECT_THRESHOLD = 900      # ADC >= this means nothing detected

# --- Battery ---
BATTERY_LOW_THRESHOLD = 40        # %

# --- Data / model paths ---
LOG_FILE      = str(_PROJECT_ROOT / "data" / "logs.csv")
MODEL_PATH    = str(_PROJECT_ROOT / "data" / "model.pkl")
MODEL_METRICS = str(_PROJECT_ROOT / "data" / "model_metrics.json")
