from edge_controller.config import CONGESTION_THRESHOLD

def choose_path(avg_delay: float) -> str:
    """
    Choose routing based on measured network delay (seconds).
    Threshold is read from config so it stays in sync with congestion detection.
    """
    if avg_delay > CONGESTION_THRESHOLD:
        return "LOW-CONGESTION PATH"
    return "SHORTEST PATH"