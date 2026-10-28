/**
 * Per-site video speed memory (pure helpers).
 *
 * Behaviour is a 3-way mode, not a boolean:
 *   'off'    → always start from the configured default speed
 *   'global' → remember the last speed used anywhere
 *   'site'   → remember one speed per hostname (the useful default)
 *
 * Storage shape (chrome.storage.local):
 *   speederSpeeds    = { "www.youtube.com": 1.75, ... }   (newest first, capped)
 *   speederLastSpeed = 1.5                                 (global mode)
 */
(function (root) {
    'use strict';

    const AIO = (root.AIO = root.AIO || {});
    if (AIO.speedMemory) return;

    const MAX_ENTRIES = 200;
    const MIN_SPEED = 0.1;
    const MAX_SPEED = 16;
    const MODES = ['off', 'global', 'site'];

    /** @returns {number|null} rounded to 2 decimals, or null when unusable */
    function clampSpeed(value) {
        const num = typeof value === 'number' ? value : parseFloat(value);
        if (!isFinite(num) || num <= 0) return null;
        return Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, num)) * 100) / 100;
    }

    /** Drop invalid entries and coerce every value to a usable number. */
    function normalize(store) {
        const out = {};
        if (!store || typeof store !== 'object' || Array.isArray(store)) return out;
        for (const [host, speed] of Object.entries(store)) {
            if (typeof host !== 'string' || !host) continue;
            const value = clampSpeed(speed);
            if (value === null) continue;
            out[host] = value;
        }
        return out;
    }

    /**
     * Which speed should a page start with?
     * @param {Record<string, number>} store
     * @param {string} hostname
     * @param {{mode?: string, defaultSpeed?: number, globalSpeed?: number}} options
     */
    function resolve(store, hostname, options) {
        const opts = options || {};
        const fallback = clampSpeed(opts.defaultSpeed) === null ? 1 : clampSpeed(opts.defaultSpeed);
        if (opts.mode === 'site' && hostname) {
            const value = normalize(store)[hostname];
            return value === undefined ? fallback : value;
        }
        if (opts.mode === 'global') {
            const value = clampSpeed(opts.globalSpeed);
            return value === null ? fallback : value;
        }
        return fallback;
    }

    /** Insert/update one host at the head of the map, pruning the oldest tail. */
    function remember(store, hostname, speed, maxEntries) {
        const current = normalize(store);
        const value = clampSpeed(speed);
        if (!hostname || value === null) return current;

        const next = {};
        next[hostname] = value;
        for (const [host, stored] of Object.entries(current)) {
            if (host !== hostname) next[host] = stored;
        }
        const keys = Object.keys(next);
        const cap = maxEntries || MAX_ENTRIES;
        if (keys.length > cap) {
            for (const host of keys.slice(cap)) delete next[host];
        }
        return next;
    }

    function isMode(value) {
        return MODES.includes(value);
    }

    AIO.speedMemory = { MAX_ENTRIES, MIN_SPEED, MAX_SPEED, MODES, clampSpeed, normalize, resolve, remember, isMode };
})(typeof globalThis !== 'undefined' ? globalThis : self);
