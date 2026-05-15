import paho.mqtt.client as mqtt
import json

from edge_controller.monitor import process_packet
from edge_controller.config import BROKER_HOST, BROKER_PORT, MQTT_TOPIC_DATA


# ------------------------------------------------------------------
def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"[MQTT] Connected to broker at {BROKER_HOST}:{BROKER_PORT}")
        client.subscribe(MQTT_TOPIC_DATA)
        print(f"[MQTT] Subscribed to topic: {MQTT_TOPIC_DATA}")
    else:
        codes = {
            1: "incorrect protocol version",
            2: "invalid client id",
            3: "server unavailable",
            4: "bad username/password",
            5: "not authorised",
        }
        print(f"[MQTT] Connection refused — {codes.get(rc, f'rc={rc}')}")


def on_message(client, userdata, msg):
    try:
        data = json.loads(msg.payload.decode())
        node = data.get("node_id", "unknown")
        print(f"[MQTT] Message received from node: {node}")
        process_packet(data)
    except json.JSONDecodeError as e:
        print(f"[MQTT] JSON parse error: {e} | raw: {msg.payload[:120]}")
    except Exception as e:
        print(f"[MQTT] Unhandled error: {e}")


def on_disconnect(client, userdata, rc):
    if rc != 0:
        print(f"[MQTT] Unexpected disconnect (rc={rc}). Paho will auto-reconnect.")


# ------------------------------------------------------------------
_client = mqtt.Client()
_client.on_connect    = on_connect
_client.on_message    = on_message
_client.on_disconnect = on_disconnect


def start():
    """Connect to the broker and block forever processing messages."""
    print(f"[MQTT] Connecting to {BROKER_HOST}:{BROKER_PORT} ...")
    _client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
    _client.loop_forever()


def publish_command(node_id: str, payload: dict):
    """Send a JSON command to a specific node."""
    from edge_controller.config import MQTT_TOPIC_CMD
    topic = MQTT_TOPIC_CMD.format(node_id=node_id)
    _client.publish(topic, json.dumps(payload))
    print(f"[MQTT] Command sent to {node_id} on {topic}: {payload}")
