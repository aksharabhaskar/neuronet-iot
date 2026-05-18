import matplotlib.pyplot as plt
import networkx as nx
from digital_twin.twin import get_graph


def draw_graph():
    G = get_graph()

    plt.clf()

    if len(G.nodes) == 0:
        return

    pos    = nx.spring_layout(G)
    colors = []
    labels = {}

    for node in G.nodes:
        status  = G.nodes[node].get("status",  "normal")
        latency = G.nodes[node].get("latency", 0)
        battery = G.nodes[node].get("battery", 100)

        colors.append("red" if status == "congested" else "green")
        labels[node] = f"{node}\n{latency:.2f}s\n{battery:.0f}%"

    nx.draw(G, pos, node_color=colors, with_labels=True, labels=labels)

    plt.pause(0.5)
