/**
 * Message router — ONE `chrome.runtime.onMessage` listener for the whole extension.
 *
 * The old design registered seven listeners (one per feature) that each had to
 * guess whether a message was theirs and manually juggle `return true`. Chrome
 * delivers to the first listener that answers, which made "who owns this action"
 * ambiguous and left dangling ports when nobody answered.
 *
 * Contract:
 *   request  = { type: string, ...payload }
 *   response = whatever the handler resolves to; `{ ok: true }` when it returns
 *              nothing, `{ ok: false, error }` when it rejects.
 */
import '../libs/core.js';

const { log } = globalThis.AIO.core;
const routerLog = log('router');

/** @type {Map<string, (message: any, sender: chrome.runtime.MessageSender) => any>} */
const handlers = new Map();

/** Per-type call statistics, surfaced by the diagnostics panel. */
const stats = new Map();
const startedAt = Date.now();

function recordStat(type, durationMs, error) {
    let entry = stats.get(type);
    if (!entry) {
        entry = { type, calls: 0, errors: 0, totalMs: 0, lastAt: 0, lastError: '' };
        stats.set(type, entry);
    }
    entry.calls += 1;
    entry.totalMs += durationMs;
    entry.lastAt = Date.now();
    if (error) {
        entry.errors += 1;
        entry.lastError = error;
    }
}

export function messageStats() {
    return Array.from(stats.values())
        .map((entry) => Object.assign({}, entry, { avgMs: entry.calls ? Math.round((entry.totalMs / entry.calls) * 10) / 10 : 0 }))
        .sort((a, b) => b.calls - a.calls);
}

export function routerStartedAt() {
    return startedAt;
}

/**
 * Register a handler for a message type (plus optional legacy aliases).
 * Handler may be async; exceptions are reported to the caller instead of
 * producing "The message port closed before a response was received".
 */
export function handle(type, handler, aliases = []) {
    for (const key of [type, ...aliases]) {
        if (handlers.has(key)) routerLog.warn('handler overwritten:', key);
        handlers.set(key, handler);
    }
}

export function installRouter() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || typeof message !== 'object') return false;
        const type = message.type || message.action;
        const handler = type && handlers.get(type);
        if (!handler) return false;

        let settled = false;
        const reply = (payload) => {
            if (settled) return;
            settled = true;
            try { sendResponse(payload === undefined ? { ok: true } : payload); } catch (err) { /* port closed */ }
        };

        const started = Date.now();
        Promise.resolve()
            .then(() => handler(message, sender))
            .then((result) => {
                recordStat(type, Date.now() - started);
                reply(result);
            })
            .catch((err) => {
                const message2 = String((err && err.message) || err);
                recordStat(type, Date.now() - started, message2);
                routerLog.error('handler "' + type + '" failed:', err);
                reply({ ok: false, error: message2 });
            });
        return true; // keep the channel open for the async reply
    });
}

/** Types that have a handler registered (used by the diagnostics page). */
export function registeredTypes() {
    return Array.from(handlers.keys()).sort();
}

/**
 * Fire-and-forget message to a set of tabs.
 * `chrome.tabs.sendMessage` rejects for tabs without our content script
 * (chrome:// pages, PDF viewer, just-loaded tabs) — those are expected.
 */
export async function broadcast(message, query = {}) {
    let tabs = [];
    try {
        tabs = await chrome.tabs.query(query);
    } catch (err) {
        return 0;
    }
    let delivered = 0;
    await Promise.all(tabs.map(async (tab) => {
        if (!tab || tab.id === undefined || tab.id < 0) return;
        try {
            await chrome.tabs.sendMessage(tab.id, message);
            delivered++;
        } catch (err) {
            /* no receiver in this tab — ignore */
        }
    }));
    return delivered;
}

/** Tell the page that triggered a request that something went wrong (page-side toast). */
export async function notifySender(sender, message, level = 'error') {
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId === undefined || tabId < 0) return;
    try {
        await chrome.tabs.sendMessage(tabId, { type: 'aio:toast', message, level });
    } catch (err) {
        /* page navigated away */
    }
}
