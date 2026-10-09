# Walkthrough - Sandisolar MQTT Sniffer & Command Center

This document outlines the changes made to the project workspace and guides you on how to start, monitor, and use the application.

## Summary of Changes

1. **Backend Integration (`server.js`)**:
   - Integrated an embedded **Aedes MQTT broker** running on port `1883`.
   - Setup a static file server using **Express** on port `3010`.
   - Setup **WebSockets** (`ws`) to stream real-time events (connections, raw publications, decoded telemetry).
   - Created a dynamic parser that reads and loads Modbus registers from your `sandisolar.yml.txt` file. If you make any changes to the file, the server will reload it automatically without restarting!
   - Saves raw telemetry JSON payloads to `logs/mqtt_raw_telemetry.log`.

2. **Frontend Dashboard (`public/`)**:
   - `public/index.html`: Clean structure featuring Connection status pills, Broker connection credentials info box, live decoded telemetry table (searchable), and custom Command Center forms.
   - `public/style.css`: Premium, state-of-the-art dark theme utilizing modern layout grids, transparent glassmorphism, responsive scales, and neon accents. Values flash green when they receive updates.
   - `public/app.js`: WebSocket manager connecting the browser to the backend, rendering tables, tracking elapsed time, and formatting command payloads.

3. **Mock Inverter Client (`test_inverter_mock.js`)**:
   - Simulates a real inverter: connects to the broker with authentication, sends fluctuating telemetry JSON data every 5 seconds, listens to `antigravity/inverter/command` and updates internal registers.

 4. **Glowing Gradient Pulse Flow Visualizer (`custom.css`, `custom.js`)**:
   - Replaced old static dash-array curves with smooth cubic Bezier curved tracks.
   - Built a custom SVG canvas layer with linear gradients (Solar, Grid, Battery, Load).
   - Designed animated glowing pulses of light (dashes of length 24, spacing 180) using CSS transitions and keyframes (`stroke-dashoffset`).
   - Integrated full direction reversal (`particle-flow-reverse`) for battery discharging mode.
   - Restructured the CSS grid layout so the central Inverter node spans both rows and sits perfectly vertically centered, eliminating the need for spacer divs.

---

## How to Run & Verify

Currently, the server is running on your machine at port `3010`, and the mock inverter client is also running in the background.

To verify manually:
1. Open your browser and navigate to: **`http://localhost:3010`** (or **`http://<SERVER_IP>:3010`**)
2. You should see the dashboard load instantly, show `WebSocket: Active` and `Inverter WiFi: sandisolar_inv_mock`.
3. Telemetry values (Voltage, Battery SOC, Temperature) will begin filling the table and flashing green as they update every 5 seconds.
4. Try typing `128` in the search box: it will filter the table down to just "Battery SOC".
5. Use the **Command Panel** to write a command:
   - Select "207 — Вбудований зумер (Пищалка)".
   - Enter `0` (Disabled).
   - Click "Надіслати команду".
   - You should see the success notification in the UI, and in your logs terminal you will see the mock inverter process receiving the packet and updating register 207 to `0`.

---

## Guide to Connect your Real Inverter

Once you're ready to test with your actual Sandisolar inverter:

1. Stop the mock inverter process:
   ```bash
   npm run stop-mock # (or kill the process)
   ```
2. Go to your inverter's web dashboard (or HaiPower app).
3. Go to **Tri-Party System** settings and configure:
   - **Tri-Party System:** ON
   - **Server Address:** `<SERVER_IP>` (The IP address of your server)
   - **Server Port:** `1883`
   - **ClientID:** `sandisolar_inv`
   - **Account:** `sandisolar_inv`
   - **Password:** `sandisolar_pass`
   - **Publish Topic:** `antigravity/inverter/telemetry`
   - **Subscribe Topic:** `antigravity/inverter/command`
4. Save settings.
5. Open your Web Dashboard (`http://<SERVER_IP>:3010`).
6. Monitor the **MQTT Activity Log** panel on the right. If the WiFi module initiates connections, you will see `[MQTT] Client authenticated successfully` and telemetry packets start flowing!
