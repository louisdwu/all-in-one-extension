/**
 * Content-script runtime (ISOLATED world only).
 *
 * Provides the pieces every content script needs, loaded once:
 *   - a cached, change-aware view of the normalized settings
 *   - a shadow-DOM toast for user-visible errors
 *   - a per-script logger
 *
 * Requires libs/core.js + libs/schema.js to be listed earlier in the same
 * content_scripts bundle.
 */
(function (root) {
    'use strict';

    const AIO = (root.AIO = root.AIO || {});
    if (AIO.content) return;
    if (!AIO.core || !AIO.schema) return; // misconfigured manifest: fail soft

    const { log, dom } = AIO.core;
    const contentLog = log('content');

    /** @type {object|null} */
    let cache = null;
    let loading = null;
    const watchers = new Set();

    function settings() {
        if (cache) return Promise.resolve(cache);
        if (!loading) {
            loading = AIO.schema.load().then((value) => {
                cache = value;
                loading = null;
                return value;
            }, () => {
                loading = null;
                return AIO.schema.normalize({});
            });
        }
        return loading;
    }

    function onChange(handler) {
        watchers.add(handler);
        return () => watchers.delete(handler);
    }

    AIO.schema.subscribe((next) => {
        cache = next;
        for (const handler of watchers) {
            try {
                handler(next);
            } catch (err) {
                contentLog.error('settings watcher failed', err);
            }
        }
    });

    /* ------------------------------ toast ------------------------------ */
    const TOAST_CSS = `
        :host { all: initial; }
        .wrap {
            position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%);
            display: flex; flex-direction: column; gap: 8px; align-items: center;
            z-index: 2147483647; pointer-events: none;
            font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .toast {
            padding: 10px 16px; border-radius: 10px; color: #fff;
            background: rgba(30, 30, 30, .92); box-shadow: 0 8px 24px rgba(0,0,0,.28);
            max-width: 70vw; animation: in .18s ease-out;
        }
        .toast.error { background: rgba(211, 47, 47, .95); }
        .toast.success { background: rgba(46, 125, 50, .95); }
        @keyframes in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    `;

    function toast(message, level = 'info', timeout = 2600) {
        if (!message) return;
        const { root: shadow } = dom.shadowHost('aio-toast-host', TOAST_CSS);
        let wrap = shadow.querySelector('.wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.className = 'wrap';
            shadow.appendChild(wrap);
        }
        const item = document.createElement('div');
        item.className = 'toast ' + level;
        item.textContent = message;
        wrap.appendChild(item);
        setTimeout(() => {
            item.remove();
            if (!wrap.children.length) {
                const host = document.getElementById('aio-toast-host');
                if (host) host.remove();
            }
        }, timeout);
    }

    AIO.content = {
        /** Use as `AIO.content.log('tag')` — same signature as AIO.core.log. */
        log,
        logger: contentLog,
        settings,
        onChange,
        toast,
        /** Skip all work in sub-frames (UI must not be duplicated). */
        isTopFrame: (() => {
            try { return window.top === window; } catch (err) { return false; }
        })(),
        isEditable(target) {
            if (!target) return false;
            const tag = (target.tagName || '').toLowerCase();
            return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable === true;
        }
    };
})(typeof globalThis !== 'undefined' ? globalThis : self);
