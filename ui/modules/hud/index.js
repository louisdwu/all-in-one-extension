import { ConfigBridge } from '../../../libs/config_bridge.js';
import { showStatus } from '../../../libs/utils.js';

export function initHUDPanel() {
    const container = document.getElementById('ha-entity-list');
    const enableToggle = document.getElementById('hud-enable');
    
    // HUD Settings
    const els = {
        interval: document.getElementById('hud-carousel-interval'),
        // QWeather
        qwKey: document.getElementById('qw-key'),
        qwHost: document.getElementById('qw-host'),
        qwLocation: document.getElementById('qw-location'),
        qwRate: document.getElementById('qw-refresh-rate'),
        qwMetrics: {
            temp: document.getElementById('qw-metric-temp')
        },
        qwWarning: document.getElementById('qw-api-warning'),
        // WAQI
        waqiToken: document.getElementById('waqi-token'),
        waqiCity: document.getElementById('waqi-city'),
        waqiMetrics: {
            aqi: document.getElementById('waqi-metric-aqi'),
            o3: document.getElementById('waqi-metric-o3'),
            pm25: document.getElementById('waqi-metric-pm25'),
            pm10: document.getElementById('waqi-metric-pm10')
        },
        // HA
        haUrl: document.getElementById('ha-url'),
        haToken: document.getElementById('ha-token'),
        haRate: document.getElementById('ha-refresh-rate')
    };

    if (!container) return;

    // --- Dynamic API Usage Calculation ---
    function updateApiWarning() {
        if (!els.qwRate || !els.qwWarning) return;
        const intervalMins = parseFloat(els.qwRate.value) || 20;
        const callsPerDay = Math.ceil((24 * 60) / intervalMins);
        
        const qwActive = els.qwMetrics.temp?.checked && els.qwKey.value.trim() !== '';
        
        if (qwActive) {
            let color = 'var(--text-color)';
            if (callsPerDay > 800) color = 'var(--warning)';
            if (callsPerDay >= 1000) color = 'var(--danger)';

            els.qwWarning.innerHTML = `(预估每日请求: <span style="color:${color}">${callsPerDay}</span> 次)`;
        } else {
             els.qwWarning.innerHTML = '';
        }
    }

    // --- HA Entity List Management ---
    function addHARow(name = '', id = '') {
        const item = document.createElement('div');
        item.className = 'entity-item';
        item.innerHTML = `
            <input type="text" class="e-name" placeholder="显示简称 (例: 功率)" value="${name}" style="flex:1;">
            <input type="text" class="e-id" placeholder="Entity ID (例: sensor.power)" value="${id}" style="flex:2;">
            <button class="danger btn-remove">移除</button>
        `;
        item.querySelector('.btn-remove').addEventListener('click', () => {
            item.remove();
            autoSaveHUD();
        });

        item.querySelectorAll('input').forEach(input => {
            input.addEventListener('change', autoSaveHUD);
        });

        container.appendChild(item);
    }

    function getHAEntities() {
        const entities = [];
        container.querySelectorAll('.entity-item').forEach(el => {
            const name = el.querySelector('.e-name').value.trim();
            const id = el.querySelector('.e-id').value.trim().replace(/[\s\r\n]/g, '');
            if (id) entities.push({ name: name || id, id });
        });
        return entities;
    }

    document.getElementById('ha-add-entity')?.addEventListener('click', () => {
        addHARow();
        autoSaveHUD();
    });

    // --- Save & Sync Logic ---
    function autoSaveHUD() {
        updateApiWarning();

        const config = {
            hudEnabled: enableToggle.checked,
            hudCarouselInterval: parseInt(els.interval.value),
            
            qwKey: els.qwKey.value.trim(),
            qwHost: els.qwHost.value.trim().replace(/^https?:\/\//, '').replace(/\/$/, ''),
            qwLocation: els.qwLocation.value.trim(),
            qwRefreshRate: parseFloat(els.qwRate.value),
            qwMetrics: {
                temp: els.qwMetrics.temp.checked
            },

            waqiToken: els.waqiToken.value.trim(),
            waqiCity: els.waqiCity.value.trim(),
            waqiMetrics: {
                aqi: els.waqiMetrics.aqi.checked,
                o3: els.waqiMetrics.o3.checked,
                pm25: els.waqiMetrics.pm25.checked,
                pm10: els.waqiMetrics.pm10.checked
            },

            haUrl: els.haUrl.value.trim().replace(/\/$/, ""),
            haToken: els.haToken.value.trim(),
            haRefreshRate: parseFloat(els.haRate.value),
            haEntities: getHAEntities()
        };

        ConfigBridge.set(config).then(() => {
            ConfigBridge.sendMessage({ type: "UPDATE_HUD_CONFIG" });
            const dbHud = document.getElementById('db-hud-enable');
            if (dbHud) dbHud.checked = enableToggle.checked;
        });
    }

    // Attach Listeners
    enableToggle?.addEventListener('change', autoSaveHUD);
    [els.interval, els.qwRate, els.haRate].forEach(el => el?.addEventListener('change', autoSaveHUD));
    
    // QW Metrics
    Object.values(els.qwMetrics).forEach(el => el?.addEventListener('change', autoSaveHUD));
    // WAQI Metrics
    Object.values(els.waqiMetrics).forEach(el => el?.addEventListener('change', autoSaveHUD));

    let debounceTimer;
    [els.qwKey, els.qwHost, els.qwLocation, els.waqiToken, els.waqiCity, els.haUrl, els.haToken].forEach(el => {
        el?.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(autoSaveHUD, 1000);
        });
    });

    // Load initial state
    ConfigBridge.get({
        hudEnabled: true,
        hudCarouselInterval: 3,
        // QW
        qwKey: '', qwHost: '', qwLocation: '', qwRefreshRate: 20,
        qwMetrics: { temp: false },
        // WAQI
        waqiToken: '6562b075bbe15b2242ce4725a783f83d7696f385',
        waqiCity: 'guangzhou',
        waqiMetrics: { aqi: false, o3: true, pm25: false, pm10: false },
        // HA
        haUrl: '', haToken: '', haRefreshRate: 1, haEntities: []
    }).then((items) => {
        if (enableToggle) enableToggle.checked = items.hudEnabled;
        if (els.interval) els.interval.value = items.hudCarouselInterval;
        
        if (els.qwKey) els.qwKey.value = items.qwKey;
        if (els.qwHost) els.qwHost.value = items.qwHost || '';
        if (els.qwLocation) els.qwLocation.value = items.qwLocation;
        if (els.qwRate) els.qwRate.value = items.qwRefreshRate;
        
        if (els.qwMetrics.temp) els.qwMetrics.temp.checked = !!items.qwMetrics?.temp;

        if (els.waqiToken) els.waqiToken.value = items.waqiToken;
        if (els.waqiCity) els.waqiCity.value = items.waqiCity;
        if (els.waqiMetrics) {
            for (const [key, el] of Object.entries(els.waqiMetrics)) {
                if (el) el.checked = !!items.waqiMetrics?.[key];
            }
        }

        if (els.haUrl) els.haUrl.value = items.haUrl;
        if (els.haToken) els.haToken.value = items.haToken;
        if (els.haRate) els.haRate.value = items.haRefreshRate;

        container.innerHTML = '';
        items.haEntities.forEach(e => addHARow(e.name, e.id));
        
        updateApiWarning();
    });

    // Manual test trigger
    document.getElementById('hud-test')?.addEventListener('click', async () => {
        autoSaveHUD();
        ConfigBridge.sendMessage({ type: "TEST_HUD_FORCE_FETCH" }).then(res => {
            if (res && res.results) {
                const debugStr = JSON.stringify(res.results, null, 2);
                alert("HUD 抓取结果详情 (原始 JSON):\n\n" + debugStr + "\n\n如果看到 error 或 401/402，请检查 Key 或专属域名。");
            } else {
                showStatus('抓取完成，但未收到回传数据', 'warning');
            }
        });
        showStatus('数据抓取指令已发送...', 'success');
    });
}


