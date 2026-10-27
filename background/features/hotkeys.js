/**
 * Per-site keyboard remapping backend.
 *
 * Storage shape: hotkeyMappings = { "example.com": { "F": "H" } }
 * which means: "on example.com, the site's F behaviour moves to H".
 */
import '../../libs/core.js';
import '../../libs/schema.js';
import { handle, broadcast } from '../router.js';

const { log } = globalThis.AIO.core;
const hkLog = log('hotkeys');

function currentHostname(sender) {
    try {
        return sender && sender.tab && sender.tab.url ? new URL(sender.tab.url).hostname : null;
    } catch (err) {
        return null;
    }
}

async function activeTabHostname() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length || !tabs[0].url) return null;
    try {
        return new URL(tabs[0].url).hostname;
    } catch (err) {
        return null;
    }
}

async function writeMappings(hostname, mappings) {
    const all = (await globalThis.AIO.core.storage.getSync(['hotkeyMappings'])).hotkeyMappings || {};
    if (Object.keys(mappings).length) all[hostname] = mappings;
    else delete all[hostname];
    await globalThis.AIO.core.storage.setSync({ hotkeyMappings: all });
    return all;
}

async function notifyHost(hostname) {
    if (!hostname) return;
    const enabledSites = (await globalThis.AIO.core.storage.getSync(['enabledSites'])).enabledSites || {};
    await broadcast(
        { type: 'hotkeys:changed', hostname, enabled: enabledSites[hostname] !== false },
        { url: ['*://' + hostname + '/*'] }
    );
}

export function registerHotkeys() {
    handle('hotkeys:context', async (message, sender) => {
        const hostname = message.hostname || currentHostname(sender) || await activeTabHostname();
        const store = await globalThis.AIO.core.storage.getSync(['hotkeyMappings', 'enabledSites', 'hotkeyEnabled']);
        const all = store.hotkeyMappings || {};
        const sites = store.enabledSites || {};
        return {
            hostname,
            mappings: (hostname && all[hostname]) || {},
            enabled: store.hotkeyEnabled !== false && (!hostname || sites[hostname] !== false)
        };
    }, ['GET_CURRENT_HOSTNAME', 'GET_MAPPINGS', 'GET_SITE_ENABLED']);

    handle('hotkeys:setMappings', async (message) => {
        const hostname = message.hostname;
        if (!hostname) return { ok: false, error: 'missing hostname' };
        const cleaned = globalThis.AIO.schema.normalize({ hotkeyMappings: { [hostname]: message.mappings || {} } }).hotkeyMappings;
        const all = await writeMappings(hostname, cleaned[hostname] || {});
        hkLog.debug('saved mappings for', hostname, Object.keys(cleaned[hostname] || {}).length);
        await notifyHost(hostname);
        return { ok: true, mappings: (all[hostname]) || {} };
    }, ['SAVE_MAPPINGS']);

    handle('hotkeys:deleteMapping', async (message) => {
        const hostname = message.hostname;
        if (!hostname || !message.key) return { ok: false, error: 'missing hostname/key' };
        const store = await globalThis.AIO.core.storage.getSync(['hotkeyMappings']);
        const all = store.hotkeyMappings || {};
        if (all[hostname]) {
            delete all[hostname][message.key];
            if (!Object.keys(all[hostname]).length) delete all[hostname];
            await globalThis.AIO.core.storage.setSync({ hotkeyMappings: all });
        }
        await notifyHost(hostname);
        return { ok: true, mappings: all[hostname] || {} };
    }, ['DELETE_MAPPING']);

    handle('hotkeys:clearSite', async (message) => {
        const hostname = message.hostname;
        if (!hostname) return { ok: false, error: 'missing hostname' };
        await writeMappings(hostname, {});
        await notifyHost(hostname);
        return { ok: true, mappings: {} };
    }, ['CLEAR_ALL_MAPPINGS']);

    handle('hotkeys:setSiteEnabled', async (message) => {
        const hostname = message.hostname;
        if (!hostname) return { ok: false, error: 'missing hostname' };
        const store = await globalThis.AIO.core.storage.getSync(['enabledSites']);
        const sites = store.enabledSites || {};
        if (message.enabled === false) sites[hostname] = false;
        else delete sites[hostname];
        await globalThis.AIO.core.storage.setSync({ enabledSites: sites });
        await notifyHost(hostname);
        return { ok: true, enabled: message.enabled !== false };
    }, ['SET_SITE_ENABLED']);
}
