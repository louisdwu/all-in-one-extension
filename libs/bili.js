/**
 * Bilibili URL helpers (pure).
 *
 * `purifyUrl` was the only piece of testable logic buried inside the background
 * service worker; it strips tracking parameters so incognito windows open clean
 * links (no `spm_id_from`, `vd_source`, `utm_*`, ...).
 */
(function (root) {
    'use strict';

    const AIO = (root.AIO = root.AIO || {});
    if (AIO.bili) return;

    const TRACK_PARAMS = [
        'trackid', 'track_id', 'caid', 'resource_id', 'source_id', 'request_id',
        'from_spmid', 'creative_id', 'linked_creative_id', 'vd_source',
        'spm_id_from', 'from', 'spm', 'scm', 'fbclid', 'gclid', 'hm_parameter',
        'share_source', 'share_medium', 'share_plat', 'share_tag', 'timestamp',
        'unique_k', 'bbid', 'ts', 'msource', 'night', 'spmid'
    ];

    /** Video / bangumi / watch-later pages: keep only `p` (part) and `t` (start). */
    function purifyBilibili(url) {
        const keys = Array.from(url.searchParams.keys());
        for (const key of keys) {
            const lower = key.toLowerCase();
            if (lower !== 'p' && lower !== 't') url.searchParams.delete(key);
        }
        return url;
    }

    /**
     * @param {string} urlStr
     * @returns {string} the cleaned URL, or the input when it cannot be parsed
     */
    function purifyUrl(urlStr) {
        let url;
        try {
            url = new URL(urlStr);
        } catch (err) {
            return urlStr;
        }
        if (url.hostname.endsWith('bilibili.com')) {
            const path = url.pathname;
            if (path.includes('/video/') || path.includes('/bangumi/play/') || path.includes('/watchlater/')) {
                return purifyBilibili(url).toString();
            }
        }
        for (const key of Array.from(url.searchParams.keys())) {
            const lower = key.toLowerCase();
            if (lower.startsWith('utm_') || TRACK_PARAMS.includes(lower)) url.searchParams.delete(key);
        }
        return url.toString();
    }

    function isVideoPage(urlStr) {
        try {
            const url = new URL(urlStr);
            if (!url.hostname.endsWith('bilibili.com')) return false;
            return url.pathname.includes('/video/') || url.pathname.includes('/bangumi/play/') || url.pathname.includes('/list/');
        } catch (err) {
            return false;
        }
    }

    /**
     * Cookie pairs that carry a bilibili login.
     *
     * `SESSDATA` is what the server authenticates; `DedeUserID` is what the page
     * uses to render the account. Both are HttpOnly on bilibili.com, so the only
     * way to "log in" an incognito window without typing a password is to write
     * them into its cookie store from the background (`chrome.cookies.set`).
     *
     * Pure: returns [] when no usable credential is stored.
     *
     * @param {{sessdata?: string, dedeUserId?: string}} cookies
     * @returns {Array<{name: string, value: string}>}
     */
    function loginCookies(cookies) {
        const source = cookies && typeof cookies === 'object' ? cookies : {};
        const sessdata = String(source.sessdata == null ? '' : source.sessdata).trim();
        if (!sessdata) return [];
        const pairs = [{ name: 'SESSDATA', value: sessdata }];
        const dedeUserId = String(source.dedeUserId == null ? '' : source.dedeUserId).trim();
        if (dedeUserId) pairs.push({ name: 'DedeUserID', value: dedeUserId });
        return pairs;
    }

    AIO.bili = { TRACK_PARAMS, purifyUrl, purifyBilibili, isVideoPage, loginCookies };
})(typeof globalThis !== 'undefined' ? globalThis : self);
