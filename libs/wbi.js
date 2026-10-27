/**
 * Bilibili WBI request signing.
 *
 * Bilibili signs most `/x/.../wbi/...` endpoints with `wts` + `w_rid`, using two
 * rotating keys published at `/x/web-interface/nav`. To re-request a playurl at a
 * different quality we have to re-sign the query ourselves.
 *
 * Pure functions only — the caller supplies the keys and (optionally) the clock,
 * which makes this testable.
 */
(function (root) {
    'use strict';

    const AIO = (root.AIO = root.AIO || {});
    if (AIO.wbi) return;

    const MIXIN_KEY_ENC_TAB = [
        46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
        33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
        61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62,
        11, 36, 20, 34, 44, 52
    ];

    function md5() {
        if (typeof AIO.md5 !== 'function') throw new Error('libs/md5.js must load before libs/wbi.js');
        return AIO.md5;
    }

    /** Permute the two published keys into the 32-char mixin key. */
    function getMixinKey(orig) {
        return MIXIN_KEY_ENC_TAB.map((index) => orig[index]).join('').slice(0, 32);
    }

    /** "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png" → "7cd0..." */
    function useWebKey(keyUrl) {
        if (!keyUrl || typeof keyUrl !== 'string') return '';
        const slash = keyUrl.lastIndexOf('/');
        const dot = keyUrl.lastIndexOf('.');
        return keyUrl.slice(slash + 1, dot > slash ? dot : undefined);
    }

    function cleanValue(value) {
        return String(value == null ? '' : value).replace(/[!'()*]/g, '');
    }

    /**
     * Build a signed query string.
     * @param {Record<string, string|number>} params
     * @param {string} imgKey
     * @param {string} subKey
     * @param {number} [nowMs]
     */
    function encWbi(params, imgKey, subKey, nowMs) {
        const mixinKey = getMixinKey(imgKey + subKey);
        const wts = Math.round((nowMs || Date.now()) / 1000);
        const merged = Object.assign({}, params, { wts: wts });
        delete merged.w_rid;
        const query = Object.keys(merged).sort().map(function (key) {
            return encodeURIComponent(key) + '=' + encodeURIComponent(cleanValue(merged[key]));
        }).join('&');
        return query + '&w_rid=' + md5()(query + mixinKey);
    }

    AIO.wbi = { MIXIN_KEY_ENC_TAB, getMixinKey, useWebKey, cleanValue, encWbi };
})(typeof globalThis !== 'undefined' ? globalThis : self);
