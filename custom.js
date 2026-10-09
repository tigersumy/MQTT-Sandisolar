document.addEventListener('DOMContentLoaded', () => {
  // Create dashboard wrapper
  const root = document.createElement('div');
  root.id = 'custom-dashboard';
  document.body.appendChild(root);

  // Global State Storage
  const entityStates = {};

  // Group Configurations
  const batteryParams = [
    { id: 'sensor-battery_voltage', name: 'Напруга акумулятора', unit: 'V' },
    { id: 'sensor-battery_current', name: 'Струм акумулятора', unit: 'A' },
    { id: 'sensor-battery_soc', name: 'Рівень заряду (SOC)', unit: '%' },
    { id: 'sensor-battery_soh', name: 'Здоров\'я АКБ (SOH)', unit: '%' },
    { id: 'sensor-bms_battery_temperature', name: 'Температура BMS', unit: '°C' },
    { id: 'sensor-bms_max_allowed_charge_current', name: 'Макс. струм заряду BMS', unit: 'A' },
    { id: 'sensor-bms_max_allowed_discharge_current', name: 'Макс. струм розряду BMS', unit: 'A' },
    { id: 'number-battery_constant_charge_voltage', name: 'Напруга постійного заряду', type: 'number', min: 48, max: 64, step: 0.1, unit: 'V' },
    { id: 'number-battery_float_voltage', name: 'Напруга підзарядки (Float)', type: 'number', min: 48, max: 60, step: 0.1, unit: 'V' },
    { id: 'number-battery_max_charge_current', name: 'Макс. загальний струм заряду', type: 'number', min: 5, max: 100, step: 1, unit: 'A' },
    { id: 'number-ac_grid_charge_current', name: 'Макс. струм заряду від мережі', type: 'number', min: 2, max: 80, step: 1, unit: 'A' },
    { id: 'number-boost_charge_max_time', name: 'Макс. час форсованого заряду', type: 'number', min: 10, max: 600, step: 10, unit: 'min' },
    { id: 'number-battery_stop_discharge_voltage', name: 'Поріг зупинки розряду АКБ', type: 'number', min: 40, max: 54, step: 0.1, unit: 'V' },
    { id: 'number-battery_under_voltage_alarm', name: 'Попередження про розряд АКБ', type: 'number', min: 40, max: 54, step: 0.1, unit: 'V' },
    { id: 'number-battery_under_voltage_cut_off', name: 'Критичне відключення АКБ', type: 'number', min: 38, max: 50, step: 0.1, unit: 'V' },
    { id: 'number-battery_to_ac_voltage_discharge_limit', name: 'Поріг переходу на AC мережу', type: 'number', min: 42, max: 56, step: 0.1, unit: 'V' }
  ];

  const inverterParams = [
    { id: 'select-charge_priority_select', name: 'Пріоритет зарядки (SNU/CU/SU/OSP)', type: 'select', options: ['SNU', 'Only Solar', 'Solar and Utility', 'Solar or Utility'] },
    { id: 'select-output_priority_select', name: 'Пріоритет виходу (SBU/SUB/UTI)', type: 'select', options: ['SBU', 'SUB', 'Utility First'] },
    { id: 'select-inverter_bms_work_mode', name: 'Режим роботи з BMS', type: 'select', options: ['CAN Bus', 'RS485'] },
    { id: 'select-inverter_ac_input_type', name: 'Тип входу мережі', type: 'select', options: ['UPS', 'APL'] },
    { id: 'number-off_grid_discharge_stop_soc', name: 'Off-Grid: Зупинка розряду SOC', type: 'number', min: 5, max: 90, step: 1, unit: '%' },
    { id: 'number-off_grid_discharge_recovery_soc', name: 'Off-Grid: Відновлення розряду SOC', type: 'number', min: 10, max: 100, step: 1, unit: '%' },
    { id: 'number-on_grid_discharge_stop_soc', name: 'On-Grid: Зупинка розряду SOC', type: 'number', min: 5, max: 90, step: 1, unit: '%' },
    { id: 'number-on_grid_discharge_recovery_soc', name: 'On-Grid: Відновлення розряду SOC', type: 'number', min: 10, max: 100, step: 1, unit: '%' },
    { id: 'number-smart_load_off_soc', name: 'Smart Load: Поріг відключення SOC', type: 'number', min: 10, max: 90, step: 1, unit: '%' }
  ];

  const pvGenParams = [
    { id: 'sensor-pv1_voltage', name: 'PV Напруга', unit: 'V' },
    { id: 'sensor-pv1_current', name: 'PV Струм', unit: 'A' },
    { id: 'sensor-pv1_power', name: 'PV Потужність', unit: 'W' },
    { id: 'sensor-solar_generation_today', name: 'Сонячна генерація за сьогодні', unit: 'kWh' },
    { id: 'sensor-solar_generation_total', name: 'Загальна сонячна генерація', unit: 'kWh' },
    { id: 'sensor-generator_voltage', name: 'Напруга генератора', unit: 'V' },
    { id: 'sensor-generator_current', name: 'Струм генератора', unit: 'A' },
    { id: 'number-gen_input_rated_power', name: 'Номінальна потужність Gen Input', type: 'number', min: 0.1, max: 10.0, step: 0.1, unit: 'kW' },
    { id: 'switch-generator_auto_input_enable', name: 'Автозапуск генератора', type: 'switch' }
  ];

  const controlParams = [
    { id: 'switch-power_switch', name: 'Управління генерацією (Power Switch)', type: 'switch' },
    { id: 'binary_sensor-buzzer_status', name: 'Звуковий сигнал (Buzzer)', type: 'binary_sensor' },
    { id: 'switch-eco_mode_enable', name: 'Енергозберігаючий режим (ECO)', type: 'switch' },
    { id: 'switch-dual_channel_load_enable', name: 'Двоканальне навантаження', type: 'switch' },
    { id: 'switch-overload_auto_restart_enable', name: 'Автостарт при перевантаженні', type: 'switch' },
    { id: 'switch-overtemp_auto_restart_enable', name: 'Автостарт при перегріві', type: 'switch' },
    { id: 'binary_sensor-bluetooth_status', name: 'Статус Bluetooth', type: 'binary_sensor' }
  ];

  const diagnosticParams = [
    { id: 'sensor-boost_temp', name: 'Температура Boost', unit: '°C' },
    { id: 'sensor-inverter_temp', name: 'Температура інвертора', unit: '°C' },
    { id: 'sensor-temp_llc', name: 'Температура LLC', unit: '°C' },
    { id: 'text_sensor-inverter_cloud_connection_status', name: 'Зв\'язок з хмарою' },
    { id: 'text_sensor-inverter_logger_internal_comm_status', name: 'Внутрішній зв\'язок логера' },
    { id: 'text_sensor-parallel_mode', name: 'Режим паралельної роботи' },
    { id: 'sensor-total_operation_time', name: 'Загальний час роботи', unit: 'h' }
  ];

  // Render Skeleton Structure
  root.innerHTML = `
    <!-- Header -->
    <div class="dash-header">
      <div class="logo-section">
        <div class="logo-icon">SS</div>
        <div class="logo-title">
          <h1>SandiSolar Controller</h1>
          <p>Локальна консоль керування інвертором</p>
        </div>
      </div>
      <div class="connection-status">
        <div class="status-dot" id="status-dot"></div>
        <span id="status-text">Підключення...</span>
      </div>
    </div>

    <!-- Navigation -->
    <div class="dash-navigation">
      <button class="nav-tab active" data-tab="tab-overview">📊 Головна</button>
      <button class="nav-tab" data-tab="tab-battery">🔋 Батарея</button>
      <button class="nav-tab" data-tab="tab-inverter">⚡ Режими</button>
      <button class="nav-tab" data-tab="tab-pvgen">☀️ Сонце / Генератор</button>
      <button class="nav-tab" data-tab="tab-control">⚙️ Управління</button>
      <button class="nav-tab" data-tab="tab-diagnostics">🌡️ Діагностика</button>
      <button class="nav-tab" data-tab="tab-admin">🛠️ Сервіс</button>
    </div>

    <!-- Tab Content -->
    <div class="tab-content">
      <!-- 1. Overview Tab -->
      <div class="tab-pane active" id="tab-overview">
        <!-- Energy Flow Visualizer Card -->
        <div class="flow-diagram-card">
          <div class="flow-title">🔌 Динамічна схема енергетичного потоку</div>
          <div class="energy-flow-grid">
            
             <!-- SVGs for Animated Flow Connections -->
             <svg class="flow-svg-container" viewBox="0 0 800 260" preserveAspectRatio="none">
               <defs>
                 <!-- Градієнт Сонця -->
                 <linearGradient id="solar-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                   <stop offset="0%" stop-color="#ffb703" stop-opacity="0.3"/>
                   <stop offset="50%" stop-color="#fb8500" stop-opacity="1"/>
                   <stop offset="100%" stop-color="#ffb703" stop-opacity="0.3"/>
                 </linearGradient>
                 <!-- Градієнт Мережі -->
                 <linearGradient id="grid-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                   <stop offset="0%" stop-color="#3a86ff" stop-opacity="0.3"/>
                   <stop offset="50%" stop-color="#00f5d4" stop-opacity="1"/>
                   <stop offset="100%" stop-color="#3a86ff" stop-opacity="0.3"/>
                 </linearGradient>
                 <!-- Градієнт Батареї -->
                 <linearGradient id="bat-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                   <stop offset="0%" stop-color="#2d6a4f" stop-opacity="0.3"/>
                   <stop offset="50%" stop-color="#52b788" stop-opacity="1"/>
                   <stop offset="100%" stop-color="#2d6a4f" stop-opacity="0.3"/>
                 </linearGradient>
                 <!-- Градієнт Навантаження -->
                 <linearGradient id="load-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                   <stop offset="0%" stop-color="#7209b7" stop-opacity="0.3"/>
                   <stop offset="50%" stop-color="#b5179e" stop-opacity="1"/>
                   <stop offset="100%" stop-color="#7209b7" stop-opacity="0.3"/>
                 </linearGradient>
               </defs>
 
               <!-- Solar -> Inverter -->
               <path class="flow-track" d="M 210 65 C 290 65, 320 130, 400 130" />
               <path id="path-solar-inv" class="flow-particle solar-flow" d="M 210 65 C 290 65, 320 130, 400 130" />
 
               <!-- Grid -> Inverter -->
               <path class="flow-track" d="M 210 195 C 290 195, 320 130, 400 130" />
               <path id="path-grid-inv" class="flow-particle grid-flow" d="M 210 195 C 290 195, 320 130, 400 130" />
 
               <!-- Inverter -> Battery -->
               <path class="flow-track" d="M 400 130 C 480 130, 510 65, 590 65" />
               <path id="path-bat-inv" class="flow-particle bat-flow" d="M 400 130 C 480 130, 510 65, 590 65" />
 
               <!-- Inverter -> Load -->
               <path class="flow-track" d="M 400 130 C 480 130, 510 195, 590 195" />
               <path id="path-inv-load" class="flow-particle load-flow" d="M 400 130 C 480 130, 510 195, 590 195" />
             </svg>
             <!-- Solar Node -->
             <div class="flow-node" id="node-solar">
               <span class="node-icon">☀️</span>
               <span class="node-name">Сонячні панелі</span>
               <span class="node-value" id="flow-pv-power">0 W</span>
               <span class="node-sub" id="flow-pv-current">0.0 A</span>
             </div>
 
             <!-- Inverter Node (Center) -->
             <div class="flow-node" id="node-inverter">
               <span class="node-icon">⚡</span>
               <span class="node-name">Інвертор</span>
               <span class="node-value" id="flow-inv-mode">Waiting</span>
               <span class="node-sub" id="flow-inv-power-switch">Генерація: OFF</span>
             </div>
 
             <!-- Battery Node -->
             <div class="flow-node" id="node-battery">
               <span class="node-icon">🔋</span>
               <span class="node-name">Батарея</span>
               <span class="node-value" id="flow-bat-soc">0%</span>
               <span class="node-sub" id="flow-bat-volt">0.0 V</span>
             </div>
 
             <!-- Grid Node -->
             <div class="flow-node" id="node-grid">
               <span class="node-icon">🔌</span>
               <span class="node-name">Міська мережа</span>
               <span class="node-value" id="flow-grid-volt">0.0 V</span>
               <span class="node-sub" id="flow-grid-freq">0.00 Hz</span>
             </div>

            <!-- Load Node -->
            <div class="flow-node" id="node-load">
              <span class="node-icon">🏠</span>
              <span class="node-name">Навантаження</span>
              <span class="node-value" id="flow-load-power">0 W</span>
              <span class="node-sub" id="flow-load-current">0.0 A (EPS)</span>
            </div>

          </div>
        </div>

        <!-- Dashboard Cards Grid -->
        <div class="cards-grid">
          <div class="dash-card">
            <div class="card-header">
              <h2 class="card-title">🔌 Вхід мережі (Grid Info)</h2>
            </div>
            <div class="param-list" id="overview-grid-list"></div>
          </div>
          
          <div class="dash-card">
            <div class="card-header">
              <h2 class="card-title">🔋 Акумулятор (Battery Info)</h2>
            </div>
            <div class="param-list" id="overview-battery-list"></div>
          </div>

          <div class="dash-card">
            <div class="card-header">
              <h2 class="card-title">🏠 Вихід та споживання (Load Info)</h2>
            </div>
            <div class="param-list" id="overview-load-list"></div>
          </div>
        </div>
      </div>

      <!-- 2. Battery Management Tab -->
      <div class="tab-pane" id="tab-battery">
        <div class="cards-grid">
          <div class="dash-card">
            <div class="card-header"><h2 class="card-title">🔋 Поточні параметри АКБ</h2></div>
            <div class="param-list" id="battery-monitoring-list"></div>
          </div>
          <div class="dash-card">
            <div class="card-header"><h2 class="card-title">⚙️ Налаштування та ліміти заряду</h2></div>
            <div class="param-list" id="battery-settings-list"></div>
          </div>
        </div>
      </div>

      <!-- 3. Inverter Modes Tab -->
      <div class="tab-pane" id="tab-inverter">
        <div class="cards-grid">
          <div class="dash-card">
            <div class="card-header"><h2 class="card-title">⚡ Режими роботи та пріоритети</h2></div>
            <div class="param-list" id="inverter-modes-list"></div>
          </div>
          <div class="dash-card">
            <div class="card-header"><h2 class="card-title">📐 Пороги SOC (On-Grid / Off-Grid)</h2></div>
            <div class="param-list" id="inverter-soc-list"></div>
          </div>
        </div>
      </div>

      <!-- 4. PV & Generator Tab -->
      <div class="tab-pane" id="tab-pvgen">
        <div class="cards-grid">
          <div class="dash-card">
            <div class="card-header"><h2 class="card-title">☀️ Сонячна генерація (PV)</h2></div>
            <div class="param-list" id="pv-list"></div>
          </div>
          <div class="dash-card">
            <div class="card-header"><h2 class="card-title">🔌 Вхід генератора (Gen Input)</h2></div>
            <div class="param-list" id="gen-list"></div>
          </div>
        </div>
      </div>

      <!-- 5. Control Switches Tab -->
      <div class="tab-pane" id="tab-control">
        <div class="cards-grid">
          <div class="dash-card" style="grid-column: 1 / -1;">
            <div class="card-header"><h2 class="card-title">⚙️ Перемикачі та системні тригери</h2></div>
            <div class="param-list" id="control-list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;"></div>
          </div>
        </div>
      </div>

      <!-- 6. Diagnostics & Health Tab -->
      <div class="tab-pane" id="tab-diagnostics">
        <div class="cards-grid">
          <div class="dash-card">
            <div class="card-header"><h2 class="card-title">🌡️ Температурні показники</h2></div>
            <div class="param-list" id="diag-temp-list"></div>
          </div>
          <div class="dash-card">
            <div class="card-header"><h2 class="card-title">ℹ️ Статуси логера та зв'язку</h2></div>
            <div class="param-list" id="diag-comm-list"></div>
          </div>
        </div>
      </div>

      <!-- 7. Admin / System Tab -->
      <div class="tab-pane" id="tab-admin">
        <div class="cards-grid">
          <!-- Firmware OTA Update -->
          <div class="dash-card">
            <div class="card-header"><h2 class="card-title">🛠️ Оновлення ПЗ (OTA Firmware Update)</h2></div>
            <div class="ota-container">
              <p style="margin: 0 0 12px 0; font-size: 0.88rem; color: var(--text-secondary);">Виберіть відкомпілований файл прошивки (.bin) для завантаження на контролер.</p>
              <div class="ota-row">
                <input type="file" id="ota-file" class="custom-file-input" accept=".bin">
                <button class="btn-action secondary" id="btn-select-file">📁 Вибрати файл</button>
                <span id="file-name" style="font-size: 0.85rem; color: var(--text-muted);">Файл не вибрано</span>
                <button class="btn-action" id="btn-ota-upload" disabled>⚡ Оновити прошивку</button>
              </div>
              <div class="progress-bar-container" id="ota-progress-container">
                <div class="progress-bar-fill" id="ota-progress-fill"></div>
              </div>
              <p id="ota-status" style="margin: 8px 0 0 0; font-size: 0.85rem; color: var(--text-orange); display: none;"></p>
            </div>
          </div>

          <!-- Quick Actions / Mode select -->
          <div class="dash-card">
            <div class="card-header"><h2 class="card-title">🚀 Швидкі команди керування</h2></div>
            <div class="param-list">
              <div class="param-item">
                <span class="param-name">Увімкнути повну генерацію</span>
                <button class="btn-action" onclick="sendAction('switch', 'power_switch', 'turn_on')">Turn ON</button>
              </div>
              <div class="param-item">
                <span class="param-name">Вимкнути генерацію (Байпас)</span>
                <button class="btn-action secondary" onclick="sendAction('switch', 'power_switch', 'turn_off')">Turn OFF</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Live Developer Scrollable Logs -->
        <div class="dash-card log-terminal-card" style="margin-top: 24px;">
          <div class="terminal-header">
            <h2 class="card-title" style="margin:0;">📋 Системний журнал (Live Logs)</h2>
            <button class="btn-action secondary" id="btn-clear-logs" style="padding: 4px 10px; font-size: 0.75rem;">Clear</button>
          </div>
          <div class="terminal-body" id="log-terminal"></div>
        </div>
      </div>
    </div>
  `;

  // Dynamic Navigation Setup
  const tabs = document.querySelectorAll('.nav-tab');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      
      tab.classList.add('active');
      const activeTabId = tab.getAttribute('data-tab');
      document.getElementById(activeTabId).classList.add('active');
    });
  });

  // Render static groups
  renderListStructure(batteryParams, 'battery-monitoring-list', 'battery-settings-list');
  renderListStructure(inverterParams, 'inverter-modes-list', 'inverter-soc-list');
  renderListStructure(pvGenParams, 'pv-list', 'gen-list');
  renderListStructure(controlParams, 'control-list', 'control-list');
  renderListStructure(diagnosticParams, 'diag-temp-list', 'diag-comm-list');

  // Helper to split parameters inside groups between left & right cards
  function renderListStructure(params, targetLeftId, targetRightId) {
    const leftEl = document.getElementById(targetLeftId);
    const rightEl = document.getElementById(targetRightId);
    
    // Half split helper
    const splitIndex = Math.ceil(params.length / 2);
    
    params.forEach((param, index) => {
      const item = document.createElement('div');
      item.className = 'param-item';
      item.id = `wrapper-${param.id}`;
      
      let controlHtml = '';
      
      if (param.type === 'switch') {
        controlHtml = `
          <label class="switch-control">
            <input type="checkbox" id="input-${param.id}" onchange="toggleSwitch('${param.id}', this.checked)">
            <span class="slider-knob"></span>
          </label>
        `;
      } else if (param.type === 'binary_sensor') {
        controlHtml = `<span class="param-value" id="val-${param.id}">OFF</span>`;
      } else if (param.type === 'select') {
        const optionOpts = param.options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
        controlHtml = `
          <select class="custom-select" id="input-${param.id}" onchange="setSelect('${param.id}', this.value)">
            ${optionOpts}
          </select>
        `;
      } else if (param.type === 'number') {
        controlHtml = `
          <div class="slider-container">
            <input type="range" class="custom-range" id="input-${param.id}" min="${param.min}" max="${param.max}" step="${param.step}" oninput="updateSliderVal('${param.id}', this.value)" onchange="sendNumber('${param.id}', this.value)">
            <div class="slider-val-box" id="val-box-${param.id}">-</div>
            <span class="param-unit">${param.unit}</span>
          </div>
        `;
      } else {
        // Standard Read-only sensors
        controlHtml = `
          <div class="param-value-container">
            <span class="param-value" id="val-${param.id}">-</span>
            ${param.unit ? `<span class="param-unit">${param.unit}</span>` : ''}
          </div>
        `;
      }
      
      item.innerHTML = `
        <span class="param-name">${param.name}</span>
        ${controlHtml}
      `;
      
      // Split display logic
      if (targetLeftId === targetRightId) {
        leftEl.appendChild(item);
      } else {
        if (index < splitIndex) {
          leftEl.appendChild(item);
        } else {
          rightEl.appendChild(item);
        }
      }
    });
  }

  // Populate Dashboard lists (duplicate nodes for visualization in Overview tab)
  const overviewGridList = document.getElementById('overview-grid-list');
  const overviewBatteryList = document.getElementById('overview-battery-list');
  const overviewLoadList = document.getElementById('overview-load-list');

  // Append Grid cards inside Overview tab
  appendOverviewItem(overviewGridList, 'sensor-grid_voltage', 'Grid Voltage (Напруга мережі)', 'V');
  appendOverviewItem(overviewGridList, 'sensor-grid_current', 'Grid Current (Струм мережі)', 'A');
  appendOverviewItem(overviewGridList, 'sensor-grid_frequency', 'Grid Frequency (Частота)', 'Hz');

  appendOverviewItem(overviewBatteryList, 'sensor-battery_voltage', 'Battery Voltage (Напруга)', 'V');
  appendOverviewItem(overviewBatteryList, 'sensor-battery_current', 'Battery Current (Струм)', 'A');
  appendOverviewItem(overviewBatteryList, 'sensor-battery_soc', 'Battery SOC (Рівень)', '%');
  appendOverviewItem(overviewBatteryList, 'sensor-battery_soh', 'Battery SOH (Здоров\'я)', '%');

  appendOverviewItem(overviewLoadList, 'sensor-power_out_load', 'Active Load Power (Потужність)', 'W');
  appendOverviewItem(overviewLoadList, 'sensor-eps_current', 'EPS Current (Струм)', 'A');
  appendOverviewItem(overviewLoadList, 'sensor-inverter_status', 'Inverter Status (Статус)', '');

  function appendOverviewItem(parentEl, id, name, unit) {
    const item = document.createElement('div');
    item.className = 'param-item';
    item.innerHTML = `
      <span class="param-name">${name}</span>
      <div class="param-value-container">
        <span class="param-value" id="overview-val-${id}">-</span>
        ${unit ? `<span class="param-unit">${unit}</span>` : ''}
      </div>
    `;
    parentEl.appendChild(item);
  }

  // EventSource listener for ESPHome /events stream
  const eventSource = new EventSource('/events');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');

  eventSource.onopen = () => {
    statusDot.className = 'status-dot online';
    statusText.innerText = 'В мережі (Отримання...)';
    addTerminalLog('Connected to ESPHome EventSource successfully.', 'info');
  };

  eventSource.onerror = (e) => {
    statusDot.className = 'status-dot';
    statusText.innerText = 'Поза мережею (Помилка)';
    addTerminalLog('EventSource connection lost. Attempting reconnect...', 'error');
  };

  eventSource.addEventListener('state', (e) => {
    try {
      const data = JSON.parse(e.data);
      updateEntityState(data.id, data.state, data.value);
    } catch (err) {
      console.error('Error parsing SSE event data:', err);
    }
  });

  eventSource.addEventListener('log', (e) => {
    addTerminalLog(e.data, 'debug');
  });

  // Update Entity Value and UI dynamically
  function updateEntityState(id, stateText, val) {
    entityStates[id] = { state: stateText, value: val };
    
    // Update simple value labels
    const label = document.getElementById(`val-${id}`);
    if (label) {
      label.innerText = stateText;
      // Alert colors for critical items
      if (id === 'sensor-battery_soc') {
        const numericSoc = parseFloat(val);
        label.className = 'param-value';
        if (numericSoc <= 20) label.classList.add('val-alert-red');
        else if (numericSoc <= 50) label.classList.add('val-alert-orange');
        else label.classList.add('val-alert-green');
      }
    }

    // Update Overview duplicate labels
    const overviewLabel = document.getElementById(`overview-val-${id}`);
    if (overviewLabel) {
      overviewLabel.innerText = stateText;
    }

    // Update form controls based on type
    const toggleInput = document.getElementById(`input-${id}`);
    if (toggleInput) {
      if (id.startsWith('switch')) {
        toggleInput.checked = (stateText.toUpperCase() === 'ON' || val === true);
      } else if (id.startsWith('select')) {
        toggleInput.value = stateText;
      } else if (id.startsWith('number')) {
        toggleInput.value = val;
        const box = document.getElementById(`val-box-${id}`);
        if (box) box.innerText = val;
      }
    }

    // Update Dynamic Flow Diagram Values
    if (id === 'sensor-pv1_power') {
      document.getElementById('flow-pv-power').innerText = stateText;
      const numVal = parseFloat(val);
      const node = document.getElementById('node-solar');
      const path = document.getElementById('path-solar-inv');
      if (numVal > 10) {
        node.classList.add('active-solar');
        path.classList.add('active-solar');
      } else {
        node.classList.remove('active-solar');
        path.classList.remove('active-solar');
      }
    }
    
    if (id === 'sensor-pv1_current') {
      document.getElementById('flow-pv-current').innerText = `${stateText} A`;
    }

    if (id === 'sensor-battery_soc') {
      document.getElementById('flow-bat-soc').innerText = stateText;
      const numVal = parseFloat(val);
      const node = document.getElementById('node-battery');
      if (numVal <= 20) node.style.borderColor = 'var(--accent-red)';
      else if (numVal <= 50) node.style.borderColor = 'var(--accent-orange)';
      else node.style.borderColor = 'var(--accent-green)';
    }

    if (id === 'sensor-battery_voltage') {
      document.getElementById('flow-bat-volt').innerText = stateText;
    }

    if (id === 'sensor-battery_current') {
      const numVal = parseFloat(val);
      const path = document.getElementById('path-bat-inv');
      const node = document.getElementById('node-battery');
      
      path.classList.remove('active-battery-charge', 'active-battery-discharge');
      node.classList.remove('active-battery');
      
      if (numVal > 0.1) {
        // Charging
        node.classList.add('active-battery');
        path.classList.add('active-battery-charge');
      } else if (numVal < -0.1) {
        // Discharging
        node.classList.add('active-battery');
        path.classList.add('active-battery-discharge');
      }
    }

    if (id === 'sensor-grid_voltage') {
      document.getElementById('flow-grid-volt').innerText = stateText;
      const numVal = parseFloat(val);
      const node = document.getElementById('node-grid');
      const path = document.getElementById('path-grid-inv');
      if (numVal >= 100) {
        node.classList.add('active-grid');
        path.classList.add('active-grid');
      } else {
        node.classList.remove('active-grid');
        path.classList.remove('active-grid');
      }
    }

    if (id === 'sensor-grid_frequency') {
      document.getElementById('flow-grid-freq').innerText = stateText;
    }

    if (id === 'sensor-power_out_load') {
      document.getElementById('flow-load-power').innerText = stateText;
      const numVal = parseFloat(val);
      const node = document.getElementById('node-load');
      const path = document.getElementById('path-inv-load');
      if (numVal > 15) {
        node.classList.add('active-load');
        path.classList.add('active-load');
      } else {
        node.classList.remove('active-load');
        path.classList.remove('active-load');
      }
    }

    if (id === 'sensor-eps_current') {
      document.getElementById('flow-load-current').innerText = `${stateText} A (EPS)`;
    }

    if (id === 'text_sensor-inverter_mode' || id === 'sensor-inverter_status') {
      const modeEl = document.getElementById('flow-inv-mode');
      if (modeEl) {
        if (id === 'text_sensor-inverter_mode') {
          modeEl.innerText = stateText;
        } else if (modeEl.innerText === 'Waiting' || !isNaN(Number(modeEl.innerText))) {
          const statusMap = {
            0: 'Waiting',
            1: 'On-grid',
            2: 'Off-grid',
            3: 'Fault',
            4: 'Flashing',
            5: 'Bypass',
            6: 'Self-charge',
            7: 'Generator',
            255: 'SoftOFF (Вимкнено)'
          };
          modeEl.innerText = statusMap[parseInt(stateText, 10)] || stateText;
        }
      }
    }

    if (id === 'switch-power_switch') {
      document.getElementById('flow-inv-power-switch').innerText = `Генерація: ${stateText}`;
      const node = document.getElementById('node-inverter');
      if (stateText === 'ON') node.style.borderColor = 'var(--accent-blue)';
      else node.style.borderColor = 'var(--border-color)';
    }
  }

  // Slider visual response update
  window.updateSliderVal = (id, val) => {
    const box = document.getElementById(`val-box-${id}`);
    if (box) box.innerText = val;
  };

  // POST Control actions
  window.toggleSwitch = (id, isChecked) => {
    const action = isChecked ? 'turn_on' : 'turn_off';
    sendAction('switch', id, action);
  };

  window.setSelect = (id, option) => {
    sendAction('select', id, `set?option=${encodeURIComponent(option)}`);
  };

  window.sendNumber = (id, value) => {
    sendAction('number', id, `set?value=${value}`);
  };

  window.sendAction = (domain, id, action) => {
    // Strip prefix from ID if needed (ESPHome API paths do not need prefix)
    const entityName = id.replace(`${domain}-`, '');
    const url = `/${domain}/${entityName}/${action}`;
    
    addTerminalLog(`Sending command: POST ${url}`, 'info');
    
    fetch(url, { method: 'POST' })
      .then(res => {
        if (res.ok) {
          addTerminalLog(`Command executed successfully: ${url}`, 'info');
        } else {
          addTerminalLog(`Execution failed with status: ${res.status}`, 'error');
        }
      })
      .catch(err => {
        addTerminalLog(`Fetch connection error: ${err}`, 'error');
      });
  };

  // Scrolling logs implementation
  const logTerminal = document.getElementById('log-terminal');
  const btnClearLogs = document.getElementById('btn-clear-logs');
  
  btnClearLogs.addEventListener('click', () => {
    logTerminal.innerHTML = '';
  });

  function addTerminalLog(message, type = 'info') {
    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    
    const timeStr = new Date().toLocaleTimeString();
    line.innerText = `[${timeStr}] ${message}`;
    
    logTerminal.appendChild(line);
    logTerminal.scrollTop = logTerminal.scrollHeight;
    
    // Auto-prune terminal elements if exceeding 150 items
    if (logTerminal.children.length > 150) {
      logTerminal.removeChild(logTerminal.firstChild);
    }
  }

  // Firmware OTA Upload Implementation
  const otaFileInput = document.getElementById('ota-file');
  const btnSelectFile = document.getElementById('btn-select-file');
  const fileNameSpan = document.getElementById('file-name');
  const btnOtaUpload = document.getElementById('btn-ota-upload');
  const otaProgressContainer = document.getElementById('ota-progress-container');
  const otaProgressFill = document.getElementById('ota-progress-fill');
  const otaStatus = document.getElementById('ota-status');

  btnSelectFile.addEventListener('click', () => {
    otaFileInput.click();
  });

  otaFileInput.addEventListener('change', () => {
    if (otaFileInput.files.length > 0) {
      const file = otaFileInput.files[0];
      fileNameSpan.innerText = file.name;
      btnOtaUpload.disabled = false;
    } else {
      fileNameSpan.innerText = 'Файл не вибрано';
      btnOtaUpload.disabled = true;
    }
  });

  btnOtaUpload.addEventListener('click', () => {
    if (otaFileInput.files.length === 0) return;

    const file = otaFileInput.files[0];
    const formData = new FormData();
    formData.append('configuration', file);

    btnOtaUpload.disabled = true;
    btnSelectFile.disabled = true;
    otaProgressContainer.style.display = 'block';
    otaStatus.style.display = 'block';
    otaStatus.innerText = 'Завантаження прошивки...';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/update', true);

    // Track upload progress
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percentComplete = (e.loaded / e.total) * 100;
        otaProgressFill.style.width = percentComplete + '%';
        otaStatus.innerText = `Завантаження: ${Math.round(percentComplete)}%`;
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        otaStatus.innerText = '✅ Прошивка завантажена! Пристрій перезавантажується...';
        addTerminalLog('Firmware updated successfully! ESP32 is rebooting...', 'info');
        setTimeout(() => {
          window.location.reload();
        }, 12000);
      } else {
        otaStatus.innerText = `❌ Помилка оновлення: статус ${xhr.status}`;
        addTerminalLog(`Firmware upload failed: ${xhr.responseText}`, 'error');
        resetOtaUI();
      }
    };

    xhr.onerror = () => {
      otaStatus.innerText = '❌ Помилка з\'єднання при прошивці';
      addTerminalLog('OTA upload failed due to networking issues.', 'error');
      resetOtaUI();
    };

    xhr.send(formData);
  });

  function resetOtaUI() {
    btnSelectFile.disabled = false;
    btnOtaUpload.disabled = false;
    otaProgressContainer.style.display = 'none';
    otaProgressFill.style.width = '0%';
  }
});
