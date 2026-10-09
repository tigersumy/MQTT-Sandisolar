const mqtt = require('mqtt');
require('dotenv').config();

// Load config
const MQTT_PORT = process.env.MQTT_PORT || 1883;
const MQTT_USER = process.env.MQTT_USER || 'sandisolar_inv';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || 'sandisolar_pass';

const brokerUrl = `mqtt://localhost:${MQTT_PORT}`;

console.log(`[Mock Inverter] Connecting to broker at ${brokerUrl}...`);
console.log(`[Mock Inverter] Using credentials: User="${MQTT_USER}", Pass="${MQTT_PASSWORD}"`);

const client = mqtt.connect(brokerUrl, {
  username: MQTT_USER,
  password: MQTT_PASSWORD,
  clientId: 'sandisolar_inv_mock',
  reconnectPeriod: 2000
});

// Mock Inverter State
const inverterState = {
  2: 2305,   // Inverter Voltage (230.5V)
  5: 120,    // Inverter Current (12.0A)
  10: 345,   // Inverter Temp (34.5C)
  42: 2284,  // Grid Voltage (228.4V)
  127: 512,  // Battery Voltage (51.2V)
  128: 85,   // Battery SOC (85%)
  129: 45,   // Battery Max Charge Current (45A)
  181: 2,    // Charge Source Priority (Only PV)
  182: 0,    // Output Source Priority (SBU)
  207: 1     // Buzzer (Enabled)
};

client.on('connect', () => {
  console.log('[Mock Inverter] Connected to MQTT broker successfully!');
  
  // Subscribe to command topic
  const commandTopic = 'antigravity/inverter/command';
  client.subscribe(commandTopic, (err) => {
    if (err) {
      console.error(`[Mock Inverter] Failed to subscribe to ${commandTopic}:`, err.message);
    } else {
      console.log(`[Mock Inverter] Subscribed to command topic: "${commandTopic}"`);
    }
  });

  // Start publishing telemetry loop every 5 seconds
  const telemetryTopic = 'antigravity/inverter/telemetry';
  console.log(`[Mock Inverter] Starting telemetry telemetry stream on topic: "${telemetryTopic}"`);
  
  setInterval(() => {
    // Add minor fluctuations to make the dashboard feel alive
    const stateToSend = { ...inverterState };
    stateToSend[2] += Math.floor(Math.random() * 5) - 2; // Voltage fluctuation
    stateToSend[42] += Math.floor(Math.random() * 3) - 1; // Grid fluctuation
    stateToSend[10] += Math.floor(Math.random() * 3) - 1; // Temp fluctuation
    
    // Simulate battery slowly discharging
    if (Math.random() > 0.8 && stateToSend[128] > 10) {
      inverterState[128] -= 1;
      inverterState[127] -= 1; // voltage drops slightly
    }

    const payload = JSON.stringify(stateToSend);
    client.publish(telemetryTopic, payload, { qos: 0 }, (err) => {
      if (err) {
        console.error('[Mock Inverter] Publish error:', err.message);
      } else {
        console.log(`[Mock Inverter] Published telemetry: ${payload}`);
      }
    });
  }, 5000);
});

// Handle incoming commands
client.on('message', (topic, message) => {
  const payloadStr = message.toString('utf8');
  console.log(`[Mock Inverter] Received command packet: "${payloadStr}"`);
  
  try {
    // Attempt to parse payload
    let parsed;
    try {
      parsed = JSON.parse(payloadStr);
    } catch {
      // If not JSON, try to parse it as raw number value
      const numVal = parseInt(payloadStr, 10);
      if (!isNaN(numVal)) {
        parsed = numVal;
      }
    }
    
    if (typeof parsed === 'object' && parsed !== null) {
      // 1. Check if format is {"207": 1}
      for (const [key, value] of Object.entries(parsed)) {
        const addr = parseInt(key, 10);
        if (!isNaN(addr) && inverterState[addr] !== undefined) {
          inverterState[addr] = value;
          console.log(`[Mock Inverter] UPDATED state: Register ${addr} set to ${value}`);
        }
      }
      
      // 2. Check if format is {"register": 207, "value": 1}
      if (parsed.register !== undefined && parsed.value !== undefined) {
        const addr = parseInt(parsed.register, 10);
        if (!isNaN(addr) && inverterState[addr] !== undefined) {
          inverterState[addr] = parsed.value;
          console.log(`[Mock Inverter] UPDATED state (detailed): Register ${addr} set to ${parsed.value}`);
        }
      }
    } else if (typeof parsed === 'number') {
      // If raw number, we don't know the register, so we assume a test register or print it
      console.log(`[Mock Inverter] Received raw command number: ${parsed}. (Ambiguous register, no state updated)`);
    } else {
      console.log(`[Mock Inverter] Received command string: "${payloadStr}". (No state updated)`);
    }
  } catch (err) {
    console.error('[Mock Inverter] Error processing command payload:', err.message);
  }
});

client.on('error', (err) => {
  console.error('[Mock Inverter] Connection error:', err.message);
});

client.on('close', () => {
  console.log('[Mock Inverter] Connection closed.');
});
