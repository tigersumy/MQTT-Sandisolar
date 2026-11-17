#!/usr/bin/env python3
"""
SandiSolar Interactive Telegram Bot (Monitoring & Telemetry)
Provides interactive real-time telemetry queries and status cards for SandiSolar Inverters.
Communicates locally over MQTT with ESPHome and the SandiSolar controller.
"""

import os
import sys
import json
import time
import logging
import threading
import urllib.request
import urllib.parse
from datetime import datetime
from logging.handlers import RotatingFileHandler

# --- Load .env configuration ---
def _load_env():
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.isfile(env_file):
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k and k not in os.environ:
                        os.environ[k] = v

_load_env()

# --- Configuration & Constants ---
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
ALLOWED_CHAT_IDS = [cid.strip() for cid in os.getenv("TELEGRAM_CHAT_ID", "").split(",") if cid.strip()]

MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USER = os.getenv("MQTT_USER", "sandisolar_inv")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "sandisolar_pass")

LOG_DIR = os.getenv("LOG_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs"))
LOG_FILE = os.path.join(LOG_DIR, "telegram_bot.log")
EVENT_LOG_FILE = os.path.join(LOG_DIR, "tuya_power_log.json")

BATTERY_SOC_THRESHOLD = int(os.getenv("BATTERY_SOC_THRESHOLD", "95"))
GRID_CHARGE_SOC_THRESHOLD = int(os.getenv("GRID_CHARGE_SOC_THRESHOLD", "75"))

# Logger Setup
os.makedirs(LOG_DIR, exist_ok=True)
logger = logging.getLogger("sandisolar_tg_bot")
logger.setLevel(logging.INFO)
logger.propagate = False
logger.handlers.clear()

file_handler = RotatingFileHandler(LOG_FILE, maxBytes=3*1024*1024, backupCount=3, encoding="utf-8")
file_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
logger.addHandler(file_handler)

console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
logger.addHandler(console_handler)

# --- Thread-safe Telemetry Store ---
telemetry_lock = threading.Lock()
telemetry_data = {}

def update_telemetry(key, value):
    with telemetry_lock:
        telemetry_data[key] = {
            "value": value,
            "ts": time.time()
        }

def get_telemetry(key, default=None):
    with telemetry_lock:
        item = telemetry_data.get(key)
        if item is not None:
            return item["value"]
    return default

def get_float(key, default=0.0):
    val = get_telemetry(key)
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default

def get_int(key, default=0):
    val = get_telemetry(key)
    if val is None:
        return default
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return default

def get_str(key, default="-"):
    val = get_telemetry(key)
    return str(val) if val is not None else default

# --- Import Paho MQTT ---
try:
    import paho.mqtt.client as mqtt
except ImportError:
    logger.error("paho-mqtt is not installed! Please run: pip install paho-mqtt")
    mqtt = None

# --- Persistent Reply Keyboard Menu ---
MAIN_KEYBOARD = {
    "keyboard": [
        [{"text": "📊 Загальний статус"}],
        [{"text": "🔋 Батарея"}, {"text": "⚡ Мережа"}],
        [{"text": "☀️ Сонце"}, {"text": "🏠 Споживання"}],
        [{"text": "🌡 Температури"}, {"text": "⚙️ Автоматика"}]
    ],
    "resize_keyboard": True,
    "is_persistent": True
}

# --- Telegram API Methods ---
def send_telegram_message(chat_id, text, reply_markup=None):
    if not TELEGRAM_BOT_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN is empty! Cannot send message.")
        return False
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            return response.status == 200
    except Exception as e:
        logger.error(f"Failed to send Telegram message to chat {chat_id}: {e}")
        return False

# --- Telegram Response Builders ---
def build_status_card():
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    grid_v = get_float("sensor/grid_voltage", 0.0)
    grid_hz = get_float("sensor/grid_frequency", 0.0)
    grid_w = get_float("sensor/grid_power", 0.0)
    has_grid = grid_v >= 100.0

    soc = get_int("sensor/battery_soc", 0)
    batt_v = get_float("sensor/battery_voltage", 0.0)
    batt_a = get_float("sensor/battery_current", 0.0)
    batt_w = batt_v * batt_a

    pv_w = get_float("sensor/pv1_power", 0.0)
    pv_today = get_float("sensor/solar_generation_today", 0.0)
    load_w = get_float("sensor/power_out_load", 0.0)

    t1 = get_float("sensor/inverter_temp", 0.0)
    t2 = get_float("sensor/boost_temp", 0.0)
    t3 = get_float("sensor/llc_temp", 0.0)
    t4 = get_float("sensor/bms_battery_temperature", 0.0)

    inv_switch = get_str("switch/power_switch", "UNKNOWN").upper()
    inv_running = (inv_switch == "ON")
    mode_raw = get_str("sensor/inverter_mode_sensor", get_str("sensor/inverter_status", "Auto"))

    # Battery emoji & direction
    if batt_a > 1.0:
        batt_dir = f"⏳ Заряджання (+{batt_a:.1f} А)"
    elif batt_a < -1.0:
        batt_dir = f"⚡ Розряджання ({batt_a:.1f} А)"
    else:
        batt_dir = "⏸ Очікування (0.0 А)"

    batt_icon = "🔋" if soc >= 30 else "🪫"
    grid_icon = "🟢 СВІТЛО Є" if has_grid else "🔴 СВІТЛА НЕМАЄ"

    msg = (
        f"📊 <b>Загальний статус SandiSolar</b>\n"
        f"🕒 <i>{now_str}</i>\n\n"
        f"⚡ <b>Мережа:</b> {grid_icon} ({grid_v:.1f} В, {grid_hz:.2f} Гц)\n"
        f"🔌 <b>Інвертор:</b> {'Увімкнено (генерація)' if inv_running else 'Вимкнено (байпас/очікування)'} [<i>{mode_raw}</i>]\n"
        f"{batt_icon} <b>АКБ:</b> <b>{soc}%</b> ({batt_v:.1f} В, {batt_dir})\n"
        f"🏠 <b>Споживання будинку:</b> {load_w:.0f} Вт\n"
        f"☀️ <b>Сонячні панелі:</b> {pv_w:.0f} Вт (сьогодні: {pv_today:.2f} кВт·год)\n"
        f"🌡 <b>Температури:</b> T1: {t1:.1f}° | T2: {t2:.1f}° | T3: {t3:.1f}° | T4: {t4:.1f}°C"
    )
    return msg

def build_battery_card():
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    soc = get_int("sensor/battery_soc", 0)
    batt_v = get_float("sensor/battery_voltage", 0.0)
    batt_a = get_float("sensor/battery_current", 0.0)
    batt_w = batt_v * batt_a
    soh = get_int("sensor/battery_soh", 100)
    t4 = get_float("sensor/bms_battery_temperature", 0.0)
    max_charge = get_float("sensor/bms_max_allowed_charge_current", 0.0)
    max_discharge = get_float("sensor/bms_max_allowed_discharge_current", 0.0)
    bms_a = get_float("sensor/bms_battery_current", batt_a)

    if batt_a > 1.0:
        dir_text = f"🟢 Заряджання (+{batt_a:.1f} А / +{abs(batt_w):.0f} Вт)"
    elif batt_a < -1.0:
        dir_text = f"🔴 Розряджання ({batt_a:.1f} А / -{abs(batt_w):.0f} Вт)"
    else:
        dir_text = "⚪ Очікування (буферний режим)"

    batt_icon = "🔋" if soc >= 30 else "🪫"

    msg = (
        f"{batt_icon} <b>Стан акумулятора (BMS FelicityESS)</b>\n"
        f"🕒 <i>{now_str}</i>\n\n"
        f"📊 <b>Заряд (SOC):</b> <b>{soc}%</b>\n"
        f"⚡ <b>Напруга:</b> {batt_v:.2f} В\n"
        f"🔄 <b>Режим струму:</b> {dir_text}\n"
        f"🔋 <b>BMS Струм:</b> {bms_a:.2f} А\n"
        f"🩺 <b>Стан здоров'я (SOH):</b> {soh}%\n"
        f"🌡 <b>Температура АКБ (T4 BMS):</b> {t4:.1f} °C\n\n"
        f"🛡 <b>Дозволені ліміти BMS:</b>\n"
        f"  • Макс. заряд: {max_charge:.1f} А\n"
        f"  • Макс. розряд: {max_discharge:.1f} А"
    )
    return msg

def build_grid_card():
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    grid_v = get_float("sensor/grid_voltage", 0.0)
    grid_a = get_float("sensor/grid_current", 0.0)
    grid_hz = get_float("sensor/grid_frequency", 0.0)
    grid_w = get_float("sensor/grid_power", grid_v * grid_a)
    has_grid = grid_v >= 100.0

    status_badge = "🟢 СВІТЛО Є (Мережа підключена)" if has_grid else "🔴 СВІТЛА НЕМАЄ (Аварія / Відключення)"

    msg = (
        f"⚡ <b>Параметри міської електромережі</b>\n"
        f"🕒 <i>{now_str}</i>\n\n"
        f"💡 <b>Статус:</b> <b>{status_badge}</b>\n"
        f"🔌 <b>Напруга:</b> {grid_v:.1f} В\n"
        f"📈 <b>Вхідний струм:</b> {grid_a:.2f} А\n"
        f"⚡ <b>Потужність на вході:</b> {grid_w:.0f} Вт\n"
        f"〰️ <b>Частота мережі:</b> {grid_hz:.2f} Гц"
    )
    return msg

def build_solar_card():
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    pv_v = get_float("sensor/pv1_voltage", 0.0)
    pv_a = get_float("sensor/pv1_current", 0.0)
    pv_w = get_float("sensor/pv1_power", pv_v * pv_a)
    pv_today = get_float("sensor/solar_generation_today", 0.0)
    pv_total = get_float("sensor/solar_generation_total", 0.0)

    icon = "☀️" if pv_w > 50 else "🌙"

    msg = (
        f"{icon} <b>Сонячна генерація (PV1 Стринг)</b>\n"
        f"🕒 <i>{now_str}</i>\n\n"
        f"⚡ <b>Поточна потужність:</b> <b>{pv_w:.0f} Вт</b>\n"
        f"🔌 <b>Напруга стринга:</b> {pv_v:.1f} В\n"
        f"📈 <b>Струм стринга:</b> {pv_a:.2f} А\n"
        f"📅 <b>Генерація за сьогодні:</b> {pv_today:.2f} кВт·год\n"
        f"🌐 <b>Загальна генерація:</b> {pv_total:.1f} кВт·год"
    )
    return msg

def build_load_card():
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    load_w = get_float("sensor/power_out_load", 0.0)
    load_va = get_float("sensor/power_total_apparent_all", 0.0)
    load_var = get_float("sensor/power_total_reactive_all", 0.0)
    pf = get_float("sensor/power_factor", 1.0)
    grid_v = get_float("sensor/grid_voltage", 0.0)
    inv_switch = get_str("switch/power_switch", "OFF").upper()

    source = "Міська мережа (Байпас)" if grid_v >= 100.0 else "Акумулятор (Інверторна генерація 220В)"

    msg = (
        f"🏠 <b>Навантаження та споживання будинку</b>\n"
        f"🕒 <i>{now_str}</i>\n\n"
        f"⚡ <b>Активна потужність:</b> <b>{load_w:.0f} Вт</b>\n"
        f"🔌 <b>Повна потужність:</b> {load_va:.0f} ВА\n"
        f"〰️ <b>Реактивна потужність:</b> {load_var:.0f} ВАр\n"
        f"📐 <b>Коефіцієнт потужності (cos φ):</b> {pf:.2f}\n"
        f"🔋 <b>Джерело живлення:</b> {source}\n"
        f"🕹 <b>Стан вимикача:</b> {inv_switch}"
    )
    return msg

def build_temps_card():
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    t1 = get_float("sensor/inverter_temp", 0.0)
    t2 = get_float("sensor/boost_temp", 0.0)
    t3 = get_float("sensor/llc_temp", 0.0)
    t4 = get_float("sensor/bms_battery_temperature", 0.0)

    def temp_badge(val):
        if val <= 0.1:
            return "⚪"
        if val < 55.0:
            return "🟢"
        if val < 70.0:
            return "🟡"
        return "🔴"

    msg = (
        f"🌡 <b>Температурна діагностика системи (T1–T4)</b>\n"
        f"🕒 <i>{now_str}</i>\n\n"
        f"{temp_badge(t1)} <b>T1 — Радіатор інвертора:</b> {t1:.1f} °C\n"
        f"{temp_badge(t2)} <b>T2 — Boost / IPM (DC-DC / IGBT):</b> {t2:.1f} °C\n"
        f"{temp_badge(t3)} <b>T3 — LLC силовий трансформатор:</b> {t3:.1f} °C\n"
        f"{temp_badge(t4)} <b>T4 — Акумулятор (BMS сенсор):</b> {t4:.1f} °C\n\n"
        f"ℹ️ <i>Нормальний робочий діапазон: до 60–65 °C. Захист від перегріву спрацьовує при >85 °C.</i>"
    )
    return msg

def build_auto_card():
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    grid_v = get_float("sensor/grid_voltage", 0.0)
    soc = get_int("sensor/battery_soc", 0)
    has_grid = grid_v >= 100.0

    # Read latest event from log file if present
    last_event_text = "Немає записів"
    if os.path.isfile(EVENT_LOG_FILE):
        try:
            with open(EVENT_LOG_FILE, "r", encoding="utf-8") as f:
                lines = [l.strip() for l in f if l.strip()]
                if lines:
                    last_obj = json.loads(lines[-1])
                    ev_type = last_obj.get("event_type", "update")
                    st = last_obj.get("status_text", "-")
                    ts = last_obj.get("timestamp", "")[:19].replace("T", " ")
                    act = last_obj.get("action_taken", "-")
                    last_event_text = f"{ts} | {ev_type} ({st})"
        except Exception:
            pass

    msg = (
        f"⚙️ <b>Параметри та статус автоматики захисту</b>\n"
        f"🕒 <i>{now_str}</i>\n\n"
        f"🤖 <b>Демон моніторингу:</b> Активний (mqtt_power_monitor)\n"
        f"⚡ <b>Мережевий статус:</b> {'СВІТЛО Є' if has_grid else 'СВІТЛА НЕМАЄ'} ({grid_v:.1f} В)\n"
        f"🔋 <b>Поточний заряд АКБ:</b> {soc}%\n\n"
        f"📋 <b>Встановлені пороги:</b>\n"
        f"  • Вимкнення інвертора при поверненні світла: <b>SOC ≥ {BATTERY_SOC_THRESHOLD}%</b>\n"
        f"  • Примусовий заряд при наявності світла: <b>SOC &lt; {GRID_CHARGE_SOC_THRESHOLD}%</b>\n"
        f"  • Поріг розпізнавання аварії мережі: <b>&lt; 100.0 В</b> (2 цикли дебаунсу)\n\n"
        f"📝 <b>Остання зафіксована подія:</b>\n<code>{last_event_text}</code>"
    )
    return msg

def build_help_card():
    return (
        f"👋 <b>SandiSolar Interactive BOT</b>\n\n"
        f"Я підключений до вашого інвертора Sandisolar Aohai та забезпечую миттєвий моніторинг енергосистеми.\n\n"
        f"<b>Доступні команди та розділи:</b>\n"
        f"• <b>/status</b> — Загальний зріз (мережа, АКБ, інвертор, навантаження, сонце)\n"
        f"• <b>/battery</b> — Детальна телеметрія акумулятора та BMS\n"
        f"• <b>/grid</b> — Параметри міської мережі (напруга, частота, потужність)\n"
        f"• <b>/solar</b> — Поточна потужність та генерація сонячних панелей\n"
        f"• <b>/load</b> — Споживання будинку та навантаження\n"
        f"• <b>/temps</b> — Температурна карта компонентів (T1–T4)\n"
        f"• <b>/auto</b> — Стан та пороги автоматичних правил\n"
        f"• <b>/menu</b> — Показати головні кнопки меню\n\n"
        f"💡 <i>Ви також можете користуватися зручною клавіатурою з кнопками внизу!</i>"
    )

# --- Command Dispatcher ---
def handle_incoming_message(chat_id, user_name, text):
    text_clean = text.strip()
    cmd = text_clean.lower()

    logger.info(f"Command received from {user_name} ({chat_id}): '{text_clean}'")

    if cmd in ["/start", "/help", "/menu", "меню", "допомога"]:
        send_telegram_message(chat_id, build_help_card(), reply_markup=MAIN_KEYBOARD)
    elif cmd in ["/status", "📊 загальний статус", "статус"]:
        send_telegram_message(chat_id, build_status_card(), reply_markup=MAIN_KEYBOARD)
    elif cmd in ["/battery", "🔋 батарея", "акб", "акумулятор"]:
        send_telegram_message(chat_id, build_battery_card(), reply_markup=MAIN_KEYBOARD)
    elif cmd in ["/grid", "⚡ мережа", "мережа", "світло"]:
        send_telegram_message(chat_id, build_grid_card(), reply_markup=MAIN_KEYBOARD)
    elif cmd in ["/solar", "☀️ сонце", "сонце", "панелі", "генерація"]:
        send_telegram_message(chat_id, build_solar_card(), reply_markup=MAIN_KEYBOARD)
    elif cmd in ["/load", "/power", "🏠 споживання", "споживання", "дім", "навантаження"]:
        send_telegram_message(chat_id, build_load_card(), reply_markup=MAIN_KEYBOARD)
    elif cmd in ["/temps", "🌡 температури", "температура", "температури", "градуси"]:
        send_telegram_message(chat_id, build_temps_card(), reply_markup=MAIN_KEYBOARD)
    elif cmd in ["/auto", "/rules", "⚙️ автоматика", "автоматика", "правила"]:
        send_telegram_message(chat_id, build_auto_card(), reply_markup=MAIN_KEYBOARD)
    else:
        msg = f"❓ Команда <code>{text_clean}</code> не розпізнана.\n\nСкористайтеся кнопками внизу або надішліть /help."
        send_telegram_message(chat_id, msg, reply_markup=MAIN_KEYBOARD)

# --- Telegram Long Polling Worker ---
def telegram_polling_loop():
    logger.info("Starting Telegram Bot Long Polling worker...")
    offset = 0

    while True:
        try:
            url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates?offset={offset}&timeout=20"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if data.get("ok"):
                        for update in data.get("result", []):
                            offset = update["update_id"] + 1

                            if "message" in update:
                                msg = update["message"]
                                chat_id = str(msg.get("chat", {}).get("id"))
                                user = msg.get("from", {}).get("username") or msg.get("from", {}).get("first_name", "User")
                                text = msg.get("text", "")

                                if not text:
                                    continue

                                # Security Authorization Check
                                if ALLOWED_CHAT_IDS and (chat_id not in ALLOWED_CHAT_IDS):
                                    logger.warning(f"⛔ Unauthorized message from Chat ID {chat_id} (@{user}): '{text}'")
                                    denied_msg = (
                                        f"⛔ <b>Доступ заборонено!</b>\n\n"
                                        f"Ваш Chat ID: <code>{chat_id}</code> не авторизовано для моніторингу цього інвертора."
                                    )
                                    send_telegram_message(chat_id, denied_msg)
                                    continue

                                handle_incoming_message(chat_id, user, text)
        except urllib.error.URLError as e:
            logger.warning(f"Network error in Telegram polling: {e}. Retrying in 5s...")
            time.sleep(5)
        except Exception as e:
            logger.error(f"Unexpected error in Telegram polling: {e}")
            time.sleep(5)

# --- MQTT Handlers ---
def on_mqtt_connect(client, userdata, flags, rc, *args, **kwargs):
    if rc == 0:
        logger.info("Connected to local MQTT broker successfully! Subscribing to telemetry topics...")
        client.subscribe([
            ("sandisolar-controller/#", 1),
            ("antigravity/#", 1)
        ])
    else:
        logger.error(f"Failed to connect to MQTT broker, return code: {rc}")

def on_mqtt_message(client, userdata, msg):
    try:
        topic = msg.topic
        payload = msg.payload.decode("utf-8")

        # Normalize key for easy lookup:
        # e.g., "sandisolar-controller/sensor/grid_voltage/state" -> "sensor/grid_voltage"
        if topic.startswith("sandisolar-controller/"):
            parts = topic[len("sandisolar-controller/"):].split("/")
            if len(parts) >= 2 and parts[-1] == "state":
                key = f"{parts[0]}/{parts[1]}"
                update_telemetry(key, payload)
        elif topic == "antigravity/inverter/telemetry":
            # Direct raw telemetry json
            try:
                data = json.loads(payload)
                for k, v in data.items():
                    update_telemetry(f"raw/{k}", v)
            except Exception:
                pass
    except Exception as e:
        logger.error(f"Error parsing MQTT message on {msg.topic}: {e}")

def mqtt_worker():
    if not mqtt:
        logger.error("MQTT client module unavailable.")
        return
    import random
    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id=client_id, protocol=mqtt.MQTTv311)
    except AttributeError:
        client = mqtt.Client(client_id=client_id, protocol=mqtt.MQTTv311)
    client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
    client.on_connect = on_mqtt_connect
    client.on_message = on_mqtt_message
    client.reconnect_delay_set(min_delay=1, max_delay=60)

    while True:
        try:
            logger.info(f"Connecting to MQTT broker at {MQTT_BROKER}:{MQTT_PORT}...")
            client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
            client.loop_forever()
        except Exception as e:
            logger.error(f"MQTT connection failed: {e}. Retrying in 10s...")
            time.sleep(10)

def main():
    logger.info("=== Starting SandiSolar Interactive Telegram Bot ===")
    if not TELEGRAM_BOT_TOKEN:
        logger.error("FATAL: TELEGRAM_BOT_TOKEN is not configured in .env! Exiting.")
        sys.exit(1)

    if not ALLOWED_CHAT_IDS:
        logger.warning("WARNING: TELEGRAM_CHAT_ID is empty! No users will be authorized to receive telemetry.")

    # Start MQTT background thread
    mqtt_thread = threading.Thread(target=mqtt_worker, daemon=True)
    mqtt_thread.start()

    # Start Telegram polling loop on main thread
    telegram_polling_loop()

if __name__ == "__main__":
    main()
