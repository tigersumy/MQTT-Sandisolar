// Global state
let socket = null;
let registers = {};
let activeInverters = new Set();
let telemetryIntervalId = null;

// DOM Elements
const wsStatusPill = document.getElementById('ws-status');
const mqttStatusPill = document.getElementById('mqtt-status');
const brokerIpText = document.getElementById('broker-ip');
const brokerPortText = document.getElementById('broker-port');
const brokerUserText = document.getElementById('broker-user');
const brokerPassText = document.getElementById('broker-pass');

const cmdRegisterSelect = document.getElementById('cmd-register');
const customRegisterGroup = document.getElementById('custom-register-group');
const customRegisterInput = document.getElementById('custom-register-input');
const cmdValueInput = document.getElementById('cmd-value');
const cmdFormatSelect = document.getElementById('cmd-format');
const commandForm = document.getElementById('command-form');
const commandResult = document.getElementById('command-result');
const btnSend = document.getElementById('btn-send');

const searchInput = document.getElementById('register-search');
const telemetryBody = document.getElementById('telemetry-body');
const consoleLog = document.getElementById('console-log');
const btnClearConsole = document.getElementById('btn-clear-console');

// Default value mappings for dropdown
cmdRegisterSelect.addEventListener('change', () => {
  const selectedOption = cmdRegisterSelect.options[cmdRegisterSelect.selectedIndex];
  if (cmdRegisterSelect.value === 'custom') {
    customRegisterGroup.classList.remove('hidden');
    customRegisterInput.required = true;
    cmdValueInput.value = '';
  } else {
    customRegisterGroup.classList.add('hidden');
    customRegisterInput.required = false;
    const defaultVal = selectedOption.getAttribute('data-default');
    if (defaultVal !== null) {
      cmdValueInput.value = defaultVal;
    }
  }
});

// Clear console log
btnClearConsole.addEventListener('click', () => {
  consoleLog.innerHTML = '';
  addLogLine('System', 'Консоль очищено.', 'system-line');
});

// Search filter logic
searchInput.addEventListener('input', () => {
  const query = searchInput.value.toLowerCase().trim();
  const rows = telemetryBody.querySelectorAll('tr:not(.empty-row)');
  
  rows.forEach(row => {
    const address = row.getAttribute('data-address') || '';
    const name = row.getAttribute('data-name') || '';
    if (address.includes(query) || name.includes(query)) {
      row.classList.remove('hidden');
    } else {
      row.classList.add('hidden');
    }
  });
});

// Log printer helper
function addLogLine(type, text, className) {
  const time = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.className = `log-line ${className}`;
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = `[${time}]`;
  
  const contentSpan = document.createElement('span');
  contentSpan.textContent = text;
  
  line.appendChild(timeSpan);
  line.appendChild(contentSpan);
  consoleLog.appendChild(line);
  
  // Cap console log at 200 items to prevent performance degradation
  while (consoleLog.childNodes.length > 200) {
    consoleLog.removeChild(consoleLog.firstChild);
  }
  
  // Scroll to bottom
  const container = consoleLog.parentElement;
  container.scrollTop = container.scrollHeight;
}

// Establish WebSockets Connection
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  addLogLine('System', `Підключення до WebSocket за адресою: ${wsUrl}`, 'system-line');
  wsStatusPill.className = 'status-pill connecting';
  wsStatusPill.querySelector('.status-text').textContent = 'Підключення...';
  
  socket = new WebSocket(wsUrl);
  
  socket.onopen = () => {
    addLogLine('System', 'WebSocket успішно підключено.', 'system-line');
    wsStatusPill.className = 'status-pill connected';
    wsStatusPill.querySelector('.status-text').textContent = 'Активний';
    
    // Auto-detect broker IP address (using current hostname)
    const hostname = window.location.hostname;
    brokerIpText.textContent = hostname === 'localhost' || hostname === '127.0.0.1' ? 'Локальна IP сервера' : hostname;
  };
  
  socket.onclose = () => {
    addLogLine('System', 'WebSocket відключено. Спроба перепідключення за 3 секунди...', 'error-line');
    wsStatusPill.className = 'status-pill disconnected';
    wsStatusPill.querySelector('.status-text').textContent = 'Відключено';
    
    mqttStatusPill.className = 'status-pill disconnected';
    mqttStatusPill.querySelector('.status-text').textContent = 'Очікування...';
    activeInverters.clear();
    
    setTimeout(connectWebSocket, 3000);
  };
  
  socket.onerror = (error) => {
    addLogLine('System', `Помилка WebSocket: ${error.message || 'Невідома помилка'}`, 'error-line');
  };
  
  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWebSocketMessage(msg);
    } catch (e) {
      console.error('Помилка при розборі WS повідомлення:', e);
    }
  };
}

// WebSocket Message router
function handleWebSocketMessage(msg) {
  switch (msg.type) {
    case 'init':
      registers = msg.registers;
      addLogLine('System', `Отримано словник регістрів від бекенду (${Object.keys(registers).length} штук).`, 'system-line');
      
      // Load configurations
      if (msg.config) {
        brokerPortText.textContent = msg.config.mqttPort || '1883';
        brokerUserText.textContent = msg.config.mqttUser || 'sandisolar_inv';
        brokerPassText.textContent = '••••••••'; // keep password masked in UI
        if (msg.config.brokerIp) {
          brokerIpText.textContent = msg.config.brokerIp;
        }
      }
      
      // Initialize or rebuild table layout structure based on registers database
      buildInitialTable();
      break;
      
    case 'registers_reloaded':
      registers = msg.registers;
      addLogLine('System', `Словник регістрів оновлено гарячим перезавантаженням.`, 'system-line');
      buildInitialTable();
      break;
      
    case 'client_connected':
      addLogLine('MQTT', `Клієнт підключився: ID = ${msg.clientId} (IP: ${msg.ip})`, 'conn-line');
      activeInverters.add(msg.clientId);
      updateInverterStatus();
      break;
      
    case 'client_disconnected':
      addLogLine('MQTT', `Клієнт відключився: ID = ${msg.clientId}`, 'disconn-line');
      activeInverters.delete(msg.clientId);
      updateInverterStatus();
      break;
      
    case 'auth_failed':
      addLogLine('MQTT', `СПРОБА ВХОДУ ВІДХИЛЕНА: Client ID = ${msg.clientId}, User = "${msg.username}", Password = "${msg.password}"`, 'error-line');
      break;
      
    case 'publish':
      // Print general MQTT pub logs (avoiding printing too much spam in terminal logs)
      if (msg.topic !== 'antigravity/inverter/telemetry') {
        addLogLine('MQTT', `[${msg.clientId}] Topic: "${msg.topic}" -> Payload: ${msg.payload}`, 'pub-line');
      }
      break;
      
    case 'telemetry_decoded':
      addLogLine('Telemetry', `Отримано пакет телеметрії. Ключів: ${Object.keys(msg.raw).length}`, 'telemetry-log-line');
      updateTelemetryTable(msg.decoded);
      break;
      
    case 'telemetry_error':
      addLogLine('Telemetry', `Помилка телеметрії: ${msg.error} | Payload: ${msg.raw}`, 'error-line');
      break;
      
    case 'command_status':
      btnSend.disabled = false;
      if (msg.success) {
        showCommandFeedback(true, 'Команда успішно опублікована в MQTT брокер!');
      } else {
        showCommandFeedback(false, `Помилка публікації команди: ${msg.error}`);
      }
      break;
  }
}

// Update Inverter status display dot
function updateInverterStatus() {
  if (activeInverters.size > 0) {
    mqttStatusPill.className = 'status-pill connected';
    // Join names of connected client IDs
    mqttStatusPill.querySelector('.status-text').textContent = Array.from(activeInverters).join(', ');
  } else {
    mqttStatusPill.className = 'status-pill disconnected';
    mqttStatusPill.querySelector('.status-text').textContent = 'Очікування...';
  }
}

// Pre-build empty table with all known register rows (sorted by address)
function buildInitialTable() {
  const sortedAddresses = Object.keys(registers).map(Number).sort((a, b) => a - b);
  
  if (sortedAddresses.length === 0) {
    telemetryBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">
          <div class="waiting-telemetry">
            <p>Немає налаштованих регістрів</p>
            <span class="sub">Перевірте файл конфігурації yml</span>
          </div>
        </td>
      </tr>`;
    return;
  }

  // Preserve any row values if we already got them
  const currentValues = {};
  telemetryBody.querySelectorAll('tr:not(.empty-row)').forEach(row => {
    const addr = row.getAttribute('data-address');
    const valText = row.querySelector('.val-cell').textContent;
    const rawText = row.querySelector('.raw-cell').textContent;
    const timeText = row.querySelector('.time-cell').textContent;
    const flashClass = row.classList.contains('flash-update');
    
    currentValues[addr] = { valText, rawText, timeText, flashClass };
  });

  let html = '';
  sortedAddresses.forEach(addr => {
    const reg = registers[addr];
    const prev = currentValues[addr];
    
    const valVal = prev ? prev.valText : '--';
    const rawVal = prev ? prev.rawText : '--';
    const timeVal = prev ? prev.timeText : 'Ніколи';
    const flashAttr = prev && prev.flashClass ? 'class="flash-update"' : '';
    
    // Friendly register type name
    let typeName = reg.type === 'holding' ? 'Holding (R/W)' : 'Input (Read)';
    if (reg.value_type) {
      typeName += ` [${reg.value_type}]`;
    }

    html += `
      <tr id="reg-row-${addr}" data-address="${addr}" data-name="${reg.name.toLowerCase()}" ${flashAttr}>
        <td class="col-addr">${addr}</td>
        <td class="col-name">${reg.name}</td>
        <td class="col-val val-cell">${valVal}</td>
        <td class="col-raw raw-cell">${rawVal}</td>
        <td class="col-type">${typeName}</td>
        <td class="col-time time-cell" data-timestamp="${prev ? (prev.timeText === 'Ніколи' ? 0 : Date.now()) : 0}">${timeVal}</td>
      </tr>`;
  });

  telemetryBody.innerHTML = html;
  
  // Re-apply search filter if any
  searchInput.dispatchEvent(new Event('input'));
}

// Update telemetry table upon packet decoding
function updateTelemetryTable(decoded) {
  // Check if we still have the waiting state row
  const emptyRow = telemetryBody.querySelector('.empty-row');
  if (emptyRow) {
    buildInitialTable();
  }

  const now = Date.now();

  for (const [key, regInfo] of Object.entries(decoded)) {
    const address = regInfo.address;
    let row = document.getElementById(`reg-row-${address}`);
    
    // If the register was not pre-configured, create a dynamic row at the end
    if (!row) {
      addDynamicRegisterRow(regInfo);
      row = document.getElementById(`reg-row-${address}`);
    }
    
    if (row) {
      const valCell = row.querySelector('.val-cell');
      const rawCell = row.querySelector('.raw-cell');
      const timeCell = row.querySelector('.time-cell');
      
      const newValStr = regInfo.decodedValue !== undefined ? `${regInfo.decodedValue} ${regInfo.unit}`.trim() : '--';
      const newRawStr = regInfo.rawValue !== undefined ? String(regInfo.rawValue) : '--';
      
      // Trigger flash animation if the value actually changed
      if (valCell.textContent !== newValStr || rawCell.textContent !== newRawStr) {
        row.classList.remove('flash-update');
        void row.offsetWidth; // Trigger reflow to restart animation
        row.classList.add('flash-update');
      }
      
      valCell.textContent = newValStr;
      rawCell.textContent = newRawStr;
      timeCell.textContent = 'Щойно';
      timeCell.setAttribute('data-timestamp', String(now));
    }
  }
}

// Handle unknown / ad-hoc registers that come in telemetry
function addDynamicRegisterRow(regInfo) {
  const address = regInfo.address;
  const tr = document.createElement('tr');
  tr.id = `reg-row-${address}`;
  tr.setAttribute('data-address', String(address));
  tr.setAttribute('data-name', regInfo.name.toLowerCase());
  
  tr.innerHTML = `
    <td class="col-addr">${address}</td>
    <td class="col-name text-secondary"><em>* ${regInfo.name}</em></td>
    <td class="col-val val-cell">--</td>
    <td class="col-raw raw-cell">--</td>
    <td class="col-type text-muted">Невідомий</td>
    <td class="col-time time-cell" data-timestamp="0">Ніколи</td>
  `;
  
  // Append dynamically. It would be cleaner to insert in sorted order
  let inserted = false;
  const rows = Array.from(telemetryBody.querySelectorAll('tr:not(.empty-row)'));
  for (const existingRow of rows) {
    const existingAddr = parseInt(existingRow.getAttribute('data-address'), 10);
    if (existingAddr > address) {
      telemetryBody.insertBefore(tr, existingRow);
      inserted = true;
      break;
    }
  }
  
  if (!inserted) {
    telemetryBody.appendChild(tr);
  }
}

// Timer to increment elapsed update times (e.g. "5с тому", "1хв тому")
function startUpdateTimers() {
  if (telemetryIntervalId) clearInterval(telemetryIntervalId);
  
  telemetryIntervalId = setInterval(() => {
    const now = Date.now();
    const timeCells = telemetryBody.querySelectorAll('.time-cell');
    
    timeCells.forEach(cell => {
      const ts = parseInt(cell.getAttribute('data-timestamp') || '0', 10);
      if (ts === 0) {
        cell.textContent = 'Ніколи';
        return;
      }
      
      const secondsAgo = Math.floor((now - ts) / 1000);
      if (secondsAgo < 5) {
        cell.textContent = 'Щойно';
      } else if (secondsAgo < 60) {
        cell.textContent = `${secondsAgo}с тому`;
      } else {
        const minutesAgo = Math.floor(secondsAgo / 60);
        cell.textContent = `${minutesAgo}хв тому`;
      }
    });
  }, 1000);
}

// Form feedback notification helper
function showCommandFeedback(isSuccess, text) {
  commandResult.className = `command-result ${isSuccess ? 'success' : 'error'}`;
  commandResult.textContent = text;
  
  // Auto-hide feedback after 5 seconds
  setTimeout(() => {
    commandResult.style.display = 'none';
  }, 5000);
}

// Send Command form submit handler
commandForm.addEventListener('submit', (e) => {
  e.preventDefault();
  
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showCommandFeedback(false, 'Помилка: WebSocket з’єднання відсутнє.');
    return;
  }
  
  let register = cmdRegisterSelect.value;
  if (register === 'custom') {
    register = customRegisterInput.value;
  }
  
  const value = parseInt(cmdValueInput.value, 10);
  const format = cmdFormatSelect.value;
  
  if (!register || isNaN(value)) {
    showCommandFeedback(false, 'Заповніть номер регістра та числове значення.');
    return;
  }
  
  btnSend.disabled = true;
  commandResult.className = 'command-result info';
  commandResult.style.display = 'block';
  commandResult.textContent = 'Відправка команди...';
  
  // Format payload according to user selection
  let payload;
  if (format === 'json_kv') {
    payload = { [register]: value };
  } else if (format === 'json_detailed') {
    payload = { register: parseInt(register, 10), value: value };
  } else if (format === 'raw_number') {
    payload = value;
  } else if (format === 'raw_string') {
    payload = String(value);
  }
  
  addLogLine('System', `Публікація команди: Регістр ${register} = ${value} (Формат: ${format})`, 'system-line');
  
  socket.send(JSON.stringify({
    type: 'publish_command',
    topic: 'antigravity/inverter/command',
    payload: payload
  }));
});

// App Start
connectWebSocket();
startUpdateTimers();
