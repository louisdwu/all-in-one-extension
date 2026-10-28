/**
 * Minimal i18n bridge (classic-compatible, import-safe in Node).
 *
 * Strategy: UI copy stays inline in Chinese so the source is readable and the
 * page works with zero JavaScript. Elements opt in with `data-i18n="key"`; on
 * startup `apply()` replaces the text *only when the active locale defines the
 * key*. That makes translation incremental: add a key to _locales/<lang>/ and
 * annotate the element, no other change required.
 *
 * Attribute variants: data-i18n-placeholder, data-i18n-title, data-i18n-aria-label.
 */
(function (root) {
    'use strict';

    const AIO = (root.AIO = root.AIO || {});
    if (AIO.i18n) return;

    function hasChromeI18n() {
        return typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function';
    }

    /**
     * @param {string} key message key from _locales/<locale>/messages.json
     * @param {string} [fallback] used when the locale has no such key
     * @param {string|string[]} [substitutions]
     */
    function t(key, fallback, substitutions) {
        if (!key) return fallback || '';
        if (hasChromeI18n()) {
            try {
                const message = chrome.i18n.getMessage(key, substitutions);
                if (message) return message;
            } catch (err) { /* fall through to the inline copy */ }
        }
        return fallback || key;
    }

    const ATTR_MAP = [
        ['data-i18n', null],
        ['data-i18n-placeholder', 'placeholder'],
        ['data-i18n-title', 'title'],
        ['data-i18n-aria-label', 'aria-label']
    ];

    /**
     * Translate every annotated node inside `scope`.
     * @returns {number} how many nodes were changed
     */
    function apply(scope) {
        const rootNode = scope || (typeof document !== 'undefined' ? document : null);
        if (!rootNode || typeof rootNode.querySelectorAll !== 'function') return 0;
        let changed = 0;
        for (const [attribute, target] of ATTR_MAP) {
            for (const el of rootNode.querySelectorAll('[' + attribute + ']')) {
                const key = el.getAttribute(attribute);
                const message = t(key, '');
                if (!message) continue;
                if (target) el.setAttribute(target, message);
                else el.textContent = message;
                changed++;
            }
        }
        return changed;
    }

    function locale() {
        try {
            return chrome.i18n.getUILanguage();
        } catch (err) {
            return 'zh-CN';
        }
    }

    AIO.i18n = { t, apply, locale };
})(typeof globalThis !== 'undefined' ? globalThis : self);
