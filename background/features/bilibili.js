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

export async function resolveStoreId(tab) {
    if (!tab) return undefined;
    if (tab.cookieStoreId) return tab.cookieStoreId;
    if (!tab.incognito) return '0';
    try {
        const stores = await listStores();
        const matching = stores.find((s) => s.tabIds && s.tabIds.includes(tab.id));
        if (matching) return matching.id;
    } catch (err) { /* ignore */ }
    return '1';
}

/**
 * Credential alert badge. When a seeded incognito session turns out to be
 * invalid (server says "not logged in" while we believe it is), the toolbar
 * icon shows a red `!` until the credential is fixed. HUD icon updates
 * cooperate: hud/icon.js never clears a '!' badge.
 */
const ALERT_COLOR = '#d93025';
const credentialAlert = { on: false };

async function applyCredentialAlert(on) {
    if (credentialAlert.on === on) return;
    credentialAlert.on = on;
    try {
        if (!chrome.action || !chrome.action.setBadgeText) return;
        await chrome.action.setBadgeBackgroundColor({ color: ALERT_COLOR });
        await chrome.action.setBadgeText({ text: on ? '!' : '' });
    } catch (err) {
        biliLog.warn('credential alert badge failed', err.message);
    }
    biliLog.info('credential alert', on ? 'raised' : 'cleared');
}

/** Badge state lives in the browser across SW restarts; re-learn it on boot. */
async function restoreCredentialAlert() {
    try {
        if (!chrome.action || !chrome.action.getBadgeText) return;
        const { text } = await chrome.action.getBadgeText({});
        credentialAlert.on = text === '!';
    } catch (err) { /* ignore */ }
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
export async function seedIncognitoLogin(storeId, options = {}) {
    const overwrite = options.overwrite === true;
    const targetStoreId = storeId || '1';

    const settings = await globalThis.AIO.schema.load();
    if (!settings.biliIncognitoLogin) return { ok: false, reason: 'disabled' };

    const pairs = globalThis.AIO.bili.loginCookies(settings.biliCookies);
    if (!pairs.length) return { ok: false, reason: 'no_credential' };

    if (!overwrite) {
        const existing = await chrome.cookies.get({ url: BILI_URL, name: 'SESSDATA', storeId: targetStoreId }).catch(() => null);
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
                httpOnly: pair.name === 'SESSDATA',
                sameSite: 'lax',
                storeId: targetStoreId
            });
            written += 1;
        } catch (err) {
            biliLog.warn('incognito login cookie failed for', pair.name, err.message);
        }
    }

    // Older builds faked a login by writing a non-HttpOnly `DedeUserID` cookie
    // from the page. With only SESSDATA stored that fake would survive and
    // disagree with the real session, so drop it.
    if (written && !pairs.some((pair) => pair.name === 'DedeUserID')) {
        await chrome.cookies.remove({ url: BILI_URL, name: 'DedeUserID', storeId: targetStoreId }).catch(() => {});
    }

    if (written) {
        biliLog.info('incognito session seeded with', written, 'cookie(s) into store', targetStoreId);
        // A successful seed means the credential works again (or at least is
        // fresh); the page will re-report if the server still rejects it.
        await applyCredentialAlert(false);
    }
    return { ok: written > 0, written };
}

/** Re-seed every incognito store that is currently alive. */
export async function seedAllIncognitoStores(options) {
    const stores = await listStores();
    const incognitoStores = stores.filter((store) => store.id !== '0');
    const targetIds = incognitoStores.length ? incognitoStores.map((s) => s.id) : ['1'];
    return Promise.all(targetIds.map((id) => seedIncognitoLogin(id, options)));
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
        const storeId = await resolveStoreId(tab);
        let cookie = await chrome.cookies.get({ url: BILI_URL, name: 'SESSDATA', storeId }).catch(() => null);
        if ((!cookie || !cookie.value) && tab && tab.incognito) {
            const seedRes = await seedIncognitoLogin(storeId);
            if (seedRes && seedRes.ok) {
                cookie = await chrome.cookies.get({ url: BILI_URL, name: 'SESSDATA', storeId }).catch(() => null);
            }
        }
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

    /**
     * Verify the incognito session against the real nav endpoint.
     *
     * Two hard facts shape this handler:
     *  1. "Cookie exists in a store" says nothing about validity — an expired
     *     SESSDATA still looks stored, while the server keeps handing out 480P.
     *  2. fetch() from the SW / extension pages strips the `Cookie` header
     *     (forbidden header, verified with an echo server), so a "direct"
     *     header-based check would ALWAYS report invalid.
     *
     * The only jar-accurate check is therefore a live incognito bilibili tab:
     * inject a probe with chrome.scripting and let the page fetch nav with
     * `credentials: 'include'` — the cookies come from that tab's incognito
     * jar, i.e. exactly the session that matters for 1080P.
     */
    handle('bili:verifyCredential', async () => {
        const settings = await globalThis.AIO.schema.load();
        const sessdata = (settings.biliCookies && settings.biliCookies.sessdata || '').trim();
        if (!sessdata) return { ok: true, verified: false, reason: 'no_credential' };

        let tabs = [];
        try {
            tabs = await chrome.tabs.query({ url: '*://*.bilibili.com/*' });
        } catch (err) {
            return { ok: false, error: err.message };
        }
        const incognitoTabs = tabs.filter((tab) => tab && tab.incognito);
        if (!incognitoTabs.length) {
            return { ok: true, verified: false, reason: 'no_incognito_tab' };
        }

        const probeNav = async () => {
            try {
                const resp = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
                const json = await resp.json();
                return {
                    isLogin: !!(json && json.data && json.data.isLogin),
                    mid: json && json.data ? json.data.mid : 0
                };
            } catch (err) {
                return { error: String(err && err.message || err) };
            }
        };

        for (const tab of incognitoTabs) {
            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: probeNav
                });
                const value = results && results[0] && results[0].result;
                if (!value || value.error) {
                    biliLog.debug('nav probe failed in tab', tab.id, value && value.error);
                    continue;
                }
                biliLog.info('incognito session verify:', value.isLogin ? 'valid' : 'invalid');
                return { ok: true, verified: true, valid: value.isLogin, mid: value.isLogin ? value.mid : 0, via: 'incognito_tab' };
            } catch (err) {
                biliLog.debug('executeScript failed for tab', tab.id, err.message);
            }
        }
        return { ok: false, error: 'probe_failed' };
    });

    /** Manual "make this incognito window logged in now" (used by the options page). */
    handle('bili:seedIncognitoLogin', async () => {
        const results = await seedAllIncognitoStores({ overwrite: true });
        const seeded = results.filter((result) => result && result.ok).length;
        return { ok: seeded > 0, seeded, results };
    });

    /**
     * guard.js reports login transitions observed in incognito bilibili tabs
     * (background answer + live nav responses relayed via the DOM attribute).
     * `loggedIn:false` while the feature is on means the stored credential is
     * expired/rejected → raise the toolbar alert; `true` clears it.
     */
    handle('bili:reportLoginState', async (message, sender) => {
        const tab = sender && sender.tab;
        if (!tab || !tab.incognito) return { ok: true, ignored: 'not_incognito' };
        const settings = await globalThis.AIO.schema.load();
        if (!settings.biliIncognitoLogin) return { ok: true, ignored: 'disabled' };
        if (message.loggedIn === false) {
            await applyCredentialAlert(true);
        } else if (message.loggedIn === true) {
            await applyCredentialAlert(false);
        }
        return { ok: true };
    });

    /**
     * Pull the dedicated account's cookies — from INCOGNITO stores only.
     *
     * The intended flow is: the user logs into a throwaway/dedicated account in
     * an incognito window, then clicks the capture button. The regular window's
     * main account is never read: store '0' is skipped unconditionally, and
     * without an open incognito window the call refuses (`no_incognito_store`).
     */
    handle('bili:captureCookies', async () => {
        const stores = await listStores();
        // Chrome labels the regular store '0' / incognito '1'; Firefox flags the
        // store itself. Both shapes are covered: never read '0'.
        const incognitoStores = stores.filter((store) =>
            store.incognito === true || (store.id && store.id !== '0'));
        if (!incognitoStores.length) return { ok: false, error: 'no_incognito_store' };

        for (const store of incognitoStores) {
            try {
                const cookies = await chrome.cookies.getAll({ url: 'https://www.bilibili.com', storeId: store.id });
                let sessdata = '';
                let dedeUserId = '';
                let biliJct = '';
                let dedeUserIdCkMd5 = '';
                for (const cookie of cookies) {
                    if (cookie.name === 'SESSDATA') sessdata = cookie.value;
                    if (cookie.name === 'DedeUserID') dedeUserId = cookie.value;
                    if (cookie.name === 'bili_jct') biliJct = cookie.value;
                    if (cookie.name === 'DedeUserID__ckMd5') dedeUserIdCkMd5 = cookie.value;
                }
                if (sessdata || dedeUserId) {
                    return {
                        ok: true,
                        sessdata,
                        dedeUserId,
                        biliJct,
                        dedeUserIdCkMd5,
                        incognito: true,
                        storeId: store.id
                    };
                }
            } catch (err) {
                biliLog.debug('cookie read failed for incognito store', store.id, err.message);
            }
        }
        return { ok: false, error: 'no_cookies' };
    }, ['FETCH_BILI_COOKIES']);

    // Keep the cookie aligned with the stored setting.
    chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== 'sync') return;
        if (changes.biliPlayNextDisabled) {
            syncPlayNextCookie(!!changes.biliPlayNextDisabled.newValue);
        }
        // A freshly saved/captured credential (or a toggled switch) must reach
        // incognito windows that are already open. A new credential is assumed
        // good; the alert badge goes away (pages will re-report if not).
        if (changes.biliCookies) await applyCredentialAlert(false);
        if (changes.biliCookies || changes.biliIncognitoLogin) {
            seedAllIncognitoStores({ overwrite: true });
        }
    });

    void restoreCredentialAlert();

    // Preemptively seed when an incognito tab is created.
    if (chrome.tabs && chrome.tabs.onCreated) {
        chrome.tabs.onCreated.addListener(async (tab) => {
            if (!tab || !tab.incognito) return;
            const settings = await globalThis.AIO.schema.load();
            if (!settings.biliIncognitoLogin) return;
            const storeId = await resolveStoreId(tab);
            await seedIncognitoLogin(storeId);
        });
    }

    // Also seed when an incognito window is created.
    if (chrome.windows && chrome.windows.onCreated) {
        chrome.windows.onCreated.addListener(async (win) => {
            if (!win || !win.incognito) return;
            const settings = await globalThis.AIO.schema.load();
            if (!settings.biliIncognitoLogin) return;
            await seedAllIncognitoStores();
        });
    }

    // Cookie work runs per navigation: seed the incognito login (1080P needs a
    // real session) and keep the play-next flag cookie in the tab's store.
    chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
        if (details.frameId !== 0) return;
        const settings = await globalThis.AIO.schema.load();
        if (!settings.biliIncognitoLogin && !settings.biliPlayNextDisabled) return;
        const tab = await chrome.tabs.get(details.tabId).catch(() => null);
        if (!tab) return;
        const storeId = await resolveStoreId(tab);
        if (tab.incognito && settings.biliIncognitoLogin) await seedIncognitoLogin(storeId);
        if (settings.biliPlayNextDisabled) await ensureCookieInStore(storeId);
    }, { url: [{ hostSuffix: 'bilibili.com' }] });

    // Align once on worker start.
    storage.getSync(['biliPlayNextDisabled']).then((res) => {
        syncPlayNextCookie(!!res.biliPlayNextDisabled);
    });
}
