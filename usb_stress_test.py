"""
usb_stress_test.py
──────────────────
USB-mode stress test for NeuroNet IoT.

Since USB serial has no broker to flood, congestion is demonstrated by
injecting packets with artificially inflated wall-time gaps directly into
monitor.process_packet() — the same pipeline used by usb_serial_reader.py.

The script cycles through four phases to produce a realistic congestion
event that the ML model can detect and predict:

  Phase 1 — NORMAL    : packets arrive on schedule (~1 s apart, low jitter)
  Phase 2 — RISING    : inter-packet gap ramps up linearly (simulates a
                         backing-up serial buffer or slow host)
  Phase 3 — CONGESTED : sustained high delay (> 80 ms rolling average)
  Phase 4 — RECOVERY  : gap ramps back down to normal

The script calls monitor.process_packet() in a tight loop, spoofing the
wall_time field so the edge controller computes the inflated network delay
without touching any real serial port.

Usage
─────
  # Run one full cycle (normal → rising → congested → recovery)
  python usb_stress_test.py

  # Run for 60 s with heavier congestion
  python usb_stress_test.py --dur 60 --peak-delay 0.5

  # Only stress node N2, leave others idle
  python usb_stress_test.py --nodes N2

  # Watch the terminal dashboard while this runs in another terminal:
  #   python edge_controller/usb_serial_reader.py
  # (the stress test patches monitor directly; no serial port needed)

Arguments
─────────
  --dur         Total test duration in seconds            (default: 40)
  --peak-delay  Max injected inter-packet gap in seconds  (default: 0.35)
  --nodes       Comma-separated node list                 (default: N1,N2,N3)
  --rate        Packets per second per node in normal phase (default: 1)
  --no-recovery Skip recovery phase — stays congested until timeout

What you will see on the dashboard
───────────────────────────────────
  • Rising delay curves on the Network Activity chart
  • ML risk % climbing toward HIGH RISK on all stressed nodes
  • Routing switching from SHORTEST PATH → LOW-CONGESTION PATH
  • Congestion heatmap cells turning amber then red
  • HIGH RISK toast alerts on the Overview tab
  • System returns to normal within a few seconds after the test ends
"""

import argparse
import json
import math
import random
import sys
import time
import threading
from pathlib import Path

# ── Make sure the project root is on sys.path ────────────────────────
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# ── Import the edge controller monitor ───────────────────────────────
try:
    from edge_controller.monitor import process_packet
except ImportError as e:
    print(f"[ERROR] Cannot import edge_controller.monitor: {e}")
    print("  Make sure you run this script from the neuronet-iot project root.")
    sys.exit(1)

# ── Constants ────────────────────────────────────────────────────────
NODES              = ['N1', 'N2', 'N3']
EXPECTED_INTERVAL  = 1.0          # seconds — matches config.EXPECTED_PUBLISH_INTERVAL
BAUD               = 115200       # informational only; no real port used

# IR sensor plausible values per node
IR_RANGES = {
    'N1': (40,  900),   # ESP8266 analog 0–1023; detected < 225
    'N2': (40,  900),
    'N3': (0,   1),     # ESP32 digital; 0 = detected
}

# ── Helpers ───────────────────────────────────────────────────────────

def make_packet(node_id: str, device_ts: float) -> dict:
    """Construct a JSON packet matching the real node serial format."""
    lo, hi = IR_RANGES[node_id]
    ir_val  = random.randint(lo, hi)
    if node_id in ('N1', 'N2'):
        detected = ir_val < 225
    else:
        detected = ir_val == 0
    return {
        'node_id':   node_id,
        'timestamp': round(device_ts, 3),
        'ir_value':  ir_val,
        'detected':  detected,
    }


def interp(start: float, end: float, t: float) -> float:
    """Linear interpolation; t in [0, 1]."""
    return start + (end - start) * t


def phase_delay(phase: str, progress: float, peak: float) -> float:
    """
    Returns the wall-time sleep between packets for a given phase.

    progress — float in [0, 1], how far through the phase we are
    peak     — configured peak delay in seconds
    """
    if phase == 'normal':
        # On-time with small jitter (≤ 10 ms)
        return EXPECTED_INTERVAL + random.uniform(-0.01, 0.01)

    elif phase == 'rising':
        # Linear ramp from normal → peak
        base = interp(EXPECTED_INTERVAL, EXPECTED_INTERVAL + peak, progress)
        return base + random.uniform(0, 0.02)

    elif phase == 'congested':
        # Sustained high delay with realistic variation
        # Mimics the three congestion sub-levels from the training data:
        # medium (140 ms), high (340 ms), very high (700 ms)
        roll = random.random()
        if roll < 0.55:
            target = EXPECTED_INTERVAL + peak * 0.5            # medium
        elif roll < 0.85:
            target = EXPECTED_INTERVAL + peak                   # high
        else:
            target = EXPECTED_INTERVAL + peak * 2.0            # very high spike
        return target + random.uniform(0, 0.03)

    elif phase == 'recovery':
        # Linear ramp back from peak → normal
        base = interp(EXPECTED_INTERVAL + peak, EXPECTED_INTERVAL, progress)
        return base + random.uniform(0, 0.01)

    return EXPECTED_INTERVAL


def print_banner(args: argparse.Namespace) -> None:
    nodes_str = ', '.join(args.nodes)
    print()
    print('═' * 62)
    print('   NeuroNet IoT — USB Stress Test')
    print('═' * 62)
    print(f'   Nodes        : {nodes_str}')
    print(f'   Duration     : {args.dur} s')
    print(f'   Peak delay   : {args.peak_delay * 1000:.0f} ms injected inter-packet gap')
    print(f'   Rate (normal): {args.rate} pkt/s per node')
    print(f'   Recovery     : {"disabled" if args.no_recovery else "enabled"}')
    print('─' * 62)
    print('   Phases: NORMAL → RISING → CONGESTED',
          '→ RECOVERY' if not args.no_recovery else '(no recovery)')
    print('─' * 62)
    print('   Watch the dashboard at http://localhost:5173')
    print('═' * 62)
    print()


def run_node(node_id: str, args: argparse.Namespace, stop_event: threading.Event) -> None:
    """
    Drives one node through the stress-test phases.
    Runs in its own thread so all nodes are stressed concurrently.
    """
    start_wall   = time.time()
    device_clock = 0.0          # simulated millis()/1000
    pkt_count    = 0

    # Phase schedule (fractions of total duration)
    if args.no_recovery:
        phases = [
            ('normal',    0.15),
            ('rising',    0.20),
            ('congested', 0.65),
        ]
    else:
        phases = [
            ('normal',    0.15),
            ('rising',    0.20),
            ('congested', 0.45),
            ('recovery',  0.20),
        ]

    # Precompute phase end times
    total        = float(args.dur)
    phase_ends   = []
    cursor       = start_wall
    for name, frac in phases:
        cursor += total * frac
        phase_ends.append((name, cursor))

    def current_phase(now: float):
        for name, end in phase_ends:
            if now < end:
                progress = 1.0 - (end - now) / (total * dict(phases)[name])
                return name, max(0.0, min(1.0, progress))
        return phase_ends[-1][0], 1.0

    print(f'  [{node_id}] started  (device clock offset: {device_clock:.2f}s)')

    while not stop_event.is_set():
        now   = time.time()
        elapsed = now - start_wall
        if elapsed >= total:
            break

        phase, progress = current_phase(now)
        sleep_s         = phase_delay(phase, progress, args.peak_delay)

        # Advance device clock by expected interval (device has no concept of host delay)
        device_clock += EXPECTED_INTERVAL + random.uniform(-0.005, 0.005)

        pkt = make_packet(node_id, device_clock)

        # Inject the packet into the monitor pipeline.
        # We pass wall_time explicitly so the computed network_delay reflects
        # the injected sleep, not just the function call overhead.
        # process_packet signature: process_packet(packet: dict, wall_time: float = None)
        try:
            process_packet(pkt, wall_time=now)
        except TypeError:
            # Fallback if wall_time kwarg not supported — patch time.time temporarily
            _orig = time.time
            time.time = lambda: now  # type: ignore[assignment]
            try:
                process_packet(pkt)
            finally:
                time.time = _orig

        pkt_count += 1

        # Log phase transitions to stdout
        if pkt_count % 5 == 0:
            delay_ms = sleep_s * 1000
            print(f'  [{node_id}] pkt={pkt_count:4d}  phase={phase:10s}  '
                  f'injected_delay={delay_ms:6.1f}ms  '
                  f'device_ts={device_clock:7.2f}s')

        # Sleep for the injected inter-packet gap
        # Use stop_event.wait so we can abort cleanly mid-sleep
        stop_event.wait(timeout=sleep_s)

    print(f'  [{node_id}] finished — {pkt_count} packets sent')


def print_summary(start: float, nodes: list[str]) -> None:
    elapsed = time.time() - start
    print()
    print('═' * 62)
    print('   USB Stress Test Complete')
    print('─' * 62)
    print(f'   Duration     : {elapsed:.1f} s')
    print(f'   Nodes tested : {", ".join(nodes)}')
    print()
    print('   The dashboard should show:')
    print('   ✓ Delay curves returning to baseline')
    print('   ✓ ML risk dropping back to LOW RISK')
    print('   ✓ Routing reverting to SHORTEST PATH')
    print('═' * 62)
    print()


# ── Entry point ───────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description='USB-mode stress test for NeuroNet IoT — drives congestion '
                    'via monitor.process_packet() without any serial port or broker.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--dur',         type=float, default=40.0,
                        help='Total test duration in seconds (default: 40)')
    parser.add_argument('--peak-delay',  type=float, default=0.35,
                        help='Peak injected inter-packet delay in seconds (default: 0.35 = 350 ms)')
    parser.add_argument('--nodes',       type=str,   default='N1,N2,N3',
                        help='Comma-separated nodes to stress (default: N1,N2,N3)')
    parser.add_argument('--rate',        type=float, default=1.0,
                        help='Packets/s per node in normal phase (default: 1)')
    parser.add_argument('--no-recovery', action='store_true',
                        help='Skip recovery phase; stay congested until timeout')
    args = parser.parse_args()

    # Parse node list
    args.nodes = [n.strip().upper() for n in args.nodes.split(',') if n.strip().upper() in NODES]
    if not args.nodes:
        print('[ERROR] No valid nodes specified. Choose from N1, N2, N3.')
        sys.exit(1)

    print_banner(args)

    stop_event = threading.Event()
    threads    = []
    start_time = time.time()

    # Stagger node starts slightly so they don't all fire at the same wall_time
    for i, node_id in enumerate(args.nodes):
        t = threading.Thread(
            target=run_node,
            args=(node_id, args, stop_event),
            name=f'stress-{node_id}',
            daemon=True,
        )
        threads.append(t)

    for i, t in enumerate(threads):
        time.sleep(i * 0.05)   # 50 ms stagger
        t.start()

    try:
        # Wait for all threads or KeyboardInterrupt
        for t in threads:
            t.join(timeout=args.dur + 5)
    except KeyboardInterrupt:
        print('\n  [!] Interrupted — stopping all nodes…')
        stop_event.set()
        for t in threads:
            t.join(timeout=3)

    print_summary(start_time, args.nodes)


if __name__ == '__main__':
    main()