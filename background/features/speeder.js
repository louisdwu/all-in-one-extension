/**
 * Video speeder backend: settings, keyboard-command forwarding, shortcuts.
 */
import '../../libs/core.js';
import '../../libs/schema.js';
import { handle, broadcast } from '../router.js';

const { log } = globalThis.AIO.core;
const speedLog = log('speeder');

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
