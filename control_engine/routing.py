import networkx as nx


def compute_route(source: str, graph: nx.Graph) -> list[str]:
    try:
        return nx.shortest_path(graph, source, "CLOUD", weight="weight")
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return ["UNREACHABLE"]
