import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Boots the whole background module graph against a chrome.* stub.
 * Catches the class of bug that a plain `node --check` cannot: a missing module,
 * a wrong relative import depth, or a top-level throw in a feature module
 * (which would make Chrome log "An unknown error occurred when fetching the
 * script" and silently disable the entire service worker).
 */

function makeEvent() {
    return { addListener() {}, removeListener() {}, hasListener: () => false };
}

function makeArea() {
    return {
        get(keys, callback) {
            const value = {};
            if (callback) callback(value);
            return Promise.resolve(value);
        },
        set(items, callback) {
            if (callback) callback();
            return Promise.resolve();
        },
        remove(keys, callback) {
            if (callback) callback();
            return Promise.resolve();
        }
    };
}

globalThis.chrome = {
    runtime: {
        id: 'test-extension',
        lastError: null,
        onMessage: makeEvent(),
        onInstalled: makeEvent(),
        onStartup: makeEvent(),
        getManifest: () => ({ version: '0.0.0' }),
        sendMessage() {},
        openOptionsPage() {}
    },
    storage: { sync: makeArea(), local: makeArea(), onChanged: makeEvent() },
    tabs: {
        query: async () => [],
        sendMessage: async () => {},
        get: async () => ({}),
        update: async () => ({}),
        onRemoved: makeEvent(),
        onUpdated: makeEvent()
    },
    windows: { create: async () => ({}), update: async () => ({}) },
    cookies: {
        getAllCookieStores: async () => [],
        getAll: async () => [],
        get: async () => null,
        set: async () => {},
        remove: async () => {}
    },
    alarms: { create() {}, clear() {}, getAll: async () => [], onAlarm: makeEvent() },
    idle: { onStateChanged: makeEvent() },
    webNavigation: { onBeforeNavigate: makeEvent() },
    commands: { onCommand: makeEvent() },
    action: { setIcon() {}, setTitle() {}, setBadgeText() {} },
    extension: { isAllowedIncognitoAccess: (cb) => cb(true) }
};

// Emulate the worker scope: addEventListener exists there but not in Node.
const scopeListeners = new Map();
globalThis.addEventListener = (type, handler) => {
    scopeListeners.set(type, handler);
};
globalThis.removeEventListener = (type) => {
    scopeListeners.delete(type);
};

globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() {
        return new Proxy({}, {
            get: (target, prop) => (prop in target ? target[prop] : () => ({ data: new Uint8ClampedArray(4) }))
        });
    }
};
globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'ok', data: {} }) });

test('background module graph boots and registers its handlers', async () => {
    await import('../background/index.js');
    assert.equal(scopeListeners.has('error'), true, 'uncaught errors must be captured');
    assert.equal(scopeListeners.has('unhandledrejection'), true, 'unhandled rejections must be captured');
    const AIO = globalThis.AIO;
    assert.ok(AIO && AIO.core, 'core runtime must be installed');
    assert.ok(AIO.schema, 'schema must be installed');
    const { registeredTypes } = await import('../background/router.js');
    const types = registeredTypes();
    for (const type of ['tabs:list', 'tabs:activate', 'incognito:open', 'hotkeys:context', 'speeder:getSettings', 'bili:getSettings', 'bili:loginState', 'bili:incognitoStatus', 'bili:seedIncognitoLogin', 'hud:refresh', 'diag:snapshot', 'diag:ping', 'getTabs', 'saveSpeederSettings']) {
        assert.ok(types.includes(type), 'missing handler: ' + type);
    }
});

test('settings normalize to a usable object without storage', async () => {
    const { AIO } = globalThis;
    const settings = AIO.schema.normalize({});
    assert.equal(settings.globalEnabled, true);
    assert.equal(AIO.schema.presetList(settings).length > 0, true);
});
