#!/usr/bin/env python3
import sys
import time
import json
import paho.mqtt.client as mqtt

import os

MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USER = os.getenv("MQTT_USER", "sandisolar_inv")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "sandisolar_pass")

TOPIC_SENSOR = "antigravity/sensor/prm_switch"
TOPIC_TELEMETRY = "antigravity/inverter/telemetry"

import paho.mqtt.publish as publish

def publish_message(topic, payload):
    auth = {'username': MQTT_USER, 'password': MQTT_PASSWORD}
    publish.single(
        topic,
        payload=payload,
        hostname=MQTT_BROKER,
        port=MQTT_PORT,
        auth=auth,
        qos=1
    )
    print(f"Published to {topic}: {payload}")

def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python simulate_grid.py outage     - Simulates no grid power (2x 'true')")
        print("  python simulate_grid.py restored   - Simulates grid power restored (2x 'false')")
        print("  python simulate_grid.py soc <val>  - Simulates a battery charge level (e.g. 70 or 90)")
        sys.exit(1)

    command = sys.argv[1].lower()

    if command == "outage":
        print("Simulating grid outage (sending 2x 'true' to trigger inverter ON)...")
        # Send twice because the daemon requires 2 consecutive matching statuses to trigger
        publish_message(TOPIC_SENSOR, "true")
        time.sleep(1)
        publish_message(TOPIC_SENSOR, "true")

    elif command == "restored":
        print("Simulating grid restoration (sending 2x 'false' to trigger inverter OFF)...")
        # Send twice because the daemon requires 2 consecutive matching statuses to trigger
        publish_message(TOPIC_SENSOR, "false")
        time.sleep(1)
        publish_message(TOPIC_SENSOR, "false")

    elif command == "soc":
        if len(sys.argv) < 3:
            print("Please specify a SOC percentage value (e.g. 75)")
            sys.exit(1)
        soc_val = int(sys.argv[2])
        print(f"Simulating inverter telemetry with Battery SOC = {soc_val}%...")
        
        # Publish mock telemetry containing register 0 (running) and 128 (SOC)
        telemetry_payload = json.dumps({
            "0": 1,        # Inverter status = 1 (Running)
            "128": soc_val # Battery SOC
        })
        publish_message(TOPIC_TELEMETRY, telemetry_payload)
        
    else:
        print(f"Unknown command: {command}")

if __name__ == "__main__":
    main()
