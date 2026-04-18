import { ConfigBridge } from '../../../libs/config_bridge.js';
import { showStatus } from '../../../libs/utils.js';

export function initHUDPanel() {
    const container = document.getElementById('ha-entity-list');
    const enableToggle = document.getElementById('hud-enable');
    
    // HUD Settings
    const els = {
        interval: document.getElementById('hud-carousel-interval'),
        // WAQI
        waqiToken: document.getElementById('waqi-token'),
        waqiCity: document.getElementById('waqi-city'),
        waqiRate: document.getElementById('waqi-refresh-rate'),
        waqiMetrics: {
            aqi: document.getElementById('waqi-metric-aqi'),
            o3: document.getElementById('waqi-metric-o3'),
            pm25: document.getElementById('waqi-metric-pm25'),
            pm10: document.getElementById('waqi-metric-pm10'),
            no2: document.getElementById('waqi-metric-no2'),
            so2: document.getElementById('waqi-metric-so2'),
            co: document.getElementById('waqi-metric-co'),
            t: document.getElementById('waqi-metric-t'),
            h: document.getElementById('waqi-metric-h'),
            p: document.getElementById('waqi-metric-p'),
            w: document.getElementById('waqi-metric-w')
        },
        // HA
        haUrl: document.getElementById('ha-url'),
        haToken: document.getElementById('ha-token'),
        haRate: document.getElementById('ha-refresh-rate')
    };

    if (!container) return;

    // --- Dynamic Display Logic ---
    function formatTime(timestamp) {
        if (!timestamp) return '从未';
        const date = new Date(timestamp);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        return `${y}-${m}-${d} ${h}:${min}:${s}`;
    }

    function updateHUDTimestamps(data = {}) {
        const waqiEl = document.getElementById('waqi-last-success-time');
        const haEl = document.getElementById('ha-last-success-time');
        if (waqiEl) waqiEl.textContent = formatTime(data.hudLastSuccessWaqi);
        if (haEl) haEl.textContent = formatTime(data.hudLastSuccessHa);
    }

    function updateHUDValueLabels(state = {}) {
        // 1. Update WAQI values
        const waqiKeys = ['aqi', 'o3', 'pm25', 'pm10', 'no2', 'so2', 'co', 't', 'h', 'p', 'w'];
        waqiKeys.forEach(key => {
            const el = document.getElementById(`val-waqi-${key}`);
            const data = state[`waqi_${key}`];
            if (el) {
                el.textContent = (data && data.value !== undefined) ? data.value : '--';
                if (data?.error) el.style.color = 'var(--danger)';
                else el.style.color = '';
            }
        });

        // 2. Update HA values
        container.querySelectorAll('.entity-item').forEach(row => {
            const idInput = row.querySelector('.e-id');
            const valEl = row.querySelector('.ha-val-tag');
            if (idInput && valEl) {
                const id = idInput.value.trim().replace(/[\s\r\n]/g, '');
                const data = state[`ha_${id}`];
                valEl.textContent = (data && data.value !== undefined) ? data.value : '--';
                if (data?.error) valEl.style.color = 'var(--danger)';
                else valEl.style.color = '';
            }
        });
    }

    // --- HA Entity List Management ---
    function addHARow(name = '', id = '') {
        const item = document.createElement('div');
        item.className = 'entity-item';
        const safeId = id.replace(/[\s\r\n]/g, '');
        item.innerHTML = `
            <input type="text" class="e-name" placeholder="显示简称 (例: 功率)" value="${name}" style="flex:1;">
            <input type="text" class="e-id" placeholder="Entity ID (例: sensor.power)" value="${id}" style="flex:2;">
            <span class="val-tag ha-val-tag" id="val-ha-${safeId}">--</span>
            <button class="danger btn-remove" style="padding: 4px 8px;">移除</button>
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
        const config = {
            hudEnabled: enableToggle.checked,
            hudCarouselInterval: parseInt(els.interval.value),
            hudIconRound: document.getElementById('hud-icon-round').checked,
            
            waqiToken: els.waqiToken.value.trim(),
            waqiCity: els.waqiCity.value.trim(),
            waqiRefreshRate: parseFloat(els.waqiRate.value),
            waqiMetrics: {
                aqi: els.waqiMetrics.aqi.checked,
                o3: els.waqiMetrics.o3.checked,
                pm25: els.waqiMetrics.pm25.checked,
                pm10: els.waqiMetrics.pm10.checked,
                no2: els.waqiMetrics.no2.checked,
                so2: els.waqiMetrics.so2.checked,
                co: els.waqiMetrics.co.checked,
                t: els.waqiMetrics.t.checked,
                h: els.waqiMetrics.h.checked,
                p: els.waqiMetrics.p.checked,
                w: els.waqiMetrics.w.checked
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
    document.getElementById('hud-icon-round')?.addEventListener('change', autoSaveHUD);
    [els.interval, els.haRate, els.waqiRate].forEach(el => el?.addEventListener('change', autoSaveHUD));
    
    // WAQI Metrics
    Object.values(els.waqiMetrics).forEach(el => el?.addEventListener('change', autoSaveHUD));

    let debounceTimer;
    [els.waqiToken, els.waqiCity, els.haUrl, els.haToken].forEach(el => {
        el?.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(autoSaveHUD, 1000);
        });
    });

    // --- Data Polling (Dashboard Sync) ---
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.hudState) {
            updateHUDValueLabels(changes.hudState.newValue);
        }
        if (changes.hudLastSuccessWaqi || changes.hudLastSuccessHa) {
            chrome.storage.local.get(['hudLastSuccessWaqi', 'hudLastSuccessHa']).then(data => {
                updateHUDTimestamps(data);
            });
        }
    });

    // Load initial state
    ConfigBridge.get({
        hudEnabled: true,
        hudCarouselInterval: 3,
        hudIconRound: true,
        // WAQI
        waqiToken: '6562b075bbe15b2242ce4725a783f83d7696f385',
        waqiCity: 'guangzhou',
        waqiRefreshRate: 60,
        waqiMetrics: { aqi: false, o3: true, pm25: false, pm10: false, no2: false, so2: false, co: false, t: false, h: false, p: false, w: false },
        // HA
        haUrl: '', haToken: '', haRefreshRate: 1, haEntities: []
    }).then((items) => {
        if (enableToggle) enableToggle.checked = items.hudEnabled;
        if (els.interval) els.interval.value = items.hudCarouselInterval;
        const iconRoundEl = document.getElementById('hud-icon-round');
        if (iconRoundEl) iconRoundEl.checked = items.hudIconRound !== false;
        
        if (els.waqiToken) els.waqiToken.value = items.waqiToken;
        if (els.waqiCity) els.waqiCity.value = items.waqiCity;
        if (els.waqiRate) els.waqiRate.value = items.waqiRefreshRate;
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

        // Initial Data Fetch for Labels & Timestamps
        chrome.storage.local.get(['hudState', 'hudLastSuccessWaqi', 'hudLastSuccessHa']).then(data => {
            updateHUDValueLabels(data.hudState || {});
            updateHUDTimestamps(data);
        });
    });

    // Manual test trigger
    document.getElementById('hud-test')?.addEventListener('click', async () => {
        autoSaveHUD();
        ConfigBridge.sendMessage({ type: "TEST_HUD_FORCE_FETCH" });
        showStatus('数据抓取指令已发送...', 'success');
    });
}


