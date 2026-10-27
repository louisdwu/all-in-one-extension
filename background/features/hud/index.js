/**
 * HUD orchestrator: fetch WAQI + Home Assistant data, rotate it on the toolbar icon.
 *
 * Design notes (fixes for the previous implementation):
 *  - `chrome.alarms` has a 30s minimum period, so the old "3s carousel" alarm
 *    simply did not work in a packed extension. Timers now drive the carousel
 *    and the alarms serve as wake-up/keep-alive hints.
 *  - Settings changes no longer trigger a full refetch storm: the scheduler only
 *    re-arms when the relevant configuration fingerprint actually changes.
 *  - Refreshes are serialized (`inFlight`) and the state write is coalesced, so
 *    rapid saves cannot exhaust the storage write quota.
 */
import '../../../libs/core.js';
import '../../../libs/schema.js';
import { setIcon, resetIcon } from './icon.js';
import { fetchWaqi, enabledWaqiMetrics, WAQI_METRIC_KEYS } from './waqi.js';
import { fetchHa } from './ha.js';
import { handle } from '../../router.js';

const { log, storage } = globalThis.AIO.core;
const hudLog = log('hud');

const ALARM_KEEPALIVE = 'hud:keepalive';
const STORAGE = {
    state: 'hudState',
    queue: 'hudQueueKeys',
    index: 'hudCarouselIndex',
    lastWaqi: 'hudLastSuccessWaqi',
    lastHa: 'hudLastSuccessHa',
    pubValue: 'hudLastWaqiPubV',
    pubLabel: 'hudLastWaqiPubS',
    lag: 'hudLastWaqiLag'
};

const COLORS = { waqi: '#673AB7', waqiWarn: '#FF9800', waqiCritical: '#F44336', ha: '#03A9F4', idle: '#9E9E9E' };
const MIN_DATA_INTERVAL_MS = 30 * 1000; // chrome's floor for alarms, applied to timers too

/** @type {{state: object, queue: string[], index: number}} */
const runtime = { state: {}, queue: [], index: 0 };
let waqiTimer = null;
let haTimer = null;
let carouselTimer = null;
let inFlight = null;
let schedulerFingerprint = '';
let stateWriter = null;

function writer() {
    if (!stateWriter) stateWriter = storage.createWriter('local', 400);
    return stateWriter;
}

async function persistState(patch) {
    writer().queue(patch);
}

async function loadPersisted() {
    const data = await storage.getLocal([STORAGE.state, STORAGE.queue, STORAGE.index]);
    runtime.state = data[STORAGE.state] || {};
    runtime.queue = Array.isArray(data[STORAGE.queue]) ? data[STORAGE.queue] : [];
    runtime.index = typeof data[STORAGE.index] === 'number' ? data[STORAGE.index] : 0;
}

/* ------------------------------------------------------------------ */
/* Queue + rendering                                                   */
/* ------------------------------------------------------------------ */

function rebuildQueue(settings) {
    const queue = [];
    const enabled = enabledWaqiMetrics(settings);
    for (const key of WAQI_METRIC_KEYS) {
        const stateKey = 'waqi_' + key;
        if (enabled.includes(key) && runtime.state[stateKey]) queue.push(stateKey);
    }
    for (const entity of settings.haEntities || []) {
        const key = 'ha_' + String(entity.id).replace(/[\s\r\n]/g, '');
        if (runtime.state[key]) queue.push(key);
    }
    runtime.queue = queue;
    if (runtime.index >= queue.length) runtime.index = 0;
}

function formatDisplay(value, round, numeric) {
    if (!round || !numeric) return String(value);
    const num = parseFloat(value);
    if (!isFinite(num)) return String(value);
    if (Math.abs(num) >= 1000) {
        let text = (num / 1000).toFixed(1);
        if (text.endsWith('.0')) text = text.slice(0, -2);
        return text + 'K';
    }
    return String(Math.round(num));
}

function colorForItem(key, item, settings) {
    if (!item || item.error) return COLORS.idle;
    if (key.startsWith('waqi_')) {
        const metric = key.slice(5);
        if (['aqi', 'o3', 'pm25', 'pm10'].includes(metric)) {
            const value = parseFloat(item.raw !== undefined ? item.raw : item.value);
            if (isFinite(value)) {
                if (value >= 150) return COLORS.waqiCritical;
                if (value >= 100) return COLORS.waqiWarn;
            }
        }
        return COLORS.waqi;
    }
    if (key.startsWith('ha_')) {
        const id = key.slice(3);
        const entity = (settings.haEntities || []).find((candidate) => candidate.id.replace(/[\s\r\n]/g, '') === id);
        const threshold = colorFromThresholds(entity, item.raw !== undefined ? item.raw : item.value);
        if (threshold === 'critical') return COLORS.waqiCritical;
        if (threshold === 'warning') return COLORS.waqiWarn;
        return COLORS.ha;
    }
    return COLORS.idle;
}

function colorFromThresholds(entity, rawValue) {
    const value = parseFloat(rawValue);
    if (!entity || !isFinite(value)) return null;
    const warn = parseFloat(entity.warn);
    const crit = parseFloat(entity.crit);
    if (entity.op === '<') {
        if (!isNaN(crit) && value <= crit) return 'critical';
        if (!isNaN(warn) && value <= warn) return 'warning';
    } else {
        if (!isNaN(crit) && value >= crit) return 'critical';
        if (!isNaN(warn) && value >= warn) return 'warning';
    }
    return null;
}

async function renderCurrent() {
    const settings = await globalThis.AIO.schema.load();
    if (!settings.hudEnabled) {
        resetIcon('HUD 监控（已关闭）');
        return;
    }
    if (!runtime.queue.length) {
        setIcon('HUD', '--', COLORS.idle);
        return;
    }
    runtime.index = runtime.index % runtime.queue.length;
    const key = runtime.queue[runtime.index];
    const item = runtime.state[key];
    if (!item) {
        setIcon('HUD', '...', COLORS.ha);
        return;
    }
    const numeric = isFinite(parseFloat(item.value));
    const display = formatDisplay(item.value, settings.hudIconRound, numeric);
    setIcon(item.name || key, display, colorForItem(key, item, settings));
    await persistState({ [STORAGE.index]: runtime.index, [STORAGE.queue]: runtime.queue });
}

async function advanceCarousel() {
    if (!runtime.queue.length) return;
    runtime.index = (runtime.index + 1) % runtime.queue.length;
    await renderCurrent();
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

async function refresh(source = 'FULL') {
    if (inFlight) return inFlight;
    inFlight = (async () => {
        const settings = await globalThis.AIO.schema.load();
        if (!settings.hudEnabled) return { ok: false, reason: 'disabled' };

        const patch = {};
        let ok = false;
        let failed = false;

        if (source === 'WAQI' || source === 'FULL') {
            if (enabledWaqiMetrics(settings).length) {
                const result = await fetchWaqi(settings);
                Object.assign(runtime.state, result.metrics);
                failed = failed || Object.values(result.metrics).some((item) => item.error);
                if (result.meta) {
                    patch[STORAGE.lastWaqi] = result.meta.fetchTs;
                    patch[STORAGE.pubValue] = result.meta.pubTs;
                    patch[STORAGE.pubLabel] = result.meta.pubStr;
                    patch[STORAGE.lag] = result.meta.lagMinutes;
                } else {
                    failed = true;
                }
                ok = ok || Object.values(result.metrics).some((item) => !item.error);
            }
        }

        if (source === 'HA' || source === 'FULL') {
            const result = await fetchHa(settings);
            if (Object.keys(result.metrics).length) {
                Object.assign(runtime.state, result.metrics);
                ok = ok || result.ok;
                failed = failed || !result.ok;
                if (result.ok) patch[STORAGE.lastHa] = Date.now();
            }
        }

        rebuildQueue(settings);
        patch[STORAGE.state] = runtime.state;
        patch[STORAGE.queue] = runtime.queue;
        await storage.setLocal(patch);
        await renderCurrent();

        hudLog.debug('refresh', source, { ok, failed, items: runtime.queue.length });
        return { ok, failed, items: runtime.queue.length };
    })();

    try {
        return await inFlight;
    } finally {
        inFlight = null;
    }
}

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

function fingerprint(settings) {
    return JSON.stringify({
        enabled: settings.hudEnabled,
        waqi: [settings.waqiToken, settings.waqiCity, settings.waqiRefreshRate, settings.waqiMetrics],
        ha: [settings.haUrl, settings.haToken, settings.haRefreshRate, settings.haEntities],
        carousel: settings.hudCarouselInterval,
        round: settings.hudIconRound
    });
}

function clearTimers() {
    for (const timer of [waqiTimer, haTimer, carouselTimer]) {
        if (timer) clearInterval(timer);
    }
    waqiTimer = null;
    haTimer = null;
    carouselTimer = null;
}

function restartTimers(settings) {
    clearTimers();
    if (!settings.hudEnabled) return;

    const needsWaqi = enabledWaqiMetrics(settings).length > 0 && !!settings.waqiToken;
    const needsHa = !!(settings.haUrl && settings.haToken && settings.haEntities.length);

    if (needsWaqi) {
        const period = Math.max(MIN_DATA_INTERVAL_MS, settings.waqiRefreshRate * 60 * 1000);
        waqiTimer = setInterval(() => refresh('WAQI'), period);
    }
    if (needsHa) {
        const period = Math.max(MIN_DATA_INTERVAL_MS, settings.haRefreshRate * 60 * 1000);
        haTimer = setInterval(() => refresh('HA'), period);
    }
    const carousel = Math.max(3000, settings.hudCarouselInterval * 1000);
    carouselTimer = setInterval(advanceCarousel, carousel);
}

async function schedule(force = false) {
    const settings = await globalThis.AIO.schema.load();
    const stamp = fingerprint(settings);
    if (!force && stamp === schedulerFingerprint) return;
    const previous = schedulerFingerprint;
    schedulerFingerprint = stamp;

    // Alarms only keep the worker warm; the real cadence lives in timers.
    chrome.alarms.create(ALARM_KEEPALIVE, { periodInMinutes: 1 });

    if (!settings.hudEnabled) {
        clearTimers();
        resetIcon('HUD 监控（已关闭）');
        return;
    }

    restartTimers(settings);
    if (force || previous === '' || !runtime.queue.length) {
        await loadPersisted();
        await refresh('FULL');
    } else {
        rebuildQueue(settings);
        await renderCurrent();
    }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function registerHUDMessages() {
    handle('hud:refresh', async () => {
        await loadPersisted();
        const result = await refresh('FULL');
        return { ok: true, ...result, timestamp: Date.now() };
    }, ['TEST_HUD_FORCE_FETCH', 'hud:test']);

    handle('hud:updateConfig', async () => {
        await storage.setLocal({ [STORAGE.index]: 0 });
        runtime.index = 0;
        await schedule(true);
        return { ok: true };
    }, ['UPDATE_HUD_CONFIG']);

    handle('hud:getState', async () => {
        return {
            state: runtime.state,
            queue: runtime.queue,
            index: runtime.index
        };
    }, ['hud:state']);
}

export function initHUD() {
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name !== ALARM_KEEPALIVE) return;
        // The worker may have been suspended: re-arm timers if they are gone.
        if (!waqiTimer && !haTimer && !carouselTimer) schedule(false);
    });

    chrome.idle.onStateChanged.addListener((state) => {
        if (state === 'active') refresh('FULL');
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (!Object.keys(changes).some((key) => key.startsWith('hud') || key.startsWith('waqi') || key.startsWith('ha'))) return;
        schedule(false);
    });

    chrome.runtime.onStartup.addListener(() => schedule(false));
    chrome.runtime.onInstalled.addListener(() => schedule(false));

    loadPersisted().then(() => schedule(false)).catch((err) => hudLog.error('init failed', err));
}
