/**
 * Diagnostics snapshot for the options page ("关于与诊断").
 *
 * Everything here is read-only and cheap: message statistics, the bounded log
 * ring from libs/core.js, storage footprint and a few environment facts. It is
 * the fastest way to answer "is the service worker alive and what did it do?"
 * without attaching DevTools to the worker.
 */
import '../../libs/core.js';
import '../../libs/schema.js';
import { handle, registeredTypes, messageStats, routerStartedAt } from '../router.js';

const { log, storage } = globalThis.AIO.core;
const diagLog = log('diagnostics');

function byteSize(value) {
    try {
        return new TextEncoder().encode(JSON.stringify(value || {})).length;
    } catch (err) {
        return 0;
    }
}

export function registerDiagnostics() {
    handle('diag:snapshot', async () => {
        const [syncData, localData] = await Promise.all([storage.getSync(null), storage.getLocal(null)]);
        const settings = await globalThis.AIO.schema.load();

        return {
            ok: true,
            at: Date.now(),
            version: chrome.runtime.getManifest().version,
            schemaVersion: globalThis.AIO.schema.SCHEMA_VERSION,
            workerStartedAt: routerStartedAt(),
            registeredTypes: registeredTypes(),
            messageStats: messageStats(),
            errors: globalThis.AIO.core.logRing.list().slice(-40),
            storage: {
                syncBytes: byteSize(syncData),
                localBytes: byteSize(localData),
                syncKeys: Object.keys(syncData).length,
                localKeys: Object.keys(localData).length
            },
            features: {
                tabs: settings.aioTabsEnabled,
                incognito: settings.ezEnabled,
                speeder: settings.globalEnabled,
                speedMemory: settings.speederSpeedMemory,
                hotkeys: settings.hotkeyEnabled,
                bilibili: settings.biliEnabled,
                hud: settings.hudEnabled
            },
            hud: {
                items: Array.isArray(localData.hudQueueKeys) ? localData.hudQueueKeys.length : 0,
                lastWaqi: localData.hudLastSuccessWaqi || 0,
                lastHa: localData.hudLastSuccessHa || 0
            }
        };
    }, ['diag:getSnapshot', 'hud:diag']);

    handle('diag:clearLog', async () => {
        globalThis.AIO.core.logRing.clear();
        diagLog.debug('log ring cleared');
        return { ok: true };
    });

    handle('diag:ping', async () => ({ ok: true, at: Date.now() }), ['ping']);
}
