"""
usb_serial_reader.py — USB Serial mode for NeuroNet IoT nodes.

Alternative to the MQTT/WiFi stack. Each ESP node is connected
directly to the PC via USB and prints JSON lines at 115200 baud.
This script reads those lines, feeds them into the same
process_packet() pipeline, and logs to data/logs.csv — identical
to the MQTT path.

Usage
-----
Auto-detect (recommended — scans all COM ports):
    python edge_controller/usb_serial_reader.py

Manual port assignment:
    python edge_controller/usb_serial_reader.py --n1 COM3 --n2 COM4 --n3 COM5

To find COM ports: Device Manager > Ports (COM & LPT)
"""

import argparse
import json
import os
import sys
import threading
import time

import serial
import serial.tools.list_ports

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edge_controller.monitor import process_packet

BAUD_RATE  = 115200
KNOWN_NODES = {"N1", "N2", "N3"}


# ---------------------------------------------------------------
# Auto-detection
# ---------------------------------------------------------------

def _probe_port(port: str, results: dict, lock: threading.Lock):
    """Open a port and try to read a valid JSON node packet from it."""
    try:
        with serial.Serial(port, BAUD_RATE, timeout=4) as ser:
            for _ in range(15):
                raw = ser.readline().decode("utf-8", errors="ignore").strip()
                if not raw:
                    continue
                try:
                    data = json.loads(raw)
                    nid  = data.get("node_id", "")
                    if nid in KNOWN_NODES:
                        with lock:
                            results[nid] = port
                        print(f"[USB] Auto-detected {nid} on {port}")
                        return
                except json.JSONDecodeError:
                    pass
    except (serial.SerialException, OSError):
        pass


def auto_detect_ports() -> dict[str, str]:
    """
    Scan all available COM ports in parallel and return a
    {node_id: port} mapping for whichever nodes are found.
    """
    available = [p.device for p in serial.tools.list_ports.comports()]
    if not available:
        print("[USB] No COM ports found.")
        return {}

    print(f"[USB] Scanning {len(available)} port(s): {', '.join(available)}")

    results: dict[str, str] = {}
    lock    = threading.Lock()
    threads = [
        threading.Thread(target=_probe_port, args=(p, results, lock), daemon=True)
        for p in available
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    return results


# ---------------------------------------------------------------
# Per-node reader thread
# ---------------------------------------------------------------

def _read_node(node_id: str, port: str):
    """Continuously read JSON lines from a serial port and process them."""
    print(f"[USB] Opening {port} for {node_id} ...")
    while True:
        try:
            with serial.Serial(port, BAUD_RATE, timeout=2) as ser:
                print(f"[USB] {node_id} connected on {port}")
                while True:
                    raw = ser.readline().decode("utf-8", errors="ignore").strip()
                    if not raw:
                        continue
                    try:
                        data = json.loads(raw)
                        process_packet(data)
                    except json.JSONDecodeError:
                        pass  # skip boot messages / garbage lines
        except serial.SerialException as exc:
            print(f"[USB] {node_id} on {port} disconnected: {exc}")
            print(f"[USB] Retrying {node_id} in 3 s ...")
            time.sleep(3)


# ---------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------

def start(node_ports: dict[str, str]):
    if not node_ports:
        print("[USB] No nodes to connect to. Exiting.")
        return

    print("=" * 50)
    print("  NeuroNet IoT — USB Serial Reader")
    print("=" * 50)
    for nid, port in node_ports.items():
        print(f"  {nid} → {port}")
    print("  Mode   : USB SERIAL (no WiFi / MQTT)")
    print("  Log    : data/logs.csv")
    print("=" * 50 + "\n")

    threads = []
    for nid, port in node_ports.items():
        t = threading.Thread(target=_read_node, args=(nid, port), daemon=True)
        t.start()
        threads.append(t)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[USB] Shutting down.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NeuroNet IoT USB Serial Reader")
    parser.add_argument("--n1", metavar="PORT", help="COM port for N1 (e.g. COM3)")
    parser.add_argument("--n2", metavar="PORT", help="COM port for N2 (e.g. COM4)")
    parser.add_argument("--n3", metavar="PORT", help="COM port for N3 (e.g. COM5)")
    args = parser.parse_args()

    manual = {
        k: v for k, v in {"N1": args.n1, "N2": args.n2, "N3": args.n3}.items()
        if v is not None
    }

    if manual:
        node_ports = manual
    else:
        print("[USB] No ports specified — running auto-detection ...")
        node_ports = auto_detect_ports()
        if not node_ports:
            print("[USB] Auto-detection found nothing.")
            print("[USB] Specify ports manually: --n1 COM3 --n2 COM4 --n3 COM5")
            sys.exit(1)

    start(node_ports)
