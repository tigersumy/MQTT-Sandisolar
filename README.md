# Standalone Integration: ESP32 + SandiSolar / Aohai Inverter Telemetry & Control

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This project provides a standalone integration for **SandiSolar / Aohai (6kW and similar models)** hybrid inverters. It enables reading telemetry and controlling settings directly over **RS-485 Modbus RTU** using an ESP32 microcontroller, publishing telemetry to a local MQTT broker, and rendering a real-time web dashboard without relying on Home Assistant.

---

## 📐 Project Architecture

```mermaid
graph TD
    Inverter["SandiSolar Inverter"] <-->|"RS-485 Modbus RTU"| Adapter["XY-485 TTL-to-RS485"]
    Adapter <-->|"UART TX/RX"| ESP32["ESP32 Controller (ESPHome)"]
    
    subgraph MacServer["Mac Mini Server"]
        MQTT["Aedes MQTT Broker (Port 1883)"]
        WebServer["Node.js Dashboard (Port 3010)"]
        Monitor["Automation Daemon (mqtt_power_monitor.py)"]
        TeleBot["Interactive Bot (telegram_bot.py)"]
        
        WebServer <-->|"Telemetry Stream"| MQTT
        Monitor <-->|"State & Inverter Commands"| MQTT
        TeleBot <-->|"Telemetry Cache"| MQTT
    end

    ESP32 <-->|"Wi-Fi MQTT Pub/Sub"| MQTT
    ESP32 -->|"HTTP Web UI: Port 80"| User["User"]
    
    TeleAPI["Telegram Cloud API"]
    Monitor -->|"Push Alerts: Outage / SOC"| TeleAPI
    TeleBot <-->|"Two-way Commands & Telemetry"| TeleAPI
    
    User <-->|"Web Browser"| WebServer
    User <-->|"Telegram App: Buttons & Commands"| TeleAPI
```

---

## 🔌 Hardware Setup & Wiring

### 1. Components
*   **Microcontroller:** ESP32 DevKitC (WROOM-32)
*   **RS-485 Adapter:** Blue **XY-485 (TTL-to-RS485)** module (featuring automatic hardware flow control, requiring no RE/DE control pins).
*   **Cable:** Standard CAT5e/CAT6 Ethernet cable to connect the XY-485 adapter to the inverter's RJ45 Modbus port.

### 2. Wiring Pinout

#### ESP32 to XY-485 Adapter
*   **ESP32 5V (or Vin)** ➡️ **XY-485 VCC**
*   **ESP32 GND** ➡️ **XY-485 GND**
*   **ESP32 GPIO18 (TX)** ➡️ **XY-485 RXD** (Software swapped pin configuration)
*   **ESP32 GPIO19 (RX)** ➡️ **XY-485 TXD** (Software swapped pin configuration)

#### XY-485 to Inverter (RJ45 Port)
Refer to the inverter's Modbus port diagram. A standard CAT5e wire is terminated to connect the adapter pins:
*   **XY-485 A+** ➡️ **Inverter RS485-A** (RJ45 Pin 2 or Pin 7)
*   **XY-485 B-** ➡️ **Inverter RS485-B** (RJ45 Pin 1 or Pin 8)
*   **XY-485 GND** ➡️ **Inverter GND** (RJ45 Pin 3 or Pin 6)
*   *Note: Ensure grounds are shared if communication is unstable.*

### 3. SandiSolar SD-PRO-EU 6.5K BMS RJ45 Port Architecture & PCB Topology

The combined `BMS (RJ45)` port on the SandiSolar SD-PRO-EU 6.5K inverter houses both RS-485 and CAN communication buses on a single modular socket:

| RJ45 Pin | Inverter Signal | Physical PCB Connection | Function |
| :---: | :--- | :--- | :--- |
| **Pin 1** | **BMS-485_B** | Connected via copper PCB trace to **Pin 8** | RS-485 inverting line B (-) |
| **Pin 2** | **BMS-485_A** | Connected via copper PCB trace to **Pin 7** | RS-485 non-inverting line A (+) |
| **Pin 3** | **BMS-GND** | Connected via copper PCB trace to **Pin 6** | Signal ground (GND) |
| **Pin 4** | **CAN-H** | Direct CAN transceiver differential input | High-speed CAN Bus High |
| **Pin 5** | **CAN-L** | Direct CAN transceiver differential input | High-speed CAN Bus Low |
| **Pin 6** | **BMS-GND** | Connected to Pin 3 | Redundant Signal ground (GND) |
| **Pin 7** | **BMS-485_A** | Connected to Pin 2 | Parallel RS-485 line A (+) |
| **Pin 8** | **BMS-485_B** | Connected to Pin 1 | Parallel RS-485 line B (-) |

> ⚠️ **CRITICAL WIRING WARNING — DO NOT USE STRAIGHT 1-TO-1 PATCH CORDS:**
> * On the inverter PCB, **Pin 1 is bridged to Pin 8**, and **Pin 2 is bridged to Pin 7**.
> * Many external BMS devices (e.g. standard Pylontech cables or third-party gateways) place CAN-H on Pin 8 and GND on Pin 1.
> * If a standard straight 1-to-1 patch cord is plugged in, **CAN-H (Pin 8) is shorted directly to GND (Pin 1) across the inverter PCB trace**, completely muting the CAN bus and causing immediate **`F20 / Fault 307 BMS Comm Fault`**!
> * **Correct CAN cable wiring:** Wire only **Pin 4 (CAN-H)**, **Pin 5 (CAN-L)**, and **Pin 3 (GND)** to the inverter side. Leave pins 1, 2, 7, and 8 disconnected on the CAN cable.

### 4. Inverter Operating Modes Matrix & RS485 Zero-Export Architecture

The `SandiSolar SD-PRO-EU 6.5K` / `Aohai AO-6KSL-G3` platform implements an advanced power routing engine configurable through Modbus registers:

* **Output Power Priority (Register 182):**
  * `SOL (0)`: Solar First — Solar supplies loads first. Deficit covered by battery. Utility connected only upon reaching battery discharge threshold.
  * `UTI (1)`: Utility First — Grid powers loads as primary source (pure bypass). Solar and battery kick in only during blackouts.
  * `SBU (2)`: Solar-Battery-Utility — Solar powers loads ➡️ Battery powers loads ➡️ Grid connects when battery is depleted. Maximizes autonomy.
* **Battery Charging Priority (Register 181):**
  * `CSO (0)`: Solar First — Solar charges battery first; grid charges only when solar is unavailable.
  * `SNU (1)`: Solar & Utility — Solar and grid charge simultaneously (fastest charge ladder).
  * `OSO (2)`: Only Solar — Grid charging strictly disabled under all conditions.
* **AC Input Sensitivity (Register 183):**
  * `APL`: Appliance Mode ($90–280\text{V}$) — Broad input range preventing nuisance drops in unstable rural grids.
  * `UPS`: Uninterruptible Mode ($170–280\text{V}$) — Tight voltage window with ultrafast transfer ($< 10\text{ms}$) for sensitive IT servers and workstations.
* **GEN Multi-Function Auxiliary Port (Register 104 `genMode`):**
  * `Mode 1 (Generator Input)`: Backup fuel generator input with automatic dry-contact auto-start signal.
  * `Mode 2 (Microinverter AC-Coupling)`: Bi-directional port to connect grid-tie microinverters to expand solar generation on the AC side.
  * `Mode 3 (Smart Load Output)`: Dynamic dump load port (water heater, boiler) enabled only when solar surplus exists and battery SOC is above the threshold.
* **RS-485 Smart Meter Zero Export (Why CT Clamp is Inactive):**
  * The inverter motherboard has **no physical Current Transformer (CT) clamp terminals**.
  * Zero-export and anti-backflow functionality is exclusively handled via an **RS-485 Smart Meter** (`ctMode=0`) connected to RJ45 pins **7 (A+)** and **8 (B-)**. Enabling CT in mobile apps is disabled on this hardware family.

---

## 🛠️ Software & Firmware Setup

### 1. ESP32 Firmware (ESPHome)
The firmware is built using **ESPHome** in a standalone MQTT-centric configuration.

*   **Config File:** `sandisolar.yml` (copy `secrets.yaml.example` to `secrets.yaml` and set your credentials)
*   **Direct Modbus RTU Address Mapping:**
    Uses **0-based factory addresses** from the datasheet (no shift, unlike 1-based PC testing software):
    *   `OnOffSet` (Power Switch): address `0` (Holding, bitmask 1)
    *   `Battery Max Charge Current`: address `129` (Holding, multiplier `0.01`)
    *   `AC Grid Charge Current`: address `189` (Holding, multiplier `0.1`)
    *   `Inverter Charge Source Priority`: address `181` (Holding, select mapping)
    *   `Inverter Output Source Priority`: address `182` (Holding, select mapping)
    *   `Bluetooth Status`: address `231` (Holding, read-only binary sensor)
    *   `Buzzer Status`: address `207` (Holding, read-only binary sensor)

*   **Local Automations:**
    The ESP32 runs onboard automations to protect the battery and change charging priorities based on State of Charge (SOC):
    *   **SOC < 25%:** Swaps Output priority to **Utility First (UTI)**.
    *   **SOC < 15%:** Swaps Charge priority to **Solar & Utility (SNU)** to force grid charge.
    *   **SOC > 40%:** Swaps Charge priority back to **Solar Only (OSO)**.
    *   **SOC > 50%:** Swaps Output priority back to **Solar-Utility-Battery (SBU)**.

### 2. Node.js Dashboard & MQTT Server
A lightweight Node.js server hosts the web dashboard on **port 3010** and runs an embedded MQTT broker.

*   **Server File:** `server.js`
*   **MQTT Broker Port:** `1883`
*   **Credentials:** Username `sandisolar_inv`, Password `sandisolar_pass`
*   **Topic Mapping:**
    Subscriptions listen to the `sandisolar-controller/sensor/+/state` MQTT wildcard. The server maps the incoming ESPHome sensor topics back to virtual register slots to feed the real-time telemetry matrix.

### 3. Automation Daemon & Interactive Telegram Bot
*   **Automation Daemon (`mqtt_power_monitor.py`):** Monitors grid voltage and battery SOC, handles debounce, triggers inverter ON/OFF during outages, enforces battery charging ladders, provides **Winter Cold Battery Protection** (inhibits grid charging if battery temperature $< 3.0^\circ\text{C}$ to protect LiFePO4 chemistry from lithium plating), and sends immediate push notifications.
*   **Interactive Telegram Bot (`telegram_bot.py`):** Provides real-time two-way interaction via custom reply keyboard buttons and slash commands with whitelist-based Chat ID authorization. Includes inverter Fault alert banners, cold battery status badges, and 4-zone thermal diagnostics.

---

## 🤖 Interactive Telegram Bot (`telegram_bot.py`)

The project includes an interactive Telegram bot that connects to the local MQTT broker and allows you to check live telemetry, temperatures, electrical parameters, and automation states directly from your phone.

### ✨ Key Features
* **Zero Cloud Dependency:** Communicates directly with the local MQTT broker (`sandisolar-controller/sensor/#`) without third-party IoT clouds.
* **Persistent Custom Keyboard:** Quickly navigate system parameters using 7 dedicated Ukrainian buttons without typing commands manually.
* **⏱️ Battery Predictive Analytics & Autonomy ETA:**
  * Real-time calculation of remaining charge time to **100%** with charge velocity in `%/hr`.
  * Real-time calculation of autonomy countdown down to safe **20% cutoff** during grid outages or high consumption.
  * Automatic buffer detection (idle mode when current is $< 1.0\text{ A}$).
* **Rich Telemetry Cards:**
  * **📊 General Status (`/status`):** System overview showing inverter operating mode (`Off-grid`, `On-grid`, `Bypass`, `SoftOFF`), battery SOC & voltage, inline ETA prediction, grid status, household load, solar generation, and thermal overview.
  * **🔋 Battery (`/battery`):** Real-time battery SOC (%), voltage, current (A), dynamic charging/discharging power (W) with directional arrow indicators (⚡ Заряд / 🔻 Розряд), dedicated ETA forecast section, and BMS temperature.
  * **⚡ Grid (`/grid`):** AC grid voltage, frequency (Hz), line current, active power (W), and apparent power (VA).
  * **☀️ Solar / PV (`/solar`):** PV string voltage, current, real-time solar generation (W), and accumulated daily yield (kWh).
  * **🏠 Household Load (`/load`):** Inverter output AC voltage, AC current, household active load power (W), and daily consumed energy (kWh).
  * **🌡️ Thermal Diagnostics (`/temps`):** Live temperature readings for all 4 internal sensors:
    * `T1`: Inverter heatsink temperature
    * `T2`: Boost / IPM (DC-DC / IGBT stage)
    * `T3`: LLC power transformer
    * `T4`: Battery pack sensor (via BMS)
    * Includes color-coded alert badges (🟢 normal $<65^\circ\text{C}$, 🟡 elevated $65-80^\circ\text{C}$, 🔴 high $>80^\circ\text{C}$).
  * **⚙️ Automation Status (`/auto`):** Current power monitoring daemon status, debounce counter, and battery charging thresholds.
  * **ℹ️ Help / Menu (`/help`, `/menu`):** Displays command reference and restores the interactive keyboard.
* **Strict Security Whitelist:** Automatically filters incoming messages by `TELEGRAM_ALLOWED_CHAT_IDS` or `TELEGRAM_CHAT_ID`. Messages from unauthorized users are rejected and logged.

### ⚙️ Environment Configuration (`.env`)
```bash
# Telegram Bot Token (obtained from @BotFather)
TELEGRAM_BOT_TOKEN="your_bot_token_here"

# Default notification chat ID
TELEGRAM_CHAT_ID="your_telegram_chat_id"

# Allowed Chat IDs for interactive bot (comma-separated for multiple users)
TELEGRAM_ALLOWED_CHAT_IDS="123456789,987654321"

# MQTT Broker Settings
MQTT_BROKER="127.0.0.1"
MQTT_PORT=1883
MQTT_USER="sandisolar_inv"
MQTT_PASS="sandisolar_pass"
```

---

## 🚀 Running the Project

### Flashing Firmware to ESP32
Ensure your Python virtual environment (`venv`) is activated, and run:
```bash
# Run compilation and flash wirelessly or over serial
esphome run sandisolar.yml
# View real-time logs from the ESP32
esphome logs sandisolar.yml
```

### Launching Services
```bash
# 1. Start Node.js MQTT Server & Dashboard
node server.js

# 2. Start Automation Monitor Daemon
python3 mqtt_power_monitor.py

# 3. Start Interactive Telegram Bot
python3 telegram_bot.py
```
*Note: launchd plists (`com.antigravity.mqtt.plist` and `com.sandisolar.telegram_bot.plist`) can be placed in `~/Library/LaunchAgents/` to run these services automatically on macOS startup.*

---

## 📑 Modbus Telemetry Registry Specifications

| Register Address | Data Type | Read / Write | Parameter Description | Scaling / Unit |
| :--- | :--- | :--- | :--- | :--- |
| **0 (Holding)** | `uint16` | R/W (bitmask) | Inverter Power Switch | `0` = Off, `1` = On |
| **0 (Input)** | `uint16` | Read-only | Inverter Status (Mode) | `0` = Waiting, `1` = On-grid, `2` = Off-grid, `5` = Bypass |
| **129** | `uint16` | R/W | Max Battery Charge Current | `0.01` (A) |
| **189** | `uint16` | R/W | Max AC Grid Charge Current | `0.1` (A) |
| **181** | `uint16` | R/W | Battery Charging Priority | `0` = CSO, `1` = SNU, `2` = OSO |
| **182** | `uint16` | R/W | Load Output Priority | `0` = SOL, `1` = UTI, `2` = SBU |
| **207** | `uint8` | Read-only | Internal Buzzer Enabled | `0` = Muted, `1` = Enabled |
| **231** | `uint8` | Read-only | Onboard Bluetooth Enabled | `0` = Off, `1` = On |

*Note: System configuration flags like Bluetooth and Buzzer accept remote commands to disable (`0`), but the inverter firmware blocks remote enabling (`1`) via the Modbus interface for local security reasons (returning Modbus exception 3). They are therefore configured as read-only diagnostic binary sensors.*

---

## 🙏 Acknowledgements & Credits

Special thanks to [@bootuz-dinamon](https://github.com/bootuz-dinamon) for the foundational reverse engineering and research on the Sandisolar / Aohai inverter Modbus protocol:
* **Repository:** [Sandisolar-Aohai-AO-6KSL-G3-Home-Assistant-integration](https://github.com/bootuz-dinamon/Sandisolar-Aohai-AO-6KSL-G3-Home-Assistant-integration)
* The Modbus register mapping, protocol specifications, and integration findings provided in their work served as an essential reference for building this standalone MQTT controller and dashboard.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
