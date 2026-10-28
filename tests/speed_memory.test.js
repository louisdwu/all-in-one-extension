import test from 'node:test';
import assert from 'node:assert/strict';
import '../libs/core.js';
import '../libs/speed_memory.js';

const { clampSpeed, normalize, resolve, remember, isMode, MAX_ENTRIES } = globalThis.AIO.speedMemory;

test('clampSpeed accepts numbers and numeric strings, rejects junk', () => {
    assert.equal(clampSpeed(1.5), 1.5);
    assert.equal(clampSpeed('2'), 2);
    assert.equal(clampSpeed(0), null);
    assert.equal(clampSpeed(-1), null);
    assert.equal(clampSpeed(NaN), null);
    assert.equal(clampSpeed('abc'), null);
    assert.equal(clampSpeed(99), 16);
    assert.equal(clampSpeed(0.01), 0.1);
    assert.equal(clampSpeed(1.23456), 1.23);
});

test('normalize drops invalid entries', () => {
    const store = normalize({ 'a.com': 1.5, 'b.com': 'x', '': 2, 'c.com': 0 });
    assert.deepEqual(store, { 'a.com': 1.5 });
    assert.deepEqual(normalize(null), {});
    assert.deepEqual(normalize([1, 2]), {});
});

test('resolve honours the three modes', () => {
    const store = { 'www.youtube.com': 1.75 };
    assert.equal(resolve(store, 'www.youtube.com', { mode: 'site', defaultSpeed: 1 }), 1.75);
    assert.equal(resolve(store, 'other.com', { mode: 'site', defaultSpeed: 1 }), 1);
    assert.equal(resolve(store, 'www.youtube.com', { mode: 'global', globalSpeed: 2.5, defaultSpeed: 1 }), 2.5);
    assert.equal(resolve(store, 'www.youtube.com', { mode: 'global', defaultSpeed: 1 }), 1);
    assert.equal(resolve(store, 'www.youtube.com', { mode: 'off', defaultSpeed: 1.25 }), 1.25);
});

test('resolve never returns an unusable speed', () => {
    assert.equal(resolve({}, 'a.com', { mode: 'site', defaultSpeed: 0 }), 1);
    assert.equal(resolve({}, 'a.com', { mode: 'global', globalSpeed: 'nope', defaultSpeed: 3 }), 3);
    assert.equal(resolve({ 'a.com': 99 }, 'a.com', { mode: 'site', defaultSpeed: 1 }), 16);
});

test('remember puts the host first and keeps previous hosts', () => {
    const store = remember({ 'b.com': 2 }, 'a.com', 1.5);
    assert.deepEqual(Object.keys(store), ['a.com', 'b.com']);
    assert.equal(store['a.com'], 1.5);

    const updated = remember(store, 'b.com', 3);
    assert.deepEqual(Object.keys(updated), ['b.com', 'a.com']);
    assert.equal(updated['b.com'], 3);
});

test('remember prunes the oldest entries beyond the cap', () => {
    let store = {};
    for (let i = 0; i < MAX_ENTRIES + 10; i++) store = remember(store, 'h' + i + '.com', 1);
    assert.equal(Object.keys(store).length, MAX_ENTRIES);
    assert.equal(store['h' + (MAX_ENTRIES + 9) + '.com'], 1, 'newest kept');
    assert.equal(store['h0.com'], undefined, 'oldest pruned');
});

test('remember ignores unusable input', () => {
    assert.deepEqual(remember({ 'a.com': 1 }, '', 2), { 'a.com': 1 });
    assert.deepEqual(remember({ 'a.com': 1 }, 'b.com', 0), { 'a.com': 1 });
});

test('isMode validates the stored mode', () => {
    assert.equal(isMode('site'), true);
    assert.equal(isMode('global'), true);
    assert.equal(isMode('off'), true);
    assert.equal(isMode('yes'), false);
    assert.equal(isMode(undefined), false);
});
