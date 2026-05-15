"""
main.py — Entry point for the Neuronet IoT edge controller.

Starts:
  1. Digital-twin visualiser (background thread, refreshes every second)
  2. MQTT client (foreground, blocks and processes real hardware packets)

Real devices expected on topic  iot/data :
  - ESP32_N1   (ESP32 with DHT22)
  - ESP8266_N1 (ESP8266 node 1)
  - ESP8266_N2 (ESP8266 node 2)

Run from the project root:
    python -m edge_controller.main
  or
    python edge_controller/main.py
"""

import threading
import time
import sys
import os

# Ensure project root is on the path when run directly
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from digital_twin.visualizer import draw_graph
from edge_controller.mqtt_client import start as mqtt_start
from edge_controller.config import REAL_NODES, BROKER_HOST, BROKER_PORT


def run_visualizer():
    """Continuously redraw the digital-twin graph in the background."""
    while True:
        try:
            draw_graph()
        except Exception as e:
            print(f"[VIZ] Error: {e}")
        time.sleep(1)


if __name__ == "__main__":
    print("=" * 50)
    print("  Neuronet IoT — Edge Controller")
    print("=" * 50)
    print(f"  Broker : {BROKER_HOST}:{BROKER_PORT}")
    print(f"  Nodes  : {', '.join(REAL_NODES)}")
    print("  Mode   : REAL HARDWARE (MQTT)")
    print("=" * 50 + "\n")

    # Note: matplotlib visualiser disabled — it cannot run in a background
    # thread on Windows. Dashboard display is handled inside monitor.py.

    # Start the MQTT client — this blocks until Ctrl-C
    try:
        mqtt_start()
    except KeyboardInterrupt:
        print("\n[MAIN] Shutting down.")
