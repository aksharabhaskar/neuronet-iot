import networkx as nx
import time

# ---------------------------------------------------
# Network Graph
# ---------------------------------------------------

G = nx.Graph()

# ---------------------------------------------------
# Initial topology (Mesh)
# N1 <-> N2
# N2 <-> N3
# N1 <-> N3
# ---------------------------------------------------

DEFAULT_EDGES = [
    ("N1", "N2"),
    ("N2", "N3"),
    ("N1", "N3"),
]

for n1, n2 in DEFAULT_EDGES:
    G.add_edge(
        n1, n2,
        latency_cost=0.0,
        congestion_cost=0.0,
        energy_cost=0.0,
        trust_cost=0.0,
        weight=1.0,
    )


# ---------------------------------------------------
# Update node state
# ---------------------------------------------------

def update_node_state(node_id, latency, battery=100, congestion=False):
    if node_id not in G:
        G.add_node(node_id)

    G.nodes[node_id]["latency"]   = latency
    G.nodes[node_id]["battery"]   = battery
    G.nodes[node_id]["status"]    = "congested" if congestion else "normal"
    G.nodes[node_id]["trust"]     = 1.0
    G.nodes[node_id]["alive"]     = True
    G.nodes[node_id]["last_seen"] = time.time()

    _update_edge_weights(node_id)


# ---------------------------------------------------
# Edge weight calculation
# ---------------------------------------------------

def _update_edge_weights(node_id):
    for neighbor in G.neighbors(node_id):
        n1 = G.nodes[node_id]
        n2 = G.nodes[neighbor]

        latency_cost = (n1.get("latency", 0) + n2.get("latency", 0)) / 2

        congestion_cost = 1.0 if (
            n1.get("status") == "congested" or n2.get("status") == "congested"
        ) else 0.0

        battery_avg  = (n1.get("battery", 100) + n2.get("battery", 100)) / 2
        energy_cost  = 1 - (battery_avg / 100)

        trust_avg  = (n1.get("trust", 1.0) + n2.get("trust", 1.0)) / 2
        trust_cost = 1 - trust_avg

        weight = (
            0.4 * latency_cost
            + 0.3 * congestion_cost
            + 0.2 * energy_cost
            + 0.1 * trust_cost
        )

        G[node_id][neighbor].update({
            "latency_cost":    latency_cost,
            "congestion_cost": congestion_cost,
            "energy_cost":     energy_cost,
            "trust_cost":      trust_cost,
            "weight":          weight,
        })


# ---------------------------------------------------
# Best path (Dijkstra)
# ---------------------------------------------------

def get_best_path(source, target):
    try:
        path = nx.shortest_path(G, source=source, target=target, weight="weight")
        cost = nx.path_weight(G, path, weight="weight")
        return path, round(cost, 4)
    except Exception:
        return None, None


# ---------------------------------------------------
# Failover detection
# ---------------------------------------------------

def check_dead_nodes(timeout=10):
    now = time.time()
    for node in G.nodes:
        last_seen = G.nodes[node].get("last_seen", now)
        G.nodes[node]["alive"] = (now - last_seen) < timeout


# ---------------------------------------------------
# Access graph
# ---------------------------------------------------

def get_graph():
    return G


# ---------------------------------------------------
# Full-mesh topology for smart graph routing
# ---------------------------------------------------

def build_topology() -> nx.Graph:
    graph = nx.Graph()
    for n in ("N1", "N2", "N3", "GW", "CLOUD"):
        graph.add_node(n)
    for u, v in [
        ("N1", "N2"), ("N1", "N3"), ("N2", "N3"),
        ("N1", "GW"), ("N2", "GW"), ("N3", "GW"),
        ("GW", "CLOUD"),
    ]:
        graph.add_edge(u, v, weight=1.0)
    return graph


def update_edge_weights(graph: nx.Graph, node_states: dict) -> None:
    from edge_controller.config import ROUTING_WEIGHTS
    alpha = ROUTING_WEIGHTS["alpha"]
    beta  = ROUTING_WEIGHTS["beta"]
    gamma = ROUTING_WEIGHTS["gamma"]

    _infra = {"GW", "CLOUD"}

    def _s(n: str) -> dict:
        if n in _infra:
            return {"avg_delay": 0.0, "ml_risk": 0.0, "battery": 100.0}
        s = node_states.get(n, {})
        return {
            "avg_delay": s.get("avg_delay", 0.0),
            "ml_risk":   s.get("ml_risk",   0.0),
            "battery":   s.get("battery",   100.0),
        }

    for u, v in graph.edges():
        su, sv = _s(u), _s(v)
        weight = (
            alpha * (su["avg_delay"] + sv["avg_delay"]) / 2
            + beta  * (su["ml_risk"]   + sv["ml_risk"])   / 2
            + gamma / max(min(su["battery"], sv["battery"]), 0.01)
        )
        graph[u][v]["weight"] = weight
