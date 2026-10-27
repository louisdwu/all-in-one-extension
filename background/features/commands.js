/**
 * chrome.commands (global keyboard shortcuts) → active tab content script.
 *
 * The old listener called `chrome.tabs.sendMessage(tab.id, ...)` without
 * catching the rejection, which spams "Could not establish connection" whenever
 * the active tab is chrome:// or has no speeder (e.g. right after install).
 */
import '../../libs/core.js';

const { log } = globalThis.AIO.core;
const cmdLog = log('commands');

const COMMAND_TO_ACTION = {
    'toggle-speed': 'increase',
    'decrease-speed': 'decrease',
    'preset-speed': 'preset'
};

export function registerCommands() {
    chrome.commands.onCommand.addListener(async (command, tab) => {
        const action = COMMAND_TO_ACTION[command];
        if (!action) return;

        let target = tab;
        if (!target || target.id === undefined || target.id < 0) {
            const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
            target = tabs[0];
        }
        if (!target || target.id === undefined || target.id < 0) return;

        try {
            await chrome.tabs.sendMessage(target.id, { type: 'speeder:command', action });
        } catch (err) {
            // Expected on pages without our content script (chrome://, Web Store, PDF).
            cmdLog.debug('no speeder in tab', target.id, command);
        }
    });
}
