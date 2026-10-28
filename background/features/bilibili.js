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
import '../../libs/bili.js';
import { handle, broadcast } from '../router.js';
import { isAllowedIncognitoAccess } from './incognito.js';

const { log, storage } = globalThis.AIO.core;
const biliLog = log('bilibili');

const COOKIE_NAME = 'aio_pnd';
const COOKIE_DOMAIN = '.bilibili.com';
const BILI_URL = 'https://www.bilibili.com';
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

/**
 * Write the stored 「专用账号」 login into an incognito cookie store.
 *
 * Why this exists: bilibili stopped serving >480P streams to logged-out clients
 * (a playurl at qn=80 still returns quality=64 with 480P/360P renditions), so
 * the old "fake the nav response, then ask for 1080P" trick cannot produce real
 * 1080P any more. An incognito window therefore needs a real session, and the
 * only one we are allowed to use is the SESSDATA the user saved by hand.
 *
 * No `expirationDate` on purpose: these are session cookies, so the credential
 * dies with the incognito session instead of lingering on disk.
 */
async function seedIncognitoLogin(storeId, options = {}) {
    const overwrite = options.overwrite === true;
    if (!storeId) return { ok: false, reason: 'no_store' };

    const settings = await globalThis.AIO.schema.load();
    if (!settings.biliIncognitoLogin) return { ok: false, reason: 'disabled' };

    const pairs = globalThis.AIO.bili.loginCookies(settings.biliCookies);
    if (!pairs.length) return { ok: false, reason: 'no_credential' };

    if (!overwrite) {
        const existing = await chrome.cookies.get({ url: BILI_URL, name: 'SESSDATA', storeId }).catch(() => null);
        if (existing && existing.value) return { ok: true, skipped: 'already_logged_in' };
    }

    let written = 0;
    for (const pair of pairs) {
        try {
            await chrome.cookies.set({
                url: BILI_URL,
                name: pair.name,
                value: pair.value,
                domain: COOKIE_DOMAIN,
                path: '/',
                secure: true,
                httpOnly: true,
                sameSite: 'lax',
                storeId
            });
            written += 1;
        } catch (err) {
            biliLog.debug('incognito login cookie failed for', pair.name, err.message);
        }
    }

    // Older builds faked a login by writing a non-HttpOnly `DedeUserID` cookie
    // from the page. With only SESSDATA stored that fake would survive and
    // disagree with the real session, so drop it.
    if (written && !pairs.some((pair) => pair.name === 'DedeUserID')) {
        await chrome.cookies.remove({ url: BILI_URL, name: 'DedeUserID', storeId }).catch(() => {});
    }

    if (written) biliLog.info('incognito session seeded with', written, 'cookie(s)');
    return { ok: written > 0, written };
}

/** Re-seed every incognito store that is currently alive. */
async function seedAllIncognitoStores(options) {
    const stores = await listStores();
    return Promise.all(stores.filter((store) => store.incognito)
        .map((store) => seedIncognitoLogin(store.id, options)));
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

    /**
     * Is the page that asked us logged in? Answering from the background is the
     * only reliable way: SESSDATA/DedeUserID are HttpOnly, so a content script
     * cannot see them in `document.cookie`.
     */
    handle('bili:loginState', async (message, sender) => {
        const tab = sender && sender.tab;
        const storeId = tab ? tab.cookieStoreId : undefined;
        const cookie = await chrome.cookies.get({ url: BILI_URL, name: 'SESSDATA', storeId }).catch(() => null);
        return {
            ok: true,
            loggedIn: !!(cookie && cookie.value),
            incognito: !!(tab && tab.incognito)
        };
    });

    /** Settings page: can incognito even run us, and is there a credential? */
    handle('bili:incognitoStatus', async () => {
        const settings = await globalThis.AIO.schema.load();
        return {
            ok: true,
            allowed: await isAllowedIncognitoAccess(),
            loginEnabled: settings.biliIncognitoLogin,
            hasCredential: globalThis.AIO.bili.loginCookies(settings.biliCookies).length > 0
        };
    });

    /** Manual "make this incognito window logged in now" (used by the options page). */
    handle('bili:seedIncognitoLogin', async () => {
        const results = await seedAllIncognitoStores({ overwrite: true });
        const seeded = results.filter((result) => result && result.ok).length;
        return { ok: seeded > 0, seeded, results };
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
        if (area !== 'sync') return;
        if (changes.biliPlayNextDisabled) {
            syncPlayNextCookie(!!changes.biliPlayNextDisabled.newValue);
        }
        // A freshly saved/captured credential (or a toggled switch) must reach
        // incognito windows that are already open.
        if (changes.biliCookies || changes.biliIncognitoLogin) {
            seedAllIncognitoStores({ overwrite: true });
        }
    });

    // Cookie work runs per navigation: seed the incognito login (1080P needs a
    // real session) and keep the play-next flag cookie in the tab's store.
    chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
        if (details.frameId !== 0) return;
        const settings = await globalThis.AIO.schema.load();
        if (!settings.biliIncognitoLogin && !settings.biliPlayNextDisabled) return;
        const tab = await chrome.tabs.get(details.tabId).catch(() => null);
        if (!tab || !tab.cookieStoreId) return;
        if (tab.incognito && settings.biliIncognitoLogin) await seedIncognitoLogin(tab.cookieStoreId);
        if (settings.biliPlayNextDisabled) await ensureCookieInStore(tab.cookieStoreId);
    }, { url: [{ hostSuffix: 'bilibili.com' }] });

    // Align once on worker start.
    storage.getSync(['biliPlayNextDisabled']).then((res) => {
        syncPlayNextCookie(!!res.biliPlayNextDisabled);
    });
}
