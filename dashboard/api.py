"""
NeuroNet IoT — Flask Dashboard API
Endpoints:
  GET  /api/nodes          Latest state per node
  GET  /api/history        Last 200 rows (optional ?node=)
  GET  /api/metrics        ML model evaluation report
  GET  /api/logs           Paginated log table
  GET  /api/stats          Per-node uptime / packet-loss stats   [NEW]
  GET  /api/config         Current congestion thresholds          [NEW]
  POST /api/config         Update congestion thresholds live      [NEW]
  GET  /api/twin           Digital twin node states               [NEW]
  GET  /api/logs/export    Full CSV download                      [NEW]
"""

import json
import os
import time
from pathlib import Path

import pandas as pd
from flask import Flask, jsonify, request, Response
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ── Paths ────────────────────────────────────────────────────────────
BASE_DIR     = Path(__file__).resolve().parent.parent
LOG_FILE     = BASE_DIR / 'data' / 'logs.csv'
METRICS_FILE = BASE_DIR / 'data' / 'model_metrics.json'
CONFIG_FILE  = BASE_DIR / 'data' / 'config.json'   # persisted threshold overrides

# ── Default thresholds (mirrors config.py) ───────────────────────────
DEFAULT_CONFIG = {
    'congestion_threshold': 0.080,   # seconds
    'congestion_clear':     0.050,   # seconds
}

# In-memory config (loaded from file on startup, overridden by POST /api/config)
_runtime_config: dict = {}


def load_config() -> dict:
    global _runtime_config
    if _runtime_config:
        return _runtime_config
    if CONFIG_FILE.exists():
        try:
            _runtime_config = json.loads(CONFIG_FILE.read_text())
            return _runtime_config
        except Exception:
            pass
    _runtime_config = dict(DEFAULT_CONFIG)
    return _runtime_config


def save_config(cfg: dict) -> None:
    global _runtime_config
    _runtime_config = cfg
    try:
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(cfg, indent=2))
    except Exception:
        pass


# ── CSV helpers ──────────────────────────────────────────────────────
KNOWN_NODES = ['N1', 'N2', 'N3']

def load_df() -> pd.DataFrame:
    if not LOG_FILE.exists():
        return pd.DataFrame()
    try:
        df = pd.read_csv(LOG_FILE)
        # Normalise boolean-ish columns
        for col in ('congestion', 'detected'):
            if col in df.columns:
                df[col] = df[col].astype(str).str.lower().isin({'true', '1', 'yes'})
        return df
    except Exception:
        return pd.DataFrame()


def df_to_records(df: pd.DataFrame) -> list:
    return json.loads(df.to_json(orient='records', default_handler=str))


# ── Existing endpoints ───────────────────────────────────────────────

@app.route('/api/nodes')
def nodes():
    df = load_df()
    if df.empty:
        return jsonify([])
    latest = (
        df.sort_values('wall_time')
          .groupby('node_id', as_index=False)
          .last()
    )
    latest = latest[latest['node_id'].isin(KNOWN_NODES)]
    return jsonify(df_to_records(latest))


@app.route('/api/history')
def history():
    df = load_df()
    if df.empty:
        return jsonify([])
    node = request.args.get('node')
    if node:
        df = df[df['node_id'] == node]
    df = df.sort_values('wall_time').tail(200)
    return jsonify(df_to_records(df))


@app.route('/api/metrics')
def metrics():
    if not METRICS_FILE.exists():
        return jsonify({'error': 'metrics file not found'}), 404
    try:
        return jsonify(json.loads(METRICS_FILE.read_text()))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/logs')
def logs():
    df = load_df()
    if df.empty:
        return jsonify({'total': 0, 'page': 1, 'per_page': 50, 'data': []})

    node = request.args.get('node')
    if node:
        df = df[df['node_id'] == node]

    df = df.sort_values('wall_time', ascending=False)
    total    = len(df)
    page     = max(1, int(request.args.get('page', 1)))
    per_page = max(1, int(request.args.get('per_page', 50)))
    start    = (page - 1) * per_page
    page_df  = df.iloc[start: start + per_page]

    return jsonify({
        'total':    total,
        'page':     page,
        'per_page': per_page,
        'data':     df_to_records(page_df),
    })


# ── NEW: /api/stats ──────────────────────────────────────────────────

@app.route('/api/stats')
def stats():
    """
    Returns per-node uptime and packet-loss stats.
    Uptime is estimated by comparing total received packets to the expected
    count based on the node's observed time span and the 1 pkt/s interval.
    """
    df = load_df()
    if df.empty:
        return jsonify({'nodes': []})

    result = []
    for nid in KNOWN_NODES:
        ndf = df[df['node_id'] == nid].sort_values('wall_time')
        if ndf.empty:
            continue
        total_pkts    = len(ndf)
        first_seen    = float(ndf['wall_time'].iloc[0])
        last_seen     = float(ndf['wall_time'].iloc[-1])
        span_s        = max(last_seen - first_seen, 1.0)
        # Expected = 1 packet/second over the observed time span
        expected_pkts = max(total_pkts, int(span_s))
        loss_pct      = max(0.0, (1.0 - total_pkts / expected_pkts) * 100)
        uptime_pct    = max(0.0, min(100.0, 100.0 - loss_pct))

        result.append({
            'node_id':         nid,
            'total_packets':   total_pkts,
            'expected_packets': expected_pkts,
            'uptime_pct':      round(uptime_pct, 2),
            'packet_loss_pct': round(loss_pct, 2),
            'first_seen':      first_seen,
            'last_seen':       last_seen,
        })

    return jsonify({'nodes': result})


# ── NEW: /api/config ─────────────────────────────────────────────────

@app.route('/api/config', methods=['GET', 'POST'])
def config():
    if request.method == 'GET':
        return jsonify(load_config())

    data = request.get_json(silent=True) or {}
    cfg  = load_config()

    if 'congestion_threshold' in data:
        val = float(data['congestion_threshold'])
        if 0.005 <= val <= 10.0:
            cfg['congestion_threshold'] = val

    if 'congestion_clear' in data:
        val = float(data['congestion_clear'])
        if 0.005 <= val <= 10.0:
            cfg['congestion_clear'] = val

    # Enforce hysteresis
    if cfg['congestion_clear'] >= cfg['congestion_threshold']:
        cfg['congestion_clear'] = cfg['congestion_threshold'] * 0.6

    save_config(cfg)

    # Attempt to update the live edge controller config module
    try:
        import sys
        if 'edge_controller.config' in sys.modules:
            ec_cfg = sys.modules['edge_controller.config']
            ec_cfg.CONGESTION_THRESHOLD = cfg['congestion_threshold']
            ec_cfg.CONGESTION_CLEAR     = cfg['congestion_clear']
    except Exception:
        pass

    return jsonify(cfg)


# ── NEW: /api/twin ───────────────────────────────────────────────────

@app.route('/api/twin')
def twin():
    """
    Returns the digital twin node states by reading the latest log entry
    per node (proxy for the in-memory NetworkX graph which isn't exposed
    directly; replace with actual twin module when desired).
    """
    df = load_df()
    if df.empty:
        return jsonify([])

    latest = (
        df.sort_values('wall_time')
          .groupby('node_id', as_index=False)
          .last()
    )
    latest = latest[latest['node_id'].isin(KNOWN_NODES)]

    result = []
    for _, row in latest.iterrows():
        result.append({
            'id':      row['node_id'],
            'latency': float(row.get('avg_delay_s', 0) or 0) * 1000,  # ms
            'state':   'congested' if row.get('congestion') else 'normal',
        })

    # Try to pull live state from the actual digital twin if it's in-process
    try:
        from digital_twin.twin import NetworkTwin
        twin_obj = NetworkTwin.instance()   # assumes singleton pattern
        result = [
            {
                'id':      nid,
                'latency': twin_obj.graph.nodes[nid].get('latency', 0) * 1000,
                'state':   twin_obj.graph.nodes[nid].get('state', 'normal'),
            }
            for nid in twin_obj.graph.nodes
            if nid in KNOWN_NODES
        ]
    except Exception:
        pass   # fall back to CSV-derived result

    return jsonify(result)


# ── NEW: /api/logs/export ────────────────────────────────────────────

@app.route('/api/logs/export')
def logs_export():
    """Stream the entire logs.csv as a file download."""
    if not LOG_FILE.exists():
        return jsonify({'error': 'log file not found'}), 404

    def generate():
        with open(LOG_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                yield line

    filename = f"neuronet-logs-{time.strftime('%Y-%m-%d')}.csv"
    return Response(
        generate(),
        mimetype='text/csv',
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Cache-Control': 'no-cache',
        },
    )


# ── Run ──────────────────────────────────────────────────────────────
if __name__ == '__main__':
    port = int(os.getenv('FLASK_PORT', '5000'))
    app.run(host='0.0.0.0', port=port, debug=False)