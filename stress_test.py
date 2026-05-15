"""
stress_test.py — Demo congestion trigger

Floods the MQTT broker with rapid-fire messages to create real,
measurable network congestion on the live dashboard.

Usage:
    python stress_test.py            # 10-second burst, default settings
    python stress_test.py --dur 20   # 20-second burst
    python stress_test.py --rate 300 # 300 messages/second

Run while the dashboard and edge controller are both open.
Watch the ML risk gauges and latency chart respond in real time.
"""

import json
import time
import argparse
import paho.mqtt.client as mqtt

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from edge_controller.config import BROKER_HOST, BROKER_PORT, MQTT_TOPIC_DATA

def run(duration: int = 10, rate: int = 200):
    client = mqtt.Client()
    client.connect(BROKER_HOST, BROKER_PORT, 60)
    client.loop_start()

    interval = 1.0 / rate
    end_time = time.time() + duration
    sent     = 0

    print(f"[STRESS] Flooding broker at ~{rate} msg/s for {duration}s ...")
    print(f"[STRESS] Watch the dashboard — latency and ML risk should rise.\n")

    while time.time() < end_time:
        for node_id in ["N1", "N2", "N3"]:
            payload = json.dumps({
                "node_id":  node_id,
                "timestamp": time.time(),
                "ir_value": 44,
                "detected": True,
            })
            client.publish(MQTT_TOPIC_DATA, payload)
            sent += 1
        time.sleep(interval)

    client.loop_stop()
    client.disconnect()
    print(f"\n[STRESS] Done. Sent {sent} messages over {duration}s.")
    print(f"[STRESS] Network should clear within ~5s of stopping.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Neuronet IoT stress test")
    parser.add_argument("--dur",  type=int, default=10,  help="Duration in seconds")
    parser.add_argument("--rate", type=int, default=200, help="Messages per second")
    args = parser.parse_args()
    run(duration=args.dur, rate=args.rate)
