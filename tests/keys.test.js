import test from 'node:test';
import assert from 'node:assert/strict';
import '../libs/core.js';
import '../libs/keys.js';

const { serialize, parse, matches, matchAction, isValid, normalizeKey, display } = globalThis.AIO.keys;

const ev = (key, mods = {}) => Object.assign({ key }, mods);

test('serialize produces the canonical modifier order', () => {
    assert.equal(serialize(ev('ArrowRight', { ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+ArrowRight');
    assert.equal(serialize(ev('a', { shiftKey: true, metaKey: true, altKey: true })), 'Alt+Shift+Meta+A');
    assert.equal(serialize(ev(' ')), 'Space');
    assert.equal(serialize(ev('Escape')), 'Escape');
    assert.equal(serialize(ev('F5')), 'F5');
});

test('serialize ignores bare modifier presses', () => {
    assert.equal(serialize(ev('Control', { ctrlKey: true })), 'Ctrl');
});

test('parse normalizes legacy arrow spellings', () => {
    const parsed = parse('Ctrl+Shift+Right');
    assert.equal(parsed.key, 'ArrowRight');
    assert.equal(parsed.ctrlKey, true);
    assert.equal(parsed.shiftKey, true);
    assert.equal(parsed.altKey, false);
});

test('matches is spelling-insensitive for arrows and letters', () => {
    assert.equal(matches(ev('ArrowRight', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+ArrowRight'), true);
    assert.equal(matches(ev('Right', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+ArrowRight'), true);
    assert.equal(matches(ev('a', { ctrlKey: true }), 'Ctrl+A'), true);
    assert.equal(matches(ev('ArrowRight', { ctrlKey: true }), 'Ctrl+Shift+ArrowRight'), false);
    assert.equal(matches(ev('b', { ctrlKey: true }), 'Ctrl+A'), false);
});

test('matchAction finds the first matching binding', () => {
    const map = { increaseSpeed: 'Ctrl+Shift+ArrowRight', decreaseSpeed: 'Ctrl+Shift+ArrowLeft' };
    assert.equal(matchAction(ev('ArrowLeft', { ctrlKey: true, shiftKey: true }), map), 'decreaseSpeed');
    assert.equal(matchAction(ev('x'), map), null);
});

test('isValid requires a modifier and a real key', () => {
    assert.equal(isValid('Ctrl+A'), true);
    assert.equal(isValid('A'), false);
    assert.equal(isValid('Ctrl'), false);
    assert.equal(isValid('Ctrl+Shift+ArrowRight'), true);
});

test('normalizeKey maps aliases', () => {
    assert.equal(normalizeKey('Spacebar'), 'Space');
    assert.equal(normalizeKey('Up'), 'ArrowUp');
    assert.equal(normalizeKey('z'), 'Z');
    assert.equal(normalizeKey('Enter'), 'Enter');
});

test('display renders arrows', () => {
    assert.equal(display('Ctrl+Shift+ArrowRight'), 'Ctrl + Shift + →');
});
