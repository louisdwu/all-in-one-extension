import test from 'node:test';
import assert from 'node:assert/strict';
import '../libs/core.js';
import '../libs/schema.js';

const { normalize, normalizePreset, presetList, DEFAULT_SHORTCUTS, toStorage, load, save, SCHEMA_VERSION } = globalThis.AIO.schema;

/** Minimal chrome.storage.sync stub so save()/load() can be exercised in Node. */
function withFakeStorage(initial, run) {
    const store = JSON.parse(JSON.stringify(initial));
    globalThis.chrome = {
        runtime: { id: 'test', lastError: null },
        storage: {
            sync: {
                get: (keys, callback) => callback(JSON.parse(JSON.stringify(store))),
                set: (items, callback) => {
                    Object.assign(store, JSON.parse(JSON.stringify(items)));
                    if (callback) callback();
                },
                remove: (keys, callback) => { if (callback) callback(); }
            }
        }
    };
    return Promise.resolve(run(store)).finally(() => { delete globalThis.chrome; });
}

test('empty storage yields a complete, typed default object', () => {
    const settings = normalize({});
    assert.equal(settings.aioTabsEnabled, true);
    assert.equal(settings.globalEnabled, true);
    assert.equal(settings.biliAutoSubtitle, true);
    assert.equal(settings.bilibiliSubtitles.autoEnableSubtitle, true);
    assert.equal(settings.waqiToken, '', 'no token may be hardcoded');
    assert.deepEqual(settings.shortcuts, DEFAULT_SHORTCUTS);
    assert.equal(settings.aioSchemaVersion, SCHEMA_VERSION);
});

test('explicit false is preserved (the classic !== false bug)', () => {
    const settings = normalize({ hudEnabled: false, globalEnabled: false, aioTabEnabled: false });
    assert.equal(settings.hudEnabled, false);
    assert.equal(settings.globalEnabled, false);
});

test('legacy arrow shortcut spellings are migrated', () => {
    const settings = normalize({ shortcuts: { increaseSpeed: 'Ctrl+Shift+Right' } });
    assert.equal(settings.shortcuts.increaseSpeed, 'Ctrl+Shift+ArrowRight');
    assert.equal(settings.shortcuts.decreaseSpeed, DEFAULT_SHORTCUTS.decreaseSpeed);
});

test('the duplicated subtitle switch stays in sync', () => {
    // new key set, old key unset
    assert.equal(normalize({ biliAutoSubtitle: false }).bilibiliSubtitles.autoEnableSubtitle, false);
    // old nested key set, new key unset
    assert.equal(normalize({ bilibiliSubtitles: { autoEnableSubtitle: false } }).biliAutoSubtitle, false);
});

test('a stale nested subtitle flag cannot override the canonical switch', () => {
    // Regression: save() always writes both keys, so the nested copy is present
    // with the *previous* value. When it won, turning "自动开启中文字幕" off
    // never persisted and every bilibili page still auto-enabled subtitles.
    const settings = normalize({
        biliAutoSubtitle: false,
        bilibiliSubtitles: { autoEnableSubtitle: true, subtitleHotkey: 's' }
    });
    assert.equal(settings.biliAutoSubtitle, false);
    assert.equal(settings.bilibiliSubtitles.autoEnableSubtitle, false);
});

test('saving the subtitle switch off persists through a reload', async () => {
    await withFakeStorage({ biliAutoSubtitle: true, bilibiliSubtitles: { autoEnableSubtitle: true, subtitleHotkey: 's' } }, async (store) => {
        const saved = await save({ biliAutoSubtitle: false });
        assert.equal(saved.biliAutoSubtitle, false);
        assert.equal(store.biliAutoSubtitle, false);
        assert.equal(store.bilibiliSubtitles.autoEnableSubtitle, false, 'the mirror key must follow');
        assert.equal((await load()).biliAutoSubtitle, false, 'reload keeps it off');

        // A legacy writer that only knows the nested key still works...
        const legacyOff = await save({ bilibiliSubtitles: { autoEnableSubtitle: false } });
        assert.equal(legacyOff.biliAutoSubtitle, false);
        assert.equal(legacyOff.bilibiliSubtitles.subtitleHotkey, 's', 'patching one field keeps the hotkey');

        // ...and switching it back on does not leave a stale nested value.
        const backOn = await save({ biliAutoSubtitle: true });
        assert.equal(backOn.biliAutoSubtitle, true);
        assert.equal(backOn.bilibiliSubtitles.autoEnableSubtitle, true);
    });
});

test('numbers are clamped and coerced', () => {
    assert.equal(normalize({ defaultSpeed: '3' }).defaultSpeed, 3);
    assert.equal(normalize({ defaultSpeed: 99 }).defaultSpeed, 16);
    assert.equal(normalize({ defaultSpeed: 0 }).defaultSpeed, 0.25);
    assert.equal(normalize({ aioTabsDelay: -1 }).aioTabsDelay, 0);
    assert.equal(normalize({ hudCarouselInterval: 1 }).hudCarouselInterval, 3);
});

test('preset speeds are validated, deduped and clamped', () => {
    assert.equal(normalizePreset('1, 2.5，2.5, 3'), '1, 2.5, 3');
    assert.equal(normalizePreset('abc'), '2');
    assert.equal(normalizePreset('99'), '16');
    assert.deepEqual(presetList({ presetSpeed: '1, 2.5' }), [1, 2.5]);
});

test('speed memory mode replaces the old boolean flag', () => {
    assert.equal(normalize({}).speederSpeedMemory, 'site', 'new installs remember per site');
    assert.equal(normalize({ speederRememberSpeed: true }).speederSpeedMemory, 'global');
    assert.equal(normalize({ speederRememberSpeed: false }).speederSpeedMemory, 'off');
    assert.equal(normalize({ speederSpeedMemory: 'global' }).speederSpeedMemory, 'global');
    assert.equal(normalize({ speederSpeedMemory: 'nonsense' }).speederSpeedMemory, 'site');
    assert.equal(normalize({ speederSpeedMemory: 'global', speederRememberSpeed: false }).speederSpeedMemory, 'global');
});

test('entities and mappings are sanitized', () => {
    const settings = normalize({
        haEntities: [{ id: ' sensor.power ', name: '功率', op: 'x', warn: 10 }, { id: '' }],
        hotkeyMappings: { 'a.com': { F: 'H', bad: 1 }, 'b.com': {} }
    });
    assert.equal(settings.haEntities.length, 1);
    assert.equal(settings.haEntities[0].id, 'sensor.power');
    assert.equal(settings.haEntities[0].op, '>');
    assert.deepEqual(settings.hotkeyMappings, { 'a.com': { F: 'H' } });
});

test('toStorage only emits persisted keys', () => {
    const stored = toStorage(normalize({}));
    assert.equal(Object.prototype.hasOwnProperty.call(stored, 'aioSchemaVersion'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(stored, 'notAKey'), false);
});

test('incognito login reuse is on by default and can be turned off', () => {
    assert.equal(normalize({}).biliIncognitoLogin, true);
    assert.equal(normalize({ biliIncognitoLogin: false }).biliIncognitoLogin, false);
    // Every switch in this schema treats anything but a truthy literal as off.
    assert.equal(normalize({ biliIncognitoLogin: 'nope' }).biliIncognitoLogin, false);
});

test('biliIncognitoLogin survives a save/load round-trip', async () => {
    await withFakeStorage({}, async (store) => {
        await save({ biliIncognitoLogin: false });
        assert.equal(store.biliIncognitoLogin, false);
        assert.equal((await load()).biliIncognitoLogin, false);
    });
});
