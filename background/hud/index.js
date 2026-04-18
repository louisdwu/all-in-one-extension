// === Main HUD service orchestrator (Classic Script) ===

const ALARM_WAQI = 'HUD_ALARM_WAQI';
const ALARM_HA = 'HUD_ALARM_HA';
const ALARM_CAROUSEL = 'HUD_ALARM_CAROUSEL';

// Cache keys for storage
const STORAGE_HUD_STATE = 'hudState';
const STORAGE_HUD_QUEUE = 'hudQueueKeys';
const STORAGE_HUD_INDEX = 'hudCarouselIndex';

// Fetch data from specified source
async function updateHUDData(source) {
    try {
        const settings = await chrome.storage.sync.get({
            hudEnabled: true,
            waqiToken: '', waqiCity: '', waqiMetrics: {},
            haUrl: '', haToken: '', haEntities: []
        });

        if (!settings.hudEnabled) return {};

        let newResults = {};
        if (source === 'WAQI' || source === 'FULL') {
            const waqiData = await fetchWAQIData(settings);
            newResults = { ...newResults, ...waqiData };
        }
        if (source === 'HA' || source === 'FULL') {
            const haData = await fetchHAEntities(settings);
            newResults = { ...newResults, ...haData };
        }

        const data = await chrome.storage.local.get([STORAGE_HUD_STATE]);
        const oldState = data[STORAGE_HUD_STATE] || {};
        const newState = { ...oldState, ...newResults };

        const hudQueueKeys = [];
        
        // WAQI (All Metrics)
        if (settings.waqiMetrics) {
            const waqiKeys = ['aqi', 'o3', 'pm25', 'pm10', 'no2', 'so2', 'co', 't', 'h', 'p', 'w'];
            waqiKeys.forEach(key => {
                const fullKey = `waqi_${key}`;
                if (settings.waqiMetrics[key] && newState[fullKey]) {
                    hudQueueKeys.push(fullKey);
                }
            });
        }

        settings.haEntities.forEach(e => {
            const key = `ha_${e.id.replace(/[\s\r\n]/g, '')}`;
            if (newState[key]) hudQueueKeys.push(key);
        });

        await chrome.storage.local.set({ 
            [STORAGE_HUD_STATE]: newState, 
            [STORAGE_HUD_QUEUE]: hudQueueKeys 
        });

        showCurrentHUDCarouselItem();
        return newResults;
    } catch (err) {
        console.error('updateHUDData failed:', err);
        return { error: { value: '!CRSH', raw: err.message } };
    }
}

async function showCurrentHUDCarouselItem() {
    const data = await chrome.storage.local.get([STORAGE_HUD_STATE, STORAGE_HUD_QUEUE, STORAGE_HUD_INDEX]);
    const settings = await chrome.storage.sync.get({ hudIconRound: true });
    
    const state = data[STORAGE_HUD_STATE] || {};
    const queue = data[STORAGE_HUD_QUEUE] || [];
    let index = data[STORAGE_HUD_INDEX] || 0;

    if (queue.length === 0) {
        updateExtensionIcon('--', '--', '#9E9E9E');
        return;
    }

    index = index % queue.length;
    const currentKey = queue[index];
    const currentData = state[currentKey];

    if(!currentData) {
        updateExtensionIcon('HUD', '...', '#03A9F4');
        return;
    }

    let bgColor = currentData.error ? '#9E9E9E' : '#03A9F4';
    if (!currentData.error) {
        if (currentKey.startsWith('waqi_')) {
            bgColor = '#673ab7'; // Deep Purple for WAQI
            // If it's an air pollutant, check thresholds
            if (currentKey.includes('aqi') || currentKey.includes('o3') || currentKey.includes('pm')) {
                const val = parseFloat(currentData.value);
                if (val > 100) bgColor = '#FF9800'; // Orange
                if (val > 150) bgColor = '#F44336'; // Red
            }
        } else if (currentKey.startsWith('ha_')) {
            bgColor = '#03A9F4'; // Blue for HA
        }
    }

    let displayValue = currentData.value;
    if (settings.hudIconRound !== false && !isNaN(parseFloat(displayValue))) {
        // If it's a number (or string number), round it for the icon
        const num = parseFloat(displayValue);
        displayValue = Math.round(num).toString();
    }

    updateExtensionIcon(currentData.name, displayValue, bgColor);
}

async function advanceHUDCarousel() {
    const data = await chrome.storage.local.get([STORAGE_HUD_QUEUE, STORAGE_HUD_INDEX]);
    const queue = data[STORAGE_HUD_QUEUE] || [];
    let index = (data[STORAGE_HUD_INDEX] || 0) + 1;
    
    if (queue.length > 0) {
        index = index % queue.length;
    } else {
        index = 0;
    }

    await chrome.storage.local.set({ [STORAGE_HUD_INDEX]: index });
    showCurrentHUDCarouselItem();
}

async function setupHUDAlarms() {
    const settings = await chrome.storage.sync.get({
        hudEnabled: true,
        waqiRefreshRate: 60,
        haRefreshRate: 1,
        hudCarouselInterval: 3
    });

    // Force clear all HUD-related alarms to prevent ghost timers from old versions
    const allAlarms = await chrome.alarms.getAll();
    for (const alarm of allAlarms) {
        if (alarm.name.startsWith('HUD_ALARM')) {
            await chrome.alarms.clear(alarm.name);
        }
    }

    if (!settings.hudEnabled) {
        chrome.action.setIcon({ path: { "16": "/icons/icon16.png", "48": "/icons/icon48.png", "128": "/icons/icon128.png" } });
        chrome.action.setTitle({ title: "HUD Monitor (已禁用)" });
        return;
    }

    // Create polling alarms
    chrome.alarms.create(ALARM_WAQI, { periodInMinutes: parseFloat(settings.waqiRefreshRate || 60) });
    chrome.alarms.create(ALARM_HA, { periodInMinutes: parseFloat(settings.haRefreshRate || 1) });

    // Rotation interval
    const carouselMinutes = parseInt(settings.hudCarouselInterval) / 60;
    chrome.alarms.create(ALARM_CAROUSEL, {
        periodInMinutes: Math.max(carouselMinutes, 1/60)
    });

    // First fetch
    updateHUDData('FULL');
}

function registerHUDEvents() {
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === ALARM_WAQI) updateHUDData('WAQI');
        else if (alarm.name === ALARM_HA) updateHUDData('HA');
        else if (alarm.name === ALARM_CAROUSEL) advanceHUDCarousel();
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'UPDATE_HUD_CONFIG') {
            chrome.storage.local.set({ [STORAGE_HUD_INDEX]: 0 });
            setupHUDAlarms();
            sendResponse({ success: true });
            return false; // Sync response
        }
        if (message.type === 'TEST_HUD_FORCE_FETCH') {
             chrome.storage.local.set({ [STORAGE_HUD_INDEX]: 0 });
             updateHUDData('FULL').then(results => {
                 sendResponse({ success: true, results, timestamp: Date.now() });
             }).catch(err => {
                 sendResponse({ success: false, error: err.message });
             });
             return true; // Keep channel open for async
        }
        
        // Not a HUD message, don't return anything (or return false)
        return false;
    });

    // Also listen to storage changes for hudEnabled etc to stop immediately
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync' && (changes.hudEnabled || changes.waqiRefreshRate || changes.haRefreshRate || changes.hudCarouselInterval)) {
             setupHUDAlarms();
        }
    });

    chrome.runtime.onInstalled.addListener(() => setupHUDAlarms());
    chrome.runtime.onStartup.addListener(() => setupHUDAlarms());
}
