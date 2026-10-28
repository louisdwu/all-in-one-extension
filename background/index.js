/**
 * Service worker entry point (MV3 module worker).
 *
 * Every feature lives in `features/*` and registers its own message handlers;
 * this file only wires them together so the load order is explicit.
 */
import '../libs/core.js';
import '../libs/schema.js';
import '../libs/rules.js';
import '../libs/bili.js';

import { installRouter } from './router.js';
import { registerTabs } from './features/tabs.js';
import { registerIncognito } from './features/incognito.js';
import { registerHotkeys } from './features/hotkeys.js';
import { registerSpeeder } from './features/speeder.js';
import { registerBilibili } from './features/bilibili.js';
import { registerCommands } from './features/commands.js';
import { initHUD, registerHUDMessages } from './features/hud/index.js';
import { initLifecycle } from './features/lifecycle.js';
import { registerDiagnostics } from './features/diagnostics.js';

const { log, setLevel } = globalThis.AIO.core;
const bgLog = log('bg');

// The worker already pays for one storage read at startup; keep the debug level
// live here instead of in libs/core.js (which runs in every content-script frame).
globalThis.AIO.schema.load()
    .then((settings) => globalThis.AIO.core.applyDebugSetting(settings))
    .catch(() => {});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.aioDebug) setLevel(changes.aioDebug.newValue ? 'debug' : 'warn');
});

// Unhandled failures would otherwise vanish with the worker; keep them in the
// log ring so the diagnostics panel can show them. (Node — used by the module
// graph test — has no addEventListener on globalThis, hence the guard.)
if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('error', (event) => {
        bgLog.error('uncaught:', event.message || event.type);
    });
    globalThis.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        bgLog.error('unhandled rejection:', (reason && reason.message) || String(reason));
    });
}

registerTabs();
registerIncognito();
registerHotkeys();
registerSpeeder();
registerBilibili();
registerHUDMessages();
registerDiagnostics();
installRouter();
registerCommands();

initHUD();
initLifecycle();

bgLog.info('service worker ready');
