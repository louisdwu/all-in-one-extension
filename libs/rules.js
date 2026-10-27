/**
 * URL include/exclude rules.
 *
 * Behaviour contract (kept from the original implementation, now explicit):
 *   - `includeRules` non-empty  → the URL must match at least one include rule.
 *   - otherwise `excludeRules`   → matching any exclude rule disables the feature.
 *   - invalid regexes never throw: they are ignored (and reported once).
 */
(function (root) {
    'use strict';

    const AIO = (root.AIO = root.AIO || {});
    if (AIO.rules) return;

    const cache = new Map();
    const MAX_CACHE = 200;
    const reported = new Set();

    function compile(pattern) {
        if (typeof pattern !== 'string' || !pattern) return null;
        if (cache.has(pattern)) return cache.get(pattern);
        let regex = null;
        try {
            regex = new RegExp(pattern);
        } catch (err) {
            if (!reported.has(pattern)) {
                reported.add(pattern);
                const log = AIO.core && AIO.core.log ? AIO.core.log('rules') : console;
                (log.warn || console.warn)('ignoring invalid rule:', pattern, err.message);
            }
        }
        if (cache.size >= MAX_CACHE) cache.clear();
        cache.set(pattern, regex);
        return regex;
    }

    function testAny(url, patterns) {
        if (!Array.isArray(patterns) || patterns.length === 0) return false;
        for (const pattern of patterns) {
            const regex = compile(pattern);
            if (regex && regex.test(url)) return true;
        }
        return false;
    }

    function matches(url, rules) {
        const options = rules || {};
        const target = String(url || '');
        if (Array.isArray(options.includeRules) && options.includeRules.length) {
            return testAny(target, options.includeRules);
        }
        if (testAny(target, options.excludeRules)) return false;
        return true;
    }

    function clearCache() {
        cache.clear();
        reported.clear();
    }

    AIO.rules = { matches, testAny, compile, clearCache };
})(typeof globalThis !== 'undefined' ? globalThis : self);
