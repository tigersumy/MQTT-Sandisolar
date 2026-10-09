#!/usr/bin/env python3
"""
MQTT Power Monitor Daemon for Sandisolar Inverter Control.
Monitors Grid Voltage and Battery SOC via local MQTT, handles debounce, 
and triggers Inverter ON/OFF over local MQTT commands.
"""

import os
import sys
import json
import time
import logging
import threading
from datetime import datetime
from logging.handlers import RotatingFileHandler
import urllib.request

# --- Configuration & Constants ---
MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USER = os.getenv("MQTT_USER", "sandisolar_inv")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "sandisolar_pass")

# MQTT Topics (ESPHome standard format)
TOPIC_GRID_VOLTAGE = os.getenv("TOPIC_GRID_VOLTAGE", "sandisolar-controller/sensor/grid_voltage/state")
TOPIC_BATTERY_SOC = os.getenv("TOPIC_BATTERY_SOC", "sandisolar-controller/sensor/battery_soc/state")
TOPIC_SWITCH_STATE = os.getenv("TOPIC_SWITCH_STATE", "sandisolar-controller/switch/power_switch/state")
TOPIC_SWITCH_CMD = os.getenv("TOPIC_SWITCH_CMD", "sandisolar-controller/switch/power_switch/command")

# Control Thresholds
GRID_VOLTAGE_THRESHOLD = float(os.getenv("GRID_VOLTAGE_THRESHOLD", "100.0"))  # Volts. >= 100 is GRID ON (СВІТЛО Є), < 100 is GRID OFF (СВІТЛА НЕМАЄ)
BATTERY_SOC_THRESHOLD = int(os.getenv("BATTERY_SOC_THRESHOLD", "95"))         # Turn OFF target SOC (if < 95, keep ON to charge from grid)
GRID_CHARGE_SOC_THRESHOLD = int(os.getenv("GRID_CHARGE_SOC_THRESHOLD", "75")) # Start grid charging if inverter is OFF and SOC falls below this

# Path Setup
LOG_DIR = os.getenv("LOG_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs"))
LOG_FILE = os.path.join(LOG_DIR, "tuya_power_log.json")

# Telegram Configuration (Loaded from environment variables)
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

import paho.mqtt.client as mqtt

# --- Global State ---
state_lock = threading.Lock()
latest_data = {
    "grid_voltage": None,
    "grid_voltage_ts": 0,
    "battery_soc": None,
    "battery_soc_ts": 0,
    "inverter_running": None,  # True/False (ON/OFF), mapped from power_switch
    "inverter_running_ts": 0,
}

# Debounce states
debounce = {
    "last_sample": None,       # "open" (OFF) or "closed" (ON)
    "consecutive_count": 0,
    "stable_status": "unknown"  # "СВІТЛО Є" or "СВІТЛА НЕМАЄ"
}

# Logger Configuration
os.makedirs(LOG_DIR, exist_ok=True)
logger = logging.getLogger("mqtt_power_monitor")
logger.setLevel(logging.INFO)
logger.propagate = False
logger.handlers.clear()

# File handler for JSON events
file_handler = RotatingFileHandler(LOG_FILE, maxBytes=2*1024*1024, backupCount=3, encoding="utf-8")
file_handler.setFormatter(logging.Formatter("%(message)s"))
logger.addHandler(file_handler)

# Console handler for readable logs
console_handler = logging.StreamHandler(sys.stdout)
console_formatter = logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
console_handler.setFormatter(console_formatter)
logger.addHandler(console_handler)

def send_telegram(text):
    """Send an HTML-formatted message to Telegram."""
    if not TELEGRAM_BOT_TOKEN:
        logger.warning("Telegram Bot Token not configured. Notification skipped.")
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = json.dumps({
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "HTML"
    }).encode("utf-8")
    
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            response.read()
    except Exception as e:
        logger.error(f"Failed to send Telegram notification: {e}")

def log_event(event_type, raw_val, status_text, action_taken=None, error_msg=None):
    """Write standard JSON event to the log file."""
    event = {
        "timestamp": datetime.now().isoformat(),
        "event_type": event_type,
        "grid_voltage": raw_val,
        "status_text": status_text,
        "inverter_status": "running" if latest_data["inverter_running"] else "off",
        "battery_soc": latest_data["battery_soc"],
        "action_taken": action_taken
    }
    if error_msg:
        event["error_msg"] = error_msg
    logger.info(json.dumps(event, ensure_ascii=False))

def wait_for_state_change(client, expected_running, timeout=10):
    """Wait for inverter state to transition to expected boolean running state."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        with state_lock:
            if latest_data["inverter_running"] == expected_running:
                return True
        time.sleep(0.5)
    return False

def control_inverter(client, turn_on):
    """Publish command and verify transition. Returns True if successful, raises exception on timeout."""
    cmd = "ON" if turn_on else "OFF"
    client.publish(TOPIC_SWITCH_CMD, cmd, qos=1, retain=True)
    if not wait_for_state_change(client, turn_on, timeout=10):
        raise TimeoutError("Inverter state did not transition within 10 seconds")

def evaluate_rules(client):
    """Runs inside the 60-second polling loop to evaluate rules."""
    current_time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    with state_lock:
        v_val = latest_data["grid_voltage"]
        v_ts = latest_data["grid_voltage_ts"]
        soc_val = latest_data["battery_soc"]
        soc_ts = latest_data["battery_soc_ts"]
        running_val = latest_data["inverter_running"]
        running_ts = latest_data["inverter_running_ts"]
        
    now = time.time()
    
    # 1. Freeze State check (If MQTT reports are missing / stale)
    if (v_val is None or (now - v_ts > 180) or 
        soc_val is None or (now - soc_ts > 180) or 
        running_val is None):
        
        logger.warning(f"⚠️ Freeze State Active: MQTT telemetry is stale or missing! (Grid: {v_val}V, SOC: {soc_val}%, Switch: {running_val})")
        return

    # Determine current sample state
    is_grid_on = v_val >= GRID_VOLTAGE_THRESHOLD
    current_sample = "closed" if is_grid_on else "open"
    sample_text = "СВІТЛО Є" if is_grid_on else "СВІТЛА НЕМАЄ"
    
    # 2. Debounce Counter
    if current_sample == debounce["last_sample"]:
        debounce["consecutive_count"] += 1
    else:
        debounce["consecutive_count"] = 1
        debounce["last_sample"] = current_sample
        
    # Lock stable status on 2 consecutive samples
    if debounce["consecutive_count"] >= 2:
        debounce["stable_status"] = sample_text
        
    logger.info(f"Grid Status: {sample_text} ({v_val:.1f}V) | Stable: {debounce['stable_status']} (count={debounce['consecutive_count']}) | Inverter: {'ON' if running_val else 'OFF'} | Battery: {soc_val}%")
    
    # Process actions based on the 2x consecutive stable status
    if debounce["stable_status"] == "СВІТЛА НЕМАЄ" and debounce["consecutive_count"] >= 2:
        # OUTAGE LOGIC
        if running_val:
            # Already ON -> SKIP
            logger.info("ℹ️ Outage detected, but inverter is already running. Skip.")
            log_event("trigger_inverter_on_skipped", v_val, "СВІТЛА НЕМАЄ", "skip_already_running")
            # We don't send Telegram here to avoid spamming
        else:
            # Try to turn ON
            logger.warning("⚡ Outage detected (2x consecutive СВІТЛА НЕМАЄ). Sending ON command.")
            try:
                control_inverter(client, turn_on=True)
                log_event("trigger_inverter_on", v_val, "СВІТЛА НЕМАЄ", "inverter_on")
                
                msg = (
                    f"⚡ <b>ІНВЕРТОР УВІМКНЕНО</b>\n\n"
                    f"Причина: 2× «СВІТЛА НЕМАЄ» (зникнення живлення)\n"
                    f"Датчик: Power\n"
                    f"Статус: СВІТЛА НЕМАЄ\n"
                    f"Інвертор був: off\n"
                    f"Батарея: {soc_val}%\n"
                    f"Час: {current_time_str}"
                )
                send_telegram(msg)
            except Exception as e:
                err_msg = str(e)
                logger.error(f"❌ Failed to turn ON inverter during outage: {err_msg}")
                log_event("trigger_inverter_on_failed", v_val, "СВІТЛА НЕМАЄ", "inverter_on", error_msg=err_msg)
                
                msg = (
                    f"❌ <b>ПОМИЛКА УВІМКНЕННЯ ІНВЕРТОРА</b>\n\n"
                    f"Причина: 2× «СВІТЛА НЕМАЄ» (зникнення живлення)\n"
                    f"Помилка: {err_msg}\n"
                    f"Час: {current_time_str}"
                )
                send_telegram(msg)

    elif debounce["stable_status"] == "СВІТЛО Є" and debounce["consecutive_count"] >= 2:
        # POWER RESTORED LOGIC
        if not running_val:
            # Already OFF -> check if we need to turn ON for Grid Charging
            if soc_val < GRID_CHARGE_SOC_THRESHOLD:
                logger.warning(f"🔋 Power is available but Battery SOC ({soc_val}%) < {GRID_CHARGE_SOC_THRESHOLD}% -> Sending ON command for Grid Charge.")
                try:
                    control_inverter(client, turn_on=True)
                    log_event("trigger_inverter_on_grid_charge", v_val, "СВІТЛО Є", "inverter_on_grid_charge")
                    
                    msg = (
                        f"🔋 <b>ІНВЕРТОР УВІМКНЕНО (ЗАРЯДКА ВІД МЕРЕЖІ)</b>\n\n"
                        f"Причина: Інвертор ВИМКНЕНИЙ + «СВІТЛО Є» + Батарея {soc_val}% &lt; {GRID_CHARGE_SOC_THRESHOLD}%\n"
                        f"Датчик: Power\n"
                        f"Статус: СВІТЛО Є\n"
                        f"Інвертор був: off\n"
                        f"Батарея: {soc_val}%\n"
                        f"Час: {current_time_str}"
                    )
                    send_telegram(msg)
                except Exception as e:
                    err_msg = str(e)
                    logger.error(f"❌ Failed to turn ON inverter for grid charging: {err_msg}")
                    log_event("trigger_inverter_on_grid_charge_failed", v_val, "СВІТЛО Є", "inverter_on_grid_charge", error_msg=err_msg)
                    
                    msg = (
                        f"❌ <b>ПОМИЛКА УВІМКНЕННЯ ІНВЕРТОРА (ЗАРЯДКА)</b>\n\n"
                        f"Причина: Інвертор OFF + «СВІТЛО Є» + Батарея {soc_val}% &lt; {GRID_CHARGE_SOC_THRESHOLD}%\n"
                        f"Помилка: {err_msg}\n"
                        f"Час: {current_time_str}"
                    )
                    send_telegram(msg)
            else:
                logger.info("ℹ️ Power is available, inverter is off, and battery is charged. Skip.")
                log_event("trigger_inverter_off_skipped", v_val, "СВІТЛО Є", "skip_already_off")
        else:
            # Inverter is running (ON) -> check if we can turn it OFF (battery threshold check)
            if soc_val >= BATTERY_SOC_THRESHOLD:
                logger.warning(f"🔌 Power is restored & Battery SOC ({soc_val}%) >= {BATTERY_SOC_THRESHOLD}% -> Sending OFF command.")
                try:
                    control_inverter(client, turn_on=False)
                    log_event("trigger_inverter_off", v_val, "СВІТЛО Є", "inverter_off")
                    
                    msg = (
                        f"🔌 <b>ІНВЕРТОР ВИМКНЕНО</b>\n\n"
                        f"Причина: 2× «СВІТЛО Є» + Running + SOC≥{BATTERY_SOC_THRESHOLD}%\n"
                        f"Датчик: Power\n"
                        f"Статус: СВІТЛО Є\n"
                        f"Інвертор був: running\n"
                        f"Батарея: {soc_val}%\n"
                        f"Час: {current_time_str}"
                    )
                    send_telegram(msg)
                except Exception as e:
                    err_msg = str(e)
                    logger.error(f"❌ Failed to turn OFF inverter: {err_msg}")
                    log_event("trigger_inverter_off_failed", v_val, "СВІТЛО Є", "inverter_off", error_msg=err_msg)
                    
                    msg = (
                        f"❌ <b>ПОМИЛКА ВИМКНЕННЯ ІНВЕРТОРА</b>\n\n"
                        f"Причина: 2× «СВІТЛО Є» + Running\n"
                        f"Помилка: {err_msg}\n"
                        f"Час: {current_time_str}"
                    )
                    send_telegram(msg)
            else:
                # Blocked from turning off
                                logger.info(f"🛑 Inverter OFF blocked: Battery SOC ({soc_val}%) < {BATTERY_SOC_THRESHOLD}%")
                
                                # Check if we should log/alert block event
                                log_event("trigger_inverter_off_blocked", v_val, "СВІТЛО Є", "block_off_low_soc")
                                # NO TELEGRAM for blocked - not a state change, just a status
    else:
        # Regular polling update log
        log_event("status_update", v_val, sample_text)

# --- MQTT Handlers ---
def on_connect(client, userdata, flags, rc, *args, **kwargs):
    if rc == 0:
        logger.info("Connected to local MQTT broker successfully!")
        client.subscribe([
            (TOPIC_GRID_VOLTAGE, 1),
            (TOPIC_BATTERY_SOC, 1),
            (TOPIC_SWITCH_STATE, 1)
        ])
    else:
        logger.error(f"Failed to connect to broker, return code: {rc}")

def on_message(client, userdata, msg):
    topic = msg.topic
    try:
        payload = msg.payload.decode("utf-8")
        now = time.time()
        
        with state_lock:
            if topic == TOPIC_GRID_VOLTAGE:
                latest_data["grid_voltage"] = float(payload)
                latest_data["grid_voltage_ts"] = now
            elif topic == TOPIC_BATTERY_SOC:
                latest_data["battery_soc"] = int(float(payload))
                latest_data["battery_soc_ts"] = now
            elif topic == TOPIC_SWITCH_STATE:
                latest_data["inverter_running"] = (payload.upper() == "ON")
                latest_data["inverter_running_ts"] = now
    except Exception as e:
        logger.error(f"Error processing MQTT message on {topic}: {e}")

# --- Polling Thread ---
def polling_loop(client):
    logger.info("Starting background evaluation loop (1-minute intervals)...")
    while True:
        try:
            evaluate_rules(client)
        except Exception as e:
            logger.error(f"Error in evaluation loop: {e}")
        time.sleep(60)

def main():
    logger.info("Starting MQTT Power Monitor service daemon...")
    # Use paho-mqtt v1.6.1 API (no CallbackAPIVersion)
    import random
    client_id = f"mqtt_power_monitor_local_{random.randint(1000, 9999)}"
    client = mqtt.Client(client_id=client_id, protocol=mqtt.MQTTv311)
    client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
    client.on_connect = on_connect
    client.on_message = on_message
    client.on_disconnect = on_disconnect
    # Enable automatic reconnection
    client.reconnect_delay_set(min_delay=1, max_delay=60)
    
    # Start polling thread
    t = threading.Thread(target=polling_loop, args=(client,))
    t.daemon = True
    t.start()
    
    # Main MQTT loop with automatic reconnection
    client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
    client.loop_forever()

def on_disconnect(client, userdata, rc, *args, **kwargs):
    logger.warning(f"MQTT disconnected: reason_code={rc}")

if __name__ == "__main__":
    main()
