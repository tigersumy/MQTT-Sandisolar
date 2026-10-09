# Task List - Sandisolar MQTT Sniffer & Control Dashboard (Completed)

- [x] Initialize Node.js project (`package.json`) and install dependencies (Express, Aedes MQTT, WS, JS-YAML).
- [x] Create environment configuration (`.env`).
- [x] Implement backend server (`server.js`) with embedded broker, parser, and WebSocket.
- [x] Build premium dark-mode web dashboard.
- [x] Create mock inverter script and verify the application.
- [x] Document everything and guide the user on how to run it.

---

# Task List - ESP32 Hardware Integration (Sandisolar & Felicity Solar)

- [x] Clarify battery-to-inverter communication status and RJ45 pinout (Confirmed: Inverter-centric Option A topology; battery communicates via CAN/RS485 using Pylontech protocol).
- [x] Create the ESPHome configuration file `sandisolar.yml` containing the complete register list and hardware adaptations.
  - [x] Add basic ESPHome components (Wi-Fi, API, OTA, Logger).
  - [x] Configure `uart` bus (Baudrate, TX/RX pins, changed RX to GPIO18 due to pin availability).
  - [x] Configure `modbus` interface.
  - [x] Configure `modbus_controller` with Slave ID 1.
  - [x] Add Modbus read sensors for Inverter & Battery data.
  - [x] Add Modbus write commands (Power Switch, Output priority, Charge priority).
- [x] Document hardware connections (ESP32 pins, XY-485 board, RJ45 ports) in `verification_and_flashing_guide.md`.
- [ ] Verify compilation of the configuration via ESPHome compiler (Ready for user compile).
