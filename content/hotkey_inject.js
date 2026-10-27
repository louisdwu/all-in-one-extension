/**
 * Hotkey remapper — MAIN world.
 *
 * A site binds "F" to its own action; the user wants that action on "H".
 * We cannot re-bind the site's own handlers, so we intercept the events they
 * receive: pressing H is delivered as F, pressing F is swallowed.
 *
 * Performance contract: the two prototype methods are patched once at
 * document_start (O(1), no per-event work), because a site registers its own
 * keydown listeners during page load — patching later would miss them. When no
 * mapping is configured, `processEvent` short-circuits on a single boolean and
 * allocates nothing (no Proxy, no event clone). Disabling the feature at runtime
 * also short-circuits, so the page behaves exactly as stock.
 */
(function () {
    'use strict';

    if (window.__aioHotkeys) return;
    window.__aioHotkeys = true;

    const EVENT_TYPES = ['keydown', 'keyup', 'keypress'];
    const MODIFIER_TOKENS = ['Ctrl', 'Control', 'Alt', 'Shift', 'Meta', 'Cmd', 'Win', 'AltGraph', 'CapsLock'];

    let config = { enabled: false, mappings: {} };
    /** reverse: pressed new key → original key to emulate */
    let reverse = {};
    let hasMappings = false;
    let installed = false;
    const wrappers = new WeakMap(); // listener → Map<key, wrappedListener>

    /* ------------------------- key normalisation ------------------------- */
    function normalizeKey(key) {
        if (!key) return '';
        if (key === ' ' || key === 'Spacebar') return 'Space';
        if (key === 'Esc') return 'Escape';
        if (key.length === 1) return key.toUpperCase();
        return key;
    }

    function identifierFor(event) {
        const parts = [];
        if (event.ctrlKey) parts.push('Ctrl');
        if (event.altKey) parts.push('Alt');
        if (event.shiftKey) parts.push('Shift');
        if (event.metaKey) parts.push('Meta');
        const key = normalizeKey(event.key);
        if (key && !MODIFIER_TOKENS.includes(event.key)) parts.push(key);
        return parts.join('+');
    }

    function parseIdentifier(identifier) {
        const parts = String(identifier || '').split('+').filter(Boolean);
        const key = parts.length ? parts[parts.length - 1] : '';
        return {
            ctrlKey: parts.includes('Ctrl'),
            altKey: parts.includes('Alt'),
            shiftKey: parts.includes('Shift'),
            metaKey: parts.includes('Meta'),
            key: normalizeKey(key)
        };
    }

    const KEY_CODE_BY_NAME = {
        Enter: 13, Escape: 27, Space: 32, Tab: 9, Backspace: 8, Delete: 46,
        ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
        F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117, F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123
    };

    function codeForName(name) {
        if (name.length === 1) {
            if (name >= 'A' && name <= 'Z') return 'Key' + name;
            if (name >= '0' && name <= '9') return 'Digit' + name;
        }
        return name;
    }

    function keyCodeForName(name) {
        if (name.length === 1) return name.toUpperCase().charCodeAt(0);
        return KEY_CODE_BY_NAME[name] || 0;
    }

    function createEventProxy(event, target) {
        const code = codeForName(target.key);
        const keyCode = keyCodeForName(target.key);
        const keyValue = target.key.length === 1 ? target.key.toLowerCase() : target.key;
        return new Proxy(event, {
            get(obj, prop) {
                switch (prop) {
                    case 'key': return keyValue;
                    case 'code': return code;
                    case 'keyCode':
                    case 'which': return keyCode;
                    case 'ctrlKey': return target.ctrlKey;
                    case 'altKey': return target.altKey;
                    case 'shiftKey': return target.shiftKey;
                    case 'metaKey': return target.metaKey;
                    default: {
                        const value = obj[prop];
                        return typeof value === 'function' ? value.bind(obj) : value;
                    }
                }
            }
        });
    }

    function isEditable(target) {
        if (!target || target.nodeType !== 1) return false;
        const tag = target.tagName.toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable === true;
    }

    /** @returns {{event: Event, blocked: boolean}} */
    function processEvent(event) {
        // Fast path: one boolean check, no allocation.
        if (!config.enabled || !hasMappings) return { event, blocked: false };
        if (isEditable(event.target)) return { event, blocked: false };

        const identifier = identifierFor(event);
        const targetKey = reverse[identifier];
        if (targetKey) return { event: createEventProxy(event, parseIdentifier(targetKey)), blocked: false };
        if (config.mappings[identifier]) return { event, blocked: true };
        return { event, blocked: false };
    }

    /* --------------------------- patching --------------------------- */
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;

    function listenerKey(type, options) {
        const capture = typeof options === 'boolean' ? options : !!(options && options.capture);
        return type + '|' + (capture ? 'capture' : 'bubble');
    }

    function install() {
        if (installed) return;
        installed = true;

        EventTarget.prototype.addEventListener = function (type, listener, options) {
            const isKeyboard = EVENT_TYPES.includes(type);
            const isCallable = typeof listener === 'function' || (listener && typeof listener.handleEvent === 'function');
            if (!isKeyboard || !isCallable) return originalAdd.call(this, type, listener, options);

            const wrapped = function (event) {
                const { event: processed, blocked } = processEvent(event);
                if (blocked) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                if (typeof listener === 'function') return listener.call(this, processed);
                return listener.handleEvent(processed);
            };

            let map = wrappers.get(listener);
            if (!map) {
                map = new Map();
                wrappers.set(listener, map);
            }
            map.set(listenerKey(type, options), wrapped);

            // An AbortSignal must also detach our wrapper.
            if (options && options.signal) {
                const detach = () => originalRemove.call(this, type, wrapped, options);
                try {
                    if (options.signal.aborted) return undefined;
                    options.signal.addEventListener('abort', detach, { once: true });
                } catch (err) { /* ignore */ }
            }
            return originalAdd.call(this, type, wrapped, options);
        };

        EventTarget.prototype.removeEventListener = function (type, listener, options) {
            const map = wrappers.get(listener);
            if (map) {
                const key = listenerKey(type, options);
                const wrapped = map.get(key);
                if (wrapped) {
                    map.delete(key);
                    return originalRemove.call(this, type, wrapped, options);
                }
            }
            return originalRemove.call(this, type, listener, options);
        };
    }

    /* ------------------------- config plumbing ------------------------- */
    function applyConfig(next) {
        config = { enabled: !!next.enabled, mappings: next.mappings || {} };
        reverse = {};
        for (const [from, to] of Object.entries(config.mappings)) reverse[to] = from;
        hasMappings = Object.keys(config.mappings).length > 0;
    }

    function readAttribute() {
        try {
            const raw = document.documentElement.getAttribute('data-aio-hotkeys');
            if (!raw) return;
            applyConfig(JSON.parse(raw));
        } catch (err) { /* malformed payload: keep the previous config */ }
    }

    // Patch immediately: the site's own listeners are registered right after us.
    install();
    readAttribute();
    const observer = new MutationObserver(() => readAttribute());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-aio-hotkeys'] });
})();
