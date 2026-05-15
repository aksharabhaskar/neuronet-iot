import networkx as nx

G = nx.Graph()

def update_twin(node_id, latency):
    if node_id not in G:
        G.add_node(node_id)

    # store latency
    G.nodes[node_id]["latency"] = latency

    # classify congestion
    if latency > 0.3:
        G.nodes[node_id]["status"] = "congested"
    else:
        G.nodes[node_id]["status"] = "normal"


def get_graph():
    return G