import test from 'node:test';
import assert from 'node:assert/strict';
import '../libs/core.js';
import '../libs/schema.js';

const { normalize, normalizePreset, presetList, DEFAULT_SHORTCUTS, toStorage, SCHEMA_VERSION } = globalThis.AIO.schema;

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
