"""
monitor.py — processes real MQTT packets from IR sensor nodes.

Payload format (live hardware):
    { "node_id": "N1", "timestamp": 74.23,
      "ir_value": 44, "detected": true }

Congestion is measured by comparing device-side timestamp gaps
with server receive-time gaps to isolate true network latency.
ML predictor is called on every packet for early-warning risk scoring.
"""

import time
import csv
import os
import threading
from collections import deque

from digital_twin.twin import build_topology, update_edge_weights
from control_engine.routing import compute_route
from edge_controller.config import (
    CONGESTION_THRESHOLD, CONGESTION_CLEAR,
    LATENCY_WINDOW_SIZE, BATTERY_LOW_THRESHOLD,
    LOG_FILE, MODEL_PATH, REAL_NODES,
)

# ---------------------------------------------------------------
# ML predictor — loaded once, gracefully skipped if not trained
# ---------------------------------------------------------------
_predictor = None

def _load_predictor():
    global _predictor
    if os.path.exists(MODEL_PATH):
        try:
            from ml_engine.predict import CongestionPredictor
            _predictor = CongestionPredictor()
        except Exception as e:
            print(f"[ML] Could not load predictor: {e}")
    else:
        print("[ML] model.pkl not found — run 'python -m ml_engine.model' to train.")

_load_predictor()

# ---------------------------------------------------------------
# Per-node state
# ---------------------------------------------------------------
_last_device_ts:   dict[str, float] = {}
_last_wall_ts:     dict[str, float] = {}
_delay_window:     dict[str, deque] = {}
_congestion_state: dict[str, bool]  = {}
_node_state:       dict[str, dict]  = {}
_packet_count:     dict[str, int]   = {}
_total_packets:    int = 0
_last_display:     float = 0.0

last_seen:        dict[str, float] = {}
dead_nodes:       set[str]         = set()
last_explanation: dict[str, dict]  = {}
_EVENTS_LOG = os.path.join(os.path.dirname(LOG_FILE), "events.log")

DISPLAY_INTERVAL = 3.0
_lock = threading.RLock()

# ---------------------------------------------------------------
# CSV
# ---------------------------------------------------------------
_LOG_HEADERS = [
    "wall_time", "node_id", "device_ts",
    "network_delay_s", "avg_delay_s",
    "congestion", "ml_risk", "risk_label", "action", "routing",
    "ir_value", "detected", "battery_pct",
    "routing_path", "dead_nodes", "ml_rationale",
]


def _ensure_log():
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    if not os.path.exists(LOG_FILE) or os.path.getsize(LOG_FILE) == 0:
        with open(LOG_FILE, "w", newline="") as f:
            csv.DictWriter(f, fieldnames=_LOG_HEADERS).writeheader()


def _append_log(row: dict):
    with open(LOG_FILE, "a", newline="", encoding="utf-8") as f:
        csv.DictWriter(f, fieldnames=_LOG_HEADERS,
                       extrasaction="ignore",
                       quoting=csv.QUOTE_ALL).writerow(row)


# ---------------------------------------------------------------
# Latency helpers
# ---------------------------------------------------------------
def _compute_delay(node_id, device_ts, wall_now):
    if node_id not in _last_device_ts:
        return None
    dg = device_ts - _last_device_ts[node_id]
    wg = wall_now  - _last_wall_ts[node_id]
    if dg <= 0 or dg > 30:
        return None
    return max(wg - dg, 0.0)


def _update_congestion(node_id, delay):
    if node_id not in _delay_window:
        _delay_window[node_id]     = deque(maxlen=LATENCY_WINDOW_SIZE)
        _congestion_state[node_id] = False

    if delay is not None:
        _delay_window[node_id].append(delay)

    w   = _delay_window[node_id]
    avg = sum(w) / len(w) if w else 0.0

    if avg > CONGESTION_THRESHOLD:
        _congestion_state[node_id] = True
    elif avg < CONGESTION_CLEAR:
        _congestion_state[node_id] = False

    return _congestion_state[node_id], avg


# ---------------------------------------------------------------
# Dashboard display
# ---------------------------------------------------------------
def _print_dashboard():
    os.system("cls")
    now_str = time.strftime("%H:%M:%S")
    print("=" * 58)
    print("   NEURONET IoT  --  LIVE DASHBOARD")
    print(f"   {now_str}   |   Active: {len(_node_state)}/{len(REAL_NODES)}"
          f"   |   Packets: {_total_packets}")
    print("=" * 58)

    for nid in sorted(REAL_NODES):
        if nid not in _node_state:
            print(f"\n  [{nid}]  -- waiting --")
            continue

        s        = _node_state[nid]
        det_str  = "DETECTED" if s["detected"] else "no object"
        cong_str = "(!!)" if s["congestion"] else "(ok)"
        risk_str = s["risk_label"]
        ms       = s["avg_delay"] * 1000

        print(f"\n  [{nid}]  pkts={_packet_count.get(nid, 0)}")
        print(f"    IR sensor  : {str(s['ir_value']):>5}   {det_str}")
        print(f"    Avg delay  : {ms:.1f} ms   Congestion: {cong_str}")
        print(f"    ML risk    : {s['ml_risk']*100:.0f}%   {risk_str}")
        print(f"    Action     : {s['action']}")
        print(f"    Route      : {s.get('routing_path', s.get('routing', ''))}")

    print("\n" + "=" * 58)
    print("   Logging → data/logs.csv   |   Ctrl+C to stop")
    print("=" * 58)


# ---------------------------------------------------------------
# Control decision
# ---------------------------------------------------------------
def _control_action(congestion, battery, detected):
    if congestion:
        return "PRIORITIZE & REROUTE" if detected else "DROP / DELAY PACKET"
    if battery < BATTERY_LOW_THRESHOLD:
        return "REDUCE NODE ACTIVITY"
    if detected:
        return "OBJECT DETECTED - LOG EVENT"
    return "NORMAL"


def _write_event(event: str) -> None:
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    os.makedirs(os.path.dirname(_EVENTS_LOG), exist_ok=True)
    with open(_EVENTS_LOG, "a", encoding="utf-8") as f:
        f.write(f"{ts} {event}\n")


def mark_dead(node_id: str, reason: str) -> None:
    with _lock:
        if node_id in dead_nodes:
            return
        dead_nodes.add(node_id)
    _write_event(f"FAILOVER_DEAD {node_id} {reason}")


def check_heartbeats() -> None:
    from edge_controller.config import HEARTBEAT_TIMEOUT
    now = time.time()
    for nid, ts in list(last_seen.items()):
        if now - ts > HEARTBEAT_TIMEOUT:
            mark_dead(nid, "heartbeat")


# ---------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------
def process_packet(data: dict):
    with _lock:
        _process_packet_locked(data)


def _process_packet_locked(data: dict):
    global _total_packets, _last_display

    _ensure_log()

    wall_now  = time.time()

    # Normalise node_id: "ESP32_N1" / "ESP8266_N2" -> "N1" / "N2"
    raw_id  = data.get("node_id", "unknown")
    node_id = raw_id.split("_")[-1] if "_" in raw_id else raw_id

    device_ts = float(data.get("timestamp", 0.0))

    if node_id in dead_nodes:
        dead_nodes.discard(node_id)
        _write_event(f"FAILOVER_RECOVERED {node_id}")
    last_seen[node_id] = wall_now

    # Support both flat format {ir_value, detected, battery}
    # and nested sketch format {sensors: {analog}, health: {battery}}
    sensors = data.get("sensors", {})
    health  = data.get("health",  {})

    if "ir_value" in data:
        ir_value = data["ir_value"]
        detected = data.get("detected", False)
    else:
        # analog is 0-100 % of full-scale ADC; threshold 900/4095 ~ 22 %
        analog   = float(sensors.get("analog", 100.0))
        ir_value = int(analog / 100.0 * 4095)
        detected = analog < 22.0

    if "battery" in data:
        battery = float(data["battery"])
    else:
        battery = float(health.get("battery", 100.0))

    delay               = _compute_delay(node_id, device_ts, wall_now)
    congestion, avg_del = _update_congestion(node_id, delay)

    _last_device_ts[node_id] = device_ts
    _last_wall_ts[node_id]   = wall_now

    # ML prediction
    ml_risk = 0.0
    ml_rationale = ""
    if _predictor is not None:
        window = list(_delay_window.get(node_id, []))
        if len(window) >= 2:
            ml_risk = _predictor.predict(window)
            explanation = _predictor.explain_window(window)
            last_explanation[node_id] = explanation
            ml_rationale = explanation.get("rationale", "")

    risk_label = (_predictor.risk_label(ml_risk)
                  if _predictor else "N/A")

    node_states = {
        nid: {
            "avg_delay": st["avg_delay"],
            "ml_risk":   st["ml_risk"],
            "battery":   st["battery"],
        }
        for nid, st in _node_state.items()
    }
    node_states[node_id] = {
        "avg_delay": avg_del,
        "ml_risk":   ml_risk,
        "battery":   battery,
    }
    graph = build_topology()
    for n in dead_nodes:
        if n in graph.nodes:
            graph.remove_node(n)
    update_edge_weights(graph, node_states)
    route = compute_route(node_id, graph)

    if route == ["UNREACHABLE"]:
        routing_path = "UNREACHABLE"
        action = "DROP / DELAY PACKET"
    else:
        routing_path = "->".join(route)
        action = "SHORTEST PATH" if len(route) <= 3 else "LOW-CONGESTION PATH"

    _total_packets += 1
    _packet_count[node_id] = _packet_count.get(node_id, 0) + 1

    _node_state[node_id] = {
        "ir_value":     ir_value,
        "detected":     detected,
        "avg_delay":    avg_del,
        "congestion":   congestion,
        "ml_risk":      ml_risk,
        "risk_label":   risk_label,
        "action":       action,
        "routing":      routing_path,
        "routing_path": routing_path,
        "battery":      battery,
    }

    if wall_now - _last_display >= DISPLAY_INTERVAL:
        _print_dashboard()
        _last_display = wall_now

    _append_log({
        "wall_time":       round(wall_now, 3),
        "node_id":         node_id,
        "device_ts":       device_ts,
        "network_delay_s": round(delay, 4) if delay is not None else "",
        "avg_delay_s":     round(avg_del, 4),
        "congestion":      congestion,
        "ml_risk":         round(ml_risk, 4),
        "risk_label":      risk_label,
        "action":          action,
        "routing":         routing_path,
        "ir_value":        ir_value,
        "detected":        detected,
        "battery_pct":     battery,
        "routing_path":    routing_path,
        "dead_nodes":      ",".join(sorted(dead_nodes)),
        "ml_rationale":    ml_rationale,
    })
    check_heartbeats()
