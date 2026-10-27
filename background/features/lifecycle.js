/**
 * Install / startup / settings plumbing shared by all features.
 */
import '../../libs/core.js';
import '../../libs/schema.js';
import { broadcast } from '../router.js';

const { log } = globalThis.AIO.core;
const lifeLog = log('lifecycle');

export function initLifecycle() {
    chrome.runtime.onInstalled.addListener(async (details) => {
        // Never overwrite an existing user setting: only fill in missing keys.
        try {
            await globalThis.AIO.schema.migrate();
            const raw = await globalThis.AIO.core.storage.getSync(null);
            const defaults = globalThis.AIO.schema.toStorage(globalThis.AIO.schema.normalize({}));
            const missing = {};
            for (const [key, value] of Object.entries(defaults)) {
                if (raw[key] === undefined) missing[key] = value;
            }
            if (Object.keys(missing).length) await globalThis.AIO.core.storage.setSync(missing);
            lifeLog.info('installed:', details.reason);
        } catch (err) {
            lifeLog.error('install hook failed', err);
        }
    });

    chrome.runtime.onStartup.addListener(async () => {
        try {
            await globalThis.AIO.schema.migrate();
        } catch (err) {
            lifeLog.error('startup migration failed', err);
        }
    });

    // Keep a single source of change notifications for content scripts.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (Object.keys(changes).length === 0) return;
        // Content scripts and extension pages re-read the schema themselves; this
        // message only carries the fact that something changed.
        broadcastSettingsChanged(Object.keys(changes));
    });
}

export async function broadcastSettingsChanged(keys) {
    // Note: dynamic import() is forbidden in a module service worker
    // (HTML spec, ServiceWorker#1356) — always use static imports here.
    await broadcast({ type: 'aio:settingsChanged', keys });
}
