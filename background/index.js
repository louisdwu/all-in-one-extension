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

const { log } = globalThis.AIO.core;
const bgLog = log('bg');

registerTabs();
registerIncognito();
registerHotkeys();
registerSpeeder();
registerBilibili();
registerHUDMessages();
installRouter();
registerCommands();

initHUD();
initLifecycle();

bgLog.info('service worker ready');
