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
    const listeners = [];
    return {
        addListener(fn) { listeners.push(fn); },
        removeListener(fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
        hasListener: (fn) => listeners.includes(fn),
        /** Test hook: registered listeners, so tests can drive the router. */
        __listeners: listeners
    };
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
        onCreated: makeEvent(),
        onRemoved: makeEvent(),
        onUpdated: makeEvent()
    },
    windows: { create: async () => ({}), update: async () => ({}), onCreated: makeEvent() },
    cookies: {
        getAllCookieStores: async () => [],
        getAll: async () => [],
        get: async () => null,
        set: async () => {},
        remove: async () => {}
    },
    action: {
        __calls: [],
        async setBadgeText(details) { this.__calls.push(['text', details && details.text]); },
        async setBadgeBackgroundColor() {},
        async getBadgeText() { return { text: '' }; },
        async setIcon() {},
        async setTitle() {}
    },
    alarms: { create() {}, clear() {}, getAll: async () => [], onAlarm: makeEvent() },
    idle: { onStateChanged: makeEvent() },
    webNavigation: { onBeforeNavigate: makeEvent() },
    commands: { onCommand: makeEvent() },
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

test('bili:captureCookies skips the regular window store', async () => {
    // The regular window holds the user's MAIN account cookie: the endpoint
    // must never return it. Only the incognito store's dedicated account may
    // be captured.
    const tabsQuery = globalThis.chrome.tabs.query;
    const cookiesByStore = {
        '0': [{ name: 'SESSDATA', value: 'MAIN-ACCOUNT-COOKIE' }, { name: 'DedeUserID', value: '999' }],
        '1': [{ name: 'SESSDATA', value: 'abc' }, { name: 'DedeUserID', value: '42' }]
    };
    globalThis.chrome.cookies.getAllCookieStores = async () => [
        { id: '0', tabIds: [11] },
        { id: '1', tabIds: [21] }
    ];
    globalThis.chrome.tabs.query = async (query) => {
        if (query && query.incognito === false) return [{ id: 11, incognito: false }];
        if (query && query.incognito === true) return [{ id: 21, incognito: true }];
        return [];
    };
    globalThis.chrome.cookies.getAll = async (details) =>
        (cookiesByStore[details && details.storeId] || []);

    try {
        const reply = await new Promise((resolve) => {
            globalThis.chrome.runtime.onMessage.__listeners.forEach(
                (fn) => fn({ type: 'bili:captureCookies' }, {}, resolve)
            );
        });
        assert.notEqual(reply && reply.error, 'no_cookies', JSON.stringify(reply).slice(0, 120));
        assert.equal(reply && reply.incognito, true, 'capture must flag the incognito store');
        assert.equal(reply && reply.sessdata, 'abc', 'must capture the incognito account, not the main account');
        assert.notEqual(reply && reply.sessdata, 'MAIN-ACCOUNT-COOKIE', 'the regular window must never be read');
    } finally {
        globalThis.chrome.tabs.query = tabsQuery;
    }
});

test('bili:reportLoginState drives the credential alert badge', async () => {
    const action = globalThis.chrome.action;
    action.__calls.length = 0;

    const send = (message, sender) => new Promise((resolve) => {
        globalThis.chrome.runtime.onMessage.__listeners.forEach(
            (fn) => fn(message, sender, resolve)
        );
    });

    // Incognito page reports the seeded session was rejected -> raise '!'
    const bad = await send({ type: 'bili:reportLoginState', loggedIn: false }, { tab: { incognito: true } });
    assert.equal(bad && bad.ok, true, JSON.stringify(bad));
    assert.deepEqual(action.__calls.at(-1), ['text', '!'], 'invalid session must raise the ! badge');

    // Session becomes valid again -> badge cleared
    await send({ type: 'bili:reportLoginState', loggedIn: true }, { tab: { incognito: true } });
    assert.deepEqual(action.__calls.at(-1), ['text', ''], 'valid session must clear the badge');

    // Regular-window reports are ignored (alert is incognito-specific)
    action.__calls.length = 0;
    await send({ type: 'bili:reportLoginState', loggedIn: false }, { tab: { incognito: false } });
    assert.equal(action.__calls.length, 0, 'regular window reports must not touch the badge');
});

test('seed never writes the regular store, whatever its id', async () => {
    // Regression for the store-classification bug: seeding used to treat
    // "id !== '0'" as incognito, so on browsers whose regular store has a
    // different id the dedicated account REPLACED the main account's session
    // in the regular window. Classification must be structural (which tabs
    // live in the store), never a string convention.
    const syncGet = globalThis.chrome.storage.sync.get;
    const tabsQuery = globalThis.chrome.tabs.query;
    const cookiesSet = globalThis.chrome.cookies.set;
    const cookiesGet = globalThis.chrome.cookies.get;
    const storesGet = globalThis.chrome.cookies.getAllCookieStores;

    // A fork where the regular store is '7' and the incognito one is '9'.
    globalThis.chrome.cookies.getAllCookieStores = async () => [
        { id: '7', tabIds: [11] },
        { id: '9', tabIds: [22] }
    ];
    globalThis.chrome.tabs.query = async (query) => {
        if (query && query.incognito === false) return [{ id: 11, incognito: false }];
        if (query && query.incognito === true) return [{ id: 22, incognito: true }];
        return [];
    };
    globalThis.chrome.cookies.get = async () => null; // no pre-existing SESSDATA
    const writes = [];
    globalThis.chrome.cookies.set = async (item) => { writes.push(item); };
    globalThis.chrome.storage.sync.get = (keys, callback) => {
        const value = {
            biliIncognitoLogin: true,
            biliCookies: { sessdata: 'incog', dedeUserId: '42', biliJct: 'jct', dedeUserIdCkMd5: 'md5' }
        };
        if (callback) callback(value);
        return Promise.resolve(value);
    };

    try {
        const bili = await import('../background/features/bilibili.js');

        const results = await bili.seedAllIncognitoStores({ overwrite: true });
        assert.deepEqual(results.map((r) => r && r.ok), [true], 'only the incognito store must be seeded');
        assert.ok(writes.length >= 4, 'the credential cookies must be written');
        for (const write of writes) {
            assert.equal(write.storeId, '9', 'every write must target the store hosting incognito tabs');
            assert.notEqual(write.storeId, '7', 'the regular store must never be written');
        }

        writes.length = 0;
        const direct = await bili.seedIncognitoLogin('7', { overwrite: true });
        assert.equal(direct && direct.ok, false, 'seeding the regular store directly must be refused');
        assert.equal(direct && direct.reason, 'not_incognito_store');
        assert.deepEqual(writes, [], 'a refused seed must not write any cookie');
    } finally {
        globalThis.chrome.storage.sync.get = syncGet;
        globalThis.chrome.tabs.query = tabsQuery;
        globalThis.chrome.cookies.set = cookiesSet;
        globalThis.chrome.cookies.get = cookiesGet;
        globalThis.chrome.cookies.getAllCookieStores = storesGet;
    }
});

test('capture only reads stores that host incognito tabs', async () => {
    const tabsQuery = globalThis.chrome.tabs.query;
    const storesGet = globalThis.chrome.cookies.getAllCookieStores;
    globalThis.chrome.cookies.getAllCookieStores = async () => [
        { id: '7', tabIds: [11] },
        { id: '9', tabIds: [22] }
    ];
    globalThis.chrome.tabs.query = async (query) => {
        if (query && query.incognito === false) return [{ id: 11, incognito: false }];
        if (query && query.incognito === true) return [{ id: 22, incognito: true }];
        return [];
    };
    globalThis.chrome.cookies.getAll = async (details) =>
        (details && details.storeId === '7'
            ? [{ name: 'SESSDATA', value: 'MAIN-ACCOUNT-COOKIE' }]
            : [{ name: 'SESSDATA', value: 'incog' }]);

    try {
        const reply = await new Promise((resolve) => {
            globalThis.chrome.runtime.onMessage.__listeners.forEach(
                (fn) => fn({ type: 'bili:captureCookies' }, {}, resolve)
            );
        });
        assert.equal(reply && reply.sessdata, 'incog', 'must read the incognito store only');
        assert.notEqual(reply && reply.sessdata, 'MAIN-ACCOUNT-COOKIE', 'the regular store must never be read even when its id is not 0');
    } finally {
        globalThis.chrome.tabs.query = tabsQuery;
        globalThis.chrome.cookies.getAllCookieStores = storesGet;
    }
});
