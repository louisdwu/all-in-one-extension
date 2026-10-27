/**
 * Bilibili feature backend.
 *
 * Responsibilities:
 *  - persist bilibili toggles through the schema (single source of truth)
 *  - keep the `aio_pnd` cookie in sync with the "stop after finish" toggle.
 *    The old code wrote this cookie on *every* install and page navigation even
 *    when the feature was off, permanently polluting the user's bilibili cookie
 *    jar; now the cookie only exists while the feature is enabled.
 *  - capture SESSDATA / DedeUserID from any cookie store (including incognito)
 */
import '../../libs/core.js';
import '../../libs/schema.js';
import { handle, broadcast } from '../router.js';

const { log, storage } = globalThis.AIO.core;
const biliLog = log('bilibili');

const COOKIE_NAME = 'aio_pnd';
const COOKIE_DOMAIN = '.bilibili.com';
const ONE_YEAR = 365 * 24 * 60 * 60;

async function listStores() {
    try {
        return await chrome.cookies.getAllCookieStores();
    } catch (err) {
        return [];
    }
}

/** Create the flag cookie when enabled, delete it when disabled. */
export async function syncPlayNextCookie(enabled) {
    const stores = await listStores();
    await Promise.all(stores.map(async (store) => {
        try {
            if (enabled) {
                await chrome.cookies.set({
                    url: 'https://www.bilibili.com',
                    name: COOKIE_NAME,
                    value: '1',
                    domain: COOKIE_DOMAIN,
                    path: '/',
                    secure: true,
                    sameSite: 'lax',
                    expirationDate: Math.floor(Date.now() / 1000) + ONE_YEAR,
                    storeId: store.id
                });
            } else {
                await chrome.cookies.remove({ url: 'https://www.bilibili.com', name: COOKIE_NAME, storeId: store.id });
            }
        } catch (err) {
            biliLog.debug('cookie sync skipped for store', store.id, err.message);
        }
    }));
}

async function ensureCookieInStore(storeId) {
    try {
        await chrome.cookies.set({
            url: 'https://www.bilibili.com',
            name: COOKIE_NAME,
            value: '1',
            domain: COOKIE_DOMAIN,
            path: '/',
            secure: true,
            sameSite: 'lax',
            expirationDate: Math.floor(Date.now() / 1000) + ONE_YEAR,
            storeId
        });
    } catch (err) {
        biliLog.debug('navigation cookie sync skipped', err.message);
    }
}

export function registerBilibili() {
    handle('bili:getSettings', async () => {
        const settings = await globalThis.AIO.schema.load();
        return {
            enabled: settings.biliEnabled,
            autoSubtitle: settings.biliAutoSubtitle,
            subtitleHotkey: settings.bilibiliSubtitles.subtitleHotkey,
            video1080p: settings.bilibili1080PEnabled,
            comments: settings.biliCommentsEnabled,
            aiSubtitle: settings.biliAISubtitleEnabled,
            autoplay: settings.biliAutoPlay,
            playNextDisabled: settings.biliPlayNextDisabled,
            cookies: settings.biliCookies
        };
    });

    handle('bili:saveSettings', async (message) => {
        const patch = message.settings || message.patch || {};
        const settings = await globalThis.AIO.schema.save(patch);
        await syncPlayNextCookie(settings.biliPlayNextDisabled);
        await broadcast({ type: 'bili:settingsChanged' }, { url: ['*://*.bilibili.com/*'] });
        return { ok: true, success: true, settings };
    });

    /* --- legacy message names, kept while older UI bundles may still be cached --- */
    handle('getBilibiliSettings', async () => {
        const settings = await globalThis.AIO.schema.load();
        return { bilibiliSubtitles: settings.bilibiliSubtitles };
    });

    handle('saveBilibiliSettings', async (message) => {
        const settings = await globalThis.AIO.schema.save({ bilibiliSubtitles: message.settings || {} });
        await broadcast({ type: 'bili:settingsChanged' }, { url: ['*://*.bilibili.com/*'] });
        return { ok: true, success: true, bilibiliSubtitles: settings.bilibiliSubtitles };
    });

    handle('getBilibili1080PSettings', async () => {
        const settings = await globalThis.AIO.schema.load();
        return { enabled: settings.bilibili1080PEnabled };
    });

    handle('saveBilibili1080PSettings', async (message) => {
        const settings = await globalThis.AIO.schema.save({ bilibili1080PEnabled: message.enabled !== false });
        await broadcast({ type: 'bili:settingsChanged' }, { url: ['*://*.bilibili.com/*'] });
        return { ok: true, success: true, enabled: settings.bilibili1080PEnabled };
    });

    /** Pull SESSDATA/DedeUserID out of the browser (incognito store preferred). */
    handle('bili:captureCookies', async () => {
        const stores = await listStores();
        const preferred = stores.find((store) => store.incognito) || stores[0];
        const order = preferred ? [preferred, ...stores.filter((store) => store !== preferred)] : stores;
        for (const store of order) {
            try {
                const cookies = await chrome.cookies.getAll({ url: 'https://www.bilibili.com', storeId: store.id });
                let sessdata = '';
                let dedeUserId = '';
                for (const cookie of cookies) {
                    if (cookie.name === 'SESSDATA') sessdata = cookie.value;
                    if (cookie.name === 'DedeUserID') dedeUserId = cookie.value;
                }
                if (sessdata || dedeUserId) return { ok: true, sessdata, dedeUserId, incognito: !!store.incognito };
            } catch (err) {
                biliLog.debug('cookie read failed for store', store.id, err.message);
            }
        }
        return { ok: false, error: 'no_cookies' };
    }, ['FETCH_BILI_COOKIES']);

    // Keep the cookie aligned with the stored setting.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.biliPlayNextDisabled) {
            syncPlayNextCookie(!!changes.biliPlayNextDisabled.newValue);
        }
    });

    // Only touch cookies while the feature is actually enabled.
    chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
        if (details.frameId !== 0) return;
        const settings = await globalThis.AIO.schema.load();
        if (!settings.biliPlayNextDisabled) return;
        const tab = await chrome.tabs.get(details.tabId).catch(() => null);
        if (!tab || !tab.cookieStoreId) return;
        await ensureCookieInStore(tab.cookieStoreId);
    }, { url: [{ hostSuffix: 'bilibili.com' }] });

    // Align once on worker start.
    storage.getSync(['biliPlayNextDisabled']).then((res) => {
        syncPlayNextCookie(!!res.biliPlayNextDisabled);
    });
}
