const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const aedesFactory = require('aedes');
const net = require('net');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
require('dotenv').config();

// Create logs directory
if (!fs.existsSync('./logs')) {
  fs.mkdirSync('./logs');
}

// Config
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '1883', 10);
const MQTT_USER = process.env.MQTT_USER || 'sandisolar_inv';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || 'sandisolar_pass';
const WEB_PORT = parseInt(process.env.WEB_PORT || '3000', 10);
const YAML_PATH = process.env.YAML_PATH || './sandisolar.yml.txt';

// Instantiate Aedes MQTT Broker
const aedes = aedesFactory();

// Modbus registers database
let registers = {};
let idToAddressMap = {};

function loadRegisters() {
  try {
    if (fs.existsSync(YAML_PATH)) {
      const fileContent = fs.readFileSync(YAML_PATH, 'utf8');
      const doc = yaml.load(fileContent);
      
      registers = {};
      idToAddressMap = {};
      
      const extractFromSection = (sectionName) => {
        if (!doc || !doc[sectionName]) return;
        const list = doc[sectionName];
        if (!Array.isArray(list)) return;
        
        list.forEach(item => {
          if (item && item.platform === 'modbus_controller' && item.address !== undefined) {
            let multiply = 1;
            if (item.filters) {
              item.filters.forEach(filter => {
                if (filter.multiply !== undefined) {
                  multiply = filter.multiply;
                }
              });
            } else if (item.lambda) {
              // Parse ESPHome lambdas e.g. "return (float)x * 0.01;"
              const match = item.lambda.match(/\*\s*([0-9.]+)/);
              if (match) {
                multiply = parseFloat(match[1]);
              }
            }
            
            // Reconstruct standard ESPHome ID if not explicitly specified
            const resolvedId = item.id || item.name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
            
            registers[item.address] = {
              name: item.name,
              id: resolvedId,
              address: item.address,
              type: item.register_type || 'read',
              value_type: item.value_type || 'U_WORD',
              unit: item.unit_of_measurement || '',
              multiplier: multiply,
              optionsmap: item.optionsmap || null
            };
            
            idToAddressMap[resolvedId] = item.address;
          }
        });
      };

      ['sensor', 'binary_sensor', 'number', 'select', 'switch'].forEach(extractFromSection);
      console.log(`[Parser] Loaded ${Object.keys(registers).length} registers and ${Object.keys(idToAddressMap).length} mappings from ${YAML_PATH}`);
    } else {
      console.warn(`[Parser] Register configuration file not found at ${YAML_PATH}`);
    }
  } catch (e) {
    console.error(`[Parser] Error reading register file:`, e.message);
  }
}

// Load registers initially
loadRegisters();

// Watch registers file for dynamic changes
if (fs.existsSync(YAML_PATH)) {
  fs.watchFile(YAML_PATH, () => {
    console.log(`[Parser] File ${YAML_PATH} changed, reloading registers...`);
    loadRegisters();
    broadcastToWebSockets({
      type: 'registers_reloaded',
      registers: registers
    });
  });
}

// Set up MQTT Authentication
aedes.authenticate = function (client, username, password, callback) {
  // If credentials are not specified in .env, allow everything
  if (!MQTT_USER) {
    return callback(null, true);
  }

  const clientPass = password ? password.toString('utf8') : '';
  const success = (username === MQTT_USER && clientPass === MQTT_PASSWORD);

  if (success) {
    console.log(`[MQTT] Client authenticated successfully: ${client.id}`);
    callback(null, true);
  } else {
    console.warn(`[MQTT] Authentication failed for client ${client.id}. Username: "${username}", Password: "${clientPass}"`);
    // Create an auth failure error (Connection Refused, bad username/password)
    const err = new Error('Auth failure');
    err.returnCode = 4;
    callback(err, null);
    
    // Notify frontend of failed auth attempt
    broadcastToWebSockets({
      type: 'auth_failed',
      clientId: client.id,
      username: username,
      password: clientPass,
      timestamp: new Date().toISOString()
    });
  }
};

// Track MQTT Connections
aedes.on('client', function (client) {
  console.log(`[MQTT] Client connected: ${client.id}`);
  broadcastToWebSockets({
    type: 'client_connected',
    clientId: client.id,
    ip: client.conn.remoteAddress || 'unknown',
    timestamp: new Date().toISOString()
  });
});

aedes.on('clientDisconnect', function (client) {
  console.log(`[MQTT] Client disconnected: ${client.id}`);
  broadcastToWebSockets({
    type: 'client_disconnected',
    clientId: client.id,
    timestamp: new Date().toISOString()
  });
});

// Decode received telemetry packets
function decodeTelemetry(data) {
  const decoded = {};
  for (const [key, value] of Object.entries(data)) {
    const address = parseInt(key, 10);
    const reg = registers[address];
    if (reg) {
      let decodedValue = value;
      if (typeof value === 'number') {
        decodedValue = parseFloat((value * reg.multiplier).toFixed(3));
      }
      decoded[key] = {
        address: address,
        name: reg.name,
        rawValue: value,
        decodedValue: decodedValue,
        unit: reg.unit,
        type: reg.type,
        value_type: reg.value_type
      };
    } else {
      decoded[key] = {
        address: address,
        name: `Register ${key}`,
        rawValue: value,
        decodedValue: value,
        unit: '',
        type: 'unknown',
        value_type: 'unknown'
      };
    }
  }
  return decoded;
}

// Track MQTT publishes
aedes.on('publish', function (packet, client) {
  const topic = packet.topic;
  const payloadStr = packet.payload.toString('utf8');
  const clientId = client ? client.id : 'broker';

  // Do not log internal Aedes system statistics
  if (topic.startsWith('$SYS/')) return;

  // Broadcast raw publish event to WebSockets
  broadcastToWebSockets({
    type: 'publish',
    clientId: clientId,
    topic: topic,
    payload: payloadStr,
    timestamp: new Date().toISOString()
  });

  const normalizedTopic = topic.startsWith('/') ? topic.substring(1) : topic;

  // Handle telemetry topic
  if (normalizedTopic === 'antigravity/inverter/telemetry') {
    const logLine = `[${new Date().toISOString()}] ${payloadStr}\n`;
    fs.appendFileSync('./logs/mqtt_raw_telemetry.log', logLine);

    try {
      const data = JSON.parse(payloadStr);
      const decoded = decodeTelemetry(data);
      
      broadcastToWebSockets({
        type: 'telemetry_decoded',
        raw: data,
        decoded: decoded,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      console.warn(`[Telemetry] Failed to parse JSON: ${payloadStr}`);
      broadcastToWebSockets({
        type: 'telemetry_error',
        error: `Invalid JSON payload: ${e.message}`,
        raw: payloadStr,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Handle ESPHome individual sensor state topics
  // Format: "sandisolar-controller/sensor/<sensor_id>/state"
  // Also matches binary_sensor, number, select, switch states
  const esphomeMatch = normalizedTopic.match(/^sandisolar-controller\/(sensor|binary_sensor|number|select|switch)\/([a-z0-9_]+)\/state$/);
  if (esphomeMatch) {
    const sensorId = esphomeMatch[2];
    const address = idToAddressMap[sensorId];
    if (address !== undefined) {
      const reg = registers[address];
      let rawValue = null;

      // Parse state payload
      if (payloadStr === 'ON' || payloadStr === 'true') {
        rawValue = 1;
      } else if (payloadStr === 'OFF' || payloadStr === 'false') {
        rawValue = 0;
      } else {
        const parsedVal = parseFloat(payloadStr);
        if (!isNaN(parsedVal)) {
          rawValue = parsedVal;
        } else if (reg.optionsmap && reg.optionsmap[payloadStr] !== undefined) {
          rawValue = reg.optionsmap[payloadStr];
        }
      }

      if (rawValue !== null && !isNaN(rawValue)) {
        // Calculate raw register value by reverse multiplying (e.g. 53.6V / 0.1 multiplier = 536 raw)
        const rawRegisterValue = Math.round(rawValue / reg.multiplier);
        
        const rawTelemetry = { [address]: rawRegisterValue };
        const decoded = {
          [address]: {
            address: address,
            name: reg.name,
            rawValue: rawRegisterValue,
            decodedValue: rawValue,
            unit: reg.unit,
            type: reg.type,
            value_type: reg.value_type
          }
        };

        broadcastToWebSockets({
          type: 'telemetry_decoded',
          raw: rawTelemetry,
          decoded: decoded,
          timestamp: new Date().toISOString()
        });
      }
    }
  }
});

// Set up Express and WebSocket server
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve public static folder
app.use(express.static(path.join(__dirname, 'public')));

// Store WebSocket clients
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  
  // Send registers database and configs upon connection
  ws.send(JSON.stringify({
    type: 'init',
    registers: registers,
    config: {
      mqttPort: MQTT_PORT,
      mqttUser: MQTT_USER,
      mqttPassword: MQTT_PASSWORD,
      webPort: WEB_PORT,
      brokerIp: process.env.BROKER_IP || ''
    }
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'publish_command') {
        const { topic, payload } = data;
        let packetPayload;
        
        if (typeof payload === 'object') {
          packetPayload = JSON.stringify(payload);
        } else {
          packetPayload = String(payload);
        }

        const targetTopic = topic || 'antigravity/inverter/command';
        const altTopic = targetTopic.startsWith('/') ? targetTopic.substring(1) : '/' + targetTopic;

        // Publish to primary topic
        aedes.publish({
          topic: targetTopic,
          payload: packetPayload,
          qos: 0,
          retain: false
        });

        // Publish to alternative topic
        aedes.publish({
          topic: altTopic,
          payload: packetPayload,
          qos: 0,
          retain: false
        }, (err) => {
          if (err) {
            console.error('[MQTT] Command publish error:', err.message);
            ws.send(JSON.stringify({
              type: 'command_status',
              success: false,
              error: err.message
            }));
          } else {
            console.log(`[MQTT] Published command to "${targetTopic}" and "${altTopic}": ${packetPayload}`);
            ws.send(JSON.stringify({
              type: 'command_status',
              success: true
            }));
          }
        });
      }
    } catch (err) {
      console.error('[WS] Message parsing error:', err.message);
    }
  });

  ws.on('close', () => {
    wsClients.delete(ws);
  });
});

function broadcastToWebSockets(data) {
  const message = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Start MQTT TCP Server
const mqttServer = net.createServer(aedes.handle);
mqttServer.listen(MQTT_PORT, '0.0.0.0', () => {
  console.log(`[MQTT] Broker is listening on port ${MQTT_PORT}`);
});

// Start Web Dashboard Server
server.listen(WEB_PORT, '0.0.0.0', () => {
  console.log(`[WEB] Dashboard server running at http://localhost:${WEB_PORT}`);
});
