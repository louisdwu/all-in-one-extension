/**
 * Video speeder backend: settings, keyboard-command forwarding, shortcuts.
 */
import '../../libs/core.js';
import '../../libs/schema.js';
import '../../libs/speed_memory.js';
import { handle, broadcast } from '../router.js';

const { log, storage } = globalThis.AIO.core;
const speedLog = log('speeder');

/* ------------------------------------------------------------------ *
 * Speed memory writes live here, not in the content script.
 *
 * A page-side timer is throttled when the tab goes to the background
 * (Chrome clamps timers in hidden tabs), so "change speed then switch tab"
 * could silently lose the remembered value. The worker has no such limit and
 * the in-memory mirror keeps concurrent updates from clobbering each other.
 * ------------------------------------------------------------------ */
const memoryWriter = storage.createWriter('local', 350);
let speedsCache = null;

async function loadSpeeds() {
    if (speedsCache) return speedsCache;
    const data = await storage.getLocal(['speederSpeeds']);
    speedsCache = globalThis.AIO.speedMemory.normalize(data.speederSpeeds);
    return speedsCache;
}

function hostnameFromSender(sender) {
    try {
        return sender && sender.tab && sender.tab.url ? new URL(sender.tab.url).hostname : '';
    } catch (err) {
        return '';
    }
}
/* ------------------------------------------------------------------ *
 * Per-tab current speed.
 *
 * The speeder runs in every frame (all_frames: true) but only the top frame
 * has UI. Without this map, an embedded player (YouTube/Bilibili iframe) would
 * keep its own site default while the page shows 2x - and a frame loaded later
 * (lazy iframe) would never learn the current speed.
 * ------------------------------------------------------------------ */
const tabSpeeds = new Map();

chrome.tabs.onRemoved.addListener((tabId) => tabSpeeds.delete(tabId));

/** Push the speed to every frame of the tab (frameId omitted = all frames). */
async function broadcastTabSpeed(tabId, speed) {
    if (tabId === undefined || tabId < 0 || typeof speed !== 'number') return;
    try {
        await chrome.tabs.sendMessage(tabId, { type: 'speeder:applySpeed', speed });
    } catch (err) {
        // No content script in any frame (chrome://, PDF viewer, ...).
    }
}


export function registerSpeeder() {
    handle('speeder:getSettings', async () => {
        const settings = await globalThis.AIO.schema.load();
        return {
            globalEnabled: settings.globalEnabled,
            hideFloatingBall: settings.hideFloatingBall,
            excludeRules: settings.excludeRules,
            includeRules: settings.includeRules,
            defaultSpeed: settings.defaultSpeed,
            presetSpeed: settings.presetSpeed,
            shortcuts: settings.shortcuts,
            minRate: settings.speederMinRate,
            maxRate: settings.speederMaxRate,
            step: settings.speederStep,
            speedMemory: settings.speederSpeedMemory
        };
    }, ['getSpeederSettings']);

    handle('speeder:saveSettings', async (message) => {
        const patch = message.settings || message.patch || {};
        const settings = await globalThis.AIO.schema.save(patch);
        await broadcast({ type: 'speeder:settingsChanged', settings: { presetSpeed: settings.presetSpeed, defaultSpeed: settings.defaultSpeed } }, {});
        return { ok: true, success: true, settings };
    }, ['saveSpeederSettings', 'importSettings']);

    handle('speeder:getShortcuts', async () => {
        const settings = await globalThis.AIO.schema.load();
        return settings.shortcuts;
    }, ['getSpeederShortcuts']);

    handle('speeder:setShortcuts', async (message) => {
        const settings = await globalThis.AIO.schema.save({ shortcuts: message.shortcuts || {} });
        await broadcast({ type: 'speeder:shortcutsChanged', shortcuts: settings.shortcuts }, {});
        return { ok: true, shortcuts: settings.shortcuts };
    }, ['updateSpeederShortcuts']);

    /** Remember the current speed according to the configured mode. */
    handle('speeder:remember', async (message, sender) => {
        const mode = message.mode;
        const speed = globalThis.AIO.speedMemory.clampSpeed(message.speed);
        if (speed === null) return { ok: false, error: 'invalid speed' };

        if (mode === 'site') {
            const hostname = message.hostname || hostnameFromSender(sender);
            if (!hostname) return { ok: false, error: 'no hostname' };
            const store = globalThis.AIO.speedMemory.remember(await loadSpeeds(), hostname, speed);
            speedsCache = store;
            memoryWriter.queue({ speederSpeeds: store });
        } else if (mode === 'global') {
            memoryWriter.queue({ speederLastSpeed: speed });
        }
        // Frame sync happens even when memory is off: the UI lives in the top
        // frame, so an embedded player must still follow the chosen speed.
        const tabId = sender && sender.tab && sender.tab.id;
        if (tabId !== undefined && tabId >= 0) {
            tabSpeeds.set(tabId, speed);
            broadcastTabSpeed(tabId, speed);
        }
        return { ok: true, speed, persisted: mode === 'site' || mode === 'global' };
    }, ['speeder:rememberSpeed', 'speeder:setSpeed']);

    /** Current speed for the sender's tab (sub-frames ask on init). */
    handle('speeder:tabSpeed', async (message, sender) => {
        const tabId = sender && sender.tab && sender.tab.id;
        const speed = tabId === undefined ? undefined : tabSpeeds.get(tabId);
        return { ok: true, speed: typeof speed === 'number' ? speed : null };
    });


    handle('speeder:openOptions', async () => {
        chrome.runtime.openOptionsPage();
        return { ok: true };
    }, ['openOptions', 'openOptionsPage']);

    // When the popup/options change a setting, every speeder tab must re-read it.
    handle('aio:notifyAll', async () => {
        await broadcast({ type: 'aio:settingsChanged', keys: [] }, {});
        return { ok: true };
    }, ['reloadSettings', 'UPDATE_CONFIG']);
}
