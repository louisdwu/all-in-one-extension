/**
 * Screenshot scheduler — run a daily headless-ish capture of one page.
 *
 * Flow: a daily alarm fires at the configured HH:MM → a one-shot "jitter"
 * alarm is scheduled 0..offsetMin minutes later (the random offset the user
 * asked for) → when it fires we open the page in a MINIMIZED popup window,
 * wait for the load event plus the configured settle time, capture the tab,
 * append the image to the history in `chrome.storage.local` and close the
 * window again.
 *
 * Why a minimized window instead of an inactive background tab:
 * `chrome.tabs.captureVisibleTab` can only capture the *visible* tab of a
 * window — a background tab in the user's window is never captureable. A
 * minimized popup keeps the page out of sight; if its capture comes back
 * empty (rendering suspended), we restore the window WITHOUT focus, retry,
 * and close it again.
 *
 * The history (images included) is runtime data, so it lives in
 * `chrome.storage.local` — never in the sync-backed schema (images would
 * blow the 8 KB-per-item sync quota instantly).
 */

import '../../libs/core.js';
import '../../libs/schema.js';
import { handle } from '../router.js';

const AIO = globalThis.AIO;
const { log } = AIO.core;
const logFn = log('screenshot');

const BASE_ALARM = 'aio-screenshot-daily';
const JITTER_ALARM = 'aio-screenshot-jitter';
const HISTORY_KEY = 'aioScreenshotHistory';
const HISTORY_CAP = 20;

/** Above this a capture is considered real content; below it is likely a blank frame. */
const BLANK_CAPTURE_BYTES = 15000;

/** Hard cap for the page load phase, independent of the user's settle time. */
const LOAD_TIMEOUT_MS = 30000;

/** The worker may sleep mid-wait; poke an API each chunk to reset the idle timer. */
const KEEPALIVE_CHUNK_MS = 20000;

/* ------------------------------------------------------------------ *
 * Pure helpers (unit-tested)
 * ------------------------------------------------------------------ */

/**
 * Next wall-clock occurrence of "HH:MM" strictly after `now`.
 * Deterministic — no jitter here, so re-arming on every worker wake-up
 * always lands on the same alarm time.
 */
export function nextOccurrence(timeStr, now = new Date()) {
    const match = /^([0-9]{1,2}):([0-9]{1,2})$/.exec(String(timeStr || ''));
    const hours = match ? Math.min(23, parseInt(match[1], 10)) : 9;
    const minutes = match ? Math.min(59, parseInt(match[2], 10)) : 0;
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    return target.getTime();
}

/** Newest-first, capped history; tolerates junk entries. */
export function trimHistory(list, cap = HISTORY_CAP) {
    if (!Array.isArray(list)) return [];
    return list
        .filter((item) => item && typeof item.id !== 'undefined' && typeof item.image === 'string')
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, cap);
}

function isValidHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (err) {
        return false;
    }
}

/* ------------------------------------------------------------------ *
 * History storage (chrome.storage.local)
 * ------------------------------------------------------------------ */

async function readHistory() {
    const stored = await AIO.core.storage.get('local', HISTORY_KEY);
    return trimHistory(stored && stored[HISTORY_KEY]);
}

async function appendHistory(entry) {
    const previous = await readHistory();
    let next = trimHistory([entry, ...previous]);
    try {
        await AIO.core.storage.set('local', { [HISTORY_KEY]: next });
    } catch (err) {
        // Quota exceeded (or write raced a worker shutdown): drop the oldest
        // half and try once more before giving up on this capture.
        logFn.warn('history write failed, trimming:', err && err.message);
        next = trimHistory(next.slice(0, Math.ceil(HISTORY_CAP / 2)));
        await AIO.core.storage.set('local', { [HISTORY_KEY]: next });
    }
    return next;
}

/* ------------------------------------------------------------------ *
 * Alarm plumbing
 * ------------------------------------------------------------------ */

async function ensureAlarm() {
    if (typeof chrome === 'undefined' || !chrome.alarms) return; // Node test env
    const settings = await AIO.schema.load();
    await chrome.alarms.clear(BASE_ALARM);
    await chrome.alarms.clear(JITTER_ALARM);
    if (!settings.screenshotEnabled || !isValidHttpUrl(settings.screenshotUrl)) {
        logFn.info('scheduler disabled or URL missing');
        return;
    }
    const when = nextOccurrence(settings.screenshotTime);
    await chrome.alarms.create(BASE_ALARM, { when, periodInMinutes: 1440 });
    logFn.info('next run', new Date(when).toLocaleString(), '+0..', settings.screenshotOffsetMin, 'min jitter');
}

async function onAlarm(alarm) {
    if (!alarm || (alarm.name !== BASE_ALARM && alarm.name !== JITTER_ALARM)) return;
    const settings = await AIO.schema.load();
    if (!settings.screenshotEnabled || !isValidHttpUrl(settings.screenshotUrl)) return;

    if (alarm.name === BASE_ALARM && settings.screenshotOffsetMin > 0) {
        // The daily alarm only arms the jittered follow-up, so the random
        // offset is re-drawn every day instead of being frozen at save time.
        const delayMs = Math.random() * settings.screenshotOffsetMin * 60000;
        await chrome.alarms.create(JITTER_ALARM, { when: Date.now() + Math.max(1000, delayMs) });
        logFn.debug('jitter armed for', Math.round(delayMs / 1000), 's');
        return;
    }
    await runScreenshot(settings);
}

/* ------------------------------------------------------------------ *
 * The capture itself
 * ------------------------------------------------------------------ */

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sleep in chunks, poking the runtime so the worker is not reaped mid-wait. */
async function keepAliveSleep(totalMs) {
    let remaining = totalMs;
    while (remaining > 0) {
        const chunk = Math.min(remaining, KEEPALIVE_CHUNK_MS);
        await sleep(chunk);
        remaining -= chunk;
        if (remaining > 0 && typeof chrome !== 'undefined' && chrome.runtime) {
            try { chrome.runtime.getManifest(); } catch (err) { /* never blocks the wait */ }
        }
    }
}

/** Resolve on the tab's `complete` status, its removal, or the hard timeout. */
function waitForTabComplete(tabId, timeoutMs = LOAD_TIMEOUT_MS) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (reason) => {
            if (settled) return;
            settled = true;
            try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch (err) { /* ignore */ }
            try { chrome.tabs.onRemoved.removeListener(onRemoved); } catch (err) { /* ignore */ }
            clearTimeout(timer);
            logFn.debug('load phase done:', reason);
            resolve();
        };
        const onUpdated = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo && changeInfo.status === 'complete') finish('complete');
        };
        const onRemoved = (removedTabId) => {
            if (removedTabId === tabId) finish('tab removed');
        };
        const timer = setTimeout(() => finish('timeout'), timeoutMs);
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.onRemoved.addListener(onRemoved);
        // The page may already be complete before we attached the listeners.
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) return finish('gone');
            if (tab && tab.status === 'complete') finish('already complete');
        });
    });
}

/** One capture attempt; returns a data URL or null. */
async function captureVisible(windowId) {
    try {
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 70 });
        return typeof dataUrl === 'string' && dataUrl.length > BLANK_CAPTURE_BYTES ? dataUrl : null;
    } catch (err) {
        logFn.debug('capture attempt failed:', err && err.message);
        return null;
    }
}

async function runScreenshot(settings) {
    logFn.info('capturing', settings.screenshotUrl);
    let windowId = null;
    try {
        const win = await chrome.windows.create({
            url: settings.screenshotUrl,
            type: 'popup',
            state: 'minimized',
            focused: false,
            width: 1280,
            height: 900
        });
        windowId = win && win.id;
        const tab = win && win.tabs && win.tabs[0];
        if (!tab || tab.id === undefined) throw new Error('browser did not return a tab');

        await waitForTabComplete(tab.id);
        await keepAliveSleep(settings.screenshotWaitMs);

        let image = await captureVisible(windowId);
        if (!image) {
            // Minimized windows often suspend rendering (blank / rejected
            // capture). Restore without stealing focus, give the compositor a
            // moment, then retry once.
            logFn.debug('retrying with window restored (no focus)');
            await chrome.windows.update(windowId, { state: 'normal', focused: false });
            await keepAliveSleep(800);
            image = await captureVisible(windowId);
        }
        if (!image) throw new Error('截图失败：无法捕获窗口内容（可能缺少站点权限）');

        await appendHistory({
            id: Date.now(),
            url: settings.screenshotUrl,
            timestamp: Date.now(),
            image
        });
        logFn.info('screenshot saved');
        return { ok: true };
    } catch (err) {
        logFn.error('screenshot failed:', err);
        throw err;
    } finally {
        if (windowId !== null) {
            try { await chrome.windows.remove(windowId); } catch (err) { /* already gone */ }
        }
    }
}

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

export function registerScreenshotScheduler() {
    handle('screenshot:trigger', async () => {
        const settings = await AIO.schema.load();
        if (!isValidHttpUrl(settings.screenshotUrl)) {
            throw new Error('请先在设置中填写有效的 http(s) 网页地址');
        }
        await runScreenshot(settings);
        const history = await readHistory();
        return { history };
    });

    handle('screenshot:getHistory', async () => {
        return { history: await readHistory() };
    });

    handle('screenshot:deleteHistory', async (message) => {
        const ids = message && Array.isArray(message.ids) ? message.ids : [];
        const previous = await readHistory();
        const next = previous.filter((item) => !ids.includes(item.id));
        await AIO.core.storage.set('local', { [HISTORY_KEY]: next });
        return { history: next };
    });

    if (typeof chrome === 'undefined' || !chrome.alarms) return; // Node test env

    chrome.alarms.onAlarm.addListener((alarm) => {
        onAlarm(alarm).catch((err) => logFn.error('alarm handler failed:', err));
    });

    // Re-arm whenever any screenshot setting changes (options page writes via
    // the schema; the worker picks the change up here).
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        const touched = Object.keys(changes).filter((key) => key.startsWith('screenshot'));
        if (touched.length) ensureAlarm().catch((err) => logFn.error('re-arm failed:', err));
    });

    ensureAlarm().catch((err) => logFn.error('initAlarm error:', err));
}
