/**
 * AIO core runtime — the single shared foundation for every execution world.
 *
 * Design constraints (deliberate, do not "fix" them):
 *  - No `import`/`export`: this file is loaded as a CLASSIC script by content
 *    scripts (MV3 content scripts cannot be ES modules) and imported for its
 *    side effects by the module service worker / extension pages / Node tests.
 *  - No top-level access to `chrome`: the file must be importable in Node so the
 *    pure helpers can be unit-tested without a browser.
 *  - Everything hangs off one namespace: `globalThis.AIO`.
 */
(function (root) {
    'use strict';

    if (root.AIO && root.AIO.core) return; // idempotent

    const AIO = (root.AIO = root.AIO || {});
    const hasChrome = () => typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;

    /* ------------------------------------------------------------------ *
     * Logging — quiet by default, opt-in via storage key `aioDebug`.
     * Never leave console.log in shipped code; use AIO.log(tag).debug(...).
     * ------------------------------------------------------------------ */
    const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
    let currentLevel = LEVELS.warn;

    function setLevel(level) {
        currentLevel = LEVELS[level] || currentLevel;
    }

    /* Bounded in-memory log ring so the diagnostics panel can show recent
     * warnings/errors without the user opening DevTools. Reset on worker restart. */
    const LOG_RING_MAX = 60;
    const logRing = [];

    function stringifyArg(arg) {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return arg.message;
        try {
            return JSON.stringify(arg);
        } catch (err) {
            return String(arg);
        }
    }

    function record(level, tag, args) {
        try {
            logRing.push({
                at: Date.now(),
                level,
                tag,
                message: args.map(stringifyArg).join(' ').slice(0, 400)
            });
            if (logRing.length > LOG_RING_MAX) logRing.shift();
        } catch (err) { /* recording must never throw */ }
    }

    function log(tag) {
        const prefix = '[AIO:' + tag + ']';
        return {
            debug(...args) {
                if (currentLevel > LEVELS.debug) return;
                console.debug(prefix, ...args);
                record('debug', tag, args);
            },
            info(...args) {
                if (currentLevel > LEVELS.info) return;
                console.info(prefix, ...args);
                record('info', tag, args);
            },
            warn(...args) {
                if (currentLevel <= LEVELS.warn) console.warn(prefix, ...args);
                record('warn', tag, args);
            },
            error(...args) {
                if (currentLevel <= LEVELS.error) console.error(prefix, ...args);
                record('error', tag, args);
            }
        };
    }

    /* ------------------------------------------------------------------ *
     * Storage — promise wrappers that never leak `lastError` warnings.
     * ------------------------------------------------------------------ */
    function storageGet(areaName, keys) {
        return new Promise((resolve) => {
            if (!hasChrome() || !chrome.storage || !chrome.storage[areaName]) return resolve({});
            try {
                chrome.storage[areaName].get(keys, (result) => {
                    void chrome.runtime.lastError; // consume: "unchecked runtime.lastError" guard
                    resolve(result || {});
                });
            } catch (err) {
                resolve({});
            }
        });
    }

    function storageSet(areaName, items) {
        return new Promise((resolve) => {
            if (!hasChrome() || !chrome.storage || !chrome.storage[areaName]) return resolve(false);
            try {
                chrome.storage[areaName].set(items, () => {
                    const err = chrome.runtime.lastError;
                    if (err) {
                        log('storage').warn(areaName + '.set failed:', err.message);
                        return resolve(false);
                    }
                    resolve(true);
                });
            } catch (err) {
                resolve(false);
            }
        });
    }

    function storageRemove(areaName, keys) {
        return new Promise((resolve) => {
            if (!hasChrome() || !chrome.storage || !chrome.storage[areaName]) return resolve(false);
            try {
                chrome.storage[areaName].remove(keys, () => {
                    void chrome.runtime.lastError;
                    resolve(true);
                });
            } catch (err) {
                resolve(false);
            }
        });
    }

    /**
     * Coalesce rapid writes into one `storage.set` call.
     * chrome.storage.sync enforces MAX_WRITE_OPERATIONS_PER_MINUTE (120), and a
     * settings UI that saves on every keystroke will blow through it.
     */
    function createWriter(areaName, delayMs = 250) {
        let pending = null;
        let timer = null;
        const flush = () => {
            if (!pending) return;
            const items = pending;
            pending = null;
            timer = null;
            storageSet(areaName, items);
        };
        return {
            queue(items) {
                pending = Object.assign(pending || {}, items);
                if (timer) clearTimeout(timer);
                timer = setTimeout(flush, delayMs);
            },
            flush() {
                if (timer) clearTimeout(timer);
                flush();
            }
        };
    }

    /* ------------------------------------------------------------------ *
     * Messaging — one promise helper, one listener helper, zero
     * "Unchecked runtime.lastError" in the console.
     * ------------------------------------------------------------------ */
    function sendMessage(message, timeoutMs = 10000) {
        return new Promise((resolve) => {
            if (!hasChrome()) return resolve(null);
            let done = false;
            const finish = (value) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(value);
            };
            // A receiver that never answers must not hang the caller forever.
            const timer = setTimeout(() => finish(null), timeoutMs);
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    void chrome.runtime.lastError;
                    finish(response === undefined ? null : response);
                });
            } catch (err) {
                finish(null);
            }
        });
    }

    /** Fire-and-forget notification: no port held open, no response expected. */
    function post(message) {
        if (!hasChrome()) return;
        try {
            chrome.runtime.sendMessage(message);
        } catch (err) {
            /* service worker asleep / extension reloading — nothing to do */
        }
    }

    /**
     * Register a message handler. The handler may return a value or a Promise;
     * returning `undefined` means "not mine" and leaves the channel closed.
     */
    function onMessage(handler) {
        if (!hasChrome() || !chrome.runtime.onMessage) return () => {};
        const listener = (message, sender, sendResponse) => {
            let result;
            try {
                result = handler(message, sender);
            } catch (err) {
                log('msg').error('handler threw', err);
                return false;
            }
            if (result === undefined) return false;
            if (result && typeof result.then === 'function') {
                result.then(
                    (value) => { try { sendResponse(value === undefined ? { ok: true } : value); } catch (e) { /* port closed */ } },
                    (err) => {
                        log('msg').error('async handler failed', err);
                        try { sendResponse({ ok: false, error: String((err && err.message) || err) }); } catch (e) { /* port closed */ }
                    }
                );
                return true;
            }
            try { sendResponse(result); } catch (e) { /* port closed */ }
            return false;
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => {
            try { chrome.runtime.onMessage.removeListener(listener); } catch (e) { /* ignore */ }
        };
    }

    /* ------------------------------------------------------------------ *
     * Timing helpers
     * ------------------------------------------------------------------ */
    function debounce(fn, wait) {
        let timer = null;
        const wrapped = function (...args) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                fn.apply(this, args);
            }, wait);
        };
        wrapped.cancel = () => { if (timer) clearTimeout(timer); timer = null; };
        return wrapped;
    }

    function throttle(fn, wait) {
        let last = 0;
        let timer = null;
        return function (...args) {
            const now = Date.now();
            const remaining = wait - (now - last);
            if (remaining <= 0) {
                last = now;
                fn.apply(this, args);
            } else if (!timer) {
                timer = setTimeout(() => {
                    timer = null;
                    last = Date.now();
                    fn.apply(this, args);
                }, remaining);
            }
        };
    }

    /** Run at most once per animation frame (falls back to a 16ms timer). */
    function rafThrottle(fn) {
        let queued = false;
        let lastArgs = null;
        const schedule = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (cb) => setTimeout(cb, 16);
        return function (...args) {
            lastArgs = args;
            if (queued) return;
            queued = true;
            schedule(() => {
                queued = false;
                fn.apply(this, lastArgs);
            });
        };
    }

    function idle(fn, timeout = 1000) {
        const ric = root.requestIdleCallback;
        if (typeof ric === 'function') ric(fn, { timeout });
        else setTimeout(fn, 200);
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /* ------------------------------------------------------------------ *
     * DOM helpers — used by content scripts and extension pages.
     * ------------------------------------------------------------------ */
    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** Create an element: el('div', {className:'x', dataset:{a:1}}, ['text']) */
    function el(tag, props, children) {
        const node = document.createElement(tag);
        if (props) {
            for (const [key, value] of Object.entries(props)) {
                if (value === undefined || value === null) continue;
                if (key === 'dataset') Object.assign(node.dataset, value);
                else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
                else if (key === 'text') node.textContent = String(value);
                else if (key === 'html') node.innerHTML = value;
                else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
                else node.setAttribute(key, String(value));
            }
        }
        if (children) {
            for (const child of [].concat(children)) {
                if (child == null) continue;
                node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
            }
        }
        return node;
    }

    /** Apply camelCase style objects without touching inline cssText strings. */
    function css(node, styles) {
        if (!node || !styles) return node;
        for (const [key, value] of Object.entries(styles)) {
            if (value === undefined || value === null) continue;
            if (key.startsWith('--')) node.style.setProperty(key, String(value));
            else node.style[key] = String(value);
        }
        return node;
    }

    /**
     * Get-or-create a Shadow DOM host. Extension UI must live in a shadow root:
     * page CSS (`* { display:none }`, `button { all: unset }`) would otherwise
     * destroy our menus on sites like YouTube or Zhihu.
     */
    function shadowHost(id, cssText) {
        let host = document.getElementById(id);
        let root;
        if (host && host.shadowRoot) {
            root = host.shadowRoot;
            const style = root.querySelector('style[data-aio-style]');
            if (style && cssText && style.textContent !== cssText) style.textContent = cssText;
        } else {
            host = document.createElement('div');
            host.id = id;
            host.setAttribute('data-aio-ui', '');
            root = host.attachShadow({ mode: 'open' });
            host._aioRoot = root;
        }
        if (cssText && !root.querySelector('style[data-aio-style]')) {
            const style = document.createElement('style');
            style.setAttribute('data-aio-style', '');
            style.textContent = cssText;
            root.appendChild(style);
        }
        if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
        return { host, root };
    }

    /** Wait for a selector with a hard timeout (never an infinite observer). */
    function waitFor(selector, { root: scope = document, timeout = 8000 } = {}) {
        return new Promise((resolve) => {
            const found = scope.querySelector(selector);
            if (found) return resolve(found);
            let observer = null;
            const timer = setTimeout(() => {
                if (observer) observer.disconnect();
                resolve(null);
            }, timeout);
            observer = new MutationObserver(() => {
                const node = scope.querySelector(selector);
                if (!node) return;
                clearTimeout(timer);
                observer.disconnect();
                resolve(node);
            });
            observer.observe(scope === document ? document.documentElement : scope, { childList: true, subtree: true });
        });
    }

    /** addEventListener that returns a disposer. */
    function listen(target, type, handler, options) {
        if (!target || typeof target.addEventListener !== 'function') return () => {};
        target.addEventListener(type, handler, options);
        return () => {
            try { target.removeEventListener(type, handler, options); } catch (e) { /* ignore */ }
        };
    }

    /* ------------------------------------------------------------------ *
     * Environment
     * ------------------------------------------------------------------ */
    const env = {
        get isContentScript() {
            return hasChrome() && typeof location !== 'undefined' && !location.protocol.startsWith('chrome-extension');
        },
        get isTopFrame() {
            try { return root.top === root; } catch (e) { return true; }
        },
        get isServiceWorker() {
            return typeof ServiceWorkerGlobalScope !== 'undefined' && root instanceof ServiceWorkerGlobalScope;
        },
        get hasChrome() { return hasChrome(); }
    };

    AIO.core = {
        VERSION: 2,
        hasChrome,
        log,
        setLevel,
        applyDebugSetting,
        LEVELS,
        storage: {
            get: storageGet,
            set: storageSet,
            remove: storageRemove,
            createWriter,
            getSync: (keys) => storageGet('sync', keys),
            getLocal: (keys) => storageGet('local', keys),
            setSync: (items) => storageSet('sync', items),
            setLocal: (items) => storageSet('local', items),
            removeSync: (keys) => storageRemove('sync', keys),
            removeLocal: (keys) => storageRemove('local', keys)
        },
        sendMessage,
        post,
        onMessage,
        logRing: {
            list: () => logRing.slice(),
            clear: () => { logRing.length = 0; }
        },
        debounce,
        throttle,
        rafThrottle,
        idle,
        sleep,
        dom: { el, css, escapeHtml, shadowHost, waitFor, listen },
        env
    };

    /**
     * The debug level is NOT read here on purpose: this file is injected into
     * every iframe, and a storage read per frame is a real cost. Each world sets
     * it once it already has the settings in hand:
     *   - background/index.js  (worker start)
     *   - content/lib/content.js (when the frame boots, i.e. has a video)
     *   - ui/options.js, ui/popup.js (page bootstrap)
     */
    function applyDebugSetting(settings) {
        if (!settings) return;
        setLevel(settings.aioDebug ? 'debug' : 'warn');
    }
})(typeof globalThis !== 'undefined' ? globalThis : self);
