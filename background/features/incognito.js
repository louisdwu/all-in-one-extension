/**
 * "Open link in incognito" backend.
 */
import '../../libs/core.js';
import '../../libs/bili.js';
import { handle, notifySender } from '../router.js';

const { log } = globalThis.AIO.core;
const incogLog = log('incognito');

/** Chrome refuses incognito windows unless the user allowed it per extension. */
function isAllowedIncognitoAccess() {
    return new Promise((resolve) => {
        try {
            if (!chrome.extension || typeof chrome.extension.isAllowedIncognitoAccess !== 'function') {
                return resolve(true); // let windows.create() surface the real error
            }
            chrome.extension.isAllowedIncognitoAccess((allowed) => {
                void chrome.runtime.lastError;
                resolve(!!allowed);
            });
        } catch (err) {
            resolve(false);
        }
    });
}

export function registerIncognito() {
    handle('incognito:open', async (message, sender) => {
        if (!message.url) return { ok: false, error: 'missing url' };
        const cleanUrl = globalThis.AIO.bili.purifyUrl(String(message.url));

        if (!(await isAllowedIncognitoAccess())) {
            await notifySender(sender, '无法打开无痕窗口：请在扩展详情页开启「在无痕模式下启用」');
            return { ok: false, error: 'incognito_disabled' };
        }

        try {
            await chrome.windows.create({ url: cleanUrl, incognito: true, focused: true, state: 'maximized' });
            incogLog.debug('opened', cleanUrl);
            return { ok: true, url: cleanUrl };
        } catch (err) {
            incogLog.error('windows.create failed', err);
            await notifySender(sender, '打开无痕窗口失败：' + err.message);
            return { ok: false, error: err.message };
        }
    }, ['openIncognito']);
}
