// === Main HUD service orchestrator (Classic Script) ===

const ALARM_WAQI = 'HUD_ALARM_WAQI';
const ALARM_HA = 'HUD_ALARM_HA';
const ALARM_CAROUSEL = 'HUD_ALARM_CAROUSEL';
const ALARM_RETRY = 'HUD_ALARM_RETRY';

// Cache keys for storage
const STORAGE_HUD_STATE = 'hudState';
const STORAGE_HUD_QUEUE = 'hudQueueKeys';
const STORAGE_HUD_INDEX = 'hudCarouselIndex';
const STORAGE_HUD_LAST_WAQI = 'hudLastSuccessWaqi';
const STORAGE_HUD_LAST_HA = 'hudLastSuccessHa';
const STORAGE_HUD_WAQI_PUB_V = 'hudLastWaqiPubV';
const STORAGE_HUD_WAQI_PUB_S = 'hudLastWaqiPubS';
const STORAGE_HUD_WAQI_LAG = 'hudLastWaqiLag';

// Fetch data from specified source
// Fetch data from specified source
async function updateHUDData(source) {
    try {
        const settings = await chrome.storage.sync.get({
            hudEnabled: true,
            waqiToken: '', waqiCity: '', waqiMetrics: {}, waqiRefreshRate: 60,
            haUrl: '', haToken: '', haEntities: [], haRefreshRate: 1
        });

        if (!settings.hudEnabled) return {};

        let newResults = {};
        let waqiSuccess = false;
        let haSuccess = false;

        if (source === 'WAQI' || source === 'FULL') {
            const waqiData = await fetchWAQIData(settings);
            // Check if any waqi result is NOT an error
            waqiSuccess = Object.values(waqiData).some(v => v.error === false);
            newResults = { ...newResults, ...waqiData };
            
            if (waqiSuccess && waqiData._waqi_meta) {
                const meta = waqiData._waqi_meta;
                const old = await chrome.storage.local.get([STORAGE_HUD_WAQI_PUB_V]);
                
                if (old[STORAGE_HUD_WAQI_PUB_V] === meta.pubTs) {
                    console.log(`[HUD] WAQI data fetched but content timestamp unchanged (${meta.pubStr}).`);
                } else {
                    console.log(`[HUD] WAQI content updated: ${meta.pubStr}`);
                }

                await chrome.storage.local.set({ 
                    [STORAGE_HUD_LAST_WAQI]: Date.now(),
                    [STORAGE_HUD_WAQI_PUB_V]: meta.pubTs,
                    [STORAGE_HUD_WAQI_PUB_S]: meta.pubStr,
                    [STORAGE_HUD_WAQI_LAG]: meta.lagMinutes
                });
            }
        }
        if (source === 'HA' || source === 'FULL') {
            const haData = await fetchHAEntities(settings);
            haSuccess = Object.values(haData).some(v => v.error === false);
            newResults = { ...newResults, ...haData };
            
            if (haSuccess) {
                await chrome.storage.local.set({ [STORAGE_HUD_LAST_HA]: Date.now() });
            }
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

        // Check if we need a retry due to connection error
        const hasConnError = Object.values(newResults).some(v => v.value === 'CONN' || v.value === 'X');
        if (hasConnError) {
             // If data is older than refresh rate, schedule a quick retry
             const lastData = await chrome.storage.local.get([STORAGE_HUD_LAST_WAQI, STORAGE_HUD_LAST_HA]);
             const now = Date.now();
             const waqiStale = (now - (lastData[STORAGE_HUD_LAST_WAQI] || 0)) > (settings.waqiRefreshRate * 60 * 1000);
             const haStale = (now - (lastData[STORAGE_HUD_LAST_HA] || 0)) > (settings.haRefreshRate * 60 * 1000);
             
             if (waqiStale || haStale) {
                 console.log('[HUD] Data stale and fetch failed, scheduling retry in 30s...');
                 chrome.alarms.create(ALARM_RETRY, { delayInMinutes: 0.5 });
             }
        } else {
            // Success! Clear any pending retry
            chrome.alarms.clear(ALARM_RETRY);
        }

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
            if (currentKey.includes('aqi') || currentKey.includes('o3') || currentKey.includes('pm')) {
                const val = parseFloat(currentData.value);
                if (val > 100) bgColor = '#FF9800'; // Orange
                if (val > 150) bgColor = '#F44336'; // Red
            }
        } else if (currentKey.startsWith('ha_')) {
            // Check HA custom thresholds
            bgColor = '#03A9F4'; // Default Blue for HA
            const haEntities = (await chrome.storage.sync.get({ haEntities: [] })).haEntities;
            const entityId = currentKey.replace(/^ha_/, '');
            const entityConfig = haEntities.find(e => e.id.replace(/[\s\r\n]/g, '') === entityId);

            if (entityConfig && !isNaN(parseFloat(currentData.value))) {
                const val = parseFloat(currentData.value);
                const op = entityConfig.op || '>';
                const warn = parseFloat(entityConfig.warn);
                const crit = parseFloat(entityConfig.crit);

                if (op === '>') {
                    if (!isNaN(crit) && val >= crit) bgColor = '#F44336'; // Red
                    else if (!isNaN(warn) && val >= warn) bgColor = '#FF9800'; // Orange
                } else if (op === '<') {
                    if (!isNaN(crit) && val <= crit) bgColor = '#F44336'; // Red
                    else if (!isNaN(warn) && val <= warn) bgColor = '#FF9800'; // Orange
                }
            }
        }
    }

    let displayValue = currentData.value;
    if (settings.hudIconRound !== false && !isNaN(parseFloat(displayValue))) {
        const num = parseFloat(displayValue);
        if (num >= 1000) {
            // Display like 1.5K, 12K, etc.
            displayValue = (num / 1000).toFixed(1);
            if (displayValue.endsWith('.0')) displayValue = displayValue.slice(0, -2);
            displayValue += 'K';
        } else {
            // Round normal small numbers
            displayValue = Math.round(num).toString();
        }
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
        else if (alarm.name === ALARM_RETRY) {
            console.log('[HUD] Executing retry fetch...');
            updateHUDData('FULL');
        }
    });

    // Handle System Wake/Unlock
    chrome.idle.onStateChanged.addListener((newState) => {
        if (newState === 'active') {
            console.log('[HUD] System active detected, checking for stale data...');
            updateHUDData('FULL');
        }
    });

    // Handle Network Online
    globalThis.addEventListener('online', () => {
        console.log('[HUD] Network online detected, triggering refresh...');
        updateHUDData('FULL');
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
