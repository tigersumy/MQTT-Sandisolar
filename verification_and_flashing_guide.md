# ESP32 Verification and Flashing Guide (ESPHome CLI)

This checklist and guide will help you verify your connections, configure your credentials, compile, and flash the ESP32 controller using the ESPHome Command Line Interface (CLI).

---

## 📋 Pre-Flashing Checklist

### 1. Hardware Connections (Wiring)
- [ ] **VCC on XY-485** connected to **5V / VIN** on ESP32.
- [ ] **GND on XY-485** connected to **GND** on ESP32.
- [ ] **TXD on XY-485** connected to **GPIO18 (RX)** on ESP32.
- [ ] **RXD on XY-485** connected to **GPIO19 (TX)** on ESP32.
- [ ] **A+ on XY-485** connected to **RS485-A** on the Inverter RJ45 port.
- [ ] **B- on XY-485** connected to **RS485-B** on the Inverter RJ45 port.
- [ ] **GND on XY-485 (optional)** connected to **RS485-GND** on the Inverter RJ45 port.
- [ ] **BMS Cable (CAN)** connected between FelicityESS battery and Inverter CAN BMS port.

### 2. Configuration Settings in `secrets.yaml`
- [ ] Copy `secrets.yaml.example` to `secrets.yaml` and edit:
  - **wifi_ssid** (your Wi-Fi SSID).
  - **wifi_password** (your Wi-Fi Password).
  - **mqtt_broker** (IP address of your MQTT broker).
  - **mqtt_username** / **mqtt_password** (broker authentication credentials).

---

## 💻 CLI Commands (Flashing & Logging)

Run these commands in your terminal inside the project directory:

### 1. Set up a Python Virtual Environment (Recommended for macOS)
This isolates ESPHome and ensures that the `esphome` command is found without PATH problems:
```bash
# Create virtual environment
python3 -m venv venv

# Activate it (on macOS / Linux)
source venv/bin/activate

# Install ESPHome inside the environment
pip install esphome
```
*Note: While the virtual environment is active, the `esphome` command will be globally available in your terminal session.*

*(Alternative: If you prefer not to use a virtual environment, you can run ESPHome as a python module directly by replacing any `esphome` command with `python3 -m esphome`).*

### 2. Validate YAML Syntax
Verify that the configuration is syntactically correct:
```bash
esphome config sandisolar.yml
# Alternative: python3 -m esphome config sandisolar.yml
```

### 3. Compile the Firmware
Compile the firmware locally to ensure there are no errors:
```bash
esphome compile sandisolar.yml
# Alternative: python3 -m esphome compile sandisolar.yml
```

### 4. Flash Firmware via USB
Connect the ESP32 to your computer using a USB-C data cable and run:
```bash
esphome run sandisolar.yml
# Alternative: python3 -m esphome run sandisolar.yml
```
*Note: The CLI will compile the code and prompt you to select the serial port (e.g., `/dev/cu.usbserial-...` or `/dev/tty.wchusbserial...`). Select the USB port corresponding to your CH340C chip.*

### 5. View Logs in Real-time
Once flashed, you can view diagnostic logs over USB or network:
```bash
esphome logs sandisolar.yml
# Alternative: python3 -m esphome logs sandisolar.yml
```

---

## 🛠️ Troubleshooting & Diagnostics

*   **"No response from Modbus device" / "Modbus connection failed":**
    *   **Swap TXD/RXD:** Swap the TXD and RXD wires connecting the ESP32 and the XY-485 board.
    *   **Swap A+/B-:** Swap the A+ and B- wires connecting the XY-485 to the inverter RJ45 port.
    *   **BMS Address:** Ensure the Inverter address matches `1` (or change the address in the yaml if the inverter is configured to another ID).
*   **Wi-Fi Connection Issues:**
    *   If the ESP32 fails to connect to your Wi-Fi, it will broadcast a fallback hotspot named **"Sandisolar Fallback"** (password: `fallback_password`). Connect to it with your phone, open `192.168.4.1` in a browser, and enter your correct Wi-Fi details.
