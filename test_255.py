import os
import sys
import subprocess
import time
import threading

sys.path.insert(0, os.path.abspath("./venv_libs"))
try:
    import requests
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "requests", "--target", "./venv_libs"])
    import requests

log_lines = []

def read_logs(proc):
    for line in iter(proc.stdout.readline, b''):
        decoded_line = line.decode('utf-8', errors='ignore').strip()
        log_lines.append(decoded_line)
        print(f"[ESPHome] {decoded_line}")

def main():
    esp_ip = os.getenv("ESP_IP", "192.168.1.219")
    # Start esphome logs
    esphome_cmd = os.getenv("ESPHOME_CMD", "esphome")
    cmd = [esphome_cmd, "logs", "sandisolar.yml"]
    print(f"Running command: {' '.join(cmd)}")
    
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    
    t = threading.Thread(target=read_logs, args=(proc,))
    t.daemon = True
    t.start()
    
    print("Waiting 5 seconds for ESPHome logs to connect...")
    time.sleep(5)
    
    # Values to test: 255 (0xFF), 65535 (0xFFFF)
    test_values = [
        255,     # 0x00FF
        65535    # 0xFFFF
    ]
    
    for val in test_values:
        print(f"\n======================================")
        print(f"Testing value: {val} (hex: {hex(val)})")
        print(f"======================================")
        try:
            url = f"http://{esp_ip}/number/bluetooth_debug_number/set?value={val}"
            print(f"[HTTP] Sending POST to {url}")
            r = requests.post(url, timeout=3)
            print(f"[HTTP] Response: {r.status_code}")
        except Exception as e:
            print(f"[HTTP] Error: {e}")
        time.sleep(5)
        
    proc.terminate()
    proc.wait()
    print("Test finished.")

if __name__ == "__main__":
    main()
