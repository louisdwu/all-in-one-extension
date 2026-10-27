/**
 * Tab switcher backend: list the tabs of the current window and activate one.
 */
import '../../libs/core.js';
import { handle } from '../router.js';

const { log } = globalThis.AIO.core;
const tabsLog = log('tabs');

function toSummary(tab) {
    return {
        id: tab.id,
        title: tab.title || tab.url || '',
        url: tab.url || '',
        favIconUrl: tab.favIconUrl || '',
        windowId: tab.windowId,
        index: tab.index,
        active: !!tab.active,
        pinned: !!tab.pinned,
        audible: !!tab.audible
    };
}

export function registerTabs() {
    handle('tabs:list', async () => {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const summaries = tabs.filter((tab) => !tab.hidden).map(toSummary);
        tabsLog.debug('list', summaries.length);
        return { tabs: summaries, windowId: (summaries[0] || {}).windowId };
    }, ['getTabs']);

    handle('tabs:activate', async (message) => {
        const tabId = message.tabId;
        if (typeof tabId !== 'number') return { ok: false, error: 'missing tabId' };
        const tab = await chrome.tabs.update(tabId, { active: true });
        if (tab && tab.windowId !== undefined) {
            try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (err) { /* window closed */ }
        }
        return { ok: true };
    }, ['switchToTab']);
}
